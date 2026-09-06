package main

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
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
