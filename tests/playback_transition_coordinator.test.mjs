import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
  PlaybackTransitionCoordinator,
  createAudiencePlaybackId,
} from "../src/shared/playback-transition-coordinator.mjs";
import {
  activateAudiencePlayback,
  activateAudienceSlipstream,
} from "../src/shared/audience-playback-activation.mjs";

const mediaSource = await readFile(
  new URL("../src/media-window/media.mjs", import.meta.url),
  "utf8",
);
const mainSource = await readFile(
  new URL("../src/main-process/main.mjs", import.meta.url),
  "utf8",
);
const controlMediaSource = await readFile(
  new URL("../src/control-window/app-media-runtime.mjs", import.meta.url),
  "utf8",
);
const controlRendererSource = await readFile(
  new URL("../src/control-window/app-renderer.mjs", import.meta.url),
  "utf8",
);
const operatorChromeSource = await readFile(
  new URL("../src/control-window/app-operator-chrome.mjs", import.meta.url),
  "utf8",
);
const presentationPlaybackSource = await readFile(
  new URL("../src/control-window/app-presentation-playback.mjs", import.meta.url),
  "utf8",
);
const activationSource = await readFile(
  new URL("../src/shared/audience-playback-activation.mjs", import.meta.url),
  "utf8",
);
const mediaLoopSource = await readFile(
  new URL("../src/control-window/app-media-loop.mjs", import.meta.url),
  "utf8",
);
const logoHoldSource = await readFile(
  new URL("../src/control-window/app-logo-hold.mjs", import.meta.url),
  "utf8",
);

function declaredFunction(name) {
  const match = mediaSource.match(
    new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"),
  );
  assert.ok(match, `media renderer declares ${name}`);
  return match[0];
}

function controlDeclaredFunction(name) {
  const match = controlMediaSource.match(
    new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"),
  );
  assert.ok(match, `control renderer declares ${name}`);
  return match[0];
}

function rendererDeclaredFunction(name) {
  const match = controlRendererSource.match(
    new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"),
  );
  assert.ok(match, `control renderer state declares ${name}`);
  return match[0];
}

function operatorDeclaredFunction(name) {
  const match = operatorChromeSource.match(
    new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"),
  );
  assert.ok(match, `operator chrome declares ${name}`);
  return match[0];
}

test("a transition follows its queue item through insertion and reordering", () => {
  const coordinator = new PlaybackTransitionCoordinator();
  const first = { id: "first" };
  const target = { id: "target" };
  const last = { id: "last" };
  const queue = [first, target, last];
  const token = coordinator.begin(target, { startTime: 12 });

  queue.unshift({ id: "inserted" });
  assert.equal(coordinator.indexOf(token, queue), 2);

  queue.splice(0, queue.length, target, last, first);
  assert.equal(coordinator.indexOf(token, queue), 0);
  assert.equal(token.startTime, 12);
});

test("cancellation invalidates in-flight and pending close/reopen work", () => {
  const coordinator = new PlaybackTransitionCoordinator();
  const target = { id: "target" };
  const queue = [{ id: "first" }, target];
  const token = coordinator.begin(target, { startTime: 7 });

  assert.equal(coordinator.setPendingClose(token), true);
  coordinator.cancel();

  assert.equal(coordinator.owns(token), false);
  assert.equal(coordinator.pendingCloseItem(), null);
  assert.equal(coordinator.consumePendingClose(queue), null);
});

test("pending close/reopen resolves the target by identity, not its old index", () => {
  const coordinator = new PlaybackTransitionCoordinator();
  const before = { id: "before" };
  const target = { id: "target" };
  const queue = [before, target];
  const token = coordinator.begin(target, { startTime: 5 });
  coordinator.setPendingClose(token);

  queue.shift();
  const pending = coordinator.consumePendingClose(queue);

  assert.equal(pending.item, target);
  assert.equal(pending.index, 0);
  assert.equal(pending.startTime, 5);
});

