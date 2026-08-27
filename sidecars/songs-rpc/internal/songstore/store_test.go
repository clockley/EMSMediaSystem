package songstore

import (
	"encoding/json"
	"os"
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

func TestSongStorePersistsCanonicalSongAndDerivedDeckSeparately(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "songs.db")
	store, err := InitStore(dbPath)
	if err != nil {
		t.Fatalf("InitStore failed: %v", err)
	}
	defer store.Close()

	document := map[string]interface{}{
		"schema": canonicalSongSchemaVersion,
		"id":     "canonical_round_trip",
		"title":  "Canonical Round Trip",
		"metadata": map[string]interface{}{
			"authors":    []interface{}{"First Author", "Second Author"},
			"copyright":  "Copyright 2026",
			"ccliNumber": "12345",
			"oneLicense": "A-6789",
			"hymnal": map[string]interface{}{
				"name":    "Test Hymnal",
				"number":  "42",
				"meter":   "8.6.8.6",
				"display": "No. 42",
			},
		},
		"sections": []interface{}{
			map[string]interface{}{
				"id":     "verse_1",
				"kind":   "verse",
				"number": 1,
				"label":  "Verse 1",
				"blocks": []interface{}{},
			},
			map[string]interface{}{
				"id":     "chorus",
				"kind":   "chorus",
				"label":  "Chorus",
				"blocks": []interface{}{},
			},
		},
		"playOrder": []interface{}{
			map[string]interface{}{"id": "play_1", "sectionId": "verse_1", "enabled": true},
			map[string]interface{}{"id": "play_2", "sectionId": "chorus", "enabled": true},
			map[string]interface{}{"id": "play_3", "sectionId": "chorus", "enabled": true},
		},
	}
	if err := store.SaveSongDocument(document, "original import"); err != nil {
		t.Fatalf("SaveSongDocument failed: %v", err)
	}

	var canonicalJSON, derivedJSON, schemaVersion, cacheVersion string
	if err := store.db.QueryRow(`
		SELECT canonical_json, derived_deck_json, schema_version, derived_deck_version
		FROM songs WHERE id = ?
	`, "canonical_round_trip").Scan(&canonicalJSON, &derivedJSON, &schemaVersion, &cacheVersion); err != nil {
		t.Fatalf("query stored song failed: %v", err)
	}
	var canonical, derived map[string]interface{}
	if err := json.Unmarshal([]byte(canonicalJSON), &canonical); err != nil {
		t.Fatalf("canonical_json is invalid: %v", err)
	}
	if err := json.Unmarshal([]byte(derivedJSON), &derived); err != nil {
		t.Fatalf("derived_deck_json is invalid: %v", err)
	}
	if canonical["schema"] != canonicalSongSchemaVersion || schemaVersion != canonicalSongSchemaVersion {
		t.Fatalf("canonical schema = %#v, schema_version = %q", canonical["schema"], schemaVersion)
	}
	if derived["schema"] != slideDeckSchemaVersion || cacheVersion != derivedDeckCacheVersion {
		t.Fatalf("derived schema = %#v, cache version = %q", derived["schema"], cacheVersion)
	}

	gotValue, err := store.GetSong("canonical_round_trip")
	if err != nil {
		t.Fatalf("GetSong failed: %v", err)
	}
	got := gotValue.(map[string]interface{})
	playOrder := genericSlice(got["playOrder"])
	if got["schema"] != canonicalSongSchemaVersion || len(playOrder) != 3 {
		t.Fatalf("round trip schema/playOrder = %#v/%#v", got["schema"], playOrder)
	}
	if playOrder[1].(map[string]interface{})["sectionId"] != "chorus" ||
		playOrder[2].(map[string]interface{})["sectionId"] != "chorus" {
		t.Fatalf("repeated play order was not preserved: %#v", playOrder)
	}

	if _, err := store.db.Exec(`
		UPDATE songs SET derived_deck_json = NULL, derived_deck_version = NULL
		WHERE id = ?
	`, "canonical_round_trip"); err != nil {
		t.Fatalf("clear derived cache failed: %v", err)
	}
	gotValue, err = store.GetSong("canonical_round_trip")
	if err != nil || gotValue.(map[string]interface{})["schema"] != canonicalSongSchemaVersion {
		t.Fatalf("canonical read after cache deletion failed: value=%#v err=%v", gotValue, err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close before cache rebuild failed: %v", err)
	}
	reopened, err := InitStore(dbPath)
	if err != nil {
		t.Fatalf("reopen for cache rebuild failed: %v", err)
	}
	defer reopened.Close()
	var rebuiltCache, rebuiltVersion string
	if err := reopened.db.QueryRow(`
		SELECT derived_deck_json, derived_deck_version
		FROM songs WHERE id = ?
	`, "canonical_round_trip").Scan(&rebuiltCache, &rebuiltVersion); err != nil {
		t.Fatalf("query rebuilt cache failed: %v", err)
	}
	if rebuiltCache == "" || rebuiltVersion != derivedDeckCacheVersion {
		t.Fatalf("cache was not rebuilt: version=%q json=%q", rebuiltVersion, rebuiltCache)
	}
}

func TestSongStoreMigratesLegacyDeckRowsIdempotently(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "songs.db")
	store, err := InitStore(dbPath)
	if err != nil {
		t.Fatalf("InitStore failed: %v", err)
	}
	legacyDeck := map[string]interface{}{
		"schema":       slideDeckSchemaVersion,
		"id":           "legacy_deck",
		"title":        "Legacy Deck",
		"documentType": "song",
		"metadata": map[string]interface{}{
			"authors":   []interface{}{"Legacy Author"},
			"copyright": "Legacy Copyright",
			"hymnal":    map[string]interface{}{"name": "Legacy Hymnal", "number": "9"},
		},
		"pages": []interface{}{
			map[string]interface{}{
				"id":    "verse",
				"kind":  "verse",
				"label": "Verse",
				"objects": []interface{}{
					map[string]interface{}{
						"kind": "text",
						"blocks": []interface{}{
							map[string]interface{}{
								"type": "lyricLine",
								"id":   "line_1",
								"primary": map[string]interface{}{
									"lang": "en",
									"segments": []interface{}{
										map[string]interface{}{"type": "text", "text": "Legacy lyric"},
									},
								},
							},
						},
					},
				},
			},
		},
		"playOrder": []interface{}{
			map[string]interface{}{"id": "one", "sectionId": "verse", "enabled": true},
			map[string]interface{}{"id": "two", "sectionId": "verse", "enabled": true},
		},
	}
	raw, _ := json.Marshal(legacyDeck)
	if _, err := store.db.Exec(`
		INSERT INTO songs (id, title, song_json, ast_json, schema_version)
		VALUES (?, ?, ?, ?, ?)
	`, "legacy_deck", "Legacy Deck", string(raw), string(raw), slideDeckSchemaVersion); err != nil {
		t.Fatalf("insert legacy row failed: %v", err)
	}
	mixedCanonical := map[string]interface{}{
		"schema": canonicalSongSchemaVersion,
		"id":     "mixed_row",
		"title":  "Richer Canonical",
		"metadata": map[string]interface{}{
			"authors":   []interface{}{"Canonical Author"},
			"copyright": "",
		},
		"sections": []interface{}{
			map[string]interface{}{
				"id":     "verse",
				"kind":   "verse",
				"number": 7,
				"label":  "Verse 7",
				"blocks": []interface{}{},
			},
		},
		"arrangements": []interface{}{
			map[string]interface{}{
				"id":   "arr_custom",
				"name": "Imported",
				"sequence": []interface{}{
					map[string]interface{}{"sectionId": "verse", "enabled": true},
					map[string]interface{}{"sectionId": "verse", "enabled": true},
				},
			},
		},
		"playOrder": []interface{}{
			map[string]interface{}{"sectionId": "verse", "enabled": true},
			map[string]interface{}{"sectionId": "verse", "enabled": true},
		},
	}
	mixedDeck := cloneDocument(legacyDeck)
	mixedDeck["id"] = "mixed_row"
	mixedDeckRaw, _ := json.Marshal(mixedDeck)
	mixedCanonicalRaw, _ := json.Marshal(mixedCanonical)
	if _, err := store.db.Exec(`
		INSERT INTO songs (id, title, song_json, ast_json, schema_version)
		VALUES (?, ?, ?, ?, ?)
	`, "mixed_row", "Mixed Row", string(mixedCanonicalRaw), string(mixedDeckRaw), slideDeckSchemaVersion); err != nil {
		t.Fatalf("insert mixed row failed: %v", err)
	}
	store.Close()

	for pass := 0; pass < 2; pass++ {
		store, err = InitStore(dbPath)
		if err != nil {
			t.Fatalf("InitStore migration pass %d failed: %v", pass+1, err)
		}
		gotValue, err := store.GetSong("legacy_deck")
		if err != nil {
			t.Fatalf("GetSong after migration pass %d failed: %v", pass+1, err)
		}
		got := gotValue.(map[string]interface{})
		if got["schema"] != canonicalSongSchemaVersion {
			t.Fatalf("migrated schema = %#v", got["schema"])
		}
		if len(genericSlice(got["playOrder"])) != 2 {
			t.Fatalf("migrated play order = %#v", got["playOrder"])
		}
		sections := genericSlice(got["sections"])
		blocks := genericSlice(sections[0].(map[string]interface{})["blocks"])
		if len(blocks) != 1 {
			t.Fatalf("migrated blocks = %#v", blocks)
		}
		mixedValue, err := store.GetSong("mixed_row")
		if err != nil {
			t.Fatalf("GetSong mixed row failed: %v", err)
		}
		mixed := mixedValue.(map[string]interface{})
		mixedSections := genericSlice(mixed["sections"])
		if mixedSections[0].(map[string]interface{})["number"] != float64(7) {
			t.Fatalf("mixed row did not prefer canonical section: %#v", mixedSections[0])
		}
		if len(genericSlice(mixed["arrangements"])) != 1 {
			t.Fatalf("mixed row arrangements were lost: %#v", mixed["arrangements"])
		}
		store.Close()
	}
}

