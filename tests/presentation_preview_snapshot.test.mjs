import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createStagePreviewSnapshot } from "../src/shared/stage-preview-snapshot.mjs";

const confidence = await readFile(new URL("../src/control-window/app-confidence-monitor.mjs", import.meta.url), "utf8");
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
async function settle() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
function sink() {
  return { srcObject: null, hidden: true, plays: 0, pauses: 0,
    async play() { this.plays++; }, pause() { this.pauses++; } };
}
const frame = (sessionId) => ({ sessionId, width: 426, height: 240, bytes: new Uint8Array([255, 216, 255, 217]) });

function harness() {
  const h = { requests: [], events: [], errors: [], timers: new Map(), scheduled: [], snapshots: [],
    canvases: [], bitmaps: [], nativeStreams: [], audienceActive: true, stageQualitySyncs: 0 };
  let timerId = 0;
  h.schedule = (callback, delay) => {
    const timer = { callback, delay, id: ++timerId };
    h.scheduled.push(timer);
    h.timers.set(timer.id, timer);
    return timer.id;
  };
  h.cancel = (id) => h.timers.delete(id);
  h.next = () => {
    assert.ok(h.timers.size, "a snapshot refresh is scheduled");
    const timer = h.timers.values().next().value;
    h.timers.delete(timer.id);
    return timer.callback();
  };
  h.stream = (canvas = false, audio = false) => {
    function track(kind) {
      return { kind, readyState: "live", enabled: true, stops: 0, listeners: [], constraints: [],
        stop() { this.stops++; this.readyState = "ended"; }, // Deliberately does not emit ended.
        addEventListener(type, callback, options) {
          assert.equal(type, "ended"); assert.equal(options.once, true); this.listeners.push(callback);
        },
        emitEnded() { this.readyState = "ended"; for (const callback of this.listeners.splice(0)) callback(); },
        async applyConstraints(value) {
          this.constraints.push(value);
          assert.equal(canvas, false, "canvas snapshot tracks never receive native constraints");
        },
      };
    }
    const video = track("video"), tracks = audio ? [video, track("audio")] : [video];
    return { getTracks: () => tracks, getVideoTracks: () => [video], getAudioTracks: () => tracks.filter((t) => t.kind === "audio") };
  };
  h.native = (audio = false) => {
    const stream = h.stream(false, audio);
    h.nativeStreams.push(stream);
    return stream;
  };
  h.document = { createElement(tag) {
    assert.equal(tag, "canvas", "snapshots use a DOM canvas, never audience media/RTC elements");
    const stream = h.stream(true);
    const canvas = { width: 0, height: 0, captures: [], draws: [], fills: [], stream,
      getContext(kind) { assert.equal(kind, "2d"); return context; },
      captureStream(fps) { this.captures.push(fps); return stream; },
    };
    const context = {
      fillRect(...args) { canvas.fills.push([this.fillStyle, ...args]); },
      drawImage(...args) { canvas.draws.push(args); },
    };
    h.canvases.push(canvas);
    return canvas;
  } };
  h.decode = async () => {
    const bitmap = { closes: 0, close() { this.closes++; } };
    h.bitmaps.push(bitmap);
    return bitmap;
  };
  h.getSource = async (target) => ({ mode: "snapshot", sessionId: `${target}-window-1` });
  h.getFrame = async ({ sessionId }) => frame(sessionId);
  h.getAudienceSource = async () => ({ available: true, sourceKey: "audience-content-1" });
  h.getAvailable = async () => true;
  h.setTarget = async (target) => { h.target = target; };
  h.nativeCapture = async () => assert.fail("snapshots must never request native display capture");
  const s = {
    document: h.document, console: { error: (...args) => h.errors.push(args) },
    navigator: { mediaDevices: {
      getDisplayMedia(options) { h.events.push(`gdm:${h.target}`); return h.nativeCapture(options); },
      getUserMedia() { assert.fail("no native WINDOW acquisition for presentation snapshots"); },
      enumerateDevices() { assert.fail("no source/device enumeration for snapshots"); },
    } },
    presentationPreviewSnapshots: new WeakMap(), displayMediaCaptureRequestChain: Promise.resolve(),
    streamRendererPreviewStream: null, streamRendererPreviewStartPromise: null,
    streamRendererPreviewQualityMode: null, streamRendererPreviewSourceKey: "", audienceCaptureGeneration: 0,
    lowerThirdRendererPreviewStream: null, lowerThirdRendererPreviewStartPromise: null,
    stageAudienceRelay: null, confidenceMonitorPopoutActive: false,
    currentMode: "media", MEDIAPLAYER: "media", STREAMPLAYER: "streams", bibleLowerThirdOutputActive: true,
    RENDERER_CAPTURE_QUALITY_STREAMS: "streams", RENDERER_CAPTURE_QUALITY_CONFIDENCE: "confidence",
    RENDERER_CAPTURE_QUALITY_CONFIDENCE_PIP: "confidence-pip",
    audienceVideo: sink(), lowerThirdVideo: sink(),
    sharedAudienceCaptureActive: () => h.audienceActive,
    getLowerThirdConfidenceMonitorElement: () => s.lowerThirdVideo,
    disableNativeVideoControls(video) { video.controls = false; },
    syncRendererCaptureSinks(stream) {
      if (stream) {
        h.beforeAttach?.(stream);
        s.syncRendererCaptureQuality(stream);
        s.prepareRendererCaptureElement(s.audienceVideo, stream);
      } else s.hideRendererCaptureElement(s.audienceVideo);
    },
    syncConfidenceMonitorCarousel() {},
    syncStageRendererPreviewCaptureQuality() { h.stageQualitySyncs++; },
    async invoke(channel, payload) {
      h.requests.push({ channel, payload });
      if (channel === "presentation-preview-source") { h.events.push(`source:${payload}`); return h.getSource(payload); }
      if (channel === "presentation-preview-frame") return h.getFrame(payload);
      if (channel === "set-display-media-capture-target") { h.events.push(`target:${payload}`); return h.setTarget(payload); }
      if (channel === "stage-audience-source") return h.getAudienceSource();
      if (channel === "media-window-capture-available") return h.getAvailable(payload);
      assert.fail(`unexpected IPC ${channel}`);
    },
    createStagePreviewSnapshot(options) {
      const record = { options, disposals: 0 };
      h.snapshots.push(record);
      const snapshot = createStagePreviewSnapshot({ ...options, schedule: h.schedule, cancel: h.cancel,
        decode: (blob) => h.decode(blob) });
      record.snapshot = snapshot;
      return { stream: snapshot.stream, dispose() { record.disposals++; snapshot.dispose(); } };
    },
  };
  vm.createContext(s);
  for (const name of ["activeRendererCaptureQualityMode", "rendererCaptureVideoConstraints", "rendererCaptureRequestOptions",
    "createPresentationPreviewSnapshotStream", "stopRendererCaptureStream", "captureElectronPresentationWindow",
    "syncRendererCaptureQuality", "syncLowerThirdRendererPreviewCaptureQuality", "syncConfidenceCaptureQualityForPopout",
    "disableCapturedAudioTracks", "prepareRendererCaptureElement", "hideRendererCaptureElement",
    "stopStreamRendererPreviewCapture", "startStreamRendererPreviewCapture",
    "stopLowerThirdRendererPreviewCapture", "startLowerThirdRendererPreviewCapture"]) {
    vm.runInContext(fn(name), s);
  }
  h.s = s;
  h.calls = (channel) => h.requests.filter((request) => request.channel === channel);
  h.assertDisposed = (index) => {
    const record = h.snapshots[index];
    assert.equal(record.disposals, 1, "the owning snapshot disposer runs exactly once");
    assert.equal(record.snapshot.stream.getVideoTracks()[0].stops, 1);
    assert.equal(record.options.isCurrent(), false);
  };
  h.cleanup = () => {
    s.stopStreamRendererPreviewCapture({ force: true });
    s.stopLowerThirdRendererPreviewCapture();
    for (const { snapshot } of h.snapshots) s.stopRendererCaptureStream(snapshot.stream);
    for (const stream of h.nativeStreams) s.stopRendererCaptureStream(stream);
    assert.equal(h.timers.size, 0);
  };
  return h;
}

