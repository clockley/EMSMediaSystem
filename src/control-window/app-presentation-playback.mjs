/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/*
 * Preview cue loading and the take-live / advance / slipstream playback state machine.
 */

import {
  MEDIAPLAYER,
  PREVIEW_SURFACE_CUE_IMAGE,
  PREVIEW_SURFACE_CUE_VIDEO,
  SCRIPTURE_LOOK_FULLSCREEN,
  activeLiveStream,
  activeMediaWindowContentType,
  activePresentationOwnsPreviewAudio,
  activePreviewResolvedMediaFile,
  activeResolvedMediaFile,
  appliedPresentationTheme,
  applyVideoPoster,
  attachNetworkMediaSourceToElement,
  attachNetworkPreviewMirrorSource,
  audienceTextMessageForSend,
  audioOnlyFile,
  beginNetworkPreviewStatus,
  beginPreviewForwardingSuppression,
  beginPreviewTransportLoad,
  beginProjectionPlaybackStartupSync,
  beginScriptureTake,
  bibleShowNowModeActive,
  buildBibleTextMessage,
  classifyPresentationType,
  classifyQueueMediaType,
  cleanBibleVerseTextForDisplay,
  clearLowerThirdForUnsupportedMediaSource,
  clearSongShowNowPresentation,
  clearUnsupportedQueueItemCueStartTime,
  clearVideoPoster,
  closeBibleLowerThirdOutput,
  commitActiveCueVolume,
  confirmScriptureTake,
  consumePendingCueVolume,
  consumedMediaWindowEndEpoch,
  createMediaWindow,
  cueVolumeDirty,
  currentImplicitNextItem,
  currentImplicitPreviousItem,
  currentLiveQueueItem,
  currentMode,
  currentQueueIndex,
  currentTimeDisplay,
  disableNativeVideoControls,
  durationTimeDisplay,
  endPreviewForwardingSuppression,
  ensurePendingMediaUpdateApproved,
  ensurePreviewAudioElement,
  fileEnded,
  finalizeQueueClearAfterAudienceClose,
  finishPreviewTransportLoad,
  finishProjectionPlaybackStartupSync,
  getHostnameOrBasename,
  getLivePreviewDisplayVolume,
  handleImageDisplay,
  handleMediaPlayback,
  hasAudienceOutputSelected,
  hasLowerThirdOutputSelected,
  hideBiblePreview,
  hideBibleWorkspace,
  hideNetworkPreviewStatus,
  hidePptxPreviewIfNeeded,
  hideSlidesWorkspace,
  hideSongsWorkspace,
  installNetworkPreviewStatusHandlers,
  invoke,
  isActiveMediaWindow,
  isActiveMediaWindowCache,
  isAdvancingQueue,
  isAudienceLogoHoldActive,
  isAudioOnlyQueuePresentationActive,
  isBiblePresentationActive,
  isCurrentPreviewLoad,
  isImg,
  isLiveStream,
  isLocalAppWindowPresentationActive,
  isNetworkStreamSource,
  isPlaying,
  isQueueItemAudio,
  isQueueItemBible,
  isQueueItemDeck,
  isQueueItemImage,
  isQueueItemPptx,
  isQueueItemSong,
  isQueueItemVideo,
  isQueuePlaying,
  isQueuePresentationActive,
  isScheduleItemCurrentlyPlayable,
  itc,
  liveMediaWindowEpoch,
  loadBibleEntryIntoEditor,
  loadDeckQueueItemIntoWorkspace,
  loadPptxPreview,
  loadSongItemIntoWorkspace,
  localTimeStampUpdateIsRunning,
  logoHoldOnlyPresentation,
  logoHoldStagedPlayback,
  loopEnabledForLiveMedia,
  loopEnabledForQueueItem,
  manualBoundaryPauseIndex,
  masterPauseState,
  mediaElementLoadedAudioOnly,
  mediaFile,
  mediaPathMatchesCurrentLiveMedia,
  mediaPlaybackEndedPending,
  mediaPlayerInputState,
  mediaQueue,
  networkPreviewCueDashManifestObjectUrl,
  networkPreviewCueDashPlayer,
  networkPreviewCueHlsInstance,
  networkPreviewCueLiveEdge,
  networkPreviewCueSource,
  networkPreviewMirrorLiveEdge,
  networkPreviewMirrorLiveEdgeMatches,
  networkPreviewMirrorSource,
  networkPreviewSourceHidesScrubber,
  nextPlayableQueueIndexAfter,
  nextPreviewLoadToken,
  nextQueueBoundaryIndex,
  normalizeLiveEdgeQueueItemsForSources,
  normalizedQueueItemCueStartTime,
  paintCountdownFor,
  paintTransportTimeDisplay,
  pathToMediaUrl,
  pauseQueuePresentationAtBoundary,
  pendingCueVolume,
  pendingQueueClearPostClose,
  pendingQueueSwitchIndex,
  pendingQueueSwitchStartTime,
  playAudioOnlyLocally,
  playLivePreviewMirrorSafely,
  playVideoSafely,
  playbackStateSyncGeneration,
  playingMediaAudioOnly,
  pptxRegex,
  pptxStartSlideForItem,
  prepareQueueItemUnderLogoHold,
  previewAudio,
  previewAudioCueIndex,
  previewCueIndex,
  previewCueVideo,
  previewCueVideoIndex,
  previewLoadToken,
  previewShowsSameClipAsPath,
  primeNetworkPreviewElement,
  queueIndexInRange,
  queueIndexIsCurrentLivePresentation,
  queueItemCueStartTime,
  queueItemIsLiveEdgeStream,
  queueItemMediaCacheBust,
  queueItemNeedsPendingUpdateApproval,
  queueItemSupportsCueStartTime,
  queueSlipstreamTransitionInProgress,
  refreshPreviewControlsForCurrentMedia,
  removeFilenameFromTitlebar,
  renderQueue,
  resetAudienceOutputHold,
  resetCountdownSync,
  resetNetworkPreviewStatus,
  resetVideoState,
  resolveQueueItemMediaPath,
  resolveQueuePresentationVideo,
  resolveThemeForTarget,
  resolvedBibleEntryForItem,
  resolvedSongPresentation,
  restoreCountdownForLiveMedia,
  restoreLivePreviewMirrorMuteState,
  restoreNonPptxPreviewSurface,
  restorePreviewToLiveOutput,
  restoreStagedPreviewPlayback,
  restoreWorkspacePreviewForQueueItem,
  saveMediaFile,
  scripturePresentation,
  seekMedia,
  selectNavigationForQueueItem,
  selectedBiblePreviewOutputSize,
  send,
  sendBibleTextToOutput,
  sendSongTextToOutput,
  setCueStartTime,
  setMediaCountdownOverlayVisible,
  setMediaCountdownText,
  setNetworkPreviewCueAudio,
  setPreviewStackSurface,
  setSelectedQueueAnchor,
  setSharedRendererState,
  setupCustomMediaControls,
  shouldAdvanceAfterCurrentItemEnds,
  shouldAutoTransitionToIndex,
  showBibleWorkspace,
  showGnomeToast,
  showNetworkPreviewError,
  showSlidesWorkspace,
  showSongsWorkspace,
  slideTransitionPayloadForQueueItem,
  songItemForAudienceResolution,
  stagedMediaUrlForItem,
  startTime,
  stopLiveAudioPresentation,
  stopNetworkPreviewRtcCapture,
  stopStreamRendererPreviewCapture,
  syncAudienceOutputHoldAfterPresentationStart,
  syncGtkSliderToCueState,
  syncMediaLoopState,
  syncPreviewAudioCueAudibility,
  syncPreviewAudioTrackState,
  syncPreviewMediaAfterPresentationStateChange,
  syncPreviewStackSurface,
  syncStageContentFromQueueItem,
  targetTime,
  teardownNetworkPreviewCueStreamingPlayers,
  teardownNetworkPreviewStreamingPlayers,
  timeline,
  tracePlayback,
  updateDynUI,
  updateLowerThirdForSupportedScheduleItem,
  updateNetworkPreviewTransportState,
  updateQueueFileLabel,
  userStopPresentationPending,
  validMediaStartTime,
  video,
  waitForCueVideoMetadata,
  waitForLoadedMetadata,
  waitForMetadata,
  waitForScriptureFonts,
  waitForTextFonts,
} from "./app-renderer.mjs";
import { hideMediaLibraryWorkspaceForSchedulePreview } from "./app-media-library-workspace.mjs";
import { activateAudienceSlipstream } from "../shared/audience-playback-activation.mjs";
import { audiencePlaybackCoordinator } from "../shared/playback-transition-coordinator.mjs";

function isAudioPreviewCueActive() {
  const cue = currentPreviewCue();
  return Boolean(
    previewAudio &&
      cue &&
      isQueueItemAudio(cue.item) &&
      previewAudioCueIndex === previewCueIndex,
  );
}

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

/**
 * Return the cue's current index only while this asynchronous load still owns
 * the same queue item. Queue indexes are allowed to change while paths,
 * metadata, Scripture, or song documents are resolving.
 */
function previewCueIndexForItem(item, loadToken) {
  if (!isCurrentPreviewLoad(loadToken)) return -1;
  if (previewCueIndex < 0 || previewCueIndex >= mediaQueue.length) return -1;
  return mediaQueue[previewCueIndex] === item ? previewCueIndex : -1;
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
  return getLivePreviewDisplayVolume();
}