func TestSongSearchUsesCompleteCanonicalMetadataAndLyrics(t *testing.T) {
	store, err := InitStore(filepath.Join(t.TempDir(), "songs.db"))
	if err != nil {
		t.Fatalf("InitStore failed: %v", err)
	}
	defer store.Close()
	document := map[string]interface{}{
		"schema": canonicalSongSchemaVersion,
		"id":     "search_metadata",
		"title":  "Search Metadata",
		"metadata": map[string]interface{}{
			"authors":    []interface{}{"Primary Writer", "Hidden Collaborator"},
			"copyright":  "Rare Copyright Phrase",
			"ccliNumber": "CCLI-9988",
			"oneLicense": "LICENSE-7766",
			"hymnal":     map[string]interface{}{"name": "Obscure Hymnal", "number": "314"},
		},
		"sections": []interface{}{
			map[string]interface{}{
				"id":    "verse",
				"kind":  "verse",
				"label": "Verse 1",
				"blocks": []interface{}{
					map[string]interface{}{
						"type": "lyricLine",
						"id":   "line",
						"primary": map[string]interface{}{
							"lang":     "en",
							"segments": []interface{}{map[string]interface{}{"type": "text", "text": "Primary lyric"}},
						},
						"translations": []interface{}{
							map[string]interface{}{
								"lang":     "es",
								"segments": []interface{}{map[string]interface{}{"type": "text", "text": "Traduccion unica"}},
							},
						},
					},
				},
			},
		},
	}
	if err := store.SaveSongDocument(document, ""); err != nil {
		t.Fatalf("SaveSongDocument failed: %v", err)
	}
	for _, query := range []string{"Collaborator", "Rare Copyright", "LICENSE-7766", "Obscure Hymnal", "Traduccion"} {
		results, err := store.Search(SearchOptions{Query: query})
		if err != nil {
			t.Fatalf("Search(%q) failed: %v", query, err)
		}
		if len(results) != 1 || results[0].ID != "search_metadata" {
			t.Fatalf("Search(%q) = %#v", query, results)
		}
	}
}

