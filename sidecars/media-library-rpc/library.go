package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	_ "modernc.org/sqlite"
)

const (
	addedFilesSourceID = "added-files"
	recentSourceID     = "recent"
	maxFilesPerSource  = 100000
	maxScanDepth       = 64
	maxRecentItems     = 500
)

var localCapabilities = []string{"browse", "search", "read", "thumbnail", "watch"}

type readyOptions struct {
	DatabasePath       string `json:"databasePath"`
	ThumbnailCachePath string `json:"thumbnailCachePath"`
}

type sourceView struct {
	ID           string   `json:"id"`
	ProviderType string   `json:"providerType"`
	DisplayName  string   `json:"displayName"`
	Enabled      bool     `json:"enabled"`
	Status       string   `json:"status"`
	Capabilities []string `json:"capabilities"`
	LastSyncAt   *string  `json:"lastSyncAt"`
	ItemCount    int64    `json:"itemCount"`
	RootLabel    string   `json:"rootLabel"`
	Error        string   `json:"error"`
}

type sourceRecord struct {
	sourceView
	RootLocator string
}

type itemView struct {
	ID              string  `json:"id"`
	SourceID        string  `json:"sourceId"`
	ProviderItemID  string  `json:"providerItemId"`
	ParentID        string  `json:"parentId"`
	Kind            string  `json:"kind"`
	DisplayName     string  `json:"displayName"`
	FileName        string  `json:"fileName"`
	MimeType        string  `json:"mimeType"`
	Size            int64   `json:"size"`
	ModifiedAt      string  `json:"modifiedAt"`
	Availability    string  `json:"availability"`
	SourceName      string  `json:"sourceName"`
	LocalPath       string  `json:"localPath"`
	ContentIdentity string  `json:"contentIdentity"`
	RecentAt        *string `json:"recentAt"`
}

type mediaClass struct {
	Kind     string
	MimeType string
}

type scannedItem struct {
	itemView
	PathKey string
}

type queryOptions struct {
	Query        string   `json:"query"`
	SourceID     string   `json:"sourceId"`
	ParentID     string   `json:"parentId"`
	Kinds        []string `json:"kinds"`
	Availability string   `json:"availability"`
	Sort         string   `json:"sort"`
	Offset       int      `json:"offset"`
	Limit        int      `json:"limit"`
}

type queryResult struct {
	Revision int64      `json:"revision"`
	Items    []itemView `json:"items"`
	Total    int        `json:"total"`
	Offset   int        `json:"offset"`
	Limit    int        `json:"limit"`
	HasMore  bool       `json:"hasMore"`
}

type folderView struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	ItemCount int    `json:"itemCount"`
}

type activityInput struct {
	ItemID         string `json:"itemId"`
	LocalPath      string `json:"localPath"`
	ActionKind     string `json:"actionKind"`
	ProjectID      string `json:"projectId"`
	RetentionState string `json:"retentionState"`
}

type activityResult struct {
	ItemID     string `json:"itemId"`
	LastUsedAt string `json:"lastUsedAt"`
}

type droppedPathsResult struct {
	Sources []sourceView `json:"sources"`
	Items   []itemView   `json:"items"`
}

type changeRecord struct {
	Revision int64    `json:"revision"`
	Kind     string   `json:"kind"`
	IDs      []string `json:"ids"`
}

type snapshotResult struct {
	Revision int64            `json:"revision"`
	Sources  []sourceView     `json:"sources"`
	Counts   map[string]int64 `json:"counts"`
}

type changesResult struct {
	Revision  int64          `json:"revision"`
	Changes   []changeRecord `json:"changes"`
	Compacted bool           `json:"compacted"`
}

type thumbnailRequest struct {
	ItemID string `json:"itemId"`
	Size   int    `json:"size"`
}

type thumbnailResult struct {
	OK      bool   `json:"ok"`
	Output  string `json:"output,omitempty"`
	Mtime   int64  `json:"mtime,omitempty"`
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

type libraryService struct {
	mu              sync.Mutex
	db              *sql.DB
	databasePath    string
	thumbnailPath   string
	excludedRoots   []string
	notify          func(changeRecord)
	watcher         *fsnotify.Watcher
	watchedBySource map[string]map[string]struct{}
	ownersByDir     map[string]map[string]struct{}
	rescanTimers    map[string]*time.Timer
	stop            chan struct{}
	closed          bool
}

func newLibraryService(notify func(changeRecord)) *libraryService {
	return &libraryService{
		notify:          notify,
		watchedBySource: make(map[string]map[string]struct{}),
		ownersByDir:     make(map[string]map[string]struct{}),
		rescanTimers:    make(map[string]*time.Timer),
		stop:            make(chan struct{}),
	}
}

func (s *libraryService) Ready(options readyOptions) (snapshotResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db != nil {
		return s.snapshotLocked()
	}
	if strings.TrimSpace(options.DatabasePath) == "" || strings.TrimSpace(options.ThumbnailCachePath) == "" {
		return snapshotResult{}, fmt.Errorf("databasePath and thumbnailCachePath are required")
	}
	dbPath, err := filepath.Abs(options.DatabasePath)
	if err != nil {
		return snapshotResult{}, err
	}
	cachePath, err := filepath.Abs(options.ThumbnailCachePath)
	if err != nil {
		return snapshotResult{}, err
	}
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return snapshotResult{}, err
	}
	if err := os.MkdirAll(cachePath, 0o755); err != nil {
		return snapshotResult{}, err
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return snapshotResult{}, err
	}
	db.SetMaxOpenConns(1)
	s.db = db
	s.databasePath = dbPath
	s.thumbnailPath = cachePath
	s.excludedRoots = []string{filepath.Dir(dbPath), cachePath}
	if err := s.createSchemaLocked(); err != nil {
		db.Close()
		s.db = nil
		return snapshotResult{}, err
	}
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return snapshotResult{}, err
	}
	s.watcher = watcher
	go s.watchLoop(watcher)
	go s.pollLoop()
	go s.RefreshAll()
	return s.snapshotLocked()
}

