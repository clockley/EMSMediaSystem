package songstore

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	_ "modernc.org/sqlite"
)

type SongStore struct {
	db *sql.DB
}

type SongMetadata struct {
	Authors    []string `json:"authors"`
	Copyright  string   `json:"copyright"`
	CCLINumber string   `json:"ccliNumber"`
}

type Song struct {
	Schema       string          `json:"schema"`
	ID           string          `json:"id"`
	Title        string          `json:"title"`
	SongNumber   *int            `json:"songNumber,omitempty"`
	FolderID     *string         `json:"folderId,omitempty"`
	Metadata     SongMetadata    `json:"metadata"`
	Sections     []SongSection   `json:"sections"`
	Arrangements []Arrangement   `json:"arrangements"`
}

type SongSection struct {
	ID    string     `json:"id"`
	Role  string     `json:"role"`
	Label string     `json:"label"`
	Lines []SongLine `json:"lines"`
}

type SongLine struct {
	ID          string           `json:"id"`
	Text        string           `json:"text"`
	Annotations []SongAnnotation `json:"annotations"`
}

type SongAnnotation struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	Symbol string `json:"symbol"`
	Offset int    `json:"offset"`
}

type Arrangement struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Sequence []string `json:"sequence"`
}

type Folder struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	ParentID  *string `json:"parentId,omitempty"`
	SortOrder int     `json:"sortOrder"`
	SongCount int     `json:"songCount"`
}

type SearchResult struct {
	ID         string  `json:"id"`
	Title      string  `json:"title"`
	Author     string  `json:"author"`
	SongNumber *int    `json:"songNumber,omitempty"`
	FolderID   *string `json:"folderId,omitempty"`
}

type SearchOptions struct {
	Query    string
	FolderID *string
	All      bool
	Unfiled  bool
}

const searchQueryResultLimit = 1000

func sqlLimitClause(limit int) string {
	if limit <= 0 {
		return ""
	}
	return fmt.Sprintf(" LIMIT %d", limit)
}

func InitStore(dbPath string) (*SongStore, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		return nil, fmt.Errorf("failed to create db directory: %w", err)
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	store := &SongStore{db: db}
	if err := store.createSchema(); err != nil {
		db.Close()
		return nil, err
	}

	return store, nil
}

func (s *SongStore) Close() error {
	return s.db.Close()
}

func (s *SongStore) createSchema() error {
	query := `
	CREATE TABLE IF NOT EXISTS song_folders (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		parent_id TEXT,
		sort_order INTEGER DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS songs (
		id TEXT PRIMARY KEY,
		title TEXT,
		normalized_title TEXT,
		author TEXT,
		ccli_number TEXT,
		copyright TEXT,
		folder_id TEXT,
		original_import_json TEXT,
		song_json TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS song_sections (
		song_id TEXT,
		section_id TEXT,
		role TEXT,
		label TEXT,
		sort_order INTEGER,
		lyrics_text TEXT,
		PRIMARY KEY (song_id, section_id)
	);

	CREATE TABLE IF NOT EXISTS song_lines (
		song_id TEXT,
		section_id TEXT,
		line_id TEXT,
		line_index INTEGER,
		text TEXT,
		PRIMARY KEY (song_id, section_id, line_id)
	);

	CREATE TABLE IF NOT EXISTS song_annotations (
		song_id TEXT,
		section_id TEXT,
		line_id TEXT,
		annotation_id TEXT,
		type TEXT,
		offset INTEGER,
		length INTEGER,
		data_json TEXT,
		PRIMARY KEY (song_id, section_id, line_id, annotation_id)
	);

	CREATE VIRTUAL TABLE IF NOT EXISTS song_fts USING fts5(
		song_id UNINDEXED,
		title,
		author,
		lyrics,
		tokenize = 'unicode61'
	);
	`
	if _, err := s.db.Exec(query); err != nil {
		return fmt.Errorf("schema creation failed: %w", err)
	}
	return s.migrateSchema()
}