test("end events are claimed once by playback identity, even for the same path", () => {
  const coordinator = new PlaybackTransitionCoordinator();
  const first = { playbackId: "playback-1", mediaFile: "same.mp4" };
  const second = { playbackId: "playback-2", mediaFile: "same.mp4" };

  coordinator.activatePlayback(first.playbackId);
  assert.equal(coordinator.claimPlaybackEnd(first), true);
  assert.equal(coordinator.claimPlaybackEnd(first), false);

  coordinator.activatePlayback(second.playbackId);
  assert.equal(coordinator.claimPlaybackEnd(first), false);
  assert.equal(coordinator.claimPlaybackEnd(second), true);
  assert.equal(coordinator.claimPlaybackEnd(second), false);
});

test("a staged replacement owns playback-state before activation commits", () => {
  const coordinator = new PlaybackTransitionCoordinator();
  coordinator.activatePlayback("playback-old");
  coordinator.stagePlayback("playback-selected");

  assert.equal(
    coordinator.matchesExpectedPlayback({ playbackId: "playback-old" }),
    false,
  );
  assert.equal(
    coordinator.matchesExpectedPlayback({ playbackId: "playback-selected" }),
    true,
  );
  assert.equal(
    coordinator.claimPlaybackEnd({ playbackId: "playback-old" }),
    false,
    "the outgoing clip cannot advance the queue while its replacement activates",
  );

  assert.equal(coordinator.commitStagedPlayback("playback-selected"), true);
  assert.equal(coordinator.activePlaybackId(), "playback-selected");
  assert.equal(
    coordinator.matchesActivePlayback({ playbackId: "playback-selected" }),
    true,
  );
});

test("discarding a failed activation restores the committed playback as expected", () => {
  const coordinator = new PlaybackTransitionCoordinator();
  coordinator.activatePlayback("playback-live");
  coordinator.stagePlayback("playback-failed");

  assert.equal(coordinator.discardStagedPlayback("playback-failed"), true);
  assert.equal(coordinator.stagedPlaybackId(), "");
  assert.equal(
    coordinator.matchesExpectedPlayback({ playbackId: "playback-live" }),
    true,
  );
  assert.equal(coordinator.activePlaybackId(), "playback-live");
});

test("audience playback identities are unique", () => {
  assert.notEqual(createAudiencePlaybackId(), createAudiencePlaybackId());
});

test("slipstream activation stages, transmits, and commits one playback identity", async () => {
  const coordinator = new PlaybackTransitionCoordinator();
  coordinator.activatePlayback("playback-old");

  const result = await activateAudienceSlipstream(
    async (payload) => {
      assert.equal(payload.playbackId, "playback-new");
      assert.equal(payload.mediaFile, "new.mp4");
      assert.equal(
        coordinator.matchesExpectedPlayback({ playbackId: payload.playbackId }),
        true,
        "renderer state is accepted while IPC activation is pending",
      );
      return { ok: true, playbackId: payload.playbackId };
    },
    { mediaFile: "new.mp4" },
    { coordinator, playbackId: "playback-new" },
  );

  assert.equal(result.ok, true);
  assert.equal(coordinator.stagedPlaybackId(), "");
  assert.equal(coordinator.activePlaybackId(), "playback-new");
});

test("an obsolete slipstream completion cannot reclaim playback ownership", async () => {
  const coordinator = new PlaybackTransitionCoordinator();
  let finishFirst;
  const firstResponse = new Promise((resolve) => {
    finishFirst = resolve;
  });
  const first = activateAudienceSlipstream(
    () => firstResponse,
    { mediaFile: "first.mp4" },
    { coordinator, playbackId: "playback-first" },
  );

  const second = await activateAudienceSlipstream(
    async (payload) => ({ ok: true, playbackId: payload.playbackId }),
    { mediaFile: "second.mp4" },
    { coordinator, playbackId: "playback-second" },
  );
  finishFirst({ ok: true, playbackId: "playback-first" });
  const obsolete = await first;

  assert.equal(second.ok, true);
  assert.equal(obsolete.ok, false);
  assert.equal(obsolete.reason, "superseded");
  assert.equal(coordinator.activePlaybackId(), "playback-second");
});

