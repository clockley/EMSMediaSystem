package main

import (
	"database/sql"
	"testing"

	"emsmediasystem/bible-rpc/internal/biblestore"
)

func TestOptimizeBibleDBBuildsLookupFTSAndCompressedChapters(t *testing.T) {
	db, err := sql.Open(sqliteDriverName, ":memory:")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	defer db.Close()

	execSQL(t, db, `
CREATE TABLE bible_version_key (
	id INTEGER NOT NULL,
	"table" TEXT NOT NULL,
	abbreviation TEXT NOT NULL
);
INSERT INTO bible_version_key (id, "table", abbreviation) VALUES
	(1, 't_one', 'ONE'),
	(2, 't_two', 'TWO');

CREATE TABLE t_one (
	id INTEGER NOT NULL,
	b INTEGER NOT NULL,
	c INTEGER NOT NULL,
	v INTEGER NOT NULL,
	t TEXT NOT NULL,
	PRIMARY KEY (id)
);
INSERT INTO t_one (id, b, c, v, t) VALUES
	(1001001, 1, 1, 1, 'In the beginning God{After God, the Hebrew has a grammatical marker.} created'),
	(1001002, 1, 1, 2, 'Let there be light'),
	(1002001, 1, 2, 1, 'A second chapter');

CREATE TABLE t_two (
	id INTEGER NOT NULL,
	b INTEGER NOT NULL,
	c INTEGER NOT NULL,
	v INTEGER NOT NULL,
	t TEXT NOT NULL,
	PRIMARY KEY (id)
);
INSERT INTO t_two (id, b, c, v, t) VALUES
	(1001001, 1, 1, 1, 'Grace and peace'),
	(1001002, 1, 1, 2, 'Peace with you');
`)

	total, err := optimizeBibleDB(db)
	if err != nil {
		t.Fatalf("optimizeBibleDB() error = %v", err)
	}
	if total != 5 {
		t.Fatalf("optimizeBibleDB() total = %d, want 5", total)
	}

	assertScalar(t, db, `SELECT COUNT(*) FROM bible_verse_lookup`, "5")
	assertScalar(t, db, `SELECT COUNT(*) FROM bible_text_fts`, "5")
	assertScalar(t, db, `SELECT COUNT(*) FROM bible_chapter_text`, "3")
	assertScalar(t, db, `SELECT value FROM bible_storage_metadata WHERE key = 'schema_version'`, "4")
	assertScalar(t, db, `SELECT COUNT(*) FROM pragma_table_info('t_one') WHERE name = 't'`, "0")
	assertScalar(t, db, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('t_one', 't_two')`, "0")
	assertScalar(t, db, `SELECT verse_count FROM bible_chapter_text WHERE table_name = 't_one' AND b = 1 AND c = 1`, "2")
	assertScalar(t, db, `SELECT COUNT(*) FROM bible_verse_lookup l LEFT JOIN bible_text_fts f ON f.rowid = l.rowid WHERE f.rowid IS NULL`, "0")
	assertScalar(t, db, `SELECT COUNT(*) FROM bible_text_fts WHERE bible_text_fts MATCH 'light'`, "1")
	assertScalar(t, db, `SELECT COUNT(*) FROM bible_text_fts WHERE bible_text_fts MATCH 'grammatical'`, "0")

	var compressed []byte
	if err := db.QueryRow(`SELECT t FROM bible_chapter_text WHERE table_name = 't_one' AND b = 1 AND c = 1`).Scan(&compressed); err != nil {
		t.Fatalf("query compressed chapter: %v", err)
	}
	verses, err := biblestore.DecompressChapterVerses(compressed)
	if err != nil {
		t.Fatalf("DecompressChapterVerses() error = %v", err)
	}
	if len(verses) != 2 || verses[0].Text != "In the beginning God created" || verses[1].Verse != 2 {
		t.Fatalf("compressed chapter verses = %#v, want first chapter with two ordered verses", verses)
	}
}

func execSQL(t *testing.T, db *sql.DB, statement string) {
	t.Helper()
	if _, err := db.Exec(statement); err != nil {
		t.Fatalf("exec SQL: %v", err)
	}
}

func assertScalar(t *testing.T, db *sql.DB, query string, want string) {
	t.Helper()
	var got string
	if err := db.QueryRow(query).Scan(&got); err != nil {
		t.Fatalf("query %q: %v", query, err)
	}
	if got != want {
		t.Fatalf("%s = %q, want %q", query, got, want)
	}
}
