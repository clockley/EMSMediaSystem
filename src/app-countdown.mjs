/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

"use strict";

let countdownDeps = {
  getActiveMediaWindowContentType: () => null,
  getCurrentLiveQueueItem: () => null,
  getCurrentMode: () => -1,
  getCurrentPreviewCue: () => null,
  getLiveAudio: () => null,
  getLocalTimeStampUpdateIsRunning: () => false,
  getMediaFile: () => "",
  getPreviewAudio: () => null,
  getPreviewCueVideo: () => null,
  getSuppressPreviewForwarding: () => false,
  getVideo: () => null,
  hybridSync: () => {},
  isActiveMediaWindow: () => false,
  isAudioPreviewCueActive: () => false,
  isImg: () => false,
  isQueueItemImage: () => false,
  isVideoPreviewCueActive: () => false,
  mediaPathMatchesCurrentLiveMedia: () => true,
  mediaPlayerMode: 0,
  setLocalTimeStampUpdateIsRunning: () => {},
  setMediaCountdownOverlayVisible: () => {},
  setMediaCountdownText: () => {},
  setMediaCountdownFromCodes: () => {},
  setTargetTime: () => {},
};

export function configureCountdown(deps = {}) {
  countdownDeps = { ...countdownDeps, ...deps };
}

export function resetCountdownSync() {
  lastUpdateTime = 0;
}

function getActiveMediaWindowContentType() {
  return countdownDeps.getActiveMediaWindowContentType();
}

function getCurrentMode() {
  return countdownDeps.getCurrentMode();
}

function getCurrentLiveQueueItem() {
  return countdownDeps.getCurrentLiveQueueItem();
}

function getCurrentPreviewCue() {
  return countdownDeps.getCurrentPreviewCue();
}

function getLiveAudio() {
  return countdownDeps.getLiveAudio();
}

function getLocalTimeStampUpdateIsRunning() {
  return countdownDeps.getLocalTimeStampUpdateIsRunning();
}

function getMediaFile() {
  return countdownDeps.getMediaFile();
}

function getPreviewAudio() {
  return countdownDeps.getPreviewAudio();
}

function getPreviewCueVideo() {
  return countdownDeps.getPreviewCueVideo();
}

function getSuppressPreviewForwarding() {
  return countdownDeps.getSuppressPreviewForwarding();
}

function getVideo() {
  return countdownDeps.getVideo();
}

function hybridSync(targetTime) {
  return countdownDeps.hybridSync(targetTime);
}

function isActiveMediaWindow() {
  return countdownDeps.isActiveMediaWindow();
}

function isAudioPreviewCueActive() {
  return countdownDeps.isAudioPreviewCueActive();
}

function isImg(filePath) {
  return countdownDeps.isImg(filePath);
}

function isQueueItemImage(item) {
  return countdownDeps.isQueueItemImage(item);
}

function isVideoPreviewCueActive() {
  return countdownDeps.isVideoPreviewCueActive();
}

function mediaPathMatchesCurrentLiveMedia(filePath) {
  return countdownDeps.mediaPathMatchesCurrentLiveMedia(filePath);
}

function mediaPlayerMode() {
  return countdownDeps.mediaPlayerMode;
}

function setLocalTimeStampUpdateIsRunning(value) {
  countdownDeps.setLocalTimeStampUpdateIsRunning(value);
}

function setMediaCountdownOverlayVisible(value) {
  countdownDeps.setMediaCountdownOverlayVisible(value);
}

function setMediaCountdownText(value) {
  countdownDeps.setMediaCountdownText(value);
}

function setMediaCountdownFromCodes(codes) {
  countdownDeps.setMediaCountdownFromCodes(codes);
}

function setTargetTime(value) {
  countdownDeps.setTargetTime(value);
}

