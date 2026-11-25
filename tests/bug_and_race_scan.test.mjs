import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { MediaWatcher } from "../src/main-process/media-watcher.mjs";
import { createMediaWatchIdentityRegistry } from "../src/shared/media-watch-identity.mjs";
import { PlaybackTransitionCoordinator } from "../src/shared/playback-transition-coordinator.mjs";
import { setItemThemeRole } from "../src/shared/theme-item-overrides.mjs";

const [rendererSource, operatorChromeSource, mediaLoopSource, playbackSource, mainSource, themeManagerSource] =
  await Promise.all([
    readFile(new URL("../src/control-window/app-renderer.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/control-window/app-operator-chrome.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/control-window/app-media-loop.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/control-window/app-presentation-playback.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/dialogs/theme_manager.mjs", import.meta.url), "utf8"),
  ]);

function functionSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Could not find ${startMarker}`);
  return source.slice(start, end);
}

test("MediaWatcher notifies renderer when stabilizing check settles unchanged and clears Updating state", () => {
  const sent = [];
  const watcher = new MediaWatcher({
    app: { isPackaged: false },
    devRoot: "/tmp",
    sendToRenderer: (channel, payload) => sent.push([channel, payload]),
  });
  const registry = createMediaWatchIdentityRegistry();
  const item = {
    path: "/media/deck.pptx",
    liveSource: { mode: "linked", originalPath: "/media/deck.pptx" },
    fileHash: "0123456789abcdef",
    sizeBytes: 1024,
  };
  const queueItemId = registry.idFor(item);
  watcher.addItem(
    watcher.normalizeWatchItem({
      queueItemId,
      originalPath: item.path,
      pinnedFileHash: item.fileHash,
      pinnedSizeBytes: item.sizeBytes,
      pinnedMtimeMs: 5000,
    }),
  );

  const context = {
    mediaQueue: [item],
    mediaWatchIdentity: registry,
    selectedQueueAnchorIndex: -1,
    mediaUpdatePayloadQueueItemIds: (payload) =>
      payload.queueItemIds ? new Set(payload.queueItemIds) : null,
    normalizeMediaPathForCompare: (p) => p,
    queueItemLiveSource: (entry) => entry.liveSource,
    queueItemCanKeepOldMediaVersion: () => false,
    mediaUpdateWarningFingerprint: (u) => u.fileHash || "",
    pendingMediaUpdateStatus: (u) => u?.status || "ready",
    shouldPreserveReadyMediaUpdate: (existing, next) =>
      Boolean(existing) && (existing.status || "ready") === "ready" && (next.status || "ready") !== "ready",
    pendingMediaUpdateMatches: () => false,
    applyMediaUpdateMissingFlag: () => false,
    queueIndexInRange: () => false,
    setSharedRendererState() {},
    renderQueue() {},
    showGnomeToast() {},
    scheduleAutosaveProjectState() {},
    Date,
  };
  const code = functionSource(
    mediaLoopSource,
    "function markQueueItemMediaUpdate(",
    "async function approvePendingMediaUpdate(",
  );
  const markQueueItemMediaUpdate = vm.runInNewContext(
    `${code}\nmarkQueueItemMediaUpdate`,
    context,
  );

  watcher.handleSidecarChanged({
    originalPath: item.path,
    queueItemIds: [queueItemId],
    status: "stabilizing",
  });
  assert.equal(sent.at(-1)?.[0], "media-source-stabilizing");
  markQueueItemMediaUpdate({ ...sent.at(-1)[1], status: "stabilizing" });
  assert.equal(item.pendingMediaUpdate?.status, "stabilizing");

  // Unchanged settlement from sidecar clears the stabilizing badge.
  watcher.handleSidecarChanged({
    originalPath: item.path,
    queueItemIds: [queueItemId],
    status: "unchanged",
  });
  assert.equal(sent.at(-1)?.[0], "media-source-changed");
  assert.equal(sent.at(-1)?.[1]?.status, "unchanged");
  markQueueItemMediaUpdate(sent.at(-1)[1]);
  assert.equal(item.pendingMediaUpdate, undefined);

  // Ready notification whose digest matches the item's pinned hash also clears stabilizing.
  watcher.handleSidecarChanged({
    originalPath: item.path,
    queueItemIds: [queueItemId],
    status: "stabilizing",
  });
  markQueueItemMediaUpdate({ ...sent.at(-1)[1], status: "stabilizing" });
  assert.equal(item.pendingMediaUpdate?.status, "stabilizing");

  watcher.handleSidecarChanged({
    originalPath: item.path,
    queueItemIds: [queueItemId],
    status: "ready",
    fileHash: item.fileHash,
    sizeBytes: 1024,
    mtimeMs: 6000,
  });
  markQueueItemMediaUpdate(sent.at(-1)[1]);
  assert.equal(item.pendingMediaUpdate, undefined);
});

test("Theme Manager item operations follow the item object across schedule reorder and deletion", async () => {
  const firstSong = { name: "Opening Hymn", type: "song", path: "ems-song://1" };
  const secondSong = { name: "Closing Hymn", type: "song", path: "ems-song://2" };
  let openedContext = null;
  const toasts = [];
  const listeners = new Map();

  const context = vm.createContext({
    mediaQueue: [firstSong, secondSong],
    previewCueIndex: -1,
    currentQueueIndex: -1,
    scheduleItemThemeIdentity: createMediaWatchIdentityRegistry(),
    queueIndexInRange(idx) {
      return Number.isInteger(idx) && idx >= 0 && idx < context.mediaQueue.length;
    },
    isQueueItemBible: (item) => item?.type === "bible",
    invoke: async (_channel, payload) => {
      openedContext = payload;
    },
    on: (channel, handler) => {
      listeners.set(channel, handler);
    },
    setItemThemeRole,
    renderQueue() {},
    scheduleAutosaveProjectState() {},
    loadQueueItemIntoPreviewCue: async () => {},
    loadQueueItemIntoControlWindow: async () => {},
    nextPreviewLoadToken: () => 1,
    showGnomeToast: (msg) => toasts.push(msg),
    Number,
    Promise,
    console,
  });

  const openFn = functionSource(
    rendererSource,
    "async function openThemeManagerForQueueItem(",
    "function installCueButtonHandlers(",
  );
  const ipcHandlers = functionSource(
    operatorChromeSource,
    "const refreshThemedQueueItemPreview",
    'on("song-projection-error"',
  );
  const normalizeContextFn = functionSource(
    mainSource,
    "function normalizeThemeManagerContext(",
    "function createThemeManagerWindow(",
  );
  vm.runInContext(`${openFn}\n${normalizeContextFn}\n${ipcHandlers}`, context);

  // Open Theme Manager for firstSong at slot 0.
  await vm.runInContext('openThemeManagerForQueueItem(0, "audience")', context);
  assert.ok(openedContext?.queueItemId, "item open context carries a stable queueItemId");
  const normalized = vm.runInContext(
    `normalizeThemeManagerContext(${JSON.stringify(openedContext)})`,
    context,
  );
  assert.equal(normalized.queueItemId, openedContext.queueItemId);
  assert.match(themeManagerSource, /queueItemId/);

  // Reorder the schedule while Theme Manager remains open: secondSong now occupies slot 0.
  context.mediaQueue = [secondSong, firstSong];
  const sampleTheme = {
    schema: "ems.theme.v1",
    id: "theme_warm",
    name: "Warm Sanctuary",
    tokens: {},
    profiles: {
      song: { audience: { typography: { fontSize: 70 } } },
      scripture: {},
      text: {},
    },
    assets: [],
  };
  listeners.get("theme-applied-to-item")(null, {
    queueItemId: normalized.queueItemId,
    queueIndex: normalized.queueIndex, // stale index 0
    outputRole: "audience",
    theme: sampleTheme,
    profile: { typography: { fontSize: 70 } },
  });

  assert.equal(secondSong.itemTheme, undefined, "row now occupying old index 0 must not be themed");
  assert.ok(firstSong.itemTheme, "original item at its new index receives the theme");

  // Clear theme after another insertion shifts firstSong to index 2.
  context.mediaQueue = [{ name: "Announcement", type: "deck" }, secondSong, firstSong];
  listeners.get("theme-cleared-from-item")(null, {
    queueItemId: normalized.queueItemId,
    queueIndex: 0,
  });
  assert.equal(firstSong.itemTheme, undefined, "original item theme cleared at new index");

  // Removing firstSong before Apply must not fall back to theming slot 0.
  context.mediaQueue = [secondSong];
  listeners.get("theme-applied-to-item")(null, {
    queueItemId: normalized.queueItemId,
    queueIndex: 0,
    outputRole: "audience",
    theme: sampleTheme,
  });
  assert.equal(secondSong.itemTheme, undefined);
  assert.equal(toasts.at(-1), "The scheduled item is no longer available");
});

test("media-playback-ended overlapping a failed slipstream still closes or advances the finished clip", async () => {
  const coordinator = new PlaybackTransitionCoordinator();
  coordinator.activatePlayback("playback-live-1");

  let resolveInFlightSlipstream;
  const inFlightPromise = new Promise((resolve) => {
    resolveInFlightSlipstream = resolve;
  });

  const sent = [];
  let trySlipstreamCalls = 0;
  let nextAutoAdvanceResult = false;
  const handlers = new Map();

  const context = vm.createContext({
    audiencePlaybackCoordinator: coordinator,
    consumedMediaWindowEndEpoch: -1,
    liveMediaWindowEpoch: 3,
    mediaPlaybackEndedPending: false,
    userStopPresentationPending: false,
    queueSlipstreamTransitionInProgress: true,
    activeQueueSlipstreamPromise: inFlightPromise,
    isActiveMediaWindowCache: true,
    isActiveMediaWindow: () => context.isActiveMediaWindowCache,
    mediaFile: "/media/live.mp4",
    currentQueueIndex: 0,
    mediaQueue: [{ path: "/media/live.mp4" }],
    mediaPathMatchesCurrentLiveMedia: (p) => p === context.mediaFile,
    normalizeMediaPathForCompare: (p) => p,
    loopEnabledForLiveMedia: () => false,
    syncMediaLoopState() {},
    tracePlayback() {},
    setSharedRendererState(patch) {
      Object.assign(context, patch);
    },
    trySlipstreamNextQueueItem: async () => {
      trySlipstreamCalls += 1;
      if (context.queueSlipstreamTransitionInProgress) return false;
      return nextAutoAdvanceResult;
    },
    send: (...args) => sent.push(args),
    on: (channel, fn) => handlers.set(channel, fn),
    Promise,
    String,
    console,
  });

  const claimSource = functionSource(
    playbackSource,
    "function claimMediaWindowEnd(",
    "async function loadQueueItemIntoControlWindow(",
  );
  const endedStart = operatorChromeSource.indexOf('on("media-playback-ended"');
  const endedEnd = operatorChromeSource.indexOf('on("window-maximized"', endedStart);
  assert.ok(endedStart >= 0 && endedEnd > endedStart);
  vm.runInContext(`${claimSource}\n${operatorChromeSource.slice(endedStart, endedEnd)}`, context);

  // Natural end arrives while an operator slipstream is already in flight.
  const endedPromise = handlers.get("media-playback-ended")(null, {
    mediaFile: "/media/live.mp4",
    playbackId: "playback-live-1",
  });

  // The in-flight slipstream fails without replacing playback-live-1.
  context.queueSlipstreamTransitionInProgress = false;
  context.activeQueueSlipstreamPromise = null;
  resolveInFlightSlipstream(false);
  await endedPromise;

  assert.equal(trySlipstreamCalls, 1);
  assert.deepEqual(sent, [["close-media-window", 0]]);

  // Also verify that if queueSlipstreamTransitionInProgress is set without a tracked promise,
  // the claim is released so a second end event for the same epoch is not ignored.
  sent.length = 0;
  coordinator.activatePlayback("playback-live-2");
  context.liveMediaWindowEpoch = 4;
  context.consumedMediaWindowEndEpoch = -1;
  context.queueSlipstreamTransitionInProgress = true;
  context.activeQueueSlipstreamPromise = null;

  await handlers.get("media-playback-ended")(null, {
    mediaFile: "/media/live.mp4",
    playbackId: "playback-live-2",
  });
  assert.deepEqual(sent, [], "deferred while slipstream flag is set");

  // Slipstream fails; a subsequent end for epoch 4 must still be accepted and advance.
  context.queueSlipstreamTransitionInProgress = false;
  nextAutoAdvanceResult = true;
  await handlers.get("media-playback-ended")(null, {
    mediaFile: "/media/live.mp4",
    playbackId: "playback-live-2",
  });
  assert.deepEqual(sent, [], "slipstream auto-advance succeeded without closing window");
  assert.equal(context.consumedMediaWindowEndEpoch, 4);
});
