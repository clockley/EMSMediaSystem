/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

//Project Alchemy

"use strict";

let ipcRenderer;
let bibleAPI;
let webUtils;
let attachCubicWaveShaper;
let __dirname;

let send;
let invoke;
let on;
let getPathForFile;

async function waitForPreloadBridge(maxWaitTime = 30000) {
  const bridgeStartTime = Date.now();
  while (
    !window.electron ||
    !window.electron.ipcRenderer ||
    !windowControls
  ) {
    if (Date.now() - bridgeStartTime > maxWaitTime) {
      throw new Error("Timeout waiting for preload context");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function attachElectronBridge() {
  const electron = window.electron;
  if (
    !electron ||
    !electron.ipcRenderer ||
    !electron.webUtils ||
    typeof electron.attachCubicWaveShaper !== "function"
  ) {
    throw new Error("Electron preload bridge is incomplete");
  }
  ipcRenderer = electron.ipcRenderer;
  bibleAPI = electron.bibleAPI;
  webUtils = electron.webUtils;
  attachCubicWaveShaper = electron.attachCubicWaveShaper;
  __dirname = electron.__dirname;

  send = ipcRenderer.send;
  invoke = ipcRenderer.invoke;
  on = ipcRenderer.on;
  getPathForFile = webUtils.getPathForFile;

  globalThis.invoke = invoke;
}

var pidSeeking = false;
/**
 * Timer id (or null) for the deferred reset of `pidSeeking`. Writing
 * `video.currentTime` fires BOTH a `seeking` and a `seeked` event (and
 * occasionally extra events when the browser settles), so the swallow
 * flag must outlive the first handler call — otherwise the second event
 * sees `pidSeeking === false`, falls through, and echoes a
 * `timeGoto-message` back to the projection (visible as periodic
 * pauses/glitches, especially on the Streams tab where the hidden,
 * throttled preview drifts more and PID corrections fire more often).
 * The timer is the single source of truth for when the swallow window
 * closes; handlers no longer reset the flag themselves.
 */
var pidSeekingResetTimer = null;

/**
 * Open a "swallow PID seek events" window. Any seeking/seeked event the
 * preview fires in the next ~500 ms is treated as PID-driven and is
 * NOT echoed back to the projection. Re-arming during the window just
 * pushes the timeout out — that's correct: a rapid burst of PID
 * corrections is still one logical "do not forward" period.
 */
function beginPidSeekSuppression() {
  pidSeeking = true;
  if (pidSeekingResetTimer !== null) {
    clearTimeout(pidSeekingResetTimer);
  }
  pidSeekingResetTimer = setTimeout(() => {
    pidSeeking = false;
    pidSeekingResetTimer = null;
  }, 500);
}

var streamVolume = 1;
var video = null;
let previewAudio = null;
let previewAudioCueIndex = -1;
/**
 * Dedicated <video> overlay used for scrubbing a cued video item without
 * disturbing the main #preview element. Repurposing #preview for cue used
 * to pause the live mirror; routing video cues through this element keeps
 * the mirror playing the whole time. Hidden unless a video cue is loaded.
 */
let previewCueVideo = null;
let previewCueVideoIndex = -1;
let liveAudio = null;
let liveAudioQueueIndex = -1;
let previewLoadToken = 0;
let liveStartToken = 0;
let isHandlingLiveEnded = false;
let isAdvancingQueue = false;
var masterPauseState = false;
var activeLiveStream = false;
var targetTime = 0;
var startTime = 0;
var prePathname = "";
var playingMediaAudioOnly = false;
var audioOnlyFile = false;
var currentMode = -1;
var localTimeStampUpdateIsRunning = false;
var mediaFile;
var fileEnded = false;
var mediaSessionPause = false;
let isPlaying = false;
let img = null;
let itc = 0;
let hasShownPreviewWarning = false;
let playPauseBtn;
let playPauseIcon;
let timeline;
let currentTimeDisplay;
let volumePopupOpen = false;
let durationTimeDisplay;
let repeatButton;
const MEDIAPLAYER = 0,
  STREAMPLAYER = 1,
  BULKMEDIAPLAYER = 5,
  TEXTPLAYER = 6;
const imageRegex = /\.(bmp|gif|jpe?g|png|webp|svg|ico)$/i;
let isActiveMediaWindowCache = false;
const SECONDS = new Int32Array(1);
const SECONDSFLOAT = new Float64Array(1);
const textNode = document.createTextNode("");
const updatePending = new Int32Array(1);
let videoWrapper;
let focusableControls;
let controlsOverlay;
const mediaPlayerInputState = {
  filePaths: [],
  urlInpt: null,
  clear() {
    this.filePaths = [];
    this.urlInpt = null;
  },
};

/** @type {{ path: string, name: string, type: string, cueStartTime?: number }[]} */
let mediaQueue = [];
let currentQueueIndex = -1;
let previewCueIndex = -1;
let isQueuePlaying = false;
/** True after natural playback end (signaled before media window closes). */
let mediaPlaybackEndedPending = false;
let queueSlipstreamTransitionInProgress = false;
/** When set, closing the media window switches to this queue index instead of advancing/stopping. */
let pendingQueueSwitchIndex = null;
let pendingQueueSwitchStartTime = 0;
let suppressPreviewForwarding = false;
/**
 * When true, the next media-window-closed finishes a full-queue clear (snapshot already taken;
 * presentation was closed from the clear action).
 */
let pendingQueueClearPostClose = false;
/**
 * Snapshot for undo after "Clear" on the media queue (HIG: perform + restore).
 * @type {null | { items: { path: string; name: string; type: string; cueStartTime: number }[]; index: number; cueIndex: number; seekTime: number; wasPresentationActive: boolean }}
 */
let queueClearUndoSnapshot = null;
/** After reorder drop, ignore the synthetic click on the row. */
let ignoreNextQueueItemClick = false;
/** Last <video> element that received cubic waveshaper wiring. */
let cubicWaveShaperAttachedVideo = null;

/** Hidden host for the persistent <video id="preview"> across tab switches. */
const PREVIEW_STASH_ID = "previewStash";
/** Persistent tab shells under `#dyneForm` — built once, shown/hidden per tab. */
const TAB_PANEL_MEDIA_ID = "tab-panel-media";
const TAB_PANEL_STREAMS_ID = "tab-panel-streams";

function isQueueAutoAdvanceEnabled() {
  const el = document.getElementById("queueAutoAdvanceCtl");
  return !el || el.checked;
}

function isPlayInterruptedError(error) {
  if (!error) return false;
  const msg = typeof error.message === "string" ? error.message : "";
  return (
    error.name === "AbortError" ||
    msg.includes("interrupted by a call to pause()")
  );
}

async function playVideoSafely(mediaEl, context = "") {
  if (!mediaEl || typeof mediaEl.play !== "function") return false;
  try {
    await mediaEl.play();
    return true;
  } catch (error) {
    if (isPlayInterruptedError(error)) {
      return false;
    }
    const suffix = context ? ` (${context})` : "";
    console.error(`Failed to start playback${suffix}:`, error);
    return false;
  }
}

function pathToMediaUrl(filePath) {
  if (!filePath || typeof filePath !== "string") return "";
  if (/^(file|https?|blob):/i.test(filePath)) return filePath;

  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    return `file://${encodeURI(normalized)}`;
  }
  return `file:///${encodeURI(normalized)}`;
}

function clampMediaTime(time, duration) {
  if (!Number.isFinite(time) || time < 0) return 0;
  if (Number.isFinite(duration) && duration > 0) {
    return Math.min(time, Math.max(0, duration - 0.05));
  }
  return time;
}

function seekMedia(mediaEl, requestedTime) {
  if (!mediaEl) return Promise.resolve(0);
  const target = clampMediaTime(requestedTime, mediaEl.duration);

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const cleanup = () => {
      mediaEl.removeEventListener("seeked", finish);
      mediaEl.removeEventListener("error", finish);
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : target);
    };

    mediaEl.addEventListener("seeked", finish, { once: true });
    mediaEl.addEventListener("error", finish, { once: true });

    try {
      mediaEl.currentTime = target;
    } catch {
      cleanup();
      resolve(Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : 0);
      return;
    }

    if (Math.abs(mediaEl.currentTime - target) < 0.05) {
      queueMicrotask(finish);
    }
    timer = window.setTimeout(finish, 800);
  });
}

function nextPreviewLoadToken() {
  previewLoadToken += 1;
  return previewLoadToken;
}

function isCurrentPreviewLoad(token) {
  return token === previewLoadToken;
}

function nextLiveStartToken() {
  liveStartToken += 1;
  return liveStartToken;
}

function classifyQueueMediaType(filePath) {
  if (imageRegex.test(filePath)) return "image";
  if (/\.(mp4|m4v|mov|mkv|webm|avi|wmv)$/i.test(filePath)) return "video";
  if (/\.(mp3|m4a|aac|wav|flac|ogg|opus|wma)$/i.test(filePath)) return "audio";
  return "file";
}

function isQueueItemAudio(item) {
  return Boolean(
    item &&
      (item.type === "audio" || classifyQueueMediaType(item.path) === "audio"),
  );
}

function isQueueItemImage(item) {
  return Boolean(
    item && (item.type === "image" || (item.path && isImg(item.path))),
  );
}

function isLikelyVideoItem(filePath) {
  return classifyQueueMediaType(filePath) === "video";
}

function isLikelyAudioItem(filePath) {
  return classifyQueueMediaType(filePath) === "audio";
}

function mediaElementHasTracks(mediaEl, trackName) {
  const tracks = mediaEl?.[trackName];
  return Boolean(tracks && typeof tracks.length === "number" && tracks.length > 0);
}

function mediaElementLoadedAudioOnly(mediaEl, filePath) {
  if (isLikelyAudioItem(filePath)) return true;
  if (isImg(filePath)) return false;

  const videoTracks = mediaEl?.videoTracks;
  if (!videoTracks || typeof videoTracks.length !== "number") {
    return false;
  }

  return videoTracks.length === 0;
}

function ensurePreviewAudioElement() {
  if (!previewAudio) {
    previewAudio = new Audio();
    previewAudio.preload = "metadata";
    previewAudio.muted = true;
    previewAudio.volume = 0;
    // While an audio cue is loaded, its timeline owns the countdown
    // overlay so the operator sees the cue's "time remaining" update as
    // they scrub — same contract as the video cue overlay.
    const paintIfActive = () => {
      if (isAudioPreviewCueActive()) paintCountdownFor(previewAudio);
    };
    previewAudio.addEventListener("timeupdate", paintIfActive);
    previewAudio.addEventListener("seeked", paintIfActive);
    previewAudio.addEventListener("loadedmetadata", paintIfActive);
  }
  return previewAudio;
}

function ensureLiveAudioElement() {
  if (!liveAudio) {
    liveAudio = new Audio();
    liveAudio.preload = "auto";
    liveAudio.addEventListener("ended", endLiveAudioPresentation);
  }
  return liveAudio;
}

function stopLiveAudioPresentation() {
  liveStartToken += 1;
  if (liveAudio) {
    try {
      liveAudio.pause();
      liveAudio.removeAttribute("src");
      liveAudio.load();
    } catch (err) {
      console.error("Failed to stop live audio:", err);
    }
  }
  liveAudioQueueIndex = -1;
  playingMediaAudioOnly = false;
}

function isAudioPreviewCueActive() {
  const cue = currentPreviewCue();
  return Boolean(
    previewAudio &&
      cue &&
      isQueueItemAudio(cue.item) &&
      previewAudioCueIndex === previewCueIndex,
  );
}

/**
 * True when the dedicated cue overlay holds a loaded video cue. Used by
 * the controls so the timeline / play button drive the cue overlay
 * instead of the live mirror while the operator is scrubbing.
 */
function isVideoPreviewCueActive() {
  const cue = currentPreviewCue();
  return Boolean(
    previewCueVideo &&
      cue &&
      !isQueueItemAudio(cue.item) &&
      previewCueVideoIndex === previewCueIndex &&
      !previewCueVideo.hidden,
  );
}

function getPreviewControlMediaElement() {
  if (isAudioPreviewCueActive()) return previewAudio;
  if (isVideoPreviewCueActive()) return previewCueVideo;
  return video;
}

function queueBasename(filePath) {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

function createQueueEntry(filePath) {
  return {
    path: filePath,
    name: queueBasename(filePath),
    type: classifyQueueMediaType(filePath),
    cueStartTime: 0,
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCueTime(seconds) {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalSeconds = Math.floor(safe);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const millis = Math.floor((safe - totalSeconds) * 1000);
  return `${mins}:${secs.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
}

function currentLiveQueueItem() {
  return currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
    ? mediaQueue[currentQueueIndex]
    : null;
}

function findQueueIndexByPath(filePath) {
  const normalized = normalizeMediaPathForCompare(filePath);
  if (!normalized) return -1;
  return mediaQueue.findIndex(
    (item) => normalizeMediaPathForCompare(item.path) === normalized,
  );
}

function currentPreviewCue() {
  if (previewCueIndex < 0 || previewCueIndex >= mediaQueue.length) {
    return null;
  }
  const item = mediaQueue[previewCueIndex];
  if (!item) return null;
  return {
    index: previewCueIndex,
    item,
    startTime:
      Number.isFinite(item.cueStartTime) && item.cueStartTime > 0
        ? item.cueStartTime
        : 0,
  };
}

function currentCueEditableQueueIndex() {
  const explicitCue = currentPreviewCue();
  if (explicitCue) return explicitCue.index;

  // Before pressing Present, the selected/previewed queue item is still
  // allowed to receive a cue start time. This lets the operator prep the
  // queue before going live.
  if (
    currentMode === MEDIAPLAYER &&
    !isQueuePresentationActive() &&
    currentQueueIndex >= 0 &&
    currentQueueIndex < mediaQueue.length
  ) {
    return currentQueueIndex;
  }

  return -1;
}

/**
 * Fallback "next up" when the operator has not explicitly cued anything.
 *
 * Without this, the Presentation status card said "No item cued" forever
 * once a show was running — even after the operator added five more files
 * to the queue. The status card is the operator's single source of truth
 * for "what plays after this"; if it lies, they reach for the queue list
 * to double-check every time they add a file.
 *
 * Rules:
 *   - If something is actively playing, the implicit next is the item
 *     directly after `currentQueueIndex`.
 *   - If nothing is playing yet, the implicit next is the head of the
 *     queue (so adding the first file immediately shows "Next: that file"
 *     and the operator can see what Present will start with).
 *   - Returns null at the end of the queue or when empty.
 *
 * Returned shape mirrors {@link currentPreviewCue} so callers can treat
 * the two interchangeably for label rendering.
 */
function currentImplicitNextItem() {
  if (mediaQueue.length === 0) return null;
  let nextIdx = -1;
  if (currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length - 1) {
    nextIdx = currentQueueIndex + 1;
  } else if (currentQueueIndex < 0) {
    nextIdx = 0;
  }
  if (nextIdx < 0) return null;
  const item = mediaQueue[nextIdx];
  if (!item) return null;
  return {
    index: nextIdx,
    item,
    startTime:
      Number.isFinite(item.cueStartTime) && item.cueStartTime > 0
        ? item.cueStartTime
        : 0,
    implicit: true,
  };
}

function isQueuePresentationActive() {
  return Boolean(
    isQueuePlaying &&
      (isPlaying || isActiveMediaWindow() || isLocalAppWindowPresentationActive()),
  );
}

function isPreparingSeparateCue() {
  return Boolean(
    currentMode === MEDIAPLAYER &&
      isQueuePresentationActive() &&
      previewCueIndex >= 0 &&
      previewCueIndex < mediaQueue.length &&
      previewCueIndex !== currentQueueIndex,
  );
}

function shouldSuppressPreviewForwarding() {
  return suppressPreviewForwarding || isPreparingSeparateCue();
}

function updatePreviewCueUI() {
  const liveItem = isQueuePresentationActive() ? currentLiveQueueItem() : null;
  const explicitCue = currentPreviewCue();
  const implicitNext = currentImplicitNextItem();
  // "Next:" tracks what auto-advance (or pressing Space) will actually
  // play after the current item finishes — i.e. whatever is sitting at
  // currentQueueIndex+1 in queue order. We honor the explicit cue only
  // when it already lines up with that slot (the normal case, since
  // cueing a file moves it to right-after-current), or when nothing is
  // live yet (no implicit next to compete with). The moment the
  // operator drags the cued file out of the next slot — or drags some
  // other file into it — the readout switches to that new "natural"
  // next item so it reflects queue order, not a stale cue pointer.
  // Without this the label appeared frozen on the cue's filename after
  // any reorder that involved the next slot.
  const explicitCueIsNext =
    explicitCue &&
    (currentQueueIndex < 0 ||
      explicitCue.index === currentQueueIndex + 1);
  // Fall back to the explicit cue when there is no natural next item
  // (current is the last queue entry): the operator still loaded a cue
  // and the readout should reflect that instead of claiming "No item
  // cued" while the cue overlay is right there on screen.
  const nextUp = explicitCueIsNext
    ? explicitCue
    : (implicitNext ?? explicitCue);
  const nowPlaying = document.getElementById("nowPlayingLabel");
  const upNext = document.getElementById("upNextLabel");
  const audioCuePanel = document.getElementById("audioCuePanel");
  const cueBtn = document.getElementById("cueCurrentPositionBtn");
  const playNowBtn = document.getElementById("playCueNowBtn");

  if (nowPlaying) {
    nowPlaying.textContent = liveItem
      ? liveItem.name
      : isPlaying
        ? getHostnameOrBasename(mediaFile || "Presentation active")
        : "Nothing live";
    nowPlaying.title = nowPlaying.textContent;
  }

  if (upNext) {
    upNext.textContent = nextUp ? nextUp.item.name : "No item cued";
    upNext.title = upNext.textContent;
  }

  if (audioCuePanel) {
    audioCuePanel.hidden = true;
  }

  const editableCueIndex = currentCueEditableQueueIndex();

  // Allow cue-start editing before Present.
  if (cueBtn) {
    cueBtn.disabled = editableCueIndex < 0;
  }

  // Play Now should only be available while a presentation is already live
  // and a separate explicit cue exists.
  if (playNowBtn) {
    playNowBtn.disabled = !explicitCue || !isQueuePresentationActive();
  }
}

function setCueStartTime(index, start) {
  if (index < 0 || index >= mediaQueue.length) return;
  const safe = Number.isFinite(start) && start > 0 ? start : 0;
  mediaQueue[index].cueStartTime = safe;
  if (previewCueIndex === index) {
    updatePreviewCueUI();
  }
  renderQueue();
}

function clearPreviewCue() {
  stopPreviewAudioCue();
  clearVideoPreviewCueOverlay();
  previewCueIndex = -1;
  restoreCountdownForLiveMedia();
  updatePreviewCueUI();
  renderQueue();
}

function clearCueAfterTake(index) {
  if (previewCueIndex === index) {
    stopPreviewAudioCue();
    clearVideoPreviewCueOverlay();
    previewCueIndex = -1;
    restoreCountdownForLiveMedia();
  }
  updatePreviewCueUI();
  renderQueue();
}

function stopPreviewAudioCue() {
  if (previewAudio) {
    try {
      previewAudio.pause();
      previewAudio.removeAttribute("src");
      previewAudio.load();
    } catch (err) {
      console.error("Failed to clear preview audio cue:", err);
    }
  }
  previewAudioCueIndex = -1;
}

/**
 * Resolve the dedicated cue-scrub <video> element. The element lives next
 * to #preview in the wrapper and is recreated whenever the media form is
 * regenerated, so this lookup is best done lazily on each access.
 */
function ensurePreviewCueVideoElement() {
  if (previewCueVideo && previewCueVideo.isConnected) return previewCueVideo;
  previewCueVideo = document.getElementById("previewCue");
  if (previewCueVideo) {
    previewCueVideo.muted = true;
    previewCueVideo.volume = 0;
    // Force the native <video> chrome off. The HTML attribute is omitted
    // (see generateMediaFormHTML) but we re-assert the property in JS so
    // anything that later mutates the element can't accidentally turn the
    // stock scrubber back on — the operator already drives the custom
    // controls bar.
    previewCueVideo.controls = false;
    previewCueVideo.removeAttribute("controls");
    try {
      previewCueVideo.controlsList?.add(
        "nodownload",
        "nofullscreen",
        "noremoteplayback",
      );
    } catch {
      /* controlsList not supported — CSS rule below still hides chrome */
    }
    previewCueVideo.disablePictureInPicture = true;
    if (!previewCueVideo.dataset.cueHandlersInstalled) {
      installPreviewCueVideoHandlers(previewCueVideo);
      previewCueVideo.dataset.cueHandlersInstalled = "true";
    }
  }
  return previewCueVideo;
}

/**
 * Load a queued video item into the dedicated cue overlay, seek it to the
 * cue start, and reveal it on top of the live mirror. The main #preview
 * element is never touched, so the live mirror keeps playing the whole
 * time the operator scrubs the cued item.
 */
async function loadVideoQueueItemIntoPreviewCueOverlay(index, item, startTime) {
  const token = nextPreviewLoadToken();
  const el = ensurePreviewCueVideoElement();
  if (!el) return;
  previewCueVideoIndex = index;

  // When an image is the current live output, img#preview sits after
  // #previewCue in the DOM and paints over it. Hide it so the operator
  // can see the video cue overlay. Restored in clearVideoPreviewCueOverlay.
  const liveImg = document.querySelector("img#preview");
  if (liveImg) liveImg.style.display = "none";

  try {
    el.pause();
  } catch {
    /* ignore */
  }
  el.muted = true;
  el.volume = 0;
  el.preload = "metadata";
  el.removeAttribute("src");
  el.removeAttribute("poster");
  el.load();
  el.src = pathToMediaUrl(item.path);
  el.load();
  el.hidden = false;

  await waitForLoadedMetadata(el);
  if (!isCurrentPreviewLoad(token) || previewCueIndex !== index) {
    clearVideoPreviewCueOverlay();
    return;
  }

  const actualStart = await seekMedia(el, startTime);
  if (!isCurrentPreviewLoad(token) || previewCueIndex !== index) {
    clearVideoPreviewCueOverlay();
    return;
  }

  setCueStartTime(index, actualStart);
  if (Number.isFinite(el.duration) && el.duration > 0) {
    mediaQueue[index].duration = el.duration;
  }

  if (timeline && Number.isFinite(el.duration) && el.duration > 0) {
    timeline.value = (actualStart / el.duration) * 100;
    if (currentTimeDisplay) currentTimeDisplay.textContent = formatTime(actualStart);
    if (durationTimeDisplay) durationTimeDisplay.textContent = formatTime(el.duration);
    document
      .getElementById("customControls")
      ?.style.setProperty("visibility", "visible");
  }
}

/**
 * Per-element handlers for the cue overlay. The custom controls in
 * setupCustomMediaControls already route through currentControlMedia(),
 * which will return previewCueVideo when a video cue is active. The only
 * extra wiring this element needs is to persist the operator's scrub
 * position as the cue start, mirroring how `seekingLocalMedia` does it
 * for the main #preview while in cue mode, plus drive the countdown
 * overlay from the cue's currentTime so the displayed "time remaining"
 * tracks the scrub instead of the live media.
 */
function installPreviewCueVideoHandlers(el) {
  const persistCueStartFromScrub = (event) => {
    if (
      previewCueIndex < 0 ||
      previewCueIndex !== previewCueVideoIndex ||
      currentMode !== MEDIAPLAYER
    ) {
      return;
    }
    setCueStartTime(previewCueIndex, event.target.currentTime);
  };
  el.addEventListener("seeking", persistCueStartFromScrub);
  el.addEventListener("seeked", persistCueStartFromScrub);

  const paintIfActive = () => {
    if (isVideoPreviewCueActive()) paintCountdownFor(el);
  };
  el.addEventListener("timeupdate", paintIfActive);
  el.addEventListener("seeked", paintIfActive);
  el.addEventListener("loadedmetadata", paintIfActive);
}

function queueTypeIconMarkup(type) {
  switch (type) {
    case "video":
      return `<svg class="queue-item-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V8.5l3 2V4.5l-3 2V4a1 1 0 0 0-1-1H2z"/></svg>`;
    case "audio":
      return `<svg class="queue-item-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M12 1v9.5a2.5 2.5 0 1 1-1-2.15V5H8V1h4zM5.5 9A1.5 1.5 0 1 0 7 10.5 1.5 1.5 0 0 0 5.5 9z"/></svg>`;
    case "image":
      return `<svg class="queue-item-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 2h12v12H2V2zm1 1v8.59l2.5-2.5 2 2L13 5.41V3H3zm7.5 1a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/></svg>`;
    default:
      return `<svg class="queue-item-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3 2h10v12H3V2zm1 1v10h8V3H4zm1 1h6v1H5V4zm0 2h4v1H5V6zm0 2h6v1H5V8z"/></svg>`;
  }
}

function renderQueue() {
  const listContainer = document.getElementById("mediaQueueList");
  if (!listContainer) return;

  if (mediaQueue.length === 0) {
    listContainer.innerHTML =
      '<div class="list-placeholder">' +
      '<span class="list-placeholder-title">No media in queue</span>' +
      '<span class="list-placeholder-hint">Add media to begin</span>' +
      "</div>";
  } else {
    // State badges decouple status (live / cued) from row selection. The
    // .active background still highlights the live row, but the LIVE pill
    // says *why* it's highlighted — so a row that is just selected after
    // load-but-not-playing reads differently from one mid-presentation.
    const presentationLive = isQueuePresentationActive();
    const editableCueIndex = currentCueEditableQueueIndex();

    listContainer.innerHTML = mediaQueue
      .map((item, index) => {
        const hasCueStart =
          Number.isFinite(item.cueStartTime) && item.cueStartTime > 0;

        const isLive = presentationLive && index === currentQueueIndex;

        // Explicit cue while presenting, or a prepared cue before Present.
        // Before Present, only show the Cued badge after the operator has
        // actually stored a non-zero cue start time.
        const isCued =
          index === previewCueIndex ||
          (!presentationLive && index === editableCueIndex && hasCueStart);

        const classes = [
          "queue-item",
          index === currentQueueIndex ? " active" : "",
          isCued ? " cued" : "",
          isLive ? " live" : "",
        ].join("");
        const cueStartMarkup = hasCueStart
          ? `<span class="item-cue-start">Starts ${formatCueTime(item.cueStartTime)}</span>`
          : "";
        const badges = [];
        if (isLive) {
          badges.push('<span class="state-badge state-badge--live">Live</span>');
        }
        if (isCued) {
          badges.push('<span class="state-badge state-badge--cued">Cued</span>');
        }
        const statusMarkup =
          badges.length || hasCueStart
            ? `<span class="item-status-row">${badges.join("")}${cueStartMarkup}</span>`
            : "";
        return `<div class="${classes}" role="listitem" data-queue-index="${index}">
      <span class="queue-drag-handle" draggable="true" data-queue-index="${index}" title="Drag to reorder" aria-label="Drag to reorder">
        <svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true"><circle cx="3" cy="3" r="1.5" fill="currentColor"/><circle cx="9" cy="3" r="1.5" fill="currentColor"/><circle cx="3" cy="8" r="1.5" fill="currentColor"/><circle cx="9" cy="8" r="1.5" fill="currentColor"/><circle cx="3" cy="13" r="1.5" fill="currentColor"/><circle cx="9" cy="13" r="1.5" fill="currentColor"/></svg>
      </span>
      <span class="item-icon">${queueTypeIconMarkup(item.type)}</span>
      <span class="item-text">
        <span class="item-label" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        ${statusMarkup}
      </span>
      <button type="button" class="remove-btn" draggable="false" data-queue-remove="${index}" title="Remove from queue" aria-label="Remove from queue">✕</button>
    </div>`;
      })
      .join("");
  }
  updateClearQueueButtonState();
  updatePreviewCueUI();
}

function updateClearQueueButtonState() {
  const btn = document.getElementById("clearQueueBtn");
  if (btn) {
    const empty = mediaQueue.length === 0;
    // Per HIG: don't draw attention to actions that have no effect.
    // Hide the Clear button entirely when there is nothing to clear,
    // rather than leaving a disabled control next to the empty header.
    btn.hidden = empty;
    btn.disabled = empty;
    btn.setAttribute("aria-disabled", empty ? "true" : "false");
  }
  updatePreviewEmptyState();
}

/**
 * Show the large "Drop media here / or click Add Media" target on the preview
 * surface only when there is no media to look at — empty queue, no preview
 * source loaded, and we're on the Media tab. The drop itself is already
 * accepted by the document-level drop handler; this overlay is purely a
 * first-use affordance so removing the sidebar Open Media block does not
 * leave the empty state without a call to action.
 */
function updatePreviewEmptyState() {
  const overlay = document.getElementById("previewEmptyState");
  if (!overlay) return;
  if (currentMode !== MEDIAPLAYER) {
    overlay.hidden = true;
    return;
  }
  const previewEl = document.getElementById("preview");
  const hasPreviewSrc = !!(previewEl && previewEl.src && previewEl.src !== "");
  const hasImage = !!document.querySelector(".video-wrapper img");
  const empty = mediaQueue.length === 0 && !hasPreviewSrc && !hasImage;
  overlay.hidden = !empty;
}

function reorderMediaQueue(fromIndex, toIndex) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= mediaQueue.length ||
    toIndex >= mediaQueue.length
  ) {
    return;
  }

  const activePath =
    currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
      ? mediaQueue[currentQueueIndex].path
      : null;
  const cuePath =
    previewCueIndex >= 0 && previewCueIndex < mediaQueue.length
      ? mediaQueue[previewCueIndex].path
      : null;

  const [item] = mediaQueue.splice(fromIndex, 1);
  mediaQueue.splice(toIndex, 0, item);

  if (activePath !== null) {
    const ni = mediaQueue.findIndex((q) => q.path === activePath);
    currentQueueIndex = ni >= 0 ? ni : -1;
  }
  if (cuePath !== null) {
    const ci = mediaQueue.findIndex((q) => q.path === cuePath);
    previewCueIndex = ci >= 0 ? ci : -1;
    // The cue overlay's loaded src hasn't changed — only the index did —
    // so keep previewCueVideoIndex aligned with the new index instead of
    // tearing the overlay down.
    if (previewCueVideoIndex >= 0) {
      previewCueVideoIndex = previewCueIndex;
    }
  }

  ignoreNextQueueItemClick = true;
  window.setTimeout(() => {
    ignoreNextQueueItemClick = false;
  }, 400);

  invalidateQueueUndoToastAfterMutation();
  renderQueue();
  // renderQueue() already refreshes the Presentation card's Next row via
  // updatePreviewCueUI, but the call is made explicit here too so a future
  // renderQueue refactor can't silently regress the "Next: <file>" label
  // after a drag-reorder. The operator's mental model is "I moved this
  // file, the card should reflect it now" — covering that contract at the
  // mutation site keeps it from drifting away from rendering concerns.
  updatePreviewCueUI();
  saveMediaFile();
}

