package songimport

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
)

var hymnalReferenceRE = regexp.MustCompile(`(?i)^(?:(.*?)\s*)?(?:#|hymn\s*)(\d+)\b\s*(.*)$`)

func looksLikeTXTImport(source string) bool {
	trimmed := strings.TrimSpace(source)
	return len(trimmed) > 0 && !strings.HasPrefix(trimmed, "{")
}

func ParseTXTImport(trimmed string, sourceName string) (ParsedSong, error) {
	rows := strings.Split(strings.ReplaceAll(trimmed, "\r\n", "\n"), "\n")

	authors := []string{}
	copyright := ""
	meter := ""
	var ccliPtr *string
	title := ""
	playOrderRaw := ""
	var songNumber *int
	var hymnal map[string]any

	// Read headers from the beginning of the file.
	rowIdx := 0
	for ; rowIdx < len(rows); rowIdx++ {
		row := strings.TrimSpace(rows[rowIdx])
		if row == "" {
			continue
		}

		lower := strings.ToLower(row)
		if strings.HasPrefix(lower, "title:") {
			title = strings.TrimSpace(row[6:])
			continue
		}
		if strings.HasPrefix(lower, "author:") || strings.HasPrefix(lower, "artist:") || strings.HasPrefix(lower, "writer:") {
			author := strings.TrimSpace(row[7:])
			if author != "" {
				authors = append(authors, author)
			}
			continue
		}
		if strings.HasPrefix(lower, "copyright:") {
			copyright = strings.TrimSpace(row[10:])
			continue
		}
		if strings.HasPrefix(lower, "meter:") {
			meter = strings.TrimSpace(row[6:])
			continue
		}
		if strings.HasPrefix(lower, "metre:") {
			meter = strings.TrimSpace(row[6:])
			continue
		}
		if strings.HasPrefix(lower, "ccli:") {
			ccli := strings.TrimSpace(row[5:])
			if ccli != "" {
				ccliPtr = &ccli
			}
			continue
		}
		if strings.HasPrefix(lower, "hymnal:") || strings.HasPrefix(lower, "songbook:") {
			colon := strings.Index(row, ":")
			if colon >= 0 {
				parsedHymnal, parsedNumber := parseHymnalReference(row[colon+1:])
				if len(parsedHymnal) > 0 {
					hymnal = mergeHymnalMetadata(hymnal, parsedHymnal)
				}
				if parsedNumber != nil {
					songNumber = parsedNumber
				}
			}
			continue
		}
		if strings.HasPrefix(lower, "playorder:") || strings.HasPrefix(lower, "play order:") {
			colon := strings.Index(row, ":")
			if colon >= 0 {
				playOrderRaw = strings.TrimSpace(row[colon+1:])
			}
			continue
		}

		break
	}

	if tagLines, nextRow, ok := consumeLeadingProPresenterTag(rows, rowIdx); ok {
		rowIdx = nextRow
		applyLeadingTagMetadata(tagLines, &title, &songNumber, &hymnal)
	}

	// Scan remaining rows to see if there are any explicit section headers.
	hasExplicitHeaders := false
	for i := rowIdx; i < len(rows); i++ {
		row := strings.TrimSpace(rows[i])
		if isSectionHeaderLine(row) {
			hasExplicitHeaders = true
			break
		}
	}

	var sections []ParsedSection
	var currentSection *ParsedSection

	verseCount := 0
	chorusCount := 0
	bridgeCount := 0
	otherCount := 0

	getNextDefaultLabel := func(role string) (string, *int) {
		switch role {
		case "verse":
			verseCount++
			return fmt.Sprintf("Verse %d", verseCount), &verseCount
		case "chorus":
			chorusCount++
			return fmt.Sprintf("Chorus %d", chorusCount), &chorusCount
		case "bridge":
			bridgeCount++
			return fmt.Sprintf("Bridge %d", bridgeCount), &bridgeCount
		default:
			otherCount++
			return fmt.Sprintf("%s %d", strings.Title(role), otherCount), &otherCount
		}
	}

	for i := rowIdx; i < len(rows); i++ {
		row := strings.TrimSpace(rows[i])
		if row == "" {
			if hasExplicitHeaders {
				if currentSection != nil {
					currentSection.Blocks = append(currentSection.Blocks, newParsedTextBlock(""))
				}
			} else {
				currentSection = nil
			}
			continue
		}

		if isSectionHeaderLine(row) {
			if currentSection != nil {
				for len(currentSection.Blocks) > 0 && isSpacerBlock(currentSection.Blocks[len(currentSection.Blocks)-1]) {
					currentSection.Blocks = currentSection.Blocks[:len(currentSection.Blocks)-1]
				}
			}
			parsedHeader := parseSectionHeaderLine(row)
			sec := ParsedSection{
				ID:     newID("sec"),
				Kind:   parsedHeader.role,
				Number: parsedHeader.number,
				Label:  parsedHeader.label,
				Blocks: []ParsedBlock{},
			}
			sections = append(sections, sec)
			currentSection = &sections[len(sections)-1]
			continue
		}

		if currentSection == nil {
			label, num := getNextDefaultLabel("verse")
			sec := ParsedSection{
				ID:     newID("sec"),
				Kind:   "verse",
				Number: num,
				Label:  label,
				Blocks: []ParsedBlock{},
			}
			sections = append(sections, sec)
			currentSection = &sections[len(sections)-1]
		}

		currentSection.Blocks = append(currentSection.Blocks, newParsedTextBlock(row))
	}

	if currentSection != nil {
		for len(currentSection.Blocks) > 0 && isSpacerBlock(currentSection.Blocks[len(currentSection.Blocks)-1]) {
			currentSection.Blocks = currentSection.Blocks[:len(currentSection.Blocks)-1]
		}
	}

	if title == "" {
		title = strings.TrimSuffix(sourceName, filepath.Ext(sourceName))
	}

	if hymnal == nil {
		hymnal = map[string]any{}
	}
	if songNumber != nil {
		hymnal["number"] = fmt.Sprintf("%d", *songNumber)
	}

	song := ParsedSong{
		Schema:     "ems.song.v1",
		ID:         newID("song"),
		Title:      title,
		SongNumber: songNumber,
		Metadata: ParsedMetadata{
			Authors:    authors,
			Copyright:  copyright,
			CCLINumber: ccliPtr,
			Meter:      meter,
			Hymnal:     hymnal,
		},
		Sections: sections,
	}

	if playOrderRaw != "" {
		song.PlayOrder = buildPlayOrderFromLabels(sections, playOrderRaw)
	}

	normalizeParsedSong(&song, sourceName, true)
	return song, nil
}

