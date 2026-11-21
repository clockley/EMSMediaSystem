/* Real sandboxed preload smoke: build dev-paid, then run with Electron. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

const root = path.resolve(__dirname, "../..");
let temporary;
let window;
const watchdog = setTimeout(() => { console.error("MEDIA_PRELOAD timeout"); app.exit(1); }, 20000);

(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "ems-media-preload-"));
  app.setPath("userData", path.join(temporary, "profile"));
  app.setAppPath(root);
  await app.whenReady();
  const preload = process.argv.includes("--legacy-path")
    ? `${root}/derived/src/control-window/../media-window/media_preload.min.js`
    : path.join(root, "derived", "src", "media-window", "media_preload.min.js");
  await fs.access(preload);
  const errors = [];
  const ready = [];
  ipcMain.on("audience-output-ready", (_event, payload) => ready.push(payload));
  // Use the canonical production path, sandbox and actual rendered document.
  window = new BrowserWindow({ show: false, webPreferences: {
    preload, contextIsolation: true, sandbox: true, nodeIntegration: false,
    additionalArguments: ["__isText", "__autoplay=false", "__media-birth=1", "__audience-session=preload-test"],
  } });
  window.webContents.on("preload-error", (_event, file, error) => errors.push({ file, error: String(error) }));
  window.webContents.on("render-process-gone", (_event, details) => errors.push(details));
  await window.loadFile(path.join(root, "derived", "src", "media-window", "media.prod.html"));
  const bridge = await window.webContents.executeJavaScript(`({
    send: typeof window.electron?.ipcRenderer?.send,
    invoke: typeof window.electron?.ipcRenderer?.invoke,
    birth: window.electron?.birth,
    argv: window.electron?.argv,
    player: Boolean(document.getElementById('bigPlayer')),
    nodeExposed: typeof window.require,
  })`);
  assert.deepEqual(errors, [], "no preload failure or renderer crash");
  assert.equal(bridge.send, "function");
  assert.equal(bridge.invoke, "function");
  assert.equal(bridge.birth, 1);
  assert.ok(bridge.argv.includes("__audience-session=preload-test"));
  assert.equal(bridge.player, true);
  assert.equal(bridge.nodeExposed, "undefined");
  assert.equal(ready.length, 1, "production renderer bootstraps through the real preload");
  console.log(`MEDIA_PRELOAD ${JSON.stringify({ electron: process.versions.electron, preload, bridge, ready: ready.length })}`);
})().then(() => finish(0), (error) => { console.error(error); return finish(1); });

async function finish(code) {
  clearTimeout(watchdog);
  try {
    if (window && !window.isDestroyed()) {
      await window.webContents.session.flushStorageData();
      await window.webContents.session.closeAllConnections();
      window.destroy();
    }
    if (temporary) await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (error) { console.error(error); code = 1; }
  app.exit(code);
}