function enqueuePathsFromFilePicker(paths) {
  if (currentMode !== MEDIAPLAYER || !paths.length) return;
  invalidateQueueUndoToastAfterMutation();
  for (const p of paths) {
    mediaQueue.push(createQueueEntry(p));
  }
  renderQueue();
}

/** Electron open dialog preserves multi-selection order better than <input type="file">. */
function installMediaOpenButton() {
  // The Add Media affordance lives in the headerbar (static markup), not the
  // dynamic sidebar. Bind once on first call; subsequent calls (from mode
  // switches re-rendering `#dyneForm`) are no-ops thanks to the guard.
  const button = document.getElementById("headerAddMediaButton");
  if (!button || button.dataset.openDialogBound === "1") return;
  button.dataset.openDialogBound = "1";
  button.addEventListener("click", openMediaFilesDialog);
}

/**
 * The headerbar Add Media button only makes sense in the Media tab — the
 * Streams tab uses a URL field, and the Text tab has its own input. Hide
 * the button in non-Media modes instead of leaving a dead control.
 */
function updateHeaderAddMediaButtonVisibility() {
  const button = document.getElementById("headerAddMediaButton");
  if (!button) return;
  const visible = currentMode === MEDIAPLAYER;
  button.hidden = !visible;
  button.setAttribute("aria-hidden", visible ? "false" : "true");
}

async function openMediaFilesDialog() {
  if (currentMode !== MEDIAPLAYER) return;
  try {
    const res = await invoke("show-media-files-dialog");
    if (!res || res.canceled || !res.filePaths?.length) return;
    enqueuePathsFromFilePicker(res.filePaths);
    saveMediaFile();
  } catch (err) {
    console.error(err);
  }
}

/**
 * Convert a renderer-supplied DataTransfer into native paths and forward them
 * to the main process for media-extension filtering. The drop event itself
 * must be observed in the renderer (Electron does not surface DOM drop events
 * to the main process), but every validation/decision step lives in main.
 *
 * @returns {Promise<string[]>} filtered, allowed media paths
 */
async function extractAndFilterDroppedMediaPaths(dataTransfer) {
  if (!dataTransfer?.files?.length) return [];
  const paths = [];
  for (const file of dataTransfer.files) {
    const p = getPathForFile(file);
    if (typeof p === "string" && p.length > 0) paths.push(p);
  }
  if (paths.length === 0) return [];
  try {
    const filtered = await invoke("filter-media-drop-paths", paths);
    return Array.isArray(filtered) ? filtered : [];
  } catch (err) {
    console.error("filter-media-drop-paths failed:", err);
    return [];
  }
}

function applyDroppedMediaPaths(paths) {
  if (!paths || paths.length === 0) return;
  if (currentMode === MEDIAPLAYER) {
    enqueuePathsFromFilePicker(paths);
  }
  saveMediaFile();
}

function clearMediaQueue() {
  stopPreviewAudioCue();
  clearVideoPreviewCueOverlay();
  mediaQueue = [];
  currentQueueIndex = -1;
  previewCueIndex = -1;
  isQueuePlaying = false;
  // Hand the countdown overlay back to the live media (or hide it if the
  // queue clear leaves nothing playing). Without this, a cleared queue
  // that previously hosted an image cue would leave the overlay hidden
  // even after the operator dragged in a new audio/video clip.
  restoreCountdownForLiveMedia();
  renderQueue();
}

/** Stop local preview playback after the queue is cleared (HIG: no “ghost” audio/video). */
function pauseLocalPreviewAfterQueueClear() {
  stopLiveAudioPresentation();
  if (playingMediaAudioOnly) {
    send("localMediaState", 0, "stop");
    playingMediaAudioOnly = false;
  }
  localTimeStampUpdateIsRunning = false;
  if (video !== null && mediaFile && !isImg(mediaFile)) {
    video.pause();
    video.currentTime = 0;
    targetTime = 0;
    startTime = 0;
  }
}

function discardQueueClearUndoSnapshot() {
  queueClearUndoSnapshot = null;
}

async function captureQueueClearUndoState() {
  let seekTime = 0;
  if (isActiveMediaWindow()) {
    try {
      const t = await invoke("get-media-current-time");
      seekTime = typeof t === "number" && Number.isFinite(t) ? t : 0;
    } catch (err) {
      console.error(err);
      seekTime = 0;
    }
  }
  queueClearUndoSnapshot = {
    items: mediaQueue.map((x) => ({
      path: x.path,
      name: x.name,
      type: x.type,
      cueStartTime: x.cueStartTime,
    })),
    index: currentQueueIndex,
    cueIndex: previewCueIndex,
    seekTime,
    wasPresentationActive: Boolean(
      isQueuePlaying && isActiveMediaWindow() && isPlaying,
    ),
  };
}

function showQueueClearedUndoToast() {
  showGnomeToast("Queue cleared", {
    onUndo: () => {
      void restoreQueueClearUndoSnapshot();
    },
    onUndoExpire: () => {
      discardQueueClearUndoSnapshot();
    },
    duration: 10000,
    undoStyle: "pill-accent",
  });
}

async function finalizeQueueClearDestructive() {
  pendingQueueSwitchIndex = null;
  pendingQueueSwitchStartTime = 0;
  mediaPlaybackEndedPending = false;
  pendingQueueClearPostClose = false;
  isPlaying = false;
  isQueuePlaying = false;
  updateDynUI();
  isActiveMediaWindowCache = false;
  clearMediaQueue();
  saveMediaFile();
  pauseLocalPreviewAfterQueueClear();
  showQueueClearedUndoToast();
}

async function resumeQueuePresentationAtTime(seekTime) {
  const item =
    currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
      ? mediaQueue[currentQueueIndex]
      : null;
  if (!item) return;

  resolveQueuePresentationVideo();
  const localVideo = video;

  mediaPlaybackEndedPending = false;
  await loadQueueItemIntoControlWindow(item, {
    preservePreviewSeek: false,
  });
  renderQueue();

  isQueuePlaying = true;
  isPlaying = true;
  updateDynUI();

  const iM = isImg(mediaFile);
  if (iM) {
    await createMediaWindow();
    if (localVideo && !localVideo.paused) {
      localVideo.removeAttribute("src");
      localVideo.load();
    }
    return;
  }

  const live = isLiveStream(mediaFile);
  if (!live && localVideo && seekTime > 0.05) {
    const d = localVideo.duration;
    let safe = seekTime;
    if (Number.isFinite(d) && d > 0) {
      safe = Math.min(seekTime, Math.max(0, d - 0.25));
    }
    try {
      await new Promise((resolve) => {
        const done = () => resolve();
        const t = window.setTimeout(done, 400);
        const onSeeked = () => {
          window.clearTimeout(t);
          localVideo.removeEventListener("seeked", onSeeked);
          done();
        };
        localVideo.addEventListener("seeked", onSeeked, { once: true });
        localVideo.currentTime = safe;
      });
      startTime = localVideo.currentTime;
      targetTime = startTime;
    } catch (err) {
      console.error(err);
    }
  }

  await createMediaWindow({ seekOnly: !live });
}

async function restoreQueueClearUndoSnapshot() {
  const snap = queueClearUndoSnapshot;
  if (!snap) return;
  queueClearUndoSnapshot = null;

  mediaQueue = snap.items.map((x) => ({
    path: x.path,
    name: x.name,
    type: x.type,
    cueStartTime: x.cueStartTime || 0,
  }));
  currentQueueIndex = snap.index;
  if (mediaQueue.length === 0) {
    currentQueueIndex = -1;
  } else if (currentQueueIndex >= mediaQueue.length) {
    currentQueueIndex = mediaQueue.length - 1;
  } else if (currentQueueIndex < 0) {
    currentQueueIndex = 0;
  }

  // Restore the cued item (the "next" marker) and its per-item start time
  // (already embedded in each queue entry via cueStartTime).
  previewCueIndex =
    typeof snap.cueIndex === "number" &&
    snap.cueIndex >= 0 &&
    snap.cueIndex < mediaQueue.length
      ? snap.cueIndex
      : -1;

  renderQueue();
  saveMediaFile();

  if (
    snap.wasPresentationActive &&
    currentQueueIndex >= 0 &&
    currentQueueIndex < mediaQueue.length
  ) {
    await resumeQueuePresentationAtTime(snap.seekTime);
    return;
  }

  if (
    currentMode === MEDIAPLAYER &&
    mediaQueue.length > 0 &&
    currentQueueIndex >= 0 &&
    !isPlaying
  ) {
    void loadQueueItemIntoControlWindow(
      mediaQueue[currentQueueIndex],
    ).catch((err) => console.error(err));
  }
}

async function onClearMediaQueueClick() {
  if (mediaQueue.length === 0) return;
  pendingQueueSwitchIndex = null;
  pendingQueueSwitchStartTime = 0;
  await captureQueueClearUndoState();

  if (isActiveMediaWindow()) {
    pendingQueueClearPostClose = true;
    isQueuePlaying = false;
    isPlaying = false;
    updateDynUI();
    clearMediaQueue();
    pauseLocalPreviewAfterQueueClear();
    showQueueClearedUndoToast();
    send("close-media-window", 0);
    return;
  }

  await finalizeQueueClearDestructive();
}

function removeFromQueue(index) {
  if (index < 0 || index >= mediaQueue.length) return;
  if (isQueuePlaying && index === currentQueueIndex) {
    showGnomeToast("Stop the presentation to remove the current item");
    return;
  }
  invalidateQueueUndoToastAfterMutation();
  mediaQueue.splice(index, 1);
  if (currentQueueIndex > index) currentQueueIndex--;
  else if (currentQueueIndex >= mediaQueue.length) currentQueueIndex = -1;
  if (previewCueIndex === index) {
    previewCueIndex = -1;
    stopPreviewAudioCue();
    clearVideoPreviewCueOverlay();
    // The removed item was the cue, so the cue is gone — hand the
    // countdown overlay back to the live media (image: hidden;
    // audio/video: repainted with live time).
    restoreCountdownForLiveMedia();
    syncPlayPauseIconToControlMedia();
  } else if (previewCueIndex > index) {
    previewCueIndex--;
    // Keep the cue overlay's index in sync with the shifted cue index so
    // isVideoPreviewCueActive() keeps recognising the loaded overlay as
    // the still-active cue after the surrounding queue shrinks.
    if (previewCueVideoIndex > index) previewCueVideoIndex--;
  } else if (previewCueIndex >= mediaQueue.length) previewCueIndex = -1;
  renderQueue();
  if (currentMode === MEDIAPLAYER && mediaQueue.length > 0 && !isPlaying) {
    void loadQueueItemIntoControlWindow(mediaQueue[0]).catch((err) =>
      console.error(err),
    );
  }
}

function installMediaQueueListDelegation() {
  const list = document.getElementById("mediaQueueList");
  if (!list || list.dataset.queueDelegation === "1") return;
  list.dataset.queueDelegation = "1";
  list.addEventListener("click", (e) => {
    const removeBtn = e.target.closest("[data-queue-remove]");
    if (removeBtn && list.contains(removeBtn)) {
      e.preventDefault();
      removeFromQueue(
        Number.parseInt(removeBtn.getAttribute("data-queue-remove"), 10),
      );
      return;
    }
    if (e.target.closest(".queue-drag-handle")) return;
    if (ignoreNextQueueItemClick) return;
    const row = e.target.closest(".queue-item[data-queue-index]");
    if (!row || !list.contains(row)) return;
    const idx = Number.parseInt(row.getAttribute("data-queue-index"), 10);
    if (Number.isNaN(idx)) return;
    void onQueueItemActivate(idx);
  });

  list.addEventListener("dragstart", (e) => {
    const handle = e.target.closest(".queue-drag-handle");
    if (!handle || !list.contains(handle)) return;
    e.stopPropagation();
    const idx = Number.parseInt(handle.getAttribute("data-queue-index"), 10);
    if (Number.isNaN(idx)) return;
    e.dataTransfer.setData("application/x-queue-index", String(idx));
    e.dataTransfer.effectAllowed = "move";
    const row = handle.closest(".queue-item");
    if (row) row.classList.add("queue-item-dragging");
  });

  list.addEventListener("dragend", (e) => {
    list.querySelectorAll(".queue-item-dragging").forEach((el) => {
      el.classList.remove("queue-item-dragging");
    });
    list.querySelectorAll(".queue-item-drag-over").forEach((el) => {
      el.classList.remove("queue-item-drag-over");
    });
  });

  list.addEventListener("dragover", (e) => {
    if (
      e.dataTransfer?.types &&
      Array.from(e.dataTransfer.types).includes("Files")
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      return;
    }
    const row = e.target.closest(".queue-item[data-queue-index]");
    if (!row || !list.contains(row)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    list.querySelectorAll(".queue-item-drag-over").forEach((el) => {
      if (el !== row) el.classList.remove("queue-item-drag-over");
    });
    row.classList.add("queue-item-drag-over");
  });

  list.addEventListener("dragleave", (e) => {
    const row = e.target.closest(".queue-item[data-queue-index]");
    if (
      row &&
      list.contains(row) &&
      typeof e.relatedTarget === "object" &&
      e.relatedTarget &&
      !row.contains(e.relatedTarget)
    ) {
      row.classList.remove("queue-item-drag-over");
    }
  });

  list.addEventListener("drop", async (e) => {
    const hasOSFiles =
      e.dataTransfer?.files?.length > 0 ||
      (e.dataTransfer?.types &&
        Array.from(e.dataTransfer.types).includes("Files"));
    if (hasOSFiles) {
      e.preventDefault();
      e.stopPropagation();
      list.querySelectorAll(".queue-item-drag-over").forEach((el) => {
        el.classList.remove("queue-item-drag-over");
      });
      const paths = await extractAndFilterDroppedMediaPaths(e.dataTransfer);
      applyDroppedMediaPaths(paths);
      return;
    }
    const row = e.target.closest(".queue-item[data-queue-index]");
    if (!row || !list.contains(row)) return;
    e.preventDefault();
    e.stopPropagation();
    const fromStr = e.dataTransfer.getData("application/x-queue-index");
    const from = Number.parseInt(fromStr, 10);
    const to = Number.parseInt(row.getAttribute("data-queue-index"), 10);
    list.querySelectorAll(".queue-item-drag-over").forEach((el) => {
      el.classList.remove("queue-item-drag-over");
    });
    if (Number.isNaN(from) || Number.isNaN(to)) return;
    reorderMediaQueue(from, to);
  });
}

function installCueButtonHandlers() {
  const cueBtn = document.getElementById("cueCurrentPositionBtn");
  const playNowBtn = document.getElementById("playCueNowBtn");
  if (!cueBtn || cueBtn.dataset.handlersBound === "1") {
    return;
  }
  cueBtn.dataset.handlersBound = "1";
  cueBtn.addEventListener("click", cueFromCurrentPosition);
  playNowBtn?.addEventListener("click", () => {
    void playCueNow().catch((err) => console.error(err));
  });
}

/**
 * The Settings expander hides Display + Autoplay + Auto-advance behind a
 * disclosure so the queue can dominate the sidebar. Restoring the user's
 * last-chosen open state keeps the sidebar adaptive — operators who change
 * the switches every show don't have to re-expand each session, while users
 * who set them once and forget still get the compact default. We use
 * localStorage instead of the settings IPC because there's no
 * `set-setting` handler in main and adding one for a UI-only flag would be
 * over-architected.
 */
const OPTIONS_EXPANDER_STORAGE_KEY = "ems.mediaOptionsExpander.open";

function installMediaOptionsExpander() {
  const expander = document.getElementById("mediaOptionsExpander");
  if (!expander || expander.dataset.expanderBound === "1") return;
  expander.dataset.expanderBound = "1";
  try {
    expander.open =
      window.localStorage?.getItem(OPTIONS_EXPANDER_STORAGE_KEY) === "1";
  } catch {
    // localStorage can throw in restricted contexts; default to collapsed.
  }
  expander.addEventListener("toggle", () => {
    try {
      window.localStorage?.setItem(
        OPTIONS_EXPANDER_STORAGE_KEY,
        expander.open ? "1" : "0",
      );
    } catch {
      /* swallow — UI works either way */
    }
  });
}

/**
 * Make the preview empty-state placard click/Enter/Space-activatable. The
 * card itself is in the dynamically-rendered media form, so handlers are
 * (re)installed each time setSBFormMediaPlayer rebuilds `#dyneForm`. The
 * card is purely a fallback affordance — drops anywhere on the document
 * still work, and the headerbar Add Media button does the same thing.
 */
function installPreviewEmptyStateHandlers() {
  const card = document.querySelector(
    "#previewEmptyState .preview-empty-state__card",
  );
  if (!card || card.dataset.emptyStateBound === "1") return;
  card.dataset.emptyStateBound = "1";
  card.addEventListener("click", () => {
    void openMediaFilesDialog();
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void openMediaFilesDialog();
    }
  });
}

async function restorePreviewToLiveOutput(index) {
  if (index < 0 || index >= mediaQueue.length) return;

  // The main #preview element has been mirroring the live output the whole
  // time the cue overlay was visible — it was never reloaded with the cued
  // source — so "restoring" just means tearing down the cue scratch state.
  // No reload, no replay, no risk of the live mirror lingering in a paused
  // state because the resume race was lost.
  previewCueIndex = -1;
  stopPreviewAudioCue();
  clearVideoPreviewCueOverlay();
  // The cue may have hidden the countdown overlay (image cue) or pinned
  // it to the cue's time-remaining (video/audio cue). Either way the
  // live media is now back in charge, so re-establish whatever the live
  // source dictates: hidden for image live, repainted with live time
  // otherwise. handleTimeMessage takes over from the next IPC tick.
  restoreCountdownForLiveMedia();

  if (liveAudioQueueIndex >= 0 && liveAudio?.src && liveAudio.src !== "") {
    // The audio-cue panel may have been displayed over the audio-only mirror;
    // refresh the scrubber so it shows liveAudio's position again.
    refreshLiveAudioControls();
  }

  syncPreviewAudioTrackState();
  updatePreviewCueUI();
  renderQueue();

  syncPlayPauseIconToControlMedia();
}

async function loadAudioQueueItemIntoPreviewCue(index, item, startTime) {
  const token = nextPreviewLoadToken();
  const audio = ensurePreviewAudioElement();
  previewAudioCueIndex = index;

  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  audio.muted = true;
  audio.volume = 0;
  audio.preload = "metadata";
  audio.src = pathToMediaUrl(item.path);

  await waitForLoadedMetadata(audio);
  if (!isCurrentPreviewLoad(token) || previewCueIndex !== index) return;

  const duration = Number.isFinite(audio.duration) && audio.duration > 0
    ? audio.duration
    : item.duration || 0;
  const actualStart = await seekMedia(audio, startTime);
  if (!isCurrentPreviewLoad(token) || previewCueIndex !== index) return;

  setCueStartTime(index, actualStart);
  if (duration > 0) {
    mediaQueue[index].duration = duration;
  }
  if (timeline && duration > 0) {
    timeline.value = (actualStart / duration) * 100;
    currentTimeDisplay.textContent = formatTime(actualStart);
    durationTimeDisplay.textContent = formatTime(duration);
    document
      .getElementById("customControls")
      ?.style.setProperty("visibility", "visible");
  }
}

function moveQueueItemAfterCurrent(index) {
  if (!isQueuePresentationActive()) return index;
  if (currentQueueIndex < 0 || currentQueueIndex >= mediaQueue.length) return index;
  if (index < 0 || index >= mediaQueue.length) return index;
  if (index === currentQueueIndex || index === currentQueueIndex + 1) {
    return index;
  }

  const liveItem = mediaQueue[currentQueueIndex];
  const [cueItem] = mediaQueue.splice(index, 1);
  currentQueueIndex = mediaQueue.indexOf(liveItem);
  const insertAt = Math.min(currentQueueIndex + 1, mediaQueue.length);
  mediaQueue.splice(insertAt, 0, cueItem);
  currentQueueIndex = mediaQueue.indexOf(liveItem);
  invalidateQueueUndoToastAfterMutation();
  saveMediaFile();
  return mediaQueue.indexOf(cueItem);
}

/**
 * Tear down any loaded cue source on the overlay and hide it. The main
 * #preview element is left untouched so the live mirror keeps playing.
 */
function clearVideoPreviewCueOverlay() {
  const el = previewCueVideo || document.getElementById("previewCue");
  previewCueVideoIndex = -1;
  if (!el) return;
  const hadPoster = el.hasAttribute("poster");
  try {
    el.pause();
    el.removeAttribute("src");
    el.removeAttribute("poster");
    el.load();
  } catch (err) {
    console.error("Failed to clear preview cue overlay:", err);
  }
  el.hidden = true;
  if (hadPoster) {
    document.getElementById("customControls")?.style.setProperty("visibility", "");
  }

  // If the live output is still an image, restore its visibility now that
  // the cue overlay is gone. Without this the preview goes blank after
  // the operator dismisses a video cue while an image is presenting.
  if (mediaFile && isImg(mediaFile)) {
    const liveImg = document.querySelector("img#preview");
    if (liveImg) liveImg.style.display = "";
  }
}

async function loadQueueItemIntoPreviewCue(index) {
  if (index < 0 || index >= mediaQueue.length) return;
  if (index === currentQueueIndex && isQueuePresentationActive()) {
    await restorePreviewToLiveOutput(index);
    return;
  }

  index = moveQueueItemAfterCurrent(index);
  previewCueIndex = index;
  const item = mediaQueue[index];
  const cueStart =
    Number.isFinite(item.cueStartTime) && item.cueStartTime > 0
      ? item.cueStartTime
      : 0;

  if (isLocalAppWindowPresentationActive() && isQueueItemAudio(item)) {
    setCueStartTime(index, cueStart);
    updatePreviewCueUI();
    renderQueue();
    return;
  }

  if (isQueueItemImage(item)) {
    clearVideoPreviewCueOverlay();
    stopPreviewAudioCue();
    // Show the image in the cue overlay so the operator sees what's staged.
    // The <video #previewCue> element renders its poster when it has no src,
    // giving us the image preview without loading a video or disturbing the
    // live mirror underneath. previewCueVideoIndex is intentionally left at
    // -1 (set by clearVideoPreviewCueOverlay) so isVideoPreviewCueActive()
    // stays false and the custom controls keep driving the live mirror, not
    // this static image display.
    const cueEl = ensurePreviewCueVideoElement();
    if (cueEl) {
      cueEl.poster = pathToMediaUrl(item.path);
      cueEl.hidden = false;
    }
    setMediaCountdownOverlayVisible(false);
    textNode.data = "";
    // No timeline to scrub for a static image — hide the transport controls
    // so the operator isn't offered play/seek/loop actions that have no effect.
    // clearVideoPreviewCueOverlay restores visibility when the cue clears.
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
  } else if (isQueueItemAudio(item)) {
    // Tear down a stale video cue overlay before loading the audio cue
    // so the operator never sees an old video frame lingering over the
    // live mirror after switching to audio.
    clearVideoPreviewCueOverlay();
    // Audio cues never load into the visible overlay video, but they
    // need the countdown chrome visible to show the cue's time remaining
    // (the live media may have hidden it, e.g. while displaying an
    // image). The actual digits are painted by previewAudio's
    // timeupdate/seeked handlers in ensurePreviewAudioElement. Clear the
    // stale text first so we don't briefly flash the live media's
    // countdown before the cue's metadata loads.
    setMediaCountdownOverlayVisible(true);
    textNode.data = "";
    await loadAudioQueueItemIntoPreviewCue(index, item, cueStart);
  } else {
    // Video cues used to re-load the main #preview element with the cued
    // source, which forcibly paused the live mirror. That confused
    // operators who expected the live preview to keep running while they
    // scrub a different item ("the preview that is matching the live
    // video should never pause just because the user switched to scrub
    // the queued media"). The cue now goes into a dedicated overlay so
    // the mirror keeps playing underneath, undisturbed.
    stopPreviewAudioCue();
    // Make sure the countdown overlay is visible before the cue's
    // metadata handler paints into it — the live media might have hidden
    // it (image live) and we don't want a frame of blank chrome.
    setMediaCountdownOverlayVisible(true);
    textNode.data = "";
    await loadVideoQueueItemIntoPreviewCueOverlay(index, item, cueStart);
    syncPreviewAudioTrackState();
  }
  updatePreviewCueUI();
  renderQueue();
}

async function takeQueueItemLive(index, startTime = 0) {
  if (index < 0 || index >= mediaQueue.length) return;
  if (pendingQueueSwitchIndex !== null) return;

  const safeStart = Number.isFinite(startTime) && startTime > 0 ? startTime : 0;
  mediaQueue[index].cueStartTime = safeStart;

  if (isAudioOnlyQueuePresentationActive()) {
    stopLiveAudioPresentation();
    if (video && audioOnlyFile) {
      try {
        video.pause();
      } catch (err) {
        console.error("Failed to pause local audio before taking cue:", err);
      }
    }
    send("localMediaState", 0, "stop");
    removeFilenameFromTitlebar();
    playingMediaAudioOnly = false;
    audioOnlyFile = false;
    isActiveMediaWindowCache = false;
    mediaPlaybackEndedPending = false;
  }

  if (isActiveMediaWindow()) {
    const switchedInPlace = await slipstreamQueueItemAtIndex(index, {
      startTime: safeStart,
      clearCue: true,
    });
    if (switchedInPlace) {
      return;
    }
    if (queueSlipstreamTransitionInProgress) {
      return;
    }
    pendingQueueSwitchIndex = index;
    pendingQueueSwitchStartTime = safeStart;
    await closeActiveMediaWindowNow();
    return;
  }

  currentQueueIndex = index;
  isQueuePlaying = true;
  isPlaying = true;
  updateDynUI();
  await playCurrentQueueItem({
    preservePreviewSeek: false,
    startTime: safeStart,
  });
  clearCueAfterTake(index);
}

function cueFromCurrentPosition() {
  const index = currentCueEditableQueueIndex();
  const controlMedia = getPreviewControlMediaElement();

  if (index < 0 || !controlMedia) return;

  const start =
    Number.isFinite(controlMedia.currentTime) && controlMedia.currentTime > 0
      ? controlMedia.currentTime
      : 0;

  setCueStartTime(index, start);
  showGnomeToast(`Cued start: ${formatCueTime(start)}`);
}

