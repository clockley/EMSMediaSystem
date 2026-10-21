import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
  PlaybackTransitionCoordinator,
  createAudiencePlaybackId,
} from "../src/shared/playback-transition-coordinator.mjs";

const mediaSource = await readFile(
  new URL("../src/media-window/media.mjs", import.meta.url),
  "utf8",
);
const mainSource = await readFile(
  new URL("../src/main-process/main.mjs", import.meta.url),
  "utf8",
);

function declaredFunction(name) {
  const match = mediaSource.match(
    new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"),
  );
  assert.ok(match, `media renderer declares ${name}`);
  return match[0];
}

test("a transition follows its queue item through insertion and reordering", () => {
  const coordinator = new PlaybackTransitionCoordinator();
  const first = { id: "first" };
  const target = { id: "target" };
  const last = { id: "last" };
  const queue = [first, target, last];
  const token = coordinator.begin(target, { startTime: 12 });

  queue.unshift({ id: "inserted" });
  assert.equal(coordinator.indexOf(token, queue), 2);

  queue.splice(0, queue.length, target, last, first);
  assert.equal(coordinator.indexOf(token, queue), 0);
  assert.equal(token.startTime, 12);
});

test("cancellation invalidates in-flight and pending close/reopen work", () => {
  const coordinator = new PlaybackTransitionCoordinator();
  const target = { id: "target" };
  const queue = [{ id: "first" }, target];
  const token = coordinator.begin(target, { startTime: 7 });

  assert.equal(coordinator.setPendingClose(token), true);
  coordinator.cancel();

  assert.equal(coordinator.owns(token), false);
  assert.equal(coordinator.pendingCloseItem(), null);
  assert.equal(coordinator.consumePendingClose(queue), null);
});

test("pending close/reopen resolves the target by identity, not its old index", () => {
  const coordinator = new PlaybackTransitionCoordinator();
  const before = { id: "before" };
  const target = { id: "target" };
  const queue = [before, target];
  const token = coordinator.begin(target, { startTime: 5 });
  coordinator.setPendingClose(token);

  queue.shift();
  const pending = coordinator.consumePendingClose(queue);

  assert.equal(pending.item, target);
  assert.equal(pending.index, 0);
  assert.equal(pending.startTime, 5);
});

test("end events are claimed once by playback identity, even for the same path", () => {
  const coordinator = new PlaybackTransitionCoordinator();
  const first = { playbackId: "playback-1", mediaFile: "same.mp4" };
  const second = { playbackId: "playback-2", mediaFile: "same.mp4" };

  coordinator.activatePlayback(first.playbackId);
  assert.equal(coordinator.claimPlaybackEnd(first), true);
  assert.equal(coordinator.claimPlaybackEnd(first), false);

  coordinator.activatePlayback(second.playbackId);
  assert.equal(coordinator.claimPlaybackEnd(first), false);
  assert.equal(coordinator.claimPlaybackEnd(second), true);
  assert.equal(coordinator.claimPlaybackEnd(second), false);
});

test("audience playback identities are unique", () => {
  assert.notEqual(createAudiencePlaybackId(), createAudiencePlaybackId());
});

test("a rejected media play is returned as an activation failure", async () => {
  const reported = [];
  const context = vm.createContext({
    liveStreamMode: false,
    video: {
      play: async () => {
        throw new Error("decoder rejected playback");
      },
    },
    reportProjectionError(message, error) {
      reported.push([message, error.message]);
    },
    markPlaybackStateStable() {},
    playbackStateUpdate() {},
  });
  vm.runInContext(declaredFunction("playVideoWithStartupBuffer"), context);

  const started = await vm.runInContext(
    'playVideoWithStartupBuffer("Could not start")',
    context,
  );

  assert.equal(started, false);
  assert.deepEqual(reported, [["Could not start", "decoder rejected playback"]]);
});

test("stale video end handlers cannot report the replacement playback", () => {
  const sent = [];
  const video = {
    ended: false,
    loop: false,
    currentTime: 0,
    duration: 10,
    onended: null,
  };
  const context = vm.createContext({
    video,
    videoSourceGeneration: 1,
    audiencePlaybackId: "playback-1",
    audienceSessionId: "session-1",
    mediaFile: "same.mp4",
    loopFile: false,
    tracePlayback() {},
    setProjectionVideoVisible() {},
    ipcRenderer: {
      send(channel, payload) {
        sent.push([channel, payload]);
      },
    },
  });
  vm.runInContext(declaredFunction("bindProjectionVideoEndHandler"), context);
  vm.runInContext("bindProjectionVideoEndHandler()", context);
  const staleHandler = video.onended;

  context.videoSourceGeneration = 2;
  context.audiencePlaybackId = "playback-2";
  video.ended = true;
  staleHandler();
  assert.deepEqual(sent, []);

  vm.runInContext("bindProjectionVideoEndHandler()", context);
  video.onended();
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], "media-playback-ended");
  assert.equal(sent[0][1].playbackId, "playback-2");
  assert.equal(sent[0][1].sourceGeneration, 2);
});

test("main process rejects playback IPC from a non-active audience renderer", () => {
  assert.match(
    mainSource,
    /event\.sender !== mediaWindow\.webContents/,
  );
  assert.match(
    mainSource,
    /endedMediaFile\?\.audienceSessionId[\s\S]*?endedMediaFile\.audienceSessionId !== audienceSessionId/,
  );
});

test("fresh audience creation waits for renderer activation", () => {
  const loadIndex = mediaSource.indexOf("await loadMedia();", mediaSource.indexOf("async function bootstrapMediaWindow"));
  const readyIndex = mediaSource.indexOf(
    'ipcRenderer.send("audience-output-ready"',
    loadIndex,
  );
  assert.ok(loadIndex >= 0, "audience bootstrap awaits media loading");
  assert.ok(readyIndex > loadIndex, "ready is emitted only after media activation");
  assert.match(mainSource, /await bootstrapResult;/);
  assert.match(mainSource, /audience-output-failed/);
});