func TestImportFilesPreservesCanonicalMetadataAndRepeatedPlayOrder(t *testing.T) {
	tempDir := t.TempDir()
	store, err := InitStore(filepath.Join(tempDir, "songs.db"))
	if err != nil {
		t.Fatalf("InitStore failed: %v", err)
	}
	defer store.Close()
	document := map[string]interface{}{
		"schema": canonicalSongSchemaVersion,
		"id":     "canonical_import",
		"title":  "Canonical Import",
		"metadata": map[string]interface{}{
			"authors":    []interface{}{"Import Author"},
			"copyright":  "Import Copyright",
			"ccliNumber": "123",
			"oneLicense": "A-999",
			"hymnal":     map[string]interface{}{"name": "Import Hymnal", "number": "12"},
			"extra":      map[string]interface{}{"sourceKey": "preserve-me"},
		},
		"sections": []interface{}{
			map[string]interface{}{
				"id":    "chorus",
				"kind":  "chorus",
				"label": "Chorus",
				"blocks": []interface{}{
					map[string]interface{}{
						"type": "lyricLine",
						"id":   "line",
						"primary": map[string]interface{}{
							"lang":     "en",
							"segments": []interface{}{map[string]interface{}{"type": "text", "text": "Sing again"}},
						},
					},
				},
			},
		},
		"playOrder": []interface{}{
			map[string]interface{}{"id": "first", "sectionId": "chorus", "enabled": true},
			map[string]interface{}{"id": "again", "sectionId": "chorus", "enabled": true},
		},
	}
	raw, _ := json.Marshal(document)
	importPath := filepath.Join(tempDir, "canonical.json")
	if err := os.WriteFile(importPath, raw, 0600); err != nil {
		t.Fatalf("write import fixture failed: %v", err)
	}
	result, err := store.ImportFiles(ImportFilesOptions{Paths: []string{importPath}})
	if err != nil {
		t.Fatalf("ImportFiles failed: %v", err)
	}
	if len(result.Imported) != 1 || len(result.Failed) != 0 {
		t.Fatalf("import result = %#v", result)
	}
	gotValue, err := store.GetSong("canonical_import")
	if err != nil {
		t.Fatalf("GetSong failed: %v", err)
	}
	got := gotValue.(map[string]interface{})
	metadata := got["metadata"].(map[string]interface{})
	if metadata["oneLicense"] != "A-999" {
		t.Fatalf("oneLicense = %#v", metadata["oneLicense"])
	}
	if metadata["extra"].(map[string]interface{})["sourceKey"] != "preserve-me" {
		t.Fatalf("extra metadata = %#v", metadata["extra"])
	}
	if len(genericSlice(got["playOrder"])) != 2 {
		t.Fatalf("playOrder = %#v", got["playOrder"])
	}
}

