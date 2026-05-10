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
var streamVolume = 1;
var video = null;
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

/** @type {{ path: string, name: string, type: string }[]} */
let mediaQueue = [];
let currentQueueIndex = -1;
let isQueuePlaying = false;
/** True after natural playback end (signaled before media window closes). */
let mediaPlaybackEndedPending = false;
/** When set, closing the media window switches to this queue index instead of advancing/stopping. */
let pendingQueueSwitchIndex = null;
/**
 * When true, the next media-window-closed finishes a full-queue clear (snapshot already taken;
 * presentation was closed from the clear action).
 */
let pendingQueueClearPostClose = false;
/**
 * Snapshot for undo after "Clear" on the media queue (HIG: perform + restore).
 * @type {null | { items: { path: string; name: string; type: string }[]; index: number; seekTime: number; wasPresentationActive: boolean }}
 */
let queueClearUndoSnapshot = null;
/** After reorder drop, ignore the synthetic click on the row. */
let ignoreNextQueueItemClick = false;

function isQueueAutoAdvanceEnabled() {
  const el = document.getElementById("queueAutoAdvanceCtl");
  return !el || el.checked;
}

function classifyQueueMediaType(filePath) {
  if (imageRegex.test(filePath)) return "image";
  if (/\.(mp4|webm|ogg|mkv|mov|m4v|avi)$/i.test(filePath)) return "video";
  if (/\.(mp3|wav|flac|m4a|aac|opus)$/i.test(filePath)) return "audio";
  return "file";
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
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
      '<div class="list-placeholder">No media in queue</div>';
  } else {
    listContainer.innerHTML = mediaQueue
      .map(
        (item, index) =>
          `<div class="queue-item${index === currentQueueIndex ? " active" : ""}" role="listitem" data-queue-index="${index}">
      <span class="queue-drag-handle" draggable="true" data-queue-index="${index}" title="Drag to reorder" aria-label="Drag to reorder">
        <svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true"><circle cx="3" cy="3" r="1.5" fill="currentColor"/><circle cx="9" cy="3" r="1.5" fill="currentColor"/><circle cx="3" cy="8" r="1.5" fill="currentColor"/><circle cx="9" cy="8" r="1.5" fill="currentColor"/><circle cx="3" cy="13" r="1.5" fill="currentColor"/><circle cx="9" cy="13" r="1.5" fill="currentColor"/></svg>
      </span>
      <span class="item-icon">${queueTypeIconMarkup(item.type)}</span>
      <span class="item-label" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
      <button type="button" class="remove-btn" draggable="false" data-queue-remove="${index}" title="Remove from queue" aria-label="Remove from queue">✕</button>
    </div>`,
      )
      .join("");
  }
  updateClearQueueButtonState();
}

function updateClearQueueButtonState() {
  const btn = document.getElementById("clearQueueBtn");
  if (!btn) return;
  const empty = mediaQueue.length === 0;
  btn.disabled = empty;
  btn.setAttribute("aria-disabled", empty ? "true" : "false");
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

  const [item] = mediaQueue.splice(fromIndex, 1);
  mediaQueue.splice(toIndex, 0, item);

  if (activePath !== null) {
    const ni = mediaQueue.findIndex((q) => q.path === activePath);
    currentQueueIndex = ni >= 0 ? ni : -1;
  }

  ignoreNextQueueItemClick = true;
  window.setTimeout(() => {
    ignoreNextQueueItemClick = false;
  }, 400);

  invalidateQueueUndoToastAfterMutation();
  renderQueue();
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
  const button = document.getElementById("mediaOpenButton");
  if (!button || button.dataset.openDialogBound === "1") return;
  button.dataset.openDialogBound = "1";
  button.addEventListener("click", openMediaFilesDialog);
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
  mediaQueue = [];
  currentQueueIndex = -1;
  isQueuePlaying = false;
  renderQueue();
}

/** Stop local preview playback after the queue is cleared (HIG: no “ghost” audio/video). */
function pauseLocalPreviewAfterQueueClear() {
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
    })),
    index: currentQueueIndex,
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
    if (video && !video.paused) {
      video.removeAttribute("src");
      video.load();
    }
    return;
  }

  const live = isLiveStream(mediaFile);
  if (!live && video && seekTime > 0.05) {
    const d = video.duration;
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
          video.removeEventListener("seeked", onSeeked);
          done();
        };
        video.addEventListener("seeked", onSeeked, { once: true });
        video.currentTime = safe;
      });
      startTime = video.currentTime;
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
  }));
  currentQueueIndex = snap.index;
  if (mediaQueue.length === 0) {
    currentQueueIndex = -1;
  } else if (currentQueueIndex >= mediaQueue.length) {
    currentQueueIndex = mediaQueue.length - 1;
  } else if (currentQueueIndex < 0) {
    currentQueueIndex = 0;
  }

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

