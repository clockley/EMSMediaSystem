import assert from "node:assert/strict";
import test from "node:test";

import { MediaElementForwardingSuppression } from "../src/shared/media-element-forwarding-suppression.mjs";

class FakeMediaElement extends EventTarget {
  constructor() {
    super();
    this._currentTime = 0;
    this.duration = 120;
    this.paused = false;
    this.readyState = 4;
    this.seeking = false;
  }

  get currentTime() {
    return this._currentTime;
  }

  set currentTime(value) {
    this._currentTime = value;
    this.seeking = true;
  }

  pause() {
    this.paused = true;
  }
}

function createGuard(options = {}) {
  return new MediaElementForwardingSuppression({
    noSeekGraceMs: 10,
    pauseTimeoutMs: 80,
    seekTimeoutMs: 80,
    settleDelayMs: 5,
    ...options,
  });
}

function dispatch(mediaEl, eventName) {
  mediaEl.dispatchEvent(new Event(eventName));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("seek suppression is scoped to one element and seek events only", async () => {
  const guard = createGuard();
  const mirror = new FakeMediaElement();
  const other = new FakeMediaElement();
  const settled = guard.suppressSeek(mirror, 12);

  assert.equal(guard.shouldSuppress(mirror, "seeking"), true);
  assert.equal(guard.shouldSuppress(mirror, "pause"), false);
  assert.equal(guard.shouldSuppress(mirror, "play"), false);
  assert.equal(guard.shouldSuppress(other, "seeking"), false);

  dispatch(mirror, "seeking");
  mirror.seeking = false;
  dispatch(mirror, "seeked");
  assert.equal(await settled, "settled");
  assert.equal(guard.shouldSuppress(mirror, "seeked"), false);
});

test("a different operator seek cancels suppression before its event is handled", async () => {
  const guard = createGuard();
  const mirror = new FakeMediaElement();
  const settled = guard.suppressSeek(mirror, 12);

  mirror.currentTime = 38;
  assert.equal(
    guard.shouldSuppress(mirror, "seeking"),
    false,
    "the operator position must be forwarded",
  );
  assert.equal(await settled, "superseded");
});

test("a queued seeked without this operation's seeking cannot close the guard", async () => {
  const guard = createGuard();
  const mirror = new FakeMediaElement();
  const settled = guard.suppressSeek(mirror, 12);

  // This represents a seeked task that was queued before suppressSeek wrote
  // currentTime. The replacement seek is still active.
  dispatch(mirror, "seeked");
  await delay(10);
  assert.equal(guard.shouldSuppress(mirror, "seeked"), true);

  dispatch(mirror, "seeking");
  mirror.seeking = false;
  dispatch(mirror, "seeked");
  assert.equal(await settled, "settled");
});

test("a stale event pair cannot finish while the replacement seek is active", async () => {
  const guard = createGuard();
  const mirror = new FakeMediaElement();
  const settled = guard.suppressSeek(mirror, 12);

  dispatch(mirror, "seeking");
  dispatch(mirror, "seeked");
  await delay(15);
  assert.equal(
    guard.shouldSuppress(mirror, "seeked"),
    true,
    "mediaEl.seeking keeps the replacement operation owned",
  );

  dispatch(mirror, "seeking");
  mirror.seeking = false;
  dispatch(mirror, "seeked");
  assert.equal(await settled, "settled");
});

test("a newer sync seek supersedes the older operation", async () => {
  const guard = createGuard();
  const mirror = new FakeMediaElement();
  const first = guard.suppressSeek(mirror, 12);
  const second = guard.suppressSeek(mirror, 24);

  assert.equal(await first, "superseded");
  assert.equal(mirror.currentTime, 24);
  assert.equal(guard.shouldSuppress(mirror, "seeking"), true);

  dispatch(mirror, "seeking");
  mirror.seeking = false;
  dispatch(mirror, "seeked");
  assert.equal(await second, "settled");
});

test("pause suppression does not swallow simultaneous play or seek intent", async () => {
  const guard = createGuard();
  const mirror = new FakeMediaElement();
  const settled = guard.suppressPause(mirror);

  assert.equal(guard.shouldSuppress(mirror, "pause"), true);
  assert.equal(guard.shouldSuppress(mirror, "play"), false);
  assert.equal(guard.shouldSuppress(mirror, "seeking"), false);

  dispatch(mirror, "pause");
  assert.equal(await settled, "settled");
});

test("timeouts release an operation instead of leaving forwarding stuck", async () => {
  const guard = createGuard({ seekTimeoutMs: 15 });
  const mirror = new FakeMediaElement();
  const settled = guard.suppressSeek(mirror, 12);

  assert.equal(await settled, "timeout");
  assert.equal(guard.shouldSuppress(mirror, "seeking"), false);
});
