import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, renderer, preload, main, css, liveOutputs, scheduleController, confidenceMonitor, mediaWindow] = await Promise.all([
  readFile(new URL("../src/stage-window/stage.html", import.meta.url), "utf8"),
  readFile(new URL("../src/stage-window/stage.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/stage-window/stage_preload.js", import.meta.url), "utf8"),
  readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/main.css", import.meta.url), "utf8"),
  readFile(new URL("../src/control-window/app-live-outputs.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/control-window/app-schedule-controller.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/control-window/app-confidence-monitor.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/media-window/media.mjs", import.meta.url), "utf8"),
]);

test("stage current card hosts a contained audience video with a text fallback", () => {
  assert.match(html, /<video id="stageAudiencePreview"[^>]*\bmuted\b[^>]*hidden><\/video>/);
  assert.match(html, /id="stageCurrent"/);
  assert.match(html, /id="stageCurrentLabel"/);
  assert.match(html, /data-audience-preview="off"/);
  assert.match(css, /\.stage-card__audience-video \{[^}]*object-fit: contain/);
  assert.match(css, /\.stage\[data-audience-preview="live"\] #stageCurrent \{ display: none; \}/);
});

test("stage widgets remain present beside the audience preview", () => {
  for (const id of [
    "stageClock",
    "stageServiceItem",
    "stageSectionLabel",
    "stageNotes",
    "stageCountdown",
    "stageNext",
    "stageAlert",
    "stagePrivateMessage",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("stage renderer uses Electron's receiver-bound WebRTC media source", () => {
  assert.match(renderer, /navigator\.mediaDevices\.getUserMedia\(\{/);
  assert.match(renderer, /chromeMediaSource: "tab"/);
  assert.match(renderer, /chromeMediaSourceId: sourceId/);
  assert.match(renderer, /applyConstraints\?\.\(AUDIENCE_PREVIEW_CONSTRAINTS\)/);
  assert.match(renderer, /audioTrack\.stop\(\)/);
  assert.match(renderer, /addEventListener\("ended"/);
  assert.match(renderer, /api\.onAudienceSource\(refreshAudienceSource\)/);
  assert.match(renderer, /if \(audienceStartPromise\) return;/);
  assert.match(renderer, /removeAudienceSourceListener\?\.\(\)/);
  assert.match(renderer, /clearInterval\(clockInterval\)/);
  assert.match(renderer, /clearNextPptx\(\);\s+stopAudiencePreview\(\);/);
  assert.match(renderer, /stageDisposed \|\|\s+!audienceSource\.available/);
  assert.doesNotMatch(renderer, /getDisplayMedia|captureStream|RTCPeerConnection|CaptureController/);
});

test("existing confidence captures still prevent conditional focus", () => {
  assert.match(confidenceMonitor, /new CaptureController\(\)/);
  assert.match(confidenceMonitor, /setFocusBehavior\?\.\("no-focus-change"\)/);
});

test("stage content owns service item and notes; widgets only add the countdown", () => {
  assert.match(renderer, /setText\("stageServiceItem", content\.serviceItem \|\| widgets\.serviceItem/);
  assert.match(renderer, /setText\("stageNotes", content\.notes \|\| widgets\.notes/);
  assert.match(liveOutputs, /function clearStageWidgetsIfLiveItemChanged\(item, previousServiceItem\)/);
  assert.match(liveOutputs, /item && previousItem\s+\? item === previousItem/);
  assert.equal(
    liveOutputs.match(/clearStageWidgetsIfLiveItemChanged\(item, previousServiceItem\);/g)?.length,
    2,
  );
  assert.match(liveOutputs, /sendStageLayer\("widgets", \{\}, "layer\.clear"\)/);
});

test("stage Next and notes refresh after schedule edits for the live cue", () => {
  assert.match(liveOutputs, /stageContentCache\.nextIsItem === true \|\| !\(stageContentCache\.next \|\| ""\)/);
  assert.match(scheduleController, /if \(hasLiveItem\) \{\s+\/\/[^\n]*\n\s+void Promise\.resolve\(refreshStageNotesForLiveItem\(\)\)/);
});

test("stage preload exposes pull and push audience-source APIs", () => {
  assert.match(preload, /ipcRenderer\.invoke\("stage-audience-source"\)/);
  assert.match(preload, /ipcRenderer\.on\("stage-audience-source", listener\)/);
  assert.match(preload, /ipcRenderer\.on\("stage-audience-refresh", listener\)/);
});

test("stage reacquires its audience track only after replacement content paints", () => {
  assert.match(mediaWindow, /notifyAudienceContentRenderedAfterPaint\("slipstream", nextPlaybackId\)/);
  assert.match(mediaWindow, /notifyAudienceContentRenderedAfterPaint\("pptx-slide", playbackId\)/);
  assert.match(mediaWindow, /notifyAudienceContentRenderedAfterPaint\("text", audiencePlaybackId\)/);
  assert.match(mediaWindow, /ipcRenderer\.send\("audience-content-rendered"/);
  assert.match(main, /ipcMain\.on\("audience-content-rendered", \(event, payload\) =>/);
  assert.match(main, /event\.sender !== mediaWindow\.webContents/);
  assert.match(main, /publishStageAudienceRefresh\(payload\?\.reason\)/);
  assert.match(renderer, /api\.onAudienceRefresh\(reacquireAudiencePreview\)/);
  assert.match(renderer, /if \(refresh\?\.reason !== "slipstream"\) return;/);
  assert.match(renderer, /audienceSource = \{ available: false, sourceId: null \}/);
  assert.match(renderer, /audienceReplacementPending = true;[\s\S]*?refreshAudienceSource\(\)/);
  assert.match(renderer, /const previousStream = audienceStream;[\s\S]*?previousStream\.getTracks\(\)/);
  assert.match(renderer, /removeAudienceRefreshListener\?\.\(\)/);
  assert.doesNotMatch(renderer, /AUDIENCE_REACQUIRE_PAINT_DELAY_MS|audienceReacquireTimer/);
});

test("stage audience preview does not use the display-media WebFrame handler", () => {
  const handler = main.slice(
    main.indexOf("function handleMediaWindowDisplayMediaRequest"),
    main.indexOf("function handleSetDisplayMediaCaptureTarget"),
  );
  assert.doesNotMatch(handler, /stageWindow\.webContents\.mainFrame|isStageWindowFrame/);
  assert.match(main, /mediaWindow\.webContents\.getMediaSourceId\(requestWebContents\)/);
});

test("audience source IPC registers a fresh source to the stage receiver", () => {
  assert.match(main, /ipcMain\.handle\("stage-audience-source", handleGetStageAudienceSource\)/);
  assert.match(main, /function handleGetStageAudienceSource\(event\) \{\s+if \(!stageWindow \|\| event\.sender !== stageWindow\.webContents\)/);
  assert.match(main, /currentStageAudienceSource\(event\.sender\)/);
  assert.match(main, /function publishOutputStatus\(\) \{[\s\S]*?publishStageAudienceSource\(\);\s+\}/);
  assert.match(main, /stageWindow\.webContents\.send\("stage-audience-source", source\)/);
  assert.match(main, /!mediaWindow\.webContents\.isLoadingMainFrame\(\)/);
  assert.match(main, /sourceId: mediaWindow\.webContents\.getMediaSourceId\(requestWebContents\)/);
});
