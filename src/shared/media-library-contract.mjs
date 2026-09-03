/*
 * Provider-neutral contracts shared by the Media library service, renderer,
 * and tests. Keep filesystem access out of this module.
 */

export const MEDIA_SOURCE_CAPABILITIES = Object.freeze({
  browse: "browse",
  search: "search",
  read: "read",
  thumbnail: "thumbnail",
  watch: "watch",
  download: "download",
  write: "write",
  move: "move",
  delete: "delete",
  shareLink: "share-link",
  licenseMetadata: "license-metadata",
});

export const LOCAL_MEDIA_CAPABILITIES = Object.freeze([
  MEDIA_SOURCE_CAPABILITIES.browse,
  MEDIA_SOURCE_CAPABILITIES.search,
  MEDIA_SOURCE_CAPABILITIES.read,
  MEDIA_SOURCE_CAPABILITIES.thumbnail,
  MEDIA_SOURCE_CAPABILITIES.watch,
]);

export const MEDIA_KINDS = Object.freeze(["image", "video", "audio", "presentation"]);
export const MEDIA_AVAILABILITY = Object.freeze({
  available: "available",
  missing: "missing",
  sourceOffline: "source-offline",
  preparing: "preparing",
  failed: "failed",
});

const EXTENSIONS_BY_KIND = Object.freeze({
  image: new Set(["bmp", "gif", "heic", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]),
  video: new Set(["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "ogv", "webm", "wmv"]),
  audio: new Set(["aac", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "wma"]),
  presentation: new Set(["pptx"]),
});

const MIME_BY_EXTENSION = Object.freeze({
  bmp: "image/bmp", gif: "image/gif", heic: "image/heic", jpeg: "image/jpeg",
  jpg: "image/jpeg", png: "image/png", svg: "image/svg+xml", tif: "image/tiff",
  tiff: "image/tiff", webp: "image/webp", avi: "video/x-msvideo", m4v: "video/x-m4v",
  mkv: "video/x-matroska", mov: "video/quicktime", mp4: "video/mp4", mpeg: "video/mpeg",
  mpg: "video/mpeg", ogv: "video/ogg", webm: "video/webm", wmv: "video/x-ms-wmv",
  aac: "audio/aac", flac: "audio/flac", m4a: "audio/mp4", mp3: "audio/mpeg",
  oga: "audio/ogg", ogg: "audio/ogg", opus: "audio/opus", wav: "audio/wav",
  wma: "audio/x-ms-wma",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
});

export function mediaExtension(fileName) {
  const name = typeof fileName === "string" ? fileName : "";
  const dot = name.lastIndexOf(".");
  return dot > -1 && dot < name.length - 1 ? name.slice(dot + 1).toLocaleLowerCase() : "";
}

export function classifyMediaFile(fileName) {
  const extension = mediaExtension(fileName);
  for (const kind of MEDIA_KINDS) {
    if (EXTENSIONS_BY_KIND[kind].has(extension)) {
      return { kind, extension, mimeType: MIME_BY_EXTENSION[extension] || "application/octet-stream" };
    }
  }
  return null;
}

export function displayNameForMedia(fileName) {
  const name = String(fileName || "");
  const extension = mediaExtension(name);
  return extension ? name.slice(0, -(extension.length + 1)) || name : name;
}

export function normalizeMediaQuery(input = {}) {
  const kinds = Array.isArray(input.kinds)
    ? input.kinds.filter((kind) => MEDIA_KINDS.includes(kind))
    : [];
  const limit = Math.min(200, Math.max(1, Number.parseInt(input.limit, 10) || 60));
  const offset = Math.max(0, Number.parseInt(input.offset, 10) || 0);
  return {
    query: String(input.query || "").trim().slice(0, 300),
    sourceId: typeof input.sourceId === "string" ? input.sourceId.slice(0, 200) : "",
    parentId: typeof input.parentId === "string" ? input.parentId.slice(0, 500) : "",
    kinds,
    availability: Object.values(MEDIA_AVAILABILITY).includes(input.availability)
      ? input.availability
      : "",
    sort: ["name", "modified", "recent"].includes(input.sort) ? input.sort : "name",
    offset,
    limit,
  };
}

export function mediaSourceSupports(source, capability) {
  return Boolean(source && Array.isArray(source.capabilities) && source.capabilities.includes(capability));
}
