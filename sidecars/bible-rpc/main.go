/*
Copyright (C) 2024 Christian Lockley
This library is free software; you can redistribute it and/or modify it
under the terms of the GNU Lesser General Public License as published by
the Free Software Foundation; either version 3 of the License, or
(at your option) any later version.

This library is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
Lesser General Public License for more details.

You should have received a copy of the GNU Lesser General Public License
along with this library. If not, see <https://www.gnu.org/licenses/>.
*/

package main

import (
	"bufio"
	"database/sql"
	stdjson "encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"emsmediasystem/bible-rpc/internal/biblestore"

	_ "modernc.org/sqlite"
)

type Version struct {
	Abbreviation  string           `json:"abbreviation"`
	Version       string           `json:"version"`
	TableName     string           `json:"tableName"`
	Language      string           `json:"language,omitempty"`
	InfoText      string           `json:"infoText,omitempty"`
	InfoURL       string           `json:"infoUrl,omitempty"`
	Publisher     string           `json:"publisher,omitempty"`
	Copyright     string           `json:"copyright,omitempty"`
	CopyrightInfo string           `json:"copyrightInfo,omitempty"`
	Attribution   BibleAttribution `json:"attribution"`
}

type BibleAttribution struct {
	Abbreviation  string `json:"abbreviation"`
	Version       string `json:"version"`
	Text          string `json:"text"`
	ShortText     string `json:"shortText"`
	PublicDomain  bool   `json:"publicDomain"`
	Publisher     string `json:"publisher,omitempty"`
	Copyright     string `json:"copyright,omitempty"`
	CopyrightInfo string `json:"copyrightInfo,omitempty"`
	InfoText      string `json:"infoText,omitempty"`
	InfoURL       string `json:"infoUrl,omitempty"`
}

type BookMetadata struct {
	ID           int      `json:"id"`
	Name         string   `json:"name"`
	Testament    string   `json:"testament"`
	Category     string   `json:"category,omitempty"`
	Abbreviation string   `json:"abbreviation,omitempty"`
	Title        string   `json:"title,omitempty"`
	Chapters     int      `json:"chapters"`
	VerseCounts  []int    `json:"verseCounts,omitempty"`
	Aliases      []string `json:"aliases,omitempty"`
}

type BookMetadataResponse struct {
	Version     string           `json:"version"`
	Attribution BibleAttribution `json:"attribution"`
	Books       []BookMetadata   `json:"books"`
	Error       string           `json:"error,omitempty"`
}

type PassageVerse struct {
	Verse int    `json:"verse"`
	Text  string `json:"text"`
}

type ReferenceResponse struct {
	Version        string `json:"version"`
	Input          string `json:"input,omitempty"`
	Reference      string `json:"reference"`
	Book           string `json:"book"`
	BookID         int    `json:"bookId"`
	Chapter        int    `json:"chapter"`
	Verse          int    `json:"verse,omitempty"`
	VerseEnd       int    `json:"verseEnd,omitempty"`
	VerseSelector  string `json:"verseSelector,omitempty"`
	ChapterCount   int    `json:"chapterCount,omitempty"`
	VerseCount     int    `json:"verseCount,omitempty"`
	SelectedVerses []int  `json:"selectedVerses,omitempty"`
	Error          string `json:"error,omitempty"`
}

type PassageResponse struct {
	Version        string           `json:"version"`
	Attribution    BibleAttribution `json:"attribution"`
	Reference      string           `json:"reference"`
	Book           string           `json:"book"`
	BookID         int              `json:"bookId"`
	Chapter        int              `json:"chapter"`
	Verse          int              `json:"verse,omitempty"`
	VerseEnd       int              `json:"verseEnd,omitempty"`
	VerseSelector  string           `json:"verseSelector,omitempty"`
	SelectedVerses []int            `json:"selectedVerses"`
	Verses         []PassageVerse   `json:"verses"`
	Text           string           `json:"text"`
	Error          string           `json:"error,omitempty"`
}

type ReferenceSuggestion struct {
	Type      string `json:"type"`
	Label     string `json:"label"`
	Reference string `json:"reference"`
	Version   string `json:"version,omitempty"`
	Book      string `json:"book"`
	BookID    int    `json:"bookId"`
	Chapter   int    `json:"chapter,omitempty"`
	Verse     int    `json:"verse,omitempty"`
	VerseEnd  int    `json:"verseEnd,omitempty"`
}

type SuggestReferencesResponse struct {
	Input       string                `json:"input"`
	Version     string                `json:"version"`
	Suggestions []ReferenceSuggestion `json:"suggestions"`
	Error       string                `json:"error,omitempty"`
}

type TextResponse struct {
	Version     string           `json:"version,omitempty"`
	Attribution BibleAttribution `json:"attribution"`
	Chapter     string           `json:"chapter"`
	Verse       string           `json:"verse,omitempty"`
	Text        string           `json:"text,omitempty"`
	Verses      []string         `json:"verses,omitempty"`
	Error       string           `json:"error,omitempty"`
}

type SearchResult struct {
	Version     string           `json:"version"`
	Attribution BibleAttribution `json:"attribution"`
	Reference   string           `json:"reference"`
	Book        string           `json:"book"`
	BookID      int              `json:"bookId"`
	Chapter     int              `json:"chapter"`
	Verse       int              `json:"verse"`
	Text        string           `json:"text"`
	Rank        float64          `json:"rank"`
}

type SearchTextResponse struct {
	Version string         `json:"version"`
	Query   string         `json:"query"`
	Mode    string         `json:"mode"`
	Results []SearchResult `json:"results"`
	Error   string         `json:"error,omitempty"`
}

type SearchOptions struct {
	Limit int    `json:"limit,omitempty"`
	Mode  string `json:"mode,omitempty"`
}

var db *sql.DB
var cachedVersions map[string]Version
var cachedBooks map[string]int // Mapping from book name to ID
var cachedBookDetails map[int]BookMetadata
var cachedBookOrder []BookMetadata
var cachedAliases map[string]string
var cachedAliasKeys []string
var cachedBookMetadataByVersion map[string]BookMetadataResponse

const sqliteDriverName = "sqlite"

func initBibleDatabase(dbPath string) error {
	if strings.TrimSpace(dbPath) == "" {
		return fmt.Errorf("Bible database path is required")
	}
	var err error
	db, err = sql.Open(sqliteDriverName, dbPath)
	if err != nil {
		return err
	}

	if err := requireOptimizedBibleDatabase(db); err != nil {
		return err
	}

	cachedVersions, err = fetchVersions(db)
	if err != nil {
		return fmt.Errorf("failed to cache versions and tables: %w", err)
	}
	if err := validateVersionAttributions(cachedVersions); err != nil {
		return err
	}

	cachedBooks, err = fetchBooksMap(db)
	if err != nil {
		return fmt.Errorf("failed to cache books: %w", err)
	}

	cachedBookOrder, cachedBookDetails, err = fetchBookDetails(db)
	if err != nil {
		return fmt.Errorf("failed to cache book details: %w", err)
	}
	cachedAliases, cachedAliasKeys, err = buildBookAliasCache(db, cachedBookOrder)
	if err != nil {
		return fmt.Errorf("failed to cache book aliases: %w", err)
	}
	cachedBookMetadataByVersion = make(map[string]BookMetadataResponse)
	return nil
}

