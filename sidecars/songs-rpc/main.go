package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"strings"

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
	Query    string  `json:"query"`
	FolderID *string `json:"folderId"`
	All      bool    `json:"all"`
	Unfiled  bool    `json:"unfiled"`
}

type importFilesParams struct {
	Paths           []string     `json:"paths"`
	DefaultFolderID *string      `json:"defaultFolderId"`
	Search          searchParams `json:"search"`
}

func main() {
	dbPath := flag.String("db", "", "Path to SQLite database")
	flag.Parse()

	if *dbPath == "" {
		log.Fatal("Must provide -db path")
	}

	store, err := songstore.InitStore(*dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize store: %v", err)
	}
	defer store.Close()

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

		handleRequest(store, req)
	}
}

func parseSearchOptions(params json.RawMessage) songstore.SearchOptions {
	opts := songstore.SearchOptions{}
	if len(params) == 0 {
		return opts
	}

	var objectParams searchParams
	if err := json.Unmarshal(params, &objectParams); err == nil && (objectParams.Query != "" || objectParams.FolderID != nil || objectParams.All || objectParams.Unfiled) {
		return parseSearchOptionsFromParams(objectParams)
	}

	var objectList []searchParams
	if err := json.Unmarshal(params, &objectList); err == nil && len(objectList) > 0 {
		candidate := objectList[0]
		if candidate.Query != "" || candidate.FolderID != nil || candidate.All || candidate.Unfiled {
			return parseSearchOptionsFromParams(candidate)
		}
	}

	var stringParams []string
	if err := json.Unmarshal(params, &stringParams); err == nil && len(stringParams) > 0 {
		opts.Query = stringParams[0]
	}
	return opts
}

func parseSearchOptionsFromParams(params searchParams) songstore.SearchOptions {
	return songstore.SearchOptions{
		Query:    params.Query,
		FolderID: params.FolderID,
		All:      params.All,
		Unfiled:  params.Unfiled,
	}
}

func handleRequest(store *songstore.SongStore, req JSONRPCRequest) {
	var result interface{}
	var err error

	switch req.Method {
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
