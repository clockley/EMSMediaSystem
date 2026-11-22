package songstore

import (
	"fmt"
	"strings"
	"time"
)

type Projection struct {
	ID          string `json:"id"`
	TimeMillis  int64  `json:"timeMillis,omitempty"`
	ProjectedAt string `json:"projectedAt,omitempty"`
	SongID      string `json:"songId"`
	Title       string `json:"title"`
	Authors     string `json:"authors"`
	CCLINumber  string `json:"ccliNumber"`
	Included    bool   `json:"included"`
}

type ProjectionReview struct {
	ID         string `json:"id"`
	CCLINumber string `json:"ccliNumber"`
	Included   bool   `json:"included"`
}

func (s *SongStore) RecordProjection(p Projection) error {
	if p.ID == "" || p.SongID == "" || p.TimeMillis <= 0 {
		return fmt.Errorf("missing song projection identity or time")
	}
	// Preserve the local service date even if the operator later changes zones.
	stamp := time.UnixMilli(p.TimeMillis).Local().Format(time.RFC3339)
	_, err := s.db.Exec(`INSERT INTO song_projections
		(id, projected_at, song_id, title, authors, ccli_number)
		VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
		p.ID, stamp, p.SongID, p.Title, p.Authors, p.CCLINumber)
	return err
}

func (s *SongStore) Projections(from, to string) ([]Projection, error) {
	if _, err := time.Parse(time.DateOnly, from); err != nil {
		return nil, fmt.Errorf("choose a valid start date")
	}
	end, err := time.Parse(time.DateOnly, to)
	if err != nil || from > to {
		return nil, fmt.Errorf("choose an end date on or after the start date")
	}
	rows, err := s.db.Query(`SELECT id, projected_at, song_id, title, authors,
		COALESCE(reviewed_number, ccli_number), included FROM song_projections
		WHERE projected_at >= ? AND projected_at < ? ORDER BY projected_at, rowid`,
		from, end.AddDate(0, 0, 1).Format(time.DateOnly))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Projection{}
	for rows.Next() {
		var p Projection
		if err := rows.Scan(&p.ID, &p.ProjectedAt, &p.SongID, &p.Title, &p.Authors, &p.CCLINumber, &p.Included); err != nil {
			return nil, err
		}
		result = append(result, p)
	}
	return result, rows.Err()
}

func (s *SongStore) ReviewProjection(p ProjectionReview) error {
	r, err := s.db.Exec(`UPDATE song_projections SET reviewed_number = ?, included = ? WHERE id = ?`,
		strings.TrimSpace(p.CCLINumber), p.Included, p.ID)
	if err != nil {
		return err
	}
	n, err := r.RowsAffected()
	if err == nil && n == 0 {
		return fmt.Errorf("song projection no longer exists")
	}
	return err
}
