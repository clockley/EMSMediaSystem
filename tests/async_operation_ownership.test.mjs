import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createAsyncActionCoalescer,
  createLatestRequestGate,
} from "../src/shared/async-operation-ownership.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function functionSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return source.slice(start, end);
}

test("latest request gate prevents an older completion from committing", async () => {
  const gate = createLatestRequestGate();
  const firstResult = deferred();
  const secondResult = deferred();
  const commits = [];

  const run = async (owner, result) => {
    const request = gate.begin(owner);
    const value = await result.promise;
    if (gate.owns(request, owner)) commits.push(value);
  };

  const first = run({ id: "first" }, firstResult);
  const second = run({ id: "second" }, secondResult);
  secondResult.resolve("second");
  await second;
  firstResult.resolve("first");
  await first;

  assert.deepEqual(commits, ["second"]);
});

test("ownership requires both the current generation and the same object", () => {
  const gate = createLatestRequestGate();
  const owner = { id: "song" };
  const request = gate.begin(owner);

  assert.equal(gate.owns(request, owner), true);
  assert.equal(gate.owns(request, { id: "song" }), false);
  gate.invalidate();
  assert.equal(gate.owns(request, owner), false);
});

test("action coalescer blocks in-flight work and the second click of a double-click", async () => {
  let clock = 1000;
  const coalescer = createAsyncActionCoalescer({
    cooldownMs: 400,
    now: () => clock,
  });
  const firstResult = deferred();
  let runs = 0;
  const first = coalescer.run("song:1", async () => {
    runs += 1;
    await firstResult.promise;
    return true;
  });

  assert.equal(await coalescer.run("song:1", async () => true), false);
  firstResult.resolve();
  assert.equal(await first, true);
  clock += 200;
  assert.equal(await coalescer.run("song:1", async () => true), false);
  clock += 201;
  assert.equal(await coalescer.run("song:1", async () => {
    runs += 1;
    return true;
  }), true);
  assert.equal(runs, 2);
});

