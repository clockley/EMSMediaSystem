package main

import (
	"database/sql"
	"testing"

	"emsmediasystem/bible-rpc/internal/biblestore"
)

func TestSuggestReferencesUsesOnlyBooksInSelectedVersion(t *testing.T) {
	testDB, err := sql.Open(sqliteDriverName, ":memory:")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	defer testDB.Close()
	compressed, err := biblestore.CompressChapterVerses([]biblestore.ChapterVerse{
		{Verse: 1, Text: "Test verse"},
	})
	if err != nil {
		t.Fatalf("CompressChapterVerses() error = %v", err)
	}

	if _, err := testDB.Exec(`
CREATE TABLE bible_chapter_text (
	table_name TEXT NOT NULL,
	b INTEGER NOT NULL,
	c INTEGER NOT NULL,
	verse_count INTEGER NOT NULL,
	t BLOB NOT NULL,
	PRIMARY KEY (table_name, b, c)
);
`); err != nil {
		t.Fatalf("create Bible suggestion fixture: %v", err)
	}
	for _, row := range []struct {
		tableName string
		bookID    int
	}{
		{tableName: "source_kjv", bookID: 2},
		{tableName: "source_kjva", bookID: 69},
	} {
		if _, err := testDB.Exec(
			`INSERT INTO bible_chapter_text (table_name, b, c, verse_count, t) VALUES (?, ?, 1, 1, ?)`,
			row.tableName,
			row.bookID,
			compressed,
		); err != nil {
			t.Fatalf("insert Bible suggestion fixture: %v", err)
		}
	}

	oldDB := db
	oldVersions := cachedVersions
	oldBooks := cachedBooks
	oldBookDetails := cachedBookDetails
	oldBookOrder := cachedBookOrder
	oldAliases := cachedAliases
	oldAliasKeys := cachedAliasKeys
	oldMetadata := cachedBookMetadataByVersion
	defer func() {
		db = oldDB
		cachedVersions = oldVersions
		cachedBooks = oldBooks
		cachedBookDetails = oldBookDetails
		cachedBookOrder = oldBookOrder
		cachedAliases = oldAliases
		cachedAliasKeys = oldAliasKeys
		cachedBookMetadataByVersion = oldMetadata
	}()

	exodus := BookMetadata{
		ID:           2,
		Name:         "Exodus",
		Abbreviation: "Exod.",
		Testament:    "Old Testament",
	}
	tobit := BookMetadata{ID: 69, Name: "Tobit", Testament: "Apocrypha"}
	db = testDB
	cachedVersions = map[string]Version{
		"KJV":  {Abbreviation: "KJV", Version: "King James Version", TableName: "source_kjv"},
		"KJVA": {Abbreviation: "KJVA", Version: "King James Apocrypha", TableName: "source_kjva"},
	}
	cachedBooks = map[string]int{"Exodus": exodus.ID, "Tobit": tobit.ID}
	cachedBookDetails = map[int]BookMetadata{exodus.ID: exodus, tobit.ID: tobit}
	cachedBookOrder = []BookMetadata{exodus, tobit}
	cachedAliases = map[string]string{
		"ex": "Exodus", "exo": "Exodus", "exodus": "Exodus",
		"tob": "Tobit", "tobit": "Tobit",
	}
	cachedAliasKeys = []string{"exodus", "tobit", "exo", "tob", "ex"}
	cachedBookMetadataByVersion = make(map[string]BookMetadataResponse)

	assertSuggestedBooks := func(version string, input string, wantBook string) {
		t.Helper()
		result := suggestReferencesResult(version, input)
		if result.Error != "" {
			t.Fatalf("suggestReferencesResult(%q, %q) error = %q", version, input, result.Error)
		}
		if len(result.Suggestions) == 0 {
			t.Fatalf("suggestReferencesResult(%q, %q) returned no suggestions", version, input)
		}
		for _, suggestion := range result.Suggestions {
			if suggestion.Book != wantBook {
				t.Fatalf("suggestReferencesResult(%q, %q) suggested unavailable book %q, want only %q", version, input, suggestion.Book, wantBook)
			}
		}
	}

	assertSuggestedBooks("KJV", "Exo", "Exodus")
	assertSuggestedBooks("KJVA", "Tob", "Tobit")

	result := suggestReferencesResult("KJVA", "Exo")
	if result.Error != "" {
		t.Fatalf("suggestReferencesResult(\"KJVA\", \"Exo\") error = %q", result.Error)
	}
	if len(result.Suggestions) != 0 {
		t.Fatalf("suggestReferencesResult(\"KJVA\", \"Exo\") suggestions = %#v, want none", result.Suggestions)
	}

	resolved, err := resolveReferenceData(testDB, "KJV", "Exodus 1:1")
	if err != nil {
		t.Fatalf("resolveReferenceData() error = %v", err)
	}
	if resolved.BookAbbreviation != exodus.Abbreviation {
		t.Fatalf(
			"resolveReferenceData().BookAbbreviation = %q, want %q",
			resolved.BookAbbreviation,
			exodus.Abbreviation,
		)
	}
}

