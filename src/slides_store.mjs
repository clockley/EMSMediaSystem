/*
Copyright (C) 2026 Christian Lockley

Main-process file-system store for EMS slide decks. Each deck is persisted
as a single JSON file in `<userData>/decks/<id>.ems-slide.json`. A lightweight
in-memory index is rebuilt by scanning the directory on demand.

This module is loaded by the Electron main process and is not exposed to
renderers directly — `src/main.mjs` registers `slides:*` IPC handlers that
call into it.
*/

import { mkdir, readdir, readFile, rm, stat } from "fs/promises";
import path from "path";
import writeFileAtomic from "write-file-atomic";

const DECK_FILE_SUFFIX = ".ems-slide.json";
const SCHEMA_ID = "ems.slideDeck.v1";

function safeIdComponent(id) {
  return String(id || "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, "_");
}

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
  }

  async _ensureDir() {
    await mkdir(this.root, { recursive: true });
  }

  _deckPath(id) {
    return path.join(this.root, `${safeIdComponent(id)}${DECK_FILE_SUFFIX}`);
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
    await this._ensureDir();
    let entries;
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch {
      entries = [];
    }
    const summaries = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(DECK_FILE_SUFFIX)) continue;
      try {
        const raw = await readFile(path.join(this.root, entry.name), "utf8");
        const deck = JSON.parse(raw);
        const summary = summarizeDeck(deck);
        if (summary) summaries.push(summary);
      } catch (err) {
        console.warn("SlidesStore: failed to parse", entry.name, err);
      }
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
    if (!id) return null;
    try {
      const raw = await readFile(this._deckPath(id), "utf8");
      return JSON.parse(raw);
    } catch (err) {
      if (err && err.code === "ENOENT") return null;
      throw err;
    }
  }

  async save(deck) {
    if (!deck || typeof deck !== "object") throw new Error("Invalid deck");
    if (deck.schema && deck.schema !== SCHEMA_ID) {
      throw new Error(`Unsupported deck schema: ${deck.schema}`);
    }
    await this._ensureDir();
    const out = { ...deck };
    if (!out.id) out.id = shortId("deck");
    if (!out.schema) out.schema = SCHEMA_ID;
    out.pageSequence = normalizePageSequence(out.pages, out.pageSequence);
    out.updatedAt = new Date().toISOString();
    if (!out.createdAt) out.createdAt = out.updatedAt;
    await writeFileAtomic(this._deckPath(out.id), JSON.stringify(out, null, 2), "utf8");
    return summarizeDeck(out);
  }

  async delete(id) {
    if (!id) return false;
    try {
      await rm(this._deckPath(id), { force: true });
      return true;
    } catch {
      return false;
    }
  }

  async duplicate(id, { title = null } = {}) {
    const src = await this.get(id);
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = shortId("deck");
    copy.title = title || `${src.title || "Untitled Deck"} (Copy)`;
    const now = new Date().toISOString();
    copy.createdAt = now;
    copy.updatedAt = now;
    await this.save(copy);
    return copy;
  }

  async listFolders() {
    return [...(await this._loadFolders())];
  }

  async createFolder(name) {
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

  async renameFolder(id, name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) throw new Error("Folder name required");
    const folders = await this._loadFolders();
    const folder = folders.find((f) => f.id === id);
    if (!folder) return null;
    folder.name = trimmed;
    await this._persistFolders();
    return folder;
  }

  async deleteFolder(id) {
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
      await this.save(deck);
    }
    return true;
  }

  async moveToFolder(deckId, folderId) {
    const deck = await this.get(deckId);
    if (!deck) return null;
    deck.folderId = folderId || null;
    await this.save(deck);
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