func bibleTableExists(db *sql.DB, tableName string) (bool, error) {
	row := db.QueryRow(`SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ? LIMIT 1`, tableName)
	var value int
	if err := row.Scan(&value); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func requireOptimizedBibleDatabase(db *sql.DB) error {
	for _, tableName := range []string{
		biblestore.MetadataTable,
		biblestore.LookupTable,
		biblestore.FTSTable,
		biblestore.ChapterTable,
	} {
		exists, err := bibleTableExists(db, tableName)
		if err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("Bible database is missing optimized table: %s", tableName)
		}
	}

	encoding, err := fetchBibleMetadataValue(db, biblestore.TextEncodingKey)
	if err != nil {
		return err
	}
	if encoding != biblestore.TextEncodingLZFSE {
		return fmt.Errorf("Bible database text encoding is %q, expected %q", encoding, biblestore.TextEncodingLZFSE)
	}

	storage, err := fetchBibleMetadataValue(db, biblestore.TextStorageKey)
	if err != nil {
		return err
	}
	if storage != biblestore.TextStorageChapterLZFSEJSON {
		return fmt.Errorf("Bible database text storage is %q, expected %q", storage, biblestore.TextStorageChapterLZFSEJSON)
	}

	schemaVersion, err := fetchBibleMetadataValue(db, "schema_version")
	if err != nil {
		return err
	}
	if schemaVersion != "4" {
		return fmt.Errorf("Bible database schema version is %q, expected 4", schemaVersion)
	}

	hasVerseCount, err := bibleColumnExists(db, biblestore.ChapterTable, "verse_count")
	if err != nil {
		return err
	}
	if !hasVerseCount {
		return fmt.Errorf("Bible database is missing %s.verse_count", biblestore.ChapterTable)
	}

	return nil
}

func bibleColumnExists(db *sql.DB, tableName string, columnName string) (bool, error) {
	rows, err := db.Query(fmt.Sprintf(`PRAGMA table_info(%s)`, tableName))
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var columnType string
		var notNull int
		var defaultValue sql.NullString
		var primaryKey int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return false, err
		}
		if name == columnName {
			return true, nil
		}
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	return false, nil
}

func fetchBibleMetadataValue(db *sql.DB, key string) (string, error) {
	row := db.QueryRow(
		fmt.Sprintf(`SELECT value FROM %s WHERE key = ?`, biblestore.MetadataTable),
		key,
	)
	var value string
	if err := row.Scan(&value); err != nil {
		return "", err
	}
	return value, nil
}

func fetchVersions(db *sql.DB) (map[string]Version, error) {
	query := `
		SELECT
			abbreviation,
			version,
			"table",
			language,
			info_text,
			info_url,
			publisher,
			copyright,
			copyright_info
		FROM bible_version_key`
	rows, err := db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	versions := make(map[string]Version)
	for rows.Next() {
		var v Version
		if err := rows.Scan(
			&v.Abbreviation,
			&v.Version,
			&v.TableName,
			&v.Language,
			&v.InfoText,
			&v.InfoURL,
			&v.Publisher,
			&v.Copyright,
			&v.CopyrightInfo,
		); err != nil {
			return nil, err
		}
		v.Attribution = attributionForVersion(v)
		versions[v.Abbreviation] = v
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return versions, nil
}

func attributionForVersion(version Version) BibleAttribution {
	copyright := strings.TrimSpace(version.Copyright)
	copyrightInfo := strings.TrimSpace(version.CopyrightInfo)
	publisher := strings.TrimSpace(version.Publisher)
	infoText := strings.TrimSpace(version.InfoText)
	infoURL := strings.TrimSpace(version.InfoURL)
	publicDomain := strings.EqualFold(copyright, "public domain") ||
		strings.EqualFold(copyrightInfo, "public domain") ||
		strings.Contains(strings.ToLower(copyrightInfo), "public domain")

	displayName := strings.TrimSpace(version.Version)
	if displayName == "" {
		displayName = strings.TrimSpace(version.Abbreviation)
	}
	shortText := strings.TrimSpace(version.Abbreviation)
	if shortText == "" {
		shortText = displayName
	}

	namePart := displayName
	if shortText != "" && displayName != "" && !strings.EqualFold(displayName, shortText) {
		namePart = fmt.Sprintf("%s (%s)", displayName, shortText)
	}

	copyrightNotice := copyright
	if copyrightInfo != "" {
		copyrightNotice = copyrightInfo
	}
	noticeAlreadyNamesVersion := false
	if copyrightNotice != "" {
		normalizedNotice := strings.ToLower(copyrightNotice)
		noticeAlreadyNamesVersion =
			(displayName != "" && strings.Contains(normalizedNotice, strings.ToLower(displayName))) ||
				(shortText != "" && strings.Contains(normalizedNotice, strings.ToLower(shortText)))
	}

	noticeParts := []string{}
	if namePart != "" && !noticeAlreadyNamesVersion {
		noticeParts = append(noticeParts, namePart)
	}
	if copyrightNotice != "" {
		noticeParts = append(noticeParts, copyrightNotice)
	}
	if publisher != "" {
		noticeParts = append(noticeParts, "Publisher: "+publisher)
	}
	if infoURL != "" {
		noticeParts = append(noticeParts, infoURL)
	}
	notice := strings.Join(noticeParts, ". ")

	return BibleAttribution{
		Abbreviation:  strings.TrimSpace(version.Abbreviation),
		Version:       displayName,
		Text:          notice,
		ShortText:     shortText,
		PublicDomain:  publicDomain,
		Publisher:     publisher,
		Copyright:     copyright,
		CopyrightInfo: copyrightInfo,
		InfoText:      infoText,
		InfoURL:       infoURL,
	}
}

func validateVersionAttributions(versions map[string]Version) error {
	for key, version := range versions {
		attribution := version.Attribution
		if strings.TrimSpace(attribution.Text) == "" {
			return fmt.Errorf("Bible version %s is missing attribution text", key)
		}
		if !attribution.PublicDomain &&
			strings.TrimSpace(attribution.Copyright) == "" &&
			strings.TrimSpace(attribution.CopyrightInfo) == "" {
			return fmt.Errorf("Bible version %s is missing copyright attribution metadata", key)
		}
	}
	return nil
}

func fetchBooksMap(db *sql.DB) (map[string]int, error) {
	query := "SELECT n, b FROM key_english"
	rows, err := db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	books := make(map[string]int)
	for rows.Next() {
		var name string
		var id int
		if err := rows.Scan(&name, &id); err != nil {
			return nil, err
		}
		books[name] = id
	}
	return books, nil
}

func fetchBookDetails(db *sql.DB) ([]BookMetadata, map[int]BookMetadata, error) {
	query := `
		SELECT
			ke.b,
			ke.n,
			COALESCE(bi.otnt, ''),
			COALESCE(bi.category, ''),
			COALESCE(bi.abbreviation, ''),
			COALESCE(bi.title_full, ''),
			COALESCE(bi.chapters, 0)
		FROM key_english ke
		LEFT JOIN book_info bi ON bi."order" = ke.b
		ORDER BY ke.b`
	rows, err := db.Query(query)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	books := []BookMetadata{}
	byID := make(map[int]BookMetadata)
	for rows.Next() {
		var book BookMetadata
		if err := rows.Scan(
			&book.ID,
			&book.Name,
			&book.Testament,
			&book.Category,
			&book.Abbreviation,
			&book.Title,
			&book.Chapters,
		); err != nil {
			return nil, nil, err
		}
		books = append(books, book)
		byID[book.ID] = book
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	return books, byID, nil
}

func normalizeBibleAlias(value string) string {
	var builder strings.Builder
	lastWasSpace := true
	for _, r := range strings.ToLower(value) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			builder.WriteRune(r)
			lastWasSpace = false
			continue
		}
		if !lastWasSpace {
			builder.WriteByte(' ')
			lastWasSpace = true
		}
	}
	return strings.TrimSpace(builder.String())
}

func compactAlias(alias string) string {
	return strings.ReplaceAll(normalizeBibleAlias(alias), " ", "")
}

func addAliasCandidate(candidates map[string]map[string]bool, alias string, bookName string) {
	normalized := normalizeBibleAlias(alias)
	if normalized == "" || bookName == "" {
		return
	}
	if _, ok := candidates[normalized]; !ok {
		candidates[normalized] = make(map[string]bool)
	}
	candidates[normalized][bookName] = true

	compact := strings.ReplaceAll(normalized, " ", "")
	if compact != normalized {
		if _, ok := candidates[compact]; !ok {
			candidates[compact] = make(map[string]bool)
		}
		candidates[compact][bookName] = true
	}
}

