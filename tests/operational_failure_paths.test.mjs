import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { stageContentFromPresentation } from "../src/shared/stage-content.mjs";

const [mainSource, projectSource, liveSource, stageSource, mediaLibrarySource, previewSource] = await Promise.all([
  readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/control-window/app-project-session.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/control-window/app-live-outputs.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/stage-window/stage.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/control-window/app-preview-controller.mjs", import.meta.url), "utf8"),
]);

function functionSlice(source, first, next) {
  const start = source.indexOf(first);
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, `Could not find ${first}`);
  return source.slice(start, end);
}

function closeHarness(dialogResponses = []) {
  const ipcMain = new EventEmitter();
  const sends = [];
  const prompts = [];
  const timers = new Map();
  let nextTimer = 0;
  let nextRequest = 0;
  const window = new EventEmitter();
  window.destroyed = false;
  window.webContents = {
    isDestroyed: () => false,
    send: (...args) => sends.push(args),
  };
  window.isDestroyed = () => window.destroyed;
  window.close = () => {
    let prevented = false;
    window.emit("close", { preventDefault: () => { prevented = true; } });
    if (!prevented) window.destroyed = true;
  };
  const context = {
    allowMainWindowClose: false,
    clearTimeout: (id) => timers.delete(id),
    console,
    dialog: {
      showMessageBox: async (_window, options) => {
        prompts.push(options);
        return { response: dialogResponses.shift() ?? 1 };
      },
    },
    ipcMain,
    randomUUID: () => `request-${++nextRequest}`,
    setTimeout: (callback) => {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
  };
  const code = functionSlice(mainSource, "function wireMainWindowCloseAutosave(", "function createPreflightDialogWindow(");
  vm.runInNewContext(`${code}\nwireMainWindowCloseAutosave(mainWindow);`, { ...context, mainWindow: window });
  return { ipcMain, sends, prompts, timers, window };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("a failed close autosave keeps the project open and allows a later retry", async () => {
  const harness = closeHarness([1]);
  harness.window.close();
  const requestId = harness.sends[0][1];
  harness.ipcMain.emit("app-close-autosave-complete", { sender: {} }, { requestId, ok: true });
  assert.equal(harness.window.destroyed, false, "another renderer cannot approve the close");
  harness.ipcMain.emit("app-close-autosave-complete", { sender: harness.window.webContents }, { requestId, ok: false, error: "disk full" });
  await settle();
  assert.equal(harness.window.destroyed, false);
  assert.equal(harness.prompts.length, 1);
  assert.match(harness.prompts[0].detail, /disk full/);

  harness.window.close();
  const retryId = harness.sends.at(-1)[1];
  assert.notEqual(retryId, requestId);
  harness.ipcMain.emit("app-close-autosave-complete", { sender: harness.window.webContents }, { requestId: retryId, ok: true });
  await settle();
  assert.equal(harness.window.destroyed, true);
  assert.equal(harness.timers.size, 0);
});

test("a timed out close save requires an explicit exit choice", async () => {
  const harness = closeHarness([2]);
  harness.window.close();
  const timeout = [...harness.timers.values()][0];
  timeout();
  await settle();
  assert.equal(harness.prompts.length, 1);
  assert.equal(harness.window.destroyed, true, "the operator chose Exit Without Saving");
});

test("Retry Save waits for the new request and ignores a late old reply", async () => {
  const harness = closeHarness([0]);
  harness.window.close();
  const firstId = harness.sends[0][1];
  harness.ipcMain.emit("app-close-autosave-complete", { sender: harness.window.webContents }, { requestId: firstId, ok: false });
  await settle();
  assert.equal(harness.sends.length, 2);
  const retryId = harness.sends[1][1];
  harness.ipcMain.emit("app-close-autosave-complete", { sender: harness.window.webContents }, { requestId: firstId, ok: true });
  assert.equal(harness.window.destroyed, false);
  harness.ipcMain.emit("app-close-autosave-complete", { sender: harness.window.webContents }, { requestId: retryId, ok: true });
  await settle();
  assert.equal(harness.window.destroyed, true);
});

test("a failed autosave prevents project cleanup and replacement", async () => {
  let cleanupCalled = false;
  const code = functionSlice(projectSource, "async function preserveCurrentProjectBeforeSwitch(", "function applyProjectStateSnapshot(");
  const context = {
    projectSessionIsActive: () => true,
    currentProjectPath: "/projects/current.emproj",
    currentProjectNeedsSaveAs: false,
    saveCurrentProjectInStorageMode: async () => true,
    flushAutosaveOnClose: async () => { throw new Error("disk full"); },
    assertProjectSwitchIsIdle: () => {},
    invoke: async () => { cleanupCalled = true; },
    console,
  };
  const cleanup = vm.runInNewContext(`${code}\ncleanupStagingForCurrentProjectBeforeSwitch`, context);
  await assert.rejects(cleanup(), (error) => error.code === "EMS_AUTOSAVE_FAILED" && error.cause?.message === "disk full");
  assert.equal(cleanupCalled, false);
});

test("project switching commits the outgoing named project before replacing its recovery autosave", async () => {
  const calls = [];
  const code = functionSlice(projectSource, "async function preserveCurrentProjectBeforeSwitch(", "function applyProjectStateSnapshot(");
  const context = {
    projectSessionIsActive: () => true,
    currentProjectPath: "/projects/current.emproj",
    currentProjectNeedsSaveAs: false,
    currentProjectGuid: "project-guid",
    saveCurrentProjectInStorageMode: async () => { calls.push("save-project"); return true; },
    flushAutosaveOnClose: async () => { calls.push("flush-autosave"); },
    assertProjectSwitchIsIdle: () => {},
    buildProjectQueueSnapshot: () => [],
    invoke: async (channel) => { calls.push(channel); },
    console,
  };
  const cleanup = vm.runInNewContext(`${code}\ncleanupStagingForCurrentProjectBeforeSwitch`, context);
  await cleanup();
  assert.deepEqual(calls, ["save-project", "flush-autosave", "cleanup-project-staging"]);
  const openStart = projectSource.indexOf("async function openProjectByPathSerialized(");
  const preserve = projectSource.indexOf("await preserveCurrentProjectBeforeSwitch()", openStart);
  const read = projectSource.indexOf('invoke("read-project-file", filePath)', openStart);
  assert.ok(openStart >= 0 && preserve > openStart && read > preserve,
    "the incoming file must be read after the outgoing project is saved");
});

test("cancelling Save As leaves an untitled project in place", async () => {
  let flushCalled = false;
  const code = functionSlice(projectSource, "async function preserveCurrentProjectBeforeSwitch(", "function applyProjectStateSnapshot(");
  const context = {
    projectSessionIsActive: () => true,
    currentProjectPath: "",
    currentProjectNeedsSaveAs: false,
    saveProjectAsDialog: async () => false,
    flushAutosaveOnClose: async () => { flushCalled = true; },
    assertProjectSwitchIsIdle: () => {},
  };
  const cleanup = vm.runInNewContext(`${code}\ncleanupStagingForCurrentProjectBeforeSwitch`, context);
  await assert.rejects(cleanup(), (error) => error.code === "EMS_PROJECT_SWITCH_BLOCKED");
  assert.equal(flushCalled, false);
});

test("a recovered autosave must be saved under a new project path before switching", async () => {
  const calls = [];
  const code = functionSlice(projectSource, "async function preserveCurrentProjectBeforeSwitch(", "function applyProjectStateSnapshot(");
  const context = {
    projectSessionIsActive: () => true,
    currentProjectPath: "/userData/autosave.emproj",
    currentProjectNeedsSaveAs: true,
    currentProjectGuid: "recovered-guid",
    saveCurrentProjectInStorageMode: async () => { calls.push("overwrite-recovery"); return true; },
    saveProjectAsDialog: async () => { calls.push("save-as"); return true; },
    flushAutosaveOnClose: async () => { calls.push("flush-autosave"); },
    assertProjectSwitchIsIdle: () => {},
    buildProjectQueueSnapshot: () => [],
    invoke: async (channel) => { calls.push(channel); },
    console,
  };
  const cleanup = vm.runInNewContext(`${code}\ncleanupStagingForCurrentProjectBeforeSwitch`, context);
  await cleanup();
  assert.deepEqual(calls, ["save-as", "flush-autosave", "cleanup-project-staging"]);
  assert.match(projectSource, /if \(await applyProjectStateSnapshot\(state, \{ skipStagingCleanup: true \}\)\) \{\s+currentProjectNeedsSaveAs = true/);
});

test("a project file save failure cancels the switch before autosave replacement", async () => {
  let flushCalled = false;
  const code = functionSlice(projectSource, "async function preserveCurrentProjectBeforeSwitch(", "function applyProjectStateSnapshot(");
  const context = {
    projectSessionIsActive: () => true,
    currentProjectPath: "/projects/current.emproj",
    currentProjectNeedsSaveAs: false,
    saveCurrentProjectInStorageMode: async () => false,
    flushAutosaveOnClose: async () => { flushCalled = true; },
    assertProjectSwitchIsIdle: () => {},
  };
  const cleanup = vm.runInNewContext(`${code}\ncleanupStagingForCurrentProjectBeforeSwitch`, context);
  await assert.rejects(cleanup(), (error) => error.code === "EMS_PROJECT_SWITCH_BLOCKED");
  assert.equal(flushCalled, false);
});

test("a live output blocks a project switch before any project state is replaced", () => {
  const helper = functionSlice(projectSource, "function projectSwitchBlockedByLiveOutput(", "function assertProjectSwitchIsIdle(");
  const context = {
    queueClearBlockedByLivePresentation: () => false,
    isActiveMediaWindow: () => true,
    isLocalAppWindowPresentationActive: () => false,
    bibleLowerThirdOutputActive: false,
    activeLowerThirdContentType: null,
  };
  const blocked = vm.runInNewContext(`${helper}\nprojectSwitchBlockedByLiveOutput`, context);
  assert.equal(blocked(), true);
  assert.ok(projectSource.indexOf("assertProjectSwitchIsIdle()", projectSource.indexOf("const applyState = async"))
    < projectSource.indexOf("await resetStageContentForProjectChange(nextStageProfile)"));
});

test("a presentation started during project saving blocks staging cleanup", async () => {
  let live = false;
  let cleanupCalled = false;
  const code = functionSlice(projectSource, "async function preserveCurrentProjectBeforeSwitch(", "function applyProjectStateSnapshot(");
  const context = {
    projectSessionIsActive: () => true,
    currentProjectPath: "/projects/current.emproj",
    currentProjectNeedsSaveAs: false,
    saveCurrentProjectInStorageMode: async () => { live = true; return true; },
    flushAutosaveOnClose: async () => {},
    assertProjectSwitchIsIdle: () => {
      if (!live) return;
      const error = new Error("Live output active");
      error.code = "EMS_PROJECT_SWITCH_BLOCKED";
      throw error;
    },
    invoke: async () => { cleanupCalled = true; },
  };
  const cleanup = vm.runInNewContext(`${code}\ncleanupStagingForCurrentProjectBeforeSwitch`, context);
  await assert.rejects(cleanup(), (error) => error.code === "EMS_PROJECT_SWITCH_BLOCKED");
  assert.equal(cleanupCalled, false);
});

test("PowerPoint stage Next tracks whether it names a slide or another cue", () => {
  const item = { path: "/slides/deck.pptx", name: "Deck" };
  const context = {
    audiencePlaybackCoordinator: { activePlaybackId: () => "playback" },
    isQueuePlaying: true,
    currentQueueIndex: 0,
    mediaQueue: [item],
    isQueueItemPptx: () => true,
    pptxFilePath: item.path,
    mediaFile: item.path,
    normalizeMediaPathForCompare: (value) => value,
    activeResolvedMediaFile: "",
    send: () => {},
    pptxSlideCount: 3,
    nextPlayableQueueItemStageText: () => "Following cue",
    stageContentCache: { nextIsItem: true },
    queueItemStageLabel: () => "Deck",
    slideTransitionPayloadForQueueItem: () => null,
    sendCachedStageContent: async () => {},
  };
  context.setSharedRendererState = (patch) => { context.stageContentCache = patch.stageContentCache; };
  const code = functionSlice(previewSource, "function sendPptxSlideToMediaWindow(", "function pptxStartSlideForItem(");
  const sendSlide = vm.runInNewContext(`${code}\nsendPptxSlideToMediaWindow`, context);
  assert.equal(sendSlide(0), true);
  assert.equal(context.stageContentCache.next, "Slide 2");
  assert.equal(context.stageContentCache.nextIsItem, false);
  assert.equal(sendSlide(2), true);
  assert.equal(context.stageContentCache.next, "Following cue");
  assert.equal(context.stageContentCache.nextIsItem, true);
});

test("stage content identifies a next cue and gives current content priority", () => {
  const nextCue = stageContentFromPresentation(
    { bodyText: "Last slide" },
    { type: "song", nextItemText: "Welcome video" },
  );
  assert.equal(nextCue.nextIsItem, true);
  const nextSlide = stageContentFromPresentation({
    resolvedPresentation: {
      navigation: { activeSlideId: "one", nextSlideId: "two" },
      slides: [{ slideId: "one", bodyText: "One" }, { slideId: "two", bodyText: "Two" }],
    },
  }, { type: "song", nextItemText: "Welcome video" });
  assert.equal(nextSlide.nextIsItem, false);

  const rendered = new Map();
  const code = functionSlice(stageSource, "function render()", "function updateClock()");
  const context = {
    state: {
      layers: {
        content: { serviceItem: "Current song", notes: "Current notes" },
        widgets: { serviceItem: "Previous video", notes: "Previous notes", countdown: "1:23" },
      },
    },
    document: {
      getElementById: (id) => id === "stageRoot" ? { dataset: {} } : { hidden: false },
    },
    setText: (id, value) => rendered.set(id, value),
    renderOverlay: () => {},
  };
  vm.runInNewContext(`${code}\nrender()`, context);
  assert.equal(rendered.get("stageServiceItem"), "Current song");
  assert.equal(rendered.get("stageNotes"), "Current notes");
  assert.equal(rendered.get("stageCountdown"), "1:23");
});

test("opening a project clears stage content and countdown before changing project identity", async () => {
  const resetAt = projectSource.indexOf("await resetStageContentForProjectChange(nextStageProfile)");
  const identityAt = projectSource.indexOf("currentProjectPath = nextProjectPath", resetAt);
  assert.ok(resetAt >= 0 && identityAt > resetAt);

  const layers = [];
  const applied = [];
  const code = functionSlice(liveSource, "async function resetStageContentForProjectChange(", "/**\n * Opted-in schedule notes");
  const context = {
    stageContentUpdateRevision: 0,
    stageWidgetsOwnerItem: { id: "old" },
    setSharedRendererState: (patch) => applied.push(patch),
    invoke: async () => ({ sessionId: "stage-session" }),
    sendStageLayer: async (...args) => layers.push(args),
  };
  const reset = vm.runInNewContext(`${code}\nresetStageContentForProjectChange`, context);
  await reset("notes");
  assert.equal(applied[0].stageContentCache.current, "Waiting for live content");
  assert.equal(applied[0].stageContentCache.notes, "");
  assert.equal(applied[0].stageContentCache.profile, "notes");
  assert.equal(layers[0][0], "widgets");
  assert.equal(Object.keys(layers[0][1]).length, 0);
  assert.equal(layers[0][2], "layer.clear");
  assert.equal(layers[1][0], "content");
});

test("a schedule edit refreshes stage Next when it names another cue", async () => {
  const item = { id: "live" };
  const context = {
    stageContentCache: { next: "Old cue", nextIsItem: true, notes: "", slideNotes: "" },
    currentLiveQueueItem: () => item,
    liveScheduleItemStageNotes: () => "",
    mergeStageNotes: (first, second) => [first, second].filter(Boolean).join("\n"),
    mediaQueue: [item],
    nextPlayableQueueItemStageText: () => "New cue",
    setSharedRendererState(patch) { this.stageContentCache = patch.stageContentCache; },
    sendCachedStageContent: async () => true,
  };
  context.setSharedRendererState = (patch) => { context.stageContentCache = patch.stageContentCache; };
  const code = functionSlice(liveSource, "async function refreshStageNotesForLiveItem(", "function nextStageRevision(");
  const refresh = vm.runInNewContext(`${code}\nrefreshStageNotesForLiveItem`, context);
  assert.equal(await refresh(), true);
  assert.equal(context.stageContentCache.next, "New cue");
  assert.equal(context.stageContentCache.nextIsItem, true);
});

test("a failed Media query displays a retry state and recovers after success", async () => {
  const elements = new Map([
    ["mediaLibraryQueryError", { hidden: true }],
    ["mediaLibraryLiveRegion", { textContent: "" }],
  ]);
  const state = {
    sourceId: "all", parentId: "", query: "", kind: "", items: [],
    total: 0, hasMore: false, requestId: 0, loadingMore: false,
  };
  let fail = true;
  const bridge = {
    invoke: async (channel) => {
      if (channel === "media-library:list-folders") return [];
      if (fail) throw new Error("service unavailable");
      return { items: [{ id: "one" }], total: 1, hasMore: false };
    },
  };
  const code = functionSlice(mediaLibrarySource, "function showMediaLibraryQueryError(", "function maybeLoadMore()");
  const context = {
    bridge, state, pickerRequest: null, PAGE_SIZE: 60,
    element: (id) => elements.get(id),
    renderItems: () => {}, renderFolders: () => {},
    refreshOpenDetailsForAvailabilityChange: () => {},
    console: { error: () => {} },
  };
  const runQuery = vm.runInNewContext(`${code}\nrunQuery`, context);
  assert.equal(await runQuery(), false);
  assert.equal(elements.get("mediaLibraryQueryError").hidden, false);
  assert.match(elements.get("mediaLibraryLiveRegion").textContent, /could not be loaded/);
  fail = false;
  assert.equal(await runQuery(), true);
  assert.equal(elements.get("mediaLibraryQueryError").hidden, true);
  assert.equal(state.items.length, 1);
});
