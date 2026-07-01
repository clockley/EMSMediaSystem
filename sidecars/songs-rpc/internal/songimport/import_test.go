package songimport

import (
	"fmt"
	"testing"
)

func TestParseSectionLabel(t *testing.T) {
	tests := []struct {
		input    string
		expected roleNumLabel
	}{
		{"Verse 1", roleNumLabel{"verse", intPtr(1), "Verse 1"}},
		{"verse 2", roleNumLabel{"verse", intPtr(2), "verse 2"}},
		{"Chorus", roleNumLabel{"chorus", nil, "Chorus"}},
		{"Bridge 3", roleNumLabel{"bridge", intPtr(3), "Bridge 3"}},
		{"[bridge]", roleNumLabel{"bridge", nil, "bridge"}}, // assuming bracket stripped before or inside
		{"[break]", roleNumLabel{"break", nil, "break"}},
		{"something custom", roleNumLabel{"something custom", nil, "something custom"}},
	}

	for _, tc := range tests {
		res := parseSectionLabel(tc.input)
		if res.role != tc.expected.role {
			t.Errorf("For %q: expected role %q, got %q", tc.input, tc.expected.role, res.role)
		}
		if (res.number == nil && tc.expected.number != nil) || (res.number != nil && tc.expected.number == nil) || (res.number != nil && tc.expected.number != nil && *res.number != *tc.expected.number) {
			var gotNum, expNum string
			if res.number != nil {
				gotNum = fmt.Sprintf("%d", *res.number)
			} else {
				gotNum = "nil"
			}
			if tc.expected.number != nil {
				expNum = fmt.Sprintf("%d", *tc.expected.number)
			} else {
				expNum = "nil"
			}
			t.Errorf("For %q: expected number %s, got %s", tc.input, expNum, gotNum)
		}
		if res.label != tc.expected.label {
			t.Errorf("For %q: expected label %q, got %q", tc.input, tc.expected.label, res.label)
		}
	}
}

type roleNumLabel struct {
	role   string
	number *int
	label  string
}

func TestParseTXTImport(t *testing.T) {
	txtContent := `Title: Amazing Grace
Author: John Newton
Copyright: Public Domain
Meter: 8.6.8.6

[Verse 1]
Amazing grace how sweet the sound
That saved a wretch like me

[Chorus]
My chains are gone
I've been set free

[break]
Instrumental break
`

	song, err := ParseTXTImport(txtContent, "grace.txt")
	if err != nil {
		t.Fatalf("ParseTXTImport failed: %v", err)
	}

	if song.Title != "Amazing Grace" {
		t.Errorf("Expected title 'Amazing Grace', got %q", song.Title)
	}
	if len(song.Metadata.Authors) != 1 || song.Metadata.Authors[0] != "John Newton" {
		t.Errorf("Expected author 'John Newton', got %v", song.Metadata.Authors)
	}
	if song.Metadata.Copyright != "Public Domain" {
		t.Errorf("Expected copyright 'Public Domain', got %q", song.Metadata.Copyright)
	}
	if song.Metadata.Meter != "8.6.8.6" {
		t.Errorf("Expected meter '8.6.8.6', got %q", song.Metadata.Meter)
	}

	if len(song.Sections) != 4 {
		t.Fatalf("Expected title slide plus 3 sections, got %d", len(song.Sections))
	}

	titleSection := song.Sections[0]
	if titleSection.Kind != "title" || titleSection.Label != "Title" {
		t.Fatalf("Expected Title section, got kind=%q, label=%q", titleSection.Kind, titleSection.Label)
	}
	titleLines := lyricLineTexts(titleSection)
	if len(titleLines) != 2 || titleLines[0] != "Amazing Grace" || titleLines[1] != "Author: John Newton" {
		t.Fatalf("title lines = %v, want title and author", titleLines)
	}

	sec1 := song.Sections[1]
	if sec1.Kind != "verse" || sec1.Label != "Verse 1" || *sec1.Number != 1 {
		t.Errorf("Expected Verse 1, got kind=%q, label=%q", sec1.Kind, sec1.Label)
	}
	if len(sec1.Blocks) != 2 || parsedBlockText(sec1.Blocks[0]) != "Amazing grace how sweet the sound" {
		t.Errorf("Unexpected blocks in Verse 1: %v", sec1.Blocks)
	}

	sec2 := song.Sections[2]
	if sec2.Kind != "chorus" || sec2.Label != "Chorus" || sec2.Number != nil {
		t.Errorf("Expected Chorus, got kind=%q, label=%q", sec2.Kind, sec2.Label)
	}

	sec3 := song.Sections[3]
	if sec3.Kind != "break" || sec3.Label != "break" {
		t.Errorf("Expected break, got kind=%q, label=%q", sec3.Kind, sec3.Label)
	}
}

