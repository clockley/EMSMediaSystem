/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/*
 * Operator chrome: custom transport controls, volume, IPC, shortcuts, and operating-mode UI.
 */

import {
  LIVE_COMMANDS,
  MEDIAPLAYER,
  STREAMPLAYER,
  TEXTPLAYER,
  NAVIGATION_STATES,
  PIDController,
  TAB_PANEL_MEDIA_ID,
  TAB_PANEL_STREAMS_ID,
  activeLiveLayersPage,
  activeLowerThirdContentType,
  activeMediaWindowContentType,
  activeNetworkPreviewHidesScrubber,
  activePreviewResolvedMediaFile,
  applyDroppedMediaPaths,
  applyLowerThirdOutputPreferences,
  applyOutputHoldPreferences,
  applyThemeToLivePresentation,
  attachCubicWaveShaper,
  audioOnlyFile,
  beginPidSeekSuppression,
  beginPreviewForwardingSuppression,
  bibleLowerThirdOutputActive,
  bibleUiEnabled,
  bindTransportTimeDisplay,
  claimMediaWindowEnd,
  cleanRefs,
  clearAudienceAlert,
  clearLiveText,
  clearPrivateStageMessage,
  closeBibleLowerThirdOutput,
  closeStageControls,
  commandForShortcut,
  consumedMediaWindowEndEpoch,
  controlsOverlay,
  createNavigationStateMachine,
  cubicWaveShaperAttachedVideo,
  cueVolumeDirty,
  currentMode,
  currentPreviewCue,
  currentPreviewSourcePath,
  currentQueueIndex,
  currentQueuePreviewItem,
  currentSongActiveSection,
  currentTimeDisplay,
  disableNativeVideoControls,
  durationTimeDisplay,
  endLiveAudioPresentation,
  endLocalMedia,
  endPreviewForwardingSuppression,
  enqueuePathsFromFilePicker,
  ensureLiveAudioElement,
  ensureMediaCountdownDigitNodes,
  ensureMediaPanelBuilt,
  ensurePreviewAudioElement,
  ensurePreviewCueVideoElement,
  ensureStreamsPanelBuilt,
  exportPortableProjectDialog,
  extractAndFilterDroppedMediaPaths,
  firstDroppedProjectPath,
  flushAutosaveOnClose,
  focusableControls,
  getHostnameOrBasename,
  getLivePreviewDisplayVolume,
  getPreviewControlMediaElement,
  getPreviewCueDisplayVolume,
  handleMediaPreviewRtcSignal,
  handleMediaWindowClosed,
  handleMediaseek,
  handleOutputHoldShortcut,
  handlePlayPause,
  handlePlaybackState,
  handleSongsDatabaseCleared,
  handleTimeMessage,
  img,
  installBibleMediaControls,
  installDisplayChangeHandler,
  installGlobalSlideTransitionControls,
  installMediaQueueListDelegation,
  installNetworkItemButton,
  installPreviewEmptyStateHandlers,
  invoke,
  isActiveMediaWindow,
  isActiveMediaWindowCache,
  isAudioPreviewCueActive,
  isBibleLowerThirdFeatureEnabled,
  isImg,
  isLikelyAudioItem,
  isLiveStream,
  isLocalAppWindowPresentationActive,
  isNetworkVideoPreviewCueActive,
  isPlayInterruptedError,
  isPlaying,
  isPreparingSeparateCue,
  isPreviewCueVolumeActive,
  isPreviewWorkspaceOverlayVisible,
  isQueueItemBible,
  isQueueItemDeck,
  isQueueItemSong,
  isQueuePlaying,
  lastStageCountdownSecond,
  liveAudio,
  liveAudioQueueIndex,
  liveMediaWindowEpoch,
  loadLocalMediaHandler,
  loadQueueItemIntoControlWindow,
  loadedmetadataHandler,
  localTimeStampUpdateIsRunning,
  loopEnabledForLiveMedia,
  markQueueItemMediaUpdate,
  masterPauseState,
  mediaElementLoadedAudioOnly,
  mediaFile,
  mediaPathMatchesCurrentLiveMedia,
  mediaPlaybackEndedPending,
  mediaPlayerInputState,
  mediaQueue,
  networkPreviewCueLiveEdge,
  networkPreviewCueSource,
  networkPreviewMirrorLiveEdge,
  networkPreviewMirrorSource,
  networkPreviewSourceHidesScrubber,
  networkPreviewTransportCurrentTime,
  networkPreviewTransportDuration,
  networkPreviewTransportState,
  networkPreviewUsesRendererCapture,
  nextPlayableQueueIndexAfter,
  nextPreviewLoadToken,
  normalizeMediaPathForCompare,
  on,
  onClearMediaQueueClick,
  openLiveLayers,
  openProjectByPath,
  openProjectDialog,
  openStageControls,
  paintTransportTimeDisplay,
  pathToMediaUrl,
  pauseLocalMedia,
  pauseMedia,
  pendingCueVolume,
  pidController,
  playLivePreviewMirrorSafely,
  playLocalMedia,
  playMedia,
  playNetworkPreviewMirror,
  playPauseBtn,
  playPauseIcon,
  playVideoSafely,
  playingMediaAudioOnly,
  presentationStartInProgress,
  previewAudio,
  previewCueIndex,
  previewLoadToken,
  previewMediaControlsLiveProjection,
  previewMediaSourcePath,
  previewTransportLoadIsPending,
  previousPlayableQueueIndexBefore,
  projectThemeDefaults,
  queueBiblePreviewMediaWindowSizeRefresh,
  queueIndexInRange,
  queueItemHidesNetworkScrubber,
  queueItemOwnsControlPreview,
  queueSlipstreamTransitionInProgress,
  refreshNetworkPreviewTransportState,
  refreshPreviewControlsForCurrentMedia,
  relinkMissingFilesDialog,
  removeFileProtocol,
  renderQueue,
  renderSongLowerThirdControls,
  repeatButton,
  resetBiblePreviewMediaWindowSize,
  resolveQueueItemPlaybackVolume,
  restoreAutosavedProjectState,
  restoreLivePreviewIntoPanel,
  restoreMediaFile,
  restorePptxPreviewForMediaTab,
  saveMediaFile,
  saveProject,
  saveProjectAsDialog,
  scheduleAutosaveProjectState,
  seekLocalMedia,
  seekMedia,
  seekNetworkPreviewTransport,
  seekingLocalMedia,
  selectLiveLayersPage,
  send,
  sendStageLayer,
  setActiveCueVolume,
  setCueStartTime,
  setItemThemeRole,
  setMediaCountdownText,
  setNetworkPreviewTransportPaused,
  setNetworkPreviewVolume,
  setSharedRendererState,
  showAudienceAlert,
  showGnomeToast,
  showMediaLibraryWorkspace,
  showPrivateStageMessage,
  songLowerThirdState,
  stageContentCache,
  startTime,
  stopLowerThirdRendererPreviewCapture,
  streamVolume,
  switchQueueItemLiveWithConfirmation,
  syncActiveScheduledBiblePresentation,
  syncBiblePreviewOutputScale,
  syncConfidenceMonitorCarousel,
  syncLowerThirdFeatureAvailability,
  syncLowerThirdRendererPreviewCapture,
  syncMediaLoopState,
  syncQueuePreviewMediaElements,
  syncShowNowBiblePresentation,
  syncSongLowerThirdForSection,
  syncStreamRendererPreviewCapture,
  syncTrackedPreviewStartTime,
  takeQueueItemLive,
  targetTime,
  timeRemaining,
  timeline,
  timelineSync,
  toggleBlackScreen,
  toggleLogoHold,
  toggleMediaLoopEnabled,
  tracePlayback,
  trySlipstreamNextQueueItem,
  unPauseMedia,
  updateClearLiveTextButtonState,
  updateLoopControlState,
  updateOutputHoldButtonStates,
  updateTimestamp,
  userStopPresentationPending,
  video,
  videoWrapper,
  vlCtl,
  volumePopupOpen,
  waitForPreloadBridge,
} from "./app-renderer.mjs";