test("async UI handlers validate stable ownership after awaits", async () => {
  const [songs, shell, schedule, bible, liveOutputs, main, themeManager] = await Promise.all([
    readFile(new URL("../src/control-window/app-song-slides-workspace.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/control-window/app-workspace-shell.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/control-window/app-schedule-controller.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/control-window/app-bible-workspace.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/control-window/app-live-outputs.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/dialogs/theme_manager.mjs", import.meta.url), "utf8"),
  ]);

  const songLoad = functionSource(
    songs,
    "async function loadSongIntoWorkspace(",
    "function updateSongNavButtonsState(",
  );
  assert.match(songLoad, /songWorkspaceLoadGate\.begin/);
  assert.match(songLoad, /if \(!stillOwnsWorkspace\(\)\) return false/);
  assert.ok(
    songLoad.indexOf("await checkIfSongInLibrary(stagedWorkspaceSong.id)") <
      songLoad.indexOf("currentWorkspaceSong = stagedWorkspaceSong"),
    "the song workspace must commit only after asynchronous ownership validation",
  );

  const scheduledSongLoad = functionSource(
    songs,
    "async function loadSongItemIntoWorkspace(",
    "function queueItemDeckId(",
  );
  assert.doesNotMatch(scheduledSongLoad, /commitWorkspaceIdentity/);
  assert.doesNotMatch(scheduledSongLoad, /currentSongRenderState\s*=/);
  assert.match(scheduledSongLoad, /queueItem: item \|\| null/);

  const songActivation = functionSource(
    songs,
    "async function activateSongFromLibrary(",
    "async function scheduleSongFromLibrary(",
  );
  assert.match(songActivation, /songLibraryIntentGate\.begin/);
  assert.match(songActivation, /libraryIntentRequest: request/);
  assert.doesNotMatch(songActivation, /currentSongRenderState\s*=/);
  assert.doesNotMatch(songActivation, /currentSongQueueItem\s*=/);
  assert.match(songActivation, /queueItem: null/);

  const songShowNow = functionSource(
    songs,
    "async function showSongFromLibraryNow(",
    "function hideSongContextMenu(",
  );
  assert.ok(
    songShowNow.indexOf("songLibraryIntentGate.isCurrent(request)") <
      songShowNow.indexOf("showSongTextNow()"),
  );
  assert.doesNotMatch(songShowNow, /currentSongRenderState\s*=/);
  assert.match(songShowNow, /queueItem: null/);

  const deckShowNow = functionSource(
    songs,
    "async function showCurrentDeckNow(",
    "function scheduleCurrentDeck(",
  );
  assert.match(deckShowNow, /const deckOwner = currentDeck/);
  assert.match(deckShowNow, /currentDeck === deckOwner/);
  assert.match(deckShowNow, /deckEditRevision === editRevision/);
  assert.ok(
    deckShowNow.indexOf("if (!started)") <
      deckShowNow.indexOf("currentWorkspaceSong = entry.songSnapshot"),
    "Show Now must not replace the song workspace until output starts",
  );

  const deckSave = functionSource(
    songs,
    "async function saveCurrentDeck(",
    "function resetCurrentSongToThemeDefault(",
  );
  assert.match(deckSave, /const deckToSave = currentDeck/);
  assert.match(deckSave, /deckMutationGate\.owns\(operation, currentDeck\)/);
  assert.match(deckSave, /deckEditRevision === editRevision/);
  assert.match(deckSave, /updateScheduleSongsWithUpdatedSong\(currentDeck/);
  assert.match(deckSave, /updateScheduleDecksWithUpdatedDeck\(deckToSave/);

  const deckDelete = functionSource(
    songs,
    "async function deleteCurrentDeck(",
    "async function duplicateCurrentDeck(",
  );
  assert.match(deckDelete, /const deckToDelete = currentDeck/);
  assert.match(deckDelete, /if \(currentDeck !== deckToDelete\) return/);
  assert.match(deckDelete, /deckMutationGate\.begin\(deckToDelete\)/);

  const deckRename = functionSource(
    songs,
    "async function renameCurrentDeck(",
    "function deckSummaryFromDeck(",
  );
  assert.match(deckRename, /const deckToRename = currentDeck/);
  assert.match(deckRename, /if \(currentDeck !== deckToRename\) return/);

  const deckCreate = functionSource(
    songs,
    "async function createNewDeck(",
    "async function saveCurrentDeck(",
  );
  assert.match(deckCreate, /const previousDeck = currentDeck/);
  assert.match(deckCreate, /if \(currentDeck !== previousDeck\) return/);

  const songEditorSave = functionSource(
    songs,
    "async function saveSongEditor(",
    "async function saveSongToSchedule(",
  );
  assert.match(songEditorSave, /const renderSnapshot = structuredClone\(currentSongRenderState\)/);
  assert.match(songEditorSave, /songEditorSaveGate\.owns\(saveRequest, currentWorkspaceSong\)/);
  assert.match(songEditorSave, /render: renderSnapshot/);
  assert.match(songEditorSave, /if \(songEditorLibrarySaveInFlight\) return false/);
  assert.ok(
    songEditorSave.indexOf("songEditorLibrarySaveInFlight = true") <
      songEditorSave.indexOf("await songsAPI.save(songDeck)"),
    "a repeated editor save must be rejected before either persistence call can overlap",
  );
  assert.match(songEditorSave, /finally \{\s*songEditorLibrarySaveInFlight = false/);

  const songScheduleInsert = functionSource(
    songs,
    "async function insertSongInSchedule(",
    "async function importSongFromDialog(",
  );
  assert.match(songScheduleInsert, /scheduleInsertionCoalescer\.run/);
  const deckScheduleInsert = functionSource(
    songs,
    "function scheduleCurrentDeck(",
    "async function openSongEditor(",
  );
  assert.match(deckScheduleInsert, /scheduleInsertionCoalescer\.run/);
  const libraryScheduleInsert = functionSource(
    songs,
    "async function scheduleSongFromLibrary(",
    "async function showSongFromLibraryNow(",
  );
  assert.match(libraryScheduleInsert, /scheduleInsertionCoalescer\.run/);

  const scheduleUpdate = functionSource(
    songs,
    "async function updateScheduleSongsWithUpdatedSong(",
    "async function saveSongEditor(",
  );
  assert.match(scheduleUpdate, /const render = opts\.render/);
  assert.match(scheduleUpdate, /reconcileSongQueueEntryInPlace\(item, updatedEntry\)/);
  const songQueueReconcile = functionSource(
    songs,
    "function reconcileSongQueueEntryInPlace(",
    "async function updateScheduleSongsWithUpdatedSong(",
  );
  assert.match(songQueueReconcile, /"itemTheme"/);
  assert.match(songQueueReconcile, /Object\.assign\(item, updatedEntry, preserved\)/);

  const saveToSchedule = functionSource(
    songs,
    "async function saveSongToSchedule(",
    "async function deleteSongFromLibrary(",
  );
  assert.match(saveToSchedule, /reconcileSongQueueEntryInPlace\(item, updatedEntry\)/);
  assert.doesNotMatch(saveToSchedule, /mediaQueue\[i\]\s*=\s*updatedEntry/);
  assert.match(saveToSchedule, /const saveRequest = songEditorSaveGate\.begin\(editorOwner\)/);
  assert.match(saveToSchedule, /songEditorSaveGate\.owns\(saveRequest, currentWorkspaceSong\)/);
  assert.ok(
    saveToSchedule.indexOf("await Promise.resolve()") <
      saveToSchedule.indexOf("invalidateQueueUndoToastAfterMutation()"),
    "Save to Schedule must validate the latest request before mutating the queue",
  );
  assert.match(saveToSchedule, /render: renderSnapshot/);

  const bulkSchedule = functionSource(
    songs,
    "async function bulkScheduleSelectedSongs(",
    "async function bulkDeleteSelectedSongs(",
  );
  assert.match(bulkSchedule, /const ids = Object\.freeze\(\[\.\.\.selectedSongIds\]\)/);
  assert.match(bulkSchedule, /captureQueueInsertionPointAfterSelection/);
  assert.doesNotMatch(bulkSchedule, /for \(const id of selectedSongIds\)/);

  const sectionRename = functionSource(
    schedule,
    "async function renameScheduleSection(",
    "async function addScheduleSectionAfterSelection(",
  );
  assert.match(sectionRename, /const section = mediaQueue\[index\]/);
  assert.match(sectionRename, /mediaQueue\.includes\(section\)/);
  assert.doesNotMatch(sectionRename, /mediaQueue\[index\]\.name =/);

  const sectionAdd = functionSource(
    schedule,
    "async function addScheduleSectionAfterSelection(",
    "function fallbackSelectedQueueIndex(",
  );
  assert.match(sectionAdd, /captureQueueInsertionPointAfterSelection/);
  assert.match(sectionAdd, /resolveQueueInsertionPoint/);

  const lyricsStart = shell.lastIndexOf('document.getElementById("songEditorTextarea")');
  const lyricsHandler = shell.slice(
    lyricsStart,
    shell.indexOf('document.getElementById("songsSearchInput")', lyricsStart),
  );
  assert.match(lyricsHandler, /songEditorParseGate\.begin\(workspaceOwner\)/);
  assert.match(lyricsHandler, /songEditorParseGate\.owns\(parseRequest, currentWorkspaceSong\)/);
  assert.match(lyricsHandler, /e\.target\.value !== text/);
  assert.match(shell, /songFolderMutationGate\.begin\(songId\)/);
  assert.match(shell, /currentWorkspaceSong === workspaceOwner/);
  assert.match(shell, /slideBackgroundPickerGate\.owns\(request, page\)/);
  assert.match(shell, /currentDeck !== deckOwner/);
  assert.match(shell, /songBackgroundPickerGate\.owns\(request, renderOwner\)/);
  assert.match(shell, /currentWorkspaceSong !== workspaceOwner/);

  const songSearch = functionSource(
    songs,
    "async function refreshSongsBrowser(",
    "function setCurrentSongFolderFilter(",
  );
  assert.match(songSearch, /songLibraryQueryGate\.begin/);
  assert.match(songSearch, /if \(!songLibraryQueryGate\.isCurrent\(request\)\) return false/);

  const deckActivation = functionSource(
    songs,
    "async function activateDeckFromLibrary(",
    "function loadDeckIntoWorkspace(",
  );
  assert.match(deckActivation, /deckLibraryActivationGate\.begin\(deckId\)/);
  assert.match(deckActivation, /if \(!deckLibraryActivationGate\.isCurrent\(request\)\) return/);

  const scriptureSync = functionSource(
    bible,
    "async function syncLiveBiblePresentation(",
    "async function insertBibleInSchedule(",
  );
  assert.match(scriptureSync, /mediaQueue\.indexOf\(liveItem\)/);
  assert.match(scriptureSync, /Object\.assign\(liveItem,/);
  assert.doesNotMatch(scriptureSync, /mediaQueue\[currentQueueIndex\]\s*=/);
  const scriptureAudienceSend = scriptureSync.indexOf(
    "await sendBibleTextToOutput(entry.bible, expectedRevision)",
  );
  const scriptureQueueCommit = scriptureSync.indexOf("Object.assign(liveItem,");
  const scriptureLowerThirdSend = scriptureSync.indexOf("await ensureBibleLowerThirdOutput(");
  assert.ok(
    scriptureAudienceSend >= 0 && scriptureAudienceSend < scriptureQueueCommit,
    "live Scripture must reach the audience before its queue snapshot is committed",
  );
  assert.ok(
    scriptureQueueCommit < scriptureLowerThirdSend,
    "the lower third must not update before audience and queue commits succeed",
  );
  assert.match(scriptureSync, /if \(!audienceUpdated\) return false/);
  const bibleInsert = functionSource(
    bible,
    "async function insertBibleInSchedule(",
    "async function addSelectedBibleVersesToSchedule(",
  );
  assert.match(bibleInsert, /bibleScheduleInsertionCoalescer\.run/);
  const selectedBibleInsert = functionSource(
    bible,
    "async function addSelectedBibleVersesToSchedule(",
    "async function addEachSelectedBibleVerseToSchedule(",
  );
  assert.match(selectedBibleInsert, /bibleScheduleInsertionCoalescer\.run/);
  const scriptureDoubleClick = functionSource(
    bible,
    "async function presentBibleSelectionFromDoubleClick(",
    "function selectedBibleVerseNumbers(",
  );
  assert.match(scriptureDoubleClick, /bibleVerseSelectionRequestMatchesCurrent\(selectionRequest\)/);
  assert.match(scriptureDoubleClick, /bibleDesignerState\.reference !== reference/);
  const lowerThirdCuePersist = functionSource(
    bible,
    "function persistBibleLowerThirdCueState(",
    "async function commitBibleDesignerRenderState(",
  );
  assert.match(lowerThirdCuePersist, /Object\.assign\(item,/);
  assert.doesNotMatch(lowerThirdCuePersist, /mediaQueue\[index\]\s*=/);

  const liveTheme = functionSource(
    liveOutputs,
    "async function applyThemeToLivePresentation(",
    "export {",
  );
  assert.match(liveTheme, /liveThemeApplyGate\.begin/);
  assert.match(liveTheme, /if \(!liveThemeApplyGate\.isCurrent\(request\)\) return false/);

  const lowerThirdCreate = functionSource(
    main,
    "async function handleCreateLowerThirdWindow(",
    "function currentOutputStatus(",
  );
  assert.match(lowerThirdCreate, /lowerThirdWindowCreatePromise/);
  assert.match(lowerThirdCreate, /waitForAudienceOutputBootstrap/);
  assert.ok(
    lowerThirdCreate.indexOf("await bootstrapResult") <
      lowerThirdCreate.indexOf("return createdLowerThirdWindow.id"),
  );
  const bibleLowerThird = functionSource(
    bible,
    "async function ensureBibleLowerThirdOutput(",
    "function normalizeProjectScriptureOverrides(",
  );
  assert.doesNotMatch(bibleLowerThird, /setTimeout|lowerThirdKeyOnlyMessage/);
  assert.match(bibleLowerThird, /discardUnclaimedLowerThirdWindow\(windowId\)/);
  assert.match(bibleLowerThird, /await closeBibleLowerThirdOutput\(\)/);
  const songLowerThird = functionSource(
    songs,
    "async function sendSongLowerThirdForLiveItem(",
    "async function ensureSongLowerThirdOutput(",
  );
  assert.doesNotMatch(songLowerThird, /setTimeout|lowerThirdKeyOnlyMessage/);
  assert.match(songLowerThird, /discardUnclaimedLowerThirdWindow\(windowId\)/);

  const closeLowerThird = functionSource(
    main,
    "async function handleCloseLowerThirdWindowNow(",
    "function localMediaStateUpdate(",
  );
  assert.match(closeLowerThird, /expectedWindowId/);
  assert.match(closeLowerThird, /lowerThirdWindow\.id !== expectedWindowId/);

  const themeApplyHandler = main.slice(
    main.indexOf('ipcMain.handle("themes:apply"'),
    main.indexOf('ipcMain.handle("themes:applyToItem"'),
  );
  assert.match(themeApplyHandler, /themeActivationQueue/);
  assert.match(themeApplyHandler, /revision !== themeActivationRevision/);
  const themeDeleteHandler = main.slice(
    main.indexOf('ipcMain.handle("themes:delete"'),
    main.indexOf('ipcMain.handle("themes:import"'),
  );
  assert.match(themeDeleteHandler, /themeActivationQueue/);
  assert.match(themeDeleteHandler, /reconcileDeletedActiveTheme/);
  assert.match(themeManager, /const stillOwnsApply/);
  const themeBackground = functionSource(
    themeManager,
    "async function chooseAudienceBackground(",
    "function clearAudienceBackground(",
  );
  assert.match(themeBackground, /const targetId = selectedId/);
  assert.match(themeBackground, /draft !== targetDraft/);
  assert.match(themeBackground, /outputRole !== targetRole/);
});
