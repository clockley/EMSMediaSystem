/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/*
 * Workspace shell: show/hide Bible/songs/slides, sidebar resize, and Bible media-control wiring.
 */

import {
  NAVIGATION_STATES,
  PREVIEW_SURFACE_BIBLE,
  PREVIEW_SURFACE_SLIDES,
  PREVIEW_SURFACE_SONGS,
  SCRIPTURE_LOOK_LOWER_THIRD,
  SONG_FOLDER_UNFILED,
  addDeckPage,
  addNurseryAlertFromDraft,
  addSlideShapeObject,
  addSlideTextBox,
  applyBiblePreview,
  applyBibleReferenceSuggestion,
  applyBibleStyleToCurrentText,
  applyBibleStyleToScheduledText,
  applySongEditorTextStyle,
  attachSlideCanvasInteractions,
  bibleAPI,
  bibleDesignerState,
  bibleReferenceSuggestionIndex,
  bibleSearchState,
  bibleStyleDirtyState,
  bibleUiEnabled,
  bindSlideUndoControlTransactions,
  buildBibleTextMessage,
  bulkDeleteSelectedSongs,
  bulkMoveSelectedSongs,
  bulkScheduleSelectedSongs,
  changeBibleLowerThirdSegment,
  chooseSlideObjectImage,
  clearAudienceAlert,
  clearPrivateStageMessage,
  clearRecentScriptures,
  clearSongSelection,
  closeLiveLayers,
  closeSettingsControls,
  closeSongEditor,
  closeSongFolderPrompt,
  closeStageControls,
  commandForShortcut,
  commitBibleDesignerRenderState,
  createNewDeck,
  currentDeck,
  currentDeckIsSongDocument,
  currentPage,
  currentSongEditorStyleScope,
  currentSongRenderState,
  currentSongSectionId,
  currentWorkspaceSong,
  currentWorkspaceSongDeck,
  deleteCurrentDeck,
  deleteDeckPage,
  deleteSongFromLibrary,
  duplicateCurrentDeck,
  duplicateDeckPage,
  enabledSongSections,
  ensureSongFolder,
  ensureStageOutput,
  executeLiveCommand,
  getBibleDesignerStyle,
  getPathForFile,
  handleLiveLayersTabKeydown,
  handleSongEditorAddSection,
  handleSongEditorCanvasTextInput,
  handleSongEditorDeleteSection,
  handleSongEditorMoveSectionDown,
  handleSongEditorMoveSectionUp,
  handleSongEditorSectionMetaChange,
  hideBibleReferenceSuggestions,
  hideMediaLibraryWorkspace,
  importSongFromDialog,
  initSongEditorContextMenu,
  initSongEditorTextBoxDragAndDrop,
  insertAlertToken,
  insertBibleInSchedule,
  insertSongInSchedule,
  installBiblePreviewScaleObserver,
  installSongLowerThirdPreviewScaleObserver,
  invoke,
  isActiveMediaWindow,
  isBibleReferenceSuggestionsOpen,
  isBibleWorkspaceVisible,
  isLocalAppWindowPresentationActive,
  isPresentationActiveForBibleLowerThird,
  isQueuePresentationActive,
  jumpBibleReferenceToBrowser,
  loadBibleVersionMetadataFromSidecar,
  loadSongIntoWorkspace,
  localTimeStampUpdateIsRunning,
  navigateSongSection,
  navigationState,
  normalizeBibleVersionMetadata,
  normalizeScriptureReference,
  normalizedCueMatchText,
  on,
  openBibleWorkspaceFromButton,
  openLiveLayers,
  openMediaLibraryPicker,
  openSettingsControls,
  openSlidesWorkspaceFromButton,
  openSongEditor,
  openSongFolderPrompt,
  openSongsWorkspaceFromButton,
  openStageControls,
  positionBibleReferenceSuggestionsOverlay,
  projectStageConfig,
  readSongEditorRenderState,
  reconcileBibleBrowseView,
  recordSlideUndoCheckpoint,
  recordSlideUndoForMutation,
  redoSlideEdit,
  refreshBibleBrowser,
  refreshBibleLookupPreview,
  refreshSlidesFolderList,
  refreshSlidesList,
  refreshSongFolders,
  refreshSongsBrowser,
  renameCurrentDeck,
  renderBibleReferenceSuggestions,
  renderDeckPageStrip,
  renderGlobalNavigationState,
  renderRecentScriptures,
  renderSlideCanvas,
  renderSlideEditorState,
  renderSongSectionPreview,
  resetCurrentSongToThemeDefault,
  restoreBibleVersionFromSettings,
  saveBibleTextLayoutDefaults,
  saveCurrentDeck,
  showRendererPrompt,
  saveMediaFile,
  saveSongEditor,
  saveSongToSchedule,
  scheduleAutosaveProjectState,
  scheduleBibleSearch,
  scheduleCurrentDeck,
  scheduleSongPreviewRerender,
  selectFirstBibleReferenceForVersion,
  selectLiveLayersPage,
  send,
  sendStageLayer,
  setBibleDesignerVersion,
  setBibleLowerThirdSegmentIndex,
  setBibleNavigatorMode,
  setBibleStyleEditorVisible,
  setCurrentSongFolderFilter,
  setCurrentSongRenderState,
  setCurrentWorkspaceSong,
  setDeckDirty,
  setMediaCountdownOverlayVisible,
  setMediaCountdownText,
  setPreviewStackSurface,
  setSharedRendererState,
  setSongLowerThirdCue,
  showAudienceAlert,
  showBibleTextContextMenu,
  showBibleTextNow,
  showCuedBibleLowerThird,
  showCuedSongLowerThird,
  showCurrentDeckNow,
  showGnomeToast,
  showMediaLibraryWorkspace,
  showPrivateStageMessage,
  showSongTextNow,
  slidesAPI,
  songDeckDocumentFromSongDocument,
  songLowerThirdState,
  songSectionsFromParsedSections,
  songsAPI,
  stageContentCache,
  syncActiveScheduledBiblePresentation,
  syncActiveScheduledSongPresentation,
  syncBibleBackgroundLabel,
  syncBibleDesignerStateToPreviewedQueueItem,
  syncBibleLowerThirdBarBackgroundLabel,
  syncBibleSearchControlsFromState,
  syncBibleStateFromControls,
  syncBibleStyleControlsFromState,
  syncBibleVersionAttributionDisplay,
  syncCurrentWorkspaceSongDefaultRender,
  syncLowerThirdFeatureAvailability,
  syncPreviewAudioTrackState,
  syncPreviewStackSurface,
  syncShowNowBiblePresentation,
  syncSlidesWorkspaceTitle,
  syncSongBackgroundLabel,
  syncSongEditorWorkspaceStyles,
  syncSongLowerThirdForSection,
  syncSongResizeHandleAria,
  syncSongSlideNavigator,
  syncSongsMoveFolderSelect,
  undoSlideEdit,
  updateAlertComposerActions,
  updateBibleReferenceSuggestionActiveState,
  updateCurrentSlideTransitionFromControls,
  updateScheduleSongsWithUpdatedSong,
  updateStageStatusUi,
  useQuickAlertMessage,
  video,
} from "./app-renderer.mjs";

