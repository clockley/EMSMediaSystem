/*
Copyright (C) 2026 Christian Lockley

Audience output hold controls (black screen, logo hold).
Independent from live text clear state.
*/

"use strict";

export const OUTPUT_HOLD_NONE = "none";
export const OUTPUT_HOLD_BLACK = "black";
export const OUTPUT_HOLD_LOGO = "logo";

export const OUTPUT_HOLD_LOGO_PATH_KEY = "outputHoldLogoPath";
export const OUTPUT_HOLD_LOGO_FIT_KEY = "outputHoldLogoFit";
export const OUTPUT_HOLD_LOGO_BACKGROUND_KEY = "outputHoldLogoBackground";

export const DEFAULT_BLACK_COLOR = "#000000";
export const DEFAULT_OUTPUT_HOLD_LOGO_BACKGROUND = "#000000";
export const DEFAULT_OUTPUT_HOLD_LOGO_FIT = "contain";
export const OUTPUT_HOLD_TRANSITION_MS = 350;

const LOGO_FIT_VALUES = new Set(["contain", "cover"]);

let audienceHoldMode = OUTPUT_HOLD_NONE;
let holdLogoSettings = {
  logoPath: "",
  logoFit: DEFAULT_OUTPUT_HOLD_LOGO_FIT,
  logoBackground: DEFAULT_OUTPUT_HOLD_LOGO_BACKGROUND,
};

const outputHoldDeps = {
  send: () => {},
  isActiveMediaWindow: () => false,
  showGnomeToast: () => {},
  pathToMediaUrl: () => "",
  startLogoHoldPresentation: async () => false,
  onLogoHoldDeactivated: async () => {},
};

export function configureOutputHold(deps = {}) {
  Object.assign(outputHoldDeps, deps);
}

export function getAudienceHoldMode() {
  return audienceHoldMode;
}

export function isAudienceBlackScreenActive() {
  return audienceHoldMode === OUTPUT_HOLD_BLACK;
}

export function isAudienceLogoHoldActive() {
  return audienceHoldMode === OUTPUT_HOLD_LOGO;
}

export function isAnyAudienceHoldActive() {
  return audienceHoldMode !== OUTPUT_HOLD_NONE;
}

export function getOutputHoldLogoSettings() {
  return { ...holdLogoSettings };
}

export function hasConfiguredOutputHoldLogo() {
  return Boolean(String(holdLogoSettings.logoPath || "").trim());
}

export function canUseAudienceHold() {
  return outputHoldDeps.isActiveMediaWindow();
}

function normalizeLogoFit(value) {
  const fit = String(value || "").trim().toLowerCase();
  return LOGO_FIT_VALUES.has(fit) ? fit : DEFAULT_OUTPUT_HOLD_LOGO_FIT;
}

function normalizeHoldBackground(value, fallback = DEFAULT_OUTPUT_HOLD_LOGO_BACKGROUND) {
  const color = String(value || "").trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ? color : fallback;
}

export function normalizeOutputHoldPreferences(prefs = {}) {
  return {
    logoPath: typeof prefs.logoPath === "string" ? prefs.logoPath.trim() : "",
    logoFit: normalizeLogoFit(prefs.logoFit),
    logoBackground: normalizeHoldBackground(
      prefs.logoBackground,
      DEFAULT_OUTPUT_HOLD_LOGO_BACKGROUND,
    ),
  };
}

export function applyOutputHoldPreferences(prefs = {}) {
  holdLogoSettings = normalizeOutputHoldPreferences(prefs);
  updateOutputHoldButtonStates();
  if (audienceHoldMode === OUTPUT_HOLD_LOGO) {
    if (hasConfiguredOutputHoldLogo() && canUseAudienceHold()) {
      sendAudienceOutputHold(OUTPUT_HOLD_LOGO);
    } else {
      audienceHoldMode = OUTPUT_HOLD_NONE;
      if (canUseAudienceHold()) {
        sendAudienceOutputHold(OUTPUT_HOLD_NONE);
      }
      updateOutputHoldButtonStates();
    }
  }
}

