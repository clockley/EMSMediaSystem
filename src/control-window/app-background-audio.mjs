/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/*
 * Background audio: an operator-chosen soundtrack that plays underneath
 * whatever is being presented (video, PowerPoint deck, or still image).
 *
 * The <audio> element lives in the control window — the same place live
 * audio-only playback already happens — so the soundtrack is fully
 * independent of the media window lifecycle: it keeps playing across
 * slipstream item swaps, window reopen cycles, and workspace switches.
 *
 * The module follows a small functional architecture: pure helpers compute
 * values, a single `renderBackgroundAudioUi()` function projects the current
 * state onto the DOM, and every event handler is "update state, then render".
 */

import { invoke, isPlayInterruptedError, pathToMediaUrl, showGnomeToast } from "./app-renderer.mjs";

const BACKGROUND_AUDIO_VOLUME_KEY = "ems.backgroundAudio.volume";
const BACKGROUND_AUDIO_LOOP_KEY = "ems.backgroundAudio.loop";
const DEFAULT_BACKGROUND_AUDIO_VOLUME = 0.4;

/**
 * Module state. The audio element itself is the source of truth for
 * playback (paused/currentTime/duration); this object only tracks what the
 * element cannot know: which file the operator picked and load ownership.
 */
const backgroundAudioState = Object.seal({
  audio: null,
  sourcePath: "",
  trackName: "",
  loadToken: 0,
  trackLoading: false,
  chooseDialogOpen: false,
  popoverOpen: false,
});

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

const clampBackgroundVolume = (value) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_BACKGROUND_AUDIO_VOLUME;

const backgroundTrackNameFromPath = (filePath) => {
  const normalized = String(filePath ?? "").replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized;
};

const formatBackgroundTrackTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remainder = String(whole % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
};

/**
 * Time readout for the popover. While a new source is loading the element
 * can still report the PREVIOUS track's position/duration (the media load
 * algorithm resets them asynchronously), so a pending load always renders
 * as a fresh 0:00 / 0:00 instead of trusting the element.
 */
const backgroundTrackTimeText = (audio, loading) =>
  loading || !audio
    ? "0:00 / 0:00"
    : `${formatBackgroundTrackTime(audio.currentTime)} / ${formatBackgroundTrackTime(audio.duration)}`;

const backgroundAudioIsLoaded = (state) => Boolean(state.sourcePath);

const backgroundAudioIsPlaying = (state) =>
  Boolean(state.audio && backgroundAudioIsLoaded(state) && !state.audio.paused);

/* ------------------------------------------------------------------ */
/* Persistence (operator preferences survive restarts)                 */
/* ------------------------------------------------------------------ */

const readStoredBackgroundVolume = () => {
  try {
    const raw = globalThis.localStorage?.getItem(BACKGROUND_AUDIO_VOLUME_KEY);
    return raw === null || raw === undefined
      ? DEFAULT_BACKGROUND_AUDIO_VOLUME
      : clampBackgroundVolume(Number.parseFloat(raw));
  } catch {
    return DEFAULT_BACKGROUND_AUDIO_VOLUME;
  }
};

const readStoredBackgroundLoop = () => {
  try {
    return globalThis.localStorage?.getItem(BACKGROUND_AUDIO_LOOP_KEY) !== "0";
  } catch {
    return true;
  }
};

const storeBackgroundVolume = (volume) => {
  try {
    globalThis.localStorage?.setItem(BACKGROUND_AUDIO_VOLUME_KEY, String(clampBackgroundVolume(volume)));
  } catch {}
};

const storeBackgroundLoop = (enabled) => {
  try {
    globalThis.localStorage?.setItem(BACKGROUND_AUDIO_LOOP_KEY, enabled ? "1" : "0");
  } catch {}
};

/* ------------------------------------------------------------------ */
/* Audio element                                                       */
/* ------------------------------------------------------------------ */

function ensureBackgroundAudioElement() {
  if (backgroundAudioState.audio) return backgroundAudioState.audio;
  const audio = new Audio();
  audio.preload = "auto";
  audio.loop = readStoredBackgroundLoop();
  audio.volume = readStoredBackgroundVolume();
  // The new source owns the time display again once its metadata arrives.
  audio.addEventListener("loadedmetadata", () => {
    backgroundAudioState.trackLoading = false;
    renderBackgroundAudioUi();
  });
  for (const type of ["play", "pause", "ended", "timeupdate", "seeked", "durationchange", "emptied", "abort"]) {
    audio.addEventListener(type, renderBackgroundAudioUi);
  }
  audio.addEventListener("error", () => {
    // `audio.error` is reset by every media load algorithm run, so a stale
    // error event from an aborted previous source (src already replaced)
    // cannot clear the newer track.
    if (!backgroundAudioState.sourcePath || !audio.error) return;
    backgroundAudioState.trackLoading = false;
    showGnomeToast("Background audio could not be played");
    clearBackgroundAudio();
  });
  backgroundAudioState.audio = audio;
  return audio;
}

