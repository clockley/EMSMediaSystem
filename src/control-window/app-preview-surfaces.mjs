/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/*
 * Preview stack surfaces, video posters, empty-state, and restore-to-live helpers.
 */

import {
  MEDIAPLAYER,
  PREVIEW_SURFACE_BIBLE,
  PREVIEW_SURFACE_CUE_AUDIO,
  PREVIEW_SURFACE_CUE_IMAGE,
  PREVIEW_SURFACE_CUE_VIDEO,
  PREVIEW_SURFACE_LIVE,
  PREVIEW_SURFACE_PPTX,
  PREVIEW_SURFACE_SLIDES,
  PREVIEW_SURFACE_SONGS,
  activePreviewResolvedMediaFile,
  activeResolvedMediaFile,
  audioOnlyFile,
  clearVideoPreviewCueOverlay,
  commitActiveCueVolume,
  cueVolumeDirty,
  currentMode,
  currentQueueIndex,
  getLivePptxSlideFromMediaWindow,
  handleImageDisplay,
  handleMediaPlayback,
  hideBibleWorkspace,
  hidePptxPreview,
  hideSlidesWorkspace,
  hideSongsWorkspace,
  invoke,
  isAudioPreviewCueActive,
  isCurrentPreviewLoad,
  isFileBackedMediaPath,
  isImagePreviewCueActive,
  isNetworkStreamSource,
  isPptxPreviewVisible,
  isQueueItemBible,
  isQueueItemDeck,
  isQueueItemImage,
  isQueueItemPptx,
  isQueueItemSong,
  isSavedPptxSlideIndex,
  isVideoPreviewCueActive,
  liveAudio,
  liveAudioQueueIndex,
  loadBibleEntryIntoEditor,
  loadDeckQueueItemIntoWorkspace,
  loadPptxPreview,
  loadQueueItemIntoControlWindow,
  loadSongItemIntoWorkspace,
  localTimeStampUpdateIsRunning,
  mediaElementComparableSource,
  mediaFile,
  mediaPlayerInputState,
  mediaQueue,
  networkPreviewCueLiveEdge,
  networkPreviewMirrorLiveEdge,
  networkPreviewMirrorSource,
  networkPreviewRepresentsMediaFile,
  nextPreviewLoadToken,
  normalizeMediaPathForCompare,
  openMediaFilesDialog,
  pathToMediaUrl,
  pendingCueVolume,
  playingMediaAudioOnly,
  pptxStartSlideForItem,
  prePathname,
  previewCueIndex,
  previewLoadToken,
  queueItemCueStartTime,
  queueItemForPath,
  queueItemMediaCacheBust,
  refreshLiveAudioControls,
  refreshPreviewControlsForCurrentMedia,
  removeFilenameFromTitlebar,
  renderQueue,
  resetNetworkPreviewStatus,
  resetPreviewWarningState,
  resolveQueueItemMediaPath,
  resolvedBibleEntryForItem,
  restoreCountdownForLiveMedia,
  restoreNonPptxPreviewSurface,
  selectNavigationForQueueItem,
  setMediaCountdownOverlayVisible,
  setMediaCountdownText,
  setSharedRendererState,
  showBibleWorkspace,
  showSlidesWorkspace,
  showSongsWorkspace,
  startTime,
  stopLiveAudioPresentation,
  stopNetworkPreviewRtcCapture,
  stopPreviewAudioCue,
  syncGtkSliderToCueState,
  syncMediaLoopState,
  syncPlayPauseIconToControlMedia,
  syncPreviewAudioTrackState,
  targetTime,
  updatePreviewCueUI,
  updateQueueFileLabel,
  video,
} from "./app-renderer.mjs";

const videoPosterRequestIds = new WeakMap();

const videoPosterSourcePaths = new WeakMap();

let nextVideoPosterRequestId = 1;

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

