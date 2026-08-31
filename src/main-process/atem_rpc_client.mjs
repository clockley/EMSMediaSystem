/* Copyright (C) 2026 Christian Lockley — GPL-3.0-or-later */

import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";

const RPC_TIMEOUT_MS = 15_000;

export class AtemRpcClient {
  constructor({ app, devRoot, onNotification = () => {} }) {
    this.app = app;
    this.devRoot = devRoot;
    this.onNotification = onNotification;
    this.child = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.startPromise = null;
  }

  scriptPath() {
    const root = this.app?.isPackaged ? process.resourcesPath : this.devRoot;
    return path.join(root, "bin", "atem-rpc.cjs");
  }

  async call(method, params = {}, options = {}) {
    await this.ensureStarted();
    return this.request(method, params, options.timeoutMs);
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

  start() {
    const scriptPath = this.scriptPath();
    if (!existsSync(scriptPath)) throw new Error(`ATEM sidecar not found: ${scriptPath}`);

    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [scriptPath], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      this.child = child;
      this.buffer = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => this.handleData(child, chunk));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        const message = String(chunk || "").trim();
        if (message) console.error(`[atem-rpc] ${message}`);
      });
      child.once("spawn", resolve);
      child.once("error", (error) => {
        if (this.child === child) this.child = null;
        this.rejectAll(error);
        reject(error);
      });
      child.on("exit", (code, signal) => {
        if (this.child !== child) return;
        this.child = null;
        const detail = signal ? `signal ${signal}` : `code ${code}`;
        this.rejectAll(new Error(`ATEM sidecar exited with ${detail}`));
      });
    });
  }

  handleData(child, chunk) {
    if (this.child !== child) return;
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleMessage(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  handleMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      console.error("[atem-rpc] Invalid JSON response:", error);
      return;
    }
    if (typeof message.method === "string" && message.id === undefined) {
      this.onNotification(message.method, message.params);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      const error = new Error(message.error.message || "ATEM RPC error");
      error.code = message.error.code;
      pending.reject(error);
    } else {
      pending.resolve(message.result);
    }
  }

  request(method, params, timeoutMs = RPC_TIMEOUT_MS) {
    const child = this.child;
    if (!child || child.killed || child.stdin.destroyed) {
      return Promise.reject(new Error("ATEM sidecar is not running"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ATEM RPC timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  stop() {
    this.rejectAll(new Error("ATEM sidecar stopped"));
    if (this.child && !this.child.killed) this.child.kill();
    this.child = null;
  }
}