/* ------------------------------------------------------------------ */
/* State transitions                                                   */
/* ------------------------------------------------------------------ */

async function loadBackgroundAudioTrack(filePath) {
  const audio = ensureBackgroundAudioElement();
  const token = ++backgroundAudioState.loadToken;
  backgroundAudioState.sourcePath = filePath;
  backgroundAudioState.trackName = backgroundTrackNameFromPath(filePath);
  backgroundAudioState.trackLoading = true;
  audio.src = pathToMediaUrl(filePath);
  renderBackgroundAudioUi();
  try {
    await audio.play();
  } catch (err) {
    // A newer load/clear owns the element now; its own flow reports errors.
    if (token !== backgroundAudioState.loadToken) return;
    if (!isPlayInterruptedError(err)) {
      console.error("Background audio failed to start:", err);
      showGnomeToast("Could not start the background audio");
    }
  }
  if (token === backgroundAudioState.loadToken) renderBackgroundAudioUi();
}

async function chooseBackgroundAudioTrack() {
  // Serialize pickers: a double-click (or Choose + Replace) must not stack
  // two native dialogs whose results would race each other into the player.
  if (backgroundAudioState.chooseDialogOpen) return;
  backgroundAudioState.chooseDialogOpen = true;
  try {
    const result = await invoke("show-background-audio-dialog");
    if (!result || result.canceled || !result.filePath) return;
    await loadBackgroundAudioTrack(result.filePath);
  } catch (err) {
    console.error("Background audio file dialog failed:", err);
  } finally {
    backgroundAudioState.chooseDialogOpen = false;
  }
}

function toggleBackgroundAudioPlayback() {
  const { audio } = backgroundAudioState;
  if (!audio || !backgroundAudioIsLoaded(backgroundAudioState)) return;
  if (audio.paused) {
    void audio.play().catch((err) => {
      // Rapid play -> pause/replace interrupts the play() promise; that is
      // operator intent, not a failure worth a toast.
      if (isPlayInterruptedError(err)) return;
      console.error("Background audio failed to resume:", err);
      showGnomeToast("Could not resume the background audio");
    });
  } else {
    audio.pause();
  }
  renderBackgroundAudioUi();
}

function setBackgroundAudioVolume(volume) {
  const clamped = clampBackgroundVolume(volume);
  storeBackgroundVolume(clamped);
  if (backgroundAudioState.audio) backgroundAudioState.audio.volume = clamped;
  renderBackgroundAudioUi();
}

function setBackgroundAudioLoop(enabled) {
  storeBackgroundLoop(Boolean(enabled));
  if (backgroundAudioState.audio) backgroundAudioState.audio.loop = Boolean(enabled);
}

function clearBackgroundAudio() {
  backgroundAudioState.loadToken += 1;
  backgroundAudioState.sourcePath = "";
  backgroundAudioState.trackName = "";
  backgroundAudioState.trackLoading = false;
  const { audio } = backgroundAudioState;
  if (audio) {
    try {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    } catch (err) {
      console.error("Failed to clear background audio:", err);
    }
  }
  renderBackgroundAudioUi();
}

function setBackgroundAudioPopoverOpen(open) {
  backgroundAudioState.popoverOpen = Boolean(open);
  renderBackgroundAudioUi();
  if (open) {
    const focusTarget = backgroundAudioIsLoaded(backgroundAudioState)
      ? document.getElementById("bgAudioPlayPauseBtn")
      : document.getElementById("bgAudioChooseBtn");
    focusTarget?.focus();
  }
}

/* ------------------------------------------------------------------ */
/* Rendering: project state onto the DOM                               */
/* ------------------------------------------------------------------ */

