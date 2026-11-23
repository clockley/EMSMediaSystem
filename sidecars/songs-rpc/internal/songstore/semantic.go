package songstore

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"maps"
	"math"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const embeddingSize = 384

// Encoder provides normalized multilingual E5 vectors. The implementation
// serializes model calls so indexing and interactive search can share weights.
type Encoder interface {
	Encode(context.Context, string) ([]float32, error)
	EncodePassage(context.Context, string) ([][]float32, error)
	Key() string
	Close()
}

type semanticIndex struct {
	mu     sync.Mutex
	closed bool
	cancel context.CancelFunc
	done   chan struct{}
	wake   chan struct{}

	modelMu sync.RWMutex
	model   Encoder
}

// StartSemanticIndex starts the resumable upgrade once. Keyword search stays
// available during loading and if the model cannot be opened.
func (s *SongStore) StartSemanticIndex(load func(context.Context) (Encoder, error)) {
	idx := &s.semantic
	idx.mu.Lock()
	defer idx.mu.Unlock()
	if idx.closed || idx.cancel != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	idx.cancel = cancel
	idx.done = make(chan struct{})
	go func() {
		defer close(idx.done)
		var model Encoder
		defer func() {
			idx.modelMu.Lock()
			defer idx.modelMu.Unlock()
			idx.model = nil
			if model != nil {
				model.Close()
			}
		}()
		for ctx.Err() == nil {
			var err error
			if model == nil {
				var hasSongs bool
				err = s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM songs)`).Scan(&hasSongs)
				if err == nil && hasSongs {
					loaded, loadErr := load(ctx)
					if loadErr != nil || loaded == nil {
						if ctx.Err() == nil {
							log.Printf("Song semantic search unavailable: %v", loadErr)
						}
						return
					}
					model = loaded
					idx.modelMu.Lock()
					idx.model = model
					idx.modelMu.Unlock()
				}
			}
			if err == nil && model != nil {
				err = s.upgradeEmbeddings(ctx, model)
			}
			var retry <-chan time.Time
			if err != nil && ctx.Err() == nil {
				log.Printf("Song embedding upgrade: %v", err)
				retry = time.After(time.Minute)
			}
			select {
			case <-ctx.Done():
				return
			case <-idx.wake:
			case <-retry:
			}
		}
	}()
}

func (s *SongStore) wakeIndexer() {
	select {
	case s.semantic.wake <- struct{}{}:
	default:
	}
}

func songPassages(doc map[string]any) []string {
	title := documentString(doc, "title")
	seen := map[string]bool{}
	var passages []string
	add := func(text string) {
		lyric := strings.Join(strings.Fields(text), " ")
		if lyric != "" && !seen[lyric] {
			passages = append(passages, strings.TrimSpace(title+"\n"+lyric))
			seen[lyric] = true
		}
	}
	for _, value := range genericSlice(doc["sections"]) {
		section, _ := value.(map[string]any)
		add(textFromGenericBlocks(section["blocks"]))
		translations := map[string][]string{}
		for _, value := range genericSlice(section["blocks"]) {
			block, _ := value.(map[string]any)
			for _, value := range genericSlice(block["translations"]) {
				run, _ := value.(map[string]any)
				lang := documentString(run, "lang")
				translations[lang] = append(translations[lang], localizedLyrics(run))
			}
		}
		// Stable ordering makes the fingerprint independent of map iteration.
		for _, lang := range slices.Sorted(maps.Keys(translations)) {
			add(strings.Join(translations[lang], " "))
		}
	}
	if len(passages) == 0 {
		passages = append(passages, title)
	}
	return passages
}

func passageHash(parts []string) []byte {
	h := sha256.New()
	for _, p := range parts {
		h.Write(binary.LittleEndian.AppendUint64(nil, uint64(len(p))))
		h.Write([]byte(p))
	}
	return h.Sum(nil)
}

// The cursor advances even when an individual song fails. Completed rows
// survive restarts. Check the source again when publishing to handle edits,
// deletes and a database reset that happened during inference.
func (s *SongStore) upgradeEmbeddings(ctx context.Context, model Encoder) error {
	var after string
	var lastError error
	for ctx.Err() == nil {
		var id, raw string
		err := s.db.QueryRowContext(ctx, `SELECT s.id,s.canonical_json FROM songs s
           LEFT JOIN song_embeddings e ON e.song_id=s.id
           WHERE s.id>? AND s.canonical_json IS NOT NULL AND s.canonical_json!=''
             AND (e.model_key IS NULL OR e.model_key!=?) ORDER BY s.id LIMIT 1`, after, model.Key()).Scan(&id, &raw)
		if errors.Is(err, sql.ErrNoRows) {
			return lastError
		}
		if err != nil {
			return err
		}
		after = id
		if err := s.embedSong(ctx, model, id, raw); err != nil && ctx.Err() == nil {
			lastError = fmt.Errorf("index song %q: %w", id, err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
	}
	return ctx.Err()
}

func (s *SongStore) embedSong(ctx context.Context, model Encoder, id, raw string) error {
	var doc map[string]any
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		return err
	}
	passages := songPassages(doc)
	var blob []byte
	for _, p := range passages {
		if err := ctx.Err(); err != nil {
			return err
		}
		vectors, err := model.EncodePassage(ctx, p)
		if err != nil {
			return err
		}
		for _, v := range vectors {
			if len(v) != embeddingSize {
				return fmt.Errorf("unexpected embedding length %d", len(v))
			}
			for _, x := range v {
				blob = binary.LittleEndian.AppendUint32(blob, math.Float32bits(x))
			}
		}
	}
	_, err := s.db.ExecContext(ctx, `INSERT OR REPLACE INTO song_embeddings(song_id,model_key,content_hash,vectors)
        SELECT id,?,?,? FROM songs WHERE id=? AND canonical_json=?`, model.Key(), passageHash(passages), blob, id, raw)
	return err
}

type semanticHit struct {
	song  SearchResult
	score float32
}

// Use the best matching section per song, within the requested folder. Vectors
// are unit normalized, so their dot product is cosine similarity.
func (s *SongStore) nearestSongs(ctx context.Context, db searchReader, key string, query []float32, opts SearchOptions) ([]semanticHit, error) {
	filter, args := s.folderFilterSQL(opts)
	rows, err := db.QueryContext(ctx, `SELECT s.id,s.title,s.author,s.folder_id,s.song_number,s.meter,e.vectors
        FROM song_embeddings e JOIN songs s ON s.id=e.song_id WHERE e.model_key=?`+filter, append([]any{key}, args...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var hits []semanticHit
	for rows.Next() {
		var song SearchResult
		var blob sql.RawBytes
		var meter sql.NullString
		if err := rows.Scan(&song.ID, &song.Title, &song.Author, &song.FolderID, &song.SongNumber, &meter, &blob); err != nil {
			return nil, err
		}
		song.Meter = meter.String
		if len(blob)%(4*embeddingSize) != 0 {
			continue
		}
		best := float32(-1)
		for len(blob) >= 4*embeddingSize {
			var score float32
			for i, x := range query {
				score += x * math.Float32frombits(binary.LittleEndian.Uint32(blob[i*4:]))
			}
			if score > best && score <= 1.001 {
				best = score
			}
			blob = blob[4*embeddingSize:]
		}
		if best >= 0.80 {
			hits = append(hits, semanticHit{song, best})
		}
	}
	sort.Slice(hits, func(i, j int) bool {
		if hits[i].score == hits[j].score {
			return hits[i].song.ID < hits[j].song.ID
		}
		return hits[i].score > hits[j].score
	})
	if len(hits) > 10 {
		hits = hits[:10]
	}
	return hits, rows.Err()
}

func (s *SongStore) queryVector(ctx context.Context, query string, opts SearchOptions) (string, []float32) {
	if opts.LexicalOnly || utf8.RuneCountInString(query) < 3 {
		return "", nil
	}
	if _, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(query, "#"))); err == nil {
		return "", nil
	}
	idx := &s.semantic
	idx.modelMu.RLock()
	defer idx.modelMu.RUnlock()
	if idx.model == nil {
		return "", nil
	}
	v, err := idx.model.Encode(ctx, "query: "+query)
	if err != nil || len(v) != embeddingSize {
		return "", nil
	}
	return idx.model.Key(), v
}

func fuseResults(query string, lexical []SearchResult, hits []semanticHit) []SearchResult {
	if len(hits) == 0 {
		return lexical
	}
	// Reciprocal rank fusion keeps each source's score scale independent.
	ranks := map[string]float64{}
	results := append([]SearchResult{}, lexical...)
	for i, song := range lexical {
		ranks[song.ID] = 1.0 / float64(10+i)
	}
	for i, h := range hits {
		if _, found := ranks[h.song.ID]; !found {
			results = append(results, h.song)
		}
		ranks[h.song.ID] += 0.85 / float64(10+i)
	}
	sort.SliceStable(results, func(i, j int) bool {
		a, b := results[i], results[j]
		exactA, exactB := strings.EqualFold(a.Title, query), strings.EqualFold(b.Title, query)
		if exactA != exactB {
			return exactA
		}
		return ranks[a.ID] > ranks[b.ID]
	})
	if len(results) > searchQueryResultLimit {
		return results[:searchQueryResultLimit]
	}
	return results
}