func (s *SongStore) migrateSchema() error {
	rows, err := s.db.Query(`PRAGMA table_info(songs)`)
	if err != nil {
		return err
	}
	defer rows.Close()

	hasFolderID := false
	hasSongNumber := false
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull int
		var dfltValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dfltValue, &pk); err != nil {
			return err
		}
		if name == "folder_id" {
			hasFolderID = true
		}
		if name == "song_number" {
			hasSongNumber = true
		}
	}
	if !hasFolderID {
		if _, err := s.db.Exec(`ALTER TABLE songs ADD COLUMN folder_id TEXT`); err != nil {
			return fmt.Errorf("failed to add folder_id column: %w", err)
		}
	}
	if !hasSongNumber {
		if _, err := s.db.Exec(`ALTER TABLE songs ADD COLUMN song_number INTEGER`); err != nil {
			return fmt.Errorf("failed to add song_number column: %w", err)
		}
	}
	return s.backfillSongNumbersFromJSON()
}

func (s *SongStore) backfillSongNumbersFromJSON() error {
	rows, err := s.db.Query(`SELECT id, song_json FROM songs WHERE song_number IS NULL`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type hymnalMeta struct {
		Number *int `json:"number"`
	}
	type metadata struct {
		Hymnal hymnalMeta `json:"hymnal"`
	}
	type songJSON struct {
		SongNumber *int     `json:"songNumber"`
		Metadata   metadata `json:"metadata"`
	}

	for rows.Next() {
		var id string
		var rawJSON string
		if err := rows.Scan(&id, &rawJSON); err != nil {
			return err
		}
		var payload songJSON
		if err := json.Unmarshal([]byte(rawJSON), &payload); err != nil {
			continue
		}
		number := payload.SongNumber
		if number == nil && payload.Metadata.Hymnal.Number != nil {
			number = payload.Metadata.Hymnal.Number
		}
		if number == nil || *number <= 0 {
			continue
		}
		if _, err := s.db.Exec(`UPDATE songs SET song_number = ? WHERE id = ?`, *number, id); err != nil {
			return err
		}
	}
	return nil
}

func songNumberArg(value *int) interface{} {
	if value == nil || *value <= 0 {
		return nil
	}
	return *value
}

func scanNullableInt(value sql.NullInt64) *int {
	if !value.Valid || value.Int64 <= 0 {
		return nil
	}
	number := int(value.Int64)
	return &number
}

func nullableString(value *string) interface{} {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
}

func scanNullableString(value sql.NullString) *string {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}
	trimmed := strings.TrimSpace(value.String)
	return &trimmed
}

func (s *SongStore) SaveSong(song Song, originalImportJSON string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := s.saveSongTx(tx, song, originalImportJSON); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *SongStore) saveSongTx(tx *sql.Tx, song Song, originalImportJSON string) error {
	songJSON, err := json.Marshal(song)
	if err != nil {
		return err
	}

	authorStr := ""
	if len(song.Metadata.Authors) > 0 {
		authorStr = song.Metadata.Authors[0]
	}

	_, err = tx.Exec(`
		INSERT INTO songs (id, title, normalized_title, author, ccli_number, copyright, folder_id, song_number, original_import_json, song_json, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO UPDATE SET
			title=excluded.title,
			normalized_title=excluded.normalized_title,
			author=excluded.author,
			ccli_number=excluded.ccli_number,
			copyright=excluded.copyright,
			folder_id=excluded.folder_id,
			song_number=excluded.song_number,
			original_import_json=excluded.original_import_json,
			song_json=excluded.song_json,
			updated_at=CURRENT_TIMESTAMP
	`, song.ID, song.Title, song.Title, authorStr, song.Metadata.CCLINumber, song.Metadata.Copyright, nullableString(song.FolderID), songNumberArg(song.SongNumber), originalImportJSON, string(songJSON))

	if err != nil {
		return err
	}

	tx.Exec("DELETE FROM song_sections WHERE song_id = ?", song.ID)
	tx.Exec("DELETE FROM song_lines WHERE song_id = ?", song.ID)
	tx.Exec("DELETE FROM song_annotations WHERE song_id = ?", song.ID)
	tx.Exec("DELETE FROM song_fts WHERE song_id = ?", song.ID)

	var allLyrics string
	for i, section := range song.Sections {
		var sectionLyrics string
		for j, line := range section.Lines {
			sectionLyrics += line.Text + "\n"
			tx.Exec(`
				INSERT INTO song_lines (song_id, section_id, line_id, line_index, text)
				VALUES (?, ?, ?, ?, ?)
			`, song.ID, section.ID, line.ID, j, line.Text)
		}

		tx.Exec(`
			INSERT INTO song_sections (song_id, section_id, role, label, sort_order, lyrics_text)
			VALUES (?, ?, ?, ?, ?, ?)
		`, song.ID, section.ID, section.Role, section.Label, i, sectionLyrics)
		allLyrics += sectionLyrics + "\n"
	}

	tx.Exec(`
		INSERT INTO song_fts (song_id, title, author, lyrics)
		VALUES (?, ?, ?, ?)
	`, song.ID, song.Title, authorStr, allLyrics)

	return nil
}