async function onQueueItemActivate(index) {
  if (index < 0 || index >= mediaQueue.length) return;

  // Audio-only items play locally without a media window, but they're still
  // an active presentation: prompt before swapping them out.
  const isAudioOnlyPresentation =
    isQueuePlaying && playingMediaAudioOnly && !isActiveMediaWindow();

  if (!isActiveMediaWindow() && !isAudioOnlyPresentation) {
    currentQueueIndex = index;
    await loadQueueItemIntoControlWindow(mediaQueue[index]);
    renderQueue();
    saveMediaFile();
    return;
  }

  const item = mediaQueue[index];
  const ok = await invoke("show_queue_switch_dialog", {
    message: `Switch the presentation to "${item.name}"?\n\nThe current media will be stopped.`,
  });
  if (!ok) return;

  if (isAudioOnlyPresentation) {
    // No media window to close; transition directly to the next item.
    if (video) {
      try {
        video.pause();
      } catch (err) {
        console.error("Failed to pause local audio before switch:", err);
      }
    }
    send("localMediaState", 0, "stop");
    removeFilenameFromTitlebar();
    playingMediaAudioOnly = false;
    audioOnlyFile = false;
    mediaPlaybackEndedPending = false;

    currentQueueIndex = index;
    isQueuePlaying = true;
    isPlaying = true;
    updateDynUI();
    await playCurrentQueueItem();
    return;
  }

  pendingQueueSwitchIndex = index;
  send("close-media-window", 0);
}

