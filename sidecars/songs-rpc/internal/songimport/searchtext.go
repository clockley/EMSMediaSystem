package songimport

import (
	"fmt"
	"strings"
)

// SongAstToSearchText builds a flat search string from a parsed canonical song AST.
// The format matches the EMS song plan and the JS songAstToSearchText helper.
func SongAstToSearchText(song ParsedSong) string {
	parts := []string{}

	if song.Title != "" {
		parts = append(parts, song.Title)
	}
	if song.SongNumber != nil && *song.SongNumber > 0 {
		parts = append(parts, fmt.Sprintf("#%d", *song.SongNumber))
		parts = append(parts, fmt.Sprintf("%d", *song.SongNumber))
	}

	if len(song.Metadata.Authors) > 0 {
		for _, author := range song.Metadata.Authors {
			if strings.TrimSpace(author) != "" {
				parts = append(parts, author)
			}
		}
	}
	if song.Metadata.CCLINumber != nil && strings.TrimSpace(*song.Metadata.CCLINumber) != "" {
		parts = append(parts, "CCLI "+strings.TrimSpace(*song.Metadata.CCLINumber))
	}
	if song.Metadata.Meter != "" {
		parts = append(parts, song.Metadata.Meter)
	}

	if song.Metadata.Hymnal != nil {
		if name, ok := song.Metadata.Hymnal["name"].(string); ok && strings.TrimSpace(name) != "" {
			parts = append(parts, name)
		}
		if number, ok := song.Metadata.Hymnal["number"].(string); ok && strings.TrimSpace(number) != "" {
			parts = append(parts, number)
		} else if number, ok := song.Metadata.Hymnal["number"].(float64); ok && number > 0 {
			parts = append(parts, fmt.Sprintf("%g", number))
		}
		if hymnalMeter, ok := song.Metadata.Hymnal["meter"].(string); ok {
			hymnalMeter = strings.TrimSpace(hymnalMeter)
			if hymnalMeter != "" && hymnalMeter != song.Metadata.Meter {
				parts = append(parts, hymnalMeter)
			}
		}
	}

	if len(song.Metadata.Tags) > 0 {
		for _, tag := range song.Metadata.Tags {
			if strings.TrimSpace(tag) != "" {
				parts = append(parts, tag)
			}
		}
	}

	for _, section := range song.Sections {
		if strings.TrimSpace(section.Label) != "" {
			parts = append(parts, section.Label)
		}
		for _, block := range section.Blocks {
			if block.Type != "lyricLine" {
				continue
			}
			lineText := parsedBlockText(block)
			if strings.TrimSpace(lineText) != "" {
				parts = append(parts, lineText)
			}
		}
	}

	text := strings.Join(parts, "\n")
	text = collapseHorizontalSpace(text)
	text = collapseBlankLines(text)
	return strings.TrimSpace(text)
}

func collapseHorizontalSpace(text string) string {
	var b strings.Builder
	b.Grow(len(text))
	inSpaces := false
	for _, r := range text {
		if r == ' ' || r == '\t' {
			if !inSpaces {
				b.WriteRune(' ')
				inSpaces = true
			}
			continue
		}
		inSpaces = false
		b.WriteRune(r)
	}
	return b.String()
}

func collapseBlankLines(text string) string {
	for strings.Contains(text, "\n\n") {
		text = strings.ReplaceAll(text, "\n\n", "\n")
	}
	return text
}