function clearPreviewCue() {
  nextPreviewLoadToken();
  commitActiveCueVolume();
  stopPreviewAudioCue();
  clearVideoPreviewCueOverlay();
  setSharedRendererState({ previewCueIndex: -1 });
  setSharedRendererState({ pendingCueVolume: null });
  setSharedRendererState({ cueVolumeDirty: false });
  syncGtkSliderToCueState();
  if (isBiblePresentationActive()) showBibleWorkspace();
  else selectNavigationForQueueItem(currentLiveQueueItem());
  restoreCountdownForLiveMedia();
  syncMediaLoopState({ notify: false });
  updatePreviewCueUI();
  renderQueue();
  refreshPreviewControlsForCurrentMedia();
}

function clearCueAfterTake(index) {
  if (previewCueIndex === index) {
    nextPreviewLoadToken();
    stopPreviewAudioCue();
    clearVideoPreviewCueOverlay();
    setSharedRendererState({ previewCueIndex: -1 });
    setSharedRendererState({ pendingCueVolume: null });
    setSharedRendererState({ cueVolumeDirty: false });
    syncGtkSliderToCueState();
    if (isBiblePresentationActive()) showBibleWorkspace();
    else selectNavigationForQueueItem(mediaQueue[index]);
    restoreCountdownForLiveMedia();
  }
  syncMediaLoopState({ notify: false });
  updatePreviewCueUI();
  renderQueue();
  refreshPreviewControlsForCurrentMedia();
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
  setSharedRendererState({ previewAudioCueIndex: -1 });
}

