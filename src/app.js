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

import {
  bibleQueuePath,
  bibleUriPrefix,
  bibleVersionValue,
  clampMediaTime,
  clampQueueStartTime,
  classifyQueueMediaType,
  createQueueEntry,
  escapeHtml,
  formatCueTime,
  imageRegex,
  isBiblePath,
  isNonVideoPresentationPath,
  isPlayInterruptedError,
  normalizedBibleVersions,
  pathToMediaUrl,
  pptxRegex,
  queueBasename,
} from "./app-media-utils.mjs";
import {
  waitForLoadedMetadata,
  waitForMetadata as waitForMediaMetadata,
} from "./app-media-loading-utils.mjs";
import {
  normalizeBibleReferenceInput as normalizeBibleReferenceInputWithCache,
  normalizeScriptureReference,
  parseScriptureReference,
} from "./app-bible-reference-utils.mjs";
import {
  formatTime,
  getHostnameOrBasename,
  PIDController,
} from "./app-controls-utils.mjs";
import {
  clampPptxSlideIndex as clampPptxSlideIndexValue,
  enforcePptxCoverFit,
  getElementContentSize,
  getPptxListRenderOptions,
  getPptxNaturalSlideSize,
  getPptxRenderedSlideElement,
  isSavedPptxSlideIndex,
  waitForNextFrame,
} from "./app-pptx-utils.mjs";
import {
  PREVIEW_STASH_ID,
  TAB_PANEL_MEDIA_ID,
  TAB_PANEL_STREAMS_ID,
  generateDyneTabShellHTML,
  generateMediaFormHTML,
  generateStreamsPanelHTML,
  queueTypeIconMarkup,
} from "./app-ui-templates.mjs";

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
/**
 * Volume (0–1) for the actively-loaded cue. While a cue is loaded the GTK
 * slider writes here (and to mediaQueue[previewCueIndex].cueVolume) instead
 * of to `video.volume` so the live output is never touched. Null when no cue
 * is active.
 */
let pendingCueVolume = null;
/** True only after the operator moves the cue volume slider or mute control. */
let cueVolumeDirty = false;
/**
 * Saved reference to the GTK icon-update closure so helpers outside
 * setupGtkVolumeControl can repaint the icon after programmatic slider changes.
 */
let gtkUpdateVolIcon = null;
let liveAudio = null;
let liveAudioQueueIndex = -1;
let previewLoadToken = 0;
let streamRendererPreviewStream = null;
let streamRendererPreviewStartPromise = null;
let streamRendererPreviewQualityMode = null;
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
const mediaLoopByPath = new Map();
const MEDIAPLAYER = 0,
  STREAMPLAYER = 1,
  BULKMEDIAPLAYER = 5,
  TEXTPLAYER = 6;
const SCRIPTURE_FONT_FAMILY = "'CMG Sans'";
const SCRIPTURE_BODY_FONT_SIZE = 66;
const SCRIPTURE_REFERENCE_FONT_SIZE = 38;
const SCRIPTURE_LABEL_FONT_SIZE = 28;
const SCRIPTURE_HEADING_FONT_SIZE = 52;
const SCRIPTURE_FONT_WEIGHT = 700;
const SCRIPTURE_LINE_HEIGHT = 1.32;
const SCRIPTURE_LOOK_FULLSCREEN = "fullscreen";
const SCRIPTURE_LOOK_LOWER_THIRD = "lower-third";
const BIBLE_LOWER_THIRD_FEATURE_ENABLED = false;
const SCRIPTURE_DEFAULT_LOOK = SCRIPTURE_LOOK_FULLSCREEN;
const SCRIPTURE_LOWER_THIRD_TEXT_COLOR = "#ffffff";
const SCRIPTURE_LOWER_THIRD_CHROMA_KEY_COLOR = "#00ff00";
const SCRIPTURE_REFERENCE_LIGHT_COLOR = "rgba(255, 255, 255, 0.78)";
const SCRIPTURE_REFERENCE_DARK_COLOR = "rgba(24, 24, 28, 0.84)";
const SCRIPTURE_REFERENCE_LIGHT_SHADOW = "0 2px 14px rgba(0, 0, 0, 0.72)";
const SCRIPTURE_REFERENCE_DARK_SHADOW = "0 2px 12px rgba(255, 255, 255, 0.62)";
const SCRIPTURE_REFERENCE_LIGHT_BACKGROUND_LUMINANCE = 0.58;
const LOWER_THIRD_MAX_LINES = 2;
const LOWER_THIRD_MEASURE_ID = "bibleLowerThirdMeasure";
const BIBLE_PREVIEW_DEFAULT_OUTPUT_WIDTH = 1920;
const BIBLE_PREVIEW_DEFAULT_OUTPUT_HEIGHT = 1080;
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
const PROJECT_SCHEMA_VERSION = 1;
const AUTOSAVE_WRITE_DEBOUNCE_MS = 300;
let autosaveWriteTimer = null;
let currentProjectPath = "";
let currentProjectStorageMode = "working";
let activeMediaWindowContentType = null;
let bibleShowNowModeActive = false;
let bibleLowerThirdOutputActive = false;
let biblePreviewActiveMediaWindowSize = null;
let biblePreviewMediaWindowSizePromise = null;
const bibleDesignerState = {
  version: "KJV",
  reference: "",
  text: "",
  book: "John",
  chapter: 3,
  verse: 0,
  verseEnd: 0,
  fontFamily: SCRIPTURE_FONT_FAMILY,
  fontSize: SCRIPTURE_BODY_FONT_SIZE,
  color: "#ffffff",
  backgroundColor: "#000000",
  backgroundPath: "",
  lowerThirdColor: SCRIPTURE_LOWER_THIRD_TEXT_COLOR,
  lowerThirdChromaKeyColor: SCRIPTURE_LOWER_THIRD_CHROMA_KEY_COLOR,
  look: SCRIPTURE_DEFAULT_LOOK,
  lowerThirdSegments: [],
  lowerThirdSegmentIndex: 0,
  lowerThirdSourceText: "",
};
const projectScriptureOverrides = {
  fontFamily: "",
  fontSize: undefined,
  color: "",
  backgroundColor: "",
  backgroundPath: "",
  lowerThirdColor: "",
  lowerThirdChromaKeyColor: "",
};
const bibleStyleDirtyState = {
  fontFamily: false,
  fontSize: false,
  color: false,
  backgroundColor: false,
  backgroundPath: false,
  lowerThirdColor: false,
  lowerThirdChromaKeyColor: false,
};
let lastShownBibleStyleOverrides = {};
const bibleVerseSelection = {
  verses: new Set(),
  anchor: 0,
};
let bibleBooksCache = [];
let bibleReferenceSuggestionIndex = -1;
/** @type {{ path: string, name: string, type: string, cueStartTime?: number, cueVolume?: number, loop?: boolean, pptxSlideIndex?: number }[]} */
let mediaQueue = [];
let currentQueueIndex = -1;
let previewCueIndex = -1;
let isQueuePlaying = false;
let manualBoundaryPauseIndex = -1;
let pptxViewer = null;
let pptxViewerHost = null;
let pptxPreviewSlideHandle = null;
let pptxThumbnailHandles = new Map();
let pptxThumbnailObserver = null;
let pptxSlideCount = 0;
let pptxCurrentSlide = 0;
let pptxFilePath = null;
let pptxLayoutRefreshRaf = 0;
let pptxPreviewRequestToken = 0;
const PPTX_SIDEBAR_STORAGE_KEY = "ems.pptxSidebarWidth";
const PPTX_SIDEBAR_DEFAULT_WIDTH = 168;
const PPTX_SIDEBAR_MIN_WIDTH = 128;
const PPTX_SIDEBAR_MAX_WIDTH = 360;
/** True after natural playback end (signaled before media window closes). */
let mediaPlaybackEndedPending = false;
/** True when the operator pressed Stop, so the close must not advance the queue. */
let userStopPresentationPending = false;
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
 * @type {null | { items: { path: string; name: string; type: string; cueStartTime: number; cueVolume?: number; loop?: boolean }[]; index: number; cueIndex: number; seekTime: number; wasPresentationActive: boolean }}
 */
let queueClearUndoSnapshot = null;
/** After reorder drop, ignore the synthetic click on the row. */
let ignoreNextQueueItemClick = false;
let ignoreQueueItemClicksUntil = 0;
let queueItemClickTimer = null;
let queueDragFromIndex = -1;
/** Last <video> element that received cubic waveshaper wiring. */
let cubicWaveShaperAttachedVideo = null;

function isNonVideoPresentationItem(filePath) {
  return isNonVideoPresentationPath(filePath, isImg);
}

function normalizeBibleReferenceInput(rawReference) {
  return normalizeBibleReferenceInputWithCache(rawReference, bibleBooksCache);
}

function bibleReferenceBookQuery(rawReference) {
  const raw = String(rawReference || "").trim();
  if (!raw) return "";
  return raw.replace(/\s+\d.*$/, "").trim();
}

function bibleReferenceSuggestionsForInput(rawReference) {
  const query = bibleReferenceBookQuery(rawReference);
  if (!query) return [];
  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalizedQuery) return [];

  const starts = [];
  const contains = [];
  for (const book of bibleBooksCache) {
    const name = String(book?.name || "").trim();
    if (!name) continue;
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedName === normalizedQuery) continue;
    if (normalizedName.startsWith(normalizedQuery)) {
      starts.push(name);
    } else if (normalizedName.includes(normalizedQuery)) {
      contains.push(name);
    }
  }
  return [...starts, ...contains].slice(0, 8);
}

function bibleReferenceAllBooks() {
  return bibleBooksCache
    .map((book) => String(book?.name || "").trim())
    .filter(Boolean);
}

function positionBibleReferenceSuggestionsOverlay() {
  const suggestionsEl = document.getElementById("bibleReferenceSuggestions");
  const referenceInput = document.getElementById("bibleReferenceInput");
  if (!suggestionsEl || !referenceInput || suggestionsEl.hidden) return;
  const rect = referenceInput.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const availableRight = Math.max(0, viewportWidth - rect.left - 12);
  const desiredWidth = Math.max(rect.width, Math.min(320, availableRight));
  suggestionsEl.style.position = "fixed";
  suggestionsEl.style.top = `${Math.round(rect.bottom + 6)}px`;
  suggestionsEl.style.left = `${Math.round(rect.left)}px`;
  suggestionsEl.style.width = `${Math.round(Math.min(desiredWidth, availableRight || rect.width))}px`;
}

function hideBibleReferenceSuggestions() {
  const suggestionsEl = document.getElementById("bibleReferenceSuggestions");
  const referenceInput = document.getElementById("bibleReferenceInput");
  const toggleButton = document.getElementById("bibleReferenceToggle");
  if (suggestionsEl) {
    suggestionsEl.hidden = true;
    suggestionsEl.innerHTML = "";
    suggestionsEl.style.top = "";
    suggestionsEl.style.left = "";
    suggestionsEl.style.width = "";
  }
  if (referenceInput) {
    referenceInput.setAttribute("aria-expanded", "false");
    referenceInput.removeAttribute("aria-activedescendant");
  }
  if (toggleButton) {
    toggleButton.setAttribute("aria-expanded", "false");
  }
  bibleReferenceSuggestionIndex = -1;
}

function applyBibleReferenceSuggestion(bookName) {
  const referenceInput = document.getElementById("bibleReferenceInput");
  if (!referenceInput || !bookName) return;
  referenceInput.value = `${bookName} 1:1`;
  hideBibleReferenceSuggestions();
  referenceInput.focus();
  referenceInput.setSelectionRange(referenceInput.value.length, referenceInput.value.length);
}

function updateBibleReferenceSuggestionActiveState() {
  const suggestionsEl = document.getElementById("bibleReferenceSuggestions");
  const referenceInput = document.getElementById("bibleReferenceInput");
  if (!suggestionsEl || !referenceInput) return;
  const buttons = suggestionsEl.querySelectorAll(".bible-reference-suggestion");
  buttons.forEach((button, index) => {
    const active = index === bibleReferenceSuggestionIndex;
    button.classList.toggle("is-active", active);
    if (active) {
      referenceInput.setAttribute("aria-activedescendant", button.id);
      const buttonTop = button.offsetTop;
      const buttonBottom = buttonTop + button.offsetHeight;
      if (buttonTop < suggestionsEl.scrollTop) {
        suggestionsEl.scrollTop = buttonTop;
      } else if (buttonBottom > suggestionsEl.scrollTop + suggestionsEl.clientHeight) {
        suggestionsEl.scrollTop = buttonBottom - suggestionsEl.clientHeight;
      }
    }
  });
  if (bibleReferenceSuggestionIndex < 0) {
    referenceInput.removeAttribute("aria-activedescendant");
  }
}

function centerBibleVerseRowInList(row) {
  const list = document.getElementById("bibleVerseList");
  if (!list || !row) return;
  const target =
    row.offsetTop -
    list.offsetTop -
    Math.max(0, (list.clientHeight - row.offsetHeight) / 2);
  list.scrollTop = Math.max(0, target);
}

function renderBibleReferenceSuggestions(options = {}) {
  const suggestionsEl = document.getElementById("bibleReferenceSuggestions");
  const referenceInput = document.getElementById("bibleReferenceInput");
  if (!suggestionsEl || !referenceInput) return;

  const suggestions = options.showAll
    ? bibleReferenceAllBooks()
    : bibleReferenceSuggestionsForInput(referenceInput.value);
  if (!suggestions.length) {
    hideBibleReferenceSuggestions();
    return;
  }

  suggestionsEl.innerHTML = "";
  const fragment = document.createDocumentFragment();
  suggestions.forEach((name, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `bibleReferenceSuggestion-${index}`;
    button.className = "bible-reference-suggestion";
    button.setAttribute("role", "option");
    button.textContent = name;
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      applyBibleReferenceSuggestion(name);
    });
    fragment.appendChild(button);
  });
  suggestionsEl.appendChild(fragment);
  suggestionsEl.hidden = false;
  positionBibleReferenceSuggestionsOverlay();
  referenceInput.setAttribute("aria-expanded", "true");
  document.getElementById("bibleReferenceToggle")?.setAttribute("aria-expanded", "true");
  if (bibleReferenceSuggestionIndex >= suggestions.length) {
    bibleReferenceSuggestionIndex = suggestions.length - 1;
  }
  updateBibleReferenceSuggestionActiveState();
}

function isBibleReferenceSuggestionsOpen() {
  const suggestionsEl = document.getElementById("bibleReferenceSuggestions");
  return Boolean(suggestionsEl && suggestionsEl.hidden === false);
}

function clampPptxSlideIndex(index, count = pptxSlideCount) {
  return clampPptxSlideIndexValue(index, count);
}

function clampPptxSidebarWidth(width) {
  if (!Number.isFinite(width)) return PPTX_SIDEBAR_DEFAULT_WIDTH;
  return Math.min(PPTX_SIDEBAR_MAX_WIDTH, Math.max(PPTX_SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function currentPptxSidebarWidth() {
  const container = document.getElementById("pptxPreviewContainer");
  const raw = container?.style?.getPropertyValue("--pptx-sidebar-width") || "";
  const parsed = Number.parseFloat(raw);
  return clampPptxSidebarWidth(parsed || PPTX_SIDEBAR_DEFAULT_WIDTH);
}

function syncPptxResizeHandleAria(width = currentPptxSidebarWidth()) {
  const handle = document.getElementById("pptxSidebarResizeHandle");
  if (!handle) return;
  const safeWidth = clampPptxSidebarWidth(width);
  handle.setAttribute("aria-valuemin", String(PPTX_SIDEBAR_MIN_WIDTH));
  handle.setAttribute("aria-valuemax", String(PPTX_SIDEBAR_MAX_WIDTH));
  handle.setAttribute("aria-valuenow", String(safeWidth));
  handle.setAttribute("aria-valuetext", `Slides pane width ${safeWidth} pixels`);
}

function applyPptxSidebarWidth(width, opts = {}) {
  const container = document.getElementById("pptxPreviewContainer");
  if (!container) return;
  const safeWidth = clampPptxSidebarWidth(width);
  container.style.setProperty("--pptx-sidebar-width", `${safeWidth}px`);
  syncPptxResizeHandleAria(safeWidth);
  if (opts.persist !== false) {
    try {
      window.localStorage.setItem(PPTX_SIDEBAR_STORAGE_KEY, String(safeWidth));
    } catch {}
  }
}

function restorePptxSidebarWidth(container) {
  if (!container) return;
  let savedWidth = PPTX_SIDEBAR_DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(PPTX_SIDEBAR_STORAGE_KEY);
    const parsed = Number.parseFloat(raw || "");
    if (Number.isFinite(parsed)) savedWidth = parsed;
  } catch {}
  container.style.setProperty(
    "--pptx-sidebar-width",
    `${clampPptxSidebarWidth(savedWidth)}px`,
  );
}

function schedulePptxLayoutRefresh() {
  requestAnimationFrame(() => {
    if (!pptxViewer) return;
    void showPptxSlide(pptxCurrentSlide);
    buildPptxNavigator();
  });
}

function layoutPptxSlideStage(stage, slideEl, containerEl, fallbackSize = {}) {
  if (!stage || !containerEl) return;
  const { width, height } = getPptxNaturalSlideSize(slideEl, fallbackSize);
  const { width: cw, height: ch } = getElementContentSize(containerEl);
  const scale = cw && ch ? Math.min(cw / width, ch / height) : 1;
  stage.style.width = `${width * scale}px`;
  stage.style.height = `${height * scale}px`;
  if (slideEl) {
    slideEl.style.width = `${width}px`;
    slideEl.style.height = `${height}px`;
    slideEl.style.maxWidth = "none";
    slideEl.style.maxHeight = "none";
    slideEl.style.transform = `scale(${scale})`;
    slideEl.style.transformOrigin = "top left";
  }
  enforcePptxCoverFit(stage);
}

function relayoutCurrentPptxSlide() {
  const mainPane = document.getElementById("pptxMainSlidePane");
  const stage = mainPane?.querySelector(".pptx-preview-stage");
  if (!mainPane || !stage) return;
  const slideEl = getPptxRenderedSlideElement(pptxPreviewSlideHandle, stage);
  layoutPptxSlideStage(stage, slideEl, mainPane, {
    slideWidth: pptxViewer?.slideWidth,
    slideHeight: pptxViewer?.slideHeight,
  });
  stage.style.visibility = "";
}

function schedulePptxLiveRelayout() {
  if (pptxLayoutRefreshRaf) return;
  pptxLayoutRefreshRaf = requestAnimationFrame(() => {
    pptxLayoutRefreshRaf = 0;
    if (!pptxViewer) return;
    relayoutCurrentPptxSlide();
  });
}

function bindPptxSidebarResize(container) {
  const handle = document.getElementById("pptxSidebarResizeHandle");
  if (!container || !handle || handle.dataset.resizeBound === "1") return;
  handle.dataset.resizeBound = "1";
  syncPptxResizeHandleAria();

  const finishResize = () => {
    document.body.classList.remove("is-pptx-sidebar-resizing");
    schedulePptxLayoutRefresh();
  };

  handle.addEventListener("dblclick", () => {
    applyPptxSidebarWidth(PPTX_SIDEBAR_DEFAULT_WIDTH);
    finishResize();
  });

  handle.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 32 : 16;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      applyPptxSidebarWidth(currentPptxSidebarWidth() - step);
      finishResize();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      applyPptxSidebarWidth(currentPptxSidebarWidth() + step);
      finishResize();
    } else if (event.key === "Home") {
      event.preventDefault();
      applyPptxSidebarWidth(PPTX_SIDEBAR_MIN_WIDTH);
      finishResize();
    } else if (event.key === "End") {
      event.preventDefault();
      applyPptxSidebarWidth(PPTX_SIDEBAR_MAX_WIDTH);
      finishResize();
    }
  });

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    const containerRect = container.getBoundingClientRect();
    document.body.classList.add("is-pptx-sidebar-resizing");
    handle.setPointerCapture(pointerId);

    const onPointerMove = (moveEvent) => {
      const nextWidth = clampPptxSidebarWidth(
        moveEvent.clientX - containerRect.left,
      );
      applyPptxSidebarWidth(nextWidth, { persist: false });
      schedulePptxLiveRelayout();
    };

    const onPointerUp = () => {
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerUp);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {}
      applyPptxSidebarWidth(currentPptxSidebarWidth());
      finishResize();
    };

    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerUp);
  });
}

function isQueueItemAutoAdvanceEnabled(index) {
  if (index < 0 || index >= mediaQueue.length) return true;
  return mediaQueue[index]?.autoAdvance !== false;
}

function isNextQueueItemAutoAdvanceEnabled() {
  const nextIndex = currentQueueIndex + 1;
  if (nextIndex < 0 || nextIndex >= mediaQueue.length) return false;
  return isQueueItemAutoAdvanceEnabled(nextIndex);
}

function shouldAutoTransitionToIndex(nextIndex) {
  if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= mediaQueue.length) {
    return false;
  }
  return isQueueItemAutoAdvanceEnabled(nextIndex);
}

function shouldAdvanceAfterCurrentItemEnds() {
  if (loopEnabledForLiveMedia()) return false;
  return shouldAutoTransitionToIndex(nextQueueBoundaryIndex());
}

function nextQueueBoundaryIndex() {
  const cue = currentPreviewCue();
  if (cue && cue.index !== currentQueueIndex) return cue.index;
  const nextIndex = currentQueueIndex + 1;
  if (nextIndex >= 0 && nextIndex < mediaQueue.length) return nextIndex;
  return mediaQueue.length > 0 ? 0 : -1;
}

async function playVideoSafely(mediaEl, context = "") {
  if (!mediaEl || typeof mediaEl.play !== "function") return false;
  if (
    mediaEl === video &&
    (isBiblePath(mediaFile) || activeMediaWindowContentType === "bible")
  ) {
    return false;
  }
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

function nextPptxPreviewRequestToken() {
  pptxPreviewRequestToken += 1;
  return pptxPreviewRequestToken;
}

function isCurrentPptxPreviewRequest(token) {
  return token === pptxPreviewRequestToken;
}

function nextLiveStartToken() {
  liveStartToken += 1;
  return liveStartToken;
}

function isQueueItemBible(item) {
  return Boolean(item && (item.type === "bible" || item.path?.startsWith?.(bibleUriPrefix)));
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

function isQueueItemPptx(item) {
  return Boolean(
    item && (item.type === "pptx" || (item.path && pptxRegex.test(item.path))),
  );
}

function isQueueItemVideo(item) {
  return Boolean(
    item &&
      (item.type === "video" || classifyQueueMediaType(item.path) === "video"),
  );
}

const PREVIEW_SURFACE_LIVE = "live";
const PREVIEW_SURFACE_CUE_VIDEO = "cue-video";
const PREVIEW_SURFACE_CUE_IMAGE = "cue-image";
const PREVIEW_SURFACE_CUE_AUDIO = "cue-audio";
const PREVIEW_SURFACE_PPTX = "pptx";
const PREVIEW_SURFACE_BIBLE = "bible";

function previewStackElement() {
  return document.getElementById("previewStack");
}

function setPreviewStackSurface(surface = PREVIEW_SURFACE_LIVE) {
  const stack = previewStackElement();
  const wrapper = document.querySelector(".video-wrapper");
  if (!stack) return;
  if (stack.dataset.activeSurface === surface && wrapper?.dataset.previewSurface === surface) {
    return;
  }

  stack.dataset.activeSurface = surface;
  if (wrapper) wrapper.dataset.previewSurface = surface;
}

function syncPreviewStackSurface() {
  if (document.getElementById("bibleWorkspace")?.hidden === false) {
    setPreviewStackSurface(PREVIEW_SURFACE_BIBLE);
  } else if (isPptxPreviewVisible()) {
    setPreviewStackSurface(PREVIEW_SURFACE_PPTX);
  } else if (isImagePreviewCueActive()) {
    setPreviewStackSurface(PREVIEW_SURFACE_CUE_IMAGE);
  } else if (isVideoPreviewCueActive()) {
    setPreviewStackSurface(PREVIEW_SURFACE_CUE_VIDEO);
  } else if (isAudioPreviewCueActive()) {
    setPreviewStackSurface(PREVIEW_SURFACE_CUE_AUDIO);
  } else {
    setPreviewStackSurface(PREVIEW_SURFACE_LIVE);
  }
}

function queueItemSupportsCueStartTime(item) {
  return Boolean(
    item &&
      !isQueueItemBible(item) &&
      !isQueueItemImage(item) &&
      !isQueueItemPptx(item) &&
      !isLiveStream(item.path) &&
      (isQueueItemAudio(item) || isQueueItemVideo(item) || item.type === "file"),
  );
}

function queueItemCueStartTime(item) {
  return queueItemSupportsCueStartTime(item) &&
    Number.isFinite(item?.cueStartTime) &&
    item.cueStartTime > 0
    ? item.cueStartTime
    : 0;
}

function resolvePptxPreviewStartSlide(filePath, opts) {
  if (Number.isFinite(opts?.startSlide)) {
    return Math.max(0, Math.floor(opts.startSlide));
  }
  const sameDeck =
    pptxFilePath &&
    normalizeMediaPathForCompare(pptxFilePath) === normalizeMediaPathForCompare(filePath);
  if (sameDeck) return clampPptxSlideIndex(pptxCurrentSlide);
  const queueIndex = findQueueIndexByPath(filePath);
  const savedSlide = queueIndex >= 0 ? mediaQueue[queueIndex]?.pptxSlideIndex : null;
  return isSavedPptxSlideIndex(savedSlide) ? Math.max(0, Math.floor(savedSlide)) : 0;
}

function rememberPptxSlide(filePath, slideIndex) {
  if (!filePath || !Number.isFinite(slideIndex)) return false;
  const safeSlide = Math.max(0, Math.floor(slideIndex));
  const normalized = normalizeMediaPathForCompare(filePath);
  let changed = false;
  mediaQueue.forEach((item) => {
    if (isQueueItemPptx(item) && normalizeMediaPathForCompare(item.path) === normalized) {
      if (item.pptxSlideIndex !== safeSlide) {
        item.pptxSlideIndex = safeSlide;
        changed = true;
      }
    }
  });
  return changed;
}

async function loadPptxPreview(filePath, opts = {}) {
  const requestToken = nextPptxPreviewRequestToken();
  const startSlide = resolvePptxPreviewStartSlide(filePath, opts);
  const preserveLiveAudio = opts?.preserveLiveAudio === true;
  const preserveLiveVideo = opts?.preserveLiveVideo === true;
  const preserveLiveBible = opts?.preserveLiveBible === true;
  const preserveLiveMedia = preserveLiveAudio || preserveLiveVideo || preserveLiveBible;
  // Some third-party ESM bundles expect a Node-like `process` object.
  // Electron renderer (browser context) does not provide it by default.
  if (!globalThis.process) {
    globalThis.process = { env: {} };
  } else if (!globalThis.process.env) {
    globalThis.process.env = {};
  }
  const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import(
    "../node_modules/@aiden0z/pptx-renderer/dist/aiden0z-pptx-renderer.es.js"
  );
  if (!isCurrentPptxPreviewRequest(requestToken)) return;
  const container = document.getElementById("pptxPreviewContainer");
  if (!container) return;
  if (!preserveLiveAudio && !preserveLiveBible) stopLiveAudioPresentation();
  stopPreviewAudioCue();
  clearVideoPreviewCueOverlay();
  if (video && !preserveLiveMedia) {
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch {}
  }
  if (!preserveLiveBible) {
    document
      .getElementById("customControls")
      ?.style.setProperty("visibility", "hidden");
    const videoPreview = document.getElementById("preview");
    if (videoPreview) videoPreview.style.display = "none";
  }
  disposePptxThumbnails();
  if (pptxViewer) {
    try {
      pptxViewer.destroy();
    } catch {}
    pptxViewer = null;
  }
  if (pptxPreviewSlideHandle) {
    try {
      pptxPreviewSlideHandle.dispose();
    } catch {}
    pptxPreviewSlideHandle = null;
  }
  container.innerHTML = "";
  container.style.display = "flex";
  setPreviewStackSurface(PREVIEW_SURFACE_PPTX);
  ensurePptxPreviewShell(container);
  const arrayBuffer = await invoke("read-file-as-arraybuffer", filePath);
  if (!isCurrentPptxPreviewRequest(requestToken)) return;
  const viewerHost = ensurePptxViewerHost();
  viewerHost.innerHTML = "";
  const openedViewer = await PptxViewer.open(arrayBuffer, viewerHost, {
    zipLimits: RECOMMENDED_ZIP_LIMITS,
    fitMode: "contain",
    renderMode: "slide",
    // `renderMode: "slide"` keeps preview cheap; these options apply if the
    // viewer is later asked to render a list (windowed mounting by default).
    listOptions: getPptxListRenderOptions(),
  });
  if (!isCurrentPptxPreviewRequest(requestToken)) {
    try {
      openedViewer?.destroy?.();
    } catch {}
    return;
  }
  pptxViewer = openedViewer;
  pptxFilePath = filePath;
  pptxSlideCount = pptxViewer.slideCount ?? pptxViewer.slides?.length ?? 1;
  buildPptxNavigator();
  if (container.dataset.pptxResizeBound !== "1") {
    container.dataset.pptxResizeBound = "1";
    window.addEventListener("resize", () => {
      if (!pptxViewer) return;
      ensurePptxPreviewShell(container);
      void showPptxSlide(pptxCurrentSlide);
      buildPptxNavigator();
    });
  }
  await showPptxSlide(clampPptxSlideIndex(startSlide, pptxSlideCount));
  if (!isCurrentPptxPreviewRequest(requestToken)) return;
  if (rememberPptxSlide(filePath, pptxCurrentSlide)) {
    scheduleAutosaveProjectState();
  }
  setPreviewStackSurface(PREVIEW_SURFACE_PPTX);
  if (preserveLiveMedia) {
    syncPreviewAudioTrackState();
  }
}

function disposePptxThumbnails() {
  if (pptxThumbnailObserver) {
    try {
      pptxThumbnailObserver.disconnect();
    } catch {}
    pptxThumbnailObserver = null;
  }
  pptxThumbnailHandles.forEach((handle) => {
    try {
      handle?.dispose?.();
    } catch {}
  });
  pptxThumbnailHandles.clear();
}

function ensurePptxViewerHost() {
  if (pptxViewerHost?.isConnected) return pptxViewerHost;
  pptxViewerHost = document.createElement("div");
  pptxViewerHost.id = "pptxRendererHost";
  pptxViewerHost.setAttribute("aria-hidden", "true");
  document.body.appendChild(pptxViewerHost);
  return pptxViewerHost;
}

function disposePptxViewerHost() {
  if (!pptxViewerHost) return;
  try {
    pptxViewerHost.remove();
  } catch {}
  pptxViewerHost = null;
}

function ensurePptxPreviewShell(container) {
  let mainPane = document.getElementById("pptxMainSlidePane");
  let thumbnailList = document.getElementById("pptxThumbnailList");
  if (mainPane && thumbnailList) return { mainPane, thumbnailList };

  container.innerHTML = "";
  restorePptxSidebarWidth(container);
  const sidebar = document.createElement("aside");
  sidebar.id = "pptxSlideNavigator";
  sidebar.setAttribute("aria-label", "PowerPoint slide navigator");

  const heading = document.createElement("div");
  heading.className = "pptx-slide-navigator__heading";
  heading.textContent = "Slides";

  thumbnailList = document.createElement("div");
  thumbnailList.id = "pptxThumbnailList";
  thumbnailList.className = "pptx-thumbnail-list";
  thumbnailList.setAttribute("role", "listbox");
  thumbnailList.setAttribute("aria-label", "PowerPoint slides");

  mainPane = document.createElement("div");
  mainPane.id = "pptxMainSlidePane";
  mainPane.setAttribute("aria-label", "Selected PowerPoint slide");

  const resizeHandle = document.createElement("div");
  resizeHandle.id = "pptxSidebarResizeHandle";
  resizeHandle.className = "pptx-sidebar-resize-handle";
  resizeHandle.setAttribute("role", "separator");
  resizeHandle.setAttribute("aria-label", "Resize slides pane");
  resizeHandle.setAttribute("aria-orientation", "vertical");
  resizeHandle.tabIndex = 0;

  sidebar.appendChild(heading);
  sidebar.appendChild(thumbnailList);
  container.appendChild(sidebar);
  container.appendChild(resizeHandle);
  container.appendChild(mainPane);
  bindPptxSidebarResize(container);
  return { mainPane, thumbnailList };
}

function updatePptxNavigatorSelection() {
  const thumbnailList = document.getElementById("pptxThumbnailList");
  if (!thumbnailList) return;
  thumbnailList.querySelectorAll(".pptx-thumbnail-button").forEach((button) => {
    const isActive = Number(button.dataset.slideIndex) === pptxCurrentSlide;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
    button.tabIndex = isActive ? 0 : -1;
  });
  const active = thumbnailList.querySelector(".pptx-thumbnail-button.is-active");
  active?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
}

async function renderPptxThumbnail(index, button, opts = {}) {
  if (!pptxViewer || !button?.isConnected) return;
  const force = opts?.force === true;
  const viewport = button.querySelector(".pptx-thumbnail-viewport");
  if (!viewport) return;
  const existingHandle = pptxThumbnailHandles.get(index);
  if (existingHandle) {
    if (
      !force &&
      existingHandle.element &&
      viewport.contains(existingHandle.element)
    ) {
      return;
    }
    try {
      existingHandle.dispose?.();
    } catch {}
    pptxThumbnailHandles.delete(index);
  }
  viewport.innerHTML = "";
  const { width } = getElementContentSize(viewport);
  const thumbnailWidth = Math.max(
    1,
    Math.round(width || viewport.clientWidth || 96),
  );

  let handle = null;
  try {
    handle = pptxViewer.renderThumbnailToContainer(index, viewport, {
      width: thumbnailWidth,
    });
  } catch (err) {
    console.error("Failed to render PPTX thumbnail:", err);
  }
  if (!handle) return;
  handle.element?.classList?.add("pptx-thumbnail-stage");
  if (handle.element) handle.element.style.visibility = "hidden";
  pptxThumbnailHandles.set(index, handle);
  try {
    await handle.ready;
  } catch (err) {
    console.error("Failed to finish PPTX thumbnail render:", err);
  }
  if (
    pptxThumbnailHandles.get(index) !== handle ||
    !button.isConnected
  ) {
    return;
  }
  enforcePptxCoverFit(handle.element);
  if (handle.element) handle.element.style.visibility = "";
}

function unmountPptxThumbnail(index, button) {
  const handle = pptxThumbnailHandles.get(index);
  if (!handle) return;
  const viewport = button?.querySelector?.(".pptx-thumbnail-viewport");
  try {
    handle.dispose?.();
  } catch {}
  if (viewport) viewport.innerHTML = "";
  pptxThumbnailHandles.delete(index);
}

function refreshVisiblePptxThumbnails() {
  const thumbnailList = document.getElementById("pptxThumbnailList");
  if (!pptxViewer || !thumbnailList) return;
  const listRect = thumbnailList.getBoundingClientRect();
  thumbnailList.querySelectorAll(".pptx-thumbnail-button").forEach((button) => {
    const index = Number(button.dataset.slideIndex);
    if (!Number.isFinite(index)) return;
    const rect = button.getBoundingClientRect();
    const isVisible =
      rect.bottom >= listRect.top - 240 && rect.top <= listRect.bottom + 240;
    if (isVisible) void renderPptxThumbnail(index, button, { force: true });
  });
}

function schedulePptxThumbnailRefresh() {
  requestAnimationFrame(() => {
    refreshVisiblePptxThumbnails();
    requestAnimationFrame(refreshVisiblePptxThumbnails);
  });
}

function buildPptxNavigator() {
  const container = document.getElementById("pptxPreviewContainer");
  if (!container) return;
  if (container.dataset.stopMediaToggleBound !== "1") {
    container.dataset.stopMediaToggleBound = "1";
    container.addEventListener("click", (event) => event.stopPropagation());
    container.addEventListener("dblclick", (event) => event.stopPropagation());
  }
  const { thumbnailList } = ensurePptxPreviewShell(container);
  disposePptxThumbnails();
  thumbnailList.innerHTML = "";

  for (let i = 0; i < pptxSlideCount; i++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pptx-thumbnail-button";
    button.dataset.slideIndex = String(i);
    button.setAttribute("role", "option");
    button.setAttribute("aria-label", `Go to slide ${i + 1}`);
    button.innerHTML = `
      <span class="pptx-thumbnail-number">${i + 1}</span>
      <span class="pptx-thumbnail-viewport"></span>
    `;
    button.addEventListener("click", () => {
      void jumpToPptxSlide(i);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = thumbnailList.querySelector(
          `.pptx-thumbnail-button[data-slide-index="${Math.min(i + 1, pptxSlideCount - 1)}"]`,
        );
        next?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const prev = thumbnailList.querySelector(
          `.pptx-thumbnail-button[data-slide-index="${Math.max(i - 1, 0)}"]`,
        );
        prev?.focus();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void jumpToPptxSlide(i);
      }
    });
    thumbnailList.appendChild(button);
  }

  if ("IntersectionObserver" in window) {
    pptxThumbnailObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const index = Number(entry.target.dataset.slideIndex);
          if (!Number.isFinite(index)) return;
          if (entry.isIntersecting) {
            void renderPptxThumbnail(index, entry.target);
          } else {
            unmountPptxThumbnail(index, entry.target);
          }
        });
      },
      {
        root: thumbnailList,
        rootMargin: "240px 0px",
      },
    );
    thumbnailList.querySelectorAll(".pptx-thumbnail-button").forEach((button) => {
      pptxThumbnailObserver.observe(button);
    });
  } else {
    thumbnailList.querySelectorAll(".pptx-thumbnail-button").forEach((button) => {
      const index = Number(button.dataset.slideIndex);
      if (Number.isFinite(index)) void renderPptxThumbnail(index, button);
    });
  }
  updatePptxNavigatorSelection();
}

