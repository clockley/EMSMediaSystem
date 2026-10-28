import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EMS_MEDIA_SCHEME_PRIVILEGES,
  createEmsMediaAccessToken,
  createEmsMediaPathRegistry,
  createEmsMediaProtocolHandler,
  createFileRangeStream,
  emsMediaContentType,
  installEmsMediaProtocol,
  nativePathFromEmsMediaPath,
  overlayPatch,
  parseByteRange,
  registerEmsMediaSchemePrivileges,
} from "../src/main-process/media-protocol.mjs";
import { analyzeMp4SyncSamples, clearMp4SyncAnalysisCache } from "../src/main-process/mp4-sync-fix.mjs";
import { isValidEmsMediaAccessToken, registeredMediaIdToEmsMediaUrl } from "../src/shared/ems-media-url.mjs";
import { applyPatch, buildMp4 } from "./fixtures/synthetic-mp4.mjs";

const MIXED_KINDS = ["idr", "p", "p", "i", "p", "p", "idr", "p", "i", "p", "i", "p"];

let tmpDir;
let clipPath;
let clipBytes;
let expectedBytes;
let patchInfo;

test.before(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "ems-media-protocol-"));
  clipBytes = buildMp4({ kinds: MIXED_KINDS });
  clipPath = path.join(tmpDir, "my clip #1.mp4");
  await writeFile(clipPath, clipBytes);
  patchInfo = await analyzeMp4SyncSamples(clipPath, await stat(clipPath));
  assert.ok(patchInfo, "fixture must need a repair");
  expectedBytes = applyPatch(clipBytes, patchInfo.stssOffset, patchInfo.patchBytes);
  await writeFile(path.join(tmpDir, "notes.txt"), "hello");
});
test.after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  clearMp4SyncAnalysisCache();
});

const TOKEN = createEmsMediaAccessToken();
const mediaRegistry = createEmsMediaPathRegistry({ accessToken: TOKEN });

function registeredUrl(filePath) {
  return mediaRegistry.registerPath(filePath);
}

function protocolHandler(options = {}) {
  return createEmsMediaProtocolHandler({
    accessToken: TOKEN,
    pathForMediaId: mediaRegistry.pathForId,
    ...options,
  });
}

function silentLogger() {
  const lines = { info: [], warn: [] };
  return {
    lines,
    info: (...args) => lines.info.push(args.join(" ")),
    warn: (...args) => lines.warn.push(args.join(" ")),
  };
}

function request(url, { method = "GET", headers = {} } = {}) {
  return { method, url, headers: new Headers(headers) };
}

async function bodyBytes(response) {
  return Buffer.from(await response.arrayBuffer());
}

test("access tokens are valid URL hosts and unique", () => {
  const a = createEmsMediaAccessToken();
  const b = createEmsMediaAccessToken();
  assert.ok(isValidEmsMediaAccessToken(a));
  assert.notEqual(a, b);
});

test("path registry returns stable opaque URLs and rejects unsupported paths", () => {
  const url = registeredUrl(clipPath);
  assert.equal(registeredUrl(clipPath), url);
  assert.ok(url.startsWith(`ems-media://${TOKEN}/`));
  assert.equal(url.includes(clipPath), false);
  assert.equal(mediaRegistry.pathForUrl(url), clipPath);
  assert.equal(mediaRegistry.registerPath(path.join(tmpDir, "notes.txt")), "");
  assert.equal(mediaRegistry.registerPath("relative.mp4"), "");
});

test("scheme privileges allow streaming + CORS and are registered once", () => {
  assert.equal(EMS_MEDIA_SCHEME_PRIVILEGES.stream, true);
  assert.equal(EMS_MEDIA_SCHEME_PRIVILEGES.corsEnabled, true);
  assert.equal(EMS_MEDIA_SCHEME_PRIVILEGES.standard, true);
  const calls = [];
  registerEmsMediaSchemePrivileges({ registerSchemesAsPrivileged: (schemes) => calls.push(schemes) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].scheme, "ems-media");
});

