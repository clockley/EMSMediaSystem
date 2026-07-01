package songimport

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const maxImportBytes = 512 * 1024

func ParseFile(path string) (ParsedSong, string, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return ParsedSong{}, "", err
	}
	if len(bytes) > maxImportBytes {
		return ParsedSong{}, "", fmt.Errorf("file is too large to import")
	}
	name := filepath.Base(path)
	trimmed := strings.TrimSpace(stripBOM(string(bytes)))
	if trimmed == "" {
		return ParsedSong{}, "", fmt.Errorf("file is empty")
	}
	return ParseContent(trimmed, name)
}

func ParseContent(source, sourceName string) (ParsedSong, string, error) {
	trimmed := strings.TrimSpace(stripBOM(source))
	if trimmed == "" {
		return ParsedSong{}, "", fmt.Errorf("file is empty")
	}

	switch DetectFormat(trimmed, sourceName) {
	case FormatJSON:
		song, err := ParseHymnalJSON(trimmed, sourceName)
		if err != nil {
			return ParsedSong{}, trimmed, err
		}
		if err := validateParsedSong(song); err != nil {
			return ParsedSong{}, trimmed, err
		}
		return song, trimmed, nil
	case FormatTXT:
		song, err := ParseTXTImport(trimmed, sourceName)
		if err != nil {
			return ParsedSong{}, trimmed, err
		}
		if err := validateParsedSong(song); err != nil {
			return ParsedSong{}, trimmed, err
		}
		return song, trimmed, nil
	default:
		return ParsedSong{}, trimmed, fmt.Errorf("unsupported song file format")
	}
}

func validateParsedSong(song ParsedSong) error {
	if len(song.Sections) == 0 {
		return fmt.Errorf("song has no sections")
	}
	hasLyric := false
	for _, section := range song.Sections {
		for _, block := range section.Blocks {
			if strings.TrimSpace(parsedBlockText(block)) != "" {
				hasLyric = true
				break
			}
		}
		if hasLyric {
			break
		}
	}
	if !hasLyric {
		return fmt.Errorf("song has no lyric blocks")
	}
	return nil
}

func stripBOM(s string) string {
	return strings.TrimPrefix(s, "\xef\xbb\xbf")
}
