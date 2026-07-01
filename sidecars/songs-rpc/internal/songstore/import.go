package songstore

import (
	"emsmediasystem/songs-rpc/internal/songimport"
)

type ImportFilesOptions struct {
	Paths           []string      `json:"paths"`
	DefaultFolderID *string       `json:"defaultFolderId"`
	Search          SearchOptions `json:"search"`
	AIImportEnabled bool          `json:"aiImportEnabled"`
	AIModelPath     string        `json:"aiModelPath"`
}

type ImportFilesResult struct {
	Imported      []string        `json:"imported"`
	Failed        []ImportFailure `json:"failed"`
	LastSong      interface{}     `json:"lastSong"`
	Folders       []Folder        `json:"folders"`
	SearchResults []SearchResult  `json:"searchResults"`
}

type ImportFailure struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

func songBlockFromParsed(block songimport.ParsedBlock) SongBlock {
	segments := make([]SongSegment, 0, len(block.Primary.Segments))
	for _, segment := range block.Primary.Segments {
		segments = append(segments, SongSegment{
			Type:  segment.Type,
			Text:  segment.Text,
			Style: segment.Style,
		})
	}
	return SongBlock{
		Type: block.Type,
		ID:   block.ID,
		Primary: SongBlockPrimary{
			Lang:     block.Primary.Lang,
			Segments: segments,
		},
		Translations: block.Translations,
		Annotations:  block.Annotations,
	}
}

func (s *SongStore) ImportFiles(options ImportFilesOptions) (ImportFilesResult, error) {
	imported := []string{}
	failed := []ImportFailure{}
	var lastSong interface{}

	for _, path := range options.Paths {
		parsed, originalContent, err := songimport.ParseFile(path)
		if err != nil {
			failed = append(failed, ImportFailure{
				Path:  path,
				Error: err.Error(),
			})
			continue
		}

		song := Song{
			Schema:     "ems.song.v1",
			ID:         parsed.ID,
			Title:      parsed.Title,
			SongNumber: parsed.SongNumber,
			FolderID:   options.DefaultFolderID,
			Metadata: SongMetadata{
				Authors:    parsed.Metadata.Authors,
				Copyright:  parsed.Metadata.Copyright,
				CCLINumber: "",
				OneLicense: "",
				Meter:      parsed.Metadata.Meter,
			},
			Sections:     []SongSection{},
			Arrangements: []Arrangement{},
			PlayOrder:    []PlayOrderEntry{},
		}
		if parsed.Metadata.CCLINumber != nil {
			song.Metadata.CCLINumber = *parsed.Metadata.CCLINumber
		}

		for _, sec := range parsed.Sections {
			var blocks []SongBlock
			for _, block := range sec.Blocks {
				blocks = append(blocks, songBlockFromParsed(block))
			}
			song.Sections = append(song.Sections, SongSection{
				ID:     sec.ID,
				Kind:   sec.Kind,
				Label:  sec.Label,
				Blocks: blocks,
			})
		}

		if len(parsed.PlayOrder) > 0 {
			for _, seqEntry := range parsed.PlayOrder {
				if seqEntry.SectionID == "" {
					continue
				}
				song.PlayOrder = append(song.PlayOrder, PlayOrderEntry{
					ID:        seqEntry.ID,
					SectionID: seqEntry.SectionID,
					Enabled:   seqEntry.Enabled,
				})
			}
		} else {
			for _, arr := range parsed.Arrangements {
				var seq []string
				for _, seqEntry := range arr.Sequence {
					if seqEntry.Enabled == nil || *seqEntry.Enabled {
						seq = append(seq, seqEntry.SectionID)
					}
				}
				song.Arrangements = append(song.Arrangements, Arrangement{
					ID:       arr.ID,
					Name:     arr.Name,
					Sequence: seq,
				})
			}
		}

		err = s.SaveSong(song, originalContent)
		if err != nil {
			failed = append(failed, ImportFailure{
				Path:  path,
				Error: err.Error(),
			})
			continue
		}

		imported = append(imported, song.ID)
		if saved, err := s.GetSong(song.ID); err == nil {
			lastSong = saved
		} else {
			lastSong = s.ConvertToDeck(song)
		}
	}

	folders, err := s.ListFolders()
	if err != nil {
		folders = []Folder{}
	}

	searchResults, err := s.Search(options.Search)
	if err != nil {
		searchResults = []SearchResult{}
	}

	return ImportFilesResult{
		Imported:      imported,
		Failed:        failed,
		LastSong:      lastSong,
		Folders:       folders,
		SearchResults: searchResults,
	}, nil
}
