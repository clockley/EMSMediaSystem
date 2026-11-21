import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { stageContentFromPresentation } from "../src/shared/stage-content.mjs";
import { mergeStageNotes } from "../src/shared/schedule-item-notes.mjs";
import { createOutputCommand } from "../src/shared/output-compositor.mjs";

const sources = await Promise.all([
  "app-live-outputs.mjs", "app-preview-controller.mjs",
].map((name) => readFile(new URL(`../src/control-window/${name}`, import.meta.url), "utf8")));

function productionFunction(name) {
  for (const source of sources) {
    const match = source.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^}`, "m"));
    if (match) return match[0];
  }
  throw new Error(`Missing production function ${name}`);
}

function harness() {
  const queue = [
    { type: "video", name: "Live video", path: "/live.mp4" },
    { type: "image", name: "Adjacent image", path: "/adjacent.png" },
    { type: "audio", name: "Cued audio", path: "/cued.mp3" },
    { type: "bible", name: "Cued Scripture", path: "bible://John3:16" },
  ];
  const state = {
    mediaQueue: queue, currentQueueIndex: 0, previewCueIndex: -1,
    stageContentCache: {}, stageContentUpdateRevision: 0, stageWidgetsOwnerItem: null,
    stageContentUpdatePending: null, stageNotesRefreshRevision: 0,
    sent: [], mergeStageNotes, stageContentFromPresentation,
    setSharedRendererState(patch) { Object.assign(state, patch); },
    currentLiveQueueItem: () => state.mediaQueue[state.currentQueueIndex] || null,
    currentPreviewCue: () => state.previewCueIndex < 0 ? null : {
      index: state.previewCueIndex, item: state.mediaQueue[state.previewCueIndex],
    },
    isScheduleItemCurrentlyPlayable: (item) => Boolean(item && item.type !== "section" && !item.disabled),
    queueItemStageLabel: (item) => item?.name || "",
    nextPlayableQueueItemStageText: (index) => state.mediaQueue.slice(index + 1)
      .find(state.isScheduleItemCurrentlyPlayable)?.name || "",
    liveScheduleItemStageNotes: (item) => item?.notes || "",
    livePresentationForStage: (_type, message) => message.resolvedPresentation,
    async sendStageLayer() {},
    async sendCachedStageContent() { state.sent.push(structuredClone(state.stageContentCache)); return true; },
  };
  for (const type of ["Audio", "Pptx", "Image", "Video"]) {
    state[`isQueueItem${type}`] = (item) => item?.type === type.toLowerCase();
  }
  vm.createContext(state);
  for (const name of ["beginStageContentUpdate", "finishStageContentUpdate",
    "stageNextContentForItem", "clearStageWidgetsIfLiveItemChanged",
    "syncStageContentFromQueueItem", "syncStageContentFromAudienceMessage", "refreshStageNotesForLiveItem"]) {
    vm.runInContext(productionFunction(name), state);
  }
  return state;
}

test("Stage Next follows a nonadjacent explicit cue without replacing Current", async () => {
  const s = harness();
  await s.syncStageContentFromQueueItem();
  assert.equal(s.stageContentCache.next, "Adjacent image");
  s.previewCueIndex = 2;
  await s.refreshStageNotesForLiveItem();
  assert.equal(s.stageContentCache.next, "Cued audio");
  assert.equal(s.stageContentCache.nextIsItem, true);
  assert.equal(s.stageContentCache.current, "Live video");
  assert.equal(s.stageContentCache.currentMedia.kind, "video");
  s.previewCueIndex = 3;
  await s.refreshStageNotesForLiveItem();
  assert.equal(s.stageContentCache.next, "Cued Scripture");
  s.previewCueIndex = -1;
  await s.refreshStageNotesForLiveItem();
  assert.equal(s.stageContentCache.next, "Adjacent image");
});

test("taking the cued item live advances Next instead of repeating Current", async () => {
  const s = harness();
  s.previewCueIndex = 2;
  s.currentQueueIndex = 2;
  await s.syncStageContentFromQueueItem();
  assert.equal(s.stageContentCache.currentMedia.kind, "audio");
  assert.equal(s.stageContentCache.next, "Cued Scripture");
});

test("unplayable or removed cues do not become Stage Next", async () => {
  const s = harness();
  s.previewCueIndex = 2;
  s.mediaQueue[2].disabled = true;
  await s.syncStageContentFromQueueItem();
  assert.equal(s.stageContentCache.next, "Adjacent image");
  s.mediaQueue[2].type = "section";
  await s.syncStageContentFromQueueItem();
  assert.equal(s.stageContentCache.next, "Adjacent image");
  s.previewCueIndex = 99;
  await s.syncStageContentFromQueueItem();
  assert.equal(s.stageContentCache.next, "Adjacent image");
});

test("cue reordering and removal refresh Next from the current queue identity", async () => {
  const s = harness();
  s.previewCueIndex = 2;
  await s.syncStageContentFromQueueItem();
  const [cue] = s.mediaQueue.splice(2, 1);
  s.mediaQueue.push(cue);
  s.previewCueIndex = 3;
  await s.refreshStageNotesForLiveItem();
  assert.equal(s.stageContentCache.next, "Cued audio");
  s.mediaQueue.pop();
  s.previewCueIndex = -1;
  await s.refreshStageNotesForLiveItem();
  assert.equal(s.stageContentCache.next, "Adjacent image");
});

test("clearing an explicit cue restores the following lyric/Scripture slide", async () => {
  for (const type of ["song", "bible"]) {
    const s = harness();
    const message = { resolvedPresentation: {
      slides: [{ slideId: "first", bodyText: "Current verse" }, { slideId: "second", bodyText: "Following verse" }],
      navigation: { activeSlideId: "first", nextSlideId: "second" },
    } };
    s.previewCueIndex = 2;
    await s.syncStageContentFromAudienceMessage(type, message, s.mediaQueue[0]);
    assert.equal(s.stageContentCache.current, "Current verse");
    assert.equal(s.stageContentCache.next, "Cued audio");
    assert.equal(s.stageContentCache.nextSlide, "Following verse");
    s.previewCueIndex = -1;
    await s.refreshStageNotesForLiveItem();
    assert.equal(s.stageContentCache.next, "Following verse");
    assert.equal(s.stageContentCache.nextIsItem, false);
  }
});

test("PowerPoint slide changes respect the cue and preserve the following slide", async () => {
  const s = harness();
  Object.assign(s.mediaQueue[0], { type: "pptx", path: "/live.pptx", name: "Live slides" });
  Object.assign(s, {
    isQueuePlaying: true, pptxFilePath: "/live.pptx", mediaFile: "/live.pptx",
    activeResolvedMediaFile: "/live.pptx", pptxSlideCount: 3,
    audiencePlaybackCoordinator: { activePlaybackId: () => "live" },
    normalizeMediaPathForCompare: (path) => path,
    slideTransitionPayloadForQueueItem: () => null, send() {},
  });
  vm.runInContext(productionFunction("sendPptxSlideToMediaWindow"), s);
  await s.syncStageContentFromQueueItem();
  s.previewCueIndex = 2;
  assert.equal(s.sendPptxSlideToMediaWindow(0), true);
  assert.equal(s.stageContentCache.next, "Cued audio");
  s.previewCueIndex = -1;
  await s.refreshStageNotesForLiveItem();
  assert.equal(s.stageContentCache.next, "Slide 2");
  assert.equal(s.stageContentCache.nextIsItem, false);
  s.sendPptxSlideToMediaWindow(2);
  assert.equal(s.stageContentCache.next, "Adjacent image");
});

test("authoritative audio kind supersedes static video metadata and clears slide state", async () => {
  const s = harness();
  s.stageContentCache = { currentMedia: { kind: "text" }, nextSlide: "Old verse", slideNotes: "Old note" };
  await s.syncStageContentFromQueueItem(s.mediaQueue[0], { mediaKind: "audio" });
  assert.equal(s.stageContentCache.currentMedia.kind, "audio");
  assert.equal(s.stageContentCache.nextSlide, "");
  assert.equal(s.stageContentCache.slideNotes, "");
});

test("a delayed outgoing text update cannot overwrite the new audio Current", async () => {
  const s = harness();
  let release;
  s.sendStageLayer = () => {
    s.sendStageLayer = async () => {};
    return new Promise((resolve) => { release = resolve; });
  };
  const outgoing = s.syncStageContentFromAudienceMessage("bible", { text: "Old verse" }, s.mediaQueue[0]);
  s.currentQueueIndex = 2;
  await s.syncStageContentFromQueueItem(s.mediaQueue[2], { mediaKind: "audio" });
  release();
  assert.equal(await outgoing, false);
  assert.equal(s.stageContentCache.current, "Cued audio");
  assert.equal(s.stageContentCache.currentMedia.kind, "audio");
});

test("standalone Show Now retains its own notes when the old schedule row changes", async () => {
  const s = harness();
  s.mediaQueue[0].notes = "Notes from the old scheduled cue";
  await s.syncStageContentFromAudienceMessage("bible", { text: "Standalone verse", notes: "Standalone notes" }, null);
  s.previewCueIndex = 2;
  await s.refreshStageNotesForLiveItem();
  assert.equal(s.stageContentCache.current, "Standalone verse");
  assert.equal(s.stageContentCache.notes, "Standalone notes");
  assert.equal(s.stageContentCache.next, "Cued audio");
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

for (const source of ["queue", "song", "bible"]) {
  test(`a stale ${source} thumbnail cannot clear the new cue's widgets or change its owner`, async () => {
    const s = harness();
    s.stageResolvedMediaPaths = new WeakMap();
    for (const name of ["resolveStageMediaPathForItem", "stageMediaRevisionForItem", "resolveStageNextMedia"]) {
      vm.runInContext(productionFunction(name), s);
    }
    const thumbnail = deferred();
    const thumbnailRequested = deferred();
    s.invoke = (channel, request) => {
      assert.equal(channel, "stage-item-thumbnail");
      assert.equal(request.path, "/adjacent.png");
      thumbnailRequested.resolve();
      return thumbnail.promise;
    };
    const widgetCommands = [];
    s.sendStageLayer = async (layer, payload, type = "layer.set") => {
      assert.equal(layer, "widgets");
      widgetCommands.push({ payload, type });
      s.widgets = type === "layer.clear" ? null : payload;
      return { delivered: true };
    };
    const outgoing = source === "queue"
      ? s.syncStageContentFromQueueItem(s.mediaQueue[0])
      : s.syncStageContentFromAudienceMessage(source, { text: "Old verse", title: "Old cue" }, s.mediaQueue[0]);
    await thumbnailRequested.promise;
    assert.equal(widgetCommands.length, 0);

    s.currentQueueIndex = 2;
    assert.equal(await s.syncStageContentFromQueueItem(), true);
    assert.equal(s.stageWidgetsOwnerItem, s.mediaQueue[2]);
    const committedContent = s.stageContentCache;
    await s.sendStageLayer("widgets", { countdown: "New cue timer" });
    s.lastStageCountdownSecond = 17;

    thumbnail.resolve({ thumbnailUrl: "file:///tmp/old-thumbnail.png" });
    assert.equal(await outgoing, false);
    assert.equal(s.stageWidgetsOwnerItem, s.mediaQueue[2]);
    assert.equal(s.stageContentCache, committedContent);
    assert.equal(s.stageContentCache.current, "Cued audio");
    assert.equal(s.widgets.countdown, "New cue timer");
    assert.equal(s.lastStageCountdownSecond, 17);
    assert.equal(widgetCommands.length, 2);
    assert.equal(s.sent.length, 1);
  });
}

