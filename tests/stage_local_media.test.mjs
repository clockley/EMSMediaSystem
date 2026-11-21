import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { stageDeckKey } from "../src/main-process/stage-item-media.mjs";

// Production imports built modules; load the sanitizer against its source dependency.
const source = (await readFile(new URL("../src/main-process/stage-local-media.mjs", import.meta.url), "utf8"))
  .replace('"./stage-item-media.min.mjs"', JSON.stringify(new URL("../src/main-process/stage-item-media.mjs", import.meta.url).href));
const { sanitizeStageLocalMedia } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const main = await readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8");

const identity = { playbackId: "play-1", audienceSessionId: "audience-1", sourceGeneration: 7 };
const descriptor = (overrides = {}) => ({ ...identity, kind: "video", url: "https://example.test/clip.mp4", ...overrides });
const playback = (overrides = {}) => ({ ...identity, currentTime: 12, duration: 60, playing: true, ...overrides });
const plain = (value) => JSON.parse(JSON.stringify(value));
const nativePresentation = () => ({
  text: "Amazing grace", bodyText: "Amazing grace", referenceText: "Verse 1", attributionText: "Author",
  copyrightText: "Public domain", contentKind: "song", slideId: "verse-1",
  blocks: [{ type: "lyricLine", primary: { segments: [{ text: "Amazing grace", style: {
    fontFamily: "CMG Sans", fontWeight: "700", fontStyle: "italic", textDecoration: "underline",
    color: "#ffcc00", backgroundColor: "#123456",
  } }] } }],
  slideObjects: [{ id: "shape-1", type: "shape", x: 10, y: 20, width: 300, height: 100, fill: "#224466" }],
  slideTextObjects: [{ id: "text-1", text: "Caption", fontSize: 32, position: { x: 20, y: 40 } }],
  fontSize: 72, minFontSize: 28, fontFamily: "CMG Sans", fontWeight: "700", fontStyle: "italic",
  textDecoration: "underline", lineHeight: 1.2, color: "#ffffff", referenceFontSize: 30,
  referenceColor: "#dddddd", referenceTextShadow: "0 2px 4px #000000", autosizeMode: "group",
  autosizeGroupFontSize: 64, position: { x: 10, y: 10, width: 80, height: 80 },
  textBoxPosition: { x: 5, y: 5, width: 90, height: 90 }, resolvedLayout: { width: 1920, height: 1080 },
  outputSize: { width: 1920, height: 1080 }, transition: { effect: "fade", durationMs: 200 },
  backgroundColor: "#112233", backgroundImage: "file:///image.png", backgroundVideo: "file:///backdrop.mp4",
  backgroundPath: "/srv/backdrop.mp4", backgroundVideoSync: { currentTime: 12, paused: false },
  resolvedTheme: { backdrop: { type: "video", path: "/srv/backdrop.mp4", color: "#112233" } },
});

test("native preserves only the active resolved presentation and its formatting without URL resolution", () => {
  const presentation = nativePresentation();
  const input = descriptor({ kind: "native", presentation: { ...presentation,
    html: "<script>editor()</script>", innerHTML: "<b>raw</b>", rawHTML: "<i>raw</i>",
    editorState: { selection: 1 }, song: { sections: ["entire song"] }, deck: { slides: ["entire deck"] },
    slides: ["other slide"], sections: ["other section"], fullBodyText: "unresolved full song",
    resolvedTheme: { ...presentation.resolvedTheme, editorState: { private: true }, name: "Private theme" },
  }, html: "<p>raw</p>", song: { sections: [] }, deck: { slides: [] }, editorState: {}, sourcePath: "/secret" });
  const before = plain(input);
  const result = sanitizeStageLocalMedia(input, () => assert.fail("native must not resolve a media URL"));
  assert.deepEqual(result, { media: { ...identity, kind: "native", presentation }, pptxPath: "" });
  assert.deepEqual(input, before, "sanitizing must not mutate the audience payload");
  assert.notEqual(result.media.presentation.blocks, input.presentation.blocks, "IPC data is JSON-cloned");
  result.media.presentation.blocks[0].primary.segments[0].text = "Changed";
  assert.equal(input.presentation.blocks[0].primary.segments[0].text, "Amazing grace");
});