async function stopQueuePresentationUserClosed() {
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

/** True when the preview <video> is showing the same local file as `filePath`. */
function previewShowsSameClipAsPath(filePath) {
  if (!video || !video.src) return false;
  if (!filePath || isImg(filePath) || isLiveStream(filePath)) return false;
  if (isImg(video.src) || isLiveStream(video.src)) return false;
  try {
    return decodeURI(removeFileProtocol(video.src)) === filePath;
  } catch {
    return false;
  }
}

async function loadQueueItemIntoControlWindow(item, opts) {
  const preservePreviewSeek = !opts || opts.preservePreviewSeek !== false;
  const isImgFile = isImg(item.path);

  let resumeAt = null;
  if (
    preservePreviewSeek &&
    !isImgFile &&
    video &&
    previewShowsSameClipAsPath(item.path) &&
    Number.isFinite(video.currentTime)
  ) {
    resumeAt = video.currentTime;
  }

  mediaFile = item.path;
  mediaPlayerInputState.filePaths = [item.path];
  updateQueueFileLabel(item.name);

  handleMediaPlayback(isImgFile);
  handleImageDisplay(isImgFile, document.querySelector("img"));

  if (!isImgFile && video) {
    video.load();
    await waitForMetadata();
    if (resumeAt !== null && resumeAt >= 0) {
      const d = video.duration;
      const safe =
        Number.isFinite(d) && d > 0
          ? Math.min(resumeAt, Math.max(0, d - 0.05))
          : resumeAt;
      try {
        await new Promise((resolve) => {
          const done = () => resolve();
          const t = window.setTimeout(done, 400);
          const onSeeked = () => {
            window.clearTimeout(t);
            video.removeEventListener("seeked", onSeeked);
            done();
          };
          video.addEventListener("seeked", onSeeked, { once: true });
          video.currentTime = safe;
        });
        startTime = video.currentTime;
        targetTime = startTime;
      } catch (err) {
        console.error(err);
      }
    }
    audioOnlyFile =
      !!video.videoTracks && video.videoTracks.length === 0;
    if (audioOnlyFile) {
      document.getElementById("customControls").style.visibility = "";
    }
  } else {
    audioOnlyFile = false;
    playingMediaAudioOnly = false;
  }
}

async function playCurrentQueueItem() {
  mediaPlaybackEndedPending = false;
  itc = performance.now() * 0.001;
  const item = mediaQueue[currentQueueIndex];
  if (!item) {
    isQueuePlaying = false;
    currentQueueIndex = -1;
    renderQueue();
    return;
  }

  await loadQueueItemIntoControlWindow(item);
  renderQueue();

  isPlaying = true;
  updateDynUI();

  const iM = isImg(mediaFile);
  if (iM) {
    await createMediaWindow();
    video.currentTime = 0;
    if (!video.paused) {
      video.removeAttribute("src");
      video.load();
    }
    return;
  }

  // Audio-only items (detected via metadata or by file extension) play
  // locally in the preview <video>. If a previous queue item left a media
  // window open, tear it down first so we don't hold a stale surface.
  const isAudioItem =
    audioOnlyFile || classifyQueueMediaType(item.path) === "audio";
  if (isAudioItem) {
    if (isActiveMediaWindow()) {
      isActiveMediaWindowCache = false;
      send("close-media-window", 0);
    }
    await playAudioOnlyLocally();
    return;
  }

  await createMediaWindow();
}

async function advanceQueueAfterMediaWindowClosed() {
  isPlaying = false;
  updateDynUI();
  isActiveMediaWindowCache = false;

  currentQueueIndex++;
  if (currentQueueIndex < mediaQueue.length) {
    renderQueue();
    await new Promise((r) => setTimeout(r, 100));
    isPlaying = true;
    updateDynUI();
    await playCurrentQueueItem();
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
      pidSeeking = true;
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
  timeline.value = (video.currentTime / video.duration) * 100;
  if (video.paused) {
    playPauseIcon.innerHTML = `<path d="M8 5v14l11-7z"/>`;
  } else {
    playPauseIcon.innerHTML = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
  }
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

  let isDragging = false; // Track drag interaction
  let wasPlayingBeforeDrag = false;

  // --- Format time utility ---
  const fmt = (sec) => {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (videoWrapper && controlsOverlay) {
    // 1. Initial State: Controls are hidden, so remove them from the tab sequence.
    disableTabFocus();

    // 2. Event Handlers: Use mouseenter/mouseleave to control the tabindex.
    videoWrapper.addEventListener("mouseenter", () => {
      enableTabFocus();
    });

    videoWrapper.addEventListener("mouseleave", () => {
      // Wait for the CSS fade-out animation (250ms) to complete before
      // removing the elements from the tab order. Use a small buffer (e.g., 300ms).
      setTimeout(() => {
        disableTabFocus();
        closeVolumePopup();
      }, 300);
    });
  }

  // --- PLAY / PAUSE ---
  playPauseBtn.addEventListener("click", async () => {
    if (video.src === "") return;

    if (video.paused) {
      await video.play();
    } else {
      await video.pause();
    }
  });

  video.addEventListener("play", () => {
    if (video.src === "" || currentMode !== MEDIAPLAYER) return;
    playPauseIcon.innerHTML = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
  });

  video.addEventListener("pause", () => {
    // Play icon
    if (playPauseIcon === null) return;
    playPauseIcon.innerHTML = `<path d="M8 5v14l11-7z"/>`;
  });

  video.addEventListener("loadedmetadata", () => {
    if (currentMode !== MEDIAPLAYER) {
      return;
    }
    timeline.min = 0;
    timeline.max = 100;
    timeline.value = 0;

    const hasSeekableMedia = isFinite(video.duration) && video.duration > 0;

    currentTimeDisplay.textContent = "0:00";
    durationTimeDisplay.textContent = fmt(video.duration);

    playPauseIcon.innerHTML = `<path d="M8 5v14l11-7z"/>`; // Play icon

    if (overlay) {
      overlay.style.display = "";
      overlay.style.visibility = hasSeekableMedia ? "visible" : "hidden";
    }

    repeatButton.classList.toggle("active", video.loop);
  });

  // --- DRAGGING THE TIMELINE (HYBRID LIVE SCRUBBING) ---
  timeline.addEventListener("mousedown", () => {
    if (!video.duration) return;
    wasPlayingBeforeDrag = !video.paused;
    isDragging = true;
    // Pause playback for stable seeking
    video.pause();
  });
  timeline.addEventListener("touchstart", () => {
    if (!video.duration) return;
    wasPlayingBeforeDrag = !video.paused;
    isDragging = true;
    // Pause playback for stable seeking
    video.pause();
  });

  // Seek immediately on 'input' for live frame updates
  timeline.addEventListener("input", () => {
    if (!video.duration) return;
    const seekTime = (timeline.value / 100) * video.duration;

    video.currentTime = seekTime;

    currentTimeDisplay.textContent = fmt(seekTime);
  });

  timeline.addEventListener("change", () => {
    isDragging = false;

    if (wasPlayingBeforeDrag) {
      // Use .catch() for promise errors if browser auto-play is blocked (common with video.play())
      video.play().catch((e) => modeChangeFixups(e));
    }
  });

  document.addEventListener("mouseup", () => (isDragging = false));
  document.addEventListener("touchend", () => (isDragging = false));

  // --- TIMEUPDATE ---
  video.addEventListener("timeupdate", () => {
    if (!video.duration || timeline === null) return;
    if (currentTimeDisplay !== null) {
      currentTimeDisplay.textContent = fmt(video.currentTime);
    }

    if (!isDragging) {
      timeline.value = (video.currentTime / video.duration) * 100;
    }
  });

  // --- LOOP / REPEAT ---
  repeatButton.addEventListener("click", () => {
    video.loop = !video.loop;
    repeatButton.classList.toggle("active", video.loop);

    send("media-set-loop", video.loop);
  });

  // --- END OF VIDEO ---
  video.addEventListener("ended", () => {
    if (!video.loop && currentMode === MEDIAPLAYER) {
      video.currentTime = 0;
      video.pause();
      timeline.value = 0;
      currentTimeDisplay.textContent = "0:00";
    }
  });

  if (clickTarget) {
    clickTarget.addEventListener("click", (event) => {
      if (video.src === "") return;
      const isControl = event.target.closest("#customControls");

      if (!isControl) {
        if (video.paused) {
          video.play();
        } else {
          video.pause();
        }
      }
      event.stopPropagation();
    });
  }
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

  slider.addEventListener("mousedown", () => {
    volumePopupOpen = true;
  });

  slider.addEventListener("touchstart", () => {
    volumePopupOpen = true;
  });

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
    'Press "Start Presentation" to show on the selected display.';

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
  if (video.paused | (currentMode !== MEDIAPLAYER)) {
    localTimeStampUpdateIsRunning = 0;
    return;
  }

  if (time - lastUpdateTimeLocalPlayer > 33) {
    NUM_BUFFER[3] = video.duration - video.currentTime;

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

  if (!video.paused) {
    localTimeStampUpdateIsRunning = true;
    if (!video.paused) {
      requestAnimationFrame(update);
    } else {
      localTimeStampUpdateIsRunning = false;
    }
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
  now = Date.now();

  if (currentMode === MEDIAPLAYER) {
    SECONDSFLOAT[0] = message[0] - message[1];
    NUM_BUFFER[0] = ((SECONDSFLOAT[0] | 0) / 3600) | 0;
    REM_BUFFER[0] = (SECONDSFLOAT[0] | 0) % 3600;
    NUM_BUFFER[1] = (REM_BUFFER[0] / 60) | 0;
    NUM_BUFFER[2] = REM_BUFFER[0] % 60;
    NUM_BUFFER[3] =
      ((SECONDSFLOAT[0] - (SECONDSFLOAT[0] | 0)) * 1000 + 0.5) | 0;
    if (!updatePending[0]) {
      updatePending[0] = 1;
      requestAnimationFrame(updateCountdownNode);
    }
  }

  // Perform timestamp calculations only if enough time has passed
  if (now - lastUpdateTime > 500) {
    if (video && !video.paused && !video.seeking) {
      targetTime = message[1] - (now - message[2] + (Date.now() - now)) * 0.001;
      hybridSync(targetTime);
      lastUpdateTime = now;
    }
  }
}

async function handlePlaybackState(event, playbackState) {
  if (!video) {
    return;
  }
  if (playbackState.playing && video.paused) {
    masterPauseState = false;
    if (video && !isImg(mediaFile)) {
      await video.play();
    }
  } else if (!playbackState.playing && !video.paused) {
    masterPauseState = true;
    if (video) {
      video.currentTime = playbackState.currentTime;
      await video.pause();
    }
  }
}

function handlePlayPause(event, arg) {
  mediaSessionPause = arg;
}

function handleMediaseek(event, seekTime) {
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
  on("media-playback-ended", () => {
    mediaPlaybackEndedPending = true;
  });
  on("media-seek", handleMediaseek);
  on("window-maximized", handleWindowMax);
}

async function handleMediaWindowClosed(event, id) {
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
    pendingQueueSwitchIndex = null;
    mediaPlaybackEndedPending = false;

    isPlaying = false;
    updateDynUI();
    isActiveMediaWindowCache = false;

    currentQueueIndex = idx;
    await loadQueueItemIntoControlWindow(mediaQueue[idx]);
    renderQueue();

    isPlaying = true;
    updateDynUI();

    const iM = isImg(mediaFile);
    if (iM) {
      await createMediaWindow();
      video.currentTime = 0;
      if (!video.paused) {
        video.removeAttribute("src");
        video.load();
      }
    } else if (
      audioOnlyFile ||
      classifyQueueMediaType(mediaQueue[idx].path) === "audio"
    ) {
      await playAudioOnlyLocally();
    } else {
      await createMediaWindow();
    }
    return;
  }

  if (isQueuePlaying) {
    if (mediaPlaybackEndedPending) {
      mediaPlaybackEndedPending = false;
      if (isQueueAutoAdvanceEnabled()) {
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

  if (video) {
    if (video.audioTracks.length !== 0) {
      video.audioTracks[0].enabled = true;
    }

    if (
      video.loop &&
      video.currentTime > 0 &&
      video.duration - video.currentTime < 0.5
    ) {
      startTime = 0;
      targetTime = 0;
      video.currentTime = 0;
      video.play();
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
function isAudioFile() {
  return (
    currentMode === MEDIAPLAYER &&
    video.videoTracks &&
    video.videoTracks.length === 0
  );
}

function handleMediaPlayback(isImgFile) {
  if (!isImgFile) {
    if (video.src !== "") {
      waitForMetadata().then(isAudioFile);
    }
    video.src = mediaFile;
  }
}

function handleImageDisplay(isImgFile, imgEle) {
  if (imgEle && !isImgFile) {
    imgEle.remove();
    imgEle.src = "";
    document.getElementById("preview").style.display = "";
  } else if (isImgFile) {
    resetPreviewWarningState();
    if (imgEle) {
      imgEle.src = mediaFile;
    } else {
      if ((imgEle = document.querySelector("img")) !== null) {
        imgEle.remove();
        imgEle.src = "";
      }
      video.removeAttribute("src");
      video.load();
      img = document.createElement("img");
      const overlay = document.getElementById("customControls");
      overlay.style.visibility = "hidden";
      img.src = mediaFile;
      img.setAttribute("id", "preview");
      if (!document.getElementById("preview")) {
        document.getElementById("preview").style.display = "none";
      }
      document.getElementById("preview").parentNode.appendChild(img);
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

function handleCanPlayThrough(e, resolve) {
  if (video.src === "") {
    e.preventDefault();
    resolve(video);
    return;
  }
  video.currentTime = 0;
  audioOnlyFile = video.videoTracks && video.videoTracks.length === 0;

  resolve(video);
}

function handleError(e, reject) {
  reject(e);
}

function waitForMetadata() {
  if (
    !video ||
    !video.src ||
    video.src === "" ||
    isLiveStream(video.src) ||
    isImg(video.src)
  ) {
    playingMediaAudioOnly = false;
    audioOnlyFile = false;
    return Promise.reject("Invalid source or live stream.");
  }

  return new Promise((resolve, reject) => {
    const onCanPlayThrough = (e) => handleCanPlayThrough(e, resolve);
    const onError = (e) => handleError(e, reject);

    video.addEventListener("canplaythrough", onCanPlayThrough, { once: true });
    video.addEventListener("error", onError, { once: true });

    if (video.readyState === 0) {
      video.load();
    }
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

  if (
    video &&
    !audioOnlyFile &&
    video.readyState &&
    video.videoTracks &&
    video.videoTracks.length === 0
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
      await playCurrentQueueItem();
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
    await playCurrentQueueItem();
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
      send("localMediaState", 0, "play");
      addFilenameToTitlebar(normalizedPathname);
      isPlaying = true;
      playingMediaAudioOnly = true;
      video.play();
      updateTimestamp();
      return;
    }

    await createMediaWindow();
  } else {
    if (isQueuePlaying) {
      isQueuePlaying = false;
      currentQueueIndex = -1;
      renderQueue();
    }
    startTime = 0;
    isPlaying = false;
    updateDynUI();
    send("close-media-window", 0);
    isActiveMediaWindowCache = false;
    playingMediaAudioOnly = false;
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
    playButton.textContent = isPlaying
      ? "Stop Presentation"
      : "Start Presentation";
  }

  if (document.getElementById("dspSelct")) {
    document.getElementById("dspSelct").disabled = isPlaying && audioOnlyFile;
  }
  if (document.getElementById("autoPlayCtl")) {
    const iM = isImg(mediaFile);
    if ((isPlaying && audioOnlyFile) || iM) {
      document.getElementById("autoPlayCtl").checked = true;
    }
    document.getElementById("autoPlayCtl").disabled =
      (isPlaying && audioOnlyFile) || iM;
  }
}

async function populateDisplaySelect() {
  const displaySelect = document.getElementById("dspSelct");
  if (!displaySelect) return;

  displaySelect.onchange = (event) => {
    send("set-display-index", parseInt(event.target.value));
  };

  try {
    const { displays, defaultDisplayIndex } = await invoke("get-all-displays");

    // Clear existing options except the first disabled one
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

  document.getElementById("dyneForm").innerHTML = `
    <div class="media-container">
        <div class="video-wrapper stream-preview-host" aria-hidden="true">
            <video id="preview" disablePictureInPicture controls="false"></video>
        </div>
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
                <select name="dspSelct" id="dspSelct" class="display-select">
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

  video = document.getElementById("preview");

  if (mediaFile !== null && isLiveStream(mediaFile)) {
    document.getElementById("mdFile").value = mediaFile;
  }

  document.getElementById("volume-slider").value = streamVolume;
  document
    .getElementById("volume-slider")
    .addEventListener("input", handleVolumeChange);

  installDisplayChangeHandler();
  populateDisplaySelect();

  document
    .getElementById("mediaWindowPlayButton")
    .addEventListener("click", playMedia, { passive: true });

  if (playingMediaAudioOnly) {
    isPlaying = true;
    updateDynUI();
    return;
  }
  restoreMediaFile();

  if (document.getElementById("mdFile").value.includes(":\\fakepath\\")) {
    document.getElementById("mdFile").value = "";
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

  let plyBtn = document.getElementById("mediaWindowPlayButton");
  if (!isActiveMW && !playingMediaAudioOnly) {
    isPlaying = false;
  } else {
    isPlaying = true;
    send("close-media-window", 0);
  }
  updateDynUI();
  plyBtn.addEventListener("click", playMedia, { passive: true });

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

function generateMediaFormHTML(video = null) {
  return `
  <div class="media-container">
    <form onsubmit="return false;" class="control-panel control-panel--media">
      <div class="control-group">
        <span class="control-label">Media</span>
        <button type="button" class="file-input-label" id="mediaOpenButton">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M2.5 2.5h11a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"
            />
            <circle cx="5.5" cy="5.5" r="1" fill="currentColor"/>
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M3.5 11.5l2.5-2.5c.4-.4 1-.4 1.4 0l2.1 2.1m-1-1l1-1c.4-.4 1-.4 1.4 0l2.1 2.1"
            />
          </svg>
          <span>Open</span>
        </button>
      </div>

      <div class="control-group">
        <span class="control-label">Display</span>
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

      <div id="mediaCntDn"></div>

      <div class="queue-section">
        <div class="list-header">
          <span class="queue-section-title">Media Queue</span>
          <button type="button" id="clearQueueBtn" class="pill-button destructive-action" title="Clear the queue" aria-label="Clear queue">Clear</button>
        </div>
        <div id="mediaQueueList" class="boxed-list" role="list" aria-label="Media queue">
          <div class="list-placeholder">No media in queue</div>
        </div>
      </div>
    </form>

    <div class="video-wrapper">
      <video id="preview" disablePictureInPicture controls=false></video>

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
    await populateDisplaySelect();
  });

  installDisplayChangeHandler.initialized = true;
}

function loopCtlHandler(event) {
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
  document.getElementById("dyneForm").innerHTML = generateMediaFormHTML(video);
  mediaCntDn.appendChild(textNode);
  mediaCntDn.style.color = "#5c87b2";
  installDisplayChangeHandler();
  populateDisplaySelect();

  if (video === null) {
    video = document.getElementById("preview");
  } else {
    if (mediaFile) {
      const fileNameSpan = document.querySelector(".file-input-label span");
      if (fileNameSpan) {
        fileNameSpan.textContent = getHostnameOrBasename(mediaFile);
        fileNameSpan.title = getHostnameOrBasename(mediaFile);
      }
    }

    if (
      isLiveStream(document.querySelector(".file-input-label span").innerText)
    ) {
      document.querySelector(".file-input-label span").innerText = "Open";
      document.querySelector(".file-input-label span").title = "Open";
    }

    // Call restoreMediaFile but it won't set input value
    restoreMediaFile();
    updateTimestamp();
  }
  invoke("get-platform")
    .then((operatingSystem) => {
      attachCubicWaveShaper(video, undefined, undefined, operatingSystem);
    })
    .catch((error) => {
      console.error("Failed to get platform, skipping audio setup:", error);
    });

  installMediaOpenButton();
  document
    .getElementById("clearQueueBtn")
    ?.addEventListener("click", onClearMediaQueueClick);
  installMediaQueueListDelegation();
  renderQueue();
  const isActiveMW = isActiveMediaWindow();
  let plyBtn = document.getElementById("mediaWindowPlayButton");
  if (!isActiveMW && !playingMediaAudioOnly) {
    isPlaying = false;
  } else {
    isPlaying = true;
  }
  updateDynUI();
  video.controls = false;
  plyBtn.addEventListener("click", playMedia, { passive: true });
  let isImgFile;
  if (document.getElementById("preview").parentNode !== null) {
    if (!masterPauseState && video !== null && !video.paused) {
      if (!isImg(mediaFile)) {
        video.play();
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
              video.play();
            }
          }
        }
      }
      document
        .getElementById("preview")
        .parentNode.replaceChild(video, document.getElementById("preview"));
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
    document.getElementById("customControls").style.display = "";
    timelineSync();
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
            mediaFile !== decodeURI(removeFileProtocol(video.src)))
        ) {
          video.setAttribute("src", mediaFile);
        }
        video.id = "preview";
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

function cleanRefs() {
  let vsl = document.getElementById("volume-slider");
  if (vsl) {
    vsl.removeEventListener("input", handleVolumeChange);
  }

  let playButton = document.querySelector("#mediaWindowPlayButton");
  if (playButton) {
    playButton.removeEventListener("click", playMedia);
    playButton = null;
  }

  const clearQueueBtn = document.getElementById("clearQueueBtn");
  if (clearQueueBtn) {
    clearQueueBtn.removeEventListener("click", onClearMediaQueueClick);
  }
  let mcd = document.getElementById("mediaCntDn");
  if (mcd && mcd.contains(textNode)) {
    mcd.removeChild(textNode);
  }

  if (playPauseBtn) playPauseBtn.removeEventListener("click", unPauseMedia);
  if (playPauseBtn) playPauseBtn.removeEventListener("click", pauseMedia);
  if (timeline) timeline.removeEventListener("change", () => {});
  if (timeline) timeline.removeEventListener("input", () => {});
  if (repeatButton) repeatButton.removeEventListener("click", () => {});
  playPauseBtn = null;
  playPauseIcon = null;
  timeline = null;
  currentTimeDisplay = null;
  durationTimeDisplay = null;
  repeatButton = null;

  document.getElementById("dyneForm").innerHTML = "";
}

function installEvents() {
  document.getElementById("MdPlyrRBtnFrmID").addEventListener(
    "click",
    () => {
      if (currentMode === MEDIAPLAYER) {
        return;
      }
      cleanRefs();
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
      cleanRefs();
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
      cleanRefs();
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

  if (!isActiveMediaWindow()) {
    if (video.audioTracks.length !== 0) {
      video.audioTracks[0].enabled = true;
    }
  }
  mediaSessionPause = false;
  if (
    !audioOnlyFile &&
    video.readyState &&
    video.videoTracks &&
    video.videoTracks.length === 0
  ) {
    audioOnlyFile = true;
    if (currentMode === MEDIAPLAYER) {
      document.getElementById("customControls").style.visibility = "";
    }
  }
  if (audioOnlyFile) {
    send("localMediaState", 0, "play");
    addFilenameToTitlebar(removeFileProtocol(decodeURI(video.src)));
    isPlaying = true;
    updateDynUI();
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
  audioOnlyFile = video.videoTracks && video.videoTracks.length === 0;
}

function seekLocalMedia(e) {
  if (pidSeeking) {
    pidSeeking = false;
    e.preventDefault();
  } else {
    pidController.reset();
  }
  if (video.src === "") {
    e.preventDefault();
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
    pidSeeking = false;
    e.preventDefault();
  } else {
    pidController.reset();
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

  // Capture before flags get cleared: an audio-only queue item just ended
  // locally with no presentation window, so the normal media-window-closed
  // path will not run. We need to drive the queue advance ourselves.
  const wasAudioOnlyQueueItem =
    isQueuePlaying &&
    !isActiveMediaWindow() &&
    playingMediaAudioOnly &&
    currentMode === MEDIAPLAYER &&
    video &&
    !video.loop;

  if (
    isQueuePlaying &&
    isActiveMediaWindow() &&
    video &&
    !video.loop &&
    currentMode === MEDIAPLAYER
  ) {
    mediaPlaybackEndedPending = true;
  }
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
  send("close-media-window", 0);
  removeFilenameFromTitlebar();
  video.pause();
  masterPauseState = false;
  resetPIDOnSeek();
  localTimeStampUpdateIsRunning = false;

  // Audio-only queue item finished: drive the same advance/stop logic that
  // handleMediaWindowClosed normally does when a real media window closes.
  if (wasAudioOnlyQueueItem) {
    if (isQueueAutoAdvanceEnabled()) {
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
  if (!event.target.isConnected) {
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
    event.preventDefault();
    event.target.play(); //continue to play even if detached
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
  if (!installPreviewEventHandlers.installedVideoEventListener) {
    video.addEventListener("loadstart", loadLocalMediaHandler);
    video.addEventListener("loadedmetadata", loadedmetadataHandler);
    video.addEventListener("seeked", seekLocalMedia);
    video.addEventListener("seeking", seekingLocalMedia);
    video.addEventListener("ended", endLocalMedia);
    video.addEventListener("pause", pauseLocalMedia);
    video.addEventListener("play", playLocalMedia);
    video.addEventListener("volumechange", handleVolumeChange);
    pidController = new PIDController(video);
    installPreviewEventHandlers.installedVideoEventListener = true;
  }
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

/**
 * Play the currently-loaded audio-only file in the local preview <video>
 * without creating a fullscreen media window. Audio-only files do not need
 * a presentation surface, and creating one (then having nothing visible)
 * confuses users and can race the window's open/close lifecycle.
 */
async function playAudioOnlyLocally() {
  if (!video) return;
  audioOnlyFile = true;
  playingMediaAudioOnly = true;
  isPlaying = true;
  send("localMediaState", 0, "play");
  if (video.src) {
    try {
      addFilenameToTitlebar(decodeURI(removeFileProtocol(video.src)));
    } catch (err) {
      console.error("Failed to update titlebar for audio-only:", err);
    }
  }
  updateDynUI();
  try {
    await video.play();
  } catch (err) {
    console.error("Audio-only local playback failed:", err);
  }
  updateTimestamp();
}

async function createMediaWindow(options) {
  const seekOnly = options && options.seekOnly === true;
  if (seekOnly) {
    itc = performance.now() * 0.001;
  }
  const ts = await invoke("get-system-time");
  let birth =
    ts.systemTime +
    (Date.now() - ts.ipcTimestamp) * 0.001 +
    (performance.now() * 0.001 - itc) +
    "";
  mediaFile =
    currentMode === STREAMPLAYER
      ? document.getElementById("mdFile").value
      : mediaPlayerInputState.filePaths[0];
  var liveStreamMode = isLiveStream(mediaFile);
  var selectedIndex = document.getElementById("dspSelct").selectedIndex - 1;
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
  if (audioOnlyFile && !isActiveMediaWindow()) {
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
  if (currentMode === MEDIAPLAYER) {
    strtVl = video.volume;
  } else {
    strtVl = streamVolume;
  }

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
        video.loop ? "__media-loop=true" : "",
        liveStreamMode ? "__live-stream=" + liveStreamMode : "",
        isImgFile ? "__isImg" : "",
        `__autoplay=${document.getElementById("autoPlayCtl")?.checked !== undefined && document.getElementById("autoPlayCtl").checked}`,
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
    if (video.audioTracks && video.audioTracks[0]) {
      video.audioTracks[0].enabled = false;
    } else {
      video.addEventListener(
        "loadedmetadata",
        () => {
          if (video.audioTracks.length !== 0) {
            video.audioTracks[0].enabled = false;
          }
        },
        { once: true },
      );
    }

    if (video.audioTracks.length !== 0 && video.audioTracks[0]) {
      video.audioTracks[0].enabled = false;
    }
    video.muted = false;
  }
  if (
    document.getElementById("autoPlayCtl")?.checked !== undefined &&
    document.getElementById("autoPlayCtl").checked
  ) {
    pidSeeking = true;
    unPauseMedia();
    if (currentMode !== STREAMPLAYER) {
      if (video !== null && !isImgFile) {
        pidSeeking = true;
        await video.play();
      }
    }
  }
  if (
    document.getElementById("autoPlayCtl")?.checked !== undefined &&
    !document.getElementById("autoPlayCtl").checked
  ) {
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
