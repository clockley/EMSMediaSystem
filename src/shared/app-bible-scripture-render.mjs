/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

"use strict";

import {
  SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND,
  SCRIPTURE_LOWER_THIRD_DEFAULT_FONT_SIZE,
  applyLowerThirdBarBackground,
  lowerThirdBarMediaUrls,
  lowerThirdThemeFieldsFromStyle,
  resolveLowerThirdFontFamily,
  resolveLowerThirdFontSize,
} from "./lower-third-theme.mjs";
import {
  findLargestFittingFontSize as findLargestFittingSharedFontSize,
  measureTextLayout,
  waitForTextFonts,
} from "./text-measure.mjs";
import {
  applyLowerThirdPreviewScale,
  installLowerThirdPreviewScaleObserver,
} from "./lower-third-preview.mjs";

export const SCRIPTURE_FONT_FAMILY = "'CMG Sans'";
export {
  SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND,
  SCRIPTURE_LOWER_THIRD_DEFAULT_FONT_SIZE,
} from "./lower-third-theme.mjs";
export const SCRIPTURE_BODY_FONT_SIZE = 66;
export const SCRIPTURE_REFERENCE_FONT_SIZE = 38;
export const SCRIPTURE_LABEL_FONT_SIZE = 28;
export const SCRIPTURE_HEADING_FONT_SIZE = 52;
export const SCRIPTURE_FONT_WEIGHT = 700;
export const SCRIPTURE_LINE_HEIGHT = 1.32;
export const SCRIPTURE_LOOK_FULLSCREEN = "fullscreen";
export const SCRIPTURE_LOOK_LOWER_THIRD = "lower-third";
export const BIBLE_LOWER_THIRD_FEATURE_ENABLED = true;
export const SCRIPTURE_DEFAULT_LOOK = SCRIPTURE_LOOK_FULLSCREEN;
export const SCRIPTURE_LOWER_THIRD_TEXT_COLOR = "#ffffff";
export const SCRIPTURE_LOWER_THIRD_CHROMA_KEY_COLOR = "#00ff00";
export const SCRIPTURE_REFERENCE_LIGHT_COLOR = "rgba(255, 255, 255, 0.78)";
export const SCRIPTURE_REFERENCE_DARK_COLOR = "rgba(24, 24, 28, 0.84)";
export const SCRIPTURE_REFERENCE_LIGHT_SHADOW = "0 2px 14px rgba(0, 0, 0, 0.72)";
export const SCRIPTURE_REFERENCE_DARK_SHADOW = "0 2px 12px rgba(255, 255, 255, 0.62)";
export const SCRIPTURE_REFERENCE_LIGHT_BACKGROUND_LUMINANCE = 0.58;
export const SCRIPTURE_MIN_BODY_FONT_SIZE = 38;
export const SCRIPTURE_ABSOLUTE_MIN_BODY_FONT_SIZE = 20;
export const SCRIPTURE_MIN_REFERENCE_FONT_SIZE = 20;
export const SCRIPTURE_FIT_HEIGHT_RATIO = 0.86;
export const TEXT_PREVIEW_HARD_MIN_FONT_SIZE = 8;
export const SCRIPTURE_AUTOSIZE_NONE = "none";
export const SCRIPTURE_AUTOSIZE_FIT = "fit";
export const SCRIPTURE_AUTOSIZE_NORMALIZE = "normalize";
export const SCRIPTURE_DEFAULT_AUTOSIZE_MODE = SCRIPTURE_AUTOSIZE_FIT;
export const FULLSCREEN_SCRIPTURE_MEASURE_ID = "bibleFullscreenScriptureMeasure";
export const BIBLE_PREVIEW_DEFAULT_OUTPUT_WIDTH = 1920;
export const BIBLE_PREVIEW_DEFAULT_OUTPUT_HEIGHT = 1080;
let bibleDesignerState = {};
let biblePreviewActiveMediaWindowSize = null;
let biblePreviewMediaWindowSizePromise = null;
let lastShownBibleStyleOverrides = {};

const bibleScriptureDeps = {
  buildBibleTextMessage: () => null,
  closeBibleLowerThirdOutput: () => {},
  getBibleLowerThirdOutputActive: () => false,
  invoke: () => Promise.reject(new Error('Bible scripture render module is not configured')),
  isQueueItemAudio: () => false,
  isQueueItemBible: () => false,
  isQueueItemSong: () => false,
  isQueueItemImage: () => false,
  isQueueItemPptx: () => false,
  resolvedBibleStyleDefaults: () => ({}),
};

export function configureBibleScriptureRender(deps = {}) {
  if (deps.bibleDesignerState && typeof deps.bibleDesignerState === "object") {
    bibleDesignerState = deps.bibleDesignerState;
  }
  Object.assign(bibleScriptureDeps, deps);
}

export function setLastShownBibleStyleOverrides(overrides = {}) {
  lastShownBibleStyleOverrides = overrides && typeof overrides === "object" ? { ...overrides } : {};
}

export function resetBiblePreviewMediaWindowSize() {
  biblePreviewActiveMediaWindowSize = null;
}