for (const target of ["media", "lower-third"]) {
  test(`${target}: source gate creates one silent 10fps canvas with bound frame IPC, without native APIs`, async (t) => {
    const h = harness(), s = h.s; t.after(h.cleanup);
    delete s.navigator.mediaDevices.getDisplayMedia;
    const stream = await s.captureElectronPresentationWindow(target);
    assert.deepEqual(h.requests, [{ channel: "presentation-preview-source", payload: target }]);
    assert.equal(stream, h.snapshots[0].snapshot.stream);
    assert.equal(h.snapshots[0].options.isCurrent(), true, "onStream initialized liveness synchronously without a TDZ");
    assert.equal(s.presentationPreviewSnapshots.has(stream), true);
    assert.deepEqual(stream.getAudioTracks(), []);
    assert.deepEqual(h.canvases[0].captures, [10]);
    assert.deepEqual(h.canvases[0].fills, [["#000", 0, 0, 640, 360]]);
    assert.equal(h.scheduled[0].delay, 0);
    for (let i = 0; i < 3; i++) await h.next();
    assert.equal(h.canvases[0].draws.length, 3);
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls("presentation-preview-frame")[0].payload)),
      { target, sessionId: `${target}-window-1` });
    assert.equal(h.scheduled.at(-1).delay, 100);
    assert.ok(h.bitmaps.every((bitmap) => bitmap.closes === 1));
    assert.deepEqual(h.errors, []);
  });
}