func consumeLeadingProPresenterTag(rows []string, rowIdx int) ([]string, int, bool) {
	for rowIdx < len(rows) && strings.TrimSpace(rows[rowIdx]) == "" {
		rowIdx++
	}
	if rowIdx >= len(rows) || !strings.EqualFold(strings.TrimSpace(rows[rowIdx]), "tag") {
		return nil, rowIdx, false
	}

	tagLines := []string{}
	nextRow := rowIdx + 1
	for nextRow < len(rows) {
		line := strings.TrimSpace(rows[nextRow])
		if line == "" || isSectionHeaderLine(line) {
			break
		}
		tagLines = append(tagLines, line)
		nextRow++
	}
	for nextRow < len(rows) && strings.TrimSpace(rows[nextRow]) == "" {
		nextRow++
	}
	if nextRow >= len(rows) || !isSectionHeaderLine(strings.TrimSpace(rows[nextRow])) {
		return nil, rowIdx, false
	}
	return tagLines, nextRow, true
}

func applyLeadingTagMetadata(tagLines []string, title *string, songNumber **int, hymnal *map[string]any) {
	for _, line := range tagLines {
		if !looksLikeHymnalReference(line) {
			continue
		}
		parsedHymnal, parsedNumber := parseHymnalReference(line)
		if len(parsedHymnal) > 0 {
			*hymnal = mergeHymnalMetadata(*hymnal, parsedHymnal)
		}
		if parsedNumber != nil {
			*songNumber = parsedNumber
		}
	}

	if strings.TrimSpace(*title) != "" {
		return
	}
	for i := len(tagLines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(tagLines[i])
		if line == "" || looksLikeHymnalReference(line) {
			continue
		}
		*title = line
		return
	}
}

func parseHymnalReference(raw string) (map[string]any, *int) {
	value := strings.Join(strings.Fields(raw), " ")
	if value == "" {
		return nil, nil
	}

	meta := map[string]any{
		"display": value,
	}
	var songNumber *int
	if match := hymnalReferenceRE.FindStringSubmatch(value); match != nil {
		name := strings.TrimSpace(match[1])
		numberText := strings.TrimSpace(match[2])
		trailingTitle := strings.TrimSpace(match[3])
		var num int
		if _, err := fmt.Sscanf(numberText, "%d", &num); err == nil && num > 0 {
			songNumber = &num
			meta["number"] = fmt.Sprintf("%d", num)
		}
		if name != "" {
			meta["name"] = name
		}
		if trailingTitle != "" {
			meta["title"] = trailingTitle
		}
	}
	return meta, songNumber
}

func looksLikeHymnalReference(line string) bool {
	return hymnalReferenceRE.MatchString(strings.TrimSpace(line))
}

func mergeHymnalMetadata(existing map[string]any, incoming map[string]any) map[string]any {
	if existing == nil {
		existing = map[string]any{}
	}
	for key, value := range incoming {
		if strings.TrimSpace(fmt.Sprint(value)) != "" {
			existing[key] = value
		}
	}
	return existing
}

func buildPlayOrderFromLabels(sections []ParsedSection, playOrderRaw string) []ParsedSequenceEntry {
	labels := strings.FieldsFunc(playOrderRaw, func(r rune) bool {
		return r == ',' || r == ';' || r == '|'
	})
	byLabel := make(map[string]string, len(sections))
	for _, section := range sections {
		key := strings.ToLower(strings.TrimSpace(section.Label))
		if key != "" {
			byLabel[key] = section.ID
		}
	}

	sequence := make([]ParsedSequenceEntry, 0, len(labels))
	for _, label := range labels {
		label = strings.TrimSpace(label)
		if label == "" {
			continue
		}
		sectionID, ok := byLabel[strings.ToLower(label)]
		if !ok {
			continue
		}
		sequence = append(sequence, ParsedSequenceEntry{
			ID:        newID("seq"),
			SectionID: sectionID,
			Enabled:   boolPtr(true),
		})
	}
	return sequence
}
