package songimport

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var (
	sectionLabelRE      = regexp.MustCompile(`^\[(.+)\]$`)
	unbracketedHeaderRE = regexp.MustCompile(`(?i)^(verse|chorus|bridge|intro|outro|ending|interlude|pre-?chorus|tag)(\s+\d+)?$`)
)

func isUnbracketedSectionHeader(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" || len(trimmed) > 48 {
		return false
	}
	if sectionLabelRE.MatchString(trimmed) {
		return false
	}
	lower := strings.ToLower(trimmed)
	if lower == "tag" || lower == "tags" {
		return false
	}
	return unbracketedHeaderRE.MatchString(trimmed)
}

func parseBracketedSectionLabel(line string) *sectionLabelInfo {
	trimmed := strings.TrimSpace(line)
	match := sectionLabelRE.FindStringSubmatch(trimmed)
	if match == nil {
		return nil
	}
	parsed := parseSectionLabel(match[1])
	return &parsed
}

func isSectionHeaderLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return false
	}
	return parseBracketedSectionLabel(trimmed) != nil || isUnbracketedSectionHeader(trimmed)
}

func parseSectionHeaderLine(line string) sectionLabelInfo {
	trimmed := strings.TrimSpace(line)
	if parsed := parseBracketedSectionLabel(trimmed); parsed != nil {
		return *parsed
	}
	return parseSectionLabel(trimmed)
}

func createSectionFromHeader(line string) ParsedSection {
	parsed := parseSectionHeaderLine(line)
	return ParsedSection{
		ID:     newID("sec"),
		Kind:   parsed.role,
		Number: parsed.number,
		Label:  parsed.label,
		Blocks: []ParsedBlock{},
	}
}

func ParseLyricsEditorText(rawText string) []ParsedSection {
	rows := strings.Split(strings.ReplaceAll(rawText, "\r\n", "\n"), "\n")
	sections := make([]ParsedSection, 0)
	var currentSection *ParsedSection

	for _, rawRow := range rows {
		row := strings.TrimRight(rawRow, " \t")
		if isSectionHeaderLine(row) {
			section := createSectionFromHeader(row)
			sections = append(sections, section)
			currentSection = &sections[len(sections)-1]
			continue
		}

		if strings.TrimSpace(row) == "" {
			if currentSection != nil {
				currentSection.Blocks = append(currentSection.Blocks, newParsedTextBlock(""))
			}
			continue
		}

		if currentSection == nil {
			section := ParsedSection{
				ID:     newID("sec"),
				Kind:   "verse",
				Number: intPtr(1),
				Label:  "Verse 1",
				Blocks: []ParsedBlock{},
			}
			sections = append(sections, section)
			currentSection = &sections[len(sections)-1]
		}

		currentSection.Blocks = append(currentSection.Blocks, newParsedTextBlock(row))
	}

	return sections
}

type ParsedSegment struct {
	Type  string         `json:"type"`
	Text  string         `json:"text"`
	Style map[string]any `json:"style,omitempty"`
}

type ParsedBlockPrimary struct {
	Lang     string          `json:"lang"`
	Segments []ParsedSegment `json:"segments"`
}

type ParsedBlock struct {
	Type         string             `json:"type"`
	ID           string             `json:"id"`
	Primary      ParsedBlockPrimary `json:"primary"`
	Translations []any              `json:"translations"`
	Annotations  []any              `json:"annotations"`
}

func newParsedTextBlock(text string) ParsedBlock {
	blockType := "lyricLine"
	segments := []ParsedSegment{{Type: "text", Text: text}}
	if strings.TrimSpace(text) == "" {
		blockType = "spacer"
		segments = []ParsedSegment{}
	}
	return ParsedBlock{
		Type: blockType,
		ID:   newID("block"),
		Primary: ParsedBlockPrimary{
			Lang:     "en",
			Segments: segments,
		},
		Translations: []any{},
		Annotations:  []any{},
	}
}

func parsedBlockText(block ParsedBlock) string {
	if block.Type != "lyricLine" {
		return ""
	}
	var builder strings.Builder
	for _, segment := range block.Primary.Segments {
		builder.WriteString(segment.Text)
	}
	return builder.String()
}

func isSpacerBlock(block ParsedBlock) bool {
	return block.Type != "lyricLine" || strings.TrimSpace(parsedBlockText(block)) == ""
}

func normalizeCopyrightText(value string) string {
	text := strings.Join(strings.Fields(value), " ")
	if text == "" {
		return ""
	}
	compact := strings.NewReplacer(" ", "", "-", "", "_", "").Replace(text)
	if strings.EqualFold(compact, "PublicDomain") {
		return "Public Domain"
	}
	return text
}

type sectionLabelInfo struct {
	role   string
	number *int
	label  string
}

func parseSectionLabel(s string) sectionLabelInfo {
	trimmed := strings.TrimSpace(s)
	if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
		trimmed = strings.TrimSpace(trimmed[1 : len(trimmed)-1])
	}
	if trimmed == "" {
		return sectionLabelInfo{role: "verse", label: "Verse"}
	}

	re := regexp.MustCompile(`^(?i)(.*?)(?:\s+(\d+))?$`)
	match := re.FindStringSubmatch(trimmed)

	roleText := trimmed
	var numPtr *int
	if match != nil {
		roleText = strings.TrimSpace(match[1])
		if match[2] != "" {
			var num int
			if _, err := fmt.Sscanf(match[2], "%d", &num); err == nil {
				numPtr = &num
			}
		}
	}

	role := strings.ToLower(roleText)
	switch role {
	case "verse", "v":
		role = "verse"
	case "chorus", "c":
		role = "chorus"
	case "bridge", "b":
		role = "bridge"
	case "intro", "i":
		role = "intro"
	case "outro", "o":
		role = "outro"
	case "ending":
		role = "ending"
	case "interlude":
		role = "interlude"
	case "pre-chorus", "prechorus", "pre chorus", "p":
		role = "pre-chorus"
	case "tag", "t":
		role = "tag"
	case "break":
		role = "break"
	}

	return sectionLabelInfo{
		role:   role,
		number: numPtr,
		label:  trimmed,
	}
}

