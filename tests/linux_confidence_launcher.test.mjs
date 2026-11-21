import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, chmod, rm, mkdir, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { installLinuxConfidenceLauncher } = require("../build-scripts/linux-confidence-launcher.cjs");
const run = promisify(execFile);

async function harness(t, name = "emsmediasystem") {
  const root = await mkdtemp(path.join(tmpdir(), "ems-linux-launcher-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appOutDir = path.join(root, "opt", "EMS Media System");
  await mkdir(appOutDir, { recursive: true });
  const executable = path.join(appOutDir, name);
  const original = `#!/usr/bin/env node\nconsole.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),appImage:process.env.APPIMAGE,node:process.env.ELECTRON_RUN_AS_NODE}));process.exit(Number(process.env.EMS_TEST_EXIT||0));\n`;
  await writeFile(executable, original, { mode: 0o751 });
  const context = { appOutDir, electronPlatformName: "linux", packager: { executableName: name, config: {}, info: { framework: { version: "40.10.6" } } } };
  const launch = async (entry = executable, args = [], environment = {}) => {
    const { stdout } = await run(entry, args, { cwd: root, env: { ...process.env, DISPLAY: ":0", ELECTRON_RUN_AS_NODE: "", ...environment } });
    return JSON.parse(stdout);
  };
  return { root, executable, original, context, launch };
}

test("packaged Linux runtime is preserved and X11 injected before Electron starts", async (t) => {
  const h = await harness(t);
  assert.equal(await installLinuxConfidenceLauncher(h.context), true);
  assert.equal(await readFile(`${h.executable}.bin`, "utf8"), h.original);
  assert.equal((await stat(`${h.executable}.bin`)).mode & 0o777, 0o751);
  assert.equal((await stat(h.executable)).mode & 0o777, 0o755);
  const result = await h.launch(h.executable, ["project with spaces.emproj", "--remote-debugging-port=9222", "", "quote'and\"double"]);
  assert.deepEqual(result.args, ["--ozone-platform=x11", "project with spaces.emproj", "--remote-debugging-port=9222", "", "quote'and\"double"]);
  assert.equal(result.cwd, h.root);
});

for (const [label, args, env] of [
  ["explicit Wayland", ["--ozone-platform=wayland", "file.emproj"], {}],
  ["separate platform argument", ["--ozone-platform", "wayland"], {}],
  ["explicit X11", ["--ozone-platform=x11"], {}],
  ["no X server", ["file.emproj"], { DISPLAY: "" }],
  ["Node sidecar invocation", ["sidecar.mjs"], { ELECTRON_RUN_AS_NODE: "1" }],
]) {
  test(`packaged launcher preserves ${label}`, async (t) => {
    const h = await harness(t);
    await installLinuxConfidenceLauncher(h.context);
    assert.deepEqual((await h.launch(h.executable, args, env)).args, args);
  });
}

test("installed RPM/DEB command symlink resolves to the adjacent real runtime", async (t) => {
  const h = await harness(t);
  await installLinuxConfidenceLauncher(h.context);
  const binDir = path.join(h.root, "usr", "bin");
  await mkdir(binDir, { recursive: true });
  const link = path.join(binDir, "ems");
  await symlink(path.relative(binDir, h.executable), link);
  assert.deepEqual((await h.launch(link, ["project.emproj"])).args, ["--ozone-platform=x11", "project.emproj"]);
});

test("AppImage AppRun and direct executable share the same launcher", async (t) => {
  const h = await harness(t);
  await installLinuxConfidenceLauncher(h.context);
  const appRun = path.join(h.context.appOutDir, "AppRun");
  await writeFile(appRun, `#!/bin/sh\nexec "$(dirname -- "$0")/emsmediasystem" "$@"\n`, { mode: 0o755 });
  const result = await h.launch(appRun, ["file.emproj"], { APPIMAGE: "/somewhere/EMS Media System.AppImage" });
  assert.deepEqual(result.args, ["--ozone-platform=x11", "file.emproj"]);
  assert.equal(result.appImage, "/somewhere/EMS Media System.AppImage");
});

test("shell-safe executable names and nonzero runtime exit codes are preserved", async (t) => {
  const h = await harness(t, "EMS app's test");
  await installLinuxConfidenceLauncher(h.context);
  assert.deepEqual((await h.launch()).args, ["--ozone-platform=x11"]);
  await assert.rejects(h.launch(h.executable, [], { EMS_TEST_EXIT: "17" }), (error) => error.code === 17);
});

test("repeated packaging hooks are idempotent and do not overwrite the runtime", async (t) => {
  const h = await harness(t);
  await installLinuxConfidenceLauncher(h.context);
  await installLinuxConfidenceLauncher(h.context);
  assert.equal(await readFile(`${h.executable}.bin`, "utf8"), h.original);
  assert.deepEqual((await h.launch()).args, ["--ozone-platform=x11"]);
});

for (const input of [{ electronPlatformName: "win32" }, { electronPlatformName: "darwin" }, { version: "41.0.0" }]) {
  test(`other packaged runtimes remain unchanged ${JSON.stringify(input)}`, async (t) => {
    const h = await harness(t);
    if (input.version) h.context.packager.info.framework.version = input.version;
    else h.context.electronPlatformName = input.electronPlatformName;
    assert.equal(await installLinuxConfidenceLauncher(h.context), false);
    assert.equal(await readFile(h.executable, "utf8"), h.original);
  });
}

for (const failure of ["collision", "not-executable", "bad-name", "unknown-version", "fuses"]) {
  test(`unsafe packaging fails explicitly (${failure})`, async (t) => {
    const h = await harness(t);
    if (failure === "collision") await writeFile(`${h.executable}.bin`, "do not overwrite");
    if (failure === "not-executable") await chmod(h.executable, 0o644);
    if (failure === "bad-name") h.context.packager.executableName = "../outside";
    if (failure === "unknown-version") h.context.packager.info.framework.version = undefined;
    if (failure === "fuses") h.context.packager.config.electronFuses = { runAsNode: false };
    await assert.rejects(installLinuxConfidenceLauncher(h.context));
    assert.equal(await readFile(h.executable, "utf8"), h.original);
  });
}

test("shared afterPack hook preserves Bible verification and covers every Linux target", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.build.afterPack, "build-scripts/after-pack.cjs");
  const hook = await readFile(new URL("../build-scripts/after-pack.cjs", import.meta.url), "utf8");
  assert.match(hook, /await verifyPackagedBibleAssets\(context\)/);
  assert.match(hook, /await installLinuxConfidenceLauncher\(context\)/);
  assert.doesNotMatch(hook, /context\.targets/);
});