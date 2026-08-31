import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyOutputCommand, createCompositorState, createOutputCommand } from "../src/output-compositor.mjs";

async function readRendererSources() {
  const sources = await Promise.all(
    [
      "../src/app.js",
      "../src/app-renderer.mjs",
      "../src/app-song-slides-workspace.mjs",
      "../src/app-bible-workspace.mjs",
      "../src/app-confidence-monitor.mjs",
      "../src/app-network-preview.mjs",
      "../src/app-preview-controller.mjs",
      "../src/app-project-session.mjs",
      "../src/app-schedule-controller.mjs",
      "../src/app-presentation-playback.mjs",
      "../src/app-live-outputs.mjs",
      "../src/app-logo-hold.mjs",
      "../src/app-media-loop.mjs",
      "../src/app-preview-surfaces.mjs",
      "../src/app-operator-chrome.mjs",
      "../src/app-media-runtime.mjs",
      "../src/app-workspace-shell.mjs",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  return sources.join("\n");
}

function command(layer, revision, payload, type = "layer.set") {
  return createOutputCommand({
    commandId: `${layer}-${revision}`,
    sessionId: "audience-session",
    revision,
    targetRole: "audience",
    type,
    layer,
    payload,
  });
}

for (const contentKind of ["song", "scripture", "deck", "powerpoint", "image", "video", "stream"]) {
  test(`audience alert is independent of live ${contentKind} content`, () => {
    let state = createCompositorState("audience", "audience-session");
    state = applyOutputCommand(state, command("content", 1, { kind: contentKind, position: 7 })).state;
    state = applyOutputCommand(state, command("alert", 1, { kind: "general", message: "Notice" })).state;
    assert.equal(state.layers.content.kind, contentKind);
    assert.equal(state.layers.content.position, 7);
    assert.equal(state.layers.alert.message, "Notice");
    state = applyOutputCommand(state, command("alert", 2, {}, "layer.clear")).state;
    assert.equal(state.layers.alert, null);
    assert.equal(state.layers.content.position, 7);
  });
}

test("background switches without replacing resolved text content", () => {
  let state = createCompositorState("audience", "audience-session");
  state = applyOutputCommand(state, command("content", 1, { slideId: "verse-2" })).state;
  state = applyOutputCommand(state, command("media", 1, { sourceUrl: "file:///one.mp4" })).state;
  state = applyOutputCommand(state, command("media", 2, { sourceUrl: "file:///two.jpg" })).state;
  assert.equal(state.layers.content.slideId, "verse-2");
  assert.equal(state.layers.media.sourceUrl, "file:///two.jpg");
});

test("audience renderer declares fixed background, content, alert, and hold slots", async () => {
  const html = await readFile(new URL("../src/media.html", import.meta.url), "utf8");
  const positions = ["liveBackgroundLayer", "textCanvas", "audienceAlertLayer", "outputHoldOverlay"].map((id) => html.indexOf(`id="${id}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("alert-only audience output is transparent with corner nursery and dark-red ticker styling", async () => {
  const html = await readFile(new URL("../src/media.html", import.meta.url), "utf8");
  assert.match(html, /is-transparent-output/);
  assert.match(html, /id="audienceNurseryLayer"/);
  assert.match(html, /top:\s*4vh;\s*right:\s*3vw/);
  assert.match(html, /#audienceAlertLayer[\s\S]*left:\s*0;[\s\S]*right:\s*0;[\s\S]*bottom:\s*0;/);
  assert.match(html, /background:\s*#7a1010/);
  assert.match(html, /color:\s*#fff/);
  assert.match(html, /translateX\(100vw\)/);
  assert.match(html, /--audience-alert-scroll-duration/);
});

test("audience window lifecycle preserves alerts across content boundaries", async () => {
  const main = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
  assert.match(main, /__alertOverlayOnly=true/);
  assert.match(main, /transparent:\s*true/);
  assert.match(main, /if \(hasActiveAlerts\(\)\)[\s\S]*replaceContentWindowWithAlertOverlay\(\)/);
  assert.match(main, /setAudienceWindowTransparent\(audienceContentKind === "none"\)/);
  assert.match(main, /audienceContentKind !== "none" \|\| hasActiveAlerts\(\) \|\| backgroundState\.current/);
  const preserveStart = main.indexOf("async function replaceContentWindowWithAlertOverlay");
  const preserveEnd = main.indexOf("function closeUnusedAlertOverlayWindow", preserveStart);
  const preserveFunction = main.slice(preserveStart, preserveEnd);
  assert.match(preserveFunction, /audience-enter-alert-only/);
  assert.doesNotMatch(preserveFunction, /contentWindow\.close\(\)/);
});

test("rerouting the same audience alert preserves its ticker animation phase", async () => {
  const media = await readFile(new URL("../src/media.mjs", import.meta.url), "utf8");
  assert.match(media, /activeAudienceTickerId === tickerId/);
  assert.match(media, /Keep it intact[\s\S]*content\/transparent-base change/);
  assert.match(media, /tickerPhaseDelaySeconds/);
  assert.match(media, /--audience-alert-scroll-delay/);
});

test("content transitions are suppressed when a live alert owns the audience timeline", async () => {
  const [main, media] = await Promise.all([
    readFile(new URL("../src/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/media.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(main, /hasActiveAlerts\(\) \? \["__disable-content-transitions=true"\]/);
  assert.match(media, /if \(disableContentTransitions\)[\s\S]*clearSlideTransition/);
});

test("operator controls expose background and text color pickers for both alert types", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  for (const id of [
    "nurseryAlertBackgroundColor",
    "nurseryAlertTextColor",
    "messageAlertBackgroundColor",
    "messageAlertTextColor",
  ]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*type="color"|type="color"[^>]*id="${id}"`));
  }
  assert.match(html, /id="alertDismissAtCountdownEnd"[^>]*type="checkbox"|type="checkbox"[^>]*id="alertDismissAtCountdownEnd"/);
});

test("alerts dialog separates its two operator tasks and uses progressive disclosure", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.equal((html.match(/role="tab"/g) || []).length, 2);
  for (const page of ["nursery", "message"]) {
    assert.match(html, new RegExp(`data-live-layer-page="${page}"`));
  }
  assert.match(html, /<summary>Timing and output<\/summary>/);
  assert.match(html, /<summary>Appearance<\/summary>/);
  assert.match(html, /<summary>Insert dynamic text<\/summary>/);
  assert.match(html, /id="quickAlertMessageSelect"/);
  assert.match(html, /id="insertAlertClockTokenBtn"/);
  assert.doesNotMatch(html, /alertTemplateSelect|alertModeSelect|liveBackgroundGrid|addLiveBackgroundBtn/);
});

