/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/*
 * Bible workspace: browser, verse selection, scripture editor, lower thirds,
 * and scripture scheduling helpers. Cross-feature playback still lives in the
 * renderer entry point.
 */

import {
  DEFAULT_ITEM_SLIDE_TRANSITION,
  SCRIPTURE_ABSOLUTE_MIN_BODY_FONT_SIZE,
  SCRIPTURE_AUTOSIZE_FIT,
  SCRIPTURE_AUTOSIZE_NORMALIZE,
  SCRIPTURE_BODY_FONT_SIZE,
  SCRIPTURE_DEFAULT_AUTOSIZE_MODE,
  SCRIPTURE_DEFAULT_LOOK,
  SCRIPTURE_FOLLOW_MODE,
  SCRIPTURE_FONT_FAMILY,
  SCRIPTURE_FONT_WEIGHT,
  SCRIPTURE_HEADING_FONT_SIZE,
  SCRIPTURE_LABEL_FONT_SIZE,
  SCRIPTURE_LINE_HEIGHT,
  SCRIPTURE_LOOK_FULLSCREEN,
  SCRIPTURE_LOOK_LOWER_THIRD,
  SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND,
  SCRIPTURE_LOWER_THIRD_CHROMA_KEY_COLOR,
  SCRIPTURE_LOWER_THIRD_DEFAULT_FONT_SIZE,
  SCRIPTURE_LOWER_THIRD_TEXT_COLOR,
  SCRIPTURE_MIN_BODY_FONT_SIZE,
  SCRIPTURE_REFERENCE_FONT_SIZE,
  MEDIAPLAYER,
  __dirname,
  activeLowerThirdContentType,
  activeMediaWindowContentType,
  appliedPresentationTheme,
  applyOperatorSelectionContrast,
  applyScriptureRenderToPreview,
  audienceTextMessageForSend,
  bibleAPI,
  bibleLowerThirdLiveCueKey,
  bibleLowerThirdOutputActive,
  bibleQueuePath,
  bibleReferenceSuggestionIndex,
  bibleShowNowModeActive,
  bibleStyleSnapshot,
  bibleUiEnabled,
  bibleUriPrefix,
  bibleVersionValue,
  clampLowerThirdSegmentIndex,
  clearPreviewCue,
  clearSongShowNowPresentation,
  clearTextFromPresentationMessage,
  createMediaWindow,
  createScripturePresentationMachine,
  currentBibleBackgroundVideoSync,
  currentLivePresentationLabel,
  currentLiveQueueItem,
  currentLiveQueueItemForSwitchPrompt,
  currentMode,
  currentPreviewCue,
  currentQueueIndex,
  dataTransferHasType,
  enrichLowerThirdPresentationMessage,
  escapeHtml,
  generateProjectGuid,
  getBibleDesignerStyle,
  hasAudienceOutputSelected,
  hasLiveAudienceTextPresentation,
  hasLiveLowerThirdText,
  hasLowerThirdOutputSelected,
  hideQueueDropIndicator,
  hideScheduleSongContextMenu,
  imageRegex,
  insertQueueEntriesAfterSelection,
  invalidateQueueUndoToastAfterMutation,
  invoke,
  isActiveMediaWindow,
  isActiveMediaWindowCache,
  isBibleLowerThirdFeatureEnabled,
  isBiblePath,
  isCurrentPreviewLoad,
  isLocalAppWindowPresentationActive,
  isPlaying,
  isQueueItemBible,
  isQueuePlaying,
  isQueuePresentationActive,
  lastAudienceBibleTextMessage,
  lastLowerThirdBibleTextMessage,
  liveTextClearActive,
  loadQueueItemIntoControlWindow,
  loadQueueItemIntoPreviewCue,
  lowerThirdKeyOnlyMessage,
  lowerThirdOutputUpdateToken,
  lowerThirdPreferenceChromaKeyColor,
  markAudiencePreviewTextSelection,
  measureBibleEntryAutofit,
  mediaFile,
  mediaPlaybackEndedPending,
  mediaQueue,
  mergedBibleShowNowStyle,
  nextLowerThirdOutputUpdateToken,
  nextPreviewLoadToken,
  normalizeBiblePreviewOutputSize,
  normalizeItemSlideTransitionOverride,
  normalizeItemTheme,
  normalizeLowerThirdSegments,
  normalizeScriptureAutosizeMode,
  normalizeScriptureFontSize,
  normalizeScriptureLook,
  normalizeScriptureMinFontSize,
  normalizeScriptureReference,
  normalizedBibleVersions,
  openThemeManagerForQueueItem,
  parseScriptureReference,
  pathToMediaUrl,
  pendingQueueSwitchIndex,
  pendingQueueSwitchStartTime,
  populateDisplaySelect,
  previewCueIndex,
  previewLoadToken,
  showRendererConfirm,
  queueBasename,
  queueBiblePreviewMediaWindowSizeRefresh,
  queueIndexInRange,
  readSlideTransitionControls,
  refreshBiblePreviewMediaWindowSize,
  renderLowerThirdPreview,
  renderQueue,
  renderScriptureForTarget,
  renderSongLowerThirdControls,
  resolveScriptureSlideForCursor,
  resolveThemeForTarget,
  resolvedThemeForItem,
  saveCurrentProjectInStorageMode,
  saveMediaFile,
  scheduleAutosaveProjectState,
  scriptureCursorForSlide,
  scriptureReferencePresentationForBackground,
  selectedBiblePreviewOutputSize,
  selectedDisplayValueFromSelect,
  send,
  sendAudienceTextMessage,
  setLastShownBibleStyleOverrides,
  setSelectedQueueAnchor,
  shiftQueueIndexesForInsertion,
  setSharedRendererState,
  shouldApplyLiveTextClearState,
  showBibleWorkspace,
  showGnomeToast,
  slideTransitionPayloadForQueueItem,
  songLowerThirdState,
  stopLowerThirdRendererPreviewCapture,
  switchQueueItemLiveWithConfirmation,
  syncBiblePreviewOutputScale,
  syncConfidenceMonitorCarousel,
  syncLowerThirdFeatureAvailability,
  syncLowerThirdRendererPreviewCapture,
  syncSlideTransitionControls,
  themeLowerThirdMessageIfApplied,
  themedAudienceMessage,
  themedLowerThirdMessage,
  updateClearLiveTextButtonState,
  updateDynUI,
  updatePreviewCueUI,
  userStopPresentationPending,
  verseNumbersFromSelector,
  verseSelectorFromReference,
  waitForScriptureFonts,
  waitForTextFonts,
} from "./app-renderer.mjs";

let bibleLowerThirdPreviewSourceKey = "";

let biblePreviewRenderToken = 0;

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
  fontFamilyOverride: false,
  fontSize: SCRIPTURE_BODY_FONT_SIZE,
  autosizeMode: SCRIPTURE_DEFAULT_AUTOSIZE_MODE,
  minFontSize: SCRIPTURE_MIN_BODY_FONT_SIZE,
  autoSplit: true,
  color: "#ffffff",
  backgroundColor: "#000000",
  backgroundPath: "",
  lowerThirdColor: SCRIPTURE_LOWER_THIRD_TEXT_COLOR,
  lowerThirdChromaKeyColor: SCRIPTURE_LOWER_THIRD_CHROMA_KEY_COLOR,
  lowerThirdFontFamily: "",
  lowerThirdFontFamilyOverride: false,
  lowerThirdFontSize: SCRIPTURE_LOWER_THIRD_DEFAULT_FONT_SIZE,
  lowerThirdBarBackgroundColor: SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND,
  lowerThirdBarBackgroundPath: "",
  look: SCRIPTURE_DEFAULT_LOOK,
  lowerThirdSegmentIndex: 0,
  currentLowerThirdSlideId: null,
  transition: DEFAULT_ITEM_SLIDE_TRANSITION,
};

const scripturePresentation = createScripturePresentationMachine();

function ensureScriptureScheduleItemId(item) {
  if (!item || typeof item !== "object") return "";
  if (typeof item.presentationId === "string" && item.presentationId.trim()) {
    return item.presentationId;
  }
  item.presentationId = `scripture-${generateProjectGuid()}`;
  return item.presentationId;
}

function scripturePresentationSource(entry, { item = null, scheduleIndex = -1 } = {}) {
  if (item) {
    return {
      id: `schedule:${ensureScriptureScheduleItemId(item)}`,
      origin: "schedule",
      scheduleIndex,
    };
  }
  const version = String(entry?.version || "KJV").trim();
  const reference = normalizeScriptureReference(entry?.reference || "");
  return {
    id: `show-now:${version}:${reference}`,
    origin: "show-now",
  };
}

function scriptureCursorFromPresentation(presentation) {
  const slides = presentation?.slides || [];
  const active = presentation?.activeSlide ||
    slides.find((slide) => slide.slideId === presentation?.navigation?.activeSlideId) ||
    slides[0] ||
    null;
  return scriptureCursorForSlide(active, slides);
}

function beginScriptureTake(entry, options = {}) {
  const audienceMessage = buildBibleTextMessage(entry, { look: SCRIPTURE_LOOK_FULLSCREEN });
  const lowerThirdMessage = buildBibleTextMessage(entry, { look: SCRIPTURE_LOOK_LOWER_THIRD });
  const cursor = scriptureCursorFromPresentation(audienceMessage.resolvedPresentation);
  const lowerThirdSlide = resolveScriptureSlideForCursor(
    lowerThirdMessage.resolvedPresentation?.slides || [],
    cursor,
  );
  const state = scripturePresentation.dispatch({
    type: "TAKE_REQUESTED",
    source: scripturePresentationSource(entry, options),
    cursor,
    outputs: {
      audience: options.audience === true,
      lowerThird: options.lowerThird === true,
    },
  });
  if (cursor) {
    scripturePresentation.dispatch({
      type: "CURSOR_CHANGED",
      sourceId: state.source.id,
      cursor,
      lowerThirdSlideId: lowerThirdSlide?.slideId || null,
    });
  }
  return scripturePresentation.state.revision;
}

function confirmScriptureTake(revision, outputs) {
  const state = scripturePresentation.dispatch({
    type: "TAKE_CONFIRMED",
    revision,
    outputs,
  });
  if (state.status !== "live" || state.source?.origin !== "schedule") return;
  const scheduleIndex = mediaQueue.findIndex(
    (item) =>
      isQueueItemBible(item) &&
      `schedule:${ensureScriptureScheduleItemId(item)}` === state.source.id,
  );
  if (scheduleIndex >= 0 && currentQueueIndex !== scheduleIndex) {
    setSharedRendererState({ currentQueueIndex: scheduleIndex });
    setSelectedQueueAnchor(scheduleIndex);
  }
}

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
  lowerThirdFontFamily: "",
  lowerThirdFontSize: undefined,
  lowerThirdBarBackgroundColor: "",
  lowerThirdBarBackgroundPath: "",
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
  lowerThirdFontFamily: false,
  lowerThirdFontSize: false,
  lowerThirdBarBackgroundColor: false,
  lowerThirdBarBackgroundPath: false,
};

const bibleVerseSelection = {
  verses: new Set(),
  anchor: 0,
};

let bibleVersePreviewTimer = null;

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

const BIBLE_RECENT_STORAGE_KEY = "ems.bibleRecentScriptures";

const BIBLE_RECENT_LIMIT = 10;

let bibleRecentScriptures = loadRecentScriptures();

const LAST_BIBLE_VERSION_SETTING_KEY = "lastBibleVersion";

const DEFAULT_BIBLE_VERSION = "KJV";

let bibleVerseDragPayload = null;

