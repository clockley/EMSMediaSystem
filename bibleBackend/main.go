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
	"strconv"
	"strings"
	"syscall/js"

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

type Book struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Testament string `json:"testament"`
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

	js.Global().Set("_getVersions", js.FuncOf(getVersions))
	js.Global().Set("_getBooks", js.FuncOf(getBooks))
	js.Global().Set("_getText", js.FuncOf(getText))
	js.Global().Set("_getBookInfo", js.FuncOf(getBookInfo))
	js.Global().Set("_getChapterInfo", js.FuncOf(getChapterInfo))

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

func getVersions(this js.Value, p []js.Value) interface{} {
	stream := jsoniter.ConfigFastest.BorrowStream(nil)
	defer jsoniter.ConfigFastest.ReturnStream(stream)
	stream.WriteVal(cachedVersions)
	return string(stream.Buffer())
}

func getBooks(this js.Value, p []js.Value) interface{} {
	var books []Book
	for name, id := range cachedBooks {
		books = append(books, Book{ID: id, Name: name})
	}
	stream := jsoniter.ConfigFastest.BorrowStream(nil)
	defer jsoniter.ConfigFastest.ReturnStream(stream)
	stream.WriteVal(books)
	return string(stream.Buffer())
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