function buildBibleTextMessage(...args) {
  return bibleScriptureDeps.buildBibleTextMessage(...args);
}

function closeBibleLowerThirdOutput(...args) {
  return bibleScriptureDeps.closeBibleLowerThirdOutput(...args);
}

function getBibleLowerThirdOutputActive() {
  return bibleScriptureDeps.getBibleLowerThirdOutputActive() === true;
}

function invoke(...args) {
  return bibleScriptureDeps.invoke(...args);
}

function isQueueItemAudio(item) {
  return bibleScriptureDeps.isQueueItemAudio(item);
}

function isQueueItemBible(item) {
  return bibleScriptureDeps.isQueueItemBible(item);
}

function isQueueItemSong(item) {
  return bibleScriptureDeps.isQueueItemSong(item);
}

function isQueueItemImage(item) {
  return bibleScriptureDeps.isQueueItemImage(item);
}

function isQueueItemPptx(item) {
  return bibleScriptureDeps.isQueueItemPptx(item);
}

function resolvedBibleStyleDefaults(...args) {
  return bibleScriptureDeps.resolvedBibleStyleDefaults(...args);
}

export function classifyPresentationType(item, opts = {}) {
  if (opts?.textItem || isQueueItemBible(item)) return "bible";
  if (isQueueItemSong(item)) return "song";
  if (isQueueItemPptx(item)) return "pptx";
  if (isQueueItemImage(item)) return "image";
  if (isQueueItemAudio(item)) return "audio";
  return "video";
}

export function getBibleDesignerStyle() {
  const fontInput = document.getElementById("bibleFontInput");
  const sizeInput = document.getElementById("bibleFontSizeInput");
  const autosizeModeInput = document.getElementById("bibleAutosizeModeInput");
  const minFontSizeInput = document.getElementById("bibleMinFontSizeInput");
  const colorInput = document.getElementById("bibleTextColorInput");
  const backgroundInput = document.getElementById("bibleBackgroundColorInput");
  const lowerThirdColorInput = document.getElementById("bibleLowerThirdTextColorInput");
  const lowerThirdChromaKeyInput = document.getElementById("bibleLowerThirdChromaKeyInput");
  const lowerThirdFontInput = document.getElementById("bibleLowerThirdFontInput");
  const lowerThirdFontSizeInput = document.getElementById("bibleLowerThirdFontSizeInput");
  const lowerThirdBarBackgroundInput = document.getElementById("bibleLowerThirdBarBackgroundColorInput");
  const fontSize = normalizeScriptureFontSize(
    Number.parseInt(sizeInput?.value, 10),
    bibleDesignerState.fontSize,
  );
  return {
    fontFamily: fontInput?.value || bibleDesignerState.fontFamily,
    fontFamilyOverride: bibleDesignerState.fontFamilyOverride === true,
    fontSize,
    autosizeMode: normalizeScriptureAutosizeMode(
      autosizeModeInput?.value || bibleDesignerState.autosizeMode,
    ),
    minFontSize: normalizeScriptureMinFontSize(
      Number.parseInt(minFontSizeInput?.value, 10),
      fontSize,
    ),
    autoSplit: true,
    color: colorInput?.value || bibleDesignerState.color,
    backgroundColor: backgroundInput?.value || bibleDesignerState.backgroundColor,
    backgroundPath: bibleDesignerState.backgroundPath || "",
    lowerThirdColor: lowerThirdColorInput?.value || bibleDesignerState.lowerThirdColor,
    lowerThirdChromaKeyColor:
      lowerThirdChromaKeyInput?.value || bibleDesignerState.lowerThirdChromaKeyColor,
    lowerThirdFontFamily:
      lowerThirdFontInput?.value || bibleDesignerState.lowerThirdFontFamily || "",
    lowerThirdFontFamilyOverride: bibleDesignerState.lowerThirdFontFamilyOverride === true,
    lowerThirdFontSize: Number.isFinite(Number.parseInt(lowerThirdFontSizeInput?.value, 10))
      ? Number.parseInt(lowerThirdFontSizeInput?.value, 10)
      : bibleDesignerState.lowerThirdFontSize,
    lowerThirdBarBackgroundColor:
      lowerThirdBarBackgroundInput?.value ||
      bibleDesignerState.lowerThirdBarBackgroundColor ||
      SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND,
    lowerThirdBarBackgroundPath: bibleDesignerState.lowerThirdBarBackgroundPath || "",
  };
}