const BIBLE_VERSE_DRAG_MIME = "application/x-ems-bible-verses";

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
  const requestedVersion = bibleDesignerState.version || DEFAULT_BIBLE_VERSION;
  try {
    const result = await bibleAPI.suggestReferences(
      requestedVersion,
      query,
    );
    if (
      bibleVersionValue(bibleDesignerState.version || DEFAULT_BIBLE_VERSION) !==
        bibleVersionValue(requestedVersion) ||
      bibleVersionValue(result?.version || "") !== bibleVersionValue(requestedVersion)
    ) {
      return [];
    }
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

async function firstBibleReferenceForVersion(version) {
  try {
    const metadata = await bibleAPI.getBookMetadata(version || DEFAULT_BIBLE_VERSION);
    if (metadata?.error) return null;
    const firstBook = (Array.isArray(metadata?.books) ? metadata.books : []).find(
      (book) => String(book?.name || "").trim() && Number(book?.verseCounts?.[0]) > 0,
    );
    const book = String(firstBook?.name || "").trim();
    if (!book) return null;
    return {
      reference: `${book} 1:1`,
      book,
      chapter: 1,
      verse: 1,
      verseEnd: 0,
    };
  } catch {
    return null;
  }
}

async function selectFirstBibleReferenceForVersion(version) {
  const firstReference = await firstBibleReferenceForVersion(version);
  if (!firstReference) return false;
  Object.assign(bibleDesignerState, firstReference, { text: "" });
  bibleVerseSelection.verses.clear();
  bibleVerseSelection.anchor = 0;
  const referenceInput = document.getElementById("bibleReferenceInput");
  if (referenceInput) referenceInput.value = firstReference.reference;
  return true;
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
  setSharedRendererState({ bibleReferenceSuggestionIndex: -1 });
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
    setSharedRendererState({ bibleReferenceSuggestionIndex: suggestions.length - 1 });
  }
  if (bibleReferenceSuggestionIndex < 0) {
    setSharedRendererState({ bibleReferenceSuggestionIndex: 0 });
  }
  updateBibleReferenceSuggestionActiveState();
}

function isBibleReferenceSuggestionsOpen() {
  const suggestionsEl = document.getElementById("bibleReferenceSuggestions");
  return Boolean(suggestionsEl && suggestionsEl.hidden === false);
}

// Book abbreviations (e.g. "1 Thess.") are version-independent, so a single
// lookup fetched once is reused for every version/queue item. This keeps
// schedule labels short without truncating them mid-word.
let bibleBookAbbreviationCache = null;

let bibleBookAbbreviationCacheLoading = false;

function requestBibleBookAbbreviationCache() {
  if (bibleBookAbbreviationCache || bibleBookAbbreviationCacheLoading || !bibleAPI) return;
  bibleBookAbbreviationCacheLoading = true;
  bibleAPI
    .getBookMetadata("KJV")
    .then((metadata) => {
      const map = new Map();
      if (!metadata?.error && Array.isArray(metadata?.books)) {
        for (const book of metadata.books) {
          const name = String(book?.name || "").trim();
          const abbreviation = String(book?.abbreviation || "").trim();
          if (name && abbreviation) map.set(name.toLowerCase(), abbreviation);
        }
      }
      bibleBookAbbreviationCache = map;
      renderQueue();
    })
    .catch(() => {
      bibleBookAbbreviationCache = new Map();
    })
    .finally(() => {
      bibleBookAbbreviationCacheLoading = false;
    });
}

function bibleBookAbbreviationSync(bookName) {
  const name = String(bookName || "").trim().toLowerCase();
  if (!name) return "";
  if (!bibleBookAbbreviationCache) {
    requestBibleBookAbbreviationCache();
    return "";
  }
  return bibleBookAbbreviationCache.get(name) || "";
}

// Schedule-list-only display label: swaps the full book name for its
// abbreviation (falling back to the full reference when no abbreviation is
// known) so long references like "1 Thessalonians 1:12" fit the sidebar.
function bibleQueueItemDisplayName(item) {
  const fallback = item?.name || "";
  const bible = item?.bible;
  const book = String(bible?.book || "").trim();
  const chapter = Number.isFinite(bible?.chapter) ? bible.chapter : null;
  if (!bible || !book || !chapter) return fallback;
  const abbreviation = bibleBookAbbreviationSync(book);
  if (!abbreviation || abbreviation.toLowerCase() === book.toLowerCase()) return fallback;
  const selectedVerses = bibleSelectedVersesForEntry(bible);
  const shortReference =
    selectedVerses.length > 0
      ? referenceForBibleVerseNumbers(abbreviation, chapter, selectedVerses)
      : `${abbreviation} ${chapter}`;
  const version = String(bible.version || "").trim();
  return version ? `${shortReference} ${version}` : shortReference;
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

function clearBibleVerseDragVisualState() {
  bibleVerseDragPayload = null;
  hideQueueDropIndicator();
  document.querySelectorAll(".bible-verse-row--dragging").forEach((el) => {
    el.classList.remove("bible-verse-row--dragging");
  });
}

function bibleVerseDragPayloadFromDataTransfer(dataTransfer) {
  if (bibleVerseDragPayload) return bibleVerseDragPayload;
  if (!dataTransferHasType(dataTransfer, BIBLE_VERSE_DRAG_MIME)) return null;
  try {
    const raw = dataTransfer.getData(BIBLE_VERSE_DRAG_MIME);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function cleanBibleVerseTextForDisplay(value) {
  const text = String(value || "");
  if (!text.includes("{")) return collapseBibleDisplayLineWhitespace(text);
  let result = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char !== "{") {
      result += char;
      index += 1;
      continue;
    }

    let depth = 1;
    let closeIndex = index + 1;
    while (closeIndex < text.length && depth > 0) {
      const closeChar = text[closeIndex];
      if (closeChar === "{") depth += 1;
      if (closeChar === "}") depth -= 1;
      closeIndex += 1;
    }
    if (depth > 0) {
      result += char;
      index += 1;
      continue;
    }
    index = closeIndex;
  }
  return collapseBibleDisplayLineWhitespace(result);
}

function collapseBibleDisplayLineWhitespace(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/[^\S\r\n]+/g, " "))
    .join("\n")
    .trim();
}

function buildBibleTextMessage(entry = bibleDesignerState, opts = {}) {
  const style = {
    fontFamily: entry.fontFamily || bibleDesignerState.fontFamily,
    fontFamilyOverride: entry.fontFamilyOverride === true,
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
    lowerThirdFontFamily:
      entry.lowerThirdFontFamily || bibleDesignerState.lowerThirdFontFamily || "",
    lowerThirdFontFamilyOverride: entry.lowerThirdFontFamilyOverride === true,
    lowerThirdFontSize: Number.isFinite(entry.lowerThirdFontSize)
      ? entry.lowerThirdFontSize
      : bibleDesignerState.lowerThirdFontSize,
    lowerThirdBarBackgroundColor:
      entry.lowerThirdBarBackgroundColor ||
      bibleDesignerState.lowerThirdBarBackgroundColor ||
      SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND,
    lowerThirdBarBackgroundPath:
      entry.lowerThirdBarBackgroundPath ||
      bibleDesignerState.lowerThirdBarBackgroundPath ||
      "",
  };
  const look = normalizeScriptureLook(opts.look || entry.look || bibleDesignerState.look);
  const isLowerThird = look === SCRIPTURE_LOOK_LOWER_THIRD;
  const backgroundUrl = style.backgroundPath ? pathToMediaUrl(style.backgroundPath) : "";
  const backgroundVideo = !isLowerThird && /\.(mp4|m4v|mov|mkv|webm)$/i.test(style.backgroundPath)
    ? backgroundUrl
    : "";
  const fullBodyText = cleanBibleVerseTextForDisplay(entry.text);
  const attribution = entry.attribution || bibleAttributionForVersion(entry.version || "KJV");
  const referencePresentation = scriptureReferencePresentationForBackground(
    style.backgroundColor,
    { forceLight: isLowerThird || Boolean(style.backgroundPath) },
  );
  const message = {
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
    lowerThirdSegments: [],
    lowerThirdSegmentIndex: 0,
    lowerThirdSegmentCount: 0,
    bodyText: fullBodyText,
    position: { vertical: "center", horizontal: "center" },
  };
  if (isLowerThird) {
    const outputSize =
      opts.outputSize || selectedBiblePreviewOutputSize("lowerThirdDspSelct");
    const resolvedTheme = resolvedThemeForItem(entry, "scripture", "lowerThird", outputSize);
    const lowerThirdTypography = {
      fontFamily: style.lowerThirdFontFamily || style.fontFamily,
      fontSize: style.lowerThirdFontSize || SCRIPTURE_LOWER_THIRD_DEFAULT_FONT_SIZE,
      minFontSize: SCRIPTURE_ABSOLUTE_MIN_BODY_FONT_SIZE,
      fontWeight: SCRIPTURE_FONT_WEIGHT,
      lineHeight: 1.18,
      autosizeMode: SCRIPTURE_AUTOSIZE_FIT,
      maxLines: 2,
    };
    const resolved = renderScriptureForTarget(
      { ...entry, text: fullBodyText, ...style },
      {
        outputRole: "lowerThird",
        includeVerseNumbers: false,
        outputSize,
        activeSlideId: opts.activeSlideId || entry.currentLowerThirdSlideId,
        style: lowerThirdTypography,
        typography: {
          ...(resolvedTheme?.typography || lowerThirdTypography),
          ...(style.lowerThirdFontFamilyOverride
            ? { fontFamily: lowerThirdTypography.fontFamily }
            : {}),
          maxLines: 2,
        },
        forceAutoSplit: true,
      },
      resolvedTheme,
    );
    const resolvedSegments = resolved.presentation.slides.map((unit) => ({
      text: unit.bodyText,
      slideId: unit.slideId,
    }));
    const resolvedSegmentIndex = Math.max(
      0,
      resolved.presentation.slides.findIndex(
        (unit) => unit.slideId === resolved.activeUnit?.slideId,
      ),
    );
    const lowerThirdResult = {
      ...enrichLowerThirdPresentationMessage(message, pathToMediaUrl),
      ...resolved.message,
      bodyText: resolved.activeUnit?.bodyText || "",
      text: resolved.activeUnit?.bodyText || "",
      lowerThirdSegments: resolvedSegments,
      lowerThirdSegmentIndex: resolvedSegmentIndex,
      lowerThirdSegmentCount: resolvedSegments.length,
      color: message.color,
      fontFamilyOverride: style.lowerThirdFontFamilyOverride,
      lowerThirdFontFamilyOverride: style.lowerThirdFontFamilyOverride,
      lowerThirdFontFamily: style.lowerThirdFontFamily || style.fontFamily,
      backgroundColor: message.backgroundColor,
      chromaKeyColor: message.chromaKeyColor,
      backgroundPath: "",
      backgroundImage: "",
      backgroundVideo: "",
      resolvedPresentation: resolved.presentation,
      resolvedUnit: resolved.activeUnit,
      slideId: resolved.activeUnit?.slideId || null,
      layoutKey: resolved.presentation.layoutKey,
      resolvedLayout: resolved.activeUnit?.layout || null,
    };
    return resolvedTheme
      ? themedLowerThirdMessage(lowerThirdResult, resolvedTheme)
      : lowerThirdResult;
  }
  const outputSize = opts.outputSize || selectedBiblePreviewOutputSize("dspSelct");
  const resolvedTheme = resolvedThemeForItem(entry, "scripture", "audience", outputSize);
  const resolved = renderScriptureForTarget(
    {
      ...entry,
      text: fullBodyText,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      minFontSize: style.minFontSize,
      autosizeMode: style.autosizeMode,
      autoSplit: style.autoSplit,
      lineHeight: SCRIPTURE_LINE_HEIGHT,
      fontWeight: SCRIPTURE_FONT_WEIGHT,
    },
    {
      outputRole: "audience",
      includeVerseNumbers: false,
      outputSize,
      activeSlideId: opts.activeSlideId || entry.currentSlideId,
      style,
      typography: style.fontFamilyOverride
        ? { ...(resolvedTheme?.typography || style), fontFamily: style.fontFamily }
        : undefined,
    },
    resolvedTheme,
  );
  const audienceResult = {
    ...message,
    ...resolved.message,
    fontFamilyOverride: style.fontFamilyOverride,
    fontFamily: style.fontFamilyOverride ? style.fontFamily : resolved.message.fontFamily,
    color: message.color,
    backgroundColor: message.backgroundColor,
    backgroundPath: message.backgroundPath,
    backgroundImage: message.backgroundImage,
    backgroundVideo: message.backgroundVideo,
    backgroundVideoSync: message.backgroundVideoSync,
    referenceColor: message.referenceColor,
    referenceTextShadow: message.referenceTextShadow,
    referenceFontSize: message.referenceFontSize,
    transition: entry.transition || message.transition,
  };
  return resolvedTheme
    ? themedAudienceMessage(audienceResult, resolvedTheme)
    : audienceResult;
}