function buildHoldPayload(mode = audienceHoldMode) {
  if (mode === OUTPUT_HOLD_BLACK) {
    return {
      mode: OUTPUT_HOLD_BLACK,
      blackColor: DEFAULT_BLACK_COLOR,
      transitionDurationMs: OUTPUT_HOLD_TRANSITION_MS,
    };
  }
  if (mode === OUTPUT_HOLD_LOGO) {
    const logoPath = holdLogoSettings.logoPath;
    const logoUrl = logoPath ? outputHoldDeps.pathToMediaUrl(logoPath) : "";
    return {
      mode: OUTPUT_HOLD_LOGO,
      blackColor: holdLogoSettings.logoBackground,
      logoBackground: holdLogoSettings.logoBackground,
      logoUrl,
      logoFit: holdLogoSettings.logoFit,
      transitionDurationMs: OUTPUT_HOLD_TRANSITION_MS,
    };
  }
  return { mode: OUTPUT_HOLD_NONE, transitionDurationMs: OUTPUT_HOLD_TRANSITION_MS };
}

export function sendAudienceOutputHold(mode = audienceHoldMode) {
  outputHoldDeps.send("set-output-hold", buildHoldPayload(mode));
}

export function setAudienceHoldMode(mode, options = {}) {
  const next =
    mode === OUTPUT_HOLD_BLACK
      ? OUTPUT_HOLD_BLACK
      : mode === OUTPUT_HOLD_LOGO
        ? OUTPUT_HOLD_LOGO
        : OUTPUT_HOLD_NONE;
  const previous = audienceHoldMode;

  if (next === OUTPUT_HOLD_LOGO && !hasConfiguredOutputHoldLogo()) {
    if (!options.quiet) {
      outputHoldDeps.showGnomeToast("Set logo media in Preferences");
    }
    return false;
  }

  audienceHoldMode = next;
  if (canUseAudienceHold()) {
    sendAudienceOutputHold(next);
  }
  updateOutputHoldButtonStates();

  if (options.quiet) return previous !== next;

  if (next === OUTPUT_HOLD_BLACK && previous !== OUTPUT_HOLD_BLACK) {
    outputHoldDeps.showGnomeToast("Black screen on — media still playing");
  } else if (next === OUTPUT_HOLD_LOGO && previous !== OUTPUT_HOLD_LOGO) {
    outputHoldDeps.showGnomeToast("Logo hold on — media still playing");
  } else if (next === OUTPUT_HOLD_NONE && previous === OUTPUT_HOLD_BLACK) {
    outputHoldDeps.showGnomeToast("Black screen off");
  } else if (next === OUTPUT_HOLD_NONE && previous === OUTPUT_HOLD_LOGO) {
    outputHoldDeps.showGnomeToast("Logo hold off");
  }
  return previous !== next;
}

export function toggleBlackScreen() {
  if (!canUseAudienceHold()) {
    outputHoldDeps.showGnomeToast("No projection window open");
    return false;
  }
  const next =
    audienceHoldMode === OUTPUT_HOLD_BLACK ? OUTPUT_HOLD_NONE : OUTPUT_HOLD_BLACK;
  return setAudienceHoldMode(next);
}

export async function toggleLogoHold() {
  if (!hasConfiguredOutputHoldLogo()) {
    outputHoldDeps.showGnomeToast("Set logo media in Preferences");
    return false;
  }
  if (audienceHoldMode === OUTPUT_HOLD_LOGO) {
    await outputHoldDeps.onLogoHoldDeactivated?.();
    return setAudienceHoldMode(OUTPUT_HOLD_NONE);
  }
  if (!canUseAudienceHold()) {
    const started = await outputHoldDeps.startLogoHoldPresentation?.();
    if (!started) return false;
  }
  return setAudienceHoldMode(OUTPUT_HOLD_LOGO);
}