function resetPreviewSurfaceToEmptyState() {
  stopNetworkPreviewRtcCapture();
  resetNetworkPreviewStatus();
  setSharedRendererState({ networkPreviewMirrorSource: "" });
  setSharedRendererState({ networkPreviewMirrorLiveEdge: false });
  setSharedRendererState({ networkPreviewCueLiveEdge: false });
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
    setSharedRendererState({ video: previewVideo });
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

  setSharedRendererState({ mediaFile: "" });
  setSharedRendererState({ prePathname: "" });
  setSharedRendererState({ startTime: 0 });
  setSharedRendererState({ targetTime: 0 });
  setSharedRendererState({ audioOnlyFile: false });
  setSharedRendererState({ playingMediaAudioOnly: false });
  setSharedRendererState({ localTimeStampUpdateIsRunning: false });
  mediaPlayerInputState.clear();
  setMediaCountdownText("");
  setSharedRendererState({ pendingCueVolume: null });
  setSharedRendererState({ cueVolumeDirty: false });
  setMediaCountdownOverlayVisible(false);
  document
    .getElementById("customControls")
    ?.style.setProperty("visibility", "hidden");
  removeFilenameFromTitlebar();
  syncGtkSliderToCueState();
  updatePreviewCueUI();
  updatePreviewEmptyState();
}

function currentPreviewSourcePath() {
  const src = video?.src || "";
  return mediaFile || mediaElementComparableSource(video);
}

function previewElementSourceMatchesMediaFile(
  sourcePath = mediaElementComparableSource(video),
  filePath = mediaFile,
) {
  if (!filePath) return !sourcePath;
  if (networkPreviewRepresentsMediaFile(filePath)) return true;
  return normalizeMediaPathForCompare(sourcePath) === normalizeMediaPathForCompare(filePath);
}

function previewMediaSourcePath() {
  if (activePreviewResolvedMediaFile) return activePreviewResolvedMediaFile;
  if (activeResolvedMediaFile) return activeResolvedMediaFile;
  return mediaFile;
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
    setSharedRendererState({ activePreviewResolvedMediaFile: resolvedPath });
    const cacheBust = queueItemMediaCacheBust(previewItem);
    handleMediaPlayback(isImgFile, resolvedPath, cacheBust);
    handleImageDisplay(isImgFile, document.querySelector("img#preview"), resolvedPath, cacheBust);
    return;
  }
  handleMediaPlayback(isImgFile);
  handleImageDisplay(isImgFile, document.querySelector("img#preview"));
}

function clearVideoPoster(mediaEl) {
  if (!mediaEl) return;
  videoPosterRequestIds.set(mediaEl, nextVideoPosterRequestId++);
  videoPosterSourcePaths.delete(mediaEl);
  mediaEl.removeAttribute("poster");
}

async function applyVideoPoster(mediaEl, sourcePath) {
  if (!mediaEl || !sourcePath || isNetworkStreamSource(sourcePath)) {
    clearVideoPoster(mediaEl);
    return;
  }
  if (videoPosterSourcePaths.get(mediaEl) === sourcePath) return;
  const requestId = nextVideoPosterRequestId++;
  videoPosterRequestIds.set(mediaEl, requestId);
  videoPosterSourcePaths.set(mediaEl, sourcePath);
  mediaEl.removeAttribute("poster");
  try {
    const poster = await invoke("generate-video-poster", sourcePath);
    if (videoPosterRequestIds.get(mediaEl) !== requestId) return;
    if (!poster?.ok || typeof poster.output !== "string" || !poster.output) {
      videoPosterSourcePaths.delete(mediaEl);
      return;
    }
    const cacheVersion = Number.isFinite(poster.mtime) ? String(poster.mtime) : undefined;
    mediaEl.poster = pathToMediaUrl(poster.output, cacheVersion);
  } catch (error) {
    if (videoPosterRequestIds.get(mediaEl) === requestId) {
      videoPosterSourcePaths.delete(mediaEl);
      console.warn("Failed to generate video poster:", error);
    }
  }
}

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

function queueItemUsesWorkspacePreview(item) {
  return Boolean(
    item &&
      (isQueueItemBible(item) ||
        isQueueItemDeck(item) ||
        isQueueItemSong(item) ||
        isQueueItemPptx(item)),
  );
}

