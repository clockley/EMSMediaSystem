package biblestore

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/go-compressions/lzfse"
)

const PsalmsBookID = 19

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

// CleanBibleVerseTextAtLocation applies presentation-specific cleanup that
// requires a verse location. Several flat Bible sources prepend an unnumbered
// Psalm superscription to verse 1 because their JSON format has nowhere else to
// store it. Keep those headings out of verse text shown or indexed by EMS.
func CleanBibleVerseTextAtLocation(book, chapter, verse int, text string) string {
	cleaned := CleanBibleVerseText(text)
	if book != PsalmsBookID || chapter < 1 || verse != 1 {
		return cleaned
	}
	return stripPsalmSuperscription(cleaned)
}

func stripPsalmSuperscription(text string) string {
	remainder := strings.TrimSpace(text)
	removedHeading := false

	for remainder != "" {
		clause, rest := leadingSentence(remainder)
		if !isPsalmSuperscriptionClause(clause) &&
			!(removedHeading && isPsalmSuperscriptionContinuation(clause)) {
			break
		}

		// In a few flattened sources (notably Psalm 18 in the KJV family),
		// the final words of the superscription and the verse body share one
		// sentence. Preserve the body following the narrator's introduction.
		if body, ok := psalmBodyAfterNarrator(clause); ok {
			return strings.TrimSpace(body + joinedRemainder(rest))
		}
		// A flat string with no sentence boundary may contain both a heading
		// and verse text from a lossy source conversion. Without a reliable
		// boundary, retain it rather than risk deleting Scripture text.
		if rest == "" {
			break
		}

		removedHeading = true
		remainder = rest
	}

	if removedHeading {
		if body, ok := psalmBodyAfterNarrator(remainder); ok {
			return strings.TrimSpace(body)
		}
		return strings.TrimSpace(remainder)
	}
	return text
}

func leadingSentence(text string) (string, string) {
	for index := 0; index < len(text); {
		r, size := utf8.DecodeRuneInString(text[index:])
		index += size
		if r != '.' && r != '!' && r != '?' {
			continue
		}

		end := index
		for end < len(text) {
			closing, closingSize := utf8.DecodeRuneInString(text[end:])
			if !strings.ContainsRune("\"'”’)]", closing) {
				break
			}
			end += closingSize
		}
		if end == len(text) {
			return strings.TrimSpace(text), ""
		}
		next, _ := utf8.DecodeRuneInString(text[end:])
		if unicode.IsSpace(next) {
			return strings.TrimSpace(text[:end]), strings.TrimSpace(text[end:])
		}
	}
	return strings.TrimSpace(text), ""
}

func joinedRemainder(rest string) string {
	if strings.TrimSpace(rest) == "" {
		return ""
	}
	return " " + strings.TrimSpace(rest)
}

func psalmBodyAfterNarrator(clause string) (string, bool) {
	lower := strings.ToLower(clause)
	markers := []string{
		": and he said, ",
		": and he will say, ",
		" he said: ",
		" and he said: ",
	}
	for _, marker := range markers {
		if index := strings.LastIndex(lower, marker); index >= 0 {
			return clause[index+len(marker):], true
		}
	}
	return "", false
}

func isPsalmSuperscriptionClause(clause string) bool {
	normalized := normalizedPsalmClause(clause)
	for _, prefix := range []string{
		"for the director of music",
		"for the chief musician",
		"for the chief music-maker",
		"for the choirmaster",
		"for the leader",
		"to the chief musician",
		"to the choirmaster",
		"to the leader",
		"unto the end",
		"to the end",
		"in parts according to verses",
		"the inscription of a title",
		"the psalm of david",
		"the prayer of david",
		"the praise of a canticle",
		"a psalm",
		"a song",
		"a prayer",
		"a praise",
		"a maskil",
		"a miktam",
		"a michtam",
		"a shiggaion",
		"a contemplation",
		"a meditation",
		"a canticle",
		"a secret treasure",
		"a poem",
		"an instruction",
		"prayer of david",
		"prayer by david",
		"prayer to david",
		"prayer to moses",
		"praise by david",
		"praise to david",
		"shiggaion of david",
		"michtam of david",
		"miktam of david",
		"maschil of david",
		"maschil of asaph",
		"maschil of ethan",
		"of understanding",
		"understanding for",
		"understanding to",
		"instruction to",
		"song of david",
		"song of ascents",
		"song of the ascents",
		"song of degrees",
		"of david",
		"by david",
		"to david",
		"of solomon",
		"by solomon",
		"to solomon",
		"of asaph",
		"by asaph",
		"of the sons of korah",
		"by the sons of korah",
		"by sons of korah",
		"for the sons of korah",
		"david's psalm of praise",
	} {
		if strings.HasPrefix(normalized, prefix) {
			return true
		}
	}
	return false
}

func isPsalmSuperscriptionContinuation(clause string) bool {
	normalized := normalizedPsalmClause(clause)
	for _, prefix := range []string{
		"to the tune of",
		"set to",
		"with stringed instruments",
		"with flutes",
		"on stringed instruments",
		"on a stringed instrument",
		"on an eight-stringed",
		"on the instrument",
		"according to",
		"for pipes",
		"for her who",
		"for the secrets",
		"for the oil and wine presses",
		"for the octave",
		"for the sabbath",
		"for teaching",
		"for remembrance",
		"to bring remembrance",
		"to bring to remembrance",
		"when ",
		"after ",
	} {
		if strings.HasPrefix(normalized, prefix) {
			return true
		}
	}
	return false
}

func normalizedPsalmClause(clause string) string {
	normalized := strings.ToLower(strings.TrimSpace(clause))
	return strings.TrimLeft(normalized, "—–- ['\"")
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