test("native missing, oversized or cyclic active payloads degrade to text without throwing", () => {
  const cyclic = nativePresentation(); cyclic.blocks.push(cyclic);
  const cyclicBackdrop = {}; cyclicBackdrop.self = cyclicBackdrop;
  for (const presentation of [undefined, null, "raw HTML", { text: "x".repeat(2 * 1024 * 1024) },
    cyclic, { resolvedTheme: { backdrop: cyclicBackdrop } }]) {
    assert.deepEqual(sanitizeStageLocalMedia(descriptor({ kind: "native", presentation }), () => {
      assert.fail("invalid native payload must not resolve URLs");
    }), { media: { ...identity, kind: "text" }, pptxPath: "" });
  }
});

test("discarded cyclic editor state and whole-deck data cannot poison a valid native slide", () => {
  const discarded = {}; discarded.self = discarded;
  const presentation = nativePresentation();
  assert.deepEqual(sanitizeStageLocalMedia(descriptor({ kind: "native", presentation: {
    ...presentation, editorState: discarded, song: discarded, deck: discarded, html: "x".repeat(2 * 1024 * 1024),
  } }), resolveLocalPath), { media: { ...identity, kind: "native", presentation }, pptxPath: "" });
});

function resolveLocalPath(raw) {
  if (path.isAbsolute(raw)) return raw;
  try {
    if (raw.startsWith("file:")) return fileURLToPath(raw);
    if (raw.startsWith("ems-media:")) return "/srv/media/Clip with spaces.mp4";
  } catch {}
  return "";
}

test("audio keeps identity but strips URLs and all presentation fields without resolving", () => {
  const result = sanitizeStageLocalMedia(descriptor({ kind: "audio", deckKey: "forged", slideIndex: 2 }), () => {
    assert.fail("audio must not resolve or expose a media URL");
  });
  assert.deepEqual(result, { media: { ...identity, kind: "audio" }, pptxPath: "" });
});

test("audio-file URLs mislabeled as video still never reach a media decoder", () => {
  for (const url of ["/srv/song.mp3", "file:///srv/song.FLAC", "https://example.test/song.m4a?token=test"]) {
    const result = sanitizeStageLocalMedia(descriptor({ url }), () => {
      assert.fail("audio URLs must not be resolved");
    });
    assert.deepEqual(result, { media: { ...identity, kind: "audio" }, pptxPath: "" });
  }
});

test("missing and unsupported descriptors degrade to text", () => {
  for (const input of [undefined, null, {}, "video", { kind: "iframe" }, { kind: "VIDEO" }]) {
    assert.deepEqual(sanitizeStageLocalMedia(input, resolveLocalPath), {
      media: { playbackId: "", audienceSessionId: "", sourceGeneration: 0, kind: "text" }, pptxPath: "",
    });
  }
  assert.deepEqual(sanitizeStageLocalMedia(descriptor({ kind: "unsupported" }), resolveLocalPath), {
    media: { ...identity, kind: "text" }, pptxPath: "",
  });
});

