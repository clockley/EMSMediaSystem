/*
Copyright (C) 2024 Christian Lockley
This library is free software; you can redistribute it and/or modify it
under the terms of the GNU Lesser General Public License as published by
the Free Software Foundation; either version 3 of the License, or
(at your option) any later version.

This library is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
Lesser General Public License for more details.

You should have received a copy of the GNU Lesser General Public License
along with this library. If not, see <https://www.gnu.org/licenses/>.
*/

// EasyWorship Bible (.ewb) in-place support.
//
// Installed plugins are opened read-only. EMS keeps the book catalog and
// chapter sizes, then reads the source books for passage and search requests.
package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"emsmediasystem/bible-rpc/internal/ewb"
)

const ewbVersionSource = "ewb"

func closeEWBSources() {
	for _, version := range cachedVersions {
		if version.ewbSource != nil {
			version.ewbSource.Close()
		}
	}
}

// ewbBookNames maps a registered EasyWorship version key to that
// translation's own localized book names (canonical book ID → name).
var ewbBookNames map[string]map[int]string

// ewbBookAliases maps a registered EasyWorship version key to the
// normalized localized book-name aliases for that version only
// (normalized alias → canonical book ID). ewbBookAliasKeys holds the
// aliases sorted longest-first for prefix matching, mirroring
// cachedAliasKeys.
var ewbBookAliases map[string]map[string]int
var ewbBookAliasKeys map[string][]string

// registerEWBBookNames records the translation's own book names so display
// strings and reference parsing can use them for this version, even when a
// name is ambiguous across other loaded translations.
func registerEWBBookNames(version string, bible *ewb.Bible) {
	names := map[int]string{}
	aliases := map[string]int{}
	ambiguous := map[string]bool{}
	addAlias := func(alias string, bookID int) {
		if alias == "" || ambiguous[alias] {
			return
		}
		if existing, ok := aliases[alias]; ok && existing != bookID {
			ambiguous[alias] = true
			delete(aliases, alias)
			return
		}
		aliases[alias] = bookID
	}
	for _, book := range bible.Books {
		name := strings.TrimSpace(book.Name)
		if name == "" {
			continue
		}
		if _, ok := cachedBookDetails[book.ID]; !ok {
			continue
		}
		names[book.ID] = name
		normalized := normalizeBibleAlias(name)
		addAlias(normalized, book.ID)
		if compact := strings.ReplaceAll(normalized, " ", ""); compact != normalized {
			addAlias(compact, book.ID)
		}
	}
	if len(names) == 0 {
		return
	}
	keys := make([]string, 0, len(aliases))
	for alias := range aliases {
		keys = append(keys, alias)
	}
	sort.Slice(keys, func(i, j int) bool {
		leftTokens := len(strings.Fields(keys[i]))
		rightTokens := len(strings.Fields(keys[j]))
		if leftTokens != rightTokens {
			return leftTokens > rightTokens
		}
		return len(keys[i]) > len(keys[j])
	})
	if ewbBookNames == nil {
		ewbBookNames = map[string]map[int]string{}
		ewbBookAliases = map[string]map[string]int{}
		ewbBookAliasKeys = map[string][]string{}
	}
	ewbBookNames[version] = names
	ewbBookAliases[version] = aliases
	ewbBookAliasKeys[version] = keys
}

// nativeBookName returns the version's own localized name for a book, or
// fallback when the version has none.
func nativeBookName(version string, bookID int, fallback string) string {
	if names, ok := ewbBookNames[defaultVersion(version)]; ok {
		if name, ok := names[bookID]; ok {
			return name
		}
	}
	return fallback
}

// matchBookReferenceForVersion resolves a book reference using the
// version's native book names before the shared alias table, so localized
// input keeps working even when a name is ambiguous across translations.
func matchBookReferenceForVersion(version string, rawReference string) (BookMetadata, bool) {
	key := defaultVersion(version)
	if keys := ewbBookAliasKeys[key]; len(keys) > 0 {
		cleanInput := normalizeBibleAlias(rawReference)
		for _, alias := range keys {
			if cleanInput == alias || strings.HasPrefix(cleanInput, alias+" ") {
				if book, ok := cachedBookDetails[ewbBookAliases[key][alias]]; ok {
					return book, true
				}
			}
		}
	}
	return matchBookReference(rawReference)
}

// resolveBookID resolves an exact book-name string to its canonical ID,
// accepting the version's native book names as well as canonical names.
func resolveBookID(version string, bookName string) (int, bool) {
	if id, ok := cachedBooks[bookName]; ok {
		return id, true
	}
	if aliases, ok := ewbBookAliases[defaultVersion(version)]; ok {
		if id, ok := aliases[normalizeBibleAlias(bookName)]; ok {
			return id, true
		}
	}
	return 0, false
}

// EasyWorship keeps its Bible plugins in machine-wide application data.
// On Linux the same Windows layout lives under the active Wine prefix.
func ewbSearchDirectories(emsDirectory, platform string) []string {
	directories := []string{emsDirectory, os.Getenv("EMS_BIBLE_EWB_DIR")}
	var programData string
	switch platform {
	case "windows":
		programData = os.Getenv("ProgramData")
	case "linux":
		prefix := os.Getenv("WINEPREFIX")
		if prefix == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return directories
			}
			prefix = filepath.Join(home, ".wine")
		}
		programData = filepath.Join(prefix, "drive_c", "ProgramData")
	}
	if programData == "" {
		return directories
	}
	productNames := []string{"EasyWorship"}
	if platform == "linux" {
		// Wine preserves the spelling used by the installer or application.
		productNames = append(productNames, "Easyworship")
	}
	for _, suffix := range []string{".v8", ".v7", ".v6.1", ""} {
		for _, product := range productNames {
			directories = append(directories, filepath.Join(programData, "Softouch", product+suffix, "Plugins", "Bibles"))
		}
	}
	return directories
}