test("an obsolete fresh-window completion cannot reclaim playback ownership", async () => {
  const coordinator = new PlaybackTransitionCoordinator();
  let finishFirst;
  const firstResponse = new Promise((resolve) => {
    finishFirst = resolve;
  });
  const first = activateAudiencePlayback(
    () => firstResponse,
    { coordinator, playbackId: "window-first" },
  );

  const second = await activateAudiencePlayback(
    async () => 42,
    { coordinator, playbackId: "window-second" },
  );
  finishFirst(41);
  const obsolete = await first;

  assert.equal(second.ok, true);
  assert.equal(second.activation, 42);
  assert.equal(obsolete.ok, false);
  assert.equal(obsolete.reason, "superseded");
  assert.equal(obsolete.activation, 41);
  assert.equal(coordinator.activePlaybackId(), "window-second");
});

test("a rejected slipstream restores the previously active playback", async () => {
  const coordinator = new PlaybackTransitionCoordinator();
  coordinator.activatePlayback("playback-live");

  const result = await activateAudienceSlipstream(
    async () => false,
    { mediaFile: "failed.mp4" },
    { coordinator, playbackId: "playback-failed" },
  );

  assert.equal(result.ok, false);
  assert.equal(coordinator.stagedPlaybackId(), "");
  assert.equal(coordinator.activePlaybackId(), "playback-live");
});

test("a rejected obsolete slipstream is classified as superseded", async () => {
  const coordinator = new PlaybackTransitionCoordinator();
  let rejectFirst;
  const firstResponse = new Promise((resolve) => {
    rejectFirst = resolve;
  });
  const first = activateAudienceSlipstream(
    () => firstResponse,
    { mediaFile: "first.mp4" },
    { coordinator, playbackId: "playback-first" },
  );

  coordinator.stagePlayback("playback-second");
  rejectFirst(false);
  const obsolete = await first;

  assert.equal(obsolete.ok, false);
  assert.equal(obsolete.reason, "superseded");
  assert.equal(coordinator.stagedPlaybackId(), "playback-second");
});

test("a rejected media play is returned as an activation failure", async () => {
  const reported = [];
  const context = vm.createContext({
    liveStreamMode: false,
    video: {
      play: async () => {
        throw new Error("decoder rejected playback");
      },
    },
    reportProjectionError(message, error) {
      reported.push([message, error.message]);
    },
    markPlaybackStateStable() {},
    playbackStateUpdate() {},
  });
  vm.runInContext(declaredFunction("playVideoWithStartupBuffer"), context);

  const started = await vm.runInContext(
    'playVideoWithStartupBuffer("Could not start")',
    context,
  );

  assert.equal(started, false);
  assert.deepEqual(reported, [["Could not start", "decoder rejected playback"]]);
});

test("Media Session seeking is projection-owned and publishes explicit position intent", () => {
  const sent = [];
  const video = {
    currentTime: 20,
    duration: 120,
    paused: true,
  };
  const context = vm.createContext({
    audiencePlaybackId: "playback-1",
    audienceSessionId: "session-1",
    consumePauseSyncIntent: () => "implicit",
    ipcRenderer: {
      send(channel, payload) {
        sent.push([channel, payload]);
      },
    },
    isImg: false,
    isPptx: false,
    isText: false,
    playbackSyncPhase: "stable",
    streamActsAsLiveEdge: false,
    strtvl: null,
    video,
    videoSourceGeneration: 7,
  });
  vm.runInContext(declaredFunction("playbackStateUpdate"), context);
  vm.runInContext(declaredFunction("seekProjectionMediaFromSession"), context);

  assert.equal(
    vm.runInContext("seekProjectionMediaFromSession(35)", context),
    true,
  );
  assert.equal(video.currentTime, 35);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], "playback-state-change");
  assert.equal(sent[0][1].currentTime, 35);
  assert.equal(sent[0][1].playing, false);
  assert.equal(sent[0][1].pauseIntent, "implicit");
  assert.equal(sent[0][1].positionIntent, "explicit-seek");
  assert.equal(sent[0][1].playbackId, "playback-1");
  assert.equal(sent[0][1].sourceGeneration, 7);

  assert.equal(
    vm.runInContext("seekProjectionMediaFromSession(-10)", context),
    true,
  );
  assert.equal(video.currentTime, 0, "projection seeks are clamped locally");
});