async function playCueNow() {
  const cue = currentPreviewCue();
  if (!cue) return;

  // If something is already presenting (either the dedicated media window or
  // an audio-only file in the app window), confirm with the operator before
  // interrupting it. The same modal is reused that the media-window driven
  // queue switch uses, so the interaction is consistent across paths.
  const presentationActive =
    isActiveMediaWindow() || isLocalAppWindowPresentationActive();
  if (presentationActive) {
    const liveItem =
      currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
        ? mediaQueue[currentQueueIndex]
        : null;
    const liveLabel = liveItem ? liveItem.name : "the current presentation";
    const cueLabel = cue.item?.name || "the cued item";
    const message = `Switch the live presentation from "${liveLabel}" to "${cueLabel}"?`;
    let accepted = false;
    try {
      accepted = await invoke("show_queue_switch_dialog", { message });
    } catch (err) {
      console.error("Failed to show queue switch dialog:", err);
      accepted = false;
    }
    if (!accepted) return;
  }

  await takeQueueItemLive(cue.index, cue.startTime);
}

async function onQueueItemActivate(index) {
  if (index < 0 || index >= mediaQueue.length) return;

  // Audio-only items play locally without a media window, but they're still
  // an active presentation: prompt before swapping them out.
  const isLocalPresentation = isLocalAppWindowPresentationActive();

  if (!isActiveMediaWindow() && !isLocalPresentation) {
    const activateIndex = index;
    currentQueueIndex = activateIndex;
    const token = nextPreviewLoadToken();
    await loadQueueItemIntoControlWindow(mediaQueue[activateIndex], {
      previewLoadToken: token,
    });
    if (!isCurrentPreviewLoad(token) || currentQueueIndex !== activateIndex) {
      return;
    }
    renderQueue();
    saveMediaFile();
    return;
  }

  await loadQueueItemIntoPreviewCue(index);
}

async function stopQueuePresentationUserClosed() {
  stopLiveAudioPresentation();
  isQueuePlaying = false;
  isPlaying = false;
  updateDynUI();
  isActiveMediaWindowCache = false;
  renderQueue();

  if (
    currentMode === MEDIAPLAYER &&
    mediaQueue.length > 0 &&
    currentQueueIndex >= 0
  ) {
    mediaFile = mediaQueue[currentQueueIndex].path;
    mediaPlayerInputState.filePaths = [mediaFile];
    updateQueueFileLabel(mediaQueue[currentQueueIndex].name);
  } else if (
    currentMode === MEDIAPLAYER &&
    mediaPlayerInputState.filePaths.length > 0
  ) {
    mediaFile = mediaPlayerInputState.filePaths[0];
  }

  let isImgFile = isImg(mediaFile);
  handleMediaPlayback(isImgFile);

  let imgEle = document.querySelector("img");
  handleImageDisplay(isImgFile, imgEle);

  resetVideoState();

  updatePlayButtonOnMediaWindow();
  masterPauseState = false;
  saveMediaFile();
  removeFilenameFromTitlebar();
  textNode.data = "";
}

function updateQueueFileLabel(name) {
  const fileNameSpan = document.querySelector(".file-input-label span");
  if (fileNameSpan) {
    fileNameSpan.textContent = name;
    fileNameSpan.title = name;
  }
}

/** Canonical form for comparing a queue path to the preview element's `src`. */
function normalizeMediaPathForCompare(filePath) {
  if (!filePath || typeof filePath !== "string") return "";
  try {
    let s = filePath.trim();
    if (s.startsWith("file://")) {
      s = decodeURI(removeFileProtocol(s));
    } else {
      s = decodeURI(s);
    }
    return s.replace(/\\/g, "/");
  } catch {
    return filePath.replace(/\\/g, "/");
  }
}

/** True when the preview <video> is showing the same local file as `filePath`. */
function previewShowsSameClipAsPath(filePath) {
  if (!video || !video.src) return false;
  if (!filePath || isImg(filePath) || isLiveStream(filePath)) return false;
  if (isImg(video.src) || isLiveStream(video.src)) return false;
  return (
    normalizeMediaPathForCompare(video.src) ===
    normalizeMediaPathForCompare(filePath)
  );
}

/**
 * Resolve the persistent queue/presentation <video id="preview">, including
 * when the operator has switched to another tab and the element lives in the
 * preview stash. Queue auto-advance must keep working in that state (GNOME HIG:
 * an ongoing presentation is not cancelled by changing views).
 */
function resolveQueuePresentationVideo() {
  if (video?.isConnected) return video;
  const stashed = document
    .getElementById(PREVIEW_STASH_ID)
    ?.querySelector("video#preview");
  if (stashed) {
    video = stashed;
    return video;
  }
  const inDom = document.getElementById("preview");
  if (inDom) {
    video = inDom;
    return video;
  }
  return null;
}

async function loadQueueItemIntoControlWindow(item, opts) {
  resolveQueuePresentationVideo();
  const localVideo = video;
  const preservePreviewSeek = !opts || opts.preservePreviewSeek !== false;
  const cueOnly = opts?.cueOnly === true;
  const loadToken = opts?.previewLoadToken;
  const isImgFile = isImg(item.path);

  let resumeAt = null;
  if (
    typeof opts?.startTime === "number" &&
    Number.isFinite(opts.startTime) &&
    opts.startTime >= 0
  ) {
    resumeAt = opts.startTime;
  }
  // For audio-only items we never resume the preview <video>'s scrub position
  // when transitioning to live playback: liveAudio handles the audio output,
  // and seeking the preview <video> near the end of an audio file leaves the
  // preview element in an "almost done" state that downstream code can
  // misread as a playback position. The explicit cue start time on the queue
  // entry (set via "Cue from Current Position") remains the source of truth.
  const itemIsAudio = !isImgFile && isQueueItemAudio(item);
  if (preservePreviewSeek && !isImgFile && !itemIsAudio && localVideo) {
    const sameClip = previewShowsSameClipAsPath(item.path);
    if (sameClip && Number.isFinite(localVideo.currentTime) && localVideo.currentTime > 0) {
      resumeAt = localVideo.currentTime;
    } else if (
      sameClip &&
      typeof opts?.previewSeekTime === "number" &&
      Number.isFinite(opts.previewSeekTime) &&
      opts.previewSeekTime > 0
    ) {
      resumeAt = opts.previewSeekTime;
    }
  }

  mediaFile = item.path;
  mediaPlayerInputState.filePaths = [item.path];
  updateQueueFileLabel(item.name);

  handleMediaPlayback(isImgFile);
  handleImageDisplay(isImgFile, document.querySelector("img"));

  if (!isImgFile && localVideo) {
    localVideo.load();
    const previousAudioOnlyFile = audioOnlyFile;
    const previousPlayingMediaAudioOnly = playingMediaAudioOnly;
    await waitForMetadata(localVideo);
    if (typeof loadToken === "number" && !isCurrentPreviewLoad(loadToken)) {
      return;
    }
    if (cueOnly) {
      audioOnlyFile = previousAudioOnlyFile;
      playingMediaAudioOnly = previousPlayingMediaAudioOnly;
    }
    if (resumeAt !== null && resumeAt >= 0) {
      const d = localVideo.duration;
      const safe =
        Number.isFinite(d) && d > 0
          ? Math.min(resumeAt, Math.max(0, d - 0.05))
          : resumeAt;
      try {
        await seekMedia(localVideo, safe);
        if (typeof loadToken === "number" && !isCurrentPreviewLoad(loadToken)) {
          return;
        }
        if (!cueOnly) {
          startTime = localVideo.currentTime;
          targetTime = startTime;
        }
      } catch (err) {
        console.error(err);
      }
    }
    const loadedAudioOnly = mediaElementLoadedAudioOnly(localVideo, item.path);
    if (!cueOnly) {
      audioOnlyFile = loadedAudioOnly;
    }
    if (loadedAudioOnly && !cueOnly) {
      document
        .getElementById("customControls")
        ?.style.setProperty("visibility", "");
    }
  } else if (!cueOnly) {
    audioOnlyFile = false;
    playingMediaAudioOnly = false;
  }
}

async function playCurrentQueueItem(opts) {
  resolveQueuePresentationVideo();
  const localVideo = video;
  mediaPlaybackEndedPending = false;
  if (localVideo) {
    // Queue items should advance; keep local preview loop disabled so its state
    // matches the projection window behaviour.
    localVideo.loop = false;
  }
  itc = performance.now() * 0.001;
  const item = mediaQueue[currentQueueIndex];
  if (!item) {
    isQueuePlaying = false;
    currentQueueIndex = -1;
    renderQueue();
    return;
  }

  await loadQueueItemIntoControlWindow(item, opts);
  renderQueue();

  isPlaying = true;
  updateDynUI();

  const iM = isImg(mediaFile);
  if (iM) {
    await createMediaWindow();
    if (localVideo) {
      localVideo.currentTime = 0;
      if (!localVideo.paused) {
        localVideo.removeAttribute("src");
        localVideo.load();
      }
    }
    return;
  }

  // Audio-only items (detected via metadata or by file extension) play
  // locally in the preview <video>. If a previous queue item left a media
  // window open, tear it down first so we don't hold a stale surface.
  const isAudioItem = audioOnlyFile || isQueueItemAudio(item);
  if (isAudioItem) {
    if (isActiveMediaWindow()) {
      await closeActiveMediaWindowNow();
    }
    await playAudioOnlyLocally();
    return;
  }

  await createMediaWindow();
}

async function advanceQueueAfterMediaWindowClosed() {
  if (isAdvancingQueue) return;
  isAdvancingQueue = true;
  try {
    isPlaying = false;
    updateDynUI();
    isActiveMediaWindowCache = false;

    const cue = currentPreviewCue();
    if (cue) {
      currentQueueIndex = cue.index;
      renderQueue();
      await new Promise((r) => setTimeout(r, 100));
      isPlaying = true;
      updateDynUI();
      await playCurrentQueueItem({
        preservePreviewSeek: false,
        startTime: cue.startTime,
      });
      clearCueAfterTake(cue.index);
      return;
    }

    currentQueueIndex++;
    if (currentQueueIndex < mediaQueue.length) {
      const item = mediaQueue[currentQueueIndex];
      renderQueue();
      await new Promise((r) => setTimeout(r, 100));
      isPlaying = true;
      updateDynUI();
      await playCurrentQueueItem({
        preservePreviewSeek: false,
        startTime:
          Number.isFinite(item?.cueStartTime) && item.cueStartTime > 0
            ? item.cueStartTime
            : 0,
      });
      return;
    }

    isQueuePlaying = false;
    currentQueueIndex = -1;
    renderQueue();

    if (mediaQueue.length > 0) {
      mediaFile = mediaQueue[0].path;
      mediaPlayerInputState.filePaths = [mediaFile];
      const head = mediaQueue[0];
      updateQueueFileLabel(head.name);
    }

    const isImgFile = isImg(mediaFile);
    handleMediaPlayback(isImgFile);
    handleImageDisplay(isImgFile, document.querySelector("img"));
    resetVideoState();
    updatePlayButtonOnMediaWindow();
    masterPauseState = false;
    removeFilenameFromTitlebar();
    textNode.data = "";
  } finally {
    isAdvancingQueue = false;
  }
}

/**
 * When a video finishes playing and the next queue item is also a video or
 * image, send a slipstream command to keep the media window alive and load the
 * new file directly rather than tearing down and recreating the window.
 * Returns true if slipstream was dispatched, false if normal close should proceed.
 */
async function slipstreamQueueItemAtIndex(index, opts = {}) {
  if (queueSlipstreamTransitionInProgress) return false;
  if (!isQueuePlaying) return false;
  if (!isActiveMediaWindow()) return false;
  if (index < 0 || index >= mediaQueue.length) return false;

  queueSlipstreamTransitionInProgress = true;
  try {
    const nextItem = mediaQueue[index];
    const nextType = nextItem.type || classifyQueueMediaType(nextItem.path);
    const isImgFile = isImg(nextItem.path);

    // Load the target into the preview before deciding. Extension checks catch
    // obvious audio files, but metadata is authoritative for "audio-only"
    // containers that look like regular media files until loaded.
    const requestedStart =
      typeof opts.startTime === "number" && Number.isFinite(opts.startTime)
        ? opts.startTime
        : Number.isFinite(nextItem.cueStartTime) && nextItem.cueStartTime > 0
          ? nextItem.cueStartTime
          : 0;
    await loadQueueItemIntoControlWindow(nextItem, {
      preservePreviewSeek: false,
      startTime: requestedStart,
    });
    resolveQueuePresentationVideo();

    // Audio must play in the local preview — destroy the media window as usual.
    if (!isImgFile && (nextType === "audio" || audioOnlyFile)) {
      pendingQueueSwitchIndex = index;
      pendingQueueSwitchStartTime = requestedStart;
      mediaPlaybackEndedPending = false;
      await closeActiveMediaWindowNow();
      return true;
    }

    const slipstreamData = {
      mediaFile: nextItem.path,
      isImg: isImgFile,
      loopFile: false,
      startVolume: video ? video.volume : 1,
      startTime: requestedStart,
    };

    const slipstreamSuccess = await invoke("slipstream-media-window", slipstreamData);
    resolveQueuePresentationVideo();
    if (!slipstreamSuccess) return false;

    // Window stays alive — advance queue state without the normal close/reopen cycle.
    mediaPlaybackEndedPending = false;
    currentQueueIndex = index;
    isActiveMediaWindowCache = true;
    isPlaying = true;
    lastUpdateTime = 0;
    localTimeStampUpdateIsRunning = false;
    textNode.data = "";
    // endLocalMedia (which runs from the preview's "ended" event right before
    // this) marks fileEnded so the next pause is treated as a natural stop.
    // Slipstream is not a stop — clear the flag before the new src is loaded.
    fileEnded = false;
    audioOnlyFile = false;
    playingMediaAudioOnly = false;
    updateDynUI();
    syncPreviewAudioTrackState();
    renderQueue();
    if (opts.clearCue !== false) {
      clearCueAfterTake(index);
    }

    // Mirror the media window: start the local preview so the operator sees
    // what's projecting. In the non-slipstream path createMediaWindow's
    // "media-window autoplay" call does this; we must do it ourselves here.
    if (video && !isImgFile) {
      await playVideoSafely(video, "slipstream preview play");
    }

    return true;
  } finally {
    queueSlipstreamTransitionInProgress = false;
  }
}

async function trySlipstreamNextQueueItem() {
  const cue = currentPreviewCue();
  if (cue) {
    return slipstreamQueueItemAtIndex(cue.index, {
      startTime: cue.startTime,
      clearCue: true,
    });
  }
  if (!isQueueAutoAdvanceEnabled()) return false;
  const nextIndex = currentQueueIndex + 1;
  const nextItem = mediaQueue[nextIndex];
  return slipstreamQueueItemAtIndex(nextIndex, {
    startTime:
      Number.isFinite(nextItem?.cueStartTime) && nextItem.cueStartTime > 0
        ? nextItem.cueStartTime
        : 0,
  });
}

class PIDController {
  constructor(video) {
    this.video = video;

    this.adaptiveCoefficients = {
      kP: {
        value: 0.5,
        minValue: 0.2,
        maxValue: 0.8,
        adjustmentRate: 0.005,
      },
      kI: {
        value: 0.05,
        minValue: 0.01,
        maxValue: 0.15,
        adjustmentRate: 0.0025,
      },
      kD: {
        value: 0.15,
        minValue: 0.08,
        maxValue: 0.25,
        adjustmentRate: 0.005,
      },
    };

    this.patterns = {
      STABLE: "stable",
      OSCILLATING: "oscillating",
      LAGGING: "lagging",
      SYSTEM_STRESS: "systemStress",
    };

    this.performancePatterns = {
      [this.patterns.STABLE]: {
        maxRate: 1.1,
        threshold: 0.033,
      },
      [this.patterns.OSCILLATING]: {
        maxRate: 1.05,
        threshold: 0.05,
      },
      [this.patterns.LAGGING]: {
        maxRate: 1.2,
        threshold: 0.066,
      },
      [this.patterns.SYSTEM_STRESS]: {
        maxRate: 1.05,
        threshold: 0.1,
      },
    };

    this.systemLag = 0;
    this.overshoots = 0;
    this.avgResponseTime = 0;
    this.currentPattern = this.patterns.STABLE;

    this.lastWallTime = null;
    this.maxTimeGap = 1000;

    this.synchronizationThreshold = 0.005;
    this.maxIntegralError = 0.5;
    this.fastSyncThreshold = 1;
    this.maxFastSyncRate = 2;

    this.maxHistoryLength = 32;
    this.isFirstAdjustment = true;

    // Pre-allocate arrays for history
    this.timeArray = new Float64Array(this.maxHistoryLength);
    this.diffArray = new Float64Array(this.maxHistoryLength);
    this.responseArray = new Float64Array(this.maxHistoryLength);
    this.historyIndex = 0;
    this.historySize = 0;
    this.MASK = 31;
    this.TREND_MASK = 15;
    this._trendBuffer = new Float64Array(16);
    this._trendPos = 0;

    this._rollingSum = 0;
    this._rollingSquareSum = 0;
    this._rollingTrend = 0;
  }

  updateSystemMetrics(timeDifference, timestamp) {
    const oldDiff = this.diffArray[this.historyIndex] || 0;

    this.timeArray[this.historyIndex] = timestamp;
    this.diffArray[this.historyIndex] = timeDifference;
    this.responseArray[this.historyIndex] =
      this.historySize > 0
        ? timestamp - this.timeArray[(this.historyIndex - 1) & this.MASK]
        : 0;

    this.historyIndex = (this.historyIndex + 1) & this.MASK;
    if (this.historySize < this.maxHistoryLength) this.historySize++;

    // Rolling updates
    if (this.historySize >= 10) {
      const pos = this._trendPos;
      const prevIndex = (pos - 1 + 16) & this.TREND_MASK;
      const prev = this._trendBuffer[prevIndex] || 0;
      const replaced = this._trendBuffer[pos];
      this._trendBuffer[pos] = timeDifference;
      this._trendPos = (pos + 1) & this.TREND_MASK;

      // Update rolling sums
      this._rollingSum += timeDifference - oldDiff;
      this._rollingSquareSum +=
        timeDifference * timeDifference - oldDiff * oldDiff;
      this._rollingTrend += timeDifference - prev - (replaced - prev);

      const mean = this._rollingSum / 10;
      const variance = this._rollingSquareSum / 10 - mean * mean;
      const trend = this._rollingTrend / 9;

      this.currentPattern =
        variance > 0.1 && this.overshoots > 3
          ? this.patterns.OSCILLATING
          : trend > 0.05 || this.avgResponseTime > 0.15
            ? this.patterns.LAGGING
            : this.systemLag > 100 || this.avgResponseTime > 0.2
              ? this.patterns.SYSTEM_STRESS
              : this.patterns.STABLE;
    }
  }

  detectPattern() {
    if (this.historySize < 10) return;

    let variance = 0;
    let trend = 0;
    let sumOfDifferences = 0;

    const startIdx =
      (this.historyIndex - 10 + this.maxHistoryLength) % this.maxHistoryLength;
    let previousTimeDiff =
      startIdx > 0
        ? this.diffArray[
            (startIdx - 1 + this.maxHistoryLength) % this.maxHistoryLength
          ]
        : 0;

    for (let i = 0; i < 10; i++) {
      const currentTimeDiff =
        this.diffArray[(startIdx + i) % this.maxHistoryLength];
      sumOfDifferences += currentTimeDiff;
      variance += currentTimeDiff * currentTimeDiff;

      if (i > 0) {
        trend += currentTimeDiff - previousTimeDiff;
      }
      previousTimeDiff = currentTimeDiff;
    }

    const mean = sumOfDifferences / 10;
    variance = variance / 10 - mean * mean;
    trend = trend / 9;

    if (variance > 0.1 && this.overshoots > 3) {
      this.currentPattern = this.patterns.OSCILLATING;
    } else if (trend > 0.05 || this.avgResponseTime > 0.15) {
      this.currentPattern = this.patterns.LAGGING;
    } else if (this.systemLag > 100 || this.avgResponseTime > 0.2) {
      this.currentPattern = this.patterns.SYSTEM_STRESS;
    } else {
      this.currentPattern = this.patterns.STABLE;
    }
  }

  adjustPIDCoefficients() {
    const { STABLE, OSCILLATING, LAGGING, SYSTEM_STRESS } = this.patterns;

    switch (this.currentPattern) {
      case STABLE:
        this.adaptiveCoefficients.kP.value =
          this.adaptiveCoefficients.kP.value +
            this.adaptiveCoefficients.kP.adjustmentRate >
          this.adaptiveCoefficients.kP.maxValue
            ? this.adaptiveCoefficients.kP.maxValue
            : this.adaptiveCoefficients.kP.value +
              this.adaptiveCoefficients.kP.adjustmentRate;
        this.adaptiveCoefficients.kI.value =
          this.adaptiveCoefficients.kI.value +
            this.adaptiveCoefficients.kI.adjustmentRate >
          this.adaptiveCoefficients.kI.maxValue
            ? this.adaptiveCoefficients.kI.maxValue
            : this.adaptiveCoefficients.kI.value +
              this.adaptiveCoefficients.kI.adjustmentRate;
        this.adaptiveCoefficients.kD.value =
          this.adaptiveCoefficients.kD.value +
            this.adaptiveCoefficients.kD.adjustmentRate >
          this.adaptiveCoefficients.kD.maxValue
            ? this.adaptiveCoefficients.kD.maxValue
            : this.adaptiveCoefficients.kD.value +
              this.adaptiveCoefficients.kD.adjustmentRate;
        break;
      case OSCILLATING:
        this.adaptiveCoefficients.kP.value =
          this.adaptiveCoefficients.kP.value -
            this.adaptiveCoefficients.kP.adjustmentRate <
          this.adaptiveCoefficients.kP.minValue
            ? this.adaptiveCoefficients.kP.minValue
            : this.adaptiveCoefficients.kP.value -
              this.adaptiveCoefficients.kP.adjustmentRate;
        this.adaptiveCoefficients.kI.value =
          this.adaptiveCoefficients.kI.value -
            this.adaptiveCoefficients.kI.adjustmentRate <
          this.adaptiveCoefficients.kI.minValue
            ? this.adaptiveCoefficients.kI.minValue
            : this.adaptiveCoefficients.kI.value -
              this.adaptiveCoefficients.kI.adjustmentRate;
        this.adaptiveCoefficients.kD.value =
          this.adaptiveCoefficients.kD.value +
            this.adaptiveCoefficients.kD.adjustmentRate >
          this.adaptiveCoefficients.kD.maxValue
            ? this.adaptiveCoefficients.kD.maxValue
            : this.adaptiveCoefficients.kD.value +
              this.adaptiveCoefficients.kD.adjustmentRate;
        break;
      case LAGGING:
        this.adaptiveCoefficients.kP.value =
          this.adaptiveCoefficients.kP.value +
            this.adaptiveCoefficients.kP.adjustmentRate >
          this.adaptiveCoefficients.kP.maxValue
            ? this.adaptiveCoefficients.kP.maxValue
            : this.adaptiveCoefficients.kP.value +
              this.adaptiveCoefficients.kP.adjustmentRate;
        this.adaptiveCoefficients.kI.value =
          this.adaptiveCoefficients.kI.value +
            this.adaptiveCoefficients.kI.adjustmentRate >
          this.adaptiveCoefficients.kI.maxValue
            ? this.adaptiveCoefficients.kI.maxValue
            : this.adaptiveCoefficients.kI.value +
              this.adaptiveCoefficients.kI.adjustmentRate;
        this.adaptiveCoefficients.kD.value =
          this.adaptiveCoefficients.kD.value -
            this.adaptiveCoefficients.kD.adjustmentRate <
          this.adaptiveCoefficients.kD.minValue
            ? this.adaptiveCoefficients.kD.minValue
            : this.adaptiveCoefficients.kD.value -
              this.adaptiveCoefficients.kD.adjustmentRate;
        break;
      case SYSTEM_STRESS:
        this.adaptiveCoefficients.kP.value =
          this.adaptiveCoefficients.kP.value -
            this.adaptiveCoefficients.kP.adjustmentRate <
          this.adaptiveCoefficients.kP.minValue
            ? this.adaptiveCoefficients.kP.minValue
            : this.adaptiveCoefficients.kP.value -
              this.adaptiveCoefficients.kP.adjustmentRate;
        this.adaptiveCoefficients.kI.value =
          this.adaptiveCoefficients.kI.value -
            this.adaptiveCoefficients.kI.adjustmentRate <
          this.adaptiveCoefficients.kI.minValue
            ? this.adaptiveCoefficients.kI.minValue
            : this.adaptiveCoefficients.kI.value -
              this.adaptiveCoefficients.kI.adjustmentRate;
        this.adaptiveCoefficients.kD.value =
          this.adaptiveCoefficients.kD.value -
            this.adaptiveCoefficients.kD.adjustmentRate <
          this.adaptiveCoefficients.kD.minValue
            ? this.adaptiveCoefficients.kD.minValue
            : this.adaptiveCoefficients.kD.value -
              this.adaptiveCoefficients.kD.adjustmentRate;
        break;
    }
  }

  calculateHistoricalAdjustment(timeDifference, deltaTime) {
    if (
      timeDifference !== timeDifference ||
      deltaTime !== deltaTime ||
      deltaTime <= 0
    ) {
      return 0;
    }
    this.integral += timeDifference * deltaTime;
    this.integral =
      this.integral < -this.maxIntegralError
        ? -this.maxIntegralError
        : this.integral > this.maxIntegralError
          ? this.maxIntegralError
          : this.integral;

    const derivative = (timeDifference - this.lastTimeDifference) / deltaTime;
    this.lastTimeDifference = timeDifference;

    return (
      this.adaptiveCoefficients.kP.value * timeDifference +
      this.adaptiveCoefficients.kI.value * this.integral +
      this.adaptiveCoefficients.kD.value * derivative
    );
  }

  adjustPlaybackRate(targetTime) {
    const now = performance.now();
    const wallNow = Date.now();
    if (!this.video || this.video.paused || this.video.seeking) {
      return;
    }

    if (this.isFirstAdjustment || this.lastWallTime === null) {
      this.lastWallTime = wallNow;
      this.lastUpdateTime = now;
      this.isFirstAdjustment = false;
      const timeDifference = targetTime - this.video.currentTime;
      this.updateSystemMetrics(timeDifference, wallNow);
      return timeDifference;
    }

    const wallTimeDelta = wallNow - this.lastWallTime;

    if (wallTimeDelta > this.maxTimeGap) {
      beginPidSeekSuppression();
      this.video.currentTime = targetTime;
      this.lastWallTime = wallNow;
      this.isFirstAdjustment = false;
      const timeDifference = targetTime - this.video.currentTime;
      this.updateSystemMetrics(timeDifference, wallNow);
      return timeDifference;
    }

    const deltaTime = (now - this.lastUpdateTime) / 1000;
    this.lastUpdateTime = now;
    this.lastWallTime = wallNow;

    const timeDifference = targetTime - this.video.currentTime;
    const timeDifferenceAbs =
      timeDifference < 0 ? -timeDifference : timeDifference;

    this.updateSystemMetrics(timeDifference, wallNow);

    const finalAdjustment = this.calculateHistoricalAdjustment(
      timeDifference,
      deltaTime,
    );

    if (timeDifferenceAbs > this.fastSyncThreshold) {
      let playbackRate;
      if (timeDifference > 0) {
        const calcRate = 1 + timeDifferenceAbs / deltaTime;
        playbackRate =
          calcRate > this.maxFastSyncRate ? this.maxFastSyncRate : calcRate;
      } else {
        const calcRate = 1 - timeDifferenceAbs / deltaTime;
        const minRate = 1 / this.maxFastSyncRate;
        playbackRate = calcRate < minRate ? minRate : calcRate;
      }
      this.video.playbackRate = playbackRate;
      return timeDifference;
    }

    const maxRate = this.performancePatterns[this.currentPattern].maxRate;
    const minRate = 2 - maxRate;
    let playbackRate = 1.0 + finalAdjustment;

    playbackRate =
      playbackRate < minRate
        ? minRate
        : playbackRate > maxRate
          ? maxRate
          : playbackRate;

    if (timeDifferenceAbs <= this.synchronizationThreshold) {
      playbackRate = 1.0;
      this.integral = 0;
    }

    if (playbackRate >= 0 || playbackRate <= 0) {
      this.video.playbackRate = playbackRate;
    }

    return timeDifference;
  }

  reset() {
    if (!isActiveMediaWindow()) {
      return;
    }
    this.lastError = 0;
    this.integral = 0;
    this.lastTimeDifference = 0;
    this.lastUpdateTime = performance.now();
    this.isFirstAdjustment = true;
    this.lastWallTime = null;

    this.historyIndex = 0;
    this.historySize = 0;

    this.systemLag = 0;
    this.overshoots = 0;
    this.avgResponseTime = 0;
    this.currentPattern = this.patterns.STABLE;

    this.adaptiveCoefficients = {
      kP: {
        value: 0.6,
        minValue: 0.3,
        maxValue: 0.9,
        adjustmentRate: 0.01,
      },
      kI: {
        value: 0.08,
        minValue: 0.02,
        maxValue: 0.2,
        adjustmentRate: 0.005,
      },
      kD: {
        value: 0.12,
        minValue: 0.05,
        maxValue: 0.2,
        adjustmentRate: 0.01,
      },
    };
  }
}
let pidController;

