import test from "node:test";
import assert from "node:assert/strict";

import { PIDController } from "../src/shared/app-controls-utils.mjs";

function playingVideo(overrides = {}) {
  return {
    currentTime: 0,
    playbackRate: 1,
    paused: false,
    seeking: false,
    ...overrides,
  };
}

test("PID startup sync seeks a large cue offset instead of speeding up", () => {
  const video = playingVideo({ currentTime: 0, playbackRate: 1.75 });
  let suppressions = 0;
  const controller = new PIDController(video, {
    isActiveMediaWindow: () => true,
    beginPidSeekSuppression: () => {
      suppressions += 1;
    },
  });

  controller.adjustPlaybackRate(42);

  assert.equal(video.currentTime, 42);
  assert.equal(video.playbackRate, 1);
  assert.equal(suppressions, 1);
});

test("PID steady sync seeks a large discontinuity at normal speed", () => {
  const video = playingVideo({ currentTime: 12 });
  let suppressions = 0;
  const controller = new PIDController(video, {
    isActiveMediaWindow: () => true,
    beginPidSeekSuppression: () => {
      suppressions += 1;
    },
  });

  controller.adjustPlaybackRate(12);
  controller.adjustPlaybackRate(30);

  assert.equal(video.currentTime, 30);
  assert.equal(video.playbackRate, 1);
  assert.equal(suppressions, 1);
});

test("PID reset restores normal playback speed", () => {
  const video = playingVideo({ playbackRate: 1.5 });
  const controller = new PIDController(video, {
    isActiveMediaWindow: () => true,
  });

  controller.reset();

  assert.equal(video.playbackRate, 1);
});
