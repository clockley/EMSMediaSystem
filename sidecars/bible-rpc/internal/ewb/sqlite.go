package ewb

import (
	"database/sql"
	"encoding/binary"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	_ "modernc.org/sqlite"
)

const sqliteMagic = "SQLite format 3\x00"

// SQLite needs random access to a file. Only the raw-byte API needs a
// temporary image. Startup opens the installed file directly.
func parseSQLite(data []byte) (*Bible, error) {
	file, err := os.CreateTemp("", "ems-bible-*.ewb")
	if err != nil {
		return nil, err
	}
	defer os.Remove(file.Name())
	_, err = file.Write(data)
	closeErr := file.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	bible, err := ParseFile(file.Name())
	if err == nil {
		bible.Path = ""
	}
	return bible, err
}

func openSQLiteSource(path string) (*Source, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	// A Windows drive letter belongs in the URI path (file:///C:/...).
	slashPath := filepath.ToSlash(abs)
	if !strings.HasPrefix(slashPath, "/") {
		slashPath = "/" + slashPath
	}
	uri := url.URL{Scheme: "file", Path: slashPath, RawQuery: "mode=ro&immutable=1&_pragma=trusted_schema(0)"}
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return nil, err
	}
	// Share the same immutable file handle. Each worker releases the SQL
	// connection after reading its BLOBs, before inflating or searching them.
	db.SetMaxOpenConns(1)
	source, err := sqliteCatalog(db)
	if err != nil {
		db.Close()
		return nil, err
	}
	source.closer = db
	return source, nil
}

func sqliteCatalog(db *sql.DB) (*Source, error) {

	// Only query stored tables. A view or virtual table with a familiar
	// name is not an EasyWorship book source.
	var tables int
	err := db.QueryRow(`SELECT count(*) FROM sqlite_schema WHERE type='table'
		AND rootpage > 0 AND name IN ('header', 'books', 'streams')`).Scan(&tables)
	if err != nil {
		return nil, fmt.Errorf("SQLite Bible schema: %w", err)
	}
	if tables != 3 {
		return nil, fmt.Errorf("missing EasyWorship header, books or streams table")
	}
	var format, translation int
	bible := &Bible{}
	err = db.QueryRow(`SELECT format_version, id, name, abbrev_name, lang_code FROM header LIMIT 1`).
		Scan(&format, &translation, &bible.Name, &bible.Abbreviation, &bible.Language)
	if err != nil {
		return nil, fmt.Errorf("EasyWorship header: %w", err)
	}
	if format != 1 {
		return nil, fmt.Errorf("unsupported EasyWorship SQLite format version %d", format)
	}
	if translation < 0 || translation > 127 {
		return nil, fmt.Errorf("invalid EasyWorship translation ID %d", translation)
	}

	rows, err := db.Query(`SELECT rowid, name FROM books ORDER BY rowid`)
	if err != nil {
		return nil, fmt.Errorf("EasyWorship books: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var book Book
		if err := rows.Scan(&book.ID, &book.Name); err != nil {
			return nil, err
		}
		if book.ID < 1 || book.ID > maxBooks {
			return nil, fmt.Errorf("unsupported EasyWorship book ID %d", book.ID)
		}
		bible.Books = append(bible.Books, book)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	source := &Source{Bible: *bible}
	source.readBook = func(id int) ([]Chapter, error) {
		var index, stream []byte
		err := db.QueryRow(`SELECT b.verse_info, s.stream FROM books b JOIN streams s ON s.rowid=b.rowid WHERE b.rowid=?`, id).Scan(&index, &stream)
		if err != nil {
			return nil, err
		}
		return sqliteChapters(translation, id, index, stream)
	}
	return source, nil
}

type verseIndexRecord struct {
	length, offset    int // UTF-16 code units in the book text
	additionalVerses  int // number of verses following the first in this text span
	verse, chapter    int
	book, translation int
}

// decodeVerseIndex reads one SQLite v1 verse_info record. Fields are packed
// consecutively from the least significant bit of the little-endian word.
func decodeVerseIndex(record [8]byte) verseIndexRecord {
	remaining := binary.LittleEndian.Uint64(record[:])
	take := func(width uint) int {
		value := remaining & ((uint64(1) << width) - 1)
		remaining >>= width
		return int(value)
	}
	return verseIndexRecord{
		length:           take(10),
		offset:           take(19),
		additionalVerses: take(5),
		verse:            take(8),
		chapter:          take(8),
		book:             take(7),
		translation:      take(7),
	}
}

func sqliteChapters(translation, bookID int, index, stream []byte) ([]Chapter, error) {
	if len(index) == 0 || len(index)%8 != 0 || len(index)/8 > 255*255 {
		return nil, fmt.Errorf("invalid verse_info size %d", len(index))
	}
	raw, err := inflate(stream)
	if err != nil {
		return nil, fmt.Errorf("book stream: %w", err)
	}
	// The first two bytes precede the UTF-8 scripture. Index offsets and
	// lengths count UTF-16 code units in the decoded text.
	if len(raw) < 2 || !utf8.Valid(raw[2:]) {
		return nil, fmt.Errorf("invalid UTF-8 book stream")
	}
	units := utf16.Encode([]rune(string(raw[2:])))
	var chapters []Chapter
	var lastChapter, lastVerse, lastEnd int
	for len(index) != 0 {
		entry := decodeVerseIndex([8]byte(index))
		index = index[8:]
		offset := entry.offset
		end := offset + entry.length
		number, chapter := entry.verse, entry.chapter
		lastInRange := number + entry.additionalVerses
		// Some HCSB editions mistag 2 Samuel 24:9 as 2:9. Recover a
		// backwards chapter only when both neighbors establish its place.
		if chapter > 0 && chapter < lastChapter && number == lastVerse+1 && len(index) >= 8 {
			next := decodeVerseIndex([8]byte(index))
			if next.chapter == lastChapter && next.verse == lastInRange+1 {
				chapter = lastChapter
			}
		}
		if entry.translation != translation || entry.book != bookID ||
			chapter == 0 || number == 0 || lastInRange > 255 ||
			chapter < lastChapter || (chapter == lastChapter && number <= lastVerse) {
			return nil, fmt.Errorf("invalid verse reference %d:%d", chapter, number)
		}
		if offset < lastEnd || end > len(units) || end == offset ||
			units[offset]&0xfc00 == 0xdc00 || units[end-1]&0xfc00 == 0xd800 {
			return nil, fmt.Errorf("invalid text range for %d:%d", chapter, number)
		}
		verse := Verse{Number: number, Text: strings.TrimSpace(string(utf16.Decode(units[offset:end])))}
		if entry.additionalVerses > 0 {
			verse.EndNumber = lastInRange
		}
		if chapter != lastChapter {
			chapters = append(chapters, Chapter{Number: chapter})
		}
		current := &chapters[len(chapters)-1]
		current.Verses = append(current.Verses, verse)
		lastChapter, lastVerse, lastEnd = chapter, lastInRange, end
	}
	return chapters, nil
}