test("only media/lower-third are valid targets, and unavailable/malformed modes never fall through to native", async (t) => {
  const h = harness(), s = h.s; t.after(h.cleanup);
  for (const target of ["stage", "audience", "", undefined, null, {}]) {
    await assert.rejects(s.captureElectronPresentationWindow(target), /Unsupported presentation preview target/);
  }
  assert.equal(h.requests.length, 0);
  for (const source of [null, {}, { mode: "unavailable" }, { mode: "other" },
    { mode: "snapshot" }, { mode: "snapshot", sessionId: "" }, { mode: "snapshot", sessionId: 7 }]) {
    h.getSource = async () => source;
    await assert.rejects(s.captureElectronPresentationWindow("media"), /unavailable/);
  }
  h.getSource = async () => { throw new Error("window lost"); };
  await assert.rejects(s.captureElectronPresentationWindow("media"), /window lost/);
  assert.equal(h.canvases.length, 0);
  assert.equal(h.calls("set-display-media-capture-target").length, 0);
});

test("native mode preserves the serialized set-target/getDisplayMedia chain across both targets", async (t) => {
  const h = harness(), s = h.s, pending = deferred(); t.after(h.cleanup);
  h.getSource = async () => ({ mode: "native" });
  const firstStream = h.native(), secondStream = h.native();
  const options = [];
  h.nativeCapture = (value) => { options.push(value); return options.length === 1 ? pending.promise : Promise.resolve(secondStream); };
  const first = s.captureElectronPresentationWindow("media"), second = s.captureElectronPresentationWindow("lower-third");
  await settle();
  assert.deepEqual(h.events, ["source:media", "source:lower-third", "target:media", "gdm:media"]);
  pending.resolve(firstStream);
  assert.equal(await first, firstStream); assert.equal(await second, secondStream);
  assert.deepEqual(h.events.slice(-2), ["target:lower-third", "gdm:lower-third"]);
  assert.ok(options.every((value) => value.video === true && value.audio === false));
  assert.equal(h.snapshots.length, 0);
});

for (const phase of ["set-target", "getDisplayMedia"]) {
  test(`native ${phase} rejection cannot poison the next serialized request`, async (t) => {
    const h = harness(), s = h.s; t.after(h.cleanup);
    h.getSource = async () => ({ mode: "native" });
    const stream = h.native();
    let attempts = 0;
    if (phase === "set-target") h.setTarget = async () => { if (++attempts === 1) throw new Error("native denied"); };
    h.nativeCapture = async () => {
      if (phase === "getDisplayMedia" && ++attempts === 1) throw new Error("native denied");
      return stream;
    };
    await assert.rejects(s.captureElectronPresentationWindow("media"), /native denied/);
    assert.equal(await s.captureElectronPresentationWindow("lower-third"), stream);
    assert.equal(h.snapshots.length, 0, "native failure does not bypass main with a snapshot fallback");
  });
}

