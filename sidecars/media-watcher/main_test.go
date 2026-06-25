package main

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestTargetsFromItemsKeepsDuplicateQueueItemsForSameFile(t *testing.T) {
	sourcePath := filepath.Join(t.TempDir(), "media.mp4")
	targets, dirs := targetsFromItems([]watchItem{
		{QueueItemID: "0", OriginalPath: sourcePath},
		{QueueItemID: "3", OriginalPath: sourcePath},
	})

	if len(targets) != 1 {
		t.Fatalf("targets length = %d, want 1", len(targets))
	}
	if len(dirs) != 1 {
		t.Fatalf("dirs length = %d, want 1", len(dirs))
	}
	for _, target := range targets {
		if got, want := target.QueueItemIDs, []string{"0", "3"}; !stringSlicesEqual(got, want) {
			t.Fatalf("queue ids = %#v, want %#v", got, want)
		}
	}
}

func TestParseSetWatchesParams(t *testing.T) {
	payload, err := json.Marshal([]any{
		map[string]any{
			"items": []map[string]string{
				{"queueItemId": "2", "originalPath": "/tmp/media.mov"},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	items, err := parseSetWatchesParams(payload)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("items length = %d, want 1", len(items))
	}
	if items[0].QueueItemID != "2" || items[0].OriginalPath != "/tmp/media.mov" {
		t.Fatalf("unexpected item: %#v", items[0])
	}
}

func stringSlicesEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