const NUM_BUFFER = new Int32Array(4);
const REM_BUFFER = new Int32Array(1);
let usePad0, usePad1, usePad2, mask0, mask1, mask2, idx0, idx1, idx2;

function getHostnameOrBasename(input) {
  // Check if input contains a protocol-like prefix (http://, https://, ftp://, etc.)
  const protocolMatch = input.match(/^(\w+):\/\//);

  if (protocolMatch) {
    // If protocol exists, extract hostname
    const protocolEnd = protocolMatch[0].length;
    const remainingPart = input.slice(protocolEnd);
    const firstSlashIndex = remainingPart.indexOf("/");

    // Return full domain or first part before path
    return firstSlashIndex === -1
      ? remainingPart
      : remainingPart.slice(0, firstSlashIndex);
  } else {
    // If not a URL, extract basename
    // Handle both forward and backslashes
    const lastForwardSlash = input.lastIndexOf("/");
    const lastBackSlash = input.lastIndexOf("\\");

    // Choose the last separator
    const lastSeparator = Math.max(lastForwardSlash, lastBackSlash);

    // If no separator found, return the entire input
    // Otherwise, return the part after the last separator
    return lastSeparator === -1 ? input : input.slice(lastSeparator + 1);
  }
}

function isActiveMediaWindow() {
  return isActiveMediaWindowCache;
}

function syncPreviewAudioTrackState() {
  if (!video?.audioTracks || typeof video.audioTracks.length !== "number") {
    return;
  }

  const previewShouldBeAudible =
    !shouldSuppressPreviewForwarding() &&
    !isLocalAppWindowPresentationActive() &&
    !isActiveMediaWindow();
  for (let i = 0; i < video.audioTracks.length; i += 1) {
    video.audioTracks[i].enabled = previewShouldBeAudible;
  }
}

function isAudioOnlyQueuePresentationActive() {
  if (isActiveMediaWindow()) return false;
  const currentItem =
    currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
      ? mediaQueue[currentQueueIndex]
      : null;
  const currentItemIsAudio =
    !!currentItem &&
    (currentItem.type === "audio" ||
      classifyQueueMediaType(currentItem.path) === "audio");

  const localAudioOnlyFile =
    playingMediaAudioOnly || liveAudioQueueIndex >= 0 || audioOnlyFile || currentItemIsAudio;
  const localAudioPlaying =
    isPlaying ||
    playingMediaAudioOnly ||
    liveAudio?.paused === false ||
    (audioOnlyFile && video?.paused === false);

  return localAudioOnlyFile && localAudioPlaying;
}

function isLocalAppWindowPresentationActive() {
  if (currentMode !== MEDIAPLAYER || isActiveMediaWindow()) return false;
  const localPlaying = Boolean(
    isPlaying ||
      playingMediaAudioOnly ||
      liveAudio?.paused === false ||
      (audioOnlyFile && video?.paused === false),
  );
  if (!localPlaying) return false;

  const currentItem =
    currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
      ? mediaQueue[currentQueueIndex]
      : null;
  const sourcePath = mediaFile || video?.src || currentItem?.path || "";
  return Boolean(
    playingMediaAudioOnly ||
      liveAudioQueueIndex >= 0 ||
      audioOnlyFile ||
      isQueueItemAudio(currentItem) ||
      mediaElementLoadedAudioOnly(video, sourcePath),
  );
}

async function toggleLocalAudioOnlyPlaybackFromControls() {
  if (!video || isActiveMediaWindow()) return false;
  if (!audioOnlyFile && !playingMediaAudioOnly && !isAudioOnlyQueuePresentationActive()) {
    return false;
  }

  // Decide direction based on actual presentation state, not video.paused.
  // liveAudio is the canonical live element; video is preview-only, so it may
  // be paused even while a live audio presentation is active.
  const presentationIsActive =
    isPlaying || liveAudio?.paused === false || playingMediaAudioOnly;

  if (!presentationIsActive) {
    // Nothing is actually presenting yet. Return false so playMedia's normal
    // queue path (playCurrentQueueItem → playAudioOnlyLocally) handles the
    // start. That guarantees audio always comes from liveAudio, never from the
    // preview <video> element.
    return false;
  }

  // STOP path – tear down any live audio presentation and reset state.
  audioOnlyFile = true;
  playingMediaAudioOnly = true;
  isActiveMediaWindowCache = false;
  syncPreviewAudioTrackState();

  stopLiveAudioPresentation();
  if (!video.paused) {
    await video.pause();
  }
  isPlaying = false;
  isQueuePlaying = false;
  currentQueueIndex = -1;
  renderQueue();
  send("localMediaState", 0, "stop");
  removeFilenameFromTitlebar();
  localTimeStampUpdateIsRunning = false;
  updateDynUI();

  return true;
}

async function closeActiveMediaWindowNow() {
  if (!isActiveMediaWindow()) return false;
  isActiveMediaWindowCache = false;
  syncPreviewAudioTrackState();
  try {
    return await invoke("close-media-window-now");
  } catch (err) {
    console.error("Failed to close media window via invoke:", err);
    send("close-media-window", 0);
    return false;
  }
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) {
    return "0:00";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function timelineSync() {
  if ((video && video.src === "") || currentMode !== MEDIAPLAYER) return;
  playPauseBtn = document.getElementById("playPauseBtn");
  playPauseIcon = document.getElementById("playPauseIcon");
  // Use liveAudio as the reference when it is the active live element.
  const syncEl =
    liveAudioQueueIndex >= 0 && liveAudio?.src && liveAudio.src !== ""
      ? liveAudio
      : video;
  if (syncEl.duration && isFinite(syncEl.duration)) {
    timeline.value = (syncEl.currentTime / syncEl.duration) * 100;
  }
  if (syncEl.paused) {
    playPauseIcon.innerHTML = `<path d="M8 5v14l11-7z"/>`;
  } else {
    playPauseIcon.innerHTML = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
  }
}

// Called whenever we transition into "mirror mode" (video.src === liveAudio.src)
// so that the custom controls immediately reflect liveAudio's current state rather
// than waiting for the next timeupdate event (which does not update the duration
// display or the play/pause icon).
function refreshLiveAudioControls() {
  if (!liveAudio || liveAudioQueueIndex < 0 || !liveAudio.src) return;
  if (!timeline || !playPauseIcon) return;
  const d = liveAudio.duration;
  const c = liveAudio.currentTime;
  if (isFinite(d) && d > 0) {
    const fmtTime = (sec) => {
      if (!isFinite(sec) || sec < 0) return "0:00";
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${m}:${s.toString().padStart(2, "0")}`;
    };
    if (durationTimeDisplay) durationTimeDisplay.textContent = fmtTime(d);
    if (currentTimeDisplay) currentTimeDisplay.textContent = fmtTime(c);
    timeline.min = 0;
    timeline.max = 100;
    timeline.value = (c / d) * 100;
    const overlay = document.getElementById("customControls");
    if (overlay) {
      overlay.style.display = "";
      overlay.style.visibility = "visible";
    }
  }
  playPauseIcon.innerHTML = liveAudio.paused
    ? `<path d="M8 5v14l11-7z"/>`
    : `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
}

/**
 * Custom controls tie the scrubber / glyph to cue vs mirror vs liveAudio
 * ({@link getPreviewControlMediaElement}, same ranking as setupCustomMediaControls).
 * Routing can change without a play/pause on the new element (e.g. mirror kept
 * playing under a cue), so callers that dismiss the cue must refresh the glyph.
 */
function syncPlayPauseIconToControlMedia() {
  if (currentMode !== MEDIAPLAYER) return;
  const glyph = document.getElementById("playPauseIcon");
  if (!glyph) return;

  resolveQueuePresentationVideo();
  let mediaEl = getPreviewControlMediaElement();
  if (
    mediaEl === video &&
    liveAudioQueueIndex >= 0 &&
    liveAudio &&
    liveAudio.src &&
    liveAudio.src !== ""
  ) {
    mediaEl = liveAudio;
  }
  if (!mediaEl?.src || mediaEl.src === "") return;

  glyph.innerHTML = mediaEl.paused
    ? `<path d="M8 5v14l11-7z"/>`
    : `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
}

function getFocusableControls() {
  if (!focusableControls) {
    focusableControls = controlsOverlay.querySelectorAll(
      'button, input[type="range"]',
    );
  }
  return focusableControls;
}

function disableTabFocus() {
  getFocusableControls().forEach((el) => {
    el.setAttribute("tabindex", "-1");
  });
}

function enableTabFocus() {
  getFocusableControls().forEach((el) => {
    el.setAttribute("tabindex", "0");
  });
}

function modeChangeFixups(error) {
  // We should not get here under normal circumstances
  console.error("Error playing media after mode change fixup:", error);
  if (encodeURI(mediaFile) !== getHostnameOrBasename(video.src)) {
    video.src = encodeURI(mediaFile);
    video
      .play()
      .catch((e) =>
        console.error("Error playing media after mode change fixup:", e),
      );
  }
}

function preModeChangeFixups() {
  if (
    !isActiveMediaWindow() &&
    encodeURI(mediaFile) !== getHostnameOrBasename(video.src) &&
    !(playingMediaAudioOnly || video.paused)
  ) {
    video.src = encodeURI(mediaFile);
  }
}

function setupCustomMediaControls() {
  playPauseBtn = document.getElementById("playPauseBtn");
  playPauseIcon = document.getElementById("playPauseIcon");
  timeline = document.getElementById("timeline");
  currentTimeDisplay = document.getElementById("currentTime");
  durationTimeDisplay = document.getElementById("durationTime");
  repeatButton = document.getElementById("mediaWindowRepeatButton");
  video = document.getElementById("preview");
  // The dedicated cue overlay lives next to #preview in the wrapper. It is
  // recreated whenever the media form is rebuilt, so its control-side
  // listeners are registered alongside the main element's listeners below
  // (under the same AbortController) and torn down on the next rebuild.
  const previewCue = ensurePreviewCueVideoElement();
  videoWrapper = document.querySelector(".video-wrapper");
  controlsOverlay = document.querySelector(".controls-overlay");
  const overlay = document.getElementById("customControls");
  const clickTarget = videoWrapper || video;

  if (overlay) {
    overlay.style.display = "none";
  }

  if (!video || !timeline || !playPauseBtn) {
    console.error("Missing custom media controls");
    return;
  }

  // The <video id="preview"> persists across tab rebuilds (see preview stash
  // helpers), so listeners attached here would accumulate on every Media-tab
  // re-entry. Abort the previous batch and use a fresh AbortController so
  // each rebuild has exactly one set of control listeners on the video and
  // on the document-level mouseup/touchend fall-through handlers.
  if (setupCustomMediaControls.controller) {
    try {
      if (setupCustomMediaControls.mouseLeaveFocusTimer != null) {
        window.clearTimeout(setupCustomMediaControls.mouseLeaveFocusTimer);
        setupCustomMediaControls.mouseLeaveFocusTimer = null;
      }
      setupCustomMediaControls.controller.abort();
    } catch {
      /* already aborted */
    }
  }
  const controller = new AbortController();
  setupCustomMediaControls.controller = controller;
  const sig = { signal: controller.signal };
  ensurePreviewAudioElement();
  // Ensure liveAudio element exists so we can attach control listeners to it
  // before any audio-only playback begins.
  const la = ensureLiveAudioElement();

  let isDragging = false; // Track drag interaction
  let wasPlayingBeforeDrag = false;
  let timelineSeekToken = 0;

  // --- Format time utility ---
  const fmt = (sec) => {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };
  // Routes the custom controls (scrubber, play/pause, time display) to the
  // right media element for the current operator intent:
  //
  //   1. Cue overlays first — getPreviewControlMediaElement returns the
  //      dedicated cue element (previewAudio or previewCueVideo) whenever
  //      a cue is loaded. The operator is intentionally scrubbing a
  //      non-live item, so the controls must drive that scrubber instead
  //      of the live mirror.
  //   2. liveAudio mirror — when an audio-only item is the live output
  //      and no cue is active, the visible <video id="preview"> has no
  //      meaningful timeline of its own; route to liveAudio so the
  //      scrubber tracks the real audio source.
  //   3. The main #preview element, for everything else.
  const cueMediaEl = () => {
    const el = getPreviewControlMediaElement();
    return el && el !== video ? el : null;
  };
  const currentControlMedia = () => {
    const cue = cueMediaEl();
    if (cue) return cue;
    if (liveAudioQueueIndex >= 0 && liveAudio?.src && liveAudio.src !== "") {
      return liveAudio;
    }
    return video;
  };
  const updateControlsForMetadata = (mediaEl) => {
    if (currentMode !== MEDIAPLAYER || mediaEl !== currentControlMedia()) {
      return;
    }
    timeline.min = 0;
    timeline.max = 100;

    const isPlaying =
      !mediaEl.paused &&
      Number.isFinite(mediaEl.currentTime) &&
      mediaEl.currentTime > 0;
    const hasSeekableMedia = isFinite(mediaEl.duration) && mediaEl.duration > 0;

    timeline.value =
      isPlaying && hasSeekableMedia
        ? (mediaEl.currentTime / mediaEl.duration) * 100
        : 0;
    currentTimeDisplay.textContent = isPlaying
      ? fmt(mediaEl.currentTime)
      : "0:00";
    durationTimeDisplay.textContent = fmt(mediaEl.duration);

    playPauseIcon.innerHTML = mediaEl.paused
      ? `<path d="M8 5v14l11-7z"/>`
      : `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;

    if (overlay) {
      overlay.style.display = "";
      overlay.style.visibility = hasSeekableMedia ? "visible" : "hidden";
    }

    repeatButton.classList.toggle("active", video.loop);
  };
  const updateControlsForTime = (mediaEl) => {
    if (mediaEl !== currentControlMedia()) return;
    if (!mediaEl.duration || timeline === null) return;
    if (currentTimeDisplay !== null) {
      currentTimeDisplay.textContent = fmt(mediaEl.currentTime);
    }

    if (!isDragging) {
      timeline.value = (mediaEl.currentTime / mediaEl.duration) * 100;
    }
  };

  if (videoWrapper && controlsOverlay) {
    // 1. Initial State: Controls are hidden, so remove them from the tab sequence.
    disableTabFocus();

    // 2. Event Handlers: Use mouseenter/mouseleave to control the tabindex.
    // These MUST use `signal` so tab switches (which call setup again) do not
    // stack duplicate handlers — without it, switching Media ↔ Streams every
    // few seconds leaks listeners and eventually makes the UI feel sluggish.
    videoWrapper.addEventListener(
      "mouseenter",
      () => {
        if (setupCustomMediaControls.mouseLeaveFocusTimer != null) {
          window.clearTimeout(setupCustomMediaControls.mouseLeaveFocusTimer);
          setupCustomMediaControls.mouseLeaveFocusTimer = null;
        }
        enableTabFocus();
      },
      sig,
    );

    videoWrapper.addEventListener(
      "mouseleave",
      () => {
        setupCustomMediaControls.mouseLeaveFocusTimer = window.setTimeout(() => {
          setupCustomMediaControls.mouseLeaveFocusTimer = null;
          disableTabFocus();
          closeVolumePopup();
        }, 300);
      },
      sig,
    );
  }

  // --- PLAY / PAUSE ---
  playPauseBtn.addEventListener(
    "click",
    async () => {
      const mediaEl = currentControlMedia();
      if (!mediaEl || mediaEl.src === "") return;

      if (mediaEl.paused) {
        // When an audio item is cued silently (previewAudio is the control
        // element) and a presentation is already live, pressing play should
        // take the cued audio live — the silent muted preview is otherwise
        // a no-op from the operator's perspective.
        if (
          mediaEl === previewAudio &&
          (isActiveMediaWindow() || isLocalAppWindowPresentationActive())
        ) {
          const cue = currentPreviewCue();
          if (cue) {
            void takeQueueItemLive(cue.index, cue.startTime);
            return;
          }
        }
        // When the current control element is the preview <video> with an
        // audio-only file and no live presentation is running, treat the play
        // button as the headerbar "Present" action. Route audio through
        // liveAudio (the dedicated live output element) rather than playing
        // the preview video directly — identical to clicking Present.
        if (
          mediaEl === video &&
          !isLocalAppWindowPresentationActive() &&
          (audioOnlyFile ||
            mediaElementLoadedAudioOnly(
              video,
              mediaFile || removeFileProtocol(decodeURI(video.src)),
            ))
        ) {
          void playMedia();
          return;
        }
        await playVideoSafely(mediaEl, "custom controls toggle");
      } else {
        await mediaEl.pause();
      }
    },
    sig,
  );

  video.addEventListener(
    "play",
    (event) => {
      if (event.target !== currentControlMedia()) return;
      if (event.target.src === "" || currentMode !== MEDIAPLAYER) return;
      playPauseIcon.innerHTML = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
    },
    sig,
  );
  previewAudio.addEventListener(
    "play",
    (event) => {
      if (event.target !== currentControlMedia()) return;
      if (event.target.src === "" || currentMode !== MEDIAPLAYER) return;
      playPauseIcon.innerHTML = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
    },
    sig,
  );
  la.addEventListener(
    "play",
    (event) => {
      if (event.target !== currentControlMedia()) return;
      if (event.target.src === "" || currentMode !== MEDIAPLAYER) return;
      playPauseIcon.innerHTML = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
      // Restart the countdown-timer RAF loop (normally triggered by playLocalMedia
      // on the video element, but liveAudio plays independently of video).
      localTimeStampUpdateIsRunning = false;
      updateTimestamp();
    },
    sig,
  );
  if (previewCue) {
    previewCue.addEventListener(
      "play",
      (event) => {
        if (event.target !== currentControlMedia()) return;
        if (event.target.src === "" || currentMode !== MEDIAPLAYER) return;
        playPauseIcon.innerHTML = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
      },
      sig,
    );
  }

  video.addEventListener(
    "pause",
    (event) => {
      if (event.target !== currentControlMedia()) return;
      // Play icon
      if (playPauseIcon === null) return;
      playPauseIcon.innerHTML = `<path d="M8 5v14l11-7z"/>`;
    },
    sig,
  );
  previewAudio.addEventListener(
    "pause",
    (event) => {
      if (event.target !== currentControlMedia()) return;
      if (playPauseIcon === null) return;
      playPauseIcon.innerHTML = `<path d="M8 5v14l11-7z"/>`;
    },
    sig,
  );
  la.addEventListener(
    "pause",
    (event) => {
      if (event.target !== currentControlMedia()) return;
      if (playPauseIcon === null) return;
      playPauseIcon.innerHTML = `<path d="M8 5v14l11-7z"/>`;
    },
    sig,
  );
  if (previewCue) {
    previewCue.addEventListener(
      "pause",
      (event) => {
        if (event.target !== currentControlMedia()) return;
        if (playPauseIcon === null) return;
        playPauseIcon.innerHTML = `<path d="M8 5v14l11-7z"/>`;
      },
      sig,
    );
  }

  video.addEventListener(
    "loadedmetadata",
    (event) => updateControlsForMetadata(event.target),
    sig,
  );
  ensurePreviewAudioElement().addEventListener(
    "loadedmetadata",
    (event) => updateControlsForMetadata(event.target),
    sig,
  );
  la.addEventListener(
    "loadedmetadata",
    (event) => updateControlsForMetadata(event.target),
    sig,
  );
  if (previewCue) {
    previewCue.addEventListener(
      "loadedmetadata",
      (event) => updateControlsForMetadata(event.target),
      sig,
    );
  }

  // --- DRAGGING THE TIMELINE (HYBRID LIVE SCRUBBING) ---
  timeline.addEventListener(
    "mousedown",
    () => {
      const mediaEl = currentControlMedia();
      if (!mediaEl?.duration) return;
      wasPlayingBeforeDrag = !mediaEl.paused;
      isDragging = true;
      // Pause playback for stable seeking
      mediaEl.pause();
    },
    sig,
  );
  timeline.addEventListener(
    "touchstart",
    () => {
      const mediaEl = currentControlMedia();
      if (!mediaEl?.duration) return;
      wasPlayingBeforeDrag = !mediaEl.paused;
      isDragging = true;
      // Pause playback for stable seeking
      mediaEl.pause();
    },
    { passive: true, signal: controller.signal },
  );

  // Seek immediately on 'input' for live frame updates
  timeline.addEventListener(
    "input",
    () => {
      const mediaEl = currentControlMedia();
      if (!mediaEl?.duration) return;
      const seekTime = (timeline.value / 100) * mediaEl.duration;
      const seekToken = ++timelineSeekToken;

      currentTimeDisplay.textContent = fmt(seekTime);
      void seekMedia(mediaEl, seekTime).then((actualTime) => {
        if (seekToken !== timelineSeekToken) return;
        currentTimeDisplay.textContent = fmt(actualTime);
        if (isPreparingSeparateCue()) {
          setCueStartTime(previewCueIndex, actualTime);
        }
      });
    },
    sig,
  );

  timeline.addEventListener(
    "change",
    () => {
      isDragging = false;

      if (wasPlayingBeforeDrag) {
        // Use .catch() for promise errors if browser auto-play is blocked (common with video.play())
        currentControlMedia()?.play().catch((e) => {
          if (isPlayInterruptedError(e)) return;
          modeChangeFixups(e);
        });
      }
    },
    sig,
  );

  document.addEventListener("mouseup", () => (isDragging = false), sig);
  document.addEventListener("touchend", () => (isDragging = false), sig);

  // --- TIMEUPDATE ---
  video.addEventListener(
    "timeupdate",
    (event) => updateControlsForTime(event.target),
    sig,
  );
  previewAudio.addEventListener(
    "timeupdate",
    (event) => updateControlsForTime(event.target),
    sig,
  );
  la.addEventListener(
    "timeupdate",
    (event) => updateControlsForTime(event.target),
    sig,
  );
  if (previewCue) {
    previewCue.addEventListener(
      "timeupdate",
      (event) => updateControlsForTime(event.target),
      sig,
    );
  }

  // --- LOOP / REPEAT ---
  repeatButton.addEventListener(
    "click",
    () => {
      video.loop = !video.loop;
      repeatButton.classList.toggle("active", video.loop);

      send("media-set-loop", video.loop);
    },
    sig,
  );

  // --- END OF VIDEO ---
  video.addEventListener(
    "ended",
    () => {
      if (video !== currentControlMedia()) return;
      if (!video.loop && currentMode === MEDIAPLAYER) {
        video.currentTime = 0;
        video.pause();
        timeline.value = 0;
        currentTimeDisplay.textContent = "0:00";
      }
    },
    sig,
  );
  previewAudio.addEventListener(
    "ended",
    () => {
      if (!isAudioPreviewCueActive() || currentMode !== MEDIAPLAYER) return;
      previewAudio.currentTime = 0;
      previewAudio.pause();
      timeline.value = 0;
      currentTimeDisplay.textContent = "0:00";
    },
    sig,
  );
  // liveAudio ended: scrubber reset is handled here; actual queue advance is
  // driven by endLiveAudioPresentation (attached permanently to the element).
  la.addEventListener(
    "ended",
    () => {
      if (la !== currentControlMedia() || currentMode !== MEDIAPLAYER) return;
      timeline.value = 0;
      currentTimeDisplay.textContent = "0:00";
    },
    sig,
  );
  if (previewCue) {
    previewCue.addEventListener(
      "ended",
      () => {
        if (previewCue !== currentControlMedia() || currentMode !== MEDIAPLAYER) return;
        previewCue.currentTime = 0;
        previewCue.pause();
        timeline.value = 0;
        currentTimeDisplay.textContent = "0:00";
      },
      sig,
    );
  }

  if (clickTarget) {
    // The click target may be the persistent <video id="preview">, so this
    // listener also needs the AbortController scope to avoid duplicates.
    clickTarget.addEventListener(
      "click",
      (event) => {
        const mediaEl = currentControlMedia();
        if (!mediaEl || mediaEl.src === "") return;
        const isControl = event.target.closest("#customControls");

        if (!isControl) {
          if (mediaEl.paused) {
            void playVideoSafely(mediaEl, "preview click toggle");
          } else {
            mediaEl.pause();
          }
        }
        event.stopPropagation();
      },
      sig,
    );
  }

  setupCustomMediaControls.updateControlsForMetadata = updateControlsForMetadata;
}

function closeVolumePopup() {
  const slider = document.getElementById("gtkVolSlider");
  if (!slider) return;

  slider.blur();
  volumePopupOpen = false;

  slider.style.display = "";
}

function setupGtkVolumeControl() {
  // 1. Get DOM references
  const video = document.getElementById("preview");
  const slider = document.getElementById("gtkVolSlider");
  const icon = document.getElementById("gtkVolIcon");
  const button = document.getElementById("gtkVolBtn");

  if (!video || !slider || !icon || !button) {
    console.error("Missing GTK Volume Control elements.");
    return;
  }

  if (slider.dataset.gtkVolBound === "1") {
    slider.value = Math.round((video.volume || 1) * 100);
    if (video.muted) slider.value = 0;
    return;
  }
  slider.dataset.gtkVolBound = "1";

  slider.addEventListener("mousedown", () => {
    volumePopupOpen = true;
  });

  slider.addEventListener(
    "touchstart",
    () => {
      volumePopupOpen = true;
    },
    { passive: true },
  );

  // Initialize slider value based on current video volume (or 100 if undefined)
  slider.value = Math.round((video.volume || 1) * 100);

  // Initial mute state check
  if (video.muted) slider.value = 0;

  // Helper function to update the icon's appearance
  function updateIcon(v) {
    // --- 1. Define the GTK4 Symbolic Icon paths (16x16 viewBox) ---
    const CONE_PATH = `<path d="M 1 5 L 4 5 L 7 2 L 7 14 L 4 11 L 1 11 Z"/>`;

    // Arcs are stroked paths with 'fill="none"'
    const ARC_1 = `<path id="arc1" d="M 9 7.5 C 9.5 7.5 9.5 8.5 9 8.5" fill="none" stroke="currentColor" stroke-width="1"/>`;
    const ARC_2 = `<path id="arc2" d="M 10 6 C 11 6 11 10 10 10" fill="none" stroke="currentColor" stroke-width="1"/>`;
    const ARC_3 = `<path id="arc3" d="M 12 4 C 14 4 14 12 12 12" fill="none" stroke="currentColor" stroke-width="1"/>`;

    // --- 2. Update Icon based on volume/mute state ---
    if (video.muted || v == 0) {
      // Muted Icon: Cone + Mute Cross
      icon.innerHTML =
        CONE_PATH +
        `<line x1="8" y1="2" x2="16" y2="14" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>`;
    } else {
      // Volume Icon: Cone + Arcs (all paths)
      icon.innerHTML = CONE_PATH + ARC_1 + ARC_2 + ARC_3;

      // Re-query the arcs after setting innerHTML
      const arc1 = document.getElementById("arc1");
      const arc2 = document.getElementById("arc2");
      const arc3 = document.getElementById("arc3");

      // Set default display to none for fine control
      if (arc1) arc1.style.display = "none";
      if (arc2) arc2.style.display = "none";
      if (arc3) arc3.style.display = "none";

      // Show arcs based on volume thresholds
      if (v > 1) {
        // Low volume: Show Arc 1
        if (arc1) arc1.style.display = "block";
      }
      if (v > 33) {
        // Medium volume: Show Arc 2
        if (arc2) arc2.style.display = "block";
      }
      if (v > 66) {
        // High volume: Show Arc 3
        if (arc3) arc3.style.display = "block";
      }
    }
  }

  // --- EVENT LISTENERS ---

  // 1. Slider Input Handler (User adjusts volume)
  slider.addEventListener("input", () => {
    const v = slider.value / 100;
    video.volume = v;

    // If the user moves the slider from 0, unmute the video
    if (v > 0) video.muted = false;

    updateIcon(slider.value);
  });

  // 2. Volume Change Handler (Sync with programmatic changes/mute)
  video.addEventListener("volumechange", () => {
    // Update slider position if mute state changes or volume changes elsewhere
    if (video.muted) {
      slider.value = 0;
    } else {
      slider.value = Math.round(video.volume * 100);
    }
    updateIcon(slider.value);
  });

  // 3. Mute/Unmute Button Click Handler
  let lastVolume = slider.value / 100; // Store last known non-zero volume

  button.addEventListener("click", () => {
    if (video.muted) {
      // UNMUTE: Restore to last volume (or default to 100%)
      video.volume = lastVolume > 0 ? lastVolume : 1;
      video.muted = false;
    } else {
      // MUTE: Store current volume before muting
      lastVolume = video.volume;
      video.muted = true;
    }
    // The 'volumechange' event handles the UI update via updateIcon
  });

  // Initial icon setup on load
  updateIcon(slider.value);
}

let lastUpdateTimeLocalPlayer = 0;

function getAudioDevices() {
  return navigator.mediaDevices.enumerateDevices().then((devices) =>
    devices.reduce((audioOutputs, device) => {
      if (device.kind === "audiooutput") {
        audioOutputs.push(device);
      }
      return audioOutputs;
    }, []),
  );
}

let audioOutputs = [];
let audioContext = null;
let audioSource = null;

async function changeAudioOutput(deviceIds) {
  if (!video) return;

  // Cleanup existing audio setup
  if (audioOutputs.length) {
    audioOutputs.forEach((audio) => {
      audio.pause();
      audio.srcObject = null;
    });
    audioOutputs = [];
  }

  if (audioSource) {
    audioSource.disconnect();
  }

  // Create new audio context if needed
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    audioSource = audioContext.createMediaElementSource(video);
  }

  // Create outputs for each device
  audioOutputs = await Promise.all(
    deviceIds.map(async (deviceId) => {
      const dest = audioContext.createMediaStreamDestination();
      const audio = new Audio();
      await audio.setSinkId(deviceId);
      audioSource.connect(dest);
      audio.srcObject = dest.stream;
      await audio.play();
      return audio;
    }),
  );
}

function addFilenameToTitlebar(path) {
  document.title = getHostnameOrBasename(path) + " - EMS Media System";
}

function removeFilenameFromTitlebar() {
  document.title = "EMS Media System";
}

let toastTimer = null;
/** Auto-hide deadline (ms since epoch) for interactive #gnomeToast hover pause. */
let toastHideDeadline = 0;
/** AbortController for mouseenter/mouseleave on interactive toast. */
let toastHoverAbort = null;
/** onUndoExpire while an interactive undo toast is active (cleared on undo or dismiss). */
let activeInteractiveUndoExpire = null;

let previewToastTimer = null;

function resetPreviewWarningState() {
  hasShownPreviewWarning = false;
}

/**
 * Dismisses a visible interactive undo toast: clears timers/hover, runs expire callback
 * (discards undo snapshot), and removes toast content. Used before new toasts or when
 * queue state changes and the old undo is no longer valid.
 */
function dismissInteractiveGnomeToastForReplacement() {
  if (toastHoverAbort) {
    toastHoverAbort.abort();
    toastHoverAbort = null;
  }
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  toastHideDeadline = 0;
  const toast = document.getElementById("gnomeToast");
  const hadInteractive = toast?.classList.contains("gnome-osd-toast--interactive");
  if (hadInteractive && typeof activeInteractiveUndoExpire === "function") {
    const fn = activeInteractiveUndoExpire;
    activeInteractiveUndoExpire = null;
    fn();
  } else {
    activeInteractiveUndoExpire = null;
  }
  if (hadInteractive && toast) {
    toast.classList.remove("visible");
    toast.replaceChildren();
    toast.classList.remove("gnome-osd-toast--interactive");
    toast.style.display = "none";
  }
}

function invalidateQueueUndoToastAfterMutation() {
  dismissInteractiveGnomeToastForReplacement();
}

/**
 * @param {string} message
 * @param {number | { onUndo?: () => void; onUndoExpire?: () => void; duration?: number; undoLabel?: string; undoStyle?: "pill-accent" }} [durationOrOptions]
 */
function showGnomeToast(message, durationOrOptions = 3000) {
  const FADE_OUT_DURATION = 300;
  let duration = 3000;
  /** @type {(() => void) | null} */
  let onUndo = null;
  /** @type {(() => void) | null} */
  let onUndoExpire = null;
  let undoLabel = "Undo";
  /** @type {"pill-accent" | null} */
  let undoStyle = null;

  if (typeof durationOrOptions === "number" && Number.isFinite(durationOrOptions)) {
    duration = durationOrOptions;
  } else if (
    durationOrOptions &&
    typeof durationOrOptions === "object" &&
    typeof durationOrOptions.onUndo === "function"
  ) {
    onUndo = durationOrOptions.onUndo;
    duration =
      typeof durationOrOptions.duration === "number"
        ? durationOrOptions.duration
        : 10000;
    if (typeof durationOrOptions.undoLabel === "string") {
      undoLabel = durationOrOptions.undoLabel;
    }
    if (typeof durationOrOptions.onUndoExpire === "function") {
      onUndoExpire = durationOrOptions.onUndoExpire;
    }
    if (durationOrOptions.undoStyle === "pill-accent") {
      undoStyle = "pill-accent";
    }
  }

  const interactive = onUndo !== null;
  /** @type {((ms: number) => void) | null} */
  let startInteractiveAutoHide = null;

  let toast = document.getElementById("gnomeToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "gnomeToast";
    toast.className = "gnome-osd-toast";
    document.body.appendChild(toast);
  }

  dismissInteractiveGnomeToastForReplacement();

  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  toastHideDeadline = 0;

  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.setAttribute("aria-atomic", "true");

  const dismissAfterUndo = () => {
    if (toastHoverAbort) {
      toastHoverAbort.abort();
      toastHoverAbort = null;
    }
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    toastHideDeadline = 0;
    activeInteractiveUndoExpire = null;
    toast.classList.remove("visible");
    setTimeout(() => {
      toast.style.display = "none";
      toast.replaceChildren();
      toast.classList.remove("gnome-osd-toast--interactive");
    }, FADE_OUT_DURATION);
  };

  if (interactive) {
    toast.classList.add("gnome-osd-toast--interactive");
    toast.replaceChildren();
    const msg = document.createElement("span");
    msg.className = "gnome-osd-toast__message";
    msg.textContent = message;
    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.className = "gnome-osd-toast__undo";
    undoBtn.textContent = undoLabel;
    undoBtn.setAttribute("aria-label", undoLabel);
    if (undoStyle === "pill-accent") {
      undoBtn.classList.add("gnome-osd-toast__undo--pill-accent");
    }

    activeInteractiveUndoExpire = onUndoExpire;

    const runUndoExpire = () => {
      const ex = activeInteractiveUndoExpire;
      activeInteractiveUndoExpire = null;
      if (typeof ex === "function") {
        ex();
      }
    };

    const ac = new AbortController();
    toastHoverAbort = ac;

    let resumeMs = duration;

    const finishTimeoutHide = () => {
      if (toastHoverAbort) {
        toastHoverAbort.abort();
        toastHoverAbort = null;
      }
      toast.classList.remove("visible");
      toastTimer = null;
      toastHideDeadline = 0;
      setTimeout(() => {
        toast.style.display = "none";
        toast.replaceChildren();
        toast.classList.remove("gnome-osd-toast--interactive");
        runUndoExpire();
      }, FADE_OUT_DURATION);
    };

    const scheduleHide = (ms) => {
      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
      if (ms <= 0) {
        finishTimeoutHide();
        return;
      }
      toastHideDeadline = Date.now() + ms;
      toastTimer = setTimeout(() => {
        toastTimer = null;
        finishTimeoutHide();
      }, ms);
    };

    toast.addEventListener(
      "mouseenter",
      () => {
        if (toastHideDeadline <= 0) return;
        if (toastTimer) {
          clearTimeout(toastTimer);
          toastTimer = null;
        }
        resumeMs = Math.max(0, toastHideDeadline - Date.now());
      },
      { signal: ac.signal },
    );

    toast.addEventListener(
      "mouseleave",
      () => {
        if (toastHideDeadline <= 0) return;
        scheduleHide(resumeMs);
      },
      { signal: ac.signal },
    );

    undoBtn.addEventListener("click", () => {
      if (toastHoverAbort) {
        toastHoverAbort.abort();
        toastHoverAbort = null;
      }
      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
      toastHideDeadline = 0;
      activeInteractiveUndoExpire = null;
      onUndo();
      dismissAfterUndo();
    });
    toast.appendChild(msg);
    toast.appendChild(undoBtn);
    toast.style.display = "flex";

    startInteractiveAutoHide = scheduleHide;
  } else {
    toast.classList.remove("gnome-osd-toast--interactive");
    toast.replaceChildren(document.createTextNode(message));
    toast.style.display = "block";
  }

  toast.classList.add("visible");

  if (startInteractiveAutoHide) {
    startInteractiveAutoHide(duration);
  } else {
    toastTimer = setTimeout(() => {
      toast.classList.remove("visible");
      toastTimer = null;
      setTimeout(() => {
        toast.style.display = "none";
        toast.classList.remove("gnome-osd-toast--interactive");
      }, FADE_OUT_DURATION);
    }, duration);
  }
}

function showPreviewWarningToast() {
  // 1. Safety Check: Ensure video element exists
  if (!video) return;
  if (video.src === "") return;

  if (hasShownPreviewWarning) {
    return;
  }

  // 3. Find target container (Video parent)
  // We attach to the parentNode so the absolute positioning is relative to the container, not the window
  const container = video.parentNode;

  // Ensure container has relative positioning for the absolute toast to work
  if (window.getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }

  // 4. Create or Select the Toast Element
  let toast = container.querySelector(".gnome-osd-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "gnome-osd-toast";
    container.appendChild(toast);
  }

  // 5. Set Text (GNOME HID Compliant Message)
  toast.textContent =
    'Press "Present" to show on the selected display.';

  // 6. Manage Animation and Timer
  // Force a reflow to ensure the transition triggers if element was just added
  void toast.offsetWidth;

  // Show the toast
  requestAnimationFrame(() => {
    toast.classList.add("visible");
  });

  // Clear any existing timer to prevent premature removal
  if (previewToastTimer) {
    clearTimeout(previewToastTimer);
  }

  // Set 5-second timer to remove
  previewToastTimer = setTimeout(() => {
    // Check if the toast element still exists in the DOM before manipulating classes
    if (!toast || !toast.parentNode) {
      previewToastTimer = null;
      return; // Exit if the toast or its parent is already gone
    }

    toast.classList.remove("visible");

    // Wait for CSS transition (250ms) to finish before removing from DOM
    setTimeout(() => {
      // Double-check the parent's existence right before removal
      if (toast && toast.parentNode) {
        // Use try...catch as a final safety measure against unexpected detachment
        try {
          toast.parentNode.removeChild(toast);
        } catch (e) {
          // Log the error if removal fails, but continue the cleanup
          // console.error("Toast removal failed:", e);
        }
      }
      previewToastTimer = null;
    }, 250);
  }, 5000);

  hasShownPreviewWarning = true;
}

function update(time) {
  // When liveAudio is performing the live presentation, drive the countdown
  // timer from it instead of from the preview video element.
  const activeEl = liveAudio?.paused === false ? liveAudio : video;
  if (activeEl.paused | (currentMode !== MEDIAPLAYER)) {
    localTimeStampUpdateIsRunning = 0;
    return;
  }

  // Same rule as handleTimeMessage: a loaded cue owns the countdown,
  // so the live-media RAF loop steps aside while the operator scrubs.
  // The loop itself keeps going (so it resumes painting immediately when
  // the cue is cleared) — only the NUM_BUFFER write is skipped.
  const cueOwnsCountdown =
    getCountdownSourceElement() !== null || isImagePreviewCueActive();
  if (!cueOwnsCountdown && time - lastUpdateTimeLocalPlayer > 33) {
    NUM_BUFFER[3] = activeEl.duration - activeEl.currentTime;

    NUM_BUFFER[0] = (NUM_BUFFER[3] * 0.000277777777778) | 0;
    NUM_BUFFER[1] =
      ((NUM_BUFFER[3] - NUM_BUFFER[0] * 3600) * 0.0166666666667) | 0;
    NUM_BUFFER[2] =
      (NUM_BUFFER[3] | 0) - NUM_BUFFER[0] * 3600 - NUM_BUFFER[1] * 60;
    NUM_BUFFER[3] = ((NUM_BUFFER[3] - (NUM_BUFFER[3] | 0)) * 1000) | 0;

    idx0 = NUM_BUFFER[0] << 1;
    mask0 = NUM_BUFFER[0] < 10;
    idx1 = NUM_BUFFER[1] << 1;
    mask1 = NUM_BUFFER[1] < 10;
    idx2 = NUM_BUFFER[2] << 1;
    mask2 = NUM_BUFFER[2] < 10;

    updatePending[0] = 1;
    requestAnimationFrame(updateCountdownNode);
    lastUpdateTimeLocalPlayer = time;
  }

  requestAnimationFrame(update);
}

function updateTimestamp() {
  if (localTimeStampUpdateIsRunning) {
    return;
  }

  if (currentMode !== MEDIAPLAYER) {
    localTimeStampUpdateIsRunning = false;
    return;
  }

  if (!video.paused || liveAudio?.paused === false) {
    localTimeStampUpdateIsRunning = true;
    requestAnimationFrame(update);
  }
}

let lastUpdateTime = 0;

const STRING_BUFFER = new Uint16Array(20);
const ZERO = "0".charCodeAt(0);
STRING_BUFFER[2] = STRING_BUFFER[5] = ":".charCodeAt(0);
STRING_BUFFER[8] = ".".charCodeAt(0);
const PAD_CODES = new Uint16Array(128);
for (let i = 0; i < 64; i++) {
  PAD_CODES[i * 2] = 48 + ((i / 10) | 0);
  PAD_CODES[i * 2 + 1] = 48 + (i % 10);
}

/**
 * Decide which media element owns the countdown overlay. Cue scrubs win
 * over the live mirror: while the operator is previewing a cued video or
 * audio item, the big "time remaining" display in the corner should
 * reflect what they're scrubbing, not the projection.
 *
 * Returns null when:
 *   - no cue is loaded (the live media drives the countdown), OR
 *   - the cue is an image (no meaningful countdown exists — caller hides
 *     the overlay instead).
 */
function getCountdownSourceElement() {
  if (isAudioPreviewCueActive() && previewAudio) {
    return previewAudio;
  }
  if (isVideoPreviewCueActive() && previewCueVideo) {
    return previewCueVideo;
  }
  return null;
}

/**
 * True when an image is cued. The countdown overlay must be hidden in
 * this case — there is no duration to count down from — and re-shown when
 * the cue clears (assuming the live media is not also an image).
 */
function isImagePreviewCueActive() {
  const cue = currentPreviewCue();
  return Boolean(cue && isQueueItemImage(cue.item));
}

/**
 * Per-cue scratch buffer. The live mirror has its own NUM_BUFFER /
 * STRING_BUFFER / requestAnimationFrame pipeline driven by
 * handleTimeMessage + update(); reusing those structures from the cue
 * scrub path would mean two independent sources mutating a single
 * shared buffer and racing for the same RAF slot. Even with strict
 * source-switching guards, the architecture is fragile — one missed
 * guard and the two countdowns interleave into torn digits. The cue
 * gets its own private buffer here and writes the formatted string
 * straight into the textNode, so a cue scrub can never corrupt the
 * live path's in-flight NUM_BUFFER state and vice versa.
 *
 * The buffer is pre-sized for "HH:MM:SS.mmm" (12 chars) and indexed by
 * absolute position so we never allocate a string just to format the
 * countdown — paintCountdownFor runs once per timeupdate (≈4 Hz) and
 * once per seek, well below the live RAF rate, but keeping it
 * allocation-free still avoids waking the GC inside event callbacks.
 */
const CUE_COUNTDOWN_CHARS = new Uint16Array(12);
CUE_COUNTDOWN_CHARS[2] = CUE_COUNTDOWN_CHARS[5] = ":".charCodeAt(0);
CUE_COUNTDOWN_CHARS[8] = ".".charCodeAt(0);

function writeTwoDigits(value, offset) {
  if (value < 0) value = 0;
  if (value > 99) value = 99;
  CUE_COUNTDOWN_CHARS[offset] = ZERO + ((value / 10) | 0);
  CUE_COUNTDOWN_CHARS[offset + 1] = ZERO + (value % 10);
}

function writeThreeDigits(value, offset) {
  if (value < 0) value = 0;
  if (value > 999) value = 999;
  CUE_COUNTDOWN_CHARS[offset] = ZERO + ((value / 100) | 0);
  CUE_COUNTDOWN_CHARS[offset + 1] = ZERO + (((value / 10) | 0) % 10);
  CUE_COUNTDOWN_CHARS[offset + 2] = ZERO + (value % 10);
}

/**
 * Compute (duration − currentTime) for the cue scrub element and write
 * the formatted "HH:MM:SS.mmm" string straight into the textNode. This
 * deliberately does NOT touch NUM_BUFFER / STRING_BUFFER / updatePending
 * so the live mirror's RAF pipeline keeps owning its own state — even
 * while a cue is loaded, the live path can continue painting into its
 * private buffers (the source-switching guards just stop it from
 * applying those buffers to the on-screen textNode).
 *
 * Wired from previewCueVideo's timeupdate/seeked/loadedmetadata
 * listeners and previewAudio's equivalents, plus the one-shot redraw
 * inside restoreCountdownForLiveMedia for fast handoff back to live.
 */
function paintCountdownFor(mediaEl) {
  if (!mediaEl) return;
  const duration = mediaEl.duration;
  const currentTime = mediaEl.currentTime;
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(currentTime) ||
    currentTime < 0
  ) {
    return;
  }
  let remaining = duration - currentTime;
  if (remaining < 0) remaining = 0;
  const wholeSeconds = remaining | 0;
  const hours = (wholeSeconds / 3600) | 0;
  const rem = wholeSeconds - hours * 3600;
  const minutes = (rem / 60) | 0;
  const seconds = rem - minutes * 60;
  const millis = ((remaining - wholeSeconds) * 1000 + 0.5) | 0;
  writeTwoDigits(hours, 0);
  writeTwoDigits(minutes, 3);
  writeTwoDigits(seconds, 6);
  writeThreeDigits(millis > 999 ? 999 : millis, 9);
  textNode.data = String.fromCharCode(
    CUE_COUNTDOWN_CHARS[0],
    CUE_COUNTDOWN_CHARS[1],
    CUE_COUNTDOWN_CHARS[2],
    CUE_COUNTDOWN_CHARS[3],
    CUE_COUNTDOWN_CHARS[4],
    CUE_COUNTDOWN_CHARS[5],
    CUE_COUNTDOWN_CHARS[6],
    CUE_COUNTDOWN_CHARS[7],
    CUE_COUNTDOWN_CHARS[8],
    CUE_COUNTDOWN_CHARS[9],
    CUE_COUNTDOWN_CHARS[10],
    CUE_COUNTDOWN_CHARS[11],
  );
}

/**
 * Restore the countdown overlay's visibility to whatever the live media
 * requires. Called when a cue clears (the cue might have hidden the
 * overlay for an image preview, or pinned it to the cue's time), so the
 * operator sees the live time again for audio/video and nothing for an
 * image or empty live source.
 */
function restoreCountdownForLiveMedia() {
  const hasLiveSource = Boolean(mediaFile);
  const liveIsImage = hasLiveSource && isImg(mediaFile);
  const showCountdown = hasLiveSource && !liveIsImage;
  setMediaCountdownOverlayVisible(showCountdown);
  if (!showCountdown) {
    textNode.data = "";
    return;
  }
  // Prefer liveAudio's clock for audio-only live presentations — the
  // main video element may be paused/empty in that mode. Otherwise fall
  // back to the main mirror so we paint immediately instead of waiting
  // for the next projection time message.
  if (liveAudio?.src && liveAudio.src !== "" && !liveAudio.paused) {
    paintCountdownFor(liveAudio);
  } else if (video) {
    paintCountdownFor(video);
  }
}

function updateCountdownNode() {
  let tens = (NUM_BUFFER[0] / 10) | 0,
    units = NUM_BUFFER[0] % 10;
  STRING_BUFFER[0] = mask0 ? PAD_CODES[idx0] : ZERO + tens;
  STRING_BUFFER[1] = mask0 ? PAD_CODES[idx0 + 1] : ZERO + units;

  ((tens = (NUM_BUFFER[1] / 10) | 0), (units = NUM_BUFFER[1] % 10));
  STRING_BUFFER[3] = mask1 ? PAD_CODES[idx1] : ZERO + tens;
  STRING_BUFFER[4] = mask1 ? PAD_CODES[idx1 + 1] : ZERO + units;

  ((tens = (NUM_BUFFER[2] / 10) | 0), (units = NUM_BUFFER[2] % 10));
  STRING_BUFFER[6] = mask2 ? PAD_CODES[idx2] : ZERO + tens;
  STRING_BUFFER[7] = mask2 ? PAD_CODES[idx2 + 1] : ZERO + units;

  STRING_BUFFER[9] = ZERO + ((NUM_BUFFER[3] / 100) | 0);
  STRING_BUFFER[10] = ZERO + (((NUM_BUFFER[3] / 10) | 0) % 10);
  STRING_BUFFER[11] = ZERO + (NUM_BUFFER[3] % 10);

  textNode.data = String.fromCharCode(
    STRING_BUFFER[0],
    STRING_BUFFER[1],
    STRING_BUFFER[2],
    STRING_BUFFER[3],
    STRING_BUFFER[4],
    STRING_BUFFER[5],
    STRING_BUFFER[6],
    STRING_BUFFER[7],
    STRING_BUFFER[8],
    STRING_BUFFER[9],
    STRING_BUFFER[10],
    STRING_BUFFER[11],
  );

  updatePending[0] = 0;
}

let now = 0;
function handleTimeMessage(_, message) {
  const duration = Array.isArray(message) ? message[0] : message?.duration;
  const currentTime = Array.isArray(message)
    ? message[1]
    : message?.currentTime;
  const timestamp = Array.isArray(message) ? message[2] : message?.timestamp;
  const messageMediaFile = Array.isArray(message)
    ? message[3]
    : message?.mediaFile;

  if (
    messageMediaFile &&
    mediaFile &&
    normalizeMediaPathForCompare(messageMediaFile) !==
      normalizeMediaPathForCompare(mediaFile)
  ) {
    return;
  }

  if (
    !Number.isFinite(duration) ||
    !Number.isFinite(currentTime) ||
    duration <= 0 ||
    currentTime < 0
  ) {
    return;
  }

  now = Date.now();

  if (currentMode === MEDIAPLAYER) {
    // Cue scrubs own the countdown while a cue is loaded — the operator
    // is reading "time remaining on the thing I'm previewing", not on the
    // live media. The cue's own timeupdate/seeked handlers drive the
    // overlay (or hide it entirely for an image cue), so we just step
    // out of the way here.
    if (!getCountdownSourceElement() && !isImagePreviewCueActive()) {
      SECONDSFLOAT[0] = Math.max(0, duration - currentTime);
      NUM_BUFFER[0] = ((SECONDSFLOAT[0] | 0) / 3600) | 0;
      REM_BUFFER[0] = (SECONDSFLOAT[0] | 0) % 3600;
      NUM_BUFFER[1] = (REM_BUFFER[0] / 60) | 0;
      NUM_BUFFER[2] = REM_BUFFER[0] % 60;
      NUM_BUFFER[3] =
        ((SECONDSFLOAT[0] - (SECONDSFLOAT[0] | 0)) * 1000 + 0.5) | 0;
      // Keep the PAD_CODES lookup metadata in sync with NUM_BUFFER on
      // every IPC tick. Historically only the local update() RAF loop
      // refreshed mask*/idx*, which meant updateCountdownNode would
      // render the hours/minutes/seconds digits from a stale lookup
      // whenever this IPC path won the race to schedule the next paint
      // — most visible right after a cue clears (update() skipped the
      // refresh while the cue owned the countdown). Refresh here too so
      // the live countdown is fully self-sufficient and never gets
      // "stuck" digits.
      idx0 = NUM_BUFFER[0] << 1;
      mask0 = NUM_BUFFER[0] < 10;
      idx1 = NUM_BUFFER[1] << 1;
      mask1 = NUM_BUFFER[1] < 10;
      idx2 = NUM_BUFFER[2] << 1;
      mask2 = NUM_BUFFER[2] < 10;
      if (!updatePending[0]) {
        updatePending[0] = 1;
        requestAnimationFrame(updateCountdownNode);
      }
    }
  }

  // The PID sync must run unconditionally while the live mirror is
  // playing. In the old architecture this path early-returned whenever a
  // cue was loaded (shouldSuppressPreviewForwarding was true), which
  // froze the PID controller and let the mirror's playbackRate drift
  // away from the projection. With the cue scrub on a dedicated overlay
  // the main #preview is always the live mirror, so we keep adjusting it
  // — only the explicit suppressPreviewForwarding flag (used briefly
  // during projection→preview sync to break feedback) is honored here.
  if (suppressPreviewForwarding) {
    return;
  }

  // Perform timestamp calculations only if enough time has passed
  if (now - lastUpdateTime > 500) {
    if (video && !video.paused && !video.seeking) {
      targetTime = currentTime - (now - timestamp + (Date.now() - now)) * 0.001;
      hybridSync(targetTime);
      lastUpdateTime = now;
    }
  }
}

async function handlePlaybackState(event, playbackState) {
  if (!video) {
    return;
  }
  // The main #preview is the live mirror at all times — including while a
  // cue is loaded into the overlay — so this projection→preview sync must
  // run unconditionally. Without it, the mirror gets stuck in whatever
  // play/pause state it happened to be in when the cue was loaded, and
  // clearing the cue reveals a paused or out-of-sync preview accompanied
  // by an audio glitch as it catches up. The explicit
  // suppressPreviewForwarding window prevents the sync-induced play/pause
  // event from looping back through pauseLocalMedia / playLocalMedia.
  if (playbackState.playing && video.paused) {
    masterPauseState = false;
    if (!isImg(mediaFile)) {
      suppressPreviewForwarding = true;
      try {
        await playVideoSafely(video, "playback state sync");
      } finally {
        suppressPreviewForwarding = false;
      }
    }
  } else if (!playbackState.playing && !video.paused) {
    masterPauseState = true;
    suppressPreviewForwarding = true;
    try {
      video.currentTime = playbackState.currentTime;
      await video.pause();
    } finally {
      suppressPreviewForwarding = false;
    }
  }
}

function handlePlayPause(event, arg) {
  mediaSessionPause = arg;
}

function handleMediaseek(event, seekTime) {
  if (shouldSuppressPreviewForwarding()) {
    return;
  }
  if (video) {
    const newTime = video.currentTime + seekTime;
    if (newTime >= 0 && newTime <= video.duration) {
      video.currentTime = newTime;
    }
  }
}

function handleWindowMax(event, isMaximized) {
  document
    .querySelector(".window-container")
    .classList.toggle("maximized", isMaximized);
}

function installIPCHandler() {
  on("timeRemaining-message", handleTimeMessage);
  on("update-playback-state", handlePlaybackState);
  on("remoteplaypause", handlePlayPause);
  on("media-window-closed", handleMediaWindowClosed);
  on("media-playback-ended", async (event, endedMediaFile) => {
    if (
      endedMediaFile &&
      currentQueueIndex >= 0 &&
      currentQueueIndex < mediaQueue.length &&
      normalizeMediaPathForCompare(endedMediaFile) !==
        normalizeMediaPathForCompare(mediaQueue[currentQueueIndex].path)
    ) {
      return;
    }
    mediaPlaybackEndedPending = true;
    try {
      const slipstreamed = await trySlipstreamNextQueueItem();
      if (slipstreamed) {
        // Keep the renderer's cache aligned with reality: this transition keeps
        // the projection BrowserWindow alive, so the app should remain in
        // "active media window" state.
        isActiveMediaWindowCache = true;
        return;
      }
      if (queueSlipstreamTransitionInProgress) {
        return;
      }
    } catch (err) {
      console.error("Slipstream transition failed, falling back to close:", err);
    }
    send("close-media-window", 0);
  });
  on("media-seek", handleMediaseek);
  on("window-maximized", handleWindowMax);
}

async function handleMediaWindowClosed(event, id) {
  resolveQueuePresentationVideo();
  const localVideo = video;

  try {
    await invoke("dismiss-queue-switch-dialog");
  } catch (err) {
    console.error(err);
  }

  if (pendingQueueClearPostClose) {
    pendingQueueClearPostClose = false;
    mediaPlaybackEndedPending = false;
    isPlaying = false;
    isQueuePlaying = false;
    updateDynUI();
    isActiveMediaWindowCache = false;
    saveMediaFile();
    pauseLocalPreviewAfterQueueClear();
    return;
  }

  if (pendingQueueSwitchIndex !== null) {
    const idx = pendingQueueSwitchIndex;
    const switchStartTime = pendingQueueSwitchStartTime;
    pendingQueueSwitchIndex = null;
    pendingQueueSwitchStartTime = 0;
    mediaPlaybackEndedPending = false;

    isPlaying = false;
    updateDynUI();
    isActiveMediaWindowCache = false;

    currentQueueIndex = idx;
    await loadQueueItemIntoControlWindow(mediaQueue[idx], {
      preservePreviewSeek: false,
      startTime: switchStartTime,
    });
    renderQueue();

    isPlaying = true;
    updateDynUI();

    const iM = isImg(mediaFile);
    if (iM) {
      await createMediaWindow();
      if (localVideo) {
        localVideo.currentTime = 0;
        if (!localVideo.paused) {
          localVideo.removeAttribute("src");
          localVideo.load();
        }
      }
    } else if (
      audioOnlyFile ||
      classifyQueueMediaType(mediaQueue[idx].path) === "audio"
    ) {
      await playAudioOnlyLocally();
    } else {
      await createMediaWindow();
    }
    clearCueAfterTake(idx);
    return;
  }

  if (isQueuePlaying) {
    if (mediaPlaybackEndedPending) {
      mediaPlaybackEndedPending = false;
      if (currentPreviewCue() || isQueueAutoAdvanceEnabled()) {
        await advanceQueueAfterMediaWindowClosed();
      } else {
        await stopQueuePresentationUserClosed();
      }
    } else {
      await stopQueuePresentationUserClosed();
    }
    return;
  }

  if (isLiveStream(mediaFile)) {
    saveMediaFile();
  }

  if (localVideo) {
    syncPreviewAudioTrackState();

    if (
      localVideo.loop &&
      localVideo.currentTime > 0 &&
      localVideo.duration - localVideo.currentTime < 0.5
    ) {
      startTime = 0;
      targetTime = 0;
      localVideo.currentTime = 0;
      await playVideoSafely(localVideo, "loop restart after window close");
      await createMediaWindow();
      return;
    }
  }

  isPlaying = false;
  updateDynUI();
  isActiveMediaWindowCache = false;

  // ADDED: Restore queued file if we're in media player mode
  if (
    currentMode === MEDIAPLAYER &&
    mediaPlayerInputState.filePaths.length > 0
  ) {
    mediaFile = mediaPlayerInputState.filePaths[0];
  }

  let isImgFile = isImg(mediaFile);
  handleMediaPlayback(isImgFile);

  let imgEle = document.querySelector("img");
  handleImageDisplay(isImgFile, imgEle);

  resetVideoState();

  updatePlayButtonOnMediaWindow();
  masterPauseState = false;
  saveMediaFile();
  removeFilenameFromTitlebar();
  textNode.data = "";
}
function handleMediaPlayback(isImgFile) {
  if (!video) return;
  if (!isImgFile) {
    video.src = mediaFile;
  }
}

function setMediaCountdownOverlayVisible(isVisible) {
  const countdownEl = document.getElementById("mediaCntDn");
  if (!countdownEl) return;
  countdownEl.style.display = isVisible ? "inline-flex" : "none";
}

function handleImageDisplay(isImgFile, imgEle) {
  const previewEl = document.getElementById("preview");
  setMediaCountdownOverlayVisible(!isImgFile);
  if (imgEle && !isImgFile) {
    imgEle.remove();
    imgEle.src = "";
    if (previewEl) previewEl.style.display = "";
  } else if (isImgFile && video) {
    resetPreviewWarningState();
    if (imgEle) {
      imgEle.src = mediaFile;
    } else {
      if ((imgEle = document.querySelector("img#preview")) !== null) {
        imgEle.remove();
        imgEle.src = "";
      }
      video.removeAttribute("src");
      video.load();
      img = document.createElement("img");
      document
        .getElementById("customControls")
        ?.style.setProperty("visibility", "hidden");
      img.src = mediaFile;
      img.setAttribute("id", "preview");
      if (previewEl) {
        previewEl.style.display = "none";
        previewEl.parentNode?.appendChild(img);
      }
    }
  }
}

function resetVideoState() {
  if (video !== null) {
    video.pause();
    video.currentTime = 0;
    targetTime = 0;
  }
}

function updatePlayButtonOnMediaWindow() {
  const playButton = document.getElementById("mediaWindowPlayButton");
  if (playButton !== null) {
    updateDynUI();
  } else {
    document
      .getElementById("MdPlyrRBtnFrmID")
      .addEventListener("click", updateDynUI, { once: true });
  }
}

function resetPIDOnSeek() {
  if (pidController) {
    pidController.integral = 0;
    pidController.lastTimeDifference = 0;
  }
}

function hybridSync(targetTime) {
  if (audioOnlyFile) return;
  if (!isActiveMediaWindow()) return;
  if (!activeLiveStream) {
    pidController.adjustPlaybackRate(targetTime);
  }
}

function isImg(pathname) {
  return imageRegex.test(pathname);
}

function vlCtl(v) {
  if (!audioOnlyFile) {
    send("vlcl", v, 0);
  } else if (liveAudio && liveAudioQueueIndex >= 0) {
    liveAudio.volume = v;
    if (video) video.volume = v;
  } else {
    video.volume = v;
  }
}

async function pauseMedia(e) {
  if (activeLiveStream) {
    await send("play-ctl", "pause");
    return;
  }
  if (video.src === "" || video.readyState === 0) {
    return;
  }

  if (!playingMediaAudioOnly) {
    await send("play-ctl", "pause");
    invoke("get-media-current-time").then((r) => {
      targetTime = r;
    });
  }
  resetPIDOnSeek();
}

async function unPauseMedia(e) {
  if (activeLiveStream) {
    await send("play-ctl", "play");
    return;
  }
  if (video.src === "" || video.readyState === 0) {
    return;
  }

  if (
    !playingMediaAudioOnly &&
    e !== null &&
    e !== undefined &&
    e.target.isConnected
  ) {
    resetPIDOnSeek();
    await send("play-ctl", "play");
  }
  if (
    playingMediaAudioOnly &&
    document.getElementById("mediaWindowPlayButton")
  ) {
    updateDynUI();
  }
}

function handleCanPlayThrough(e, resolve, mediaEl = video) {
  if (mediaEl.src === "") {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    resolve(mediaEl);
    return;
  }
  audioOnlyFile = mediaElementLoadedAudioOnly(mediaEl, mediaFile || mediaEl.src);

  resolve(mediaEl);
}

function handleError(e, reject) {
  reject(e);
}

/** HTMLMediaElement.readyState constants — readability over magic numbers. */
const HAVE_NOTHING = 0;
const HAVE_METADATA = 1;
/**
 * Hard cap so a stalled media pipeline can never freeze a downstream
 * `await waitForMetadata()` (e.g. the queue-switch confirm flow). Long
 * enough that a healthy local-file load always wins under it; short enough
 * that the UI doesn't appear hung if the pipeline is sick.
 */
const WAIT_FOR_METADATA_TIMEOUT_MS = 4000;

function waitForLoadedMetadata(mediaEl) {
  if (!mediaEl || !mediaEl.src || mediaEl.src === "") {
    return Promise.reject(new Error("Invalid media element source."));
  }
  if (mediaEl.readyState >= HAVE_METADATA) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      mediaEl.removeEventListener("loadedmetadata", onLoaded);
      mediaEl.removeEventListener("error", onError);
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    const finishOk = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onLoaded = () => finishOk();
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(mediaEl.error ?? new Error("Failed to load media metadata"));
    };

    mediaEl.addEventListener("loadedmetadata", onLoaded, { once: true });
    mediaEl.addEventListener("error", onError, { once: true });
    if (mediaEl.readyState === HAVE_NOTHING) {
      mediaEl.load();
    }
    timer = window.setTimeout(finishOk, WAIT_FOR_METADATA_TIMEOUT_MS);
  });
}

