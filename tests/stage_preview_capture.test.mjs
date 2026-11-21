import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

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
async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
function videoSink() {
  return { srcObject: null, hidden: true, plays: 0, pauses: 0,
    async play() { this.plays++; }, pause() { this.pauses++; } };
}
function captureStream({ audio = false, snapshot = false } = {}) {
  const track = (kind) => ({
    kind, enabled: true, readyState: "live", stops: 0, ended: [], constraints: [],
    stop() { this.stops++; this.readyState = "ended"; },
    addEventListener(type, callback, options) {
      assert.equal(type, "ended"); assert.equal(options.once, true);
      this.ended.push(callback);
    },
    emitEnded() { this.readyState = "ended"; for (const callback of this.ended) callback(); },
    async applyConstraints(value) {
      assert.equal(snapshot, false, "snapshot tracks must never get native quality constraints");
      this.constraints.push(JSON.parse(JSON.stringify(value)));
    },
  });
  const video = track("video"), sound = audio ? [track("audio")] : [];
  return { getTracks: () => [video, ...sound], getVideoTracks: () => [video], getAudioTracks: () => sound };
}
const source = (sessionId = "session-a", sourceId = "window:12345:0") => ({ sessionId, sourceId });

function harness() {
  const s = {
    document: {}, currentMode: "media", MEDIAPLAYER: "media", stageAudienceRelay: null,
    RENDERER_CAPTURE_QUALITY_STREAMS: "streams", RENDERER_CAPTURE_QUALITY_CONFIDENCE: "confidence",
    RENDERER_CAPTURE_QUALITY_CONFIDENCE_PIP: "confidence-pip", confidenceMonitorPopoutActive: false,
    latestOutputStatus: { sessionId: "session-a", stage: { window: "open", health: "ok", sessionId: "not-top-level" } },
    stageRendererPreviewConnection: null, streamRendererPreviewStream: null,
    streamRendererPreviewQualityMode: "audience-cache", lowerThirdRendererPreviewStream: null,
    video: videoSink(), sources: [], captures: [], snapshots: [], errors: [], carousels: 0,
    console: { error: (...args) => s.errors.push(args) },
    getStageConfidenceMonitorElement: () => s.video,
    disableNativeVideoControls(video) { video.controls = false; },
    syncConfidenceMonitorCarousel() { s.carousels++; },
    getSource: async ({ sessionId }) => source(sessionId),
    acquire: async () => captureStream(),
    invoke(channel, payload) {
      assert.equal(channel, "stage-preview-source");
      assert.deepEqual(Object.keys(payload), ["sessionId"]);
      s.sources.push(payload.sessionId);
      return s.getSource(payload);
    },
    navigator: { userActivation: { isActive: false, hasBeenActive: false }, mediaDevices: {
      getUserMedia(options) { s.captures.push(options); return s.acquire(options); },
      getDisplayMedia() { assert.fail("stage must never use WebFrameMain/tab capture"); },
      enumerateDevices() { assert.fail("fixed source requires no enumeration"); },
    } },
    captureElectronPresentationWindow() { assert.fail("stage tab helper remains forbidden"); },
    createStagePreviewSnapshot(options) {
      const stream = captureStream({ snapshot: true });
      const preview = { ...options, stream, disposes: 0, dispose() {
        if (this.disposes) return;
        this.disposes++;
        stream.getTracks().forEach((track) => track.stop());
      } };
      s.snapshots.push(preview);
      if (options.isCurrent()) options.onStream(stream);
      return preview;
    },
  };
  vm.createContext(s);
  for (const name of ["activeRendererCaptureQualityMode", "rendererCaptureVideoConstraints", "syncRendererCaptureQuality",
    "disableCapturedAudioTracks", "prepareRendererCaptureElement", "hideRendererCaptureElement",
    "stopStageRendererPreviewCapture", "syncStageRendererPreviewCaptureQuality", "syncConfidenceCaptureQualityForPopout",
    "syncStageRendererPreviewCapture"]) vm.runInContext(fn(name), s);
  return s;
}

