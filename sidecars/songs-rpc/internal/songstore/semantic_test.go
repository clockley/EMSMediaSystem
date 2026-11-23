package songstore

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// The gate lets tests stop inference after the worker reads a song but before
// it writes the result. All mutations go through the production store API.
type testEncoder struct {
	version      string
	entered      chan string
	release      chan struct{}
	queryEntered chan struct{}
	queryRelease chan struct{}
	closed       chan struct{}
}

func (m *testEncoder) Key() string { return m.version }
func (m *testEncoder) Close() {
	if m.closed != nil {
		close(m.closed)
	}
}
func (m *testEncoder) EncodePassage(ctx context.Context, text string) ([][]float32, error) {
	v, err := m.Encode(ctx, "passage: "+text)
	return [][]float32{v}, err
}
func (m *testEncoder) Encode(ctx context.Context, text string) ([]float32, error) {
	if strings.HasPrefix(text, "query: ") && m.queryEntered != nil {
		select {
		case m.queryEntered <- struct{}{}:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		select {
		case <-m.queryRelease:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if strings.HasPrefix(text, "passage: ") && m.entered != nil {
		select {
		case m.entered <- text:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		select {
		case <-m.release:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	vector := make([]float32, embeddingSize)
	vector[0] = 1
	return vector, nil
}

func TestEmbeddingUpgradeInterruptionEditsAndReset(t *testing.T) {
	path := filepath.Join(t.TempDir(), "songs.db")
	open := func() *SongStore {
		t.Helper()
		s, err := InitStore(path)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	store := open()
	save := func(id, title string) {
		t.Helper()
		if err := store.SaveSong(Song{ID: id, Title: title, Schema: canonicalSongSchemaVersion, Sections: []SongSection{{ID: "v", Kind: "verse", Label: "Verse", Blocks: []SongBlock{}}}}, ""); err != nil {
			t.Fatal(err)
		}
	}
	save("a", "First song")
	save("b", "Second song")
	if _, err := store.db.Exec("DROP TRIGGER song_embeddings_delete; DROP TABLE song_embeddings"); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store = open()
	start := func(version string) *testEncoder {
		m := &testEncoder{version: version, entered: make(chan string, 1), release: make(chan struct{}, 1)}
		store.StartSemanticIndex(func(context.Context) (Encoder, error) { return m, nil })
		return m
	}
	next := func(m *testEncoder, want string) {
		t.Helper()
		select {
		case got := <-m.entered:
			if got != "passage: "+want {
				t.Fatalf("encoding %q, want %q", got, want)
			}
		case <-time.After(4 * time.Second):
			t.Fatalf("worker never reached %q", want)
		}
	}
	count := func(want int) {
		t.Helper()
		var got int
		if err := store.db.QueryRow("SELECT COUNT(*) FROM song_embeddings").Scan(&got); err != nil || got != want {
			t.Fatalf("embedding rows=%d, want %d, err=%v", got, want, err)
		}
	}
	m := start("v1")
	next(m, "First song")
	got, err := store.Search(SearchOptions{Query: "First", LexicalOnly: true})
	if err != nil || len(got) != 1 || got[0].ID != "a" {
		t.Fatalf("FTS during upgrade: %v %v", got, err)
	}
	m.release <- struct{}{}
	next(m, "Second song")
	count(1)
	// Cancel the second embedding and restart. The first song is complete.
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store = open()
	m = start("v1")
	next(m, "Second song")
	save("b", "Edited song")
	m.release <- struct{}{}
	next(m, "Edited song")
	count(1)
	m.release <- struct{}{}
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		var title string
		err := store.db.QueryRow("SELECT song_id FROM song_embeddings WHERE song_id='b'").Scan(&title)
		if err == nil {
			break
		}
		if err != sql.ErrNoRows {
			t.Fatal(err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	count(2)
	folder, err := store.CreateFolder("Other")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.MoveSongToFolder("b", &folder.ID); err != nil {
		t.Fatal(err)
	}
	count(2)
	got, err = store.Search(SearchOptions{Query: "unrelated", FolderID: &folder.ID})
	if err != nil || len(got) != 1 || got[0].ID != "b" {
		t.Fatalf("semantic folder filter: %v %v", got, err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store = open()
	defer store.Close()
	m = start("v2")
	next(m, "First song")
	if err := store.DeleteSong("a"); err != nil {
		t.Fatal(err)
	}
	m.release <- struct{}{}
	next(m, "Edited song")
	count(1)
	if err := store.ResetDatabase(); err != nil {
		t.Fatal(err)
	}
	m.release <- struct{}{}
	save("c", "New song")
	next(m, "New song")
	count(0)
}

func TestFailedModelLoadLeavesKeywordSearchAvailable(t *testing.T) {
	s, err := InitStore(filepath.Join(t.TempDir(), "songs.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.SaveSong(Song{ID: "song", Title: "Peace", Sections: []SongSection{{ID: "v", Blocks: []SongBlock{}}}}, ""); err != nil {
		t.Fatal(err)
	}
	s.StartSemanticIndex(func(context.Context) (Encoder, error) {
		// A factory returning a concrete pointer supplies a typed nil on error.
		return (*testEncoder)(nil), errors.New("missing model")
	})
	<-s.semantic.done
	found, err := s.Search(SearchOptions{Query: "Peace"})
	if err != nil || len(found) != 1 || found[0].ID != "song" {
		t.Fatalf("keyword fallback: %v, %v", found, err)
	}
}

func TestConcurrentSearchEditAndShutdown(t *testing.T) {
	s, err := InitStore(filepath.Join(t.TempDir(), "songs.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.SaveSong(Song{ID: "song", Title: "Peace", Sections: []SongSection{{ID: "v", Blocks: []SongBlock{}}}}, ""); err != nil {
		t.Fatal(err)
	}

	m := &testEncoder{version: "v", entered: make(chan string, 1), release: make(chan struct{}), queryEntered: make(chan struct{}), queryRelease: make(chan struct{}), closed: make(chan struct{})}
	var loads atomic.Int32
	load := func(context.Context) (Encoder, error) { loads.Add(1); return m, nil }
	var starts sync.WaitGroup
	for range 8 {
		starts.Go(func() { s.StartSemanticIndex(load) })
	}
	starts.Wait()
	select {
	case <-m.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("indexer did not start")
	}
	if n := loads.Load(); n != 1 {
		t.Fatalf("loaded %d models", n)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	type response struct {
		results []SearchResult
		err     error
	}
	query := func() <-chan response {
		responses := make(chan response, 1)
		go func() {
			results, err := s.SearchContext(ctx, SearchOptions{Query: "Peace"})
			responses <- response{results, err}
		}()
		select {
		case <-m.queryEntered:
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
		return responses
	}
	first := query()
	if err := s.DeleteSong("song"); err != nil {
		t.Fatal(err)
	}
	m.queryRelease <- struct{}{}
	if r := <-first; r.err != nil || len(r.results) != 0 {
		t.Fatalf("deleted song in search: %+v", r)
	}

	second := query()
	shutdown := make(chan error, 1)
	go func() { shutdown <- s.Close() }()
	// A read lock must protect the encoder until the active query returns.
	select {
	case <-m.closed:
		t.Fatal("closed during active query")
	case <-time.After(20 * time.Millisecond):
	}
	m.queryRelease <- struct{}{}
	<-second
	if err := <-shutdown; err != nil {
		t.Fatal(err)
	}
	select {
	case <-m.closed:
	default:
		t.Fatal("model still open")
	}
	s.StartSemanticIndex(load)
	if loads.Load() != 1 {
		t.Fatal("restarted closed store")
	}
}
