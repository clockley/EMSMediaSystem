import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { EventEmitter } from "node:events";

const source = await readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8");
function fn(name) {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^}`, "m"));
  assert.ok(match, name);
  return match[0];
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const calls = [];
  const control = {};
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 2520, height: 1680 }),
    resize(options) { calls.push({ resize: options }); return { toJPEG(quality) { calls.push({ quality }); return new Uint8Array([255, 216, 255, 217]); } }; },
  };
  const target = () => ({
    isDestroyed: () => false,
    getMediaSourceId() { calls.push({ source: true }); return "window:42:1"; },
    getTitle: () => "EMS preview",
    webContents: Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      isCrashed: () => false,
      isLoadingMainFrame: () => false,
      mainFrame: {},
      async capturePage(...args) { calls.push({ capture: args }); return image; },
    }),
  });
  const state = {
    stageWindow: target(), stageSessionId: "stage-1", stageHealth: "ok",
    nativeConfidenceCaptureEnabled: true,
    nativeStageConfidenceCaptureEnabled: true,
    stagePreviewFrameRequest: null,
    setTimeout: (callback) => setTimeout(callback, 5), clearTimeout,
    mediaWindow: target(), lowerThirdWindow: target(), displayMediaCaptureTarget: "media",
    assertControlSender(event) { if (event.sender !== control) throw new TypeError("control only"); },
  };
  vm.createContext(state);
  for (const name of ["handleStagePreviewSource", "handleStagePreviewFrame", "handleSetDisplayMediaCaptureTarget", "handleMediaWindowDisplayMediaRequest"]) {
    vm.runInContext(fn(name), state);
  }
  return { state, calls, control, image, target,
    nativeSource: (input = { sessionId: state.stageSessionId }, sender = control) => state.handleStagePreviewSource({ sender }, input),
    frame: (input = { sessionId: state.stageSessionId }, sender = control) => state.handleStagePreviewFrame({ sender }, input),
  };
}

test("stage preview snapshots are control-only, bounded JPEGs and cannot capture audio", async () => {
  const h = harness();
  await assert.rejects(h.frame({ sessionId: "stage-1" }, {}), /control only/);
  assert.equal(h.calls.length, 0);
  const frame = await h.frame();
  assert.equal(frame.sessionId, "stage-1");
  assert.equal(frame.width, 540);
  assert.equal(frame.height, 360);
  assert.ok(frame.bytes instanceof Uint8Array);
  assert.deepEqual(Object.keys(frame).sort(), ["bytes", "height", "sessionId", "width"]);
  assert.equal(h.calls[0].capture[0], undefined);
  assert.equal(h.calls[0].capture[1].stayHidden, true);
  assert.equal(h.calls[0].capture[1].stayAwake, true);
  assert.equal(h.calls[1].resize.width, 540);
  assert.equal(h.calls[2].quality, 65);
  assert.equal(h.state.stagePreviewFrameRequest, null);
});

for (const reason of ["closed", "destroyed", "web-destroyed", "crashed", "loading", "starting", "stale-session", "missing-session"]) {
  test(`stage preview refuses unavailable output (${reason})`, async () => {
    const h = harness();
    if (reason === "closed") h.state.stageWindow = null;
    if (reason === "destroyed") h.state.stageWindow.isDestroyed = () => true;
    if (reason === "web-destroyed") h.state.stageWindow.webContents.isDestroyed = () => true;
    if (reason === "crashed") h.state.stageWindow.webContents.isCrashed = () => true;
    if (reason === "loading") h.state.stageWindow.webContents.isLoadingMainFrame = () => true;
    if (reason === "starting") h.state.stageHealth = "starting";
    const input = reason === "missing-session" ? {} : { sessionId: reason === "stale-session" ? "old" : "stage-1" };
    assert.equal(await h.frame(input), null);
    assert.equal(h.calls.length, 0);
  });
}

test("one snapshot stays in flight across concurrent callers and replacement windows", async () => {
  const h = harness();
  const capture = deferred();
  let count = 0;
  h.state.stageWindow.webContents.capturePage = () => { count++; return capture.promise; };
  const old = h.frame();
  assert.equal(await h.frame(), null);
  h.state.stageWindow = h.target();
  h.state.stageSessionId = "stage-2";
  assert.equal(await h.frame(), null);
  assert.equal(count, 1);
  capture.resolve(h.image);
  assert.equal(await old, null, "obsolete frame must not be encoded or returned");
  assert.equal(h.calls.length, 0);
  assert.equal((await h.frame()).sessionId, "stage-2");
});

for (const reason of ["closed", "reloaded", "session-changed"]) {
  test(`capture completion is discarded after output ${reason}`, async () => {
    const h = harness();
    const capture = deferred();
    h.state.stageWindow.webContents.capturePage = () => capture.promise;
    const pending = h.frame();
    if (reason === "closed") h.state.stageWindow = null;
    if (reason === "reloaded") h.state.stageWindow.webContents.isLoadingMainFrame = () => true;
    if (reason === "session-changed") h.state.stageSessionId = "stage-2";
    capture.resolve(h.image);
    assert.equal(await pending, null);
    assert.equal(h.calls.length, 0);
    assert.equal(h.state.stagePreviewFrameRequest, null);
  });
}

for (const failure of ["capture", "empty", "size", "resize", "encode"]) {
  test(`snapshot failure is isolated and retryable (${failure})`, async () => {
    const h = harness();
    const method = failure === "capture" ? h.state.stageWindow.webContents : h.image;
    const name = { capture: "capturePage", empty: "isEmpty", size: "getSize", resize: "resize", encode: "resize" }[failure];
    const original = method[name];
    method[name] = () => {
      if (failure === "empty") return true;
      if (failure === "size") return { width: 0, height: 0 };
      if (failure === "encode") return { toJPEG() { throw new Error("encoding failed"); } };
      throw new Error("capture failed");
    };
    assert.equal(await h.frame(), null);
    assert.equal(h.state.stagePreviewFrameRequest, null);
    method[name] = original;
    assert.ok((await h.frame()).bytes.length > 0);
  });
}

test("native stage TAB capture is denied while audience and lower-third capture are preserved", () => {
  const h = harness();
  assert.equal(h.state.handleSetDisplayMediaCaptureTarget({}, "stage"), false);
  let result;
  h.state.handleMediaWindowDisplayMediaRequest({ videoRequested: true }, (value) => { result = value; });
  assert.equal(result, null);
  for (const [role, target] of [["media", h.state.mediaWindow], ["lower-third", h.state.lowerThirdWindow]]) {
    assert.equal(h.state.handleSetDisplayMediaCaptureTarget({}, role), true);
    h.state.handleMediaWindowDisplayMediaRequest({ videoRequested: true }, (value) => { result = value; });
    assert.equal(result.video.id, target.getMediaSourceId());
    assert.equal(result.video.name, "EMS preview");
    assert.notEqual(result.video, target.webContents.mainFrame);
  }
  assert.match(source, /ipcMain\.handle\("stage-preview-frame", handleStagePreviewFrame\)/);
});

test("a lost native audience window is rejected without throwing out of the main process", () => {
  const h = harness();
  h.state.mediaWindow.getMediaSourceId = () => { throw new Error("window detached"); };
  let result;
  assert.doesNotThrow(() => h.state.handleMediaWindowDisplayMediaRequest({ videoRequested: true }, (value) => { result = value; }));
  assert.equal(result, null);
});

test("native WINDOW source is control-only, session-bound and uses the exact stage window ID", async () => {
  const h = harness();
  await assert.rejects(h.nativeSource({ sessionId: "stage-1" }, {}), /control only/);
  assert.equal(h.calls.length, 0);
  const result = await h.nativeSource();
  assert.equal(result.sessionId, "stage-1");
  assert.equal(result.sourceId, "window:42:1");
  assert.deepEqual(Object.keys(result).sort(), ["sessionId", "sourceId"]);
  assert.deepEqual(h.calls, [{ source: true }], "no snapshot or desktop enumeration");
  assert.match(source, /ipcMain\.handle\("stage-preview-source", handleStagePreviewSource\)/);
});

test("unsupported native backend keeps stage snapshots and denies native window capture", async () => {
  const h = harness();
  h.state.nativeConfidenceCaptureEnabled = false;
  h.state.nativeStageConfidenceCaptureEnabled = false;
  assert.equal(await h.nativeSource(), null);
  let result;
  h.state.handleMediaWindowDisplayMediaRequest({ videoRequested: true }, (value) => { result = value; });
  assert.equal(result, null);
  assert.equal(h.calls.length, 0);
  assert.ok(await h.frame(), "local stage and its snapshot fallback remain available");
});

test("unsafe native stage capture is denied before source lookup without disabling native audience capture", async () => {
  const h = harness();
  h.state.nativeStageConfidenceCaptureEnabled = false;
  h.state.stageWindow.getMediaSourceId = () => assert.fail("unsafe stage source must not enter native capture");
  assert.equal(await h.nativeSource(), null);
  assert.equal(h.calls.length, 0);
  await assert.rejects(h.nativeSource({ sessionId: "stage-1" }, {}), /control only/);
  let result;
  h.state.handleMediaWindowDisplayMediaRequest({ videoRequested: true }, (value) => { result = value; });
  assert.equal(result.video.id, "window:42:1");
  assert.ok(await h.frame(), "local stage still supplies bounded snapshot frames");
});

for (const reason of ["closed", "destroyed", "web-destroyed", "crashed", "loading", "starting", "stale-session", "missing-session", "empty-session"]) {
  test(`native source refuses unavailable output (${reason})`, async () => {
    const h = harness();
    if (reason === "closed") h.state.stageWindow = null;
    if (reason === "destroyed") h.state.stageWindow.isDestroyed = () => true;
    if (reason === "web-destroyed") h.state.stageWindow.webContents.isDestroyed = () => true;
    if (reason === "crashed") h.state.stageWindow.webContents.isCrashed = () => true;
    if (reason === "loading") h.state.stageWindow.webContents.isLoadingMainFrame = () => true;
    if (reason === "starting") h.state.stageHealth = "starting";
    if (reason === "empty-session") h.state.stageSessionId = "";
    const input = reason === "missing-session" ? {} : { sessionId: reason === "stale-session" ? "old" : h.state.stageSessionId };
    assert.equal(await h.nativeSource(input), null);
    assert.equal(h.calls.length, 0);
  });
}

for (const sourceId of ["", "window:0:0", "screen:42:0", "web-contents-media-stream:42:1", "window:-1:0", "window:1:0junk", null]) {
  test(`invalid or unsupported native window ID falls back (${sourceId})`, async () => {
    const h = harness();
    h.state.stageWindow.getMediaSourceId = () => sourceId;
    assert.equal(await h.nativeSource(), null);
  });
}

for (const reason of ["getter-throws", "destroyed", "window-replaced", "session-replaced"]) {
  test(`source acquisition rejects lost ownership (${reason})`, async () => {
    const h = harness();
    const target = h.state.stageWindow;
    target.getMediaSourceId = () => {
      if (reason === "getter-throws") throw new Error("unsupported native backend");
      if (reason === "destroyed") target.isDestroyed = () => true;
      if (reason === "window-replaced") h.state.stageWindow = h.target();
      if (reason === "session-replaced") h.state.stageSessionId = "stage-2";
      return "window:42:1";
    };
    assert.equal(await h.nativeSource(), null);
  });
}

for (const reason of ["loaded", "closed", "session-replaced", "crashed", "timed-out"]) {
  test(`native source waits for document load without losing ownership (${reason})`, async () => {
    const h = harness();
    const contents = h.state.stageWindow.webContents;
    let loading = true;
    contents.isLoadingMainFrame = () => loading;
    const pending = h.nativeSource();
    assert.equal(h.calls.length, 0);
    assert.equal(contents.listenerCount("did-stop-loading"), 1);
    if (reason === "loaded") loading = false;
    if (reason === "closed") h.state.stageWindow = null;
    if (reason === "session-replaced") h.state.stageSessionId = "stage-2";
    if (reason === "crashed") contents.isCrashed = () => true;
    if (reason !== "timed-out") contents.emit(reason === "closed" ? "destroyed" : "did-stop-loading");
    const result = await pending;
    if (reason === "loaded") assert.equal(result.sourceId, "window:42:1");
    else assert.equal(result, null);
    assert.equal(contents.listenerCount("did-stop-loading"), 0);
    assert.equal(contents.listenerCount("destroyed"), 0);
  });
}