/**
 * Resolve when the current preview video has enough metadata to inspect
 * `videoTracks` / `audioTracks` and decide whether the file is audio-only.
 *
 * The previous implementation waited for `canplaythrough`, which has two
 * failure modes that became observable once the <video id="preview">
 * element started surviving tab switches:
 *
 *   1. When metadata is already loaded (queue switch to the same file the
 *      preview was already on, or any case where `loadedmetadata` fired
 *      before the listener was attached), `canplaythrough` will not fire
 *      again — the once-listener just sits there and the promise never
 *      settles, freezing `loadQueueItemIntoControlWindow` and the entire
 *      queue-switch confirmation chain. Externally this looks like the
 *      "Switch" / "Cancel" buttons in the dialog do nothing.
 *   2. `canplaythrough` is also a strictly later milestone than we need:
 *      track inspection only requires `HAVE_METADATA`, so waiting for
 *      `HAVE_ENOUGH_DATA` adds latency for no benefit on slow I/O.
 *
 * The robust shape is:
 *   - resolve immediately if `readyState >= HAVE_METADATA`,
 *   - otherwise resolve on whichever of `loadedmetadata` / `canplaythrough`
 *     fires first,
 *   - reject on `error`,
 *   - and in the worst case, resolve after a hard timeout so callers
 *     awaiting this promise can never hang the UI.
 *
 * Rejection semantics for invalid sources are preserved so existing
 * `.catch()` paths (e.g. `saveMediaFile`) keep working.
 */