func firstMeaningfulBookWord(tokens []string) string {
	for _, token := range tokens {
		if token != "of" && token != "the" {
			return token
		}
	}
	if len(tokens) > 0 {
		return tokens[0]
	}
	return ""
}

func buildBookAliasCache(db *sql.DB, books []BookMetadata) (map[string]string, []string, error) {
	candidates := make(map[string]map[string]bool)
	booksByID := make(map[int]string)

	for _, book := range books {
		booksByID[book.ID] = book.Name
		normalizedName := normalizeBibleAlias(book.Name)
		if normalizedName == "" {
			continue
		}
		addAliasCandidate(candidates, normalizedName, book.Name)

		tokens := strings.Fields(normalizedName)
		numberPrefix := ""
		bookTokens := tokens
		if len(tokens) > 0 {
			if _, err := strconv.Atoi(tokens[0]); err == nil {
				numberPrefix = tokens[0]
				bookTokens = tokens[1:]
			}
		}

		mainWord := firstMeaningfulBookWord(bookTokens)
		if mainWord != "" {
			maxPrefixLength := len(mainWord)
			if maxPrefixLength > 4 {
				maxPrefixLength = 4
			}
			for length := 2; length <= maxPrefixLength; length++ {
				prefix := mainWord[:length]
				if numberPrefix != "" {
					addAliasCandidate(candidates, numberPrefix+" "+prefix, book.Name)
					addAliasCandidate(candidates, numberPrefix+prefix, book.Name)
				} else {
					addAliasCandidate(candidates, prefix, book.Name)
				}
			}
		}

		if len(bookTokens) > 1 {
			var acronym strings.Builder
			for _, token := range bookTokens {
				if token == "" {
					continue
				}
				acronym.WriteByte(token[0])
			}
			if acronym.Len() > 1 {
				alias := acronym.String()
				if numberPrefix != "" {
					addAliasCandidate(candidates, numberPrefix+" "+alias, book.Name)
					addAliasCandidate(candidates, numberPrefix+alias, book.Name)
				} else {
					addAliasCandidate(candidates, alias, book.Name)
				}
			}
		}
	}

	rows, err := db.Query(`SELECT a, b FROM key_abbreviations_english ORDER BY id`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var alias string
		var bookID int
		if err := rows.Scan(&alias, &bookID); err != nil {
			return nil, nil, err
		}
		if bookName := booksByID[bookID]; bookName != "" {
			addAliasCandidate(candidates, alias, bookName)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	aliasMap := make(map[string]string)
	for alias, matches := range candidates {
		if len(matches) != 1 {
			continue
		}
		for bookName := range matches {
			aliasMap[alias] = bookName
		}
	}

	overrides := map[string]string{
		"jo":    "John",
		"jn":    "John",
		"jhn":   "John",
		"mt":    "Matthew",
		"psa":   "Psalms",
		"psalm": "Psalms",
	}
	for alias, bookName := range overrides {
		aliasMap[normalizeBibleAlias(alias)] = bookName
		baseBookName := normalizeBibleAlias(bookName)
		for _, book := range books {
			tokens := strings.Fields(normalizeBibleAlias(book.Name))
			if len(tokens) < 2 {
				continue
			}
			if _, err := strconv.Atoi(tokens[0]); err != nil {
				continue
			}
			if strings.Join(tokens[1:], " ") == baseBookName {
				aliasMap[normalizeBibleAlias(tokens[0]+" "+alias)] = book.Name
				aliasMap[normalizeBibleAlias(tokens[0]+alias)] = book.Name
			}
		}
	}

	keys := make([]string, 0, len(aliasMap))
	for alias := range aliasMap {
		keys = append(keys, alias)
	}
	sort.Slice(keys, func(i, j int) bool {
		leftTokens := len(strings.Fields(keys[i]))
		rightTokens := len(strings.Fields(keys[j]))
		if leftTokens != rightTokens {
			return leftTokens > rightTokens
		}
		return len(keys[i]) > len(keys[j])
	})

	return aliasMap, keys, nil
}

func getVersionsData() map[string]Version {
	return cachedVersions
}

func defaultVersion(version string) string {
	version = strings.TrimSpace(version)
	if version == "" {
		return "KJV"
	}
	return version
}

func versionInfoFor(version string) (Version, error) {
	version = defaultVersion(version)
	info, ok := cachedVersions[version]
	if !ok {
		return Version{}, fmt.Errorf("version not found: %s", version)
	}
	return info, nil
}

func safeTableName(tableName string) (string, error) {
	if tableName == "" {
		return "", fmt.Errorf("empty table name")
	}
	for _, r := range tableName {
		if !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_') {
			return "", fmt.Errorf("unsafe table name: %s", tableName)
		}
	}
	return tableName, nil
}

func matchBookReference(rawReference string) (BookMetadata, bool) {
	cleanInput := normalizeBibleAlias(rawReference)
	if cleanInput == "" {
		return BookMetadata{}, false
	}
	for _, alias := range cachedAliasKeys {
		if cleanInput == alias || strings.HasPrefix(cleanInput, alias+" ") {
			bookName := cachedAliases[alias]
			bookID := cachedBooks[bookName]
			book, ok := cachedBookDetails[bookID]
			return book, ok
		}
	}
	return BookMetadata{}, false
}

type referenceToken struct {
	kind  string
	value string
}

func tokenizeReferenceNumbers(input string) []referenceToken {
	tokens := []referenceToken{}
	var digits strings.Builder
	flushDigits := func() {
		if digits.Len() == 0 {
			return
		}
		tokens = append(tokens, referenceToken{kind: "number", value: digits.String()})
		digits.Reset()
	}

	for _, r := range input {
		if unicode.IsDigit(r) {
			digits.WriteRune(r)
			continue
		}
		flushDigits()
		switch r {
		case ':':
			tokens = append(tokens, referenceToken{kind: "colon", value: ":"})
		case ',':
			tokens = append(tokens, referenceToken{kind: "comma", value: ","})
		case '-', '–', '—':
			tokens = append(tokens, referenceToken{kind: "dash", value: "-"})
		}
	}
	flushDigits()
	return tokens
}

func numericBookPrefix(bookName string) int {
	tokens := strings.Fields(normalizeBibleAlias(bookName))
	if len(tokens) == 0 {
		return 0
	}
	prefix, err := strconv.Atoi(tokens[0])
	if err != nil {
		return 0
	}
	return prefix
}

func dropBookPrefixToken(tokens []referenceToken, bookName string) []referenceToken {
	prefix := numericBookPrefix(bookName)
	if prefix == 0 || len(tokens) == 0 || tokens[0].kind != "number" {
		return tokens
	}
	value, err := strconv.Atoi(tokens[0].value)
	if err == nil && value == prefix {
		return tokens[1:]
	}
	return tokens
}

func tokenNumber(token referenceToken) (int, bool) {
	if token.kind != "number" {
		return 0, false
	}
	value, err := strconv.Atoi(token.value)
	return value, err == nil
}

func parseSelectorTokens(tokens []referenceToken) (string, error) {
	parts := []string{}
	index := 0
	for index < len(tokens) {
		start, ok := tokenNumber(tokens[index])
		if !ok || start < 1 {
			return "", fmt.Errorf("invalid verse selector")
		}
		index++
		part := strconv.Itoa(start)
		if index < len(tokens) && tokens[index].kind == "dash" {
			index++
			if index >= len(tokens) {
				return "", fmt.Errorf("invalid verse range")
			}
			end, ok := tokenNumber(tokens[index])
			if !ok || end < 1 {
				return "", fmt.Errorf("invalid verse range")
			}
			index++
			if end != start {
				if end < start {
					start, end = end, start
				}
				part = fmt.Sprintf("%d-%d", start, end)
			}
		}
		parts = append(parts, part)
		if index >= len(tokens) {
			break
		}
		if tokens[index].kind != "comma" {
			return "", fmt.Errorf("invalid verse selector")
		}
		index++
	}
	return strings.Join(parts, ","), nil
}

func parseReferenceNumbers(rawReference string, bookName string) (chapter int, verseSelector string, err error) {
	tokens := dropBookPrefixToken(tokenizeReferenceNumbers(rawReference), bookName)
	if len(tokens) == 0 {
		return 1, "1", nil
	}
	var ok bool
	chapter, ok = tokenNumber(tokens[0])
	if !ok || chapter < 1 {
		return 0, "", fmt.Errorf("invalid chapter")
	}
	if len(tokens) == 1 {
		return chapter, "", nil
	}
	if tokens[1].kind == "colon" {
		if len(tokens) == 2 {
			return chapter, "", nil
		}
		selector, err := parseSelectorTokens(tokens[2:])
		if err != nil {
			return 0, "", err
		}
		return chapter, selector, nil
	}
	if tokens[1].kind == "number" {
		start, _ := tokenNumber(tokens[1])
		if start < 1 {
			return 0, "", fmt.Errorf("invalid verse")
		}
		if len(tokens) >= 3 && tokens[2].kind == "number" {
			end, _ := tokenNumber(tokens[2])
			if end < 1 {
				return 0, "", fmt.Errorf("invalid verse range")
			}
			if end != start {
				if end < start {
					start, end = end, start
				}
				return chapter, fmt.Sprintf("%d-%d", start, end), nil
			}
		}
		return chapter, strconv.Itoa(start), nil
	}
	return 0, "", fmt.Errorf("invalid reference")
}

func selectedVersesFromSelector(selector string, maxVerse int) ([]int, error) {
	if strings.TrimSpace(selector) == "" {
		return []int{}, nil
	}
	selected := []int{}
	seen := make(map[int]bool)
	parts := strings.Split(selector, ",")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		rangeParts := strings.SplitN(part, "-", 2)
		start, err := strconv.Atoi(rangeParts[0])
		if err != nil || start < 1 {
			return nil, fmt.Errorf("invalid verse selector")
		}
		end := start
		if len(rangeParts) == 2 {
			end, err = strconv.Atoi(rangeParts[1])
			if err != nil || end < 1 {
				return nil, fmt.Errorf("invalid verse selector")
			}
		}
		if end < start {
			start, end = end, start
		}
		if start > maxVerse {
			return nil, fmt.Errorf("verse out of range")
		}
		if end > maxVerse {
			end = maxVerse
		}
		for verse := start; verse <= end; verse++ {
			if !seen[verse] {
				seen[verse] = true
				selected = append(selected, verse)
			}
		}
	}
	return selected, nil
}

