/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/*
 * Project save/load/autosave, snapshots, relinking, and preflight checks.
 */

import {
  MEDIAPLAYER,
  OUTPUT_HOLD_TRANSITION_MS,
  appliedPresentationTheme,
  applyOutputHoldPreferences,
  applyPinnedMediaSource,
  bibleDesignerState,
  bibleQueuePath,
  bibleStyleDirtyState,
  classifyQueueMediaType,
  currentMode,
  currentQueueIndex,
  deckQueuePath,
  deckToTransientSong,
  fallbackUnavailableBibleTranslationsOnLoad,
  generateProjectGuid,
  getOutputHoldLogoSettings,
  getPathForFile,
  invoke,
  isBiblePath,
  isFileBackedMediaPath,
  isNetworkStreamSource,
  isQueueItemBible,
  isQueueItemSong,
  isQueueItemTransitionCapable,
  isQueuePresentationActive,
  isSongPath,
  liveSourcePinnedModifiedTime,
  loadQueueItemIntoControlWindow,
  loadQueueItemIntoPreviewCue,
  loopEnabledForQueueItem,
  mediaPathSupportsLoop,
  mediaPinPayloadForItem,
  mediaQueue,
  nextPreviewLoadToken,
  normalizeItemSlideTransitionOverride,
  normalizeItemTheme,
  normalizeLiveSource,
  normalizeOutputHoldPreferences,
  normalizeProjectGuid,
  normalizeSlideDeck,
  overridesFromProjectScriptureText,
  parseBibleQueuePath,
  parseDeckQueuePath,
  parseSongQueuePath,
  previewCueIndex,
  previewLoadToken,
  projectBibleQueueName,
  projectBibleReferenceEntryForQueueItem,
  projectBibleReferenceOnlyEntry,
  projectScriptureOverrides,
  projectScriptureTextFromOverrides,
  projectStageConfig,
  projectThemeDefaults,
  queueBasename,
  queueIndexInRange,
  queueItemCueStartTime,
  queueItemLiveSource,
  queueItemUsesPackagedMedia,
  refreshMissingFlagsAndWarn,
  renderQueue,
  resolvedBibleStyleDefaults,
  restoreOperatingMode,
  scheduleMediaWatchSync,
  selectedQueueAnchorIndex,
  send,
  setSharedRendererState,
  showGnomeToast,
  songQueuePath,
  stageContentCache,
  syncBibleStyleControlsFromState,
  syncCurrentPptxSlideForProjectSnapshot,
  updateDynUI,
  updatePreviewCueUI,
} from "./app-renderer.mjs";

const PROJECT_SCHEMA_VERSION = 2;

const AUTOSAVE_WRITE_DEBOUNCE_MS = 300;

const PROJECT_GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let autosaveWriteTimer = null;

let currentProjectPath = "";

let currentProjectStorageMode = "working";

let currentProjectGuid = generateProjectGuid();

let currentProjectCreated = new Date().toISOString();

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

function restoredQueueMediaType(savedType, itemPath) {
  if (["video", "audio", "image", "pptx", "file"].includes(savedType)) {
    return savedType;
  }
  return classifyQueueMediaType(itemPath);
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
    presentationId:
      bibleEntry && typeof item.presentationId === "string"
        ? item.presentationId
        : undefined,
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
    networkSource:
      !bibleEntry && !songEntry && item.networkSource && typeof item.networkSource === "object"
        ? { ...item.networkSource }
        : undefined,
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
    itemTheme: normalizeItemTheme(item.itemTheme || bibleEntry?.itemTheme),
  };
}

function buildProjectOutputHoldSnapshot() {
  const settings = getOutputHoldLogoSettings();
  return {
    logoPath: settings.logoPath,
    logoFit: settings.logoFit,
    logoBackground: settings.logoBackground,
    holdTransitionDurationMs: OUTPUT_HOLD_TRANSITION_MS,
  };
}