test("installEmsMediaProtocol registers each session once", async () => {
  const handled = new Set();
  const fakeSession = {
    protocol: {
      isProtocolHandled: (scheme) => handled.has(scheme),
      handle: (scheme) => handled.add(scheme),
    },
  };
  const handler = () => {};
  assert.equal(await installEmsMediaProtocol(fakeSession, handler), true);
  assert.equal(await installEmsMediaProtocol(fakeSession, handler), false);
  assert.equal(await installEmsMediaProtocol(null, handler), false);
});

test("parseByteRange covers open, closed, suffix, invalid and unsatisfiable ranges", () => {
  assert.deepEqual(parseByteRange(undefined, 100), { kind: "full" });
  assert.deepEqual(parseByteRange(null, 100), { kind: "full" });
  assert.deepEqual(parseByteRange("bytes=0-", 100), { kind: "partial", start: 0, end: 99 });
  assert.deepEqual(parseByteRange("bytes=10-19", 100), { kind: "partial", start: 10, end: 19 });
  assert.deepEqual(parseByteRange("bytes=90-500", 100), { kind: "partial", start: 90, end: 99 });
  assert.deepEqual(parseByteRange("bytes=-10", 100), { kind: "partial", start: 90, end: 99 });
  assert.deepEqual(parseByteRange("bytes=-500", 100), { kind: "partial", start: 0, end: 99 });
  assert.deepEqual(parseByteRange("BYTES = 5 - 6", 100), { kind: "partial", start: 5, end: 6 });
  assert.deepEqual(parseByteRange("bytes=100-", 100), { kind: "unsatisfiable" });
  assert.deepEqual(parseByteRange("bytes=-0", 100), { kind: "unsatisfiable" });
  assert.deepEqual(parseByteRange("bytes=0-", 0), { kind: "unsatisfiable" });
  // Ignored (served as 200): multipart, reversed, malformed, other units.
  assert.deepEqual(parseByteRange("bytes=0-1,5-6", 100), { kind: "full" });
  assert.deepEqual(parseByteRange("bytes=20-10", 100), { kind: "full" });
  assert.deepEqual(parseByteRange("bytes=abc", 100), { kind: "full" });
  assert.deepEqual(parseByteRange("items=0-1", 100), { kind: "full" });
  assert.deepEqual(parseByteRange("bytes=-", 100), { kind: "full" });
});

test("overlayPatch copies only the overlapping part of the patch", () => {
  const patch = Buffer.from("PATCH");
  const cases = [
    // [chunkStart, chunkLength, expected chunk]
    [0, 10, "..PATCH..."],
    [3, 4, "ATCH"],
    [5, 5, "CH..."],
    [0, 3, "..P"],
    [7, 3, "..."],
  ];
  for (const [chunkStart, chunkLength, expected] of cases) {
    const chunk = Buffer.alloc(chunkLength, ".");
    overlayPatch(chunk, chunkStart, chunkLength, 2, patch);
    assert.equal(chunk.toString(), expected, `chunk at ${chunkStart}`);
  }
  const untouched = Buffer.alloc(4, ".");
  overlayPatch(untouched, 0, 4, 0, null);
  assert.equal(untouched.toString(), "....");
});

test("createFileRangeStream overlays the patch across chunk boundaries", async () => {
  const info = await stat(clipPath);
  for (const chunkBytes of [7, 64, 1 << 20]) {
    const stream = createFileRangeStream({
      filePath: clipPath,
      start: 0,
      end: info.size - 1,
      expectedSize: info.size,
      expectedMtimeMs: info.mtimeMs,
      patchOffset: patchInfo.stssOffset,
      patch: patchInfo.patchBytes,
      chunkBytes,
    });
    assert.deepEqual(await bodyBytes(new Response(stream)), expectedBytes, `chunkBytes=${chunkBytes}`);
  }
});