func (s *SongStore) GetSong(id string) (*Song, error) {
	var songJSON string
	var folderID sql.NullString
	var songNumber sql.NullInt64
	err := s.db.QueryRow("SELECT song_json, folder_id, song_number FROM songs WHERE id = ?", id).Scan(&songJSON, &folderID, &songNumber)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("song not found")
		}
		return nil, err
	}

	var song Song
	if err := json.Unmarshal([]byte(songJSON), &song); err != nil {
		return nil, err
	}
	song.FolderID = scanNullableString(folderID)
	if dbNumber := scanNullableInt(songNumber); dbNumber != nil {
		song.SongNumber = dbNumber
	}

	if len(song.Sections) == 0 {
		sections, loadErr := s.loadSectionsFromTables(id)
		if loadErr == nil && len(sections) > 0 {
			song.Sections = sections
		}
	}

	return &song, nil
}

func (s *SongStore) loadSectionsFromTables(songID string) ([]SongSection, error) {
	rows, err := s.db.Query(`
		SELECT section_id, role, label, sort_order
		FROM song_sections
		WHERE song_id = ?
		ORDER BY sort_order
	`, songID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sections []SongSection
	for rows.Next() {
		var section SongSection
		var sortOrder int
		if err := rows.Scan(&section.ID, &section.Role, &section.Label, &sortOrder); err != nil {
			return nil, err
		}
		lineRows, err := s.db.Query(`
			SELECT line_id, text
			FROM song_lines
			WHERE song_id = ? AND section_id = ?
			ORDER BY line_index
		`, songID, section.ID)
		if err != nil {
			return nil, err
		}
		for lineRows.Next() {
			var line SongLine
			if err := lineRows.Scan(&line.ID, &line.Text); err != nil {
				lineRows.Close()
				return nil, err
			}
			section.Lines = append(section.Lines, line)
		}
		lineRows.Close()
		sections = append(sections, section)
	}
	return sections, nil
}

func (s *SongStore) DeleteSong(id string) error {
	if id == "" {
		return fmt.Errorf("song id is required")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var exists int
	err = tx.QueryRow("SELECT 1 FROM songs WHERE id = ?", id).Scan(&exists)
	if err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("song not found")
		}
		return err
	}

	_, err = tx.Exec("DELETE FROM song_annotations WHERE song_id = ?", id)
	if err != nil {
		return err
	}
	_, err = tx.Exec("DELETE FROM song_lines WHERE song_id = ?", id)
	if err != nil {
		return err
	}
	_, err = tx.Exec("DELETE FROM song_sections WHERE song_id = ?", id)
	if err != nil {
		return err
	}
	_, err = tx.Exec("DELETE FROM song_fts WHERE song_id = ?", id)
	if err != nil {
		return err
	}
	_, err = tx.Exec("DELETE FROM songs WHERE id = ?", id)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *SongStore) Search(opts SearchOptions) ([]SearchResult, error) {
	query := strings.TrimSpace(opts.Query)
	if query != "" {
		return s.searchWithQuery(query, opts)
	}

	orderBy := ` ORDER BY CASE WHEN song_number IS NULL THEN 1 ELSE 0 END, song_number, title`
	useFolderFilter := !opts.All && opts.FolderID != nil && !opts.Unfiled
	useUnfiledFilter := !opts.All && opts.Unfiled

	if useUnfiledFilter {
		rows, err := s.db.Query(`
			SELECT id, title, author, folder_id, song_number
			FROM songs
			WHERE folder_id IS NULL` + orderBy,
		)
		if err != nil {
			return nil, err
		}
		return scanSearchResults(rows)
	}

	if useFolderFilter {
		rows, err := s.db.Query(`
			SELECT id, title, author, folder_id, song_number
			FROM songs
			WHERE folder_id = ?`+orderBy,
			nullableString(opts.FolderID))
		if err != nil {
			return nil, err
		}
		return scanSearchResults(rows)
	}

	rows, err := s.db.Query(`SELECT id, title, author, folder_id, song_number FROM songs` + orderBy)
	if err != nil {
		return nil, err
	}
	return scanSearchResults(rows)
}

