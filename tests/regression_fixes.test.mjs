import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { themeBackdropCornerRadius, themeSafeMargin } from "../src/shared/theme-editor-values.mjs";
import { isWindowOnConnectedDisplay, isWindowTiled } from "../src/shared/window-layout.mjs";

test("theme editor preserves explicit zero safe margins", () => {
  assert.equal(themeSafeMargin(0), 0);
  assert.equal(themeSafeMargin("0"), 0);
  assert.equal(themeSafeMargin(undefined), 0.06);
  assert.equal(themeSafeMargin("not-a-number"), 0.06);
});

test("theme editor preserves an explicit square backdrop", () => {
  assert.equal(themeBackdropCornerRadius(0), 0);
  assert.equal(themeBackdropCornerRadius("0"), 0);
  assert.equal(themeBackdropCornerRadius(undefined), 8);
  assert.equal(themeBackdropCornerRadius("not-a-number"), 8);
});

test("tiled windows use the selected display's coordinate origin", () => {
  const secondary = { x: 1920, y: -200, width: 1600, height: 1000 };
  assert.equal(isWindowTiled({ x: 1920, y: -200, width: 800, height: 1000 }, secondary), true);
  assert.equal(isWindowTiled({ x: 2720, y: -200, width: 800, height: 500 }, secondary), true);
  assert.equal(isWindowTiled({ x: 2100, y: 0, width: 900, height: 600 }, secondary), false);
});

test("window connectivity uses the window origin and current display bounds", () => {
  const displays = [
    { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { bounds: { x: 1920, y: -200, width: 1600, height: 1000 } },
  ];
  assert.equal(isWindowOnConnectedDisplay({ x: 1920, y: -200 }, displays), true);
  assert.equal(isWindowOnConnectedDisplay({ x: 4000, y: 0 }, displays), false);
});

test("output windows install cleanup before loading their renderer", async () => {
  const source = await readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8");
  const audience = source.slice(source.indexOf("const createdMediaWindow"), source.indexOf("async function handleCreateLowerThirdWindow"));
  const lowerThird = source.slice(source.indexOf("const createdLowerThirdWindow"), source.indexOf("function currentOutputStatus"));
  const stage = source.slice(source.indexOf("const created = new BrowserWindow", source.indexOf("async function handleCreateStageWindow")), source.indexOf("function handleStageOutputCommand"));
  assert.ok(audience.indexOf('once("closed"') < audience.indexOf("await createdMediaWindow.loadFile"));
  assert.ok(lowerThird.indexOf('once("closed"') < lowerThird.indexOf("await createdLowerThirdWindow.loadFile"));
  assert.ok(stage.indexOf('once("closed"') < stage.indexOf("await created.loadFile"));
  assert.match(audience, /catch \(error\)[\s\S]*createdMediaWindow\.destroy\(\)[\s\S]*throw error/);
  assert.match(lowerThird, /catch \(error\)[\s\S]*createdLowerThirdWindow\.destroy\(\)[\s\S]*throw error/);
  assert.match(stage, /catch \(error\)[\s\S]*created\.destroy\(\)[\s\S]*throw error/);
});

test("display changes relocate and restore the lower-third window", async () => {
  const source = await readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8");
  const displayChange = source.slice(source.indexOf("async function handleDisplayChange"), source.indexOf("function handlePlayCtl"));
  assert.match(displayChange, /if \(lowerThirdWindow && !lowerThirdWindow\.isDestroyed\(\)\)/);
  assert.match(displayChange, /wasLowerThirdDisplayDisconnected = true/);
  assert.match(displayChange, /settings\.getSync\("lastLowerThirdDisplayIndex"\)/);
  assert.match(displayChange, /wasLowerThirdDisplayDisconnected = false/);
});

test("application shutdown includes settings persistence in awaited cleanup", async () => {
  const source = await readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8");
  const beforeQuit = source.slice(source.indexOf('app.on("before-quit"'), source.indexOf('app.on("activate"'));
  assert.match(beforeQuit, /const cleanupTasks = \[cleanupMediaStagingDir\(\), settings\.flush\(\)\]/);
  assert.match(beforeQuit, /Promise\.allSettled\(cleanupTasks\)\.finally\(\(\) => \{\s*app\.quit\(\)/);
});

test("project files are committed only after renderer application succeeds", async () => {
  const main = await readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8");
  const readHandler = main.slice(
    main.indexOf("async function handleReadProjectFile"),
    main.indexOf("async function handleCommitProjectFileOpen"),
  );
  assert.doesNotMatch(readHandler, /activeProjectSnapshot\s*=/);
  assert.match(readHandler, /pendingProjectLoadsBySender\.set/);

  const renderer = await readFile(
    new URL("../src/control-window/app-project-session.mjs", import.meta.url),
    "utf8",
  );
  const openHandler = renderer.slice(
    renderer.indexOf("async function openProjectByPath"),
    renderer.indexOf("async function saveProjectAsDialog"),
  );
  assert.ok(
    openHandler.indexOf('invoke("commit-project-file-open"') >
      openHandler.indexOf("applyProjectStateSnapshot"),
  );
  assert.match(openHandler, /invoke\("discard-project-file-open"/);
});

test("renderer file logging and its machine-specific path are removed", async () => {
  const sources = await Promise.all([
    readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8"),
    readFile(
      new URL("../src/control-window/app-song-slides-workspace.mjs", import.meta.url),
      "utf8",
    ),
  ]);
  for (const source of sources) {
    assert.doesNotMatch(source, /log-to-file|renderer_log\.txt/);
  }
});
