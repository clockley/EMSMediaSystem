package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"emsmediasystem/bible-rpc/internal/biblestore"
)

func installedPackagePaths(directory string) ([]string, error) {
	entries, err := os.ReadDir(directory)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	paths := []string{}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(strings.ToLower(entry.Name()), ".sqlite") {
			paths = append(paths, filepath.Join(directory, entry.Name()))
		}
	}
	sort.Strings(paths)
	return paths, nil
}

func hashFiles(paths ...string) (string, error) {
	hash := sha256.New()
	for _, path := range paths {
		file, err := os.Open(path)
		if err != nil {
			return "", err
		}
		if _, err := io.Copy(hash, file); err != nil {
			file.Close()
			return "", err
		}
		if err := file.Close(); err != nil {
			return "", err
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func copyFile(source, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(output, input); err != nil {
		output.Close()
		return err
	}
	return output.Close()
}

// prepareInstalledBibleDatabase uses the immutable packaged cache directly
// unless standalone SQLite packages have been downloaded into the user's
// packages directory. With installed packages it creates an atomic combined
// cache under user data, leaving both bundled and downloaded files untouched.
func prepareInstalledBibleDatabase(bundleDir, packagesDir, cacheDir string) (string, error) {
	bundledDB := filepath.Join(bundleDir, "bible-runtime.sqlite")
	if info, err := os.Stat(bundledDB); err != nil || !info.Mode().IsRegular() {
		return "", fmt.Errorf("bundled Bible cache is missing: %s", bundledDB)
	}
	packages, err := installedPackagePaths(packagesDir)
	if err != nil {
		return "", err
	}
	if len(packages) == 0 {
		return bundledDB, nil
	}
	fingerprint, err := hashFiles(append([]string{bundledDB}, packages...)...)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(cacheDir, 0o700); err != nil {
		return "", err
	}
	dbPath := filepath.Join(cacheDir, "bible-runtime.sqlite")
	fingerprintPath := filepath.Join(cacheDir, "bible-runtime.fingerprint")
	if current, err := os.ReadFile(fingerprintPath); err == nil && strings.TrimSpace(string(current)) == fingerprint {
		if info, err := os.Stat(dbPath); err == nil && info.Size() > 0 {
			return dbPath, nil
		}
	}
	temporary := dbPath + ".tmp"
	_ = os.Remove(temporary)
	if err := copyFile(bundledDB, temporary); err != nil {
		return "", err
	}
	if err := mergeInstalledPackages(temporary, packages); err != nil {
		_ = os.Remove(temporary)
		return "", err
	}
	_ = os.Remove(dbPath)
	if err := os.Rename(temporary, dbPath); err != nil {
		return "", err
	}
	if err := os.WriteFile(fingerprintPath, []byte(fingerprint+"\n"), 0o600); err != nil {
		return "", err
	}
	return dbPath, nil
}

func mergeInstalledPackages(targetPath string, packages []string) error {
	target, err := sql.Open(sqliteDriverName, targetPath)
	if err != nil {
		return err
	}
	defer target.Close()
	var nextVersionID int
	if err := target.QueryRow(`SELECT COALESCE(MAX(id),0)+1 FROM bible_version_key`).Scan(&nextVersionID); err != nil {
		return err
	}
	var nextRowID int64
	if err := target.QueryRow(`SELECT COALESCE(MAX(rowid),0) FROM bible_verse_lookup`).Scan(&nextRowID); err != nil {
		return err
	}
	for packageIndex, packagePath := range packages {
		packageDB, err := sql.Open(sqliteDriverName, packagePath)
		if err != nil {
			return err
		}
		if err := requireOptimizedBibleDatabase(packageDB); err != nil {
			packageDB.Close()
			return fmt.Errorf("invalid Bible package %s: %w", packagePath, err)
		}
		versions, err := fetchVersions(packageDB)
		if err != nil {
			packageDB.Close()
			return err
		}
		if err := validateVersionAttributions(versions); err != nil {
			packageDB.Close()
			return err
		}
		keys := make([]string, 0, len(versions))
		for key := range versions {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		packageHash, err := hashFiles(packagePath)
		if err != nil {
			packageDB.Close()
			return err
		}
		for versionIndex, key := range keys {
			version := versions[key]
			var exists int
			if err := target.QueryRow(`SELECT COUNT(*) FROM bible_version_key WHERE abbreviation=?`, version.Abbreviation).Scan(&exists); err != nil {
				packageDB.Close()
				return err
			}
			if exists != 0 {
				packageDB.Close()
				return fmt.Errorf("installed Bible abbreviation already exists: %s", version.Abbreviation)
			}
			tableName := fmt.Sprintf("installed_%d_%d", packageIndex+1, versionIndex+1)
			tx, err := target.Begin()
			if err != nil {
				packageDB.Close()
				return err
			}
			rollback := func(cause error) error { _ = tx.Rollback(); return cause }
			if _, err := tx.Exec(`INSERT INTO bible_version_key(id,"table",abbreviation,language,version,info_text,info_url,publisher,copyright,copyright_info) VALUES(?,?,?,?,?,?,?,?,?,?)`, nextVersionID, tableName, version.Abbreviation, version.Language, version.Version, version.InfoText, version.InfoURL, version.Publisher, version.Copyright, version.CopyrightInfo); err != nil {
				packageDB.Close()
				return rollback(err)
			}
			catalogID := "installed:" + packageHash[:16] + ":" + strings.ToLower(version.Abbreviation)
			if _, err := tx.Exec(`INSERT INTO bible_source_catalog(id,abbreviation,display_name,source_type,manifest_path,content_path,revision,status) VALUES(?,?,?,?,?,?,?,?)`, catalogID, version.Abbreviation, version.Version, "installed", "", packagePath, packageHash[:16], "ready"); err != nil {
				packageDB.Close()
				return rollback(err)
			}
			rows, err := packageDB.Query(`SELECT b,c,verse_count,t FROM bible_chapter_text WHERE table_name=? ORDER BY b,c`, version.TableName)
			if err != nil {
				packageDB.Close()
				return rollback(err)
			}
			for rows.Next() {
				var book, chapter, verseCount int
				var compressed []byte
				if err := rows.Scan(&book, &chapter, &verseCount, &compressed); err != nil {
					rows.Close()
					packageDB.Close()
					return rollback(err)
				}
				verses, err := biblestore.DecompressChapterVerses(compressed)
				if err != nil {
					rows.Close()
					packageDB.Close()
					return rollback(err)
				}
				if len(verses) != verseCount {
					rows.Close()
					packageDB.Close()
					return rollback(fmt.Errorf("invalid verse count in %s", packagePath))
				}
				if _, err := tx.Exec(`INSERT INTO bible_chapter_text(table_name,b,c,verse_count,t) VALUES(?,?,?,?,?)`, tableName, book, chapter, verseCount, compressed); err != nil {
					rows.Close()
					packageDB.Close()
					return rollback(err)
				}
				for _, verse := range verses {
					nextRowID++
					if _, err := tx.Exec(`INSERT INTO bible_verse_lookup(rowid,version,table_name,b,c,v,verse_id) VALUES(?,?,?,?,?,?,?)`, nextRowID, version.Abbreviation, tableName, book, chapter, verse.Verse, book*1_000_000+chapter*1_000+verse.Verse); err != nil {
						rows.Close()
						packageDB.Close()
						return rollback(err)
					}
					if _, err := tx.Exec(`INSERT INTO bible_text_fts(rowid,t) VALUES(?,?)`, nextRowID, verse.Text); err != nil {
						rows.Close()
						packageDB.Close()
						return rollback(err)
					}
				}
			}
			if err := rows.Close(); err != nil {
				packageDB.Close()
				return rollback(err)
			}
			if err := tx.Commit(); err != nil {
				packageDB.Close()
				return err
			}
			nextVersionID++
		}
		if err := packageDB.Close(); err != nil {
			return err
		}
	}
	return nil
}
