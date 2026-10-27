import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const presentationPlayback = await readFile(
  new URL("../src/control-window/app-presentation-playback.mjs", import.meta.url),
  "utf8",
);
const operatorChrome = await readFile(
  new URL("../src/control-window/app-operator-chrome.mjs", import.meta.url),
  "utf8",
);
const bibleWorkspace = await readFile(
  new URL("../src/control-window/app-bible-workspace.mjs", import.meta.url),
  "utf8",
);
const songWorkspace = await readFile(
  new URL("../src/control-window/app-song-slides-workspace.mjs", import.meta.url),
  "utf8",
);
const mediaLoop = await readFile(
  new URL("../src/control-window/app-media-loop.mjs", import.meta.url),
  "utf8",
);
const mediaRuntime = await readFile(
  new URL("../src/control-window/app-media-runtime.mjs", import.meta.url),
  "utf8",
);
const previewSurfaces = await readFile(
  new URL("../src/control-window/app-preview-surfaces.mjs", import.meta.url),
  "utf8",
);
const logoHold = await readFile(
  new URL("../src/control-window/app-logo-hold.mjs", import.meta.url),
  "utf8",
);
const renderer = await readFile(
  new URL("../src/control-window/app-renderer.mjs", import.meta.url),
  "utf8",
);
const projectSession = await readFile(
  new URL("../src/control-window/app-project-session.mjs", import.meta.url),
  "utf8",
);
const scheduleController = await readFile(
  new URL("../src/control-window/app-schedule-controller.mjs", import.meta.url),
  "utf8",
);
const previewController = await readFile(
  new URL("../src/control-window/app-preview-controller.mjs", import.meta.url),
  "utf8",
);
const liveOutputs = await readFile(
  new URL("../src/control-window/app-live-outputs.mjs", import.meta.url),
  "utf8",
);
const mediaWindow = await readFile(
  new URL("../src/media-window/media.mjs", import.meta.url),
  "utf8",
);

function functionSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return source.slice(start, end);
}

test("preview cue ownership follows the selected item through reordering", () => {
  const helperMatch = presentationPlayback.match(
    /^function previewCueIndexForItem\([^]*?^\}/m,
  );
  assert.ok(helperMatch, "preview cue ownership helper exists");

  const before = { id: "before" };
  const target = { id: "target" };
  const context = vm.createContext({
    mediaQueue: [before, target],
    previewCueIndex: 1,
    isCurrentPreviewLoad: (token) => token === 7,
    target,
  });
  vm.runInContext(helperMatch[0], context);

  assert.equal(vm.runInContext("previewCueIndexForItem(target, 7)", context), 1);
  vm.runInContext("mediaQueue.splice(0, 2, target, mediaQueue[0]); previewCueIndex = 0", context);
  assert.equal(
    vm.runInContext("previewCueIndexForItem(target, 7)", context),
    0,
    "the same cue remains current at its new index",
  );
  assert.equal(
    vm.runInContext("previewCueIndexForItem(target, 6)", context),
    -1,
    "an obsolete load token cannot reclaim the cue",
  );
});

test("all asynchronous cue loaders validate item identity instead of the original index", () => {
  const cueLoader = functionSource(
    presentationPlayback,
    "async function loadQueueItemIntoPreviewCue(",
    "async function takeQueueItemLive(",
  );
  const videoLoader = functionSource(
    presentationPlayback,
    "async function loadVideoQueueItemIntoPreviewCueOverlay(",
    "function installPreviewCueVideoHandlers(",
  );
  const audioLoader = functionSource(
    presentationPlayback,
    "async function loadAudioQueueItemIntoPreviewCue(",
    "function clearVideoPreviewCueOverlay(",
  );

  assert.doesNotMatch(cueLoader, /previewCueIndex !== index/);
  assert.doesNotMatch(videoLoader, /previewCueIndex !== index/);
  assert.doesNotMatch(audioLoader, /previewCueIndex !== index/);
  assert.match(cueLoader, /previewCueIndexForItem\(item, token\)/);
  assert.match(videoLoader, /previewCueIndexForItem\(item, token\)/);
  assert.match(audioLoader, /previewCueIndexForItem\(item, token\)/);
  assert.match(videoLoader, /setCueStartTime\(committedIndex, actualStart\)/);
  assert.match(audioLoader, /setCueStartTime\(committedIndex, actualStart\)/);
});

