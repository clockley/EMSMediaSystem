import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { clampMediaTime, clampQueueStartTime } from "../src/shared/app-media-utils.mjs";

const sourceFiles = await Promise.all([
  "app-renderer.mjs", "app-media-runtime.mjs", "app-presentation-playback.mjs",
  "app-operator-chrome.mjs",
].map((name) => readFile(new URL(`../src/control-window/${name}`, import.meta.url), "utf8")));

// Execute complete production functions, without importing the renderer's DOM boot sequence.
function productionFunction(name) {
  const pattern = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^}`, "m");
  for (const source of sourceFiles) {
    const match = source.match(pattern);
    if (match) return match[0];
  }
  throw new Error(`Missing production function ${name}`);
}

class Element {
  constructor() {
    this.listeners = new Map();
    this.currentTime = 0;
    this.duration = 120;
    this.paused = true;
    this.src = "file:///clip.mp4";
    this.volume = 0.8;
    this.style = { setProperty() {} };
    this.dataset = {};
    this.hidden = false;
    this.isConnected = true;
  }
  addEventListener(name, callback, options = {}) {
    const handlers = this.listeners.get(name) || [];
    handlers.push({ callback, once: options.once });
    this.listeners.set(name, handlers);
  }
  removeEventListener(name, callback) {
    this.listeners.set(name, (this.listeners.get(name) || []).filter((entry) => entry.callback !== callback));
  }
  emit(name) {
    for (const entry of [...(this.listeners.get(name) || [])]) {
      if (entry.once) this.removeEventListener(name, entry.callback);
      entry.callback({ target: this, preventDefault() {}, stopPropagation() {} });
    }
  }
  pause() { this.paused = true; }
  async play() { this.playedAt = this.currentTime; this.paused = false; }
  load() { this.currentTime = 0; }
  removeAttribute(name) { if (name === "src") this.src = ""; }
  matches() { return true; }
}

function harness({ audio = false, cue = false, paused = true } = {}) {
  const main = new Element();
  const previewAudio = new Element();
  const previewCueVideo = new Element();
  const liveAudio = new Element();
  liveAudio.src = "";
  const item = { path: audio ? "/clip.mp3" : "/clip.mp4", type: audio ? "audio" : "video", duration: 120, cueStartTime: 0 };
  main.src = `file://${item.path}`;
  const controlMedia = cue ? audio ? previewAudio : previewCueVideo : main;
  controlMedia.paused = paused;
  const elements = new Map([["preview", main]]);
  const document = new Element();
  document.getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  document.querySelector = () => null;
  const state = {
    console, document, window: { setTimeout, clearTimeout }, queueMicrotask,
    AbortController, performance, clampMediaTime, clampQueueStartTime,
    audienceActive: false, sent: [], pidSeeking: false,
    mediaQueue: [item], currentQueueIndex: 0, previewCueIndex: cue ? 0 : -1,
    previewAudioCueIndex: cue && audio ? 0 : -1,
    previewCueVideoIndex: cue && !audio ? 0 : -1,
    video: main, previewAudio, previewCueVideo, liveAudio,
    currentMode: "media", MEDIAPLAYER: "media", STREAMPLAYER: "stream",
    mediaFile: item.path, activePreviewResolvedMediaFile: item.path,
    mediaPlayerInputState: { filePaths: [item.path] },
    isPlaying: false, isQueuePlaying: false, audioOnlyFile: audio,
    playingMediaAudioOnly: false, liveAudioQueueIndex: -1, liveStartToken: 0,
    startTime: 0, presentationStartInProgress: false,
    networkPreviewMirrorLiveEdge: false, networkPreviewMirrorSource: "",
    networkPreviewCueLiveEdge: false, networkPreviewCueSource: "",
    scripturePresentation: { state: { status: "idle" } },
    setSharedRendererState: (patch) => Object.assign(state, patch),
    isQueueItemAudio: (entry) => entry?.type === "audio",
    isQueueItemVideo: (entry) => entry?.type === "video",
    isQueueItemBible: () => false, isQueueItemSong: () => false,
    isQueueItemImage: () => false, isQueueItemPptx: () => false,
    queueItemIsLiveEdgeStream: () => false,
    isActiveMediaWindow: () => state.audienceActive,
    isLocalAppWindowPresentationActive: () => false,
    isPreviewWorkspaceOverlayVisible: () => false,
    previewShowsSameClipAsPath: () => true,
    networkPreviewUsesRendererCapture: () => false,
    isNetworkVideoPreviewCueActive: () => false,
    queueItemHidesNetworkScrubber: () => false,
    networkPreviewSourceHidesScrubber: () => false,
    currentQueuePreviewItem: () => item,
    previewTransportLoadIsPending: () => false,
    ensurePreviewCueVideoElement: () => previewCueVideo,
    ensurePreviewAudioElement: () => previewAudio,
    ensureLiveAudioElement: () => liveAudio,
    nextLiveStartToken: () => ++state.liveStartToken,
    isFileBackedMediaPath: () => true,
    resolveQueueItemMediaPath: async (entry) => entry.path,
    pathToMediaUrl: (path) => `file://${path}`,
    normalizeMediaPathForCompare: (path) => path,
    queueItemMediaCacheBust: () => "",
    waitForLoadedMetadata: async () => {},
    loopTargetEnabled: () => false,
    liveLoopTarget: () => null,
    currentPreviewSourcePath: () => item.path,
    isLikelyAudioItem: () => audio,
    mediaElementComparableSource: (element) => element.src,
    previewElementSourceMatchesMediaFile: () => false,
    isImg: () => false,
    isLiveStream: () => false,
    isNetworkStreamSource: () => false,
    isScheduleItemCurrentlyPlayable: () => true,
    queueItemNeedsPendingUpdateApproval: () => false,
    hasAudienceOutputSelected: () => true,
    syncStageContentFromQueueItem: async () => {},
    // Reloading the preview is a real transition boundary: it loses currentTime.
    loadQueueItemIntoControlWindow: async () => { main.load(); },
    createMediaWindow: async (options) => { state.outputStartTime = options.startTime; },
    saveMediaFile: () => { state.startTime = 0; main.load(); },
    clearCueAfterTake: () => { state.previewCueIndex = -1; },
    toggleLocalAudioOnlyPlaybackFromControls: async () => false,
    removeFileProtocol: (value) => value,
    pidController: {
      reset() { state.pidResetCount = (state.pidResetCount || 0) + 1; },
    },
    send: (...args) => { state.sent.push(args); },
  };
  for (const name of [
    "renderQueue", "updatePreviewCueUI", "updateQueueItemCueStartDisplay",
    "scheduleAutosaveProjectState", "paintTransportTimeDisplay", "bindTransportTimeDisplay",
    "disableNativeVideoControls", "syncMediaLoopState", "updateLoopControlState",
    "updateDynUI", "resolveQueuePresentationVideo", "hidePptxPreview", "nextPreviewLoadToken",
    "clearLowerThirdForUnsupportedMediaSource", "consumePendingCueVolume",
    "syncPreviewAudioTrackState", "addFilenameToTitlebar", "refreshLiveAudioControls",
    "updateTimestamp",
  ]) state[name] = () => {};
  vm.createContext(state);
  const names = [
    "queueItemSupportsCueStartTime", "queueItemCueStartTime", "normalizedQueueItemCueStartTime",
    "validMediaStartTime", "currentPreviewStartTimeForQueueItem", "presentationStartTimeForQueueItem",
    "currentPreviewCue", "isAudioPreviewCueActive", "isVideoPreviewCueActive",
    "getPreviewControlMediaElement", "queueStartIndexForPresent", "isQueuePresentationActive",
    "isPreparingSeparateCue", "trackedPreviewQueueIndexForMedia", "syncTrackedPreviewStartTime",
    "setCueStartTime", "seekMedia", "previewMediaControlsLiveProjection",
    "setupCustomMediaControls", "runPresentationStart",
    "playMedia", "playCurrentQueueItem", "playAudioOnlyLocally",
  ];
  vm.runInContext(names.map(productionFunction).join("\n"), state);
  state.setupCustomMediaControls();
  return { state, item, main, controlMedia, liveAudio, elements };
}

