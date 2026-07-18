/*
Copyright (C) 2026 Christian Lockley

Main-process file-system store for EMS slide decks. Each deck is persisted
as a single JSON file in `<userData>/decks/<id>.ems-slide.json`. A lightweight
in-memory index is rebuilt by scanning the directory on demand.

This module is loaded by the Electron main process and is not exposed to
renderers directly — `src/main.mjs` registers `slides:*` IPC handlers that
call into it.
*/

import { randomUUID } from "crypto";
import { mkdir, readdir, readFile, rm, stat } from "fs/promises";
import path from "path";
import writeFileAtomic from "write-file-atomic";

const DECK_FILE_SUFFIX = ".ems-slide.json";
const SCHEMA_ID = "ems.slideDeck.v1";

function shortId(prefix = "deck") {
  try {
    const uuid =
      typeof globalThis !== "undefined" &&
      globalThis.crypto &&
      typeof globalThis.crypto.randomUUID === "function"
        ? globalThis.crypto.randomUUID().replace(/-/g, "")
        : "";
    if (uuid) return `${prefix}_${uuid.slice(0, 12)}`;
  } catch {}
  return `${prefix}_${Math.random().toString(36).slice(2, 14)}`;
}

function generatedDeckId() {
  return `deck_${randomUUID().replace(/-/g, "")}`;
}

function isGeneratedDeckId(id) {
  return /^deck_[0-9a-f]{32}$/.test(id);
}