func (s *libraryService) createSchemaLocked() error {
	statements := []string{
		`PRAGMA journal_mode=WAL`,
		`PRAGMA synchronous=NORMAL`,
		`PRAGMA busy_timeout=5000`,
		`CREATE TABLE IF NOT EXISTS sources (
			id TEXT PRIMARY KEY, provider_type TEXT NOT NULL, display_name TEXT NOT NULL,
			root_locator TEXT NOT NULL DEFAULT '', root_key TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
			status TEXT NOT NULL DEFAULT 'ready', capabilities_json TEXT NOT NULL DEFAULT '[]',
			last_sync_at TEXT, item_count INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS sources_root_key ON sources(root_key) WHERE root_key <> ''`,
		`CREATE TABLE IF NOT EXISTS items (
			id TEXT PRIMARY KEY, source_id TEXT NOT NULL, provider_item_id TEXT NOT NULL DEFAULT '', parent_id TEXT NOT NULL DEFAULT '',
			kind TEXT NOT NULL, display_name TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL,
			size_bytes INTEGER NOT NULL DEFAULT 0, modified_at TEXT NOT NULL, content_identity TEXT NOT NULL,
			availability TEXT NOT NULL DEFAULT 'available', local_path TEXT NOT NULL, path_key TEXT NOT NULL,
			transient INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS items_source_path ON items(source_id, path_key)`,
		`CREATE INDEX IF NOT EXISTS items_source_parent ON items(source_id, parent_id)`,
		`CREATE INDEX IF NOT EXISTS items_kind ON items(kind)`,
		`CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(item_id UNINDEXED, display_name, file_name, parent_id, tokenize='unicode61')`,
		`CREATE TABLE IF NOT EXISTS recent_activity (
			item_id TEXT PRIMARY KEY, action_kind TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '',
			last_used_at TEXT NOT NULL, retention_state TEXT NOT NULL DEFAULT 'transient'
		)`,
		`CREATE TABLE IF NOT EXISTS thumbnails (
			item_id TEXT NOT NULL, size_class INTEGER NOT NULL, cache_path TEXT NOT NULL,
			generation_version INTEGER NOT NULL DEFAULT 1, source_fingerprint TEXT NOT NULL,
			created_at TEXT NOT NULL, PRIMARY KEY(item_id, size_class)
		)`,
		`CREATE TABLE IF NOT EXISTS change_journal (
			revision INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, ids_json TEXT NOT NULL, created_at TEXT NOT NULL
		)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("media library schema: %w", err)
		}
	}
	capabilities, _ := json.Marshal(localCapabilities)
	_, err := s.db.Exec(`INSERT INTO sources(id, provider_type, display_name, enabled, status, capabilities_json)
		VALUES(?, 'local-files', 'Added Files', 1, 'ready', ?) ON CONFLICT(id) DO NOTHING`, addedFilesSourceID, string(capabilities))
	return err
}

func (s *libraryService) ensureReadyLocked() error {
	if s.db == nil {
		return fmt.Errorf("media library is not initialized")
	}
	return nil
}

func (s *libraryService) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.closed = true
	close(s.stop)
	for _, timer := range s.rescanTimers {
		timer.Stop()
	}
	if s.watcher != nil {
		_ = s.watcher.Close()
	}
	if s.db != nil {
		_ = s.db.Close()
	}
}

func parseInt64(value string) int64 {
	n, _ := strconv.ParseInt(value, 10, 64)
	return n
}

func newID() string {
	bytes := make([]byte, 16)
	_, _ = rand.Read(bytes)
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes)
	return fmt.Sprintf("%s-%s-%s-%s-%s", encoded[:8], encoded[8:12], encoded[12:16], encoded[16:20], encoded[20:])
}

func canonicalPath(value string) (string, error) {
	if strings.TrimSpace(value) == "" {
		return "", fmt.Errorf("path is required")
	}
	abs, err := filepath.Abs(strings.TrimSpace(value))
	if err != nil {
		return "", err
	}
	return filepath.Clean(abs), nil
}

func pathKey(value string) string {
	clean := filepath.Clean(value)
	if os.PathSeparator == '\\' {
		return strings.ToLower(clean)
	}
	return clean
}

func pathInside(root, candidate string) bool {
	relative, err := filepath.Rel(root, candidate)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(os.PathSeparator)) && !filepath.IsAbs(relative)
}

func hiddenName(name string) bool {
	return strings.HasPrefix(name, ".") && name != "." && name != ".."
}

func classifyMedia(fileName string) (mediaClass, bool) {
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(fileName)), ".")
	classes := map[string]mediaClass{
		"bmp": {"image", "image/bmp"}, "gif": {"image", "image/gif"}, "heic": {"image", "image/heic"},
		"jpeg": {"image", "image/jpeg"}, "jpg": {"image", "image/jpeg"}, "png": {"image", "image/png"},
		"svg": {"image", "image/svg+xml"}, "tif": {"image", "image/tiff"}, "tiff": {"image", "image/tiff"}, "webp": {"image", "image/webp"},
		"avi": {"video", "video/x-msvideo"}, "m4v": {"video", "video/x-m4v"}, "mkv": {"video", "video/x-matroska"},
		"mov": {"video", "video/quicktime"}, "mp4": {"video", "video/mp4"}, "mpeg": {"video", "video/mpeg"},
		"mpg": {"video", "video/mpeg"}, "ogv": {"video", "video/ogg"}, "webm": {"video", "video/webm"}, "wmv": {"video", "video/x-ms-wmv"},
		"aac": {"audio", "audio/aac"}, "flac": {"audio", "audio/flac"}, "m4a": {"audio", "audio/mp4"}, "mp3": {"audio", "audio/mpeg"},
		"oga": {"audio", "audio/ogg"}, "ogg": {"audio", "audio/ogg"}, "opus": {"audio", "audio/opus"}, "wav": {"audio", "audio/wav"}, "wma": {"audio", "audio/x-ms-wma"},
		"pptx": {"presentation", "application/vnd.openxmlformats-officedocument.presentationml.presentation"},
	}
	class, ok := classes[ext]
	return class, ok
}

func displayName(fileName string) string {
	ext := filepath.Ext(fileName)
	if ext == "" {
		return fileName
	}
	name := strings.TrimSuffix(fileName, ext)
	if name == "" {
		return fileName
	}
	return name
}

func capabilitiesJSON() string {
	value, _ := json.Marshal(localCapabilities)
	return string(value)
}

func scanSourceRow(scanner interface{ Scan(...any) error }) (sourceRecord, error) {
	var source sourceRecord
	var enabled int
	var capabilities string
	var lastSync sql.NullString
	err := scanner.Scan(&source.ID, &source.ProviderType, &source.DisplayName, &source.RootLocator, &enabled,
		&source.Status, &capabilities, &lastSync, &source.ItemCount, &source.Error)
	if err != nil {
		return source, err
	}
	source.Enabled = enabled != 0
	_ = json.Unmarshal([]byte(capabilities), &source.Capabilities)
	if lastSync.Valid {
		source.LastSyncAt = &lastSync.String
	}
	source.RootLabel = filepath.Base(source.RootLocator)
	if source.RootLocator == "" {
		source.RootLabel = source.DisplayName
	}
	return source, nil
}

func (s *libraryService) sourceLocked(id string) (sourceRecord, error) {
	row := s.db.QueryRow(`SELECT id, provider_type, display_name, root_locator, enabled, status,
		capabilities_json, last_sync_at, item_count, error FROM sources WHERE id=?`, id)
	return scanSourceRow(row)
}

func (s *libraryService) revisionLocked() int64 {
	var revision sql.NullInt64
	_ = s.db.QueryRow(`SELECT MAX(revision) FROM change_journal`).Scan(&revision)
	return revision.Int64
}

func recordChangeTx(tx *sql.Tx, kind string, ids []string) (changeRecord, error) {
	encoded, _ := json.Marshal(ids)
	result, err := tx.Exec(`INSERT INTO change_journal(kind, ids_json, created_at) VALUES(?, ?, ?)`, kind, string(encoded), time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return changeRecord{}, err
	}
	revision, err := result.LastInsertId()
	if err == nil {
		_, err = tx.Exec(`DELETE FROM change_journal WHERE revision <= ?`, revision-2000)
	}
	return changeRecord{Revision: revision, Kind: kind, IDs: ids}, err
}

func (s *libraryService) notifyChange(change changeRecord) {
	if s.notify != nil {
		s.notify(change)
	}
}

func (s *libraryService) snapshotLocked() (snapshotResult, error) {
	rows, err := s.db.Query(`SELECT id, provider_type, display_name, root_locator, enabled, status,
		capabilities_json, last_sync_at, item_count, error FROM sources WHERE enabled=1 ORDER BY CASE id WHEN ? THEN 0 ELSE 1 END, display_name COLLATE NOCASE`, addedFilesSourceID)
	if err != nil {
		return snapshotResult{}, err
	}
	defer rows.Close()
	sources := []sourceView{}
	for rows.Next() {
		source, err := scanSourceRow(rows)
		if err != nil {
			return snapshotResult{}, err
		}
		sources = append(sources, source.sourceView)
	}
	counts := map[string]int64{"all": 0, "image": 0, "video": 0, "audio": 0, "presentation": 0}
	countRows, err := s.db.Query(`SELECT kind, COUNT(*) FROM items WHERE transient=0 GROUP BY kind`)
	if err != nil {
		return snapshotResult{}, err
	}
	defer countRows.Close()
	for countRows.Next() {
		var kind string
		var count int64
		_ = countRows.Scan(&kind, &count)
		counts[kind] = count
		counts["all"] += count
	}
	return snapshotResult{Revision: s.revisionLocked(), Sources: sources, Counts: counts}, nil
}

func (s *libraryService) Snapshot() (snapshotResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureReadyLocked(); err != nil {
		return snapshotResult{}, err
	}
	return s.snapshotLocked()
}

func (s *libraryService) ChangesSince(revision int64) (changesResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureReadyLocked(); err != nil {
		return changesResult{}, err
	}
	rows, err := s.db.Query(`SELECT revision, kind, ids_json FROM change_journal WHERE revision>? ORDER BY revision LIMIT 1000`, revision)
	if err != nil {
		return changesResult{}, err
	}
	defer rows.Close()
	changes := []changeRecord{}
	for rows.Next() {
		var change changeRecord
		var ids string
		if err := rows.Scan(&change.Revision, &change.Kind, &ids); err != nil {
			return changesResult{}, err
		}
		_ = json.Unmarshal([]byte(ids), &change.IDs)
		changes = append(changes, change)
	}
	var first sql.NullInt64
	_ = s.db.QueryRow(`SELECT MIN(revision) FROM change_journal`).Scan(&first)
	return changesResult{Revision: s.revisionLocked(), Changes: changes, Compacted: first.Valid && revision < first.Int64-1}, nil
}

func (s *libraryService) AddSource(folderPath string) (sourceView, error) {
	root, err := canonicalPath(folderPath)
	if err != nil {
		return sourceView{}, err
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return sourceView{}, fmt.Errorf("media sources must be folders")
	}
	s.mu.Lock()
	if err := s.ensureReadyLocked(); err != nil {
		s.mu.Unlock()
		return sourceView{}, err
	}
	for _, excluded := range s.excludedRoots {
		if pathKey(excluded) == pathKey(root) {
			s.mu.Unlock()
			return sourceView{}, fmt.Errorf("EMS database and thumbnail cache folders cannot be Media sources")
		}
	}
	var existingID string
	err = s.db.QueryRow(`SELECT id FROM sources WHERE root_key=?`, pathKey(root)).Scan(&existingID)
	if err == nil {
		_, _ = s.db.Exec(`UPDATE sources SET enabled=1 WHERE id=?`, existingID)
		source, sourceErr := s.sourceLocked(existingID)
		s.mu.Unlock()
		go s.ScanSource(existingID)
		return source.sourceView, sourceErr
	}
	if !errors.Is(err, sql.ErrNoRows) {
		s.mu.Unlock()
		return sourceView{}, err
	}
	id := newID()
	tx, err := s.db.Begin()
	if err != nil {
		s.mu.Unlock()
		return sourceView{}, err
	}
	_, err = tx.Exec(`INSERT INTO sources(id, provider_type, display_name, root_locator, root_key, enabled, status, capabilities_json)
		VALUES(?, 'local-folder', ?, ?, ?, 1, 'indexing', ?)`, id, filepath.Base(root), root, pathKey(root), capabilitiesJSON())
	change, changeErr := recordChangeTx(tx, "source-added", []string{id})
	if err == nil {
		err = changeErr
	}
	if err == nil {
		err = tx.Commit()
	} else {
		_ = tx.Rollback()
	}
	if err != nil {
		s.mu.Unlock()
		return sourceView{}, err
	}
	source, err := s.sourceLocked(id)
	s.mu.Unlock()
	s.notifyChange(change)
	go s.ScanSource(id)
	return source.sourceView, err
}

func (s *libraryService) ScanSource(sourceID string) (sourceView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureReadyLocked(); err != nil {
		return sourceView{}, err
	}
	if sourceID == addedFilesSourceID {
		source, err := s.sourceLocked(sourceID)
		return source.sourceView, err
	}
	source, err := s.sourceLocked(sourceID)
	if err != nil {
		return sourceView{}, err
	}
	_, _ = s.db.Exec(`UPDATE sources SET status='indexing', error='' WHERE id=?`, sourceID)
	rootInfo, statErr := os.Stat(source.RootLocator)
	if statErr != nil || !rootInfo.IsDir() {
		tx, err := s.db.Begin()
		if err != nil {
			return sourceView{}, err
		}
		message := "Folder is unavailable"
		if statErr != nil {
			message = statErr.Error()
		}
		_, err = tx.Exec(`UPDATE sources SET status='offline', error=? WHERE id=?`, message, sourceID)
		change, changeErr := recordChangeTx(tx, "source-offline", []string{sourceID})
		if err == nil {
			err = changeErr
		}
		if err == nil {
			err = tx.Commit()
		} else {
			_ = tx.Rollback()
		}
		if err != nil {
			return sourceView{}, err
		}
		s.removeSourceWatchesLocked(sourceID)
		s.notifyChange(change)
		offline, _ := s.sourceLocked(sourceID)
		return offline.sourceView, nil
	}

	existing := map[string]string{}
	rows, err := s.db.Query(`SELECT path_key, id FROM items WHERE source_id=?`, sourceID)
	if err != nil {
		return sourceView{}, err
	}
	for rows.Next() {
		var key, id string
		_ = rows.Scan(&key, &id)
		existing[key] = id
	}
	rows.Close()

	found := make([]scannedItem, 0)
	directories := make([]string, 0)
	err = filepath.WalkDir(source.RootLocator, func(localPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if localPath != source.RootLocator {
			if hiddenName(entry.Name()) || entry.Type()&os.ModeSymlink != 0 {
				if entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			for _, excluded := range s.excludedRoots {
				if pathInside(excluded, localPath) {
					if entry.IsDir() {
						return filepath.SkipDir
					}
					return nil
				}
			}
		}
		relative, _ := filepath.Rel(source.RootLocator, localPath)
		if entry.IsDir() {
			if relative != "." && len(strings.Split(filepath.ToSlash(relative), "/")) > maxScanDepth {
				return filepath.SkipDir
			}
			directories = append(directories, localPath)
			return nil
		}
		if len(found) >= maxFilesPerSource {
			return nil
		}
		class, ok := classifyMedia(entry.Name())
		if !ok {
			return nil
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			return nil
		}
		key := pathKey(localPath)
		id := existing[key]
		if id == "" {
			id = newID()
		}
		providerID := filepath.ToSlash(relative)
		parentID := filepath.ToSlash(filepath.Dir(relative))
		if parentID == "." {
			parentID = ""
		}
		found = append(found, scannedItem{itemView: itemView{
			ID: id, SourceID: sourceID, ProviderItemID: providerID, ParentID: parentID,
			Kind: class.Kind, DisplayName: displayName(entry.Name()), FileName: entry.Name(), MimeType: class.MimeType,
			Size: info.Size(), ModifiedAt: info.ModTime().UTC().Format(time.RFC3339Nano), Availability: "available",
			LocalPath: localPath, ContentIdentity: fmt.Sprintf("%d:%d", info.Size(), info.ModTime().UnixMilli()),
		}, PathKey: key})
		return nil
	})
	if err != nil {
		return sourceView{}, err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return sourceView{}, err
	}
	if _, err = tx.Exec(`UPDATE items SET availability='missing' WHERE source_id=?`, sourceID); err != nil {
		_ = tx.Rollback()
		return sourceView{}, err
	}
	for _, item := range found {
		_, err = tx.Exec(`INSERT INTO items(id, source_id, provider_item_id, parent_id, kind, display_name, file_name, mime_type,
			size_bytes, modified_at, content_identity, availability, local_path, path_key, transient)
			VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
			ON CONFLICT(source_id,path_key) DO UPDATE SET provider_item_id=excluded.provider_item_id, parent_id=excluded.parent_id,
			kind=excluded.kind, display_name=excluded.display_name, file_name=excluded.file_name, mime_type=excluded.mime_type,
			size_bytes=excluded.size_bytes, modified_at=excluded.modified_at, content_identity=excluded.content_identity,
			availability='available', local_path=excluded.local_path`, item.ID, item.SourceID, item.ProviderItemID, item.ParentID,
			item.Kind, item.DisplayName, item.FileName, item.MimeType, item.Size, item.ModifiedAt, item.ContentIdentity,
			item.Availability, item.LocalPath, item.PathKey)
		if err != nil {
			_ = tx.Rollback()
			return sourceView{}, err
		}
		_, _ = tx.Exec(`DELETE FROM items_fts WHERE item_id=?`, item.ID)
		_, err = tx.Exec(`INSERT INTO items_fts(item_id, display_name, file_name, parent_id) VALUES(?,?,?,?)`, item.ID, item.DisplayName, item.FileName, item.ParentID)
		if err != nil {
			_ = tx.Rollback()
			return sourceView{}, err
		}
	}
	thumbnailPaths, err := deleteThumbnailsTx(tx,
		`item_id IN (SELECT id FROM items WHERE source_id=? AND availability='missing')`, sourceID)
	if err != nil {
		_ = tx.Rollback()
		return sourceView{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	var count int64
	_ = tx.QueryRow(`SELECT COUNT(*) FROM items WHERE source_id=?`, sourceID).Scan(&count)
	_, err = tx.Exec(`UPDATE sources SET status='ready', error='', last_sync_at=?, item_count=? WHERE id=?`, now, count, sourceID)
	ids := make([]string, 0, len(found)+1)
	ids = append(ids, sourceID)
	for _, item := range found {
		ids = append(ids, item.ID)
	}
	change, changeErr := recordChangeTx(tx, "source-scanned", ids)
	if err == nil {
		err = changeErr
	}
	if err == nil {
		err = tx.Commit()
	} else {
		_ = tx.Rollback()
	}
	if err != nil {
		return sourceView{}, err
	}
	s.removeThumbnailFiles(thumbnailPaths)
	s.updateSourceWatchesLocked(sourceID, directories)
	s.notifyChange(change)
	updated, err := s.sourceLocked(sourceID)
	return updated.sourceView, err
}

func (s *libraryService) RefreshAll() (snapshotResult, error) {
	s.mu.Lock()
	if err := s.ensureReadyLocked(); err != nil {
		s.mu.Unlock()
		return snapshotResult{}, err
	}
	rows, err := s.db.Query(`SELECT id FROM sources WHERE enabled=1 AND id<>?`, addedFilesSourceID)
	if err != nil {
		s.mu.Unlock()
		return snapshotResult{}, err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	s.mu.Unlock()
	for _, id := range ids {
		_, _ = s.ScanSource(id)
	}
	return s.Snapshot()
}

func (s *libraryService) RemoveSource(sourceID string) (bool, error) {
	if sourceID == "" || sourceID == addedFilesSourceID {
		return false, fmt.Errorf("Added Files cannot be removed")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureReadyLocked(); err != nil {
		return false, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return false, err
	}
	itemRows, _ := tx.Query(`SELECT id FROM items WHERE source_id=?`, sourceID)
	ids := []string{sourceID}
	for itemRows.Next() {
		var id string
		_ = itemRows.Scan(&id)
		ids = append(ids, id)
	}
	itemRows.Close()
	thumbnailPaths, err := deleteThumbnailsTx(tx,
		`item_id IN (SELECT id FROM items WHERE source_id=?)`, sourceID)
	if err != nil {
		_ = tx.Rollback()
		return false, err
	}
	for _, id := range ids[1:] {
		_, _ = tx.Exec(`DELETE FROM items_fts WHERE item_id=?`, id)
		_, _ = tx.Exec(`DELETE FROM recent_activity WHERE item_id=?`, id)
	}
	_, _ = tx.Exec(`DELETE FROM items WHERE source_id=?`, sourceID)
	result, err := tx.Exec(`DELETE FROM sources WHERE id=?`, sourceID)
	if err != nil {
		_ = tx.Rollback()
		return false, err
	}
	change, err := recordChangeTx(tx, "source-removed", ids)
	if err == nil {
		err = tx.Commit()
	} else {
		_ = tx.Rollback()
	}
	if err != nil {
		return false, err
	}
	s.removeThumbnailFiles(thumbnailPaths)
	s.removeSourceWatchesLocked(sourceID)
	s.notifyChange(change)
	affected, _ := result.RowsAffected()
	return affected > 0, nil
}

func upsertItemTx(tx *sql.Tx, sourceID, localPath string, transient bool) (itemView, error) {
	class, ok := classifyMedia(localPath)
	if !ok {
		return itemView{}, fmt.Errorf("unsupported media type")
	}
	info, err := os.Stat(localPath)
	if err != nil || !info.Mode().IsRegular() {
		return itemView{}, fmt.Errorf("media file is unavailable")
	}
	key := pathKey(localPath)
	var id string
	_ = tx.QueryRow(`SELECT id FROM items WHERE source_id=? AND path_key=?`, sourceID, key).Scan(&id)
	if id == "" {
		id = newID()
	}
	item := itemView{ID: id, SourceID: sourceID, ProviderItemID: localPath, Kind: class.Kind,
		DisplayName: displayName(filepath.Base(localPath)), FileName: filepath.Base(localPath), MimeType: class.MimeType,
		Size: info.Size(), ModifiedAt: info.ModTime().UTC().Format(time.RFC3339Nano), ContentIdentity: fmt.Sprintf("%d:%d", info.Size(), info.ModTime().UnixMilli()),
		Availability: "available", LocalPath: localPath}
	transientValue := 0
	if transient {
		transientValue = 1
	}
	_, err = tx.Exec(`INSERT INTO items(id,source_id,provider_item_id,parent_id,kind,display_name,file_name,mime_type,size_bytes,modified_at,
		content_identity,availability,local_path,path_key,transient) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(source_id,path_key) DO UPDATE SET kind=excluded.kind,display_name=excluded.display_name,file_name=excluded.file_name,
		mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,modified_at=excluded.modified_at,content_identity=excluded.content_identity,
		availability='available',local_path=excluded.local_path,transient=excluded.transient`, item.ID, sourceID, localPath, "", item.Kind,
		item.DisplayName, item.FileName, item.MimeType, item.Size, item.ModifiedAt, item.ContentIdentity, item.Availability, localPath, key, transientValue)
	if err != nil {
		return itemView{}, err
	}
	_, _ = tx.Exec(`DELETE FROM items_fts WHERE item_id=?`, id)
	_, err = tx.Exec(`INSERT INTO items_fts(item_id,display_name,file_name,parent_id) VALUES(?,?,?,?)`, id, item.DisplayName, item.FileName, "")
	return item, err
}

func (s *libraryService) AddFiles(paths []string) ([]itemView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureReadyLocked(); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	items := []itemView{}
	ids := []string{}
	for _, rawPath := range paths {
		localPath, err := canonicalPath(rawPath)
		if err != nil {
			continue
		}
		// Promoting a transient Recent item removes the transient row first.
		var transientID string
		_ = tx.QueryRow(`SELECT id FROM items WHERE source_id=? AND path_key=?`, recentSourceID, pathKey(localPath)).Scan(&transientID)
		if transientID != "" {
			_, _ = tx.Exec(`DELETE FROM recent_activity WHERE item_id=?`, transientID)
			_, _ = tx.Exec(`DELETE FROM items_fts WHERE item_id=?`, transientID)
			_, _ = tx.Exec(`DELETE FROM items WHERE id=?`, transientID)
		}
		item, err := upsertItemTx(tx, addedFilesSourceID, localPath, false)
		if err != nil {
			continue
		}
		item.SourceName = "Added Files"
		items = append(items, item)
		ids = append(ids, item.ID)
	}
	var count int64
	_ = tx.QueryRow(`SELECT COUNT(*) FROM items WHERE source_id=?`, addedFilesSourceID).Scan(&count)
	_, _ = tx.Exec(`UPDATE sources SET item_count=?, last_sync_at=? WHERE id=?`, count, time.Now().UTC().Format(time.RFC3339Nano), addedFilesSourceID)
	if len(ids) == 0 {
		_ = tx.Rollback()
		return items, nil
	}
	change, err := recordChangeTx(tx, "items-added", ids)
	if err == nil {
		err = tx.Commit()
	} else {
		_ = tx.Rollback()
	}
	if err != nil {
		return nil, err
	}
	s.notifyChange(change)
	return items, nil
}

func (s *libraryService) AddDroppedPaths(paths []string) (droppedPathsResult, error) {
	result := droppedPathsResult{Sources: []sourceView{}, Items: []itemView{}}
	files := make([]string, 0, len(paths))
	for _, rawPath := range paths {
		localPath, err := canonicalPath(rawPath)
		if err != nil {
			continue
		}
		info, err := os.Stat(localPath)
		if err != nil {
			continue
		}
		if info.IsDir() {
			source, err := s.AddSource(localPath)
			if err == nil {
				result.Sources = append(result.Sources, source)
			}
			continue
		}
		if info.Mode().IsRegular() {
			if _, supported := classifyMedia(localPath); supported {
				files = append(files, localPath)
			}
		}
	}
	if len(files) > 0 {
		items, err := s.AddFiles(files)
		if err != nil {
			return result, err
		}
		result.Items = items
	}
	return result, nil
}

func (s *libraryService) RemoveAddedItems(itemIDs []string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureReadyLocked(); err != nil {
		return 0, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	removed := []string{}
	thumbnailPaths := []string{}
	for _, id := range itemIDs {
		var sourceID string
		if tx.QueryRow(`SELECT source_id FROM items WHERE id=?`, id).Scan(&sourceID) != nil || sourceID != addedFilesSourceID {
			continue
		}
		paths, err := deleteThumbnailsTx(tx, `item_id=?`, id)
		if err != nil {
			_ = tx.Rollback()
			return 0, err
		}
		thumbnailPaths = append(thumbnailPaths, paths...)
		_, _ = tx.Exec(`DELETE FROM recent_activity WHERE item_id=?`, id)
		_, _ = tx.Exec(`DELETE FROM items_fts WHERE item_id=?`, id)
		_, _ = tx.Exec(`DELETE FROM items WHERE id=?`, id)
		removed = append(removed, id)
	}
	if len(removed) == 0 {
		_ = tx.Rollback()
		return 0, nil
	}
	_, _ = tx.Exec(`UPDATE sources SET item_count=(SELECT COUNT(*) FROM items WHERE source_id=?) WHERE id=?`, addedFilesSourceID, addedFilesSourceID)
	change, err := recordChangeTx(tx, "items-removed", removed)
	if err == nil {
		err = tx.Commit()
	} else {
		_ = tx.Rollback()
	}
	if err != nil {
		return 0, err
	}
	s.removeThumbnailFiles(thumbnailPaths)
	s.notifyChange(change)
	return len(removed), nil
}

func scanItem(scanner interface{ Scan(...any) error }) (itemView, int, error) {
	var item itemView
	var recent sql.NullString
	var transient int
	err := scanner.Scan(&item.ID, &item.SourceID, &item.ProviderItemID, &item.ParentID, &item.Kind, &item.DisplayName,
		&item.FileName, &item.MimeType, &item.Size, &item.ModifiedAt, &item.Availability, &item.SourceName,
		&item.LocalPath, &item.ContentIdentity, &recent, &transient)
	if recent.Valid {
		item.RecentAt = &recent.String
	}
	return item, transient, err
}

const itemSelectColumns = `i.id,i.source_id,i.provider_item_id,i.parent_id,i.kind,i.display_name,i.file_name,i.mime_type,
	i.size_bytes,i.modified_at,CASE WHEN s.status='offline' THEN 'source-offline' ELSE i.availability END,
	COALESCE(s.display_name,'Recent'),i.local_path,i.content_identity,r.last_used_at,i.transient`

func (s *libraryService) GetItem(itemID string) (*itemView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureReadyLocked(); err != nil {
		return nil, err
	}
	row := s.db.QueryRow(`SELECT `+itemSelectColumns+` FROM items i LEFT JOIN sources s ON s.id=i.source_id
		LEFT JOIN recent_activity r ON r.item_id=i.id WHERE i.id=?`, itemID)
	item, _, err := scanItem(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &item, err
}

func normalizeQuery(options queryOptions) queryOptions {
	options.Query = strings.TrimSpace(options.Query)
	if len(options.Query) > 300 {
		options.Query = options.Query[:300]
	}
	if options.Limit <= 0 {
		options.Limit = 60
	}
	if options.Limit > 200 {
		options.Limit = 200
	}
	if options.Offset < 0 {
		options.Offset = 0
	}
	if options.Sort != "modified" && options.Sort != "recent" {
		options.Sort = "name"
	}
	return options
}

func ftsQuery(query string) string {
	parts := strings.Fields(query)
	quoted := make([]string, 0, len(parts))
	for _, part := range parts {
		quoted = append(quoted, `"`+strings.ReplaceAll(part, `"`, `""`)+`"*`)
	}
	return strings.Join(quoted, " AND ")
}