for (const audio of [false, true]) {
  for (const cue of [false, true]) {
    for (const paused of [false, true]) {
      test(`${audio ? "audio" : "video"} ${cue ? "dedicated cue" : "main preview"}, ${paused ? "paused" : "playing"}: Present preserves scrub through preview reload`, async () => {
        const { state, liveAudio, elements } = harness({ audio, cue, paused });
        elements.get("timeline").value = 31.25;
        elements.get("timeline").emit("input");
        await new Promise((resolve) => setImmediate(resolve));
        await state.playMedia();
        assert.equal(audio ? liveAudio.playedAt : state.outputStartTime, 37.5);
      });
    }
  }
}

test("paused audio cue timeline scrub saves the cue before a presentation is active", async () => {
  const { state, item, controlMedia, elements } = harness({ audio: true, cue: true, paused: true });
  elements.get("timeline").value = 25;
  elements.get("timeline").emit("input");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controlMedia.currentTime, 30);
  assert.equal(item.cueStartTime, 30);
  await state.playMedia();
  assert.equal(state.liveAudio.playedAt, 30);
});

test("a pending scrub cannot overwrite the newly selected item's saved cue", async () => {
  const { state, item, controlMedia, elements } = harness({ audio: true, cue: true });
  let completeSeek;
  state.seekMedia = () => new Promise((resolve) => { completeSeek = resolve; });
  elements.get("timeline").value = 25;
  elements.get("timeline").emit("input");
  const nextItem = { ...item, path: "/next.mp3", cueStartTime: 12 };
  state.mediaQueue = [nextItem];
  controlMedia.src = "file:///next.mp3";
  controlMedia.currentTime = 12;
  completeSeek(30);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nextItem.cueStartTime, 12);
  assert.equal(item.cueStartTime, 0);
});

test("scrubbing the live preview does not rewrite its saved presentation cue", async () => {
  const { state, item, elements } = harness();
  item.cueStartTime = 12;
  state.isPlaying = true;
  state.isQueuePlaying = true;
  elements.get("timeline").value = 25;
  elements.get("timeline").emit("input");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(item.cueStartTime, 12);
});

test("a live timeline scrub reaches the audience during PID seek suppression", async () => {
  const { state, elements } = harness({ paused: false });
  state.audienceActive = true;
  // Reproduce the intermittent race: an internal PID seek has opened its
  // event-suppression window when the operator moves the timeline.
  state.pidSeeking = true;

  elements.get("timeline").value = 50;
  elements.get("timeline").emit("input");
  await new Promise((resolve) => setImmediate(resolve));

  const seek = state.sent.find(([channel]) => channel === "timeGoto-message");
  assert.ok(seek, "operator seek must not depend on suppressed media events");
  assert.equal(seek[1].currentTime, 60);
  assert.equal(state.targetTime, 60);
  assert.equal(state.pidResetCount, 1);
});
