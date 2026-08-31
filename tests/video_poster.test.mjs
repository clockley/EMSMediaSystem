import assert from "node:assert/strict";
import test from "node:test";

import {
  generateVideoPoster,
  videoPosterSidecar,
} from "../src/main-process/video-poster.mjs";

test("video poster is disabled without spawning a sidecar on unsupported platforms", async () => {
  const result = await generateVideoPoster("/tmp/example.mp4", {
    platform: "darwin",
  });
  assert.deepEqual(result, { ok: false, code: "unsupported_platform" });
});

test("development poster backends resolve under the project bin directory", () => {
  assert.deepEqual(
    videoPosterSidecar({ app: { isPackaged: false }, devRoot: "/workspace", platform: "linux" }),
    {
      command: "gjs",
      args: ["/workspace/bin/gnome-video-poster.js"],
      artifact: "/workspace/bin/gnome-video-poster.js",
    },
  );
  assert.deepEqual(
    videoPosterSidecar({ app: { isPackaged: false }, devRoot: "C:\\workspace", platform: "win32" }),
    {
      command: "C:\\workspace/bin/video-poster-win32-x64.exe",
      args: [],
      artifact: "C:\\workspace/bin/video-poster-win32-x64.exe",
    },
  );
});