test("a paused control mirror applies an explicit projection seek", async () => {
  const pauseCalls = [];
  const video = {
    currentTime: 12,
    duration: 120,
    paused: true,
  };
  const context = vm.createContext({
    activeMediaWindowContentType: "video",
    audiencePlaybackCoordinator: {
      matchesExpectedPlayback: () => true,
      matchesStagedPlayback: () => false,
    },
    beginProjectionPlaybackStartupSync() {
      context.startupSyncBegan = true;
    },
    desiredProjectionPreviewPlayback: null,
    finishProjectionPlaybackStartupSync() {},
    isBiblePath: () => false,
    isSongPath: () => false,
    latestExplicitProjectionPauseState: null,
    mediaFile: "/media/clip.mp4",
    networkPreviewUsesRendererCapture: () => false,
    pauseMediaElementSuppressed: async (_mediaEl, options) => {
      pauseCalls.push(options);
      video.currentTime = options.currentTime;
    },
    pidController: { reset() {} },
    playbackStateSyncGeneration: 0,
    setSharedRendererState(patch) {
      Object.assign(context, patch);
    },
    video,
  });
  context.playbackState = {
    audienceSessionId: "session-1",
    currentTime: 42,
    pauseIntent: "implicit",
    playbackId: "playback-1",
    playing: false,
    positionIntent: "explicit-seek",
    sourceGeneration: 3,
    syncPhase: "stabilizing",
  };
  vm.runInContext(
    rendererDeclaredFunction("pauseLivePreviewMirrorFromProjection"),
    context,
  );
  vm.runInContext(controlDeclaredFunction("handlePlaybackState"), context);

  await vm.runInContext("handlePlaybackState(null, playbackState)", context);

  assert.equal(context.startupSyncBegan, undefined);
  assert.equal(pauseCalls.length, 1);
  assert.equal(pauseCalls[0].currentTime, 42);
  assert.equal(video.currentTime, 42);
  assert.equal(context.masterPauseState, true);
  assert.equal(context.desiredProjectionPreviewPlayback, "paused");
  assert.equal(context.targetTime, 42);
});