func TestSongStoreRejectsInvalidCanonicalBlocks(t *testing.T) {
	store, err := InitStore(filepath.Join(t.TempDir(), "songs.db"))
	if err != nil {
		t.Fatalf("InitStore failed: %v", err)
	}
	defer store.Close()
	err = store.SaveSongDocument(map[string]interface{}{
		"schema": canonicalSongSchemaVersion,
		"id":     "invalid_song",
		"title":  "Invalid",
		"sections": []interface{}{
			map[string]interface{}{
				"id":     "verse",
				"kind":   "verse",
				"blocks": []interface{}{map[string]interface{}{"type": "lyricLine", "id": "missing_primary"}},
			},
		},
	}, "")
	if err == nil {
		t.Fatal("expected invalid canonical block to be rejected")
	}
}

func TestDeckEditorSavePreservesCanonicalOnlySectionFields(t *testing.T) {
	store, err := InitStore(filepath.Join(t.TempDir(), "songs.db"))
	if err != nil {
		t.Fatalf("InitStore failed: %v", err)
	}
	defer store.Close()
	canonical := map[string]interface{}{
		"schema": canonicalSongSchemaVersion,
		"id":     "editor_round_trip",
		"title":  "Before Edit",
		"metadata": map[string]interface{}{
			"authors":   []interface{}{"Writer"},
			"copyright": "",
		},
		"sections": []interface{}{
			map[string]interface{}{
				"id":           "verse",
				"kind":         "verse",
				"number":       3,
				"label":        "Verse 3",
				"customSource": "keep",
				"blocks":       []interface{}{},
			},
		},
		"arrangements": []interface{}{
			map[string]interface{}{
				"id":       "arr",
				"sequence": []interface{}{map[string]interface{}{"sectionId": "verse", "enabled": true}},
			},
		},
		"playOrder": []interface{}{map[string]interface{}{"sectionId": "verse", "enabled": true}},
	}
	deck := map[string]interface{}{
		"schema":        slideDeckSchemaVersion,
		"id":            "editor_round_trip",
		"title":         "After Edit",
		"documentType":  "song",
		"canonicalSong": canonical,
		"metadata":      canonical["metadata"],
		"pages": []interface{}{
			map[string]interface{}{
				"id":      "verse",
				"kind":    "verse",
				"label":   "Edited Verse",
				"objects": []interface{}{},
			},
		},
		"playOrder": canonical["playOrder"],
	}
	if err := store.SaveSongDocument(deck, ""); err != nil {
		t.Fatalf("SaveSongDocument deck failed: %v", err)
	}
	gotValue, err := store.GetSong("editor_round_trip")
	if err != nil {
		t.Fatalf("GetSong failed: %v", err)
	}
	got := gotValue.(map[string]interface{})
	section := genericSlice(got["sections"])[0].(map[string]interface{})
	if section["number"] != float64(3) || section["customSource"] != "keep" {
		t.Fatalf("canonical-only section fields were lost: %#v", section)
	}
	if len(genericSlice(got["arrangements"])) != 1 {
		t.Fatalf("arrangements were lost: %#v", got["arrangements"])
	}
}