test("native fixed WINDOW capture needs no activation, attaches once, mutes and stops unexpected audio", async () => {
  const s = harness(), stream = captureStream({ audio: true });
  s.acquire = async () => stream;
  await s.syncStageRendererPreviewCapture();
  const connection = s.stageRendererPreviewConnection;
  assert.equal(connection.pending, false);
  assert.equal(connection.preview, null);
  assert.equal(connection.stream, stream);
  assert.equal(s.video.srcObject, stream);
  assert.deepEqual(JSON.parse(JSON.stringify(s.captures)), [{ audio: false, video: { mandatory: {
    chromeMediaSource: "desktop", chromeMediaSourceId: "window:12345:0", maxWidth: 640, maxHeight: 360, maxFrameRate: 30,
  } } }]);
  assert.deepEqual(s.sources, ["session-a"]);
  assert.equal(s.navigator.userActivation.isActive, false);
  assert.equal(s.navigator.userActivation.hasBeenActive, false);
  assert.equal(s.video.muted, true); assert.equal(s.video.defaultMuted, true); assert.equal(s.video.volume, 0);
  assert.equal(s.video.controls, false); assert.equal(s.video.hidden, false);
  assert.equal(stream.getAudioTracks()[0].enabled, false);
  assert.equal(stream.getAudioTracks()[0].stops, 1);
  for (let i = 0; i < 20; i++) {
    s.latestOutputStatus = { ...s.latestOutputStatus, audience: { content: `cue-${i}` } };
    await s.syncStageRendererPreviewCapture();
  }
  assert.equal(s.captures.length, 1); assert.equal(s.sources.length, 1);
  assert.equal(s.video.plays, 1); assert.equal(s.video.pauses, 0);
  assert.equal(s.snapshots.length, 0);
  assert.equal(s.streamRendererPreviewQualityMode, "audience-cache");
  s.stopStageRendererPreviewCapture(); s.stopStageRendererPreviewCapture(connection);
  assert.ok(stream.getTracks().every((track) => track.stops === 1));
  assert.equal(s.video.srcObject, null); assert.equal(s.video.hidden, true);
  assert.equal(s.video.pauses, 1);
  assert.deepEqual(s.errors, []);
});

for (const phase of ["source", "capture"]) {
  test(`concurrent statuses reuse the published connection while ${phase} is pending`, async () => {
    const s = harness(), wait = deferred(), stream = captureStream();
    if (phase === "source") s.getSource = () => wait.promise;
    else s.acquire = () => wait.promise;
    const pending = s.syncStageRendererPreviewCapture(); await settle();
    const connection = s.stageRendererPreviewConnection;
    assert.equal(connection.pending, true);
    await Promise.all(Array.from({ length: 30 }, () => s.syncStageRendererPreviewCapture()));
    assert.equal(s.stageRendererPreviewConnection, connection);
    assert.equal(s.sources.length, 1);
    assert.equal(s.captures.length, phase === "source" ? 0 : 1);
    wait.resolve(phase === "source" ? source() : stream);
    await pending;
    assert.equal(s.stageRendererPreviewConnection, connection);
    assert.equal(s.sources.length, 1); assert.equal(s.captures.length, 1);
    assert.equal(s.video.plays, 1); assert.equal(s.snapshots.length, 0);
    s.stopStageRendererPreviewCapture();
  });
}

test("readiness statuses defer all work until health is ok, then acquire once", async () => {
  const s = harness();
  for (const health of [undefined, "starting", "unresponsive", "error"]) {
    s.latestOutputStatus.stage.health = health;
    await s.syncStageRendererPreviewCapture();
    assert.equal(s.stageRendererPreviewConnection, null);
  }
  assert.equal(s.sources.length, 0); assert.equal(s.snapshots.length, 0);
  s.latestOutputStatus.stage.health = "ok";
  await s.syncStageRendererPreviewCapture();
  assert.equal(s.captures.length, 1);
  s.stopStageRendererPreviewCapture();
});

