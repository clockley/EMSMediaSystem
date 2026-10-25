import assert from "node:assert/strict";
import test from "node:test";

import {
  configureMediaFileHasher,
  hashMediaFile,
} from "../src/shared/media-file-hash.mjs";

test("configured media hasher normalizes and validates sidecar digests", async () => {
  configureMediaFileHasher(async (filePath) => {
    assert.equal(filePath, "/tmp/media.mp4");
    return "9555E8555C62DCFD";
  });

  assert.equal(await hashMediaFile("/tmp/media.mp4"), "9555e8555c62dcfd");

  configureMediaFileHasher(async () => "not-a-hash");
  await assert.rejects(
    hashMediaFile("/tmp/media.mp4"),
    /invalid XXH3-64 digest/,
  );
});
