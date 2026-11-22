import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8");

for (const [platform, paths, derivedSrcDir] of [
  ["linux development", path.posix, "/workspace with spaces/derived/src"],
  ["linux packaged", path.posix, "/opt/EMS Media System/resources/app.asar/derived/src"],
  ["windows packaged", path.win32, "C:\\EMS Media System\\resources\\app.asar\\derived\\src"],
]) {
  for (const handler of ["handleCreateMediaWindow", "handleCreateLowerThirdWindow"]) {
    for (const supplied of [false, true]) {
      test(`${handler} owns its canonical preload (${platform}, caller supplied=${supplied})`, async () => {
        const stopped = new Error("constructor intercepted");
        let captured;
        const session = {};
        const selection = { value: "display:1", display: { bounds: { x: 0, y: 0, width: 1920, height: 1080 } } };
        const state = {
          path: paths, derivedSrcDir, mediaPresentationSession: session,
          mediaWindow: null, lowerThirdWindow: null,
          mediaWindowCreatePromise: null, lowerThirdWindowCreatePromise: null,
          audienceSessionId: "old-session", audienceLayerCommands: new Map(),
          outputLayerRevisions: new Map(), audienceContentKind: "none",
          MEDIA_WINDOW_BACKGROUND_COLOR: "#000", randomUUID: () => "new-session",
          hasActiveAlerts: () => false,
          resolveDisplaySelection: () => selection,
          fullscreenWindowBoundsForDisplay: (display) => display.bounds,
          measurePerformance: async (_label, action) => action(),
          BrowserWindow: class { constructor(options) { captured = options; throw stopped; } },
        };
        const implementation = source.match(new RegExp(`^async function ${handler}\\([\\s\\S]*?^}`, "m"))?.[0];
        assert.ok(implementation);
        vm.createContext(state);
        vm.runInContext(implementation, state);
        const preferences = { sandbox: true, contextIsolation: true, additionalArguments: ["__isText"] };
        if (supplied) preferences.preload = `${derivedSrcDir}/control-window/../media-window/media_preload.min.js`;
        await assert.rejects(state[handler]({}, { webPreferences: preferences }, selection.value), (error) => error === stopped);
        const preload = captured.webPreferences.preload;
        assert.equal(preload, paths.join(derivedSrcDir, "media-window", "media_preload.min.js"));
        assert.ok(paths.isAbsolute(preload));
        assert.equal(paths.normalize(preload), preload);
        assert.equal(preload.split(/[\\/]/).includes(".."), false);
        assert.equal(captured.webPreferences.session, session);
        assert.equal(captured.webPreferences.sandbox, true);
        assert.equal(captured.webPreferences.contextIsolation, true);
        assert.ok(captured.webPreferences.additionalArguments.includes("__isText"));
        assert.deepEqual(preferences.additionalArguments, ["__isText"], "incoming preferences remain untouched");
      });
    }
  }
}
test("audience replacements serialize close and creation, and recover after a failed launch", async () => {
  const { EventEmitter } = await import("node:events");
  let nextId = 0;
  const windows = [];
  class Window extends EventEmitter {
    constructor() {
      super();
      assert.ok(windows.every(win => win.destroyed), "only one audience window may exist");
      this.id = ++nextId;
      windows.push(this);
    }
    isDestroyed() { return Boolean(this.destroyed); }
    close() {
      assert.ok(!this.closing, "a window is closed exactly once");
      this.closing = true;
      setImmediate(() => this.destroy());
    }
    destroy() { this.destroyed = true; this.emit("closed"); }
    async loadFile() { if (this.id === 2) throw new Error("load failed"); }
    setBounds() {}
  }
  const state = vm.createContext({
    path, derivedSrcDir: "/derived/src", mediaPresentationSession: {},
    mediaWindow: new Window(), mediaWindowCreatePromise: null, BrowserWindow: Window,
    win: null, audienceLayerCommands: new Map(), outputLayerRevisions: new Map(),
    audienceContentKind: "none", randomUUID: () => "session", hasActiveAlerts: () => false,
    resolveDisplaySelection: value => value ? { display: {}, value } : null,
    fullscreenWindowBoundsForDisplay: () => ({}), measurePerformance: (_label, action) => action(),
    additionalArgumentValue() {}, waitForAudienceOutputBootstrap: () => ({ promise: Promise.resolve(), cancel() {} }),
    applyMediaWindowPresentationMode() {}, installTimeRemainingMessagePort() {}, publishOutputStatus() {},
    stopMediaPlaybackPowerHint() {}, settings: { set: async () => {} },
  });
  vm.runInContext(source.match(/^async function handleCreateMediaWindow\([\s\S]*?^}/m)[0], state);
  assert.equal(await state.handleCreateMediaWindow(null, {}, ""), null);
  assert.equal(windows[0].closing, undefined);
  const failed = state.handleCreateMediaWindow(null, {}, "display");
  const fresh = state.handleCreateMediaWindow(null, {}, "display");
  const overlay = state.handleCreateMediaWindow(null, { webPreferences: { additionalArguments: ["__alertOverlayOnly=true"] } }, "display");
  const last = state.handleCreateMediaWindow(null, {}, "display");
  await assert.rejects(failed, /load failed/);
  assert.equal(await fresh, 3);
  assert.equal(await overlay, 3);
  assert.equal(await last, 4);
  assert.deepEqual(windows.filter(win => !win.destroyed).map(win => win.id), [4]);
});
