package ewb

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func deflate(t *testing.T, text string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zlib.NewWriter(&buffer)
	if _, err := writer.Write([]byte(text)); err != nil {
		t.Fatalf("compress: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("compress close: %v", err)
	}
	return buffer.Bytes()
}

type testBook struct {
	index int
	name  string
	text  string
}

// buildTestEWB assembles a structurally valid legacy EasyWorship Bible file.
func buildTestEWB(t *testing.T, entitlement string, books []testBook) []byte {
	t.Helper()
	dirEnd := directoryStart + maxBooks*recordSize
	entStream := deflate(t, entitlement)

	streams := map[int][]byte{}
	offset := dirEnd + 4 + len(entStream)
	type placed struct{ offset, length int }
	placements := map[int]placed{}
	for _, book := range books {
		stream := deflate(t, book.text)
		// Real files append a ten-byte proprietary tail that inflaters
		// never consume; include one to prove it is harmless.
		stream = append(stream, 'Q', 'K', 3, 4, 0, 0, 0, 0, 8, 0)
		streams[book.index] = stream
		placements[book.index] = placed{offset: offset, length: len(stream)}
		offset += len(stream)
	}

	data := make([]byte, offset, offset+16)
	copy(data, headerMagic)
	data[0x16] = 0x1A
	data[0x17] = 0x02
	binary.LittleEndian.PutUint32(data[0x18:], 60)
	binary.LittleEndian.PutUint32(data[0x1C:], recordSize)
	for _, book := range books {
		record := data[directoryStart+book.index*recordSize:]
		copy(record[:nameFieldSize], " "+book.name)
		place := placements[book.index]
		binary.LittleEndian.PutUint64(record[streamOffsetOff:], uint64(place.offset))
		binary.LittleEndian.PutUint64(record[streamLengthOff:], uint64(place.length))
	}
	binary.LittleEndian.PutUint32(data[dirEnd:], uint32(len(entStream)))
	copy(data[dirEnd+4:], entStream)
	for _, book := range books {
		place := placements[book.index]
		copy(data[place.offset:], streams[book.index])
	}
	trailer := make([]byte, 16)
	binary.LittleEndian.PutUint64(trailer, uint64(dirEnd))
	copy(trailer[8:], trailerMagic)
	return append(data, trailer...)
}

func TestParseSyntheticBible(t *testing.T) {
	genesis := "1:1 In the beginning God created the heavens and the earth.\r\n\r\n" +
		"1:2 And the earth was waste and empty.\r\n\r\n" +
		"2:1 And the heavens and the earth were finished.\r\n\r\n" +
		"3:5-6 Combined verse text spanning two numbers.\r\n\r\n" +
		"Editorial note without a verse reference.\r\n\r\n" +
		"3:7 It\x92s a cp1252 apostrophe.\r\n\r\n"
	john := "1:1 En el principio era el Verbo.\r\n\r\n"
	data := buildTestEWB(t, "ezFreeTEST", []testBook{
		{index: 0, name: "Genesis", text: genesis},
		{index: 42, name: "Juan", text: john},
	})

	bible, err := Parse(data)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if bible.Abbreviation != "TEST" {
		t.Fatalf("Abbreviation = %q, want TEST", bible.Abbreviation)
	}
	if !bible.Free {
		t.Fatalf("Free = false, want true")
	}
	if len(bible.Books) != 2 {
		t.Fatalf("len(Books) = %d, want 2", len(bible.Books))
	}

	first := bible.Books[0]
	if first.ID != 1 || first.Name != "Genesis" {
		t.Fatalf("book 1 = %+v", first)
	}
	if len(first.Chapters) != 3 {
		t.Fatalf("Genesis chapters = %d, want 3", len(first.Chapters))
	}
	if got := first.Chapters[0].Verses[0].Text; got != "In the beginning God created the heavens and the earth." {
		t.Fatalf("Genesis 1:1 = %q", got)
	}
	ranged := first.Chapters[2].Verses[0]
	if ranged.Number != 5 || ranged.EndNumber != 6 {
		t.Fatalf("range verse = %+v", ranged)
	}
	apostrophe := first.Chapters[2].Verses[1]
	if apostrophe.Number != 7 || apostrophe.Text != "It\u2019s a cp1252 apostrophe." {
		t.Fatalf("cp1252 verse = %+v", apostrophe)
	}

	second := bible.Books[1]
	if second.ID != 43 || second.Name != "Juan" {
		t.Fatalf("book 43 = ID %d name %q", second.ID, second.Name)
	}
}

func TestParseRejectsDamagedFiles(t *testing.T) {
	valid := buildTestEWB(t, "ezPaidX", []testBook{{index: 0, name: "Genesis", text: "1:1 Text.\r\n\r\n"}})

	cases := map[string]func([]byte) []byte{
		"short file":    func(data []byte) []byte { return data[:40] },
		"wrong magic":   func(data []byte) []byte { out := append([]byte{}, data...); out[0] = 'X'; return out },
		"wrong trailer": func(data []byte) []byte { out := append([]byte{}, data...); out[len(out)-1] = 'X'; return out },
		"directory pointer out of range": func(data []byte) []byte {
			out := append([]byte{}, data...)
			binary.LittleEndian.PutUint64(out[len(out)-16:], uint64(len(out)+1024))
			return out
		},
		"stream beyond file": func(data []byte) []byte {
			out := append([]byte{}, data...)
			record := out[directoryStart:]
			binary.LittleEndian.PutUint64(record[streamLengthOff:], uint64(len(out)*2))
			return out
		},
	}
	for name, mutate := range cases {
		if _, err := Parse(mutate(valid)); err == nil {
			t.Fatalf("Parse() accepted damaged input: %s", name)
		}
	}
}

func TestParseFileReadsInPlace(t *testing.T) {
	data := buildTestEWB(t, "ezFreeFILE", []testBook{{index: 0, name: "Genesis", text: "1:1 Alpha.\r\n\r\n"}})
	path := filepath.Join(t.TempDir(), "file.ewb")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	before, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat fixture: %v", err)
	}

	bible, err := ParseFile(path)
	if err != nil {
		t.Fatalf("ParseFile() error = %v", err)
	}
	if bible.Path != path {
		t.Fatalf("Path = %q, want %q", bible.Path, path)
	}

	after, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat fixture after parse: %v", err)
	}
	if after.Size() != before.Size() || !after.ModTime().Equal(before.ModTime()) {
		t.Fatalf("source file was modified by ParseFile")
	}
}