test("item theme changes reload the surface that owns the item", () => {
  const ipcHandlers = functionSource(
    operatorChrome,
    "function installIPCHandler(",
    "function updateDynUI(",
  );
  const refreshStart = ipcHandlers.indexOf("const refreshThemedQueueItemPreview");
  const refreshEnd = ipcHandlers.indexOf('on("theme-applied-to-item"', refreshStart);
  const refresh = ipcHandlers.slice(refreshStart, refreshEnd);
  const clearStart = ipcHandlers.indexOf('on("theme-cleared-from-item"');
  const clearEnd = ipcHandlers.indexOf('on("songs-database-cleared"', clearStart);
  const clearHandler = ipcHandlers.slice(clearStart, clearEnd);

  assert.match(refresh, /index === previewCueIndex[\s\S]*?loadQueueItemIntoPreviewCue\(index\)/);
  assert.match(refresh, /index === currentQueueIndex[\s\S]*?loadQueueItemIntoControlWindow\(item/);
  assert.match(clearHandler, /refreshThemedQueueItemPreview\(index, mediaQueue\[index\]\)/);
});

test("standalone Scripture, song, and deck slipstreams use managed playback activation", () => {
  const bibleSlipstream = functionSource(
    bibleWorkspace,
    "async function slipstreamBiblePresentation(",
    "async function syncLiveBiblePresentation(",
  );
  const songSlipstream = functionSource(
    songWorkspace,
    "async function slipstreamSongTextToOutput(",
    "function liveSongAudienceTextMessageForClear(",
  );

  assert.match(bibleSlipstream, /activateAudienceSlipstream\(/);
  assert.match(songSlipstream, /activateAudienceSlipstream\(/);
  assert.doesNotMatch(bibleSlipstream, /await invoke\("slipstream-media-window"/);
  assert.doesNotMatch(songSlipstream, /await invoke\("slipstream-media-window"/);
});

test("Scripture splitting re-resolves item identity after its asynchronous work", () => {
  const split = functionSource(
    bibleWorkspace,
    "async function splitScheduledBiblePassageIntoVerses(",
    "\nexport {",
  );
  const finalLookup = split.lastIndexOf("mediaQueue.indexOf(originalItem)");
  const membershipCopy = split.indexOf("splitEntry.groupId = originalItem.groupId");
  const splice = split.indexOf("mediaQueue.splice(currentIndex");

  assert.ok(finalLookup > split.indexOf("await queueEntriesForBibleScheduleEntry"));
  assert.ok(membershipCopy > finalLookup);
  assert.ok(splice > membershipCopy);
  assert.ok(splice > finalLookup);
  assert.match(split, /hasOwnProperty\.call\(\s*originalItem,\s*"groupId"/);
  assert.match(split, /currentIndex === currentQueueIndex && isQueuePresentationActive\(\)/);
  assert.doesNotMatch(split, /mediaQueue\.splice\(index,/);
});

test("deferred schedule insertion follows its captured after-anchor", () => {
  const capture = functionSource(
    scheduleController,
    "function captureQueueInsertionPoint(",
    "function captureQueueInsertionPointAfterSelection(",
  );
  const resolve = functionSource(
    scheduleController,
    "function resolveQueueInsertionPoint(",
    "function extendQueueSelectionTo(",
  );
  const section = { id: "section" };
  const child = { id: "child" };
  const next = { id: "next" };
  const context = vm.createContext({
    mediaQueue: [section, child, next],
    section,
    child,
    next,
    Number,
    Math,
    Object,
  });
  vm.runInContext(`${capture}\n${resolve}`, context);
  vm.runInContext(
    'point = captureQueueInsertionPoint(2, { preference: "after" })',
    context,
  );
  vm.runInContext("mediaQueue.splice(0, 3, next, section, child)", context);

  assert.equal(vm.runInContext("resolveQueueInsertionPoint(point)", context), 3);
});

test("deferred schedule membership follows a captured section id", () => {
  const resolveGroup = functionSource(
    scheduleController,
    "function scheduleGroupIdForDropPlacement(",
    "function queueDropPlacementWithStableContext(",
  );
  const target = { id: "target", type: "section" };
  const other = { id: "other", type: "section" };
  const context = vm.createContext({
    mediaQueue: [other, target],
    isQueueItemSection: (item) => item?.type === "section",
    placement: { destinationGroupId: "target", sectionIndex: 0 },
  });
  vm.runInContext(resolveGroup, context);

  assert.equal(
    vm.runInContext("scheduleGroupIdForDropPlacement(placement)", context),
    "target",
  );
  vm.runInContext("mediaQueue.splice(1, 1)", context);
  assert.equal(
    vm.runInContext("scheduleGroupIdForDropPlacement(placement)", context),
    null,
  );
});

test("pending media refresh follows the item and reloads the surface that owns it", () => {
  const approve = functionSource(
    mediaLoop,
    "async function approvePendingMediaUpdate(",
    "function keepPendingMediaUpdate(",
  );
  const approval = approve.indexOf('await invoke("approve-media-refresh"');
  const currentLookup = approve.indexOf("mediaQueue.indexOf(item)", approval);

  assert.ok(currentLookup > approval);
  assert.match(approve, /slipstreamQueueItemAtIndex\(currentIndex/);
  assert.match(approve, /loadQueueItemIntoPreviewCue\(currentIndex\)/);
  assert.match(approve, /previewLoadToken: nextPreviewLoadToken\(\)/);
  assert.doesNotMatch(approve, /slipstreamQueueItemAtIndex\(index/);

  const ensureApproval = functionSource(
    mediaLoop,
    "async function ensurePendingMediaUpdateApproved(",
    "async function refreshMissingFlagsAndWarn(",
  );
  assert.match(ensureApproval, /mediaQueue\.indexOf\(item\)/);
  assert.match(ensureApproval, /approvePendingMediaUpdate\(currentIndex, item\)/);

  const takeLive = functionSource(
    presentationPlayback,
    "async function takeQueueItemLive(",
    "async function stopQueuePresentationUserClosed(",
  );
  assert.match(takeLive, /ensurePendingMediaUpdateApproved\(index, requestedItem\)/);
  assert.match(takeLive, /index = mediaQueue\.indexOf\(requestedItem\)/);

  const stageUnderHold = functionSource(
    logoHold,
    "async function prepareQueueItemUnderLogoHold(",
    "function hasActiveOutputRecoveryState(",
  );
  assert.match(stageUnderHold, /ensurePendingMediaUpdateApproved\(index, item\)/);
  assert.match(stageUnderHold, /index = mediaQueue\.indexOf\(item\)/);

  const switchLive = functionSource(
    renderer,
    "async function switchQueueItemLiveWithConfirmation(",
    "async function onQueueItemActivate(",
  );
  assert.match(switchLive, /ensurePendingMediaUpdateApproved\(index, item\)/);
  assert.match(switchLive, /index = mediaQueue\.indexOf\(item\)/);
});

test("preview image cleanup is scoped to the preview stack", () => {
  assert.doesNotMatch(mediaRuntime, /document\.querySelector\("img"\)/);
  assert.doesNotMatch(operatorChrome, /document\.querySelector\("img"\)/);
  assert.match(mediaRuntime, /document\.querySelector\("\.video-wrapper img#preview"\)/);
  assert.match(operatorChrome, /document\.querySelector\("\.video-wrapper img#preview"\)/);
});

test("staged preview restore cannot overwrite a newer selected item", () => {
  const restore = functionSource(
    previewSurfaces,
    "async function restoreStagedPreviewPlayback(",
    "function clearVideoPoster(",
  );
  const resolve = restore.indexOf("await resolveQueueItemMediaPath(previewItem)");
  const ownershipCheck = restore.indexOf("if (!requestStillOwnsPreview())", resolve);
  const commit = restore.indexOf("activePreviewResolvedMediaFile: resolvedPath");

  assert.match(restore, /nextPreviewLoadToken\(\)/);
  assert.match(restore, /currentQueuePreviewItem\(\) === previewItem/);
  assert.ok(resolve >= 0 && ownershipCheck > resolve && commit > ownershipCheck);

  const sync = functionSource(
    previewSurfaces,
    "async function syncQueuePreviewMediaElements(",
    "async function restoreStagedPreviewPlayback(",
  );
  assert.match(sync, /mediaQueue\.indexOf\(previewItem\)/);
  assert.match(sync, /previewItem,/);
});

test("missing-media relinking follows each original item through queue edits", () => {
  const relink = functionSource(
    projectSession,
    "async function relinkMissingFilesDialog(",
    "async function openProjectDialog(",
  );

  assert.match(relink, /missingItemTargets = new Map/);
  assert.match(relink, /const item = missingItemTargets\.get\(match\.index\)/);
  assert.match(relink, /const currentIndex = mediaQueue\.indexOf\(item\)/);
  assert.match(relink, /pinQueueMediaSources\(relinkedItems/);
  assert.doesNotMatch(relink, /mediaQueue\[match\.index\]/);
});

test("scheduled song saves retain the edited queue item instead of its old index", () => {
  const save = functionSource(
    songWorkspace,
    "async function saveCurrentDeck(",
    "function resetCurrentSongToThemeDefault(",
  );

  assert.match(save, /const previous = currentSongThemeEditingContext\.queueItem/);
  assert.match(save, /const index = mediaQueue\.indexOf\(previous\)/);
  assert.match(save, /Object\.assign\(previous, updated\)/);
  assert.match(save, /currentSongThemeEditingContext\.queueItem = previous/);
  assert.doesNotMatch(save, /currentSongThemeEditingContext\.queueIndex/);
  assert.match(songWorkspace, /queueItem: currentSongQueueItem/);
});

test("next scheduled Scripture resolves and takes the same item after reordering", () => {
  const advance = functionSource(
    bibleWorkspace,
    "async function advanceToNextScheduledBibleText(",
    "async function advanceBibleLowerThirdCursor(",
  );

  const lookup = advance.indexOf("await resolvedBibleEntryForItem(nextItem");
  const currentLookup = advance.indexOf("mediaQueue.indexOf(nextItem)", lookup);
  assert.ok(lookup >= 0 && currentLookup > lookup);
  assert.match(advance, /Object\.assign\(nextItem/);
  assert.match(advance, /switchQueueItemLiveWithConfirmation\(currentNextIndex\)/);
  assert.doesNotMatch(advance, /mediaQueue\[nextIndex\] =/);
});

test("every deferred main-preview load has token and item ownership", () => {
  const loader = functionSource(
    presentationPlayback,
    "async function loadQueueItemIntoControlWindow(",
    "async function playCurrentQueueItem(",
  );
  const remove = functionSource(
    scheduleController,
    "function removeFromQueue(",
    "function setQueueItemAutoAdvance(",
  );
  const undo = functionSource(
    renderer,
    "async function restoreQueueClearUndoSnapshot(",
    "async function openThemeManagerForQueueItem(",
  );
  const boundary = functionSource(
    renderer,
    "async function pauseQueuePresentationAtBoundary(",
    "function updateQueueFileLabel(",
  );

  assert.match(loader, /if \(!previewRequestStillOwnsMainSurface\(\)\) return false;/);
  assert.match(loader, /mediaQueue\[previewCueIndex\] === item/);
  assert.doesNotMatch(loader, /!activePresentationOwnsPreviewAudio\(\)\) return true/);
  assert.match(remove, /previewLoadToken: loadToken/);
  assert.match(remove, /const previewAudioItem = queueIndexInRange\(previewAudioCueIndex\)/);
  assert.match(remove, /previewAudioCueIndex: mediaQueue\.indexOf\(previewAudioItem\)/);
  assert.match(remove, /const liveAudioItem = queueIndexInRange\(liveAudioQueueIndex\)/);
  assert.match(remove, /liveAudioItem === removedItem \? -1 : mediaQueue\.indexOf\(liveAudioItem\)/);
  assert.match(undo, /previewLoadToken,\s*\}/);
  assert.match(boundary, /isCurrentPreviewLoad\(previewLoadToken\)/);
  assert.match(boundary, /mediaQueue\[currentQueueIndex\] !== item/);
});

test("cue restoration cannot commit after a newer cue selection", () => {
  const restore = functionSource(
    presentationPlayback,
    "async function restorePreviewCueAfterPresentationStopped(",
    "async function loadAudioQueueItemIntoPreviewCue(",
  );

  assert.match(restore, /const token = nextPreviewLoadToken\(\)/);
  assert.match(restore, /previewCueIndexForItem\(cue\.item, token\)/);
  assert.match(restore, /previewLoadToken: token/);
  assert.match(restore, /const posterUrl = await stagedMediaUrlForItem/);
  assert.ok(
    restore.indexOf("if (currentCueIndex() < 0)", restore.indexOf("const posterUrl")) <
      restore.indexOf("cueEl.poster = posterUrl"),
  );
});

test("deferred audience commands are scoped to their playback identity", () => {
  const createWindow = functionSource(
    mediaRuntime,
    "async function createMediaWindow(",
    "\nexport {",
  );
  const songSend = functionSource(
    songWorkspace,
    "async function sendSongTextToOutput(",
    "async function slipstreamSongTextToOutput(",
  );
  const pptxSend = functionSource(
    previewController,
    "function sendPptxSlideToMediaWindow(",
    "function pptxStartSlideForItem(",
  );

  assert.match(createWindow, /matchesActivePlayback\(\{ playbackId \}\)/);
  assert.match(createWindow, /sendPptxSlideToMediaWindow\(pptxStartSlide, playbackId\)/);
  assert.match(songSend, /expectedPlaybackId/);
  assert.match(songSend, /matchesActivePlayback/);
  assert.match(liveOutputs, /playbackId: String\(options\.expectedPlaybackId\)/);
  assert.match(pptxSend, /playbackId: String\(playbackId \|\| ""\)/);
  assert.match(pptxSend, /normalizeMediaPathForCompare\(pptxFilePath\)/);
  assert.match(pptxSend, /filePath: activeResolvedMediaFile \|\| livePptxPath/);
  assert.match(mediaWindow, /message\.playbackId !== audiencePlaybackId/);
  assert.match(mediaWindow, /data\.playbackId === audiencePlaybackId/);
  assert.match(mediaWindow, /data\.filePath === mediaFile/);
});

test("Bible editor commits retain the previewed queue item across awaits", () => {
  const sync = functionSource(
    bibleWorkspace,
    "async function syncBibleDesignerStateToPreviewedQueueItem(",
    "async function applyBibleBackgroundToAllProjectText(",
  );

  assert.match(sync, /const targetItem = mediaQueue\[targetIndex\]/);
  assert.match(sync, /mediaQueue\.indexOf\(targetItem\)/);
  assert.match(sync, /bibleEntryMatchesQueueItem\(entry\.bible, targetItem\)/);
  assert.match(sync, /Object\.assign\(targetItem/);
  assert.doesNotMatch(sync, /mediaQueue\[targetIndex\] =/);
});
