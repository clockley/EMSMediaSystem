/*
Copyright (C) 2026 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/zeebo/xxh3"
)

const (
	mediaFileHashAlg               = "xxh3-64"
	defaultDebounceMs              = 300
	defaultStabilityIntervalMs     = 500
	defaultStabilitySamples        = 3
	defaultMaxStabilityPolls       = 20
	defaultStatRetryCount          = 3
	defaultStatRetryInitialDelayMs = 100
	defaultHashRetryCount          = 3
	defaultHashRetryInitialDelayMs = 150
)

type rpcRequest struct {
	JSONRPC string           `json:"jsonrpc"`
	ID      *json.RawMessage `json:"id,omitempty"`
	Method  string           `json:"method"`
	Params  json.RawMessage  `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string           `json:"jsonrpc"`
	ID      *json.RawMessage `json:"id,omitempty"`
	Result  any              `json:"result,omitempty"`
	Error   *rpcError        `json:"error,omitempty"`
}

type rpcNotification struct {
	JSONRPC string `json:"jsonrpc"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type watchItem struct {
	QueueItemID  string `json:"queueItemId,omitempty"`
	OriginalPath string `json:"originalPath"`
}

type watchOptionsPatch struct {
	DebounceMs              *int `json:"debounceMs,omitempty"`
	StabilityIntervalMs     *int `json:"stabilityIntervalMs,omitempty"`
	StabilitySamples        *int `json:"stabilitySamples,omitempty"`
	MaxStabilityPolls       *int `json:"maxStabilityPolls,omitempty"`
	StatRetryCount          *int `json:"statRetryCount,omitempty"`
	StatRetryInitialDelayMs *int `json:"statRetryInitialDelayMs,omitempty"`
	HashRetryCount          *int `json:"hashRetryCount,omitempty"`
	HashRetryInitialDelayMs *int `json:"hashRetryInitialDelayMs,omitempty"`
	PollIntervalMs          *int `json:"pollIntervalMs,omitempty"`
}

type watchOptions struct {
	DebounceMs              int
	StabilityIntervalMs     int
	StabilitySamples        int
	MaxStabilityPolls       int
	StatRetryCount          int
	StatRetryInitialDelayMs int
	HashRetryCount          int
	HashRetryInitialDelayMs int
	PollIntervalMs          int
}

type setWatchesParams struct {
	Items   []watchItem       `json:"items"`
	Options watchOptionsPatch `json:"options,omitempty"`
}

type watchTarget struct {
	OriginalPath string
	Dir          string
	DirKey       string
	EventKey     string
	QueueItemIDs []string
}

type watchDirError struct {
	Dir   string `json:"dir"`
	Error string `json:"error"`
}

type watchSummary struct {
	WatchedItems       int             `json:"watchedItems"`
	WatchedFiles       int             `json:"watchedFiles"`
	WatchedDirectories int             `json:"watchedDirectories"`
	PollIntervalMs     int             `json:"pollIntervalMs,omitempty"`
	FailedDirectories  []watchDirError `json:"failedDirectories,omitempty"`
}

type fileSignature struct {
	SizeBytes    int64
	MtimeMs      int64
	ModifiedTime string
	FileHash     string
	FileHashAlg  string
}

type watchChanged struct {
	OriginalPath  string   `json:"originalPath"`
	QueueItemIDs  []string `json:"queueItemIds,omitempty"`
	Status        string   `json:"status"`
	SizeBytes     *int64   `json:"sizeBytes,omitempty"`
	MtimeMs       *int64   `json:"mtimeMs,omitempty"`
	ModifiedTime  string   `json:"modifiedTime,omitempty"`
	FileHash      string   `json:"fileHash,omitempty"`
	FileHashAlg   string   `json:"fileHashAlg,omitempty"`
	ErrorReason   string   `json:"errorReason,omitempty"`
	EventPath     string   `json:"eventPath,omitempty"`
	Op            string   `json:"op,omitempty"`
	DetectedBy    string   `json:"detectedBy,omitempty"`
	StableSamples int      `json:"stableSamples,omitempty"`
}

type watchError struct {
	Dir   string `json:"dir,omitempty"`
	Error string `json:"error"`
}

type watchServer struct {
	watcher        *fsnotify.Watcher
	out            *json.Encoder
	outMu          sync.Mutex
	mu             sync.RWMutex
	options        watchOptions
	generation     uint64
	dirs           map[string]string
	targetsByDir   map[string][]watchTarget
	targetsByKey   map[string]watchTarget
	timers         map[string]*time.Timer
	checksInFlight map[string]bool
	checksQueued   map[string]bool
	observedByKey  map[string]fileSignature
	pollCancel     chan struct{}
}

func newWatchServer(watcher *fsnotify.Watcher, output io.Writer) *watchServer {
	return &watchServer{
		watcher:        watcher,
		out:            json.NewEncoder(output),
		options:        defaultWatchOptions(),
		dirs:           make(map[string]string),
		targetsByDir:   make(map[string][]watchTarget),
		targetsByKey:   make(map[string]watchTarget),
		timers:         make(map[string]*time.Timer),
		checksInFlight: make(map[string]bool),
		checksQueued:   make(map[string]bool),
		observedByKey:  make(map[string]fileSignature),
	}
}

func defaultWatchOptions() watchOptions {
	return watchOptions{
		DebounceMs:              defaultDebounceMs,
		StabilityIntervalMs:     defaultStabilityIntervalMs,
		StabilitySamples:        defaultStabilitySamples,
		MaxStabilityPolls:       defaultMaxStabilityPolls,
		StatRetryCount:          defaultStatRetryCount,
		StatRetryInitialDelayMs: defaultStatRetryInitialDelayMs,
		HashRetryCount:          defaultHashRetryCount,
		HashRetryInitialDelayMs: defaultHashRetryInitialDelayMs,
		PollIntervalMs:          0,
	}
}

func positiveOrDefault(value *int, fallback int) int {
	if value == nil || *value <= 0 {
		return fallback
	}
	return *value
}

func nonNegativeOrDefault(value *int, fallback int) int {
	if value == nil || *value < 0 {
		return fallback
	}
	return *value
}

func normalizeWatchOptions(patch watchOptionsPatch) watchOptions {
	defaults := defaultWatchOptions()
	return watchOptions{
		DebounceMs:              positiveOrDefault(patch.DebounceMs, defaults.DebounceMs),
		StabilityIntervalMs:     positiveOrDefault(patch.StabilityIntervalMs, defaults.StabilityIntervalMs),
		StabilitySamples:        positiveOrDefault(patch.StabilitySamples, defaults.StabilitySamples),
		MaxStabilityPolls:       positiveOrDefault(patch.MaxStabilityPolls, defaults.MaxStabilityPolls),
		StatRetryCount:          nonNegativeOrDefault(patch.StatRetryCount, defaults.StatRetryCount),
		StatRetryInitialDelayMs: positiveOrDefault(patch.StatRetryInitialDelayMs, defaults.StatRetryInitialDelayMs),
		HashRetryCount:          nonNegativeOrDefault(patch.HashRetryCount, defaults.HashRetryCount),
		HashRetryInitialDelayMs: positiveOrDefault(patch.HashRetryInitialDelayMs, defaults.HashRetryInitialDelayMs),
		PollIntervalMs:          nonNegativeOrDefault(patch.PollIntervalMs, defaults.PollIntervalMs),
	}
}

func comparablePathKey(filePath string) string {
	cleaned := filepath.Clean(filePath)
	if runtime.GOOS == "windows" {
		return strings.ToLower(cleaned)
	}
	return cleaned
}

func normalizePath(filePath string) (string, error) {
	if strings.TrimSpace(filePath) == "" {
		return "", errors.New("empty path")
	}
	absolute, err := filepath.Abs(filePath)
	if err != nil {
		return "", err
	}
	return filepath.Clean(absolute), nil
}

func uniqueStrings(values []string) []string {
	if len(values) < 2 {
		return values
	}
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func targetsFromItems(items []watchItem) (map[string]watchTarget, map[string]string) {
	targets := make(map[string]watchTarget)
	dirs := make(map[string]string)
	for _, item := range items {
		originalPath, err := normalizePath(item.OriginalPath)
		if err != nil {
			continue
		}
		dir := filepath.Dir(originalPath)
		dirKey := comparablePathKey(dir)
		eventKey := comparablePathKey(originalPath)
		target := targets[eventKey]
		if target.OriginalPath == "" {
			target = watchTarget{
				OriginalPath: originalPath,
				Dir:          dir,
				DirKey:       dirKey,
				EventKey:     eventKey,
				QueueItemIDs: nil,
			}
		}
		if item.QueueItemID != "" {
			target.QueueItemIDs = append(target.QueueItemIDs, item.QueueItemID)
		}
		target.QueueItemIDs = uniqueStrings(target.QueueItemIDs)
		targets[eventKey] = target
		dirs[dirKey] = dir
	}
	return targets, dirs
}

func groupTargetsByDir(targets map[string]watchTarget) map[string][]watchTarget {
	grouped := make(map[string][]watchTarget)
	for _, target := range targets {
		grouped[target.DirKey] = append(grouped[target.DirKey], target)
	}
	for dirKey := range grouped {
		sort.Slice(grouped[dirKey], func(i, j int) bool {
			return grouped[dirKey][i].OriginalPath < grouped[dirKey][j].OriginalPath
		})
	}
	return grouped
}

func (server *watchServer) cancelPendingChecksLocked() {
	for eventKey, timer := range server.timers {
		timer.Stop()
		delete(server.timers, eventKey)
	}
	server.checksQueued = make(map[string]bool)
}

func (server *watchServer) stopPollingLocked() {
	if server.pollCancel == nil {
		return
	}
	close(server.pollCancel)
	server.pollCancel = nil
}

func (server *watchServer) restartPollingLocked(generation uint64) {
	server.stopPollingLocked()
	if server.options.PollIntervalMs <= 0 || len(server.targetsByKey) == 0 {
		return
	}
	cancel := make(chan struct{})
	server.pollCancel = cancel
	interval := time.Duration(server.options.PollIntervalMs) * time.Millisecond
	go server.runPolling(generation, interval, cancel)
}

func (server *watchServer) setWatches(items []watchItem, options watchOptions) watchSummary {
	targets, nextDirs := targetsFromItems(items)
	nextTargetsByDir := groupTargetsByDir(targets)
	failed := make([]watchDirError, 0)

	server.mu.Lock()
	defer server.mu.Unlock()
	server.generation++
	generation := server.generation
	server.options = options
	server.cancelPendingChecksLocked()

	for dirKey, dir := range server.dirs {
		if _, keep := nextDirs[dirKey]; keep {
			continue
		}
		if err := server.watcher.Remove(dir); err != nil {
			log.Printf("failed to remove watch %s: %v", dir, err)
		}
		delete(server.dirs, dirKey)
	}

	for dirKey, dir := range nextDirs {
		if _, exists := server.dirs[dirKey]; exists {
			continue
		}
		if err := server.watcher.Add(dir); err != nil {
			failed = append(failed, watchDirError{Dir: dir, Error: err.Error()})
			server.notify("watch.error", watchError{Dir: dir, Error: err.Error()})
			continue
		}
		server.dirs[dirKey] = dir
	}

	server.targetsByKey = targets
	server.targetsByDir = nextTargetsByDir
	for eventKey := range server.observedByKey {
		if _, keep := targets[eventKey]; !keep {
			delete(server.observedByKey, eventKey)
		}
	}
	server.restartPollingLocked(generation)
	return watchSummary{
		WatchedItems:       len(items),
		WatchedFiles:       len(targets),
		WatchedDirectories: len(server.dirs),
		PollIntervalMs:     server.options.PollIntervalMs,
		FailedDirectories:  failed,
	}
}

func (server *watchServer) clearWatches() watchSummary {
	return server.setWatches(nil, server.options)
}

func (server *watchServer) runEvents() {
	for {
		select {
		case event, ok := <-server.watcher.Events:
			if !ok {
				return
			}
			server.handleFsEvent(event)
		case err, ok := <-server.watcher.Errors:
			if !ok {
				return
			}
			server.notify("watch.error", watchError{Error: err.Error()})
		}
	}
}

func eventIsOnlyChmod(event fsnotify.Event) bool {
	return event.Op == fsnotify.Chmod
}

func eventMayAffectAnyTargetInDir(event fsnotify.Event) bool {
	return event.Op&(fsnotify.Create|fsnotify.Rename|fsnotify.Remove) != 0
}

// eventRelatesToTarget reports whether a directory-level create/rename/remove
// likely belongs to one watched file (Office lock/temp files), not every file in
// the same folder.
func eventRelatesToTarget(eventPath, targetPath string) bool {
	if comparablePathKey(eventPath) == comparablePathKey(targetPath) {
		return true
	}
	eventBase := filepath.Base(eventPath)
	targetBase := filepath.Base(targetPath)
	if eventBase == "" || targetBase == "" {
		return false
	}
	// Microsoft Office lock files: ~$Presentation.pptx
	if strings.HasPrefix(eventBase, "~$") && strings.HasSuffix(eventBase, targetBase) {
		return true
	}
	// Atomic-save backup suffix: Presentation.pptx~
	if strings.TrimSuffix(eventBase, "~") == targetBase {
		return true
	}
	// Same stem in the folder (Presentation.tmp while saving Presentation.pptx).
	targetExt := filepath.Ext(targetBase)
	targetStem := strings.TrimSuffix(targetBase, targetExt)
	if targetStem == "" {
		return false
	}
	eventStem := strings.TrimSuffix(eventBase, filepath.Ext(eventBase))
	return eventStem == targetStem
}

func (server *watchServer) handleFsEvent(event fsnotify.Event) {
	if eventIsOnlyChmod(event) {
		return
	}
	eventPath, err := normalizePath(event.Name)
	if err != nil {
		return
	}
	eventKey := comparablePathKey(eventPath)
	eventDirKey := comparablePathKey(filepath.Dir(eventPath))

	server.mu.RLock()
	targets := append([]watchTarget(nil), server.targetsByDir[eventDirKey]...)
	server.mu.RUnlock()
	if len(targets) == 0 {
		return
	}

	scheduled := make(map[string]struct{})
	for _, target := range targets {
		if target.EventKey != eventKey {
			continue
		}
		scheduled[target.EventKey] = struct{}{}
		server.scheduleTargetCheck(target.EventKey, "fsnotify", eventPath, event.Op.String())
	}
	if len(scheduled) > 0 && !eventMayAffectAnyTargetInDir(event) {
		return
	}
	if eventMayAffectAnyTargetInDir(event) {
		for _, target := range targets {
			if _, ok := scheduled[target.EventKey]; ok {
				continue
			}
			if !eventRelatesToTarget(eventPath, target.OriginalPath) {
				continue
			}
			server.scheduleTargetCheck(target.EventKey, "fsnotify-related", eventPath, event.Op.String())
		}
	}
}

func (server *watchServer) targetSnapshot(eventKey string, generation uint64) (watchTarget, bool) {
	server.mu.RLock()
	defer server.mu.RUnlock()
	if generation != 0 && server.generation != generation {
		return watchTarget{}, false
	}
	target, ok := server.targetsByKey[eventKey]
	if !ok {
		return watchTarget{}, false
	}
	target.QueueItemIDs = append([]string(nil), target.QueueItemIDs...)
	return target, true
}

func (server *watchServer) scheduleTargetCheck(eventKey, detectedBy, eventPath, op string) {
	server.mu.Lock()
	target, ok := server.targetsByKey[eventKey]
	if !ok {
		server.mu.Unlock()
		return
	}
	generation := server.generation
	debounce := time.Duration(server.options.DebounceMs) * time.Millisecond
	if existing := server.timers[eventKey]; existing != nil {
		existing.Stop()
	}
	server.timers[eventKey] = time.AfterFunc(debounce, func() {
		server.runPathCheck(eventKey, generation, detectedBy)
	})
	payload := watchChanged{
		OriginalPath: target.OriginalPath,
		QueueItemIDs: append([]string(nil), target.QueueItemIDs...),
		Status:       "stabilizing",
		EventPath:    eventPath,
		Op:           op,
		DetectedBy:   detectedBy,
	}
	server.mu.Unlock()
	server.notify("watch.changed", payload)
}

func (server *watchServer) beginPathCheck(eventKey string, generation uint64) (watchTarget, watchOptions, bool) {
	server.mu.Lock()
	defer server.mu.Unlock()
	delete(server.timers, eventKey)
	if generation != server.generation {
		return watchTarget{}, watchOptions{}, false
	}
	target, ok := server.targetsByKey[eventKey]
	if !ok {
		return watchTarget{}, watchOptions{}, false
	}
	if server.checksInFlight[eventKey] {
		server.checksQueued[eventKey] = true
		return watchTarget{}, watchOptions{}, false
	}
	server.checksInFlight[eventKey] = true
	target.QueueItemIDs = append([]string(nil), target.QueueItemIDs...)
	return target, server.options, true
}

func (server *watchServer) finishPathCheck(eventKey string, generation uint64) {
	server.mu.Lock()
	delete(server.checksInFlight, eventKey)
	queued := server.checksQueued[eventKey]
	delete(server.checksQueued, eventKey)
	_, stillWatched := server.targetsByKey[eventKey]
	currentGeneration := server.generation == generation
	server.mu.Unlock()
	if queued && currentGeneration && stillWatched {
		server.scheduleTargetCheck(eventKey, "queued", "", "")
	}
}

func (server *watchServer) observedSignature(eventKey string) (fileSignature, bool) {
	server.mu.RLock()
	defer server.mu.RUnlock()
	signature, ok := server.observedByKey[eventKey]
	return signature, ok
}

func (server *watchServer) setObservedSignatureForGeneration(eventKey string, generation uint64, signature fileSignature) bool {
	server.mu.Lock()
	defer server.mu.Unlock()
	if server.generation != generation {
		return false
	}
	if _, ok := server.targetsByKey[eventKey]; !ok {
		return false
	}
	server.observedByKey[eventKey] = signature
	return true
}

func (server *watchServer) commitChangedForGeneration(eventKey string, generation uint64, signature fileSignature, target watchTarget, payload watchChanged) bool {
	server.mu.Lock()
	defer server.mu.Unlock()
	if server.generation != generation {
		return false
	}
	if _, ok := server.targetsByKey[eventKey]; !ok {
		return false
	}
	server.observedByKey[eventKey] = signature
	server.notifyChanged(target, payload)
	return true
}

func (server *watchServer) clearObservedSignature(eventKey string) {
	server.mu.Lock()
	defer server.mu.Unlock()
	delete(server.observedByKey, eventKey)
}

func metadataMatches(a, b fileSignature) bool {
	return a.SizeBytes == b.SizeBytes && a.MtimeMs == b.MtimeMs
}

func signatureMatches(a, b fileSignature) bool {
	return metadataMatches(a, b) && (a.FileHash == "" || b.FileHash == "" || a.FileHash == b.FileHash)
}

func (server *watchServer) runPathCheck(eventKey string, generation uint64, detectedBy string) {
	target, options, ok := server.beginPathCheck(eventKey, generation)
	if !ok {
		return
	}
	defer server.finishPathCheck(eventKey, generation)

	signature, status, reason := server.inspectStableFile(target, generation, options)
	if status != "ready" {
		if status == "cancelled" {
			return
		}
		if status == "missing" {
			server.clearObservedSignature(eventKey)
		}
		server.notifyChanged(target, watchChanged{
			Status:      status,
			ErrorReason: reason,
			DetectedBy:  detectedBy,
		})
		return
	}

	if previous, ok := server.observedSignature(eventKey); ok && signatureMatches(previous, signature) {
		server.setObservedSignatureForGeneration(eventKey, generation, signature)
		return
	}
	server.commitChangedForGeneration(
		eventKey,
		generation,
		signature,
		target,
		changedPayloadFromSignature(signature, detectedBy, options.StabilitySamples),
	)
}

func changedPayloadFromSignature(signature fileSignature, detectedBy string, stableSamples int) watchChanged {
	sizeBytes := signature.SizeBytes
	mtimeMs := signature.MtimeMs
	return watchChanged{
		Status:        "ready",
		SizeBytes:     &sizeBytes,
		MtimeMs:       &mtimeMs,
		ModifiedTime:  signature.ModifiedTime,
		FileHash:      signature.FileHash,
		FileHashAlg:   signature.FileHashAlg,
		DetectedBy:    detectedBy,
		StableSamples: stableSamples,
	}
}

func (server *watchServer) notifyChanged(target watchTarget, payload watchChanged) {
	payload.OriginalPath = target.OriginalPath
	payload.QueueItemIDs = append([]string(nil), target.QueueItemIDs...)
	server.notify("watch.changed", payload)
}

func fileMtimeMs(info os.FileInfo) int64 {
	return info.ModTime().UnixNano() / int64(time.Millisecond)
}

func fileModifiedTime(info os.FileInfo) string {
	return info.ModTime().UTC().Format(time.RFC3339Nano)
}

func statLocalFile(filePath string) (fileSignature, error) {
	handle, err := os.Open(filePath)
	if err != nil {
		return fileSignature{}, err
	}
	defer handle.Close()

	info, err := handle.Stat()
	if err != nil {
		return fileSignature{}, err
	}
	if !info.Mode().IsRegular() {
		return fileSignature{}, fmt.Errorf("not a regular file")
	}
	return fileSignature{
		SizeBytes:    info.Size(),
		MtimeMs:      fileMtimeMs(info),
		ModifiedTime: fileModifiedTime(info),
	}, nil
}

func retryDelay(initial time.Duration, attempt int) time.Duration {
	if attempt <= 0 {
		return initial
	}
	delay := initial << attempt
	maxDelay := 2 * time.Second
	if delay > maxDelay {
		return maxDelay
	}
	return delay
}

func statLocalFileWithRetry(filePath string, options watchOptions) (fileSignature, error) {
	attempts := options.StatRetryCount + 1
	initialDelay := time.Duration(options.StatRetryInitialDelayMs) * time.Millisecond
	var lastErr error
	for attempt := 0; attempt < attempts; attempt++ {
		signature, err := statLocalFile(filePath)
		if err == nil {
			return signature, nil
		}
		if os.IsNotExist(err) {
			return fileSignature{}, err
		}
		lastErr = err
		if attempt < attempts-1 {
			time.Sleep(retryDelay(initialDelay, attempt))
		}
	}
	return fileSignature{}, lastErr
}

func hashLocalFile(filePath string) (string, error) {
	handle, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer handle.Close()

	hasher := xxh3.New()
	if _, err := io.Copy(hasher, handle); err != nil {
		return "", err
	}
	return fmt.Sprintf("%016x", hasher.Sum64()), nil
}

func hashLocalFileWithRetry(filePath string, options watchOptions) (string, error) {
	attempts := options.HashRetryCount + 1
	initialDelay := time.Duration(options.HashRetryInitialDelayMs) * time.Millisecond
	var lastErr error
	for attempt := 0; attempt < attempts; attempt++ {
		digest, err := hashLocalFile(filePath)
		if err == nil {
			return digest, nil
		}
		if os.IsNotExist(err) {
			return "", err
		}
		lastErr = err
		if attempt < attempts-1 {
			time.Sleep(retryDelay(initialDelay, attempt))
		}
	}
	return "", lastErr
}

func (server *watchServer) notifyStabilizing(target watchTarget, reason string) {
	server.notifyChanged(target, watchChanged{
		Status:      "stabilizing",
		ErrorReason: reason,
	})
}

func (server *watchServer) waitForStableFile(target watchTarget, generation uint64, options watchOptions) (fileSignature, string, string) {
	var last fileSignature
	stableCount := 0
	interval := time.Duration(options.StabilityIntervalMs) * time.Millisecond
	for poll := 0; poll < options.MaxStabilityPolls; poll++ {
		if _, ok := server.targetSnapshot(target.EventKey, generation); !ok {
			return fileSignature{}, "cancelled", "watch changed"
		}

		signature, err := statLocalFileWithRetry(target.OriginalPath, options)
		if err != nil {
			if os.IsNotExist(err) {
				return fileSignature{}, "missing", "missing"
			}
			server.notifyStabilizing(target, err.Error())
			time.Sleep(interval)
			continue
		}

		if stableCount > 0 && metadataMatches(last, signature) {
			stableCount++
		} else {
			last = signature
			stableCount = 1
		}
		if stableCount >= options.StabilitySamples {
			return signature, "ready", ""
		}
		time.Sleep(interval)
	}
	return fileSignature{}, "error", "file did not become stable"
}

func (server *watchServer) inspectStableFile(target watchTarget, generation uint64, options watchOptions) (fileSignature, string, string) {
	for pass := 0; pass < 2; pass++ {
		signature, status, reason := server.waitForStableFile(target, generation, options)
		if status != "ready" {
			return fileSignature{}, status, reason
		}
		if previous, ok := server.observedSignature(target.EventKey); ok && metadataMatches(previous, signature) {
			signature.FileHash = previous.FileHash
			signature.FileHashAlg = previous.FileHashAlg
			return signature, "ready", ""
		}

		digest, err := hashLocalFileWithRetry(target.OriginalPath, options)
		if err != nil {
			if os.IsNotExist(err) {
				return fileSignature{}, "missing", "missing"
			}
			return fileSignature{}, "error", err.Error()
		}

		after, err := statLocalFileWithRetry(target.OriginalPath, options)
		if err != nil {
			if os.IsNotExist(err) {
				return fileSignature{}, "missing", "missing"
			}
			return fileSignature{}, "error", err.Error()
		}
		if !metadataMatches(signature, after) {
			server.notifyStabilizing(target, "changed during hash")
			continue
		}
		signature.FileHash = digest
		signature.FileHashAlg = mediaFileHashAlg
		return signature, "ready", ""
	}
	return fileSignature{}, "error", "file changed while hashing"
}

func (server *watchServer) runPolling(generation uint64, interval time.Duration, cancel <-chan struct{}) {
	server.pollOnce(generation)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			server.pollOnce(generation)
		case <-cancel:
			return
		}
	}
}

func (server *watchServer) pollTargetsSnapshot(generation uint64) ([]watchTarget, watchOptions, bool) {
	server.mu.RLock()
	defer server.mu.RUnlock()
	if generation != server.generation {
		return nil, watchOptions{}, false
	}
	targets := make([]watchTarget, 0, len(server.targetsByKey))
	for _, target := range server.targetsByKey {
		target.QueueItemIDs = append([]string(nil), target.QueueItemIDs...)
		targets = append(targets, target)
	}
	return targets, server.options, true
}

func (server *watchServer) pollOnce(generation uint64) {
	targets, options, ok := server.pollTargetsSnapshot(generation)
	if !ok {
		return
	}
	for _, target := range targets {
		signature, err := statLocalFileWithRetry(target.OriginalPath, options)
		if err != nil {
			if os.IsNotExist(err) {
				if _, observed := server.observedSignature(target.EventKey); observed {
					server.scheduleTargetCheck(target.EventKey, "poll", "", "")
				}
				continue
			}
			continue
		}
		previous, observed := server.observedSignature(target.EventKey)
		if !observed {
			server.setObservedSignatureForGeneration(target.EventKey, generation, signature)
			continue
		}
		if !metadataMatches(previous, signature) {
			server.scheduleTargetCheck(target.EventKey, "poll", "", "")
		}
	}
}

func (server *watchServer) close() {
	server.mu.Lock()
	server.stopPollingLocked()
	server.cancelPendingChecksLocked()
	server.generation++
	server.mu.Unlock()
	_ = server.clearWatches()
	if err := server.watcher.Close(); err != nil {
		log.Printf("failed to close watcher: %v", err)
	}
}

func (server *watchServer) notify(method string, params any) {
	server.writeJSON(rpcNotification{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
	})
}

func (server *watchServer) respond(id *json.RawMessage, result any, rpcErr *rpcError) {
	if id == nil {
		return
	}
	server.writeJSON(rpcResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
		Error:   rpcErr,
	})
}

func (server *watchServer) writeJSON(value any) {
	server.outMu.Lock()
	defer server.outMu.Unlock()
	if err := server.out.Encode(value); err != nil {
		log.Printf("failed to write rpc message: %v", err)
	}
}

func parseSetWatchesParams(raw json.RawMessage) ([]watchItem, watchOptions, error) {
	if len(raw) == 0 {
		return nil, defaultWatchOptions(), nil
	}

	var positional []json.RawMessage
	if err := json.Unmarshal(raw, &positional); err == nil {
		if len(positional) == 0 {
			return nil, defaultWatchOptions(), nil
		}
		raw = positional[0]
	}

	var objectParams setWatchesParams
	if err := json.Unmarshal(raw, &objectParams); err == nil && objectParams.Items != nil {
		return objectParams.Items, normalizeWatchOptions(objectParams.Options), nil
	}

	var items []watchItem
	if err := json.Unmarshal(raw, &items); err == nil {
		return items, defaultWatchOptions(), nil
	}

	return nil, defaultWatchOptions(), errors.New("watch.set expects {items:[...]} or an item array")
}

func handleRequest(server *watchServer, req rpcRequest) (any, *rpcError) {
	switch req.Method {
	case "watch.ready":
		return map[string]any{
			"ok":      true,
			"backend": "fsnotify",
			"features": []string{
				"parent-directory-coalescing",
				"debounce",
				"stability-polling",
				"stat-hash-retry",
				"xxh3-64",
				"polling-fallback",
			},
		}, nil
	case "watch.set":
		items, options, err := parseSetWatchesParams(req.Params)
		if err != nil {
			return nil, &rpcError{Code: -32602, Message: err.Error()}
		}
		return server.setWatches(items, options), nil
	case "watch.clear":
		return server.clearWatches(), nil
	default:
		return nil, &rpcError{Code: -32601, Message: fmt.Sprintf("unknown method %q", req.Method)}
	}
}

func serveRPC(input io.Reader, server *watchServer) error {
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var req rpcRequest
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			server.notify("watch.error", watchError{Error: fmt.Sprintf("invalid json-rpc request: %v", err)})
			continue
		}
		result, rpcErr := handleRequest(server, req)
		server.respond(req.ID, result, rpcErr)
	}
	return scanner.Err()
}

func main() {
	log.SetOutput(os.Stderr)
	log.SetFlags(0)

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Fatalf("failed to create fsnotify watcher: %v", err)
	}
	server := newWatchServer(watcher, os.Stdout)
	go server.runEvents()

	if err := serveRPC(os.Stdin, server); err != nil {
		log.Printf("rpc input failed: %v", err)
	}
	server.close()
}