func verseSelectorFromSelectedVerses(selected []int) string {
	if len(selected) == 0 {
		return ""
	}
	ranges := []string{}
	start := selected[0]
	previous := selected[0]
	for index := 1; index < len(selected); index++ {
		verse := selected[index]
		if verse == previous+1 {
			previous = verse
			continue
		}
		if start == previous {
			ranges = append(ranges, strconv.Itoa(start))
		} else {
			ranges = append(ranges, fmt.Sprintf("%d-%d", start, previous))
		}
		start = verse
		previous = verse
	}
	if start == previous {
		ranges = append(ranges, strconv.Itoa(start))
	} else {
		ranges = append(ranges, fmt.Sprintf("%d-%d", start, previous))
	}
	return strings.Join(ranges, ",")
}

func contiguousVerseEnd(selected []int) int {
	if len(selected) < 2 {
		return 0
	}
	for index := 1; index < len(selected); index++ {
		if selected[index] != selected[index-1]+1 {
			return 0
		}
	}
	return selected[len(selected)-1]
}

func bookChapterCount(db *sql.DB, tableName string, bookID int) (int, error) {
	tableName, err := safeTableName(tableName)
	if err != nil {
		return 0, err
	}
	row := db.QueryRow(
		fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE table_name = ? AND b = ?", biblestore.ChapterTable),
		tableName,
		bookID,
	)
	var count int
	if err := row.Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func chapterVerseCount(db *sql.DB, tableName string, bookID int, chapter int) (int, error) {
	tableName, err := safeTableName(tableName)
	if err != nil {
		return 0, err
	}
	row := db.QueryRow(
		fmt.Sprintf("SELECT verse_count FROM %s WHERE table_name = ? AND b = ? AND c = ?", biblestore.ChapterTable),
		tableName,
		bookID,
		chapter,
	)
	var count int
	if err := row.Scan(&count); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, nil
		}
		return 0, err
	}
	return count, nil
}

func resolveReferenceData(db *sql.DB, version string, rawReference string) (ReferenceResponse, error) {
	versionInfo, err := versionInfoFor(version)
	if err != nil {
		return ReferenceResponse{}, err
	}
	tableName, err := safeTableName(versionInfo.TableName)
	if err != nil {
		return ReferenceResponse{}, err
	}

	book, ok := matchBookReference(rawReference)
	if !ok {
		return ReferenceResponse{}, fmt.Errorf("book not found")
	}

	chapter, selector, err := parseReferenceNumbers(rawReference, book.Name)
	if err != nil {
		return ReferenceResponse{}, err
	}

	chapterCount, err := bookChapterCount(db, tableName, book.ID)
	if err != nil {
		return ReferenceResponse{}, err
	}
	if chapterCount == 0 {
		return ReferenceResponse{}, fmt.Errorf("book not found in version")
	}
	if chapter < 1 || chapter > chapterCount {
		return ReferenceResponse{}, fmt.Errorf("chapter out of range")
	}

	verseCount, err := chapterVerseCount(db, tableName, book.ID, chapter)
	if err != nil {
		return ReferenceResponse{}, err
	}
	if verseCount == 0 {
		return ReferenceResponse{}, fmt.Errorf("chapter not found")
	}

	selected, err := selectedVersesFromSelector(selector, verseCount)
	if err != nil {
		return ReferenceResponse{}, err
	}
	normalizedSelector := verseSelectorFromSelectedVerses(selected)
	reference := fmt.Sprintf("%s %d", book.Name, chapter)
	if normalizedSelector != "" {
		reference = fmt.Sprintf("%s:%s", reference, normalizedSelector)
	}

	verse := 0
	if len(selected) > 0 {
		verse = selected[0]
	}

	return ReferenceResponse{
		Version:        versionInfo.Abbreviation,
		Input:          rawReference,
		Reference:      reference,
		Book:           book.Name,
		BookID:         book.ID,
		Chapter:        chapter,
		Verse:          verse,
		VerseEnd:       contiguousVerseEnd(selected),
		VerseSelector:  normalizedSelector,
		ChapterCount:   chapterCount,
		VerseCount:     verseCount,
		SelectedVerses: selected,
	}, nil
}

func fetchChapterVerses(db *sql.DB, tableName string, bookID int, chapter int) ([]PassageVerse, error) {
	tableName, err := safeTableName(tableName)
	if err != nil {
		return nil, err
	}
	row := db.QueryRow(
		fmt.Sprintf("SELECT t FROM %s WHERE table_name = ? AND b = ? AND c = ?", biblestore.ChapterTable),
		tableName,
		bookID,
		chapter,
	)
	var rawText []byte
	if err := row.Scan(&rawText); err != nil {
		return nil, err
	}
	chapterVerses, err := biblestore.DecompressChapterVerses(rawText)
	if err != nil {
		return nil, err
	}

	verses := make([]PassageVerse, 0, len(chapterVerses))
	for _, verse := range chapterVerses {
		verses = append(verses, PassageVerse{Verse: verse.Verse, Text: verse.Text})
	}
	return verses, nil
}

func fetchVerseTextByLocation(db *sql.DB, tableName string, bookID int, chapter int, verse int) (string, error) {
	verses, err := fetchChapterVerses(db, tableName, bookID, chapter)
	if err != nil {
		return "", err
	}
	for _, candidate := range verses {
		if candidate.Verse == verse {
			return candidate.Text, nil
		}
	}
	return "", fmt.Errorf("verse not found")
}

