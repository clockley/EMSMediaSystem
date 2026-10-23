package main

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io/fs"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func writePNG(t *testing.T, filePath string) {
	t.Helper()
	file, err := os.Create(filePath)
	if err != nil {
		t.Fatal(err)
	}
	img := image.NewRGBA(image.Rect(0, 0, 120, 60))
	for y := 0; y < 60; y++ {
		for x := 0; x < 120; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 90, A: 255})
		}
	}
	if err := png.Encode(file, img); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func assertThumbnailRemoved(t *testing.T, service *libraryService, itemID, cachePath string) {
	t.Helper()
	var count int
	if err := service.db.QueryRow(`SELECT COUNT(*) FROM thumbnails WHERE item_id=?`, itemID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("thumbnail rows for %s = %d", itemID, count)
	}
	if _, err := os.Stat(cachePath); !os.IsNotExist(err) {
		t.Fatalf("cached thumbnail still exists at %s (err=%v)", cachePath, err)
	}
}

func TestLibraryOwnsDatabaseScanningSearchRecentAndThumbnails(t *testing.T) {
	root := t.TempDir()
	sourceRoot := filepath.Join(root, "source")
	if err := os.MkdirAll(filepath.Join(sourceRoot, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	imagePath := filepath.Join(sourceRoot, "nested", "Sunday Welcome.png")
	writePNG(t, imagePath)
	if err := os.WriteFile(filepath.Join(sourceRoot, "notes.pdf"), []byte("not supported"), 0o644); err != nil {
		t.Fatal(err)
	}

	service := newLibraryService(nil)
	t.Cleanup(service.Close)
	snapshot, err := service.Ready(readyOptions{
		DatabasePath:       filepath.Join(root, "state", "library.sqlite"),
		ThumbnailCachePath: filepath.Join(root, "state", "thumbs"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Sources) != 1 || snapshot.Sources[0].ID != addedFilesSourceID {
		t.Fatalf("unexpected initial sources: %#v", snapshot.Sources)
	}
	var journalMode string
	if err := service.db.QueryRow(`PRAGMA journal_mode`).Scan(&journalMode); err != nil || journalMode != "wal" {
		t.Fatalf("journal mode=%q err=%v", journalMode, err)
	}

	source, err := service.AddSource(sourceRoot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ScanSource(source.ID); err != nil {
		t.Fatal(err)
	}
	result, err := service.Query(queryOptions{Query: "welcome", SourceID: source.ID, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 1 || result.Items[0].Kind != "image" {
		t.Fatalf("unexpected query: %#v", result)
	}
	item := result.Items[0]
	all, err := service.Query(queryOptions{SourceID: source.ID, Limit: 10})
	if err != nil || all.Total != 1 {
		t.Fatalf("PDF should be excluded: %#v err=%v", all, err)
	}

	thumb, err := service.Thumbnail(thumbnailRequest{ItemID: item.ID, Size: 96})
	if err != nil || !thumb.OK {
		t.Fatalf("thumbnail=%#v err=%v", thumb, err)
	}
	if info, err := os.Stat(thumb.Output); err != nil || info.Size() == 0 {
		t.Fatalf("cached thumbnail missing: %v", err)
	}
	cached, err := service.Thumbnail(thumbnailRequest{ItemID: item.ID, Size: 96})
	if err != nil || cached.Output != thumb.Output {
		t.Fatalf("thumbnail cache miss: %#v %v", cached, err)
	}
	future := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(imagePath, future, future); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ScanSource(source.ID); err != nil {
		t.Fatal(err)
	}
	replacement, err := service.Thumbnail(thumbnailRequest{ItemID: item.ID, Size: 96})
	if err != nil || !replacement.OK || replacement.Output == thumb.Output {
		t.Fatalf("replacement thumbnail=%#v old=%#v err=%v", replacement, thumb, err)
	}
	if _, err := os.Stat(thumb.Output); !os.IsNotExist(err) {
		t.Fatalf("superseded thumbnail still exists at %s (err=%v)", thumb.Output, err)
	}
	var thumbnailRows int
	if err := service.db.QueryRow(`SELECT COUNT(*) FROM thumbnails WHERE item_id=? AND size_class=?`, item.ID, 96).Scan(&thumbnailRows); err != nil || thumbnailRows != 1 {
		t.Fatalf("thumbnail rows=%d err=%v", thumbnailRows, err)
	}
	thumb = replacement

	activity, err := service.RecordActivity(activityInput{ItemID: item.ID, ActionKind: "previewed"})
	if err != nil || activity == nil {
		t.Fatalf("activity=%#v err=%v", activity, err)
	}
	recent, err := service.Query(queryOptions{SourceID: recentSourceID, Sort: "recent", Limit: 10})
	if err != nil || recent.Total != 1 || recent.Items[0].ID != item.ID {
		t.Fatalf("recent=%#v err=%v", recent, err)
	}

	oldID := item.ID
	time.Sleep(2 * time.Millisecond)
	if _, err := service.ScanSource(source.ID); err != nil {
		t.Fatal(err)
	}
	stable, _ := service.Query(queryOptions{SourceID: source.ID, Limit: 10})
	if stable.Items[0].ID != oldID {
		t.Fatalf("stable id changed: %s -> %s", oldID, stable.Items[0].ID)
	}

	if err := os.Remove(imagePath); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ScanSource(source.ID); err != nil {
		t.Fatal(err)
	}
	missing, err := service.GetItem(item.ID)
	if err != nil || missing == nil || missing.Availability != "missing" {
		t.Fatalf("missing item=%#v err=%v", missing, err)
	}
	assertThumbnailRemoved(t, service, item.ID, thumb.Output)
}

func TestSourceScanDoesNotBlockLibraryQueriesDuringFilesystemWalk(t *testing.T) {
	root := t.TempDir()
	sourceRoot := filepath.Join(root, "source")
	if err := os.MkdirAll(sourceRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	writePNG(t, filepath.Join(sourceRoot, "still-visible.png"))

	service := newLibraryService(nil)
	t.Cleanup(service.Close)
	if _, err := service.Ready(readyOptions{
		DatabasePath:       filepath.Join(root, "state", "library.sqlite"),
		ThumbnailCachePath: filepath.Join(root, "state", "thumbs"),
	}); err != nil {
		t.Fatal(err)
	}
	source, err := service.AddSource(sourceRoot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ScanSource(source.ID); err != nil {
		t.Fatal(err)
	}

	originalWalk := service.walkDir
	walkStarted := make(chan struct{})
	releaseWalk := make(chan struct{})
	service.walkDir = func(root string, visit fs.WalkDirFunc) error {
		close(walkStarted)
		<-releaseWalk
		return originalWalk(root, visit)
	}
	scanDone := make(chan error, 1)
	go func() {
		_, scanErr := service.ScanSource(source.ID)
		scanDone <- scanErr
	}()
	<-walkStarted

	queryDone := make(chan error, 1)
	go func() {
		result, queryErr := service.Query(queryOptions{SourceID: source.ID, Limit: 10})
		if queryErr == nil && result.Total != 1 {
			queryErr = fmt.Errorf("query total while scanning = %d", result.Total)
		}
		queryDone <- queryErr
	}()

	select {
	case queryErr := <-queryDone:
		if queryErr != nil {
			close(releaseWalk)
			<-scanDone
			t.Fatal(queryErr)
		}
	case <-time.After(time.Second):
		close(releaseWalk)
		<-scanDone
		t.Fatal("media library query was blocked by the filesystem scan")
	}
	close(releaseWalk)
	if scanErr := <-scanDone; scanErr != nil {
		t.Fatal(scanErr)
	}
}

func TestFolderQueriesEscapeSQLLikeWildcards(t *testing.T) {
	root := t.TempDir()
	sourceRoot := filepath.Join(root, "source")
	for _, folder := range []string{"Week_1", "WeekA1", "Set%2", "SetZZ2"} {
		if err := os.MkdirAll(filepath.Join(sourceRoot, folder), 0o755); err != nil {
			t.Fatal(err)
		}
		writePNG(t, filepath.Join(sourceRoot, folder, folder+".png"))
	}

	service := newLibraryService(nil)
	t.Cleanup(service.Close)
	if _, err := service.Ready(readyOptions{
		DatabasePath:       filepath.Join(root, "state", "library.sqlite"),
		ThumbnailCachePath: filepath.Join(root, "state", "thumbs"),
	}); err != nil {
		t.Fatal(err)
	}
	source, err := service.AddSource(sourceRoot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ScanSource(source.ID); err != nil {
		t.Fatal(err)
	}

	for _, folder := range []string{"Week_1", "Set%2"} {
		result, err := service.Query(queryOptions{
			SourceID: source.ID,
			ParentID: folder,
			Limit:    10,
		})
		if err != nil {
			t.Fatal(err)
		}
		if result.Total != 1 || len(result.Items) != 1 || result.Items[0].ParentID != folder {
			t.Fatalf("folder %q matched unrelated items: %#v", folder, result.Items)
		}
	}
}

func TestIncompleteScanPreservesExistingMediaAndThumbnails(t *testing.T) {
	root := t.TempDir()
	sourceRoot := filepath.Join(root, "source")
	if err := os.MkdirAll(sourceRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	imagePath := filepath.Join(sourceRoot, "preserved.png")
	writePNG(t, imagePath)

	service := newLibraryService(nil)
	var denyImage atomic.Bool
	service.walkDir = func(root string, visit fs.WalkDirFunc) error {
		return filepath.WalkDir(root, func(localPath string, entry fs.DirEntry, walkErr error) error {
			if denyImage.Load() && localPath == imagePath {
				return visit(localPath, entry, fs.ErrPermission)
			}
			return visit(localPath, entry, walkErr)
		})
	}
	t.Cleanup(service.Close)
	if _, err := service.Ready(readyOptions{
		DatabasePath:       filepath.Join(root, "state", "library.sqlite"),
		ThumbnailCachePath: filepath.Join(root, "state", "thumbs"),
	}); err != nil {
		t.Fatal(err)
	}
	source, err := service.AddSource(sourceRoot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ScanSource(source.ID); err != nil {
		t.Fatal(err)
	}
	result, err := service.Query(queryOptions{SourceID: source.ID, Limit: 10})
	if err != nil || result.Total != 1 {
		t.Fatalf("query=%#v err=%v", result, err)
	}
	item := result.Items[0]
	thumb, err := service.Thumbnail(thumbnailRequest{ItemID: item.ID, Size: 96})
	if err != nil || !thumb.OK {
		t.Fatalf("thumbnail=%#v err=%v", thumb, err)
	}

	denyImage.Store(true)
	partial, err := service.ScanSource(source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if partial.Status != "error" || partial.Error == "" {
		t.Fatalf("partial source=%#v", partial)
	}
	preserved, err := service.GetItem(item.ID)
	if err != nil || preserved == nil || preserved.Availability != "available" {
		t.Fatalf("preserved item=%#v err=%v", preserved, err)
	}
	if _, err := os.Stat(thumb.Output); err != nil {
		t.Fatalf("thumbnail was removed after incomplete scan: %v", err)
	}
	var thumbnailRows int
	if err := service.db.QueryRow(`SELECT COUNT(*) FROM thumbnails WHERE item_id=?`, item.ID).Scan(&thumbnailRows); err != nil || thumbnailRows != 1 {
		t.Fatalf("thumbnail rows=%d err=%v", thumbnailRows, err)
	}

	denyImage.Store(false)
	recovered, err := service.ScanSource(source.ID)
	if err != nil || recovered.Status != "ready" || recovered.Error != "" {
		t.Fatalf("recovered source=%#v err=%v", recovered, err)
	}
}

func TestExplicitRemovalDeletesThumbnailRowsAndFiles(t *testing.T) {
	root := t.TempDir()
	service := newLibraryService(nil)
	t.Cleanup(service.Close)
	if _, err := service.Ready(readyOptions{
		DatabasePath:       filepath.Join(root, "state", "library.sqlite"),
		ThumbnailCachePath: filepath.Join(root, "state", "thumbs"),
	}); err != nil {
		t.Fatal(err)
	}

	t.Run("RemoveSource", func(t *testing.T) {
		sourceRoot := filepath.Join(root, "source-to-remove")
		if err := os.MkdirAll(sourceRoot, 0o755); err != nil {
			t.Fatal(err)
		}
		writePNG(t, filepath.Join(sourceRoot, "source-image.png"))
		source, err := service.AddSource(sourceRoot)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := service.ScanSource(source.ID); err != nil {
			t.Fatal(err)
		}
		result, err := service.Query(queryOptions{SourceID: source.ID, Limit: 10})
		if err != nil || result.Total != 1 {
			t.Fatalf("query=%#v err=%v", result, err)
		}
		item := result.Items[0]
		thumb, err := service.Thumbnail(thumbnailRequest{ItemID: item.ID, Size: 96})
		if err != nil || !thumb.OK {
			t.Fatalf("thumbnail=%#v err=%v", thumb, err)
		}
		removed, err := service.RemoveSource(source.ID)
		if err != nil || !removed {
			t.Fatalf("removed=%v err=%v", removed, err)
		}
		assertThumbnailRemoved(t, service, item.ID, thumb.Output)
	})

	t.Run("RemoveAddedItems", func(t *testing.T) {
		imagePath := filepath.Join(root, "added-image.png")
		writePNG(t, imagePath)
		items, err := service.AddFiles([]string{imagePath})
		if err != nil || len(items) != 1 {
			t.Fatalf("items=%#v err=%v", items, err)
		}
		item := items[0]
		thumb, err := service.Thumbnail(thumbnailRequest{ItemID: item.ID, Size: 96})
		if err != nil || !thumb.OK {
			t.Fatalf("thumbnail=%#v err=%v", thumb, err)
		}
		removed, err := service.RemoveAddedItems([]string{item.ID})
		if err != nil || removed != 1 {
			t.Fatalf("removed=%d err=%v", removed, err)
		}
		assertThumbnailRemoved(t, service, item.ID, thumb.Output)
	})
}

func TestLibraryWatcherFindsFilesAddedWhileRunning(t *testing.T) {
	root := t.TempDir()
	sourceRoot := filepath.Join(root, "watched")
	if err := os.MkdirAll(sourceRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	service := newLibraryService(nil)
	t.Cleanup(service.Close)
	if _, err := service.Ready(readyOptions{
		DatabasePath:       filepath.Join(root, "state", "library.sqlite"),
		ThumbnailCachePath: filepath.Join(root, "state", "thumbs"),
	}); err != nil {
		t.Fatal(err)
	}
	source, err := service.AddSource(sourceRoot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ScanSource(source.ID); err != nil {
		t.Fatal(err)
	}

	newFolder := filepath.Join(sourceRoot, "new-folder")
	if err := os.Mkdir(newFolder, 0o755); err != nil {
		t.Fatal(err)
	}
	writePNG(t, filepath.Join(newFolder, "added-while-running.png"))
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		result, queryErr := service.Query(queryOptions{SourceID: source.ID, Query: "added-while-running", Limit: 10})
		if queryErr == nil && result.Total == 1 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("watched file did not appear without a manual rescan")
}

func TestDroppedPathsAreClassifiedWithoutFolderProbeErrors(t *testing.T) {
	root := t.TempDir()
	folder := filepath.Join(root, "folder-source")
	if err := os.Mkdir(folder, 0o755); err != nil {
		t.Fatal(err)
	}
	looseImage := filepath.Join(root, "loose.png")
	writePNG(t, looseImage)
	unsupported := filepath.Join(root, "notes.txt")
	if err := os.WriteFile(unsupported, []byte("ignore me"), 0o644); err != nil {
		t.Fatal(err)
	}

	service := newLibraryService(nil)
	t.Cleanup(service.Close)
	if _, err := service.Ready(readyOptions{
		DatabasePath:       filepath.Join(root, "state", "library.sqlite"),
		ThumbnailCachePath: filepath.Join(root, "state", "thumbs"),
	}); err != nil {
		t.Fatal(err)
	}
	result, err := service.AddDroppedPaths([]string{folder, looseImage, unsupported})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Sources) != 1 {
		t.Fatalf("sources=%d", len(result.Sources))
	}
	if len(result.Items) != 1 || result.Items[0].FileName != "loose.png" {
		t.Fatalf("items=%#v", result.Items)
	}
}

func TestAddFilesReturnsErrorWhenNothingCanBeAdded(t *testing.T) {
	root := t.TempDir()
	service := newLibraryService(nil)
	t.Cleanup(service.Close)
	if _, err := service.Ready(readyOptions{
		DatabasePath:       filepath.Join(root, "state", "library.sqlite"),
		ThumbnailCachePath: filepath.Join(root, "state", "thumbs"),
	}); err != nil {
		t.Fatal(err)
	}

	items, err := service.AddFiles([]string{"", filepath.Join(root, "missing.png")})
	if err == nil {
		t.Fatalf("items=%#v, want an error when every path fails", items)
	}
	var count int
	if queryErr := service.db.QueryRow(`SELECT COUNT(*) FROM items WHERE source_id=?`, addedFilesSourceID).Scan(&count); queryErr != nil {
		t.Fatal(queryErr)
	}
	if count != 0 {
		t.Fatalf("added-files rows = %d, want 0", count)
	}
}

func TestRecordActivityUsesRequestedSourceForDuplicatePath(t *testing.T) {
	root := t.TempDir()
	sourceRoot := filepath.Join(root, "source")
	if err := os.MkdirAll(sourceRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	imagePath := filepath.Join(sourceRoot, "shared.png")
	writePNG(t, imagePath)

	service := newLibraryService(nil)
	t.Cleanup(service.Close)
	if _, err := service.Ready(readyOptions{
		DatabasePath:       filepath.Join(root, "state", "library.sqlite"),
		ThumbnailCachePath: filepath.Join(root, "state", "thumbs"),
	}); err != nil {
		t.Fatal(err)
	}
	source, err := service.AddSource(sourceRoot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ScanSource(source.ID); err != nil {
		t.Fatal(err)
	}
	folderItems, err := service.Query(queryOptions{SourceID: source.ID, Limit: 10})
	if err != nil || len(folderItems.Items) != 1 {
		t.Fatalf("folder items=%#v err=%v", folderItems, err)
	}
	addedItems, err := service.AddFiles([]string{imagePath})
	if err != nil || len(addedItems) != 1 {
		t.Fatalf("added items=%#v err=%v", addedItems, err)
	}

	activity, err := service.RecordActivity(activityInput{
		SourceID:   source.ID,
		LocalPath:  imagePath,
		ActionKind: "previewed",
	})
	if err != nil || activity == nil || activity.ItemID != folderItems.Items[0].ID {
		t.Fatalf("source-specific activity=%#v err=%v", activity, err)
	}

	activity, err = service.RecordActivity(activityInput{LocalPath: imagePath, ActionKind: "previewed"})
	if err != nil || activity == nil || activity.ItemID != addedItems[0].ID {
		t.Fatalf("default duplicate-path activity=%#v err=%v", activity, err)
	}
}

func TestWatcherErrorSchedulesImmediateSourceRescan(t *testing.T) {
	root := t.TempDir()
	sourceRoot := filepath.Join(root, "source")
	if err := os.MkdirAll(sourceRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	service := newLibraryService(nil)
	t.Cleanup(service.Close)
	if _, err := service.Ready(readyOptions{
		DatabasePath:       filepath.Join(root, "state", "library.sqlite"),
		ThumbnailCachePath: filepath.Join(root, "state", "thumbs"),
	}); err != nil {
		t.Fatal(err)
	}
	source, err := service.AddSource(sourceRoot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ScanSource(source.ID); err != nil {
		t.Fatal(err)
	}
	if err := service.watcher.Close(); err != nil {
		t.Fatal(err)
	}

	imagePath := filepath.Join(sourceRoot, "recovered.png")
	writePNG(t, imagePath)
	service.recoverFromWatcherError()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		result, queryErr := service.Query(queryOptions{SourceID: source.ID, Query: "recovered", Limit: 10})
		if queryErr == nil && result.Total == 1 {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("watcher error recovery did not rescan the source")
}

func TestPromotingRecentItemRemovesThumbnailRowsAndFiles(t *testing.T) {
	root := t.TempDir()
	imagePath := filepath.Join(root, "promoted.png")
	writePNG(t, imagePath)
	service := newLibraryService(nil)
	t.Cleanup(service.Close)
	if _, err := service.Ready(readyOptions{
		DatabasePath:       filepath.Join(root, "state", "library.sqlite"),
		ThumbnailCachePath: filepath.Join(root, "state", "thumbs"),
	}); err != nil {
		t.Fatal(err)
	}
	activity, err := service.RecordActivity(activityInput{LocalPath: imagePath, ActionKind: "previewed"})
	if err != nil || activity == nil {
		t.Fatalf("activity=%#v err=%v", activity, err)
	}
	thumb, err := service.Thumbnail(thumbnailRequest{ItemID: activity.ItemID, Size: 96})
	if err != nil || !thumb.OK {
		t.Fatalf("thumbnail=%#v err=%v", thumb, err)
	}
	items, err := service.AddFiles([]string{imagePath})
	if err != nil || len(items) != 1 {
		t.Fatalf("items=%#v err=%v", items, err)
	}
	assertThumbnailRemoved(t, service, activity.ItemID, thumb.Output)
}

func TestRecentEvictionRemovesThumbnailRowsAndFiles(t *testing.T) {
	root := t.TempDir()
	victimPath := filepath.Join(root, "victim.png")
	triggerPath := filepath.Join(root, "trigger.png")
	writePNG(t, victimPath)
	writePNG(t, triggerPath)
	service := newLibraryService(nil)
	t.Cleanup(service.Close)
	if _, err := service.Ready(readyOptions{
		DatabasePath:       filepath.Join(root, "state", "library.sqlite"),
		ThumbnailCachePath: filepath.Join(root, "state", "thumbs"),
	}); err != nil {
		t.Fatal(err)
	}
	victim, err := service.RecordActivity(activityInput{LocalPath: victimPath, ActionKind: "previewed"})
	if err != nil || victim == nil {
		t.Fatalf("victim=%#v err=%v", victim, err)
	}
	thumb, err := service.Thumbnail(thumbnailRequest{ItemID: victim.ItemID, Size: 96})
	if err != nil || !thumb.OK {
		t.Fatalf("thumbnail=%#v err=%v", thumb, err)
	}
	if _, err := service.db.Exec(`UPDATE recent_activity SET last_used_at='0000-01-01T00:00:00Z' WHERE item_id=?`, victim.ItemID); err != nil {
		t.Fatal(err)
	}
	baseTime := time.Now().Add(time.Minute)
	for index := 0; index < maxRecentItems-1; index++ {
		id := newID()
		localPath := filepath.Join(root, "synthetic", id+".png")
		_, err = service.db.Exec(`INSERT INTO items(id,source_id,provider_item_id,parent_id,kind,display_name,file_name,mime_type,size_bytes,modified_at,content_identity,availability,local_path,path_key,transient)
			VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`, id, recentSourceID, localPath, "", "image", id, id+".png", "image/png", 1,
			baseTime.Format(time.RFC3339Nano), "synthetic", "available", localPath, pathKey(localPath))
		if err != nil {
			t.Fatal(err)
		}
		_, err = service.db.Exec(`INSERT INTO recent_activity(item_id,action_kind,project_id,last_used_at,retention_state) VALUES(?,?,?,?,?)`,
			id, "previewed", "", baseTime.Add(time.Duration(index)*time.Second).Format(time.RFC3339Nano), "transient")
		if err != nil {
			t.Fatal(err)
		}
	}
	time.Sleep(2 * time.Millisecond)
	trigger, err := service.RecordActivity(activityInput{LocalPath: triggerPath, ActionKind: "previewed"})
	if err != nil {
		t.Fatal(err)
	}
	var recentCount int
	var victimActivityCount int
	if err := service.db.QueryRow(`SELECT COUNT(*) FROM recent_activity`).Scan(&recentCount); err != nil {
		t.Fatal(err)
	}
	if err := service.db.QueryRow(`SELECT COUNT(*) FROM recent_activity WHERE item_id=?`, victim.ItemID).Scan(&victimActivityCount); err != nil {
		t.Fatal(err)
	}
	if recentCount != maxRecentItems || victimActivityCount != 0 {
		var triggerActivityCount int
		_ = service.db.QueryRow(`SELECT COUNT(*) FROM recent_activity WHERE item_id=?`, trigger.ItemID).Scan(&triggerActivityCount)
		t.Fatalf("recent count=%d victim activity count=%d trigger activity count=%d", recentCount, victimActivityCount, triggerActivityCount)
	}
	assertThumbnailRemoved(t, service, victim.ItemID, thumb.Output)
}
