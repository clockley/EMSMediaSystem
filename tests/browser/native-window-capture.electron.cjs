/**
 * Isolated Electron 40.10.6 Linux native-window capture experiment. NO app imports.
 * Run under Node (not electron): node tests/browser/native-window-capture.electron.cjs
 * Optional second runs: --backend=window-id|webframe|window-user-media
 * Optional native flags: --disable-gpu --ozone-platform=x11 (none by default)
 * Defaults: both backends in separate processes, 10 safe cycles each, then two
 * abrupt-destroy cycles ONLY after that backend's entire safe phase passes.
 * window-user-media uses getUserMedia with the fixed desktop window source ID,
 * without executeJavaScript userGesture, getDisplayMedia, or a picker.
 *
 * Node owns the 90s overall deadline, generated original MP4, isolated profiles,
 * persistent /tmp logs, and detached child process groups (including on SIGILL).
 * Never enumerates desktop sources, opens the portal picker, captures a screen,
 * imports app code, touches real settings, or substitutes capturePage/canvas
 * streams for native capture. The canvas below is SOURCE CONTENT/pixel analysis.
 *
 * API contract verified against Electron v40.10.6 session.md/browser-window.md:
 * callback({video:{id:target.getMediaSourceId(),name:'EMS capture probe'}})
 * is a desktop window source, unlike callback({video:target.webContents.mainFrame}).
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const DEADLINE_MS = 90_000;
const EXPECTED_ELECTRON = "45.4.1";
const PREFIX = "NATIVE_WINDOW_CAPTURE";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errorInfo = (error) => ({ name: error.name, message: error.message, stack: error.stack });
const emit = (event, details = {}) => console.log(`${PREFIX} ${JSON.stringify({ event, at: new Date().toISOString(), ...details })}`);

function options() {
  const args = process.argv.slice(2);
  const get = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
  const backend = get("backend", "both");
  assert.ok(["both", "window-id", "webframe", "window-user-media"].includes(backend), "Unknown backend");
  const cycles = Number(get("cycles", "10"));
  const abrupt = Number(get("abrupt-cycles", "2"));
  assert.ok(Number.isInteger(cycles) && cycles >= 1 && cycles <= 20, "cycles must be 1..20");
  assert.ok(Number.isInteger(abrupt) && abrupt >= 0 && abrupt <= 2, "abrupt-cycles must be 0..2");
  return { backend, cycles, abrupt, flags: args.filter((arg) => !/^--(?:backend|cycles|abrupt-cycles)=/.test(arg)) };
}

async function supervise() {
  const config = options();
  assert.equal(require("electron/package.json").version, EXPECTED_ELECTRON, "Use the actual requested installed runtime");
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "ems-native-capture-work-"));
  const logs = await fsp.mkdtemp(path.join(os.tmpdir(), "ems-native-capture-logs-"));
  const summary = { config, temporary, logs, deadlineMs: DEADLINE_MS, processes: [] };
  const started = Date.now();
  const groups = new Set();
  let interrupted;
  let timedOut = false;
  let timer;
  const killGroups = () => {
    for (const pid of groups) {
      try { process.kill(-pid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") emit("kill-error", errorInfo(error)); }
    }
  };
  const onSignal = (signal) => { interrupted = signal; killGroups(); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  timer = setTimeout(() => { timedOut = true; killGroups(); }, DEADLINE_MS);

  // Every external process, including ffmpeg, belongs to a supervised group.
  async function run(executable, args, label, env = process.env) {
    assert.ok(!interrupted && !timedOut, "Supervisor interrupted/deadline reached");
    const logPath = path.join(logs, `${label}.log`);
    const descriptor = fs.openSync(logPath, "w");
    let child;
    let outcome;
    try {
      child = spawn(executable, args, { cwd: path.resolve(__dirname, "../.."), detached: true, env, stdio: ["ignore", descriptor, descriptor] });
      if (child.pid) groups.add(child.pid);
      emit("spawn", { label, pid: child.pid, executable, args, logPath });
      outcome = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
    } finally {
      if (child?.pid) {
        try { process.kill(-child.pid, "SIGKILL"); }
        catch (error) { if (error.code !== "ESRCH") emit("kill-error", errorInfo(error)); }
      }
      fs.closeSync(descriptor);
    }
    const result = { label, pid: child.pid, ...outcome, logPath, elapsedMs: Date.now() - started };
    summary.processes.push(result);
    emit("process-exit", result);
    return result;
  }

  emit("supervisor", { ...summary, electron: require("electron/package.json").version, node: process.version,
    environment: { XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
      DISPLAY: process.env.DISPLAY, ELECTRON_OZONE_PLATFORM_HINT: process.env.ELECTRON_OZONE_PLATFORM_HINT || null } });
  try {
    assert.equal(process.platform, "linux", "This process-group/backend probe is Linux-specific");
    const mediaPath = path.join(temporary, "original-testsrc.mp4");
    const generated = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
      "testsrc2=size=640x360:rate=30:duration=5", "-c:v", "libx264", "-preset", "ultrafast", "-threads", "2",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mediaPath], "ffmpeg");
    assert.equal(generated.code, 0, `ffmpeg failed; see ${generated.logPath}`);
    for (const backend of config.backend === "both" ? ["window-id", "webframe"] : [config.backend]) {
      const report = path.join(logs, `${backend}.json`);
      const result = await run(require("electron"), [__filename, ...config.flags], backend, {
        ...process.env, ELECTRON_RUN_AS_NODE: "", EMS_NATIVE_CAPTURE_CHILD: backend,
        EMS_NATIVE_CAPTURE_WORK: path.join(temporary, backend), EMS_NATIVE_CAPTURE_MEDIA: mediaPath,
        EMS_NATIVE_CAPTURE_REPORT: report, EMS_NATIVE_CAPTURE_CYCLES: String(config.cycles),
        EMS_NATIVE_CAPTURE_ABRUPT: String(config.abrupt),
      });
      result.reportPath = report;
      if (fs.existsSync(report)) result.report = JSON.parse(await fsp.readFile(report, "utf8"));
      // Separate child processes preserve the primary result if the tab path traps.
      if (timedOut || interrupted) break;
    }
  } catch (error) {
    summary.error = errorInfo(error);
    emit("supervisor-error", summary.error);
  } finally {
    clearTimeout(timer);
    killGroups();
    try {
      await fsp.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      summary.cleaned = !fs.existsSync(temporary);
    } catch (error) { summary.cleanupError = errorInfo(error); }
    summary.timedOut = timedOut;
    summary.interrupted = interrupted || null;
    summary.elapsedMs = Date.now() - started;
    const expected = config.backend === "both" ? 2 : 1;
    const probes = summary.processes.filter((result) => result.label !== "ffmpeg");
    summary.passed = !summary.error && !summary.cleanupError && !timedOut && !interrupted && probes.length === expected &&
      probes.every((result) => result.code === 0 && !result.signal && result.report?.passed);
    const summaryPath = path.join(logs, "summary.json");
    await fsp.writeFile(summaryPath, JSON.stringify(summary, null, 2));
    emit("supervisor-summary", { summaryPath, passed: summary.passed, cleaned: summary.cleaned, timedOut,
      interrupted: summary.interrupted, elapsedMs: summary.elapsedMs,
      outcomes: probes.map(({ label, code, signal, report }) => ({ backend: label, code, signal,
        safePassed: report?.safePassed, abruptPassed: report?.abruptPassed, failure: report?.failure })) });
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    process.exitCode = summary.passed ? 0 : 1;
  }
}

function targetPage() {
  const canvas = document.querySelector("canvas");
  const context = canvas.getContext("2d");
  const video = document.querySelector("video");
  let revision = 0;
  let ticks = 0;
  window.setRevision = (value) => { revision = value; };
  const paint = () => {
    if (canvas.width !== innerWidth || canvas.height !== innerHeight) {
      canvas.width = innerWidth;
      canvas.height = innerHeight;
    }
    context.fillStyle = revision ? "rgb(40,190,115)" : "rgb(210,45,95)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.fillRect((ticks * 13) % Math.max(1, canvas.width - 80), canvas.height * 0.75, 70, 45);
    context.font = "24px sans-serif";
    context.fillText(`EMS TARGET rev=${revision} tick=${++ticks}`, 14, canvas.height * 0.55);
  };
  paint();
  setInterval(paint, 1000 / 30);
  window.startMP4 = async (url) => {
    video.src = url;
    video.hidden = false;
    await video.play();
  };
  window.targetState = () => ({ ticks, revision, width: innerWidth, height: innerHeight,
    visibility: document.visibilityState, video: { frames: video.getVideoPlaybackQuality().totalVideoFrames,
      decodedVideoFrames: video.webkitDecodedFrameCount, time: video.currentTime, paused: video.paused,
      readyState: video.readyState, width: video.videoWidth, height: video.videoHeight,
      error: video.error ? { code: video.error.code, message: video.error.message } : null } });
}

function sinkPage() {
  const video = document.querySelector("video");
  const analysis = document.createElement("canvas");
  analysis.width = 64;
  analysis.height = 36;
  const context = analysis.getContext("2d", { willReadFrequently: true });
  let stream;
  let epoch = 0;
  const events = [];
  window.acquire = async (sourceId, backend) => {
    const ownEpoch = ++epoch;
    const userMedia = backend === "window-user-media";
    const userActivation = { isActive: navigator.userActivation.isActive, hasBeenActive: navigator.userActivation.hasBeenActive };
    if (userMedia && (userActivation.isActive || userActivation.hasBeenActive)) throw new Error("Startup capture must have no current or prior user activation");
    stream = userMedia
      ? await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: {
        chromeMediaSource: "desktop", chromeMediaSourceId: sourceId, maxWidth: 640, maxHeight: 360, maxFrameRate: 30,
      } } })
      : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    if (epoch !== ownEpoch) { stream.getTracks().forEach((track) => track.stop()); throw new Error("Cancelled acquisition"); }
    const [track] = stream.getVideoTracks();
    for (const type of ["ended", "mute", "unmute"]) track.addEventListener(type, () => events.push({ type, at: performance.now(), state: track.readyState }));
    const beforeConstraints = track.getSettings();
    await track.applyConstraints({ width: { ideal: 640, max: 640 }, height: { ideal: 360, max: 360 }, frameRate: { ideal: 30, max: 30 } });
    video.srcObject = stream;
    await video.play();
    return { api: userMedia ? "getUserMedia" : "getDisplayMedia", sourceId, userActivation,
      beforeConstraints, settings: track.getSettings(), constraints: track.getConstraints(),
      audioTracks: stream.getAudioTracks().length, streamId: stream.id, label: track.label };
  };
  window.sinkState = () => {
    let pixels = null;
    if (video.readyState >= 2 && video.videoWidth) {
      try {
        context.drawImage(video, 0, 0, 64, 36);
        const rgba = context.getImageData(0, 0, 64, 36).data;
        let lit = 0;
        let sum = 0;
        let hash = 2166136261;
        for (let i = 0; i < rgba.length; i += 4) {
          const light = (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
          if (light > 12) lit++;
          sum += light;
          hash = Math.imul(hash ^ rgba[i], 16777619);
          hash = Math.imul(hash ^ rgba[i + 1], 16777619);
          hash = Math.imul(hash ^ rgba[i + 2], 16777619);
        }
        const marker = (4 * 64 + 6) * 4;
        pixels = { litFraction: lit / (64 * 36), mean: sum / (64 * 36), hash: hash >>> 0,
          marker: Array.from(rgba.slice(marker, marker + 3)) };
      } catch (error) { pixels = { error: { name: error.name, message: error.message } }; }
    }
    return { at: performance.now(), frames: video.getVideoPlaybackQuality().totalVideoFrames,
      decodedVideoFrames: video.webkitDecodedFrameCount, dropped: video.getVideoPlaybackQuality().droppedVideoFrames,
      width: video.videoWidth, height: video.videoHeight, paused: video.paused, readyState: video.readyState,
      visibility: document.visibilityState, pixels, events: events.slice(),
      tracks: stream?.getTracks().map((track) => ({ kind: track.kind, readyState: track.readyState,
        muted: track.muted, settings: track.getSettings() })) || [],
      error: video.error ? { code: video.error.code, message: video.error.message } : null };
  };
  window.stopCapture = () => {
    epoch++;
    const tracks = stream?.getTracks() || [];
    tracks.forEach((track) => track.stop());
    video.pause();
    video.srcObject = null;
    video.removeAttribute("src");
    video.load();
    stream = null;
    return { tracks: tracks.map((track) => ({ kind: track.kind, readyState: track.readyState })), detached: video.srcObject === null };
  };
}

function page(title, script, target = false) {
  const html = `<!doctype html><meta charset="utf-8"><title>${title}</title><style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#192030;color:white;font:16px sans-serif}
    canvas{position:absolute;inset:0;width:100%;height:100%}
    video{width:100%;height:100%;object-fit:contain;background:#151d28}
    ${target ? "video{position:absolute;right:0;bottom:0;width:48%;height:70%}video[hidden]{display:none}" : ""}
    </style>${target ? "<canvas></canvas>" : ""}<video muted autoplay playsinline loop ${target ? "hidden" : ""}></video>
    <script>(${script.toString()})()<\/script>`;
  return html;
}

function electronMain() {
  assert.equal(process.type, "browser", "Run the Node supervisor, not an unsupervised renderer");
  const { app, BrowserWindow, session, screen } = require("electron");
  const backend = process.env.EMS_NATIVE_CAPTURE_CHILD;
  const temporary = process.env.EMS_NATIVE_CAPTURE_WORK;
  assert.ok(temporary && backend, "Run using Node so profiles are cleaned after native crashes");
  const userMedia = backend === "window-user-media";
  const desktopWindow = backend === "window-id" || userMedia;
  for (const directory of ["profile", "session", "logs", "crashes"]) fs.mkdirSync(path.join(temporary, directory), { recursive: true });
  app.setPath("userData", path.join(temporary, "profile"));
  app.setPath("sessionData", path.join(temporary, "session"));
  app.setPath("logs", path.join(temporary, "logs"));
  app.setPath("crashDumps", path.join(temporary, "crashes"));
  // Deliberately do not force Ozone, disable GPU, or change GPU feature flags.
  const report = { backend, executeJavaScriptUserGesture: !userMedia, electron: process.versions.electron, chromium: process.versions.chrome,
    pid: process.pid, argv: process.argv, cycles: [], requests: [], nativeErrors: [], safePassed: 0, abruptPassed: 0, passed: false };
  const persist = () => fs.writeFileSync(process.env.EMS_NATIVE_CAPTURE_REPORT, JSON.stringify(report, null, 2));
  const record = (event, details) => { emit(event, { backend, ...details }); persist(); };
  const cycles = Number(process.env.EMS_NATIVE_CAPTURE_CYCLES);
  const abrupt = Number(process.env.EMS_NATIVE_CAPTURE_ABRUPT);
  let target;
  let sink;
  let captureSession;
  let selected;
  let finishing = false;
  let current;

  // Flush progress before calls which can terminate the browser natively.
  record("runtime", { ...report, environment: { XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE,
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY, DISPLAY: process.env.DISPLAY,
    ELECTRON_OZONE_PLATFORM_HINT: process.env.ELECTRON_OZONE_PLATFORM_HINT || null } });
  const evaluate = async (win, fn, ...args) => {
    const script = `(async()=>{try{return {value:await (${fn.toString()})(...${JSON.stringify(args)})}}
      catch(error){return {error:{name:error.name,message:error.message,stack:error.stack}}}})()`;
    // Startup/autotrigger path: omit userGesture for EVERY evaluation, not just acquisition.
    const result = await (userMedia ? win.webContents.executeJavaScript(script) : win.webContents.executeJavaScript(script, true));
    if (result.error) { const error = new Error(result.error.message); Object.assign(error, result.error); throw error; }
    return result.value;
  };
  const stop = async () => {
    if (!sink || sink.isDestroyed()) return null;
    const stopped = await evaluate(sink, () => window.stopCapture?.());
    record("tracks-stopped", { cycle: current?.cycle, phase: current?.phase, stopped });
    assert.ok(stopped?.detached && stopped.tracks.every((track) => track.readyState === "ended"), "Stop and detach before safe target destroy");
    // Track.stop is synchronous, native teardown is not; allow a drain interval.
    await delay(150);
    return stopped;
  };
  async function finish(code, error) {
    if (finishing) return;
    finishing = true;
    if (error) { report.failure = errorInfo(error); record("failure", { error: report.failure, current }); }
    try {
      await stop();
      selected = null;
      for (const win of [target, sink]) if (win && !win.isDestroyed()) win.destroy();
      captureSession?.setDisplayMediaRequestHandler(null);
      captureSession?.flushStorageData();
      await captureSession?.closeAllConnections();
      report.cleanup = { windowsDestroyed: [target, sink].every((win) => !win || win.isDestroyed()),
        displayMediaHandlerRemoved: true, connectionsClosed: true };
    } catch (cleanupError) { report.cleanupError = errorInfo(cleanupError); code = 1; }
    report.passed = code === 0;
    record("summary", { ...report });
    app.exit(code);
  }
  process.on("uncaughtException", (error) => { void finish(1, error); });
  process.on("unhandledRejection", (error) => { void finish(1, error); });
  app.on("window-all-closed", () => {});
  app.on("child-process-gone", (_event, details) => {
    report.nativeErrors.push({ type: "child-process-gone", ...details });
    record("native-error", details);
  });
  app.on("browser-window-created", (_event, win) => {
    const wc = win.webContents;
    const windowId = win.id;
    wc.on("render-process-gone", (_event, details) => {
      report.nativeErrors.push({ type: "render-process-gone", windowId, ...details });
      record("native-error", { windowId, ...details });
    });
    wc.on("console-message", (event) => {
      if (event.level === "error" || event.level === 3) record("renderer-console-error", { windowId, message: event.message });
    });
  });

  async function until(fn, label, timeout = 3500) {
    const deadline = Date.now() + timeout;
    let last;
    do {
      last = await fn();
      if (last) return last;
      await delay(50);
    } while (Date.now() < deadline);
    throw new Error(`Timed out: ${label}`);
  }

  async function measure(label, revision, checkMP4) {
    current.phase = label;
    record("measure-start", { ...current });
    // Wait for actual decoded frames, not track.live/stream.active/rVFC.
    await until(async () => {
      const state = await evaluate(sink, () => window.sinkState());
      return state.decodedVideoFrames >= 2 && state.width && state.height;
    }, "sink decoded frames");
    const sourceBefore = await evaluate(target, () => window.targetState());
    const samples = [await evaluate(sink, () => window.sinkState())];
    const started = Date.now();
    while (Date.now() - started < 900) {
      await delay(100);
      samples.push(await evaluate(sink, () => window.sinkState()));
    }
    const sourceAfter = await evaluate(target, () => window.targetState());
    const first = samples[0];
    const last = samples.at(-1);
    const seconds = (last.at - first.at) / 1000;
    const decodedFrames = last.decodedVideoFrames - first.decodedVideoFrames;
    const totalFrames = last.frames - first.frames;
    const settled = samples.slice(2);
    const expectedMarker = revision ? [40, 190, 115] : [210, 45, 95];
    const matches = (state) => state.pixels?.marker?.every((value, i) => Math.abs(value - expectedMarker[i]) <= 35);
    const hashes = new Set(settled.map((state) => state.pixels?.hash).filter((value) => value !== undefined));
    const result = { label, seconds, decodedFrames, totalFrames, fps: decodedFrames / seconds,
      totalFps: totalFrames / seconds, uniquePixelHashes: hashes.size, expectedMarker,
      markerMatches: settled.filter(matches).length, sampledFrames: settled.length,
      minLitFraction: Math.min(...settled.map((state) => state.pixels?.litFraction ?? 0)),
      sourceBefore, sourceAfter, sourceDecodedFrames: sourceAfter.video.decodedVideoFrames - sourceBefore.video.decodedVideoFrames,
      sourceFps: (sourceAfter.video.decodedVideoFrames - sourceBefore.video.decodedVideoFrames) / seconds,
      first, last, targetBounds: target.getBounds(), sinkBounds: sink.getBounds() };
    current.results.push(result);
    record("measurement", { cycle: current.cycle, abrupt: current.abrupt, ...result });
    assert.ok(result.fps >= 10, `${label}: decoded sink fps ${result.fps.toFixed(2)} < 10`);
    assert.ok(result.totalFps >= 10, `${label}: playback quality frame counter stalled`);
    assert.ok(result.uniquePixelHashes >= 3, `${label}: decoded frames repeat frozen pixels`);
    assert.ok(result.minLitFraction > 0.35, `${label}: black/mostly black native output`);
    assert.ok(result.markerMatches >= settled.length - 1, `${label}: stream does not match target's color marker`);
    assert.ok(last.tracks.length === 1 && last.tracks[0].readyState === "live" && !last.error, `${label}: invalid native video track`);
    assert.ok(sourceAfter.ticks > sourceBefore.ticks, `${label}: source animation stopped`);
    if (checkMP4) assert.ok(result.sourceFps >= 10 && !sourceAfter.video.paused && !sourceAfter.video.error, `${label}: local H264 decoder stalled`);
    return result;
  }

  async function sourceIdentity(win) {
    const sourceId = win.getMediaSourceId();
    const match = /^window:(\d+):(\d+)$/.exec(sourceId);
    const nativeHandle = win.getNativeWindowHandle().toString("hex");
    const ozoneSwitch = app.commandLine.getSwitchValue("ozone-platform") || null;
    let x11 = { matched: false, skipped: ozoneSwitch === "wayland" };
    // Query only this known source ID; no desktop or window enumeration.
    if (ozoneSwitch !== "wayland" && match && BigInt(match[1]) !== 0n && process.env.DISPLAY) {
      try {
        const output = execFileSync("xprop", ["-id", match[1], "_NET_WM_PID", "_NET_WM_NAME", "WM_CLASS"], { encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "pipe"] });
        x11 = { matched: output.includes(`= ${process.pid}`) && output.includes("EMS capture target"), output };
      } catch (error) { x11 = { matched: false, error: error.message, stderr: String(error.stderr || "") }; }
    }
    return { sourceId, nonzeroWindowId: Boolean(match && BigInt(match[1]) !== 0n), nativeHandle, x11,
      backendEvidence: ozoneSwitch === "wayland" ? "Electron selected ozone-platform=wayland; native ID is not assumed to be an XID" :
        x11.matched ? "X11 native window verified by matching X property PID/title" : "Ozone backend not established by environment/source ID alone",
      ozoneSwitch,
      ozoneHintSwitch: app.commandLine.getSwitchValue("ozone-platform-hint") || null };
  }

  // Do not await whenReady at top level in ESM; this file is deliberately CJS.
  void app.whenReady().then(async () => {
    try {
      assert.equal(process.versions.electron, EXPECTED_ELECTRON);
      report.gpuFeatures = app.getGPUFeatureStatus();
      report.gpuInfo = await app.getGPUInfo("complete");
      report.initialGPU = { features: report.gpuFeatures, info: report.gpuInfo };
      record("gpu", { features: report.gpuFeatures, info: report.gpuInfo });
      captureSession = session.fromPartition(`ems-native-capture-${backend}`);
      captureSession.setDisplayMediaRequestHandler((request, callback) => {
        const owner = selected;
        const allowed = !userMedia && owner && target === owner.target && sink && !sink.isDestroyed() && !owner.target.isDestroyed() &&
          request.frame === sink.webContents.mainFrame && request.videoRequested && !request.audioRequested;
        const entry = { cycle: current?.cycle, abrupt: current?.abrupt, allowed: Boolean(allowed),
          userGesture: request.userGesture, videoRequested: request.videoRequested, audioRequested: request.audioRequested,
          securityOrigin: request.securityOrigin, sourceId: owner?.sourceId, callbackType: backend === "window-id" ? "desktop-window-id" : "WebFrameMain/tab" };
        report.requests.push(entry);
        record("display-media-handler", entry);
        if (!allowed) return callback({});
        if (backend === "window-id") callback({ video: { id: owner.sourceId, name: "EMS capture probe" } });
        else callback({ video: owner.target.webContents.mainFrame });
      }, { useSystemPicker: false });
      const area = screen.getPrimaryDisplay().workArea;
      const origin = { x: area.x + 20, y: area.y + 40 };
      const preferences = { session: captureSession, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false };
      // data: pages have opaque/insecure origins in this runtime and expose no
      // navigator.mediaDevices. Local throwaway HTML is a secure context; do
      // not bypass web security or add insecure-origin Chromium switches.
      const sinkHTML = path.join(temporary, "sink.html");
      const targetHTML = path.join(temporary, "target.html");
      fs.writeFileSync(sinkHTML, page("EMS native capture sink", sinkPage));
      fs.writeFileSync(targetHTML, page("EMS capture target", targetPage, true));
      sink = new BrowserWindow({ ...origin, width: 820, height: 480, frame: false, title: "EMS native capture sink", webPreferences: preferences });
      await sink.loadFile(sinkHTML);
      record("sink-context", await evaluate(sink, () => ({ secureContext: isSecureContext,
        displayMediaAvailable: Boolean(navigator.mediaDevices?.getDisplayMedia),
        userMediaAvailable: Boolean(navigator.mediaDevices?.getUserMedia), userAgent: navigator.userAgent })));
      report.gpuInfo = await app.getGPUInfo("complete");
      report.gpuFeatures = app.getGPUFeatureStatus();
      report.gpuSwitches = Object.fromEntries(["disable-gpu", "disable-software-rasterizer", "in-process-gpu", "use-gl", "use-angle", "ozone-platform"].map((name) =>
        [name, { present: app.commandLine.hasSwitch(name), value: app.commandLine.getSwitchValue(name) }]));
      record("gpu-after-window-paint", { features: report.gpuFeatures, info: report.gpuInfo, switches: report.gpuSwitches });
      const mediaURL = require("node:url").pathToFileURL(process.env.EMS_NATIVE_CAPTURE_MEDIA).href;

      for (let index = 0; index < cycles + abrupt; index++) {
        const isAbrupt = index >= cycles;
        current = { cycle: index + 1, abrupt: isAbrupt, phase: "create", results: [] };
        report.cycles.push(current);
        record("cycle-start", current);
        sink.setAlwaysOnTop(false);
        sink.setBounds({ x: origin.x + 660, y: origin.y, width: 640, height: 360 });
        target = new BrowserWindow({ ...origin, width: 640, height: 360, frame: false, title: "EMS capture target", webPreferences: preferences });
        await target.loadFile(targetHTML);
        current.identity = await sourceIdentity(target);
        record("source-identity", { cycle: current.cycle, ...current.identity });
        if (desktopWindow) assert.ok(current.identity.nonzeroWindowId, "getMediaSourceId has no nonzero desktop window ID; refuse portal/picker fallback");
        selected = { target, sourceId: current.identity.sourceId };
        if (isAbrupt) await evaluate(target, (url) => window.startMP4(url), mediaURL);
        current.phase = userMedia ? "getUserMedia" : "getDisplayMedia";
        record("acquire-start", { cycle: current.cycle, api: current.phase, sourceId: selected.sourceId,
          executeJavaScriptUserGesture: !userMedia, mp4AlreadyPlaying: isAbrupt });
        current.acquisition = await evaluate(sink, (sourceId, backend) => window.acquire(sourceId, backend), selected.sourceId, backend);
        record("acquired", { cycle: current.cycle, ...current.acquisition });
        assert.equal(current.acquisition.audioTracks, 0);
        if (userMedia) {
          assert.deepEqual(current.acquisition.userActivation, { isActive: false, hasBeenActive: false }, "No user gesture may precede automatic getUserMedia capture");
          assert.equal(report.requests.length, 0, "getUserMedia must never enter getDisplayMedia/picker routing");
        } else assert.equal(report.requests.at(-1).userGesture, true, "executeJavaScript(..., true) must supply the user gesture");
        // Desktop source should report window, tab/frame capture should report browser.
        current.displaySurface = current.acquisition.settings.displaySurface || null;
        // Electron 40 getUserMedia omits displaySurface (and labels the track
        // "Screen"); exact deviceId plus decoded target markers prove identity.
        if (!userMedia || current.displaySurface !== null) {
          assert.equal(current.displaySurface, desktopWindow ? "window" : "browser", "Native source type must not silently change");
        }
        if (desktopWindow) assert.equal(current.acquisition.settings.deviceId, selected.sourceId, "Native sink must select the exact fixed desktop window ID");
        if (isAbrupt) {
          await measure("active-mp4-before-abrupt-destroy", 0, true);
          current.phase = "abrupt-destroy-active-stream";
          record("abrupt-destroy-start", { cycle: current.cycle, state: await evaluate(sink, () => window.sinkState()) });
          selected = null;
          target.destroy();
          target = null;
          await until(async () => (await evaluate(sink, () => window.sinkState())).tracks.every((track) => track.readyState === "ended"), "track ended after abrupt source destruction", 2000);
          current.afterDestroy = await evaluate(sink, () => window.sinkState());
          record("abrupt-destroy-ended", { cycle: current.cycle, state: current.afterDestroy });
          current.stopped = await stop();
          report.abruptPassed++;
        } else {
          await measure("animated-canvas", 0, false);
          await evaluate(target, (url) => window.startMP4(url), mediaURL);
          await measure("local-mp4-and-canvas", 0, true);
          target.setContentSize(800, 450);
          await evaluate(target, () => window.setRevision(1));
          // Deliberate coverage by the sink, without minimizing/hiding the source.
          sink.setBounds({ ...target.getBounds(), width: 820, height: 480 });
          sink.setAlwaysOnTop(true);
          sink.moveTop();
          current.occlusion = { requested: true, sinkAlwaysOnTop: sink.isAlwaysOnTop(),
            verified: false, limitation: "Wayland/global compositor coverage is not observable here; z-order/coverage requested, not proven" };
          await until(async () => (await evaluate(target, () => window.targetState())).width !== 640, "real target resize");
          await measure("resized-content-changed-occluded-mp4", 1, true);
          current.phase = "safe-stop-before-destroy";
          current.stopped = await stop();
          assert.ok(!target.isDestroyed(), "Target must still exist when tracks are stopped");
          selected = null;
          record("safe-destroy-start", { cycle: current.cycle, stopped: current.stopped });
          target.destroy();
          target = null;
          report.safePassed++;
        }
        assert.equal(report.nativeErrors.length, 0, "A renderer/GPU/utility process terminated unexpectedly");
        record("cycle-pass", { cycle: current.cycle, abrupt: isAbrupt, safePassed: report.safePassed, abruptPassed: report.abruptPassed });
      }
      assert.equal(report.safePassed, cycles);
      assert.equal(report.abruptPassed, abrupt);
      if (userMedia) assert.equal(report.requests.length, 0, "No getDisplayMedia requests/picker during the entire startup capture stress test");
      report.gpuInfo = await app.getGPUInfo("complete");
      report.gpuFeatures = app.getGPUFeatureStatus();
      record("gpu-after-capture-stress", { features: report.gpuFeatures, info: report.gpuInfo });
      await finish(0);
    } catch (error) { await finish(1, error); }
  }).catch((error) => { void finish(1, error); });
}

if (process.versions.electron) electronMain();
else supervise().catch((error) => { emit("fatal-supervisor-error", errorInfo(error)); process.exitCode = 1; });