function ensurePreviewCueVideoElement() {
  if (previewCueVideo && previewCueVideo.isConnected) return previewCueVideo;
  setSharedRendererState({ previewCueVideo: document.getElementById("previewCue") });
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

function setPreviewCueVideoLocalAudio(el = previewCueVideo) {
  if (!el) return;
  const vol = Math.max(
    0,
    Math.min(
      1,
      Number.isFinite(pendingCueVolume)
        ? pendingCueVolume
        : getPreviewCueDisplayVolume() ?? 1,
    ),
  );
  el.muted = vol === 0;
  el.defaultMuted = false;
  el.volume = vol;
  el.playsInline = true;
  disableNativeVideoControls(el);
}

async function loadVideoQueueItemIntoPreviewCueOverlay(index, item, startTime, loadToken) {
  const token = Number.isFinite(loadToken) ? loadToken : nextPreviewLoadToken();
  beginPreviewTransportLoad(token);
  try {
    const currentCueIndex = () => previewCueIndexForItem(item, token);
    const syncCueIndex = () => {
      const resolvedIndex = currentCueIndex();
      if (resolvedIndex >= 0 && previewCueVideoIndex !== resolvedIndex) {
        setSharedRendererState({ previewCueVideoIndex: resolvedIndex });
      }
      return resolvedIndex;
    };
    const abandonOwnedLoad = () => {
      if (isCurrentPreviewLoad(token)) clearVideoPreviewCueOverlay();
    };

    const el = ensurePreviewCueVideoElement();
    if (!el || syncCueIndex() < 0) return;
    hidePptxPreviewIfNeeded({ restoreVideoPreview: true });

    // When an image is the current live output, img#preview sits after
    // #previewCue in the DOM and paints over it. Hide it so the operator
    // can see the video cue overlay. Restored in clearVideoPreviewCueOverlay.
    const liveImg = document.querySelector("img#preview");
    if (liveImg) liveImg.style.display = "none";

    const resolvedPath = await resolveQueueItemMediaPath(item);
    if (syncCueIndex() < 0) {
      abandonOwnedLoad();
      return;
    }
    const itemIsNetworkVideo =
      isNetworkStreamSource(item?.path) || isNetworkStreamSource(resolvedPath);

    try {
      el.pause();
    } catch {
      /* ignore */
    }
    teardownNetworkPreviewCueStreamingPlayers();
    if (itemIsNetworkVideo) setNetworkPreviewCueAudio(el);
    else setPreviewCueVideoLocalAudio(el);
    el.loop = loopEnabledForQueueItem(item);
    el.preload = "metadata";
    el.removeAttribute("src");
    clearVideoPoster(el);
    el.load();
    let networkPreviewLoadStatusToken = 0;
    if (itemIsNetworkVideo) {
      setSharedRendererState({ networkPreviewCueSource: item?.path || resolvedPath });
      networkPreviewLoadStatusToken = beginNetworkPreviewStatus("Connecting to stream");
      try {
        const resources = await attachNetworkMediaSourceToElement(el, networkPreviewCueSource, {
          isCurrent: () => currentCueIndex() >= 0,
        });
        if (resources.cancelled) return;
        setSharedRendererState({ networkPreviewCueHlsInstance: resources.hlsInstance });
        setSharedRendererState({ networkPreviewCueDashPlayer: resources.dashPlayer });
        setSharedRendererState({ networkPreviewCueDashManifestObjectUrl: resources.dashManifestObjectUrl });
        setSharedRendererState({ networkPreviewCueLiveEdge: resources.liveEdge || networkPreviewSourceHidesScrubber(networkPreviewCueSource) });
        installNetworkPreviewStatusHandlers(el, resources, networkPreviewLoadStatusToken);
      } catch (err) {
        showNetworkPreviewError("The stream could not be loaded.", networkPreviewLoadStatusToken);
        throw err;
      }
    } else {
      resetNetworkPreviewStatus();
      const cueUrl = pathToMediaUrl(resolvedPath, queueItemMediaCacheBust(item));
      void applyVideoPoster(el, resolvedPath);
      el.src = cueUrl;
      el.load();
    }
    el.hidden = false;
    setPreviewStackSurface(PREVIEW_SURFACE_CUE_VIDEO);
    if (itemIsNetworkVideo) setNetworkPreviewCueAudio(el);
    else setPreviewCueVideoLocalAudio(el);

    await waitForCueVideoMetadata(el, itemIsNetworkVideo);
    if (syncCueIndex() < 0) {
      abandonOwnedLoad();
      return;
    }

    const actualStart = await seekMedia(el, startTime);
    if (syncCueIndex() < 0) {
      abandonOwnedLoad();
      return;
    }

    if (itemIsNetworkVideo) {
      await primeNetworkPreviewElement(el, setNetworkPreviewCueAudio, {
        isCurrent: () => currentCueIndex() >= 0,
      });
      hideNetworkPreviewStatus(networkPreviewLoadStatusToken);
      if (syncCueIndex() < 0) {
        abandonOwnedLoad();
        return;
      }
    }

    const committedIndex = syncCueIndex();
    if (committedIndex < 0) {
      abandonOwnedLoad();
      return;
    }
    setCueStartTime(committedIndex, actualStart);
    if (Number.isFinite(el.duration) && el.duration > 0) {
      mediaQueue[committedIndex].duration = el.duration;
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
  } finally {
    finishPreviewTransportLoad(token);
  }
}

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

async function restorePreviewCueAfterPresentationStopped() {
  const cue = currentPreviewCue();
  if (!cue || currentMode !== MEDIAPLAYER) return false;
  const token = nextPreviewLoadToken();
  const currentCueIndex = () => previewCueIndexForItem(cue.item, token);

  setSharedRendererState({ mediaFile: cue.item.path });
  mediaPlayerInputState.filePaths = [mediaFile];
  updateQueueFileLabel(cue.item.name);

  if (
    await restoreWorkspacePreviewForQueueItem(cue.item, {
      preserveCue: true,
      previewLoadToken: token,
      startTime: cue.startTime,
    })
  ) {
    if (currentCueIndex() < 0) return true;
    syncPreviewMediaAfterPresentationStateChange();
    return true;
  }
  if (currentCueIndex() < 0) return true;

  if (isQueueItemPptx(cue.item)) {
    await loadPptxPreview(cue.item.path, {
      startSlide: pptxStartSlideForItem(cue.item),
    });
    if (currentCueIndex() < 0) return true;
  } else if (isQueueItemBible(cue.item)) {
    stopPreviewAudioCue();
    clearVideoPreviewCueOverlay();
    setMediaCountdownOverlayVisible(false);
    setMediaCountdownText("");
    const cueBibleEntry = await resolvedBibleEntryForItem(cue.item);
    if (currentCueIndex() < 0) return true;
    cue.item.bible = { ...cueBibleEntry };
    const loaded = await loadBibleEntryIntoEditor(cueBibleEntry, {
      previewLoadToken: token,
    });
    if (!loaded || currentCueIndex() < 0) return true;
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
  } else if (isQueueItemAudio(cue.item)) {
    setMediaCountdownOverlayVisible(true);
    setMediaCountdownText("");
    if (!isAudioPreviewCueActive()) {
      await loadAudioQueueItemIntoPreviewCue(
        currentCueIndex(),
        cue.item,
        cue.startTime,
        token,
      );
      if (currentCueIndex() < 0) return true;
    }
  } else if (isQueueItemImage(cue.item)) {
    restoreNonPptxPreviewSurface({ isImage: true });
    clearVideoPreviewCueOverlay();
    stopPreviewAudioCue();
    const cueEl = ensurePreviewCueVideoElement();
    if (cueEl) {
      const posterUrl = await stagedMediaUrlForItem(cue.item);
      if (currentCueIndex() < 0) return true;
      cueEl.poster = posterUrl;
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
      await loadVideoQueueItemIntoPreviewCueOverlay(
        currentCueIndex(),
        cue.item,
        cue.startTime,
        token,
      );
      if (currentCueIndex() < 0) return true;
    }
  }

  if (currentCueIndex() < 0) return true;
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
  setSharedRendererState({ previewAudioCueIndex: index });

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
  let committedIndex = previewCueIndexForItem(item, token);
  if (committedIndex < 0) return;
  if (previewAudioCueIndex !== committedIndex) {
    setSharedRendererState({ previewAudioCueIndex: committedIndex });
  }
  audio.src = audioUrl;

  await waitForLoadedMetadata(audio);
  committedIndex = previewCueIndexForItem(item, token);
  if (committedIndex < 0) return;
  if (previewAudioCueIndex !== committedIndex) {
    setSharedRendererState({ previewAudioCueIndex: committedIndex });
  }

  const duration = Number.isFinite(audio.duration) && audio.duration > 0
    ? audio.duration
    : item.duration || 0;
  const actualStart = await seekMedia(audio, startTime);
  committedIndex = previewCueIndexForItem(item, token);
  if (committedIndex < 0) return;
  if (previewAudioCueIndex !== committedIndex) {
    setSharedRendererState({ previewAudioCueIndex: committedIndex });
  }

  setCueStartTime(committedIndex, actualStart);
  if (duration > 0) {
    mediaQueue[committedIndex].duration = duration;
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

function clearVideoPreviewCueOverlay() {
  const el = previewCueVideo || document.getElementById("previewCue");
  setSharedRendererState({ previewCueVideoIndex: -1 });
  teardownNetworkPreviewCueStreamingPlayers();
  resetNetworkPreviewStatus();
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
  const item = mediaQueue[index];
  selectNavigationForQueueItem(item);
  if (queueIndexIsCurrentLivePresentation(index)) {
    await restorePreviewToLiveOutput(index);
    return;
  }

  const token = nextPreviewLoadToken();
  commitActiveCueVolume();
  setSharedRendererState({ previewCueIndex: index });
  setSharedRendererState({ cueVolumeDirty: false });
  // Paint the Cued badge immediately — the overlay/metadata load below is
  // async and callers may flip playback flags before it finishes.
  renderQueue();
  syncMediaLoopState({ notify: false });
  setSharedRendererState({ pendingCueVolume: Number.isFinite(item.cueVolume) ? item.cueVolume : 1 });
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
    if (previewCueIndexForItem(item, token) < 0) return;
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
    if (previewCueIndexForItem(item, token) < 0) return;
    item.bible = { ...cueBibleEntry };
    const loaded = await loadBibleEntryIntoEditor(cueBibleEntry, {
      previewLoadToken: token,
    });
    if (!loaded || previewCueIndexForItem(item, token) < 0) return;
    showBibleWorkspace();
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
  } else if (isQueueItemDeck(item)) {
    hidePptxPreviewIfNeeded();
    stopPreviewAudioCue();
    clearVideoPreviewCueOverlay();
    setMediaCountdownOverlayVisible(false);
    setMediaCountdownText("");

    const loaded = await loadDeckQueueItemIntoWorkspace(item, token);
    if (!loaded || previewCueIndexForItem(item, token) < 0) return;
    showSlidesWorkspace();
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
  } else if (isQueueItemSong(item)) {
    hidePptxPreviewIfNeeded();
    stopPreviewAudioCue();
    clearVideoPreviewCueOverlay();
    setMediaCountdownOverlayVisible(false);
    setMediaCountdownText("");
    const loaded = await loadSongItemIntoWorkspace(item, token);

    if (!loaded || previewCueIndexForItem(item, token) < 0) return;
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
      if (previewCueIndexForItem(item, token) < 0) return;
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
    if (previewCueIndexForItem(item, token) < 0) return;
    syncPreviewAudioTrackState();
  }
  if (previewCueIndexForItem(item, token) < 0) return;
  syncMediaLoopState({ notify: false });
  updatePreviewCueUI();
  renderQueue();
}

async function takeQueueItemLive(index, startTime = 0, opts = {}) {
  if (index < 0 || index >= mediaQueue.length) return;
  if (!isScheduleItemCurrentlyPlayable(mediaQueue[index])) {
    const next = nextPlayableQueueIndexAfter(index);
    if (next < 0) {
      showGnomeToast("No playable items in the schedule");
      return;
    }
    return takeQueueItemLive(next, startTime, opts);
  }
  if (pendingQueueSwitchIndex !== null || queueSlipstreamTransitionInProgress) return;
  const requestedItem = mediaQueue[index];
  if (
    !opts.skipLogoHoldPrep &&
    isAudienceLogoHoldActive() &&
    isActiveMediaWindow()
  ) {
    await prepareQueueItemUnderLogoHold(index);
    return;
  }
  if (!(await ensurePendingMediaUpdateApproved(index, requestedItem))) return;
  index = mediaQueue.indexOf(requestedItem);
  if (index < 0) {
    showGnomeToast("The selected schedule item is no longer available");
    return;
  }
  if (!isScheduleItemCurrentlyPlayable(requestedItem)) {
    showGnomeToast("The selected schedule item is no longer playable");
    return;
  }
  setSelectedQueueAnchor(index);
  hideMediaLibraryWorkspaceForSchedulePreview();
  syncPreviewStackSurface();

  const item = requestedItem;
  const safeStart =
    queueItemSupportsCueStartTime(item) && Number.isFinite(startTime) && startTime > 0
      ? startTime
      : 0;
  const transitionToken = audiencePlaybackCoordinator.begin(item, {
    startTime: safeStart,
  });
  if (queueItemSupportsCueStartTime(item)) {
    item.cueStartTime = normalizedQueueItemCueStartTime(item, safeStart);
  } else {
    clearUnsupportedQueueItemCueStartTime(item);
  }

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
    setSharedRendererState({ playingMediaAudioOnly: false });
    setSharedRendererState({ audioOnlyFile: false });
    setSharedRendererState({ isActiveMediaWindowCache: false });
    setSharedRendererState({ mediaPlaybackEndedPending: false });
  }

  if (isActiveMediaWindow()) {
    const switchedInPlace = await slipstreamQueueItemAtIndex(index, {
      startTime: safeStart,
      clearCue: true,
      clearOutputHold: opts.skipLogoHoldPrep === true || opts.clearOutputHold === true,
      transitionToken,
    });
    if (switchedInPlace) {
      return;
    }
    if (
      queueSlipstreamTransitionInProgress ||
      !audiencePlaybackCoordinator.owns(transitionToken)
    ) {
      return;
    }
    const currentTargetIndex = audiencePlaybackCoordinator.indexOf(
      transitionToken,
      mediaQueue,
    );
    if (currentTargetIndex < 0) return;
    audiencePlaybackCoordinator.setPendingClose(transitionToken, safeStart);
    setSharedRendererState({ pendingQueueSwitchIndex: currentTargetIndex });
    setSharedRendererState({ pendingQueueSwitchStartTime: safeStart });
    await closeActiveMediaWindowNow();
    return;
  }

  const currentTargetIndex = audiencePlaybackCoordinator.indexOf(
    transitionToken,
    mediaQueue,
  );
  if (currentTargetIndex < 0) return;
  setSharedRendererState({ currentQueueIndex: currentTargetIndex });
  setSharedRendererState({ isQueuePlaying: true });
  setSharedRendererState({ isPlaying: true });
  updateDynUI();
  const started = await playCurrentQueueItem({
    preservePreviewSeek: false,
    startTime: safeStart,
    transitionToken,
  });
  if (started === false) {
    if (audiencePlaybackCoordinator.owns(transitionToken)) {
      audiencePlaybackCoordinator.cancel();
    }
    return false;
  }
  if (!audiencePlaybackCoordinator.owns(transitionToken)) {
    return false;
  }
  const committedIndex = audiencePlaybackCoordinator.indexOf(transitionToken, mediaQueue);
  if (committedIndex < 0) return false;
  setSharedRendererState({ currentQueueIndex: committedIndex });
  clearCueAfterTake(committedIndex);
  audiencePlaybackCoordinator.complete(transitionToken);
  return true;
}

async function stopQueuePresentationUserClosed() {
  audiencePlaybackCoordinator.cancel();
  stopLiveAudioPresentation();
  scripturePresentation.dispatch({ type: "STOPPED" });
  setSharedRendererState({ activeMediaWindowContentType: null });
  setSharedRendererState({ bibleShowNowModeActive: false });
  clearSongShowNowPresentation();
  setSharedRendererState({ mediaPlaybackEndedPending: false });
  setSharedRendererState({ pendingQueueSwitchIndex: null });
  setSharedRendererState({ pendingQueueSwitchStartTime: 0 });
  setSharedRendererState({ manualBoundaryPauseIndex: -1 });
  setSharedRendererState({ isQueuePlaying: false });
  setSharedRendererState({ isPlaying: false });
  // The lower third survives every mid-schedule item change as a keyed-only
  // output; stopping the presentation is what finally takes it off air.
  await closeBibleLowerThirdOutput();
  updateDynUI();
  setSharedRendererState({ isActiveMediaWindowCache: false });
  setSharedRendererState({ activeResolvedMediaFile: "" });
  setSharedRendererState({ activePreviewResolvedMediaFile: "" });
  renderQueue();

  if (await restorePreviewCueAfterPresentationStopped()) {
    updatePlayButtonOnMediaWindow();
    setSharedRendererState({ masterPauseState: false });
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
    setSharedRendererState({ mediaFile: mediaQueue[currentQueueIndex].path });
    mediaPlayerInputState.filePaths = [mediaFile];
    updateQueueFileLabel(mediaQueue[currentQueueIndex].name);
  } else if (
    currentMode === MEDIAPLAYER &&
    mediaPlayerInputState.filePaths.length > 0
  ) {
    setSharedRendererState({ mediaFile: mediaPlayerInputState.filePaths[0] });
  }

  const stoppedQueueItem =
    currentMode === MEDIAPLAYER && queueIndexInRange(currentQueueIndex)
      ? mediaQueue[currentQueueIndex]
      : null;
  if (
    await restoreWorkspacePreviewForQueueItem(stoppedQueueItem, {
      startTime: queueItemCueStartTime(stoppedQueueItem),
    })
  ) {
    updatePlayButtonOnMediaWindow();
    setSharedRendererState({ masterPauseState: false });
    saveMediaFile();
    removeFilenameFromTitlebar();
    setMediaCountdownText("");
    syncPreviewMediaAfterPresentationStateChange();
    return;
  }

  let isImgFile = isImg(mediaFile);
  if (!pptxRegex.test(mediaFile || "")) hidePptxPreviewIfNeeded();
  await restoreStagedPreviewPlayback(isImgFile);

  resetVideoState();

  updatePlayButtonOnMediaWindow();
  setSharedRendererState({ masterPauseState: false });
  saveMediaFile();
  removeFilenameFromTitlebar();
  setMediaCountdownText("");
  syncPreviewMediaAfterPresentationStateChange();
}

function beginLiveMediaWindowEpoch(playbackId) {
  if (
    !audiencePlaybackCoordinator.matchesActivePlayback({ playbackId }) &&
    !audiencePlaybackCoordinator.commitStagedPlayback(playbackId)
  ) {
    audiencePlaybackCoordinator.activatePlayback(playbackId);
  }
  setSharedRendererState({ liveMediaWindowEpoch: liveMediaWindowEpoch + (1) });
  tracePlayback(
    "beginLiveMediaWindowEpoch",
    liveMediaWindowEpoch,
    "idx=" + currentQueueIndex,
    mediaFile,
  );
}

function claimMediaWindowEnd(payload) {
  if (
    !audiencePlaybackCoordinator.claimPlaybackEnd(payload) ||
    consumedMediaWindowEndEpoch === liveMediaWindowEpoch
  ) {
    return false;
  }
  setSharedRendererState({ consumedMediaWindowEndEpoch: liveMediaWindowEpoch });
  return true;
}

async function loadQueueItemIntoControlWindow(item, opts) {
  const preservePreviewSeek = !opts || opts.preservePreviewSeek !== false;
  const cueOnly = opts?.cueOnly === true;
  const loadToken = opts?.previewLoadToken;
  const presentationTakeover = opts?.presentationTakeover === true;
  const previewRequestStillOwnsMainSurface = () => {
    if (typeof loadToken === "number" && !isCurrentPreviewLoad(loadToken)) {
      return false;
    }
    if (presentationTakeover) return true;
    const currentItemOwnsSurface =
      queueIndexInRange(currentQueueIndex) && mediaQueue[currentQueueIndex] === item;
    if (activePresentationOwnsPreviewAudio()) return currentItemOwnsSurface;
    const cueItemOwnsSurface =
      queueIndexInRange(previewCueIndex) && mediaQueue[previewCueIndex] === item;
    return currentItemOwnsSurface || cueItemOwnsSurface;
  };
  if (!previewRequestStillOwnsMainSurface()) return false;
  selectNavigationForQueueItem(item);
  resolveQueuePresentationVideo();
  let localVideo = video;
  const itemIsBible = isQueueItemBible(item);
  const isImgFile = isImg(item.path);
  const itemIsPptx = isQueueItemPptx(item);
  const itemIsLiveStream = queueItemIsLiveEdgeStream(item);

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

  setSharedRendererState({ mediaFile: item.path });
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
    setSharedRendererState({ audioOnlyFile: false });
    setSharedRendererState({ playingMediaAudioOnly: false });
    const bibleEntry = await resolvedBibleEntryForItem(item);
    if (!previewRequestStillOwnsMainSurface()) return false;
    if (!bibleEntry) {
      throw new Error(
        `Could not resolve scheduled Scripture: ${item.name || item.path || "Scripture"}`,
      );
    }
    item.bible = { ...bibleEntry };
    const loaded = await loadBibleEntryIntoEditor(bibleEntry, {
      previewLoadToken: loadToken,
    });
    if (!previewRequestStillOwnsMainSurface()) return false;
    if (!loaded) {
      throw new Error(
        `Could not load scheduled Scripture: ${item.name || item.path || "Scripture"}`,
      );
    }
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
    return true;
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
    setSharedRendererState({ audioOnlyFile: false });
    setSharedRendererState({ playingMediaAudioOnly: false });
    const loaded = await loadDeckQueueItemIntoWorkspace(item, loadToken);
    if (!previewRequestStillOwnsMainSurface()) return false;
    if (!loaded) {
      throw new Error(
        `Could not resolve scheduled slide deck: ${item.name || item.path || "Deck"}`,
      );
    }
    showSlidesWorkspace();
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
    return true;
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
    setSharedRendererState({ audioOnlyFile: false });
    setSharedRendererState({ playingMediaAudioOnly: false });
    const loaded = await loadSongItemIntoWorkspace(item, loadToken);
    if (!previewRequestStillOwnsMainSurface()) return false;
    if (!loaded) {
      throw new Error(`Could not resolve scheduled song: ${item.name || item.path || "Song"}`);
    }
    showSongsWorkspace();
    document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
    return true;
  }
  hideBiblePreview();
  hideSongsWorkspace();
  hideSlidesWorkspace();

  // Selection changes can spend noticeable time resolving or snapshotting a
  // large media file. Clear the previous surface before that asynchronous
  // work begins so the blue queue selection never appears to refer to the
  // stale video, image, or poster that was loaded for the prior item.
  restoreNonPptxPreviewSurface({ isImage: isImgFile });
  localVideo = video;
  stopNetworkPreviewRtcCapture();
  teardownNetworkPreviewStreamingPlayers();
  resetNetworkPreviewStatus();
  setSharedRendererState({ networkPreviewMirrorLiveEdge: false });
  setSharedRendererState({ networkPreviewMirrorSource: "" });
  if (localVideo) {
    try {
      localVideo.pause();
      localVideo.srcObject = null;
      localVideo.removeAttribute("src");
      clearVideoPoster(localVideo);
      localVideo.load();
    } catch (err) {
      console.error("Failed to clear the previous media preview:", err);
    }
  }
  const pendingPreviewImg = document.querySelector("img#preview");
  if (pendingPreviewImg) {
    pendingPreviewImg.removeAttribute("src");
  }

  const resolvedItemPath = await resolveQueueItemMediaPath(item);
  if (!previewRequestStillOwnsMainSurface()) {
    return;
  }
  setSharedRendererState({ activePreviewResolvedMediaFile: resolvedItemPath });
  const cacheBust = queueItemMediaCacheBust(item);
  const itemIsNetworkVideo =
    !isImgFile &&
    !itemIsPptx &&
    (isNetworkStreamSource(item.path) || isNetworkStreamSource(resolvedItemPath));
  const skipNetworkPreviewLoad =
    opts?.skipNetworkPreviewLoad === true && itemIsNetworkVideo && !itemIsAudio;
  if (itemIsPptx) {
    await loadPptxPreview(item.path, {
      startSlide: Number.isFinite(opts?.pptxStartSlide) ? opts.pptxStartSlide : undefined,
    });
    if (!previewRequestStillOwnsMainSurface()) return false;
    setSharedRendererState({ audioOnlyFile: false });
    setSharedRendererState({ playingMediaAudioOnly: false });
    return;
  }

  restoreNonPptxPreviewSurface({ isImage: isImgFile });
  localVideo = video;
  if (itemIsNetworkVideo) {
    clearVideoPoster(localVideo);
    if (skipNetworkPreviewLoad) {
      stopNetworkPreviewRtcCapture();
      resetNetworkPreviewStatus();
      const mirrorSource = item.path || resolvedItemPath;
      const mirrorWasResolvedLiveEdge = networkPreviewMirrorLiveEdgeMatches(
        item.path,
        resolvedItemPath,
      );
      teardownNetworkPreviewStreamingPlayers();
      setSharedRendererState({ networkPreviewMirrorSource: mirrorSource });
      setSharedRendererState({ networkPreviewMirrorLiveEdge: itemIsLiveStream ||
        mirrorWasResolvedLiveEdge ||
        networkPreviewSourceHidesScrubber(mirrorSource) ||
        networkPreviewSourceHidesScrubber(resolvedItemPath) });
      if (networkPreviewMirrorLiveEdge) {
        normalizeLiveEdgeQueueItemsForSources(item.path, resolvedItemPath, mirrorSource);
      }
      if (localVideo) {
        try {
          localVideo.pause();
          localVideo.srcObject = null;
          localVideo.removeAttribute("src");
          localVideo.load();
        } catch {}
        setupCustomMediaControls.updateControlsForMetadata?.(localVideo);
      }
    } else {
      try {
        await attachNetworkPreviewMirrorSource(
          item.path || resolvedItemPath,
          loadToken,
          previewRequestStillOwnsMainSurface,
        );
        if (!previewRequestStillOwnsMainSurface()) return;
      } catch (err) {
        if (!previewRequestStillOwnsMainSurface()) return;
        console.error("Failed to load network preview mirror:", err);
        handleMediaPlayback(isImgFile, resolvedItemPath, cacheBust);
      }
    }
  } else {
    stopNetworkPreviewRtcCapture();
    resetNetworkPreviewStatus();
    setSharedRendererState({ networkPreviewMirrorLiveEdge: false });
    setSharedRendererState({ networkPreviewMirrorSource: "" });
    handleMediaPlayback(isImgFile, resolvedItemPath, cacheBust);
  }
  handleImageDisplay(isImgFile, document.querySelector("img#preview"), resolvedItemPath, cacheBust);

  if (itemIsAudio && !cueOnly) {
    setSharedRendererState({ audioOnlyFile: true });
    setSharedRendererState({ playingMediaAudioOnly: false });
    document
      .getElementById("customControls")
      ?.style.setProperty("visibility", "");
  }

  if (!isImgFile && localVideo && !itemIsLiveStream && !skipNetworkPreviewLoad) {
    if (!itemIsNetworkVideo) {
      localVideo.load();
    }
    const previousAudioOnlyFile = audioOnlyFile;
    const previousPlayingMediaAudioOnly = playingMediaAudioOnly;
    if (itemIsNetworkVideo) {
      await waitForCueVideoMetadata(localVideo, true);
    } else {
      await waitForMetadata(localVideo);
    }
    if (!previewRequestStillOwnsMainSurface()) return false;
    if (cueOnly) {
      setSharedRendererState({ audioOnlyFile: previousAudioOnlyFile });
      setSharedRendererState({ playingMediaAudioOnly: previousPlayingMediaAudioOnly });
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
        if (!previewRequestStillOwnsMainSurface()) return false;
        if (!cueOnly) {
          setSharedRendererState({ startTime: localVideo.currentTime });
          setSharedRendererState({ targetTime: startTime });
        }
      } catch (err) {
        console.error(err);
      }
    }
    const loadedAudioOnly = mediaElementLoadedAudioOnly(localVideo, item.path);
    if (!cueOnly) {
      setSharedRendererState({ audioOnlyFile: loadedAudioOnly });
    }
    if (loadedAudioOnly && !cueOnly) {
      document
        .getElementById("customControls")
        ?.style.setProperty("visibility", "");
    }
  } else if ((itemIsLiveStream || skipNetworkPreviewLoad) && !cueOnly) {
    setSharedRendererState({ audioOnlyFile: false });
    setSharedRendererState({ playingMediaAudioOnly: false });
    document
      .getElementById("customControls")
      ?.style.setProperty("visibility", "");
  } else if (!cueOnly) {
    setSharedRendererState({ audioOnlyFile: false });
    setSharedRendererState({ playingMediaAudioOnly: false });
  }
  if (!cueOnly) {
    refreshPreviewControlsForCurrentMedia();
  }
}

