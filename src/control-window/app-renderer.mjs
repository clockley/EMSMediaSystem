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
  lowerThirdKeyOnlyMessage,
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
} from "../shared/app-media-utils.mjs";
import { createOutputCommand } from "../shared/output-compositor.mjs";
import { commandForShortcut, LIVE_COMMANDS } from "../shared/alert-shortcuts.mjs";
import { stageContentFromPresentation } from "../shared/stage-content.mjs";
import {
  firstPlayableScheduleIndex,
  isEmbeddedScheduleItem,
  isScheduleItemPlayable,
  isScheduleItemVisible,
  nextPlayableScheduleIndex,
  previousPlayableScheduleIndex,
} from "../shared/schedule-item-availability.mjs";
import {
  NAVIGATION_STATES,
  createNavigationStateMachine,
} from "../shared/global-navigation-state.mjs";
import {
  SCRIPTURE_FOLLOW_MODE,
  createScripturePresentationMachine,
  resolveScriptureSlideForCursor,
  scriptureCursorForSlide,
} from "../shared/scripture-presentation-state.mjs";
import {
  waitForLoadedMetadata,
  waitForMetadata as waitForMediaMetadata,
} from "../shared/app-media-loading-utils.mjs";
import {
  normalizeScriptureReference,
  parseScriptureReference,
} from "../shared/app-bible-reference-utils.mjs";
import { applyOperatorSelectionContrast } from "../shared/operator-selection-contrast.mjs";
import {
  bindTransportTimeDisplay,
  getHostnameOrBasename,
  paintTransportTimeDisplay,
  PIDController,
} from "../shared/app-controls-utils.mjs";
import {
  clampPptxSlideIndex as clampPptxSlideIndexValue,
  enforcePptxCoverFit,
  getElementContentSize,
  getPptxListRenderOptions,
  getPptxNaturalSlideSize,
  getPptxPdfjsConfig,
  getPptxRenderedSlideElement,
  getPptxSlideElementFromHandle,
  isSavedPptxSlideIndex,
  waitForNextFrame,
} from "../shared/app-pptx-utils.mjs";
import {
  PREVIEW_STASH_ID,
  TAB_PANEL_MEDIA_ID,
  TAB_PANEL_STREAMS_ID,
  generateDyneTabShellHTML,
  generateMediaFormHTML,
  generateNetworkItemDialogHTML,
  generateStreamsPanelHTML,
  queueTypeIconMarkup,
} from "../shared/app-ui-templates.mjs";
import {
  SCRIPTURE_ABSOLUTE_MIN_BODY_FONT_SIZE,
  SCRIPTURE_AUTOSIZE_FIT,
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
  SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND,
  SCRIPTURE_LOWER_THIRD_DEFAULT_FONT_SIZE,
  SCRIPTURE_MIN_BODY_FONT_SIZE,
  SCRIPTURE_REFERENCE_FONT_SIZE,
  applyScriptureRenderToPreview,
  bibleStyleSnapshot,
  classifyPresentationType,
  clampLowerThirdSegmentIndex,
  configureBibleScriptureRender,
  currentBibleBackgroundVideoSync,
  enrichLowerThirdPresentationMessage,
  getBibleDesignerStyle,
  installBiblePreviewScaleObserver,
  isBibleLowerThirdFeatureEnabled as isBuiltInBibleLowerThirdFeatureEnabled,
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
  scriptureReferencePresentationForBackground,
  selectedBiblePreviewOutputSize,
  setLastShownBibleStyleOverrides,
  syncBiblePreviewOutputScale,
  syncLowerThirdFeatureAvailability as syncBuiltInLowerThirdFeatureAvailability,
  waitForScriptureFonts,
} from "../shared/app-bible-scripture-render.mjs";
import { waitForTextFonts } from "../shared/text-measure.mjs";
import {
  installLowerThirdPreviewScaleObserver,
  renderLowerThirdPreview,
} from "../shared/lower-third-preview.mjs";
import {
  configureCountdown,
  handleTimeMessage,
  isImagePreviewCueActive,
  paintCountdownFor,
  resetCountdownSync,
  restoreCountdownForLiveMedia,
  updateTimestamp,
} from "../shared/app-countdown.mjs";
import {
  configureToasts,
  invalidateQueueUndoToastAfterMutation,
  resetPreviewWarningState,
  showGnomeToast,
  showPreviewWarningToast,
} from "../shared/app-toasts.mjs";
import {
  applyOutputHoldPreferences,
  configureOutputHold,
  getOutputHoldLogoSettings,
  handleOutputHoldShortcut,
  isAudienceLogoHoldActive,
  isAnyAudienceHoldActive,
  normalizeOutputHoldPreferences,
  OUTPUT_HOLD_TRANSITION_MS,
  resetAudienceOutputHold,
  syncAudienceOutputHoldAfterPresentationStart,
  toggleBlackScreen,
  toggleLogoHold,
  updateOutputHoldButtonStates,
} from "../shared/app-output-hold.mjs";
import { resolveThemeForTarget } from "../shared/theme-resolver.mjs";
import { itemThemeForRole, normalizeItemTheme, setItemThemeRole } from "../shared/theme-item-overrides.mjs";
import {
  resolvedAudienceBackgroundFields,
  resolvedFontFamilyFields,
  renderScriptureForTarget,
} from "../shared/theme-render-message.mjs";

async function showRendererConfirm(message, options = {}) {
  const result = await invoke("show-renderer-message-box", {
    type: options.type || "question",
    title: options.title || "Confirm action",
    message: String(message || "Are you sure?"),
    detail: options.detail || "",
    buttons: [options.cancelLabel || "Cancel", options.confirmLabel || "Continue"],
    defaultId: options.defaultId === 1 ? 1 : 0,
    cancelId: 0,
  });
  return result?.response === 1;
}

async function showRendererAlert(message, options = {}) {
  await invoke("show-renderer-message-box", {
    type: options.type || "info",
    title: options.title || "EMS Media System",
    message: String(message || "EMS Media System"),
    detail: options.detail || "",
    buttons: [options.buttonLabel || "OK"],
    defaultId: 0,
    cancelId: 0,
  });
}

