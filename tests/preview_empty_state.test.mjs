import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const previewSurfaces = await readFile(
  new URL("../src/control-window/app-preview-surfaces.mjs", import.meta.url),
  "utf8",
);

function updatePreviewEmptyStateSource() {
  const start = previewSurfaces.indexOf("function updatePreviewEmptyState()");
  const end = previewSurfaces.indexOf(
    "\nfunction installPreviewEmptyStateHandlers()",
    start,
  );
  assert.ok(start >= 0, "updatePreviewEmptyState should exist");
  assert.ok(end > start, "updatePreviewEmptyState should have a function boundary");
  return previewSurfaces.slice(start, end);
}

function runEmptyStateUpdate({
  visibleWorkspaceId = null,
  mediaLibraryVisible = false,
  mode = 0,
  queue = [],
  previewSource = "",
  previewPoster = "",
  hasImage = false,
  pptxVisible = false,
} = {}) {
  const overlay = { hidden: true };
  const elements = new Map([
    ["previewEmptyState", overlay],
    ["mediaLibraryWorkspace", { hidden: !mediaLibraryVisible }],
    [
      "preview",
      {
        matches: (selector) => selector === "video",
        getAttribute: (name) =>
          name === "src" ? previewSource : name === "poster" ? previewPoster : "",
      },
    ],
    ["bibleWorkspace", { hidden: visibleWorkspaceId !== "bibleWorkspace" }],
    ["songsWorkspace", { hidden: visibleWorkspaceId !== "songsWorkspace" }],
    ["slidesWorkspace", { hidden: visibleWorkspaceId !== "slidesWorkspace" }],
  ]);
  const context = vm.createContext({
    document: {
      getElementById: (id) => elements.get(id) || null,
      querySelector: (selector) =>
        hasImage && selector === ".video-wrapper img#preview" ? {} : null,
    },
    currentMode: mode,
    MEDIAPLAYER: 0,
    mediaQueue: queue,
    isPptxPreviewVisible: () => pptxVisible,
  });
  vm.runInContext(updatePreviewEmptyStateSource(), context);
  vm.runInContext("updatePreviewEmptyState()", context);
  return overlay.hidden;
}

test("media empty state is shown on a genuinely empty media preview", () => {
  assert.equal(runEmptyStateUpdate(), false);
});

for (const workspaceId of [
  "bibleWorkspace",
  "songsWorkspace",
  "slidesWorkspace",
]) {
  test(`media empty state stays hidden over ${workspaceId}`, () => {
    assert.equal(runEmptyStateUpdate({ visibleWorkspaceId: workspaceId }), true);
  });
}

for (const [scenario, options] of [
  ["a populated schedule", { queue: [{}] }],
  ["a loaded video", { previewSource: "ems-media://token/video.mp4" }],
  ["a video poster", { previewPoster: "file:///tmp/poster.jpg" }],
  ["a loaded image", { hasImage: true }],
  ["a PowerPoint preview", { pptxVisible: true }],
  ["the media library", { mediaLibraryVisible: true }],
  ["a non-media operating mode", { mode: 1 }],
]) {
  test(`media empty state stays hidden for ${scenario}`, () => {
    assert.equal(runEmptyStateUpdate(options), true);
  });
}
