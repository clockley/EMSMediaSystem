import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { createSerializedAsyncQueue } from "../src/shared/async-operation-ownership.mjs";
import { getPptxContainLayout } from "../src/shared/app-pptx-utils.mjs";

const source = await readFile(new URL("../src/media-window/media.mjs", import.meta.url), "utf8");

function fn(name) {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^}`, "m"));
  assert.ok(match, `${name} must be extracted from the audience source`);
  return match[0];
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class Element {
  nodeType = 1;
  style = {};
  dataset = {};
  children = [];
  parentNode = null;
  queries = 0;
  get clientWidth() { return this.parentNode?.clientWidth ?? 1920; }
  get clientHeight() { return this.parentNode?.clientHeight ?? 1080; }
  get firstElementChild() { return this.children[0] ?? null; }
  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = children;
    for (const child of children) child.parentNode = this;
  }
  remove() {
    if (this.parentNode) {
      const parent = this.parentNode;
      parent.children = parent.children.filter((child) => child !== this);
      this.parentNode = null;
    }
  }
  querySelectorAll() { this.queries += 1; return []; }
}

function harness() {
  const canvas = new Element();
  const fonts = deferred();
  const frames = [];
  const hooks = {};
  const calls = [];
  const paints = [];
  const sends = [];
  const transitions = [];
  const viewers = [];
  const handlers = new Map();
  const listeners = new Map();
  class Viewer {
    slideCount = 8;
    slideWidth = 1280;
    slideHeight = 720;
    active = 0;
    maxActive = 0;
    destroyed = 0;
    constructor(host, options) {
      this.host = host;
      this.options = options;
      viewers.push(this);
    }
    paint(index) {
      this.index = index;
      const wrapper = new Element();
      wrapper.replaceChildren(new Element());
      this.host.replaceChildren(wrapper);
      this.host.painted = index;
      paints.push({ viewer: this, index, attached: this.host.parentNode === canvas });
    }
    async operation(phase, index, paint = true) {
      calls.push({ viewer: this, phase, index });
      this.active += 1;
      this.maxActive = Math.max(this.maxActive, this.active);
      try {
        await hooks[phase]?.(this, index);
        if (paint) this.paint(index);
      } finally {
        this.active -= 1;
      }
    }
    async open(buffer, options) {
      this.file = buffer.file;
      this.openOptions = options;
      await this.operation("open", 0);
    }
    async renderSlide(index) { await this.operation("render", index); }
    async setFitMode(mode) {
      assert.equal(mode, "none");
      await this.operation("fit", this.index);
    }
    async setZoom(zoom) {
      assert.equal(zoom, 100);
      await this.operation("zoom", this.index);
    }
    destroy() {
      this.destroyed += 1;
      this.host.replaceChildren();
    }
  }
  const context = vm.createContext({
    createSerializedAsyncQueue, getPptxContainLayout, AbortController,
    HTMLElement: Element,
    window: {
      _pptxMediaViewer: null,
      addEventListener(name, callback) {
        const callbacks = listeners.get(name) ?? [];
        callbacks.push(callback);
        listeners.set(name, callbacks);
      },
    },
    document: {
      getElementById: (id) => id === "pptxCanvas" ? canvas : null,
      createElement: () => new Element(),
      fonts: { ready: fonts.promise },
      body: { classList: { add() {} } },
    },
    requestAnimationFrame: (callback) => frames.push(callback),
    ipcRenderer: {
      on(name, callback) { handlers.set(name, callback); },
      async invoke(channel, file) {
        assert.equal(channel, "read-file-as-arraybuffer");
        calls.push({ phase: "read", file });
        return await hooks.read?.(file) ?? { file };
      },
      send: (channel, payload) => sends.push({ channel, payload }),
    },
    importPptxRenderer: async () => {
      await hooks.import?.();
      return { PptxViewer: Viewer, RECOMMENDED_ZIP_LIMITS: { maxEntries: 1000 } };
    },
    mediaFile: "/deck-a.pptx", audiencePlaybackId: "play-a", audienceSessionId: "session-a",
    videoSourceGeneration: 7, slipstreamActivationGeneration: 0,
    slipstreamActivationQueue: createSerializedAsyncQueue(),
    pptxIpcHandlersInstalled: false, pptxMediaGeneration: 0, pptxMediaLoad: null,
    pptxCurrentSlide: 0, pptxStartSlide: 0,
    isPptx: true, isText: false, isImg: false, isLowerThirdOutput: false,
    logoHoldOnly: false, streamActsAsLiveEdge: false, liveStreamMode: false,
    projectionVideoSource: "", video: { pause() {}, removeAttribute() {}, load() {}, addEventListener() {} },
    argv: [], disableContentTransitions: false, waitForDomReady: async () => {},
    SLIPSTREAM_TARGET_TEXT: "text", SLIPSTREAM_TARGET_PPTX: "pptx",
    SLIPSTREAM_TARGET_IMAGE: "image", SLIPSTREAM_TARGET_VIDEO: "video",
    getPptxPdfjsConfig: () => ({ workerSrc: "worker" }),
    getPptxListRenderOptions: () => ({ windowed: true }),
    installICPHandlers() {}, teardownStreamingPlayers() {}, hideStreamStatus() {},
    teardownTextPresentation() {}, teardownImageElement() {},
    setProjectionVideoVisible() {}, setLoopEnabled() {}, tracePlayback() {},
    reapplyOutputHoldIfActive() {}, activateTextTarget() {},
    applySlideTransition: (element, transition) => transitions.push({ element, transition }),
  });
  context.window.api = { video: context.video };
  const names = [
    "ensurePptxProcessEnv", "ownsPptxMediaLoad", "disposePptxMediaLoad", "teardownPptxViewer",
    "activatePptxTarget", "loadPptxInMediaWindow", "showPptxSlideInMediaWindow",
    "applyPptxTextInkGuard", "schedulePptxTextInkGuard", "fitPptxSlidesToMediaCanvas",
    "applyPptxContainPolicyMedia", "installPptxIpcHandlers", "publishStageLocalMedia",
    "resolveSlipstreamTargetType", "applySlipstream", "applySlipstreamActivation",
    "setProjectionVideoSource", "teardownVideoElement", "loadMedia", "bootstrapMediaWindow",
  ];
  // Only replace the module import boundary; all async control flow, ownership,
  // DOM fitting, publication and startup/slipstream wiring execute real source.
  const code = names.map(fn).join("\n");
  const moduleImport = /import\("\.\.\/\.\.\/\.\.\/node_modules\/@aiden0z\/pptx-renderer\/dist\/aiden0z-pptx-renderer\.browser\.es\.js"\)/g;
  assert.equal([...code.matchAll(moduleImport)].length, 1, "setup must share a single loader");
  vm.runInContext(code.replace(moduleImport, "importPptxRenderer()"), context);
  const publications = () => sends.filter(({ channel, payload }) =>
    channel === "stage-local-media" && payload.kind === "pptx").map(({ payload }) => payload);
  const phases = (viewer) => calls.filter((call) => call.viewer === viewer).map(({ phase, index }) => `${phase}:${index}`);
  const resize = () => listeners.get("resize")?.forEach((callback) => callback());
  const drain = () => context.pptxMediaLoad.queue.run(() => {});
  const changeSource = (file = "/deck-b.pptx", playbackId = "play-b") => {
    context.mediaFile = file;
    context.audiencePlaybackId = playbackId;
    context.videoSourceGeneration += 1;
  };
  return {
    context, canvas, fonts, frames, hooks, calls, paints, sends, transitions,
    viewers, handlers, listeners, publications, phases, resize, drain, changeSource,
    load: (...args) => context.loadPptxInMediaWindow(...args),
    show: (...args) => context.showPptxSlideInMediaWindow(...args),
    async ready() {
      assert.equal(await context.loadPptxInMediaWindow(), true);
      sends.length = 0; calls.length = 0; paints.length = 0; transitions.length = 0;
      return viewers.at(-1);
    },
  };
}

function hold(h, phase, predicate = () => true) {
  const started = deferred();
  const gate = deferred();
  h.hooks[phase] = async (viewer, index) => {
    if (!predicate(viewer, index)) return;
    started.resolve();
    await gate.promise;
  };
  return { started: started.promise, resolve: gate.resolve, reject: gate.reject };
}

test("rapid slides serialize actual paints, skip queued obsolete slides and publish only the latest", async () => {
  const h = harness();
  const viewer = await h.ready();
  const gate = hold(h, "render", (_viewer, index) => index === 1);
  const first = h.show(1, { effect: "fade" });
  await gate.started;
  const middle = h.show(2);
  const latestTransition = { effect: "zoom" };
  const latest = h.show(3, latestTransition);
  assert.equal(h.context.pptxCurrentSlide, 0, "pending renders do not commit globals");
  assert.deepEqual(h.phases(viewer), ["render:1"]);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, middle, latest]), [false, false, true]);
  assert.deepEqual(h.phases(viewer), ["render:1", "render:3", "fit:3", "zoom:3"]);
  assert.equal(viewer.maxActive, 1, "render and contain never overlap on a viewer");
  assert.equal(h.canvas.children[0].painted, 3);
  assert.equal(h.context.pptxCurrentSlide, 3);
  assert.deepEqual(h.publications().map((payload) => ({ ...payload })), [{
    kind: "pptx", url: "/deck-a.pptx", slideIndex: 3,
    playbackId: "play-a", audienceSessionId: "session-a", sourceGeneration: 7,
  }]);
  assert.deepEqual(h.transitions, [{ element: h.canvas, transition: latestTransition }]);
  assert.equal(viewer.host.firstElementChild.firstElementChild.style.transform, "scale(1.5)");
});

test("resize queues behind a pending slide and uses the requested rather than committed index", async () => {
  const h = harness();
  const viewer = await h.ready();
  const gate = hold(h, "render", (_viewer, index) => index === 4);
  const pending = h.show(4);
  await gate.started;
  h.resize();
  const resized = h.drain();
  assert.deepEqual(h.phases(viewer), ["render:4"]);
  gate.resolve();
  assert.equal(await pending, false);
  await resized;
  assert.deepEqual(h.phases(viewer), ["render:4", "render:4", "fit:4", "zoom:4"]);
  assert.equal(viewer.maxActive, 1);
  assert.equal(h.canvas.children[0].painted, 4);
  assert.deepEqual(h.publications().map((payload) => payload.slideIndex), [4]);
});

for (const phase of ["fit", "zoom"]) {
  test(`a newer slide during ${phase} cannot be painted over by old contain work`, async () => {
    const h = harness();
    const viewer = await h.ready();
    const gate = hold(h, phase, (_viewer, index) => index === 1);
    const old = h.show(1);
    await gate.started;
    const latest = h.show(5);
    const before = h.phases(viewer).slice();
    assert.equal(before.at(-1), `${phase}:1`);
    gate.resolve();
    assert.equal(await old, false);
    assert.equal(await latest, true);
    assert.equal(h.canvas.children[0].painted, 5);
    assert.equal(viewer.maxActive, 1);
    assert.deepEqual(h.publications().map((payload) => payload.slideIndex), [5]);
    assert.equal(h.transitions.length, 1);
    if (phase === "fit") assert.ok(!h.phases(viewer).includes("zoom:1"));
  });
}

for (const phase of ["render", "fit", "zoom"]) {
  test(`a replacement deck completes while old ${phase} is pending; late painting stays detached`, async () => {
    const h = harness();
    const oldViewer = await h.ready();
    const gate = hold(h, phase, (viewer) => viewer === oldViewer);
    const old = h.show(1);
    await gate.started;
    const oldHost = oldViewer.host;
    const paintsBeforeReplacement = h.paints.length;
    h.changeSource();
    assert.equal(await h.load(6), true, "different viewers must not share a blocking queue");
    const replacement = h.viewers.at(-1);
    assert.equal(oldHost.parentNode, null);
    assert.equal(h.context.window._pptxMediaViewer, replacement);
    gate.resolve();
    assert.equal(await old, false);
    assert.equal(h.canvas.children[0], replacement.host);
    assert.equal(replacement.host.painted, 6);
    assert.equal(h.context.pptxCurrentSlide, 6);
    const latePaints = h.paints.slice(paintsBeforeReplacement).filter(({ viewer }) => viewer === oldViewer);
    assert.ok(latePaints.length > 0, "the obsolete renderer really does finish painting");
    assert.ok(latePaints.every(({ attached }) => !attached));
    assert.deepEqual(h.publications().map((payload) => [payload.url, payload.playbackId, payload.slideIndex]), [
      ["/deck-b.pptx", "play-b", 6],
    ]);
  });
}

for (const phase of ["render", "fit", "zoom"]) {
  test(`a non-PPTX slipstream invalidates old ${phase} before the replacement activation runs`, async () => {
    const h = harness();
    const viewer = await h.ready();
    const gate = hold(h, phase);
    const old = h.show(2);
    await gate.started;
    const next = h.context.applySlipstream({ isText: true, mediaFile: "", playbackId: "text-play" });
    assert.equal(viewer.host.parentNode, null, "invalidate synchronously at request submission");
    assert.equal(h.context.window._pptxMediaViewer, null);
    await next;
    gate.resolve();
    assert.equal(await old, false);
    assert.equal(h.context.isPptx, false);
    assert.equal(h.context.pptxCurrentSlide, 0);
    assert.deepEqual(h.publications(), []);
  });
}

for (const [label, invalidate] of [
  ["file", (h) => { h.context.mediaFile = "/different.pptx"; }],
  ["playback", (h) => { h.context.audiencePlaybackId = "other-play"; }],
  ["source generation", (h) => { h.context.videoSourceGeneration += 1; }],
  ["activation generation", (h) => { h.context.slipstreamActivationGeneration += 1; }],
  ["viewer", (h) => { h.context.window._pptxMediaViewer = {}; }],
  ["content type", (h) => { h.context.isPptx = false; }],
  ["load generation", (h) => { h.context.pptxMediaGeneration += 1; }],
]) {
  test(`ownership rechecks ${label} after render, before contain or publication`, async () => {
    const h = harness();
    const viewer = await h.ready();
    const gate = hold(h, "render");
    const old = h.show(1);
    await gate.started;
    invalidate(h);
    gate.resolve();
    assert.equal(await old, false);
    assert.equal(h.context.pptxCurrentSlide, 0);
    assert.deepEqual(h.phases(viewer), ["render:1"]);
    assert.deepEqual(h.publications(), []);
    assert.deepEqual(h.transitions, []);
  });
}

test("supersession during import does not read the old file or open an obsolete viewer", async () => {
  const h = harness();
  const gate = hold(h, "import");
  const old = h.load(1);
  await gate.started;
  delete h.hooks.import;
  h.changeSource();
  assert.equal(await h.load(3), true);
  gate.resolve();
  assert.equal(await old, false);
  assert.deepEqual(h.calls.filter(({ phase }) => phase === "read").map(({ file }) => file), ["/deck-b.pptx"]);
  assert.equal(h.viewers.length, 1);
  assert.equal(h.context.window._pptxMediaViewer, h.viewers[0]);
});

test("file reads use the captured path and an obsolete read cannot construct a viewer", async () => {
  const h = harness();
  const started = deferred();
  const gate = deferred();
  h.hooks.read = async (file) => {
    if (file !== "/deck-a.pptx") return { file };
    started.resolve();
    return gate.promise;
  };
  const old = h.load(1);
  await started.promise;
  h.changeSource();
  assert.equal(await h.load(3), true);
  gate.resolve({ file: "/deck-a.pptx" });
  assert.equal(await old, false);
  assert.equal(h.viewers.length, 1);
  assert.equal(h.viewers[0].file, "/deck-b.pptx");
  assert.deepEqual(h.publications().map((payload) => payload.url), ["/deck-b.pptx"]);
});

for (const reject of [false, true]) {
  test(`a superseded same-file open ${reject ? "rejection" : "completion"} cannot clear or replace the new viewer`, async () => {
    const h = harness();
    const gate = hold(h, "open", (viewer) => viewer === h.viewers[0]);
    const old = h.load(1);
    await gate.started;
    const oldViewer = h.viewers[0];
    assert.equal(await h.load(5), true, "new load generation invalidates even identical file/playback");
    const replacement = h.viewers[1];
    assert.equal(oldViewer.openOptions.signal.aborted, true);
    if (reject) gate.reject(new Error("obsolete open failed"));
    else gate.resolve();
    assert.equal(await old, false);
    assert.ok(oldViewer.destroyed >= 1);
    assert.equal(oldViewer.host.parentNode, null);
    assert.equal(replacement.destroyed, 0);
    assert.equal(h.context.window._pptxMediaViewer, replacement);
    assert.equal(h.canvas.children[0], replacement.host);
    assert.equal(h.context.pptxCurrentSlide, 5);
    assert.deepEqual(h.publications().map((payload) => payload.slideIndex), [5]);
  });
}

test("navigation while open is pending supersedes the configured initial slide", async () => {
  const h = harness();
  const gate = hold(h, "open");
  const pending = h.load(1);
  await gate.started;
  const transition = { effect: "fade" };
  h.handlers.get("pptx-goto-slide")(null, { slideIndex: 6, playbackId: "play-a", filePath: "/deck-a.pptx", transition });
  h.handlers.get("pptx-goto-slide")(null, { slideIndex: 2, playbackId: "wrong" });
  h.handlers.get("pptx-goto-slide")(null, { slideIndex: 3, filePath: "/wrong.pptx" });
  h.resize();
  gate.resolve();
  assert.equal(await pending, true);
  assert.deepEqual(h.phases(h.viewers[0]), ["open:0", "render:6", "fit:6", "zoom:6"]);
  assert.equal(h.context.pptxCurrentSlide, 6);
  assert.equal(h.transitions[0].transition, transition);
  assert.deepEqual(h.publications().map((payload) => payload.slideIndex), [6]);
});

test("a queued non-PPTX take invalidates an in-flight PPTX activation without stale publication", async () => {
  const h = harness();
  const gate = hold(h, "open");
  const old = h.context.applySlipstream({ isPptx: true, mediaFile: "/old.pptx", playbackId: "old", pptxStartSlide: 1 });
  await gate.started;
  const viewer = h.viewers[0];
  const next = h.context.applySlipstream({ isText: true, mediaFile: "", playbackId: "new" });
  assert.equal(viewer.host.parentNode, null);
  assert.equal(viewer.openOptions.signal.aborted, true);
  gate.resolve();
  await Promise.all([old, next]);
  assert.equal(h.context.audiencePlaybackId, "new");
  assert.equal(h.context.isPptx, false);
  assert.equal(h.context.window._pptxMediaViewer, null);
  assert.deepEqual(h.publications(), []);
});

for (const phase of ["import", "read", "open", "render", "fit", "zoom"]) {
  test(`an active ${phase} failure cleans up initialization and permits a fresh load`, async () => {
    const h = harness();
    h.hooks[phase] = async () => { throw new Error(`${phase} failed`); };
    await assert.rejects(h.load(1), new RegExp(`${phase} failed`));
    assert.equal(h.context.window._pptxMediaViewer, null);
    assert.equal(h.context.pptxMediaLoad, null);
    assert.equal(h.canvas.children.length, 0);
    assert.equal(h.canvas.style.display, "none");
    assert.ok(h.viewers.every((viewer) => viewer.destroyed >= 1));
    assert.deepEqual(h.publications(), []);
    delete h.hooks[phase];
    assert.equal(await h.load(4), true);
    assert.equal(h.context.pptxCurrentSlide, 4);
    assert.deepEqual(h.publications().map((payload) => payload.slideIndex), [4]);
  });
}

for (const phase of ["render", "fit", "zoom"]) {
  test(`a slide ${phase} rejection does not publish an unpainted slide or poison the render queue`, async () => {
    const h = harness();
    const viewer = await h.ready();
    const gate = hold(h, phase, (_viewer, index) => index === 1);
    const pending = h.show(1);
    await gate.started;
    gate.reject(new Error(`${phase} failed`));
    await assert.rejects(pending, new RegExp(`${phase} failed`));
    assert.equal(h.context.pptxCurrentSlide, 0);
    assert.deepEqual(h.publications(), []);
    assert.deepEqual(h.transitions, []);
    assert.equal(await h.show(2), true);
    assert.equal(h.context.window._pptxMediaViewer, viewer);
    assert.equal(h.context.pptxCurrentSlide, 2);
    assert.deepEqual(h.publications().map((payload) => payload.slideIndex), [2]);
  });
}

test("a stale render rejection allows an already queued newer slide to finish", async () => {
  const h = harness();
  await h.ready();
  const gate = hold(h, "render", (_viewer, index) => index === 1);
  const old = h.show(1);
  await gate.started;
  const latest = h.show(2);
  gate.reject(new Error("old slide failed"));
  assert.equal(await old, false);
  assert.equal(await latest, true);
  assert.deepEqual(h.publications().map((payload) => payload.slideIndex), [2]);
});

test("deferred font/layout ink guards cannot mutate a superseded deck", async () => {
  const h = harness();
  const viewer = await h.ready();
  const oldHost = viewer.host;
  h.changeSource();
  await h.load(2);
  const before = oldHost.queries;
  h.fonts.resolve();
  await h.fonts.promise;
  while (h.frames.length) h.frames.shift()();
  assert.equal(oldHost.queries, before);
  assert.ok(h.canvas.children[0].queries > 0);
});

test("startup and PPTX slipstream share guarded setup and one resize listener", async () => {
  const h = harness();
  h.context.pptxStartSlide = 2;
  await h.context.loadMedia();
  assert.equal(h.context.pptxCurrentSlide, 2);
  assert.equal(h.listeners.get("resize").length, 1);
  const initial = h.viewers[0];
  await h.context.applySlipstream({ isPptx: true, mediaFile: "/deck-b.pptx", playbackId: "play-b", pptxStartSlide: 5 });
  assert.ok(initial.destroyed >= 1);
  assert.equal(h.context.pptxCurrentSlide, 5);
  assert.equal(h.listeners.get("resize").length, 1);
  h.resize();
  await h.drain();
  assert.equal(h.canvas.children[0].painted, 5);
  assert.equal(h.viewers[1].maxActive, 1);

  const fromText = harness();
  fromText.context.isPptx = false;
  fromText.context.isText = true;
  await fromText.context.applySlipstream({ isPptx: true, mediaFile: "/first.pptx", playbackId: "first", pptxStartSlide: 3 });
  assert.equal(fromText.listeners.get("resize").length, 1, "also bind when startup was not PPTX");
  fromText.resize();
  await fromText.drain();
  assert.equal(fromText.canvas.children[0].painted, 3);
});

test("non-PPTX initial loading invalidates an open before it can commit", async () => {
  const h = harness();
  const gate = hold(h, "open");
  const pending = h.load(1);
  await gate.started;
  const viewer = h.viewers[0];
  h.context.logoHoldOnly = true;
  h.context.isPptx = false;
  await h.context.loadMedia();
  assert.equal(viewer.host.parentNode, null);
  gate.resolve();
  assert.equal(await pending, false);
  assert.equal(h.context.window._pptxMediaViewer, null);
  assert.deepEqual(h.publications(), []);
});

test("an obsolete startup PPTX cannot acknowledge a new non-PPTX playback as ready", async () => {
  const h = harness();
  const gate = hold(h, "open");
  const startup = h.context.bootstrapMediaWindow();
  await gate.started;
  await h.context.applySlipstream({ isText: true, mediaFile: "", playbackId: "replacement" });
  gate.resolve();
  await startup;
  assert.deepEqual(h.sends.filter(({ channel }) => channel === "audience-output-ready"), []);
  assert.equal(h.context.audiencePlaybackId, "replacement");
});

test("startup acknowledges a successfully rendered PPTX, but not a superseded same-identity load", async () => {
  const h = harness();
  await h.context.bootstrapMediaWindow();
  assert.deepEqual(h.sends.filter(({ channel }) => channel === "audience-output-ready").map(({ payload }) => payload.playbackId), ["play-a"]);

  const cancelled = harness();
  const gate = hold(cancelled, "open", (viewer) => viewer === cancelled.viewers[0]);
  const startup = cancelled.context.bootstrapMediaWindow();
  await gate.started;
  assert.equal(await cancelled.load(4), true);
  gate.resolve();
  await startup;
  assert.deepEqual(cancelled.sends.filter(({ channel }) => channel === "audience-output-ready"), []);
  assert.equal(cancelled.context.pptxCurrentSlide, 4);
});

test("invalid navigation is ignored and out-of-range slides publish the actual clamped index", async () => {
  const h = harness();
  const viewer = await h.ready();
  for (const index of [-1, 1.5, NaN, Infinity, "2"]) assert.equal(await h.show(index), false);
  assert.deepEqual(h.phases(viewer), []);
  assert.equal(await h.show(99), true);
  assert.equal(h.context.pptxCurrentSlide, 7);
  assert.deepEqual(h.publications().map((payload) => payload.slideIndex), [7]);
});