func TestParseTXTImportSkipsLeadingProPresenterTag(t *testing.T) {
	txtContent := `Tag
SDA Hymnal #9
Let All the World in Every Corner Sing

[Verse 1]
Let all the world in every corner sing
My God and King
`

	song, err := ParseTXTImport(txtContent, "hymn-009.txt")
	if err != nil {
		t.Fatalf("ParseTXTImport failed: %v", err)
	}

	if song.Title != "Let All the World in Every Corner Sing" {
		t.Fatalf("title = %q, want tag title", song.Title)
	}
	if song.SongNumber == nil || *song.SongNumber != 9 {
		t.Fatalf("songNumber = %#v, want 9", song.SongNumber)
	}
	if number, ok := song.Metadata.Hymnal["number"].(string); !ok || number != "9" {
		t.Fatalf("metadata.hymnal.number = %#v, want 9", song.Metadata.Hymnal["number"])
	}
	if name, ok := song.Metadata.Hymnal["name"].(string); !ok || name != "SDA Hymnal" {
		t.Fatalf("metadata.hymnal.name = %#v, want SDA Hymnal", song.Metadata.Hymnal["name"])
	}

	if len(song.Sections) != 2 {
		t.Fatalf("section count = %d, want title plus Verse 1", len(song.Sections))
	}
	titleSection := song.Sections[0]
	if titleSection.Kind != "title" || titleSection.Label != "Title" {
		t.Fatalf("first section = kind %q label %q, want Title", titleSection.Kind, titleSection.Label)
	}
	titleLines := lyricLineTexts(titleSection)
	if len(titleLines) != 2 || titleLines[0] != "Let All the World in Every Corner Sing" || titleLines[1] != "SDA Hymnal #9" {
		t.Fatalf("title lines = %v, want title and source number", titleLines)
	}

	section := song.Sections[1]
	if section.Kind != "verse" || section.Label != "Verse 1" {
		t.Fatalf("second section = kind %q label %q, want Verse 1", section.Kind, section.Label)
	}
	for _, line := range lyricLineTexts(section) {
		switch line {
		case "Tag", "SDA Hymnal #9", "Let All the World in Every Corner Sing":
			t.Fatalf("leading tag line leaked into lyrics: %q", line)
		}
	}
}

func TestParseTXTImportSkipsLeadingProPresenterTagWithNumberedTitle(t *testing.T) {
	txtContent := `Title:#20 O Praise Ye the Lord
Author:

Tag
SDA Hymnal #20
O Praise Ye the Lord

Verse 1
O praise ye the Lord!
Praise Him in the height;

Rejoice in His word,
Ye angels of light;

Verse 2
O praise ye the Lord!
Praise Him upon earth,
`

	song, err := ParseTXTImport(txtContent, "020.txt")
	if err != nil {
		t.Fatalf("ParseTXTImport failed: %v", err)
	}

	if song.Title != "O Praise Ye the Lord" {
		t.Fatalf("title = %q, want O Praise Ye the Lord", song.Title)
	}
	if song.SongNumber == nil || *song.SongNumber != 20 {
		t.Fatalf("songNumber = %#v, want 20", song.SongNumber)
	}
	if len(song.Metadata.Authors) != 0 {
		t.Fatalf("authors = %#v, want none", song.Metadata.Authors)
	}
	if number, ok := song.Metadata.Hymnal["number"].(string); !ok || number != "20" {
		t.Fatalf("metadata.hymnal.number = %#v, want 20", song.Metadata.Hymnal["number"])
	}
	if name, ok := song.Metadata.Hymnal["name"].(string); !ok || name != "SDA Hymnal" {
		t.Fatalf("metadata.hymnal.name = %#v, want SDA Hymnal", song.Metadata.Hymnal["name"])
	}

	if len(song.Sections) != 3 {
		t.Fatalf("section count = %d, want title plus 2 verses", len(song.Sections))
	}
	titleSection := song.Sections[0]
	if titleSection.Kind != "title" || titleSection.Label != "Title" {
		t.Fatalf("first section = kind %q label %q, want Title", titleSection.Kind, titleSection.Label)
	}
	titleLines := lyricLineTexts(titleSection)
	if len(titleLines) != 2 || titleLines[0] != "O Praise Ye the Lord" || titleLines[1] != "SDA Hymnal #20" {
		t.Fatalf("title lines = %v, want title and source number", titleLines)
	}

	verses := verseSections(song)
	if len(verses) != 2 {
		t.Fatalf("verse section count = %d, want 2", len(verses))
	}
	if verses[0].Label != "Verse 1" || verses[1].Label != "Verse 2" {
		t.Fatalf("verse labels = %q, %q", verses[0].Label, verses[1].Label)
	}
	for _, section := range song.Sections {
		if section.Kind == "title" {
			continue
		}
		for _, line := range lyricLineTexts(section) {
			switch line {
			case "Tag", "SDA Hymnal #20", "O Praise Ye the Lord":
				t.Fatalf("leading tag line leaked into lyrics: %q", line)
			}
		}
	}
}