function waitForMetadata(mediaEl = video) {
  if (
    !mediaEl ||
    !mediaEl.src ||
    mediaEl.src === "" ||
    isLiveStream(mediaEl.src) ||
    isImg(mediaEl.src)
  ) {
    playingMediaAudioOnly = false;
    audioOnlyFile = false;
    return Promise.reject("Invalid source or live stream.");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      mediaEl.removeEventListener("loadedmetadata", onMetadata);
      mediaEl.removeEventListener("canplaythrough", onCanPlayThrough);
      mediaEl.removeEventListener("error", onError);
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    const finishOk = (e) => {
      if (settled) return;
      settled = true;
      cleanup();
      handleCanPlayThrough(e || {}, resolve, mediaEl);
    };
    const onMetadata = () => finishOk();
    const onCanPlayThrough = (e) => finishOk(e);
    const onError = (e) => {
      if (settled) return;
      settled = true;
      cleanup();
      handleError(e, reject);
    };

    // Fast path: the <video> already advanced past HAVE_METADATA (very
    // common with the persistent preview element after a queue switch to
    // the same file or after `loadedmetadata` fired before this listener
    // attached). Resolve synchronously instead of waiting for an event
    // that will never come.
    if (mediaEl.readyState >= HAVE_METADATA) {
      finishOk();
      return;
    }

    mediaEl.addEventListener("loadedmetadata", onMetadata, { once: true });
    mediaEl.addEventListener("canplaythrough", onCanPlayThrough, { once: true });
    mediaEl.addEventListener("error", onError, { once: true });

    if (mediaEl.readyState === HAVE_NOTHING) {
      mediaEl.load();
    }

    timer = window.setTimeout(() => finishOk(), WAIT_FOR_METADATA_TIMEOUT_MS);
  });
}

async function playMedia(e) {
  if (video) {
    itc = performance.now() * 0.001;
    startTime = video.currentTime;
  }
  targetTime = startTime;
  if (e === undefined && audioOnlyFile && currentMode === MEDIAPLAYER) {
    e = {};
    e.target = document.getElementById("mediaWindowPlayButton");
  }
  fileEnded = false;
  let normalizedPathname = decodeURI(
    removeFileProtocol(video?.src ?? ""),
  );

  if (currentMode === MEDIAPLAYER && mediaFile !== normalizedPathname) {
    saveMediaFile();
  }

  if (await toggleLocalAudioOnlyPlaybackFromControls()) {
    return;
  }

  if (
    video &&
    !audioOnlyFile &&
    video.readyState &&
    mediaElementLoadedAudioOnly(video, mediaFile)
  ) {
    audioOnlyFile = true;
    document.getElementById("customControls").style.visibility = "";
  }

  const mdFile = document.getElementById("mdFile");

  if (video && mediaFile !== normalizedPathname) {
    if (
      isPlaying === false &&
      (!mdFile || mdFile.value === "") &&
      currentMode !== MEDIAPLAYER
    ) {
      return;
    }
  }
  const iM = isImg(mediaFile);

  if (
    !isPlaying &&
    currentMode === MEDIAPLAYER &&
    mediaQueue.length > 0
  ) {
    const startIdx =
      currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
        ? currentQueueIndex
        : 0;
    if (!isLiveStream(mediaQueue[startIdx].path)) {
      isQueuePlaying = true;
      currentQueueIndex = startIdx;
      await playCurrentQueueItem({ previewSeekTime: startTime });
      return;
    }
  }

  if (
    !isPlaying &&
    currentMode === MEDIAPLAYER &&
    mediaQueue.length === 0 &&
    mediaFile &&
    typeof mediaFile === "string" &&
    mediaFile.length > 0 &&
    !isLiveStream(mediaFile)
  ) {
    invalidateQueueUndoToastAfterMutation();
    mediaQueue = [createQueueEntry(mediaFile)];
    currentQueueIndex = 0;
    renderQueue();
    if (video !== null && !isImg(mediaFile)) {
      video.pause();
    }
    saveMediaFile();
    isQueuePlaying = true;
    await playCurrentQueueItem({ previewSeekTime: startTime });
    return;
  }

  if (
    (!mdFile || mdFile.value === "") &&
    !playingMediaAudioOnly &&
    mediaPlayerInputState.filePaths.length === 0
  ) {
    if (isPlaying) {
      isPlaying = false;
      send("close-media-window", 0);
      saveMediaFile();
      if (video) {
        video.currentTime = 0;
        video.pause();
      }
      isPlaying = false;
      updateDynUI();
      localTimeStampUpdateIsRunning = false;
      return;
    } else if (
      currentMode === MEDIAPLAYER &&
      !isPlaying &&
      video.src !== null &&
      video.src !== "" &&
      mediaPlayerInputState.filePaths.length > 0
    ) {
      let t1 = getHostnameOrBasename(mediaPlayerInputState.filePaths[0]);
      let t2 = getHostnameOrBasename(normalizedPathname);
      if (t1 == null || t2 == null || t1 !== t2) {
        return;
      }
    } else {
      return;
    }
  }

  if (!isPlaying) {
    isPlaying = true;
    updateDynUI();
    if (currentMode === MEDIAPLAYER) {
      if (iM) {
        await createMediaWindow();
        video.currentTime = 0;
        if (!video.paused) {
          video.removeAttribute("src");
          video.load();
        }
        return;
      }
    } else if (currentMode === STREAMPLAYER) {
      audioOnlyFile = false;
      await createMediaWindow();
      return;
    }
    if (audioOnlyFile) {
      await playAudioOnlyLocally();
      return;
    }

    await createMediaWindow();
  } else {
    // A presentation is currently live. If the operator has cued a different
    // item in the Preview/Cue panel and hits Present, treat that as "take
    // the cued item live" (the same action as the Play Now button) — not as
    // a global stop. Without this, cueing an audio file while a video is
    // live and pressing the play button would simply stop everything.
    const cue = currentPreviewCue();
    if (cue && currentMode === MEDIAPLAYER) {
      await takeQueueItemLive(cue.index, cue.startTime);
      return;
    }
    if (isQueuePlaying) {
      isQueuePlaying = false;
      currentQueueIndex = -1;
      renderQueue();
    }
    startTime = 0;
    isPlaying = false;
    if (isActiveMediaWindow()) {
      send("close-media-window", 0);
    }
    isActiveMediaWindowCache = false;
    if (playingMediaAudioOnly || liveAudio?.paused === false) {
      stopLiveAudioPresentation();
    } else {
      playingMediaAudioOnly = false;
    }
    if (!audioOnlyFile) activeLiveStream = true;
    if (video) {
      await video.pause();
      video.currentTime = 0;
    }
    if (audioOnlyFile) {
      send("localMediaState", 0, "stop");
      removeFilenameFromTitlebar();
      activeLiveStream = false;
      saveMediaFile();
      audioOnlyFile = false;
    }
    syncPreviewAudioTrackState();
    updateDynUI();
    localTimeStampUpdateIsRunning = false;
    if (mediaFile !== normalizedPathname) {
      waitForMetadata()
        .then(saveMediaFile)
        .catch(function (rej) {
          console.log(rej);
        });
    }
    if (iM) {
      saveMediaFile();
    }
  }
  updateDynUI();
}

function updateDynUI() {
  textNode.data = "";
  const playButton = document.getElementById("mediaWindowPlayButton");
  if (playButton) {
    // The button now wraps an icon + label; write only into the label span
    // so the SVG glyphs survive each state change. The `data-playing`
    // attribute drives which icon (▶ vs ■) is visible via CSS.
    playButton.dataset.playing = isPlaying ? "true" : "false";
    const label = document.getElementById("mediaWindowPlayButtonLabel");
    if (label) {
      label.textContent = isPlaying ? "Stop" : "Present";
    } else {
      playButton.textContent = isPlaying ? "Stop" : "Present";
    }
  }

  document.querySelectorAll("#dspSelct, #dspSelctStreams").forEach((sel) => {
    sel.disabled = isPlaying && audioOnlyFile;
  });
  if (document.getElementById("autoPlayCtl")) {
    const iM = isImg(mediaFile);
    if ((isPlaying && audioOnlyFile) || iM) {
      document.getElementById("autoPlayCtl").checked = true;
    }
    document.getElementById("autoPlayCtl").disabled =
      (isPlaying && audioOnlyFile) || iM;
  }

  // Presentation status mirrors `isPlaying` (the play-button label reads
  // off the same flag). Keep them in sync at one choke point so callers
  // don't have to remember to refresh the status card after flipping
  // playback state — e.g. `playCurrentQueueItem` calls `renderQueue` while
  // `isPlaying` is still false, then sets it true, then `updateDynUI`.
  // Without this, a one-file queue stayed at "Nothing live" forever
  // because no later path called `renderQueue`/`updatePreviewCueUI` again.
  updatePreviewCueUI();
}

async function populateDisplaySelect(options = {}) {
  const force = options.force === true;
  const displaySelects = document.querySelectorAll(
    "#dspSelct, #dspSelctStreams",
  );
  if (!displaySelects.length) return;

  const alreadyReady =
    !force &&
    Array.from(displaySelects).every((sel) => sel.options && sel.options.length > 1);
  if (alreadyReady) {
    return;
  }

  const syncPeerSelects = (source) => {
    const v = source.value;
    displaySelects.forEach((sel) => {
      if (sel !== source) sel.value = v;
    });
  };

  displaySelects.forEach((sel) => {
    sel.onchange = (event) => {
      send("set-display-index", parseInt(event.target.value, 10));
      syncPeerSelects(event.target);
    };
  });

  try {
    const { displays, defaultDisplayIndex } = await invoke("get-all-displays");

    displaySelects.forEach((displaySelect) => {
      displaySelect.options.length = 1;

      const fragment = document.createDocumentFragment();
      for (const { value, label } of displays) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        fragment.appendChild(option);
      }

      displaySelect.appendChild(fragment);
      displaySelect.value = defaultDisplayIndex;
    });
  } catch (error) {
    console.error("Failed to populate display select:", error);
  }
}

function setSBFormStreamPlayer() {
  if (currentMode === STREAMPLAYER) {
    return;
  }
  currentMode = STREAMPLAYER;
  send("set-mode", currentMode);
  updateHeaderAddMediaButtonVisibility();

  ensureStreamsPanelBuilt();

  const mediaPanel = document.getElementById(TAB_PANEL_MEDIA_ID);
  const streamsPanel = document.getElementById(TAB_PANEL_STREAMS_ID);
  if (mediaPanel) mediaPanel.hidden = true;
  if (streamsPanel) streamsPanel.hidden = false;

  restoreLivePreviewIntoPanel(streamsPanel);

  video = document.getElementById("preview");

  const mdFile = document.getElementById("mdFile");
  if (mediaFile !== null && isLiveStream(mediaFile) && mdFile) {
    mdFile.value = mediaFile;
  }

  const volumeSlider = document.getElementById("volume-slider");
  if (volumeSlider) {
    volumeSlider.value = streamVolume;
  }

  installDisplayChangeHandler();
  populateDisplaySelect();

  if (playingMediaAudioOnly) {
    isPlaying = true;
    updateDynUI();
    return;
  }
  restoreMediaFile();

  if (mdFile?.value.includes(":\\fakepath\\")) {
    mdFile.value = "";
  }

  if (!isActiveMediaWindow()) {
    isPlaying = false;
  } else {
    isPlaying = true;
  }
  updateDynUI();
}

async function setSBFormTextPlayer() {
  if (currentMode === TEXTPLAYER) {
    return;
  }
  currentMode = TEXTPLAYER;
  send("set-mode", currentMode);
  updateHeaderAddMediaButtonVisibility();

  if (isActiveMediaWindow()) {
  }

  document.getElementById("dyneForm").innerHTML = `
        <div class="media-container">
            <div class="scripture-panel" style="overflow-y: scroll; width: 50vw; overflow-x: hidden; position: relative;">
                <div id="versesDisplay" class="verses-container"></div>
            </div>
            <div class="control-panel" style=">
                <div class="control-group">
                <div class="control-group" style="position: sticky; top: 0; background: white; z-index: 10; padding-bottom: 10px;">
                    <span class="control-label">Scripture</span>
                    <input type="text" class="url-input" id="scriptureInput" class="input-field" placeholder="e.g., Genesis 1:1">
                    <ul id="bookSuggestions" class="suggestions-list" style="max-height: 250px; max-width: 265px; overflow-y: auto; position: absolute; background-color: white; border: 1px solid #ccc; width: 100%; display: none;"></ul>
                </div>
                <span class="control-label">Display</span>
                <select name="dspSelct" id="dspSelct" class="display-select">
                    <option value="" disabled>--Select Display Device--</option>
                </select>
                </div>
            </div>
        </div>
    `;

  populateDisplaySelect();

  const isActiveMW = isActiveMediaWindow();

  if (!isActiveMW && !playingMediaAudioOnly) {
    isPlaying = false;
  } else {
    isPlaying = true;
    send("close-media-window", 0);
  }
  updateDynUI();

  const scriptureInput = document.getElementById("scriptureInput");
  const versesDisplay = document.getElementById("versesDisplay");
  const bookSuggestions = document.getElementById("bookSuggestions");
  const books = bibleAPI
    .getBooks()
    .sort((a, b) => a.name.localeCompare(b.name));
  const booksById = bibleAPI.getBooks().sort((a, b) => a.id - b.id);

  let selectedIndex = -1;

  scriptureInput.addEventListener("input", function (event) {
    const value = this.value.trim();
    updateBookSuggestions(value);
  });

  scriptureInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault(); // Prevent form submission
      if (selectedIndex >= 0 && bookSuggestions.children[selectedIndex]) {
        bookSuggestions.children[selectedIndex].click();
      } else {
        scriptureInput.value = normalizeScriptureReference(
          scriptureInput.value,
        );
        updateVersesDisplay();
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (selectedIndex < bookSuggestions.children.length - 1) {
        selectedIndex++; // Increment to move down in the list
        updateSuggestionsHighlight();
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (selectedIndex > 0) {
        selectedIndex--; // Decrement to move up in the list
        updateSuggestionsHighlight();
      }
    }
  });

  function updateSuggestionsHighlight() {
    Array.from(bookSuggestions.children).forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add("highlight");
        item.scrollIntoView({ block: "nearest", behavior: "smooth" }); // Ensure the highlighted item is visible
      } else {
        item.classList.remove("highlight");
      }
    });
  }

  let lastHighlighted = null;

  scriptureInput.addEventListener("input", function (event) {
    const value = this.value.trim();
    updateBookSuggestions(value, event);
  });

  scriptureInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      scriptureInput.value = normalizeScriptureReference(scriptureInput.value);
      event.preventDefault(); // Prevent the default form submission
      updateVersesDisplay();
    }
  });

  function normalizeScriptureReference(input) {
    let parts = input.split(" ");
    let normalizedParts = [];

    for (let i = 0; i < parts.length; ++i) {
      let part = parts[i];
      if (part.includes(":")) {
        let subParts = part.split(":");
        subParts = subParts.filter(Boolean);
        normalizedParts.push(subParts.join(":"));
      } else {
        normalizedParts.push(part);
      }
    }

    return normalizedParts.join(" ");
  }

  function parseScriptureReference(input) {
    let tokens = input.split(/\s+/);
    let book = "";
    let chapter = undefined;
    let verse = undefined;

    // Process each token and determine if it's a number or part of a book name
    tokens.forEach((token, index) => {
      if (token.includes(":")) {
        // Handle chapter and verse notation
        const parts = token.split(":");
        chapter = parseInt(parts[0], 10); // Assume the part before ':' is chapter
        verse = parseInt(parts[1], 10); // Assume the part after ':' is verse
      } else if (!isNaN(parseInt(token)) && index === tokens.length - 1) {
        // Last token is a number and no verse has been defined, assume it's a chapter
        chapter = parseInt(token, 10);
      } else {
        // Append to book name
        book = book ? `${book} ${token}` : token;
      }
    });

    return { book, chapter, verse };
  }

  function splitOnLastSpace(input) {
    let lastIndex = input.lastIndexOf(" ");

    if (lastIndex === -1) {
      return [input]; // Return the whole string as an array if no space found
    }

    let firstPart = input.substring(0, lastIndex);
    let lastPart = input.substring(lastIndex + 1);

    return [firstPart, lastPart];
  }

  function updateBookSuggestions(input, event) {
    let parts = input.split(/[\s:]+/);
    let bookPart = input.match(/^\d?\s?[a-zA-Z]+/); // Matches any leading number followed by book names
    bookPart = bookPart ? bookPart[0].trim() : ""; // Ensure the match is not null and trim it
    bookSuggestions.innerHTML = "";
    const filteredBooks = books.filter((book) =>
      book.name.toLowerCase().startsWith(bookPart.toLowerCase()),
    );
    if (filteredBooks.length) {
      if (filteredBooks.length === 1) {
        if (
          splitOnLastSpace(scriptureInput.value)[0] === filteredBooks[0].name
        ) {
          return;
        }

        if (event != null && event.inputType === "insertText") {
          scriptureInput.value = filteredBooks[0].name + " ";
          bookSuggestions.style.display = "none";
          return;
        }
      }
      bookSuggestions.style.display = "block";
      filteredBooks.forEach((book) => {
        const li = document.createElement("li");
        li.textContent = book.name;
        li.onclick = () => {
          scriptureInput.value =
            book.name +
            (parts.length > 1 ? " " + parts.slice(1).join(" ") : " ");
          bookSuggestions.style.display = "none";
          scriptureInput.focus(); // Refocus on input after selection
          updateVersesDisplay();
        };
        bookSuggestions.appendChild(li);
      });
    } else {
      bookSuggestions.style.display = "none";
    }
  }

  function updateVersesDisplay() {
    scriptureInput.value = normalizeScriptureReference(scriptureInput.value);
    const { book, chapter, verse } = parseScriptureReference(
      scriptureInput.value,
    );

    fetchVerses(book, chapter + "", verse + "");
  }

  function fetchVerses(book, chapter, verse) {
    versesDisplay.innerHTML = ""; // Clear previous verses
    const textData = bibleAPI.getText("KJV", book, chapter);
    if (textData && textData.verses) {
      textData.verses.forEach((verseText, index) => {
        const verseNumber = index + 1;
        const p = document.createElement("p");
        p.innerHTML = `<strong>${chapter}:${verseNumber}</strong> ${verseText}`;
        p.style.cursor = "pointer";
        p.addEventListener("dblclick", () => {
          highlightVerse(p);
          scriptureInput.value = `${book} ${chapter}:${verseNumber}`;
        });
        versesDisplay.appendChild(p);
        if (verse && parseInt(verse) === verseNumber) {
          highlightVerse(p, true); // Pass true to indicate scrolling is needed
        }
      });
    }
  }

  function highlightVerse(p, scrollToView = false) {
    if (lastHighlighted) {
      lastHighlighted.style.background = ""; // Remove previous highlight
    }
    p.style.background = "yellow"; // Highlight the new verse
    lastHighlighted = p;
    if ([scrollToView]) {
      p.scrollIntoView({ behavior: "smooth", block: "center" }); // Scroll to make the highlighted verse centered
    }
  }

  document.addEventListener("click", function (event) {
    if (
      !bookSuggestions.contains(event.target) &&
      event.target !== scriptureInput
    ) {
      bookSuggestions.style.display = "none";
    }
  });
}

/**
 * Persistent preview stash.
 *
 * Switching tabs replaces #dyneForm's children, which would otherwise destroy
 * the live <video id="preview"> element and reset its playback state along
 * with every listener that drives the projection (media) window over IPC
 * (`seekLocalMedia`, `pauseLocalMedia`, `playLocalMedia`, `timeGoto-message`,
 * `play-ctl`, ...). Before wiping the form we move the preview element (and
 * any sibling <img id="preview"> created by the image path) into a hidden
 * host attached to <body>, then swap it back in for the freshly-rendered
 * placeholder when the new tab finishes rendering. Because the node never
 * leaves the document, playback continues uninterrupted, every listener
 * keeps firing, and seek/pause/play in the preview keeps driving the
 * projection window the same way it did before the tab switch.
 */

function getOrCreatePreviewStash() {
  let stash = document.getElementById(PREVIEW_STASH_ID);
  if (stash) return stash;

  stash = document.createElement("div");
  stash.id = PREVIEW_STASH_ID;
  stash.setAttribute("aria-hidden", "true");
  // Keep it in the DOM (so HTMLMediaElement playback survives) but invisible
  // and non-interactive so it cannot intercept layout, focus, or hit-testing.
  stash.style.cssText =
    "position: fixed; left: -100000px; top: -100000px;" +
    "width: 1px; height: 1px;" +
    "pointer-events: none; visibility: hidden;" +
    "contain: strict;";
  document.body.appendChild(stash);
  return stash;
}

