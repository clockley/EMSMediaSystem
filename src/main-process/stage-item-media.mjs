/*
Copyright (C) 2026 Christian Lockley

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

/**
 * Stage "Current"/"Next" media descriptors as relayed by the main process.
 *
 * The control window describes the live and next schedule cues with
 * `{ kind, name, sourcePath?, thumbnailUrl? }`. Before a content layer reaches
 * the stage window, main:
 *   - keeps only known kinds and short display names,
 *   - keeps thumbnail URLs only when they are local `file:` URLs,
 *   - removes `sourcePath` entirely, and
 *   - for a PowerPoint "Next" cue, records its resolved path as the single
 *     deck the stage may read, replacing it with an opaque `deckKey`.
 *
 * Pure apart from the injected path resolver so it can be unit tested.
 */

import { createHash } from "crypto";

export const STAGE_MEDIA_KINDS = Object.freeze(["image", "video", "pptx", "audio", "text"]);
const STAGE_MEDIA_KIND_SET = new Set(STAGE_MEDIA_KINDS);
const STAGE_MEDIA_NAME_MAX = 300;
const STAGE_MEDIA_REVISION_MAX = 160;
const STAGE_PPTX_SLIDE_MAX = 9999;
const PPTX_PATH_RE = /\.pptx$/i;

export function isStageThumbnailUrl(value) {
  return typeof value === "string" && /^file:\/\//i.test(value);
}

export function stageDeckKey(localPath, revision = "") {
  return createHash("sha256")
    .update(`${String(localPath)}\u0000${String(revision)}`)
    .digest("hex")
    .slice(0, 24);
}

function sanitizeStageMedia(media, { allowThumbnail }) {
  if (!media || typeof media !== "object" || !STAGE_MEDIA_KIND_SET.has(media.kind)) return null;
  const out = {
    kind: media.kind,
    name: String(media.name || "").slice(0, STAGE_MEDIA_NAME_MAX),
  };
  if (typeof media.revision === "string" && media.revision) {
    out.revision = media.revision.slice(0, STAGE_MEDIA_REVISION_MAX);
  }
  if (
    media.kind === "pptx" &&
    Number.isInteger(media.slideIndex) &&
    media.slideIndex >= 0 &&
    media.slideIndex <= STAGE_PPTX_SLIDE_MAX
  ) {
    out.slideIndex = media.slideIndex;
  }
  if (allowThumbnail && isStageThumbnailUrl(media.thumbnailUrl)) {
    out.thumbnailUrl = media.thumbnailUrl;
  }
  return out;
}

/**
 * @param {object} payload Stage content layer payload from the control window.
 * @param {(sourcePath: string) => string | null} resolveLocalPath
 * @returns {{ payload: object, pptxPath: string, deckKey: string }}
 */
export function sanitizeStageContentPayload(payload, resolveLocalPath) {
  const source = payload && typeof payload === "object" ? payload : {};
  const out = { ...source };
  let pptxPath = "";
  let deckKey = "";

  if ("currentMedia" in source) {
    out.currentMedia = sanitizeStageMedia(source.currentMedia, { allowThumbnail: false });
  }
  if ("nextMedia" in source) {
    const nextMedia = sanitizeStageMedia(source.nextMedia, { allowThumbnail: true });
    if (nextMedia?.kind === "pptx" && typeof source.nextMedia.sourcePath === "string") {
      let resolved = null;
      try {
        resolved = resolveLocalPath(source.nextMedia.sourcePath);
      } catch {
        resolved = null;
      }
      if (typeof resolved === "string" && PPTX_PATH_RE.test(resolved)) {
        pptxPath = resolved;
        deckKey = stageDeckKey(resolved, nextMedia.revision || "");
        nextMedia.deckKey = deckKey;
      }
    }
    out.nextMedia = nextMedia;
  }
  out.nextIsItem = source.nextIsItem === true;
  return { payload: out, pptxPath, deckKey };
}
