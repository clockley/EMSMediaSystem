import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createStagePreviewSnapshot } from "../src/shared/stage-preview-snapshot.mjs";

const confidence = await readFile(new URL("../src/control-window/app-confidence-monitor.mjs", import.meta.url), "utf8");
const snapshot = await readFile(new URL("../src/shared/stage-preview-snapshot.mjs", import.meta.url), "utf8");
function fn(name) {
  const match = confidence.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^}`, "m"));
  assert.ok(match, name);
  return match[0];
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); }
const frame = (sessionId = "session-a", extra = {}) => ({
  sessionId, width: 426, height: 240, bytes: new Uint8Array([255, 216, 255, 217]), ...extra,
});

function harness() {
  const h = { timers: new Map(), scheduled: [], canvases: [], streams: [], bitmaps: [], blobs: [], errors: [], current: true };
  let timerId = 0;
  h.schedule = (callback, delay) => {
    const timer = { callback, delay, id: ++timerId };
    h.scheduled.push(timer);
    h.timers.set(timer.id, timer);
    assert.equal(h.timers.size, 1, "only one future refresh per harness");
    return timer.id;
  };
  h.cancel = (id) => h.timers.delete(id);
  h.next = () => {
    assert.equal(h.timers.size, 1);
    const timer = h.timers.values().next().value;
    h.timers.delete(timer.id);
    return timer.callback();
  };
  h.document = { createElement(tag) {
    assert.equal(tag, "canvas", "the source is a real DOM canvas, not a media/native capture shim");
    const track = {
      kind: "video", readyState: "live", stops: 0, ended: [],
      stop() { this.stops++; this.readyState = "ended"; },
      addEventListener(type, callback, options) {
        assert.equal(type, "ended"); assert.equal(options.once, true); this.ended.push(callback);
      },
      applyConstraints() { assert.fail("stage canvas tracks must not receive native capture constraints"); },
    };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] };
    const canvas = { width: 0, height: 0, fills: [], draws: [], captures: [],
      getContext(kind) { assert.equal(kind, "2d"); return context; },
      captureStream(fps) {
        this.captures.push(fps);
        assert.deepEqual(this.fills, [["#000", 0, 0, 640, 360]], "prime black before capturing");
        h.streams.push(stream);
        return stream;
      },
    };
    const context = {
      fillRect(...args) { canvas.fills.push([this.fillStyle, ...args]); },
      drawImage(...args) { canvas.beforeDraw?.(); canvas.draws.push(args); },
    };
    h.canvases.push(canvas);
    return canvas;
  } };
  h.decode = async (blob) => {
    h.blobs.push(blob);
    const bitmap = { closes: 0, close() { this.closes++; } };
    h.bitmaps.push(bitmap);
    return bitmap;
  };
  h.make = (overrides = {}) => createStagePreviewSnapshot({
    document: h.document, sessionId: "session-a", getFrame: async () => frame(),
    schedule: h.schedule, cancel: h.cancel, decode: h.decode,
    isCurrent: () => h.current, onError: (error) => h.errors.push(error), ...overrides,
  });
  return h;
}

function videoSink() {
  return { srcObject: null, hidden: true, plays: 0, pauses: 0,
    async play() { this.plays++; }, pause() { this.pauses++; } };
}
function controlHarness() {
  const h = harness();
  const s = {
    document: h.document, currentMode: "media", MEDIAPLAYER: "media",
    latestOutputStatus: { sessionId: "session-a", stage: { window: "open", health: "ok", sessionId: "not-the-top-level-session" } },
    stageRendererPreviewConnection: null, video: videoSink(), requests: [], starts: 0, carousels: 0, errors: [],
    console: { error: (...args) => s.errors.push(args) },
    navigator: { mediaDevices: {
      getDisplayMedia() { assert.fail("no stage tab capture"); },
      getUserMedia() { assert.fail("null source must select snapshots"); },
    } },
    captureElectronPresentationWindow() { assert.fail("no stage native capture helper"); },
    getStageConfidenceMonitorElement: () => s.video,
    disableNativeVideoControls: (video) => { video.controls = false; },
    syncConfidenceMonitorCarousel: () => { s.carousels++; },
    getFrame: async ({ sessionId }) => frame(sessionId),
    invoke(channel, payload) {
      assert.deepEqual(Object.keys(payload), ["sessionId"]);
      if (channel === "stage-preview-source") return Promise.resolve(null);
      assert.equal(channel, "stage-preview-frame");
      s.requests.push(payload.sessionId);
      return s.getFrame(payload);
    },
    createStagePreviewSnapshot(options) {
      s.starts++;
      return createStagePreviewSnapshot({ ...options, schedule: h.schedule, cancel: h.cancel, decode: h.decode });
    },
  };
  vm.createContext(s);
  for (const name of ["disableCapturedAudioTracks", "prepareRendererCaptureElement", "hideRendererCaptureElement",
    "stopStageRendererPreviewCapture", "syncStageRendererPreviewCapture"]) vm.runInContext(fn(name), s);
  return { h, s };
}

test("detached black canvas supplies one silent captureStream(10), attached only once", async () => {
  const h = harness(), attached = [];
  const preview = h.make({ onStream: (stream) => attached.push(stream) });
  assert.equal(h.document.body, undefined, "canvas needs no DOM mount");
  assert.equal(preview.stream, h.streams[0]);
  assert.deepEqual(preview.stream.getAudioTracks(), []);
  assert.deepEqual(h.canvases[0].captures, [10]);
  assert.equal(h.scheduled[0].delay, 0);
  for (let i = 0; i < 15; i++) {
    await h.next();
    assert.equal(h.scheduled.at(-1).delay, 100);
  }
  assert.deepEqual(attached, [preview.stream]);
  assert.equal(h.canvases.length, 1);
  assert.equal(h.canvases[0].draws.length, 15);
  assert.deepEqual(h.canvases[0].draws[0].slice(1), [0, 0, 426, 240]);
  assert.equal(h.canvases[0].width, 426);
  assert.equal(h.canvases[0].height, 240);
  assert.ok(h.bitmaps.every((bitmap) => bitmap.closes === 1));
  preview.dispose(); preview.dispose();
  assert.equal(preview.stream.getTracks()[0].stops, 1);
  assert.equal(h.timers.size, 0);
});

test("JPEG Blob decoding accepts IPC Uint8Array views and serialized byte forms", async () => {
  const h = harness();
  const bytes = new Uint8Array([99, 255, 216, 255, 217, 99]).subarray(1, 5);
  const forms = [bytes, vm.runInNewContext("new Uint8Array([255,216,255,217])"),
    [255, 216, 255, 217], { type: "Buffer", data: [255, 216, 255, 217] }, new Uint8Array(bytes).buffer];
  const preview = h.make({ getFrame: async () => frame("session-a", { bytes: forms.shift() }) });
  for (let i = 0; i < 5; i++) await h.next();
  for (const blob of h.blobs) {
    assert.ok(blob instanceof Blob);
    assert.equal(blob.type, "image/jpeg");
    assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [255, 216, 255, 217]);
  }
  assert.equal(h.blobs.length, 5);
  preview.dispose();
});

test("null, foreign-session and malformed frames retry after 100ms without decoding", async () => {
  const h = harness();
  const replies = [null, frame("old-session"), frame("session-a", { width: 0 }),
    frame("session-a", { height: Infinity }), frame("session-a", { width: 2.5 }),
    frame("session-a", { bytes: undefined }), frame("session-a", { bytes: new Uint8Array() }), frame()];
  const preview = h.make({ getFrame: async () => replies.shift() });
  for (let i = 0; i < 7; i++) {
    await h.next();
    assert.equal(h.blobs.length, 0);
    assert.equal(h.scheduled.at(-1).delay, 100);
  }
  await h.next();
  assert.equal(h.blobs.length, 1);
  assert.equal(h.canvases[0].draws.length, 1);
  assert.equal(h.errors.length, 0);
  preview.dispose();
});

test("pending fetch and decode cannot overlap another refresh or accumulate timers", async () => {
  const h = harness(), fetch = deferred(), decode = deferred();
  let requests = 0, decodes = 0;
  const preview = h.make({ getFrame: () => { requests++; return fetch.promise; },
    decode: () => { decodes++; return decode.promise; } });
  const pending = h.next();
  await settle();
  assert.equal(requests, 1); assert.equal(decodes, 0); assert.equal(h.timers.size, 0);
  fetch.resolve(frame()); await settle();
  assert.equal(requests, 1); assert.equal(decodes, 1); assert.equal(h.timers.size, 0);
  const bitmap = await h.decode(new Blob());
  decode.resolve(bitmap); await pending;
  assert.equal(bitmap.closes, 1);
  assert.equal(h.timers.size, 1);
  assert.equal(h.scheduled.at(-1).delay, 100, "wait a full interval after all work completes");
  preview.dispose();
});

for (const phase of ["fetch", "decode"]) for (const outcome of ["resolve", "reject"]) {
  test(`dispose during pending ${phase}: late ${outcome} cannot draw, report or reschedule`, async () => {
    const h = harness(), wait = deferred();
    const preview = h.make(phase === "fetch" ? { getFrame: () => wait.promise } : { decode: () => wait.promise });
    const pending = h.next(); await settle();
    preview.dispose(); preview.dispose();
    const bitmap = { closes: 0, close() { this.closes++; } };
    if (outcome === "reject") wait.reject(new Error("obsolete work"));
    else wait.resolve(phase === "fetch" ? frame() : bitmap);
    await pending;
    assert.equal(h.canvases[0].draws.length, 0);
    assert.equal(h.timers.size, 0);
    assert.equal(h.errors.length, 0);
    assert.equal(bitmap.closes, phase === "decode" && outcome === "resolve" ? 1 : 0);
    assert.equal(preview.stream.getTracks()[0].stops, 1);
  });
}

test("identity loss after decode closes the bitmap and stops its stream without publication", async () => {
  const h = harness(), wait = deferred();
  const preview = h.make({ decode: () => wait.promise });
  const pending = h.next(); await settle();
  h.current = false;
  const bitmap = await h.decode(new Blob());
  wait.resolve(bitmap); await pending;
  assert.equal(bitmap.closes, 1);
  assert.equal(h.canvases[0].draws.length, 0);
  assert.equal(preview.stream.getTracks()[0].stops, 1);
  assert.equal(h.timers.size, 0);
});

test("draw, bitmap.close and reporter exceptions still clean up and retain one retry", async () => {
  const h = harness(), drawError = new Error("draw"), closeError = new Error("close");
  const bitmap = { closes: 0, close() { this.closes++; throw closeError; } };
  const preview = h.make({ decode: async () => bitmap,
    onError(error) { h.errors.push(error); throw new Error("reporter"); } });
  h.canvases[0].beforeDraw = () => { throw drawError; };
  await h.next();
  assert.equal(bitmap.closes, 1);
  assert.deepEqual(h.errors, [drawError, closeError]);
  assert.equal(h.timers.size, 1);
  preview.dispose();
  assert.equal(h.timers.size, 0);
});

test("current fetch/decode failures retry rather than wedge the serial loop", async () => {
  const h = harness(); let calls = 0, decodes = 0;
  const preview = h.make({ getFrame: async () => {
    if (++calls === 1) throw new Error("fetch");
    return frame("session-a", { width: calls === 4 ? 640 : 426, height: calls === 4 ? 360 : 240 });
  }, decode: async (blob) => {
    if (++decodes === 1) throw new Error("decode");
    return h.decode(blob);
  } });
  for (let i = 0; i < 4; i++) await h.next();
  assert.deepEqual(h.errors.map((error) => error.message), ["fetch", "decode"]);
  assert.equal(h.canvases[0].draws.length, 2);
  assert.equal(h.canvases[0].width, 640);
  assert.equal(h.canvases[0].height, 360);
  assert.equal(h.streams.length, 1, "resizing updates the existing stream");
  preview.dispose();
});

test("cancelled timer callbacks and failed attachments release only their own resources", async () => {
  const h = harness(); let fetches = 0;
  const first = h.make({ getFrame: async () => { fetches++; return frame(); } });
  const staleTimer = h.scheduled[0];
  first.dispose();
  const second = h.make();
  await staleTimer.callback();
  assert.equal(fetches, 0);
  assert.equal(second.stream.getTracks()[0].stops, 0);
  assert.equal(h.timers.size, 1);
  second.dispose();
  assert.throws(() => h.make({ onStream() { throw new Error("attach"); } }), /attach/);
  assert.equal(h.streams.at(-1).getTracks()[0].stops, 1);
  assert.equal(h.timers.size, 0);
  h.current = false;
  const obsolete = h.make({ onStream() { assert.fail("obsolete attachment"); } });
  assert.equal(obsolete.stream.getTracks()[0].stops, 1);
  assert.equal(h.timers.size, 0);
});

test("stage capture prefers native WINDOW, never tab capture, with unchanged snapshot imports and budget", () => {
  assert.doesNotMatch(snapshot, /getDisplayMedia|getUserMedia|captureElectronPresentationWindow|new MediaStream/);
  assert.match(confidence, /import \{ createStagePreviewSnapshot \} from "\.\.\/shared\/stage-preview-snapshot\.mjs"/);
  const stageCapture = fn("syncStageRendererPreviewCapture");
  assert.doesNotMatch(stageCapture, /captureElectronPresentationWindow\(|getDisplayMedia\(|media-window-capture-available/);
  assert.match(stageCapture, /invoke\("stage-preview-source", \{ sessionId \}\)/);
  assert.match(stageCapture, /navigator\.mediaDevices\.getUserMedia\(/);
  assert.match(stageCapture, /chromeMediaSource: "desktop", chromeMediaSourceId: source\.sourceId/);
  assert.match(fn("syncConfidenceCaptureQualityForPopout"), /syncStageRendererPreviewCaptureQuality\(\)/);
  assert.doesNotMatch(fn("syncStageRendererPreviewCaptureQuality"), /streamRendererPreviewQualityMode\s*=/);
  assert.match(fn("startLowerThirdRendererPreviewCapture"), /captureElectronPresentationWindow\("lower-third"\)/);
  assert.match(fn("startStreamRendererPreviewCapture"), /captureElectronPresentationWindow\("media"\)/);
  const h = harness();
  assert.throws(() => h.make({ document: { createElement() { return { getContext: () => ({ fillRect() {} }) }; } } }), /captureStream/);
});

test("control reuses session + actual video sink across repeated statuses, attaches and plays once", async () => {
  const { h, s } = controlHarness();
  await s.syncStageRendererPreviewCapture();
  const stream = s.video.srcObject;
  for (let i = 0; i < 12; i++) {
    s.latestOutputStatus = { ...s.latestOutputStatus, audience: { content: `cue-${i}` } };
    await s.syncStageRendererPreviewCapture();
    await h.next();
  }
  assert.equal(s.starts, 1);
  assert.equal(s.video.srcObject, stream);
  assert.equal(s.video.plays, 1);
  assert.equal(s.video.pauses, 0);
  assert.equal(s.video.muted, true);
  assert.equal(s.video.defaultMuted, true);
  assert.equal(s.video.volume, 0);
  assert.equal(s.video.controls, false);
  assert.equal(s.video.hidden, false);
  assert.deepEqual(s.requests, Array(12).fill("session-a"));
  s.stopStageRendererPreviewCapture();
  assert.equal(s.video.srcObject, null);
  assert.equal(s.video.hidden, true);
  assert.equal(h.timers.size, 0);
});

for (const outcome of ["resolve", "reject"]) {
  test(`session replacement during pending fetch ignores old ${outcome} and ended/stop callbacks`, async () => {
    const { h, s } = controlHarness(), wait = deferred();
    s.getFrame = ({ sessionId }) => sessionId === "session-a" ? wait.promise : Promise.resolve(frame(sessionId));
    await s.syncStageRendererPreviewCapture();
    const old = s.stageRendererPreviewConnection, pending = h.next(); await settle();
    s.latestOutputStatus.sessionId = "session-b";
    await s.syncStageRendererPreviewCapture();
    const current = s.stageRendererPreviewConnection;
    await h.next();
    const pauses = s.video.pauses, carousels = s.carousels;
    if (outcome === "reject") wait.reject(new Error("old IPC failed"));
    else wait.resolve(frame("session-a"));
    await pending;
    old.stream.getVideoTracks()[0].ended[0]();
    s.stopStageRendererPreviewCapture(old);
    assert.equal(s.stageRendererPreviewConnection, current);
    assert.equal(s.video.srcObject, current.stream);
    assert.equal(s.video.pauses, pauses);
    assert.equal(s.carousels, carousels);
    assert.equal(s.video.hidden, false);
    assert.equal(old.stream.getTracks()[0].stops, 1);
    assert.equal(current.stream.getTracks()[0].stops, 0);
    assert.equal(h.canvases[0].draws.length, 0);
    assert.equal(h.timers.size, 1);
    assert.equal(s.errors.length, 0);
    s.stopStageRendererPreviewCapture();
  });
}

test("replacing the actual sink in the same session rejects and closes a late decoded bitmap", async () => {
  const { h, s } = controlHarness(), wait = deferred();
  const decode = h.decode;
  h.decode = () => wait.promise;
  await s.syncStageRendererPreviewCapture();
  const old = s.stageRendererPreviewConnection, oldVideo = s.video, pending = h.next(); await settle();
  h.decode = decode;
  s.video = videoSink();
  await s.syncStageRendererPreviewCapture();
  const current = s.stageRendererPreviewConnection;
  await h.next();
  const bitmap = await decode(new Blob());
  wait.resolve(bitmap); await pending;
  old.stream.getVideoTracks()[0].ended[0]();
  assert.equal(bitmap.closes, 1);
  assert.equal(h.canvases[0].draws.length, 0);
  assert.equal(h.canvases[1].draws.length, 1);
  assert.equal(oldVideo.srcObject, null);
  assert.equal(s.video.srcObject, current.stream);
  assert.equal(s.video.plays, 1);
  assert.equal(s.video.pauses, 0);
  assert.equal(s.stageRendererPreviewConnection, current);
  s.stopStageRendererPreviewCapture();
});

for (const reason of ["mode", "closed", "session", "sink"]) {
  test(`losing ${reason} during decode stops and cannot revive the stage connection`, async () => {
    const { h, s } = controlHarness(), wait = deferred();
    h.decode = () => wait.promise;
    await s.syncStageRendererPreviewCapture();
    const sink = s.video, old = s.stageRendererPreviewConnection, pending = h.next(); await settle();
    if (reason === "mode") s.currentMode = "Bible";
    if (reason === "closed") s.latestOutputStatus.stage.window = "closed";
    if (reason === "session") s.latestOutputStatus.sessionId = "";
    if (reason === "sink") s.video = null;
    await s.syncStageRendererPreviewCapture();
    const bitmap = { closes: 0, close() { this.closes++; } };
    wait.resolve(bitmap); await pending;
    assert.equal(bitmap.closes, 1);
    assert.equal(s.stageRendererPreviewConnection, null);
    assert.equal(old.stream.getTracks()[0].stops, 1);
    assert.equal(sink.srcObject, null);
    assert.equal(sink.pauses, 1);
    assert.equal(h.canvases[0].draws.length, 0);
    assert.equal(h.timers.size, 0);
    await s.syncStageRendererPreviewCapture();
    assert.equal(s.starts, 1);
  });
}