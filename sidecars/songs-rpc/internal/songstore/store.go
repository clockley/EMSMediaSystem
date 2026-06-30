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
	OneLicense string   `json:"oneLicense"`
	Meter      string   `json:"meter,omitempty"`
}

type Song struct {
	Schema        string           `json:"schema"`
	ID            string           `json:"id"`
	Title         string           `json:"title"`
	SongNumber    *int             `json:"songNumber,omitempty"`
	FolderID      *string          `json:"folderId,omitempty"`
	Metadata      SongMetadata     `json:"metadata"`
	Sections      []SongSection    `json:"sections"`
	Arrangements  []Arrangement    `json:"arrangements"`
	PlayOrder     []PlayOrderEntry `json:"playOrder,omitempty"`
	DefaultRender map[string]any   `json:"defaultRender,omitempty"`
}

type SongSection struct {
	ID     string      `json:"id"`
	Kind   string      `json:"kind"`
	Label  string      `json:"label"`
	Blocks []SongBlock `json:"blocks"`
}

type SongBlock struct {
	Type         string           `json:"type"`
	ID           string           `json:"id"`
	Primary      SongBlockPrimary `json:"primary"`
	Translations []any            `json:"translations,omitempty"`
	Annotations  []any            `json:"annotations,omitempty"`
}

type SongBlockPrimary struct {
	Lang     string        `json:"lang"`
	Segments []SongSegment `json:"segments"`
}

type SongSegment struct {
	Type  string         `json:"type"`
	Text  string         `json:"text"`
	Style map[string]any `json:"style,omitempty"`
}

type Arrangement struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Sequence []string `json:"sequence"`
}

type PlayOrderEntry struct {
	ID        string `json:"id,omitempty"`
	SectionID string `json:"sectionId"`
	Enabled   *bool  `json:"enabled,omitempty"`
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
	Meter      string  `json:"meter,omitempty"`
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
		meter TEXT,
		folder_id TEXT,
		original_import_json TEXT,
		song_json TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
	hasASTJSON := false
	hasSchemaVersion := false
	hasMeter := false
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
		if name == "ast_json" {
			hasASTJSON = true
		}
		if name == "schema_version" {
			hasSchemaVersion = true
		}
		if name == "meter" {
			hasMeter = true
		}
	}
	rows.Close()

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
	if !hasASTJSON {
		if _, err := s.db.Exec(`ALTER TABLE songs ADD COLUMN ast_json TEXT`); err != nil {
			return fmt.Errorf("failed to add ast_json column: %w", err)
		}
	}
	if !hasSchemaVersion {
		if _, err := s.db.Exec(`ALTER TABLE songs ADD COLUMN schema_version TEXT`); err != nil {
			return fmt.Errorf("failed to add schema_version column: %w", err)
		}
	}
	if !hasMeter {
		if _, err := s.db.Exec(`ALTER TABLE songs ADD COLUMN meter TEXT`); err != nil {
			return fmt.Errorf("failed to add meter column: %w", err)
		}
	}
	if err := s.backfillSongNumbersFromJSON(); err != nil {
		return err
	}
	if err := s.backfillSongMetersFromJSON(); err != nil {
		return err
	}
	return s.backfillASTJSONFromJSON()
}

