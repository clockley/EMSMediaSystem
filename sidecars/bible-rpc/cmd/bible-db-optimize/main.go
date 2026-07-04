package main

import (
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"runtime"
	"strings"
	"sync"
	"unicode"

	"emsmediasystem/bible-rpc/internal/biblestore"

	_ "modernc.org/sqlite"
)

type versionRow struct {
	ID           int
	Abbreviation string
	TableName    string
}

type optimizeOptions struct {
	CompressionWorkers int
}

type chapterJob struct {
	Sequence int
	Book     int
	Chapter  int
	Verses   []biblestore.ChapterVerse
}

type compressedChapter struct {
	Sequence int
	Book     int
	Chapter  int
	Data     []byte
	Err      error
}

const sqliteDriverName = "sqlite"
const searchRowIDVersionMultiplier int64 = 1_000_000_000

func main() {
	dbPath := flag.String("db", "", "Path to the Bible SQLite database")
	compressionWorkers := flag.Int("compression-workers", defaultCompressionWorkers(), "Number of parallel chapter compression workers")
	flag.Parse()
	log.SetOutput(os.Stderr)

	if strings.TrimSpace(*dbPath) == "" {
		log.Fatal("Bible database path is required")
	}

	db, err := sql.Open(sqliteDriverName, *dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	if err := configureBuildConnection(db); err != nil {
		log.Fatal(err)
	}

	options := optimizeOptions{CompressionWorkers: normalizeCompressionWorkers(*compressionWorkers)}
	total, err := optimizeBibleDBWithOptions(db, options)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf(
		"Optimized %d Bible verses with chapter-level LZFSE BLOBs and FTS5 lookup index using %d compression worker(s)",
		total,
		options.CompressionWorkers,
	)
}

func defaultCompressionWorkers() int {
	return normalizeCompressionWorkers(runtime.GOMAXPROCS(0))
}

func normalizeCompressionWorkers(workers int) int {
	if workers < 1 {
		return 1
	}
	return workers
}

func configureBuildConnection(db *sql.DB) error {
	statements := []string{
		`PRAGMA busy_timeout = 5000`,
		`PRAGMA cache_size = -131072`,
		`PRAGMA journal_mode = OFF`,
		`PRAGMA locking_mode = EXCLUSIVE`,
		`PRAGMA synchronous = OFF`,
		`PRAGMA temp_store = MEMORY`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("%s: %w", statement, err)
		}
	}
	return nil
}

func optimizeBibleDB(db *sql.DB) (int, error) {
	return optimizeBibleDBWithOptions(db, optimizeOptions{CompressionWorkers: defaultCompressionWorkers()})
}

