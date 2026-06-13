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
	"database/sql"
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
	"syscall/js"
	"unicode"

	_ "embed"

	jsoniter "github.com/json-iterator/go"

	_ "github.com/ncruces/go-sqlite3/driver"
	_ "github.com/ncruces/go-sqlite3/embed"
	"github.com/ncruces/go-sqlite3/vfs/memdb"
)

var json = jsoniter.ConfigFastest

//go:embed bible-sqlite.db
var bibleDB []byte

type Version struct {
	Abbreviation string `json:"abbreviation"`
	Version      string `json:"version"`
	TableName    string `json:"tableName"`
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
	Version string         `json:"version"`
	Books   []BookMetadata `json:"books"`
	Error   string         `json:"error,omitempty"`
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
	Version        string         `json:"version"`
	Reference      string         `json:"reference"`
	Book           string         `json:"book"`
	BookID         int            `json:"bookId"`
	Chapter        int            `json:"chapter"`
	Verse          int            `json:"verse,omitempty"`
	VerseEnd       int            `json:"verseEnd,omitempty"`
	VerseSelector  string         `json:"verseSelector,omitempty"`
	SelectedVerses []int          `json:"selectedVerses"`
	Verses         []PassageVerse `json:"verses"`
	Text           string         `json:"text"`
	Error          string         `json:"error,omitempty"`
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
	Chapter string   `json:"chapter"`
	Verse   string   `json:"verse,omitempty"`
	Text    string   `json:"text,omitempty"`
	Verses  []string `json:"verses,omitempty"`
	Error   string   `json:"error,omitempty"`
}

var db *sql.DB
var cachedVersions map[string]Version
var cachedBooks map[string]int // Mapping from book name to ID
var cachedBookDetails map[int]BookMetadata
var cachedBookOrder []BookMetadata
var cachedAliases map[string]string
var cachedAliasKeys []string
var cachedBookMetadataByVersion map[string]BookMetadataResponse

func init() {
	memdb.Create("bible-sqlite.db", bibleDB)

	var err error
	db, err = sql.Open("sqlite3", "file:/bible-sqlite.db?vfs=memdb")
	if err != nil {
		log.Fatal(err)
	}

	cachedVersions, err = fetchVersions(db)
	if err != nil {
		log.Fatal("Failed to cache versions and tables:", err)
	}

	cachedBooks, err = fetchBooksMap(db)
	if err != nil {
		log.Fatal("Failed to cache books:", err)
	}

	cachedBookOrder, cachedBookDetails, err = fetchBookDetails(db)
	if err != nil {
		log.Fatal("Failed to cache book details:", err)
	}
	cachedAliases, cachedAliasKeys, err = buildBookAliasCache(db, cachedBookOrder)
	if err != nil {
		log.Fatal("Failed to cache book aliases:", err)
	}
	cachedBookMetadataByVersion = make(map[string]BookMetadataResponse)

	js.Global().Set("_getVersions", js.FuncOf(getVersions))
	js.Global().Set("_getText", js.FuncOf(getText))
	js.Global().Set("_getBookInfo", js.FuncOf(getBookInfo))
	js.Global().Set("_getChapterInfo", js.FuncOf(getChapterInfo))
	js.Global().Set("_resolveReference", js.FuncOf(resolveReference))
	js.Global().Set("_getPassage", js.FuncOf(getPassage))
	js.Global().Set("_getBookMetadata", js.FuncOf(getBookMetadata))
	js.Global().Set("_suggestReferences", js.FuncOf(suggestReferences))

}

