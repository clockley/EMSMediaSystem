import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PIDController } from "../src/shared/app-controls-utils.mjs";
import {
  HAVE_NOTHING,
  waitForMetadata,
} from "../src/shared/app-media-loading-utils.mjs";
import {
  localPathToFileUrl,
  pathToMediaUrl,
} from "../src/shared/app-media-utils.mjs";
import { createYouTubeResolutionRegistry } from "../src/main-process/youtube-live-session.mjs";

test("local media URLs encode reserved filename characters on every supported path form", () => {
  assert.equal(
    localPathToFileUrl("/tmp/Sunday #1?.mp4"),
    "file:///tmp/Sunday%20%231%3F.mp4",
  );
  assert.equal(
    localPathToFileUrl("C:\\Media\\Sunday #1?.mp4"),
    "file:///C:/Media/Sunday%20%231%3F.mp4",
  );
  assert.equal(
    localPathToFileUrl("\\\\media-server\\share\\a#b.mp4"),
    "file://media-server/share/a%23b.mp4",
  );
  const cacheBusted = pathToMediaUrl("/tmp/a?b#c.mp4", "revision #1");
  const parsed = new URL(cacheBusted);
  assert.equal(parsed.pathname, "/tmp/a%3Fb%23c.mp4");
  assert.equal(parsed.searchParams.get("v"), "revision #1");
  assert.equal(parsed.hash, "");
});

class FakeMediaElement {
  constructor() {
    this.src = "file:///broken.mp4";
    this.readyState = HAVE_NOTHING;
    this.error = { code: 4, message: "unsupported" };
    this.listeners = new Map();
  }

  addEventListener(name, callback) {
    const callbacks = this.listeners.get(name) || new Set();
    callbacks.add(callback);
    this.listeners.set(name, callbacks);
  }

  removeEventListener(name, callback) {
    this.listeners.get(name)?.delete(callback);
  }

  load() {}

  emit(name) {
    for (const callback of [...(this.listeners.get(name) || [])]) {
      callback({ type: name, target: this });
    }
  }
}

test("metadata load errors run rejection cleanup exactly once", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout };
  try {
    const media = new FakeMediaElement();
    let cleanupCalls = 0;
    const result = waitForMetadata(media, {
      onRejected(event, error, rejectedMedia) {
        cleanupCalls += 1;
        assert.equal(event.type, "error");
        assert.equal(error.name, "MediaMetadataError");
        assert.equal(rejectedMedia, media);
      },
    });
    media.emit("error");
    media.emit("error");
    await assert.rejects(result, { name: "MediaMetadataError" });
    assert.equal(cleanupCalls, 1);
    assert.equal(media.listeners.get("loadedmetadata")?.size, 0);
    assert.equal(media.listeners.get("canplaythrough")?.size, 0);
    assert.equal(media.listeners.get("error")?.size, 0);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("PID metrics use exactly the latest analysis window and reset all history", () => {
  const video = { playbackRate: 1 };
  const controller = new PIDController(video, {
    isActiveMediaWindow: () => true,
  });
  for (let index = 0; index < 32; index += 1) {
    controller.updateSystemMetrics(1, index * 16);
  }
  assert.equal(controller._rollingSum, 10);
  assert.equal(controller._rollingSquareSum, 10);
  assert.equal(controller._rollingTrend, 0);
  assert.equal(controller.avgResponseTime, 0.016);

  controller.reset();
  assert.equal(controller.historySize, 0);
  assert.equal(controller._rollingSum, 0);
  assert.equal(controller._rollingSquareSum, 0);
  assert.equal(controller._rollingTrend, 0);
  assert.ok(controller.timeArray.every((value) => value === 0));
  assert.ok(controller.diffArray.every((value) => value === 0));
  assert.ok(controller.responseArray.every((value) => value === 0));
});

test("YouTube resolution ownership is latest-request-wins per renderer", () => {
  const registry = createYouTubeResolutionRegistry();
  const control = {};
  const audience = {};
  const first = registry.begin(control);
  const audienceRequest = registry.begin(audience);
  const second = registry.begin(control);

  assert.equal(registry.isCurrent(control, first), false);
  assert.equal(registry.isCurrent(control, second), true);
  assert.equal(registry.isCurrent(audience, audienceRequest), true);
  assert.equal(registry.complete(control, first, "ios-live"), false);
  assert.equal(registry.complete(control, second, "browser"), true);
  assert.equal(registry.value(control, second), "browser");
  assert.equal(registry.value(control, first), undefined);
  registry.invalidate(control);
  assert.equal(registry.isCurrent(control, second), false);
  assert.equal(registry.isCurrent(audience, audienceRequest), true);
});

test("alert-only mode tears down all content resources but leaves compositor layers intact", async () => {
  const source = await readFile(
    new URL("../src/media-window/media.mjs", import.meta.url),
    "utf8",
  );
  const teardown = source.slice(
    source.indexOf("function teardownAudienceContent()"),
    source.indexOf("function activateTextTarget", source.indexOf("function teardownAudienceContent()")),
  );
  for (const call of [
    "closePreviewRtcPeer()",
    "teardownTextPresentation()",
    "teardownPptxViewer()",
    "teardownImageElement()",
    "teardownVideoElement()",
  ]) {
    assert.match(teardown, new RegExp(call.replace(/[()]/g, "\\$&")));
  }
  assert.doesNotMatch(teardown, /renderAudienceAlert|renderLiveBackground/);

  const handler = source.slice(
    source.indexOf('ipcRenderer.on("audience-enter-alert-only"'),
    source.indexOf("setInterval", source.indexOf('ipcRenderer.on("audience-enter-alert-only"')),
  );
  assert.match(handler, /teardownAudienceContent\(\)/);
});

test("YouTube session headers are committed only through current ownership tokens", async () => {
  const [main, preview, audience] = await Promise.all([
    readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/control-window/app-network-preview.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/media-window/media.mjs", import.meta.url), "utf8"),
  ]);
  const resolver = main.slice(
    main.indexOf("async function resolveYouTubeStream(url)"),
    main.indexOf("async function handleResolveYouTubeStream", main.indexOf("async function resolveYouTubeStream(url)")),
  );
  assert.doesNotMatch(resolver, /youtubeLiveSessions\.set/);
  assert.match(main, /youtubeResolutionRequests\.isCurrent\(sender, token\)/);
  assert.match(preview, /invoke\("commit-youtube-session-mode"/);
  assert.match(audience, /ipcRenderer\.invoke\("commit-youtube-session-mode"/);
});