const SONG_SIDEBAR_STORAGE_KEY = "ems.songSidebarWidth";

const DECK_PAGES_WIDTH_STORAGE_KEY = "ems.deckPagesWidth";

const SONG_SIDEBAR_DEFAULT_WIDTH = 320;

const SONG_SIDEBAR_MIN_WIDTH = 220;

const SONG_SIDEBAR_MAX_WIDTH = 560;

// Keep these values local to the workspace module. Importing the equivalent
// PPTX constants from app-renderer creates a circular initialization edge:
// this module is evaluated before app-renderer assigns those constants, so
// the deck widths become undefined and the editor grid collapses to one
// column (`--deck-pages-width: undefinedpx`). These are the values used by
// the working monolithic editor in 6dce09d.
const DECK_PAGES_DEFAULT_WIDTH = 168;

const DECK_PAGES_MIN_WIDTH = 128;

const DECK_PAGES_MAX_WIDTH = 360;

function clampSongSidebarWidth(width) {
  if (!Number.isFinite(width)) return SONG_SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SONG_SIDEBAR_MAX_WIDTH, Math.max(SONG_SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function currentSongSidebarWidth() {
  const workspace = document.getElementById("songsWorkspace");
  const raw = workspace?.style?.getPropertyValue("--song-sidebar-width") || "";
  const parsed = Number.parseFloat(raw);
  return clampSongSidebarWidth(parsed || SONG_SIDEBAR_DEFAULT_WIDTH);
}

function applySongSidebarWidth(width, opts = {}) {
  const workspace = document.getElementById("songsWorkspace");
  if (!workspace) return;
  const safeWidth = clampSongSidebarWidth(width);
  workspace.style.setProperty("--song-sidebar-width", `${safeWidth}px`);
  syncSongResizeHandleAria(safeWidth);
  scheduleSongPreviewRerender();
  if (opts.persist !== false) {
    try {
      window.localStorage.setItem(SONG_SIDEBAR_STORAGE_KEY, String(safeWidth));
    } catch {}
  }
}

function restoreSongSidebarWidth(workspace = document.getElementById("songsWorkspace")) {
  if (!workspace) return;
  let savedWidth = SONG_SIDEBAR_DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(SONG_SIDEBAR_STORAGE_KEY);
    const parsed = Number.parseFloat(raw || "");
    if (Number.isFinite(parsed)) savedWidth = parsed;
  } catch {}
  workspace.style.setProperty(
    "--song-sidebar-width",
    `${clampSongSidebarWidth(savedWidth)}px`,
  );
  syncSongResizeHandleAria(savedWidth);
}

function bindSongSidebarResize(workspace = document.getElementById("songsWorkspace")) {
  const handle = document.getElementById("songSidebarResizeHandle");
  if (!workspace || !handle) return;
  restoreSongSidebarWidth(workspace);
  if (handle.dataset.resizeBound === "1") return;
  handle.dataset.resizeBound = "1";

  const finishResize = () => {
    document.body.classList.remove("is-song-sidebar-resizing");
    applySongSidebarWidth(currentSongSidebarWidth());
    scheduleSongPreviewRerender();
  };

  handle.addEventListener("dblclick", () => {
    applySongSidebarWidth(SONG_SIDEBAR_DEFAULT_WIDTH);
    finishResize();
  });

  handle.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 32 : 16;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      applySongSidebarWidth(currentSongSidebarWidth() - step);
      finishResize();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      applySongSidebarWidth(currentSongSidebarWidth() + step);
      finishResize();
    } else if (event.key === "Home") {
      event.preventDefault();
      applySongSidebarWidth(SONG_SIDEBAR_MIN_WIDTH);
      finishResize();
    } else if (event.key === "End") {
      event.preventDefault();
      applySongSidebarWidth(SONG_SIDEBAR_MAX_WIDTH);
      finishResize();
    }
  });

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    const workspaceRect = workspace.getBoundingClientRect();
    document.body.classList.add("is-song-sidebar-resizing");
    handle.setPointerCapture(pointerId);

    const onPointerMove = (moveEvent) => {
      applySongSidebarWidth(moveEvent.clientX - workspaceRect.left, { persist: false });
      scheduleSongPreviewRerender();
    };

    const onPointerUp = () => {
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerUp);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {}
      finishResize();
    };

    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerUp);
  });
}

function clampDeckPagesWidth(width) {
  if (!Number.isFinite(width)) return DECK_PAGES_DEFAULT_WIDTH;
  return Math.min(DECK_PAGES_MAX_WIDTH, Math.max(DECK_PAGES_MIN_WIDTH, Math.round(width)));
}

function currentDeckPagesWidth() {
  const workspace = document.getElementById("slidesWorkspace");
  const raw = workspace?.style?.getPropertyValue("--deck-pages-width") || "";
  const parsed = Number.parseFloat(raw);
  return clampDeckPagesWidth(parsed || DECK_PAGES_DEFAULT_WIDTH);
}

function syncDeckPagesResizeHandleAria(width = currentDeckPagesWidth()) {
  const handle = document.getElementById("slidesPagesResizeHandle");
  if (!handle) return;
  const safeWidth = clampDeckPagesWidth(width);
  handle.setAttribute("aria-valuemin", String(DECK_PAGES_MIN_WIDTH));
  handle.setAttribute("aria-valuemax", String(DECK_PAGES_MAX_WIDTH));
  handle.setAttribute("aria-valuenow", String(safeWidth));
  handle.setAttribute("aria-valuetext", `Deck pages pane width ${safeWidth} pixels`);
}

function applyDeckPagesWidth(width, opts = {}) {
  const workspace = document.getElementById("slidesWorkspace");
  if (!workspace) return;
  const safeWidth = clampDeckPagesWidth(width);
  workspace.style.setProperty("--deck-pages-width", `${safeWidth}px`);
  syncDeckPagesResizeHandleAria(safeWidth);
  if (isSlidesWorkspaceVisible()) renderSlideCanvas();
  if (opts.persist !== false) {
    try {
      window.localStorage.setItem(DECK_PAGES_WIDTH_STORAGE_KEY, String(safeWidth));
    } catch {}
  }
}

