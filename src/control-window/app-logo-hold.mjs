/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/*
 * Logo hold, output-hold recovery, and staged playback under hold.
 */

import {
  __dirname,
  STREAMPLAYER,
  activeMediaWindowContentType,
  applyLowerThirdOutputPreferences,
  applyOutputHoldPreferences,
  bibleLowerThirdOutputActive,
  classifyQueueMediaType,
  configureOutputHold,
  confirmLiveSwitchAccepted,
  currentDeck,
  currentMode,
  currentWorkspaceSong,
  ensurePendingMediaUpdateApproved,
  hasLiveAudienceTextPresentation,
  invoke,
  isActiveMediaWindow,
  isActiveMediaWindowCache,
  isAnyAudienceHoldActive,
  isBibleLowerThirdFeatureEnabled,
  isLiveStream,
  isPlaying,
  isQueueItemAudio,
  isQueuePlaying,
  itc,
  liveTextClearActive,
  loadQueueItemIntoPreviewCue,
  logoHoldOnlyPresentation,
  logoHoldStagedPlayback,
  mediaQueue,
  outputHoldRecoveryGeneration,
  pathToMediaUrl,
  playLivePreviewMirrorSafely,
  queueIndexForCurrentDeck,
  queueIndexForCurrentWorkspaceSong,
  queueIndexIsCurrentLivePresentation,
  queueIndexMatchesCurrentLiveOutput,
  queueItemCueStartTime,
  queueItemSupportsCueStartTime,
  resetAudienceOutputHold,
  restoreLiveBibleText,
  restoreLiveSongText,
  selectDeckPage,
  selectSongSection,
  send,
  setSelectedQueueAnchor,
  setSharedRendererState,
  showGnomeToast,
  showSongTextNow,
  slipstreamQueueItemAtIndex,
  startTime,
  syncActiveScheduledSongPresentation,
  syncAudienceOutputHoldAfterPresentationStart,
  takeQueueItemLive,
  updateClearLiveTextButtonState,
  updateDynUI,
  updateOutputHoldButtonStates,
  userStopPresentationPending,
} from "./app-renderer.mjs";

function configureOutputHoldBridge() {
  configureOutputHold({
    send: (...args) => send(...args),
    isActiveMediaWindow: () => isActiveMediaWindow(),
    showGnomeToast: (...args) => showGnomeToast(...args),
    pathToMediaUrl: (...args) => pathToMediaUrl(...args),
    startLogoHoldPresentation: () => startLogoHoldOnlyPresentation(),
    onLogoHoldDeactivated: () => handleLogoHoldDeactivated(),
  });
}

async function startLogoHoldOnlyPresentation() {
  const displaySelectEl =
    currentMode === STREAMPLAYER
      ? document.getElementById("dspSelctStreams")
      : document.getElementById("dspSelct");
  const selectedDisplay = displaySelectEl?.value || null;
  if (!selectedDisplay) {
    showGnomeToast("Choose an audience output display");
    return false;
  }

  const ts = await invoke("get-system-time");
  const perfNow = performance.now() * 0.001;
  const birth =
    ts.systemTime +
    (Date.now() - ts.ipcTimestamp) * 0.001 +
    (perfNow - (Number.isFinite(itc) ? itc : perfNow)) +
    "";

  const windowOptions = {
    webPreferences: {
      v8CacheOptions: "bypassHeatCheckAndEagerCompile",
      contextIsolation: true,
      sandbox: true,
      enableWebSQL: false,
      webgl: false,
      skipTaskbar: true,
      additionalArguments: ["__logoHoldOnly=true", birth],
      preload: `${__dirname}/../media-window/media_preload.min.js`,
      devTools: true,
    },
  };

  setSharedRendererState({ logoHoldOnlyPresentation: true });
  setSharedRendererState({ logoHoldStagedPlayback: false });
  setSharedRendererState({ isActiveMediaWindowCache: true });
  setSharedRendererState({ activeMediaWindowContentType: "logo-hold" });
  setSharedRendererState({ isPlaying: true });
  setSharedRendererState({ isQueuePlaying: false });

  try {
    const windowId = await invoke("create-media-window", windowOptions, selectedDisplay);
    if (!windowId) {
      setSharedRendererState({ logoHoldOnlyPresentation: false });
      setSharedRendererState({ isActiveMediaWindowCache: false });
      setSharedRendererState({ activeMediaWindowContentType: null });
      setSharedRendererState({ isPlaying: false });
      return false;
    }
    updateOutputHoldButtonStates();
    updateDynUI();
    return true;
  } catch (err) {
    setSharedRendererState({ logoHoldOnlyPresentation: false });
    setSharedRendererState({ isActiveMediaWindowCache: false });
    setSharedRendererState({ activeMediaWindowContentType: null });
    setSharedRendererState({ isPlaying: false });
    throw err;
  }
}

