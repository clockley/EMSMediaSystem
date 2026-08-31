/* Copyright (C) 2026 Christian Lockley — GPL-3.0-or-later */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const POSTER_TIMEOUT_MS = 15000;

export function videoPosterSidecar({ app, devRoot, platform = process.platform } = {}) {
  const resourcesRoot = app?.isPackaged ? process.resourcesPath : devRoot;
  if (platform === "linux") {
    const script = path.join(resourcesRoot, "bin", "gnome-video-poster.js");
    return { command: "gjs", args: [script], artifact: script };
  }
  if (platform === "win32") {
    const binary = path.join(resourcesRoot, "bin", "video-poster-win32-x64.exe");
    return { command: binary, args: [], artifact: binary };
  }
  return null;
}

export function generateVideoPoster(
  filePath,
  { app, devRoot, platform = process.platform, timeoutMs = POSTER_TIMEOUT_MS } = {},
) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    return Promise.resolve({ ok: false, code: "invalid_request" });
  }
  const sidecar = videoPosterSidecar({ app, devRoot, platform });
  if (!sidecar) return Promise.resolve({ ok: false, code: "unsupported_platform" });
  if (!existsSync(sidecar.artifact)) {
    return Promise.resolve({
      ok: false, code: "sidecar_unavailable",
      message: `Video poster sidecar not found: ${sidecar.artifact}`,
    });
  }
  return new Promise((resolve) => {
    const child = spawn(sidecar.command, sidecar.args, {
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, code: "timeout", message: "Poster generation timed out" });
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      finish({ ok: false, code: "sidecar_unavailable", message: error.message });
    });
    child.stdin.on("error", (error) => {
      finish({ ok: false, code: "sidecar_unavailable", message: error.message });
    });
    child.on("close", () => {
      if (settled) return;
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
      if (!line) {
        finish({ ok: false, code: "invalid_response", message: stderr.trim() || "Poster sidecar returned no response" });
        return;
      }
      try {
        const response = JSON.parse(line);
        if (response.error) {
          finish({ ok: false, code: "rpc_error", message: response.error.message });
        } else {
          finish(response.result);
        }
      } catch {
        finish({ ok: false, code: "invalid_response", message: stderr.trim() || "Poster sidecar returned invalid JSON" });
      }
    });
    child.stdin.end(`${JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "poster.generate",
      params: [{ path: filePath, size: 512 }],
    })}\n`);
  });
}