test("createFileRangeStream refuses to mix a changed file with stale patch metadata", async () => {
  const info = await stat(clipPath);
  const resized = createFileRangeStream({
    filePath: clipPath, start: 0, end: 10, expectedSize: info.size + 1, expectedMtimeMs: info.mtimeMs,
  });
  await assert.rejects(new Response(resized).arrayBuffer(), /changed while it was being served/);
  const touched = createFileRangeStream({
    filePath: clipPath, start: 0, end: 10, expectedSize: info.size, expectedMtimeMs: info.mtimeMs - 5000,
  });
  await assert.rejects(new Response(touched).arrayBuffer(), /changed while it was being served/);
});

test("content type follows the container", () => {
  assert.equal(emsMediaContentType("/a/b.MOV"), "video/quicktime");
  assert.equal(emsMediaContentType("/a/b.mp4"), "video/mp4");
  assert.equal(emsMediaContentType("/a/b.m4v"), "video/mp4");
});

test("nativePathFromEmsMediaPath maps URL paths per platform", () => {
  assert.equal(nativePathFromEmsMediaPath("/home/me/a.mp4", "linux"), "/home/me/a.mp4");
  assert.equal(nativePathFromEmsMediaPath("/home/me/../me/a.mp4", "linux"), "/home/me/a.mp4");
  assert.equal(nativePathFromEmsMediaPath("C:/Users/me/a.mp4", "linux"), "");
  assert.equal(nativePathFromEmsMediaPath("//server/share/a.mp4", "darwin"), "");
  assert.equal(nativePathFromEmsMediaPath("C:/Users/me/a.mp4", "win32"), "C:\\Users\\me\\a.mp4");
  assert.equal(nativePathFromEmsMediaPath("//server/share/a.mp4", "win32"), "\\\\server\\share\\a.mp4");
  assert.equal(nativePathFromEmsMediaPath("relative/a.mp4", "win32"), "");
  assert.equal(nativePathFromEmsMediaPath("", "linux"), "");
});

test("handler serves the repaired bytes with 200 / 206 / HEAD / 416", async () => {
  const logger = silentLogger();
  const handle = protocolHandler({ logger });
  const url = registeredUrl(clipPath);
  const size = clipBytes.length;

  const full = await handle(request(url));
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "video/mp4");
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(full.headers.get("content-length"), String(size));
  assert.equal(full.headers.get("cross-origin-resource-policy"), "cross-origin");
  assert.match(full.headers.get("etag"), /-p"$/);
  assert.deepEqual(await bodyBytes(full), expectedBytes);
  assert.deepEqual(await readFile(clipPath), clipBytes, "virtual patch must not modify the source file");

  // A range that straddles the start of the patched stss box.
  const start = patchInfo.stssOffset - 3;
  const end = patchInfo.stssOffset + 9;
  const partial = await handle(request(url, { headers: { Range: `bytes=${start}-${end}` } }));
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), `bytes ${start}-${end}/${size}`);
  assert.equal(partial.headers.get("content-length"), String(end - start + 1));
  assert.deepEqual(await bodyBytes(partial), expectedBytes.subarray(start, end + 1));

  const suffix = await handle(request(url, { headers: { Range: "bytes=-16" } }));
  assert.equal(suffix.status, 206);
  assert.deepEqual(await bodyBytes(suffix), expectedBytes.subarray(size - 16));

  const head = await handle(request(url, { method: "HEAD", headers: { Range: "bytes=0-99" } }));
  assert.equal(head.status, 206);
  assert.equal(head.headers.get("content-length"), "100");
  assert.equal(head.body, null);

  const unsatisfiable = await handle(request(url, { headers: { Range: `bytes=${size}-` } }));
  assert.equal(unsatisfiable.status, 416);
  assert.equal(unsatisfiable.headers.get("content-range"), `bytes */${size}`);

  // The repair is logged once per file, not once per range request.
  assert.equal(logger.lines.info.length, 1);
  assert.match(logger.lines.info[0], /5 -> 2 sync samples/);
});

