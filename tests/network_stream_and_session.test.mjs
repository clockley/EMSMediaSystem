import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { MediaWatcher } from "../src/main-process/media-watcher.mjs";
import { createYouTubeLiveSessionRegistry } from "../src/main-process/youtube-live-session.mjs";

const mediaWindowSource = await readFile(
  new URL("../src/media-window/media.mjs", import.meta.url),
  "utf8",
);
const networkPreviewSource = await readFile(
  new URL("../src/control-window/app-network-preview.mjs", import.meta.url),
  "utf8",
);
const thumbnailSource = await readFile(
  new URL("../sidecars/media-library-rpc/thumbnail.go", import.meta.url),
  "utf8",
);

test("audience network playback routes direct HLS and DASH to their matching players", () => {
  const start = mediaWindowSource.indexOf("async function startLiveStreamPlayback(url)");
  const end = mediaWindowSource.indexOf("\n/**", start + 1);
  assert.ok(start >= 0 && end > start);
  const implementation = mediaWindowSource.slice(start, end);

  assert.match(
    implementation,
    /else if \(isDirectHlsStream\(url\)\)[\s\S]*?hlsInstance\.loadSource\(url\)/,
  );
  assert.match(
    implementation,
    /else if \(isDirectDashStream\(url\)\)[\s\S]*?dashPlayer\.initialize\(video, url, false\)/,
  );
});

test("network scheduling only accepts protocols with an in-process playback backend", () => {
  assert.match(
    networkPreviewSource,
    /const NETWORK_ITEM_PROTOCOLS = new Set\(\["http:", "https:"\]\)/,
  );
  assert.doesNotMatch(networkPreviewSource, /Use an HTTP, HTTPS, RTSP, or RTMP URL/);
});

test("YouTube live header state is isolated by Electron session", () => {
  const registry = createYouTubeLiveSessionRegistry();
  const controlSession = {};
  const presentationSession = {};

  registry.set(presentationSession, true);
  registry.set(controlSession, false);
  assert.equal(registry.has(presentationSession), true);
  assert.equal(registry.has(controlSession), false);

  registry.set(controlSession, true);
  registry.set(presentationSession, false);
  assert.equal(registry.has(controlSession), true);
  assert.equal(registry.has(presentationSession), false);
});

test("media watcher routes merged notifications by queue item ID, independent of path case", () => {
  const notifications = [];
  const watcher = new MediaWatcher({
    app: {},
    devRoot: "/tmp",
    sendToRenderer: (channel, payload) => notifications.push({ channel, payload }),
  });
  const upperPath = path.resolve("/tmp/Media.mp4");
  const lowerPath = path.resolve("/tmp/media.mp4");
  watcher.addItem({ queueItemId: "upper", originalPath: upperPath, pending: false });
  watcher.addItem({ queueItemId: "lower", originalPath: lowerPath, pending: false });

  watcher.handleSidecarChanged({
    originalPath: upperPath,
    queueItemIds: ["upper", "lower"],
    status: "missing",
  });

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].channel, "media-source-changed");
  assert.deepEqual(notifications[0].payload.queueItemIds, ["upper", "lower"]);
});

test("media watcher delegates on-demand XXH3 hashing to its sidecar", async () => {
  const watcher = new MediaWatcher({
    app: {},
    devRoot: "/tmp",
    sendToRenderer() {},
  });
  watcher.sidecar = {
    async hashFile(filePath) {
      assert.equal(filePath, "/tmp/media.mp4");
      return "9555e8555c62dcfd";
    },
  };

  assert.equal(await watcher.hashFile("/tmp/media.mp4"), "9555e8555c62dcfd");
});

test("media-library thumbnails no longer reference the removed KDE backend", () => {
  assert.doesNotMatch(thumbnailSource, /kde-video-poster|linuxPosterDesktop/);
  assert.match(thumbnailSource, /exec\.CommandContext\(ctx, "gjs", backend\)/);
});

test("a superseded preview negotiation cannot tear down the capture that replaced it", () => {
  const captureStart = networkPreviewSource.indexOf(
    "async function startNetworkPreviewRtcCapture()",
  );
  const captureEnd = networkPreviewSource.indexOf(
    "\nasync function handleMediaPreviewRtcSignal(",
    captureStart,
  );
  assert.ok(captureStart >= 0 && captureEnd > captureStart);
  const capture = networkPreviewSource.slice(captureStart, captureEnd);
  // Replacing a capture closes the outgoing peer, which rejects the offer it
  // still has in flight. Both the stale offer and the stale teardown have to
  // recognize that they no longer own the session.
  const offerGuard = capture.indexOf("if (networkPreviewRtcPeer !== peer) return false;");
  const offerSend = capture.indexOf('type: "offer"');
  const failureGuard = capture.indexOf(
    "if (networkPreviewRtcPeer !== peer) return false;",
    offerSend,
  );
  const teardown = capture.indexOf("stopNetworkPreviewRtcCapture();", failureGuard);
  assert.ok(offerGuard >= 0 && offerGuard < offerSend);
  assert.ok(failureGuard > offerSend && teardown > failureGuard);

  const peerStart = mediaWindowSource.indexOf("async function startPreviewRtcPeer(");
  const peerEnd = mediaWindowSource.indexOf(
    "\nasync function handlePreviewRtcSignal(",
    peerStart,
  );
  assert.ok(peerStart >= 0 && peerEnd > peerStart);
  const startPeer = mediaWindowSource.slice(peerStart, peerEnd);
  assert.match(startPeer, /const ownsPreviewRtcSession = \(\) =>/);
  // The answer is labelled with the offer it replies to, never with whichever
  // session happens to be current when it finishes.
  assert.match(startPeer, /sessionId: message\.sessionId,\n\s+sdp: peer\.localDescription/);
  const catchStart = startPeer.indexOf("} catch (err) {");
  const catchGuard = startPeer.indexOf("if (!ownsPreviewRtcSession()) return;", catchStart);
  const closePeer = startPeer.indexOf("closePreviewRtcPeer();", catchStart);
  assert.ok(catchStart >= 0 && catchGuard > catchStart && closePeer > catchGuard);
});
