import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { sanitizeStageContentPayload, stageDeckKey } from "../src/main-process/stage-item-media.mjs";
import {
  applyOutputCommand,
  createCompositorState,
  createOutputCommand,
  validateOutputCommand,
} from "../src/shared/output-compositor.mjs";

const main = await readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));

for (const reason of ["stale-revision", "session-mismatch"]) {
  for (const health of ["ok", "degraded"]) {
    test(`obsolete stage ${reason} acknowledgement preserves ${health} health and confidence capture`, () => {
      const state = { stageWindow: { webContents: {} }, stageHealth: health, statusUpdates: 0, forwarded: [] };
      state.win = { isDestroyed: () => false, webContents: { send: (...args) => state.forwarded.push(args) } };
      state.publishOutputStatus = () => { state.statusUpdates++; };
      state.ipcMain = { on: (_channel, callback) => { state.ack = callback; } };
      const listener = main.match(/^  ipcMain\.on\("stage-output-ack", \(event, acknowledgement\) => \{[\s\S]*?^  \}\);/m);
      assert.ok(listener);
      vm.runInNewContext(listener[0], state);
      const ack = { applied: false, error: reason };
      state.ack({ sender: state.stageWindow.webContents }, ack);
      assert.equal(state.stageHealth, health);
      assert.equal(state.statusUpdates, 0, "obsolete ACK must not tear down or reacquire confidence capture");
      assert.deepEqual(state.forwarded, [["stage-output-ack", ack]]);
      state.ack({ sender: {} }, { applied: true });
      assert.equal(state.stageHealth, health, "wrong window cannot change stage health");
      state.ack({ sender: state.stageWindow.webContents }, { applied: false, error: "real render failure" });
      assert.equal(state.stageHealth, "degraded");
      assert.equal(state.statusUpdates, 1);
      state.ack({ sender: state.stageWindow.webContents }, { applied: true });
      assert.equal(state.stageHealth, "ok");
      assert.equal(state.statusUpdates, 2);
    });
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fn(name) {
  const match = main.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^}`, "m"));
  assert.ok(match, name);
  return match[0];
}

function harness() {
  let nextId = 0;
  const s = {
    stageWindow: null,
    stageWindowCreatePromise: null,
    stageSessionId: "previous-session",
    audienceSessionId: "audience-session",
    stageHealth: "inactive",
    stageLayerCommands: new Map(),
    audienceLayerCommands: new Map(),
    outputLayerRevisions: new Map(),
    stageNextPptxPath: "",
    stageNextPptxKey: "",
    stageLocalMedia: null,
    stageCurrentPptxPath: "",
    stagePptxBytesCache: new Map(),
    alertState: { live: null },
    derivedSrcDir: "/derived/src",
    STAGE_DISPLAY_KEY: "stageDisplay",
    path,
    console,
    createOutputCommand,
    validateOutputCommand,
    sanitizeStageContentPayload,
    sanitizeCalls: 0,
    sanitizeInputs: [],
    resolveStageMediaLocalPath: (value) => path.isAbsolute(value) ? value : "",
    randomUUID: () => `uuid-${++nextId}`,
    resolveDisplaySelection: (value) => ({ value, display: { bounds: { x: 1920, y: 0, width: 1920, height: 1080 } } }),
    fullscreenWindowBoundsForDisplay: (display) => display.bounds,
    publishOutputStatus() {},
    closeStageAudienceRelay() {},
    sendStageLocalMedia() {},
    publishStageAudienceSource() {},
    settingsEntered: deferred(),
    settingsRequests: [],
    reads: [],
    async readFile(localPath) {
      s.reads.push(localPath);
      return Buffer.from("saved PowerPoint bytes");
    },
  };
  s.sanitizeStageContentPayload = (...args) => {
    s.sanitizeCalls += 1;
    s.sanitizeInputs.push(args[0]);
    return sanitizeStageContentPayload(...args);
  };
  s.settings = {
    set(key, value) {
      const request = { key, value, ...deferred() };
      s.settingsRequests.push(request);
      s.settingsEntered.resolve(request);
      s.settingsEntered = deferred();
      return request.promise;
    },
  };
  s.BrowserWindow = class extends EventEmitter {
    constructor(options) {
      super();
      this.id = ++nextId;
      this.options = options;
      this.destroyed = false;
      this.load = deferred();
      this.webContents = {
        isDestroyed: () => this.destroyed,
        messages: [],
        send: (channel, command) => this.webContents.messages.push([channel, command]),
      };
    }
    isDestroyed() { return this.destroyed; }
    setAlwaysOnTop() {}
    setBounds() {}
    setFullScreen() {}
    loadFile(file) { this.loadedFile = file; return this.load.promise; }
    destroy() { this.destroyed = true; this.emit("closed"); }
  };
  s.win = { webContents: {} };
  s.listeners = {};
  s.ipcMain = { on: (channel, callback) => { s.listeners[channel] = callback; } };
  vm.createContext(s);
  for (const name of [
    "nextOutputLayerRevision", "outputSessionForRole", "outputCommandsForRole", "outputWindowForRole",
    "sanitizeAndStoreStageContentPayload", "sendOutputLayer", "handleCreateStageWindow",
    "handleStageOutputCommand", "handleStageNextPptx",
  ]) {
    vm.runInContext(fn(name), s);
  }
  const ready = main.match(/^  ipcMain\.on\("stage-output-ready", \(event\) => \{[\s\S]*?^  \}\);/m);
  assert.ok(ready, "stage readiness listener");
  vm.runInContext(ready[0], s);
  s.command = (layer, revision, payload = {}, type = "layer.set", sessionId = s.stageSessionId) => createOutputCommand({
    commandId: `control-${++nextId}`, sessionId, revision, targetRole: "stage", type, layer, payload,
  });
  s.accept = (command) => s.handleStageOutputCommand({ sender: s.win.webContents }, command);
  s.ready = (sender = s.stageWindow.webContents) => s.listeners["stage-output-ready"]({ sender });
  s.replay = () => {
    s.stageWindow.webContents.messages.length = 0;
    s.ready();
    return s.stageWindow.webContents.messages.map(([, command]) => command);
  };
  s.loadSettings = async () => {
    const entered = s.settingsEntered.promise;
    s.stageWindow.load.resolve();
    return entered;
  };
  s.finish = async (opening) => {
    const request = await s.loadSettings();
    request.resolve();
    return opening;
  };
  return s;
}

function seedSavedLayers(s) {
  s.sendOutputLayer("stage", "content", { current: "Saved current", next: "Saved next" });
  s.sendOutputLayer("stage", "widgets", { countdown: "1:23", notes: "Saved notes" });
  s.sendOutputLayer("stage", "alert", { message: "Old alert" });
  s.sendOutputLayer("stage", "privateMessage", { message: "Old private message" });
}

test("creation seeds saved content/widgets before load and readiness/reload never replay old messages", async () => {
  const s = harness();
  seedSavedLayers(s);
  s.outputLayerRevisions.set("audience:alert", 91);
  const saved = new Map(s.stageLayerCommands);
  const opening = s.handleCreateStageWindow(null, "secondary");
  assert.notEqual(s.stageSessionId, "previous-session");
  assert.ok(s.stageWindow.loadedFile, "loadFile is pending");
  assert.deepEqual([...s.stageLayerCommands.keys()], ["content", "widgets"]);
  assert.equal(s.outputLayerRevisions.has("stage:alert"), false);
  assert.equal(s.outputLayerRevisions.has("stage:privateMessage"), false);
  assert.equal(s.outputLayerRevisions.get("audience:alert"), 91);
  for (const [layer, command] of s.stageLayerCommands) {
    assert.equal(command.sessionId, s.stageSessionId);
    assert.notEqual(command.commandId, saved.get(layer).commandId);
    assert.equal(command.revision, 1);
    assert.equal(command.payload, saved.get(layer).payload, "saved sanitized payload is reused");
    assert.equal(s.outputLayerRevisions.get(`stage:${layer}`), command.revision);
  }
  const commands = s.replay();
  assert.deepEqual(commands.map((command) => command.layer), ["content", "widgets"]);
  let compositor = createCompositorState("stage", s.stageSessionId);
  for (const command of commands) {
    const applied = applyOutputCommand(compositor, command);
    assert.equal(applied.applied, true);
    compositor = applied.state;
  }
  assert.equal(compositor.layers.content.current, "Saved current");
  assert.equal(compositor.layers.widgets.countdown, "1:23");
  assert.equal(compositor.layers.alert, null);
  assert.equal(compositor.layers.privateMessage, null);
  assert.equal(s.sanitizeCalls, 1, "restore must not re-sanitize content");
  s.stageWindow.webContents.messages.length = 0;
  s.ready(s.win.webContents);
  assert.equal(s.stageWindow.webContents.messages.length, 0, "only stage can request replay");
  await s.finish(opening);
  assert.equal(s.stageWindow.webContents.messages.length, 0, "load completion must not send stale snapshots");
  assert.deepEqual(s.replay(), commands, "reload replays the same cached commands without new revisions");
});

for (const phase of ["loadFile", "settings"]) {
  test(`new content and widgets during deferred ${phase} survive creation and reload`, async () => {
    const s = harness();
    seedSavedLayers(s);
    const opening = s.handleCreateStageWindow(null, "secondary");
    const request = phase === "settings" ? await s.loadSettings() : null;
    const content = s.command("content", 40, { current: "New current", next: "New next" });
    const widgets = s.command("widgets", 50, { countdown: "0:12" });
    assert.equal(s.accept(content).delivered, true);
    assert.equal(s.accept(widgets).delivered, true);
    const acceptedContent = s.stageLayerCommands.get("content");
    assert.equal(acceptedContent.payload.current, "New current");
    s.stageWindow.webContents.messages.length = 0;
    if (request) { request.resolve(); await opening; }
    else await s.finish(opening);
    assert.equal(s.stageLayerCommands.get("content"), acceptedContent);
    assert.equal(s.stageLayerCommands.get("widgets"), widgets);
    assert.equal(s.stageWindow.webContents.messages.length, 0, "no post-await content/widget restore");
    assert.deepEqual(s.replay(), [acceptedContent, widgets]);
    assert.equal(s.sanitizeCalls, 2, "only original and new control content are sanitized");
  });

  for (const layer of ["content", "widgets"]) {
    test(`${layer} clear during deferred ${phase} cannot be resurrected by restore or reload`, async () => {
      const s = harness();
      seedSavedLayers(s);
      const opening = s.handleCreateStageWindow(null, "secondary");
      const request = phase === "settings" ? await s.loadSettings() : null;
      const clear = s.command(layer, 70, {}, "layer.clear");
      assert.equal(s.accept(clear).delivered, true);
      s.stageWindow.webContents.messages.length = 0;
      if (request) { request.resolve(); await opening; }
      else await s.finish(opening);
      assert.equal(s.stageLayerCommands.has(layer), false);
      assert.equal(s.outputLayerRevisions.get(`stage:${layer}`), 70);
      assert.equal(s.stageWindow.webContents.messages.length, 0);
      assert.deepEqual(s.replay().map((command) => command.layer), [layer === "content" ? "widgets" : "content"]);
      assert.equal(s.accept(s.command(layer, 69, { current: "Stale" })).reason, "stale-revision");
      assert.equal(s.stageLayerCommands.has(layer), false);
    });
  }
}

test("recreation preserves an already-sanitized Next PPTX deck key and private path", async () => {
  const s = harness();
  const localPath = "/private/Service deck.pptx";
  const saved = s.sendOutputLayer("stage", "content", {
    current: "Saved slide", nextMedia: { kind: "pptx", sourcePath: localPath, slideIndex: 4, revision: "deck-2" },
  });
  const deckKey = stageDeckKey(localPath, "deck-2");
  assert.equal(saved.payload.nextMedia.deckKey, deckKey);
  assert.equal("sourcePath" in saved.payload.nextMedia, false);
  for (let recreation = 0; recreation < 2; recreation += 1) {
    const previousSession = s.stageSessionId;
    const opening = s.handleCreateStageWindow(null, "secondary");
    assert.notEqual(s.stageSessionId, previousSession);
    await s.finish(opening);
    const [restored] = s.replay();
    assert.equal(restored.payload, saved.payload);
    assert.equal(restored.payload.nextMedia.deckKey, deckKey);
    assert.equal(s.stageNextPptxPath, localPath);
    assert.equal(s.stageNextPptxKey, deckKey);
    assert.equal(s.sanitizeCalls, 1);
    assert.equal(JSON.stringify(restored).includes(localPath), false);
    s.stagePptxBytesCache.clear();
    const event = { sender: s.stageWindow.webContents };
    assert.equal(await s.handleStageNextPptx(event, "unlisted-deck"), null);
    const bytes = await s.handleStageNextPptx(event, deckKey);
    assert.equal(Buffer.from(bytes).toString(), "saved PowerPoint bytes");
    assert.equal(s.reads.at(-1), localPath);
    s.stageWindow.destroy();
  }
  assert.equal(s.reads.length, 2);
});

for (const layer of ["content", "widgets", "alert", "privateMessage"]) {
  test(`${layer} revision watermark survives clear and main commands advance beyond control`, async () => {
    const s = harness();
    await s.finish(s.handleCreateStageWindow(null, "secondary"));
    let compositor = createCompositorState("stage", s.stageSessionId);
    const send = (command) => {
      assert.equal(s.accept(command).delivered, true);
      const forwarded = s.stageWindow.webContents.messages.at(-1)[1];
      const applied = applyOutputCommand(compositor, forwarded);
      assert.equal(applied.applied, true);
      compositor = applied.state;
    };
    send(s.command(layer, 40, { message: "New", current: "New" }));
    assert.equal(s.outputLayerRevisions.get(`stage:${layer}`), 40);
    const fromMain = s.sendOutputLayer("stage", layer, { message: "Main", current: "Main" });
    assert.equal(fromMain.revision, 41);
    const applied = applyOutputCommand(compositor, fromMain);
    assert.equal(applied.applied, true);
    compositor = applied.state;
    send(s.command(layer, 80, {}, "layer.clear"));
    assert.equal(s.stageLayerCommands.has(layer), false);
    assert.equal(s.outputLayerRevisions.get(`stage:${layer}`), 80);
    const delivered = s.stageWindow.webContents.messages.length;
    const sanitized = s.sanitizeCalls;
    for (const revision of [39, 79, 80]) {
      for (const type of ["layer.set", "layer.clear"]) {
        assert.equal(s.accept(s.command(layer, revision, { message: "Stale", current: "Stale" }, type)).reason, "stale-revision");
      }
    }
    assert.equal(s.stageLayerCommands.has(layer), false);
    assert.equal(s.stageWindow.webContents.messages.length, delivered);
    assert.equal(s.sanitizeCalls, sanitized, "stale content must not change the PPTX allow-list");
    const mainClear = s.sendOutputLayer("stage", layer, null);
    assert.equal(mainClear.revision, 81);
    assert.equal(applyOutputCommand(compositor, mainClear).applied, true);
    const mainSet = s.sendOutputLayer("stage", layer, { message: "Latest", current: "Latest" });
    assert.equal(mainSet.revision, 82);
    assert.equal(applyOutputCommand(compositor, mainSet).applied, true);
  });
}

test("wrong-session and foreign commands cannot advance the accepted revision watermark", async () => {
  const s = harness();
  await s.finish(s.handleCreateStageWindow(null, "secondary"));
  const foreign = s.command("content", 900, { current: "Foreign" });
  assert.throws(() => s.handleStageOutputCommand({ sender: {} }, foreign), /only from the control window/);
  const mismatch = s.accept(s.command("content", 900, {}, "layer.clear", "old-session"));
  assert.deepEqual(plain(mismatch), { delivered: false, reason: "session-mismatch", sessionId: s.stageSessionId });
  assert.equal(s.outputLayerRevisions.has("stage:content"), false);
  assert.equal(s.accept(s.command("content", 0, { current: "Revision zero" })).delivered, true);
  assert.equal(s.accept(s.command("content", 0, {}, "layer.clear")).reason, "stale-revision");
  assert.equal(s.sendOutputLayer("stage", "content", { current: "Main" }).revision, 1);
});

test("accepted commands while closed keep revision watermarks even when transient payloads are dropped", () => {
  const s = harness();
  for (const layer of ["content", "widgets", "alert", "privateMessage"]) {
    assert.equal(s.accept(s.command(layer, 30, { message: "Closed", current: "Closed" })).reason, "stage-closed");
    assert.equal(s.stageLayerCommands.has(layer), layer === "content" || layer === "widgets");
    assert.equal(s.accept(s.command(layer, 50, {}, "layer.clear")).reason, "stage-closed");
    assert.equal(s.outputLayerRevisions.get(`stage:${layer}`), 50);
    assert.equal(s.accept(s.command(layer, 49)).reason, "stale-revision");
    assert.equal(s.sendOutputLayer("stage", layer, null).revision, 51);
  }
});