/*
Copyright (C) 2024 Christian Lockley
This library is free software; you can redistribute it and/or modify it
under the terms of the GNU Lesser General Public License as published by
the Free Software Foundation; either version 3 of the License, or
(at your option) any later version.

This library is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
Lesser General Public License for more details.

You should have received a copy of the GNU Lesser General Public License
along with this library. If not, see <https://www.gnu.org/licenses/>.
*/

// Package ewb reads legacy and SQLite EasyWorship Bible (.ewb) files.
//
// Legacy Bible Text file layout:
//
//	0x00  22 bytes  magic "EasyWorship Bible Text"
//	0x16  1 byte    0x1A terminator
//	0x17  1 byte    format version (0x02 observed)
//	0x18  u32 LE    header size (60 observed)
//	0x1C  u32 LE    directory record size (224 observed)
//	0x58  directory of fixed-size records, one per book in canonical order:
//	      +0    48 bytes  localized book name, NUL padded (cp1252, may be
//	                      empty or begin with a space)
//	      +51   1 byte    chapter count
//	      +52   n bytes   per-chapter verse-count bytes (advisory only;
//	                      inconsistent in several real translations)
//	      +208  u64 LE    book stream offset
//	      +216  u64 LE    book stream length
//	end-16  u64 LE  directory end offset (determines the record count)
//	end-8   8 bytes trailer magic "ezwBible"
//
// Immediately after the directory: u32 LE compressed length followed by a
// zlib stream holding the entitlement string "ez(Free|Paid)<ABBREVIATION>".
//
// Each book stream is a standard zlib stream (its recorded length includes a
// custom ten-byte tail the inflater never consumes). Inflated book text is
// cp1252 with verse blocks separated by CRLF pairs, each block shaped
// "chapter:verse text" or "chapter:first-last text" for combined verses.
//
// The parser treats input as untrusted: every offset and length is bounds
// checked and inflation output is capped.
package ewb

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"regexp"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
)

const (
	headerMagic      = "EasyWorship Bible Text"
	trailerMagic     = "ezwBible"
	directoryStart   = 0x58
	recordSize       = 224
	nameFieldSize    = 48
	chapterCountOff  = 51
	streamOffsetOff  = 208
	streamLengthOff  = 216
	maxFileSize      = 64 << 20
	maxInflatedBook  = 8 << 20
	maxBooks         = 66
	entitlementLimit = 256
)

// CanonicalBookCount is the number of books a legacy .ewb file indexes by
// position. Directory index i is canonical book ID i+1 (Genesis..Revelation).
const CanonicalBookCount = maxBooks

type Verse struct {
	// Number is the first verse number the block covers.
	Number int
	// EndNumber is the last verse of a combined block, or 0 for a single verse.
	EndNumber int
	Text      string
}

type Chapter struct {
	Number int
	Verses []Verse
}

type Book struct {
	// ID is the canonical book ID (1 = Genesis ... 66 = Revelation).
	ID int
	// Name is the localized book name recorded in the file, possibly empty.
	Name     string
	Chapters []Chapter
}

type Bible struct {
	Path     string
	Name     string
	Language string
	// Abbreviation comes from the SQLite header or the legacy entitlement stream.
	Abbreviation string
	// Entitlement is the raw entitlement string, for example "ezFreeDARBY".
	Entitlement string
	// Free reports whether the entitlement marks the translation "ezFree".
	Free  bool
	Books []Book
}

var verseLine = regexp.MustCompile(`^(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))? ?`)

// Source reads books from an open plugin. Its catalog contains names and
// chapter sizes only. Callers own the decoded book returned by ReadBook.
type Source struct {
	Bible
	VerseCounts map[int][]int
	readBook    func(int) ([]Chapter, error)
	closer      io.Closer
}

func (s *Source) Close() error {
	if s.closer != nil {
		return s.closer.Close()
	}
	return nil
}

