package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	_ "golang.org/x/image/bmp"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
)

func thumbnailSize(value int) int {
	if value <= 0 {
		return 512
	}
	if value < 64 {
		return 64
	}
	if value > 1024 {
		return 1024
	}
	return value
}

func (s *libraryService) Thumbnail(request thumbnailRequest) (thumbnailResult, error) {
	size := thumbnailSize(request.Size)
	s.mu.Lock()
	if err := s.ensureReadyLocked(); err != nil {
		s.mu.Unlock()
		return thumbnailResult{}, err
	}
	row := s.db.QueryRow(`SELECT `+itemSelectColumns+` FROM items i LEFT JOIN sources s ON s.id=i.source_id
		LEFT JOIN recent_activity r ON r.item_id=i.id WHERE i.id=?`, request.ItemID)
	item, _, err := scanItem(row)
	cacheRoot := s.thumbnailPath
	s.mu.Unlock()
	if err != nil {
		return thumbnailResult{}, err
	}
	if item.Availability != "available" {
		return thumbnailResult{OK: false, Code: "unavailable", Message: "Media file is unavailable"}, nil
	}

	sum := sha256.Sum256([]byte(item.ID + "\x00" + item.ContentIdentity + "\x00" + fmt.Sprint(size)))
	extension := ".jpg"
	if item.MimeType == "image/svg+xml" {
		extension = ".svg"
	}
	output := filepath.Join(cacheRoot, hex.EncodeToString(sum[:])+extension)
	if info, err := os.Stat(output); err == nil && info.Mode().IsRegular() {
		if !s.rememberThumbnail(item, size, output) {
			_ = os.Remove(output)
			return thumbnailResult{OK: false, Code: "unavailable", Message: "Media file is unavailable"}, nil
		}
		return thumbnailResult{OK: true, Output: output, Mtime: info.ModTime().UnixMilli()}, nil
	}

	switch item.Kind {
	case "image":
		if item.MimeType == "image/svg+xml" {
			if err := copyFile(item.LocalPath, output); err != nil {
				return thumbnailResult{}, err
			}
		} else if err := renderImageThumbnail(item.LocalPath, output, size); err != nil {
			return thumbnailResult{OK: false, Code: "decode_failed", Message: err.Error()}, nil
		}
	case "video":
		if err := renderVideoThumbnail(item.LocalPath, output, size); err != nil {
			return thumbnailResult{OK: false, Code: "poster_failed", Message: err.Error()}, nil
		}
	default:
		return thumbnailResult{OK: false, Code: "not_supported", Message: "This media type does not have a thumbnail"}, nil
	}
	info, err := os.Stat(output)
	if err != nil {
		return thumbnailResult{}, err
	}
	if !s.rememberThumbnail(item, size, output) {
		_ = os.Remove(output)
		return thumbnailResult{OK: false, Code: "unavailable", Message: "Media file is unavailable"}, nil
	}
	return thumbnailResult{OK: true, Output: output, Mtime: info.ModTime().UnixMilli()}, nil
}

func (s *libraryService) rememberThumbnail(item itemView, size int, output string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil || s.closed {
		return false
	}
	var availability string
	if err := s.db.QueryRow(`SELECT availability FROM items WHERE id=?`, item.ID).Scan(&availability); err != nil || availability != "available" {
		return false
	}
	_, err := s.db.Exec(`INSERT INTO thumbnails(item_id,size_class,cache_path,generation_version,source_fingerprint,created_at)
		VALUES(?,?,?,1,?,?) ON CONFLICT(item_id,size_class) DO UPDATE SET cache_path=excluded.cache_path,
		source_fingerprint=excluded.source_fingerprint,created_at=excluded.created_at`, item.ID, size, output,
		item.ContentIdentity, time.Now().UTC().Format(time.RFC3339Nano))
	return err == nil
}

// deleteThumbnailsTx removes thumbnail records matching a caller-supplied item
// predicate and returns the cache files to unlink after the transaction commits.
// Predicates are internal SQL fragments, never user input.
func deleteThumbnailsTx(tx *sql.Tx, itemPredicate string, args ...any) ([]string, error) {
	rows, err := tx.Query(`SELECT cache_path FROM thumbnails WHERE `+itemPredicate, args...)
	if err != nil {
		return nil, err
	}
	paths := []string{}
	for rows.Next() {
		var cachePath string
		if err := rows.Scan(&cachePath); err != nil {
			_ = rows.Close()
			return nil, err
		}
		paths = append(paths, cachePath)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`DELETE FROM thumbnails WHERE `+itemPredicate, args...); err != nil {
		return nil, err
	}
	return paths, nil
}