func fetchVersions(db *sql.DB) (map[string]Version, error) {
	query := `SELECT abbreviation, version, "table" FROM bible_version_key`
	rows, err := db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	versions := make(map[string]Version)
	for rows.Next() {
		var v Version
		if err := rows.Scan(&v.Abbreviation, &v.Version, &v.TableName); err != nil {
			return nil, err
		}
		versions[v.Abbreviation] = v
	}
	return versions, nil
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

func getVersions(this js.Value, p []js.Value) interface{} {
	stream := jsoniter.ConfigFastest.BorrowStream(nil)
	defer jsoniter.ConfigFastest.ReturnStream(stream)
	stream.WriteVal(cachedVersions)
	return string(stream.Buffer())
}

func writeJSON(value interface{}) string {
	stream := jsoniter.ConfigFastest.BorrowStream(nil)
	defer jsoniter.ConfigFastest.ReturnStream(stream)
	stream.WriteVal(value)
	return string(stream.Buffer())
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
	row := db.QueryRow(fmt.Sprintf("SELECT COUNT(DISTINCT c) FROM %s WHERE b = ?", tableName), bookID)
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
	row := db.QueryRow(fmt.Sprintf("SELECT COUNT(v) FROM %s WHERE b = ? AND c = ?", tableName), bookID, chapter)
	var count int
	if err := row.Scan(&count); err != nil {
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
	rows, err := db.Query(
		fmt.Sprintf("SELECT v, t FROM %s WHERE b = ? AND c = ? ORDER BY v", tableName),
		bookID,
		chapter,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	verses := []PassageVerse{}
	for rows.Next() {
		var verse PassageVerse
		if err := rows.Scan(&verse.Verse, &verse.Text); err != nil {
			return nil, err
		}
		verses = append(verses, verse)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return verses, nil
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

func resolveReference(this js.Value, p []js.Value) interface{} {
	if len(p) < 2 {
		return writeJSON(ReferenceResponse{Error: "Invalid arguments: Requires version and reference"})
	}
	resolved, err := resolveReferenceData(db, p[0].String(), p[1].String())
	if err != nil {
		return writeJSON(ReferenceResponse{
			Version: defaultVersion(p[0].String()),
			Input:   p[1].String(),
			Error:   err.Error(),
		})
	}
	return writeJSON(resolved)
}

func getPassage(this js.Value, p []js.Value) interface{} {
	if len(p) < 2 {
		return writeJSON(PassageResponse{Error: "Invalid arguments: Requires version and reference"})
	}

	versionInfo, err := versionInfoFor(p[0].String())
	if err != nil {
		return writeJSON(PassageResponse{Version: defaultVersion(p[0].String()), Error: err.Error()})
	}
	resolved, err := resolveReferenceData(db, versionInfo.Abbreviation, p[1].String())
	if err != nil {
		return writeJSON(PassageResponse{
			Version:   versionInfo.Abbreviation,
			Reference: p[1].String(),
			Error:     err.Error(),
		})
	}

	chapterVerses, err := fetchChapterVerses(db, versionInfo.TableName, resolved.BookID, resolved.Chapter)
	if err != nil {
		return writeJSON(PassageResponse{
			Version:   versionInfo.Abbreviation,
			Reference: resolved.Reference,
			Error:     err.Error(),
		})
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

	return writeJSON(PassageResponse{
		Version:        resolved.Version,
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
	})
}

func getBookMetadata(this js.Value, p []js.Value) interface{} {
	if len(p) < 1 {
		return writeJSON(BookMetadataResponse{Error: "Invalid arguments: Requires version"})
	}
	versionInfo, err := versionInfoFor(p[0].String())
	if err != nil {
		return writeJSON(BookMetadataResponse{Version: defaultVersion(p[0].String()), Error: err.Error()})
	}
	if cached, ok := cachedBookMetadataByVersion[versionInfo.Abbreviation]; ok {
		return writeJSON(cached)
	}
	tableName, err := safeTableName(versionInfo.TableName)
	if err != nil {
		return writeJSON(BookMetadataResponse{Version: versionInfo.Abbreviation, Error: err.Error()})
	}

	rows, err := db.Query(fmt.Sprintf("SELECT b, c, COUNT(v) FROM %s GROUP BY b, c ORDER BY b, c", tableName))
	if err != nil {
		return writeJSON(BookMetadataResponse{Version: versionInfo.Abbreviation, Error: err.Error()})
	}
	defer rows.Close()

	verseCountsByBook := make(map[int][]int)
	for rows.Next() {
		var bookID, chapter, verseCount int
		if err := rows.Scan(&bookID, &chapter, &verseCount); err != nil {
			return writeJSON(BookMetadataResponse{Version: versionInfo.Abbreviation, Error: err.Error()})
		}
		counts := verseCountsByBook[bookID]
		for len(counts) < chapter {
			counts = append(counts, 0)
		}
		counts[chapter-1] = verseCount
		verseCountsByBook[bookID] = counts
	}
	if err := rows.Err(); err != nil {
		return writeJSON(BookMetadataResponse{Version: versionInfo.Abbreviation, Error: err.Error()})
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
		Version: versionInfo.Abbreviation,
		Books:   books,
	}
	cachedBookMetadataByVersion[versionInfo.Abbreviation] = response
	return writeJSON(response)
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

func suggestReferences(this js.Value, p []js.Value) interface{} {
	if len(p) < 1 {
		return writeJSON(SuggestReferencesResponse{Error: "Invalid arguments: Requires input"})
	}
	version := "KJV"
	input := p[0].String()
	if len(p) >= 2 {
		version = p[0].String()
		input = p[1].String()
	}
	versionInfo, err := versionInfoFor(version)
	if err != nil {
		return writeJSON(SuggestReferencesResponse{
			Input:   input,
			Version: defaultVersion(version),
			Error:   err.Error(),
		})
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

	return writeJSON(SuggestReferencesResponse{
		Input:       input,
		Version:     versionInfo.Abbreviation,
		Suggestions: suggestions,
	})
}

func getText(this js.Value, p []js.Value) interface{} {
	if len(p) < 3 {
		return returnError("Invalid arguments: Requires version, book, and chapter")
	}

	version := p[0].String()
	bookName := p[1].String()
	chapterVerse := p[2].String()

	bookID, ok := cachedBooks[bookName]
	if !ok {
		return returnError("Book not found")
	}

	text, err := fetchText(db, version, bookName, bookID, chapterVerse)
	if err != nil {
		return returnError(err.Error())
	}

	return text
}

func getChapterInfo(this js.Value, p []js.Value) interface{} {
	if len(p) < 2 {
		return returnError("Invalid arguments: Requires version abbreviation and chapter reference (e.g., 'Acts 1')")
	}

	versionKey := p[0].String() // Version abbreviation
	chapterRef := p[1].String() // Chapter reference, e.g., "Acts 1"

	parts := strings.SplitN(chapterRef, " ", 2)
	if len(parts) != 2 {
		return returnError("Invalid chapter reference format. Expected format: 'BookName ChapterNumber'")
	}

	bookName := parts[0]
	chapterNumber, err := strconv.Atoi(parts[1])
	if err != nil {
		return returnError("Invalid chapter number: " + err.Error())
	}

	// Retrieve version info using the version key
	versionInfo, ok := cachedVersions[versionKey]
	if !ok {
		return returnError("Version key not found")
	}

	bookID, ok := cachedBooks[bookName]
	if !ok {
		return returnError("Book not found")
	}

	query := fmt.Sprintf("SELECT COUNT(v) FROM %s WHERE b = ? AND c = ?", versionInfo.TableName)
	row := db.QueryRow(query, bookID, chapterNumber)
	var verseCount int
	if err := row.Scan(&verseCount); err != nil {
		return returnError("Failed to fetch verse count: " + err.Error())
	}

	return js.ValueOf(verseCount)
}

func getBookInfo(this js.Value, p []js.Value) interface{} {
	if len(p) < 2 {
		return returnError("Invalid arguments: Requires version abbreviation and book name")
	}

	versionKey := p[0].String() // Use versionKey to align with your context
	bookName := p[1].String()

	// Retrieve version info using the version key
	versionInfo, ok := cachedVersions[versionKey] // Make sure 'cachedVersions' is the map containing version info
	if !ok {
		return returnError("Version key not found")
	}

	bookID, ok := cachedBooks[bookName]
	if !ok {
		return returnError("Book not found")
	}

	query := fmt.Sprintf("SELECT COUNT(DISTINCT c) FROM %s WHERE b = ?", versionInfo.TableName)
	row := db.QueryRow(query, bookID)
	var chapterCount int
	if err := row.Scan(&chapterCount); err != nil {
		return returnError("Failed to fetch chapter count: " + err.Error())
	}

	return js.ValueOf(chapterCount)
}

func fetchText(db *sql.DB, version string, bookName string, bookID int, chapterVerse string) (string, error) {
	versionInfo, ok := cachedVersions[version]
	if !ok {
		return "", fmt.Errorf("version not found: %s", version)
	}

	tableName := versionInfo.TableName

	colonIndex := strings.Index(chapterVerse, ":")
	var chapter, verse string
	if colonIndex == -1 {
		chapter = chapterVerse
	} else {
		chapter = chapterVerse[:colonIndex]
		verse = chapterVerse[colonIndex+1:]
	}

	var query string
	var args []interface{}
	if verse == "" {
		query = fmt.Sprintf("SELECT v, t FROM %s WHERE b = ? AND c = ?", tableName)
		args = append(args, bookID, chapter)
	} else {
		query = fmt.Sprintf("SELECT t FROM %s WHERE b = ? AND c = ? AND v = ?", tableName)
		args = append(args, bookID, chapter, verse)
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return "", fmt.Errorf("database query error: %v", err)
	}
	defer rows.Close()

	response := TextResponse{
		Chapter: chapter,
	}

	if verse == "" {
		var verses []string
		for rows.Next() {
			var verseNum int
			var verseText string
			if err := rows.Scan(&verseNum, &verseText); err != nil {
				return "", fmt.Errorf("error scanning verse text: %v", err)
			}
			verses = append(verses, verseText)
		}
		response.Verses = verses
	} else {
		if rows.Next() {
			var verseText string
			if err := rows.Scan(&verseText); err != nil {
				return "", fmt.Errorf("error scanning verse text: %v", err)
			}
			response.Text = verseText
			response.Verse = verse
		} else {
			return "", fmt.Errorf("no verse found for the given reference")
		}
	}

	if err := rows.Err(); err != nil {
		return "", fmt.Errorf("error during rows iteration: %v", err)
	}

	stream := jsoniter.ConfigFastest.BorrowStream(nil)
	defer jsoniter.ConfigFastest.ReturnStream(stream)
	stream.WriteVal(response)
	return string(stream.Buffer()), nil
}

func returnError(errMsg string) string {
	errorResponse := TextResponse{
		Error: errMsg,
	}
	stream := jsoniter.ConfigFastest.BorrowStream(nil)
	defer jsoniter.ConfigFastest.ReturnStream(stream)
	stream.WriteVal(errorResponse)
	return string(stream.Buffer())
}

func main() {
	// Keep the program running
	select {}
}
