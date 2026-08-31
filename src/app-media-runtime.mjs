/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/*
 * Live media runtime: play/pause, local media handlers, countdown overlay, and audience media window.
 */

import {
  MEDIAPLAYER,
  NETWORK_PREVIEW_PREROLL_BUFFER_SECONDS,
  NETWORK_PREVIEW_PREROLL_TIMEOUT_MS,
  STREAMPLAYER,
  TAB_PANEL_MEDIA_ID,
  TAB_PANEL_STREAMS_ID,
  __dirname,
  activeLiveStream,
  activeMediaWindowContentType,
  activeNetworkPreviewSource,
  activePreviewResolvedMediaFile,
  activeResolvedMediaFile,
  addFilenameToTitlebar,
  advanceQueueAfterMediaWindowClosed,
  applyVideoPoster,
  audioOnlyFile,
  beginLiveMediaWindowEpoch,
  beginPreviewForwardingSuppression,
  beginProjectionPlaybackStartupSync,
  bibleShowNowModeActive,
  clampMediaTime,
  classifyQueueMediaType,
  clearCueAfterTake,
  clearSongShowNowPresentation,
  clearVideoPoster,
  clearVideoPreviewCueOverlay,
  closeBibleLowerThirdOutput,
  consumePendingCueVolume,
  createQueueEntry,
  currentAudioPreviewQueueIndex,
  currentMode,
  currentPreviewCue,
  currentPreviewSourcePath,
  currentQueueIndex,
  currentQueuePreviewItem,
  currentTimeDisplay,
  desiredProjectionPreviewPlayback,
  disableNativeVideoControls,
  durationTimeDisplay,
  endPreviewForwardingSuppression,
  fileEnded,
  finishProjectionPlaybackStartupSync,
  getHostnameOrBasename,
  getPathForFile,
  getPreviewControlMediaElement,
  handleVolumeChange,
  hasAudienceOutputSelected,
  hidePptxPreview,
  imageRegex,
  img,
  invalidateQueueUndoToastAfterMutation,
  invoke,
  isActiveMediaWindow,
  isActiveMediaWindowCache,
  isAudioPreviewCueActive,
  isBiblePath,
  isFileBackedMediaPath,
  isHandlingLiveEnded,
  isLikelyAudioItem,
  isNetworkStreamSource,
  isNetworkVideoPreviewCueActive,
  isNonVideoPresentationItem,
  isPlayInterruptedError,
  isPlaying,
  isPptxPreviewVisible,
  isPreparingSeparateCue,
  isPreviewWorkspaceOverlayVisible,
  isQueueItemAudio,
  isQueueItemBible,
  isQueueItemSong,
  isQueuePlaying,
  isQueuePresentationActive,
  isSongPath,
  itc,
  latestExplicitProjectionPauseState,
  liveAudio,
  liveAudioQueueIndex,
  liveLoopTarget,
  liveMediaWindowEpoch,
  liveStartToken,
  localTimeStampUpdateIsRunning,
  loopEnabledForLiveMedia,
  loopTargetEnabled,
  markSongShowNowPresentation,
  masterPauseState,
  mediaElementBufferedAhead,
  mediaElementComparableSource,
  mediaElementLoadedAudioOnly,
  mediaFile,
  mediaPathMatchesCurrentLiveMedia,
  mediaPlaybackEndedPending,
  mediaPlayerInputState,
  mediaQueue,
  mediaSessionPause,
  networkPreviewMirrorLiveEdgeMatches,
  networkPreviewMirrorSource,
  networkPreviewTransportState,
  networkPreviewUsesRendererCapture,
  nextLiveStartToken,
  nextQueueBoundaryIndex,
  normalizeLiveEdgeQueueItemsForSources,
  normalizeMediaPathForCompare,
  onClearMediaQueueClick,
  paintCountdownFor,
  pathToMediaUrl,
  pauseLivePreviewMirrorFromProjection,
  pauseQueuePresentationAtBoundary,
  pendingCueVolume,
  pendingQueueSwitchIndex,
  pendingQueueSwitchStartTime,
  pidController,
  playCurrentQueueItem,
  playLivePreviewMirrorSafely,
  playNetworkPreviewMirror,
  playPauseBtn,
  playPauseIcon,
  playVideoSafely,
  playbackStateSyncGeneration,
  playbackTraceEnabled,
  playingMediaAudioOnly,
  pptxRegex,
  pptxStartSlideForItem,
  prePathname,
  presentationStartInProgress,
  presentationStartTimeForQueueItem,
  previewAudio,
  previewAudioCueIndex,
  previewCueIndex,
  previewCueVideo,
  previewElementSourceMatchesMediaFile,
  previewForwardingSuppressionDepth,
  projectionPlaybackStartupPending,
  queueBiblePreviewMediaWindowSizeRefresh,
  queueItemCueStartTime,
  queueItemIsLiveEdgeStream,
  queueItemMediaCacheBust,
  queueItemOwnsControlPreview,
  queueStartIndexForPresent,
  reconcileStalePlaybackSync,
  refreshLiveAudioControls,
  refreshNetworkPreviewTransportControls,
  refreshNetworkPreviewTransportState,
  removeFileProtocol,
  removeFilenameFromTitlebar,
  renderQueue,
  repeatButton,
  resetNetworkPreviewTransportState,
  resetPreviewWarningState,
  resolveQueueItemMediaPath,
  resolveQueuePresentationVideo,
  resolvedBibleEntryForItem,
  scheduleAutosaveProjectState,
  scheduleMediaWatchSync,
  scripturePresentation,
  seekMedia,
  send,
  sendBibleTextToOutput,
  sendPptxSlideToMediaWindow,
  sendSongTextToOutput,
  setNetworkPreviewCueAudio,
  setNetworkPreviewElementCaptureMuted,
  setNetworkPreviewElementLocalAudio,
  setSharedRendererState,
  setupCustomMediaControls,
  shouldAdvanceAfterCurrentItemEnds,
  shouldSuppressPreviewForwarding,
  showGnomeToast,
  showPreviewWarningToast,
  startTime,
  stashLivePreview,
  stopStreamRendererPreviewCapture,
  streamVolume,
  suppressPreviewForwarding,
  syncAudienceOutputHoldAfterPresentationStart,
  syncGtkSliderToCueState,
  syncMediaLoopState,
  syncNetworkPreviewMirrorCapture,
  syncQueuePreviewMediaElements,
  syncStreamRendererPreviewCapture,
  syncTrackedPreviewStartTime,
  targetTime,
  timeline,
  tracePlayback,
  updateClearLiveTextButtonState,
  updateDynUI,
  updateNetworkPreviewTransportState,
  updateOutputHoldButtonStates,
  updatePreviewCueUI,
  updateTimestamp,
  userStopPresentationPending,
  validMediaStartTime,
  video,
  waitForLoadedMetadata,
  waitForMediaMetadata,
} from "./app-renderer.mjs";

