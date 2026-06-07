/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
export const imageRegex = /\.(bmp|gif|jpe?g|png|webp|svg|ico)$/i;
export const pptxRegex = /\.pptx$/i;
export const bibleUriPrefix = "bible://";
export const QUEUE_START_END_GUARD_SECONDS = 0.25;

export function isBiblePath(filePath) {
  return typeof filePath === "string" && filePath.startsWith(bibleUriPrefix);
}

export function isNonVideoPresentationPath(filePath, isImagePath) {
  return isBiblePath(filePath) || pptxRegex.test(filePath || "") || isImagePath(filePath);
}

export function isPlayInterruptedError(error) {
  if (!error) return false;
  const msg = typeof error.message === "string" ? error.message : "";
  return (
    error.name === "AbortError" ||
    msg.includes("interrupted by a call to pause()")
  );
}

export function pathToMediaUrl(filePath) {
  if (!filePath || typeof filePath !== "string") return "";
  if (isBiblePath(filePath)) return "";
  if (/^(file|https?|blob):/i.test(filePath)) return filePath;

  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    return `file://${encodeURI(normalized)}`;
  }
  return `file:///${encodeURI(normalized)}`;
}

export function clampMediaTime(time, duration) {
  if (!Number.isFinite(time) || time < 0) return 0;
  if (Number.isFinite(duration) && duration > 0) {
    return Math.min(time, Math.max(0, duration - 0.05));
  }
  return time;
}

export function clampQueueStartTime(time, duration) {
  if (!Number.isFinite(time) || time < 0) return 0;
  if (Number.isFinite(duration) && duration > 0) {
    return Math.min(time, Math.max(0, duration - QUEUE_START_END_GUARD_SECONDS));
  }
  return time;
}

export function classifyQueueMediaType(filePath) {
  if (typeof filePath === "string" && filePath.startsWith(bibleUriPrefix)) return "bible";
  if (imageRegex.test(filePath)) return "image";
  if (pptxRegex.test(filePath)) return "pptx";
  if (/\.(mp4|m4v|mov|mkv|webm|avi|wmv)$/i.test(filePath)) return "video";
  if (/\.(mp3|m4a|aac|wav|flac|ogg|opus|wma)$/i.test(filePath)) return "audio";
  return "file";
}

export function queueBasename(filePath) {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

export function createQueueEntry(filePath) {
  const type = classifyQueueMediaType(filePath);
  return {
    path: filePath,
    name: queueBasename(filePath),
    type,
    missing: false,
    originalPath: filePath,
    originalName: queueBasename(filePath),
    autoAdvance: false,
    cueStartTime: 0,
    loop: false,
    pptxSlideIndex: type === "pptx" ? -1 : undefined,
  };
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatCueTime(seconds) {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalSeconds = Math.floor(safe);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const millis = Math.floor((safe - totalSeconds) * 1000);
  return `${mins}:${secs.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
}

export function bibleQueuePath(reference, version) {
  return `${bibleUriPrefix}${encodeURIComponent(`${version || "KJV"}:${reference || ""}`)}`;
}

export function normalizedBibleVersions(rawVersions) {
  if (Array.isArray(rawVersions)) return rawVersions;
  if (rawVersions && typeof rawVersions === "object") return Object.values(rawVersions);
  return ["KJV"];
}

export function bibleVersionValue(version) {
  if (typeof version === "string") return version;
  return version?.abbreviation || version?.name || version?.version || "KJV";
}