for (const source of ["queue", "song", "bible"]) {
  test(`a notes refresh cannot cancel an incoming ${source} take awaiting its thumbnail`, async () => {
    const s = harness();
    await s.syncStageContentFromQueueItem();
    const thumbnail = deferred();
    const incoming = s.mediaQueue[2];
    incoming.notes = "Incoming notes";
    s.resolveStageNextMedia = async () => thumbnail.promise;
    const take = source === "queue"
      ? s.syncStageContentFromQueueItem(incoming, { mediaKind: "audio" })
      : s.syncStageContentFromAudienceMessage(source, { text: "Incoming verse", title: "Incoming cue" }, incoming);
    const revision = s.stageContentUpdateRevision;
    const refresh = s.refreshStageNotesForLiveItem();
    assert.equal(s.stageContentUpdateRevision, revision);
    assert.equal(s.stageContentCache.current, "Live video");
    incoming.notes = "Edited incoming notes";
    thumbnail.resolve({ kind: "audio", name: "Next item" });
    assert.equal(await take, true);
    await refresh;
    assert.equal(s.stageWidgetsOwnerItem, incoming);
    assert.equal(s.stageContentCache.current, source === "queue" ? "Cued audio" : "Incoming verse");
    assert.equal(s.stageContentCache.currentMedia.kind, source === "queue" ? "audio" : "text");
    assert.equal(s.stageContentCache.notes, "Edited incoming notes");
    assert.equal(s.stageContentUpdatePending, null);
  });
}