function stashLivePreview() {
  const dyne = document.getElementById("dyneForm");
  if (!dyne) return;
  const stash = getOrCreatePreviewStash();
  // Match by tag+id so we never sweep stray elements that happen to share id.
  // Image-mode previews leave a hidden <video id="preview"> next to the
  // visible <img id="preview"> — both must travel together so re-entering
  // Media mode finds the same elements in the same order.
  const persistentEls = dyne.querySelectorAll(
    'video#preview, img#preview',
  );
  for (const el of persistentEls) {
    if (el.parentNode !== stash) {
      stash.appendChild(el);
    }
  }
}

/**
 * Ensure the two persistent tab shells exist under `#dyneForm`. Destroyed when
 * switching to Text mode (`cleanRefs({ fullDestroy })`), recreated here on next
 * Media/Streams visit.
 */
function ensureDyneTabShell() {
  const dyne = document.getElementById("dyneForm");
  if (!dyne) return;
  if (!document.getElementById(TAB_PANEL_MEDIA_ID)) {
    dyne.innerHTML =
      `<div id="${TAB_PANEL_MEDIA_ID}" class="tab-panel tab-panel--media"></div>` +
      `<div id="${TAB_PANEL_STREAMS_ID}" class="tab-panel tab-panel--streams" hidden></div>`;
  }
}

function generateStreamsPanelHTML() {
  return `
    <div class="media-container">
        <div class="video-wrapper stream-preview-host" aria-hidden="true"></div>
        <div class="control-panel">
            <div class="control-group">
                <span class="control-label">URL</span>
                <input type="url"
                       name="mdFile"
                       id="mdFile"
                       placeholder="Paste your video URL here..."
                       class="url-input"
                       accept="video/mp4,video/x-m4v,video/*,audio/x-m4a,audio/*">
            </div>

            <div class="control-group">
                <span class="control-label">Display</span>
                <select name="dspSelctStreams" id="dspSelctStreams" class="display-select">
                    <option value="" disabled>Select Display</option>
                </select>
            </div>

            <div class="control-group">
                <span class="control-label">Volume</span>
                <div class="volume-control">
                    <input
                    id="volume-slider"
                    class="volume-slider"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value="1"
                    >
                </div>
            </div>
        </div>
    </div>
    `;
}

function ensureMediaPanelBuilt() {
  ensureDyneTabShell();
  const panel = document.getElementById(TAB_PANEL_MEDIA_ID);
  if (!panel || panel.dataset.mediaShellBuilt === "1") {
    return;
  }
  panel.innerHTML = generateMediaFormHTML(video);
  panel.dataset.mediaShellBuilt = "1";
}

function ensureStreamsPanelBuilt() {
  ensureDyneTabShell();
  const panel = document.getElementById(TAB_PANEL_STREAMS_ID);
  if (!panel || panel.dataset.streamsShellBuilt === "1") {
    return;
  }
  panel.innerHTML = generateStreamsPanelHTML();
  panel.dataset.streamsShellBuilt = "1";
  const vol = panel.querySelector("#volume-slider");
  if (vol && panel.dataset.streamsVolumeBound !== "1") {
    panel.dataset.streamsVolumeBound = "1";
    vol.addEventListener("input", handleVolumeChange);
  }
}

function getPreviewMountWrapperForPanel(panelEl) {
  if (!panelEl) return null;
  const streamHost = panelEl.querySelector(".stream-preview-host");
  if (streamHost) return streamHost;
  const mediaWrap = panelEl.querySelector(".video-wrapper");
  if (mediaWrap && !mediaWrap.classList.contains("stream-preview-host")) {
    return mediaWrap;
  }
  const legacyPreview = panelEl.querySelector("video#preview");
  return legacyPreview?.parentElement ?? null;
}

/**
 * Move the stashed live preview (`video#preview` / `img#preview`) into the
 * given tab panel. Streams uses an empty `.stream-preview-host` (no duplicate
 * `#preview` ids while both shells exist); Media uses `.video-wrapper` with a
 * placeholder `<video id="preview">` from `generateMediaFormHTML`, or inserts one
 * if the wrapper was left empty after a stash.
 */
function restoreLivePreviewIntoPanel(panelEl) {
  const stash = document.getElementById(PREVIEW_STASH_ID);
  if (!stash || !panelEl) return false;

  const wrapper = getPreviewMountWrapperForPanel(panelEl);
  if (!wrapper) return false;

  const stashedVideo = stash.querySelector("video#preview");
  const stashedImg = stash.querySelector("img#preview");
  const isStreamsLayout = wrapper.classList.contains("stream-preview-host");

  if (stashedVideo) {
    if (isStreamsLayout) {
      const orphan = wrapper.querySelector("video#preview");
      if (orphan && orphan !== stashedVideo) {
        orphan.remove();
      }
      if (stashedVideo.parentNode !== wrapper) {
        wrapper.appendChild(stashedVideo);
      }
    } else {
      let placeholder = wrapper.querySelector("video#preview");
      if (!placeholder) {
        placeholder = document.createElement("video");
        placeholder.id = "preview";
        placeholder.disablePictureInPicture = true;
        const cue = wrapper.querySelector("#previewCue");
        const cnt = wrapper.querySelector("#mediaCntDn");
        if (cue && cue.parentNode === wrapper) {
          wrapper.insertBefore(placeholder, cue);
        } else if (cnt && cnt.parentNode === wrapper) {
          cnt.insertAdjacentElement("afterend", placeholder);
        } else {
          wrapper.prepend(placeholder);
        }
      }
      if (placeholder !== stashedVideo) {
        wrapper.replaceChild(stashedVideo, placeholder);
      }
    }
  } else if (isStreamsLayout && !wrapper.querySelector("video#preview")) {
    const v = document.createElement("video");
    v.id = "preview";
    v.disablePictureInPicture = true;
    wrapper.appendChild(v);
  }

  if (stashedImg) {
    const orphanImg = wrapper.querySelector("img#preview");
    if (orphanImg && orphanImg !== stashedImg) {
      orphanImg.remove();
    }
    if (stashedImg.parentNode !== wrapper) {
      wrapper.appendChild(stashedImg);
    }
  }

  return Boolean(wrapper.querySelector("video#preview"));
}

/**
 * Restore stashed preview into whichever shell matches `currentMode`, or fall
 * back to scanning `#dyneForm` for legacy layouts (e.g. Text mode teardown).
 */
function restoreLivePreview() {
  const panel =
    currentMode === STREAMPLAYER
      ? document.getElementById(TAB_PANEL_STREAMS_ID)
      : document.getElementById(TAB_PANEL_MEDIA_ID);
  if (panel) {
    return restoreLivePreviewIntoPanel(panel);
  }
  const dyne = document.getElementById("dyneForm");
  return dyne ? restoreLivePreviewIntoPanel(dyne) : false;
}

function generateMediaFormHTML(video = null) {
  return `
  <div class="media-container">
    <form onsubmit="return false;" class="control-panel control-panel--media">
      <!--
        Compact, merged status card. The previous Live Output + Preview/Cue
        cards stacked two full Adwaita boxed sections (each with a 14px title
        and 6px gaps) before the queue ever appeared. On a 960×548 window the
        queue had ~120px of usable height — barely two rows. Merging both into
        a single "Presentation" card with key/value rows reclaims roughly
        70px for the queue at the same window size without losing any state
        or action the operator needs.
      -->
      <section class="presentation-status-card" aria-label="Presentation status">
        <span class="presentation-status-card__heading">Presentation</span>
        <div class="presentation-status-row">
          <span class="presentation-status-row__label">Now:</span>
          <span id="nowPlayingLabel" class="presentation-status-row__value">Nothing live</span>
        </div>
        <div class="presentation-status-row">
          <span class="presentation-status-row__label">Next:</span>
          <span id="upNextLabel" class="presentation-status-row__value">No item cued</span>
        </div>
        <!--
          The cue start position used to live in a third "Start: 2:24.172"
          row here, but that duplicated the per-item "Starts 2:24.172" badge
          rendered inside the queue row itself. One source of truth (the
          queue row) is enough; the card stays compact for small screens.
        -->
        <div class="cue-button-row">
          <button type="button" id="cueCurrentPositionBtn" class="pill-button secondary" title="Cue from current position" aria-label="Cue from current position" disabled>Cue</button>
          <button type="button" id="playCueNowBtn" class="pill-button secondary" disabled>Play Now</button>
        </div>
      </section>

      <!--
        Queue is the dominant sidebar content per GNOME HIG adaptive guidance:
        primary task surface fills the space, secondary controls (output
        selector, switches) sit below in a collapsed expander so the queue
        gets every spare pixel.
      -->
      <div class="queue-section">
        <div class="list-header">
          <span class="queue-section-title">Media Queue</span>
          <button type="button" id="clearQueueBtn" class="pill-button destructive-action" title="Clear the queue" aria-label="Clear queue" hidden>Clear</button>
        </div>
        <div id="mediaQueueList" class="boxed-list" role="list" aria-label="Media queue">
          <div class="list-placeholder">
            <span class="list-placeholder-title">No media in queue</span>
            <span class="list-placeholder-hint">Add media to begin</span>
          </div>
        </div>
      </div>

      <!--
        Settings expander: Output Display, Autoplay, Auto-advance. Collapsed
        by default to maximize queue real estate; open-state is persisted to
        localStorage so users who routinely toggle the switches don't have
        to re-expand each session.
      -->
      <details class="options-expander" id="mediaOptionsExpander">
        <summary class="options-expander__summary">
          <span class="options-expander__title">Settings</span>
          <svg class="options-expander__chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M6 4l4 4-4 4"/>
          </svg>
        </summary>
        <div class="options-expander__body">
          <div class="control-group">
            <span class="control-label">Output Display</span>
            <div class="display-select-group">
              <select name="dspSelct" id="dspSelct" class="display-select">
                <option value="" disabled>--Select Display Device--</option>
              </select>
            </div>
          </div>

          <div class="control-group media-toggle-rows">
            <div class="loop-control">
              <span class="control-label">Autoplay</span>
              <label class="switch">
                <input type="checkbox" checked name="autoPlayCtl" id="autoPlayCtl">
                <span class="switch-track"></span>
                <span class="switch-thumb"></span>
              </label>
            </div>
            <div class="loop-control queue-auto-advance-control">
              <span class="control-label" id="queueAutoAdvanceLbl">Auto-advance</span>
              <label class="switch">
                <input type="checkbox" checked name="queueAutoAdvanceCtl" id="queueAutoAdvanceCtl" aria-labelledby="queueAutoAdvanceLbl">
                <span class="switch-track"></span>
                <span class="switch-thumb"></span>
              </label>
            </div>
          </div>
        </div>
      </details>
    </form>

    <div class="video-wrapper">
      <div id="mediaCntDn"></div>
      <video id="preview" disablePictureInPicture controls=false></video>
      <!--
        Dedicated cue scrub element. The main #preview element used to be
        re-loaded with the cued media's src when the operator clicked a
        non-live queue item, which forcibly paused the live mirror. With
        a separate #previewCue overlay the main mirror keeps playing
        uninterrupted while the operator scrubs the cued item on top of
        it. Hidden by default; revealed only while a video cue is loaded.
      -->
      <!--
        controls is a boolean HTML attribute: any value (even "false") turns
        the native scrubber on. We omit the attribute entirely and re-assert
        controls=false in JS (see ensurePreviewCueVideoElement) so the
        operator never sees two scrubbers — the custom controls bar and the
        browser's stock <video> chrome — stacked on top of each other.
      -->
      <video id="previewCue" class="preview-cue-overlay" disablePictureInPicture muted hidden></video>
      <div id="previewEmptyState" class="preview-empty-state" hidden>
        <div class="preview-empty-state__card" role="button" tabindex="0" aria-label="Add media to queue">
          <svg class="preview-empty-state__icon" width="48" height="48" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
                  d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>
            <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                  d="M12 11v6M9 14h6"/>
          </svg>
          <span class="preview-empty-state__title">Drop media here</span>
          <span class="preview-empty-state__hint">or click <strong>Add Media</strong></span>
        </div>
      </div>
      <div id="audioCuePanel" class="audio-cue-panel" hidden>
        <div class="audio-cue-icon" aria-hidden="true">Audio</div>
        <div class="audio-cue-copy">
          <span class="audio-cue-heading">Preview / Cue Audio Track</span>
          <span id="audioCueTitle" class="audio-cue-title"></span>
          <span id="audioCueStart" class="audio-cue-start">Start from: 0:00.000</span>
          <span id="audioCueHelp" class="audio-cue-help">Scrubbing is silent so the live output is not interrupted.</span>
        </div>
      </div>

      <div id="customControls" class="controls-overlay">

        <button class="control-button custom-media-control" id="mediaWindowRepeatButton" title="Repeat (Toggle Loop)">
            <svg viewBox="0 0 24 24">
                <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v3z"/>
            </svg>
        </button>

        <button class="control-button" id="playPauseBtn">
            <svg viewBox="0 0 24 24" id="playPauseIcon"><path d="M8 5v14l11-7z"/></svg>
        </button>

        <span class="time-display" id="currentTime">0:00</span>
        <input type="range" min="0" max="100" value="0" step="0.1" class="timeline-slider" id="timeline">
        <span class="time-display" id="durationTime">0:00</span>

        <div class="gtk-volume-popover" id="gtkVolPopover">
        <button class="gtk-control-btn" id="gtkVolBtn" aria-label="Volume">
            <svg id="gtkVolIcon" viewBox="0 0 16 16" fill="currentColor">
                <path d="M 1 5 L 4 5 L 7 2 L 7 14 L 4 11 L 1 11 Z"/>
                <path d="M 9 7.5 C 9.5 7.5 9.5 8.5 9 8.5" fill="none" stroke="currentColor" stroke-width="1" id="arc1"/>
                <path d="M 10 6 C 11 6 11 10 10 10" fill="none" stroke="currentColor" stroke-width="1" id="arc2"/>
                <path d="M 12 4 C 14 4 14 12 12 12" fill="none" stroke="currentColor" stroke-width="1" id="arc3"/>
            </svg>
        </button>

          <div class="gtk-volume-slider-container">
            <input id="gtkVolSlider"
                   type="range"
                   min="0" max="100" value="100"
                   step="1"
                   orient="vertical"
                   class="gtk-volume-slider-vertical">
          </div>
        </div>

      </div>
    </div>
  </div>`;
}

function installDisplayChangeHandler() {
  if (installDisplayChangeHandler.initialized) return;

  on("display-changed", async () => {
    await populateDisplaySelect({ force: true });
  });

  installDisplayChangeHandler.initialized = true;
}

/**
 * `get-platform` cannot change without an app restart — caching avoids an IPC
 * round-trip on every Media-tab activation after the operator has been using
 * Streams or letting playback run in the background.
 */
let cachedGetPlatformPromise = null;
function getCachedPlatformOS() {
  if (!cachedGetPlatformPromise) {
    cachedGetPlatformPromise = invoke("get-platform").catch((err) => {
      cachedGetPlatformPromise = null;
      throw err;
    });
  }
  return cachedGetPlatformPromise;
}

function loopCtlHandler(event) {
  // Queue presentation relies on `ended` events to advance/slipstream, so
  // per-item looping must be suppressed while the queue is actively playing.
  if (isQueuePlaying) {
    video.loop = false;
    event.target.checked = false;
    if (isActiveMediaWindow()) {
      invoke("set-media-loop-status", false);
    }
    return;
  }

  video.loop = event.target.checked;
  if (isActiveMediaWindow()) {
    invoke("set-media-loop-status", event.target.checked);
  }
}

function setSBFormMediaPlayer() {
  if (currentMode === MEDIAPLAYER) {
    return;
  }
  currentMode = MEDIAPLAYER;
  send("set-mode", currentMode);
  updateHeaderAddMediaButtonVisibility();

  ensureMediaPanelBuilt();

  const streamsPanel = document.getElementById(TAB_PANEL_STREAMS_ID);
  const mediaPanel = document.getElementById(TAB_PANEL_MEDIA_ID);
  if (streamsPanel) streamsPanel.hidden = true;
  if (mediaPanel) mediaPanel.hidden = false;

  restoreLivePreviewIntoPanel(mediaPanel);

  const mediaCntDnEl = document.getElementById("mediaCntDn");
  if (mediaCntDnEl && textNode && !mediaCntDnEl.contains(textNode)) {
    mediaCntDnEl.appendChild(textNode);
  }
  installDisplayChangeHandler();
  populateDisplaySelect();

  if (video === null) {
    video = document.getElementById("preview");
  } else {
    restoreMediaFile();
    updateTimestamp();
  }
  getCachedPlatformOS()
    .then((operatingSystem) => {
      if (video && video !== cubicWaveShaperAttachedVideo) {
        attachCubicWaveShaper(video, undefined, undefined, operatingSystem);
        cubicWaveShaperAttachedVideo = video;
      }
    })
    .catch((error) => {
      console.error("Failed to get platform, skipping audio setup:", error);
    });

  installMediaOpenButton();
  installPreviewEmptyStateHandlers();
  installMediaOptionsExpander();
  const clearQueueBtn = document.getElementById("clearQueueBtn");
  if (clearQueueBtn && clearQueueBtn.dataset.clearBound !== "1") {
    clearQueueBtn.dataset.clearBound = "1";
    clearQueueBtn.addEventListener("click", onClearMediaQueueClick);
  }
  installMediaQueueListDelegation();
  installCueButtonHandlers();
  renderQueue();
  const isActiveMW = isActiveMediaWindow();
  if (!isActiveMW && !playingMediaAudioOnly) {
    isPlaying = false;
  } else {
    isPlaying = true;
  }
  updateDynUI();
  video.controls = false;
  let isImgFile;
  if (document.getElementById("preview").parentNode !== null) {
    if (!masterPauseState && video !== null && !video.paused) {
      if (!isImg(mediaFile)) {
        void playVideoSafely(video, "resume after media tab switch");
      }
    }
    if (video !== null) {
      if (!isActiveMW && mediaPlayerInputState.filePaths.length > 0) {
        mediaFile = mediaPlayerInputState.filePaths[0];
      }
      isImgFile = isImg(mediaFile);
      if (isActiveMW && mediaFile !== null && !isLiveStream(mediaFile)) {
        if (video === null) {
          video = document.getElementById("preview");
          saveMediaFile();
        }
        if (video) {
          if (targetTime !== null) {
            if (!masterPauseState && !isImgFile) {
              void playVideoSafely(video, "restore active media preview");
            }
          }
        }
      }
      const livePreview = document.getElementById("preview");
      // After `restoreLivePreview` ran, the placeholder has already been
      // replaced with the persistent element, so `livePreview === video`
      // and a self-replace would needlessly detach the playing element.
      if (livePreview && livePreview !== video) {
        livePreview.parentNode.replaceChild(video, livePreview);
      }
    }
  }

  if (isImgFile && !document.querySelector("img")) {
    img = document.createElement("img");
    video.removeAttribute("src");
    video.load();
    const overlay = document.getElementById("customControls");
    overlay.style.visibility = "hidden";
    img.src = mediaFile;
    img.setAttribute("id", "preview");
    document.getElementById("preview").style.display = "none";
    document.getElementById("preview").parentNode.appendChild(img);
    return;
  }
  setupCustomMediaControls();
  setupGtkVolumeControl();
  if (isFinite(video.duration) && video.duration > 0) {
    setupCustomMediaControls.updateControlsForMetadata?.(video);
    timelineSync();
  } else if (isQueuePlaying && isActiveMediaWindow()) {
    // Slipstream in progress: loadedmetadata may have already fired while
    // the controls listener was absent (aborted during the tab switch away).
    // Re-attach a one-shot listener now so the controls reveal when it fires.
    video.addEventListener(
      "loadedmetadata",
      () => {
        setupCustomMediaControls.updateControlsForMetadata?.(video);
        timelineSync();
      },
      { once: true },
    );
  }
  if (encodeURI(mediaFile) !== removeFileProtocol(video.src)) {
    saveMediaFile();
  }

  if (currentMode == MEDIAPLAYER && isImg(mediaFile)) {
    if (document.getElementById("preview")) {
      document.getElementById("preview").style.display = "none";
    }
    img = document.createElement("img");
    video.removeAttribute("src");
    video.load();
    const overlay = document.getElementById("customControls");
    overlay.style.visibility = "hidden";
    img.src = mediaFile;
    img.setAttribute("id", "preview");
    document.getElementById("preview").style.display = "none";
    document.getElementById("preview").parentNode.appendChild(img);
  }
}

function removeFileProtocol(filePath) {
  return filePath.slice(7);
}

function saveMediaFile() {
  resetPreviewWarningState();
  textNode.data = "";
  const mdfileElement = document.getElementById("mdFile");
  if (mediaPlayerInputState.filePaths.length < 1) {
    if (!mdfileElement && mediaQueue.length === 0) {
      return;
    }
    const filesLen = mdfileElement?.files?.length ?? 0;
    const val = mdfileElement?.value ?? "";
    const hasPickerSelection =
      filesLen > 0 || (val !== "" && val !== undefined);
    if (!hasPickerSelection && mediaQueue.length === 0) {
      return;
    }
  }

  if (playingMediaAudioOnly && currentMode === MEDIAPLAYER) {
    const f0 = mdfileElement?.files?.[0];
    if (f0 != null && f0.length > 0) {
      showGnomeToast("File queued for playback");
      mediaFile = getPathForFile(f0);
      return;
    }
    if (mediaQueue.length > 0) {
      const qi =
        currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
          ? currentQueueIndex
          : 0;
      showGnomeToast("File queued for playback");
      mediaFile = mediaQueue[qi].path;
      return;
    }
    return;
  }

  if (mdfileElement !== null && mdfileElement !== "undefined") {
    const val = mdfileElement.value ?? "";
    if (
      (val === "" || val === undefined) &&
      mediaQueue.length === 0 &&
      mediaPlayerInputState.filePaths.length === 0
    ) {
      return;
    }

    mediaPlayerInputState.clear();
    if (isActiveMediaWindow() || (audioOnlyFile && video && !video.paused)) {
      showGnomeToast("File queued for playback");
    }

    if (mediaQueue.length > 0) {
      const qi =
        currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
          ? currentQueueIndex
          : 0;
      mediaPlayerInputState.filePaths = [mediaQueue[qi].path];
    }
    mediaPlayerInputState.urlInpt = val.toLowerCase();
  } else if (mediaQueue.length > 0) {
    const qi =
      currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
        ? currentQueueIndex
        : 0;
    if (isActiveMediaWindow() || (audioOnlyFile && video && !video.paused)) {
      showGnomeToast("File queued for playback");
    }
    mediaPlayerInputState.filePaths = [mediaQueue[qi].path];
  }
  const isActiveMW = isActiveMediaWindow();
  if (isActiveMW) {
    return;
  }

  mediaFile =
    currentMode === STREAMPLAYER
      ? document.getElementById("mdFile").value
      : mediaPlayerInputState.filePaths[0];

  if (mediaFile) {
    const fileNameSpan = document.querySelector(".file-input-label span");
    if (fileNameSpan) {
      fileNameSpan.textContent = getHostnameOrBasename(mediaFile);
      fileNameSpan.title = getHostnameOrBasename(mediaFile);
    }
  }

  let imgEle = null;
  if ((imgEle = document.querySelector("img"))) {
    imgEle.remove();
    imgEle.src = "";
    document.getElementById("preview").style.display = "";
  }
  let iM;
  if ((iM = isImg(mediaFile))) {
    playingMediaAudioOnly = false;
    audioOnlyFile = false;
  }

  if (iM && !document.querySelector("img") && !isActiveMW) {
    let imgEle = null;
    if ((imgEle = document.querySelector("img")) !== null) {
      imgEle.remove();
      imgEle.src = "";
      if (video) {
        video.style.display = "none";
      }
    }
    img = document.createElement("img");
    video.removeAttribute("src");
    video.load();
    const overlay = document.getElementById("customControls");
    overlay.style.visibility = "hidden";
    img.src = mediaFile;
    img.setAttribute("id", "preview");
    document.getElementById("preview").style.display = "none";
    document.getElementById("preview").parentNode.appendChild(img);
    showPreviewWarningToast();
    return;
  }
  let liveStream = isLiveStream(mediaFile);
  const hasLocalSelection =
    currentMode === MEDIAPLAYER &&
    (mediaPlayerInputState.filePaths.length > 0 || mediaQueue.length > 0);
  if (
    (hasLocalSelection && !isActiveMW && !liveStream) ||
    (isActiveMW && mdfileElement !== null && liveStream) ||
    (activeLiveStream && isActiveMW)
  ) {
    if (video === null) {
      video = document.getElementById("preview");
    }
    if (video) {
      if (hasLocalSelection && prePathname !== mediaFile) {
        prePathname = mediaFile;
        startTime = 0;
      }
      if (!playingMediaAudioOnly && hasLocalSelection) {
        let uncachedLoad;
        if (
          (uncachedLoad =
            normalizeMediaPathForCompare(mediaFile) !==
            normalizeMediaPathForCompare(video.src))
        ) {
          video.setAttribute("src", mediaFile);
        }
        video.id = "preview";
        if (
          prePathname === mediaFile &&
          Number.isFinite(video.currentTime) &&
          video.currentTime > 0
        ) {
          startTime = video.currentTime;
          targetTime = startTime;
        }
        video.currentTime = startTime;
        video.controls = false;
        if (uncachedLoad) {
          video.load();
        }
      }
    }
  }
}

function restoreMediaFile() {
  // Don't attempt to set the file input value directly
  // Just ensure mediaFile is set if we have paths stored
  if (mediaPlayerInputState.filePaths.length > 0) {
    if (
      currentMode === STREAMPLAYER &&
      document.getElementById("mdFile") &&
      mediaPlayerInputState.urlInpt
    ) {
      document.getElementById("mdFile").value = mediaPlayerInputState.urlInpt;
    } else if (
      currentMode === MEDIAPLAYER &&
      !playingMediaAudioOnly &&
      !isActiveMediaWindow()
    ) {
      mediaFile = mediaPlayerInputState.filePaths[0];
      // Update the UI label if it exists
      const fileNameSpan = document.querySelector(".file-input-label span");
      if (fileNameSpan) {
        fileNameSpan.textContent = getHostnameOrBasename(mediaFile);
      }
    }
  }
}

function shortcutHandler(event) {
  if (event.key === "F1" || event.code === "F1") {
    invoke("open-help-window");
  }
  if (
    (event.key === "F5" || event.code === "F5") &&
    !isActiveMediaWindow() &&
    !playingMediaAudioOnly
  ) {
    playMedia();
  }
  if (
    (event.key === "Escape" || event.code == "Escape") &&
    (isActiveMediaWindow() || audioOnlyFile)
  ) {
    playMedia();
  }
  if (event.ctrlKey || event.metaKey) {
    if (event.key === "o" || event.key === "O") {
      if (currentMode === MEDIAPLAYER) {
        void openMediaFilesDialog();
      } else {
        const stream = document.getElementById("mdFile");
        if (stream && typeof stream.focus === "function") {
          stream.focus();
        }
      }
    }

    if (event.key === "q" || event.key === "Q") {
      close();
    }
  }
}

function modeSwitchHandler(event) {
  if (event.target.type === "radio") {
    if (event.target.value === "Media Player") {
      installPreviewEventHandlers();
      updateTimestamp();
    }
  }
}

function cleanRefs(options = {}) {
  if (!options.fullDestroy) {
    return;
  }

  const vol = document.getElementById("volume-slider");
  if (vol) {
    vol.removeEventListener("input", handleVolumeChange);
  }

  const streamsPanel = document.getElementById(TAB_PANEL_STREAMS_ID);
  if (streamsPanel) {
    delete streamsPanel.dataset.streamsVolumeBound;
    delete streamsPanel.dataset.streamsShellBuilt;
  }

  const mediaPanel = document.getElementById(TAB_PANEL_MEDIA_ID);
  if (mediaPanel) {
    delete mediaPanel.dataset.mediaShellBuilt;
  }

  const clearQueueBtn = document.getElementById("clearQueueBtn");
  if (clearQueueBtn && clearQueueBtn.dataset.clearBound === "1") {
    clearQueueBtn.removeEventListener("click", onClearMediaQueueClick);
    delete clearQueueBtn.dataset.clearBound;
  }

  const mcd = document.getElementById("mediaCntDn");
  if (mcd && mcd.contains(textNode)) {
    mcd.removeChild(textNode);
  }

  if (setupCustomMediaControls.controller) {
    try {
      setupCustomMediaControls.controller.abort();
    } catch {
      /* ignore */
    }
  }

  playPauseBtn = null;
  playPauseIcon = null;
  timeline = null;
  currentTimeDisplay = null;
  durationTimeDisplay = null;
  repeatButton = null;

  stashLivePreview();
  clearVideoPreviewCueOverlay();
  previewCueVideo = null;

  document.getElementById("dyneForm").innerHTML = "";
}