func (s *libraryService) Query(raw queryOptions) (queryResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureReadyLocked(); err != nil {
		return queryResult{}, err
	}
	options := normalizeQuery(raw)
	where := []string{"1=1"}
	args := []any{}
	joinRecent := options.SourceID == recentSourceID || options.Sort == "recent"
	if options.SourceID == recentSourceID {
		where = append(where, "r.item_id IS NOT NULL")
	} else {
		where = append(where, "i.transient=0")
	}
	if options.SourceID != "" && options.SourceID != "all" && options.SourceID != recentSourceID {
		where = append(where, "i.source_id=?")
		args = append(args, options.SourceID)
	}
	if options.ParentID != "" {
		where = append(where, "(i.parent_id=? OR i.parent_id LIKE ?)")
		args = append(args, options.ParentID, options.ParentID+"/%")
	}
	if len(options.Kinds) > 0 {
		placeholders := make([]string, len(options.Kinds))
		for index, kind := range options.Kinds {
			placeholders[index] = "?"
			args = append(args, kind)
		}
		where = append(where, "i.kind IN ("+strings.Join(placeholders, ",")+")")
	}
	if options.Availability != "" {
		where = append(where, "(CASE WHEN s.status='offline' THEN 'source-offline' ELSE i.availability END)=?")
		args = append(args, options.Availability)
	}
	if options.Query != "" {
		where = append(where, "i.id IN (SELECT item_id FROM items_fts WHERE items_fts MATCH ?)")
		args = append(args, ftsQuery(options.Query))
	}
	from := ` FROM items i LEFT JOIN sources s ON s.id=i.source_id LEFT JOIN recent_activity r ON r.item_id=i.id `
	_ = joinRecent
	condition := " WHERE " + strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow("SELECT COUNT(*)"+from+condition, args...).Scan(&total); err != nil {
		return queryResult{}, err
	}
	order := "i.display_name COLLATE NOCASE, i.id"
	if options.Sort == "modified" {
		order = "i.modified_at DESC, i.id"
	}
	if options.Sort == "recent" || options.SourceID == recentSourceID {
		order = "r.last_used_at DESC, i.id"
	}
	queryArgs := append(append([]any{}, args...), options.Limit, options.Offset)
	rows, err := s.db.Query("SELECT "+itemSelectColumns+from+condition+" ORDER BY "+order+" LIMIT ? OFFSET ?", queryArgs...)
	if err != nil {
		return queryResult{}, err
	}
	defer rows.Close()
	items := []itemView{}
	for rows.Next() {
		item, _, err := scanItem(rows)
		if err != nil {
			return queryResult{}, err
		}
		items = append(items, item)
	}
	return queryResult{Revision: s.revisionLocked(), Items: items, Total: total, Offset: options.Offset,
		Limit: options.Limit, HasMore: options.Offset+len(items) < total}, nil
}

