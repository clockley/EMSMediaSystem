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

func TestCleanBibleVerseTextAtLocationRemovesPsalmSuperscription(t *testing.T) {
	input := `For the director of music. To the tune of “The Death of the Son.” A psalm of David. I will give thanks to you, LORD, with all my heart; I will tell of all your wonderful deeds.`
	const want = `I will give thanks to you, LORD, with all my heart; I will tell of all your wonderful deeds.`

	if got := CleanBibleVerseTextAtLocation(PsalmsBookID, 9, 1, input); got != want {
		t.Fatalf("CleanBibleVerseTextAtLocation() = %q, want %q", got, want)
	}
}

func TestCleanBibleVerseTextAtLocationPreservesPsalmBodyAfterNarrator(t *testing.T) {
	input := `To the chief Musician, A Psalm of David, the servant of the LORD, who spake unto the LORD the words of this song in the day that the LORD delivered him from the hand of all his enemies, and from the hand of Saul: And he said, I will love thee, O LORD, my strength.`
	const want = `I will love thee, O LORD, my strength.`

	if got := CleanBibleVerseTextAtLocation(PsalmsBookID, 18, 1, input); got != want {
		t.Fatalf("CleanBibleVerseTextAtLocation() = %q, want %q", got, want)
	}
}

func TestCleanBibleVerseTextAtLocationLeavesOrdinaryTextUntouched(t *testing.T) {
	const input = `Why do the nations rage and the peoples plot in vain?`

	if got := CleanBibleVerseTextAtLocation(PsalmsBookID, 2, 1, input); got != input {
		t.Fatalf("CleanBibleVerseTextAtLocation() = %q, want %q", got, input)
	}
	if got := CleanBibleVerseTextAtLocation(1, 9, 1, input); got != input {
		t.Fatalf("non-Psalm CleanBibleVerseTextAtLocation() = %q, want %q", got, input)
	}
}

func TestCleanBibleVerseTextAtLocationDoesNotGuessWhenBodyBoundaryIsMissing(t *testing.T) {
	const input = `Writing of David Watch me, O God: in thee I put my trust.`

	if got := CleanBibleVerseTextAtLocation(PsalmsBookID, 16, 1, input); got != input {
		t.Fatalf("CleanBibleVerseTextAtLocation() = %q, want %q", got, input)
	}
}
