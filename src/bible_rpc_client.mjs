/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";

const RPC_TIMEOUT_MS = 15000;

function platformBinaryName(platform = process.platform, arch = process.arch) {
  const normalizedArch = arch === "x64" ? "x64" : arch;
  const extension = platform === "win32" ? ".exe" : "";
  return `bible-rpc-${platform}-${normalizedArch}${extension}`;
}

export class BibleRpcClient {
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
    return path.join(this.resourcesRoot(), "bible", "bible-sqlite.db");
  }

  async ready() {
    await this.call("bible.ready");
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
    const databasePath = this.databasePath();
    if (!existsSync(binaryPath)) {
      throw new Error(`Bible sidecar not found: ${binaryPath}`);
    }
    if (!existsSync(databasePath)) {
      throw new Error(`Bible database not found: ${databasePath}`);
    }

    this.child = spawn(binaryPath, ["--db", databasePath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.buffer = "";

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      const message = String(chunk || "").trim();
      if (message) console.error(`[bible-rpc] ${message}`);
    });
    this.child.on("error", (err) => this.rejectAll(err));
    this.child.on("exit", (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      this.rejectAll(new Error(`Bible sidecar exited with ${detail}`));
      this.child = null;
    });
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
      console.error("[bible-rpc] Failed to parse response:", err);
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message || "Bible RPC error"));
    } else {
      pending.resolve(message.result);
    }
  }

  request(method, params) {
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
        reject(new Error(`Bible RPC timed out: ${method}`));
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
    this.rejectAll(new Error("Bible sidecar stopped"));
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
  }
}
