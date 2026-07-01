package songimport

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
)

func readSongbookName(data map[string]json.RawMessage) string {
	keys := []string{
		"Songbook", "songbook", "SongbookName", "songbookName",
		"HymnalName", "hymnalName", "Collection", "collection", "Book", "book",
	}
	for _, key := range keys {
		if raw, ok := data[key]; ok {
			var value string
			if json.Unmarshal(raw, &value) == nil && strings.TrimSpace(value) != "" {
				return strings.TrimSpace(value)
			}
		}
	}
	return ""
}

func readStringField(data map[string]json.RawMessage, keys ...string) string {
	for _, key := range keys {
		if raw, ok := data[key]; ok {
			var value string
			if json.Unmarshal(raw, &value) == nil {
				return strings.TrimSpace(value)
			}
		}
	}
	return ""
}

func readOptionalInt(data map[string]json.RawMessage, keys ...string) *int {
	for _, key := range keys {
		if raw, ok := data[key]; ok {
			var number float64
			if json.Unmarshal(raw, &number) == nil && number > 0 && number == float64(int(number)) {
				n := int(number)
				return &n
			}
		}
	}
	return nil
}

type ParsedSection struct {
	ID     string        `json:"id"`
	Kind   string        `json:"kind"`
	Number *int          `json:"number,omitempty"`
	Label  string        `json:"label"`
	Blocks []ParsedBlock `json:"blocks"`
}

type ParsedSequenceEntry struct {
	ID        string `json:"id,omitempty"`
	SectionID string `json:"sectionId"`
	Enabled   *bool  `json:"enabled,omitempty"`
}

type ParsedArrangement struct {
	ID       string                `json:"id"`
	Name     string                `json:"name"`
	Sequence []ParsedSequenceEntry `json:"sequence"`
}

type ParsedMetadata struct {
	Authors    []string       `json:"authors"`
	Copyright  string         `json:"copyright"`
	CCLINumber *string        `json:"ccliNumber"`
	Meter      string         `json:"meter,omitempty"`
	Hymnal     map[string]any `json:"hymnal"`
	Tags       []string       `json:"tags"`
	Extra      map[string]any `json:"extra"`
}

type ParsedImportInfo struct {
	SourceType string `json:"sourceType"`
	SourceName string `json:"sourceName"`
}

type ParsedSong struct {
	Schema       string                `json:"schema"`
	ID           string                `json:"id"`
	Title        string                `json:"title"`
	SongNumber   *int                  `json:"songNumber,omitempty"`
	FolderID     *string               `json:"folderId,omitempty"`
	Metadata     ParsedMetadata        `json:"metadata"`
	Sections     []ParsedSection       `json:"sections"`
	Arrangements []ParsedArrangement   `json:"arrangements"`
	PlayOrder    []ParsedSequenceEntry `json:"playOrder,omitempty"`
}

type rawHymnalStanza struct {
	Blocks    []ParsedBlock `json:"blocks"`
	Lines     []string      `json:"lines"`
	Reference struct {
		Type   string `json:"type"`
		Number int    `json:"number"`
	} `json:"reference"`
}

type rawHymnalSong struct {
	Number      *int              `json:"number"`
	Title       string            `json:"title"`
	Author      *string           `json:"author"`
	Copyright   *string           `json:"copyright"`
	CcliNumber  *string           `json:"ccliNumber"`
	Meter       *string           `json:"meter"`
	Stanzas     []rawHymnalStanza `json:"stanzas"`
	StanzaOrder []string          `json:"stanzaOrder"`
}

