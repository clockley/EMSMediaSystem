/* Copyright (C) 2026 Christian Lockley */

import { spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import path from "path";

const RPC_TIMEOUT_MS = 120000;
const BINARIES = Object.freeze({
  linux: Object.freeze({ x64: "media-library-rpc-linux-x64", arm64: "media-library-rpc-linux-arm64" }),
  win32: Object.freeze({ x64: "media-library-rpc-win32-x64.exe", arm64: "media-library-rpc-win32-arm64.exe" }),
});

export function mediaLibraryBinaryName(platform = process.platform, arch = process.arch) {
  const name = BINARIES[platform]?.[arch];
  if (!name) throw new Error(`Unsupported Media Library sidecar platform: ${platform}/${arch}`);
  return name;
}

export class MediaLibraryRpcClient {
  constructor({ app, devRoot, notify }) {
    this.app = app;
    this.devRoot = devRoot;
    this.notify = notify;
    this.child = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.startPromise = null;
    this.initialized = false;
  }

  resourcesRoot() { return this.app?.isPackaged ? process.resourcesPath : this.devRoot; }
  binaryPath() { return path.join(this.resourcesRoot(), "bin", mediaLibraryBinaryName()); }
  storageRoot() { return path.join(this.app.getPath("userData"), "media-library"); }
  databasePath() { return path.join(this.storageRoot(), "media-library.sqlite"); }
  thumbnailCachePath() { return path.join(this.storageRoot(), "thumbnails"); }

  async ready() {
    await this.ensureStarted();
    if (!this.initialized) {
      mkdirSync(this.thumbnailCachePath(), { recursive: true });
      const result = await this.request("library.ready", [{
        databasePath: this.databasePath(),
        thumbnailCachePath: this.thumbnailCachePath(),
      }]);
      this.initialized = true;
      return result;
    }
    return this.request("library.snapshot", []);
  }

  async call(method, params = [], options) {
    await this.ready();
    return this.request(method, params, options?.timeoutMs);
  }

  async ensureStarted() {
    if (this.child && !this.child.killed) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.start();
    try { await this.startPromise; } finally { this.startPromise = null; }
  }

  start() {
    return new Promise((resolve, reject) => {
      const binary = this.binaryPath();
      const fallback = !existsSync(binary) && !this.app?.isPackaged;
      const command = fallback ? "go" : binary;
      const args = fallback ? ["run", "."] : [];
      const cwd = fallback ? path.resolve(this.devRoot, "..", "sidecars", "media-library-rpc") : undefined;
      const child = spawn(command, args, cwd ? { cwd } : undefined);
      this.child = child;
      let stderr = "";
      child.stdout.on("data", (data) => this.handleData(data));
      child.stderr.on("data", (data) => { stderr = `${stderr}${data}`.slice(-4096); console.error(`[Media Library RPC] ${data}`); });
      child.on("error", (error) => { if (this.child === child) this.reset(error); reject(error); });
      child.on("exit", (code) => {
        if (this.child !== child) return;
        this.reset(new Error(stderr.trim() || `Media Library service exited with code ${code}`));
      });
      child.once("spawn", resolve);
    });
  }

  handleData(data) {
    this.buffer += data.toString();
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if (message.method === "media-library.changed") {
          this.notify?.("media-library:changed", message.params);
          continue;
        }
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timeout);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } catch (error) { console.error("Failed to parse Media Library RPC response:", error, line); }
    }
  }

  request(method, params = [], timeoutMs = RPC_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const child = this.child;
      if (!child || child.killed || child.stdin.destroyed) { reject(new Error("Media Library sidecar is not running")); return; }
      const id = this.nextId++;
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`Media Library RPC timeout for ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timeout); this.pending.delete(id); pending.reject(error);
      });
    });
  }

  reset(error) {
    this.child = null;
    this.initialized = false;
    for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(error); }
    this.pending.clear();
  }

  changesSince(revision) { return this.call("library.changes", [revision]); }
  query(options) { return this.call("library.query", [options || {}]); }
  getItem(id) { return this.call("library.item.get", [id]); }
  listFolders(sourceId, parentId = "") { return this.call("library.folders.list", [sourceId, parentId]); }
  addSource(folderPath) { return this.call("library.source.add", [folderPath]); }
  addFiles(paths) { return this.call("library.items.add", [paths]); }
  addDroppedPaths(paths) { return this.call("library.drop.add", [paths]); }
  removeSource(id) { return this.call("library.source.remove", [id]); }
  removeAddedItems(ids) { return this.call("library.items.removeAdded", [ids]); }
  scanSource(id) { return this.call("library.source.rescan", [id]); }
  refreshAll() { return this.call("library.source.rescan", []); }
  recordActivity(activity) { return this.call("library.activity.record", [activity]); }
  thumbnail(request) { return this.call("library.thumbnail", [request]); }
  close() { if (this.child && !this.child.killed) this.child.kill(); this.reset(new Error("Media Library sidecar closed")); }
}