function buildProjectOutputsSnapshot() {
  setSharedRendererState({ projectStageConfig: {
    display: document.getElementById("stageDisplaySelect")?.value || projectStageConfig.display || "",
    profile: document.getElementById("stageProfileSelect")?.value || projectStageConfig.profile || "current-next",
  } });
  return {
    schema: "ems.project-outputs.v1",
    stage: {
      ...projectStageConfig,
    },
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
    projectThemes: projectThemeDefaults,
    projectOutputHold: buildProjectOutputHoldSnapshot(),
    projectOutputs: buildProjectOutputsSnapshot(),
    currentMode,
    currentQueueIndex,
    previewCueIndex,
    mediaQueue: mediaQueue.map(buildProjectQueueItemSnapshot),
  };
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
  if (state.projectThemes && typeof state.projectThemes === "object") {
    setSharedRendererState({ projectThemeDefaults: structuredClone(state.projectThemes) });
    const preferredId = projectThemeDefaults.bindings?.song || projectThemeDefaults.bindings?.scripture;
    const embedded = preferredId ? projectThemeDefaults.snapshots?.[preferredId]?.theme : null;
    if (embedded) setSharedRendererState({ appliedPresentationTheme: embedded });
  }
  if (state.projectOutputHold && typeof state.projectOutputHold === "object") {
    applyOutputHoldPreferences(normalizeOutputHoldPreferences(state.projectOutputHold));
  }
  if (state.projectOutputs?.stage) {
    const profile = ["current-only", "current-next", "notes", "clock"].includes(state.projectOutputs.stage.profile)
      ? state.projectOutputs.stage.profile
      : "current-next";
    stageContentCache.profile = profile;
    setSharedRendererState({ projectStageConfig: {
      display: String(state.projectOutputs.stage.display || ""),
      profile,
    } });
    const profileSelect = document.getElementById("stageProfileSelect");
    if (profileSelect) profileSelect.value = profile;
    const displaySelect = document.getElementById("stageDisplaySelect");
    if (displaySelect && projectStageConfig.display) displaySelect.value = projectStageConfig.display;
    if (projectStageConfig.display) send("set-stage-display-index", projectStageConfig.display);
  }
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
  setSharedRendererState({ mediaQueue: state.mediaQueue
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
      const mediaType = restoredQueueMediaType(x.type, itemPath);
      const item = {
        presentationId: bibleEntry
          ? typeof x.presentationId === "string" && x.presentationId.trim()
            ? x.presentationId
            : `scripture-${generateProjectGuid()}`
          : undefined,
        path: itemPath,
        name: itemName,
        type: bibleEntry ? "bible" : isSongItem ? (x.type === "deck" ? "deck" : "song") : mediaType,
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
              type: mediaType,
              originalPath:
                typeof x.originalPath === "string" && x.originalPath.length > 0
                  ? x.originalPath
                  : itemPath,
              mode: currentProjectStorageMode === "packed" ? "packaged" : undefined,
            })
          : undefined,
        networkSource:
          !bibleEntry && !isSongItem && x.networkSource && typeof x.networkSource === "object"
            ? { ...x.networkSource }
            : !bibleEntry && !isSongItem && isNetworkStreamSource(itemPath)
              ? { kind: "auto" }
              : undefined,
        autoAdvance: x.autoAdvance !== false,
        cueStartTime: bibleEntry || isSongItem ? 0 : Number.isFinite(x.cueStartTime) ? x.cueStartTime : 0,
        cueVolume: Number.isFinite(x.cueVolume) ? x.cueVolume : undefined,
        loop: bibleEntry || isSongItem ? false : x.loop === true && mediaPathSupportsLoop(itemPath),
        pptxSlideIndex: Number.isFinite(x.pptxSlideIndex) && !bibleEntry && !isSongItem ? x.pptxSlideIndex : -1,
        transition: isQueueItemTransitionCapable({
          type: bibleEntry ? "bible" : isSongItem ? "song" : mediaType,
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
        itemTheme: normalizeItemTheme(x.itemTheme || x.bible?.itemTheme),
      };
      if (bibleEntry && item.itemTheme) item.bible.itemTheme = item.itemTheme;
      item.cueStartTime = queueItemCueStartTime(item);
      return item;
    })
    .filter(Boolean) });
  Object.assign(bibleDesignerState, resolvedBibleStyleDefaults());
  setSharedRendererState({ selectedQueueAnchorIndex: -1 });
  setSharedRendererState({ currentQueueIndex: Number.isInteger(state.currentQueueIndex) &&
    state.currentQueueIndex >= 0 &&
    state.currentQueueIndex < mediaQueue.length
      ? state.currentQueueIndex
      : -1 });
  setSharedRendererState({ previewCueIndex: Number.isInteger(state.previewCueIndex) &&
    state.previewCueIndex >= 0 &&
    state.previewCueIndex < mediaQueue.length
      ? state.previewCueIndex
      : -1 });
  if (
    currentMode === MEDIAPLAYER &&
    mediaQueue.length > 0 &&
    currentQueueIndex < 0 &&
    previewCueIndex < 0 &&
    !isQueuePresentationActive()
  ) {
    setSharedRendererState({ currentQueueIndex: 0 });
  }
  if (
    !isQueuePresentationActive() &&
    previewCueIndex >= 0 &&
    previewCueIndex === currentQueueIndex
  ) {
    setSharedRendererState({ previewCueIndex: -1 });
  }
  setSharedRendererState({ selectedQueueAnchorIndex: queueIndexInRange(previewCueIndex)
    ? previewCueIndex
    : queueIndexInRange(currentQueueIndex)
      ? currentQueueIndex
      : -1 });
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

export {
  AUTOSAVE_WRITE_DEBOUNCE_MS,
  PROJECT_GUID_RE,
  PROJECT_SCHEMA_VERSION,
  acknowledgePreflightWarningForItem,
  applyProjectStateSnapshot,
  autosaveWriteTimer,
  buildProjectOutputHoldSnapshot,
  buildProjectOutputsSnapshot,
  buildProjectQueueItemSnapshot,
  buildProjectStateSnapshot,
  cleanupStagingForCurrentProjectBeforeSwitch,
  currentProjectCreated,
  currentProjectGuid,
  currentProjectPath,
  currentProjectStorageMode,
  exportPortableProjectDialog,
  firstDroppedProjectPath,
  flushAutosaveOnClose,
  liveSourceSnapshotFields,
  openProjectByPath,
  openProjectDialog,
  pinQueueMediaSources,
  preflightWarningFingerprint,
  projectGuidFromState,
  projectSessionIsActive,
  queueItemCanKeepOldMediaVersion,
  queueItemFingerprintSnapshotFields,
  queueItemHasSafeSnapshotPin,
  queueItemHasStoredFileHash,
  queueItemNeedsDefaultSnapshotPin,
  queueItemPreflightCheckPayload,
  refreshBaselinesAfterSave,
  relinkMissingFilesDialog,
  resetCurrentProjectIdentity,
  restoreAutosavedProjectState,
  restoredQueueMediaType,
  saveCurrentProjectInStorageMode,
  saveProject,
  saveProjectAsDialog,
  scheduleAutosaveProjectState,
  stampBaselineForQueueItems,
  syncActiveProjectPathToMain,
};
