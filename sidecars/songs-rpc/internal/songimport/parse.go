package songimport

import (
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
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
	decoded, err := decodeSongFile(bytes)
	if err != nil {
		return ParsedSong{}, "", err
	}
	name := filepath.Base(path)
	trimmed := strings.TrimSpace(decoded)
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

// decodeSongFile converts the encodings commonly produced by Windows text
// editors to UTF-8 before format detection or parsing. UTF-8 remains the
// preferred format; Windows-1252 is used only when the input is not valid
// UTF-8 and does not look like UTF-16.
func decodeSongFile(data []byte) (string, error) {
	if len(data) >= 3 && data[0] == 0xef && data[1] == 0xbb && data[2] == 0xbf {
		data = data[3:]
		if !utf8.Valid(data) {
			return "", fmt.Errorf("file has a UTF-8 BOM but contains invalid UTF-8")
		}
		return string(data), nil
	}

	if len(data) >= 4 {
		switch {
		case data[0] == 0xff && data[1] == 0xfe && data[2] == 0x00 && data[3] == 0x00:
			return decodeUTF32(data[4:], binary.LittleEndian)
		case data[0] == 0x00 && data[1] == 0x00 && data[2] == 0xfe && data[3] == 0xff:
			return decodeUTF32(data[4:], binary.BigEndian)
		}
	}
	if len(data) >= 2 {
		switch {
		case data[0] == 0xff && data[1] == 0xfe:
			return decodeUTF16(data[2:], binary.LittleEndian)
		case data[0] == 0xfe && data[1] == 0xff:
			return decodeUTF16(data[2:], binary.BigEndian)
		}
	}

	if utf8.Valid(data) {
		return string(data), nil
	}
	if order, ok := detectBOMlessUTF16(data); ok {
		return decodeUTF16(data, order)
	}
	return decodeWindows1252(data), nil
}

func decodeUTF16(data []byte, order binary.ByteOrder) (string, error) {
	if len(data)%2 != 0 {
		return "", fmt.Errorf("UTF-16 file has an incomplete code unit")
	}
	units := make([]uint16, len(data)/2)
	for i := range units {
		units[i] = order.Uint16(data[i*2 : i*2+2])
	}
	return string(utf16.Decode(units)), nil
}

func decodeUTF32(data []byte, order binary.ByteOrder) (string, error) {
	if len(data)%4 != 0 {
		return "", fmt.Errorf("UTF-32 file has an incomplete code unit")
	}
	runes := make([]rune, 0, len(data)/4)
	for i := 0; i < len(data); i += 4 {
		value := order.Uint32(data[i : i+4])
		if value > utf8.MaxRune || value >= 0xd800 && value <= 0xdfff {
			return "", fmt.Errorf("UTF-32 file contains invalid code point U+%X", value)
		}
		runes = append(runes, rune(value))
	}
	return string(runes), nil
}

func detectBOMlessUTF16(data []byte) (binary.ByteOrder, bool) {
	if len(data) < 8 || len(data)%2 != 0 {
		return nil, false
	}
	pairs := len(data) / 2
	evenZeros, oddZeros := 0, 0
	for i, value := range data {
		if value != 0 {
			continue
		}
		if i%2 == 0 {
			evenZeros++
		} else {
			oddZeros++
		}
	}
	// ASCII-heavy UTF-16 has NUL bytes in at least half of one byte lane and
	// very few in the other. A conservative threshold avoids misclassifying
	// arbitrary binary input as lyrics.
	if oddZeros*2 >= pairs && evenZeros*10 <= pairs {
		return binary.LittleEndian, true
	}
	if evenZeros*2 >= pairs && oddZeros*10 <= pairs {
		return binary.BigEndian, true
	}
	return nil, false
}

func decodeWindows1252(data []byte) string {
	const replacements = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ"
	special := []rune(replacements)
	runes := make([]rune, 0, len(data))
	for _, value := range data {
		if value >= 0x80 && value <= 0x9f {
			runes = append(runes, special[value-0x80])
		} else {
			runes = append(runes, rune(value))
		}
	}
	return string(runes)
}