async function playCurrentQueueItem(opts) {
  // Taking an item live transfers ownership of the main preview/scrubber to
  // that item. Invalidate any slower preview-only request (notably YouTube
  // resolution) before it can attach to the shared video element afterward.
  nextPreviewLoadToken();
  resolveQueuePresentationVideo();
  const localVideo = video;
  setSharedRendererState({ manualBoundaryPauseIndex: -1 });
  setSharedRendererState({ mediaPlaybackEndedPending: false });
  setSharedRendererState({ itc: performance.now() * 0.001 });
  const item = mediaQueue[currentQueueIndex];
  const transitionToken = opts?.transitionToken;
  const transitionStillOwnsItem = () =>
    !transitionToken ||
    (audiencePlaybackCoordinator.owns(transitionToken) &&
      transitionToken.item === item &&
      audiencePlaybackCoordinator.indexOf(transitionToken, mediaQueue) >= 0);
  const failPlaybackStart = (message, error = null) => {
    if (error) console.error("Failed to start scheduled playback:", error);
    setSharedRendererState({ isPlaying: false });
    setSharedRendererState({ isQueuePlaying: false });
    setSharedRendererState({ isActiveMediaWindowCache: false });
    setSharedRendererState({ activeMediaWindowContentType: null });
    send("set-output-content-status", "none");
    if (message) showGnomeToast(message);
    updateDynUI();
    renderQueue();
    return false;
  };
  if (!item) {
    setSharedRendererState({ currentQueueIndex: -1 });
    return failPlaybackStart("");
  }
  if (!isScheduleItemCurrentlyPlayable(item)) {
    const next = nextPlayableQueueIndexAfter(currentQueueIndex);
    if (next >= 0) {
      setSharedRendererState({ currentQueueIndex: next });
      setSelectedQueueAnchor(next);
      renderQueue();
      return playCurrentQueueItem(opts);
    }
    showGnomeToast("No playable items in the schedule");
    return failPlaybackStart("");
  }
  if (queueItemNeedsPendingUpdateApproval(item)) {
    showGnomeToast("Reload the changed media file before taking it live");
    return failPlaybackStart("");
  }

  const itemIsNetworkPresentationVideo =
    !isQueueItemAudio(item) &&
    (isNetworkStreamSource(item.path) || Boolean(item.networkSource));
  try {
    await clearLowerThirdForUnsupportedMediaSource(item);
    if (!isQueueItemBible(item) && scripturePresentation.state.status !== "idle") {
      scripturePresentation.dispatch({ type: "STOPPED" });
    }
    const loaded = await loadQueueItemIntoControlWindow(item, {
      ...(opts || {}),
      skipNetworkPreviewLoad: itemIsNetworkPresentationVideo,
    });
    if (!transitionStillOwnsItem()) return false;
    if (loaded === false) return failPlaybackStart("");
  } catch (error) {
    return failPlaybackStart(
      error?.message || "Could not load the scheduled item",
      error,
    );
  }
  renderQueue();

  setSharedRendererState({ isPlaying: true });
  updateDynUI();

  if (isQueueItemBible(item)) {
    let entry = null;
    try {
      entry = await resolvedBibleEntryForItem(item, { requireLookup: true });
    } catch (error) {
      return failPlaybackStart(
        error?.message || "Could not load the scheduled Scripture text",
        error,
      );
    }
    if (!entry) {
      return failPlaybackStart("Could not load the scheduled Scripture text");
    }
    const requestedOutputRoles = opts?.outputRoles;
    const wantsAudience = requestedOutputRoles
      ? requestedOutputRoles.audience === true
      : hasAudienceOutputSelected();
    const wantsLowerThird = requestedOutputRoles
      ? requestedOutputRoles.lowerThird === true
      : hasLowerThirdOutputSelected();
    const presentationRevision = beginScriptureTake(entry, {
      item,
      scheduleIndex: currentQueueIndex,
      audience: wantsAudience,
      lowerThird: wantsLowerThird,
    });
    const lowerThirdStarted = wantsLowerThird
      ? await updateLowerThirdForSupportedScheduleItem(
          item,
          presentationRevision,
        )
      : false;
    const audienceStarted = wantsAudience
      ? await createMediaWindow({
          textItem: item,
          presentationRevision,
          resolvedBibleEntry: entry,
          transitionToken,
        })
      : false;
    confirmScriptureTake(presentationRevision, {
      audience: audienceStarted,
      lowerThird: lowerThirdStarted,
    });
    if (!audienceStarted && !lowerThirdStarted) {
      showGnomeToast("Choose an output display");
      setSharedRendererState({ isPlaying: false });
      setSharedRendererState({ isQueuePlaying: false });
      updateDynUI();
      renderQueue();
    }
    return audienceStarted || lowerThirdStarted;
  }

  if (isQueueItemSong(item)) {
    const requestedOutputRoles = opts?.outputRoles;
    const wantsAudience = requestedOutputRoles
      ? requestedOutputRoles.audience === true
      : hasAudienceOutputSelected();
    const wantsLowerThird = requestedOutputRoles
      ? requestedOutputRoles.lowerThird === true
      : hasLowerThirdOutputSelected();
    const lowerThirdStarted = wantsLowerThird
      ? await updateLowerThirdForSupportedScheduleItem(item)
      : false;
    const audienceStarted = wantsAudience
      ? await createMediaWindow({ textItem: item, songItem: true, transitionToken })
      : false;
    if (!audienceStarted && !lowerThirdStarted) {
      showGnomeToast("Choose an output display");
      setSharedRendererState({ isPlaying: false });
      setSharedRendererState({ isQueuePlaying: false });
      updateDynUI();
      renderQueue();
    }
    return audienceStarted || lowerThirdStarted;
  }

  void syncStageContentFromQueueItem(item).catch(() => {});

  if (!audioOnlyFile && !hasAudienceOutputSelected()) {
    return failPlaybackStart("Choose an audience output display");
  }

  const iM = isImg(mediaFile);
  if (iM) {
    const started = await createMediaWindow({ transitionToken });
    if (!started) return failPlaybackStart("");
    if (localVideo) {
      localVideo.currentTime = 0;
      if (!localVideo.paused) {
        localVideo.removeAttribute("src");
        localVideo.load();
      }
    }
    return true;
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
    return true;
  }

  const projectionVideo = resolveQueuePresentationVideo();
  const requestedProjectionStart =
    queueItemSupportsCueStartTime(item) && Number.isFinite(opts?.startTime)
      ? validMediaStartTime(opts.startTime)
      : queueItemCueStartTime(item);
  const started = await createMediaWindow({
    startTime:
      requestedProjectionStart > 0
        ? requestedProjectionStart
        : validMediaStartTime(projectionVideo?.currentTime),
    transitionToken,
  });
  if (!started) return failPlaybackStart("");
  return true;
}