test("waiting refreshes follow a superseding take without waiting for its abandoned thumbnail", async () => {
  const s = harness();
  await s.syncStageContentFromQueueItem();
  const thumbnail = deferred();
  s.resolveStageNextMedia = async (item) => item === s.mediaQueue[1] ? thumbnail.promise : null;
  const oldTake = s.syncStageContentFromQueueItem(s.mediaQueue[1]);
  const refresh = s.refreshStageNotesForLiveItem();
  await s.syncStageContentFromQueueItem(s.mediaQueue[2]);
  await refresh;
  assert.equal(s.stageContentCache.current, "Cued audio");
  assert.equal(s.stageWidgetsOwnerItem, s.mediaQueue[2]);
  thumbnail.resolve(null);
  assert.equal(await oldTake, false);
  assert.equal(s.stageContentCache.current, "Cued audio");
});

test("a failed thumbnail releases waiting notes refreshes", async () => {
  const s = harness();
  await s.syncStageContentFromQueueItem();
  let fail;
  s.resolveStageNextMedia = () => new Promise((_resolve, reject) => { fail = reject; });
  const take = s.syncStageContentFromQueueItem(s.mediaQueue[2]);
  const rejected = assert.rejects(take, /thumbnail failed/);
  const refresh = s.refreshStageNotesForLiveItem({ forceSend: true });
  s.resolveStageNextMedia = async () => null;
  fail(new Error("thumbnail failed"));
  await rejected;
  assert.equal(await refresh, true);
  assert.equal(s.stageContentUpdatePending, null);
  assert.equal(s.stageContentCache.current, "Live video");
});