func TestFTSSearchQueryPhraseUsesFinalTokenPrefix(t *testing.T) {
	query, err := ftsSearchQuery("Remember the sabbat", "phrase")
	if err != nil {
		t.Fatalf("ftsSearchQuery returned error: %v", err)
	}
	const want = `"remember" + "the" + "sabbat"*`
	if query != want {
		t.Fatalf("ftsSearchQuery() = %q, want %q", query, want)
	}
}

func TestFTSSearchQueryQuotedPhraseStaysExact(t *testing.T) {
	query, err := ftsSearchQuery(`"Remember the sabbat"`, "phrase")
	if err != nil {
		t.Fatalf("ftsSearchQuery returned error: %v", err)
	}
	const want = `"Remember the sabbat"`
	if query != want {
		t.Fatalf("ftsSearchQuery() = %q, want %q", query, want)
	}
}

func TestFTSSearchQueryPhraseRejectsEmptyInput(t *testing.T) {
	if _, err := ftsSearchQuery("   ", "phrase"); err == nil {
		t.Fatal("ftsSearchQuery() error = nil, want non-nil")
	}
}

func TestAttributionForPublicDomainVersion(t *testing.T) {
	version := Version{
		Abbreviation:  "KJV",
		Version:       "King James Version",
		Copyright:     "Public Domain",
		CopyrightInfo: "King James Version (KJV). Public Domain.",
	}
	attribution := attributionForVersion(version)
	if !attribution.PublicDomain {
		t.Fatal("attribution.PublicDomain = false, want true")
	}
	if attribution.Text != "King James Version (KJV). Public Domain." {
		t.Fatalf("attribution.Text = %q", attribution.Text)
	}
}

func TestValidateVersionAttributionsRejectsMissingCopyright(t *testing.T) {
	versions := map[string]Version{
		"TEST": {
			Abbreviation: "TEST",
			Version:      "Test Version",
			Attribution: BibleAttribution{
				Abbreviation: "TEST",
				Version:      "Test Version",
				Text:         "Test Version (TEST)",
				ShortText:    "TEST",
			},
		},
	}
	if err := validateVersionAttributions(versions); err == nil {
		t.Fatal("validateVersionAttributions() error = nil, want non-nil")
	}
}

func TestChapterCountsUseOptimizedChapterTable(t *testing.T) {
	db, err := sql.Open(sqliteDriverName, ":memory:")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	defer db.Close()

	if _, err := db.Exec(`
CREATE TABLE bible_chapter_text (
	table_name TEXT NOT NULL,
	b INTEGER NOT NULL,
	c INTEGER NOT NULL,
	verse_count INTEGER NOT NULL,
	t BLOB NOT NULL,
	PRIMARY KEY (table_name, b, c)
);
INSERT INTO bible_chapter_text (table_name, b, c, verse_count, t) VALUES
	('t_test', 1, 1, 31, x'00'),
	('t_test', 1, 2, 25, x'00'),
	('t_test', 2, 1, 22, x'00');
`); err != nil {
		t.Fatalf("create optimized chapter table: %v", err)
	}

	chapters, err := bookChapterCount(db, "t_test", 1)
	if err != nil {
		t.Fatalf("bookChapterCount() error = %v", err)
	}
	if chapters != 2 {
		t.Fatalf("bookChapterCount() = %d, want 2", chapters)
	}

	verses, err := chapterVerseCount(db, "t_test", 1, 2)
	if err != nil {
		t.Fatalf("chapterVerseCount() error = %v", err)
	}
	if verses != 25 {
		t.Fatalf("chapterVerseCount() = %d, want 25", verses)
	}
}

func TestFetchChapterVersesStripsBibleMarkup(t *testing.T) {
	db, err := sql.Open(sqliteDriverName, ":memory:")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	defer db.Close()

	compressed, err := biblestore.CompressChapterVerses([]biblestore.ChapterVerse{
		{
			Verse: 1,
			Text:  `In the beginning God{After "God," the Hebrew has the two letters "Aleph Tav" as a grammatical marker.} created the heavens and the earth.`,
		},
	})
	if err != nil {
		t.Fatalf("CompressChapterVerses() error = %v", err)
	}

	if _, err := db.Exec(`
CREATE TABLE bible_chapter_text (
	table_name TEXT NOT NULL,
	b INTEGER NOT NULL,
	c INTEGER NOT NULL,
	verse_count INTEGER NOT NULL,
	t BLOB NOT NULL,
	PRIMARY KEY (table_name, b, c)
);
INSERT INTO bible_chapter_text (table_name, b, c, verse_count, t) VALUES
	('t_test', 1, 1, 1, ?);
`, compressed); err != nil {
		t.Fatalf("create optimized chapter table: %v", err)
	}

	verses, err := fetchChapterVerses(db, "t_test", 1, 1)
	if err != nil {
		t.Fatalf("fetchChapterVerses() error = %v", err)
	}
	if len(verses) != 1 {
		t.Fatalf("fetchChapterVerses() length = %d, want 1", len(verses))
	}
	const want = "In the beginning God created the heavens and the earth."
	if verses[0].Text != want {
		t.Fatalf("fetchChapterVerses()[0].Text = %q, want %q", verses[0].Text, want)
	}
}

