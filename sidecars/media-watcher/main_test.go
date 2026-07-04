package main

import (
	"encoding/json"
	"os"
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

	items, options, err := parseSetWatchesParams(payload)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("items length = %d, want 1", len(items))
	}
	if items[0].QueueItemID != "2" || items[0].OriginalPath != "/tmp/media.mov" {
		t.Fatalf("unexpected item: %#v", items[0])
	}
	if options.PollIntervalMs != 0 {
		t.Fatalf("poll interval = %d, want default disabled", options.PollIntervalMs)
	}
}

func TestParseSetWatchesParamsOptions(t *testing.T) {
	debounceMs := 25
	pollIntervalMs := 1000
	payload, err := json.Marshal([]any{
		map[string]any{
			"items": []map[string]string{
				{"queueItemId": "2", "originalPath": "/tmp/media.mov"},
			},
			"options": map[string]any{
				"debounceMs":     debounceMs,
				"pollIntervalMs": pollIntervalMs,
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	_, options, err := parseSetWatchesParams(payload)
	if err != nil {
		t.Fatal(err)
	}
	if options.DebounceMs != debounceMs {
		t.Fatalf("debounce = %d, want %d", options.DebounceMs, debounceMs)
	}
	if options.PollIntervalMs != pollIntervalMs {
		t.Fatalf("poll interval = %d, want %d", options.PollIntervalMs, pollIntervalMs)
	}
}

func TestHashLocalFileMatchesMediaHashAlgorithm(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "hello.txt")
	if err := os.WriteFile(filePath, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}

	digest, err := hashLocalFile(filePath)
	if err != nil {
		t.Fatal(err)
	}
	if digest != "9555e8555c62dcfd" {
		t.Fatalf("digest = %q, want xxh3-64 digest", digest)
	}
}

func TestEventRelatesToTarget(t *testing.T) {
	target := filepath.Join("/media", "sermon.pptx")
	cases := []struct {
		eventPath string
		want      bool
	}{
		{target, true},
		{filepath.Join("/media", "~$sermon.pptx"), true},
		{filepath.Join("/media", "sermon.pptx~"), true},
		{filepath.Join("/media", "sermon.tmp"), true},
		{filepath.Join("/media", "other.pptx"), false},
		{filepath.Join("/media", "~$other.pptx"), false},
		{filepath.Join("/media", ".DS_Store"), false},
	}
	for _, tc := range cases {
		if got := eventRelatesToTarget(tc.eventPath, target); got != tc.want {
			t.Fatalf("eventRelatesToTarget(%q, %q) = %v, want %v", tc.eventPath, target, got, tc.want)
		}
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
