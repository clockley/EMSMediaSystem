/*
Copyright (C) 2026 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

/**
 * `ems-media://` protocol: range-capable streaming of local MP4-family video
 * with an optional virtual `stss` overlay (see mp4-sync-fix.mjs).
 *
 * The handler streams the ORIGINAL file and replaces only the bytes of the
 * video track's `stss` box with a same-length patch, so Chromium never seeks
 * to a non-IDR "keyframe". Files that need no repair are served unchanged
 * through the same Range implementation. Nothing is written to disk.
 */

import { open, stat as statPath } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { analyzeMp4SyncSamples, fileIdentityMatches } from "./mp4-sync-fix.mjs";
import {
  EMS_MEDIA_SCHEME,
  EMS_MEDIA_VIDEO_EXTENSION_RE,
  parseEmsMediaUrl,
  registeredMediaIdToEmsMediaUrl,
} from "../shared/ems-media-url.mjs";

export { EMS_MEDIA_SCHEME };

/**
 * - standard/secure: a normal hierarchical, potentially-trustworthy origin.
 * - stream: required for media elements to issue Range requests.
 * - corsEnabled + supportFetchAPI: lets elements with `crossorigin` (Web Audio,
 *   captureStream, canvas readback) load the clip CORS-approved.
 * - bypassCSP: page CSPs list file:/self/* but not custom schemes; the scheme
 *   only ever serves vetted local video, so it does not need CSP gating.
 */
export const EMS_MEDIA_SCHEME_PRIVILEGES = Object.freeze({
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
  corsEnabled: true,
  bypassCSP: true,
});

export const EMS_MEDIA_STREAM_CHUNK_BYTES = 256 * 1024;

/** Must be called before `app.whenReady()`. */
export function registerEmsMediaSchemePrivileges(protocol) {
  protocol.registerSchemesAsPrivileged([
    { scheme: EMS_MEDIA_SCHEME, privileges: { ...EMS_MEDIA_SCHEME_PRIVILEGES } },
  ]);
}

/** Per-launch secret placed in every ems-media URL host. */
export function createEmsMediaAccessToken() {
  return `e${randomBytes(16).toString("hex")}`;
}

/**
 * Per-launch registry behind opaque ems-media URLs. Registration is kept in
 * the trusted main process; the protocol never accepts a path from a URL.
 */
export function createEmsMediaPathRegistry({
  accessToken = createEmsMediaAccessToken(),
  platform = process.platform,
} = {}) {
  const pathToId = new Map();
  const idToPath = new Map();

  const registerPath = (candidate) => {
    if (typeof candidate !== "string" || candidate.length === 0) return "";
    const filePath = nativePathFromEmsMediaPath(candidate, platform);
    if (!filePath || !EMS_MEDIA_VIDEO_EXTENSION_RE.test(filePath)) return "";
    let mediaId = pathToId.get(filePath);
    if (!mediaId) {
      do {
        mediaId = randomBytes(18).toString("base64url");
      } while (idToPath.has(mediaId));
      pathToId.set(filePath, mediaId);
      idToPath.set(mediaId, filePath);
    }
    const impl = platform === "win32" ? path.win32 : path.posix;
    return registeredMediaIdToEmsMediaUrl(mediaId, impl.basename(filePath), accessToken);
  };

  const pathForId = (mediaId) => idToPath.get(mediaId) || "";
  const pathForUrl = (url) => {
    const parsed = parseEmsMediaUrl(url);
    if (!parsed || parsed.token !== accessToken) return "";
    return pathForId(parsed.mediaId);
  };

  return Object.freeze({ accessToken, registerPath, pathForId, pathForUrl });
}

// ---------------------------------------------------------------------------
// HTTP-like helpers
// ---------------------------------------------------------------------------

/**
 * Interpret a `Range` request header against a resource of `size` bytes.
 * Multi-range and malformed headers are ignored (served as 200), which RFC
 * 9110 permits; Chromium's media stack only ever sends a single range.
 * @returns {{kind: "full"} | {kind: "partial", start: number, end: number} | {kind: "unsatisfiable"}}
 */
