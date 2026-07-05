package main

import (
	"database/sql"
	"testing"
)

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
