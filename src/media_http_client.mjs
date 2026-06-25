/*
Copyright (C) 2026 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { spawn } from "child_process";
import { existsSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const RPC_TIMEOUT_MS = 30000;

const MEDIA_HTTP_BINARIES = Object.freeze({
  linux: Object.freeze({
    x64: "media-http-linux-x64",
    arm64: "media-http-linux-arm64",
  }),
  win32: Object.freeze({
    x64: "media-http-win32-x64.exe",
    arm64: "media-http-win32-arm64.exe",
  }),
});

export function mediaHttpBinaryName(platform = process.platform, arch = process.arch) {
  const platformBinaries = MEDIA_HTTP_BINARIES[platform];
  if (!platformBinaries) {
    throw new Error(`Unsupported media HTTP sidecar platform: ${platform}`);
  }
  const binaryName = platformBinaries[arch];
  if (!binaryName) {
    throw new Error(`Unsupported media HTTP sidecar architecture: ${platform}/${arch}`);
  }
  return binaryName;
}

function normalizeLocalMediaPath(filePath) {
  if (!filePath || typeof filePath !== "string") return "";
  if (/^file:/i.test(filePath)) {
    return fileURLToPath(filePath);
  }
  return filePath;
}

function mediaUrlCacheKey(filePath) {
  try {
    const info = statSync(filePath);
    return `${filePath}\0${info.size}\0${info.mtimeMs}`;
  } catch {
    return filePath;
  }
}

export class MediaHttpClient {
  constructor({ app, devRoot }) {
    this.app = app;
    this.devRoot = devRoot;
    this.child = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.startPromise = null;
    this.readyInfo = null;
    this.urlCache = new Map();
  }

  resourcesRoot() {
    return this.app?.isPackaged ? process.resourcesPath : this.devRoot;
  }

  binaryPath() {
    return path.join(this.resourcesRoot(), "bin", mediaHttpBinaryName());
  }

  async ready() {
    await this.ensureStarted();
    return this.readyInfo;
  }

  async urlForFile(filePath) {
    const normalizedPath = normalizeLocalMediaPath(filePath);
    if (!normalizedPath) return "";
    const cacheKey = mediaUrlCacheKey(normalizedPath);
    const cached = this.urlCache.get(cacheKey);
    if (cached) return cached;
    const result = await this.call("media.registerFile", [{ path: normalizedPath }]);
    if (!result?.url) {
      throw new Error("Media HTTP sidecar returned no URL");
    }
    this.urlCache.set(cacheKey, result.url);
    return result.url;
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
      throw new Error(`Media HTTP sidecar not found: ${binaryPath}`);
    }

    this.child = spawn(binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.buffer = "";
    this.readyInfo = null;
    this.urlCache.clear();

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      const message = String(chunk || "").trim();
      if (message) console.error(`[media-http] ${message}`);
    });
    this.child.on("error", (err) => this.rejectAll(err));
    this.child.on("exit", (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      this.rejectAll(new Error(`Media HTTP sidecar exited with ${detail}`));
      this.child = null;
      this.readyInfo = null;
      this.urlCache.clear();
    });

    this.readyInfo = await this.request("media.ready");
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
      console.error("[media-http] Failed to parse response:", err);
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message || "Media HTTP RPC error"));
    } else {
      pending.resolve(message.result);
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
        this.pending.delete(id);
        reject(new Error(`Media HTTP RPC timed out: ${method}`));
      }, RPC_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${payload}\n`, "utf8", (err) => {
        if (!err) return;
        clearTimeout(timer);
        this.pending.delete(id);
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
    this.rejectAll(new Error("Media HTTP sidecar stopped"));
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
    this.readyInfo = null;
    this.urlCache.clear();
  }
}