func (s *SongStore) ConvertToAST(song Song) map[string]interface{} {
	authors := song.Metadata.Authors
	if authors == nil {
		authors = []string{}
	}

	metadata := map[string]interface{}{
		"authors":    authors,
		"copyright":  song.Metadata.Copyright,
		"ccliNumber": song.Metadata.CCLINumber,
		"oneLicense": song.Metadata.OneLicense,
		"meter":      normalizedSongMeter(song.Metadata.Meter),
		"hymnal": map[string]interface{}{
			"name":   "",
			"number": "",
			"meter":  normalizedSongMeter(song.Metadata.Meter),
		},
	}
	if song.SongNumber != nil {
		metadata["hymnal"].(map[string]interface{})["number"] = fmt.Sprintf("%d", *song.SongNumber)
	}

	sections := []map[string]interface{}{}
	for _, sec := range song.Sections {
		blocks := sec.Blocks
		if blocks == nil {
			blocks = []SongBlock{}
		}

		sections = append(sections, map[string]interface{}{
			"id":     sec.ID,
			"kind":   songSectionKind(sec),
			"label":  sec.Label,
			"blocks": blocks,
		})
	}

	playOrder := []map[string]interface{}{}
	if len(song.PlayOrder) > 0 {
		for _, entry := range song.PlayOrder {
			if strings.TrimSpace(entry.SectionID) == "" {
				continue
			}
			item := map[string]interface{}{
				"sectionId": entry.SectionID,
			}
			if strings.TrimSpace(entry.ID) != "" {
				item["id"] = entry.ID
			}
			if entry.Enabled != nil {
				item["enabled"] = *entry.Enabled
			}
			playOrder = append(playOrder, item)
		}
	} else if len(song.Arrangements) > 0 && len(song.Arrangements[0].Sequence) > 0 {
		for _, secID := range song.Arrangements[0].Sequence {
			playOrder = append(playOrder, map[string]interface{}{
				"sectionId": secID,
			})
		}
	} else {
		for _, sec := range song.Sections {
			playOrder = append(playOrder, map[string]interface{}{
				"sectionId": sec.ID,
			})
		}
	}

	ast := map[string]interface{}{
		"schema":   "ems.song.v1",
		"id":       song.ID,
		"title":    song.Title,
		"metadata": metadata,
		"languages": []map[string]interface{}{
			{
				"id":      "en",
				"name":    "English",
				"default": true,
			},
		},
		"sections":  sections,
		"playOrder": playOrder,
		"presentation": map[string]interface{}{
			"defaultChunking": map[string]interface{}{
				"mode":      "blocksPerSlide",
				"maxBlocks": 4,
			},
		},
	}

	if song.SongNumber != nil {
		ast["songNumber"] = *song.SongNumber
	}
	if song.FolderID != nil {
		ast["folderId"] = *song.FolderID
	}
	if len(song.DefaultRender) > 0 {
		ast["defaultRender"] = song.DefaultRender
	}

	return ast
}

