# Song import fixtures

Inputs for **Go** song import tests in [`sidecars/songs-rpc/internal/songimport/`](../../../sidecars/songs-rpc/internal/songimport/).

Song file import is Go-only (`songs.importFiles`, `songimport.ParseContent`). JavaScript does not parse these files.

File naming:

```
<case>.input.<ext>                  — input passed to songimport.ParseContent()
<case>.expected.searchtext.txt      — optional expected flattened search text
```

Structural JSON expectations are intentionally omitted because importers generate random ids for songs, sections, and blocks. Tests should assert invariants instead — e.g. `schema === "ems.song.v1"`, expected section labels in order, block text equality, and `playOrder.length === sections.length` when no explicit order is given.

## Cases

| Case | Purpose |
| --- | --- |
| `txt-basic` | TXT import with `Title:`/`Author:`/`Copyright:`/`CCLI:`/`Meter:`/`PlayOrder:` headers and `[Section]` markers. Expect two `verse` sections labelled `Verse 1` / `Verse 2`, `playOrder.length === 2`. |
| `txt-unbracketed` | TXT import where the body has no section markers; the importer must synthesize a single `Verse 1` section containing all four lyric lines. |
| `legacy-lines` | Legacy `{title, lines:[...]}` JSON converted to AST. Expect blank-line-separated stanzas to become separate `verse` sections (`Verse 1`, `Verse 2`). |
| `hymnal-stanzas` | Legacy `{title, stanzas:[{lines}]}` JSON converted to AST. Expect `songNumber === 12` and two `verse` sections built from `stanza.lines`. |
| `praise-ast` | An already-canonical `ems.song.v1` document. Used to pin search-text output — see [`praise-ast.expected.searchtext.txt`](praise-ast.expected.searchtext.txt). |

Run Go import tests:

```bash
make test-songs-import
# or:
cd sidecars/songs-rpc && go test ./internal/songimport/...
```

Search-text expectations live beside inputs as `<case>.expected.searchtext.txt` and are verified by `TestSearchTextFixturePraiseAST` using `SongAstToSearchText()` in Go.