function restoreDeckPagesWidth(workspace = document.getElementById("slidesWorkspace")) {
  if (!workspace) return;
  let savedWidth = DECK_PAGES_DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(DECK_PAGES_WIDTH_STORAGE_KEY);
    const parsed = Number.parseFloat(raw || "");
    if (Number.isFinite(parsed)) savedWidth = parsed;
  } catch {}
  workspace.style.setProperty(
    "--deck-pages-width",
    `${clampDeckPagesWidth(savedWidth)}px`,
  );
  syncDeckPagesResizeHandleAria(savedWidth);
}

function bindDeckPagesResize(workspace = document.getElementById("slidesWorkspace")) {
  const handle = document.getElementById("slidesPagesResizeHandle");
  if (!workspace || !handle) return;
  restoreDeckPagesWidth(workspace);
  if (handle.dataset.resizeBound === "1") return;
  handle.dataset.resizeBound = "1";

  const finishResize = () => {
    document.body.classList.remove("is-deck-pages-resizing");
    applyDeckPagesWidth(currentDeckPagesWidth());
  };

  handle.addEventListener("dblclick", () => {
    applyDeckPagesWidth(DECK_PAGES_DEFAULT_WIDTH);
    finishResize();
  });

  handle.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 32 : 16;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      applyDeckPagesWidth(currentDeckPagesWidth() - step);
      finishResize();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      applyDeckPagesWidth(currentDeckPagesWidth() + step);
      finishResize();
    } else if (event.key === "Home") {
      event.preventDefault();
      applyDeckPagesWidth(DECK_PAGES_MIN_WIDTH);
      finishResize();
    } else if (event.key === "End") {
      event.preventDefault();
      applyDeckPagesWidth(DECK_PAGES_MAX_WIDTH);
      finishResize();
    }
  });

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    const pagesPane = document.querySelector("#slidesWorkspace .slides-workspace__pages");
    const pagesRect = pagesPane?.getBoundingClientRect();
    const originLeft = Number.isFinite(pagesRect?.left)
      ? pagesRect.left
      : workspace.getBoundingClientRect().left;
    document.body.classList.add("is-deck-pages-resizing");
    handle.setPointerCapture(pointerId);

    const onPointerMove = (moveEvent) => {
      applyDeckPagesWidth(moveEvent.clientX - originLeft, { persist: false });
    };

    const onPointerUp = () => {
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerUp);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {}
      finishResize();
    };

    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerUp);
  });
}

function showMediaWorkspace() {
  hideBibleWorkspace();
  hideSongsWorkspace();
  hideSlidesWorkspace();
  showMediaLibraryWorkspace();
  syncPreviewStackSurface();
  document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
  setMediaCountdownOverlayVisible(false);
  setMediaCountdownText("");
  navigationState.transition(NAVIGATION_STATES.MEDIA);
}

function markAudiencePreviewTextSelection(element, cueText) {
  if (!element) return;
  element.querySelectorAll("mark.operator-lower-third-selection").forEach((mark) => {
    mark.replaceWith(document.createTextNode(mark.textContent || ""));
  });
  element.normalize();
  const source = element.textContent || "";
  const cue = normalizedCueMatchText(cueText);
  if (!cue || element.childNodes.length !== 1 || element.firstChild?.nodeType !== Node.TEXT_NODE) return;
  const normalizedSource = normalizedCueMatchText(source);
  const normalizedIndex = normalizedSource.toLocaleLowerCase().indexOf(cue.toLocaleLowerCase());
  if (normalizedIndex < 0) return;

  // Scripture preview text is normalized before rendering, so normalized and
  // source offsets normally match. Walk the source to tolerate repeated spaces.
  let sourceStart = 0;
  let normalizedOffset = 0;
  while (sourceStart < source.length && normalizedOffset < normalizedIndex) {
    if (/\s/.test(source[sourceStart])) {
      while (sourceStart + 1 < source.length && /\s/.test(source[sourceStart + 1])) sourceStart += 1;
    }
    sourceStart += 1;
    normalizedOffset += 1;
  }
  let sourceEnd = sourceStart;
  let cueOffset = 0;
  while (sourceEnd < source.length && cueOffset < cue.length) {
    if (/\s/.test(source[sourceEnd])) {
      while (sourceEnd + 1 < source.length && /\s/.test(source[sourceEnd + 1])) sourceEnd += 1;
    }
    sourceEnd += 1;
    cueOffset += 1;
  }
  const before = document.createTextNode(source.slice(0, sourceStart));
  const mark = document.createElement("mark");
  mark.className = "operator-lower-third-selection";
  mark.textContent = source.slice(sourceStart, sourceEnd);
  const after = document.createTextNode(source.slice(sourceEnd));
  element.replaceChildren(before, mark, after);
}

function markSongAudiencePreviewSelection(cue, cueOccurrence = 0) {
  const preview = document.getElementById("songsPreviewSlide");
  if (!preview) return;
  const lines = [...preview.querySelectorAll(".song-preview-block:not(.song-preview-block--spacer)")];
  lines.forEach((line) => line.classList.remove("operator-lower-third-selection"));
  preview.querySelectorAll("mark.operator-lower-third-selection").forEach((mark) => {
    mark.replaceWith(...mark.childNodes);
  });
  lines.forEach((line) => line.normalize());
  const cueBlockIds = new Set(
    (Array.isArray(cue?.blockIds) ? cue.blockIds : []).filter(
      (blockId) => typeof blockId === "string" && blockId.length > 0,
    ),
  );
  if (cueBlockIds.size > 0) {
    const matchingLines = lines.filter((line) => cueBlockIds.has(line.dataset.songBlockId || ""));
    if (matchingLines.length > 0) {
      matchingLines.forEach((line) => line.classList.add("operator-lower-third-selection"));
      return;
    }
  }

  // Compatibility fallback for legacy/imported slides whose rendered blocks
  // do not carry stable AST block IDs.
  const cueText = typeof cue === "string" ? cue : cue?.text;
  const normalizedCue = normalizedCueMatchText(cueText).toLocaleLowerCase();
  if (!normalizedCue || !lines.length) return;

  let combined = "";
  const characterLocations = [];
  const appendSpace = () => {
    if (!combined || combined.endsWith(" ")) return;
    combined += " ";
    characterLocations.push(null);
  };
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) appendSpace();
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent || "";
      for (let offset = 0; offset < text.length; offset += 1) {
        const character = text[offset];
        if (/\s/.test(character)) {
          appendSpace();
        } else {
          combined += character.toLocaleLowerCase();
          characterLocations.push({ node, start: offset, end: offset + 1 });
        }
      }
      node = walker.nextNode();
    }
  });
  const requestedOccurrence = Math.max(
    0,
    Number.isFinite(cueOccurrence) ? Math.trunc(cueOccurrence) : 0,
  );
  let matchStart = -1;
  let searchFrom = 0;
  for (let occurrence = 0; occurrence <= requestedOccurrence; occurrence += 1) {
    matchStart = combined.indexOf(normalizedCue, searchFrom);
    if (matchStart < 0) break;
    searchFrom = matchStart + Math.max(1, normalizedCue.length);
  }
  // The audience slide may contain fewer copies than the whole lower-third
  // section. In that case prefer its last visible copy instead of leaving a
  // stale highlight behind.
  if (matchStart < 0 && requestedOccurrence > 0) {
    matchStart = combined.lastIndexOf(normalizedCue);
  }
  if (matchStart < 0) return;
  const matchEnd = matchStart + normalizedCue.length;

  const rangesByNode = new Map();
  characterLocations.slice(matchStart, matchEnd).forEach((location) => {
    if (!location) return;
    const range = rangesByNode.get(location.node) || {
      start: location.start,
      end: location.end,
    };
    range.start = Math.min(range.start, location.start);
    range.end = Math.max(range.end, location.end);
    rangesByNode.set(location.node, range);
  });
  [...rangesByNode.entries()].reverse().forEach(([node, offsets]) => {
    if (!node.isConnected || offsets.end <= offsets.start) return;
    const range = document.createRange();
    range.setStart(node, offsets.start);
    range.setEnd(node, offsets.end);
    const mark = document.createElement("mark");
    mark.className = "operator-lower-third-selection";
    range.surroundContents(mark);
  });
}

