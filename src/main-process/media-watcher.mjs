/*
Copyright (C) 2026 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RPC_TIMEOUT_MS = 10000;
const WATCH_DEBOUNCE_MS = 300;
const WATCH_STABILITY_INTERVAL_MS = 500;
const WATCH_STABILITY_SAMPLES = 3;
const WATCH_MAX_STABILITY_POLLS = 20;
const WATCH_POLL_INTERVAL_MS = 5000;

const MEDIA_WATCHER_BINARIES = Object.freeze({
  linux: Object.freeze({
    x64: "media-watcher-linux-x64",
    arm64: "media-watcher-linux-arm64",
  }),
  win32: Object.freeze({
    x64: "media-watcher-win32-x64.exe",
    arm64: "media-watcher-win32-arm64.exe",
  }),
});

export function mediaWatcherBinaryName(platform = process.platform, arch = process.arch) {
  const platformBinaries = MEDIA_WATCHER_BINARIES[platform];
  if (!platformBinaries) {
    throw new Error(`Unsupported media watcher sidecar platform: ${platform}`);
  }
  const binaryName = platformBinaries[arch];
  if (!binaryName) {
    throw new Error(`Unsupported media watcher sidecar architecture: ${platform}/${arch}`);
  }
  return binaryName;
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

function pinnedMetadataMatches(item, payload) {
  return (
    Number.isFinite(item.pinnedSizeBytes) &&
    item.pinnedSizeBytes === payload.sizeBytes &&
    Number.isFinite(item.pinnedMtimeMs) &&
    item.pinnedMtimeMs === payload.mtimeMs
  );
}

function sidecarWatchOptions() {
  return {
    debounceMs: WATCH_DEBOUNCE_MS,
    stabilityIntervalMs: WATCH_STABILITY_INTERVAL_MS,
    stabilitySamples: WATCH_STABILITY_SAMPLES,
    maxStabilityPolls: WATCH_MAX_STABILITY_POLLS,
    pollIntervalMs: WATCH_POLL_INTERVAL_MS,
  };
}

class MediaWatcherSidecarClient {
  constructor({ app, devRoot, onEvent, onError }) {
    this.app = app;
    this.devRoot = devRoot;
    this.onEvent = typeof onEvent === "function" ? onEvent : () => {};
    this.onError = typeof onError === "function" ? onError : () => {};
    this.child = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.startPromise = null;
    this.readyInfo = null;
  }

  resourcesRoot() {
    return this.app?.isPackaged ? process.resourcesPath : this.devRoot;
  }

  binaryPath() {
    return path.join(this.resourcesRoot(), "bin", mediaWatcherBinaryName());
  }

  async ready() {
    await this.ensureStarted();
    return this.readyInfo;
  }

  async setWatches(items, options = {}) {
    return this.call("watch.set", [
      {
        items: Array.isArray(items) ? items : [],
        options,
      },
    ]);
  }

  async clearWatches() {
    if (!this.child || this.child.killed) {
      return { watchedItems: 0, watchedFiles: 0, watchedDirectories: 0 };
    }
    return this.call("watch.clear");
  }

  async call(method, params = []) {
    await this.ensureStarted();
    return this.request(method, params);
  }

  async ensureStarted() {
    if (this.child && !this.child.killed) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.start();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async start() {
    const binaryPath = this.binaryPath();
    if (!existsSync(binaryPath)) {
      throw new Error(`Media watcher sidecar not found: ${binaryPath}`);
    }

    this.child = spawn(binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.buffer = "";
    this.readyInfo = null;

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      const message = String(chunk || "").trim();
      if (message) console.error(`[media-watcher] ${message}`);
    });
    this.child.on("error", (err) => this.rejectAll(err));
    this.child.on("exit", (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      this.rejectAll(new Error(`Media watcher sidecar exited with ${detail}`));
      this.child = null;
      this.readyInfo = null;
    });

    this.readyInfo = await this.request("watch.ready");
  }

  handleStdout(chunk) {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) this.handleMessage(line);
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  handleMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (err) {
      console.error("[media-watcher] Failed to parse sidecar message:", err);
      return;
    }

    if (message.method) {
      this.handleNotification(message);
      return;
    }

    const pending = this.pending.get(String(message.id));
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(String(message.id));
    if (message.error) {
      pending.reject(new Error(message.error.message || "Media watcher RPC error"));
    } else {
      pending.resolve(message.result);
    }
  }

  handleNotification(message) {
    const params = message.params || {};
    if (message.method === "watch.changed") {
      this.onEvent(params);
    } else if (message.method === "watch.error") {
      this.onError(params);
    }
  }

  request(method, params = []) {
    const id = this.nextId;
    this.nextId += 1;
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: Array.isArray(params) ? params : [],
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`Media watcher RPC timed out: ${method}`));
      }, RPC_TIMEOUT_MS);
      this.pending.set(String(id), { resolve, reject, timer });
      this.child.stdin.write(`${payload}\n`, "utf8", (err) => {
        if (!err) return;
        clearTimeout(timer);
        this.pending.delete(String(id));
        reject(err);
      });
    });
  }

  rejectAll(err) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pending.delete(id);
    }
  }

  stop() {
    this.rejectAll(new Error("Media watcher sidecar stopped"));
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
    this.readyInfo = null;
  }
}

export class MediaWatcher {
  constructor({ app, devRoot, sendToRenderer }) {
    this.sendToRenderer =
      typeof sendToRenderer === "function" ? sendToRenderer : () => {};
    this.itemsByPath = new Map();
    this.sidecar = new MediaWatcherSidecarClient({
      app,
      devRoot,
      onEvent: (payload) => this.handleSidecarChanged(payload),
      onError: (payload) => {
        const detail = payload?.dir ? `${payload.dir}: ${payload.error}` : payload?.error;
        console.error(`[media-watcher] Sidecar watch error: ${detail || "unknown error"}`);
      },
    });
  }

  async sync(items) {
    this.resetLocalState();
    const nextItems = Array.isArray(items) ? items : [];
    const sidecarItems = [];
    for (const raw of nextItems) {
      const item = this.normalizeWatchItem(raw);
      if (!item) continue;
      this.addItem(item);
      sidecarItems.push({
        queueItemId: item.queueItemId,
        originalPath: item.originalPath,
        pinnedFileHash: item.pinnedFileHash,
        pinnedSizeBytes: Number.isFinite(item.pinnedSizeBytes)
          ? item.pinnedSizeBytes
          : undefined,
        pinnedMtimeMs: Number.isFinite(item.pinnedMtimeMs)
          ? item.pinnedMtimeMs
          : undefined,
      });
    }

    try {
      const result = sidecarItems.length > 0
        ? await this.sidecar.setWatches(sidecarItems, sidecarWatchOptions())
        : await this.sidecar.clearWatches();
      return {
        watchedItems: this.watchedItemCount(),
        watchedFiles: this.itemsByPath.size,
        watchedDirectories: result?.watchedDirectories ?? 0,
        pollIntervalMs: result?.pollIntervalMs ?? 0,
        failedDirectories: result?.failedDirectories || [],
      };
    } catch (err) {
      console.error("[media-watcher] Failed to sync sidecar watches:", err);
      return {
        watchedItems: this.watchedItemCount(),
        watchedFiles: this.itemsByPath.size,
        watchedDirectories: 0,
        error: err?.message || String(err),
      };
    }
  }

  closeAll() {
    this.resetLocalState();
    this.sidecar.stop();
  }

  resetLocalState() {
    this.itemsByPath.clear();
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
  }

  watchedItemCount() {
    let count = 0;
    for (const items of this.itemsByPath.values()) {
      count += items.length;
    }
    return count;
  }

  queueItemIdsForItems(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => item.queueItemId)
      .filter(Boolean);
  }

  payloadQueueItemIds(payload) {
    const values = [];
    if (Array.isArray(payload?.queueItemIds)) values.push(...payload.queueItemIds);
    if (payload?.queueItemId !== undefined && payload.queueItemId !== null) {
      values.push(payload.queueItemId);
    }
    const normalized = values
      .map((value) => String(value))
      .filter((value) => value.length > 0);
    return normalized.length > 0 ? new Set(normalized) : null;
  }

  itemsForPayload(originalPath, payload) {
    const watchedItems = this.itemsByPath.get(originalPath) || [];
    const queueItemIds = this.payloadQueueItemIds(payload);
    if (!queueItemIds) return watchedItems;
    return watchedItems.filter((item) => queueItemIds.has(item.queueItemId));
  }

  sidecarFacts(payload) {
    return {
      mtimeMs: Number.isFinite(payload?.mtimeMs) ? payload.mtimeMs : undefined,
      sizeBytes: Number.isFinite(payload?.sizeBytes) ? payload.sizeBytes : undefined,
      modifiedTime:
        typeof payload?.modifiedTime === "string" ? payload.modifiedTime : undefined,
      fileHash:
        typeof payload?.fileHash === "string" && payload.fileHash.length > 0
          ? payload.fileHash.toLowerCase()
          : "",
      fileHashAlg:
        typeof payload?.fileHashAlg === "string" && payload.fileHashAlg.length > 0
          ? payload.fileHashAlg
          : undefined,
    };
  }

  handleSidecarChanged(payload) {
    const originalPath = normalizeLocalPath(payload?.originalPath || payload?.eventPath || "");
    if (!originalPath || !this.itemsByPath.has(originalPath)) return;
    const watchedItems = this.itemsForPayload(originalPath, payload);
    if (watchedItems.length === 0) return;

    const status = payload?.status || "ready";
    if (status === "stabilizing") {
      watchedItems.forEach((item) => {
        item.pending = true;
      });
      this.sendToRenderer("media-source-stabilizing", {
        originalPath,
        queueItemIds: this.queueItemIdsForItems(watchedItems),
        errorReason: payload?.errorReason,
      });
      return;
    }

    if (status === "missing" || status === "error") {
      watchedItems.forEach((item) => {
        item.pending = false;
      });
      this.sendToRenderer("media-source-changed", {
        originalPath,
        queueItemIds: this.queueItemIdsForItems(watchedItems),
        status,
        errorReason: payload?.errorReason || status,
      });
      return;
    }

    if (status !== "ready") return;
    const facts = this.sidecarFacts(payload);
    for (const item of watchedItems) {
      item.pending = false;
      if (item.pinnedFileHash && facts.fileHash === item.pinnedFileHash) {
        if (Number.isFinite(facts.mtimeMs)) item.pinnedMtimeMs = facts.mtimeMs;
        if (Number.isFinite(facts.sizeBytes)) item.pinnedSizeBytes = facts.sizeBytes;
        continue;
      }
      if (!item.pinnedFileHash && pinnedMetadataMatches(item, facts)) {
        continue;
      }
      this.sendToRenderer("media-source-changed", {
        originalPath,
        queueItemId: item.queueItemId,
        queueItemIds: item.queueItemId ? [item.queueItemId] : undefined,
        mtimeMs: facts.mtimeMs,
        sizeBytes: facts.sizeBytes,
        modifiedTime: facts.modifiedTime,
        fileHash: facts.fileHash || undefined,
        fileHashAlg: facts.fileHashAlg,
        status: "ready",
      });
    }
  }
}