var pidSeeking = false;

var pidSeekingResetTimer = null;

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

const MEDIA_COUNTDOWN_DIGIT_COUNT = 12;

const countdownDigitNodes = [];

const countdownDigitLastCode = new Int32Array(MEDIA_COUNTDOWN_DIGIT_COUNT);

let countdownHasDisplayedDigits = false;

let mediaCountdownElement = null;

let countdownDigitParent = null;

const MEDIA_COUNTDOWN_CHAR_BY_CODE = new Array(128);

function ensurePreviewAudioElement() {
  if (!previewAudio) {
    setSharedRendererState({ previewAudio: new Audio() });
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
    setSharedRendererState({ liveAudio: new Audio() });
    liveAudio.preload = "auto";
    liveAudio.addEventListener("ended", endLiveAudioPresentation);
  }
  return liveAudio;
}

function stopLiveAudioPresentation() {
  setSharedRendererState({ liveStartToken: liveStartToken + (1) });
  if (liveAudio) {
    try {
      liveAudio.pause();
      liveAudio.removeAttribute("src");
      liveAudio.load();
    } catch (err) {
      console.error("Failed to stop live audio:", err);
    }
  }
  setSharedRendererState({ liveAudioQueueIndex: -1 });
  setSharedRendererState({ playingMediaAudioOnly: false });
}

function waitForMediaElementSource(mediaEl, timeoutMs = 750) {
  if (!mediaEl || mediaEl.src) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      mediaEl.removeEventListener("loadstart", finish);
      mediaEl.removeEventListener("loadedmetadata", finish);
      if (timer !== null) window.clearTimeout(timer);
      resolve();
    };
    mediaEl.addEventListener("loadstart", finish, { once: true });
    mediaEl.addEventListener("loadedmetadata", finish, { once: true });
    timer = window.setTimeout(finish, timeoutMs);
  });
}

function waitForMediaElementFrame(mediaEl, timeoutMs = 2500) {
  if (!mediaEl) return Promise.resolve();
  if (mediaEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      mediaEl.removeEventListener("loadeddata", finish);
      mediaEl.removeEventListener("canplay", finish);
      mediaEl.removeEventListener("playing", finish);
      mediaEl.removeEventListener("timeupdate", finish);
      if (timer !== null) window.clearTimeout(timer);
      resolve();
    };
    mediaEl.addEventListener("loadeddata", finish, { once: true });
    mediaEl.addEventListener("canplay", finish, { once: true });
    mediaEl.addEventListener("playing", finish, { once: true });
    mediaEl.addEventListener("timeupdate", finish, { once: true });
    timer = window.setTimeout(finish, timeoutMs);
  });
}

function waitForMediaElementBuffer(
  mediaEl,
  targetSeconds = NETWORK_PREVIEW_PREROLL_BUFFER_SECONDS,
  timeoutMs = NETWORK_PREVIEW_PREROLL_TIMEOUT_MS,
) {
  if (!mediaEl || !Number.isFinite(targetSeconds) || targetSeconds <= 0) {
    return Promise.resolve();
  }
  if (mediaElementBufferedAhead(mediaEl) >= targetSeconds) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      mediaEl.removeEventListener("progress", check);
      mediaEl.removeEventListener("canplay", check);
      mediaEl.removeEventListener("canplaythrough", check);
      mediaEl.removeEventListener("timeupdate", check);
      mediaEl.removeEventListener("stalled", check);
      mediaEl.removeEventListener("waiting", check);
      if (timer !== null) window.clearTimeout(timer);
      resolve();
    };
    const check = () => {
      const remaining =
        Number.isFinite(mediaEl.duration) && mediaEl.duration > 0
          ? Math.max(0, mediaEl.duration - (mediaEl.currentTime || 0))
          : targetSeconds;
      const effectiveTarget = Math.min(targetSeconds, remaining || targetSeconds);
      if (mediaElementBufferedAhead(mediaEl) >= effectiveTarget) {
        finish();
      }
    };
    mediaEl.addEventListener("progress", check);
    mediaEl.addEventListener("canplay", check);
    mediaEl.addEventListener("canplaythrough", check);
    mediaEl.addEventListener("timeupdate", check);
    mediaEl.addEventListener("stalled", check);
    mediaEl.addEventListener("waiting", check);
    timer = window.setTimeout(finish, timeoutMs);
    check();
  });
}