async function advanceQueueAfterMediaWindowClosed() {
  tracePlayback(
    "advanceQueueAfterMediaWindowClosed",
    "idx=" + currentQueueIndex,
    "advancing=" + isAdvancingQueue,
    "loop=" + loopEnabledForLiveMedia(),
  );
  if (isAdvancingQueue) return;
  if (loopEnabledForLiveMedia()) {
    setSharedRendererState({ mediaPlaybackEndedPending: false });
    syncMediaLoopState();
    return;
  }
  setSharedRendererState({ isAdvancingQueue: true });
  try {
    setSharedRendererState({ isPlaying: false });
    updateDynUI();
    setSharedRendererState({ isActiveMediaWindowCache: false });

    const cue = currentPreviewCue();
    if (cue) {
      if (!shouldAutoTransitionToIndex(cue.index)) {
        await pauseQueuePresentationAtBoundary(cue.index);
        return;
      }
      const transitionToken = audiencePlaybackCoordinator.begin(cue.item, {
        startTime: cue.startTime,
      });
      await new Promise((r) => setTimeout(r, 100));
      if (!audiencePlaybackCoordinator.owns(transitionToken)) return;
      const targetIndex = audiencePlaybackCoordinator.indexOf(transitionToken, mediaQueue);
      if (targetIndex < 0) return;
      setSharedRendererState({ currentQueueIndex: targetIndex });
      setSelectedQueueAnchor(targetIndex);
      renderQueue();
      setSharedRendererState({ isPlaying: true });
      updateDynUI();
      const started = await playCurrentQueueItem({
        preservePreviewSeek: false,
        startTime: cue.startTime,
        transitionToken,
      });
      if (!started) {
        if (audiencePlaybackCoordinator.owns(transitionToken)) {
          audiencePlaybackCoordinator.cancel();
        }
        return;
      }
      if (!audiencePlaybackCoordinator.owns(transitionToken)) return;
      const committedIndex = audiencePlaybackCoordinator.indexOf(transitionToken, mediaQueue);
      if (committedIndex < 0) return;
      setSharedRendererState({ currentQueueIndex: committedIndex });
      clearCueAfterTake(committedIndex);
      audiencePlaybackCoordinator.complete(transitionToken);
      return;
    }

    const nextIndex = nextQueueBoundaryIndex();
    if (nextIndex >= 0 && shouldAutoTransitionToIndex(nextIndex)) {
      const item = mediaQueue[nextIndex];
      const transitionToken = audiencePlaybackCoordinator.begin(item, {
        startTime: queueItemCueStartTime(item),
      });
      await new Promise((r) => setTimeout(r, 100));
      if (!audiencePlaybackCoordinator.owns(transitionToken)) return;
      const targetIndex = audiencePlaybackCoordinator.indexOf(transitionToken, mediaQueue);
      if (targetIndex < 0) return;
      setSharedRendererState({ currentQueueIndex: targetIndex });
      setSelectedQueueAnchor(targetIndex);
      renderQueue();
      setSharedRendererState({ isPlaying: true });
      updateDynUI();
      const started = await playCurrentQueueItem({
        preservePreviewSeek: false,
        startTime: queueItemCueStartTime(item),
        transitionToken,
      });
      if (!started) {
        if (audiencePlaybackCoordinator.owns(transitionToken)) {
          audiencePlaybackCoordinator.cancel();
        }
        return;
      }
      if (!audiencePlaybackCoordinator.owns(transitionToken)) return;
      const committedIndex = audiencePlaybackCoordinator.indexOf(transitionToken, mediaQueue);
      if (committedIndex < 0) return;
      setSharedRendererState({ currentQueueIndex: committedIndex });
      audiencePlaybackCoordinator.complete(transitionToken);
      return;
    }
    // No more auto-advanceable items: stop at the boundary. An in-range index
    // pauses on that item; otherwise (end of queue) keep the last item
    // highlighted instead of wrapping back to the top.
    await pauseQueuePresentationAtBoundary(
      nextIndex >= 0 ? nextIndex : -1,
    );
  } finally {
    setSharedRendererState({ isAdvancingQueue: false });
  }
}

