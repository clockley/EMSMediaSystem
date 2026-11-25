package main

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
)

func TestPathChecksFromDifferentGenerationsDoNotClobberEachOther(t *testing.T) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		t.Fatal(err)
	}
	defer watcher.Close()

	server := newWatchServer(watcher, io.Discard)
	eventKey := comparablePathKey(filepath.Join(t.TempDir(), "media.mp4"))
	server.targetsByKey[eventKey] = watchTarget{EventKey: eventKey, OriginalPath: eventKey}
	server.generation = 1

	if _, _, ok := server.beginPathCheck(eventKey, 1); !ok {
		t.Fatal("first-generation check did not start")
	}
	server.generation = 2
	if _, _, ok := server.beginPathCheck(eventKey, 2); !ok {
		t.Fatal("new-generation check was blocked by stale in-flight work")
	}

	server.finishPathCheck(eventKey, 1)
	if got := server.checksInFlight[eventKey]; got != 2 {
		t.Fatalf("stale completion left generation %d in flight, want 2", got)
	}
	server.finishPathCheck(eventKey, 2)
	if _, ok := server.checksInFlight[eventKey]; ok {
		t.Fatal("current-generation completion did not clear in-flight state")
	}
}

func TestStaleNonReadyResultDoesNotClearCurrentSignature(t *testing.T) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		t.Fatal(err)
	}
	defer watcher.Close()

	server := newWatchServer(watcher, io.Discard)
	eventKey := comparablePathKey(filepath.Join(t.TempDir(), "media.mp4"))
	server.targetsByKey[eventKey] = watchTarget{EventKey: eventKey, OriginalPath: eventKey}
	server.generation = 2
	want := fileSignature{SizeBytes: 42, MtimeMs: 99, FileHash: "0123456789abcdef"}
	server.observedByKey[eventKey] = want

	if server.commitNonReadyForGeneration(eventKey, 1, watchChanged{Status: "missing"}) {
		t.Fatal("stale result was committed")
	}
	if got, ok := server.observedByKey[eventKey]; !ok || got != want {
		t.Fatalf("current signature was changed: got %#v, present %v", got, ok)
	}
}

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

