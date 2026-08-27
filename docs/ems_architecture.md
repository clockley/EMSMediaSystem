# EMS Project Architecture

This document outlines the EMS Media System's project file format, the slides AST, the database schemas used, the Go sidecars, and the reflink index file.

## 1. EMS Project File Format
An EMS project file is a ZIP archive designed to store presentation data, media, and metadata. 
- **MIME Type**: `application/vnd.ems.project+zip`
- **Archive Comment**: The ZIP archive contains a JSON payload in the comment field (`application/vnd.ems.project.comment+json`). This comment includes the project's GUID, application version, save timestamp, and crucially, a SHA-256 hash of the `manifest.json`. This hash is verified when the project is opened to ensure data integrity.
- **File Structure**:
  - `manifest.json` / `documents.json`: Contains project metadata and the index of slides/songs/assets.
  - `mimetype`: A plain text file defining the archive MIME type.
  - `queue.json`: Defines the presentation queue or playlist.
  - `documents/`: A directory containing legacy slide documents.
  - Media assets (videos, images, audio) are embedded directly or referenced.

## 2. Slides AST (Abstract Syntax Tree)
The slides AST is defined by the `ems.slideDeck.v1` schema. It serves as a unified JSON format to represent any presentation document, including songs and standard slide decks.
- **Root Element**: Contains metadata (`id`, `title`), `canvas` dimensions, and the global `theme` (font family, colors, backgrounds).
- **Page Sequence**: `pageSequence` is the ordered list of page ids used for display, playback, thumbnails, search indexing, and future drag/drop reordering.
- **Pages**: An array of `Page` records keyed by `id`, each representing a single slide. A page specifies its transition, duration, background, and objects.
- **Objects**: The visual elements on a slide, which can be of kind `text`, `image`, or `shape`.
  - **Text Objects**: Use a block/segment grammar (shared with `ems.song.v1`) to represent lyric lines, spacers, and formatting. They include properties for `autofit`, alignment, and opacity.
  - **Image Objects**: Define how an image asset fits its bounding box (cover, contain, fill).

## 3. Go Sidecars
EMS utilizes external Go sidecar processes to handle database and file operations efficiently without blocking the main Node/JS thread.
- **bible-rpc**: Connects to the Bible SQLite database, handling lookups and search operations for scripture insertion. It includes an optimizer tool (`bible-db-optimize`) to compress chapters into LZFSE BLOBs.
- **songs-rpc**: Manages the local songs database and imports hymnal formats into the canonical `ems.song.v1` AST. Slide decks are generated as a versioned derived cache.
- **media-watcher**: Monitors media folders for file changes and updates the system's state.

## 4. Database Schemas
The sidecars manage the following SQLite databases:

### Songs Database (`songs-sqlite.db`)
Managed by `songs-rpc`.
- **`songs` table**: Contains searchable song columns plus authoritative `canonical_json` (`ems.song.v1`). `derived_deck_json` and `derived_deck_version` form a disposable, rebuildable visual cache. `song_json` and `ast_json` remain compatibility copies of the canonical AST during the legacy migration window; raw imported source is retained in `original_import_json`.
- **`song_folders` table**: Defines hierarchical folders (`id`, `name`, `parent_id`, `sort_order`).
- **`song_fts`**: A virtual table using FTS5 for full-text searching across song titles, authors, and lyrics.

### Bible Database
Managed by `bible-rpc`.
- **`bible_version_key` table**: Lists available Bible translations (e.g., KJV).
- **`bible_verse_lookup`**: An index table storing rowid, version, book, chapter, and verse references.
- **`bible_chapter_text`**: Stores chapters as LZFSE-compressed JSON BLOBs to save space.
- **`bible_verse_fts`**: A virtual table using FTS5 to enable fast keyword searches across scriptures.

## 5. Reflink Index File (`staging-index.json`)
The `staging-index.json` file is a registry that tracks media assets staged in a centralized cache directory.
- **Purpose**: It avoids duplicating large media files (like 4K videos) when they are used in multiple projects. 
- **Structure**:
  - `projects`: Maps project GUIDs to an array of snapshot IDs (hashes of the media files they use).
  - `snapshots`: Maps each snapshot ID (XXH3 hash) to a reference count (`refCount`) and the projects protecting it.
- When an asset's reference count drops to zero, the staging index marks it as an orphan, and it is safely deleted from disk to reclaim space.
