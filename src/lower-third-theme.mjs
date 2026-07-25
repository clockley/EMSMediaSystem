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

export function lowerThirdThemeFieldsFromStyle(style = {}, derivedFontSize) {
  const resolved = style.resolvedTheme && typeof style.resolvedTheme === "object"
    ? style.resolvedTheme
    : style.themeId && style.typography
      ? style
      : null;
  if (resolved) {
    const backdrop = resolved.backdrop || {};
    const backdropBackground = backdrop.background || {};
    return {
      lowerThirdFontFamily: resolveLowerThirdFontFamily({
        lowerThirdFontFamily: resolved.typography?.fontFamily,
      }),
      lowerThirdFontSize: normalizeLowerThirdFontSize(resolved.typography?.fontSize),
      lowerThirdColor: resolved.typography?.color || "#ffffff",
      lowerThirdBarBackgroundColor:
        backdropBackground.color || SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND,
      lowerThirdBarBackgroundPath:
        backdropBackground.assetUrl || backdropBackground.path || "",
      lowerThirdChromaKeyColor:
        resolved.key?.chromaColor || resolved.canvas?.background?.color || "#00ff00",
    };
  }
  return {
    lowerThirdFontFamily: resolveLowerThirdFontFamily(style),
    lowerThirdFontSize: resolveLowerThirdFontSize(style, derivedFontSize),
    lowerThirdColor: style.lowerThirdColor || "#ffffff",
    lowerThirdBarBackgroundColor:
      style.lowerThirdBarBackgroundColor || SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND,
    lowerThirdBarBackgroundPath:
      typeof style.lowerThirdBarBackgroundPath === "string"
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
  const barColor = message.lowerThirdBarBackgroundColor || SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND;
  const barImage = message.lowerThirdBarBackgroundImage || "";
  const barVideo = message.lowerThirdBarBackgroundVideo || "";

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