func passageText(verses []PassageVerse) string {
	if len(verses) == 0 {
		return ""
	}
	if len(verses) == 1 {
		return verses[0].Text
	}
	lines := make([]string, 0, len(verses))
	for _, verse := range verses {
		lines = append(lines, fmt.Sprintf("%d. %s", verse.Verse, verse.Text))
	}
	return strings.Join(lines, "\n")
}

func resolveReferenceResult(version, reference string) ReferenceResponse {
	resolved, err := resolveReferenceData(db, version, reference)
	if err != nil {
		return ReferenceResponse{
			Version: defaultVersion(version),
			Input:   reference,
			Error:   err.Error(),
		}
	}
	return resolved
}

func getPassageResult(version, reference string) PassageResponse {
	versionInfo, err := versionInfoFor(version)
	if err != nil {
		return PassageResponse{Version: defaultVersion(version), Error: err.Error()}
	}
	resolved, err := resolveReferenceData(db, versionInfo.Abbreviation, reference)
	if err != nil {
		return PassageResponse{
			Version:     versionInfo.Abbreviation,
			Attribution: versionInfo.Attribution,
			Reference:   reference,
			Error:       err.Error(),
		}
	}

	chapterVerses, err := fetchChapterVerses(db, versionInfo.TableName, resolved.BookID, resolved.Chapter)
	if err != nil {
		return PassageResponse{
			Version:     versionInfo.Abbreviation,
			Attribution: versionInfo.Attribution,
			Reference:   resolved.Reference,
			Error:       err.Error(),
		}
	}

	selectedVerseSet := make(map[int]bool)
	for _, verse := range resolved.SelectedVerses {
		selectedVerseSet[verse] = true
	}

	verses := chapterVerses
	if len(selectedVerseSet) > 0 {
		verses = []PassageVerse{}
		for _, verse := range chapterVerses {
			if selectedVerseSet[verse.Verse] {
				verses = append(verses, verse)
			}
		}
	}

	return PassageResponse{
		Version:        resolved.Version,
		Attribution:    versionInfo.Attribution,
		Reference:      resolved.Reference,
		Book:           resolved.Book,
		BookID:         resolved.BookID,
		Chapter:        resolved.Chapter,
		Verse:          resolved.Verse,
		VerseEnd:       resolved.VerseEnd,
		VerseSelector:  resolved.VerseSelector,
		SelectedVerses: resolved.SelectedVerses,
		Verses:         verses,
		Text:           passageText(verses),
	}
}

func getBookMetadataResult(version string) BookMetadataResponse {
	versionInfo, err := versionInfoFor(version)
	if err != nil {
		return BookMetadataResponse{Version: defaultVersion(version), Error: err.Error()}
	}
	if cached, ok := cachedBookMetadataByVersion[versionInfo.Abbreviation]; ok {
		return cached
	}
	tableName, err := safeTableName(versionInfo.TableName)
	if err != nil {
		return BookMetadataResponse{Version: versionInfo.Abbreviation, Error: err.Error()}
	}

	rows, err := db.Query(
		fmt.Sprintf("SELECT b, c, verse_count FROM %s WHERE table_name = ? ORDER BY b, c", biblestore.ChapterTable),
		tableName,
	)
	if err != nil {
		return BookMetadataResponse{Version: versionInfo.Abbreviation, Error: err.Error()}
	}
	defer rows.Close()

	verseCountsByBook := make(map[int][]int)
	for rows.Next() {
		var bookID, chapter, verseCount int
		if err := rows.Scan(&bookID, &chapter, &verseCount); err != nil {
			return BookMetadataResponse{Version: versionInfo.Abbreviation, Error: err.Error()}
		}
		counts := verseCountsByBook[bookID]
		for len(counts) < chapter {
			counts = append(counts, 0)
		}
		counts[chapter-1] = verseCount
		verseCountsByBook[bookID] = counts
	}
	if err := rows.Err(); err != nil {
		return BookMetadataResponse{Version: versionInfo.Abbreviation, Error: err.Error()}
	}

	aliasesByBook := make(map[string][]string)
	for alias, bookName := range cachedAliases {
		aliasesByBook[bookName] = append(aliasesByBook[bookName], alias)
	}

	books := make([]BookMetadata, 0, len(cachedBookOrder))
	for _, cached := range cachedBookOrder {
		book := cached
		book.VerseCounts = verseCountsByBook[book.ID]
		book.Chapters = len(book.VerseCounts)
		book.Aliases = aliasesByBook[book.Name]
		sort.Strings(book.Aliases)
		books = append(books, book)
	}

	response := BookMetadataResponse{
		Version:     versionInfo.Abbreviation,
		Attribution: versionInfo.Attribution,
		Books:       books,
	}
	cachedBookMetadataByVersion[versionInfo.Abbreviation] = response
	return response
}

func suggestionExists(suggestions []ReferenceSuggestion, reference string, suggestionType string) bool {
	for _, suggestion := range suggestions {
		if suggestion.Reference == reference && suggestion.Type == suggestionType {
			return true
		}
	}
	return false
}

func addBookSuggestion(suggestions []ReferenceSuggestion, version string, book BookMetadata) []ReferenceSuggestion {
	if suggestionExists(suggestions, book.Name, "book") {
		return suggestions
	}
	return append(suggestions, ReferenceSuggestion{
		Type:      "book",
		Label:     book.Name,
		Reference: book.Name,
		Version:   version,
		Book:      book.Name,
		BookID:    book.ID,
	})
}

func addReferenceSuggestion(suggestions []ReferenceSuggestion, suggestionType string, resolved ReferenceResponse) []ReferenceSuggestion {
	if suggestionExists(suggestions, resolved.Reference, suggestionType) {
		return suggestions
	}
	return append(suggestions, ReferenceSuggestion{
		Type:      suggestionType,
		Label:     resolved.Reference,
		Reference: resolved.Reference,
		Version:   resolved.Version,
		Book:      resolved.Book,
		BookID:    resolved.BookID,
		Chapter:   resolved.Chapter,
		Verse:     resolved.Verse,
		VerseEnd:  resolved.VerseEnd,
	})
}

func tokenListIsNumeric(tokens []string) bool {
	if len(tokens) == 0 {
		return false
	}
	for _, token := range tokens {
		if _, err := strconv.Atoi(token); err != nil {
			return false
		}
	}
	return true
}

func bookMatchesPrefixQuery(book BookMetadata, query string) bool {
	normalizedQuery := normalizeBibleAlias(query)
	compactQuery := strings.ReplaceAll(normalizedQuery, " ", "")
	if normalizedQuery == "" {
		return false
	}
	normalizedName := normalizeBibleAlias(book.Name)
	if strings.HasPrefix(normalizedName, normalizedQuery) ||
		strings.HasPrefix(compactAlias(book.Name), compactQuery) {
		return true
	}
	for alias, bookName := range cachedAliases {
		if bookName != book.Name {
			continue
		}
		if strings.HasPrefix(alias, normalizedQuery) ||
			strings.HasPrefix(strings.ReplaceAll(alias, " ", ""), compactQuery) {
			return true
		}
	}
	return false
}

func addPrefixReferenceSuggestions(db *sql.DB, suggestions []ReferenceSuggestion, version string, input string, limit int) []ReferenceSuggestion {
	tokens := strings.Fields(normalizeBibleAlias(input))
	if len(tokens) < 2 {
		return suggestions
	}
	for split := len(tokens) - 1; split >= 1; split-- {
		if len(suggestions) >= limit {
			return suggestions
		}
		tailTokens := tokens[split:]
		if !tokenListIsNumeric(tailTokens) {
			continue
		}
		bookQuery := strings.Join(tokens[:split], " ")
		tail := strings.Join(tailTokens, " ")
		for _, book := range cachedBookOrder {
			if !bookMatchesPrefixQuery(book, bookQuery) {
				continue
			}
			resolved, err := resolveReferenceData(db, version, book.Name+" "+tail)
			if err != nil {
				continue
			}
			suggestions = addReferenceSuggestion(suggestions, "reference", resolved)
			if len(suggestions) >= limit {
				return suggestions
			}
		}
	}
	return suggestions
}