async function restoreWorkspacePreviewForQueueItem(item, options = {}) {
  if (!queueItemUsesWorkspacePreview(item)) return false;
  selectNavigationForQueueItem(item);

  const token = Number.isFinite(options.previewLoadToken)
    ? options.previewLoadToken
    : nextPreviewLoadToken();
  const startTime =
    typeof options.startTime === "number" && Number.isFinite(options.startTime)
      ? options.startTime
      : queueItemCueStartTime(item);

  setSharedRendererState({ mediaFile: item.path });
  mediaPlayerInputState.filePaths = [item.path];
  updateQueueFileLabel(item.name);

  if (options.preserveCue !== true) {
    commitActiveCueVolume();
    setSharedRendererState({ previewCueIndex: -1 });
    setSharedRendererState({ pendingCueVolume: null });
    setSharedRendererState({ cueVolumeDirty: false });
    syncGtkSliderToCueState();
  }

  stopPreviewAudioCue();
  clearVideoPreviewCueOverlay();
  setMediaCountdownOverlayVisible(false);
  setMediaCountdownText("");

  await loadQueueItemIntoControlWindow(item, {
    previewLoadToken: token,
    preservePreviewSeek: false,
    pptxStartSlide: isQueueItemPptx(item)
      ? Number.isFinite(options.pptxStartSlide)
        ? options.pptxStartSlide
        : pptxStartSlideForItem(item)
      : undefined,
    startTime,
  });

  if (!isCurrentPreviewLoad(token)) return true;

  if (isQueueItemBible(item)) {
    showBibleWorkspace();
  } else if (isQueueItemDeck(item)) {
    showSlidesWorkspace();
  } else if (isQueueItemSong(item)) {
    showSongsWorkspace();
  }

  document
    .getElementById("customControls")
    ?.style.setProperty("visibility", "hidden");
  syncMediaLoopState({ notify: false });
  updatePreviewCueUI();
  renderQueue();
  return true;
}

async function restorePreviewToLiveOutput(index) {
  if (index < 0 || index >= mediaQueue.length) return;
  const item = mediaQueue[index];
  selectNavigationForQueueItem(item);
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
    setSharedRendererState({ mediaFile: item.path });
    mediaPlayerInputState.filePaths = [item.path];
    updateQueueFileLabel(item.name);
    commitActiveCueVolume();
    setSharedRendererState({ previewCueIndex: -1 });
    setSharedRendererState({ pendingCueVolume: null });
    setSharedRendererState({ cueVolumeDirty: false });
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
    setSharedRendererState({ mediaFile: item.path });
    mediaPlayerInputState.filePaths = [item.path];
    updateQueueFileLabel(item.name);
    commitActiveCueVolume();
    setSharedRendererState({ previewCueIndex: -1 });
    setSharedRendererState({ pendingCueVolume: null });
    setSharedRendererState({ cueVolumeDirty: false });
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
    setSharedRendererState({ mediaFile: item.path });
    mediaPlayerInputState.filePaths = [item.path];
    updateQueueFileLabel(item.name);
    commitActiveCueVolume();
    setSharedRendererState({ previewCueIndex: -1 });
    setSharedRendererState({ pendingCueVolume: null });
    setSharedRendererState({ cueVolumeDirty: false });
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
    setSharedRendererState({ mediaFile: item.path });
    mediaPlayerInputState.filePaths = [item.path];
    updateQueueFileLabel(item.name);
    commitActiveCueVolume();
    setSharedRendererState({ previewCueIndex: -1 });
    setSharedRendererState({ pendingCueVolume: null });
    setSharedRendererState({ cueVolumeDirty: false });
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
  setSharedRendererState({ previewCueIndex: -1 });
  setSharedRendererState({ pendingCueVolume: null });
  setSharedRendererState({ cueVolumeDirty: false });
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

  refreshPreviewControlsForCurrentMedia();
}

export {
  applyVideoPoster,
  clearVideoPoster,
  currentPreviewSourcePath,
  currentQueuePreviewItem,
  installPreviewEmptyStateHandlers,
  nextVideoPosterRequestId,
  previewElementSourceMatchesMediaFile,
  previewMediaSourcePath,
  previewStackElement,
  queueItemOwnsControlPreview,
  queueItemUsesWorkspacePreview,
  resetPreviewSurfaceToEmptyState,
  restorePreviewToLiveOutput,
  restoreStagedPreviewPlayback,
  restoreWorkspacePreviewForQueueItem,
  setPreviewStackSurface,
  syncPreviewStackSurface,
  syncQueuePreviewMediaElements,
  updatePreviewEmptyState,
  videoPosterRequestIds,
  videoPosterSourcePaths,
};