for (const phase of ["status", "widgets"]) {
  test(`a project reset delayed during ${phase} cannot clear a newer live cue`, async () => {
    const s = harness();
    vm.runInContext(productionFunction("resetStageContentForProjectChange"), s);
    const delayed = deferred();
    const waiting = deferred();
    const content = [];
    s.invoke = () => {
      if (phase === "status") { waiting.resolve(); return delayed.promise; }
      return Promise.resolve({ sessionId: "stage-session" });
    };
    let firstWidgets = true;
    s.sendStageLayer = async (layer, payload) => {
      if (phase === "widgets" && layer === "widgets" && firstWidgets) {
        firstWidgets = false;
        waiting.resolve();
        await delayed.promise;
      }
      if (layer === "content") content.push(payload);
    };
    const reset = s.resetStageContentForProjectChange();
    await waiting.promise;
    await s.syncStageContentFromQueueItem(s.mediaQueue[2]);
    delayed.resolve({ sessionId: "obsolete-session" });
    assert.equal(await reset, false);
    assert.equal(content.length, 0);
    assert.equal(s.stageContentCache.current, "Cued audio");
    assert.equal(s.stageWidgetsOwnerItem, s.mediaQueue[2]);
  });
}

test("cue-clearing and queue-mutating operations trigger a stage Next refresh", async () => {
  const [playback, schedule] = await Promise.all([
    "app-presentation-playback.mjs", "app-schedule-controller.mjs",
  ].map((name) => readFile(new URL(`../src/control-window/${name}`, import.meta.url), "utf8")));
  const productionBody = (source, name) => {
    const match = source.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^}`, "m"));
    assert.ok(match, `Missing production function ${name}`);
    return match[0];
  };
  // Clicking the live row clears an explicit (possibly non-consecutive) cue
  // via restorePreviewToLiveOutput; stage Next must be recomputed.
  assert.match(
    productionBody(playback, "loadQueueItemIntoPreviewCue"),
    /await restorePreviewToLiveOutput\(index\);[\s\S]*?refreshStageNotesForLiveItem\(\)[\s\S]*?return;/,
  );
  // Removing or reordering items changes the sequential next (and can drop
  // the cue); both mutations must refresh stage Next.
  for (const name of ["removeFromQueue", "reorderQueueEntriesAtInsertIndex"]) {
    assert.match(
      productionBody(schedule, name),
      /refreshStageNotesForLiveItem\(\)/,
      `${name} refreshes stage Next`,
    );
  }
});

function stageLayerHarness(sessionId = "old-session") {
  const state = {
    stageSessionIdCache: sessionId,
    stageLayerRevisions: new Map(),
    commands: [], sessionWrites: [], createOutputCommand,
    async getStatus() { return { sessionId: "new-session" }; },
    async deliverCommand() { return { delivered: true }; },
    async invoke(channel, command) {
      if (channel === "get-output-status") return state.getStatus();
      assert.equal(channel, "stage-output-command");
      state.commands.push(command);
      return state.deliverCommand(command);
    },
    setSharedRendererState(patch) {
      if (Object.hasOwn(patch, "stageSessionIdCache")) {
        state.sessionWrites.push(patch.stageSessionIdCache);
      }
      Object.assign(state, patch);
    },
  };
  vm.createContext(state);
  for (const name of ["nextStageRevision", "sendStageLayer"]) {
    vm.runInContext(productionFunction(name), state);
  }
  return state;
}

test("stage revisions are reserved before reversed initial status responses", async () => {
  const s = stageLayerHarness("");
  const statuses = [deferred(), deferred()];
  let statusIndex = 0;
  s.getStatus = () => statuses[statusIndex++].promise;
  const first = s.sendStageLayer("content", { current: "Old cue" });
  const firstRevision = s.stageLayerRevisions.get("content");
  const second = s.sendStageLayer("content", { current: "New cue" });
  const secondRevision = s.stageLayerRevisions.get("content");

  statuses[1].resolve({ sessionId: "new-session" });
  assert.equal((await second).delivered, true);
  statuses[0].resolve({ sessionId: "obsolete-session" });
  const result = await first;
  assert.equal(result.delivered, false);
  assert.equal(result.reason, "superseded");
  assert.equal(s.stageSessionIdCache, "new-session");
  assert.deepEqual(s.sessionWrites, ["new-session"]);
  assert.equal(s.commands.length, 1);
  assert.equal(s.commands[0].payload.current, "New cue");
  assert.ok(Number.isSafeInteger(firstRevision));
  assert.ok(secondRevision > firstRevision);
  assert.equal(s.commands[0].revision, secondRevision);
  assert.equal(s.stageLayerRevisions.get("content"), secondRevision);
});

test("a delayed superseded session mismatch cannot adopt a session or retry", async () => {
  const s = stageLayerHarness();
  const mismatch = deferred();
  s.deliverCommand = (command) => command.payload.current === "Old cue"
    ? mismatch.promise : Promise.resolve({ delivered: true });
  const first = s.sendStageLayer("content", { current: "Old cue" });
  s.setSharedRendererState({ stageSessionIdCache: "new-session" });
  assert.equal((await s.sendStageLayer("content", { current: "New cue" })).delivered, true);
  const latestRevision = s.stageLayerRevisions.get("content");

  mismatch.resolve({ delivered: false, reason: "session-mismatch", sessionId: "obsolete-session" });
  const result = await first;
  assert.equal(result.delivered, false);
  assert.equal(result.reason, "superseded");
  assert.equal(s.commands.length, 2);
  assert.equal(s.commands[1].sessionId, "new-session");
  assert.equal(s.stageSessionIdCache, "new-session");
  assert.deepEqual(s.sessionWrites, ["new-session"]);
  assert.equal(s.stageLayerRevisions.get("content"), latestRevision);
});

test("a different stage layer does not supersede an in-flight content retry", async () => {
  const s = stageLayerHarness();
  const mismatch = deferred();
  s.deliverCommand = (command) => command.layer === "content" && command.sessionId === "old-session"
    ? mismatch.promise : Promise.resolve({ delivered: true });
  const content = s.sendStageLayer("content", { current: "Current cue" });
  const contentRevision = s.stageLayerRevisions.get("content");
  s.setSharedRendererState({ stageSessionIdCache: "new-session" });
  assert.equal((await s.sendStageLayer("widgets", { countdown: "10" })).delivered, true);
  const widgetRevision = s.stageLayerRevisions.get("widgets");

  mismatch.resolve({ delivered: false, reason: "session-mismatch", sessionId: "new-session" });
  assert.equal((await content).delivered, true);
  assert.deepEqual(s.commands.map((command) => command.layer), ["content", "widgets", "content"]);
  assert.equal(s.commands[2].revision, contentRevision);
  assert.equal(s.commands[2].sessionId, "new-session");
  assert.equal(s.stageLayerRevisions.get("content"), contentRevision);
  assert.equal(s.stageLayerRevisions.get("widgets"), widgetRevision);
});

for (const refreshStatus of [false, true]) {
  test(`a current stage command retries once with its original revision (${refreshStatus ? "status lookup" : "reported session"})`, async () => {
    const s = stageLayerHarness();
    let statusCalls = 0;
    s.getStatus = async () => { statusCalls += 1; return { sessionId: "new-session" }; };
    s.deliverCommand = async (command) => command.sessionId === "old-session"
      ? { delivered: false, reason: "session-mismatch", ...(refreshStatus ? {} : { sessionId: "new-session" }) }
      : { delivered: true };
    const payload = { countdown: "" };
    assert.equal((await s.sendStageLayer("widgets", payload, "layer.clear")).delivered, true);
    assert.equal(s.commands.length, 2);
    const [first, retry] = s.commands;
    assert.equal(retry.revision, first.revision);
    assert.equal(s.stageLayerRevisions.get("widgets"), first.revision);
    assert.equal(first.sessionId, "old-session");
    assert.equal(retry.sessionId, "new-session");
    assert.equal(retry.type, first.type);
    assert.equal(retry.layer, first.layer);
    assert.equal(retry.payload, payload);
    assert.equal(statusCalls, refreshStatus ? 1 : 0);
  });
}

test("a second session mismatch does not trigger a third stage command", async () => {
  const s = stageLayerHarness();
  s.deliverCommand = async () => ({ delivered: false, reason: "session-mismatch", sessionId: "new-session" });
  const result = await s.sendStageLayer("content", { current: "Current cue" });
  assert.equal(result.delivered, false);
  assert.equal(result.reason, "session-mismatch");
  assert.equal(s.commands.length, 2);
  assert.equal(s.commands[1].revision, s.commands[0].revision);
});

test("a superseded retry status response cannot restore an obsolete session", async () => {
  const s = stageLayerHarness();
  const retryStatus = deferred();
  const retryRequested = deferred();
  s.getStatus = () => { retryRequested.resolve(); return retryStatus.promise; };
  s.deliverCommand = async (command) => command.sessionId === "old-session"
    ? { delivered: false, reason: "session-mismatch" }
    : { delivered: true };
  const first = s.sendStageLayer("content", { current: "Old cue" });
  const firstRevision = s.stageLayerRevisions.get("content");
  await retryRequested.promise;
  const retryRevision = s.stageLayerRevisions.get("content");
  s.setSharedRendererState({ stageSessionIdCache: "new-session" });
  assert.equal((await s.sendStageLayer("content", { current: "New cue" })).delivered, true);
  const latestRevision = s.stageLayerRevisions.get("content");

  retryStatus.resolve({ sessionId: "obsolete-session" });
  const result = await first;
  assert.equal(result.delivered, false);
  assert.equal(result.reason, "superseded");
  assert.equal(retryRevision, firstRevision);
  assert.equal(s.stageLayerRevisions.get("content"), latestRevision);
  assert.equal(s.commands.length, 2);
  assert.equal(s.stageSessionIdCache, "new-session");
  assert.deepEqual(s.sessionWrites, ["", "new-session"]);
});