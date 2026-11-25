package embedding

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// Reference vectors are from ONNX Runtime CPU 1.23.2, Hugging Face tokenizers
// 0.23.3, single unpadded inputs, mean pooling and L2 normalization.
func TestBundledE5(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "..", "models")
	reference, err := os.ReadFile("testdata/e5-reference.f32")
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	m, err := Load(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	t.Logf("load and warm up %v", time.Since(start))
	cases := []struct {
		text string
		ids  []int
	}{
		{"query: finding peace in a storm", []int{0, 41, 1294, 12, 90791, 88669, 23, 10, 77076, 2}},
		{"query: encontrar paz en la tormenta", []int{0, 41, 1294, 12, 15275, 26486, 22, 21, 217691, 2}},
		{"passage: A steady hope when the tempest rages", []int{0, 46692, 12, 62, 67788, 1459, 15673, 3229, 70, 20805, 525, 27470, 90, 2}},
		{"passage: We gather at the table to break bread", []int{0, 46692, 12, 1401, 914, 9319, 99, 70, 23180, 47, 36356, 179967, 2}},
	}
	if ids := m.tokenizer.Encode("query: ¿Dónde  encontrar\tpaz y consuelo?", true).IDs; !slices.Equal(ids, []int{0, 41, 1294, 12, 3936, 397, 5800, 112, 15275, 26486, 113, 158, 1159, 8242, 32, 2}) {
		t.Errorf("accented and whitespace token IDs = %v", ids)
	}
	for i, c := range cases {
		if got := m.tokenizer.Encode(c.text, true).IDs; !slices.Equal(got, c.ids) {
			t.Errorf("token IDs %q = %v, want %v", c.text, got, c.ids)
		}
		start := time.Now()
		v, err := m.Encode(context.Background(), c.text)
		if err != nil {
			t.Fatal(err)
		}
		var similarity, norm float64
		for j, x := range v {
			pos := 4 * (i*Dimensions + j)
			similarity += float64(x) * float64(math.Float32frombits(binary.LittleEndian.Uint32(reference[pos:])))
			norm += float64(x) * float64(x)
		}
		t.Logf("%s: %v, cosine %.6f", c.text, time.Since(start), similarity)
		if len(v) != Dimensions || math.Abs(norm-1) > 0.0001 || similarity < 0.995 {
			t.Errorf("reference mismatch: size=%d norm²=%v cosine=%v", len(v), norm, similarity)
		}
	}
	if vectors, err := m.EncodePassage(context.Background(), strings.Repeat("hope and peace ", 55)); err != nil || len(vectors) < 2 {
		t.Fatalf("long passage produced %d vectors: %v", len(vectors), err)
	}
}

func TestVerifyModelAssetBeforeDecode(t *testing.T) {
	dir := t.TempDir()
	name := "tokenizer.json"
	asset := pinnedAsset{Size: 2, SHA256: fmt.Sprintf("%x", sha256.Sum256([]byte("{}")))}
	if err := os.WriteFile(filepath.Join(dir, name), []byte("[]"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := readPinnedAsset(dir, name, asset); err == nil {
		t.Fatal("accepted changed bytes with correct length")
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := readPinnedAsset(dir, name, asset); err != nil {
		t.Fatal(err)
	}
}