async function slipstreamQueueItemAtIndex(index, opts = {}) {
  tracePlayback(
    "slipstreamQueueItemAtIndex",
    "index=" + index,
    "fromIdx=" + currentQueueIndex,
    "inProgress=" + queueSlipstreamTransitionInProgress,
    "activeWindow=" + isActiveMediaWindow(),
  );
  if (queueSlipstreamTransitionInProgress) return false;
  const requestedItem = index >= 0 && index < mediaQueue.length ? mediaQueue[index] : null;
  const transitionToken = opts.transitionToken || (
    requestedItem
      ? audiencePlaybackCoordinator.begin(requestedItem, { startTime: opts.startTime })
      : null
  );
  if (!transitionToken || !audiencePlaybackCoordinator.owns(transitionToken)) return false;
  const transitionWasSupplied = Boolean(opts.transitionToken);
  const abandonStandaloneTransition = () => {
    if (!transitionWasSupplied && audiencePlaybackCoordinator.owns(transitionToken)) {
      audiencePlaybackCoordinator.cancel();
    }
    return false;
  };
  const nextItem = transitionToken.item;
  index = audiencePlaybackCoordinator.indexOf(transitionToken, mediaQueue);
  if (index < 0) return abandonStandaloneTransition();
  if (nextItem && !isScheduleItemCurrentlyPlayable(nextItem)) {
    return abandonStandaloneTransition();
  }
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
  const allowLogoHoldStaging =
    Boolean(opts.underLogoHold) &&
    isAudienceLogoHoldActive() &&
    isActiveMediaWindow();
  if (
    !isQueuePlaying &&
    !allowBibleInPlaceSwitch &&
    !allowSongInPlaceSwitch &&
    !allowLogoHoldStaging
  ) {
    return abandonStandaloneTransition();
  }
  if (!isActiveMediaWindow()) return abandonStandaloneTransition();
  if (index < 0 || index >= mediaQueue.length) return abandonStandaloneTransition();
  // Live streams are not slipstreamed. Fall back to the normal close/reopen
  // cycle whether we're leaving a stream or switching into one.
  if (activeLiveStream || isLiveStream(mediaFile) || isLiveStream(nextItem.path)) {
    return abandonStandaloneTransition();
  }
  if (queueItemNeedsPendingUpdateApproval(nextItem)) {
    showGnomeToast("Reload the changed media file before taking it live");
    return abandonStandaloneTransition();
  }

  setSharedRendererState({ queueSlipstreamTransitionInProgress: true });
  let startupSyncStarted = false;
  // Staging the next item rewrites #preview's source and seeks it to the new
  // cue point. Those pause/seek events would otherwise be forwarded to the
  // projection as play-ctl / timeGoto-message commands describing a clip that is
  // not live yet, fighting the slipstream payload that is about to carry the
  // same cue. The projection is driven entirely by that payload here, so mirror
  // forwarding stays off for the whole transition.
  beginPreviewForwardingSuppression();
  try {
    const nextType = nextItem.type || classifyQueueMediaType(nextItem.path);
    const isImgFile = isImg(nextItem.path);
    const isPptxFile = isQueueItemPptx(nextItem);
    const isBibleItem = isQueueItemBible(nextItem);
    const isSongItem = isQueueItemSong(nextItem);
    const resolvedNextPath = isBibleItem || isSongItem
      ? nextItem.path
      : await resolveQueueItemMediaPath(nextItem);
    if (!audiencePlaybackCoordinator.owns(transitionToken)) return false;

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
      presentationTakeover: true,
    });
    if (!audiencePlaybackCoordinator.owns(transitionToken)) return false;
    index = audiencePlaybackCoordinator.indexOf(transitionToken, mediaQueue);
    if (index < 0) return false;
    resolveQueuePresentationVideo();

    // Audio must play in the local preview — destroy the media window as usual.
    if (!isImgFile && !isPptxFile && !isBibleItem && !isSongItem && (nextType === "audio" || audioOnlyFile)) {
      audiencePlaybackCoordinator.setPendingClose(transitionToken, requestedStart);
      setSharedRendererState({ pendingQueueSwitchIndex: index });
      setSharedRendererState({ pendingQueueSwitchStartTime: requestedStart });
      setSharedRendererState({ mediaPlaybackEndedPending: false });
      await closeActiveMediaWindowNow();
      return true;
    }

    consumePendingCueVolume(index);
    const underLogoHold = Boolean(opts.underLogoHold);
    const clearOutputHold = Boolean(opts.clearOutputHold);
    const resolvedBibleEntry = isBibleItem
      ? await resolvedBibleEntryForItem(nextItem, { requireLookup: true })
      : null;
    if (isBibleItem && !resolvedBibleEntry) return false;
    const scriptureTakeRevision = resolvedBibleEntry
      ? beginScriptureTake(resolvedBibleEntry, {
          item: nextItem,
          scheduleIndex: index,
          audience: true,
          lowerThird: hasLowerThirdOutputSelected(),
        })
      : null;
    if (resolvedBibleEntry) {
      await waitForScriptureFonts(resolvedBibleEntry);
      if (!scripturePresentation.isCurrentRevision(scriptureTakeRevision)) return false;
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
          sample: cleanBibleVerseTextForDisplay(resolvedBibleEntry.text) || "EMS",
          fontSize: resolvedTheme.typography?.fontSize || resolvedBibleEntry.fontSize,
        });
        if (!scripturePresentation.isCurrentRevision(scriptureTakeRevision)) return false;
      }
    }
    const resolvedSongItem = isSongItem
      ? songItemForAudienceResolution(nextItem)
      : null;
    if (resolvedSongItem) {
      await waitForTextFonts(
        [
          resolvedSongItem.resolvedTheme?.typography?.fontFamily,
          resolvedSongItem.render?.fontFamily,
        ],
        {
          documentRef: globalThis.document,
          sample: resolvedSongItem.songSnapshot?.title || "EMS",
          fontSize:
            resolvedSongItem.resolvedTheme?.typography?.fontSize ||
            resolvedSongItem.render?.fontSize,
        },
      );
    }
    const resolvedSongAudiencePresentation = isSongItem
      ? resolvedSongPresentation(resolvedSongItem)
      : null;
    if (isSongItem && !resolvedSongAudiencePresentation?.message) return false;
    const slipstreamData = isBibleItem
      ? {
          isText: true,
          mediaFile: nextItem.path,
          textPayload: audienceTextMessageForSend("bible", {
            ...buildBibleTextMessage(resolvedBibleEntry, {
              look: SCRIPTURE_LOOK_FULLSCREEN,
            }),
            transition: slideTransitionPayloadForQueueItem(nextItem),
          }),
          transition: slideTransitionPayloadForQueueItem(nextItem),
          underLogoHold,
          clearOutputHold,
        }
      : isSongItem
        ? {
            isText: true,
            mediaFile: nextItem.path,
            textPayload: audienceTextMessageForSend("song", {
              ...resolvedSongAudiencePresentation.message,
              transition: slideTransitionPayloadForQueueItem(nextItem),
            }),
            transition: slideTransitionPayloadForQueueItem(nextItem),
            underLogoHold,
            clearOutputHold,
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
          underLogoHold,
          clearOutputHold,
        };

    if (!isBibleItem && !isSongItem && !isImgFile && !isPptxFile && !underLogoHold) {
      beginProjectionPlaybackStartupSync();
      startupSyncStarted = true;
    }

    if (!audiencePlaybackCoordinator.owns(transitionToken)) return false;
    index = audiencePlaybackCoordinator.indexOf(transitionToken, mediaQueue);
    if (index < 0) return false;
    const slipstreamResult = await activateAudienceSlipstream(
      (activationPayload) => invoke("slipstream-media-window", activationPayload),
      slipstreamData,
    );
    const slipstreamSuccess = slipstreamResult.ok === true;
    resolveQueuePresentationVideo();
    if (!slipstreamSuccess) {
      if (startupSyncStarted) finishProjectionPlaybackStartupSync();
      if (scriptureTakeRevision !== null) {
        confirmScriptureTake(scriptureTakeRevision, {
          audience: false,
          lowerThird: false,
        });
      }
      return false;
    }
    if (!audiencePlaybackCoordinator.owns(transitionToken)) return false;
    index = audiencePlaybackCoordinator.indexOf(transitionToken, mediaQueue);
    if (index < 0) return false;
    if (
      scriptureTakeRevision !== null &&
      !scripturePresentation.isCurrentRevision(scriptureTakeRevision)
    ) {
      return false;
    }
    if (!isBibleItem && scripturePresentation.state.status !== "idle") {
      scripturePresentation.dispatch({ type: "STOPPED" });
    }
    setSharedRendererState({ activeResolvedMediaFile: resolvedNextPath });
    setSharedRendererState({ activePreviewResolvedMediaFile: resolvedNextPath });

    // Window stays alive — advance queue state without the normal close/reopen cycle.
    // A new clip is now live: open a fresh end-of-clip epoch so its natural end
    // can be claimed exactly once (and any late end from the clip we just left
    // is ignored).
    beginLiveMediaWindowEpoch(slipstreamResult.playbackId);
    setSharedRendererState({ mediaPlaybackEndedPending: false });
    setSharedRendererState({ currentQueueIndex: index });
    setSelectedQueueAnchor(index);
    setSharedRendererState({ isQueuePlaying: true });
    setSharedRendererState({ bibleShowNowModeActive: false });
    clearSongShowNowPresentation();
    const nextContentType = classifyPresentationType(nextItem);
    setSharedRendererState({ activeMediaWindowContentType: nextContentType });
    send("set-output-content-status", nextContentType);
    setSharedRendererState({ isActiveMediaWindowCache: true });
    setSharedRendererState({ isPlaying: true });
    resetCountdownSync();
    setSharedRendererState({ localTimeStampUpdateIsRunning: false });
    setMediaCountdownText("");
    // A slipstream transition is not a stop. Keep this clear so any incidental
    // pause/load event from the preview mirror is not treated as a completed
    // local playback.
    setSharedRendererState({ fileEnded: false });
    setSharedRendererState({ audioOnlyFile: false });
    setSharedRendererState({ playingMediaAudioOnly: false });
    await clearLowerThirdForUnsupportedMediaSource(nextItem);
    if (!audiencePlaybackCoordinator.owns(transitionToken)) return false;
    updateDynUI();
    syncPreviewAudioTrackState();
    if (isBibleItem) {
      const audienceUpdated = await sendBibleTextToOutput(
        resolvedBibleEntry,
        scriptureTakeRevision,
        { expectedPlaybackId: slipstreamResult.playbackId },
      );
      const lowerThirdUpdated = await updateLowerThirdForSupportedScheduleItem(
        nextItem,
        scriptureTakeRevision,
      );
      confirmScriptureTake(scriptureTakeRevision, {
        audience: audienceUpdated !== false,
        lowerThird: lowerThirdUpdated === true,
      });
    } else if (isSongItem) {
      await sendSongTextToOutput(nextItem, {
        expectedPlaybackId: slipstreamResult.playbackId,
      });
      await updateLowerThirdForSupportedScheduleItem(nextItem);
    } else {
      void syncStageContentFromQueueItem(nextItem).catch(() => {});
    }
    if (!audiencePlaybackCoordinator.owns(transitionToken)) return false;
    syncAudienceOutputHoldAfterPresentationStart();
    renderQueue();
    index = audiencePlaybackCoordinator.indexOf(transitionToken, mediaQueue);
    if (index < 0) return false;
    if (opts.clearCue !== false) {
      clearCueAfterTake(index);
    }

    // Mirror the media window: start the local preview so the operator sees
    // what's projecting. In the non-slipstream path createMediaWindow's
    // "media-window autoplay" call does this; we must do it ourselves here.
    if (video && !isImgFile && !isPptxFile && !opts.underLogoHold) {
      await playLivePreviewMirrorSafely("slipstream preview play");
    }

    if (!audiencePlaybackCoordinator.owns(transitionToken)) return false;
    audiencePlaybackCoordinator.complete(transitionToken);
    return true;
  } catch (err) {
    if (startupSyncStarted) finishProjectionPlaybackStartupSync();
    throw err;
  } finally {
    if (
      !transitionWasSupplied &&
      audiencePlaybackCoordinator.owns(transitionToken) &&
      audiencePlaybackCoordinator.pendingCloseItem() !== nextItem
    ) {
      audiencePlaybackCoordinator.cancel();
    }
    endPreviewForwardingSuppression();
    setSharedRendererState({ queueSlipstreamTransitionInProgress: false });
  }
}

