import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PIDController } from '../src/shared/app-controls-utils.mjs';

// Production uses the built import; exercise the source with the real PID.
const source = (await readFile(new URL('../src/shared/stage-video-sync.mjs', import.meta.url), 'utf8'))
  .replace("'./app-controls-utils.min.mjs'", JSON.stringify(new URL('../src/shared/app-controls-utils.mjs', import.meta.url).href));
const { createStageVideoSync } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

class Video extends EventTarget {
  constructor() {
    super();
    Object.assign(this, {
      src: '', srcObject: {}, currentTime: 0, duration: 100,
      readyState: 1, paused: true, seeking: false, muted: false,
      defaultMuted: false, volume: 1, playbackRate: 1,
      loads: 0, plays: 0, pauses: 0, seeks: [], listeners: new Set(),
    });
    this.position = 0;
  }
  get currentTime() { return this.position; }
  set currentTime(value) {
    this.position = value;
    this.seeks?.push(value);
  }
  addEventListener(type, fn) {
    super.addEventListener(type, fn);
    this.listeners.add(fn);
  }
  removeEventListener(type, fn) {
    super.removeEventListener(type, fn);
    this.listeners.delete(fn);
  }
  emit(type) { this.dispatchEvent(new Event(type)); }
  load() { this.loads++; }
  pause() { this.pauses++; this.paused = true; }
  play() {
    this.plays++;
    if (this.playImpl) return this.playImpl();
    this.paused = false;
    return Promise.resolve();
  }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
}

