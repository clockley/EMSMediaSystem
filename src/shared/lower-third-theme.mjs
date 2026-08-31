/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

"use strict";

export const SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND = "#101010";
export const SCRIPTURE_LOWER_THIRD_DEFAULT_FONT_SIZE = 40;
export const SCRIPTURE_LOWER_THIRD_MIN_FONT_SIZE = 20;
export const SCRIPTURE_LOWER_THIRD_MAX_FONT_SIZE = 80;

const LOWER_THIRD_BAR_VIDEO_RE = /\.(mp4|m4v|mov|mkv|webm)$/i;

export function normalizeLowerThirdFontSize(value, fallback = SCRIPTURE_LOWER_THIRD_DEFAULT_FONT_SIZE) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return Math.max(
      SCRIPTURE_LOWER_THIRD_MIN_FONT_SIZE,
      Math.min(SCRIPTURE_LOWER_THIRD_MAX_FONT_SIZE, Math.round(fallback)),
    );
  }
  return Math.max(
    SCRIPTURE_LOWER_THIRD_MIN_FONT_SIZE,
    Math.min(SCRIPTURE_LOWER_THIRD_MAX_FONT_SIZE, Math.round(parsed)),
  );
}

export function resolveLowerThirdFontSize(style = {}, derivedFromAudience) {
  if (Number.isFinite(style.lowerThirdFontSize)) {
    return normalizeLowerThirdFontSize(style.lowerThirdFontSize);
  }
  if (typeof derivedFromAudience === "function") {
    const derived = derivedFromAudience(style.fontSize);
    if (Number.isFinite(derived)) return normalizeLowerThirdFontSize(derived, derived);
  }
  return SCRIPTURE_LOWER_THIRD_DEFAULT_FONT_SIZE;
}

export function resolveLowerThirdFontFamily(style = {}, fallback = "'CMG Sans'") {
  const value = style.lowerThirdFontFamily || style.fontFamily || fallback;
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function lowerThirdBarBackgroundIsVideo(path = "") {
  return LOWER_THIRD_BAR_VIDEO_RE.test(String(path || ""));
}

function lowerThirdColorIsTransparent(value) {
  const color = String(value || "").trim().toLowerCase();
  if (color === "transparent" || /^#[0-9a-f]{6}00$/.test(color)) return true;
  const rgba = color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/i);
  return Boolean(rgba && Number(rgba[1]) === 0);
}

export function lowerThirdBackingPlateEnabledFromStyle(style = {}) {
  if (typeof style.lowerThirdBackingPlateEnabled === "boolean") {
    return style.lowerThirdBackingPlateEnabled;
  }
  const resolved = style.resolvedTheme && typeof style.resolvedTheme === "object"
    ? style.resolvedTheme
    : style.themeId && style.typography
      ? style
      : null;
  if (resolved && typeof resolved.backdrop?.enabled === "boolean") {
    return resolved.backdrop.enabled;
  }
  if (style.lowerThirdBarBackgroundPath || style.lowerThirdBarBackgroundImage || style.lowerThirdBarBackgroundVideo) {
    return true;
  }
  return !lowerThirdColorIsTransparent(style.lowerThirdBarBackgroundColor);
}

export function lowerThirdThemeFieldsFromStyle(style = {}, derivedFontSize) {
  const resolved = style.resolvedTheme && typeof style.resolvedTheme === "object"
    ? style.resolvedTheme
    : style.themeId && style.typography
      ? style
      : null;
  if (resolved) {
    const backdrop = resolved.backdrop || {};
    const backdropBackground = backdrop.background || {};
    const backdropEnabled = lowerThirdBackingPlateEnabledFromStyle(style);
    const hasFontOverride =
      style.lowerThirdFontFamilyOverride === true || style.fontFamilyOverride === true;
    return {
      lowerThirdBackingPlateEnabled: backdropEnabled,
      lowerThirdFontFamily: hasFontOverride
        ? resolveLowerThirdFontFamily(style)
        : resolveLowerThirdFontFamily({
            lowerThirdFontFamily: resolved.typography?.fontFamily,
          }),
      lowerThirdFontSize: normalizeLowerThirdFontSize(resolved.typography?.fontSize),
      lowerThirdColor: resolved.typography?.color || "#ffffff",
      lowerThirdBarBackgroundColor:
        backdropEnabled
          ? backdropBackground.color || SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND
          : "transparent",
      lowerThirdBarBackgroundPath:
        backdropEnabled
          ? backdropBackground.assetUrl || backdropBackground.path || ""
          : "",
      lowerThirdChromaKeyColor:
        resolved.key?.chromaColor || resolved.canvas?.background?.color || "#00ff00",
    };
  }
  const backdropEnabled = lowerThirdBackingPlateEnabledFromStyle(style);
  return {
    lowerThirdBackingPlateEnabled: backdropEnabled,
    lowerThirdFontFamily: resolveLowerThirdFontFamily(style),
    lowerThirdFontSize: resolveLowerThirdFontSize(style, derivedFontSize),
    lowerThirdColor: style.lowerThirdColor || "#ffffff",
    lowerThirdBarBackgroundColor: backdropEnabled
      ? style.lowerThirdBarBackgroundColor || SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND
      : "transparent",
    lowerThirdBarBackgroundPath:
      backdropEnabled && typeof style.lowerThirdBarBackgroundPath === "string"
        ? style.lowerThirdBarBackgroundPath
        : "",
    lowerThirdChromaKeyColor: style.lowerThirdChromaKeyColor || "#00ff00",
  };
}

export function lowerThirdBarMediaUrls(themeFields, pathToMediaUrl) {
  const path = themeFields.lowerThirdBarBackgroundPath || "";
  if (!path || typeof pathToMediaUrl !== "function") {
    return { lowerThirdBarBackgroundImage: "", lowerThirdBarBackgroundVideo: "" };
  }
  const url = pathToMediaUrl(path);
  if (lowerThirdBarBackgroundIsVideo(path)) {
    return { lowerThirdBarBackgroundImage: "", lowerThirdBarBackgroundVideo: url };
  }
  return { lowerThirdBarBackgroundImage: url, lowerThirdBarBackgroundVideo: "" };
}

export function applyLowerThirdBarBackground(box, message = {}) {
  if (!box) return;
  const backingPlateEnabled = lowerThirdBackingPlateEnabledFromStyle(message);
  const barColor = backingPlateEnabled
    ? message.lowerThirdBarBackgroundColor || SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND
    : "transparent";
  const barImage = backingPlateEnabled ? message.lowerThirdBarBackgroundImage || "" : "";
  const barVideo = backingPlateEnabled ? message.lowerThirdBarBackgroundVideo || "" : "";

  box.style.backgroundColor = barColor;

  let video = box.querySelector(".scripture-render__bar-video");
  if (barVideo) {
    box.style.backgroundImage = "";
    box.style.backgroundSize = "";
    box.style.backgroundPosition = "";
    if (!video) {
      video = document.createElement("video");
      video.className = "scripture-render__bar-video";
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      box.prepend(video);
    }
    if (video.getAttribute("src") !== barVideo) {
      video.setAttribute("src", barVideo);
    }
    video.hidden = false;
    void video.play().catch(() => {});
    return;
  }

  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.hidden = true;
  }

  if (barImage) {
    box.style.backgroundImage = `url('${barImage}')`;
    box.style.backgroundSize = "cover";
    box.style.backgroundPosition = "center";
    return;
  }

  box.style.backgroundImage = "";
  box.style.backgroundSize = "";
  box.style.backgroundPosition = "";
}
