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

test("stage renderer wires live audience WebRTC peer relay with local media fallback", () => {
  assert.match(renderer, /import \{ LocalVideoRelay \} from "\.\.\/shared\/local-video-relay\.min\.mjs";/);
  assert.match(renderer, /createStageVideoSync\(\{ video: document\.getElementById\("stageAudiencePreview"\) \}\)/);
  assert.match(renderer, /api\.onAudienceSource\?\.\(/);
  assert.match(renderer, /api\.onAudiencePeerSignal\?\.\(/);
  assert.match(renderer, /api\.sendAudiencePeerSignal/);
  assert.match(renderer, /api\.getAudienceSource/);
  assert.match(renderer, /api\.onLocalMedia\?\.\(syncLocalMedia\)/);
  assert.match(renderer, /api\.onLocalPlayback\?\.\(syncLocalPlayback\)/);
  assert.match(renderer, /api\.getLocalMedia\?\.\(\)/);
  assert.match(renderer, /removeAudienceSourceListener\?\.\(\)/);
  assert.match(renderer, /removeAudiencePeerListener\?\.\(\)/);
  assert.match(renderer, /removeLocalMediaListener\?\.\(\)/);
  assert.match(renderer, /removeLocalPlaybackListener\?\.\(\)/);
  assert.match(renderer, /clearInterval\(clockInterval\)/);
  assert.match(renderer, /clearNextPptx\(\);\s+clearCurrentPptx\(\);\s+stageVideoSync\.dispose\(\);/);
  assert.match(renderer, /stageNativeSlides\.dispose\(\);/);
  assert.doesNotMatch(renderer, /getDisplayMedia|getUserMedia|captureStream|CaptureController/);
  assert.doesNotMatch(renderer, /stage-preview-frame|createStagePreviewSnapshot/);
  assert.doesNotMatch(preload, /stage-preview-frame|createStagePreviewSnapshot/);
  assert.match(mediaWindow, /createStageAudiencePeerHost/);
  assert.match(mediaWindow, /ipcRenderer\.on\("stage-audience-peer"/);
  assert.match(main, /ipcMain\.on\("stage-audience-peer", handleStageAudiencePeer\)/);
  assert.match(main, /mediaPresentationSession\.setDisplayMediaRequestHandler\(\s*handleAudienceSelfDisplayMediaRequest/);
});

test("existing confidence captures still prevent conditional focus", () => {
  assert.match(confidenceMonitor, /new CaptureController\(\)/);
  assert.match(confidenceMonitor, /setFocusBehavior\?\.\("no-focus-change"\)/);
});

test("stage content owns service item and notes; widgets only add the countdown", () => {
  assert.match(renderer, /setText\("stageServiceItem", content\.serviceItem \|\| widgets\.serviceItem/);
  assert.match(renderer, /setText\("stageNotes", content\.notes \|\| widgets\.notes/);
  assert.match(liveOutputs, /function clearStageWidgetsIfLiveItemChanged\(item, nextServiceItem\)/);
  assert.match(liveOutputs, /owner === stageWidgetsOwnerItem && nextServiceItem === \(stageContentCache\.serviceItem \|\| ""\)/);
  assert.equal(
    liveOutputs.match(/await clearStageWidgetsIfLiveItemChanged\(item, (?:payload\.serviceItem|serviceItem)\);/g)?.length,
    2,
  );
  assert.match(liveOutputs, /await sendStageLayer\("widgets", \{\}, "layer\.clear"\)/);
});

test("stage Next and notes refresh after schedule edits for the live cue", () => {
  assert.match(liveOutputs, /function stageNextContentForItem\(item = currentLiveQueueItem\(\), options = \{\}\)/);
  assert.match(scheduleController, /if \(hasLiveItem\) \{[\s\S]*?void refreshStageNotesForLiveItem\(\)/);
});

test("stage preload exposes audience RTC peer signaling alongside local snapshots, playback and PPTX", () => {
  assert.match(preload, /ipcRenderer\.invoke\("stage-audience-source"\)/);
  assert.match(preload, /ipcRenderer\.send\("stage-audience-peer", message\)/);
  assert.match(preload, /ipcRenderer\.invoke\("stage-local-media"\)/);
  for (const channel of ["stage-audience-source", "stage-audience-peer", "stage-local-media", "stage-local-playback"]) {
    assert.ok(preload.includes(`ipcRenderer.on("${channel}", listener)`));
    assert.ok(preload.includes(`ipcRenderer.removeListener("${channel}", listener)`));
  }
  assert.match(preload, /ipcRenderer\.invoke\("stage-next-pptx", deckKey\)/);
});

test("stage audience preview does not use the display-media WebFrame handler", () => {
  const handler = main.slice(
    main.indexOf("function handleMediaWindowDisplayMediaRequest"),
    main.indexOf("function handleSetDisplayMediaCaptureTarget"),
  );
  assert.doesNotMatch(handler, /stageWindow\.webContents\.mainFrame|isStageWindowFrame/);
});

test("audience publishes local visuals and main exposes local stage IPC", () => {
  assert.match(main, /ipcMain\.on\("stage-local-media", handleStageLocalMedia\)/);
  assert.match(main, /ipcMain\.handle\("stage-local-media", \(event\) => \{\s+if \(!stageWindow \|\| event\.sender !== stageWindow\.webContents\) return null;\s+return currentStageLocalMedia\(\);/);
  assert.match(main, /stageWindow\.webContents\.send\("stage-local-playback", playbackState\)/);
  for (const kind of ["video", "image", "pptx", "text", "native"]) {
    assert.ok(mediaWindow.includes(`publishStageLocalMedia("${kind}"`));
  }
  assert.doesNotMatch(mediaWindow, /publishStageLocalMedia\("audio"/);
  assert.match(html, /id="stageCurrentImage"/);
  assert.match(html, /id="stageCurrentPptx"/);
  assert.match(html, /id="stageCurrentAudio"/);
  assert.doesNotMatch(html, /<audio\b/);
});

test("stage native viewport uses the shared native renderer factory and lifecycle", () => {
  assert.match(html, /<div id="stageCurrentNative" class="stage-native-viewport"[^>]*hidden[^>]*><\/div>/);
  assert.match(css, /\.stage-native-viewport \{[^}]*width: 100%;[^}]*height: 100%;[^}]*overflow: hidden/);
  assert.match(renderer, /^import \{ createNativeSlideRenderer \} from "\.\.\/shared\/native-slide-renderer\.min\.mjs";/m);
  assert.match(renderer, /const stageNativeSlides = createNativeSlideRenderer\(\{ viewport: document\.getElementById\("stageCurrentNative"\) \}\);/);
  assert.match(renderer, /const isNative = media\?\.kind === "native" && Boolean\(media\.presentation\)/);
  assert.match(renderer, /nativeViewport\.hidden = !isNative/);
  assert.match(renderer, /stageNativeSlides\.render\(media\.presentation\)/);
  assert.match(renderer, /else if \(currentNativeActive\) \{\s+stageNativeSlides\.clear\(\)/);
  assert.match(renderer, /stageNativeSlides\.dispose\(\)/);
});

test("only audience applyTextMessage publishes native resolved text at audience output dimensions", () => {
  const applyText = mediaWindow.match(/^function applyTextMessage\(message\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(applyText, "real audience text application function exists");
  assert.match(applyText, /const lowerThirdOutput = isLowerThirdOutput \|\| safeMessage\.outputRole === "lower-third"/);
  assert.match(applyText, /if \(!lowerThirdOutput\) \{\s+publishStageLocalMedia\("native", "", 0, \{\s+\.\.\.safeMessage,\s+outputSize: \{ width: window\.innerWidth, height: window\.innerHeight \},\s+\}\);\s+\}/);
  assert.equal(mediaWindow.match(/publishStageLocalMedia\("native"/g)?.length, 1);
  assert.doesNotMatch(mediaWindow.replace(applyText, ""), /publishStageLocalMedia\("native"/);
  const publish = mediaWindow.match(/^function publishStageLocalMedia\([^\n]*\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(publish);
  assert.match(publish, /if \(isLowerThirdOutput\) return;/);
  assert.match(publish, /\.\.\.\(presentation \? \{ presentation \} : \{\}\)/);
  assert.doesNotMatch(liveOutputs, /publishStageLocalMedia\("native"/);
});
