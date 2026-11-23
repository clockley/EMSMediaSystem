package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"runtime"
	"strings"

	"emsmediasystem/songs-rpc/internal/embedding"
	"emsmediasystem/songs-rpc/internal/songimport"
	"emsmediasystem/songs-rpc/internal/songstore"
)

type JSONRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
	ID      interface{}     `json:"id"`
}

type JSONRPCResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	Result  interface{} `json:"result,omitempty"`
	Error   interface{} `json:"error,omitempty"`
	ID      interface{} `json:"id"`
}

type searchParams struct {
	Interactive bool    `json:"interactive"`
	LexicalOnly bool    `json:"lexicalOnly"`
	Query       string  `json:"query"`
	FolderID    *string `json:"folderId"`
	All         bool    `json:"all"`
	Unfiled     bool    `json:"unfiled"`
}

type importFilesParams struct {
	Paths           []string     `json:"paths"`
	DefaultFolderID *string      `json:"defaultFolderId"`
	Search          searchParams `json:"search"`
}

func main() {
	dbPath := flag.String("db", "", "Path to SQLite database")
	models := flag.String("models", "", "Directory containing the offline song search model and tokenizer")
	flag.Parse()

	if *dbPath == "" {
		log.Fatal("Must provide -db path")
	}

	store, err := songstore.InitStore(*dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize store: %v", err)
	}
	defer store.Close()
	if *models != "" {
		// Leave CPU time for the live presentation during a library backfill.
		runtime.GOMAXPROCS(min(2, runtime.GOMAXPROCS(0)))
		store.StartSemanticIndex(func(ctx context.Context) (songstore.Encoder, error) { return embedding.Load(ctx, *models) })
	}

	type searchJob struct {
		id   any
		ctx  context.Context
		opts songstore.SearchOptions
	}
	// The stdin loop owns cancellation and the pending slot. The worker can
	// finish its current inference while only the latest query waits for it.
	jobs := make(chan searchJob, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for job := range jobs {
			rows, err := store.SearchContext(job.ctx, job.opts)
			if job.ctx.Err() != nil {
				sendResult(job.id, []songstore.SearchResult{})
			} else if err != nil {
				sendError(job.id, -32000, err.Error())
			} else {
				sendResult(job.id, rows)
			}
		}
	}()
	var cancelSearch context.CancelFunc
	supersede := func() {
		if cancelSearch != nil {
			cancelSearch()
			cancelSearch = nil
		}
		select {
		case pending := <-jobs:
			sendResult(pending.id, []songstore.SearchResult{})
		default:
		}
	}
	defer func() {
		close(jobs)
		<-done
		if cancelSearch != nil {
			cancelSearch()
		}
	}()
	reader := bufio.NewReader(os.Stdin)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				break
			}
			log.Printf("Read error: %v", err)
			continue
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		var req JSONRPCRequest
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			sendError(nil, -32700, "Parse error")
			continue
		}

		if req.Method == "songs.search" {
			opts := parseSearchOptions(req.Params)
			if opts.LexicalOnly || opts.Interactive {
				supersede()
			}
			if opts.Interactive && !opts.LexicalOnly && strings.TrimSpace(opts.Query) != "" {
				// Foreground RPCs (including lexical searches) remain available
				// while the model finishes a passage or refines the current query.
				ctx, cancel := context.WithCancel(context.Background())
				cancelSearch = cancel
				jobs <- searchJob{req.ID, ctx, opts}
				continue
			}
		}
		handleRequest(store, req)
	}
}

func parseSearchOptions(params json.RawMessage) songstore.SearchOptions {
	opts := songstore.SearchOptions{}
	if len(params) == 0 {
		return opts
	}

	var objectParams searchParams
	if err := json.Unmarshal(params, &objectParams); err == nil {
		return parseSearchOptionsFromParams(objectParams)
	}

	var objectList []searchParams
	if err := json.Unmarshal(params, &objectList); err == nil && len(objectList) > 0 {
		return parseSearchOptionsFromParams(objectList[0])
	}

	var stringParams []string
	if err := json.Unmarshal(params, &stringParams); err == nil && len(stringParams) > 0 {
		opts.Query = stringParams[0]
	}
	return opts
}

func parseSearchOptionsFromParams(params searchParams) songstore.SearchOptions {
	return songstore.SearchOptions{
		Interactive: params.Interactive,
		LexicalOnly: params.LexicalOnly,
		Query:       params.Query,
		FolderID:    params.FolderID,
		All:         params.All,
		Unfiled:     params.Unfiled,
	}
}