async function trySlipstreamNextQueueItem() {
  // A natural-end IPC from the outgoing clip can arrive while an operator- or
  // cue-driven slipstream is already activating the replacement. That event
  // belongs to the transition in flight; starting another attempt would make
  // attemptTransition cancel the valid transition and strand its preview.
  if (queueSlipstreamTransitionInProgress) return false;
  const attemptTransition = async (index, options) => {
    try {
      const transitioned = await slipstreamQueueItemAtIndex(index, options);
      if (!transitioned) audiencePlaybackCoordinator.cancel();
      return transitioned;
    } catch (error) {
      audiencePlaybackCoordinator.cancel();
      throw error;
    }
  };
  const cue = currentPreviewCue();
  if (cue) {
    if (!shouldAutoTransitionToIndex(cue.index)) {
      return false;
    }
    return attemptTransition(cue.index, {
      startTime: cue.startTime,
      clearCue: true,
    });
  }
  const nextIndex = nextQueueBoundaryIndex();
  if (!shouldAutoTransitionToIndex(nextIndex)) {
    return false;
  }
  const nextItem = mediaQueue[nextIndex];
  return attemptTransition(nextIndex, {
    startTime: queueItemCueStartTime(nextItem),
  });
}

function handleRemoteMediaWindowTimeTick(duration, currentTime, timestamp, tickMediaFile) {
  if (
    tickMediaFile &&
    mediaFile &&
    !mediaPathMatchesCurrentLiveMedia(tickMediaFile)
  ) {
    return;
  }
  updateNetworkPreviewTransportState({
    duration,
    currentTime,
    timestamp,
    paused: false,
    mediaFile: tickMediaFile || mediaFile || "",
  });
}

async function closeActiveMediaWindowNow() {
  if (!isActiveMediaWindow()) return false;
  resetAudienceOutputHold({ quiet: true });
  setSharedRendererState({ isActiveMediaWindowCache: false });
  syncPreviewAudioTrackState();
  try {
    return await invoke("close-media-window-now");
  } catch (err) {
    console.error("Failed to close media window via invoke:", err);
    send("close-media-window", 0);
    // Null means a fire-and-forget fallback close is still pending. Callers
    // must wait for media-window-closed instead of treating the window as
    // already absent and starting replacement output over it.
    return null;
  }
}