function normalizePageSequence(pages, pageSequence) {
  const pageIds = (Array.isArray(pages) ? pages : [])
    .map((page) => page?.id)
    .filter((id) => typeof id === "string" && id);
  const validIds = new Set(pageIds);
  const seen = new Set();
  const sequence = [];
  const source = Array.isArray(pageSequence) ? pageSequence : pageIds;
  for (const rawId of source) {
    const id = typeof rawId === "string" ? rawId : String(rawId || "");
    if (!id || !validIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    sequence.push(id);
  }
  for (const id of pageIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    sequence.push(id);
  }
  return sequence;
}

function deckPageCount(deck) {
  return normalizePageSequence(deck?.pages, deck?.pageSequence).length;
}

function summarizeDeck(deck) {
  if (!deck || typeof deck !== "object") return null;
  return {
    id: deck.id,
    title: deck.title || "Untitled Deck",
    folderId: typeof deck.folderId === "string" ? deck.folderId : null,
    pageCount: deckPageCount(deck),
    updatedAt: deck.updatedAt || null,
    createdAt: deck.createdAt || null,
  };
}

export class SlidesStore {
  constructor({ userDataPath }) {
    if (!userDataPath) throw new Error("SlidesStore requires userDataPath");
    this.root = path.join(userDataPath, "decks");
    this.foldersFile = path.join(this.root, ".folders.json");
    this._foldersCache = null;
    this._mutationQueue = Promise.resolve();
  }

  _enqueueMutation(task) {
    const run = this._mutationQueue.catch(() => {}).then(task);
    this._mutationQueue = run.catch(() => {});
    return run;
  }

  async _ensureDir() {
    await mkdir(this.root, { recursive: true });
  }

  _deckPath(id) {
    if (!isGeneratedDeckId(id)) throw new Error("Invalid generated deck storage ID");
    return path.join(this.root, `${id}${DECK_FILE_SUFFIX}`);
  }

  async _deckRecords() {
    await this._ensureDir();
    let entries;
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch {
      return [];
    }
    const records = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(DECK_FILE_SUFFIX)) continue;
      const filePath = path.join(this.root, entry.name);
      try {
        const deck = JSON.parse(await readFile(filePath, "utf8"));
        if (!deck || typeof deck !== "object" || typeof deck.id !== "string" || !deck.id) {
          console.warn("SlidesStore: ignored deck with no ID", entry.name);
          continue;
        }
        records.push({ deck, filePath, fileName: entry.name });
      } catch (err) {
        console.warn("SlidesStore: failed to parse", entry.name, err);
      }
    }
    return records;
  }

  async _findDeckRecord(id) {
    if (typeof id !== "string" || !id) return null;
    // Generated IDs map directly to filenames, but still verify the embedded ID.
    if (isGeneratedDeckId(id)) {
      const filePath = this._deckPath(id);
      try {
        const deck = JSON.parse(await readFile(filePath, "utf8"));
        if (deck?.id === id) return { deck, filePath, fileName: path.basename(filePath) };
      } catch (err) {
        if (err?.code !== "ENOENT") throw err;
      }
    }
    // Legacy filenames were lossy sanitizations of IDs. Scan and compare the
    // exact embedded ID so two different IDs can never resolve to one file.
    return (await this._deckRecords()).find((record) => record.deck.id === id) || null;
  }

  async _loadFolders() {
    if (this._foldersCache) return this._foldersCache;
    try {
      const raw = await readFile(this.foldersFile, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.folders)) {
        this._foldersCache = parsed.folders;
        return this._foldersCache;
      }
    } catch {}
    this._foldersCache = [];
    return this._foldersCache;
  }

  async _persistFolders() {
    await this._ensureDir();
    await writeFileAtomic(
      this.foldersFile,
      JSON.stringify({ schema: "ems.slideDeckFolders.v1", folders: this._foldersCache || [] }, null, 2),
      "utf8",
    );
  }

  async list({ search = "", folderId = null } = {}) {
    const summaries = [];
    for (const { deck } of await this._deckRecords()) {
      const summary = summarizeDeck(deck);
      if (summary) summaries.push(summary);
    }
    let filtered = summaries;
    if (folderId === null) {
      // no-op
    } else if (folderId === "") {
      filtered = filtered.filter((s) => !s.folderId);
    } else {
      filtered = filtered.filter((s) => s.folderId === folderId);
    }
    const q = String(search || "").trim().toLowerCase();
    if (q) {
      filtered = filtered.filter((s) => (s.title || "").toLowerCase().includes(q));
    }
    filtered.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    return filtered;
  }

  async get(id) {
    return (await this._findDeckRecord(id))?.deck || null;
  }

  async _save(deck) {
    if (!deck || typeof deck !== "object") throw new Error("Invalid deck");
    if (deck.schema && deck.schema !== SCHEMA_ID) {
      throw new Error(`Unsupported deck schema: ${deck.schema}`);
    }
    await this._ensureDir();
    const requestedId = typeof deck.id === "string" ? deck.id : "";
    const existing = requestedId ? await this._findDeckRecord(requestedId) : null;
    const out = { ...deck, id: existing?.deck.id || generatedDeckId() };
    if (!out.schema) out.schema = SCHEMA_ID;
    out.pageSequence = normalizePageSequence(out.pages, out.pageSequence);
    out.updatedAt = new Date().toISOString();
    if (!out.createdAt) out.createdAt = out.updatedAt;
    const storageId = isGeneratedDeckId(out.id) ? out.id : generatedDeckId();
    const destination = this._deckPath(storageId);
    await writeFileAtomic(destination, JSON.stringify(out, null, 2), "utf8");
    if (existing && existing.filePath !== destination) {
      await rm(existing.filePath, { force: true });
    }
    return summarizeDeck(out);
  }

  save(deck) {
    return this._enqueueMutation(() => this._save(deck));
  }

  delete(id) {
    return this._enqueueMutation(() => this._delete(id));
  }

  async _delete(id) {
    if (!id) return false;
    try {
      const existing = await this._findDeckRecord(id);
      if (!existing) return false;
      await rm(existing.filePath, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  duplicate(id, { title = null } = {}) {
    return this._enqueueMutation(() => this._duplicate(id, { title }));
  }

  async _duplicate(id, { title = null } = {}) {
    const src = await this.get(id);
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    delete copy.id;
    copy.title = title || `${src.title || "Untitled Deck"} (Copy)`;
    const now = new Date().toISOString();
    copy.createdAt = now;
    copy.updatedAt = now;
    const summary = await this._save(copy);
    return this.get(summary.id);
  }

  async listFolders() {
    return [...(await this._loadFolders())];
  }

  createFolder(name) {
    return this._enqueueMutation(() => this._createFolder(name));
  }

  async _createFolder(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) throw new Error("Folder name required");
    const folders = await this._loadFolders();
    const exists = folders.find((f) => f.name === trimmed);
    if (exists) return exists;
    const folder = { id: shortId("folder"), name: trimmed };
    folders.push(folder);
    await this._persistFolders();
    return folder;
  }

  renameFolder(id, name) {
    return this._enqueueMutation(() => this._renameFolder(id, name));
  }

  async _renameFolder(id, name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) throw new Error("Folder name required");
    const folders = await this._loadFolders();
    const folder = folders.find((f) => f.id === id);
    if (!folder) return null;
    folder.name = trimmed;
    await this._persistFolders();
    return folder;
  }

  deleteFolder(id) {
    return this._enqueueMutation(() => this._deleteFolder(id));
  }

  async _deleteFolder(id) {
    const folders = await this._loadFolders();
    const before = folders.length;
    this._foldersCache = folders.filter((f) => f.id !== id);
    if (this._foldersCache.length === before) return false;
    await this._persistFolders();
    // Clear folderId from any deck in this folder.
    const summaries = await this.list({});
    for (const s of summaries) {
      if (s.folderId !== id) continue;
      const deck = await this.get(s.id);
      if (!deck) continue;
      deck.folderId = null;
      await this._save(deck);
    }
    return true;
  }

  moveToFolder(deckId, folderId) {
    return this._enqueueMutation(() => this._moveToFolder(deckId, folderId));
  }

  async _moveToFolder(deckId, folderId) {
    const deck = await this.get(deckId);
    if (!deck) return null;
    deck.folderId = folderId || null;
    await this._save(deck);
    return summarizeDeck(deck);
  }

  async stats() {
    await this._ensureDir();
    let total = 0;
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith(DECK_FILE_SUFFIX)) total++;
      }
    } catch {}
    return { total, root: this.root };
  }

  /**
   * Returns whether the user data path exists / is writable (for diagnostics).
   */
  async ready() {
    try {
      await this._ensureDir();
      await stat(this.root);
      return true;
    } catch {
      return false;
    }
  }
}

export default SlidesStore;
