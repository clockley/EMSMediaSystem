package main

import "testing"

func TestFTSSearchQueryPhraseUsesFinalTokenPrefix(t *testing.T) {
	query, err := ftsSearchQuery("Remember the sabbat", "phrase")
	if err != nil {
		t.Fatalf("ftsSearchQuery returned error: %v", err)
	}
	const want = `"remember" + "the" + "sabbat"*`
	if query != want {
		t.Fatalf("ftsSearchQuery() = %q, want %q", query, want)
	}
}

func TestFTSSearchQueryQuotedPhraseStaysExact(t *testing.T) {
	query, err := ftsSearchQuery(`"Remember the sabbat"`, "phrase")
	if err != nil {
		t.Fatalf("ftsSearchQuery returned error: %v", err)
	}
	const want = `"Remember the sabbat"`
	if query != want {
		t.Fatalf("ftsSearchQuery() = %q, want %q", query, want)
	}
}

func TestFTSSearchQueryPhraseRejectsEmptyInput(t *testing.T) {
	if _, err := ftsSearchQuery("   ", "phrase"); err == nil {
		t.Fatal("ftsSearchQuery() error = nil, want non-nil")
	}
}