async function showPptxSlide(index) {
  const container = document.getElementById("pptxPreviewContainer");
  if (!container) return;
  const { mainPane } = ensurePptxPreviewShell(container);
  const slideIndex = clampPptxSlideIndex(index);
  if (pptxPreviewSlideHandle) {
    try {
      pptxPreviewSlideHandle.dispose();
    } catch {}
    pptxPreviewSlideHandle = null;
  }
  mainPane.innerHTML = "";
  const stage = document.createElement("div");
  stage.className = "pptx-preview-stage";
  stage.style.visibility = "hidden";
  mainPane.appendChild(stage);
  try {
    pptxPreviewSlideHandle = pptxViewer?.renderSlideToContainer(slideIndex, stage, 1) || null;
  } catch {}
  await waitForNextFrame();
  const slideEl = getPptxRenderedSlideElement(pptxPreviewSlideHandle, stage);
  layoutPptxSlideStage(stage, slideEl, mainPane, {
    slideWidth: pptxViewer?.slideWidth,
    slideHeight: pptxViewer?.slideHeight,
  });
  stage.style.visibility = "";
  pptxCurrentSlide = slideIndex;
  updatePptxNavigatorSelection();
}

function sendPptxSlideToMediaWindow(slideIndex) {
  send("pptx-goto-slide", { slideIndex, filePath: pptxFilePath });
}

function pptxStartSlideForItem(item) {
  if (!isQueueItemPptx(item)) return 0;
  const sameDeck =
    pptxFilePath &&
    item?.path &&
    normalizeMediaPathForCompare(pptxFilePath) === normalizeMediaPathForCompare(item.path);
  if (sameDeck) return clampPptxSlideIndex(pptxCurrentSlide);
  const savedSlide = isSavedPptxSlideIndex(item?.pptxSlideIndex)
    ? item.pptxSlideIndex
    : null;
  return isSavedPptxSlideIndex(savedSlide) ? clampPptxSlideIndex(savedSlide) : 0;
}

async function jumpToPptxSlide(index) {
  await showPptxSlide(index);
  if (pptxFilePath && rememberPptxSlide(pptxFilePath, pptxCurrentSlide)) {
    scheduleAutosaveProjectState();
  }
  if (isActiveMediaWindow() && activeMediaWindowContentType === "pptx") {
    sendPptxSlideToMediaWindow(pptxCurrentSlide);
  }
}

function hidePptxPreview(options = {}) {
  nextPptxPreviewRequestToken();
  const restoreVideoPreview = options.restoreVideoPreview !== false;
  const container = document.getElementById("pptxPreviewContainer");
  if (container) container.style.display = "none";
  const videoPreview = document.getElementById("preview");
  if (videoPreview && restoreVideoPreview) videoPreview.style.display = "";
  if (mediaFile && isImg(mediaFile)) {
    document
      .getElementById("customControls")
      ?.style.setProperty("visibility", "hidden");
  } else {
    document.getElementById("customControls")?.style.setProperty("visibility", "");
  }
  if (pptxViewer) {
    try {
      pptxViewer.destroy();
    } catch {}
    pptxViewer = null;
  }
  disposePptxThumbnails();
  disposePptxViewerHost();
  pptxFilePath = null;
  pptxSlideCount = 0;
  pptxCurrentSlide = 0;
  syncPreviewStackSurface();
}

function isPptxPreviewVisible() {
  const container = document.getElementById("pptxPreviewContainer");
  return Boolean(
    pptxViewer ||
      (container && container.style.display !== "none" && container.style.display !== ""),
  );
}

function hidePptxPreviewIfNeeded(options = {}) {
  if (isPptxPreviewVisible()) hidePptxPreview(options);
}

function restoreNonPptxPreviewSurface(options = {}) {
  const isImage = options.isImage === true;
  hidePptxPreviewIfNeeded({ restoreVideoPreview: !isImage });
  restoreLivePreview();
  resolveQueuePresentationVideo();
  setPreviewStackSurface(PREVIEW_SURFACE_LIVE);

  if (!isImage) {
    const liveImg = document.querySelector("img#preview");
    if (liveImg) {
      liveImg.remove();
      liveImg.src = "";
    }
    const previewEl = document.querySelector("video#preview");
    if (previewEl) {
      video = previewEl;
      previewEl.hidden = false;
      previewEl.style.display = "";
      previewEl.style.visibility = "";
    }
  }
}

function resetPreviewSurfaceToEmptyState() {
  stopLiveAudioPresentation();
  stopPreviewAudioCue();
  clearVideoPreviewCueOverlay();
  hidePptxPreview({ restoreVideoPreview: true });
  resetPreviewWarningState();

  const previewImg = document.querySelector(".video-wrapper img#preview");
  if (previewImg) {
    previewImg.remove();
    previewImg.src = "";
  }

  const previewVideo = document.querySelector(".video-wrapper video#preview");
  if (previewVideo) {
    video = previewVideo;
    try {
      previewVideo.pause();
      previewVideo.removeAttribute("src");
      previewVideo.removeAttribute("poster");
      previewVideo.src = "";
      previewVideo.load();
    } catch (err) {
      console.error("Failed to reset preview surface:", err);
    }
    previewVideo.hidden = false;
    previewVideo.style.display = "";
    previewVideo.style.visibility = "";
  }

  mediaFile = "";
  prePathname = "";
  startTime = 0;
  targetTime = 0;
  audioOnlyFile = false;
  playingMediaAudioOnly = false;
  localTimeStampUpdateIsRunning = false;
  mediaPlayerInputState.clear();
  setMediaCountdownText("");
  pendingCueVolume = null;
  cueVolumeDirty = false;
  setMediaCountdownOverlayVisible(false);
  document
    .getElementById("customControls")
    ?.style.setProperty("visibility", "hidden");
  removeFilenameFromTitlebar();
  syncGtkSliderToCueState();
  updatePreviewCueUI();
  updatePreviewEmptyState();
}

function currentPptxPreviewFilePath() {
  if (mediaFile && pptxRegex.test(mediaFile)) return mediaFile;
  const liveItem = currentLiveQueueItem();
  if (isQueuePresentationActive() && isQueueItemPptx(liveItem)) return liveItem.path;
  return null;
}

function savedPptxSlideForPath(filePath) {
  const queueIndex = findQueueIndexByPath(filePath);
  const savedSlide = queueIndex >= 0 ? mediaQueue[queueIndex]?.pptxSlideIndex : null;
  return isSavedPptxSlideIndex(savedSlide) ? savedSlide : undefined;
}

async function getLivePptxSlideFromMediaWindow(filePath) {
  if (!isActiveMediaWindow()) return undefined;
  try {
    const slide = await invoke("get-pptx-current-slide");
    if (!isSavedPptxSlideIndex(slide)) return undefined;
    rememberPptxSlide(filePath, slide);
    return slide;
  } catch (err) {
    console.error("Failed to get current PPTX slide from media window:", err);
    return undefined;
  }
}

async function syncCurrentPptxSlideForProjectSnapshot() {
  const pptxPath = currentPptxPreviewFilePath();
  if (!pptxPath) return;

  const liveSlide = await getLivePptxSlideFromMediaWindow(pptxPath);
  if (isSavedPptxSlideIndex(liveSlide)) return;

  const samePreviewDeck =
    pptxFilePath &&
    normalizeMediaPathForCompare(pptxFilePath) === normalizeMediaPathForCompare(pptxPath);
  if (samePreviewDeck && isSavedPptxSlideIndex(pptxCurrentSlide)) {
    rememberPptxSlide(pptxPath, pptxCurrentSlide);
  }
}

async function restorePptxPreviewForMediaTab() {
  if (isNonPptxPreviewCueActive()) return;
  const pptxPath = currentPptxPreviewFilePath();
  if (!pptxPath) return;

  mediaFile = pptxPath;
  mediaPlayerInputState.filePaths = [pptxPath];
  const queueIndex = findQueueIndexByPath(pptxPath);
  if (queueIndex >= 0) updateQueueFileLabel(mediaQueue[queueIndex].name);

  const container = document.getElementById("pptxPreviewContainer");
  const liveSlide = await getLivePptxSlideFromMediaWindow(pptxPath);
  if (isNonPptxPreviewCueActive()) return;
  const savedSlide = isSavedPptxSlideIndex(liveSlide)
    ? liveSlide
    : savedPptxSlideForPath(pptxPath);
  const sameDeck =
    pptxViewer &&
    pptxFilePath &&
    normalizeMediaPathForCompare(pptxFilePath) === normalizeMediaPathForCompare(pptxPath);

  if (sameDeck) {
    const videoPreview = document.querySelector("video#preview");
    const imagePreview = document.querySelector("img#preview");
    if (videoPreview) videoPreview.style.display = "none";
    if (imagePreview) imagePreview.style.display = "none";
    if (container) container.style.display = "flex";
    setPreviewStackSurface(PREVIEW_SURFACE_PPTX);
    if (isSavedPptxSlideIndex(savedSlide) && savedSlide !== pptxCurrentSlide) {
      await showPptxSlide(savedSlide);
    } else {
      updatePptxNavigatorSelection();
    }
  } else {
    await loadPptxPreview(pptxPath, {
      startSlide: savedSlide,
      preserveLiveAudio: isLocalAppWindowPresentationActive(),
    });
  }

  document
    .getElementById("customControls")
    ?.style.setProperty("visibility", "hidden");
}

function isLikelyVideoItem(filePath) {
  return classifyQueueMediaType(filePath) === "video";
}

function isLikelyAudioItem(filePath) {
  return classifyQueueMediaType(filePath) === "audio";
}

function currentPreviewSourcePath() {
  const src = video?.src || "";
  return mediaFile || (src.startsWith("file://") ? removeFileProtocol(decodeURI(src)) : src);
}

function mediaPathSupportsLoop(filePath) {
  if (!filePath || typeof filePath !== "string") return false;
  if (isBiblePath(filePath) || pptxRegex.test(filePath) || isImg(filePath)) {
    return false;
  }
  if (isLiveStream(filePath)) return false;
  const type = classifyQueueMediaType(filePath);
  return type === "video" || type === "audio" || type === "file";
}

function mediaLoopKey(filePath) {
  return normalizeMediaPathForCompare(filePath);
}

function queueItemSupportsLoop(item) {
  return Boolean(item && mediaPathSupportsLoop(item.path));
}

function loopEnabledForQueueItem(item) {
  return queueItemSupportsLoop(item) && item.loop === true;
}

function queueLoopTarget(index) {
  if (!Number.isInteger(index) || index < 0 || index >= mediaQueue.length) {
    return null;
  }
  const item = mediaQueue[index];
  return item ? { type: "queue", index, item, path: item.path } : null;
}

function pathLoopTarget(filePath) {
  return filePath ? { type: "path", path: filePath } : null;
}

function liveLoopTarget(filePath = mediaFile) {
  if (
    liveAudioQueueIndex >= 0 &&
    liveAudioQueueIndex < mediaQueue.length &&
    queueItemSupportsLoop(mediaQueue[liveAudioQueueIndex]) &&
    (playingMediaAudioOnly || liveAudio?.src)
  ) {
    return queueLoopTarget(liveAudioQueueIndex);
  }
  if (
    currentQueueIndex >= 0 &&
    currentQueueIndex < mediaQueue.length &&
    queueItemSupportsLoop(mediaQueue[currentQueueIndex])
  ) {
    return queueLoopTarget(currentQueueIndex);
  }
  return pathLoopTarget(filePath);
}

function loopControlTarget() {
  const cue = currentPreviewCue();
  if (cue && queueItemSupportsLoop(cue.item)) {
    return queueLoopTarget(cue.index);
  }
  const liveTarget = liveLoopTarget();
  if (loopTargetSupportsLoop(liveTarget)) {
    return liveTarget;
  }
  return pathLoopTarget(currentPreviewSourcePath());
}

function loopTargetSupportsLoop(target) {
  if (!target) return false;
  if (target.item) return queueItemSupportsLoop(target.item);
  return mediaPathSupportsLoop(target.path);
}

function loopEnabledForMediaPath(filePath) {
  const key = mediaLoopKey(filePath);
  return Boolean(key && mediaPathSupportsLoop(filePath) && mediaLoopByPath.get(key));
}

function loopTargetEnabled(target) {
  if (!loopTargetSupportsLoop(target)) return false;
  if (target.item) return loopEnabledForQueueItem(target.item);
  return loopEnabledForMediaPath(target.path);
}

function loopEnabledForLiveMedia(filePath = mediaFile) {
  return loopTargetEnabled(liveLoopTarget(filePath));
}

function setLoopTargetEnabled(target, enabled) {
  if (!loopTargetSupportsLoop(target)) return false;
  if (target.item) {
    target.item.loop = !!enabled;
    return true;
  }
  const key = mediaLoopKey(target.path);
  if (!key) return false;
  if (enabled) {
    mediaLoopByPath.set(key, true);
  } else {
    mediaLoopByPath.delete(key);
  }
  return true;
}

function applyLoopStateToPreviewMedia() {
  const liveEnabled = loopEnabledForLiveMedia();
  const cue = currentPreviewCue();
  const cueEnabled = cue ? loopTargetEnabled(queueLoopTarget(cue.index)) : false;
  if (video) {
    video.loop = liveEnabled;
  }
  if (liveAudio) {
    liveAudio.loop = liveEnabled;
  }
  if (previewAudio) {
    previewAudio.loop = isAudioPreviewCueActive() && cueEnabled;
  }
  if (previewCueVideo) {
    previewCueVideo.loop = isVideoPreviewCueActive() && cueEnabled;
  }
  return loopTargetEnabled(loopControlTarget());
}

function updateLoopControlState() {
  const target = loopControlTarget();
  const supportsLoop = loopTargetSupportsLoop(target);
  const active = loopTargetEnabled(target);
  const loopBadge = document.getElementById("loopStatusBadge");
  const wrapper = videoWrapper || document.querySelector(".video-wrapper");

  if (repeatButton) {
    repeatButton.classList.toggle("active", active);
    repeatButton.disabled = !supportsLoop;
    repeatButton.setAttribute("aria-pressed", active ? "true" : "false");
    repeatButton.setAttribute("aria-disabled", supportsLoop ? "false" : "true");
    repeatButton.title = supportsLoop
      ? active
        ? "Loop on for this item - auto advance paused"
        : "Loop off for this item"
      : "Loop unavailable for this item";
  }
  if (loopBadge) {
    loopBadge.hidden = !active;
  }
  if (wrapper) {
    wrapper.dataset.loopActive = active ? "true" : "false";
  }
}

function activeMediaWindowSupportsLoop() {
  const target = liveLoopTarget();
  return Boolean(
    isActiveMediaWindow() &&
      activeMediaWindowContentType === "video" &&
      loopTargetSupportsLoop(target),
  );
}

async function notifyMediaWindowLoopState() {
  if (!activeMediaWindowSupportsLoop()) return;
  try {
    await invoke("set-media-loop-status", loopEnabledForLiveMedia());
  } catch (err) {
    console.error("Failed to sync media window loop state:", err);
  }
}

function syncMediaLoopState({ notify = true } = {}) {
  applyLoopStateToPreviewMedia();
  updateLoopControlState();
  if (notify) {
    void notifyMediaWindowLoopState();
  }
}

function setMediaLoopEnabled(enabled, options) {
  const target = options?.target || loopControlTarget();
  if (!setLoopTargetEnabled(target, enabled)) {
    updateLoopControlState();
    return;
  }
  saveMediaFile();
  syncMediaLoopState(options);
}

function toggleMediaLoopEnabled() {
  const target = loopControlTarget();
  if (!loopTargetSupportsLoop(target)) {
    updateLoopControlState();
    return;
  }
  setMediaLoopEnabled(!loopTargetEnabled(target), { target });
}

function mediaElementHasTracks(mediaEl, trackName) {
  const tracks = mediaEl?.[trackName];
  return Boolean(tracks && typeof tracks.length === "number" && tracks.length > 0);
}

function mediaElementLoadedAudioOnly(mediaEl, filePath) {
  if (isLikelyAudioItem(filePath)) return true;
  if (isBiblePath(filePath)) return false;
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

function currentLiveQueueItem() {
  return currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
    ? mediaQueue[currentQueueIndex]
    : null;
}

function queueIndexIsCurrentLivePresentation(index) {
  return Boolean(
    index >= 0 &&
      index < mediaQueue.length &&
      index === currentQueueIndex &&
      (isQueuePresentationActive() ||
        isActiveMediaWindow() ||
        isLocalAppWindowPresentationActive()),
  );
}

function queueIndexMatchesCurrentLiveOutput(index) {
  if (!isQueuePresentationActive()) return false;
  if (index < 0 || index >= mediaQueue.length) return false;
  const item = mediaQueue[index];
  if (!item?.path || !mediaFile) return false;
  return (
    normalizeMediaPathForCompare(mediaFile) ===
    normalizeMediaPathForCompare(item.path)
  );
}

function currentLiveQueueItemForSwitchPrompt() {
  return queueIndexMatchesCurrentLiveOutput(currentQueueIndex)
    ? currentLiveQueueItem()
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
    startTime: queueItemCueStartTime(item),
  };
}

function isNonPptxPreviewCueActive() {
  const cue = currentPreviewCue();
  return Boolean(cue && !isQueueItemPptx(cue.item));
}

function currentAudioPreviewQueueIndex() {
  const cue = currentPreviewCue();
  if (cue && isQueueItemAudio(cue.item) && isAudioPreviewCueActive()) {
    return cue.index;
  }

  const source = mediaFile || video?.src || "";
  const queueIndex = findQueueIndexByPath(source);
  if (queueIndex >= 0 && isQueueItemAudio(mediaQueue[queueIndex])) {
    return queueIndex;
  }

  if (
    currentQueueIndex >= 0 &&
    currentQueueIndex < mediaQueue.length &&
    isQueueItemAudio(mediaQueue[currentQueueIndex])
  ) {
    return currentQueueIndex;
  }

  return -1;
}

function queueStartIndexForPresent() {
  const cue = currentPreviewCue();
  if (cue) {
    return cue.index;
  }
  if (currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length) {
    return currentQueueIndex;
  }
  return 0;
}

function currentCueEditableQueueIndex() {
  const explicitCue = currentPreviewCue();
  if (explicitCue && queueItemSupportsCueStartTime(explicitCue.item)) {
    return explicitCue.index;
  }

  // Before pressing Present, the selected/previewed queue item is still
  // allowed to receive a cue start time. This lets the operator prep the
  // queue before going live.
  if (
    currentMode === MEDIAPLAYER &&
    !isQueuePresentationActive() &&
    currentQueueIndex >= 0 &&
    currentQueueIndex < mediaQueue.length &&
    queueItemSupportsCueStartTime(mediaQueue[currentQueueIndex])
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
    startTime: queueItemCueStartTime(item),
    implicit: true,
  };
}

function currentImplicitPreviousItem() {
  if (mediaQueue.length === 0) return null;
  let prevIdx = -1;
  if (currentQueueIndex > 0 && currentQueueIndex < mediaQueue.length) {
    prevIdx = currentQueueIndex - 1;
  }
  if (prevIdx < 0) return null;
  const item = mediaQueue[prevIdx];
  if (!item) return null;
  return {
    index: prevIdx,
    item,
    startTime: queueItemCueStartTime(item),
    implicit: true,
  };
}

function isQueuePresentationActive() {
  return Boolean(
    isQueuePlaying &&
      (isPlaying || isActiveMediaWindow() || isLocalAppWindowPresentationActive()),
  );
}

function isBiblePresentationActive() {
  return isActiveMediaWindow() && activeMediaWindowContentType === "bible";
}

function isPreparingSeparateCue() {
  const presentationActive =
    isQueuePresentationActive() || isActiveMediaWindow() || isLocalAppWindowPresentationActive();
  return Boolean(
    currentMode === MEDIAPLAYER &&
      presentationActive &&
      previewCueIndex >= 0 &&
      previewCueIndex < mediaQueue.length &&
      (currentQueueIndex < 0 || previewCueIndex !== currentQueueIndex),
  );
}

function shouldSuppressPreviewForwarding() {
  return suppressPreviewForwarding || isPreparingSeparateCue();
}

function updatePreviewCueUI() {
  const liveItem = isQueuePresentationActive() ? currentLiveQueueItem() : null;
  const explicitCue = currentPreviewCue();
  const implicitPrev = currentImplicitPreviousItem();
  const implicitNext = currentImplicitNextItem();
  const selectedItem =
    !liveItem && currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
      ? { index: currentQueueIndex, item: mediaQueue[currentQueueIndex] }
      : null;
  const prevUp = implicitPrev;
  const nextUp = explicitCue ?? implicitNext ?? selectedItem;
  const nowPlaying = document.getElementById("nowPlayingLabel");
  const upPrev = document.getElementById("upPrevLabel");
  const upNext = document.getElementById("upNextLabel");
  const audioCuePanel = document.getElementById("audioCuePanel");

  if (nowPlaying) {
    nowPlaying.textContent = liveItem
      ? liveItem.name
      : selectedItem
        ? selectedItem.item.name
        : isPlaying
        ? getHostnameOrBasename(mediaFile || "Presentation active")
        : "No file selected";
    nowPlaying.title = nowPlaying.textContent;
  }

  if (upPrev) {
    upPrev.textContent = prevUp ? prevUp.item.name : "No previous item";
    upPrev.title = upPrev.textContent;
  }

  if (upNext) {
    upNext.textContent = nextUp ? nextUp.item.name : "No next item selected";
    upNext.title = upNext.textContent;
  }

  if (audioCuePanel) {
    audioCuePanel.hidden = true;
  }
}

function updateQueueItemCueStartDisplay(index) {
  const item = mediaQueue[index];
  const row = document.querySelector(`.queue-item[data-queue-index="${index}"]`);
  const itemText = row?.querySelector(".item-text");
  if (!item || !row || !itemText) return false;

  const cueStartTime = queueItemCueStartTime(item);
  let statusRow = row.querySelector(".item-status-row");
  let cueStartEl = row.querySelector(".item-cue-start");

  if (cueStartTime > 0) {
    if (!statusRow) {
      statusRow = document.createElement("span");
      statusRow.className = "item-status-row";
      itemText.appendChild(statusRow);
    }
    if (!cueStartEl) {
      cueStartEl = document.createElement("span");
      cueStartEl.className = "item-cue-start";
      statusRow.appendChild(cueStartEl);
    }
    cueStartEl.textContent = `Start @ ${formatCueTime(cueStartTime)}`;
  } else if (cueStartEl) {
    cueStartEl.remove();
    if (statusRow && !statusRow.querySelector(".state-badge, .item-cue-start")) {
      statusRow.remove();
    }
  }

  return true;
}

function setCueStartTime(index, start, opts = {}) {
  if (index < 0 || index >= mediaQueue.length) return;
  const render = opts?.render !== false;
  if (!queueItemSupportsCueStartTime(mediaQueue[index])) {
    if (Number.isFinite(mediaQueue[index]?.cueStartTime) && mediaQueue[index].cueStartTime !== 0) {
      mediaQueue[index].cueStartTime = 0;
      if (render) {
        renderQueue();
      } else {
        updateQueueItemCueStartDisplay(index);
      }
      scheduleAutosaveProjectState();
    }
    return;
  }
  const itemDuration =
    Number.isFinite(mediaQueue[index]?.duration) && mediaQueue[index].duration > 0
      ? mediaQueue[index].duration
      : 0;
  const safe = clampQueueStartTime(start, itemDuration);
  const prev = Number.isFinite(mediaQueue[index].cueStartTime) ? mediaQueue[index].cueStartTime : 0;
  if (Math.abs(prev - safe) < 0.001) return;
  mediaQueue[index].cueStartTime = safe;
  if (previewCueIndex === index) {
    updatePreviewCueUI();
  }
  if (render) {
    renderQueue();
  } else {
    updateQueueItemCueStartDisplay(index);
  }
  scheduleAutosaveProjectState();
}

function trackedPreviewQueueIndexForMedia(mediaEl) {
  if (!mediaEl || currentMode !== MEDIAPLAYER) return -1;

  if (mediaEl === previewAudio) {
    return isAudioPreviewCueActive() ? previewCueIndex : -1;
  }

  if (previewCueVideo && mediaEl === previewCueVideo) {
    return isVideoPreviewCueActive() ? previewCueIndex : -1;
  }

  if (mediaEl === video) {
    if (
      isBibleWorkspaceVisible() &&
      !isQueuePresentationActive() &&
      !isActiveMediaWindow() &&
      !isLocalAppWindowPresentationActive()
    ) {
      return -1;
    }
    if (isQueuePresentationActive() || isLocalAppWindowPresentationActive()) {
      return -1;
    }
    if (currentQueueIndex < 0 || currentQueueIndex >= mediaQueue.length) {
      return -1;
    }
    return currentQueueIndex;
  }

  return -1;
}

function syncTrackedPreviewStartTime(mediaEl, opts = {}) {
  const index = trackedPreviewQueueIndexForMedia(mediaEl);
  if (index < 0) return;
  if (!queueItemSupportsCueStartTime(mediaQueue[index])) return;
  const duration =
    Number.isFinite(mediaEl?.duration) && mediaEl.duration > 0
      ? mediaEl.duration
      : Number.isFinite(mediaQueue[index]?.duration) && mediaQueue[index].duration > 0
        ? mediaQueue[index].duration
        : 0;
  const rawNextTime =
    Number.isFinite(mediaEl?.currentTime) && mediaEl.currentTime > 0 ? mediaEl.currentTime : 0;
  const nextTime = clampQueueStartTime(rawNextTime, duration);
  const prevTime = queueItemCueStartTime(mediaQueue[index]);
  if (!opts.force && Math.abs(prevTime - nextTime) < 0.2) {
    return;
  }
  setCueStartTime(index, nextTime, { render: opts.render === true });
}

function setActiveCueVolume(vol) {
  pendingCueVolume = vol;
  cueVolumeDirty = true;
  if (previewCueIndex >= 0 && previewCueIndex < mediaQueue.length) {
    mediaQueue[previewCueIndex].cueVolume = vol;
  }
}

function isPreviewCueVolumeActive() {
  return previewCueIndex >= 0;
}

/** Slider level while a cue is loaded — stored cueVolume wins over live mirror. */
function getPreviewCueDisplayVolume() {
  if (previewCueIndex < 0 || previewCueIndex >= mediaQueue.length) {
    return null;
  }
  const item = mediaQueue[previewCueIndex];
  if (Number.isFinite(item?.cueVolume)) return item.cueVolume;
  if (pendingCueVolume !== null) return pendingCueVolume;
  return video?.muted ? 0 : (video?.volume ?? 1);
}

/** Persist the in-memory cue slider value onto the active queue entry. */
function commitActiveCueVolume() {
  if (
    !cueVolumeDirty ||
    previewCueIndex < 0 ||
    previewCueIndex >= mediaQueue.length ||
    pendingCueVolume === null
  ) {
    return;
  }
  mediaQueue[previewCueIndex].cueVolume = pendingCueVolume;
  cueVolumeDirty = false;
}

function resolveQueueItemPlaybackVolume(index) {
  if (index >= 0 && index < mediaQueue.length) {
    const itemVol = mediaQueue[index].cueVolume;
    if (Number.isFinite(itemVol)) return itemVol;
  }
  if (pendingCueVolume !== null) return pendingCueVolume;
  return null;
}

function clearPreviewCue() {
  commitActiveCueVolume();
  stopPreviewAudioCue();
  clearVideoPreviewCueOverlay();
  previewCueIndex = -1;
  pendingCueVolume = null;
  cueVolumeDirty = false;
  syncGtkSliderToCueState();
  if (isBiblePresentationActive()) showBibleWorkspace();
  restoreCountdownForLiveMedia();
  syncMediaLoopState({ notify: false });
  updatePreviewCueUI();
  renderQueue();
}