export function bibleStyleSnapshot(entry = {}) {
  const style = {};
  if (typeof entry.fontFamily === "string" && entry.fontFamily.trim()) {
    style.fontFamily = entry.fontFamily;
  }
  if (entry.fontFamilyOverride === true) {
    style.fontFamilyOverride = true;
  }
  if (Number.isFinite(entry.fontSize)) {
    style.fontSize = entry.fontSize;
  }
  if (typeof entry.autosizeMode === "string") {
    style.autosizeMode = normalizeScriptureAutosizeMode(entry.autosizeMode);
  }
  if (Number.isFinite(entry.minFontSize)) {
    style.minFontSize = normalizeScriptureMinFontSize(entry.minFontSize, entry.fontSize);
  }
  if (typeof entry.autoSplit === "boolean") {
    style.autoSplit = entry.autoSplit;
  }
  if (typeof entry.color === "string" && entry.color) {
    style.color = entry.color;
  }
  if (typeof entry.backgroundColor === "string" && entry.backgroundColor) {
    style.backgroundColor = entry.backgroundColor;
  }
  if (typeof entry.backgroundPath === "string") {
    style.backgroundPath = entry.backgroundPath;
  }
  if (typeof entry.lowerThirdColor === "string" && entry.lowerThirdColor) {
    style.lowerThirdColor = entry.lowerThirdColor;
  }
  if (
    typeof entry.lowerThirdChromaKeyColor === "string" &&
    entry.lowerThirdChromaKeyColor
  ) {
    style.lowerThirdChromaKeyColor = entry.lowerThirdChromaKeyColor;
  }
  if (typeof entry.lowerThirdFontFamily === "string" && entry.lowerThirdFontFamily) {
    style.lowerThirdFontFamily = entry.lowerThirdFontFamily;
  }
  if (entry.lowerThirdFontFamilyOverride === true) {
    style.lowerThirdFontFamilyOverride = true;
  }
  if (Number.isFinite(entry.lowerThirdFontSize)) {
    style.lowerThirdFontSize = entry.lowerThirdFontSize;
  }
  if (
    typeof entry.lowerThirdBarBackgroundColor === "string" &&
    entry.lowerThirdBarBackgroundColor
  ) {
    style.lowerThirdBarBackgroundColor = entry.lowerThirdBarBackgroundColor;
  }
  if (typeof entry.lowerThirdBarBackgroundPath === "string") {
    style.lowerThirdBarBackgroundPath = entry.lowerThirdBarBackgroundPath;
  }
  return style;
}

export function mergedBibleShowNowStyle() {
  return {
    ...resolvedBibleStyleDefaults(),
    ...lastShownBibleStyleOverrides,
    ...getBibleDesignerStyle(),
  };
}

export function currentBibleBackgroundVideoSync() {
  const backgroundVideo = document.getElementById("biblePreviewBackgroundVideo");
  if (
    !backgroundVideo ||
    backgroundVideo.hidden ||
    !Number.isFinite(backgroundVideo.currentTime)
  ) {
    return null;
  }
  return {
    currentTime: backgroundVideo.currentTime,
    capturedAt: Date.now(),
  };
}

export function normalizeScriptureLook(value) {
  return value === SCRIPTURE_LOOK_LOWER_THIRD
    ? SCRIPTURE_LOOK_LOWER_THIRD
    : SCRIPTURE_LOOK_FULLSCREEN;
}

export function normalizeScriptureAutosizeMode(value) {
  if (value === SCRIPTURE_AUTOSIZE_NONE) return SCRIPTURE_AUTOSIZE_NONE;
  if (value === SCRIPTURE_AUTOSIZE_NORMALIZE) return SCRIPTURE_AUTOSIZE_NORMALIZE;
  return SCRIPTURE_AUTOSIZE_FIT;
}

export function normalizeScriptureFontSize(value, fallback = SCRIPTURE_BODY_FONT_SIZE) {
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) ? numeric : fallback;
  return Math.max(
    SCRIPTURE_ABSOLUTE_MIN_BODY_FONT_SIZE,
    Math.min(160, Math.round(resolved)),
  );
}

export function normalizeScriptureMinFontSize(value, preferredFontSize = SCRIPTURE_BODY_FONT_SIZE) {
  const preferred = normalizeScriptureFontSize(preferredFontSize);
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) ? numeric : SCRIPTURE_MIN_BODY_FONT_SIZE;
  return Math.max(
    SCRIPTURE_ABSOLUTE_MIN_BODY_FONT_SIZE,
    Math.min(preferred, Math.round(resolved)),
  );
}

export function scriptureLowerThirdFontSize(fontSize) {
  const base = Number.isFinite(fontSize) ? fontSize : SCRIPTURE_BODY_FONT_SIZE;
  return Math.max(26, Math.min(40, Math.round(base * 0.56)));
}

export function scriptureColorToRgb(value) {
  const color = String(value || "").trim();
  const hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return {
        r: Number.parseInt(hex[0] + hex[0], 16),
        g: Number.parseInt(hex[1] + hex[1], 16),
        b: Number.parseInt(hex[2] + hex[2], 16),
      };
    }
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }
  const rgbMatch = color.match(
    /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+[\d.]+)?\s*\)$/i,
  );
  if (!rgbMatch) return null;
  return {
    r: Math.max(0, Math.min(255, Number.parseInt(rgbMatch[1], 10))),
    g: Math.max(0, Math.min(255, Number.parseInt(rgbMatch[2], 10))),
    b: Math.max(0, Math.min(255, Number.parseInt(rgbMatch[3], 10))),
  };
}