func (s *libraryService) removeThumbnailFiles(paths []string) {
	seen := make(map[string]struct{}, len(paths))
	for _, cachePath := range paths {
		key := pathKey(cachePath)
		if _, duplicate := seen[key]; duplicate || !pathInside(s.thumbnailPath, cachePath) {
			continue
		}
		seen[key] = struct{}{}
		var references int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM thumbnails WHERE cache_path=?`, cachePath).Scan(&references); err != nil || references != 0 {
			continue
		}
		if err := os.Remove(cachePath); err != nil && !os.IsNotExist(err) {
			continue
		}
	}
}

func renderImageThumbnail(input, output string, size int) error {
	file, err := os.Open(input)
	if err != nil {
		return err
	}
	decoded, _, err := image.Decode(file)
	_ = file.Close()
	if err != nil {
		return fmt.Errorf("cannot decode image: %w", err)
	}
	bounds := decoded.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width <= 0 || height <= 0 {
		return fmt.Errorf("image has invalid dimensions")
	}
	ratio := float64(size) / float64(width)
	if height > width {
		ratio = float64(size) / float64(height)
	}
	if ratio > 1 {
		ratio = 1
	}
	targetWidth, targetHeight := max(1, int(float64(width)*ratio)), max(1, int(float64(height)*ratio))
	target := image.NewRGBA(image.Rect(0, 0, targetWidth, targetHeight))
	draw.CatmullRom.Scale(target, target.Bounds(), decoded, bounds, draw.Over, nil)
	if err := os.MkdirAll(filepath.Dir(output), 0o755); err != nil {
		return err
	}
	temporary := output + ".tmp-" + newID()
	out, err := os.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	err = jpeg.Encode(out, target, &jpeg.Options{Quality: 88})
	closeErr := out.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(temporary)
		return err
	}
	if err := os.Rename(temporary, output); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func linuxPosterDesktop() string {
	if strings.TrimSpace(os.Getenv("KDE_FULL_SESSION")) != "" {
		return "kde"
	}
	haystack := strings.ToLower(os.Getenv("XDG_CURRENT_DESKTOP") + ":" + os.Getenv("DESKTOP_SESSION"))
	if strings.Contains(haystack, "kde") || strings.Contains(haystack, "plasma") {
		return "kde"
	}
	return "gnome"
}

func renderVideoThumbnail(input, output string, size int) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	binDir := filepath.Dir(executable)
	var command *exec.Cmd
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if runtime.GOOS == "windows" {
		backend := filepath.Join(binDir, "video-poster-win32-x64.exe")
		command = exec.CommandContext(ctx, backend)
	} else if linuxPosterDesktop() == "kde" {
		backend := filepath.Join(binDir, "kde-video-poster.py")
		command = exec.CommandContext(ctx, "python3", backend)
	} else {
		backend := filepath.Join(binDir, "gnome-video-poster.js")
		command = exec.CommandContext(ctx, "gjs", backend)
	}
	stdin, err := command.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return err
	}
	var stderr strings.Builder
	command.Stderr = &stderr
	if err := command.Start(); err != nil {
		return err
	}
	request := map[string]any{"jsonrpc": "2.0", "id": 1, "method": "poster.generate", "params": []any{map[string]any{"path": input, "size": size}}}
	_ = json.NewEncoder(stdin).Encode(request)
	_ = stdin.Close()
	var response struct {
		Result thumbnailResult `json:"result"`
		Error  *rpcError       `json:"error"`
	}
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		if strings.TrimSpace(scanner.Text()) != "" {
			_ = json.Unmarshal(scanner.Bytes(), &response)
		}
	}
	err = command.Wait()
	if ctx.Err() != nil {
		return fmt.Errorf("video thumbnail timed out")
	}
	if response.Error != nil {
		return fmt.Errorf("%s", response.Error.Message)
	}
	if err != nil {
		return fmt.Errorf("video poster failed: %s", strings.TrimSpace(stderr.String()))
	}
	if !response.Result.OK || response.Result.Output == "" {
		return fmt.Errorf("video poster did not produce an image")
	}
	return copyFile(response.Result.Output, output)
}

func copyFile(input, output string) error {
	in, err := os.Open(input)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(output), 0o755); err != nil {
		return err
	}
	temporary := output + ".tmp-" + newID()
	out, err := os.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	closeErr := out.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(temporary)
		return err
	}
	if err := os.Rename(temporary, output); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}