func minInt(values ...int) int {
	if len(values) == 0 {
		return 0
	}
	min := values[0]
	for _, value := range values[1:] {
		if value < min {
			min = value
		}
	}
	return min
}

func levenshteinDistance(left string, right string) int {
	leftRunes := []rune(left)
	rightRunes := []rune(right)
	if len(leftRunes) == 0 {
		return len(rightRunes)
	}
	if len(rightRunes) == 0 {
		return len(leftRunes)
	}

	previous := make([]int, len(rightRunes)+1)
	current := make([]int, len(rightRunes)+1)
	for index := range previous {
		previous[index] = index
	}
	for i, leftRune := range leftRunes {
		current[0] = i + 1
		for j, rightRune := range rightRunes {
			cost := 1
			if leftRune == rightRune {
				cost = 0
			}
			current[j+1] = minInt(
				current[j]+1,
				previous[j+1]+1,
				previous[j]+cost,
			)
		}
		previous, current = current, previous
	}
	return previous[len(rightRunes)]
}

func fuzzyBookThreshold(query string) int {
	length := len([]rune(strings.ReplaceAll(query, " ", "")))
	switch {
	case length <= 2:
		return 0
	case length <= 4:
		return 1
	case length <= 8:
		return 2
	default:
		return 3
	}
}

func bestAliasDistanceForBook(query string, bookName string) int {
	normalizedQuery := normalizeBibleAlias(query)
	compactQuery := compactAlias(query)
	queryTokens := strings.Fields(normalizedQuery)
	queryHasNumberPrefix := false
	if len(queryTokens) > 0 {
		_, err := strconv.Atoi(queryTokens[0])
		queryHasNumberPrefix = err == nil
	}
	if numericBookPrefix(bookName) > 0 && !queryHasNumberPrefix {
		return 999
	}
	best := levenshteinDistance(normalizedQuery, normalizeBibleAlias(bookName))
	best = minInt(best, levenshteinDistance(compactQuery, compactAlias(bookName)))
	for alias, aliasBookName := range cachedAliases {
		if aliasBookName != bookName {
			continue
		}
		compactAliasValue := strings.ReplaceAll(alias, " ", "")
		if len([]rune(compactAliasValue)) < len([]rune(compactQuery))-1 {
			continue
		}
		best = minInt(
			best,
			levenshteinDistance(normalizedQuery, alias),
			levenshteinDistance(compactQuery, compactAliasValue),
		)
	}
	return best
}

type fuzzyBookCandidate struct {
	book  BookMetadata
	score int
	tail  string
}

func fuzzyBookCandidates(input string) []fuzzyBookCandidate {
	tokens := strings.Fields(normalizeBibleAlias(input))
	if len(tokens) == 0 {
		return nil
	}

	bestByBook := make(map[int]fuzzyBookCandidate)
	for split := len(tokens); split >= 1; split-- {
		bookQuery := strings.Join(tokens[:split], " ")
		if strings.ReplaceAll(bookQuery, " ", "") == "" {
			continue
		}
		threshold := fuzzyBookThreshold(bookQuery)
		if threshold == 0 {
			continue
		}
		tail := strings.Join(tokens[split:], " ")
		for _, book := range cachedBookOrder {
			score := bestAliasDistanceForBook(bookQuery, book.Name)
			if score > threshold {
				continue
			}
			existing, ok := bestByBook[book.ID]
			if !ok || score < existing.score || (score == existing.score && len(tail) > len(existing.tail)) {
				bestByBook[book.ID] = fuzzyBookCandidate{
					book:  book,
					score: score,
					tail:  tail,
				}
			}
		}
	}

	candidates := make([]fuzzyBookCandidate, 0, len(bestByBook))
	for _, candidate := range bestByBook {
		candidates = append(candidates, candidate)
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].score != candidates[j].score {
			return candidates[i].score < candidates[j].score
		}
		if len(candidates[i].tail) != len(candidates[j].tail) {
			return len(candidates[i].tail) > len(candidates[j].tail)
		}
		return candidates[i].book.ID < candidates[j].book.ID
	})
	return candidates
}

func addFuzzyReferenceSuggestions(db *sql.DB, suggestions []ReferenceSuggestion, version string, input string, limit int) []ReferenceSuggestion {
	for _, candidate := range fuzzyBookCandidates(input) {
		if len(suggestions) >= limit {
			break
		}
		if candidate.tail == "" {
			suggestions = addBookSuggestion(suggestions, version, candidate.book)
			continue
		}
		correctedInput := candidate.book.Name + " " + candidate.tail
		resolved, err := resolveReferenceData(db, version, correctedInput)
		if err != nil {
			suggestions = addBookSuggestion(suggestions, version, candidate.book)
			continue
		}
		suggestions = addReferenceSuggestion(suggestions, "correction", resolved)
	}
	return suggestions
}

func suggestReferencesResult(version string, input string) SuggestReferencesResponse {
	versionInfo, err := versionInfoFor(version)
	if err != nil {
		return SuggestReferencesResponse{
			Input:   input,
			Version: defaultVersion(version),
			Error:   err.Error(),
		}
	}

	suggestions := []ReferenceSuggestion{}
	resolvedOK := false
	if resolved, err := resolveReferenceData(db, versionInfo.Abbreviation, input); err == nil {
		resolvedOK = true
		suggestions = addReferenceSuggestion(suggestions, "reference", resolved)
		if book, ok := cachedBookDetails[resolved.BookID]; ok {
			suggestions = addBookSuggestion(suggestions, versionInfo.Abbreviation, book)
		}
	}
	if !resolvedOK && len(suggestions) < 12 {
		suggestions = addPrefixReferenceSuggestions(db, suggestions, versionInfo.Abbreviation, input, 12)
	}

	query := normalizeBibleAlias(input)
	if query != "" {
		for _, book := range cachedBookOrder {
			normalizedName := normalizeBibleAlias(book.Name)
			if strings.HasPrefix(normalizedName, query) ||
				strings.HasPrefix(compactAlias(book.Name), strings.ReplaceAll(query, " ", "")) {
				suggestions = addBookSuggestion(suggestions, versionInfo.Abbreviation, book)
			}
			if len(suggestions) >= 12 {
				break
			}
		}
		if len(suggestions) < 12 {
			seenBooks := make(map[string]bool)
			for _, suggestion := range suggestions {
				seenBooks[suggestion.Book] = true
			}
			for _, alias := range cachedAliasKeys {
				if !strings.HasPrefix(alias, query) {
					continue
				}
				bookName := cachedAliases[alias]
				if seenBooks[bookName] {
					continue
				}
				bookID := cachedBooks[bookName]
				book, ok := cachedBookDetails[bookID]
				if !ok {
					continue
				}
				suggestions = addBookSuggestion(suggestions, versionInfo.Abbreviation, book)
				seenBooks[bookName] = true
				if len(suggestions) >= 12 {
					break
				}
			}
		}
	}
	if !resolvedOK && len(suggestions) < 12 {
		suggestions = addFuzzyReferenceSuggestions(db, suggestions, versionInfo.Abbreviation, input, 12)
	}

	return SuggestReferencesResponse{
		Input:       input,
		Version:     versionInfo.Abbreviation,
		Suggestions: suggestions,
	}
}

func getTextResult(version, bookName, chapterVerse string) TextResponse {
	bookID, ok := cachedBooks[bookName]
	if !ok {
		return TextResponse{Error: "Book not found"}
	}

	text, err := fetchText(db, version, bookName, bookID, chapterVerse)
	if err != nil {
		return TextResponse{Error: err.Error()}
	}

	return text
}