for (const reply of [null, {}, source("wrong-session"),
  source("session-a", "window:0:0"), source("session-a", "window:000:1"),
  source("session-a", "screen:123:0"), source("session-a", "web-contents-media-stream://1:2"),
  source("session-a", "window:-1:0"), source("session-a", "window:1:-1"), source("session-a", "window:1"),
  source("session-a", "window:1:0\n"), source("session-a", "window:1:0:2"),
  source("session-a", 123), { sessionId: "session-a" }]) {
  test(`invalid or foreign native source selects snapshots: ${JSON.stringify(reply)}`, async () => {
    const s = harness(); s.getSource = async () => reply;
    await s.syncStageRendererPreviewCapture();
    assert.equal(s.captures.length, 0); assert.equal(s.snapshots.length, 1);
    assert.equal(s.video.srcObject, s.snapshots[0].stream);
    for (let i = 0; i < 5; i++) await s.syncStageRendererPreviewCapture();
    assert.equal(s.sources.length, 1, "no native retries on repeated statuses");
    s.stopStageRendererPreviewCapture();
    assert.equal(s.snapshots[0].disposes, 1);
  });
}

for (const failure of ["source rejection", "source throw", "missing mediaDevices", "missing getUserMedia",
  "capture rejection", "capture throw", "ended video", "attachment throw"]) {
  test(`${failure} uses snapshots once, never a native retry loop`, async () => {
    const s = harness(), stream = captureStream({ audio: true });
    if (failure === "source rejection") s.getSource = async () => { throw new Error("IPC"); };
    if (failure === "source throw") s.getSource = () => { throw new Error("IPC sync"); };
    if (failure === "missing mediaDevices") delete s.navigator.mediaDevices;
    if (failure === "missing getUserMedia") delete s.navigator.mediaDevices.getUserMedia;
    if (failure === "capture rejection") s.acquire = async () => { throw new Error("capture"); };
    if (failure === "capture throw") s.acquire = () => { throw new Error("capture sync"); };
    if (failure === "ended video") {
      stream.getVideoTracks()[0].readyState = "ended";
      s.acquire = async () => stream;
    }
    if (failure === "attachment throw") {
      s.acquire = async () => stream;
      const prepare = s.disableNativeVideoControls;
      s.disableNativeVideoControls = (video) => {
        s.disableNativeVideoControls = prepare;
        throw new Error("attach");
      };
    }
    await s.syncStageRendererPreviewCapture();
    const connection = s.stageRendererPreviewConnection;
    assert.equal(s.snapshots.length, 1); assert.equal(s.video.srcObject, connection.preview.stream);
    if (failure === "ended video" || failure === "attachment throw") {
      assert.ok(stream.getTracks().every((track) => track.readyState === "ended"));
      stream.getVideoTracks()[0].emitEnded();
      assert.equal(s.stageRendererPreviewConnection, connection, "failed native ended cannot stop fallback");
    }
    for (let i = 0; i < 12; i++) await s.syncStageRendererPreviewCapture();
    assert.equal(s.sources.length, 1); assert.equal(s.snapshots.length, 1);
    assert.equal(s.captures.length, failure.startsWith("capture") || failure === "ended video" || failure === "attachment throw" ? 1 : 0);
    s.confidenceMonitorPopoutActive = true;
    s.syncConfidenceCaptureQualityForPopout();
    assert.deepEqual(connection.stream.getVideoTracks()[0].constraints, []);
    s.stopStageRendererPreviewCapture(); s.stopStageRendererPreviewCapture(connection);
    assert.equal(connection.preview.disposes, 1);
    assert.equal(connection.stream.getVideoTracks()[0].stops, 1);
    assert.deepEqual(s.errors, []);
  });
}

