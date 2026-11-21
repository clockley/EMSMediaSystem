import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { applyOutputCommand, createCompositorState, createOutputCommand, outputAcknowledgement } from "../src/shared/output-compositor.mjs";

const source = await readFile(new URL("../src/stage-window/stage.mjs", import.meta.url), "utf8");
async function settle() { await new Promise(setImmediate); await new Promise(setImmediate); }
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function makeSlide() {
  const result = { disposals: 0, classes: [] };
  result.element = { classList: { add(value) { result.classes.push(value); } } };
  result.dispose = () => { result.disposals++; };
  return result;
}

function harness({ snapshot = { revision: 0, media: null, playback: null },
  getNextPptx = async () => new ArrayBuffer(8), renderPptx = async () => makeSlide() } = {}) {
  const elements = new Map(), callbacks = {}, intervals = new Map(), removed = [];
  const acknowledgements = [], sourceWrites = [], deckRequests = [], renders = [], warnings = [];
  const native = { viewports: [], renders: [], clears: 0, disposals: 0,
    render(presentation) { this.renders.push(presentation); },
    clear() { this.clears++; },
    dispose() { this.disposals++; },
  };
  const sync = { sources: [], playback: [], clears: 0, disposals: 0,
    setSource(media) {
      const previous = this.sources.at(-1);
      this.sources.push(media);
      return previous !== media;
    },
    receive(playback) { this.playback.push(playback); },
    clear() { this.clears++; },
    dispose() { this.disposals++; },
  };
  const element = (key) => {
    if (!elements.has(key)) {
      const attributes = new Map();
      elements.set(key, { dataset: {}, hidden: true, textContent: "", innerHTML: "", clientWidth: 500,
        get src() { return attributes.get("src") || ""; },
        set src(value) { sourceWrites.push([key, value]); attributes.set("src", value); },
        getAttribute(name) { return attributes.get(name) ?? null; },
        removeAttribute(name) { attributes.delete(name); },
      });
    }
    return elements.get(key);
  };
  let id = 0, revision = 0, ready = 0;
  const api = {
    sessionId: "stage", getLocalMedia: () => snapshot,
    getNextPptx(deckKey) { deckRequests.push(deckKey); return getNextPptx(deckKey); },
    acknowledge(value) { acknowledgements.push(value); }, ready() { ready++; },
  };
  for (const [method, key] of [["onCommand", "command"], ["onLocalMedia", "media"], ["onLocalPlayback", "playback"]]) {
    api[method] = (callback) => { callbacks[key] = callback; return () => removed.push(key); };
  }
  const context = vm.createContext({
    createCompositorState, applyOutputCommand, outputAcknowledgement, Date, Intl, URL,
    console: { warn: (...args) => warnings.push(args) },
    setInterval(callback) { const key = ++id; intervals.set(key, callback); return key; },
    clearInterval(key) { intervals.delete(key); },
    resolveAlertTokens: (value) => value || "",
    document: { getElementById: element },
    window: { stageOutput: api, addEventListener(event, callback) { callbacks[event] = callback; } },
    createStageVideoSync({ video }) { assert.equal(video, element("stageAudiencePreview")); return sync; },
    createNativeSlideRenderer({ viewport }) {
      assert.equal(viewport, element("stageCurrentNative"));
      native.viewports.push(viewport);
      return native;
    },
    ensurePptxProcessEnv() {}, pptxRenderer: {},
    renderPptxSlideThumbnail(options) { renders.push(options); return renderPptx(options); },
  });
  // Execute the real renderer, replacing only imports and the browser-only PPTX module loader.
  const loader = /^function loadPptxRendererModule\(\) \{[\s\S]*?^\}/m;
  assert.match(source, loader);
  vm.runInContext(source
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";\n/gm, "")
    .replace(loader, "function loadPptxRendererModule() { return Promise.resolve(pptxRenderer); }"), context);
  const command = (layer, payload) => {
    callbacks.command(createOutputCommand({
      commandId: `command-${++revision}`, sessionId: "stage", targetRole: "stage", revision, layer, payload,
    }));
    assert.equal(acknowledgements.at(-1)?.applied, true, JSON.stringify(acknowledgements.at(-1)));
  };
  return { element, callbacks, intervals, removed, sync, native, sourceWrites, deckRequests, renders, warnings,
    acknowledgements, command, content: (payload) => command("content", payload), ready: () => ready };
}