// All translations share the same book workers, including during startup.
var bookWorkers = make(chan struct{}, min(runtime.GOMAXPROCS(0), 8))

// DecodeConcurrency is the maximum number of simultaneous book decodes.
func DecodeConcurrency() int { return cap(bookWorkers) }

func (s *Source) ReadBook(id int) ([]Chapter, error) {
	bookWorkers <- struct{}{}
	defer func() { <-bookWorkers }()
	return s.readBook(id)
}

// VisitBooks decodes and processes books concurrently. Each callback owns its
// input index. All callbacks finish before return, including on failure.
func (s *Source) VisitBooks(books []Book, visit func(index int, chapters []Chapter) error) error {
	var workers sync.WaitGroup
	var failed atomic.Bool
	errorsByBook := make([]error, len(books))
	for index, book := range books {
		bookWorkers <- struct{}{}
		if failed.Load() {
			<-bookWorkers
			break
		}
		workers.Add(1)
		go func() {
			defer workers.Done()
			defer func() { <-bookWorkers }()
			chapters, err := s.readBook(book.ID)
			if err == nil {
				err = visit(index, chapters)
			}
			if err != nil {
				errorsByBook[index] = fmt.Errorf("book %d: %w", book.ID, err)
				failed.Store(true)
			}
		}()
	}
	workers.Wait()
	for _, err := range errorsByBook {
		if err != nil {
			return err
		}
	}
	return nil
}

// Open validates books in parallel and retains only metadata for later lookups.
func Open(path string) (*Source, error) {
	source, err := openSource(path)
	if err != nil {
		return nil, err
	}
	byBook := make([][]int, len(source.Books))
	err = source.VisitBooks(source.Books, func(index int, chapters []Chapter) error {
		var counts []int
		for _, chapter := range chapters {
			for len(counts) < chapter.Number {
				counts = append(counts, 0)
			}
			counts[chapter.Number-1] = len(chapter.Verses)
		}
		byBook[index] = counts
		return nil
	})
	if err != nil {
		source.Close()
		return nil, err
	}
	source.VerseCounts = make(map[int][]int)
	books := source.Books[:0]
	for i, book := range source.Books {
		if len(byBook[i]) > 0 {
			books = append(books, book)
			source.VerseCounts[book.ID] = byBook[i]
		}
	}
	source.Books = books
	if len(books) == 0 {
		source.Close()
		return nil, fmt.Errorf("no readable books")
	}
	return source, nil
}