function showRendererPrompt(message, initialValue = "", options = {}) {
  return new Promise((resolve) => {
    const dialogElement = document.createElement("dialog");
    dialogElement.className = "adw-dialog renderer-prompt-dialog";
    dialogElement.setAttribute("aria-label", options.title || "Enter text");

    const form = document.createElement("form");
    form.method = "dialog";
    form.className = "renderer-prompt-dialog__form";
    const title = document.createElement("h2");
    title.textContent = options.title || "Enter text";
    const label = document.createElement("label");
    label.className = "renderer-prompt-dialog__label";
    label.textContent = String(message || "Enter a value");
    const input = document.createElement("input");
    input.className = "renderer-prompt-dialog__input";
    input.type = "text";
    input.value = String(initialValue || "");
    input.maxLength = Number.isInteger(options.maxLength) ? options.maxLength : 200;
    input.required = options.required !== false;
    label.appendChild(input);
    const actions = document.createElement("div");
    actions.className = "renderer-prompt-dialog__actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = options.cancelLabel || "Cancel";
    cancel.addEventListener("click", () => dialogElement.close("cancel"));
    const accept = document.createElement("button");
    accept.type = "submit";
    accept.value = "accept";
    accept.className = "suggested-action";
    accept.textContent = options.confirmLabel || "Save";
    actions.append(cancel, accept);
    form.append(title, label, actions);
    dialogElement.appendChild(form);
    document.body.appendChild(dialogElement);
    dialogElement.addEventListener("close", () => {
      const value = dialogElement.returnValue === "accept" ? input.value : null;
      dialogElement.remove();
      resolve(value);
    }, { once: true });
    dialogElement.showModal();
    input.focus();
    input.select();
  });
}
import {
  DEFAULT_SONG_RENDER,
  arrangementSequenceEntries,
  enabledSongSections,
  mergeSongRenderState,
  normalizeToSongAST,
  parseSongQueuePath,
  queueEntryFromSong,
  reconcileSongPlayOrder,
  resolvedSongPresentation,
  songDefaultRenderFromRender,
  songSectionBlockTexts,
  songBlockText,
  songSectionLyricsText,
  songQueuePath,
  songRenderStateFromDefaultRender,
  songRenderFromItem,
} from "../shared/app-song-utils.mjs";
import {
  EMS_SLIDE_DECK_SCHEMA_ID,
  DEFAULT_DECK_THEME,
  DEFAULT_TEXT_FRAME,
  SONG_DECK_DOCUMENT_TYPE,
  blocksToText,
  clearTextObjectInlineStyles,
  createBlankDeck,
  createBlankPage,
  createImageObject,
  createShapeObject,
  createTextObject,
  deckDefaultRender,
  deckPagesToSongSections,
  deckQueuePath,
  deckToTransientSong,
  DEFAULT_CANVAS,
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
} from "../shared/app-slide-utils.mjs";
import {
  SONG_FOLDER_UNFILED,
  addDeckPage,
  addSlideShapeObject,
  addSlideTextBox,
  applySongEditorTextStyle,
  attachSlideCanvasInteractions,
  bindSlideUndoControlTransactions,
  buildSongLowerThirdMessage,
  buildSongQueueEntryFromDeck,
  bulkDeleteSelectedSongs,
  bulkMoveSelectedSongs,
  bulkScheduleSelectedSongs,
  chooseSlideObjectImage,
  clearLiveSongText,
  clearSongSelection,
  clearSongShowNowPresentation,
  closeSongEditor,
  closeSongFolderPrompt,
  createNewDeck,
  currentDeck,
  currentDeckIsSongDocument,
  currentPage,
  currentResolvedSongPresentation,
  currentSongActiveSection,
  currentSongEditorStyleScope,
  currentSongFolderFilter,
  currentSongPresentationItem,
  currentSongRenderState,
  currentSongSectionId,
  currentWorkspaceSong,
  currentWorkspaceSongDeck,
  deleteCurrentDeck,
  deleteDeckPage,
  deleteSongFromLibrary,
  duplicateCurrentDeck,
  duplicateDeckPage,
  ensureSongFolder,
  handleSongEditorAddSection,
  handleSongEditorCanvasTextInput,
  handleSongEditorDeleteSection,
  handleSongEditorMoveSectionDown,
  handleSongEditorMoveSectionUp,
  handleSongEditorSectionMetaChange,
  handleSongsDatabaseCleared,
  importSongFromDialog,
  initSongEditorContextMenu,
  initSongEditorTextBoxDragAndDrop,
  insertSongInSchedule,
  installSongLowerThirdPreviewScaleObserver,
  loadDeckQueueItemIntoWorkspace,
  loadSongIntoWorkspace,
  loadSongItemIntoWorkspace,
  markSongShowNowPresentation,
  navigateSongSection,
  openSlidesWorkspaceFromButton,
  openSongEditor,
  openSongFolderPrompt,
  openSongsWorkspaceFromButton,
  queueItemMatchesDeck,
  readSongEditorRenderState,
  recordSlideUndoCheckpoint,
  recordSlideUndoForMutation,
  redoSlideEdit,
  refreshSlidesFolderList,
  refreshSlidesList,
  refreshSongFolders,
  refreshSongsBrowser,
  renameCurrentDeck,
  renderDeckPageStrip,
  renderSlideCanvas,
  renderSlideEditorState,
  renderSongLowerThirdControls,
  renderSongSectionPreview,
  renderSongSlideNavigator,
  renderStateForLibrarySong,
  resetCurrentSongToThemeDefault,
  restoreLiveSongText,
  saveCurrentDeck,
  saveSongEditor,
  saveSongToSchedule,
  scheduleCurrentDeck,
  scheduleSongPreviewRerender,
  selectDeckPage,
  selectSongSection,
  sendSongLowerThirdForLiveItem,
  sendSongTextToOutput,
  setCurrentSongFolderFilter,
  setCurrentSongRenderState,
  setCurrentWorkspaceSong,
  setDeckDirty,
  setSongLowerThirdCue,
  showCuedSongLowerThird,
  showCurrentDeckNow,
  showSongTextNow,
  songDeckDocumentFromSongDocument,
  songItemForAudienceResolution,
  songSectionsFromParsedSections,
  syncActiveScheduledSongPresentation,
  syncCurrentWorkspaceSongDefaultRender,
  syncSlidesWorkspaceTitle,
  syncSongBackgroundLabel,
  syncSongEditorWorkspaceStyles,
  syncSongLowerThirdForSection,
  syncSongSlideNavigator,
  syncSongsMoveFolderSelect,
  undoSlideEdit,
  updateCurrentSlideTransitionFromControls,
  updateScheduleSongsWithUpdatedSong,
} from "./app-song-slides-workspace.mjs";
import {
  ensureMediaPanelBuilt,
  ensureStreamsPanelBuilt,
  getConfidenceMonitorElement,
  getLowerThirdConfidenceMonitorElement,
  installDisplayChangeHandler,
  isNetworkStreamSource,
  restoreLivePreview,
  restoreLivePreviewIntoPanel,
  setConfidenceMonitorActive,
  stashLivePreview,
  stopLowerThirdRendererPreviewCapture,
  stopStreamRendererPreviewCapture,
  syncConfidenceMonitorCarousel,
  syncLowerThirdRendererPreviewCapture,
  syncStageRendererPreviewCapture,
  syncStreamRendererPreviewCapture,
} from "./app-confidence-monitor.mjs";
import {
  BIBLE_VERSE_DRAG_MIME,
  applyBiblePreview,
  applyBibleReferenceSuggestion,
  applyBibleStyleToCurrentText,
  applyBibleStyleToScheduledText,
  beginScriptureTake,
  bibleDesignerState,
  bibleQueueItemDisplayName,
  bibleSearchState,
  bibleStyleDirtyState,
  bibleVerseDragPayload,
  bibleVerseDragPayloadFromDataTransfer,
  buildBibleTextMessage,
  changeBibleLowerThirdSegment,
  cleanBibleVerseTextForDisplay,
  clearBibleVerseDragVisualState,
  clearLiveBibleText,
  clearRecentScriptures,
  closeBibleLowerThirdOutput,
  commitBibleDesignerRenderState,
  confirmScriptureTake,
  currentBibleScheduleOutputSize,
  ensureBibleLowerThirdOutput,
  fallbackUnavailableBibleTranslationsOnLoad,
  hideBibleReferenceSuggestions,
  hideScheduleBibleContextMenu,
  insertBibleInSchedule,
  isBiblePresentationActive,
  isBibleReferenceSuggestionsOpen,
  isBibleWorkspaceVisible,
  isPresentationActiveForBibleLowerThird,
  jumpBibleReferenceToBrowser,
  loadBibleEntryIntoEditor,
  loadBibleVersionMetadataFromSidecar,
  normalizeBibleVersionMetadata,
  openBibleWorkspaceFromButton,
  overridesFromProjectScriptureText,
  parseBibleQueuePath,
  positionBibleReferenceSuggestionsOverlay,
  projectBibleQueueName,
  projectBibleReferenceEntryForQueueItem,
  projectBibleReferenceOnlyEntry,
  projectScriptureOverrides,
  projectScriptureTextFromOverrides,
  queueEntriesForBibleVerseDragPayload,
  reconcileBibleBrowseView,
  refreshBibleBrowser,
  refreshBibleLookupPreview,
  renderBibleReferenceSuggestions,
  renderRecentScriptures,
  resolvedBibleEntryForItem,
  resolvedBibleStyleDefaults,
  restoreBibleVersionFromSettings,
  restoreLiveBibleText,
  saveBibleTextLayoutDefaults,
  scheduleBibleSearch,
  scripturePresentation,
  selectFirstBibleReferenceForVersion,
  sendBibleLowerThirdTextMessage,
  sendBibleLowerThirdTextToOutput,
  sendBibleTextToOutput,
  setBibleDesignerVersion,
  setBibleLowerThirdSegmentIndex,
  setBibleNavigatorMode,
  setBibleStyleEditorVisible,
  showBibleTextContextMenu,
  showBibleTextNow,
  showCuedBibleLowerThird,
  showScheduleBibleContextMenu,
  syncActiveScheduledBiblePresentation,
  syncBibleBackgroundLabel,
  syncBibleDesignerStateToPreviewedQueueItem,
  syncBibleLowerThirdBarBackgroundLabel,
  syncBibleSearchControlsFromState,
  syncBibleStateFromControls,
  syncBibleStyleControlsFromState,
  syncBibleVersionAttributionDisplay,
  syncShowNowBiblePresentation,
  updateBibleReferenceSuggestionActiveState,
} from "./app-bible-workspace.mjs";
import {
  NETWORK_PREVIEW_PREROLL_BUFFER_SECONDS,
  NETWORK_PREVIEW_PREROLL_TIMEOUT_MS,
  activeNetworkPreviewHidesScrubber,
  activeNetworkPreviewSource,
  attachNetworkMediaSourceToElement,
  attachNetworkPreviewMirrorSource,
  beginNetworkPreviewStatus,
  ensureNetworkItemDialog,
  handleMediaPreviewRtcSignal,
  hideNetworkPreviewStatus,
  installNetworkItemButton,
  installNetworkPreviewStatusHandlers,
  isHlsNetworkSource,
  isNetworkVideoPreviewCueActive,
  matchYouTubeNetworkUrl,
  networkPreviewMirrorLiveEdgeMatches,
  networkPreviewRepresentsMediaFile,
  networkPreviewSourceHidesScrubber,
  networkPreviewTransportCurrentTime,
  networkPreviewTransportDuration,
  networkPreviewTransportState,
  networkPreviewUsesRendererCapture,
  playNetworkPreviewMirror,
  primeNetworkPreviewElement,
  queueItemHidesNetworkScrubber,
  refreshNetworkPreviewTransportControls,
  refreshNetworkPreviewTransportState,
  resetNetworkPreviewStatus,
  resetNetworkPreviewTransportState,
  seekNetworkPreviewTransport,
  setNetworkPreviewCueAudio,
  setNetworkPreviewElementCaptureMuted,
  setNetworkPreviewElementLocalAudio,
  setNetworkPreviewTransportPaused,
  setNetworkPreviewVolume,
  showNetworkPreviewError,
  stopNetworkPreviewRtcCapture,
  syncNetworkPreviewMirrorCapture,
  teardownNetworkPreviewCueStreamingPlayers,
  teardownNetworkPreviewStreamingPlayers,
  updateNetworkPreviewTransportState,
} from "./app-network-preview.mjs";
import {
  clampPptxSlideIndex,
  getLivePptxSlideFromMediaWindow,
  hidePptxPreview,
  hidePptxPreviewIfNeeded,
  isPptxPreviewVisible,
  loadPptxPreview,
  pptxStartSlideForItem,
  restoreNonPptxPreviewSurface,
  restorePptxPreviewForMediaTab,
  schedulePptxThumbnailRefresh,
  sendPptxSlideToMediaWindow,
  syncCurrentPptxSlideForProjectSnapshot,
} from "./app-preview-controller.mjs";
import {
  PROJECT_GUID_RE,
  acknowledgePreflightWarningForItem,
  currentProjectGuid,
  currentProjectPath,
  currentProjectStorageMode,
  exportPortableProjectDialog,
  firstDroppedProjectPath,
  flushAutosaveOnClose,
  openProjectByPath,
  openProjectDialog,
  pinQueueMediaSources,
  preflightWarningFingerprint,
  queueItemCanKeepOldMediaVersion,
  queueItemHasSafeSnapshotPin,
  queueItemNeedsDefaultSnapshotPin,
  queueItemPreflightCheckPayload,
  relinkMissingFilesDialog,
  restoreAutosavedProjectState,
  saveCurrentProjectInStorageMode,
  saveProject,
  saveProjectAsDialog,
  scheduleAutosaveProjectState,
  stampBaselineForQueueItems,
} from "./app-project-session.mjs";
import {
  applyDroppedMediaPaths,
  clearMediaQueue,
  enqueuePathsFromFilePicker,
  extractAndFilterDroppedMediaPaths,
  hideScheduleSongContextMenu,
  installMediaQueueListDelegation,
  nextPlayableQueueItemStageText,
  onClearMediaQueueClick,
  queueDropIndicator,
  queueInsertionIndexAfterSelection,
  renderQueue,
  revealNewQueueEntries,
  selectedQueueIndexForDisplay,
  selectedQueueItems,
  updateQueueSelectionVisual,
} from "./app-schedule-controller.mjs";
import {
  configureMediaLibraryWorkspace,
  hideMediaLibraryWorkspace,
  hideMediaLibraryWorkspaceForSchedulePreview,
  mediaLibraryDragIsActive,
  mediaLibraryItemIdFromDataTransfer,
  openMediaLibraryPicker,
  recordScheduledMediaPaths,
  resolveMediaLibraryDragItem,
  showMediaLibraryWorkspace,
} from "./app-media-library-workspace.mjs";
import {
  advanceQueueAfterMediaWindowClosed,
  beginLiveMediaWindowEpoch,
  claimMediaWindowEnd,
  clearCueAfterTake,
  clearPreviewCue,
  clearVideoPreviewCueOverlay,
  currentPreviewCue,
  ensurePreviewCueVideoElement,
  getPreviewCueDisplayVolume,
  handleMediaWindowClosed,
  handleRemoteMediaWindowTimeTick,
  isAudioPreviewCueActive,
  isPreviewCueVolumeActive,
  isVideoPreviewCueActive,
  loadQueueItemIntoControlWindow,
  loadQueueItemIntoPreviewCue,
  playCurrentQueueItem,
  setPreviewCueVideoLocalAudio,
  slipstreamQueueItemAtIndex,
  stopPreviewAudioCue,
  takeQueueItemLive,
  trySlipstreamNextQueueItem,
  updatePlayButtonOnMediaWindow,
  updatePreviewCueUI,
} from "./app-presentation-playback.mjs";
import {
  activeLiveLayersPage,
  addNurseryAlertFromDraft,
  applyLowerThirdOutputPreferences,
  applyThemeToLivePresentation,
  clearAudienceAlert,
  clearLiveText,
  clearLowerThirdForUnsupportedMediaSource,
  clearPrivateStageMessage,
  clearTextFromPresentationMessage,
  closeLiveLayers,
  closeStageControls,
  currentAlertsSnapshot,
  ensureStageOutput,
  handleLiveLayersTabKeydown,
  hasAudienceOutputSelected,
  hasLiveAudienceTextPresentation,
  hasLiveLowerThirdText,
  hasLowerThirdOutputSelected,
  insertAlertToken,
  liveThemeFields,
  openLiveLayers,
  openStageControls,
  selectLiveLayersPage,
  selectedDisplayValueFromSelect,
  sendAudienceTextMessage,
  sendCachedStageContent,
  sendStageLayer,
  shouldApplyLiveTextClearState,
  showAudienceAlert,
  showPrivateStageMessage,
  syncLowerThirdFeatureAvailability,
  syncStageContentFromQueueItem,
  themeLowerThirdMessageIfApplied,
  themedAudienceMessage,
  themedLowerThirdMessage,
  updateAlertComposerActions,
  updateAlertsSnapshot,
  updateClearLiveTextButtonState,
  updateLowerThirdForSupportedScheduleItem,
  updateStageStatusUi,
  useQuickAlertMessage,
} from "./app-live-outputs.mjs";
import {
  configureOutputHoldBridge,
  loadOutputHoldPreferencesFromSettings,
  prepareQueueItemUnderLogoHold,
  recoverOutputHoldsToDeckPage,
  recoverOutputHoldsToSongSection,
  releaseOutputHoldsAndGoLiveQueueIndex,
} from "./app-logo-hold.mjs";
import {
  applyPinnedMediaSource,
  approvePendingMediaUpdate,
  ensurePendingMediaUpdateApproved,
  keepPendingMediaUpdate,
  liveLoopTarget,
  liveSourcePinnedModifiedTime,
  loopControlTarget,
  loopEnabledForLiveMedia,
  loopEnabledForQueueItem,
  loopTargetEnabled,
  loopTargetSupportsLoop,
  markQueueItemMediaUpdate,
  mediaPathSupportsLoop,
  mediaPinPayloadForItem,
  mediaReadPayloadForPath,
  queueItemMediaCacheBust,
  queueItemNeedsPendingUpdateApproval,
  queueItemUsesPackagedMedia,
  refreshMissingFlagsAndWarn,
  resolveQueueItemMediaPath,
  scheduleMediaWatchSync,
  setLoopTargetEnabled,
  stagedMediaUrlForItem,
  syncMediaLoopState,
  updateLoopControlState,
} from "./app-media-loop.mjs";
import {
  applyVideoPoster,
  clearVideoPoster,
  currentPreviewSourcePath,
  currentQueuePreviewItem,
  installPreviewEmptyStateHandlers,
  previewElementSourceMatchesMediaFile,
  previewMediaSourcePath,
  queueItemOwnsControlPreview,
  resetPreviewSurfaceToEmptyState,
  restorePreviewToLiveOutput,
  restoreStagedPreviewPlayback,
  restoreWorkspacePreviewForQueueItem,
  setPreviewStackSurface,
  syncPreviewStackSurface,
  syncQueuePreviewMediaElements,
  updatePreviewEmptyState,
} from "./app-preview-surfaces.mjs";
import {
  addFilenameToTitlebar,
  closeSettingsControls,
  consumePendingCueVolume,
  executeLiveCommand,
  handleVolumeChange,
  installEvents,
  installIPCHandler,
  installPreviewEventHandlers,
  loadOpMode,
  navigationState,
  openMediaFilesDialog,
  openSettingsControls,
  populateDisplaySelect,
  removeFilenameFromTitlebar,
  renderGlobalNavigationState,
  selectNavigationForQueueItem,
  setSBFormMediaPlayer,
  setupCustomMediaControls,
  setupGtkVolumeControl,
  syncGtkSliderToCueState,
  updateDynUI,
} from "./app-operator-chrome.mjs";
import {
  MEDIA_COUNTDOWN_CHAR_BY_CODE,
  beginPidSeekSuppression,
  cleanRefs,
  countdownDigitLastCode,
  createMediaWindow,
  endLiveAudioPresentation,
  endLocalMedia,
  ensureLiveAudioElement,
  ensureMediaCountdownDigitNodes,
  ensurePreviewAudioElement,
  handleImageDisplay,
  handleMediaPlayback,
  handleMediaseek,
  handlePlayPause,
  handlePlaybackState,
  hybridSync,
  isAudioOnlyQueuePresentationActive,
  isImg,
  isLiveStream,
  isLocalAppWindowPresentationActive,
  loadLocalMediaHandler,
  loadedmetadataHandler,
  pauseLocalMedia,
  pauseMedia,
  pidSeeking,
  playAudioOnlyLocally,
  playLocalMedia,
  playMedia,
  previewMediaControlsLiveProjection,
  refreshPreviewControlsForCurrentMedia,
  resetVideoState,
  restoreMediaFile,
  saveMediaFile,
  seekLocalMedia,
  seekingLocalMedia,
  setMediaCountdownFromCodes,
  setMediaCountdownOverlayVisible,
  setMediaCountdownText,
  stopLiveAudioPresentation,
  syncPlayPauseIconToControlMedia,
  syncPreviewAudioCueAudibility,
  syncPreviewAudioTrackState,
  syncPreviewMediaAfterPresentationStateChange,
  timelineSync,
  unPauseMedia,
  vlCtl,
  waitForMediaElementBuffer,
  waitForMediaElementFrame,
  waitForMediaElementSource,
  waitForMetadata,
} from "./app-media-runtime.mjs";
import {
  SONG_SIDEBAR_MAX_WIDTH,
  SONG_SIDEBAR_MIN_WIDTH,
  clampSongSidebarWidth,
  currentSongSidebarWidth,
  hideBiblePreview,
  hideBibleWorkspace,
  hideSlidesWorkspace,
  hideSongsWorkspace,
  installBibleMediaControls,
  isPreviewWorkspaceOverlayVisible,
  isSlidesWorkspaceVisible,
  isSongsWorkspaceVisible,
  markAudiencePreviewTextSelection,
  markSongAudiencePreviewSelection,
  showBibleWorkspace,
  showMediaWorkspace,
  showSlidesWorkspace,
  showSongsWorkspace,
  verseNumbersFromSelector,
  verseSelectorFromReference,
} from "./app-workspace-shell.mjs";

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
let stageSessionIdCache = "";
let stageContentCache = { current: "Waiting for live content", next: "", profile: "current-next" };
let latestOutputStatus = null;
let lastStageCountdownSecond = -1;
let projectStageConfig = { display: "", profile: "current-next" };
let navigationStateBeforeStage = NAVIGATION_STATES.MEDIA;
navigationState.subscribe(renderGlobalNavigationState);

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

  configureMediaLibraryWorkspace({
    invoke,
    on,
    getPathForFile,
    pathToMediaUrl,
    addToSchedule: applyDroppedMediaPaths,
    showToast: showGnomeToast,
    showMediaWorkspace,
    revealSchedulePreviewForLibraryPath,
    isLivePresentationActive: () =>
      Boolean(
        isQueuePresentationActive() ||
          isActiveMediaWindow() ||
          isLocalAppWindowPresentationActive(),
      ),
  });

  globalThis.invoke = invoke;
}