const video = (overrides = {}) => ({ kind: "video", url: "file:///clip.mp4", playbackId: "clip",
  audienceSessionId: "audience", sourceGeneration: 1, ...overrides });
const playback = (overrides = {}) => ({ playbackId: "clip", audienceSessionId: "audience",
  sourceGeneration: 1, currentTime: 12, paused: false, ...overrides });
const pptx = (overrides = {}) => ({ kind: "pptx", deckKey: "deck-a", slideIndex: 2, ...overrides });
const nativeSlide = (overrides = {}) => ({ kind: "native", presentation: {
  contentKind: "song", slideId: "verse-1", text: "Amazing grace", fontFamily: "CMG Sans",
  blocks: [{ type: "lyricLine", primary: { segments: [{ text: "Amazing", style: {
    color: "#ffcc00", fontWeight: "700", fontStyle: "italic", textDecoration: "underline",
  } }, { text: " grace" }] } }],
  backgroundVideo: "file:///backdrop.mp4", backgroundVideoSync: { currentTime: 9, paused: false },
  outputSize: { width: 1920, height: 1080 }, ...overrides,
} });

test("stage boots a cached native slide through the injected factory without a DOM ownerDocument", async () => {
  const media = nativeSlide(), h = harness({ snapshot: { revision: 4, media, playback: null } });
  await settle();
  assert.equal(h.ready(), 1);
  assert.deepEqual(h.native.viewports, [h.element("stageCurrentNative")]);
  assert.equal(h.element("stageCurrentNative").ownerDocument, undefined);
  assert.deepEqual(h.native.renders, [media.presentation]);
  assert.equal(h.native.renders[0], media.presentation, "pass the resolved AST directly to the renderer");
  for (const id of ["stageCurrentNative", "stageCurrentMedia"]) assert.equal(h.element(id).hidden, false);
  for (const id of ["stageAudiencePreview", "stageCurrentImage", "stageCurrentPptx"]) assert.equal(h.element(id).hidden, true);
  assert.equal(h.element("stageRoot").dataset.currentMedia, "native");
  assert.equal(h.element("stageRoot").dataset.audiencePreview, "live");
  assert.deepEqual(h.sync.sources, []);
  assert.deepEqual(h.sourceWrites, []);
  assert.deepEqual(h.deckRequests, []);
});

test("native slide updates pass formatted AST intact and preserve Next, notes and widgets", async () => {
  const h = harness(); await settle();
  h.content({ current: "Verse", next: "Chorus", notes: "Repeat twice", serviceItem: "Hymn", sectionLabel: "Verse 1" });
  h.command("widgets", { countdown: "02:00" });
  const first = nativeSlide(), second = nativeSlide({ slideId: "verse-2", text: "Second verse" });
  h.callbacks.media({ revision: 1, media: first });
  h.callbacks.media({ revision: 2, media: second });
  assert.deepEqual(h.native.renders, [first.presentation, second.presentation]);
  assert.equal(h.native.renders[1], second.presentation);
  assert.equal(h.native.renders[1].blocks, second.presentation.blocks);
  for (const [id, text] of [["stageCurrent", "Verse"], ["stageNext", "Chorus"], ["stageNotes", "Repeat twice"],
    ["stageServiceItem", "Hymn"], ["stageSectionLabel", "Verse 1"], ["stageCountdown", "02:00"]]) {
    assert.equal(h.element(id).textContent, text);
  }
  assert.equal(h.native.clears, 0);
});

test("clock profile clears native backgrounds and resumes the latest native slide", async () => {
  const first = nativeSlide(), h = harness({ snapshot: { revision: 1, media: first } });
  await settle();
  h.content({ profile: "clock" });
  assert.equal(h.native.clears, 1, "clear owns native background video teardown");
  assert.equal(h.element("stageCurrentNative").hidden, true);
  assert.equal(h.element("stageCurrentMedia").hidden, true);
  assert.equal(h.element("stageRoot").dataset.audiencePreview, "off");
  const latest = nativeSlide({ slideId: "latest" });
  h.callbacks.media({ revision: 2, media: latest });
  assert.deepEqual(h.native.renders, [first.presentation]);
  assert.equal(h.native.clears, 1);
  h.content({ profile: "current-next" });
  assert.deepEqual(h.native.renders, [first.presentation, latest.presentation]);
  assert.equal(h.element("stageCurrentNative").hidden, false);
  assert.deepEqual(h.sync.sources, []);
});