func TestImportFilesAcceptsCanonicalSpacerOnlyDraft(t *testing.T) {
	tempDir := t.TempDir()
	store, err := InitStore(filepath.Join(tempDir, "songs.db"))
	if err != nil {
		t.Fatalf("InitStore failed: %v", err)
	}
	defer store.Close()
	document := map[string]interface{}{
		"schema": canonicalSongSchemaVersion,
		"id":     "spacer_draft",
		"title":  "Spacer Draft",
		"metadata": map[string]interface{}{
			"authors":   []interface{}{},
			"copyright": "",
		},
		"sections": []interface{}{
			map[string]interface{}{
				"id":    "verse",
				"kind":  "verse",
				"label": "Verse",
				"blocks": []interface{}{
					map[string]interface{}{
						"type": "spacer",
						"id":   "space",
						"primary": map[string]interface{}{
							"lang":     "en",
							"segments": []interface{}{},
						},
					},
				},
			},
		},
	}
	raw, _ := json.Marshal(document)
	path := filepath.Join(tempDir, "draft.json")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatalf("write draft failed: %v", err)
	}
	result, err := store.ImportFiles(ImportFilesOptions{Paths: []string{path}})
	if err != nil || len(result.Failed) != 0 || len(result.Imported) != 1 {
		t.Fatalf("spacer draft import failed: result=%#v err=%v", result, err)
	}
}