func (s *SongStore) backfillASTJSONFromJSON() error {
	rows, err := s.db.Query(`SELECT id, song_json, folder_id, song_number, meter FROM songs WHERE ast_json IS NULL OR ast_json = ''`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type backfillItem struct {
		id         string
		songJSON   string
		folderID   sql.NullString
		songNumber sql.NullInt64
		meter      sql.NullString
	}

	var items []backfillItem
	for rows.Next() {
		var item backfillItem
		if err := rows.Scan(&item.id, &item.songJSON, &item.folderID, &item.songNumber, &item.meter); err != nil {
			return err
		}
		items = append(items, item)
	}
	rows.Close()

	for _, item := range items {
		var song Song
		if err := json.Unmarshal([]byte(item.songJSON), &song); err != nil {
			continue
		}
		song.FolderID = scanNullableString(item.folderID)
		if dbNumber := scanNullableInt(item.songNumber); dbNumber != nil {
			song.SongNumber = dbNumber
		}
		if song.Metadata.Meter == "" {
			song.Metadata.Meter = scanNullableText(item.meter)
		}
		ast := s.ConvertToAST(song)
		astJSON, err := json.Marshal(ast)
		if err != nil {
			continue
		}

		if _, err := s.db.Exec(`UPDATE songs SET ast_json = ?, schema_version = ? WHERE id = ?`, string(astJSON), "ems.song.v1", item.id); err != nil {
			return err
		}
	}
	return nil
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func readJSONStringField(data map[string]json.RawMessage, keys ...string) string {
	for _, key := range keys {
		if raw, ok := data[key]; ok {
			var value string
			if json.Unmarshal(raw, &value) == nil {
				return strings.TrimSpace(value)
			}
		}
	}
	return ""
}

func songMeterFromJSONDocument(rawJSON string) string {
	if strings.TrimSpace(rawJSON) == "" {
		return ""
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal([]byte(rawJSON), &root); err != nil {
		return ""
	}
	if meter := readJSONStringField(root, "meter", "Meter", "metre", "Metre"); meter != "" {
		return meter
	}
	var metadata map[string]json.RawMessage
	if raw, ok := root["metadata"]; ok {
		if json.Unmarshal(raw, &metadata) == nil {
			if meter := readJSONStringField(metadata, "meter", "Meter", "metre", "Metre"); meter != "" {
				return meter
			}
			var hymnal map[string]json.RawMessage
			if rawHymnal, ok := metadata["hymnal"]; ok {
				if json.Unmarshal(rawHymnal, &hymnal) == nil {
					if meter := readJSONStringField(hymnal, "meter", "Meter", "metre", "Metre"); meter != "" {
						return meter
					}
				}
			}
		}
	}
	return ""
}

func (s *SongStore) backfillSongMetersFromJSON() error {
	rows, err := s.db.Query(`SELECT id, song_json, ast_json FROM songs WHERE meter IS NULL OR meter = ''`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type meterBackfillItem struct {
		id       string
		songJSON sql.NullString
		astJSON  sql.NullString
	}

	var items []meterBackfillItem
	for rows.Next() {
		var item meterBackfillItem
		if err := rows.Scan(&item.id, &item.songJSON, &item.astJSON); err != nil {
			return err
		}
		items = append(items, item)
	}
	rows.Close()

	for _, item := range items {
		meter := firstNonEmptyString(
			songMeterFromJSONDocument(item.astJSON.String),
			songMeterFromJSONDocument(item.songJSON.String),
		)
		if meter == "" {
			continue
		}
		if _, err := s.db.Exec(`UPDATE songs SET meter = ? WHERE id = ?`, normalizedSongMeter(meter), item.id); err != nil {
			return err
		}
	}
	return nil
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

func normalizedSongMeter(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func songMeterArg(value string) interface{} {
	meter := normalizedSongMeter(value)
	if meter == "" {
		return nil
	}
	return meter
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

func scanNullableText(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return strings.TrimSpace(value.String)
}

func setASTMetadataString(ast map[string]interface{}, key string, value string) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return
	}
	metadata, ok := ast["metadata"].(map[string]interface{})
	if !ok {
		metadata = map[string]interface{}{}
		ast["metadata"] = metadata
	}
	metadata[key] = trimmed
	if key == "meter" {
		hymnal, ok := metadata["hymnal"].(map[string]interface{})
		if !ok {
			hymnal = map[string]interface{}{}
			metadata["hymnal"] = hymnal
		}
		hymnal["meter"] = trimmed
	}
}

func songSectionKind(section SongSection) string {
	kind := strings.TrimSpace(section.Kind)
	if kind == "" {
		kind = "verse"
	}
	return strings.ToLower(kind)
}

func songBlockText(block SongBlock) string {
	if block.Type != "lyricLine" {
		return ""
	}
	var builder strings.Builder
	for _, segment := range block.Primary.Segments {
		builder.WriteString(segment.Text)
	}
	return builder.String()
}

func songSectionBlockTexts(section SongSection) []string {
	texts := make([]string, 0, len(section.Blocks))
	for _, block := range section.Blocks {
		texts = append(texts, songBlockText(block))
	}
	return texts
}

func songSectionLyricsText(section SongSection) string {
	return strings.Join(songSectionBlockTexts(section), "\n")
}

func songHasBlocks(song Song) bool {
	for _, section := range song.Sections {
		if len(section.Blocks) > 0 {
			return true
		}
	}
	return false
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

	ast := s.ConvertToAST(song)
	astJSON, err := json.Marshal(ast)
	if err != nil {
		return err
	}

	authorStr := ""
	if len(song.Metadata.Authors) > 0 {
		authorStr = song.Metadata.Authors[0]
	}
	meter := normalizedSongMeter(song.Metadata.Meter)

	_, err = tx.Exec(`
		INSERT INTO songs (id, title, normalized_title, author, ccli_number, copyright, meter, folder_id, song_number, original_import_json, song_json, ast_json, schema_version, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO UPDATE SET
			title=excluded.title,
			normalized_title=excluded.normalized_title,
			author=excluded.author,
			ccli_number=excluded.ccli_number,
			copyright=excluded.copyright,
			meter=excluded.meter,
			folder_id=excluded.folder_id,
			song_number=excluded.song_number,
			original_import_json=excluded.original_import_json,
			song_json=excluded.song_json,
			ast_json=excluded.ast_json,
			schema_version=excluded.schema_version,
			updated_at=CURRENT_TIMESTAMP
	`, song.ID, song.Title, song.Title, authorStr, song.Metadata.CCLINumber, song.Metadata.Copyright, songMeterArg(meter), nullableString(song.FolderID), songNumberArg(song.SongNumber), originalImportJSON, string(songJSON), string(astJSON), "ems.song.v1")

	if err != nil {
		return err
	}

	tx.Exec("DELETE FROM song_fts WHERE song_id = ?", song.ID)

	var allLyrics string
	for _, section := range song.Sections {
		sectionLyrics := songSectionLyricsText(section)
		allLyrics += sectionLyrics + "\n"
	}
	if meter != "" {
		allLyrics += meter + "\n"
	}

	tx.Exec(`
		INSERT INTO song_fts (song_id, title, author, lyrics)
		VALUES (?, ?, ?, ?)
	`, song.ID, song.Title, authorStr, allLyrics)

	return nil
}

func (s *SongStore) GetSong(id string) (interface{}, error) {
	var astJSON sql.NullString
	var songJSON sql.NullString
	var folderID sql.NullString
	var songNumber sql.NullInt64
	var meter sql.NullString
	err := s.db.QueryRow("SELECT ast_json, song_json, folder_id, song_number, meter FROM songs WHERE id = ?", id).Scan(&astJSON, &songJSON, &folderID, &songNumber, &meter)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("song not found")
		}
		return nil, err
	}

	if astJSON.Valid && astJSON.String != "" {
		var ast map[string]interface{}
		var astSong Song
		if err := json.Unmarshal([]byte(astJSON.String), &astSong); err == nil && songHasBlocks(astSong) {
			if err := json.Unmarshal([]byte(astJSON.String), &ast); err == nil {
				ast["folderId"] = scanNullableString(folderID)
				if dbNumber := scanNullableInt(songNumber); dbNumber != nil {
					ast["songNumber"] = dbNumber
				}
				setASTMetadataString(ast, "meter", scanNullableText(meter))
				return ast, nil
			}
		}
	}

	// Fallback to song_json and convert to AST
	var song Song
	if err := json.Unmarshal([]byte(songJSON.String), &song); err != nil {
		return nil, err
	}
	song.FolderID = scanNullableString(folderID)
	if dbNumber := scanNullableInt(songNumber); dbNumber != nil {
		song.SongNumber = dbNumber
	}
	if song.Metadata.Meter == "" {
		song.Metadata.Meter = scanNullableText(meter)
	}

	ast := s.ConvertToAST(song)
	return ast, nil
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
			SELECT id, title, author, folder_id, song_number, meter
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
			SELECT id, title, author, folder_id, song_number, meter
			FROM songs
			WHERE folder_id = ?`+orderBy,
			nullableString(opts.FolderID))
		if err != nil {
			return nil, err
		}
		return scanSearchResults(rows)
	}

	rows, err := s.db.Query(`SELECT id, title, author, folder_id, song_number, meter FROM songs` + orderBy)
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
			SELECT id, title, author, folder_id, song_number, meter
			FROM (
				SELECT s.id, s.title, s.author, s.folder_id, s.song_number, s.meter, -1000.0 as rank
				FROM songs s
				WHERE s.song_number = ? ` + folderSQL + `
				UNION ALL
				SELECT s.id, s.title, s.author, s.folder_id, s.song_number, s.meter, bm25(song_fts, 100.0, 10.0, 1.0) as rank
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
		SELECT s.id, s.title, s.author, s.folder_id, s.song_number, s.meter
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
		var meter sql.NullString
		if err := rows.Scan(&res.ID, &res.Title, &res.Author, &folderID, &songNumber, &meter); err != nil {
			return nil, err
		}
		res.FolderID = scanNullableString(folderID)
		res.SongNumber = scanNullableInt(songNumber)
		res.Meter = scanNullableText(meter)
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