test("independent live-background controls and IPC are not exposed", async () => {
  const [app, main] = await Promise.all([
    readRendererSources(),
    readFile(new URL("../src/main.mjs", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(app, /background:(set|clear|revert)/);
  assert.doesNotMatch(main, /ipcMain\.handle\("background:(set|clear|revert)"/);
});

test("message picker offers ready-to-use text and persists a bounded recent list", async () => {
  const app = await readRendererSources();
  assert.match(app, /const READY_ALERT_MESSAGES = Object\.freeze/);
  assert.match(app, /"recentAlertMessages"/);
  assert.match(app, /\.slice\(0, 8\)/);
  assert.match(app, /input\.value = select\.value/);
  assert.match(app, /tokenDefinitions: structuredClone\(tokenDefinitions\)/);
  assert.match(app, /option\.dataset\.tokenDefinitions/);
  assert.match(app, /Choose when the countdown should end/);
  assert.match(app, /dismissAtCountdownEnd/);
});

test("operator shell omits the audience, lower-third, and stage output-status strip", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /id="outputStatusStrip"/);
  assert.doesNotMatch(html, /data-output-role=/);
});

test("confidence monitor pins and captures the output carrying an active alert", async () => {
  const app = await readRendererSources();
  assert.match(app, /function activeAlertConfidencePage\(\)/);
  assert.match(app, /if \(alertPage === "audience"[\s\S]*return \["audience"\]/);
  assert.match(app, /if \(alertPage === "stage"[\s\S]*return \["stage"\]/);
  assert.match(app, /stream && audienceOutputAvailableForConfidence\(\)/);
  assert.match(
    app,
    /!mediaRendererCaptureAllowedForCurrentMode\(\) \|\|[\s\S]*!audienceOutputAvailableForConfidence\(\)/,
  );
});