func TestTargetsFromItemsKeepsCaseDistinctPaths(t *testing.T) {
	root := t.TempDir()
	upperPath := filepath.Join(root, "Media.mp4")
	lowerPath := filepath.Join(root, "media.mp4")
	if comparablePathKey(upperPath) == comparablePathKey(lowerPath) {
		t.Fatal("comparable path keys unexpectedly folded case")
	}

	targets, _ := targetsFromItems([]watchItem{
		{QueueItemID: "upper", OriginalPath: upperPath},
		{QueueItemID: "lower", OriginalPath: lowerPath},
	})
	if len(targets) != 2 {
		t.Fatalf("targets length = %d, want 2 case-sensitive paths", len(targets))
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

func TestHashFileRPCMatchesMediaHashAlgorithm(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "hello.txt")
	if err := os.WriteFile(filePath, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	params, err := json.Marshal([]any{map[string]string{"filePath": filePath}})
	if err != nil {
		t.Fatal(err)
	}

	result, rpcErr := handleRequest(nil, rpcRequest{
		JSONRPC: "2.0",
		Method:  "hash.file",
		Params:  params,
	})
	if rpcErr != nil {
		t.Fatalf("hash.file failed: %#v", rpcErr)
	}
	if digest, ok := result.(string); !ok || digest != "9555e8555c62dcfd" {
		t.Fatalf("digest = %#v, want xxh3-64 digest", result)
	}
}

func TestHashFileRPCRejectsMissingPath(t *testing.T) {
	params, err := json.Marshal([]any{map[string]string{}})
	if err != nil {
		t.Fatal(err)
	}

	_, rpcErr := handleRequest(nil, rpcRequest{
		JSONRPC: "2.0",
		Method:  "hash.file",
		Params:  params,
	})
	if rpcErr == nil || rpcErr.Code != -32602 {
		t.Fatalf("error = %#v, want invalid params", rpcErr)
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

type syncedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (s *syncedBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Write(p)
}

func (s *syncedBuffer) Lines() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	raw := strings.TrimSpace(s.buf.String())
	if raw == "" {
		return nil
	}
	return strings.Split(raw, "\n")
}

func TestReplacingWatchesPreservesPendingSaveAndReportsUpdatedQueueItems(t *testing.T) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		t.Fatal(err)
	}
	defer watcher.Close()

	var out syncedBuffer
	server := newWatchServer(watcher, &out)
	defer server.close()

	dir := t.TempDir()
	mediaPath := filepath.Join(dir, "clip.mp4")
	if err := os.WriteFile(mediaPath, []byte("before"), 0o600); err != nil {
		t.Fatal(err)
	}
	initialSig, err := statLocalFile(mediaPath)
	if err != nil {
		t.Fatal(err)
	}
	initialHash, err := hashLocalFile(mediaPath)
	if err != nil {
		t.Fatal(err)
	}

	fastOpts := watchOptions{
		DebounceMs:              40,
		StabilityIntervalMs:     15,
		StabilitySamples:        2,
		MaxStabilityPolls:       10,
		StatRetryCount:          1,
		StatRetryInitialDelayMs: 5,
		HashRetryCount:          1,
		HashRetryInitialDelayMs: 5,
		PollIntervalMs:          500,
	}
	size := initialSig.SizeBytes
	mtime := initialSig.MtimeMs
	server.setWatches([]watchItem{{
		QueueItemID:     "item-1",
		OriginalPath:    mediaPath,
		PinnedFileHash:  initialHash,
		PinnedSizeBytes: &size,
		PinnedMtimeMs:   &mtime,
	}}, fastOpts)

	eventKey := comparablePathKey(mediaPath)
	// Start a file save and arm the stability check before replacing watches.
	if err := os.WriteFile(mediaPath, []byte("after-external-save"), 0o600); err != nil {
		t.Fatal(err)
	}
	server.scheduleTargetCheck(eventKey, "fsnotify", mediaPath, "WRITE")

	// Replace the watch set while the debounce/stability check is still pending.
	server.setWatches([]watchItem{
		{
			QueueItemID:     "item-1",
			OriginalPath:    mediaPath,
			PinnedFileHash:  initialHash,
			PinnedSizeBytes: &size,
			PinnedMtimeMs:   &mtime,
		},
		{
			QueueItemID:     "item-2",
			OriginalPath:    mediaPath,
			PinnedFileHash:  initialHash,
			PinnedSizeBytes: &size,
			PinnedMtimeMs:   &mtime,
		},
	}, fastOpts)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		for _, line := range out.Lines() {
			var msg struct {
				Method string       `json:"method"`
				Params watchChanged `json:"params"`
			}
			if err := json.Unmarshal([]byte(line), &msg); err != nil {
				t.Fatal(err)
			}
			if msg.Method == "watch.changed" && msg.Params.Status == "ready" {
				if !stringSlicesEqual(msg.Params.QueueItemIDs, []string{"item-1", "item-2"}) {
					t.Fatalf("queueItemIds = %#v, want [item-1 item-2]", msg.Params.QueueItemIDs)
				}
				if msg.Params.FileHash == "" || msg.Params.FileHash == initialHash {
					t.Fatalf("unexpected ready hash %q (initial %q)", msg.Params.FileHash, initialHash)
				}
				return
			}
		}
		time.Sleep(15 * time.Millisecond)
	}
	t.Fatalf("watch replacement dropped the pending ready notification; lines=%v", out.Lines())
}