function installEvents() {
  document.getElementById("MdPlyrRBtnFrmID").addEventListener(
    "click",
    () => {
      if (currentMode === MEDIAPLAYER) {
        return;
      }
      if (currentMode === STREAMPLAYER) {
        stashLivePreview();
      } else if (currentMode === TEXTPLAYER) {
        cleanRefs({ fullDestroy: true });
      }
      if (mediaFile != null && mediaFile != "" && !isLiveStream(mediaFile)) {
        preModeChangeFixups();
      }
      setSBFormMediaPlayer();
    },
    { passive: true },
  );

  document.getElementById("YtPlyrRBtnFrmID").addEventListener(
    "click",
    () => {
      if (currentMode === STREAMPLAYER) {
        return;
      }
      if (currentMode === MEDIAPLAYER) {
        if (setupCustomMediaControls.controller) {
          try {
            setupCustomMediaControls.controller.abort();
          } catch {
            /* ignore */
          }
        }
        stashLivePreview();
        clearVideoPreviewCueOverlay();
        previewCueVideo = null;
      } else if (currentMode === TEXTPLAYER) {
        cleanRefs({ fullDestroy: true });
      }
      setSBFormStreamPlayer();
    },
    { passive: true },
  );

  document.getElementById("TxtPlyrRBtnFrmID")?.addEventListener(
    "click",
    () => {
      if (currentMode === TEXTPLAYER) {
        return;
      }
      cleanRefs({ fullDestroy: true });
      setSBFormTextPlayer();
    },
    { passive: true },
  );

  document.addEventListener("keydown", shortcutHandler, { passive: true });
  document
    .querySelector("form")
    .addEventListener("change", modeSwitchHandler, { passive: true });
}

function playLocalMedia(event) {
  if (currentMode !== MEDIAPLAYER) {
    return;
  }

  syncPreviewAudioTrackState();
  mediaSessionPause = false;
  if (
    !audioOnlyFile &&
    video.readyState &&
    mediaElementLoadedAudioOnly(video, mediaFile || video.src)
  ) {
    audioOnlyFile = true;
    if (currentMode === MEDIAPLAYER) {
      document.getElementById("customControls").style.visibility = "";
    }
  }
  if (shouldSuppressPreviewForwarding()) {
    updatePreviewCueUI();
    return;
  }
  if (audioOnlyFile) {
    if (!isQueuePlaying && currentMode === MEDIAPLAYER) {
      const queueIndex = findQueueIndexByPath(mediaFile || video.src);
      if (queueIndex >= 0) {
        currentQueueIndex = queueIndex;
        isQueuePlaying = true;
      } else if (mediaFile && mediaQueue.length === 0) {
        mediaQueue = [createQueueEntry(mediaFile)];
        currentQueueIndex = 0;
        isQueuePlaying = true;
      }
    }
    send("localMediaState", 0, "play");
    addFilenameToTitlebar(removeFileProtocol(decodeURI(video.src)));
    isPlaying = true;
    playingMediaAudioOnly = true;
    isActiveMediaWindowCache = false;
    syncPreviewAudioTrackState();
    updateDynUI();
    renderQueue();
    updateTimestamp();
  }
  if (isActiveMediaWindow()) {
    unPauseMedia(event);
    return;
  } else {
    if (!audioOnlyFile) showPreviewWarningToast();
  }

  let mediaScrnPlyBtn = document.getElementById("mediaWindowPlayButton");
  if (mediaScrnPlyBtn && audioOnlyFile) {
    if (isPlaying) {
      fileEnded = false;
      audioOnlyFile = true;
      if (document.getElementById("volumeControl")) {
        document.getElementById("customControls").style.visibility = "";
      }
      playingMediaAudioOnly = true;
      updateTimestamp();
      return;
    }
  }
  if (isImg(video.src)) {
    audioOnlyFile = false;
    playingMediaAudioOnly = false;
    return;
  }
  if (video.src === "") {
    event.preventDefault();
    return;
  }
  masterPauseState = false;
  updateTimestamp();
  if (audioOnlyFile) {
    if (document.getElementById("volumeControl")) {
      video.volume = document.getElementById("volumeControl").value;
    }
    playingMediaAudioOnly = true;
    return;
  }
}

function loadLocalMediaHandler(event) {
  if (pidController) {
    pidController.reset();
  }
  if (video.src === "") {
    event.preventDefault();
    return;
  }
}

function loadedmetadataHandler(e) {
  if (video.src === "" || isImg(video.src)) {
    return;
  }
  if (shouldSuppressPreviewForwarding()) {
    syncPreviewAudioTrackState();
    updatePreviewCueUI();
    return;
  }
  audioOnlyFile = mediaElementLoadedAudioOnly(video, mediaFile || video.src);
  syncPreviewAudioTrackState();
}

function seekLocalMedia(e) {
  if (pidSeeking) {
    // Critical: a PID-driven seek MUST NOT be echoed back to the
    // projection. Writing video.currentTime fires both `seeking` and
    // `seeked` (and sometimes extra settle events) — we do NOT reset
    // pidSeeking here, because the very next event would then see
    // pidSeeking=false and forward a timeGoto-message to the
    // projection, causing the projection to seek, which the next
    // time message reports back, which the PID corrects again, ad
    // infinitum. The visible symptom was the projection pausing /
    // glitching every few seconds, worst on the Streams tab where
    // the hidden preview drifts more and PID corrections fire more
    // often. beginPidSeekSuppression's timer is the single source of
    // truth for when the swallow window closes.
    e.preventDefault();
    return;
  }
  pidController.reset();
  if (video.src === "") {
    e.preventDefault();
    return;
  }
  // The old architecture re-used #preview as the cue scrub element, so a
  // seek here could mean "operator is dragging the cue scrubber" and was
  // forwarded to setCueStartTime. The new architecture keeps cue scrubs on
  // a dedicated overlay (previewCueVideo) with its own seek handler, so
  // any seek that lands here is either projection→preview sync or an
  // explicit user scrub of the live mirror — never a cue write.
  if (shouldSuppressPreviewForwarding()) {
    return;
  }
  if (e.target.isConnected) {
    send("timeGoto-message", {
      currentTime: e.target.currentTime,
      timestamp: Date.now(),
    });
    invoke("get-media-current-time").then((r) => {
      targetTime = r;
    });
  }
}

function seekingLocalMedia(e) {
  if (pidSeeking) {
    // See seekLocalMedia for the full rationale. The pidSeeking flag
    // is reset by beginPidSeekSuppression's timer, never by this
    // handler — otherwise the paired `seeked` event would slip
    // through and the projection feedback loop would be re-opened.
    e.preventDefault();
    return;
  }
  pidController.reset();
  if (video.src === "") {
    e.preventDefault();
    return;
  }
  if (shouldSuppressPreviewForwarding()) {
    return;
  }
  if (e.target.isConnected) {
    send("timeGoto-message", {
      currentTime: e.target.currentTime,
      timestamp: Date.now(),
    });
    invoke("get-media-current-time").then((r) => {
      targetTime = r;
    });
  }
}

function endLocalMedia() {
  textNode.data = "";

  // When queue playback is being projected in the media window, this local
  // preview <video> hitting "ended" is informational only. The authoritative
  // transition owner is the projection window's "media-playback-ended" IPC
  // path, which decides whether to slipstream or close.
  //
  // If we continue through this handler, we race that IPC path and corrupt
  // state (isPlaying/fileEnded/audioOnlyFile), leaving the app thinking the
  // media window stopped even when it is still alive.
  if (
    isQueuePlaying &&
    isActiveMediaWindow() &&
    video &&
    !playingMediaAudioOnly
  ) {
    mediaPlaybackEndedPending = true;
    void (async () => {
      try {
        const slipstreamed = await trySlipstreamNextQueueItem();
        if (slipstreamed) {
          return;
        }
        if (queueSlipstreamTransitionInProgress) {
          return;
        }
        if (isActiveMediaWindow()) {
          send("close-media-window", 0);
        }
      } catch (err) {
        console.error("Queue transition after preview end failed:", err);
        if (queueSlipstreamTransitionInProgress) {
          return;
        }
        if (isActiveMediaWindow()) {
          send("close-media-window", 0);
        }
      }
    })();
    return;
  }

  // When liveAudio is the live output, the preview <video> element may have
  // an audio file as its source purely for preview/seeking purposes. Its
  // "ended" event is irrelevant to the live presentation — liveAudio has its
  // own "ended" listener (endLiveAudioPresentation) that drives queue advance.
  // Guard only on whether liveAudio is *actually playing*; liveAudioQueueIndex
  // can be stale (set before a failed play() in playAudioOnlyLocally) and
  // must not block queue advance when audio never actually started.
  if (liveAudio?.paused === false) {
    return;
  }

  // Capture before flags get cleared: an audio-only queue item just ended
  // locally with no presentation window, so the normal media-window-closed
  // path will not run. We need to drive the queue advance ourselves.
  const wasAudioOnlyQueueItem =
    isQueuePlaying &&
    !isActiveMediaWindow() &&
    playingMediaAudioOnly &&
    video &&
    !video.loop;

  isPlaying = false;
  updateDynUI();
  audioOnlyFile = false;
  if (document.getElementById("mediaWindowPlayButton")) {
    updateDynUI();
  }
  if (playingMediaAudioOnly) {
    playingMediaAudioOnly = false;

    if (video !== null) {
      video.currentTime = 0;
    }

    if (document.getElementById("mediaWindowPlayButton") !== null) {
      updateDynUI();
    } else {
      document.getElementById("MdPlyrRBtnFrmID").addEventListener(
        "click",
        function () {
          updateDynUI();
        },
        { once: true },
      );
    }
    masterPauseState = false;
    saveMediaFile();
  }
  targetTime = 0;
  fileEnded = true;
  send("localMediaState", 0, "stop");
  // In queue+media-window mode the media-playback-ended IPC handler decides
  // whether to slipstream or close the window. Sending close-media-window here
  // would race and destroy the window before slipstream gets a chance.
  if (!(isQueuePlaying && isActiveMediaWindow())) {
    send("close-media-window", 0);
  }
  removeFilenameFromTitlebar();
  video?.pause();
  masterPauseState = false;
  resetPIDOnSeek();
  localTimeStampUpdateIsRunning = false;

  // Audio-only queue item finished: drive the same advance/stop logic that
  // handleMediaWindowClosed normally does when a real media window closes.
  if (wasAudioOnlyQueueItem) {
    if (currentPreviewCue() || isQueueAutoAdvanceEnabled()) {
      void advanceQueueAfterMediaWindowClosed().catch((err) =>
        console.error("Queue advance after audio-only end failed:", err),
      );
    } else {
      void stopQueuePresentationUserClosed().catch((err) =>
        console.error("Queue stop after audio-only end failed:", err),
      );
    }
  }
}

function pauseLocalMedia(event) {
  if (shouldSuppressPreviewForwarding()) {
    localTimeStampUpdateIsRunning = false;
    updatePreviewCueUI();
    return;
  }
  if (mediaSessionPause) {
    invoke("get-media-current-time").then((r) => {
      targetTime = r;
    });
    return;
  }
  if (fileEnded) {
    fileEnded = false;
    return;
  }
  if (audioOnlyFile && !isActiveMediaWindow()) {
    // When liveAudio is carrying the live presentation, a pause on the preview
    // <video> element (e.g. video.pause() called at the end of
    // playAudioOnlyLocally, or from a preview-load) must not reset the
    // presentation's isPlaying flag — liveAudio is still running.
    if (liveAudio?.paused === false || liveAudioQueueIndex >= 0) {
      localTimeStampUpdateIsRunning = false;
      syncPreviewAudioTrackState();
      return;
    }
    isPlaying = false;
    localTimeStampUpdateIsRunning = false;
    syncPreviewAudioTrackState();
    updateDynUI();
    return;
  }
  if (!event.target.isConnected) {
    // If the user explicitly stopped the presentation, let the pause stand.
    // `playMedia` clears `isPlaying` *before* calling `video.pause()`, so an
    // unset `isPlaying` here means this pause event came from Stop, not from
    // an incidental DOM reattachment during a tab switch.
    if (!isPlaying) return;
    if (!isActiveMediaWindow() && playingMediaAudioOnly === false) {
      return;
    }
    event.preventDefault();
    video
      .play()
      .then(() => {
        isPlaying = true;
        updateDynUI();
      })
      .catch((error) => {
        playingMediaAudioOnly = false;
      });

    masterPauseState = false;
    return;
  }
  if (event.target.clientHeight === 0) {
    // The Streams tab hosts the persistent <video> inside a wrapper with
    // `display: none`, so its `clientHeight` is always 0 there. Without this
    // guard, clicking the Stop button while on the Streams tab with an
    // audio-only file playing would re-trigger playback immediately, because
    // this branch was treating "hidden" as "incidentally detached, resume it".
    if (!isPlaying) return;
    event.preventDefault();
    void playVideoSafely(event.target, "detached media element resume");
    return;
  }
  if (video.src === "") {
    event.preventDefault();
    return;
  }
  if (activeLiveStream) {
    return;
  }
  if (video.currentTime - video.duration === 0) {
    return;
  }
  if (event.target.parentNode !== null) {
    if (isActiveMediaWindow()) {
      pauseMedia();
      masterPauseState = true;
    }
  }
}

function handleVolumeChange(event) {
  if (event.target.id === "volume-slider" && !isLiveStream(mediaFile)) {
    return;
  }
  if (currentMode === STREAMPLAYER) {
    streamVolume = event.target.value;
    vlCtl(streamVolume);
    return;
  }
  event.target.muted ? vlCtl(0) : vlCtl(event.target.volume);
}

function installPreviewEventHandlers() {
  if (!video) {
    return;
  }
  if (video.dataset.previewHandlersInstalled === "1") {
    return;
  }
  video.addEventListener("loadstart", loadLocalMediaHandler);
  video.addEventListener("loadedmetadata", loadedmetadataHandler);
  video.addEventListener("seeked", seekLocalMedia);
  video.addEventListener("seeking", seekingLocalMedia);
  video.addEventListener("ended", endLocalMedia);
  video.addEventListener("pause", pauseLocalMedia);
  video.addEventListener("play", playLocalMedia);
  video.addEventListener("volumechange", handleVolumeChange);
  video.dataset.previewHandlersInstalled = "1";
  pidController = new PIDController(video);
}

async function loadOpMode(mode) {
  const execute = async () => {
    try {
      // Show loading indicator
      const loadingDiv = document.createElement("div");
      loadingDiv.id = "loading-indicator";
      loadingDiv.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          z-index: 10000;
          color: #5c87b2;
          font-family: system-ui, -apple-system, sans-serif;
        `;
      loadingDiv.innerHTML = `
          <div class="spinner" style="
            width: 40px;
            height: 40px;
            border: 4px solid #f3f3f3;
            border-top: 4px solid #5c87b2;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 10px;
          "></div>
          <div>Loading...</div>
        `;

      // Add spinner animation
      if (!document.querySelector("#spinner-style")) {
        const style = document.createElement("style");
        style.id = "spinner-style";
        style.textContent = `
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `;
        document.head.appendChild(style);
      }

      document.body.appendChild(loadingDiv);

      await waitForPreloadBridge();

      // Wait for DOM to be stable
      await new Promise((r) => setTimeout(r, 0));

      // Remove loading indicator
      loadingDiv.remove();

      // Hamburger menu setup
      const hamburgerButton = document.getElementById("hamburgerMenuButton");
      const dropdownMenu = document.getElementById("gtkDropdownMenu");

      if (!hamburgerButton || !dropdownMenu) {
        throw new Error("Required DOM elements not found");
      }

      hamburgerButton.addEventListener("click", () => {
        dropdownMenu.classList.toggle("hidden");
      });

      // Close the menu when clicking outside
      document.addEventListener("click", (event) => {
        if (
          !hamburgerButton.contains(event.target) &&
          !dropdownMenu.contains(event.target)
        ) {
          dropdownMenu.classList.add("hidden");
        }
      });

      const menuItems = dropdownMenu.querySelectorAll(".menu-item");
      menuItems.forEach((item) => {
        item.addEventListener("click", () => {
          dropdownMenu.classList.add("hidden");
        });
      });

      // Window control functionality
      const minimizeButton = document.querySelector(".window-control.minimize");
      const maximizeButton = document.querySelector(".window-control.maximize");
      const closeButton = document.querySelector(".window-control.close");

      if (!minimizeButton || !maximizeButton || !closeButton) {
        throw new Error("Window control buttons not found");
      }

      minimizeButton.addEventListener("click", windowControls.minimize);
      maximizeButton.addEventListener("click", windowControls.maximize);
      closeButton.addEventListener("click", close);

      windowControls.onMaximizeChange((event, isMaximized) => {
        maximizeButton.setAttribute("data-maximized", isMaximized);
      });

      const headerPresentBtn = document.getElementById("mediaWindowPlayButton");
      if (headerPresentBtn && headerPresentBtn.dataset.presentBound !== "1") {
        headerPresentBtn.dataset.presentBound = "1";
        headerPresentBtn.addEventListener("click", playMedia, { passive: true });
      }

      // Mode setup
      if (mode === STREAMPLAYER) {
        document.getElementById("YtPlyrRBtnFrmID").checked = true;
        setSBFormStreamPlayer();
      } else if (mode === TEXTPLAYER) {
        document.getElementById("TxtPlyrRBtnFrmID").checked = true;

        // For text player, ensure Bible API is ready before initializing
        try {
          await window.electron.bibleAPI.waitForReady();
          setSBFormTextPlayer();
        } catch (error) {
          console.error("Failed to initialize Bible API:", error);
          // Fall back to media player mode
          document.getElementById("MdPlyrRBtnFrmID").checked = true;
          setSBFormMediaPlayer();
          installPreviewEventHandlers();
        }
      } else {
        document.getElementById("MdPlyrRBtnFrmID").checked = true;
        setSBFormMediaPlayer();
        installPreviewEventHandlers();
      }

      // Drag and drop: the renderer is the OS-level drop target (Electron does
      // not surface drop events to the main process). The renderer only
      // extracts native paths via webUtils.getPathForFile and then defers all
      // media-type filtering / validation to the main process via IPC.
      document.addEventListener("dragover", (event) => event.preventDefault());
      document.addEventListener("dragstart", (event) => {
        if (event.target.tagName === "IMG" || event.target.tagName === "A") {
          event.preventDefault();
        }
      });
      document.addEventListener("drop", async (event) => {
        event.preventDefault();
        const hasOSFiles =
          event.dataTransfer?.files?.length > 0 ||
          (event.dataTransfer?.types &&
            Array.from(event.dataTransfer.types).includes("Files"));
        if (!hasOSFiles) return;
        const paths = await extractAndFilterDroppedMediaPaths(
          event.dataTransfer,
        );
        if (paths.length > 0) {
          applyDroppedMediaPaths(paths);
        } else {
          console.warn("No valid media files were dropped.");
        }
      });

      console.log("Application initialized successfully");
    } catch (error) {
      console.error("Failed to initialize application:", error);

      // Show error message to user
      document.body.innerHTML = `
          <div style="
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            padding: 20px;
            background: white;
            border: 2px solid #d32f2f;
            border-radius: 8px;
            max-width: 400px;
          ">
            <h2 style="color: #d32f2f; margin-top: 0;">Initialization Error</h2>
            <p>${error.message}</p>
            <p style="font-size: 0.9em; color: #666;">
              Please try restarting the application.
            </p>
            <button onclick="location.reload()" style="
              padding: 8px 16px;
              background: #5c87b2;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              margin-top: 10px;
            ">Reload</button>
          </div>
        `;
    }
  };

  // Wait until DOM is ready, then execute
  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    await execute();
  } else {
    await new Promise((resolve) => {
      document.addEventListener(
        "DOMContentLoaded",
        async () => {
          await execute();
          resolve();
        },
        { once: true },
      );
    });
  }
}

function isLiveStream(mediaFile) {
  if (mediaFile === undefined || mediaFile === null) {
    return false;
  }
  return /(?:m3u8|mpd|youtube\.com|videoplayback|youtu\.be)/i.test(mediaFile);
}

async function endLiveAudioPresentation() {
  if (isHandlingLiveEnded) return;
  isHandlingLiveEnded = true;
  textNode.data = "";
  try {
    const wasAudioOnlyQueueItem =
      isQueuePlaying &&
      !isActiveMediaWindow() &&
      playingMediaAudioOnly &&
      !liveAudio?.loop;

    isPlaying = false;
    audioOnlyFile = false;
    playingMediaAudioOnly = false;
    liveAudioQueueIndex = -1;
    updateDynUI();
    send("localMediaState", 0, "stop");
    removeFilenameFromTitlebar();
    masterPauseState = false;
    localTimeStampUpdateIsRunning = false;

    if (wasAudioOnlyQueueItem) {
      if (currentPreviewCue() || isQueueAutoAdvanceEnabled()) {
        await advanceQueueAfterMediaWindowClosed();
        return;
      }
      await stopQueuePresentationUserClosed();
      return;
    }
  } catch (err) {
    console.error("Queue transition after audio-only end failed:", err);
  } finally {
    isHandlingLiveEnded = false;
  }
}

/**
 * Play the currently-loaded audio-only file in the local preview <video>
 * without creating a fullscreen media window. Audio-only files do not need
 * a presentation surface, and creating one (then having nothing visible)
 * confuses users and can race the window's open/close lifecycle.
 */
async function playAudioOnlyLocally() {
  resolveQueuePresentationVideo();
  const localVideo = video;
  if (!localVideo) return;
  const token = nextLiveStartToken();
  const audio = ensureLiveAudioElement();
  const source = mediaFile || removeFileProtocol(decodeURI(localVideo.src || ""));

  // The playback start position for an audio-only queue item is the explicit
  // cue start time on the queue entry (set by "Cue from Current Position").
  // Do NOT silently fall back to the preview <video> element's currentTime —
  // that value is only a *preview* scrub position. Using it as the playback
  // start causes the audio to start at, or one frame before, the file's end
  // whenever the operator has scrubbed near the end of the preview, which in
  // turn fires "ended" on liveAudio immediately and advances the queue. The
  // operator's mental model is: clicking Start plays the file from the start
  // (or from the cue point I explicitly set), not from wherever I last
  // scrubbed the preview to.
  const audioUrl = pathToMediaUrl(source);
  const queueCueStart =
    currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
      ? (mediaQueue[currentQueueIndex]?.cueStartTime || 0)
      : 0;
  const startAt = Number.isFinite(queueCueStart) && queueCueStart > 0
    ? queueCueStart
    : 0;

  audioOnlyFile = true;
  playingMediaAudioOnly = true;
  isPlaying = true;
  isActiveMediaWindowCache = false;
  liveAudioQueueIndex = currentQueueIndex;
  send("localMediaState", 0, "play");
  if (source) {
    try {
      addFilenameToTitlebar(source);
    } catch (err) {
      console.error("Failed to update titlebar for audio-only:", err);
    }
  }
  syncPreviewAudioTrackState();
  updateDynUI();
  try {
    if (normalizeMediaPathForCompare(audio.src) !== normalizeMediaPathForCompare(audioUrl)) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.src = audioUrl;
      audio.load();
      await waitForLoadedMetadata(audio);
    }
    if (token !== liveStartToken) return;
    if (Number.isFinite(startAt) && startAt > 0) {
      await seekMedia(audio, startAt);
    }
    if (token !== liveStartToken) return;
    audio.volume = localVideo.volume;
    audio.muted = false;
    await audio.play();
    if (token !== liveStartToken) return;
    localVideo.pause();
    // Immediately sync the custom controls to liveAudio's state so the user sees
    // correct duration, position, and play icon without waiting for the first
    // timeupdate event. This also handles the case where the liveAudio.loadedmetadata
    // event fired while video.src still pointed to a different file (preview mode).
    refreshLiveAudioControls();
  } catch (err) {
    console.error("Audio-only local playback failed:", err);
    // Playback failed — undo the live-audio state flags so that guards in
    // endLocalMedia and pauseLocalMedia don't treat this as an active
    // presentation and permanently block subsequent queue advances.
    if (token === liveStartToken) {
      liveAudioQueueIndex = -1;
      playingMediaAudioOnly = false;
      isPlaying = false;
      updateDynUI();
    }
  }
  updateTimestamp();
}

async function createMediaWindow(options) {
  const seekOnly = options && options.seekOnly === true;
  if (seekOnly) {
    itc = performance.now() * 0.001;
  }
  const isQueuePlaybackContext =
    isQueuePlaying &&
    currentQueueIndex >= 0 &&
    currentQueueIndex < mediaQueue.length;
  const ts = await invoke("get-system-time");
  let birth =
    ts.systemTime +
    (Date.now() - ts.ipcTimestamp) * 0.001 +
    (performance.now() * 0.001 - itc) +
    "";
  mediaFile = isQueuePlaybackContext
    ? mediaQueue[currentQueueIndex].path
    : currentMode === STREAMPLAYER
      ? document.getElementById("mdFile").value
      : mediaPlayerInputState.filePaths[0];
  var liveStreamMode = isLiveStream(mediaFile);
  const displaySelectEl =
    currentMode === STREAMPLAYER
      ? document.getElementById("dspSelctStreams")
      : document.getElementById("dspSelct");
  var selectedIndex =
    displaySelectEl && displaySelectEl.selectedIndex > 0
      ? displaySelectEl.selectedIndex - 1
      : 0;
  activeLiveStream = liveStreamMode;

  if (liveStreamMode === true) {
    if (video && !isImg(video.src)) {
      video.removeAttribute("src");
      video.load();
    }
  }

  const isImgFile = isImg(mediaFile);

  // Audio-only files always play in the local preview, never in the
  // dedicated fullscreen media window (queue mode included). This keeps the
  // user in control: nothing flickers on the secondary display, and audio
  // continues to play exactly the way the local <video> preview already does.
  if (
    audioOnlyFile &&
    !isActiveMediaWindow() &&
    !isImgFile
  ) {
    if (!isImgFile) {
      await playAudioOnlyLocally();
    } else {
      video.removeAttribute("src");
      video.load();
    }
    return;
  } else {
    playingMediaAudioOnly = false;
  }
  let strtVl = 0;
  if (isQueuePlaybackContext || currentMode === MEDIAPLAYER) {
    strtVl = video.volume;
  } else {
    strtVl = streamVolume;
  }
  const autoPlayCtl = document.getElementById("autoPlayCtl");
  const autoPlayEnabled = isQueuePlaybackContext || !!autoPlayCtl?.checked;
  const autoPlayExplicitlyDisabled =
    !isQueuePlaybackContext && autoPlayCtl && !autoPlayCtl.checked;
  const effectiveLoop = isQueuePlaybackContext ? false : video.loop;

  if (liveStreamMode === false && video !== null) {
    startTime = video.currentTime;
  }

  const windowOptions = {
    webPreferences: {
      v8CacheOptions: "bypassHeatCheckAndEagerCompile",
      contextIsolation: true,
      sandbox: true,
      enableWebSQL: false,
      webgl: false,
      skipTaskbar: true,
      additionalArguments: [
        "__mediafile-ems=" + encodeURIComponent(mediaFile),
        startTime !== 0 ? "__start-time=" + startTime : "",
        strtVl !== 1 ? "__start-vol=" + strtVl : "",
        effectiveLoop ? "__media-loop=true" : "",
        liveStreamMode ? "__live-stream=" + liveStreamMode : "",
        isImgFile ? "__isImg" : "",
        `__autoplay=${autoPlayEnabled}`,
        seekOnly ? "__seek-only" : "",
        birth,
      ],
      preload: `${__dirname}/media_preload.min.js`,
      devTools: false,
    },
  };

  isActiveMediaWindowCache = true;
  await invoke("create-media-window", windowOptions, selectedIndex);

  if (pidController) {
    pidController.reset();
  }

  if (video) {
    syncPreviewAudioTrackState();
    video.addEventListener("loadedmetadata", syncPreviewAudioTrackState, {
      once: true,
    });
    video.muted = false;
  }
  if (autoPlayEnabled) {
    beginPidSeekSuppression();
    unPauseMedia();
    if (isQueuePlaybackContext || currentMode !== STREAMPLAYER) {
      if (video !== null && !isImgFile) {
        beginPidSeekSuppression();
        await playVideoSafely(video, "media-window autoplay");
      }
    }
  }
  if (autoPlayExplicitlyDisabled) {
    pauseMedia();
    await video.pause();
  }
}

async function bootstrapRenderer() {
  await waitForPreloadBridge();
  attachElectronBridge();
  installIPCHandler();
  installEvents();
  return invoke("get-setting", "operating-mode").then(loadOpMode);
}

bootstrapRenderer().catch((error) => {
  console.error("Failed to bootstrap application:", error);
});