for (const kind of ["video", "image", "text", "audio"]) {
  test(`native to ${kind} clears native videos and video to native clears the audience follower`, async () => {
    const h = harness(); await settle();
    h.callbacks.media({ revision: 1, media: video(), playback: playback() });
    h.callbacks.media({ revision: 2, media: nativeSlide() });
    assert.equal(h.sync.clears, 1);
    assert.equal(h.element("stageAudiencePreview").hidden, true);
    const replacement = { kind, url: kind === "video" ? "file:///new.mp4" : "file:///photo.png" };
    h.callbacks.media({ revision: 3, media: replacement });
    assert.equal(h.native.clears, 1, "leaving native must release its background videos");
    assert.equal(h.element("stageCurrentNative").hidden, true);
    assert.equal(h.element("stageAudiencePreview").hidden, kind !== "video");
    assert.equal(h.element("stageCurrentImage").hidden, kind !== "image");
    assert.equal(h.element("stageCurrentAudio").hidden, kind !== "audio");
    assert.equal(h.element("stageRoot").dataset.currentMedia, kind);
    assert.equal(h.sync.sources.length, kind === "video" ? 2 : 1);
    assert.equal(h.element("stageCurrentMedia").hidden, kind !== "image");
    h.content({ current: "Refresh" });
    assert.equal(h.native.clears, 1, "inactive native renderer is not repeatedly cleared");
  });
}

test("native revisions reject stale pushes and a late bootstrap; unload disposes the renderer", async () => {
  const initial = deferred(), latest = nativeSlide({ slideId: "latest" }), h = harness({ snapshot: initial.promise });
  h.callbacks.media({ revision: 9, media: latest });
  initial.resolve({ revision: 1, media: nativeSlide({ slideId: "bootstrap" }) });
  await settle();
  for (const revision of [8, 9, 9.5, "10"]) h.callbacks.media({ revision, media: nativeSlide({ slideId: "old" }) });
  assert.deepEqual(h.native.renders, [latest.presentation]);
  h.callbacks.beforeunload();
  assert.equal(h.native.disposals, 1, "dispose owns remaining native background videos");
  assert.equal(h.sync.disposals, 1);
  assert.equal(h.intervals.size, 0);
  assert.deepEqual(h.removed.sort(), ["command", "media", "playback"]);
  h.callbacks.media({ revision: 10, media: nativeSlide() });
  assert.deepEqual(h.native.renders, [latest.presentation]);
});

test("stage restores a local video snapshot and its playback on startup", async () => {
  const media = video(), position = playback();
  const h = harness({ snapshot: { revision: 4, media, playback: position } });
  await settle();
  assert.equal(h.ready(), 1);
  assert.deepEqual(h.sync.sources, [media]);
  assert.deepEqual(h.sync.playback, [position]);
  assert.equal(h.element("stageAudiencePreview").hidden, false);
  assert.equal(h.element("stageCurrentMedia").hidden, true);
  assert.equal(h.element("stageRoot").dataset.audiencePreview, "live");
  assert.equal(h.element("stageRoot").dataset.currentMedia, "video");
  assert.equal(h.intervals.size, 2);
  assert.ok(h.element("stageClock").textContent);
});

test("pushed snapshots outrank a late initial pull and invalid, duplicate or older revisions", async () => {
  const initial = deferred(), latest = video({ url: "file:///latest.mp4", sourceGeneration: 9 });
  const h = harness({ snapshot: initial.promise });
  h.callbacks.media({ revision: 9, media: latest });
  initial.resolve({ revision: 1, media: video() });
  await settle();
  for (const snapshot of [null, {}, { revision: 9.5, media: null }, { revision: "10", media: null },
    { revision: 9, media: null }, { revision: 8, media: null }]) h.callbacks.media(snapshot);
  assert.deepEqual(h.sync.sources, [latest]);
  assert.equal(h.sync.clears, 0);
  h.callbacks.media({ revision: 10, media: null, playback: null });
  assert.equal(h.sync.clears, 1);
  assert.equal(h.element("stageAudiencePreview").hidden, true);
  assert.equal(h.element("stageRoot").dataset.audiencePreview, "off");
});