test("legacy Media Session seek IPC is removed", () => {
  assert.doesNotMatch(mediaSource, /ipcRenderer\.send\("media-seek(?:to)?"/);
  assert.doesNotMatch(mainSource, /ipcMain\.on\("media-seekto"/);
  assert.doesNotMatch(controlMediaSource, /function handleMediaseek\(/);
  assert.match(
    declaredFunction("installVideoPlaybackWiring"),
    /seekProjectionMediaFromSession\(video\.currentTime [+-] offset\)/,
  );
});

test("live mute control uses volume zero without taking autoplay mute ownership", () => {
  const handlers = { button: {}, slider: {}, video: {} };
  const forwardedVolumes = [];
  const icon = { innerHTML: "" };
  const slider = {
    dataset: {},
    style: {},
    value: 70,
    addEventListener(type, handler) {
      handlers.slider[type] = handler;
    },
    blur() {},
  };
  const button = {
    addEventListener(type, handler) {
      handlers.button[type] = handler;
    },
  };
  const video = {
    id: "preview",
    defaultMuted: true,
    muted: true,
    volume: 0.7,
    addEventListener(type, handler) {
      handlers.video[type] = handler;
    },
  };
  const elements = {
    gtkVolBtn: button,
    gtkVolIcon: icon,
    gtkVolSlider: slider,
    preview: video,
  };
  const context = vm.createContext({
    STREAMPLAYER: "stream-player",
    currentMode: "media-player",
    currentQueueIndex: -1,
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
    },
    getLivePreviewDisplayVolume: () => video.volume,
    getPreviewCueDisplayVolume: () => null,
    gtkUpdateVolIcon: null,
    isLivePreviewMirrorInternallyMuted: (mediaEl) =>
      mediaEl === video && mediaEl.muted,
    isLiveStream: () => false,
    isPreviewCueVolumeActive: () => false,
    mediaFile: "clip.mp4",
    mediaQueue: [],
    networkPreviewTransportState: { muted: false, volume: 1 },
    networkPreviewUsesRendererCapture: () => false,
    pendingCueVolume: null,
    setActiveCueVolume() {},
    setNetworkPreviewVolume() {},
    setSharedRendererState() {},
    streamVolume: 1,
    vlCtl(volume) {
      forwardedVolumes.push(volume);
    },
  });
  context.video = video;
  vm.runInContext(operatorDeclaredFunction("setupGtkVolumeControl"), context);
  vm.runInContext(operatorDeclaredFunction("handleVolumeChange"), context);
  vm.runInContext("setupGtkVolumeControl()", context);

  handlers.button.click();
  vm.runInContext("handleVolumeChange({ target: video })", context);
  assert.equal(video.volume, 0);
  assert.equal(video.muted, true, "the autoplay workaround keeps mute ownership");
  assert.equal(Number(slider.value), 0);
  assert.deepEqual(forwardedVolumes, [0]);

  handlers.button.click();
  vm.runInContext("handleVolumeChange({ target: video })", context);
  assert.equal(video.volume, 0.7);
  assert.equal(video.muted, true, "operator unmute only restores logical volume");
  assert.equal(Number(slider.value), 70);
  assert.deepEqual(forwardedVolumes, [0, 0.7]);

  slider.value = 45;
  handlers.slider.input();
  assert.equal(video.volume, 0.45);
  assert.equal(video.muted, true, "slider input also leaves physical mute alone");
});

test("stale video end handlers cannot report the replacement playback", () => {
  const sent = [];
  const video = {
    ended: false,
    loop: false,
    currentTime: 0,
    duration: 10,
    onended: null,
  };
  const context = vm.createContext({
    video,
    videoSourceGeneration: 1,
    audiencePlaybackId: "playback-1",
    audienceSessionId: "session-1",
    mediaFile: "same.mp4",
    loopFile: false,
    tracePlayback() {},
    setProjectionVideoVisible() {},
    ipcRenderer: {
      send(channel, payload) {
        sent.push([channel, payload]);
      },
    },
  });
  vm.runInContext(declaredFunction("projectionVideoAtEnd"), context);
  vm.runInContext(declaredFunction("bindProjectionVideoEndHandler"), context);
  vm.runInContext("bindProjectionVideoEndHandler()", context);
  const staleHandler = video.onended;

  context.videoSourceGeneration = 2;
  context.audiencePlaybackId = "playback-2";
  video.ended = true;
  staleHandler();
  assert.deepEqual(sent, []);

  vm.runInContext("bindProjectionVideoEndHandler()", context);
  video.onended();
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], "media-playback-ended");
  assert.equal(sent[0][1].playbackId, "playback-2");
  assert.equal(sent[0][1].sourceGeneration, 2);

  // A seek that lands on the final position (e.g. a same-position write from
  // the near-end pause handler) clears `ended` while the clip is still
  // finished. The end must still be reported, or auto-advance never runs.
  video.ended = false;
  video.currentTime = 10;
  video.onended();
  assert.equal(sent.length, 2);

  // A seek back into the clip is a real cancellation of the end.
  video.currentTime = 4;
  video.onended();
  assert.equal(sent.length, 2);

  // A replaced source (no metadata yet) is never reported as ended.
  video.currentTime = 0;
  video.duration = Number.NaN;
  video.onended();
  assert.equal(sent.length, 2);
});

