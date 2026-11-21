/**
 * Node 22+/Linux, normal production `electron .` subprocess, GPU ON by default.
 * Run: node tests/browser/stage-video-ui.electron.mjs
 * Variants: --disable-gpu | --disable-features=ZeroCopyTabCapture |
 *           --disable-features=VaapiVideoDecoder | --disable-accelerated-video-decode
 * Optional: --height=2160 (default 1080), --report-dir=/tmp/owned-report-directory
 *           --video=/absolute/path (read-only external fixture), --seek=40
 *           --native-backtrace (launch actual Electron under batch gdb)
 *           --native-dump (offline Crashpad bootstrap; no debugger attached)
 * Stage backend is automatic: Linux/Electron 40 MUST use production snapshots;
 * other runtimes retain the native stage assertions. Audience stays native.
 * Requires an existing fresh `make -j dev-paid`, DISPLAY, ffmpeg/ffprobe,
 * xprop/xwininfo, and (for external audio isolation) pactl.
 *
 * No substitute production main, synthetic audience, renderer re-import, presentation
 * IPC shortcut, fake streams or alternate media pipeline. CDP drops a real file
 * onto the real schedule, clicks its row and Present, and changes the real stage
 * selector five times WHILE the audience/control decoders and PID are running.
 * Media taps forward unchanged; non-pausing bundled-code breakpoints observe PID
 * and source/snapshot calls. Generated audio is quiet; external audio is routed
 * ONLY for this child to an owned PulseAudio/PipeWire null sink, never globally
 * muted. Production volume, mute and audio tracks are never altered. External
 * files are never copied, patched or written; reports contain metadata only.
 *
 * All profiles/HOME/XDG paths are supplied before production main is evaluated.
 * A 120s supervisor (180s with --native-backtrace) owns every child process group, preserves the actual native
 * exit signal before cleanup, and retains full logs, metadata and last UI probe
 * under /tmp. Only this test is run; no build or other test is run automatically.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { confidenceCaptureLaunchArguments } from "../../src/main-process/confidence-capture-runtime.mjs";
import { analyzeMp4SyncSamplesUncached } from "../../src/main-process/mp4-sync-fix.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const DEADLINE = 120_000;
const CYCLES = 5;
const pause = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
const errorInfo = (error) => ({ name: error.name, message: error.message, stack: error.stack });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileHash = async (file) => {
  const digest = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
};
const fileIdentity = async (file) => {
  const stat = await fsp.stat(file, { bigint: true });
  return Object.fromEntries(["dev", "ino", "size", "mtimeNs", "ctimeNs"].map((key) => [key, String(stat[key])]));
};

class CDP {
  constructor(socket, remaining, events) {
    this.socket = socket;
    this.remaining = remaining;
    this.pending = new Map();
    this.nextId = 0;
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) { events?.(message); return; }
      const request = this.pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
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
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, Math.min(7000, this.remaining()));
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

// Observer only: forward real acquisitions unchanged and retain their tracks.
function installMediaProbe() {
  const probe = window.__stageVideoUI = { userMedia: [], displayMedia: [], canvasCalls: 0, canvasStreams: [],
    sourceCalls: 0, snapshotCalls: 0, oldStreams: [], pid: { calls: 0 } };
  for (const method of ["getUserMedia", "getDisplayMedia"]) {
    const original = navigator.mediaDevices[method];
    navigator.mediaDevices[method] = async function (...args) {
      const record = { args: JSON.parse(JSON.stringify(args)), at: performance.now(), events: [] };
      probe[method === "getUserMedia" ? "userMedia" : "displayMedia"].push(record);
      try {
        const stream = await Reflect.apply(original, this, args);
        record.stream = stream;
        record.streamId = stream.id;
        for (const track of stream.getTracks()) {
          for (const event of ["mute", "unmute", "ended"]) track.addEventListener(event, () => record.events.push({ event, at: performance.now() }));
        }
        return stream;
      } catch (error) { record.error = { name: error.name, message: error.message }; throw error; }
    };
  }
  const capture = HTMLCanvasElement.prototype.captureStream;
  HTMLCanvasElement.prototype.captureStream = function (...args) {
    probe.canvasCalls++;
    const stream = Reflect.apply(capture, this, args);
    probe.canvasStreams.push({ stream, canvas: this, fps: args[0] });
    return stream;
  };
  const tracks = (stream) => stream?.getTracks().map((t) => ({ id: t.id, kind: t.kind,
    readyState: t.readyState, muted: t.muted, enabled: t.enabled, settings: t.getSettings() })) || [];
  probe.summary = () => ({ pid: probe.pid, sourceCalls: probe.sourceCalls, snapshotCalls: probe.snapshotCalls,
    canvasCalls: probe.canvasCalls,
    canvasStreams: probe.canvasStreams.map(({ stream, canvas, fps }) => ({ id: stream.id, fps,
      width: canvas.width, height: canvas.height, tracks: tracks(stream) })),
    userMedia: probe.userMedia.map(({ stream, ...r }) => ({ ...r, tracks: tracks(stream) })),
    displayMedia: probe.displayMedia.map(({ stream, ...r }) => ({ ...r, tracks: tracks(stream) })),
    oldStreams: probe.oldStreams.map((s) => ({ id: s.id, tracks: tracks(s) })),
    oldTracksEnded: probe.oldStreams.every((s) => s.getTracks().every((t) => t.readyState === "ended")),
  });
}

function mediaState(id) {
  const video = document.getElementById(id);
  if (!(video instanceof HTMLMediaElement)) return null;
  if (!video.__stageVideoFrames && video.requestVideoFrameCallback) {
    const frames = video.__stageVideoFrames = { count: 0 };
    const next = (_now, metadata) => {
      frames.count++;
      frames.presentedFrames = metadata.presentedFrames;
      frames.mediaTime = metadata.mediaTime;
      if (video.isConnected) video.requestVideoFrameCallback(next);
    };
    video.requestVideoFrameCallback(next);
  }
  let pixels;
  if (video.readyState >= 2 && video.videoWidth) {
    try {
      // Detached analysis only. Never captureStream() or replace a frame source.
      const canvas = document.createElement("canvas");
      canvas.width = 96; canvas.height = 54;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, 96, 54);
      const data = ctx.getImageData(0, 0, 96, 54).data;
      let lit = 0, value = 2166136261;
      for (let i = 0; i < data.length; i += 4) {
        if (Math.max(data[i], data[i + 1], data[i + 2]) > 48) lit++;
        for (let c = 0; c < 3; c++) value = Math.imul(value ^ data[i + c], 16777619);
      }
      pixels = { litFraction: lit / (96 * 54), hash: value >>> 0 };
    } catch (error) { pixels = { error: error.message }; }
  }
  return { id, at: performance.now(), src: video.currentSrc, srcObject: Boolean(video.srcObject), streamId: video.srcObject?.id,
    paused: video.paused, ended: video.ended, time: video.currentTime, duration: video.duration,
    width: video.videoWidth, height: video.videoHeight, readyState: video.readyState,
    muted: video.muted, volume: video.volume, rate: video.playbackRate,
    audioDecodedBytes: video.webkitAudioDecodedByteCount, audioTracks: video.audioTracks?.length,
    audioEnabled: video.audioTracks ? [...video.audioTracks].map((t) => t.enabled) : [],
    error: video.error && { code: video.error.code, message: video.error.message },
    frames: video.getVideoPlaybackQuality?.().totalVideoFrames || 0, callbacks: { ...video.__stageVideoFrames }, pixels,
    tracks: video.srcObject?.getTracks().map((t) => ({ kind: t.kind, readyState: t.readyState, muted: t.muted,
      settings: t.getSettings() })) || [] };
}

async function main() {
  assert.equal(process.platform, "linux", "This supervisor currently verifies Linux /proc and real X11 windows");
  assert.ok(Number(process.versions.node.split(".")[0]) >= 22 && typeof WebSocket === "function", "Node 22+ required");
  assert.ok(process.env.DISPLAY, "A real DISPLAY is required; no headless/GPU workaround is supplied by default");
  const options = process.argv.slice(2);
  const nativeBacktrace = options.includes("--native-backtrace");
  const nativeDump = options.includes("--native-dump");
  assert.ok(!(nativeBacktrace && nativeDump), "Use --native-dump without gdb to preserve native crash timing");
  const deadlineMs = nativeBacktrace ? 180_000 : DEADLINE;
  const externalVideo = options.find((s) => s.startsWith("--video="))?.slice(8);
  if (externalVideo !== undefined) {
    assert.ok(path.isAbsolute(externalVideo), "--video must name an absolute, existing read-only external fixture");
    assert.ok((await fsp.stat(externalVideo)).isFile(), "--video must be a regular file");
    await fsp.access(externalVideo, fs.constants.R_OK);
  }
  const seek = Number(options.find((s) => s.startsWith("--seek="))?.slice(7) ?? 0);
  assert.ok(Number.isFinite(seek) && seek >= 0, "--seek must be a nonnegative number of seconds");
  const height = Number(options.find((s) => s.startsWith("--height="))?.split("=")[1] || 1080);
  assert.ok([1080, 2160].includes(height), "--height must be 1080 or 2160");
  assert.ok(!externalVideo || !options.some((s) => s.startsWith("--height=")), "External dimensions come from ffprobe; do not combine --video and --height");
  const extraFlags = options.filter((s) => !["--native-backtrace", "--native-dump"].includes(s) && !["--height=", "--report-dir=", "--video=", "--seek="].some((prefix) => s.startsWith(prefix)));
  assert.ok(extraFlags.every((s) => /^--(?:disable-gpu|disable-accelerated-video-decode|disable-features=[\w,]+|ozone-platform=x11|headless|no-sandbox)$/.test(s)), "Only explicit documented Chromium diagnostic flags are accepted");
  const reportOption = options.find((s) => s.startsWith("--report-dir="))?.slice(13);
  if (reportOption) assert.ok(path.resolve(reportOption).startsWith(`${os.tmpdir()}/`), "Reports must stay under /tmp");
  const reportDir = reportOption ? path.resolve(reportOption) : await fsp.mkdtemp(path.join(os.tmpdir(), "ems-stage-video-ui-report-"));
  if (reportOption) await fsp.mkdir(reportDir); // Never overwrite another run's report.
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "ems-stage-video-ui-work-"));
  const started = Date.now();
  const remaining = () => Math.max(1, deadlineMs - (Date.now() - started));
  const report = { reportDir, temporary, deadlineMs, nativeBacktrace, nativeDump, generatedHeight: externalVideo ? null : height,
    externalVideo: externalVideo || null, requestedSeekSeconds: seek, cyclesRequested: CYCLES,
    extraFlags, checks: [], cycles: [], processes: [], rendererEvents: [], network: [], probes: [],
    limitations: ["Development production build, not a packaged install; no arbitrary main-process capturePage instrumentation.",
      "Stage media-element inspection begins when its real CDP target appears; it does not prove absence of transient earlier calls.",
      "Audio codec/decoded-byte/track evidence is recorded, not acoustic output-device verification.",
      "All successful runs end with supervisor SIGKILL after assertions, not a tested graceful app quit."] };
  const events = fs.createWriteStream(path.join(reportDir, "events.jsonl"), { flags: "wx" });
  const emit = (event, details = {}) => {
    events.write(`${JSON.stringify({ event, elapsedMs: Date.now() - started, ...details })}\n`);
    if (["start", "spawn", "check", "failure", "summary", "child-exit"].includes(event)) console.log(`STAGE_VIDEO_UI ${JSON.stringify({ event, ...details })}`);
  };
  const clients = [], groups = new Set();
  const nativePids = new Set();
  const abort = new AbortController();
  let child, control, audience, currentStage, failure, interrupted, stopping = false;
  let browserPid;
  let fixture, fixtureIdentity, audioModule, audioEnv;
  let expectSnapshot = false;
  let stageBackend = "undetermined";
  let lastProbeAt = 0;
  const procState = (pid) => {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      return { pid: Number(pid), state: fields[0], parentPid: Number(fields[1]), group: Number(fields[2]) };
    } catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return null; throw error; }
  };
  const discoverNativeChildren = () => {
    if (!nativeBacktrace || !child?.pid) return;
    // gdb may put the inferior in its own process group. Retain every owned
    // descendant/group before gdb exits and those children are reparented.
    const processes = fs.readdirSync("/proc").filter((pid) => /^\d+$/.test(pid)).map(procState).filter(Boolean);
    const owned = new Set([child.pid, ...nativePids]);
    let changed;
    do {
      changed = false;
      for (const p of processes) if (owned.has(p.parentPid) && !owned.has(p.pid)) { owned.add(p.pid); changed = true; }
    } while (changed);
    for (const p of processes) if (owned.has(p.pid) && p.pid !== child.pid) {
      nativePids.add(p.pid);
      if (owned.has(p.group)) groups.add(p.group);
    }
  };
  const nativeState = async () => {
    if (!nativeBacktrace || !child) return null;
    discoverNativeChildren();
    const log = await fsp.readFile(report.processes.find((p) => p.pid === child.pid).stdout, "utf8").catch(() => "");
    const stop = [...log.matchAll(/(?:Thread[^\n]*|Program) received signal (SIG[A-Z0-9]+)/g)].at(-1)?.[1];
    const termination = log.match(/Program terminated with signal (SIG[A-Z0-9]+)/)?.[1];
    const exited = log.match(/\[Inferior \d+ \(process (\d+)\) exited (normally|with code (\d+))\]/);
    const proc = browserPid ? procState(browserPid) : null;
    const code = exited ? (exited[2] === "normally" ? 0 : Number.parseInt(exited[3], 8)) : null;
    report.browserOutcome = { pid: browserPid || (exited ? Number(exited[1]) : null),
      code, signal: termination || null, stopSignal: stop || null,
      state: termination || exited ? "terminated" : stop ? "stopped-by-debugger" : proc && proc.state !== "Z" ? "running" : "unknown",
      proc, diagnosticsComplete: log.includes("EMS_GDB_DIAGNOSTICS_END"), runComplete: log.includes("EMS_GDB_RUN_END") };
    if (stop) report.nativeCrash = { signal: termination || stop, browserPid: browserPid || null,
      evidence: "gdb inferior signal (not debugger exit status)", terminated: Boolean(termination),
      stdout: report.processes.find((p) => p.pid === child.pid).stdout };
    return report.browserOutcome;
  };
  const killGroups = () => {
    discoverNativeChildren();
    for (const pid of nativePids) {
      try { process.kill(pid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") emit("cleanup-error", errorInfo(error)); }
    }
    for (const pid of groups) {
      try { process.kill(-pid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") emit("cleanup-error", errorInfo(error)); }
    }
  };
  const onSignal = (signal) => { interrupted = signal; abort.abort(new Error(signal)); killGroups(); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const watchdog = setTimeout(() => { report.watchdog = true; abort.abort(new Error(`Overall ${deadlineMs / 1000}s deadline`)); killGroups(); for (const c of clients) c.close(); }, remaining());
  const run = (executable, args, env, label) => {
    abort.signal.throwIfAborted();
    const stdout = path.join(reportDir, `${label}.stdout.log`), stderr = path.join(reportDir, `${label}.stderr.log`);
    const out = fs.openSync(stdout, "wx"), err = fs.openSync(stderr, "wx");
    let c;
    try { c = spawn(executable, args, { cwd: root, env, detached: true, stdio: ["ignore", out, err] }); }
    finally { fs.closeSync(out); fs.closeSync(err); }
    if (c.pid) groups.add(c.pid);
    const record = { executable, args, pid: c.pid, stdout, stderr };
    report.processes.push(record);
    c.once("exit", (code, signal) => {
      Object.assign(record, { code, signal, elapsedMs: Date.now() - started, supervisorStopping: stopping, watchdog: Boolean(report.watchdog) });
      if (label === "electron") emit("child-exit", record);
    });
    c.outcome = new Promise((resolve) => {
      c.once("error", (error) => { record.error = errorInfo(error); resolve(record); });
      c.once("close", () => resolve(record));
    });
    emit("spawn", { label, pid: c.pid, stdout, stderr });
    return c;
  };
  const check = (condition, label, details = {}) => {
    assert.ok(condition, `${label}: ${JSON.stringify(details)}`);
    report.checks.push(label);
    emit("check", { check: report.checks.length, label, ...details });
  };
  const until = async (fn, label, ms = 12_000) => {
    const end = Math.min(started + deadlineMs, Date.now() + ms);
    let last, lastError;
    do {
      abort.signal.throwIfAborted();
      const native = await nativeState();
      if (native?.stopSignal || native?.state === "terminated") throw new Error(`Electron inferior: ${JSON.stringify(native)}`);
      if (child && (child.exitCode !== null || child.signalCode)) throw new Error(`${nativeBacktrace ? "gdb" : "Electron"} exited: code=${child.exitCode} signal=${child.signalCode}`);
      try { last = await fn(); if (last) return last; }
      catch (error) { lastError = error.message; }
      await pause();
    } while (Date.now() < end);
    throw new Error(`Timed out: ${label}; last=${JSON.stringify(last)}; error=${lastError || "none"}`);
  };
  const connect = async (target, label) => {
    const client = await CDP.connect(target.webSocketDebuggerUrl, remaining, (message) => {
      if (["Runtime.exceptionThrown", "Inspector.targetCrashed", "Inspector.detached"].includes(message.method)) {
        const event = { label, ...message }; report.rendererEvents.push(event); emit("renderer", event);
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") emit("console-error", { label, ...message.params });
      if (message.method === "Network.responseReceived" && message.params.response.url.startsWith("ems-media:")) {
        const { url, status, mimeType, headers } = message.params.response;
        report.network.push({ label, url, status, mimeType, headers });
      }
    });
    clients.push(client);
    if (label !== "browser") {
      await client.send("Runtime.enable");
      await client.send("Inspector.enable");
      await client.send("Network.enable");
    }
    return client;
  };
  const invoke = (name, ...args) => control.evaluate((channel, values) => window.electron.ipcRenderer.invoke(channel, ...values), name, args);
  const status = () => invoke("get-output-status");
  const select = (id, value) => control.evaluate((elementId, selected) => {
    const element = document.getElementById(elementId);
    if (!(element instanceof HTMLSelectElement)) throw new Error(`Missing selector ${elementId}`);
    element.value = selected;
    if (element.value !== selected) throw new Error(`Missing display ${selected}`);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, id, value);
  const click = (selector) => control.evaluate((value) => {
    const element = document.querySelector(value);
    if (!element || element.disabled) throw new Error(`Missing/disabled actual UI action ${value}`);
    element.click();
  }, selector);
  const summary = () => control.evaluate(() => window.__stageVideoUI.summary());
  const sample = async (phase, force = false) => {
    const probe = { phase, elapsedMs: Date.now() - started };
    for (const [label, client, ids] of [["control", control, ["preview", "confidenceMonitorPreview", "confidenceRendererPreview", "confidenceStagePreview"]],
      ["audience", audience, ["bigPlayer"]], ["stage", currentStage, ["stageAudiencePreview"]]]) {
      if (!client) continue;
      try { probe[label] = await Promise.all(ids.map((id) => client.evaluate(mediaState, id))); }
      catch (error) { probe[`${label}Error`] = error.message; }
    }
    if (currentStage) {
      try { probe.stageCapture = await currentStage.evaluate(() => window.__stageVideoUI.summary()); }
      catch (error) { probe.stageCaptureError = error.message; }
    }
    try { if (control) { probe.capture = await summary(); probe.output = await status(); } } catch (error) { probe.controlError = error.message; }
    if (force || Date.now() - lastProbeAt >= 500) {
      report.lastUIProbe = probe;
      report.probes.push(probe);
      lastProbeAt = Date.now();
      await fsp.writeFile(path.join(reportDir, "last-ui-probe.json"), JSON.stringify(probe, null, 2));
      emit("probe", probe);
    }
    return probe;
  };
  const playing = (s) => s && !s.paused && !s.ended && !s.error && s.readyState >= 2 && s.width > 0 && s.frames > 0;
  try {
    emit("start", { reportDir, externalVideo: externalVideo || null, generatedHeight: externalVideo ? null : height,
      seek, flags: extraFlags, nativeBacktrace, nativeDump, deadlineMs });
    const profile = path.join(temporary, "profile");
    const env = { ...process.env, HOME: path.join(temporary, "home"), XDG_CONFIG_HOME: path.join(temporary, "config"),
      XDG_DATA_HOME: path.join(temporary, "data"), XDG_CACHE_HOME: path.join(temporary, "cache"),
      XDG_STATE_HOME: path.join(temporary, "state"), TMPDIR: path.join(temporary, "tmp"),
      ELECTRON_RUN_AS_NODE: "", ems_dev: "false", ems_dev_console: "false", EMS_DEBUG: "1" };
    for (const dir of [profile, env.HOME, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_CACHE_HOME, env.XDG_STATE_HOME, env.TMPDIR]) await fsp.mkdir(dir, { recursive: true });
    if (nativeDump) {
      env.EMS_NATIVE_DUMP_REPORT = reportDir;
      env.EMS_NATIVE_DUMP_PROFILE = profile;
    }
    // libX11 may otherwise look for authentication under the isolated HOME.
    if (!env.XAUTHORITY && fs.existsSync(path.join(os.homedir(), ".Xauthority"))) env.XAUTHORITY = path.join(os.homedir(), ".Xauthority");
    const pkg = JSON.parse(await fsp.readFile(path.join(root, "package.json"), "utf8"));
    assert.equal(pkg.main, "derived/src/main-process/main.min.mjs");
    report.build = { main: pkg.main, version: pkg.version, edition: (await fsp.readFile(path.join(root, "derived/.bible-edition"), "utf8")).trim() };
    assert.equal(report.build.edition, "paid", "Build dev-paid first; this test does not modify build outputs");
    const bundle = await fsp.readFile(path.join(root, "derived/src/app.min.js"), "utf8");
    report.build.bundleSha256 = hash(bundle);
    report.build.bundleMtime = (await fsp.stat(path.join(root, "derived/src/app.min.js"))).mtime.toISOString();
    if (nativeDump) report.build.mainSha256 = await fileHash(path.join(root, pkg.main));
    fixture = externalVideo || path.join(reportDir, `stage-ui-${height}p-h264-aac.mp4`);
    if (!externalVideo) {
      const encode = run("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "warning", "-f", "lavfi", "-i", `testsrc2=size=${height * 16 / 9}x${height}:rate=30`,
        "-f", "lavfi", "-i", "sine=frequency=523.25:sample_rate=48000", "-t", "30", "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "veryfast", "-threads", "4", "-crf", "28", "-pix_fmt", "yuv420p", "-bf", "3",
        "-x264-params", "keyint=60:min-keyint=60:scenecut=0:open-gop=1", "-c:a", "aac", "-b:a", "96k", "-af", "volume=0.01",
        "-movflags", "+faststart", "-y", fixture], env, "ffmpeg");
      const encoded = await encode.outcome;
      check(encoded.code === 0 && !encoded.signal && !encoded.error, "real 30s H264/AAC fixture encoded (quiet nonzero audio)");
    }
    fixtureIdentity = await fileIdentity(fixture);
    report.fixtureIdentityBefore = fixtureIdentity;
    report.fixtureSha256 = await fileHash(fixture);
    const metadata = run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", fixture], env, "ffprobe");
    const probed = await metadata.outcome;
    assert.equal(probed.code, 0);
    report.fixture = JSON.parse(await fsp.readFile(probed.stdout, "utf8"));
    const videoMetadata = report.fixture.streams.find((s) => s.codec_type === "video");
    check(videoMetadata?.width > 0 && videoMetadata.height > 0 && Number(report.fixture.format.duration) >= seek + 20,
      "ffprobe supplies actual video dimensions and sufficient duration for requested seek plus five cycles", {
        width: videoMetadata?.width, height: videoMetadata?.height, codec: videoMetadata?.codec_name,
        profile: videoMetadata?.profile, fps: videoMetadata?.avg_frame_rate, duration: report.fixture.format.duration,
        audio: report.fixture.streams.filter((s) => s.codec_type === "audio").map((s) => s.codec_name) });
    report.width = videoMetadata.width; report.height = videoMetadata.height;
    if (!externalVideo) check(videoMetadata.codec_name === "h264" && videoMetadata.height === height && videoMetadata.avg_frame_rate === "30/1" &&
      Number(report.fixture.format.duration) >= 30 && report.fixture.streams.some((s) => s.codec_name === "aac"), "generated fixture retains H264/30fps/AAC contract");
    const mp4 = /(?:^|,)mp4(?:,|$)/.test(report.fixture.format.format_name);
    const patch = mp4 ? await analyzeMp4SyncSamplesUncached(fixture) : null;
    if (!externalVideo) check(Boolean(patch?.patchBytes?.length && patch.idrSyncCount < patch.originalSyncCount),
      "real open-GOP MP4 requires production virtual STSS repair", { originalSyncCount: patch?.originalSyncCount, idrSyncCount: patch?.idrSyncCount });
    report.virtualStss = patch?.patchBytes?.length ? { status: "required", offset: patch.stssOffset, length: patch.patchBytes.length,
      originalSyncCount: patch.originalSyncCount, idrSyncCount: patch.idrSyncCount, patchSha256: hash(patch.patchBytes) }
      : { status: "not-required", reason: mp4 ? "Production MP4 analysis returned no virtual repair" : "Not an MP4 container; no MP4 analysis or patch attempted" };
    if (externalVideo) {
      // Only this owned child's audio is redirected; never mute a system sink,
      // change the default sink, or touch the audience element's mute/volume.
      audioEnv = { ...process.env };
      const sinkName = `ems_stage_video_ui_${process.pid}`;
      const load = await run("pactl", ["load-module", "module-null-sink", `sink_name=${sinkName}`,
        "sink_properties=device.description=EMS_stage_video_UI_test"], audioEnv, "audio-null-sink-load").outcome;
      assert.equal(load.code, 0, "External audio requires an isolated OS null sink; refusing potentially loud playback");
      audioModule = (await fsp.readFile(load.stdout, "utf8")).trim();
      assert.match(audioModule, /^\d+$/, "owned null sink module ID");
      env.PULSE_SINK = sinkName;
      report.audioRouting = { sinkName, moduleId: audioModule, audienceMutedByTest: false, systemDefaultChanged: false };
      check(true, "external audio routed to owned OS null sink; production audience stays unmuted", report.audioRouting);
    }
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    const argv = confidenceCaptureLaunchArguments({ platform: process.platform, electronVersion: require("electron/package.json").version,
      args: [nativeDump ? path.join(root, "tests/browser/stage-video-native-dump-bootstrap.electron.mjs") : ".",
        `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...extraFlags, ...(nativeDump ? ["--native-dump"] : [])], x11Available: Boolean(env.DISPLAY) });
    report.argv = argv;
    const electron = require("electron");
    report.electronExecutable = electron;
    const debuggerArgs = ["--batch", "-ex", "set pagination off", "-ex", "set confirm off",
      "-ex", "set debuginfod enabled off", "-ex", "set follow-fork-mode parent",
      "-ex", "handle SIGPIPE nostop noprint pass", "-ex", "handle SIGUSR1 nostop noprint pass",
      "-ex", "handle SIGUSR2 nostop noprint pass", "-ex", "run",
      "-ex", "echo \\nEMS_GDB_DIAGNOSTICS_BEGIN\\n", "-ex", "info program",
      "-ex", "thread apply all bt 16", "-ex", "info registers", "-ex", "x/12i $pc-24",
      "-ex", "info symbol $pc", "-ex", "info sharedlibrary", "-ex", "info proc mappings",
      "-ex", "echo \\nEMS_GDB_DIAGNOSTICS_END\\n",
      // Deliver the stopped signal after retaining all evidence, so the real
      // inferior termination is distinguishable from gdb's own exit code.
      "-ex", "continue", "-ex", "echo \\nEMS_GDB_RUN_END\\n", "--args", electron, ...argv];
    child = nativeBacktrace ? run("gdb", debuggerArgs, env, "gdb") : run(electron, argv, env, "electron");
    const getJson = async (endpoint) => {
      const response = await fetch(`http://127.0.0.1:${port}/${endpoint}`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(Math.min(2000, remaining()))]) });
      assert.ok(response.ok); return response.json();
    };
    const targets = () => getJson("json/list");
    const version = await until(() => getJson("json/version"), "normal production browser CDP endpoint", nativeBacktrace ? 60_000 : 20_000);
    const browser = await connect(version, "browser");
    report.runtime = version;
    const electronVersion = version["User-Agent"]?.match(/\bElectron\/(\d+\.\d+\.\d+(?:-[\w.]+)?)/)?.[1];
    assert.ok(electronVersion, "actual browser CDP User-Agent supplies its Electron version");
    assert.equal(electronVersion, require("electron/package.json").version, "running Electron matches the selected executable package");
    expectSnapshot = process.platform === "linux" && /^40\./.test(electronVersion);
    stageBackend = expectSnapshot ? "snapshot-automatic-linux-electron40" : "native-window-getUserMedia";
    report.capturePolicy = { platform: process.platform, electronVersion, expectedStageBackend: stageBackend,
      audienceBackend: "native-window-getDisplayMedia", substitutedSources: false, nativeGuardBypassed: false };
    const processInfo = await browser.send("SystemInfo.getProcessInfo");
    browserPid = Number(processInfo.processInfo.find((p) => p.type === "browser")?.id);
    assert.ok(Number.isInteger(browserPid) && browserPid > 0, "CDP supplies the actual browser PID");
    if (nativeBacktrace) {
      discoverNativeChildren();
      const ancestry = [];
      let p = procState(browserPid);
      while (p && p.pid !== child.pid && ancestry.length < 32) { ancestry.push(p); p = procState(p.parentPid); }
      assert.equal(p?.pid, child.pid, "actual Electron browser is a descendant of the owned gdb process");
      assert.equal(await fsp.realpath(`/proc/${browserPid}/exe`), await fsp.realpath(electron), "browser /proc executable is actual Electron, not gdb");
      report.debugger = { pid: child.pid, ancestry };
    } else assert.equal(browserPid, child.pid, "supervised Electron is the browser, not a signal-hiding launcher");
    const commandLine = (await fsp.readFile(`/proc/${browserPid}/cmdline`, "utf8")).split("\0").filter(Boolean);
    const processEnv = Object.fromEntries((await fsp.readFile(`/proc/${browserPid}/environ`, "utf8")).split("\0").filter(Boolean).map((s) => { const i = s.indexOf("="); return [s.slice(0, i), s.slice(i + 1)]; }));
    report.launch = { browserPid, commandLine, cwd: await fsp.readlink(`/proc/${browserPid}/cwd`) };
    check((!expectSnapshot || commandLine.includes("--ozone-platform=x11")) && argv.every((s) => commandLine.includes(s)),
      "actual /proc browser argv verifies production launch policy and diagnostic flags", { browserPid, commandLine, ...report.capturePolicy });
    check(["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "TMPDIR"].every((key) => processEnv[key] === env[key]) &&
      commandLine.includes(`--user-data-dir=${profile}`), "temporary HOME/XDG/userData supplied before production main imports");
    if (nativeDump) {
      const bootstrapFile = path.join(reportDir, "native-bootstrap.json");
      const bootstrap = await until(async () => {
        const state = JSON.parse(await fsp.readFile(bootstrapFile, "utf8"));
        return state.productionImportCompleted && state;
      }, "diagnostic bootstrap imports actual unchanged derived production entry");
      report.nativeBootstrap = bootstrap;
      check(bootstrap.pid === browserPid && bootstrap.appPath === root && bootstrap.cwd === root &&
        bootstrap.appName === "emsmediasystem" && bootstrap.userData === profile && bootstrap.beforeReady &&
        bootstrap.crashDumps === path.join(reportDir, "dumps") && bootstrap.uploadToServer === false &&
        bootstrap.main === pkg.main && bootstrap.mainURL === new URL(`../../${pkg.main}`, import.meta.url).href,
      "offline Crashpad starts before actual derived main import, root paths and owned userData/dumps verified", bootstrap);
    }
    const controlTarget = await until(async () => (await targets()).find((t) => t.type === "page" && /\/control-window\/index\.prod\.html$/.test(t.url)), "actual control window");
    control = await connect(controlTarget, "control");
    await until(() => control.evaluate(() => document.getElementById("bibleVersionSelect")?.dataset.bibleBound === "1" && document.getElementById("mediaWindowPlayButton")?.dataset.presentBound === "1"), "actual UI handlers ready", 20_000);
    if (await control.evaluate(() => document.getElementById("mediaLibraryWorkspace")?.hidden === false)) await click("#headerBrowseMediaButton");
    await control.evaluate(installMediaProbe);
    await control.send("Debugger.enable");
    report.breakpoints = [];
    for (const [pattern, condition, label] of [
      [/\b[\w$]+\(["']stage-preview-source["']/g, "(window.__stageVideoUI.sourceCalls++,false)", "source"],
      [/\b[\w$]+\(["']stage-preview-frame["']/g, "(window.__stageVideoUI.snapshotCalls++,false)", "snapshot"],
      [/adjustPlaybackRate\([^)]*\)\{/g, "(window.__stageVideoUI.pid={calls:window.__stageVideoUI.pid.calls+1,videoId:this.video?.id,src:this.video?.currentSrc,paused:this.video?.paused,historySize:this.historySize,at:performance.now()},false)", "PID"],
    ]) {
      const matches = [...bundle.matchAll(pattern)];
      assert.equal(matches.length, 1, `one actual bundled ${label} observation site`);
      const offset = matches[0].index + (label === "PID" ? matches[0][0].length : 0);
      const before = bundle.slice(0, offset);
      const result = await control.send("Debugger.setBreakpointByUrl", { urlRegex: "[/]app\\.min\\.js$", lineNumber: before.split("\n").length - 1,
        columnNumber: offset - before.lastIndexOf("\n") - 1, condition });
      assert.equal(result.locations?.length, 1, `bound real bundled ${label} call`);
      report.breakpoints.push({ label, ...result });
    }
    await click("#openStageControlsBtn");
    const displays = await until(() => control.evaluate(() => {
      const options = [...document.getElementById("stageDisplaySelect").options].filter((o) => o.value).map((o) => ({ value: o.value, label: o.textContent }));
      return options.length && options;
    }), "real display selector enumeration");
    report.displays = displays;
    const display = displays[0].value;
    report.displayEnumeration = await invoke("get-all-displays");
    const selectedDisplay = report.displayEnumeration.displays.find((d) => d.value === display);
    assert.ok(selectedDisplay?.bounds?.width > 0 && selectedDisplay.bounds.height > 0, "selected real display geometry");
    report.selectedDisplay = selectedDisplay;
    await select("stageDisplaySelect", "");
    await click("#closeStageControlsBtn");
    await until(async () => (await status()).stage.window === "closed", "all stage output disabled before Present");
    check(await invoke("stage-preview-source", { sessionId: (await status()).sessionId }) === null,
      "real main stage-preview-source returns null before live playback with stage closed");
    await until(() => control.evaluate(() => document.getElementById("dspSelct")?.options.length > 1), "actual audience display options");
    await select("dspSelct", display);
    // Native Chromium file drop -> existing production queue drop callback.
    const point = await control.evaluate(() => {
      const list = document.getElementById("mediaQueueList");
      list.scrollIntoView({ block: "center" });
      const r = list.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 60), width: r.width, height: r.height };
    });
    assert.ok(point.width > 0 && point.height > 0, "real visible schedule drop target");
    for (const type of ["dragEnter", "dragOver", "drop"]) await control.send("Input.dispatchDragEvent", { type, x: point.x, y: point.y, data: { items: [], files: [fixture], dragOperationsMask: 1 } });
    await until(() => control.evaluate(() => document.querySelectorAll("#mediaQueueList [data-queue-index]").length > 0), "fixture added by actual queue UI drop callback");
    await click('#mediaQueueList .queue-item[data-queue-index="0"]');
    const localSource = (src) => /^(?:file|ems-media):/.test(src || "");
    const sameLocalSource = (left, right) => left?.startsWith("file:") && right?.startsWith("file:")
      ? fileURLToPath(left) === fileURLToPath(right) : left === right;
    const preview = await until(async () => { const s = await control.evaluate(mediaState, "preview"); return localSource(s?.src) &&
      s.readyState >= 2 && s.width === report.width && s.height === report.height && s; }, "real local-file control decoder prepared at ffprobe dimensions");
    if (preview.src.startsWith("file:")) assert.equal(fileURLToPath(preview.src), fixture, "production file URL resolves to original fixture");
    check(!preview.srcObject, "real queue/control decoder preserves production local-media URL mapping", {
      src: preview.src, width: preview.width, height: preview.height, external: Boolean(externalVideo) });
    if (patch?.patchBytes?.length) {
      assert.ok(preview.src.startsWith("ems-media:"), "MP4 requiring repair uses the virtual protocol");
      const originalOverlay = Buffer.alloc(patch.patchBytes.length);
      const original = await fsp.open(fixture, "r");
      try { assert.equal((await original.read(originalOverlay, 0, originalOverlay.length, patch.stssOffset)).bytesRead, originalOverlay.length); }
      finally { await original.close(); }
      const served = await control.evaluate(async (url, offset, length) => {
        const response = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
        return { status: response.status, range: response.headers.get("content-range"), bytes: [...new Uint8Array(await response.arrayBuffer())] };
      }, preview.src, patch.stssOffset, patch.patchBytes.length);
      check(served.status === 206 && Buffer.from(served.bytes).equals(patch.patchBytes) && !Buffer.from(served.bytes).equals(originalOverlay),
        "real production ems-media range serves virtual STSS overlay, original fixture untouched", { range: served.range });
      report.virtualStss.verified = true;
    } else check(true, "virtual MP4 overlay not required for this fixture", report.virtualStss);
    await click("#mediaWindowPlayButton");
    const audienceTarget = await until(async () => (await targets()).find((t) => t.type === "page" && /\/media-window\/media\.prod\.html$/.test(t.url)), "Present opens real audience pipeline");
    audience = await connect(audienceTarget, "audience");
    if (seek > 0) {
      await until(async () => playing(await audience.evaluate(mediaState, "bigPlayer")) && playing(await control.evaluate(mediaState, "preview")), "playback starts before real transport seek");
      report.seekAction = await control.evaluate((seconds) => {
        const timeline = document.getElementById("timeline"), video = document.getElementById("preview");
        if (!(timeline instanceof HTMLInputElement) || timeline.disabled || !Number.isFinite(video?.duration)) throw new Error("Actual transport timeline unavailable");
        timeline.value = String(seconds / video.duration * 100);
        timeline.dispatchEvent(new Event("input", { bubbles: true }));
        timeline.dispatchEvent(new Event("change", { bubbles: true }));
        return { id: timeline.id, value: timeline.value, duration: video.duration, seconds, events: ["input", "change"] };
      }, seek);
      const sought = await until(async () => {
        const p = await sample("after-real-timeline-seek");
        return playing(p.control?.[0]) && playing(p.audience?.[0]) && Math.abs(p.control[0].time - seek) < 3 && Math.abs(p.audience[0].time - seek) < 3 && p;
      }, "actual control timeline seeks both live audience and control while playback continues");
      check(true, "late start uses actual control scrubber input, not direct media currentTime or presentation IPC", {
        action: report.seekAction, controlTime: sought.control[0].time, audienceTime: sought.audience[0].time });
    }
    const beforeStage = await until(async () => {
      const p = await sample("before-stage");
      return playing(p.control?.[0]) && playing(p.control?.[1]) && playing(p.audience?.[0]) && p.capture?.pid.calls >= 5 && p;
    }, "real audience, control, audience confidence and PID all running", 20_000);
    check(beforeStage.output.stage.window === "closed" && sameLocalSource(beforeStage.control[0].src, preview.src) && !beforeStage.control[0].srcObject &&
      localSource(beforeStage.audience[0].src) && !beforeStage.audience[0].muted && beforeStage.audience[0].volume > 0 &&
      beforeStage.capture.pid.videoId === "preview", "stage disabled while real queue video presents with production audio and control PID", { pid: beforeStage.capture.pid, audienceAudio: { muted: beforeStage.audience[0].muted, volume: beforeStage.audience[0].volume, audioDecodedBytes: beforeStage.audience[0].audioDecodedBytes } });
    check(beforeStage.capture.displayMedia.length === 1 && !beforeStage.capture.displayMedia[0].error &&
      beforeStage.capture.displayMedia[0].streamId === beforeStage.control[1].streamId &&
      beforeStage.capture.displayMedia[0].tracks.some((t) => t.kind === "video" && t.readyState === "live") &&
      beforeStage.capture.userMedia.length === 0 && beforeStage.capture.canvasCalls === 0 && beforeStage.capture.sourceCalls === 0 &&
      beforeStage.capture.snapshotCalls === 0 && await invoke("stage-preview-source", { sessionId: beforeStage.output.sessionId }) === null,
      "one mandatory real audience getDisplayMedia stream is live before stage; manual source probes do not increment production-site counters");
    if (externalVideo) {
      const sinksResult = await run("pactl", ["--format=json", "list", "sinks"], audioEnv, "audio-sinks").outcome;
      assert.equal(sinksResult.code, 0);
      const sink = JSON.parse(await fsp.readFile(sinksResult.stdout, "utf8")).find((s) => s.name === report.audioRouting.sinkName);
      assert.ok(sink, "owned null sink exists");
      const inputsResult = await run("pactl", ["--format=json", "list", "sink-inputs"], audioEnv, "audio-sink-inputs").outcome;
      assert.equal(inputsResult.code, 0);
      const inputs = JSON.parse(await fsp.readFile(inputsResult.stdout, "utf8")).filter((s) => Number(s.sink) === Number(sink.index));
      report.audioRouting.inputs = inputs.map((s) => ({ index: s.index, sink: s.sink, mute: s.mute,
        processId: s.properties?.["application.process.id"], application: s.properties?.["application.name"] }));
      check(inputs.length > 0 && inputs.some((s) => s.mute === false), "OS observes unmuted application audio on the isolated null sink", report.audioRouting);
    }
    const initialAudience = beforeStage.audience[0];
    if (initialAudience.src.startsWith("file:")) assert.equal(fileURLToPath(initialAudience.src), fixture, "audience decodes original external file despite URL escaping/cache-key differences");
    let priorSession, audienceBaseline = initialAudience, controlBaseline = beforeStage.control[0], pidBaseline = beforeStage.capture.pid.calls;
    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      const beforeEnable = await until(async () => {
        const p = await sample(`cycle-${cycle}-confirm-live-before-enable`);
        const a = p.audience?.[0], c = p.control?.[0];
        return p.output?.stage.window === "closed" && playing(a) && playing(c) && playing(p.control?.[1]) &&
          a.frames >= audienceBaseline.frames + 3 && a.time > audienceBaseline.time + 0.1 &&
          c.frames >= controlBaseline.frames + 3 && c.time > controlBaseline.time + 0.1 && p.capture?.pid.calls > pidBaseline && p;
      }, `cycle ${cycle}: prove audience/control frames and PID advance BEFORE enabling stage`);
      check(true, "stage enable begins with audience/control frames and PID already advancing", { cycle,
        audienceFrames: beforeEnable.audience[0].frames, controlFrames: beforeEnable.control[0].frames, pidCalls: beforeEnable.capture.pid.calls });
      await sample(`cycle-${cycle}-before-enable`, true);
      await click("#openStageControlsBtn");
      await select("stageDisplaySelect", display);
      await click("#closeStageControlsBtn");
      const opened = await until(async () => { const s = await status(); return s.stage.window === "open" && s.stage.health === "ok" && s; }, `cycle ${cycle}: stage enabled by real selector`);
      assert.ok(opened.sessionId && opened.sessionId !== priorSession, "fresh stage session");
      const stageTarget = await until(async () => (await targets()).find((t) => t.type === "page" && /\/stage-window\/stage\.prod\.html$/.test(t.url)), "real stage target");
      currentStage = await connect(stageTarget, `stage-${cycle}`);
      await currentStage.evaluate(installMediaProbe);
      const source = await invoke("stage-preview-source", { sessionId: opened.sessionId });
      if (expectSnapshot) check(source === null,
        "Linux Electron 40 real main refuses a native stage source during live playback", { cycle, stageBackend });
      else {
        assert.match(source?.sourceId || "", /^window:[1-9]\d*:\d+$/);
        assert.equal(source.sessionId, opened.sessionId);
        assert.ok(Number(source.sourceId.split(":")[1]) > 10000, "actual X11 native ID, not synthetic Wayland ID 2");
      }
      // Snapshot mode must not ask main for a native source just to find the
      // window. Read its real X11 title/ID, then verify ownership and geometry.
      const tree = await run("xwininfo", ["-root", "-tree"], env, `stage-${cycle}-window-tree`).outcome;
      assert.equal(tree.code, 0, "xwininfo enumerates actual desktop windows");
      const stageWindows = [...(await fsp.readFile(tree.stdout, "utf8")).matchAll(/^\s*(0x[\da-f]+)\s+"EMS Stage Output"/gmi)];
      assert.equal(stageWindows.length, 1, "exactly one real EMS Stage Output desktop window");
      const windowId = String(Number(stageWindows[0][1]));
      if (!expectSnapshot) assert.equal(windowId, source.sourceId.split(":")[1], "advertised native source is the real stage window");
      let geometryAttempt = 0;
      const fullscreen = await until(async () => {
        // Electron does not implement CDP Browser.getWindowForTarget. Observe
        // the actual capture window's X11 state/bounds, without changing them.
        const label = `stage-${cycle}-geometry-${++geometryAttempt}`;
        const properties = await run("xprop", ["-id", windowId, "_NET_WM_STATE", "_NET_WM_PID"], env, `${label}-xprop`).outcome;
        const bounds = await run("xwininfo", ["-id", windowId], env, `${label}-xwininfo`).outcome;
        assert.equal(properties.code, 0, "xprop can inspect the real stage native window");
        assert.equal(bounds.code, 0, "xwininfo can inspect the real stage native window");
        const state = await fsp.readFile(properties.stdout, "utf8"), info = await fsp.readFile(bounds.stdout, "utf8");
        const field = (name) => Number(info.match(new RegExp(`${name}:\\s*(-?\\d+)`))?.[1] ?? NaN);
        const native = { windowId, fullscreen: /\b_NET_WM_STATE_FULLSCREEN\b/.test(state),
          browserPid: Number(state.match(/_NET_WM_PID[^=]*=\s*(\d+)/)?.[1]),
          x: field("Absolute upper-left X"), y: field("Absolute upper-left Y"), width: field("Width"), height: field("Height"),
          viewable: /Map State:\s*IsViewable/.test(info) };
        const geometry = await currentStage.evaluate(() => ({ innerWidth, innerHeight, outerWidth, outerHeight,
          screenX, screenY, devicePixelRatio, screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight } }));
        report.lastStageGeometry = { cycle, native, geometry, expected: selectedDisplay.bounds };
        const expected = selectedDisplay.bounds;
        return native.fullscreen && native.viewable && native.browserPid === browserPid && native.x === expected.x && native.y === expected.y &&
          native.width === expected.width && native.height === expected.height &&
          geometry.innerWidth === expected.width && geometry.innerHeight === expected.height && report.lastStageGeometry;
      }, `cycle ${cycle}: native stage FULLSCREEN and full selected-display geometry`);
      check(true, "stage is native fullscreen at actual selected-display bounds, not merely visible", fullscreen);
      // Keep stage confidence visible, through the actual carousel UI.
      await until(() => control.evaluate(() => Boolean(document.querySelector('#confidenceMonitorDots [data-page="stage"]'))), "stage carousel dot");
      await click('#confidenceMonitorDots [data-page="stage"]');
      const first = await until(async () => {
        const p = await sample(`cycle-${cycle}-first-frames`);
        return playing(p.control?.[3]) && playing(p.stage?.[0]) && p;
      }, `cycle ${cycle}: ${stageBackend} confidence and stage local decoder start`);
      const confidence = first.control[3];
      const acquisition = first.capture.userMedia.find((r) => r.streamId === confidence.streamId);
      const snapshotTrack = (s) => s?.tracks.length === 1 && s.tracks[0].kind === "video" && s.tracks[0].readyState === "live" &&
        s.tracks[0].settings.width > 0 && s.tracks[0].settings.width <= 640 &&
        s.tracks[0].settings.height > 0 && s.tracks[0].settings.height <= 360 &&
        s.tracks[0].settings.frameRate > 0 && s.tracks[0].settings.frameRate <= 10 &&
        s.width <= 640 && s.height <= 360 && s.muted && s.volume === 0;
      if (expectSnapshot) {
        const canvas = first.capture.canvasStreams.find((s) => s.id === confidence.streamId);
        check(snapshotTrack(confidence) && canvas?.fps === 10 && canvas.width <= 640 && canvas.height <= 360 &&
          first.capture.canvasCalls === cycle && first.capture.snapshotCalls > beforeEnable.capture.snapshotCalls &&
          first.capture.userMedia.length === 0 && first.capture.displayMedia.length === 1,
        "automatic stage snapshot is a real muted video-only <=640x360 10fps canvas stream; no stage native acquisition",
        { cycle, sessionId: opened.sessionId, stageBackend, confidence, canvas, capture: first.capture });
      } else {
        check(confidence.tracks.length === 1 && confidence.tracks[0].kind === "video" && confidence.tracks[0].readyState === "live" &&
          confidence.tracks[0].settings.deviceId === source.sourceId && acquisition?.args[0]?.video?.mandatory?.chromeMediaSourceId === source.sourceId &&
          acquisition.args[0].audio === false && confidence.muted && confidence.volume === 0 && first.capture.snapshotCalls === 0 && first.capture.canvasCalls === 0,
        "stage confidence is real native window capture, not snapshots/canvas fallback", { cycle, sessionId: opened.sessionId, sourceId: source.sourceId, streamId: confidence.streamId });
      }
      const local = await currentStage.evaluate(() => ({ sessionId: window.stageOutput?.sessionId,
        kind: document.getElementById("stageRoot")?.dataset.currentMedia,
        streams: [...document.querySelectorAll("video,audio")].filter((v) => v.srcObject).map((v) => v.id),
        sources: [...document.querySelectorAll("video,audio")].filter((v) => v.currentSrc).map((v) => ({ id: v.id, src: v.currentSrc, muted: v.muted, volume: v.volume })) }));
      check(local.sessionId === opened.sessionId && local.streams.length === 0 && local.sources.some((v) => v.id === "stageAudiencePreview" && sameLocalSource(v.src, initialAudience.src)) &&
        local.sources.every((v) => v.muted || v.volume === 0), "stage uses its local stageAudiencePreview decoder, silent and without srcObject capture feedback", { cycle, local });
      // Each real dialog opening fetches status and runs production
      // updateStageStatusUi. Do not call renderer helpers or synthesize status.
      for (let refresh = 0; refresh < 3; refresh++) {
        await click("#openStageControlsBtn");
        await until(() => control.evaluate(() => document.getElementById("stageControlsBackdrop")?.hidden === false), "real stage status dialog refreshed");
        await click("#closeStageControlsBtn");
      }
      const advanced = await until(async () => {
        const p = await sample(`cycle-${cycle}-advancing`);
        const n = p.control?.[3], a = p.audience?.[0], c = p.control?.[0], s = p.stage?.[0];
        return playing(n) && n.streamId === confidence.streamId && n.frames >= confidence.frames + (expectSnapshot ? 10 : 30) &&
          (expectSnapshot || n.callbacks.count >= confidence.callbacks.count + 30) &&
          (!expectSnapshot || p.capture.snapshotCalls > first.capture.snapshotCalls) &&
          n.pixels?.litFraction > 0.001 && n.pixels.hash !== confidence.pixels?.hash &&
          playing(a) && a.time > audienceBaseline.time + 0.5 && a.frames > audienceBaseline.frames + 10 &&
          playing(c) && c.time > controlBaseline.time + 0.5 && c.frames > controlBaseline.frames + 10 &&
          playing(s) && s.frames > first.stage[0].frames + 10 && s.time > first.stage[0].time + 0.3 &&
          p.capture.pid.calls > first.capture.pid.calls && p;
      }, `cycle ${cycle}: ${expectSnapshot ? "10 snapshot" : "30 native"} decoded frames and changing pixels within 12s plus local/audience/control/PID advancement`, 12_000);
      check(advanced.capture.displayMedia.length === 1 && advanced.capture.sourceCalls === cycle &&
        (expectSnapshot ? advanced.capture.userMedia.length === 0 && advanced.capture.canvasCalls === cycle &&
          advanced.capture.snapshotCalls > first.capture.snapshotCalls && snapshotTrack(advanced.control[3]) :
          advanced.capture.userMedia.length === cycle && advanced.capture.snapshotCalls === 0 && advanced.capture.canvasCalls === 0) &&
        advanced.control[1].streamId === beforeStage.control[1].streamId &&
        advanced.capture.displayMedia[0].tracks.some((t) => t.kind === "video" && t.readyState === "live") &&
        advanced.stageCapture.userMedia.length === 0 && advanced.stageCapture.displayMedia.length === 0 &&
        advanced.stage[0].id === "stageAudiencePreview" && !advanced.stage[0].srcObject &&
        [advanced.control[0], advanced.audience[0], advanced.stage[0]].every((s) => s.width === report.width && s.height === report.height) &&
        !advanced.audience[0].muted && advanced.audience[0].volume > 0,
      `${expectSnapshot ? "10+ snapshot" : "30+ native"} frames advance; status refreshes reuse one stream/session; original native audience confidence, local decoders and PID intact`,
      { cycle, stageBackend, previewFrames: advanced.control[3].frames - confidence.frames,
        callbacks: advanced.control[3].callbacks.count - confidence.callbacks.count, audienceTime: advanced.audience[0].time,
        controlTime: advanced.control[0].time, pidCalls: advanced.capture.pid.calls, canvasCalls: advanced.capture.canvasCalls,
        sourceCalls: advanced.capture.sourceCalls, snapshotCalls: advanced.capture.snapshotCalls, output: advanced.output });
      if (expectSnapshot) check(await invoke("stage-preview-source", { sessionId: opened.sessionId }) === null,
        "real main still advertises no native stage source while snapshot/local/audience frames advance", { cycle });
      await control.evaluate(() => window.__stageVideoUI.oldStreams.push(document.getElementById("confidenceStagePreview").srcObject));
      await click("#openStageControlsBtn");
      await select("stageDisplaySelect", "");
      await click("#closeStageControlsBtn");
      await until(async () => (await status()).stage.window === "closed" && !(await targets()).some((t) => t.id === stageTarget.id), "stage window closes through real UI");
      await until(() => control.evaluate(() => !document.getElementById("confidenceStagePreview").srcObject && window.__stageVideoUI.summary().oldTracksEnded), `old stage ${stageBackend} tracks end and sink detaches`);
      check((await summary()).oldTracksEnded && await invoke("stage-preview-source", { sessionId: opened.sessionId }) === null,
        `stage disable ends old ${expectSnapshot ? "snapshot" : "native"} tracks and invalidates source session`, { cycle });
      report.cycles.push({ cycle, sessionId: opened.sessionId, backend: stageBackend, fullscreen, source, beforeEnable, first, advanced, local, closed: await status() });
      audienceBaseline = advanced.audience[0]; controlBaseline = advanced.control[0]; priorSession = opened.sessionId;
      pidBaseline = advanced.capture.pid.calls;
      currentStage.close(); currentStage = null;
    }
    report.finalProbe = await sample("completed-five-cycles", true);
    check(report.cycles.length === CYCLES && report.finalProbe.capture.oldStreams.length === CYCLES && report.finalProbe.capture.oldTracksEnded &&
      report.finalProbe.capture.pid.calls > beforeStage.capture.pid.calls && playing(report.finalProbe.audience[0]) && playing(report.finalProbe.control[0]), "five complete real-UI enable/disable cycles leave audience/control playback and PID alive");
    check(report.finalProbe.capture.sourceCalls === CYCLES && report.finalProbe.capture.displayMedia.length === 1 &&
      (expectSnapshot ? report.finalProbe.capture.userMedia.length === 0 && report.finalProbe.capture.canvasCalls === CYCLES &&
        report.finalProbe.capture.canvasStreams.length === CYCLES && report.finalProbe.capture.snapshotCalls > 0 &&
        report.finalProbe.capture.canvasStreams.every((s) => s.tracks.every((t) => t.readyState === "ended")) :
        report.finalProbe.capture.userMedia.length === CYCLES && report.finalProbe.capture.canvasCalls === 0 && report.finalProbe.capture.snapshotCalls === 0),
      "exactly one production source attempt and one backend stream per stage session; all old tracks ended; no additional audience acquisition",
      { stageBackend, capture: report.finalProbe.capture });
    check(report.rendererEvents.every((e) => e.method !== "Inspector.targetCrashed" && e.method !== "Runtime.exceptionThrown"), "no observed real renderer crashes or unhandled exceptions", { count: report.rendererEvents.length });
    const settings = path.join(profile, "settings.json");
    check(fs.existsSync(settings), "production settings write is confined to the isolated --user-data-dir", { settings });
  } catch (error) {
    failure = error;
    report.failure = errorInfo(error);
    emit("failure", report.failure);
    // A renderer's CDP close can precede main's native exit. Give the owned
    // process its real exit opportunity before SIGKILL; never replace SIGILL.
    if (child && child.exitCode === null && !child.signalCode && !abort.signal.aborted) {
      await Promise.race([child.outcome, pause(1000)]);
      const native = await nativeState();
      if (nativeBacktrace && native?.stopSignal && child.exitCode === null && !child.signalCode) {
        // A stopped browser cannot answer CDP. Let gdb finish the entire stack,
        // registers and mappings before any cleanup is permitted to kill it.
        await Promise.race([child.outcome, pause(Math.min(60_000, remaining()))]);
      } else if (child.exitCode === null && !child.signalCode) await sample("failure", true).catch(() => {});
    }
  } finally {
    if (nativeBacktrace && child) {
      report.browserPreCleanup = await nativeState();
      report.debuggerPreCleanupOutcome = { code: child.exitCode, signal: child.signalCode };
    }
    report.preCleanupOutcome = nativeBacktrace ? report.browserPreCleanup || null : child ? { code: child.exitCode, signal: child.signalCode } : null;
    if (nativeDump) {
      // Crashpad is a separate process: leave its owned process group alive for
      // two seconds after native exit, before killing children/removing profile.
      // Dumps live under the retained report, never the disposable profile.
      if (child?.signalCode && child.signalCode !== "SIGKILL") {
        const exitedAt = report.processes.find((p) => p.pid === child.pid)?.elapsedMs;
        const grace = Math.max(0, 2000 - (Date.now() - started - (exitedAt ?? Date.now() - started)));
        if (grace) await pause(grace);
        report.crashpadGraceMs = 2000;
      }
      const dumps = [];
      const walk = async (directory) => {
        for (const entry of await fsp.readdir(directory, { withFileTypes: true }).catch(() => [])) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) await walk(file);
          else if (entry.isFile() && entry.name.endsWith(".dmp")) {
            const stat = await fsp.stat(file);
            dumps.push({ path: file, bytes: stat.size, sha256: await fileHash(file) });
          }
        }
      };
      await walk(path.join(reportDir, "dumps"));
      report.nativeDumps = dumps;
      emit("native-dumps", { dumps, uploadToServer: false });
    }
    stopping = true;
    killGroups();
    for (const client of clients) client.close();
    if (child) report.childOutcome = await child.outcome;
    if (nativeBacktrace) report.debuggerOutcome = report.childOutcome;
    clearTimeout(watchdog);
    if (audioModule) {
      try {
        const unload = spawn("pactl", ["unload-module", audioModule], { env: audioEnv, stdio: ["ignore", "ignore", "pipe"], timeout: 5000 });
        const outcome = await new Promise((resolve) => {
          unload.once("error", (error) => resolve({ error: errorInfo(error) }));
          unload.once("close", (code, signal) => resolve({ code, signal }));
        });
        report.audioRouting.cleanup = outcome;
        assert.equal(outcome.code, 0, "owned OS null sink removed");
      } catch (error) { report.audioCleanupError = errorInfo(error); failure ||= error; }
    }
    if (fixtureIdentity) {
      try {
        report.fixtureIdentityAfter = await fileIdentity(fixture);
        report.fixtureSha256After = await fileHash(fixture);
        check(report.fixtureSha256After === report.fixtureSha256 && JSON.stringify(report.fixtureIdentityAfter) === JSON.stringify(fixtureIdentity),
          "original fixture remains byte-identical with unchanged inode/size/mtime/ctime, including failed runs", { external: Boolean(externalVideo) });
      } catch (error) { report.fixtureIntegrityError = errorInfo(error); failure ||= error; }
    }
    try {
      await fsp.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      report.cleaned = !fs.existsSync(temporary);
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
      assert.equal(survivors.length, 0, "no live owned group members remain");
    } catch (error) { report.cleanupError = errorInfo(error); failure ||= error; }
    if (report.childOutcome) {
      for (const stream of ["stdout", "stderr"]) {
        const text = await fsp.readFile(report.childOutcome[stream], "utf8").catch(() => "");
        report[`${stream}Tail`] = text.split("\n").slice(-100).join("\n");
      }
      const signal = !nativeBacktrace && report.preCleanupOutcome?.signal;
      if (signal && signal !== "SIGKILL") {
        report.nativeCrash = { signal, browserPid: browserPid || child.pid, corePattern: (await fsp.readFile("/proc/sys/kernel/core_pattern", "utf8").catch(() => "unavailable")).trim() };
        // Metadata/backtraces only: never copy a core (which may contain media
        // frames), attach a debugger, or perturb a live app's crash behaviour.
        const coreInfo = spawn("coredumpctl", ["--no-pager", "--since", `@${Math.floor(started / 1000)}`, "info", String(child.pid)],
          { stdio: ["ignore", "pipe", "pipe"], timeout: 5000 });
        let text = "";
        for (const stream of [coreInfo.stdout, coreInfo.stderr]) stream.on("data", (chunk) => { if (text.length < 96_000) text += chunk.toString(); });
        report.nativeCrash.coredumpctl = await new Promise((resolve) => {
          coreInfo.once("error", (error) => resolve({ error: errorInfo(error) }));
          coreInfo.once("close", (code, signal) => resolve({ code, signal }));
        });
        report.nativeCrash.addressTail = [report.stdoutTail, report.stderrTail, text].join("\n").split("\n")
          .filter((line) => /0x[\da-f]+|\bSIG[A-Z]+\b|Received signal|^\s*#\d+|gdb|Stack trace/i.test(line)).slice(-160).join("\n");
        await fsp.writeFile(path.join(reportDir, "native-crash-info.log"), text);
        await fsp.writeFile(path.join(reportDir, "gdb-address-tail.log"), report.nativeCrash.addressTail || `No stack addresses available; observed ${signal}\n`);
      }
    }
    report.elapsedMs = Date.now() - started;
    report.interrupted = interrupted || null;
    if (failure) report.failure ||= errorInfo(failure);
    report.passed = !failure && !report.watchdog && !interrupted && report.cleaned && report.survivors?.length === 0 &&
      report.preCleanupOutcome?.code === null && report.preCleanupOutcome?.signal === null &&
      (!nativeBacktrace || report.browserPreCleanup?.state === "running" && !report.nativeCrash && report.debuggerPreCleanupOutcome?.code === null && !report.debuggerPreCleanupOutcome?.signal) &&
      report.childOutcome?.signal === "SIGKILL" && report.childOutcome.supervisorStopping;
    await fsp.writeFile(path.join(reportDir, "summary.json"), JSON.stringify(report, null, 2));
    emit("summary", { passed: report.passed, checks: report.checks.length, cycles: report.cycles.length, reportDir,
      stageBackend, nativeCrash: report.nativeCrash?.signal || null,
      ...(nativeDump ? { nativeDumps: report.nativeDumps } : {}),
      preCleanupOutcome: report.preCleanupOutcome, childOutcome: { code: report.childOutcome?.code, signal: report.childOutcome?.signal, supervisorStopping: report.childOutcome?.supervisorStopping },
      elapsedMs: report.elapsedMs, cleaned: report.cleaned, survivors: report.survivors, failure: report.failure?.message });
    await new Promise((resolve) => events.end(resolve));
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    process.exitCode = report.passed ? 0 : 1;
  }
}

main().catch((error) => { console.error(`STAGE_VIDEO_UI supervisor-error ${error.stack || error}`); process.exitCode = 1; });