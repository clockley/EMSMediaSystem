// Package embedding runs the bundled multilingual E5-small encoder on CPU.
package embedding

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sync"

	"github.com/gomlx/compute"
	_ "github.com/gomlx/compute/gobackend"
	"github.com/gomlx/gomlx/core/graph"
	"github.com/gomlx/gomlx/core/tensors"
	"github.com/gomlx/gomlx/ml/model"
	"github.com/gomlx/onnx-gomlx/onnx"
	"github.com/gomlx/onnx-gomlx/onnx/parser"
	"github.com/hostfog/tokenizer"
)

const Dimensions = 384
const maxTokens = 512

type Model struct {
	mu        sync.Mutex
	tokenizer *tokenizer.Tokenizer
	backend   compute.Backend
	weights   *model.Store
	network   onnx.Model
	exec      *model.Exec
	key       string
}

//go:embed assets.json
var assetManifest []byte

type pinnedAsset struct {
	Size   int
	SHA256 string
}

func readPinnedAsset(dir, name string, asset pinnedAsset) ([]byte, error) {
	f, err := os.Open(filepath.Join(dir, name))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || asset.Size <= 0 || info.Size() != int64(asset.Size) {
		return nil, fmt.Errorf("unexpected size or file type for %s", name)
	}
	data := make([]byte, asset.Size)
	if _, err = io.ReadFull(f, data); err != nil {
		return nil, err
	}
	hash := sha256.Sum256(data)
	if hex.EncodeToString(hash[:]) != asset.SHA256 {
		return nil, fmt.Errorf("invalid checksum for %s", name)
	}
	return data, nil
}

func Load(ctx context.Context, dir string) (result *Model, err error) {
	m := &Model{}
	defer func() {
		if failure := recover(); failure != nil {
			err = fmt.Errorf("load E5 model: %v", failure)
		}
		if err != nil {
			m.Close()
		}
	}()
	var assets struct{ Files map[string]pinnedAsset }
	if err := json.Unmarshal(assetManifest, &assets); err != nil {
		return nil, err
	}
	tokenizerBytes, err := readPinnedAsset(dir, "tokenizer.json", assets.Files["tokenizer.json"])
	if err != nil {
		return nil, err
	}
	if m.tokenizer, err = tokenizer.FromJSON(tokenizerBytes); err != nil {
		return nil, err
	}
	modelBytes, err := readPinnedAsset(dir, "model_int8.onnx", assets.Files["model_int8.onnx"])
	if err != nil {
		return nil, err
	}
	// Parse the same verified bytes, even if a file is replaced during startup.
	if m.network, err = parser.Parse(modelBytes); err != nil {
		return nil, err
	}
	m.key = "multilingual-e5-128-v1:" + assets.Files["model_int8.onnx"].SHA256 + ":" + assets.Files["tokenizer.json"].SHA256
	m.weights = model.NewStore()
	if err = m.network.VariablesToScope(m.weights.RootScope()); err != nil {
		return nil, err
	}
	if m.backend, err = compute.NewWithConfig("go"); err != nil {
		return nil, err
	}
	m.exec, err = model.NewExec(m.backend, m.weights, func(scope *model.Scope, ids, mask, types *graph.Node) *graph.Node {
		return m.network.CallGraph(scope, ids.Graph(), map[string]*graph.Node{"input_ids": ids, "attention_mask": mask, "token_type_ids": types}, "last_hidden_state")[0]
	})
	if err != nil {
		return nil, err
	}
	// Compile the common query shape before exposing the model to the search box.
	if _, err = m.Encode(ctx, "query: peace"); err != nil {
		return nil, err
	}
	return m, nil
}

func (m *Model) Key() string { return m.key }
func (m *Model) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.exec != nil {
		m.exec.Finalize()
		m.exec = nil
	}
	if m.weights != nil {
		m.weights.Finalize()
		m.weights = nil
	}
	if m.backend != nil {
		m.backend.Finalize()
		m.backend = nil
	}
	if m.network != nil {
		m.network.Close()
		m.network = nil
	}
}

func (m *Model) Encode(ctx context.Context, text string) ([]float32, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	tokens := m.tokenizer.Encode(text, true).IDs
	if len(tokens) > maxTokens {
		tokens[maxTokens-1] = tokens[len(tokens)-1]
		tokens = tokens[:maxTokens]
	}
	return m.encodeTokens(ctx, tokens)
}

// EncodePassage keeps the tail of long sections searchable. Limit background
// calls to 128 tokens so a query can run between windows of a long lyric.
func (m *Model) EncodePassage(ctx context.Context, text string) ([][]float32, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	const windowSize = 128
	const overlap = 16
	tokens := m.tokenizer.Encode("passage: "+text, true).IDs
	var vectors [][]float32
	// E5's passage prefix and BOS/EOS must be present on every window.
	prefix := m.tokenizer.Encode("passage:", true).IDs
	prefix = prefix[:len(prefix)-1]
	content := tokens[len(prefix) : len(tokens)-1]
	capacity := windowSize - len(prefix) - 1
	for {
		n := min(capacity, len(content))
		window := make([]int, 0, len(prefix)+n+1)
		window = append(window, prefix...)
		window = append(window, content[:n]...)
		window = append(window, tokens[len(tokens)-1])
		vector, err := m.encodeTokens(ctx, window)
		if err != nil {
			return nil, err
		}
		vectors = append(vectors, vector)
		if n == len(content) {
			return vectors, nil
		}
		content = content[n-overlap:]
	}
}

func (m *Model) encodeTokens(ctx context.Context, tokens []int) (result []float32, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	// Some unsupported ONNX graphs and operators panic inside the backend.
	defer func() {
		if failure := recover(); failure != nil {
			err = fmt.Errorf("E5 inference: %v", failure)
		}
	}()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	// A bounded set of graph shapes avoids recompiling for every lyric length.
	if m.exec == nil {
		return nil, fmt.Errorf("song encoder is closed")
	}
	size := 16
	for size < len(tokens) {
		size *= 2
	}
	ids, mask, types := make([]int64, size), make([]int64, size), make([]int64, size)
	for i := range ids {
		ids[i] = 1 // XLM-R padding
		if i < len(tokens) {
			ids[i] = int64(tokens[i])
			mask[i] = 1
		}
	}
	out, err := m.exec.Call1([][]int64{ids}, [][]int64{mask}, [][]int64{types})
	if err != nil {
		return nil, err
	}
	defer out.FinalizeAll()
	flat, err := tensors.CopyFlatData[float32](out)
	if err != nil {
		return nil, err
	}
	if len(flat) != size*Dimensions {
		return nil, fmt.Errorf("unexpected E5 output shape %v", out.Shape())
	}
	// Mean pooling over unmasked tokens followed by L2 normalization. The
	// mean's scalar divisor cancels during normalization.
	vector := make([]float32, Dimensions)
	for i := range tokens {
		for j := range vector {
			vector[j] += flat[i*Dimensions+j]
		}
	}
	var norm float64
	for _, x := range vector {
		norm += float64(x) * float64(x)
	}
	if norm == 0 || math.IsNaN(norm) || math.IsInf(norm, 0) {
		return nil, fmt.Errorf("invalid E5 output norm")
	}
	scale := float32(1 / math.Sqrt(norm))
	for i := range vector {
		vector[i] *= scale
	}
	return vector, nil
}