test("a natural end does not seek the projection before its ended handler runs", () => {
  const wiring = declaredFunction("installVideoPlaybackWiring");
  const pauseListener = wiring.match(
    /video\.addEventListener\("pause", \(\) => \{([^]*?)\n  \}\);/,
  );
  assert.ok(pauseListener, "projection snaps near-end pauses to the clip end");
  assert.match(
    pauseListener[1],
    /if \(projectionVideoAtEnd\(video\) \|\| video\.seeking\) return;/,
    "the snap is skipped once the clip has ended or a seek is pending",
  );
  assert.ok(
    pauseListener[1].indexOf("projectionVideoAtEnd(video)") <
      pauseListener[1].indexOf("video.currentTime = video.duration"),
    "the end check happens before the currentTime write",
  );
});

test("main process rejects playback IPC from a non-active audience renderer", () => {
  assert.match(
    mainSource,
    /event\.sender !== mediaWindow\.webContents/,
  );
  assert.match(
    mainSource,
    /endedMediaFile\?\.audienceSessionId[\s\S]*?endedMediaFile\.audienceSessionId !== audienceSessionId/,
  );
});

test("slipstream activation result remains in scope for the handler response", () => {
  const handlerStart = mainSource.indexOf(
    'ipcMain.handle("slipstream-media-window"',
  );
  const handlerEnd = mainSource.indexOf(
    '\n  ipcMain.on("vlcl"',
    handlerStart,
  );
  const handler = mainSource.slice(handlerStart, handlerEnd);
  const declaration = handler.indexOf("let activation = null");
  const invocation = handler.indexOf(
    "activation = await targetMediaWindow.webContents.executeJavaScript",
  );
  const response = handler.indexOf("playbackId: activation?.playbackId");

  assert.ok(declaration >= 0 && declaration < invocation);
  assert.ok(invocation < response);
  assert.doesNotMatch(handler, /const activation\s*=/);
});

test("fresh audience creation waits for renderer activation", () => {
  const loadIndex = mediaSource.indexOf("await loadMedia();", mediaSource.indexOf("async function bootstrapMediaWindow"));
  const readyIndex = mediaSource.indexOf(
    'ipcRenderer.send("audience-output-ready"',
    loadIndex,
  );
  assert.ok(loadIndex >= 0, "audience bootstrap awaits media loading");
  assert.ok(readyIndex > loadIndex, "ready is emitted only after media activation");
  assert.match(mainSource, /await bootstrapResult;/);
  assert.match(mainSource, /audience-output-failed/);
});

