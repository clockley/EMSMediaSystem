/**
 * Full production-app regression, not a standalone/mocked stage viewer.
 * Build first: make -j dev-paid
 * Run: node tests/browser/stage-activation.electron.mjs
 * Fallback: node tests/browser/stage-activation.electron.mjs --snapshot-fallback
 * CI:  node tests/browser/stage-activation.electron.mjs --headless --disable-gpu --ozone-platform=x11
 *
 * The Node supervisor owns an isolated profile/fixtures and a 90s deadline,
 * including SIGILL cleanup. Electron imports the actual built main BEFORE
 * ready; all windows, preloads, IPC handlers, capturePage and viewers are real.
 * Native is mandatory by default: taps forward real source IPC/media calls
 * unchanged, without source selection mocks or desktop enumeration. Explicit
 * fallback mode calls the real source guard, then replaces ONLY a valid native
 * source response with null to simulate an unsupported capture backend.
 * No user settings are read or restored. Direct Electron invocation cannot clean up after
 * a native process crash; prefer the supervised Node command above.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { confidenceCaptureLaunchArguments } from "../../src/main-process/confidence-capture-runtime.mjs";

const require = createRequire(import.meta.url);
const entry = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(entry), "../..");
const timeoutMs = 90_000;
const snapshotFallback = process.argv.includes("--snapshot-fallback");

async function supervise() {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "ems-stage-activation-"));
  let child;
  let timer;
  let timedOut = false;
  const killGroup = (signal) => {
    if (!child?.pid) return;
    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const interrupted = () => killGroup("SIGKILL");
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  try {
    const args = confidenceCaptureLaunchArguments({ platform: process.platform,
      electronVersion: require("electron/package.json").version,
      args: [entry, ...process.argv.slice(2)], x11Available: Boolean(process.env.DISPLAY) });
    child = spawn(require("electron"), args, {
      cwd: root,
      detached: process.platform !== "win32",
      stdio: "inherit",
      env: { ...process.env, EMS_STAGE_ACTIVATION_ROOT: temporary, ELECTRON_RUN_AS_NODE: "" },
    });
    timer = setTimeout(() => { timedOut = true; killGroup("SIGKILL"); }, timeoutMs);
    const outcome = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    console.log(`STAGE_ACTIVATION_PROCESS ${JSON.stringify({ ...outcome, timedOut })}`);
    process.exitCode = !timedOut && outcome.code === 0 && !outcome.signal ? 0 : 1;
  } finally {
    clearTimeout(timer);
    // app.exit intentionally bypasses the app's quit confirmation. Reap any
    // production sidecars as well as a renderer left by a native main crash.
    killGroup("SIGKILL");
    process.removeListener("SIGINT", interrupted);
    process.removeListener("SIGTERM", interrupted);
    await fsp.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    console.log("STAGE_ACTIVATION_CLEANUP temporary profile/fixtures removed; child group stopped");
  }
}

// Original two-slide OPC fixture; no installed-library method is replaced.
function makeDeck() {
  const { zipSync, strToU8 } = require("fflate");
  const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const xml = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;
  const rels = (entries) => xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map(([id, type, target]) => `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`).join("")}</Relationships>`);
  const group = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  const parts = {
    "_rels/.rels": rels([["rId1", "officeDocument", "ppt/presentation.xml"]]),
    "ppt/presentation.xml": xml(`<p:presentation xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId3"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`),
    "ppt/_rels/presentation.xml.rels": rels([["rId1", "slide", "slides/slide1.xml"], ["rId2", "slide", "slides/slide2.xml"], ["rId3", "slideMaster", "slideMasters/slideMaster1.xml"]]),
    "ppt/slideLayouts/slideLayout1.xml": xml(`<p:sldLayout xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`),
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]),
    "ppt/slideMasters/slideMaster1.xml": xml(`<p:sldMaster xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld><p:spTree>${group}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`),
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ["rId2", "theme", "../theme/theme1.xml"]]),
    "ppt/theme/theme1.xml": xml(`<a:theme xmlns:a="${a}" name="Activation"><a:themeElements><a:clrScheme name="Activation"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="101020"/></a:dk2><a:lt2><a:srgbClr val="EEEEFF"/></a:lt2>${[1, 2, 3, 4, 5, 6].map((n) => `<a:accent${n}><a:srgbClr val="336699"/></a:accent${n}>`).join("")}<a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Activation"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Activation"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`),
  };
  for (let index = 1; index <= 2; index++) {
    parts[`ppt/slides/slide${index}.xml`] = xml(`<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="18334D"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${group}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Original activation text"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="7315200" cy="1828800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="ctr"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="3200"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Stage activation slide ${index}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    parts[`ppt/slides/_rels/slide${index}.xml.rels`] = rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"]]);
  }
  const types = {
    "ppt/presentation.xml": "presentationml.presentation.main",
    "ppt/slides/slide1.xml": "presentationml.slide",
    "ppt/slides/slide2.xml": "presentationml.slide",
    "ppt/slideLayouts/slideLayout1.xml": "presentationml.slideLayout",
    "ppt/slideMasters/slideMaster1.xml": "presentationml.slideMaster",
    "ppt/theme/theme1.xml": "theme",
  };
  parts["[Content_Types].xml"] = xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${Object.entries(types).map(([name, type]) => `<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`).join("")}</Types>`);
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, text]) => [name, strToU8(text)])));
}

async function electronTest() {
  const { app, BrowserWindow, desktopCapturer, ipcMain, session } = require("electron");
  const temporary = process.env.EMS_STAGE_ACTIVATION_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ems-stage-activation-"));
  const profile = path.join(temporary, "profile");
  const chromium = path.join(temporary, "chromium");
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(chromium, { recursive: true });
  // Synchronous configuration, before the first top-level dynamic import.
  assert.equal(app.isReady(), false, "ESM entry must hold Electron ready");
  app.setPath("userData", profile);
  app.setPath("sessionData", chromium);
  app.setPath("logs", path.join(temporary, "logs"));
  // Electron itself resolves BrowserWindow.loadFile(relativePath) against
  // app.getAppPath(), not cwd. Keep production relative loads and sidecars
  // rooted exactly as a normal `electron .` launch, without rewriting loads.
  app.setAppPath(root);
  process.chdir(root);
  process.env.ems_dev = "false";
  process.env.ems_dev_console = "false";
  for (const flag of ["disable-renderer-backgrounding", "disable-backgrounding-occluded-windows", "disable-background-timer-throttling"]) app.commandLine.appendSwitch(flag);
  app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

  const checks = [];
  const errors = [];
  const requests = [];
  const targets = [];
  const captures = [];
  const sourceRequests = [];
  const backendSamples = [];
  const concurrencySamples = [];
  const expectedMainExceptions = [];
  const desktopEnumerations = [];
  const windows = [];
  let legacyStageDenial = false;
  let closing = false;
  let control;
  let watchdog;
  let finishPromise;
  const check = (condition, label, details = {}) => {
    assert.ok(condition, `${label}: ${JSON.stringify(details)}`);
    checks.push(label);
    console.log(`STAGE_ACTIVATION_CHECK ${JSON.stringify({ check: checks.length, label, ...details })}`);
  };
  const getSources = desktopCapturer.getSources;
  desktopCapturer.getSources = function (...args) {
    desktopEnumerations.push({ options: args[0] });
    return getSources.apply(this, args);
  };
  const originalHandle = ipcMain.handle;
  ipcMain.handle = function (channel, listener) {
    if (!["stage-preview-frame", "stage-preview-source", "set-display-media-capture-target"].includes(channel)) return originalHandle.call(this, channel, listener);
    return originalHandle.call(this, channel, async (event, ...args) => {
      if (channel === "set-display-media-capture-target") {
        targets.push({ target: args[0], senderId: event.sender.id, expectedDenial: legacyStageDenial });
        return listener(event, ...args);
      }
      if (channel === "stage-preview-source") {
        const stage = windows.findLast((w) => !w.isDestroyed() && w.webContents.getURL().endsWith("/stage-window/stage.prod.html"));
        const record = { sessionId: args[0]?.sessionId, senderId: event.sender.id, windowId: stage?.id,
          loading: stage?.webContents.isLoadingMainFrame(), crashed: stage?.webContents.isCrashed(), substituted: false };
        sourceRequests.push(record);
        try {
          // Always execute production authorization/readiness/session guards.
          const result = await listener(event, ...args);
          record.loadingAfter = stage && !stage.isDestroyed() ? stage.webContents.isLoadingMainFrame() : null;
          record.result = result;
          if (result) {
            assert.equal(result.sessionId, record.sessionId);
            assert.match(result.sourceId, /^window:[1-9]\d*:\d+$/);
            assert.equal(result.sourceId, stage?.getMediaSourceId());
            record.windowSourceId = stage.getMediaSourceId();
            assert.equal(record.loadingAfter, false);
            assert.equal(record.crashed, false);
            if (snapshotFallback) { record.substituted = true; return null; }
          }
          return result;
        } catch (error) { record.error = { name: error.name, message: error.message }; throw error; }
      }
      const request = { sessionId: args[0]?.sessionId, senderId: event.sender.id, startedAt: Date.now() };
      requests.push(request);
      try {
        const result = await listener(event, ...args);
        request.result = result ? { sessionId: result.sessionId, width: result.width, height: result.height, bytes: result.bytes?.byteLength } : null;
        return result;
      } finally { request.finishedAt = Date.now(); }
    });
  };
  app.on("browser-window-created", (_event, win) => {
    windows.push(win);
    const wc = win.webContents;
    wc.on("render-process-gone", (_e, details) => { if (!closing) errors.push({ type: "render-process-gone", url: wc.getURL(), ...details }); });
    wc.on("preload-error", (_e, preload, error) => errors.push({ type: "preload-error", preload, error: String(error) }));
    wc.on("console-message", (event) => {
      const { level, message, sourceId, lineNumber } = event;
      if (level === "error" || level === 3) errors.push({ type: "console", message, sourceId, lineNumber });
    });
    // Observe real native captures, never substitute frames or a fake window.
    const capturePage = wc.capturePage;
    wc.capturePage = async function (...args) {
      const record = { windowId: win.id, url: wc.getURL(), startedAt: Date.now() };
      captures.push(record);
      try { return await capturePage.apply(this, args); }
      finally { record.finishedAt = Date.now(); }
    };
  });

  async function finish(code, error) {
    if (finishPromise) return finishPromise;
    finishPromise = (async () => {
      clearTimeout(watchdog);
      closing = true;
      if (error) console.error(`STAGE_ACTIVATION_FAILURE ${error.stack || JSON.stringify(error) || error}`);
      let browserProbe;
      let activePreview;
      let activeAudiencePreview;
      try { if (control && !control.isDestroyed()) browserProbe = await control.webContents.executeJavaScript("window.__stageActivationProbe?.summary()"); } catch {}
      try { if (error && control && !control.isDestroyed()) activePreview = await previewState(); } catch {}
      try { if (error && control && !control.isDestroyed()) activeAudiencePreview = await previewState("stageActivationAudienceConfidence"); } catch {}
      console.log(`STAGE_ACTIVATION_SUMMARY ${JSON.stringify({ mode: snapshotFallback ? "snapshot-fallback" : "native",
        electron: process.versions.electron, checks: checks.length, errors, snapshots: requests.length,
        jpegResponses: requests.filter((r) => r.result).length, capturePageCalls: captures.length,
        targets, sourceRequests, nativeRequests: browserProbe?.displayMedia.filter((r) => r.purpose === "production"),
        browserProbe, activePreview, activeAudiencePreview, backendSamples, concurrencySamples, expectedMainExceptions, desktopEnumerations })}`);
      try {
        // Quiesce the requesting renderer BEFORE destroying a stage that may
        // be inside native capturePage. The supervisor reaps real sidecars.
        app.removeAllListeners("before-quit");
        app.removeAllListeners("window-all-closed");
        if (control && !control.isDestroyed()) {
          control.removeAllListeners("closed");
          control.destroy();
        }
        const drainDeadline = Date.now() + 2000;
        while (captures.some((c) => !c.finishedAt) && Date.now() < drainDeadline) await new Promise((resolve) => setTimeout(resolve, 20));
        const { default: settings } = await import(pathToFileURL(path.join(root, "derived/src/main-process/settings.min.mjs")).href);
        await settings.flush();
        for (const win of windows.toReversed()) {
          if (!win.isDestroyed()) {
            win.removeAllListeners("close");
            win.destroy();
          }
        }
        for (const s of [session.defaultSession, session.fromPartition("persist:ems-media-presentation")]) {
          s.flushStorageData();
          await s.closeAllConnections();
        }
        if (!process.env.EMS_STAGE_ACTIVATION_ROOT) await fsp.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch (cleanupError) {
        console.error(`STAGE_ACTIVATION_CLEANUP_ERROR ${cleanupError.stack || cleanupError}`);
        code = 1;
      }
      app.exit(code);
    })();
    return finishPromise;
  }
  const processError = (error, origin) => {
    // Electron 40's callback({}) denial both rejects renderer getDisplayMedia
    // AND throws this native callback-validation TypeError in main. Only the
    // deliberate legacy-stage NEGATIVE test may expect it; every other main
    // exception/rejection (including native acquisition failures) still fails.
    if (legacyStageDenial && error?.name === "TypeError" &&
        error.message === "Video was requested, but no video stream was provided" &&
        error.stack?.includes("handleMediaWindowDisplayMediaRequest") && error.stack.includes("node:electron/js2c/browser_init")) {
      const record = { origin, name: error.name, message: error.message, stack: error.stack, purpose: "legacy-stage-denial" };
      expectedMainExceptions.push(record);
      console.log(`STAGE_ACTIVATION_EXPECTED_EXCEPTION ${JSON.stringify(record)}`);
      return;
    }
    void finish(1, error);
  };
  process.on("uncaughtException", (error, origin) => processError(error, origin));
  process.on("unhandledRejection", (error) => processError(error, "unhandledRejection"));
  watchdog = setTimeout(() => { void finish(1, new Error("Overall 90s timeout")); }, timeoutMs);
  const pause = () => new Promise((resolve) => setTimeout(resolve, 65));
  async function until(predicate, label, ms = 10000) {
    const deadline = Date.now() + ms;
    let last;
    do {
      if (errors.some((e) => e.type === "render-process-gone" || e.type === "preload-error")) throw new Error(JSON.stringify(errors));
      last = await predicate();
      if (last) return last;
      await pause();
    } while (Date.now() < deadline);
    throw new Error(`Timed out: ${label}; errors=${JSON.stringify(errors)}`);
  }
  const evaluate = async (win, fn, ...args) => {
    const result = await win.webContents.executeJavaScript(`(async () => {
      try { return { value: await (${fn.toString()})(...${JSON.stringify(args)}) }; }
      catch (error) { return { error: { name: error.name, message: error.message, stack: error.stack } }; }
    })()`, true);
    if (result.error) throw new Error(`Renderer ${win.webContents.getURL()}: ${JSON.stringify(result.error)}`);
    return result.value;
  };
  const invoke = (channel, ...args) => evaluate(control, (name, values) => window.electron.ipcRenderer.invoke(name, ...values), channel, args);
  const status = () => invoke("get-output-status");
  const selectStage = (value) => evaluate(control, (selected) => {
    const select = document.getElementById("stageDisplaySelect");
    select.value = selected;
    if (select.value !== selected) throw new Error(`Stage display option missing: ${selected}`);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  const previewState = (id = "confidenceStagePreview") => evaluate(control, (elementId) => {
    const video = document.getElementById(elementId);
    const stream = video?.srcObject;
    let pixels = null;
    if (video?.readyState >= 2 && video.videoWidth) {
      // Detached 2D analysis only: NEVER turn this canvas into a stream.
      const canvas = document.createElement("canvas");
      canvas.width = 160; canvas.height = 90;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0, hash = 2166136261;
      for (let i = 0; i < rgba.length; i += 4) {
        if (Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) > 48) lit++;
        for (let c = 0; c < 3; c++) hash = Math.imul(hash ^ rgba[i + c], 16777619);
      }
      pixels = { litFraction: lit / (canvas.width * canvas.height), hash: hash >>> 0 };
    }
    return { at: performance.now(), streamId: stream?.id, frames: video?.getVideoPlaybackQuality().totalVideoFrames || 0,
      width: video?.videoWidth, height: video?.videoHeight, paused: video?.paused, muted: video?.muted, pixels,
      tracks: stream?.getTracks().map((t) => ({ kind: t.kind, readyState: t.readyState, ...t.getSettings(), constraints: t.getConstraints() })) || [] };
  }, id);
  const timeline = (win, id) => evaluate(win, (elementId) => {
    const video = document.getElementById(elementId);
    return { time: video.currentTime, paused: video.paused, src: video.currentSrc, frames: video.getVideoPlaybackQuality().totalVideoFrames, error: video.error?.message };
  }, id);
  const localState = (win) => evaluate(win, () => {
    const video = document.getElementById("stageAudiencePreview");
    const image = document.getElementById("stageCurrentImage");
    const pptx = document.getElementById("stageCurrentPptx");
    const audio = document.getElementById("stageCurrentAudio");
    return { kind: document.getElementById("stageRoot").dataset.currentMedia, video: { src: video.currentSrc, srcObject: Boolean(video.srcObject), muted: video.muted, volume: video.volume, frames: video.getVideoPlaybackQuality().totalVideoFrames, paused: video.paused, hidden: video.hidden },
      image: { src: image.currentSrc, complete: image.complete, width: image.naturalWidth, visible: image.checkVisibility() },
      pptx: { text: pptx.textContent, visible: pptx.checkVisibility() }, audio: { visible: audio.checkVisibility(), text: audio.textContent },
      capturedSources: [...document.querySelectorAll("video,audio")].filter((v) => v.srcObject).length,
      audibleSources: [...document.querySelectorAll("video,audio")].filter((v) => (v.currentSrc || v.srcObject) && !v.muted && v.volume > 0).length };
  });

  try {
    const files = Object.fromEntries(["audio.wav", "video.mp4", "image.png", "deck.pptx"].map((name) => [name.split(".")[0], path.join(temporary, name)]));
    const ffmpeg = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { timeout: 10000, stdio: "pipe" });
    ffmpeg(["-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=45", "-c:a", "pcm_s16le", files.audio]);
    ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=45", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", files.video]);
    ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=1", "-frames:v", "1", "-threads", "1", files.image]);
    fs.writeFileSync(files.deck, makeDeck());

    // Electron awaits this ESM entry, so the production main installs scheme
    // privileges, settings, single-instance lock and ready listeners normally.
    await import(pathToFileURL(path.join(root, "derived/src/main-process/main.min.mjs")).href);
    // Release entry-module evaluation after importing main. Awaiting ready
    // here would deadlock Electron's ESM-before-ready bootstrap.
    void app.whenReady().then(async () => {
    try {
    control = await until(() => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("/control-window/index.prod.html")), "real control window");
    await until(() => evaluate(control, () => Boolean(window.electron?.ipcRenderer && document.getElementById("preview") && document.getElementById("confidenceStagePreview"))), "production control bootstrap");
    // The control page runs a bundled IIFE. Importing its unbundled modules
    // would create a second renderer state graph, so use only its real UI.
    await until(() => evaluate(control, () => document.getElementById("bibleVersionSelect")?.dataset.bibleBound === "1"), "real bundled control event handlers");
    await evaluate(control, () => document.getElementById("openStageControlsBtn").click());
    await until(() => evaluate(control, () => document.getElementById("stageDisplaySelect").options.length > 1), "real UI populates connected displays");
    await evaluate(control, () => {
      document.getElementById("closeStageControlsBtn").click();
      const probe = window.__stageActivationProbe = { native: [], userMedia: [], canvases: [], oldStreams: [], purpose: "production" };
      const observeStream = (record, stream) => {
        record.stream = stream;
        record.streamId = stream.id;
        record.stops = [];
        record.quality = [];
        for (const track of stream.getTracks()) {
          const stop = track.stop;
          track.stop = function (...args) {
            record.stops.push({ trackId: track.id, readyState: track.readyState });
            return stop.apply(this, args);
          };
          const apply = track.applyConstraints;
          track.applyConstraints = function (...args) {
            record.quality.push(JSON.parse(JSON.stringify(args[0])));
            return apply.apply(this, args);
          };
        }
        return stream;
      };
      const native = navigator.mediaDevices.getDisplayMedia;
      navigator.mediaDevices.getDisplayMedia = async function (...args) {
        const record = { purpose: probe.purpose, args: args.map((a) => ({ video: a?.video, audio: a?.audio, keys: Object.keys(a || {}) })) };
        probe.native.push(record);
        try { return observeStream(record, await native.apply(this, args)); }
        catch (error) { record.error = { name: error.name, message: error.message }; throw error; }
      };
      const userMedia = navigator.mediaDevices.getUserMedia;
      navigator.mediaDevices.getUserMedia = async function (...args) {
        const record = { args: JSON.parse(JSON.stringify(args)), startedAt: performance.now() };
        probe.userMedia.push(record);
        try { return observeStream(record, await userMedia.apply(this, args)); }
        catch (error) { record.error = { name: error.name, message: error.message }; throw error; }
        finally { record.finishedAt = performance.now(); }
      };
      const capture = HTMLCanvasElement.prototype.captureStream;
      HTMLCanvasElement.prototype.captureStream = function (...args) {
        const stream = capture.apply(this, args);
        probe.canvases.push({ stream, canvas: this, fps: args[0] });
        return stream;
      };
      const serialize = ({ stream, ...record }) => ({ ...record,
        tracks: stream?.getTracks().map((t) => ({ kind: t.kind, readyState: t.readyState, ...t.getSettings() })) });
      probe.summary = () => ({ displayMedia: probe.native.map(serialize), userMedia: probe.userMedia.map(serialize),
        canvasStreams: probe.canvases.length, oldStreams: probe.oldStreams.length,
        oldTracksEnded: probe.oldStreams.every((s) => s.getTracks().every((t) => t.readyState === "ended")) });
    });
    check(app.getPath("userData") === profile && app.getPath("sessionData") === chromium, "isolated production profile", { electron: process.versions.electron });
    const display = await evaluate(control, () => [...document.getElementById("stageDisplaySelect").options].find((o) => o.value)?.value);
    check(Boolean(display), "connected real output display", { display });
    check((await status()).stage.window !== "open", "stage starts closed");
    check(await invoke("stage-preview-source", { sessionId: "no-stage" }) === null, "source guard rejects absent stage");

    let lastSession = "";
    for (const kind of ["audio", "video", "image", "pptx"]) {
      console.log(`STAGE_ACTIVATION_MEDIA ${kind}`);
      let audience = null;
      // Snapshot mode retains the original compatibility path. Simultaneous
      // NATIVE audience + NATIVE stage belongs only to the strict default.
      const concurrentAudience = kind === "video" && !snapshotFallback;
      const mediaPath = files[kind === "pptx" ? "deck" : kind];
      const playbackId = `stage-activation-${kind}`;
      if (kind === "audio") {
        await evaluate(control, async (url) => {
          // Close the default media-library overlay using its own toggle;
          // production deliberately pauses unpresented previews behind it.
          if (document.getElementById("mediaLibraryWorkspace")?.hidden === false) document.getElementById("headerBrowseMediaButton").click();
          // Use the production cue preview: unlike the live mirror it is not
          // reset when there is deliberately no scheduled/live queue item.
          const video = document.getElementById("previewCue");
          video.src = url;
          video.loop = true;
          video.muted = false;
          video.volume = 0.02;
          await video.play();
        }, pathToFileURL(mediaPath).href);
        await until(async () => (await timeline(control, "previewCue")).time > 0.15, "real local WAV starts");
        check((await status()).audience.window !== "open", "audio stays local without audience");
      } else {
        await evaluate(control, () => { for (const id of ["preview", "previewCue"]) { const video = document.getElementById(id); video.pause(); video.removeAttribute("src"); video.load(); } });
        const id = await invoke("create-media-window", {
          webPreferences: {
            preload: path.join(root, "derived/src/media-window/media_preload.min.js"),
            contextIsolation: true, sandbox: true, backgroundThrottling: false,
            additionalArguments: [`__mediafile-ems=${encodeURIComponent(mediaPath)}`, "__autoplay=true", "__media-loop=true", `__audience-playback=${playbackId}`, ...(kind === "image" ? ["__isImg"] : kind === "pptx" ? ["__isPptx", "__pptxSlide=0"] : [])],
          },
        }, display);
        audience = BrowserWindow.fromId(id);
        check(Boolean(audience) && audience.webContents.getURL().endsWith("/media-window/media.prod.html"), `${kind}: production audience active`);
        // The real playback caller commits this IPC after create-media-window.
        // Without it main intentionally keeps the compositor transparent even
        // while the underlying local media element decodes successfully.
        await evaluate(control, (mediaKind) => window.electron.ipcRenderer.send("set-output-content-status", mediaKind), kind);
        await until(() => evaluate(audience, () => !document.body.classList.contains("is-transparent-output")), `${kind}: production compositor content committed`);
        if (kind === "video") await until(async () => (await timeline(audience, "bigPlayer")).frames > 2, "real audience MP4 decoded");
        if (kind === "image") await until(() => evaluate(audience, () => [...document.images].some((image) => image.complete && image.naturalWidth === 640 && image.checkVisibility())), "real audience image decoded");
        if (kind === "pptx") await until(() => evaluate(audience, () => window._pptxMediaViewer?.slideCount === 2 && document.getElementById("pptxCanvas").textContent.includes("Stage activation slide 1")), "real audience PPTX rendered");
      }

      if (concurrentAudience) {
        // create-media-window alone does not set the bundled control's internal
        // audience-active state. Exercise the ACTUAL production native capture
        // API + main source handler with an isolated sink, not a fake stream or
        // a claim to have exercised the queue/confidence UI activation path.
        await evaluate(control, async () => {
          const probe = window.__stageActivationProbe;
          probe.purpose = "audience-concurrency";
          try {
            await window.electron.ipcRenderer.invoke("set-display-media-capture-target", "media");
            const stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: true });
            const video = document.createElement("video");
            video.id = "stageActivationAudienceConfidence";
            video.muted = true; video.autoplay = true; video.playsInline = true;
            video.style.cssText = "position:fixed;right:0;bottom:0;width:160px;height:90px;z-index:2147483647;pointer-events:none";
            document.body.append(video);
            video.srcObject = stream;
            await stream.getVideoTracks()[0].applyConstraints({ width: { ideal: 426, max: 640 }, height: { ideal: 240, max: 360 }, frameRate: { ideal: 30, max: 30 } });
            await video.play();
          } finally { probe.purpose = "production"; }
        });
        const audiencePreview = await until(async () => {
          const s = await previewState("stageActivationAudienceConfidence");
          return s.frames >= 3 && s.pixels?.litFraction > 0.01 && s;
        }, "production native audience capture decodes before stage opens");
        check(audiencePreview.tracks.length === 1 && audiencePreview.tracks[0].kind === "video" && audiencePreview.tracks[0].readyState === "live",
          "real native audience API/source handler active (not queue UI)", { audiencePreview });
        const denied = await evaluate(audience, async () => {
          try { await window.electron.ipcRenderer.invoke("stage-preview-source", { sessionId: "unauthorized" }); return null; }
          catch (error) { return error.message; }
        });
        check(denied?.includes("only from the control window"), "source IPC rejects real audience sender", { denied });
      }

      // Both a fresh session and a close/reopen while the same source remains
      // active. No fake output-status message is ever injected.
      for (let cycle = 0; cycle < 2; cycle++) {
        const label = `${kind}/${cycle ? "reopen" : "enable"}`;
        const clockWindow = kind === "audio" ? control : kind === "video" ? audience : null;
        const clockId = kind === "audio" ? "previewCue" : "bigPlayer";
        const before = clockWindow ? await timeline(clockWindow, clockId) : null;
        const nativeBefore = await evaluate(control, () => window.__stageActivationProbe.native.length);
        const userMediaBefore = await evaluate(control, () => window.__stageActivationProbe.userMedia.length);
        const audienceBefore = concurrentAudience ? await previewState("stageActivationAudienceConfidence") : null;
        await selectStage(display);
        const opened = await until(async () => { const s = await status(); return s.stage.window === "open" && s.stage.health === "ok" && s; }, `${label}: create-stage-window via real UI`);
        const stage = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("/stage-window/stage.prod.html"));
        check(Boolean(stage) && opened.sessionId !== lastSession, `${label}: fresh production stage session`, { sessionId: opened.sessionId });
        check(await evaluate(stage, () => window.stageOutput.sessionId) === opened.sessionId, `${label}: real isolated preload session`);
        // Audio has no audience descriptor; publish exactly the production
        // stage content command through the authorized control sender.
        if (kind === "audio") {
          const result = await invoke("stage-output-command", {
            schema: "ems.output-command.v1", commandId: `audio-${cycle}`, sessionId: opened.sessionId,
            revision: Date.now() + 100, targetRole: "stage", type: "layer.set", layer: "content",
            payload: { current: "Original WAV playing", currentMedia: { kind: "audio", name: "audio.wav" }, profile: "current-next" },
          });
          check(result?.delivered, `${label}: authorized audio content delivered`, { result });
        }
        const local = await until(async () => {
          const s = await localState(stage);
          if (s.kind !== kind || s.audibleSources) return false;
          if (kind === "audio") return s.audio.visible && s.audio.text.includes("♪") && !s.video.src && !s.video.srcObject && s;
          if (kind === "video") return s.video.src && !s.video.srcObject && s.video.muted && !s.video.paused && s.video.frames > 2 && s;
          if (kind === "image") return s.image.complete && s.image.width === 640 && s.image.visible && s;
          return s.pptx.visible && s.pptx.text.includes("Stage activation slide 1") && s;
        }, `${label}: silent locally rendered current ${kind}`);
        check(local.audibleSources === 0 && !local.video.srcObject && local.capturedSources === 0, `${label}: local silent stage content`, { local });

        const preview = await until(async () => {
          const s = await previewState();
          return s.frames >= 3 && s.width > 0 && s.height > 0 && s.tracks.length === 1 && s.pixels?.litFraction > 0.001 && s;
        }, `${label}: control ${snapshotFallback ? "snapshot" : "native"} stream decodes`);
        const probe = await evaluate(control, () => {
          const stream = document.getElementById("confidenceStagePreview").srcObject;
          const capture = window.__stageActivationProbe.canvases.find((c) => c.stream === stream);
          if (!capture) return null;
          const pixels = capture.canvas.getContext("2d").getImageData(0, 0, capture.canvas.width, capture.canvas.height).data;
          return { fps: capture.fps, width: capture.canvas.width, height: capture.canvas.height,
            painted: pixels.some((channel, index) => index % 4 !== 3 && channel > 48) };
        });
        const source = sourceRequests.filter((r) => r.sessionId === opened.sessionId);
        check(source.length === 1 && source[0].senderId === control.webContents.id && !source[0].error &&
          (source[0].result ? source[0].result.sourceId === stage.getMediaSourceId() &&
            source[0].result.sessionId === opened.sessionId && source[0].substituted === snapshotFallback : snapshotFallback && !source[0].substituted),
        `${label}: exactly one real guarded source attempt${snapshotFallback ? " (only valid sources substituted)" : "; NATIVE source required"}`, { source });
        if (snapshotFallback) {
          check(preview.muted && !preview.paused && preview.tracks[0].kind === "video" && preview.tracks[0].readyState === "live" && preview.tracks[0].frameRate <= 10 && preview.width <= 640 && preview.height <= 360 && probe?.fps === 10 && probe.painted && probe.width <= 640 && probe.height <= 360, `${label}: real 10fps video-only canvas snapshot sink`, { preview, probe });
        } else {
          const acquired = await evaluate(control, (streamId) => {
            const record = window.__stageActivationProbe.userMedia.find((r) => r.streamId === streamId);
            return record && { args: record.args, quality: record.quality, error: record.error };
          }, preview.streamId);
          assert.deepEqual(acquired?.args, [{ audio: false, video: { mandatory: {
            chromeMediaSource: "desktop", chromeMediaSourceId: source[0].result.sourceId, maxWidth: 640, maxHeight: 360, maxFrameRate: 30,
          } } }], `${label}: exact production getUserMedia constraints`);
          const quality = { width: { ideal: 426, max: 640 }, height: { ideal: 240, max: 360 }, frameRate: { ideal: 30, max: 30 } };
          assert.deepEqual(acquired.quality, [quality], `${label}: normal renderer quality applied once`);
          assert.deepEqual(preview.tracks[0].constraints, quality, `${label}: real track quality constraints`);
          check(!probe && preview.muted && !preview.paused && preview.tracks[0].kind === "video" && preview.tracks[0].readyState === "live" &&
            preview.tracks[0].deviceId === source[0].result.sourceId && preview.tracks[0].frameRate > 0 && preview.tracks[0].frameRate <= 30 &&
            preview.width <= 640 && preview.height <= 360,
          `${label}: NATIVE exact deviceId, video-only nonblack sink, normal quality`, { preview, acquired });
        }
        const advanced = await until(async () => {
          const s = await previewState();
          return s.streamId === preview.streamId && s.frames >= preview.frames + 3 && s.pixels?.litFraction > 0.001 &&
            (snapshotFallback || s.pixels.hash !== preview.pixels.hash) && s;
        }, `${label}: decoded ${snapshotFallback ? "snapshot" : "native"} frames${snapshotFallback ? "" : " and pixels"} keep growing`);
        const sample = { label, backend: snapshotFallback ? "snapshot" : "native-window-getUserMedia", sessionId: opened.sessionId,
          windowId: stage.id, sourceId: source[0].result?.sourceId || null, sourceSubstituted: source[0].substituted,
          sourceLoading: source[0].loading, width: advanced.width, height: advanced.height, frameRate: advanced.tracks[0].frameRate,
          frames: [preview.frames, advanced.frames], measuredFps: (advanced.frames - preview.frames) * 1000 / (advanced.at - preview.at),
          pixels: [preview.pixels, advanced.pixels] };
        backendSamples.push(sample);
        if (snapshotFallback) {
          const jpeg = requests.findLast((r) => r.sessionId === opened.sessionId && r.result);
          check(jpeg?.senderId === control.webContents.id && jpeg.result.sessionId === opened.sessionId && jpeg.result.width <= 640 && jpeg.result.height <= 360 && jpeg.result.bytes > 100 && captures.some((c) => c.windowId === stage.id), `${label}: production JPEG IPC and native capturePage`, { jpeg });
        } else {
          const calls = (await evaluate(control, () => window.__stageActivationProbe.userMedia.length)) - userMediaBefore;
          check(calls === 1 && requests.length === 0 && captures.length === 0, `${label}: one native acquisition per session; zero automatic snapshot IPC/capturePage`, { calls, snapshots: requests.length, capturePage: captures.length });
        }
        if (snapshotFallback && kind === "audio" && cycle === 0) {
          const burst = await evaluate(control, async (sessionId) => {
            const results = await Promise.all(Array.from({ length: 16 }, () => window.electron.ipcRenderer.invoke("stage-preview-frame", { sessionId })));
            return { frames: results.filter(Boolean).length, skipped: results.filter((r) => r === null).length };
          }, opened.sessionId);
          check(burst.frames <= 1 && burst.skipped >= 15, "concurrent real snapshot IPC skips work instead of queueing captures", { burst });
        }
        if (clockWindow) {
          await until(async () => { const s = await timeline(clockWindow, clockId); return !s.paused && s.src === before.src && s.time > before.time + 0.25 && (kind !== "video" || s.frames > before.frames + 3); }, `${label}: live timeline survives stage activation`);
          check(true, `${label}: ${kind} timeline continues`, { before, after: await timeline(clockWindow, clockId) });
        }
        if (concurrentAudience) {
          const simultaneous = await until(async () => {
            const stageSink = await previewState();
            const audienceSink = await previewState("stageActivationAudienceConfidence");
            const stageLocal = await localState(stage);
            return stageSink.frames > advanced.frames + 3 && audienceSink.streamId === audienceBefore.streamId &&
              audienceSink.frames > audienceBefore.frames + 3 && audienceSink.pixels?.hash !== audienceBefore.pixels.hash &&
              stageLocal.video.frames > local.video.frames + 3 && { stageSink, audienceSink, stageLocal };
          }, `${label}: simultaneous native audience and stage decoded frames grow`);
          const audienceLocal = await evaluate(audience, () => ({ src: document.getElementById("bigPlayer").currentSrc,
            capturedSources: [...document.querySelectorAll("video,audio")].filter((v) => v.srcObject).length }));
          check(simultaneous.stageSink.streamId !== simultaneous.audienceSink.streamId &&
            simultaneous.stageSink.tracks[0].deviceId !== simultaneous.audienceSink.tracks[0].deviceId &&
            simultaneous.audienceSink.tracks[0].readyState === "live" && simultaneous.audienceSink.pixels.litFraction > 0.01 &&
            simultaneous.stageLocal.capturedSources === 0 && audienceLocal.capturedSources === 0 && audienceLocal.src === before.src,
          `${label}: simultaneous native audience/stage pipelines; no capture feedback`, { ...simultaneous, audienceLocal });
          concurrencySamples.push({ label, phase: "stage-open", stageFrames: [advanced.frames, simultaneous.stageSink.frames],
            audienceFrames: [audienceBefore.frames, simultaneous.audienceSink.frames],
            audienceWidth: simultaneous.audienceSink.width, audienceHeight: simultaneous.audienceSink.height,
            audienceFrameRate: simultaneous.audienceSink.tracks[0].frameRate, stageBackend: sample.backend });
        }
        if (lastSession) {
          const obsolete = await invoke("stage-preview-source", { sessionId: lastSession });
          check(obsolete === null && (!snapshotFallback || await invoke("stage-preview-frame", { sessionId: lastSession }) === null), `${label}: obsolete session not fed`);
        }
        const nativeAfter = await evaluate(control, () => window.__stageActivationProbe.native.length);
        check(nativeAfter === nativeBefore && !targets.some((t) => t.target === "stage" && !t.expectedDenial), `${label}: no native stage getDisplayMedia`, { nativeBefore, nativeAfter });

        if (kind === "pptx" && cycle === 1) {
          // Deliberate negative API test, excluded from NORMAL stage requests.
          // A real, healthy stage exists, so rejection cannot be explained by
          // an absent window. No source handler or browser API is substituted.
          legacyStageDenial = true;
          let denial;
          try {
            denial = await evaluate(control, async () => {
              const probe = window.__stageActivationProbe;
              probe.purpose = "legacy-stage-denial";
              try {
                const accepted = await window.electron.ipcRenderer.invoke("set-display-media-capture-target", "stage");
                try {
                  const stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: true });
                  stream.getTracks().forEach((t) => t.stop());
                  return { accepted, granted: true };
                } catch (error) { return { accepted, granted: false, error: { name: error.name, message: error.message } }; }
              } finally {
                await window.electron.ipcRenderer.invoke("set-display-media-capture-target", "media");
                probe.purpose = "production";
              }
            });
          } finally { legacyStageDenial = false; }
          check(denial.accepted === false && denial.granted === false && denial.error && expectedMainExceptions.length <= 1,
            "legacy WebFrameMain getDisplayMedia(stage) remains DENIED", { denial, expectedMainExceptions });
        }

        const audiencePreClose = concurrentAudience ? await previewState("stageActivationAudienceConfidence") : null;
        const displayCallsPreClose = await evaluate(control, () => window.__stageActivationProbe.native.length);
        await evaluate(control, () => window.__stageActivationProbe.oldStreams.push(document.getElementById("confidenceStagePreview").srcObject));
        await selectStage("");
        await until(async () => (await status()).stage.window === "closed" || stage.isDestroyed(), `${label}: real selector closes stage`);
        await until(() => evaluate(control, () => {
          const probe = window.__stageActivationProbe;
          return probe.oldStreams.every((s) => s && s.getTracks().every((t) => t.readyState === "ended")) &&
            !document.getElementById("confidenceStagePreview").srcObject;
        }), `${label}: old ${snapshotFallback ? "snapshot" : "native getUserMedia"} tracks disposed`);
        check(stage.isDestroyed() && await invoke("stage-preview-source", { sessionId: opened.sessionId }) === null &&
          (!snapshotFallback || await invoke("stage-preview-frame", { sessionId: opened.sessionId }) === null), `${label}: closed session receives no frames`);
        if (clockWindow) check(!(await timeline(clockWindow, clockId)).paused, `${label}: close does not pause live media`);
        if (concurrentAudience) {
          const after = await until(async () => {
            const s = await previewState("stageActivationAudienceConfidence");
            return s.streamId === audiencePreClose.streamId && s.frames > audiencePreClose.frames + 3 &&
              s.tracks[0].readyState === "live" && s.pixels?.hash !== audiencePreClose.pixels.hash && s;
          }, `${label}: audience native capture survives stage close`);
          check(await evaluate(control, () => window.__stageActivationProbe.native.length) === displayCallsPreClose,
            `${label}: stage close leaves same audience capture growing, without reacquisition`, { before: audiencePreClose, after });
          concurrencySamples.push({ label, phase: "stage-closed", audienceFrames: [audiencePreClose.frames, after.frames],
            audienceWidth: after.width, audienceHeight: after.height, audienceFrameRate: after.tracks[0].frameRate });
        }
        lastSession = opened.sessionId;
      }
      if (concurrentAudience) {
        const stopped = await evaluate(control, () => {
          const video = document.getElementById("stageActivationAudienceConfidence");
          const stream = video.srcObject;
          stream.getTracks().forEach((t) => t.stop());
          video.pause(); video.srcObject = null; video.remove();
          return stream.getTracks().every((t) => t.readyState === "ended");
        });
        check(stopped && !audience.isDestroyed(), "audience native tracks stopped BEFORE production audience close");
      }
      if (audience && !audience.isDestroyed()) {
        // Production close path, not a substituted lifecycle event.
        await invoke("close-media-window-now");
      }
    }

    const allProbe = await evaluate(control, () => window.__stageActivationProbe.summary());
    check(allProbe.oldStreams === 8 && allProbe.oldTracksEnded &&
      (snapshotFallback ? allProbe.canvasStreams === 8 && allProbe.userMedia.length === 0 :
        allProbe.canvasStreams === 0 && allProbe.userMedia.length === 8 && allProbe.userMedia.every((r) =>
          !r.error && r.tracks.length === 1 && r.tracks.every((t) => t.kind === "video" && t.readyState === "ended") && r.stops.length <= 1)),
    `all ${snapshotFallback ? "snapshot" : "native getUserMedia"} streams disposed after eight cycles`, { allProbe });
    const stageCaptures = captures.filter((c) => c.url.endsWith("/stage-window/stage.prod.html"));
    if (snapshotFallback) {
      check(stageCaptures.length > 16 && stageCaptures.every((c, i) => c.finishedAt && (!i || c.startedAt >= stageCaptures[i - 1].finishedAt)), "real main serializes native stage capturePage", { captures: stageCaptures.length });
    } else {
      check(requests.length === 0 && captures.length === 0, "native default never invokes snapshot IPC or capturePage", { snapshots: requests.length, capturePage: captures.length });
    }
    check(backendSamples.length === 8 && new Set(backendSamples.map((s) => s.sessionId)).size === 8 &&
      new Set(backendSamples.map((s) => s.windowId)).size === 8 &&
      sourceRequests.filter((r) => r.result).length === (snapshotFallback ? backendSamples.filter((s) => s.sourceSubstituted).length : 8),
    "all eight sessions independently request their own actual stage window source");
    check(allProbe.displayMedia.filter((r) => r.purpose === "production").length === 0 &&
      allProbe.displayMedia.filter((r) => r.purpose === "audience-concurrency" && !r.error && r.tracks.every((t) => t.readyState === "ended")).length === (snapshotFallback ? 0 : 1) &&
      allProbe.displayMedia.filter((r) => r.purpose === "legacy-stage-denial" && r.error).length === 1 &&
      targets.filter((t) => t.target === "stage" && !t.expectedDenial).length === 0,
    "zero NORMAL stage getDisplayMedia; only explicit audience concurrency and denied legacy-stage probes", { displayMedia: allProbe.displayMedia, targets });
    check(desktopEnumerations.length === 0, "fixed window capture never enumerates desktop sources", { desktopEnumerations });
    check(errors.length === 0, "no production renderer/preload errors", { errors });
    await finish(0);
    } catch (error) { await finish(1, error); }
    });
  } catch (error) { await finish(1, error); }
}

if (process.versions.electron) await electronTest();
else await supervise();