async function handleMediaWindowClosed(event, id) {
  tracePlayback(
    "handleMediaWindowClosed",
    "queuePlaying=" + isQueuePlaying,
    "endedPending=" + mediaPlaybackEndedPending,
    "userStop=" + userStopPresentationPending,
    "pendingSwitch=" + pendingQueueSwitchIndex,
    "idx=" + currentQueueIndex,
    "loop=" + loopEnabledForLiveMedia(),
  );
  // Once the audience window is gone, neither queued playback-state work nor
  // an activation that was waiting on that renderer may retain ownership.
  audiencePlaybackCoordinator.deactivatePlayback();
  audiencePlaybackCoordinator.discardStagedPlayback();
  setSharedRendererState({
    playbackStateSyncGeneration: playbackStateSyncGeneration + 1,
    desiredProjectionPreviewPlayback: "paused",
    latestExplicitProjectionPauseState: null,
  });
  resolveQueuePresentationVideo();
  const localVideo = video;
  finishProjectionPlaybackStartupSync();
  restoreLivePreviewMirrorMuteState(localVideo);
  stopNetworkPreviewRtcCapture({ notifyMedia: false });
  stopStreamRendererPreviewCapture();
  resetAudienceOutputHold({ quiet: true });
  setSharedRendererState({ logoHoldOnlyPresentation: false });
  setSharedRendererState({ logoHoldStagedPlayback: false });
  setSharedRendererState({ activeMediaWindowContentType: null });
  setSharedRendererState({ activeResolvedMediaFile: "" });
  setSharedRendererState({ activePreviewResolvedMediaFile: "" });
  setSharedRendererState({ bibleShowNowModeActive: false });
  clearSongShowNowPresentation();

  try {
    await invoke("dismiss-queue-switch-dialog");
  } catch (err) {
    console.error(err);
  }

  if (pendingQueueClearPostClose) {
    audiencePlaybackCoordinator.cancel();
    await finalizeQueueClearAfterAudienceClose();
    return;
  }

  if (userStopPresentationPending) {
    audiencePlaybackCoordinator.cancel();
    setSharedRendererState({ userStopPresentationPending: false });
    setSharedRendererState({ mediaPlaybackEndedPending: false });
    setSharedRendererState({ pendingQueueSwitchIndex: null });
    setSharedRendererState({ pendingQueueSwitchStartTime: 0 });
    await stopQueuePresentationUserClosed();
    return;
  }

  const pendingSwitch = audiencePlaybackCoordinator.consumePendingClose(mediaQueue);
  if (pendingQueueSwitchIndex !== null || pendingSwitch) {
    setSharedRendererState({ pendingQueueSwitchIndex: null });
    setSharedRendererState({ pendingQueueSwitchStartTime: 0 });
    setSharedRendererState({ mediaPlaybackEndedPending: false });

    setSharedRendererState({ isPlaying: false });
    updateDynUI();
    setSharedRendererState({ isActiveMediaWindowCache: false });

    if (!pendingSwitch) {
      audiencePlaybackCoordinator.cancel();
      setSharedRendererState({ isQueuePlaying: false });
      renderQueue();
      return;
    }

    let idx = pendingSwitch.index;
    const item = pendingSwitch.item;
    const transitionToken = pendingSwitch.token;
    const switchStartTime = pendingSwitch.startTime;

    try {
      setSharedRendererState({ currentQueueIndex: idx });
      setSelectedQueueAnchor(idx);
      // Switching live items through a window close/reopen cycle is the fallback
      // for transitions slipstream cannot do in place, so it needs the same
      // lower-third handling the slipstream and direct-play paths perform.
      await clearLowerThirdForUnsupportedMediaSource(item);
      await loadQueueItemIntoControlWindow(item, {
        preservePreviewSeek: false,
        startTime: switchStartTime,
      });
      if (!audiencePlaybackCoordinator.owns(transitionToken)) return;
      idx = audiencePlaybackCoordinator.indexOf(transitionToken, mediaQueue);
      if (idx < 0) return;
      setSharedRendererState({ currentQueueIndex: idx });
      setSelectedQueueAnchor(idx);
      renderQueue();

      setSharedRendererState({ isPlaying: true });
      updateDynUI();

      const iM = isImg(mediaFile);
      if (iM) {
        const started = await createMediaWindow({ transitionToken });
        if (!started) throw new Error("Could not start the audience output");
        if (localVideo) {
          localVideo.currentTime = 0;
          if (!localVideo.paused) {
            localVideo.removeAttribute("src");
            localVideo.load();
          }
        }
      } else if (isQueueItemBible(item)) {
        const entry = await resolvedBibleEntryForItem(item, {
          requireLookup: true,
        });
        if (!entry) throw new Error("Could not load the scheduled Scripture text");
        if (!audiencePlaybackCoordinator.owns(transitionToken)) return;
        const lowerThirdStarted = await updateLowerThirdForSupportedScheduleItem(item);
        const audienceStarted = hasAudienceOutputSelected()
          ? await createMediaWindow({
              textItem: item,
              resolvedBibleEntry: entry,
              transitionToken,
            })
          : false;
        if (!audienceStarted && !lowerThirdStarted) {
          showGnomeToast("Choose an output display");
          setSharedRendererState({ isPlaying: false });
          setSharedRendererState({ isQueuePlaying: false });
          updateDynUI();
          renderQueue();
          return;
        }
      } else if (isQueueItemSong(item)) {
        const lowerThirdStarted = await updateLowerThirdForSupportedScheduleItem(item);
        const audienceStarted = hasAudienceOutputSelected()
          ? await createMediaWindow({ textItem: item, songItem: true, transitionToken })
          : false;
        if (!audienceStarted && !lowerThirdStarted) {
          showGnomeToast("Choose an output display");
          setSharedRendererState({ isPlaying: false });
          setSharedRendererState({ isQueuePlaying: false });
          updateDynUI();
          renderQueue();
          return;
        }
      } else if (
        audioOnlyFile ||
        classifyQueueMediaType(item.path) === "audio"
      ) {
        await playAudioOnlyLocally(switchStartTime);
      } else {
        const started = await createMediaWindow({ transitionToken });
        if (!started) throw new Error("Could not start the audience output");
      }
      if (!audiencePlaybackCoordinator.owns(transitionToken)) return;
      idx = audiencePlaybackCoordinator.indexOf(transitionToken, mediaQueue);
      if (idx < 0) return;
      setSharedRendererState({ currentQueueIndex: idx });
      clearCueAfterTake(idx);
      audiencePlaybackCoordinator.complete(transitionToken);
    } catch (error) {
      audiencePlaybackCoordinator.cancel();
      console.error("Failed to switch the live schedule item after closing the output:", error);
      setSharedRendererState({ isPlaying: false });
      setSharedRendererState({ isQueuePlaying: false });
      setSharedRendererState({ isActiveMediaWindowCache: false });
      setSharedRendererState({ activeMediaWindowContentType: null });
      send("set-output-content-status", "none");
      updateDynUI();
      renderQueue();
      showGnomeToast(error?.message || "Could not load the selected schedule item");
    }
    return;
  }

  if (isQueuePlaying) {
    if (mediaPlaybackEndedPending) {
      setSharedRendererState({ mediaPlaybackEndedPending: false });
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
      tracePlayback("handleMediaWindowClosed LOOP-RESTART (single-file loop)");
      setSharedRendererState({ startTime: 0 });
      setSharedRendererState({ targetTime: 0 });
      localVideo.currentTime = 0;
      await playVideoSafely(localVideo, "loop restart after window close");
      await createMediaWindow();
      return;
    }
  }

  setSharedRendererState({ isPlaying: false });
  updateDynUI();
  setSharedRendererState({ isActiveMediaWindowCache: false });

  if (await restorePreviewCueAfterPresentationStopped()) {
    updatePlayButtonOnMediaWindow();
    setSharedRendererState({ masterPauseState: false });
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
    setSharedRendererState({ mediaFile: mediaPlayerInputState.filePaths[0] });
  }

  const closedQueueItem =
    currentMode === MEDIAPLAYER && queueIndexInRange(currentQueueIndex)
      ? mediaQueue[currentQueueIndex]
      : null;
  if (
    await restoreWorkspacePreviewForQueueItem(closedQueueItem, {
      startTime: queueItemCueStartTime(closedQueueItem),
    })
  ) {
    updatePlayButtonOnMediaWindow();
    setSharedRendererState({ masterPauseState: false });
    saveMediaFile();
    removeFilenameFromTitlebar();
    setMediaCountdownText("");
    syncPreviewMediaAfterPresentationStateChange();
    return;
  }

  let isImgFile = isImg(mediaFile);
  if (!pptxRegex.test(mediaFile || "")) hidePptxPreviewIfNeeded();
  await restoreStagedPreviewPlayback(isImgFile);

  resetVideoState();

  updatePlayButtonOnMediaWindow();
  setSharedRendererState({ masterPauseState: false });
  saveMediaFile();
  removeFilenameFromTitlebar();
  setMediaCountdownText("");
  syncPreviewMediaAfterPresentationStateChange();
}

function updatePlayButtonOnMediaWindow() {
  const playButton = document.getElementById("mediaWindowPlayButton");
  if (playButton !== null) {
    updateDynUI();
  } else {
    document
      .getElementById("MdPlyrRBtnFrmID")
      ?.addEventListener("click", updateDynUI, { once: true });
  }
}

export {
  advanceQueueAfterMediaWindowClosed,
  beginLiveMediaWindowEpoch,
  claimMediaWindowEnd,
  clearCueAfterTake,
  clearPreviewCue,
  clearVideoPreviewCueOverlay,
  closeActiveMediaWindowNow,
  currentPreviewCue,
  ensurePreviewCueVideoElement,
  getPreviewCueDisplayVolume,
  handleMediaWindowClosed,
  handleRemoteMediaWindowTimeTick,
  installPreviewCueVideoHandlers,
  isAudioPreviewCueActive,
  isPreviewCueVolumeActive,
  isVideoPreviewCueActive,
  loadAudioQueueItemIntoPreviewCue,
  loadQueueItemIntoControlWindow,
  loadQueueItemIntoPreviewCue,
  loadVideoQueueItemIntoPreviewCueOverlay,
  playCurrentQueueItem,
  restorePreviewCueAfterPresentationStopped,
  setPreviewCueVideoLocalAudio,
  slipstreamQueueItemAtIndex,
  stopPreviewAudioCue,
  stopQueuePresentationUserClosed,
  takeQueueItemLive,
  trySlipstreamNextQueueItem,
  updatePlayButtonOnMediaWindow,
  updatePreviewCueUI,
};