test("a snapshot source does not wait behind an outstanding native permission/acquisition", async (t) => {
  const h = harness(), s = h.s, pending = deferred(); t.after(h.cleanup);
  h.getSource = async (target) => target === "media" ? { mode: "native" } : { mode: "snapshot", sessionId: "lt" };
  h.nativeCapture = () => pending.promise;
  const native = s.captureElectronPresentationWindow("media"); await settle();
  const snapshot = await s.captureElectronPresentationWindow("lower-third");
  assert.equal(snapshot, h.snapshots[0].snapshot.stream);
  assert.equal(h.calls("set-display-media-capture-target").length, 1);
  pending.resolve(h.native()); await native;
});

test("audience/lower-third attach real snapshot streams without gDM support; all quality paths preserve 10fps", async (t) => {
  const h = harness(), s = h.s; t.after(h.cleanup);
  delete s.navigator.mediaDevices.getDisplayMedia;
  await Promise.all([s.startStreamRendererPreviewCapture(), s.startLowerThirdRendererPreviewCapture()]);
  const audience = s.streamRendererPreviewStream, lowerThird = s.lowerThirdRendererPreviewStream;
  assert.ok(audience); assert.ok(lowerThird);
  assert.equal(s.audienceVideo.srcObject, audience); assert.equal(s.lowerThirdVideo.srcObject, lowerThird);
  for (const mode of ["confidence-pip", "streams", "confidence"]) {
    s.confidenceMonitorPopoutActive = mode === "confidence-pip";
    s.currentMode = mode === "streams" ? "streams" : "media";
    s.syncConfidenceCaptureQualityForPopout();
    s.streamRendererPreviewQualityMode = "unchanged";
    s.syncRendererCaptureQuality(audience, mode);
    s.syncRendererCaptureQuality(lowerThird, mode);
    s.syncLowerThirdRendererPreviewCaptureQuality(lowerThird);
    assert.equal(s.streamRendererPreviewQualityMode, "unchanged", "canvas streams do not poison the native quality cache");
  }
  for (const canvas of h.canvases) {
    assert.deepEqual(canvas.captures, [10]);
    assert.equal(canvas.stream.getVideoTracks()[0].constraints.length, 0);
  }
  assert.equal(h.stageQualitySyncs, 3, "stage quality remains on its existing independent path");
  assert.equal(h.errors.length, 0);
  s.stopStreamRendererPreviewCapture({ force: true }); s.stopLowerThirdRendererPreviewCapture();
  h.assertDisposed(0); h.assertDisposed(1);
});

test("native audience/lower-third quality updates and audio suppression are preserved", async (t) => {
  const h = harness(), s = h.s; t.after(h.cleanup);
  h.getSource = async () => ({ mode: "native" });
  h.nativeCapture = async () => h.native(true);
  await Promise.all([s.startStreamRendererPreviewCapture(), s.startLowerThirdRendererPreviewCapture()]);
  s.confidenceMonitorPopoutActive = true;
  s.syncConfidenceCaptureQualityForPopout();
  for (const stream of [s.streamRendererPreviewStream, s.lowerThirdRendererPreviewStream]) {
    const constraints = stream.getVideoTracks()[0].constraints;
    assert.equal(constraints[0].width.ideal, 426);
    assert.equal(constraints.at(-1).width.ideal, 1280);
    assert.equal(constraints.at(-1).frameRate.max, 30);
    assert.equal(stream.getAudioTracks()[0].readyState, "ended");
    assert.equal(stream.getAudioTracks()[0].enabled, false);
  }
  assert.equal(h.snapshots.length, 0);
});

test("explicit disposal cancels timers immediately without ended events, and is idempotent for canvas/native streams", async (t) => {
  const h = harness(), s = h.s; t.after(h.cleanup);
  const stream = await s.captureElectronPresentationWindow("media"), staleTimer = h.scheduled[0];
  s.stopRendererCaptureStream(stream); s.stopRendererCaptureStream(stream); s.stopRendererCaptureStream(null);
  h.assertDisposed(0); assert.equal(h.timers.size, 0);
  await staleTimer.callback();
  assert.equal(h.calls("presentation-preview-frame").length, 0);
  assert.equal(s.presentationPreviewSnapshots.has(stream), true, "disposed canvas streams still skip native quality");
  s.syncRendererCaptureQuality(stream); s.syncLowerThirdRendererPreviewCaptureQuality(stream);
  const native = h.native();
  s.stopRendererCaptureStream(native); s.stopRendererCaptureStream(native);
  assert.equal(native.getVideoTracks()[0].stops, 1);
});