export function scriptureRelativeLuminance({ r, g, b }) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function scriptureReferencePresentationForBackground(backgroundColor, options = {}) {
  if (options.forceLight === true) {
    return {
      color: SCRIPTURE_REFERENCE_LIGHT_COLOR,
      shadow: SCRIPTURE_REFERENCE_LIGHT_SHADOW,
    };
  }
  const rgb = scriptureColorToRgb(backgroundColor);
  if (!rgb) {
    return {
      color: SCRIPTURE_REFERENCE_LIGHT_COLOR,
      shadow: SCRIPTURE_REFERENCE_LIGHT_SHADOW,
    };
  }
  const isLightBackground =
    scriptureRelativeLuminance(rgb) >= SCRIPTURE_REFERENCE_LIGHT_BACKGROUND_LUMINANCE;
  return isLightBackground
    ? {
        color: SCRIPTURE_REFERENCE_DARK_COLOR,
        shadow: SCRIPTURE_REFERENCE_DARK_SHADOW,
      }
    : {
        color: SCRIPTURE_REFERENCE_LIGHT_COLOR,
        shadow: SCRIPTURE_REFERENCE_LIGHT_SHADOW,
      };
}

export function normalizeLowerThirdSegmentText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function normalizeLowerThirdSegments(segments) {
  if (!Array.isArray(segments)) return [];
  return segments
    .map((segment) => {
      const text =
        typeof segment === "string"
          ? segment
          : typeof segment?.text === "string"
            ? segment.text
            : "";
      return { text: normalizeLowerThirdSegmentText(text) };
    })
    .filter((segment) => segment.text.length > 0);
}

export function clampLowerThirdSegmentIndex(index, segments) {
  if (!Array.isArray(segments) || segments.length === 0) return 0;
  const numericIndex = Number.isFinite(index) ? Math.trunc(index) : 0;
  return Math.max(0, Math.min(segments.length - 1, numericIndex));
}

