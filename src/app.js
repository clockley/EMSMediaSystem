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
  DEFAULT_ITEM_SLIDE_TRANSITION,
  DEFAULT_SLIDE_TRANSITION,
  DEFAULT_SLIDE_TRANSITION_DURATION_MS,
  SLIDE_TRANSITION_INHERIT,
  SLIDE_TRANSITION_NONE,
  bibleQueuePath,
  bibleUriPrefix,
  bibleVersionValue,
  clampMediaTime,
  clampQueueStartTime,
  classifyQueueMediaType,
  createLiveSource,
  createQueueEntry,
  escapeHtml,
  formatCueTime,
  imageRegex,
  isBiblePath,
  isFileBackedMediaPath,
  isNonVideoPresentationPath,
  isPlayInterruptedError,
  normalizeLiveSource,
  normalizedBibleVersions,
  pathToMediaUrl,
  pptxRegex,
  queueBasename,
  slideTransitionForPlayback,
  slideTransitionLabel,
  slideTransitionOverrideSnapshot,
  songUriPrefix,
  isSongPath,
} from "./app-media-utils.mjs";
import {
  waitForLoadedMetadata,
  waitForMetadata as waitForMediaMetadata,
} from "./app-media-loading-utils.mjs";
import {
  normalizeScriptureReference,
  parseScriptureReference,
} from "./app-bible-reference-utils.mjs";
import {
  bindTransportTimeDisplay,
  getHostnameOrBasename,
  paintTransportTimeDisplay,
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
import {
  SCRIPTURE_AUTOSIZE_NORMALIZE,
  SCRIPTURE_BODY_FONT_SIZE,
  SCRIPTURE_DEFAULT_AUTOSIZE_MODE,
  SCRIPTURE_DEFAULT_LOOK,
  SCRIPTURE_FONT_FAMILY,
  SCRIPTURE_FONT_WEIGHT,
  SCRIPTURE_HEADING_FONT_SIZE,
  SCRIPTURE_LABEL_FONT_SIZE,
  SCRIPTURE_LINE_HEIGHT,
  SCRIPTURE_LOOK_FULLSCREEN,
  SCRIPTURE_LOOK_LOWER_THIRD,
  SCRIPTURE_LOWER_THIRD_CHROMA_KEY_COLOR,
  SCRIPTURE_LOWER_THIRD_TEXT_COLOR,
  SCRIPTURE_MIN_BODY_FONT_SIZE,
  SCRIPTURE_REFERENCE_FONT_SIZE,
  applyScriptureRenderToPreview,
  bibleLowerThirdMeasurePanel,
  bibleStyleSnapshot,
  classifyPresentationType,
  clampLowerThirdSegmentIndex,
  configureBibleScriptureRender,
  currentBibleBackgroundVideoSync,
  getBibleDesignerStyle,
  installBiblePreviewScaleObserver,
  isBibleLowerThirdFeatureEnabled,
  measureBibleEntryAutofit,
  mergedBibleShowNowStyle,
  normalizeBiblePreviewOutputSize,
  normalizeLowerThirdSegments,
  normalizeScriptureAutosizeMode,
  normalizeScriptureFontSize,
  normalizeScriptureLook,
  normalizeScriptureMinFontSize,
  queueBiblePreviewMediaWindowSizeRefresh,
  refreshBiblePreviewMediaWindowSize,
  resetBiblePreviewMediaWindowSize,
  resolveBibleLowerThirdState,
  scriptureReferencePresentationForBackground,
  selectedBiblePreviewOutputSize,
  setLastShownBibleStyleOverrides,
  syncBiblePreviewOutputScale,
  syncLowerThirdFeatureAvailability,
} from "./app-bible-scripture-render.mjs";
import {
  configureCountdown,
  handleTimeMessage,
  isImagePreviewCueActive,
  paintCountdownFor,
  resetCountdownSync,
  restoreCountdownForLiveMedia,
  updateTimestamp,
} from "./app-countdown.mjs";
import {
  configureToasts,
  invalidateQueueUndoToastAfterMutation,
  resetPreviewWarningState,
  showGnomeToast,
  showPreviewWarningToast,
} from "./app-toasts.mjs";
import {
  DEFAULT_SONG_RENDER,
  arrangementSequenceEntries,
  enabledSongSections,
  mergeSongRenderState,
  normalizeToSongAST,
  parseSongQueuePath,
  queueEntryFromSong,
  resolvedSongPresentation,
  songDefaultRenderFromRender,
  songSectionBlockTexts,
  songBlockText,
  songSectionLyricsText,
  songQueuePath,
  songRenderStateFromDefaultRender,
  songRenderFromItem,
} from "./app-song-utils.mjs";
import {
  EMS_SLIDE_DECK_SCHEMA_ID,
  DEFAULT_DECK_THEME,
  DEFAULT_TEXT_FRAME,
  SONG_DECK_DOCUMENT_TYPE,
  blocksToText,
  createBlankDeck,
  createBlankPage,
  createImageObject,
  createShapeObject,
  createTextObject,
  deckDefaultRender,
  deckPagesToSongSections,
  deckQueuePath,
  deckToTransientSong,
  findPage,
  getPagePrimaryText,
  isDeckPath,
  isSlideDeckDocument,
  normalizeSlideDeck,
  pageRenderOverrides,
  parseDeckQueuePath,
  setPagePrimaryText,
  songAstToDeck,
  textToSegmentsBlocks,
} from "./app-slide-utils.mjs";

let ipcRenderer;
let bibleAPI;
let songsAPI;
let slidesAPI;
let webUtils;
let attachCubicWaveShaper;
let timeRemaining;
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
  songsAPI = electron.songsAPI;
  slidesAPI = electron.slidesAPI;
  webUtils = electron.webUtils;
  attachCubicWaveShaper = electron.attachCubicWaveShaper;
  timeRemaining = electron.timeRemaining;
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
let activeResolvedMediaFile = "";
let activePreviewResolvedMediaFile = "";
var fileEnded = false;
var mediaSessionPause = false;
let isPlaying = false;
let img = null;
let itc = 0;
let playPauseBtn;
let playPauseIcon;
let timeline;
let currentTimeDisplay;
let volumePopupOpen = false;
let durationTimeDisplay;
let repeatButton;
const mediaLoopByPath = new Map();
configureToasts({
  getVideo: () => video,
});

const MEDIAPLAYER = 0,
  STREAMPLAYER = 1,
  BULKMEDIAPLAYER = 5,
  TEXTPLAYER = 6;
configureCountdown({
  getActiveMediaWindowContentType: () => activeMediaWindowContentType,
  getCurrentLiveQueueItem: () => currentLiveQueueItem(),
  getCurrentMode: () => currentMode,
  getCurrentPreviewCue: () => currentPreviewCue(),
  getLiveAudio: () => liveAudio,
  getLocalTimeStampUpdateIsRunning: () => localTimeStampUpdateIsRunning,
  getMediaFile: () => mediaFile,
  getPreviewAudio: () => previewAudio,
  getPreviewCueVideo: () => previewCueVideo,
  getSuppressPreviewForwarding: () => suppressPreviewForwarding,
  getVideo: () => video,
  hybridSync: (nextTargetTime) => hybridSync(nextTargetTime),
  isActiveMediaWindow: () => isActiveMediaWindow(),
  isAudioPreviewCueActive: () => isAudioPreviewCueActive(),
  isImg: (filePath) => isImg(filePath),
  isQueueItemImage: (item) => isQueueItemImage(item),
  isRemoteCountdownAuthoritative: () => remoteCountdownOwnsLiveMedia(),
  isVideoPreviewCueActive: () => isVideoPreviewCueActive(),
  mediaPathMatchesCurrentLiveMedia: (filePath) => mediaPathMatchesCurrentLiveMedia(filePath),
  mediaPlayerMode: MEDIAPLAYER,
  setLocalTimeStampUpdateIsRunning: (value) => {
    localTimeStampUpdateIsRunning = value;
  },
  setMediaCountdownOverlayVisible: (value) => setMediaCountdownOverlayVisible(value),
  setMediaCountdownText: (value) => setMediaCountdownText(value),
  setMediaCountdownFromCodes: (codes) => setMediaCountdownFromCodes(codes),
  setTargetTime: (value) => {
    targetTime = value;
  },
});
let isActiveMediaWindowCache = false;
const MEDIA_COUNTDOWN_DIGIT_COUNT = 12;
const countdownDigitNodes = [];
const countdownDigitLastCode = new Int32Array(MEDIA_COUNTDOWN_DIGIT_COUNT);
countdownDigitLastCode.fill(-1);
let countdownHasDisplayedDigits = false;
let mediaCountdownElement = null;
let countdownDigitParent = null;
const MEDIA_COUNTDOWN_CHAR_BY_CODE = new Array(128);
for (let digit = 0; digit < 10; digit++) {
  MEDIA_COUNTDOWN_CHAR_BY_CODE[48 + digit] = String(digit);
}
MEDIA_COUNTDOWN_CHAR_BY_CODE[(":".charCodeAt(0))] = ":";
MEDIA_COUNTDOWN_CHAR_BY_CODE[(".".charCodeAt(0))] = ".";
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
const PROJECT_SCHEMA_VERSION = 2;
const AUTOSAVE_WRITE_DEBOUNCE_MS = 300;
const PROJECT_GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let autosaveWriteTimer = null;
let currentProjectPath = "";
let currentProjectStorageMode = "working";
let currentProjectGuid = generateProjectGuid();
let currentProjectCreated = new Date().toISOString();
let activeMediaWindowContentType = null;
let bibleShowNowModeActive = false;
let songShowNowModeActive = false;
let songShowNowSourceId = null;
let bibleLowerThirdOutputActive = false;
const bibleDesignerState = {
  version: "KJV",
  attribution: null,
  reference: "",
  text: "",
  book: "John",
  chapter: 3,
  verse: 0,
  verseEnd: 0,
  fontFamily: SCRIPTURE_FONT_FAMILY,
  fontSize: SCRIPTURE_BODY_FONT_SIZE,
  autosizeMode: SCRIPTURE_DEFAULT_AUTOSIZE_MODE,
  minFontSize: SCRIPTURE_MIN_BODY_FONT_SIZE,
  autoSplit: true,
  color: "#ffffff",
  backgroundColor: "#000000",
  backgroundPath: "",
  lowerThirdColor: SCRIPTURE_LOWER_THIRD_TEXT_COLOR,
  lowerThirdChromaKeyColor: SCRIPTURE_LOWER_THIRD_CHROMA_KEY_COLOR,
  look: SCRIPTURE_DEFAULT_LOOK,
  lowerThirdSegments: [],
  lowerThirdSegmentIndex: 0,
  lowerThirdSourceText: "",
  transition: DEFAULT_ITEM_SLIDE_TRANSITION,
};

function normalizeProjectGuid(value) {
  const guid = typeof value === "string" ? value.trim().toLowerCase() : "";
  return PROJECT_GUID_RE.test(guid) ? guid : "";
}

function generateProjectGuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function resetCurrentProjectIdentity() {
  currentProjectGuid = generateProjectGuid();
  currentProjectCreated = new Date().toISOString();
}

function projectGuidFromState(state) {
  return (
    normalizeProjectGuid(state?.projectGuid) ||
    normalizeProjectGuid(state?.project?.guid)
  );
}

configureBibleScriptureRender({
  bibleDesignerState,
  buildBibleTextMessage: (...args) => buildBibleTextMessage(...args),
  closeBibleLowerThirdOutput: (...args) => closeBibleLowerThirdOutput(...args),
  getBibleLowerThirdOutputActive: () => bibleLowerThirdOutputActive,
  invoke: (...args) => invoke(...args),
  isQueueItemAudio: (item) => isQueueItemAudio(item),
  isQueueItemBible: (item) => isQueueItemBible(item),
  isQueueItemSong: (item) => isQueueItemSong(item),
  isQueueItemImage: (item) => isQueueItemImage(item),
  isQueueItemPptx: (item) => isQueueItemPptx(item),
  resolvedBibleStyleDefaults: (...args) => resolvedBibleStyleDefaults(...args),
});

const bibleVersionMetadataByKey = new Map();
const projectScriptureOverrides = {
  fontFamily: "",
  fontSize: undefined,
  autosizeMode: "",
  minFontSize: undefined,
  autoSplit: undefined,
  color: "",
  backgroundColor: "",
  backgroundPath: "",
  lowerThirdColor: "",
  lowerThirdChromaKeyColor: "",
};
const bibleStyleDirtyState = {
  fontFamily: false,
  fontSize: false,
  autosizeMode: false,
  minFontSize: false,
  autoSplit: false,
  color: false,
  backgroundColor: false,
  backgroundPath: false,
  lowerThirdColor: false,
  lowerThirdChromaKeyColor: false,
};
const bibleVerseSelection = {
  verses: new Set(),
  anchor: 0,
};
let bibleVersePreviewTimer = null;
let bibleReferenceSuggestionIndex = -1;
const bibleSearchState = {
  active: false,
  query: "",
  mode: "all",
  scope: "current",
  results: [],
  requestId: 0,
};
let bibleSearchTimer = null;
let bibleVerseListRequestId = 0;
/** @type {{ path: string, name: string, type: string, cueStartTime?: number, cueVolume?: number, loop?: boolean, pptxSlideIndex?: number }[]} */
let mediaQueue = [];
let currentQueueIndex = -1;
let previewCueIndex = -1;
let selectedQueueAnchorIndex = -1;
let isQueuePlaying = false;
let manualBoundaryPauseIndex = -1;
let globalSlideTransitionState = { ...DEFAULT_SLIDE_TRANSITION };
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
const LAST_BIBLE_VERSION_SETTING_KEY = "lastBibleVersion";
const DEFAULT_BIBLE_VERSION = "KJV";
const PPTX_SIDEBAR_DEFAULT_WIDTH = 168;
const PPTX_SIDEBAR_MIN_WIDTH = 128;
const PPTX_SIDEBAR_MAX_WIDTH = 360;
/** True after natural playback end (signaled before media window closes). */
let mediaPlaybackEndedPending = false;
/** True when the operator pressed Stop, so the close must not advance the queue. */
let userStopPresentationPending = false;
let presentationStartInProgress = false;
let queueSlipstreamTransitionInProgress = false;
/** When set, closing the media window switches to this queue index instead of advancing/stopping. */
let pendingQueueSwitchIndex = null;
let pendingQueueSwitchStartTime = 0;
let suppressPreviewForwarding = false;
let projectionPlaybackStartupPending = false;
let playbackStateSyncGeneration = 0;
let desiredProjectionPreviewPlayback = null;
let latestExplicitProjectionPauseState = null;
let livePreviewMirrorMutedState = null;
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
let songDragSongId = "";
const SONG_DRAG_MIME = "application/x-ems-song-id";
let queueDropIndicator = null;
let queueDropIndicatorIndex = -1;
/** Last <video> element that received cubic waveshaper wiring. */
let cubicWaveShaperAttachedVideo = null;

function isNonVideoPresentationItem(filePath) {
  return isNonVideoPresentationPath(filePath, isImg);
}

async function normalizeBibleReferenceInput(rawReference) {
  try {
    const resolved = await bibleAPI.resolveReference(
      bibleDesignerState.version || "KJV",
      rawReference,
    );
    if (resolved && !resolved.error && resolved.reference) {
      return {
        book: resolved.book,
        chapter: resolved.chapter,
        verse: resolved.verse || 0,
        verseEnd: resolved.verseEnd || 0,
        reference: resolved.reference,
      };
    }
  } catch {}
  return null;
}

async function bibleReferenceSuggestionsForInput(rawReference) {
  const query = String(rawReference || "").trim();
  if (!query) return [];
  try {
    const result = await bibleAPI.suggestReferences(
      bibleDesignerState.version || "KJV",
      query,
    );
    const seen = new Set();
    return (Array.isArray(result?.suggestions) ? result.suggestions : [])
      .map((suggestion) => {
        const type = suggestion?.type === "book" ? "book" : "reference";
        const reference = String(suggestion?.reference || suggestion?.book || "").trim();
        const book = String(suggestion?.book || reference).trim();
        if (!reference || !book) return null;
        const value = type === "book" ? `${book} 1:1` : reference;
        return {
          type,
          label: String(suggestion?.label || reference).trim(),
          value,
          reference,
        };
      })
      .filter(Boolean)
      .filter((suggestion) => {
        const key = suggestion.value;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 8);
  } catch {}
  return [];
}

async function bibleReferenceAllBooks() {
  try {
    const metadata = await bibleAPI.getBookMetadata(bibleDesignerState.version || "KJV");
    if (metadata?.error) return [];
    return (Array.isArray(metadata?.books) ? metadata.books : [])
      .map((book) => String(book?.name || "").trim())
      .filter(Boolean)
      .map((name) => ({
        type: "book",
        label: name,
        value: `${name} 1:1`,
        reference: name,
      }));
  } catch {}
  return [];
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

async function applyBibleReferenceSuggestion(suggestion) {
  const referenceInput = document.getElementById("bibleReferenceInput");
  const value =
    typeof suggestion === "string"
      ? suggestion
      : String(suggestion?.value || suggestion?.reference || suggestion?.label || "").trim();
  if (!referenceInput || !value) return;
  referenceInput.value = value;
  hideBibleReferenceSuggestions();
  referenceInput.focus();
  referenceInput.setSelectionRange(referenceInput.value.length, referenceInput.value.length);
  await jumpBibleReferenceToBrowser();
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

async function renderBibleReferenceSuggestions(options = {}) {
  const suggestionsEl = document.getElementById("bibleReferenceSuggestions");
  const referenceInput = document.getElementById("bibleReferenceInput");
  if (!suggestionsEl || !referenceInput) return;

  const suggestions = options.showAll
    ? await bibleReferenceAllBooks()
    : await bibleReferenceSuggestionsForInput(referenceInput.value);
  if (!suggestions.length) {
    hideBibleReferenceSuggestions();
    return;
  }

  suggestionsEl.innerHTML = "";
  const fragment = document.createDocumentFragment();
  suggestions.forEach((suggestion, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `bibleReferenceSuggestion-${index}`;
    button.className = "bible-reference-suggestion";
    button.setAttribute("role", "option");
    button.dataset.referenceValue = suggestion.value;
    button.textContent = suggestion.label;
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      void applyBibleReferenceSuggestion(suggestion);
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
  if (bibleReferenceSuggestionIndex < 0) {
    bibleReferenceSuggestionIndex = 0;
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
  return -1;
}

function rememberLivePreviewMirrorMuteState(mediaEl = video) {
  if (!mediaEl || livePreviewMirrorMutedState !== null) return;
  livePreviewMirrorMutedState = !!mediaEl.muted;
}

function restoreLivePreviewMirrorMuteState(mediaEl = video) {
  if (!mediaEl || livePreviewMirrorMutedState === null) return;
  mediaEl.muted = livePreviewMirrorMutedState;
  mediaEl.defaultMuted = livePreviewMirrorMutedState;
  livePreviewMirrorMutedState = null;
}

function beginProjectionPlaybackStartupSync() {
  projectionPlaybackStartupPending = true;
}

function finishProjectionPlaybackStartupSync() {
  projectionPlaybackStartupPending = false;
}

async function playVideoSafely(mediaEl, context = "", options = {}) {
  if (!mediaEl || typeof mediaEl.play !== "function") return false;
  if (
    mediaEl === video &&
    (isBiblePath(mediaFile) ||
      isSongPath(mediaFile) ||
      activeMediaWindowContentType === "bible" ||
      activeMediaWindowContentType === "song")
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
    if (options.logFailure !== false) {
      console.error(`Failed to start playback${suffix}:`, error);
    }
    return false;
  }
}

async function playLivePreviewMirrorSafely(context = "") {
  if (!video || isImg(video.src)) return false;
  const previousSuppression = suppressPreviewForwarding;
  suppressPreviewForwarding = true;
  try {
    if (await playVideoSafely(video, context, { logFailure: false })) {
      return true;
    }

    if (!isActiveMediaWindow() || video.muted) {
      return false;
    }

    rememberLivePreviewMirrorMuteState(video);
    video.muted = true;
    video.defaultMuted = true;
    return playVideoSafely(video, `${context} muted retry`);
  } finally {
    suppressPreviewForwarding = previousSuppression;
  }
}

async function pauseLivePreviewMirrorFromProjection(playbackState) {
  if (!video || video.paused) return;
  suppressPreviewForwarding = true;
  try {
    if (Number.isFinite(playbackState?.currentTime)) {
      video.currentTime = playbackState.currentTime;
    }
    await video.pause();
  } finally {
    suppressPreviewForwarding = false;
  }
}

async function reconcileStalePlaybackSync(generation) {
  if (generation === playbackStateSyncGeneration) return;
  if (desiredProjectionPreviewPlayback !== "paused") return;
  await pauseLivePreviewMirrorFromProjection(latestExplicitProjectionPauseState || {});
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

function isQueueItemSong(item) {
  return Boolean(
    item &&
      (item.type === "song" || isSongPath(item.path) || item.songSnapshot),
  );
}

function isQueueItemDeck(item) {
  return Boolean(
    item &&
      (item.type === "deck" ||
        item.source?.kind === "deck" ||
        item.source?.deckId ||
        isDeckPath(item.path)),
  );
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

function isQueueItemTransitionCapable(item) {
  return isQueueItemBible(item) || isQueueItemSong(item) || isQueueItemPptx(item);
}

function normalizeItemSlideTransitionOverride(transition) {
  return slideTransitionOverrideSnapshot(transition);
}

function effectiveSlideTransitionForQueueItem(item) {
  if (!isQueueItemTransitionCapable(item)) return { ...DEFAULT_SLIDE_TRANSITION };
  return slideTransitionForPlayback(item?.transition, globalSlideTransitionState);
}

function slideTransitionPayloadForQueueItem(item) {
  return effectiveSlideTransitionForQueueItem(item);
}

function slideTransitionBadgeMarkup(item) {
  const override = normalizeItemSlideTransitionOverride(item?.transition);
  if (!override) return "";
  const label = slideTransitionLabel(override);
  const duration = Number.isFinite(override.durationMs) ? override.durationMs : DEFAULT_SLIDE_TRANSITION_DURATION_MS;
  return `<span class="state-badge state-badge--transition" title="Slide transition override">${escapeHtml(label)} ${duration}ms</span>`;
}

const PREVIEW_SURFACE_LIVE = "live";
const PREVIEW_SURFACE_CUE_VIDEO = "cue-video";
const PREVIEW_SURFACE_CUE_IMAGE = "cue-image";
const PREVIEW_SURFACE_CUE_AUDIO = "cue-audio";
const PREVIEW_SURFACE_PPTX = "pptx";
const PREVIEW_SURFACE_BIBLE = "bible";
const PREVIEW_SURFACE_SONGS = "songs";
const PREVIEW_SURFACE_SLIDES = "slides";

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
  if (document.getElementById("songsWorkspace")?.hidden === false) {
    setPreviewStackSurface(PREVIEW_SURFACE_SONGS);
  } else if (document.getElementById("slidesWorkspace")?.hidden === false) {
    setPreviewStackSurface(PREVIEW_SURFACE_SLIDES);
  } else if (document.getElementById("bibleWorkspace")?.hidden === false) {
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

function validMediaStartTime(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function currentPreviewStartTimeForQueueItem(index, item, fallback = null) {
  if (!queueItemSupportsCueStartTime(item)) return null;

  if (index === previewCueIndex) {
    const cueMedia = isAudioPreviewCueActive()
      ? previewAudio
      : isVideoPreviewCueActive()
        ? previewCueVideo
        : null;
    if (Number.isFinite(cueMedia?.currentTime)) {
      return validMediaStartTime(cueMedia.currentTime);
    }
  }

  if (index === currentQueueIndex || previewShowsSameClipAsPath(item.path)) {
    if (Number.isFinite(video?.currentTime)) {
      return validMediaStartTime(video.currentTime);
    }
    if (Number.isFinite(fallback)) {
      return validMediaStartTime(fallback);
    }
  }

  return null;
}

function presentationStartTimeForQueueItem(index, fallback = null) {
  const item = index >= 0 && index < mediaQueue.length ? mediaQueue[index] : null;
  if (!item) return 0;

  const previewStart = currentPreviewStartTimeForQueueItem(index, item, fallback);
  if (previewStart !== null && previewStart > 0) {
    return previewStart;
  }

  return queueItemCueStartTime(item);
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
  const readPayload = await mediaReadPayloadForPath(filePath);
  const arrayBuffer = await invoke("read-file-as-arraybuffer", readPayload);
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
  const livePptxItem =
    isQueuePlaying &&
    currentQueueIndex >= 0 &&
    currentQueueIndex < mediaQueue.length &&
    isQueueItemPptx(mediaQueue[currentQueueIndex])
      ? mediaQueue[currentQueueIndex]
      : null;
  send("pptx-goto-slide", {
    slideIndex,
    filePath: pptxFilePath,
    transition: livePptxItem ? slideTransitionPayloadForQueueItem(livePptxItem) : undefined,
  });
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
  if (isPptxPreviewVisible()) {
    hidePptxPreview(options);
  } else {
    // A slow PPTX load may still be between the async import/read steps and
    // the first visible render. Invalidate it even when there is nothing on
    // screen yet, otherwise it can re-activate after the user returns to live.
    nextPptxPreviewRequestToken();
  }
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
  if (isBiblePath(filePath) || isSongPath(filePath) || pptxRegex.test(filePath) || isImg(filePath)) {
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
  if (isBiblePath(filePath) || isSongPath(filePath)) return false;
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

function disableNativeVideoControls(el) {
  if (!el) return;
  el.controls = false;
  el.removeAttribute("controls");
  try {
    el.controlsList?.add("nodownload", "nofullscreen", "noremoteplayback");
  } catch {}
  try {
    el.disablePictureInPicture = true;
  } catch {}
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

// Best-effort human name for whatever is currently live: the queue item's name
// (a Bible reference for scripture, otherwise the file name), or the basename of
// the live media/stream. Returns "" when nothing identifiable is live so callers
// can fall back to a generic phrase rather than a quoted placeholder.
function currentLivePresentationLabel() {
  const liveItem = currentLiveQueueItemForSwitchPrompt();
  if (liveItem?.name) return liveItem.name;
  if (mediaFile) return getHostnameOrBasename(mediaFile);
  return "";
}

function findQueueIndexByPath(filePath) {
  const normalized = normalizeMediaPathForCompare(filePath);
  if (!normalized) return -1;
  return mediaQueue.findIndex(
    (item) => normalizeMediaPathForCompare(item.path) === normalized,
  );
}

function queueItemForPath(filePath) {
  const index = findQueueIndexByPath(filePath);
  return index >= 0 ? mediaQueue[index] : null;
}

function queueItemLiveSource(item) {
  if (!item || isQueueItemBible(item) || !isFileBackedMediaPath(item.path)) {
    return undefined;
  }
  const normalized = normalizeLiveSource(item.path, item.liveSource, {
    type: item.type || classifyQueueMediaType(item.path),
    originalPath: item.originalPath || item.path,
    mode: currentProjectStorageMode === "packed" ? "packaged" : undefined,
  });
  item.liveSource = normalized;
  return normalized;
}

function liveSourceSnapshotFields(liveSource) {
  if (!liveSource || typeof liveSource !== "object") return undefined;
  return {
    mode: liveSource.mode === "packaged" ? "packaged" : "linked",
    strategy: liveSource.strategy === "snapshot" ? "snapshot" : "reference",
    stagingTier: liveSource.stagingTier === "full" ? "full" : "warn-only",
    originalPath:
      typeof liveSource.originalPath === "string" ? liveSource.originalPath : undefined,
    snapshotId:
      typeof liveSource.snapshotId === "string" ? liveSource.snapshotId : undefined,
    pinnedMtimeMs: Number.isFinite(liveSource.pinnedMtimeMs)
      ? liveSource.pinnedMtimeMs
      : undefined,
    pinnedSizeBytes: Number.isFinite(liveSource.pinnedSizeBytes)
      ? liveSource.pinnedSizeBytes
      : undefined,
    pinnedFileHash:
      typeof liveSource.pinnedFileHash === "string"
        ? liveSource.pinnedFileHash
        : undefined,
    previousSnapshotId:
      typeof liveSource.previousSnapshotId === "string"
        ? liveSource.previousSnapshotId
        : undefined,
    reason: typeof liveSource.reason === "string" ? liveSource.reason : undefined,
  };
}

function applyPinnedMediaSource(item, pinned, opts = {}) {
  if (!item || !pinned) return false;
  const clearPendingMediaUpdate = opts.clearPendingMediaUpdate === true;
  if (item.pendingMediaUpdate && !clearPendingMediaUpdate) {
    return false;
  }
  let changed = false;
  if (typeof pinned.fileHash === "string" && item.fileHash !== pinned.fileHash) {
    item.fileHash = pinned.fileHash;
    changed = true;
  }
  if (typeof pinned.fileHashAlg === "string" && item.fileHashAlg !== pinned.fileHashAlg) {
    item.fileHashAlg = pinned.fileHashAlg;
    changed = true;
  }
  if (Number.isFinite(pinned.sizeBytes) && item.sizeBytes !== pinned.sizeBytes) {
    item.sizeBytes = pinned.sizeBytes;
    changed = true;
  }
  if (
    typeof pinned.modifiedTime === "string" &&
    item.modifiedTime !== pinned.modifiedTime
  ) {
    item.modifiedTime = pinned.modifiedTime;
    changed = true;
  }
  if (pinned.liveSource && typeof pinned.liveSource === "object") {
    const normalized = normalizeLiveSource(item.path, pinned.liveSource, {
      type: item.type || classifyQueueMediaType(item.path),
      originalPath: item.originalPath || item.path,
    });
    item.liveSource = normalized;
    changed = true;
  }
  if (clearPendingMediaUpdate && item.pendingMediaUpdate) {
    delete item.pendingMediaUpdate;
    changed = true;
  }
  if (clearPendingMediaUpdate && item.changedSinceSave) {
    item.changedSinceSave = false;
    changed = true;
  }
  if (item.missing) {
    item.missing = false;
    changed = true;
  }
  if (item.lastPreflightWarningFingerprint) {
    const previousSnapshotId =
      typeof item.liveSource?.snapshotId === "string" ? item.liveSource.snapshotId : "";
    const nextSnapshotId =
      typeof pinned?.liveSource?.snapshotId === "string"
        ? pinned.liveSource.snapshotId
        : "";
    if (!nextSnapshotId || !previousSnapshotId || nextSnapshotId !== previousSnapshotId) {
      delete item.lastPreflightWarningFingerprint;
      changed = true;
    }
  }
  return changed;
}

function mediaPinPayloadForItem(item, opts = {}) {
  if (
    !item ||
    isQueueItemBible(item) ||
    isQueueItemSong(item) ||
    !isFileBackedMediaPath(item.path)
  ) {
    return null;
  }
  const liveSource = queueItemLiveSource(item) || createLiveSource(item.path, {
    type: item.type || classifyQueueMediaType(item.path),
    originalPath: item.originalPath || item.path,
  });
  return {
    path: item.path,
    type: item.type || classifyQueueMediaType(item.path),
    projectPath: currentProjectPath || "",
    projectGuid: currentProjectGuid,
    liveSource: {
      ...liveSource,
      ...(opts.liveSource || {}),
    },
  };
}

let mediaWatchSyncTimer = null;

function scheduleMediaWatchSync() {
  if (mediaWatchSyncTimer !== null) {
    clearTimeout(mediaWatchSyncTimer);
  }
  mediaWatchSyncTimer = setTimeout(() => {
    mediaWatchSyncTimer = null;
    void syncMediaWatches().catch((err) =>
      console.error("register-media-watches failed:", err),
    );
  }, 250);
}

async function syncMediaWatches() {
  const watchItems = mediaQueue
    .map((item, index) => {
      const liveSource = queueItemLiveSource(item);
      if (!liveSource || liveSource.mode !== "linked") return null;
      return {
        queueItemId: String(index),
        originalPath: liveSource.originalPath || item.path,
        pinnedFileHash: liveSource.pinnedFileHash || item.fileHash,
        pinnedSizeBytes: Number.isFinite(liveSource.pinnedSizeBytes)
          ? liveSource.pinnedSizeBytes
          : item.sizeBytes,
        pinnedMtimeMs: Number.isFinite(liveSource.pinnedMtimeMs)
          ? liveSource.pinnedMtimeMs
          : null,
        fileHash: item.fileHash,
        sizeBytes: item.sizeBytes,
      };
    })
    .filter(Boolean);
  await invoke("register-media-watches", watchItems);
}

function liveSourcePinnedModifiedTime(liveSource) {
  if (!Number.isFinite(liveSource?.pinnedMtimeMs)) return undefined;
  const modified = new Date(liveSource.pinnedMtimeMs);
  return Number.isFinite(modified.getTime()) ? modified.toISOString() : undefined;
}

function queueItemPreflightCheckPayload(item) {
  const liveSource = queueItemLiveSource(item);
  const sourcePath =
    liveSource?.mode === "linked"
      ? liveSource.originalPath || item.originalPath || item.path
      : item.path;
  return {
    path: sourcePath,
    queuePath: item.path,
    sizeBytes: Number.isFinite(liveSource?.pinnedSizeBytes)
      ? liveSource.pinnedSizeBytes
      : item.sizeBytes,
    modifiedTime: liveSourcePinnedModifiedTime(liveSource) || item.modifiedTime,
    fileHash: liveSource?.pinnedFileHash || item.fileHash,
    fileHashAlg: item.fileHashAlg,
  };
}

function queueItemNeedsDefaultSnapshotPin(item) {
  const liveSource = queueItemLiveSource(item);
  if (!liveSource || liveSource.mode !== "linked") return false;
  if (
    liveSource.strategy === "snapshot" &&
    liveSource.stagingTier === "full" &&
    typeof liveSource.snapshotId === "string" &&
    liveSource.snapshotId.length > 0
  ) {
    return false;
  }
  if (liveSource.strategy !== "snapshot") {
    return liveSource.stagingTier === "full" || !liveSource.reason;
  }
  // createLiveSource defaults strategy to "snapshot" before pin completes.
  return !liveSource.snapshotId || liveSource.snapshotId.length === 0;
}

function queueItemUsesPackagedMedia(item) {
  return queueItemLiveSource(item)?.mode === "packaged";
}

async function pinQueueMediaSources(items, opts = {}) {
  const targets = (Array.isArray(items) ? items : [])
    .filter(
      (item) =>
        item &&
        !isQueueItemBible(item) &&
        !isQueueItemSong(item) &&
        isFileBackedMediaPath(item.path) &&
        !queueItemUsesPackagedMedia(item),
    )
    .filter(
      (item) =>
        opts.force === true ||
        (opts.repairStaging === true && queueItemHasSafeSnapshotPin(item)) ||
        !item.liveSource ||
        !queueItemHasStoredFileHash(item) ||
        queueItemNeedsDefaultSnapshotPin(item),
    );
  if (targets.length === 0) {
    scheduleMediaWatchSync();
    return false;
  }
  let changed = false;
  for (const item of targets) {
    const payload = mediaPinPayloadForItem(item);
    if (!payload) continue;
    try {
      const pinned = await invoke("pin-media-source", {
        ...payload,
        verifyStagedPin: opts.repairStaging === true,
      });
      changed = applyPinnedMediaSource(item, pinned, {
        clearPendingMediaUpdate: opts.clearPendingMediaUpdate === true,
      }) || changed;
    } catch (err) {
      console.error(`Failed to pin media source ${item.path}:`, err);
    }
  }
  if (changed) {
    renderQueue();
    if (opts.skipScheduleAutosave !== true) {
      scheduleAutosaveProjectState();
    }
  }
  scheduleMediaWatchSync();
  return changed;
}

async function resolveQueueItemMediaPath(item) {
  if (!item || isQueueItemBible(item) || isQueueItemSong(item)) {
    return item?.path || "";
  }
  try {
    const payload = mediaPinPayloadForItem(item);
    if (!payload) return item?.path || "";
    const liveSource = queueItemLiveSource(item);
    if (liveSource?.mode === "packaged") {
      return item.path;
    }
    const hasSnapshotId =
      typeof liveSource?.snapshotId === "string" && liveSource.snapshotId.length > 0;
    if (
      queueItemNeedsDefaultSnapshotPin(item) ||
      (!queueItemHasSafeSnapshotPin(item) && !hasSnapshotId)
    ) {
      const pinned = await invoke("pin-media-source", payload);
      applyPinnedMediaSource(item, pinned);
      if (typeof pinned?.resolvedPath === "string" && pinned.resolvedPath.length > 0) {
        return pinned.resolvedPath;
      }
    }
    return await invoke("resolve-staged-media-path", mediaPinPayloadForItem(item));
  } catch (err) {
    console.error(`Failed to resolve staged media path ${item.path}:`, err);
    return item.path;
  }
}

async function resolveQueueMediaPathByPath(filePath) {
  const item = queueItemForPath(filePath);
  if (item) return resolveQueueItemMediaPath(item);
  return filePath;
}

function queueItemMediaCacheBust(item) {
  if (!item) return undefined;
  const liveSource = queueItemLiveSource(item);
  if (
    liveSource?.strategy === "snapshot" &&
    typeof liveSource.snapshotId === "string" &&
    liveSource.snapshotId.length > 0
  ) {
    return liveSource.snapshotId;
  }
  return typeof item.fileHash === "string" && item.fileHash.length > 0
    ? item.fileHash
    : undefined;
}

async function stagedMediaUrlForItem(item) {
  if (!item || isQueueItemBible(item) || isQueueItemSong(item)) return "";
  const resolvedPath = await resolveQueueItemMediaPath(item);
  return pathToMediaUrl(resolvedPath, queueItemMediaCacheBust(item));
}

function previewMediaSourcePath() {
  if (activePreviewResolvedMediaFile) return activePreviewResolvedMediaFile;
  if (activeResolvedMediaFile) return activeResolvedMediaFile;
  return mediaFile;
}

async function mediaReadPayloadForPath(filePath) {
  const item = queueItemForPath(filePath);
  if (item) {
    if (queueItemNeedsDefaultSnapshotPin(item)) {
      await pinQueueMediaSources([item], {
        force: true,
        skipScheduleAutosave: true,
        repairStaging: true,
      });
    } else if (queueItemHasSafeSnapshotPin(item)) {
      await pinQueueMediaSources([item], {
        skipScheduleAutosave: true,
        repairStaging: true,
      });
    }
    const payload = mediaPinPayloadForItem(item);
    if (payload) return payload;
  }
  return resolveQueueMediaPathByPath(filePath);
}

function queueItemOwnsControlPreview(item) {
  return (
    item &&
    isFileBackedMediaPath(item.path) &&
    !isQueueItemPptx(item) &&
    !isQueueItemBible(item) &&
    !isQueueItemSong(item)
  );
}

function currentQueuePreviewItem() {
  if (currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length) {
    return mediaQueue[currentQueueIndex];
  }
  return queueItemForPath(mediaFile);
}

async function syncQueuePreviewMediaElements(item = null) {
  const previewItem = item || currentQueuePreviewItem();
  if (!queueItemOwnsControlPreview(previewItem)) return false;
  await restoreStagedPreviewPlayback(isQueueItemImage(previewItem), currentQueueIndex);
  return true;
}

async function restoreStagedPreviewPlayback(isImgFile, queueIndex = currentQueueIndex) {
  let previewItem =
    queueIndex >= 0 && queueIndex < mediaQueue.length ? mediaQueue[queueIndex] : null;
  if (!previewItem && mediaFile) {
    previewItem = queueItemForPath(mediaFile);
  }
  if (
    previewItem &&
    isFileBackedMediaPath(previewItem.path) &&
    !isQueueItemPptx(previewItem) &&
    !isQueueItemBible(previewItem) &&
    !isQueueItemSong(previewItem)
  ) {
    const resolvedPath = await resolveQueueItemMediaPath(previewItem);
    activePreviewResolvedMediaFile = resolvedPath;
    const cacheBust = queueItemMediaCacheBust(previewItem);
    handleMediaPlayback(isImgFile, resolvedPath, cacheBust);
    handleImageDisplay(isImgFile, document.querySelector("img#preview"), resolvedPath, cacheBust);
    return;
  }
  handleMediaPlayback(isImgFile);
  handleImageDisplay(isImgFile, document.querySelector("img#preview"));
}

function mediaUpdateWarningFingerprint(update) {
  if (!update || typeof update !== "object") return "";
  const hash =
    typeof update.currentFileHash === "string" && update.currentFileHash.length > 0
      ? update.currentFileHash
      : typeof update.fileHash === "string" && update.fileHash.length > 0
        ? update.fileHash
        : "";
  if (hash) {
    return `${update.currentFileHashAlg || update.fileHashAlg || "xxh3-64"}:${hash}`;
  }
  const size = Number.isFinite(update.currentSizeBytes)
    ? String(update.currentSizeBytes)
    : Number.isFinite(update.sizeBytes)
      ? String(update.sizeBytes)
      : "";
  const modified =
    typeof update.currentModifiedTime === "string" && update.currentModifiedTime.length > 0
      ? update.currentModifiedTime
      : typeof update.modifiedTime === "string" && update.modifiedTime.length > 0
        ? update.modifiedTime
        : Number.isFinite(update.currentMtimeMs)
          ? String(update.currentMtimeMs)
          : Number.isFinite(update.mtimeMs)
            ? String(update.mtimeMs)
            : "";
  return size || modified ? `meta:${size}:${modified}` : "";
}

function pendingMediaUpdateStatus(update) {
  return update?.status || "ready";
}

function pendingMediaUpdateMatches(existingUpdate, nextUpdate) {
  if (!existingUpdate || !nextUpdate) return false;
  if (pendingMediaUpdateStatus(existingUpdate) !== pendingMediaUpdateStatus(nextUpdate)) {
    return false;
  }
  const existingFingerprint =
    existingUpdate.warningFingerprint || mediaUpdateWarningFingerprint(existingUpdate);
  const nextFingerprint =
    nextUpdate.warningFingerprint || mediaUpdateWarningFingerprint(nextUpdate);
  return (
    (existingFingerprint || "") === (nextFingerprint || "") &&
    (existingUpdate.errorReason || "") === (nextUpdate.errorReason || "")
  );
}

function shouldPreserveReadyMediaUpdate(existingUpdate, nextUpdate) {
  return (
    Boolean(existingUpdate) &&
    pendingMediaUpdateStatus(existingUpdate) === "ready" &&
    pendingMediaUpdateStatus(nextUpdate) !== "ready"
  );
}

function applyMediaUpdateMissingFlag(item, status) {
  if (!item) return false;
  if (status === "missing" && item.missing !== true) {
    item.missing = true;
    return true;
  }
  if (status === "ready" && item.missing) {
    item.missing = false;
    return true;
  }
  return false;
}

function mediaUpdatePayloadQueueItemIds(payload) {
  const values = [];
  if (Array.isArray(payload?.queueItemIds)) values.push(...payload.queueItemIds);
  if (payload?.queueItemId !== undefined && payload.queueItemId !== null) {
    values.push(payload.queueItemId);
  }
  const ids = values
    .map((value) => String(value))
    .filter((value) => value.length > 0);
  return ids.length > 0 ? new Set(ids) : null;
}

function markQueueItemMediaUpdate(payload) {
  if (!payload || typeof payload !== "object") return;
  const originalPath = normalizeMediaPathForCompare(payload.originalPath || "");
  const payloadQueueItemIds = mediaUpdatePayloadQueueItemIds(payload);
  let changed = false;
  let visibleReadyChange = false;
  mediaQueue.forEach((item, index) => {
    if (payloadQueueItemIds && !payloadQueueItemIds.has(String(index))) return;
    const liveSource = queueItemLiveSource(item);
    if (!liveSource || liveSource.mode !== "linked") return;
    if (normalizeMediaPathForCompare(liveSource.originalPath || item.path) !== originalPath) {
      return;
    }
    const pendingMediaUpdate = {
      mtimeMs: payload.mtimeMs,
      sizeBytes: payload.sizeBytes,
      fileHash: payload.fileHash,
      fileHashAlg: payload.fileHashAlg,
      detectedAt: Date.now(),
      status: payload.status || "ready",
      errorReason: payload.errorReason,
      sourcePath: liveSource.originalPath || item.path,
      canKeepOld: queueItemCanKeepOldMediaVersion(item),
    };
    const warningFingerprint = mediaUpdateWarningFingerprint(pendingMediaUpdate);
    if (warningFingerprint) {
      pendingMediaUpdate.warningFingerprint = warningFingerprint;
    }
    const existingPendingMediaUpdate = item.pendingMediaUpdate;
    if (shouldPreserveReadyMediaUpdate(existingPendingMediaUpdate, pendingMediaUpdate)) {
      changed = applyMediaUpdateMissingFlag(item, pendingMediaUpdate.status) || changed;
      return;
    }
    if (pendingMediaUpdateMatches(existingPendingMediaUpdate, pendingMediaUpdate)) {
      changed = applyMediaUpdateMissingFlag(item, pendingMediaUpdate.status) || changed;
      return;
    }
    item.pendingMediaUpdate = pendingMediaUpdate;
    item.changedSinceSave = pendingMediaUpdate.status !== "stabilizing";
    applyMediaUpdateMissingFlag(item, pendingMediaUpdate.status);
    if (pendingMediaUpdate.status === "ready") visibleReadyChange = true;
    changed = true;
    if (payloadQueueItemIds?.has(String(index))) {
      selectedQueueAnchorIndex = queueIndexInRange(selectedQueueAnchorIndex)
        ? selectedQueueAnchorIndex
        : index;
    }
  });
  if (changed) {
    renderQueue();
    if (visibleReadyChange) {
      showGnomeToast("A linked media file changed outside EMS");
    }
    scheduleAutosaveProjectState();
  }
}

async function approvePendingMediaUpdate(index) {
  if (!queueIndexInRange(index)) return false;
  const item = mediaQueue[index];
  if (!item?.pendingMediaUpdate) return false;
  const payload = mediaPinPayloadForItem(item);
  if (!payload) return false;
  try {
    const pinned = await invoke("approve-media-refresh", payload);
    if (!applyPinnedMediaSource(item, pinned, { clearPendingMediaUpdate: true })) return false;
    renderQueue();
    scheduleAutosaveProjectState();
    scheduleMediaWatchSync();
    if (index === currentQueueIndex && isQueuePresentationActive()) {
      await slipstreamQueueItemAtIndex(index, { startTime: queueItemCueStartTime(item) });
    } else if (index === previewCueIndex || index === selectedQueueIndexForDisplay()) {
      await loadQueueItemIntoControlWindow(item, {
        preservePreviewSeek: false,
        startTime: queueItemCueStartTime(item),
      });
    }
    showGnomeToast("Media file reloaded");
    return true;
  } catch (err) {
    console.error("Failed to approve media refresh:", err);
    showGnomeToast("Could not reload media file");
    return false;
  }
}

function queueItemHasSafeSnapshotPin(item) {
  const liveSource = queueItemLiveSource(item);
  return Boolean(
    liveSource &&
      liveSource.mode === "linked" &&
      liveSource.strategy === "snapshot" &&
      liveSource.stagingTier === "full" &&
      typeof liveSource.snapshotId === "string" &&
      liveSource.snapshotId.length > 0,
  );
}

function queueItemCanKeepOldMediaVersion(item) {
  return queueItemHasSafeSnapshotPin(item);
}

function keepPendingMediaUpdate(index) {
  if (!queueIndexInRange(index)) return false;
  const item = mediaQueue[index];
  if (!item?.pendingMediaUpdate || !queueItemCanKeepOldMediaVersion(item)) {
    return false;
  }
  const changed = acknowledgePreflightWarningForItem(item);
  if (changed) {
    renderQueue();
    scheduleAutosaveProjectState();
    scheduleMediaWatchSync();
  }
  showGnomeToast("Keeping old media file");
  return true;
}

function queueItemNeedsPendingUpdateApproval(item) {
  return Boolean(
    item?.pendingMediaUpdate?.status === "ready" &&
      !queueItemCanKeepOldMediaVersion(item),
  );
}

async function ensurePendingMediaUpdateApproved(index) {
  if (!queueIndexInRange(index)) return false;
  const item = mediaQueue[index];
  if (!queueItemNeedsPendingUpdateApproval(item)) return true;
  const name = item.name || item.path || "This media item";
  const accepted = window.confirm(
    `${name} changed outside EMS. EMS cannot keep the old linked version pinned for this item on the current system.\n\nReload the changed file before taking it live?`,
  );
  if (!accepted) return false;
  return approvePendingMediaUpdate(index);
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

// True when the current live output (audience window, lower third, or the live
// queue item) is already a scripture. Used to decide whether switching the live
// presentation to a different verse needs an interrupt confirmation.
function isScripturePresentationLive() {
  if (isBiblePresentationActive()) return true;
  if (bibleShowNowModeActive) return true;
  if (isBibleLowerThirdFeatureEnabled() && bibleLowerThirdOutputActive) return true;
  const liveItem = currentLiveQueueItemForSwitchPrompt();
  return Boolean(liveItem && isQueueItemBible(liveItem));
}

// True when the live scripture output is already mirroring the current bible
// selection through one of the preview-sync paths, so editing/selecting it pushes
// straight to the output without a separate show-now. This is only the case for
// show-now mode (audience or lower third) and for editing the live queue
// scripture in place while the selection still resolves to that same queue item.
// Selecting a different verse than the one that is live falls through to false so
// the caller can take the new selection live explicitly.
function biblePreviewMirrorsLiveOutput() {
  if (isBibleShowNowLiveMode()) return true;
  if (
    bibleShowNowModeActive &&
    (bibleLowerThirdOutputActive || hasLowerThirdOutputSelected())
  ) {
    return true;
  }
  if (
    isQueuePlaying &&
    isBibleEditorTargetLiveItem() &&
    bibleEntryMatchesQueueItemShallow(bibleDesignerState, mediaQueue[currentQueueIndex])
  ) {
    return true;
  }
  return false;
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
  return (
    suppressPreviewForwarding ||
    projectionPlaybackStartupPending ||
    isPreparingSeparateCue()
  );
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
      isPreviewWorkspaceOverlayVisible() &&
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
  nextPreviewLoadToken();
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
    nextPreviewLoadToken();
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
    disableNativeVideoControls(previewCueVideo);
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
async function loadVideoQueueItemIntoPreviewCueOverlay(index, item, startTime, loadToken) {
  const token = Number.isFinite(loadToken) ? loadToken : nextPreviewLoadToken();
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
  const cueUrl = await stagedMediaUrlForItem(item);
  if (!isCurrentPreviewLoad(token) || previewCueIndex !== index) {
    if (previewCueVideoIndex === index) clearVideoPreviewCueOverlay();
    return;
  }
  el.src = cueUrl;
  el.load();
  el.hidden = false;
  setPreviewStackSurface(PREVIEW_SURFACE_CUE_VIDEO);

  await waitForLoadedMetadata(el);
  if (!isCurrentPreviewLoad(token) || previewCueIndex !== index) {
    if (previewCueVideoIndex === index) clearVideoPreviewCueOverlay();
    return;
  }

  const actualStart = await seekMedia(el, startTime);
  if (!isCurrentPreviewLoad(token) || previewCueIndex !== index) {
    if (previewCueVideoIndex === index) clearVideoPreviewCueOverlay();
    return;
  }

  setCueStartTime(index, actualStart);
  if (Number.isFinite(el.duration) && el.duration > 0) {
    mediaQueue[index].duration = el.duration;
  }

  if (timeline && Number.isFinite(el.duration) && el.duration > 0) {
    timeline.value = (actualStart / el.duration) * 100;
    if (currentTimeDisplay) paintTransportTimeDisplay(currentTimeDisplay, actualStart);
    if (durationTimeDisplay) paintTransportTimeDisplay(durationTimeDisplay, el.duration);
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
    const selectedQueueIndex = selectedQueueIndexForDisplay();

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
          item.pendingMediaUpdate?.status === "ready" ? " queue-item--pending-update" : "",
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
        const transitionBadge = slideTransitionBadgeMarkup(item);
        if (transitionBadge) {
          badges.push(transitionBadge);
        }
        if (item.missing && !isQueueItemSong(item)) {
          badges.push(
            '<span class="state-badge state-badge--missing" title="File could not be found">Missing</span>',
          );
        } else if (item.pendingMediaUpdate?.status === "stabilizing" && !isQueueItemSong(item)) {
          badges.push(
            '<span class="state-badge state-badge--changed" title="Source file is still being saved">Updating</span>',
          );
        } else if (item.pendingMediaUpdate?.status === "error" && !isQueueItemSong(item)) {
          badges.push(
            '<span class="state-badge state-badge--missing" title="EMS could not inspect the changed source file">Update Error</span>',
          );
        } else if (item.pendingMediaUpdate?.status === "ready" && !isQueueItemSong(item)) {
          badges.push(
            '<span class="state-badge state-badge--changed" title="Source file changed outside EMS">Updated</span>',
          );
        } else if (item.changedSinceSave && !isQueueItemSong(item)) {
          badges.push(
            '<span class="state-badge state-badge--changed" title="Source file changed since this project was last saved">Changed</span>',
          );
        }
        const statusMarkup =
          badges.length || hasCueStart
            ? `<span class="item-status-row">${badges.join("")}${cueStartMarkup}</span>`
            : "";
        const autoAdvanceEnabled = item.autoAdvance !== false;
        const canKeepOldUpdate =
          item.pendingMediaUpdate?.status === "ready" &&
          queueItemCanKeepOldMediaVersion(item);
        const updateActionMarkup =
          item.pendingMediaUpdate?.status === "ready"
            ? `<span class="item-update-actions">${canKeepOldUpdate ? `<button type="button" class="row-media-update-btn" data-queue-keep-update="${index}" title="Keep using the staged old version and clear this update notice" aria-label="Keep old media file">Keep</button>` : ""}<button type="button" class="row-media-update-btn" data-queue-reload-update="${index}" title="Reload this schedule item from the changed source file" aria-label="Reload media file">Reload</button></span>`
            : "";
        const secondaryMarkup =
          statusMarkup || updateActionMarkup
            ? `<span class="item-secondary-row">${statusMarkup}${updateActionMarkup}</span>`
            : "";
        const autoAdvanceMarkup = `<button type="button" class="row-auto-advance-btn" data-queue-auto="${index}" aria-label="${autoAdvanceEnabled ? "Auto: continue to the next scheduled item" : "Stop: pause after this scheduled item"}" title="${autoAdvanceEnabled ? "Auto: continue to next item" : "Stop after this item"}">${autoAdvanceEnabled ? "Auto" : "Stop"}</button>`;
        return `<div class="${classes}" role="listitem" data-queue-index="${index}" draggable="true" ${isSelected ? 'data-selected="true"' : ""} ${isLive ? 'data-live="true"' : ""} ${isCued ? 'data-cued="true"' : ""}>
      <span class="item-icon">${queueTypeIconMarkup(item)}</span>
      <span class="item-text">
        <span class="item-label" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        ${secondaryMarkup}
      </span>
      <span class="queue-item-trailing-actions">
      ${autoAdvanceMarkup}
      <button type="button" class="remove-btn" draggable="false" data-queue-remove="${index}" title="Remove from schedule" aria-label="Remove from schedule">✕</button>
      </span>
    </div>`;
      })
      .join("");
  }
  updateClearQueueButtonState();
  updatePreviewCueUI();
}

function queueIndexInRange(index) {
  return Number.isInteger(index) && index >= 0 && index < mediaQueue.length;
}

function fallbackSelectedQueueIndex() {
  const separatePreviewCue = isPreparingSeparateCue();
  if (separatePreviewCue && queueIndexInRange(previewCueIndex)) {
    return previewCueIndex;
  }
  if (queueIndexInRange(currentQueueIndex)) {
    return currentQueueIndex;
  }
  return -1;
}

function selectedQueueIndexForDisplay() {
  return queueIndexInRange(selectedQueueAnchorIndex)
    ? selectedQueueAnchorIndex
    : fallbackSelectedQueueIndex();
}

function selectedQueueIndexForInsertion() {
  return selectedQueueIndexForDisplay();
}

function queueInsertionIndexAfterSelection() {
  const selectedIndex = selectedQueueIndexForInsertion();
  return selectedIndex >= 0 ? Math.min(selectedIndex + 1, mediaQueue.length) : mediaQueue.length;
}

function setSelectedQueueAnchor(index) {
  selectedQueueAnchorIndex = queueIndexInRange(index) ? index : -1;
}

function updateQueueSelectionVisual() {
  const selectedIndex = selectedQueueIndexForDisplay();
  document.querySelectorAll(".queue-item[data-queue-index]").forEach((row) => {
    const index = Number.parseInt(row.getAttribute("data-queue-index"), 10);
    const isSelected = Number.isFinite(index) && index === selectedIndex;
    row.classList.toggle("is-selected", isSelected);
    if (isSelected) {
      row.dataset.selected = "true";
    } else {
      delete row.dataset.selected;
    }
  });
}

function shiftQueueIndexesForInsertion(insertIndex, count) {
  if (count <= 0) return;
  if (currentQueueIndex >= insertIndex) currentQueueIndex += count;
  if (previewCueIndex >= insertIndex) previewCueIndex += count;
  if (selectedQueueAnchorIndex >= insertIndex) selectedQueueAnchorIndex += count;
  if (previewAudioCueIndex >= insertIndex) previewAudioCueIndex += count;
  if (previewCueVideoIndex >= insertIndex) previewCueVideoIndex += count;
  if (liveAudioQueueIndex >= insertIndex) liveAudioQueueIndex += count;
  if (manualBoundaryPauseIndex >= insertIndex) manualBoundaryPauseIndex += count;
  if (
    Number.isInteger(pendingQueueSwitchIndex) &&
    pendingQueueSwitchIndex >= insertIndex
  ) {
    pendingQueueSwitchIndex += count;
  }
}

function insertQueueEntriesAfterSelection(entries) {
  const nextEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!nextEntries.length) return -1;
  const insertIndex = Math.max(
    0,
    Math.min(queueInsertionIndexAfterSelection(), mediaQueue.length),
  );
  mediaQueue.splice(insertIndex, 0, ...nextEntries);
  shiftQueueIndexesForInsertion(insertIndex, nextEntries.length);
  return insertIndex;
}

function insertQueueEntriesAt(entries, insertIndex) {
  const nextEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!nextEntries.length) return -1;
  const index = Math.max(0, Math.min(insertIndex, mediaQueue.length));
  mediaQueue.splice(index, 0, ...nextEntries);
  shiftQueueIndexesForInsertion(index, nextEntries.length);
  return index;
}

function queueDropInsertIndexFromEvent(list, event) {
  const row = event.target.closest(".queue-item[data-queue-index]");
  if (!row || !list.contains(row)) {
    return mediaQueue.length;
  }
  const idx = Number.parseInt(row.getAttribute("data-queue-index"), 10);
  if (Number.isNaN(idx)) return mediaQueue.length;
  const rect = row.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? idx + 1 : idx;
}

function ensureQueueDropIndicator(list) {
  if (!queueDropIndicator) {
    queueDropIndicator = document.createElement("div");
    queueDropIndicator.className = "queue-drop-indicator";
    queueDropIndicator.hidden = true;
    queueDropIndicator.setAttribute("aria-hidden", "true");
  }
  if (queueDropIndicator.parentNode !== list) {
    list.appendChild(queueDropIndicator);
  }
  return queueDropIndicator;
}

function updateQueueDropIndicator(list, insertIndex) {
  const indicator = ensureQueueDropIndicator(list);
  const rows = list.querySelectorAll(".queue-item[data-queue-index]");
  if (rows.length === 0) {
    indicator.style.top = "0px";
  } else if (insertIndex >= rows.length) {
    const lastRow = rows[rows.length - 1];
    indicator.style.top = `${lastRow.offsetTop + lastRow.offsetHeight}px`;
  } else {
    indicator.style.top = `${rows[insertIndex].offsetTop}px`;
  }
  indicator.hidden = false;
  queueDropIndicatorIndex = insertIndex;
}

function hideQueueDropIndicator() {
  if (queueDropIndicator) queueDropIndicator.hidden = true;
  queueDropIndicatorIndex = -1;
}

function clearSongDragVisualState() {
  songDragSongId = "";
  hideQueueDropIndicator();
  document.querySelectorAll(".songs-list-item--dragging").forEach((el) => {
    el.classList.remove("songs-list-item--dragging");
  });
  document.querySelectorAll(".songs-folder-item--drag-over").forEach((el) => {
    el.classList.remove("songs-folder-item--drag-over");
  });
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
    mediaQueue.length === 0 &&
    !hasPreviewSrc &&
    !hasImage &&
    !pptxVisible &&
    !bibleVisible;
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
  const selectedItem = queueIndexInRange(selectedQueueAnchorIndex)
    ? mediaQueue[selectedQueueAnchorIndex]
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
  if (selectedItem) {
    selectedQueueAnchorIndex = mediaQueue.findIndex((q) => q === selectedItem);
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
  const biblePresentationLive =
    isActiveMediaWindow() && activeMediaWindowContentType === "bible";
  const newEntries = paths.map(createQueueEntry);
  const firstNewIndex = insertQueueEntriesAfterSelection(newEntries);
  if (firstNewIndex < 0) return;
  renderQueue();
  void (async () => {
    await stampBaselineForQueueItems(newEntries);
    if (
      ((!isActiveMediaWindow() &&
        !isLocalAppWindowPresentationActive() &&
        currentQueueIndex < 0) ||
        biblePresentationLive) &&
      mediaQueue[firstNewIndex]
    ) {
      await onQueueItemActivate(firstNewIndex);
    }
  })().catch((err) => console.error(err));
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

function buildBibleTextMessage(entry = bibleDesignerState, opts = {}) {
  const style = {
    fontFamily: entry.fontFamily || bibleDesignerState.fontFamily,
    fontSize: Number.isFinite(entry.fontSize) ? entry.fontSize : bibleDesignerState.fontSize,
    autosizeMode: normalizeScriptureAutosizeMode(
      entry.autosizeMode || bibleDesignerState.autosizeMode,
    ),
    minFontSize: normalizeScriptureMinFontSize(
      Number.isFinite(entry.minFontSize) ? entry.minFontSize : bibleDesignerState.minFontSize,
      Number.isFinite(entry.fontSize) ? entry.fontSize : bibleDesignerState.fontSize,
    ),
    autoSplit:
      typeof entry.autoSplit === "boolean"
        ? entry.autoSplit
        : bibleDesignerState.autoSplit !== false,
    autosizeGroupFontSize: Number.isFinite(entry.autosizeGroupFontSize)
      ? normalizeScriptureFontSize(entry.autosizeGroupFontSize)
      : undefined,
    autosizeGroupScope:
      typeof entry.autosizeGroupScope === "string" ? entry.autosizeGroupScope : "",
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
  const attribution = entry.attribution || bibleAttributionForVersion(entry.version || "KJV");
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
    attribution,
    attributionText: "",
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
  const previewEntry = entry === bibleDesignerState ? bibleDesignerState : entry;
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

async function commitBibleDesignerRenderState({ rebuildLowerThird = false } = {}) {
  await syncBibleStateFromControls();
  resolveBibleLowerThirdState(bibleDesignerState, {
    rebuild: rebuildLowerThird,
    panel: bibleLowerThirdMeasurePanel(),
  });
  applyBiblePreview(bibleDesignerState, { show: false });
  if (await syncBibleDesignerStateToPreviewedQueueItem()) {
    saveMediaFile();
  }
  syncActiveScheduledBiblePresentation();
  void syncShowNowBiblePresentation().catch(console.error);
}

async function setBibleLowerThirdSegmentIndex(index) {
  if (!isBibleLowerThirdFeatureEnabled()) return false;
  await syncBibleStateFromControls();
  const resolvedEntry = await bibleEntryWithLookupText(bibleDesignerState);
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
  await commitBibleDesignerRenderState();
  return true;
}

async function changeBibleLowerThirdSegment(delta) {
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

async function nextBibleVerseEntryFromDesigner() {
  await syncBibleStateFromControls();
  const resolvedEntry = await bibleEntryWithLookupText(bibleDesignerState);
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
    textData = await bibleAPI.getText(bibleDesignerState.version, book, String(chapter));
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
    attribution: textData.attribution || bibleAttributionForVersion(bibleDesignerState.version),
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

async function advanceBibleDesignerToNextVerse() {
  const nextEntry = await nextBibleVerseEntryFromDesigner();
  if (!nextEntry) {
    showGnomeToast("End of chapter");
    return false;
  }
  Object.assign(bibleDesignerState, nextEntry);
  bibleVerseSelection.verses.clear();
  bibleVerseSelection.verses.add(nextEntry.verse);
  bibleVerseSelection.anchor = nextEntry.verse;
  syncBibleSelectorsFromState();
  void renderBibleVerseList();
  applyBiblePreview(bibleDesignerState, { show: false });
  window.requestAnimationFrame(scrollBibleViewerToCurrentVerse);
  if (await syncBibleDesignerStateToPreviewedQueueItem()) {
    saveMediaFile();
  }
  syncActiveScheduledBiblePresentation();
  void syncShowNowBiblePresentation().catch(console.error);
  return true;
}

async function advanceToNextScheduledBibleText() {
  const nextIndex = findNextScheduledBibleTextIndex(currentQueueIndex);
  if (nextIndex < 0) {
    showGnomeToast("No next scheduled Bible text");
    return false;
  }
  const nextEntry = await resolvedBibleEntryForItem(mediaQueue[nextIndex]);
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
  await syncBibleStateFromControls();
  const resolvedEntry = await bibleEntryWithLookupText(bibleDesignerState);
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

async function rebuildBibleLowerThirdSegments() {
  if (!isBibleLowerThirdFeatureEnabled()) return false;
  await syncBibleStateFromControls();
  const resolvedEntry = await bibleEntryWithLookupText(bibleDesignerState);
  if (resolvedEntry && resolvedEntry !== bibleDesignerState) {
    Object.assign(bibleDesignerState, resolvedEntry);
  }
  bibleDesignerState.lowerThirdSegmentIndex = 0;
  await commitBibleDesignerRenderState({ rebuildLowerThird: true });
  return true;
}

function showBibleWorkspace() {
  const workspace = document.getElementById("bibleWorkspace");
  const button = document.getElementById("openBibleWorkspaceBtn");
  if (!workspace) return;
  hideSongsWorkspace();
  hideSlidesWorkspace();
  syncLowerThirdFeatureAvailability();
  workspace.hidden = false;
  button?.setAttribute("data-active", "true");
  document.getElementById("previewEmptyState")?.setAttribute("hidden", "");
  document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
  setPreviewStackSurface(PREVIEW_SURFACE_BIBLE);
  installBibleWorkspaceEventGuards();
  pauseInactivePreviewBehindWorkspace();
}

function hideBibleWorkspace() {
  const workspace = document.getElementById("bibleWorkspace");
  const button = document.getElementById("openBibleWorkspaceBtn");
  if (workspace) workspace.hidden = true;
  button?.setAttribute("data-active", "false");
  syncPreviewStackSurface();
}

function showSongsWorkspace() {
  const workspace = document.getElementById("songsWorkspace");
  const button = document.getElementById("openSongsWorkspaceBtn");
  if (!workspace) return;
  hideBibleWorkspace();
  hideSlidesWorkspace();
  workspace.hidden = false;
  button?.setAttribute("data-active", "true");
  document.getElementById("previewEmptyState")?.setAttribute("hidden", "");
  document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
  setPreviewStackSurface(PREVIEW_SURFACE_SONGS);
  installSongsWorkspaceEventGuards();
  
  setMediaCountdownOverlayVisible(false);
  setMediaCountdownText("");
  pauseInactivePreviewBehindWorkspace();

  const launcher = document.getElementById("songsLauncher");
  const slide = document.getElementById("songsPreviewSlide");
  if (launcher && slide) {
    if (typeof currentWorkspaceSong !== 'undefined' && currentWorkspaceSong) {
      launcher.hidden = true;
      slide.hidden = false;
    } else {
      launcher.hidden = false;
      slide.hidden = true;
    }
  }
}

function hideSongsWorkspace() {
  const workspace = document.getElementById("songsWorkspace");
  const button = document.getElementById("openSongsWorkspaceBtn");
  if (workspace) workspace.hidden = true;
  button?.setAttribute("data-active", "false");
  syncPreviewStackSurface();
}

function showSlidesWorkspace() {
  const workspace = document.getElementById("slidesWorkspace");
  const button = document.getElementById("openSlidesWorkspaceBtn");
  if (!workspace) return;
  hideBibleWorkspace();
  hideSongsWorkspace();
  workspace.hidden = false;
  button?.setAttribute("data-active", "true");
  document.getElementById("previewEmptyState")?.setAttribute("hidden", "");
  document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
  setPreviewStackSurface(PREVIEW_SURFACE_SLIDES);
  installSlidesWorkspaceEventGuards();
  setMediaCountdownOverlayVisible(false);
  setMediaCountdownText("");
  pauseInactivePreviewBehindWorkspace();
}

function hideSlidesWorkspace() {
  const workspace = document.getElementById("slidesWorkspace");
  const button = document.getElementById("openSlidesWorkspaceBtn");
  if (workspace) workspace.hidden = true;
  button?.setAttribute("data-active", "false");
  syncPreviewStackSurface();
}

function isSlidesWorkspaceVisible() {
  return document.getElementById("slidesWorkspace")?.hidden === false;
}

function hideBiblePreview() {
  hideBibleWorkspace();
}

function installPreviewWorkspaceEventGuards(workspaceOrId) {
  const workspace =
    typeof workspaceOrId === "string"
      ? document.getElementById(workspaceOrId)
      : workspaceOrId;
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

function installBibleWorkspaceEventGuards() {
  installPreviewWorkspaceEventGuards("bibleWorkspace");
}

function installSongsWorkspaceEventGuards() {
  installPreviewWorkspaceEventGuards("songsWorkspace");
}

function installSlidesWorkspaceEventGuards() {
  installPreviewWorkspaceEventGuards("slidesWorkspace");
}

function isBibleWorkspaceVisible() {
  return document.getElementById("bibleWorkspace")?.hidden === false;
}

function isSongsWorkspaceVisible() {
  return document.getElementById("songsWorkspace")?.hidden === false;
}

function isPreviewWorkspaceOverlayVisible() {
  return (
    isBibleWorkspaceVisible() ||
    isSongsWorkspaceVisible() ||
    isSlidesWorkspaceVisible()
  );
}

function pauseInactivePreviewBehindWorkspace() {
  if (!isPreviewWorkspaceOverlayVisible()) return;
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
    console.error("Failed to pause hidden media preview behind workspace:", err);
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

async function lookupBibleReference(reference, version) {
  try {
    const passage = await bibleAPI.getPassage(version || "KJV", reference);
    if (passage && !passage.error && passage.reference && passage.text) {
      return {
        version: passage.version || version || "KJV",
        attribution: passage.attribution || bibleAttributionForVersion(passage.version || version || "KJV"),
        reference: passage.reference,
        text: passage.text,
        selectedVerses: Array.isArray(passage.selectedVerses)
          ? passage.selectedVerses
          : [],
        book: passage.book,
        chapter: passage.chapter,
        verse: passage.verse || 0,
        verseEnd: passage.verseEnd || 0,
        verseSelector: passage.verseSelector || "",
      };
    }
  } catch {}
  return null;
}

async function bibleEntryWithLookupText(entry = bibleDesignerState) {
  if (!entry?.reference) return entry;
  try {
    const result = await lookupBibleReference(entry.reference, entry.version);
    if (!result) return entry;
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
      book: result.book || entry.book || bibleDesignerState.book,
      chapter: Number.isFinite(result.chapter) ? result.chapter : entry.chapter,
      verse: selectedVerses[0] || result.verse || 0,
      verseEnd: contiguousSelection
        ? selectedVerses[selectedVerses.length - 1]
        : result.verseEnd || 0,
      selectedVerses,
    };
  } catch {
    return entry;
  }
}

async function syncBibleStateFromControls() {
  const versionSelect = document.getElementById("bibleVersionSelect");
  const referenceInput = document.getElementById("bibleReferenceInput");
  const lookSelect = document.getElementById("bibleLookSelect");
  const nextVersion = versionSelect?.value || bibleDesignerState.version;
  if (bibleDesignerState.version !== nextVersion) {
    bibleDesignerState.text = "";
    persistBibleVersion(nextVersion);
  }
  bibleDesignerState.version = nextVersion;
  bibleDesignerState.look = normalizeScriptureLook(lookSelect?.value || bibleDesignerState.look);
  const resolvedReference = await normalizeBibleReferenceInput(
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
  bibleDesignerState.attribution = bibleAttributionForVersion(bibleDesignerState.version);
  bibleDesignerState.transition = readSlideTransitionControls(
    "bibleTransitionEffectInput",
    "bibleTransitionDurationInput",
    { allowInherit: true },
  );
  syncBibleVersionAttributionDisplay();
  Object.assign(bibleDesignerState, getBibleDesignerStyle());
}

async function setBiblePreviewText(reference, text, opts = {}) {
  await syncBibleStateFromControls();
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
  void syncShowNowBiblePresentation().catch(console.error);
  return Boolean(bibleDesignerState.text);
}

// Double-clicking a verse (or verses) updates the preview as before. When
// another presentation is already live, it also behaves like a "show now"
// request: scripture-to-scripture swaps go live in place without interrupting
// the operator, while interrupting any other kind of live content first asks for
// confirmation using the same prompt the media queue uses.
async function presentBibleSelectionFromDoubleClick(verseNumber, fallbackText) {
  const selectedVerses = selectedBibleVerseNumbers();
  const isMultiSelection = selectedVerses.length > 1;
  const entry = isMultiSelection ? await bibleEntryFromSelectedVerses() : null;
  const reference = entry
    ? entry.reference
    : `${bibleDesignerState.book} ${bibleDesignerState.chapter}:${verseNumber}`;
  const referenceInput = document.getElementById("bibleReferenceInput");
  if (referenceInput) referenceInput.value = reference;

  if (entry) {
    await setBiblePreviewText(entry.reference, entry.text, {
      verse: entry.verse,
      verseEnd: entry.verseEnd,
    });
  } else {
    await setBiblePreviewText(reference, fallbackText, { verse: verseNumber, verseEnd: 0 });
  }

  const presentationActive =
    isQueuePresentationActive() ||
    isActiveMediaWindow() ||
    isLocalAppWindowPresentationActive() ||
    Boolean(isPlaying);
  // Nothing else is on screen: leave the verse as a preview (existing behavior).
  if (!presentationActive) return;
  // The live output already mirrors this selection (show-now mode, or editing the
  // live queue scripture in place); setBiblePreviewText() handled the update.
  if (biblePreviewMirrorsLiveOutput()) return;

  // A scripture is live but it isn't this selection (e.g. an unrelated live queue
  // verse): take the new selection live in place. No prompt for scripture swaps.
  if (isScripturePresentationLive()) {
    await showBibleTextNow();
    return;
  }

  // Something other than a scripture is live: confirm before interrupting it.
  const liveLabel = currentLivePresentationLabel();
  const accepted = window.confirm(
    liveLabel
      ? `Switch the live presentation from "${liveLabel}" to "${reference}"?`
      : `Switch the current presentation to "${reference}"?`,
  );
  if (!accepted) return;
  await showBibleTextNow();
}

function selectedBibleVerseNumbers() {
  return [...bibleVerseSelection.verses].sort((a, b) => a - b);
}

function bibleVerseNumberIsSelected(verseNumber) {
  const hasMultiSelection = bibleVerseSelection.verses.size > 0;
  if (hasMultiSelection) return bibleVerseSelection.verses.has(verseNumber);
  const selectedStart =
    Number.isFinite(bibleDesignerState.verse) && bibleDesignerState.verse > 0
      ? bibleDesignerState.verse
      : 0;
  const selectedEnd =
    Number.isFinite(bibleDesignerState.verseEnd) && bibleDesignerState.verseEnd > selectedStart
      ? bibleDesignerState.verseEnd
      : selectedStart;
  return verseNumber >= selectedStart && verseNumber <= selectedEnd;
}

function syncBibleVerseListSelection() {
  const list = document.getElementById("bibleVerseList");
  if (!list) return;
  list.querySelectorAll(".bible-verse-row").forEach((row) => {
    const verseNumber = Number.parseInt(row.dataset.verse || "", 10);
    if (!Number.isFinite(verseNumber)) return;
    const isSelected = bibleVerseNumberIsSelected(verseNumber);
    row.classList.toggle("is-selected", isSelected);
    row.setAttribute("aria-selected", isSelected ? "true" : "false");
  });
}

function cancelBibleVersePreviewSync() {
  if (!bibleVersePreviewTimer) return;
  window.clearTimeout(bibleVersePreviewTimer);
  bibleVersePreviewTimer = null;
}

function scheduleSelectedBibleVersePreview() {
  cancelBibleVersePreviewSync();
  bibleVersePreviewTimer = window.setTimeout(() => {
    bibleVersePreviewTimer = null;
    void applySelectedBibleVersePreview().catch(console.error);
  }, 140);
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

async function bibleEntryFromSelectedVerses() {
  const selectedVerses = selectedBibleVerseNumbers();
  if (selectedVerses.length === 0) return null;
  let textData = null;
  try {
    textData = await bibleAPI.getText(
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
    attribution: textData.attribution || bibleAttributionForVersion(bibleDesignerState.version),
    reference,
    text: selectedText,
    verse: verseStart,
    verseEnd: verseEnd > verseStart ? verseEnd : 0,
    selectedVerses,
  };
}

async function bibleEntryForSingleVerse(verseNumber) {
  if (!Number.isFinite(verseNumber) || verseNumber < 1) return null;
  let textData = null;
  try {
    textData = await bibleAPI.getText(
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
    attribution: textData.attribution || bibleAttributionForVersion(bibleDesignerState.version),
    reference: `${bibleDesignerState.book} ${bibleDesignerState.chapter}:${verseNumber}`,
    text,
    verse: verseNumber,
    verseEnd: 0,
  };
}

function queueEntryFromBibleEntry(entry) {
  const { transition, ...bible } = entry || {};
  const transitionOverride = normalizeItemSlideTransitionOverride(transition);
  const queueEntry = {
    path: bibleQueuePath(entry.reference, entry.version),
    name: `${entry.reference} ${entry.version}`.trim(),
    type: "bible",
    autoAdvance: false,
    cueStartTime: 0,
    bible: { ...bible },
  };
  if (transitionOverride) queueEntry.transition = transitionOverride;
  return queueEntry;
}

function bibleEntryTextForVerseRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  return rows.length === 1
    ? rows[0].text
    : rows.map(({ verseNumber, text }) => `${verseNumber}. ${text}`).join("\n");
}

function bibleSelectedVersesForEntry(entry = {}) {
  const explicit = normalizedProjectBibleSelectedVerses(entry.selectedVerses);
  if (explicit.length > 0) return explicit;
  const start = Number.isFinite(entry.verse) && entry.verse > 0 ? Math.trunc(entry.verse) : 0;
  const end =
    Number.isFinite(entry.verseEnd) && entry.verseEnd > start
      ? Math.trunc(entry.verseEnd)
      : start;
  if (start <= 0) return [];
  const verses = [];
  for (let verseNumber = start; verseNumber <= end; verseNumber += 1) {
    verses.push(verseNumber);
  }
  return verses;
}

async function bibleVerseRowsForEntry(entry = {}) {
  const selectedVerses = bibleSelectedVersesForEntry(entry);
  if (selectedVerses.length <= 1) return [];
  const book = entry.book || parseScriptureReference(entry.reference || "").book;
  const chapter = Number.isFinite(entry.chapter)
    ? entry.chapter
    : parseScriptureReference(entry.reference || "").chapter;
  if (!book || !Number.isFinite(chapter) || chapter < 1) return [];
  let textData = null;
  try {
    textData = await bibleAPI.getText(entry.version || "KJV", book, String(chapter));
  } catch (err) {
    console.error("Failed to load Bible verses for autofit split:", err);
    return [];
  }
  const verses = Array.isArray(textData?.verses) ? textData.verses : [];
  return selectedVerses
    .map((verseNumber) => ({
      verseNumber,
      text: verses[verseNumber - 1],
    }))
    .filter((row) => typeof row.text === "string" && row.text.trim());
}

function bibleEntryForVerseRows(baseEntry, rows) {
  const selectedVerses = rows.map((row) => row.verseNumber);
  const verseStart = selectedVerses[0] || 0;
  const verseEnd = selectedVerses[selectedVerses.length - 1] || 0;
  const book = baseEntry.book || parseScriptureReference(baseEntry.reference || "").book;
  const chapter = Number.isFinite(baseEntry.chapter)
    ? baseEntry.chapter
    : parseScriptureReference(baseEntry.reference || "").chapter;
  const reference =
    book && Number.isFinite(chapter) && chapter > 0
      ? referenceForBibleVerseNumbers(book, chapter, selectedVerses)
      : baseEntry.reference;
  const entry = {
    ...baseEntry,
    reference,
    text: bibleEntryTextForVerseRows(rows),
    verse: verseStart,
    verseEnd: verseEnd > verseStart ? verseEnd : 0,
    selectedVerses,
    lowerThirdSegments: [],
    lowerThirdSegmentIndex: 0,
    lowerThirdSourceText: "",
  };
  delete entry.autosizeGroupFontSize;
  return entry;
}

function bibleEntryAutofitOverflows(entry, outputSize = null) {
  const result = measureBibleEntryAutofit(entry, outputSize);
  return Boolean(result && !result.fits);
}

async function currentBibleScheduleOutputSize() {
  if (isActiveMediaWindow()) {
    const activeWindowSize = await refreshBiblePreviewMediaWindowSize();
    const normalizedActiveSize = normalizeBiblePreviewOutputSize(activeWindowSize);
    if (normalizedActiveSize) return normalizedActiveSize;
  }

  try {
    await populateDisplaySelect();
  } catch (err) {
    console.error("Failed to refresh display list for Bible autofit:", err);
  }
  return selectedBiblePreviewOutputSize("dspSelct");
}

function bibleAutosizeGroupScope(entries) {
  const references = (Array.isArray(entries) ? entries : [])
    .map((entry) => String(entry?.reference || "").trim())
    .filter(Boolean);
  if (references.length === 0) return "";
  if (references.length === 1) return `${references[0]} only`;
  const first = references[0];
  const last = references[references.length - 1];
  return `${first} through ${last} (${references.length} slides)`;
}

function normalizeBibleScheduleEntryGroup(entries, outputSize = null) {
  if (!Array.isArray(entries) || entries.length <= 1) return entries;
  const shouldNormalize = entries.some(
    (entry) => normalizeScriptureAutosizeMode(entry.autosizeMode) === SCRIPTURE_AUTOSIZE_NORMALIZE,
  );
  if (!shouldNormalize) return entries;
  const resolvedSizes = entries
    .map((entry) => {
      const measureEntry = { ...entry };
      delete measureEntry.autosizeGroupFontSize;
      return measureBibleEntryAutofit(measureEntry, outputSize)?.resolvedFontSize;
    })
    .filter((fontSize) => Number.isFinite(fontSize));
  if (!resolvedSizes.length) return entries;
  const groupFontSize = Math.min(...resolvedSizes);
  const autosizeGroupScope = bibleAutosizeGroupScope(entries);
  return entries.map((entry) => ({
    ...entry,
    autosizeMode: SCRIPTURE_AUTOSIZE_NORMALIZE,
    autosizeGroupFontSize: groupFontSize,
    autosizeGroupScope,
  }));
}

async function bibleEntriesWithAutofitSplits(entry, outputSize = null) {
  const hydratedEntry = hydrateBibleEntryStyle(entry);
  const fitOutputSize = normalizeBiblePreviewOutputSize(outputSize) || selectedBiblePreviewOutputSize("dspSelct");
  if (!bibleEntryAutofitOverflows(hydratedEntry, fitOutputSize)) {
    return normalizeBibleScheduleEntryGroup([hydratedEntry], fitOutputSize);
  }

  const rows = await bibleVerseRowsForEntry(hydratedEntry);
  if (rows.length <= 1) return normalizeBibleScheduleEntryGroup([hydratedEntry], fitOutputSize);

  const chunks = [];
  let currentRows = [];
  for (const row of rows) {
    const candidateRows = [...currentRows, row];
    const candidateEntry = bibleEntryForVerseRows(hydratedEntry, candidateRows);
    if (currentRows.length > 0 && bibleEntryAutofitOverflows(candidateEntry, fitOutputSize)) {
      chunks.push(currentRows);
      currentRows = [row];
    } else {
      currentRows = candidateRows;
    }
  }
  if (currentRows.length > 0) chunks.push(currentRows);

  const splitEntries = chunks.map((chunkRows) => bibleEntryForVerseRows(hydratedEntry, chunkRows));
  return normalizeBibleScheduleEntryGroup(
    splitEntries.length ? splitEntries : [hydratedEntry],
    fitOutputSize,
  );
}

async function queueEntriesForBibleScheduleEntry(entry) {
  const outputSize = await currentBibleScheduleOutputSize();
  const bibleEntries = await bibleEntriesWithAutofitSplits(entry, outputSize);
  return bibleEntries.map(queueEntryFromBibleEntry);
}

async function applySelectedBibleVersePreview() {
  const selectedEntry = await bibleEntryFromSelectedVerses();
  if (!selectedEntry) return false;
  Object.assign(bibleDesignerState, selectedEntry);
  const referenceInput = document.getElementById("bibleReferenceInput");
  if (referenceInput) referenceInput.value = selectedEntry.reference;
  applyBiblePreview(bibleDesignerState);
  syncActiveScheduledBiblePresentation();
  void syncShowNowBiblePresentation().catch(console.error);
  return true;
}

async function refreshBibleLookupPreview(opts = {}) {
  await syncBibleStateFromControls();
  const result = await lookupBibleReference(bibleDesignerState.reference, bibleDesignerState.version);
  if (!result) return false;
  Object.assign(bibleDesignerState, result, {
    book: result.book || bibleDesignerState.book,
    chapter: Number.isFinite(result.chapter) ? result.chapter : bibleDesignerState.chapter,
    verse: result.verse || 0,
    verseEnd: result.verseEnd || 0,
    ...getBibleDesignerStyle(),
  });
  applyBiblePreview(bibleDesignerState);
  if (opts.liveSync !== false) {
    syncActiveScheduledBiblePresentation();
    void syncShowNowBiblePresentation().catch(console.error);
  }
  return true;
}

async function currentBibleQueueEntry() {
  await syncBibleStateFromControls();
  const selectedEntry = await bibleEntryFromSelectedVerses();
  if (selectedEntry) {
    Object.assign(bibleDesignerState, selectedEntry);
    return queueEntryFromBibleEntry(selectedEntry);
  }
  const refreshed = await refreshBibleLookupPreview({ liveSync: false });
  if (!bibleDesignerState.text && !refreshed) {
    return null;
  }
  return queueEntryFromBibleEntry(bibleDesignerState);
}

async function currentBibleTextOnlyEntry() {
  await syncBibleStateFromControls();
  const selectedEntry = await bibleEntryFromSelectedVerses();
  if (selectedEntry) {
    Object.assign(bibleDesignerState, selectedEntry);
  } else {
    const refreshed = await refreshBibleLookupPreview({ liveSync: false });
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

async function sendBibleTextToOutput(entry = bibleDesignerState) {
  const resolvedEntry = await bibleEntryWithLookupText(entry);
  setLastShownBibleStyleOverrides(bibleStyleSnapshot(resolvedEntry));
  const message = buildBibleTextMessage(resolvedEntry, {
    look: SCRIPTURE_LOOK_FULLSCREEN,
  });
  const liveQueueItem =
    isQueuePlaying &&
    currentQueueIndex >= 0 &&
    currentQueueIndex < mediaQueue.length &&
    isQueueItemBible(mediaQueue[currentQueueIndex])
      ? mediaQueue[currentQueueIndex]
      : null;
  if (liveQueueItem) {
    message.transition = slideTransitionPayloadForQueueItem(liveQueueItem);
  }
  send("update-text", message);
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
      autosizeMode: "",
      minFontSize: undefined,
      autoSplit: undefined,
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
    autosizeMode:
      typeof overrides.autosizeMode === "string" && overrides.autosizeMode
        ? normalizeScriptureAutosizeMode(overrides.autosizeMode)
        : "",
    minFontSize:
      Number.isFinite(overrides.minFontSize)
        ? normalizeScriptureMinFontSize(overrides.minFontSize, overrides.fontSize)
        : undefined,
    autoSplit:
      typeof overrides.autoSplit === "boolean" ? overrides.autoSplit : undefined,
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
    !normalized.autosizeMode &&
    !Number.isFinite(normalized.minFontSize) &&
    typeof normalized.autoSplit !== "boolean" &&
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
          autosizeMode: normalized.autosizeMode || undefined,
          minFontSize: Number.isFinite(normalized.minFontSize)
            ? normalized.minFontSize
            : undefined,
          autoSplit:
            typeof normalized.autoSplit === "boolean" ? normalized.autoSplit : undefined,
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
      autosizeMode: normalized.autosizeMode || undefined,
      minFontSize: Number.isFinite(normalized.minFontSize)
        ? normalized.minFontSize
        : undefined,
      autoSplit:
        typeof normalized.autoSplit === "boolean" ? normalized.autoSplit : undefined,
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
    autosizeMode:
      typeof presentation.autosizeMode === "string"
        ? presentation.autosizeMode
        : typeof typography.autosizeMode === "string"
          ? typography.autosizeMode
          : "",
    minFontSize:
      Number.isFinite(presentation.minFontSize)
        ? presentation.minFontSize
        : Number.isFinite(typography.minFontSize)
          ? typography.minFontSize
          : undefined,
    autoSplit:
      typeof presentation.autoSplit === "boolean"
        ? presentation.autoSplit
        : typeof typography.autoSplit === "boolean"
          ? typography.autoSplit
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
  if (typeof filePath !== "string" || filePath.length === 0) return "Choose Background…";
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

function bibleQueueItemBaseEntry(item) {
  if (!isQueueItemBible(item)) return null;
  const pathEntry = parseBibleQueuePath(item.path);
  return {
    ...(item?.bible && typeof item.bible === "object" ? item.bible : {}),
    ...(pathEntry || {}),
  };
}

async function resolveBibleQueueItemEntry(item) {
  const baseEntry = bibleQueueItemBaseEntry(item);
  if (!baseEntry) return null;
  const pathEntry = parseBibleQueuePath(item.path);
  const resolvedEntry = await bibleEntryWithLookupText(baseEntry);
  if (!resolvedEntry?.reference) return null;
  return {
    ...resolvedEntry,
    version: resolvedEntry.version || pathEntry?.version || "KJV",
    reference: resolvedEntry.reference || pathEntry?.reference || "",
  };
}

function resolveBibleQueueItemEntryShallow(item) {
  const baseEntry = bibleQueueItemBaseEntry(item);
  if (!baseEntry?.reference) return null;
  const pathEntry = parseBibleQueuePath(item.path);
  return {
    ...baseEntry,
    version: baseEntry.version || pathEntry?.version || "KJV",
    reference: baseEntry.reference || pathEntry?.reference || "",
  };
}

function resolvedBibleStyleDefaults() {
  return {
    fontFamily: projectScriptureOverrides.fontFamily || SCRIPTURE_FONT_FAMILY,
    fontSize: Number.isFinite(projectScriptureOverrides.fontSize)
      ? projectScriptureOverrides.fontSize
      : SCRIPTURE_BODY_FONT_SIZE,
    autosizeMode: normalizeScriptureAutosizeMode(projectScriptureOverrides.autosizeMode),
    minFontSize: Number.isFinite(projectScriptureOverrides.minFontSize)
      ? normalizeScriptureMinFontSize(
          projectScriptureOverrides.minFontSize,
          Number.isFinite(projectScriptureOverrides.fontSize)
            ? projectScriptureOverrides.fontSize
            : SCRIPTURE_BODY_FONT_SIZE,
        )
      : SCRIPTURE_MIN_BODY_FONT_SIZE,
    autoSplit:
      typeof projectScriptureOverrides.autoSplit === "boolean"
        ? projectScriptureOverrides.autoSplit
        : true,
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

function normalizedProjectBibleVersion(value, fallback = "KJV") {
  const version = bibleVersionValue(value || fallback || "KJV");
  return typeof version === "string" && version.trim() ? version.trim() : "KJV";
}

function normalizedProjectBibleSelectedVerses(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const verseNumber = Math.trunc(n);
    if (verseNumber <= 0 || seen.has(verseNumber)) return;
    seen.add(verseNumber);
    result.push(verseNumber);
  });
  return result;
}

function projectBibleReferenceOnlyEntry(entry = {}, opts = {}) {
  const source = entry && typeof entry === "object" ? entry : {};
  const pathEntry = opts?.pathEntry && typeof opts.pathEntry === "object"
    ? opts.pathEntry
    : {};
  const defaults = resolvedBibleStyleDefaults();
  const selectedVerses = normalizedProjectBibleSelectedVerses(source.selectedVerses);
  const reference = normalizeScriptureReference(
    source.reference || pathEntry.reference || "",
  );
  const result = {
    version: normalizedProjectBibleVersion(source.version, pathEntry.version || "KJV"),
    reference,
    book: typeof source.book === "string" ? source.book : "",
    chapter: Number.isFinite(source.chapter) ? source.chapter : 1,
    verse: Number.isFinite(source.verse) ? source.verse : 0,
    verseEnd: Number.isFinite(source.verseEnd) ? source.verseEnd : 0,
    verseSelector: typeof source.verseSelector === "string" ? source.verseSelector : "",
    fontFamily:
      typeof source.fontFamily === "string" && source.fontFamily
        ? source.fontFamily
        : defaults.fontFamily,
    fontSize: Number.isFinite(source.fontSize) ? source.fontSize : defaults.fontSize,
    autosizeMode: normalizeScriptureAutosizeMode(source.autosizeMode || defaults.autosizeMode),
    minFontSize: Number.isFinite(source.minFontSize)
      ? normalizeScriptureMinFontSize(
          source.minFontSize,
          Number.isFinite(source.fontSize) ? source.fontSize : defaults.fontSize,
        )
      : defaults.minFontSize,
    autoSplit:
      typeof source.autoSplit === "boolean" ? source.autoSplit : defaults.autoSplit,
    autosizeGroupFontSize: Number.isFinite(source.autosizeGroupFontSize)
      ? normalizeScriptureFontSize(source.autosizeGroupFontSize)
      : undefined,
    autosizeGroupScope:
      typeof source.autosizeGroupScope === "string" ? source.autosizeGroupScope : "",
    color:
      typeof source.color === "string" && source.color
        ? source.color
        : defaults.color,
    backgroundColor:
      typeof source.backgroundColor === "string" && source.backgroundColor
        ? source.backgroundColor
        : defaults.backgroundColor,
    backgroundPath:
      typeof source.backgroundPath === "string"
        ? source.backgroundPath
        : defaults.backgroundPath,
    lowerThirdColor:
      typeof source.lowerThirdColor === "string" && source.lowerThirdColor
        ? source.lowerThirdColor
        : defaults.lowerThirdColor,
    lowerThirdChromaKeyColor:
      typeof source.lowerThirdChromaKeyColor === "string" && source.lowerThirdChromaKeyColor
        ? source.lowerThirdChromaKeyColor
        : defaults.lowerThirdChromaKeyColor,
    look: normalizeScriptureLook(source.look || defaults.look),
    lowerThirdSegmentIndex: Number.isFinite(source.lowerThirdSegmentIndex)
      ? Math.max(0, Math.trunc(source.lowerThirdSegmentIndex))
      : 0,
  };
  if (selectedVerses.length > 0) result.selectedVerses = selectedVerses;
  return result;
}

function projectBibleReferenceEntryForQueueItem(item) {
  const pathEntry = parseBibleQueuePath(item?.path);
  return projectBibleReferenceOnlyEntry(
    item?.bible && typeof item.bible === "object" ? item.bible : {},
    { pathEntry },
  );
}

function projectBibleQueueName(entry) {
  return `${entry?.reference || ""} ${entry?.version || "KJV"}`.trim() || "Bible";
}

function hydrateBibleEntryStyle(entry = {}) {
  const defaults = resolvedBibleStyleDefaults();
  return {
    ...defaults,
    ...entry,
    attribution: entry?.attribution || bibleAttributionForVersion(entry?.version || "KJV"),
    fontFamily:
      typeof entry?.fontFamily === "string" && entry.fontFamily.trim()
        ? entry.fontFamily
        : defaults.fontFamily,
    fontSize: Number.isFinite(entry?.fontSize) ? entry.fontSize : defaults.fontSize,
    autosizeMode: normalizeScriptureAutosizeMode(entry?.autosizeMode || defaults.autosizeMode),
    minFontSize: Number.isFinite(entry?.minFontSize)
      ? normalizeScriptureMinFontSize(
          entry.minFontSize,
          Number.isFinite(entry?.fontSize) ? entry.fontSize : defaults.fontSize,
        )
      : defaults.minFontSize,
    autoSplit:
      typeof entry?.autoSplit === "boolean" ? entry.autoSplit : defaults.autoSplit,
    autosizeGroupFontSize: Number.isFinite(entry?.autosizeGroupFontSize)
      ? normalizeScriptureFontSize(entry.autosizeGroupFontSize)
      : undefined,
    autosizeGroupScope:
      typeof entry?.autosizeGroupScope === "string" ? entry.autosizeGroupScope : "",
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

async function resolvedBibleEntryForItem(item) {
  const resolvedEntry = await resolveBibleQueueItemEntry(item);
  if (resolvedEntry) {
    return {
      ...hydrateBibleEntryStyle(resolvedEntry),
      transition: item?.transition || DEFAULT_ITEM_SLIDE_TRANSITION,
    };
  }
  const pathEntry = parseBibleQueuePath(item?.path);
  const baseEntry = {
    ...(item?.bible && typeof item.bible === "object" ? item.bible : {}),
    ...(pathEntry || {}),
  };
  return {
    ...hydrateBibleEntryStyle(await bibleEntryWithLookupText(baseEntry)),
    transition: item?.transition || DEFAULT_ITEM_SLIDE_TRANSITION,
  };
}

function bibleEntryMatchesQueueItemShallow(entry, item) {
  if (!entry || !isQueueItemBible(item)) return false;
  const itemEntry = resolveBibleQueueItemEntryShallow(item);
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

async function bibleEntryMatchesQueueItem(entry, item) {
  if (!entry || !isQueueItemBible(item)) return false;
  const itemEntry = (await resolveBibleQueueItemEntry(item)) || resolveBibleQueueItemEntryShallow(item);
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
  return !targetItem || !bibleEntryMatchesQueueItemShallow(bibleDesignerState, targetItem);
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

async function loadBibleEntryIntoEditor(entry = bibleDesignerState, opts = {}) {
  const resolvedEntry = hydrateBibleEntryStyle(await bibleEntryWithLookupText(entry));
  if (
    typeof opts?.previewLoadToken === "number" &&
    !isCurrentPreviewLoad(opts.previewLoadToken)
  ) {
    return false;
  }
  Object.assign(bibleDesignerState, resolvedEntry);
  setBibleDesignerVersion(bibleDesignerState.version, { syncControls: false });
  setBibleVerseSelectionFromEntry(bibleDesignerState);
  syncBibleSelectorsFromState();
  syncBibleStyleControlsFromState();
  syncBibleBackgroundLabel(bibleDesignerState.backgroundPath);
  void renderBibleVerseList();
  if (opts.scroll !== false) {
    window.requestAnimationFrame(scrollBibleViewerToCurrentVerse);
  }
  applyBiblePreview(bibleDesignerState);
  return true;
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

async function syncBibleDesignerStateToPreviewedQueueItem() {
  const targetIndex = currentBibleEditorTargetIndex();
  if (targetIndex < 0) return false;
  const entry = await currentBibleQueueEntry();
  if (!entry) return false;
  if (!(await bibleEntryMatchesQueueItem(entry.bible, mediaQueue[targetIndex]))) return false;
  const transitionOverride = normalizeItemSlideTransitionOverride(entry.bible.transition);
  const { transition, ...bible } = entry.bible;
  const updatedItem = {
    ...mediaQueue[targetIndex],
    path: entry.path,
    name: entry.name,
    type: "bible",
    bible: { ...bible },
  };
  if (transitionOverride) {
    updatedItem.transition = transitionOverride;
  } else {
    delete updatedItem.transition;
  }
  mediaQueue[targetIndex] = updatedItem;
  renderQueue();
  return true;
}

async function applyBibleBackgroundToAllProjectText() {
  await syncBibleStateFromControls();
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
    const entry = resolveBibleQueueItemEntryShallow(item);
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
  void syncShowNowBiblePresentation().catch(console.error);
  showGnomeToast(
    changedCount > 0
      ? `Applied background to ${changedCount} Bible text item${changedCount === 1 ? "" : "s"}`
      : commitProjectStyle
        ? "Background will apply to new Bible text"
        : "No scheduled Bible text to update",
  );
}

async function applyBibleTextColorToAllProjectText() {
  await syncBibleStateFromControls();
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
    const entry = resolveBibleQueueItemEntryShallow(item);
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
  void syncShowNowBiblePresentation().catch(console.error);
  showGnomeToast(
    changedCount > 0
      ? `Applied text color to ${changedCount} Bible text item${changedCount === 1 ? "" : "s"}`
      : commitProjectStyle
        ? "Text color will apply to new Bible text"
        : "No scheduled Bible text to update",
  );
}

async function applyBibleFontToAllProjectText() {
  await syncBibleStateFromControls();
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
    const entry = resolveBibleQueueItemEntryShallow(item);
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
  void syncShowNowBiblePresentation().catch(console.error);
  showGnomeToast(
    changedCount > 0
      ? `Applied font to ${changedCount} Bible text item${changedCount === 1 ? "" : "s"}`
      : commitProjectStyle
        ? "Font will apply to new Bible text"
        : "No scheduled Bible text to update",
  );
}

async function applyBibleFontSizeToAllProjectText() {
  await syncBibleStateFromControls();
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
    const entry = resolveBibleQueueItemEntryShallow(item);
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
  void syncShowNowBiblePresentation().catch(console.error);
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
    autosizeMode: style.autosizeMode,
    minFontSize: style.minFontSize,
    autoSplit: style.autoSplit,
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
    autosizeGroupFontSize: undefined,
    autosizeGroupScope: "",
    lowerThirdSegments: [],
    lowerThirdSegmentIndex: 0,
    lowerThirdSourceText: "",
  };
}

function clearBibleStyleDirtyState() {
  bibleStyleDirtyState.fontFamily = false;
  bibleStyleDirtyState.fontSize = false;
  bibleStyleDirtyState.autosizeMode = false;
  bibleStyleDirtyState.minFontSize = false;
  bibleStyleDirtyState.autoSplit = false;
  bibleStyleDirtyState.color = false;
  bibleStyleDirtyState.backgroundColor = false;
  bibleStyleDirtyState.backgroundPath = false;
  bibleStyleDirtyState.lowerThirdColor = false;
  bibleStyleDirtyState.lowerThirdChromaKeyColor = false;
}

async function applyBibleStyleToCurrentText() {
  await syncBibleStateFromControls();
  const style = bibleCurrentStylePayload();
  Object.assign(bibleDesignerState, applyBibleStylePayloadToEntry(bibleDesignerState, style));
  clearBibleStyleDirtyState();
  await commitBibleDesignerRenderState({ rebuildLowerThird: true });
  showGnomeToast("Applied style to current Bible text");
}

async function applyBibleStyleToScheduledText() {
  await syncBibleStateFromControls();
  const style = bibleCurrentStylePayload();
  const transitionOverride = normalizeItemSlideTransitionOverride(bibleDesignerState.transition);
  Object.assign(bibleDesignerState, applyBibleStylePayloadToEntry(bibleDesignerState, style));
  clearBibleStyleDirtyState();

  let changedCount = 0;
  mediaQueue.forEach((item) => {
    if (!isQueueItemBible(item)) return;
    const entry = resolveBibleQueueItemEntryShallow(item);
    item.bible = applyBibleStylePayloadToEntry(entry || item.bible || {}, style);
    if (entry?.reference) {
      item.path = bibleQueuePath(entry.reference, entry.version);
      item.name = `${entry.reference} ${entry.version}`.trim();
      item.type = "bible";
    }
    if (transitionOverride) {
      item.transition = transitionOverride;
    } else {
      delete item.transition;
    }
    changedCount += 1;
  });

  renderQueue();
  applyBiblePreview(bibleDesignerState, { show: false });
  if (changedCount > 0) {
    void saveCurrentProjectInStorageMode({ quiet: true });
  }
  syncActiveScheduledBiblePresentation();
  void syncShowNowBiblePresentation().catch(console.error);
  showGnomeToast(
    changedCount > 0
      ? `Applied style to ${changedCount} scheduled Bible text item${changedCount === 1 ? "" : "s"}`
      : "No scheduled Bible text to update",
  );
}

async function useBibleStyleAsDefaults() {
  await syncBibleStateFromControls();
  const style = bibleCurrentStylePayload();
  Object.assign(projectScriptureOverrides, style);
  Object.assign(bibleDesignerState, applyBibleStylePayloadToEntry(bibleDesignerState, style));
  clearBibleStyleDirtyState();
  applyBiblePreview(bibleDesignerState, { show: false });
  void saveCurrentProjectInStorageMode({ quiet: true });
  void syncShowNowBiblePresentation().catch(console.error);
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

async function syncShowNowBiblePresentation() {
  if (
    !isBibleShowNowLiveMode() &&
    !(bibleShowNowModeActive && (bibleLowerThirdOutputActive || hasLowerThirdOutputSelected()))
  ) {
    return false;
  }
  const entry = await currentBibleTextOnlyEntry();
  if (!entry) return false;
  const transientEntry = bibleEntryWithShowNowStyle(entry);
  if (isBibleShowNowLiveMode()) {
    await sendBibleTextToOutput(transientEntry.bible);
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
  const entry = await currentBibleTextOnlyEntry();
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
        clearSongShowNowPresentation();
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
    clearSongShowNowPresentation();
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
    const result = await invoke("write-project-file", {
      filePath: currentProjectPath,
      data,
      mode: currentProjectStorageMode === "packed" ? "packed" : "working",
      activateProject: true,
    });
    currentProjectGuid = normalizeProjectGuid(result?.projectGuid) || currentProjectGuid;
    if (typeof result?.projectCreated === "string" && result.projectCreated.length > 0) {
      currentProjectCreated = result.projectCreated;
    }
    scheduleAutosaveProjectState();
    refreshBaselinesAfterSave();
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
  await sendBibleTextToOutput(entry);
  return true;
}

async function syncLiveBiblePresentation() {
  const audienceLive = isActiveMediaWindow() && activeMediaWindowContentType === "bible";
  if (!audienceLive && !bibleLowerThirdOutputActive && !hasLowerThirdOutputSelected()) {
    return false;
  }
  const targetIsLiveItem = isBibleEditorTargetLiveItem();
  const entry = targetIsLiveItem ? await currentBibleQueueEntry() : await currentBibleTextOnlyEntry();
  if (!entry) return false;
  if (
    targetIsLiveItem &&
    isQueuePlaying &&
    currentQueueIndex >= 0 &&
    currentQueueIndex < mediaQueue.length &&
    isQueueItemBible(mediaQueue[currentQueueIndex])
  ) {
    const liveItem = mediaQueue[currentQueueIndex];
    if (!(await bibleEntryMatchesQueueItem(entry.bible, liveItem))) {
      return false;
    }
    const transitionOverride = normalizeItemSlideTransitionOverride(entry.bible.transition);
    const { transition, ...bible } = entry.bible;
    const updatedItem = {
      ...liveItem,
      path: entry.path,
      name: entry.name,
      type: "bible",
      bible: { ...bible },
    };
    if (transitionOverride) {
      updatedItem.transition = transitionOverride;
    } else {
      delete updatedItem.transition;
    }
    mediaQueue[currentQueueIndex] = updatedItem;
    renderQueue();
    saveMediaFile();
  }
  if (audienceLive) {
    await sendBibleTextToOutput(entry.bible);
  }
  if (hasLowerThirdOutputSelected()) {
    await ensureBibleLowerThirdOutput(entry.bible);
  } else if (bibleLowerThirdOutputActive) {
    await closeBibleLowerThirdOutput();
  }
  return true;
}

async function insertBibleInSchedule() {
  const entry = await currentBibleQueueEntry();
  if (!entry) return;
  const entries = await queueEntriesForBibleScheduleEntry(entry.bible);
  invalidateQueueUndoToastAfterMutation();
  insertQueueEntriesAfterSelection(entries);
  renderQueue();
  saveMediaFile();
  showGnomeToast(
    entries.length > 1
      ? `Scheduled ${entries.length} Bible slides`
      : `Scheduled ${entries[0]?.name || entry.name}`,
  );
}

async function addSelectedBibleVersesToSchedule() {
  const entry = await currentBibleQueueEntry();
  if (!entry) {
    showGnomeToast("Choose Bible text to schedule");
    return false;
  }
  const entries = await queueEntriesForBibleScheduleEntry(entry.bible);
  invalidateQueueUndoToastAfterMutation();
  insertQueueEntriesAfterSelection(entries);
  renderQueue();
  saveMediaFile();
  showGnomeToast(
    entries.length > 1
      ? `Scheduled ${entries.length} Bible slides`
      : `Scheduled ${entries[0]?.name || entry.name}`,
  );
  return true;
}

async function addEachSelectedBibleVerseToSchedule() {
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

  const entries = (await Promise.all(
    versesToSchedule.map((verseNumber) => bibleEntryForSingleVerse(verseNumber)),
  ))
    .filter(Boolean);
  const queueEntries = normalizeBibleScheduleEntryGroup(entries).map(queueEntryFromBibleEntry);
  if (!queueEntries.length) {
    showGnomeToast("No Bible verses found");
    return false;
  }

  invalidateQueueUndoToastAfterMutation();
  insertQueueEntriesAfterSelection(queueEntries);
  renderQueue();
  saveMediaFile();
  showGnomeToast(
    `Scheduled ${queueEntries.length} Bible verse${queueEntries.length === 1 ? "" : "s"}`,
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
    <button type="button" role="menuitem" data-bible-text-action="browse">Browse Chapter</button>
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
    if (action === "browse") {
      void browseCurrentBibleChapter().catch(console.error);
    } else if (action === "show") {
      void showBibleTextNow().catch(console.error);
    } else if (action === "add") {
      void insertBibleInSchedule().catch(console.error);
    } else if (action === "add-selected") {
      void addSelectedBibleVersesToSchedule().catch(console.error);
    } else if (action === "add-each") {
      void addEachSelectedBibleVerseToSchedule().catch(console.error);
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

function normalizeBibleVersionMetadata(version) {
  if (typeof version === "string") {
    return {
      abbreviation: version,
      version,
      attribution: {
        abbreviation: version,
        version,
        shortText: version,
        text: version,
        publicDomain: false,
      },
    };
  }
  const abbreviation = bibleVersionValue(version);
  const fullName = String(version?.version || version?.name || abbreviation);
  const attribution = version?.attribution && typeof version.attribution === "object"
    ? version.attribution
    : {};
  return {
    ...version,
    abbreviation,
    version: fullName,
    attribution: {
      abbreviation,
      version: fullName,
      shortText: String(attribution.shortText || abbreviation),
      text: String(attribution.text || fullName || abbreviation),
      publicDomain: Boolean(attribution.publicDomain),
      ...attribution,
    },
  };
}

function setBibleVersionMetadata(versions) {
  bibleVersionMetadataByKey.clear();
  normalizedBibleVersions(versions).forEach((version) => {
    const metadata = normalizeBibleVersionMetadata(version);
    bibleVersionMetadataByKey.set(metadata.abbreviation, metadata);
  });
}

async function loadBibleVersionMetadataFromSidecar() {
  const rawVersions = await bibleAPI.getVersions();
  const versions = normalizedBibleVersions(rawVersions)
    .map(normalizeBibleVersionMetadata)
    .sort((left, right) => left.abbreviation.localeCompare(right.abbreviation));
  setBibleVersionMetadata(versions);
  return versions;
}

function bibleVersionMetadata(version = bibleDesignerState.version) {
  const key = bibleVersionValue(version || bibleDesignerState.version || "KJV");
  return bibleVersionMetadataByKey.get(key) || normalizeBibleVersionMetadata(key);
}

function bibleAttributionForVersion(version = bibleDesignerState.version) {
  return bibleVersionMetadata(version).attribution || null;
}

async function readStoredBibleVersion() {
  try {
    const fromSettings = await invoke("get-setting", LAST_BIBLE_VERSION_SETTING_KEY);
    if (typeof fromSettings === "string" && fromSettings.trim()) {
      return fromSettings.trim();
    }
  } catch (err) {
    console.error("Failed to read last Bible version setting:", err);
  }
  return "";
}

async function resolveStoredBibleVersion(availableVersions = []) {
  const stored = bibleVersionValue(await readStoredBibleVersion());
  if (
    stored &&
    (!Array.isArray(availableVersions) ||
      availableVersions.length === 0 ||
      bibleVersionIsInstalled(stored, availableVersions))
  ) {
    return stored;
  }
  return DEFAULT_BIBLE_VERSION;
}

function bibleVersionIsInstalled(version, availableVersions = []) {
  const normalized = normalizedProjectBibleVersion(version);
  if (!Array.isArray(availableVersions) || availableVersions.length === 0) {
    return true;
  }
  const available = new Set(
    availableVersions.map((entry) =>
      normalizedProjectBibleVersion(
        typeof entry === "string" ? entry : entry?.abbreviation,
      ),
    ),
  );
  return available.has(normalized);
}

function persistBibleVersion(version) {
  const normalized = bibleVersionValue(version || "");
  if (!normalized) return;
  invoke("remember-last-bible-version", normalized).catch((err) => {
    console.error("remember-last-bible-version failed:", err);
  });
}

function setBibleDesignerVersion(version, opts = {}) {
  const normalized = normalizedProjectBibleVersion(version || DEFAULT_BIBLE_VERSION);
  bibleDesignerState.version = normalized;
  bibleDesignerState.attribution = bibleAttributionForVersion(normalized);
  if (opts.persist !== false) {
    persistBibleVersion(normalized);
  }
  if (opts.syncControls) {
    syncBibleSelectorsFromState();
  }
  return normalized;
}

async function restoreBibleVersionFromSettings(availableVersions = null) {
  const versions =
    availableVersions ??
    (await loadBibleVersionMetadataFromSidecar().catch(() => []));
  setBibleDesignerVersion(await resolveStoredBibleVersion(versions), {
    persist: false,
    syncControls: true,
  });
  return bibleDesignerState.version;
}

function bibleAttributionText(attribution, fallbackVersion = "") {
  if (typeof attribution === "string") return attribution.trim();
  if (attribution && typeof attribution === "object") {
    return String(
      attribution.text ||
        attribution.copyrightInfo ||
        attribution.copyright ||
        attribution.shortText ||
        fallbackVersion ||
        "",
    ).trim();
  }
  return String(fallbackVersion || "").trim();
}

function bibleAttributionFooterText(attribution, fallbackVersion = "") {
  if (attribution && typeof attribution === "object" && attribution.publicDomain === true) {
    return "";
  }
  return bibleAttributionText(attribution, fallbackVersion);
}

function bibleAttributionForResult(result) {
  return result?.attribution || bibleAttributionForVersion(result?.version);
}

function syncBibleVersionAttributionDisplay() {
  const attributionEl = document.getElementById("bibleVersionAttribution");
  if (!attributionEl) return;
  const attribution = bibleAttributionForVersion(bibleDesignerState.version);
  const text = bibleAttributionText(attribution, bibleDesignerState.version);
  attributionEl.textContent = text;
  attributionEl.title = text;
  attributionEl.hidden = !text;
  bibleDesignerState.attribution = attribution;
}

function syncBibleSelectorsFromState() {
  const versionSelect = document.getElementById("bibleVersionSelect");
  const referenceInput = document.getElementById("bibleReferenceInput");
  if (versionSelect) versionSelect.value = bibleDesignerState.version;
  if (referenceInput) referenceInput.value = bibleDesignerState.reference;
  syncBibleVersionAttributionDisplay();
}

function syncBibleStyleControlsFromState() {
  const fontInput = document.getElementById("bibleFontInput");
  const fontSizeInput = document.getElementById("bibleFontSizeInput");
  const autosizeModeInput = document.getElementById("bibleAutosizeModeInput");
  const minFontSizeInput = document.getElementById("bibleMinFontSizeInput");
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
  if (autosizeModeInput) {
    autosizeModeInput.value = normalizeScriptureAutosizeMode(bibleDesignerState.autosizeMode);
  }
  if (minFontSizeInput) {
    minFontSizeInput.value = normalizeScriptureMinFontSize(
      bibleDesignerState.minFontSize,
      bibleDesignerState.fontSize,
    );
  }
  if (textColorInput) textColorInput.value = bibleDesignerState.color;
  if (backgroundColorInput) backgroundColorInput.value = bibleDesignerState.backgroundColor;
  if (lowerThirdColorInput) lowerThirdColorInput.value = bibleDesignerState.lowerThirdColor;
  if (lowerThirdChromaKeyInput) {
    lowerThirdChromaKeyInput.value = bibleDesignerState.lowerThirdChromaKeyColor;
  }
  if (lookSelect) lookSelect.value = normalizeScriptureLook(bibleDesignerState.look);
  syncSlideTransitionControls(
    "bibleTransitionEffectInput",
    "bibleTransitionDurationInput",
    bibleDesignerState.transition,
    { allowInherit: true },
  );
}

function clearBibleSearchTimer() {
  if (!bibleSearchTimer) return;
  window.clearTimeout(bibleSearchTimer);
  bibleSearchTimer = null;
}

function bibleSearchScopeVersion() {
  return bibleSearchState.scope === "all" ? "*" : bibleDesignerState.version || "KJV";
}

function syncBibleSearchControlsFromState() {
  const searchInput = document.getElementById("bibleSearchInput");
  const scopeSelect = document.getElementById("bibleSearchScopeSelect");
  const browseButton = document.getElementById("bibleBrowseModeBtn");
  const searchButton = document.getElementById("bibleSearchModeBtn");
  const searchPanel = document.getElementById("bibleSearchPanel");
  const verseList = document.getElementById("bibleVerseList");
  const searchResults = document.getElementById("bibleSearchResults");

  if (searchInput && searchInput.value !== bibleSearchState.query) {
    searchInput.value = bibleSearchState.query;
  }
  if (scopeSelect) scopeSelect.value = bibleSearchState.scope;

  browseButton?.classList.toggle("is-active", !bibleSearchState.active);
  searchButton?.classList.toggle("is-active", bibleSearchState.active);
  browseButton?.setAttribute("aria-selected", bibleSearchState.active ? "false" : "true");
  searchButton?.setAttribute("aria-selected", bibleSearchState.active ? "true" : "false");
  if (searchPanel) searchPanel.hidden = !bibleSearchState.active;
  if (verseList) verseList.hidden = bibleSearchState.active;
  if (searchResults) searchResults.hidden = !bibleSearchState.active;

  document.querySelectorAll(".bible-search-mode-button").forEach((button) => {
    const active = button.getAttribute("data-search-mode") === bibleSearchState.mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function renderBibleSearchPlaceholder(title, hint = "") {
  const resultsEl = document.getElementById("bibleSearchResults");
  if (!resultsEl) return;
  resultsEl.innerHTML =
    '<div class="list-placeholder">' +
    `<span class="list-placeholder-title">${escapeHtml(title)}</span>` +
    (hint ? `<span class="list-placeholder-hint">${escapeHtml(hint)}</span>` : "") +
    "</div>";
}

function setBibleSearchStatus(message = "") {
  const status = document.getElementById("bibleSearchStatus");
  if (status) status.textContent = message;
}

function setBibleNavigatorMode(mode, options = {}) {
  const nextActive = mode === "search";
  if (bibleSearchState.active === nextActive) {
    syncBibleSearchControlsFromState();
  } else {
    bibleSearchState.active = nextActive;
    syncBibleSearchControlsFromState();
  }

  if (nextActive) {
    if (!bibleSearchState.query.trim()) {
      renderBibleSearchPlaceholder("Search Bible text", "Choose words or an exact phrase");
      setBibleSearchStatus("");
    } else if (options.runSearch !== false) {
      scheduleBibleSearch(0);
    }
    if (options.focus) {
      document.getElementById("bibleSearchInput")?.focus();
    }
  } else {
    clearBibleSearchTimer();
  }
}

function scheduleBibleSearch(delay = 180) {
  clearBibleSearchTimer();
  if (!bibleSearchState.active) return;
  bibleSearchTimer = window.setTimeout(() => {
    bibleSearchTimer = null;
    void runBibleSearch().catch(console.error);
  }, delay);
}

function bibleSearchResultKey(result) {
  return `${result?.version || ""}:${result?.reference || ""}`;
}

function syncBibleSearchResultActiveState() {
  const resultsEl = document.getElementById("bibleSearchResults");
  if (!resultsEl) return;
  const activeKey = `${bibleDesignerState.version || ""}:${bibleDesignerState.reference || ""}`;
  resultsEl.querySelectorAll(".bible-search-result-row").forEach((row) => {
    const active = row.getAttribute("data-result-key") === activeKey;
    row.classList.toggle("is-active", active);
    row.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function renderBibleSearchResults(response) {
  const resultsEl = document.getElementById("bibleSearchResults");
  if (!resultsEl) return;
  const results = Array.isArray(response?.results) ? response.results : [];
  bibleSearchState.results = results;

  if (response?.error) {
    renderBibleSearchPlaceholder("Search failed", response.error);
    setBibleSearchStatus("");
    return;
  }
  if (!bibleSearchState.query.trim()) {
    renderBibleSearchPlaceholder("Search Bible text", "Choose words or an exact phrase");
    setBibleSearchStatus("");
    return;
  }
  if (!results.length) {
    renderBibleSearchPlaceholder("No matches", bibleSearchState.query);
    setBibleSearchStatus("0 results");
    return;
  }

  const resultLabel = results.length === 1 ? "1 result" : `${results.length} results`;
  const scopeLabel = bibleSearchState.scope === "all" ? "all versions" : bibleDesignerState.version;
  setBibleSearchStatus(`${resultLabel} in ${scopeLabel}`);

  resultsEl.innerHTML = "";
  const fragment = document.createDocumentFragment();
  results.forEach((result, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bible-search-result-row";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", "false");
    button.dataset.searchIndex = String(index);
    button.setAttribute("data-result-key", bibleSearchResultKey(result));
    const version = String(result?.version || "");
    const reference = String(result?.reference || "");
    const text = String(result?.text || "");
    button.title = `${reference} ${version}`.trim();
    button.innerHTML =
      `<span class="bible-search-result-reference">${escapeHtml(reference)}</span>` +
      `<span class="bible-search-result-version">${escapeHtml(version)}</span>` +
      `<span class="bible-search-result-text">${escapeHtml(text)}</span>`;
    button.addEventListener("click", () => {
      void applyBibleSearchResult(index).catch(console.error);
    });
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void browseFromBibleSearchResult(index).catch(console.error);
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        if (await applyBibleSearchResult(index)) {
          showBibleTextContextMenu(event);
        }
      })().catch(console.error);
    });
    fragment.appendChild(button);
  });
  resultsEl.appendChild(fragment);
  syncBibleSearchResultActiveState();
}

async function runBibleSearch() {
  const query = bibleSearchState.query.trim();
  const requestId = bibleSearchState.requestId + 1;
  bibleSearchState.requestId = requestId;
  if (!query) {
    bibleSearchState.results = [];
    renderBibleSearchPlaceholder("Search Bible text", "Choose words or an exact phrase");
    setBibleSearchStatus("");
    return;
  }

  setBibleSearchStatus("Searching…");
  const response = await bibleAPI.searchText(bibleSearchScopeVersion(), query, {
    mode: bibleSearchState.mode,
    limit: 40,
  });
  if (requestId !== bibleSearchState.requestId) return;
  renderBibleSearchResults(response);
}

async function applyBibleSearchResult(index) {
  const result = bibleSearchState.results[index];
  if (!result?.reference || !result?.text) return false;
  const version = String(result.version || bibleDesignerState.version || "KJV");
  const reference = String(result.reference || "");
  const verse = Number(result.verse);

  setBibleDesignerVersion(version);
  bibleDesignerState.attribution = bibleAttributionForResult(result);
  bibleDesignerState.book = String(result.book || bibleDesignerState.book || "");
  bibleDesignerState.chapter = Number(result.chapter) || bibleDesignerState.chapter;
  bibleDesignerState.verse = Number.isFinite(verse) && verse > 0 ? verse : 0;
  bibleDesignerState.verseEnd = 0;
  bibleDesignerState.reference = reference;
  bibleDesignerState.text = String(result.text || "");
  bibleVerseSelection.verses.clear();
  if (bibleDesignerState.verse > 0) {
    bibleVerseSelection.verses.add(bibleDesignerState.verse);
    bibleVerseSelection.anchor = bibleDesignerState.verse;
  } else {
    bibleVerseSelection.anchor = 0;
  }

  syncBibleSelectorsFromState();
  await renderBibleVerseList();
  syncBibleVerseListSelection();
  await refreshBibleLookupPreview();
  syncBibleSearchResultActiveState();
  return true;
}

async function reconcileBibleBrowseView(opts = {}) {
  syncBibleSelectorsFromState();
  await renderBibleVerseList();
  syncBibleVerseListSelection();
  if (opts.scroll !== false) {
    scrollBibleViewerToCurrentVerse();
  }
  if (opts.refreshPreview !== false) {
    await refreshBibleLookupPreview({ liveSync: opts.liveSync });
  }
  return true;
}

async function browseCurrentBibleChapter() {
  setBibleNavigatorMode("browse", { runSearch: false });
  await reconcileBibleBrowseView();
  return true;
}

async function browseFromBibleSearchResult(index) {
  if (!(await applyBibleSearchResult(index))) return false;
  await browseCurrentBibleChapter();
  return true;
}

async function renderBibleVerseList() {
  const list = document.getElementById("bibleVerseList");
  if (!list) return;

  if (!list._delegationInitialized) {
    list._delegationInitialized = true;

    list.addEventListener("click", (event) => {
      const button = event.target.closest(".bible-verse-row");
      if (button) {
        const verseNumber = Number(button.dataset.verse);
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
        syncBibleVerseListSelection();
        scheduleSelectedBibleVersePreview();
      }
    });

    list.addEventListener("contextmenu", (event) => {
      const button = event.target.closest(".bible-verse-row");
      if (button) {
        const verseNumber = Number(button.dataset.verse);
        if (!bibleVerseSelection.verses.has(verseNumber)) {
          bibleVerseSelection.verses.clear();
          bibleVerseSelection.verses.add(verseNumber);
        }
        bibleVerseSelection.anchor = verseNumber;
        const selectedVerses = selectedBibleVerseNumbers();
        bibleDesignerState.verse = selectedVerses[0] || verseNumber;
        bibleDesignerState.verseEnd =
          selectedVerses.length > 1 ? selectedVerses[selectedVerses.length - 1] : 0;
        syncBibleVerseListSelection();
        cancelBibleVersePreviewSync();
        void applySelectedBibleVersePreview().catch(console.error);
        showBibleTextContextMenu(event);
      }
    });

    list.addEventListener("dblclick", (event) => {
      const button = event.target.closest(".bible-verse-row");
      if (button) {
        const verseNumber = Number(button.dataset.verse);
        const verseText = button.dataset.text || "";
        cancelBibleVersePreviewSync();
        const keepMultiSelection =
          bibleVerseSelection.verses.size > 1 && bibleVerseSelection.verses.has(verseNumber);
        if (!keepMultiSelection) {
          bibleVerseSelection.verses.clear();
          bibleVerseSelection.verses.add(verseNumber);
          bibleVerseSelection.anchor = verseNumber;
        }
        const selectedVerses = selectedBibleVerseNumbers();
        bibleDesignerState.verse = selectedVerses[0] || verseNumber;
        bibleDesignerState.verseEnd =
          selectedVerses.length > 1 ? selectedVerses[selectedVerses.length - 1] : 0;
        syncBibleVerseListSelection();
        void presentBibleSelectionFromDoubleClick(verseNumber, verseText).catch(console.error);
      }
    });
  }

  const requestId = bibleVerseListRequestId + 1;
  bibleVerseListRequestId = requestId;
  cancelBibleVersePreviewSync();

  let textData = null;
  try {
    textData = await bibleAPI.getText(
      bibleDesignerState.version,
      bibleDesignerState.book,
      String(bibleDesignerState.chapter),
    );
  } catch (err) {
    console.error("Failed to load Bible chapter:", err);
  }
  if (requestId !== bibleVerseListRequestId) return;
  const verses = Array.isArray(textData?.verses) ? textData.verses : [];

  const existingButtons = Array.from(list.children);
  if (
    existingButtons.length === 1 &&
    (existingButtons[0].classList.contains("list-placeholder") ||
      existingButtons[0].innerHTML.includes("No verses found"))
  ) {
    list.innerHTML = "";
    existingButtons.length = 0;
  }

  if (!verses.length) {
    list.innerHTML =
      '<div class="list-placeholder"><span class="list-placeholder-title">No verses found</span></div>';
    return;
  }

  list.setAttribute("aria-multiselectable", "true");

  const numVerses = verses.length;
  for (let index = 0; index < numVerses; index++) {
    const verseText = verses[index];
    const verseNumber = index + 1;
    const isSelected = bibleVerseNumberIsSelected(verseNumber);
    let button = existingButtons[index];

    if (!button || !button.classList.contains("bible-verse-row")) {
      button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "option");
      list.appendChild(button);
    }

    button.className = isSelected ? "bible-verse-row is-selected" : "bible-verse-row";
    button.dataset.verse = String(verseNumber);
    button.dataset.text = verseText;
    button.setAttribute("aria-selected", isSelected ? "true" : "false");
    button.innerHTML = `<span class="bible-verse-number">${verseNumber}</span><span class="bible-verse-row-text">${escapeHtml(verseText)}</span>`;
  }

  while (list.children.length > numVerses) {
    list.removeChild(list.lastChild);
  }
}

async function refreshBibleBrowser() {
  await syncBibleStateFromControls();
  await renderBibleVerseList();
  syncBibleSelectorsFromState();
}

async function jumpBibleReferenceToBrowser() {
  const referenceInput = document.getElementById("bibleReferenceInput");
  hideBibleReferenceSuggestions();
  setBibleNavigatorMode("browse", { runSearch: false });
  const resolvedReference = await normalizeBibleReferenceInput(referenceInput?.value || "");
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
  await refreshBibleBrowser();
  if (bibleDesignerState.verse > 0) {
    let lookupResult = null;
    try {
      lookupResult = await lookupBibleReference(
        bibleDesignerState.reference,
        bibleDesignerState.version,
      );
    } catch {}
    if (!lookupResult) {
      await setBiblePreviewText(bibleDesignerState.reference, "Text not found", {
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
    await refreshBibleLookupPreview();
  }
  return true;
}

let currentWorkspaceSong = null;
let currentWorkspaceSongDeck = null;
let currentEditingSongId = null;
let currentSongRenderState = { ...DEFAULT_SONG_RENDER };
let currentSongSectionId = null;
let currentSongQueueItem = null;
let currentSongFolderFilter = "__all__";
let songFoldersCache = [];
let selectedSongIds = new Set();
let songsBulkDeleteArmed = false;

const SONG_FOLDER_ALL = "__all__";
const SONG_FOLDER_UNFILED = "__unfiled__";

function asSongArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatSongListLabel(song) {
  const authorSuffix = song.author ? ` (${song.author})` : "";
  return `${song.title || "Untitled Song"}${authorSuffix}`;
}

function formatSongListNumber(song) {
  return Number.isFinite(song.songNumber) && song.songNumber > 0 ? `#${song.songNumber}` : "";
}

function songFontFamilyCSS(fontFamily = DEFAULT_SONG_RENDER.fontFamily) {
  const family = String(fontFamily || DEFAULT_SONG_RENDER.fontFamily).trim();
  if (!family) return `${DEFAULT_SONG_RENDER.fontFamily}, sans-serif`;
  return family.includes(",") ? family : `${family}, sans-serif`;
}

function songDeckDocumentFromSongDocument(document, render = currentSongRenderState) {
  if (!document) return null;
  const deck = isSlideDeckDocument(document)
    ? normalizeSlideDeck({
        ...document,
        documentType: document.documentType || SONG_DECK_DOCUMENT_TYPE,
        type: SONG_DECK_DOCUMENT_TYPE,
      })
    : songAstToDeck(normalizeToSongAST(document), { documentType: SONG_DECK_DOCUMENT_TYPE });
  if (!deck) return null;
  deck.documentType = SONG_DECK_DOCUMENT_TYPE;
  deck.type = SONG_DECK_DOCUMENT_TYPE;
  if (render && typeof render === "object") {
    deck.theme = {
      ...(deck.theme || DEFAULT_DECK_THEME),
      ...(render.fontFamily ? { fontFamily: render.fontFamily } : {}),
      ...(Number.isFinite(Number(render.fontSize)) ? { fontSize: Number(render.fontSize) } : {}),
      ...(Number.isFinite(Number(render.minFontSize)) ? { minFontSize: Number(render.minFontSize) } : {}),
      ...(render.autosizeMode ? { autosizeMode: render.autosizeMode } : {}),
      ...(render.color ? { textColor: render.color } : {}),
      ...(render.backgroundColor ? { backgroundColor: render.backgroundColor } : {}),
      ...(render.backgroundPath ? { backgroundPath: render.backgroundPath } : {}),
    };
  }
  return normalizeSlideDeck(deck);
}

function transientSongFromSongDocument(document) {
  if (!document) return null;
  if (isSlideDeckDocument(document)) {
    return deckToTransientSong(document);
  }
  return normalizeToSongAST(document);
}

function songRenderStateFromSongDocument(document) {
  if (isSlideDeckDocument(document)) {
    return mergeSongRenderState(DEFAULT_SONG_RENDER, deckDefaultRender(document));
  }
  return document?.defaultRender
    ? songRenderStateFromDefaultRender(document.defaultRender)
    : mergeSongRenderState();
}

function buildSongQueueEntryFromDeck({
  deck,
  render = currentSongRenderState,
  currentSectionId = currentSongSectionId,
  sourceKind = "library",
} = {}) {
  const canonicalDeck = songDeckDocumentFromSongDocument(deck, render);
  if (!canonicalDeck) return null;
  const transientSong = deckToTransientSong(canonicalDeck);
  if (!transientSong) return null;
  const pageId = currentSectionId || canonicalDeck.pages?.[0]?.id || transientSong.sections?.[0]?.id || null;
  const page = findPage(canonicalDeck, pageId);
  const pageRender = {
    ...deckDefaultRender(canonicalDeck),
    ...pageRenderOverrides(page, canonicalDeck),
    ...definedSongQueueRenderValues(render),
  };
  const entry = queueEntryFromSong({
    song: transientSong,
    render: pageRender,
    currentSectionId: pageId,
  });
  entry.type = "song";
  entry.path = songQueuePath(canonicalDeck.id);
  entry.name = canonicalDeck.title || "Song";
  entry.source = {
    kind: sourceKind,
    songId: canonicalDeck.id,
    pageId,
  };
  entry.deckSnapshot = canonicalDeck;
  const transitionOverride = normalizeItemSlideTransitionOverride(page?.transition || render?.transition);
  if (transitionOverride) entry.transition = transitionOverride;
  return entry;
}

function definedSongQueueRenderValues(render = {}) {
  if (!render || typeof render !== "object") return {};
  const keys = [
    "backgroundColor",
    "backgroundPath",
    "color",
    "fontFamily",
    "fontSize",
    "autosizeMode",
    "minFontSize",
    "copyrightPlacement",
    "textBoxPosition",
    "copyright",
    "ccliNumber",
    "oneLicense",
    "transition",
  ];
  const values = {};
  for (const key of keys) {
    if (render[key] !== undefined) values[key] = render[key];
  }
  return values;
}

function songSectionsFromParsedSections(sections) {
  return normalizeToSongAST({
    id: "editor_song",
    title: "Editor Song",
    metadata: {},
    sections: Array.isArray(sections) ? sections : [],
  })?.sections || [];
}

function songEditorTextFromSections(sections) {
  const parts = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    const label = (section.label || "").trim();
    parts.push(label ? `[${label}]` : "");
    for (const text of songSectionBlockTexts(section)) {
      parts.push(text.trim() === "" ? "" : text);
    }
    parts.push("");
  }
  return parts.join("\n").trim();
}

function renderSongBlocksIntoPreview(preview, blocks, color = "#ffffff", textBoxPosition = null) {
  preview.innerHTML = "";
  const container = document.createElement("div");
  container.className = "song-preview-text-box";
  if (textBoxPosition) {
    container.style.position = "absolute";
    container.style.left = textBoxPosition.left || "10%";
    container.style.top = textBoxPosition.top || "10%";
    container.style.width = textBoxPosition.width || "80%";
    container.style.height = textBoxPosition.height || "80%";
  }
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.alignItems = "center";
  container.style.justifyContent = "center";
  container.style.pointerEvents = "none";

  const astBlocks = Array.isArray(blocks) ? blocks : [];
  for (const block of astBlocks) {
    const lineEl = document.createElement("div");
    const text = block?.type === "lyricLine"
      ? block.primary?.segments?.map((segment) => segment?.text || "").join("") || ""
      : "";
    lineEl.className = text.trim() === ""
      ? "song-preview-block song-preview-block--spacer"
      : "song-preview-block";
    lineEl.style.color = color;
    if (text.trim() === "") {
      lineEl.innerHTML = "&nbsp;";
    } else {
      const segments = Array.isArray(block.primary?.segments) ? block.primary.segments : [];
      for (const segment of segments) {
        const span = document.createElement("span");
        span.textContent = segment?.text || "";
        applySongSegmentStyleToElement(span, segment?.style);
        lineEl.appendChild(span);
      }
    }
    container.appendChild(lineEl);
  }
  preview.appendChild(container);
}

function renderSlideObjectsIntoPreview(preview, objects, message = {}) {
  preview.innerHTML = "";
  const previewScale = Math.max(preview.clientWidth || 1920, 1) / 1920;
  const orderedObjects = (Array.isArray(objects) ? objects : [])
    .map((object, index) => ({ object, index }))
    .sort((a, b) => {
      const az = Number.isFinite(a.object?.zIndex) ? a.object.zIndex : 0;
      const bz = Number.isFinite(b.object?.zIndex) ? b.object.zIndex : 0;
      return az === bz ? a.index - b.index : az - bz;
    })
    .map(({ object }) => object);
  for (const object of orderedObjects) {
    if (!object) continue;
    const kind = object?.kind === "image" || object?.kind === "shape" ? object.kind : "text";
    const position = object?.textBoxPosition || {};
    const box = document.createElement("div");
    box.className = `song-preview-slide-object song-preview-slide-object--${kind}`;
    if (kind === "text") box.classList.add("song-preview-text-box");
    box.style.position = "absolute";
    box.style.left = position.left || "10%";
    box.style.top = position.top || "10%";
    box.style.width = position.width || "80%";
    box.style.height = position.height || "80%";
    box.style.overflow = "hidden";
    box.style.pointerEvents = "none";
    box.style.zIndex = String(Number.isFinite(object.zIndex) ? object.zIndex : 0);
    box.style.opacity = String(clampSlideOpacity(object.opacity, 1));

    if (kind === "image") {
      const image = object.image && typeof object.image === "object" ? object.image : {};
      const src = image.imageUrl || image.url || (image.path ? pathToUrlSafe(image.path) : "");
      if (src) {
        const img = document.createElement("img");
        img.className = "song-preview-slide-object__image";
        img.src = src;
        img.alt = "";
        img.draggable = false;
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.display = "block";
        img.style.objectFit = image.fit === "cover" || image.fit === "fill" ? image.fit : "contain";
        box.appendChild(img);
      }
      preview.appendChild(box);
      continue;
    }

    if (kind === "shape") {
      const shape = object.shape && typeof object.shape === "object" ? object.shape : {};
      const shapeEl = document.createElement("div");
      shapeEl.className = "song-preview-slide-object__shape";
      shapeEl.style.position = "absolute";
      shapeEl.style.inset = "0";
      if (shape.type === "ellipse") {
        shapeEl.style.borderRadius = "999px";
      } else if (Number.isFinite(shape.radius) && shape.radius > 0) {
        shapeEl.style.borderRadius = `${shape.radius}px`;
      }
      shapeEl.style.backgroundColor = shape.type === "line" ? "transparent" : (shape.fill || "#ffffff");
      if (shape.stroke || Number.isFinite(shape.strokeWidth)) {
        const strokeWidth = Number.isFinite(shape.strokeWidth) ? shape.strokeWidth : 1;
        shapeEl.style.border = `${strokeWidth}px solid ${shape.stroke || shape.fill || "#ffffff"}`;
      }
      if (shape.type === "line") {
        const strokeWidth = Number.isFinite(shape.strokeWidth) && shape.strokeWidth > 0 ? shape.strokeWidth : 4;
        shapeEl.style.inset = "50% 0 auto 0";
        shapeEl.style.height = "0";
        shapeEl.style.border = "none";
        shapeEl.style.borderTop = `${strokeWidth}px solid ${shape.stroke || shape.fill || "#ffffff"}`;
      }
      box.appendChild(shapeEl);
      preview.appendChild(box);
      continue;
    }

    box.style.display = "flex";
    box.style.flexDirection = "column";
    box.style.justifyContent =
      object.verticalAlign === "top"
        ? "flex-start"
        : object.verticalAlign === "bottom"
          ? "flex-end"
          : "center";
    box.style.alignItems =
      object.align === "left" ? "flex-start" : object.align === "right" ? "flex-end" : "center";
    box.style.textAlign = object.align || "center";
    box.style.color = object.color || message.color || "#ffffff";
    box.style.fontFamily = songFontFamilyCSS(object.fontFamily || message.fontFamily);
    box.style.fontWeight = object.fontWeight || message.fontWeight || "";
    box.style.fontStyle = object.fontStyle || "";
    box.style.textDecoration = object.textDecoration || "";
    const objectFontSize = Math.max(
      12,
      (Number(object.fontSize) || Number(message.fontSize) || DEFAULT_SONG_RENDER.fontSize) * previewScale,
    );
    box.style.fontSize = `${objectFontSize}px`;
    box.style.lineHeight = object.lineHeight || message.lineHeight || SCRIPTURE_LINE_HEIGHT;

    const bg = object.background && typeof object.background === "object" ? object.background : null;
    if (bg?.type === "color") {
      box.style.backgroundColor = bg.color || "transparent";
    } else if (bg?.backgroundVideo || (bg?.path && bg.type === "video")) {
      const videoEl = document.createElement("video");
      videoEl.src = bg.backgroundVideo || pathToUrlSafe(bg.path);
      videoEl.autoplay = true;
      videoEl.loop = true;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.style.position = "absolute";
      videoEl.style.inset = "0";
      videoEl.style.width = "100%";
      videoEl.style.height = "100%";
      videoEl.style.objectFit = "cover";
      videoEl.style.zIndex = "0";
      box.appendChild(videoEl);
      void videoEl.play().catch(() => {});
    } else if (bg?.backgroundImage || bg?.path) {
      box.style.backgroundImage = `url('${bg.backgroundImage || pathToUrlSafe(bg.path)}')`;
      box.style.backgroundSize = "cover";
      box.style.backgroundPosition = "center";
    }

    const content = document.createElement("div");
    content.style.position = "relative";
    content.style.zIndex = "1";
    content.style.width = "100%";
    for (const block of Array.isArray(object.blocks) ? object.blocks : []) {
      const lineEl = document.createElement("div");
      lineEl.className = "song-preview-block";
      const segments = block?.type === "lyricLine" && Array.isArray(block.primary?.segments)
        ? block.primary.segments
        : [];
      if (!segments.length || segments.every((segment) => !segment?.text?.trim())) {
        lineEl.classList.add("song-preview-block--spacer");
        lineEl.textContent = "\u00a0";
      } else {
        for (const segment of segments) {
          const span = document.createElement("span");
          span.textContent = segment?.text || "";
          applySongSegmentStyleToElement(span, segment?.style);
          lineEl.appendChild(span);
        }
      }
      content.appendChild(lineEl);
    }
    box.appendChild(content);
    preview.appendChild(box);
    fitTextElementToBox(box, content, {
      baseSize: objectFontSize,
      minSize: Math.max(
        8,
        (Number(object.minFontSize) || Number(message.minFontSize) || DEFAULT_SONG_RENDER.minFontSize) * previewScale,
      ),
      mode: object.autofit || message.autosizeMode || "fit",
    });
  }
}

function renderSongCopyrightIntoPreview(preview, copyrightText) {
  if (!preview) return;
  const text = String(copyrightText || "").trim();
  let copyright = preview.querySelector(".song-copyright-overlay");
  if (!text) {
    copyright?.remove();
    return;
  }
  if (!copyright) {
    copyright = document.createElement("div");
    copyright.className = "song-copyright-overlay";
  }
  copyright.textContent = text;
  preview.appendChild(copyright);
}

function textStyleFromSegment(segment) {
  const style = segment?.style && typeof segment.style === "object" ? segment.style : {};
  const normalized = {};
  if (typeof style.color === "string" && style.color.trim()) normalized.color = style.color.trim();
  if (typeof style.fontFamily === "string" && style.fontFamily.trim()) normalized.fontFamily = style.fontFamily.trim();
  if (typeof style.backgroundColor === "string" && style.backgroundColor.trim()) {
    normalized.backgroundColor = style.backgroundColor.trim();
  }
  if (typeof style.fontWeight === "string" && style.fontWeight.trim()) {
    normalized.fontWeight = style.fontWeight.trim();
  } else if (Number.isFinite(Number(style.fontWeight))) {
    normalized.fontWeight = String(Number(style.fontWeight));
  }
  if (typeof style.fontStyle === "string" && style.fontStyle.trim()) {
    normalized.fontStyle = style.fontStyle.trim();
  }
  if (typeof style.textDecoration === "string" && style.textDecoration.trim()) {
    normalized.textDecoration = style.textDecoration.trim();
  }
  return normalized;
}

function mergeSongSegmentStyle(baseStyle = {}, overrideStyle = {}) {
  const merged = { ...textStyleFromSegment({ style: baseStyle }) };
  const override = textStyleFromSegment({ style: overrideStyle });
  for (const [key, value] of Object.entries(override)) {
    if (value == null || value === "") {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function sameSongSegmentStyle(a = {}, b = {}) {
  const left = textStyleFromSegment({ style: a });
  const right = textStyleFromSegment({ style: b });
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left[key] || "") !== (right[key] || "")) return false;
  }
  return true;
}

function applySongSegmentStyleToElement(el, style = {}) {
  if (!el) return;
  const normalized = textStyleFromSegment({ style });
  if (normalized.color) el.style.color = normalized.color;
  if (normalized.fontFamily) el.style.fontFamily = songFontFamilyCSS(normalized.fontFamily);
  if (normalized.backgroundColor) el.style.backgroundColor = normalized.backgroundColor;
  if (normalized.fontWeight) el.style.fontWeight = normalized.fontWeight;
  if (normalized.fontStyle) el.style.fontStyle = normalized.fontStyle;
  if (normalized.textDecoration) el.style.textDecoration = normalized.textDecoration;
}

function normalizeSongSegments(segments = []) {
  const merged = [];
  for (const segment of Array.isArray(segments) ? segments : []) {
    const text = typeof segment?.text === "string" ? segment.text : "";
    if (!text) continue;
    const style = textStyleFromSegment(segment);
    const normalized = {
      type: segment?.type || "text",
      text,
      ...(Object.keys(style).length > 0 ? { style } : {}),
    };
    const previous = merged[merged.length - 1];
    if (previous && previous.type === normalized.type && sameSongSegmentStyle(previous.style, normalized.style)) {
      previous.text += normalized.text;
    } else {
      merged.push(normalized);
    }
  }
  return merged;
}

function applySongStyleToBlockRange(block, start, end, style) {
  if (!block || block.type !== "lyricLine" || !Array.isArray(block.primary?.segments)) return block;
  if (end <= start) return block;

  const nextSegments = [];
  let offset = 0;
  for (const segment of block.primary.segments) {
    const text = typeof segment?.text === "string" ? segment.text : "";
    const segmentStart = offset;
    const segmentEnd = segmentStart + text.length;
    offset = segmentEnd;

    if (!text || end <= segmentStart || start >= segmentEnd) {
      nextSegments.push(segment);
      continue;
    }

    const localStart = Math.max(0, start - segmentStart);
    const localEnd = Math.min(text.length, end - segmentStart);
    if (localStart > 0) {
      nextSegments.push({ ...segment, text: text.slice(0, localStart) });
    }
    const styledText = text.slice(localStart, localEnd);
    if (styledText) {
      const nextStyle = mergeSongSegmentStyle(segment.style, style);
      nextSegments.push({
        ...segment,
        text: styledText,
        ...(Object.keys(nextStyle).length > 0 ? { style: nextStyle } : {}),
      });
    }
    if (localEnd < text.length) {
      nextSegments.push({ ...segment, text: text.slice(localEnd) });
    }
  }

  return {
    ...block,
    primary: {
      ...(block.primary || {}),
      segments: normalizeSongSegments(nextSegments),
    },
  };
}

function applySongStyleToWholeBlock(block, style) {
  const text = songBlockText(block);
  return applySongStyleToBlockRange(block, 0, text.length, style);
}

function applySongStyleToSectionRange(section, start, end, style) {
  if (!section || !Array.isArray(section.blocks)) return section;
  let offset = 0;
  return {
    ...section,
    blocks: section.blocks.map((block, blockIndex) => {
      const blockText = songBlockText(block);
      const blockStart = offset;
      const blockEnd = blockStart + blockText.length;
      offset = blockEnd + (blockIndex < section.blocks.length - 1 ? 1 : 0);
      if (end <= blockStart || start >= blockEnd) return block;
      return applySongStyleToBlockRange(
        block,
        Math.max(0, start - blockStart),
        Math.min(blockText.length, end - blockStart),
        style,
      );
    }),
  };
}

function applySongStyleToWholeSection(section, style) {
  if (!section || !Array.isArray(section.blocks)) return section;
  return {
    ...section,
    blocks: section.blocks.map((block) => applySongStyleToWholeBlock(block, style)),
  };
}

function currentSongEditorStyleScope() {
  const scope = document.getElementById("songEditorStyleScope")?.value;
  return scope === "selection" || scope === "page" || scope === "allSlides" ? scope : "allSlides";
}

function setSongEditorStyleScope(scope) {
  const select = document.getElementById("songEditorStyleScope");
  if (select && (scope === "selection" || scope === "page" || scope === "allSlides")) {
    select.value = scope;
  }
}

function selectedSongEditorTextRange(textarea) {
  const savedPos = saveSongEditorCursorPosition(textarea);
  if (!savedPos) return null;
  let { start, end } = savedPos;
  if (start !== end) return { start: Math.min(start, end), end: Math.max(start, end) };
  const value = textarea.innerText || textarea.textContent || "";
  if (!value) return null;
  if (start < value.length && value[start] !== "\n") return { start, end: start + 1 };
  if (start > 0 && value[start - 1] !== "\n") return { start: start - 1, end: start };
  return null;
}

function updateSongEditorSection(index, section) {
  if (index < 0 || index >= songEditorSections.length || !section) return;
  songEditorSections[index] = section;
  if (currentWorkspaceSong) {
    currentWorkspaceSong.sections = songEditorSections;
  }
}

function saveSongEditorCursorPosition(contentEditableEl) {
  const selection = window.getSelection();
  if (!selection.rangeCount || !contentEditableEl.contains(selection.anchorNode)) return null;
  
  const range = selection.getRangeAt(0);
  let start = 0, end = 0, currentOffset = 0;
  let foundStart = false, foundEnd = false;

  const walk = (node) => {
    if (foundEnd) return;
    if (node.nodeType === 3) {
      if (!foundStart && range.startContainer === node) { start = currentOffset + range.startOffset; foundStart = true; }
      if (!foundEnd && range.endContainer === node) { end = currentOffset + range.endOffset; foundEnd = true; }
      currentOffset += node.textContent.length;
    } else if (node.nodeType === 1) {
      for (let i = 0; i < node.childNodes.length; i++) {
        if (!foundStart && range.startContainer === node && range.startOffset === i) { start = currentOffset; foundStart = true; }
        if (!foundEnd && range.endContainer === node && range.endOffset === i) { end = currentOffset; foundEnd = true; }
        walk(node.childNodes[i]);
      }
      if (!foundStart && range.startContainer === node && range.startOffset === node.childNodes.length) { start = currentOffset; foundStart = true; }
      if (!foundEnd && range.endContainer === node && range.endOffset === node.childNodes.length) { end = currentOffset; foundEnd = true; }
      
      if ((node.tagName === "DIV" || node.tagName === "P") && node.nextSibling) {
        currentOffset += 1;
      }
    }
  };

  walk(contentEditableEl);
  if (!foundStart) start = currentOffset;
  if (!foundEnd) end = start;
  return { start, end };
}

function restoreSongEditorCursorPosition(contentEditableEl, savedPosition) {
  if (!savedPosition) return;
  const { start, end } = savedPosition;
  let currentOffset = 0;
  const range = document.createRange();
  range.setStart(contentEditableEl, 0);
  range.collapse(true);
  
  let foundStart = false, foundEnd = false;

  const walk = (node) => {
    if (foundEnd) return;
    if (node.nodeType === 3) {
      const len = node.textContent.length;
      if (!foundStart && start >= currentOffset && start <= currentOffset + len) {
        range.setStart(node, start - currentOffset);
        foundStart = true;
      }
      if (foundStart && !foundEnd && end >= currentOffset && end <= currentOffset + len) {
        range.setEnd(node, end - currentOffset);
        foundEnd = true;
      }
      currentOffset += len;
    } else if (node.nodeType === 1) {
      for (const child of node.childNodes) walk(child);
      if ((node.tagName === "DIV" || node.tagName === "P") && node.nextSibling) {
        currentOffset += 1;
      }
    }
  };
  
  walk(contentEditableEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function refreshSongEditorAfterStyleChange() {
  syncSongEditorHiddenTextarea();
  const activeSection = songEditorSections[songEditorActiveIndex];
  if (activeSection) {
    renderSongSectionPreview(activeSection);
    void syncActiveScheduledSongPresentation().catch(console.error);
  }
  renderSongEditorSlideList();
  const textarea = document.getElementById("songEditorSlideTextarea");
  if (textarea && activeSection) {
    const savedPos = saveSongEditorCursorPosition(textarea);
    populateSongEditorTextarea(textarea, activeSection);
    restoreSongEditorCursorPosition(textarea, savedPos);
  }
}

function populateSongEditorTextarea(textarea, section) {
  if (!textarea || !section) return;
  textarea.innerHTML = "";
  const blocks = Array.isArray(section.blocks) ? section.blocks : [];
  for (const block of blocks) {
    const lineEl = document.createElement("div");
    lineEl.dataset.blockId = block.id;
    if (block.type === "spacer" || !block.primary?.segments?.length) {
      lineEl.innerHTML = "<br>";
    } else {
      for (const segment of block.primary.segments) {
        const span = document.createElement("span");
        span.textContent = segment.text || "";
        applySongSegmentStyleToElement(span, segment.style);
        lineEl.appendChild(span);
      }
    }
    textarea.appendChild(lineEl);
  }
}

function applySongEditorTextStyle(style, scope = currentSongEditorStyleScope()) {
  if (!style || typeof style !== "object") return;
  const textarea = document.getElementById("songEditorSlideTextarea");
  if (scope === "allSlides") {
    songEditorSections = songEditorSections.map((section) => applySongStyleToWholeSection(section, style));
    if (currentWorkspaceSong) currentWorkspaceSong.sections = songEditorSections;
  } else if (scope === "page") {
    const activeSection = songEditorSections[songEditorActiveIndex];
    updateSongEditorSection(songEditorActiveIndex, applySongStyleToWholeSection(activeSection, style));
  } else {
    const activeSection = songEditorSections[songEditorActiveIndex];
    const range = selectedSongEditorTextRange(textarea);
    if (!activeSection || !range) return;
    updateSongEditorSection(
      songEditorActiveIndex,
      applySongStyleToSectionRange(activeSection, range.start, range.end, style),
    );
  }
  syncCurrentWorkspaceSongDefaultRender();
  refreshSongEditorAfterStyleChange();
}

function songListExcerpt(song) {
  const sections = Array.isArray(song?.sections) ? song.sections : [];
  for (const section of sections) {
    for (const blockText of songSectionBlockTexts(section)) {
      const text = blockText.trim();
      if (text.length > 0) return text.length > 60 ? text.slice(0, 57) + "…" : text;
    }
  }
  return "";
}

function syncSongsBulkMoveFolderOptions() {
  const select = document.getElementById("songsBulkMoveFolder");
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML =
    '<option value="">Move to folder…</option><option value="__unfiled__">Default</option>';
  for (const folder of songFoldersCache) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.name;
    select.appendChild(option);
  }
  if (currentValue) select.value = currentValue;
}

function syncSongsBulkActions() {
  const bar = document.getElementById("songsBulkActions");
  const countEl = document.getElementById("songsBulkCount");
  const deleteBtn = document.getElementById("songsBulkDeleteBtn");
  const count = selectedSongIds.size;
  if (bar) bar.hidden = count === 0;
  if (countEl) countEl.textContent = `${count} selected`;
  if (deleteBtn && songsBulkDeleteArmed) {
    deleteBtn.textContent = `Confirm delete ${count}`;
  } else if (deleteBtn) {
    deleteBtn.textContent = "Delete";
  }
  syncSongsBulkMoveFolderOptions();
}

function clearSongSelection() {
  selectedSongIds.clear();
  songsBulkDeleteArmed = false;
  syncSongsBulkActions();
  document.querySelectorAll(".songs-list-item.is-checked").forEach((row) => {
    row.classList.remove("is-checked");
    const checkbox = row.querySelector(".songs-list-item__checkbox");
    if (checkbox) checkbox.checked = false;
  });
}

function setSongRowSelected(row, songId, checked) {
  if (checked) selectedSongIds.add(songId);
  else selectedSongIds.delete(songId);
  row.classList.toggle("is-checked", checked);
  songsBulkDeleteArmed = false;
  syncSongsBulkActions();
}

async function bulkMoveSelectedSongs() {
  const folderSelect = document.getElementById("songsBulkMoveFolder");
  const value = folderSelect?.value || "";
  if (!value || selectedSongIds.size === 0) {
    showGnomeToast("Choose a folder and select songs to move");
    return;
  }
  const folderId = value === SONG_FOLDER_UNFILED ? null : value;
  const ids = [...selectedSongIds];
  let moved = 0;
  for (const id of ids) {
    try {
      await songsAPI.moveToFolder(id, folderId);
      moved += 1;
      if (currentWorkspaceSong?.id === id) {
        currentWorkspaceSong.folderId = folderId;
      }
    } catch (err) {
      console.error(`Failed to move song ${id}:`, err);
    }
  }
  clearSongSelection();
  await refreshSongFolders();
  const searchInput = document.getElementById("songsSearchInput");
  await refreshSongsBrowser(searchInput?.value || "");
  syncSongsMoveFolderSelect(currentWorkspaceSong);
  showGnomeToast(`Moved ${moved} song${moved === 1 ? "" : "s"}`);
}

async function bulkScheduleSelectedSongs() {
  if (selectedSongIds.size === 0) {
    showGnomeToast("Select songs to schedule");
    return;
  }
  const entries = [];
  for (const id of selectedSongIds) {
    try {
      const song = await songsAPI.get(id);
      const entry = buildSongQueueEntryFromDeck({
        deck: song,
        render: renderStateForLibrarySong(song),
      });
      if (entry) entries.push(entry);
    } catch (err) {
      console.error(`Failed to load song ${id} for schedule:`, err);
    }
  }
  if (entries.length === 0) {
    showGnomeToast("Could not schedule selected songs");
    return;
  }
  invalidateQueueUndoToastAfterMutation();
  insertQueueEntriesAfterSelection(entries);
  renderQueue();
  saveMediaFile();
  clearSongSelection();
  showGnomeToast(`Scheduled ${entries.length} song${entries.length === 1 ? "" : "s"}`);
}

async function bulkDeleteSelectedSongs() {
  const count = selectedSongIds.size;
  if (count === 0) return;
  if (!songsBulkDeleteArmed) {
    songsBulkDeleteArmed = true;
    syncSongsBulkActions();
    return;
  }
  const ids = [...selectedSongIds];
  let deleted = 0;
  for (const id of ids) {
    try {
      await songsAPI.delete(id);
      deleted += 1;
      if (currentWorkspaceSong?.id === id) {
        await loadSongIntoWorkspace(null);
      }
    } catch (err) {
      console.error(`Failed to delete song ${id}:`, err);
    }
  }
  songsBulkDeleteArmed = false;
  clearSongSelection();
  await refreshSongFolders();
  const searchInput = document.getElementById("songsSearchInput");
  await refreshSongsBrowser(searchInput?.value || "");
  showGnomeToast(`Deleted ${deleted} song${deleted === 1 ? "" : "s"}`);
}

function songSearchOptionsForCurrentFolder() {
  if (currentSongFolderFilter === SONG_FOLDER_ALL) {
    return { all: true };
  }
  if (currentSongFolderFilter === SONG_FOLDER_UNFILED) {
    return { unfiled: true };
  }
  return { folderId: currentSongFolderFilter };
}

async function ensureSongFolder(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  const folder = await songsAPI.createFolder(trimmed);
  await refreshSongFolders();
  return folder?.id || null;
}

function syncSongEditorFolderOptions(selectedFolderId = "") {
  const select = document.getElementById("songEditorFolder");
  if (!select) return;
  const currentValue =
    selectedFolderId ||
    (typeof select.value === "string" ? select.value : "") ||
    "";
  select.innerHTML = '<option value="">Default</option>';
  for (const folder of songFoldersCache) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.name;
    select.appendChild(option);
  }
  select.value = currentValue;
}

function syncSongsMoveFolderSelect(song = currentWorkspaceSong, inLibrary = true) {
  const select = document.getElementById("songsMoveFolderSelect");
  if (!select) return;
  const selectedFolderId = song?.folderId || "";
  select.innerHTML =
    '<option value="">Move to folder…</option><option value="__unfiled__">Default</option>';
  for (const folder of songFoldersCache) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.name;
    select.appendChild(option);
  }
  select.disabled = !song?.id || !inLibrary;
  select.value = selectedFolderId || "";
}

function restoreSongWorkspaceView() {
  const launcher = document.getElementById("songsLauncher");
  const slide = document.getElementById("songsPreviewSlide");
  if (!launcher || !slide) return;
  if (currentWorkspaceSong) {
    launcher.hidden = true;
    slide.hidden = false;
  } else {
    launcher.hidden = false;
    slide.hidden = true;
  }
}

function closeSongFolderPrompt() {
  document.getElementById("songFolderPrompt")?.setAttribute("hidden", "");
}

function openSongFolderPrompt() {
  const prompt = document.getElementById("songFolderPrompt");
  const input = document.getElementById("songFolderPromptInput");
  if (!prompt || !input) return;
  input.value = "";
  prompt.removeAttribute("hidden");
  input.focus();
}

// Visual WYSIWYG Song Editor state and helpers
let songEditorSections = [];
let songEditorActiveIndex = 0;

function renderSongEditorSlideList() {
  const list = document.getElementById("songEditorSlideList");
  if (!list) return;

  list.innerHTML = "";
  songEditorSections.forEach((section, i) => {
    const item = document.createElement("div");
    item.className = "song-editor-slide-item";
    if (i === songEditorActiveIndex) {
      item.classList.add("active");
    }
    item.setAttribute("data-index", i);
    item.setAttribute("title", "Double-click to rename");
    item.addEventListener("click", () => {
      selectSongEditorSlide(i);
    });
    item.addEventListener("dblclick", () => {
      const newLabel = prompt("Enter section label (e.g. Verse 1, Chorus):", section.label);
      if (newLabel !== null) {
        const trimmed = newLabel.trim();
        if (trimmed) {
          section.label = trimmed;
          labelEl.textContent = trimmed;
          syncSongEditorHiddenTextarea();
          if (currentWorkspaceSong) {
            currentWorkspaceSong.sections = songEditorSections;
            renderSongSectionPreview(section);
            void syncActiveScheduledSongPresentation().catch(console.error);
          }
        }
      }
    });

    const indexEl = document.createElement("div");
    indexEl.className = "song-editor-slide-item__index";
    indexEl.textContent = i + 1;

    const detailsEl = document.createElement("div");
    detailsEl.className = "song-editor-slide-item__details";

    const labelEl = document.createElement("div");
    labelEl.className = "song-editor-slide-item__label";
    labelEl.textContent = section.label || `Section ${i + 1}`;

    const snippetEl = document.createElement("div");
    snippetEl.className = "song-editor-slide-item__snippet";
    const textContent = songSectionLyricsText(section);
    const linesText = textContent.split("\n")
      .filter(t => t.trim() !== "")
      .slice(0, 2)
      .join(" / ");
    snippetEl.textContent = linesText || "Empty slide";

    detailsEl.appendChild(labelEl);
    detailsEl.appendChild(snippetEl);
    item.appendChild(indexEl);
    item.appendChild(detailsEl);
    list.appendChild(item);
  });
}

function selectSongEditorSlide(index) {
  if (index < 0 || index >= songEditorSections.length) return;
  songEditorActiveIndex = index;

  const items = document.querySelectorAll(".song-editor-slide-item");
  items.forEach((item, i) => {
    if (i === index) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  const section = songEditorSections[index];
  const textarea = document.getElementById("songEditorSlideTextarea");
  if (textarea) {
    populateSongEditorTextarea(textarea, section);
  }

  const label = section.label || "";
  const match = label.match(/^(Verse|Chorus|Bridge|Pre-Chorus|Tag)\s*(\d*)$/i);
  const typeSelect = document.getElementById("songEditorSectionType");
  const numInput = document.getElementById("songEditorSectionNumber");
  const customInput = document.getElementById("songEditorSectionCustomLabel");

  if (typeSelect && numInput && customInput) {
    if (match) {
      typeSelect.value = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
      numInput.value = match[2] || "1";
      numInput.style.display = "block";
      customInput.style.display = "none";
    } else {
      typeSelect.value = "Custom";
      customInput.value = label;
      numInput.style.display = "none";
      customInput.style.display = "block";
    }
  }

  if (currentWorkspaceSong) {
    currentWorkspaceSong.sections = songEditorSections;
    currentSongSectionId = section.id;
    renderSongSectionPreview(section);
    void syncActiveScheduledSongPresentation().catch(console.error);
  }
}

function syncSongEditorWorkspaceStyles(message = null) {
  const style = mergeSongRenderState(currentSongRenderState, {
    backgroundColor: message?.backgroundColor,
    backgroundPath: message?.backgroundPath,
    color: message?.color,
    fontFamily: message?.fontFamily,
    fontSize: message?.fontSize,
    textBoxPosition: message?.textBoxPosition,
  });
  const preview = document.getElementById("songEditorLivePreviewSlide");
  const canvas = document.getElementById("songEditorSlideCanvas");
  if (canvas) {
    canvas.style.backgroundColor = style.backgroundColor || DEFAULT_SONG_RENDER.backgroundColor;
    if (message?.backgroundImage) {
      canvas.style.backgroundImage = `url('${message.backgroundImage}')`;
    } else {
      canvas.style.backgroundImage = "";
    }
    canvas.style.color = style.color || DEFAULT_SONG_RENDER.color;
    canvas.style.fontFamily = songFontFamilyCSS(style.fontFamily);
    canvas.style.setProperty("--base-font-size", style.fontSize || DEFAULT_SONG_RENDER.fontSize);
    canvas.style.setProperty("--font-family", songFontFamilyCSS(style.fontFamily));
  }
  if (preview) {
    preview.style.setProperty("--base-font-size", style.fontSize || DEFAULT_SONG_RENDER.fontSize);
    preview.style.setProperty("--font-family", songFontFamilyCSS(style.fontFamily));
  }
  const activeSection = Array.isArray(songEditorSections) && Number.isFinite(songEditorActiveIndex) 
    ? songEditorSections[songEditorActiveIndex] 
    : null;
  const sectionStyle = activeSection?.primary?.style || {};
  const activeColor = sectionStyle.color || style.color || DEFAULT_SONG_RENDER.color;
  const activeFontFamily = sectionStyle.fontFamily || style.fontFamily;
  const activeFontSize = sectionStyle.fontSize || style.fontSize || DEFAULT_SONG_RENDER.fontSize;

  const textBox = document.getElementById("songEditorTextBox");
  if (textBox) {
    textBox.style.color = activeColor;
    textBox.style.fontFamily = songFontFamilyCSS(activeFontFamily);
    textBox.style.setProperty("--base-font-size", activeFontSize);
    textBox.style.setProperty("--font-family", songFontFamilyCSS(activeFontFamily));
  }
  const textarea = document.getElementById("songEditorSlideTextarea");
  if (textarea) {
    textarea.style.color = activeColor;
    textarea.style.fontFamily = songFontFamilyCSS(activeFontFamily);
    textarea.style.setProperty("--font-family", songFontFamilyCSS(activeFontFamily));
  }
  if (textBox && style.textBoxPosition) {
    const pos = style.textBoxPosition;
    textBox.style.left = pos.left;
    textBox.style.top = pos.top;
    textBox.style.width = pos.width;
    textBox.style.height = pos.height;
  }
}

function initSongEditorTextBoxDragAndDrop() {
  const textBox = document.getElementById("songEditorTextBox");
  const canvas = document.getElementById("songEditorSlideCanvas");
  const handle = document.getElementById("songEditorDragHandle");
  const resizeHandle = document.getElementById("songEditorResizeHandle");

  if (!textBox || !canvas || !handle) return;

  let isDragging = false;
  let isResizing = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let startWidth = 0;
  let startHeight = 0;
  let resizeStartLeft = 0;
  let resizeStartTop = 0;

  const snapThreshold = 10;
  const minResizeWidth = 72;
  const minResizeHeight = 48;

  const clamp = (value, min, max) => {
    if (!Number.isFinite(max) || max <= 0) return min;
    if (max < min) return max;
    return Math.max(min, Math.min(value, max));
  };

  const toPercent = (value, total) => {
    if (!total) return "0%";
    return `${(value / total) * 100}%`;
  };

  const renderActiveSongEditorSection = () => {
    if (!currentWorkspaceSong) return;
    const section =
      enabledSongSections(currentWorkspaceSong).find((s) => s.id === currentSongSectionId) ||
      currentWorkspaceSong.sections?.[0];
    if (section) renderSongSectionPreview(section);
  };

  const saveTextBoxPosition = () => {
    if (!currentSongRenderState) return;
    currentSongRenderState.textBoxPosition = {
      left: textBox.style.left || "10%",
      top: textBox.style.top || "10%",
      width: textBox.style.width || "80%",
      height: textBox.style.height || "80%",
    };
    syncCurrentWorkspaceSongDefaultRender();
    renderActiveSongEditorSection();
    void syncActiveScheduledSongPresentation().catch(console.error);
  };

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = textBox.offsetLeft;
    startTop = textBox.offsetTop;

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  function onMouseMove(e) {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newLeft = startLeft + dx;
    let newTop = startTop + dy;

    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;
    const boxWidth = textBox.offsetWidth;
    const boxHeight = textBox.offsetHeight;

    const guideV = document.getElementById("snapGuideV");
    const guideH = document.getElementById("snapGuideH");
    let showGuideV = false;
    let showGuideH = false;

    const boxCenterH = newLeft + boxWidth / 2;
    const canvasCenterH = canvasWidth / 2;
    const marginL = canvasWidth * 0.1;
    const marginR = canvasWidth * 0.9;

    if (Math.abs(boxCenterH - canvasCenterH) < snapThreshold) {
      newLeft = canvasCenterH - boxWidth / 2;
      showGuideV = true;
      if (guideV) guideV.style.left = `${canvasCenterH}px`;
    } else if (Math.abs(newLeft - marginL) < snapThreshold) {
      newLeft = marginL;
      showGuideV = true;
      if (guideV) guideV.style.left = `${marginL}px`;
    } else if (Math.abs((newLeft + boxWidth) - marginR) < snapThreshold) {
      newLeft = marginR - boxWidth;
      showGuideV = true;
      if (guideV) guideV.style.left = `${marginR}px`;
    }

    const boxCenterV = newTop + boxHeight / 2;
    const canvasCenterV = canvasHeight / 2;
    const marginT = canvasHeight * 0.1;
    const marginB = canvasHeight * 0.9;

    if (Math.abs(boxCenterV - canvasCenterV) < snapThreshold) {
      newTop = canvasCenterV - boxHeight / 2;
      showGuideH = true;
      if (guideH) guideH.style.top = `${canvasCenterV}px`;
    } else if (Math.abs(newTop - marginT) < snapThreshold) {
      newTop = marginT;
      showGuideH = true;
      if (guideH) guideH.style.top = `${marginT}px`;
    } else if (Math.abs((newTop + boxHeight) - marginB) < snapThreshold) {
      newTop = marginB - boxHeight;
      showGuideH = true;
      if (guideH) guideH.style.top = `${marginB}px`;
    }

    if (guideV) guideV.style.display = showGuideV ? "block" : "none";
    if (guideH) guideH.style.display = showGuideH ? "block" : "none";

    newLeft = Math.max(0, Math.min(newLeft, canvasWidth - boxWidth));
    newTop = Math.max(0, Math.min(newTop, canvasHeight - boxHeight));

    const leftPct = (newLeft / canvasWidth) * 100;
    const topPct = (newTop / canvasHeight) * 100;

    textBox.style.left = `${leftPct}%`;
    textBox.style.top = `${topPct}%`;
  }

  function onMouseUp() {
    if (!isDragging) return;
    isDragging = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);

    const guideV = document.getElementById("snapGuideV");
    const guideH = document.getElementById("snapGuideH");
    if (guideV) guideV.style.display = "none";
    if (guideH) guideH.style.display = "none";

    saveTextBoxPosition();
  }

  if (resizeHandle) {
    resizeHandle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;

      const textBoxRect = textBox.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      startWidth = textBoxRect.width;
      startHeight = textBoxRect.height;
      resizeStartLeft = textBoxRect.left - canvasRect.left;
      resizeStartTop = textBoxRect.top - canvasRect.top;

      document.addEventListener("mousemove", onResizeMove);
      document.addEventListener("mouseup", onResizeUp);
    });
  }

  function onResizeMove(e) {
    if (!isResizing) return;

    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;
    if (!canvasWidth || !canvasHeight) return;

    const maxWidth = Math.max(0, canvasWidth - resizeStartLeft);
    const maxHeight = Math.max(0, canvasHeight - resizeStartTop);
    const width = clamp(
      startWidth + e.clientX - startX,
      Math.min(minResizeWidth, maxWidth),
      maxWidth,
    );
    const height = clamp(
      startHeight + e.clientY - startY,
      Math.min(minResizeHeight, maxHeight),
      maxHeight,
    );

    textBox.style.width = toPercent(width, canvasWidth);
    textBox.style.height = toPercent(height, canvasHeight);
  }

  function onResizeUp() {
    if (!isResizing) return;
    isResizing = false;
    document.removeEventListener("mousemove", onResizeMove);
    document.removeEventListener("mouseup", onResizeUp);
    saveTextBoxPosition();
  }
}

function getOrCreateBodyColorInput(id, realInputId) {
  let input = document.getElementById(id);
  if (!input) {
    input = document.createElement("input");
    input.type = "color";
    input.id = id;
    input.style.position = "fixed";
    input.style.left = "-100px";
    input.style.top = "-100px";
    input.style.width = "32px";
    input.style.height = "32px";
    input.style.opacity = "0.01";
    input.style.pointerEvents = "none";
    input.style.zIndex = "999999";
    input.style.border = "0";
    input.style.margin = "0";
    input.style.padding = "0";
    document.body.appendChild(input);

    const updateRealInput = (e) => {
      const realInput = document.getElementById(realInputId);
      if (realInput) {
        realInput.value = e.target.value;
        realInput.dispatchEvent(new Event("input"));
        realInput.dispatchEvent(new Event("change"));
      }
    };
    input.addEventListener("input", updateRealInput);
    input.addEventListener("change", updateRealInput);
  }
  return input;
}

function initSongEditorContextMenu() {
  const canvas = document.getElementById("songEditorSlideCanvas");
  const textarea = document.getElementById("songEditorSlideTextarea");
  const menu = document.getElementById("songEditorContextMenu");

  if (!canvas || !textarea || !menu) return;

  let menuAnchor = { x: 0, y: 0 };

  const hideMenu = () => {
    menu.style.display = "none";
    menu.style.visibility = "";
  };

  const positionColorInput = (input, fallbackEvent) => {
    const anchorX = Number.isFinite(menuAnchor.x) && menuAnchor.x > 0
      ? menuAnchor.x
      : fallbackEvent?.clientX || 0;
    const anchorY = Number.isFinite(menuAnchor.y) && menuAnchor.y > 0
      ? menuAnchor.y
      : fallbackEvent?.clientY || 0;
    const x = Math.max(0, Math.min(anchorX, window.innerWidth - input.offsetWidth));
    const y = Math.max(0, Math.min(anchorY, window.innerHeight - input.offsetHeight));
    input.style.left = `${x}px`;
    input.style.top = `${y}px`;
    input.getBoundingClientRect();
  };

  const showColorInputPicker = (input) => {
    input.focus({ preventScroll: true });
    try {
      if (typeof input.showPicker === "function") {
        input.showPicker();
        return;
      }
    } catch (err) {
      console.debug("Color input showPicker failed, falling back to click:", err);
    }
    input.click();
  };

  const openColorPickerFromMenu = (event, inputId, realInputId) => {
    event.preventDefault();
    event.stopPropagation();
    const colorInput = getOrCreateBodyColorInput(inputId, realInputId);
    const realInput = document.getElementById(realInputId);
    if (realInput) {
      colorInput.value = realInput.value;
    }
    positionColorInput(colorInput, event);
    hideMenu();
    showColorInputPicker(colorInput);
  };

  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || menu.style.display === "none") return;
    if (menu.contains(event.target)) return;
    hideMenu();
  }, true);

  document.addEventListener("click", (event) => {
    if (menu.contains(event.target)) return;
    hideMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideMenu();
  });

  textarea.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setSongEditorStyleScope("selection");

    menu.innerHTML = "";

    const header = document.createElement("div");
    header.className = "song-editor-context-menu__header";
    header.textContent = "Text Format";
    menu.appendChild(header);

    const colorOpt = document.createElement("div");
    colorOpt.className = "song-editor-context-menu__item";
    colorOpt.innerHTML = `<span class="icon">🎨</span> Change Text Color`;
    colorOpt.addEventListener("click", (evt) => {
      setSongEditorStyleScope("selection");
      openColorPickerFromMenu(evt, "tempBodyTextColorInput", "songEditorTextColor");
    });
    menu.appendChild(colorOpt);

    menu.appendChild(document.createElement("div")).className = "song-editor-context-menu__separator";

    const fontHeader = document.createElement("div");
    fontHeader.className = "song-editor-context-menu__header";
    fontHeader.textContent = "Font Family";
    menu.appendChild(fontHeader);

    const fontInput = document.getElementById("songEditorFontInput");
    const fonts = fontInput
      ? Array.from(fontInput.options).map((option) => ({
          label: option.textContent || option.value,
          value: option.value,
        }))
      : [
          { label: "CMG Sans", value: "'CMG Sans'" },
          { label: "Arial", value: "'Arial'" },
          { label: "Times New Roman", value: "'Times New Roman'" },
          { label: "Georgia", value: "'Georgia'" },
        ];
    for (const font of fonts) {
      const fontOpt = document.createElement("div");
      fontOpt.className = "song-editor-context-menu__item";
      fontOpt.textContent = font.label;
      if (currentSongRenderState.fontFamily === font.value) {
        fontOpt.classList.add("song-editor-context-menu__item--active");
      }
      fontOpt.addEventListener("click", () => {
        if (fontInput) {
          setSongEditorStyleScope("selection");
          fontInput.value = font.value;
          fontInput.dispatchEvent(new Event("change"));
        }
        hideMenu();
      });
      menu.appendChild(fontOpt);
    }

    showMenu(e.clientX, e.clientY);
  });

  canvas.addEventListener("contextmenu", (e) => {
    if (e.target === textarea) return;
    e.preventDefault();
    e.stopPropagation();
    showBackgroundMenu(e.clientX, e.clientY);
  });

  function showBackgroundMenu(x, y) {
    menu.innerHTML = "";

    const header = document.createElement("div");
    header.className = "song-editor-context-menu__header";
    header.textContent = "Background Options";
    menu.appendChild(header);

    const colorOpt = document.createElement("div");
    colorOpt.className = "song-editor-context-menu__item";
    colorOpt.innerHTML = `<span class="icon">🎨</span> Change Background Color`;
    colorOpt.addEventListener("click", (evt) => {
      openColorPickerFromMenu(evt, "tempBodyBackgroundColorInput", "songEditorBackgroundColor");
    });
    menu.appendChild(colorOpt);

    const graphicOpt = document.createElement("div");
    graphicOpt.className = "song-editor-context-menu__item";
    graphicOpt.innerHTML = `<span class="icon">🖼️</span> Choose Background Graphic`;
    graphicOpt.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      hideMenu();
      document.getElementById("songEditorBackgroundInput")?.click();
    });
    menu.appendChild(graphicOpt);

    if (currentSongRenderState.backgroundPath) {
      const clearOpt = document.createElement("div");
      clearOpt.className = "song-editor-context-menu__item";
      clearOpt.innerHTML = `<span class="icon">❌</span> Clear Background`;
      clearOpt.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        hideMenu();
        document.getElementById("songEditorClearBackgroundBtn")?.click();
      });
      menu.appendChild(clearOpt);
    }

    showMenu(x, y);
  }

  function showMenu(x, y) {
    menuAnchor = { x, y };
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.visibility = "hidden";
    menu.style.display = "block";

    const rect = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, Math.max(8, window.innerWidth - rect.width - 8)));
    const top = Math.max(8, Math.min(y, Math.max(8, window.innerHeight - rect.height - 8)));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = "";
  }
}

function handleSongEditorCanvasTextInput(editorDiv) {
  const activeSection = songEditorSections[songEditorActiveIndex];
  if (!activeSection) return;

  const previousBlocks = Array.isArray(activeSection.blocks) ? activeSection.blocks : [];
  const blocks = [];

  for (const node of editorDiv.childNodes) {
    if (node.nodeType === 3) { // Text node outside div
      if (node.textContent.trim() !== "") {
        blocks.push({
          type: "lyricLine",
          id: "block_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
          primary: { lang: "en", segments: [{ type: "text", text: node.textContent }] },
          translations: [], annotations: []
        });
      }
    } else if (node.nodeType === 1) { // Element
      if (node.tagName === "BR") {
        blocks.push({ type: "spacer", id: "block_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6) });
      } else if (node.tagName === "DIV" || node.tagName === "P") {
        const segments = [];
        const walk = (n, currentStyle) => {
          if (n.nodeType === 3) {
            if (n.textContent) segments.push({ type: "text", text: n.textContent, style: currentStyle });
          } else if (n.nodeType === 1 && n.tagName !== "BR") {
            const newStyle = { ...currentStyle };
            if (n.style.fontFamily) newStyle.fontFamily = n.style.fontFamily;
            if (n.style.color) newStyle.color = n.style.color;
            for (const child of n.childNodes) walk(child, newStyle);
          }
        };
        for (const child of node.childNodes) walk(child, {});
        
        let blockId = node.dataset.blockId || ("block_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6));
        const existingBlock = previousBlocks.find(b => b.id === blockId);
        
        if (segments.length === 0) {
          blocks.push(existingBlock && existingBlock.type === "spacer" ? existingBlock : { type: "spacer", id: blockId });
        } else {
          blocks.push({
            type: "lyricLine",
            id: blockId,
            primary: { lang: "en", segments },
            translations: existingBlock?.translations || [],
            annotations: existingBlock?.annotations || [],
          });
        }
      }
    }
  }

  activeSection.blocks = blocks;

  syncSongEditorHiddenTextarea();

  if (currentWorkspaceSong) {
    currentWorkspaceSong.sections = songEditorSections;
    currentSongSectionId = activeSection.id;
    renderSongSectionPreview(activeSection);
    void syncActiveScheduledSongPresentation().catch(console.error);
  }

  const snippetEl = document.querySelector(`.song-editor-slide-item[data-index="${songEditorActiveIndex}"] .song-editor-slide-item__snippet`);
  if (snippetEl) {
    snippetEl.textContent = songSectionBlockTexts(activeSection).filter(t => t.trim() !== "").slice(0, 2).join(" / ") || "Empty slide";
  }
}

function syncSongEditorHiddenTextarea() {
  const hiddenTextarea = document.getElementById("songEditorTextarea");
  if (hiddenTextarea) {
    hiddenTextarea.value = songEditorTextFromSections(songEditorSections);
  }
}

function handleSongEditorSectionMetaChange() {
  const activeSection = songEditorSections[songEditorActiveIndex];
  if (!activeSection) return;

  const typeSelect = document.getElementById("songEditorSectionType");
  const numInput = document.getElementById("songEditorSectionNumber");
  const customInput = document.getElementById("songEditorSectionCustomLabel");

  if (!typeSelect || !numInput || !customInput) return;

  let label = "";
  if (typeSelect.value === "Custom") {
    customInput.style.display = "block";
    numInput.style.display = "none";
    label = customInput.value.trim();
    activeSection.kind = "custom";
  } else {
    customInput.style.display = "none";
    numInput.style.display = "block";
    const type = typeSelect.value;
    const num = numInput.value;
    label = `${type} ${num}`.trim();
    activeSection.kind = type.toLowerCase();
    activeSection.number = Number(num) || 1;
  }

  activeSection.label = label || "Untitled Section";

  const labelEl = document.querySelector(`.song-editor-slide-item[data-index="${songEditorActiveIndex}"] .song-editor-slide-item__label`);
  if (labelEl) {
    labelEl.textContent = activeSection.label;
  }

  syncSongEditorHiddenTextarea();
  if (currentWorkspaceSong) {
    currentWorkspaceSong.sections = songEditorSections;
    currentSongSectionId = activeSection.id;
    renderSongSectionPreview(activeSection);
    void syncActiveScheduledSongPresentation().catch(console.error);
  }
}

function handleSongEditorAddSection() {
  const verseCount = songEditorSections.filter(s => s.kind === "verse").length;
  const newSection = {
    id: `sec_${crypto.randomUUID().slice(0, 8)}`,
    kind: "verse",
    number: verseCount + 1,
    label: `Verse ${verseCount + 1}`,
    blocks: []
  };
  songEditorSections.splice(songEditorActiveIndex + 1, 0, newSection);
  syncSongEditorHiddenTextarea();
  renderSongEditorSlideList();
  selectSongEditorSlide(songEditorActiveIndex + 1);
}

function handleSongEditorDeleteSection() {
  if (songEditorSections.length <= 1) {
    showGnomeToast("Cannot delete the only section.");
    return;
  }
  const indexToDelete = songEditorActiveIndex;
  songEditorSections.splice(indexToDelete, 1);
  syncSongEditorHiddenTextarea();
  renderSongEditorSlideList();
  const nextIndex = Math.min(indexToDelete, songEditorSections.length - 1);
  selectSongEditorSlide(nextIndex);
}

function handleSongEditorMoveSectionUp() {
  if (songEditorActiveIndex <= 0) return;
  const idx = songEditorActiveIndex;
  const temp = songEditorSections[idx];
  songEditorSections[idx] = songEditorSections[idx - 1];
  songEditorSections[idx - 1] = temp;
  syncSongEditorHiddenTextarea();
  renderSongEditorSlideList();
  selectSongEditorSlide(idx - 1);
}

function handleSongEditorMoveSectionDown() {
  if (songEditorActiveIndex >= songEditorSections.length - 1) return;
  const idx = songEditorActiveIndex;
  const temp = songEditorSections[idx];
  songEditorSections[idx] = songEditorSections[idx + 1];
  songEditorSections[idx + 1] = temp;
  syncSongEditorHiddenTextarea();
  renderSongEditorSlideList();
  selectSongEditorSlide(idx + 1);
}

function closeSongEditor() {
  document.getElementById("songEditorDrawer")?.setAttribute("hidden", "");
  restoreSongWorkspaceView();
  if (currentWorkspaceSong) {
    const activeSection =
      enabledSongSections(currentWorkspaceSong).find((s) => s.id === currentSongSectionId) ||
      currentWorkspaceSong.sections?.[0] ||
      null;
    if (activeSection) renderSongSectionPreview(activeSection);
  }
}

async function refreshSongFolders(prefetchedFolders = null) {
  try {
    songFoldersCache = asSongArray(
      prefetchedFolders ?? (await songsAPI.listFolders()),
    );
  } catch (err) {
    console.error("Failed to load song folders:", err);
    songFoldersCache = [];
  }

  const list = document.getElementById("songsFolderList");
  if (!list) return;

  list.innerHTML = "";
  const entries = [
    { id: SONG_FOLDER_ALL, name: "All Songs", count: null },
    ...songFoldersCache.map((folder) => ({
      id: folder.id,
      name: folder.name,
      count: folder.songCount,
    })),
  ];

  for (const entry of entries) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "songs-folder-item";
    row.dataset.folderId = entry.id;
    if (entry.id === currentSongFolderFilter) {
      row.classList.add("is-selected");
    }

    const label = document.createElement("span");
    label.textContent = entry.name;
    row.appendChild(label);

    if (Number.isFinite(entry.count)) {
      const count = document.createElement("span");
      count.className = "songs-folder-item__count";
      count.textContent = String(entry.count);
      row.appendChild(count);
    }

    row.addEventListener("click", () => {
      currentSongFolderFilter = entry.id;
      clearSongSelection();
      list.querySelectorAll(".songs-folder-item").forEach((el) => {
        el.classList.toggle("is-selected", el === row);
      });
      const searchInput = document.getElementById("songsSearchInput");
      void refreshSongsBrowser(searchInput?.value || "").catch(console.error);
    });

    if (entry.id !== SONG_FOLDER_ALL) {
      row.addEventListener("dragover", (event) => {
        if (!songDragSongId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        list.querySelectorAll(".songs-folder-item--drag-over").forEach((el) => {
          if (el !== row) el.classList.remove("songs-folder-item--drag-over");
        });
        row.classList.add("songs-folder-item--drag-over");
      });
      row.addEventListener("dragleave", (event) => {
        if (
          typeof event.relatedTarget === "object" &&
          event.relatedTarget &&
          row.contains(event.relatedTarget)
        ) {
          return;
        }
        row.classList.remove("songs-folder-item--drag-over");
      });
      row.addEventListener("drop", (event) => {
        if (!songDragSongId) return;
        event.preventDefault();
        event.stopPropagation();
        row.classList.remove("songs-folder-item--drag-over");
        const songId = songDragSongId;
        clearSongDragVisualState();
        const folderId = entry.id === SONG_FOLDER_UNFILED ? null : entry.id;
        void songsAPI
          .moveToFolder(songId, folderId)
          .then(async (updated) => {
            if (updated && currentWorkspaceSong?.id === songId) {
              currentWorkspaceSong = updated;
            } else if (currentWorkspaceSong?.id === songId) {
              currentWorkspaceSong.folderId = folderId;
            }
            syncSongsMoveFolderSelect(currentWorkspaceSong);
            await refreshSongFolders();
            const searchInput = document.getElementById("songsSearchInput");
            await refreshSongsBrowser(searchInput?.value || "");
            showGnomeToast("Song moved");
          })
          .catch((err) => {
            console.error("Failed to move song to folder:", err);
            showGnomeToast("Failed to move song");
          });
      });
    }

    list.appendChild(row);
  }

  syncSongEditorFolderOptions();
  syncSongsMoveFolderSelect();
  syncSongsBulkMoveFolderOptions();
}

function readSongEditorRenderState() {
  const fontInput = document.getElementById("songEditorFontInput");
  const fontSizeInput = document.getElementById("songEditorFontSizeInput");
  const autosizeModeInput = document.getElementById("songEditorAutosizeModeInput");
  const minFontSizeInput = document.getElementById("songEditorMinFontSizeInput");
  const textColor = document.getElementById("songEditorTextColor")?.value;
  const backgroundColor = document.getElementById("songEditorBackgroundColor")?.value;
  const transition = readSlideTransitionControls(
    "songEditorTransitionEffect",
    "songEditorTransitionDuration",
    { allowInherit: true },
  );
  return mergeSongRenderState(currentSongRenderState, {
    fontFamily: fontInput ? fontInput.value : DEFAULT_SONG_RENDER.fontFamily,
    fontSize: fontSizeInput && fontSizeInput.value ? Number(fontSizeInput.value) : DEFAULT_SONG_RENDER.fontSize,
    autosizeMode: autosizeModeInput ? autosizeModeInput.value : DEFAULT_SONG_RENDER.autosizeMode,
    minFontSize: minFontSizeInput && minFontSizeInput.value ? Number(minFontSizeInput.value) : DEFAULT_SONG_RENDER.minFontSize,
    color: textColor || DEFAULT_SONG_RENDER.color,
    backgroundColor: backgroundColor || DEFAULT_SONG_RENDER.backgroundColor,
    backgroundPath: currentSongRenderState.backgroundPath || "",
    textBoxPosition: currentSongRenderState.textBoxPosition || null,
    transition,
  });
}

function syncSongEditorRenderControls(render = currentSongRenderState) {
  const fontInput = document.getElementById("songEditorFontInput");
  const fontSizeInput = document.getElementById("songEditorFontSizeInput");
  const autosizeModeInput = document.getElementById("songEditorAutosizeModeInput");
  const minFontSizeInput = document.getElementById("songEditorMinFontSizeInput");
  const textColorInput = document.getElementById("songEditorTextColor");
  const backgroundColorInput = document.getElementById("songEditorBackgroundColor");

  if (fontInput) fontInput.value = render.fontFamily || DEFAULT_SONG_RENDER.fontFamily;
  if (fontSizeInput) fontSizeInput.value = render.fontSize || DEFAULT_SONG_RENDER.fontSize;
  if (autosizeModeInput) autosizeModeInput.value = render.autosizeMode || DEFAULT_SONG_RENDER.autosizeMode;
  if (minFontSizeInput) minFontSizeInput.value = render.minFontSize || DEFAULT_SONG_RENDER.minFontSize;

  if (textColorInput) textColorInput.value = render.color || DEFAULT_SONG_RENDER.color;
  if (backgroundColorInput) {
    backgroundColorInput.value = render.backgroundColor || DEFAULT_SONG_RENDER.backgroundColor;
  }
  syncSlideTransitionControls(
    "songEditorTransitionEffect",
    "songEditorTransitionDuration",
    render.transition,
    { allowInherit: true },
  );
  syncSongBackgroundLabel(render.backgroundPath || "");
}

function syncSongBackgroundLabel(filePath = currentSongRenderState.backgroundPath) {
  const label = document.getElementById("songEditorBackgroundLabel");
  if (!label) return;
  if (!filePath) {
    label.textContent = "No background image";
    return;
  }
  label.textContent = queueBasename(filePath);
}

function syncCurrentWorkspaceSongDefaultRender() {
  if (!currentWorkspaceSong) return;
  currentWorkspaceSong.defaultRender = songDefaultRenderFromRender(currentSongRenderState);
  if (currentWorkspaceSongDeck) {
    currentWorkspaceSongDeck = songDeckDocumentFromSongDocument(
      currentWorkspaceSongDeck,
      currentSongRenderState,
    );
  }
}

function currentWorkspaceSongSequenceEntries() {
  const arrangedEntries = arrangementSequenceEntries(currentWorkspaceSong);
  if (
    !currentSongSectionId ||
    arrangedEntries.some(
      (entry) => entry.enabled !== false && entry.sectionId === currentSongSectionId,
    )
  ) {
    return arrangedEntries;
  }
  return (currentWorkspaceSong?.sections || [])
    .map((section, index) => (
      section?.id
        ? { id: `workspace_${index}_${section.id}`, sectionId: section.id, enabled: true }
        : null
    ))
    .filter(Boolean);
}

function flushSongEditorStateForSave() {
  const slideTextarea = document.getElementById("songEditorSlideTextarea");
  const activeSection = songEditorSections[songEditorActiveIndex];
  if (slideTextarea && activeSection) {
    handleSongEditorCanvasTextInput(slideTextarea);
  }
  currentSongRenderState = readSongEditorRenderState();
  if (currentWorkspaceSong) {
    currentWorkspaceSong.sections = songEditorSections;
  }
  syncCurrentWorkspaceSongDefaultRender();
  return currentSongRenderState;
}

function currentSongPresentationItem() {
  if (!currentWorkspaceSongDeck && !currentWorkspaceSong) return null;
  return buildSongQueueEntryFromDeck({
    deck: currentWorkspaceSongDeck || currentWorkspaceSong,
    render: {
      ...currentSongRenderState,
      currentSectionId: currentSongSectionId,
    },
    currentSectionId: currentSongSectionId,
  });
}

function songPresentationSourceId(item) {
  return (
    item?.deckSnapshot?.id ||
    item?.songSnapshot?.id ||
    item?.source?.songId ||
    parseSongQueuePath(item?.path) ||
    null
  );
}

function markSongShowNowPresentation(item) {
  const sourceId = songPresentationSourceId(item);
  songShowNowModeActive = Boolean(sourceId);
  songShowNowSourceId = sourceId;
}

function clearSongShowNowPresentation() {
  songShowNowModeActive = false;
  songShowNowSourceId = null;
}

function isCurrentWorkspaceSongShownNow() {
  return Boolean(
    songShowNowModeActive &&
      currentWorkspaceSong &&
      songShowNowSourceId &&
      currentWorkspaceSong.id === songShowNowSourceId
  );
}

async function loadSongItemIntoWorkspace(item, token) {
  currentSongQueueItem = item || null;
  if (item?.deckSnapshot) {
    const deck = normalizeSlideDeck(item.deckSnapshot);
    const itemRender = songRenderFromItem({
      ...item,
      songSnapshot: deckToTransientSong(deck),
    });
    currentSongRenderState = mergeSongRenderState(songRenderStateFromSongDocument(deck), itemRender);
    currentSongSectionId = itemRender.currentSectionId || item?.source?.pageId || null;
    if (typeof token === "number" && !isCurrentPreviewLoad(token)) return;
    await loadSongIntoWorkspace(deck, { render: currentSongRenderState });
    return;
  }
  if (item?.songSnapshot) {
    const songSnapshot = transientSongFromSongDocument(item.songSnapshot);
    const itemRender = songRenderFromItem({ ...item, songSnapshot });
    currentSongRenderState = itemRender;
    currentSongSectionId = itemRender.currentSectionId || null;
    if (typeof token === "number" && !isCurrentPreviewLoad(token)) return;
    await loadSongIntoWorkspace(item.songSnapshot, { render: itemRender });
    return;
  }
  if (item?.source?.songId) {
    const song = await songsAPI.get(item.source.songId);
    if (typeof token === "number" && !isCurrentPreviewLoad(token)) return;
    const songSnapshot = transientSongFromSongDocument(song);
    const itemRender = songRenderFromItem({ ...item, songSnapshot });
    currentSongRenderState = mergeSongRenderState(songRenderStateFromSongDocument(song), itemRender);
    currentSongSectionId = itemRender.currentSectionId || null;
    await loadSongIntoWorkspace(song, { render: itemRender });
  }
}

function queueItemDeckId(item) {
  if (!item || typeof item !== "object") return null;
  return (
    item.deckSnapshot?.id ||
    item.source?.deckId ||
    parseDeckQueuePath(item.path) ||
    null
  );
}

function queueItemMatchesDeck(item, deck) {
  const itemDeckId = queueItemDeckId(item);
  return Boolean(deck?.id && itemDeckId && itemDeckId === deck.id);
}

function normalizedCssUnit(value, fallback) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.endsWith("%")) {
      const pct = Number.parseFloat(trimmed.slice(0, -1));
      return Number.isFinite(pct) ? pct / 100 : fallback;
    }
    if (/px$/i.test(trimmed)) return fallback;
    const numeric = Number.parseFloat(trimmed);
    if (Number.isFinite(numeric)) return numeric > 1 ? numeric / 100 : numeric;
    return fallback;
  }
  if (Number.isFinite(value)) return value > 1 ? value / 100 : value;
  return fallback;
}

function frameFromSongTextBoxPosition(position = {}) {
  const fallback = DEFAULT_TEXT_FRAME;
  return normalizeSlideTextObjectFrame({
    x: normalizedCssUnit(position.left, fallback.x),
    y: normalizedCssUnit(position.top, fallback.y),
    width: normalizedCssUnit(position.width, fallback.width),
    height: normalizedCssUnit(position.height, fallback.height),
  });
}

function blocksClone(blocks, fallbackText = "") {
  const source = Array.isArray(blocks) && blocks.length
    ? blocks
    : textToSegmentsBlocks(fallbackText);
  try {
    return structuredClone(source);
  } catch {
    return JSON.parse(JSON.stringify(source));
  }
}

function compactStyle(style) {
  return Object.fromEntries(
    Object.entries(style || {}).filter(([, value]) => value !== undefined && value !== null),
  );
}

function deckObjectFromSongPresentation(object, { fallbackText = "", sectionId = "", pageIndex = 0, objectIndex = 0 } = {}) {
  const hasImage = object?.kind === "image" || (object?.image && typeof object.image === "object");
  const hasShape = object?.kind === "shape" || (object?.shape && typeof object.shape === "object");
  const kind = hasImage ? "image" : hasShape ? "shape" : "text";
  const base = {
    id: object?.id || `obj_${sectionId || pageIndex}_${objectIndex}`,
    kind,
    frame: frameFromSongTextBoxPosition(object?.textBoxPosition || {}),
    zIndex: Number.isFinite(object?.zIndex) ? object.zIndex : objectIndex + 1,
    opacity: Number.isFinite(object?.opacity) ? object.opacity : 1,
  };

  if (kind === "image") {
    const image = object?.image && typeof object.image === "object" ? object.image : {};
    return {
      ...base,
      image: {
        path: typeof image.path === "string" ? image.path : "",
        ...(image.assetId ? { assetId: String(image.assetId) } : {}),
        fit: image.fit === "cover" || image.fit === "fill" ? image.fit : "contain",
      },
    };
  }

  if (kind === "shape") {
    const shape = object?.shape && typeof object.shape === "object" ? object.shape : {};
    return {
      ...base,
      shape: {
        type: shape.type === "ellipse" || shape.type === "line" ? shape.type : "rect",
        fill: shape.fill || "#ffffff",
        ...(shape.stroke ? { stroke: shape.stroke } : {}),
        strokeWidth: Number.isFinite(shape.strokeWidth) ? shape.strokeWidth : 0,
        radius: Number.isFinite(shape.radius) ? shape.radius : 0,
      },
    };
  }

  return {
    ...base,
    role: "body",
    autofit: object?.autofit || "fit",
    style: compactStyle({
      color: object?.color,
      fontFamily: object?.fontFamily,
      fontSize: Number.isFinite(Number(object?.fontSize)) ? Number(object.fontSize) : undefined,
      minFontSize: Number.isFinite(Number(object?.minFontSize)) ? Number(object.minFontSize) : undefined,
      align: object?.align,
      verticalAlign: object?.verticalAlign,
      fontWeight: object?.fontWeight,
      fontStyle: object?.fontStyle,
      textDecoration: object?.textDecoration,
      lineHeight: Number.isFinite(Number(object?.lineHeight)) ? Number(object.lineHeight) : undefined,
    }),
    ...(object?.background && typeof object.background === "object"
      ? { background: { ...object.background } }
      : {}),
    blocks: blocksClone(object?.blocks, fallbackText),
  };
}

function deckFromSongQueueItem(item) {
  const song = item?.songSnapshot ? normalizeToSongAST(item.songSnapshot) : null;
  if (!song?.sections?.length) return null;
  const render = {
    ...(song.defaultRender && typeof song.defaultRender === "object" ? song.defaultRender : {}),
    ...(item.render && typeof item.render === "object" ? item.render : {}),
  };
  const theme = {
    ...DEFAULT_DECK_THEME,
    ...(render.fontFamily ? { fontFamily: render.fontFamily } : {}),
    ...(Number.isFinite(Number(render.fontSize)) ? { fontSize: Number(render.fontSize) } : {}),
    ...(render.color ? { textColor: render.color } : {}),
    ...(render.backgroundColor ? { backgroundColor: render.backgroundColor } : {}),
  };
  const pages = song.sections.map((section, index) => {
    const fallbackText = blocksToText(section.blocks || []);
    const sectionObjects = Array.isArray(section.slideObjects) && section.slideObjects.length
      ? section.slideObjects
      : Array.isArray(section.slideTextObjects) && section.slideTextObjects.length
        ? section.slideTextObjects
        : null;
    const objects = sectionObjects
      ? sectionObjects.map((object, objectIndex) => deckObjectFromSongPresentation(object, {
          fallbackText,
          sectionId: section.id,
          pageIndex: index,
          objectIndex,
        }))
      : [createTextObject({ text: fallbackText })];
    return {
      id: section.id || `page_${index + 1}`,
      label: section.label || `Page ${index + 1}`,
      durationMs: 0,
      autoAdvance: false,
      background: {
        type: "color",
        color: theme.backgroundColor || DEFAULT_DECK_THEME.backgroundColor,
      },
      notes: "",
      objects,
    };
  });
  return normalizeSlideDeck({
    id: queueItemDeckId(item) || song.id,
    title: item?.name || song.title || "Slide Deck",
    folderId: null,
    theme,
    pages,
  });
}

function deckFromQueueItem(item) {
  if (!isQueueItemDeck(item)) return null;
  const snapshot = item?.deckSnapshot ? normalizeSlideDeck(item.deckSnapshot) : null;
  return snapshot || deckFromSongQueueItem(item);
}

async function loadDeckQueueItemIntoWorkspace(item, token) {
  const deck = deckFromQueueItem(item);
  if (!deck) return false;
  if (typeof token === "number" && !isCurrentPreviewLoad(token)) return false;
  const pageId =
    item?.render?.currentSectionId ||
    item?.source?.pageId ||
    deck.pages?.[0]?.id ||
    null;
  currentSongQueueItem = item || null;
  currentWorkspaceSongDeck = deck;
  currentWorkspaceSong = item?.songSnapshot || deckToTransientSong(deck);
  currentSongRenderState = mergeSongRenderState(
    DEFAULT_SONG_RENDER,
    item?.render || deckDefaultRender(deck),
  );
  currentSongSectionId = pageId;
  loadDeckIntoWorkspace(deck, {
    pageId,
    queueItem: item || null,
    documentType: item?.type === "song" ? SONG_DECK_DOCUMENT_TYPE : "deck",
  });
  return true;
}

async function loadSongIntoWorkspace(song, opts = {}) {
  const sourceDocument = song || null;
  currentWorkspaceSongDeck = sourceDocument
    ? songDeckDocumentFromSongDocument(sourceDocument, opts.render || currentSongRenderState)
    : null;
  currentWorkspaceSong = currentWorkspaceSongDeck
    ? transientSongFromSongDocument(currentWorkspaceSongDeck)
    : null;

  const launcher = document.getElementById("songsLauncher");
  const slide = document.getElementById("songsPreviewSlide");
  if (launcher && slide) {
    if (currentWorkspaceSong) {
      launcher.hidden = true;
      slide.hidden = false;
    } else {
      launcher.hidden = false;
      slide.hidden = true;
    }
  }

  if (!song) {
    document.getElementById("songsWorkspaceTitle").textContent = "Select a Song";
    document.getElementById("songsShowNowBtn").disabled = true;
    document.getElementById("songsAddScheduleBtn").disabled = true;
    document.getElementById("songsEditBtn").disabled = true;
    document.getElementById("songsDeleteBtn").disabled = true;
    const saveToLibraryBtn = document.getElementById("songsSaveToLibraryBtn");
    if (saveToLibraryBtn) {
      saveToLibraryBtn.disabled = true;
      saveToLibraryBtn.hidden = true;
    }
    document.getElementById("songEditorDrawer")?.setAttribute("hidden", "");
    document.getElementById("songArrangementStrip").innerHTML = "";
    const prevBtn = document.getElementById("songPrevSecBtn");
    const nextBtn = document.getElementById("songNextSecBtn");
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (slide) slide.innerHTML = "";
    currentSongSectionId = null;
    currentSongQueueItem = null;
    currentWorkspaceSongDeck = null;
    syncSongsMoveFolderSelect(null);
    return;
  }

  if (opts.render) {
    currentSongRenderState = mergeSongRenderState(currentSongRenderState, opts.render);
  } else if (sourceDocument) {
    currentSongRenderState = mergeSongRenderState(
      currentSongRenderState,
      songRenderStateFromSongDocument(sourceDocument),
    );
  }

  const inLibrary = await checkIfSongInLibrary(currentWorkspaceSong.id);
  const saveToLibraryBtn = document.getElementById("songsSaveToLibraryBtn");
  if (saveToLibraryBtn) {
    saveToLibraryBtn.hidden = inLibrary;
    saveToLibraryBtn.disabled = inLibrary;
  }

  document.getElementById("songsWorkspaceTitle").textContent = currentWorkspaceSong.title;
  document.getElementById("songsShowNowBtn").disabled = false;
  document.getElementById("songsAddScheduleBtn").disabled = false;
  document.getElementById("songsEditBtn").disabled = false;
  document.getElementById("songsDeleteBtn").disabled = !inLibrary;
  document.getElementById("songEditorDrawer")?.setAttribute("hidden", "");
  syncSongsMoveFolderSelect(currentWorkspaceSongDeck || currentWorkspaceSong, inLibrary);

  const enabledSections = enabledSongSections(song);
  if (!currentSongSectionId || !enabledSections.some((s) => s.id === currentSongSectionId)) {
    currentSongSectionId = enabledSections[0]?.id || currentWorkspaceSong.sections?.[0]?.id || null;
  }

  const strip = document.getElementById("songArrangementStrip");
  if (strip) {
    strip.innerHTML = "";
    for (const section of enabledSections) {
      const chip = document.createElement("button");
      chip.className = "pill-button";
      chip.type = "button";
      chip.textContent = section.label;
      if (section.id === currentSongSectionId) {
        chip.classList.add("primary-action");
      }
      chip.addEventListener("click", () => {
        currentSongSectionId = section.id;
        renderSongSectionPreview(section);
        if (currentSongQueueItem?.render) {
          currentSongQueueItem.render.currentSectionId = section.id;
        }
        strip.querySelectorAll(".pill-button").forEach((btn) => {
          btn.classList.toggle("primary-action", btn === chip);
        });
        void syncActiveScheduledSongPresentation().catch(console.error);
        updateSongNavButtonsState();
      });
      strip.appendChild(chip);
    }
  }

  const activeSection =
    enabledSections.find((s) => s.id === currentSongSectionId) ||
    enabledSections[0] ||
    currentWorkspaceSong.sections?.[0] ||
    null;
  if (activeSection) {
    renderSongSectionPreview(activeSection);
  }
  updateSongNavButtonsState();
}

function updateSongNavButtonsState() {
  const prevBtn = document.getElementById("songPrevSecBtn");
  const nextBtn = document.getElementById("songNextSecBtn");
  if (!prevBtn || !nextBtn || !currentWorkspaceSong) {
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }
  const enabledSections = enabledSongSections(currentWorkspaceSong);
  if (enabledSections.length <= 1) {
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }
  const currentIndex = enabledSections.findIndex((s) => s.id === currentSongSectionId);
  prevBtn.disabled = currentIndex <= 0;
  nextBtn.disabled = currentIndex >= enabledSections.length - 1 || currentIndex === -1;
}

function navigateSongSection(direction) {
  if (!currentWorkspaceSong) return;
  const enabledSections = enabledSongSections(currentWorkspaceSong);
  if (enabledSections.length === 0) return;
  const currentIndex = enabledSections.findIndex((s) => s.id === currentSongSectionId);
  if (currentIndex === -1) return;
  const nextIndex = currentIndex + direction;
  if (nextIndex >= 0 && nextIndex < enabledSections.length) {
    const nextSection = enabledSections[nextIndex];
    currentSongSectionId = nextSection.id;
    renderSongSectionPreview(nextSection);
    if (currentSongQueueItem?.render) {
      currentSongQueueItem.render.currentSectionId = nextSection.id;
    }
    const strip = document.getElementById("songArrangementStrip");
    if (strip) {
      const buttons = strip.querySelectorAll(".pill-button");
      buttons.forEach((btn, idx) => {
        btn.classList.toggle("primary-action", idx === nextIndex);
      });
    }
    void syncActiveScheduledSongPresentation().catch(console.error);
    updateSongNavButtonsState();
  }
}

function renderSongSectionPreview(section) {
  try {
  const isEditing = document.getElementById("songEditorDrawer")?.hidden === false;
  const targetId = isEditing ? "songEditorLivePreviewSlide" : "songsPreviewSlide";
  const preview = document.getElementById(targetId);
  if (!preview || !section || !currentWorkspaceSong) return;
  currentSongSectionId = section.id;

  const presentation = resolvedSongPresentation({
    type: "song",
    songSnapshot: currentWorkspaceSong,
    sequence: {
      entries: arrangementSequenceEntries(currentWorkspaceSong),
    },
    render: {
      ...currentSongRenderState,
      currentSectionId: section.id,
    },
  });
  const message = presentation?.message;
  if (!message) return;

  preview.style.backgroundColor = message.backgroundColor || "#000000";
  const outputFontSize = Number(message.fontSize) || DEFAULT_SONG_RENDER.fontSize;
  const scaledPreviewFontSize = Math.max(
    12,
    outputFontSize * Math.max(preview.clientWidth || 1920, 1) / 1920,
  );
  preview.style.setProperty('--base-font-size', outputFontSize);
  preview.style.setProperty('--song-preview-font-size', `${scaledPreviewFontSize}px`);
  if (message.fontFamily) {
    preview.style.setProperty('--font-family', songFontFamilyCSS(message.fontFamily));
  }
  if (message.backgroundImage) {
    preview.style.backgroundImage = `url('${message.backgroundImage}')`;
  } else {
    preview.style.backgroundImage = "";
  }

  const slideObjects = Array.isArray(message.slideObjects) && message.slideObjects.length > 0
    ? message.slideObjects
    : Array.isArray(message.slideTextObjects)
      ? message.slideTextObjects
      : [];
  if (slideObjects.length > 0) {
    renderSlideObjectsIntoPreview(preview, slideObjects, message);
  } else {
    renderSongBlocksIntoPreview(
      preview,
      message.blocks,
      message.color || "#ffffff",
      message.textBoxPosition || null,
    );
  }

  if (message.referenceText) {
    const refEl = document.createElement("div");
    refEl.className = "song-preview-reference";
    refEl.style.color = message.referenceColor || message.color || "#ffffff";
    refEl.textContent = message.referenceText;
    preview.appendChild(refEl);
  }

  if (message.attributionText) {
    const attrEl = document.createElement("div");
    attrEl.className = "song-preview-attribution";
    attrEl.textContent = message.attributionText;
    preview.appendChild(attrEl);
  }

  renderSongCopyrightIntoPreview(preview, message.copyrightText);

  if (isEditing) {
    syncSongEditorWorkspaceStyles(message);
  }
  } catch (err) {
     try {
       window.electron?.ipcRenderer?.send("log-to-file", `[ERROR] in renderSongSectionPreview: ${err.message}\n${err.stack}`);
     } catch (e) {}
     console.error(err);
  }
}

async function sendSongTextToOutput(item = null) {
  const presentation = resolvedSongPresentation(item || currentSongPresentationItem());
  if (!presentation?.message) return;
  const message = { ...presentation.message };
  const transitionItem =
    item && isQueueItemTransitionCapable(item)
      ? item
      : item && mediaQueue.includes(item) && isQueueItemSong(item)
        ? item
        : null;
  if (transitionItem) {
    message.transition = slideTransitionPayloadForQueueItem(transitionItem);
  }
  send("update-text", message);
}

async function syncActiveScheduledSongPresentation() {
  if (!isActiveMediaWindow() || activeMediaWindowContentType !== "song") return false;
  const liveIndex = currentQueueIndex;
  if (liveIndex < 0 || liveIndex >= mediaQueue.length) {
    if (!isCurrentWorkspaceSongShownNow()) return false;
    const item = currentSongPresentationItem();
    if (!item) return false;
    await sendSongTextToOutput(item);
    return true;
  }
  const item = mediaQueue[liveIndex];
  if (!isQueueItemSong(item)) {
    if (!isCurrentWorkspaceSongShownNow()) return false;
    const currentItem = currentSongPresentationItem();
    if (!currentItem) return false;
    await sendSongTextToOutput(currentItem);
    return true;
  }
  await sendSongTextToOutput(item);
  return true;
}

async function showSongTextNow() {
  if (!currentWorkspaceSong) {
    showGnomeToast("Choose a song to show");
    return false;
  }
  if (!hasAudienceOutputSelected()) {
    showGnomeToast("Choose an audience output display");
    return false;
  }

  const transientEntry = buildSongQueueEntryFromDeck({
    deck: currentWorkspaceSongDeck || currentWorkspaceSong,
    render: currentSongRenderState,
    currentSectionId: currentSongSectionId,
  });
  if (!transientEntry) return false;

  try {
    mediaPlaybackEndedPending = false;
    pendingQueueSwitchIndex = null;
    pendingQueueSwitchStartTime = 0;
    userStopPresentationPending = false;
    currentQueueIndex = -1;

    if (isActiveMediaWindow() && activeMediaWindowContentType === "song") {
      await sendSongTextToOutput(transientEntry);
      isPlaying = true;
      isQueuePlaying = false;
      activeMediaWindowContentType = "song";
      markSongShowNowPresentation(transientEntry);
      isActiveMediaWindowCache = true;
      updateDynUI();
      renderQueue();
      return true;
    }

    const audienceStarted = await createMediaWindow({
      textItem: transientEntry,
      transientText: true,
      songItem: true,
    });
    if (!audienceStarted) {
      showGnomeToast("No song output started");
      return false;
    }
    activeMediaWindowContentType = "song";
    isPlaying = true;
    isQueuePlaying = false;
    markSongShowNowPresentation(transientEntry);
    isActiveMediaWindowCache = true;
    updateDynUI();
    renderQueue();
    return true;
  } catch (err) {
    console.error("Failed to show song:", err);
    showGnomeToast("Failed to show song");
    return false;
  }
}

async function insertSongInSchedule() {
  if (!currentWorkspaceSong) {
    showGnomeToast("Choose a song to schedule");
    return false;
  }
  const entry = buildSongQueueEntryFromDeck({
    deck: currentWorkspaceSongDeck || currentWorkspaceSong,
    render: currentSongRenderState,
    currentSectionId: currentSongSectionId,
  });
  if (!entry) return false;
  invalidateQueueUndoToastAfterMutation();
  insertQueueEntriesAfterSelection([entry]);
  renderQueue();
  saveMediaFile();
  showGnomeToast(`Scheduled ${entry.name}`);
  return true;
}

async function importSongFromDialog() {
  try {
    const res = await invoke("show-import-song-dialog");
    if (!res || res.canceled) return;
    const filePaths = Array.isArray(res.filePaths)
      ? res.filePaths.filter(Boolean)
      : typeof res.filePath === "string" && res.filePath
        ? [res.filePath]
        : typeof res.filePaths === "string" && res.filePaths
          ? [res.filePaths]
          : [];
    if (filePaths.length === 0) return;

    const searchInput = document.getElementById("songsSearchInput");
    const defaultFolderId =
      currentSongFolderFilter !== SONG_FOLDER_ALL &&
      currentSongFolderFilter !== SONG_FOLDER_UNFILED
        ? currentSongFolderFilter
        : null;

    const result = await songsAPI.importFiles(filePaths, {
      defaultFolderId,
      search: {
        query: searchInput?.value || "",
        ...songSearchOptionsForCurrentFolder(),
      },
    });

    const importedCount = Array.isArray(result?.imported) ? result.imported.length : 0;
    const failedCount = Array.isArray(result?.failed) ? result.failed.length : 0;

    if (result?.lastSong) {
      currentSongRenderState = mergeSongRenderState(DEFAULT_SONG_RENDER, {
        copyright: result.lastSong.metadata?.copyright || "",
        ccliNumber: result.lastSong.metadata?.ccliNumber || null,
      });
      await loadSongIntoWorkspace(result.lastSong, {
        render: currentSongRenderState,
      });
    }

    await refreshSongFolders(result?.folders ?? null);
    if (searchInput) {
      await refreshSongsBrowser(searchInput.value, result?.searchResults ?? null);
    }

    if (importedCount > 0 && failedCount === 0) {
      showGnomeToast(`Imported ${importedCount} song${importedCount === 1 ? "" : "s"}`);
    } else if (importedCount > 0) {
      showGnomeToast(`Imported ${importedCount} song(s), ${failedCount} failed`);
    } else {
      showGnomeToast("Import failed");
    }

    for (const failure of result?.failed || []) {
      console.error(`Song import failed for ${failure.path}:`, failure.error);
    }
  } catch (err) {
    console.error("Song import failed:", err);
    showGnomeToast(`Import failed: ${err.message}`);
  }
}

async function openSongsWorkspaceFromButton() {
  currentWorkspaceSong = null;
  currentSongQueueItem = null;
  document.getElementById("songEditorDrawer")?.setAttribute("hidden", "");
  const launcher = document.getElementById("songsLauncher");
  const slide = document.getElementById("songsPreviewSlide");
  if (launcher) launcher.hidden = false;
  if (slide) slide.hidden = true;

  showSongsWorkspace();
  await songsAPI.waitForReady();
  await refreshSongFolders();
  await refreshSongsBrowser();
}

/* ════════════════════════════════════════════════════════════
   SLIDES WORKSPACE
   ════════════════════════════════════════════════════════════ */

let currentDeck = null;
let currentDeckPageId = null;
let currentDeckFolderFilter = null;
let currentDeckDocumentType = "deck";
let activeSlideTextObjectId = null;
let slideTextObjectBackgroundTargetId = null;
let slideObjectImageTargetId = null;
let slideObjectImageInsertPoint = null;
let slideTextSelectionState = null;
let slideObjectClipboard = null;
let slideObjectPasteCount = 0;
let deckDirty = false;
let deckLibraryDecks = [];
let deckLibraryFolders = [];
const SLIDE_UNDO_LIMIT = 50;
let slideUndoStack = [];
let slideRedoStack = [];
let slideUndoTransaction = null;
let slideUndoRestoring = false;
const SLIDE_THUMBNAIL_WIDTH = 320;
const SLIDE_THUMBNAIL_HEIGHT = 180;
const SLIDE_THUMBNAIL_IDLE_MS = 3000;
const slideThumbnailCache = new Map();
const slideThumbnailTimers = new Map();

const SLIDE_LAYOUT_TEMPLATES = Object.freeze([
  {
    id: "blank",
    label: "Blank",
    objects: [],
  },
  {
    id: "center",
    label: "Center",
    objects: [
      { frame: { x: 0.12, y: 0.2, width: 0.76, height: 0.6 }, align: "center", verticalAlign: "center" },
    ],
  },
  {
    id: "left",
    label: "Left",
    objects: [
      { frame: { x: 0.07, y: 0.16, width: 0.46, height: 0.68 }, align: "left", verticalAlign: "center" },
    ],
  },
  {
    id: "right",
    label: "Right",
    objects: [
      { frame: { x: 0.47, y: 0.16, width: 0.46, height: 0.68 }, align: "right", verticalAlign: "center" },
    ],
  },
  {
    id: "two-column",
    label: "Two Columns",
    objects: [
      { frame: { x: 0.07, y: 0.16, width: 0.4, height: 0.68 }, align: "left", verticalAlign: "center" },
      { frame: { x: 0.53, y: 0.16, width: 0.4, height: 0.68 }, align: "left", verticalAlign: "center" },
    ],
  },
  {
    id: "title-body",
    label: "Title + Body",
    objects: [
      { frame: { x: 0.1, y: 0.1, width: 0.8, height: 0.18 }, align: "center", verticalAlign: "center", fontScale: 0.78 },
      { frame: { x: 0.14, y: 0.36, width: 0.72, height: 0.44 }, align: "center", verticalAlign: "center", fontScale: 0.58 },
    ],
  },
  {
    id: "lower-third",
    label: "Lower Third",
    objects: [
      { frame: { x: 0.08, y: 0.65, width: 0.84, height: 0.22 }, align: "center", verticalAlign: "center", fontScale: 0.62 },
    ],
  },
]);

function setDeckDirty(dirty) {
  deckDirty = !!dirty;
  const saveBtn = document.getElementById("slidesSaveDeckBtn");
  if (saveBtn) saveBtn.disabled = !currentDeck || !deckDirty;
  syncSlidesWorkspaceTitle();
  syncSlideUndoRedoButtons();
  if (deckDirty) scheduleCurrentSlideThumbnailRefresh();
}

function syncSlidesWorkspaceTitle() {
  const titleEl = document.getElementById("slidesWorkspaceTitle");
  if (titleEl) {
    titleEl.textContent = currentDeck
      ? `${currentDeckIsSongDocument() ? "Song: " : ""}${currentDeck.title || "Untitled Deck"}${deckDirty ? " •" : ""}`
      : "Select or Create a Deck";
  }
  const titleBtn = document.getElementById("slidesWorkspaceTitleButton");
  if (titleBtn) titleBtn.disabled = !currentDeck;
}

function currentDeckIsSongDocument() {
  return Boolean(
    currentDeckDocumentType === SONG_DECK_DOCUMENT_TYPE ||
      currentDeck?.documentType === SONG_DECK_DOCUMENT_TYPE ||
      currentDeck?.type === SONG_DECK_DOCUMENT_TYPE,
  );
}

function cloneSlideDeckValue(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function createSlideEditorCheckpoint() {
  if (!currentDeck) return null;
  return {
    deck: cloneSlideDeckValue(currentDeck),
    pageId: currentDeckPageId,
    activeObjectId: activeSlideTextObjectId,
    dirty: deckDirty,
  };
}

function slideCheckpointSignature(checkpoint) {
  if (!checkpoint?.deck) return "";
  try {
    return JSON.stringify({
      deck: checkpoint.deck,
      pageId: checkpoint.pageId || null,
      activeObjectId: checkpoint.activeObjectId || null,
      dirty: Boolean(checkpoint.dirty),
    });
  } catch {
    return "";
  }
}

function slideCheckpointsEqual(left, right) {
  return Boolean(left && right && slideCheckpointSignature(left) === slideCheckpointSignature(right));
}

function pushSlideHistoryEntry(stack, checkpoint) {
  if (!checkpoint?.deck) return false;
  const last = stack[stack.length - 1];
  if (slideCheckpointsEqual(last, checkpoint)) return false;
  stack.push(checkpoint);
  if (stack.length > SLIDE_UNDO_LIMIT) stack.shift();
  return true;
}

function syncSlideUndoRedoButtons() {
  const undoBtn = document.getElementById("slidesUndoBtn");
  const redoBtn = document.getElementById("slidesRedoBtn");
  if (undoBtn) undoBtn.disabled = !currentDeck || slideUndoStack.length === 0;
  if (redoBtn) redoBtn.disabled = !currentDeck || slideRedoStack.length === 0;
}

function clearSlideUndoHistory() {
  slideUndoStack = [];
  slideRedoStack = [];
  slideUndoTransaction = null;
  syncSlideUndoRedoButtons();
}

function pushSlideUndoCheckpoint(checkpoint, { clearRedo = true } = {}) {
  pushSlideHistoryEntry(slideUndoStack, checkpoint);
  if (clearRedo) slideRedoStack = [];
  syncSlideUndoRedoButtons();
}

function beginSlideUndoTransaction(label = "Edit slide") {
  if (slideUndoRestoring || !currentDeck || slideUndoTransaction) return;
  slideUndoTransaction = {
    label,
    before: createSlideEditorCheckpoint(),
  };
}

function commitSlideUndoTransaction() {
  if (!slideUndoTransaction) return false;
  const transaction = slideUndoTransaction;
  slideUndoTransaction = null;
  const after = createSlideEditorCheckpoint();
  if (!after || slideCheckpointsEqual(transaction.before, after)) {
    syncSlideUndoRedoButtons();
    return false;
  }
  pushSlideUndoCheckpoint(transaction.before);
  return true;
}

function recordSlideUndoCheckpoint(label = "Edit slide", { flush = true } = {}) {
  if (slideUndoRestoring || !currentDeck) return;
  commitSlideUndoTransaction();
  if (flush) flushSlideEditorTextToModel({ recordUndo: false });
  pushSlideUndoCheckpoint({
    ...createSlideEditorCheckpoint(),
    label,
  });
}

function recordSlideUndoForMutation(label = "Edit slide") {
  if (slideUndoRestoring || !currentDeck || slideUndoTransaction) return;
  recordSlideUndoCheckpoint(label, { flush: false });
}

function restoreSlideEditorCheckpoint(checkpoint) {
  if (!checkpoint?.deck) return false;
  slideUndoRestoring = true;
  try {
    currentDeck = normalizeSlideDeck(cloneSlideDeckValue(checkpoint.deck));
    currentDeckPageId =
      checkpoint.pageId && findPage(currentDeck, checkpoint.pageId)
        ? checkpoint.pageId
        : currentDeck?.pages?.[0]?.id || null;
    const page = currentPage();
    activeSlideTextObjectId = slideObjectById(page, checkpoint.activeObjectId)
      ? checkpoint.activeObjectId
      : orderedSlideObjects(page)[0]?.id || null;
    setDeckDirty(Boolean(checkpoint.dirty));
    syncSlidesDeckFolderSelect();
    renderSlidesList();
    renderSlideEditorState();
    queueAllSlideThumbnailRenders(250);
    void syncActiveDeckPresentation().catch(console.error);
    return true;
  } finally {
    slideUndoRestoring = false;
    syncSlideUndoRedoButtons();
  }
}

function undoSlideEdit() {
  if (!currentDeck) return false;
  commitSlideUndoTransaction();
  const previous = slideUndoStack.pop();
  if (!previous) {
    syncSlideUndoRedoButtons();
    return false;
  }
  pushSlideHistoryEntry(slideRedoStack, createSlideEditorCheckpoint());
  restoreSlideEditorCheckpoint(previous);
  return true;
}

function redoSlideEdit() {
  if (!currentDeck) return false;
  commitSlideUndoTransaction();
  const next = slideRedoStack.pop();
  if (!next) {
    syncSlideUndoRedoButtons();
    return false;
  }
  pushSlideUndoCheckpoint(createSlideEditorCheckpoint(), { clearRedo: false });
  restoreSlideEditorCheckpoint(next);
  return true;
}

function renameCurrentDeck() {
  if (!currentDeck) return;
  const nextTitle = (window.prompt("Deck name", currentDeck.title || "Untitled Deck") || "").trim();
  if (!nextTitle || nextTitle === currentDeck.title) return;
  recordSlideUndoCheckpoint("Rename deck");
  currentDeck.title = nextTitle;
  const titleInput = document.getElementById("slidesDeckTitleInput");
  if (titleInput) titleInput.value = nextTitle;
  setDeckDirty(true);
  renderSlidesList();
}

function deckSummaryFromDeck(deck) {
  if (!deck) return null;
  return {
    id: deck.id,
    title: deck.title || "Untitled Deck",
    folderId: deck.folderId || null,
    pageCount: Array.isArray(deck.pages) ? deck.pages.length : 0,
    updatedAt: deck.updatedAt || null,
  };
}

async function openSlidesWorkspaceFromButton() {
  currentDeck = null;
  currentDeckPageId = null;
  currentDeckDocumentType = "deck";
  clearSlideUndoHistory();
  clearSlideThumbnailState();
  setDeckDirty(false);
  showSlidesWorkspace();
  try {
    await slidesAPI.waitForReady();
  } catch (err) {
    console.warn("Slides store not ready:", err);
  }
  await refreshSlidesFolderList();
  await refreshSlidesList();
  renderSlideEditorState();
}

async function refreshSlidesList(query = "") {
  try {
    const list = await slidesAPI.list({ search: query, folderId: currentDeckFolderFilter });
    deckLibraryDecks = Array.isArray(list) ? list : [];
  } catch (err) {
    console.error("Failed to list decks:", err);
    deckLibraryDecks = [];
  }
  renderSlidesList();
}

function renderSlidesList() {
  const host = document.getElementById("slidesList");
  if (!host) return;
  host.innerHTML = "";
  if (deckLibraryDecks.length === 0) {
    const empty = document.createElement("span");
    empty.className = "list-placeholder-title";
    empty.textContent = "No decks yet";
    host.appendChild(empty);
    return;
  }
  for (const summary of deckLibraryDecks) {
    const item = document.createElement("div");
    item.className = "slides-list-item";
    if (currentDeck && currentDeck.id === summary.id) item.classList.add("is-selected");
    item.dataset.deckId = summary.id;
    item.setAttribute("role", "option");

    const title = document.createElement("span");
    title.className = "slides-list-item__title";
    title.textContent = summary.title || "Untitled Deck";
    const count = document.createElement("span");
    count.className = "slides-list-item__count";
    count.textContent = `${summary.pageCount || 0}`;
    item.appendChild(title);
    item.appendChild(count);

    item.addEventListener("click", () => {
      void activateDeckFromLibrary(summary.id).catch(console.error);
    });
    item.addEventListener("dblclick", () => {
      void activateDeckFromLibrary(summary.id).catch(console.error);
    });
    host.appendChild(item);
  }
}

async function refreshSlidesFolderList() {
  try {
    const folders = await slidesAPI.listFolders();
    deckLibraryFolders = Array.isArray(folders) ? folders : [];
  } catch (err) {
    console.error("Failed to list deck folders:", err);
    deckLibraryFolders = [];
  }
  renderSlidesFolderList();
  syncSlidesDeckFolderSelect();
}

function renderSlidesFolderList() {
  const host = document.getElementById("slidesFolderList");
  if (!host) return;
  host.innerHTML = "";
  const allRow = document.createElement("div");
  allRow.className = "songs-folder-item";
  if (currentDeckFolderFilter === null) allRow.classList.add("is-selected");
  allRow.textContent = "All Decks";
  allRow.addEventListener("click", () => {
    currentDeckFolderFilter = null;
    renderSlidesFolderList();
    void refreshSlidesList(document.getElementById("slidesSearchInput")?.value || "");
  });
  host.appendChild(allRow);
  const unfiledRow = document.createElement("div");
  unfiledRow.className = "songs-folder-item";
  if (currentDeckFolderFilter === "") unfiledRow.classList.add("is-selected");
  unfiledRow.textContent = "Default";
  unfiledRow.addEventListener("click", () => {
    currentDeckFolderFilter = "";
    renderSlidesFolderList();
    void refreshSlidesList(document.getElementById("slidesSearchInput")?.value || "");
  });
  host.appendChild(unfiledRow);
  for (const folder of deckLibraryFolders) {
    const row = document.createElement("div");
    row.className = "songs-folder-item";
    if (currentDeckFolderFilter === folder.id) row.classList.add("is-selected");
    const label = document.createElement("span");
    label.textContent = folder.name;
    row.appendChild(label);
    row.addEventListener("click", () => {
      currentDeckFolderFilter = folder.id;
      renderSlidesFolderList();
      void refreshSlidesList(document.getElementById("slidesSearchInput")?.value || "");
    });
    host.appendChild(row);
  }
}

function syncSlidesDeckFolderSelect() {
  const select = document.getElementById("slidesDeckFolderSelect");
  if (!select) return;
  const currentValue = currentDeck?.folderId || "";
  select.innerHTML = "";
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "Default";
  select.appendChild(defaultOpt);
  for (const folder of deckLibraryFolders) {
    const opt = document.createElement("option");
    opt.value = folder.id;
    opt.textContent = folder.name;
    select.appendChild(opt);
  }
  select.value = currentValue;
}

async function activateDeckFromLibrary(deckId) {
  if (deckDirty && currentDeck && !confirm("Discard unsaved changes to current deck?")) return;
  try {
    const deck = await slidesAPI.get(deckId);
    if (!deck) {
      showGnomeToast("Deck not found");
      return;
    }
    loadDeckIntoWorkspace(normalizeSlideDeck(deck));
  } catch (err) {
    console.error("Failed to load deck:", err);
    showGnomeToast("Failed to load deck");
  }
}

function loadDeckIntoWorkspace(deck, opts = {}) {
  clearSlideThumbnailState();
  clearSlideUndoHistory();
  currentDeck = deck;
  currentDeckDocumentType =
    opts.documentType ||
    (deck?.documentType === SONG_DECK_DOCUMENT_TYPE || deck?.type === SONG_DECK_DOCUMENT_TYPE
      ? SONG_DECK_DOCUMENT_TYPE
      : "deck");
  if (currentDeckDocumentType === SONG_DECK_DOCUMENT_TYPE && currentDeck) {
    currentDeck.documentType = SONG_DECK_DOCUMENT_TYPE;
    currentDeck.type = SONG_DECK_DOCUMENT_TYPE;
  }
  const requestedPageId = opts.pageId || null;
  currentDeckPageId =
    requestedPageId && findPage(deck, requestedPageId)
      ? requestedPageId
      : deck?.pages?.[0]?.id || null;
  activeSlideTextObjectId = null;
  if (Object.prototype.hasOwnProperty.call(opts, "queueItem")) {
    currentSongQueueItem = opts.queueItem || null;
  } else if (!queueItemMatchesDeck(currentSongQueueItem, deck)) {
    currentSongQueueItem = null;
  }
  setDeckDirty(false);
  syncSlidesDeckFolderSelect();
  renderSlidesList();
  renderSlideEditorState();
  queueAllSlideThumbnailRenders(250);
}

function createNewDeck() {
  if (deckDirty && currentDeck && !confirm("Discard unsaved changes to current deck?")) return;
  clearSlideThumbnailState();
  clearSlideUndoHistory();
  const deck = createBlankDeck({ folderId: currentDeckFolderFilter || null });
  currentDeck = deck;
  currentDeckDocumentType = "deck";
  currentDeckPageId = deck.pages[0].id;
  activeSlideTextObjectId = null;
  setDeckDirty(true);
  syncSlidesDeckFolderSelect();
  renderSlideEditorState();
  queueAllSlideThumbnailRenders(250);
}

async function saveCurrentDeck() {
  if (!currentDeck) return;
  commitSlideUndoTransaction();
  flushSlideEditorTextToModel();
  if (currentDeckIsSongDocument()) {
    try {
      currentDeck.documentType = SONG_DECK_DOCUMENT_TYPE;
      currentDeck.type = SONG_DECK_DOCUMENT_TYPE;
      currentDeck.updatedAt = new Date().toISOString();
      const saved = await songsAPI.save(currentDeck);
      const savedDeckSource = saved || currentDeck;
      const savedDeck = songDeckDocumentFromSongDocument(
        savedDeckSource,
        deckDefaultRender(savedDeckSource),
      );
      currentDeck = savedDeck || currentDeck;
      currentWorkspaceSongDeck = currentDeck;
      currentWorkspaceSong = deckToTransientSong(currentDeck);
      currentSongRenderState = mergeSongRenderState(currentSongRenderState, deckDefaultRender(currentDeck));
      currentEditingSongId = currentDeck.id;
      clearSlideUndoHistory();
      setDeckDirty(false);
      const searchInput = document.getElementById("songsSearchInput");
      await refreshSongFolders();
      if (searchInput) await refreshSongsBrowser(searchInput.value);
      showGnomeToast(`Saved ${currentDeck.title || "song"}`);
    } catch (err) {
      console.error("Failed to save song deck:", err);
      showGnomeToast(`Save failed: ${err.message || err}`);
    }
    return;
  }
  try {
    const summary = await slidesAPI.save(currentDeck);
    currentDeck.updatedAt = summary?.updatedAt || new Date().toISOString();
    clearSlideUndoHistory();
    setDeckDirty(false);
    await refreshSlidesList(document.getElementById("slidesSearchInput")?.value || "");
    showGnomeToast(`Saved ${currentDeck.title || "deck"}`);
  } catch (err) {
    console.error("Failed to save deck:", err);
    showGnomeToast(`Save failed: ${err.message || err}`);
  }
}

async function deleteCurrentDeck() {
  if (!currentDeck) return;
  if (!confirm(`Delete "${currentDeck.title || "Untitled Deck"}"?`)) return;
  if (currentDeckIsSongDocument()) {
    try {
      await songsAPI.delete(currentDeck.id);
      currentDeck = null;
      currentDeckPageId = null;
      currentDeckDocumentType = "deck";
      currentWorkspaceSongDeck = null;
      currentWorkspaceSong = null;
      clearSlideUndoHistory();
      setDeckDirty(false);
      const searchInput = document.getElementById("songsSearchInput");
      await refreshSongFolders();
      if (searchInput) await refreshSongsBrowser(searchInput.value);
      showSongsWorkspace();
    } catch (err) {
      console.error("Failed to delete song:", err);
      showGnomeToast(`Delete failed: ${err.message || err}`);
    }
    return;
  }
  try {
    await slidesAPI.delete(currentDeck.id);
    currentDeck = null;
    currentDeckPageId = null;
    clearSlideUndoHistory();
    setDeckDirty(false);
    await refreshSlidesList(document.getElementById("slidesSearchInput")?.value || "");
    renderSlideEditorState();
  } catch (err) {
    console.error("Failed to delete deck:", err);
    showGnomeToast(`Delete failed: ${err.message || err}`);
  }
}

async function duplicateCurrentDeck() {
  if (!currentDeck) return;
  if (deckDirty && !confirm("Save changes before duplicating? Duplicating will save first.")) return;
  if (deckDirty) await saveCurrentDeck();
  try {
    const copy = await slidesAPI.duplicate(currentDeck.id, {});
    if (copy) loadDeckIntoWorkspace(normalizeSlideDeck(copy));
    await refreshSlidesList(document.getElementById("slidesSearchInput")?.value || "");
  } catch (err) {
    console.error("Failed to duplicate deck:", err);
    showGnomeToast(`Duplicate failed: ${err.message || err}`);
  }
}

/* ── Page operations ──────────────────────────────────────── */

function currentPage() {
  if (!currentDeck || !currentDeckPageId) return null;
  return findPage(currentDeck, currentDeckPageId);
}

function selectDeckPage(pageId) {
  commitSlideUndoTransaction();
  flushSlideEditorTextToModel();
  currentDeckPageId = pageId;
  activeSlideTextObjectId = null;
  renderSlideEditorState();
  void syncActiveDeckPresentation().catch(console.error);
}

function addDeckPage() {
  if (!currentDeck) return;
  recordSlideUndoCheckpoint("Add page");
  const page = createBlankPage({ label: `Page ${currentDeck.pages.length + 1}` });
  currentDeck.pages.push(page);
  currentDeckPageId = page.id;
  activeSlideTextObjectId = null;
  setDeckDirty(true);
  renderSlideEditorState();
}

function duplicateDeckPage() {
  if (!currentDeck) return;
  const page = currentPage();
  if (!page) return;
  recordSlideUndoCheckpoint("Duplicate page");
  const copy = JSON.parse(JSON.stringify(page));
  copy.id = `page_${(crypto.randomUUID?.() || String(Math.random())).replace(/-/g, "").slice(0, 12)}`;
  for (const obj of copy.objects || []) {
    obj.id = `obj_${(crypto.randomUUID?.() || String(Math.random())).replace(/-/g, "").slice(0, 12)}`;
  }
  const idx = currentDeck.pages.findIndex((p) => p.id === page.id);
  currentDeck.pages.splice(idx + 1, 0, copy);
  currentDeckPageId = copy.id;
  activeSlideTextObjectId = null;
  setDeckDirty(true);
  renderSlideEditorState();
}

function deleteDeckPage() {
  if (!currentDeck) return;
  if (currentDeck.pages.length <= 1) {
    showGnomeToast("A deck must have at least one page");
    return;
  }
  const idx = currentDeck.pages.findIndex((p) => p.id === currentDeckPageId);
  if (idx < 0) return;
  recordSlideUndoCheckpoint("Delete page");
  currentDeck.pages.splice(idx, 1);
  currentDeckPageId = currentDeck.pages[Math.min(idx, currentDeck.pages.length - 1)].id;
  activeSlideTextObjectId = null;
  setDeckDirty(true);
  renderSlideEditorState();
}

/* ── Editor render ────────────────────────────────────────── */

function renderSlideEditorState() {
  const hasDeck = Boolean(currentDeck);
  const page = currentPage();

  syncSlidesWorkspaceTitle();

  const titleInput = document.getElementById("slidesDeckTitleInput");
  if (titleInput) titleInput.value = currentDeck?.title || "";

  const fontFamily = document.getElementById("slidesDeckFontFamily");
  if (fontFamily) fontFamily.value = currentDeck?.theme?.fontFamily || DEFAULT_DECK_THEME.fontFamily;
  const fontSize = document.getElementById("slidesDeckFontSize");
  if (fontSize) fontSize.value = currentDeck?.theme?.fontSize ?? DEFAULT_DECK_THEME.fontSize;
  const textColor = document.getElementById("slidesDeckTextColor");
  if (textColor) textColor.value = currentDeck?.theme?.textColor || DEFAULT_DECK_THEME.textColor;
  const bgColor = document.getElementById("slidesDeckBgColor");
  if (bgColor) bgColor.value = currentDeck?.theme?.backgroundColor || DEFAULT_DECK_THEME.backgroundColor;

  const pageLabel = document.getElementById("slidesPageLabelInput");
  if (pageLabel) pageLabel.value = page?.label || "";
  const pageBg = document.getElementById("slidesPageBackgroundColor");
  if (pageBg) {
    pageBg.value = page?.background?.color || currentDeck?.theme?.backgroundColor || DEFAULT_DECK_THEME.backgroundColor;
  }
  const bgLabel = document.getElementById("slidesPageBackgroundLabel");
  if (bgLabel) {
    if (page?.background?.type === "image" || page?.background?.type === "video") {
      const p = page.background.path || "";
      bgLabel.textContent = p ? p.split(/[\\/]/).pop() : (page.background.type === "video" ? "Video" : "Image");
    } else {
      bgLabel.textContent = "None";
    }
  }
  const pageNotes = document.getElementById("slidesPageNotes");
  if (pageNotes) pageNotes.value = page?.notes || "";
  syncSlideTransitionControls(
    "slidesPageTransitionEffect",
    "slidesPageTransitionDuration",
    page?.transition,
    { allowInherit: true },
  );
  renderSlideTemplatePicker();

  // Buttons enable/disable
  for (const id of [
    "slidesShowNowBtn",
    "slidesAddScheduleBtn",
    "slidesDeleteDeckBtn",
    "slidesDuplicateDeckBtn",
    "slidesAddPageBtn",
    "slidesDuplicatePageBtn",
    "slidesDeletePageBtn",
    "slidesAddTextBoxBtn",
    "slidesAddImageBtn",
    "slidesAddRectBtn",
    "slidesAddEllipseBtn",
    "slidesAddLineBtn",
  ]) {
    const el = document.getElementById(id);
    if (el) el.disabled = !hasDeck;
  }
  const saveBtn = document.getElementById("slidesSaveDeckBtn");
  if (saveBtn) saveBtn.disabled = !hasDeck || !deckDirty;
  syncSlideUndoRedoButtons();

  renderDeckPageStrip();
  renderSlideCanvas();
}

function applyDeckPageThumbnailBackground(thumb, page) {
  const bg = page?.background || {};
  thumb.style.backgroundColor = "#000";
  thumb.style.backgroundImage = "";
  thumb.style.backgroundRepeat = "no-repeat";
  thumb.style.backgroundSize = "contain";
  thumb.style.backgroundPosition = "center";
  if (bg.type === "image" && bg.path) {
    thumb.style.backgroundColor = "#000";
    thumb.style.backgroundImage = `url("${pathToUrlSafe(bg.path)}")`;
  } else if (bg.type === "color" && bg.color) {
    thumb.style.backgroundColor = bg.color;
  }
}

function applyDeckPageThumbnailObjectBox(el, object) {
  const frame = normalizeSlideTextObjectFrame(object?.frame || DEFAULT_TEXT_FRAME);
  el.style.left = `${frame.x * 100}%`;
  el.style.top = `${frame.y * 100}%`;
  el.style.width = `${frame.width * 100}%`;
  el.style.height = `${frame.height * 100}%`;
  el.style.zIndex = String(Number.isFinite(object?.zIndex) ? object.zIndex : 0);
  el.style.opacity = String(clampSlideOpacity(object?.opacity, 1));
}

function createDeckPageThumbnailObject(object) {
  const kind = object?.kind === "image" || object?.kind === "shape" ? object.kind : "text";
  const el = document.createElement("div");
  el.className = `slides-page-list__thumb-object slides-page-list__thumb-object--${kind}`;
  applyDeckPageThumbnailObjectBox(el, object);

  if (kind === "image") {
    const image = object.image && typeof object.image === "object" ? object.image : {};
    if (image.path) {
      const img = document.createElement("img");
      img.src = pathToUrlSafe(image.path);
      img.alt = "";
      img.draggable = false;
      img.style.objectFit = image.fit === "cover" || image.fit === "fill" ? image.fit : "contain";
      el.appendChild(img);
    }
    return el;
  }

  if (kind === "shape") {
    const shape = object.shape && typeof object.shape === "object" ? object.shape : {};
    const shapeEl = document.createElement("div");
    shapeEl.className = "slides-page-list__thumb-shape";
    if (shape.type === "ellipse") {
      shapeEl.style.borderRadius = "999px";
    } else if (Number.isFinite(shape.radius) && shape.radius > 0) {
      shapeEl.style.borderRadius = `${Math.max(1, shape.radius / 8)}px`;
    }
    shapeEl.style.backgroundColor = shape.type === "line" ? "transparent" : (shape.fill || "#ffffff");
    if (shape.stroke || Number.isFinite(shape.strokeWidth)) {
      const strokeWidth = Number.isFinite(shape.strokeWidth) ? Math.max(1, shape.strokeWidth / 3) : 1;
      shapeEl.style.border = `${strokeWidth}px solid ${shape.stroke || shape.fill || "#ffffff"}`;
    }
    if (shape.type === "line") {
      const strokeWidth = Number.isFinite(shape.strokeWidth) && shape.strokeWidth > 0
        ? Math.max(1, shape.strokeWidth / 3)
        : 1;
      shapeEl.classList.add("slides-page-list__thumb-shape--line");
      shapeEl.style.border = "none";
      shapeEl.style.borderTop = `${strokeWidth}px solid ${shape.stroke || shape.fill || "#ffffff"}`;
    }
    el.appendChild(shapeEl);
    return el;
  }

  const style = object.style && typeof object.style === "object" ? object.style : {};
  el.textContent = slideTextObjectText(object);
  el.style.color = style.color || currentDeck?.theme?.textColor || "#ffffff";
  el.style.fontFamily = songFontFamilyCSS(style.fontFamily || currentDeck?.theme?.fontFamily);
  el.style.fontSize = `${Math.max(5, Math.min(14, (Number(style.fontSize) || Number(currentDeck?.theme?.fontSize) || 72) / 10))}px`;
  el.style.lineHeight = String(style.lineHeight || 1.15);
  el.style.textAlign = style.align || "center";
  el.style.alignItems =
    style.align === "left" ? "flex-start" : style.align === "right" ? "flex-end" : "center";
  el.style.justifyContent =
    style.verticalAlign === "top"
      ? "flex-start"
      : style.verticalAlign === "bottom"
        ? "flex-end"
        : "center";
  return el;
}

function renderDeckPageThumbnail(thumb, page) {
  thumb.innerHTML = "";
  const signature = slideThumbnailSignature(page, currentDeck);
  const cached = slideThumbnailCache.get(page?.id);
  if (cached?.signature === signature && cached.dataUrl) {
    thumb.classList.add("slides-page-list__thumb--rendered");
    thumb.style.backgroundColor = "#000";
    thumb.style.backgroundImage = `url("${cached.dataUrl}")`;
    thumb.style.backgroundRepeat = "no-repeat";
    thumb.style.backgroundSize = "contain";
    thumb.style.backgroundPosition = "center";
    return;
  }
  thumb.classList.remove("slides-page-list__thumb--rendered");
  applyDeckPageThumbnailBackground(thumb, page);
  const objects = orderedSlideObjects(page);
  if (!objects.length) {
    const txt = getPagePrimaryText(page);
    const fallback = document.createElement("div");
    fallback.className = "slides-page-list__thumb-object slides-page-list__thumb-object--text";
    fallback.style.inset = "0";
    fallback.style.alignItems = "center";
    fallback.style.justifyContent = "center";
    fallback.style.color = currentDeck?.theme?.textColor || "#ffffff";
    fallback.textContent = txt.length > 80 ? `${txt.slice(0, 77)}...` : txt;
    thumb.appendChild(fallback);
    return;
  }
  for (const object of objects) {
    thumb.appendChild(createDeckPageThumbnailObject(object));
  }
}

function renderDeckPageStrip() {
  const host = document.getElementById("slidesPageList");
  if (!host) return;
  host.innerHTML = "";
  if (!currentDeck) return;
  currentDeck.pages.forEach((page, idx) => {
    const row = document.createElement("div");
    row.className = "slides-page-list__item";
    if (page.id === currentDeckPageId) row.classList.add("is-active");
    row.dataset.pageId = page.id;

    const idxEl = document.createElement("span");
    idxEl.className = "slides-page-list__index";
    idxEl.textContent = String(idx + 1);

    const wrap = document.createElement("div");
    wrap.style.flex = "1";
    wrap.style.minWidth = "0";

    const thumb = document.createElement("div");
    thumb.className = "slides-page-list__thumb";
    renderDeckPageThumbnail(thumb, page);

    const label = document.createElement("div");
    label.className = "slides-page-list__label";
    label.textContent = page.label || `Page ${idx + 1}`;

    wrap.appendChild(thumb);
    wrap.appendChild(label);
    row.appendChild(idxEl);
    row.appendChild(wrap);
    row.addEventListener("click", () => selectDeckPage(page.id));
    host.appendChild(row);
  });
}

function pathToUrlSafe(p) {
  if (!p) return "";
  if (/^[a-z]+:\/\//i.test(p)) return p;
  try {
    return `file://${p.replace(/\\/g, "/")}`;
  } catch {
    return p;
  }
}

function slideThumbnailSignature(page, deck = currentDeck) {
  if (!page || !deck) return "";
  try {
    return JSON.stringify({
      canvas: deck.canvas || null,
      theme: deck.theme || null,
      background: page.background || null,
      objects: Array.isArray(page.objects) ? page.objects : [],
    });
  } catch {
    return `${Date.now()}`;
  }
}

function scheduleCurrentSlideThumbnailRefresh(delayMs = SLIDE_THUMBNAIL_IDLE_MS) {
  if (!currentDeck || !currentDeckPageId) return;
  queueSlideThumbnailRender(currentDeckPageId, delayMs);
}

function queueAllSlideThumbnailRenders(delayMs = 250) {
  if (!currentDeck || !Array.isArray(currentDeck.pages)) return;
  for (const page of currentDeck.pages) {
    queueSlideThumbnailRender(page.id, delayMs);
  }
}

function clearSlideThumbnailState() {
  for (const timer of slideThumbnailTimers.values()) {
    clearTimeout(timer);
  }
  slideThumbnailTimers.clear();
  slideThumbnailCache.clear();
}

function queueSlideThumbnailRender(pageId, delayMs = SLIDE_THUMBNAIL_IDLE_MS) {
  if (!currentDeck || !pageId) return;
  const page = findPage(currentDeck, pageId);
  if (!page) return;
  const signature = slideThumbnailSignature(page, currentDeck);
  const cached = slideThumbnailCache.get(pageId);
  if (cached?.signature === signature && cached.dataUrl) return;
  const existingTimer = slideThumbnailTimers.get(pageId);
  if (existingTimer) clearTimeout(existingTimer);
  const timer = setTimeout(() => {
    slideThumbnailTimers.delete(pageId);
    void renderSlideThumbnailForPage(pageId, signature).catch((err) => {
      console.warn("Failed to render slide thumbnail:", err);
    });
  }, Math.max(0, delayMs));
  slideThumbnailTimers.set(pageId, timer);
}

async function renderSlideThumbnailForPage(pageId, scheduledSignature) {
  const deck = currentDeck;
  const page = findPage(deck, pageId);
  if (!deck || !page) return;
  if (slideThumbnailSignature(page, deck) !== scheduledSignature) return;
  const dataUrl = await renderSlidePageThumbnailDataUrl(page, deck);
  if (!dataUrl) return;
  if (slideThumbnailSignature(page, deck) !== scheduledSignature) return;
  slideThumbnailCache.set(pageId, { signature: scheduledSignature, dataUrl });
  if (isSlidesWorkspaceVisible()) renderDeckPageStrip();
}

function slideThumbnailRectForFrame(frame) {
  const f = normalizeSlideTextObjectFrame(frame || DEFAULT_TEXT_FRAME);
  return {
    x: f.x * SLIDE_THUMBNAIL_WIDTH,
    y: f.y * SLIDE_THUMBNAIL_HEIGHT,
    width: f.width * SLIDE_THUMBNAIL_WIDTH,
    height: f.height * SLIDE_THUMBNAIL_HEIGHT,
  };
}

function loadSlideThumbnailImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), 1800);
    img.onload = () => {
      clearTimeout(timeout);
      finish(img);
    };
    img.onerror = () => {
      clearTimeout(timeout);
      finish(null);
    };
    img.src = src;
  });
}

function drawSlideThumbnailImage(ctx, img, x, y, width, height, fit = "cover") {
  if (!img || !width || !height) return;
  if (fit === "fill") {
    ctx.drawImage(img, x, y, width, height);
    return;
  }
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const scale = fit === "contain" ? Math.min(width / iw, height / ih) : Math.max(width / iw, height / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, x + (width - dw) / 2, y + (height - dh) / 2, dw, dh);
}

async function drawSlideThumbnailBackground(ctx, page, deck) {
  const bg = page?.background || {};
  const color = bg.color || deck?.theme?.backgroundColor || DEFAULT_DECK_THEME.backgroundColor;
  ctx.fillStyle = color || "#000000";
  ctx.fillRect(0, 0, SLIDE_THUMBNAIL_WIDTH, SLIDE_THUMBNAIL_HEIGHT);
  if (bg.type === "image" && bg.path) {
    const img = await loadSlideThumbnailImage(pathToUrlSafe(bg.path));
    if (img) drawSlideThumbnailImage(ctx, img, 0, 0, SLIDE_THUMBNAIL_WIDTH, SLIDE_THUMBNAIL_HEIGHT, "contain");
  }
}

async function drawSlideThumbnailObject(ctx, object, deck) {
  if (!object) return;
  const kind = object.kind === "image" || object.kind === "shape" ? object.kind : "text";
  const rect = slideThumbnailRectForFrame(object.frame);
  ctx.save();
  ctx.globalAlpha = clampSlideOpacity(object.opacity, 1);
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();

  if (kind === "image") {
    const image = object.image && typeof object.image === "object" ? object.image : {};
    const img = await loadSlideThumbnailImage(pathToUrlSafe(image.path));
    if (img) drawSlideThumbnailImage(ctx, img, rect.x, rect.y, rect.width, rect.height, image.fit || "contain");
    ctx.restore();
    return;
  }

  if (kind === "shape") {
    const shape = object.shape && typeof object.shape === "object" ? object.shape : {};
    const rawStrokeWidth = Number(shape.strokeWidth);
    const hasStroke = Boolean(shape.stroke) || (Number.isFinite(rawStrokeWidth) && rawStrokeWidth > 0);
    ctx.fillStyle = shape.fill || "#ffffff";
    ctx.strokeStyle = shape.stroke || shape.fill || "#ffffff";
    ctx.lineWidth = hasStroke ? Math.max(1, rawStrokeWidth || 1) : 0;
    if (shape.type === "line") {
      ctx.beginPath();
      ctx.moveTo(rect.x, rect.y + rect.height / 2);
      ctx.lineTo(rect.x + rect.width, rect.y + rect.height / 2);
      ctx.lineWidth = Math.max(1, Number(shape.strokeWidth) || 4);
      ctx.stroke();
    } else if (shape.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      if (hasStroke) ctx.stroke();
    } else {
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      if (hasStroke) ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
    ctx.restore();
    return;
  }

  const bg = object.background && typeof object.background === "object" ? object.background : null;
  if (bg?.type === "color") {
    ctx.fillStyle = bg.color || "transparent";
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  } else if (bg?.type === "image" && bg.path) {
    const bgImg = await loadSlideThumbnailImage(pathToUrlSafe(bg.path));
    if (bgImg) drawSlideThumbnailImage(ctx, bgImg, rect.x, rect.y, rect.width, rect.height, "cover");
  }

  const style = object.style && typeof object.style === "object" ? object.style : {};
  const deckFontSize = Number(deck?.theme?.fontSize) || DEFAULT_DECK_THEME.fontSize;
  const fontSize = Math.max(5, (Number(style.fontSize) || deckFontSize) * (SLIDE_THUMBNAIL_WIDTH / (deck?.canvas?.width || 1920)));
  const lineHeight = fontSize * (Number(style.lineHeight) || 1.15);
  const lines = slideTextObjectText(object).split(/\r?\n/);
  const totalHeight = Math.max(lineHeight, lines.length * lineHeight);
  const pad = Math.max(3, fontSize * 0.25);
  const verticalAlign = style.verticalAlign || "center";
  let y = rect.y + pad;
  if (verticalAlign === "center") y = rect.y + (rect.height - totalHeight) / 2;
  if (verticalAlign === "bottom") y = rect.y + rect.height - totalHeight - pad;
  const align = style.align || "center";
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.fillStyle = style.color || deck?.theme?.textColor || "#ffffff";
  ctx.font = `${style.fontWeight || 700} ${fontSize}px ${songFontFamilyCSS(style.fontFamily || deck?.theme?.fontFamily)}`;
  const x =
    align === "left"
      ? rect.x + pad
      : align === "right"
        ? rect.x + rect.width - pad
        : rect.x + rect.width / 2;
  for (const line of lines) {
    ctx.fillText(line || " ", x, y, Math.max(1, rect.width - pad * 2));
    y += lineHeight;
  }
  ctx.restore();
}

async function renderSlidePageThumbnailDataUrl(page, deck) {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = SLIDE_THUMBNAIL_WIDTH;
  canvas.height = SLIDE_THUMBNAIL_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  await drawSlideThumbnailBackground(ctx, page, deck);
  for (const object of orderedSlideObjects(page)) {
    await drawSlideThumbnailObject(ctx, object, deck);
  }
  try {
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return "";
  }
}

function clampSlideFrame(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function slideTextObjectsForPage(page, { create = false } = {}) {
  if (!page) return [];
  if (!Array.isArray(page.objects)) {
    if (!create) return [];
    page.objects = [];
  }
  let textObjects = page.objects.filter((o) => o && o.kind === "text");
  if (textObjects.length === 0 && create) {
    const obj = createTextObject({});
    page.objects.push(obj);
    textObjects = [obj];
    setDeckDirty(true);
  }
  return textObjects;
}

function slideObjectsForPage(page, { createText = false } = {}) {
  if (!page) return [];
  if (!Array.isArray(page.objects)) {
    if (!createText) return [];
    page.objects = [];
  }
  if (createText) slideTextObjectsForPage(page, { create: true });
  return Array.isArray(page.objects) ? page.objects.filter(Boolean) : [];
}

function slideObjectById(page, objectId) {
  if (!page || !objectId || !Array.isArray(page.objects)) return null;
  return page.objects.find((o) => o && o.id === objectId) || null;
}

function slideTextObjectById(page, objectId) {
  const obj = slideObjectById(page, objectId);
  return obj?.kind === "text" ? obj : null;
}

function activeSlideTextObject(page = currentPage(), { create = false } = {}) {
  const textObjects = slideTextObjectsForPage(page, { create });
  if (textObjects.length === 0) return null;
  let obj = slideTextObjectById(page, activeSlideTextObjectId);
  if (!obj) {
    obj = textObjects[0];
    activeSlideTextObjectId = obj.id;
  }
  return obj;
}

function orderedSlideObjects(page, { kind = null } = {}) {
  const objects = slideObjectsForPage(page);
  return objects
    .map((object, index) => ({ object, index }))
    .filter(({ object }) => !kind || object.kind === kind)
    .sort((a, b) => {
      const az = Number.isFinite(a.object?.zIndex) ? a.object.zIndex : 0;
      const bz = Number.isFinite(b.object?.zIndex) ? b.object.zIndex : 0;
      return az === bz ? a.index - b.index : az - bz;
    })
    .map(({ object }) => object);
}

function maxSlideObjectZIndex(page) {
  return slideObjectsForPage(page).reduce(
    (max, obj) => Math.max(max, Number.isFinite(obj?.zIndex) ? obj.zIndex : 0),
    0,
  );
}

function newSlideObjectId() {
  return `obj_${(crypto.randomUUID?.() || String(Math.random())).replace(/-/g, "").slice(0, 12)}`;
}

function cloneSlideObject(object) {
  try {
    return structuredClone(object);
  } catch {
    return JSON.parse(JSON.stringify(object));
  }
}

function clampSlideOpacity(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function slideObjectFrameAtCanvasPoint(frame, { clientX = null, clientY = null } = {}) {
  const canvas = document.getElementById("slidesCanvas");
  const f = normalizeSlideTextObjectFrame(frame || DEFAULT_TEXT_FRAME);
  if (!canvas || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return f;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return f;
  return {
    ...f,
    x: Math.max(0, Math.min(1 - f.width, (clientX - rect.left) / rect.width - f.width / 2)),
    y: Math.max(0, Math.min(1 - f.height, (clientY - rect.top) / rect.height - f.height / 2)),
  };
}

function offsetSlideObjectFrame(frame, { clientX = null, clientY = null } = {}) {
  const f = normalizeSlideTextObjectFrame(frame || DEFAULT_TEXT_FRAME);
  if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
    return slideObjectFrameAtCanvasPoint(f, { clientX, clientY });
  }
  const offset = Math.min(0.24, (slideObjectPasteCount + 1) * 0.04);
  return {
    ...f,
    x: Math.max(0, Math.min(1 - f.width, f.x + offset)),
    y: Math.max(0, Math.min(1 - f.height, f.y + offset)),
  };
}

function selectSlideObject(objectId, { focus = false } = {}) {
  activeSlideTextObjectId = objectId || null;
  document.querySelectorAll(".slides-canvas-text-object").forEach((el) => {
    const active = Boolean(objectId) && el.dataset.objectId === objectId;
    el.classList.toggle("is-active", active);
    if (active && focus) {
      el.querySelector(".slides-canvas-text-input")?.focus({ preventScroll: true });
    }
  });
}

function selectSlideTextObject(objectId, opts = {}) {
  selectSlideObject(objectId, opts);
}

function slideTextFrameFromDom(objectEl) {
  const canvas = document.getElementById("slidesCanvas");
  const textObj = objectEl || document.querySelector(".slides-canvas-text-object.is-active");
  if (!canvas || !textObj || textObj.style.display === "none") return null;
  const canvasRect = canvas.getBoundingClientRect();
  const textRect = textObj.getBoundingClientRect();
  if (!canvasRect.width || !canvasRect.height || !textRect.width || !textRect.height) {
    return null;
  }
  const x = clampSlideFrame((textRect.left - canvasRect.left) / canvasRect.width);
  const y = clampSlideFrame((textRect.top - canvasRect.top) / canvasRect.height);
  return {
    x,
    y,
    width: Math.max(0.01, Math.min(1 - x, textRect.width / canvasRect.width)),
    height: Math.max(0.01, Math.min(1 - y, textRect.height / canvasRect.height)),
  };
}

function slideFramesEqual(a, b) {
  if (!a || !b) return false;
  const epsilon = 0.0005;
  return (
    Math.abs(Number(a.x) - Number(b.x)) < epsilon &&
    Math.abs(Number(a.y) - Number(b.y)) < epsilon &&
    Math.abs(Number(a.width) - Number(b.width)) < epsilon &&
    Math.abs(Number(a.height) - Number(b.height)) < epsilon
  );
}

function slideTextObjectText(object) {
  return blocksToText(object?.blocks || []);
}

function slideBlocksEqual(a, b) {
  try {
    return JSON.stringify(a || []) === JSON.stringify(b || []);
  } catch {
    return false;
  }
}

function renderSlideTextInputFromBlocks(editor, blocks) {
  if (!editor) return;
  editor.innerHTML = "";
  const source = Array.isArray(blocks) && blocks.length ? blocks : textToSegmentsBlocks("");
  for (const block of source) {
    const lineEl = document.createElement("div");
    lineEl.className = "slides-canvas-text-line";
    if (block?.id) lineEl.dataset.blockId = block.id;
    const segments = block?.type === "lyricLine" && Array.isArray(block.primary?.segments)
      ? block.primary.segments
      : [];
    if (!segments.length || segments.every((segment) => !segment?.text)) {
      lineEl.appendChild(document.createElement("br"));
    } else {
      for (const segment of segments) {
        const span = document.createElement("span");
        span.textContent = segment?.text || "";
        applySongSegmentStyleToElement(span, segment?.style);
        lineEl.appendChild(span);
      }
    }
    editor.appendChild(lineEl);
  }
}

function isSlideTextBlockElement(node) {
  return (
    node?.nodeType === Node.ELEMENT_NODE &&
    ["DIV", "P", "LI"].includes(node.tagName)
  );
}

function styleFromDomElement(element, inherited = {}) {
  const next = { ...inherited };
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return next;
  const style = element.style || {};
  if (style.color) next.color = style.color;
  if (style.fontFamily) next.fontFamily = style.fontFamily;
  if (style.backgroundColor) next.backgroundColor = style.backgroundColor;
  if (style.fontWeight) next.fontWeight = style.fontWeight;
  if (style.fontStyle) next.fontStyle = style.fontStyle;
  const decoration = style.textDecorationLine || style.textDecoration;
  if (decoration) next.textDecoration = decoration;
  return textStyleFromSegment({ style: next });
}

function appendRichTextSegment(lines, text, style) {
  if (typeof text !== "string" || text.length === 0) return;
  const parts = text.replace(/\u00a0/g, " ").split("\n");
  for (let i = 0; i < parts.length; i += 1) {
    if (i > 0) lines.push([]);
    if (!parts[i]) continue;
    lines[lines.length - 1].push({
      type: "text",
      text: parts[i],
      ...(Object.keys(style || {}).length > 0 ? { style } : {}),
    });
  }
}

function collectRichTextLines(node, inheritedStyle = {}) {
  const lines = [[]];
  const walk = (current, style) => {
    if (!current) return;
    if (current.nodeType === Node.TEXT_NODE) {
      appendRichTextSegment(lines, current.nodeValue || "", style);
      return;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return;
    if (current.tagName === "BR") {
      lines.push([]);
      return;
    }
    const nextStyle = styleFromDomElement(current, style);
    for (const child of current.childNodes) {
      walk(child, nextStyle);
    }
  };
  walk(node, inheritedStyle);
  while (
    lines.length > 1 &&
    lines[lines.length - 1].length === 0 &&
    isSlideTextBlockElement(node)
  ) {
    lines.pop();
  }
  return lines;
}

function slideTextBlocksFromInput(editor, previousBlocks = []) {
  if (!editor) return textToSegmentsBlocks("");
  const childNodes = Array.from(editor.childNodes);
  const hasDirectBlocks = childNodes.some(isSlideTextBlockElement);
  const lines = [];
  if (hasDirectBlocks) {
    for (const child of childNodes) {
      if (isSlideTextBlockElement(child)) {
        lines.push(...collectRichTextLines(child));
      } else {
        const collected = collectRichTextLines(child);
        if (collected.some((line) => line.length > 0)) lines.push(...collected);
      }
    }
  } else {
    lines.push(...collectRichTextLines(editor));
  }
  const normalizedLines = lines.length ? lines : [[]];
  return normalizedLines.map((segments, index) => {
    const previous = previousBlocks[index] || {};
    const normalizedSegments = normalizeSongSegments(segments);
    if (!normalizedSegments.length) {
      return {
        type: "spacer",
        id: previous.id || `block_${(crypto.randomUUID?.() || String(Math.random())).replace(/-/g, "").slice(0, 8)}`,
        primary: {
          lang: previous.primary?.lang || "en",
          segments: [],
        },
        translations: Array.isArray(previous.translations) ? previous.translations : [],
        annotations: Array.isArray(previous.annotations) ? previous.annotations : [],
      };
    }
    return {
      type: "lyricLine",
      id: previous.id || `block_${(crypto.randomUUID?.() || String(Math.random())).replace(/-/g, "").slice(0, 8)}`,
      primary: {
        lang: previous.primary?.lang || "en",
        segments: normalizedSegments,
      },
      translations: Array.isArray(previous.translations) ? previous.translations : [],
      annotations: Array.isArray(previous.annotations) ? previous.annotations : [],
    };
  });
}

function slideTextObjectElementById(objectId) {
  if (!objectId) return null;
  return Array.from(document.querySelectorAll(".slides-canvas-text-object"))
    .find((el) => el.dataset.objectId === objectId) || null;
}

function slideTextInputForObject(objectId) {
  return slideTextObjectElementById(objectId)?.querySelector(".slides-canvas-text-input") || null;
}

function captureSlideTextSelection(objectId) {
  const editor = slideTextInputForObject(objectId);
  const range = editor ? saveSongEditorCursorPosition(editor) : null;
  if (range && range.start !== range.end) {
    slideTextSelectionState = {
      objectId,
      start: Math.min(range.start, range.end),
      end: Math.max(range.start, range.end),
    };
    return slideTextSelectionState;
  }
  slideTextSelectionState = null;
  return null;
}

function selectedSlideTextRange(objectId) {
  if (
    slideTextSelectionState &&
    slideTextSelectionState.objectId === objectId &&
    slideTextSelectionState.start !== slideTextSelectionState.end
  ) {
    return slideTextSelectionState;
  }
  const live = captureSlideTextSelection(objectId);
  if (live) return live;
  return null;
}

function fitTextElementToBox(box, textEl, { baseSize, minSize, mode = "fit" } = {}) {
  if (!box || !textEl || mode === "none") return;
  const boxWidth = Math.max(1, box.clientWidth || box.getBoundingClientRect().width || 0);
  const boxHeight = Math.max(1, box.clientHeight || box.getBoundingClientRect().height || 0);
  if (!boxWidth || !boxHeight) return;
  let size = Math.max(1, Number(baseSize) || 1);
  const min = Math.max(1, Math.min(size, Number(minSize) || size));
  textEl.style.fontSize = `${size}px`;
  while (
    size > min &&
    (textEl.scrollHeight > Math.ceil(boxHeight) + 1 || textEl.scrollWidth > Math.ceil(boxWidth) + 1)
  ) {
    size = Math.max(min, Math.floor(size * 0.92));
    textEl.style.fontSize = `${size}px`;
  }
}

function fitSlideTextEditorElement(el, object, scale) {
  const editor = el?.querySelector(".slides-canvas-text-input");
  if (!el || !editor || object?.kind !== "text") return;
  const style = object.style && typeof object.style === "object" ? object.style : {};
  const deckFontSize = Number(currentDeck?.theme?.fontSize);
  const baseSize = Number.isFinite(Number(style.fontSize))
    ? Number(style.fontSize)
    : Number.isFinite(deckFontSize)
      ? deckFontSize
      : DEFAULT_DECK_THEME.fontSize;
  const minSize = Number.isFinite(Number(style.minFontSize))
    ? Number(style.minFontSize)
    : Number(currentDeck?.theme?.minFontSize) || DEFAULT_DECK_THEME.minFontSize;
  fitTextElementToBox(el, editor, {
    baseSize: Math.max(8, baseSize * scale),
    minSize: Math.max(6, minSize * scale),
    mode: object.autofit || currentDeck?.theme?.autosizeMode || "fit",
  });
}

function applySlideTextObjectFormatting(style, objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideTextObjectById(page, objectId);
  if (!obj || !style || typeof style !== "object") return;
  const selected = selectedSlideTextRange(obj.id);
  if (!selected) {
    updateSlideTextObjectStyle(style, obj.id);
    return;
  }
  recordSlideUndoForMutation("Style selected text");
  const styledSection = applySongStyleToSectionRange(
    { blocks: obj.blocks || [] },
    selected.start,
    selected.end,
    style,
  );
  obj.blocks = styledSection.blocks;
  activeSlideTextObjectId = obj.id;
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  const editor = slideTextInputForObject(obj.id);
  if (editor) {
    editor.focus({ preventScroll: true });
    restoreSongEditorCursorPosition(editor, selected);
  }
  void syncActiveDeckPresentation().catch(console.error);
}

function normalizeSlideTextObjectFrame(frame = DEFAULT_TEXT_FRAME) {
  const x = clampSlideFrame(frame.x, DEFAULT_TEXT_FRAME.x);
  const y = clampSlideFrame(frame.y, DEFAULT_TEXT_FRAME.y);
  const width = Math.max(0.01, Math.min(1 - x, Number(frame.width) || DEFAULT_TEXT_FRAME.width));
  const height = Math.max(0.01, Math.min(1 - y, Number(frame.height) || DEFAULT_TEXT_FRAME.height));
  return { x, y, width, height };
}

function applySlideTextObjectBackground(el, object) {
  const bgEl = el.querySelector(".slides-canvas-text-object-bg");
  if (!bgEl) return;
  bgEl.innerHTML = "";
  bgEl.style.backgroundColor = "";
  bgEl.style.backgroundImage = "";
  const bg = object?.background && typeof object.background === "object" ? object.background : null;
  if (!bg) return;
  if (bg.type === "color") {
    bgEl.style.backgroundColor = bg.color || "transparent";
    return;
  }
  if (bg.path) {
    if (bg.type === "video") {
      const videoEl = document.createElement("video");
      videoEl.src = pathToUrlSafe(bg.path);
      videoEl.autoplay = true;
      videoEl.loop = true;
      videoEl.muted = true;
      videoEl.playsInline = true;
      bgEl.appendChild(videoEl);
      void videoEl.play().catch(() => {});
    } else {
      bgEl.style.backgroundImage = `url("${pathToUrlSafe(bg.path)}")`;
    }
  }
}

function applySlideObjectElementBoxStyle(el, object) {
  const frame = normalizeSlideTextObjectFrame(object.frame);
  object.frame = frame;
  el.style.left = `${frame.x * 100}%`;
  el.style.top = `${frame.y * 100}%`;
  el.style.width = `${frame.width * 100}%`;
  el.style.height = `${frame.height * 100}%`;
  el.style.zIndex = String(Number.isFinite(object.zIndex) ? object.zIndex : 1);
  el.style.setProperty("--slide-object-opacity", String(clampSlideOpacity(object.opacity, 1)));
}

function applySlideTextObjectElementStyle(el, editor, object, scale) {
  applySlideObjectElementBoxStyle(el, object);
  const style = object.style && typeof object.style === "object" ? object.style : {};
  const objectFontSize = Number(style.fontSize);
  const deckFontSize = Number(currentDeck?.theme?.fontSize);
  const fontSize = Number.isFinite(objectFontSize)
    ? objectFontSize
    : Number.isFinite(deckFontSize)
      ? deckFontSize
      : DEFAULT_DECK_THEME.fontSize;
  editor.style.fontFamily =
    style.fontFamily || currentDeck?.theme?.fontFamily || DEFAULT_DECK_THEME.fontFamily;
  editor.style.fontSize = `${Math.max(8, fontSize * scale)}px`;
  editor.style.color = style.color || currentDeck?.theme?.textColor || "#fff";
  editor.style.textAlign = style.align || "center";
  editor.style.alignItems =
    style.align === "left" ? "flex-start" : style.align === "right" ? "flex-end" : "center";
  editor.style.justifyContent =
    style.verticalAlign === "top"
      ? "flex-start"
      : style.verticalAlign === "bottom"
        ? "flex-end"
        : "center";
  applySlideTextObjectBackground(el, object);
}

function bindSlideTextObjectElement(el, editor, object) {
  editor.dataset.suppress = "1";
  renderSlideTextInputFromBlocks(editor, object.blocks);
  delete editor.dataset.suppress;

  const activate = () => selectSlideTextObject(object.id);
  el.addEventListener("pointerdown", activate);
  editor.addEventListener("focus", activate);
  editor.addEventListener("input", () => {
    if (editor.dataset.suppress === "1") return;
    beginSlideUndoTransaction("Edit text");
    object.blocks = slideTextBlocksFromInput(editor, object.blocks);
    setDeckDirty(true);
    const canvas = document.getElementById("slidesCanvas");
    const scale = canvas ? canvas.getBoundingClientRect().width / (currentDeck?.canvas?.width || 1920) : 1;
    fitSlideTextEditorElement(el, object, scale);
    renderDeckPageStrip();
    void syncActiveDeckPresentation().catch(console.error);
  });
  editor.addEventListener("blur", () => {
    object.blocks = slideTextBlocksFromInput(editor, object.blocks);
    commitSlideUndoTransaction();
  });
  editor.addEventListener("paste", (event) => {
    const text = event.clipboardData?.getData("text/plain") || "";
    if (!text) return;
    event.preventDefault();
    document.execCommand("insertText", false, text);
  });
  editor.addEventListener("keyup", () => captureSlideTextSelection(object.id));
  editor.addEventListener("mouseup", () => captureSlideTextSelection(object.id));
  editor.addEventListener("contextmenu", (event) => {
    captureSlideTextSelection(object.id);
    showSlideTextObjectContextMenu(event, object.id);
  });
  el.addEventListener("contextmenu", (event) => {
    captureSlideTextSelection(object.id);
    showSlideTextObjectContextMenu(event, object.id);
  });

  el.addEventListener("pointerdown", (event) => {
    if (
      event.button !== 0 ||
      event.target.closest?.(".slides-canvas-text-handle") ||
      event.target.closest?.(".slides-canvas-text-input")
    ) return;
    const canvas = document.getElementById("slidesCanvas");
    if (!canvas) return;
    selectSlideTextObject(object.id);
    const canvasRect = canvas.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startFrame = normalizeSlideTextObjectFrame(object.frame);
    const w = canvasRect.width;
    const h = canvasRect.height;
    const dragThreshold = 4;
    let dragging = false;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {}
    const move = (e) => {
      const pixelDx = e.clientX - startX;
      const pixelDy = e.clientY - startY;
      if (!dragging) {
        if (Math.hypot(pixelDx, pixelDy) < dragThreshold) return;
        dragging = true;
        beginSlideUndoTransaction("Move object");
        el.classList.add("slides-canvas-drag-overlay");
      }
      e.preventDefault();
      const dx = pixelDx / w;
      const dy = pixelDy / h;
      object.frame = {
        ...startFrame,
        x: Math.max(0, Math.min(1 - startFrame.width, startFrame.x + dx)),
        y: Math.max(0, Math.min(1 - startFrame.height, startFrame.y + dy)),
      };
      el.style.left = `${object.frame.x * 100}%`;
      el.style.top = `${object.frame.y * 100}%`;
      setDeckDirty(true);
    };
    const up = (e) => {
      if (dragging) {
        e.preventDefault();
        e.stopPropagation();
      }
      commitSlideUndoTransaction();
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {}
      el.classList.remove("slides-canvas-drag-overlay");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }, true);

  for (const handle of el.querySelectorAll(".slides-canvas-text-handle")) {
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const canvas = document.getElementById("slidesCanvas");
      if (!canvas) return;
      selectSlideTextObject(object.id);
      const which = handle.dataset.handle;
      const canvasRect = canvas.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const startFrame = normalizeSlideTextObjectFrame(object.frame);
      const w = canvasRect.width;
      const h = canvasRect.height;
      beginSlideUndoTransaction("Resize object");
      handle.setPointerCapture(event.pointerId);
      const move = (e) => {
        const dx = (e.clientX - startX) / w;
        const dy = (e.clientY - startY) / h;
        let { x, y, width, height } = startFrame;
        if (which.includes("e")) width = Math.max(0.05, startFrame.width + dx);
        if (which.includes("s")) height = Math.max(0.05, startFrame.height + dy);
        if (which.includes("w")) {
          width = Math.max(0.05, startFrame.width - dx);
          x = Math.min(startFrame.x + startFrame.width - 0.05, startFrame.x + dx);
        }
        if (which.includes("n")) {
          height = Math.max(0.05, startFrame.height - dy);
          y = Math.min(startFrame.y + startFrame.height - 0.05, startFrame.y + dy);
        }
        if (x + width > 1) width = 1 - x;
        if (y + height > 1) height = 1 - y;
        object.frame = { x, y, width, height };
        el.style.left = `${x * 100}%`;
        el.style.top = `${y * 100}%`;
        el.style.width = `${width * 100}%`;
        el.style.height = `${height * 100}%`;
        setDeckDirty(true);
      };
      const up = () => {
        commitSlideUndoTransaction();
        try {
          handle.releasePointerCapture(event.pointerId);
        } catch {}
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }
}

function bindSlideObjectBoxInteractions(el, object) {
  const activate = () => selectSlideObject(object.id);
  el.addEventListener("pointerdown", activate);
  el.addEventListener("contextmenu", (event) => {
    showSlideObjectContextMenu(event, object.id);
  });

  el.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest?.(".slides-canvas-text-handle")) return;
    const canvas = document.getElementById("slidesCanvas");
    if (!canvas) return;
    selectSlideObject(object.id);
    const canvasRect = canvas.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startFrame = normalizeSlideTextObjectFrame(object.frame);
    const w = canvasRect.width;
    const h = canvasRect.height;
    const dragThreshold = 4;
    let dragging = false;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {}
    const move = (e) => {
      const pixelDx = e.clientX - startX;
      const pixelDy = e.clientY - startY;
      if (!dragging) {
        if (Math.hypot(pixelDx, pixelDy) < dragThreshold) return;
        dragging = true;
        beginSlideUndoTransaction("Move object");
        el.classList.add("slides-canvas-drag-overlay");
      }
      e.preventDefault();
      const dx = pixelDx / w;
      const dy = pixelDy / h;
      object.frame = {
        ...startFrame,
        x: Math.max(0, Math.min(1 - startFrame.width, startFrame.x + dx)),
        y: Math.max(0, Math.min(1 - startFrame.height, startFrame.y + dy)),
      };
      el.style.left = `${object.frame.x * 100}%`;
      el.style.top = `${object.frame.y * 100}%`;
      setDeckDirty(true);
    };
    const up = (e) => {
      if (dragging) {
        e.preventDefault();
        e.stopPropagation();
      }
      commitSlideUndoTransaction();
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {}
      el.classList.remove("slides-canvas-drag-overlay");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }, true);

  for (const handle of el.querySelectorAll(".slides-canvas-text-handle")) {
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const canvas = document.getElementById("slidesCanvas");
      if (!canvas) return;
      selectSlideObject(object.id);
      const which = handle.dataset.handle;
      const canvasRect = canvas.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const startFrame = normalizeSlideTextObjectFrame(object.frame);
      const w = canvasRect.width;
      const h = canvasRect.height;
      beginSlideUndoTransaction("Resize object");
      handle.setPointerCapture(event.pointerId);
      const move = (e) => {
        const dx = (e.clientX - startX) / w;
        const dy = (e.clientY - startY) / h;
        let { x, y, width, height } = startFrame;
        if (which.includes("e")) width = Math.max(0.05, startFrame.width + dx);
        if (which.includes("s")) height = Math.max(0.05, startFrame.height + dy);
        if (which.includes("w")) {
          width = Math.max(0.05, startFrame.width - dx);
          x = Math.min(startFrame.x + startFrame.width - 0.05, startFrame.x + dx);
        }
        if (which.includes("n")) {
          height = Math.max(0.05, startFrame.height - dy);
          y = Math.min(startFrame.y + startFrame.height - 0.05, startFrame.y + dy);
        }
        if (x + width > 1) width = 1 - x;
        if (y + height > 1) height = 1 - y;
        object.frame = { x, y, width, height };
        el.style.left = `${x * 100}%`;
        el.style.top = `${y * 100}%`;
        el.style.width = `${width * 100}%`;
        el.style.height = `${height * 100}%`;
        setDeckDirty(true);
      };
      const up = () => {
        commitSlideUndoTransaction();
        try {
          handle.releasePointerCapture(event.pointerId);
        } catch {}
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }
}

function slideObjectHandles() {
  return ["se", "sw", "ne", "nw"].map((handleName) => {
    const handle = document.createElement("div");
    handle.className = "slides-canvas-text-handle";
    handle.dataset.handle = handleName;
    handle.setAttribute("aria-hidden", "true");
    return handle;
  });
}

function createSlideTextObjectElement(object, scale) {
  const el = document.createElement("div");
  el.className = "slides-canvas-text-object slides-canvas-object slides-canvas-object--text";
  el.tabIndex = -1;
  el.dataset.objectId = object.id;
  if (object.id === activeSlideTextObjectId) el.classList.add("is-active");

  const bgEl = document.createElement("div");
  bgEl.className = "slides-canvas-text-object-bg";
  const textarea = document.createElement("div");
  textarea.className = "slides-canvas-text-input";
  textarea.contentEditable = "true";
  textarea.dataset.placeholder = "Type slide text...";
  textarea.setAttribute("role", "textbox");
  textarea.setAttribute("aria-multiline", "true");
  textarea.setAttribute("aria-label", "Slide text");
  const handles = slideObjectHandles();
  el.append(bgEl, textarea, ...handles);
  applySlideTextObjectElementStyle(el, textarea, object, scale);
  bindSlideTextObjectElement(el, textarea, object);
  return el;
}

function createSlideImageObjectElement(object) {
  const el = document.createElement("div");
  el.className = "slides-canvas-text-object slides-canvas-object slides-canvas-object--image";
  el.tabIndex = -1;
  el.dataset.objectId = object.id;
  if (object.id === activeSlideTextObjectId) el.classList.add("is-active");

  const image = object.image && typeof object.image === "object" ? object.image : {};
  const img = document.createElement("img");
  img.className = "slides-canvas-object__image";
  if (image.path) img.src = pathToUrlSafe(image.path);
  img.alt = "";
  img.draggable = false;
  const fit = image.fit === "cover" || image.fit === "fill" ? image.fit : "contain";
  img.style.objectFit = fit === "fill" ? "fill" : fit;
  el.append(img, ...slideObjectHandles());
  applySlideObjectElementBoxStyle(el, object);
  bindSlideObjectBoxInteractions(el, object);
  return el;
}

function createSlideShapeObjectElement(object) {
  const el = document.createElement("div");
  el.className = "slides-canvas-text-object slides-canvas-object slides-canvas-object--shape";
  el.tabIndex = -1;
  el.dataset.objectId = object.id;
  if (object.id === activeSlideTextObjectId) el.classList.add("is-active");

  const shape = object.shape && typeof object.shape === "object" ? object.shape : {};
  const shapeEl = document.createElement("div");
  shapeEl.className = "slides-canvas-object__shape";
  const opacity = `var(--slide-object-opacity, 1)`;
  shapeEl.style.opacity = opacity;
  if (shape.type === "ellipse") {
    shapeEl.style.borderRadius = "999px";
  } else if (shape.type === "line") {
    shapeEl.classList.add("slides-canvas-object__shape--line");
  } else if (Number.isFinite(shape.radius) && shape.radius > 0) {
    shapeEl.style.borderRadius = `${shape.radius}px`;
  }
  shapeEl.style.backgroundColor = shape.type === "line" ? "transparent" : (shape.fill || "#ffffff");
  if (shape.stroke || Number.isFinite(shape.strokeWidth)) {
    const strokeWidth = Number.isFinite(shape.strokeWidth) ? shape.strokeWidth : 1;
    shapeEl.style.border = `${strokeWidth}px solid ${shape.stroke || shape.fill || "#ffffff"}`;
  }
  if (shape.type === "line") {
    const strokeWidth = Number.isFinite(shape.strokeWidth) && shape.strokeWidth > 0 ? shape.strokeWidth : 4;
    shapeEl.style.border = "none";
    shapeEl.style.borderTop = `${strokeWidth}px solid ${shape.stroke || shape.fill || "#ffffff"}`;
  }
  el.append(shapeEl, ...slideObjectHandles());
  applySlideObjectElementBoxStyle(el, object);
  bindSlideObjectBoxInteractions(el, object);
  return el;
}

function createSlideObjectElement(object, scale) {
  if (object?.kind === "image") return createSlideImageObjectElement(object);
  if (object?.kind === "shape") return createSlideShapeObjectElement(object);
  return createSlideTextObjectElement(object, scale);
}

function renderSlideCanvas() {
  const canvas = document.getElementById("slidesCanvas");
  const bgEl = document.getElementById("slidesCanvasBackground");
  const textLayer = document.getElementById("slidesTextLayer");
  if (!canvas || !textLayer || !bgEl) return;

  const page = currentPage();
  const hasPage = Boolean(page);
  textLayer.style.display = hasPage ? "" : "none";
  bgEl.style.display = hasPage ? "" : "none";

  if (!hasPage) {
    textLayer.innerHTML = "";
    bgEl.style.backgroundColor = "#000";
    bgEl.style.backgroundImage = "";
    return;
  }

  // Background
  const bg = page.background || {};
  if (bg.type === "image" && bg.path) {
    bgEl.style.backgroundColor = "#000";
    bgEl.style.backgroundImage = `url("${pathToUrlSafe(bg.path)}")`;
  } else {
    bgEl.style.backgroundColor = bg.color || currentDeck.theme?.backgroundColor || "#000";
    bgEl.style.backgroundImage = "";
  }

  const objects = orderedSlideObjects(page);
  if (!slideObjectById(page, activeSlideTextObjectId)) {
    activeSlideTextObjectId = objects.find((object) => object?.kind === "text")?.id || objects[0]?.id || null;
  }
  const canvasRect = canvas.getBoundingClientRect();
  const scale = canvasRect.width / (currentDeck.canvas?.width || 1920);
  textLayer.innerHTML = "";
  for (const object of objects) {
    const objectEl = createSlideObjectElement(object, scale);
    textLayer.appendChild(objectEl);
    if (object?.kind === "text") {
      fitSlideTextEditorElement(objectEl, object, scale);
    }
  }
}

function flushSlideEditorTextToModel(_opts = {}) {
  if (!currentDeck) return;
  const page = currentPage();
  if (!page) return;
  document.querySelectorAll(".slides-canvas-text-object").forEach((el) => {
    const obj = slideTextObjectById(page, el.dataset.objectId);
    if (!obj) return;
    const editor = el.querySelector(".slides-canvas-text-input");
    if (editor) {
      const nextBlocks = slideTextBlocksFromInput(editor, obj.blocks);
      if (!slideBlocksEqual(nextBlocks, obj.blocks)) {
        obj.blocks = nextBlocks;
        setDeckDirty(true);
      }
    }
    const frame = slideTextFrameFromDom(el);
    if (frame && !slideFramesEqual(obj.frame, frame)) {
      obj.frame = frame;
      setDeckDirty(true);
    }
  });

  const fontSizeInput = document.getElementById("slidesDeckFontSize");
  const fontSize = Number(fontSizeInput?.value);
  if (Number.isFinite(fontSize) && fontSize > 0 && currentDeck.theme?.fontSize !== fontSize) {
    currentDeck.theme = { ...(currentDeck.theme || {}), fontSize };
    setDeckDirty(true);
  }

  const fontFamilyInput = document.getElementById("slidesDeckFontFamily");
  if (fontFamilyInput?.value && currentDeck.theme?.fontFamily !== fontFamilyInput.value) {
    currentDeck.theme = { ...(currentDeck.theme || {}), fontFamily: fontFamilyInput.value };
    setDeckDirty(true);
  }

  const textColorInput = document.getElementById("slidesDeckTextColor");
  if (textColorInput?.value && currentDeck.theme?.textColor !== textColorInput.value) {
    currentDeck.theme = { ...(currentDeck.theme || {}), textColor: textColorInput.value };
    setDeckDirty(true);
  }
}

/* ── Text object styling / context menu ───────────────────── */

function renderSlideTemplatePicker() {
  const host = document.getElementById("slidesTemplateList");
  if (!host) return;
  host.innerHTML = "";
  for (const template of SLIDE_LAYOUT_TEMPLATES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "slides-template-card";
    button.disabled = !currentDeck || !currentPage();
    button.dataset.templateId = template.id;
    button.setAttribute("role", "option");
    button.setAttribute("aria-label", template.label);

    const preview = document.createElement("span");
    preview.className = "slides-template-card__preview";
    for (const object of template.objects) {
      const box = document.createElement("span");
      box.className = "slides-template-card__box";
      box.style.left = `${object.frame.x * 100}%`;
      box.style.top = `${object.frame.y * 100}%`;
      box.style.width = `${object.frame.width * 100}%`;
      box.style.height = `${object.frame.height * 100}%`;
      preview.appendChild(box);
    }

    const label = document.createElement("span");
    label.className = "slides-template-card__label";
    label.textContent = template.label;
    button.append(preview, label);
    button.addEventListener("click", () => applySlideTemplate(template.id));
    host.appendChild(button);
  }
}

function slideTemplateBlocksForSlot(textObjects, slotIndex, slotCount) {
  if (!textObjects.length) return textToSegmentsBlocks("");
  if (slotCount === 1) {
    const text = textObjects
      .map((object) => slideTextObjectText(object).trim())
      .filter(Boolean)
      .join("\n\n");
    return text ? textToSegmentsBlocks(text) : blocksClone(textObjects[0]?.blocks, "");
  }
  return blocksClone(textObjects[slotIndex]?.blocks, "");
}

function createSlideTemplateTextObject(spec, slotIndex, slotCount, textObjects, baseZIndex) {
  const fontScale = Number.isFinite(spec.fontScale) ? spec.fontScale : 1;
  const deckFontSize = Number(currentDeck?.theme?.fontSize) || DEFAULT_DECK_THEME.fontSize;
  const obj = createTextObject({
    text: "",
    frame: spec.frame,
    style: {
      fontFamily: currentDeck?.theme?.fontFamily || DEFAULT_DECK_THEME.fontFamily,
      fontSize: Math.max(24, Math.round(deckFontSize * fontScale)),
      color: currentDeck?.theme?.textColor || DEFAULT_DECK_THEME.textColor,
      align: spec.align || "center",
      verticalAlign: spec.verticalAlign || "center",
    },
    zIndex: baseZIndex + slotIndex + 1,
  });
  obj.blocks = slideTemplateBlocksForSlot(textObjects, slotIndex, slotCount);
  return obj;
}

function applySlideTemplate(templateId) {
  const page = currentPage();
  const template = SLIDE_LAYOUT_TEMPLATES.find((candidate) => candidate.id === templateId);
  if (!page || !template) return;
  recordSlideUndoCheckpoint("Apply template");
  flushSlideEditorTextToModel();
  if (!Array.isArray(page.objects)) page.objects = [];
  const existingObjects = orderedSlideObjects(page);
  const textObjects = existingObjects.filter((object) => object?.kind === "text");
  const nonTextObjects = existingObjects.filter((object) => object?.kind !== "text");
  const baseZIndex = nonTextObjects.reduce(
    (max, object) => Math.max(max, Number.isFinite(object?.zIndex) ? object.zIndex : 0),
    0,
  );
  const textSlots = template.objects || [];
  const newTextObjects = textSlots.map((spec, index) =>
    createSlideTemplateTextObject(spec, index, textSlots.length, textObjects, baseZIndex),
  );
  page.objects = [...nonTextObjects, ...newTextObjects];
  activeSlideTextObjectId = newTextObjects[0]?.id || nonTextObjects[0]?.id || null;
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  renderSlideTemplatePicker();
  if (activeSlideTextObjectId) {
    selectSlideObject(activeSlideTextObjectId, { focus: newTextObjects[0]?.id === activeSlideTextObjectId });
  }
}

function nextSlideTextObjectFrame(page) {
  const count = slideTextObjectsForPage(page).length;
  const offset = Math.min(0.24, count * 0.04);
  return {
    x: Math.min(0.72, DEFAULT_TEXT_FRAME.x + offset),
    y: Math.min(0.72, DEFAULT_TEXT_FRAME.y + offset),
    width: DEFAULT_TEXT_FRAME.width,
    height: DEFAULT_TEXT_FRAME.height,
  };
}

function nextSlideObjectFrame(page, kind = "shape", { clientX = null, clientY = null } = {}) {
  const count = slideObjectsForPage(page).length;
  const offset = Math.min(0.2, count * 0.035);
  const base =
    kind === "line"
      ? { x: 0.18, y: 0.48, width: 0.64, height: 0.06 }
      : kind === "image"
        ? { x: 0.16, y: 0.16, width: 0.68, height: 0.68 }
        : { x: 0.22, y: 0.22, width: 0.56, height: 0.42 };
  const frame = {
    ...base,
    x: Math.min(Math.max(0, 1 - base.width), base.x + offset),
    y: Math.min(Math.max(0, 1 - base.height), base.y + offset),
  };
  return slideObjectFrameAtCanvasPoint(frame, { clientX, clientY });
}

function addSlideTextBox() {
  const page = currentPage();
  if (!page) return;
  recordSlideUndoCheckpoint("Add text box");
  flushSlideEditorTextToModel();
  if (!Array.isArray(page.objects)) page.objects = [];
  const obj = createTextObject({
    text: "",
    frame: nextSlideTextObjectFrame(page),
    style: {
      fontFamily: currentDeck?.theme?.fontFamily || DEFAULT_DECK_THEME.fontFamily,
      fontSize: Number(currentDeck?.theme?.fontSize) || DEFAULT_DECK_THEME.fontSize,
      color: currentDeck?.theme?.textColor || DEFAULT_DECK_THEME.textColor,
      align: "center",
      verticalAlign: "center",
    },
    zIndex: maxSlideObjectZIndex(page) + 1,
  });
  page.objects.push(obj);
  activeSlideTextObjectId = obj.id;
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  selectSlideTextObject(obj.id, { focus: true });
}

function chooseSlideObjectImage({ targetId = null, clientX = null, clientY = null } = {}) {
  if (!currentPage()) return;
  slideObjectImageTargetId = targetId || null;
  slideObjectImageInsertPoint =
    Number.isFinite(clientX) && Number.isFinite(clientY) ? { clientX, clientY } : null;
  document.getElementById("slidesObjectImageInput")?.click();
}

function addSlideImageObject(filePath, { clientX = null, clientY = null } = {}) {
  const page = currentPage();
  if (!page || !filePath) return null;
  recordSlideUndoCheckpoint("Add image");
  if (!Array.isArray(page.objects)) page.objects = [];
  const obj = createImageObject({
    path: filePath,
    fit: "contain",
    frame: nextSlideObjectFrame(page, "image", { clientX, clientY }),
    zIndex: maxSlideObjectZIndex(page) + 1,
  });
  page.objects.push(obj);
  activeSlideTextObjectId = obj.id;
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  selectSlideObject(obj.id);
  return obj;
}

function replaceSlideImageObject(objectId, filePath) {
  const page = currentPage();
  const obj = slideObjectById(page, objectId);
  if (!obj || obj.kind !== "image" || !filePath) return false;
  recordSlideUndoCheckpoint("Replace image");
  obj.image = {
    ...(obj.image && typeof obj.image === "object" ? obj.image : {}),
    path: filePath,
  };
  activeSlideTextObjectId = obj.id;
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  selectSlideObject(obj.id);
  return true;
}

function addSlideShapeObject(type = "rect", { clientX = null, clientY = null } = {}) {
  const page = currentPage();
  if (!page) return null;
  const shapeType = type === "ellipse" || type === "line" ? type : "rect";
  recordSlideUndoCheckpoint(`Add ${shapeType}`);
  if (!Array.isArray(page.objects)) page.objects = [];
  const obj = createShapeObject({
    type: shapeType,
    fill: shapeType === "line" ? currentDeck?.theme?.textColor || "#ffffff" : "#3584e4",
    stroke: shapeType === "line" ? currentDeck?.theme?.textColor || "#ffffff" : null,
    strokeWidth: shapeType === "line" ? 6 : 0,
    radius: shapeType === "rect" ? 12 : 0,
    frame: nextSlideObjectFrame(page, shapeType, { clientX, clientY }),
    zIndex: maxSlideObjectZIndex(page) + 1,
  });
  page.objects.push(obj);
  activeSlideTextObjectId = obj.id;
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  selectSlideObject(obj.id);
  return obj;
}

function duplicateSlideTextObject(objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideTextObjectById(page, objectId);
  if (!page || !obj) return;
  insertSlideObjectCopy(obj);
}

function insertSlideObjectCopy(sourceObject, { clientX = null, clientY = null } = {}) {
  const page = currentPage();
  if (!page || !sourceObject) return null;
  recordSlideUndoCheckpoint("Duplicate object");
  flushSlideEditorTextToModel();
  if (!Array.isArray(page.objects)) page.objects = [];
  const copy = cloneSlideObject(sourceObject);
  copy.id = newSlideObjectId();
  copy.frame = offsetSlideObjectFrame(copy.frame, { clientX, clientY });
  copy.zIndex = maxSlideObjectZIndex(page) + 1;
  copy.opacity = clampSlideOpacity(copy.opacity, 1);
  page.objects.push(copy);
  activeSlideTextObjectId = copy.id;
  slideObjectPasteCount += 1;
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  selectSlideObject(copy.id, { focus: copy.kind === "text" });
  return copy;
}

function canRemoveSlideObject(page, object) {
  return Boolean(page && object);
}

function deleteSlideObject(objectId = activeSlideTextObjectId, { quiet = false } = {}) {
  const page = currentPage();
  if (!page || !Array.isArray(page.objects)) return false;
  const obj = slideObjectById(page, objectId);
  if (!obj) return false;
  if (!canRemoveSlideObject(page, obj)) return false;
  const idx = page.objects.findIndex((candidate) => candidate && candidate.id === objectId);
  if (idx < 0) return false;
  recordSlideUndoCheckpoint("Delete object");
  page.objects.splice(idx, 1);
  activeSlideTextObjectId = orderedSlideObjects(page)[Math.min(idx, page.objects.length - 1)]?.id || null;
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  return true;
}

function copySlideObject(objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideObjectById(page, objectId);
  if (!obj) return false;
  flushSlideEditorTextToModel();
  slideObjectClipboard = cloneSlideObject(obj);
  slideObjectPasteCount = 0;
  showGnomeToast("Copied slide object");
  return true;
}

function cutSlideObject(objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideObjectById(page, objectId);
  if (!obj) return false;
  if (!copySlideObject(objectId)) return false;
  return deleteSlideObject(objectId, { quiet: true });
}

function pasteSlideObject({ clientX = null, clientY = null } = {}) {
  if (!slideObjectClipboard) {
    showGnomeToast("No slide object copied");
    return null;
  }
  return insertSlideObjectCopy(slideObjectClipboard, { clientX, clientY });
}

function setSlideObjectOpacity(opacity, objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideObjectById(page, objectId);
  if (!obj) return;
  recordSlideUndoForMutation("Set object opacity");
  obj.opacity = clampSlideOpacity(opacity, 1);
  setDeckDirty(true);
  renderSlideCanvas();
  selectSlideObject(obj.id, { focus: obj.kind === "text" });
}

function setSlideObjectZOrder(action, objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideObjectById(page, objectId);
  if (!page || !obj) return;
  const ordered = orderedSlideObjects(page);
  const currentIndex = ordered.findIndex((candidate) => candidate?.id === obj.id);
  if (currentIndex < 0) return;
  let nextIndex = currentIndex;
  if (action === "front") nextIndex = ordered.length - 1;
  else if (action === "back") nextIndex = 0;
  else if (action === "forward") nextIndex = Math.min(ordered.length - 1, currentIndex + 1);
  else if (action === "backward") nextIndex = Math.max(0, currentIndex - 1);
  if (nextIndex === currentIndex) return;
  recordSlideUndoCheckpoint("Arrange object");
  const [moved] = ordered.splice(currentIndex, 1);
  ordered.splice(nextIndex, 0, moved);
  ordered.forEach((object, index) => {
    object.zIndex = index + 1;
  });
  page.objects = ordered;
  activeSlideTextObjectId = obj.id;
  setDeckDirty(true);
  renderSlideCanvas();
  selectSlideObject(obj.id, { focus: obj.kind === "text" });
}

function deleteSlideTextObject(objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideTextObjectById(page, objectId);
  if (!page || !obj) return;
  deleteSlideObject(objectId);
}

function updateSlideTextObjectStyle(style, objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideTextObjectById(page, objectId);
  if (!obj || !style || typeof style !== "object") return;
  recordSlideUndoForMutation("Style text object");
  obj.style = { ...(obj.style || {}), ...style };
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  selectSlideTextObject(obj.id, { focus: true });
  void syncActiveDeckPresentation().catch(console.error);
}

function setSlideTextObjectBackground(background, objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideTextObjectById(page, objectId);
  if (!obj) return;
  recordSlideUndoForMutation("Set text background");
  if (background) {
    obj.background = background;
  } else {
    delete obj.background;
  }
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  selectSlideTextObject(obj.id, { focus: true });
  void syncActiveDeckPresentation().catch(console.error);
}

function setSlideImageObjectFit(fit, objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideObjectById(page, objectId);
  if (!obj || obj.kind !== "image") return;
  const nextFit = fit === "cover" || fit === "fill" ? fit : "contain";
  if ((obj.image?.fit || "contain") === nextFit) return;
  recordSlideUndoForMutation("Set image fit");
  obj.image = {
    ...(obj.image && typeof obj.image === "object" ? obj.image : {}),
    fit: nextFit,
  };
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  selectSlideObject(obj.id);
}

function updateSlideShapeObject(shapePatch, objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideObjectById(page, objectId);
  if (!obj || obj.kind !== "shape" || !shapePatch || typeof shapePatch !== "object") return;
  recordSlideUndoForMutation("Style shape");
  const currentShape = obj.shape && typeof obj.shape === "object" ? obj.shape : {};
  const nextShape = { ...currentShape, ...shapePatch };
  if (nextShape.type !== "ellipse" && nextShape.type !== "line") nextShape.type = "rect";
  obj.shape = nextShape;
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  selectSlideObject(obj.id);
}

function getOrCreateCallbackColorInput(id, onColor) {
  let input = document.getElementById(id);
  if (!input) {
    input = document.createElement("input");
    input.type = "color";
    input.id = id;
    input.style.position = "fixed";
    input.style.left = "-100px";
    input.style.top = "-100px";
    input.style.width = "32px";
    input.style.height = "32px";
    input.style.opacity = "0.01";
    input.style.pointerEvents = "none";
    input.style.zIndex = "999999";
    document.body.appendChild(input);
  }
  input.oninput = (event) => onColor(event.target.value);
  input.onchange = (event) => {
    onColor(event.target.value);
    commitSlideUndoTransaction();
  };
  input.onblur = () => commitSlideUndoTransaction();
  return input;
}

function hideSlidesEditorContextMenu() {
  const menu = document.getElementById("slidesEditorContextMenu");
  if (!menu) return;
  menu.style.display = "none";
  menu.style.visibility = "";
}

function positionSlidesEditorContextMenu(menu, x, y) {
  menu.classList.add("slides-editor-context-menu");
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.style.visibility = "hidden";
  menu.style.display = "block";
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
  menu.style.visibility = "";
}

function showCallbackColorPicker(event, inputId, color, onColor) {
  event.preventDefault();
  event.stopPropagation();
  beginSlideUndoTransaction("Pick color");
  const input = getOrCreateCallbackColorInput(inputId, onColor);
  input.value = color || "#ffffff";
  input.style.left = `${event.clientX}px`;
  input.style.top = `${event.clientY}px`;
  hideSlidesEditorContextMenu();
  input.focus({ preventScroll: true });
  try {
    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }
  } catch {}
  input.click();
}

function appendSlidesMenuItem(menu, label, onClick, { active = false, icon = "" } = {}) {
  const item = document.createElement("div");
  item.className = "song-editor-context-menu__item";
  if (active) item.classList.add("song-editor-context-menu__item--active");
  item.innerHTML = icon ? `<span class="icon">${icon}</span> ${label}` : label;
  item.addEventListener("click", onClick);
  menu.appendChild(item);
  return item;
}

function appendSlidesMenuHeader(menu, label) {
  const header = document.createElement("div");
  header.className = "song-editor-context-menu__header";
  header.textContent = label;
  menu.appendChild(header);
}

function appendSlidesMenuSeparator(menu) {
  menu.appendChild(document.createElement("div")).className = "song-editor-context-menu__separator";
}

function appendSlidesMenuButtonRow(menu, buttons, { columns = 3 } = {}) {
  const row = document.createElement("div");
  row.className = "slides-editor-context-menu__button-row";
  row.style.gridTemplateColumns = `repeat(${Math.max(1, columns)}, minmax(0, 1fr))`;
  for (const buttonDef of buttons) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "slides-editor-context-menu__button";
    if (buttonDef.active) button.classList.add("is-active");
    if (buttonDef.disabled) button.disabled = true;
    button.textContent = buttonDef.label;
    if (buttonDef.title) button.title = buttonDef.title;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      buttonDef.onClick?.(event);
    });
    row.appendChild(button);
  }
  menu.appendChild(row);
  return row;
}

function appendSlidesMenuSelect(menu, value, options, onChange) {
  const row = document.createElement("div");
  row.className = "slides-editor-context-menu__select-row";
  const select = document.createElement("select");
  select.className = "slides-editor-context-menu__select";
  for (const option of options) {
    const optionEl = document.createElement("option");
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    select.appendChild(optionEl);
  }
  select.value = value;
  select.addEventListener("change", () => onChange?.(select.value));
  row.appendChild(select);
  menu.appendChild(row);
  return select;
}

function appendSlideObjectMenuItems(menu, object, event) {
  const opacity = clampSlideOpacity(object?.opacity, 1);

  appendSlidesMenuHeader(menu, "Object");
  appendSlidesMenuButtonRow(menu, [
    {
      label: "Copy",
      onClick: () => {
        copySlideObject(object.id);
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Cut",
      onClick: () => {
        cutSlideObject(object.id);
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Paste",
      active: Boolean(slideObjectClipboard),
      onClick: () => {
        pasteSlideObject({ clientX: event?.clientX, clientY: event?.clientY });
        hideSlidesEditorContextMenu();
      },
    },
  ]);

  appendSlidesMenuSeparator(menu);
  appendSlidesMenuHeader(menu, "Arrange");
  appendSlidesMenuButtonRow(menu, [
    {
      label: "Forward",
      onClick: () => {
        setSlideObjectZOrder("forward", object.id);
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Backward",
      onClick: () => {
        setSlideObjectZOrder("backward", object.id);
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Front",
      onClick: () => {
        setSlideObjectZOrder("front", object.id);
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Back",
      onClick: () => {
        setSlideObjectZOrder("back", object.id);
        hideSlidesEditorContextMenu();
      },
    },
  ], { columns: 2 });

  appendSlidesMenuSeparator(menu);
  appendSlidesMenuHeader(menu, "Opacity");
  appendSlidesMenuButtonRow(menu, [
    { label: "100%", value: 1 },
    { label: "75%", value: 0.75 },
    { label: "50%", value: 0.5 },
    { label: "25%", value: 0.25 },
    { label: "0%", value: 0 },
  ].map((option) => ({
    label: option.label,
    active: Math.abs(opacity - option.value) < 0.01,
    onClick: () => {
      setSlideObjectOpacity(option.value, object.id);
      hideSlidesEditorContextMenu();
    },
  })), { columns: 5 });
}

function showSlideObjectContextMenu(event, objectId) {
  event.preventDefault();
  event.stopPropagation();
  const page = currentPage();
  const obj = slideObjectById(page, objectId);
  const menu = document.getElementById("slidesEditorContextMenu");
  if (!obj || !menu) return;
  if (obj.kind === "text") {
    showSlideTextObjectContextMenu(event, objectId);
    return;
  }
  selectSlideObject(obj.id);
  menu.innerHTML = "";
  appendSlideObjectMenuItems(menu, obj, event);

  if (obj.kind === "image") {
    const image = obj.image && typeof obj.image === "object" ? obj.image : {};
    const fit = image.fit === "cover" || image.fit === "fill" ? image.fit : "contain";
    appendSlidesMenuSeparator(menu);
    appendSlidesMenuHeader(menu, "Image");
    appendSlidesMenuButtonRow(menu, [
      {
        label: "Replace",
        onClick: () => {
          chooseSlideObjectImage({ targetId: obj.id });
          hideSlidesEditorContextMenu();
        },
      },
      ...["cover", "contain", "fill"].map((value) => ({
        label: value[0].toUpperCase() + value.slice(1),
        active: fit === value,
        onClick: () => {
          setSlideImageObjectFit(value, obj.id);
          hideSlidesEditorContextMenu();
        },
      })),
    ], { columns: 2 });
  } else if (obj.kind === "shape") {
    const shape = obj.shape && typeof obj.shape === "object" ? obj.shape : {};
    const shapeType = shape.type === "ellipse" || shape.type === "line" ? shape.type : "rect";
    appendSlidesMenuSeparator(menu);
    appendSlidesMenuHeader(menu, "Shape");
    appendSlidesMenuButtonRow(menu, [
      {
        label: "Fill",
        onClick: (evt) => {
          showCallbackColorPicker(
            evt,
            "slidesShapeFillInput",
            shape.fill || "#3584e4",
            (color) => updateSlideShapeObject({ fill: color }, obj.id),
          );
        },
      },
      {
        label: "Stroke",
        onClick: (evt) => {
          showCallbackColorPicker(
            evt,
            "slidesShapeStrokeInput",
            shape.stroke || shape.fill || "#ffffff",
            (color) => updateSlideShapeObject({
              stroke: color,
              strokeWidth: Number.isFinite(shape.strokeWidth) && shape.strokeWidth > 0 ? shape.strokeWidth : 4,
            }, obj.id),
          );
        },
      },
    ], { columns: 2 });
    appendSlidesMenuButtonRow(menu, [
      { label: "Rect", value: "rect" },
      { label: "Ellipse", value: "ellipse" },
      { label: "Line", value: "line" },
    ].map((option) => ({
      label: option.label,
      active: shapeType === option.value,
      onClick: () => {
        updateSlideShapeObject({
          type: option.value,
          ...(option.value === "line" && !(Number.isFinite(shape.strokeWidth) && shape.strokeWidth > 0)
            ? { strokeWidth: 6, stroke: shape.stroke || shape.fill || "#ffffff" }
            : {}),
        }, obj.id);
        hideSlidesEditorContextMenu();
      },
    })), { columns: 3 });
  }

  appendSlidesMenuSeparator(menu);
  appendSlidesMenuButtonRow(menu, [
    {
      label: "Duplicate",
      onClick: () => {
        insertSlideObjectCopy(obj);
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Delete",
      onClick: () => {
        deleteSlideObject(obj.id);
        hideSlidesEditorContextMenu();
      },
    },
  ], { columns: 2 });
  positionSlidesEditorContextMenu(menu, event.clientX, event.clientY);
}

function showSlideTextObjectContextMenu(event, objectId) {
  event.preventDefault();
  event.stopPropagation();
  const page = currentPage();
  const obj = slideTextObjectById(page, objectId);
  const menu = document.getElementById("slidesEditorContextMenu");
  if (!obj || !menu) return;
  selectSlideTextObject(obj.id);
  captureSlideTextSelection(obj.id);
  const style = obj.style || {};
  const background = obj.background || null;
  menu.innerHTML = "";

  appendSlideObjectMenuItems(menu, obj, event);
  appendSlidesMenuSeparator(menu);
  appendSlidesMenuHeader(menu, "Text Format");
  appendSlidesMenuButtonRow(menu, [{
    label: "Text Color",
    onClick: (evt) => {
      showCallbackColorPicker(
        evt,
        "slidesObjectTextColorInput",
        style.color || currentDeck?.theme?.textColor || DEFAULT_DECK_THEME.textColor,
        (color) => applySlideTextObjectFormatting({ color }, obj.id),
      );
    },
  }], { columns: 1 });
  appendSlidesMenuButtonRow(menu, [
    {
      label: "Bold",
      active: String(style.fontWeight || "") === "700" || style.fontWeight === "bold",
      onClick: () => {
        applySlideTextObjectFormatting({ fontWeight: "700" }, obj.id);
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Italic",
      active: style.fontStyle === "italic",
      onClick: () => {
        applySlideTextObjectFormatting({ fontStyle: "italic" }, obj.id);
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Underline",
      active: String(style.textDecoration || "").includes("underline"),
      onClick: () => {
        applySlideTextObjectFormatting({ textDecoration: "underline" }, obj.id);
        hideSlidesEditorContextMenu();
      },
    },
  ], { columns: 3 });

  const fontInput = document.getElementById("slidesDeckFontFamily");
  const fonts = fontInput
    ? Array.from(fontInput.options).map((option) => ({
        label: option.textContent || option.value,
        value: option.value,
      }))
    : [
        { label: "Adwaita Sans", value: "Adwaita Sans" },
        { label: "CMG Sans", value: "CMG Sans" },
        { label: "Arial", value: "Arial" },
        { label: "Georgia", value: "Georgia" },
      ];
  appendSlidesMenuSeparator(menu);
  appendSlidesMenuHeader(menu, "Font Family");
  const activeFont = style.fontFamily || currentDeck?.theme?.fontFamily || DEFAULT_DECK_THEME.fontFamily;
  appendSlidesMenuSelect(menu, activeFont, fonts, (fontFamily) => {
    applySlideTextObjectFormatting({ fontFamily }, obj.id);
    hideSlidesEditorContextMenu();
  });

  appendSlidesMenuSeparator(menu);
  appendSlidesMenuHeader(menu, "Text Box Background");
  appendSlidesMenuButtonRow(menu, [
    {
      label: "Color",
      onClick: (evt) => {
        showCallbackColorPicker(
          evt,
          "slidesObjectBackgroundColorInput",
          background?.color || "#000000",
          (color) => setSlideTextObjectBackground({ type: "color", color }, obj.id),
        );
      },
    },
    {
      label: "Media",
      onClick: (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        slideTextObjectBackgroundTargetId = obj.id;
        hideSlidesEditorContextMenu();
        document.getElementById("slidesTextObjectBackgroundInput")?.click();
      },
    },
    ...(background
      ? [{
          label: "Clear",
          onClick: (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            setSlideTextObjectBackground(null, obj.id);
            hideSlidesEditorContextMenu();
          },
        }]
      : []),
  ], { columns: background ? 3 : 2 });

  appendSlidesMenuSeparator(menu);
  appendSlidesMenuButtonRow(menu, [
    {
      label: "Duplicate",
      onClick: () => {
        duplicateSlideTextObject(obj.id);
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Delete",
      onClick: () => {
        deleteSlideTextObject(obj.id);
        hideSlidesEditorContextMenu();
      },
    },
  ], { columns: 2 });

  positionSlidesEditorContextMenu(menu, event.clientX, event.clientY);
}

function showSlideCanvasContextMenu(event) {
  if (event.target.closest?.(".slides-canvas-text-object")) return;
  event.preventDefault();
  event.stopPropagation();
  const menu = document.getElementById("slidesEditorContextMenu");
  if (!menu) return;
  menu.innerHTML = "";
  appendSlidesMenuHeader(menu, "Canvas");
  appendSlidesMenuButtonRow(menu, [
    {
      label: "Text Box",
      onClick: () => {
        addSlideTextBox();
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Image",
      onClick: () => {
        chooseSlideObjectImage({ clientX: event.clientX, clientY: event.clientY });
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Rect",
      onClick: () => {
        addSlideShapeObject("rect", { clientX: event.clientX, clientY: event.clientY });
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Ellipse",
      onClick: () => {
        addSlideShapeObject("ellipse", { clientX: event.clientX, clientY: event.clientY });
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Line",
      onClick: () => {
        addSlideShapeObject("line", { clientX: event.clientX, clientY: event.clientY });
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Paste",
      active: Boolean(slideObjectClipboard),
      onClick: () => {
        pasteSlideObject({ clientX: event.clientX, clientY: event.clientY });
        hideSlidesEditorContextMenu();
      },
    },
  ], { columns: 3 });
  positionSlidesEditorContextMenu(menu, event.clientX, event.clientY);
}

function slideEditorShortcutEditableTarget(event) {
  const target = event.target;
  const editable = target?.closest?.("input, textarea, select, [contenteditable='true']");
  if (!editable) return null;
  if (!editable.closest?.("#slidesWorkspace")) return editable;
  return editable;
}

function editableSelectionIsCollapsed(editable) {
  if (
    (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) &&
    typeof editable.selectionStart === "number" &&
    typeof editable.selectionEnd === "number"
  ) {
    return editable.selectionStart === editable.selectionEnd;
  }
  const selection = window.getSelection?.();
  return !selection || selection.isCollapsed;
}

function handleSlideEditorClipboardShortcut(event) {
  if (!isSlidesWorkspaceVisible()) return false;
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
  const key = String(event.key || "").toLowerCase();
  if (!["c", "x", "v"].includes(key)) return false;
  const editable = slideEditorShortcutEditableTarget(event);
  if (editable) {
    const isSlideTextBox = Boolean(editable.closest?.(".slides-canvas-text-object"));
    if (key === "v" || !isSlideTextBox || !editableSelectionIsCollapsed(editable)) {
      return false;
    }
  }
  event.preventDefault();
  event.stopPropagation();
  if (key === "c") return copySlideObject(), true;
  if (key === "x") return cutSlideObject(), true;
  pasteSlideObject();
  return true;
}

function handleSlideEditorUndoRedoShortcut(event) {
  if (!isSlidesWorkspaceVisible()) return false;
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
  const key = String(event.key || "").toLowerCase();
  const wantsUndo = key === "z" && !event.shiftKey;
  const wantsRedo = key === "y" || (key === "z" && event.shiftKey);
  if (!wantsUndo && !wantsRedo) return false;
  if (slideEditorShortcutEditableTarget(event)) return false;
  event.preventDefault();
  event.stopPropagation();
  return wantsUndo ? undoSlideEdit() : redoSlideEdit();
}

function handleSlideEditorDeleteShortcut(event) {
  if (!isSlidesWorkspaceVisible()) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key !== "Delete" && event.key !== "Backspace") return false;
  if (slideEditorShortcutEditableTarget(event)) return false;
  if (!activeSlideTextObjectId) return false;
  event.preventDefault();
  event.stopPropagation();
  return deleteSlideObject(activeSlideTextObjectId);
}

function bindSlideUndoControlTransactions() {
  const controls = [
    ["slidesDeckTitleInput", "Edit deck title"],
    ["slidesDeckFolderSelect", "Move deck"],
    ["slidesDeckFontFamily", "Change deck font"],
    ["slidesDeckFontSize", "Change deck font size"],
    ["slidesDeckTextColor", "Change deck text color"],
    ["slidesDeckBgColor", "Change deck background"],
    ["slidesPageLabelInput", "Edit page label"],
    ["slidesPageBackgroundColor", "Change page background"],
    ["slidesPageNotes", "Edit page notes"],
    ["slidesPageTransitionEffect", "Change transition"],
    ["slidesPageTransitionDuration", "Change transition"],
  ];
  for (const [id, label] of controls) {
    const control = document.getElementById(id);
    if (!control || control.dataset.slideUndoBound === "1") continue;
    control.dataset.slideUndoBound = "1";
    control.addEventListener("focus", () => beginSlideUndoTransaction(label));
    control.addEventListener("pointerdown", () => beginSlideUndoTransaction(label));
    control.addEventListener("change", () => commitSlideUndoTransaction());
    control.addEventListener("blur", () => commitSlideUndoTransaction());
  }
}

function attachSlideCanvasInteractions() {
  const canvas = document.getElementById("slidesCanvas");
  if (!canvas || canvas.dataset.slideInteractionsInstalled === "1") return;
  canvas.dataset.slideInteractionsInstalled = "1";
  canvas.addEventListener("contextmenu", showSlideCanvasContextMenu);
  document.addEventListener("pointerdown", (event) => {
    const menu = document.getElementById("slidesEditorContextMenu");
    if (!menu || menu.style.display === "none") return;
    if (menu.contains(event.target)) return;
    hideSlidesEditorContextMenu();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (handleSlideEditorUndoRedoShortcut(event)) return;
    if (handleSlideEditorClipboardShortcut(event)) return;
    if (handleSlideEditorDeleteShortcut(event)) return;
    if (event.key === "Escape") hideSlidesEditorContextMenu();
  });

  const mediaInput = document.getElementById("slidesTextObjectBackgroundInput");
  mediaInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    const targetId = slideTextObjectBackgroundTargetId || activeSlideTextObjectId;
    slideTextObjectBackgroundTargetId = null;
    if (!file || !targetId) return;
    const filePath = typeof getPathForFile === "function" ? getPathForFile(file) : "";
    if (!filePath) {
      showGnomeToast("Could not resolve file path");
      return;
    }
    const type = /\.(mp4|webm|mov|m4v)$/i.test(filePath) ? "video" : "image";
    setSlideTextObjectBackground({ type, path: filePath }, targetId);
    event.target.value = "";
  });

  const imageInput = document.getElementById("slidesObjectImageInput");
  imageInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    const targetId = slideObjectImageTargetId;
    const insertPoint = slideObjectImageInsertPoint;
    slideObjectImageTargetId = null;
    slideObjectImageInsertPoint = null;
    if (!file) return;
    const filePath = typeof getPathForFile === "function" ? getPathForFile(file) : "";
    if (!filePath) {
      showGnomeToast("Could not resolve file path");
      return;
    }
    if (targetId) {
      replaceSlideImageObject(targetId, filePath);
    } else {
      addSlideImageObject(filePath, insertPoint || {});
    }
    event.target.value = "";
  });
}

function updateCurrentSlideTransitionFromControls() {
  const page = currentPage();
  if (!page) return;
  recordSlideUndoForMutation("Change transition");
  const transition = readSlideTransitionControls(
    "slidesPageTransitionEffect",
    "slidesPageTransitionDuration",
    { allowInherit: true },
  );
  const override = normalizeItemSlideTransitionOverride(transition);
  if (override) {
    page.transition = override;
  } else {
    delete page.transition;
  }
  setDeckDirty(true);
  void syncActiveDeckPresentation().catch(console.error);
}

/* ── Show Now / Schedule ──────────────────────────────────── */

function buildDeckQueueEntry({ pageId = null } = {}) {
  if (!currentDeck) return null;
  flushSlideEditorTextToModel();
  if (currentDeckIsSongDocument()) {
    return buildSongQueueEntryFromDeck({
      deck: currentDeck,
      render: {
        ...currentSongRenderState,
        ...deckDefaultRender(currentDeck),
      },
      currentSectionId: pageId || currentDeckPageId,
      sourceKind: "library",
    });
  }
  const transientSong = deckToTransientSong(currentDeck);
  if (!transientSong) return null;
  const targetPageId = pageId || currentDeckPageId || transientSong.sections[0]?.id || null;
  const page = findPage(currentDeck, targetPageId);
  const overrides = pageRenderOverrides(page, currentDeck);
  const render = { ...deckDefaultRender(currentDeck), ...overrides };
  const entry = queueEntryFromSong({
    song: transientSong,
    render,
    currentSectionId: targetPageId,
  });
  const transitionOverride = normalizeItemSlideTransitionOverride(page?.transition);
  if (transitionOverride) entry.transition = transitionOverride;
  // Runtime rendering still uses the transient song snapshot, while project
  // identity and editor routing come from type/source/deckSnapshot.
  entry.type = "deck";
  entry.path = deckQueuePath(currentDeck.id, targetPageId);
  entry.name = currentDeck.title || "Slide Deck";
  entry.source = {
    kind: "deck",
    deckId: currentDeck.id,
    pageId: targetPageId,
    songId: transientSong.id,
  };
  entry.deckSnapshot = normalizeSlideDeck(currentDeck);
  return entry;
}

function syncCurrentDeckQueueItemSnapshot() {
  if (!currentDeck || !currentDeckPageId || !queueItemMatchesDeck(currentSongQueueItem, currentDeck)) {
    return null;
  }
  const existingItem = currentSongQueueItem;
  const preserved = {
    autoAdvance: existingItem.autoAdvance,
    cueStartTime: existingItem.cueStartTime,
    cueVolume: existingItem.cueVolume,
    loop: existingItem.loop,
  };
  const updated = buildDeckQueueEntry({ pageId: currentDeckPageId });
  if (!updated) return null;
  Object.assign(existingItem, updated);
  existingItem.autoAdvance = preserved.autoAdvance;
  existingItem.cueStartTime = preserved.cueStartTime;
  if (preserved.cueVolume !== undefined) existingItem.cueVolume = preserved.cueVolume;
  if (preserved.loop !== undefined) existingItem.loop = preserved.loop;
  currentWorkspaceSongDeck = existingItem.deckSnapshot || normalizeSlideDeck(currentDeck);
  currentWorkspaceSong = existingItem.songSnapshot || deckToTransientSong(currentWorkspaceSongDeck);
  currentSongRenderState = mergeSongRenderState(DEFAULT_SONG_RENDER, existingItem.render || {});
  currentSongSectionId = currentDeckPageId;
  return existingItem;
}

async function syncActiveDeckPresentation() {
  const item = syncCurrentDeckQueueItemSnapshot();
  if (!item) return false;
  return syncActiveScheduledSongPresentation();
}

async function showCurrentDeckNow() {
  if (!currentDeck) {
    showGnomeToast("Select a deck first");
    return;
  }
  if (typeof hasAudienceOutputSelected === "function" && !hasAudienceOutputSelected()) {
    showGnomeToast("Choose an audience output display");
    return;
  }
  const entry = buildDeckQueueEntry({});
  if (!entry) return;
  try {
    if (typeof currentWorkspaceSong !== "undefined") currentWorkspaceSong = entry.songSnapshot;
    if (typeof currentSongRenderState !== "undefined") {
      currentSongRenderState = mergeSongRenderState(DEFAULT_SONG_RENDER, entry.render || {});
    }
    if (typeof currentSongSectionId !== "undefined") currentSongSectionId = entry.render?.currentSectionId || null;
    if (typeof currentSongQueueItem !== "undefined") currentSongQueueItem = entry;
    if (typeof mediaPlaybackEndedPending !== "undefined") mediaPlaybackEndedPending = false;
    if (typeof pendingQueueSwitchIndex !== "undefined") pendingQueueSwitchIndex = null;
    if (typeof pendingQueueSwitchStartTime !== "undefined") pendingQueueSwitchStartTime = 0;
    if (typeof userStopPresentationPending !== "undefined") userStopPresentationPending = false;
    if (typeof currentQueueIndex !== "undefined") currentQueueIndex = -1;

    if (typeof isActiveMediaWindow === "function" && isActiveMediaWindow() && activeMediaWindowContentType === "song") {
      await sendSongTextToOutput(entry);
      if (typeof isPlaying !== "undefined") isPlaying = true;
      if (typeof isQueuePlaying !== "undefined") isQueuePlaying = false;
      activeMediaWindowContentType = "song";
      if (typeof markSongShowNowPresentation === "function") {
        markSongShowNowPresentation(entry);
      }
      if (typeof isActiveMediaWindowCache !== "undefined") isActiveMediaWindowCache = true;
      if (typeof updateDynUI === "function") updateDynUI();
      if (typeof renderQueue === "function") renderQueue();
      return;
    }
    const started = await createMediaWindow({
      textItem: entry,
      transientText: true,
      songItem: true,
    });
    if (!started) {
      showGnomeToast("No output started");
      return;
    }
    activeMediaWindowContentType = "song";
    if (typeof isPlaying !== "undefined") isPlaying = true;
    if (typeof isQueuePlaying !== "undefined") isQueuePlaying = false;
    if (typeof markSongShowNowPresentation === "function") {
      markSongShowNowPresentation(entry);
    }
    if (typeof isActiveMediaWindowCache !== "undefined") isActiveMediaWindowCache = true;
    if (typeof updateDynUI === "function") updateDynUI();
    if (typeof renderQueue === "function") renderQueue();
  } catch (err) {
    console.error("Failed to show deck:", err);
    showGnomeToast(`Failed to show deck: ${err.message || err}`);
  }
}

function scheduleCurrentDeck() {
  if (!currentDeck) {
    showGnomeToast("Select a deck first");
    return;
  }
  const entry = buildDeckQueueEntry({});
  if (!entry) return;
  invalidateQueueUndoToastAfterMutation();
  insertQueueEntriesAfterSelection([entry]);
  renderQueue();
  saveMediaFile();
  showGnomeToast(`Scheduled ${entry.name}`);
}

async function openSongEditor(song) {
  const drawer = document.getElementById("songEditorDrawer");
  if (!drawer) return;

  let songToEdit = song || null;
  if (songToEdit?.id) {
    const exists = await checkIfSongInLibrary(songToEdit.id);
    if (exists) {
      try {
        songToEdit = await songsAPI.get(songToEdit.id);
        currentWorkspaceSong = songToEdit;
        syncSongsMoveFolderSelect(songToEdit);
      } catch (err) {
        console.error("Failed to load song for editing:", err);
        showGnomeToast("Failed to load song for editing");
        return;
      }
    } else {
      console.warn("Song not found in library, editing local/schedule snapshot instead");
      currentWorkspaceSong = songToEdit;
      syncSongsMoveFolderSelect(songToEdit, false);
    }
  }

  if (!songToEdit) {
    currentSongRenderState = { ...DEFAULT_SONG_RENDER };
    const blankSong = normalizeToSongAST({
      schema: "ems.song.v1",
      id: `song_${crypto.randomUUID()}`,
      title: "Untitled Song",
      metadata: { authors: [], copyright: "", ccliNumber: null, oneLicense: null },
      sections: [
        {
          id: `sec_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`,
          kind: "verse",
          label: "Verse 1",
          blocks: textToSegmentsBlocks(""),
        },
      ],
      playOrder: [],
    });
    songToEdit = songAstToDeck(blankSong, { documentType: SONG_DECK_DOCUMENT_TYPE });
  }

  const songDeck = songDeckDocumentFromSongDocument(songToEdit, currentSongRenderState);
  if (!songDeck) {
    showGnomeToast("Could not open song editor");
    return;
  }
  currentEditingSongId = songDeck.id;
  currentWorkspaceSongDeck = songDeck;
  currentWorkspaceSong = deckToTransientSong(songDeck);
  currentSongRenderState = mergeSongRenderState(
    songRenderStateFromSongDocument(songDeck),
    currentSongRenderState,
  );
  currentSongSectionId =
    currentSongSectionId && findPage(songDeck, currentSongSectionId)
      ? currentSongSectionId
      : songDeck.pages?.[0]?.id || null;
  document.getElementById("songEditorDrawer")?.setAttribute("hidden", "");
  showSlidesWorkspace();
  loadDeckIntoWorkspace(songDeck, {
    pageId: currentSongSectionId,
    documentType: SONG_DECK_DOCUMENT_TYPE,
  });
  return;

  const launcher = document.getElementById("songsLauncher");
  const slide = document.getElementById("songsPreviewSlide");
  if (launcher) launcher.hidden = true;
  if (slide) slide.hidden = true;
  drawer.removeAttribute("hidden");

  const titleInput = document.getElementById("songEditorTitle");
  const authorInput = document.getElementById("songEditorAuthor");
  const folderInput = document.getElementById("songEditorFolder");
  const numberInput = document.getElementById("songEditorNumber");
  const textarea = document.getElementById("songEditorTextarea");

  syncSongEditorFolderOptions(songToEdit?.folderId || "");

  // Initialize visual editor state
  songEditorSections = songToEdit
    ? (normalizeToSongAST(songToEdit)?.sections || [])
    : [];
  if (songEditorSections.length === 0) {
    songEditorSections.push({
      id: `sec_${crypto.randomUUID().slice(0, 8)}`,
      kind: "verse",
      number: 1,
      label: "Verse 1",
      blocks: []
    });
  }
  songEditorActiveIndex = 0;

  // Set default tab to "Slides"
  document.getElementById("songEditorTabSlidesBtn")?.classList.add("active");
  document.getElementById("songEditorTabPropsBtn")?.classList.remove("active");
  document.getElementById("songEditorTabSlides")?.removeAttribute("style");
  document.getElementById("songEditorTabProps")?.setAttribute("style", "display: none;");

  // Set Header Title
  const headerTitle = document.getElementById("songEditorHeaderTitle");
  if (headerTitle) {
    headerTitle.textContent = songToEdit ? `Edit: ${songToEdit.title}` : "New Song";
  }

  if (songToEdit) {
    currentEditingSongId = songToEdit.id;
    titleInput.value = songToEdit.title || "";
    if (numberInput) {
      numberInput.value =
        Number.isFinite(songToEdit.songNumber) && songToEdit.songNumber > 0
          ? String(songToEdit.songNumber)
          : "";
    }
    authorInput.value = songToEdit.metadata?.authors?.join(", ") || "";
    if (folderInput) folderInput.value = songToEdit.folderId || "";
    textarea.value = songEditorTextFromSections(songEditorSections);
    syncSongEditorRenderControls(currentSongRenderState);
  } else {
    currentEditingSongId = null;
    titleInput.value = "";
    if (numberInput) numberInput.value = "";
    authorInput.value = "";
    if (folderInput) {
      folderInput.value =
        currentSongFolderFilter !== SONG_FOLDER_ALL &&
        currentSongFolderFilter !== SONG_FOLDER_UNFILED
          ? currentSongFolderFilter
          : "";
    }
    textarea.value = "";
    currentSongRenderState = { ...DEFAULT_SONG_RENDER };
    syncSongEditorRenderControls();
    syncSongEditorWorkspaceStyles();
  }

  const textBox = document.getElementById("songEditorTextBox");
  if (textBox) {
    const pos = currentSongRenderState.textBoxPosition || { left: "10%", top: "10%", width: "80%", height: "80%" };
    textBox.style.left = pos.left;
    textBox.style.top = pos.top;
    textBox.style.width = pos.width;
    textBox.style.height = pos.height;
  }
  syncSongEditorWorkspaceStyles();

  // Build the list and select the first slide
  renderSongEditorSlideList();
  selectSongEditorSlide(0);
}

async function checkIfSongInLibrary(songId) {
  if (!songId) return false;
  try {
    const results = await songsAPI.search("", { all: true });
    return results.some(song => song.id === songId);
  } catch (err) {
    return false;
  }
}

async function updateScheduleSongsWithUpdatedSong(song, opts = {}) {
  const applyTransitionOverride = opts.applyTransitionOverride === true;
  const songDeck = songDeckDocumentFromSongDocument(song, currentSongRenderState);
  const songId = songDeck?.id || song?.id;
  let updatedCount = 0;
  for (let i = 0; i < mediaQueue.length; i++) {
    const item = mediaQueue[i];
    if (
      item.type === "song" &&
      (item.source?.songId === songId || item.deckSnapshot?.id === songId || parseSongQueuePath(item.path) === songId)
    ) {
      const updatedEntry = buildSongQueueEntryFromDeck({
        deck: songDeck,
        render: currentSongRenderState,
        currentSectionId: item.render?.currentSectionId || currentSongSectionId,
      });
      if (!updatedEntry) continue;
      updatedEntry.autoAdvance = item.autoAdvance;
      updatedEntry.cueStartTime = item.cueStartTime;
      if (applyTransitionOverride) {
        const transitionOverride = normalizeItemSlideTransitionOverride(currentSongRenderState.transition);
        if (transitionOverride) {
          updatedEntry.transition = transitionOverride;
        } else {
          delete updatedEntry.transition;
        }
      } else if (item.transition) {
        updatedEntry.transition = item.transition;
      }
      mediaQueue[i] = updatedEntry;
      updatedCount++;
    }
  }
  if (updatedCount > 0) {
    invalidateQueueUndoToastAfterMutation();
    renderQueue();
    saveMediaFile();
  }
}

async function saveSongEditor() {
  const titleInput = document.getElementById("songEditorTitle");
  const authorInput = document.getElementById("songEditorAuthor");
  const folderInput = document.getElementById("songEditorFolder");
  const numberInput = document.getElementById("songEditorNumber");
  const textarea = document.getElementById("songEditorTextarea");

  const title = titleInput.value.trim() || "Untitled Song";
  const authorText = authorInput.value.trim();
  const folderId = folderInput?.value?.trim() || null;
  const numberRaw = numberInput?.value?.trim() || "";
  const parsedNumber = numberRaw ? Number.parseInt(numberRaw, 10) : null;
  const songNumber = Number.isFinite(parsedNumber) && parsedNumber > 0 ? parsedNumber : null;
  currentSongRenderState = flushSongEditorStateForSave();
  const sections = normalizeToSongAST({
    id: currentEditingSongId || "editor_song",
    title,
    metadata: {},
    sections: songEditorSections,
  })?.sections || [];

  const song = {
    schema: "ems.song.v1",
    id: currentEditingSongId || `song_${crypto.randomUUID()}`,
    title,
    folderId,
    ...(songNumber ? { songNumber } : {}),
    metadata: {
      authors: authorText ? authorText.split(",").map((a) => a.trim()).filter(Boolean) : [],
      copyright: currentSongRenderState.copyright || "",
      ccliNumber: currentSongRenderState.ccliNumber || null,
      oneLicense: currentSongRenderState.oneLicense || null,
      meter: currentWorkspaceSong?.metadata?.meter || currentWorkspaceSong?.metadata?.hymnal?.meter || "",
    },
    sections,
    playOrder: sections.map((s) => ({
      id: `seq_${s.id}`,
      sectionId: s.id,
      enabled: true,
    })),
    defaultRender: {
      ...songDefaultRenderFromRender(currentSongRenderState),
    },
  };
  const songDeck = songDeckDocumentFromSongDocument(song, currentSongRenderState);

  try {
    const saved = await songsAPI.save(songDeck);
    closeSongEditor();
    
    // Update schedule items with the saved song
    await updateScheduleSongsWithUpdatedSong(saved || songDeck);

    const searchInput = document.getElementById("songsSearchInput");
    await refreshSongFolders();
    if (searchInput) await refreshSongsBrowser(searchInput.value);
    await loadSongIntoWorkspace(saved || songDeck, { render: currentSongRenderState });
  } catch (err) {
    console.error("Failed to save song:", err);
    alert(`Failed to save song: ${err.message}`);
  }
}

async function saveSongToSchedule() {
  const titleInput = document.getElementById("songEditorTitle");
  const authorInput = document.getElementById("songEditorAuthor");
  const folderInput = document.getElementById("songEditorFolder");
  const numberInput = document.getElementById("songEditorNumber");
  const textarea = document.getElementById("songEditorTextarea");

  const title = titleInput.value.trim() || "Untitled Song";
  const authorText = authorInput.value.trim();
  const folderId = folderInput?.value?.trim() || null;
  const numberRaw = numberInput?.value?.trim() || "";
  const parsedNumber = numberRaw ? Number.parseInt(numberRaw, 10) : null;
  const songNumber = Number.isFinite(parsedNumber) && parsedNumber > 0 ? parsedNumber : null;
  currentSongRenderState = flushSongEditorStateForSave();
  const sections = normalizeToSongAST({
    id: currentEditingSongId || "editor_song",
    title,
    metadata: {},
    sections: songEditorSections,
  })?.sections || [];

  const songId = currentEditingSongId || `song_${crypto.randomUUID()}`;
  currentEditingSongId = songId;

  const song = {
    schema: "ems.song.v1",
    id: songId,
    title,
    folderId,
    ...(songNumber ? { songNumber } : {}),
    metadata: {
      authors: authorText ? authorText.split(",").map((a) => a.trim()).filter(Boolean) : [],
      copyright: currentSongRenderState.copyright || "",
      ccliNumber: currentSongRenderState.ccliNumber || null,
      oneLicense: currentSongRenderState.oneLicense || null,
      meter: currentWorkspaceSong?.metadata?.meter || currentWorkspaceSong?.metadata?.hymnal?.meter || "",
    },
    sections,
    playOrder: sections.map((s) => ({
      id: `seq_${s.id}`,
      sectionId: s.id,
      enabled: true,
    })),
    defaultRender: {
      ...songDefaultRenderFromRender(currentSongRenderState),
    },
  };

  const songDeck = songDeckDocumentFromSongDocument(song, currentSongRenderState);
  const entry = buildSongQueueEntryFromDeck({
    deck: songDeck,
    render: currentSongRenderState,
    currentSectionId: currentSongSectionId,
  });
  if (!entry) return;

  let updatedCount = 0;
  for (let i = 0; i < mediaQueue.length; i++) {
    const item = mediaQueue[i];
    if (
      item.type === "song" &&
      (item.source?.songId === songId || item.deckSnapshot?.id === songId || parseSongQueuePath(item.path) === songId)
    ) {
      const updatedEntry = buildSongQueueEntryFromDeck({
        deck: songDeck,
        render: currentSongRenderState,
        currentSectionId: item.render?.currentSectionId || currentSongSectionId,
      });
      if (!updatedEntry) continue;
      updatedEntry.autoAdvance = item.autoAdvance;
      updatedEntry.cueStartTime = item.cueStartTime;
      const transitionOverride = normalizeItemSlideTransitionOverride(currentSongRenderState.transition);
      if (transitionOverride) {
        updatedEntry.transition = transitionOverride;
      } else {
        delete updatedEntry.transition;
      }
      mediaQueue[i] = updatedEntry;
      updatedCount++;
    }
  }

  if (updatedCount > 0) {
    showGnomeToast(`Updated ${entry.name} in schedule`);
  } else {
    insertQueueEntriesAfterSelection([entry]);
    showGnomeToast(`Scheduled ${entry.name}`);
  }

  closeSongEditor();
  currentWorkspaceSongDeck = songDeck;
  currentWorkspaceSong = deckToTransientSong(songDeck);
  await loadSongIntoWorkspace(songDeck, { render: currentSongRenderState });

  invalidateQueueUndoToastAfterMutation();
  renderQueue();
  saveMediaFile();
}

async function deleteSongFromLibrary(songId = currentWorkspaceSong?.id) {
  const id = typeof songId === "string" ? songId.trim() : "";
  if (!id) {
    showGnomeToast("Select a song to delete");
    return false;
  }

  const title = currentWorkspaceSong?.id === id
    ? currentWorkspaceSong.title
    : id;
  const accepted = window.confirm(`Delete "${title}" from the song library? Scheduled project copies will not be removed.`);
  if (!accepted) return false;

  try {
    await songsAPI.delete(id);
    if (currentWorkspaceSong?.id === id) {
      await loadSongIntoWorkspace(null);
      const launcher = document.getElementById("songsLauncher");
      const slide = document.getElementById("songsPreviewSlide");
      if (launcher) launcher.hidden = false;
      if (slide) slide.hidden = true;
    }
    const searchInput = document.getElementById("songsSearchInput");
    await refreshSongFolders();
    await refreshSongsBrowser(searchInput?.value || "");
    showGnomeToast(`Deleted ${title}`);
    return true;
  } catch (err) {
    console.error("Failed to delete song:", err);
    showGnomeToast(`Delete failed: ${err.message}`);
    return false;
  }
}

function renderStateForLibrarySong(song) {
  return mergeSongRenderState(songRenderStateFromSongDocument(song), {
    copyright: song?.metadata?.copyright || "",
    ccliNumber: song?.metadata?.ccliNumber || null,
    oneLicense: song?.metadata?.oneLicense || null,
  });
}

async function loadFullLibrarySong(songSummary) {
  if (songSummary?.sections?.length || isSlideDeckDocument(songSummary)) return songSummary;
  return songsAPI.get(songSummary.id);
}

async function activateSongFromLibrary(songSummary, { openEditor = false } = {}) {
  try {
    currentSongQueueItem = null;
    const fullSong = await loadFullLibrarySong(songSummary);
    currentSongRenderState = renderStateForLibrarySong(fullSong);
    await loadSongIntoWorkspace(fullSong);
    document.querySelectorAll(".songs-list-item").forEach((el) => {
      el.classList.toggle("is-selected", el.dataset.songId === fullSong.id);
    });
    if (openEditor) {
      await openSongEditor(fullSong);
    }
    return fullSong;
  } catch (err) {
    console.error("Failed to load song details:", err);
    showGnomeToast("Failed to load song");
    return null;
  }
}

async function scheduleSongFromLibrary(songSummary) {
  try {
    const song = await loadFullLibrarySong(songSummary);
    const entry = buildSongQueueEntryFromDeck({
      deck: song,
      render: renderStateForLibrarySong(song),
    });
    if (!entry) return false;
    invalidateQueueUndoToastAfterMutation();
    insertQueueEntriesAfterSelection([entry]);
    renderQueue();
    saveMediaFile();
    showGnomeToast(`Scheduled ${entry.name}`);
    return true;
  } catch (err) {
    console.error("Failed to schedule song:", err);
    showGnomeToast("Failed to schedule song");
    return false;
  }
}

async function showSongFromLibraryNow(songSummary) {
  try {
    const song = await loadFullLibrarySong(songSummary);
    currentSongRenderState = renderStateForLibrarySong(song);
    await loadSongIntoWorkspace(song);
    document.querySelectorAll(".songs-list-item").forEach((el) => {
      el.classList.toggle("is-selected", el.dataset.songId === song.id);
    });
    return showSongTextNow();
  } catch (err) {
    console.error("Failed to show song:", err);
    showGnomeToast("Failed to show song");
    return false;
  }
}

function hideSongContextMenu() {
  document.getElementById("songContextMenu")?.setAttribute("hidden", "");
}

function buildSongContextMenuMarkup() {
  const folderItems = [
    `<button type="button" role="menuitem" data-song-action="move" data-folder-id="${SONG_FOLDER_UNFILED}">Default</button>`,
    ...songFoldersCache.map(
      (folder) =>
        `<button type="button" role="menuitem" data-song-action="move" data-folder-id="${escapeHtml(folder.id)}">${escapeHtml(folder.name)}</button>`,
    ),
  ].join("");
  return `
    <button type="button" role="menuitem" data-song-action="edit">Open Editor</button>
    <button type="button" role="menuitem" data-song-action="schedule">Add to Schedule</button>
    <button type="button" role="menuitem" data-song-action="show">Show Now</button>
    <div class="song-context-menu__separator" role="separator"></div>
    <div class="song-context-menu__submenu-host">
      <button type="button" class="song-context-menu__submenu-trigger" aria-haspopup="true" aria-expanded="false">Move to Folder…</button>
      <div class="song-context-menu__submenu" role="menu">${folderItems}</div>
    </div>
    <div class="song-context-menu__separator" role="separator"></div>
    <button type="button" role="menuitem" data-song-action="delete" class="song-context-menu__destructive">Delete</button>
  `;
}

function ensureSongContextMenu() {
  let menu = document.getElementById("songContextMenu");
  if (menu) return menu;

  menu = document.createElement("div");
  menu.id = "songContextMenu";
  menu.className = "song-context-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;

  menu.addEventListener("pointerdown", (event) => event.stopPropagation());
  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    const moveBtn = event.target.closest("[data-song-action='move']");
    if (moveBtn) {
      const song = menu._targetSong;
      hideSongContextMenu();
      if (!song?.id) return;
      const folderId =
        moveBtn.getAttribute("data-folder-id") === SONG_FOLDER_UNFILED
          ? null
          : moveBtn.getAttribute("data-folder-id");
      void songsAPI
        .moveToFolder(song.id, folderId)
        .then(async (updated) => {
          if (updated && currentWorkspaceSong?.id === song.id) {
            currentWorkspaceSong = updated;
          } else if (currentWorkspaceSong?.id === song.id) {
            currentWorkspaceSong.folderId = folderId;
          }
          syncSongsMoveFolderSelect(currentWorkspaceSong);
          await refreshSongFolders();
          const searchInput = document.getElementById("songsSearchInput");
          await refreshSongsBrowser(searchInput?.value || "");
          showGnomeToast("Song moved");
        })
        .catch((err) => {
          console.error("Failed to move song:", err);
          showGnomeToast("Failed to move song");
        });
      return;
    }

    const button = event.target.closest("[data-song-action]");
    if (!button) return;
    const song = menu._targetSong;
    const action = button.getAttribute("data-song-action");
    hideSongContextMenu();
    if (!song) return;
    if (action === "edit") {
      void activateSongFromLibrary(song, { openEditor: true }).catch(console.error);
    } else if (action === "schedule") {
      void scheduleSongFromLibrary(song).catch(console.error);
    } else if (action === "show") {
      void showSongFromLibraryNow(song).catch(console.error);
    } else if (action === "delete") {
      void deleteSongFromLibrary(song.id).catch(console.error);
    }
  });

  document.body.appendChild(menu);
  if (document.body.dataset.songContextMenuBound !== "1") {
    document.body.dataset.songContextMenuBound = "1";
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (event.target.closest?.("#songContextMenu")) return;
        hideSongContextMenu();
      },
      true,
    );
    window.addEventListener("resize", hideSongContextMenu);
    window.addEventListener("scroll", hideSongContextMenu, true);
  }
  return menu;
}

function showSongContextMenu(event, song) {
  event.preventDefault();
  event.stopPropagation();
  const menu = ensureSongContextMenu();
  menu.innerHTML = buildSongContextMenuMarkup();
  menu._targetSong = song;
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

async function refreshSongsBrowser(query = "", prefetchedResults = null) {
  try {
    const trimmedQuery = String(query || "").trim();
    const results = asSongArray(
      prefetchedResults ??
        (await songsAPI.search(trimmedQuery, songSearchOptionsForCurrentFolder())),
    );
    const list = document.getElementById("songsList");
    if (!list) return;

    if (!list._delegationInitialized) {
      list._delegationInitialized = true;

      list.addEventListener("click", async (event) => {
        const deleteBtn = event.target.closest(".songs-list-item__delete");
        if (deleteBtn) {
          event.stopPropagation();
          const row = deleteBtn.closest(".songs-list-item");
          if (row) {
            const songId = row.dataset.songId;
            void deleteSongFromLibrary(songId).catch(console.error);
          }
          return;
        }

        const checkbox = event.target.closest(".songs-list-item__checkbox");
        if (checkbox) {
          event.stopPropagation();
          return;
        }

        const label = event.target.closest(".songs-list-item__label");
        if (label) {
          const row = label.closest(".songs-list-item");
          if (row) {
            const songId = row.dataset.songId;
            const songTitle = row.dataset.songTitle;
            const checkboxEl = row.querySelector(".songs-list-item__checkbox");
            if (event.shiftKey || event.ctrlKey || event.metaKey) {
              if (checkboxEl) {
                checkboxEl.checked = !checkboxEl.checked;
                setSongRowSelected(row, songId, checkboxEl.checked);
              }
              return;
            }
            await activateSongFromLibrary({ id: songId, title: songTitle });
          }
        }
      });

      list.addEventListener("change", (event) => {
        const checkbox = event.target.closest(".songs-list-item__checkbox");
        if (checkbox) {
          const row = checkbox.closest(".songs-list-item");
          if (row) {
            const songId = row.dataset.songId;
            setSongRowSelected(row, songId, checkbox.checked);
          }
        }
      });

      list.addEventListener("dblclick", (event) => {
        const row = event.target.closest(".songs-list-item");
        if (row) {
          if (
            event.target.closest(
              ".songs-list-item__checkbox, .songs-list-item__delete, .songs-list-item__drag-handle",
            )
          ) {
            return;
          }
          event.preventDefault();
          const songId = row.dataset.songId;
          const songTitle = row.dataset.songTitle;
          void scheduleSongFromLibrary({ id: songId, title: songTitle }).catch(console.error);
        }
      });

      list.addEventListener("contextmenu", (event) => {
        const row = event.target.closest(".songs-list-item");
        if (row) {
          if (event.target.closest(".songs-list-item__checkbox, .songs-list-item__delete")) {
            return;
          }
          const songId = row.dataset.songId;
          const songTitle = row.dataset.songTitle;
          showSongContextMenu(event, { id: songId, title: songTitle });
        }
      });

      list.addEventListener("dragstart", (event) => {
        const row = event.target.closest(".songs-list-item");
        if (row) {
          if (event.target.closest(".songs-list-item__checkbox, .songs-list-item__delete")) {
            event.preventDefault();
            return;
          }
          const songId = row.dataset.songId;
          const songTitle = row.dataset.songTitle;
          songDragSongId = songId;
          event.dataTransfer.setData(SONG_DRAG_MIME, songId);
          event.dataTransfer.setData("text/plain", songTitle || "Song");
          event.dataTransfer.effectAllowed = "copyMove";
          row.classList.add("songs-list-item--dragging");
        }
      });

      list.addEventListener("dragend", () => {
        clearSongDragVisualState();
      });
    }

    const existingRows = Array.from(list.children);
    if (
      existingRows.length === 1 &&
      (existingRows[0].classList.contains("list-placeholder-title") ||
        existingRows[0].classList.contains("list-placeholder") ||
        existingRows[0].tagName === "SPAN")
    ) {
      list.innerHTML = "";
      existingRows.length = 0;
    }

    if (results.length === 0) {
      list.innerHTML = '<span class="list-placeholder-title">No songs found</span>';
      syncSongsBulkActions();
      return;
    }

    const numResults = results.length;
    for (let i = 0; i < numResults; i++) {
      const song = results[i];
      let row = existingRows[i];
      let dragHandle, checkbox, numberEl, label, titleSpan, subtitleSpan, deleteBtn;

      if (row && row.classList.contains("songs-list-item")) {
        dragHandle = row.querySelector(".songs-list-item__drag-handle");
        checkbox = row.querySelector(".songs-list-item__checkbox");
        numberEl = row.querySelector(".songs-list-item__number");
        label = row.querySelector(".songs-list-item__label");
        titleSpan = row.querySelector(".songs-list-item__title");
        subtitleSpan = row.querySelector(".songs-list-item__subtitle");
        deleteBtn = row.querySelector(".songs-list-item__delete");
      } else {
        row = document.createElement("div");
        row.className = "songs-list-item";
        row.draggable = true;

        dragHandle = document.createElement("span");
        dragHandle.className = "songs-list-item__drag-handle";
        dragHandle.setAttribute("aria-hidden", "true");
        dragHandle.title = "Drag to schedule or folder";
        dragHandle.textContent = "⠿";

        checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "songs-list-item__checkbox";

        numberEl = document.createElement("span");
        numberEl.className = "songs-list-item__number";

        label = document.createElement("div");
        label.className = "songs-list-item__label";

        titleSpan = document.createElement("span");
        titleSpan.className = "songs-list-item__title";
        label.appendChild(titleSpan);

        deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "songs-list-item__delete";
        deleteBtn.textContent = "✕";

        row.appendChild(dragHandle);
        row.appendChild(checkbox);
        row.appendChild(numberEl);
        row.appendChild(label);
        row.appendChild(deleteBtn);
        list.appendChild(row);
      }

      row.dataset.songId = song.id;
      row.dataset.songTitle = song.title || "";

      row.className = "songs-list-item";
      if (currentWorkspaceSong?.id === song.id) {
        row.classList.add("is-selected");
      }
      if (selectedSongIds.has(song.id)) {
        row.classList.add("is-checked");
      }

      checkbox.checked = selectedSongIds.has(song.id);
      checkbox.setAttribute("aria-label", `Select ${song.title || "song"}`);

      numberEl.textContent = formatSongListNumber(song);

      titleSpan.textContent = formatSongListLabel(song);

      const firstLyric = songListExcerpt(song);
      if (firstLyric) {
        if (!subtitleSpan) {
          subtitleSpan = document.createElement("span");
          subtitleSpan.className = "songs-list-item__subtitle";
          label.appendChild(subtitleSpan);
        }
        subtitleSpan.textContent = firstLyric;
        subtitleSpan.style.display = "";
      } else if (subtitleSpan) {
        subtitleSpan.style.display = "none";
        subtitleSpan.textContent = "";
      }

      label.title = `${formatSongListNumber(song) ? `${formatSongListNumber(song)} ` : ""}${titleSpan.textContent}`;

      deleteBtn.title = `Delete ${song.title}`;
      deleteBtn.setAttribute("aria-label", `Delete ${song.title}`);
    }

    while (list.children.length > numResults) {
      list.removeChild(list.lastChild);
    }

    syncSongsBulkActions();
  } catch (err) {
    console.error("Failed to refresh songs browser:", err);
  }
}

async function openBibleWorkspaceFromButton() {
  showBibleWorkspace();
  await bibleAPI.waitForReady();
  const versions = await loadBibleVersionMetadataFromSidecar().catch(() => []);

  const previewIndex =
    previewCueIndex >= 0 && previewCueIndex < mediaQueue.length ? previewCueIndex : -1;
  if (previewIndex >= 0 && isQueueItemBible(mediaQueue[previewIndex])) {
    await loadQueueItemIntoPreviewCue(previewIndex);
    await jumpBibleReferenceToBrowser();
    return;
  }

  const hasLoadedBibleText = Boolean(
    normalizeScriptureReference(bibleDesignerState.reference || "") || bibleDesignerState.text,
  );

  if (hasLoadedBibleText) {
    syncBibleSelectorsFromState();
    await jumpBibleReferenceToBrowser();
    return;
  }

  await restoreBibleVersionFromSettings(versions);

  const firstBibleIndex = mediaQueue.findIndex((item) => isQueueItemBible(item));
  if (firstBibleIndex >= 0) {
    await loadQueueItemIntoPreviewCue(firstBibleIndex);
    await jumpBibleReferenceToBrowser();
    return;
  }

  if (currentPreviewCue()) {
    clearPreviewCue();
  }

  Object.assign(bibleDesignerState, {
    ...bibleDesignerState,
    reference: "Genesis 1:1",
    text: "",
    book: "Genesis",
    chapter: 1,
    verse: 1,
    verseEnd: 0,
  });

  syncBibleSelectorsFromState();
  await jumpBibleReferenceToBrowser();
}

function installBibleMediaControls() {
  const versionSelect = document.getElementById("bibleVersionSelect");
  const referenceSuggestions = document.getElementById("bibleReferenceSuggestions");
  const referenceInput = document.getElementById("bibleReferenceInput");
  const referenceToggle = document.getElementById("bibleReferenceToggle");
  const searchInput = document.getElementById("bibleSearchInput");
  const searchScopeSelect = document.getElementById("bibleSearchScopeSelect");
  if (!versionSelect || versionSelect.dataset.bibleBound === "1") return;
  versionSelect.dataset.bibleBound = "1";
  installBibleWorkspaceEventGuards();
  installSongsWorkspaceEventGuards();
  installSlidesWorkspaceEventGuards();
  syncLowerThirdFeatureAvailability();
  installBiblePreviewScaleObserver();

  versionSelect.innerHTML = '<option value="KJV">KJV</option>';
  versionSelect.value = bibleDesignerState.version;
  referenceInput.value = bibleDesignerState.reference;
  syncBibleStyleControlsFromState();
  syncBibleBackgroundLabel();
  syncBibleSearchControlsFromState();
  syncBibleVersionAttributionDisplay();

  document.getElementById("openBibleWorkspaceBtn")?.addEventListener("click", () => {
    void openBibleWorkspaceFromButton().catch(console.error);
  });

  document.getElementById("openSongsWorkspaceBtn")?.addEventListener("click", () => {
    void openSongsWorkspaceFromButton().catch(console.error);
  });

  document.getElementById("openSlidesWorkspaceBtn")?.addEventListener("click", () => {
    void openSlidesWorkspaceFromButton().catch(console.error);
  });
  document.getElementById("newDeckBtn")?.addEventListener("click", () => createNewDeck());
  document.getElementById("newDeckFolderBtn")?.addEventListener("click", async () => {
    const name = (window.prompt("New deck folder name") || "").trim();
    if (!name) return;
    try {
      await slidesAPI.createFolder(name);
      await refreshSlidesFolderList();
    } catch (err) {
      console.error("Failed to create deck folder:", err);
      showGnomeToast(`Failed to create folder: ${err.message || err}`);
    }
  });
  document.getElementById("slidesSaveDeckBtn")?.addEventListener("click", () => {
    void saveCurrentDeck().catch(console.error);
  });
  document.getElementById("slidesDeleteDeckBtn")?.addEventListener("click", () => {
    void deleteCurrentDeck().catch(console.error);
  });
  document.getElementById("slidesDuplicateDeckBtn")?.addEventListener("click", () => {
    void duplicateCurrentDeck().catch(console.error);
  });
  document.getElementById("slidesShowNowBtn")?.addEventListener("click", () => {
    void showCurrentDeckNow().catch(console.error);
  });
  document.getElementById("slidesAddScheduleBtn")?.addEventListener("click", () => {
    scheduleCurrentDeck();
  });
  document.getElementById("slidesWorkspaceTitleButton")?.addEventListener("click", () => renameCurrentDeck());
  document.getElementById("slidesAddPageBtn")?.addEventListener("click", () => addDeckPage());
  document.getElementById("slidesDuplicatePageBtn")?.addEventListener("click", () => duplicateDeckPage());
  document.getElementById("slidesDeletePageBtn")?.addEventListener("click", () => deleteDeckPage());
  document.getElementById("slidesAddTextBoxBtn")?.addEventListener("click", () => addSlideTextBox());
  document.getElementById("slidesAddImageBtn")?.addEventListener("click", () => chooseSlideObjectImage());
  document.getElementById("slidesAddRectBtn")?.addEventListener("click", () => addSlideShapeObject("rect"));
  document.getElementById("slidesAddEllipseBtn")?.addEventListener("click", () => addSlideShapeObject("ellipse"));
  document.getElementById("slidesAddLineBtn")?.addEventListener("click", () => addSlideShapeObject("line"));
  document.getElementById("slidesUndoBtn")?.addEventListener("click", () => undoSlideEdit());
  document.getElementById("slidesRedoBtn")?.addEventListener("click", () => redoSlideEdit());

  const slidesSearchInput = document.getElementById("slidesSearchInput");
  const slidesSearchClear = document.getElementById("slidesSearchClearBtn");
  let slidesSearchTimer = null;
  slidesSearchInput?.addEventListener("input", () => {
    if (slidesSearchClear) slidesSearchClear.hidden = !slidesSearchInput.value;
    clearTimeout(slidesSearchTimer);
    slidesSearchTimer = setTimeout(() => {
      void refreshSlidesList(slidesSearchInput.value).catch(console.error);
    }, 150);
  });
  slidesSearchClear?.addEventListener("click", () => {
    if (slidesSearchInput) {
      slidesSearchInput.value = "";
      slidesSearchClear.hidden = true;
      void refreshSlidesList("").catch(console.error);
    }
  });

  // Deck properties
  document.getElementById("slidesDeckTitleInput")?.addEventListener("input", (e) => {
    if (!currentDeck) return;
    recordSlideUndoForMutation("Edit deck title");
    currentDeck.title = e.target.value;
    setDeckDirty(true);
    syncSlidesWorkspaceTitle();
  });
  document.getElementById("slidesDeckFolderSelect")?.addEventListener("change", (e) => {
    if (!currentDeck) return;
    recordSlideUndoForMutation("Move deck");
    currentDeck.folderId = e.target.value || null;
    setDeckDirty(true);
  });
  document.getElementById("slidesDeckFontFamily")?.addEventListener("change", (e) => {
    if (!currentDeck) return;
    recordSlideUndoForMutation("Change deck font");
    currentDeck.theme = { ...(currentDeck.theme || {}), fontFamily: e.target.value };
    const obj = activeSlideTextObject();
    if (obj) obj.style = { ...(obj.style || {}), fontFamily: e.target.value };
    setDeckDirty(true);
    renderSlideCanvas();
  });
  document.getElementById("slidesDeckFontSize")?.addEventListener("input", (e) => {
    if (!currentDeck) return;
    const n = Number(e.target.value);
    if (!Number.isFinite(n)) return;
    recordSlideUndoForMutation("Change deck font size");
    currentDeck.theme = { ...(currentDeck.theme || {}), fontSize: n };
    const obj = activeSlideTextObject();
    if (obj) obj.style = { ...(obj.style || {}), fontSize: n };
    setDeckDirty(true);
    renderSlideCanvas();
  });
  document.getElementById("slidesDeckTextColor")?.addEventListener("input", (e) => {
    if (!currentDeck) return;
    recordSlideUndoForMutation("Change deck text color");
    currentDeck.theme = { ...(currentDeck.theme || {}), textColor: e.target.value };
    const obj = activeSlideTextObject();
    if (obj) obj.style = { ...(obj.style || {}), color: e.target.value };
    setDeckDirty(true);
    renderSlideCanvas();
    renderDeckPageStrip();
  });
  document.getElementById("slidesDeckBgColor")?.addEventListener("input", (e) => {
    if (!currentDeck) return;
    recordSlideUndoForMutation("Change deck background");
    currentDeck.theme = { ...(currentDeck.theme || {}), backgroundColor: e.target.value };
    setDeckDirty(true);
    renderSlideCanvas();
    renderDeckPageStrip();
  });

  // Page properties
  document.getElementById("slidesPageLabelInput")?.addEventListener("input", (e) => {
    const page = currentPage();
    if (!page) return;
    recordSlideUndoForMutation("Edit page label");
    page.label = e.target.value;
    setDeckDirty(true);
    renderDeckPageStrip();
  });
  document.getElementById("slidesPageBackgroundColor")?.addEventListener("input", (e) => {
    const page = currentPage();
    if (!page) return;
    recordSlideUndoForMutation("Change page background");
    page.background = { type: "color", color: e.target.value };
    setDeckDirty(true);
    renderSlideCanvas();
    renderDeckPageStrip();
  });
  document.getElementById("slidesPageBackgroundInput")?.addEventListener("change", (e) => {
    const page = currentPage();
    if (!page) return;
    const file = e.target.files?.[0];
    if (!file) return;
    const filePath = typeof getPathForFile === "function" ? getPathForFile(file) : "";
    if (!filePath) {
      showGnomeToast("Could not resolve file path");
      return;
    }
    const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(filePath);
    recordSlideUndoCheckpoint("Set page background");
    page.background = { type: isVideo ? "video" : "image", path: filePath };
    setDeckDirty(true);
    renderSlideCanvas();
    renderDeckPageStrip();
    renderSlideEditorState();
    e.target.value = "";
  });
  document.getElementById("slidesPageBackgroundClearBtn")?.addEventListener("click", () => {
    const page = currentPage();
    if (!page) return;
    recordSlideUndoCheckpoint("Clear page background");
    page.background = { type: "color", color: currentDeck?.theme?.backgroundColor || "#000000" };
    setDeckDirty(true);
    renderSlideCanvas();
    renderDeckPageStrip();
    renderSlideEditorState();
  });
  document.getElementById("slidesPageNotes")?.addEventListener("input", (e) => {
    const page = currentPage();
    if (!page) return;
    recordSlideUndoForMutation("Edit page notes");
    page.notes = e.target.value;
    setDeckDirty(true);
  });
  document.getElementById("slidesPageTransitionEffect")?.addEventListener("change", () => {
    updateCurrentSlideTransitionFromControls();
  });
  document.getElementById("slidesPageTransitionDuration")?.addEventListener("input", () => {
    updateCurrentSlideTransitionFromControls();
  });

  attachSlideCanvasInteractions();
  bindSlideUndoControlTransactions();
  // Re-flow font sizes when the canvas resizes
  if (typeof ResizeObserver !== "undefined") {
    const canvasFrame = document.getElementById("slidesCanvasFrame");
    if (canvasFrame) {
      try {
        new ResizeObserver(() => {
          if (isSlidesWorkspaceVisible()) renderSlideCanvas();
        }).observe(canvasFrame);
      } catch {}
    }
  }
  
  const handleNewSong = () => {
    void openSongEditor(null).catch(console.error);
  };
  document.getElementById("newSongBtn")?.addEventListener("click", handleNewSong);
  
  // Launcher: Edit Songs opens a blank song editor
  document.getElementById("launcherEditSongsBtn")?.addEventListener("click", () => {
    const launcher = document.getElementById("songsLauncher");
    if (launcher) launcher.hidden = true;
    void openSongEditor(null).catch(console.error);
  });
  
  // Launcher: Search Songs hides the launcher and focuses the search input
  document.getElementById("launcherSearchSongsBtn")?.addEventListener("click", () => {
    const launcher = document.getElementById("songsLauncher");
    if (launcher) launcher.hidden = true;
    const searchInput = document.getElementById("songsSearchInput");
    if (searchInput) searchInput.focus();
  });
  
  document.getElementById("importSongBtn")?.addEventListener("click", () => {
    void importSongFromDialog().catch(console.error);
  });

  document.getElementById("newSongFolderBtn")?.addEventListener("click", () => {
    openSongFolderPrompt();
  });

  document.getElementById("songFolderPromptCancel")?.addEventListener("click", () => {
    closeSongFolderPrompt();
  });

  document.getElementById("songFolderPromptForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = document.getElementById("songFolderPromptInput")?.value?.trim();
    if (!name) return;
    closeSongFolderPrompt();
    void ensureSongFolder(name)
      .then(async (folderId) => {
        if (!folderId) return;
        currentSongFolderFilter = folderId;
        await refreshSongFolders();
        const searchInput = document.getElementById("songsSearchInput");
        await refreshSongsBrowser(searchInput?.value || "");
      })
      .catch((err) => {
        console.error("Failed to create song folder:", err);
        showGnomeToast(`Failed to create folder: ${err.message}`);
      });
  });

  document.getElementById("songsBulkMoveBtn")?.addEventListener("click", () => {
    void bulkMoveSelectedSongs().catch(console.error);
  });

  document.getElementById("songsBulkScheduleBtn")?.addEventListener("click", () => {
    void bulkScheduleSelectedSongs().catch(console.error);
  });

  document.getElementById("songsBulkDeleteBtn")?.addEventListener("click", () => {
    void bulkDeleteSelectedSongs().catch(console.error);
  });

  document.getElementById("songsBulkClearBtn")?.addEventListener("click", () => {
    clearSongSelection();
  });

  document.getElementById("songPrevSecBtn")?.addEventListener("click", () => {
    navigateSongSection(-1);
  });

  document.getElementById("songNextSecBtn")?.addEventListener("click", () => {
    navigateSongSection(1);
  });

  document.getElementById("songsShowNowBtn")?.addEventListener("click", () => {
    void showSongTextNow().catch(console.error);
  });

  document.getElementById("songsAddScheduleBtn")?.addEventListener("click", () => {
    void insertSongInSchedule().catch(console.error);
  });

  document.getElementById("songsSaveToLibraryBtn")?.addEventListener("click", async () => {
    if (!currentWorkspaceSong) return;
    try {
      syncCurrentWorkspaceSongDefaultRender();
      const songDeck = songDeckDocumentFromSongDocument(
        currentWorkspaceSongDeck || currentWorkspaceSong,
        currentSongRenderState,
      );
      const saved = await songsAPI.save(songDeck);
      await updateScheduleSongsWithUpdatedSong(saved || currentWorkspaceSong);
      const searchInput = document.getElementById("songsSearchInput");
      await refreshSongFolders();
      if (searchInput) await refreshSongsBrowser(searchInput.value);
      await loadSongIntoWorkspace(saved || currentWorkspaceSong, { render: currentSongRenderState });
      showGnomeToast(`Saved "${currentWorkspaceSong.title}" to library`);
    } catch (err) {
      console.error("Failed to save song to library:", err);
      showGnomeToast(`Failed to save song: ${err.message}`);
    }
  });
  
  document.getElementById("songsEditBtn")?.addEventListener("click", () => {
    void openSongEditor(currentWorkspaceSong).catch(console.error);
  });

  document.getElementById("songsMoveFolderSelect")?.addEventListener("change", (event) => {
    const songId = currentWorkspaceSong?.id;
    const value = event.target.value;
    if (!songId || !value) {
      syncSongsMoveFolderSelect(currentWorkspaceSong);
      return;
    }
    const folderId = value === SONG_FOLDER_UNFILED ? null : value;
    const currentFolderId = currentWorkspaceSong?.folderId || null;
    if (folderId === currentFolderId) return;
    void songsAPI
      .moveToFolder(songId, folderId)
      .then(async (updated) => {
        if (updated) {
          currentWorkspaceSong = updated;
        } else if (currentWorkspaceSong) {
          currentWorkspaceSong.folderId = folderId;
        }
        syncSongsMoveFolderSelect(currentWorkspaceSong);
        await refreshSongFolders();
        const searchInput = document.getElementById("songsSearchInput");
        await refreshSongsBrowser(searchInput?.value || "");
        showGnomeToast("Song moved");
      })
      .catch((err) => {
        console.error("Failed to move song:", err);
        showGnomeToast("Failed to move song");
        syncSongsMoveFolderSelect(currentWorkspaceSong);
      });
  });

  document.getElementById("songsDeleteBtn")?.addEventListener("click", () => {
    void deleteSongFromLibrary().catch(console.error);
  });
  
  document.getElementById("songEditorCancelBtn")?.addEventListener("click", () => {
    closeSongEditor();
  });

  document.getElementById("songEditorSaveBtn")?.addEventListener("click", () => {
    void saveSongEditor().catch(console.error);
  });

  document.getElementById("songEditorSaveScheduleBtn")?.addEventListener("click", () => {
    void saveSongToSchedule().catch(console.error);
  });

  // Tab Switching
  document.getElementById("songEditorTabSlidesBtn")?.addEventListener("click", () => {
    document.getElementById("songEditorTabSlidesBtn").classList.add("active");
    document.getElementById("songEditorTabPropsBtn").classList.remove("active");
    document.getElementById("songEditorTabSlides").removeAttribute("style");
    document.getElementById("songEditorTabProps").setAttribute("style", "display: none;");
  });

  document.getElementById("songEditorTabPropsBtn")?.addEventListener("click", () => {
    document.getElementById("songEditorTabPropsBtn").classList.add("active");
    document.getElementById("songEditorTabSlidesBtn").classList.remove("active");
    document.getElementById("songEditorTabProps").removeAttribute("style");
    document.getElementById("songEditorTabSlides").setAttribute("style", "display: none;");
  });

  // Slide Navigator List Events
  document.getElementById("songEditorAddSlideBtn")?.addEventListener("click", () => {
    handleSongEditorAddSection();
  });

  document.getElementById("songEditorDeleteSlideBtn")?.addEventListener("click", () => {
    handleSongEditorDeleteSection();
  });

  document.getElementById("songEditorMoveUpBtn")?.addEventListener("click", () => {
    handleSongEditorMoveSectionUp();
  });

  document.getElementById("songEditorMoveDownBtn")?.addEventListener("click", () => {
    handleSongEditorMoveSectionDown();
  });

  // Slide editor live WYSIWYG text input
  document.getElementById("songEditorSlideTextarea")?.addEventListener("input", (e) => {
    handleSongEditorCanvasTextInput(e.target);
  });

  // Meta change events (Type dropdown, Number input, Custom label input)
  document.getElementById("songEditorSectionType")?.addEventListener("change", () => {
    handleSongEditorSectionMetaChange();
  });

  document.getElementById("songEditorSectionNumber")?.addEventListener("input", () => {
    handleSongEditorSectionMetaChange();
  });

  document.getElementById("songEditorSectionCustomLabel")?.addEventListener("input", () => {
    handleSongEditorSectionMetaChange();
  });

  document.getElementById("songEditorBackgroundInput")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    currentSongRenderState.backgroundPath = file ? getPathForFile(file) : "";
    syncCurrentWorkspaceSongDefaultRender();
    syncSongBackgroundLabel();
    syncSongEditorWorkspaceStyles();
    if (currentWorkspaceSong) {
      const section =
        enabledSongSections(currentWorkspaceSong).find((s) => s.id === currentSongSectionId) ||
        currentWorkspaceSong.sections?.[0];
      if (section) {
        renderSongSectionPreview(section);
        void syncActiveScheduledSongPresentation().catch(console.error);
      }
    }
  });

  document.getElementById("songEditorClearBackgroundBtn")?.addEventListener("click", () => {
    currentSongRenderState.backgroundPath = "";
    syncCurrentWorkspaceSongDefaultRender();
    const backgroundInput = document.getElementById("songEditorBackgroundInput");
    if (backgroundInput) backgroundInput.value = "";
    syncSongBackgroundLabel("");
    syncSongEditorWorkspaceStyles();
    if (currentWorkspaceSong) {
      const section =
        enabledSongSections(currentWorkspaceSong).find((s) => s.id === currentSongSectionId) ||
        currentWorkspaceSong.sections?.[0];
      if (section) {
        renderSongSectionPreview(section);
        void syncActiveScheduledSongPresentation().catch(console.error);
      }
    }
  });

  const syncSongEditorRenderChange = (event) => {
    const controlId = event?.currentTarget?.id || "";
    const isTextStyleControl =
      controlId === "songEditorTextColor" || controlId === "songEditorFontInput";
    const scope = currentSongEditorStyleScope();

    if (isTextStyleControl) {
      const style =
        controlId === "songEditorTextColor"
          ? { color: event.currentTarget.value }
          : { fontFamily: event.currentTarget.value };
      if (scope === "allSlides") {
        currentSongRenderState = readSongEditorRenderState();
        syncCurrentWorkspaceSongDefaultRender();
      }
      applySongEditorTextStyle(style, scope);
    } else {
      currentSongRenderState = readSongEditorRenderState();
    }

    syncCurrentWorkspaceSongDefaultRender();
    syncSongEditorWorkspaceStyles();
    if (currentWorkspaceSong && document.getElementById("songEditorDrawer")?.hidden === false) {
      const section =
        enabledSongSections(currentWorkspaceSong).find((s) => s.id === currentSongSectionId) ||
        currentWorkspaceSong.sections?.[0];
      if (section) {
        renderSongSectionPreview(section);
        void syncActiveScheduledSongPresentation().catch(console.error);
      }
    }
  };
  for (const id of ["songEditorFontInput", "songEditorFontSizeInput", "songEditorAutosizeModeInput", "songEditorMinFontSizeInput", "songEditorTextColor", "songEditorBackgroundColor", "songEditorTransitionEffect", "songEditorTransitionDuration"]) {
    const input = document.getElementById(id);
    input?.addEventListener("input", syncSongEditorRenderChange);
    input?.addEventListener("change", syncSongEditorRenderChange);
  }

  initSongEditorTextBoxDragAndDrop();
  initSongEditorContextMenu();

  let editorPreviewDebounce;
  document.getElementById("songEditorTextarea")?.addEventListener("input", (e) => {
    clearTimeout(editorPreviewDebounce);
    editorPreviewDebounce = setTimeout(async () => {
      if (!currentWorkspaceSong) return;
      const text = e.target.value;
      try {
        const sections = songSectionsFromParsedSections(await songsAPI.parseLyricsText(text));
        currentWorkspaceSong.sections = sections;
        const section = sections.find((s) => s.id === currentSongSectionId) || sections[0];
        if (section) {
          renderSongSectionPreview(section);
          void syncActiveScheduledSongPresentation().catch(console.error);
        } else {
          const slide = document.getElementById("songEditorLivePreviewSlide");
          if (slide) slide.innerHTML = "";
        }
      } catch (err) {
        console.error("Live preview parse error:", err);
      }
    }, 250);
  });
  
  document.getElementById("songsSearchInput")?.addEventListener("input", (e) => {
    void refreshSongsBrowser(e.target.value).catch(console.error);
    const clearBtn = document.getElementById("songsSearchClearBtn");
    if (clearBtn) clearBtn.hidden = !e.target.value;
  });

  document.getElementById("songsSearchClearBtn")?.addEventListener("click", () => {
    const searchInput = document.getElementById("songsSearchInput");
    if (searchInput) {
      searchInput.value = "";
      searchInput.focus();
    }
    const clearBtn = document.getElementById("songsSearchClearBtn");
    if (clearBtn) clearBtn.hidden = true;
    void refreshSongsBrowser("").catch(console.error);
  });

  ["biblePreviewText", "biblePreviewReference"].forEach((id) => {
    document.getElementById(id)?.addEventListener("contextmenu", showBibleTextContextMenu);
  });
  versionSelect.addEventListener("change", () => {
    setBibleDesignerVersion(versionSelect.value, { syncControls: false });
    syncBibleVersionAttributionDisplay();
    bibleVerseSelection.verses.clear();
    bibleVerseSelection.anchor = 0;
    void refreshBibleBrowser().catch(console.error);
    if (bibleSearchState.active && bibleSearchState.scope === "current") {
      scheduleBibleSearch(0);
    }
    void refreshBibleLookupPreview().catch(console.error);
    void syncShowNowBiblePresentation().catch(console.error);
  });
  document.getElementById("bibleBrowseModeBtn")?.addEventListener("click", () => {
    setBibleNavigatorMode("browse", { runSearch: false });
    void reconcileBibleBrowseView().catch(console.error);
  });
  document.getElementById("bibleSearchModeBtn")?.addEventListener("click", () => {
    setBibleNavigatorMode("search", { focus: true });
  });
  searchInput?.addEventListener("input", () => {
    bibleSearchState.query = searchInput.value;
    setBibleNavigatorMode("search", { runSearch: false });
    scheduleBibleSearch();
  });
  searchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      bibleSearchState.query = searchInput.value;
      setBibleNavigatorMode("search", { runSearch: false });
      scheduleBibleSearch(0);
    } else if (event.key === "Escape") {
      setBibleNavigatorMode("browse", { runSearch: false });
      referenceInput?.focus();
    }
  });
  document.getElementById("bibleSearchButton")?.addEventListener("click", () => {
    bibleSearchState.query = searchInput?.value || "";
    setBibleNavigatorMode("search", { runSearch: false, focus: true });
    scheduleBibleSearch(0);
  });
  searchScopeSelect?.addEventListener("change", () => {
    bibleSearchState.scope = searchScopeSelect.value === "all" ? "all" : "current";
    syncBibleSearchControlsFromState();
    scheduleBibleSearch(0);
  });
  document.querySelectorAll(".bible-search-mode-button").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.getAttribute("data-search-mode");
      bibleSearchState.mode = ["phrase", "any"].includes(mode) ? mode : "all";
      syncBibleSearchControlsFromState();
      scheduleBibleSearch(0);
    });
  });
  referenceInput.addEventListener("input", () => {
    bibleReferenceSuggestionIndex = -1;
    void renderBibleReferenceSuggestions().catch(console.error);
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
    void renderBibleReferenceSuggestions({ showAll: true }).catch(console.error);
    referenceInput.focus();
  });
  referenceInput.addEventListener("change", () => {
    void jumpBibleReferenceToBrowser().catch(console.error);
  });
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
        void applyBibleReferenceSuggestion(
          suggestionButtons[bibleReferenceSuggestionIndex].dataset.referenceValue ||
            suggestionButtons[bibleReferenceSuggestionIndex].textContent ||
            "",
        ).catch(console.error);
        return;
      }
      void jumpBibleReferenceToBrowser().catch(console.error);
      return;
    }
    if (event.key === "Escape") {
      hideBibleReferenceSuggestions();
    }
  });
  document.getElementById("bibleLookSelect")?.addEventListener("change", () => {
    void (async () => {
      await syncBibleStateFromControls();
      resolveBibleLowerThirdState(bibleDesignerState, {
        panel: bibleLowerThirdMeasurePanel(),
      });
      await commitBibleDesignerRenderState();
    })().catch(console.error);
  });
  document.getElementById("bibleLowerThirdPrevBtn")?.addEventListener("click", () => {
    void changeBibleLowerThirdSegment(-1).catch(console.error);
  });
  document.getElementById("bibleLowerThirdNextBtn")?.addEventListener("click", () => {
    void advanceBibleLowerThirdCursor().catch((err) => {
      console.error("Failed to advance Bible lower-third cursor:", err);
      showGnomeToast("Failed to advance Bible text");
    });
  });
  document.getElementById("bibleLowerThirdAutoSplitBtn")?.addEventListener("click", () => {
    void rebuildBibleLowerThirdSegments().catch(console.error);
  });
  [
    "bibleFontInput",
    "bibleFontSizeInput",
    "bibleAutosizeModeInput",
    "bibleMinFontSizeInput",
    "bibleTextColorInput",
    "bibleBackgroundColorInput",
    "bibleLowerThirdTextColorInput",
    "bibleLowerThirdChromaKeyInput",
    "bibleTransitionEffectInput",
    "bibleTransitionDurationInput",
  ].forEach((id) => {
    const control = document.getElementById(id);
    const handleBibleStyleChange = () => {
      void (async () => {
        if (id === "bibleFontInput") bibleStyleDirtyState.fontFamily = true;
        if (id === "bibleFontSizeInput") bibleStyleDirtyState.fontSize = true;
        if (id === "bibleAutosizeModeInput") bibleStyleDirtyState.autosizeMode = true;
        if (id === "bibleMinFontSizeInput") bibleStyleDirtyState.minFontSize = true;
        if (id === "bibleTextColorInput") bibleStyleDirtyState.color = true;
        if (id === "bibleBackgroundColorInput") bibleStyleDirtyState.backgroundColor = true;
        if (id === "bibleLowerThirdTextColorInput") bibleStyleDirtyState.lowerThirdColor = true;
        if (id === "bibleLowerThirdChromaKeyInput") {
          bibleStyleDirtyState.lowerThirdChromaKeyColor = true;
        }
        await syncBibleStateFromControls();
        Object.assign(bibleDesignerState, getBibleDesignerStyle());
        if (
          id === "bibleFontInput" ||
          id === "bibleFontSizeInput" ||
          id === "bibleAutosizeModeInput" ||
          id === "bibleMinFontSizeInput"
        ) {
          delete bibleDesignerState.autosizeGroupFontSize;
          bibleDesignerState.autosizeGroupScope = "";
          resolveBibleLowerThirdState(bibleDesignerState, {
            rebuild: true,
            panel: bibleLowerThirdMeasurePanel(),
          });
        }
        applyBiblePreview(bibleDesignerState, { show: false });
        if (await syncBibleDesignerStateToPreviewedQueueItem()) {
          saveMediaFile();
        }
        syncActiveScheduledBiblePresentation();
        await syncShowNowBiblePresentation();
      })().catch(console.error);
    };
    control?.addEventListener("input", handleBibleStyleChange);
    control?.addEventListener("change", handleBibleStyleChange);
  });
  document.getElementById("bibleBackgroundInput")?.addEventListener("change", (event) => {
    void (async () => {
      const file = event.target.files?.[0];
      bibleDesignerState.backgroundPath = file ? getPathForFile(file) : "";
      bibleStyleDirtyState.backgroundPath = true;
      syncBibleBackgroundLabel();
      applyBiblePreview(bibleDesignerState);
      if (await syncBibleDesignerStateToPreviewedQueueItem()) {
        saveMediaFile();
      }
      syncActiveScheduledBiblePresentation();
      await syncShowNowBiblePresentation();
    })().catch(console.error);
  });
  document
    .getElementById("bibleApplyCurrentBtn")
    ?.addEventListener("click", () => void applyBibleStyleToCurrentText().catch(console.error));
  document
    .getElementById("bibleApplyStyleScheduleBtn")
    ?.addEventListener("click", () => void applyBibleStyleToScheduledText().catch(console.error));
  document
    .getElementById("bibleUseStyleDefaultsBtn")
    ?.addEventListener("click", () => void useBibleStyleAsDefaults().catch(console.error));
  document.getElementById("bibleClearBackgroundBtn")?.addEventListener("click", () => {
    void (async () => {
      bibleDesignerState.backgroundPath = "";
      bibleStyleDirtyState.backgroundPath = true;
      const backgroundInput = document.getElementById("bibleBackgroundInput");
      if (backgroundInput) backgroundInput.value = "";
      syncBibleBackgroundLabel("");
      applyBiblePreview(bibleDesignerState);
      if (await syncBibleDesignerStateToPreviewedQueueItem()) {
        saveMediaFile();
      }
      syncActiveScheduledBiblePresentation();
      await syncShowNowBiblePresentation();
    })().catch(console.error);
  });
  document
    .getElementById("bibleShowNowBtn")
    ?.addEventListener("click", () => void showBibleTextNow().catch(console.error));
  document
    .getElementById("bibleInsertQueueBtn")
    ?.addEventListener("click", () => void insertBibleInSchedule().catch(console.error));
  bibleAPI
    .waitForReady()
    .then(async () => {
      const versions = await loadBibleVersionMetadataFromSidecar();
      versionSelect.innerHTML = "";
      (versions.length ? versions : ["KJV"]).forEach((version) => {
        const metadata = normalizeBibleVersionMetadata(version);
        const value = metadata.abbreviation;
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        option.title = metadata.version || value;
        versionSelect.appendChild(option);
      });
      if (referenceSuggestions) {
        hideBibleReferenceSuggestions();
      }
      await restoreBibleVersionFromSettings(versions);
      syncBibleSearchControlsFromState();
      await refreshBibleBrowser();
      applyBiblePreview(bibleDesignerState, { show: false });
    })
    .catch((err) => {
      console.error("Failed to load Bible versions:", err);
      applyBiblePreview(bibleDesignerState, { show: false });
    });
}

function queueItemHasStoredFileHash(item) {
  return (
    typeof item?.fileHash === "string" &&
    typeof item?.fileHashAlg === "string" &&
    item.fileHash.length > 0
  );
}

function queueItemFingerprintSnapshotFields(item, bibleEntry) {
  if (bibleEntry) return {};
  if (typeof item.fileHash === "string" && typeof item.fileHashAlg === "string") {
    return { fileHash: item.fileHash, fileHashAlg: item.fileHashAlg };
  }
  return {};
}

function buildProjectQueueItemSnapshot(item) {
  const bibleEntry = isQueueItemBible(item)
    ? projectBibleReferenceEntryForQueueItem(item)
    : null;
  const songEntry = isQueueItemSong(item) ? item : null;
  const deckBackedEntry = songEntry?.deckSnapshot ? songEntry : null;
  const itemPath = bibleEntry
    ? bibleQueuePath(bibleEntry.reference, bibleEntry.version)
    : songEntry
      ? item.type === "deck"
        ? deckQueuePath(
            songEntry.deckSnapshot?.id || songEntry.source?.deckId || "deck",
            songEntry.render?.currentSectionId || songEntry.source?.pageId || null,
          )
        : songQueuePath(songEntry.deckSnapshot?.id || songEntry.songSnapshot?.id || parseSongQueuePath(songEntry.path) || songEntry.source?.songId || "song")
      : item.path;
  const itemName = bibleEntry
    ? projectBibleQueueName(bibleEntry)
    : songEntry
      ? songEntry.name || songEntry.songSnapshot?.title || "Song"
      : item.name;
  return {
    path: itemPath,
    name: itemName,
    type: bibleEntry ? "bible" : songEntry ? (item.type === "deck" ? "deck" : "song") : item.type,
    missing: bibleEntry || songEntry ? false : item.missing === true,
    originalPath:
      typeof item.originalPath === "string" && item.originalPath.length > 0 && !bibleEntry && !songEntry
        ? item.originalPath
        : itemPath,
    originalName:
      typeof item.originalName === "string" && item.originalName.length > 0 && !bibleEntry && !songEntry
        ? item.originalName
        : itemName || queueBasename(itemPath),
    ...queueItemFingerprintSnapshotFields(item, bibleEntry),
    sizeBytes: Number.isFinite(item.sizeBytes) && !bibleEntry && !songEntry ? item.sizeBytes : undefined,
    modifiedTime:
      typeof item.modifiedTime === "string" && !bibleEntry && !songEntry ? item.modifiedTime : undefined,
    liveSource: !bibleEntry && !songEntry ? liveSourceSnapshotFields(item.liveSource) : undefined,
    autoAdvance: item.autoAdvance !== false,
    cueStartTime: bibleEntry || songEntry ? 0 : queueItemCueStartTime(item),
    cueVolume: Number.isFinite(item.cueVolume) ? item.cueVolume : undefined,
    loop: bibleEntry || songEntry ? false : loopEnabledForQueueItem(item),
    pptxSlideIndex: Number.isFinite(item.pptxSlideIndex) && !bibleEntry && !songEntry
      ? item.pptxSlideIndex
      : undefined,
    transition: isQueueItemTransitionCapable(item)
      ? normalizeItemSlideTransitionOverride(item.transition)
      : undefined,
    bible: bibleEntry || undefined,
    source: songEntry?.source,
    songSnapshot: deckBackedEntry ? undefined : songEntry?.songSnapshot,
    deckSnapshot: songEntry?.deckSnapshot ? normalizeSlideDeck(songEntry.deckSnapshot) : undefined,
    sequence: songEntry?.sequence,
    render: songEntry?.render,
  };
}

function buildProjectStateSnapshot(opts = {}) {
  const projectGuid = normalizeProjectGuid(opts.projectGuid) || currentProjectGuid;
  const projectCreated =
    typeof opts.projectCreated === "string" && opts.projectCreated.length > 0
      ? opts.projectCreated
      : currentProjectCreated;
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectPath: currentProjectPath || "",
    projectGuid,
    projectCreated,
    project: {
      guid: projectGuid,
      name: "EMS Project",
      created: projectCreated,
    },
    projectStorageMode: currentProjectStorageMode,
    projectScriptureText: projectScriptureTextFromOverrides(projectScriptureOverrides),
    currentMode,
    currentQueueIndex,
    previewCueIndex,
    mediaQueue: mediaQueue.map(buildProjectQueueItemSnapshot),
  };
}

function restoreOperatingMode(mode) {
  const targetMode = mode === STREAMPLAYER ? STREAMPLAYER : MEDIAPLAYER;
  if (currentMode === targetMode) return;
  if (targetMode === STREAMPLAYER) {
    const radio = document.getElementById("YtPlyrRBtnFrmID");
    if (radio) radio.checked = true;
    setSBFormStreamPlayer();
  } else {
    const radio = document.getElementById("MdPlyrRBtnFrmID");
    if (radio) radio.checked = true;
    setSBFormMediaPlayer();
    installPreviewEventHandlers();
  }
}

function projectSessionIsActive() {
  return Boolean(currentProjectPath) || mediaQueue.length > 0;
}

async function syncActiveProjectPathToMain(projectPath) {
  try {
    await invoke("set-active-project-path", {
      projectPath: typeof projectPath === "string" ? projectPath : "",
      projectGuid: currentProjectGuid,
    });
  } catch (err) {
    console.error("set-active-project-path failed:", err);
  }
}

async function cleanupStagingForCurrentProjectBeforeSwitch() {
  if (!projectSessionIsActive()) return;
  try {
    await flushAutosaveOnClose();
    await invoke("cleanup-project-staging", {
      projectPath: currentProjectPath || "",
      projectGuid: currentProjectGuid,
      mediaQueue: mediaQueue.map(buildProjectQueueItemSnapshot),
    });
  } catch (err) {
    console.error("cleanup-project-staging failed:", err);
  }
}

function applyProjectStateSnapshot(state, opts = {}) {
  if (!state || typeof state !== "object") return Promise.resolve(false);
  if (!Array.isArray(state.mediaQueue)) return Promise.resolve(false);

  const applyState = async () => {
    const skipStagingCleanup = opts.skipStagingCleanup === true;
    if (!skipStagingCleanup && projectSessionIsActive()) {
      await cleanupStagingForCurrentProjectBeforeSwitch();
    }

    const nextProjectPath =
      typeof state.projectPath === "string" ? state.projectPath : currentProjectPath || "";
    currentProjectPath = nextProjectPath;
    currentProjectGuid = projectGuidFromState(state) || generateProjectGuid();
    currentProjectCreated =
      typeof state.projectCreated === "string" && state.projectCreated.length > 0
        ? state.projectCreated
        : typeof state.project?.created === "string" && state.project.created.length > 0
          ? state.project.created
          : new Date().toISOString();
    currentProjectStorageMode = state.projectStorageMode === "packed" ? "packed" : "working";
    await syncActiveProjectPathToMain(nextProjectPath);

  if (Number.isInteger(state.currentMode)) {
    restoreOperatingMode(state.currentMode);
  }
  Object.assign(
    projectScriptureOverrides,
    overridesFromProjectScriptureText(state.projectScriptureText),
  );
  bibleStyleDirtyState.fontFamily = false;
  bibleStyleDirtyState.fontSize = false;
  bibleStyleDirtyState.autosizeMode = false;
  bibleStyleDirtyState.minFontSize = false;
  bibleStyleDirtyState.autoSplit = false;
  bibleStyleDirtyState.color = false;
  bibleStyleDirtyState.backgroundColor = false;
  bibleStyleDirtyState.backgroundPath = false;
  bibleStyleDirtyState.lowerThirdColor = false;
  bibleStyleDirtyState.lowerThirdChromaKeyColor = false;
  mediaQueue = state.mediaQueue
    .map((x) => {
      if (!x || typeof x !== "object") return null;
      const rawPath = typeof x.path === "string" ? x.path : "";
      const isBibleItem =
        x.type === "bible" ||
        isBiblePath(rawPath) ||
        (x.bible && typeof x.bible === "object");
      const isSongItem =
        x.type === "song" ||
        x.type === "deck" ||
        isSongPath(rawPath) ||
        (x.songSnapshot && typeof x.songSnapshot === "object") ||
        (x.deckSnapshot && typeof x.deckSnapshot === "object");
      const bibleEntry = isBibleItem
        ? projectBibleReferenceOnlyEntry(x.bible || {}, {
            pathEntry: parseBibleQueuePath(rawPath),
          })
        : null;
      const itemPath = bibleEntry
        ? bibleQueuePath(bibleEntry.reference, bibleEntry.version)
        : isSongItem
          ? x.type === "deck"
            ? deckQueuePath(
                x.deckSnapshot?.id || x.source?.deckId || parseDeckQueuePath(rawPath)?.deckId || "deck",
                x.render?.currentSectionId || x.source?.pageId || parseDeckQueuePath(rawPath)?.pageId || null,
              )
            : songQueuePath(
                x.deckSnapshot?.id || x.songSnapshot?.id || parseSongQueuePath(rawPath) || x.source?.songId || "song",
              )
          : rawPath;
      if (!itemPath) return null;
      const itemName = bibleEntry
        ? projectBibleQueueName(bibleEntry)
        : isSongItem
          ? typeof x.name === "string" && x.name.length > 0
            ? x.name
            : x.songSnapshot?.title || "Song"
          : typeof x.name === "string" && x.name.length > 0
            ? x.name
            : queueBasename(itemPath);
      const item = {
        path: itemPath,
        name: itemName,
        type: bibleEntry ? "bible" : isSongItem ? (x.type === "deck" ? "deck" : "song") : classifyQueueMediaType(itemPath),
        missing: bibleEntry || isSongItem ? false : x.missing === true,
        originalPath:
          typeof x.originalPath === "string" && x.originalPath.length > 0 && !bibleEntry && !isSongItem
            ? x.originalPath
            : itemPath,
        originalName:
          typeof x.originalName === "string" && x.originalName.length > 0 && !bibleEntry && !isSongItem
            ? x.originalName
            : itemName || queueBasename(itemPath),
        ...queueItemFingerprintSnapshotFields(x, bibleEntry),
        sizeBytes: Number.isFinite(x.sizeBytes) && !bibleEntry && !isSongItem ? x.sizeBytes : undefined,
        modifiedTime:
          typeof x.modifiedTime === "string" && !bibleEntry && !isSongItem ? x.modifiedTime : undefined,
        liveSource: !bibleEntry && !isSongItem
          ? normalizeLiveSource(itemPath, x.liveSource, {
              type: classifyQueueMediaType(itemPath),
              originalPath:
                typeof x.originalPath === "string" && x.originalPath.length > 0
                  ? x.originalPath
                  : itemPath,
              mode: currentProjectStorageMode === "packed" ? "packaged" : undefined,
            })
          : undefined,
        autoAdvance: x.autoAdvance !== false,
        cueStartTime: bibleEntry || isSongItem ? 0 : Number.isFinite(x.cueStartTime) ? x.cueStartTime : 0,
        cueVolume: Number.isFinite(x.cueVolume) ? x.cueVolume : undefined,
        loop: bibleEntry || isSongItem ? false : x.loop === true && mediaPathSupportsLoop(itemPath),
        pptxSlideIndex: Number.isFinite(x.pptxSlideIndex) && !bibleEntry && !isSongItem ? x.pptxSlideIndex : -1,
        transition: isQueueItemTransitionCapable({
          type: bibleEntry ? "bible" : isSongItem ? "song" : classifyQueueMediaType(itemPath),
          path: itemPath,
          songSnapshot: isSongItem
            ? x.songSnapshot || (x.deckSnapshot ? deckToTransientSong(normalizeSlideDeck(x.deckSnapshot)) : undefined)
            : undefined,
        })
          ? normalizeItemSlideTransitionOverride(x.transition)
          : undefined,
        bible: bibleEntry || undefined,
        source: isSongItem && x.source ? x.source : undefined,
        songSnapshot: isSongItem && x.songSnapshot
          ? x.songSnapshot
          : isSongItem && x.deckSnapshot
            ? deckToTransientSong(normalizeSlideDeck(x.deckSnapshot))
            : undefined,
        deckSnapshot: isSongItem && x.deckSnapshot ? normalizeSlideDeck(x.deckSnapshot) : undefined,
        sequence: isSongItem && x.sequence ? x.sequence : undefined,
        render: isSongItem && x.render ? x.render : undefined,
      };
      item.cueStartTime = queueItemCueStartTime(item);
      return item;
    })
    .filter(Boolean);
  Object.assign(bibleDesignerState, resolvedBibleStyleDefaults());
  selectedQueueAnchorIndex = -1;
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
  selectedQueueAnchorIndex = queueIndexInRange(previewCueIndex)
    ? previewCueIndex
    : queueIndexInRange(currentQueueIndex)
      ? currentQueueIndex
      : -1;
  renderQueue();
  updatePreviewCueUI();
  updateDynUI();
  syncBibleStyleControlsFromState();
  const restorePreview = async () => {
    if (mediaQueue.length > 0 && currentMode === MEDIAPLAYER) {
      await pinQueueMediaSources(mediaQueue, {
        skipScheduleAutosave: true,
        repairStaging: true,
      });
      const previewIndex =
        currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
          ? currentQueueIndex
          : 0;
      try {
        await loadQueueItemIntoControlWindow(mediaQueue[previewIndex], {
          previewLoadToken: nextPreviewLoadToken(),
        });
      } catch (err) {
        console.error("Failed to load restored preview:", err);
      }
    } else {
      await pinQueueMediaSources(mediaQueue, {
        skipScheduleAutosave: true,
        repairStaging: true,
      });
    }
    scheduleMediaWatchSync();
  };
    await restorePreview();
    return true;
  };

  return applyState().catch((err) => {
    console.error("Failed to apply project state:", err);
    return false;
  });
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

/**
 * Compute and stamp baseline integrity metadata ({fileHash, sizeBytes,
 * modifiedTime}) onto queue items so the load-time preflight and future change
 * detection have something to compare against. By default only items missing a
 * baseline are stamped; pass { force: true } to re-stamp from current disk state
 * for items without unresolved Keep/Reload decisions.
 */
async function stampBaselineForQueueItems(items, opts = {}) {
  const force = opts?.force === true;
  const skipScheduleAutosave = opts?.skipScheduleAutosave === true;
  const targets = (Array.isArray(items) ? items : []).filter(
    (item) =>
      item &&
      !isQueueItemBible(item) &&
      typeof item.path === "string" &&
      item.path.length > 0 &&
      (opts.clearPendingMediaUpdate === true || !item.pendingMediaUpdate) &&
      (force ||
        !(queueItemHasStoredFileHash(item) && Number.isFinite(item.sizeBytes))),
  );
  if (targets.length === 0) return false;
  const changed = await pinQueueMediaSources(targets, {
    force: true,
    skipScheduleAutosave: true,
    clearPendingMediaUpdate: opts.clearPendingMediaUpdate === true,
  });
  if (changed) {
    renderQueue();
    if (!skipScheduleAutosave) {
      scheduleAutosaveProjectState();
    }
  }
  return changed;
}

/** Persist pending autosave on app close without re-reading baselines from disk. */
async function flushAutosaveOnClose() {
  if (autosaveWriteTimer !== null) {
    clearTimeout(autosaveWriteTimer);
    autosaveWriteTimer = null;
  }
  await invoke("save-autosave-project-state", buildProjectStateSnapshot());
}

/** Re-stamp baselines for all file items so the preflight resets after a save. */
function refreshBaselinesAfterSave() {
  const fileItems = mediaQueue.filter((item) => !isQueueItemBible(item));
  void stampBaselineForQueueItems(fileItems, { force: true });
}

function preflightWarningFingerprint(result) {
  if (!result || typeof result !== "object") return "";
  if (
    typeof result.currentFileHash === "string" &&
    result.currentFileHash.length > 0
  ) {
    return `${result.currentFileHashAlg || "xxh3-64"}:${result.currentFileHash}`;
  }
  const size = Number.isFinite(result.currentSizeBytes)
    ? String(result.currentSizeBytes)
    : "";
  const modified =
    typeof result.currentModifiedTime === "string" && result.currentModifiedTime.length > 0
      ? result.currentModifiedTime
      : Number.isFinite(result.currentMtimeMs)
        ? String(result.currentMtimeMs)
        : "";
  return size || modified ? `meta:${size}:${modified}` : "";
}

function acknowledgePreflightWarningForItem(item) {
  if (!item) return false;
  let changed = false;
  if (item.lastPreflightWarningFingerprint) {
    delete item.lastPreflightWarningFingerprint;
    changed = true;
  }
  if (item.pendingMediaUpdate) {
    delete item.pendingMediaUpdate;
    changed = true;
  }
  if (item.changedSinceSave) {
    item.changedSinceSave = false;
    changed = true;
  }
  return changed;
}

async function refreshMissingFlagsAndWarn(opts = {}) {
  const warn = opts?.warn !== false;
  if (!Array.isArray(mediaQueue) || mediaQueue.length === 0) return;
  for (const item of mediaQueue) {
    if (!isQueueItemSong(item)) continue;
    item.missing = false;
    item.changedSinceSave = false;
    if (item.pendingMediaUpdate) {
      delete item.pendingMediaUpdate;
    }
  }
  const fileItems = mediaQueue
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !isQueueItemBible(item) && !isQueueItemSong(item));
  if (fileItems.length === 0) return;
  const preflightItems = fileItems.map(({ item }) => queueItemPreflightCheckPayload(item));
  let results = [];
  try {
    results = await invoke("preflight-check-media", preflightItems);
  } catch (err) {
    console.error("preflight-check-media failed:", err);
    return;
  }
  const missingFiles = [];
  const changedItems = [];
  const unverifiableItems = [];
  let baselineStamped = false;
  fileItems.forEach(({ item, index }, i) => {
    const result = results?.[i] || {};
    const preflightItem = preflightItems[i] || {};
    const checkedPath = result.path || preflightItem.path || item.path;
    const status = result.status;
    item.missing = status === "missing";
    item.changedSinceSave = status === "changed";
    if (status === "missing") {
      missingFiles.push({
        name: item.originalName || item.name || item.path,
        path: checkedPath,
      });
    } else if (status === "changed") {
      const warningFingerprint = preflightWarningFingerprint(result);
      const liveSource = queueItemLiveSource(item);
      const canKeepOld = queueItemCanKeepOldMediaVersion(item);
      item.pendingMediaUpdate = {
        mtimeMs: result.currentMtimeMs,
        sizeBytes: result.currentSizeBytes,
        fileHash: result.currentFileHash,
        fileHashAlg: result.currentFileHashAlg,
        detectedAt: Date.now(),
        status: "ready",
        sourcePath: checkedPath,
        warningFingerprint,
        canKeepOld,
      };
      if (item.lastPreflightWarningFingerprint) {
        delete item.lastPreflightWarningFingerprint;
        baselineStamped = true;
      }
      changedItems.push({
        index,
        name: item.name || item.path,
        path: checkedPath,
        queuePath: item.path,
        savedModifiedTime: preflightItem.modifiedTime || item.modifiedTime,
        currentModifiedTime: result.currentModifiedTime,
        confirmedByHash: result.confirmedByHash === true,
        warningFingerprint,
        canKeepOld,
        stagingTier: liveSource?.stagingTier,
        reason: liveSource?.reason,
      });
    } else if (status === "unverifiable") {
      // First sighting with no stored baseline. Adopt the current state as the
      // baseline so future changes are detectable. This does not assert the
      // file is unchanged from any prior version.
      if (Number.isFinite(result.currentSizeBytes)) {
        item.sizeBytes = result.currentSizeBytes;
        baselineStamped = true;
      }
      if (typeof result.currentModifiedTime === "string") {
        item.modifiedTime = result.currentModifiedTime;
      }
      unverifiableItems.push(item);
    } else if (status === "ok" && typeof result.currentModifiedTime === "string") {
      // Hash-confirmed identical despite mtime drift: adopt the new mtime so we
      // skip re-hashing next time.
      item.modifiedTime = result.currentModifiedTime;
      if (item.lastPreflightWarningFingerprint) {
        delete item.lastPreflightWarningFingerprint;
        baselineStamped = true;
      }
      if (item.pendingMediaUpdate) {
        delete item.pendingMediaUpdate;
        baselineStamped = true;
      }
      if (item.changedSinceSave) {
        item.changedSinceSave = false;
        baselineStamped = true;
      }
    }
  });
  renderQueue();
  if (unverifiableItems.length > 0) {
    // Fill in full baselines (including hash) in the background.
    void stampBaselineForQueueItems(unverifiableItems, { force: true });
  } else if (baselineStamped) {
    scheduleAutosaveProjectState();
  }
  if (warn && (missingFiles.length > 0 || changedItems.length > 0)) {
    try {
      const actionMode =
        changedItems.length > 0
          ? changedItems.some((changedItem) => changedItem.canKeepOld)
            ? "choice"
            : "reload-only"
          : "ok";
      const action = await invoke("show-preflight-summary-dialog", {
        changedItems,
        missingItems: missingFiles,
        actionMode,
      });
      for (const changedItem of changedItems) {
        const index = queueIndexInRange(changedItem.index)
          ? changedItem.index
          : findQueueIndexByPath(changedItem.queuePath || changedItem.path);
        if (!queueIndexInRange(index)) continue;
        if (action === "reload" || !changedItem.canKeepOld) {
          await approvePendingMediaUpdate(index);
          continue;
        }
        // Keep Old from the launch dialog keeps the staged old file active, but
        // leaves the queue-row Reload/Keep controls visible for an explicit choice.
      }
    } catch (err) {
      console.error("Failed to show preflight dialog:", err);
    }
  }
}

async function fallbackUnavailableBibleTranslationsOnLoad() {
  const bibleItems = mediaQueue.filter((item) => isQueueItemBible(item));
  if (bibleItems.length === 0) return false;

  let availableVersions = new Set();
  let versionLookupFailed = false;
  try {
    await bibleAPI.waitForReady();
    const versions = await loadBibleVersionMetadataFromSidecar();
    availableVersions = new Set(
      versions.map((version) => normalizedProjectBibleVersion(version.abbreviation)),
    );
  } catch (err) {
    versionLookupFailed = true;
    console.error("Failed to check installed Bible translations:", err);
  }

  const unavailableVersions = new Set();
  let changed = false;
  bibleItems.forEach((item) => {
    const entry = projectBibleReferenceEntryForQueueItem(item);
    if (!entry.reference) return;
    const version = normalizedProjectBibleVersion(entry.version);
    const hasInstalledVersion =
      !versionLookupFailed && availableVersions.size > 0 && availableVersions.has(version);
    if (hasInstalledVersion) {
      item.path = bibleQueuePath(entry.reference, version);
      item.name = projectBibleQueueName(entry);
      item.type = "bible";
      item.missing = false;
      item.bible = projectBibleReferenceOnlyEntry({ ...entry, version });
      return;
    }

    unavailableVersions.add(version);
    const fallbackEntry = projectBibleReferenceOnlyEntry({
      ...entry,
      version: "KJV",
    });
    item.path = bibleQueuePath(fallbackEntry.reference, fallbackEntry.version);
    item.name = projectBibleQueueName(fallbackEntry);
    item.type = "bible";
    item.missing = false;
    item.bible = fallbackEntry;
    changed = true;
  });

  const shouldWarn = versionLookupFailed || unavailableVersions.size > 0;
  if (changed) {
    renderQueue();
    updatePreviewCueUI();
    updateDynUI();
    scheduleAutosaveProjectState();
    if (currentMode === MEDIAPLAYER && mediaQueue.length > 0) {
      const previewIndex =
        currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
          ? currentQueueIndex
          : previewCueIndex >= 0 && previewCueIndex < mediaQueue.length
            ? previewCueIndex
            : 0;
      void loadQueueItemIntoControlWindow(mediaQueue[previewIndex], {
        previewLoadToken: nextPreviewLoadToken(),
      }).catch((err) => console.error(err));
    }
  }
  if (shouldWarn) {
    showGnomeToast("Some Bible translations are not available. Falling back to KJV.", 5000);
  }
  return shouldWarn;
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
        fileHash: item.fileHash,
        fileHashAlg: item.fileHashAlg,
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
      item.originalPath = match.path;
      item.originalName = queueBasename(match.path);
      delete item.liveSource;
      if (Number.isFinite(match.sizeBytes)) item.sizeBytes = match.sizeBytes;
      if (typeof match.fileHash === "string") item.fileHash = match.fileHash;
      if (typeof match.fileHashAlg === "string") item.fileHashAlg = match.fileHashAlg;
      if (typeof match.modifiedTime === "string") {
        item.modifiedTime = match.modifiedTime;
      }
      if (!item.name || item.name === queueBasename(item.originalPath || "")) {
        item.name = queueBasename(match.path);
      }
    }

    if (matches.length > 0) {
      await pinQueueMediaSources(matches.map((match) => mediaQueue[match.index]), {
        force: true,
        skipScheduleAutosave: true,
        clearPendingMediaUpdate: true,
      });
      renderQueue();
      const reloadIndexes = new Set(
        matches
          .map((match) => match.index)
          .filter((index) => index >= 0 && index < mediaQueue.length),
      );
      if (reloadIndexes.has(previewCueIndex)) {
        await loadQueueItemIntoPreviewCue(previewCueIndex);
      } else if (reloadIndexes.has(currentQueueIndex)) {
        await loadQueueItemIntoControlWindow(mediaQueue[currentQueueIndex], {
          previewLoadToken: nextPreviewLoadToken(),
        });
      }
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
  if (!(await applyProjectStateSnapshot({ ...parsed, projectPath: filePath }))) {
    throw new Error("Project does not contain a valid queue.");
  }
  const bibleTranslationWarningShown = await fallbackUnavailableBibleTranslationsOnLoad();
  await refreshMissingFlagsAndWarn();
  scheduleAutosaveProjectState();
  if (!bibleTranslationWarningShown) {
    showGnomeToast("Project opened");
  }
  return true;
}

async function saveProjectAsDialog() {
  const previousProjectPath = currentProjectPath;
  const previousProjectStorageMode = currentProjectStorageMode;
  const previousProjectGuid = currentProjectGuid;
  const previousProjectCreated = currentProjectCreated;
  try {
    const defaultPath = currentProjectPath || "Untitled.emproj";
    const res = await invoke("show-save-project-dialog", { defaultPath });
    if (!res || res.canceled || !res.filePath) return false;
    if (previousProjectPath) {
      resetCurrentProjectIdentity();
    }
    currentProjectPath = res.filePath;
    currentProjectStorageMode = "working";
    await syncCurrentPptxSlideForProjectSnapshot();
    const data = JSON.stringify(buildProjectStateSnapshot(), null, 2);
    const result = await invoke("write-project-file", {
      filePath: currentProjectPath,
      data,
      mode: "working",
      activateProject: true,
    });
    currentProjectGuid = normalizeProjectGuid(result?.projectGuid) || currentProjectGuid;
    if (typeof result?.projectCreated === "string" && result.projectCreated.length > 0) {
      currentProjectCreated = result.projectCreated;
    }
    scheduleAutosaveProjectState();
    refreshBaselinesAfterSave();
    showGnomeToast("Project saved");
    return true;
  } catch (err) {
    currentProjectPath = previousProjectPath;
    currentProjectStorageMode = previousProjectStorageMode;
    currentProjectGuid = previousProjectGuid;
    currentProjectCreated = previousProjectCreated;
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
    const data = JSON.stringify(
      buildProjectStateSnapshot({
        projectGuid: generateProjectGuid(),
        projectCreated: new Date().toISOString(),
      }),
      null,
      2,
    );
    await invoke("write-project-file", {
      filePath: res.filePath,
      data,
      mode: "packed",
      activateProject: false,
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
    if (await applyProjectStateSnapshot(state, { skipStagingCleanup: true })) {
      await fallbackUnavailableBibleTranslationsOnLoad();
      await refreshMissingFlagsAndWarn();
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
  selectedQueueAnchorIndex = -1;
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
      transition: normalizeItemSlideTransitionOverride(x.transition),
      bible: x.bible ? { ...x.bible } : undefined,
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
      transition: normalizeItemSlideTransitionOverride(x.transition),
      bible: x.bible ? { ...x.bible } : undefined,
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
  selectedQueueAnchorIndex = queueIndexInRange(previewCueIndex)
    ? previewCueIndex
    : queueIndexInRange(currentQueueIndex)
      ? currentQueueIndex
      : -1;
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
  if (selectedQueueAnchorIndex === index) {
    selectedQueueAnchorIndex =
      mediaQueue.length > 0 ? Math.min(index, mediaQueue.length - 1) : -1;
  } else if (selectedQueueAnchorIndex > index) {
    selectedQueueAnchorIndex--;
  } else if (selectedQueueAnchorIndex >= mediaQueue.length) {
    selectedQueueAnchorIndex = -1;
  }
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
  const queueRowActionSelector =
    "[data-queue-remove], [data-queue-reload-update], [data-queue-keep-update], [data-queue-apply-update]";
  list.addEventListener("click", (e) => {
    const autoBtn = e.target.closest("[data-queue-auto]");
    if (autoBtn && list.contains(autoBtn)) {
      e.preventDefault();
      toggleQueueItemAutoAdvance(
        Number.parseInt(autoBtn.getAttribute("data-queue-auto"), 10),
      );
      return;
    }
    const keepUpdateBtn = e.target.closest("[data-queue-keep-update]");
    if (keepUpdateBtn && list.contains(keepUpdateBtn)) {
      e.preventDefault();
      keepPendingMediaUpdate(
        Number.parseInt(keepUpdateBtn.getAttribute("data-queue-keep-update"), 10),
      );
      return;
    }
    const reloadUpdateBtn = e.target.closest(
      "[data-queue-reload-update], [data-queue-apply-update]",
    );
    if (reloadUpdateBtn && list.contains(reloadUpdateBtn)) {
      e.preventDefault();
      const rawIndex =
        reloadUpdateBtn.getAttribute("data-queue-reload-update") ??
        reloadUpdateBtn.getAttribute("data-queue-apply-update");
      void approvePendingMediaUpdate(Number.parseInt(rawIndex, 10));
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
    setSelectedQueueAnchor(idx);
    updateQueueSelectionVisual();
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
    if (e.target.closest(queueRowActionSelector)) {
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
    setSelectedQueueAnchor(idx);
    updateQueueSelectionVisual();
    void switchQueueItemLiveWithConfirmation(idx).catch((err) => console.error(err));
  });

  list.addEventListener("dragstart", (e) => {
    const row = e.target.closest(".queue-item[data-queue-index]");
    if (!row || !list.contains(row)) return;
    if (e.target.closest(queueRowActionSelector)) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    const idx = Number.parseInt(row.getAttribute("data-queue-index"), 10);
    if (Number.isNaN(idx)) return;
    setSelectedQueueAnchor(idx);
    updateQueueSelectionVisual();
    queueDragFromIndex = idx;
    e.dataTransfer.setData("application/x-queue-index", String(idx));
    e.dataTransfer.setData("text/plain", String(idx));
    e.dataTransfer.effectAllowed = "move";
    if (row) row.classList.add("queue-item-dragging");
  });

  list.addEventListener("dragend", (e) => {
    queueDragFromIndex = -1;
    hideQueueDropIndicator();
    list.querySelectorAll(".queue-item-dragging").forEach((el) => {
      el.classList.remove("queue-item-dragging");
    });
    list.querySelectorAll(".queue-item-drag-over").forEach((el) => {
      el.classList.remove("queue-item-drag-over");
    });
  });

  list.addEventListener("dragover", (e) => {
    const hasInternalQueueDrag = queueDragFromIndex >= 0;
    const hasSongDrag = Boolean(songDragSongId);
    if (hasSongDrag && !hasInternalQueueDrag) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      list.querySelectorAll(".queue-item-drag-over").forEach((el) => {
        el.classList.remove("queue-item-drag-over");
      });
      updateQueueDropIndicator(list, queueDropInsertIndexFromEvent(list, e));
      return;
    }
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
    if (songDragSongId && e.target === list) {
      hideQueueDropIndicator();
    }
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
    const droppedSongId = songDragSongId;
    if (droppedSongId && !hasInternalQueueDrag) {
      e.preventDefault();
      e.stopPropagation();
      hideQueueDropIndicator();
      clearSongDragVisualState();
      const insertIndex = queueDropInsertIndexFromEvent(list, e);
      try {
        const song = await songsAPI.get(droppedSongId);
        const entry = buildSongQueueEntryFromDeck({
          deck: song,
          render: renderStateForLibrarySong(song),
        });
        if (!entry) return;
        invalidateQueueUndoToastAfterMutation();
        insertQueueEntriesAt([entry], insertIndex);
        renderQueue();
        saveMediaFile();
        showGnomeToast(`Scheduled ${entry.name}`);
      } catch (err) {
        console.error("Failed to schedule dropped song:", err);
        showGnomeToast("Failed to schedule song");
      }
      return;
    }
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
const GLOBAL_SLIDE_TRANSITION_STORAGE_KEY = "ems.slideTransition.global";

function readSlideTransitionControls(effectId, durationId, { allowInherit = false } = {}) {
  const effectEl = document.getElementById(effectId);
  const durationEl = document.getElementById(durationId);
  if (allowInherit && !effectEl) {
    return { ...DEFAULT_ITEM_SLIDE_TRANSITION };
  }
  const transition = slideTransitionForPlayback(
    {
      effect: effectEl?.value || (allowInherit ? SLIDE_TRANSITION_INHERIT : SLIDE_TRANSITION_NONE),
      durationMs: durationEl?.value,
    },
    DEFAULT_SLIDE_TRANSITION,
  );
  if (allowInherit && effectEl?.value === SLIDE_TRANSITION_INHERIT) {
    return {
      effect: SLIDE_TRANSITION_INHERIT,
      durationMs: transition.durationMs,
    };
  }
  return transition;
}

function syncSlideTransitionControls(effectId, durationId, transition, { allowInherit = false } = {}) {
  const effectEl = document.getElementById(effectId);
  const durationEl = document.getElementById(durationId);
  if (!effectEl && !durationEl) return;
  const normalized =
    allowInherit && !normalizeItemSlideTransitionOverride(transition)
      ? DEFAULT_ITEM_SLIDE_TRANSITION
      : slideTransitionForPlayback(transition, DEFAULT_SLIDE_TRANSITION);
  if (effectEl) {
    effectEl.value =
      allowInherit && normalized.effect === SLIDE_TRANSITION_INHERIT
        ? SLIDE_TRANSITION_INHERIT
        : normalized.effect || SLIDE_TRANSITION_NONE;
  }
  if (durationEl) {
    durationEl.value = String(
      Number.isFinite(normalized.durationMs)
        ? normalized.durationMs
        : DEFAULT_SLIDE_TRANSITION_DURATION_MS,
    );
  }
}

function loadGlobalSlideTransitionState() {
  try {
    const raw = window.localStorage?.getItem(GLOBAL_SLIDE_TRANSITION_STORAGE_KEY);
    if (raw) {
      globalSlideTransitionState = slideTransitionForPlayback(
        JSON.parse(raw),
        DEFAULT_SLIDE_TRANSITION,
      );
    }
  } catch {
    globalSlideTransitionState = { ...DEFAULT_SLIDE_TRANSITION };
  }
}

function persistGlobalSlideTransitionState() {
  try {
    window.localStorage?.setItem(
      GLOBAL_SLIDE_TRANSITION_STORAGE_KEY,
      JSON.stringify(globalSlideTransitionState),
    );
  } catch {
    /* UI-only preference; ignore storage failures. */
  }
}

function syncGlobalSlideTransitionControls() {
  syncSlideTransitionControls(
    "globalSlideTransitionEffect",
    "globalSlideTransitionDuration",
    globalSlideTransitionState,
  );
}

function installGlobalSlideTransitionControls() {
  const effectEl = document.getElementById("globalSlideTransitionEffect");
  const durationEl = document.getElementById("globalSlideTransitionDuration");
  if (!effectEl || !durationEl || effectEl.dataset.slideTransitionBound === "1") return;
  effectEl.dataset.slideTransitionBound = "1";
  loadGlobalSlideTransitionState();
  syncGlobalSlideTransitionControls();
  const handleChange = () => {
    globalSlideTransitionState = readSlideTransitionControls(
      "globalSlideTransitionEffect",
      "globalSlideTransitionDuration",
    );
    persistGlobalSlideTransitionState();
  };
  effectEl.addEventListener("change", handleChange);
  durationEl.addEventListener("input", handleChange);
  durationEl.addEventListener("change", handleChange);
}

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
  const token = nextPreviewLoadToken();
  if (!isQueueItemBible(item)) {
    hideBibleWorkspace();
  }
  if (!isQueueItemSong(item) || isQueueItemDeck(item)) {
    hideSongsWorkspace();
  }
  if (!isQueueItemDeck(item)) {
    hideSlidesWorkspace();
  }
  if (isQueueItemPptx(item)) {
    const liveSlide = await getLivePptxSlideFromMediaWindow(item.path);
    if (!isCurrentPreviewLoad(token)) return;
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
    if (!isCurrentPreviewLoad(token)) return;
    syncMediaLoopState({ notify: false });
    updatePreviewCueUI();
    renderQueue();
    syncPlayPauseIconToControlMedia();
    return;
  } else if (isQueueItemBible(item)) {
    const liveBibleEntry = await resolvedBibleEntryForItem(item);
    if (!isCurrentPreviewLoad(token)) return;
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
    const loaded = await loadBibleEntryIntoEditor(liveBibleEntry, {
      previewLoadToken: token,
    });
    if (!loaded || !isCurrentPreviewLoad(token)) return;
    showBibleWorkspace();
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
    syncMediaLoopState({ notify: false });
    updatePreviewCueUI();
    renderQueue();
    return;
  } else if (isQueueItemDeck(item)) {
    if (!isCurrentPreviewLoad(token)) return;
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

    const loaded = await loadDeckQueueItemIntoWorkspace(item, token);
    if (!loaded || !isCurrentPreviewLoad(token)) return;
    showSlidesWorkspace();
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
    syncMediaLoopState({ notify: false });
    updatePreviewCueUI();
    renderQueue();
    return;
  } else if (isQueueItemSong(item)) {
    if (!isCurrentPreviewLoad(token)) return;
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
    
    await loadSongItemIntoWorkspace(item, token);
    
    if (!isCurrentPreviewLoad(token)) return;
    showSongsWorkspace();
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
    syncMediaLoopState({ notify: false });
    updatePreviewCueUI();
    renderQueue();
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
    const cueBibleEntry = await resolvedBibleEntryForItem(cue.item);
    if (cue.item) cue.item.bible = { ...cueBibleEntry };
    await loadBibleEntryIntoEditor(cueBibleEntry);
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
      cueEl.poster = await stagedMediaUrlForItem(cue.item);
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

async function loadAudioQueueItemIntoPreviewCue(index, item, startTime, loadToken) {
  if (!isBiblePresentationActive()) {
    restoreNonPptxPreviewSurface();
  }
  const token = Number.isFinite(loadToken) ? loadToken : nextPreviewLoadToken();
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
  const audioUrl = await stagedMediaUrlForItem(item);
  if (!isCurrentPreviewLoad(token) || previewCueIndex !== index) return;
  audio.src = audioUrl;

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
    currentTimeDisplay && paintTransportTimeDisplay(currentTimeDisplay, actualStart);
    durationTimeDisplay && paintTransportTimeDisplay(durationTimeDisplay, duration);
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
  setSelectedQueueAnchor(index);
  if (queueIndexIsCurrentLivePresentation(index)) {
    await restorePreviewToLiveOutput(index);
    return;
  }

  const token = nextPreviewLoadToken();
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
  const songsWorkspaceVisible =
    document.getElementById("songsWorkspace")?.hidden === false;
  if (songsWorkspaceVisible && (!isQueueItemSong(item) || isQueueItemDeck(item))) {
    hideSongsWorkspace();
  }
  const slidesWorkspaceVisible =
    document.getElementById("slidesWorkspace")?.hidden === false;
  if (slidesWorkspaceVisible && !isQueueItemDeck(item)) {
    hideSlidesWorkspace();
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
    if (!isCurrentPreviewLoad(token) || previewCueIndex !== index) return;
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
    const cueBibleEntry = await resolvedBibleEntryForItem(item);
    if (!isCurrentPreviewLoad(token) || previewCueIndex !== index) return;
    item.bible = { ...cueBibleEntry };
    const loaded = await loadBibleEntryIntoEditor(cueBibleEntry, {
      previewLoadToken: token,
    });
    if (!loaded || !isCurrentPreviewLoad(token) || previewCueIndex !== index) return;
    showBibleWorkspace();
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
  } else if (isQueueItemDeck(item)) {
    hidePptxPreviewIfNeeded();
    stopPreviewAudioCue();
    clearVideoPreviewCueOverlay();
    setMediaCountdownOverlayVisible(false);
    setMediaCountdownText("");

    const loaded = await loadDeckQueueItemIntoWorkspace(item, token);
    if (!loaded || !isCurrentPreviewLoad(token) || previewCueIndex !== index) return;
    showSlidesWorkspace();
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
  } else if (isQueueItemSong(item)) {
    hidePptxPreviewIfNeeded();
    stopPreviewAudioCue();
    clearVideoPreviewCueOverlay();
    setMediaCountdownOverlayVisible(false);
    setMediaCountdownText("");
    
    await loadSongItemIntoWorkspace(item, token);
    
    if (!isCurrentPreviewLoad(token) || previewCueIndex !== index) return;
    showSongsWorkspace();
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
      const posterUrl = await stagedMediaUrlForItem(item);
      if (!isCurrentPreviewLoad(token) || previewCueIndex !== index) return;
      cueEl.poster = posterUrl;
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
    await loadAudioQueueItemIntoPreviewCue(index, item, cueStart, token);
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
    await loadVideoQueueItemIntoPreviewCueOverlay(index, item, cueStart, token);
    if (!isCurrentPreviewLoad(token) || previewCueIndex !== index) return;
    syncPreviewAudioTrackState();
  }
  if (!isCurrentPreviewLoad(token) || previewCueIndex !== index) return;
  syncMediaLoopState({ notify: false });
  updatePreviewCueUI();
  renderQueue();
}

async function takeQueueItemLive(index, startTime = 0) {
  if (index < 0 || index >= mediaQueue.length) return;
  if (pendingQueueSwitchIndex !== null) return;
  if (!(await ensurePendingMediaUpdateApproved(index))) return;
  setSelectedQueueAnchor(index);

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
  await switchQueueItemLiveWithConfirmation(
    cue.index,
    presentationStartTimeForQueueItem(cue.index, cue.startTime),
  );
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

  // Scripture-to-scripture and song-to-song changes update in place without confirmation.
  if (isQueueItemBible(liveItem) && isQueueItemBible(targetItem)) {
    return false;
  }
  if (isQueueItemSong(liveItem) && isQueueItemSong(targetItem)) {
    return false;
  }

  return true;
}

async function switchQueueItemLiveWithConfirmation(index, startTime = 0) {
  if (index < 0 || index >= mediaQueue.length) return;
  const item = mediaQueue[index];
  if (!(await ensurePendingMediaUpdateApproved(index))) return;
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
  setSelectedQueueAnchor(index);

  // Audio-only items play locally without a media window, but they're still
  // an active presentation: prompt before swapping them out.
  const isLocalPresentation = isLocalAppWindowPresentationActive();

  if (!isActiveMediaWindow() && !isLocalPresentation) {
    const activateIndex = index;
    const item = mediaQueue[activateIndex];
    if (!isQueueItemBible(item)) hideBibleWorkspace();
    if (!isQueueItemSong(item) || isQueueItemDeck(item)) hideSongsWorkspace();
    if (!isQueueItemDeck(item)) hideSlidesWorkspace();
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
  clearSongShowNowPresentation();
  mediaPlaybackEndedPending = false;
  pendingQueueSwitchIndex = null;
  pendingQueueSwitchStartTime = 0;
  manualBoundaryPauseIndex = -1;
  isQueuePlaying = false;
  isPlaying = false;
  updateDynUI();
  isActiveMediaWindowCache = false;
  activeResolvedMediaFile = "";
  activePreviewResolvedMediaFile = "";
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
  await restoreStagedPreviewPlayback(isImgFile);

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
  } else if (queueIndexInRange(currentQueueIndex)) {
    // End of queue: don't wrap or jump back to the top. Keep the last played
    // item highlighted (matching EasyWorship/ProPresenter) instead of
    // deselecting. currentQueueIndex already points at the finished item, so
    // leave it in place and keep it as the selected row.
    selectedQueueAnchorIndex = currentQueueIndex;
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

function mediaPathMatchesCurrentLiveMedia(filePath) {
  if (!filePath) return false;
  const normalized = normalizeMediaPathForCompare(filePath);
  return (
    normalized === normalizeMediaPathForCompare(mediaFile) ||
    normalized === normalizeMediaPathForCompare(activeResolvedMediaFile)
  );
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
    const bibleEntry = await resolvedBibleEntryForItem(item);
    item.bible = { ...bibleEntry };
    await loadBibleEntryIntoEditor(bibleEntry);
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
    return;
  }
  if (isQueueItemDeck(item)) {
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
    const loaded = await loadDeckQueueItemIntoWorkspace(item, loadToken);
    if (loaded) showSlidesWorkspace();
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
    return;
  }
  if (isQueueItemSong(item)) {
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
    await loadSongItemIntoWorkspace(item, loadToken);
    showSongsWorkspace();
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
    return;
  }
  hideBiblePreview();
  hideSongsWorkspace();
  hideSlidesWorkspace();
  const resolvedItemPath = await resolveQueueItemMediaPath(item);
  activePreviewResolvedMediaFile = resolvedItemPath;
  const cacheBust = queueItemMediaCacheBust(item);
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
  handleMediaPlayback(isImgFile, resolvedItemPath, cacheBust);
  handleImageDisplay(isImgFile, document.querySelector("img#preview"), resolvedItemPath, cacheBust);

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
  if (queueItemNeedsPendingUpdateApproval(item)) {
    showGnomeToast("Reload the changed media file before taking it live");
    isQueuePlaying = false;
    isPlaying = false;
    renderQueue();
    updateDynUI();
    return;
  }

  await loadQueueItemIntoControlWindow(item, opts);
  renderQueue();

  isPlaying = true;
  updateDynUI();

  if (isQueueItemBible(item)) {
    const entry = await resolvedBibleEntryForItem(item);
    const lowerThirdStarted = hasLowerThirdOutputSelected()
      ? await ensureBibleLowerThirdOutput(entry)
      : await closeBibleLowerThirdOutput();
    const audienceStarted = hasAudienceOutputSelected()
      ? await createMediaWindow({ textItem: item })
      : false;
    if (!audienceStarted && !lowerThirdStarted) {
      showGnomeToast("Choose an output display");
      isPlaying = false;
      isQueuePlaying = false;
      updateDynUI();
      renderQueue();
    }
    return;
  }

  if (isQueueItemSong(item)) {
    const audienceStarted = hasAudienceOutputSelected()
      ? await createMediaWindow({ textItem: item, songItem: true })
      : false;
    if (!audienceStarted) {
      showGnomeToast("Choose an audience output display");
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

  const projectionVideo = resolveQueuePresentationVideo();
  await createMediaWindow({
    startTime: validMediaStartTime(projectionVideo?.currentTime),
  });
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
    // No more auto-advanceable items: stop at the boundary. An in-range index
    // pauses on that item; otherwise (end of queue) keep the last item
    // highlighted instead of wrapping back to the top.
    await pauseQueuePresentationAtBoundary(
      nextIndex < mediaQueue.length ? nextIndex : -1,
    );
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
  const allowSongInPlaceSwitch =
    Boolean(nextItem) &&
    isQueueItemSong(nextItem) &&
    activeMediaWindowContentType === "song" &&
    isActiveMediaWindow();
  if (!isQueuePlaying && !allowBibleInPlaceSwitch && !allowSongInPlaceSwitch) return false;
  if (!isActiveMediaWindow()) return false;
  if (index < 0 || index >= mediaQueue.length) return false;
  // Live streams are not slipstreamed. Fall back to the normal close/reopen
  // cycle whether we're leaving a stream or switching into one.
  if (activeLiveStream || isLiveStream(mediaFile) || isLiveStream(nextItem.path)) {
    return false;
  }
  if (queueItemNeedsPendingUpdateApproval(nextItem)) {
    showGnomeToast("Reload the changed media file before taking it live");
    return false;
  }

  queueSlipstreamTransitionInProgress = true;
  let startupSyncStarted = false;
  try {
    const nextItem = mediaQueue[index];
    const nextType = nextItem.type || classifyQueueMediaType(nextItem.path);
    const isImgFile = isImg(nextItem.path);
    const isPptxFile = isQueueItemPptx(nextItem);
    const isBibleItem = isQueueItemBible(nextItem);
    const isSongItem = isQueueItemSong(nextItem);
    const resolvedNextPath = isBibleItem || isSongItem
      ? nextItem.path
      : await resolveQueueItemMediaPath(nextItem);

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
    if (!isImgFile && !isPptxFile && !isBibleItem && !isSongItem && (nextType === "audio" || audioOnlyFile)) {
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
          textPayload: {
            ...buildBibleTextMessage(await resolvedBibleEntryForItem(nextItem), {
              look: SCRIPTURE_LOOK_FULLSCREEN,
            }),
            transition: slideTransitionPayloadForQueueItem(nextItem),
          },
          transition: slideTransitionPayloadForQueueItem(nextItem),
        }
      : isSongItem
        ? {
            isText: true,
            mediaFile: nextItem.path,
            textPayload: {
              ...(resolvedSongPresentation(nextItem)?.message || {}),
              transition: slideTransitionPayloadForQueueItem(nextItem),
            },
            transition: slideTransitionPayloadForQueueItem(nextItem),
          }
        : {
          mediaFile: resolvedNextPath,
          isImg: isImgFile,
          isPptx: isPptxFile,
          pptxStartSlide: isPptxFile ? pptxStartSlideForItem(nextItem) : 0,
          transition: isPptxFile ? slideTransitionPayloadForQueueItem(nextItem) : undefined,
          loopFile: loopEnabledForQueueItem(nextItem),
          startVolume: video ? video.volume : 1,
          startTime: requestedStart,
        };

    if (!isBibleItem && !isSongItem && !isImgFile && !isPptxFile) {
      beginProjectionPlaybackStartupSync();
      startupSyncStarted = true;
    }

    const slipstreamSuccess = await invoke("slipstream-media-window", slipstreamData);
    resolveQueuePresentationVideo();
    if (!slipstreamSuccess) {
      if (startupSyncStarted) finishProjectionPlaybackStartupSync();
      return false;
    }
    activeResolvedMediaFile = resolvedNextPath;
    activePreviewResolvedMediaFile = resolvedNextPath;

    // Window stays alive — advance queue state without the normal close/reopen cycle.
    mediaPlaybackEndedPending = false;
    currentQueueIndex = index;
    isQueuePlaying = true;
    bibleShowNowModeActive = false;
    clearSongShowNowPresentation();
    activeMediaWindowContentType = classifyPresentationType(nextItem);
    isActiveMediaWindowCache = true;
    isPlaying = true;
    resetCountdownSync();
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
      const entry = await resolvedBibleEntryForItem(nextItem);
      await sendBibleTextToOutput(entry);
      if (hasLowerThirdOutputSelected()) {
        await ensureBibleLowerThirdOutput(entry);
      } else {
        await closeBibleLowerThirdOutput();
      }
    } else if (isSongItem) {
      await sendSongTextToOutput(nextItem);
    }
    renderQueue();
    if (opts.clearCue !== false) {
      clearCueAfterTake(index);
    }

    // Mirror the media window: start the local preview so the operator sees
    // what's projecting. In the non-slipstream path createMediaWindow's
    // "media-window autoplay" call does this; we must do it ourselves here.
    if (video && !isImgFile && !isPptxFile) {
      await playLivePreviewMirrorSafely("slipstream preview play");
    }

    return true;
  } catch (err) {
    if (startupSyncStarted) finishProjectionPlaybackStartupSync();
    throw err;
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

function isActiveMediaWindow() {
  return isActiveMediaWindowCache;
}

function remoteCountdownOwnsLiveMedia() {
  return Boolean(
    currentMode === MEDIAPLAYER &&
      isActiveMediaWindow() &&
      activeMediaWindowContentType === "video" &&
      timeRemaining?.isPortReady?.(),
  );
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
    if (durationTimeDisplay) paintTransportTimeDisplay(durationTimeDisplay, d);
    if (currentTimeDisplay) paintTransportTimeDisplay(currentTimeDisplay, c);
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
  const sourcePath = previewMediaSourcePath();
  const previewUrl = pathToMediaUrl(sourcePath);
  if (previewUrl && previewUrl !== video.src) {
    video.src = previewUrl;
    video
      .play()
      .catch((e) =>
        console.error("Error playing media after mode change fixup:", e),
      );
  }
}

function preModeChangeFixups() {
  const sourcePath = previewMediaSourcePath();
  const previewUrl = pathToMediaUrl(sourcePath);
  if (
    !isActiveMediaWindow() &&
    previewUrl &&
    previewUrl !== video.src &&
    !(playingMediaAudioOnly || video.paused)
  ) {
    video.src = previewUrl;
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
  disableNativeVideoControls(video);

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

  bindTransportTimeDisplay(currentTimeDisplay);
  bindTransportTimeDisplay(durationTimeDisplay);

  const isTransportControlsPaintVisible = () => {
    if (currentMode !== MEDIAPLAYER) {
      return false;
    }
    if (!overlay || overlay.style.display === "none") {
      return false;
    }
    if (overlay.style.visibility === "hidden") {
      return false;
    }
    if (isDragging) {
      return true;
    }
    return Boolean(videoWrapper?.matches(":hover"));
  };

  const paintTransportControlsTime = (displayEl, seconds) => {
    if (!displayEl) return;
    paintTransportTimeDisplay(displayEl, seconds);
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

    const hasSeekableMedia = isFinite(mediaEl.duration) && mediaEl.duration > 0;
    const currentTime = Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : 0;

    timeline.value =
      hasSeekableMedia ? (currentTime / mediaEl.duration) * 100 : 0;
    if (isTransportControlsPaintVisible()) {
      paintTransportControlsTime(currentTimeDisplay, currentTime);
      paintTransportControlsTime(durationTimeDisplay, mediaEl.duration);
    }

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
    if (!isTransportControlsPaintVisible()) {
      return;
    }
    paintTransportControlsTime(currentTimeDisplay, mediaEl.currentTime);

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
        const mediaEl = currentControlMedia();
        if (mediaEl && Number.isFinite(mediaEl.duration) && mediaEl.duration > 0) {
          updateControlsForMetadata(mediaEl);
          updateControlsForTime(mediaEl);
        }
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
      if (isPreviewWorkspaceOverlayVisible()) return;
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
        if (previewMediaControlsLiveProjection(mediaEl)) {
          masterPauseState = false;
          await unPauseMedia({ target: mediaEl });
          await playLivePreviewMirrorSafely("custom controls toggle");
        } else {
          await playVideoSafely(mediaEl, "custom controls toggle");
        }
      } else {
        if (previewMediaControlsLiveProjection(mediaEl)) {
          masterPauseState = true;
          await pauseMedia({ target: mediaEl });
        }
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

      currentTimeDisplay && paintTransportTimeDisplay(currentTimeDisplay, seekTime);
      void seekMedia(mediaEl, seekTime).then((actualTime) => {
        if (seekToken !== timelineSeekToken) return;
        currentTimeDisplay && paintTransportTimeDisplay(currentTimeDisplay, actualTime);
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
        paintTransportControlsTime(currentTimeDisplay, 0);
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
      paintTransportTimeDisplay(currentTimeDisplay, 0);
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
      paintTransportTimeDisplay(currentTimeDisplay, 0);
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
        paintTransportControlsTime(currentTimeDisplay, 0);
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
        if (isPreviewWorkspaceOverlayVisible()) {
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
            if (previewMediaControlsLiveProjection(mediaEl)) {
              masterPauseState = false;
              void unPauseMedia({ target: mediaEl });
              void playLivePreviewMirrorSafely("preview click toggle");
            } else {
              void playVideoSafely(mediaEl, "preview click toggle");
            }
          } else {
            if (previewMediaControlsLiveProjection(mediaEl)) {
              masterPauseState = true;
              void pauseMedia({ target: mediaEl });
            }
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

async function handlePlaybackState(event, playbackState) {
  if (!video) {
    return;
  }
  if (
    activeMediaWindowContentType === "bible" ||
    activeMediaWindowContentType === "song" ||
    isBiblePath(mediaFile) ||
    isSongPath(mediaFile)
  ) {
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
  // While the projection is swapping/starting a source it marks playback-state
  // updates as stabilizing; those pause/play events are browser churn, not user
  // intent, so the live preview waits for the first stable state.
  if (playbackState.syncPhase === "stabilizing") {
    beginProjectionPlaybackStartupSync();
    return;
  }
  if (playbackState.playing) {
    const syncGeneration = ++playbackStateSyncGeneration;
    desiredProjectionPreviewPlayback = "playing";
    finishProjectionPlaybackStartupSync();
    masterPauseState = false;
    if (video.paused && !isImg(mediaFile)) {
      await playLivePreviewMirrorSafely("playback state sync");
      await reconcileStalePlaybackSync(syncGeneration);
    }
    return;
  }
  if (!playbackState.playing) {
    if (playbackState.pauseIntent !== "explicit") {
      finishProjectionPlaybackStartupSync();
      return;
    }
    ++playbackStateSyncGeneration;
    desiredProjectionPreviewPlayback = "paused";
    latestExplicitProjectionPauseState = playbackState;
    finishProjectionPlaybackStartupSync();
    masterPauseState = true;
    if (video.paused) {
      return;
    }
    await pauseLivePreviewMirrorFromProjection(playbackState);
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
  timeRemaining?.onTick?.(handleTimeMessage);
  on("update-playback-state", handlePlaybackState);
  on("remoteplaypause", handlePlayPause);
  on("media-window-closed", handleMediaWindowClosed);
  on("media-window-closed", () => {
    resetBiblePreviewMediaWindowSize();
    syncBiblePreviewOutputScale();
  });
  on("lower-third-window-closed", () => {
    bibleLowerThirdOutputActive = false;
  });
  on("media-source-stabilizing", (_event, payload) => {
    markQueueItemMediaUpdate({ ...payload, status: "stabilizing" });
  });
  on("media-source-changed", (_event, payload) => {
    markQueueItemMediaUpdate(payload);
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
      !mediaPathMatchesCurrentLiveMedia(endedMediaFile) &&
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
  finishProjectionPlaybackStartupSync();
  restoreLivePreviewMirrorMuteState(localVideo);
  stopStreamRendererPreviewCapture();
  activeMediaWindowContentType = null;
  activeResolvedMediaFile = "";
  activePreviewResolvedMediaFile = "";
  bibleShowNowModeActive = false;
  clearSongShowNowPresentation();

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
      const entry = await resolvedBibleEntryForItem(mediaQueue[idx]);
      const lowerThirdStarted = hasLowerThirdOutputSelected()
        ? await ensureBibleLowerThirdOutput(entry)
        : await closeBibleLowerThirdOutput();
      const audienceStarted = hasAudienceOutputSelected()
        ? await createMediaWindow({ textItem: mediaQueue[idx] })
        : false;
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
  await restoreStagedPreviewPlayback(isImgFile);

  resetVideoState();

  updatePlayButtonOnMediaWindow();
  masterPauseState = false;
  saveMediaFile();
  removeFilenameFromTitlebar();
  setMediaCountdownText("");
  syncPreviewMediaAfterPresentationStateChange();
}
function handleMediaPlayback(isImgFile, sourcePath = mediaFile, cacheBust) {
  if (!video) return;
  if (isNonVideoPresentationItem(mediaFile)) return;
  if (!isImgFile) {
    video.src = pathToMediaUrl(sourcePath, cacheBust);
  }
}

function getMediaCountdownElement() {
  if (mediaCountdownElement?.isConnected) {
    return mediaCountdownElement;
  }
  mediaCountdownElement = document.getElementById("mediaCntDn");
  return mediaCountdownElement;
}

function ensureMediaCountdownDigitNodes() {
  const parent = getMediaCountdownElement();
  if (!parent) return false;
  if (countdownDigitParent === parent) return true;
  for (let i = 0; i < MEDIA_COUNTDOWN_DIGIT_COUNT; i++) {
    let node = countdownDigitNodes[i];
    if (!node) {
      node = document.createTextNode("");
      countdownDigitNodes[i] = node;
    }
    if (node.parentNode !== parent) {
      parent.appendChild(node);
    }
  }
  countdownDigitParent = parent;
  return true;
}

function clearMediaCountdownDigits() {
  for (let i = 0; i < MEDIA_COUNTDOWN_DIGIT_COUNT; i++) {
    const node = countdownDigitNodes[i];
    if (!node) continue;
    if (countdownDigitLastCode[i] !== -1) {
      node.data = "";
      countdownDigitLastCode[i] = -1;
    }
  }
  countdownHasDisplayedDigits = false;
}

/**
 * Paint HH:MM:SS.mmm into fixed per-digit text nodes using pre-cached
 * single-character strings — avoids String.fromCharCode on every RAF/IPC tick.
 */
function setMediaCountdownFromCodes(codes) {
  if (!codes || codes.length < MEDIA_COUNTDOWN_DIGIT_COUNT) {
    clearMediaCountdownDigits();
    syncMediaCountdownOverlayState();
    return;
  }
  if (!ensureMediaCountdownDigitNodes()) {
    return;
  }
  let hasText = false;
  for (let i = 0; i < MEDIA_COUNTDOWN_DIGIT_COUNT; i++) {
    const code = codes[i];
    if (countdownDigitLastCode[i] === code) {
      if (MEDIA_COUNTDOWN_CHAR_BY_CODE[code]) {
        hasText = true;
      }
      continue;
    }
    countdownDigitLastCode[i] = code;
    const cached = MEDIA_COUNTDOWN_CHAR_BY_CODE[code] ?? "";
    countdownDigitNodes[i].data = cached;
    if (cached) {
      hasText = true;
    }
  }
  countdownHasDisplayedDigits = hasText;
  syncMediaCountdownOverlayState();
}

function setMediaCountdownOverlayVisible(isVisible) {
  const countdownEl = getMediaCountdownElement();
  if (!countdownEl) return;
  const wasAllowed = countdownEl.dataset.countdownAllowed === "true";
  countdownEl.dataset.countdownAllowed = isVisible ? "true" : "false";
  if (!isVisible || !wasAllowed) {
    clearMediaCountdownDigits();
  }
  syncMediaCountdownOverlayState();
}

function setMediaCountdownText(value) {
  if (value === "") {
    clearMediaCountdownDigits();
    syncMediaCountdownOverlayState();
  }
}

function syncMediaCountdownOverlayState() {
  const countdownEl = getMediaCountdownElement();
  if (!countdownEl) return;
  const hasText = countdownHasDisplayedDigits;
  const isAllowed = countdownEl.dataset.countdownAllowed === "true";
  const isActive = isAllowed && hasText;
  countdownEl.hidden = !isActive;
  countdownEl.classList.toggle("is-active", isActive);
}

function handleImageDisplay(isImgFile, imgEle, sourcePath = mediaFile, cacheBust) {
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
    liveImg.src = pathToMediaUrl(sourcePath, cacheBust);
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

async function runPresentationStart(startOperation) {
  if (presentationStartInProgress) return undefined;
  presentationStartInProgress = true;
  updateDynUI();
  try {
    return await startOperation();
  } finally {
    presentationStartInProgress = false;
    updateDynUI();
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

function previewMediaControlsLiveProjection(mediaEl) {
  return Boolean(
    mediaEl && mediaEl === video && isActiveMediaWindow() && !playingMediaAudioOnly,
  );
}

async function pauseMedia(e) {
  if (activeLiveStream) {
    await send("play-ctl", "pause");
    return;
  }
  if (
    !previewMediaControlsLiveProjection(video) &&
    (video.src === "" || video.readyState === 0)
  ) {
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
  if (
    !previewMediaControlsLiveProjection(video) &&
    (video.src === "" || video.readyState === 0)
  ) {
    return;
  }

  if (
    !playingMediaAudioOnly &&
    e !== null &&
    e !== undefined &&
    e.target?.isConnected === true
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
  if (presentationStartInProgress) return;

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
    const item = mediaQueue[startIdx];
    if (!isLiveStream(item.path)) {
      return runPresentationStart(async () => {
        const presentStartTime = presentationStartTimeForQueueItem(startIdx, startTime);
        isQueuePlaying = true;
        currentQueueIndex = startIdx;
        await playCurrentQueueItem({
          preservePreviewSeek: false,
          startTime: presentStartTime,
        });
        if (previewCueIndex === startIdx) clearCueAfterTake(startIdx);
      });
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
    return runPresentationStart(async () => {
      invalidateQueueUndoToastAfterMutation();
      mediaQueue = [createQueueEntry(mediaFile)];
      currentQueueIndex = 0;
      renderQueue();
      if (video !== null && !isImg(mediaFile)) {
        video.pause();
      }
      saveMediaFile();
      isQueuePlaying = true;
      await playCurrentQueueItem({
        preservePreviewSeek: false,
        startTime: validMediaStartTime(startTime),
      });
    });
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
    return runPresentationStart(async () => {
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
    });
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
    playButton.disabled = presentationStartInProgress;
    playButton.setAttribute(
      "aria-busy",
      presentationStartInProgress ? "true" : "false",
    );
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
        void syncShowNowBiblePresentation().catch(console.error);
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
    disableNativeVideoControls(stashedVideo);
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
        disableNativeVideoControls(placeholder);
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
    disableNativeVideoControls(v);
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
  if (source === undefined || source === null || isBiblePath(source) || isSongPath(source)) {
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
  disableNativeVideoControls(el);
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

  ensureMediaCountdownDigitNodes();
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
  installGlobalSlideTransitionControls();
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
  disableNativeVideoControls(video);
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
              void playLivePreviewMirrorSafely("restore active media preview");
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
    const previewItem = currentQueuePreviewItem();
    if (queueItemOwnsControlPreview(previewItem)) {
      void syncQueuePreviewMediaElements(previewItem);
      setupCustomMediaControls();
      setupGtkVolumeControl();
      void restorePptxPreviewForMediaTab().catch((err) =>
        console.error("Failed to restore PPTX preview after returning to Media tab:", err),
      );
      return;
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
    const previewItem = currentQueuePreviewItem();
    if (queueItemOwnsControlPreview(previewItem)) {
      void syncQueuePreviewMediaElements(previewItem);
      void restorePptxPreviewForMediaTab().catch((err) =>
        console.error("Failed to restore PPTX preview after returning to Media tab:", err),
      );
      return;
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
  scheduleMediaWatchSync();
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
    const previewItem = currentQueuePreviewItem();
    if (queueItemOwnsControlPreview(previewItem)) {
      void syncQueuePreviewMediaElements(previewItem).then(() => {
        showPreviewWarningToast();
      });
      return;
    }
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
        const previewItem = currentQueuePreviewItem();
        if (queueItemOwnsControlPreview(previewItem)) {
          void syncQueuePreviewMediaElements(previewItem);
          return;
        }
        let uncachedLoad;
        if (
          (uncachedLoad =
            normalizeMediaPathForCompare(mediaFile) !==
            normalizeMediaPathForCompare(video.src))
        ) {
          video.setAttribute("src", pathToMediaUrl(mediaFile));
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
        disableNativeVideoControls(video);
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
  if (mcd) {
    for (const node of countdownDigitNodes) {
      if (node && mcd.contains(node)) {
        mcd.removeChild(node);
      }
    }
  }
  mediaCountdownElement = null;
  countdownDigitParent = null;

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
    isPreviewWorkspaceOverlayVisible() &&
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
      on("app-close-autosave-requested", () => {
        void flushAutosaveOnClose()
          .catch((err) => console.error("Close autosave failed:", err))
          .finally(() => {
            send("app-close-autosave-complete");
          });
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
  if (
    mediaFile === undefined ||
    mediaFile === null ||
    isBiblePath(mediaFile) ||
    isSongPath(mediaFile)
  ) {
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
  const queueItem =
    currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
      ? mediaQueue[currentQueueIndex]
      : null;
  let source = mediaFile || removeFileProtocol(decodeURI(localVideo.src || ""));
  if (queueItem && isFileBackedMediaPath(queueItem.path)) {
    source = await resolveQueueItemMediaPath(queueItem);
    activePreviewResolvedMediaFile = source;
  }

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
  const audioUrl = pathToMediaUrl(source, queueItemMediaCacheBust(queueItem));
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
  const hasExplicitStartTime =
    typeof options?.startTime === "number" &&
    Number.isFinite(options.startTime) &&
    options.startTime >= 0;
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
  let projectionMediaFile = mediaFile;
  if (!textItem && isQueuePlaybackContext) {
    const queueItem = mediaQueue[currentQueueIndex];
    if (!isQueueItemBible(queueItem) && !isQueueItemSong(queueItem)) {
      projectionMediaFile = await resolveQueueItemMediaPath(queueItem);
    }
  }
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

  const isTextItem = Boolean(
    textItem ||
      (isQueuePlaybackContext &&
        (isQueueItemBible(mediaQueue[currentQueueIndex]) ||
          isQueueItemSong(mediaQueue[currentQueueIndex]))),
  );
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

  if (liveStreamMode === false) {
    startTime = hasExplicitStartTime
      ? validMediaStartTime(options.startTime)
      : validMediaStartTime(video?.currentTime);
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
        "__mediafile-ems=" + encodeURIComponent(projectionMediaFile),
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

  const startupSyncNeeded =
    autoPlayEnabled && !liveStreamMode && !isTextItem && !isImgFile && !isPptxFile;
  isActiveMediaWindowCache = true;
  activeResolvedMediaFile = projectionMediaFile;
  activePreviewResolvedMediaFile = projectionMediaFile;
  if (startupSyncNeeded) {
    beginProjectionPlaybackStartupSync();
  }
  try {
    const windowId = await invoke("create-media-window", windowOptions, selectedIndex);
    if (!windowId) {
      isActiveMediaWindowCache = false;
      if (startupSyncNeeded) finishProjectionPlaybackStartupSync();
      return false;
    }
    queueBiblePreviewMediaWindowSizeRefresh();
  } catch (err) {
    isActiveMediaWindowCache = false;
    activeMediaWindowContentType = null;
    if (startupSyncNeeded) finishProjectionPlaybackStartupSync();
    throw err;
  }
  activeMediaWindowContentType = isTextItem
    ? options?.songItem || isQueueItemSong(textItem) || isQueueItemSong(mediaQueue[currentQueueIndex])
      ? "song"
      : "bible"
    : isPptxFile
      ? "pptx"
      : isImgFile
      ? "image"
      : "video";
  bibleShowNowModeActive = Boolean(isTextItem && transientText && activeMediaWindowContentType === "bible");
  if (isTextItem && transientText && activeMediaWindowContentType === "song") {
    markSongShowNowPresentation(textItem || mediaQueue[currentQueueIndex]);
  } else {
    clearSongShowNowPresentation();
  }
  if (isTextItem) {
    window.setTimeout(() => {
      void (async () => {
        const queueItem = textItem || mediaQueue[currentQueueIndex];
        if (isQueueItemSong(queueItem)) {
          await sendSongTextToOutput(queueItem);
        } else {
          const entry = await resolvedBibleEntryForItem(queueItem);
          await sendBibleTextToOutput(entry);
        }
      })().catch(console.error);
    }, 150);
    syncStreamRendererPreviewCapture();
    return true;
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
        await playLivePreviewMirrorSafely("media-window autoplay");
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
  return true;
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