func ewbFilePaths(directory string) ([]string, error) {
	entries, err := os.ReadDir(directory)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	paths := []string{}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if strings.HasSuffix(strings.ToLower(entry.Name()), ".ewb") {
			paths = append(paths, filepath.Join(directory, entry.Name()))
		}
	}
	sort.Strings(paths)
	return paths, nil
}

func ewbVersionKey(bible *ewb.Bible, path string) string {
	key := strings.ToUpper(strings.TrimSpace(bible.Abbreviation))
	if key == "" {
		base := filepath.Base(path)
		key = strings.ToUpper(strings.TrimSuffix(base, filepath.Ext(base)))
	}
	return key
}

func ewbVersionFor(key string, tableName string, bible *ewb.Bible) Version {
	sourceName := filepath.Base(bible.Path)
	abbreviation := ewbVersionKey(bible, bible.Path)
	version := Version{
		Abbreviation: abbreviation,
		Version:      abbreviation + " (EasyWorship)",
		TableName:    tableName,
		Source:       ewbVersionSource,
		CopyrightInfo: fmt.Sprintf(
			"Read in place from the EasyWorship Bible file %q. The text remains the property of its copyright holder; use requires a valid license for this translation.",
			sourceName,
		),
	}
	if bible.Name != "" {
		version.Version = bible.Name
	}
	version.Language = bible.Language
	version.Attribution = attributionForVersion(version)
	// The registry key can include a collision suffix. Keep the published
	// abbreviation in the attribution used for projection.
	version.Abbreviation = key
	return version
}

// registerEWBBookAliases adds localized book names found in .ewb files as
// reference aliases, but only when they are new and unambiguous.
func registerEWBBookAliases(bibles []*ewb.Bible) {
	candidates := map[string]map[string]bool{}
	for _, bible := range bibles {
		for _, book := range bible.Books {
			canonical, ok := cachedBookDetails[book.ID]
			if !ok || strings.TrimSpace(book.Name) == "" {
				continue
			}
			addAliasCandidate(candidates, book.Name, canonical.Name)
		}
	}
	added := false
	for alias, matches := range candidates {
		if len(matches) != 1 {
			continue
		}
		if _, exists := cachedAliases[alias]; exists {
			continue
		}
		for bookName := range matches {
			cachedAliases[alias] = bookName
			added = true
		}
	}
	if !added {
		return
	}
	keys := make([]string, 0, len(cachedAliases))
	for alias := range cachedAliases {
		keys = append(keys, alias)
	}
	sort.Slice(keys, func(i, j int) bool {
		leftTokens := len(strings.Fields(keys[i]))
		rightTokens := len(strings.Fields(keys[j]))
		if leftTokens != rightTokens {
			return leftTokens > rightTokens
		}
		return len(keys[i]) > len(keys[j])
	})
	cachedAliasKeys = keys
}

// openEWBBatch validates files concurrently and returns them in discovery
// order. A failed open leaves its slot empty.
func openEWBBatch(paths []string) []*ewb.Source {
	sources := make([]*ewb.Source, len(paths))
	var workers sync.WaitGroup
	for i, path := range paths {
		workers.Add(1)
		go func() {
			defer workers.Done()
			source, err := ewb.Open(path)
			if err != nil {
				log.Printf("skipping EasyWorship Bible %s: %v", path, err)
				return
			}
			sources[i] = source
		}()
	}
	workers.Wait()
	return sources
}

// loadEWBBibles reads plugins in place. Directory order sets precedence for
// duplicate translations. Within each directory, filename order is stable.
func loadEWBBibles(directories ...string) {
	var paths []string
	seen := map[string]bool{}
	for _, directory := range directories {
		if strings.TrimSpace(directory) == "" {
			continue
		}
		directory = filepath.Clean(directory)
		if seen[directory] {
			continue
		}
		seen[directory] = true
		files, err := ewbFilePaths(directory)
		if err != nil {
			log.Printf("skipping EasyWorship Bible directory %s: %v", directory, err)
			continue
		}
		paths = append(paths, files...)
	}
	if len(paths) == 0 {
		return
	}

	seenVersionDirectory := map[string]string{}
	var loaded []*ewb.Bible
	for len(paths) > 0 {
		count := min(len(paths), ewb.DecodeConcurrency())
		batch := openEWBBatch(paths[:count])
		paths = paths[count:]
		for _, source := range batch {
			if source == nil {
				continue
			}
			path := source.Path
			key := ewbVersionKey(&source.Bible, path)
			directory := filepath.Dir(path)
			if first, exists := seenVersionDirectory[key]; exists && first != directory {
				source.Close()
				continue
			}
			seenVersionDirectory[key] = directory
			if _, exists := cachedVersions[key]; exists {
				key += "-EW"
				if _, exists := cachedVersions[key]; exists {
					source.Close()
					continue
				}
			}
			version := ewbVersionFor(key, fmt.Sprintf("ewb_%d", len(loaded)+1), &source.Bible)
			version.ewbSource = source
			cachedVersions[key] = version
			registerEWBBookNames(key, &source.Bible)
			loaded = append(loaded, &source.Bible)
			log.Printf("loaded EasyWorship Bible %s as %s (%d books, direct file access)", filepath.Base(path), key, len(source.Books))
		}
	}
	if len(loaded) > 0 {
		registerEWBBookAliases(loaded)
	}
}
