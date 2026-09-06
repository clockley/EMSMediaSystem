package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
)

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string    `json:"jsonrpc"`
	ID      any       `json:"id,omitempty"`
	Result  any       `json:"result,omitempty"`
	Error   *rpcError `json:"error,omitempty"`
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

type rpcWriter struct {
	mu  sync.Mutex
	enc *json.Encoder
}

func (w *rpcWriter) send(value any) {
	w.mu.Lock()
	defer w.mu.Unlock()
	_ = w.enc.Encode(value)
}

func (w *rpcWriter) result(id any, result any) {
	w.send(rpcResponse{JSONRPC: "2.0", ID: id, Result: result})
}

func (w *rpcWriter) fail(id any, code int, err error) {
	w.send(rpcResponse{JSONRPC: "2.0", ID: id, Error: &rpcError{Code: code, Message: err.Error()}})
}

func (w *rpcWriter) notify(method string, params any) {
	w.send(rpcNotification{JSONRPC: "2.0", Method: method, Params: params})
}

func firstParam[T any](raw json.RawMessage) (T, error) {
	var zero T
	var params []json.RawMessage
	if err := json.Unmarshal(raw, &params); err != nil || len(params) == 0 {
		return zero, fmt.Errorf("invalid parameters")
	}
	var value T
	if err := json.Unmarshal(params[0], &value); err != nil {
		return zero, fmt.Errorf("invalid parameters: %w", err)
	}
	return value, nil
}

func stringParams(raw json.RawMessage) ([]string, error) {
	var params []string
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, fmt.Errorf("invalid parameters")
	}
	return params, nil
}

func main() {
	writer := &rpcWriter{enc: json.NewEncoder(os.Stdout)}
	service := newLibraryService(func(change changeRecord) {
		writer.notify("media-library.changed", change)
	})
	defer service.Close()
	var requests sync.WaitGroup
	defer requests.Wait()

	reader := bufio.NewReader(os.Stdin)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				return
			}
			continue
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var req rpcRequest
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			writer.fail(nil, -32700, fmt.Errorf("parse error"))
			continue
		}
		requests.Add(1)
		go func(request rpcRequest) {
			defer requests.Done()
			result, err := dispatch(service, request)
			if err != nil {
				writer.fail(request.ID, -32000, err)
			} else {
				writer.result(request.ID, result)
			}
		}(req)
	}
}

func dispatch(service *libraryService, req rpcRequest) (any, error) {
	switch req.Method {
	case "library.ready":
		options, err := firstParam[readyOptions](req.Params)
		if err != nil {
			return nil, err
		}
		return service.Ready(options)
	case "library.snapshot":
		return service.Snapshot()
	case "library.changes":
		var params []json.RawMessage
		if err := json.Unmarshal(req.Params, &params); err != nil || len(params) == 0 {
			return service.ChangesSince(0)
		}
		var revision int64
		if err := json.Unmarshal(params[0], &revision); err != nil {
			var text string
			_ = json.Unmarshal(params[0], &text)
			revision = parseInt64(text)
		}
		return service.ChangesSince(revision)
	case "library.query":
		options, err := firstParam[queryOptions](req.Params)
		if err != nil {
			return nil, err
		}
		return service.Query(options)
	case "library.item.get":
		params, err := stringParams(req.Params)
		if err != nil || len(params) == 0 {
			return nil, fmt.Errorf("item id is required")
		}
		return service.GetItem(params[0])
	case "library.folders.list":
		params, err := stringParams(req.Params)
		if err != nil || len(params) == 0 {
			return nil, fmt.Errorf("source id is required")
		}
		parentID := ""
		if len(params) > 1 {
			parentID = params[1]
		}
		return service.ListFolders(params[0], parentID)
	case "library.source.add":
		params, err := stringParams(req.Params)
		if err != nil || len(params) == 0 {
			return nil, fmt.Errorf("folder path is required")
		}
		return service.AddSource(params[0])
	case "library.source.remove":
		params, err := stringParams(req.Params)
		if err != nil || len(params) == 0 {
			return nil, fmt.Errorf("source id is required")
		}
		return service.RemoveSource(params[0])
	case "library.source.rescan":
		params, _ := stringParams(req.Params)
		if len(params) == 0 || params[0] == "" {
			return service.RefreshAll()
		}
		return service.ScanSource(params[0])
	case "library.items.add":
		var params [][]string
		if err := json.Unmarshal(req.Params, &params); err != nil || len(params) == 0 {
			return nil, fmt.Errorf("file paths are required")
		}
		return service.AddFiles(params[0])
	case "library.drop.add":
		var params [][]string
		if err := json.Unmarshal(req.Params, &params); err != nil || len(params) == 0 {
			return nil, fmt.Errorf("dropped paths are required")
		}
		return service.AddDroppedPaths(params[0])
	case "library.items.removeAdded":
		var params [][]string
		if err := json.Unmarshal(req.Params, &params); err != nil || len(params) == 0 {
			return nil, fmt.Errorf("item ids are required")
		}
		return service.RemoveAddedItems(params[0])
	case "library.activity.record":
		activity, err := firstParam[activityInput](req.Params)
		if err != nil {
			return nil, err
		}
		return service.RecordActivity(activity)
	case "library.thumbnail":
		request, err := firstParam[thumbnailRequest](req.Params)
		if err != nil {
			return nil, err
		}
		return service.Thumbnail(request)
	default:
		return nil, fmt.Errorf("method not found: %s", req.Method)
	}
}