function syncPreviewAudioTrackState() {
  if (!video?.audioTracks || typeof video.audioTracks.length !== "number") {
    return;
  }

  const previewShouldBeAudible =
    !networkPreviewUsesRendererCapture() &&
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
  if (networkPreviewMirrorSource) {
    setNetworkPreviewElementLocalAudio();
  }
  if (isNetworkVideoPreviewCueActive()) {
    setNetworkPreviewCueAudio();
  }
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
  setSharedRendererState({ audioOnlyFile: true });
  setSharedRendererState({ playingMediaAudioOnly: true });
  setSharedRendererState({ isActiveMediaWindowCache: false });
  syncPreviewAudioTrackState();

  stopLiveAudioPresentation();
  if (!video.paused) {
    await video.pause();
  }
  setSharedRendererState({ isPlaying: false });
  setSharedRendererState({ isQueuePlaying: false });
  // Manual Stop ends the live output, but the stopped queue item should remain
  // selected so pressing Present again starts that item instead of item 1.
  if (currentQueueIndex < 0 || currentQueueIndex >= mediaQueue.length) {
    setSharedRendererState({ currentQueueIndex: -1 });
  }
  renderQueue();
  send("localMediaState", 0, "stop");
  removeFilenameFromTitlebar();
  setSharedRendererState({ localTimeStampUpdateIsRunning: false });
  updateDynUI();

  return true;
}

