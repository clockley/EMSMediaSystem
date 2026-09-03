import assert from "node:assert/strict";
import test from "node:test";
import { mediaLibraryBinaryName } from "../src/main-process/media-library-rpc-client.mjs";

test("media library sidecar names are platform-specific", () => {
  assert.equal(mediaLibraryBinaryName("linux", "x64"), "media-library-rpc-linux-x64");
  assert.equal(mediaLibraryBinaryName("win32", "x64"), "media-library-rpc-win32-x64.exe");
  assert.throws(() => mediaLibraryBinaryName("darwin", "x64"), /Unsupported/);
});