const SECONDSFLOAT = new Float64Array(1);
const NUM_BUFFER = new Int32Array(4);
const REM_BUFFER = new Int32Array(1);
const updatePending = new Int32Array(1);
let mask0, mask1, mask2, idx0, idx1, idx2;
let lastUpdateTimeLocalPlayer = 0;

function update(time) {
  // When getLiveAudio() is performing the live presentation, drive the countdown
  // timer from it instead of from the preview video element.
  const liveAudio = getLiveAudio();
  const video = getVideo();
  const activeEl = liveAudio?.paused === false ? liveAudio : video;
  if (!activeEl) {
    setLocalTimeStampUpdateIsRunning(false);
    return;
  }
  if (activeEl.paused | (getCurrentMode() !== mediaPlayerMode())) {
    setLocalTimeStampUpdateIsRunning(false);
    return;
  }

  // Same rule as handleTimeMessage: a loaded cue owns the countdown,
  // so the live-media RAF loop steps aside while the operator scrubs.
  // The loop itself keeps going (so it resumes painting immediately when
  // the cue is cleared) — only the NUM_BUFFER write is skipped.
  const cueOwnsCountdown =
    getCountdownSourceElement() !== null || isImagePreviewCueActive();
  if (!cueOwnsCountdown && time - lastUpdateTimeLocalPlayer > 33) {
    NUM_BUFFER[3] = activeEl.duration - activeEl.currentTime;

    NUM_BUFFER[0] = (NUM_BUFFER[3] * 0.000277777777778) | 0;
    NUM_BUFFER[1] =
      ((NUM_BUFFER[3] - NUM_BUFFER[0] * 3600) * 0.0166666666667) | 0;
    NUM_BUFFER[2] =
      (NUM_BUFFER[3] | 0) - NUM_BUFFER[0] * 3600 - NUM_BUFFER[1] * 60;
    NUM_BUFFER[3] = ((NUM_BUFFER[3] - (NUM_BUFFER[3] | 0)) * 1000) | 0;

    idx0 = NUM_BUFFER[0] << 1;
    mask0 = NUM_BUFFER[0] < 10;
    idx1 = NUM_BUFFER[1] << 1;
    mask1 = NUM_BUFFER[1] < 10;
    idx2 = NUM_BUFFER[2] << 1;
    mask2 = NUM_BUFFER[2] < 10;

    updatePending[0] = 1;
    requestAnimationFrame(updateCountdownNode);
    lastUpdateTimeLocalPlayer = time;
  }

  requestAnimationFrame(update);
}

export function updateTimestamp() {
  if (getLocalTimeStampUpdateIsRunning()) {
    return;
  }

  if (getCurrentMode() !== mediaPlayerMode()) {
    setLocalTimeStampUpdateIsRunning(false);
    return;
  }

  const video = getVideo();
  if ((video && !video.paused) || getLiveAudio()?.paused === false) {
    setLocalTimeStampUpdateIsRunning(true);
    requestAnimationFrame(update);
  }
}

let lastUpdateTime = 0;

const STRING_BUFFER = new Uint16Array(20);
const ZERO = "0".charCodeAt(0);
STRING_BUFFER[2] = STRING_BUFFER[5] = ":".charCodeAt(0);
STRING_BUFFER[8] = ".".charCodeAt(0);
const PAD_CODES = new Uint16Array(128);
for (let i = 0; i < 64; i++) {
  PAD_CODES[i * 2] = 48 + ((i / 10) | 0);
  PAD_CODES[i * 2 + 1] = 48 + (i % 10);
}

/**
 * Decide which media element owns the countdown overlay. Cue scrubs win
 * over the live mirror: while the operator is previewing a cued video or
 * audio item, the big "time remaining" display in the corner should
 * reflect what they're scrubbing, not the projection.
 *
 * Returns null when:
 *   - no cue is loaded (the live media drives the countdown), OR
 *   - the cue is an image (no meaningful countdown exists — caller hides
 *     the overlay instead).
 */
