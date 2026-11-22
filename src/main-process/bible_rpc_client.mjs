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

const RPC_TIMEOUT_MS = 120000;

const BIBLE_RPC_BINARIES = Object.freeze({
  linux: Object.freeze({
    x64: "bible-rpc-linux-x64",
    arm64: "bible-rpc-linux-arm64",
  }),
  win32: Object.freeze({
    x64: "bible-rpc-win32-x64.exe",
    arm64: "bible-rpc-win32-arm64.exe",
  }),
});

export function platformBinaryName(platform = process.platform, arch = process.arch) {
  const platformBinaries = BIBLE_RPC_BINARIES[platform];
  if (!platformBinaries) {
    throw new Error(`Unsupported Bible sidecar platform: ${platform}`);
  }
  const binaryName = platformBinaries[arch];
  if (!binaryName) {
    throw new Error(`Unsupported Bible sidecar architecture: ${platform}/${arch}`);
  }
  return binaryName;
}

export class BibleRpcClient {
  constructor({ app, devRoot, includeInstalledEasyWorship = () => false }) {
    this.app = app;
    this.devRoot = devRoot;
    this.includeInstalledEasyWorship = includeInstalledEasyWorship;
    this.session = null;
    this.closed = false;
    this.nextId = 1;
  }

  get child() {
    return this.session?.child ?? null;
  }

  resourcesRoot() {
    return this.app?.isPackaged ? process.resourcesPath : this.devRoot;
  }

  binaryPath() {
    return path.join(this.resourcesRoot(), "bin", platformBinaryName());
  }

  bundleDirectory() {
    return path.join(this.resourcesRoot(), "bible");
  }

  userBibleDirectory() {
    return path.join(this.app.getPath("userData"), "bibles");
  }

  async ready() {
    await this.call("bible.ready");
    return true;
  }

  async call(method, params = []) {
    if (this.closed) throw new Error("Bible sidecar closed");
    const child = this.child;
    const session = child && !child.killed && child.exitCode === null &&
      child.signalCode == null && child.stdin.writable ? this.session : this.start();
    return this.request(session, method, params);
  }

  start() {
    const binaryPath = this.binaryPath();
    const bundleDirectory = this.bundleDirectory();
    if (!existsSync(binaryPath)) {
      throw new Error(`Bible sidecar not found: ${binaryPath}`);
    }
    if (!existsSync(path.join(bundleDirectory, "bundle.manifest.json"))) {
      throw new Error(`Bible bundle not found: ${bundleDirectory}`);
    }
    const userBibleDirectory = this.userBibleDirectory();
    const child = spawn(binaryPath, [
      "--bundle-dir",
      bundleDirectory,
      "--user-packages-dir",
      path.join(userBibleDirectory, "packages"),
      "--cache-dir",
      path.join(userBibleDirectory, "cache"),
      "--ewb-dir",
      path.join(userBibleDirectory, "easyworship"),
      ...(this.includeInstalledEasyWorship() ? ["--include-installed-ewb"] : []),
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const session = { child, buffer: "", pending: new Map() };
    this.session = session;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      this.handleStdout(session, chunk);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      const message = String(chunk || "").trim();
      if (message) console.error(`[bible-rpc] ${message}`);
    });
    const fail = (err) => {
      this.rejectSession(session, err);
      if (child.exitCode === null && child.signalCode == null && !child.killed) child.kill();
    };
    child.stdin.on("error", fail);
    child.stdout.on("error", fail);
    child.stderr.on("error", fail);
    child.on("error", (err) => this.rejectSession(session, err));
    // Node can deliver the last stdout data after the process exit event.
    child.once("close", (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      this.rejectSession(session, new Error(`Bible sidecar exited with ${detail}`));
    });
    return session;
  }

  handleStdout(session, chunk) {
    session.buffer += chunk;
    let newlineIndex = session.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = session.buffer.slice(0, newlineIndex).trim();
      session.buffer = session.buffer.slice(newlineIndex + 1);
      if (line) this.handleMessage(session, line);
      newlineIndex = session.buffer.indexOf("\n");
    }
  }

  handleMessage(session, line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (err) {
      console.error("[bible-rpc] Failed to parse response:", err);
      return;
    }

    const pending = session.pending.get(message?.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    session.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message || "Bible RPC error"));
    } else {
      pending.resolve(message.result);
    }
  }

  request(session, method, params) {
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
        session.pending.delete(id);
        reject(new Error(`Bible RPC timed out: ${method}`));
      }, RPC_TIMEOUT_MS);
      session.pending.set(id, { resolve, reject, timer });
      const onWrite = (err) => {
        if (!err) return;
        clearTimeout(timer);
        session.pending.delete(id);
        reject(err);
      };
      try {
        session.child.stdin.write(`${payload}\n`, "utf8", onWrite);
      } catch (err) {
        onWrite(err);
      }
    });
  }

  rejectSession(session, err) {
    if (this.session === session) this.session = null;
    for (const [id, pending] of session.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      session.pending.delete(id);
    }
  }

  stop() {
    const session = this.session;
    if (!session) return;
    this.rejectSession(session, new Error("Bible sidecar stopped"));
    if (!session.child.killed) session.child.kill();
  }

  close() {
    this.closed = true;
    this.stop();
  }
}