test("a failed initial pull does not prevent subsequent local media updates", async () => {
  const initial = deferred(), h = harness({ snapshot: initial.promise });
  initial.resolve(Promise.reject(new Error("unavailable")));
  await settle();
  const media = video();
  h.callbacks.media({ revision: 1, media });
  assert.deepEqual(h.sync.sources, [media]);
});

test("local images show the actual URL and clean up when replaced or cleared", async () => {
  const h = harness(); await settle();
  h.callbacks.media({ revision: 1, media: video() });
  h.callbacks.media({ revision: 2, media: { kind: "image", url: "file:///photo.png" } });
  const image = h.element("stageCurrentImage");
  assert.equal(image.hidden, false);
  assert.equal(image.src, "file:///photo.png");
  assert.equal(h.element("stageCurrentMedia").hidden, false);
  assert.equal(h.element("stageCurrentPptx").hidden, true);
  assert.equal(h.element("stageAudiencePreview").hidden, true);
  assert.equal(h.sync.clears, 1);
  h.content({ current: "Photo" });
  assert.deepEqual(h.sourceWrites, [["stageCurrentImage", "file:///photo.png"]]);
  h.callbacks.media({ revision: 3, media: { kind: "image", url: "file:///replacement.jpg" } });
  assert.equal(image.src, "file:///replacement.jpg");
  h.callbacks.media({ revision: 4, media: null });
  assert.equal(image.hidden, true);
  assert.equal(image.getAttribute("src"), null);
  assert.equal(h.element("stageCurrentMedia").hidden, true);
});

test("audio is a note only: neither current nor next audio ever loads any media source", async () => {
  const h = harness(); await settle();
  const audio = { kind: "audio", name: "Soundtrack", url: "file:///sound.mp3", thumbnailUrl: "file:///sound.png" };
  h.content({ current: "Soundtrack", currentMedia: audio, nextMedia: audio });
  h.callbacks.media({ revision: 1, media: audio, playback: playback() });
  h.callbacks.playback(playback());
  assert.equal(h.element("stageCurrentAudio").hidden, false);
  assert.equal(h.element("stageNextAudio").hidden, false);
  assert.equal(h.element("stageCurrentLabel").textContent, "Current — Soundtrack");
  assert.equal(h.element("stageRoot").dataset.audiencePreview, "audio");
  assert.equal(h.element("stageAudiencePreview").hidden, true);
  assert.equal(h.element("stageCurrentMedia").hidden, true);
  assert.equal(h.element("stageNextImage").getAttribute("src"), null);
  assert.deepEqual(h.sync.sources, []);
  assert.deepEqual(h.sync.playback, []);
  assert.deepEqual(h.sourceWrites, []);
  assert.deepEqual(h.deckRequests, []);
});

test("audio content suppresses a stale local video and clears previously active visuals", async () => {
  const h = harness(); await settle();
  h.callbacks.media({ revision: 1, media: video(), playback: playback() });
  h.content({ currentMedia: { kind: "audio", name: "Song" } });
  assert.equal(h.sync.clears, 1);
  assert.equal(h.sync.sources.length, 1);
  assert.equal(h.element("stageAudiencePreview").hidden, true);
  assert.equal(h.element("stageCurrentAudio").hidden, false);
  h.callbacks.media({ revision: 2, media: { kind: "image", url: "file:///stale.png" } });
  assert.deepEqual(h.sourceWrites, []);
});

test("clock profile stops video sync and returning reloads with the latest matching playback", async () => {
  const media = video(), initial = playback(), h = harness({ snapshot: { revision: 1, media, playback: initial } });
  await settle();
  h.content({ profile: "clock" });
  assert.equal(h.sync.clears, 1);
  assert.equal(h.element("stageAudiencePreview").hidden, true);
  assert.equal(h.element("stageCurrentAudio").hidden, true);
  const latest = playback({ currentTime: 40 });
  h.callbacks.playback(latest);
  for (const mismatch of [{ playbackId: "old" }, { audienceSessionId: "old" }, { sourceGeneration: 0 }]) {
    h.callbacks.playback(playback({ currentTime: 999, ...mismatch }));
  }
  assert.deepEqual(h.sync.playback, [initial]);
  h.content({ profile: "current-next" });
  assert.deepEqual(h.sync.sources, [media, media]);
  assert.deepEqual(h.sync.playback, [initial, latest]);
  assert.equal(h.element("stageAudiencePreview").hidden, false);
  const active = playback({ currentTime: 42 });
  h.callbacks.playback(active);
  assert.equal(h.sync.playback.at(-1), active);
  h.content({ current: "Unrelated content refresh" });
  assert.deepEqual(h.sync.playback, [initial, latest, active]);
  const replacement = video({ sourceGeneration: 2 }), replacementPosition = playback({ sourceGeneration: 2 });
  h.callbacks.media({ revision: 2, media: replacement, playback: replacementPosition });
  assert.equal(h.sync.sources.at(-1), replacement);
  assert.equal(h.sync.playback.at(-1), replacementPosition);
});