export function parseByteRange(header, size) {
  if (typeof header !== "string") return { kind: "full" };
  const value = header.trim();
  const match = value.match(/^bytes\s*=\s*(\d*)\s*-\s*(\d*)$/i);
  if (!match || value.includes(",")) return { kind: "full" };
  const [, firstText, lastText] = match;
  if (firstText === "" && lastText === "") return { kind: "full" };
  if (firstText === "") {
    const suffix = Number(lastText);
    if (!Number.isSafeInteger(suffix)) return { kind: "full" };
    if (suffix === 0 || size === 0) return { kind: "unsatisfiable" };
    return { kind: "partial", start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(firstText);
  const requestedEnd = lastText === "" ? Infinity : Number(lastText);
  if (!Number.isSafeInteger(start) || (lastText !== "" && !Number.isSafeInteger(requestedEnd))) return { kind: "full" };
  // A closed range whose last byte precedes its first is invalid, so ignored.
  if (requestedEnd < start) return { kind: "full" };
  if (start >= size) return { kind: "unsatisfiable" };
  return { kind: "partial", start, end: Math.min(requestedEnd, size - 1) };
}

/** Copy the part of `patch` (living at file offset `patchOffset`) that overlaps `chunk`. */
export function overlayPatch(chunk, chunkStart, chunkLength, patchOffset, patch) {
  if (!patch || patch.length === 0) return;
  const overlapStart = Math.max(chunkStart, patchOffset);
  const overlapEnd = Math.min(chunkStart + chunkLength, patchOffset + patch.length);
  if (overlapStart < overlapEnd) {
    patch.copy(chunk, overlapStart - chunkStart, overlapStart - patchOffset, overlapEnd - patchOffset);
  }
}

export function emsMediaContentType(filePath) {
  return /\.mov$/i.test(filePath) ? "video/quicktime" : "video/mp4";
}

/**
 * Stream `[start, end]` (inclusive) of `filePath`, overlaying the optional
 * patch. The file's size and mtime are re-checked when the stream opens; a
 * mismatch or an unexpected EOF errors the stream instead of mixing stale
 * patch metadata with new payload bytes.
 */
export function createFileRangeStream({
  filePath,
  start,
  end,
  expectedSize,
  expectedMtimeMs,
  expectedCtimeMs,
  expectedIno,
  expectedDev,
  patchOffset = 0,
  patch = null,
  chunkBytes = EMS_MEDIA_STREAM_CHUNK_BYTES,
}) {
  let fh = null;
  let position = start;
  let closed = false;
  const expectedIdentity = {
    size: expectedSize,
    mtimeMs: expectedMtimeMs,
    ctimeMs: expectedCtimeMs,
    ino: expectedIno,
    dev: expectedDev,
  };
  const identityMatches = (info) => {
    // Keep the helper independently useful in tests/callers that only provide
    // the historical size + mtime fields, while production supplies all five.
    if (expectedCtimeMs == null || expectedIno == null || expectedDev == null) {
      return info.size === expectedSize
        && (expectedMtimeMs == null || info.mtimeMs === expectedMtimeMs);
    }
    return fileIdentityMatches(info, expectedIdentity);
  };
  const closeHandle = async () => {
    if (closed) return;
    closed = true;
    const handle = fh;
    fh = null;
    if (handle) await handle.close().catch(() => {});
  };
  return new ReadableStream({
    async start() {
      fh = await open(filePath, "r");
      const info = await fh.stat();
      if (!identityMatches(info)) {
        await closeHandle();
        throw new Error(`ems-media: ${filePath} changed while it was being served`);
      }
    },
    async pull(controller) {
      try {
        if (position > end) {
          await closeHandle();
          controller.close();
          return;
        }
        const length = Math.min(chunkBytes, end - position + 1);
        const chunk = Buffer.allocUnsafe(length);
        let filled = 0;
        while (filled < length) {
          const { bytesRead } = await fh.read(chunk, filled, length - filled, position + filled);
          if (bytesRead === 0) break;
          filled += bytesRead;
        }
        if (filled === 0) throw new Error(`ems-media: unexpected end of ${filePath}`);
        // A chosen metadata patch must never be combined with bytes from an
        // in-place rewrite. Check the open file after every bounded read and
        // fail the response before enqueueing the changed chunk.
        if (patch && !identityMatches(await fh.stat())) {
          throw new Error(`ems-media: ${filePath} changed while it was being served`);
        }
        overlayPatch(chunk, position, filled, patchOffset, patch);
        position += filled;
        controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, filled));
      } catch (error) {
        await closeHandle();
        controller.error(error);
      }
    },
    async cancel() {
      await closeHandle();
    },
  }, { highWaterMark: 1 });
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

function textResponse(status, message, extraHeaders = {}) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders },
  });
}

