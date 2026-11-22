package main

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"unicode"

	"emsmediasystem/bible-rpc/internal/biblestore"
	"emsmediasystem/bible-rpc/internal/ewb"
	"golang.org/x/text/unicode/norm"
)

// Fold Latin diacritics for searches such as "espiritu". Keep other scripts'
// letters intact. Punctuation separates words as in the EMS unicode61 index.
func directSearchWords(text string) []string {
	var b strings.Builder
	b.Grow(len(text))
	latin := false
	for _, r := range text {
		if unicode.Is(unicode.Latin, r) {
			latin = true
			if r >= 128 {
				for _, part := range norm.NFD.String(string(r)) {
					if !unicode.Is(unicode.Mn, part) {
						b.WriteRune(unicode.ToLower(part))
					}
				}
				continue
			}
		} else if latin && unicode.Is(unicode.Mn, r) {
			continue
		} else {
			latin = false
		}
		if unicode.IsLetter(r) || unicode.IsNumber(r) || unicode.Is(unicode.Co, r) {
			b.WriteRune(unicode.ToLower(r))
		} else {
			b.WriteByte(' ')
		}
	}
	return strings.Fields(b.String())
}

type termFrequency struct{ term, count int }

type ewbSearchHit struct {
	book, chapterIndex, verseIndex int
	length                         int
	frequencies                    []termFrequency
	rank                           float64
}

func phraseOccurrences(words, terms []string, prefix bool) int {
	count := 0
	for i := 0; i+len(terms) <= len(words); i++ {
		for j, term := range terms {
			word := words[i+j]
			last := j == len(terms)-1
			if word != term && !(last && prefix && strings.HasPrefix(word, term)) {
				break
			}
			if last {
				count++
			}
		}
	}
	return count
}

// Search the original book streams. Keep only numeric match statistics while
// scanning, then read the books containing the top results for display.
func searchEWB(version Version, input, mode string, limit int) ([]SearchResult, error) {
	source := version.ewbSource
	terms := directSearchWords(input)
	if len(terms) == 0 {
		return nil, fmt.Errorf("search query is empty")
	}
	phrase := mode == "phrase"
	prefix := phrase && !looksLikeQuotedPhrase(input)
	termPositions := make(map[string]int)
	var termWeights []int
	if phrase {
		termWeights = []int{1}
	} else {
		for _, term := range terms {
			i, ok := termPositions[term]
			if !ok {
				i = len(termWeights)
				termPositions[term] = i
				termWeights = append(termWeights, 0)
			}
			termWeights[i]++
		}
	}
	type bookStats struct {
		documents, totalLength int
		documentFrequency      []int
		hits                   []ewbSearchHit
	}
	stats := make([]bookStats, len(source.Books))
	err := source.VisitBooks(source.Books, func(index int, chapters []ewb.Chapter) error {
		book := source.Books[index]
		stat := &stats[index]
		stat.documentFrequency = make([]int, len(termWeights))
		counts := make([]int, len(termWeights))
		var matched []termFrequency
		var touched []int
		for ci, ch := range chapters {
			for vi, verse := range ch.Verses {
				words := directSearchWords(verse.Text)
				stat.documents++
				stat.totalLength += len(words)
				if phrase {
					counts[0] = phraseOccurrences(words, terms, prefix)
					if counts[0] > 0 {
						touched = append(touched, 0)
					}
				} else {
					for _, word := range words {
						i, ok := termPositions[word]
						if !ok {
							continue
						}
						if counts[i] == 0 {
							touched = append(touched, i)
						}
						counts[i]++
					}
				}
				matched = matched[:0]
				for _, i := range touched {
					stat.documentFrequency[i]++
					matched = append(matched, termFrequency{i, counts[i]})
					counts[i] = 0
				}
				touched = touched[:0]
				if len(matched) == 0 || (mode == "all" && len(matched) != len(termWeights)) {
					continue
				}
				stat.hits = append(stat.hits, ewbSearchHit{
					book: book.ID, chapterIndex: ci, verseIndex: vi, length: len(words),
					frequencies: append([]termFrequency(nil), matched...),
				})
			}
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("%s: %w", version.Abbreviation, err)
	}
	// Merge in catalog order to preserve the original tie order for BM25.
	documentFrequency := make([]int, len(termWeights))
	var documents, totalLength int
	var hits []ewbSearchHit
	for _, stat := range stats {
		documents += stat.documents
		totalLength += stat.totalLength
		for i, n := range stat.documentFrequency {
			documentFrequency[i] += n
		}
		hits = append(hits, stat.hits...)
	}
	if len(hits) == 0 {
		return []SearchResult{}, nil
	}

	// Use the same BM25 parameters and negative scores as SQLite FTS5, so
	// mixed EMS/EasyWorship results can use the existing ascending rank sort.
	idf := make([]float64, len(termWeights))
	for i, df := range documentFrequency {
		idf[i] = math.Log((float64(documents-df) + 0.5) / (float64(df) + 0.5))
		if idf[i] <= 0 {
			idf[i] = 1e-6
		}
	}
	averageLength := float64(totalLength) / float64(documents)
	for i := range hits {
		h := &hits[i]
		weight := 1.2 * (0.25 + 0.75*float64(h.length)/averageLength)
		for _, frequency := range h.frequencies {
			f := float64(frequency.count)
			h.rank -= float64(termWeights[frequency.term]) * idf[frequency.term] * (2.2 * f / (f + weight))
		}
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].rank < hits[j].rank })
	hits = hits[:min(len(hits), limit)]
	return readEWBSearchResults(version, hits)
}

func readEWBSearchResults(version Version, hits []ewbSearchHit) ([]SearchResult, error) {
	results := make([]SearchResult, len(hits))
	// Read each winning book once and retain only the requested excerpts.
	positions := make(map[int][]int)
	for i, h := range hits {
		positions[h.book] = append(positions[h.book], i)
	}
	var books []ewb.Book
	for _, book := range version.ewbSource.Books {
		if len(positions[book.ID]) > 0 {
			books = append(books, book)
		}
	}
	err := version.ewbSource.VisitBooks(books, func(index int, chapters []ewb.Chapter) error {
		bookID := books[index].ID
		name := nativeBookName(version.Abbreviation, bookID, cachedBookDetails[bookID].Name)
		if name == "" {
			name = fmt.Sprintf("Book %d", bookID)
		}
		for _, i := range positions[bookID] {
			h := hits[i]
			if h.chapterIndex >= len(chapters) || h.verseIndex >= len(chapters[h.chapterIndex].Verses) {
				return fmt.Errorf("source changed during search")
			}
			ch := chapters[h.chapterIndex]
			v := ch.Verses[h.verseIndex]
			results[i] = SearchResult{
				Version:     version.Abbreviation,
				Attribution: version.Attribution,
				BookID:      bookID,
				Book:        name,
				Chapter:     ch.Number,
				Verse:       v.Number,
				Reference:   fmt.Sprintf("%s %d:%d", name, ch.Number, v.Number),
				Text:        biblestore.CleanBibleVerseTextAtLocation(bookID, ch.Number, v.Number, v.Text),
				Rank:        h.rank,
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return results, nil
}