function clearCueAfterTake(index) {
  if (previewCueIndex === index) {
    stopPreviewAudioCue();
    clearVideoPreviewCueOverlay();
    previewCueIndex = -1;
    pendingCueVolume = null;
    cueVolumeDirty = false;
    syncGtkSliderToCueState();
    if (isBiblePresentationActive()) showBibleWorkspace();
    restoreCountdownForLiveMedia();
  }
  syncMediaLoopState({ notify: false });
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
  hidePptxPreviewIfNeeded({ restoreVideoPreview: true });

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
  el.loop = loopEnabledForQueueItem(item);
  el.preload = "metadata";
  el.removeAttribute("src");
  el.removeAttribute("poster");
  el.load();
  el.src = pathToMediaUrl(item.path);
  el.load();
  el.hidden = false;
  setPreviewStackSurface(PREVIEW_SURFACE_CUE_VIDEO);

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
  syncMediaLoopState({ notify: false });
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

function renderQueue() {
  const listContainer = document.getElementById("mediaQueueList");
  if (!listContainer) return;

  if (mediaQueue.length === 0) {
    listContainer.innerHTML =
      '<div class="list-placeholder">' +
      '<span class="list-placeholder-title">No items scheduled</span>' +
      '<span class="list-placeholder-hint">Add media or Bible text to begin</span>' +
      "</div>";
  } else {
    // Queue order is the primary source of truth. Badges show live/cued
    // state, plus an optional start-offset label for non-zero cue starts.
    const presentationLive = isQueuePresentationActive();
    const separatePreviewCue = isPreparingSeparateCue();
    const selectedQueueIndex = separatePreviewCue
      ? previewCueIndex
      : currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
        ? currentQueueIndex
        : -1;

    listContainer.innerHTML = mediaQueue
      .map((item, index) => {
        const cueStartTime = queueItemCueStartTime(item);
        const hasCueStart = cueStartTime > 0;

        const isLive = presentationLive && index === currentQueueIndex;
        const isCued = separatePreviewCue && index === previewCueIndex;
        const isSelected = index === selectedQueueIndex;

        const classes = [
          "queue-item",
          isSelected ? " is-selected" : "",
          isLive ? " is-live" : "",
          isCued ? " is-cued" : "",
        ].join("");
        const cueStartMarkup = hasCueStart
          ? `<span class="item-cue-start">Start @ ${formatCueTime(cueStartTime)}</span>`
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
        const autoAdvanceEnabled = item.autoAdvance !== false;
        const autoAdvanceMarkup = `<button type="button" class="row-auto-advance-btn" data-queue-auto="${index}" aria-label="${autoAdvanceEnabled ? "Auto: continue to the next scheduled item" : "Stop: pause after this scheduled item"}" title="${autoAdvanceEnabled ? "Auto: continue to next item" : "Stop after this item"}">${autoAdvanceEnabled ? "Auto" : "Stop"}</button>`;
        return `<div class="${classes}" role="listitem" data-queue-index="${index}" draggable="true" ${isSelected ? 'data-selected="true"' : ""} ${isLive ? 'data-live="true"' : ""} ${isCued ? 'data-cued="true"' : ""}>
      <span class="item-icon">${queueTypeIconMarkup(item)}</span>
      <span class="item-text">
        <span class="item-label" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        ${statusMarkup}
      </span>
      ${autoAdvanceMarkup}
      <button type="button" class="remove-btn" draggable="false" data-queue-remove="${index}" title="Remove from schedule" aria-label="Remove from schedule">✕</button>
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
  const hasPreviewSrc = Boolean(
    previewEl?.matches?.("video") &&
      (
        (previewEl.getAttribute("src") || "").length > 0 ||
        (previewEl.getAttribute("poster") || "").length > 0
      ),
  );
  const hasImage = !!document.querySelector(".video-wrapper img#preview");
  const pptxVisible = isPptxPreviewVisible();
  const bibleVisible = document.getElementById("bibleWorkspace")?.hidden === false;
  const empty =
    mediaQueue.length === 0 && !hasPreviewSrc && !hasImage && !pptxVisible && !bibleVisible;
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
  const movedItemWasLiveAudio =
    fromIndex === currentQueueIndex &&
    (playingMediaAudioOnly ||
      liveAudio?.paused === false ||
      isQueueItemAudio(mediaQueue[fromIndex]));
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
  ignoreQueueItemClicksUntil = performance.now() + 1500;
  window.setTimeout(() => {
    ignoreNextQueueItemClick = false;
  }, 400);

  invalidateQueueUndoToastAfterMutation();
  renderQueue();
  // renderQueue() refreshes previous/next status in a single pass.
  if (movedItemWasLiveAudio) {
    hidePptxPreviewIfNeeded();
    restoreCountdownForLiveMedia();
    refreshLiveAudioControls();
    syncPlayPauseIconToControlMedia();
    syncPreviewAudioTrackState();
  }
  saveMediaFile();
}

function enqueuePathsFromFilePicker(paths) {
  if (currentMode !== MEDIAPLAYER || !paths.length) return;
  invalidateQueueUndoToastAfterMutation();
  const firstNewIndex = mediaQueue.length;
  const biblePresentationLive =
    isActiveMediaWindow() && activeMediaWindowContentType === "bible";
  for (const p of paths) {
    mediaQueue.push(createQueueEntry(p));
  }
  renderQueue();
  if (
    ((!isActiveMediaWindow() &&
      !isLocalAppWindowPresentationActive() &&
      currentQueueIndex < 0) ||
      biblePresentationLive) &&
    mediaQueue[firstNewIndex]
  ) {
    void onQueueItemActivate(firstNewIndex).catch((err) => console.error(err));
  }
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

function classifyPresentationType(item, opts = {}) {
  if (opts?.textItem || isQueueItemBible(item)) return "bible";
  if (isQueueItemPptx(item)) return "pptx";
  if (isQueueItemImage(item)) return "image";
  if (isQueueItemAudio(item)) return "audio";
  return "video";
}

function getBibleDesignerStyle() {
  const fontInput = document.getElementById("bibleFontInput");
  const sizeInput = document.getElementById("bibleFontSizeInput");
  const colorInput = document.getElementById("bibleTextColorInput");
  const backgroundInput = document.getElementById("bibleBackgroundColorInput");
  const lowerThirdColorInput = document.getElementById("bibleLowerThirdTextColorInput");
  const lowerThirdChromaKeyInput = document.getElementById("bibleLowerThirdChromaKeyInput");
  const fontSize = Number.parseInt(sizeInput?.value, 10);
  return {
    fontFamily: fontInput?.value || bibleDesignerState.fontFamily,
    fontSize: Number.isFinite(fontSize) ? Math.max(24, Math.min(160, fontSize)) : 64,
    color: colorInput?.value || bibleDesignerState.color,
    backgroundColor: backgroundInput?.value || bibleDesignerState.backgroundColor,
    backgroundPath: bibleDesignerState.backgroundPath || "",
    lowerThirdColor: lowerThirdColorInput?.value || bibleDesignerState.lowerThirdColor,
    lowerThirdChromaKeyColor:
      lowerThirdChromaKeyInput?.value || bibleDesignerState.lowerThirdChromaKeyColor,
  };
}

function bibleStyleSnapshot(entry = {}) {
  const style = {};
  if (typeof entry.fontFamily === "string" && entry.fontFamily.trim()) {
    style.fontFamily = entry.fontFamily;
  }
  if (Number.isFinite(entry.fontSize)) {
    style.fontSize = entry.fontSize;
  }
  if (typeof entry.color === "string" && entry.color) {
    style.color = entry.color;
  }
  if (typeof entry.backgroundColor === "string" && entry.backgroundColor) {
    style.backgroundColor = entry.backgroundColor;
  }
  if (typeof entry.backgroundPath === "string") {
    style.backgroundPath = entry.backgroundPath;
  }
  if (typeof entry.lowerThirdColor === "string" && entry.lowerThirdColor) {
    style.lowerThirdColor = entry.lowerThirdColor;
  }
  if (
    typeof entry.lowerThirdChromaKeyColor === "string" &&
    entry.lowerThirdChromaKeyColor
  ) {
    style.lowerThirdChromaKeyColor = entry.lowerThirdChromaKeyColor;
  }
  return style;
}

function mergedBibleShowNowStyle() {
  return {
    ...resolvedBibleStyleDefaults(),
    ...lastShownBibleStyleOverrides,
    ...getBibleDesignerStyle(),
  };
}

function currentBibleBackgroundVideoSync() {
  const backgroundVideo = document.getElementById("biblePreviewBackgroundVideo");
  if (
    !backgroundVideo ||
    backgroundVideo.hidden ||
    !Number.isFinite(backgroundVideo.currentTime)
  ) {
    return null;
  }
  return {
    currentTime: backgroundVideo.currentTime,
    capturedAt: Date.now(),
  };
}

function normalizeScriptureLook(value) {
  return value === SCRIPTURE_LOOK_LOWER_THIRD
    ? SCRIPTURE_LOOK_LOWER_THIRD
    : SCRIPTURE_LOOK_FULLSCREEN;
}

function scriptureLowerThirdFontSize(fontSize) {
  const base = Number.isFinite(fontSize) ? fontSize : SCRIPTURE_BODY_FONT_SIZE;
  return Math.max(26, Math.min(72, Math.round(base * 0.68)));
}

function scriptureColorToRgb(value) {
  const color = String(value || "").trim();
  const hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return {
        r: Number.parseInt(hex[0] + hex[0], 16),
        g: Number.parseInt(hex[1] + hex[1], 16),
        b: Number.parseInt(hex[2] + hex[2], 16),
      };
    }
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }
  const rgbMatch = color.match(
    /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+[\d.]+)?\s*\)$/i,
  );
  if (!rgbMatch) return null;
  return {
    r: Math.max(0, Math.min(255, Number.parseInt(rgbMatch[1], 10))),
    g: Math.max(0, Math.min(255, Number.parseInt(rgbMatch[2], 10))),
    b: Math.max(0, Math.min(255, Number.parseInt(rgbMatch[3], 10))),
  };
}

function scriptureRelativeLuminance({ r, g, b }) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function scriptureReferencePresentationForBackground(backgroundColor, options = {}) {
  if (options.forceLight === true) {
    return {
      color: SCRIPTURE_REFERENCE_LIGHT_COLOR,
      shadow: SCRIPTURE_REFERENCE_LIGHT_SHADOW,
    };
  }
  const rgb = scriptureColorToRgb(backgroundColor);
  if (!rgb) {
    return {
      color: SCRIPTURE_REFERENCE_LIGHT_COLOR,
      shadow: SCRIPTURE_REFERENCE_LIGHT_SHADOW,
    };
  }
  const isLightBackground =
    scriptureRelativeLuminance(rgb) >= SCRIPTURE_REFERENCE_LIGHT_BACKGROUND_LUMINANCE;
  return isLightBackground
    ? {
        color: SCRIPTURE_REFERENCE_DARK_COLOR,
        shadow: SCRIPTURE_REFERENCE_DARK_SHADOW,
      }
    : {
        color: SCRIPTURE_REFERENCE_LIGHT_COLOR,
        shadow: SCRIPTURE_REFERENCE_LIGHT_SHADOW,
      };
}

function normalizeLowerThirdSegmentText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function normalizeLowerThirdSegments(segments) {
  if (!Array.isArray(segments)) return [];
  return segments
    .map((segment) => {
      const text =
        typeof segment === "string"
          ? segment
          : typeof segment?.text === "string"
            ? segment.text
            : "";
      return { text: normalizeLowerThirdSegmentText(text) };
    })
    .filter((segment) => segment.text.length > 0);
}

function clampLowerThirdSegmentIndex(index, segments) {
  if (!Array.isArray(segments) || segments.length === 0) return 0;
  const numericIndex = Number.isFinite(index) ? Math.trunc(index) : 0;
  return Math.max(0, Math.min(segments.length - 1, numericIndex));
}

function fallbackLowerThirdSegments(text, maxChars = 82) {
  const clean = normalizeLowerThirdSegmentText(text);
  if (!clean) return [];
  const words = clean.split(/\s+/);
  const segments = [];
  let current = "";
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > maxChars) {
      segments.push({ text: current });
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) segments.push({ text: current });
  return segments;
}

function lowerThirdMeasureElements() {
  if (!document?.body) return null;
  let root = document.getElementById(LOWER_THIRD_MEASURE_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = LOWER_THIRD_MEASURE_ID;
    root.className = "scripture-render scripture-render--lower-third scripture-render-measure";
    root.innerHTML = `
      <div class="scripture-render__box">
        <div class="scripture-render__body"></div>
        <div class="scripture-render__reference"></div>
      </div>
    `;
    document.body.appendChild(root);
  }
  return {
    root,
    body: root.querySelector(".scripture-render__body"),
    reference: root.querySelector(".scripture-render__reference"),
  };
}

function applyScriptureRenderVariables(el, message) {
  if (!el) return;
  const bodyFontSize = Math.max(
    24,
    Math.round(message.fontSize || SCRIPTURE_BODY_FONT_SIZE),
  );
  const referenceFontSize = Math.max(
    14,
    Math.round(message.referenceFontSize || SCRIPTURE_REFERENCE_FONT_SIZE),
  );
  el.style.setProperty("--scripture-font-size", `${bodyFontSize}px`);
  el.style.setProperty(
    "--scripture-lower-third-font-size",
    `${scriptureLowerThirdFontSize(bodyFontSize)}px`,
  );
  el.style.setProperty("--scripture-reference-font-size", `${referenceFontSize}px`);
  el.style.setProperty("--scripture-line-height", `${message.lineHeight || SCRIPTURE_LINE_HEIGHT}`);
  el.style.setProperty("--scripture-font-weight", `${message.fontWeight || SCRIPTURE_FONT_WEIGHT}`);
  el.style.setProperty("--scripture-color", message.color || "#ffffff");
  const referencePresentation = scriptureReferencePresentationForBackground(
    message.backgroundColor,
    {
      forceLight:
        normalizeScriptureLook(message.look) === SCRIPTURE_LOOK_LOWER_THIRD ||
        Boolean(message.backgroundImage || message.backgroundVideo || message.backgroundPath),
    },
  );
  el.style.setProperty(
    "--scripture-reference-color",
    message.referenceColor || referencePresentation.color,
  );
  el.style.setProperty(
    "--scripture-reference-shadow",
    message.referenceTextShadow || referencePresentation.shadow,
  );
  el.style.fontFamily = message.fontFamily || SCRIPTURE_FONT_FAMILY;
}

function lowerThirdSegmentFits(text, style, width) {
  const elements = lowerThirdMeasureElements();
  if (!elements?.root || !elements.body) return true;
  const message = {
    fontFamily: style.fontFamily || SCRIPTURE_FONT_FAMILY,
    fontSize: Number.isFinite(style.fontSize) ? style.fontSize : SCRIPTURE_BODY_FONT_SIZE,
    referenceFontSize: SCRIPTURE_REFERENCE_FONT_SIZE,
    fontWeight: SCRIPTURE_FONT_WEIGHT,
    lineHeight: SCRIPTURE_LINE_HEIGHT,
    color: style.color || "#ffffff",
  };
  elements.root.style.width = `${Math.max(360, Math.round(width || window.innerWidth || 1280))}px`;
  elements.root.style.height = `${Math.max(220, Math.round((window.innerHeight || 720) * 0.35))}px`;
  applyScriptureRenderVariables(elements.root, message);
  elements.body.textContent = normalizeLowerThirdSegmentText(text) || " ";
  if (elements.reference) elements.reference.textContent = "";
  const fontSize = scriptureLowerThirdFontSize(message.fontSize);
  const maxHeight = fontSize * 1.18 * LOWER_THIRD_MAX_LINES + 4;
  return elements.body.scrollHeight <= maxHeight;
}

function buildMeasuredLowerThirdSegments(text, style = {}, panel = null) {
  const clean = normalizeLowerThirdSegmentText(text);
  if (!clean) return [];
  const width =
    panel?.getBoundingClientRect?.().width ||
    document.getElementById("biblePreviewPanel")?.getBoundingClientRect?.().width ||
    window.innerWidth ||
    1280;
  const words = clean.split(/\s+/);
  const segments = [];
  let current = "";
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (current && !lowerThirdSegmentFits(candidate, style, width)) {
      segments.push({ text: current });
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) segments.push({ text: current });
  return segments.length ? segments : fallbackLowerThirdSegments(clean);
}

function bibleLowerThirdMeasurePanel() {
  return (
    document.getElementById("bibleAudiencePreviewShell") ||
    document.getElementById("biblePreviewPanel")
  );
}

function resolveBibleLowerThirdState(entry, opts = {}) {
  if (!entry || typeof entry !== "object") {
    return { segments: [], index: 0, text: "" };
  }
  const sourceText = String(entry.text || "");
  let segments = normalizeLowerThirdSegments(entry.lowerThirdSegments);
  const sourceChanged = entry.lowerThirdSourceText !== sourceText;
  const needsRebuild =
    opts.rebuild === true ||
    segments.length === 0 ||
    sourceChanged;
  if (needsRebuild) {
    segments = buildMeasuredLowerThirdSegments(sourceText, entry, opts.panel);
    entry.lowerThirdSegments = segments;
    entry.lowerThirdSourceText = sourceText;
    if (sourceChanged) {
      entry.lowerThirdSegmentIndex = 0;
    }
  }
  const index = clampLowerThirdSegmentIndex(entry.lowerThirdSegmentIndex, segments);
  entry.lowerThirdSegmentIndex = index;
  return {
    segments,
    index,
    text: segments[index]?.text || normalizeLowerThirdSegmentText(sourceText),
  };
}

function applyScriptureRenderToPreview(render, bodyEl, referenceEl, message) {
  if (!render || !bodyEl || !referenceEl) return;
  const look = normalizeScriptureLook(message.look);
  render.classList.toggle("scripture-render--fullscreen", look === SCRIPTURE_LOOK_FULLSCREEN);
  render.classList.toggle("scripture-render--lower-third", look === SCRIPTURE_LOOK_LOWER_THIRD);
  render.dataset.scriptureLook = look;
  applyScriptureRenderVariables(render, message);
  bodyEl.textContent = message.bodyText || "No verse loaded";
  referenceEl.textContent = message.referenceText || "";
  referenceEl.hidden = !message.referenceText;
}

function isBibleLowerThirdFeatureEnabled() {
  return BIBLE_LOWER_THIRD_FEATURE_ENABLED === true;
}

function syncLowerThirdFeatureAvailability() {
  const enabled = isBibleLowerThirdFeatureEnabled();
  document.querySelectorAll("[data-lower-third-feature]").forEach((element) => {
    element.hidden = !enabled;
    element.setAttribute("aria-hidden", enabled ? "false" : "true");
    element.querySelectorAll("button, input, select, textarea").forEach((control) => {
      if (!enabled) {
        if (!control.dataset.lowerThirdWasDisabled) {
          control.dataset.lowerThirdWasDisabled = control.disabled ? "true" : "false";
        }
        control.disabled = true;
        return;
      }
      if (control.dataset.lowerThirdWasDisabled) {
        control.disabled = control.dataset.lowerThirdWasDisabled === "true";
        delete control.dataset.lowerThirdWasDisabled;
      }
    });
  });
  const lowerThirdKeyColorField = document.querySelector("[data-lower-third-key-color]");
  if (lowerThirdKeyColorField) {
    lowerThirdKeyColorField.hidden = !enabled;
    lowerThirdKeyColorField.setAttribute("aria-hidden", enabled ? "false" : "true");
    lowerThirdKeyColorField
      .querySelectorAll("button, input, select, textarea")
      .forEach((control) => {
        control.disabled = !enabled;
      });
  }

  document
    .getElementById("biblePreviewPanel")
    ?.classList.toggle("bible-preview-panel--audience-only", !enabled);
  document
    .querySelector(".bible-editor-fields")
    ?.classList.toggle("bible-editor-fields--audience-only", !enabled);

  if (!enabled) {
    const lowerThirdDisplaySelect = document.getElementById("lowerThirdDspSelct");
    if (lowerThirdDisplaySelect) lowerThirdDisplaySelect.value = "";
    if (bibleLowerThirdOutputActive) void closeBibleLowerThirdOutput();
  }
}

function normalizeBiblePreviewOutputSize(value) {
  const width = Number.parseInt(value?.width || "", 10);
  const height = Number.parseInt(value?.height || "", 10);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height };
  }
  return null;
}

function selectedBiblePreviewOutputSize(selectId = "dspSelct") {
  if (selectId === "dspSelct") {
    const mediaWindowSize = normalizeBiblePreviewOutputSize(biblePreviewActiveMediaWindowSize);
    if (mediaWindowSize) return mediaWindowSize;
  }
  const select = document.getElementById(selectId);
  const option = select?.selectedOptions?.[0];
  const width = Number.parseInt(option?.dataset?.displayWidth || "", 10);
  const height = Number.parseInt(option?.dataset?.displayHeight || "", 10);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height };
  }
  return {
    width: BIBLE_PREVIEW_DEFAULT_OUTPUT_WIDTH,
    height: BIBLE_PREVIEW_DEFAULT_OUTPUT_HEIGHT,
  };
}

async function refreshBiblePreviewMediaWindowSize() {
  if (biblePreviewMediaWindowSizePromise) {
    return biblePreviewMediaWindowSizePromise;
  }
  biblePreviewMediaWindowSizePromise = invoke("get-media-window-bounds")
    .then((bounds) => {
      biblePreviewActiveMediaWindowSize = normalizeBiblePreviewOutputSize(bounds);
      syncBiblePreviewOutputScale();
      return biblePreviewActiveMediaWindowSize;
    })
    .catch((error) => {
      console.error("Failed to read media window bounds:", error);
      biblePreviewActiveMediaWindowSize = null;
      syncBiblePreviewOutputScale();
      return null;
    })
    .finally(() => {
      biblePreviewMediaWindowSizePromise = null;
    });
  return biblePreviewMediaWindowSizePromise;
}

function queueBiblePreviewMediaWindowSizeRefresh(delayMs = 0) {
  window.setTimeout(() => {
    void refreshBiblePreviewMediaWindowSize();
  }, Math.max(0, delayMs));
}

function applyBiblePreviewOutputScale(surface, outputSize) {
  if (!surface || !outputSize) return;
  const width = Math.max(1, Math.round(outputSize.width));
  const height = Math.max(1, Math.round(outputSize.height));
  surface.style.setProperty("--bible-preview-output-width", `${width}px`);
  surface.style.setProperty("--bible-preview-output-height", `${height}px`);
  const rect = surface.getBoundingClientRect();
  const scale =
    rect.width > 0 && rect.height > 0
      ? Math.min(rect.width / width, rect.height / height)
      : 1;
  surface.style.setProperty(
    "--bible-preview-output-scale",
    `${Math.max(0.01, scale)}`,
  );
}

function syncBiblePreviewOutputScale() {
  applyBiblePreviewOutputScale(
    document.getElementById("bibleAudiencePreviewShell"),
    selectedBiblePreviewOutputSize("dspSelct"),
  );
  if (isBibleLowerThirdFeatureEnabled()) {
    applyBiblePreviewOutputScale(
      document.getElementById("bibleLowerThirdPreviewShell"),
      selectedBiblePreviewOutputSize("lowerThirdDspSelct"),
    );
  }
}

function installBiblePreviewScaleObserver() {
  const panel = document.getElementById("biblePreviewPanel");
  if (!panel || panel.dataset.previewScaleObserverBound === "1") return;
  panel.dataset.previewScaleObserverBound = "1";
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => syncBiblePreviewOutputScale());
    observer.observe(panel);
    document.getElementById("bibleAudiencePreviewShell") &&
      observer.observe(document.getElementById("bibleAudiencePreviewShell"));
    document.getElementById("bibleLowerThirdPreviewShell") &&
      observer.observe(document.getElementById("bibleLowerThirdPreviewShell"));
    panel._biblePreviewScaleObserver = observer;
  } else {
    window.addEventListener("resize", syncBiblePreviewOutputScale);
  }
}

function buildBibleTextMessage(entry = bibleDesignerState, opts = {}) {
  const style = {
    fontFamily: entry.fontFamily || bibleDesignerState.fontFamily,
    fontSize: Number.isFinite(entry.fontSize) ? entry.fontSize : bibleDesignerState.fontSize,
    color: entry.color || bibleDesignerState.color,
    backgroundColor: entry.backgroundColor || bibleDesignerState.backgroundColor,
    backgroundPath: entry.backgroundPath || "",
    lowerThirdColor:
      entry.lowerThirdColor ||
      bibleDesignerState.lowerThirdColor ||
      SCRIPTURE_LOWER_THIRD_TEXT_COLOR,
    lowerThirdChromaKeyColor:
      entry.lowerThirdChromaKeyColor ||
      bibleDesignerState.lowerThirdChromaKeyColor ||
      SCRIPTURE_LOWER_THIRD_CHROMA_KEY_COLOR,
  };
  const look = normalizeScriptureLook(opts.look || entry.look || bibleDesignerState.look);
  const isLowerThird = look === SCRIPTURE_LOOK_LOWER_THIRD;
  const lowerThird = resolveBibleLowerThirdState(entry, {
    rebuild: opts.rebuildLowerThird === true,
    panel: opts.measurePanel || bibleLowerThirdMeasurePanel(),
  });
  const backgroundUrl = style.backgroundPath ? pathToMediaUrl(style.backgroundPath) : "";
  const backgroundVideo = !isLowerThird && /\.(mp4|m4v|mov|mkv|webm)$/i.test(style.backgroundPath)
    ? backgroundUrl
    : "";
  const fullBodyText = entry.text || "";
  const referencePresentation = scriptureReferencePresentationForBackground(
    style.backgroundColor,
    { forceLight: isLowerThird || Boolean(style.backgroundPath) },
  );
  return {
    text: `${entry.text || ""}\n\n${entry.reference || ""} ${entry.version || ""}`.trim(),
    reference: entry.reference || "",
    version: entry.version || "KJV",
    book: entry.book || "",
    chapter: Number.isFinite(entry.chapter) ? entry.chapter : 0,
    verse: Number.isFinite(entry.verse) ? entry.verse : 0,
    verseEnd: Number.isFinite(entry.verseEnd) ? entry.verseEnd : 0,
    ...style,
    color: isLowerThird ? style.lowerThirdColor : style.color,
    backgroundColor: isLowerThird ? style.lowerThirdChromaKeyColor : style.backgroundColor,
    backgroundPath: isLowerThird ? "" : style.backgroundPath,
    backgroundImage: !isLowerThird && imageRegex.test(style.backgroundPath) ? backgroundUrl : "",
    backgroundVideo,
    backgroundVideoSync: backgroundVideo ? currentBibleBackgroundVideoSync() : null,
    chromaKeyColor: style.lowerThirdChromaKeyColor,
    referenceText: `${entry.reference || ""} ${entry.version || ""}`.trim(),
    referenceColor: referencePresentation.color,
    referenceTextShadow: referencePresentation.shadow,
    referenceFontSize: SCRIPTURE_REFERENCE_FONT_SIZE,
    labelFontSize: SCRIPTURE_LABEL_FONT_SIZE,
    headingFontSize: SCRIPTURE_HEADING_FONT_SIZE,
    fontWeight: SCRIPTURE_FONT_WEIGHT,
    lineHeight: SCRIPTURE_LINE_HEIGHT,
    look,
    fullBodyText,
    lowerThirdSegments: lowerThird.segments,
    lowerThirdSegmentIndex: lowerThird.index,
    lowerThirdSegmentCount: lowerThird.segments.length,
    bodyText: isLowerThird ? lowerThird.text : fullBodyText,
    position: { vertical: "center", horizontal: "center" },
  };
}

function applyBiblePreview(entry = bibleDesignerState, opts = {}) {
  if (opts.show !== false) showBibleWorkspace();
  const lowerThirdEnabled = isBibleLowerThirdFeatureEnabled();
  const panel = document.getElementById("biblePreviewPanel");
  const audienceShell = document.getElementById("bibleAudiencePreviewShell");
  const audienceRender = document.getElementById("biblePreviewRender");
  const audienceReference = document.getElementById("biblePreviewReference");
  const audienceText = document.getElementById("biblePreviewText");
  const lowerThirdRender = document.getElementById("bibleLowerThirdPreviewRender");
  const lowerThirdReference = document.getElementById("bibleLowerThirdPreviewReference");
  const lowerThirdText = document.getElementById("bibleLowerThirdPreviewText");
  const title = document.getElementById("bibleWorkspaceTitle");
  const backgroundVideo = document.getElementById("biblePreviewBackgroundVideo");
  if (
    !panel ||
    !audienceShell ||
    !audienceRender ||
    !audienceReference ||
    !audienceText ||
    (lowerThirdEnabled && (!lowerThirdRender || !lowerThirdReference || !lowerThirdText))
  ) {
    return;
  }
  syncLowerThirdFeatureAvailability();
  const resolvedEntry = bibleEntryWithLookupText(entry);
  if (entry === bibleDesignerState && resolvedEntry !== entry) {
    Object.assign(bibleDesignerState, resolvedEntry);
  }
  const previewEntry = entry === bibleDesignerState ? bibleDesignerState : resolvedEntry;
  const audienceMessage = buildBibleTextMessage(previewEntry, {
    look: SCRIPTURE_LOOK_FULLSCREEN,
  });
  const lowerThirdMessage = lowerThirdEnabled
    ? buildBibleTextMessage(previewEntry, {
        look: SCRIPTURE_LOOK_LOWER_THIRD,
      })
    : null;
  panel.hidden = false;
  audienceShell.style.backgroundColor = audienceMessage.backgroundColor;
  const lowerThirdShell = document.getElementById("bibleLowerThirdPreviewShell");
  if (lowerThirdShell && lowerThirdMessage) {
    lowerThirdShell.style.backgroundColor =
      lowerThirdMessage.chromaKeyColor || SCRIPTURE_LOWER_THIRD_CHROMA_KEY_COLOR;
  }
  queueBiblePreviewMediaWindowSizeRefresh();
  syncBiblePreviewOutputScale();
  if (audienceMessage.backgroundImage) {
    audienceShell.style.backgroundImage = `url('${audienceMessage.backgroundImage}')`;
  } else {
    audienceShell.style.backgroundImage = "";
  }
  if (backgroundVideo) {
    if (audienceMessage.backgroundVideo) {
      if (backgroundVideo.src !== audienceMessage.backgroundVideo) {
        backgroundVideo.src = audienceMessage.backgroundVideo;
      }
      backgroundVideo.hidden = false;
      backgroundVideo.muted = true;
      backgroundVideo.defaultMuted = true;
      backgroundVideo.loop = true;
      void backgroundVideo.play().catch(() => {});
    } else {
      backgroundVideo.pause();
      backgroundVideo.removeAttribute("src");
      backgroundVideo.load();
      backgroundVideo.hidden = true;
    }
  }
  if (title) {
    title.textContent = `${audienceMessage.reference || "Bible"} ${audienceMessage.version}`.trim();
  }
  applyScriptureRenderToPreview(
    audienceRender,
    audienceText,
    audienceReference,
    audienceMessage,
  );
  if (lowerThirdEnabled && lowerThirdMessage) {
    applyScriptureRenderToPreview(
      lowerThirdRender,
      lowerThirdText,
      lowerThirdReference,
      lowerThirdMessage,
    );
  }
  syncBibleBackgroundLabel(audienceMessage.backgroundPath);
  syncBibleLookControls(lowerThirdMessage || audienceMessage);
}

function syncBibleLookControls(message) {
  const lookSelect = document.getElementById("bibleLookSelect");
  const lowerThirdControls = document.getElementById("bibleLowerThirdControls");
  const status = document.getElementById("bibleLowerThirdStatus");
  const prevButton = document.getElementById("bibleLowerThirdPrevBtn");
  const nextButton = document.getElementById("bibleLowerThirdNextBtn");
  if (!isBibleLowerThirdFeatureEnabled()) {
    if (lookSelect) lookSelect.value = SCRIPTURE_LOOK_FULLSCREEN;
    if (lowerThirdControls) lowerThirdControls.hidden = true;
    if (status) status.textContent = "";
    if (prevButton) prevButton.disabled = true;
    if (nextButton) nextButton.disabled = true;
    return;
  }
  const controlMessage =
    message || buildBibleTextMessage(bibleDesignerState, { look: SCRIPTURE_LOOK_LOWER_THIRD });
  const look = normalizeScriptureLook(bibleDesignerState.look || controlMessage.look);
  const count = Number.isFinite(controlMessage.lowerThirdSegmentCount)
    ? controlMessage.lowerThirdSegmentCount
    : normalizeLowerThirdSegments(bibleDesignerState.lowerThirdSegments).length;
  const segmentCount = Math.max(0, Math.trunc(count));
  const rawIndex = Number.isFinite(controlMessage.lowerThirdSegmentIndex)
    ? Math.trunc(controlMessage.lowerThirdSegmentIndex)
    : 0;
  const index = segmentCount > 0
    ? Math.max(0, Math.min(segmentCount - 1, rawIndex))
    : 0;
  if (lookSelect) lookSelect.value = look;
  if (lowerThirdControls) lowerThirdControls.hidden = false;
  if (status) {
    status.textContent =
      segmentCount > 0 && index >= segmentCount - 1
        ? `Segment ${index + 1} of ${segmentCount}. Next advances text.`
        : `Segment ${segmentCount > 0 ? index + 1 : 0} of ${segmentCount}`;
  }
  if (prevButton) prevButton.disabled = index <= 0;
  if (nextButton) nextButton.disabled = segmentCount <= 0;
}

function commitBibleDesignerRenderState({ rebuildLowerThird = false } = {}) {
  syncBibleStateFromControls();
  resolveBibleLowerThirdState(bibleDesignerState, {
    rebuild: rebuildLowerThird,
    panel: bibleLowerThirdMeasurePanel(),
  });
  applyBiblePreview(bibleDesignerState, { show: false });
  if (syncBibleDesignerStateToPreviewedQueueItem()) {
    saveMediaFile();
  }
  syncActiveScheduledBiblePresentation();
  syncShowNowBiblePresentation();
}

function setBibleLowerThirdSegmentIndex(index) {
  if (!isBibleLowerThirdFeatureEnabled()) return false;
  syncBibleStateFromControls();
  const resolvedEntry = bibleEntryWithLookupText(bibleDesignerState);
  if (resolvedEntry && resolvedEntry !== bibleDesignerState) {
    Object.assign(bibleDesignerState, resolvedEntry);
  }
  const lowerThird = resolveBibleLowerThirdState(bibleDesignerState, {
    panel: bibleLowerThirdMeasurePanel(),
  });
  const nextIndex = clampLowerThirdSegmentIndex(index, lowerThird.segments);
  if (nextIndex === bibleDesignerState.lowerThirdSegmentIndex) {
    syncBibleLookControls(buildBibleTextMessage(bibleDesignerState));
    return false;
  }
  bibleDesignerState.lowerThirdSegmentIndex = nextIndex;
  commitBibleDesignerRenderState();
  return true;
}

function changeBibleLowerThirdSegment(delta) {
  const current = Number.isFinite(bibleDesignerState.lowerThirdSegmentIndex)
    ? bibleDesignerState.lowerThirdSegmentIndex
    : 0;
  return setBibleLowerThirdSegmentIndex(current + delta);
}

function findNextScheduledBibleTextIndex(startIndex = currentQueueIndex) {
  const from = Number.isFinite(startIndex) ? Math.trunc(startIndex) + 1 : 0;
  for (let index = Math.max(0, from); index < mediaQueue.length; index += 1) {
    if (isQueueItemBible(mediaQueue[index])) return index;
  }
  return -1;
}

function isScheduledBiblePresentationActive() {
  return Boolean(
    isQueuePlaying &&
      currentQueueIndex >= 0 &&
      currentQueueIndex < mediaQueue.length &&
      isQueueItemBible(mediaQueue[currentQueueIndex]) &&
      ((isActiveMediaWindow() && activeMediaWindowContentType === "bible") ||
        (isBibleLowerThirdFeatureEnabled() && bibleLowerThirdOutputActive)),
  );
}

function nextBibleVerseEntryFromDesigner() {
  syncBibleStateFromControls();
  const resolvedEntry = bibleEntryWithLookupText(bibleDesignerState);
  if (resolvedEntry && resolvedEntry !== bibleDesignerState) {
    Object.assign(bibleDesignerState, resolvedEntry);
  }

  const parsed = parseScriptureReference(bibleDesignerState.reference || "");
  const book = bibleDesignerState.book || parsed.book;
  const chapter = Number.isFinite(bibleDesignerState.chapter)
    ? bibleDesignerState.chapter
    : parsed.chapter;
  if (!book || !Number.isFinite(chapter) || chapter < 1) return null;

  let textData = null;
  try {
    textData = bibleAPI.getText(bibleDesignerState.version, book, String(chapter));
  } catch (err) {
    console.error("Failed to load next Bible verse:", err);
    return null;
  }
  const verses = Array.isArray(textData?.verses) ? textData.verses : [];
  const selectedVerses = selectedBibleVerseNumbers();
  const selectedEnd = selectedVerses.length ? selectedVerses[selectedVerses.length - 1] : 0;
  const entryEnd =
    Number.isFinite(bibleDesignerState.verseEnd) && bibleDesignerState.verseEnd > 0
      ? bibleDesignerState.verseEnd
      : Number.isFinite(bibleDesignerState.verse) && bibleDesignerState.verse > 0
        ? bibleDesignerState.verse
        : 0;
  const currentVerse = Math.max(selectedEnd, entryEnd);
  const nextVerse = currentVerse > 0 ? currentVerse + 1 : 1;
  const text = verses[nextVerse - 1];
  if (!text) return null;

  return {
    ...bibleDesignerState,
    ...getBibleDesignerStyle(),
    book,
    chapter,
    reference: `${book} ${chapter}:${nextVerse}`,
    text,
    verse: nextVerse,
    verseEnd: 0,
    selectedVerses: [nextVerse],
    lowerThirdSegments: [],
    lowerThirdSegmentIndex: 0,
    lowerThirdSourceText: "",
  };
}

function advanceBibleDesignerToNextVerse() {
  const nextEntry = nextBibleVerseEntryFromDesigner();
  if (!nextEntry) {
    showGnomeToast("End of chapter");
    return false;
  }
  Object.assign(bibleDesignerState, nextEntry);
  bibleVerseSelection.verses.clear();
  bibleVerseSelection.verses.add(nextEntry.verse);
  bibleVerseSelection.anchor = nextEntry.verse;
  syncBibleSelectorsFromState();
  renderBibleVerseList();
  applyBiblePreview(bibleDesignerState, { show: false });
  window.requestAnimationFrame(scrollBibleViewerToCurrentVerse);
  if (syncBibleDesignerStateToPreviewedQueueItem()) {
    saveMediaFile();
  }
  syncActiveScheduledBiblePresentation();
  syncShowNowBiblePresentation();
  return true;
}

async function advanceToNextScheduledBibleText() {
  const nextIndex = findNextScheduledBibleTextIndex(currentQueueIndex);
  if (nextIndex < 0) {
    showGnomeToast("No next scheduled Bible text");
    return false;
  }
  const nextEntry = resolvedBibleEntryForItem(mediaQueue[nextIndex]);
  mediaQueue[nextIndex] = {
    ...mediaQueue[nextIndex],
    path: bibleQueuePath(nextEntry.reference, nextEntry.version),
    name: `${nextEntry.reference} ${nextEntry.version}`.trim(),
    type: "bible",
    bible: {
      ...nextEntry,
      lowerThirdSegmentIndex: 0,
    },
  };
  renderQueue();
  saveMediaFile();
  await switchQueueItemLiveWithConfirmation(nextIndex);
  return true;
}

async function advanceBibleLowerThirdCursor() {
  if (!isBibleLowerThirdFeatureEnabled()) return false;
  syncBibleStateFromControls();
  const resolvedEntry = bibleEntryWithLookupText(bibleDesignerState);
  if (resolvedEntry && resolvedEntry !== bibleDesignerState) {
    Object.assign(bibleDesignerState, resolvedEntry);
  }
  const lowerThird = resolveBibleLowerThirdState(bibleDesignerState, {
    panel: bibleLowerThirdMeasurePanel(),
  });
  if (!lowerThird.segments.length) {
    syncBibleLookControls(buildBibleTextMessage(bibleDesignerState, {
      look: SCRIPTURE_LOOK_LOWER_THIRD,
    }));
    return false;
  }
  if (lowerThird.index < lowerThird.segments.length - 1) {
    return changeBibleLowerThirdSegment(1);
  }
  if (isScheduledBiblePresentationActive()) {
    return advanceToNextScheduledBibleText();
  }
  return advanceBibleDesignerToNextVerse();
}

function rebuildBibleLowerThirdSegments() {
  if (!isBibleLowerThirdFeatureEnabled()) return false;
  syncBibleStateFromControls();
  const resolvedEntry = bibleEntryWithLookupText(bibleDesignerState);
  if (resolvedEntry && resolvedEntry !== bibleDesignerState) {
    Object.assign(bibleDesignerState, resolvedEntry);
  }
  bibleDesignerState.lowerThirdSegmentIndex = 0;
  commitBibleDesignerRenderState({ rebuildLowerThird: true });
  return true;
}

function showBibleWorkspace() {
  const workspace = document.getElementById("bibleWorkspace");
  const button = document.getElementById("openBibleWorkspaceBtn");
  if (!workspace) return;
  syncLowerThirdFeatureAvailability();
  workspace.hidden = false;
  button?.setAttribute("data-active", "true");
  document.getElementById("previewEmptyState")?.setAttribute("hidden", "");
  document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
  setPreviewStackSurface(PREVIEW_SURFACE_BIBLE);
  installBibleWorkspaceEventGuards();
  pauseInactivePreviewBehindBibleWorkspace();
}

function hideBibleWorkspace() {
  const workspace = document.getElementById("bibleWorkspace");
  const button = document.getElementById("openBibleWorkspaceBtn");
  if (workspace) workspace.hidden = true;
  button?.setAttribute("data-active", "false");
  syncPreviewStackSurface();
}

function hideBiblePreview() {
  hideBibleWorkspace();
}

function installBibleWorkspaceEventGuards() {
  const workspace = document.getElementById("bibleWorkspace");
  if (!workspace || workspace.dataset.eventGuardsInstalled === "1") return;
  workspace.dataset.eventGuardsInstalled = "1";

  const stopWorkspaceEvent = (event) => {
    event.stopPropagation();
  };
  const stopWorkspaceDoubleClick = (event) => {
    event.stopPropagation();
    if (!event.target?.closest?.("input, textarea, select")) {
      event.preventDefault();
    }
  };

  ["pointerdown", "mousedown", "mouseup", "click"].forEach((eventName) => {
    workspace.addEventListener(eventName, stopWorkspaceEvent);
  });
  workspace.addEventListener("dblclick", stopWorkspaceDoubleClick);
}

function isBibleWorkspaceVisible() {
  return document.getElementById("bibleWorkspace")?.hidden === false;
}

function pauseInactivePreviewBehindBibleWorkspace() {
  if (!isBibleWorkspaceVisible()) return;
  if (
    isQueuePresentationActive() ||
    isActiveMediaWindow() ||
    isLocalAppWindowPresentationActive()
  ) {
    return;
  }
  if (!video || video.paused) return;

  try {
    video.pause();
  } catch (err) {
    console.error("Failed to pause hidden media preview behind Bible workspace:", err);
  }
  localTimeStampUpdateIsRunning = false;
  syncPreviewAudioTrackState();
}

function verseNumbersFromSelector(selector, maxVerse) {
  const selected = [];
  const seen = new Set();
  String(selector || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const [rawStart, rawEnd] = part.split("-");
      const start = Number.parseInt(rawStart, 10);
      const end = Number.parseInt(rawEnd, 10);
      if (!Number.isFinite(start) || start < 1) return;
      const rangeEnd =
        Number.isFinite(end) && end > 0
          ? end
          : start;
      const from = Math.max(1, Math.min(start, rangeEnd));
      const to = Math.min(maxVerse, Math.max(start, rangeEnd));
      for (let verseNumber = from; verseNumber <= to; verseNumber += 1) {
        if (!seen.has(verseNumber)) {
          seen.add(verseNumber);
          selected.push(verseNumber);
        }
      }
    });
  return selected;
}

function verseSelectorFromReference(reference) {
  const verseToken = normalizeScriptureReference(reference)
    .split(/\s+/)
    .find((token) => token.includes(":"));
  return verseToken ? verseToken.split(":").slice(1).join(":") : "";
}

function referenceForBibleVerseNumbers(book, chapter, selectedVerses) {
  if (!Array.isArray(selectedVerses) || selectedVerses.length === 0) {
    return `${book} ${chapter}`;
  }
  const ranges = [];
  let start = selectedVerses[0];
  let previous = selectedVerses[0];
  for (let index = 1; index < selectedVerses.length; index += 1) {
    const verse = selectedVerses[index];
    if (verse === previous + 1) {
      previous = verse;
      continue;
    }
    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = verse;
    previous = verse;
  }
  ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
  return `${book} ${chapter}:${ranges.join(",")}`;
}

function lookupBibleReference(reference, version) {
  const normalized = normalizeScriptureReference(reference);
  const parsed = parseScriptureReference(normalized);
  if (!parsed.book || !Number.isFinite(parsed.chapter)) return null;
  const textData = bibleAPI.getText(version || "KJV", parsed.book, String(parsed.chapter));
  if (!textData?.verses?.length) return null;
  const selectedVerseNumbers = verseNumbersFromSelector(
    verseSelectorFromReference(normalized),
    textData.verses.length,
  );
  if (selectedVerseNumbers.length > 0) {
    const selectedVerseTexts = selectedVerseNumbers.map((verseNumber) => ({
      verseNumber,
      text: textData.verses[verseNumber - 1],
    }));
    const selectedText =
      selectedVerseTexts.length === 1
        ? selectedVerseTexts[0].text
        : selectedVerseTexts
            .map(({ verseNumber, text }) => `${verseNumber}. ${text}`)
            .join("\n");
    if (!selectedText) return null;
    return {
      version: version || "KJV",
      reference: referenceForBibleVerseNumbers(
        parsed.book,
        parsed.chapter,
        selectedVerseNumbers,
      ),
      text: selectedText,
      selectedVerses: selectedVerseNumbers,
    };
  }
  if (Number.isFinite(parsed.verse) && parsed.verse > 0) {
    const verseStart = parsed.verse;
    const verseEnd =
      Number.isFinite(parsed.verseEnd) && parsed.verseEnd > verseStart
        ? Math.min(parsed.verseEnd, textData.verses.length)
        : verseStart;
    const selectedVerses = textData.verses.slice(verseStart - 1, verseEnd);
    if (!selectedVerses.length) return null;
    const isRange = verseEnd > verseStart;
    return {
      version: version || "KJV",
      reference: `${parsed.book} ${parsed.chapter}:${verseStart}${isRange ? `-${verseEnd}` : ""}`,
      selectedVerses: Array.from(
        { length: verseEnd - verseStart + 1 },
        (_, index) => verseStart + index,
      ),
      text: isRange
        ? selectedVerses
            .map((verseText, index) => `${verseStart + index}. ${verseText}`)
            .join("\n")
        : selectedVerses[0],
    };
  }
  return {
    version: version || "KJV",
    reference: `${parsed.book} ${parsed.chapter}`,
    selectedVerses: [],
    text: textData.verses.map((verseText, index) => `${index + 1}. ${verseText}`).join("\n"),
  };
}

function bibleEntryWithLookupText(entry = bibleDesignerState) {
  if (!entry?.reference) return entry;
  try {
    const result = lookupBibleReference(entry.reference, entry.version);
    if (!result) return entry;
    const parsed = parseScriptureReference(result.reference);
    const selectedVerses = Array.isArray(result.selectedVerses)
      ? result.selectedVerses
      : [];
    const contiguousSelection =
      selectedVerses.length > 1 &&
      selectedVerses.every((verseNumber, index) =>
        index === 0 || verseNumber === selectedVerses[index - 1] + 1,
      );
    return {
      ...entry,
      ...result,
      book: parsed.book || entry.book || bibleDesignerState.book,
      chapter: Number.isFinite(parsed.chapter) ? parsed.chapter : entry.chapter,
      verse: selectedVerses[0] || (Number.isFinite(parsed.verse) ? parsed.verse : 0),
      verseEnd: contiguousSelection
        ? selectedVerses[selectedVerses.length - 1]
        : Number.isFinite(parsed.verseEnd) ? parsed.verseEnd : 0,
      selectedVerses,
    };
  } catch {
    return entry;
  }
}

function syncBibleStateFromControls() {
  const versionSelect = document.getElementById("bibleVersionSelect");
  const referenceInput = document.getElementById("bibleReferenceInput");
  const lookSelect = document.getElementById("bibleLookSelect");
  bibleDesignerState.version = versionSelect?.value || bibleDesignerState.version;
  bibleDesignerState.look = normalizeScriptureLook(lookSelect?.value || bibleDesignerState.look);
  const resolvedReference = normalizeBibleReferenceInput(
    referenceInput?.value || bibleDesignerState.reference,
  );
  if (resolvedReference) {
    bibleDesignerState.book = resolvedReference.book;
    bibleDesignerState.chapter = resolvedReference.chapter;
    bibleDesignerState.verse = resolvedReference.verse;
    bibleDesignerState.verseEnd = resolvedReference.verseEnd;
    if (bibleDesignerState.reference !== resolvedReference.reference) {
      bibleDesignerState.text = "";
    }
    bibleDesignerState.reference = resolvedReference.reference;
  } else {
    const nextReference = normalizeScriptureReference(
      referenceInput?.value || bibleDesignerState.reference,
    );
    if (bibleDesignerState.reference !== nextReference) {
      bibleDesignerState.text = "";
    }
    bibleDesignerState.reference = normalizeScriptureReference(
      referenceInput?.value || bibleDesignerState.reference,
    );
  }
  Object.assign(bibleDesignerState, getBibleDesignerStyle());
}

function setBiblePreviewText(reference, text, opts = {}) {
  syncBibleStateFromControls();
  const verse = Number.isFinite(opts.verse) ? opts.verse : bibleDesignerState.verse;
  const verseEnd = Number.isFinite(opts.verseEnd) ? opts.verseEnd : bibleDesignerState.verseEnd;
  Object.assign(bibleDesignerState, {
    reference: normalizeScriptureReference(reference || bibleDesignerState.reference),
    text: text || "",
    verse,
    verseEnd,
    ...getBibleDesignerStyle(),
  });
  applyBiblePreview(bibleDesignerState);
  syncActiveScheduledBiblePresentation();
  syncShowNowBiblePresentation();
  return Boolean(bibleDesignerState.text);
}

function selectedBibleVerseNumbers() {
  return [...bibleVerseSelection.verses].sort((a, b) => a - b);
}

function referenceForSelectedBibleVerses(selectedVerses) {
  if (!Array.isArray(selectedVerses) || selectedVerses.length === 0) {
    return bibleDesignerState.reference;
  }
  return referenceForBibleVerseNumbers(
    bibleDesignerState.book,
    bibleDesignerState.chapter,
    selectedVerses,
  );
}

function bibleEntryFromSelectedVerses() {
  const selectedVerses = selectedBibleVerseNumbers();
  if (selectedVerses.length === 0) return null;
  let textData = null;
  try {
    textData = bibleAPI.getText(
      bibleDesignerState.version,
      bibleDesignerState.book,
      String(bibleDesignerState.chapter),
    );
  } catch (err) {
    console.error("Failed to load selected Bible verses:", err);
    return null;
  }
  const verses = Array.isArray(textData?.verses) ? textData.verses : [];
  const selectedVerseTexts = selectedVerses
    .filter((verseNumber) => verseNumber >= 1 && verseNumber <= verses.length)
    .map((verseNumber) => ({
      verseNumber,
      text: verses[verseNumber - 1],
    }));
  const selectedText =
    selectedVerseTexts.length === 1
      ? selectedVerseTexts[0].text
      : selectedVerseTexts
          .map(({ verseNumber, text }) => `${verseNumber}. ${text}`)
          .join("\n");
  if (!selectedText) return null;
  const reference = referenceForSelectedBibleVerses(selectedVerses);
  const verseStart = selectedVerses[0];
  const verseEnd = selectedVerses[selectedVerses.length - 1];
  return {
    ...bibleDesignerState,
    ...getBibleDesignerStyle(),
    reference,
    text: selectedText,
    verse: verseStart,
    verseEnd: verseEnd > verseStart ? verseEnd : 0,
    selectedVerses,
  };
}

function bibleEntryForSingleVerse(verseNumber) {
  if (!Number.isFinite(verseNumber) || verseNumber < 1) return null;
  let textData = null;
  try {
    textData = bibleAPI.getText(
      bibleDesignerState.version,
      bibleDesignerState.book,
      String(bibleDesignerState.chapter),
    );
  } catch (err) {
    console.error("Failed to load Bible verse:", err);
    return null;
  }
  const verses = Array.isArray(textData?.verses) ? textData.verses : [];
  const text = verses[verseNumber - 1];
  if (!text) return null;
  return {
    ...bibleDesignerState,
    ...getBibleDesignerStyle(),
    reference: `${bibleDesignerState.book} ${bibleDesignerState.chapter}:${verseNumber}`,
    text,
    verse: verseNumber,
    verseEnd: 0,
  };
}

function queueEntryFromBibleEntry(entry) {
  return {
    path: bibleQueuePath(entry.reference, entry.version),
    name: `${entry.reference} ${entry.version}`.trim(),
    type: "bible",
    autoAdvance: false,
    cueStartTime: 0,
    bible: { ...entry },
  };
}

function applySelectedBibleVersePreview() {
  const selectedEntry = bibleEntryFromSelectedVerses();
  if (!selectedEntry) return false;
  Object.assign(bibleDesignerState, selectedEntry);
  const referenceInput = document.getElementById("bibleReferenceInput");
  if (referenceInput) referenceInput.value = selectedEntry.reference;
  applyBiblePreview(bibleDesignerState);
  syncActiveScheduledBiblePresentation();
  syncShowNowBiblePresentation();
  return true;
}

function refreshBibleLookupPreview(opts = {}) {
  syncBibleStateFromControls();
  const result = lookupBibleReference(bibleDesignerState.reference, bibleDesignerState.version);
  if (!result) return false;
  const parsed = parseScriptureReference(result.reference);
  Object.assign(bibleDesignerState, result, {
    book: parsed.book || bibleDesignerState.book,
    chapter: Number.isFinite(parsed.chapter) ? parsed.chapter : bibleDesignerState.chapter,
    verse: Number.isFinite(parsed.verse) ? parsed.verse : 0,
    verseEnd: Number.isFinite(parsed.verseEnd) ? parsed.verseEnd : 0,
    ...getBibleDesignerStyle(),
  });
  applyBiblePreview(bibleDesignerState);
  if (opts.liveSync !== false) {
    syncActiveScheduledBiblePresentation();
    syncShowNowBiblePresentation();
  }
  return true;
}

function currentBibleQueueEntry() {
  syncBibleStateFromControls();
  const selectedEntry = bibleEntryFromSelectedVerses();
  if (selectedEntry) {
    Object.assign(bibleDesignerState, selectedEntry);
    return queueEntryFromBibleEntry(selectedEntry);
  }
  const refreshed = refreshBibleLookupPreview({ liveSync: false });
  if (!bibleDesignerState.text && !refreshed) {
    return null;
  }
  return queueEntryFromBibleEntry(bibleDesignerState);
}

function currentBibleTextOnlyEntry() {
  syncBibleStateFromControls();
  const selectedEntry = bibleEntryFromSelectedVerses();
  if (selectedEntry) {
    Object.assign(bibleDesignerState, selectedEntry);
  } else {
    const refreshed = refreshBibleLookupPreview({ liveSync: false });
    if (!bibleDesignerState.text && !refreshed) return null;
  }
  return {
    path: bibleQueuePath(bibleDesignerState.reference, bibleDesignerState.version),
    name: `${bibleDesignerState.reference} ${bibleDesignerState.version}`.trim(),
    type: "bible",
    autoAdvance: false,
    cueStartTime: 0,
    bible: { ...bibleDesignerState },
  };
}

function sendBibleTextToOutput(entry = bibleDesignerState) {
  const resolvedEntry = bibleEntryWithLookupText(entry);
  lastShownBibleStyleOverrides = bibleStyleSnapshot(resolvedEntry);
  send("update-text", buildBibleTextMessage(resolvedEntry, {
    look: SCRIPTURE_LOOK_FULLSCREEN,
  }));
}

function selectedDisplayIndexFromSelect(id) {
  const select = document.getElementById(id);
  if (!select || select.value === "") return null;
  const index = Number.parseInt(select.value, 10);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function hasAudienceOutputSelected() {
  const selectId = currentMode === STREAMPLAYER ? "dspSelctStreams" : "dspSelct";
  return selectedDisplayIndexFromSelect(selectId) !== null;
}

function hasLowerThirdOutputSelected() {
  if (!isBibleLowerThirdFeatureEnabled()) return false;
  return selectedDisplayIndexFromSelect("lowerThirdDspSelct") !== null;
}

function buildBibleLowerThirdOutputMessage(entry = bibleDesignerState) {
  return {
    ...buildBibleTextMessage(entry, { look: SCRIPTURE_LOOK_LOWER_THIRD }),
    outputRole: "lower-third",
    backgroundImage: "",
    backgroundVideo: "",
    backgroundPath: "",
  };
}

function sendBibleLowerThirdTextToOutput(entry = bibleDesignerState) {
  if (!isBibleLowerThirdFeatureEnabled()) return;
  send("update-lower-third-text", buildBibleLowerThirdOutputMessage(entry));
}

async function closeBibleLowerThirdOutput() {
  bibleLowerThirdOutputActive = false;
  try {
    return await invoke("close-lower-third-window-now");
  } catch (err) {
    console.error("Failed to close lower third output:", err);
    return false;
  }
}

async function ensureBibleLowerThirdOutput(entry = bibleDesignerState) {
  if (!isBibleLowerThirdFeatureEnabled()) {
    await closeBibleLowerThirdOutput();
    return false;
  }
  const displayIndex = selectedDisplayIndexFromSelect("lowerThirdDspSelct");
  if (displayIndex === null) {
    await closeBibleLowerThirdOutput();
    return false;
  }
  const message = buildBibleLowerThirdOutputMessage(entry);
  const windowOptions = {
    backgroundColor: message.chromaKeyColor || SCRIPTURE_LOWER_THIRD_CHROMA_KEY_COLOR,
    webPreferences: {
      v8CacheOptions: "bypassHeatCheckAndEagerCompile",
      contextIsolation: true,
      sandbox: true,
      enableWebSQL: false,
      webgl: false,
      skipTaskbar: true,
      additionalArguments: [
        "__mediafile-ems=" + encodeURIComponent(bibleQueuePath(entry.reference, entry.version)),
        "__isText",
        "__lowerThirdOutput",
      ],
      preload: `${__dirname}/media_preload.min.js`,
      devTools: true,
    },
  };
  try {
    const windowId = await invoke("create-lower-third-window", windowOptions, displayIndex);
    bibleLowerThirdOutputActive = Boolean(windowId);
    if (bibleLowerThirdOutputActive) {
      window.setTimeout(() => sendBibleLowerThirdTextToOutput(entry), 100);
    }
    return bibleLowerThirdOutputActive;
  } catch (err) {
    console.error("Failed to create lower third output:", err);
    showGnomeToast("Failed to open lower third output");
    bibleLowerThirdOutputActive = false;
    return false;
  }
}

function normalizeProjectScriptureOverrides(overrides = {}) {
  if (!overrides || typeof overrides !== "object") {
    return {
      fontFamily: "",
      fontSize: undefined,
      color: "",
      backgroundColor: "",
      backgroundPath: "",
      lowerThirdColor: "",
      lowerThirdChromaKeyColor: "",
    };
  }
  return {
    fontFamily:
      typeof overrides.fontFamily === "string" ? overrides.fontFamily : "",
    fontSize:
      Number.isFinite(overrides.fontSize) ? overrides.fontSize : undefined,
    color:
      typeof overrides.color === "string" ? overrides.color : "",
    backgroundColor:
      typeof overrides.backgroundColor === "string" ? overrides.backgroundColor : "",
    backgroundPath:
      typeof overrides.backgroundPath === "string" ? overrides.backgroundPath : "",
    lowerThirdColor:
      typeof overrides.lowerThirdColor === "string" ? overrides.lowerThirdColor : "",
    lowerThirdChromaKeyColor:
      typeof overrides.lowerThirdChromaKeyColor === "string"
        ? overrides.lowerThirdChromaKeyColor
        : "",
  };
}

function projectScriptureTextFromOverrides(overrides = projectScriptureOverrides) {
  const normalized = normalizeProjectScriptureOverrides(overrides);
  if (
    !normalized.fontFamily &&
    !Number.isFinite(normalized.fontSize) &&
    !normalized.color &&
    !normalized.backgroundColor &&
    !normalized.backgroundPath &&
    !normalized.lowerThirdColor &&
    !normalized.lowerThirdChromaKeyColor
  ) {
    return undefined;
  }
  return {
    appliesTo: "scripture",
    themeOverrides: {
      textContainer: {
        typography: {
          fontFamily: normalized.fontFamily || undefined,
          fontSize: Number.isFinite(normalized.fontSize) ? normalized.fontSize : undefined,
          fontColor: normalized.color || undefined,
        },
      },
      background: {
        color: normalized.backgroundColor || undefined,
      },
    },
    presentation: {
      fontFamily: normalized.fontFamily || undefined,
      fontSize: Number.isFinite(normalized.fontSize) ? normalized.fontSize : undefined,
      textColor: normalized.color || undefined,
      backgroundColor: normalized.backgroundColor || undefined,
      backgroundPath: normalized.backgroundPath || "",
      lowerThirdTextColor: normalized.lowerThirdColor || undefined,
      lowerThirdChromaKeyColor: normalized.lowerThirdChromaKeyColor || undefined,
    },
  };
}

function overridesFromProjectScriptureText(projectScriptureText = {}) {
  const presentation =
    projectScriptureText?.presentation && typeof projectScriptureText.presentation === "object"
      ? projectScriptureText.presentation
      : {};
  const typography =
    projectScriptureText?.themeOverrides?.textContainer?.typography &&
    typeof projectScriptureText.themeOverrides.textContainer.typography === "object"
      ? projectScriptureText.themeOverrides.textContainer.typography
      : {};
  const background =
    projectScriptureText?.themeOverrides?.background &&
    typeof projectScriptureText.themeOverrides.background === "object"
      ? projectScriptureText.themeOverrides.background
      : {};
  return normalizeProjectScriptureOverrides({
    fontFamily:
      typeof presentation.fontFamily === "string"
        ? presentation.fontFamily
        : typeof typography.fontFamily === "string"
          ? typography.fontFamily
          : "",
    fontSize:
      Number.isFinite(presentation.fontSize)
        ? presentation.fontSize
        : Number.isFinite(typography.fontSize)
          ? typography.fontSize
          : undefined,
    color:
      typeof presentation.textColor === "string"
        ? presentation.textColor
        : typeof typography.fontColor === "string"
          ? typography.fontColor
          : "",
    backgroundColor:
      typeof presentation.backgroundColor === "string"
        ? presentation.backgroundColor
        : typeof background.color === "string"
          ? background.color
          : "",
    backgroundPath:
      typeof presentation.backgroundPath === "string"
        ? presentation.backgroundPath
        : "",
    lowerThirdColor:
      typeof presentation.lowerThirdTextColor === "string"
        ? presentation.lowerThirdTextColor
        : "",
    lowerThirdChromaKeyColor:
      typeof presentation.lowerThirdChromaKeyColor === "string"
        ? presentation.lowerThirdChromaKeyColor
        : "",
  });
}

function bibleBackgroundDisplayName(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return "Audience Background…";
  return queueBasename(filePath) || "Selected Background";
}

function parseBibleQueuePath(filePath) {
  if (!isBiblePath(filePath)) return null;
  try {
    const payload = decodeURIComponent(filePath.slice(bibleUriPrefix.length));
    const separatorIndex = payload.indexOf(":");
    if (separatorIndex < 0) {
      return {
        version: "KJV",
        reference: payload,
      };
    }
    return {
      version: payload.slice(0, separatorIndex) || "KJV",
      reference: payload.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function resolveBibleQueueItemEntry(item) {
  if (!isQueueItemBible(item)) return null;
  const pathEntry = parseBibleQueuePath(item.path);
  const baseEntry = {
    ...(item?.bible && typeof item.bible === "object" ? item.bible : {}),
    ...(pathEntry || {}),
  };
  const resolvedEntry = bibleEntryWithLookupText(baseEntry);
  if (!resolvedEntry?.reference) return null;
  return {
    ...resolvedEntry,
    version: resolvedEntry.version || pathEntry?.version || "KJV",
    reference: resolvedEntry.reference || pathEntry?.reference || "",
  };
}

function resolvedBibleStyleDefaults() {
  return {
    fontFamily: projectScriptureOverrides.fontFamily || SCRIPTURE_FONT_FAMILY,
    fontSize: Number.isFinite(projectScriptureOverrides.fontSize)
      ? projectScriptureOverrides.fontSize
      : SCRIPTURE_BODY_FONT_SIZE,
    color: projectScriptureOverrides.color || "#ffffff",
    backgroundColor: projectScriptureOverrides.backgroundColor || "#000000",
    backgroundPath: projectScriptureOverrides.backgroundPath || "",
    lowerThirdColor:
      projectScriptureOverrides.lowerThirdColor || SCRIPTURE_LOWER_THIRD_TEXT_COLOR,
    lowerThirdChromaKeyColor:
      projectScriptureOverrides.lowerThirdChromaKeyColor ||
      SCRIPTURE_LOWER_THIRD_CHROMA_KEY_COLOR,
    look: SCRIPTURE_DEFAULT_LOOK,
    lowerThirdSegments: [],
    lowerThirdSegmentIndex: 0,
    lowerThirdSourceText: "",
  };
}

function hydrateBibleEntryStyle(entry = {}) {
  const defaults = resolvedBibleStyleDefaults();
  return {
    ...defaults,
    ...entry,
    fontFamily:
      typeof entry?.fontFamily === "string" && entry.fontFamily.trim()
        ? entry.fontFamily
        : defaults.fontFamily,
    fontSize: Number.isFinite(entry?.fontSize) ? entry.fontSize : defaults.fontSize,
    color:
      typeof entry?.color === "string" && entry.color
        ? entry.color
        : defaults.color,
    backgroundColor:
      typeof entry?.backgroundColor === "string" && entry.backgroundColor
        ? entry.backgroundColor
        : defaults.backgroundColor,
    backgroundPath:
      typeof entry?.backgroundPath === "string"
        ? entry.backgroundPath
        : defaults.backgroundPath,
    lowerThirdColor:
      typeof entry?.lowerThirdColor === "string" && entry.lowerThirdColor
        ? entry.lowerThirdColor
        : defaults.lowerThirdColor,
    lowerThirdChromaKeyColor:
      typeof entry?.lowerThirdChromaKeyColor === "string" && entry.lowerThirdChromaKeyColor
        ? entry.lowerThirdChromaKeyColor
        : defaults.lowerThirdChromaKeyColor,
    look: normalizeScriptureLook(entry?.look || defaults.look),
    lowerThirdSegments: normalizeLowerThirdSegments(entry?.lowerThirdSegments),
    lowerThirdSegmentIndex: Number.isFinite(entry?.lowerThirdSegmentIndex)
      ? Math.max(0, Math.trunc(entry.lowerThirdSegmentIndex))
      : 0,
    lowerThirdSourceText:
      typeof entry?.lowerThirdSourceText === "string"
        ? entry.lowerThirdSourceText
        : "",
  };
}

function resolvedBibleEntryForItem(item) {
  const resolvedEntry = resolveBibleQueueItemEntry(item);
  if (resolvedEntry) return hydrateBibleEntryStyle(resolvedEntry);
  const pathEntry = parseBibleQueuePath(item?.path);
  const baseEntry = {
    ...(item?.bible && typeof item.bible === "object" ? item.bible : {}),
    ...(pathEntry || {}),
  };
  return hydrateBibleEntryStyle(bibleEntryWithLookupText(baseEntry));
}

function bibleEntryMatchesQueueItem(entry, item) {
  if (!entry || !isQueueItemBible(item)) return false;
  const itemEntry = resolveBibleQueueItemEntry(item);
  const entryReference = normalizeScriptureReference(entry.reference || "");
  const itemReference = normalizeScriptureReference(itemEntry?.reference || "");
  const entryVersion = entry.version || "KJV";
  const itemVersion = itemEntry?.version || parseBibleQueuePath(item.path)?.version || "KJV";
  return Boolean(
    entryReference &&
      itemReference &&
      entryReference === itemReference &&
      entryVersion === itemVersion,
  );
}

function currentBibleEditorTargetItem() {
  const targetIndex = currentBibleEditorTargetIndex();
  return targetIndex >= 0 ? mediaQueue[targetIndex] : null;
}

function isBibleEditorShowOnlyTextMode() {
  const targetItem = currentBibleEditorTargetItem();
  return !targetItem || !bibleEntryMatchesQueueItem(bibleDesignerState, targetItem);
}

function setBibleVerseSelectionFromEntry(entry = bibleDesignerState) {
  bibleVerseSelection.verses.clear();
  const explicitVerses = Array.isArray(entry.selectedVerses)
    ? entry.selectedVerses.filter((verseNumber) => Number.isFinite(verseNumber) && verseNumber > 0)
    : verseNumbersFromSelector(verseSelectorFromReference(entry.reference), 500);
  if (explicitVerses.length > 0) {
    explicitVerses.forEach((verseNumber) => bibleVerseSelection.verses.add(verseNumber));
    bibleVerseSelection.anchor = explicitVerses[0];
    return;
  }
  const start = Number.isFinite(entry.verse) && entry.verse > 0 ? entry.verse : 0;
  const end =
    Number.isFinite(entry.verseEnd) && entry.verseEnd > start
      ? entry.verseEnd
      : start;
  if (start > 0) {
    for (let verseNumber = start; verseNumber <= end; verseNumber += 1) {
      bibleVerseSelection.verses.add(verseNumber);
    }
  }
  bibleVerseSelection.anchor = start;
}

function scrollBibleViewerToCurrentVerse() {
  const verse = Number.isFinite(bibleDesignerState.verse) ? bibleDesignerState.verse : 0;
  if (verse <= 0) return;
  const row = document.querySelector(`.bible-verse-row[data-verse="${verse}"]`);
  centerBibleVerseRowInList(row);
}

function syncBibleBackgroundLabel(filePath = bibleDesignerState.backgroundPath) {
  const label = document.getElementById("bibleBackgroundLabel");
  if (!label) return;
  label.textContent = bibleBackgroundDisplayName(filePath);
  label.title = typeof filePath === "string" ? filePath : "";
}

function loadBibleEntryIntoEditor(entry = bibleDesignerState, opts = {}) {
  const resolvedEntry = hydrateBibleEntryStyle(bibleEntryWithLookupText(entry));
  Object.assign(bibleDesignerState, resolvedEntry);
  setBibleVerseSelectionFromEntry(bibleDesignerState);
  syncBibleSelectorsFromState();
  syncBibleStyleControlsFromState();
  syncBibleBackgroundLabel(bibleDesignerState.backgroundPath);
  renderBibleVerseList();
  if (opts.scroll !== false) {
    window.requestAnimationFrame(scrollBibleViewerToCurrentVerse);
  }
  applyBiblePreview(bibleDesignerState);
}

function currentBibleEditorTargetIndex() {
  if (
    previewCueIndex >= 0 &&
    previewCueIndex < mediaQueue.length &&
    isQueueItemBible(mediaQueue[previewCueIndex])
  ) {
    return previewCueIndex;
  }
  if (
    currentQueueIndex >= 0 &&
    currentQueueIndex < mediaQueue.length &&
    isQueueItemBible(mediaQueue[currentQueueIndex])
  ) {
    return currentQueueIndex;
  }
  return -1;
}

function isBibleEditorTargetLiveItem() {
  const targetIndex = currentBibleEditorTargetIndex();
  return (
    targetIndex >= 0 &&
    targetIndex === currentQueueIndex &&
    currentQueueIndex >= 0 &&
    currentQueueIndex < mediaQueue.length &&
    isQueueItemBible(mediaQueue[currentQueueIndex])
  );
}

function syncBibleDesignerStateToPreviewedQueueItem() {
  const targetIndex = currentBibleEditorTargetIndex();
  if (targetIndex < 0) return false;
  const entry = currentBibleQueueEntry();
  if (!entry) return false;
  if (!bibleEntryMatchesQueueItem(entry.bible, mediaQueue[targetIndex])) return false;
  mediaQueue[targetIndex] = {
    ...mediaQueue[targetIndex],
    path: entry.path,
    name: entry.name,
    type: "bible",
    bible: { ...entry.bible },
  };
  renderQueue();
  return true;
}

function applyBibleBackgroundToAllProjectText() {
  syncBibleStateFromControls();
  const style = getBibleDesignerStyle();
  const commitProjectStyle = isBibleEditorShowOnlyTextMode();
  if (commitProjectStyle) {
    projectScriptureOverrides.backgroundColor = style.backgroundColor;
    projectScriptureOverrides.backgroundPath = style.backgroundPath;
  }
  bibleDesignerState.backgroundColor = style.backgroundColor;
  bibleDesignerState.backgroundPath = style.backgroundPath;
  bibleStyleDirtyState.backgroundColor = false;
  bibleStyleDirtyState.backgroundPath = false;

  let changedCount = 0;
  mediaQueue.forEach((item) => {
    if (!isQueueItemBible(item)) return;
    const entry = resolveBibleQueueItemEntry(item);
    item.bible = {
      ...(entry || item.bible || {}),
      backgroundColor: style.backgroundColor,
      backgroundPath: style.backgroundPath,
    };
    if (entry?.reference) {
      item.path = bibleQueuePath(entry.reference, entry.version);
      item.name = `${entry.reference} ${entry.version}`.trim();
      item.type = "bible";
    }
    changedCount += 1;
  });

  renderQueue();
  applyBiblePreview(bibleDesignerState, { show: false });
  if (commitProjectStyle || changedCount > 0) {
    void saveCurrentProjectInStorageMode({ quiet: true });
  }
  syncActiveScheduledBiblePresentation();
  syncShowNowBiblePresentation();
  showGnomeToast(
    changedCount > 0
      ? `Applied background to ${changedCount} Bible text item${changedCount === 1 ? "" : "s"}`
      : commitProjectStyle
        ? "Background will apply to new Bible text"
        : "No scheduled Bible text to update",
  );
}

function applyBibleTextColorToAllProjectText() {
  syncBibleStateFromControls();
  const style = getBibleDesignerStyle();
  const commitProjectStyle = isBibleEditorShowOnlyTextMode();
  if (commitProjectStyle) {
    projectScriptureOverrides.color = style.color;
  }
  bibleDesignerState.color = style.color;
  bibleStyleDirtyState.color = false;

  let changedCount = 0;
  mediaQueue.forEach((item) => {
    if (!isQueueItemBible(item)) return;
    const entry = resolveBibleQueueItemEntry(item);
    item.bible = {
      ...(entry || item.bible || {}),
      color: style.color,
    };
    if (entry?.reference) {
      item.path = bibleQueuePath(entry.reference, entry.version);
      item.name = `${entry.reference} ${entry.version}`.trim();
      item.type = "bible";
    }
    changedCount += 1;
  });

  renderQueue();
  applyBiblePreview(bibleDesignerState, { show: false });
  if (commitProjectStyle || changedCount > 0) {
    void saveCurrentProjectInStorageMode({ quiet: true });
  }
  syncActiveScheduledBiblePresentation();
  syncShowNowBiblePresentation();
  showGnomeToast(
    changedCount > 0
      ? `Applied text color to ${changedCount} Bible text item${changedCount === 1 ? "" : "s"}`
      : commitProjectStyle
        ? "Text color will apply to new Bible text"
        : "No scheduled Bible text to update",
  );
}

function applyBibleFontToAllProjectText() {
  syncBibleStateFromControls();
  const style = getBibleDesignerStyle();
  const commitProjectStyle = isBibleEditorShowOnlyTextMode();
  if (commitProjectStyle) {
    projectScriptureOverrides.fontFamily = style.fontFamily;
  }
  bibleDesignerState.fontFamily = style.fontFamily;
  bibleStyleDirtyState.fontFamily = false;

  let changedCount = 0;
  mediaQueue.forEach((item) => {
    if (!isQueueItemBible(item)) return;
    const entry = resolveBibleQueueItemEntry(item);
    item.bible = {
      ...(entry || item.bible || {}),
      fontFamily: style.fontFamily,
    };
    if (entry?.reference) {
      item.path = bibleQueuePath(entry.reference, entry.version);
      item.name = `${entry.reference} ${entry.version}`.trim();
      item.type = "bible";
    }
    changedCount += 1;
  });

  renderQueue();
  applyBiblePreview(bibleDesignerState, { show: false });
  if (commitProjectStyle || changedCount > 0) {
    void saveCurrentProjectInStorageMode({ quiet: true });
  }
  syncActiveScheduledBiblePresentation();
  syncShowNowBiblePresentation();
  showGnomeToast(
    changedCount > 0
      ? `Applied font to ${changedCount} Bible text item${changedCount === 1 ? "" : "s"}`
      : commitProjectStyle
        ? "Font will apply to new Bible text"
        : "No scheduled Bible text to update",
  );
}

function applyBibleFontSizeToAllProjectText() {
  syncBibleStateFromControls();
  const style = getBibleDesignerStyle();
  const commitProjectStyle = isBibleEditorShowOnlyTextMode();
  if (commitProjectStyle) {
    projectScriptureOverrides.fontSize = style.fontSize;
  }
  bibleDesignerState.fontSize = style.fontSize;
  bibleStyleDirtyState.fontSize = false;

  let changedCount = 0;
  mediaQueue.forEach((item) => {
    if (!isQueueItemBible(item)) return;
    const entry = resolveBibleQueueItemEntry(item);
    const nextBible = {
      ...(entry || item.bible || {}),
      fontSize: style.fontSize,
    };
    item.bible = nextBible;
    if (entry?.reference) {
      item.path = bibleQueuePath(entry.reference, entry.version);
      item.name = `${entry.reference} ${entry.version}`.trim();
      item.type = "bible";
    }
    changedCount += 1;
  });

  renderQueue();
  applyBiblePreview(bibleDesignerState, { show: false });
  if (commitProjectStyle || changedCount > 0) {
    void saveCurrentProjectInStorageMode({ quiet: true });
  }
  syncActiveScheduledBiblePresentation();
  syncShowNowBiblePresentation();
  showGnomeToast(
    changedCount > 0
      ? `Applied font size to ${changedCount} Bible text item${changedCount === 1 ? "" : "s"}`
      : commitProjectStyle
        ? "Font size will apply to new Bible text"
        : "No scheduled Bible text to update",
  );
}

function bibleCurrentStylePayload() {
  const style = getBibleDesignerStyle();
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    color: style.color,
    backgroundColor: style.backgroundColor,
    backgroundPath: style.backgroundPath,
    lowerThirdColor: style.lowerThirdColor,
    lowerThirdChromaKeyColor: style.lowerThirdChromaKeyColor,
  };
}

function applyBibleStylePayloadToEntry(entry, style) {
  return {
    ...(entry || {}),
    ...style,
    lowerThirdSegments: [],
    lowerThirdSegmentIndex: 0,
    lowerThirdSourceText: "",
  };
}

function clearBibleStyleDirtyState() {
  bibleStyleDirtyState.fontFamily = false;
  bibleStyleDirtyState.fontSize = false;
  bibleStyleDirtyState.color = false;
  bibleStyleDirtyState.backgroundColor = false;
  bibleStyleDirtyState.backgroundPath = false;
  bibleStyleDirtyState.lowerThirdColor = false;
  bibleStyleDirtyState.lowerThirdChromaKeyColor = false;
}

function applyBibleStyleToCurrentText() {
  syncBibleStateFromControls();
  const style = bibleCurrentStylePayload();
  Object.assign(bibleDesignerState, applyBibleStylePayloadToEntry(bibleDesignerState, style));
  clearBibleStyleDirtyState();
  commitBibleDesignerRenderState({ rebuildLowerThird: true });
  showGnomeToast("Applied style to current Bible text");
}

function applyBibleStyleToScheduledText() {
  syncBibleStateFromControls();
  const style = bibleCurrentStylePayload();
  Object.assign(bibleDesignerState, applyBibleStylePayloadToEntry(bibleDesignerState, style));
  clearBibleStyleDirtyState();

  let changedCount = 0;
  mediaQueue.forEach((item) => {
    if (!isQueueItemBible(item)) return;
    const entry = resolveBibleQueueItemEntry(item);
    item.bible = applyBibleStylePayloadToEntry(entry || item.bible || {}, style);
    if (entry?.reference) {
      item.path = bibleQueuePath(entry.reference, entry.version);
      item.name = `${entry.reference} ${entry.version}`.trim();
      item.type = "bible";
    }
    changedCount += 1;
  });

  renderQueue();
  applyBiblePreview(bibleDesignerState, { show: false });
  if (changedCount > 0) {
    void saveCurrentProjectInStorageMode({ quiet: true });
  }
  syncActiveScheduledBiblePresentation();
  syncShowNowBiblePresentation();
  showGnomeToast(
    changedCount > 0
      ? `Applied style to ${changedCount} scheduled Bible text item${changedCount === 1 ? "" : "s"}`
      : "No scheduled Bible text to update",
  );
}

function useBibleStyleAsDefaults() {
  syncBibleStateFromControls();
  const style = bibleCurrentStylePayload();
  Object.assign(projectScriptureOverrides, style);
  Object.assign(bibleDesignerState, applyBibleStylePayloadToEntry(bibleDesignerState, style));
  clearBibleStyleDirtyState();
  applyBiblePreview(bibleDesignerState, { show: false });
  void saveCurrentProjectInStorageMode({ quiet: true });
  syncShowNowBiblePresentation();
  syncActiveScheduledBiblePresentation();
  showGnomeToast("Bible style defaults updated");
}

function bibleEntryWithShowNowStyle(entry) {
  const bible = {
    ...(entry?.bible || {}),
    ...mergedBibleShowNowStyle(),
  };
  return {
    ...entry,
    bible,
  };
}

function isBibleShowNowLiveMode() {
  return Boolean(
    bibleShowNowModeActive &&
      isActiveMediaWindow() &&
      activeMediaWindowContentType === "bible" &&
      !isQueuePlaying,
  );
}

function syncShowNowBiblePresentation() {
  if (
    !isBibleShowNowLiveMode() &&
    !(bibleShowNowModeActive && (bibleLowerThirdOutputActive || hasLowerThirdOutputSelected()))
  ) {
    return false;
  }
  const entry = currentBibleTextOnlyEntry();
  if (!entry) return false;
  const transientEntry = bibleEntryWithShowNowStyle(entry);
  if (isBibleShowNowLiveMode()) {
    sendBibleTextToOutput(transientEntry.bible);
  }
  if (hasLowerThirdOutputSelected()) {
    void ensureBibleLowerThirdOutput(transientEntry.bible);
  } else if (bibleLowerThirdOutputActive) {
    void closeBibleLowerThirdOutput();
  }
  return true;
}

function syncActiveScheduledBiblePresentation() {
  if (
    !(
      (isActiveMediaWindow() && activeMediaWindowContentType === "bible") ||
      bibleLowerThirdOutputActive ||
      hasLowerThirdOutputSelected()
    ) ||
    !isQueuePlaying ||
    !isBibleEditorTargetLiveItem()
  ) {
    return false;
  }
  void syncLiveBiblePresentation().catch((err) =>
    console.error("Failed to update live Bible presentation:", err),
  );
  return true;
}

async function showBibleTextNow() {
  const entry = currentBibleTextOnlyEntry();
  if (!entry) {
    showGnomeToast("Choose Bible text to show");
    return false;
  }
  const transientEntry = bibleEntryWithShowNowStyle(entry);
  const wantsAudience = hasAudienceOutputSelected();
  const wantsLowerThird = hasLowerThirdOutputSelected();
  if (!wantsAudience && !wantsLowerThird) {
    showGnomeToast("Choose an output display");
    return false;
  }
  try {
    mediaPlaybackEndedPending = false;
    pendingQueueSwitchIndex = null;
    pendingQueueSwitchStartTime = 0;
    userStopPresentationPending = false;
    currentQueueIndex = -1;
    const lowerThirdStarted = wantsLowerThird
      ? await ensureBibleLowerThirdOutput(transientEntry.bible)
      : await closeBibleLowerThirdOutput();
    if (wantsAudience && isActiveMediaWindow()) {
      const didSlipstream = await slipstreamBiblePresentation(transientEntry.bible);
      if (didSlipstream) {
        isPlaying = true;
        isQueuePlaying = false;
        bibleShowNowModeActive = true;
        updateDynUI();
        renderQueue();
        return true;
      }
    }
    const audienceStarted = wantsAudience
      ? await createMediaWindow({ textItem: transientEntry, transientText: true })
      : false;
    if (!audienceStarted && !lowerThirdStarted) {
      showGnomeToast("No Bible output started");
      return false;
    }
    activeMediaWindowContentType = audienceStarted ? "bible" : null;
    isPlaying = true;
    isQueuePlaying = false;
    bibleShowNowModeActive = true;
    isActiveMediaWindowCache = audienceStarted;
    updateDynUI();
    renderQueue();
    return true;
  } catch (err) {
    console.error("Failed to show Bible text:", err);
    showGnomeToast("Failed to show Bible text");
    return false;
  }
}

async function saveCurrentProjectInStorageMode({ quiet = false } = {}) {
  if (!currentProjectPath) {
    scheduleAutosaveProjectState();
    return false;
  }
  try {
    await syncCurrentPptxSlideForProjectSnapshot();
    const data = JSON.stringify(buildProjectStateSnapshot(), null, 2);
    await invoke("write-project-file", {
      filePath: currentProjectPath,
      data,
      mode: currentProjectStorageMode === "packed" ? "packed" : "working",
    });
    scheduleAutosaveProjectState();
    if (!quiet) showGnomeToast("Project saved");
    return true;
  } catch (err) {
    console.error("Failed to save project:", err);
    if (!quiet) showGnomeToast("Failed to save project");
    return false;
  }
}

async function slipstreamBiblePresentation(entry) {
  const textPayload = buildBibleTextMessage(entry, { look: SCRIPTURE_LOOK_FULLSCREEN });
  const slipstreamSuccess = await invoke("slipstream-media-window", {
    isText: true,
    mediaFile: bibleQueuePath(entry.reference, entry.version),
    textPayload,
  });
  if (!slipstreamSuccess) return false;
  activeMediaWindowContentType = "bible";
  sendBibleTextToOutput(entry);
  return true;
}

async function syncLiveBiblePresentation() {
  const audienceLive = isActiveMediaWindow() && activeMediaWindowContentType === "bible";
  if (!audienceLive && !bibleLowerThirdOutputActive && !hasLowerThirdOutputSelected()) {
    return false;
  }
  const targetIsLiveItem = isBibleEditorTargetLiveItem();
  const entry = targetIsLiveItem ? currentBibleQueueEntry() : currentBibleTextOnlyEntry();
  if (!entry) return false;
  if (
    targetIsLiveItem &&
    isQueuePlaying &&
    currentQueueIndex >= 0 &&
    currentQueueIndex < mediaQueue.length &&
    isQueueItemBible(mediaQueue[currentQueueIndex])
  ) {
    const liveItem = mediaQueue[currentQueueIndex];
    if (!bibleEntryMatchesQueueItem(entry.bible, liveItem)) {
      return false;
    }
    mediaQueue[currentQueueIndex] = {
      ...liveItem,
      path: entry.path,
      name: entry.name,
      type: "bible",
      bible: { ...entry.bible },
    };
    renderQueue();
    saveMediaFile();
  }
  if (audienceLive) {
    sendBibleTextToOutput(entry.bible);
  }
  if (hasLowerThirdOutputSelected()) {
    await ensureBibleLowerThirdOutput(entry.bible);
  } else if (bibleLowerThirdOutputActive) {
    await closeBibleLowerThirdOutput();
  }
  return true;
}

function insertBibleInSchedule() {
  const entry = currentBibleQueueEntry();
  if (!entry) return;
  invalidateQueueUndoToastAfterMutation();
  mediaQueue.push(entry);
  renderQueue();
  saveMediaFile();
  showGnomeToast(`Scheduled ${entry.name}`);
}

function addSelectedBibleVersesToSchedule() {
  const entry = currentBibleQueueEntry();
  if (!entry) {
    showGnomeToast("Choose Bible text to schedule");
    return false;
  }
  invalidateQueueUndoToastAfterMutation();
  mediaQueue.push(entry);
  renderQueue();
  saveMediaFile();
  showGnomeToast(`Scheduled ${entry.name}`);
  return true;
}

function addEachSelectedBibleVerseToSchedule() {
  const selectedVerses = selectedBibleVerseNumbers();
  const versesToSchedule =
    selectedVerses.length > 0
      ? selectedVerses
      : Number.isFinite(bibleDesignerState.verse) && bibleDesignerState.verse > 0
        ? [bibleDesignerState.verse]
        : [];
  if (!versesToSchedule.length) {
    showGnomeToast("Choose Bible verses to schedule");
    return false;
  }

  const entries = versesToSchedule
    .map((verseNumber) => bibleEntryForSingleVerse(verseNumber))
    .filter(Boolean)
    .map(queueEntryFromBibleEntry);
  if (!entries.length) {
    showGnomeToast("No Bible verses found");
    return false;
  }

  invalidateQueueUndoToastAfterMutation();
  mediaQueue.push(...entries);
  renderQueue();
  saveMediaFile();
  showGnomeToast(
    `Scheduled ${entries.length} Bible verse${entries.length === 1 ? "" : "s"}`,
  );
  return true;
}

function hideBibleTextContextMenu() {
  document.getElementById("bibleTextContextMenu")?.setAttribute("hidden", "");
}

function ensureBibleTextContextMenu() {
  let menu = document.getElementById("bibleTextContextMenu");
  if (menu) return menu;

  menu = document.createElement("div");
  menu.id = "bibleTextContextMenu";
  menu.className = "bible-text-context-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  menu.innerHTML = `
    <button type="button" role="menuitem" data-bible-text-action="show">Show Now</button>
    <button type="button" role="menuitem" data-bible-text-action="add">Add to Schedule</button>
    <button type="button" role="menuitem" data-bible-text-action="add-selected">Add Selected Verses to Schedule</button>
    <button type="button" role="menuitem" data-bible-text-action="add-each">Add Each Verse Separately</button>
  `;

  menu.addEventListener("pointerdown", (event) => event.stopPropagation());
  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    const button = event.target.closest("[data-bible-text-action]");
    if (!button) return;
    const action = button.getAttribute("data-bible-text-action");
    hideBibleTextContextMenu();
    if (action === "show") {
      void showBibleTextNow();
    } else if (action === "add") {
      insertBibleInSchedule();
    } else if (action === "add-selected") {
      addSelectedBibleVersesToSchedule();
    } else if (action === "add-each") {
      addEachSelectedBibleVerseToSchedule();
    }
  });

  document.body.appendChild(menu);
  if (document.body.dataset.bibleTextContextMenuBound !== "1") {
    document.body.dataset.bibleTextContextMenuBound = "1";
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (event.target.closest?.("#bibleTextContextMenu")) {
          return;
        }
        hideBibleTextContextMenu();
      },
      true,
    );
    window.addEventListener("resize", hideBibleTextContextMenu);
    window.addEventListener("scroll", hideBibleTextContextMenu, true);
  }
  return menu;
}

function showBibleTextContextMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  const menu = ensureBibleTextContextMenu();
  menu.hidden = false;
  menu.style.left = "0px";
  menu.style.top = "0px";
  const menuRect = menu.getBoundingClientRect();
  const left = Math.max(
    8,
    Math.min(event.clientX, window.innerWidth - menuRect.width - 8),
  );
  const top = Math.max(
    8,
    Math.min(event.clientY, window.innerHeight - menuRect.height - 8),
  );
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function syncBibleSelectorsFromState() {
  const versionSelect = document.getElementById("bibleVersionSelect");
  const referenceInput = document.getElementById("bibleReferenceInput");
  if (versionSelect) versionSelect.value = bibleDesignerState.version;
  if (referenceInput) referenceInput.value = bibleDesignerState.reference;
}

function syncBibleStyleControlsFromState() {
  const fontInput = document.getElementById("bibleFontInput");
  const fontSizeInput = document.getElementById("bibleFontSizeInput");
  const textColorInput = document.getElementById("bibleTextColorInput");
  const backgroundColorInput = document.getElementById("bibleBackgroundColorInput");
  const lowerThirdColorInput = document.getElementById("bibleLowerThirdTextColorInput");
  const lowerThirdChromaKeyInput = document.getElementById("bibleLowerThirdChromaKeyInput");
  const lookSelect = document.getElementById("bibleLookSelect");
  if (fontInput) {
    const fontValue = bibleDesignerState.fontFamily || SCRIPTURE_FONT_FAMILY;
    if (
      fontInput instanceof HTMLSelectElement &&
      !Array.from(fontInput.options).some((option) => option.value === fontValue)
    ) {
      const option = document.createElement("option");
      option.value = fontValue;
      option.textContent = fontValue.replace(/^['"]|['"]$/g, "");
      fontInput.appendChild(option);
    }
    fontInput.value = fontValue;
  }
  if (fontSizeInput) fontSizeInput.value = bibleDesignerState.fontSize;
  if (textColorInput) textColorInput.value = bibleDesignerState.color;
  if (backgroundColorInput) backgroundColorInput.value = bibleDesignerState.backgroundColor;
  if (lowerThirdColorInput) lowerThirdColorInput.value = bibleDesignerState.lowerThirdColor;
  if (lowerThirdChromaKeyInput) {
    lowerThirdChromaKeyInput.value = bibleDesignerState.lowerThirdChromaKeyColor;
  }
  if (lookSelect) lookSelect.value = normalizeScriptureLook(bibleDesignerState.look);
}

function renderBibleVerseList() {
  const list = document.getElementById("bibleVerseList");
  if (!list) return;
  list.innerHTML = "";
  list.setAttribute("aria-multiselectable", "true");
  let textData = null;
  try {
    textData = bibleAPI.getText(
      bibleDesignerState.version,
      bibleDesignerState.book,
      String(bibleDesignerState.chapter),
    );
  } catch (err) {
    console.error("Failed to load Bible chapter:", err);
  }
  const verses = Array.isArray(textData?.verses) ? textData.verses : [];
  if (!verses.length) {
    list.innerHTML =
      '<div class="list-placeholder"><span class="list-placeholder-title">No verses found</span></div>';
    return;
  }
  verses.forEach((verseText, index) => {
    const verseNumber = index + 1;
    const hasMultiSelection = bibleVerseSelection.verses.size > 0;
    const multiSelected = bibleVerseSelection.verses.has(verseNumber);
    const selectedStart =
      Number.isFinite(bibleDesignerState.verse) && bibleDesignerState.verse > 0
        ? bibleDesignerState.verse
        : 0;
    const selectedEnd =
      Number.isFinite(bibleDesignerState.verseEnd) && bibleDesignerState.verseEnd > selectedStart
        ? bibleDesignerState.verseEnd
        : selectedStart;
    const isSelected =
      hasMultiSelection
        ? multiSelected
        : verseNumber >= selectedStart && verseNumber <= selectedEnd;
    const button = document.createElement("button");
    button.type = "button";
    button.className = isSelected ? "bible-verse-row is-selected" : "bible-verse-row";
    button.dataset.verse = String(verseNumber);
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", isSelected ? "true" : "false");
    button.innerHTML = `<span class="bible-verse-number">${verseNumber}</span><span class="bible-verse-row-text">${escapeHtml(verseText)}</span>`;
    button.addEventListener("click", (event) => {
      const toggleSelection = event.ctrlKey || event.metaKey;
      const extendSelection = event.shiftKey && bibleVerseSelection.anchor > 0;
      if (extendSelection) {
        const rangeStart = Math.min(bibleVerseSelection.anchor, verseNumber);
        const rangeEnd = Math.max(bibleVerseSelection.anchor, verseNumber);
        if (!toggleSelection) bibleVerseSelection.verses.clear();
        for (let v = rangeStart; v <= rangeEnd; v += 1) {
          bibleVerseSelection.verses.add(v);
        }
      } else if (toggleSelection) {
        if (bibleVerseSelection.verses.has(verseNumber)) {
          bibleVerseSelection.verses.delete(verseNumber);
        } else {
          bibleVerseSelection.verses.add(verseNumber);
        }
        bibleVerseSelection.anchor = verseNumber;
      } else {
        bibleVerseSelection.verses.clear();
        bibleVerseSelection.verses.add(verseNumber);
        bibleVerseSelection.anchor = verseNumber;
      }

      const selectedVerses = selectedBibleVerseNumbers();
      bibleDesignerState.verse = selectedVerses[0] || verseNumber;
      bibleDesignerState.verseEnd =
        selectedVerses.length > 1 ? selectedVerses[selectedVerses.length - 1] : 0;
      renderBibleVerseList();
      applySelectedBibleVersePreview();
    });
    button.addEventListener("contextmenu", (event) => {
      if (!bibleVerseSelection.verses.has(verseNumber)) {
        bibleVerseSelection.verses.clear();
        bibleVerseSelection.verses.add(verseNumber);
      }
      bibleVerseSelection.anchor = verseNumber;
      const selectedVerses = selectedBibleVerseNumbers();
      bibleDesignerState.verse = selectedVerses[0] || verseNumber;
      bibleDesignerState.verseEnd =
        selectedVerses.length > 1 ? selectedVerses[selectedVerses.length - 1] : 0;
      renderBibleVerseList();
      applySelectedBibleVersePreview();
      showBibleTextContextMenu(event);
    });
    button.addEventListener("dblclick", () => {
      bibleVerseSelection.verses.clear();
      bibleVerseSelection.verses.add(verseNumber);
      bibleVerseSelection.anchor = verseNumber;
      const reference = `${bibleDesignerState.book} ${bibleDesignerState.chapter}:${verseNumber}`;
      document.getElementById("bibleReferenceInput").value = reference;
      setBiblePreviewText(reference, verseText, { verse: verseNumber, verseEnd: 0 });
      renderBibleVerseList();
    });
    list.appendChild(button);
  });
}

function refreshBibleBrowser() {
  syncBibleStateFromControls();
  renderBibleVerseList();
  syncBibleSelectorsFromState();
}

function jumpBibleReferenceToBrowser() {
  const referenceInput = document.getElementById("bibleReferenceInput");
  hideBibleReferenceSuggestions();
  const resolvedReference = normalizeBibleReferenceInput(referenceInput?.value || "");
  if (!resolvedReference) {
    showGnomeToast("Enter a reference like John 3:16");
    return false;
  }
  const nextReference = resolvedReference;
  bibleDesignerState.book = nextReference.book;
  bibleDesignerState.chapter = nextReference.chapter;
  bibleDesignerState.verse = nextReference.verse;
  bibleDesignerState.verseEnd = nextReference.verseEnd;
  bibleDesignerState.reference = nextReference.reference;
  if (referenceInput) referenceInput.value = nextReference.reference;
  bibleVerseSelection.verses.clear();
  bibleVerseSelection.anchor = 0;
  refreshBibleBrowser();
  if (bibleDesignerState.verse > 0) {
    let lookupResult = null;
    try {
      lookupResult = lookupBibleReference(
        bibleDesignerState.reference,
        bibleDesignerState.version,
      );
    } catch {}
    if (!lookupResult) {
      setBiblePreviewText(bibleDesignerState.reference, "Text not found", {
        verse: bibleDesignerState.verse,
        verseEnd: bibleDesignerState.verseEnd,
      });
      showGnomeToast("Text not found");
      return false;
    }
    const row = document.querySelector(
      `.bible-verse-row[data-verse="${bibleDesignerState.verse}"]`,
    );
    centerBibleVerseRowInList(row);
    refreshBibleLookupPreview();
  }
  return true;
}

async function openBibleWorkspaceFromButton() {
  showBibleWorkspace();
  await bibleAPI.waitForReady();

  const firstBibleIndex = mediaQueue.findIndex((item) => isQueueItemBible(item));
  if (firstBibleIndex >= 0) {
    await loadQueueItemIntoPreviewCue(firstBibleIndex);
    jumpBibleReferenceToBrowser();
    return;
  }

  if (currentPreviewCue()) {
    clearPreviewCue();
  }

  const hasLoadedBibleText = Boolean(
    normalizeScriptureReference(bibleDesignerState.reference || "") || bibleDesignerState.text,
  );
  if (!hasLoadedBibleText) {
    Object.assign(bibleDesignerState, {
      ...bibleDesignerState,
      version: bibleDesignerState.version || "KJV",
      reference: "Genesis 1:1",
      text: "",
      book: "Genesis",
      chapter: 1,
      verse: 1,
      verseEnd: 0,
    });
  }

  syncBibleSelectorsFromState();
  jumpBibleReferenceToBrowser();
}

function installBibleMediaControls() {
  const versionSelect = document.getElementById("bibleVersionSelect");
  const referenceSuggestions = document.getElementById("bibleReferenceSuggestions");
  const referenceInput = document.getElementById("bibleReferenceInput");
  const referenceToggle = document.getElementById("bibleReferenceToggle");
  if (!versionSelect || versionSelect.dataset.bibleBound === "1") return;
  versionSelect.dataset.bibleBound = "1";
  installBibleWorkspaceEventGuards();
  syncLowerThirdFeatureAvailability();
  installBiblePreviewScaleObserver();

  versionSelect.innerHTML = '<option value="KJV">KJV</option>';
  versionSelect.value = bibleDesignerState.version;
  referenceInput.value = bibleDesignerState.reference;
  syncBibleStyleControlsFromState();
  syncBibleBackgroundLabel();

  document.getElementById("openBibleWorkspaceBtn")?.addEventListener("click", () => {
    void openBibleWorkspaceFromButton().catch(console.error);
  });
  ["biblePreviewText", "biblePreviewReference"].forEach((id) => {
    document.getElementById(id)?.addEventListener("contextmenu", showBibleTextContextMenu);
  });
  versionSelect.addEventListener("change", () => {
    bibleDesignerState.version = versionSelect.value;
    bibleVerseSelection.verses.clear();
    bibleVerseSelection.anchor = 0;
    refreshBibleBrowser();
    applyBiblePreview(bibleDesignerState);
    syncShowNowBiblePresentation();
  });
  referenceInput.addEventListener("input", () => {
    if (!isBibleReferenceSuggestionsOpen()) return;
    bibleReferenceSuggestionIndex = -1;
    renderBibleReferenceSuggestions();
  });
  referenceInput.addEventListener("focus", () => {
    positionBibleReferenceSuggestionsOverlay();
  });
  referenceInput.addEventListener("blur", () => {
    window.setTimeout(() => hideBibleReferenceSuggestions(), 120);
  });
  referenceToggle?.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const isOpen = referenceSuggestions?.hidden === false;
    if (isOpen) {
      hideBibleReferenceSuggestions();
      return;
    }
    bibleReferenceSuggestionIndex = -1;
    renderBibleReferenceSuggestions({ showAll: true });
    referenceInput.focus();
  });
  referenceInput.addEventListener("change", jumpBibleReferenceToBrowser);
  window.addEventListener("resize", positionBibleReferenceSuggestionsOverlay);
  window.addEventListener("scroll", positionBibleReferenceSuggestionsOverlay, true);
  referenceInput.addEventListener("keydown", (event) => {
    const suggestionButtons = referenceSuggestions?.querySelectorAll(".bible-reference-suggestion") || [];
    if (event.key === "ArrowDown" && isBibleReferenceSuggestionsOpen() && suggestionButtons.length) {
      event.preventDefault();
      bibleReferenceSuggestionIndex =
        bibleReferenceSuggestionIndex < suggestionButtons.length - 1
          ? bibleReferenceSuggestionIndex + 1
          : 0;
      updateBibleReferenceSuggestionActiveState();
      return;
    }
    if (event.key === "ArrowUp" && isBibleReferenceSuggestionsOpen() && suggestionButtons.length) {
      event.preventDefault();
      bibleReferenceSuggestionIndex =
        bibleReferenceSuggestionIndex > 0
          ? bibleReferenceSuggestionIndex - 1
          : suggestionButtons.length - 1;
      updateBibleReferenceSuggestionActiveState();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (
        isBibleReferenceSuggestionsOpen() &&
        bibleReferenceSuggestionIndex >= 0 &&
        bibleReferenceSuggestionIndex < suggestionButtons.length
      ) {
        applyBibleReferenceSuggestion(
          suggestionButtons[bibleReferenceSuggestionIndex].textContent || "",
        );
        return;
      }
      jumpBibleReferenceToBrowser();
      return;
    }
    if (event.key === "Escape") {
      hideBibleReferenceSuggestions();
    }
  });
  document.getElementById("bibleLookSelect")?.addEventListener("change", () => {
    syncBibleStateFromControls();
    resolveBibleLowerThirdState(bibleDesignerState, {
      panel: bibleLowerThirdMeasurePanel(),
    });
    commitBibleDesignerRenderState();
  });
  document.getElementById("bibleLowerThirdPrevBtn")?.addEventListener("click", () => {
    changeBibleLowerThirdSegment(-1);
  });
  document.getElementById("bibleLowerThirdNextBtn")?.addEventListener("click", () => {
    void advanceBibleLowerThirdCursor().catch((err) => {
      console.error("Failed to advance Bible lower-third cursor:", err);
      showGnomeToast("Failed to advance Bible text");
    });
  });
  document.getElementById("bibleLowerThirdAutoSplitBtn")?.addEventListener("click", () => {
    rebuildBibleLowerThirdSegments();
  });
  [
    "bibleFontInput",
    "bibleFontSizeInput",
    "bibleTextColorInput",
    "bibleBackgroundColorInput",
    "bibleLowerThirdTextColorInput",
    "bibleLowerThirdChromaKeyInput",
  ].forEach((id) => {
    const control = document.getElementById(id);
    const handleBibleStyleChange = () => {
      if (id === "bibleFontInput") bibleStyleDirtyState.fontFamily = true;
      if (id === "bibleFontSizeInput") bibleStyleDirtyState.fontSize = true;
      if (id === "bibleTextColorInput") bibleStyleDirtyState.color = true;
      if (id === "bibleBackgroundColorInput") bibleStyleDirtyState.backgroundColor = true;
      if (id === "bibleLowerThirdTextColorInput") bibleStyleDirtyState.lowerThirdColor = true;
      if (id === "bibleLowerThirdChromaKeyInput") {
        bibleStyleDirtyState.lowerThirdChromaKeyColor = true;
      }
      syncBibleStateFromControls();
      Object.assign(bibleDesignerState, getBibleDesignerStyle());
      if (id === "bibleFontInput" || id === "bibleFontSizeInput") {
        resolveBibleLowerThirdState(bibleDesignerState, {
          rebuild: true,
          panel: bibleLowerThirdMeasurePanel(),
        });
      }
      applyBiblePreview(bibleDesignerState, { show: false });
      if (syncBibleDesignerStateToPreviewedQueueItem()) {
        saveMediaFile();
      }
      syncActiveScheduledBiblePresentation();
      syncShowNowBiblePresentation();
    };
    control?.addEventListener("input", handleBibleStyleChange);
    control?.addEventListener("change", handleBibleStyleChange);
  });
  document.getElementById("bibleBackgroundInput")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    bibleDesignerState.backgroundPath = file ? getPathForFile(file) : "";
    bibleStyleDirtyState.backgroundPath = true;
    syncBibleBackgroundLabel();
    applyBiblePreview(bibleDesignerState);
    if (syncBibleDesignerStateToPreviewedQueueItem()) {
      saveMediaFile();
    }
    syncActiveScheduledBiblePresentation();
    syncShowNowBiblePresentation();
  });
  document
    .getElementById("bibleApplyCurrentBtn")
    ?.addEventListener("click", applyBibleStyleToCurrentText);
  document
    .getElementById("bibleApplyStyleScheduleBtn")
    ?.addEventListener("click", applyBibleStyleToScheduledText);
  document
    .getElementById("bibleUseStyleDefaultsBtn")
    ?.addEventListener("click", useBibleStyleAsDefaults);
  document.getElementById("bibleClearBackgroundBtn")?.addEventListener("click", () => {
    bibleDesignerState.backgroundPath = "";
    bibleStyleDirtyState.backgroundPath = true;
    const backgroundInput = document.getElementById("bibleBackgroundInput");
    if (backgroundInput) backgroundInput.value = "";
    syncBibleBackgroundLabel("");
    applyBiblePreview(bibleDesignerState);
    if (syncBibleDesignerStateToPreviewedQueueItem()) {
      saveMediaFile();
    }
    syncActiveScheduledBiblePresentation();
    syncShowNowBiblePresentation();
  });
  document
    .getElementById("bibleShowNowBtn")
    ?.addEventListener("click", () => void showBibleTextNow());
  document.getElementById("bibleInsertQueueBtn")?.addEventListener("click", insertBibleInSchedule);
  bibleAPI
    .waitForReady()
    .then(() => {
      const versions = normalizedBibleVersions(bibleAPI.getVersions());
      versionSelect.innerHTML = "";
      (versions.length ? versions : ["KJV"]).forEach((version) => {
        const value = bibleVersionValue(version);
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        versionSelect.appendChild(option);
      });
      bibleBooksCache = bibleAPI.getBooks().sort((a, b) => a.id - b.id);
      if (referenceSuggestions) {
        hideBibleReferenceSuggestions();
      }
      versionSelect.value = bibleDesignerState.version;
      syncBibleSelectorsFromState();
      refreshBibleBrowser();
      applyBiblePreview(bibleDesignerState, { show: false });
    })
    .catch((err) => {
      console.error("Failed to load Bible versions:", err);
      applyBiblePreview(bibleDesignerState, { show: false });
    });
}

function buildProjectStateSnapshot() {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectPath: currentProjectPath || "",
    projectStorageMode: currentProjectStorageMode,
    projectScriptureText: projectScriptureTextFromOverrides(projectScriptureOverrides),
    currentMode,
    currentQueueIndex,
    previewCueIndex,
    mediaQueue: mediaQueue.map((item) => ({
      path: item.path,
      name: item.name,
      type: item.type,
      missing: item.missing === true,
      originalPath:
        typeof item.originalPath === "string" && item.originalPath.length > 0
          ? item.originalPath
          : item.path,
      originalName:
        typeof item.originalName === "string" && item.originalName.length > 0
          ? item.originalName
          : queueBasename(item.path),
      sha256: typeof item.sha256 === "string" ? item.sha256 : undefined,
      sizeBytes: Number.isFinite(item.sizeBytes) ? item.sizeBytes : undefined,
      modifiedTime:
        typeof item.modifiedTime === "string" ? item.modifiedTime : undefined,
      autoAdvance: item.autoAdvance !== false,
      cueStartTime: queueItemCueStartTime(item),
      cueVolume: Number.isFinite(item.cueVolume) ? item.cueVolume : undefined,
      loop: loopEnabledForQueueItem(item),
      pptxSlideIndex: Number.isFinite(item.pptxSlideIndex)
        ? item.pptxSlideIndex
        : undefined,
      bible: item.bible && typeof item.bible === "object" ? { ...item.bible } : undefined,
    })),
  };
}

function applyProjectStateSnapshot(state) {
  if (!state || typeof state !== "object") return false;
  if (!Array.isArray(state.mediaQueue)) return false;
  currentProjectStorageMode = state.projectStorageMode === "packed" ? "packed" : "working";
  Object.assign(
    projectScriptureOverrides,
    overridesFromProjectScriptureText(state.projectScriptureText),
  );
  bibleStyleDirtyState.fontFamily = false;
  bibleStyleDirtyState.fontSize = false;
  bibleStyleDirtyState.color = false;
  bibleStyleDirtyState.backgroundColor = false;
  bibleStyleDirtyState.backgroundPath = false;
  bibleStyleDirtyState.lowerThirdColor = false;
  bibleStyleDirtyState.lowerThirdChromaKeyColor = false;
  mediaQueue = state.mediaQueue
    .filter((x) => x && typeof x.path === "string" && x.path.length > 0)
    .map((x) => {
      const item = {
        path: x.path,
        name:
          typeof x.name === "string" && x.name.length > 0
            ? x.name
            : queueBasename(x.path),
        type: x.type === "bible" ? "bible" : classifyQueueMediaType(x.path),
        missing: x.type === "bible" ? false : x.missing === true,
        originalPath:
          typeof x.originalPath === "string" && x.originalPath.length > 0
            ? x.originalPath
            : x.path,
        originalName:
          typeof x.originalName === "string" && x.originalName.length > 0
            ? x.originalName
            : queueBasename(x.originalPath || x.path),
        sha256: typeof x.sha256 === "string" ? x.sha256 : undefined,
        sizeBytes: Number.isFinite(x.sizeBytes) ? x.sizeBytes : undefined,
        modifiedTime:
          typeof x.modifiedTime === "string" ? x.modifiedTime : undefined,
        autoAdvance: x.autoAdvance !== false,
        cueStartTime: Number.isFinite(x.cueStartTime) ? x.cueStartTime : 0,
        cueVolume: Number.isFinite(x.cueVolume) ? x.cueVolume : undefined,
        loop: x.loop === true && mediaPathSupportsLoop(x.path),
        pptxSlideIndex: Number.isFinite(x.pptxSlideIndex) ? x.pptxSlideIndex : -1,
        bible: x.bible && typeof x.bible === "object" ? { ...x.bible } : undefined,
      };
      item.cueStartTime = queueItemCueStartTime(item);
      return item;
    });
  Object.assign(bibleDesignerState, resolvedBibleStyleDefaults());
  currentQueueIndex =
    Number.isInteger(state.currentQueueIndex) &&
    state.currentQueueIndex >= 0 &&
    state.currentQueueIndex < mediaQueue.length
      ? state.currentQueueIndex
      : -1;
  previewCueIndex =
    Number.isInteger(state.previewCueIndex) &&
    state.previewCueIndex >= 0 &&
    state.previewCueIndex < mediaQueue.length
      ? state.previewCueIndex
      : -1;
  if (
    currentMode === MEDIAPLAYER &&
    mediaQueue.length > 0 &&
    currentQueueIndex < 0 &&
    previewCueIndex < 0 &&
    !isQueuePresentationActive()
  ) {
    currentQueueIndex = 0;
  }
  if (
    !isQueuePresentationActive() &&
    previewCueIndex >= 0 &&
    previewCueIndex === currentQueueIndex
  ) {
    previewCueIndex = -1;
  }
  renderQueue();
  updatePreviewCueUI();
  updateDynUI();
  syncBibleStyleControlsFromState();
  if (mediaQueue.length > 0 && currentMode === MEDIAPLAYER) {
    const previewIndex =
      currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
        ? currentQueueIndex
        : 0;
    void loadQueueItemIntoControlWindow(mediaQueue[previewIndex], {
      previewLoadToken: nextPreviewLoadToken(),
    }).catch((err) => console.error(err));
  }
  return true;
}

function scheduleAutosaveProjectState() {
  if (autosaveWriteTimer !== null) {
    clearTimeout(autosaveWriteTimer);
  }
  autosaveWriteTimer = setTimeout(() => {
    autosaveWriteTimer = null;
    void invoke("save-autosave-project-state", buildProjectStateSnapshot()).catch(
      (err) => console.error("autosave failed:", err),
    );
  }, AUTOSAVE_WRITE_DEBOUNCE_MS);
}

async function refreshMissingFlagsAndWarn(opts = {}) {
  const warn = opts?.warn !== false;
  if (!Array.isArray(mediaQueue) || mediaQueue.length === 0) return;
  const fileItems = mediaQueue
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !isQueueItemBible(item));
  if (fileItems.length === 0) return;
  let probe = [];
  try {
    probe = await invoke("check-media-paths-exist", fileItems.map(({ item }) => item.path));
  } catch (err) {
    console.error("check-media-paths-exist failed:", err);
    return;
  }
  const missingFiles = [];
  fileItems.forEach(({ item }, i) => {
    const exists = probe?.[i]?.exists === true;
    item.missing = !exists;
    if (!exists && typeof item.path === "string") {
      missingFiles.push(item.path);
    }
  });
  renderQueue();
  if (warn && missingFiles.length > 0) {
    void invoke("show-missing-project-files-dialog", { missingFiles }).catch(
      (err) => console.error("Failed to show missing-files dialog:", err),
    );
  }
}

async function relinkMissingFilesDialog() {
  const missingItems = mediaQueue
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item?.missing === true);
  if (missingItems.length === 0) {
    showGnomeToast("No missing files to relink");
    return false;
  }

  try {
    const folder = await invoke("show-relink-folder-dialog");
    if (!folder || folder.canceled || !folder.filePath) return false;
    const result = await invoke("relink-missing-media", {
      searchRoot: folder.filePath,
      missingItems: missingItems.map(({ item, index }) => ({
        index,
        path: item.path,
        name: item.name,
        originalPath: item.originalPath || item.path,
        originalName: item.originalName || queueBasename(item.originalPath || item.path),
        sha256: item.sha256,
        sizeBytes: item.sizeBytes,
        modifiedTime: item.modifiedTime,
      })),
    });

    const matches = Array.isArray(result?.matches) ? result.matches : [];
    for (const match of matches) {
      if (!Number.isInteger(match.index) || match.index < 0 || match.index >= mediaQueue.length) {
        continue;
      }
      const item = mediaQueue[match.index];
      if (!item) continue;
      item.path = match.path;
      item.type = classifyQueueMediaType(match.path);
      item.missing = false;
      item.originalPath = item.originalPath || match.originalPath || match.path;
      item.originalName = item.originalName || queueBasename(item.originalPath || match.path);
      if (Number.isFinite(match.sizeBytes)) item.sizeBytes = match.sizeBytes;
      if (typeof match.sha256 === "string") item.sha256 = match.sha256;
      if (typeof match.modifiedTime === "string") {
        item.modifiedTime = match.modifiedTime;
      }
      if (!item.name || item.name === queueBasename(item.originalPath || "")) {
        item.name = queueBasename(match.path);
      }
    }

    if (matches.length > 0) {
      renderQueue();
      await refreshMissingFlagsAndWarn({ warn: false });
      scheduleAutosaveProjectState();
    }
    await invoke("show-relink-summary-dialog", {
      searchedFolder: folder.filePath,
      matchedCount: matches.length,
      totalCount: missingItems.length,
      unresolved: Array.isArray(result?.unresolved) ? result.unresolved : [],
    });
    showGnomeToast(
      matches.length === missingItems.length
        ? "Missing files relinked"
        : `Relinked ${matches.length} of ${missingItems.length} missing files`,
    );
    return matches.length > 0;
  } catch (err) {
    console.error("Failed to relink missing files:", err);
    showGnomeToast("Failed to relink files");
    return false;
  }
}

async function openProjectDialog() {
  try {
    const res = await invoke("show-open-project-dialog");
    if (!res || res.canceled || !res.filePaths?.length) return;
    await openProjectByPath(res.filePaths[0]);
  } catch (err) {
    console.error("Failed to open project:", err);
    showGnomeToast("Failed to open project");
  }
}

async function openProjectByPath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return false;
  const project = await invoke("read-project-file", filePath);
  const parsed = JSON.parse(project.data);
  if (!applyProjectStateSnapshot(parsed)) {
    throw new Error("Project does not contain a valid queue.");
  }
  await refreshMissingFlagsAndWarn();
  currentProjectPath = filePath;
  currentProjectStorageMode = parsed.projectStorageMode === "packed" ? "packed" : "working";
  scheduleAutosaveProjectState();
  showGnomeToast("Project opened");
  return true;
}

async function saveProjectAsDialog() {
  try {
    const defaultPath = currentProjectPath || "Untitled.emproj";
    const res = await invoke("show-save-project-dialog", { defaultPath });
    if (!res || res.canceled || !res.filePath) return false;
    currentProjectPath = res.filePath;
    currentProjectStorageMode = "working";
    await syncCurrentPptxSlideForProjectSnapshot();
    const data = JSON.stringify(buildProjectStateSnapshot(), null, 2);
    await invoke("write-project-file", {
      filePath: currentProjectPath,
      data,
      mode: "working",
    });
    scheduleAutosaveProjectState();
    showGnomeToast("Project saved");
    return true;
  } catch (err) {
    console.error("Failed to save project as:", err);
    showGnomeToast("Failed to save project");
    return false;
  }
}

async function saveProject() {
  if (!currentProjectPath) {
    return saveProjectAsDialog();
  }
  return saveCurrentProjectInStorageMode();
}

async function exportPortableProjectDialog() {
  try {
    const defaultPath = currentProjectPath || "Untitled-Portable.emproj";
    const res = await invoke("show-export-project-dialog", { defaultPath });
    if (!res || res.canceled || !res.filePath) return false;
    await syncCurrentPptxSlideForProjectSnapshot();
    const data = JSON.stringify(buildProjectStateSnapshot(), null, 2);
    await invoke("write-project-file", {
      filePath: res.filePath,
      data,
      mode: "packed",
    });
    showGnomeToast("Portable project exported");
    return true;
  } catch (err) {
    console.error("Failed to export portable project:", err);
    showGnomeToast("Failed to export project");
    return false;
  }
}

async function restoreAutosavedProjectState() {
  try {
    const state = await invoke("load-autosave-project-state");
    if (!state) return;
    if (applyProjectStateSnapshot(state)) {
      await refreshMissingFlagsAndWarn();
      currentProjectPath =
        typeof state.projectPath === "string" ? state.projectPath : "";
      currentProjectStorageMode = state.projectStorageMode === "packed" ? "packed" : "working";
    }
  } catch (err) {
    console.error("Failed to restore autosave:", err);
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

function firstDroppedProjectPath(dataTransfer) {
  if (!dataTransfer?.files?.length) return null;
  for (const file of dataTransfer.files) {
    const p = getPathForFile(file);
    if (typeof p === "string" && /\.(emproj|zip)$/i.test(p)) {
      return p;
    }
  }
  return null;
}

function applyDroppedMediaPaths(paths) {
  if (!paths || paths.length === 0) return;
  if (currentMode === MEDIAPLAYER) {
    enqueuePathsFromFilePicker(paths);
  }
  saveMediaFile();
  invoke("remember-media-folder", paths).catch((err) => {
    console.error("remember-media-folder failed:", err);
  });
}

function clearMediaQueue() {
  stopPreviewAudioCue();
  clearVideoPreviewCueOverlay();
  mediaQueue = [];
  currentQueueIndex = -1;
  previewCueIndex = -1;
  isQueuePlaying = false;
  manualBoundaryPauseIndex = -1;
  // Hand the countdown overlay back to the live media (or hide it if the
  // queue clear leaves nothing playing). Without this, a cleared queue
  // that previously hosted an image cue would leave the overlay hidden
  // even after the operator dragged in a new audio/video clip.
  restoreCountdownForLiveMedia();
  syncMediaLoopState({ notify: false });
  resetPreviewSurfaceToEmptyState();
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
      cueStartTime: queueItemCueStartTime(x),
      cueVolume: x.cueVolume,
      loop: loopEnabledForQueueItem(x),
      pptxSlideIndex: Number.isFinite(x.pptxSlideIndex) ? x.pptxSlideIndex : undefined,
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

  if (!isQueueItemBible(item) && !audioOnlyFile && !hasAudienceOutputSelected()) {
    showGnomeToast("Choose an audience output display");
    isQueuePlaying = false;
    isPlaying = false;
    updateDynUI();
    renderQueue();
    return;
  }

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

  mediaQueue = snap.items.map((x) => {
    const item = {
      path: x.path,
      name: x.name,
      type: x.type,
      cueStartTime: x.cueStartTime || 0,
      cueVolume: Number.isFinite(x.cueVolume) ? x.cueVolume : undefined,
      loop: x.loop === true && mediaPathSupportsLoop(x.path),
      pptxSlideIndex: Number.isFinite(x.pptxSlideIndex) ? x.pptxSlideIndex : undefined,
    };
    item.cueStartTime = queueItemCueStartTime(item);
    return item;
  });
  currentQueueIndex = snap.index;
  if (mediaQueue.length === 0) {
    currentQueueIndex = -1;
  } else if (currentQueueIndex >= mediaQueue.length) {
    currentQueueIndex = mediaQueue.length - 1;
  } else if (currentQueueIndex < 0) {
    currentQueueIndex = 0;
  }

  // Restore the cued item (the "next" marker) and its per-item start time
  // and volume (embedded in each queue entry).
  previewCueIndex =
    typeof snap.cueIndex === "number" &&
    snap.cueIndex >= 0 &&
    snap.cueIndex < mediaQueue.length
      ? snap.cueIndex
      : -1;
  if (previewCueIndex >= 0) {
    const cueItem = mediaQueue[previewCueIndex];
    pendingCueVolume = Number.isFinite(cueItem?.cueVolume) ? cueItem.cueVolume : 1;
  } else {
    pendingCueVolume = null;
  }
  cueVolumeDirty = false;
  syncGtkSliderToCueState();

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
  const removedCurrentItem = index === currentQueueIndex;
  if (removedCurrentItem && isQueuePresentationActive()) {
    showGnomeToast("Stop the presentation to remove the current item");
    return;
  }
  invalidateQueueUndoToastAfterMutation();
  mediaQueue.splice(index, 1);
  if (currentQueueIndex > index) currentQueueIndex--;
  else if (removedCurrentItem) {
    if (mediaQueue.length === 0) {
      currentQueueIndex = -1;
    } else if (index >= mediaQueue.length) {
      currentQueueIndex = mediaQueue.length - 1;
    } else {
      currentQueueIndex = index;
    }
  } else if (currentQueueIndex >= mediaQueue.length) currentQueueIndex = -1;
  if (manualBoundaryPauseIndex === index) {
    manualBoundaryPauseIndex = -1;
  } else if (manualBoundaryPauseIndex > index) {
    manualBoundaryPauseIndex--;
  } else if (manualBoundaryPauseIndex >= mediaQueue.length) {
    manualBoundaryPauseIndex = -1;
  }
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
  syncMediaLoopState({ notify: false });
  if (mediaQueue.length === 0) {
    resetPreviewSurfaceToEmptyState();
  }
  renderQueue();
  if (
    removedCurrentItem &&
    currentMode === MEDIAPLAYER &&
    mediaQueue.length > 0 &&
    !isQueuePresentationActive()
  ) {
    const previewIndex =
      currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
        ? currentQueueIndex
        : 0;
    void loadQueueItemIntoControlWindow(mediaQueue[previewIndex]).catch(
      (err) => console.error(err),
    );
  }
  saveMediaFile();
}

function toggleQueueItemAutoAdvance(index) {
  if (index < 0 || index >= mediaQueue.length) return;
  mediaQueue[index].autoAdvance = mediaQueue[index].autoAdvance === false;
  const autoAdvanceEnabled = mediaQueue[index].autoAdvance !== false;
  renderQueue();
  schedulePptxThumbnailRefresh();
  saveMediaFile();
  if (autoAdvanceEnabled) {
    void resumeQueueFromManualBoundaryIfReady(index).catch((err) =>
      console.error("Failed to resume queue after auto-advance toggle:", err),
    );
  }
}

async function resumeQueueFromManualBoundaryIfReady(index) {
  if (
    manualBoundaryPauseIndex !== index ||
    isQueuePlaying ||
    isPlaying ||
    index < 0 ||
    index >= mediaQueue.length ||
    currentQueueIndex !== index ||
    mediaQueue[index]?.autoAdvance === false
  ) {
    return;
  }

  manualBoundaryPauseIndex = -1;
  isQueuePlaying = true;
  isPlaying = true;
  updateDynUI();
  renderQueue();
  const item = mediaQueue[index];
  await playCurrentQueueItem({
    preservePreviewSeek: false,
    startTime: queueItemCueStartTime(item),
  });
}

function installMediaQueueListDelegation() {
  const list = document.getElementById("mediaQueueList");
  if (!list || list.dataset.queueDelegation === "1") return;
  list.dataset.queueDelegation = "1";
  list.addEventListener("click", (e) => {
    const autoBtn = e.target.closest("[data-queue-auto]");
    if (autoBtn && list.contains(autoBtn)) {
      e.preventDefault();
      toggleQueueItemAutoAdvance(
        Number.parseInt(autoBtn.getAttribute("data-queue-auto"), 10),
      );
      return;
    }
    const removeBtn = e.target.closest("[data-queue-remove]");
    if (removeBtn && list.contains(removeBtn)) {
      e.preventDefault();
      removeFromQueue(
        Number.parseInt(removeBtn.getAttribute("data-queue-remove"), 10),
      );
      return;
    }
    if (ignoreNextQueueItemClick || performance.now() < ignoreQueueItemClicksUntil) {
      return;
    }
    const row = e.target.closest(".queue-item[data-queue-index]");
    if (!row || !list.contains(row)) return;
    const idx = Number.parseInt(row.getAttribute("data-queue-index"), 10);
    if (Number.isNaN(idx)) return;
    if (e.detail > 1) return;
    if (queueItemClickTimer !== null) {
      window.clearTimeout(queueItemClickTimer);
    }
    queueItemClickTimer = window.setTimeout(() => {
      queueItemClickTimer = null;
      void onQueueItemActivate(idx);
    }, 220);
  });

  list.addEventListener("dblclick", (e) => {
    if (e.target.closest("[data-queue-remove]")) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (queueItemClickTimer !== null) {
      window.clearTimeout(queueItemClickTimer);
      queueItemClickTimer = null;
    }
    const row = e.target.closest(".queue-item[data-queue-index]");
    if (!row || !list.contains(row)) return;
    const idx = Number.parseInt(row.getAttribute("data-queue-index"), 10);
    if (Number.isNaN(idx)) return;
    void switchQueueItemLiveWithConfirmation(idx).catch((err) => console.error(err));
  });

  list.addEventListener("dragstart", (e) => {
    const row = e.target.closest(".queue-item[data-queue-index]");
    if (!row || !list.contains(row)) return;
    if (e.target.closest("[data-queue-remove]")) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    const idx = Number.parseInt(row.getAttribute("data-queue-index"), 10);
    if (Number.isNaN(idx)) return;
    queueDragFromIndex = idx;
    e.dataTransfer.setData("application/x-queue-index", String(idx));
    e.dataTransfer.setData("text/plain", String(idx));
    e.dataTransfer.effectAllowed = "move";
    if (row) row.classList.add("queue-item-dragging");
  });

  list.addEventListener("dragend", (e) => {
    queueDragFromIndex = -1;
    list.querySelectorAll(".queue-item-dragging").forEach((el) => {
      el.classList.remove("queue-item-dragging");
    });
    list.querySelectorAll(".queue-item-drag-over").forEach((el) => {
      el.classList.remove("queue-item-drag-over");
    });
  });

  list.addEventListener("dragover", (e) => {
    const hasInternalQueueDrag = queueDragFromIndex >= 0;
    if (
      !hasInternalQueueDrag &&
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
    const hasInternalQueueDrag = queueDragFromIndex >= 0;
    if (hasInternalQueueDrag) {
      const row = e.target.closest(".queue-item[data-queue-index]");
      if (!row || !list.contains(row)) return;
      e.preventDefault();
      e.stopPropagation();
      const from = queueDragFromIndex;
      const to = Number.parseInt(row.getAttribute("data-queue-index"), 10);
      list.querySelectorAll(".queue-item-drag-over").forEach((el) => {
        el.classList.remove("queue-item-drag-over");
      });
      queueDragFromIndex = -1;
      if (Number.isNaN(to) || Number.isNaN(from)) return;
      reorderMediaQueue(from, to);
      return;
    }

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
      const droppedProject = firstDroppedProjectPath(e.dataTransfer);
      if (droppedProject) {
        try {
          await openProjectByPath(droppedProject);
        } catch (err) {
          console.error("Failed to open dropped project:", err);
          showGnomeToast("Failed to open project");
        }
        return;
      }
      const paths = await extractAndFilterDroppedMediaPaths(e.dataTransfer);
      applyDroppedMediaPaths(paths);
      return;
    }
    // Neither internal queue drag nor OS file drop.
    list.querySelectorAll(".queue-item-drag-over").forEach((el) => {
      el.classList.remove("queue-item-drag-over");
    });
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
  const item = mediaQueue[index];
  if (!isQueueItemBible(item)) {
    hideBibleWorkspace();
  }
  if (isQueueItemPptx(item)) {
    const liveSlide = await getLivePptxSlideFromMediaWindow(item.path);
    const startSlide = isSavedPptxSlideIndex(liveSlide)
      ? liveSlide
      : pptxStartSlideForItem(item);
    mediaFile = item.path;
    mediaPlayerInputState.filePaths = [item.path];
    updateQueueFileLabel(item.name);
    commitActiveCueVolume();
    previewCueIndex = -1;
    pendingCueVolume = null;
    cueVolumeDirty = false;
    syncGtkSliderToCueState();
    stopPreviewAudioCue();
    clearVideoPreviewCueOverlay();
    setMediaCountdownOverlayVisible(false);
    setMediaCountdownText("");
    await loadPptxPreview(item.path, { startSlide });
    syncMediaLoopState({ notify: false });
    updatePreviewCueUI();
    renderQueue();
    syncPlayPauseIconToControlMedia();
    return;
  } else if (isQueueItemBible(item)) {
    const liveBibleEntry = resolvedBibleEntryForItem(item);
    mediaFile = item.path;
    mediaPlayerInputState.filePaths = [item.path];
    updateQueueFileLabel(item.name);
    commitActiveCueVolume();
    previewCueIndex = -1;
    pendingCueVolume = null;
    cueVolumeDirty = false;
    syncGtkSliderToCueState();
    stopPreviewAudioCue();
    clearVideoPreviewCueOverlay();
    setMediaCountdownOverlayVisible(false);
    setMediaCountdownText("");
    item.bible = { ...liveBibleEntry };
    loadBibleEntryIntoEditor(liveBibleEntry);
    showBibleWorkspace();
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
    syncMediaLoopState({ notify: false });
    updatePreviewCueUI();
    renderQueue();
    syncPlayPauseIconToControlMedia();
    return;
  } else {
    restoreNonPptxPreviewSurface({ isImage: isQueueItemImage(item) });
  }

  // The main #preview element has been mirroring the live output the whole
  // time the cue overlay was visible — it was never reloaded with the cued
  // source — so "restoring" just means tearing down the cue scratch state.
  // No reload, no replay, no risk of the live mirror lingering in a paused
  // state because the resume race was lost.
  commitActiveCueVolume();
  previewCueIndex = -1;
  pendingCueVolume = null;
  cueVolumeDirty = false;
  syncGtkSliderToCueState();
  stopPreviewAudioCue();
  clearVideoPreviewCueOverlay();
  // The cue may have hidden the countdown overlay (image cue) or pinned
  // it to the cue's time-remaining (video/audio cue). Either way the
  // live media is now back in charge, so re-establish whatever the live
  // source dictates: hidden for image live, repainted with live time
  // otherwise. handleTimeMessage takes over from the next IPC tick.
  restoreCountdownForLiveMedia();
  if (!isQueueItemImage(item)) {
    document.getElementById("customControls")?.style.setProperty("visibility", "");
  }

  if (liveAudioQueueIndex >= 0 && liveAudio?.src && liveAudio.src !== "") {
    // The audio-cue panel may have been displayed over the audio-only mirror;
    // refresh the scrubber so it shows liveAudio's position again.
    refreshLiveAudioControls();
  }

  syncPreviewAudioTrackState();
  syncMediaLoopState({ notify: false });
  updatePreviewCueUI();
  renderQueue();

  syncPlayPauseIconToControlMedia();
}

async function restorePreviewCueAfterPresentationStopped() {
  const cue = currentPreviewCue();
  if (!cue || currentMode !== MEDIAPLAYER) return false;

  mediaFile = cue.item.path;
  mediaPlayerInputState.filePaths = [mediaFile];
  updateQueueFileLabel(cue.item.name);

  if (isQueueItemPptx(cue.item)) {
    await loadPptxPreview(cue.item.path, {
      startSlide: pptxStartSlideForItem(cue.item),
    });
  } else if (isQueueItemBible(cue.item)) {
    stopPreviewAudioCue();
    clearVideoPreviewCueOverlay();
    setMediaCountdownOverlayVisible(false);
    setMediaCountdownText("");
    const cueBibleEntry = resolvedBibleEntryForItem(cue.item);
    if (cue.item) cue.item.bible = { ...cueBibleEntry };
    loadBibleEntryIntoEditor(cueBibleEntry);
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
  } else if (isQueueItemAudio(cue.item)) {
    setMediaCountdownOverlayVisible(true);
    setMediaCountdownText("");
    if (!isAudioPreviewCueActive()) {
      await loadAudioQueueItemIntoPreviewCue(cue.index, cue.item, cue.startTime);
    }
  } else if (isQueueItemImage(cue.item)) {
    restoreNonPptxPreviewSurface({ isImage: true });
    clearVideoPreviewCueOverlay();
    stopPreviewAudioCue();
    const cueEl = ensurePreviewCueVideoElement();
    if (cueEl) {
      cueEl.poster = pathToMediaUrl(cue.item.path);
      cueEl.hidden = false;
    }
    setMediaCountdownOverlayVisible(false);
    setMediaCountdownText("");
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
  } else {
    restoreNonPptxPreviewSurface();
    setMediaCountdownOverlayVisible(true);
    setMediaCountdownText("");
    if (!isVideoPreviewCueActive()) {
      await loadVideoQueueItemIntoPreviewCueOverlay(cue.index, cue.item, cue.startTime);
    }
  }

  updatePreviewCueUI();
  renderQueue();
  syncPreviewMediaAfterPresentationStateChange();
  return true;
}

async function loadAudioQueueItemIntoPreviewCue(index, item, startTime) {
  if (!isBiblePresentationActive()) {
    restoreNonPptxPreviewSurface();
  }
  const token = nextPreviewLoadToken();
  const audio = ensurePreviewAudioElement();
  previewAudioCueIndex = index;

  if (!isBiblePresentationActive()) {
    stopLiveAudioPresentation();
  }

  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  audio.muted = true;
  audio.volume = 0;
  audio.loop = loopEnabledForQueueItem(item);
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
  syncPreviewAudioCueAudibility();
  syncMediaLoopState({ notify: false });
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
  syncPreviewStackSurface();
  if (hadPoster) {
    document.getElementById("customControls")?.style.setProperty("visibility", "");
  }

  // If the live output is still an image, restore its visibility now that
  // the cue overlay is gone. Without this the preview goes blank after
  // the operator dismisses a video cue while an image is presenting.
  const liveItem = currentLiveQueueItem();
  if ((mediaFile && isImg(mediaFile)) || isQueueItemImage(liveItem)) {
    const liveImg = document.querySelector("img#preview");
    if (liveImg) liveImg.style.display = "";
  }
}

async function loadQueueItemIntoPreviewCue(index) {
  if (index < 0 || index >= mediaQueue.length) return;
  if (queueIndexIsCurrentLivePresentation(index)) {
    await restorePreviewToLiveOutput(index);
    return;
  }

  commitActiveCueVolume();
  previewCueIndex = index;
  cueVolumeDirty = false;
  // Paint the Cued badge immediately — the overlay/metadata load below is
  // async and callers may flip playback flags before it finishes.
  renderQueue();
  syncMediaLoopState({ notify: false });
  const item = mediaQueue[index];
  pendingCueVolume = Number.isFinite(item.cueVolume) ? item.cueVolume : 1;
  syncGtkSliderToCueState();
  const cueStart = queueItemCueStartTime(item);

  const bibleWorkspaceVisible =
    document.getElementById("bibleWorkspace")?.hidden === false;
  if (bibleWorkspaceVisible && !isQueueItemBible(item)) {
    hideBibleWorkspace();
  }

  if (isLocalAppWindowPresentationActive() && isQueueItemAudio(item)) {
    restoreNonPptxPreviewSurface();
    setCueStartTime(index, cueStart);
    syncMediaLoopState({ notify: false });
    updatePreviewCueUI();
    renderQueue();
    return;
  }

  if (isQueueItemPptx(item)) {
    clearVideoPreviewCueOverlay();
    stopPreviewAudioCue();
    await loadPptxPreview(item.path, {
      preserveLiveAudio: isLocalAppWindowPresentationActive(),
      preserveLiveVideo: isQueuePresentationActive() && isQueueItemVideo(currentLiveQueueItem()),
      preserveLiveBible: isBiblePresentationActive(),
    });
    syncMediaLoopState({ notify: false });
    updatePreviewCueUI();
    renderQueue();
    return;
  }

  if (isQueueItemBible(item)) {
    hidePptxPreviewIfNeeded();
    stopPreviewAudioCue();
    clearVideoPreviewCueOverlay();
    setMediaCountdownOverlayVisible(false);
    setMediaCountdownText("");
    const cueBibleEntry = resolvedBibleEntryForItem(item);
    item.bible = { ...cueBibleEntry };
    loadBibleEntryIntoEditor(cueBibleEntry);
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
  } else if (isQueueItemImage(item)) {
    if (!isBiblePresentationActive()) {
      restoreNonPptxPreviewSurface({ isImage: true });
    }
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
      setPreviewStackSurface(PREVIEW_SURFACE_CUE_IMAGE);
    }
    setMediaCountdownOverlayVisible(false);
    setMediaCountdownText("");
    // No timeline to scrub for a static image — hide the transport controls
    // so the operator isn't offered play/seek/loop actions that have no effect.
    // clearVideoPreviewCueOverlay restores visibility when the cue clears.
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
  } else if (isQueueItemAudio(item)) {
    if (!isBiblePresentationActive()) {
      restoreNonPptxPreviewSurface();
    }
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
    setMediaCountdownText("");
    await loadAudioQueueItemIntoPreviewCue(index, item, cueStart);
  } else {
    if (!isBiblePresentationActive()) {
      restoreNonPptxPreviewSurface();
    }
    // Video cues used to re-load the main #preview element with the cued
    // source, which forcibly paused the live mirror. That confused
    // operators who expected the live preview to keep running while they
    // scrub a different item ("the preview that is matching the live
    // video should never pause just because the user switched to scrub
    // the queued media"). The cue now goes into a dedicated overlay so
    // the mirror keeps playing underneath, undisturbed.
    stopPreviewAudioCue();
    // Allow the cue metadata handler to show a fresh countdown when it
    // paints; until then the pill stays hidden so no blank chrome leaks.
    setMediaCountdownOverlayVisible(true);
    setMediaCountdownText("");
    await loadVideoQueueItemIntoPreviewCueOverlay(index, item, cueStart);
    syncPreviewAudioTrackState();
  }
  syncMediaLoopState({ notify: false });
  updatePreviewCueUI();
  renderQueue();
}

async function takeQueueItemLive(index, startTime = 0) {
  if (index < 0 || index >= mediaQueue.length) return;
  if (pendingQueueSwitchIndex !== null) return;

  const item = mediaQueue[index];
  const safeStart =
    queueItemSupportsCueStartTime(item) && Number.isFinite(startTime) && startTime > 0
      ? startTime
      : 0;
  item.cueStartTime = safeStart;

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
  await switchQueueItemLiveWithConfirmation(cue.index, cue.startTime);
}

function shouldConfirmLiveSwitch(targetItem) {
  const presentationActive =
    isQueuePresentationActive() ||
    isActiveMediaWindow() ||
    isLocalAppWindowPresentationActive() ||
    Boolean(isPlaying);
  if (!presentationActive) return false;

  const liveItem =
    currentLiveQueueItemForSwitchPrompt();
  if (!liveItem || !targetItem) return presentationActive;

  // Scripture-to-scripture changes behave like advancing between slides in
  // the same presentation: update in place without an extra confirmation.
  if (isQueueItemBible(liveItem) && isQueueItemBible(targetItem)) {
    return false;
  }

  return true;
}

async function switchQueueItemLiveWithConfirmation(index, startTime = 0) {
  if (index < 0 || index >= mediaQueue.length) return;
  const item = mediaQueue[index];
  if (queueIndexIsCurrentLivePresentation(index) || queueIndexMatchesCurrentLiveOutput(index)) {
    await restorePreviewToLiveOutput(index);
    return;
  }

  // If something is already presenting (either the dedicated media window or
  // an audio-only file in the app window), confirm with the operator before
  // interrupting it. The same modal is reused that the media-window driven
  // queue switch uses, so the interaction is consistent across paths.
  const presentationActive =
    isQueuePresentationActive() ||
    isActiveMediaWindow() ||
    isLocalAppWindowPresentationActive() ||
    Boolean(isPlaying);
  if (!presentationActive && !isQueueItemAudio(item)) {
    await onQueueItemActivate(index);
    return;
  }
  if (shouldConfirmLiveSwitch(item)) {
    const liveItem = currentLiveQueueItemForSwitchPrompt();
    const liveLabel = liveItem
      ? liveItem.name
      : activeLiveStream || isLiveStream(mediaFile)
        ? "the current live stream"
        : "the current presentation";
    const cueLabel = item?.name || "the selected item";
    const message = `Switch the live presentation from "${liveLabel}" to "${cueLabel}"?`;
    // Temporary ship-safe fallback: the custom modal has intermittent mouse
    // hit-testing issues in production, so use the platform-native confirm
    // dialog until that path is fully debugged and restored.
    const accepted = window.confirm(message);
    if (!accepted) return;
  }

  const itemStart =
    queueItemSupportsCueStartTime(item) && Number.isFinite(startTime) && startTime > 0
      ? startTime
      : queueItemCueStartTime(mediaQueue[index]);
  await takeQueueItemLive(index, itemStart);
}

async function onQueueItemActivate(index) {
  if (index < 0 || index >= mediaQueue.length) return;

  // Audio-only items play locally without a media window, but they're still
  // an active presentation: prompt before swapping them out.
  const isLocalPresentation = isLocalAppWindowPresentationActive();

  if (!isActiveMediaWindow() && !isLocalPresentation) {
    const activateIndex = index;
    if (previewCueIndex >= 0) {
      clearPreviewCue();
    }
    currentQueueIndex = activateIndex;
    renderQueue();
    const token = nextPreviewLoadToken();
    const previewStartTime = queueItemCueStartTime(mediaQueue[activateIndex]);
    await loadQueueItemIntoControlWindow(mediaQueue[activateIndex], {
      previewLoadToken: token,
      startTime: previewStartTime,
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
  void closeBibleLowerThirdOutput();
  activeMediaWindowContentType = null;
  bibleShowNowModeActive = false;
  mediaPlaybackEndedPending = false;
  pendingQueueSwitchIndex = null;
  pendingQueueSwitchStartTime = 0;
  manualBoundaryPauseIndex = -1;
  isQueuePlaying = false;
  isPlaying = false;
  updateDynUI();
  isActiveMediaWindowCache = false;
  renderQueue();

  if (await restorePreviewCueAfterPresentationStopped()) {
    updatePlayButtonOnMediaWindow();
    masterPauseState = false;
    saveMediaFile();
    removeFilenameFromTitlebar();
    syncPreviewMediaAfterPresentationStateChange();
    return;
  }

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
  if (!pptxRegex.test(mediaFile || "")) hidePptxPreviewIfNeeded();
  handleMediaPlayback(isImgFile);

  let imgEle = document.querySelector("img#preview");
  handleImageDisplay(isImgFile, imgEle);

  resetVideoState();

  updatePlayButtonOnMediaWindow();
  masterPauseState = false;
  saveMediaFile();
  removeFilenameFromTitlebar();
  setMediaCountdownText("");
  syncPreviewMediaAfterPresentationStateChange();
}

async function pauseQueuePresentationAtBoundary(index) {
  stopLiveAudioPresentation();
  mediaPlaybackEndedPending = false;
  pendingQueueSwitchIndex = null;
  pendingQueueSwitchStartTime = 0;
  manualBoundaryPauseIndex =
    index >= 0 && index < mediaQueue.length && mediaQueue[index]?.autoAdvance === false
      ? index
      : -1;
  isQueuePlaying = false;
  isPlaying = false;
  isActiveMediaWindowCache = false;
  userStopPresentationPending = false;
  audioOnlyFile = false;
  playingMediaAudioOnly = false;
  masterPauseState = false;
  setMediaCountdownText("");
  removeFilenameFromTitlebar();

  if (index >= 0 && index < mediaQueue.length) {
    currentQueueIndex = index;
    if (previewCueIndex === index) {
      previewCueIndex = -1;
      pendingCueVolume = null;
      cueVolumeDirty = false;
      stopPreviewAudioCue();
      clearVideoPreviewCueOverlay();
      syncGtkSliderToCueState();
      syncMediaLoopState({ notify: false });
    }
    const item = mediaQueue[index];
    await loadQueueItemIntoControlWindow(item, {
      preservePreviewSeek: false,
      startTime: queueItemCueStartTime(item),
    });
  } else {
    currentQueueIndex = -1;
  }

  renderQueue();
  updateDynUI();
  updatePlayButtonOnMediaWindow();
  saveMediaFile();
  syncPreviewMediaAfterPresentationStateChange();
}

function updateQueueFileLabel(name) {
  const fileNameSpan = document.querySelector(
    ".file-input-label:not(.bible-background-picker) span",
  );
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
  if (!filePath || isNonVideoPresentationItem(filePath) || isLiveStream(filePath)) return false;
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
  let localVideo = video;
  const preservePreviewSeek = !opts || opts.preservePreviewSeek !== false;
  const cueOnly = opts?.cueOnly === true;
  const loadToken = opts?.previewLoadToken;
  const itemIsBible = isQueueItemBible(item);
  const isImgFile = isImg(item.path);
  const itemIsPptx = isQueueItemPptx(item);

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
  syncMediaLoopState({ notify: false });
  if (itemIsBible) {
    hidePptxPreviewIfNeeded();
    restoreNonPptxPreviewSurface({ isImage: false });
    if (localVideo) {
      try {
        localVideo.pause();
        localVideo.removeAttribute("src");
        localVideo.load();
      } catch {}
    }
    audioOnlyFile = false;
    playingMediaAudioOnly = false;
    const bibleEntry = resolvedBibleEntryForItem(item);
    item.bible = { ...bibleEntry };
    loadBibleEntryIntoEditor(bibleEntry);
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
    return;
  }
  hideBiblePreview();
  if (itemIsPptx) {
    await loadPptxPreview(item.path, {
      startSlide: Number.isFinite(opts?.pptxStartSlide) ? opts.pptxStartSlide : undefined,
    });
    audioOnlyFile = false;
    playingMediaAudioOnly = false;
    return;
  }

  restoreNonPptxPreviewSurface({ isImage: isImgFile });
  localVideo = video;
  handleMediaPlayback(isImgFile);
  handleImageDisplay(isImgFile, document.querySelector("img#preview"));

  if (itemIsAudio && !cueOnly) {
    audioOnlyFile = true;
    playingMediaAudioOnly = false;
    document
      .getElementById("customControls")
      ?.style.setProperty("visibility", "");
  }

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
    if (
      currentQueueIndex >= 0 &&
      currentQueueIndex < mediaQueue.length &&
      mediaQueue[currentQueueIndex] === item &&
      Number.isFinite(localVideo.duration) &&
      localVideo.duration > 0
    ) {
      mediaQueue[currentQueueIndex].duration = localVideo.duration;
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
  manualBoundaryPauseIndex = -1;
  mediaPlaybackEndedPending = false;
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

  if (isQueueItemBible(item)) {
    const entry = resolvedBibleEntryForItem(item);
    const lowerThirdStarted = hasLowerThirdOutputSelected()
      ? await ensureBibleLowerThirdOutput(entry)
      : await closeBibleLowerThirdOutput();
    const audienceStarted = hasAudienceOutputSelected()
      ? await createMediaWindow({ textItem: item })
      : false;
    if (audienceStarted) {
      window.setTimeout(() => sendBibleTextToOutput(entry), 150);
    }
    if (!audienceStarted && !lowerThirdStarted) {
      showGnomeToast("Choose an output display");
      isPlaying = false;
      isQueuePlaying = false;
      updateDynUI();
      renderQueue();
    }
    return;
  }

  if (!audioOnlyFile && !hasAudienceOutputSelected()) {
    showGnomeToast("Choose an audience output display");
    isPlaying = false;
    isQueuePlaying = false;
    updateDynUI();
    renderQueue();
    return;
  }

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
    await playAudioOnlyLocally(opts?.startTime);
    return;
  }

  await createMediaWindow();
}

async function advanceQueueAfterMediaWindowClosed() {
  if (isAdvancingQueue) return;
  if (loopEnabledForLiveMedia()) {
    mediaPlaybackEndedPending = false;
    syncMediaLoopState();
    return;
  }
  isAdvancingQueue = true;
  try {
    isPlaying = false;
    updateDynUI();
    isActiveMediaWindowCache = false;

    const cue = currentPreviewCue();
    if (cue) {
      if (!shouldAutoTransitionToIndex(cue.index)) {
        await pauseQueuePresentationAtBoundary(cue.index);
        return;
      }
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

    const nextIndex = currentQueueIndex + 1;
    if (nextIndex < mediaQueue.length && shouldAutoTransitionToIndex(nextIndex)) {
      currentQueueIndex = nextIndex;
      const item = mediaQueue[currentQueueIndex];
      renderQueue();
      await new Promise((r) => setTimeout(r, 100));
      isPlaying = true;
      updateDynUI();
      await playCurrentQueueItem({
        preservePreviewSeek: false,
        startTime: queueItemCueStartTime(item),
      });
      return;
    }
    if (nextIndex < mediaQueue.length) {
      await pauseQueuePresentationAtBoundary(nextIndex);
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
    if (!pptxRegex.test(mediaFile || "")) hidePptxPreviewIfNeeded();
    handleMediaPlayback(isImgFile);
    handleImageDisplay(isImgFile, document.querySelector("img#preview"));
    resetVideoState();
    updatePlayButtonOnMediaWindow();
    masterPauseState = false;
    removeFilenameFromTitlebar();
    setMediaCountdownText("");
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
  const nextItem = index >= 0 && index < mediaQueue.length ? mediaQueue[index] : null;
  const allowBibleInPlaceSwitch =
    Boolean(nextItem) &&
    isQueueItemBible(nextItem) &&
    activeMediaWindowContentType === "bible" &&
    isActiveMediaWindow();
  if (!isQueuePlaying && !allowBibleInPlaceSwitch) return false;
  if (!isActiveMediaWindow()) return false;
  if (index < 0 || index >= mediaQueue.length) return false;
  if (activeLiveStream || isLiveStream(mediaFile)) {
    return false;
  }

  queueSlipstreamTransitionInProgress = true;
  try {
    const nextItem = mediaQueue[index];
    const nextType = nextItem.type || classifyQueueMediaType(nextItem.path);
    const isImgFile = isImg(nextItem.path);
    const isPptxFile = isQueueItemPptx(nextItem);
    const isBibleItem = isQueueItemBible(nextItem);

    // Load the target into the preview before deciding. Extension checks catch
    // obvious audio files, but metadata is authoritative for "audio-only"
    // containers that look like regular media files until loaded.
    const requestedStart =
      queueItemSupportsCueStartTime(nextItem) &&
      typeof opts.startTime === "number" &&
      Number.isFinite(opts.startTime)
        ? opts.startTime
        : queueItemCueStartTime(nextItem);
    await loadQueueItemIntoControlWindow(nextItem, {
      preservePreviewSeek: false,
      startTime: requestedStart,
    });
    resolveQueuePresentationVideo();

    // Audio must play in the local preview — destroy the media window as usual.
    if (!isImgFile && !isPptxFile && !isBibleItem && (nextType === "audio" || audioOnlyFile)) {
      pendingQueueSwitchIndex = index;
      pendingQueueSwitchStartTime = requestedStart;
      mediaPlaybackEndedPending = false;
      await closeActiveMediaWindowNow();
      return true;
    }

    consumePendingCueVolume(index);
    const slipstreamData = isBibleItem
      ? {
          isText: true,
          mediaFile: nextItem.path,
          textPayload: buildBibleTextMessage(resolvedBibleEntryForItem(nextItem), {
            look: SCRIPTURE_LOOK_FULLSCREEN,
          }),
        }
      : {
          mediaFile: nextItem.path,
          isImg: isImgFile,
          isPptx: isPptxFile,
          pptxStartSlide: isPptxFile ? pptxStartSlideForItem(nextItem) : 0,
          loopFile: loopEnabledForQueueItem(nextItem),
          startVolume: video ? video.volume : 1,
          startTime: requestedStart,
        };

    const slipstreamSuccess = await invoke("slipstream-media-window", slipstreamData);
    resolveQueuePresentationVideo();
    if (!slipstreamSuccess) return false;

    // Window stays alive — advance queue state without the normal close/reopen cycle.
    mediaPlaybackEndedPending = false;
    currentQueueIndex = index;
    isQueuePlaying = true;
    bibleShowNowModeActive = false;
    activeMediaWindowContentType = classifyPresentationType(nextItem);
    isActiveMediaWindowCache = true;
    isPlaying = true;
    lastUpdateTime = 0;
    localTimeStampUpdateIsRunning = false;
    setMediaCountdownText("");
    // endLocalMedia (which runs from the preview's "ended" event right before
    // this) marks fileEnded so the next pause is treated as a natural stop.
    // Slipstream is not a stop — clear the flag before the new src is loaded.
    fileEnded = false;
    audioOnlyFile = false;
    playingMediaAudioOnly = false;
    updateDynUI();
    syncPreviewAudioTrackState();
    if (isBibleItem) {
      const entry = resolvedBibleEntryForItem(nextItem);
      sendBibleTextToOutput(entry);
      if (hasLowerThirdOutputSelected()) {
        await ensureBibleLowerThirdOutput(entry);
      } else {
        await closeBibleLowerThirdOutput();
      }
    }
    renderQueue();
    if (opts.clearCue !== false) {
      clearCueAfterTake(index);
    }

    // Mirror the media window: start the local preview so the operator sees
    // what's projecting. In the non-slipstream path createMediaWindow's
    // "media-window autoplay" call does this; we must do it ourselves here.
    if (video && !isImgFile && !isPptxFile) {
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
    if (!shouldAutoTransitionToIndex(cue.index)) {
      return false;
    }
    return slipstreamQueueItemAtIndex(cue.index, {
      startTime: cue.startTime,
      clearCue: true,
    });
  }
  if (!shouldAutoTransitionToIndex(currentQueueIndex + 1)) {
    return false;
  }
  const nextIndex = currentQueueIndex + 1;
  const nextItem = mediaQueue[nextIndex];
  return slipstreamQueueItemAtIndex(nextIndex, {
    startTime: queueItemCueStartTime(nextItem),
  });
}

let pidController;

const NUM_BUFFER = new Int32Array(4);
const REM_BUFFER = new Int32Array(1);
let usePad0, usePad1, usePad2, mask0, mask1, mask2, idx0, idx1, idx2;

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

function syncPreviewAudioCueAudibility() {
  if (!previewAudio) return;
  const cue = currentPreviewCue();
  const shouldBeAudible = Boolean(
    cue &&
      isQueueItemAudio(cue.item) &&
      previewAudioCueIndex === cue.index &&
      !isQueuePresentationActive() &&
      !isActiveMediaWindow(),
  );
  previewAudio.muted = !shouldBeAudible;
  previewAudio.volume = shouldBeAudible ? (pendingCueVolume ?? 1) : 0;
}

function syncPreviewMediaAfterPresentationStateChange() {
  syncPreviewAudioTrackState();
  syncPreviewAudioCueAudibility();
  if (isPptxPreviewVisible()) {
    document
      .getElementById("customControls")
      ?.style.setProperty("visibility", "hidden");
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
  // Manual Stop ends the live output, but the stopped queue item should remain
  // selected so pressing Present again starts that item instead of item 1.
  if (currentQueueIndex < 0 || currentQueueIndex >= mediaQueue.length) {
    currentQueueIndex = -1;
  }
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

    updateLoopControlState();
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
          // Audio-only files do not have a separate preview mode: the silent
          // previewAudio element is just a scrub/cue surface. Pressing Play
          // here means "present this audio from the queue".
          if (mediaEl === previewAudio) {
            const cue = currentPreviewCue();
            if (cue) {
              void switchQueueItemLiveWithConfirmation(cue.index, cue.startTime);
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
            isLikelyAudioItem(currentPreviewSourcePath()) ||
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
    (event) => {
      updateControlsForTime(event.target);
      if (!event.target.paused) {
        syncTrackedPreviewStartTime(event.target);
      }
    },
    sig,
  );
  previewAudio.addEventListener(
    "timeupdate",
    (event) => {
      updateControlsForTime(event.target);
      if (!event.target.paused) {
        syncTrackedPreviewStartTime(event.target);
      }
    },
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
      (event) => {
        updateControlsForTime(event.target);
        if (!event.target.paused) {
          syncTrackedPreviewStartTime(event.target);
        }
      },
      sig,
    );
  }

  // --- LOOP / REPEAT ---
  repeatButton.addEventListener(
    "click",
    () => {
      toggleMediaLoopEnabled();
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
      if (previewAudio.loop) return;
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
        if (previewCue.loop) return;
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
        const bibleWorkspace = document.getElementById("bibleWorkspace");
        if (bibleWorkspace && !bibleWorkspace.hidden && bibleWorkspace.contains(event.target)) {
          event.stopPropagation();
          return;
        }
        const mediaEl = currentControlMedia();
        if (!mediaEl || mediaEl.src === "") return;
        const isControl = event.target.closest("#customControls");

        if (!isControl) {
          if (mediaEl.paused) {
            if (
              mediaEl === video &&
              !isLocalAppWindowPresentationActive() &&
              (audioOnlyFile ||
                isLikelyAudioItem(currentPreviewSourcePath()) ||
                mediaElementLoadedAudioOnly(video, mediaFile || video.src))
            ) {
              void playMedia();
              return;
            }
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
  syncMediaLoopState({ notify: false });
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
    const cueVol = getPreviewCueDisplayVolume();
    const displayVol =
      cueVol !== null
        ? cueVol
        : video.muted
          ? 0
          : (video.volume ?? 1);
    slider.value = Math.round(displayVol * 100);
    gtkUpdateVolIcon?.(slider.value);
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

  gtkUpdateVolIcon = updateIcon;

  slider.addEventListener("input", () => {
    const v = slider.value / 100;
    if (isPreviewCueVolumeActive()) {
      setActiveCueVolume(v);
      const savedMuted = video.muted;
      video.muted = false;
      updateIcon(slider.value);
      video.muted = savedMuted;
    } else {
      video.volume = v;
      if (v > 0) video.muted = false;
      if (currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length) {
        mediaQueue[currentQueueIndex].cueVolume = v;
      }
      updateIcon(slider.value);
    }
  });

  video.addEventListener("volumechange", () => {
    if (isPreviewCueVolumeActive()) return;
    if (video.muted) {
      slider.value = 0;
    } else {
      slider.value = Math.round(video.volume * 100);
    }
    updateIcon(slider.value);
  });

  let lastVolume = slider.value / 100;

  button.addEventListener("click", () => {
    if (isPreviewCueVolumeActive()) {
      const currentCueVol = getPreviewCueDisplayVolume() ?? video.volume ?? 1;
      if (currentCueVol === 0) {
        setActiveCueVolume(lastVolume > 0 ? lastVolume : 1);
      } else {
        lastVolume = currentCueVol;
        setActiveCueVolume(0);
      }
      slider.value = Math.round(pendingCueVolume * 100);
      const savedMuted = video.muted;
      video.muted = pendingCueVolume === 0;
      updateIcon(slider.value);
      video.muted = savedMuted;
    } else {
      if (video.muted) {
        video.volume = lastVolume > 0 ? lastVolume : 1;
        video.muted = false;
      } else {
        lastVolume = video.volume;
        video.muted = true;
      }
    }
  });

  // Initial icon setup on load
  updateIcon(slider.value);
}

/**
 * Re-sync the GTK volume slider to reflect whichever source owns the
 * controls: the cued item (pendingCueVolume) or the live output (video.volume).
 */
function syncGtkSliderToCueState() {
  const slider = document.getElementById("gtkVolSlider");
  if (!slider) return;
  const cueVol = getPreviewCueDisplayVolume();
  const displayVol =
    cueVol !== null
      ? cueVol
      : (video?.muted ? 0 : (video?.volume ?? 1));
  slider.value = Math.round(displayVol * 100);
  gtkUpdateVolIcon?.(slider.value);
}

/**
 * If the operator changed volume while a cue was loaded, that value was held
 * in pendingCueVolume (and on the queue entry as cueVolume) to avoid
 * disturbing the live output. Consume it here — right before playback begins.
 */
function consumePendingCueVolume(playbackIndex) {
  const index =
    typeof playbackIndex === "number" ? playbackIndex : currentQueueIndex;
  const vol = resolveQueueItemPlaybackVolume(index) ?? 1;
  pendingCueVolume = null;
  cueVolumeDirty = false;

  if (video) video.volume = vol;
  syncGtkSliderToCueState();
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
  const cueEl = previewCueVideo || document.getElementById("previewCue");
  return Boolean(
    cue &&
      isQueueItemImage(cue.item) &&
      cueEl &&
      cueEl.hidden === false &&
      cueEl.hasAttribute("poster"),
  );
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
  setMediaCountdownText(String.fromCharCode(
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
  ));
}

/**
 * Restore the countdown overlay's visibility to whatever the live media
 * requires. Called when a cue clears (the cue might have hidden the
 * overlay for an image preview, or pinned it to the cue's time), so the
 * operator sees the live time again for audio/video and nothing for an
 * image or empty live source.
 */
function restoreCountdownForLiveMedia() {
  const overlay = document.getElementById("customControls");
  const liveItem = currentLiveQueueItem();
  const liveIsBible = isActiveMediaWindow() && activeMediaWindowContentType === "bible";
  const liveIsPptx = isActiveMediaWindow() && activeMediaWindowContentType === "pptx";
  const hasLiveSource = Boolean(mediaFile);
  const liveIsImage = (hasLiveSource && isImg(mediaFile)) || isQueueItemImage(liveItem);
  const showTransportControls =
    !liveIsBible &&
    !liveIsPptx &&
    !liveIsImage &&
    (hasLiveSource || Boolean(liveAudio?.src));

  if (overlay) {
    overlay.style.display = "";
    overlay.style.visibility = showTransportControls ? "" : "hidden";
  }

  const showCountdown = hasLiveSource && !liveIsImage;
  setMediaCountdownOverlayVisible(showCountdown);
  if (!showCountdown) {
    setMediaCountdownText("");
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

  setMediaCountdownText(String.fromCharCode(
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
  ));

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
  if (activeMediaWindowContentType === "bible" || isBiblePath(mediaFile)) {
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
  on("media-window-closed", () => {
    biblePreviewActiveMediaWindowSize = null;
    syncBiblePreviewOutputScale();
  });
  on("lower-third-window-closed", () => {
    bibleLowerThirdOutputActive = false;
  });
  on("media-playback-ended", async (event, endedMediaFile) => {
    if (userStopPresentationPending) {
      mediaPlaybackEndedPending = false;
      return;
    }
    if (
      endedMediaFile &&
      currentQueueIndex >= 0 &&
      currentQueueIndex < mediaQueue.length &&
      normalizeMediaPathForCompare(endedMediaFile) !==
        normalizeMediaPathForCompare(mediaQueue[currentQueueIndex].path)
    ) {
      return;
    }
    if (loopEnabledForLiveMedia(endedMediaFile || mediaFile)) {
      mediaPlaybackEndedPending = false;
      syncMediaLoopState();
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
  on("open-project-path", async (_event, filePath) => {
    try {
      await openProjectByPath(filePath);
    } catch (err) {
      console.error("Failed to open project from launcher:", err);
      showGnomeToast("Failed to open project");
    }
  });
}

async function handleMediaWindowClosed(event, id) {
  resolveQueuePresentationVideo();
  const localVideo = video;
  stopStreamRendererPreviewCapture();
  activeMediaWindowContentType = null;
  bibleShowNowModeActive = false;

  try {
    await invoke("dismiss-queue-switch-dialog");
  } catch (err) {
    console.error(err);
  }

  if (pendingQueueClearPostClose) {
    pendingQueueClearPostClose = false;
    userStopPresentationPending = false;
    mediaPlaybackEndedPending = false;
    isPlaying = false;
    isQueuePlaying = false;
    updateDynUI();
    isActiveMediaWindowCache = false;
    saveMediaFile();
    pauseLocalPreviewAfterQueueClear();
    return;
  }

  if (userStopPresentationPending) {
    userStopPresentationPending = false;
    mediaPlaybackEndedPending = false;
    pendingQueueSwitchIndex = null;
    pendingQueueSwitchStartTime = 0;
    await stopQueuePresentationUserClosed();
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
    } else if (isQueueItemBible(mediaQueue[idx])) {
      const entry = resolvedBibleEntryForItem(mediaQueue[idx]);
      const lowerThirdStarted = hasLowerThirdOutputSelected()
        ? await ensureBibleLowerThirdOutput(entry)
        : await closeBibleLowerThirdOutput();
      const audienceStarted = hasAudienceOutputSelected()
        ? await createMediaWindow({ textItem: mediaQueue[idx] })
        : false;
      if (audienceStarted) {
        window.setTimeout(() => sendBibleTextToOutput(entry), 150);
      }
      if (!audienceStarted && !lowerThirdStarted) {
        showGnomeToast("Choose an output display");
        isPlaying = false;
        isQueuePlaying = false;
        updateDynUI();
        renderQueue();
        return;
      }
    } else if (
      audioOnlyFile ||
      classifyQueueMediaType(mediaQueue[idx].path) === "audio"
    ) {
      await playAudioOnlyLocally(switchStartTime);
    } else {
      await createMediaWindow();
    }
    clearCueAfterTake(idx);
    return;
  }

  if (isQueuePlaying) {
    if (mediaPlaybackEndedPending) {
      mediaPlaybackEndedPending = false;
      if (shouldAdvanceAfterCurrentItemEnds()) {
        await advanceQueueAfterMediaWindowClosed();
      } else {
        await pauseQueuePresentationAtBoundary(nextQueueBoundaryIndex());
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
      loopEnabledForLiveMedia() &&
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

  if (await restorePreviewCueAfterPresentationStopped()) {
    updatePlayButtonOnMediaWindow();
    masterPauseState = false;
    saveMediaFile();
    removeFilenameFromTitlebar();
    syncPreviewMediaAfterPresentationStateChange();
    return;
  }

  // ADDED: Restore queued file if we're in media player mode
  if (
    currentMode === MEDIAPLAYER &&
    mediaPlayerInputState.filePaths.length > 0
  ) {
    mediaFile = mediaPlayerInputState.filePaths[0];
  }

  let isImgFile = isImg(mediaFile);
  if (!pptxRegex.test(mediaFile || "")) hidePptxPreviewIfNeeded();
  handleMediaPlayback(isImgFile);

  let imgEle = document.querySelector("img#preview");
  handleImageDisplay(isImgFile, imgEle);

  resetVideoState();

  updatePlayButtonOnMediaWindow();
  masterPauseState = false;
  saveMediaFile();
  removeFilenameFromTitlebar();
  setMediaCountdownText("");
  syncPreviewMediaAfterPresentationStateChange();
}
function handleMediaPlayback(isImgFile) {
  if (!video) return;
  if (isNonVideoPresentationItem(mediaFile)) return;
  if (!isImgFile) {
    video.src = mediaFile;
  }
}

function setMediaCountdownOverlayVisible(isVisible) {
  const countdownEl = document.getElementById("mediaCntDn");
  if (!countdownEl) return;
  const wasAllowed = countdownEl.dataset.countdownAllowed === "true";
  countdownEl.dataset.countdownAllowed = isVisible ? "true" : "false";
  if (!isVisible || !wasAllowed) {
    textNode.data = "";
  }
  syncMediaCountdownOverlayState();
}

function setMediaCountdownText(value) {
  textNode.data = typeof value === "string" ? value : "";
  syncMediaCountdownOverlayState();
}

function syncMediaCountdownOverlayState() {
  const countdownEl = document.getElementById("mediaCntDn");
  if (!countdownEl) return;
  const hasText = textNode.data.trim().length > 0;
  const isAllowed = countdownEl.dataset.countdownAllowed === "true";
  const isActive = isAllowed && hasText;
  countdownEl.hidden = !isActive;
  countdownEl.classList.toggle("is-active", isActive);
}

function handleImageDisplay(isImgFile, imgEle) {
  const previewVideo = document.querySelector("video#preview");
  const previewImg = imgEle?.matches?.("img#preview")
    ? imgEle
    : document.querySelector("img#preview");
  setMediaCountdownOverlayVisible(!isImgFile);
  if (previewImg && !isImgFile) {
    previewImg.remove();
    previewImg.src = "";
    if (previewVideo) previewVideo.style.display = "";
  } else if (isImgFile && video) {
    resetPreviewWarningState();
    let liveImg = previewImg;
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch (err) {
      console.error("Failed to clear video preview for image display:", err);
    }
    if (!liveImg) {
      liveImg = document.createElement("img");
      liveImg.setAttribute("id", "preview");
      previewVideo?.parentNode?.appendChild(liveImg);
    }
    if (previewVideo) {
      previewVideo.style.display = "none";
    }
    document
      .getElementById("customControls")
      ?.style.setProperty("visibility", "hidden");
    liveImg.src = mediaFile;
    liveImg.style.display = "";
    img = liveImg;
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
  return waitForMediaMetadata(mediaEl, {
    isLiveStream,
    isImg,
    onResolved: (event, resolve, targetMediaEl) => {
      handleCanPlayThrough(event || {}, resolve, targetMediaEl);
    },
    onRejected: () => {
      playingMediaAudioOnly = false;
      audioOnlyFile = false;
    },
  });
}

async function playMedia(e) {
  if (video) {
    itc = performance.now() * 0.001;
    startTime = video.currentTime;
  }
  targetTime = startTime;
  if (
    currentMode === MEDIAPLAYER &&
    !audioOnlyFile &&
    isLikelyAudioItem(currentPreviewSourcePath())
  ) {
    audioOnlyFile = true;
    document.getElementById("customControls")?.style.setProperty("visibility", "");
  }
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
    const startIdx = queueStartIndexForPresent();
    if (!isLiveStream(mediaQueue[startIdx].path)) {
      isQueuePlaying = true;
      currentQueueIndex = startIdx;
      await playCurrentQueueItem({ previewSeekTime: startTime });
      if (previewCueIndex === startIdx) clearCueAfterTake(startIdx);
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
      isQueuePlaying = false;
      mediaPlaybackEndedPending = false;
      pendingQueueSwitchIndex = null;
      pendingQueueSwitchStartTime = 0;
      userStopPresentationPending = isActiveMediaWindow();
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
    if (!audioOnlyFile && !hasAudienceOutputSelected()) {
      showGnomeToast("Choose an audience output display");
      return;
    }
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
    // The header button reads "Stop" while a presentation is live; keep that
    // action terminal even if another queue item is cued.
    mediaPlaybackEndedPending = false;
    pendingQueueSwitchIndex = null;
    pendingQueueSwitchStartTime = 0;
    if (isQueuePlaying) {
      isQueuePlaying = false;
      // Keep the stopped queue item selected. `queueStartIndexForPresent()`
      // uses this pointer for the next Present click, matching the boundary
      // pause behavior and avoiding an unexpected restart from the top.
      if (currentQueueIndex < 0 || currentQueueIndex >= mediaQueue.length) {
        currentQueueIndex = -1;
      }
      renderQueue();
    }
    startTime = 0;
    isPlaying = false;
    if (isActiveMediaWindow()) {
      userStopPresentationPending = true;
      send("close-media-window", 0);
    }
    void closeBibleLowerThirdOutput();
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
  setMediaCountdownText("");
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

  // Presentation status and queue badges (Live / Cued) mirror `isPlaying`
  // and related flags. Keep them in sync at one choke point so callers
  // don't have to remember to refresh the sidebar after flipping playback
  // state — e.g. `playCurrentQueueItem` calls `renderQueue` while
  // `isPlaying` is still false, then sets it true, then `updateDynUI`.
  // Without this, a one-file queue stayed at "Nothing live" forever and
  // the Live / Cued pills never appeared because no later path called
  // `renderQueue` again.
  syncMediaLoopState({ notify: false });
  renderQueue();
}

async function populateDisplaySelect(options = {}) {
  const force = options.force === true;
  syncLowerThirdFeatureAvailability();
  const audienceDisplaySelects = document.querySelectorAll("#dspSelct, #dspSelctStreams");
  const lowerThirdDisplaySelect = isBibleLowerThirdFeatureEnabled()
    ? document.getElementById("lowerThirdDspSelct")
    : null;
  const displaySelects = [
    ...Array.from(audienceDisplaySelects),
    ...(lowerThirdDisplaySelect ? [lowerThirdDisplaySelect] : []),
  ];
  if (!displaySelects.length) return;

  const alreadyReady =
    !force &&
    Array.from(displaySelects).every((sel) => sel.options && sel.options.length > 1);
  if (alreadyReady) {
    return;
  }

  const syncPeerSelects = (source) => {
    const v = source.value;
    audienceDisplaySelects.forEach((sel) => {
      if (sel !== source) sel.value = v;
    });
  };

  audienceDisplaySelects.forEach((sel) => {
    sel.onchange = (event) => {
      const value = event.target.value === "" ? -1 : Number.parseInt(event.target.value, 10);
      send("set-display-index", value);
      syncPeerSelects(event.target);
      syncBiblePreviewOutputScale();
      queueBiblePreviewMediaWindowSizeRefresh(50);
    };
  });
  if (lowerThirdDisplaySelect) {
    lowerThirdDisplaySelect.onchange = (event) => {
      const value = event.target.value === "" ? -1 : Number.parseInt(event.target.value, 10);
      send("set-lower-third-display-index", value);
      if (value < 0) {
        void closeBibleLowerThirdOutput();
      } else {
        syncShowNowBiblePresentation();
        syncActiveScheduledBiblePresentation();
      }
      syncBiblePreviewOutputScale();
    };
  }

  try {
    const { displays, defaultDisplayIndex, defaultLowerThirdDisplayIndex } =
      await invoke("get-all-displays");

    displaySelects.forEach((displaySelect) => {
      const firstOptionText =
        displaySelect.id === "lowerThirdDspSelct"
          ? "No Lower Third Output"
          : displaySelect.id === "dspSelct"
            ? "No Audience Output"
            : "No Output";
      displaySelect.options.length = 1;
      displaySelect.options[0].value = "";
      displaySelect.options[0].textContent = firstOptionText;

      const fragment = document.createDocumentFragment();
      for (const { value, label, bounds } of displays) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        if (Number.isFinite(bounds?.width) && bounds.width > 0) {
          option.dataset.displayWidth = String(bounds.width);
        }
        if (Number.isFinite(bounds?.height) && bounds.height > 0) {
          option.dataset.displayHeight = String(bounds.height);
        }
        fragment.appendChild(option);
      }

      displaySelect.appendChild(fragment);
      displaySelect.value =
        displaySelect.id === "lowerThirdDspSelct"
          ? defaultLowerThirdDisplayIndex
          : defaultDisplayIndex;
    });
    syncBiblePreviewOutputScale();
    queueBiblePreviewMediaWindowSizeRefresh(50);
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
  syncStreamRendererPreviewCapture();

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
    dyne.innerHTML = generateDyneTabShellHTML();
  }
}

function ensureMediaPanelBuilt() {
  ensureDyneTabShell();
  const panel = document.getElementById(TAB_PANEL_MEDIA_ID);
  if (!panel || panel.dataset.mediaShellBuilt === "1") {
    return;
  }
  panel.innerHTML = generateMediaFormHTML();
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
  const previewStack = panelEl.querySelector("#previewStack");
  if (previewStack) return previewStack;
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

function getStreamRendererPreviewElement() {
  return document.getElementById("streamRendererPreview");
}

function getConfidenceMonitorElement() {
  return document.getElementById("confidenceMonitorPreview");
}

function isNetworkStreamSource(source) {
  if (source === undefined || source === null || isBiblePath(source)) {
    return false;
  }
  const text = String(source).trim();
  if (!text) return false;
  if (isLiveStream(text)) return true;
  try {
    const url = new URL(text);
    return ["http:", "https:", "rtsp:", "rtmp:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function streamsTabNetworkStreamLoaded() {
  return Boolean(
    currentMode === STREAMPLAYER &&
      isActiveMediaWindow() &&
      (activeLiveStream || isNetworkStreamSource(mediaFile)),
  );
}

function setStreamsPreviewNetworkState(active) {
  const host = document.querySelector(".stream-preview-host");
  if (!host) return;
  host.dataset.networkStreamActive = active ? "true" : "false";
  const emptyState = host.querySelector("#streamPreviewEmptyState");
  if (emptyState) emptyState.hidden = active;
  if (!active) {
    const previewEl = getStreamRendererPreviewElement();
    if (previewEl) {
      previewEl.pause();
      previewEl.srcObject = null;
      previewEl.hidden = true;
    }
  }
}

const RENDERER_CAPTURE_QUALITY_STREAMS = "streams";
const RENDERER_CAPTURE_QUALITY_CONFIDENCE = "confidence";

function activeRendererCaptureQualityMode() {
  return currentMode === MEDIAPLAYER
    ? RENDERER_CAPTURE_QUALITY_CONFIDENCE
    : RENDERER_CAPTURE_QUALITY_STREAMS;
}

function rendererCaptureVideoConstraints(mode = activeRendererCaptureQualityMode()) {
  if (mode === RENDERER_CAPTURE_QUALITY_CONFIDENCE) {
    return {
      width: { ideal: 426, max: 640 },
      height: { ideal: 240, max: 360 },
      frameRate: { ideal: 30, max: 30 },
    };
  }

  return {
    frameRate: { ideal: 30, max: 30 },
  };
}

function syncRendererCaptureQuality(stream, mode = activeRendererCaptureQualityMode()) {
  if (!stream) {
    streamRendererPreviewQualityMode = null;
    return;
  }
  if (streamRendererPreviewQualityMode === mode) return;
  streamRendererPreviewQualityMode = mode;
  const [track] = stream.getVideoTracks();
  if (!track?.applyConstraints) return;
  track.applyConstraints(rendererCaptureVideoConstraints(mode)).catch((error) => {
    console.error("Failed to update media renderer preview quality:", error);
  });
}

function mediaRendererCaptureAllowedForCurrentMode() {
  if (currentMode === MEDIAPLAYER) return true;
  if (currentMode === STREAMPLAYER) return streamsTabNetworkStreamLoaded();
  return false;
}

function activeMediaRendererCaptureElement() {
  if (currentMode === STREAMPLAYER) return getStreamRendererPreviewElement();
  if (currentMode === MEDIAPLAYER) return getConfidenceMonitorElement();
  return null;
}

function allMediaRendererCaptureElements() {
  return [
    getStreamRendererPreviewElement(),
    getConfidenceMonitorElement(),
  ].filter(Boolean);
}

function setStreamRendererPreviewActive(active) {
  const host = document.querySelector(".stream-preview-host");
  if (!host) return;
  if (active) {
    host.dataset.rendererPreviewActive = "true";
  } else {
    delete host.dataset.rendererPreviewActive;
  }
  setStreamsPreviewNetworkState(Boolean(active && streamsTabNetworkStreamLoaded()));
}

function setConfidenceMonitorActive(active) {
  const monitor = document.getElementById("confidenceMonitor");
  if (!monitor) return;
  monitor.hidden = currentMode !== MEDIAPLAYER;
  if (active) {
    monitor.dataset.rendererPreviewActive = "true";
  } else {
    delete monitor.dataset.rendererPreviewActive;
  }
}

function disableCapturedAudioTracks(stream) {
  stream.getAudioTracks().forEach((track) => {
    track.enabled = false;
    track.stop();
  });
}

function prepareRendererCaptureElement(el, stream) {
  if (!el) return;
  disableCapturedAudioTracks(stream);
  if (el.srcObject !== stream) {
    el.srcObject = stream;
  }
  el.muted = true;
  el.defaultMuted = true;
  el.volume = 0;
  el.controls = false;
  el.disablePictureInPicture = true;
  el.hidden = false;
  el.play().catch((error) => {
    console.error("Failed to start media renderer preview:", error);
  });
}

function hideRendererCaptureElement(el) {
  if (!el) return;
  el.pause();
  el.srcObject = null;
  el.hidden = true;
}

function syncRendererCaptureSinks(stream = streamRendererPreviewStream) {
  const activeEl = stream && isActiveMediaWindow()
    ? activeMediaRendererCaptureElement()
    : null;
  if (activeEl) {
    syncRendererCaptureQuality(stream);
  }
  allMediaRendererCaptureElements().forEach((el) => {
    if (el === activeEl) {
      prepareRendererCaptureElement(el, stream);
    } else {
      hideRendererCaptureElement(el);
    }
  });
  setStreamRendererPreviewActive(activeEl === getStreamRendererPreviewElement());
  setConfidenceMonitorActive(activeEl === getConfidenceMonitorElement());
}

function stopStreamRendererPreviewCapture() {
  const stream = streamRendererPreviewStream;
  streamRendererPreviewStream = null;
  streamRendererPreviewStartPromise = null;
  streamRendererPreviewQualityMode = null;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
  syncRendererCaptureSinks(null);
}

async function startStreamRendererPreviewCapture() {
  if (!mediaRendererCaptureAllowedForCurrentMode()) {
    stopStreamRendererPreviewCapture();
    return;
  }

  const previewEl = activeMediaRendererCaptureElement();
  if (!previewEl || !navigator.mediaDevices?.getDisplayMedia) {
    syncRendererCaptureSinks(null);
    return;
  }

  const available = await invoke("media-window-capture-available").catch(() => false);
  if (!mediaRendererCaptureAllowedForCurrentMode()) {
    stopStreamRendererPreviewCapture();
    return;
  }
  if (!available) {
    stopStreamRendererPreviewCapture();
    return;
  }

  if (
    streamRendererPreviewStream &&
    streamRendererPreviewStream.getVideoTracks().some((track) => track.readyState === "live")
  ) {
    syncRendererCaptureSinks(streamRendererPreviewStream);
    return;
  }

  if (streamRendererPreviewStartPromise) {
    await streamRendererPreviewStartPromise;
    return;
  }

  streamRendererPreviewStartPromise = (async () => {
    const qualityMode = activeRendererCaptureQualityMode();
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: rendererCaptureVideoConstraints(qualityMode),
      audio: false,
    });
    if (!mediaRendererCaptureAllowedForCurrentMode() || !isActiveMediaWindow()) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    disableCapturedAudioTracks(stream);
    streamRendererPreviewStream = stream;
    syncRendererCaptureQuality(stream, qualityMode);
    stream.getVideoTracks().forEach((track) => {
      track.addEventListener("ended", stopStreamRendererPreviewCapture, {
        once: true,
      });
    });
    syncRendererCaptureSinks(stream);
  })();

  try {
    await streamRendererPreviewStartPromise;
  } catch (error) {
    console.error("Failed to capture media renderer preview:", error);
    stopStreamRendererPreviewCapture();
  } finally {
    streamRendererPreviewStartPromise = null;
  }
}

function syncStreamRendererPreviewCapture() {
  if (!mediaRendererCaptureAllowedForCurrentMode() || !isActiveMediaWindow()) {
    stopStreamRendererPreviewCapture();
    return;
  }
  syncRendererCaptureSinks(streamRendererPreviewStream);
  void startStreamRendererPreviewCapture();
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
  setMediaLoopEnabled(event.target.checked);
  event.target.checked = loopTargetEnabled(loopControlTarget());
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
  syncStreamRendererPreviewCapture();

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


  if (
    video &&
    (!setupCustomMediaControls.controller ||
      setupCustomMediaControls.controller.signal.aborted)
  ) {
    delete video.dataset.previewHandlersInstalled;
  }
  installPreviewEventHandlers();

  installMediaOpenButton();
  installPreviewEmptyStateHandlers();
  installMediaOptionsExpander();
  installBibleMediaControls();
  const clearQueueBtn = document.getElementById("clearQueueBtn");
  if (clearQueueBtn && clearQueueBtn.dataset.clearBound !== "1") {
    clearQueueBtn.dataset.clearBound = "1";
    clearQueueBtn.addEventListener("click", onClearMediaQueueClick);
  }
  installMediaQueueListDelegation();
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

  void restorePptxPreviewForMediaTab().catch((err) =>
    console.error("Failed to restore PPTX preview after returning to Media tab:", err),
  );
}

function removeFileProtocol(filePath) {
  return filePath.slice(7);
}

function saveMediaFile() {
  scheduleAutosaveProjectState();
  resetPreviewWarningState();
  setMediaCountdownText("");
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
      mediaFile = getPathForFile(f0);
      return;
    }
    if (mediaQueue.length > 0) {
      const qi =
        currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
          ? currentQueueIndex
          : 0;
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
    const fileNameSpan = document.querySelector(
      ".file-input-label:not(.bible-background-picker) span",
    );
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
      const fileNameSpan = document.querySelector(
        ".file-input-label:not(.bible-background-picker) span",
      );
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
      void openProjectDialog();
    }

    if (event.key === "s" || event.key === "S") {
      event.preventDefault();
      if (event.shiftKey) {
        void saveProjectAsDialog();
      } else {
        void saveProject();
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
  stopStreamRendererPreviewCapture();

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

  document.addEventListener("keydown", shortcutHandler, { passive: true });
  document
    .querySelector("form")
    .addEventListener("change", modeSwitchHandler, { passive: true });
}

function playLocalMedia(event) {
  if (currentMode !== MEDIAPLAYER) {
    return;
  }
  if (
    event?.target === video &&
    isBibleWorkspaceVisible() &&
    !isQueuePresentationActive() &&
    !isActiveMediaWindow() &&
    !isLocalAppWindowPresentationActive()
  ) {
    event.preventDefault?.();
    try {
      video.pause();
    } catch {}
    localTimeStampUpdateIsRunning = false;
    syncPreviewAudioTrackState();
    return;
  }

  syncPreviewAudioTrackState();
  mediaSessionPause = false;
  if (
    !audioOnlyFile &&
    (isLikelyAudioItem(currentPreviewSourcePath()) ||
      (video.readyState && mediaElementLoadedAudioOnly(video, mediaFile || video.src)))
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
      const queueIndex = currentAudioPreviewQueueIndex();
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
  syncTrackedPreviewStartTime(e.target, { force: true });
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
  syncTrackedPreviewStartTime(e.target, { force: true });
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
  setMediaCountdownText("");

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
    if (loopEnabledForLiveMedia()) {
      mediaPlaybackEndedPending = false;
      syncMediaLoopState();
      return;
    }
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
    !loopEnabledForLiveMedia();

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
    if (shouldAdvanceAfterCurrentItemEnds()) {
      void advanceQueueAfterMediaWindowClosed().catch((err) =>
        console.error("Queue advance after audio-only end failed:", err),
      );
    } else {
      void pauseQueuePresentationAtBoundary(nextQueueBoundaryIndex()).catch((err) =>
        console.error("Queue stop after audio-only end failed:", err),
      );
    }
  }

  if (!isActiveMediaWindow() && video && !playingMediaAudioOnly) {
    syncPreviewAudioTrackState();
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
  pidController = new PIDController(video, {
    isActiveMediaWindow,
    beginPidSeekSuppression,
  });
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
      document
        .getElementById("menuOpenProject")
        ?.addEventListener("click", () => void openProjectDialog());
      document
        .getElementById("menuSaveProject")
        ?.addEventListener("click", () => void saveProject());
      document
        .getElementById("menuSaveProjectAs")
        ?.addEventListener("click", () => void saveProjectAsDialog());
      document
        .getElementById("menuExportProject")
        ?.addEventListener("click", () => void exportPortableProjectDialog());
      document
        .getElementById("menuRelinkMissingFiles")
        ?.addEventListener("click", () => void relinkMissingFilesDialog());

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
      } else {
        document.getElementById("MdPlyrRBtnFrmID").checked = true;
        setSBFormMediaPlayer();
        installPreviewEventHandlers();
      }
      await restoreAutosavedProjectState();

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
        const droppedProject = firstDroppedProjectPath(event.dataTransfer);
        if (droppedProject) {
          try {
            await openProjectByPath(droppedProject);
          } catch (err) {
            console.error("Failed to open dropped project:", err);
            showGnomeToast("Failed to open project");
          }
          return;
        }
        const paths = await extractAndFilterDroppedMediaPaths(
          event.dataTransfer,
        );
        if (paths.length > 0) {
          applyDroppedMediaPaths(paths);
        } else {
          console.warn("No valid media files were dropped.");
        }
      });
      window.addEventListener("beforeunload", () => {
        void invoke("save-autosave-project-state", buildProjectStateSnapshot());
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
  if (mediaFile === undefined || mediaFile === null || isBiblePath(mediaFile)) {
    return false;
  }
  return /(?:m3u8|mpd|youtube\.com|videoplayback|youtu\.be)/i.test(mediaFile);
}

async function endLiveAudioPresentation() {
  if (isHandlingLiveEnded) return;
  isHandlingLiveEnded = true;
  setMediaCountdownText("");
  try {
    if (loopEnabledForLiveMedia()) {
      syncMediaLoopState({ notify: false });
      return;
    }
    const wasAudioOnlyQueueItem =
      isQueuePlaying &&
      !isActiveMediaWindow() &&
      playingMediaAudioOnly &&
      !loopEnabledForLiveMedia();

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
      if (shouldAdvanceAfterCurrentItemEnds()) {
        await advanceQueueAfterMediaWindowClosed();
        return;
      }
      await pauseQueuePresentationAtBoundary(nextQueueBoundaryIndex());
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
async function playAudioOnlyLocally(startOverride = null) {
  resolveQueuePresentationVideo();
  hidePptxPreview();
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
      ? queueItemCueStartTime(mediaQueue[currentQueueIndex])
      : 0;
  const requestedStart =
    Number.isFinite(startOverride) && startOverride > 0 ? startOverride : queueCueStart;
  const startAt = Number.isFinite(requestedStart) && requestedStart > 0 ? requestedStart : 0;

  audioOnlyFile = true;
  playingMediaAudioOnly = true;
  isPlaying = true;
  isActiveMediaWindowCache = false;
  liveAudioQueueIndex = currentQueueIndex;
  syncMediaLoopState({ notify: false });
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
    consumePendingCueVolume();
    audio.volume = localVideo.volume;
    audio.muted = false;
    audio.loop = loopTargetEnabled(liveLoopTarget(source));
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
  const textItem = options?.textItem || null;
  const transientText = options?.transientText === true;
  if (!video) {
    video = document.getElementById("preview");
  }
  if (seekOnly) {
    itc = performance.now() * 0.001;
  }
  let isQueuePlaybackContext =
    !transientText &&
    isQueuePlaying &&
    currentQueueIndex >= 0 &&
    currentQueueIndex < mediaQueue.length;
  const ts = await invoke("get-system-time");
  let birth =
    ts.systemTime +
    (Date.now() - ts.ipcTimestamp) * 0.001 +
    (performance.now() * 0.001 - itc) +
    "";
  mediaFile = textItem
    ? textItem.path
    : isQueuePlaybackContext
    ? mediaQueue[currentQueueIndex].path
    : currentMode === STREAMPLAYER
      ? document.getElementById("mdFile").value
      : mediaPlayerInputState.filePaths[0];
  var liveStreamMode = textItem ? false : isLiveStream(mediaFile);
  const displaySelectEl =
    currentMode === STREAMPLAYER
      ? document.getElementById("dspSelctStreams")
      : document.getElementById("dspSelct");
  const selectedIndex =
    displaySelectEl && displaySelectEl.value !== ""
      ? Number.parseInt(displaySelectEl.value, 10)
      : null;
  activeLiveStream = liveStreamMode;

  if (liveStreamMode === true) {
    if (currentMode === STREAMPLAYER) {
      isQueuePlaybackContext = false;
      isQueuePlaying = false;
      currentQueueIndex = -1;
      renderQueue();
    }
    if (video && !isImg(video.src)) {
      video.removeAttribute("src");
      video.load();
    }
  }

  const isTextItem = Boolean(textItem || (isQueuePlaybackContext && isQueueItemBible(mediaQueue[currentQueueIndex])));
  const isImgFile = !isTextItem && isImg(mediaFile);
  const isPptxFile = !isTextItem && pptxRegex.test(mediaFile);
  const pptxStartSlide = isPptxFile
    ? pptxStartSlideForItem({ path: mediaFile, type: "pptx" })
    : 0;

  // Audio-only files always play in the local preview, never in the
  // dedicated fullscreen media window (queue mode included). This keeps the
  // user in control: nothing flickers on the secondary display, and audio
  // continues to play exactly the way the local <video> preview already does.
  if (
    audioOnlyFile &&
    !isActiveMediaWindow() &&
    !isImgFile &&
    !isPptxFile
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
  consumePendingCueVolume();
  let strtVl = 0;
  if (isQueuePlaybackContext || currentMode === MEDIAPLAYER) {
    strtVl = Number.isFinite(video?.volume) ? video.volume : 1;
  } else {
    strtVl = streamVolume;
  }
  const autoPlayCtl = document.getElementById("autoPlayCtl");
  const autoPlayEnabled = isQueuePlaybackContext || !!autoPlayCtl?.checked;
  const autoPlayExplicitlyDisabled =
    !isQueuePlaybackContext && autoPlayCtl && !autoPlayCtl.checked;
  const effectiveLoop = loopEnabledForLiveMedia(mediaFile);
  syncMediaLoopState({ notify: false });

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
        isPptxFile ? "__isPptx" : "",
        isTextItem ? "__isText" : "",
        isPptxFile ? `__pptxSlide=${pptxStartSlide}` : "",
        `__autoplay=${autoPlayEnabled}`,
        seekOnly ? "__seek-only" : "",
        birth,
      ],
      preload: `${__dirname}/media_preload.min.js`,
      devTools: true,
    },
  };

  if (selectedIndex === null || !Number.isInteger(selectedIndex) || selectedIndex < 0) {
    showGnomeToast("Choose an audience output display");
    isActiveMediaWindowCache = false;
    return false;
  }

  isActiveMediaWindowCache = true;
  try {
    const windowId = await invoke("create-media-window", windowOptions, selectedIndex);
    if (!windowId) {
      isActiveMediaWindowCache = false;
      return false;
    }
    queueBiblePreviewMediaWindowSizeRefresh();
  } catch (err) {
    isActiveMediaWindowCache = false;
    activeMediaWindowContentType = null;
    throw err;
  }
  activeMediaWindowContentType = isTextItem
    ? "bible"
    : isPptxFile
      ? "pptx"
      : isImgFile
        ? "image"
        : "video";
  bibleShowNowModeActive = Boolean(isTextItem && transientText);
  if (isTextItem) {
    window.setTimeout(() => {
      const entry = textItem
        ? resolvedBibleEntryForItem(textItem)
        : resolvedBibleEntryForItem(mediaQueue[currentQueueIndex]);
      sendBibleTextToOutput(entry);
    }, 150);
    syncStreamRendererPreviewCapture();
    return;
  }
  if (isPptxFile) {
    setTimeout(() => {
      sendPptxSlideToMediaWindow(pptxStartSlide);
    }, 800);
  }

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
    if (activeLiveStream || video) {
      unPauseMedia();
    }
    if (isQueuePlaybackContext || currentMode !== STREAMPLAYER) {
      if (video !== null && !isImgFile && !isPptxFile) {
        beginPidSeekSuppression();
        await playVideoSafely(video, "media-window autoplay");
      }
    }
  }
  if (autoPlayExplicitlyDisabled) {
    pauseMedia();
    if (video) {
      await video.pause();
    }
  }
  syncStreamRendererPreviewCapture();
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
