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