test("text content, widgets and overlays remain available without local media", async () => {
  const h = harness(); await settle();
  h.command("widgets", { serviceItem: "Widget item", notes: "Widget notes", countdown: "02:00" });
  h.content({ current: "Verse\nSecond line", next: "Chorus", serviceItem: "Live item", notes: "Live notes", sectionLabel: "Verse 1" });
  for (const [id, value] of [["stageCurrent", "Verse\nSecond line"], ["stageNext", "Chorus"],
    ["stageServiceItem", "Live item"], ["stageNotes", "Live notes"], ["stageSectionLabel", "Verse 1"], ["stageCountdown", "02:00"]]) {
    assert.equal(h.element(id).textContent, value);
  }
  h.command("alert", { title: "Alert", message: "Notice" });
  h.command("privateMessage", { title: "Private", message: "Operator only" });
  assert.equal(h.element("stageAlert").hidden, false);
  assert.equal(h.element("stageAlertMessage").textContent, "Notice");
  assert.equal(h.element("stagePrivateText").textContent, "Operator only");
  h.content({ currentMedia: { kind: "text" } });
  assert.equal(h.element("stageCurrent").textContent, "Waiting for live content");
  assert.equal(h.element("stageServiceItem").textContent, "Widget item");
  assert.equal(h.element("stageNotes").textContent, "Widget notes");
  assert.deepEqual(h.sync.sources, []);
  assert.deepEqual(h.sourceWrites, []);
});

test("current PPTX renders locally, reuses the same slide and disposes on slide change and clock", async () => {
  const slides = [], h = harness({ renderPptx: async () => { const slide = makeSlide(); slides.push(slide); return slide; } });
  await settle();
  h.callbacks.media({ revision: 1, media: pptx() }); await settle();
  assert.deepEqual(h.deckRequests, ["deck-a"]);
  assert.equal(h.renders[0].viewport, h.element("stageCurrentPptx"));
  assert.equal(h.renders[0].slideIndex, 2);
  assert.equal(h.renders[0].isCurrent(), true);
  assert.equal(h.element("stageCurrentPptx").hidden, false);
  assert.equal(h.element("stageCurrentMedia").hidden, false);
  assert.equal(h.element("stageCurrentImage").hidden, true);
  assert.deepEqual(slides[0].classes, ["stage-card__pptx-slide"]);
  h.content({ current: "Slide" }); await settle();
  assert.equal(h.renders.length, 1);
  h.callbacks.media({ revision: 2, media: pptx({ slideIndex: 3 }) }); await settle();
  assert.equal(slides[0].disposals, 1);
  assert.equal(h.renders[0].isCurrent(), false);
  assert.equal(h.renders[1].slideIndex, 3);
  h.content({ profile: "clock" });
  assert.equal(slides[1].disposals, 1);
  assert.equal(h.element("stageCurrentPptx").hidden, true);
  assert.deepEqual(h.sync.sources, []);
});

test("current PPTX discards stale deck fetches before starting a render", async () => {
  const first = deferred(), h = harness({ getNextPptx: (key) => key === "deck-a" ? first.promise : new ArrayBuffer(8) });
  await settle();
  h.callbacks.media({ revision: 1, media: pptx() });
  h.callbacks.media({ revision: 2, media: pptx({ deckKey: "deck-b" }) }); await settle();
  assert.equal(h.renders.length, 1);
  first.resolve(new ArrayBuffer(8)); await settle();
  assert.equal(h.renders.length, 1);
  assert.equal(h.renders[0].isCurrent(), true);
});

