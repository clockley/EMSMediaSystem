/* Build dev-paid, then run with Electron. Never changes the user's GSettings. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { promisify } = require("node:util");
const { execFile, spawn } = require("node:child_process");
const { app, BrowserWindow, nativeTheme } = require("electron");

const execute = promisify(execFile);
const root = path.resolve(__dirname, "../..");
const key = ["org.gnome.desktop.interface", "color-scheme"];
let temporary, window, dispose;
const monitors = [];
const watchdog = setTimeout(() => { console.error("SYSTEM_APPEARANCE timeout"); app.exit(1); }, 30000);

(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "ems-system-appearance-"));
  app.setPath("userData", path.join(temporary, "profile"));
  await app.whenReady();
  const { installSystemAppearance, parseGnomeColorScheme } = await import(pathToFileURL(path.join(root, "derived/src/main-process/system-appearance.min.mjs")).href);
  const { stdout: original } = await execute("gsettings", ["get", ...key]);
  nativeTheme.themeSource = "system";
  const baseline = { source: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors, gnome: original.trim() };

  // Use the built operator UI's actual CSS, but no unrelated application JS.
  const production = await fs.readFile(path.join(root, "derived/src/control-window/index.prod.html"), "utf8");
  const styles = [...production.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]);
  assert.ok(styles.length && styles.some((css) => css.includes("prefers-color-scheme")), "built UI retains light/dark media queries");
  const page = path.join(temporary, "appearance.html");
  await fs.writeFile(page, `<!doctype html><meta charset="utf-8"><style>${styles.join("\n")}</style><body>System appearance regression</body>`);

  dispose = await installSystemAppearance({ nativeTheme });
  const gnomeDesktop = /(?:^|:)(?:gnome|ubuntu)(?:-|$)/i.test(process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || "");
  const expected = gnomeDesktop ? parseGnomeColorScheme(original) : "system";
  assert.equal(nativeTheme.themeSource, expected);
  window = new BrowserWindow({ show: true, width: 360, height: 240, title: "EMS appearance regression",
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await window.loadFile(page);
  const query = () => window.webContents.executeJavaScript(`({
    dark: matchMedia('(prefers-color-scheme: dark)').matches,
    background: getComputedStyle(document.documentElement).getPropertyValue('--window-bg-color').trim(),
    foreground: getComputedStyle(document.documentElement).getPropertyValue('--window-fg-color').trim(),
    changes: window.appearanceChanges || 0,
  })`);
  const actual = await query();
  assert.equal(actual.dark, nativeTheme.shouldUseDarkColors);
  if (expected !== "system") assert.equal(actual.dark, expected === "dark");
  console.log(`SYSTEM_APPEARANCE_REAL ${JSON.stringify({ electron: process.versions.electron, baseline, synchronized: actual, source: nativeTheme.themeSource })}`);
  dispose(); dispose = null;

  // A separate real GSettings keyfile backend exercises the real monitor and
  // nativeTheme -> Chromium -> production CSS, without writing the user's DB.
  const isolated = { ...process.env, GSETTINGS_BACKEND: "keyfile", XDG_CONFIG_HOME: path.join(temporary, "gsettings") };
  await fs.mkdir(isolated.XDG_CONFIG_HOME, { recursive: true });
  const settings = (action, ...args) => execute("gsettings", [action, ...key, ...args], { env: isolated, timeout: 2000 });
  await settings("set", "prefer-light");
  dispose = await installSystemAppearance({ nativeTheme, platform: "linux", env: { XDG_CURRENT_DESKTOP: "GNOME" },
    readSetting: async () => (await settings("get")).stdout,
    watchSetting: () => {
      const monitor = spawn("gsettings", ["monitor", ...key], { env: isolated, stdio: ["ignore", "pipe", "ignore"] });
      monitors.push(monitor);
      return monitor;
    },
  });
  await window.webContents.executeJavaScript(`window.appearanceChanges = 0; matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => window.appearanceChanges++);`);
  async function expect(source, changes = 0) {
    const deadline = Date.now() + 5000;
    let result;
    do {
      result = await query();
        if (result.dark === (source === "dark") && result.changes >= changes &&
          result.background.replace(/\s/g, "").toLowerCase() === (source === "dark" ? "#222226" : "#f6f5f4")) return result;
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    assert.fail(`${source} CSS did not update: ${JSON.stringify({ result, themeSource: nativeTheme.themeSource })}`);
  }
  const light = await expect("light");
  await settings("set", "prefer-dark");
  const dark = await expect("dark", light.changes + 1);
  await settings("set", "default");
  const normal = await expect("light", dark.changes + 1);
  assert.notEqual(light.foreground, dark.foreground);
  assert.equal(normal.foreground, light.foreground);
  assert.ok(normal.changes >= 2, "existing document receives both live media-query changes without reload");
  assert.equal((await execute("gsettings", ["get", ...key])).stdout, original, "user's actual preference remains untouched");
  console.log(`SYSTEM_APPEARANCE_LIVE ${JSON.stringify({ light, dark, normal, isolatedSettings: true })}`);
})().then(() => finish(0), (error) => { console.error(error); return finish(1); });

async function finish(code) {
  clearTimeout(watchdog);
  dispose?.();
  try {
    for (const monitor of monitors) {
      monitor.kill();
      if (monitor.exitCode === null && monitor.signalCode === null) await new Promise((resolve) => monitor.once("close", resolve));
    }
    if (window && !window.isDestroyed()) {
      await window.webContents.session.flushStorageData();
      await window.webContents.session.closeAllConnections();
      window.destroy();
    }
    if (temporary) await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (error) { console.error(error); code = 1; }
  app.exit(code);
}