async function handleLogoHoldDeactivated() {
  if (logoHoldStagedPlayback) {
    setSharedRendererState({ logoHoldStagedPlayback: false });
    setSharedRendererState({ logoHoldOnlyPresentation: false });
    await resumeStagedPresentationAfterLogoHold();
    return;
  }
  if (logoHoldOnlyPresentation) {
    setSharedRendererState({ logoHoldOnlyPresentation: false });
    setSharedRendererState({ isPlaying: false });
    setSharedRendererState({ userStopPresentationPending: true });
    send("close-media-window", 0);
    updateDynUI();
  }
}

async function resumeStagedPresentationAfterLogoHold() {
  if (activeMediaWindowContentType === "video") {
    await send("play-ctl", "play");
    await playLivePreviewMirrorSafely("logo hold release");
  }
  setSharedRendererState({ isPlaying: true });
  setSharedRendererState({ isQueuePlaying: true });
  updateDynUI();
}

async function prepareQueueItemUnderLogoHold(index) {
  if (index < 0 || index >= mediaQueue.length) return;
  const stagingGeneration = outputHoldRecoveryGeneration;
  if (!(await ensurePendingMediaUpdateApproved(index))) return;
  if (stagingGeneration !== outputHoldRecoveryGeneration) return;
  setSelectedQueueAnchor(index);

  const item = mediaQueue[index];
  if (isLiveStream(item.path)) {
    showGnomeToast("Live streams cannot be staged under logo hold");
    await loadQueueItemIntoPreviewCue(index);
    return;
  }
  if (
    isQueueItemAudio(item) ||
    classifyQueueMediaType(item.path) === "audio"
  ) {
    showGnomeToast("Audio items cannot be staged under logo hold");
    await loadQueueItemIntoPreviewCue(index);
    return;
  }

  await loadQueueItemIntoPreviewCue(index);
  if (stagingGeneration !== outputHoldRecoveryGeneration) return;
  const switched = await slipstreamQueueItemAtIndex(index, {
    startTime: queueItemCueStartTime(item),
    clearCue: false,
    underLogoHold: true,
  });
  if (stagingGeneration !== outputHoldRecoveryGeneration) return;
  if (!switched) {
    showGnomeToast("Could not stage item under logo hold");
    return;
  }
  setSharedRendererState({ logoHoldStagedPlayback: true });
  setSharedRendererState({ logoHoldOnlyPresentation: false });
  syncAudienceOutputHoldAfterPresentationStart();
}

function hasActiveOutputRecoveryState() {
  return (
    liveTextClearActive ||
    isAnyAudienceHoldActive() ||
    logoHoldStagedPlayback
  );
}

