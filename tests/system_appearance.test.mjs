import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { installSystemAppearance, parseGnomeColorScheme } from "../src/main-process/system-appearance.mjs";

function harness(overrides = {}) {
  const assignments = [];
  let source = "dark";
  const nativeTheme = {
    get themeSource() { return source; },
    set themeSource(value) { source = value; assignments.push(value); },
  };
  const monitor = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kills: 0,
    kill() { this.kills++; },
  });
  const options = { nativeTheme, platform: "linux", env: { XDG_CURRENT_DESKTOP: "ubuntu:GNOME" },
    readSetting: async () => "'prefer-dark'\n", watchSetting: () => monitor, ...overrides };
  return { assignments, nativeTheme, monitor, options,
    start: () => installSystemAppearance(options),
    change: (data) => monitor.stdout.emit("data", Buffer.from(data)),
  };
}

for (const [raw, expected] of [["'prefer-dark'\n", "dark"], ["'prefer-light'", "light"], ["'default'", "light"],
  ["color-scheme: 'prefer-dark'", "dark"], ["color-scheme: 'default'\r\n", "light"], [" ", null],
  [undefined, null], ["'unknown'", null], ["gtk-theme: 'dark'", null], ["garbage 'prefer-dark'", null]]) {
  test(`GNOME appearance parsing ${JSON.stringify(raw)}`, () => assert.equal(parseGnomeColorScheme(raw), expected));
}

test("startup follows GNOME, and real preference updates drive both light and dark", async () => {
  const h = harness();
  const dispose = await h.start();
  assert.deepEqual(h.assignments, ["system", "dark"]);
  h.change("color-scheme: 'prefer-light'\n");
  assert.equal(h.nativeTheme.themeSource, "light");
  h.change("color-scheme: 'prefer-dark'\n");
  assert.equal(h.nativeTheme.themeSource, "dark");
  h.change("color-scheme: 'default'\n");
  assert.equal(h.nativeTheme.themeSource, "light", "normal GNOME appearance must not be overridden by a legacy GTK dark theme");
  dispose(); dispose();
  assert.equal(h.nativeTheme.themeSource, "system");
  assert.equal(h.monitor.kills, 1);
  assert.equal(h.monitor.stdout.listenerCount("data"), 0);
  h.change("color-scheme: 'prefer-dark'\n");
  h.monitor.emit("error", new Error("late process error"));
  h.monitor.emit("close", 1);
  assert.equal(h.nativeTheme.themeSource, "system");
});

test("monitor chunks are buffered, invalid values ignored, duplicate values cause no theme churn", async () => {
  const h = harness(); const dispose = await h.start();
  h.change("color-scheme: 'prefer-");
  assert.equal(h.nativeTheme.themeSource, "dark");
  h.change("light'\ncolor-scheme: 'prefer-dark'\n");
  assert.deepEqual(h.assignments, ["system", "dark", "light", "dark"]);
  h.change("color-scheme: 'prefer-dark'\ninvalid\n");
  assert.equal(h.assignments.length, 4);
  h.change("x".repeat(5000));
  h.change("color-scheme: 'prefer-light'\n");
  assert.equal(h.nativeTheme.themeSource, "light");
  dispose();
});

test("live preference changes win over a stale initial read", async () => {
  let resolve;
  const h = harness({ readSetting: () => new Promise((done) => { resolve = done; }) });
  const pending = h.start();
  h.change("color-scheme: 'prefer-light'\n");
  resolve("'prefer-dark'");
  const dispose = await pending;
  assert.deepEqual(h.assignments, ["system", "light"]);
  dispose();
});

test("a failed initial read cannot undo a valid live preference", async () => {
  let reject;
  const h = harness({ readSetting: () => new Promise((_resolve, fail) => { reject = fail; }) });
  const pending = h.start();
  h.change("color-scheme: 'prefer-dark'\n");
  reject(new Error("initial read failed"));
  const dispose = await pending;
  assert.equal(h.nativeTheme.themeSource, "dark");
  dispose();
});

for (const failure of ["spawn", "read", "close", "error"]) {
  test(`unavailable GNOME settings preserves native system behavior (${failure})`, async () => {
    const h = harness();
    if (failure === "spawn") h.options.watchSetting = () => { throw new Error("ENOENT"); };
    if (failure === "read") h.options.readSetting = async () => { throw new Error("schema unavailable"); };
    const dispose = await h.start();
    if (failure === "close" || failure === "error") h.monitor.emit(failure, failure === "error" ? new Error("DBus lost") : 1);
    assert.equal(h.nativeTheme.themeSource, "system");
    h.change("color-scheme: 'prefer-dark'\n");
    assert.equal(h.nativeTheme.themeSource, "system");
    dispose();
  });
}

test("a failed monitor prevents the initial read from locking in an unmonitored override", async () => {
  let resolve;
  const h = harness({ readSetting: () => new Promise((done) => { resolve = done; }) });
  const pending = h.start();
  h.monitor.emit("error", new Error("monitor unavailable"));
  resolve("'prefer-dark'");
  const dispose = await pending;
  assert.equal(h.nativeTheme.themeSource, "system");
  dispose();
});

for (const overrides of [{ platform: "win32" }, { platform: "darwin" }, { env: { XDG_CURRENT_DESKTOP: "KDE" } },
  { env: { XDG_CURRENT_DESKTOP: "X-Cinnamon" } }, { env: {} }]) {
  test(`other desktops retain Electron system detection ${JSON.stringify(overrides)}`, async () => {
    const h = harness({ ...overrides,
      readSetting: () => assert.fail("must not read GNOME settings"),
      watchSetting: () => assert.fail("must not start GNOME monitor"),
    });
    const dispose = await h.start(); dispose();
    assert.deepEqual(h.assignments, ["system"]);
  });
}

test("main installs appearance detection before any startup windows and cleans up on quit", async () => {
  const source = await readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8");
  const startup = source.slice(source.indexOf("app.whenReady().then(async () =>"));
  assert.match(startup, /await installSystemAppearance\(\{ nativeTheme \}\)/);
  assert.match(startup, /app\.once\("will-quit", disposeSystemAppearance\)/);
  assert.ok(startup.indexOf("await installSystemAppearance") < startup.indexOf("createWindow"));
});