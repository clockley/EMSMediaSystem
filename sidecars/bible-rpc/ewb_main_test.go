package main

import (
	"bytes"
	"compress/zlib"
	"database/sql"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"emsmediasystem/bible-rpc/internal/biblestore"
)

func deflateEWB(t *testing.T, text string) []byte {
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

type ewbTestBook struct {
	index int
	name  string
	text  string
}

// buildEWBFixture assembles a structurally valid legacy EasyWorship Bible
// file, mirroring the layout the internal/ewb parser expects.
func buildEWBFixture(t *testing.T, entitlement string, books []ewbTestBook) []byte {
	t.Helper()
	const (
		directoryStart  = 0x58
		recordSize      = 224
		nameFieldSize   = 48
		streamOffsetOff = 208
		streamLengthOff = 216
		maxBooks        = 66
	)
	dirEnd := directoryStart + maxBooks*recordSize
	entStream := deflateEWB(t, entitlement)

	streams := map[int][]byte{}
	offset := dirEnd + 4 + len(entStream)
	type placed struct{ offset, length int }
	placements := map[int]placed{}
	for _, book := range books {
		stream := append(deflateEWB(t, book.text), 'Q', 'K', 3, 4, 0, 0, 0, 0, 8, 0)
		streams[book.index] = stream
		placements[book.index] = placed{offset: offset, length: len(stream)}
		offset += len(stream)
	}

	data := make([]byte, offset, offset+16)
	copy(data, "EasyWorship Bible Text")
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
	copy(trailer[8:], "ezwBible")
	return append(data, trailer...)
}

func swapEWBGlobals(t *testing.T) {
	t.Helper()
	oldDB := db
	oldEWBBookNames := ewbBookNames
	oldEWBBookAliases := ewbBookAliases
	oldEWBBookAliasKeys := ewbBookAliasKeys
	oldVersions := cachedVersions
	oldBooks := cachedBooks
	oldBookDetails := cachedBookDetails
	oldBookOrder := cachedBookOrder
	oldAliases := cachedAliases
	oldAliasKeys := cachedAliasKeys
	oldMetadata := cachedBookMetadataByVersion
	t.Cleanup(func() {
		for key, version := range cachedVersions {
			if version.ewbSource != nil && version.ewbSource != oldVersions[key].ewbSource {
				version.ewbSource.Close()
			}
		}
		db = oldDB
		ewbBookNames = oldEWBBookNames
		ewbBookAliases = oldEWBBookAliases
		ewbBookAliasKeys = oldEWBBookAliasKeys
		cachedVersions = oldVersions
		cachedBooks = oldBooks
		cachedBookDetails = oldBookDetails
		cachedBookOrder = oldBookOrder
		cachedAliases = oldAliases
		cachedAliasKeys = oldAliasKeys
		cachedBookMetadataByVersion = oldMetadata
	})
}

func openFixtureDatabase() (*sql.DB, error) {
	overlay, err := sql.Open(sqliteDriverName, ":memory:")
	if err != nil {
		return nil, err
	}
	overlay.SetMaxOpenConns(1)
	statements := []string{
		fmt.Sprintf(`CREATE TABLE %s (
			rowid INTEGER PRIMARY KEY,
			version TEXT NOT NULL,
			table_name TEXT NOT NULL,
			b INTEGER NOT NULL,
			c INTEGER NOT NULL,
			v INTEGER NOT NULL,
			verse_id INTEGER NOT NULL
		)`, biblestore.LookupTable),
		fmt.Sprintf(`CREATE VIRTUAL TABLE %s USING fts5(
			t,
			content = '',
			tokenize = 'unicode61 remove_diacritics 2'
		)`, biblestore.FTSTable),
		fmt.Sprintf(`CREATE TABLE %s (
			table_name TEXT NOT NULL,
			b INTEGER NOT NULL,
			c INTEGER NOT NULL,
			verse_count INTEGER NOT NULL,
			t BLOB NOT NULL,
			PRIMARY KEY (table_name, b, c)
		)`, biblestore.ChapterTable),
	}
	for _, statement := range statements {
		if _, err := overlay.Exec(statement); err != nil {
			overlay.Close()
			return nil, err
		}
	}
	return overlay, nil
}

func insertFixtureVerse(t *testing.T, handle *sql.DB, rowid int64, version, tableName string, b, c, v int, text string) {
	t.Helper()
	compressed, err := biblestore.CompressChapterVerses([]biblestore.ChapterVerse{{Verse: v, Text: text}})
	if err != nil {
		t.Fatalf("CompressChapterVerses() error = %v", err)
	}
	if _, err := handle.Exec(
		fmt.Sprintf(`INSERT INTO %s (table_name, b, c, verse_count, t) VALUES (?, ?, ?, 1, ?)`, biblestore.ChapterTable),
		tableName, b, c, compressed,
	); err != nil {
		t.Fatalf("insert chapter fixture: %v", err)
	}
	if _, err := handle.Exec(
		fmt.Sprintf(`INSERT INTO %s (rowid, version, table_name, b, c, v, verse_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, biblestore.LookupTable),
		rowid, version, tableName, b, c, v, b*1_000_000+c*1_000+v,
	); err != nil {
		t.Fatalf("insert lookup fixture: %v", err)
	}
	if _, err := handle.Exec(
		fmt.Sprintf(`INSERT INTO %s (rowid, t) VALUES (?, ?)`, biblestore.FTSTable),
		rowid, text,
	); err != nil {
		t.Fatalf("insert fts fixture: %v", err)
	}
}

func TestLoadEWBBiblesServesInPlaceThroughBibleAPI(t *testing.T) {
	swapEWBGlobals(t)

	mainDB, err := openFixtureDatabase()
	if err != nil {
		t.Fatalf("open main fixture database: %v", err)
	}
	defer mainDB.Close()
	insertFixtureVerse(t, mainDB, 1, "KJV", "source_kjv", 1, 1, 1,
		"In the beginning God created the heaven and the earth.")

	genesis := BookMetadata{ID: 1, Name: "Genesis", Abbreviation: "Gen.", Testament: "Old Testament"}
	john := BookMetadata{ID: 43, Name: "John", Abbreviation: "John", Testament: "New Testament"}
	db = mainDB
	ewbBookNames = nil
	ewbBookAliases = nil
	ewbBookAliasKeys = nil
	cachedVersions = map[string]Version{
		"KJV": {
			Abbreviation: "KJV",
			Version:      "King James Version",
			TableName:    "source_kjv",
			Attribution:  BibleAttribution{Abbreviation: "KJV", Text: "KJV. Public Domain.", PublicDomain: true},
		},
	}
	cachedBooks = map[string]int{"Genesis": genesis.ID, "John": john.ID}
	cachedBookDetails = map[int]BookMetadata{genesis.ID: genesis, john.ID: john}
	cachedBookOrder = []BookMetadata{genesis, john}
	cachedAliases = map[string]string{"genesis": "Genesis", "gen": "Genesis", "john": "John"}
	cachedAliasKeys = []string{"genesis", "john", "gen"}
	cachedBookMetadataByVersion = make(map[string]BookMetadataResponse)

	directory := t.TempDir()
	testBible := buildEWBFixture(t, "ezFreeTST", []ewbTestBook{
		{index: 0, name: "Genesis", text: "1:1 In the beginning God created the heavens and the earth.\r\n\r\n1:2 Second verse text.\r\n\r\n"},
		{index: 42, name: "Juan", text: "1:1 In the beginning was the Word.\r\n\r\n2:1 Chapter two text.\r\n\r\n3:16 For God so loved the world.\r\n\r\n"},
	})
	duplicate := buildEWBFixture(t, "ezFreeKJV", []ewbTestBook{
		{index: 0, name: "Genesis", text: "1:1 Duplicate translation text.\r\n\r\n"},
	})
	broken := []byte("not an EasyWorship file")
	prefix := t.TempDir()
	t.Setenv("WINEPREFIX", prefix)
	plugins := filepath.Join(prefix, "drive_c", "ProgramData", "Softouch", "EasyWorship.v8", "Plugins", "Bibles")
	if err := os.MkdirAll(plugins, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("EMS_BIBLE_EWB_DIR", filepath.Join(directory, "broken.ewb"))
	otherBooks := []ewbTestBook{{index: 0, name: "Genesis", text: "1:1 Other translation."}}
	for name, contents := range map[string][]byte{
		filepath.Join(directory, "test.ewb"):       testBible,
		filepath.Join(directory, "broken.ewb"):     broken,
		filepath.Join(plugins, "another-copy.EWB"): buildEWBFixture(t, "ezFreeTST", otherBooks),
		filepath.Join(plugins, "dup.EWB"):          duplicate,
		filepath.Join(plugins, "pending.new"):      buildEWBFixture(t, "ezFreePENDING", otherBooks),
	} {
		if err := os.WriteFile(name, contents, 0o600); err != nil {
			t.Fatalf("write fixture %s: %v", name, err)
		}
	}

	loadEWBBibles(ewbSearchDirectories(directory, "linux")...)
	if len(cachedVersions) != 3 {
		t.Fatalf("versions = %v", cachedVersions)
	}

	version, ok := cachedVersions["TST"]
	if !ok {
		t.Fatalf("version TST not registered; versions = %v", cachedVersions)
	}
	if version.Source != ewbVersionSource {
		t.Fatalf("version.Source = %q, want %q", version.Source, ewbVersionSource)
	}
	if _, ok := cachedVersions["KJV-EW"]; !ok {
		t.Fatal("colliding version was not registered as KJV-EW")
	}
	ew := getPassageResult("KJV-EW", "Genesis 1:1")
	if ew.Error != "" || ew.Version != "KJV-EW" || ew.Text != "Duplicate translation text." ||
		ew.Attribution.Abbreviation != "KJV" || ew.Attribution.ShortText != "KJV" {
		t.Fatalf("EasyWorship passage or display attribution = %+v", ew)
	}

	passage := getPassageResult("TST", "John 3:16")
	if passage.Error != "" {
		t.Fatalf("getPassageResult(TST, John 3:16) error = %q", passage.Error)
	}
	if passage.Text != "For God so loved the world." {
		t.Fatalf("passage.Text = %q", passage.Text)
	}
	// Display strings use the translation's own book name even when the
	// input used the canonical English name.
	if passage.Book != "Juan" || passage.Reference != "Juan 3:16" {
		t.Fatalf("passage.Book = %q, passage.Reference = %q, want native Juan", passage.Book, passage.Reference)
	}

	// Localized book name from the .ewb file should resolve as an alias.
	aliased := getPassageResult("TST", "Juan 3:16")
	if aliased.Error != "" || aliased.BookID != 43 {
		t.Fatalf("getPassageResult(TST, Juan 3:16) = %+v", aliased)
	}

	// getText accepts the native book name the UI now round-trips.
	text := getTextResult("TST", "Juan", "3:16")
	if text.Error != "" {
		t.Fatalf("getTextResult(TST, Juan, 3:16) error = %q", text.Error)
	}

	// Book metadata shows the native name and keeps English as an alias.
	metadata := getBookMetadataResult("TST")
	if metadata.Error != "" {
		t.Fatalf("getBookMetadataResult(TST) error = %q", metadata.Error)
	}
	var johnMeta *BookMetadata
	for i := range metadata.Books {
		if metadata.Books[i].ID == 43 {
			johnMeta = &metadata.Books[i]
			break
		}
	}
	if johnMeta == nil {
		t.Fatal("getBookMetadataResult(TST) missing book 43")
	}
	if johnMeta.Name != "Juan" {
		t.Fatalf("metadata book name = %q, want Juan", johnMeta.Name)
	}
	hasEnglishAlias := false
	for _, alias := range johnMeta.Aliases {
		if alias == "john" {
			hasEnglishAlias = true
			break
		}
	}
	if !hasEnglishAlias {
		t.Fatalf("metadata aliases = %v, want english alias john", johnMeta.Aliases)
	}

	// Non-EWB versions keep canonical names.
	kjvMetadata := getBookMetadataResult("KJV")
	if kjvMetadata.Error != "" || len(kjvMetadata.Books) == 0 || kjvMetadata.Books[0].Name != "Genesis" {
		t.Fatalf("getBookMetadataResult(KJV) = %+v", kjvMetadata)
	}

	// The bundled version continues to resolve from the EMS database.
	kjv := getPassageResult("KJV", "Genesis 1:1")
	if kjv.Error != "" {
		t.Fatalf("getPassageResult(KJV, Genesis 1:1) error = %q", kjv.Error)
	}
	if kjv.Text != "In the beginning God created the heaven and the earth." {
		t.Fatalf("KJV passage.Text = %q", kjv.Text)
	}

	search := searchTextResult("TST", "beginning", SearchOptions{})
	if search.Error != "" {
		t.Fatalf("searchTextResult(TST) error = %q", search.Error)
	}
	if len(search.Results) == 0 {
		t.Fatal("searchTextResult(TST) returned no results")
	}
	for _, result := range search.Results {
		if result.Version != "TST" {
			t.Fatalf("searchTextResult(TST) returned result for version %q", result.Version)
		}
		if result.BookID == 43 && result.Book != "Juan" {
			t.Fatalf("search result Book = %q, want native Juan", result.Book)
		}
	}

	all := searchTextResult("ALL", "beginning", SearchOptions{})
	if all.Error != "" {
		t.Fatalf("searchTextResult(ALL) error = %q", all.Error)
	}
	found := map[string]bool{}
	for _, result := range all.Results {
		found[result.Version] = true
	}
	if !found["KJV"] || !found["TST"] {
		t.Fatalf("searchTextResult(ALL) versions = %v, want both KJV and TST", found)
	}
	for _, test := range []struct {
		query, mode string
		matches     int
	}{
		{"beginning created", "all", 1}, {"beginning world", "any", 3},
		{"the beg", "phrase", 2}, {`"the beg"`, "phrase", 0},
		{`"beginning was"`, "phrase", 1}, {"gód", "all", 2},
	} {
		got := searchTextResult("TST", test.query, SearchOptions{Mode: test.mode})
		if got.Error != "" || len(got.Results) != test.matches {
			t.Errorf("%s %q: got %d matches, error %q; want %d", test.mode, test.query, len(got.Results), got.Error, test.matches)
		}
	}
	// Closing the plugin makes both passage and search reads fail, while the
	// independent EMS FTS search still returns its verse.
	source := version.ewbSource
	for _, book := range source.Books {
		if len(book.Chapters) != 0 {
			t.Fatalf("catalog retained text for book %d", book.ID)
		}
	}
	if err := source.Close(); err != nil {
		t.Fatal(err)
	}
	if got := getPassageResult("TST", "Genesis 1:1"); got.Error == "" {
		t.Fatal("served a passage after its source was closed")
	}
	if got := searchTextResult("TST", "beginning", SearchOptions{}); got.Error == "" {
		t.Fatal("searched a closed plugin")
	}
	if got := searchTextResult("KJV", "beginning", SearchOptions{}); got.Error != "" || len(got.Results) != 1 {
		t.Fatalf("EMS FTS after plugin close: %+v", got)
	}

}

func TestLoadEWBBiblesMissingDirectoryIsHarmless(t *testing.T) {
	swapEWBGlobals(t)
	before := len(cachedVersions)
	loadEWBBibles(filepath.Join(t.TempDir(), "does-not-exist"))
	if len(cachedVersions) != before {
		t.Fatal("registered a Bible despite missing directory")
	}
}

func TestEWBSearchDirectories(t *testing.T) {
	root := t.TempDir()
	custom := filepath.Join(root, "church library")
	ems := filepath.Join(root, "ems", "easyworship")
	programData := filepath.Join(root, "shared data")
	t.Setenv("ProgramData", programData)
	t.Setenv("EMS_BIBLE_EWB_DIR", custom)
	dirs := ewbSearchDirectories(ems, "windows")
	wantFirst := []string{ems, custom, filepath.Join(programData, "Softouch", "EasyWorship.v8", "Plugins", "Bibles")}
	if len(dirs) < len(wantFirst) || !slices.Equal(dirs[:len(wantFirst)], wantFirst) {
		t.Fatalf("search directories = %v, want first %v", dirs, wantFirst)
	}

	t.Setenv("WINEPREFIX", "")
	t.Setenv("HOME", root)
	t.Setenv("USERPROFILE", root)
	dirs = ewbSearchDirectories(ems, "linux")
	wantWine := filepath.Join(root, ".wine", "drive_c", "ProgramData", "Softouch", "EasyWorship.v7", "Plugins", "Bibles")
	if !slices.Contains(dirs, wantWine) {
		t.Fatalf("search directories %v missing default Wine location %s", dirs, wantWine)
	}
}