export function scriptureRenderScale(el) {
  if (!el?.classList?.contains("bible-preview-copy")) return 1;
  const rawScale = window
    .getComputedStyle(el)
    .getPropertyValue("--bible-preview-output-scale")
    .trim();
  const scale = Number.parseFloat(rawScale);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function scaledScripturePx(el, value) {
  return Math.max(1, value * scriptureRenderScale(el));
}

export function applyScriptureRenderVariables(el, message) {
  if (!el) return;
  const look = normalizeScriptureLook(message.look);
  const bodyFontSize = normalizeScriptureFontSize(
    message.fontSize,
    SCRIPTURE_BODY_FONT_SIZE,
  );
  const lowerThirdFontSize = resolveLowerThirdFontSize(message, scriptureLowerThirdFontSize);
  const referenceFontSize = Math.max(
    14,
    Math.round(message.referenceFontSize || SCRIPTURE_REFERENCE_FONT_SIZE),
  );
  const attributionFontSize = Math.max(12, Math.round(referenceFontSize * 0.42));
  el.style.setProperty("--scripture-font-size", `${scaledScripturePx(el, bodyFontSize)}px`);
  el.style.setProperty(
    "--scripture-lower-third-font-size",
    `${scaledScripturePx(el, lowerThirdFontSize)}px`,
  );
  el.style.setProperty(
    "--scripture-lower-third-backdrop",
    message.lowerThirdBarBackgroundColor || SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND,
  );
  el.style.setProperty(
    "--scripture-reference-font-size",
    `${scaledScripturePx(el, referenceFontSize)}px`,
  );
  el.style.setProperty(
    "--scripture-attribution-font-size",
    `${scaledScripturePx(el, attributionFontSize)}px`,
  );
  el.style.setProperty("--scripture-line-height", `${message.lineHeight || SCRIPTURE_LINE_HEIGHT}`);
  el.style.setProperty("--scripture-font-weight", `${message.fontWeight || SCRIPTURE_FONT_WEIGHT}`);
  el.style.setProperty(
    "--scripture-color",
    look === SCRIPTURE_LOOK_LOWER_THIRD
      ? message.lowerThirdColor || message.color || "#ffffff"
      : message.color || "#ffffff",
  );
  const referencePresentation = scriptureReferencePresentationForBackground(
    message.backgroundColor,
    {
      forceLight:
        look === SCRIPTURE_LOOK_LOWER_THIRD ||
        Boolean(message.backgroundImage || message.backgroundVideo || message.backgroundPath),
    },
  );
  el.style.setProperty(
    "--scripture-reference-color",
    message.referenceColor || referencePresentation.color,
  );
  el.style.setProperty(
    "--scripture-reference-shadow",
    message.referenceTextShadow || referencePresentation.shadow,
  );
  el.style.fontFamily =
    look === SCRIPTURE_LOOK_LOWER_THIRD
      ? resolveLowerThirdFontFamily(message, SCRIPTURE_FONT_FAMILY)
      : message.fontFamily || SCRIPTURE_FONT_FAMILY;
}

export function enrichLowerThirdPresentationMessage(message, pathToMediaUrl) {
  if (!message || typeof message !== "object") return message;
  const themeFields = lowerThirdThemeFieldsFromStyle(message, scriptureLowerThirdFontSize);
  const barMedia =
    typeof pathToMediaUrl === "function"
      ? lowerThirdBarMediaUrls(themeFields, pathToMediaUrl)
      : {
          lowerThirdBarBackgroundImage: message.lowerThirdBarBackgroundImage || "",
          lowerThirdBarBackgroundVideo: message.lowerThirdBarBackgroundVideo || "",
        };
  return {
    ...message,
    ...themeFields,
    ...barMedia,
  };
}

export function scriptureReferenceSizeForBody(bodyFontSize, baseReferenceSize, baseBodySize) {
  const referenceScale = baseReferenceSize / Math.max(1, baseBodySize);
  return Math.max(
    SCRIPTURE_MIN_REFERENCE_FONT_SIZE,
    Math.round(bodyFontSize * referenceScale),
  );
}

export function setFullscreenScriptureRenderFontSize(
  render,
  bodyFontSize,
  baseReferenceSize,
  baseBodySize,
) {
  const referenceFontSize = scriptureReferenceSizeForBody(
    bodyFontSize,
    baseReferenceSize,
    baseBodySize,
  );
  render.style.setProperty("--scripture-font-size", `${scaledScripturePx(render, bodyFontSize)}px`);
  render.style.setProperty(
    "--scripture-reference-font-size",
    `${scaledScripturePx(render, referenceFontSize)}px`,
  );
  render.style.setProperty(
    "--scripture-attribution-font-size",
    `${scaledScripturePx(render, Math.max(12, Math.round(referenceFontSize * 0.42)))}px`,
  );
  return referenceFontSize;
}

export function visibleElementRect(element) {
  const sourceRect = element?.getBoundingClientRect?.();
  if (!sourceRect) return { width: 0, height: 0 };
  let left = sourceRect.left;
  let top = sourceRect.top;
  let right = sourceRect.right;
  let bottom = sourceRect.bottom;

  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor);
    const clips =
      /hidden|clip|auto|scroll/.test(style.overflow) ||
      /hidden|clip|auto|scroll/.test(style.overflowX) ||
      /hidden|clip|auto|scroll/.test(style.overflowY);
    if (!clips) continue;
    const ancestorRect = ancestor.getBoundingClientRect();
    left = Math.max(left, ancestorRect.left);
    top = Math.max(top, ancestorRect.top);
    right = Math.min(right, ancestorRect.right);
    bottom = Math.min(bottom, ancestorRect.bottom);
  }

  left = Math.max(left, 0);
  top = Math.max(top, 0);
  right = Math.min(right, window.innerWidth || right);
  bottom = Math.min(bottom, window.innerHeight || bottom);
  return {
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function scriptureRenderFitBounds(render) {
  const renderBounds = render.getBoundingClientRect();
  const renderWidth = render.clientWidth || renderBounds.width || BIBLE_PREVIEW_DEFAULT_OUTPUT_WIDTH;
  const renderHeight = render.clientHeight || renderBounds.height || BIBLE_PREVIEW_DEFAULT_OUTPUT_HEIGHT;
  if (render.classList?.contains("bible-preview-copy")) {
    const surface = render.closest(".bible-preview-surface");
    const surfaceBounds = surface?.getBoundingClientRect?.();
    const surfaceWidth = surface?.clientWidth || surfaceBounds?.width || renderWidth;
    const surfaceHeight = surface?.clientHeight || surfaceBounds?.height || renderHeight;
    const visibleRender = visibleElementRect(render);
    const visibleSurface = surface ? visibleElementRect(surface) : visibleRender;
    return {
      maxWidth: Math.max(
        1,
        Math.min(
          renderWidth,
          surfaceWidth,
          visibleRender.width || renderWidth,
          visibleSurface.width || surfaceWidth,
        ),
      ),
      maxHeight:
        Math.max(
          1,
          Math.min(
            renderHeight,
            surfaceHeight,
            visibleRender.height || renderHeight,
            visibleSurface.height || surfaceHeight,
          ),
        ) * SCRIPTURE_FIT_HEIGHT_RATIO,
    };
  }
  return {
    maxWidth: Math.max(1, renderWidth),
    maxHeight: Math.max(180, renderHeight) * SCRIPTURE_FIT_HEIGHT_RATIO,
  };
}

export function scriptureRenderBoxFits(render, box, fitBounds) {
  const boxBounds = box.getBoundingClientRect();
  const renderBounds = render.getBoundingClientRect();
  const maxWidth =
    typeof fitBounds === "number" ? undefined : Number(fitBounds?.maxWidth);
  const maxHeight =
    typeof fitBounds === "number" ? fitBounds : Number(fitBounds?.maxHeight);
  const widthCandidates = [
    box.clientWidth,
    boxBounds.width,
    render.clientWidth,
    renderBounds.width,
  ].filter((value) => Number.isFinite(value) && value > 0);
  const heightCandidates = [
    box.clientHeight,
    boxBounds.height,
    render.clientHeight,
    renderBounds.height,
  ].filter((value) => Number.isFinite(value) && value > 0);
  const naturalAvailableWidth = Math.max(
    1,
    Math.min(...(widthCandidates.length ? widthCandidates : [1])),
  );
  const availableWidth = Number.isFinite(maxWidth)
    ? Math.max(1, Math.min(naturalAvailableWidth, maxWidth))
    : naturalAvailableWidth;
  const availableHeight = Number.isFinite(maxHeight)
    ? Math.max(1, maxHeight)
    : Math.max(1, Math.min(...(heightCandidates.length ? heightCandidates : [1])));
  return (
    box.scrollHeight <= Math.ceil(availableHeight) + 1 &&
    box.scrollWidth <= Math.ceil(availableWidth) + 1
  );
}

export function scriptureRenderLineCount(render, bodyFontSize) {
  const body = render.querySelector(".scripture-render__body");
  if (!body) return 0;
  const style = window.getComputedStyle(body);
  const measuredLineHeight = Number.parseFloat(style.lineHeight);
  const lineHeight =
    Number.isFinite(measuredLineHeight) && measuredLineHeight > 0
      ? measuredLineHeight
      : bodyFontSize * SCRIPTURE_LINE_HEIGHT;
  return Math.max(1, Math.round(body.scrollHeight / Math.max(1, lineHeight)));
}

export function findLargestFittingScriptureFontSize(
  render,
  box,
  fitBounds,
  minBodySize,
  maxBodySize,
  applyCandidate,
) {
  const resolved = findLargestFittingSharedFontSize({
    minFontSize: minBodySize,
    maxFontSize: maxBodySize,
    bounds:
      typeof fitBounds === "number"
        ? { width: Number.POSITIVE_INFINITY, height: fitBounds }
        : fitBounds,
    measureAt: (candidate) => {
      applyCandidate(candidate);
      return { candidate };
    },
    fits: () => scriptureRenderBoxFits(render, box, fitBounds),
  });
  applyCandidate(resolved.fontSize);
  return resolved.fontSize;
}

export function fitFullscreenScriptureRender(render, message) {
  if (!render || normalizeScriptureLook(message?.look) !== SCRIPTURE_LOOK_FULLSCREEN) return;
  const box = render.querySelector(".scripture-render__box");
  if (!box) return;
  const autosizeMode = normalizeScriptureAutosizeMode(message.autosizeMode);
  const baseBodySize = normalizeScriptureFontSize(
    message.fontSize,
    SCRIPTURE_BODY_FONT_SIZE,
  );
  const baseReferenceSize = Math.max(
    14,
    Math.round(message.referenceFontSize || SCRIPTURE_REFERENCE_FONT_SIZE),
  );
  const minBodySize = normalizeScriptureMinFontSize(message.minFontSize, baseBodySize);
  const fitBounds = scriptureRenderFitBounds(render);
  const groupFontSize = Number.isFinite(message.autosizeGroupFontSize)
    ? Math.max(
        minBodySize,
        Math.min(baseBodySize, normalizeScriptureFontSize(message.autosizeGroupFontSize)),
      )
    : null;

  const applyCandidate = (fontSize) =>
    setFullscreenScriptureRenderFontSize(
      render,
      fontSize,
      baseReferenceSize,
      baseBodySize,
    );

  let fittedBodySize = baseBodySize;
  let normalized = false;
  let normalizedClamped = false;

  if (autosizeMode === SCRIPTURE_AUTOSIZE_NONE) {
    applyCandidate(fittedBodySize);
  } else if (groupFontSize !== null) {
    fittedBodySize = groupFontSize;
    normalized = true;
    applyCandidate(fittedBodySize);
    if (!scriptureRenderBoxFits(render, box, fitBounds)) {
      fittedBodySize = findLargestFittingScriptureFontSize(
        render,
        box,
        fitBounds,
        minBodySize,
        groupFontSize,
        applyCandidate,
      );
      normalizedClamped = fittedBodySize < groupFontSize;
    }
  } else {
    fittedBodySize = findLargestFittingScriptureFontSize(
      render,
      box,
      fitBounds,
      minBodySize,
      baseBodySize,
      applyCandidate,
    );
  }

  if (!scriptureRenderBoxFits(render, box, fitBounds)) {
    fittedBodySize = findLargestFittingScriptureFontSize(
      render,
      box,
      fitBounds,
      Math.min(TEXT_PREVIEW_HARD_MIN_FONT_SIZE, fittedBodySize),
      fittedBodySize,
      applyCandidate,
    );
  }

  const fittedReferenceSize = scriptureReferenceSizeForBody(
    fittedBodySize,
    baseReferenceSize,
    baseBodySize,
  );
  const fits = scriptureRenderBoxFits(render, box, fitBounds);
  return {
    mode: autosizeMode,
    preferredFontSize: baseBodySize,
    minFontSize: minBodySize,
    resolvedFontSize: fittedBodySize,
    referenceFontSize: fittedReferenceSize,
    lineCount: scriptureRenderLineCount(render, fittedBodySize),
    fits,
    overflow: !fits,
    normalized,
    normalizedClamped,
    splitNeeded:
      autosizeMode !== SCRIPTURE_AUTOSIZE_NONE &&
      !fits &&
      fittedBodySize <= minBodySize,
  };
}

export function fullscreenScriptureMeasureElements() {
  if (!document?.body) return null;
  let root = document.getElementById(FULLSCREEN_SCRIPTURE_MEASURE_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = FULLSCREEN_SCRIPTURE_MEASURE_ID;
    root.className = "scripture-render scripture-render--fullscreen scripture-render-measure";
    root.innerHTML = `
      <div class="scripture-render__box">
        <div class="scripture-render__body"></div>
        <div class="scripture-render__reference"></div>
        <div class="scripture-render__attribution"></div>
      </div>
    `;
    document.body.appendChild(root);
  }
  return {
    root,
    body: root.querySelector(".scripture-render__body"),
    reference: root.querySelector(".scripture-render__reference"),
    attribution: root.querySelector(".scripture-render__attribution"),
  };
}

export function measureFullscreenScriptureMessage(message, outputSize = null) {
  const elements = fullscreenScriptureMeasureElements();
  if (!elements?.root || !elements.body || !elements.reference) return null;
  const size = normalizeBiblePreviewOutputSize(outputSize) || selectedBiblePreviewOutputSize("dspSelct");
  elements.root.style.width = `${Math.max(360, Math.round(size.width))}px`;
  elements.root.style.height = `${Math.max(220, Math.round(size.height))}px`;
  elements.root.classList.toggle("scripture-render--fullscreen", true);
  elements.root.classList.toggle("scripture-render--lower-third", false);
  applyScriptureRenderVariables(elements.root, message);
  elements.body.textContent = message.bodyText || " ";
  elements.reference.textContent = message.referenceText || "";
  elements.reference.hidden = !message.referenceText;
  if (elements.attribution) {
    elements.attribution.textContent = message.attributionText || "";
    elements.attribution.hidden = !message.attributionText;
  }
  return fitFullscreenScriptureRender(elements.root, message);
}

export async function measureFullscreenScriptureMessageAfterFonts(message, outputSize = null) {
  const size = normalizeBiblePreviewOutputSize(outputSize) || selectedBiblePreviewOutputSize("dspSelct");
  const safeMargins =
    message?.resolvedTheme?.safeMargins ||
    message?.resolvedTheme?.textContainer?.safeMargins;
  const referenceReserve = message?.referenceText
    ? Math.max(20, Number(message.referenceFontSize) || SCRIPTURE_REFERENCE_FONT_SIZE) * 1.8
    : 0;
  return measureTextLayout({
    text: message?.bodyText || message?.text || "",
    outputSize: size,
    safeMargins,
    extraHeight: referenceReserve,
    documentRef: globalThis.document,
    style: {
      fontFamily: message?.fontFamily || SCRIPTURE_FONT_FAMILY,
      fontWeight: message?.fontWeight || SCRIPTURE_FONT_WEIGHT,
      fontSize: normalizeScriptureFontSize(message?.fontSize, SCRIPTURE_BODY_FONT_SIZE),
      minFontSize: normalizeScriptureMinFontSize(message?.minFontSize, message?.fontSize),
      lineHeight: message?.lineHeight || SCRIPTURE_LINE_HEIGHT,
      autosizeMode: normalizeScriptureAutosizeMode(message?.autosizeMode),
      direction: message?.direction || "auto",
    },
  });
}

export async function waitForScriptureFonts(message = {}) {
  return waitForTextFonts([message.fontFamily || SCRIPTURE_FONT_FAMILY], {
    documentRef: globalThis.document,
    sample: message.bodyText || message.text || "EMS",
    fontSize: message.fontSize || SCRIPTURE_BODY_FONT_SIZE,
  });
}

export function measureBibleEntryAutofit(entry, outputSize = null) {
  const message = buildBibleTextMessage(entry, { look: SCRIPTURE_LOOK_FULLSCREEN });
  return measureFullscreenScriptureMessage(message, outputSize);
}

export function refitBiblePreviewScripture() {
  const audienceRender = document.getElementById("biblePreviewRender");
  if (!audienceRender) return;
  const message = buildBibleTextMessage(bibleDesignerState, { look: SCRIPTURE_LOOK_FULLSCREEN });
  fitFullscreenScriptureRender(
    audienceRender,
    message,
  );
}

export function applyScriptureRenderToPreview(render, bodyEl, referenceEl, message) {
  if (!render || !bodyEl || !referenceEl) return;
  const look = normalizeScriptureLook(message.look);
  render.classList.toggle("scripture-render--fullscreen", look === SCRIPTURE_LOOK_FULLSCREEN);
  render.classList.toggle("scripture-render--lower-third", look === SCRIPTURE_LOOK_LOWER_THIRD);
  render.dataset.scriptureLook = look;
  applyScriptureRenderVariables(render, message);
  if (look === SCRIPTURE_LOOK_LOWER_THIRD) {
    applyLowerThirdBarBackground(render.querySelector(".scripture-render__box"), message);
  }
  bodyEl.textContent = message.bodyText || "No verse loaded";
  referenceEl.textContent = message.referenceText || "";
  referenceEl.hidden = !message.referenceText;
  const attributionEl = render.querySelector(".scripture-render__attribution");
  if (attributionEl) {
    attributionEl.textContent = message.attributionText || "";
    attributionEl.hidden = !message.attributionText;
  }
  fitFullscreenScriptureRender(render, message);
}

export function isBibleLowerThirdFeatureEnabled() {
  return BIBLE_LOWER_THIRD_FEATURE_ENABLED === true;
}

export function syncLowerThirdFeatureAvailability() {
  const enabled = isBibleLowerThirdFeatureEnabled();
  document.querySelectorAll("[data-lower-third-feature]").forEach((element) => {
    element.hidden = !enabled;
    element.setAttribute("aria-hidden", enabled ? "false" : "true");
    element.querySelectorAll("button, input, select, textarea").forEach((control) => {
      if (!enabled) {
        if (!control.dataset.lowerThirdWasDisabled) {
          control.dataset.lowerThirdWasDisabled = control.disabled ? "true" : "false";
        }
        control.disabled = true;
        return;
      }
      if (control.dataset.lowerThirdWasDisabled) {
        control.disabled = control.dataset.lowerThirdWasDisabled === "true";
        delete control.dataset.lowerThirdWasDisabled;
      }
    });
  });
  const lowerThirdKeyColorField = document.querySelector("[data-lower-third-key-color]");
  if (lowerThirdKeyColorField) {
    lowerThirdKeyColorField.hidden = !enabled;
    lowerThirdKeyColorField.setAttribute("aria-hidden", enabled ? "false" : "true");
    lowerThirdKeyColorField
      .querySelectorAll("button, input, select, textarea")
      .forEach((control) => {
        control.disabled = !enabled;
      });
  }

  document
    .getElementById("biblePreviewPanel")
    ?.classList.add("bible-preview-panel--audience-only");
  document
    .querySelector(".bible-editor-fields")
    ?.classList.toggle("bible-editor-fields--audience-only", !enabled);

}

export function normalizeBiblePreviewOutputSize(value) {
  const width = Number.parseInt(value?.width || "", 10);
  const height = Number.parseInt(value?.height || "", 10);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height };
  }
  return null;
}