function timelineSync() {
  if ((video && video.src === "") || currentMode !== MEDIAPLAYER) return;
  setSharedRendererState({ playPauseBtn: document.getElementById("playPauseBtn") });
  setSharedRendererState({ playPauseIcon: document.getElementById("playPauseIcon") });
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
  if (mediaEl === video && networkPreviewUsesRendererCapture()) {
    glyph.innerHTML = networkPreviewTransportState.paused
      ? `<path d="M8 5v14l11-7z"/>`
      : `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
    return;
  }
  if (!mediaEl?.src || mediaEl.src === "") return;

  glyph.innerHTML = mediaEl.paused
    ? `<path d="M8 5v14l11-7z"/>`
    : `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
}

function refreshPreviewControlsForCurrentMedia() {
  const refresh = () => {
    setupCustomMediaControls.updateControlsForCurrentMedia?.();
    syncPlayPauseIconToControlMedia();
    syncGtkSliderToCueState();
  };
  refresh();
  window.requestAnimationFrame?.(refresh);
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
  if (networkPreviewUsesRendererCapture()) {
    if (playbackState.syncPhase === "stabilizing") {
      beginProjectionPlaybackStartupSync();
      return;
    }
    finishProjectionPlaybackStartupSync();
    setSharedRendererState({ masterPauseState: !playbackState.playing });
    updateNetworkPreviewTransportState({
      currentTime: playbackState.currentTime,
      paused: !playbackState.playing,
      timestamp: Date.now(),
      mediaFile: mediaFile || activeNetworkPreviewSource(),
    });
    if (
      Number.isFinite(playbackState.currentTime) &&
      Number.isFinite(video.duration) &&
      video.duration > 0 &&
      Math.abs(video.currentTime - playbackState.currentTime) > 0.5
    ) {
      beginPreviewForwardingSuppression();
      try {
        video.currentTime = clampMediaTime(playbackState.currentTime, video.duration);
      } catch {}
      endPreviewForwardingSuppression();
    }
    if (playbackState.playing && video.paused) {
      void playNetworkPreviewMirror("playback state sync").catch((err) => {
        if (!isPlayInterruptedError(err)) {
          console.error("Failed to keep network capture preview playing:", err);
        }
      });
    } else if (!playbackState.playing && !video.paused) {
      beginPreviewForwardingSuppression();
      try {
        video.pause();
      } finally {
        endPreviewForwardingSuppression();
      }
    }
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
    const syncGeneration = (setSharedRendererState({ playbackStateSyncGeneration: playbackStateSyncGeneration + 1 }), playbackStateSyncGeneration);
    setSharedRendererState({ desiredProjectionPreviewPlayback: "playing" });
    // The first stable state for a newly loaded projection is authoritative.
    // If a source reset put the persistent preview element back at zero, seek
    // it to the projection before starting playback. PID rate correction is
    // intended only for small clock drift and must not be used to replay the
    // omitted portion at high speed.
    if (
      Number.isFinite(playbackState.currentTime) &&
      Number.isFinite(video.currentTime) &&
      Math.abs(video.currentTime - playbackState.currentTime) > 0.25
    ) {
      beginPidSeekSuppression();
      video.playbackRate = 1;
      try {
        video.currentTime = Number.isFinite(video.duration) && video.duration > 0
          ? clampMediaTime(playbackState.currentTime, video.duration)
          : Math.max(0, playbackState.currentTime);
      } catch {}
      resetPIDOnSeek();
    }
    finishProjectionPlaybackStartupSync();
    setSharedRendererState({ masterPauseState: false });
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
    (setSharedRendererState({ playbackStateSyncGeneration: playbackStateSyncGeneration + 1 }), playbackStateSyncGeneration);
    setSharedRendererState({ desiredProjectionPreviewPlayback: "paused" });
    setSharedRendererState({ latestExplicitProjectionPauseState: playbackState });
    finishProjectionPlaybackStartupSync();
    setSharedRendererState({ masterPauseState: true });
    if (video.paused) {
      return;
    }
    await pauseLivePreviewMirrorFromProjection(playbackState);
  }
}

function handlePlayPause(event, arg) {
  setSharedRendererState({ mediaSessionPause: arg });
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

function handleMediaPlayback(isImgFile, sourcePath = mediaFile, cacheBust) {
  if (!video) return;
  if (isNonVideoPresentationItem(mediaFile)) return;
  if (!isImgFile) {
    if (isNetworkStreamSource(sourcePath)) clearVideoPoster(video);
    else void applyVideoPoster(video, sourcePath);
    video.src = pathToMediaUrl(sourcePath, cacheBust);
  } else {
    clearVideoPoster(video);
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
    setSharedRendererState({ img: liveImg });
  }
}

function resetVideoState() {
  if (video !== null) {
    video.pause();
    video.currentTime = 0;
    setSharedRendererState({ targetTime: 0 });
  }
}

async function runPresentationStart(startOperation) {
  if (presentationStartInProgress) return undefined;
  setSharedRendererState({ presentationStartInProgress: true });
  updateDynUI();
  try {
    return await startOperation();
  } finally {
    setSharedRendererState({ presentationStartInProgress: false });
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
      setSharedRendererState({ targetTime: r });
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
  setSharedRendererState({ audioOnlyFile: mediaElementLoadedAudioOnly(mediaEl, mediaFile || mediaEl.src) });

  resolve(mediaEl);
}

function waitForMetadata(mediaEl = video) {
  return waitForMediaMetadata(mediaEl, {
    isLiveStream,
    isImg,
    onResolved: (event, resolve, targetMediaEl) => {
      handleCanPlayThrough(event || {}, resolve, targetMediaEl);
    },
    onRejected: () => {
      setSharedRendererState({ playingMediaAudioOnly: false });
      setSharedRendererState({ audioOnlyFile: false });
    },
  });
}

async function playMedia(e) {
  if (presentationStartInProgress) return;

  if (video) {
    setSharedRendererState({ itc: performance.now() * 0.001 });
    setSharedRendererState({ startTime: video.currentTime });
  }
  setSharedRendererState({ targetTime: startTime });
  if (
    currentMode === MEDIAPLAYER &&
    !audioOnlyFile &&
    isLikelyAudioItem(currentPreviewSourcePath())
  ) {
    setSharedRendererState({ audioOnlyFile: true });
    document.getElementById("customControls")?.style.setProperty("visibility", "");
  }
  if (e === undefined && audioOnlyFile && currentMode === MEDIAPLAYER) {
    e = {};
    e.target = document.getElementById("mediaWindowPlayButton");
  }
  setSharedRendererState({ fileEnded: false });
  let normalizedPathname = mediaElementComparableSource(video);
  let previewSourceMatchesMediaFile = previewElementSourceMatchesMediaFile(
    normalizedPathname,
    mediaFile,
  );

  if (currentMode === MEDIAPLAYER && !previewSourceMatchesMediaFile) {
    saveMediaFile();
    normalizedPathname = mediaElementComparableSource(video);
    previewSourceMatchesMediaFile = previewElementSourceMatchesMediaFile(
      normalizedPathname,
      mediaFile,
    );
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
    setSharedRendererState({ audioOnlyFile: true });
    document.getElementById("customControls").style.visibility = "";
  }

  const mdFile = document.getElementById("mdFile");

  if (video && !previewSourceMatchesMediaFile) {
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
    return runPresentationStart(async () => {
      const presentStartTime = presentationStartTimeForQueueItem(startIdx, startTime);
      setSharedRendererState({ isQueuePlaying: true });
      setSharedRendererState({ currentQueueIndex: startIdx });
      await playCurrentQueueItem({
        preservePreviewSeek: false,
        startTime: presentStartTime,
      });
      if (previewCueIndex === startIdx) clearCueAfterTake(startIdx);
    });
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
      setSharedRendererState({ mediaQueue: [createQueueEntry(mediaFile)] });
      setSharedRendererState({ currentQueueIndex: 0 });
      renderQueue();
      if (video !== null && !isImg(mediaFile)) {
        video.pause();
      }
      saveMediaFile();
      setSharedRendererState({ isQueuePlaying: true });
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
      setSharedRendererState({ isPlaying: false });
      setSharedRendererState({ isQueuePlaying: false });
      setSharedRendererState({ mediaPlaybackEndedPending: false });
      setSharedRendererState({ pendingQueueSwitchIndex: null });
      setSharedRendererState({ pendingQueueSwitchStartTime: 0 });
      await closeBibleLowerThirdOutput();
      setSharedRendererState({ userStopPresentationPending: isActiveMediaWindow() });
      send("close-media-window", 0);
      saveMediaFile();
      if (video) {
        video.currentTime = 0;
        video.pause();
      }
      setSharedRendererState({ isPlaying: false });
      updateDynUI();
      setSharedRendererState({ localTimeStampUpdateIsRunning: false });
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
      setSharedRendererState({ isPlaying: true });
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
        setSharedRendererState({ audioOnlyFile: false });
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
    setSharedRendererState({ mediaPlaybackEndedPending: false });
    setSharedRendererState({ pendingQueueSwitchIndex: null });
    setSharedRendererState({ pendingQueueSwitchStartTime: 0 });
    await closeBibleLowerThirdOutput();
    if (isQueuePlaying) {
      setSharedRendererState({ isQueuePlaying: false });
      // Keep the stopped queue item selected. `queueStartIndexForPresent()`
      // uses this pointer for the next Present click, matching the boundary
      // pause behavior and avoiding an unexpected restart from the top.
      if (currentQueueIndex < 0 || currentQueueIndex >= mediaQueue.length) {
        setSharedRendererState({ currentQueueIndex: -1 });
      }
      renderQueue();
    }
    setSharedRendererState({ startTime: 0 });
    setSharedRendererState({ isPlaying: false });
    if (isActiveMediaWindow()) {
      setSharedRendererState({ userStopPresentationPending: true });
      send("close-media-window", 0);
    }
    setSharedRendererState({ isActiveMediaWindowCache: false });
    if (playingMediaAudioOnly || liveAudio?.paused === false) {
      stopLiveAudioPresentation();
    } else {
      setSharedRendererState({ playingMediaAudioOnly: false });
    }
    if (!audioOnlyFile) setSharedRendererState({ activeLiveStream: true });
    if (video) {
      await video.pause();
      video.currentTime = 0;
    }
    if (audioOnlyFile) {
      send("localMediaState", 0, "stop");
      removeFilenameFromTitlebar();
      setSharedRendererState({ activeLiveStream: false });
      saveMediaFile();
      setSharedRendererState({ audioOnlyFile: false });
    }
    syncPreviewAudioTrackState();
    updateDynUI();
    setSharedRendererState({ localTimeStampUpdateIsRunning: false });
    if (!previewElementSourceMatchesMediaFile(normalizedPathname, mediaFile)) {
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
      setSharedRendererState({ mediaFile: getPathForFile(f0) });
      return;
    }
    if (mediaQueue.length > 0) {
      const qi =
        currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
          ? currentQueueIndex
          : 0;
      setSharedRendererState({ mediaFile: mediaQueue[qi].path });
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

  setSharedRendererState({ mediaFile: currentMode === STREAMPLAYER
      ? document.getElementById("mdFile").value
      : mediaPlayerInputState.filePaths[0] });

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
    setSharedRendererState({ playingMediaAudioOnly: false });
    setSharedRendererState({ audioOnlyFile: false });
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
    setSharedRendererState({ img: document.createElement("img") });
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
      setSharedRendererState({ video: document.getElementById("preview") });
    }
    if (video) {
      if (hasLocalSelection && prePathname !== mediaFile) {
        setSharedRendererState({ prePathname: mediaFile });
        setSharedRendererState({ startTime: 0 });
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
          setSharedRendererState({ startTime: video.currentTime });
          setSharedRendererState({ targetTime: startTime });
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
      setSharedRendererState({ mediaFile: mediaPlayerInputState.filePaths[0] });
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

  setSharedRendererState({ playPauseBtn: null });
  setSharedRendererState({ playPauseIcon: null });
  setSharedRendererState({ timeline: null });
  setSharedRendererState({ currentTimeDisplay: null });
  setSharedRendererState({ durationTimeDisplay: null });
  setSharedRendererState({ repeatButton: null });

  stashLivePreview();
  clearVideoPreviewCueOverlay();
  setSharedRendererState({ previewCueVideo: null });

  document.getElementById("dyneForm").innerHTML = "";
}

function playLocalMedia(event) {
  if (currentMode !== MEDIAPLAYER) {
    return;
  }
  if (event?.target === video && networkPreviewUsesRendererCapture()) {
    syncPreviewAudioTrackState();
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
    setSharedRendererState({ localTimeStampUpdateIsRunning: false });
    syncPreviewAudioTrackState();
    return;
  }

  syncPreviewAudioTrackState();
  setSharedRendererState({ mediaSessionPause: false });
  if (
    !audioOnlyFile &&
    (isLikelyAudioItem(currentPreviewSourcePath()) ||
      (video.readyState && mediaElementLoadedAudioOnly(video, mediaFile || video.src)))
  ) {
    setSharedRendererState({ audioOnlyFile: true });
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
        setSharedRendererState({ currentQueueIndex: queueIndex });
        setSharedRendererState({ isQueuePlaying: true });
      } else if (mediaFile && mediaQueue.length === 0) {
        setSharedRendererState({ mediaQueue: [createQueueEntry(mediaFile)] });
        setSharedRendererState({ currentQueueIndex: 0 });
        setSharedRendererState({ isQueuePlaying: true });
      }
    }
    send("localMediaState", 0, "play");
    addFilenameToTitlebar(removeFileProtocol(decodeURI(video.src)));
    setSharedRendererState({ isPlaying: true });
    setSharedRendererState({ playingMediaAudioOnly: true });
    setSharedRendererState({ isActiveMediaWindowCache: false });
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
      setSharedRendererState({ fileEnded: false });
      setSharedRendererState({ audioOnlyFile: true });
      if (document.getElementById("volumeControl")) {
        document.getElementById("customControls").style.visibility = "";
      }
      setSharedRendererState({ playingMediaAudioOnly: true });
      updateTimestamp();
      return;
    }
  }
  if (isImg(video.src)) {
    setSharedRendererState({ audioOnlyFile: false });
    setSharedRendererState({ playingMediaAudioOnly: false });
    return;
  }
  if (video.src === "") {
    event.preventDefault();
    return;
  }
  setSharedRendererState({ masterPauseState: false });
  updateTimestamp();
  if (audioOnlyFile) {
    if (document.getElementById("volumeControl")) {
      video.volume = document.getElementById("volumeControl").value;
    }
    setSharedRendererState({ playingMediaAudioOnly: true });
    return;
  }
}

function loadLocalMediaHandler(event) {
  if (event?.target === video && networkPreviewUsesRendererCapture()) {
    return;
  }
  if (pidController) {
    pidController.reset();
  }
  if (video.src === "") {
    event.preventDefault();
    return;
  }
}

function loadedmetadataHandler(e) {
  if (e?.target === video && networkPreviewUsesRendererCapture()) {
    syncPreviewAudioTrackState();
    refreshNetworkPreviewTransportControls();
    return;
  }
  if (video.src === "" || isImg(video.src)) {
    return;
  }
  if (shouldSuppressPreviewForwarding()) {
    syncPreviewAudioTrackState();
    updatePreviewCueUI();
    return;
  }
  setSharedRendererState({ audioOnlyFile: mediaElementLoadedAudioOnly(video, mediaFile || video.src) });
  syncPreviewAudioTrackState();
}

function seekLocalMedia(e) {
  if (e?.target === video && networkPreviewUsesRendererCapture()) {
    return;
  }
  if (pidSeeking) {
    // Critical: a PID-driven seek MUST NOT be echoed back to the
    // projection. Writing video.currentTime fires both `seeking` and
    // `seeked` (and sometimes extra settle events) — we do NOT reset
    // pidSeeking here, because the very next event would then see
    // pidSeeking=false and forward a timeGoto-message to the
    // projection, causing the projection to seek, which the next
    // time message reports back, which the PID corrects again, ad
    // infinitum. The visible symptom was the projection pausing /
    // glitching every few seconds, worst when the hidden preview drifts
    // more and PID corrections fire more often. beginPidSeekSuppression's timer is the single source of
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
    tracePlayback(
      "seekLocalMedia SUPPRESSED",
      "suppress=" + suppressPreviewForwarding,
      "depth=" + previewForwardingSuppressionDepth,
      "startupPending=" + projectionPlaybackStartupPending,
      "cuePrep=" + isPreparingSeparateCue(),
    );
    return;
  }
  tracePlayback("seekLocalMedia FORWARD timeGoto", "t=" + e.target.currentTime);
  syncTrackedPreviewStartTime(e.target, { force: true });
  if (e.target.isConnected) {
    send("timeGoto-message", {
      currentTime: e.target.currentTime,
      timestamp: Date.now(),
    });
    invoke("get-media-current-time").then((r) => {
      setSharedRendererState({ targetTime: r });
    });
  }
}

function seekingLocalMedia(e) {
  if (e?.target === video && networkPreviewUsesRendererCapture()) {
    return;
  }
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
      setSharedRendererState({ targetTime: r });
    });
  }
}

