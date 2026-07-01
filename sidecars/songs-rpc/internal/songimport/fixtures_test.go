package songimport

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixtureDir(t *testing.T) string {
	t.Helper()
	dir := filepath.Join("..", "..", "..", "..", "tests", "fixtures", "songs")
	abs, err := filepath.Abs(dir)
	if err != nil {
		t.Fatalf("fixture path: %v", err)
	}
	if _, err := os.Stat(abs); err != nil {
		t.Fatalf("fixture directory missing at %s: %v", abs, err)
	}
	return abs
}

func fixturePath(t *testing.T, name string) string {
	t.Helper()
	return filepath.Join(fixtureDir(t), name)
}

func verseSections(song ParsedSong) []ParsedSection {
	out := make([]ParsedSection, 0, len(song.Sections))
	for _, section := range song.Sections {
		if section.Kind == "verse" {
			out = append(out, section)
		}
	}
	return out
}

func lyricLineTexts(section ParsedSection) []string {
	out := []string{}
	for _, block := range section.Blocks {
		if block.Type != "lyricLine" {
			continue
		}
		text := strings.TrimSpace(parsedBlockText(block))
		if text != "" {
			out = append(out, text)
		}
	}
	return out
}

func playOrderVerseLabels(song ParsedSong) []string {
	byID := make(map[string]ParsedSection, len(song.Sections))
	for _, section := range song.Sections {
		byID[section.ID] = section
	}
	out := []string{}
	for _, entry := range song.PlayOrder {
		section, ok := byID[entry.SectionID]
		if !ok || section.Kind != "verse" {
			continue
		}
		out = append(out, section.Label)
	}
	return out
}

func TestImportFixtures(t *testing.T) {
	t.Run("txt-basic", func(t *testing.T) {
		song, _, err := ParseFile(fixturePath(t, "txt-basic.input.txt"))
		if err != nil {
			t.Fatalf("ParseFile: %v", err)
		}
		if song.Schema != "ems.song.v1" {
			t.Fatalf("schema = %q, want ems.song.v1", song.Schema)
		}
		if song.Title != "Amazing Grace" {
			t.Fatalf("title = %q", song.Title)
		}
		if len(song.Metadata.Authors) != 1 || song.Metadata.Authors[0] != "John Newton" {
			t.Fatalf("authors = %#v", song.Metadata.Authors)
		}
		if song.Metadata.Copyright != "Public Domain" {
			t.Fatalf("copyright = %q", song.Metadata.Copyright)
		}
		if song.Metadata.Meter != "8.6.8.6" {
			t.Fatalf("meter = %q", song.Metadata.Meter)
		}
		if song.Metadata.CCLINumber == nil || *song.Metadata.CCLINumber != "22025" {
			t.Fatalf("ccli = %#v", song.Metadata.CCLINumber)
		}

		verses := verseSections(song)
		if len(verses) != 2 {
			t.Fatalf("verse section count = %d, want 2", len(verses))
		}
		if verses[0].Label != "Verse 1" || verses[1].Label != "Verse 2" {
			t.Fatalf("verse labels = %q, %q", verses[0].Label, verses[1].Label)
		}
		if len(lyricLineTexts(verses[0])) != 4 {
			t.Fatalf("Verse 1 line count = %d, want 4", len(lyricLineTexts(verses[0])))
		}
		if len(lyricLineTexts(verses[1])) != 4 {
			t.Fatalf("Verse 2 line count = %d, want 4", len(lyricLineTexts(verses[1])))
		}

		playLabels := playOrderVerseLabels(song)
		if len(playLabels) != 2 {
			t.Fatalf("play order verse count = %d, want 2 (%v)", len(playLabels), playLabels)
		}
		if playLabels[0] != "Verse 1" || playLabels[1] != "Verse 2" {
			t.Fatalf("play order = %v", playLabels)
		}
	})

	t.Run("txt-unbracketed", func(t *testing.T) {
		song, _, err := ParseFile(fixturePath(t, "txt-unbracketed.input.txt"))
		if err != nil {
			t.Fatalf("ParseFile: %v", err)
		}
		if song.Title != "Doxology" {
			t.Fatalf("title = %q", song.Title)
		}
		verses := verseSections(song)
		if len(verses) != 1 {
			t.Fatalf("verse section count = %d, want 1", len(verses))
		}
		if verses[0].Label != "Verse 1" {
			t.Fatalf("label = %q, want Verse 1", verses[0].Label)
		}
		lines := lyricLineTexts(verses[0])
		if len(lines) != 4 {
			t.Fatalf("line count = %d, want 4 (%v)", len(lines), lines)
		}
	})

	t.Run("legacy-lines", func(t *testing.T) {
		song, _, err := ParseFile(fixturePath(t, "legacy-lines.input.json"))
		if err != nil {
			t.Fatalf("ParseFile: %v", err)
		}
		if song.Title != "Holy, Holy, Holy" {
			t.Fatalf("title = %q", song.Title)
		}
		if song.Metadata.Meter != "11.12.12.10" {
			t.Fatalf("meter = %q", song.Metadata.Meter)
		}
		if song.Metadata.CCLINumber == nil || *song.Metadata.CCLINumber != "1853" {
			t.Fatalf("ccli = %#v", song.Metadata.CCLINumber)
		}
		verses := verseSections(song)
		if len(verses) != 2 {
			t.Fatalf("verse section count = %d, want 2", len(verses))
		}
		if verses[0].Label != "Verse 1" || verses[1].Label != "Verse 2" {
			t.Fatalf("verse labels = %q, %q", verses[0].Label, verses[1].Label)
		}
	})

	t.Run("hymnal-stanzas", func(t *testing.T) {
		song, _, err := ParseFile(fixturePath(t, "hymnal-stanzas.input.json"))
		if err != nil {
			t.Fatalf("ParseFile: %v", err)
		}
		if song.Title != "Be Thou My Vision" {
			t.Fatalf("title = %q", song.Title)
		}
		if song.SongNumber == nil || *song.SongNumber != 12 {
			t.Fatalf("songNumber = %#v, want 12", song.SongNumber)
		}
		verses := verseSections(song)
		if len(verses) != 2 {
			t.Fatalf("verse section count = %d, want 2", len(verses))
		}
		if verses[0].Label != "Verse 1" || verses[1].Label != "Verse 2" {
			t.Fatalf("verse labels = %q, %q", verses[0].Label, verses[1].Label)
		}
	})
}

func TestSearchTextFixturePraiseAST(t *testing.T) {
	song, _, err := ParseFile(fixturePath(t, "praise-ast.input.json"))
	if err != nil {
		t.Fatalf("ParseFile: %v", err)
	}

	got := SongAstToSearchText(song)
	expectedBytes, err := os.ReadFile(fixturePath(t, "praise-ast.expected.searchtext.txt"))
	if err != nil {
		t.Fatalf("read expected search text: %v", err)
	}
	expected := strings.TrimSpace(string(expectedBytes))
	if strings.TrimSpace(got) != expected {
		t.Fatalf("search text mismatch\n--- got ---\n%s\n--- want ---\n%s", got, expected)
	}
}
