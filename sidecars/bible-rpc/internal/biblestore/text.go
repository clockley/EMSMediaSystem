package biblestore

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode"

	"github.com/go-compressions/lzfse"
)

const (
	MetadataTable = "bible_storage_metadata"
	LookupTable   = "bible_verse_lookup"
	FTSTable      = "bible_text_fts"
	ChapterTable  = "bible_chapter_text"

	TextEncodingKey   = "text_encoding"
	TextEncodingLZFSE = "lzfse"

	TextStorageKey              = "text_storage"
	TextStorageChapterLZFSEJSON = "chapter_lzfse_json"
)

type ChapterVerse struct {
	Verse int    `json:"verse"`
	Text  string `json:"text"`
}

func CleanBibleVerseText(text string) string {
	return strings.TrimSpace(collapseWhitespace(stripBraceAnnotations(text)))
}

func stripBraceAnnotations(text string) string {
	if !strings.Contains(text, "{") {
		return text
	}

	runes := []rune(text)
	var out strings.Builder
	out.Grow(len(text))

	for index := 0; index < len(runes); index++ {
		if runes[index] != '{' {
			out.WriteRune(runes[index])
			continue
		}

		closeIndex := closingBraceIndex(runes, index)
		if closeIndex < 0 {
			out.WriteRune(runes[index])
			continue
		}
		index = closeIndex
	}

	return out.String()
}

func closingBraceIndex(runes []rune, openIndex int) int {
	depth := 0
	for index := openIndex; index < len(runes); index++ {
		switch runes[index] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return index
			}
		}
	}
	return -1
}

func collapseWhitespace(text string) string {
	var out strings.Builder
	out.Grow(len(text))
	pendingSpace := false

	for _, r := range text {
		if unicode.IsSpace(r) {
			pendingSpace = true
			continue
		}
		if pendingSpace && out.Len() > 0 {
			out.WriteRune(' ')
		}
		out.WriteRune(r)
		pendingSpace = false
	}

	return out.String()
}

func CompressChapterVerses(verses []ChapterVerse) ([]byte, error) {
	payload, err := json.Marshal(verses)
	if err != nil {
		return nil, fmt.Errorf("marshal chapter text: %w", err)
	}
	compressed, err := lzfse.Compress(payload)
	if err != nil {
		return nil, fmt.Errorf("lzfse compress chapter: %w", err)
	}
	return compressed, nil
}

func DecompressChapterVerses(data []byte) ([]ChapterVerse, error) {
	payload, err := lzfse.Decompress(data)
	if err != nil {
		return nil, fmt.Errorf("lzfse decompress chapter: %w", err)
	}
	var verses []ChapterVerse
	if err := json.Unmarshal(payload, &verses); err != nil {
		return nil, fmt.Errorf("unmarshal chapter text: %w", err)
	}
	return verses, nil
}
