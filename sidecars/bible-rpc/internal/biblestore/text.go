package biblestore

import (
	"encoding/json"
	"fmt"

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