func getChapterInfoResult(versionKey, bookName string, chapterNumber int) (int, error) {
	versionInfo, err := versionInfoFor(versionKey)
	if err != nil {
		return 0, err
	}

	bookID, ok := cachedBooks[bookName]
	if !ok {
		return 0, fmt.Errorf("book not found")
	}

	tableName, err := safeTableName(versionInfo.TableName)
	if err != nil {
		return 0, err
	}
	verseCount, err := chapterVerseCount(db, tableName, bookID, chapterNumber)
	if err != nil {
		return 0, fmt.Errorf("failed to fetch verse count: %w", err)
	}

	return verseCount, nil
}

func getBookInfoResult(versionKey, bookName string) (int, error) {
	versionInfo, err := versionInfoFor(versionKey)
	if err != nil {
		return 0, err
	}

	bookID, ok := cachedBooks[bookName]
	if !ok {
		return 0, fmt.Errorf("book not found")
	}

	tableName, err := safeTableName(versionInfo.TableName)
	if err != nil {
		return 0, err
	}
	chapterCount, err := bookChapterCount(db, tableName, bookID)
	if err != nil {
		return 0, fmt.Errorf("failed to fetch chapter count: %w", err)
	}

	return chapterCount, nil
}

func fetchText(db *sql.DB, version string, bookName string, bookID int, chapterVerse string) (TextResponse, error) {
	versionInfo, ok := cachedVersions[version]
	if !ok {
		return TextResponse{}, fmt.Errorf("version not found: %s", version)
	}

	tableName, err := safeTableName(versionInfo.TableName)
	if err != nil {
		return TextResponse{}, err
	}

	colonIndex := strings.Index(chapterVerse, ":")
	var chapter, verse string
	if colonIndex == -1 {
		chapter = chapterVerse
	} else {
		chapter = chapterVerse[:colonIndex]
		verse = chapterVerse[colonIndex+1:]
	}

	chapterNumber, err := strconv.Atoi(chapter)
	if err != nil {
		return TextResponse{}, fmt.Errorf("invalid chapter")
	}
	chapterVerses, err := fetchChapterVerses(db, tableName, bookID, chapterNumber)
	if err != nil {
		return TextResponse{}, fmt.Errorf("database query error: %v", err)
	}

	response := TextResponse{
		Version:     versionInfo.Abbreviation,
		Attribution: versionInfo.Attribution,
		Chapter:     chapter,
	}

	if verse == "" {
		verses := make([]string, 0, len(chapterVerses))
		for _, chapterVerse := range chapterVerses {
			verses = append(verses, chapterVerse.Text)
		}
		response.Verses = verses
	} else {
		verseNumber, err := strconv.Atoi(verse)
		if err != nil {
			return TextResponse{}, fmt.Errorf("invalid verse")
		}
		for _, chapterVerse := range chapterVerses {
			if chapterVerse.Verse == verseNumber {
				response.Text = chapterVerse.Text
				response.Verse = verse
				return response, nil
			}
		}
		return TextResponse{}, fmt.Errorf("no verse found for the given reference")
	}

	return response, nil
}

func normalizedSearchLimit(limit int) int {
	if limit <= 0 {
		return 12
	}
	if limit > 50 {
		return 50
	}
	return limit
}

func normalizedSearchMode(mode string, input string) string {
	mode = strings.ToLower(strings.TrimSpace(mode))
	switch mode {
	case "phrase", "exact":
		return "phrase"
	case "any", "or":
		return "any"
	case "word", "words", "all", "and", "":
		if looksLikeQuotedPhrase(input) {
			return "phrase"
		}
		return "all"
	default:
		return "all"
	}
}

func looksLikeQuotedPhrase(input string) bool {
	input = strings.TrimSpace(input)
	return len(input) >= 2 && strings.HasPrefix(input, `"`) && strings.HasSuffix(input, `"`)
}

func unquoteSearchPhrase(input string) string {
	input = strings.TrimSpace(input)
	if looksLikeQuotedPhrase(input) {
		input = strings.TrimSpace(input[1 : len(input)-1])
	}
	return input
}

func ftsQuotedPhrase(input string) string {
	return `"` + strings.ReplaceAll(input, `"`, `""`) + `"`
}

func ftsPrefixPhrase(input string) (string, error) {
	terms := strings.Fields(normalizeBibleAlias(input))
	if len(terms) == 0 {
		return "", fmt.Errorf("search phrase is empty")
	}
	quotedTerms := make([]string, 0, len(terms))
	for index, term := range terms {
		quotedTerm := ftsQuotedPhrase(term)
		if index == len(terms)-1 {
			quotedTerm += "*"
		}
		quotedTerms = append(quotedTerms, quotedTerm)
	}
	return strings.Join(quotedTerms, " + "), nil
}

func ftsSearchQuery(input string, mode string) (string, error) {
	switch mode {
	case "phrase":
		phrase := unquoteSearchPhrase(input)
		if looksLikeQuotedPhrase(input) {
			if normalizeBibleAlias(phrase) == "" {
				return "", fmt.Errorf("search phrase is empty")
			}
			return ftsQuotedPhrase(phrase), nil
		}
		return ftsPrefixPhrase(phrase)
	case "any", "all":
		terms := strings.Fields(normalizeBibleAlias(input))
		if len(terms) == 0 {
			return "", fmt.Errorf("search query is empty")
		}
		quotedTerms := make([]string, 0, len(terms))
		for _, term := range terms {
			quotedTerms = append(quotedTerms, ftsQuotedPhrase(term))
		}
		operator := " AND "
		if mode == "any" {
			operator = " OR "
		}
		return strings.Join(quotedTerms, operator), nil
	default:
		return "", fmt.Errorf("unsupported search mode: %s", mode)
	}
}

func isAllVersionSearch(version string) bool {
	version = strings.TrimSpace(strings.ToUpper(version))
	return version == "" || version == "*" || version == "ALL"
}

func searchTextResult(version, input string, options SearchOptions) SearchTextResponse {
	mode := normalizedSearchMode(options.Mode, input)
	query, err := ftsSearchQuery(input, mode)
	if err != nil {
		return SearchTextResponse{Version: defaultVersion(version), Query: input, Mode: mode, Error: err.Error()}
	}

	versionFilter := ""
	args := []interface{}{query}
	responseVersion := "ALL"
	if !isAllVersionSearch(version) {
		versionInfo, err := versionInfoFor(version)
		if err != nil {
			return SearchTextResponse{Version: defaultVersion(version), Query: input, Mode: mode, Error: err.Error()}
		}
		responseVersion = versionInfo.Abbreviation
		versionFilter = " AND l.version = ?"
		args = append(args, versionInfo.Abbreviation)
	}

	limit := normalizedSearchLimit(options.Limit)
	args = append(args, limit)
	rows, err := db.Query(
		fmt.Sprintf(`
			SELECT
				l.version,
				l.table_name,
				l.b,
				l.c,
				l.v,
				bm25(%s) AS rank
			FROM %s
			JOIN %s l ON l.rowid = %s.rowid
			WHERE %s MATCH ?%s
			ORDER BY rank
			LIMIT ?`,
			biblestore.FTSTable,
			biblestore.FTSTable,
			biblestore.LookupTable,
			biblestore.FTSTable,
			biblestore.FTSTable,
			versionFilter,
		),
		args...,
	)
	if err != nil {
		return SearchTextResponse{Version: responseVersion, Query: input, Mode: mode, Error: err.Error()}
	}
	defer rows.Close()

	results := []SearchResult{}
	for rows.Next() {
		var result SearchResult
		var tableName string
		if err := rows.Scan(
			&result.Version,
			&tableName,
			&result.BookID,
			&result.Chapter,
			&result.Verse,
			&result.Rank,
		); err != nil {
			return SearchTextResponse{Version: responseVersion, Query: input, Mode: mode, Error: err.Error()}
		}
		if versionInfo, ok := cachedVersions[result.Version]; ok {
			result.Attribution = versionInfo.Attribution
		}

		book, ok := cachedBookDetails[result.BookID]
		if ok {
			result.Book = book.Name
			result.Reference = fmt.Sprintf("%s %d:%d", book.Name, result.Chapter, result.Verse)
		} else {
			result.Book = fmt.Sprintf("Book %d", result.BookID)
			result.Reference = fmt.Sprintf("%s %d:%d", result.Book, result.Chapter, result.Verse)
		}

		result.Text, err = fetchVerseTextByLocation(db, tableName, result.BookID, result.Chapter, result.Verse)
		if err != nil {
			return SearchTextResponse{Version: responseVersion, Query: input, Mode: mode, Error: err.Error()}
		}
		results = append(results, result)
	}
	if err := rows.Err(); err != nil {
		return SearchTextResponse{Version: responseVersion, Query: input, Mode: mode, Error: err.Error()}
	}

	return SearchTextResponse{
		Version: responseVersion,
		Query:   input,
		Mode:    mode,
		Results: results,
	}
}