test("a failed initial text payload discards its uncommitted audience window", () => {
  const discardStart = mainSource.indexOf("async function handleDiscardMediaWindowNow(");
  const discardEnd = mainSource.indexOf(
    "\nasync function handleCloseLowerThirdWindowNow(",
    discardStart,
  );
  const discard = mainSource.slice(discardStart, discardEnd);
  assert.ok(discardStart >= 0 && discardEnd > discardStart);
  assert.match(discard, /suppressNextMediaClosedNotification = true/);
  assert.doesNotMatch(discard, /win\.webContents\.send\("media-window-closed"/);
  assert.match(
    mainSource,
    /ipcMain\.handle\("discard-media-window-now", handleDiscardMediaWindowNow\)/,
  );
  assert.match(controlMediaSource, /await invoke\("discard-media-window-now"\)/);
});

test("control preview accepts the selected playback state during audience activation", () => {
  const createStart = controlMediaSource.indexOf("async function createMediaWindow(");
  const createEnd = controlMediaSource.indexOf("\nexport {", createStart);
  const createWindow = controlMediaSource.slice(createStart, createEnd);
  const createActivation = createWindow.indexOf("activateAudiencePlayback(");
  const createInvoke = createWindow.indexOf('invoke("create-media-window"');
  assert.ok(createActivation >= 0 && createActivation < createInvoke);
  assert.doesNotMatch(createWindow, /stagePlayback\(playbackId\)/);
  assert.match(createWindow, /const startupSyncGeneration = startupSyncNeeded/);
  assert.match(
    createWindow,
    /finishProjectionPlaybackStartupSync\(startupSyncGeneration\)/,
  );
  assert.match(
    controlRendererSource,
    /generation !== projectionPlaybackStartupGeneration/,
  );

  const slipstreamStart = presentationPlaybackSource.indexOf(
    "async function slipstreamQueueItemAtIndex(",
  );
  const slipstreamEnd = presentationPlaybackSource.indexOf(
    "\nasync function trySlipstreamNextQueueItem(",
    slipstreamStart,
  );
  const slipstream = presentationPlaybackSource.slice(slipstreamStart, slipstreamEnd);
  assert.match(slipstream, /activateAudienceSlipstream\(/);
  const slipstreamStage = activationSource.indexOf("stagePlayback(normalizedPlaybackId)");
  const slipstreamInvoke = activationSource.indexOf("await invokeActivation(");
  const slipstreamCommit = activationSource.indexOf(
    "commitStagedPlayback(normalizedPlaybackId)",
  );
  assert.ok(slipstreamStage >= 0 && slipstreamStage < slipstreamInvoke);
  assert.ok(slipstreamInvoke < slipstreamCommit);

  const automaticStart = presentationPlaybackSource.indexOf(
    "async function trySlipstreamNextQueueItem(",
  );
  const automaticEnd = presentationPlaybackSource.indexOf(
    "\nfunction handleRemoteMediaWindowTimeTick(",
    automaticStart,
  );
  const automaticSlipstream = presentationPlaybackSource.slice(
    automaticStart,
    automaticEnd,
  );
  const inFlightGuard = automaticSlipstream.indexOf(
    "if (queueSlipstreamTransitionInProgress) return false",
  );
  const newAttempt = automaticSlipstream.indexOf("const attemptTransition");
  assert.ok(inFlightGuard >= 0 && inFlightGuard < newAttempt);

  assert.match(controlMediaSource, /matchesExpectedPlayback\(playbackState\)/);
  assert.match(controlMediaSource, /matchesStagedPlayback\(playbackState\)/);
});

test("closing the audience output invalidates playback ownership and in-flight sync", () => {
  const closeStart = presentationPlaybackSource.indexOf(
    "async function handleMediaWindowClosed(",
  );
  const closeEnd = presentationPlaybackSource.indexOf("\nexport {", closeStart);
  const closeHandler = presentationPlaybackSource.slice(closeStart, closeEnd);

  assert.match(closeHandler, /audiencePlaybackCoordinator\.deactivatePlayback\(\)/);
  assert.match(closeHandler, /audiencePlaybackCoordinator\.discardStagedPlayback\(\)/);
  assert.match(
    closeHandler,
    /playbackStateSyncGeneration:\s*playbackStateSyncGeneration \+ 1/,
  );
  assert.match(closeHandler, /desiredProjectionPreviewPlayback:\s*"paused"/);
  assert.match(closeHandler, /latestExplicitProjectionPauseState:\s*null/);
});

test("an image that cannot be decoded fails its audience activation", async () => {
  const img = {
    src: "",
    style: {},
    setAttribute() {},
    async decode() {
      throw new Error("broken image");
    },
  };
  const context = vm.createContext({ img, mediaFile: "/media/missing.png" });
  vm.runInContext(declaredFunction("awaitProjectionImageReady"), context);
  vm.runInContext(declaredFunction("activateImageTarget"), context);

  await assert.rejects(
    () => vm.runInContext("activateImageTarget()", context),
    /Projection image could not be loaded: \/media\/missing\.png/,
  );
});

test("a decode that loses the element to a newer image does not fail that activation", async () => {
  const img = {
    src: "",
    style: {},
    setAttribute() {},
    async decode() {
      img.src = "/media/replacement.png";
      throw new Error("aborted by a new source");
    },
  };
  const context = vm.createContext({ img, mediaFile: "/media/first.png" });
  vm.runInContext(declaredFunction("awaitProjectionImageReady"), context);
  vm.runInContext(declaredFunction("activateImageTarget"), context);

  await vm.runInContext("activateImageTarget()", context);
});

test("the audience window loads images before it reports itself ready", () => {
  const loadMedia = declaredFunction("loadMedia");
  assert.match(loadMedia, /await activateImageTarget\(\);/);
  assert.doesNotMatch(loadMedia, /img\.src = mediaFile/);
});

test("a failed current slipstream blanks the surface instead of leaving it half-activated", () => {
  const slipstream = declaredFunction("applySlipstreamActivation");
  const activation = slipstream.indexOf("await activateVideoTarget(data);");
  const teardown = slipstream.indexOf("teardownImageElement();", activation);
  const rethrow = slipstream.indexOf("throw err;", teardown);
  assert.ok(activation > 0 && teardown > activation && rethrow > teardown);
});

test("overlapping slipstreams serialize renderer work and suppress stale main-process commits", () => {
  const wrapper = declaredFunction("applySlipstream");
  const activation = declaredFunction("applySlipstreamActivation");
  assert.match(wrapper, /\+\+slipstreamActivationGeneration/);
  assert.match(wrapper, /slipstreamActivationQueue\.run/);
  assert.match(activation, /if \(!ownsActivation\(\)\) return \{ playbackId: nextPlaybackId \};/);
  assert.ok(
    activation.indexOf("if (!ownsActivation()) return { playbackId: nextPlaybackId };") <
      activation.indexOf("teardownTextPresentation();", activation.indexOf("catch (err)")),
  );

  const handlerStart = mainSource.indexOf('ipcMain.handle("slipstream-media-window"');
  const handlerEnd = mainSource.indexOf('\n  ipcMain.on("vlcl"', handlerStart);
  const handler = mainSource.slice(handlerStart, handlerEnd);
  assert.match(handler, /\+\+mediaWindowSlipstreamGeneration/);
  assert.match(handler, /if \(!isLatestSlipstream\(\)\) return acknowledgedPlayback\(\);/);
  assert.ok(
    handler.indexOf("if (!isLatestSlipstream()) return acknowledgedPlayback();") <
      handler.indexOf("audienceContentKind ="),
  );
});

test("a slipstream rejected by the renderer rebuilds the audience window", () => {
  const slipstreamStart = presentationPlaybackSource.indexOf(
    "async function slipstreamQueueItemAtIndex(",
  );
  const slipstreamEnd = presentationPlaybackSource.indexOf(
    "\nasync function trySlipstreamNextQueueItem(",
    slipstreamStart,
  );
  const slipstream = presentationPlaybackSource.slice(slipstreamStart, slipstreamEnd);
  // Only a renderer-side rejection means the outgoing content was already
  // released; the other failure reasons belong to a newer activation.
  assert.match(slipstream, /opts\.reopenOnFailure === true/);
  assert.match(slipstream, /slipstreamResult\.reason === "rejected"/);
  assert.match(slipstream, /await reopenAudienceWindowForTransition\(/);
  assert.match(slipstream, /opts\.recreateOnFailure === true/);
  assert.match(slipstream, /await createMediaWindow\(\{/);

  const reopen = presentationPlaybackSource.slice(
    presentationPlaybackSource.indexOf("async function reopenAudienceWindowForTransition("),
  );
  assert.match(reopen, /setPendingClose\(transitionToken, startTime\)/);
  assert.match(reopen, /await closeActiveMediaWindowNow\(\)/);

  // Approving a changed media file is the one live swap with no close/reopen
  // fallback of its own, so it has to ask for the recovery.
  assert.match(mediaLoopSource, /slipstreamQueueItemAtIndex\([\s\S]*?reopenOnFailure: true/);
  assert.match(logoHoldSource, /slipstreamQueueItemAtIndex\([\s\S]*?recreateOnFailure: true/);
  assert.match(controlMediaSource, /const deferPlaybackForOutputHold = options\?\.underLogoHold === true/);
});