func openSource(path string) (*Source, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > maxFileSize {
		return nil, fmt.Errorf("invalid Bible file or size: %s", path)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	var signature [len(sqliteMagic)]byte
	if _, err := file.ReadAt(signature[:], 0); err != nil {
		file.Close()
		return nil, err
	}
	var source *Source
	if string(signature[:]) == sqliteMagic {
		file.Close()
		source, err = openSQLiteSource(path)
	} else {
		source, err = openLegacySource(file, info.Size())
		if err != nil {
			file.Close()
		} else {
			source.closer = file
		}
	}
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	source.Path = path
	return source, nil
}

func (s *Source) readAll() (*Bible, error) {
	bible := s.Bible
	bible.Books = slices.Clone(s.Books)
	err := s.VisitBooks(s.Books, func(index int, chapters []Chapter) error {
		bible.Books[index].Chapters = chapters
		return nil
	})
	if err != nil {
		return nil, err
	}
	bible.Books = slices.DeleteFunc(bible.Books, func(book Book) bool { return len(book.Chapters) == 0 })
	if len(bible.Books) == 0 {
		return nil, fmt.Errorf("no readable books")
	}
	return &bible, nil
}

// ParseFile materializes a Bible for callers that explicitly request all text.
func ParseFile(path string) (*Bible, error) {
	source, err := openSource(path)
	if err != nil {
		return nil, err
	}
	defer source.Close()
	return source.readAll()
}

// Parse decodes an EasyWorship Bible from raw bytes.
func Parse(data []byte) (*Bible, error) {
	if len(data) > maxFileSize {
		return nil, fmt.Errorf("file exceeds %d bytes", maxFileSize)
	}
	if bytes.HasPrefix(data, []byte(sqliteMagic)) {
		return parseSQLite(data)
	}
	source, err := openLegacySource(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	return source.readAll()
}

func openLegacySource(file io.ReaderAt, size int64) (*Source, error) {
	if size < directoryStart+recordSize+16 {
		return nil, fmt.Errorf("file is too small for an EasyWorship Bible")
	}
	header := make([]byte, len(headerMagic))
	if _, err := file.ReadAt(header, 0); err != nil {
		return nil, err
	}
	if string(header) != headerMagic {
		return nil, fmt.Errorf("missing EasyWorship Bible Text signature")
	}
	var trailer [16]byte
	if _, err := file.ReadAt(trailer[:], size-16); err != nil {
		return nil, err
	}
	if string(trailer[8:]) != trailerMagic {
		return nil, fmt.Errorf("missing ezwBible trailer")
	}
	dirEnd := binary.LittleEndian.Uint64(trailer[:8])
	if dirEnd <= directoryStart || dirEnd >= uint64(size) {
		return nil, fmt.Errorf("directory end pointer out of range")
	}
	dirBytes := dirEnd - directoryStart
	if dirBytes%recordSize != 0 || dirBytes/recordSize > maxBooks {
		return nil, fmt.Errorf("invalid book directory size")
	}
	// Read the small directory and entitlement block without loading book streams.
	data := make([]byte, min(int64(dirEnd)+4+entitlementLimit, size))
	if _, err := file.ReadAt(data, 0); err != nil {
		return nil, err
	}
	entitlement, err := readEntitlement(data, int(dirEnd))
	if err != nil {
		return nil, err
	}
	source := &Source{Bible: Bible{
		Entitlement:  entitlement,
		Abbreviation: abbreviationFromEntitlement(entitlement),
		Free:         strings.HasPrefix(entitlement, "ezFree"),
	}}
	type location struct{ offset, length int64 }
	locations := make(map[int]location)
	for id := 1; id <= int(dirBytes/recordSize); id++ {
		record := data[directoryStart+(id-1)*recordSize : directoryStart+id*recordSize]
		offset := binary.LittleEndian.Uint64(record[streamOffsetOff:])
		length := binary.LittleEndian.Uint64(record[streamLengthOff:])
		if length == 0 {
			continue
		}
		if offset < dirEnd || offset > uint64(size) || length > uint64(size)-offset {
			return nil, fmt.Errorf("book %d stream out of range", id)
		}
		locations[id] = location{int64(offset), int64(length)}
		source.Books = append(source.Books, Book{ID: id, Name: recordBookName(record)})
	}
	source.readBook = func(id int) ([]Chapter, error) {
		loc, ok := locations[id]
		if !ok {
			return nil, fmt.Errorf("unknown book %d", id)
		}
		raw, err := inflateReader(io.NewSectionReader(file, loc.offset, loc.length))
		if err != nil {
			return nil, err
		}
		return parseBookText(decodeCP1252(raw))
	}
	return source, nil
}

func recordBookName(record []byte) string {
	name := record[:nameFieldSize]
	if nulIndex := bytes.IndexByte(name, 0); nulIndex >= 0 {
		name = name[:nulIndex]
	}
	return strings.TrimSpace(decodeCP1252(name))
}

func readEntitlement(data []byte, dirEnd int) (string, error) {
	if dirEnd+4 > len(data) {
		return "", fmt.Errorf("entitlement block out of range")
	}
	length := int(binary.LittleEndian.Uint32(data[dirEnd : dirEnd+4]))
	if length <= 0 || length > entitlementLimit || dirEnd+4+length > len(data) {
		return "", fmt.Errorf("entitlement length out of range")
	}
	inflated, err := inflate(data[dirEnd+4 : dirEnd+4+length])
	if err != nil {
		return "", fmt.Errorf("entitlement: %w", err)
	}
	entitlement := strings.TrimSpace(decodeCP1252(inflated))
	if entitlement == "" {
		return "", fmt.Errorf("entitlement is empty")
	}
	return entitlement, nil
}

func abbreviationFromEntitlement(entitlement string) string {
	for _, prefix := range []string{"ezFree", "ezPaid"} {
		if strings.HasPrefix(entitlement, prefix) {
			return strings.TrimSpace(entitlement[len(prefix):])
		}
	}
	return strings.TrimSpace(entitlement)
}

func inflate(compressed []byte) ([]byte, error) {
	return inflateReader(bytes.NewReader(compressed))
}

func inflateReader(compressed io.Reader) ([]byte, error) {
	reader, err := zlib.NewReader(compressed)
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	out, err := io.ReadAll(io.LimitReader(reader, maxInflatedBook+1))
	if err != nil {
		return nil, err
	}
	if len(out) > maxInflatedBook {
		return nil, fmt.Errorf("inflated content exceeds %d bytes", int(maxInflatedBook))
	}
	return out, nil
}

// parseBookText splits inflated book text into chapters and verses. Blocks
// are separated by blank lines; each begins "chapter:verse " or
// "chapter:first-last " for verses the translator combined.
func parseBookText(text string) ([]Chapter, error) {
	chaptersByNumber := map[int]*Chapter{}
	order := []int{}

	for _, block := range strings.Split(text, "\r\n\r\n") {
		block = strings.Trim(block, "\r\n ")
		if block == "" {
			continue
		}
		match := verseLine.FindStringSubmatch(block)
		if match == nil {
			// Real translations occasionally carry unnumbered editorial
			// blocks; they are not verse text, so skip them.
			continue
		}
		chapterNumber, _ := strconv.Atoi(match[1])
		verseNumber, _ := strconv.Atoi(match[2])
		endNumber := 0
		if match[3] != "" {
			endNumber, _ = strconv.Atoi(match[3])
			if endNumber <= verseNumber {
				endNumber = 0
			}
		}
		if chapterNumber < 1 || verseNumber < 1 {
			continue
		}
		verseText := normalizeVerseText(block[len(match[0]):])
		if verseText == "" {
			continue
		}
		chapter, ok := chaptersByNumber[chapterNumber]
		if !ok {
			chapter = &Chapter{Number: chapterNumber}
			chaptersByNumber[chapterNumber] = chapter
			order = append(order, chapterNumber)
		}
		chapter.Verses = append(chapter.Verses, Verse{
			Number:    verseNumber,
			EndNumber: endNumber,
			Text:      verseText,
		})
	}

	chapters := make([]Chapter, 0, len(order))
	for _, number := range order {
		chapters = append(chapters, *chaptersByNumber[number])
	}
	return chapters, nil
}

func normalizeVerseText(text string) string {
	text = strings.ReplaceAll(text, "\r\n", " ")
	return strings.Join(strings.Fields(text), " ")
}

// cp1252High maps bytes 0x80-0x9F, where Windows-1252 differs from Latin-1.
var cp1252High = [32]rune{
	0x20AC, 0xFFFD, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,
	0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0xFFFD, 0x017D, 0xFFFD,
	0xFFFD, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
	0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0xFFFD, 0x017E, 0x0178,
}

func decodeCP1252(data []byte) string {
	var builder strings.Builder
	builder.Grow(len(data))
	for _, b := range data {
		switch {
		case b < 0x80:
			builder.WriteByte(b)
		case b < 0xA0:
			builder.WriteRune(cp1252High[b-0x80])
		default:
			builder.WriteRune(rune(b))
		}
	}
	return builder.String()
}