for (const phase of ["source", "capture"]) for (const change of ["session", "sink"]) for (const outcome of ["resolve", "reject"]) {
  test(`pending ${phase}, ${change} replacement: stale ${outcome} has no replacement effects`, async () => {
    const s = harness(), wait = deferred(), obsoleteStream = captureStream({ audio: true });
    const getSource = s.getSource, acquire = s.acquire;
    if (phase === "source") s.getSource = () => wait.promise;
    else s.acquire = () => wait.promise;
    const pending = s.syncStageRendererPreviewCapture(); await settle();
    const old = s.stageRendererPreviewConnection, oldVideo = s.video;
    s.getSource = getSource; s.acquire = acquire;
    if (change === "session") s.latestOutputStatus.sessionId = "session-b";
    else s.video = videoSink();
    await s.syncStageRendererPreviewCapture();
    const current = s.stageRendererPreviewConnection;
    const pauses = s.video.pauses, carousels = s.carousels;
    if (outcome === "reject") wait.reject(new Error("obsolete"));
    else wait.resolve(phase === "source" ? source() : obsoleteStream);
    await pending;
    s.stopStageRendererPreviewCapture(old);
    assert.equal(s.stageRendererPreviewConnection, current);
    assert.equal(s.video.srcObject, current.stream);
    assert.equal(s.video.pauses, pauses); assert.equal(s.carousels, carousels);
    assert.equal(s.video.hidden, false); assert.equal(s.video.plays, 1);
    assert.equal(s.snapshots.length, 0); assert.deepEqual(s.errors, []);
    assert.equal(current.stream.getVideoTracks()[0].stops, 0);
    if (phase === "source") assert.equal(s.captures.length, 1);
    if (phase === "capture" && outcome === "resolve") {
      assert.ok(obsoleteStream.getTracks().every((track) => track.stops === 1));
      assert.equal(obsoleteStream.getVideoTracks()[0].ended.length, 0, "late native stream was never attached");
    }
    if (change === "sink") assert.equal(oldVideo.srcObject, null);
    s.stopStageRendererPreviewCapture();
  });
}

for (const phase of ["source", "capture"]) for (const change of ["mode", "closed", "session", "sink", "health", "dispose"]) {
  for (const outcome of ["resolve", "reject"]) {
    test(`pending ${phase}, lose ${change}: late ${outcome} cannot attach or fall back`, async () => {
      const s = harness(), wait = deferred(), stream = captureStream({ audio: true });
      if (phase === "source") s.getSource = () => wait.promise;
      else s.acquire = () => wait.promise;
      const pending = s.syncStageRendererPreviewCapture(); await settle();
      const old = s.stageRendererPreviewConnection, sink = s.video;
      if (change === "mode") s.currentMode = "Bible";
      if (change === "closed") s.latestOutputStatus.stage.window = "closed";
      if (change === "session") s.latestOutputStatus.sessionId = "";
      if (change === "sink") s.video = null;
      if (change === "health") s.latestOutputStatus.stage.health = "starting";
      if (change === "dispose") s.stopStageRendererPreviewCapture();
      // Other cases deliberately lose identity WITHOUT another sync call.
      const carousels = s.carousels;
      if (outcome === "reject") wait.reject(new Error("obsolete"));
      else wait.resolve(phase === "source" ? source() : stream);
      await pending;
      assert.equal(s.stageRendererPreviewConnection, null);
      assert.equal(old.disposed, true); assert.equal(old.pending, false);
      assert.equal(sink.srcObject, null); assert.equal(sink.plays, 0); assert.equal(sink.pauses, 0);
      assert.equal(s.snapshots.length, 0); assert.deepEqual(s.errors, []);
      assert.equal(s.carousels, carousels + (change === "dispose" ? 0 : 1));
      if (phase === "source") assert.equal(s.captures.length, 0);
      if (phase === "capture" && outcome === "resolve") assert.ok(stream.getTracks().every((track) => track.stops === 1));
    });
  }
}