test("late current and next PPTX render results are disposed after generation replacement", async () => {
  const pending = [], h = harness({ renderPptx: () => { const job = deferred(); pending.push(job); return job.promise; } });
  await settle();
  h.callbacks.media({ revision: 1, media: pptx() });
  h.content({ nextMedia: pptx({ deckKey: "next" }) }); await settle();
  assert.equal(pending.length, 2);
  h.callbacks.media({ revision: 2, media: { kind: "image", url: "file:///new.png" } });
  h.content({ next: "Text instead", nextMedia: { kind: "text" } });
  const slides = pending.map(() => makeSlide());
  pending.forEach((job, index) => job.resolve(slides[index])); await settle();
  assert.deepEqual(slides.map((slide) => slide.disposals), [1, 1]);
  assert.ok(h.renders.every((options) => !options.isCurrent()));
  assert.equal(h.element("stageCurrentImage").src, "file:///new.png");
  assert.equal(h.element("stageNextMedia").hidden, true);
});

test("next image/video thumbnails accept only file URLs and clear for audio or text", async () => {
  const h = harness(); await settle();
  for (const kind of ["image", "video"]) {
    h.content({ nextMedia: { kind, thumbnailUrl: "file:///poster.png", url: "file:///never-play.mp4" } });
    assert.equal(h.element("stageNextImage").hidden, false);
    assert.equal(h.element("stageNextImage").src, "file:///poster.png");
    assert.equal(h.element("stageNextCard").dataset.nextMedia, kind);
  }
  for (const thumbnailUrl of ["https://example.com/image.png", "blob:private", "invalid"]) {
    h.content({ nextMedia: { kind: "video", thumbnailUrl } });
    assert.equal(h.element("stageNextMedia").hidden, true);
  }
  for (const kind of ["audio", "text"]) {
    h.content({ nextMedia: { kind } });
    assert.equal(h.element("stageNextImage").getAttribute("src"), null);
  }
  assert.deepEqual(h.sync.sources, []);
  assert.ok(h.sourceWrites.every(([id, url]) => id === "stageNextImage" && url === "file:///poster.png"));
});

test("unload disposes sync, timers, listeners and both completed PPTX renders", async () => {
  const slides = [], h = harness({ renderPptx: async () => { const slide = makeSlide(); slides.push(slide); return slide; } });
  await settle();
  h.callbacks.media({ revision: 1, media: pptx() });
  h.content({ nextMedia: pptx({ deckKey: "next" }) }); await settle();
  assert.equal(slides.length, 2);
  h.callbacks.beforeunload();
  assert.deepEqual(slides.map((slide) => slide.disposals), [1, 1]);
  assert.equal(h.sync.disposals, 1);
  assert.equal(h.intervals.size, 0);
  assert.deepEqual(h.removed.sort(), ["command", "media", "playback"]);
  h.callbacks.media({ revision: 2, media: video() });
  h.callbacks.playback(playback());
  assert.deepEqual(h.sync.sources, []);
  assert.deepEqual(h.sync.playback, []);
  assert.ok(h.renders.every((options) => !options.isCurrent()));
});

test("unload invalidates pending PPTX renders and a late initial media pull", async () => {
  const initial = deferred(), pending = [], h = harness({ snapshot: initial.promise,
    renderPptx: () => { const job = deferred(); pending.push(job); return job.promise; } });
  h.callbacks.media({ revision: 1, media: pptx() });
  h.content({ nextMedia: pptx({ deckKey: "next" }) }); await settle();
  assert.equal(pending.length, 2);
  h.callbacks.beforeunload();
  const slides = pending.map(() => makeSlide());
  pending.forEach((job, index) => job.resolve(slides[index]));
  initial.resolve({ revision: 99, media: video(), playback: playback() }); await settle();
  assert.deepEqual(slides.map((slide) => slide.disposals), [1, 1]);
  assert.deepEqual(h.sync.sources, []);
  assert.deepEqual(h.sync.playback, []);
  assert.deepEqual(h.warnings, []);
});

