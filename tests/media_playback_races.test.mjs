import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { createMediaWatchIdentityRegistry } from "../src/shared/media-watch-identity.mjs";

const [runtimeSource, playbackSource, mediaLoopSource, scheduleSource] = await Promise.all([
  readFile(new URL("../src/control-window/app-media-runtime.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/control-window/app-presentation-playback.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/control-window/app-media-loop.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/control-window/app-schedule-controller.mjs", import.meta.url), "utf8"),
]);

function functionSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Could not find ${startMarker}`);
  return source.slice(start, end);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("media watch notifications follow a cue through reorder and reject another project", () => {
  const registry = createMediaWatchIdentityRegistry();
  const first = { path: "/media/shared.mp4" };
  const second = { path: "/media/shared.mp4" };
  const firstId = registry.idFor(first);
  const secondId = registry.idFor(second);
  assert.notEqual(firstId, secondId);

  const reordered = [second, first];
  assert.equal(registry.matches(reordered[1], firstId), true);
  assert.equal(registry.matches(reordered[0], firstId), false);
  assert.equal(registry.matches({ path: first.path }, firstId), false);
  assert.equal(registry.idFor(first), firstId);
});

test("a delayed file change marks the original cue after two copies trade places", () => {
  const registry = createMediaWatchIdentityRegistry();
  const first = { path: "/media/shared.mp4", liveSource: { mode: "linked", originalPath: "/media/shared.mp4" } };
  const second = { path: first.path, liveSource: { mode: "linked", originalPath: first.path } };
  const firstId = registry.idFor(first);
  registry.idFor(second);
  const queue = [second, first];
  const context = {
    mediaQueue: queue,
    mediaWatchIdentity: registry,
    selectedQueueAnchorIndex: -1,
    mediaUpdatePayloadQueueItemIds: (payload) => new Set(payload.queueItemIds),
    normalizeMediaPathForCompare: (path) => path,
    queueItemLiveSource: (item) => item.liveSource,
    queueItemCanKeepOldMediaVersion: () => false,
    mediaUpdateWarningFingerprint: () => "",
    shouldPreserveReadyMediaUpdate: () => false,
    pendingMediaUpdateMatches: () => false,
    applyMediaUpdateMissingFlag: () => false,
    queueIndexInRange: () => false,
    setSharedRendererState() {},
    renderQueue() {},
    showGnomeToast() {},
    scheduleAutosaveProjectState() {},
    Date,
  };
  const code = functionSource(mediaLoopSource, "function markQueueItemMediaUpdate(", "async function approvePendingMediaUpdate(");
  const markQueueItemMediaUpdate = vm.runInNewContext(`${code}\nmarkQueueItemMediaUpdate`, context);
  markQueueItemMediaUpdate({
    originalPath: first.path,
    queueItemIds: [firstId],
    fileHash: "changed",
    status: "ready",
  });

  assert.equal(second.pendingMediaUpdate, undefined);
  assert.equal(first.pendingMediaUpdate?.fileHash, "changed");
});

test("a media-library drop cannot finish in a project opened during lookup", async () => {
  const lookup = deferred();
  const added = [];
  let drop;
  const context = {
    mediaQueue: [],
    currentProjectGuid: "project-one",
    queueDragFromIndex: -1,
    songDragSongId: "",
    list: {},
    scheduleDropRoot: {
      addEventListener: (_eventName, callback) => { drop = callback; },
    },
    bibleVerseDragPayloadFromDataTransfer: () => null,
    mediaLibraryItemIdFromDataTransfer: () => "library-item",
    queueDropPlacementFromEvent: () => ({ insertIndex: 0 }),
    hideQueueDropIndicator() {},
    resolveMediaLibraryDragItem: () => lookup.promise,
    applyDroppedMediaPaths: (...args) => added.push(args),
    showGnomeToast() {},
    console,
  };
  const start = scheduleSource.indexOf('scheduleDropRoot.addEventListener("drop", async (e) => {');
  const end = scheduleSource.indexOf("\n  });\n}", start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(scheduleSource.slice(start, end + "\n  });".length), context);

  const pendingDrop = drop({
    dataTransfer: {},
    preventDefault() {},
    stopPropagation() {},
  });
  context.currentProjectGuid = "project-two";
  context.mediaQueue = [];
  lookup.resolve({ localPath: "/media/clip.mp4", availability: "available" });
  await pendingDrop;
  assert.deepEqual(added, []);
});

function audioHarness({ fileBacked, resolvePath, play }) {
  const item = { path: "/media/clip.mp3" };
  const patches = [];
  const sends = [];
  const audio = {
    src: "file:///media/clip.mp3",
    pause() {},
    removeAttribute() {},
    load() {},
    play,
  };
  const context = {
    audioOnlyFile: false,
    currentQueueIndex: 0,
    liveStartToken: 0,
    mediaFile: item.path,
    mediaQueue: [item],
    video: { src: "", volume: 1, pause() {} },
    console: { error() {} },
    resolveQueuePresentationVideo() {},
    hidePptxPreview() {},
    nextLiveStartToken() { return ++context.liveStartToken; },
    ensureLiveAudioElement: () => audio,
    isFileBackedMediaPath: () => fileBacked,
    resolveQueueItemMediaPath: resolvePath,
    setSharedRendererState(patch) { Object.assign(context, patch); patches.push(patch); },
    removeFileProtocol: (value) => value,
    pathToMediaUrl: () => "file:///media/clip.mp3",
    queueItemMediaCacheBust: () => "",
    queueItemCueStartTime: () => 0,
    syncMediaLoopState() {},
    send: (...args) => sends.push(args),
    addFilenameToTitlebar() {},
    syncPreviewAudioTrackState() {},
    syncPreviewMediaAfterPresentationStateChange() {},
    updateDynUI() {},
    normalizeMediaPathForCompare: (value) => value,
    waitForLoadedMetadata: async () => {},
    consumePendingCueVolume() {},
    loopTargetEnabled: () => false,
    liveLoopTarget: () => null,
    refreshLiveAudioControls() {},
    updateTimestamp() {},
  };
  const code = functionSource(runtimeSource, "async function playAudioOnlyLocally(", "async function createMediaWindow(");
  const start = vm.runInNewContext(`${code}\nplayAudioOnlyLocally`, context);
  return { audio, context, item, patches, sends, start };
}

test("a superseded audio path resolution cannot replace the new cue", async () => {
  const path = deferred();
  const harness = audioHarness({
    fileBacked: true,
    resolvePath: () => path.promise,
    play: async () => {},
  });
  const oldStart = harness.start();
  harness.context.liveStartToken += 1;
  harness.context.mediaQueue.push({ path: "/media/new.mp3" });
  harness.context.currentQueueIndex = 1;
  path.resolve(harness.item.path);

  assert.equal(await oldStart, false);
  assert.deepEqual(harness.patches, []);
  assert.equal(harness.audio.src, "file:///media/clip.mp3");
});

test("a rejected local audio play reports failure and clears live state", async () => {
  const harness = audioHarness({
    fileBacked: false,
    resolvePath: async () => "/media/clip.mp3",
    play: async () => { throw new Error("autoplay blocked"); },
  });
  assert.equal(await harness.start(), false);
  assert.equal(harness.context.playingMediaAudioOnly, false);
  assert.equal(harness.context.isPlaying, false);
  assert.equal(harness.context.liveAudioQueueIndex, -1);
  assert.deepEqual(harness.sends.at(-1), ["localMediaState", 0, "stop"]);
});

test("an obsolete queue start failure leaves a newer take's state alone", async () => {
  const loading = deferred();
  const item = { path: "/media/old.mp4" };
  const token = { item };
  const patches = [];
  let owns = true;
  const context = {
    mediaQueue: [item],
    currentQueueIndex: 0,
    video: null,
    performance: { now: () => 1 },
    console: { error() {} },
    audiencePlaybackCoordinator: {
      owns: () => owns,
      indexOf: () => 0,
    },
    nextPreviewLoadToken() {},
    resolveQueuePresentationVideo() {},
    setSharedRendererState: (patch) => patches.push(patch),
    isScheduleItemCurrentlyPlayable: () => true,
    queueItemNeedsPendingUpdateApproval: () => false,
    isQueueItemAudio: () => false,
    isNetworkStreamSource: () => false,
    clearLowerThirdForUnsupportedMediaSource: () => loading.promise,
  };
  const code = functionSource(playbackSource, "async function playCurrentQueueItem(", "async function advanceQueueAfterMediaWindowClosed(");
  const playCurrentQueueItem = vm.runInNewContext(`${code}\nplayCurrentQueueItem`, context);
  const oldStart = playCurrentQueueItem({ transitionToken: token });
  const beforeSupersession = patches.length;
  owns = false;
  loading.reject(new Error("old file failed"));

  assert.equal(await oldStart, false);
  assert.equal(patches.length, beforeSupersession);
});