function getCountdownSourceElement() {
  const previewAudio = getPreviewAudio();
  const previewCueVideo = getPreviewCueVideo();
  if (isAudioPreviewCueActive() && previewAudio) {
    return previewAudio;
  }
  if (isVideoPreviewCueActive() && previewCueVideo) {
    return previewCueVideo;
  }
  return null;
}

/**
 * True when an image is cued. The countdown overlay must be hidden in
 * this case — there is no duration to count down from — and re-shown when
 * the cue clears (assuming the live media is not also an image).
 */
export function isImagePreviewCueActive() {
  const cue = getCurrentPreviewCue();
  const cueEl = getPreviewCueVideo() || document.getElementById("previewCue");
  return Boolean(
    cue &&
      isQueueItemImage(cue.item) &&
      cueEl &&
      cueEl.hidden === false &&
      cueEl.hasAttribute("poster"),
  );
}

/**
 * Per-cue scratch buffer. The live mirror has its own NUM_BUFFER /
 * STRING_BUFFER / requestAnimationFrame pipeline driven by
 * handleTimeMessage + update(); reusing those structures from the cue
 * scrub path would mean two independent sources mutating a single
 * shared buffer and racing for the same RAF slot. Even with strict
 * source-switching guards, the architecture is fragile — one missed
 * guard and the two countdowns interleave into torn digits. The cue
 * gets its own private buffer here and paints via per-digit text nodes,
 * so a cue scrub can never corrupt the live path's in-flight NUM_BUFFER
 * live path's in-flight NUM_BUFFER state and vice versa.
 *
 * The buffer is pre-sized for "HH:MM:SS.mmm" (12 chars) and indexed by
 * absolute position so we never allocate a string just to format the
 * countdown — paintCountdownFor runs once per timeupdate (≈4 Hz) and
 * once per seek, well below the live RAF rate, but keeping it
 * allocation-free still avoids waking the GC inside event callbacks.
 */
const CUE_COUNTDOWN_CHARS = new Uint16Array(12);
CUE_COUNTDOWN_CHARS[2] = CUE_COUNTDOWN_CHARS[5] = ":".charCodeAt(0);
CUE_COUNTDOWN_CHARS[8] = ".".charCodeAt(0);

function writeTwoDigits(value, offset) {
  if (value < 0) value = 0;
  if (value > 99) value = 99;
  CUE_COUNTDOWN_CHARS[offset] = ZERO + ((value / 10) | 0);
  CUE_COUNTDOWN_CHARS[offset + 1] = ZERO + (value % 10);
}

function writeThreeDigits(value, offset) {
  if (value < 0) value = 0;
  if (value > 999) value = 999;
  CUE_COUNTDOWN_CHARS[offset] = ZERO + ((value / 100) | 0);
  CUE_COUNTDOWN_CHARS[offset + 1] = ZERO + (((value / 10) | 0) % 10);
  CUE_COUNTDOWN_CHARS[offset + 2] = ZERO + (value % 10);
}

/**
 * Compute (duration − currentTime) for the cue scrub element and paint
 * HH:MM:SS.mmm into the per-digit overlay nodes. This deliberately does
 * NOT touch NUM_BUFFER / STRING_BUFFER / updatePending so the live mirror's
 * RAF pipeline keeps owning its own state — even while a cue is loaded, the
 * live path can continue painting into its private buffers (the
 * source-switching guards just stop it from applying those buffers to the
 * on-screen digit nodes).
 *
 * Wired from getPreviewCueVideo()'s timeupdate/seeked/loadedmetadata
 * listeners and getPreviewAudio()'s equivalents, plus the one-shot redraw
 * inside restoreCountdownForLiveMedia for fast handoff back to live.
 */
