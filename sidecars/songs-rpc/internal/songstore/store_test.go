package songstore

import (
	"path/filepath"
	"testing"
)

func TestConvertToDeckPreservesRepeatedPlayOrder(t *testing.T) {
	enabled := true
	song := Song{
		ID:    "song_order_test",
		Title: "Ordered Song",
		Sections: []SongSection{
			{ID: "verse_1", Kind: "verse", Label: "Verse 1"},
			{ID: "chorus", Kind: "chorus", Label: "Chorus"},
			{ID: "verse_2", Kind: "verse", Label: "Verse 2"},
		},
		PlayOrder: []PlayOrderEntry{
			{ID: "seq_1", SectionID: "verse_1", Enabled: &enabled},
			{ID: "seq_2", SectionID: "chorus", Enabled: &enabled},
			{ID: "seq_3", SectionID: "verse_2", Enabled: &enabled},
			{ID: "seq_4", SectionID: "chorus", Enabled: &enabled},
		},
	}

	deck := (&SongStore{}).ConvertToDeck(song)
	playOrder, ok := deck["playOrder"].([]map[string]interface{})
	if !ok {
		t.Fatalf("playOrder type = %T", deck["playOrder"])
	}
	if len(playOrder) != 4 || playOrder[1]["sectionId"] != "chorus" || playOrder[3]["sectionId"] != "chorus" {
		t.Fatalf("playOrder = %#v", playOrder)
	}
}

func TestSongStorePersistsMeterInSchemaAndAST(t *testing.T) {
	store, err := InitStore(filepath.Join(t.TempDir(), "songs.db"))
	if err != nil {
		t.Fatalf("InitStore failed: %v", err)
	}
	defer store.Close()

	rows, err := store.db.Query(`PRAGMA table_info(songs)`)
	if err != nil {
		t.Fatalf("PRAGMA table_info failed: %v", err)
	}
	hasMeter := false
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull int
		var dfltValue any
		var pk int
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dfltValue, &pk); err != nil {
			t.Fatalf("scan table_info failed: %v", err)
		}
		if name == "meter" {
			hasMeter = true
		}
	}
	rows.Close()
	if !hasMeter {
		t.Fatal("expected songs.meter column")
	}

	const meter = "7.5.7.5"
	song := Song{
		Schema: "ems.song.v1",
		ID:     "song_meter_test",
		Title:  "Meter Test",
		Metadata: SongMetadata{
			Authors: []string{"A. Writer"},
			Meter:   meter,
		},
		Sections: []SongSection{
			{
				ID:    "sec_1",
				Kind:  "verse",
				Label: "Verse 1",
				Blocks: []SongBlock{
					{
						Type: "lyricLine",
						ID:   "block_1",
						Primary: SongBlockPrimary{
							Lang: "en",
							Segments: []SongSegment{
								{Type: "text", Text: "Line one"},
							},
						},
					},
				},
			},
		},
	}
	if err := store.SaveSong(song, ""); err != nil {
		t.Fatalf("SaveSong failed: %v", err)
	}

	got, err := store.GetSong(song.ID)
	if err != nil {
		t.Fatalf("GetSong failed: %v", err)
	}
	ast, ok := got.(map[string]interface{})
	if !ok {
		t.Fatalf("expected AST map, got %T", got)
	}
	metadata, ok := ast["metadata"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected metadata map, got %T", ast["metadata"])
	}
	if metadata["meter"] != meter {
		t.Fatalf("expected metadata.meter %q, got %#v", meter, metadata["meter"])
	}
	hymnal, ok := metadata["hymnal"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected metadata.hymnal map, got %T", metadata["hymnal"])
	}
	if hymnal["meter"] != meter {
		t.Fatalf("expected metadata.hymnal.meter %q, got %#v", meter, hymnal["meter"])
	}

	results, err := store.Search(SearchOptions{})
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 search result, got %d", len(results))
	}
	if results[0].Meter != meter {
		t.Fatalf("expected search result meter %q, got %q", meter, results[0].Meter)
	}
}