test("overlapping concurrent ranges all see the same virtual patch", async () => {
  const handle = protocolHandler({ logger: silentLogger() });
  const url = registeredUrl(clipPath);
  const windows = [
    [0, 63],
    [patchInfo.stssOffset - 8, patchInfo.stssOffset + 31],
    [patchInfo.stssOffset, patchInfo.stssOffset + patchInfo.patchBytes.length - 1],
    [clipBytes.length - 32, clipBytes.length - 1],
  ];
  const responses = await Promise.all(
    windows.map(([start, end]) => handle(request(url, { headers: { Range: `bytes=${start}-${end}` } }))),
  );
  const bodies = await Promise.all(responses.map(bodyBytes));
  for (let i = 0; i < windows.length; i++) {
    const [start, end] = windows[i];
    assert.equal(responses[i].status, 206);
    assert.deepEqual(bodies[i], expectedBytes.subarray(start, end + 1));
  }
});

test("handler serves files that need no repair byte-for-byte", async () => {
  const cleanPath = path.join(tmpDir, "clean.mov");
  const clean = buildMp4({ kinds: ["idr", "p", "idr", "p"] });
  await writeFile(cleanPath, clean);
  const handle = protocolHandler({ logger: silentLogger() });
  const response = await handle(request(registeredUrl(cleanPath)));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "video/quicktime");
  assert.match(response.headers.get("etag"), /-o"$/);
  assert.deepEqual(await bodyBytes(response), clean);
});

test("analysis failures fail open to the original bytes", async () => {
  const logger = silentLogger();
  const handle = protocolHandler({
    logger,
    analyze: async (_filePath, _info, { onError }) => {
      onError(new Error("boom"));
      return null;
    },
  });
  const response = await handle(request(registeredUrl(clipPath)));
  assert.equal(response.status, 200);
  assert.deepEqual(await bodyBytes(response), clipBytes);
  assert.equal(logger.lines.warn.length, 1);
});

test("a patch computed for a different file identity is never applied", async (t) => {
  for (const [name, changed] of [
    ["size", { fileSize: patchInfo.fileSize + 1 }],
    ["mtime", { mtimeMs: patchInfo.mtimeMs + 1 }],
    ["ctime", { ctimeMs: patchInfo.ctimeMs + 1 }],
    ["inode", { ino: patchInfo.ino + 1 }],
    ["device", { dev: patchInfo.dev + 1 }],
  ]) {
    await t.test(name, async () => {
      const handle = protocolHandler({
        logger: silentLogger(),
        analyze: async () => ({ ...patchInfo, ...changed }),
      });
      const response = await handle(request(registeredUrl(clipPath)));
      assert.deepEqual(await bodyBytes(response), clipBytes);
    });
  }
});

test("handler rejects bad tokens, foreign origins, methods and non-video paths", async () => {
  const handle = protocolHandler({ logger: silentLogger() });
  const url = registeredUrl(clipPath);

  const otherToken = createEmsMediaAccessToken();
  const otherRegistry = createEmsMediaPathRegistry({ accessToken: otherToken });
  assert.equal((await handle(request(otherRegistry.registerPath(clipPath)))).status, 403);
  assert.equal((await handle(request(`ems-media://${TOKEN}`))).status, 403);
  assert.equal((await handle(request(url, { headers: { Origin: "https://evil.example" } }))).status, 403);
  assert.equal((await handle(request(url, { method: "POST" }))).status, 405);
  const unknown = registeredMediaIdToEmsMediaUrl("unknown_media_id_1234", "notes.txt", TOKEN);
  assert.equal((await handle(request(unknown))).status, 404);
  assert.equal((await handle(request(registeredUrl(path.join(tmpDir, "missing.mp4"))))).status, 404);
  assert.equal((await handle(request(registeredUrl(tmpDir + ".mp4")))).status, 404);

  // EMS's own file:// pages (opaque "null" origin or file://) are allowed and
  // get the CORS approval Web Audio / captureStream need.
  for (const origin of ["null", "file://"]) {
    const response = await handle(request(url, { headers: { Origin: origin, Range: "bytes=0-7" } }));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    await response.arrayBuffer();
  }
});