test("track ended disposes snapshots, while bare stop is also detected by the liveness guard", async (t) => {
  const h = harness(), s = h.s; t.after(h.cleanup);
  const ended = await s.captureElectronPresentationWindow("media");
  ended.getVideoTracks()[0].emitEnded();
  h.assertDisposed(0); assert.equal(h.timers.size, 0);
  const stopped = await s.captureElectronPresentationWindow("lower-third");
  stopped.getVideoTracks()[0].stop();
  assert.equal(h.snapshots[1].options.isCurrent(), false);
  await h.next();
  assert.equal(h.calls("presentation-preview-frame").length, 0);
  assert.equal(h.timers.size, 0);
});

test("frame errors retry and foreign sessions never paint or trigger a native fallback", async (t) => {
  const h = harness(), s = h.s; t.after(h.cleanup);
  const stream = await s.captureElectronPresentationWindow("media");
  h.getFrame = async () => { throw new Error("temporary capturePage failure"); };
  await h.next();
  assert.equal(h.errors.length, 1); assert.equal(h.snapshots[0].disposals, 0);
  assert.equal(stream.getVideoTracks()[0].readyState, "live");
  assert.equal(h.timers.size, 1);
  h.getFrame = async () => frame("replaced-window"); await h.next();
  assert.equal(h.canvases[0].draws.length, 0);
  h.getFrame = async ({ sessionId }) => frame(sessionId); await h.next();
  assert.equal(h.canvases[0].draws.length, 1);
  assert.equal(h.calls("presentation-preview-source").length, 1);
  assert.equal(h.calls("set-display-media-capture-target").length, 0);
});

for (const phase of ["frame", "decode"]) for (const outcome of ["resolve", "reject"]) {
  test(`disposal during pending ${phase}: late ${outcome} cannot paint, reschedule or report errors`, async (t) => {
    const h = harness(), s = h.s, wait = deferred(); t.after(h.cleanup);
    const stream = await s.captureElectronPresentationWindow("media");
    if (phase === "frame") h.getFrame = () => wait.promise;
    else h.decode = () => wait.promise;
    const refresh = h.next(); await settle();
    s.stopRendererCaptureStream(stream);
    const bitmap = { closes: 0, close() { this.closes++; } };
    if (outcome === "reject") wait.reject(new Error("obsolete snapshot work"));
    else wait.resolve(phase === "frame" ? frame("media-window-1") : bitmap);
    await refresh;
    assert.equal(bitmap.closes, phase === "decode" && outcome === "resolve" ? 1 : 0);
    h.assertDisposed(0); assert.equal(h.timers.size, 0);
    assert.equal(h.canvases[0].draws.length, 0); assert.equal(h.errors.length, 0);
  });
}

test("audience latest-source replacement disposes the unpublished snapshot before restarting", async (t) => {
  const h = harness(), s = h.s, latest = deferred(); t.after(h.cleanup);
  let checks = 0;
  h.getAudienceSource = async () => {
    checks++;
    if (checks === 2) return latest.promise;
    return { available: true, sourceKey: checks === 1 ? "old-content" : "new-content" };
  };
  const first = s.startStreamRendererPreviewCapture(); await settle();
  const staleTimer = h.scheduled[0];
  assert.equal(h.snapshots.length, 1); assert.equal(s.audienceVideo.srcObject, null);
  latest.resolve({ available: true, sourceKey: "new-content" });
  const current = await first;
  h.assertDisposed(0);
  assert.equal(h.snapshots.length, 2);
  assert.equal(current, h.snapshots[1].snapshot.stream);
  assert.equal(s.streamRendererPreviewSourceKey, "new-content");
  assert.equal(s.audienceVideo.srcObject, current); assert.equal(s.audienceVideo.plays, 1);
  assert.equal(h.timers.size, 1);
  const requests = h.requests.length; await staleTimer.callback();
  assert.equal(h.requests.length, requests);
});

