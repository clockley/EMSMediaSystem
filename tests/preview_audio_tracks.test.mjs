import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { syncPreviewMediaAudioTracks } from "../src/shared/preview-audio-tracks.mjs";

class TrackList extends EventTarget {
  constructor(...tracks) {
    super();
    this.length = tracks.length;
    tracks.forEach((track, index) => { this[index] = track; });
  }

  add(track) {
    this[this.length++] = track;
    this.dispatchEvent(new Event("addtrack"));
  }
}

function previewElement(...tracks) {
  const el = new EventTarget();
  el.audioTracks = new TrackList(...tracks);
  el.muted = false;
  return el;
}

test("new preview tracks inherit the disabled state after source changes", () => {
  const first = { enabled: true };
  const preview = previewElement(first);
  syncPreviewMediaAudioTracks(preview, false);
  assert.equal(first.enabled, false);

  const late = { enabled: true };
  preview.audioTracks.add(late);
  assert.equal(late.enabled, false);

  const replacement = { enabled: true };
  preview.audioTracks = new TrackList(replacement);
  preview.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(replacement.enabled, false);

  syncPreviewMediaAudioTracks(preview, true);
  assert.equal(replacement.enabled, true);
});

test("restoring preview audio preserves the selected track", () => {
  const selected = { enabled: true };
  const alternate = { enabled: false };
  const preview = previewElement(selected, alternate);

  syncPreviewMediaAudioTracks(preview, false);
  syncPreviewMediaAudioTracks(preview, false);
  const late = { enabled: false };
  preview.audioTracks.add(late);
  syncPreviewMediaAudioTracks(preview, true);

  assert.deepEqual(
    [selected.enabled, alternate.enabled, late.enabled],
    [true, false, false],
  );
});

test("presenting audio or video disables every preview audio track", async () => {
  const source = await readFile(
    new URL("../src/control-window/app-media-runtime.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("function previewAudioCueShouldBeAudible()");
  const end = source.indexOf("function syncPreviewMediaAfterPresentationStateChange()", start);
  assert.ok(start >= 0 && end > start);

  const mainTrack = { enabled: true };
  const audioCueTrack = { enabled: true };
  const videoCueTrack = { enabled: true };
  const context = {
    video: previewElement(mainTrack),
    previewAudio: previewElement(audioCueTrack),
    previewCueVideo: previewElement(videoCueTrack),
    previewAudioCueIndex: 1,
    pendingCueVolume: 1,
    presentationActive: false,
    currentPreviewCue: () => ({ index: 1, item: { type: "audio" } }),
    isQueueItemAudio: (item) => item.type === "audio",
    activePresentationOwnsPreviewAudio: () => context.presentationActive,
    networkPreviewUsesRendererCapture: () => false,
    shouldSuppressPreviewForwarding: () => false,
    syncPreviewMediaAudioTracks,
  };
  const sync = vm.runInNewContext(
    `${source.slice(start, end)}\n({ syncPreviewAudioTrackState, syncPreviewAudioCueAudibility })`,
    context,
  );

  sync.syncPreviewAudioTrackState();
  sync.syncPreviewAudioCueAudibility();
  assert.deepEqual([mainTrack.enabled, audioCueTrack.enabled, videoCueTrack.enabled], [true, true, true]);

  context.presentationActive = true;
  sync.syncPreviewAudioTrackState();
  assert.deepEqual([mainTrack.enabled, audioCueTrack.enabled, videoCueTrack.enabled], [false, false, false]);
  assert.equal(context.video.muted, false);

  const lateVideoCueTrack = { enabled: true };
  context.previewCueVideo.audioTracks.add(lateVideoCueTrack);
  assert.equal(lateVideoCueTrack.enabled, false);

  context.presentationActive = false;
  sync.syncPreviewAudioTrackState();
  sync.syncPreviewAudioCueAudibility();
  assert.deepEqual([mainTrack.enabled, audioCueTrack.enabled, videoCueTrack.enabled], [true, true, true]);
});

test("loading a video cue during presentation disables its track even if muted is false", async () => {
  const source = await readFile(
    new URL("../src/control-window/app-presentation-playback.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("function setPreviewCueVideoLocalAudio(");
  const end = source.indexOf("async function loadVideoQueueItemIntoPreviewCueOverlay(", start);
  assert.ok(start >= 0 && end > start);

  const track = { enabled: true };
  const cueVideo = previewElement(track);
  const context = {
    previewCueVideo: cueVideo,
    pendingCueVolume: 1,
    activePresentationOwnsPreviewAudio: () => true,
    getPreviewCueDisplayVolume: () => 1,
    disableNativeVideoControls() {},
    syncPreviewMediaAudioTracks,
  };
  const setLocalAudio = vm.runInNewContext(
    `${source.slice(start, end)}\nsetPreviewCueVideoLocalAudio`,
    context,
  );
  setLocalAudio(cueVideo);

  assert.equal(cueVideo.muted, false);
  assert.equal(track.enabled, false);
});