func ParseHymnalJSON(trimmed string, sourceName string) (ParsedSong, error) {
	var ast ParsedSong
	if err := json.Unmarshal([]byte(trimmed), &ast); err == nil && len(ast.Sections) > 0 {
		normalizeParsedSong(&ast, sourceName, false)
		return ast, nil
	}

	var raw rawHymnalSong
	if err := json.Unmarshal([]byte(trimmed), &raw); err != nil {
		return ParsedSong{}, err
	}
	var rawFields map[string]json.RawMessage
	_ = json.Unmarshal([]byte(trimmed), &rawFields)

	if rawFields != nil {
		var legacyLines []string
		if rawLines, ok := rawFields["lines"]; ok {
			_ = json.Unmarshal(rawLines, &legacyLines)
		}
		if len(legacyLines) > 0 && len(raw.Stanzas) == 0 {
			song, err := parseLegacyLinesJSON(rawFields, legacyLines, sourceName)
			if err != nil {
				return ParsedSong{}, err
			}
			if err := validateParsedSong(song); err != nil {
				return ParsedSong{}, err
			}
			return song, nil
		}
	}

	if raw.Title == "" {
		raw.Title = strings.TrimSuffix(sourceName, filepath.Ext(sourceName))
	}

	var sections []ParsedSection
	for _, stanza := range raw.Stanzas {
		var blocks []ParsedBlock
		for _, block := range stanza.Blocks {
			blocks = append(blocks, normalizeParsedBlock(block))
		}
		if len(blocks) == 0 && len(stanza.Lines) > 0 {
			for _, line := range stanza.Lines {
				blocks = append(blocks, newParsedTextBlock(line))
			}
		}

		role := strings.ToLower(stanza.Reference.Type)
		if role == "" {
			role = "verse"
		}
		label := stanza.Reference.Type
		if stanza.Reference.Number > 0 {
			label = fmt.Sprintf("%s %d", label, stanza.Reference.Number)
		}

		num := stanza.Reference.Number
		var numPtr *int
		if num > 0 {
			numPtr = &num
		}

		sections = append(sections, ParsedSection{
			ID:     newID("sec"),
			Kind:   role,
			Number: numPtr,
			Label:  label,
			Blocks: blocks,
		})
	}

	authors := []string{}
	if raw.Author != nil && *raw.Author != "" {
		authors = append(authors, *raw.Author)
	}

	copyright := ""
	if raw.Copyright != nil {
		copyright = *raw.Copyright
	}

	var ccliPtr *string
	if raw.CcliNumber != nil && *raw.CcliNumber != "" {
		c := *raw.CcliNumber
		ccliPtr = &c
	}
	meter := ""
	if raw.Meter != nil {
		meter = strings.TrimSpace(*raw.Meter)
	}
	if meter == "" && rawFields != nil {
		meter = readStringField(rawFields, "meter", "Meter", "metre", "Metre")
	}

	song := ParsedSong{
		Schema:     "ems.song.v1",
		ID:         newID("song"),
		Title:      raw.Title,
		SongNumber: raw.Number,
		Metadata: ParsedMetadata{
			Authors:    authors,
			Copyright:  copyright,
			CCLINumber: ccliPtr,
			Meter:      meter,
		},
		Sections: sections,
	}

	if len(raw.StanzaOrder) > 0 {
		var sequence []ParsedSequenceEntry
		for _, orderLabel := range raw.StanzaOrder {
			found := false
			for _, sec := range sections {
				if strings.EqualFold(sec.Label, orderLabel) {
					sequence = append(sequence, ParsedSequenceEntry{
						ID:        newID("seq"),
						SectionID: sec.ID,
						Enabled:   boolPtr(true),
					})
					found = true
					break
				}
			}
			if !found {
				parsedOrder := parseSectionLabel(orderLabel)
				for _, sec := range sections {
					if sec.Kind == parsedOrder.role && (sec.Number == nil && parsedOrder.number == nil || (sec.Number != nil && parsedOrder.number != nil && *sec.Number == *parsedOrder.number)) {
						sequence = append(sequence, ParsedSequenceEntry{
							ID:        newID("seq"),
							SectionID: sec.ID,
							Enabled:   boolPtr(true),
						})
						break
					}
				}
			}
		}
		if len(sequence) > 0 {
			song.PlayOrder = sequence
		}
	}

	normalizeParsedSong(&song, sourceName, true)
	return song, nil
}