function endLocalMedia(event) {
  if (event?.target === video && networkPreviewUsesRendererCapture()) {
    return;
  }
  setMediaCountdownText("");
  tracePlayback(
    "endLocalMedia (preview #preview ended)",
    "src=" + (event?.target?.src || video?.src || ""),
    "live=" + mediaFile,
    "activeWindow=" + isActiveMediaWindow(),
    "audioOnly=" + playingMediaAudioOnly,
    "epoch=" + liveMediaWindowEpoch,
  );

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
    const endedPreviewSource = event?.target?.src || video.src || "";
    if (
      endedPreviewSource &&
      !mediaPathMatchesCurrentLiveMedia(endedPreviewSource)
    ) {
      return;
    }
    if (loopEnabledForLiveMedia()) {
      setSharedRendererState({ mediaPlaybackEndedPending: false });
      syncMediaLoopState();
      return;
    }
    // Mark this as a natural boundary in case the projection window closes
    // before its IPC arrives, but do not drive the transition from the preview.
    // On slower machines the preview can reach "ended" first; if it slipstreams
    // here, it races the projection window and can leave preview/scrubber state
    // one item behind the audience output.
    setSharedRendererState({ mediaPlaybackEndedPending: true });
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

  setSharedRendererState({ isPlaying: false });
  updateDynUI();
  setSharedRendererState({ audioOnlyFile: false });
  if (document.getElementById("mediaWindowPlayButton")) {
    updateDynUI();
  }
  if (playingMediaAudioOnly) {
    setSharedRendererState({ playingMediaAudioOnly: false });

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
    setSharedRendererState({ masterPauseState: false });
    saveMediaFile();
  }
  setSharedRendererState({ targetTime: 0 });
  setSharedRendererState({ fileEnded: true });
  send("localMediaState", 0, "stop");
  // In queue+media-window mode the media-playback-ended IPC handler decides
  // whether to slipstream or close the window. Sending close-media-window here
  // would race and destroy the window before slipstream gets a chance.
  if (!(isQueuePlaying && isActiveMediaWindow())) {
    send("close-media-window", 0);
  }
  removeFilenameFromTitlebar();
  video?.pause();
  setSharedRendererState({ masterPauseState: false });
  resetPIDOnSeek();
  setSharedRendererState({ localTimeStampUpdateIsRunning: false });

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
  if (event?.target === video && networkPreviewUsesRendererCapture()) {
    syncPreviewAudioTrackState();
    return;
  }
  if (shouldSuppressPreviewForwarding()) {
    setSharedRendererState({ localTimeStampUpdateIsRunning: false });
    updatePreviewCueUI();
    return;
  }
  if (mediaSessionPause) {
    invoke("get-media-current-time").then((r) => {
      setSharedRendererState({ targetTime: r });
    });
    return;
  }
  if (fileEnded) {
    setSharedRendererState({ fileEnded: false });
    return;
  }
  if (audioOnlyFile && !isActiveMediaWindow()) {
    // When liveAudio is carrying the live presentation, a pause on the preview
    // <video> element (e.g. video.pause() called at the end of
    // playAudioOnlyLocally, or from a preview-load) must not reset the
    // presentation's isPlaying flag — liveAudio is still running.
    if (liveAudio?.paused === false || liveAudioQueueIndex >= 0) {
      setSharedRendererState({ localTimeStampUpdateIsRunning: false });
      syncPreviewAudioTrackState();
      return;
    }
    setSharedRendererState({ isPlaying: false });
    setSharedRendererState({ localTimeStampUpdateIsRunning: false });
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
        setSharedRendererState({ isPlaying: true });
        updateDynUI();
      })
      .catch((error) => {
        setSharedRendererState({ playingMediaAudioOnly: false });
      });

    setSharedRendererState({ masterPauseState: false });
    return;
  }
  if (event.target.clientHeight === 0) {
    // Hidden preview hosts report `clientHeight` as 0. Without this guard,
    // clicking Stop while an audio-only file is playing would re-trigger
    // playback immediately because this branch treated "hidden" as
    // "incidentally detached, resume it".
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
      setSharedRendererState({ masterPauseState: true });
    }
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
  return /(?:^rtsp:|^rtmp:|\.m3u8(?:[?#]|$)|\.mpd(?:[?#]|$)|youtube\.com|videoplayback|youtu\.be)/i.test(
    String(mediaFile),
  );
}

async function endLiveAudioPresentation() {
  tracePlayback(
    "endLiveAudioPresentation (liveAudio ended)",
    "handling=" + isHandlingLiveEnded,
    "idx=" + currentQueueIndex,
    "audioIdx=" + liveAudioQueueIndex,
    "loop=" + loopEnabledForLiveMedia(),
  );
  if (isHandlingLiveEnded) return;
  setSharedRendererState({ isHandlingLiveEnded: true });
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

    setSharedRendererState({ isPlaying: false });
    setSharedRendererState({ audioOnlyFile: false });
    setSharedRendererState({ playingMediaAudioOnly: false });
    setSharedRendererState({ liveAudioQueueIndex: -1 });
    updateDynUI();
    send("localMediaState", 0, "stop");
    removeFilenameFromTitlebar();
    setSharedRendererState({ masterPauseState: false });
    setSharedRendererState({ localTimeStampUpdateIsRunning: false });

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
    setSharedRendererState({ isHandlingLiveEnded: false });
  }
}

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
    setSharedRendererState({ activePreviewResolvedMediaFile: source });
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

  setSharedRendererState({ audioOnlyFile: true });
  setSharedRendererState({ playingMediaAudioOnly: true });
  setSharedRendererState({ isPlaying: true });
  setSharedRendererState({ isActiveMediaWindowCache: false });
  setSharedRendererState({ liveAudioQueueIndex: currentQueueIndex });
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
      setSharedRendererState({ liveAudioQueueIndex: -1 });
      setSharedRendererState({ playingMediaAudioOnly: false });
      setSharedRendererState({ isPlaying: false });
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
    setSharedRendererState({ video: document.getElementById("preview") });
  }
  if (seekOnly) {
    setSharedRendererState({ itc: performance.now() * 0.001 });
  }
  let isQueuePlaybackContext =
    !transientText &&
    isQueuePlaying &&
    currentQueueIndex >= 0 &&
    currentQueueIndex < mediaQueue.length;
  const presentationQueueItem = isQueuePlaybackContext
    ? mediaQueue[currentQueueIndex]
    : null;
  const ts = await invoke("get-system-time");
  let birth =
    ts.systemTime +
    (Date.now() - ts.ipcTimestamp) * 0.001 +
    (performance.now() * 0.001 - itc) +
    "";
  setSharedRendererState({ mediaFile: textItem
    ? textItem.path
    : isQueuePlaybackContext
    ? mediaQueue[currentQueueIndex].path
    : currentMode === STREAMPLAYER
      ? document.getElementById("mdFile").value
      : mediaPlayerInputState.filePaths[0] });
  let projectionMediaFile = mediaFile;
  if (!textItem && isQueuePlaybackContext) {
    if (!isQueueItemBible(presentationQueueItem) && !isQueueItemSong(presentationQueueItem)) {
      projectionMediaFile = await resolveQueueItemMediaPath(presentationQueueItem);
    }
  }
  var liveStreamMode = textItem ? false : isLiveStream(mediaFile);
  const previewResolvedLiveEdge = networkPreviewMirrorLiveEdgeMatches(
    mediaFile,
    projectionMediaFile,
    presentationQueueItem?.path,
  );
  const liveStreamAtLiveEdge = presentationQueueItem
    ? queueItemIsLiveEdgeStream(presentationQueueItem) || previewResolvedLiveEdge
    : liveStreamMode || previewResolvedLiveEdge;
  if (previewResolvedLiveEdge) {
    normalizeLiveEdgeQueueItemsForSources(
      mediaFile,
      projectionMediaFile,
      presentationQueueItem?.path,
      presentationQueueItem?.originalPath,
    );
  }
  const displaySelectEl =
    currentMode === STREAMPLAYER
      ? document.getElementById("dspSelctStreams")
      : document.getElementById("dspSelct");
  const selectedDisplay = displaySelectEl?.value || null;
  setSharedRendererState({ activeLiveStream: liveStreamAtLiveEdge });

  if (liveStreamMode === true) {
    if (currentMode === STREAMPLAYER) {
      isQueuePlaybackContext = false;
      setSharedRendererState({ isQueuePlaying: false });
      setSharedRendererState({ currentQueueIndex: -1 });
      renderQueue();
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
    setSharedRendererState({ playingMediaAudioOnly: false });
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

  if (!liveStreamAtLiveEdge) {
    setSharedRendererState({ startTime: hasExplicitStartTime
      ? validMediaStartTime(options.startTime)
      : validMediaStartTime(video?.currentTime) });
  } else {
    setSharedRendererState({ startTime: 0 });
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
        liveStreamMode && !liveStreamAtLiveEdge ? "__seekable-network=true" : "",
        isImgFile ? "__isImg" : "",
        isPptxFile ? "__isPptx" : "",
        isTextItem ? "__isText" : "",
        isPptxFile ? `__pptxSlide=${pptxStartSlide}` : "",
        `__autoplay=${autoPlayEnabled}`,
        seekOnly ? "__seek-only" : "",
        playbackTraceEnabled ? "__debug-playback" : "",
        birth,
      ],
      preload: `${__dirname}/media_preload.min.js`,
      devTools: false,
    },
  };

  if (!selectedDisplay) {
    showGnomeToast("Choose an audience output display");
    setSharedRendererState({ isActiveMediaWindowCache: false });
    return false;
  }

  const startupSyncNeeded =
    autoPlayEnabled && !liveStreamAtLiveEdge && !isTextItem && !isImgFile && !isPptxFile;
  setSharedRendererState({ isActiveMediaWindowCache: true });
  setSharedRendererState({ activeResolvedMediaFile: projectionMediaFile });
  setSharedRendererState({ activePreviewResolvedMediaFile: projectionMediaFile });
  if (startupSyncNeeded) {
    beginProjectionPlaybackStartupSync();
  }
  try {
    const windowId = await invoke("create-media-window", windowOptions, selectedDisplay);
    if (!windowId) {
      setSharedRendererState({ isActiveMediaWindowCache: false });
      if (startupSyncNeeded) finishProjectionPlaybackStartupSync();
      return false;
    }
    // A new clip is now live in a freshly created window: open a new
    // end-of-clip epoch so its natural end is claimed exactly once.
    beginLiveMediaWindowEpoch();
    queueBiblePreviewMediaWindowSizeRefresh();
  } catch (err) {
    setSharedRendererState({ isActiveMediaWindowCache: false });
    setSharedRendererState({ activeMediaWindowContentType: null });
    if (startupSyncNeeded) finishProjectionPlaybackStartupSync();
    throw err;
  }
  setSharedRendererState({ activeMediaWindowContentType: isTextItem
    ? options?.songItem || isQueueItemSong(textItem) || isQueueItemSong(mediaQueue[currentQueueIndex])
      ? "song"
      : "bible"
    : isPptxFile
      ? "pptx"
      : isImgFile
      ? "image"
      : "video" });
  send("set-output-content-status", activeMediaWindowContentType);
  if (networkPreviewUsesRendererCapture()) {
    resetNetworkPreviewTransportState(mediaFile || projectionMediaFile);
  }
  refreshPreviewControlsForCurrentMedia();
  setSharedRendererState({ bibleShowNowModeActive: Boolean(isTextItem && transientText && activeMediaWindowContentType === "bible") });
  if (isTextItem && transientText && activeMediaWindowContentType === "song") {
    markSongShowNowPresentation(textItem || mediaQueue[currentQueueIndex]);
  } else {
    clearSongShowNowPresentation();
  }
  updateClearLiveTextButtonState();
  updateOutputHoldButtonStates();
  if (isTextItem) {
    window.setTimeout(() => {
      void (async () => {
        if (
          Number.isFinite(options?.presentationRevision) &&
          !scripturePresentation.isCurrentRevision(options.presentationRevision)
        ) {
          return;
        }
        const queueItem = textItem || mediaQueue[currentQueueIndex];
        if (isQueueItemSong(queueItem)) {
          await sendSongTextToOutput(queueItem);
        } else {
          const entry = await resolvedBibleEntryForItem(queueItem);
          await sendBibleTextToOutput(entry, options?.presentationRevision ?? null);
        }
        syncAudienceOutputHoldAfterPresentationStart();
      })().catch(console.error);
    }, 150);
    syncStreamRendererPreviewCapture();
    return true;
  }
  syncAudienceOutputHoldAfterPresentationStart();
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
    if (networkPreviewUsesRendererCapture()) {
      setNetworkPreviewElementCaptureMuted();
    } else {
      video.muted = false;
    }
  }
  if (autoPlayEnabled) {
    beginPidSeekSuppression();
    if (activeLiveStream || video) {
      unPauseMedia();
    }
    if (isQueuePlaybackContext || currentMode !== STREAMPLAYER) {
      if (video !== null && !isImgFile && !isPptxFile) {
        beginPidSeekSuppression();
        if (networkPreviewUsesRendererCapture()) {
          await playNetworkPreviewMirror("media-window network mirror autoplay");
          syncNetworkPreviewMirrorCapture();
        } else {
          await playLivePreviewMirrorSafely("media-window autoplay");
        }
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
  void refreshNetworkPreviewTransportState();
  refreshPreviewControlsForCurrentMedia();
  return true;
}

export {
  MEDIA_COUNTDOWN_CHAR_BY_CODE,
  MEDIA_COUNTDOWN_DIGIT_COUNT,
  beginPidSeekSuppression,
  cleanRefs,
  clearMediaCountdownDigits,
  countdownDigitLastCode,
  countdownDigitNodes,
  countdownDigitParent,
  countdownHasDisplayedDigits,
  createMediaWindow,
  endLiveAudioPresentation,
  endLocalMedia,
  ensureLiveAudioElement,
  ensureMediaCountdownDigitNodes,
  ensurePreviewAudioElement,
  getMediaCountdownElement,
  handleCanPlayThrough,
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
  mediaCountdownElement,
  pauseLocalMedia,
  pauseMedia,
  pidSeeking,
  pidSeekingResetTimer,
  playAudioOnlyLocally,
  playLocalMedia,
  playMedia,
  previewMediaControlsLiveProjection,
  refreshPreviewControlsForCurrentMedia,
  resetPIDOnSeek,
  resetVideoState,
  restoreMediaFile,
  runPresentationStart,
  saveMediaFile,
  seekLocalMedia,
  seekingLocalMedia,
  setMediaCountdownFromCodes,
  setMediaCountdownOverlayVisible,
  setMediaCountdownText,
  stopLiveAudioPresentation,
  syncMediaCountdownOverlayState,
  syncPlayPauseIconToControlMedia,
  syncPreviewAudioCueAudibility,
  syncPreviewAudioTrackState,
  syncPreviewMediaAfterPresentationStateChange,
  timelineSync,
  toggleLocalAudioOnlyPlaybackFromControls,
  unPauseMedia,
  vlCtl,
  waitForMediaElementBuffer,
  waitForMediaElementFrame,
  waitForMediaElementSource,
  waitForMetadata,
};