// TestParseRealCorpus validates the parser against locally available real
// EasyWorship Bible files when EMS_TEST_EWB_CORPUS points at a directory.
// Real translations are licensed and are never committed to the repository.
func TestParseRealCorpus(t *testing.T) {
	corpus := os.Getenv("EMS_TEST_EWB_CORPUS")
	if corpus == "" {
		t.Skip("EMS_TEST_EWB_CORPUS not set")
	}
	entries, err := os.ReadDir(corpus)
	if err != nil {
		t.Fatalf("read corpus: %v", err)
	}
	parsed := 0
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".ewb" {
			continue
		}
		path := filepath.Join(corpus, entry.Name())
		bible, err := ParseFile(path)
		if err != nil {
			t.Errorf("%s: %v", entry.Name(), err)
			continue
		}
		if bible.Abbreviation == "" {
			t.Errorf("%s: empty abbreviation", entry.Name())
		}
		if len(bible.Books) == 0 {
			t.Errorf("%s: no books", entry.Name())
		}
		verses := 0
		for _, book := range bible.Books {
			for _, chapter := range book.Chapters {
				verses += len(chapter.Verses)
			}
		}
		if verses < 1000 {
			t.Errorf("%s: only %d verses parsed", entry.Name(), verses)
		}
		parsed++
	}
	if parsed == 0 {
		t.Fatalf("no .ewb files found in %s", corpus)
	}
	t.Logf("parsed %d real EasyWorship Bibles", parsed)
}

func TestVisitBooksBoundsParallelDecoding(t *testing.T) {
	limit := cap(bookWorkers)
	books := make([]Book, 2*limit)
	for i := range books {
		books[i].ID = i + 1
	}
	entered := make(chan struct{}, len(books))
	release := make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	defer unblock()
	var active atomic.Int32
	source := Source{readBook: func(id int) ([]Chapter, error) {
		count := active.Add(1)
		defer active.Add(-1)
		if int(count) > limit {
			t.Errorf("active book decodes = %d, limit %d", count, limit)
		}
		entered <- struct{}{}
		<-release
		return []Chapter{{Number: id}}, nil
	}}
	done := make(chan error, 1)
	seen := make([]int, len(books))
	go func() {
		done <- source.VisitBooks(books, func(index int, chapters []Chapter) error {
			seen[index] = chapters[0].Number
			return nil
		})
	}()
	deadline := time.After(5 * time.Second)
	for i := 0; i < limit; i++ {
		select {
		case <-entered:
		case <-deadline:
			t.Fatal("book decodes did not start concurrently")
		}
	}
	unblock()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	for i, book := range books {
		if seen[i] != book.ID {
			t.Fatalf("book %d returned at index %d, expected %d", seen[i], i, book.ID)
		}
	}
}
