package songstore

import (
	"path/filepath"
	"testing"
	"time"
)

func TestProjectionReviewSurvivesLibraryResetReplayAndRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "songs.db")
	s, err := InitStore(path)
	if err != nil {
		t.Fatal(err)
	}
	stamp := time.Date(2026, 11, 22, 23, 59, 59, 0, time.Local)
	p := Projection{ID: "event-1", SongID: "song-1", Title: "At presentation", TimeMillis: stamp.UnixMilli()}
	if err := s.RecordProjection(p); err != nil {
		t.Fatal(err)
	}
	if err := s.ReviewProjection(ProjectionReview{ID: p.ID, CCLINumber: "1234", Included: false}); err != nil {
		t.Fatal(err)
	}
	if err := s.ResetDatabase(); err != nil {
		t.Fatal(err)
	}
	p.Title = "Later title"
	if err := s.RecordProjection(p); err != nil {
		t.Fatal(err)
	}
	p.ID = "event-2"
	p.TimeMillis = stamp.Add(time.Second).UnixMilli()
	if err := s.RecordProjection(p); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = InitStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	rows, err := s.Projections("2026-11-22", "2026-11-22")
	if err != nil || len(rows) != 1 || rows[0].Included || rows[0].CCLINumber != "1234" || rows[0].Title != "At presentation" {
		t.Fatalf("rows = %#v, err = %v", rows, err)
	}
	if _, err := s.Projections("2026-11-23", "2026-11-22"); err == nil {
		t.Fatal("accepted reversed dates")
	}
}