/** Normalize a registered path to a native absolute path, or "". */
export function nativePathFromEmsMediaPath(localPath, platform = process.platform) {
  if (!localPath || localPath.includes("\0")) return "";
  const impl = platform === "win32" ? path.win32 : path.posix;
  if (platform !== "win32" && /^(?:[a-z]:\/|\/\/)/i.test(localPath)) return "";
  const native = impl.normalize(platform === "win32" ? localPath.replace(/\//g, "\\") : localPath);
  return impl.isAbsolute(native) ? native : "";
}

/**
 * Origins that may read ems-media responses: EMS's own file:// pages (whose
 * serialized origin is "null" or "file://") or requests without an Origin
 * (plain no-cors media loads).
 */
function isAllowedRequestOrigin(origin) {
  if (origin == null || origin === "") return true;
  return origin === "null" || origin === "file://";
}

/**
 * Create a `protocol.handle` callback for the ems-media scheme.
 * @param {{
 *   accessToken: string,
 *   pathForMediaId: (mediaId: string) => string,
 *   analyze?: typeof analyzeMp4SyncSamples,
 *   logger?: Pick<Console, "info" | "warn">,
 *   platform?: string,
 * }} options
 */
export function createEmsMediaProtocolHandler({
  accessToken,
  pathForMediaId,
  analyze = analyzeMp4SyncSamples,
  logger = console,
  platform = process.platform,
} = {}) {
  const reportedRepairs = new Set();
  return async function handleEmsMediaRequest(request) {
    const method = request.method || "GET";
    if (method !== "GET" && method !== "HEAD") {
      return textResponse(405, "Method not allowed", { Allow: "GET, HEAD" });
    }
    const parsed = parseEmsMediaUrl(request.url);
    if (!parsed || parsed.token !== accessToken) return textResponse(403, "Forbidden");
    const origin = request.headers.get("origin");
    if (!isAllowedRequestOrigin(origin)) return textResponse(403, "Forbidden");
    const registeredPath = typeof pathForMediaId === "function" ? pathForMediaId(parsed.mediaId) : "";
    const filePath = nativePathFromEmsMediaPath(registeredPath, platform);
    if (!filePath || !EMS_MEDIA_VIDEO_EXTENSION_RE.test(filePath)) return textResponse(404, "Not found");

    let info;
    try {
      info = await statPath(filePath);
    } catch {
      return textResponse(404, "Not found");
    }
    if (!info.isFile()) return textResponse(404, "Not found");

    const analysis = await analyze(filePath, info, {
      onError: (error) => logger?.warn?.(`ems-media: could not analyse ${filePath}; serving it unmodified:`, error?.message || error),
    });
    const patch = analysis && fileIdentityMatches(info, analysis) ? analysis : null;
    if (patch && !reportedRepairs.has(filePath)) {
      reportedRepairs.add(filePath);
      logger?.info?.(
        `ems-media: limiting seek points of ${filePath} to real IDR frames (${patch.originalSyncCount} -> ${patch.idrSyncCount} sync samples)`,
      );
    }

    const size = info.size;
    const range = parseByteRange(request.headers.get("range"), size);
    const headers = {
      "Content-Type": emsMediaContentType(filePath),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
      ETag: `"${size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}-${patch ? "p" : "o"}"`,
      "Last-Modified": new Date(info.mtimeMs).toUTCString(),
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range",
      "Cross-Origin-Resource-Policy": "cross-origin",
      Vary: "Origin",
    };
    if (range.kind === "unsatisfiable") {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }
    const start = range.kind === "partial" ? range.start : 0;
    const end = range.kind === "partial" ? range.end : size - 1;
    const status = range.kind === "partial" ? 206 : 200;
    headers["Content-Length"] = String(Math.max(0, end - start + 1));
    if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    if (method === "HEAD" || size === 0) {
      return new Response(null, { status, headers });
    }
    const body = createFileRangeStream({
      filePath,
      start,
      end,
      expectedSize: size,
      expectedMtimeMs: info.mtimeMs,
      expectedCtimeMs: info.ctimeMs,
      expectedIno: info.ino,
      expectedDev: info.dev,
      patchOffset: patch?.stssOffset ?? 0,
      patch: patch?.patchBytes ?? null,
    });
    return new Response(body, { status, headers });
  };
}

/** Register the handler on `targetSession` once. */
export async function installEmsMediaProtocol(targetSession, handler) {
  const sessionProtocol = targetSession?.protocol;
  if (!sessionProtocol) return false;
  if (typeof sessionProtocol.isProtocolHandled === "function" && sessionProtocol.isProtocolHandled(EMS_MEDIA_SCHEME)) {
    return false;
  }
  await sessionProtocol.handle(EMS_MEDIA_SCHEME, handler);
  return true;
}