for (const kind of ["video", "image"]) {
  test(`${kind} rejects invalid, unsupported, blob and javascript URLs`, () => {
    for (const url of [undefined, null, 123, {}, "", "not a URL", "http://[", "https://", "relative/clip.mp4",
      "blob:https://example.test/id", "javascript:alert(1)", "data:video/mp4;base64,AAAA", "ftp://example.test/clip.mp4"]) {
      assert.deepEqual(sanitizeStageLocalMedia(descriptor({ kind, url }), resolveLocalPath), {
        media: { ...identity, kind: "text" }, pptxPath: "",
      }, String(url));
    }
  });

  test(`${kind} allows HTTP(S) while stripping untrusted descriptor fields`, () => {
    for (const url of ["https://example.test/clip.mp4?revision=2#frame", "http://example.test/still image.jpg"]) {
      assert.deepEqual(sanitizeStageLocalMedia(descriptor({ kind, url, sourcePath: "/secret", deckKey: "forged", extra: true }), resolveLocalPath), {
        media: { ...identity, kind, url: new URL(url).href }, pptxPath: "",
      });
    }
  });

  test(`${kind} converts local paths and file URLs with correct escaping`, () => {
    const localPath = "/srv/media/Clip #1 with spaces.mp4";
    for (const url of [localPath, pathToFileURL(localPath).href]) {
      assert.deepEqual(sanitizeStageLocalMedia(descriptor({ kind, url }), resolveLocalPath), {
        media: { ...identity, kind, url: pathToFileURL(localPath).href }, pptxPath: "",
      });
    }
  });
}

test("ems-media URL is preserved instead of bypassing virtual STSS patching with file:", () => {
  const url = "ems-media://video/Clip%20with%20spaces.mp4?generation=7#frame";
  assert.ok(resolveLocalPath(url));
  assert.deepEqual(sanitizeStageLocalMedia(descriptor({ url }), resolveLocalPath), {
    media: { ...identity, kind: "video", url }, pptxPath: "",
  });
  assert.equal(sanitizeStageLocalMedia(descriptor({ url }), () => "").media.url, url);
});

test("PPTX exposes only an opaque deckKey and current slide, retaining the path privately", () => {
  const localPath = "/srv/private/Service.PPTX";
  const result = sanitizeStageLocalMedia(descriptor({ kind: "pptx", url: pathToFileURL(localPath).href,
    slideIndex: 4, deckKey: "forged", sourcePath: localPath }), resolveLocalPath);
  assert.deepEqual(result, {
    media: { ...identity, kind: "pptx", deckKey: stageDeckKey(localPath), slideIndex: 4 }, pptxPath: localPath,
  });
  assert.match(result.media.deckKey, /^[a-f0-9]{24}$/);
  assert.equal(JSON.stringify(result.media).includes(localPath), false);
  assert.notEqual(stageDeckKey("/srv/private/Other.pptx"), result.media.deckKey);
});

test("PPTX current slide is bounded to 0..9999 and non-integers default to zero", () => {
  for (const [slideIndex, expected] of [[-1, 0], [0, 0], [8, 8], [9999, 9999], [10000, 9999],
    [1.5, 0], ["4", 0], [undefined, 0], [null, 0], [NaN, 0], [Infinity, 0]]) {
    const result = sanitizeStageLocalMedia(descriptor({ kind: "pptx", url: "/srv/deck.pptx", slideIndex }), resolveLocalPath);
    assert.equal(result.media.slideIndex, expected, String(slideIndex));
    assert.equal(result.media.deckKey, stageDeckKey("/srv/deck.pptx"));
  }
});

test("PPTX rejects unresolved remote URLs and local files with the wrong extension", () => {
  for (const url of ["https://example.test/deck.pptx", "blob:https://example.test/deck.pptx", "javascript:deck.pptx",
    "/srv/deck.ppt", "/srv/deck.pptx.exe", "", undefined]) {
    assert.deepEqual(sanitizeStageLocalMedia(descriptor({ kind: "pptx", url }), resolveLocalPath), {
      media: { ...identity, kind: "text" }, pptxPath: "",
    });
  }
});

test("identity strings and integer source generations are normalized without inventing identities", () => {
  for (const sourceGeneration of [undefined, null, "7", 1.5, NaN, Infinity]) {
    const result = sanitizeStageLocalMedia({ kind: "audio", playbackId: 123, audienceSessionId: 456, sourceGeneration }, resolveLocalPath);
    assert.deepEqual(result.media, { kind: "audio", playbackId: "123", audienceSessionId: "456", sourceGeneration: 0 });
  }
  for (const sourceGeneration of [0, 1, 7]) {
    const input = descriptor({ sourceGeneration });
    const result = sanitizeStageLocalMedia(input, resolveLocalPath);
    assert.equal(result.media.sourceGeneration, sourceGeneration);
    assert.equal(result.media.playbackId, identity.playbackId);
    assert.deepEqual(input, descriptor({ sourceGeneration }), "sanitizing must not mutate input");
  }
});