func (s *SongStore) folderFilterSQL(opts SearchOptions) (string, []interface{}) {
	if opts.All {
		return "", nil
	}
	if opts.Unfiled {
		return " AND s.folder_id IS NULL", nil
	}
	if opts.FolderID != nil && strings.TrimSpace(*opts.FolderID) != "" {
		return " AND s.folder_id = ?", []interface{}{strings.TrimSpace(*opts.FolderID)}
	}
	return "", nil
}

func (s *SongStore) searchWithQuery(query string, opts SearchOptions) ([]SearchResult, error) {
	folderSQL, folderArgs := s.folderFilterSQL(opts)
	
	words := strings.Fields(query)
	var escaped []string
	var rawWords []string
	for _, word := range words {
		word = strings.ReplaceAll(word, `"`, `""`)
		if word != "" {
			escaped = append(escaped, `"`+word+`"*`)
			rawWords = append(rawWords, word)
		}
	}
	
	var ftsQuery string
	if len(escaped) == 0 {
		ftsQuery = `""`
	} else if len(escaped) == 1 {
		ftsQuery = escaped[0]
	} else {
		phrase := `"` + strings.Join(rawWords, " ") + `"*`
		andWords := strings.Join(escaped, " AND ")
		ftsQuery = phrase + ` OR (` + andWords + `)`
	}

	queryClean := strings.TrimSpace(query)
	if strings.HasPrefix(queryClean, "#") {
		queryClean = strings.TrimSpace(queryClean[1:])
	}

	if number, err := strconv.Atoi(queryClean); err == nil {
		sqlText := `
			SELECT id, title, author, folder_id, song_number
			FROM (
				SELECT s.id, s.title, s.author, s.folder_id, s.song_number, -1000.0 as rank
				FROM songs s
				WHERE s.song_number = ? ` + folderSQL + `
				UNION ALL
				SELECT s.id, s.title, s.author, s.folder_id, s.song_number, bm25(song_fts, 100.0, 10.0, 1.0) as rank
				FROM songs s
				JOIN song_fts ON s.id = song_fts.song_id
				WHERE song_fts MATCH ? ` + folderSQL + `
			)
			GROUP BY id
			ORDER BY MIN(rank) ASC, CASE WHEN song_number IS NULL THEN 1 ELSE 0 END, song_number, title
		` + sqlLimitClause(searchQueryResultLimit)
		
		var args []interface{}
		args = append(args, number)
		args = append(args, folderArgs...)
		args = append(args, ftsQuery)
		args = append(args, folderArgs...)
		
		rows, err := s.db.Query(sqlText, args...)
		if err != nil {
			return nil, err
		}
		return scanSearchResults(rows)
	}

	sqlText := `
		SELECT s.id, s.title, s.author, s.folder_id, s.song_number
		FROM songs s
		JOIN song_fts ON s.id = song_fts.song_id
		WHERE song_fts MATCH ?` + folderSQL + ` 
		ORDER BY bm25(song_fts, 100.0, 10.0, 1.0) ASC, CASE WHEN s.song_number IS NULL THEN 1 ELSE 0 END, s.song_number, s.title
	` + sqlLimitClause(searchQueryResultLimit)
	
	args := append([]interface{}{ftsQuery}, folderArgs...)
	rows, err := s.db.Query(sqlText, args...)
	if err != nil {
		return nil, err
	}
	return scanSearchResults(rows)
}