func TestParseTXTImportReadsHymnalHeader(t *testing.T) {
	txtContent := `Title: Praise to the Lord
Hymnal:Hymn 1
PlayOrder:Verse 1

[Verse 1]
Praise to the Lord,
the Almighty, the King of creation!
`

	song, err := ParseTXTImport(txtContent, "001.txt")
	if err != nil {
		t.Fatalf("ParseTXTImport failed: %v", err)
	}
	if song.SongNumber == nil || *song.SongNumber != 1 {
		t.Fatalf("songNumber = %#v, want 1", song.SongNumber)
	}
	verses := verseSections(song)
	if len(verses) != 1 {
		t.Fatalf("verse section count = %d, want 1", len(verses))
	}
	lines := lyricLineTexts(verses[0])
	for _, line := range lines {
		if line == "Hymnal:Hymn 1" || line == "PlayOrder:Verse 1" {
			t.Fatalf("header line leaked into lyrics: %q", line)
		}
	}
	playLabels := playOrderVerseLabels(song)
	if len(playLabels) != 1 || playLabels[0] != "Verse 1" {
		t.Fatalf("play order = %v, want [Verse 1]", playLabels)
	}
}

func TestParseHymnalJSONMeter(t *testing.T) {
	jsonContent := `{
  "number": 12,
  "title": "Metered Song",
  "meter": "7.5.7.5",
  "stanzas": [
    {
      "reference": { "type": "Verse", "number": 1 },
      "lines": ["Line one", "Line two"]
    }
  ]
}`

	song, err := ParseHymnalJSON(jsonContent, "metered.json")
	if err != nil {
		t.Fatalf("ParseHymnalJSON failed: %v", err)
	}
	if song.Metadata.Meter != "7.5.7.5" {
		t.Fatalf("Expected meter '7.5.7.5', got %q", song.Metadata.Meter)
	}
}

func TestParseHymnalJSONNormalizesPublicDomainCopyright(t *testing.T) {
	jsonContent := `{
  "schema": "ems.song.v1",
  "id": "song_001",
  "title": "Public Domain Song",
  "metadata": {
    "authors": [],
    "copyright": "PublicDomain"
  },
  "sections": [
    {
      "id": "sec_1",
      "kind": "verse",
      "label": "Verse 1",
      "blocks": [
        {
          "type": "lyricLine",
          "id": "block_1",
          "primary": {
            "lang": "en",
            "segments": [
              { "type": "text", "text": "Line one" }
            ]
          },
          "translations": [],
          "annotations": []
        }
      ]
    }
  ]
}`

	song, err := ParseHymnalJSON(jsonContent, "public-domain.json")
	if err != nil {
		t.Fatalf("ParseHymnalJSON failed: %v", err)
	}
	if song.Metadata.Copyright != "Public Domain" {
		t.Fatalf("Expected copyright 'Public Domain', got %q", song.Metadata.Copyright)
	}
}

func TestParseTXTImportWithInternalBlankLines(t *testing.T) {
	txtContent := `Title: Praise to the Lord
Author: Joachim Neander

Verse 1
Praise to the Lord,
the Almighty, the King of creation!

O my soul, praise Him,
for He is thy health and salvation!

Verse 2
Praise to the Lord,
Who o’er all things so wondrously reigneth.

Shieldeth thee under His wings,
yea, so gently sustaineth!
`

	song, err := ParseTXTImport(txtContent, "praise.txt")
	if err != nil {
		t.Fatalf("ParseTXTImport failed: %v", err)
	}

	if len(song.Sections) != 3 {
		t.Fatalf("Expected title slide plus 2 sections, got %d", len(song.Sections))
	}
	titleLines := lyricLineTexts(song.Sections[0])
	if len(titleLines) != 2 || titleLines[0] != "Praise to the Lord" || titleLines[1] != "Author: Joachim Neander" {
		t.Fatalf("title lines = %v, want title and author", titleLines)
	}

	sec1 := song.Sections[1]
	if sec1.Label != "Verse 1" {
		t.Errorf("Expected Verse 1, got %q", sec1.Label)
	}
	// Verse 1 should include lyric blocks and spacer blocks:
	// 1: Praise to the Lord,
	// 2: the Almighty, the King of creation!
	// 3: (spacer)
	// 4: O my soul, praise Him,
	// 5: for He is thy health and salvation!
	if len(sec1.Blocks) < 4 {
		t.Errorf("Expected at least 4 blocks in Verse 1, got %d", len(sec1.Blocks))
	}

	sec2 := song.Sections[2]
	if sec2.Label != "Verse 2" {
		t.Errorf("Expected Verse 2, got %q", sec2.Label)
	}
}