export function selectedBiblePreviewOutputSize(selectId = "dspSelct") {
  if (selectId === "dspSelct") {
    const mediaWindowSize = normalizeBiblePreviewOutputSize(biblePreviewActiveMediaWindowSize);
    if (mediaWindowSize) return mediaWindowSize;
  }
  const select = document.getElementById(selectId);
  const option = select?.selectedOptions?.[0];
  const width = Number.parseInt(option?.dataset?.displayWidth || "", 10);
  const height = Number.parseInt(option?.dataset?.displayHeight || "", 10);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height };
  }
  return {
    width: BIBLE_PREVIEW_DEFAULT_OUTPUT_WIDTH,
    height: BIBLE_PREVIEW_DEFAULT_OUTPUT_HEIGHT,
  };
}

export async function refreshBiblePreviewMediaWindowSize() {
  if (biblePreviewMediaWindowSizePromise) {
    return biblePreviewMediaWindowSizePromise;
  }
  biblePreviewMediaWindowSizePromise = invoke("get-media-window-bounds")
    .then((bounds) => {
      biblePreviewActiveMediaWindowSize = normalizeBiblePreviewOutputSize(bounds);
      syncBiblePreviewOutputScale();
      return biblePreviewActiveMediaWindowSize;
    })
    .catch((error) => {
      console.error("Failed to read media window bounds:", error);
      biblePreviewActiveMediaWindowSize = null;
      syncBiblePreviewOutputScale();
      return null;
    })
    .finally(() => {
      biblePreviewMediaWindowSizePromise = null;
    });
  return biblePreviewMediaWindowSizePromise;
}