func newID(prefix string) string {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err == nil {
		return prefix + "_" + hex.EncodeToString(buf)
	}
	return prefix + "_" + fmt.Sprintf("%d", time.Now().UnixNano())
}

func intPtr(value int) *int {
	return &value
}

func boolPtr(value bool) *bool {
	return &value
}

func normalizeParsedSong(song *ParsedSong, sourceName string, injectTitleSlide bool) {
	if song.Schema == "" {
		song.Schema = "ems.song.v1"
	}
	if song.ID == "" {
		song.ID = newID("song")
	}
	if song.Title == "" {
		song.Title = strings.TrimSuffix(sourceName, filepath.Ext(sourceName))
	}

	re := regexp.MustCompile(`^(?i)(?:#|hymn\s*)(\d+)\s*-?\s*(.*)$`)
	if m := re.FindStringSubmatch(strings.TrimSpace(song.Title)); m != nil {
		var num int
		if _, err := fmt.Sscanf(m[1], "%d", &num); err == nil {
			if song.SongNumber == nil {
				song.SongNumber = &num
			}
			if strippedTitle := strings.TrimSpace(m[2]); strippedTitle != "" {
				song.Title = strippedTitle
			}
		}
	}

	if song.Metadata.Authors == nil {
		song.Metadata.Authors = []string{}
	}
	song.Metadata.Copyright = normalizeCopyrightText(song.Metadata.Copyright)
	song.Metadata.Meter = strings.Join(strings.Fields(song.Metadata.Meter), " ")
	if song.Metadata.Meter == "" && song.Metadata.Hymnal != nil {
		if rawMeter, ok := song.Metadata.Hymnal["meter"]; ok {
			if meter, ok := rawMeter.(string); ok {
				song.Metadata.Meter = strings.Join(strings.Fields(meter), " ")
			}
		}
	}
	for sectionIndex := range song.Sections {
		section := &song.Sections[sectionIndex]
		if section.ID == "" {
			section.ID = newID("sec")
		}
		if section.Kind == "" {
			section.Kind = "verse"
		}
		for blockIndex := range section.Blocks {
			section.Blocks[blockIndex] = normalizeParsedBlock(section.Blocks[blockIndex])
		}
	}

	hasTitleSlide := false
	if len(song.Sections) > 0 {
		firstSec := song.Sections[0]
		if firstSec.Kind == "title" || (firstSec.Kind == "tag" && len(firstSec.Blocks) <= 3 && strings.Contains(strings.ToLower(parsedBlockText(firstSec.Blocks[0])), "hymn")) {
			hasTitleSlide = true
		}
	}

	if injectTitleSlide && !hasTitleSlide {
		titleLines := titleSlideLines(song)

		if len(titleLines) > 0 {
			var blocks []ParsedBlock
			for _, line := range titleLines {
				blocks = append(blocks, newParsedTextBlock(line))
			}
			titleSecID := newID("sec")
			titleSection := ParsedSection{
				ID:     titleSecID,
				Kind:   "title",
				Label:  "Title",
				Blocks: blocks,
			}
			song.Sections = append([]ParsedSection{titleSection}, song.Sections...)

			if len(song.PlayOrder) > 0 {
				song.PlayOrder = append([]ParsedSequenceEntry{{
					ID:        newID("seq"),
					SectionID: titleSecID,
					Enabled:   boolPtr(true),
				}}, song.PlayOrder...)
			}
		}
	}
}

func titleSlideLines(song *ParsedSong) []string {
	if song == nil {
		return nil
	}

	var lines []string
	if title := strings.TrimSpace(song.Title); title != "" {
		lines = append(lines, title)
	}

	source := ""
	number := ""
	if song.Metadata.Hymnal != nil {
		if value, ok := song.Metadata.Hymnal["name"].(string); ok {
			source = strings.TrimSpace(value)
		}
		number = hymnalNumberText(song.Metadata.Hymnal["number"])
	}
	if number == "" && song.SongNumber != nil && *song.SongNumber > 0 {
		number = fmt.Sprintf("%d", *song.SongNumber)
	}

	switch {
	case source != "" && number != "":
		lines = append(lines, fmt.Sprintf("%s #%s", source, number))
	case source != "":
		lines = append(lines, source)
	case number != "":
		lines = append(lines, fmt.Sprintf("Hymn %s", number))
	}

	authors := nonEmptyStrings(song.Metadata.Authors)
	if len(authors) > 0 {
		lines = append(lines, "Author: "+strings.Join(authors, ", "))
	}

	return lines
}

func hymnalNumberText(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case float64:
		if typed > 0 {
			return fmt.Sprintf("%g", typed)
		}
	case int:
		if typed > 0 {
			return fmt.Sprintf("%d", typed)
		}
	}
	return ""
}

func nonEmptyStrings(values []string) []string {
	out := []string{}
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func normalizeParsedBlock(block ParsedBlock) ParsedBlock {
	if block.Type == "" {
		block.Type = "lyricLine"
	}
	if block.ID == "" {
		block.ID = newID("block")
	}
	if block.Primary.Lang == "" {
		block.Primary.Lang = "en"
	}
	if block.Primary.Segments == nil {
		block.Primary.Segments = []ParsedSegment{}
	}
	if block.Translations == nil {
		block.Translations = []any{}
	}
	if block.Annotations == nil {
		block.Annotations = []any{}
	}
	return block
}
