import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleSource = readFileSync(
  path.join(root, "src/control-window/app-background-audio.mjs"),
  "utf8",
);
const indexHtml = readFileSync(path.join(root, "src/control-window/index.html"), "utf8");
const mainCss = readFileSync(path.join(root, "src/main.css"), "utf8");
const mainSource = readFileSync(path.join(root, "src/main-process/main.mjs"), "utf8");
const rendererSource = readFileSync(
  path.join(root, "src/control-window/app-renderer.mjs"),
  "utf8",
);

/** Extract the pure-helper block and evaluate it in an isolated context. */
function pureHelpers() {
  const start = moduleSource.indexOf("const clampBackgroundVolume");
  const end = moduleSource.indexOf("const backgroundAudioIsLoaded");
  assert.ok(start >= 0 && end > start, "pure helper block present in source order");
  const snippet = moduleSource.slice(start, end);
  const context = { DEFAULT_BACKGROUND_AUDIO_VOLUME: 0.4 };
  vm.createContext(context);
  vm.runInContext(
    `${snippet}; __exports = { clampBackgroundVolume, backgroundTrackNameFromPath, formatBackgroundTrackTime, backgroundTrackTimeText };`,
    context,
  );
  return context.__exports;
}

test("clampBackgroundVolume bounds values and defaults non-finite input", () => {
  const { clampBackgroundVolume } = pureHelpers();
  assert.equal(clampBackgroundVolume(0.5), 0.5);
  assert.equal(clampBackgroundVolume(-1), 0);
  assert.equal(clampBackgroundVolume(2), 1);
  assert.equal(clampBackgroundVolume(Number.NaN), 0.4);
  assert.equal(clampBackgroundVolume(undefined), 0.4);
});

test("backgroundTrackNameFromPath handles POSIX, Windows, and bare names", () => {
  const { backgroundTrackNameFromPath } = pureHelpers();
  assert.equal(backgroundTrackNameFromPath("/music/worship/intro.mp3"), "intro.mp3");
  assert.equal(backgroundTrackNameFromPath("C:\\Music\\pad.flac"), "pad.flac");
  assert.equal(backgroundTrackNameFromPath("song.ogg"), "song.ogg");
  assert.equal(backgroundTrackNameFromPath("/trailing/dir/"), "dir");
  assert.equal(backgroundTrackNameFromPath(null), "");
});

test("formatBackgroundTrackTime renders m:ss and tolerates bad input", () => {
  const { formatBackgroundTrackTime } = pureHelpers();
  assert.equal(formatBackgroundTrackTime(0), "0:00");
  assert.equal(formatBackgroundTrackTime(61.9), "1:01");
  assert.equal(formatBackgroundTrackTime(600), "10:00");
  assert.equal(formatBackgroundTrackTime(Number.NaN), "0:00");
  assert.equal(formatBackgroundTrackTime(-5), "0:00");
});

test("backgroundTrackTimeText resets to zero while a new source is loading", () => {
  const { backgroundTrackTimeText } = pureHelpers();
  const staleAudio = { currentTime: 95.4, duration: 180 };
  // Pending load: never trust the element's (previous track's) position.
  assert.equal(backgroundTrackTimeText(staleAudio, true), "0:00 / 0:00");
  assert.equal(backgroundTrackTimeText(null, false), "0:00 / 0:00");
  assert.equal(backgroundTrackTimeText(staleAudio, false), "1:35 / 3:00");
  assert.equal(
    backgroundTrackTimeText({ currentTime: 0, duration: Number.NaN }, false),
    "0:00 / 0:00",
  );
});