for (const outcome of ["resolve", "reject"]) {
  test(`audience invalidation during latest-source IPC: old ${outcome} releases only its own stream`, async (t) => {
    const h = harness(), s = h.s, latest = deferred(); t.after(h.cleanup);
    let checks = 0;
    h.getAudienceSource = async () => ++checks === 2 ? latest.promise : { available: true, sourceKey: "content" };
    const old = s.startStreamRendererPreviewCapture(); await settle();
    s.stopStreamRendererPreviewCapture({ force: true });
    const replacement = await s.startStreamRendererPreviewCapture();
    if (outcome === "resolve") latest.resolve({ available: true, sourceKey: "obsolete" });
    else latest.reject(new Error("old latest-source IPC failed"));
    assert.equal(await old, null);
    h.assertDisposed(0);
    assert.equal(s.streamRendererPreviewStream, replacement);
    assert.equal(s.audienceVideo.srcObject, replacement);
    assert.equal(replacement.getVideoTracks()[0].stops, 0);
    assert.equal(h.timers.size, 1);
  });
}

for (const target of ["media", "lower-third"]) for (const outcome of ["resolve", "reject"]) {
  test(`${target}: obsolete source-gate ${outcome} cannot clear or stop a pending replacement`, async (t) => {
    const h = harness(), s = h.s, oldGate = deferred(), newGate = deferred(); t.after(h.cleanup);
    let calls = 0;
    h.getSource = () => ++calls === 1 ? oldGate.promise : newGate.promise;
    const audience = target === "media";
    const start = () => audience ? s.startStreamRendererPreviewCapture() : s.startLowerThirdRendererPreviewCapture();
    const stop = () => audience ? s.stopStreamRendererPreviewCapture({ force: true }) : s.stopLowerThirdRendererPreviewCapture();
    const getPending = () => audience ? s.streamRendererPreviewStartPromise : s.lowerThirdRendererPreviewStartPromise;
    const old = start(); await settle(); stop();
    const replacement = start(); await settle(); const owner = getPending();
    assert.ok(owner);
    if (outcome === "resolve") oldGate.resolve({ mode: "snapshot", sessionId: "old-window" });
    else oldGate.reject(new Error("obsolete source failed"));
    await old;
    assert.equal(getPending(), owner, "obsolete finally must not clear the new pending acquisition");
    if (outcome === "resolve") h.assertDisposed(0);
    newGate.resolve({ mode: "snapshot", sessionId: "new-window" }); await replacement;
    const current = audience ? s.streamRendererPreviewStream : s.lowerThirdRendererPreviewStream;
    assert.equal(current, h.snapshots.at(-1).snapshot.stream);
    assert.equal(current.getVideoTracks()[0].stops, 0);
    assert.equal(h.timers.size, 1);
  });
}

for (const outcome of ["resolve", "reject"]) {
  test(`lower-third stale availability ${outcome} cannot hide a replacement stream`, async (t) => {
    const h = harness(), s = h.s, available = deferred(); t.after(h.cleanup);
    let calls = 0;
    h.getAvailable = () => ++calls === 1 ? available.promise : Promise.resolve(true);
    const old = s.startLowerThirdRendererPreviewCapture(); await settle();
    s.stopLowerThirdRendererPreviewCapture();
    await s.startLowerThirdRendererPreviewCapture();
    const current = s.lowerThirdRendererPreviewStream;
    if (outcome === "resolve") available.resolve(false);
    else available.reject(new Error("old availability failed"));
    await old;
    assert.equal(s.lowerThirdRendererPreviewStream, current);
    assert.equal(s.lowerThirdVideo.srcObject, current);
    assert.equal(s.lowerThirdVideo.hidden, false);
    assert.equal(current.getVideoTracks()[0].stops, 0);
    assert.equal(h.snapshots.length, 1);
  });
}

