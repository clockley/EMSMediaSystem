import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { configureConfidenceCaptureRuntime, confidenceCaptureLaunchArguments } from "../src/main-process/confidence-capture-runtime.mjs";

function harness(platform = "linux", electronVersion = "40.10.6", switches = {}) {
  const appended = [];
  const values = new Map(Object.entries(switches));
  const commandLine = {
    hasSwitch: (name) => values.has(name),
    getSwitchValue: (name) => values.get(name) || "",
    appendSwitch(name, value) { appended.push([name, value]); values.set(name, value); },
  };
  return { appended, values, enabled: () => configureConfidenceCaptureRuntime({ platform, electronVersion, commandLine }) };
}

test("Linux Electron 40 native capture requires an initialized X11 backend", () => {
  const h = harness("linux", "40.10.6", { "ozone-platform": "x11" });
  assert.equal(h.enabled(), true);
  assert.deepEqual(h.appended, []);
  assert.equal(h.enabled(), true);
  assert.equal(h.appended.length, 0);
});

for (const backend of ["x11", "wayland", "auto", ""]) {
  test(`Linux Electron 40 stage thumbnail never starts the native crash path (${backend})`, () => {
    let queries = 0;
    const commandLine = { getSwitchValue() { queries++; return backend; } };
    assert.equal(configureConfidenceCaptureRuntime({ platform: "linux", electronVersion: "40.10.6", commandLine, target: "stage" }), false);
    assert.equal(queries, 0, "stage safety must not depend on assuming X11 fixed native capture");
    assert.equal(configureConfidenceCaptureRuntime({ platform: "linux", electronVersion: "40.10.6", commandLine, target: "audience" }), backend === "x11");
  });
}

for (const input of [{ platform: "win32", electronVersion: "40.10.6" },
  { platform: "darwin", electronVersion: "40.10.6" }, { platform: "linux", electronVersion: "41.0.0" }]) {
  test(`stage native capture on unaffected runtimes is unchanged ${JSON.stringify(input)}`, () => {
    assert.equal(configureConfidenceCaptureRuntime({ ...input, target: "stage", commandLine: {} }), true);
  });
}

test("main applies the stage runtime guard independently of native audience capture", async () => {
  const source = await readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8");
  assert.match(source, /const nativeStageConfidenceCaptureEnabled = configureConfidenceCaptureRuntime\(\{[^}]*target: "stage"/);
  const handler = source.match(/^async function handleStagePreviewSource\([\s\S]*?^}/m)?.[0];
  assert.ok(handler);
  assert.ok(handler.indexOf("assertControlSender(event)") < handler.indexOf("if (!nativeStageConfidenceCaptureEnabled) return null"));
  assert.ok(handler.indexOf("if (!nativeStageConfidenceCaptureEnabled) return null") < handler.indexOf("target.getMediaSourceId()"));
  assert.match(source, /if \(!nativeConfidenceCaptureEnabled \|\| !request.videoRequested/);
});

for (const platform of ["win32", "darwin"]) {
  test(`${platform} keeps its normal native backend`, () => {
    const h = harness(platform);
    assert.equal(h.enabled(), true);
    assert.deepEqual(h.appended, []);
  });
}

for (const version of ["39.0.0", "41.0.0", "45.2.3", ""]) {
  test(`other Electron runtime is not silently reconfigured (${version})`, () => {
    const h = harness("linux", version);
    assert.equal(h.enabled(), true);
    assert.deepEqual(h.appended, []);
  });
}

for (const choice of ["wayland", "auto", ""]) {
  test(`explicit platform is respected and unsafe native capture disabled (${choice})`, () => {
    const h = harness("linux", "40.10.6", { "ozone-platform": choice });
    assert.equal(h.enabled(), false);
    assert.equal(h.values.get("ozone-platform"), choice);
    assert.deepEqual(h.appended, []);
  });
}

test("explicit X11 remains native without replacing other Chromium flags", () => {
  const h = harness("linux", "40.10.6", { "ozone-platform": "x11", "disable-features": "ExampleFeature" });
  assert.equal(h.enabled(), true);
  assert.deepEqual(h.appended, []);
  assert.equal(h.values.get("disable-features"), "ExampleFeature");
});

test("automatically selected Wayland is never changed after Chromium initialization", () => {
  const h = harness("linux", "40.10.6", { "ozone-platform": "wayland" });
  assert.equal(h.enabled(), false);
  assert.deepEqual(h.appended, []);
});

test("Node launcher selects X11 before spawning Electron, without disabling GPU", () => {
  const args = [".", "--remote-debugging-port=9222"];
  const selected = confidenceCaptureLaunchArguments({ platform: "linux", electronVersion: "40.10.6", args, x11Available: true });
  assert.deepEqual(selected, [...args, "--ozone-platform=x11"]);
  assert.deepEqual(args, [".", "--remote-debugging-port=9222"]);
});

for (const args of [[".", "--ozone-platform=wayland"], [".", "--ozone-platform", "wayland"], [".", "--ozone-platform=x11"]]) {
  test(`launcher respects explicit platform arguments ${args.join(" ")}`, () => {
    assert.deepEqual(confidenceCaptureLaunchArguments({ platform: "linux", electronVersion: "40.10.6", args, x11Available: true }), args);
  });
}

for (const input of [{ platform: "win32" }, { platform: "darwin" }, { electronVersion: "41.0.0" }, { x11Available: false }]) {
  test(`launcher leaves other environments unchanged ${JSON.stringify(input)}`, () => {
    assert.deepEqual(confidenceCaptureLaunchArguments({ platform: "linux", electronVersion: "40.10.6", args: ["."], x11Available: true, ...input }), ["."]);
  });
}

test("development launch commands both use the safe pre-Electron launcher", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const name of ["start", "start-paid"]) assert.match(manifest.scripts[name], /node build-scripts\/launch-electron\.mjs/);
  const launcher = await readFile(new URL("../build-scripts/launch-electron.mjs", import.meta.url), "utf8");
  assert.ok(launcher.indexOf("const args = confidenceCaptureLaunchArguments(") < launcher.indexOf("const child = spawn("));
  assert.match(launcher, /ELECTRON_RUN_AS_NODE: ""/);
});

test("runtime selection runs before application ready and window creation", async () => {
  const source = await readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8");
  const configured = source.indexOf("const nativeConfidenceCaptureEnabled = configureConfidenceCaptureRuntime(");
  assert.ok(configured > 0);
  assert.ok(configured < source.indexOf("new BrowserWindow("));
  assert.ok(configured < source.indexOf("app.whenReady()"));
});