test("load/clear/error flows guard against stale async completions", () => {
  // Stale play() completions must not render or toast over a newer load.
  assert.match(moduleSource, /if \(token !== backgroundAudioState\.loadToken\) return;/);
  // Interrupted play() promises are operator intent, not errors.
  const interruptGuards = moduleSource.match(/isPlayInterruptedError\(err\)/g) ?? [];
  assert.ok(interruptGuards.length >= 2, "play() interruption guarded in load and toggle");
  // A stale error event from an aborted source cannot clear the newer track.
  assert.match(moduleSource, /if \(!backgroundAudioState\.sourcePath \|\| !audio\.error\) return;/);
  // Native file pickers are serialized so results cannot race each other.
  assert.match(moduleSource, /if \(backgroundAudioState\.chooseDialogOpen\) return;/);
  assert.match(moduleSource, /finally \{\n    backgroundAudioState\.chooseDialogOpen = false;/);
  // New loads mark the time display as loading until metadata arrives.
  assert.match(moduleSource, /backgroundAudioState\.trackLoading = true;\n  audio\.src = pathToMediaUrl\(filePath\);/);
  assert.match(moduleSource, /audio\.addEventListener\("loadedmetadata", \(\) => \{\n    backgroundAudioState\.trackLoading = false;/);
});

test("module keeps the functional update-then-render contract", () => {
  assert.match(moduleSource, /function renderBackgroundAudioUi\(\)/);
  assert.match(moduleSource, /function installBackgroundAudioControls\(\)/);
  assert.match(moduleSource, /localStorage\?\.setItem\(BACKGROUND_AUDIO_VOLUME_KEY/);
  assert.match(moduleSource, /audio\.loop = readStoredBackgroundLoop\(\)/);
  // Stale async loads must be ignored after a replace/clear.
  assert.match(moduleSource, /if \(token !== backgroundAudioState\.loadToken\) return;/);
});

test("headerbar markup exposes the soundtrack button and popover controls", () => {
  for (const id of [
    "backgroundAudioButton",
    "backgroundAudioPopover",
    "bgAudioEmptyState",
    "bgAudioLoadedState",
    "bgAudioChooseBtn",
    "bgAudioPlayPauseBtn",
    "bgAudioVolumeSlider",
    "bgAudioLoopSwitch",
    "bgAudioReplaceBtn",
    "bgAudioClearBtn",
  ]) {
    assert.match(indexHtml, new RegExp(`id="${id}"`), `${id} present`);
  }
  assert.match(indexHtml, /role="dialog" aria-label="Background audio"/);
});

test("popover styling uses Adwaita variables", () => {
  assert.match(mainCss, /\.bg-audio-popover \{/);
  assert.match(mainCss, /\.bg-audio-popover[^}]*var\(--popover-bg-color\)/s);
  assert.match(mainCss, /\.bg-audio-suggested[^}]*var\(--accent-bg-color\)/s);
  assert.match(mainCss, /\.bg-audio-flat--destructive[^}]*var\(--destructive-bg-color\)/s);
  assert.match(mainCss, /prefers-reduced-motion/);
});

test("main.css has no self-referential custom property cycles", () => {
  // --x: var(--x) is invalid at computed-value time and silently breaks every
  // var(--x) consumer (this once flattened the popover's rounded corners).
  const cycles = mainCss.match(/(--[a-z0-9-]+):\s*var\(\1[,)]/g) ?? [];
  assert.deepEqual(cycles, []);
});

test("main process registers an audio-only picker dialog", () => {
  assert.match(mainSource, /ipcMain\.handle\("show-background-audio-dialog", handleShowBackgroundAudioDialog\)/);
  assert.match(mainSource, /async function handleShowBackgroundAudioDialog\(event\)/);
  const handler = mainSource.slice(
    mainSource.indexOf("async function handleShowBackgroundAudioDialog"),
    mainSource.indexOf("async function handleShowMediaSourceDialog"),
  );
  assert.match(handler, /properties: \["openFile"\]/, "single-file selection");
  assert.match(handler, /"mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus"/);
  assert.doesNotMatch(handler, /"mp4"|"pptx"/, "no video or deck formats offered");
});

test("renderer bootstrap installs the background audio controls", () => {
  assert.match(rendererSource, /from "\.\/app-background-audio\.mjs"/);
  assert.match(rendererSource, /installEvents\(\);\n  installBackgroundAudioControls\(\);/);
});