func handleRequest(store *songstore.SongStore, req JSONRPCRequest) {
	var result interface{}
	var err error

	switch req.Method {
	case "usage.record":
		var p songstore.Projection
		if err = json.Unmarshal(req.Params, &p); err == nil {
			err = store.RecordProjection(p)
			result = true
		}
	case "usage.list":
		var p struct{ From, To string }
		if err = json.Unmarshal(req.Params, &p); err == nil {
			result, err = store.Projections(p.From, p.To)
		}
	case "usage.review":
		var p songstore.ProjectionReview
		if err = json.Unmarshal(req.Params, &p); err == nil {
			err = store.ReviewProjection(p)
			result = true
		}
	case "songs.ready":
		result = true
	case "songs.search":
		result, err = store.Search(parseSearchOptions(req.Params))
	case "songs.get":
		var params []string
		if e := json.Unmarshal(req.Params, &params); e == nil && len(params) > 0 {
			result, err = store.GetSong(params[0])
		} else {
			err = fmt.Errorf("invalid parameters")
		}
	case "songs.save":
		var params []interface{}
		if e := json.Unmarshal(req.Params, &params); e == nil && len(params) >= 1 {
			songJSON, _ := json.Marshal(params[0])
			var document map[string]interface{}
			if e := json.Unmarshal(songJSON, &document); e == nil {
				originalImportJSON := ""
				if len(params) > 1 {
					originalImportJSON = fmt.Sprintf("%v", params[1])
				}
				err = store.SaveSongDocument(document, originalImportJSON)
				if err == nil {
					if id, _ := document["id"].(string); id != "" {
						result, err = store.GetSong(id)
					}
				}
			} else {
				err = fmt.Errorf("invalid song object")
			}
		} else {
			err = fmt.Errorf("invalid parameters")
		}
	case "songs.delete":
		var params []string
		if e := json.Unmarshal(req.Params, &params); e == nil && len(params) > 0 {
			err = store.DeleteSong(params[0])
			result = true
		} else {
			err = fmt.Errorf("invalid parameters")
		}
	case "songs.resetDatabase":
		err = store.ResetDatabase()
		result = true
	case "songs.folders.list":
		result, err = store.ListFolders()
	case "songs.folders.create":
		var params []string
		if e := json.Unmarshal(req.Params, &params); e == nil && len(params) > 0 {
			result, err = store.CreateFolder(params[0])
		} else {
			err = fmt.Errorf("invalid parameters")
		}
	case "songs.folders.rename":
		var params []string
		if e := json.Unmarshal(req.Params, &params); e == nil && len(params) >= 2 {
			err = store.RenameFolder(params[0], params[1])
			result = true
		} else {
			err = fmt.Errorf("invalid parameters")
		}
	case "songs.folders.delete":
		var params []string
		if e := json.Unmarshal(req.Params, &params); e == nil && len(params) > 0 {
			err = store.DeleteFolder(params[0])
			result = true
		} else {
			err = fmt.Errorf("invalid parameters")
		}
	case "songs.moveToFolder":
		var params []interface{}
		if e := json.Unmarshal(req.Params, &params); e == nil && len(params) >= 1 {
			songID, ok := params[0].(string)
			if !ok || songID == "" {
				err = fmt.Errorf("invalid parameters")
				break
			}
			var folderID *string
			if len(params) > 1 && params[1] != nil {
				if value, ok := params[1].(string); ok && strings.TrimSpace(value) != "" {
					trimmed := strings.TrimSpace(value)
					folderID = &trimmed
				}
			}
			err = store.MoveSongToFolder(songID, folderID)
			if err == nil {
				result, err = store.GetSong(songID)
			}
		} else {
			err = fmt.Errorf("invalid parameters")
		}
	case "songs.importFiles":
		var paramList []importFilesParams
		if e := json.Unmarshal(req.Params, &paramList); e == nil && len(paramList) > 0 && len(paramList[0].Paths) > 0 {
			params := paramList[0]
			result, err = store.ImportFiles(songstore.ImportFilesOptions{
				Paths:           params.Paths,
				DefaultFolderID: params.DefaultFolderID,
				Search:          parseSearchOptionsFromParams(params.Search),
			})
		} else {
			err = fmt.Errorf("invalid parameters")
		}
	case "songs.parseLyricsText":
		var params []string
		if e := json.Unmarshal(req.Params, &params); e == nil && len(params) > 0 {
			result = songimport.ParseLyricsEditorText(params[0])
		} else {
			err = fmt.Errorf("invalid parameters")
		}
	default:
		sendError(req.ID, -32601, "Method not found")
		return
	}

	if err != nil {
		sendError(req.ID, -32000, err.Error())
	} else {
		sendResult(req.ID, result)
	}
}

func sendResult(id interface{}, result interface{}) {
	resp := JSONRPCResponse{
		JSONRPC: "2.0",
		Result:  result,
		ID:      id,
	}
	send(resp)
}

func sendError(id interface{}, code int, message string) {
	resp := JSONRPCResponse{
		JSONRPC: "2.0",
		Error: map[string]interface{}{
			"code":    code,
			"message": message,
		},
		ID: id,
	}
	send(resp)
}

func send(resp JSONRPCResponse) {
	b, err := json.Marshal(resp)
	if err != nil {
		log.Printf("Failed to marshal response: %v", err)
		return
	}
	fmt.Println(string(b))
}
