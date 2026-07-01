package songimport

import (
	"encoding/json"
	"fmt"
	"strings"
)

func parseLegacyLinesJSON(rawFields map[string]json.RawMessage, lines []string, sourceName string) (ParsedSong, error) {
	title := readStringField(rawFields, "title", "Title")
	author := readStringField(rawFields, "author", "Author", "artist", "Artist")
	copyright := readStringField(rawFields, "copyright", "Copyright")
	meter := readStringField(rawFields, "meter", "Meter", "metre", "Metre")
	ccli := readStringField(rawFields, "ccli", "ccliNumber", "CCLI")

	var ccliPtr *string
	if ccli != "" {
		ccliPtr = &ccli
	}

	authors := []string{}
	if author != "" {
		authors = append(authors, author)
	}

	stanzaLines := [][]string{}
	current := []string{}
	for _, raw := range lines {
		if strings.TrimSpace(raw) == "" {
			if len(current) > 0 {
				stanzaLines = append(stanzaLines, current)
				current = nil
			}
			continue
		}
		current = append(current, raw)
	}
	if len(current) > 0 {
		stanzaLines = append(stanzaLines, current)
	}

	sections := make([]ParsedSection, 0, len(stanzaLines))
	for idx, stanza := range stanzaLines {
		number := idx + 1
		blocks := make([]ParsedBlock, 0, len(stanza))
		for _, line := range stanza {
			blocks = append(blocks, newParsedTextBlock(line))
		}
		sections = append(sections, ParsedSection{
			ID:     newID("sec"),
			Kind:   "verse",
			Number: intPtr(number),
			Label:  formatDefaultSectionLabel("verse", number),
			Blocks: blocks,
		})
	}

	playOrder := make([]ParsedSequenceEntry, 0, len(sections))
	for _, section := range sections {
		playOrder = append(playOrder, ParsedSequenceEntry{
			ID:        newID("seq"),
			SectionID: section.ID,
			Enabled:   boolPtr(true),
		})
	}

	song := ParsedSong{
		Schema: "ems.song.v1",
		ID:     newID("song"),
		Title:  title,
		Metadata: ParsedMetadata{
			Authors:    authors,
			Copyright:  copyright,
			CCLINumber: ccliPtr,
			Meter:      meter,
		},
		Sections:  sections,
		PlayOrder: playOrder,
	}

	normalizeParsedSong(&song, sourceName, true)
	return song, nil
}

func formatDefaultSectionLabel(kind string, number int) string {
	display := kind
	switch kind {
	case "verse":
		display = "Verse"
	case "chorus":
		display = "Chorus"
	case "bridge":
		display = "Bridge"
	default:
		if len(display) > 0 {
			display = strings.ToUpper(display[:1]) + display[1:]
		}
	}
	return fmt.Sprintf("%s %d", display, number)
}