export function queueBiblePreviewMediaWindowSizeRefresh(delayMs = 0) {
  window.setTimeout(() => {
    void refreshBiblePreviewMediaWindowSize();
  }, Math.max(0, delayMs));
}

export function applyBiblePreviewOutputScale(surface, outputSize, options = {}) {
  applyLowerThirdPreviewScale(surface, outputSize, options);
}

export function syncBiblePreviewOutputScale() {
  applyBiblePreviewOutputScale(
    document.getElementById("bibleAudiencePreviewShell"),
    selectedBiblePreviewOutputSize("dspSelct"),
  );
  if (isBibleLowerThirdFeatureEnabled()) {
    applyBiblePreviewOutputScale(
      document.getElementById("bibleLowerThirdPreviewShell"),
      selectedBiblePreviewOutputSize("lowerThirdDspSelct"),
      { fit: "width", align: "bottom" },
    );
  }
  refitBiblePreviewScripture();
}

export function installBiblePreviewScaleObserver() {
  const panel = document.getElementById("biblePreviewPanel");
  if (!panel || panel.dataset.previewScaleObserverBound === "1") return;
  panel.dataset.previewScaleObserverBound = "1";
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => syncBiblePreviewOutputScale());
    observer.observe(panel);
    document.getElementById("bibleAudiencePreviewShell") &&
      observer.observe(document.getElementById("bibleAudiencePreviewShell"));
    document.getElementById("bibleLowerThirdPreviewShell") &&
      observer.observe(document.getElementById("bibleLowerThirdPreviewShell"));
    panel._biblePreviewScaleObserver = observer;
  } else {
    window.addEventListener("resize", syncBiblePreviewOutputScale);
  }
  installLowerThirdPreviewScaleObserver(
    document.getElementById("bibleLowerThirdPreviewShell"),
    syncBiblePreviewOutputScale,
    "_bibleLowerThirdPreviewScaleObserver",
  );
}