const navigationState = createNavigationStateMachine(NAVIGATION_STATES.MEDIA);

let navigationStateBeforeSettings = NAVIGATION_STATES.MEDIA;

let gtkUpdateVolIcon = null;

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

function openSettingsControls() {
  if (!document.getElementById("stageControlsBackdrop")?.hidden) {
    closeStageControls();
  }
  document.getElementById("settingsControlsBackdrop")?.removeAttribute("hidden");
  if (navigationState.state !== NAVIGATION_STATES.SETTINGS) {
    navigationStateBeforeSettings = navigationState.state;
  }
  navigationState.transition(NAVIGATION_STATES.SETTINGS);
  document.getElementById("closeSettingsControlsBtn")?.focus();
}

function closeSettingsControls() {
  document.getElementById("settingsControlsBackdrop")?.setAttribute("hidden", "");
  if (navigationState.state === NAVIGATION_STATES.SETTINGS) {
    navigationState.transition(navigationStateBeforeSettings);
  }
}

function renderGlobalNavigationState(state) {
  const buttonIdByState = {
    [NAVIGATION_STATES.MEDIA]: "openMediaWorkspaceBtn",
    [NAVIGATION_STATES.SONGS]: "openSongsWorkspaceBtn",
    [NAVIGATION_STATES.BIBLE]: "openBibleWorkspaceBtn",
    [NAVIGATION_STATES.SLIDES]: "openSlidesWorkspaceBtn",
    [NAVIGATION_STATES.STAGE]: "openStageControlsBtn",
    [NAVIGATION_STATES.SETTINGS]: "openSettingsBtn",
  };
  const activeButtonId = buttonIdByState[state];
  document.querySelectorAll(".global-navigation__item").forEach((button) => {
    const active = button.id === activeButtonId;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document
    .getElementById("stageControlsBackdrop")
    ?.toggleAttribute("hidden", state !== NAVIGATION_STATES.STAGE);
  document
    .getElementById("settingsControlsBackdrop")
    ?.toggleAttribute("hidden", state !== NAVIGATION_STATES.SETTINGS);
}

function openPreferencesWindow() {
  return invoke("open-preferences-window").catch((error) => {
    console.error("Failed to open Preferences:", error);
    showGnomeToast("Could not open Preferences");
  });
}

function selectNavigationForQueueItem(item) {
  if (isQueueItemBible(item)) {
    if (!bibleUiEnabled) {
      navigationState.transition(NAVIGATION_STATES.MEDIA);
      return;
    }
    navigationState.transition(NAVIGATION_STATES.BIBLE);
  } else if (isQueueItemDeck(item)) {
    navigationState.transition(NAVIGATION_STATES.SLIDES);
  } else if (isQueueItemSong(item)) {
    navigationState.transition(NAVIGATION_STATES.SONGS);
  } else {
    // PowerPoint remains externally-authored presentation media. It uses its
    // contextual PPT/PPTX viewer inside Media, not the native Slides editor.
    navigationState.transition(NAVIGATION_STATES.MEDIA);
  }
}

function getFocusableControls() {
  if (!focusableControls) {
    setSharedRendererState({ focusableControls: controlsOverlay.querySelectorAll(
      'button, input[type="range"]',
    ) });
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
  setSharedRendererState({ playPauseBtn: document.getElementById("playPauseBtn") });
  setSharedRendererState({ playPauseIcon: document.getElementById("playPauseIcon") });
  setSharedRendererState({ timeline: document.getElementById("timeline") });
  setSharedRendererState({ currentTimeDisplay: document.getElementById("currentTime") });
  setSharedRendererState({ durationTimeDisplay: document.getElementById("durationTime") });
  setSharedRendererState({ repeatButton: document.getElementById("mediaWindowRepeatButton") });
  setSharedRendererState({ video: document.getElementById("preview") });
  // The dedicated cue overlay lives next to #preview in the wrapper. It is
  // recreated whenever the media form is rebuilt, so its control-side
  // listeners are registered alongside the main element's listeners below
  // (under the same AbortController) and torn down on the next rebuild.
  const previewCue = ensurePreviewCueVideoElement();
  setSharedRendererState({ videoWrapper: document.querySelector(".video-wrapper") });
  setSharedRendererState({ controlsOverlay: document.querySelector(".controls-overlay") });
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
    if (isPreviewWorkspaceOverlayVisible()) {
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
  const mediaIsNetworkTransport = (mediaEl) =>
    Boolean(mediaEl && mediaEl === video && networkPreviewUsesRendererCapture());
  const mediaIsNetworkCue = (mediaEl) =>
    Boolean(mediaEl && mediaEl === previewCue && isNetworkVideoPreviewCueActive());
  const controlMediaHasSource = (mediaEl) =>
    Boolean(
      mediaEl &&
        (mediaIsNetworkTransport(mediaEl) ||
          mediaIsNetworkCue(mediaEl) ||
          (typeof mediaEl.src === "string" && mediaEl.src !== "")),
    );
  const controlMediaDuration = (mediaEl) =>
    mediaIsNetworkTransport(mediaEl)
      ? networkPreviewTransportDuration()
      : Number.isFinite(mediaEl?.duration)
        ? mediaEl.duration
        : 0;
  const controlMediaCurrentTime = (mediaEl) =>
    mediaIsNetworkTransport(mediaEl)
      ? networkPreviewTransportCurrentTime()
      : Number.isFinite(mediaEl?.currentTime)
        ? mediaEl.currentTime
        : 0;
  const controlMediaPaused = (mediaEl) =>
    mediaIsNetworkTransport(mediaEl)
      ? networkPreviewTransportState.paused
      : mediaEl?.paused !== false;
  const controlMediaHidesTimeline = (mediaEl) => {
    if (!mediaEl || mediaEl === previewAudio || mediaEl === liveAudio) return false;
    if (mediaIsNetworkTransport(mediaEl)) return activeNetworkPreviewHidesScrubber();
    if (mediaIsNetworkCue(mediaEl)) {
      const cue = currentPreviewCue();
      return (
        networkPreviewCueLiveEdge ||
        queueItemHidesNetworkScrubber(cue?.item) ||
        networkPreviewSourceHidesScrubber(networkPreviewCueSource)
      );
    }
    if (mediaEl === video) {
      const previewItem = currentQueuePreviewItem();
      return (
        networkPreviewMirrorLiveEdge ||
        queueItemHidesNetworkScrubber(previewItem) ||
        networkPreviewSourceHidesScrubber(mediaFile) ||
        networkPreviewSourceHidesScrubber(networkPreviewMirrorSource) ||
        networkPreviewSourceHidesScrubber(activePreviewResolvedMediaFile) ||
        networkPreviewSourceHidesScrubber(mediaEl.currentSrc || mediaEl.src)
      );
    }
    return false;
  };
  const controlMediaTimelineSeekable = (mediaEl) =>
    !isPreviewWorkspaceOverlayVisible() &&
    !controlMediaHidesTimeline(mediaEl) &&
    controlMediaDuration(mediaEl) > 0;
  const setTimelineControlsHidden = (hidden) => {
    if (overlay) {
      overlay.dataset.timelineHidden = hidden ? "true" : "false";
    }
    [currentTimeDisplay, timeline, durationTimeDisplay].forEach((el) => {
      if (el) el.hidden = hidden;
    });
    if (hidden && timeline) {
      timeline.disabled = true;
      timeline.value = 0;
    }
  };
  const paintControlPlayPauseIcon = (mediaEl) => {
    if (!playPauseIcon) return;
    playPauseIcon.innerHTML = controlMediaPaused(mediaEl)
      ? `<path d="M8 5v14l11-7z"/>`
      : `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
  };
  const pauseControlMedia = async (mediaEl) => {
    if (mediaIsNetworkTransport(mediaEl)) {
      setNetworkPreviewTransportPaused(true);
      await send("play-ctl", "pause");
      beginPreviewForwardingSuppression();
      try {
        mediaEl.pause();
      } finally {
        endPreviewForwardingSuppression();
      }
      return;
    }
    mediaEl?.pause();
  };
  const playControlMedia = async (mediaEl, reason) => {
    if (mediaIsNetworkTransport(mediaEl)) {
      setNetworkPreviewTransportPaused(false);
      await send("play-ctl", "play");
      await playNetworkPreviewMirror(reason || "network preview transport");
      window.setTimeout(() => {
        void refreshNetworkPreviewTransportState();
      }, 80);
      return;
    }
    await playVideoSafely(mediaEl, reason);
    updateControlsForMetadata(mediaEl);
    updateControlsForTime(mediaEl);
  };
  const updateControlsForMetadata = (mediaEl) => {
    if (currentMode !== MEDIAPLAYER || mediaEl !== currentControlMedia()) {
      return;
    }
    if (previewTransportLoadIsPending()) {
      timeline.disabled = true;
      return;
    }
    timeline.min = 0;
    timeline.max = 100;

    const duration = controlMediaDuration(mediaEl);
    const overlayBlocksTransport = isPreviewWorkspaceOverlayVisible();
    const hidesTimeline = controlMediaHidesTimeline(mediaEl);
    const hasSeekableMedia = duration > 0 && !hidesTimeline && !overlayBlocksTransport;
    const currentTime = controlMediaCurrentTime(mediaEl);

    setTimelineControlsHidden(hidesTimeline || overlayBlocksTransport);
    timeline.value =
      hasSeekableMedia ? (currentTime / duration) * 100 : 0;
    timeline.disabled = !hasSeekableMedia;
    if (isTransportControlsPaintVisible()) {
      paintTransportControlsTime(currentTimeDisplay, currentTime);
      paintTransportControlsTime(durationTimeDisplay, duration);
    }

    paintControlPlayPauseIcon(mediaEl);

    if (overlay) {
      if (overlayBlocksTransport) {
        overlay.style.visibility = "hidden";
      } else {
        overlay.style.display = "";
        overlay.style.visibility =
          hasSeekableMedia ||
          hidesTimeline ||
          mediaIsNetworkTransport(mediaEl) ||
          mediaIsNetworkCue(mediaEl)
            ? "visible"
            : "hidden";
      }
    }

    updateLoopControlState();
  };
  const updateControlsForTime = (mediaEl) => {
    if (mediaEl !== currentControlMedia()) return;
    if (previewTransportLoadIsPending()) return;
    if (controlMediaHidesTimeline(mediaEl)) return;
    const duration = controlMediaDuration(mediaEl);
    const currentTime = controlMediaCurrentTime(mediaEl);
    if (timeline === null) return;
    if (!isTransportControlsPaintVisible()) {
      return;
    }
    paintTransportControlsTime(currentTimeDisplay, currentTime);

    if (!isDragging && duration > 0) {
      timeline.value = (currentTime / duration) * 100;
    }
  };

  if (videoWrapper && controlsOverlay) {
    // 1. Initial State: Controls are hidden, so remove them from the tab sequence.
    disableTabFocus();

    // 2. Event Handlers: Use mouseenter/mouseleave to control the tabindex.
    // These MUST use `signal` so view rebuilds (which call setup again) do not
    // stack duplicate handlers and eventually make the UI feel sluggish.
    videoWrapper.addEventListener(
      "mouseenter",
      () => {
        if (setupCustomMediaControls.mouseLeaveFocusTimer != null) {
          window.clearTimeout(setupCustomMediaControls.mouseLeaveFocusTimer);
          setupCustomMediaControls.mouseLeaveFocusTimer = null;
        }
        enableTabFocus();
        const mediaEl = currentControlMedia();
        if (
          mediaEl &&
          (controlMediaDuration(mediaEl) > 0 ||
            controlMediaHidesTimeline(mediaEl) ||
            mediaIsNetworkTransport(mediaEl) ||
            mediaIsNetworkCue(mediaEl))
        ) {
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
      if (!controlMediaHasSource(mediaEl)) return;

      if (controlMediaPaused(mediaEl)) {
        if (mediaIsNetworkTransport(mediaEl)) {
          await playControlMedia(mediaEl, "custom controls network toggle");
          return;
        }
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
          setSharedRendererState({ masterPauseState: false });
          await unPauseMedia({ target: mediaEl });
          await playLivePreviewMirrorSafely("custom controls toggle");
        } else {
          await playVideoSafely(mediaEl, "custom controls toggle");
        }
      } else {
        if (mediaIsNetworkTransport(mediaEl)) {
          await pauseControlMedia(mediaEl);
          return;
        }
        if (previewMediaControlsLiveProjection(mediaEl)) {
          setSharedRendererState({ masterPauseState: true });
          await pauseMedia({ target: mediaEl });
        }
        mediaEl.pause();
      }
    },
    sig,
  );

  video.addEventListener(
    "play",
    (event) => {
      if (event.target !== currentControlMedia()) return;
      if (mediaIsNetworkTransport(event.target)) return;
      if (event.target.src === "" || currentMode !== MEDIAPLAYER) return;
      updateControlsForMetadata(event.target);
      updateControlsForTime(event.target);
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
      setSharedRendererState({ localTimeStampUpdateIsRunning: false });
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
      if (mediaIsNetworkTransport(event.target)) return;
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
      if (!controlMediaTimelineSeekable(mediaEl)) return;
      wasPlayingBeforeDrag = !controlMediaPaused(mediaEl);
      isDragging = true;
      // Pause playback for stable seeking
      void pauseControlMedia(mediaEl);
    },
    sig,
  );
  timeline.addEventListener(
    "touchstart",
    () => {
      const mediaEl = currentControlMedia();
      if (!controlMediaTimelineSeekable(mediaEl)) return;
      wasPlayingBeforeDrag = !controlMediaPaused(mediaEl);
      isDragging = true;
      // Pause playback for stable seeking
      void pauseControlMedia(mediaEl);
    },
    { passive: true, signal: controller.signal },
  );

  // Seek immediately on 'input' for live frame updates
  timeline.addEventListener(
    "input",
    () => {
      const mediaEl = currentControlMedia();
      if (!controlMediaTimelineSeekable(mediaEl)) return;
      const duration = controlMediaDuration(mediaEl);
      if (duration <= 0) return;
      const seekTime = (timeline.value / 100) * duration;
      const seekToken = ++timelineSeekToken;

      currentTimeDisplay && paintTransportTimeDisplay(currentTimeDisplay, seekTime);
      const seekPromise = mediaIsNetworkTransport(mediaEl)
        ? seekNetworkPreviewTransport(seekTime)
        : seekMedia(mediaEl, seekTime);
      void seekPromise.then((actualTime) => {
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
        const mediaEl = currentControlMedia();
        if (mediaIsNetworkTransport(mediaEl)) {
          void playControlMedia(mediaEl, "custom controls network scrub resume");
          return;
        }
        // Use .catch() for promise errors if browser auto-play is blocked (common with video.play())
        mediaEl?.play().catch((e) => {
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
      if (mediaIsNetworkTransport(event.target)) return;
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
      if (mediaIsNetworkTransport(video)) return;
      // While the audience media window is live, #preview is only a mirror of
      // the projection. Writing video.currentTime here fires a "seeked" event
      // that seekLocalMedia forwards to the projection as a timeGoto-message,
      // seeking the LIVE output back to 0 — i.e. the audience video loops. On
      // slower machines the mirror reaches "ended" before the projection fires
      // its own onended, so this reset wins the race and the queue loops
      // instead of advancing/closing. Let the projection own its end-of-media.
      if (isActiveMediaWindow()) {
        tracePlayback("customControls ended: skip reset (projection live)");
        return;
      }
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
        if (!controlMediaHasSource(mediaEl)) return;
        const isControl = event.target.closest("#customControls");

        if (!isControl) {
          if (controlMediaPaused(mediaEl)) {
            if (mediaIsNetworkTransport(mediaEl)) {
              void playControlMedia(mediaEl, "network preview click toggle");
              event.stopPropagation();
              return;
            }
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
              setSharedRendererState({ masterPauseState: false });
              void unPauseMedia({ target: mediaEl });
              void playLivePreviewMirrorSafely("preview click toggle");
            } else {
              void playVideoSafely(mediaEl, "preview click toggle");
            }
          } else {
            if (mediaIsNetworkTransport(mediaEl)) {
              void pauseControlMedia(mediaEl);
              event.stopPropagation();
              return;
            }
            if (previewMediaControlsLiveProjection(mediaEl)) {
              setSharedRendererState({ masterPauseState: true });
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
  setupCustomMediaControls.updateControlsForCurrentMedia = () => {
    const mediaEl = currentControlMedia();
    if (!mediaEl) return;
    updateControlsForMetadata(mediaEl);
    updateControlsForTime(mediaEl);
  };
  setupCustomMediaControls.updateControlsForNetworkTransport = () => {
    const mediaEl = currentControlMedia();
    if (!mediaIsNetworkTransport(mediaEl)) return;
    updateControlsForMetadata(mediaEl);
    updateControlsForTime(mediaEl);
  };
  syncMediaLoopState({ notify: false });
}

function closeVolumePopup() {
  const slider = document.getElementById("gtkVolSlider");
  if (!slider) return;

  slider.blur();
  setSharedRendererState({ volumePopupOpen: false });

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
    const displayVol = cueVol !== null ? cueVol : getLivePreviewDisplayVolume();
    slider.value = Math.round(displayVol * 100);
    gtkUpdateVolIcon?.(slider.value);
    return;
  }
  slider.dataset.gtkVolBound = "1";

  slider.addEventListener("mousedown", () => {
    setSharedRendererState({ volumePopupOpen: true });
  });

  slider.addEventListener(
    "touchstart",
    () => {
      setSharedRendererState({ volumePopupOpen: true });
    },
    { passive: true },
  );

  // Initialize slider value based on the current live/cue transport volume.
  slider.value = Math.round(getLivePreviewDisplayVolume() * 100);

  // Helper function to update the icon's appearance
  function updateIcon(v) {
    // --- 1. Define the GTK4 Symbolic Icon paths (16x16 viewBox) ---
    const CONE_PATH = `<path d="M 1 5 L 4 5 L 7 2 L 7 14 L 4 11 L 1 11 Z"/>`;

    // Arcs are stroked paths with 'fill="none"'
    const ARC_1 = `<path id="arc1" d="M 9 7.5 C 9.5 7.5 9.5 8.5 9 8.5" fill="none" stroke="currentColor" stroke-width="1"/>`;
    const ARC_2 = `<path id="arc2" d="M 10 6 C 11 6 11 10 10 10" fill="none" stroke="currentColor" stroke-width="1"/>`;
    const ARC_3 = `<path id="arc3" d="M 12 4 C 14 4 14 12 12 12" fill="none" stroke="currentColor" stroke-width="1"/>`;

    // --- 2. Update Icon based on volume/mute state ---
    const mutedForIcon = isPreviewCueVolumeActive()
      ? v == 0
      : networkPreviewUsesRendererCapture()
        ? networkPreviewTransportState.muted
        : video.muted;
    if (mutedForIcon || v == 0) {
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
    } else if (networkPreviewUsesRendererCapture()) {
      setNetworkPreviewVolume(v, v === 0);
      if (currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length) {
        mediaQueue[currentQueueIndex].cueVolume = v;
      }
      updateIcon(slider.value);
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
    if (networkPreviewUsesRendererCapture()) return;
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
    } else if (networkPreviewUsesRendererCapture()) {
      const currentVol = networkPreviewTransportState.muted
        ? 0
        : networkPreviewTransportState.volume;
      if (currentVol === 0) {
        const restored = lastVolume > 0 ? lastVolume : 1;
        setNetworkPreviewVolume(restored, false);
        slider.value = Math.round(restored * 100);
      } else {
        lastVolume = currentVol;
        setNetworkPreviewVolume(networkPreviewTransportState.volume, true);
        slider.value = 0;
      }
      updateIcon(slider.value);
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

function syncGtkSliderToCueState() {
  const slider = document.getElementById("gtkVolSlider");
  if (!slider) return;
  const cueVol = getPreviewCueDisplayVolume();
  const displayVol = cueVol !== null ? cueVol : getLivePreviewDisplayVolume();
  slider.value = Math.round(displayVol * 100);
  gtkUpdateVolIcon?.(slider.value);
}

function consumePendingCueVolume(playbackIndex) {
  const index =
    typeof playbackIndex === "number" ? playbackIndex : currentQueueIndex;
  const vol = resolveQueueItemPlaybackVolume(index) ?? 1;
  setSharedRendererState({ pendingCueVolume: null });
  setSharedRendererState({ cueVolumeDirty: false });

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

function handleWindowMax(event, isMaximized) {
  document
    .querySelector(".window-container")
    .classList.toggle("maximized", isMaximized);
}

function installIPCHandler() {
  timeRemaining?.onTick?.((duration, currentTime, timestamp, mediaPath) => {
    handleTimeMessage(duration, currentTime, timestamp, mediaPath);
    const remaining = Math.max(0, Math.ceil((Number(duration) || 0) - (Number(currentTime) || 0)));
    if (remaining === lastStageCountdownSecond) return;
    setSharedRendererState({ lastStageCountdownSecond: remaining });
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const seconds = remaining % 60;
    const countdown = `${hours ? `${hours}:` : ""}${String(minutes).padStart(hours ? 2 : 1, "0")}:${String(seconds).padStart(2, "0")}`;
    void sendStageLayer("widgets", {
      serviceItem: stageContentCache.serviceItem || "",
      mediaRemaining: countdown,
      countdown,
    }).catch(() => {});
  });
  on("preferences-updated", (_event, prefs) => {
    applyOutputHoldPreferences(prefs);
    applyLowerThirdOutputPreferences(prefs);
    renderSongLowerThirdControls();
    scheduleAutosaveProjectState();
  });
  on("theme-applied", (_event, theme) => {
    setSharedRendererState({ projectThemeDefaults: {
      schema: "ems.project-themes.v1",
      bindings: { song: theme.id, scripture: theme.id, text: theme.id, lowerThird: theme.id },
      snapshots: { [theme.id]: { theme } },
    } });
    void applyThemeToLivePresentation(theme).catch(error => {
      console.error("Failed to apply theme to live presentation:", error);
      showGnomeToast("Theme saved, but the live output could not be updated");
    });
  });
  on("theme-applied-to-item", (_event, payload) => {
    const index = payload?.queueIndex;
    if (!queueIndexInRange(index) || !payload?.theme) return;
    const item = mediaQueue[index];
    item.itemTheme = setItemThemeRole(item.itemTheme, {
      theme: payload.theme,
      outputRole: payload.outputRole,
      profile: payload.profile,
    });
    if (isQueueItemBible(item) && item.bible) item.bible.itemTheme = item.itemTheme;
    renderQueue();
    scheduleAutosaveProjectState();
    if (index === previewCueIndex || index === currentQueueIndex) {
      void loadQueueItemIntoControlWindow(item, { previewLoadToken: nextPreviewLoadToken() }).catch(console.error);
    }
    showGnomeToast(`Applied “${payload.theme.name}” to ${item.name || "scheduled item"}`);
  });
  on("theme-cleared-from-item", (_event, payload) => {
    const index = payload?.queueIndex;
    if (!queueIndexInRange(index)) return;
    delete mediaQueue[index].itemTheme;
    if (mediaQueue[index].bible) delete mediaQueue[index].bible.itemTheme;
    renderQueue();
    scheduleAutosaveProjectState();
    showGnomeToast(`${mediaQueue[index].name || "Scheduled item"} now uses the project theme`);
  });
  on("songs-database-cleared", () => {
    void handleSongsDatabaseCleared().catch(console.error);
  });
  on("update-playback-state", handlePlaybackState);
  on("media-preview-rtc-signal", (event, message) => {
    void handleMediaPreviewRtcSignal(event, message);
  });
  on("remoteplaypause", handlePlayPause);
  on("media-window-closed", handleMediaWindowClosed);
  on("media-window-closed", () => {
    resetBiblePreviewMediaWindowSize();
    syncBiblePreviewOutputScale();
  });
  on("lower-third-window-closed", () => {
    setSharedRendererState({ bibleLowerThirdOutputActive: false });
    setSharedRendererState({ activeLowerThirdContentType: null });
    songLowerThirdState.liveKey = "";
    renderSongLowerThirdControls();
    stopLowerThirdRendererPreviewCapture();
    syncConfidenceMonitorCarousel();
  });
  on("media-source-stabilizing", (_event, payload) => {
    markQueueItemMediaUpdate({ ...payload, status: "stabilizing" });
  });
  on("media-source-changed", (_event, payload) => {
    markQueueItemMediaUpdate(payload);
  });
  on("media-playback-ended", async (event, endedMediaFile) => {
    tracePlayback(
      "media-playback-ended IN",
      "ended=" + (endedMediaFile || ""),
      "live=" + mediaFile,
      "idx=" + currentQueueIndex,
      "epoch=" + liveMediaWindowEpoch,
      "consumed=" + consumedMediaWindowEndEpoch,
    );
    if (userStopPresentationPending) {
      setSharedRendererState({ mediaPlaybackEndedPending: false });
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
      tracePlayback("media-playback-ended DROP stale (not live clip)");
      return;
    }
    if (loopEnabledForLiveMedia(endedMediaFile || mediaFile)) {
      setSharedRendererState({ mediaPlaybackEndedPending: false });
      syncMediaLoopState();
      tracePlayback("media-playback-ended LOOP (re-sync, no advance)");
      return;
    }
    // On slower machines the projection's end IPC can race the local preview
    // mirror and the async slipstream transition. Claim the live clip's end so
    // exactly one transition happens per clip: a duplicate/stale end that
    // arrives after the control side already advanced is ignored here, which is
    // what previously let the finished clip replay or the queue skip/desync.
    if (!claimMediaWindowEnd()) {
      tracePlayback("media-playback-ended DROP duplicate (epoch consumed)");
      return;
    }
    setSharedRendererState({ mediaPlaybackEndedPending: true });
    try {
      const slipstreamed = await trySlipstreamNextQueueItem();
      if (slipstreamed) {
        // Keep the renderer's cache aligned with reality: this transition keeps
        // the projection BrowserWindow alive, so the app should remain in
        // "active media window" state.
        setSharedRendererState({ isActiveMediaWindowCache: true });
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
  updateClearLiveTextButtonState();
  updateOutputHoldButtonStates();

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
      const value = event.target.value || "";
      send("set-display-index", value);
      syncPeerSelects(event.target);
      syncBiblePreviewOutputScale();
      queueBiblePreviewMediaWindowSizeRefresh(50);
    };
  });
  if (lowerThirdDisplaySelect) {
    lowerThirdDisplaySelect.onchange = (event) => {
      const value = event.target.value || "";
      send("set-lower-third-display-index", value);
      if (!value) {
        void closeBibleLowerThirdOutput();
      } else {
        void syncShowNowBiblePresentation().catch(console.error);
        syncActiveScheduledBiblePresentation();
      }
      syncBiblePreviewOutputScale();
      syncSongLowerThirdForSection(currentSongActiveSection(), { rebuild: true });
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
  setSharedRendererState({ currentMode: STREAMPLAYER });
  send("set-mode", currentMode);
  updateHeaderAddMediaButtonVisibility();

  ensureStreamsPanelBuilt();

  const mediaPanel = document.getElementById(TAB_PANEL_MEDIA_ID);
  const streamsPanel = document.getElementById(TAB_PANEL_STREAMS_ID);
  if (mediaPanel) mediaPanel.hidden = true;
  if (streamsPanel) streamsPanel.hidden = false;

  restoreLivePreviewIntoPanel(streamsPanel);

  setSharedRendererState({ video: document.getElementById("preview") });
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
    setSharedRendererState({ isPlaying: true });
    updateDynUI();
    return;
  }
  restoreMediaFile();

  if (mdFile?.value.includes(":\\fakepath\\")) {
    mdFile.value = "";
  }

  if (!isActiveMediaWindow()) {
    setSharedRendererState({ isPlaying: false });
  } else {
    setSharedRendererState({ isPlaying: true });
  }
  updateDynUI();
}

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

function setSBFormMediaPlayer() {
  if (currentMode === MEDIAPLAYER) {
    return;
  }
  setSharedRendererState({ currentMode: MEDIAPLAYER });
  send("set-mode", currentMode);
  updateHeaderAddMediaButtonVisibility();

  ensureMediaPanelBuilt();
  showMediaLibraryWorkspace();

  const streamsPanel = document.getElementById(TAB_PANEL_STREAMS_ID);
  const mediaPanel = document.getElementById(TAB_PANEL_MEDIA_ID);
  if (streamsPanel) streamsPanel.hidden = true;
  if (mediaPanel) mediaPanel.hidden = false;

  restoreLivePreviewIntoPanel(mediaPanel);
  syncStreamRendererPreviewCapture();
  syncLowerThirdRendererPreviewCapture();

  ensureMediaCountdownDigitNodes();
  installDisplayChangeHandler();
  populateDisplaySelect();

  if (video === null) {
    setSharedRendererState({ video: document.getElementById("preview") });
  } else {
    restoreMediaFile();
    updateTimestamp();
  }
  getCachedPlatformOS()
    .then((operatingSystem) => {
      if (video && video !== cubicWaveShaperAttachedVideo) {
        attachCubicWaveShaper(video, undefined, undefined, operatingSystem);
        setSharedRendererState({ cubicWaveShaperAttachedVideo: video });
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
  installNetworkItemButton();
  installPreviewEmptyStateHandlers();
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
    setSharedRendererState({ isPlaying: false });
  } else {
    setSharedRendererState({ isPlaying: true });
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
        setSharedRendererState({ mediaFile: mediaPlayerInputState.filePaths[0] });
      }
      isImgFile = isImg(mediaFile);
      if (isActiveMW && mediaFile !== null && !isLiveStream(mediaFile)) {
        if (video === null) {
          setSharedRendererState({ video: document.getElementById("preview") });
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
    setSharedRendererState({ img: document.createElement("img") });
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
  refreshPreviewControlsForCurrentMedia();
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
    setSharedRendererState({ img: document.createElement("img") });
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

function shortcutHandler(event) {
  const target = event.target;
  const editing = target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
  const liveCommand = editing || event.key === "F8" ? null : commandForShortcut(event);
  if (liveCommand) {
    event.preventDefault();
    void executeLiveCommand(liveCommand);
    return;
  }
  if (handleOutputHoldShortcut(event)) return;
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

async function executeLiveCommand(command) {
  if (command === LIVE_COMMANDS.ALERT_SHOW) {
    if (document.getElementById("liveLayersBackdrop")?.hidden) await openLiveLayers("message");
    else if (activeLiveLayersPage !== "message") selectLiveLayersPage("message", { focus: true });
    else await showAudienceAlert();
    return;
  }
  if (command === LIVE_COMMANDS.ALERT_CLEAR) return clearAudienceAlert();
  if (command === LIVE_COMMANDS.STAGE_SHOW) {
    if (document.getElementById("stageControlsBackdrop")?.hidden) return openStageControls();
    return showPrivateStageMessage();
  }
  if (command === LIVE_COMMANDS.STAGE_CLEAR) return clearPrivateStageMessage();
  if (command === LIVE_COMMANDS.CLEAR) return clearLiveText();
  if (command === LIVE_COMMANDS.BLACK) return toggleBlackScreen();
  if (command === LIVE_COMMANDS.LOGO) return toggleLogoHold();
  if (command === LIVE_COMMANDS.GO_LIVE) {
    const cue = currentPreviewCue();
    if (cue && queueIndexInRange(cue.index)) return takeQueueItemLive(cue.index, cue.startTime || 0);
    return playMedia();
  }
  const direction = command === LIVE_COMMANDS.NEXT ? 1 : command === LIVE_COMMANDS.PREVIOUS ? -1 : 0;
  if (!direction) return;
  const textButton = activeMediaWindowContentType === "song"
    ? document.getElementById(direction > 0 ? "songNextSecBtn" : "songPrevSecBtn")
    : activeMediaWindowContentType === "bible"
      ? document.getElementById(direction > 0 ? "bibleNextSlideBtn" : "biblePrevSlideBtn")
      : null;
  if (textButton && !textButton.disabled) {
    textButton.click();
    return;
  }
  const index = direction > 0
    ? nextPlayableQueueIndexAfter(currentQueueIndex)
    : previousPlayableQueueIndexBefore(currentQueueIndex);
  if (index >= 0) return takeQueueItemLive(index, 0);
}

function modeSwitchHandler(event) {
  if (event.target.type === "radio") {
    if (event.target.value === "Media Player") {
      installPreviewEventHandlers();
      updateTimestamp();
    }
  }
}

function installEvents() {
  document.getElementById("MdPlyrRBtnFrmID")?.addEventListener(
    "click",
    () => {
      if (currentMode === MEDIAPLAYER) {
        return;
      }
      if (currentMode === TEXTPLAYER) {
        cleanRefs({ fullDestroy: true });
      }
      if (mediaFile != null && mediaFile != "" && !isLiveStream(mediaFile)) {
        preModeChangeFixups();
      }
      setSBFormMediaPlayer();
    },
    { passive: true },
  );

  document.addEventListener("keydown", shortcutHandler);
  document
    .querySelector("form")
    ?.addEventListener("change", modeSwitchHandler, { passive: true });
}

function handleVolumeChange(event) {
  if (event?.target === video && networkPreviewUsesRendererCapture()) {
    return;
  }
  if (event.target.id === "volume-slider" && !isLiveStream(mediaFile)) {
    return;
  }
  if (currentMode === STREAMPLAYER) {
    setSharedRendererState({ streamVolume: event.target.value });
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
  setSharedRendererState({ pidController: new PIDController(video, {
    isActiveMediaWindow,
    beginPidSeekSuppression,
  }) });
}

function installAdaptiveHeaderTitleSpacing() {
  const header = document.querySelector(".headerbar");
  const end = header?.querySelector(":scope > .headerbar-end");
  const title = header?.querySelector(":scope > #WindowTitle");
  if (!header || !end || !title || header.dataset.titleSpacingBound === "1") {
    return;
  }
  header.dataset.titleSpacingBound = "1";
  let frame = null;
  const updateInset = () => {
    frame = null;
    const headerRect = header.getBoundingClientRect();
    const endRect = end.getBoundingClientRect();
    const rightInset = Math.max(0, headerRect.right - endRect.left);
    const safeInset = Math.ceil(rightInset + 12);
    header.style.setProperty("--headerbar-title-end-inset", `${safeInset}px`);
  };
  const scheduleUpdate = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(updateInset);
  };
  const resizeObserver = new ResizeObserver(scheduleUpdate);
  resizeObserver.observe(header);
  resizeObserver.observe(end);
  scheduleUpdate();
}

async function loadOpMode(mode) {
  const execute = async () => {
    try {
      installAdaptiveHeaderTitleSpacing();
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
      document
        .getElementById("menuThemeManager")
        ?.addEventListener("click", () => {
          void invoke("open-theme-manager-window").catch(console.error);
        });
      document
        .getElementById("menuPreferences")
        ?.addEventListener("click", () => {
          void openPreferencesWindow();
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
      const clearLiveTextBtn = document.getElementById("clearLiveTextButton");
      if (clearLiveTextBtn && clearLiveTextBtn.dataset.clearLiveTextBound !== "1") {
        clearLiveTextBtn.dataset.clearLiveTextBound = "1";
        clearLiveTextBtn.addEventListener("click", () => {
          void clearLiveText().catch(console.error);
        });
      }
      const blackScreenBtn = document.getElementById("blackScreenButton");
      if (blackScreenBtn && blackScreenBtn.dataset.blackScreenBound !== "1") {
        blackScreenBtn.dataset.blackScreenBound = "1";
        blackScreenBtn.addEventListener("click", (event) => {
          if (event.detail > 1) {
            event.preventDefault();
            return;
          }
          toggleBlackScreen();
        });
      }
      const logoHoldBtn = document.getElementById("logoHoldButton");
      if (logoHoldBtn && logoHoldBtn.dataset.logoHoldBound !== "1") {
        logoHoldBtn.dataset.logoHoldBound = "1";
        logoHoldBtn.addEventListener("click", (event) => {
          if (event.detail > 1) {
            event.preventDefault();
            return;
          }
          void toggleLogoHold().catch(console.error);
        });
      }
      updateOutputHoldButtonStates();

      // Mode setup. The legacy stream mode is folded into the Media schedule;
      // stale saved settings for STREAMPLAYER now open the schedule view.
      const mediaRadio = document.getElementById("MdPlyrRBtnFrmID");
      if (mediaRadio) mediaRadio.checked = true;
      setSBFormMediaPlayer();
      installPreviewEventHandlers();
      await restoreAutosavedProjectState();

      // Drag and drop: the renderer is the OS-level drop target (Electron does
      // not surface drop events to the main process). The renderer only
      // extracts native paths via webUtils.getPathForFile and then defers all
      // media-type filtering / validation to the main process via IPC.
      document.addEventListener("dragover", (event) => event.preventDefault());
      document.addEventListener("dragstart", (event) => {
        if (event.target.closest?.("[data-media-item-id], #mediaLibraryPreview")) return;
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
        showGnomeToast("Drop media on the Schedule to use it, or on Media to keep it");
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

export {
  addFilenameToTitlebar,
  audioContext,
  audioOutputs,
  audioSource,
  cachedGetPlatformPromise,
  changeAudioOutput,
  closeSettingsControls,
  closeVolumePopup,
  consumePendingCueVolume,
  disableTabFocus,
  enableTabFocus,
  executeLiveCommand,
  getAudioDevices,
  getCachedPlatformOS,
  getFocusableControls,
  gtkUpdateVolIcon,
  handleVolumeChange,
  handleWindowMax,
  installAdaptiveHeaderTitleSpacing,
  installEvents,
  installIPCHandler,
  installMediaOpenButton,
  installPreviewEventHandlers,
  loadOpMode,
  modeChangeFixups,
  modeSwitchHandler,
  navigationState,
  navigationStateBeforeSettings,
  openMediaFilesDialog,
  openPreferencesWindow,
  openSettingsControls,
  populateDisplaySelect,
  preModeChangeFixups,
  removeFilenameFromTitlebar,
  renderGlobalNavigationState,
  selectNavigationForQueueItem,
  setSBFormMediaPlayer,
  setSBFormStreamPlayer,
  setupCustomMediaControls,
  setupGtkVolumeControl,
  shortcutHandler,
  syncGtkSliderToCueState,
  updateDynUI,
  updateHeaderAddMediaButtonVisibility,
};