for (const target of ["media", "lower-third"]) {
  test(`${target}: losing capture eligibility while the source gate is pending disposes the late stream`, async (t) => {
    const h = harness(), s = h.s, gate = deferred(); t.after(h.cleanup);
    h.getSource = () => gate.promise;
    const pending = target === "media" ? s.startStreamRendererPreviewCapture() : s.startLowerThirdRendererPreviewCapture();
    await settle();
    if (target === "media") h.audienceActive = false;
    else s.currentMode = "streams";
    gate.resolve({ mode: "snapshot", sessionId: "late-window" }); await pending;
    h.assertDisposed(0); assert.equal(h.timers.size, 0);
    assert.equal(s.audienceVideo.srcObject, null); assert.equal(s.lowerThirdVideo.srcObject, null);
  });
}

test("lower-third repeated starts share acquisition and reuse one live snapshot; stale ended cannot stop its replacement", async (t) => {
  const h = harness(), s = h.s, gate = deferred(); t.after(h.cleanup);
  h.getSource = () => gate.promise;
  const first = s.startLowerThirdRendererPreviewCapture(), concurrent = s.startLowerThirdRendererPreviewCapture();
  await settle(); assert.equal(h.calls("presentation-preview-source").length, 1);
  gate.resolve({ mode: "snapshot", sessionId: "first" }); await Promise.all([first, concurrent]);
  const old = s.lowerThirdRendererPreviewStream;
  for (let i = 0; i < 5; i++) await s.startLowerThirdRendererPreviewCapture();
  assert.equal(h.snapshots.length, 1);
  s.stopLowerThirdRendererPreviewCapture();
  h.getSource = async () => ({ mode: "snapshot", sessionId: "second" });
  await s.startLowerThirdRendererPreviewCapture();
  const replacement = s.lowerThirdRendererPreviewStream;
  old.getVideoTracks()[0].emitEnded();
  h.assertDisposed(0);
  assert.equal(s.lowerThirdRendererPreviewStream, replacement);
  assert.equal(s.lowerThirdVideo.srcObject, replacement);
  assert.equal(replacement.getVideoTracks()[0].stops, 0);
});

test("audience repeated starts reuse one live snapshot and stale ended cannot tear down its replacement", async (t) => {
  const h = harness(), s = h.s; t.after(h.cleanup);
  const old = await s.startStreamRendererPreviewCapture();
  for (let i = 0; i < 5; i++) assert.equal(await s.startStreamRendererPreviewCapture(), old);
  assert.equal(h.snapshots.length, 1);
  assert.equal(h.calls("presentation-preview-source").length, 1);
  s.stopStreamRendererPreviewCapture({ force: true });
  const replacement = await s.startStreamRendererPreviewCapture();
  old.getVideoTracks()[0].emitEnded();
  h.assertDisposed(0);
  assert.equal(s.streamRendererPreviewStream, replacement);
  assert.equal(s.audienceVideo.srcObject, replacement);
  assert.equal(replacement.getVideoTracks()[0].stops, 0);
  assert.equal(h.timers.size, 1);
});

test("audience attachment exceptions release the acquired snapshot even after publication begins", async (t) => {
  const h = harness(), s = h.s; t.after(h.cleanup);
  h.beforeAttach = () => { throw new Error("sink removed"); };
  assert.equal(await s.startStreamRendererPreviewCapture(), null);
  h.assertDisposed(0); assert.equal(h.timers.size, 0);
  assert.equal(s.streamRendererPreviewStream, null);
  assert.equal(h.errors.length, 1);
});

test("unavailable windows follow the existing caught-error lifecycle without losing replacement capture", async (t) => {
  const h = harness(), s = h.s; t.after(h.cleanup);
  h.getSource = async () => ({ mode: "unavailable" });
  await Promise.all([s.startStreamRendererPreviewCapture(), s.startLowerThirdRendererPreviewCapture()]);
  assert.equal(h.errors.length, 2); assert.equal(h.snapshots.length, 0);
  assert.equal(s.streamRendererPreviewStartPromise, null); assert.equal(s.lowerThirdRendererPreviewStartPromise, null);
  h.getSource = async (target) => ({ mode: "snapshot", sessionId: target });
  await Promise.all([s.startStreamRendererPreviewCapture(), s.startLowerThirdRendererPreviewCapture()]);
  assert.ok(s.audienceVideo.srcObject); assert.ok(s.lowerThirdVideo.srcObject);
});