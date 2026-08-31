/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/*
 * Media loop controls, file-watch pinning, and pending media-update approval.
 */

import {
  acknowledgePreflightWarningForItem,
  activeMediaWindowContentType,
  classifyQueueMediaType,
  createLiveSource,
  currentPreviewCue,
  currentPreviewSourcePath,
  currentProjectGuid,
  currentProjectPath,
  currentQueueIndex,
  findQueueIndexByPath,
  invoke,
  isActiveMediaWindow,
  isAudioPreviewCueActive,
  isBiblePath,
  isEmbeddedScheduleItem,
  isFileBackedMediaPath,
  isImg,
  isLiveStream,
  isQueueItemBible,
  isQueueItemDeck,
  isQueueItemSong,
  isQueuePresentationActive,
  isSongPath,
  isVideoPreviewCueActive,
  liveAudio,
  liveAudioQueueIndex,
  loadQueueItemIntoControlWindow,
  mediaFile,
  mediaQueue,
  mediaWatchSyncTimer,
  normalizeLiveSource,
  normalizeMediaPathForCompare,
  pathToMediaUrl,
  pinQueueMediaSources,
  playingMediaAudioOnly,
  pptxRegex,
  preflightWarningFingerprint,
  previewAudio,
  previewCueIndex,
  previewCueVideo,
  queueIndexInRange,
  queueItemCanKeepOldMediaVersion,
  queueItemCueStartTime,
  queueItemForPath,
  queueItemHasSafeSnapshotPin,
  queueItemLiveSource,
  queueItemNeedsDefaultSnapshotPin,
  queueItemPreflightCheckPayload,
  renderQueue,
  repeatButton,
  scheduleAutosaveProjectState,
  selectedQueueAnchorIndex,
  selectedQueueIndexForDisplay,
  setMediaLoopEnabled,
  setSharedRendererState,
  showGnomeToast,
  slipstreamQueueItemAtIndex,
  stampBaselineForQueueItems,
  video,
  videoWrapper,
} from "./app-renderer.mjs";

const mediaLoopByPath = new Map();

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
    isEmbeddedScheduleItem(item) ||
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

function scheduleMediaWatchSync() {
  if (mediaWatchSyncTimer !== null) {
    clearTimeout(mediaWatchSyncTimer);
  }
  setSharedRendererState({ mediaWatchSyncTimer: setTimeout(() => {
    setSharedRendererState({ mediaWatchSyncTimer: null });
    void syncMediaWatches().catch((err) =>
      console.error("register-media-watches failed:", err),
    );
  }, 250) });
}

async function syncMediaWatches() {
  const watchItems = mediaQueue
    .map((item, index) => {
      if (isEmbeddedScheduleItem(item)) return null;
      const liveSource = queueItemLiveSource(item);
      if (!liveSource || liveSource.mode !== "linked") return null;
      const originalPath = liveSource.originalPath || item.path;
      if (!isFileBackedMediaPath(originalPath)) return null;
      return {
        queueItemId: String(index),
        originalPath,
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

function queueItemUsesPackagedMedia(item) {
  return queueItemLiveSource(item)?.mode === "packaged";
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
      setSharedRendererState({ selectedQueueAnchorIndex: queueIndexInRange(selectedQueueAnchorIndex)
        ? selectedQueueAnchorIndex
        : index });
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

async function refreshMissingFlagsAndWarn(opts = {}) {
  const warn = opts?.warn !== false;
  if (!Array.isArray(mediaQueue) || mediaQueue.length === 0) return;
  let embeddedPreflightStateCleared = false;
  for (const item of mediaQueue) {
    // Bible passages, songs, and native slide decks carry their presentation
    // content inside the project. Their original library/source path is not a
    // runtime dependency and must never make the schedule appear incomplete.
    if (
      !isQueueItemBible(item) &&
      !isQueueItemSong(item) &&
      !isQueueItemDeck(item)
    ) {
      continue;
    }
    embeddedPreflightStateCleared ||= Boolean(
      item.missing ||
        item.changedSinceSave ||
        item.pendingMediaUpdate ||
        item.lastPreflightWarningFingerprint,
    );
    item.missing = false;
    item.changedSinceSave = false;
    if (item.pendingMediaUpdate) {
      delete item.pendingMediaUpdate;
    }
    if (item.lastPreflightWarningFingerprint) {
      delete item.lastPreflightWarningFingerprint;
    }
  }
  if (embeddedPreflightStateCleared) {
    renderQueue();
    scheduleAutosaveProjectState();
  }
  const fileItems = mediaQueue
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) =>
        !isQueueItemBible(item) &&
        !isQueueItemSong(item) &&
        !isQueueItemDeck(item),
    );
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

function loopCtlHandler(event) {
  setMediaLoopEnabled(event.target.checked);
  event.target.checked = loopTargetEnabled(loopControlTarget());
}

export {
  activeMediaWindowSupportsLoop,
  applyLoopStateToPreviewMedia,
  applyMediaUpdateMissingFlag,
  applyPinnedMediaSource,
  approvePendingMediaUpdate,
  ensurePendingMediaUpdateApproved,
  keepPendingMediaUpdate,
  liveLoopTarget,
  liveSourcePinnedModifiedTime,
  loopControlTarget,
  loopCtlHandler,
  loopEnabledForLiveMedia,
  loopEnabledForMediaPath,
  loopEnabledForQueueItem,
  loopTargetEnabled,
  loopTargetSupportsLoop,
  markQueueItemMediaUpdate,
  mediaLoopByPath,
  mediaLoopKey,
  mediaPathSupportsLoop,
  mediaPinPayloadForItem,
  mediaReadPayloadForPath,
  mediaUpdatePayloadQueueItemIds,
  mediaUpdateWarningFingerprint,
  notifyMediaWindowLoopState,
  pathLoopTarget,
  pendingMediaUpdateMatches,
  pendingMediaUpdateStatus,
  queueItemMediaCacheBust,
  queueItemNeedsPendingUpdateApproval,
  queueItemSupportsLoop,
  queueItemUsesPackagedMedia,
  queueLoopTarget,
  refreshMissingFlagsAndWarn,
  resolveQueueItemMediaPath,
  resolveQueueMediaPathByPath,
  scheduleMediaWatchSync,
  setLoopTargetEnabled,
  shouldPreserveReadyMediaUpdate,
  stagedMediaUrlForItem,
  syncMediaLoopState,
  syncMediaWatches,
  updateLoopControlState,
};