const descriptor = {
  url: 'ems-media://video/one.mp4', playbackId: 'play-1',
  audienceSessionId: 'audience-1', sourceGeneration: 1,
};
function playback(overrides = {}) {
  return {
    playbackId: descriptor.playbackId,
    audienceSessionId: descriptor.audienceSessionId,
    sourceGeneration: descriptor.sourceGeneration,
    playing: true, currentTime: 10, syncPhase: 'stable', ...overrides,
  };
}
function setup({ realPID = false, ...overrides } = {}) {
  const video = new Video();
  const calls = [];
  let time = 0;
  class SpyPID {
    constructor(element, callbacks) {
      assert.equal(element, video);
      assert.equal(callbacks.isActiveMediaWindow(), true);
    }
    reset() { calls.push(['reset']); }
    adjustPlaybackRate(target) { calls.push(['adjust', target]); video.playbackRate = 1.05; }
  }
  const sync = createStageVideoSync({
    video, ...(realPID ? {} : { PID: SpyPID }), now: () => time, ...overrides,
  });
  sync.setSource(descriptor);
  return { video, sync, calls, advance: ms => { time += ms; } };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function deferPlay(video) {
  let resolve;
  let reject;
  video.playImpl = () => new Promise((yes, no) => {
    resolve = () => { video.paused = false; yes(); };
    reject = no;
  });
  return { resolve: () => resolve(), reject: () => reject(new Error('interrupted')) };
}

test('same identity never reloads, including repeated descriptor/playback updates', () => {
  const { video, sync } = setup();
  for (let i = 0; i < 5; i++) {
    assert.equal(sync.setSource({ ...descriptor, currentTime: 90, playing: false }), false);
    sync.receive(playback());
  }
  assert.equal(video.loads, 1);
  assert.equal(video.plays, 1);
  assert.equal(video.srcObject, null);
});

for (const [field, value] of Object.entries({
  url: 'ems-media://video/two.mp4', playbackId: 'play-2',
  audienceSessionId: 'audience-2', sourceGeneration: 2,
})) {
  test(`source key includes ${field} and resets playback rate`, () => {
    const { video, sync } = setup();
    video.playbackRate = 1.2;
    assert.equal(sync.setSource({ ...descriptor, [field]: value }), true);
    assert.equal(video.loads, 2);
    assert.equal(video.playbackRate, 1);
    assert.equal(video.paused, true);
  });
}

test('startup seeks, then each small-drift update uses the injected PID', () => {
  const { video, sync, calls, advance } = setup();
  sync.receive(playback());
  assert.deepEqual(video.seeks, [10]);
  video.position = 10.1;
  advance(200);
  sync.receive(playback({ currentTime: 10.2 }));
  advance(100);
  sync.receive(playback({ currentTime: 10.3 }));
  assert.deepEqual(calls.filter(([kind]) => kind === 'adjust'), [
    ['adjust', 10], ['adjust', 10.2], ['adjust', 10.3],
  ]);
  assert.deepEqual(video.seeks, [10]);
  assert.equal(video.playbackRate, 1.05);
});

test('real PID is the default and hard-seeks offsets over one second', () => {
  const { video, sync, advance } = setup({ realPID: true });
  sync.receive(playback());
  video.position = 8;
  advance(100);
  sync.receive(playback({ currentTime: 10.1 }));
  assert.equal(video.currentTime, 10.1);
  assert.equal(video.playbackRate, 1);
  video.playbackRate = 1.2;
  sync.receive(playback({ playing: false, currentTime: 10.1 }));
  assert.equal(video.playbackRate, 1);
});

test('ordinary sub-second drift remains PID work, not a startup seek', () => {
  const { video, sync, advance } = setup();
  sync.receive(playback());
  video.position = 9.6;
  advance(100);
  sync.receive(playback({ currentTime: 10.1 }));
  assert.deepEqual(video.seeks, [10]);
});

test('real PID corrects small drift by rate without seeking', () => {
  const { video, sync, advance } = setup({ realPID: true });
  sync.receive(playback());
  advance(100);
  video.position = 10;
  sync.receive(playback({ currentTime: 10.1 }));
  advance(100);
  video.position = 10.1;
  sync.receive(playback({ currentTime: 10.2 }));
  assert.ok(video.playbackRate > 1 && video.playbackRate <= 1.2);
  assert.deepEqual(video.seeks, [10]);
});

test('resume and timeline discontinuities over 0.25 seconds hard-seek', () => {
  const { video, sync } = setup();
  sync.receive(playback({ playing: false }));
  sync.receive(playback({ currentTime: 10.5 }));
  assert.equal(video.currentTime, 10.5);
  sync.receive(playback({ currentTime: 11 }));
  assert.equal(video.currentTime, 11);
  assert.equal(video.plays, 1);
});

test('explicit seeks apply precisely while paused and playing', () => {
  const { video, sync } = setup();
  sync.receive(playback({ playing: false }));
  sync.receive(playback({ playing: false, currentTime: 10.1, positionIntent: 'explicit-seek' }));
  assert.equal(video.currentTime, 10.1);
  assert.equal(video.paused, true);
  assert.equal(video.playbackRate, 1);
  sync.receive(playback({ currentTime: 10.2, positionIntent: 'explicit-seek' }));
  assert.equal(video.currentTime, 10.2);
  assert.equal(video.plays, 1);
});

test('all stable pauses and ended states are authoritative without explicit pause intent', () => {
  const { video, sync } = setup();
  sync.receive(playback());
  sync.receive(playback({ playing: false, currentTime: 11, pauseIntent: 'incidental' }));
  assert.equal(video.paused, true);
  assert.equal(video.currentTime, 11);
  assert.equal(video.playbackRate, 1);
  sync.receive(playback({ playing: true, ended: true, currentTime: 100 }));
  assert.equal(video.paused, true);
  assert.equal(video.currentTime, 100);
  assert.equal(video.plays, 1);
});

test('pending metadata retains only the newest stable update and never extrapolates a pause', () => {
  const { video, sync, advance } = setup();
  video.readyState = 0;
  sync.receive(playback());
  advance(1000);
  sync.receive(playback({ currentTime: 20 }));
  sync.receive(playback({ playing: false, currentTime: 21 }));
  assert.equal(sync.receive(playback({ syncPhase: 'stabilizing', currentTime: 0 })), false);
  assert.equal(video.plays, 0);
  advance(30000);
  video.readyState = 1;
  video.emit('loadedmetadata');
  video.emit('canplay');
  assert.equal(video.currentTime, 21);
  assert.equal(video.paused, true);
  assert.equal(video.plays, 0);
});

test('canplay applies the latest retained playing position without a stale elapsed prediction', () => {
  const { video, sync, advance } = setup();
  video.readyState = 0;
  sync.receive(playback());
  advance(2000);
  sync.receive(playback({ currentTime: 12 }));
  advance(100000);
  video.readyState = 1;
  video.emit('canplay');
  assert.equal(video.currentTime, 12);
  assert.equal(video.plays, 1);
});

test('unapplied explicit seek survives newer stable updates before metadata', () => {
  const { video, sync } = setup();
  video.readyState = 0;
  sync.receive(playback({ currentTime: 0.1, positionIntent: 'explicit-seek' }));
  sync.receive(playback({ currentTime: 0.15 }));
  video.readyState = 1;
  video.emit('loadedmetadata');
  assert.equal(video.currentTime, 0.15);
  assert.equal(video.plays, 1);
});

test('stabilizing browser churn cannot pause or resume a stable follower', () => {
  const { video, sync } = setup();
  sync.receive(playback());
  sync.receive(playback({ playing: false, syncPhase: 'stabilizing', currentTime: 0 }));
  assert.equal(video.paused, false);
  assert.equal(video.currentTime, 10);
  sync.receive(playback({ playing: false }));
  sync.receive(playback({ syncPhase: 'stabilizing' }));
  assert.equal(video.paused, true);
});

test('stale playback ID, alias, session, generation and URL are rejected without side effects', () => {
  const { video, sync } = setup();
  sync.receive(playback({ playing: false }));
  for (const patch of [
    { playbackId: 'old' }, { audiencePlaybackId: 'old' },
    { audienceSessionId: 'old' }, { sourceGeneration: 0 },
    { url: 'old' }, { playbackId: undefined }, { audienceSessionId: undefined },
    { sourceGeneration: undefined }, { currentTime: NaN }, { playing: undefined },
  ]) assert.equal(sync.receive(playback({ ...patch, currentTime: patch.currentTime ?? 90 })), false);
  assert.equal(video.currentTime, 10);
  assert.equal(video.plays, 0);
  assert.equal(sync.receive(playback({ playbackId: undefined, audiencePlaybackId: 'play-1' })), true);
  assert.equal(video.plays, 1);
});

test('pending play is requested once and a late resolution cannot undo a pause', async () => {
  const { video, sync } = setup();
  const pending = deferPlay(video);
  sync.receive(playback());
  sync.receive(playback());
  video.emit('canplay');
  assert.equal(video.plays, 1);
  sync.receive(playback({ playing: false, currentTime: 11 }));
  pending.resolve();
  await flush();
  assert.equal(video.paused, true);
  assert.equal(video.playbackRate, 1);
  video.emit('loadedmetadata');
  assert.equal(video.plays, 1);
});

test('pending play followed by pause/resume uses current intent on settlement', async () => {
  const { video, sync } = setup();
  const pending = deferPlay(video);
  sync.receive(playback());
  sync.receive(playback({ playing: false }));
  sync.receive(playback());
  assert.equal(video.plays, 1);
  pending.resolve();
  await flush();
  assert.equal(video.paused, false);
});

test('old source play resolution cannot resume a replacement awaiting stable playback', async () => {
  const { video, sync } = setup();
  const pending = deferPlay(video);
  sync.receive(playback());
  sync.setSource({ ...descriptor, sourceGeneration: 2 });
  pending.resolve();
  await flush();
  assert.equal(video.paused, true);
  assert.equal(video.loads, 2);
  assert.equal(sync.receive(playback()), false);
});

test('old play settlement cannot cancel a newer source pending play token', async () => {
  const { video, sync } = setup();
  const old = deferPlay(video);
  sync.receive(playback());
  sync.setSource({ ...descriptor, sourceGeneration: 2 });
  const current = deferPlay(video);
  sync.receive(playback({ sourceGeneration: 2 }));
  old.resolve();
  await flush();
  video.paused = true;
  sync.receive(playback({ sourceGeneration: 2 }));
  assert.equal(video.plays, 2);
  current.resolve();
  await flush();
  assert.equal(video.paused, false);
});

test('play rejections and synchronous failures are consumed; later updates may retry', async () => {
  const { video, sync } = setup();
  const pending = deferPlay(video);
  sync.receive(playback());
  pending.reject();
  await flush();
  video.playImpl = () => { throw new Error('not ready'); };
  sync.receive(playback());
  video.playImpl = undefined;
  sync.receive(playback());
  assert.equal(video.plays, 3);
  assert.equal(video.paused, false);
});

test('clear detaches source/listeners, invalidates playback, and allows reuse', async () => {
  const { video, sync } = setup();
  const pending = deferPlay(video);
  sync.receive(playback());
  sync.clear();
  assert.equal(video.src, '');
  assert.equal(video.srcObject, null);
  assert.equal(video.loads, 2);
  assert.equal(video.listeners.size, 0);
  assert.equal(video.playbackRate, 1);
  assert.equal(sync.receive(playback()), false);
  pending.resolve();
  await flush();
  assert.equal(video.paused, true);
  video.emit('canplay');
  assert.equal(video.plays, 1);
  sync.setSource(descriptor);
  assert.ok(video.listeners.size > 0);
  video.playImpl = undefined;
  sync.receive(playback());
  assert.equal(video.paused, false);
});

test('dispose is terminal, removes listeners, and defeats pending play resolution', async () => {
  const { video, sync } = setup();
  const pending = deferPlay(video);
  sync.receive(playback());
  sync.dispose();
  const loads = video.loads;
  sync.dispose();
  assert.equal(sync.setSource(descriptor), false);
  assert.equal(sync.receive(playback()), false);
  assert.equal(video.loads, loads);
  assert.equal(video.listeners.size, 0);
  assert.equal(video.src, '');
  assert.equal(video.srcObject, null);
  pending.resolve();
  await flush();
  assert.equal(video.paused, true);
});

test('muted/defaultMuted/zero volume are enforced through updates, audio churn and cleanup', () => {
  const { video, sync } = setup();
  function silent() {
    assert.equal(video.muted, true);
    assert.equal(video.defaultMuted, true);
    assert.equal(video.volume, 0);
  }
  silent();
  video.muted = false;
  video.defaultMuted = false;
  video.volume = 1;
  video.emit('volumechange');
  silent();
  sync.receive(playback());
  silent();
  sync.clear();
  silent();
  sync.dispose();
  silent();
});

test('positions are clamped and a failed metadata seek is retried on canplay', () => {
  const { video, sync } = setup();
  let blocked = true;
  Object.defineProperty(video, 'currentTime', {
    get: () => video.position,
    set: value => {
      if (blocked) throw new Error('metadata not seekable yet');
      video.position = value;
    },
  });
  sync.receive(playback({ currentTime: 200 }));
  assert.equal(video.plays, 0);
  blocked = false;
  video.emit('canplay');
  assert.equal(video.currentTime, 100);
  sync.receive(playback({ playing: false, currentTime: -10 }));
  assert.equal(video.currentTime, 0);
});