func (s *libraryService) ListFolders(sourceID, parentID string) ([]folderView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureReadyLocked(); err != nil {
		return nil, err
	}
	if sourceID == "" || sourceID == "all" || sourceID == recentSourceID || sourceID == addedFilesSourceID {
		return []folderView{}, nil
	}
	rows, err := s.db.Query(`SELECT parent_id FROM items WHERE source_id=? AND parent_id<>''`, sourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	folders := map[string]*folderView{}
	parentID = strings.Trim(strings.ReplaceAll(parentID, "\\", "/"), "/")
	for rows.Next() {
		var itemParent string
		_ = rows.Scan(&itemParent)
		remainder := itemParent
		if parentID != "" {
			prefix := parentID + "/"
			if !strings.HasPrefix(itemParent, prefix) {
				continue
			}
			remainder = strings.TrimPrefix(itemParent, prefix)
		}
		name := strings.Split(remainder, "/")[0]
		if name == "" {
			continue
		}
		id := name
		if parentID != "" {
			id = parentID + "/" + name
		}
		if folders[id] == nil {
			folders[id] = &folderView{ID: id, Name: name}
		}
		folders[id].ItemCount++
	}
	result := make([]folderView, 0, len(folders))
	for _, folder := range folders {
		result = append(result, *folder)
	}
	sort.Slice(result, func(i, j int) bool { return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name) })
	return result, nil
}