async function releaseOutputHoldsForRecovery() {
  setSharedRendererState({ outputHoldRecoveryGeneration: outputHoldRecoveryGeneration + (1) });
  let changed = false;
  if (liveTextClearActive) {
    const hasBibleText =
      hasLiveAudienceTextPresentation("bible") ||
      (isBibleLowerThirdFeatureEnabled() && bibleLowerThirdOutputActive);
    const hasSongText = hasLiveAudienceTextPresentation("song");
    if (hasBibleText) {
      changed = (await restoreLiveBibleText({ quiet: true })) || changed;
    }
    if (hasSongText) {
      changed = (await restoreLiveSongText({ quiet: true })) || changed;
    }
    setSharedRendererState({ liveTextClearActive: false });
    updateClearLiveTextButtonState();
    changed = true;
  }
  if (isAnyAudienceHoldActive() || logoHoldStagedPlayback) {
    setSharedRendererState({ logoHoldStagedPlayback: false });
    setSharedRendererState({ logoHoldOnlyPresentation: false });
    resetAudienceOutputHold({ quiet: true, force: true });
    changed = true;
  }
  return changed;
}

async function releaseOutputHoldsAndGoLiveQueueIndex(index, startTime = 0) {
  if (index < 0 || index >= mediaQueue.length) return;
  if (!(await ensurePendingMediaUpdateApproved(index))) return;
  const item = mediaQueue[index];
  const isCurrentLiveItem =
    queueIndexIsCurrentLivePresentation(index) ||
    queueIndexMatchesCurrentLiveOutput(index);
  if (!isCurrentLiveItem && !confirmLiveSwitchAccepted(item)) return;

  await releaseOutputHoldsForRecovery();
  setSelectedQueueAnchor(index);
  const itemStart =
    queueItemSupportsCueStartTime(item) && Number.isFinite(startTime) && startTime > 0
      ? startTime
      : queueItemCueStartTime(item);
  await takeQueueItemLive(index, itemStart, { skipLogoHoldPrep: true });
}

async function recoverOutputHoldsToSongSection(sectionId, options = {}) {
  if (!currentWorkspaceSong || !sectionId) return false;
  const hadRecovery = hasActiveOutputRecoveryState();
  await releaseOutputHoldsForRecovery();
  await selectSongSection(sectionId, {
    syncLive: false,
    sequenceEntryId: options.sequenceEntryId,
    slideId: options.slideId,
  });
  const queueIndex = queueIndexForCurrentWorkspaceSong();
  if (queueIndex >= 0) {
    if (hadRecovery || !queueIndexIsCurrentLivePresentation(queueIndex)) {
      await takeQueueItemLive(queueIndex, 0, { skipLogoHoldPrep: true });
    } else {
      await syncActiveScheduledSongPresentation();
    }
    return true;
  }
  if (hadRecovery || !hasLiveAudienceTextPresentation("song")) {
    if (hasLiveAudienceTextPresentation("song")) {
      await syncActiveScheduledSongPresentation();
    } else {
      await showSongTextNow();
    }
  }
  return true;
}

async function recoverOutputHoldsToDeckPage(pageId) {
  if (!currentDeck || !pageId) return false;
  const hadRecovery = hasActiveOutputRecoveryState();
  await releaseOutputHoldsForRecovery();
  selectDeckPage(pageId);
  const queueIndex = queueIndexForCurrentDeck();
  if (queueIndex >= 0 && (hadRecovery || !queueIndexIsCurrentLivePresentation(queueIndex))) {
    await takeQueueItemLive(queueIndex, 0, { skipLogoHoldPrep: true });
  }
  return true;
}

async function loadOutputHoldPreferencesFromSettings() {
  try {
    const prefs = await invoke("get-output-hold-preferences");
    applyOutputHoldPreferences(prefs);
    applyLowerThirdOutputPreferences(prefs);
  } catch (err) {
    console.error("Failed to load output hold preferences:", err);
  }
}

export {
  configureOutputHoldBridge,
  handleLogoHoldDeactivated,
  hasActiveOutputRecoveryState,
  loadOutputHoldPreferencesFromSettings,
  prepareQueueItemUnderLogoHold,
  recoverOutputHoldsToDeckPage,
  recoverOutputHoldsToSongSection,
  releaseOutputHoldsAndGoLiveQueueIndex,
  releaseOutputHoldsForRecovery,
  resumeStagedPresentationAfterLogoHold,
  startLogoHoldOnlyPresentation,
};