function selectScriptureResolvedSlide(entry, presentation, slideId) {
  const unit = presentation?.slides?.find((slide) => slide.slideId === slideId);
  if (!unit || !entry) return false;
  entry.currentSlideId = unit.slideId;
  const lowerThirdPresentation = buildBibleTextMessage(entry, {
    look: SCRIPTURE_LOOK_LOWER_THIRD,
  }).resolvedPresentation;
  const cursor = scriptureCursorForSlide(unit, presentation?.slides || []);
  const mappedLowerThirdSlide = resolveScriptureSlideForCursor(
    lowerThirdPresentation?.slides || [],
    cursor,
  );
  let lowerThirdIndex = (lowerThirdPresentation?.slides || []).findIndex(
    (slide) => slide.slideId === mappedLowerThirdSlide?.slideId,
  );
  if (lowerThirdIndex < 0) lowerThirdIndex = 0;
  const lowerThirdSlide = lowerThirdPresentation?.slides?.[lowerThirdIndex] || null;
  // Audience navigation is the canonical Scripture cursor. If the operator
  // had manually cued a lower third, choosing an audience slide intentionally
  // resumes linked following from this content unit.
  entry.lowerThirdSegmentIndex = lowerThirdIndex;
  entry.currentLowerThirdSlideId = lowerThirdSlide?.slideId || null;
  if (entry === bibleDesignerState) bibleDesignerState.currentSlideId = unit.slideId;
  for (const index of [previewCueIndex, currentQueueIndex]) {
    const item = Number.isInteger(index) ? mediaQueue[index] : null;
    if (!item || !bibleEntryMatchesQueueItemShallow(entry, item)) continue;
    item.currentSlideId = unit.slideId;
    if (item.bible && typeof item.bible === "object") {
      item.bible.currentSlideId = unit.slideId;
      item.bible.lowerThirdSegmentIndex = lowerThirdIndex;
      item.bible.currentLowerThirdSlideId = lowerThirdSlide?.slideId || null;
    }
  }
  const targetIndex = currentBibleEditorTargetIndex();
  const targetItem = targetIndex >= 0 ? mediaQueue[targetIndex] : null;
  const source = scripturePresentationSource(entry, {
    item: targetItem,
    scheduleIndex: targetIndex,
  });
  if (
    !["live", "taking"].includes(scripturePresentation.state.status) ||
    scripturePresentation.state.source?.id === source.id
  ) {
    if (scripturePresentation.state.source?.id !== source.id) {
      scripturePresentation.dispatch({ type: "SOURCE_PREVIEWED", source, cursor });
    }
    scripturePresentation.dispatch({
      type: "LOWER_THIRD_FOLLOW_SET",
      follow: SCRIPTURE_FOLLOW_MODE.LINKED,
      slideId: lowerThirdSlide?.slideId || null,
    });
    scripturePresentation.dispatch({
      type: "CURSOR_CHANGED",
      sourceId: source.id,
      cursor,
      lowerThirdSlideId: lowerThirdSlide?.slideId || null,
    });
  }
  applyBiblePreview(entry);
  saveMediaFile();
  void syncActiveScheduledBiblePresentation().catch(console.error);
  void syncShowNowBiblePresentation().catch(console.error);
  return true;
}

function renderBibleSlideNavigator(entry, presentation) {
  const navigator = document.getElementById("bibleSlideNavigator");
  const list = document.getElementById("bibleSlideThumbnailList");
  const status = document.getElementById("bibleSlideStatus");
  const previous = document.getElementById("biblePrevSlideBtn");
  const next = document.getElementById("bibleNextSlideBtn");
  if (!navigator || !list || !status || !previous || !next) return;
  const slides = presentation?.slides || [];
  navigator.hidden = slides.length <= 1;
  list.replaceChildren();
  if (slides.length <= 1) {
    status.textContent = "";
    previous.disabled = true;
    next.disabled = true;
    return;
  }
  const foundIndex = slides.findIndex(
    (slide) => slide.slideId === presentation.navigation?.activeSlideId,
  );
  const activeIndex = foundIndex >= 0 ? foundIndex : 0;
  slides.forEach((unit, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bible-slide-thumbnail";
    button.dataset.slideId = unit.slideId;
    button.dataset.layoutKey = presentation.layoutKey;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", index === activeIndex ? "true" : "false");
    button.classList.toggle("is-active", index === activeIndex);
    button.textContent = unit.bodyText || "";
    button.dir = "auto";
    button.addEventListener("click", () => {
      selectScriptureResolvedSlide(entry, presentation, unit.slideId);
    });
    list.appendChild(button);
  });
  const nextLabel = slides[activeIndex + 1]?.referenceText;
  status.textContent = `Slide ${activeIndex + 1} of ${slides.length}${nextLabel ? ` · Next: ${nextLabel}` : ""}`;
  previous.disabled = activeIndex <= 0;
  next.disabled = activeIndex >= slides.length - 1;
  previous.onclick = () => {
    const unit = slides[activeIndex - 1];
    if (unit) selectScriptureResolvedSlide(entry, presentation, unit.slideId);
  };
  next.onclick = () => {
    const unit = slides[activeIndex + 1];
    if (unit) selectScriptureResolvedSlide(entry, presentation, unit.slideId);
  };
}

function applyBiblePreview(entry = bibleDesignerState, opts = {}) {
  const renderToken = Number.isFinite(opts.renderToken)
    ? opts.renderToken
    : ++biblePreviewRenderToken;
  if (renderToken !== biblePreviewRenderToken) return;
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
  const previewSourceKey = [
    previewEntry.version || "",
    normalizeScriptureReference(previewEntry.reference || ""),
    previewEntry.text || "",
  ].join("\u0000");
  if (previewSourceKey !== bibleLowerThirdPreviewSourceKey) {
    bibleLowerThirdPreviewSourceKey = previewSourceKey;
    previewEntry.lowerThirdSegmentIndex = 0;
    previewEntry.currentLowerThirdSlideId = null;
    document.getElementById("bibleLowerThirdCueList")?.replaceChildren();
    audienceText
      .querySelectorAll("mark.operator-lower-third-selection")
      .forEach((mark) => mark.replaceWith(document.createTextNode(mark.textContent || "")));
    audienceText.normalize();
  }
  if (!opts.fontsReadyRetry) {
    const themeFonts = [];
    if (appliedPresentationTheme) {
      const audienceTheme = resolveThemeForTarget({
        theme: appliedPresentationTheme,
        contentKind: "scripture",
        outputRole: "audience",
        outputSize: selectedBiblePreviewOutputSize("dspSelct"),
      });
      const lowerThirdTheme = lowerThirdEnabled
        ? resolveThemeForTarget({
            theme: appliedPresentationTheme,
            contentKind: "scripture",
            outputRole: "lowerThird",
            outputSize: selectedBiblePreviewOutputSize("lowerThirdDspSelct"),
          })
        : null;
      themeFonts.push(
        audienceTheme.typography?.fontFamily,
        lowerThirdTheme?.typography?.fontFamily,
      );
    }
    void Promise.all([
      waitForScriptureFonts(previewEntry),
      waitForTextFonts(themeFonts.filter(Boolean), {
        documentRef: globalThis.document,
        sample: cleanBibleVerseTextForDisplay(previewEntry.text) || "EMS",
        fontSize: previewEntry.fontSize || SCRIPTURE_BODY_FONT_SIZE,
      }),
    ]).then(() => {
      if (
        renderToken !== biblePreviewRenderToken ||
        previewSourceKey !== bibleLowerThirdPreviewSourceKey
      ) return;
      applyBiblePreview(previewEntry, {
        ...opts,
        fontsReadyRetry: true,
        renderToken,
      });
    });
    return;
  }
  if (renderToken !== biblePreviewRenderToken) return;
  const audienceMessage = buildBibleTextMessage(previewEntry, {
    look: SCRIPTURE_LOOK_FULLSCREEN,
  });
  const lowerThirdMessage = lowerThirdEnabled
    ? buildBibleTextMessage(previewEntry, {
        look: SCRIPTURE_LOOK_LOWER_THIRD,
      })
    : null;
  renderBibleSlideNavigator(previewEntry, audienceMessage.resolvedPresentation);
  panel.hidden = false;
  audienceShell.style.backgroundColor = audienceMessage.backgroundColor;
  const lowerThirdShell = document.getElementById("bibleLowerThirdPreviewShell");
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
    // Resolved Scripture references already include the version. Appending
    // message.version here produced labels such as “Genesis 1:11 NKJV NKJV”.
    title.textContent = audienceMessage.reference || "Bible";
  }
  applyScriptureRenderToPreview(
    audienceRender,
    audienceText,
    audienceReference,
    audienceMessage,
  );
  applyOperatorSelectionContrast(audienceRender, audienceMessage);
  markAudiencePreviewTextSelection(audienceText, lowerThirdMessage?.bodyText);
  if (lowerThirdEnabled && lowerThirdMessage) {
    renderLowerThirdPreview({
      shell: lowerThirdShell,
      render: lowerThirdRender,
      body: lowerThirdText,
      reference: lowerThirdReference,
      message: lowerThirdMessage,
      outputSize: selectedBiblePreviewOutputSize("lowerThirdDspSelct"),
      renderMessage: applyScriptureRenderToPreview,
      cued:
        Array.isArray(lowerThirdMessage.lowerThirdSegments) &&
        lowerThirdMessage.lowerThirdSegments.length > 0,
    });
  }
  syncBibleBackgroundLabel(audienceMessage.backgroundPath);
  syncBibleLookControls(lowerThirdMessage || audienceMessage);
}

function syncBibleLookControls(message) {
  const lookSelect = document.getElementById("bibleLookSelect");
  const lowerThirdControls = document.getElementById("bibleLowerThirdCuePanel");
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
    : 0;
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
      `Cue ${segmentCount > 0 ? index + 1 : 0} of ${segmentCount}`;
  }
  if (prevButton) prevButton.disabled = index <= 0;
  if (nextButton) nextButton.disabled = segmentCount <= 0 || index >= segmentCount - 1;
  renderBibleLowerThirdCueList(controlMessage.lowerThirdSegments, index);
}

function bibleLowerThirdCueKey(
  index = bibleDesignerState.lowerThirdSegmentIndex,
  entry = bibleDesignerState,
) {
  return `${entry?.text || ""}\u0000${index}`;
}

function renderBibleLowerThirdCueList(rawSegments, selectedIndex) {
  const list = document.getElementById("bibleLowerThirdCueList");
  if (!list) return;
  const segments = normalizeLowerThirdSegments(rawSegments);
  list.replaceChildren();
  segments.forEach((segment, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "bible-lower-third-cue-row";
    row.dataset.cueIndex = String(index);
    row.setAttribute("role", "option");
    row.title = "Click to cue; double-click to show live";
    row.setAttribute("aria-selected", index === selectedIndex ? "true" : "false");
    row.classList.toggle("is-cued", index === selectedIndex);
    const isLive = bibleLowerThirdOutputActive && bibleLowerThirdLiveCueKey === bibleLowerThirdCueKey(index);
    row.classList.toggle("is-live", isLive);

    const marker = document.createElement("span");
    marker.className = "bible-lower-third-cue-row__marker";
    marker.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "bible-lower-third-cue-row__text";
    text.textContent = segment.text;
    const live = document.createElement("span");
    live.className = "bible-lower-third-cue-row__live";
    live.textContent = isLive ? "Live" : "";
    row.append(marker, text, live);
    list.append(row);
  });
  const selectedRow = list.querySelector(".is-cued");
  selectedRow?.scrollIntoView?.({ block: "nearest" });
  const showButton = document.getElementById("bibleLowerThirdShowBtn");
  if (showButton) {
    showButton.disabled = segments.length === 0;
    showButton.textContent = bibleLowerThirdOutputActive ? "Update" : "Show";
  }
}

function persistBibleLowerThirdCueState() {
  const targetIndex = currentBibleEditorTargetIndex();
  const indexes = new Set();
  if (
    targetIndex >= 0 &&
    targetIndex < mediaQueue.length &&
    isQueueItemBible(mediaQueue[targetIndex])
  ) {
    indexes.add(targetIndex);
  }
  if (
    currentQueueIndex >= 0 &&
    currentQueueIndex < mediaQueue.length &&
    isQueueItemBible(mediaQueue[currentQueueIndex]) &&
    bibleEntryMatchesQueueItemShallow(
      bibleDesignerState,
      mediaQueue[currentQueueIndex],
    )
  ) {
    indexes.add(currentQueueIndex);
  }
  if (indexes.size === 0) return false;
  for (const index of indexes) {
    mediaQueue[index] = {
      ...mediaQueue[index],
      currentSlideId: bibleDesignerState.currentSlideId || null,
      bible: {
        ...(mediaQueue[index].bible || {}),
        lowerThirdSegmentIndex: bibleDesignerState.lowerThirdSegmentIndex,
        currentSlideId: bibleDesignerState.currentSlideId || null,
        currentLowerThirdSlideId: bibleDesignerState.currentLowerThirdSlideId || null,
      },
    };
  }
  renderQueue();
  saveMediaFile();
  return true;
}

