package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"emsmediasystem/bible-rpc/internal/biblestore"
)

type sourceManifest struct {
	Format        string `json:"format"`
	ID            string `json:"id"`
	Abbreviation  string `json:"abbreviation"`
	Name          string `json:"name"`
	Language      string `json:"language"`
	Revision      string `json:"revision"`
	ContentFile   string `json:"contentFile"`
	PublicDomain  bool   `json:"publicDomain"`
	Publisher     string `json:"publisher"`
	Copyright     string `json:"copyright"`
	CopyrightInfo string `json:"copyrightInfo"`
	InfoURL       string `json:"infoUrl"`
	manifestPath  string
	contentPath   string
}

type bundleManifest struct {
	Format  string   `json:"format"`
	Edition string   `json:"edition"`
	Sources []string `json:"sources"`
}

var canonicalBooks = []string{
	"Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
	"1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah",
	"Esther", "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah",
	"Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum",
	"Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John", "Acts",
	"Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians",
	"1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James",
	"1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation",
}

var apocryphaBooks = []string{
	"1 Esdras", "2 Esdras", "Tobit", "Judith", "Esther (Greek)", "Wisdom of Solomon",
	"Ecclesiasticus (Sira)", "Baruch", "Epistle of Jeremiah", "Prayer of Azariah", "Susanna",
	"Bel and the Dragon", "Prayer of Manasseh", "1 Maccabees", "2 Maccabees",
	"Additional Psalm", "Laodiceans",
}

func knownBibleBooks() []string {
	books := make([]string, 0, len(canonicalBooks)+len(apocryphaBooks))
	books = append(books, canonicalBooks...)
	books = append(books, apocryphaBooks...)
	return books
}

func readJSONFile(path string, destination interface{}) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, destination); err != nil {
		return fmt.Errorf("parse %s: %w", path, err)
	}
	return nil
}

func loadSourceManifest(path string) (sourceManifest, error) {
	var manifest sourceManifest
	if err := readJSONFile(path, &manifest); err != nil {
		return manifest, err
	}
	if manifest.Format != "ems.bible-manifest.v1" {
		return manifest, fmt.Errorf("unsupported Bible manifest format in %s", path)
	}
	if strings.TrimSpace(manifest.ID) == "" || strings.TrimSpace(manifest.Abbreviation) == "" || strings.TrimSpace(manifest.Name) == "" {
		return manifest, fmt.Errorf("Bible manifest identity is incomplete: %s", path)
	}
	if filepath.Base(manifest.ContentFile) != manifest.ContentFile || manifest.ContentFile == "" {
		return manifest, fmt.Errorf("unsafe Bible contentFile in %s", path)
	}
	manifest.manifestPath = path
	manifest.contentPath = filepath.Join(filepath.Dir(path), manifest.ContentFile)
	if info, err := os.Stat(manifest.contentPath); err != nil || !info.Mode().IsRegular() {
		return manifest, fmt.Errorf("Bible content is missing for %s", path)
	}
	return manifest, nil
}

func discoverSources(bundleDir, userSourcesDir string) ([]sourceManifest, error) {
	var bundle bundleManifest
	bundlePath := filepath.Join(bundleDir, "bundle.manifest.json")
	if err := readJSONFile(bundlePath, &bundle); err != nil {
		return nil, err
	}
	if bundle.Format != "ems.bible-bundle.v1" {
		return nil, fmt.Errorf("unsupported Bible bundle format")
	}
	paths := make([]string, 0, len(bundle.Sources))
	for _, relative := range bundle.Sources {
		clean := filepath.Clean(relative)
		if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			return nil, fmt.Errorf("unsafe bundled Bible path: %s", relative)
		}
		paths = append(paths, filepath.Join(bundleDir, clean))
	}
	if entries, err := os.ReadDir(userSourcesDir); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".manifest.json") {
				paths = append(paths, filepath.Join(userSourcesDir, entry.Name()))
			}
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	sort.Strings(paths)
	ids, abbreviations := map[string]bool{}, map[string]bool{}
	sources := make([]sourceManifest, 0, len(paths))
	for _, path := range paths {
		source, err := loadSourceManifest(path)
		if err != nil {
			return nil, err
		}
		abbr := strings.ToUpper(source.Abbreviation)
		if ids[source.ID] || abbreviations[abbr] {
			return nil, fmt.Errorf("duplicate Bible source identity: %s/%s", source.ID, abbr)
		}
		ids[source.ID], abbreviations[abbr] = true, true
		source.Abbreviation = abbr
		sources = append(sources, source)
	}
	if len(sources) == 0 {
		return nil, fmt.Errorf("Bible bundle contains no sources")
	}
	return sources, nil
}

