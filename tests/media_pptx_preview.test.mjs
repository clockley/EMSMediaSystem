import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`\nfunction ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} should exist`);
  return source.slice(start, end);
}

test("PowerPoint preview uses one slide with previous and next controls", async () => {
  const source = await readFile(new URL("../src/control-window/app-preview-controller.mjs", import.meta.url), "utf8");
  const shell = functionSource(source, "ensurePptxPreviewShell", "updatePptxNavigatorSelection");
  assert.match(shell, /data-pptx-step="previous"/);
  assert.match(shell, /data-pptx-step="next"/);
  assert.match(shell, /pptxSlidePosition/);
  assert.doesNotMatch(shell, /pptxThumbnailList|pptxSlideNavigator/);
});

test("Media presentation details render PPTX slides without a thumbnail strip", async () => {
  const source = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const loader = source.slice(source.indexOf("async function loadPresentationPreview("), source.indexOf("\nfunction showDetails("));
  assert.match(loader, /PptxViewer/);
  assert.match(loader, /renderPresentationSlide/);
  assert.match(loader, /Previous slide/);
  assert.match(loader, /Next slide/);
  assert.doesNotMatch(loader, /thumbnail/i);
});
