import assert from "node:assert/strict";
import test from "node:test";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { SongsRpcClient } from "../src/main-process/songs_rpc_client.mjs";
import { MediaLibraryRpcClient, mediaLibraryBinaryName } from "../src/main-process/media-library-rpc-client.mjs";

test("media library sidecar names are platform-specific", () => {
  assert.equal(mediaLibraryBinaryName("linux", "x64"), "media-library-rpc-linux-x64");
  assert.equal(mediaLibraryBinaryName("win32", "x64"), "media-library-rpc-win32-x64.exe");
  assert.throws(() => mediaLibraryBinaryName("darwin", "x64"), /Unsupported/);
});

for (const Client of [SongsRpcClient, MediaLibraryRpcClient]) {
  test(`${Client.name} preserves multibyte characters split across stdout chunks`, async t => {
    const root = await mkdtemp(path.join(tmpdir(), "ems-rpc-chunks-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null,
    });
    const spawn = t.mock.method(childProcess, "spawn", () => {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    syncBuiltinESMExports();
    t.after(() => { spawn.mock.restore(); syncBuiltinESMExports(); });
    const client = new Client({ app: { getPath: () => root }, devRoot: root });
    client.binaryPath = () => process.execPath;
    await client.ensureStarted();
    const reply = client.request("test", [], 1000);
    const title = "Música 🎵";
    const frame = Buffer.from(JSON.stringify({ id: 1, result: title }) + "\n");
    for (const byte of frame) child.stdout.write(Buffer.of(byte));
    assert.equal(await reply, title);
  });
}
