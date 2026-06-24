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

export function pathToMediaUrl(filePath, cacheBust) {
  if (!filePath || typeof filePath !== "string") return "";
  if (isBiblePath(filePath)) return "";
  if (/^(file|https?|blob):/i.test(filePath)) return filePath;

  const normalized = filePath.replace(/\\/g, "/");
  let url;
  if (normalized.startsWith("/")) {
    url = `file://${encodeURI(normalized)}`;
  } else {
    url = `file:///${encodeURI(normalized)}`;
  }
  if (typeof cacheBust === "string" && cacheBust.length > 0) {
    url += `${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(cacheBust)}`;
  }
  return url;
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

export function isRemoteMediaPath(filePath) {
  return (
    typeof filePath === "string" &&
    /^(https?|m3u8|mpd|blob):/i.test(filePath)
  );
}

export function isFileBackedMediaPath(filePath) {
  return (
    typeof filePath === "string" &&
    filePath.length > 0 &&
    !isBiblePath(filePath) &&
    !isRemoteMediaPath(filePath)
  );
}

export function defaultLiveSourceStrategy(filePath, _type = classifyQueueMediaType(filePath)) {
  return isFileBackedMediaPath(filePath) ? "snapshot" : "reference";
}

export function createLiveSource(filePath, opts = {}) {
  if (!isFileBackedMediaPath(filePath)) return undefined;
  const type = opts.type || classifyQueueMediaType(filePath);
  return {
    mode: opts.mode === "packaged" ? "packaged" : "linked",
    strategy: opts.strategy || defaultLiveSourceStrategy(filePath, type),
    stagingTier: opts.stagingTier === "full" ? "full" : "warn-only",
    originalPath:
      typeof opts.originalPath === "string" && opts.originalPath.length > 0
        ? opts.originalPath
        : filePath,
    snapshotId: typeof opts.snapshotId === "string" ? opts.snapshotId : null,
    pinnedMtimeMs: Number.isFinite(opts.pinnedMtimeMs) ? opts.pinnedMtimeMs : null,
    pinnedSizeBytes: Number.isFinite(opts.pinnedSizeBytes) ? opts.pinnedSizeBytes : null,
    pinnedFileHash:
      typeof opts.pinnedFileHash === "string" ? opts.pinnedFileHash : null,
    previousSnapshotId:
      typeof opts.previousSnapshotId === "string" ? opts.previousSnapshotId : null,
    reason: typeof opts.reason === "string" ? opts.reason : null,
  };
}

export function normalizeLiveSource(filePath, liveSource, opts = {}) {
  if (!isFileBackedMediaPath(filePath)) return undefined;
  const type = opts.type || classifyQueueMediaType(filePath);
  const source = liveSource && typeof liveSource === "object" ? liveSource : {};
  return createLiveSource(filePath, {
    type,
    mode: source.mode || opts.mode,
    strategy: source.strategy,
    stagingTier: source.stagingTier,
    originalPath: source.originalPath || opts.originalPath || filePath,
    snapshotId: source.snapshotId,
    pinnedMtimeMs: source.pinnedMtimeMs,
    pinnedSizeBytes: source.pinnedSizeBytes,
    pinnedFileHash: source.pinnedFileHash,
    previousSnapshotId: source.previousSnapshotId,
    reason: source.reason,
  });
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
    liveSource: createLiveSource(filePath, { type }),
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