export function paintCountdownFor(mediaEl) {
  if (!mediaEl) return;
  const duration = mediaEl.duration;
  const currentTime = mediaEl.currentTime;
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(currentTime) ||
    currentTime < 0
  ) {
    return;
  }
  let remaining = duration - currentTime;
  if (remaining < 0) remaining = 0;
  const wholeSeconds = remaining | 0;
  const hours = (wholeSeconds / 3600) | 0;
  const rem = wholeSeconds - hours * 3600;
  const minutes = (rem / 60) | 0;
  const seconds = rem - minutes * 60;
  const millis = ((remaining - wholeSeconds) * 1000 + 0.5) | 0;
  writeTwoDigits(hours, 0);
  writeTwoDigits(minutes, 3);
  writeTwoDigits(seconds, 6);
  writeThreeDigits(millis > 999 ? 999 : millis, 9);
  setMediaCountdownFromCodes(CUE_COUNTDOWN_CHARS);
}

/**
 * Restore the countdown overlay's visibility to whatever the live media
 * requires. Called when a cue clears (the cue might have hidden the
 * overlay for an image preview, or pinned it to the cue's time), so the
 * operator sees the live time again for audio/video and nothing for an
 * image or empty live source.
 */
export function restoreCountdownForLiveMedia() {
  const overlay = document.getElementById("customControls");
  const liveItem = getCurrentLiveQueueItem();
  const liveIsBible = isActiveMediaWindow() && getActiveMediaWindowContentType() === "bible";
  const liveIsPptx = isActiveMediaWindow() && getActiveMediaWindowContentType() === "pptx";
  const hasLiveSource = Boolean(getMediaFile());
  const liveIsImage = (hasLiveSource && isImg(getMediaFile())) || isQueueItemImage(liveItem);
  const showTransportControls =
    !liveIsBible &&
    !liveIsPptx &&
    !liveIsImage &&
    (hasLiveSource || Boolean(getLiveAudio()?.src));

  if (overlay) {
    overlay.style.display = "";
    overlay.style.visibility = showTransportControls ? "" : "hidden";
  }

  const showCountdown = hasLiveSource && !liveIsImage;
  setMediaCountdownOverlayVisible(showCountdown);
  if (!showCountdown) {
    setMediaCountdownText("");
    return;
  }
  // Prefer getLiveAudio()'s clock for audio-only live presentations — the
  // main video element may be paused/empty in that mode. Otherwise fall
  // back to the main mirror so we paint immediately instead of waiting
  // for the next projection time message.
  if (getLiveAudio()?.src && getLiveAudio().src !== "" && !getLiveAudio().paused) {
    paintCountdownFor(getLiveAudio());
  } else {
    const video = getVideo();
    if (!video) return;
    paintCountdownFor(video);
  }
}

function updateCountdownNode() {
  let tens = (NUM_BUFFER[0] / 10) | 0,
    units = NUM_BUFFER[0] % 10;
  STRING_BUFFER[0] = mask0 ? PAD_CODES[idx0] : ZERO + tens;
  STRING_BUFFER[1] = mask0 ? PAD_CODES[idx0 + 1] : ZERO + units;

  ((tens = (NUM_BUFFER[1] / 10) | 0), (units = NUM_BUFFER[1] % 10));
  STRING_BUFFER[3] = mask1 ? PAD_CODES[idx1] : ZERO + tens;
  STRING_BUFFER[4] = mask1 ? PAD_CODES[idx1 + 1] : ZERO + units;

  ((tens = (NUM_BUFFER[2] / 10) | 0), (units = NUM_BUFFER[2] % 10));
  STRING_BUFFER[6] = mask2 ? PAD_CODES[idx2] : ZERO + tens;
  STRING_BUFFER[7] = mask2 ? PAD_CODES[idx2 + 1] : ZERO + units;

  STRING_BUFFER[9] = ZERO + ((NUM_BUFFER[3] / 100) | 0);
  STRING_BUFFER[10] = ZERO + (((NUM_BUFFER[3] / 10) | 0) % 10);
  STRING_BUFFER[11] = ZERO + (NUM_BUFFER[3] % 10);

  setMediaCountdownFromCodes(STRING_BUFFER);

  updatePending[0] = 0;
}

