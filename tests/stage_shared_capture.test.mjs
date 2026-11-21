import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { LocalVideoRelay } from "../src/shared/local-video-relay.mjs";

const confidence = await readFile(new URL("../src/control-window/app-confidence-monitor.mjs", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8");
function fn(source, name) {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^}`, "m"));
  assert.ok(match, name); return match[0];
}
async function settle() { for (let i = 0; i < 8; i++) await new Promise(setImmediate); }

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function captureStream() {
  const endedListeners = [];
  const track = {
    kind: "video", readyState: "live", stops: 0, constraints: [],
    stop() { this.stops++; this.readyState = "ended"; },
    addEventListener(type, callback, options) {
      assert.equal(type, "ended");
      assert.equal(options.once, true);
      endedListeners.push(callback);
    },
    emitEnded() {
      this.readyState = "ended";
      for (const callback of endedListeners.splice(0)) callback();
    },
    async applyConstraints(value) { this.constraints.push(value); },
  };
  return { getTracks: () => [track], getVideoTracks: () => [track] };
}

function deferSourceReply(state, skip = 0) {
  const reply = deferred(), requested = deferred();
  const invoke = state.invoke;
  state.invoke = (channel, ...args) => {
    if (channel === "stage-audience-source" && skip-- === 0) {
      requested.resolve();
      return reply.promise;
    }
    return invoke(channel, ...args);
  };
  return { ...reply, requested: requested.promise };
}

function deferCapture(state) {
  const capture = deferred(), requested = deferred();
  const acquire = state.navigator.mediaDevices.getDisplayMedia;
  state.navigator.mediaDevices.getDisplayMedia = () => {
    state.navigator.mediaDevices.getDisplayMedia = acquire;
    requested.resolve();
    return capture.promise;
  };
  return { ...capture, requested: requested.promise };
}

function ownerHarness() {
  const state = {
    console: { ...console, error(...args) { state.errors.push(args); } },
    queueMicrotask, currentMode: "media", MEDIAPLAYER: "media", STREAMPLAYER: "streams",
    RENDERER_CAPTURE_QUALITY_STREAMS: "full", RENDERER_CAPTURE_QUALITY_CONFIDENCE: "small",
    RENDERER_CAPTURE_QUALITY_CONFIDENCE_PIP: "pip", confidenceMonitorPopoutActive: false,
    streamRendererPreviewStream: null, streamRendererPreviewStartPromise: null,
    streamRendererPreviewQualityMode: null, streamRendererPreviewSourceKey: "",
    audienceCaptureGeneration: 0, stageAudienceRelay: null, displayMediaCaptureRequestChain: Promise.resolve(),
    source: { sourceKey: "1:audience", available: true, kind: "video" },
    captures: [], signals: [], callbacks: {}, peers: [], errors: [], sinkStreams: [],
    mediaRendererCaptureAllowedForCurrentMode: () => state.currentMode === "media",
    activeMediaRendererCaptureElements: () => state.currentMode === "media" ? [{}] : [],
    audienceOutputAvailableForConfidence: () => Boolean(state.source.sourceKey),
    networkPreviewUsesRendererCapture: () => false, syncNetworkPreviewMirrorCapture() {},
    disableCapturedAudioTracks: () => {},
    syncRendererCaptureSinks(stream = state.streamRendererPreviewStream) {
      state.sinkStreams.push(stream);
      state.syncRendererCaptureQuality(stream);
    },
    on(channel, callback) { state.callbacks[channel] = callback; },
    send(_channel, message) { state.signals.push(message); },
    async invoke(channel) { return channel === "stage-audience-source" ? { ...state.source } : true; },
    navigator: { mediaDevices: { async getDisplayMedia() {
      const stream = captureStream();
      state.captures.push(stream); return stream;
    } } },
  };
  state.LocalVideoRelay = class {
    constructor(options) { this.options = options; state.peers.push(this); }
    async start(stream) { this.stream = stream; }
    receive(message) { if (message.type === "close") this.close(); }
    close() { this.options.onClose(); }
  };
  vm.createContext(state);
  for (const name of ["activeRendererCaptureQualityMode", "rendererCaptureVideoConstraints", "rendererCaptureRequestOptions",
    "captureElectronPresentationWindow", "syncRendererCaptureQuality", "sharedAudienceCaptureActive",
    "stopStreamRendererPreviewCapture", "startStreamRendererPreviewCapture", "syncStreamRendererPreviewCapture", "installStageAudienceRelay"]) {
    vm.runInContext(fn(confidence, name), state);
  }
  state.installStageAudienceRelay();
  state.request = (peerId = "peer-1") => state.callbacks["stage-audience-relay"](null,
    { type: "request", peerId, sourceKey: state.source.sourceKey });
  return state;
}

test("stage borrows the exact existing confidence track and upgrades its quality", async () => {
  const s = ownerHarness();
  await s.startStreamRendererPreviewCapture();
  const stream = s.streamRendererPreviewStream;
  s.request(); await settle();
  assert.equal(s.captures.length, 1);
  assert.equal(s.peers[0].stream, stream);
  assert.equal(stream.getVideoTracks()[0].stops, 0);
  assert.equal(stream.getVideoTracks()[0].constraints.at(-1).frameRate.max, 30);
  assert.equal(stream.getVideoTracks()[0].constraints.at(-1).width.ideal, 1920);
});

test("stage retains one capture across workspace changes and Bible/video cues", async () => {
  const s = ownerHarness(); s.request(); await settle();
  const stream = s.streamRendererPreviewStream;
  s.currentMode = "Bible workspace";
  for (let i = 0; i < 20; i++) {
    s.source.kind = i % 2 ? "scripture" : "video";
    s.stopStreamRendererPreviewCapture();
    s.syncStreamRendererPreviewCapture();
    await settle();
  }
  assert.equal(s.captures.length, 1);
  assert.equal(s.streamRendererPreviewStream, stream);
  assert.equal(stream.getVideoTracks()[0].stops, 0);
  s.callbacks["stage-audience-relay"](null, { type: "close", peerId: "peer-1" });
  await settle();
  assert.equal(stream.getVideoTracks()[0].stops, 1);
});

test("concurrent confidence and stage startup acquires only one audience capture", async () => {
  const s = ownerHarness();
  const pending = s.startStreamRendererPreviewCapture();
  s.request();
  await pending; await settle();
  assert.equal(s.captures.length, 1);
  assert.equal(s.peers.length, 1);
});

test("closing stage leaves confidence's capture alive when still visible", async () => {
  const s = ownerHarness(); s.request(); await settle();
  s.callbacks["stage-audience-relay"](null, { type: "close", peerId: "peer-1" });
  await settle();
  assert.equal(s.captures.length, 1);
  assert.equal(s.captures[0].getVideoTracks()[0].stops, 0);
});

test("closing stage during capture acquisition discards the late stream", async () => {
  const s = ownerHarness();
  let release, stops = 0;
  s.navigator.mediaDevices.getDisplayMedia = () => new Promise((resolve) => { release = resolve; });
  s.request(); await settle();
  s.currentMode = "Bible workspace";
  s.callbacks["stage-audience-relay"](null, { type: "close", peerId: "peer-1" });
  const track = { stop() { stops++; } };
  release({ getTracks: () => [track], getVideoTracks: () => [track] });
  await settle();
  assert.equal(stops, 1);
  assert.equal(s.streamRendererPreviewStream, null);
  assert.equal(s.peers.length, 0);
});

test("a source-window replacement cannot relay the previous window's track", async () => {
  const s = ownerHarness(); s.request(); await settle();
  const old = s.captures[0];
  s.source.sourceKey = "2:replacement";
  s.request("peer-2"); await settle();
  assert.equal(s.captures.length, 2);
  assert.equal(old.getVideoTracks()[0].stops, 1);
  assert.equal(s.peers.at(-1).stream, s.captures[1]);
});

test("rapid source replacement during acquisition only attaches the latest source", async () => {
  const s = ownerHarness();
  const acquire = s.navigator.mediaDevices.getDisplayMedia;
  let release, stops = 0;
  s.navigator.mediaDevices.getDisplayMedia = () => {
    s.navigator.mediaDevices.getDisplayMedia = acquire;
    return new Promise((resolve) => { release = resolve; });
  };
  s.request("old-peer"); await settle();
  s.source.sourceKey = "2:replacement";
  s.callbacks["stage-audience-relay"](null, { type: "close", peerId: "old-peer" });
  s.request("new-peer"); await settle();
  const track = { stop() { stops++; } };
  release({ getTracks: () => [track], getVideoTracks: () => [track] });
  await settle(); await settle();
  assert.equal(stops, 1);
  assert.equal(s.peers.length, 1);
  assert.equal(s.streamRendererPreviewSourceKey, "2:replacement");
  assert.equal(s.stageAudienceRelay.peerId, "new-peer");
});

for (const outcome of ["resolve", "reject"]) {
  test(`old latest-source ${outcome} cannot overwrite a replacement capture`, async () => {
    const s = ownerHarness();
    const latest = deferSourceReply(s, 1);
    const oldStart = s.startStreamRendererPreviewCapture();
    await latest.requested;
    const oldStream = s.captures[0];
    s.stopStreamRendererPreviewCapture({ force: true });
    const replacement = await s.startStreamRendererPreviewCapture();
    const generation = s.audienceCaptureGeneration;

    if (outcome === "reject") latest.reject(new Error("old latest-source IPC failed"));
    else latest.resolve({ ...s.source });

    assert.equal(await oldStart, null);
    assert.equal(s.streamRendererPreviewStream, replacement);
    assert.equal(s.streamRendererPreviewSourceKey, s.source.sourceKey);
    assert.equal(s.audienceCaptureGeneration, generation);
    assert.equal(oldStream.getVideoTracks()[0].stops, 1);
    assert.equal(replacement.getVideoTracks()[0].stops, 0);
    assert.equal(s.sinkStreams.includes(oldStream), false);
    assert.equal(s.errors.length, 0, "latest-source rejection uses the existing fallback, not outer catch");
  });
}

test("a current latest-source rejection preserves the captured-source fallback", async () => {
  const s = ownerHarness();
  const latest = deferSourceReply(s, 1);
  const pending = s.startStreamRendererPreviewCapture();
  await latest.requested;
  latest.reject(new Error("latest-source IPC unavailable"));
  const stream = await pending;
  assert.equal(stream, s.captures[0]);
  assert.equal(s.streamRendererPreviewStream, stream);
  assert.equal(s.streamRendererPreviewSourceKey, s.source.sourceKey);
  assert.equal(stream.getVideoTracks()[0].stops, 0);
  assert.equal(s.errors.length, 0);
});

test("stopping while latest-source IPC is pending discards the stream without a restart", async () => {
  const s = ownerHarness();
  const latest = deferSourceReply(s, 1);
  const pending = s.startStreamRendererPreviewCapture();
  await latest.requested;
  const stream = s.captures[0];
  s.stopStreamRendererPreviewCapture({ force: true });
  latest.resolve({ ...s.source });
  assert.equal(await pending, null);
  assert.equal(stream.getVideoTracks()[0].stops, 1);
  assert.equal(s.streamRendererPreviewStream, null);
  assert.equal(s.streamRendererPreviewStartPromise, null);
  assert.equal(s.sinkStreams.includes(stream), false);
});

test("losing all consumers during latest-source IPC discards the unadopted stream", async () => {
  const s = ownerHarness();
  const latest = deferSourceReply(s, 1);
  const pending = s.startStreamRendererPreviewCapture();
  await latest.requested;
  s.currentMode = "Bible workspace";
  latest.resolve({ ...s.source });
  assert.equal(await pending, null);
  assert.equal(s.captures[0].getVideoTracks()[0].stops, 1);
  assert.equal(s.streamRendererPreviewStream, null);
  assert.equal(s.streamRendererPreviewStartPromise, null);
});

test("old latest-source completion preserves a replacement's pending start and shared acquisition", async () => {
  const s = ownerHarness();
  const latest = deferSourceReply(s, 1);
  const oldStart = s.startStreamRendererPreviewCapture();
  await latest.requested;
  const oldStream = s.captures[0];
  s.stopStreamRendererPreviewCapture({ force: true });
  const capture = deferCapture(s);
  const replacementStart = s.startStreamRendererPreviewCapture();
  const owner = s.streamRendererPreviewStartPromise;
  await capture.requested;

  latest.resolve({ ...s.source });
  await oldStart;
  assert.equal(s.streamRendererPreviewStartPromise, owner);
  assert.equal(s.streamRendererPreviewStream, null);
  assert.equal(oldStream.getVideoTracks()[0].stops, 1);
  const joined = s.startStreamRendererPreviewCapture();
  assert.equal(s.streamRendererPreviewStartPromise, owner);
  const replacement = captureStream();
  capture.resolve(replacement);
  assert.equal(await replacementStart, replacement);
  assert.equal(await joined, replacement);
  assert.equal(s.streamRendererPreviewStream, replacement);
  assert.equal(s.streamRendererPreviewStartPromise, null);
});

test("the existing post-capture generation guard discards a late stream without clearing a newer start", async () => {
  const s = ownerHarness();
  const oldCapture = deferCapture(s);
  const oldStart = s.startStreamRendererPreviewCapture();
  await oldCapture.requested;
  s.stopStreamRendererPreviewCapture({ force: true });
  const capture = deferCapture(s);
  const replacementStart = s.startStreamRendererPreviewCapture();
  const owner = s.streamRendererPreviewStartPromise;
  const oldStream = captureStream();
  oldCapture.resolve(oldStream);
  assert.equal(await oldStart, null);
  await capture.requested;
  assert.equal(oldStream.getVideoTracks()[0].stops, 1);
  assert.equal(s.streamRendererPreviewStream, null);
  assert.equal(s.streamRendererPreviewStartPromise, owner);
  const replacement = captureStream();
  capture.resolve(replacement);
  assert.equal(await replacementStart, replacement);
});

test("old capture rejection cannot stop or invalidate a newer pending start", async () => {
  const s = ownerHarness();
  const oldCapture = deferCapture(s);
  const oldStart = s.startStreamRendererPreviewCapture();
  await oldCapture.requested;
  s.stopStreamRendererPreviewCapture({ force: true });
  const source = deferSourceReply(s);
  const replacementStart = s.startStreamRendererPreviewCapture();
  const owner = s.streamRendererPreviewStartPromise;
  await source.requested;
  const generation = s.audienceCaptureGeneration;

  // Display-media acquisition is serialized: hold the newer start at its IPC,
  // rather than inventing a newer live capture before the old capture rejects.
  oldCapture.reject(new Error("old capture failed"));
  assert.equal(await oldStart, null);
  assert.equal(s.audienceCaptureGeneration, generation);
  assert.equal(s.streamRendererPreviewStartPromise, owner);
  assert.equal(s.errors.length, 1);
  source.resolve({ ...s.source });
  const replacement = await replacementStart;
  assert.ok(replacement);
  assert.equal(s.streamRendererPreviewStream, replacement);
  assert.equal(replacement.getVideoTracks()[0].stops, 0);
});

test("an obsolete unavailable-source reply cannot stop a replacement capture", async () => {
  const s = ownerHarness();
  const source = deferSourceReply(s);
  const oldStart = s.startStreamRendererPreviewCapture();
  await source.requested;
  s.stopStreamRendererPreviewCapture({ force: true });
  const replacement = await s.startStreamRendererPreviewCapture();
  const generation = s.audienceCaptureGeneration;
  source.resolve({ available: false, sourceKey: "" });
  assert.equal(await oldStart, null);
  assert.equal(s.audienceCaptureGeneration, generation);
  assert.equal(s.streamRendererPreviewStream, replacement);
  assert.equal(replacement.getVideoTracks()[0].stops, 0);
});

test("a current capture rejection still stops and clears its own start", async () => {
  const s = ownerHarness();
  const capture = deferCapture(s);
  const pending = s.startStreamRendererPreviewCapture();
  await capture.requested;
  capture.reject(new Error("current capture failed"));
  assert.equal(await pending, null);
  assert.equal(s.audienceCaptureGeneration, 1);
  assert.equal(s.streamRendererPreviewStream, null);
  assert.equal(s.streamRendererPreviewStartPromise, null);
  assert.equal(s.errors.length, 1);
});

test("a delayed ended notification from a replaced track cannot stop the current stream", async () => {
  const s = ownerHarness();
  const oldStream = await s.startStreamRendererPreviewCapture();
  s.stopStreamRendererPreviewCapture({ force: true });
  const replacement = await s.startStreamRendererPreviewCapture();
  const generation = s.audienceCaptureGeneration;
  oldStream.getVideoTracks()[0].emitEnded();
  assert.equal(s.audienceCaptureGeneration, generation);
  assert.equal(s.streamRendererPreviewStream, replacement);
  assert.equal(oldStream.getVideoTracks()[0].stops, 1);
  assert.equal(replacement.getVideoTracks()[0].stops, 0);

  replacement.getVideoTracks()[0].emitEnded();
  assert.equal(s.audienceCaptureGeneration, generation + 1);
  assert.equal(s.streamRendererPreviewStream, null);
  assert.equal(replacement.getVideoTracks()[0].stops, 1);
  assert.equal(s.sinkStreams.at(-1), null);
});

test("local relay buffers early ICE and closes without stopping borrowed capture tracks", async () => {
  const signals = [], added = [], candidates = [];
  const track = { kind: "video", stop() { throw new Error("must not stop borrowed track"); } };
  class Peer {
    constructor(options) { assert.deepEqual(options.iceServers, []); }
    addTrack(value) { added.push(value); }
    async createOffer() { return { type: "offer", sdp: "local" }; }
    async setLocalDescription(value) { this.localDescription = { toJSON: () => value }; }
    async setRemoteDescription(value) { this.remoteDescription = value; }
    async addIceCandidate(value) { candidates.push(value); }
    close() {}
  }
  const relay = new LocalVideoRelay({ Peer, Stream: class { addTrack() {} }, sendSignal: (signal) => signals.push(signal) });
  await relay.start({ getVideoTracks: () => [track] });
  await relay.receive({ type: "candidate", candidate: { candidate: "early" } });
  assert.equal(candidates.length, 0);
  await relay.receive({ type: "description", description: { type: "answer", sdp: "remote" } });
  assert.equal(candidates.length, 1);
  assert.equal(added[0], track);
  relay.close(); relay.close();
  assert.equal(signals.filter((value) => value.type === "close").length, 1);
});

test("remote close cancels a pending offer immediately without stopping its borrowed track", async () => {
  let release, closed = 0;
  class Peer {
    addTrack() {}
    createOffer() { return new Promise((resolve) => { release = resolve; }); }
    close() { closed++; }
  }
  const signals = [];
  const relay = new LocalVideoRelay({ Peer, Stream: class {}, sendSignal: (message) => signals.push(message) });
  const offer = relay.start({ getVideoTracks: () => [{ stop() { assert.fail("borrowed track stopped"); } }] });
  await settle();
  await relay.receive({ type: "close" });
  assert.equal(relay.closed, true);
  assert.equal(closed, 1);
  release({ type: "offer", sdp: "cancelled" });
  await offer;
  assert.equal(signals.length, 0);
});

function routerHarness() {
  const endpoint = () => ({ id: Math.random(), isDestroyed: () => false, webContents: {
    isDestroyed: () => false, isCrashed: () => false, isLoadingMainFrame: () => false,
    messages: [], send(channel, message) { this.messages.push([channel, message]); },
  } });
  const s = { win: endpoint(), stageWindow: endpoint(), mediaWindow: endpoint(),
    audienceSessionId: "audience", audienceContentKind: "video", stageAudienceRelaySession: null,
    stageLocalMedia: null,
    stageAudienceSourceSignature: "", mediaWindowSlipstreamGeneration: 1 };
  vm.createContext(s);
  for (const name of ["currentStageAudienceSource", "closeStageAudienceRelay", "handleStageAudienceRelay", "publishStageAudienceSource"]) {
    vm.runInContext(fn(main, name), s);
  }
  return s;
}

test("relay router validates senders, source, peer identity and bounded SDP", () => {
  const s = routerHarness();
  const sourceKey = s.currentStageAudienceSource().sourceKey;
  const request = { type: "request", peerId: "test-peer", sourceKey };
  assert.equal(s.handleStageAudienceRelay({ sender: {} }, request), false);
  assert.equal(s.handleStageAudienceRelay({ sender: s.win.webContents }, request), false);
  assert.equal(s.handleStageAudienceRelay({ sender: s.stageWindow.webContents }, { ...request, sourceKey: "old" }), false);
  assert.equal(s.handleStageAudienceRelay({ sender: s.stageWindow.webContents }, request), true);
  const offer = { ...request, type: "description", description: { type: "offer", sdp: "video only" } };
  assert.equal(s.handleStageAudienceRelay({ sender: s.stageWindow.webContents }, offer), false);
  assert.equal(s.handleStageAudienceRelay({ sender: s.win.webContents }, { ...offer, peerId: "old-peer" }), false);
  assert.equal(s.handleStageAudienceRelay({ sender: s.win.webContents }, { ...offer, description: { type: "offer", sdp: "x".repeat(131073) } }), false);
  assert.equal(s.handleStageAudienceRelay({ sender: s.win.webContents }, offer), true);
});

test("cue changes keep relay identity; source/stage closure invalidates both peers", () => {
  const s = routerHarness(); const sourceKey = s.currentStageAudienceSource().sourceKey;
  s.handleStageAudienceRelay({ sender: s.stageWindow.webContents }, { type: "request", peerId: "test", sourceKey });
  s.audienceContentKind = "scripture"; s.mediaWindowSlipstreamGeneration++;
  s.publishStageAudienceSource();
  assert.equal(s.currentStageAudienceSource().sourceKey, sourceKey);
  assert.equal(s.stageAudienceRelaySession.peerId, "test");
  s.mediaWindow = null; s.publishStageAudienceSource();
  assert.equal(s.stageAudienceRelaySession, null);
  assert.equal(s.win.webContents.messages.at(-1)[1].type, "close");
});