function showBibleWorkspace() {
  if (!bibleUiEnabled) {
    hideBibleWorkspace();
    return;
  }
  const workspace = document.getElementById("bibleWorkspace");
  if (!workspace) return;
  hideMediaLibraryWorkspace();
  hideSongsWorkspace();
  hideSlidesWorkspace();
  syncLowerThirdFeatureAvailability();
  workspace.hidden = false;
  navigationState.transition(NAVIGATION_STATES.BIBLE);
  document.getElementById("previewEmptyState")?.setAttribute("hidden", "");
  document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
  setPreviewStackSurface(PREVIEW_SURFACE_BIBLE);
  installBibleWorkspaceEventGuards();
  pauseInactivePreviewBehindWorkspace();
}

function hideBibleWorkspace() {
  const workspace = document.getElementById("bibleWorkspace");
  if (workspace) workspace.hidden = true;
  setBibleStyleEditorVisible(false);
  if (navigationState.state === NAVIGATION_STATES.BIBLE) {
    navigationState.transition(NAVIGATION_STATES.MEDIA);
  }
  syncPreviewStackSurface();
}

function showSongsWorkspace() {
  const workspace = document.getElementById("songsWorkspace");
  if (!workspace) return;
  hideMediaLibraryWorkspace();
  hideBibleWorkspace();
  hideSlidesWorkspace();
  syncLowerThirdFeatureAvailability();
  workspace.hidden = false;
  navigationState.transition(NAVIGATION_STATES.SONGS);
  document.getElementById("previewEmptyState")?.setAttribute("hidden", "");
  document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
  setPreviewStackSurface(PREVIEW_SURFACE_SONGS);
  installSongsWorkspaceEventGuards();
  bindSongSidebarResize(workspace);
  
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
  syncSongSlideNavigator();
  syncSongLowerThirdForSection();
  scheduleSongPreviewRerender();
}

function hideSongsWorkspace() {
  const workspace = document.getElementById("songsWorkspace");
  if (workspace) workspace.hidden = true;
  if (navigationState.state === NAVIGATION_STATES.SONGS) {
    navigationState.transition(NAVIGATION_STATES.MEDIA);
  }
  syncPreviewStackSurface();
}

function showSlidesWorkspace() {
  const workspace = document.getElementById("slidesWorkspace");
  if (!workspace) return;
  hideMediaLibraryWorkspace();
  hideBibleWorkspace();
  hideSongsWorkspace();
  workspace.hidden = false;
  navigationState.transition(NAVIGATION_STATES.SLIDES);
  document.getElementById("previewEmptyState")?.setAttribute("hidden", "");
  document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
  setPreviewStackSurface(PREVIEW_SURFACE_SLIDES);
  installSlidesWorkspaceEventGuards();
  bindDeckPagesResize(workspace);
  setMediaCountdownOverlayVisible(false);
  setMediaCountdownText("");
  pauseInactivePreviewBehindWorkspace();
}