export function resetAudienceOutputHold(options = {}) {
  const force = options.force === true;
  if (audienceHoldMode === OUTPUT_HOLD_NONE && !force) {
    updateOutputHoldButtonStates();
    return false;
  }
  const previous = audienceHoldMode;
  audienceHoldMode = OUTPUT_HOLD_NONE;
  if (canUseAudienceHold() || force) {
    sendAudienceOutputHold(OUTPUT_HOLD_NONE);
  }
  updateOutputHoldButtonStates();
  if (!options.quiet && previous !== OUTPUT_HOLD_NONE) {
    outputHoldDeps.showGnomeToast(
      previous === OUTPUT_HOLD_LOGO ? "Logo hold off" : "Black screen off",
    );
  }
  return previous !== OUTPUT_HOLD_NONE || force;
}

export function syncAudienceOutputHoldAfterPresentationStart() {
  if (audienceHoldMode === OUTPUT_HOLD_NONE || !canUseAudienceHold()) return;
  if (audienceHoldMode === OUTPUT_HOLD_LOGO && !hasConfiguredOutputHoldLogo()) {
    audienceHoldMode = OUTPUT_HOLD_NONE;
    sendAudienceOutputHold(OUTPUT_HOLD_NONE);
    updateOutputHoldButtonStates();
    return;
  }
  sendAudienceOutputHold(audienceHoldMode);
}

export function updateBlackScreenButtonState() {
  const button = document.getElementById("blackScreenButton");
  if (!button) return;
  const available = canUseAudienceHold();
  const active = audienceHoldMode === OUTPUT_HOLD_BLACK;
  button.hidden = !available;
  button.disabled = !available;
  button.setAttribute("aria-hidden", available ? "false" : "true");
  button.setAttribute("aria-pressed", active ? "true" : "false");
  button.classList.toggle("is-active", active);
  const label = document.getElementById("blackScreenButtonLabel");
  if (label) {
    label.textContent = active ? "Black On" : "Black";
  }
  const description = active
    ? "Turn black screen off"
    : "Black screen (keeps media playing)";
  button.setAttribute("aria-label", description);
  button.title = description;
}

export function updateLogoHoldButtonState() {
  const button = document.getElementById("logoHoldButton");
  if (!button) return;
  const available = canUseAudienceHold() && hasConfiguredOutputHoldLogo();
  const active = audienceHoldMode === OUTPUT_HOLD_LOGO;
  button.hidden = !canUseAudienceHold();
  button.disabled = !available;
  button.setAttribute("aria-hidden", canUseAudienceHold() ? "false" : "true");
  button.setAttribute("aria-pressed", active ? "true" : "false");
  button.classList.toggle("is-active", active);
  button.classList.toggle("is-unconfigured", canUseAudienceHold() && !hasConfiguredOutputHoldLogo());
  const label = document.getElementById("logoHoldButtonLabel");
  if (label) {
    label.textContent = active ? "Logo On" : "Logo";
  }
  const description = !hasConfiguredOutputHoldLogo()
    ? "Configure logo hold in Preferences"
    : active
      ? "Turn logo hold off"
      : "Logo hold (keeps media playing)";
  button.setAttribute("aria-label", description);
  button.title = description;
}

export function updateOutputHoldButtonStates() {
  updateBlackScreenButtonState();
  updateLogoHoldButtonState();
}

function isTypingInEditableTarget(event) {
  const target = event.target;
  if (!target || typeof target !== "object") return false;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  return Boolean(
    target.closest?.(".song-editor-textarea, .slide-editor-textarea, [contenteditable='true']"),
  );
}

export function handleOutputHoldShortcut(event) {
  if (!event || event.defaultPrevented) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (isTypingInEditableTarget(event)) return false;
  const key = String(event.key || "").toLowerCase();
  if (key === "b") {
    if (!canUseAudienceHold()) return false;
    event.preventDefault();
    toggleBlackScreen();
    return true;
  }
  if (key === "l") {
    if (!hasConfiguredOutputHoldLogo()) return false;
    event.preventDefault();
    void toggleLogoHold().catch(console.error);
    return true;
  }
  return false;
}