/**
 * Playback tracing: when enabled, the control renderer forwards timestamped
 * transition traces to the main-process terminal (visible where `yarn start`
 * runs). Enable at runtime with
 * `localStorage.setItem("emsDebugPlayback", "1")` then reload, or set it before
 * launch. This is a diagnostics aid for the queue advance / loop / preview
 * sync race that only manifests on slower machines.
 */
let playbackTraceEnabled = false;
try {
  playbackTraceEnabled =
    globalThis.localStorage?.getItem("emsDebugPlayback") === "1";
} catch {}

function tracePlayback(...parts) {
  if (!playbackTraceEnabled) return;
  const line =
    "[app +" +
    Math.round(performance.now()) +
    "ms] " +
    parts
      .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
      .join(" ");
  try {
    send?.("playback-trace", line);
  } catch {}
  try {
    console.debug(line);
  } catch {}
}

/**
 * Timer id (or null) for the deferred reset of `pidSeeking`. Writing
 * `video.currentTime` fires BOTH a `seeking` and a `seeked` event (and
 * occasionally extra events when the browser settles), so the swallow
 * flag must outlive the first handler call — otherwise the second event
 * sees `pidSeeking === false`, falls through, and echoes a
 * `timeGoto-message` back to the projection (visible as periodic
 * pauses/glitches, especially when a hidden preview is throttled and drifts
 * enough for PID corrections to fire more often).
 * The timer is the single source of truth for when the swallow window
 * closes; handlers no longer reset the flag themselves.
 */

/**
 * Open a "swallow PID seek events" window. Any seeking/seeked event the
 * preview fires in the next ~500 ms is treated as PID-driven and is
 * NOT echoed back to the projection. Re-arming during the window just
 * pushes the timeout out — that's correct: a rapid burst of PID
 * corrections is still one logical "do not forward" period.
 */

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
let liveAudio = null;
let liveAudioQueueIndex = -1;
let previewLoadToken = 0;
let previewTransportLoadToken = null;
let networkPreviewCueHlsInstance = null;
let networkPreviewCueDashPlayer = null;
let networkPreviewCueDashManifestObjectUrl = null;
let networkPreviewCueSource = "";
let networkPreviewMirrorSource = "";
let networkPreviewMirrorLiveEdge = false;
let networkPreviewCueLiveEdge = false;
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
  onRemoteTimeTick: (duration, currentTime, timestamp, tickMediaFile) =>
    handleRemoteMediaWindowTimeTick(duration, currentTime, timestamp, tickMediaFile),
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
let logoHoldOnlyPresentation = false;
let logoHoldStagedPlayback = false;
let outputHoldRecoveryGeneration = 0;
countdownDigitLastCode.fill(-1);
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
let activeMediaWindowContentType = null;
let lastAudienceBibleTextMessage = null;
let lastAudienceSongTextMessage = null;
let lastLowerThirdBibleTextMessage = null;
let liveTextClearActive = false;
let bibleShowNowModeActive = false;
let songShowNowModeActive = false;
let songShowNowSourceId = null;
let bibleLowerThirdOutputActive = false;
let activeLowerThirdContentType = null;
let lowerThirdOutputUpdateToken = 0;
let bibleLowerThirdLiveCueKey = "";
const songLowerThirdState = {
  sourceKey: "",
  sectionId: "",
  sourceText: "",
  layoutKey: "",
  segments: [],
  index: 0,
  liveKey: "",
};
let lowerThirdPreferenceChromaKeyColor = SCRIPTURE_LOWER_THIRD_CHROMA_KEY_COLOR;
// Keep the committed theme available after the Theme Manager window closes.
// Lower-third cues are rebuilt whenever the operator changes cue, so styling
// only the message that happened to be live at apply time is not sufficient.
let appliedPresentationTheme = null;
let projectThemeDefaults = null;
let bibleUiEnabled = true;
let lowerThirdUiEnabled = true;

function resolvedThemeForItem(item, contentKind, outputRole, outputSize) {
  const selected = itemThemeForRole(item, outputRole);
  const theme = selected.theme || appliedPresentationTheme;
  if (!theme) return null;
  return resolveThemeForTarget({
    theme,
    contentKind,
    outputRole,
    outputSize,
    itemOverrides: selected.itemOverrides,
  });
}

function isBibleLowerThirdFeatureEnabled() {
  return isBuiltInBibleLowerThirdFeatureEnabled() && lowerThirdUiEnabled;
}

function scheduleAvailabilityOptions() {
  return { bibleUiEnabled };
}

function isScheduleItemCurrentlyVisible(item) {
  return isScheduleItemVisible(item, scheduleAvailabilityOptions());
}

function isScheduleItemCurrentlyPlayable(item) {
  return isScheduleItemPlayable(item, scheduleAvailabilityOptions());
}

function nextPlayableQueueIndexAfter(fromIndex) {
  return nextPlayableScheduleIndex(mediaQueue, fromIndex, scheduleAvailabilityOptions());
}

function previousPlayableQueueIndexBefore(fromIndex) {
  return previousPlayableScheduleIndex(mediaQueue, fromIndex, scheduleAvailabilityOptions());
}

function firstPlayableQueueIndex() {
  return firstPlayableScheduleIndex(mediaQueue, scheduleAvailabilityOptions());
}

function queueItemStageLabel(item) {
  if (!item) return "";
  return String(
    isQueueItemBible(item) ? bibleQueueItemDisplayName(item) : item.name || "",
  ).trim();
}

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

function queueIndexForSongId(songId) {
  if (!songId) return -1;
  return mediaQueue.findIndex((item) => {
    if (!item || (item.type !== "song" && item.type !== "deck")) return false;
    return (
      item.source?.songId === songId ||
      item.deckSnapshot?.id === songId ||
      item.source?.deckId === songId ||
      parseSongQueuePath(item.path) === songId ||
      parseDeckQueuePath(item.path)?.deckId === songId
    );
  });
}

function queueIndexForCurrentWorkspaceSong() {
  if (currentWorkspaceSongDeck?.id) {
    const byDeck = mediaQueue.findIndex((item) =>
      queueItemMatchesDeck(item, currentWorkspaceSongDeck),
    );
    if (byDeck >= 0) return byDeck;
  }
  if (currentWorkspaceSong?.id) {
    return queueIndexForSongId(currentWorkspaceSong.id);
  }
  return -1;
}

function queueIndexForCurrentDeck() {
  if (!currentDeck?.id) return -1;
  return mediaQueue.findIndex((item) => queueItemMatchesDeck(item, currentDeck));
}

// Restores whatever theme was last applied in Theme Manager so audience and
// lower-third output stay themed correctly after an app restart, instead of
// silently reverting to the unthemed default until the operator re-applies.
async function loadActiveThemeFromSettings() {
  try {
    const result = await invoke("themes:getActiveTheme");
    if (result?.theme) {
      appliedPresentationTheme = result.theme;
      projectThemeDefaults ||= {
        schema: "ems.project-themes.v1",
        bindings: { song: result.theme.id, scripture: result.theme.id, text: result.theme.id, lowerThird: result.theme.id },
        snapshots: { [result.theme.id]: { theme: result.theme } },
      };
    }
  } catch (err) {
    console.error("Failed to load active theme:", err);
  }
}

let bibleReferenceSuggestionIndex = -1;
/** @type {{ path: string, name: string, type: string, cueStartTime?: number, cueVolume?: number, loop?: boolean, pptxSlideIndex?: number }[]} */
let mediaQueue = [];
let currentQueueIndex = -1;
let previewCueIndex = -1;
let selectedQueueAnchorIndex = -1;
let queueSelectionRangeAnchorIndex = -1;
let isQueuePlaying = false;
let manualBoundaryPauseIndex = -1;
let globalSlideTransitionState = { ...DEFAULT_SLIDE_TRANSITION };
const PPTX_SIDEBAR_STORAGE_KEY = "ems.pptxSidebarWidth";
const PPTX_SIDEBAR_DEFAULT_WIDTH = 320;
const PPTX_SIDEBAR_MIN_WIDTH = 220;
const PPTX_SIDEBAR_MAX_WIDTH = 560;
/** True after natural playback end (signaled before media window closes). */
let mediaPlaybackEndedPending = false;
/**
 * Monotonic id of the clip currently live in the audience media window. It is
 * bumped every time a new clip starts projecting (window created or
 * slipstreamed in). The projection window fires its natural-end IPC
 * (media-playback-ended) while the control side may be mid-transition on a
 * slower machine, and a stale/duplicate end can arrive after the control side
 * has already advanced. Keying the end-of-clip decision to this epoch makes it
 * idempotent so a duplicate/stale end can neither replay the finished clip
 * ("loop") nor advance past the clip the mirror is still showing (desync).
 */
let liveMediaWindowEpoch = 0;
/** liveMediaWindowEpoch whose natural end has already driven a transition. */
let consumedMediaWindowEndEpoch = -1;
/** True when the operator pressed Stop, so the close must not advance the queue. */
let userStopPresentationPending = false;
let presentationStartInProgress = false;
let queueSlipstreamTransitionInProgress = false;
/** When set, closing the media window switches to this queue index instead of advancing/stopping. */
let pendingQueueSwitchIndex = null;
let pendingQueueSwitchStartTime = 0;
let suppressPreviewForwarding = false;
/**
 * Re-entrancy depth for preview→projection forwarding suppression. The mirror
 * play/pause helpers can overlap on slower machines (a slipstream's mirror
 * play races the projection's "playing" state event, which also plays the
 * mirror). A boolean save/restore leaves the flag stuck "true" when the nested
 * calls' finally blocks run out of order — which suppresses all scrub/seek and
 * play-pause forwarding, so the operator loses control of the media window
 * after an advance. A counter is order-independent: suppression is active iff
 * depth > 0.
 */
let previewForwardingSuppressionDepth = 0;
function beginPreviewForwardingSuppression() {
  previewForwardingSuppressionDepth += 1;
  suppressPreviewForwarding = true;
}
function endPreviewForwardingSuppression() {
  previewForwardingSuppressionDepth = Math.max(
    0,
    previewForwardingSuppressionDepth - 1,
  );
  suppressPreviewForwarding = previewForwardingSuppressionDepth > 0;
}
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
let queueInsertionSelectionExplicit = false;
let songDragSongId = "";
const SONG_DRAG_MIME = "application/x-ems-song-id";
let queueDropIndicatorIndex = -1;
/** Last <video> element that received cubic waveshaper wiring. */
let cubicWaveShaperAttachedVideo = null;

function isNonVideoPresentationItem(filePath) {
  return isNonVideoPresentationPath(filePath, isImg);
}

function syncSongResizeHandleAria(width = currentSongSidebarWidth()) {
  const handle = document.getElementById("songSidebarResizeHandle");
  if (!handle) return;
  const safeWidth = clampSongSidebarWidth(width);
  handle.setAttribute("aria-valuemin", String(SONG_SIDEBAR_MIN_WIDTH));
  handle.setAttribute("aria-valuemax", String(SONG_SIDEBAR_MAX_WIDTH));
  handle.setAttribute("aria-valuenow", String(safeWidth));
  handle.setAttribute("aria-valuetext", `Song slides pane width ${safeWidth} pixels`);
}

function isQueueItemAutoAdvanceEnabled(index) {
  if (index < 0 || index >= mediaQueue.length) return true;
  return mediaQueue[index]?.autoAdvance !== false;
}

function isNextQueueItemAutoAdvanceEnabled() {
  const nextIndex = nextQueueBoundaryIndex();
  if (nextIndex < 0) return false;
  return isQueueItemAutoAdvanceEnabled(nextIndex);
}

function shouldAutoTransitionToIndex(nextIndex) {
  if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= mediaQueue.length) {
    return false;
  }
  if (!isScheduleItemCurrentlyPlayable(mediaQueue[nextIndex])) return false;
  return isQueueItemAutoAdvanceEnabled(nextIndex);
}

function shouldAdvanceAfterCurrentItemEnds() {
  if (loopEnabledForLiveMedia()) return false;
  return shouldAutoTransitionToIndex(nextQueueBoundaryIndex());
}

function nextQueueBoundaryIndex() {
  const cue = currentPreviewCue();
  if (
    cue &&
    cue.index !== currentQueueIndex &&
    isScheduleItemCurrentlyPlayable(cue.item)
  ) {
    return cue.index;
  }
  return nextPlayableQueueIndexAfter(currentQueueIndex);
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
    if (previewMediaElementNeedsBufferedStart(mediaEl)) {
      await waitForMediaElementBuffer(mediaEl);
    }
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

function previewMediaElementNeedsBufferedStart(mediaEl) {
  if (!mediaEl || mediaEl.srcObject) return false;
  if (mediaEl === previewCueVideo) {
    return isNetworkVideoPreviewCueActive();
  }
  if (mediaEl !== video || networkPreviewUsesRendererCapture()) {
    return false;
  }
  const source =
    networkPreviewMirrorSource ||
    activePreviewResolvedMediaFile ||
    mediaFile ||
    mediaEl.currentSrc ||
    mediaEl.src ||
    "";
  return isNetworkStreamSource(source) || isHlsNetworkSource(source);
}

async function playLivePreviewMirrorSafely(context = "") {
  if (!video || isImg(video.src)) return false;
  beginPreviewForwardingSuppression();
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
    endPreviewForwardingSuppression();
  }
}

