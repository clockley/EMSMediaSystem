/*
Copyright (C) 2026 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hashMediaFile,
  MEDIA_FILE_HASH_ALG,
} from "./media-file-hash.min.mjs";

const DEBOUNCE_MS = 300;
const STABILITY_INTERVAL_MS = 500;
const STABILITY_SAMPLES = 3;
const MAX_STABILITY_POLLS = 20;
const POLLING_INTERVAL_MS = 5000;

let parcelWatcherModulePromise = null;

async function loadParcelWatcher() {
  if (!parcelWatcherModulePromise) {
    parcelWatcherModulePromise = import("@parcel/watcher").then((module) => {
      const watcher = module.default || module;
      if (typeof watcher.subscribe !== "function") {
        throw new Error("@parcel/watcher subscribe API is unavailable");
      }
      return watcher;
    });
  }
  return parcelWatcherModulePromise;
}

function normalizeLocalPath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return "";
  const trimmed = filePath.trim();
  try {
    const fsPath = /^file:/i.test(trimmed) ? fileURLToPath(trimmed) : trimmed;
    return path.resolve(fsPath);
  } catch {
    return "";
  }
}

function mediaFileMtimeIso(info) {
  return info?.mtime instanceof Date && Number.isFinite(info.mtime.getTime())
    ? info.mtime.toISOString()
    : undefined;
}

function statSignature(info) {
  return {
    sizeBytes: info.size,
    mtimeMs: info.mtimeMs,
    modifiedTime: mediaFileMtimeIso(info),
  };
}

function comparablePathKey(filePath) {
  const normalized = path.resolve(String(filePath || ""));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function normalizeWatcherEventPath(dir, eventPath) {
  if (typeof eventPath !== "string" || eventPath.length === 0) return "";
  return path.resolve(dir, eventPath);
}

function checkKeyFor(originalPath, generation) {
  return `${generation}\0${originalPath}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MediaWatcher {
  constructor({ sendToRenderer }) {
    this.sendToRenderer =
      typeof sendToRenderer === "function" ? sendToRenderer : () => {};
    this.directories = new Map();
    this.itemsByPath = new Map();
    this.pollTimer = null;
    this.watchGeneration = 0;
    this.checksInFlight = new Set();
    this.checksQueued = new Set();
  }

  sync(items) {
    this.closeAll();
    const nextItems = Array.isArray(items) ? items : [];
    for (const raw of nextItems) {
      const item = this.normalizeWatchItem(raw);
      if (!item) continue;
      this.addItem(item);
    }
    this.ensurePollingState();
    return {
      watchedItems: this.itemsByPath.size,
      watchedDirectories: this.directories.size,
    };
  }

  closeAll() {
    this.watchGeneration += 1;
    for (const entry of this.directories.values()) {
      entry.closed = true;
      for (const timer of entry.timers.values()) {
        clearTimeout(timer);
      }
      entry.timers.clear();
      const subscription = entry.subscription;
      entry.subscription = null;
      if (subscription) {
        void subscription.unsubscribe().catch((err) => {
          console.error(`[media-watcher] Failed to unsubscribe from ${entry.dir}:`, err);
        });
      }
    }
    this.directories.clear();
    this.itemsByPath.clear();
    this.checksInFlight.clear();
    this.checksQueued.clear();
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  normalizeWatchItem(raw) {
    if (!raw || typeof raw !== "object") return null;
    const originalPath = normalizeLocalPath(raw.originalPath || raw.path);
    if (!originalPath) return null;
    if (/^(https?|m3u8|mpd|blob|bible):/i.test(String(raw.originalPath || raw.path || ""))) {
      return null;
    }
    const pinnedFileHash =
      typeof raw.pinnedFileHash === "string" && raw.pinnedFileHash.length > 0
        ? raw.pinnedFileHash.toLowerCase()
        : typeof raw.fileHash === "string" && raw.fileHash.length > 0
          ? raw.fileHash.toLowerCase()
          : "";
    return {
      queueItemId: String(raw.queueItemId ?? ""),
      originalPath,
      pinnedFileHash,
      pinnedSizeBytes: Number.isFinite(raw.pinnedSizeBytes)
        ? raw.pinnedSizeBytes
        : Number.isFinite(raw.sizeBytes)
          ? raw.sizeBytes
          : null,
      pinnedMtimeMs: Number.isFinite(raw.pinnedMtimeMs) ? raw.pinnedMtimeMs : null,
      pending: false,
    };
  }

  addItem(item) {
    const existing = this.itemsByPath.get(item.originalPath) || [];
    existing.push(item);
    this.itemsByPath.set(item.originalPath, existing);

    const dir = path.dirname(item.originalPath);
    let entry = this.directories.get(dir);
    if (!entry) {
      entry = {
        dir,
        items: new Set(),
        itemPathsByEventKey: new Map(),
        timers: new Map(),
        subscription: null,
        closed: false,
        pollingOnly: false,
      };
      this.directories.set(dir, entry);
      void this.startDirectoryWatch(entry);
    }
    entry.items.add(item.originalPath);
    const eventKey = comparablePathKey(item.originalPath);
    let eventPaths = entry.itemPathsByEventKey.get(eventKey);
    if (!eventPaths) {
      eventPaths = new Set();
      entry.itemPathsByEventKey.set(eventKey, eventPaths);
    }
    eventPaths.add(item.originalPath);
  }

  async startDirectoryWatch(entry) {
    const generation = this.watchGeneration;
    const onEvents = (err, events) => {
      if (!this.isCurrentEntry(entry, generation)) return;
      if (err) {
        this.markDirectoryPollingOnly(entry, err);
        return;
      }
      this.handleWatcherEvents(entry, events);
    };

    try {
      const parcelWatcher = await loadParcelWatcher();
      const subscription = await parcelWatcher.subscribe(entry.dir, onEvents);
      if (!this.isCurrentEntry(entry, generation)) {
        await subscription.unsubscribe().catch(() => {});
        return;
      }
      entry.subscription = subscription;
    } catch (err) {
      if (!this.isCurrentEntry(entry, generation)) return;
      this.markDirectoryPollingOnly(entry, err);
    }
  }

  isCurrentEntry(entry, generation) {
    return (
      generation === this.watchGeneration &&
      !entry.closed &&
      this.directories.get(entry.dir) === entry
    );
  }

  isCurrentPath(originalPath, generation) {
    return generation === this.watchGeneration && this.itemsByPath.has(originalPath);
  }

  markDirectoryPollingOnly(entry, err) {
    if (entry.closed) return;
    if (!entry.pollingOnly) {
      console.error(`[media-watcher] Falling back to polling for ${entry.dir}:`, err);
    }
    entry.pollingOnly = true;
    const subscription = entry.subscription;
    entry.subscription = null;
    if (subscription) {
      void subscription.unsubscribe().catch(() => {});
    }
    this.ensurePollingState();
  }

  handleWatcherEvents(entry, events) {
    if (!Array.isArray(events) || events.length === 0) {
      this.scheduleEntryChecks(entry);
      return;
    }

    const scheduled = new Set();
    for (const event of events) {
      const eventPath = normalizeWatcherEventPath(entry.dir, event?.path);
      if (!eventPath) {
        this.scheduleEntryChecks(entry, scheduled);
        continue;
      }
      const watchedPaths = entry.itemPathsByEventKey.get(comparablePathKey(eventPath));
      if (!watchedPaths) continue;
      for (const watchedPath of watchedPaths) {
        if (scheduled.has(watchedPath)) continue;
        scheduled.add(watchedPath);
        this.schedulePathCheck(watchedPath);
      }
    }
  }

  scheduleEntryChecks(entry, scheduled = new Set()) {
    for (const watchedPath of entry.items) {
      if (scheduled.has(watchedPath)) continue;
      scheduled.add(watchedPath);
      this.schedulePathCheck(watchedPath);
    }
  }

  ensurePollingState() {
    const needsPolling =
      this.itemsByPath.size > 0 &&
      Array.from(this.directories.values()).some((entry) => entry.pollingOnly);
    if (!needsPolling && this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      return;
    }
    if (needsPolling && this.pollTimer === null) {
      this.pollTimer = setInterval(() => {
        for (const entry of this.directories.values()) {
          if (!entry.pollingOnly) continue;
          this.scheduleEntryChecks(entry);
        }
      }, POLLING_INTERVAL_MS);
      this.pollTimer.unref?.();
    }
  }

  schedulePathCheck(originalPath) {
    const dir = path.dirname(originalPath);
    const entry = this.directories.get(dir);
    if (!entry) return;
    const existingTimer = entry.timers.get(originalPath);
    if (existingTimer) clearTimeout(existingTimer);
    const generation = this.watchGeneration;
    const timer = setTimeout(() => {
      entry.timers.delete(originalPath);
      this.runPathCheck(originalPath, generation);
    }, DEBOUNCE_MS);
    entry.timers.set(originalPath, timer);
    timer.unref?.();
  }

  runPathCheck(originalPath, generation) {
    if (!this.isCurrentPath(originalPath, generation)) return;
    const checkKey = checkKeyFor(originalPath, generation);
    if (this.checksInFlight.has(checkKey)) {
      this.checksQueued.add(checkKey);
      return;
    }

    this.checksInFlight.add(checkKey);
    void this.checkPathWhenStable(originalPath, generation)
      .catch((err) => {
        console.error(`[media-watcher] Failed to check ${originalPath}:`, err);
      })
      .finally(() => {
        this.checksInFlight.delete(checkKey);
        if (
          this.checksQueued.delete(checkKey) &&
          this.isCurrentPath(originalPath, generation)
        ) {
          this.schedulePathCheck(originalPath);
        }
      });
  }

  queueItemIdsForPath(originalPath) {
    return (this.itemsByPath.get(originalPath) || [])
      .map((item) => item.queueItemId)
      .filter(Boolean);
  }

  async checkPathWhenStable(originalPath, generation) {
    let watchedItems = this.itemsByPath.get(originalPath);
    if (!watchedItems || watchedItems.length === 0) return;
    watchedItems.forEach((item) => {
      item.pending = true;
    });
    this.sendToRenderer("media-source-stabilizing", {
      originalPath,
      queueItemIds: watchedItems.map((item) => item.queueItemId).filter(Boolean),
    });

    const stable = await this.waitForStableFile(originalPath, generation);
    if (!this.isCurrentPath(originalPath, generation)) return;
    watchedItems = this.itemsByPath.get(originalPath) || [];
    if (!stable) {
      watchedItems.forEach((item) => {
        item.pending = false;
      });
      return;
    }

    let fileHash = "";
    try {
      fileHash = await hashMediaFile(originalPath);
    } catch (err) {
      if (!this.isCurrentPath(originalPath, generation)) return;
      watchedItems.forEach((item) => {
        item.pending = false;
      });
      this.sendToRenderer("media-source-changed", {
        originalPath,
        queueItemIds: watchedItems.map((item) => item.queueItemId).filter(Boolean),
        status: "error",
        errorReason: err?.message || "hash-failed",
      });
      return;
    }

    if (!this.isCurrentPath(originalPath, generation)) return;
    watchedItems = this.itemsByPath.get(originalPath) || [];
    for (const item of watchedItems) {
      item.pending = false;
      if (item.pinnedFileHash && fileHash === item.pinnedFileHash) {
        item.pinnedMtimeMs = stable.mtimeMs;
        item.pinnedSizeBytes = stable.sizeBytes;
        continue;
      }
      if (
        !item.pinnedFileHash &&
        Number.isFinite(item.pinnedSizeBytes) &&
        item.pinnedSizeBytes === stable.sizeBytes &&
        Number.isFinite(item.pinnedMtimeMs) &&
        item.pinnedMtimeMs === stable.mtimeMs
      ) {
        continue;
      }
      this.sendToRenderer("media-source-changed", {
        originalPath,
        queueItemId: item.queueItemId,
        mtimeMs: stable.mtimeMs,
        sizeBytes: stable.sizeBytes,
        modifiedTime: stable.modifiedTime,
        fileHash,
        fileHashAlg: MEDIA_FILE_HASH_ALG,
        status: "ready",
      });
    }
  }

  async waitForStableFile(originalPath, generation) {
    let last = null;
    let stableCount = 0;
    for (let poll = 0; poll < MAX_STABILITY_POLLS; poll += 1) {
      if (!this.isCurrentPath(originalPath, generation)) return null;
      let info;
      try {
        const handle = await fsp.open(originalPath, "r");
        try {
          info = await handle.stat();
        } finally {
          await handle.close().catch(() => {});
        }
        if (!info.isFile()) return null;
      } catch (err) {
        if (err?.code === "ENOENT") {
          if (!this.isCurrentPath(originalPath, generation)) return null;
          this.sendToRenderer("media-source-changed", {
            originalPath,
            queueItemIds: this.queueItemIdsForPath(originalPath),
            status: "missing",
            errorReason: "missing",
          });
          return null;
        }
        if (!this.isCurrentPath(originalPath, generation)) return null;
        this.sendToRenderer("media-source-stabilizing", {
          originalPath,
          queueItemIds: this.queueItemIdsForPath(originalPath),
          errorReason: err?.code || "locked",
        });
        await sleep(STABILITY_INTERVAL_MS);
        continue;
      }

      const signature = statSignature(info);
      if (
        last &&
        last.sizeBytes === signature.sizeBytes &&
        last.mtimeMs === signature.mtimeMs
      ) {
        stableCount += 1;
      } else {
        stableCount = 1;
        last = signature;
      }
      if (stableCount >= STABILITY_SAMPLES) return signature;
      await sleep(STABILITY_INTERVAL_MS);
    }
    return last;
  }
}
