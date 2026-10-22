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
const presentationPlaybackSource = await readFile(
  new URL("../src/control-window/app-presentation-playback.mjs", import.meta.url),
  "utf8",
);
const activationSource = await readFile(
  new URL("../src/shared/audience-playback-activation.mjs", import.meta.url),
  "utf8",
);

function declaredFunction(name) {
  const match = mediaSource.match(
    new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"),
  );
  assert.ok(match, `media renderer declares ${name}`);
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