func sourceFingerprint(sources []sourceManifest) (string, error) {
	hash := sha256.New()
	for _, source := range sources {
		if _, err := io.WriteString(hash, source.ID+"\x00"); err != nil {
			return "", err
		}
		for _, path := range []string{source.manifestPath, source.contentPath} {
			file, err := os.Open(path)
			if err != nil {
				return "", err
			}
			_, copyErr := io.Copy(hash, file)
			closeErr := file.Close()
			if copyErr != nil {
				return "", copyErr
			}
			if closeErr != nil {
				return "", closeErr
			}
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func prepareBibleDatabase(bundleDir, userSourcesDir, cacheDir string) (string, error) {
	sources, err := discoverSources(bundleDir, userSourcesDir)
	if err != nil {
		return "", err
	}
	fingerprint, err := sourceFingerprint(sources)
	if err != nil {
		return "", err
	}
	// A build-generated cache beside the bundle is immediately usable when no
	// installed source changes the complete source fingerprint.
	bundledFingerprintPath := filepath.Join(bundleDir, "bible-runtime.fingerprint")
	bundledDBPath := filepath.Join(bundleDir, "bible-runtime.sqlite")
	if current, err := os.ReadFile(bundledFingerprintPath); err == nil && strings.TrimSpace(string(current)) == fingerprint {
		if info, err := os.Stat(bundledDBPath); err == nil && info.Size() > 0 {
			return bundledDBPath, nil
		}
	}
	if err := os.MkdirAll(cacheDir, 0o700); err != nil {
		return "", err
	}
	dbPath := filepath.Join(cacheDir, "bible-runtime.sqlite")
	fingerprintPath := filepath.Join(cacheDir, "bible-runtime.fingerprint")
	if current, err := os.ReadFile(fingerprintPath); err == nil && strings.TrimSpace(string(current)) == fingerprint {
		if info, err := os.Stat(dbPath); err == nil && info.Size() > 0 {
			return dbPath, nil
		}
	}
	temporaryPath := dbPath + ".tmp"
	_ = os.Remove(temporaryPath)
	if err := buildBibleCache(temporaryPath, sources); err != nil {
		_ = os.Remove(temporaryPath)
		return "", err
	}
	_ = os.Remove(dbPath)
	if err := os.Rename(temporaryPath, dbPath); err != nil {
		return "", err
	}
	if err := os.WriteFile(fingerprintPath, []byte(fingerprint+"\n"), 0o600); err != nil {
		return "", err
	}
	return dbPath, nil
}

func buildBibleCache(path string, sources []sourceManifest) error {
	cache, err := sql.Open(sqliteDriverName, path)
	if err != nil {
		return err
	}
	defer cache.Close()
	schema := []string{
		`CREATE TABLE bible_storage_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
		`CREATE TABLE bible_source_catalog (id TEXT PRIMARY KEY, abbreviation TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, source_type TEXT NOT NULL, manifest_path TEXT NOT NULL, content_path TEXT NOT NULL, revision TEXT NOT NULL, status TEXT NOT NULL)`,
		`CREATE TABLE bible_version_key (id INTEGER PRIMARY KEY, "table" TEXT NOT NULL, abbreviation TEXT NOT NULL, language TEXT NOT NULL, version TEXT NOT NULL, info_text TEXT NOT NULL, info_url TEXT NOT NULL, publisher TEXT NOT NULL, copyright TEXT NOT NULL, copyright_info TEXT NOT NULL)`,
		`CREATE TABLE key_english (b INTEGER PRIMARY KEY, n TEXT NOT NULL, t TEXT NOT NULL, g INTEGER NOT NULL)`,
		`CREATE TABLE book_info ("order" INTEGER PRIMARY KEY, title_short TEXT NOT NULL, title_full TEXT NOT NULL, abbreviation TEXT NOT NULL, category TEXT NOT NULL, otnt TEXT NOT NULL, chapters INTEGER)`,
		`CREATE TABLE key_abbreviations_english (id INTEGER PRIMARY KEY, a TEXT NOT NULL, b INTEGER NOT NULL, p INTEGER NOT NULL)`,
		`CREATE TABLE bible_verse_lookup (rowid INTEGER PRIMARY KEY, version TEXT NOT NULL, table_name TEXT NOT NULL, b INTEGER NOT NULL, c INTEGER NOT NULL, v INTEGER NOT NULL, verse_id INTEGER NOT NULL)`,
		`CREATE VIRTUAL TABLE bible_text_fts USING fts5(t, content='', tokenize='unicode61 remove_diacritics 2')`,
		`CREATE TABLE bible_chapter_text (table_name TEXT NOT NULL, b INTEGER NOT NULL, c INTEGER NOT NULL, verse_count INTEGER NOT NULL, t BLOB NOT NULL, PRIMARY KEY(table_name,b,c))`,
	}
	for _, statement := range schema {
		if _, err := cache.Exec(statement); err != nil {
			return err
		}
	}
	tx, err := cache.Begin()
	if err != nil {
		return err
	}
	fail := func(err error) error { _ = tx.Rollback(); return err }
	for key, value := range map[string]string{"schema_version": "4", biblestore.TextEncodingKey: biblestore.TextEncodingLZFSE, biblestore.TextStorageKey: biblestore.TextStorageChapterLZFSEJSON} {
		if _, err := tx.Exec(`INSERT INTO bible_storage_metadata(key,value) VALUES(?,?)`, key, value); err != nil {
			return fail(err)
		}
	}
	knownBooks := knownBibleBooks()
	bookIDs := make(map[string]int, len(knownBooks))
	for index, name := range knownBooks {
		id := index + 1
		bookIDs[name] = id
		testament := "OT"
		category := "Apocrypha"
		if id >= 40 && id <= 66 {
			testament = "NT"
			category = ""
		} else if id <= 39 {
			category = ""
		}
		if id <= 39 {
			testament = "OT"
		}
		if _, err := tx.Exec(`INSERT INTO key_english(b,n,t,g) VALUES(?,?,?,0)`, id, name, testament); err != nil {
			return fail(err)
		}
		if _, err := tx.Exec(`INSERT INTO book_info("order",title_short,title_full,abbreviation,category,otnt,chapters) VALUES(?,?,?,?,?,?,0)`, id, name, name, name, category, testament); err != nil {
			return fail(err)
		}
	}
	rowID := int64(0)
	for sourceIndex, source := range sources {
		tableName := fmt.Sprintf("source_%d", sourceIndex+1)
		sourceType := "user"
		if strings.HasPrefix(source.ID, "public:") {
			sourceType = "public"
		} else if strings.HasPrefix(source.ID, "private:") {
			sourceType = "private"
		}
		if _, err := tx.Exec(`INSERT INTO bible_source_catalog(id,abbreviation,display_name,source_type,manifest_path,content_path,revision,status) VALUES(?,?,?,?,?,?,?,?)`, source.ID, source.Abbreviation, source.Name, sourceType, source.manifestPath, source.contentPath, source.Revision, "ready"); err != nil {
			return fail(err)
		}
		if _, err := tx.Exec(`INSERT INTO bible_version_key(id,"table",abbreviation,language,version,info_text,info_url,publisher,copyright,copyright_info) VALUES(?,?,?,?,?,?,?,?,?,?)`, sourceIndex+1, tableName, source.Abbreviation, source.Language, source.Name, source.Name, source.InfoURL, source.Publisher, source.Copyright, source.CopyrightInfo); err != nil {
			return fail(err)
		}
		var bible map[string]map[string]map[string]string
		if err := readJSONFile(source.contentPath, &bible); err != nil {
			return fail(err)
		}
		for bookName := range bible {
			if _, ok := bookIDs[bookName]; !ok {
				return fail(fmt.Errorf("%s contains unsupported book %s", source.contentPath, bookName))
			}
		}
		for _, bookName := range knownBooks {
			chapters, ok := bible[bookName]
			if !ok {
				continue
			}
			chapterNumbers, err := numericKeys(chapters)
			if err != nil {
				return fail(err)
			}
			for _, chapter := range chapterNumbers {
				verseMap := chapters[strconv.Itoa(chapter)]
				verseNumbers, err := numericKeys(verseMap)
				if err != nil {
					return fail(err)
				}
				verses := make([]biblestore.ChapterVerse, 0, len(verseNumbers))
				for _, verse := range verseNumbers {
					verses = append(verses, biblestore.ChapterVerse{Verse: verse, Text: biblestore.CleanBibleVerseText(verseMap[strconv.Itoa(verse)])})
				}
				compressed, err := biblestore.CompressChapterVerses(verses)
				if err != nil {
					return fail(err)
				}
				bookID := bookIDs[bookName]
				if _, err := tx.Exec(`INSERT INTO bible_chapter_text(table_name,b,c,verse_count,t) VALUES(?,?,?,?,?)`, tableName, bookID, chapter, len(verses), compressed); err != nil {
					return fail(err)
				}
				for _, verse := range verses {
					rowID++
					if _, err := tx.Exec(`INSERT INTO bible_verse_lookup(rowid,version,table_name,b,c,v,verse_id) VALUES(?,?,?,?,?,?,?)`, rowID, source.Abbreviation, tableName, bookID, chapter, verse.Verse, bookID*1_000_000+chapter*1_000+verse.Verse); err != nil {
						return fail(err)
					}
					if _, err := tx.Exec(`INSERT INTO bible_text_fts(rowid,t) VALUES(?,?)`, rowID, verse.Text); err != nil {
						return fail(err)
					}
				}
			}
		}
	}
	return tx.Commit()
}

func numericKeys[T any](values map[string]T) ([]int, error) {
	keys := make([]int, 0, len(values))
	for key := range values {
		value, err := strconv.Atoi(key)
		if err != nil || value < 1 {
			return nil, fmt.Errorf("invalid numeric Bible key: %s", key)
		}
		keys = append(keys, value)
	}
	sort.Ints(keys)
	return keys, nil
}