func TestSameSizeAndMtimeWriteAfterPollBaselineStillReportsReady(t *testing.T) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		t.Fatal(err)
	}
	defer watcher.Close()

	var out syncedBuffer
	server := newWatchServer(watcher, &out)
	defer server.close()

	dir := t.TempDir()
	mediaPath := filepath.Join(dir, "slide.bin")
	fixedTime := time.Unix(1_700_000_000, 0)
	if err := os.WriteFile(mediaPath, []byte("version-A"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(mediaPath, fixedTime, fixedTime); err != nil {
		t.Fatal(err)
	}

	opts := watchOptions{
		DebounceMs:              10,
		StabilityIntervalMs:     10,
		StabilitySamples:        2,
		MaxStabilityPolls:       10,
		StatRetryCount:          1,
		StatRetryInitialDelayMs: 5,
		HashRetryCount:          1,
		HashRetryInitialDelayMs: 5,
		PollIntervalMs:          5000,
	}
	server.setWatches([]watchItem{{QueueItemID: "q1", OriginalPath: mediaPath}}, opts)

	// Overwrite with identical byte length and restore the exact mtime.
	if err := os.WriteFile(mediaPath, []byte("version-B"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(mediaPath, fixedTime, fixedTime); err != nil {
		t.Fatal(err)
	}
	wantHash, err := hashLocalFile(mediaPath)
	if err != nil {
		t.Fatal(err)
	}

	server.mu.RLock()
	gen := server.generation
	server.mu.RUnlock()
	server.runPathCheck(comparablePathKey(mediaPath), gen, "fsnotify")

	for _, line := range out.Lines() {
		var msg struct {
			Method string       `json:"method"`
			Params watchChanged `json:"params"`
		}
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			t.Fatal(err)
		}
		if msg.Method == "watch.changed" && msg.Params.Status == "ready" {
			if msg.Params.FileHash != wantHash {
				t.Fatalf("hash = %q, want %q", msg.Params.FileHash, wantHash)
			}
			return
		}
	}
	t.Fatalf("same-size same-mtime write was ignored; lines=%v", out.Lines())
}

func TestServeRPCDoesNotBlockWatchSetBehindHashFile(t *testing.T) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		t.Fatal(err)
	}
	defer watcher.Close()

	var out syncedBuffer
	server := newWatchServer(watcher, &out)
	defer server.close()

	dir := t.TempDir()
	fifoPath := filepath.Join(dir, "slow.fifo")
	watchTargetFile := filepath.Join(dir, "clip.mp4")
	if err := os.WriteFile(watchTargetFile, []byte("clip"), 0o600); err != nil {
		t.Fatal(err)
	}
	makeFifo(t, fifoPath)

	inReader, inWriter := io.Pipe()
	rpcDone := make(chan error, 1)
	go func() {
		rpcDone <- serveRPC(inReader, server)
	}()

	// Send a hash.file request that blocks reading from the named pipe until we write to it.
	_, err = io.WriteString(inWriter, `{"jsonrpc":"2.0","id":1,"method":"hash.file","params":[{"filePath":`+mustJSON(t, fifoPath)+`}]}`+"\n")
	if err != nil {
		t.Fatal(err)
	}
	// Immediately send watch.set behind the blocked hash.file call.
	_, err = io.WriteString(inWriter, `{"jsonrpc":"2.0","id":2,"method":"watch.set","params":[{"items":[{"queueItemId":"1","originalPath":`+mustJSON(t, watchTargetFile)+`}]}]}`+"\n")
	if err != nil {
		t.Fatal(err)
	}

	watchSetReplied := false
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) && !watchSetReplied {
		for _, line := range out.Lines() {
			var resp struct {
				ID json.RawMessage `json:"id"`
			}
			if json.Unmarshal([]byte(line), &resp) == nil && string(resp.ID) == "2" {
				watchSetReplied = true
				break
			}
		}
		if !watchSetReplied {
			time.Sleep(10 * time.Millisecond)
		}
	}
	if !watchSetReplied {
		t.Fatalf("watch.set was blocked behind hash.file; lines=%v", out.Lines())
	}

	// Unblock the FIFO reader and finish cleanly.
	fifoWriter, err := os.OpenFile(fifoPath, os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = fifoWriter.Write([]byte("payload"))
	_ = fifoWriter.Close()
	_ = inWriter.Close()
	if err := <-rpcDone; err != nil {
		t.Fatal(err)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