func TestOmittedVerseNumbersRemainAddressable(t *testing.T) {
	testDB, err := sql.Open(sqliteDriverName, ":memory:")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	defer testDB.Close()

	compressed, err := biblestore.CompressChapterVerses([]biblestore.ChapterVerse{
		{Verse: 36, Text: "Verse 36"},
		{Verse: 38, Text: "Verse 38"},
		{Verse: 39, Text: "Verse 39"},
		{Verse: 40, Text: "Verse 40"},
	})
	if err != nil {
		t.Fatalf("CompressChapterVerses() error = %v", err)
	}

	if _, err := testDB.Exec(`
CREATE TABLE bible_chapter_text (
	table_name TEXT NOT NULL,
	b INTEGER NOT NULL,
	c INTEGER NOT NULL,
	verse_count INTEGER NOT NULL,
	t BLOB NOT NULL,
	PRIMARY KEY (table_name, b, c)
);
`); err != nil {
		t.Fatalf("create optimized chapter table: %v", err)
	}
	for chapter := 1; chapter <= 8; chapter++ {
		if _, err := testDB.Exec(
			`INSERT INTO bible_chapter_text (table_name, b, c, verse_count, t) VALUES ('t_web', 44, ?, 4, ?)`,
			chapter,
			compressed,
		); err != nil {
			t.Fatalf("insert Acts %d fixture: %v", chapter, err)
		}
	}

	oldVersions := cachedVersions
	oldBooks := cachedBooks
	oldBookDetails := cachedBookDetails
	oldBookOrder := cachedBookOrder
	oldAliases := cachedAliases
	oldAliasKeys := cachedAliasKeys
	oldMetadata := cachedBookMetadataByVersion
	defer func() {
		cachedVersions = oldVersions
		cachedBooks = oldBooks
		cachedBookDetails = oldBookDetails
		cachedBookOrder = oldBookOrder
		cachedAliases = oldAliases
		cachedAliasKeys = oldAliasKeys
		cachedBookMetadataByVersion = oldMetadata
	}()

	acts := BookMetadata{ID: 44, Name: "Acts", Abbreviation: "Acts", Testament: "New Testament"}
	cachedVersions = map[string]Version{
		"WEB": {Abbreviation: "WEB", Version: "World English Bible", TableName: "t_web"},
	}
	cachedBooks = map[string]int{"Acts": acts.ID}
	cachedBookDetails = map[int]BookMetadata{acts.ID: acts}
	cachedBookOrder = []BookMetadata{acts}
	cachedAliases = map[string]string{"acts": "Acts"}
	cachedAliasKeys = []string{"acts"}
	cachedBookMetadataByVersion = make(map[string]BookMetadataResponse)

	chapter, err := fetchText(testDB, "WEB", "Acts", acts.ID, "8")
	if err != nil {
		t.Fatalf("fetchText() error = %v", err)
	}
	if len(chapter.VerseRows) != 4 || chapter.VerseRows[1].Verse != 38 || chapter.VerseRows[3].Verse != 40 {
		t.Fatalf("fetchText().VerseRows = %#v, want source verse numbers 36, 38, 39, 40", chapter.VerseRows)
	}
	if len(chapter.Verses) != 4 || chapter.Verses[1] != "Verse 38" {
		t.Fatalf("fetchText().Verses = %#v, want compatible text array", chapter.Verses)
	}

	resolved, err := resolveReferenceData(testDB, "WEB", "Acts 8:40")
	if err != nil {
		t.Fatalf("resolveReferenceData(Acts 8:40) error = %v", err)
	}
	if resolved.Reference != "Acts 8:40" || len(resolved.SelectedVerses) != 1 || resolved.SelectedVerses[0] != 40 {
		t.Fatalf("resolveReferenceData(Acts 8:40) = %#v", resolved)
	}

	if _, err := resolveReferenceData(testDB, "WEB", "Acts 8:37"); err == nil {
		t.Fatal("resolveReferenceData(Acts 8:37) error = nil, want omitted verse error")
	}
}
