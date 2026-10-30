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
 * `ems-media://` URLs for local MP4-family video.
 *
 * Local MP4/M4V/MOV clips are served by the main process (see
 * main-process/media-protocol.mjs) so it can transparently repair the
 * sync-sample table Chromium seeks with. This module is shared by the main
 * process and every renderer; it has no Node or DOM dependencies.
 *
 * URL shape:  ems-media://<access-token>/<opaque-media-id>/<display-name>
 *
 * The main process owns the ID -> approved absolute path registry. Native
 * paths never appear in a URL, and knowing the per-launch host token is not
 * enough to read an unregistered file. The display name is cosmetic (and lets
 * Chromium see a familiar extension); the protocol handler chooses MIME type
 * and content from the registered path only.
 */

export const EMS_MEDIA_SCHEME = "ems-media";
export const EMS_MEDIA_URL_PREFIX = `${EMS_MEDIA_SCHEME}://`;

/** Containers whose `stss` sync table can be repaired (ISO BMFF / QuickTime). */
export const EMS_MEDIA_VIDEO_EXTENSION_RE = /\.(mp4|m4v|mov)$/i;

// The token is the URL host of a standard scheme, so it must start with a
// letter: an all-digit host would be canonicalized as an IPv4 address.
const ACCESS_TOKEN_RE = /^[a-z][a-z0-9]{15,127}$/;
const MEDIA_ID_RE = /^[a-z0-9_-]{16,128}$/i;

export function isValidEmsMediaAccessToken(token) {
  return typeof token === "string" && ACCESS_TOKEN_RE.test(token);
}

export function isEmsMediaUrl(value) {
  return typeof value === "string" && value.slice(0, EMS_MEDIA_URL_PREFIX.length).toLowerCase() === EMS_MEDIA_URL_PREFIX;
}

/** True for native local paths (not URLs) of video files the scheme serves. */
export function isEmsMediaEligiblePath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(filePath)) return false; // already a URL
  return EMS_MEDIA_VIDEO_EXTENSION_RE.test(filePath);
}

/** Convert a local file:// URL to its native-looking path without Node APIs. */
export function localPathFromFileUrl(source) {
  if (typeof source !== "string" || !/^file:\/\//i.test(source)) return "";
  try {
    const url = new URL(source);
    let pathname = decodeURIComponent(url.pathname);
    if (url.hostname) return `//${decodeURIComponent(url.hostname)}${pathname}`;
    if (/^\/[a-z]:\//i.test(pathname)) pathname = pathname.slice(1);
    return pathname;
  } catch {
    return "";
  }
}

/**
 * Create the public URL for a path already registered in the main process.
 * `displayName` is deliberately reduced to one URL segment and is never used
 * to resolve the resource.
 */
export function registeredMediaIdToEmsMediaUrl(mediaId, displayName, accessToken) {
  if (!isValidEmsMediaAccessToken(accessToken) || !MEDIA_ID_RE.test(String(mediaId || ""))) return "";
  const name = String(displayName || "video.mp4").replace(/[\\/]/g, "_") || "video.mp4";
  return `${EMS_MEDIA_URL_PREFIX}${accessToken}/${mediaId}/${encodeURIComponent(name)}`;
}

/**
 * Split an `ems-media://` URL into its access token and opaque media ID.
 * Query strings/fragments (for example a cache-bust) are ignored.
 */
export function parseEmsMediaUrl(url) {
  if (!isEmsMediaUrl(url)) return null;
  const match = String(url).match(/^[^:]+:\/\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)(?:[?#].*)?$/);
  if (!match) return null;
  const token = match[1].toLowerCase();
  const mediaId = match[2];
  if (!isValidEmsMediaAccessToken(token) || !MEDIA_ID_RE.test(mediaId)) return null;
  let displayName;
  try {
    displayName = decodeURIComponent(match[3]);
  } catch {
    return null;
  }
  if (!displayName || displayName.includes("\0") || /[\\/]/.test(displayName)) return null;
  return { token, mediaId, displayName };
}

const crossOriginPolicyInstalled = new WeakSet();

/**
 * Make every <video>/<audio> that loads an `ems-media://` URL do so in CORS
 * mode (`crossorigin="anonymous"`).
 *
 * An ems-media clip is cross-origin to EMS's file:// pages. Without CORS,
 * Chromium >= 134 treats it as tainted: MediaElementAudioSourceNode outputs
 * silence (EMS routes all clip audio through Web Audio), captureStream()
 * throws and canvas readback fails. The protocol handler answers CORS
 * requests, so flagging the element is all that is needed.
 *
 * Wrapping the `src` setter and `setAttribute("src")` covers every call site
 * at once. The attribute is set before the new source is assigned (the load
 * algorithm reads it then) and removed again when the element moves on to a
 * non-ems-media source, so remote streams keep their existing no-cors loads.
 * Elements whose page code set `crossOrigin` itself are left alone.
 */
export function installEmsMediaCrossOriginPolicy(globalObject = globalThis) {
  const MediaElement = globalObject?.HTMLMediaElement;
  if (!MediaElement || crossOriginPolicyInstalled.has(MediaElement)) return false;
  const proto = MediaElement.prototype;
  const srcDescriptor = Object.getOwnPropertyDescriptor(proto, "src");
  if (!srcDescriptor?.set || !srcDescriptor.get) return false;
  const managed = new WeakSet();
  const nativeSetAttribute = globalObject.Element.prototype.setAttribute;
  const nativeRemoveAttribute = globalObject.Element.prototype.removeAttribute;

  const prepare = (element, value) => {
    if (isEmsMediaUrl(String(value ?? ""))) {
      if (element.getAttribute("crossorigin") === null) {
        nativeSetAttribute.call(element, "crossorigin", "anonymous");
        managed.add(element);
      }
    } else if (managed.has(element)) {
      managed.delete(element);
      nativeRemoveAttribute.call(element, "crossorigin");
    }
  };

  Object.defineProperty(proto, "src", {
    configurable: true,
    enumerable: srcDescriptor.enumerable,
    get: srcDescriptor.get,
    set(value) {
      prepare(this, value);
      srcDescriptor.set.call(this, value);
    },
  });
  Object.defineProperty(proto, "setAttribute", {
    configurable: true,
    writable: true,
    value: function setAttribute(name, value) {
      if (typeof name === "string" && name.toLowerCase() === "src") prepare(this, value);
      return nativeSetAttribute.call(this, name, value);
    },
  });
  crossOriginPolicyInstalled.add(MediaElement);
  return true;
}