test("stage requests a live audience RTC peer stream when available and replaces local fallback visuals", async () => {
  const peerSignals = [];
  const relays = [];
  let onAudienceSourceCallback = null;
  let onAudiencePeerSignalCallback = null;
  class MockRelay {
    constructor(options) {
      this.options = options;
      this.received = [];
      this.closed = [];
      relays.push(this);
    }
    receive(message) {
      this.received.push(message);
    }
    close(notify = true) {
      this.closed.push(notify);
    }
  }
  const elements = new Map();
  const element = (key) => {
    if (!elements.has(key)) {
      const attributes = new Map();
      elements.set(key, {
        dataset: {},
        hidden: true,
        textContent: "",
        innerHTML: "",
        srcObject: null,
        muted: false,
        defaultMuted: false,
        volume: 1,
        plays: 0,
        pauses: 0,
        play() {
          this.plays += 1;
          return Promise.resolve();
        },
        pause() {
          this.pauses += 1;
        },
        getAttribute(name) {
          return attributes.get(name) ?? null;
        },
        removeAttribute(name) {
          attributes.delete(name);
        },
      });
    }
    return elements.get(key);
  };
  let unloadCallback = null;
  const sync = {
    clears: 0,
    disposals: 0,
    setSource() {
      return true;
    },
    receive() {},
    clear() {
      this.clears += 1;
    },
    dispose() {
      this.disposals += 1;
    },
  };
  const native = {
    clears: 0,
    disposals: 0,
    render() {},
    clear() {
      this.clears += 1;
    },
    dispose() {
      this.disposals += 1;
    },
  };
  const api = {
    sessionId: "stage",
    getAudienceSource: () => ({
      available: true,
      windowId: 2,
      sessionId: "aud-1",
      sourceKey: "2:aud-1",
      kind: "video",
    }),
    onAudienceSource(cb) {
      onAudienceSourceCallback = cb;
      return () => {};
    },
    onAudiencePeerSignal(cb) {
      onAudiencePeerSignalCallback = cb;
      return () => {};
    },
    sendAudiencePeerSignal(msg) {
      peerSignals.push(msg);
    },
    getLocalMedia: () => ({ revision: 1, media: video(), playback: playback() }),
    onCommand: () => () => {},
    onLocalMedia: () => () => {},
    onLocalPlayback: () => () => {},
    acknowledge() {},
    ready() {},
  };
  const context = vm.createContext({
    createCompositorState,
    applyOutputCommand,
    outputAcknowledgement,
    LocalVideoRelay: MockRelay,
    Date,
    Intl,
    URL,
    console,
    setInterval: () => 1,
    clearInterval() {},
    resolveAlertTokens: (v) => v || "",
    document: { getElementById: element },
    window: {
      stageOutput: api,
      addEventListener(event, cb) {
        if (event === "beforeunload") unloadCallback = cb;
      },
    },
    createStageVideoSync: () => sync,
    createNativeSlideRenderer: () => native,
    ensurePptxProcessEnv() {},
    pptxRenderer: {},
    renderPptxSlideThumbnail: async () => makeSlide(),
  });
  const loader = /^function loadPptxRendererModule\(\) \{[\s\S]*?^\}/m;
  vm.runInContext(
    source
      .replace(/^import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";\n/gm, "")
      .replace(loader, "function loadPptxRendererModule() { return Promise.resolve(pptxRenderer); }"),
    context,
  );
  await settle();
  assert.equal(relays.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(peerSignals)), [
    { type: "request", peerId: "stage-peer-1", sourceKey: "2:aud-1" },
  ]);

  let stopped = 0;
  const remoteTrack = {
    kind: "video",
    readyState: "live",
    addEventListener() {},
    stop() {
      stopped += 1;
      this.readyState = "ended";
    },
  };
  const remoteStream = {
    getVideoTracks: () => [remoteTrack],
    getTracks: () => [remoteTrack],
  };
  relays[0].options.onStream(remoteStream);
  assert.equal(element("stageAudiencePreview").srcObject, remoteStream);
  assert.equal(element("stageAudiencePreview").hidden, false);
  assert.equal(element("stageRoot").dataset.audiencePreview, "live");
  assert.equal(sync.clears, 1, "local video sync is cleared once live RTC stream attaches");

  onAudiencePeerSignalCallback({
    type: "description",
    peerId: "stage-peer-1",
    sourceKey: "2:aud-1",
    description: { type: "offer", sdp: "v=0" },
  });
  assert.equal(relays[0].received.length, 1);

  onAudienceSourceCallback({
    available: false,
    windowId: 0,
    sessionId: "",
    sourceKey: "",
    kind: "none",
  });
  assert.equal(element("stageAudiencePreview").srcObject, null);
  assert.equal(stopped, 1);
  assert.deepEqual(relays[0].closed, [true]);
  unloadCallback?.();
});