func (s *libraryService) RecordActivity(input activityInput) (*activityResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureReadyLocked(); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	itemID := input.ItemID
	if itemID == "" && input.LocalPath != "" {
		localPath, err := canonicalPath(input.LocalPath)
		if err != nil {
			_ = tx.Rollback()
			return nil, err
		}
		_ = tx.QueryRow(`SELECT id FROM items WHERE path_key=? AND transient=0 LIMIT 1`, pathKey(localPath)).Scan(&itemID)
		if itemID == "" {
			item, err := upsertItemTx(tx, recentSourceID, localPath, true)
			if err != nil {
				_ = tx.Rollback()
				return nil, err
			}
			itemID = item.ID
		}
	}
	var exists int
	if itemID == "" || tx.QueryRow(`SELECT 1 FROM items WHERE id=?`, itemID).Scan(&exists) != nil {
		_ = tx.Rollback()
		return nil, nil
	}
	action := input.ActionKind
	if action != "scheduled" && action != "applied" {
		action = "previewed"
	}
	retention := input.RetentionState
	if retention != "kept" {
		retention = "transient"
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = tx.Exec(`INSERT INTO recent_activity(item_id,action_kind,project_id,last_used_at,retention_state) VALUES(?,?,?,?,?)
		ON CONFLICT(item_id) DO UPDATE SET action_kind=excluded.action_kind,project_id=excluded.project_id,
		last_used_at=excluded.last_used_at,retention_state=excluded.retention_state`, itemID, action, input.ProjectID, now, retention)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	_, _ = tx.Exec(`DELETE FROM recent_activity WHERE item_id IN (SELECT item_id FROM recent_activity ORDER BY last_used_at DESC LIMIT -1 OFFSET ?)`, maxRecentItems)
	_, _ = tx.Exec(`DELETE FROM items_fts WHERE item_id IN (SELECT id FROM items WHERE transient=1 AND id NOT IN (SELECT item_id FROM recent_activity))`)
	_, _ = tx.Exec(`DELETE FROM items WHERE transient=1 AND id NOT IN (SELECT item_id FROM recent_activity)`)
	change, err := recordChangeTx(tx, "recent-changed", []string{itemID})
	if err == nil {
		err = tx.Commit()
	} else {
		_ = tx.Rollback()
	}
	if err != nil {
		return nil, err
	}
	s.notifyChange(change)
	return &activityResult{ItemID: itemID, LastUsedAt: now}, nil
}

func (s *libraryService) watchLoop(watcher *fsnotify.Watcher) {
	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			s.mu.Lock()
			owners := s.ownersByDir[pathKey(filepath.Dir(event.Name))]
			for sourceID := range owners {
				if timer := s.rescanTimers[sourceID]; timer != nil {
					timer.Stop()
				}
				id := sourceID
				s.rescanTimers[id] = time.AfterFunc(350*time.Millisecond, func() { _, _ = s.ScanSource(id) })
			}
			s.mu.Unlock()
		case <-watcher.Errors:
		case <-s.stop:
			return
		}
	}
}

