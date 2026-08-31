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
export const HAVE_NOTHING = 0;
export const HAVE_METADATA = 1;
export const WAIT_FOR_METADATA_TIMEOUT_MS = 4000;

function mediaMetadataError(mediaEl, fallbackMessage) {
  const mediaError = mediaEl?.error;
  if (!mediaError) return new Error(fallbackMessage);
  const code = Number.isFinite(mediaError.code) ? ` (code ${mediaError.code})` : "";
  const message =
    typeof mediaError.message === "string" && mediaError.message.length > 0
      ? `: ${mediaError.message}`
      : "";
  const error = new Error(`${fallbackMessage}${code}${message}`);
  error.name = "MediaMetadataError";
  error.mediaErrorCode = mediaError.code;
  return error;
}

export function waitForLoadedMetadata(mediaEl) {
  if (!mediaEl || !mediaEl.src || mediaEl.src === "") {
    return Promise.reject(new Error("Invalid media element source."));
  }
  if (mediaEl.readyState >= HAVE_METADATA) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      mediaEl.removeEventListener("loadedmetadata", onLoaded);
      mediaEl.removeEventListener("error", onError);
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    const finishOk = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onLoaded = () => finishOk();
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(mediaMetadataError(mediaEl, "Failed to load media metadata"));
    };

    mediaEl.addEventListener("loadedmetadata", onLoaded, { once: true });
    mediaEl.addEventListener("error", onError, { once: true });
    if (mediaEl.readyState === HAVE_NOTHING) {
      mediaEl.load();
    }
    timer = window.setTimeout(finishOk, WAIT_FOR_METADATA_TIMEOUT_MS);
  });
}

export function waitForMetadata(mediaEl, callbacks = {}) {
  const isLiveStream = callbacks.isLiveStream || (() => false);
  const isImg = callbacks.isImg || (() => false);
  const onResolved = callbacks.onResolved || (() => {});
  const onRejected = callbacks.onRejected || (() => {});

  if (
    !mediaEl ||
    !mediaEl.src ||
    mediaEl.src === "" ||
    isLiveStream(mediaEl.src) ||
    isImg(mediaEl.src)
  ) {
    onRejected();
    return Promise.reject(new Error("Invalid source or live stream."));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      mediaEl.removeEventListener("loadedmetadata", onMetadata);
      mediaEl.removeEventListener("canplaythrough", onCanPlayThrough);
      mediaEl.removeEventListener("error", onError);
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    const finishOk = (event) => {
      if (settled) return;
      settled = true;
      cleanup();
      onResolved(event || {}, resolve, mediaEl);
    };
    const onMetadata = () => finishOk();
    const onCanPlayThrough = (event) => finishOk(event);
    const onError = (event) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(mediaMetadataError(mediaEl, "Failed to load media metadata"));
    };

    if (mediaEl.readyState >= HAVE_METADATA) {
      finishOk();
      return;
    }

    mediaEl.addEventListener("loadedmetadata", onMetadata, { once: true });
    mediaEl.addEventListener("canplaythrough", onCanPlayThrough, { once: true });
    mediaEl.addEventListener("error", onError, { once: true });

    if (mediaEl.readyState === HAVE_NOTHING) {
      mediaEl.load();
    }

    timer = window.setTimeout(() => finishOk(), WAIT_FOR_METADATA_TIMEOUT_MS);
  });
}