type rpcRequest struct {
	JSONRPC string             `json:"jsonrpc"`
	ID      stdjson.RawMessage `json:"id,omitempty"`
	Method  string             `json:"method"`
	Params  stdjson.RawMessage `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string             `json:"jsonrpc"`
	ID      stdjson.RawMessage `json:"id,omitempty"`
	Result  interface{}        `json:"result,omitempty"`
	Error   *rpcError          `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func decodeParamArray(params stdjson.RawMessage) ([]stdjson.RawMessage, error) {
	if len(params) == 0 || string(params) == "null" {
		return []stdjson.RawMessage{}, nil
	}
	var values []stdjson.RawMessage
	if err := stdjson.Unmarshal(params, &values); err != nil {
		return nil, fmt.Errorf("params must be an array: %w", err)
	}
	return values, nil
}

func paramString(params []stdjson.RawMessage, index int, name string) (string, error) {
	if index >= len(params) {
		return "", fmt.Errorf("missing %s", name)
	}
	var value string
	if err := stdjson.Unmarshal(params[index], &value); err == nil {
		return value, nil
	}
	var number stdjson.Number
	decoder := stdjson.NewDecoder(strings.NewReader(string(params[index])))
	decoder.UseNumber()
	if err := decoder.Decode(&number); err == nil {
		return number.String(), nil
	}
	return "", fmt.Errorf("%s must be a string", name)
}

func paramInt(params []stdjson.RawMessage, index int, name string) (int, error) {
	value, err := paramString(params, index, name)
	if err != nil {
		return 0, err
	}
	number, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer", name)
	}
	return number, nil
}

func paramSearchOptions(params []stdjson.RawMessage, index int) (SearchOptions, error) {
	options := SearchOptions{Limit: 12, Mode: "all"}
	if index >= len(params) {
		return options, nil
	}

	var parsed SearchOptions
	if err := stdjson.Unmarshal(params[index], &parsed); err == nil {
		if parsed.Limit != 0 {
			options.Limit = parsed.Limit
		}
		if strings.TrimSpace(parsed.Mode) != "" {
			options.Mode = parsed.Mode
		}
		return options, nil
	}

	limit, err := paramInt(params, index, "limit")
	if err != nil {
		return SearchOptions{}, err
	}
	options.Limit = limit
	return options, nil
}

func handleRPC(method string, params []stdjson.RawMessage) (interface{}, *rpcError) {
	badParams := func(err error) (interface{}, *rpcError) {
		return nil, &rpcError{Code: -32602, Message: err.Error()}
	}

	switch method {
	case "bible.ready":
		return map[string]bool{"ready": true}, nil
	case "bible.getVersions":
		return getVersionsData(), nil
	case "bible.getText":
		version, err := paramString(params, 0, "version")
		if err != nil {
			return badParams(err)
		}
		book, err := paramString(params, 1, "book")
		if err != nil {
			return badParams(err)
		}
		chapter, err := paramString(params, 2, "chapter")
		if err != nil {
			return badParams(err)
		}
		return getTextResult(version, book, chapter), nil
	case "bible.getBookInfo":
		version, err := paramString(params, 0, "version")
		if err != nil {
			return badParams(err)
		}
		book, err := paramString(params, 1, "book")
		if err != nil {
			return badParams(err)
		}
		count, err := getBookInfoResult(version, book)
		if err != nil {
			return nil, &rpcError{Code: -32000, Message: err.Error()}
		}
		return count, nil
	case "bible.getChapterInfo":
		version, err := paramString(params, 0, "version")
		if err != nil {
			return badParams(err)
		}
		book, err := paramString(params, 1, "book")
		if err != nil {
			return badParams(err)
		}
		chapter, err := paramInt(params, 2, "chapter")
		if err != nil {
			return badParams(err)
		}
		count, err := getChapterInfoResult(version, book, chapter)
		if err != nil {
			return nil, &rpcError{Code: -32000, Message: err.Error()}
		}
		return count, nil
	case "bible.resolveReference":
		version, err := paramString(params, 0, "version")
		if err != nil {
			return badParams(err)
		}
		reference, err := paramString(params, 1, "reference")
		if err != nil {
			return badParams(err)
		}
		return resolveReferenceResult(version, reference), nil
	case "bible.getPassage":
		version, err := paramString(params, 0, "version")
		if err != nil {
			return badParams(err)
		}
		reference, err := paramString(params, 1, "reference")
		if err != nil {
			return badParams(err)
		}
		return getPassageResult(version, reference), nil
	case "bible.getBookMetadata":
		version, err := paramString(params, 0, "version")
		if err != nil {
			return badParams(err)
		}
		return getBookMetadataResult(version), nil
	case "bible.suggestReferences":
		version := "KJV"
		inputIndex := 0
		if len(params) > 1 {
			var err error
			version, err = paramString(params, 0, "version")
			if err != nil {
				return badParams(err)
			}
			inputIndex = 1
		}
		input, err := paramString(params, inputIndex, "input")
		if err != nil {
			return badParams(err)
		}
		return suggestReferencesResult(version, input), nil
	case "bible.searchText":
		version, err := paramString(params, 0, "version")
		if err != nil {
			return badParams(err)
		}
		query, err := paramString(params, 1, "query")
		if err != nil {
			return badParams(err)
		}
		options, err := paramSearchOptions(params, 2)
		if err != nil {
			return badParams(err)
		}
		return searchTextResult(version, query, options), nil
	default:
		return nil, &rpcError{Code: -32601, Message: "method not found"}
	}
}

func serveJSONRPC(input io.Reader, output io.Writer) error {
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	writer := bufio.NewWriter(output)
	defer writer.Flush()

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var request rpcRequest
		response := rpcResponse{JSONRPC: "2.0"}
		if err := stdjson.Unmarshal([]byte(line), &request); err != nil {
			response.Error = &rpcError{Code: -32700, Message: err.Error()}
		} else {
			response.ID = request.ID
			params, err := decodeParamArray(request.Params)
			if err != nil {
				response.Error = &rpcError{Code: -32602, Message: err.Error()}
			} else {
				result, rpcErr := handleRPC(request.Method, params)
				if rpcErr != nil {
					response.Error = rpcErr
				} else {
					response.Result = result
				}
			}
		}

		payload, err := stdjson.Marshal(response)
		if err != nil {
			return err
		}
		if _, err := writer.Write(payload); err != nil {
			return err
		}
		if err := writer.WriteByte('\n'); err != nil {
			return err
		}
		if err := writer.Flush(); err != nil {
			return err
		}
	}
	return scanner.Err()
}

func main() {
	dbPath := flag.String("db", os.Getenv("EMS_BIBLE_DB"), "Path to the Bible SQLite database")
	flag.Parse()
	log.SetOutput(os.Stderr)

	if err := initBibleDatabase(*dbPath); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	if err := serveJSONRPC(os.Stdin, os.Stdout); err != nil {
		log.Fatal(err)
	}
}