function renderBackgroundAudioUi() {
  const state = backgroundAudioState;
  const button = document.getElementById("backgroundAudioButton");
  const popover = document.getElementById("backgroundAudioPopover");
  if (!button || !popover) return;

  const loaded = backgroundAudioIsLoaded(state);
  const playing = backgroundAudioIsPlaying(state);

  button.setAttribute("aria-expanded", state.popoverOpen ? "true" : "false");
  button.setAttribute("aria-pressed", playing ? "true" : "false");
  button.title = loaded
    ? `Background audio: ${state.trackName}`
    : "Background audio";
  const liveDot = document.getElementById("bgAudioLiveDot");
  if (liveDot) liveDot.hidden = !playing;

  popover.hidden = !state.popoverOpen;

  const emptyState = document.getElementById("bgAudioEmptyState");
  const loadedState = document.getElementById("bgAudioLoadedState");
  if (emptyState) emptyState.hidden = loaded;
  if (loadedState) loadedState.hidden = !loaded;

  const playPauseBtn = document.getElementById("bgAudioPlayPauseBtn");
  if (playPauseBtn) {
    playPauseBtn.dataset.playing = playing ? "true" : "false";
    playPauseBtn.setAttribute(
      "aria-label",
      playing ? "Pause background audio" : "Play background audio",
    );
  }

  const trackName = document.getElementById("bgAudioTrackName");
  if (trackName && trackName.textContent !== state.trackName) {
    trackName.textContent = state.trackName;
    trackName.title = state.trackName;
  }

  const timeLabel = document.getElementById("bgAudioTime");
  if (timeLabel) {
    const text = backgroundTrackTimeText(state.audio, state.trackLoading);
    if (timeLabel.textContent !== text) timeLabel.textContent = text;
  }

  const slider = document.getElementById("bgAudioVolumeSlider");
  const volumeValue = document.getElementById("bgAudioVolumeValue");
  const volume = state.audio ? state.audio.volume : readStoredBackgroundVolume();
  const percent = Math.round(clampBackgroundVolume(volume) * 100);
  if (slider && document.activeElement !== slider) slider.value = String(percent);
  if (slider) slider.style.setProperty("--bg-audio-volume-fill", `${percent}%`);
  if (volumeValue) volumeValue.textContent = `${percent}%`;

  const loopSwitch = document.getElementById("bgAudioLoopSwitch");
  if (loopSwitch) {
    loopSwitch.checked = state.audio ? state.audio.loop : readStoredBackgroundLoop();
  }
}

/* ------------------------------------------------------------------ */
/* Install                                                             */
/* ------------------------------------------------------------------ */

function installBackgroundAudioControls() {
  const button = document.getElementById("backgroundAudioButton");
  const popover = document.getElementById("backgroundAudioPopover");
  if (!button || !popover || button.dataset.bgAudioBound === "1") return;
  button.dataset.bgAudioBound = "1";

  button.addEventListener("click", () => {
    setBackgroundAudioPopoverOpen(!backgroundAudioState.popoverOpen);
  });

  document.getElementById("bgAudioChooseBtn")?.addEventListener("click", () => {
    void chooseBackgroundAudioTrack();
  });
  document.getElementById("bgAudioReplaceBtn")?.addEventListener("click", () => {
    void chooseBackgroundAudioTrack();
  });
  document.getElementById("bgAudioPlayPauseBtn")?.addEventListener("click", toggleBackgroundAudioPlayback);
  document.getElementById("bgAudioClearBtn")?.addEventListener("click", clearBackgroundAudio);

  document.getElementById("bgAudioVolumeSlider")?.addEventListener("input", (event) => {
    setBackgroundAudioVolume(Number.parseInt(event.target.value, 10) / 100);
  });

  document.getElementById("bgAudioLoopSwitch")?.addEventListener("change", (event) => {
    setBackgroundAudioLoop(event.target.checked);
  });

  // GNOME popover dismissal: click outside or press Escape.
  document.addEventListener("pointerdown", (event) => {
    if (!backgroundAudioState.popoverOpen) return;
    if (popover.contains(event.target) || button.contains(event.target)) return;
    setBackgroundAudioPopoverOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !backgroundAudioState.popoverOpen) return;
    setBackgroundAudioPopoverOpen(false);
    button.focus();
  });

  renderBackgroundAudioUi();
}

export {
  backgroundAudioState,
  clampBackgroundVolume,
  backgroundTrackNameFromPath,
  formatBackgroundTrackTime,
  backgroundTrackTimeText,
  installBackgroundAudioControls,
  loadBackgroundAudioTrack,
  setBackgroundAudioVolume,
  setBackgroundAudioLoop,
  toggleBackgroundAudioPlayback,
  clearBackgroundAudio,
};
