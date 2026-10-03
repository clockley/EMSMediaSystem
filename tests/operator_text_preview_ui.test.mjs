import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [templates, bibleWorkspace, songWorkspace, css] = await Promise.all([
  readFile(new URL("../src/shared/app-ui-templates.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/control-window/app-bible-workspace.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/control-window/app-song-slides-workspace.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/main.css", import.meta.url), "utf8"),
]);

test("Bible chapter map exposes complete text, cue, take-live, drag, and live states", () => {
  assert.match(templates, /Click to cue · Double-click to show live · Drag to schedule/);
  assert.match(bibleWorkspace, /className = "bible-verse-live-badge"/);
  assert.match(bibleWorkspace, /row\.classList\.toggle\("is-live", isLive\)/);
  assert.match(css, /\.bible-verse-row-text\s*\{[^}]*white-space: normal/s);
  assert.doesNotMatch(css, /\.bible-verse-row-text\s*\{[^}]*text-overflow: ellipsis/s);
  assert.match(css, /\.bible-verse-live-badge/);
});

test("single lower-third cues suppress duplicate lists and navigation", () => {
  assert.match(bibleWorkspace, /cueList\.hidden = segmentCount <= 1/);
  assert.match(songWorkspace, /list\.hidden = count <= 1/);
  assert.match(bibleWorkspace, /prevButton\.hidden = segmentCount <= 1/);
  assert.match(songWorkspace, /prev\.hidden = count <= 1/);
});

test("operator previews and schedule rows have distinct Live and Cued treatments", () => {
  assert.match(css, /lower-third-preview\[data-lower-third-preview-mode="key"\]/);
  assert.match(css, /\.bible-preview-surface--audience\.is-operator-live/);
  assert.match(css, /\.songs-preview-slide\.is-operator-cued/);
  assert.match(css, /\.queue-item\.is-live\.is-selected/);
  assert.match(css, /box-shadow: inset 4px 0 var\(--destructive-bg-color\)/);
});