function hideSlidesWorkspace() {
  const workspace = document.getElementById("slidesWorkspace");
  if (workspace) workspace.hidden = true;
  if (navigationState.state === NAVIGATION_STATES.SLIDES) {
    navigationState.transition(NAVIGATION_STATES.MEDIA);
  }
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

function isSongsWorkspaceVisible() {
  return document.getElementById("songsWorkspace")?.hidden === false;
}

function isMediaLibraryWorkspaceVisible() {
  return document.getElementById("mediaLibraryWorkspace")?.hidden === false;
}

function isPreviewWorkspaceOverlayVisible() {
  return (
    isBibleWorkspaceVisible() ||
    isSongsWorkspaceVisible() ||
    isSlidesWorkspaceVisible() ||
    isMediaLibraryWorkspaceVisible()
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
  setSharedRendererState({ localTimeStampUpdateIsRunning: false });
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
  installSongLowerThirdPreviewScaleObserver();

  versionSelect.innerHTML = '<option value="KJV">KJV</option>';
  versionSelect.value = bibleDesignerState.version;
  referenceInput.value = bibleDesignerState.reference;
  syncBibleStyleControlsFromState();
  syncBibleBackgroundLabel();
  syncBibleSearchControlsFromState();
  syncBibleVersionAttributionDisplay();
  renderRecentScriptures();

  document
    .getElementById("bibleRecentClearBtn")
    ?.addEventListener("click", clearRecentScriptures);

  document.getElementById("openBibleWorkspaceBtn")?.addEventListener("click", () => {
    void openBibleWorkspaceFromButton().catch(console.error);
  });

  document.getElementById("openSongsWorkspaceBtn")?.addEventListener("click", () => {
    void openSongsWorkspaceFromButton().catch(console.error);
  });

  document.getElementById("openSlidesWorkspaceBtn")?.addEventListener("click", () => {
    void openSlidesWorkspaceFromButton().catch(console.error);
  });
  document.getElementById("openMediaWorkspaceBtn")?.addEventListener("click", showMediaWorkspace);
  document.getElementById("openStageControlsBtn")?.addEventListener("click", () => void openStageControls());
  document.getElementById("openLiveLayersBtn")?.addEventListener("click", () => void openLiveLayers());
  document.getElementById("closeLiveLayersBtn")?.addEventListener("click", closeLiveLayers);
  document.getElementById("liveLayersBackdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeLiveLayers();
  });
  for (const tab of document.querySelectorAll("[data-live-layer-tab]")) {
    tab.addEventListener("click", () => selectLiveLayersPage(tab.dataset.liveLayerTab, { focus: true }));
    tab.addEventListener("keydown", handleLiveLayersTabKeydown);
  }
  document.getElementById("showAudienceAlertBtn")?.addEventListener("click", () => void showAudienceAlert());
  document.getElementById("clearAudienceAlertBtn")?.addEventListener("click", () => void clearAudienceAlert());
  document.getElementById("addNurseryAlertBtn")?.addEventListener("click", () => void addNurseryAlertFromDraft());
  document.getElementById("alertMessageText")?.addEventListener("input", updateAlertComposerActions);
  document.getElementById("quickAlertMessageSelect")?.addEventListener("change", useQuickAlertMessage);
  document.getElementById("insertAlertClockTokenBtn")?.addEventListener("click", () => insertAlertToken("{{clock}}"));
  document.getElementById("insertAlertCountdownTokenBtn")?.addEventListener("click", () => {
    if (!document.getElementById("alertCountdownTarget")?.value) {
      showGnomeToast("Choose when the countdown should end");
      document.getElementById("alertCountdownTarget")?.focus();
      return;
    }
    insertAlertToken("{{countdown}}");
  });
  document.getElementById("nurseryAlertIdentifier")?.addEventListener("input", updateAlertComposerActions);
  document.getElementById("nurseryAlertIdentifier")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void addNurseryAlertFromDraft();
    }
  });
  document.getElementById("openSettingsBtn")?.addEventListener("click", openSettingsControls);
  document.getElementById("closeStageControlsBtn")?.addEventListener("click", closeStageControls);
  document.getElementById("stageControlsBackdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeStageControls();
  });
  document.getElementById("closeSettingsControlsBtn")?.addEventListener("click", closeSettingsControls);
  document.getElementById("settingsControlsBackdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeSettingsControls();
  });
  document.getElementById("stageDisplaySelect")?.addEventListener("change", (event) => {
    projectStageConfig.display = event.target.value || "";
    send("set-stage-display-index", event.target.value || "");
    if (event.target.value) void ensureStageOutput();
    scheduleAutosaveProjectState();
  });
  document.getElementById("stageProfileSelect")?.addEventListener("change", async (event) => {
    stageContentCache.profile = event.target.value;
    projectStageConfig.profile = event.target.value;
    if (await ensureStageOutput()) await sendStageLayer("content", stageContentCache);
    scheduleAutosaveProjectState();
  });
  document.getElementById("showStageMessageBtn")?.addEventListener("click", () => void showPrivateStageMessage());
  document.getElementById("clearStageMessageBtn")?.addEventListener("click", () => void clearPrivateStageMessage());
  on("output-status", (_event, status) => updateStageStatusUi(status));
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !document.getElementById("settingsControlsBackdrop")?.hidden
    ) {
      event.preventDefault();
      closeSettingsControls();
      return;
    }
    if (event.key === "Escape" && !document.getElementById("stageControlsBackdrop")?.hidden) {
      event.preventDefault();
      closeStageControls();
      return;
    }
    if (event.key === "Escape" && !document.getElementById("liveLayersBackdrop")?.hidden) {
      event.preventDefault();
      closeLiveLayers();
      return;
    }
    if (event.key !== "F8") return;
    const command = commandForShortcut(event);
    if (!command) return;
    event.preventDefault();
    void executeLiveCommand(command);
  });
  void invoke("get-output-status").then(updateStageStatusUi).catch(() => {});
  renderGlobalNavigationState(navigationState.state);
  document.getElementById("newDeckBtn")?.addEventListener("click", () => {
    void createNewDeck().catch(console.error);
  });
  document.getElementById("newDeckFolderBtn")?.addEventListener("click", async () => {
    const name = (
      await showRendererPrompt("New deck folder name", "", {
        title: "Create deck folder",
        confirmLabel: "Create",
      }) || ""
    ).trim();
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
  document.getElementById("slidesResetSongThemeBtn")?.addEventListener("click", () => {
    resetCurrentSongToThemeDefault();
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
  document.getElementById("slidesWorkspaceTitleButton")?.addEventListener("click", () => {
    void renameCurrentDeck().catch(console.error);
  });
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

  const updateSongMetadata = (label, update) => {
    if (!currentDeck || !currentDeckIsSongDocument()) return;
    recordSlideUndoForMutation(label);
    const metadata = {
      ...(currentDeck.metadata && typeof currentDeck.metadata === "object"
        ? currentDeck.metadata
        : {}),
    };
    update(metadata);
    currentDeck.metadata = metadata;
    setDeckDirty(true);
  };

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
    currentDeck.theme = {
      ...(currentDeck.theme || {}),
      fontFamily: e.target.value,
      fontFamilyOverride: true,
    };
    for (const page of currentDeck.pages || []) for (const obj of page.objects || []) if (obj.kind === "text") obj.style = { ...(obj.style || {}), fontFamily: e.target.value };
    setDeckDirty(true);
    renderSlideCanvas();
  });
  document.getElementById("slidesDeckFontSize")?.addEventListener("input", (e) => {
    if (!currentDeck) return;
    const n = Number(e.target.value);
    if (!Number.isFinite(n)) return;
    recordSlideUndoForMutation("Change deck font size");
    currentDeck.theme = { ...(currentDeck.theme || {}), fontSize: n };
    for (const page of currentDeck.pages || []) for (const obj of page.objects || []) if (obj.kind === "text") obj.style = { ...(obj.style || {}), fontSize: n };
    setDeckDirty(true);
    renderSlideCanvas();
  });
  document.getElementById("slidesDeckTextColor")?.addEventListener("input", (e) => {
    if (!currentDeck) return;
    recordSlideUndoForMutation("Change deck text color");
    currentDeck.theme = { ...(currentDeck.theme || {}), textColor: e.target.value };
    for (const page of currentDeck.pages || []) for (const obj of page.objects || []) if (obj.kind === "text") obj.style = { ...(obj.style || {}), color: e.target.value };
    setDeckDirty(true);
    renderSlideCanvas();
    renderDeckPageStrip();
  });
  const updateThemeTypography = (label, patch) => {
    if (!currentDeck) return;
    recordSlideUndoForMutation(label);
    currentDeck.theme = { ...(currentDeck.theme || {}), ...patch };
    for (const page of currentDeck.pages || []) {
      for (const object of page.objects || []) {
        if (object.kind !== "text") continue;
        object.style = {
          ...(object.style || {}),
          ...(patch.align ? { align: patch.align } : {}),
          ...(patch.verticalAlign ? { verticalAlign: patch.verticalAlign } : {}),
          ...(patch.fontWeight ? { fontWeight: patch.fontWeight } : {}),
          ...(patch.fontStyle ? { fontStyle: patch.fontStyle } : {}),
          ...(patch.lineHeight ? { lineHeight: patch.lineHeight } : {}),
          ...(patch.minFontSize ? { minFontSize: patch.minFontSize } : {}),
        };
        if (patch.autosizeMode) object.autofit = patch.autosizeMode;
      }
    }
    setDeckDirty(true);
    renderSlideCanvas();
    renderDeckPageStrip();
  };
  document.getElementById("slidesDeckMinFontSize")?.addEventListener("input", (e) => {
    const value = Number(e.target.value); if (Number.isFinite(value)) updateThemeTypography("Change minimum font size", { minFontSize: value });
  });
  document.getElementById("slidesDeckAutosizeMode")?.addEventListener("change", (e) => updateThemeTypography("Change text fitting", { autosizeMode: e.target.value }));
  document.getElementById("slidesDeckAlign")?.addEventListener("change", (e) => updateThemeTypography("Change alignment", { align: e.target.value }));
  document.getElementById("slidesDeckVerticalAlign")?.addEventListener("change", (e) => updateThemeTypography("Change vertical alignment", { verticalAlign: e.target.value }));
  document.getElementById("slidesDeckFontWeight")?.addEventListener("change", (e) => updateThemeTypography("Change font weight", { fontWeight: Number(e.target.value) || 700 }));
  document.getElementById("slidesDeckFontStyle")?.addEventListener("change", (e) => updateThemeTypography("Change font style", { fontStyle: e.target.value }));
  document.getElementById("slidesDeckLineHeight")?.addEventListener("input", (e) => {
    const value = Number(e.target.value); if (Number.isFinite(value)) updateThemeTypography("Change line height", { lineHeight: value });
  });
  const updateThemeBackdrop = () => {
    if (!currentDeck) return;
    recordSlideUndoForMutation("Change backing plate");
    const enabled = document.getElementById("slidesDeckBackdropEnabled")?.checked === true;
    const color = document.getElementById("slidesDeckBackdropColor")?.value || "#101010";
    currentDeck.theme = { ...(currentDeck.theme || {}), backdrop: { ...(currentDeck.theme?.backdrop || {}), enabled, background: { type: "color", color } } };
    for (const page of currentDeck.pages || []) for (const object of page.objects || []) if (object.kind === "text") object.background = enabled ? { type: "color", color } : null;
    setDeckDirty(true); renderSlideCanvas(); renderDeckPageStrip();
  };
  document.getElementById("slidesDeckBackdropEnabled")?.addEventListener("change", updateThemeBackdrop);
  document.getElementById("slidesDeckBackdropColor")?.addEventListener("input", updateThemeBackdrop);
  document.getElementById("slidesSongNumber")?.addEventListener("input", (e) => {
    if (!currentDeck || !currentDeckIsSongDocument()) return;
    const value = Number.parseInt(e.target.value, 10);
    recordSlideUndoForMutation("Edit song number");
    if (Number.isFinite(value) && value > 0) {
      currentDeck.songNumber = value;
    } else {
      delete currentDeck.songNumber;
    }
    setDeckDirty(true);
  });
  document.getElementById("slidesSongAuthors")?.addEventListener("input", (e) => {
    updateSongMetadata("Edit song authors", (metadata) => {
      metadata.authors = String(e.target.value || "")
        .split(/[,;\n]/)
        .map((author) => author.trim())
        .filter(Boolean);
    });
  });
  document.getElementById("slidesSongCopyright")?.addEventListener("input", (e) => {
    updateSongMetadata("Edit song copyright", (metadata) => {
      metadata.copyright = e.target.value.trim();
    });
  });
  document.getElementById("slidesSongCcli")?.addEventListener("input", (e) => {
    updateSongMetadata("Edit song CCLI number", (metadata) => {
      metadata.ccliNumber = e.target.value.trim() || null;
      delete metadata.ccli_number;
    });
  });
  document.getElementById("slidesSongLicense")?.addEventListener("input", (e) => {
    updateSongMetadata("Edit song license", (metadata) => {
      metadata.oneLicense = e.target.value.trim() || null;
      delete metadata.one_license;
    });
  });
  for (const [id, label, key] of [
    ["slidesSongHymnalName", "Edit song hymnal", "name"],
    ["slidesSongHymnalNumber", "Edit song hymnal number", "number"],
  ]) {
    document.getElementById(id)?.addEventListener("input", (e) => {
      updateSongMetadata(label, (metadata) => {
        metadata.hymnal = {
          ...(metadata.hymnal && typeof metadata.hymnal === "object" ? metadata.hymnal : {}),
          [key]: e.target.value.trim() || null,
        };
      });
    });
  }
  document.getElementById("slidesSongMeter")?.addEventListener("input", (e) => {
    updateSongMetadata("Edit song meter", (metadata) => {
      const meter = e.target.value.trim();
      metadata.meter = meter;
      metadata.hymnal = {
        ...(metadata.hymnal && typeof metadata.hymnal === "object" ? metadata.hymnal : {}),
        meter,
      };
    });
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
  document.getElementById("slidesPageMediaPickerBtn")?.addEventListener("click", async () => {
    const page = currentPage();
    if (!page) return;
    const item = await openMediaLibraryPicker({ title: "Choose Slide Background", kinds: ["image", "video"] });
    if (!item?.localPath) return;
    recordSlideUndoCheckpoint("Set page background");
    page.background = { type: item.kind, path: item.localPath, libraryItemId: item.id };
    setDeckDirty(true);
    renderSlideCanvas();
    renderDeckPageStrip();
    renderSlideEditorState();
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
  // Re-flow font sizes when the canvas resizes. Observing the wrap (rather
  // than the frame itself) avoids feeding back into layoutSlideCanvasFrame's
  // own writes to the frame's size, and reacts to the actual available space.
  if (typeof ResizeObserver !== "undefined") {
    const canvasWrap = document.querySelector(".slides-workspace__canvas-wrap");
    if (canvasWrap) {
      try {
        new ResizeObserver(() => {
          if (isSlidesWorkspaceVisible()) renderSlideCanvas();
        }).observe(canvasWrap);
      } catch {}
    }
    const songPreviewContainer = document.querySelector(".songs-preview-container");
    if (songPreviewContainer) {
      try {
        new ResizeObserver(() => {
          if (isSongsWorkspaceVisible()) scheduleSongPreviewRerender();
        }).observe(songPreviewContainer);
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
        setCurrentSongFolderFilter(folderId);
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

  document.getElementById("songLowerThirdPrevBtn")?.addEventListener("click", () => {
    setSongLowerThirdCue(songLowerThirdState.index - 1);
  });
  document.getElementById("songLowerThirdNextBtn")?.addEventListener("click", () => {
    setSongLowerThirdCue(songLowerThirdState.index + 1);
  });
  document.getElementById("songLowerThirdShowBtn")?.addEventListener("click", () => {
    void showCuedSongLowerThird().catch((err) => {
      console.error("Failed to show song lower third:", err);
      showGnomeToast("Failed to show song lower third");
    });
  });
  const songLowerThirdCueList = document.getElementById("songLowerThirdCueList");
  songLowerThirdCueList?.addEventListener("keydown", (event) => {
    let target = songLowerThirdState.index;
    if (event.key === "ArrowUp" || event.key === "PageUp") target -= 1;
    else if (event.key === "ArrowDown" || event.key === "PageDown") target += 1;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = songLowerThirdState.segments.length - 1;
    else if (event.key === "Enter") {
      event.preventDefault();
      void showCuedSongLowerThird().catch(console.error);
      return;
    } else return;
    event.preventDefault();
    setSongLowerThirdCue(target);
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
          setCurrentWorkspaceSong(updated);
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

  document.getElementById("songEditorMediaPickerBtn")?.addEventListener("click", async () => {
    const item = await openMediaLibraryPicker({ title: "Choose Song Background", kinds: ["image", "video"] });
    if (!item?.localPath) return;
    currentSongRenderState.backgroundPath = item.localPath;
    currentSongRenderState.backgroundLibraryItemId = item.id;
    syncCurrentWorkspaceSongDefaultRender();
    syncSongBackgroundLabel();
    syncSongEditorWorkspaceStyles();
    if (currentWorkspaceSong) {
      const section = enabledSongSections(currentWorkspaceSong).find((entry) => entry.id === currentSongSectionId)
        || currentWorkspaceSong.sections?.[0];
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
      controlId === "songEditorTextColor" ||
      controlId === "songEditorFontInput" ||
      controlId === "songEditorFontSizeInput";
    const scope = currentSongEditorStyleScope();

    if (isTextStyleControl) {
      const style = controlId === "songEditorTextColor"
        ? { color: event.currentTarget.value }
        : controlId === "songEditorFontSizeInput"
          ? { fontSize: Number(event.currentTarget.value) }
          : { fontFamily: event.currentTarget.value };
      if (scope === "allSlides") {
        setCurrentSongRenderState(readSongEditorRenderState());
        if (controlId === "songEditorFontInput") {
          currentSongRenderState.fontFamilyOverride = true;
        }
        syncCurrentWorkspaceSongDefaultRender();
      }
      if (controlId === "songEditorFontInput") {
        currentSongRenderState.fontFamilyOverride = true;
      }
      applySongEditorTextStyle(style, scope);
    } else {
      setCurrentSongRenderState(readSongEditorRenderState());
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
    void (async () => {
      setBibleDesignerVersion(versionSelect.value, { syncControls: false });
      hideBibleReferenceSuggestions();
      syncBibleVersionAttributionDisplay();
      await selectFirstBibleReferenceForVersion(bibleDesignerState.version);
      await refreshBibleBrowser();
      if (bibleSearchState.active && bibleSearchState.scope === "current") {
        scheduleBibleSearch(0);
      }
      await refreshBibleLookupPreview();
      await syncShowNowBiblePresentation();
    })().catch(console.error);
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
    setSharedRendererState({ bibleReferenceSuggestionIndex: -1 });
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
    setSharedRendererState({ bibleReferenceSuggestionIndex: -1 });
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
      setSharedRendererState({ bibleReferenceSuggestionIndex: bibleReferenceSuggestionIndex < suggestionButtons.length - 1
          ? bibleReferenceSuggestionIndex + 1
          : 0 });
      updateBibleReferenceSuggestionActiveState();
      return;
    }
    if (event.key === "ArrowUp" && isBibleReferenceSuggestionsOpen() && suggestionButtons.length) {
      event.preventDefault();
      setSharedRendererState({ bibleReferenceSuggestionIndex: bibleReferenceSuggestionIndex > 0
          ? bibleReferenceSuggestionIndex - 1
          : suggestionButtons.length - 1 });
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
      await commitBibleDesignerRenderState();
    })().catch(console.error);
  });
  document.getElementById("bibleLowerThirdPrevBtn")?.addEventListener("click", () => {
    void changeBibleLowerThirdSegment(-1).catch(console.error);
  });
  document.getElementById("bibleLowerThirdNextBtn")?.addEventListener("click", () => {
    void changeBibleLowerThirdSegment(1).catch(console.error);
  });
  document.getElementById("bibleLowerThirdShowBtn")?.addEventListener("click", () => {
    void showCuedBibleLowerThird().catch((err) => {
      console.error("Failed to show Bible lower third:", err);
      showGnomeToast("Failed to show lower third");
    });
  });
  const lowerThirdCueList = document.getElementById("bibleLowerThirdCueList");
  lowerThirdCueList?.addEventListener("click", (event) => {
    const row = event.target.closest?.("[data-cue-index]");
    if (!row || event.detail > 1) return;
    void setBibleLowerThirdSegmentIndex(Number(row.dataset.cueIndex)).catch(console.error);
  });
  lowerThirdCueList?.addEventListener("dblclick", (event) => {
    const row = event.target.closest?.("[data-cue-index]");
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    void (async () => {
      await setBibleLowerThirdSegmentIndex(Number(row.dataset.cueIndex));
      if (!isPresentationActiveForBibleLowerThird()) {
        showGnomeToast("Lower third cued; start presenting or use Show to take it live");
        return;
      }
      await showCuedBibleLowerThird();
    })().catch((error) => {
      console.error("Failed to show double-clicked Bible lower third:", error);
      showGnomeToast("Failed to show lower third");
    });
  });
  lowerThirdCueList?.addEventListener("keydown", (event) => {
    const resolvedMessage = buildBibleTextMessage(bibleDesignerState, {
      look: SCRIPTURE_LOOK_LOWER_THIRD,
    });
    const slides = resolvedMessage.resolvedPresentation?.slides || [];
    let target = Math.max(
      0,
      slides.findIndex(
        (slide) => slide.slideId === bibleDesignerState.currentLowerThirdSlideId,
      ),
    );
    if (event.key === "ArrowUp" || event.key === "PageUp") target -= 1;
    else if (event.key === "ArrowDown" || event.key === "PageDown") target += 1;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = slides.length - 1;
    else if (event.key === "Enter") {
      event.preventDefault();
      void showCuedBibleLowerThird().catch(console.error);
      return;
    } else return;
    event.preventDefault();
    void setBibleLowerThirdSegmentIndex(target).catch(console.error);
  });
  [
    "bibleFontInput",
    "bibleFontSizeInput",
    "bibleAutosizeModeInput",
    "bibleMinFontSizeInput",
    "bibleTextColorInput",
    "bibleBackgroundColorInput",
    "bibleLowerThirdTextColorInput",
    "bibleLowerThirdBarBackgroundColorInput",
    "bibleLowerThirdFontInput",
    "bibleLowerThirdFontSizeInput",
    "bibleLowerThirdChromaKeyInput",
    "bibleTransitionEffectInput",
    "bibleTransitionDurationInput",
  ].forEach((id) => {
    const control = document.getElementById(id);
    const handleBibleStyleChange = () => {
      void (async () => {
        if (id === "bibleFontInput") {
          bibleStyleDirtyState.fontFamily = true;
          bibleDesignerState.fontFamilyOverride = true;
        }
        if (id === "bibleFontSizeInput") bibleStyleDirtyState.fontSize = true;
        if (id === "bibleAutosizeModeInput") bibleStyleDirtyState.autosizeMode = true;
        if (id === "bibleMinFontSizeInput") bibleStyleDirtyState.minFontSize = true;
        if (id === "bibleTextColorInput") bibleStyleDirtyState.color = true;
        if (id === "bibleBackgroundColorInput") bibleStyleDirtyState.backgroundColor = true;
        if (id === "bibleLowerThirdTextColorInput") bibleStyleDirtyState.lowerThirdColor = true;
        if (id === "bibleLowerThirdBarBackgroundColorInput") {
          bibleStyleDirtyState.lowerThirdBarBackgroundColor = true;
        }
        if (id === "bibleLowerThirdFontInput") {
          bibleStyleDirtyState.lowerThirdFontFamily = true;
          bibleDesignerState.lowerThirdFontFamilyOverride = true;
        }
        if (id === "bibleLowerThirdFontSizeInput") bibleStyleDirtyState.lowerThirdFontSize = true;
        if (id === "bibleLowerThirdChromaKeyInput") {
          bibleStyleDirtyState.lowerThirdChromaKeyColor = true;
        }
        await syncBibleStateFromControls();
        Object.assign(bibleDesignerState, getBibleDesignerStyle());
        if (
          id === "bibleFontInput" ||
          id === "bibleFontSizeInput" ||
          id === "bibleAutosizeModeInput" ||
          id === "bibleMinFontSizeInput" ||
          id === "bibleLowerThirdFontInput" ||
          id === "bibleLowerThirdFontSizeInput"
        ) {
          delete bibleDesignerState.autosizeGroupFontSize;
          bibleDesignerState.autosizeGroupScope = "";
          bibleDesignerState.lowerThirdSegmentIndex = 0;
          bibleDesignerState.currentLowerThirdSlideId = null;
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
  document.getElementById("bibleLowerThirdBarBackgroundInput")?.addEventListener("change", (event) => {
    void (async () => {
      const file = event.target.files?.[0];
      bibleDesignerState.lowerThirdBarBackgroundPath = file ? getPathForFile(file) : "";
      bibleStyleDirtyState.lowerThirdBarBackgroundPath = true;
      syncBibleLowerThirdBarBackgroundLabel();
      applyBiblePreview(bibleDesignerState, { show: false });
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
    .getElementById("bibleEditThemeBtn")
    ?.addEventListener("click", () => {
      void invoke("open-theme-manager-window", {
        contentKind: "scripture",
        outputRole: "audience",
      }).catch(console.error);
    });
  document
    .getElementById("bibleSaveLayoutDefaultsBtn")
    ?.addEventListener("click", () => void saveBibleTextLayoutDefaults().catch(console.error));
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
  document.getElementById("bibleClearLowerThirdBarBackgroundBtn")?.addEventListener("click", () => {
    void (async () => {
      bibleDesignerState.lowerThirdBarBackgroundPath = "";
      bibleStyleDirtyState.lowerThirdBarBackgroundPath = true;
      const backgroundInput = document.getElementById("bibleLowerThirdBarBackgroundInput");
      if (backgroundInput) backgroundInput.value = "";
      syncBibleLowerThirdBarBackgroundLabel("");
      applyBiblePreview(bibleDesignerState, { show: false });
      if (await syncBibleDesignerStateToPreviewedQueueItem()) {
        saveMediaFile();
      }
      syncActiveScheduledBiblePresentation();
      await syncShowNowBiblePresentation();
    })().catch(console.error);
  });
  document.getElementById("bibleEditorCloseBtn")?.addEventListener("click", () => {
    setBibleStyleEditorVisible(false);
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

export {
  DECK_PAGES_DEFAULT_WIDTH,
  DECK_PAGES_MAX_WIDTH,
  DECK_PAGES_MIN_WIDTH,
  DECK_PAGES_WIDTH_STORAGE_KEY,
  SONG_SIDEBAR_DEFAULT_WIDTH,
  SONG_SIDEBAR_MAX_WIDTH,
  SONG_SIDEBAR_MIN_WIDTH,
  SONG_SIDEBAR_STORAGE_KEY,
  applyDeckPagesWidth,
  applySongSidebarWidth,
  bindDeckPagesResize,
  bindSongSidebarResize,
  clampDeckPagesWidth,
  clampSongSidebarWidth,
  currentDeckPagesWidth,
  currentSongSidebarWidth,
  hideBiblePreview,
  hideBibleWorkspace,
  hideSlidesWorkspace,
  hideSongsWorkspace,
  installBibleMediaControls,
  installBibleWorkspaceEventGuards,
  installPreviewWorkspaceEventGuards,
  installSlidesWorkspaceEventGuards,
  installSongsWorkspaceEventGuards,
  isPreviewWorkspaceOverlayVisible,
  isSlidesWorkspaceVisible,
  isSongsWorkspaceVisible,
  markAudiencePreviewTextSelection,
  markSongAudiencePreviewSelection,
  pauseInactivePreviewBehindWorkspace,
  restoreDeckPagesWidth,
  restoreSongSidebarWidth,
  showBibleWorkspace,
  showMediaWorkspace,
  showSlidesWorkspace,
  showSongsWorkspace,
  syncDeckPagesResizeHandleAria,
  verseNumbersFromSelector,
  verseSelectorFromReference,
};