for (const change of ["session", "sink"]) {
  test(`attached native ${change} replacement ignores old ended, stop and late quality rejection`, async () => {
    const s = harness(), constraint = deferred(), first = captureStream({ audio: true });
    first.getVideoTracks()[0].applyConstraints = () => constraint.promise;
    s.acquire = async () => first;
    await s.syncStageRendererPreviewCapture();
    const old = s.stageRendererPreviewConnection, oldVideo = s.video;
    s.acquire = async () => captureStream();
    if (change === "session") s.latestOutputStatus.sessionId = "session-b";
    else s.video = videoSink();
    await s.syncStageRendererPreviewCapture();
    const current = s.stageRendererPreviewConnection, carousels = s.carousels, pauses = s.video.pauses;
    first.getVideoTracks()[0].emitEnded(); s.stopStageRendererPreviewCapture(old);
    constraint.reject(new Error("old constraints")); await settle();
    assert.equal(s.stageRendererPreviewConnection, current); assert.equal(s.video.srcObject, current.stream);
    assert.equal(s.carousels, carousels); assert.equal(s.video.pauses, pauses);
    assert.equal(s.video.hidden, false); assert.equal(current.stream.getVideoTracks()[0].stops, 0);
    assert.ok(first.getTracks().every((track) => track.stops === 1));
    if (change === "sink") assert.equal(oldVideo.srcObject, null);
    assert.deepEqual(s.errors, []);
    s.stopStageRendererPreviewCapture();
  });
}

test("current native ended cleans its sink and tracks once, without starting fallback", async () => {
  const s = harness(), stream = captureStream({ audio: true }); s.acquire = async () => stream;
  await s.syncStageRendererPreviewCapture();
  const connection = s.stageRendererPreviewConnection;
  stream.getVideoTracks()[0].emitEnded();
  s.stopStageRendererPreviewCapture(connection);
  assert.equal(s.stageRendererPreviewConnection, null);
  assert.equal(s.video.srcObject, null); assert.equal(s.video.pauses, 1); assert.equal(s.video.hidden, true);
  assert.equal(s.snapshots.length, 0); assert.equal(s.captures.length, 1);
  assert.equal(stream.getAudioTracks()[0].stops, 1);
});

test("stage native popout quality is independent of audience cache and downscales on close", async () => {
  const s = harness(), audience = captureStream();
  s.streamRendererPreviewStream = audience;
  await s.syncStageRendererPreviewCapture();
  const stage = s.stageRendererPreviewConnection.stream.getVideoTracks()[0];
  assert.equal(s.streamRendererPreviewQualityMode, "audience-cache");
  assert.deepEqual(stage.constraints.map((c) => [c.width.max, c.height.max, c.frameRate.max]), [[640, 360, 30]]);
  assert.equal(audience.getVideoTracks()[0].constraints.length, 0);
  s.confidenceMonitorPopoutActive = true;
  s.syncConfidenceCaptureQualityForPopout(); s.syncConfidenceCaptureQualityForPopout();
  assert.equal(stage.constraints.length, 2, "stage deduplicates quality independently of audience resets");
  assert.deepEqual(stage.constraints[1], { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, frameRate: { ideal: 30, max: 30 } });
  s.confidenceMonitorPopoutActive = false;
  s.syncConfidenceCaptureQualityForPopout();
  assert.deepEqual(stage.constraints[2], stage.constraints[0]);
  assert.equal(audience.getVideoTracks()[0].constraints.at(-1).width.max, 640);
  assert.equal(s.sources.length, 1); assert.equal(s.captures.length, 1); assert.equal(s.video.plays, 1);
  s.stopStageRendererPreviewCapture();
  s.syncConfidenceCaptureQualityForPopout();
  assert.equal(stage.constraints.length, 3, "disposed native track is never constrained");
});

test("native preview remains usable when quality constraints throw or reject", async () => {
  const s = harness(), stream = captureStream(); s.acquire = async () => stream;
  stream.getVideoTracks()[0].applyConstraints = () => { throw new Error("sync constraints"); };
  await s.syncStageRendererPreviewCapture();
  stream.getVideoTracks()[0].applyConstraints = async () => { throw new Error("async constraints"); };
  s.confidenceMonitorPopoutActive = true; s.syncConfidenceCaptureQualityForPopout(); await settle();
  assert.equal(s.video.srcObject, stream); assert.equal(s.snapshots.length, 0);
  assert.deepEqual(s.errors, []);
  s.stopStageRendererPreviewCapture();
});