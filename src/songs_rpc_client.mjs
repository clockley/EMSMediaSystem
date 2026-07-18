/*
Copyright (C) 2024 Christian Lockley
*/

import { spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import path from "path";

const RPC_TIMEOUT_MS = 120000;

const SONGS_RPC_BINARIES = Object.freeze({
  linux: Object.freeze({
    x64: "songs-rpc-linux-x64",
    arm64: "songs-rpc-linux-arm64",
  }),
  win32: Object.freeze({
    x64: "songs-rpc-win32-x64.exe",
    arm64: "songs-rpc-win32-arm64.exe",
  }),
});

export function platformBinaryName(platform = process.platform, arch = process.arch) {
  const platformBinaries = SONGS_RPC_BINARIES[platform];
  if (!platformBinaries) {
    throw new Error(`Unsupported Songs sidecar platform: ${platform}`);
  }
  const binaryName = platformBinaries[arch];
  if (!binaryName) {
    throw new Error(`Unsupported Songs sidecar architecture: ${platform}/${arch}`);
  }
  return binaryName;
}

export class SongsRpcClient {
  constructor({ app, devRoot }) {
    this.app = app;
    this.devRoot = devRoot;
    this.child = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.startPromise = null;
  }

  resourcesRoot() {
    return this.app?.isPackaged ? process.resourcesPath : this.devRoot;
  }

  binaryPath() {
    return path.join(this.resourcesRoot(), "bin", platformBinaryName());
  }

  databasePath() {
    if (this.app?.getPath) {
      return path.join(this.app.getPath("userData"), "songs", "songs-sqlite.db");
    }
    return path.join(this.resourcesRoot(), "songs", "songs-sqlite.db");
  }

  ensureDatabasePath() {
    const databasePath = this.databasePath();
    const dbDir = path.dirname(databasePath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
    return databasePath;
  }

  async ready() {
    await this.call("songs.ready");
    return true;
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
    const databasePath = this.ensureDatabasePath();
    // For local dev, we might not have it built, so fallback to running from go
    if (!existsSync(binaryPath)) {
        // Fallback for dev mode
        console.warn(`Songs sidecar not found at ${binaryPath}, using fallback if in dev`);
    }

    // Try to ensure db path dir exists
    const dbDir = path.dirname(databasePath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      let spawnPath = binaryPath;
      let spawnArgs = ["-db", databasePath];
      
      if (!existsSync(binaryPath) && !this.app?.isPackaged) {
          spawnPath = "go";
          spawnArgs = ["run", "emsmediasystem/songs-rpc", "-db", databasePath];
          const cwd = path.join(this.devRoot, "sidecars", "songs-rpc");
          this.child = spawn(spawnPath, spawnArgs, { cwd });
      } else {
          this.child = spawn(spawnPath, spawnArgs);
      }

      const child = this.child;
      child.stdout.on("data", (data) => this.handleData(data));
      child.stderr.on("data", (data) => console.error(`[Songs RPC] ${data}`));

      child.on("error", (err) => {
        console.error("Songs RPC Error:", err);
        if (this.child === child) {
          this.child = null;
          this.rejectAll(err);
        }
        reject(err);
      });

      child.on("exit", (code) => {
        console.log(`Songs RPC exited with code ${code}`);
        if (this.child === child) {
          this.child = null;
          this.rejectAll(new Error("Songs sidecar exited"));
        }
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
        const response = JSON.parse(line);
        const pendingCall = this.pending.get(response.id);
        if (pendingCall) {
          this.pending.delete(response.id);
          clearTimeout(pendingCall.timeout);
          if (response.error) {
            pendingCall.reject(new Error(response.error.message));
          } else {
            pendingCall.resolve(response.result);
          }
        }
      } catch (err) {
        console.error("Failed to parse Songs RPC response:", err, line);
      }
    }
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      const child = this.child;
      if (!child || child.killed || child.stdin.destroyed) {
        reject(new Error("Songs sidecar is not running"));
        return;
      }
      const id = this.nextId++;
      
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Songs RPC timeout for ${method}`));
      }, RPC_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timeout });

      const request = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });

      child.stdin.write(request + "\n", (err) => {
        if (!err) return;
        const pendingCall = this.pending.get(id);
        if (!pendingCall) return;
        clearTimeout(pendingCall.timeout);
        this.pending.delete(id);
        pendingCall.reject(err);
      });
    });
  }

  rejectAll(err) {
    for (const pendingCall of this.pending.values()) {
      clearTimeout(pendingCall.timeout);
      pendingCall.reject(err);
    }
    this.pending.clear();
  }
}