async function commitBibleDesignerRenderState({ rebuildLowerThird = false } = {}) {
  await syncBibleStateFromControls();
  if (rebuildLowerThird) {
    bibleDesignerState.lowerThirdSegmentIndex = 0;
    bibleDesignerState.currentLowerThirdSlideId = null;
  }
  applyBiblePreview(bibleDesignerState, { show: false });
  if (await syncBibleDesignerStateToPreviewedQueueItem()) {
    saveMediaFile();
  }
  syncActiveScheduledBiblePresentation();
  void syncShowNowBiblePresentation().catch(console.error);
}

async function syncLiveBibleAudienceForLowerThirdCue(expectedRevision) {
  if (!(isActiveMediaWindow() && activeMediaWindowContentType === "bible")) {
    return false;
  }
  let entry = null;
  if (
    isQueuePlaying &&
    currentQueueIndex >= 0 &&
    currentQueueIndex < mediaQueue.length &&
    isQueueItemBible(mediaQueue[currentQueueIndex])
  ) {
    entry = await resolvedBibleEntryForItem(mediaQueue[currentQueueIndex]);
  } else if (bibleShowNowModeActive) {
    const transientEntry = await currentBibleTextOnlyEntry();
    entry = transientEntry ? bibleEntryWithShowNowStyle(transientEntry).bible : null;
  }
  if (!entry || !scripturePresentation.isCurrentRevision(expectedRevision)) {
    return false;
  }
  return sendBibleTextToOutput(entry, expectedRevision);
}

async function setBibleLowerThirdSegmentIndex(index) {
  if (!isBibleLowerThirdFeatureEnabled()) return false;
  await syncBibleStateFromControls();
  const resolvedEntry = await bibleEntryWithLookupText(bibleDesignerState);
  if (resolvedEntry && resolvedEntry !== bibleDesignerState) {
    Object.assign(bibleDesignerState, resolvedEntry);
  }
  const resolvedMessage = buildBibleTextMessage(bibleDesignerState, {
    look: SCRIPTURE_LOOK_LOWER_THIRD,
  });
  const resolvedSlides = resolvedMessage.resolvedPresentation?.slides || [];
  const nextIndex = clampLowerThirdSegmentIndex(
    index,
    resolvedSlides,
  );
  const nextSlideId = resolvedSlides[nextIndex]?.slideId || null;
  const lowerThirdUnchanged =
    nextIndex === bibleDesignerState.lowerThirdSegmentIndex &&
    (!nextSlideId || nextSlideId === bibleDesignerState.currentLowerThirdSlideId);
  const selectedLowerThirdSlide = resolvedSlides[nextIndex] || null;
  const lowerThirdCursor = scriptureCursorForSlide(
    selectedLowerThirdSlide,
    resolvedSlides,
  );
  const audienceMessage = buildBibleTextMessage(bibleDesignerState, {
    look: SCRIPTURE_LOOK_FULLSCREEN,
  });
  const audienceSlides = audienceMessage.resolvedPresentation?.slides || [];
  const containingAudienceSlide = resolveScriptureSlideForCursor(
    audienceSlides,
    lowerThirdCursor,
  );
  const audienceSlideChanged = Boolean(
    containingAudienceSlide?.slideId &&
      containingAudienceSlide.slideId !== bibleDesignerState.currentSlideId,
  );
  if (lowerThirdUnchanged && !audienceSlideChanged) {
    syncBibleLookControls(resolvedMessage);
    return false;
  }
  const showNowTarget = bibleShowNowModeActive && !isQueuePlaying;
  const targetIndex = showNowTarget ? -1 : currentBibleEditorTargetIndex();
  const targetItem = targetIndex >= 0 ? mediaQueue[targetIndex] : null;
  const source = scripturePresentationSource(bibleDesignerState, {
    item: targetItem,
    scheduleIndex: targetIndex,
  });
  const stateOwnsTarget =
    !["live", "taking"].includes(scripturePresentation.state.status) ||
    scripturePresentation.state.source?.id === source.id;
  const targetIsLive = showNowTarget || isBibleEditorTargetLiveItem();
  bibleDesignerState.lowerThirdSegmentIndex = nextIndex;
  if (nextSlideId) bibleDesignerState.currentLowerThirdSlideId = nextSlideId;
  if (stateOwnsTarget) {
    if (scripturePresentation.state.source?.id !== source.id) {
      scripturePresentation.dispatch({
        type: "SOURCE_PREVIEWED",
        source,
        cursor: scriptureCursorFromPresentation(audienceMessage.resolvedPresentation),
      });
    }
    scripturePresentation.dispatch({
      type: "LOWER_THIRD_CUED",
      sourceId: source.id,
      slideId: nextSlideId,
    });
  }
  if (audienceSlideChanged) {
    bibleDesignerState.currentSlideId = containingAudienceSlide.slideId;
    const audienceCursor = scriptureCursorForSlide(
      containingAudienceSlide,
      audienceSlides,
    );
    if (stateOwnsTarget) {
      scripturePresentation.dispatch({
        type: "CURSOR_CHANGED",
        sourceId: source.id,
        cursor: audienceCursor,
        lowerThirdSlideId: nextSlideId,
      });
    }
  }
  const updatedAudienceMessage = buildBibleTextMessage(bibleDesignerState, {
    look: SCRIPTURE_LOOK_FULLSCREEN,
  });
  renderBibleSlideNavigator(
    bibleDesignerState,
    updatedAudienceMessage.resolvedPresentation,
  );
  applyBiblePreview(bibleDesignerState, { show: false });
  persistBibleLowerThirdCueState();
  if (audienceSlideChanged && targetIsLive && stateOwnsTarget) {
    const expectedRevision = scripturePresentation.state.revision;
    void syncLiveBibleAudienceForLowerThirdCue(expectedRevision).catch((error) =>
      console.error("Failed to align audience Scripture with lower-third cue:", error),
    );
  }
  return true;
}

async function changeBibleLowerThirdSegment(delta) {
  const resolved = buildBibleTextMessage(bibleDesignerState, {
    look: SCRIPTURE_LOOK_LOWER_THIRD,
  });
  const resolvedIndex = resolved.resolvedPresentation?.slides?.findIndex(
    (slide) => slide.slideId === bibleDesignerState.currentLowerThirdSlideId,
  );
  const current = Number.isFinite(resolvedIndex) && resolvedIndex >= 0
    ? resolvedIndex
    : Number.isFinite(bibleDesignerState.lowerThirdSegmentIndex)
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
    lowerThirdSegmentIndex: 0,
    currentLowerThirdSlideId: null,
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
  const lowerThirdMessage = buildBibleTextMessage(bibleDesignerState, {
    look: SCRIPTURE_LOOK_LOWER_THIRD,
  });
  const slides = lowerThirdMessage.resolvedPresentation?.slides || [];
  if (!slides.length) {
    syncBibleLookControls(lowerThirdMessage);
    return false;
  }
  const activeIndex = Math.max(
    0,
    slides.findIndex(
      (slide) => slide.slideId === bibleDesignerState.currentLowerThirdSlideId,
    ),
  );
  if (activeIndex < slides.length - 1) {
    return changeBibleLowerThirdSegment(1);
  }
  if (isScheduledBiblePresentationActive()) {
    return advanceToNextScheduledBibleText();
  }
  return advanceBibleDesignerToNextVerse();
}

function setBibleStyleEditorVisible(visible) {
  const drawer = document.getElementById("bibleEditorDrawer");
  if (!drawer) return;
  drawer.hidden = !visible;
  document.getElementById("bibleWorkspace")?.classList.toggle(
    "bible-workspace--editing",
    visible,
  );
}