func optimizeBibleDBWithOptions(db *sql.DB, options optimizeOptions) (int, error) {
	versions, err := fetchVersionRows(db)
	if err != nil {
		return 0, err
	}
	if len(versions) == 0 {
		return 0, errors.New("no Bible versions found")
	}

	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	if err := recreateLookupTables(tx); err != nil {
		return 0, err
	}

	chapterInsert, err := tx.Prepare(fmt.Sprintf(
		`INSERT INTO %s (table_name, b, c, t) VALUES (?, ?, ?, ?)`,
		mustQuoteIdentifier(optimizedChapterTableName()),
	))
	if err != nil {
		return 0, err
	}
	defer chapterInsert.Close()

	total := 0
	for _, version := range versions {
		count, err := optimizeVersionTable(tx, version, chapterInsert, options)
		if err != nil {
			return 0, err
		}
		total += count
	}

	if err := createLookupIndexes(tx); err != nil {
		return 0, err
	}
	if err := writeStorageMetadata(tx); err != nil {
		return 0, err
	}
	if err := replaceChapterTable(tx); err != nil {
		return 0, err
	}

	if _, err := tx.Exec(fmt.Sprintf(
		`INSERT INTO %s(%s) VALUES ('optimize')`,
		mustQuoteIdentifier(biblestore.FTSTable),
		mustQuoteIdentifier(biblestore.FTSTable),
	)); err != nil {
		return 0, fmt.Errorf("optimize FTS index: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}

	if _, err := db.Exec("VACUUM"); err != nil {
		return 0, fmt.Errorf("vacuum optimized DB: %w", err)
	}
	if _, err := db.Exec("PRAGMA optimize"); err != nil {
		return 0, fmt.Errorf("run sqlite optimizer: %w", err)
	}
	return total, nil
}

func fetchVersionRows(db *sql.DB) ([]versionRow, error) {
	rows, err := db.Query(`SELECT id, abbreviation, "table" FROM bible_version_key ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	versions := []versionRow{}
	for rows.Next() {
		var version versionRow
		if err := rows.Scan(&version.ID, &version.Abbreviation, &version.TableName); err != nil {
			return nil, err
		}
		if _, err := quoteIdentifier(version.TableName); err != nil {
			return nil, err
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return versions, nil
}

func recreateLookupTables(tx *sql.Tx) error {
	statements := []string{
		fmt.Sprintf(`DROP TABLE IF EXISTS %s`, mustQuoteIdentifier(biblestore.FTSTable)),
		fmt.Sprintf(`DROP TABLE IF EXISTS %s`, mustQuoteIdentifier(biblestore.LookupTable)),
		fmt.Sprintf(`DROP TABLE IF EXISTS %s`, mustQuoteIdentifier(biblestore.MetadataTable)),
		fmt.Sprintf(`DROP TABLE IF EXISTS %s`, mustQuoteIdentifier(optimizedChapterTableName())),
		fmt.Sprintf(`CREATE TABLE %s (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`, mustQuoteIdentifier(biblestore.MetadataTable)),
		fmt.Sprintf(`CREATE TABLE %s (
			rowid INTEGER PRIMARY KEY,
			version TEXT NOT NULL,
			table_name TEXT NOT NULL,
			b INTEGER NOT NULL,
			c INTEGER NOT NULL,
			v INTEGER NOT NULL,
			verse_id INTEGER NOT NULL
		)`, mustQuoteIdentifier(biblestore.LookupTable)),
		fmt.Sprintf(`CREATE VIRTUAL TABLE %s USING fts5(
			t,
			content = '',
			tokenize = 'unicode61 remove_diacritics 2'
		)`, mustQuoteIdentifier(biblestore.FTSTable)),
		fmt.Sprintf(`CREATE TABLE %s (
			table_name TEXT NOT NULL,
			b INTEGER NOT NULL,
			c INTEGER NOT NULL,
			t BLOB NOT NULL,
			PRIMARY KEY (table_name, b, c)
		)`, mustQuoteIdentifier(optimizedChapterTableName())),
	}

	for _, statement := range statements {
		if _, err := tx.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}

func createLookupIndexes(tx *sql.Tx) error {
	statements := []string{
		fmt.Sprintf(
			`CREATE UNIQUE INDEX idx_bible_verse_lookup_reference ON %s (version, b, c, v)`,
			mustQuoteIdentifier(biblestore.LookupTable),
		),
		fmt.Sprintf(
			`CREATE INDEX idx_bible_verse_lookup_source ON %s (table_name, verse_id)`,
			mustQuoteIdentifier(biblestore.LookupTable),
		),
	}
	for _, statement := range statements {
		if _, err := tx.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}

func writeStorageMetadata(tx *sql.Tx) error {
	statement := fmt.Sprintf(
		`INSERT INTO %s (key, value) VALUES (?, ?), (?, ?), (?, ?), (?, ?)`,
		mustQuoteIdentifier(biblestore.MetadataTable),
	)
	_, err := tx.Exec(
		statement,
		biblestore.TextEncodingKey,
		biblestore.TextEncodingLZFSE,
		biblestore.TextStorageKey,
		biblestore.TextStorageChapterLZFSEJSON,
		"fts_table",
		biblestore.FTSTable,
		"schema_version",
		"3",
	)
	return err
}

func optimizeVersionTable(
	tx *sql.Tx,
	version versionRow,
	chapterInsert *sql.Stmt,
	options optimizeOptions,
) (int, error) {
	tableName, err := quoteIdentifier(version.TableName)
	if err != nil {
		return 0, err
	}
	newTableRaw := version.TableName + "__optimized"
	newTable, err := quoteIdentifier(newTableRaw)
	if err != nil {
		return 0, err
	}

	if _, err := tx.Exec(fmt.Sprintf(`DROP TABLE IF EXISTS %s`, newTable)); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(fmt.Sprintf(`CREATE TABLE %s (
		"id" INTEGER NOT NULL,
		"b" INTEGER NOT NULL,
		"c" INTEGER NOT NULL,
		"v" INTEGER NOT NULL,
		PRIMARY KEY ("id")
	)`, newTable)); err != nil {
		return 0, err
	}

	count, err := countRows(tx, tableName)
	if err != nil {
		return 0, err
	}
	if count == 0 {
		return 0, fmt.Errorf("%s has no verses", version.Abbreviation)
	}

	if err := bulkInsertVerseCoordinates(tx, tableName, newTable); err != nil {
		return 0, err
	}
	rowIDBase := searchRowIDBase(version)
	if err := bulkInsertLookupRows(tx, version, tableName, rowIDBase); err != nil {
		return 0, err
	}
	if err := bulkInsertFTSRows(tx, tableName, rowIDBase); err != nil {
		return 0, err
	}

	chapterJobs, err := readChapterJobs(tx, version, tableName)
	if err != nil {
		return 0, err
	}
	compressedChapters, err := compressChapters(chapterJobs, options.CompressionWorkers)
	if err != nil {
		return 0, err
	}
	if err := insertCompressedChapters(chapterInsert, version, compressedChapters); err != nil {
		return 0, err
	}

	if _, err := tx.Exec(fmt.Sprintf(`DROP TABLE %s`, tableName)); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(fmt.Sprintf(`ALTER TABLE %s RENAME TO %s`, newTable, tableName)); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(fmt.Sprintf(
		`CREATE INDEX %s ON %s ("b", "c", "v")`,
		mustQuoteIdentifier(verseIndexName(version.TableName)),
		tableName,
	)); err != nil {
		return 0, err
	}

	return count, nil
}

func readChapterJobs(tx *sql.Tx, version versionRow, tableName string) ([]chapterJob, error) {
	rows, err := tx.Query(fmt.Sprintf(`SELECT "b", "c", "v", "t" FROM %s ORDER BY "b", "c", "v"`, tableName))
	if err != nil {
		return nil, err
	}

	jobs := []chapterJob{}
	var pendingChapter []biblestore.ChapterVerse
	currentBook := 0
	currentChapter := 0
	flushChapter := func() error {
		if pendingChapter == nil {
			return nil
		}
		jobs = append(jobs, chapterJob{
			Sequence: len(jobs),
			Book:     currentBook,
			Chapter:  currentChapter,
			Verses:   pendingChapter,
		})
		pendingChapter = nil
		return nil
	}

	for rows.Next() {
		var book, chapter, verse int
		var rawText []byte
		if err := rows.Scan(&book, &chapter, &verse, &rawText); err != nil {
			rows.Close()
			return nil, err
		}

		text := string(rawText)

		if pendingChapter == nil || book != currentBook || chapter != currentChapter {
			if err := flushChapter(); err != nil {
				rows.Close()
				return nil, fmt.Errorf("%s %d:%d: %w", version.Abbreviation, currentBook, currentChapter, err)
			}
			currentBook = book
			currentChapter = chapter
			pendingChapter = []biblestore.ChapterVerse{}
		}
		pendingChapter = append(pendingChapter, biblestore.ChapterVerse{Verse: verse, Text: text})
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := flushChapter(); err != nil {
		return nil, fmt.Errorf("%s final chapter: %w", version.Abbreviation, err)
	}
	return jobs, nil
}

func compressChapters(jobs []chapterJob, workerCount int) ([]compressedChapter, error) {
	if len(jobs) == 0 {
		return nil, nil
	}
	workerCount = normalizeCompressionWorkers(workerCount)
	if workerCount > len(jobs) {
		workerCount = len(jobs)
	}

	if workerCount == 1 {
		results := make([]compressedChapter, len(jobs))
		for _, job := range jobs {
			data, err := biblestore.CompressChapterVerses(job.Verses)
			if err != nil {
				return nil, fmt.Errorf("%d:%d: %w", job.Book, job.Chapter, err)
			}
			results[job.Sequence] = compressedChapter{
				Sequence: job.Sequence,
				Book:     job.Book,
				Chapter:  job.Chapter,
				Data:     data,
			}
		}
		return results, nil
	}

	jobsCh := make(chan chapterJob)
	resultsCh := make(chan compressedChapter, len(jobs))
	var wg sync.WaitGroup
	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobsCh {
				data, err := biblestore.CompressChapterVerses(job.Verses)
				resultsCh <- compressedChapter{
					Sequence: job.Sequence,
					Book:     job.Book,
					Chapter:  job.Chapter,
					Data:     data,
					Err:      err,
				}
			}
		}()
	}

	for _, job := range jobs {
		jobsCh <- job
	}
	close(jobsCh)
	wg.Wait()
	close(resultsCh)

	results := make([]compressedChapter, len(jobs))
	var firstErr error
	for result := range resultsCh {
		if result.Err != nil && firstErr == nil {
			firstErr = fmt.Errorf("%d:%d: %w", result.Book, result.Chapter, result.Err)
		}
		results[result.Sequence] = result
	}
	if firstErr != nil {
		return nil, firstErr
	}
	return results, nil
}

func insertCompressedChapters(chapterInsert *sql.Stmt, version versionRow, chapters []compressedChapter) error {
	for _, chapter := range chapters {
		if _, err := chapterInsert.Exec(version.TableName, chapter.Book, chapter.Chapter, chapter.Data); err != nil {
			return err
		}
	}
	return nil
}

func countRows(tx *sql.Tx, tableName string) (int, error) {
	var count int
	if err := tx.QueryRow(fmt.Sprintf(`SELECT COUNT(*) FROM %s`, tableName)).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func bulkInsertVerseCoordinates(tx *sql.Tx, tableName string, newTable string) error {
	_, err := tx.Exec(fmt.Sprintf(
		`INSERT INTO %s ("id", "b", "c", "v")
		SELECT "id", "b", "c", "v" FROM %s ORDER BY "b", "c", "v"`,
		newTable,
		tableName,
	))
	if err != nil {
		return fmt.Errorf("insert verse coordinates: %w", err)
	}
	return nil
}

func searchRowIDBase(version versionRow) int64 {
	return int64(version.ID) * searchRowIDVersionMultiplier
}

func bulkInsertLookupRows(tx *sql.Tx, version versionRow, tableName string, rowIDBase int64) error {
	_, err := tx.Exec(fmt.Sprintf(
		`INSERT INTO %s (rowid, version, table_name, b, c, v, verse_id)
		SELECT ? + "id", ?, ?, "b", "c", "v", "id" FROM %s`,
		mustQuoteIdentifier(biblestore.LookupTable),
		tableName,
	), rowIDBase, version.Abbreviation, version.TableName)
	if err != nil {
		return fmt.Errorf("insert lookup rows for %s: %w", version.Abbreviation, err)
	}
	return nil
}

func bulkInsertFTSRows(tx *sql.Tx, tableName string, rowIDBase int64) error {
	_, err := tx.Exec(fmt.Sprintf(
		`INSERT INTO %s (rowid, t)
		SELECT ? + "id", "t" FROM %s`,
		mustQuoteIdentifier(biblestore.FTSTable),
		tableName,
	), rowIDBase)
	if err != nil {
		return fmt.Errorf("insert FTS rows: %w", err)
	}
	return nil
}

func optimizedChapterTableName() string {
	return biblestore.ChapterTable + "__optimized"
}

func replaceChapterTable(tx *sql.Tx) error {
	if _, err := tx.Exec(fmt.Sprintf(`DROP TABLE IF EXISTS %s`, mustQuoteIdentifier(biblestore.ChapterTable))); err != nil {
		return err
	}
	if _, err := tx.Exec(fmt.Sprintf(
		`ALTER TABLE %s RENAME TO %s`,
		mustQuoteIdentifier(optimizedChapterTableName()),
		mustQuoteIdentifier(biblestore.ChapterTable),
	)); err != nil {
		return err
	}
	if _, err := tx.Exec(fmt.Sprintf(
		`CREATE INDEX idx_bible_chapter_text_reference ON %s (table_name, b, c)`,
		mustQuoteIdentifier(biblestore.ChapterTable),
	)); err != nil {
		return err
	}
	return nil
}

func verseIndexName(tableName string) string {
	suffix := strings.TrimPrefix(tableName, "t_")
	return "idx_verses_" + suffix
}

func quoteIdentifier(identifier string) (string, error) {
	if identifier == "" {
		return "", errors.New("empty SQL identifier")
	}
	for _, r := range identifier {
		if !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_') {
			return "", fmt.Errorf("unsafe SQL identifier: %s", identifier)
		}
	}
	return `"` + identifier + `"`, nil
}

func mustQuoteIdentifier(identifier string) string {
	quoted, err := quoteIdentifier(identifier)
	if err != nil {
		panic(err)
	}
	return quoted
}
