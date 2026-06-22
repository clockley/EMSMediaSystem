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

func TestAttributionForPublicDomainVersion(t *testing.T) {
	version := Version{
		Abbreviation:  "KJV",
		Version:       "King James Version",
		Copyright:     "Public Domain",
		CopyrightInfo: "King James Version (KJV). Public Domain.",
	}
	attribution := attributionForVersion(version)
	if !attribution.PublicDomain {
		t.Fatal("attribution.PublicDomain = false, want true")
	}
	if attribution.Text != "King James Version (KJV). Public Domain." {
		t.Fatalf("attribution.Text = %q", attribution.Text)
	}
}

func TestValidateVersionAttributionsRejectsMissingCopyright(t *testing.T) {
	versions := map[string]Version{
		"TEST": {
			Abbreviation: "TEST",
			Version:      "Test Version",
			Attribution: BibleAttribution{
				Abbreviation: "TEST",
				Version:      "Test Version",
				Text:         "Test Version (TEST)",
				ShortText:    "TEST",
			},
		},
	}
	if err := validateVersionAttributions(versions); err == nil {
		t.Fatal("validateVersionAttributions() error = nil, want non-nil")
	}
}
