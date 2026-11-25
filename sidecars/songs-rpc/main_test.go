package main

import (
	"bytes"
	"encoding/json"
	"runtime"
	"strings"
	"sync"
	"testing"
)

type nonAtomicPipeWriter struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (p *nonAtomicPipeWriter) Write(b []byte) (int, error) {
	const pipeBuf = 4096
	written := 0
	for written < len(b) {
		end := written + pipeBuf
		if end > len(b) {
			end = len(b)
		}
		p.mu.Lock()
		_, _ = p.buf.Write(b[written:end])
		p.mu.Unlock()
		written = end
		if written < len(b) {
			runtime.Gosched()
		}
	}
	return len(b), nil
}

func TestWriteResponseSerializesLargeConcurrentFrames(t *testing.T) {
	writer := &nonAtomicPipeWriter{}
	var sendLock sync.Mutex

	const workers = 4
	const perWorker = 25
	largeText := strings.Repeat("Amazing grace how sweet the sound ", 400)

	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		workerID := w
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < perWorker; i++ {
				writeResponse(writer, &sendLock, JSONRPCResponse{
					JSONRPC: "2.0",
					ID:      workerID*1000 + i,
					Result: map[string]any{
						"lyrics": largeText,
						"worker": workerID,
						"seq":    i,
					},
				})
			}
		}()
	}
	wg.Wait()

	lines := strings.Split(strings.TrimSpace(writer.buf.String()), "\n")
	if got, want := len(lines), workers*perWorker; got != want {
		t.Fatalf("line count = %d, want %d", got, want)
	}
	seenIDs := make(map[int]bool, workers*perWorker)
	for idx, line := range lines {
		var decoded struct {
			JSONRPC string         `json:"jsonrpc"`
			ID      int            `json:"id"`
			Result  map[string]any `json:"result"`
		}
		if err := json.Unmarshal([]byte(line), &decoded); err != nil {
			t.Fatalf("line %d failed to parse (torn frame): %v", idx, err)
		}
		seenIDs[decoded.ID] = true
	}
	if len(seenIDs) != workers*perWorker {
		t.Fatalf("unique decoded ids = %d, want %d", len(seenIDs), workers*perWorker)
	}
}