function loadRecentScriptures() {
  try {
    const parsed = JSON.parse(
      window.localStorage?.getItem(BIBLE_RECENT_STORAGE_KEY) || "[]",
    );
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    return parsed
      .map((item) => ({
        reference: normalizeScriptureReference(item?.reference || ""),
        version: bibleVersionValue(item?.version || "KJV"),
        text: typeof item?.text === "string" ? item.text : "",
        book: typeof item?.book === "string" ? item.book : "",
        chapter: Number.isFinite(item?.chapter) ? item.chapter : 0,
        verse: Number.isFinite(item?.verse) ? item.verse : 0,
        verseEnd: Number.isFinite(item?.verseEnd) ? item.verseEnd : 0,
        selectedVerses: Array.isArray(item?.selectedVerses)
          ? item.selectedVerses.filter((verse) => Number.isFinite(verse) && verse > 0)
          : [],
        attribution: item?.attribution || null,
      }))
      .filter((item) => {
        const key = `${item.version}\u0000${item.reference.toLowerCase()}`;
        if (!item.reference || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, BIBLE_RECENT_LIMIT);
  } catch {
    return [];
  }
}

function persistRecentScriptures() {
  try {
    window.localStorage?.setItem(
      BIBLE_RECENT_STORAGE_KEY,
      JSON.stringify(bibleRecentScriptures),
    );
  } catch {}
}

function renderRecentScriptures() {
  const section = document.getElementById("bibleRecentSection");
  const list = document.getElementById("bibleRecentList");
  const count = document.getElementById("bibleRecentCount");
  if (!section || !list) return;
  section.hidden = bibleRecentScriptures.length === 0;
  if (count) {
    count.textContent = String(bibleRecentScriptures.length);
    count.setAttribute(
      "aria-label",
      `${bibleRecentScriptures.length} recent Scripture${bibleRecentScriptures.length === 1 ? "" : "s"}`,
    );
  }
  list.replaceChildren();
  bibleRecentScriptures.forEach((item) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "bible-recent-row";
    row.setAttribute("aria-label", `Open ${item.reference} in ${item.version}`);
    row.setAttribute("aria-haspopup", "menu");
    row.setAttribute("aria-expanded", "false");

    const reference = document.createElement("span");
    reference.className = "bible-recent-reference";
    reference.textContent = item.reference;
    const version = document.createElement("span");
    version.className = "bible-recent-version";
    version.textContent = item.version;
    row.append(reference, version);
    row.addEventListener("click", () => {
      hideRecentScriptureContextMenu();
      void openRecentScripture(item).catch(console.error);
    });
    row.addEventListener("contextmenu", (event) => {
      showRecentScriptureContextMenu(event, item);
    });
    list.appendChild(row);
  });
}

function rememberRecentScripture(entry) {
  const reference = normalizeScriptureReference(entry?.reference || "");
  const version = bibleVersionValue(
    entry?.version || bibleDesignerState.version || DEFAULT_BIBLE_VERSION,
  );
  if (!reference) return;
  const key = `${version}\u0000${reference.toLowerCase()}`;
  const stateMatchesEntry =
    bibleVersionValue(bibleDesignerState.version) === version &&
    normalizeScriptureReference(bibleDesignerState.reference).toLowerCase() ===
      reference.toLowerCase();
  const source = stateMatchesEntry ? { ...bibleDesignerState, ...entry } : entry || {};
  const snapshot = {
    reference,
    version,
    text: typeof source.text === "string" ? source.text : "",
    book: typeof source.book === "string" ? source.book : "",
    chapter: Number.isFinite(source.chapter) ? source.chapter : 0,
    verse: Number.isFinite(source.verse) ? source.verse : 0,
    verseEnd: Number.isFinite(source.verseEnd) ? source.verseEnd : 0,
    selectedVerses: Array.isArray(source.selectedVerses)
      ? source.selectedVerses.filter((verse) => Number.isFinite(verse) && verse > 0)
      : [],
    attribution: source.attribution || bibleAttributionForVersion(version),
  };
  bibleRecentScriptures = [
    snapshot,
    ...bibleRecentScriptures.filter(
      (item) => `${item.version}\u0000${item.reference.toLowerCase()}` !== key,
    ),
  ].slice(0, BIBLE_RECENT_LIMIT);
  persistRecentScriptures();
  renderRecentScriptures();
}

async function openRecentScripture(item) {
  const versionSelect = document.getElementById("bibleVersionSelect");
  const versionAvailable = Array.from(versionSelect?.options || []).some(
    (option) => option.value === item.version,
  );
  if (!versionAvailable) {
    showGnomeToast(`${item.version} is not installed`);
    return false;
  }
  setBibleDesignerVersion(item.version, { syncControls: true });
  const referenceInput = document.getElementById("bibleReferenceInput");
  if (referenceInput) referenceInput.value = item.reference;
  const opened = await jumpBibleReferenceToBrowser();
  if (opened && typeof item.text === "string" && item.text) {
    Object.assign(bibleDesignerState, {
      version: item.version,
      attribution: item.attribution || bibleAttributionForVersion(item.version),
      reference: item.reference,
      text: item.text,
      book: item.book || bibleDesignerState.book,
      chapter: item.chapter || bibleDesignerState.chapter,
      verse: item.verse || bibleDesignerState.verse,
      verseEnd: item.verseEnd || 0,
      selectedVerses: Array.isArray(item.selectedVerses) ? [...item.selectedVerses] : [],
    });
    setBibleVerseSelectionFromEntry(bibleDesignerState);
    syncBibleSelectorsFromState();
    applyBiblePreview(bibleDesignerState, { show: false });
    syncBibleVerseListSelection();
  }
  if (opened) rememberRecentScripture({ ...item, ...bibleDesignerState });
  return opened;
}

function clearRecentScriptures() {
  bibleRecentScriptures = [];
  persistRecentScriptures();
  renderRecentScriptures();
  showGnomeToast("Recent Scriptures cleared");
}

function hideRecentScriptureContextMenu({ restoreFocus = false } = {}) {
  const menu = document.getElementById("bibleRecentContextMenu");
  const targetRow = menu?._targetRow;
  targetRow?.classList.remove("is-context-target");
  targetRow?.setAttribute("aria-expanded", "false");
  menu?.setAttribute("hidden", "");
  if (menu) {
    menu._targetRow = null;
    menu._recentScripture = null;
  }
  if (restoreFocus && targetRow?.isConnected) targetRow.focus();
}

function ensureRecentScriptureContextMenu() {
  let menu = document.getElementById("bibleRecentContextMenu");
  if (menu) return menu;
  menu = document.createElement("div");
  menu.id = "bibleRecentContextMenu";
  menu.className = "bible-text-context-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  menu.innerHTML = `
    <button type="button" role="menuitem" data-recent-scripture-action="show">Show Now</button>
    <button type="button" role="menuitem" data-recent-scripture-action="schedule">Add to Schedule</button>
  `;
  menu.addEventListener("pointerdown", (event) => event.stopPropagation());
  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    const button = event.target.closest("[data-recent-scripture-action]");
    if (!button || !menu._recentScripture) return;
    const item = menu._recentScripture;
    const action = button.getAttribute("data-recent-scripture-action");
    hideRecentScriptureContextMenu();
    void (async () => {
      if (!(await openRecentScripture(item))) return;
      if (action === "show") await showBibleTextNow();
      else if (action === "schedule") await insertBibleInSchedule();
    })().catch(console.error);
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    hideRecentScriptureContextMenu({ restoreFocus: true });
  });
  document.body.appendChild(menu);
  if (document.body.dataset.bibleRecentContextBound !== "1") {
    document.body.dataset.bibleRecentContextBound = "1";
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (event.target.closest?.("#bibleRecentContextMenu")) return;
        hideRecentScriptureContextMenu();
      },
      true,
    );
    window.addEventListener("resize", hideRecentScriptureContextMenu);
    window.addEventListener("scroll", hideRecentScriptureContextMenu, true);
  }
  return menu;
}

function showRecentScriptureContextMenu(event, item) {
  event.preventDefault();
  event.stopPropagation();
  hideRecentScriptureContextMenu();
  const menu = ensureRecentScriptureContextMenu();
  const targetRow = event.currentTarget?.closest?.(".bible-recent-row");
  menu._recentScripture = item;
  menu._targetRow = targetRow || null;
  targetRow?.classList.add("is-context-target");
  targetRow?.setAttribute("aria-expanded", "true");
  menu.hidden = false;
  menu.style.left = "0px";
  menu.style.top = "0px";
  const menuRect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(event.clientX, window.innerWidth - menuRect.width - 8));
  const top = Math.max(8, Math.min(event.clientY, window.innerHeight - menuRect.height - 8));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.querySelector("button")?.focus();
}

function isBibleWorkspaceVisible() {
  return document.getElementById("bibleWorkspace")?.hidden === false;
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
  const accepted = await showRendererConfirm(
    liveLabel
      ? `Switch the live presentation from "${liveLabel}" to "${reference}"?`
      : `Switch the current presentation to "${reference}"?`,
    {
      title: "Switch live presentation?",
      confirmLabel: "Switch",
    },
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

function buildBibleVerseDragPayload() {
  const selectedVerses = selectedBibleVerseNumbers();
  if (!selectedVerses.length) return null;
  const transition = readSlideTransitionControls(
    "bibleTransitionEffectInput",
    "bibleTransitionDurationInput",
    { allowInherit: true },
  );
  return {
    version: bibleDesignerState.version || DEFAULT_BIBLE_VERSION,
    book: bibleDesignerState.book,
    chapter: bibleDesignerState.chapter,
    verses: selectedVerses,
    style: bibleCurrentStylePayload(),
    look: normalizeScriptureLook(bibleDesignerState.look),
    transition,
  };
}

function normalizeBibleVerseDragPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const version = normalizedProjectBibleVersion(payload.version, DEFAULT_BIBLE_VERSION);
  const book = typeof payload.book === "string" ? payload.book.trim() : "";
  const chapter = Number(payload.chapter);
  const verses = normalizedProjectBibleSelectedVerses(payload.verses);
  if (!book || !Number.isFinite(chapter) || chapter < 1 || !verses.length) {
    return null;
  }
  return {
    version,
    book,
    chapter: Math.trunc(chapter),
    verses,
    style:
      payload.style && typeof payload.style === "object" ? payload.style : {},
    look: normalizeScriptureLook(payload.look || bibleDesignerState.look),
    transition: payload.transition || DEFAULT_ITEM_SLIDE_TRANSITION,
  };
}

async function bibleEntryFromVerseDragPayload(payload) {
  const normalized = normalizeBibleVerseDragPayload(payload);
  if (!normalized) return null;
  let textData = null;
  try {
    textData = await bibleAPI.getText(
      normalized.version,
      normalized.book,
      String(normalized.chapter),
    );
  } catch (err) {
    console.error("Failed to load dragged Bible verses:", err);
    return null;
  }
  const verses = Array.isArray(textData?.verses) ? textData.verses : [];
  const rows = normalized.verses
    .map((verseNumber) => ({
      verseNumber,
      text: verses[verseNumber - 1],
    }))
    .filter((row) => typeof row.text === "string" && row.text.trim());
  if (!rows.length) return null;

  const selectedVerses = rows.map((row) => row.verseNumber);
  const verseStart = selectedVerses[0];
  const verseEnd = selectedVerses[selectedVerses.length - 1];
  const entry = hydrateBibleEntryStyle({
    ...bibleDesignerState,
    ...normalized.style,
    attribution: textData.attribution || bibleAttributionForVersion(normalized.version),
    version: normalized.version,
    book: normalized.book,
    chapter: normalized.chapter,
    reference: referenceForBibleVerseNumbers(
      normalized.book,
      normalized.chapter,
      selectedVerses,
    ),
    text: bibleEntryTextForVerseRows(rows),
    verse: verseStart,
    verseEnd: verseEnd > verseStart ? verseEnd : 0,
    selectedVerses,
    look: normalized.look,
    lowerThirdSegmentIndex: 0,
    currentLowerThirdSlideId: null,
  });
  return {
    ...entry,
    transition: normalized.transition,
  };
}

async function queueEntriesForBibleVerseDragPayload(payload) {
  const entry = await bibleEntryFromVerseDragPayload(payload);
  return entry ? queueEntriesForBibleScheduleEntry(entry) : [];
}

function queueEntryFromBibleEntry(entry) {
  const { transition, ...bible } = entry || {};
  const transitionOverride = normalizeItemSlideTransitionOverride(transition);
  const queueEntry = {
    presentationId: `scripture-${generateProjectGuid()}`,
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
    lowerThirdSegmentIndex: 0,
    currentLowerThirdSlideId: null,
  };
  delete entry.autosizeGroupFontSize;
  return entry;
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

async function queueEntriesForBibleScheduleEntry(entry) {
  const outputSize = await currentBibleScheduleOutputSize();
  const hydrated = hydrateBibleEntryStyle(entry);
  const verseRows = await bibleVerseRowsForEntry(hydrated);
  const resolvedEntry = verseRows.length > 0
    ? { ...hydrated, verseRows }
    : hydrated;
  const resolved = renderScriptureForTarget(resolvedEntry, {
    outputRole: "audience",
    outputSize,
    activeSlideId: resolvedEntry.currentSlideId,
    style: resolvedEntry,
  });
  const queueEntry = queueEntryFromBibleEntry(resolvedEntry);
  queueEntry.currentSlideId = resolved.activeUnit?.slideId || null;
  queueEntry.bible.currentSlideId = queueEntry.currentSlideId;
  return [queueEntry];
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

async function sendBibleTextToOutput(entry = bibleDesignerState, expectedRevision = null) {
  const resolvedEntry = await bibleEntryWithLookupText(entry);
  if (expectedRevision !== null && !scripturePresentation.isCurrentRevision(expectedRevision)) {
    return false;
  }
  await waitForScriptureFonts(resolvedEntry);
  if (expectedRevision !== null && !scripturePresentation.isCurrentRevision(expectedRevision)) {
    return false;
  }
  if (appliedPresentationTheme) {
    const outputSize = selectedBiblePreviewOutputSize("dspSelct");
    const resolvedTheme = resolveThemeForTarget({
      theme: appliedPresentationTheme,
      contentKind: "scripture",
      outputRole: "audience",
      outputSize,
    });
    await waitForTextFonts([resolvedTheme.typography?.fontFamily], {
      documentRef: globalThis.document,
      sample: cleanBibleVerseTextForDisplay(resolvedEntry.text) || "EMS",
      fontSize: resolvedTheme.typography?.fontSize || resolvedEntry.fontSize,
    });
    if (expectedRevision !== null && !scripturePresentation.isCurrentRevision(expectedRevision)) {
      return false;
    }
  }
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
  sendAudienceTextMessage("bible", message);
  return true;
}

function isPresentationActiveForBibleLowerThird() {
  return Boolean(
    isQueuePresentationActive() ||
      isActiveMediaWindow() ||
      isLocalAppWindowPresentationActive() ||
      isPlaying ||
      bibleLowerThirdOutputActive,
  );
}

async function waitForBibleLowerThirdFonts(entry = bibleDesignerState) {
  const outputSize = selectedBiblePreviewOutputSize("lowerThirdDspSelct");
  const themedFont = appliedPresentationTheme
    ? resolveThemeForTarget({
        theme: appliedPresentationTheme,
        contentKind: "scripture",
        outputRole: "lowerThird",
        outputSize,
      }).typography?.fontFamily
    : "";
  await waitForTextFonts(
    [themedFont, entry.lowerThirdFontFamily, entry.fontFamily].filter(Boolean),
    {
      documentRef: globalThis.document,
      sample: cleanBibleVerseTextForDisplay(entry.text) || "EMS",
      fontSize: entry.lowerThirdFontSize || entry.fontSize || SCRIPTURE_BODY_FONT_SIZE,
    },
  );
}

function buildBibleLowerThirdOutputMessage(entry = bibleDesignerState) {
  const message = {
    ...buildBibleTextMessage(entry, { look: SCRIPTURE_LOOK_LOWER_THIRD }),
    outputRole: "lower-third",
    backgroundImage: "",
    backgroundVideo: "",
    backgroundPath: "",
  };
  return themeLowerThirdMessageIfApplied(message, "scripture");
}

function sendBibleLowerThirdTextMessage(message, options = {}) {
  const remember = options.remember !== false;
  const clearToggle = options.clearToggle !== false;
  const applyClearState = shouldApplyLiveTextClearState("lower-third", options);
  if (remember) {
    setSharedRendererState({ lastLowerThirdBibleTextMessage: { ...message } });
  }
  send("update-lower-third-text", audienceTextMessageForSend("lower-third", message, options));
  syncConfidenceMonitorCarousel();
  syncLowerThirdRendererPreviewCapture();
  if (clearToggle && !applyClearState) {
    setSharedRendererState({ liveTextClearActive: false });
  }
  updateClearLiveTextButtonState();
}

async function sendBibleLowerThirdTextToOutput(
  entry = bibleDesignerState,
  updateToken,
  expectedRevision = null,
) {
  if (!isBibleLowerThirdFeatureEnabled()) return;
  const token = updateToken ?? nextLowerThirdOutputUpdateToken();
  await waitForBibleLowerThirdFonts(entry);
  if (token !== lowerThirdOutputUpdateToken) return false;
  if (expectedRevision !== null && !scripturePresentation.isCurrentRevision(expectedRevision)) {
    return false;
  }
  const message = buildBibleLowerThirdOutputMessage(entry);
  sendBibleLowerThirdTextMessage(message);
  setSharedRendererState({ activeLowerThirdContentType: "bible" });
  setSharedRendererState({ bibleLowerThirdLiveCueKey: bibleLowerThirdCueKey(message.lowerThirdSegmentIndex, entry) });
  songLowerThirdState.liveKey = "";
  renderSongLowerThirdControls();
  syncBibleLookControls(message);
}

async function showCuedBibleLowerThird() {
  if (!hasLowerThirdOutputSelected()) {
    showGnomeToast("Choose a lower-third output display");
    return false;
  }
  if (!isPresentationActiveForBibleLowerThird()) {
    if (!hasAudienceOutputSelected()) {
      showGnomeToast("Choose an audience output display");
      return false;
    }
    const started = await showBibleTextNow();
    if (started) showGnomeToast("Audience and lower third shown");
    return started;
  }
  await syncBibleStateFromControls();
  const resolvedEntry = await bibleEntryWithLookupText(bibleDesignerState);
  if (resolvedEntry && resolvedEntry !== bibleDesignerState) {
    Object.assign(bibleDesignerState, resolvedEntry);
  }
  const wasActive = bibleLowerThirdOutputActive;
  if (wasActive) {
    await sendBibleLowerThirdTextToOutput(bibleDesignerState);
  } else if (!(await ensureBibleLowerThirdOutput(bibleDesignerState))) {
    return false;
  }
  showGnomeToast(wasActive ? "Lower third updated" : "Lower third shown");
  return true;
}

async function liveBibleAudienceTextMessageForClear() {
  const liveItem = currentLiveQueueItem();
  if (isQueueItemBible(liveItem)) {
    const entry = await resolvedBibleEntryForItem(liveItem);
    return buildBibleTextMessage(entry, { look: SCRIPTURE_LOOK_FULLSCREEN });
  }
  if (lastAudienceBibleTextMessage) return lastAudienceBibleTextMessage;
  const entry = await currentBibleTextOnlyEntry();
  return entry
    ? buildBibleTextMessage(bibleEntryWithShowNowStyle(entry).bible, {
        look: SCRIPTURE_LOOK_FULLSCREEN,
      })
    : null;
}

async function clearLiveBibleText({ quiet = false } = {}) {
  const audienceLive = hasLiveAudienceTextPresentation("bible");
  const lowerThirdLive = hasLiveLowerThirdText("bible");
  if (!audienceLive && !lowerThirdLive) {
    if (!quiet) showGnomeToast("No Bible text is live");
    return false;
  }

  let cleared = false;
  if (audienceLive) {
    const message = await liveBibleAudienceTextMessageForClear();
    if (message) {
      const clearedMessage = clearTextFromPresentationMessage(message);
      sendAudienceTextMessage("bible", clearedMessage, {
        remember: false,
        clearToggle: false,
      });
      cleared = true;
    }
  }
  if (lowerThirdLive) {
    const sourceMessage =
      lastLowerThirdBibleTextMessage ||
      (await waitForBibleLowerThirdFonts(bibleDesignerState),
      buildBibleLowerThirdOutputMessage(bibleDesignerState));
    const clearedMessage = clearTextFromPresentationMessage({
      ...sourceMessage,
      outputRole: "lower-third",
    });
    sendBibleLowerThirdTextMessage(clearedMessage, {
      remember: false,
      clearToggle: false,
    });
    cleared = true;
  }

  if (cleared) {
    if (!quiet) showGnomeToast("Bible text cleared");
    return true;
  }
  if (!quiet) showGnomeToast("Could not clear Bible text");
  return false;
}

async function restoreLiveBibleText({ quiet = false } = {}) {
  const audienceLive = hasLiveAudienceTextPresentation("bible");
  const lowerThirdLive = hasLiveLowerThirdText("bible");
  if (!audienceLive && !lowerThirdLive) {
    if (!quiet) showGnomeToast("No Bible text is live");
    return false;
  }

  let restored = false;
  if (audienceLive) {
    const message =
      lastAudienceBibleTextMessage || (await liveBibleAudienceTextMessageForClear());
    if (message) {
      sendAudienceTextMessage("bible", message, { respectLiveTextClearState: false });
      restored = true;
    }
  }
  if (lowerThirdLive) {
    const message = {
      ...(lastLowerThirdBibleTextMessage ||
        (await waitForBibleLowerThirdFonts(bibleDesignerState),
        buildBibleLowerThirdOutputMessage(bibleDesignerState))),
      outputRole: "lower-third",
    };
    sendBibleLowerThirdTextMessage(message, { respectLiveTextClearState: false });
    restored = true;
  }

  if (restored) {
    if (!quiet) showGnomeToast("Bible text restored");
    return true;
  }
  if (!quiet) showGnomeToast("Could not restore Bible text");
  return false;
}

async function closeBibleLowerThirdOutput() {
  scripturePresentation.dispatch({
    type: "OUTPUT_STATUS_CHANGED",
    output: "lowerThird",
    status: "closed",
  });
  nextLowerThirdOutputUpdateToken();
  setSharedRendererState({ bibleLowerThirdOutputActive: false });
  setSharedRendererState({ activeLowerThirdContentType: null });
  setSharedRendererState({ bibleLowerThirdLiveCueKey: "" });
  setSharedRendererState({ lastLowerThirdBibleTextMessage: null });
  songLowerThirdState.liveKey = "";
  stopLowerThirdRendererPreviewCapture();
  syncConfidenceMonitorCarousel();
  renderSongLowerThirdControls();
  updateClearLiveTextButtonState();
  try {
    return await invoke("close-lower-third-window-now");
  } catch (err) {
    console.error("Failed to close lower third output:", err);
    return false;
  }
}

async function ensureBibleLowerThirdOutput(entry = bibleDesignerState, expectedRevision = null) {
  if (!isBibleLowerThirdFeatureEnabled()) {
    return false;
  }
  const displayValue = selectedDisplayValueFromSelect("lowerThirdDspSelct");
  if (!displayValue) {
    return false;
  }
  const alreadyOpen = bibleLowerThirdOutputActive;
  const updateToken = nextLowerThirdOutputUpdateToken();
  await waitForBibleLowerThirdFonts(entry);
  if (updateToken !== lowerThirdOutputUpdateToken) return false;
  if (expectedRevision !== null && !scripturePresentation.isCurrentRevision(expectedRevision)) {
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
      preload: `${__dirname}/../media-window/media_preload.min.js`,
      devTools: true,
    },
  };
  try {
    const windowId = await invoke("create-lower-third-window", windowOptions, displayValue);
    setSharedRendererState({ bibleLowerThirdOutputActive: Boolean(windowId) });
    updateClearLiveTextButtonState();
    if (updateToken !== lowerThirdOutputUpdateToken) {
      if (bibleLowerThirdOutputActive) {
        sendBibleLowerThirdTextMessage(lowerThirdKeyOnlyMessage(
          message,
          message.chromaKeyColor || SCRIPTURE_LOWER_THIRD_CHROMA_KEY_COLOR,
        ), { remember: false, clearToggle: false, respectLiveTextClearState: false });
      }
      return false;
    }
    if (expectedRevision !== null && !scripturePresentation.isCurrentRevision(expectedRevision)) {
      return false;
    }
    if (bibleLowerThirdOutputActive) {
      if (alreadyOpen) {
        await sendBibleLowerThirdTextToOutput(entry, updateToken, expectedRevision);
      } else {
        window.setTimeout(() => {
          if (updateToken !== lowerThirdOutputUpdateToken) return;
          if (expectedRevision !== null && !scripturePresentation.isCurrentRevision(expectedRevision)) return;
          void sendBibleLowerThirdTextToOutput(entry, updateToken, expectedRevision);
        }, 100);
      }
    }
    return bibleLowerThirdOutputActive;
  } catch (err) {
    console.error("Failed to create lower third output:", err);
    showGnomeToast("Failed to open lower third output");
    setSharedRendererState({ bibleLowerThirdOutputActive: false });
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
      lowerThirdFontFamily: "",
      lowerThirdFontSize: undefined,
      lowerThirdBarBackgroundColor: "",
      lowerThirdBarBackgroundPath: "",
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
    lowerThirdFontFamily:
      typeof overrides.lowerThirdFontFamily === "string"
        ? overrides.lowerThirdFontFamily
        : "",
    lowerThirdFontSize:
      Number.isFinite(overrides.lowerThirdFontSize)
        ? overrides.lowerThirdFontSize
        : undefined,
    lowerThirdBarBackgroundColor:
      typeof overrides.lowerThirdBarBackgroundColor === "string"
        ? overrides.lowerThirdBarBackgroundColor
        : "",
    lowerThirdBarBackgroundPath:
      typeof overrides.lowerThirdBarBackgroundPath === "string"
        ? overrides.lowerThirdBarBackgroundPath
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
    !normalized.lowerThirdChromaKeyColor &&
    !normalized.lowerThirdFontFamily &&
    !Number.isFinite(normalized.lowerThirdFontSize) &&
    !normalized.lowerThirdBarBackgroundColor &&
    !normalized.lowerThirdBarBackgroundPath
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
      lowerThirdFontFamily: normalized.lowerThirdFontFamily || undefined,
      lowerThirdFontSize: Number.isFinite(normalized.lowerThirdFontSize)
        ? normalized.lowerThirdFontSize
        : undefined,
      lowerThirdBarBackgroundColor: normalized.lowerThirdBarBackgroundColor || undefined,
      lowerThirdBarBackgroundPath: normalized.lowerThirdBarBackgroundPath || "",
      lowerThirdBarBackgroundAssetId: undefined,
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
    lowerThirdFontFamily:
      typeof presentation.lowerThirdFontFamily === "string"
        ? presentation.lowerThirdFontFamily
        : "",
    lowerThirdFontSize:
      Number.isFinite(presentation.lowerThirdFontSize)
        ? presentation.lowerThirdFontSize
        : undefined,
    lowerThirdBarBackgroundColor:
      typeof presentation.lowerThirdBarBackgroundColor === "string"
        ? presentation.lowerThirdBarBackgroundColor
        : "",
    lowerThirdBarBackgroundPath:
      typeof presentation.lowerThirdBarBackgroundPath === "string"
        ? presentation.lowerThirdBarBackgroundPath
        : "",
  });
}

function bibleBackgroundDisplayName(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return "Choose Background…";
  return queueBasename(filePath) || "Selected Background";
}

function bibleLowerThirdBarBackgroundDisplayName(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return "Choose Bar Graphic…";
  return queueBasename(filePath) || "Selected Bar Graphic";
}

function syncBibleLowerThirdBarBackgroundLabel(filePath = bibleDesignerState.lowerThirdBarBackgroundPath) {
  const label = document.getElementById("bibleLowerThirdBarBackgroundLabel");
  if (label) label.textContent = bibleLowerThirdBarBackgroundDisplayName(filePath);
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
    currentSlideId:
      item?.currentSlideId ||
      item?.bible?.currentSlideId ||
      null,
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
      lowerThirdPreferenceChromaKeyColor,
    lowerThirdFontFamily:
      projectScriptureOverrides.lowerThirdFontFamily || "",
    lowerThirdFontSize: Number.isFinite(projectScriptureOverrides.lowerThirdFontSize)
      ? projectScriptureOverrides.lowerThirdFontSize
      : SCRIPTURE_LOWER_THIRD_DEFAULT_FONT_SIZE,
    lowerThirdBarBackgroundColor:
      projectScriptureOverrides.lowerThirdBarBackgroundColor ||
      SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND,
    lowerThirdBarBackgroundPath:
      projectScriptureOverrides.lowerThirdBarBackgroundPath || "",
    look: SCRIPTURE_DEFAULT_LOOK,
    lowerThirdSegmentIndex: 0,
    currentLowerThirdSlideId: null,
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
    currentSlideId:
      typeof source.currentSlideId === "string" ? source.currentSlideId : null,
    currentLowerThirdSlideId:
      typeof source.currentLowerThirdSlideId === "string"
        ? source.currentLowerThirdSlideId
        : null,
  };
  if (selectedVerses.length > 0) result.selectedVerses = selectedVerses;
  if (source.itemTheme && typeof source.itemTheme === "object") {
    result.itemTheme = normalizeItemTheme(source.itemTheme);
  }
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
    lowerThirdSegmentIndex: Number.isFinite(entry?.lowerThirdSegmentIndex)
      ? Math.max(0, Math.trunc(entry.lowerThirdSegmentIndex))
      : 0,
    currentLowerThirdSlideId:
      typeof entry?.currentLowerThirdSlideId === "string"
        ? entry.currentLowerThirdSlideId
        : null,
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
  if (!["live", "taking"].includes(scripturePresentation.state.status)) {
    const targetIndex = currentBibleEditorTargetIndex();
    const targetItem = targetIndex >= 0 ? mediaQueue[targetIndex] : null;
    const audienceMessage = buildBibleTextMessage(bibleDesignerState, {
      look: SCRIPTURE_LOOK_FULLSCREEN,
    });
    const cursor = scriptureCursorFromPresentation(audienceMessage.resolvedPresentation);
    scripturePresentation.dispatch({
      type: "SOURCE_PREVIEWED",
      source: scripturePresentationSource(bibleDesignerState, {
        item: targetItem,
        scheduleIndex: targetIndex,
      }),
      cursor,
    });
  }
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
  bibleDesignerState.fontFamilyOverride = true;
  bibleStyleDirtyState.fontFamily = false;

  let changedCount = 0;
  mediaQueue.forEach((item) => {
    if (!isQueueItemBible(item)) return;
    const entry = resolveBibleQueueItemEntryShallow(item);
    item.bible = {
      ...(entry || item.bible || {}),
      fontFamily: style.fontFamily,
      fontFamilyOverride: true,
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
    fontFamilyOverride: style.fontFamilyOverride === true,
    fontSize: style.fontSize,
    autosizeMode: style.autosizeMode,
    minFontSize: style.minFontSize,
    autoSplit: style.autoSplit,
    color: style.color,
    backgroundColor: style.backgroundColor,
    backgroundPath: style.backgroundPath,
    lowerThirdColor: style.lowerThirdColor,
    lowerThirdChromaKeyColor: style.lowerThirdChromaKeyColor,
    lowerThirdFontFamily: style.lowerThirdFontFamily,
    lowerThirdFontFamilyOverride: style.lowerThirdFontFamilyOverride === true,
    lowerThirdFontSize: style.lowerThirdFontSize,
    lowerThirdBarBackgroundColor: style.lowerThirdBarBackgroundColor,
    lowerThirdBarBackgroundPath: style.lowerThirdBarBackgroundPath,
  };
}

function applyBibleStylePayloadToEntry(entry, style) {
  return {
    ...(entry || {}),
    ...style,
    autosizeGroupFontSize: undefined,
    autosizeGroupScope: "",
    lowerThirdSegmentIndex: 0,
    currentLowerThirdSlideId: null,
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
  bibleStyleDirtyState.lowerThirdFontFamily = false;
  bibleStyleDirtyState.lowerThirdFontSize = false;
  bibleStyleDirtyState.lowerThirdBarBackgroundColor = false;
  bibleStyleDirtyState.lowerThirdBarBackgroundPath = false;
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

async function saveBibleTextLayoutDefaults() {
  await syncBibleStateFromControls();
  const style = bibleCurrentStylePayload();
  Object.assign(projectScriptureOverrides, {
    autosizeMode: style.autosizeMode,
    minFontSize: style.minFontSize,
    autoSplit: style.autoSplit,
  });
  bibleStyleDirtyState.autosizeMode = false;
  bibleStyleDirtyState.minFontSize = false;
  bibleStyleDirtyState.autoSplit = false;
  applyBiblePreview(bibleDesignerState, { show: false });
  void saveCurrentProjectInStorageMode({ quiet: true });
  showGnomeToast("Text layout defaults updated");
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
  const audienceLive = isBibleShowNowLiveMode();
  const lowerThirdLive = hasLowerThirdOutputSelected();
  const presentationRevision = beginScriptureTake(transientEntry.bible, {
    audience: audienceLive,
    lowerThird: lowerThirdLive,
  });
  let audienceUpdated = false;
  let lowerThirdUpdated = false;
  if (isBibleShowNowLiveMode()) {
    audienceUpdated = await sendBibleTextToOutput(
      transientEntry.bible,
      presentationRevision,
    );
  }
  if (hasLowerThirdOutputSelected()) {
    lowerThirdUpdated = await ensureBibleLowerThirdOutput(
      transientEntry.bible,
      presentationRevision,
    );
  }
  confirmScriptureTake(presentationRevision, {
    audience: audienceUpdated === true,
    lowerThird: lowerThirdUpdated === true,
  });
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
  const previousQueueIndex = currentQueueIndex;
  try {
    setSharedRendererState({ mediaPlaybackEndedPending: false });
    setSharedRendererState({ pendingQueueSwitchIndex: null });
    setSharedRendererState({ pendingQueueSwitchStartTime: 0 });
    setSharedRendererState({ userStopPresentationPending: false });
    setSharedRendererState({ currentQueueIndex: -1 });
    const presentationRevision = beginScriptureTake(transientEntry.bible, {
      audience: wantsAudience,
      lowerThird: wantsLowerThird,
    });
    const lowerThirdStarted = wantsLowerThird
      ? await ensureBibleLowerThirdOutput(transientEntry.bible, presentationRevision)
      : false;
    if (wantsAudience && isActiveMediaWindow()) {
      const didSlipstream = await slipstreamBiblePresentation(
        transientEntry.bible,
        presentationRevision,
      );
      if (didSlipstream) {
        setSharedRendererState({ isPlaying: true });
        setSharedRendererState({ isQueuePlaying: false });
        setSharedRendererState({ bibleShowNowModeActive: true });
        clearSongShowNowPresentation();
        updateDynUI();
        renderQueue();
        rememberRecentScripture(entry.bible);
        confirmScriptureTake(presentationRevision, {
          audience: true,
          lowerThird: lowerThirdStarted,
        });
        return true;
      }
    }
    const audienceStarted = wantsAudience
      ? await createMediaWindow({
          textItem: transientEntry,
          transientText: true,
          presentationRevision,
        })
      : false;
    if (!audienceStarted && !lowerThirdStarted) {
      confirmScriptureTake(presentationRevision, {
        audience: false,
        lowerThird: false,
      });
      setSharedRendererState({ currentQueueIndex: previousQueueIndex });
      renderQueue();
      showGnomeToast("No Bible output started");
      return false;
    }
    setSharedRendererState({ activeMediaWindowContentType: audienceStarted ? "bible" : null });
    setSharedRendererState({ isPlaying: true });
    setSharedRendererState({ isQueuePlaying: false });
    setSharedRendererState({ bibleShowNowModeActive: true });
    clearSongShowNowPresentation();
    setSharedRendererState({ isActiveMediaWindowCache: audienceStarted });
    updateDynUI();
    renderQueue();
    rememberRecentScripture(entry.bible);
    confirmScriptureTake(presentationRevision, {
      audience: audienceStarted,
      lowerThird: lowerThirdStarted,
    });
    return true;
  } catch (err) {
    console.error("Failed to show Bible text:", err);
    showGnomeToast("Failed to show Bible text");
    return false;
  }
}

async function slipstreamBiblePresentation(entry, expectedRevision = null) {
  const textPayload = audienceTextMessageForSend(
    "bible",
    buildBibleTextMessage(entry, { look: SCRIPTURE_LOOK_FULLSCREEN }),
  );
  const slipstreamSuccess = await invoke("slipstream-media-window", {
    isText: true,
    mediaFile: bibleQueuePath(entry.reference, entry.version),
    textPayload,
  });
  if (!slipstreamSuccess) return false;
  if (expectedRevision !== null && !scripturePresentation.isCurrentRevision(expectedRevision)) {
    return false;
  }
  setSharedRendererState({ activeMediaWindowContentType: "bible" });
  await sendBibleTextToOutput(entry, expectedRevision);
  return true;
}

async function syncLiveBiblePresentation() {
  const audienceLive = isActiveMediaWindow() && activeMediaWindowContentType === "bible";
  if (!audienceLive && !bibleLowerThirdOutputActive && !hasLowerThirdOutputSelected()) {
    return false;
  }
  const expectedRevision = ["live", "taking"].includes(scripturePresentation.state.status)
    ? scripturePresentation.state.revision
    : null;
  const targetIsLiveItem = isBibleEditorTargetLiveItem();
  const entry = targetIsLiveItem ? await currentBibleQueueEntry() : await currentBibleTextOnlyEntry();
  if (!entry) return false;
  if (
    expectedRevision !== null &&
    !scripturePresentation.isCurrentRevision(expectedRevision)
  ) {
    return false;
  }
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
    await sendBibleTextToOutput(entry.bible, expectedRevision);
  }
  if (hasLowerThirdOutputSelected()) {
    await ensureBibleLowerThirdOutput(entry.bible, expectedRevision);
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
  rememberRecentScripture(entry.bible);
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
  rememberRecentScripture(entry.bible);
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
  rememberRecentScripture({
    reference: referenceForBibleVerseNumbers(
      bibleDesignerState.book,
      bibleDesignerState.chapter,
      versesToSchedule,
    ),
    version: bibleDesignerState.version,
  });
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
  const lowerThirdFontInput = document.getElementById("bibleLowerThirdFontInput");
  const lowerThirdFontSizeInput = document.getElementById("bibleLowerThirdFontSizeInput");
  const lowerThirdBarBackgroundInput = document.getElementById("bibleLowerThirdBarBackgroundColorInput");
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
  if (lowerThirdFontInput) {
    const lowerThirdFontValue =
      bibleDesignerState.lowerThirdFontFamily ||
      bibleDesignerState.fontFamily ||
      SCRIPTURE_FONT_FAMILY;
    if (
      lowerThirdFontInput instanceof HTMLSelectElement &&
      !Array.from(lowerThirdFontInput.options).some((option) => option.value === lowerThirdFontValue)
    ) {
      const option = document.createElement("option");
      option.value = lowerThirdFontValue;
      option.textContent = lowerThirdFontValue.replace(/^['"]|['"]$/g, "");
      lowerThirdFontInput.appendChild(option);
    }
    lowerThirdFontInput.value = lowerThirdFontValue;
  }
  if (lowerThirdFontSizeInput) {
    lowerThirdFontSizeInput.value = Number.isFinite(bibleDesignerState.lowerThirdFontSize)
      ? bibleDesignerState.lowerThirdFontSize
      : SCRIPTURE_LOWER_THIRD_DEFAULT_FONT_SIZE;
  }
  if (lowerThirdBarBackgroundInput) {
    lowerThirdBarBackgroundInput.value =
      bibleDesignerState.lowerThirdBarBackgroundColor || SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND;
  }
  syncBibleLowerThirdBarBackgroundLabel();
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

    list.addEventListener("dragstart", (event) => {
      const button = event.target.closest(".bible-verse-row");
      if (!button || !list.contains(button)) return;
      const verseNumber = Number(button.dataset.verse);
      if (!Number.isFinite(verseNumber) || verseNumber < 1) {
        event.preventDefault();
        return;
      }
      if (!bibleVerseSelection.verses.has(verseNumber)) {
        bibleVerseSelection.verses.clear();
        bibleVerseSelection.verses.add(verseNumber);
        bibleVerseSelection.anchor = verseNumber;
      }
      const selectedVerses = selectedBibleVerseNumbers();
      bibleDesignerState.verse = selectedVerses[0] || verseNumber;
      bibleDesignerState.verseEnd =
        selectedVerses.length > 1 ? selectedVerses[selectedVerses.length - 1] : 0;
      syncBibleVerseListSelection();

      const payload = buildBibleVerseDragPayload();
      if (!payload) {
        event.preventDefault();
        return;
      }
      bibleVerseDragPayload = payload;
      hideBibleTextContextMenu();
      button.classList.add("bible-verse-row--dragging");
      event.dataTransfer.setData(BIBLE_VERSE_DRAG_MIME, JSON.stringify(payload));
      event.dataTransfer.setData(
        "text/plain",
        referenceForBibleVerseNumbers(payload.book, payload.chapter, payload.verses),
      );
      event.dataTransfer.effectAllowed = "copy";
    });

    list.addEventListener("dragend", () => {
      clearBibleVerseDragVisualState();
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
    button.draggable = true;
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

async function openBibleWorkspaceFromButton() {
  if (!bibleUiEnabled) return;
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

  await selectFirstBibleReferenceForVersion(bibleDesignerState.version);

  syncBibleSelectorsFromState();
  await jumpBibleReferenceToBrowser();
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

function hideScheduleBibleContextMenu() {
  document.getElementById("scheduleBibleContextMenu")?.setAttribute("hidden", "");
}

function ensureScheduleBibleContextMenu() {
  let menu = document.getElementById("scheduleBibleContextMenu");
  if (menu) return menu;

  menu = document.createElement("div");
  menu.id = "scheduleBibleContextMenu";
  menu.className = "song-context-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  menu.innerHTML = `
    <button type="button" role="menuitem" data-schedule-bible-action="edit">Edit</button>
    <button type="button" role="menuitem" data-schedule-bible-action="theme">Theme and Style…</button>
    <button type="button" role="menuitem" data-schedule-bible-action="split">Split into Verses</button>
  `;

  menu.addEventListener("pointerdown", (event) => event.stopPropagation());
  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    const button = event.target.closest("[data-schedule-bible-action]");
    if (!button) return;
    const index = menu._queueIndex;
    hideScheduleBibleContextMenu();
    const action = button.getAttribute("data-schedule-bible-action");
    if (action === "edit") {
      void loadQueueItemIntoPreviewCue(index)
        .then(() => setBibleStyleEditorVisible(true))
        .catch((err) => {
          console.error("Failed to open scheduled Bible text for editing:", err);
          showGnomeToast("Failed to open Bible text editor");
        });
    } else if (action === "theme") {
      void openThemeManagerForQueueItem(index);
    } else if (action === "split") {
      void splitScheduledBiblePassageIntoVerses(index).catch(console.error);
    }
  });

  document.body.appendChild(menu);
  if (document.body.dataset.scheduleBibleContextMenuBound !== "1") {
    document.body.dataset.scheduleBibleContextMenuBound = "1";
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (event.target.closest?.("#scheduleBibleContextMenu")) return;
        hideScheduleBibleContextMenu();
      },
      true,
    );
    window.addEventListener("resize", hideScheduleBibleContextMenu);
    window.addEventListener("scroll", hideScheduleBibleContextMenu, true);
  }
  return menu;
}

function scheduledBibleItemHasMultipleVerses(item) {
  const entry = resolveBibleQueueItemEntryShallow(item);
  if (!entry) return false;
  if (bibleSelectedVersesForEntry(entry).length > 1) return true;
  return verseNumbersFromSelector(
    verseSelectorFromReference(entry.reference),
    500,
  ).length > 1;
}

function showScheduleBibleContextMenu(event, index) {
  event.preventDefault();
  event.stopPropagation();
  hideScheduleSongContextMenu();
  const menu = ensureScheduleBibleContextMenu();
  const splitButton = menu.querySelector('[data-schedule-bible-action="split"]');
  if (splitButton) {
    const canSplit = scheduledBibleItemHasMultipleVerses(mediaQueue[index]);
    splitButton.hidden = !canSplit;
    splitButton.style.display = canSplit ? "" : "none";
  }
  menu._queueIndex = index;
  menu.hidden = false;
  menu.style.left = "0px";
  menu.style.top = "0px";
  const menuRect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(event.clientX, window.innerWidth - menuRect.width - 8));
  const top = Math.max(8, Math.min(event.clientY, window.innerHeight - menuRect.height - 8));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

async function splitScheduledBiblePassageIntoVerses(index) {
  if (!queueIndexInRange(index) || !isQueueItemBible(mediaQueue[index])) return false;
  if (index === currentQueueIndex && isQueuePresentationActive()) {
    showGnomeToast("Stop the presentation to split the current item");
    return false;
  }

  const originalItem = mediaQueue[index];
  const entry = await resolvedBibleEntryForItem(originalItem);
  const rows = await bibleVerseRowsForEntry(entry);
  if (rows.length <= 1) return false;

  const splitEntries = normalizeBibleScheduleEntryGroup(
    rows.map((row) => bibleEntryForVerseRows(entry, [row])),
  ).map((verseEntry) => ({
    ...queueEntryFromBibleEntry(verseEntry),
    autoAdvance: originalItem.autoAdvance !== false,
  }));
  if (splitEntries.length <= 1) return false;

  invalidateQueueUndoToastAfterMutation();
  mediaQueue.splice(index, 1, ...splitEntries);
  shiftQueueIndexesForInsertion(index + 1, splitEntries.length - 1);
  setSelectedQueueAnchor(index);
  renderQueue();
  saveMediaFile();
  showGnomeToast(`Split into ${splitEntries.length} Bible verses`);
  return true;
}

export {
  BIBLE_RECENT_LIMIT,
  BIBLE_RECENT_STORAGE_KEY,
  BIBLE_VERSE_DRAG_MIME,
  DEFAULT_BIBLE_VERSION,
  LAST_BIBLE_VERSION_SETTING_KEY,
  addEachSelectedBibleVerseToSchedule,
  addSelectedBibleVersesToSchedule,
  advanceBibleDesignerToNextVerse,
  advanceBibleLowerThirdCursor,
  advanceToNextScheduledBibleText,
  applyBibleBackgroundToAllProjectText,
  applyBibleFontSizeToAllProjectText,
  applyBibleFontToAllProjectText,
  applyBiblePreview,
  applyBibleReferenceSuggestion,
  applyBibleSearchResult,
  applyBibleStylePayloadToEntry,
  applyBibleStyleToCurrentText,
  applyBibleStyleToScheduledText,
  applyBibleTextColorToAllProjectText,
  applySelectedBibleVersePreview,
  beginScriptureTake,
  bibleAttributionFooterText,
  bibleAttributionForResult,
  bibleAttributionForVersion,
  bibleAttributionText,
  bibleAutosizeGroupScope,
  bibleBackgroundDisplayName,
  bibleBookAbbreviationCache,
  bibleBookAbbreviationCacheLoading,
  bibleBookAbbreviationSync,
  bibleCurrentStylePayload,
  bibleDesignerState,
  bibleEntryForSingleVerse,
  bibleEntryForVerseRows,
  bibleEntryFromSelectedVerses,
  bibleEntryFromVerseDragPayload,
  bibleEntryMatchesQueueItem,
  bibleEntryMatchesQueueItemShallow,
  bibleEntryTextForVerseRows,
  bibleEntryWithLookupText,
  bibleEntryWithShowNowStyle,
  bibleLowerThirdBarBackgroundDisplayName,
  bibleLowerThirdCueKey,
  bibleLowerThirdPreviewSourceKey,
  biblePreviewMirrorsLiveOutput,
  biblePreviewRenderToken,
  bibleQueueItemBaseEntry,
  bibleQueueItemDisplayName,
  bibleRecentScriptures,
  bibleReferenceAllBooks,
  bibleReferenceSuggestionsForInput,
  bibleSearchResultKey,
  bibleSearchScopeVersion,
  bibleSearchState,
  bibleSearchTimer,
  bibleSelectedVersesForEntry,
  bibleStyleDirtyState,
  bibleVerseDragPayload,
  bibleVerseDragPayloadFromDataTransfer,
  bibleVerseListRequestId,
  bibleVerseNumberIsSelected,
  bibleVersePreviewTimer,
  bibleVerseRowsForEntry,
  bibleVerseSelection,
  bibleVersionIsInstalled,
  bibleVersionMetadata,
  bibleVersionMetadataByKey,
  browseCurrentBibleChapter,
  browseFromBibleSearchResult,
  buildBibleLowerThirdOutputMessage,
  buildBibleTextMessage,
  buildBibleVerseDragPayload,
  cancelBibleVersePreviewSync,
  centerBibleVerseRowInList,
  changeBibleLowerThirdSegment,
  cleanBibleVerseTextForDisplay,
  clearBibleSearchTimer,
  clearBibleStyleDirtyState,
  clearBibleVerseDragVisualState,
  clearLiveBibleText,
  clearRecentScriptures,
  closeBibleLowerThirdOutput,
  collapseBibleDisplayLineWhitespace,
  commitBibleDesignerRenderState,
  confirmScriptureTake,
  currentBibleEditorTargetIndex,
  currentBibleEditorTargetItem,
  currentBibleQueueEntry,
  currentBibleScheduleOutputSize,
  currentBibleTextOnlyEntry,
  ensureBibleLowerThirdOutput,
  ensureBibleTextContextMenu,
  ensureRecentScriptureContextMenu,
  ensureScheduleBibleContextMenu,
  ensureScriptureScheduleItemId,
  fallbackUnavailableBibleTranslationsOnLoad,
  findNextScheduledBibleTextIndex,
  firstBibleReferenceForVersion,
  hideBibleReferenceSuggestions,
  hideBibleTextContextMenu,
  hideRecentScriptureContextMenu,
  hideScheduleBibleContextMenu,
  hydrateBibleEntryStyle,
  insertBibleInSchedule,
  isBibleEditorShowOnlyTextMode,
  isBibleEditorTargetLiveItem,
  isBiblePresentationActive,
  isBibleReferenceSuggestionsOpen,
  isBibleShowNowLiveMode,
  isBibleWorkspaceVisible,
  isPresentationActiveForBibleLowerThird,
  isScheduledBiblePresentationActive,
  isScripturePresentationLive,
  jumpBibleReferenceToBrowser,
  liveBibleAudienceTextMessageForClear,
  loadBibleEntryIntoEditor,
  loadBibleVersionMetadataFromSidecar,
  loadRecentScriptures,
  lookupBibleReference,
  nextBibleVerseEntryFromDesigner,
  normalizeBibleReferenceInput,
  normalizeBibleScheduleEntryGroup,
  normalizeBibleVerseDragPayload,
  normalizeBibleVersionMetadata,
  normalizeProjectScriptureOverrides,
  normalizedProjectBibleSelectedVerses,
  normalizedProjectBibleVersion,
  openBibleWorkspaceFromButton,
  openRecentScripture,
  overridesFromProjectScriptureText,
  parseBibleQueuePath,
  persistBibleLowerThirdCueState,
  persistBibleVersion,
  persistRecentScriptures,
  positionBibleReferenceSuggestionsOverlay,
  presentBibleSelectionFromDoubleClick,
  projectBibleQueueName,
  projectBibleReferenceEntryForQueueItem,
  projectBibleReferenceOnlyEntry,
  projectScriptureOverrides,
  projectScriptureTextFromOverrides,
  queueEntriesForBibleScheduleEntry,
  queueEntriesForBibleVerseDragPayload,
  queueEntryFromBibleEntry,
  readStoredBibleVersion,
  reconcileBibleBrowseView,
  referenceForBibleVerseNumbers,
  referenceForSelectedBibleVerses,
  refreshBibleBrowser,
  refreshBibleLookupPreview,
  rememberRecentScripture,
  renderBibleLowerThirdCueList,
  renderBibleReferenceSuggestions,
  renderBibleSearchPlaceholder,
  renderBibleSearchResults,
  renderBibleSlideNavigator,
  renderBibleVerseList,
  renderRecentScriptures,
  requestBibleBookAbbreviationCache,
  resolveBibleQueueItemEntry,
  resolveBibleQueueItemEntryShallow,
  resolveStoredBibleVersion,
  resolvedBibleEntryForItem,
  resolvedBibleStyleDefaults,
  restoreBibleVersionFromSettings,
  restoreLiveBibleText,
  runBibleSearch,
  saveBibleTextLayoutDefaults,
  scheduleBibleSearch,
  scheduleSelectedBibleVersePreview,
  scheduledBibleItemHasMultipleVerses,
  scriptureCursorFromPresentation,
  scripturePresentation,
  scripturePresentationSource,
  scrollBibleViewerToCurrentVerse,
  selectFirstBibleReferenceForVersion,
  selectScriptureResolvedSlide,
  selectedBibleVerseNumbers,
  sendBibleLowerThirdTextMessage,
  sendBibleLowerThirdTextToOutput,
  sendBibleTextToOutput,
  setBibleDesignerVersion,
  setBibleLowerThirdSegmentIndex,
  setBibleNavigatorMode,
  setBiblePreviewText,
  setBibleSearchStatus,
  setBibleStyleEditorVisible,
  setBibleVerseSelectionFromEntry,
  setBibleVersionMetadata,
  showBibleTextContextMenu,
  showBibleTextNow,
  showCuedBibleLowerThird,
  showRecentScriptureContextMenu,
  showScheduleBibleContextMenu,
  slipstreamBiblePresentation,
  splitScheduledBiblePassageIntoVerses,
  syncActiveScheduledBiblePresentation,
  syncBibleBackgroundLabel,
  syncBibleDesignerStateToPreviewedQueueItem,
  syncBibleLookControls,
  syncBibleLowerThirdBarBackgroundLabel,
  syncBibleSearchControlsFromState,
  syncBibleSearchResultActiveState,
  syncBibleSelectorsFromState,
  syncBibleStateFromControls,
  syncBibleStyleControlsFromState,
  syncBibleVerseListSelection,
  syncBibleVersionAttributionDisplay,
  syncLiveBibleAudienceForLowerThirdCue,
  syncLiveBiblePresentation,
  syncShowNowBiblePresentation,
  updateBibleReferenceSuggestionActiveState,
  waitForBibleLowerThirdFonts,
};