let now = 0;
export function handleTimeMessage(_, message) {
  const duration = Array.isArray(message) ? message[0] : message?.duration;
  const currentTime = Array.isArray(message)
    ? message[1]
    : message?.currentTime;
  const timestamp = Array.isArray(message) ? message[2] : message?.timestamp;
  const messageMediaFile = Array.isArray(message)
    ? message[3]
    : message?.mediaFile;

  if (
    messageMediaFile &&
    getMediaFile() &&
    !mediaPathMatchesCurrentLiveMedia(messageMediaFile)
  ) {
    return;
  }

  if (
    !Number.isFinite(duration) ||
    !Number.isFinite(currentTime) ||
    duration <= 0 ||
    currentTime < 0
  ) {
    return;
  }

  now = Date.now();

  if (getCurrentMode() === mediaPlayerMode()) {
    // Cue scrubs own the countdown while a cue is loaded — the operator
    // is reading "time remaining on the thing I'm previewing", not on the
    // live media. The cue's own timeupdate/seeked handlers drive the
    // overlay (or hide it entirely for an image cue), so we just step
    // out of the way here.
    if (!getCountdownSourceElement() && !isImagePreviewCueActive()) {
      const remaining = duration - currentTime;
      SECONDSFLOAT[0] = remaining > 0 ? remaining : 0;
      NUM_BUFFER[0] = ((SECONDSFLOAT[0] | 0) / 3600) | 0;
      REM_BUFFER[0] = (SECONDSFLOAT[0] | 0) % 3600;
      NUM_BUFFER[1] = (REM_BUFFER[0] / 60) | 0;
      NUM_BUFFER[2] = REM_BUFFER[0] % 60;
      NUM_BUFFER[3] =
        ((SECONDSFLOAT[0] - (SECONDSFLOAT[0] | 0)) * 1000 + 0.5) | 0;
      // Keep the PAD_CODES lookup metadata in sync with NUM_BUFFER on
      // every IPC tick. Historically only the local update() RAF loop
      // refreshed mask*/idx*, which meant updateCountdownNode would
      // render the hours/minutes/seconds digits from a stale lookup
      // whenever this IPC path won the race to schedule the next paint
      // — most visible right after a cue clears (update() skipped the
      // refresh while the cue owned the countdown). Refresh here too so
      // the live countdown is fully self-sufficient and never gets
      // "stuck" digits.
      idx0 = NUM_BUFFER[0] << 1;
      mask0 = NUM_BUFFER[0] < 10;
      idx1 = NUM_BUFFER[1] << 1;
      mask1 = NUM_BUFFER[1] < 10;
      idx2 = NUM_BUFFER[2] << 1;
      mask2 = NUM_BUFFER[2] < 10;
      if (!updatePending[0]) {
        updatePending[0] = 1;
        requestAnimationFrame(updateCountdownNode);
      }
    }
  }

  // The PID sync must run unconditionally while the live mirror is
  // playing. In the old architecture this path early-returned whenever a
  // cue was loaded (shouldSuppressPreviewForwarding was true), which
  // froze the PID controller and let the mirror's playbackRate drift
  // away from the projection. With the cue scrub on a dedicated overlay
  // the main #preview is always the live mirror, so we keep adjusting it
  // — only the explicit getSuppressPreviewForwarding() flag (used briefly
  // during projection→preview sync to break feedback) is honored here.
  if (getSuppressPreviewForwarding()) {
    return;
  }

  // Perform timestamp calculations only if enough time has passed
  if (now - lastUpdateTime > 500) {
    const video = getVideo();
    if (video && !video.paused && !video.seeking) {
      const nextTargetTime = currentTime - (now - timestamp + (Date.now() - now)) * 0.001;
      setTargetTime(nextTargetTime);
      hybridSync(nextTargetTime);
      lastUpdateTime = now;
    }
  }
}
