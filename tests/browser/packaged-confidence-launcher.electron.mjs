/**
 * Linux/Node 22+ supervisor for an ALREADY BUILT package. No workspace app imports.
 * Usage: node tests/browser/packaged-confidence-launcher.electron.mjs /absolute/executable-or.AppImage
 * Optional: --report-dir=/absolute/directory (otherwise creates persistent /tmp reports).
 * AppImages are extracted into owned temporary storage and run through their actual
 * AppRun, with the standard runtime environment. No FUSE, portal picker, fake source,
 * late Ozone switch, user profile, application edits, or installed dependencies.
 * A single 90s deadline includes extraction, archive checks, launch and three cycles.
 * Media taps forward unchanged. Conditional CDP breakpoints count the packaged
 * renderer's source/snapshot IPC call sites without pausing or replacing code.
 * Zero snapshot IPC proves the production capturePage FALLBACK was not requested;
 * this black-box test does not instrument arbitrary main-process capturePage calls.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { isDeepStrictEqual } from "node:util";
import { spawn } from "node:child_process";

const DEADLINE = 90_000;
const MARKER = "# EMS native confidence launcher v1";
const QUALITY = { width: { ideal: 426, max: 640 }, height: { ideal: 240, max: 360 }, frameRate: { ideal: 30, max: 30 } };
const pause = (ms = 75) => new Promise((resolve) => setTimeout(resolve, ms));
const errorInfo = (error) => ({ name: error.name, message: error.message, stack: error.stack });
const emit = (event, value = {}) => console.log(`PACKAGED_CONFIDENCE ${JSON.stringify({ event, ...value })}`);

// Minimal read-only ASAR reader: pickle-size, header pickle, then file payloads.
// Only builtins are needed; never load modules from the workspace or the package.
async function archiveReader(file) {
  const fd = await fsp.open(file, "r");
  try {
    const prefix = Buffer.alloc(16);
    assert.equal((await fd.read(prefix, 0, 16, 0)).bytesRead, 16);
    const size = prefix.readUInt32LE(4);
    const jsonSize = prefix.readUInt32LE(12);
    assert.ok(size >= 8 && size < 64 * 1024 * 1024 && jsonSize <= size - 8, "valid bounded ASAR header");
    const json = Buffer.alloc(jsonSize);
    assert.equal((await fd.read(json, 0, jsonSize, 16)).bytesRead, jsonSize);
    const header = JSON.parse(json.toString());
    return async (name) => {
      let entry = header;
      for (const component of name.split("/")) entry = entry?.files?.[component];
      assert.ok(entry && !entry.unpacked && !entry.link && Number.isSafeInteger(entry.size), `packed ASAR entry: ${name}`);
      assert.ok(entry.size <= 32 * 1024 * 1024, `bounded source: ${name}`);
      const source = await fsp.open(file, "r");
      try {
        const buffer = Buffer.alloc(entry.size);
        assert.equal((await source.read(buffer, 0, buffer.length, 8 + size + Number(entry.offset))).bytesRead, buffer.length);
        return buffer.toString("utf8");
      } finally { await source.close(); }
    };
  } finally { await fd.close(); }
}

class CDP {
  constructor(socket, remaining, events) {
    this.socket = socket;
    this.remaining = remaining;
    this.pending = new Map();
    this.nextId = 0;
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const request = this.pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
      } else events?.(message);
    });
    socket.addEventListener("close", () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("CDP target closed"));
      }
      this.pending.clear();
    });
  }
  static async connect(url, remaining, events) {
    const socket = new WebSocket(url);
    const client = new CDP(socket, remaining, events);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error("CDP connection timeout")); }, Math.min(5000, remaining()));
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP connection failed")); }, { once: true });
    });
    return client;
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, Math.min(8000, this.remaining()));
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async evaluate(fn, ...args) {
    const result = await this.send("Runtime.evaluate", {
      expression: `(async()=>(${fn.toString()})(...${JSON.stringify(args)}))()`,
      awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  }
  close() { this.socket.close(); }
}

function installMediaProbe() {
  const probe = window.__packagedConfidence = { userMedia: [], displayMedia: [], canvasCalls: 0, oldStreams: [], sourceCalls: 0, snapshotCalls: 0 };
  for (const method of ["getUserMedia", "getDisplayMedia"]) {
    const original = navigator.mediaDevices[method];
    navigator.mediaDevices[method] = async function (...args) {
      const record = { args: JSON.parse(JSON.stringify(args)), quality: [], events: [] };
      probe[method === "getUserMedia" ? "userMedia" : "displayMedia"].push(record);
      try {
        const stream = await Reflect.apply(original, this, args);
        record.stream = stream;
        record.streamId = stream.id;
        for (const track of stream.getTracks()) {
          for (const event of ["mute", "unmute", "ended"]) track.addEventListener(event, () => record.events.push(event));
          const apply = track.applyConstraints;
          track.applyConstraints = function (...values) {
            record.quality.push(JSON.parse(JSON.stringify(values[0])));
            return Reflect.apply(apply, this, values);
          };
        }
        return stream;
      } catch (error) { record.error = { name: error.name, message: error.message }; throw error; }
    };
  }
  const capture = HTMLCanvasElement.prototype.captureStream;
  HTMLCanvasElement.prototype.captureStream = function (...args) {
    probe.canvasCalls++;
    return Reflect.apply(capture, this, args);
  };
  probe.summary = () => ({
    sourceCalls: probe.sourceCalls, snapshotCalls: probe.snapshotCalls, canvasCalls: probe.canvasCalls,
    displayMedia: probe.displayMedia.map(({ stream, ...record }) => record),
    userMedia: probe.userMedia.map(({ stream, ...record }) => ({ ...record, tracks: stream?.getTracks().map((t) => ({ kind: t.kind, readyState: t.readyState, muted: t.muted, settings: t.getSettings() })) })),
    oldStreams: probe.oldStreams.length,
    oldTracksEnded: probe.oldStreams.every((s) => s.getTracks().every((t) => t.readyState === "ended")),
  });
  return { stageClosed: !document.getElementById("confidenceStagePreview").srcObject };
}

function previewState() {
  const video = document.getElementById("confidenceStagePreview");
  let pixels = null;
  if (video?.readyState >= 2 && video.videoWidth) {
    // Detached pixel analysis, never a source stream or capture fallback.
    const canvas = document.createElement("canvas");
    canvas.width = 160; canvas.height = 90;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(video, 0, 0, 160, 90);
    const rgba = context.getImageData(0, 0, 160, 90).data;
    let lit = 0, hash = 2166136261;
    for (let i = 0; i < rgba.length; i += 4) {
      if (Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) > 48) lit++;
      for (let c = 0; c < 3; c++) hash = Math.imul(hash ^ rgba[i + c], 16777619);
    }
    pixels = { litFraction: lit / (160 * 90), hash: hash >>> 0 };
  }
  return { at: performance.now(), streamId: video?.srcObject?.id, frames: video?.getVideoPlaybackQuality().totalVideoFrames || 0,
    width: video?.videoWidth, height: video?.videoHeight, muted: video?.muted, volume: video?.volume, paused: video?.paused, pixels,
    tracks: video?.srcObject?.getTracks().map((t) => ({ kind: t.kind, readyState: t.readyState, muted: t.muted, settings: t.getSettings(), constraints: t.getConstraints() })) || [] };
}

function stageState() {
  const video = document.getElementById("stageAudiencePreview");
  const audio = document.getElementById("stageCurrentAudio");
  return { sessionId: window.stageOutput?.sessionId, kind: document.getElementById("stageRoot")?.dataset.currentMedia,
    current: document.getElementById("stageCurrent")?.textContent, audioNote: audio?.textContent, audioVisible: audio?.checkVisibility(),
    videoSrc: video?.currentSrc, videoSrcObject: Boolean(video?.srcObject),
    capturedSources: [...document.querySelectorAll("video,audio")].filter((v) => v.srcObject).length,
    sourceUrls: [...document.querySelectorAll("video,audio")].filter((v) => v.currentSrc).length,
    audibleSources: [...document.querySelectorAll("video,audio")].filter((v) => (v.currentSrc || v.srcObject) && !v.muted && v.volume > 0).length };
}

async function main() {
  const started = Date.now();
  const remaining = () => Math.max(1, DEADLINE - (Date.now() - started));
  const args = process.argv.slice(2);
  assert.equal(process.platform, "linux", "Linux package test only");
  assert.ok(Number(process.versions.node.split(".")[0]) >= 22 && typeof WebSocket === "function", "Node 22+ WebSocket/fetch required");
  assert.ok(args[0] && !args[0].startsWith("--") && args.slice(1).every((arg) => arg.startsWith("--report-dir=")), "Pass an executable/AppImage and optional --report-dir only");
  assert.ok(process.env.DISPLAY, "DISPLAY is required to validate the automatic X11/XWayland default");
  const artifact = await fsp.realpath(path.resolve(args[0]));
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "ems-packaged-confidence-work-"));
  const reportDir = args.find((arg) => arg.startsWith("--report-dir="))?.slice("--report-dir=".length) || await fsp.mkdtemp(path.join(os.tmpdir(), "ems-packaged-confidence-report-"));
  await fsp.mkdir(reportDir, { recursive: true });
  const report = { artifact, reportDir: path.resolve(reportDir), deadlineMs: DEADLINE, checks: [], cycles: [], processes: [], limitations: [
    "X11 command-line switch plus native window IDs is evidence of this X11/XWayland run, not all Linux backends.",
    "No arbitrary main-process capturePage instrumentation: zero observed production snapshot IPC means its fallback was not requested.",
    "No real RPM/DEB build or install; those targets share appOutDir/afterPack but require separate install validation.",
  ] };
  const clients = [];
  const groups = new Set();
  const abort = new AbortController();
  let control, child, failure, interrupted, timer;
  const killGroups = () => {
    for (const pid of groups) {
      try { process.kill(-pid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") emit("kill-error", errorInfo(error)); }
    }
  };
  const onSignal = (signal) => { interrupted = signal; abort.abort(new Error(signal)); killGroups(); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  timer = setTimeout(() => { abort.abort(new Error("Overall 90s deadline exceeded")); killGroups(); for (const client of clients) client.close(); }, remaining());
  const check = (condition, label, details = {}) => {
    assert.ok(condition, `${label}: ${JSON.stringify(details)}`);
    report.checks.push(label);
    emit("check", { check: report.checks.length, label, ...details });
  };
  const until = async (fn, label, ms = 12_000) => {
    const end = Math.min(started + DEADLINE, Date.now() + ms);
    let last, lastError;
    do {
      abort.signal.throwIfAborted();
      if (child?.exitCode !== null && child?.exitCode !== undefined || child?.signalCode) throw new Error(`Artifact exited: ${child.exitCode}/${child.signalCode}; see artifact.log`);
      try { last = await fn(); if (last) return last; }
      catch (error) { lastError = error.message; }
      await pause();
    } while (Date.now() < end);
    throw new Error(`Timed out: ${label}; last=${JSON.stringify(last)}; error=${lastError || "none"}`);
  };
  const run = (executable, argv, cwd, env, label) => {
    abort.signal.throwIfAborted();
    const log = path.join(reportDir, `${label}.log`);
    const fd = fs.openSync(log, "w");
    let processChild;
    try { processChild = spawn(executable, argv, { cwd, env, detached: true, stdio: ["ignore", fd, fd] }); }
    finally { fs.closeSync(fd); }
    if (processChild.pid) groups.add(processChild.pid);
    const record = { executable, args: argv, pid: processChild.pid, log };
    report.processes.push(record);
    processChild.outcome = new Promise((resolve) => {
      processChild.once("error", (error) => { record.error = errorInfo(error); resolve(record); });
      processChild.once("close", (code, signal) => { Object.assign(record, { code, signal }); resolve(record); });
    });
    emit("spawn", record);
    return processChild;
  };
  const connect = async (url, events) => { const client = await CDP.connect(url, remaining, events); clients.push(client); return client; };
  try {
    const home = path.join(temporary, "home");
    const cwd = path.join(temporary, "caller cwd with spaces");
    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(temporary, "config"),
      XDG_CACHE_HOME: path.join(temporary, "cache"), XDG_STATE_HOME: path.join(temporary, "state"),
      XDG_DATA_HOME: path.join(temporary, "data"), TMPDIR: path.join(temporary, "tmp"),
      ems_dev: "false", ems_dev_console: "false", EMS_PACKAGE_CONFIDENCE_SENTINEL: `isolated-${process.pid}` };
    delete env.ELECTRON_RUN_AS_NODE;
    for (const directory of [home, cwd, env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME, env.XDG_STATE_HOME, env.XDG_DATA_HOME, env.TMPDIR]) await fsp.mkdir(directory, { recursive: true });
    let executable = artifact;
    let appDir = path.dirname(artifact);
    const magicFd = await fsp.open(artifact, "r");
    const magic = Buffer.alloc(12);
    try { await magicFd.read(magic, 0, magic.length, 0); } finally { await magicFd.close(); }
    const appImage = magic.subarray(8, 11).equals(Buffer.from([0x41, 0x49, 0x02])) || /\.AppImage$/i.test(artifact);
    report.mode = appImage ? "AppImage-extracted-AppRun" : "linux-unpacked";
    if (appImage) {
      const extraction = path.join(temporary, "extract");
      await fsp.mkdir(extraction);
      const extract = run(artifact, ["--appimage-extract"], extraction, env, "extract");
      const result = await extract.outcome;
      check(result.code === 0 && !result.signal && !result.error, "real AppImage extracted without FUSE", result);
      appDir = path.join(extraction, "squashfs-root");
      executable = path.join(appDir, "AppRun");
      Object.assign(env, { APPIMAGE: artifact, APPDIR: appDir, OWD: cwd, ARGV0: artifact });
    }
    const entries = await fsp.readdir(appDir);
    let wrapper = appImage ? null : artifact;
    if (appImage) {
      for (const name of entries) {
        if (!entries.includes(`${name}.bin`)) continue;
        const candidate = path.join(appDir, name);
        if ((await fsp.readFile(candidate, "utf8")).startsWith(`#!/bin/sh\n${MARKER}\n`)) { wrapper = candidate; break; }
      }
    }
    assert.ok(wrapper, "actual artifact contains the launcher beside its .bin");
    const script = await fsp.readFile(wrapper, "utf8");
    const binary = `${wrapper}.bin`;
    const wrapperStat = await fsp.stat(wrapper), binaryStat = await fsp.stat(binary);
    const elfFd = await fsp.open(binary, "r");
    const elf = Buffer.alloc(4);
    try { await elfFd.read(elf, 0, 4, 0); } finally { await elfFd.close(); }
    check(script.startsWith(`#!/bin/sh\n${MARKER}\n`) && script.includes("readlink -f") && script.includes('exec "$binary" --ozone-platform=x11 "$@"') &&
      Boolean(wrapperStat.mode & 0o111) && Boolean(binaryStat.mode & 0o111) && elf.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])),
    "packaged executable is shell launcher with executable original ELF beside resources", { wrapper, binary, modes: [wrapperStat.mode & 0o777, binaryStat.mode & 0o777] });
    report.appOutDir = appDir;
    report.wrapper = wrapper;
    if (appImage) {
      const appRun = await fsp.readFile(executable);
      const desktops = entries.filter((name) => name.endsWith(".desktop"));
      const desktopText = (await Promise.all(desktops.map((name) => fsp.readFile(path.join(appDir, name), "utf8")))).join("\n");
      // Builder 26's desktop Exec is AppRun (not the application basename).
      // Its unmodified shell template sets BIN to the launcher and execs BIN.
      const appRunText = appRun.toString("utf8");
      const routesWrapper = appRunText.includes(`BIN="$APPDIR/${path.basename(wrapper)}"`) && appRunText.includes('exec "$BIN"');
      const desktopRoutes = /^Exec=(?:AppRun|emsmediasystem)(?:\s|$)/m.test(desktopText);
      check(Boolean((await fsp.stat(executable)).mode & 0o111) && desktopRoutes && routesWrapper,
      "actual AppRun/desktop entry routes to packaged wrapper (not directly to .bin)", { executable, desktops });
      report.appRunRouting = { desktopExec: desktopText.match(/^Exec=.*$/m)?.[0], binaryAssignment: appRunText.match(/^BIN=.*$/m)?.[0] };
    }
    const read = await archiveReader(path.join(appDir, "resources", "app.asar"));
    const packaged = JSON.parse(await read("package.json"));
    check(packaged.main === "derived/src/main-process/main.min.mjs", "archive uses production main entry", { main: packaged.main, version: packaged.version });
    const sources = [
      ["derived/src/main-process/confidence-capture-runtime.min.mjs", "ozone-platform"],
      ["derived/src/shared/stage-preview-snapshot.min.mjs", "captureStream"],
      ["derived/src/shared/stage-video-sync.min.mjs", "currentTime"],
      ["derived/src/shared/native-slide-renderer.min.mjs", "createNativeSlideRenderer"],
      ["derived/src/stage-window/stage.min.mjs", "stageCurrentAudio"],
      ["derived/src/stage-window/stage.prod.html", "EMS Stage Output"],
      ["derived/src/stage-window/stage_preload.min.js", "stage-local-media"],
      [packaged.main, "stage-preview-source"],
      ["derived/src/app.min.js", "chromeMediaSourceId"],
    ];
    let bundle;
    for (const [name, token] of sources) {
      const source = await read(name);
      check(source.includes(token), "required production source in artifact", { name, token });
      if (name === packaged.main) check(source.includes("stage-preview-frame") && source.includes("getMediaSourceId") && source.includes("stage-output-command"), "packaged main includes guarded native/source/snapshot/content IPC");
      if (name === "derived/src/app.min.js") bundle = source;
    }
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    const argv = [`--remote-debugging-port=${port}`, "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-background-timer-throttling"];
    check(!argv.some((arg) => /ozone|disable-gpu|no-sandbox/.test(arg)), "supervisor supplies no backend/GPU/sandbox overrides", { argv });
    child = run(executable, argv, cwd, env, "artifact");
    const json = async (suffix) => (await fetch(`http://127.0.0.1:${port}/${suffix}`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(Math.min(1500, remaining()))]) })).json();
    const targets = () => json("json/list");
    const target = await until(async () => (await targets()).find((t) => t.type === "page" && /EMS/i.test(t.title) && /\/control-window\/index\.prod\.html$/.test(t.url)), "packaged EMS control target", 20_000);
    check(target.url.includes("/resources/app.asar/"), "control loaded from actual artifact ASAR, not workspace", { url: target.url });
    const rendererErrors = [];
    control = await connect(target.webSocketDebuggerUrl, (message) => {
      if (message.method === "Runtime.exceptionThrown") rendererErrors.push(message.params.exceptionDetails);
      if (message.method === "Inspector.targetCrashed") rendererErrors.push({ crash: true });
    });
    await control.send("Runtime.enable");
    const browser = await connect((await json("json/version")).webSocketDebuggerUrl);
    const version = await browser.send("Browser.getVersion");
    const userAgent = await control.evaluate(() => navigator.userAgent);
    const electron = /Electron\/([\d.]+)/.exec(userAgent)?.[1];
    check(/^40\./.test(electron || ""), "actual packaged runtime is Electron 40", { electron, userAgent, browser: version });
    report.runtime = { electron, userAgent, browser: version };
    const processInfo = await browser.send("SystemInfo.getProcessInfo");
    const browserPid = Number(processInfo.processInfo.find((p) => p.type === "browser")?.id);
    assert.ok(browserPid > 0, "browser PID from actual CDP process info");
    const commandLine = (await fsp.readFile(`/proc/${browserPid}/cmdline`, "utf8")).split("\0").filter(Boolean);
    const processEnv = Object.fromEntries((await fsp.readFile(`/proc/${browserPid}/environ`, "utf8")).split("\0").filter(Boolean).map((entry) => {
      const i = entry.indexOf("="); return [entry.slice(0, i), entry.slice(i + 1)];
    }));
    const actualCwd = await fsp.readlink(`/proc/${browserPid}/cwd`);
    const actualElf = await fsp.readlink(`/proc/${browserPid}/exe`);
    check(commandLine.includes("--ozone-platform=x11") && argv.every((arg) => commandLine.includes(arg)) && actualElf === binary,
      "real .bin received automatic X11 switch before initialization and preserved supplied argv", { browserPid, commandLine, actualElf });
    if (commandLine.includes("--no-sandbox")) report.limitations.push("The unmodified AppRun supplied --no-sandbox via its existing user-namespace probe; the supervisor did not supply it.");
    check(["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "XDG_DATA_HOME", "TMPDIR", "DISPLAY", "EMS_PACKAGE_CONFIDENCE_SENTINEL"].every((key) => processEnv[key] === env[key]) && !processEnv.ELECTRON_RUN_AS_NODE,
      "isolated HOME/XDG settings and caller environment arrived before module evaluation");
    check(actualCwd === cwd, "launcher/AppRun preserved caller cwd containing spaces", { actualCwd, cwd });
    if (appImage) check(["APPIMAGE", "APPDIR", "OWD", "ARGV0"].every((key) => processEnv[key] === env[key]), "AppImage runtime environment preserved through AppRun/wrapper", { APPIMAGE: processEnv.APPIMAGE, APPDIR: processEnv.APPDIR });
    report.launch = { browserPid, commandLine, actualElf, actualCwd };
    await until(() => control.evaluate(() => document.getElementById("bibleVersionSelect")?.dataset.bibleBound === "1"), "actual bundled control event handlers bootstrapped", 20_000);
    check(true, "real UI handlers bootstrapped (bibleBound=1)");
    await control.evaluate(() => document.getElementById("openStageControlsBtn").click());
    const displays = await until(() => control.evaluate(() => {
      const values = [...document.getElementById("stageDisplaySelect").options].filter((o) => o.value).map((o) => ({ value: o.value, label: o.textContent }));
      return values.length && values;
    }), "real stage controls enumerate connected displays");
    const display = displays[0].value;
    check(Boolean(display), "real UI selected a connected stage display", { displays, display });
    await control.evaluate(() => {
      document.getElementById("closeStageControlsBtn").click();
      if (document.getElementById("mediaLibraryWorkspace")?.hidden === false) document.getElementById("headerBrowseMediaButton").click();
    });
    check((await control.evaluate(installMediaProbe)).stageClosed, "observation installed before stage native acquisition");
    await control.send("Debugger.enable");
    report.breakpoints = [];
    for (const [channel, counter] of [["stage-preview-source", "sourceCalls"], ["stage-preview-frame", "snapshotCalls"]]) {
      const matcher = new RegExp(`\\b[\\w$]+\\(["']${channel}["']`, "g");
      let match, count = 0;
      while ((match = matcher.exec(bundle))) {
        const preceding = bundle.slice(0, match.index);
        const lineNumber = preceding.split("\n").length - 1;
        const columnNumber = match.index - preceding.lastIndexOf("\n") - 1;
        const result = await control.send("Debugger.setBreakpointByUrl", { urlRegex: "[/]app\\.min\\.js$", lineNumber, columnNumber,
          condition: `(window.__packagedConfidence.${counter}++,false)` });
        check(result.locations?.length === 1, "non-pausing observation bound to actual packaged IPC call site", { channel, lineNumber, columnNumber, locations: result.locations });
        report.breakpoints.push({ channel, ...result });
        count++;
      }
      assert.equal(count, 1, `exactly one production ${channel} call site`);
    }
    const invoke = (channel, ...values) => control.evaluate((name, args) => window.electron.ipcRenderer.invoke(name, ...args), channel, values);
    const status = () => invoke("get-output-status");
    const select = (value) => control.evaluate((selected) => {
      const element = document.getElementById("stageDisplaySelect");
      element.value = selected;
      if (element.value !== selected) throw new Error(`Missing stage display ${selected}`);
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    const summary = () => control.evaluate(() => window.__packagedConfidence.summary());
    const content = (sessionId, cycle, phase) => invoke("stage-output-command", {
      schema: "ems.output-command.v1", commandId: `packaged-${cycle}-${phase}`, sessionId, revision: Date.now() * 10 + phase,
      targetRole: "stage", type: "layer.set", layer: "content", payload: {
        profile: "current-next", current: `PACKAGED NATIVE CAPTURE ${cycle} / ${phase}\n${phase ? "████████████████" : "ORIGINAL GENERATED AUDIO INDICATOR"}`,
        next: "No audience or captured stage content source", notes: "Temporary packaged confidence test", currentMedia: { kind: "audio", name: "Generated audio note (no audio playback)" },
      },
    });
    check((await status()).stage.window !== "open" && await invoke("stage-preview-source", { sessionId: "absent" }) === null, "native source guard rejects absent stage");
    let priorSession;
    for (let cycle = 1; cycle <= 3; cycle++) {
      await select(display);
      const opened = await until(async () => { const value = await status(); return value.stage.window === "open" && value.stage.health === "ok" && value; }, `cycle ${cycle}: native stage opens via actual UI`);
      check(opened.sessionId && opened.sessionId !== priorSession && opened.audience.window !== "open", "fresh native stage session with no fake audience", { cycle, sessionId: opened.sessionId });
      const stageTarget = await until(async () => (await targets()).find((t) => t.type === "page" && t.title === "EMS Stage Output" && /\/stage-window\/stage\.prod\.html$/.test(t.url)), "actual packaged stage target");
      const stage = await connect(stageTarget.webSocketDebuggerUrl);
      await stage.send("Runtime.enable");
      check(stageTarget.url.includes("/resources/app.asar/") && (await stage.evaluate(stageState)).sessionId === opened.sessionId, "stage uses actual packaged source/preload and matching session", { cycle, url: stageTarget.url });
      check((await content(opened.sessionId, cycle, 0))?.delivered, "authorized generated stage content command delivered", { cycle });
      const local = await until(async () => { const s = await stage.evaluate(stageState); return s.kind === "audio" && s.audioVisible && s.current.includes(`PACKAGED NATIVE CAPTURE ${cycle} / 0`) && s; }, "stage rendered generated visual audio note locally");
      check(local.audioNote.includes("♪") && !local.videoSrc && !local.videoSrcObject && local.capturedSources === 0 && local.sourceUrls === 0 && local.audibleSources === 0,
        "stage local generated content: no audio/video URLs, srcObject, capture feedback or sound", { cycle, local });
      const source = await invoke("stage-preview-source", { sessionId: opened.sessionId });
      check(source?.sessionId === opened.sessionId && /^window:[1-9]\d*:\d+$/.test(source?.sourceId) && Number(source.sourceId.split(":")[1]) > 10000 && Number(source.sourceId.split(":")[1]) <= 0xffffffff,
        "main guard returns actual unsigned native X11 window source (not Wayland synthetic ID 2)", { cycle, source });
      const first = await until(async () => { const s = await control.evaluate(previewState); return s.frames >= 3 && s.width && s.tracks.length === 1 && s.pixels?.litFraction > 0.001 && s; }, "native confidence video decodes lit frames");
      const track = first.tracks[0];
      check(first.muted && first.volume === 0 && !first.paused && track.kind === "video" && track.readyState === "live" && !track.muted &&
        track.settings.deviceId === source.sourceId && track.settings.frameRate > 0 && track.settings.frameRate <= 30 && first.width <= 640 && first.height <= 360,
      "native sink: exact window deviceId, one live unmuted track, <=30fps, muted video/volume zero", { cycle, first });
      const probe = await summary();
      const acquisition = probe.userMedia.find((r) => r.streamId === first.streamId);
      check(isDeepStrictEqual(acquisition?.args, [{ audio: false, video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: source.sourceId, maxWidth: 640, maxHeight: 360, maxFrameRate: 30 } } }]) &&
        isDeepStrictEqual(acquisition.quality, [QUALITY]) && isDeepStrictEqual(track.constraints, QUALITY) && !acquisition.error,
      "forwarded production getUserMedia has exact native ID and normal quality applied once", { cycle, acquisition });
      check(probe.userMedia.length === cycle && probe.sourceCalls === cycle && probe.displayMedia.length === 0 && probe.canvasCalls === 0 && probe.snapshotCalls === 0,
        "one native acquisition per session, no stage getDisplayMedia/canvas/snapshot IPC fallback", { cycle, counts: { userMedia: probe.userMedia.length, source: probe.sourceCalls, displayMedia: probe.displayMedia.length, canvas: probe.canvasCalls, snapshot: probe.snapshotCalls } });
      check((await content(opened.sessionId, cycle, 1))?.delivered, "second generated visual revision delivered", { cycle });
      await until(async () => (await stage.evaluate(stageState)).current.includes(`PACKAGED NATIVE CAPTURE ${cycle} / 1`), "stage updated local generated visual");
      const advanced = await until(async () => { const s = await control.evaluate(previewState); return s.streamId === first.streamId && s.frames >= first.frames + 3 &&
        s.pixels?.litFraction > 0.001 && s.pixels.hash !== first.pixels.hash && s; }, "native decoded frames and captured visual pixels advance");
      check(advanced.tracks[0].settings.deviceId === source.sourceId && !advanced.tracks[0].muted, "same native capture remains live with advancing lit pixels", { cycle, frames: [first.frames, advanced.frames], pixels: [first.pixels, advanced.pixels] });
      report.cycles.push({ cycle, sessionId: opened.sessionId, source, first, advanced, local });
      if (priorSession) check(await invoke("stage-preview-source", { sessionId: priorSession }) === null, "source guard rejects stale closed/replaced session", { cycle, priorSession });
      await control.evaluate(() => window.__packagedConfidence.oldStreams.push(document.getElementById("confidenceStagePreview").srcObject));
      await select("");
      await until(async () => (await status()).stage.window === "closed", "actual stage selector closes native window");
      await until(async () => !(await targets()).some((t) => t.id === stageTarget.id), "old stage target destroyed");
      await until(() => control.evaluate(() => !document.getElementById("confidenceStagePreview").srcObject && window.__packagedConfidence.summary().oldTracksEnded), "old native tracks ended and sink detached");
      check((await summary()).oldTracksEnded && await invoke("stage-preview-source", { sessionId: opened.sessionId }) === null,
        "closed session source rejected, all stale native tracks ended", { cycle });
      stage.close();
      priorSession = opened.sessionId;
    }
    report.probe = await summary();
    check(report.probe.oldStreams === 3 && report.probe.oldTracksEnded && report.probe.sourceCalls === 3 && report.probe.userMedia.length === 3 &&
      report.probe.displayMedia.length === 0 && report.probe.snapshotCalls === 0 && report.probe.canvasCalls === 0,
    "all three real native close/reopen cycles pass without automatic snapshot/capturePage fallback", { probe: report.probe });
    check(rendererErrors.length === 0, "no observed packaged control renderer exceptions/crashes", { rendererErrors });
    const settingsFiles = [];
    const walk = async (dir) => {
      for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(file);
        else if (entry.name === "settings.json") settingsFiles.push(file);
      }
    };
    await walk(env.XDG_CONFIG_HOME);
    check(settingsFiles.length > 0 && settingsFiles.every((file) => file.startsWith(`${temporary}/`)), "actual settings initialized and written only within isolated configuration", { settingsFiles });
    report.settingsFiles = settingsFiles;
  } catch (error) {
    failure = error;
    report.failure = errorInfo(error);
    emit("failure", report.failure);
    try { if (control && !abort.signal.aborted) report.failureProbe = await control.evaluate(() => ({ probe: window.__packagedConfidence?.summary(), preview: document.getElementById("confidenceStagePreview")?.outerHTML })); } catch {}
  } finally {
    // Quiesce through the real UI where possible; never request application quit
    // (which opens a confirmation). Group termination also reaps real sidecars.
    try {
      if (control && !abort.signal.aborted) await control.evaluate(() => {
        const select = document.getElementById("stageDisplaySelect");
        if (select) { select.value = ""; select.dispatchEvent(new Event("change", { bubbles: true })); }
      });
    } catch {}
    killGroups();
    for (const client of clients) client.close();
    if (child) await child.outcome;
    clearTimeout(timer);
    try {
      await fsp.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      report.cleaned = !fs.existsSync(temporary);
      // Check non-zombie group members, including sidecars after a main crash.
      const alive = async () => {
        const members = [];
        for (const pid of (await fsp.readdir("/proc")).filter((name) => /^\d+$/.test(name))) {
          const stat = await fsp.readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
          const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
          if (fields[0] !== "Z" && groups.has(Number(fields[2]))) members.push(Number(pid));
        }
        return members;
      };
      let survivors = await alive();
      const end = Date.now() + 1500;
      while (survivors.length && Date.now() < end) { killGroups(); await pause(50); survivors = await alive(); }
      report.survivors = survivors;
      assert.equal(survivors.length, 0, "no live supervised processes remain");
    } catch (error) { report.cleanupError = errorInfo(error); failure ||= error; }
    report.elapsedMs = Date.now() - started;
    report.interrupted = interrupted || null;
    report.timedOut = abort.signal.aborted && !interrupted;
    report.passed = !failure && !report.timedOut && !interrupted && report.cleaned && report.survivors?.length === 0;
    await fsp.writeFile(path.join(reportDir, "summary.json"), JSON.stringify(report, null, 2));
    emit("summary", { passed: report.passed, checks: report.checks.length, cycles: report.cycles.length, electron: report.runtime?.electron,
      mode: report.mode, reportDir: report.reportDir, cleaned: report.cleaned, survivors: report.survivors, elapsedMs: report.elapsedMs, failure: report.failure?.message });
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    process.exitCode = report.passed ? 0 : 1;
  }
}

main().catch((error) => { emit("supervisor-error", errorInfo(error)); process.exitCode = 1; });