// Extract real main-process functions, as in stage_shared_capture.test.mjs,
// without importing Electron or starting the application.
function fn(name) {
  const match = main.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^}`, "m"));
  assert.ok(match, name);
  return match[0];
}

function routerHarness() {
  const endpoint = (id) => ({ id, destroyed: false, isDestroyed() { return this.destroyed; }, webContents: {
    destroyed: false, isDestroyed() { return this.destroyed; }, isCrashed: () => false, isLoadingMainFrame: () => false,
    messages: [], send(channel, payload) { this.messages.push([channel, payload]); },
  } });
  const s = {
    win: endpoint(1), mediaWindow: endpoint(2), stageWindow: endpoint(3),
    audienceSessionId: identity.audienceSessionId, audienceContentKind: "video",
    stageLocalMediaRevision: 0, stageLocalMedia: null, stageLocalPlayback: null, stageCurrentPptxPath: "",
    stageAudienceRelaySession: null, stageAudienceSourceSignature: "", stageHealth: "unknown",
    stageLayerCommands: new Map(), publishOutputStatus() {},
    sanitizeStageLocalMedia, resolveStageMediaLocalPath: resolveLocalPath,
    ipcHandlers: {}, ipcListeners: {},
  };
  s.ipcMain = {
    handle(channel, callback) { s.ipcHandlers[channel] = callback; },
    on(channel, callback) { s.ipcListeners[channel] = callback; },
  };
  vm.createContext(s);
  for (const name of ["currentStageLocalMedia", "sendStageLocalMedia", "handleStageLocalMedia", "handleStageLocalPlayback", "handlePlaybackStateChange",
    "currentStageAudienceSource", "closeStageAudienceRelay", "publishStageAudienceSource"]) {
    vm.runInContext(fn(name), s);
  }
  for (const [method, channel] of [["handle", "stage-local-media"], ["on", "stage-output-ready"]]) {
    const match = main.match(new RegExp(`^  ipcMain\\.${method}\\("${channel}", \\(event\\) => \\{[\\s\\S]*?^  \\}\\);`, "m"));
    assert.ok(match, `${method} ${channel}`);
    vm.runInContext(match[0], s);
  }
  s.audienceEvent = { sender: s.mediaWindow.webContents };
  s.accept = (overrides) => s.handleStageLocalMedia(s.audienceEvent, descriptor(overrides));
  return s;
}

test("stage clock samples update only the stage follower and its bootstrap cache", () => {
  const s = routerHarness();
  s.accept();
  s.stageWindow.webContents.messages.length = 0;
  for (let frame = 0; frame < 30; frame += 1) {
    s.handleStageLocalPlayback(s.audienceEvent, playback({ currentTime: 12 + frame / 30 }));
  }
  assert.equal(s.win.webContents.messages.length, 0, "clock ticks must not change control transport behavior");
  assert.equal(s.stageWindow.webContents.messages.length, 30);
  assert.equal(s.currentStageLocalMedia().playback.currentTime, 12 + 29 / 30);
  for (const event of [{ sender: s.win.webContents }, { sender: s.stageWindow.webContents }]) {
    s.handleStageLocalPlayback(event, playback({ currentTime: 999 }));
  }
  s.handleStageLocalPlayback(s.audienceEvent, playback({ audienceSessionId: "obsolete", currentTime: 999 }));
  assert.equal(s.stageWindow.webContents.messages.length, 30);
});

test("local media router accepts only the current audience sender and exact session", () => {
  const s = routerHarness();
  for (const sender of [{}, s.win.webContents, s.stageWindow.webContents]) {
    s.handleStageLocalMedia({ sender }, descriptor());
  }
  for (const audienceSessionId of [undefined, "", "old-session"]) s.accept({ audienceSessionId });
  s.handleStageLocalMedia(s.audienceEvent, null);
  assert.deepEqual(plain(s.currentStageLocalMedia()), { revision: 0, media: null, playback: null });
  assert.equal(s.stageWindow.webContents.messages.length, 0);
  s.accept();
  assert.deepEqual(plain(s.currentStageLocalMedia()), { revision: 1, media: descriptor(), playback: null });
  assert.equal(s.win.webContents.messages.length, 0);
  assert.equal(s.stageWindow.webContents.messages[0][0], "stage-local-media");
});

test("missing or destroyed audience windows cannot replace the cached descriptor", () => {
  for (const unavailable of ["missing", "destroyed"]) {
    const s = routerHarness(); s.accept();
    const cached = s.stageLocalMedia;
    if (unavailable === "missing") s.mediaWindow = null;
    else s.mediaWindow.destroyed = true;
    s.accept({ playbackId: "forged" });
    assert.equal(s.stageLocalMedia, cached);
    assert.equal(s.stageLocalMediaRevision, 1);
  }
});

test("new descriptors bump revision, reset playback and update or clear the private PPTX path", () => {
  const s = routerHarness(); s.accept();
  s.handlePlaybackStateChange(s.audienceEvent, playback());
  s.accept({ kind: "pptx", url: "/srv/deck.pptx", slideIndex: 3 });
  assert.equal(s.stageLocalMediaRevision, 2);
  assert.equal(s.stageLocalPlayback, null);
  assert.equal(s.stageCurrentPptxPath, "/srv/deck.pptx");
  assert.equal(s.stageLocalMedia.deckKey, stageDeckKey("/srv/deck.pptx"));
  s.accept({ kind: "image" });
  assert.equal(s.stageLocalMediaRevision, 3);
  assert.equal(s.stageCurrentPptxPath, "");
  s.accept({ url: "javascript:alert(1)" });
  assert.equal(s.stageLocalMediaRevision, 4);
  assert.equal(s.stageLocalMedia.kind, "text");
});

test("playback router rejects foreign senders, stale sessions and unavailable audience windows", () => {
  const s = routerHarness(); s.accept();
  s.stageWindow.webContents.messages.length = 0;
  for (const sender of [{}, s.win.webContents, s.stageWindow.webContents]) {
    s.handlePlaybackStateChange({ sender }, playback());
  }
  s.handlePlaybackStateChange(s.audienceEvent, playback({ audienceSessionId: "old-session" }));
  s.mediaWindow.destroyed = true;
  s.handlePlaybackStateChange(s.audienceEvent, playback());
  s.mediaWindow = null;
  s.handlePlaybackStateChange(s.audienceEvent, playback());
  assert.equal(s.stageLocalPlayback, null);
  assert.equal(s.win.webContents.messages.length, 0);
  assert.equal(s.stageWindow.webContents.messages.length, 0);
});

test("only local video playback matching both playbackId and generation reaches stage", () => {
  const s = routerHarness(); s.accept();
  s.stageWindow.webContents.messages.length = 0;
  for (const overrides of [{ playbackId: "old" }, { sourceGeneration: 6 }, { sourceGeneration: "7" },
    { sourceGeneration: undefined }, { playbackId: undefined }]) {
    s.handlePlaybackStateChange(s.audienceEvent, playback(overrides));
  }
  assert.equal(s.win.webContents.messages.length, 5, "valid audience state still updates control");
  assert.equal(s.stageWindow.webContents.messages.length, 0);
  assert.equal(s.stageLocalPlayback, null);
  const state = playback();
  s.handlePlaybackStateChange(s.audienceEvent, state);
  assert.equal(s.stageLocalPlayback, state);
  assert.equal(s.stageLocalMediaRevision, 1, "playback updates do not replace the source");
  assert.deepEqual(s.stageWindow.webContents.messages, [["stage-local-playback", state]]);
  s.handlePlaybackStateChange(s.audienceEvent, playback({ playbackId: "late-old" }));
  assert.equal(s.stageLocalPlayback, state, "late stale state cannot overwrite the bootstrap cache");
});

test("non-video and absent descriptors never forward playback to stage", () => {
  for (const kind of [null, "audio", "image", "pptx", "text", "native"]) {
    const s = routerHarness();
    if (kind) s.accept({ kind, url: kind === "pptx" ? "/srv/deck.pptx" : descriptor().url,
      ...(kind === "native" ? { presentation: nativePresentation() } : {}) });
    s.stageWindow.webContents.messages.length = 0;
    s.handlePlaybackStateChange(s.audienceEvent, playback());
    assert.equal(s.stageLocalPlayback, null, String(kind));
    assert.equal(s.stageWindow.webContents.messages.length, 0, String(kind));
    assert.equal(s.win.webContents.messages.length, 1);
  }
});

test("stage bootstrap returns the latest cached descriptor and playback only to the stage sender", () => {
  const s = routerHarness(); s.accept();
  const state = playback();
  s.handlePlaybackStateChange(s.audienceEvent, state);
  const get = s.ipcHandlers["stage-local-media"];
  for (const sender of [{}, s.win.webContents, s.mediaWindow.webContents]) assert.equal(get({ sender }), null);
  const cached = get({ sender: s.stageWindow.webContents });
  assert.deepEqual(plain(cached), { revision: 1, media: descriptor(), playback: state });
  s.stageWindow.webContents.messages.length = 0;
  s.sendStageLocalMedia();
  assert.deepEqual(plain(s.stageWindow.webContents.messages), [["stage-local-media", plain(cached)]]);
  s.stageWindow = null;
  assert.equal(get({ sender: {} }), null);
});

test("stage-ready replays cached local media and playback after a late stage window opens", () => {
  const s = routerHarness();
  const stage = s.stageWindow; s.stageWindow = null;
  s.accept();
  s.handlePlaybackStateChange(s.audienceEvent, playback());
  assert.equal(stage.webContents.messages.length, 0);
  s.stageWindow = stage;
  s.ipcListeners["stage-output-ready"]({ sender: s.win.webContents });
  assert.equal(stage.webContents.messages.length, 0);
  s.ipcListeners["stage-output-ready"]({ sender: stage.webContents });
  assert.deepEqual(plain(stage.webContents.messages[0]), ["stage-local-media", {
    revision: 1, media: descriptor(), playback: playback(),
  }]);
  assert.equal(stage.webContents.messages[1][0], "stage-audience-source");
  assert.equal(s.stageHealth, "ok");
});

test("native routing authenticates audience sender/session and replays the sanitized cache to stage only", () => {
  const s = routerHarness(), presentation = nativePresentation();
  const input = descriptor({ kind: "native", presentation: { ...presentation, html: "<b>raw</b>", song: { sections: [] } } });
  for (const sender of [{}, s.win.webContents, s.stageWindow.webContents]) {
    s.handleStageLocalMedia({ sender }, input);
  }
  for (const audienceSessionId of [undefined, "", "old-session"]) {
    s.handleStageLocalMedia(s.audienceEvent, { ...input, audienceSessionId });
  }
  assert.deepEqual(plain(s.currentStageLocalMedia()), { revision: 0, media: null, playback: null });
  assert.equal(s.stageWindow.webContents.messages.length, 0);
  s.accept({ kind: "pptx", url: "/srv/deck.pptx" });
  assert.ok(s.stageCurrentPptxPath);
  const stage = s.stageWindow; s.stageWindow = null;
  s.handleStageLocalMedia(s.audienceEvent, input);
  const cached = { revision: 2, media: { ...identity, kind: "native", presentation }, playback: null };
  assert.deepEqual(plain(s.currentStageLocalMedia()), cached);
  assert.equal(s.stageCurrentPptxPath, "");
  s.stageWindow = stage;
  stage.webContents.messages.length = 0;
  const get = s.ipcHandlers["stage-local-media"];
  for (const sender of [{}, s.win.webContents, s.mediaWindow.webContents]) assert.equal(get({ sender }), null);
  assert.deepEqual(plain(get({ sender: stage.webContents })), cached);
  s.ipcListeners["stage-output-ready"]({ sender: stage.webContents });
  assert.deepEqual(plain(stage.webContents.messages[0]), ["stage-local-media", cached]);
  assert.equal(s.win.webContents.messages.length, 0);
  const previous = s.stageLocalMedia;
  s.mediaWindow.destroyed = true;
  s.handleStageLocalMedia(s.audienceEvent, { ...input, presentation: { text: "forged" } });
  assert.equal(s.stageLocalMedia, previous);
  assert.equal(s.stageLocalMediaRevision, 2);
});

test("unavailable stage windows suppress sends without losing cached media or playback", () => {
  for (const unavailable of ["missing", "window-destroyed", "contents-destroyed"]) {
    const s = routerHarness(); const stage = s.stageWindow;
    if (unavailable === "missing") s.stageWindow = null;
    else if (unavailable === "window-destroyed") stage.destroyed = true;
    else stage.webContents.destroyed = true;
    s.accept();
    s.handlePlaybackStateChange(s.audienceEvent, playback());
    s.sendStageLocalMedia();
    assert.equal(stage.webContents.messages.length, 0, unavailable);
    assert.equal(s.stageLocalMedia.playbackId, identity.playbackId);
    assert.equal(s.stageLocalPlayback.currentTime, 12);
  }
});

test("publishing audience closure or session replacement clears media, playback and PPTX authorization", () => {
  for (const change of ["closed", "destroyed", "contents-destroyed", "session-replaced"]) {
    const s = routerHarness();
    s.accept(); s.handlePlaybackStateChange(s.audienceEvent, playback());
    s.accept({ kind: "pptx", url: "/srv/deck.pptx" });
    assert.ok(s.stageCurrentPptxPath);
    s.stageWindow.webContents.messages.length = 0;
    if (change === "closed") s.mediaWindow = null;
    else if (change === "destroyed") s.mediaWindow.destroyed = true;
    else if (change === "contents-destroyed") s.mediaWindow.webContents.destroyed = true;
    else s.audienceSessionId = "replacement-session";
    s.publishStageAudienceSource();
    assert.deepEqual(plain(s.currentStageLocalMedia()), { revision: 3, media: null, playback: null }, change);
    assert.equal(s.stageCurrentPptxPath, "", change);
    assert.deepEqual(plain(s.stageWindow.webContents.messages[0]), ["stage-local-media", {
      revision: 3, media: null, playback: null,
    }]);
    s.publishStageAudienceSource();
    assert.equal(s.stageLocalMediaRevision, 3, "repeated cleanup does not invent revisions");
  }
});

test("publishing audience closure clears an actively cached video playback state", () => {
  const s = routerHarness(); s.accept();
  s.handlePlaybackStateChange(s.audienceEvent, playback());
  assert.ok(s.stageLocalPlayback);
  s.mediaWindow = null;
  s.publishStageAudienceSource();
  assert.deepEqual(plain(s.currentStageLocalMedia()), { revision: 2, media: null, playback: null });
});

test("publishing unchanged or changed cue kinds preserves a valid local source and playback", () => {
  const s = routerHarness(); s.accept();
  s.handlePlaybackStateChange(s.audienceEvent, playback());
  const cached = plain(s.currentStageLocalMedia());
  s.publishStageAudienceSource();
  s.audienceContentKind = "scripture";
  s.publishStageAudienceSource(true);
  assert.deepEqual(plain(s.currentStageLocalMedia()), cached);
});