async function pauseLivePreviewMirrorFromProjection(playbackState) {
  if (!video || video.paused) return;
  beginPreviewForwardingSuppression();
  try {
    if (Number.isFinite(playbackState?.currentTime)) {
      video.currentTime = playbackState.currentTime;
    }
    await video.pause();
  } finally {
    endPreviewForwardingSuppression();
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

function beginPreviewTransportLoad(token) {
  previewTransportLoadToken = token;
  if (timeline) timeline.disabled = true;
}

function finishPreviewTransportLoad(token) {
  if (previewTransportLoadToken !== token) return;
  previewTransportLoadToken = null;
  refreshPreviewControlsForCurrentMedia();
}

function previewTransportLoadIsPending() {
  return previewTransportLoadToken !== null;
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

function queueItemSupportsCueStartTime(item) {
  return Boolean(
    item &&
      !isQueueItemBible(item) &&
      !isQueueItemImage(item) &&
      !isQueueItemPptx(item) &&
      !queueItemIsLiveEdgeStream(item) &&
      (isQueueItemAudio(item) || isQueueItemVideo(item) || item.type === "file"),
  );
}

function queueItemIsLiveEdgeStream(item) {
  if (!item) return false;
  const network = item.networkSource;
  if (
    networkPreviewMirrorLiveEdgeMatches(
      item.path,
      item.originalPath,
      item.liveSource?.originalPath,
    )
  ) {
    return true;
  }
  if (
    networkPreviewSourceHidesScrubber(item.path) ||
    networkPreviewSourceHidesScrubber(item.originalPath) ||
    networkPreviewSourceHidesScrubber(item.liveSource?.originalPath)
  ) {
    return true;
  }
  if (network?.kind === "stream" || network?.isLive === true) return true;
  if (network?.kind === "video" || network?.kind === "audio") return false;
  if (network && matchYouTubeNetworkUrl(item.path)) return false;
  return isLiveStream(item.path);
}

function queueItemCueStartTime(item) {
  return normalizedQueueItemCueStartTime(item);
}

function normalizedQueueItemCueStartTime(item, value = item?.cueStartTime) {
  if (!queueItemSupportsCueStartTime(item)) return 0;
  const duration =
    Number.isFinite(item?.duration) && item.duration > 0 ? item.duration : 0;
  return clampQueueStartTime(value, duration);
}

function clearUnsupportedQueueItemCueStartTime(item) {
  if (!item || queueItemSupportsCueStartTime(item)) return false;
  if (!Number.isFinite(item.cueStartTime) || item.cueStartTime === 0) {
    item.cueStartTime = 0;
    return false;
  }
  item.cueStartTime = 0;
  return true;
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

function isLikelyVideoItem(filePath) {
  return classifyQueueMediaType(filePath) === "video";
}

function isLikelyAudioItem(filePath) {
  return classifyQueueMediaType(filePath) === "audio";
}

function mediaElementComparableSource(mediaEl = video) {
  const src = mediaEl?.src || "";
  if (!src) return "";
  try {
    return src.startsWith("file://") ? removeFileProtocol(decodeURI(src)) : decodeURI(src);
  } catch {
    return src;
  }
}

function mediaSourcesMatch(left, right) {
  return Boolean(
    left &&
      right &&
      normalizeMediaPathForCompare(left) === normalizeMediaPathForCompare(right),
  );
}

function queueItemMatchesAnySource(item, sources) {
  if (!item || !Array.isArray(sources) || sources.length === 0) return false;
  const candidates = [
    item.path,
    item.originalPath,
    item.liveSource?.originalPath,
  ];
  return candidates.some((candidate) =>
    sources.some((source) => mediaSourcesMatch(candidate, source)),
  );
}

function normalizeLiveEdgeQueueItemsForSources(...sources) {
  let changed = false;
  mediaQueue.forEach((item) => {
    if (!queueItemMatchesAnySource(item, sources)) return;
    if (item.networkSource && typeof item.networkSource === "object") {
      if (item.networkSource.isLive !== true) {
        item.networkSource.isLive = true;
        changed = true;
      }
    }
    if (clearUnsupportedQueueItemCueStartTime(item)) {
      changed = true;
    }
  });
  if (changed) {
    renderQueue();
    updatePreviewCueUI();
    scheduleAutosaveProjectState();
  }
  return changed;
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

/**
 * True when the dedicated cue overlay holds a loaded video cue. Used by
 * the controls so the timeline / play button drive the cue overlay
 * instead of the live mirror while the operator is scrubbing.
 */

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

let mediaWatchSyncTimer = null;

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
  if (cue && isScheduleItemCurrentlyPlayable(cue.item)) {
    return cue.index;
  }
  if (
    currentQueueIndex >= 0 &&
    currentQueueIndex < mediaQueue.length &&
    isScheduleItemCurrentlyPlayable(mediaQueue[currentQueueIndex])
  ) {
    return currentQueueIndex;
  }
  if (currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length) {
    const afterCurrent = nextPlayableQueueIndexAfter(currentQueueIndex);
    if (afterCurrent >= 0) return afterCurrent;
  }
  const firstPlayable = firstPlayableQueueIndex();
  return firstPlayable >= 0 ? firstPlayable : 0;
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
  if (currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length) {
    nextIdx = nextPlayableQueueIndexAfter(currentQueueIndex);
  } else if (currentQueueIndex < 0) {
    nextIdx = firstPlayableQueueIndex();
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
  if (mediaQueue.length === 0 || currentQueueIndex <= 0) return null;
  const prevIdx = previousPlayableQueueIndexBefore(currentQueueIndex);
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

function queueIndexIsLiveForDisplay(index) {
  if (!queueIndexInRange(index) || index !== currentQueueIndex) return false;
  if (isQueuePresentationActive()) return true;
  if (userStopPresentationPending || pendingQueueSwitchIndex !== null) return false;

  const item = mediaQueue[index];
  if (!item || !(isPlaying || isActiveMediaWindow() || isLocalAppWindowPresentationActive())) {
    return false;
  }

  const activePath = activeResolvedMediaFile || activePreviewResolvedMediaFile || mediaFile;
  if (
    activePath &&
    item.path &&
    normalizeMediaPathForCompare(activePath) === normalizeMediaPathForCompare(item.path)
  ) {
    return true;
  }

  if (isQueueItemSong(item)) return activeMediaWindowContentType === "song";
  if (isQueueItemBible(item)) {
    return activeMediaWindowContentType === "bible" || bibleLowerThirdOutputActive;
  }
  if (isQueueItemPptx(item)) return activeMediaWindowContentType === "pptx";
  if (isQueueItemImage(item)) return activeMediaWindowContentType === "image";
  if (isQueueItemAudio(item)) return isLocalAppWindowPresentationActive();
  if (isQueueItemVideo(item)) return activeMediaWindowContentType === "video";
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
  if (index < 0 || index >= mediaQueue.length) return false;
  const render = opts?.render !== false;
  if (!queueItemSupportsCueStartTime(mediaQueue[index])) {
    if (clearUnsupportedQueueItemCueStartTime(mediaQueue[index])) {
      if (render) {
        renderQueue();
      } else {
        updateQueueItemCueStartDisplay(index);
      }
      scheduleAutosaveProjectState();
    }
    return false;
  }
  const itemDuration =
    Number.isFinite(mediaQueue[index]?.duration) && mediaQueue[index].duration > 0
      ? mediaQueue[index].duration
      : 0;
  const safe = clampQueueStartTime(start, itemDuration);
  const prev = Number.isFinite(mediaQueue[index].cueStartTime) ? mediaQueue[index].cueStartTime : 0;
  if (Math.abs(prev - safe) < 0.001) return false;
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
  return true;
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
  if (isVideoPreviewCueActive()) {
    const safe = Math.max(0, Math.min(1, Number.isFinite(vol) ? vol : 1));
    previewCueVideo.volume = safe;
    previewCueVideo.muted = safe === 0;
    previewCueVideo.defaultMuted = false;
  }
}

function getLivePreviewDisplayVolume() {
  if (networkPreviewUsesRendererCapture()) {
    return networkPreviewTransportState.muted
      ? 0
      : networkPreviewTransportState.volume;
  }
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

/**
 * Resolve the dedicated cue-scrub <video> element. The element lives next
 * to #preview in the wrapper and is recreated whenever the media form is
 * regenerated, so this lookup is best done lazily on each access.
 */

function activePresentationOwnsPreviewAudio() {
  return Boolean(
    isQueuePresentationActive() ||
      isActiveMediaWindow() ||
      isLocalAppWindowPresentationActive() ||
      isPlaying,
  );
}

function mediaElementBufferedAhead(mediaEl) {
  if (!mediaEl?.buffered || typeof mediaEl.buffered.length !== "number") return 0;
  const current = Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : 0;
  let bestAhead = 0;
  for (let i = 0; i < mediaEl.buffered.length; i += 1) {
    let start = 0;
    let end = 0;
    try {
      start = mediaEl.buffered.start(i);
      end = mediaEl.buffered.end(i);
    } catch {
      continue;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    if (current >= start && current <= end) {
      bestAhead = Math.max(bestAhead, end - current);
    } else if (current < start) {
      bestAhead = Math.max(bestAhead, end - start);
    }
  }
  return bestAhead;
}

async function waitForCueVideoMetadata(el, itemIsNetworkVideo) {
  if (itemIsNetworkVideo) {
    await waitForMediaElementSource(el);
  }
  try {
    await waitForLoadedMetadata(el);
  } catch (err) {
    if (itemIsNetworkVideo && !el?.error) {
      return;
    }
    throw err;
  }
}

/**
 * Load a queued video item into the dedicated cue overlay, seek it to the
 * cue start, and reveal it on top of the live mirror. The main #preview
 * element is never touched, so the live mirror keeps playing the whole
 * time the operator scrubs the cued item.
 */

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

function syncScheduleAfterBibleFeatureChange() {
  if (!bibleUiEnabled) {
    const liveBible =
      isQueuePresentationActive() &&
      queueIndexInRange(currentQueueIndex) &&
      isQueueItemBible(mediaQueue[currentQueueIndex]);
    if (!liveBible && queueIndexInRange(currentQueueIndex) && isQueueItemBible(mediaQueue[currentQueueIndex])) {
      const next = nextPlayableQueueIndexAfter(currentQueueIndex);
      const previous = previousPlayableQueueIndexBefore(currentQueueIndex);
      const target = next >= 0 ? next : previous;
      currentQueueIndex = target;
      setSelectedQueueAnchor(target);
    }
    if (queueIndexInRange(previewCueIndex) && isQueueItemBible(mediaQueue[previewCueIndex])) {
      clearPreviewCue();
    }
    if (
      queueIndexInRange(selectedQueueAnchorIndex) &&
      isQueueItemBible(mediaQueue[selectedQueueAnchorIndex])
    ) {
      const next = nextPlayableQueueIndexAfter(selectedQueueAnchorIndex);
      const previous = previousPlayableQueueIndexBefore(selectedQueueAnchorIndex);
      setSelectedQueueAnchor(next >= 0 ? next : previous);
    }
  }
  renderQueue();
}

function queueIndexInRange(index) {
  return Number.isInteger(index) && index >= 0 && index < mediaQueue.length;
}

function setSelectedQueueAnchor(index, options = {}) {
  const previousIndex = selectedQueueAnchorIndex;
  selectedQueueAnchorIndex = queueIndexInRange(index) ? index : -1;
  if (options.explicit === true) {
    queueInsertionSelectionExplicit = selectedQueueAnchorIndex >= 0;
  } else if (options.explicit === false || selectedQueueAnchorIndex !== previousIndex) {
    queueInsertionSelectionExplicit = false;
  }
  queueSelectionRangeAnchorIndex = selectedQueueAnchorIndex;
  selectedQueueItems.clear();
  if (selectedQueueAnchorIndex >= 0) {
    selectedQueueItems.add(mediaQueue[selectedQueueAnchorIndex]);
  }
}

function shiftQueueIndexesForInsertion(insertIndex, count) {
  if (count <= 0) return;
  if (currentQueueIndex >= insertIndex) currentQueueIndex += count;
  if (previewCueIndex >= insertIndex) previewCueIndex += count;
  if (selectedQueueAnchorIndex >= insertIndex) selectedQueueAnchorIndex += count;
  if (queueSelectionRangeAnchorIndex >= insertIndex) queueSelectionRangeAnchorIndex += count;
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
  revealNewQueueEntries(nextEntries);
  return insertIndex;
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

function dataTransferHasType(dataTransfer, mimeType) {
  return Boolean(
    dataTransfer?.types &&
      Array.from(dataTransfer.types).includes(mimeType),
  );
}

/**
 * Show the large "Drop media here / or click Add Media" target on the preview
 * surface only when there is no media to look at — empty queue, no preview
 * source loaded, and we're on the Media tab. The drop itself is already
 * accepted by the document-level drop handler; this overlay is purely a
 * first-use affordance so removing the sidebar Open Media block does not
 * leave the empty state without a call to action.
 */

/**
 * The headerbar Add Media button only makes sense in the schedule view. Hide
 * it in legacy/non-media modes instead of leaving a dead control.
 */

function audienceTextMessageForSend(type, message, options = {}) {
  if (!message || typeof message !== "object") return message;
  return shouldApplyLiveTextClearState(type, options)
    ? clearTextFromPresentationMessage(message)
    : message;
}

function alertQueueRow(alert, live = false, nursery = false) {
  const row = document.createElement("div");
  row.className = `alert-queue-row${live ? " is-live" : ""}`;
  const label = document.createElement("span");
  label.textContent = nursery ? alert.identifier : `${live ? "Live · " : "Queued · "}${alert.message}`;
  row.appendChild(label);
  if (!nursery && !live) {
    const priority = document.createElement("button");
    priority.type = "button";
    priority.textContent = "Show Now";
    priority.addEventListener("click", async () => updateAlertsSnapshot(await invoke("alerts:prioritize", alert.id)));
    row.appendChild(priority);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = live ? "Stop" : "Remove";
  remove.setAttribute("aria-label", `Remove ${nursery ? "nursery alert" : "message alert"}`);
  remove.addEventListener("click", async () => {
    const channel = nursery ? "nursery-alerts:remove" : "alerts:remove";
    updateAlertsSnapshot(await invoke(channel, alert.id));
  });
  row.appendChild(remove);
  return row;
}

function appendQuickMessageGroup(select, label, messages) {
  if (!messages.length) return;
  const group = document.createElement("optgroup");
  group.label = label;
  for (const item of messages) {
    const message = typeof item === "string" ? item : item.message;
    if (!message) continue;
    const option = document.createElement("option");
    option.value = message;
    option.textContent = message;
    option.dataset.tokenDefinitions = JSON.stringify(
      typeof item === "object" && item.tokenDefinitions ? item.tokenDefinitions : {},
    );
    option.dataset.dismissAtCountdownEnd = String(
      typeof item === "object" && item.dismissAtCountdownEnd === true,
    );
    group.appendChild(option);
  }
  select.appendChild(group);
}

function normalizedCueMatchText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * True while the lower-third output is showing content. A window left open on
 * nothing but its key color (because the live schedule item does not support
 * lower thirds) has no content to clear or restore.
 */

function restoreOperatingMode(mode) {
  const targetMode = MEDIAPLAYER;
  if (currentMode === targetMode) return;
  const radio = document.getElementById("MdPlyrRBtnFrmID");
  if (radio) radio.checked = true;
  setSBFormMediaPlayer();
  installPreviewEventHandlers();
}

/**
 * Compute and stamp baseline integrity metadata ({fileHash, sizeBytes,
 * modifiedTime}) onto queue items so the load-time preflight and future change
 * detection have something to compare against. By default only items missing a
 * baseline are stamped; pass { force: true } to re-stamp from current disk state
 * for items without unresolved Keep/Reload decisions.
 */

/**
 * Convert a renderer-supplied DataTransfer into native paths and forward them
 * to the main process for media-extension filtering. The drop event itself
 * must be observed in the renderer (Electron does not surface DOM drop events
 * to the main process), but every validation/decision step lives in main.
 *
 * @returns {Promise<string[]>} filtered, allowed media paths
 */

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
      networkSource: x.networkSource && typeof x.networkSource === "object"
        ? { ...x.networkSource }
        : undefined,
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

  const live = queueItemIsLiveEdgeStream(item);
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

  await createMediaWindow({
    seekOnly: !live,
    startTime: live ? 0 : validMediaStartTime(seekTime),
  });
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
      networkSource: x.networkSource && typeof x.networkSource === "object"
        ? { ...x.networkSource }
        : undefined,
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

async function openThemeManagerForQueueItem(index, outputRole = "audience") {
  if (!queueIndexInRange(index)) return;
  const item = mediaQueue[index];
  const contentKind = isQueueItemBible(item) ? "scripture" : item.type === "song" || item.type === "deck" ? "song" : null;
  if (!contentKind) return;
  await invoke("open-theme-manager-window", {
    scope: "item",
    queueIndex: index,
    contentKind,
    outputRole,
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

/**
 * Make the preview empty-state placard click/Enter/Space-activatable. The
 * card itself is in the dynamically-rendered media form, so handlers are
 * (re)installed each time setSBFormMediaPlayer rebuilds `#dyneForm`. The
 * card is purely a fallback affordance — drops anywhere on the document
 * still work, and the headerbar Add Media button does the same thing.
 */

/**
 * Tear down any loaded cue source on the overlay and hide it. The main
 * #preview element is left untouched so the live mirror keeps playing.
 */

function cueFromCurrentPosition() {
  const index = currentCueEditableQueueIndex();
  const controlMedia = getPreviewControlMediaElement();

  if (index < 0 || !controlMedia) {
    const selectedIndex = selectedQueueIndexForDisplay();
    const selectedItem =
      selectedIndex >= 0 && selectedIndex < mediaQueue.length ? mediaQueue[selectedIndex] : null;
    if (queueItemIsLiveEdgeStream(selectedItem)) {
      showGnomeToast("Live streams start at the live position");
    }
    return;
  }

  const start =
    Number.isFinite(controlMedia.currentTime) && controlMedia.currentTime > 0
      ? controlMedia.currentTime
      : 0;

  if (setCueStartTime(index, start)) {
    showGnomeToast(`Cued start: ${formatCueTime(queueItemCueStartTime(mediaQueue[index]))}`);
  } else if (queueItemIsLiveEdgeStream(mediaQueue[index])) {
    showGnomeToast("Live streams start at the live position");
  }
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

async function confirmLiveSwitchAccepted(targetItem) {
  if (!shouldConfirmLiveSwitch(targetItem)) return true;

  const liveItem = currentLiveQueueItemForSwitchPrompt();
  const liveLabel = liveItem
    ? liveItem.name
    : activeLiveStream || isLiveStream(mediaFile)
      ? "the current live stream"
      : "the current presentation";
  const targetLabel = targetItem?.name || "the selected item";
  const message = `Switch the live presentation from "${liveLabel}" to "${targetLabel}"?`;

  return showRendererConfirm(message, {
    title: "Switch live presentation?",
    confirmLabel: "Switch",
  });
}

async function switchQueueItemLiveWithConfirmation(index, startTime = 0) {
  if (index < 0 || index >= mediaQueue.length) return;
  if (!isScheduleItemCurrentlyPlayable(mediaQueue[index])) {
    const next = nextPlayableQueueIndexAfter(index);
    if (next < 0) {
      showGnomeToast("No playable items in the schedule");
      return;
    }
    return switchQueueItemLiveWithConfirmation(next, startTime);
  }
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
  if (!(await confirmLiveSwitchAccepted(item))) return;

  const itemStart =
    queueItemSupportsCueStartTime(item) && Number.isFinite(startTime) && startTime > 0
      ? startTime
      : queueItemCueStartTime(mediaQueue[index]);
  await takeQueueItemLive(index, itemStart);
}

async function onQueueItemActivate(index) {
  if (index < 0 || index >= mediaQueue.length) return;
  if (isAudienceLogoHoldActive() && isActiveMediaWindow()) {
    await prepareQueueItemUnderLogoHold(index);
    return;
  }
  if (isAnyAudienceHoldActive() && isActiveMediaWindow()) {
    setSelectedQueueAnchor(index);
    updateQueueSelectionVisual();
    return;
  }
  setSelectedQueueAnchor(index);

  // Audio-only items play locally without a media window, but they're still
  // an active presentation: prompt before swapping them out.
  const isLocalPresentation = isLocalAppWindowPresentationActive();

  if (!isActiveMediaWindow() && !isLocalPresentation) {
    const activateIndex = index;
    const item = mediaQueue[activateIndex];
    await clearLowerThirdForUnsupportedMediaSource(item);
    hideMediaLibraryWorkspaceForSchedulePreview();
    if (!isQueueItemBible(item)) hideBibleWorkspace();
    if (!isQueueItemSong(item) || isQueueItemDeck(item)) hideSongsWorkspace();
    if (!isQueueItemDeck(item)) hideSlidesWorkspace();
    syncPreviewStackSurface();
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

  hideMediaLibraryWorkspaceForSchedulePreview();
  syncPreviewStackSurface();
  await loadQueueItemIntoPreviewCue(index);
}

function revealSchedulePreviewForLibraryPath(localPath) {
  if (!localPath) return false;
  const normalized = normalizeMediaPathForCompare(localPath);
  if (!normalized) return false;
  const candidates = [selectedQueueAnchorIndex, currentQueueIndex, previewCueIndex];
  for (const index of candidates) {
    if (!queueIndexInRange(index)) continue;
    if (normalizeMediaPathForCompare(mediaQueue[index]?.path) !== normalized) continue;
    hideMediaLibraryWorkspaceForSchedulePreview();
    syncPreviewStackSurface();
    void onQueueItemActivate(index);
    return true;
  }
  return false;
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
    setSelectedQueueAnchor(index);
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
    // The preview mirror loads media via pathToMediaUrl, which appends a
    // "?v=<hash>" cache-bust. The projection and queue entries carry the raw
    // path, so comparisons (mediaPathMatchesCurrentLiveMedia, endLocalMedia,
    // previewShowsSameClipAsPath) would spuriously fail without dropping it.
    s = s.replace(/[?&]v=[^?&]*$/, "");
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

/**
 * Mark that a new clip has become live in the audience media window. Its
 * natural end can now be claimed exactly once by whichever end signal (the
 * projection IPC or a fallback) arrives first.
 */

/**
 * Claim the natural end of the clip currently live in the media window so that
 * exactly one queue transition happens per clip. Returns false when this
 * clip's end was already consumed — a duplicate or stale "ended" signal that,
 * on slower machines, can arrive after the control side has already moved on
 * and would otherwise replay the finished clip or double-advance the queue.
 */

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

/**
 * When a video finishes playing and the next queue item is also a video or
 * image, send a slipstream command to keep the media window alive and load the
 * new file directly rather than tearing down and recreating the window.
 * Returns true if slipstream was dispatched, false if normal close should proceed.
 */

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

/**
 * Re-sync the GTK volume slider to reflect whichever source owns the
 * controls: the cued item (pendingCueVolume) or the live output (video.volume).
 */

/**
 * If the operator changed volume while a cue was loaded, that value was held
 * in pendingCueVolume (and on the queue entry as cueVolume) to avoid
 * disturbing the live output. Consume it here — right before playback begins.
 */

// Lower-third builders always run their output through
// themeLowerThirdMessageIfApplied, so a theme applied in Theme Manager keeps
// styling every subsequent lower third. Audience (fullscreen) sends had no
// equivalent, so once the live re-push in applyThemeToLivePresentation fired
// once, the very next bible/song cue would silently revert to the unthemed
// look. Routing every audience send through this keeps them in sync too.
function themeAudienceMessageIfApplied(message, contentKind) {
  if (message?.resolvedTheme?.themeId) return message;
  if (!appliedPresentationTheme || !message) return message;
  const outputSize = selectedBiblePreviewOutputSize("dspSelct");
  const resolved = resolveThemeForTarget({
    theme: appliedPresentationTheme,
    contentKind,
    outputRole: "audience",
    outputSize,
  });
  return themedAudienceMessage(message, resolved);
}

/**
 * Paint HH:MM:SS.mmm into fixed per-digit text nodes using pre-cached
 * single-character strings — avoids String.fromCharCode on every RAF/IPC tick.
 */

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

/**
 * `get-platform` cannot change without an app restart — caching avoids an IPC
 * round-trip on every media view activation after playback has been running
 * in the background.
 */

function removeFileProtocol(filePath) {
  return filePath.slice(7);
}

/**
 * Play the currently-loaded audio-only file in the local preview <video>
 * without creating a fullscreen media window. Audio-only files do not need
 * a presentation surface, and creating one (then having nothing visible)
 * confuses users and can race the window's open/close lifecycle.
 */

async function bootstrapRenderer() {
  await waitForPreloadBridge();
  attachElectronBridge();
  configureOutputHoldBridge();
  await loadOutputHoldPreferencesFromSettings();
  await loadActiveThemeFromSettings();
  installIPCHandler();
  installEvents();
  return invoke("get-setting", "operating-mode").then(loadOpMode);
}

function setSharedRendererState(patch) {
  if (Object.hasOwn(patch, "previewAudio")) previewAudio = patch.previewAudio;
  if (Object.hasOwn(patch, "liveAudio")) liveAudio = patch.liveAudio;
  if (Object.hasOwn(patch, "liveStartToken")) liveStartToken = patch.liveStartToken;
  if (Object.hasOwn(patch, "isHandlingLiveEnded")) isHandlingLiveEnded = patch.isHandlingLiveEnded;
  if (Object.hasOwn(patch, "activeLiveStream")) activeLiveStream = patch.activeLiveStream;
  if (Object.hasOwn(patch, "mediaSessionPause")) mediaSessionPause = patch.mediaSessionPause;
  if (Object.hasOwn(patch, "presentationStartInProgress")) presentationStartInProgress = patch.presentationStartInProgress;
  if (Object.hasOwn(patch, "playbackStateSyncGeneration")) playbackStateSyncGeneration = patch.playbackStateSyncGeneration;
  if (Object.hasOwn(patch, "desiredProjectionPreviewPlayback")) desiredProjectionPreviewPlayback = patch.desiredProjectionPreviewPlayback;
  if (Object.hasOwn(patch, "latestExplicitProjectionPauseState")) latestExplicitProjectionPauseState = patch.latestExplicitProjectionPauseState;
  if (Object.hasOwn(patch, "lastStageCountdownSecond")) lastStageCountdownSecond = patch.lastStageCountdownSecond;
  if (Object.hasOwn(patch, "currentMode")) currentMode = patch.currentMode;
  if (Object.hasOwn(patch, "img")) img = patch.img;
  if (Object.hasOwn(patch, "playPauseBtn")) playPauseBtn = patch.playPauseBtn;
  if (Object.hasOwn(patch, "playPauseIcon")) playPauseIcon = patch.playPauseIcon;
  if (Object.hasOwn(patch, "timeline")) timeline = patch.timeline;
  if (Object.hasOwn(patch, "currentTimeDisplay")) currentTimeDisplay = patch.currentTimeDisplay;
  if (Object.hasOwn(patch, "volumePopupOpen")) volumePopupOpen = patch.volumePopupOpen;
  if (Object.hasOwn(patch, "durationTimeDisplay")) durationTimeDisplay = patch.durationTimeDisplay;
  if (Object.hasOwn(patch, "repeatButton")) repeatButton = patch.repeatButton;
  if (Object.hasOwn(patch, "videoWrapper")) videoWrapper = patch.videoWrapper;
  if (Object.hasOwn(patch, "focusableControls")) focusableControls = patch.focusableControls;
  if (Object.hasOwn(patch, "controlsOverlay")) controlsOverlay = patch.controlsOverlay;
  if (Object.hasOwn(patch, "cubicWaveShaperAttachedVideo")) cubicWaveShaperAttachedVideo = patch.cubicWaveShaperAttachedVideo;
  if (Object.hasOwn(patch, "pidController")) pidController = patch.pidController;
  if (Object.hasOwn(patch, "prePathname")) prePathname = patch.prePathname;
  if (Object.hasOwn(patch, "mediaWatchSyncTimer")) mediaWatchSyncTimer = patch.mediaWatchSyncTimer;
  if (Object.hasOwn(patch, "outputHoldRecoveryGeneration")) outputHoldRecoveryGeneration = patch.outputHoldRecoveryGeneration;
  if (Object.hasOwn(patch, "stageSessionIdCache")) stageSessionIdCache = patch.stageSessionIdCache;
  if (Object.hasOwn(patch, "latestOutputStatus")) latestOutputStatus = patch.latestOutputStatus;
  if (Object.hasOwn(patch, "navigationStateBeforeStage")) navigationStateBeforeStage = patch.navigationStateBeforeStage;
  if (Object.hasOwn(patch, "lastAudienceBibleTextMessage")) lastAudienceBibleTextMessage = patch.lastAudienceBibleTextMessage;
  if (Object.hasOwn(patch, "lastAudienceSongTextMessage")) lastAudienceSongTextMessage = patch.lastAudienceSongTextMessage;
  if (Object.hasOwn(patch, "lowerThirdOutputUpdateToken")) lowerThirdOutputUpdateToken = patch.lowerThirdOutputUpdateToken;
  if (Object.hasOwn(patch, "lowerThirdPreferenceChromaKeyColor")) lowerThirdPreferenceChromaKeyColor = patch.lowerThirdPreferenceChromaKeyColor;
  if (Object.hasOwn(patch, "bibleUiEnabled")) bibleUiEnabled = patch.bibleUiEnabled;
  if (Object.hasOwn(patch, "lowerThirdUiEnabled")) lowerThirdUiEnabled = patch.lowerThirdUiEnabled;
  if (Object.hasOwn(patch, "previewCueVideo")) previewCueVideo = patch.previewCueVideo;
  if (Object.hasOwn(patch, "pendingCueVolume")) pendingCueVolume = patch.pendingCueVolume;
  if (Object.hasOwn(patch, "cueVolumeDirty")) cueVolumeDirty = patch.cueVolumeDirty;
  if (Object.hasOwn(patch, "isAdvancingQueue")) isAdvancingQueue = patch.isAdvancingQueue;
  if (Object.hasOwn(patch, "masterPauseState")) masterPauseState = patch.masterPauseState;
  if (Object.hasOwn(patch, "targetTime")) targetTime = patch.targetTime;
  if (Object.hasOwn(patch, "startTime")) startTime = patch.startTime;
  if (Object.hasOwn(patch, "playingMediaAudioOnly")) playingMediaAudioOnly = patch.playingMediaAudioOnly;
  if (Object.hasOwn(patch, "audioOnlyFile")) audioOnlyFile = patch.audioOnlyFile;
  if (Object.hasOwn(patch, "localTimeStampUpdateIsRunning")) localTimeStampUpdateIsRunning = patch.localTimeStampUpdateIsRunning;
  if (Object.hasOwn(patch, "activeResolvedMediaFile")) activeResolvedMediaFile = patch.activeResolvedMediaFile;
  if (Object.hasOwn(patch, "activePreviewResolvedMediaFile")) activePreviewResolvedMediaFile = patch.activePreviewResolvedMediaFile;
  if (Object.hasOwn(patch, "fileEnded")) fileEnded = patch.fileEnded;
  if (Object.hasOwn(patch, "itc")) itc = patch.itc;
  if (Object.hasOwn(patch, "logoHoldOnlyPresentation")) logoHoldOnlyPresentation = patch.logoHoldOnlyPresentation;
  if (Object.hasOwn(patch, "logoHoldStagedPlayback")) logoHoldStagedPlayback = patch.logoHoldStagedPlayback;
  if (Object.hasOwn(patch, "liveMediaWindowEpoch")) liveMediaWindowEpoch = patch.liveMediaWindowEpoch;
  if (Object.hasOwn(patch, "consumedMediaWindowEndEpoch")) consumedMediaWindowEndEpoch = patch.consumedMediaWindowEndEpoch;
  if (Object.hasOwn(patch, "queueSlipstreamTransitionInProgress")) queueSlipstreamTransitionInProgress = patch.queueSlipstreamTransitionInProgress;
  if (Object.hasOwn(patch, "previewAudioCueIndex")) previewAudioCueIndex = patch.previewAudioCueIndex;
  if (Object.hasOwn(patch, "previewCueVideoIndex")) previewCueVideoIndex = patch.previewCueVideoIndex;
  if (Object.hasOwn(patch, "liveAudioQueueIndex")) liveAudioQueueIndex = patch.liveAudioQueueIndex;
  if (Object.hasOwn(patch, "queueSelectionRangeAnchorIndex")) queueSelectionRangeAnchorIndex = patch.queueSelectionRangeAnchorIndex;
  if (Object.hasOwn(patch, "manualBoundaryPauseIndex")) manualBoundaryPauseIndex = patch.manualBoundaryPauseIndex;
  if (Object.hasOwn(patch, "pendingQueueClearPostClose")) pendingQueueClearPostClose = patch.pendingQueueClearPostClose;
  if (Object.hasOwn(patch, "queueInsertionSelectionExplicit")) queueInsertionSelectionExplicit = patch.queueInsertionSelectionExplicit;
  if (Object.hasOwn(patch, "queueDropIndicatorIndex")) queueDropIndicatorIndex = patch.queueDropIndicatorIndex;
  if (Object.hasOwn(patch, "projectStageConfig")) projectStageConfig = patch.projectStageConfig;
  if (Object.hasOwn(patch, "appliedPresentationTheme")) appliedPresentationTheme = patch.appliedPresentationTheme;
  if (Object.hasOwn(patch, "projectThemeDefaults")) projectThemeDefaults = patch.projectThemeDefaults;
  if (Object.hasOwn(patch, "mediaQueue")) mediaQueue = patch.mediaQueue;
  if (Object.hasOwn(patch, "previewCueIndex")) previewCueIndex = patch.previewCueIndex;
  if (Object.hasOwn(patch, "selectedQueueAnchorIndex")) selectedQueueAnchorIndex = patch.selectedQueueAnchorIndex;
  if (Object.hasOwn(patch, "stageContentCache")) stageContentCache = patch.stageContentCache;
  if (Object.hasOwn(patch, "video")) video = patch.video;
  if (Object.hasOwn(patch, "mediaFile")) mediaFile = patch.mediaFile;
  if (Object.hasOwn(patch, "streamVolume")) streamVolume = patch.streamVolume;
  if (Object.hasOwn(patch, "networkPreviewCueHlsInstance")) networkPreviewCueHlsInstance = patch.networkPreviewCueHlsInstance;
  if (Object.hasOwn(patch, "networkPreviewCueDashPlayer")) networkPreviewCueDashPlayer = patch.networkPreviewCueDashPlayer;
  if (Object.hasOwn(patch, "networkPreviewCueDashManifestObjectUrl")) networkPreviewCueDashManifestObjectUrl = patch.networkPreviewCueDashManifestObjectUrl;
  if (Object.hasOwn(patch, "networkPreviewCueSource")) networkPreviewCueSource = patch.networkPreviewCueSource;
  if (Object.hasOwn(patch, "networkPreviewMirrorSource")) networkPreviewMirrorSource = patch.networkPreviewMirrorSource;
  if (Object.hasOwn(patch, "networkPreviewMirrorLiveEdge")) networkPreviewMirrorLiveEdge = patch.networkPreviewMirrorLiveEdge;
  if (Object.hasOwn(patch, "networkPreviewCueLiveEdge")) networkPreviewCueLiveEdge = patch.networkPreviewCueLiveEdge;
  if (Object.hasOwn(patch, "lastLowerThirdBibleTextMessage")) lastLowerThirdBibleTextMessage = patch.lastLowerThirdBibleTextMessage;
  if (Object.hasOwn(patch, "liveTextClearActive")) liveTextClearActive = patch.liveTextClearActive;
  if (Object.hasOwn(patch, "bibleShowNowModeActive")) bibleShowNowModeActive = patch.bibleShowNowModeActive;
  if (Object.hasOwn(patch, "bibleReferenceSuggestionIndex")) bibleReferenceSuggestionIndex = patch.bibleReferenceSuggestionIndex;
  if (Object.hasOwn(patch, "activeLowerThirdContentType")) {
    activeLowerThirdContentType = patch.activeLowerThirdContentType;
  }
  if (Object.hasOwn(patch, "activeMediaWindowContentType")) {
    activeMediaWindowContentType = patch.activeMediaWindowContentType;
  }
  if (Object.hasOwn(patch, "bibleLowerThirdLiveCueKey")) {
    bibleLowerThirdLiveCueKey = patch.bibleLowerThirdLiveCueKey;
  }
  if (Object.hasOwn(patch, "bibleLowerThirdOutputActive")) {
    bibleLowerThirdOutputActive = patch.bibleLowerThirdOutputActive;
  }
  if (Object.hasOwn(patch, "currentQueueIndex")) currentQueueIndex = patch.currentQueueIndex;
  if (Object.hasOwn(patch, "isActiveMediaWindowCache")) {
    isActiveMediaWindowCache = patch.isActiveMediaWindowCache;
  }
  if (Object.hasOwn(patch, "isPlaying")) isPlaying = patch.isPlaying;
  if (Object.hasOwn(patch, "isQueuePlaying")) isQueuePlaying = patch.isQueuePlaying;
  if (Object.hasOwn(patch, "mediaPlaybackEndedPending")) {
    mediaPlaybackEndedPending = patch.mediaPlaybackEndedPending;
  }
  if (Object.hasOwn(patch, "pendingQueueSwitchIndex")) {
    pendingQueueSwitchIndex = patch.pendingQueueSwitchIndex;
  }
  if (Object.hasOwn(patch, "pendingQueueSwitchStartTime")) {
    pendingQueueSwitchStartTime = patch.pendingQueueSwitchStartTime;
  }
  if (Object.hasOwn(patch, "songDragSongId")) songDragSongId = patch.songDragSongId;
  if (Object.hasOwn(patch, "songShowNowModeActive")) {
    songShowNowModeActive = patch.songShowNowModeActive;
  }
  if (Object.hasOwn(patch, "songShowNowSourceId")) {
    songShowNowSourceId = patch.songShowNowSourceId;
  }
  if (Object.hasOwn(patch, "userStopPresentationPending")) {
    userStopPresentationPending = patch.userStopPresentationPending;
  }
}

function nextLowerThirdOutputUpdateToken() {
  lowerThirdOutputUpdateToken += 1;
  return lowerThirdOutputUpdateToken;
}

export {
  SONG_SIDEBAR_MAX_WIDTH,
  SONG_SIDEBAR_MIN_WIDTH,
  clampSongSidebarWidth,
  currentSongSidebarWidth,
  SONG_FOLDER_UNFILED,
  addDeckPage,
  addSlideShapeObject,
  addSlideTextBox,
  applySongEditorTextStyle,
  attachSlideCanvasInteractions,
  bindSlideUndoControlTransactions,
  bulkDeleteSelectedSongs,
  bulkMoveSelectedSongs,
  bulkScheduleSelectedSongs,
  chooseSlideObjectImage,
  clearSongSelection,
  closeSongEditor,
  closeSongFolderPrompt,
  createNewDeck,
  currentDeckIsSongDocument,
  currentPage,
  currentSongEditorStyleScope,
  currentSongSectionId,
  deleteCurrentDeck,
  deleteDeckPage,
  deleteSongFromLibrary,
  duplicateCurrentDeck,
  duplicateDeckPage,
  ensureSongFolder,
  handleSongEditorAddSection,
  handleSongEditorCanvasTextInput,
  handleSongEditorDeleteSection,
  handleSongEditorMoveSectionDown,
  handleSongEditorMoveSectionUp,
  handleSongEditorSectionMetaChange,
  importSongFromDialog,
  initSongEditorContextMenu,
  initSongEditorTextBoxDragAndDrop,
  insertSongInSchedule,
  installBiblePreviewScaleObserver,
  installSongLowerThirdPreviewScaleObserver,
  loadSongIntoWorkspace,
  navigateSongSection,
  openSlidesWorkspaceFromButton,
  openSongFolderPrompt,
  openSongsWorkspaceFromButton,
  readSongEditorRenderState,
  recordSlideUndoCheckpoint,
  recordSlideUndoForMutation,
  redoSlideEdit,
  refreshSlidesFolderList,
  refreshSlidesList,
  refreshSongFolders,
  refreshSongsBrowser,
  renameCurrentDeck,
  renderDeckPageStrip,
  renderSlideCanvas,
  renderSlideEditorState,
  resetCurrentSongToThemeDefault,
  saveCurrentDeck,
  saveSongEditor,
  saveSongToSchedule,
  scheduleCurrentDeck,
  scheduleSongPreviewRerender,
  setCurrentSongFolderFilter,
  setCurrentWorkspaceSong,
  setDeckDirty,
  setSongLowerThirdCue,
  showCuedSongLowerThird,
  showCurrentDeckNow,
  songDeckDocumentFromSongDocument,
  songSectionsFromParsedSections,
  syncCurrentWorkspaceSongDefaultRender,
  syncSlidesWorkspaceTitle,
  syncSongBackgroundLabel,
  syncSongEditorWorkspaceStyles,
  syncSongResizeHandleAria,
  syncSongSlideNavigator,
  syncSongsMoveFolderSelect,
  undoSlideEdit,
  updateCurrentSlideTransitionFromControls,
  updateScheduleSongsWithUpdatedSong,
  MEDIA_COUNTDOWN_CHAR_BY_CODE,
  countdownDigitLastCode,
  hybridSync,
  pidSeeking,
  setMediaCountdownFromCodes,
  waitForMediaElementSource,
  currentAudioPreviewQueueIndex,
  desiredProjectionPreviewPlayback,
  isHandlingLiveEnded,
  isNonVideoPresentationItem,
  latestExplicitProjectionPauseState,
  liveStartToken,
  markSongShowNowPresentation,
  mediaElementBufferedAhead,
  mediaSessionPause,
  nextLiveStartToken,
  pauseLivePreviewMirrorFromProjection,
  playbackStateSyncGeneration,
  playbackTraceEnabled,
  presentationStartTimeForQueueItem,
  previewForwardingSuppressionDepth,
  projectionPlaybackStartupPending,
  queueStartIndexForPresent,
  reconcileStalePlaybackSync,
  shouldSuppressPreviewForwarding,
  showPreviewWarningToast,
  stashLivePreview,
  suppressPreviewForwarding,
  addFilenameToTitlebar,
  executeLiveCommand,
  installEvents,
  installIPCHandler,
  installPreviewEventHandlers,
  loadOpMode,
  openSettingsControls,
  renderGlobalNavigationState,
  setupGtkVolumeControl,
  LIVE_COMMANDS,
  PIDController,
  attachCubicWaveShaper,
  beginPidSeekSuppression,
  bindTransportTimeDisplay,
  cleanRefs,
  commandForShortcut,
  controlsOverlay,
  createNavigationStateMachine,
  cubicWaveShaperAttachedVideo,
  endLiveAudioPresentation,
  endLocalMedia,
  ensureLiveAudioElement,
  ensureMediaCountdownDigitNodes,
  ensureMediaPanelBuilt,
  ensureStreamsPanelBuilt,
  focusableControls,
  getPreviewControlMediaElement,
  handleMediaseek,
  handleOutputHoldShortcut,
  handlePlayPause,
  handlePlaybackState,
  handleSongsDatabaseCleared,
  handleTimeMessage,
  installBibleMediaControls,
  installDisplayChangeHandler,
  installGlobalSlideTransitionControls,
  isLikelyAudioItem,
  isPreviewWorkspaceOverlayVisible,
  lastStageCountdownSecond,
  loadLocalMediaHandler,
  loadedmetadataHandler,
  pauseLocalMedia,
  pauseMedia,
  pidController,
  playLocalMedia,
  playMedia,
  playPauseBtn,
  playPauseIcon,
  presentationStartInProgress,
  previewMediaControlsLiveProjection,
  previewTransportLoadIsPending,
  previousPlayableQueueIndexBefore,
  removeFileProtocol,
  resetBiblePreviewMediaWindowSize,
  resolveQueueItemPlaybackVolume,
  restoreLivePreviewIntoPanel,
  restoreMediaFile,
  seekLocalMedia,
  seekingLocalMedia,
  setActiveCueVolume,
  syncSongLowerThirdForSection,
  syncTrackedPreviewStartTime,
  timeRemaining,
  timelineSync,
  toggleBlackScreen,
  toggleLogoHold,
  toggleMediaLoopEnabled,
  unPauseMedia,
  updateTimestamp,
  volumePopupOpen,
  waitForPreloadBridge,
  currentQueuePreviewItem,
  installPreviewEmptyStateHandlers,
  previewElementSourceMatchesMediaFile,
  previewMediaSourcePath,
  queueItemOwnsControlPreview,
  syncQueuePreviewMediaElements,
  PREVIEW_SURFACE_BIBLE,
  PREVIEW_SURFACE_CUE_AUDIO,
  PREVIEW_SURFACE_SLIDES,
  PREVIEW_SURFACE_SONGS,
  isImagePreviewCueActive,
  mediaElementComparableSource,
  openMediaFilesDialog,
  prePathname,
  resetPreviewWarningState,
  liveLoopTarget,
  loopControlTarget,
  loopTargetEnabled,
  loopTargetSupportsLoop,
  markQueueItemMediaUpdate,
  setLoopTargetEnabled,
  updateLoopControlState,
  createLiveSource,
  currentPreviewSourcePath,
  isEmbeddedScheduleItem,
  mediaWatchSyncTimer,
  queueItemForPath,
  repeatButton,
  setMediaLoopEnabled,
  videoWrapper,
  configureOutputHoldBridge,
  loadOutputHoldPreferencesFromSettings,
  configureOutputHold,
  confirmLiveSwitchAccepted,
  currentDeck,
  isAnyAudienceHoldActive,
  outputHoldRecoveryGeneration,
  queueIndexForCurrentDeck,
  queueIndexForCurrentWorkspaceSong,
  queueIndexMatchesCurrentLiveOutput,
  selectDeckPage,
  selectSongSection,
  showSongTextNow,
  syncActiveScheduledSongPresentation,
  activeLiveLayersPage,
  addNurseryAlertFromDraft,
  applyLowerThirdOutputPreferences,
  applyThemeToLivePresentation,
  clearAudienceAlert,
  clearLiveText,
  clearPrivateStageMessage,
  closeLiveLayers,
  closeStageControls,
  ensureStageOutput,
  handleLiveLayersTabKeydown,
  insertAlertToken,
  openLiveLayers,
  openStageControls,
  selectLiveLayersPage,
  sendStageLayer,
  showAudienceAlert,
  showPrivateStageMessage,
  updateAlertComposerActions,
  updateAlertsSnapshot,
  updateStageStatusUi,
  useQuickAlertMessage,
  NAVIGATION_STATES,
  alertQueueRow,
  appendQuickMessageGroup,
  buildSongLowerThirdMessage,
  clearLiveSongText,
  closeSettingsControls,
  createOutputCommand,
  currentResolvedSongPresentation,
  currentSongActiveSection,
  currentSongPresentationItem,
  currentSongRenderState,
  lowerThirdUiEnabled,
  navigationState,
  navigationStateBeforeStage,
  renderSongSectionPreview,
  renderSongSlideNavigator,
  resolvedAudienceBackgroundFields,
  resolvedFontFamilyFields,
  restoreLiveSongText,
  sendSongLowerThirdForLiveItem,
  setCurrentSongRenderState,
  stageContentFromPresentation,
  stageSessionIdCache,
  syncScheduleAfterBibleFeatureChange,
  syncStageRendererPreviewCapture,
  syncStreamRendererPreviewCapture,
  themeAudienceMessageIfApplied,
  updateOutputHoldButtonStates,
  advanceQueueAfterMediaWindowClosed,
  beginLiveMediaWindowEpoch,
  claimMediaWindowEnd,
  clearCueAfterTake,
  ensurePreviewCueVideoElement,
  getPreviewCueDisplayVolume,
  handleMediaWindowClosed,
  handleRemoteMediaWindowTimeTick,
  isAudioPreviewCueActive,
  isPreviewCueVolumeActive,
  slipstreamQueueItemAtIndex,
  takeQueueItemLive,
  trySlipstreamNextQueueItem,
  updatePlayButtonOnMediaWindow,
  PREVIEW_SURFACE_CUE_IMAGE,
  PREVIEW_SURFACE_CUE_VIDEO,
  applyVideoPoster,
  audioOnlyFile,
  beginPreviewTransportLoad,
  beginProjectionPlaybackStartupSync,
  classifyPresentationType,
  clearLowerThirdForUnsupportedMediaSource,
  clearUnsupportedQueueItemCueStartTime,
  clearVideoPoster,
  commitActiveCueVolume,
  consumePendingCueVolume,
  consumedMediaWindowEndEpoch,
  cueVolumeDirty,
  currentImplicitNextItem,
  currentImplicitPreviousItem,
  currentTimeDisplay,
  durationTimeDisplay,
  ensurePendingMediaUpdateApproved,
  ensurePreviewAudioElement,
  fileEnded,
  finishPreviewTransportLoad,
  finishProjectionPlaybackStartupSync,
  getHostnameOrBasename,
  getLivePreviewDisplayVolume,
  handleImageDisplay,
  handleMediaPlayback,
  hideBiblePreview,
  hideBibleWorkspace,
  hideSlidesWorkspace,
  hideSongsWorkspace,
  isAdvancingQueue,
  isAudienceLogoHoldActive,
  isAudioOnlyQueuePresentationActive,
  isQueueItemImage,
  isQueueItemVideo,
  isScheduleItemCurrentlyPlayable,
  itc,
  liveMediaWindowEpoch,
  loadDeckQueueItemIntoWorkspace,
  loadSongItemIntoWorkspace,
  localTimeStampUpdateIsRunning,
  logoHoldOnlyPresentation,
  logoHoldStagedPlayback,
  loopEnabledForLiveMedia,
  masterPauseState,
  mediaElementLoadedAudioOnly,
  mediaPathMatchesCurrentLiveMedia,
  nextQueueBoundaryIndex,
  normalizedQueueItemCueStartTime,
  paintCountdownFor,
  paintTransportTimeDisplay,
  pauseQueuePresentationAtBoundary,
  pendingCueVolume,
  playAudioOnlyLocally,
  playLivePreviewMirrorSafely,
  prepareQueueItemUnderLogoHold,
  previewAudio,
  previewShowsSameClipAsPath,
  queueIndexIsCurrentLivePresentation,
  queueItemMediaCacheBust,
  queueItemNeedsPendingUpdateApproval,
  queueSlipstreamTransitionInProgress,
  removeFilenameFromTitlebar,
  resetAudienceOutputHold,
  resetCountdownSync,
  resetVideoState,
  resolveQueueItemMediaPath,
  restoreLivePreviewMirrorMuteState,
  restorePreviewToLiveOutput,
  restoreStagedPreviewPlayback,
  restoreWorkspacePreviewForQueueItem,
  seekMedia,
  selectNavigationForQueueItem,
  sendSongTextToOutput,
  setCueStartTime,
  setMediaCountdownOverlayVisible,
  setMediaCountdownText,
  shouldAdvanceAfterCurrentItemEnds,
  shouldAutoTransitionToIndex,
  songItemForAudienceResolution,
  stagedMediaUrlForItem,
  stopStreamRendererPreviewCapture,
  syncAudienceOutputHoldAfterPresentationStart,
  syncPreviewAudioCueAudibility,
  syncPreviewMediaAfterPresentationStateChange,
  syncStageContentFromQueueItem,
  targetTime,
  timeline,
  tracePlayback,
  updateLowerThirdForSupportedScheduleItem,
  validMediaStartTime,
  waitForCueVideoMetadata,
  waitForLoadedMetadata,
  waitForMediaMetadata,
  waitForMetadata,
  applyDroppedMediaPaths,
  clearMediaQueue,
  enqueuePathsFromFilePicker,
  extractAndFilterDroppedMediaPaths,
  installMediaQueueListDelegation,
  onClearMediaQueueClick,
  queueDropIndicator,
  queueInsertionIndexAfterSelection,
  revealNewQueueEntries,
  selectedQueueIndexForDisplay,
  selectedQueueItems,
  updateQueueSelectionVisual,
  approvePendingMediaUpdate,
  buildSongQueueEntryFromDeck,
  captureQueueClearUndoState,
  currentWorkspaceSong,
  currentWorkspaceSongDeck,
  finalizeQueueClearDestructive,
  formatCueTime,
  isPreparingSeparateCue,
  isQueueItemAudio,
  isScheduleItemCurrentlyVisible,
  keepPendingMediaUpdate,
  liveAudio,
  liveAudioQueueIndex,
  manualBoundaryPauseIndex,
  nextPlayableQueueIndexAfter,
  openSongEditor,
  pauseLocalPreviewAfterQueueClear,
  pendingQueueClearPostClose,
  playCurrentQueueItem,
  playingMediaAudioOnly,
  previewAudioCueIndex,
  previewCueVideoIndex,
  queueDropIndicatorIndex,
  queueIndexIsLiveForDisplay,
  queueInsertionSelectionExplicit,
  queueSelectionRangeAnchorIndex,
  queueTypeIconMarkup,
  refreshLiveAudioControls,
  releaseOutputHoldsAndGoLiveQueueIndex,
  renderStateForLibrarySong,
  resetPreviewSurfaceToEmptyState,
  restoreCountdownForLiveMedia,
  showMediaWorkspace,
  showQueueClearedUndoToast,
  slideTransitionBadgeMarkup,
  syncMediaLoopState,
  syncPlayPauseIconToControlMedia,
  updatePreviewEmptyState,
  PROJECT_GUID_RE,
  acknowledgePreflightWarningForItem,
  currentProjectGuid,
  currentProjectPath,
  currentProjectStorageMode,
  exportPortableProjectDialog,
  firstDroppedProjectPath,
  flushAutosaveOnClose,
  openProjectByPath,
  openProjectDialog,
  pinQueueMediaSources,
  preflightWarningFingerprint,
  queueItemCanKeepOldMediaVersion,
  queueItemHasSafeSnapshotPin,
  queueItemNeedsDefaultSnapshotPin,
  queueItemPreflightCheckPayload,
  relinkMissingFilesDialog,
  restoreAutosavedProjectState,
  saveProject,
  saveProjectAsDialog,
  stampBaselineForQueueItems,
  OUTPUT_HOLD_TRANSITION_MS,
  applyOutputHoldPreferences,
  applyPinnedMediaSource,
  getOutputHoldLogoSettings,
  isFileBackedMediaPath,
  liveSourcePinnedModifiedTime,
  loopEnabledForQueueItem,
  mediaPathSupportsLoop,
  mediaPinPayloadForItem,
  normalizeLiveSource,
  normalizeOutputHoldPreferences,
  normalizeProjectGuid,
  projectStageConfig,
  projectThemeDefaults,
  queueItemLiveSource,
  queueItemUsesPackagedMedia,
  refreshMissingFlagsAndWarn,
  restoreOperatingMode,
  scheduleMediaWatchSync,
  selectedQueueAnchorIndex,
  clampPptxSlideIndex,
  clampPptxSlideIndexValue,
  getLivePptxSlideFromMediaWindow,
  hidePptxPreview,
  hidePptxPreviewIfNeeded,
  isPptxPreviewVisible,
  loadPptxPreview,
  pptxStartSlideForItem,
  restoreNonPptxPreviewSurface,
  restorePptxPreviewForMediaTab,
  schedulePptxThumbnailRefresh,
  sendPptxSlideToMediaWindow,
  syncCurrentPptxSlideForProjectSnapshot,
  PPTX_SIDEBAR_DEFAULT_WIDTH,
  PPTX_SIDEBAR_MAX_WIDTH,
  PPTX_SIDEBAR_MIN_WIDTH,
  PPTX_SIDEBAR_STORAGE_KEY,
  PREVIEW_SURFACE_LIVE,
  PREVIEW_SURFACE_PPTX,
  clearVideoPreviewCueOverlay,
  enforcePptxCoverFit,
  findQueueIndexByPath,
  getPptxListRenderOptions,
  getPptxNaturalSlideSize,
  getPptxPdfjsConfig,
  getPptxRenderedSlideElement,
  getPptxSlideElementFromHandle,
  isImg,
  isQueueItemPptx,
  isSavedPptxSlideIndex,
  mediaPlayerInputState,
  mediaReadPayloadForPath,
  nextPlayableQueueItemStageText,
  pptxRegex,
  queueItemStageLabel,
  resolveQueuePresentationVideo,
  restoreLivePreview,
  sendCachedStageContent,
  setPreviewStackSurface,
  stageContentCache,
  stopLiveAudioPresentation,
  stopPreviewAudioCue,
  syncPreviewStackSurface,
  updateQueueFileLabel,
  waitForNextFrame,
  NETWORK_PREVIEW_PREROLL_BUFFER_SECONDS,
  NETWORK_PREVIEW_PREROLL_TIMEOUT_MS,
  activeNetworkPreviewHidesScrubber,
  activeNetworkPreviewSource,
  attachNetworkMediaSourceToElement,
  attachNetworkPreviewMirrorSource,
  beginNetworkPreviewStatus,
  handleMediaPreviewRtcSignal,
  hideNetworkPreviewStatus,
  installNetworkItemButton,
  installNetworkPreviewStatusHandlers,
  isHlsNetworkSource,
  isNetworkVideoPreviewCueActive,
  matchYouTubeNetworkUrl,
  networkPreviewMirrorLiveEdgeMatches,
  networkPreviewRepresentsMediaFile,
  networkPreviewSourceHidesScrubber,
  networkPreviewTransportCurrentTime,
  networkPreviewTransportDuration,
  networkPreviewTransportState,
  playNetworkPreviewMirror,
  primeNetworkPreviewElement,
  queueItemHidesNetworkScrubber,
  refreshNetworkPreviewTransportControls,
  refreshNetworkPreviewTransportState,
  resetNetworkPreviewStatus,
  resetNetworkPreviewTransportState,
  seekNetworkPreviewTransport,
  setNetworkPreviewCueAudio,
  setNetworkPreviewElementCaptureMuted,
  setNetworkPreviewElementLocalAudio,
  setNetworkPreviewTransportPaused,
  setNetworkPreviewVolume,
  showNetworkPreviewError,
  stopNetworkPreviewRtcCapture,
  teardownNetworkPreviewCueStreamingPlayers,
  teardownNetworkPreviewStreamingPlayers,
  updateNetworkPreviewTransportState,
  activePresentationOwnsPreviewAudio,
  activePreviewResolvedMediaFile,
  activeResolvedMediaFile,
  beginPreviewForwardingSuppression,
  clampMediaTime,
  classifyQueueMediaType,
  createQueueEntry,
  endPreviewForwardingSuppression,
  generateNetworkItemDialogHTML,
  getConfidenceMonitorElement,
  isNetworkStreamSource,
  isPlayInterruptedError,
  isVideoPreviewCueActive,
  mediaSourcesMatch,
  networkPreviewCueDashManifestObjectUrl,
  networkPreviewCueDashPlayer,
  networkPreviewCueHlsInstance,
  networkPreviewCueLiveEdge,
  networkPreviewCueSource,
  networkPreviewMirrorLiveEdge,
  networkPreviewMirrorSource,
  normalizeLiveEdgeQueueItemsForSources,
  normalizeMediaPathForCompare,
  onQueueItemActivate,
  playVideoSafely,
  previewCueVideo,
  queueItemIsLiveEdgeStream,
  refreshPreviewControlsForCurrentMedia,
  setConfidenceMonitorActive,
  setPreviewCueVideoLocalAudio,
  setSBFormMediaPlayer,
  setupCustomMediaControls,
  startTime,
  streamVolume,
  syncGtkSliderToCueState,
  syncPreviewAudioTrackState,
  vlCtl,
  waitForMediaElementBuffer,
  waitForMediaElementFrame,
  BIBLE_VERSE_DRAG_MIME,
  bibleUiEnabled,
  clearPreviewCue,
  currentPreviewCue,
  generateProjectGuid,
  hideScheduleSongContextMenu,
  loadQueueItemIntoControlWindow,
  loadQueueItemIntoPreviewCue,
  nextPreviewLoadToken,
  openThemeManagerForQueueItem,
  scheduleAutosaveProjectState,
  shiftQueueIndexesForInsertion,
  updatePreviewCueUI,
  applyBiblePreview,
  applyBibleReferenceSuggestion,
  applyBibleStyleToCurrentText,
  applyBibleStyleToScheduledText,
  beginScriptureTake,
  bibleQueueItemDisplayName,
  bibleSearchState,
  bibleStyleDirtyState,
  bibleVerseDragPayload,
  bibleVerseDragPayloadFromDataTransfer,
  buildBibleTextMessage,
  changeBibleLowerThirdSegment,
  cleanBibleVerseTextForDisplay,
  clearBibleVerseDragVisualState,
  clearLiveBibleText,
  clearRecentScriptures,
  closeBibleLowerThirdOutput,
  commitBibleDesignerRenderState,
  confirmScriptureTake,
  currentBibleScheduleOutputSize,
  ensureBibleLowerThirdOutput,
  fallbackUnavailableBibleTranslationsOnLoad,
  hideBibleReferenceSuggestions,
  hideScheduleBibleContextMenu,
  insertBibleInSchedule,
  isBiblePresentationActive,
  isBibleReferenceSuggestionsOpen,
  isBibleWorkspaceVisible,
  isPresentationActiveForBibleLowerThird,
  jumpBibleReferenceToBrowser,
  loadBibleEntryIntoEditor,
  loadBibleVersionMetadataFromSidecar,
  normalizeBibleVersionMetadata,
  openBibleWorkspaceFromButton,
  overridesFromProjectScriptureText,
  parseBibleQueuePath,
  positionBibleReferenceSuggestionsOverlay,
  projectBibleQueueName,
  projectBibleReferenceEntryForQueueItem,
  projectBibleReferenceOnlyEntry,
  projectScriptureOverrides,
  projectScriptureTextFromOverrides,
  queueEntriesForBibleVerseDragPayload,
  reconcileBibleBrowseView,
  refreshBibleBrowser,
  refreshBibleLookupPreview,
  renderBibleReferenceSuggestions,
  renderRecentScriptures,
  resolvedBibleEntryForItem,
  resolvedBibleStyleDefaults,
  restoreBibleVersionFromSettings,
  restoreLiveBibleText,
  saveBibleTextLayoutDefaults,
  scheduleBibleSearch,
  scripturePresentation,
  selectFirstBibleReferenceForVersion,
  sendBibleLowerThirdTextToOutput,
  sendBibleTextToOutput,
  setBibleDesignerVersion,
  setBibleLowerThirdSegmentIndex,
  setBibleNavigatorMode,
  setBibleStyleEditorVisible,
  showBibleTextContextMenu,
  showBibleTextNow,
  showCuedBibleLowerThird,
  showScheduleBibleContextMenu,
  syncActiveScheduledBiblePresentation,
  syncBibleBackgroundLabel,
  syncBibleDesignerStateToPreviewedQueueItem,
  syncBibleLowerThirdBarBackgroundLabel,
  syncBibleSearchControlsFromState,
  syncBibleStateFromControls,
  syncBibleStyleControlsFromState,
  syncBibleVersionAttributionDisplay,
  syncShowNowBiblePresentation,
  updateBibleReferenceSuggestionActiveState,
  DEFAULT_ITEM_SLIDE_TRANSITION,
  SCRIPTURE_ABSOLUTE_MIN_BODY_FONT_SIZE,
  SCRIPTURE_AUTOSIZE_FIT,
  SCRIPTURE_AUTOSIZE_NORMALIZE,
  SCRIPTURE_DEFAULT_AUTOSIZE_MODE,
  SCRIPTURE_DEFAULT_LOOK,
  SCRIPTURE_FOLLOW_MODE,
  SCRIPTURE_HEADING_FONT_SIZE,
  SCRIPTURE_LABEL_FONT_SIZE,
  SCRIPTURE_LOOK_FULLSCREEN,
  SCRIPTURE_REFERENCE_FONT_SIZE,
  audienceTextMessageForSend,
  bibleAPI,
  bibleQueuePath,
  bibleReferenceSuggestionIndex,
  bibleShowNowModeActive,
  bibleStyleSnapshot,
  bibleUriPrefix,
  bibleVersionValue,
  clearSongShowNowPresentation,
  createScripturePresentationMachine,
  currentBibleBackgroundVideoSync,
  currentLivePresentationLabel,
  currentLiveQueueItemForSwitchPrompt,
  dataTransferHasType,
  getBibleDesignerStyle,
  hasLiveLowerThirdText,
  hideQueueDropIndicator,
  imageRegex,
  isLocalAppWindowPresentationActive,
  isQueueItemBible,
  isQueuePresentationActive,
  lastAudienceBibleTextMessage,
  liveTextClearActive,
  markAudiencePreviewTextSelection,
  measureBibleEntryAutofit,
  mergedBibleShowNowStyle,
  normalizeBiblePreviewOutputSize,
  normalizeLowerThirdSegments,
  normalizeScriptureAutosizeMode,
  normalizeScriptureLook,
  normalizeScriptureReference,
  normalizedBibleVersions,
  parseScriptureReference,
  previewCueIndex,
  previewLoadToken,
  queueBiblePreviewMediaWindowSizeRefresh,
  refreshBiblePreviewMediaWindowSize,
  renderScriptureForTarget,
  renderSongLowerThirdControls,
  resolveScriptureSlideForCursor,
  saveCurrentProjectInStorageMode,
  scriptureCursorForSlide,
  scriptureReferencePresentationForBackground,
  send,
  setLastShownBibleStyleOverrides,
  setSelectedQueueAnchor,
  shouldApplyLiveTextClearState,
  showBibleWorkspace,
  stopLowerThirdRendererPreviewCapture,
  switchQueueItemLiveWithConfirmation,
  syncBiblePreviewOutputScale,
  syncBuiltInLowerThirdFeatureAvailability,
  syncConfidenceMonitorCarousel,
  syncLowerThirdFeatureAvailability,
  syncLowerThirdRendererPreviewCapture,
  themedAudienceMessage,
  themedLowerThirdMessage,
  updateClearLiveTextButtonState,
  verseNumbersFromSelector,
  verseSelectorFromReference,
  waitForScriptureFonts,
  MEDIAPLAYER,
  PREVIEW_STASH_ID,
  STREAMPLAYER,
  TAB_PANEL_MEDIA_ID,
  TAB_PANEL_STREAMS_ID,
  TEXTPLAYER,
  DEFAULT_CANVAS,
  DEFAULT_DECK_THEME,
  DEFAULT_SONG_RENDER,
  DEFAULT_TEXT_FRAME,
  SCRIPTURE_BODY_FONT_SIZE,
  SCRIPTURE_FONT_FAMILY,
  SCRIPTURE_FONT_WEIGHT,
  SCRIPTURE_LINE_HEIGHT,
  SCRIPTURE_LOOK_LOWER_THIRD,
  SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND,
  SCRIPTURE_LOWER_THIRD_CHROMA_KEY_COLOR,
  SCRIPTURE_LOWER_THIRD_DEFAULT_FONT_SIZE,
  SCRIPTURE_LOWER_THIRD_TEXT_COLOR,
  SCRIPTURE_MIN_BODY_FONT_SIZE,
  SONG_DECK_DOCUMENT_TYPE,
  SONG_DRAG_MIME,
  __dirname,
  activeLiveStream,
  activeLowerThirdContentType,
  activeMediaWindowContentType,
  appliedPresentationTheme,
  applyOperatorSelectionContrast,
  applyScriptureRenderToPreview,
  arrangementSequenceEntries,
  bibleDesignerState,
  bibleLowerThirdLiveCueKey,
  bibleLowerThirdOutputActive,
  currentAlertsSnapshot,
  currentMode,
  blocksToText,
  clampLowerThirdSegmentIndex,
  clearSongDragVisualState,
  clearTextFromPresentationMessage,
  clearTextObjectInlineStyles,
  createBlankDeck,
  createBlankPage,
  createImageObject,
  createMediaWindow,
  createShapeObject,
  createTextObject,
  currentLiveQueueItem,
  currentQueueIndex,
  deckDefaultRender,
  deckQueuePath,
  deckToTransientSong,
  disableNativeVideoControls,
  enabledSongSections,
  enrichLowerThirdPresentationMessage,
  ensureNetworkItemDialog,
  escapeHtml,
  findPage,
  getElementContentSize,
  getPagePrimaryText,
  getPathForFile,
  generateDyneTabShellHTML,
  generateMediaFormHTML,
  generateStreamsPanelHTML,
  hasAudienceOutputSelected,
  hasLiveAudienceTextPresentation,
  hasLowerThirdOutputSelected,
  handleVolumeChange,
  img,
  insertQueueEntriesAfterSelection,
  installLowerThirdPreviewScaleObserver,
  invalidateQueueUndoToastAfterMutation,
  invoke,
  isActiveMediaWindow,
  isActiveMediaWindowCache,
  isBibleLowerThirdFeatureEnabled,
  isBiblePath,
  isCurrentPreviewLoad,
  isPlaying,
  isQueueItemDeck,
  isQueueItemSong,
  isQueueItemTransitionCapable,
  isQueuePlaying,
  isSlideDeckDocument,
  isSlidesWorkspaceVisible,
  isSongsWorkspaceVisible,
  isLiveStream,
  isSongPath,
  itemThemeForRole,
  lastAudienceSongTextMessage,
  lastLowerThirdBibleTextMessage,
  latestOutputStatus,
  liveThemeFields,
  lowerThirdKeyOnlyMessage,
  lowerThirdOutputUpdateToken,
  lowerThirdPreferenceChromaKeyColor,
  markSongAudiencePreviewSelection,
  mediaFile,
  mediaPlaybackEndedPending,
  mediaQueue,
  hideMediaLibraryWorkspace,
  mediaLibraryDragIsActive,
  mediaLibraryItemIdFromDataTransfer,
  openMediaLibraryPicker,
  mergeSongRenderState,
  nextLowerThirdOutputUpdateToken,
  normalizeItemSlideTransitionOverride,
  normalizeItemTheme,
  normalizeScriptureFontSize,
  normalizeScriptureMinFontSize,
  normalizeSlideDeck,
  normalizeToSongAST,
  networkPreviewUsesRendererCapture,
  normalizedCueMatchText,
  pageRenderOverrides,
  on,
  parseDeckQueuePath,
  parseSongQueuePath,
  pathToMediaUrl,
  pendingQueueSwitchIndex,
  pendingQueueSwitchStartTime,
  queueBasename,
  queueEntryFromSong,
  queueIndexInRange,
  queueItemCueStartTime,
  queueItemSupportsCueStartTime,
  populateDisplaySelect,
  readSlideTransitionControls,
  reconcileSongPlayOrder,
  recoverOutputHoldsToDeckPage,
  recoverOutputHoldsToSongSection,
  renderLowerThirdPreview,
  renderQueue,
  recordScheduledMediaPaths,
  resolveMediaLibraryDragItem,
  resolveThemeForTarget,
  resolvedSongPresentation,
  resolvedThemeForItem,
  saveMediaFile,
  selectedBiblePreviewOutputSize,
  selectedDisplayValueFromSelect,
  sendAudienceTextMessage,
  sendBibleLowerThirdTextMessage,
  setItemThemeRole,
  setSharedRendererState,
  showGnomeToast,
  showMediaLibraryWorkspace,
  showRendererAlert,
  showRendererConfirm,
  showRendererPrompt,
  showSlidesWorkspace,
  showSongsWorkspace,
  slideTransitionPayloadForQueueItem,
  slidesAPI,
  songAstToDeck,
  songBlockText,
  songDefaultRenderFromRender,
  songDragSongId,
  songLowerThirdState,
  songQueuePath,
  songRenderFromItem,
  songRenderStateFromDefaultRender,
  songSectionBlockTexts,
  songSectionLyricsText,
  songShowNowModeActive,
  songShowNowSourceId,
  songsAPI,
  syncSlideTransitionControls,
  syncNetworkPreviewMirrorCapture,
  textToSegmentsBlocks,
  themeLowerThirdMessageIfApplied,
  updateDynUI,
  userStopPresentationPending,
  video,
  waitForTextFonts,
};

bootstrapRenderer().catch((error) => {
  console.error("Failed to bootstrap application:", error);
});