func scanSearchResults(rows *sql.Rows) ([]SearchResult, error) {
	defer rows.Close()

	results := make([]SearchResult, 0)
	for rows.Next() {
		var res SearchResult
		var folderID sql.NullString
		var songNumber sql.NullInt64
		if err := rows.Scan(&res.ID, &res.Title, &res.Author, &folderID, &songNumber); err != nil {
			return nil, err
		}
		res.FolderID = scanNullableString(folderID)
		res.SongNumber = scanNullableInt(songNumber)
		results = append(results, res)
	}
	return results, nil
}

func (s *SongStore) ListFolders() ([]Folder, error) {
	rows, err := s.db.Query(`
		SELECT f.id, f.name, f.parent_id, f.sort_order,
			(SELECT COUNT(*) FROM songs s WHERE s.folder_id = f.id) AS song_count
		FROM song_folders f
		ORDER BY f.sort_order, f.name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	folders := make([]Folder, 0)
	for rows.Next() {
		var folder Folder
		var parentID sql.NullString
		if err := rows.Scan(&folder.ID, &folder.Name, &parentID, &folder.SortOrder, &folder.SongCount); err != nil {
			return nil, err
		}
		folder.ParentID = scanNullableString(parentID)
		folders = append(folders, folder)
	}
	return folders, nil
}

func newFolderID() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("folder_%d", os.Getpid())
	}
	return "folder_" + hex.EncodeToString(buf)
}

func (s *SongStore) CreateFolder(name string) (*Folder, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return nil, fmt.Errorf("folder name is required")
	}

	var existing Folder
	var parentID sql.NullString
	err := s.db.QueryRow(`
		SELECT id, name, parent_id, sort_order
		FROM song_folders
		WHERE lower(name) = lower(?)
		LIMIT 1
	`, trimmed).Scan(&existing.ID, &existing.Name, &parentID, &existing.SortOrder)
	if err == nil {
		existing.ParentID = scanNullableString(parentID)
		var count int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM songs WHERE folder_id = ?`, existing.ID).Scan(&count)
		existing.SongCount = count
		return &existing, nil
	}
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}

	id := newFolderID()
	folder := &Folder{
		ID:        id,
		Name:      trimmed,
		SortOrder: 0,
		SongCount: 0,
	}
	_, err = s.db.Exec(`
		INSERT INTO song_folders (id, name, parent_id, sort_order, updated_at)
		VALUES (?, ?, NULL, 0, CURRENT_TIMESTAMP)
	`, folder.ID, folder.Name)
	if err != nil {
		return nil, err
	}
	return folder, nil
}

func (s *SongStore) RenameFolder(id, name string) error {
	trimmed := strings.TrimSpace(name)
	if id == "" {
		return fmt.Errorf("folder id is required")
	}
	if trimmed == "" {
		return fmt.Errorf("folder name is required")
	}
	result, err := s.db.Exec(`
		UPDATE song_folders
		SET name = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, trimmed, id)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("folder not found")
	}
	return nil
}

func (s *SongStore) DeleteFolder(id string) error {
	if id == "" {
		return fmt.Errorf("folder id is required")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var exists int
	err = tx.QueryRow("SELECT 1 FROM song_folders WHERE id = ?", id).Scan(&exists)
	if err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("folder not found")
		}
		return err
	}

	if _, err = tx.Exec(`UPDATE songs SET folder_id = NULL WHERE folder_id = ?`, id); err != nil {
		return err
	}
	if _, err = tx.Exec(`DELETE FROM song_folders WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *SongStore) MoveSongToFolder(songID string, folderID *string) error {
	if songID == "" {
		return fmt.Errorf("song id is required")
	}
	if folderID != nil && strings.TrimSpace(*folderID) != "" {
		var exists int
		err := s.db.QueryRow("SELECT 1 FROM song_folders WHERE id = ?", strings.TrimSpace(*folderID)).Scan(&exists)
		if err != nil {
			if err == sql.ErrNoRows {
				return fmt.Errorf("folder not found")
			}
			return err
		}
	}
	result, err := s.db.Exec(`
		UPDATE songs
		SET folder_id = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, nullableString(folderID), songID)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("song not found")
	}
	return nil
}
