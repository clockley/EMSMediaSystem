package ewb

import (
	"bytes"
	"database/sql"
	"encoding/binary"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func testVerseIndex(chapter, verse, extra, offset, length int) []byte {
	const translation, book = 36, 10
	entry := uint64(translation)<<57 | uint64(book)<<50 | uint64(chapter)<<42 |
		uint64(verse)<<34 | uint64(extra)<<29 | uint64(offset)<<10 | uint64(length)
	return binary.LittleEndian.AppendUint64(nil, entry)
}

func TestDecodeVerseIndex(t *testing.T) {
	// A synthetic record with distinct values in every field, supplied as
	// file bytes so a change to the fixture encoder cannot mask a regression.
	record := [8]byte{0xc3, 0xa5, 0x5a, 0xd8, 0x34, 0x12, 0x78, 0x56}
	want := verseIndexRecord{
		length: 451, offset: 399017, additionalVerses: 6,
		verse: 141, chapter: 4, book: 30, translation: 43,
	}
	if got := decodeVerseIndex(record); got != want {
		t.Fatalf("decodeVerseIndex(%x) = %+v, want %+v", record, got, want)
	}
}

func TestSQLiteBible(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Test #1.ewb")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`
		CREATE TABLE header (format_version INTEGER, id INTEGER, name TEXT, abbrev_name TEXT, lang_code TEXT);
		CREATE TABLE books (name TEXT, verse_info BLOB);
		CREATE TABLE streams (stream BLOB);
		INSERT INTO header VALUES (1, 36, 'Test Bible', 'TST', 'ES');`)
	if err != nil {
		t.Fatal(err)
	}

	// Offsets in the file count the accent as one unit and the dove as two.
	index := testVerseIndex(2, 9, 0, 0, 6)
	index = append(index, testVerseIndex(24, 8, 0, 6, 4)...)
	index = append(index, testVerseIndex(2, 9, 0, 10, 6)...) // observed HCSB chapter typo
	index = append(index, testVerseIndex(24, 10, 1, 16, 3)...)
	if _, err := db.Exec("INSERT INTO books(rowid,name,verse_info) VALUES (10,'Samuel',?)", index); err != nil {
		t.Fatal(err)
	}
	stream := deflate(t, "\x00\x24Crió. 🕊. Nueve.Fin")
	if _, err := db.Exec("INSERT INTO streams(rowid,stream) VALUES (10,?)", stream); err != nil {
		t.Fatal(err)
	}
	// A v1 header without notice columns remains readable.
	sourceWithoutNotices, err := sqliteCatalog(db)
	if err != nil {
		t.Fatal(err)
	}
	if sourceWithoutNotices.Copyright != "" || sourceWithoutNotices.License != "" {
		t.Fatal("unexpected publisher notices in minimal header")
	}
	if _, err := db.Exec(`ALTER TABLE header ADD COLUMN copyright TEXT;
		ALTER TABLE header ADD COLUMN license TEXT;`); err != nil {
		t.Fatal(err)
	}
	const richNotice = `{\rtf1\ansi\ansicpg1252{\fonttbl{\f0 Courier;}}\f0 \'a9 Press\par A second line}`
	if _, err := db.Exec(`UPDATE header SET copyright=?, license=?`, richNotice, "Terms in plain text."); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	source, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	if counts := source.VerseCounts[10]; len(counts) != 24 || counts[23] != 3 || len(source.Books[0].Chapters) != 0 {
		t.Fatal("expected only chapter counts in the open plugin catalog")
	}
	chapters, err := source.ReadBook(10)
	if err != nil || chapters[1].Verses[1].Text != "Nueve." {
		t.Fatalf("direct book read = %v, %v", chapters, err)
	}
	fromFile, err := ParseFile(path)
	if err != nil {
		t.Fatal(err)
	}
	fromBytes, err := Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	if fromFile.Path != path {
		t.Fatalf("Path = %q, want %q", fromFile.Path, path)
	}
	fromFile.Path = ""
	want := &Bible{
		Name: "Test Bible", Abbreviation: "TST", Language: "ES",
		Copyright: "© Press\nA second line", License: "Terms in plain text.",
		Books: []Book{{ID: 10, Name: "Samuel", Chapters: []Chapter{
			{Number: 2, Verses: []Verse{{Number: 9, Text: "Crió."}}},
			{Number: 24, Verses: []Verse{
				{Number: 8, Text: "🕊."}, {Number: 9, Text: "Nueve."}, {Number: 10, EndNumber: 11, Text: "Fin"},
			}},
		}}},
	}
	if !reflect.DeepEqual(fromFile, want) || !reflect.DeepEqual(fromBytes, want) {
		t.Fatalf("file = %+v, bytes = %+v, want %+v", fromFile, fromBytes, want)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(after, data) {
		t.Fatalf("source changed or could not be read: %v", err)
	}
}

func TestSQLiteRejectsOtherFormats(t *testing.T) {
	path := filepath.Join(t.TempDir(), "unknown.ewb")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, test := range []struct{ name, setup, reason string }{
		{"unrelated SQLite database", "CREATE TABLE notes (text TEXT)", "missing EasyWorship"},
		{"unknown plugin version", `
			CREATE TABLE books (name TEXT, verse_info BLOB);
			CREATE TABLE streams (stream BLOB);
			CREATE TABLE header AS SELECT 2 AS format_version, 1 AS id, 'Test' AS name, 'TST' AS abbrev_name, 'EN' AS lang_code;`, "format version 2"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := db.Exec(test.setup); err != nil {
				t.Fatal(err)
			}
			if _, err := ParseFile(path); err == nil || !strings.Contains(err.Error(), test.reason) {
				t.Fatalf("error = %v, want %q", err, test.reason)
			}
		})
	}
}

func TestSQLiteRejectsInvalidBookData(t *testing.T) {
	stream := deflate(t, "\x00\x24🕊.")
	valid := testVerseIndex(1, 1, 0, 0, 3)
	for _, tc := range []struct {
		name          string
		index, stream []byte
	}{
		{"truncated index", valid[:7], stream},
		{"invalid reference", testVerseIndex(0, 1, 0, 0, 3), stream},
		{"offset beyond text", testVerseIndex(1, 1, 0, 100, 1), stream},
		{"split surrogate pair", testVerseIndex(1, 1, 0, 0, 1), stream},
		{"corrupt stream", valid, []byte("invalid")},
		{"missing stream", valid, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := sqliteChapters(36, 10, tc.index, tc.stream); err == nil {
				t.Fatal("accepted damaged SQLite Bible book")
			}
		})
	}
}
