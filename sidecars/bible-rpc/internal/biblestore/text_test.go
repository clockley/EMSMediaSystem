package biblestore

import "testing"

func TestCleanBibleVerseTextRemovesBraceAnnotations(t *testing.T) {
	input := `In the beginning God{After "God," the Hebrew has the two letters "Aleph Tav" as a grammatical marker.} created the heavens and the earth.`
	const want = "In the beginning God created the heavens and the earth."

	if got := CleanBibleVerseText(input); got != want {
		t.Fatalf("CleanBibleVerseText() = %q, want %q", got, want)
	}
}

func TestCleanBibleVerseTextLeavesUnmatchedBraceLiteral(t *testing.T) {
	const input = "A literal { brace remains"

	if got := CleanBibleVerseText(input); got != input {
		t.Fatalf("CleanBibleVerseText() = %q, want %q", got, input)
	}
}