func (s *libraryService) pollLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			_, _ = s.RefreshAll()
		case <-s.stop:
			return
		}
	}
}

func (s *libraryService) removeSourceWatchesLocked(sourceID string) {
	for directory := range s.watchedBySource[sourceID] {
		owners := s.ownersByDir[directory]
		delete(owners, sourceID)
		if len(owners) == 0 {
			if s.watcher != nil {
				_ = s.watcher.Remove(directory)
			}
			delete(s.ownersByDir, directory)
		}
	}
	delete(s.watchedBySource, sourceID)
	if timer := s.rescanTimers[sourceID]; timer != nil {
		timer.Stop()
		delete(s.rescanTimers, sourceID)
	}
}

func (s *libraryService) updateSourceWatchesLocked(sourceID string, directories []string) {
	s.removeSourceWatchesLocked(sourceID)
	if s.watcher == nil {
		return
	}
	s.watchedBySource[sourceID] = make(map[string]struct{})
	for _, directory := range directories {
		key := pathKey(directory)
		if s.ownersByDir[key] == nil {
			if err := s.watcher.Add(directory); err != nil {
				continue
			}
			s.ownersByDir[key] = make(map[string]struct{})
		}
		s.ownersByDir[key][sourceID] = struct{}{}
		s.watchedBySource[sourceID][key] = struct{}{}
	}
}
