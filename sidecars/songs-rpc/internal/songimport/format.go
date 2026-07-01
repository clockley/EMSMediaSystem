package songimport

import (
	"strings"
)

type SongFormat int

const (
	FormatUnknown SongFormat = iota
	FormatJSON
	FormatTXT
)

func DetectFormat(source, sourceName string) SongFormat {
	trimmed := strings.TrimSpace(stripBOM(source))
	lowerName := strings.ToLower(sourceName)
	if strings.HasPrefix(trimmed, "{") || strings.HasSuffix(lowerName, ".json") {
		return FormatJSON
	}
	if looksLikeTXTImport(trimmed) {
		return FormatTXT
	}
	return FormatUnknown
}
