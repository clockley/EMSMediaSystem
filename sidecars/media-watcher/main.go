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

	"github.com/fsnotify/fsnotify"
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

type setWatchesParams struct {
	Items []watchItem `json:"items"`
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
	FailedDirectories  []watchDirError `json:"failedDirectories,omitempty"`
}

type watchEvent struct {
	OriginalPath string   `json:"originalPath"`
	QueueItemIDs []string `json:"queueItemIds,omitempty"`
	EventPath    string   `json:"eventPath,omitempty"`
	Op           string   `json:"op,omitempty"`
}

type watchError struct {
	Dir   string `json:"dir,omitempty"`
	Error string `json:"error"`
}

type watchServer struct {
	watcher      *fsnotify.Watcher
	out          *json.Encoder
	outMu        sync.Mutex
	mu           sync.RWMutex
	dirs         map[string]string
	targetsByDir map[string][]watchTarget
	targetsByKey map[string]watchTarget
}

func newWatchServer(watcher *fsnotify.Watcher, output io.Writer) *watchServer {
	return &watchServer{
		watcher:      watcher,
		out:          json.NewEncoder(output),
		dirs:         make(map[string]string),
		targetsByDir: make(map[string][]watchTarget),
		targetsByKey: make(map[string]watchTarget),
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

func (server *watchServer) setWatches(items []watchItem) watchSummary {
	targets, nextDirs := targetsFromItems(items)
	nextTargetsByDir := groupTargetsByDir(targets)
	failed := make([]watchDirError, 0)

	server.mu.Lock()
	defer server.mu.Unlock()

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
	return watchSummary{
		WatchedItems:       len(items),
		WatchedFiles:       len(targets),
		WatchedDirectories: len(server.dirs),
		FailedDirectories:  failed,
	}
}

func (server *watchServer) clearWatches() watchSummary {
	return server.setWatches(nil)
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

	for _, target := range targets {
		if target.EventKey != eventKey {
			continue
		}
		server.notify("watch.event", watchEvent{
			OriginalPath: target.OriginalPath,
			QueueItemIDs: append([]string(nil), target.QueueItemIDs...),
			EventPath:    eventPath,
			Op:           event.Op.String(),
		})
	}
}

func (server *watchServer) close() {
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

func parseSetWatchesParams(raw json.RawMessage) ([]watchItem, error) {
	if len(raw) == 0 {
		return nil, nil
	}

	var positional []json.RawMessage
	if err := json.Unmarshal(raw, &positional); err == nil {
		if len(positional) == 0 {
			return nil, nil
		}
		raw = positional[0]
	}

	var objectParams setWatchesParams
	if err := json.Unmarshal(raw, &objectParams); err == nil && objectParams.Items != nil {
		return objectParams.Items, nil
	}

	var items []watchItem
	if err := json.Unmarshal(raw, &items); err == nil {
		return items, nil
	}

	return nil, errors.New("watch.set expects {items:[...]} or an item array")
}

func handleRequest(server *watchServer, req rpcRequest) (any, *rpcError) {
	switch req.Method {
	case "watch.ready":
		return map[string]any{
			"ok":      true,
			"backend": "fsnotify",
		}, nil
	case "watch.set":
		items, err := parseSetWatchesParams(req.Params)
		if err != nil {
			return nil, &rpcError{Code: -32602, Message: err.Error()}
		}
		return server.setWatches(items), nil
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
