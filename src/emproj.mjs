import { createHash, randomUUID } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
} from "fs/promises";
import os from "os";
import path from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import {
  baselineFileHashFields,
  hashMediaFile,
  storedFileHashFromRecord,
} from "./media-file-hash.min.mjs";
import yauzl from "yauzl";
import yazl from "yazl";

function normalizeToSongAST(song) {
  if (!song || typeof song !== "object") return null;

  const id = song.id || "";
  const title = song.title || "Untitled Song";
  const songNumber = Number.isFinite(song.songNumber) && song.songNumber > 0 ? song.songNumber : undefined;
  const folderId = typeof song.folderId === "string" && song.folderId.trim() ? song.folderId.trim() : null;

  const authors = Array.isArray(song.metadata?.authors) ? song.metadata.authors : [];
  const copyright = song.metadata?.copyright || "";
  const ccliNumber = song.metadata?.ccliNumber || song.metadata?.ccli_number || "";
  const oneLicense = song.metadata?.oneLicense || song.metadata?.one_license || "";
  const meter = song.metadata?.meter || song.metadata?.hymnal?.meter || "";
  const rawHymnal =
    song.metadata?.hymnal && typeof song.metadata.hymnal === "object"
      ? song.metadata.hymnal
      : { name: null, number: null, display: null };
  const hymnal = { ...rawHymnal, ...(meter ? { meter } : {}) };

  const sections = (Array.isArray(song.sections) ? song.sections : []).map(sec => {
    const kind = (sec.kind || "verse").toLowerCase();
    const label = sec.label || "";

    let blocks = [];
    if (Array.isArray(sec.blocks)) {
      blocks = sec.blocks.map(block => ({
        type: block.type || "lyricLine",
        id: block.id || `block_${Math.random().toString(36).substring(2, 9)}`,
        primary: {
          lang: block.primary?.lang || "en",
          segments: Array.isArray(block.primary?.segments) ? block.primary.segments : [
            { type: "text", text: block.primary?.text || "" }
          ]
        },
        translations: Array.isArray(block.translations) ? block.translations : [],
        annotations: Array.isArray(block.annotations) ? block.annotations : []
      }));
    }

    return {
      id: sec.id || `sec_${Math.random().toString(36).substring(2, 9)}`,
      kind,
      label,
      blocks
    };
  });

  const playOrder = [];
  if (Array.isArray(song.playOrder)) {
    for (const item of song.playOrder) {
      if (typeof item === "string") {
        playOrder.push({ sectionId: item });
      } else if (item && typeof item === "object") {
        playOrder.push({ sectionId: item.sectionId || item.id });
      }
    }
  } else if (Array.isArray(song.arrangements?.[0]?.sequence)) {
    for (const secId of song.arrangements[0].sequence) {
      playOrder.push({ sectionId: secId });
    }
  } else {
    for (const sec of sections) {
      playOrder.push({ sectionId: sec.id });
    }
  }

  const defaultRender = song.defaultRender || undefined;

  return {
    schema: "ems.song.v1",
    id,
    title,
    songNumber,
    folderId,
    metadata: {
      authors,
      copyright,
      ccliNumber,
      oneLicense,
      meter,
      hymnal
    },
    languages: song.languages || [
      { id: "en", name: "English", default: true }
    ],
    sections,
    playOrder,
    presentation: song.presentation || {
      defaultChunking: {
        mode: "blocksPerSlide",
        maxBlocks: 4
      }
    },
    defaultRender
  };
}

const MIME_TYPE = "application/vnd.ems.project+zip";
const ARCHIVE_COMMENT_FORMAT = "application/vnd.ems.project.comment+json";
const ARCHIVE_COMMENT_VERSION = 1;
const PROJECT_FILE_SCHEMA_VERSION = 2;
const PROJECT_DOCUMENTS_INDEX_PATH = "documents.json";
const PROJECT_DOCUMENT_DIR_PREFIX = "documents/";
const BIBLE_URI_PREFIX = "bible://";
const SONG_URI_PREFIX = "song://";
const LEGACY_SLIDE_URI_PREFIX = "slide://";
const IMAGE_EXT = new Set([".bmp", ".gif", ".jpg", ".jpeg", ".png", ".webp", ".svg", ".ico"]);
const VIDEO_EXT = new Set([".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".wmv"]);
const AUDIO_EXT = new Set([".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".wma"]);
const PRESENTATION_EXT = new Set([".pptx"]);
const SCRIPTURE_FONT_FAMILY = "'CMG Sans'";
const SCRIPTURE_BODY_FONT_SIZE = 66;
const SCRIPTURE_MIN_BODY_FONT_SIZE = 38;
const SCRIPTURE_AUTOSIZE_NONE = "none";
const SCRIPTURE_AUTOSIZE_FIT = "fit";
const SCRIPTURE_AUTOSIZE_NORMALIZE = "normalize";
const SCRIPTURE_DEFAULT_AUTOSIZE_MODE = SCRIPTURE_AUTOSIZE_FIT;
const SLIDE_TRANSITION_INHERIT = "inherit";
const SLIDE_TRANSITION_NONE = "none";
const DEFAULT_SLIDE_TRANSITION_DURATION_MS = 350;
const SLIDE_TRANSITION_EFFECTS = new Set([
  SLIDE_TRANSITION_NONE,
  "fade",
  "slide-left",
  "slide-right",
  "zoom",
]);
const SHA256_HASH_ALG = "sha256";
const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;
const PROJECT_GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isLegacyDocumentArchivePath(archivePath) {
  return (
    typeof archivePath === "string" &&
    archivePath.startsWith(PROJECT_DOCUMENT_DIR_PREFIX) &&
    archivePath.endsWith(".json")
  );
}

function normalizeProjectGuid(value) {
  const guid = typeof value === "string" ? value.trim().toLowerCase() : "";
  return PROJECT_GUID_RE.test(guid) ? guid : "";
}

function generatedProjectId() {
  return `proj_${randomUUID().replace(/-/g, "")}`;
}

function projectMetadataFromSnapshot(snapshot, nowIso) {
  const project = snapshot?.project && typeof snapshot.project === "object"
    ? snapshot.project
    : {};
  const guid =
    normalizeProjectGuid(snapshot?.projectGuid) ||
    normalizeProjectGuid(project.guid) ||
    randomUUID();
  const created =
    typeof snapshot?.projectCreated === "string" && snapshot.projectCreated.length > 0
      ? snapshot.projectCreated
      : typeof project.created === "string" && project.created.length > 0
        ? project.created
        : nowIso;
  return {
    id: generatedProjectId(),
    guid,
    name: typeof project.name === "string" && project.name.length > 0
      ? project.name
      : "EMS Project",
    created,
    modified: nowIso,
  };
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function asciiJson(value) {
  return JSON.stringify(value).replace(/[^\x20-\x7e]/g, (char) => {
    const code = char.charCodeAt(0).toString(16).padStart(4, "0");
    return `\\u${code}`;
  });
}

function normalizeArchivePath(p) {
  return String(p || "").replace(/\\/g, "/");
}

function basenameAny(p) {
  const parts = String(p || "").split(/[/\\]/);
  return parts[parts.length - 1] || String(p || "");
}

function normalizeProjectSlideTransition(transition = {}, { allowInherit = false } = {}) {
  const source =
    typeof transition === "string"
      ? { effect: transition }
      : transition && typeof transition === "object"
        ? transition
        : {};
  let effect = String(source.effect || source.type || "").trim().toLowerCase();
  if (effect === "global") effect = SLIDE_TRANSITION_INHERIT;
  if (allowInherit && (!effect || effect === SLIDE_TRANSITION_INHERIT)) {
    effect = SLIDE_TRANSITION_INHERIT;
  } else if (!SLIDE_TRANSITION_EFFECTS.has(effect)) {
    effect = SLIDE_TRANSITION_NONE;
  }
  const duration = Number(source.durationMs ?? source.duration);
  return {
    effect,
    durationMs: Number.isFinite(duration)
      ? Math.max(0, Math.min(3000, Math.round(duration)))
      : DEFAULT_SLIDE_TRANSITION_DURATION_MS,
  };
}

function projectSlideTransitionOverride(transition) {
  if (!transition || typeof transition !== "object") return undefined;
  const normalized = normalizeProjectSlideTransition(transition, { allowInherit: true });
  return normalized.effect === SLIDE_TRANSITION_INHERIT ? undefined : normalized;
}

function bibleArchivePath(reference, version) {
  const safeVersion =
    typeof version === "string" && version.trim() ? version.trim() : "KJV";
  const safeReference = typeof reference === "string" ? reference.trim() : "";
  return `${BIBLE_URI_PREFIX}${encodeURIComponent(`${safeVersion}:${safeReference}`)}`;
}

function parseBibleArchivePath(filePath) {
  if (typeof filePath !== "string" || !filePath.startsWith(BIBLE_URI_PREFIX)) {
    return null;
  }
  try {
    const payload = decodeURIComponent(filePath.slice(BIBLE_URI_PREFIX.length));
    const separatorIndex = payload.indexOf(":");
    if (separatorIndex < 0) {
      return {
        version: "KJV",
        reference: payload,
      };
    }
    return {
      version: payload.slice(0, separatorIndex) || "KJV",
      reference: payload.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function songArchivePath(songId) {
  const safeId = typeof songId === "string" ? songId.trim() : "";
  return `${SONG_URI_PREFIX}${encodeURIComponent(safeId)}`;
}

function parseSongArchivePath(filePath) {
  if (typeof filePath !== "string" || !filePath.startsWith(SONG_URI_PREFIX)) {
    return null;
  }
  try {
    return decodeURIComponent(filePath.slice(SONG_URI_PREFIX.length));
  } catch {
    return filePath.slice(SONG_URI_PREFIX.length);
  }
}

function isLegacySlideQueueItem(item) {
  return (
    item?.type === "slide" ||
    (typeof item?.path === "string" && item.path.startsWith(LEGACY_SLIDE_URI_PREFIX)) ||
    (typeof item?.source?.path === "string" && item.source.path.startsWith(LEGACY_SLIDE_URI_PREFIX))
  );
}

function normalizedBibleVersion(value, fallback = "KJV") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizedBibleReference(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizedPositiveIntArray(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const verse = Math.trunc(n);
    if (verse <= 0 || seen.has(verse)) return;
    seen.add(verse);
    result.push(verse);
  });
  return result;
}

function normalizeScriptureAutosizeMode(value) {
  if (value === SCRIPTURE_AUTOSIZE_NONE) return SCRIPTURE_AUTOSIZE_NONE;
  if (value === SCRIPTURE_AUTOSIZE_NORMALIZE) return SCRIPTURE_AUTOSIZE_NORMALIZE;
  return SCRIPTURE_AUTOSIZE_FIT;
}

function normalizeScriptureMinFontSize(value, preferredFontSize = SCRIPTURE_BODY_FONT_SIZE) {
  const preferred = Number.isFinite(preferredFontSize)
    ? Math.max(20, Math.min(160, Math.round(preferredFontSize)))
    : SCRIPTURE_BODY_FONT_SIZE;
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) ? numeric : SCRIPTURE_MIN_BODY_FONT_SIZE;
  return Math.max(20, Math.min(preferred, Math.round(resolved)));
}

function bibleProjectReferenceOnly(scripture = {}, opts = {}) {
  const source = scripture && typeof scripture === "object" ? scripture : {};
  const pathEntry = opts?.pathEntry && typeof opts.pathEntry === "object"
    ? opts.pathEntry
    : {};
  const selectedVerses = normalizedPositiveIntArray(source.selectedVerses);
  const result = {
    version: normalizedBibleVersion(source.version, normalizedBibleVersion(pathEntry.version)),
    reference: normalizedBibleReference(
      source.reference,
      normalizedBibleReference(pathEntry.reference),
    ),
    book: typeof source.book === "string" ? source.book : "",
    chapter: Number.isFinite(source.chapter) ? source.chapter : 1,
    verse: Number.isFinite(source.verse) ? source.verse : 0,
    verseEnd: Number.isFinite(source.verseEnd) ? source.verseEnd : 0,
    verseSelector: typeof source.verseSelector === "string" ? source.verseSelector : "",
    fontFamily:
      typeof source.fontFamily === "string" && source.fontFamily
        ? source.fontFamily
        : SCRIPTURE_FONT_FAMILY,
    fontSize: Number.isFinite(source.fontSize) ? source.fontSize : undefined,
    autosizeMode: normalizeScriptureAutosizeMode(source.autosizeMode),
    minFontSize: Number.isFinite(source.minFontSize)
      ? normalizeScriptureMinFontSize(source.minFontSize, source.fontSize)
      : SCRIPTURE_MIN_BODY_FONT_SIZE,
    autoSplit: typeof source.autoSplit === "boolean" ? source.autoSplit : true,
    autosizeGroupFontSize: Number.isFinite(source.autosizeGroupFontSize)
      ? Math.max(20, Math.min(160, Math.round(source.autosizeGroupFontSize)))
      : undefined,
    autosizeGroupScope:
      typeof source.autosizeGroupScope === "string" ? source.autosizeGroupScope : "",
    color: typeof source.color === "string" && source.color ? source.color : "#ffffff",
    lowerThirdColor:
      typeof source.lowerThirdColor === "string" && source.lowerThirdColor
        ? source.lowerThirdColor
        : "#ffffff",
    lowerThirdChromaKeyColor:
      typeof source.lowerThirdChromaKeyColor === "string" && source.lowerThirdChromaKeyColor
        ? source.lowerThirdChromaKeyColor
        : "#00ff00",
    backgroundColor:
      typeof source.backgroundColor === "string" && source.backgroundColor
        ? source.backgroundColor
        : "#000000",
    backgroundPath:
      typeof opts.backgroundPath === "string"
        ? opts.backgroundPath
        : typeof source.backgroundPath === "string"
          ? source.backgroundPath
          : "",
    look:
      source.look === "lower-third" || source.look === "fullscreen"
        ? source.look
        : "fullscreen",
    lowerThirdSegmentIndex: Number.isFinite(source.lowerThirdSegmentIndex)
      ? Math.max(0, Math.trunc(source.lowerThirdSegmentIndex))
      : 0,
  };
  if (selectedVerses.length > 0) result.selectedVerses = selectedVerses;
  if (typeof opts.backgroundAssetId === "string" && opts.backgroundAssetId) {
    result.backgroundAssetId = opts.backgroundAssetId;
  }
  return result;
}

function normalizeProjectScriptureOverrides(overrides = {}) {
  if (!overrides || typeof overrides !== "object") {
    return {
      fontFamily: "",
      fontSize: undefined,
      autosizeMode: "",
      minFontSize: undefined,
      autoSplit: undefined,
      color: "",
      backgroundColor: "",
      backgroundPath: "",
      lowerThirdColor: "",
      lowerThirdChromaKeyColor: "",
    };
  }
  return {
    fontFamily:
      typeof overrides.fontFamily === "string" ? overrides.fontFamily : "",
    fontSize:
      Number.isFinite(overrides.fontSize) ? overrides.fontSize : undefined,
    autosizeMode:
      typeof overrides.autosizeMode === "string" && overrides.autosizeMode
        ? normalizeScriptureAutosizeMode(overrides.autosizeMode)
        : "",
    minFontSize:
      Number.isFinite(overrides.minFontSize)
        ? normalizeScriptureMinFontSize(overrides.minFontSize, overrides.fontSize)
        : undefined,
    autoSplit:
      typeof overrides.autoSplit === "boolean" ? overrides.autoSplit : undefined,
    color:
      typeof overrides.color === "string" ? overrides.color : "",
    backgroundColor:
      typeof overrides.backgroundColor === "string" ? overrides.backgroundColor : "",
    backgroundPath:
      typeof overrides.backgroundPath === "string" ? overrides.backgroundPath : "",
    lowerThirdColor:
      typeof overrides.lowerThirdColor === "string" ? overrides.lowerThirdColor : "",
    lowerThirdChromaKeyColor:
      typeof overrides.lowerThirdChromaKeyColor === "string"
        ? overrides.lowerThirdChromaKeyColor
        : "",
  };
}

function projectScriptureTextFromOverrides(overrides = {}) {
  const normalized = normalizeProjectScriptureOverrides(overrides);
  if (
    !normalized.fontFamily &&
    !Number.isFinite(normalized.fontSize) &&
    !normalized.autosizeMode &&
    !Number.isFinite(normalized.minFontSize) &&
    typeof normalized.autoSplit !== "boolean" &&
    !normalized.color &&
    !normalized.backgroundColor &&
    !normalized.backgroundPath &&
    !normalized.lowerThirdColor &&
    !normalized.lowerThirdChromaKeyColor
  ) {
    return undefined;
  }
  return {
    appliesTo: "scripture",
    themeOverrides: {
      textContainer: {
        typography: {
          fontFamily: normalized.fontFamily || undefined,
          fontSize: Number.isFinite(normalized.fontSize) ? normalized.fontSize : undefined,
          autosizeMode: normalized.autosizeMode || undefined,
          minFontSize: Number.isFinite(normalized.minFontSize)
            ? normalized.minFontSize
            : undefined,
          autoSplit:
            typeof normalized.autoSplit === "boolean" ? normalized.autoSplit : undefined,
          fontColor: normalized.color || undefined,
        },
      },
      background: {
        color: normalized.backgroundColor || undefined,
      },
    },
    presentation: {
      fontFamily: normalized.fontFamily || undefined,
      fontSize: Number.isFinite(normalized.fontSize) ? normalized.fontSize : undefined,
      autosizeMode: normalized.autosizeMode || undefined,
      minFontSize: Number.isFinite(normalized.minFontSize)
        ? normalized.minFontSize
        : undefined,
      autoSplit:
        typeof normalized.autoSplit === "boolean" ? normalized.autoSplit : undefined,
      textColor: normalized.color || undefined,
      backgroundColor: normalized.backgroundColor || undefined,
      backgroundPath: normalized.backgroundPath || "",
      lowerThirdTextColor: normalized.lowerThirdColor || undefined,
      lowerThirdChromaKeyColor: normalized.lowerThirdChromaKeyColor || undefined,
    },
  };
}

function fileUrlToPath(p) {
  return fileURLToPath(p);
}

function assertSafeArchivePath(p) {
  const normalized = normalizeArchivePath(p);
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized === ".." ||
    normalized.includes("../") ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new Error(`Unsafe archive path: ${p}`);
  }
  return normalized;
}

function classifyKindFromPath(p) {
  const ext = path.extname(p).toLowerCase();
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (IMAGE_EXT.has(ext)) return "image";
  if (PRESENTATION_EXT.has(ext)) return "presentation";
  return "other";
}

function sequenceItemPlaybackStartTime(item, kind) {
  if (item?.type === "scripture" || kind === "image" || kind === "presentation") {
    return 0;
  }
  return Number.isFinite(item?.playback?.startTime) && item.playback.startTime > 0
    ? item.playback.startTime
    : 0;
}

function queueItemSupportsPlaybackStart(item) {
  const type = item?.type || classifyKindFromPath(item?.path || "");
  return type === "audio" || type === "video" || type === "file" || type === "other";
}

function queueItemPlaybackStartTime(item) {
  return queueItemSupportsPlaybackStart(item) &&
    Number.isFinite(item?.cueStartTime) &&
    item.cueStartTime > 0
    ? item.cueStartTime
    : 0;
}

function contentLocationForKind(kind) {
  return kind === "presentation" ? "presentations" : "media";
}

function cloneJsonValue(value) {
  if (value == null) return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function resolveAssetPath(asset, extractedMediaPaths) {
  if (!asset || typeof asset.path !== "string") return "";
  return extractedMediaPaths.get(asset.path) || asset.path;
}

function resolveDeckSnapshotAssetPaths(deck, assetById, extractedMediaPaths) {
  const copy = cloneJsonValue(deck);
  if (!copy || typeof copy !== "object") return copy;
  const resolveBackground = (bg) => {
    if (!bg || typeof bg !== "object") return;
    if (typeof bg.assetId === "string") {
      const resolved = resolveAssetPath(assetById.get(bg.assetId), extractedMediaPaths);
      if (resolved) bg.path = resolved;
    } else if (typeof bg.path === "string" && extractedMediaPaths.has(bg.path)) {
      bg.path = extractedMediaPaths.get(bg.path);
    }
  };
  const resolveImageObject = (obj) => {
    if (!obj?.image || typeof obj.image !== "object") return;
    if (typeof obj.image.assetId === "string") {
      const resolved = resolveAssetPath(assetById.get(obj.image.assetId), extractedMediaPaths);
      if (resolved) obj.image.path = resolved;
    } else if (typeof obj.image.path === "string" && extractedMediaPaths.has(obj.image.path)) {
      obj.image.path = extractedMediaPaths.get(obj.image.path);
    }
  };
  if (copy.theme && typeof copy.theme === "object" && typeof copy.theme.backgroundAssetId === "string") {
    const resolved = resolveAssetPath(assetById.get(copy.theme.backgroundAssetId), extractedMediaPaths);
    if (resolved) copy.theme.backgroundPath = resolved;
  }
  for (const page of Array.isArray(copy.pages) ? copy.pages : []) {
    resolveBackground(page?.background);
    for (const obj of Array.isArray(page?.objects) ? page.objects : []) {
      resolveBackground(obj?.background);
      resolveImageObject(obj);
    }
  }
  return copy;
}

async function sha256Buffer(buf) {
  const hash = createHash(SHA256_HASH_ALG);
  hash.update(buf);
  return hash.digest("hex");
}

async function sha256File(filePath) {
  const hash = createHash(SHA256_HASH_ALG);
  const input = createReadStream(filePath);
  input.on("data", (chunk) => hash.update(chunk));
  await new Promise((resolve, reject) => {
    input.on("end", resolve);
    input.on("error", reject);
  });
  return hash.digest("hex");
}

function sha256Transform() {
  const hash = createHash(SHA256_HASH_ALG);
  const stream = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  return {
    stream,
    digest: () => hash.digest("hex"),
  };
}

function normalizeSha256Hex(value) {
  const hash = typeof value === "string" ? value.toLowerCase() : "";
  return SHA256_HEX_RE.test(hash) ? hash : "";
}

function packedIntegrityFields(digestHex) {
  const integrityHash = normalizeSha256Hex(digestHex);
  return integrityHash
    ? {
        integrityHash,
        integrityHashAlg: SHA256_HASH_ALG,
      }
    : {};
}

function normalizeApplicationInfo(appInfo) {
  const source = appInfo && typeof appInfo === "object" ? appInfo : {};
  const legacyVersion = typeof appInfo === "string" ? appInfo.trim() : "";
  const name =
    typeof source.name === "string" && source.name.trim()
      ? source.name.trim()
      : "unknown";
  const version =
    typeof source.version === "string" && source.version.trim()
      ? source.version.trim()
      : legacyVersion || "unknown";
  return { name, version };
}

function buildProjectArchiveComment({
  application,
  manifestHash,
  projectGuid,
  savedAt,
}) {
  const comment = {
    format: ARCHIVE_COMMENT_FORMAT,
    version: ARCHIVE_COMMENT_VERSION,
    guid: normalizeProjectGuid(projectGuid),
    savedBy: `${application.name}/${application.version}`,
    appName: application.name,
    appVersion: application.version,
    savedAt,
    manifestHashAlg: SHA256_HASH_ALG,
    manifestHash: normalizeSha256Hex(manifestHash),
  };
  return asciiJson(comment);
}

function parseProjectArchiveComment(rawComment) {
  const text = Buffer.isBuffer(rawComment)
    ? rawComment.toString("utf8")
    : typeof rawComment === "string"
      ? rawComment
      : "";
  if (!text.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.format !== ARCHIVE_COMMENT_FORMAT) return null;
  if (parsed.version !== ARCHIVE_COMMENT_VERSION) {
    throw new Error("Unsupported EMS project archive comment version");
  }
  const guid = normalizeProjectGuid(parsed.guid);
  const manifestHash = normalizeSha256Hex(parsed.manifestHash);
  if (!guid || parsed.manifestHashAlg !== SHA256_HASH_ALG || !manifestHash) {
    throw new Error("Invalid EMS project archive comment");
  }
  return {
    guid,
    manifestHash,
    savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
    savedBy: typeof parsed.savedBy === "string" ? parsed.savedBy : "",
  };
}

async function verifyProjectArchiveComment(comment, manifestJson, manifestBuffer) {
  if (!comment) return;
  const manifestGuid = normalizeProjectGuid(manifestJson?.project?.guid);
  if (!manifestGuid || comment.guid !== manifestGuid) {
    throw new Error("Project archive comment GUID does not match manifest");
  }
  const actualManifestHash = await sha256Buffer(manifestBuffer);
  if (comment.manifestHash !== actualManifestHash) {
    throw new Error("Project archive comment manifest hash does not match manifest.json");
  }
}

function assetFingerprintFields(fallback = {}, digestHex) {
  if (typeof digestHex === "string" && digestHex.length > 0) {
    return baselineFileHashFields(digestHex);
  }
  const stored = storedFileHashFromRecord(fallback);
  if (stored) {
    return baselineFileHashFields(stored);
  }
  return {};
}

function statModifiedTime(info) {
  return info?.mtime instanceof Date && Number.isFinite(info.mtime.getTime())
    ? info.mtime.toISOString()
    : undefined;
}

function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err) return reject(err);
      resolve(zipfile);
    });
  });
}

function openZipReadStream(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      resolve(stream);
    });
  });
}

async function readEntryBuffer(zipfile, entry) {
  const rs = await openZipReadStream(zipfile, entry);
  const chunks = [];
  for await (const chunk of rs) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function hashZipEntry(zipfile, entry) {
  const rs = await openZipReadStream(zipfile, entry);
  const hash = createHash(SHA256_HASH_ALG);
  for await (const chunk of rs) hash.update(chunk);
  return hash.digest("hex");
}

export async function readEmprojProjectGuid(projectPath) {
  const zipfile = await openZip(projectPath);
  let archiveComment = null;
  try {
    archiveComment = parseProjectArchiveComment(zipfile.comment);
  } catch (err) {
    zipfile.close();
    throw err;
  }
  const rootFiles = new Map();
  const entryHashes = new Map();
  await new Promise((resolve, reject) => {
    zipfile.on("entry", async (entry) => {
      try {
        const inZipPath = assertSafeArchivePath(entry.fileName);
        if (inZipPath.endsWith("/")) {
          zipfile.readEntry();
          return;
        }
        if (
          inZipPath === "mimetype" ||
          inZipPath === "manifest.json" ||
          inZipPath === "queue.json" ||
          inZipPath === "assets.json" ||
          inZipPath === "outputs.json" ||
          inZipPath === "diagnostics.json" ||
          inZipPath === PROJECT_DOCUMENTS_INDEX_PATH
        ) {
          const buffer = await readEntryBuffer(zipfile, entry);
          rootFiles.set(inZipPath, buffer);
          entryHashes.set(inZipPath, await sha256Buffer(buffer));
          zipfile.readEntry();
          return;
        }
        if (isLegacyDocumentArchivePath(inZipPath)) {
          if (!archiveComment) {
            entryHashes.set(inZipPath, await hashZipEntry(zipfile, entry));
          }
          zipfile.readEntry();
          return;
        }
        if (inZipPath.startsWith("media/") || inZipPath.startsWith("presentations/")) {
          if (!archiveComment) {
            entryHashes.set(inZipPath, await hashZipEntry(zipfile, entry));
          }
          zipfile.readEntry();
          return;
        }
        zipfile.readEntry();
      } catch (err) {
        reject(err);
      }
    });
    zipfile.once("error", reject);
    zipfile.once("end", resolve);
    zipfile.readEntry();
  });

  const mimetype = rootFiles.get("mimetype")?.toString("utf8").trim();
  if (mimetype !== MIME_TYPE) {
    throw new Error("Invalid project mimetype");
  }
  const manifestJsonRaw = rootFiles.get("manifest.json");
  if (!manifestJsonRaw) throw new Error("Project missing manifest.json");
  const manifestJson = JSON.parse(manifestJsonRaw.toString("utf8"));
  if (archiveComment) {
    await verifyProjectArchiveComment(archiveComment, manifestJson, manifestJsonRaw);
    return normalizeProjectGuid(manifestJson?.project?.guid);
  }
  verifyManifestIntegrity(manifestJson, entryHashes);
  return normalizeProjectGuid(manifestJson?.project?.guid);
}

async function extractEntryToFile(zipfile, entry, outPath) {
  await mkdir(path.dirname(outPath), { recursive: true });
  const rs = await openZipReadStream(zipfile, entry);
  const hasher = sha256Transform();
  await pipeline(rs, hasher.stream, createWriteStream(outPath));
  return hasher.digest();
}

function manifestIntegrityHashes(manifestJson) {
  const hashes = manifestJson?.integrity?.hashes;
  if (!hashes || typeof hashes !== "object") return null;
  return hashes;
}

function isPackedArchiveMediaPath(archivePath) {
  return (
    typeof archivePath === "string" &&
    (archivePath.startsWith("media/") || archivePath.startsWith("presentations/"))
  );
}

function verifyManifestIntegrity(manifestJson, entryHashes) {
  const hashes = manifestIntegrityHashes(manifestJson);
  if (!hashes) {
    throw new Error("Project missing integrity hashes");
  }
  for (const requiredPath of ["queue.json", "assets.json", "outputs.json", "diagnostics.json"]) {
    if (!normalizeSha256Hex(hashes[requiredPath])) {
      throw new Error(`Project integrity missing hash for ${requiredPath}`);
    }
  }
  for (const [rawPath, rawExpected] of Object.entries(hashes)) {
    const archivePath = assertSafeArchivePath(rawPath);
    const expected = normalizeSha256Hex(rawExpected);
    if (!expected) {
      throw new Error(`Project integrity hash is invalid for ${archivePath}`);
    }
    if (archivePath === "mimetype" || archivePath === "manifest.json") {
      throw new Error(`Project integrity must not hash ${archivePath}`);
    }
    const actual = entryHashes.get(archivePath);
    if (!actual) {
      throw new Error(`Project integrity references missing archive member ${archivePath}`);
    }
    if (actual !== expected) {
      throw new Error(`Project integrity mismatch for ${archivePath}`);
    }
  }
}

function verifyAssetIntegrityHashes(assets, manifestJson) {
  const hashes = manifestIntegrityHashes(manifestJson) || {};
  for (const asset of Array.isArray(assets) ? assets : []) {
    if (!asset || typeof asset !== "object") continue;
    const archivePath = typeof asset.path === "string" ? asset.path : "";
    if (!isPackedArchiveMediaPath(archivePath)) continue;
    const integrityHash = normalizeSha256Hex(asset.integrityHash);
    if (asset.integrityHashAlg !== SHA256_HASH_ALG || !integrityHash) {
      throw new Error(`Packed asset missing SHA-256 integrity hash for ${archivePath}`);
    }
    if (normalizeSha256Hex(hashes[archivePath]) !== integrityHash) {
      throw new Error(`Packed asset integrity does not match manifest for ${archivePath}`);
    }
  }
}

function makeId(prefix, n) {
  return `${prefix}_${String(n).padStart(4, "0")}`;
}

function defaultLiveSourceStrategyForPath(filePath) {
  return filePath ? "snapshot" : "reference";
}

function liveSourceFields(liveSource, filePath, opts = {}) {
  const source = liveSource && typeof liveSource === "object" ? liveSource : {};
  const mode =
    opts.mode ||
    (source.mode === "packaged" ? "packaged" : "linked");
  return {
    mode,
    strategy:
      source.strategy === "snapshot" || source.strategy === "reference"
        ? source.strategy
        : defaultLiveSourceStrategyForPath(filePath),
    stagingTier: source.stagingTier === "full" ? "full" : "warn-only",
    originalPath:
      typeof source.originalPath === "string" && source.originalPath.length > 0
        ? source.originalPath
        : filePath,
    snapshotId:
      typeof source.snapshotId === "string" && source.snapshotId.length > 0
        ? source.snapshotId
        : undefined,
    pinnedMtimeMs: Number.isFinite(source.pinnedMtimeMs)
      ? source.pinnedMtimeMs
      : undefined,
    pinnedSizeBytes: Number.isFinite(source.pinnedSizeBytes)
      ? source.pinnedSizeBytes
      : undefined,
    pinnedFileHash:
      typeof source.pinnedFileHash === "string" && source.pinnedFileHash.length > 0
        ? source.pinnedFileHash
        : undefined,
    previousSnapshotId:
      typeof source.previousSnapshotId === "string" &&
      source.previousSnapshotId.length > 0
        ? source.previousSnapshotId
        : undefined,
    reason:
      typeof source.reason === "string" && source.reason.length > 0
        ? source.reason
        : undefined,
  };
}

function queueItemFromSequenceItem(item, resolvedPath, asset = null) {
  const kind = classifyKindFromPath(resolvedPath);
  const sourceKind = item?.source?.kind;
  const originalPath =
    typeof asset?.originalPath === "string" && asset.originalPath.length > 0
      ? asset.originalPath
      : typeof item?.source?.path === "string"
        ? item.source.path
        : undefined;
  const originalName =
    typeof asset?.originalName === "string" && asset.originalName.length > 0
      ? asset.originalName
      : originalPath
        ? basenameAny(originalPath)
        : basenameAny(resolvedPath);
  return {
    path: resolvedPath,
    name: item?.label || basenameAny(resolvedPath),
    type: kind === "presentation" ? "pptx" : kind,
    missing: item?.source?.kind === "missing",
    originalPath,
    originalName,
    fileHash: typeof asset?.fileHash === "string" ? asset.fileHash : undefined,
    fileHashAlg:
      typeof asset?.fileHashAlg === "string" ? asset.fileHashAlg : undefined,
    sizeBytes: Number.isFinite(asset?.sizeBytes) ? asset.sizeBytes : undefined,
    modifiedTime:
      typeof asset?.modifiedTime === "string" ? asset.modifiedTime : undefined,
    autoAdvance: item?.playback?.autoAdvance !== false,
    cueStartTime: sequenceItemPlaybackStartTime(item, kind),
    cueVolume: Number.isFinite(item?.playback?.volume) ? item.playback.volume : undefined,
    loop: item?.playback?.loop === true && kind !== "presentation",
    pptxSlideIndex: Number.isFinite(item?.startSlide) ? item.startSlide - 1 : -1,
    transition: kind === "presentation" ? projectSlideTransitionOverride(item?.transition) : undefined,
    liveSource:
      item?.liveSource && typeof item.liveSource === "object"
        ? liveSourceFields(item.liveSource, resolvedPath, {
            mode: sourceKind === "bundled"
              ? "packaged"
              : item.liveSource.mode === "packaged"
                ? "packaged"
                : "linked",
          })
        : sourceKind === "bundled"
          ? liveSourceFields({}, resolvedPath, { mode: "packaged" })
          : undefined,
  };
}

function buildBibleQueueItemFromSequenceItem(item, assetById, extractedMediaPaths) {
  const scripture = item?.scripture;
  if (!scripture || typeof scripture !== "object") return null;
  const backgroundAsset =
    typeof scripture.backgroundAssetId === "string"
      ? assetById.get(scripture.backgroundAssetId) || null
      : null;
  const backgroundPath =
    typeof backgroundAsset?.path === "string"
      ? extractedMediaPaths.get(backgroundAsset.path) || backgroundAsset.path
      : typeof scripture.backgroundPath === "string"
        ? scripture.backgroundPath
        : "";
  const scriptureReference = bibleProjectReferenceOnly(scripture, {
    pathEntry: parseBibleArchivePath(item?.source?.path),
    backgroundPath,
  });
  const reference = scriptureReference.reference;
  const version = scriptureReference.version;
  return {
    path: bibleArchivePath(reference, version),
    name: `${reference} ${version}`.trim() || "Bible",
    type: "bible",
    missing: false,
    originalPath: undefined,
    originalName: undefined,
    autoAdvance: item?.playback?.autoAdvance !== false,
    cueStartTime: 0,
    cueVolume: Number.isFinite(item?.playback?.volume) ? item.playback.volume : undefined,
    transition: projectSlideTransitionOverride(item?.transition),
    bible: scriptureReference,
  };
}

function buildSongQueueItemFromSequenceItem(item, assetById, extractedMediaPaths, songFiles) {
  let snapshot = item?.songSnapshot;
  const deckSnapshot = item?.deckSnapshot && typeof item.deckSnapshot === "object"
    ? item.deckSnapshot
    : null;
  const songId =
    typeof snapshot?.id === "string"
      ? snapshot.id
      : typeof deckSnapshot?.id === "string"
        ? deckSnapshot.id
      : typeof item?.source?.songId === "string"
        ? item.source.songId
        : typeof item?.source?.deckId === "string"
          ? item.source.deckId
        : "";
  if (!songId) return null;

  if (!snapshot && songFiles) {
    const rawSong = songFiles.get(`songs/${songId}.json`);
    if (rawSong) {
      try {
        snapshot = JSON.parse(rawSong.toString("utf8"));
      } catch (err) {
        console.error(`Failed to parse embedded song ${songId}:`, err);
      }
    }
  }

  if (snapshot) {
    snapshot = normalizeToSongAST(snapshot);
  }

  if ((!snapshot || typeof snapshot !== "object") && !deckSnapshot) return null;
  const backgroundAsset =
    typeof item?.render?.backgroundAssetId === "string"
      ? assetById.get(item.render.backgroundAssetId) || null
      : null;
  const backgroundPath =
    typeof backgroundAsset?.path === "string"
      ? extractedMediaPaths.get(backgroundAsset.path) || backgroundAsset.path
      : typeof item?.render?.backgroundPath === "string"
        ? item.render.backgroundPath
        : "";
  return {
    path: item?.type === "deck" ? `deck://${encodeURIComponent(songId)}` : songArchivePath(songId),
    name: item?.label || snapshot?.title || deckSnapshot?.title || "Song",
    type: item?.type === "deck" ? "deck" : "song",
    missing: false,
    originalPath: undefined,
    originalName: undefined,
    autoAdvance: item?.playback?.autoAdvance !== false,
    cueStartTime: 0,
    cueVolume: Number.isFinite(item?.playback?.volume) ? item.playback.volume : undefined,
    transition: projectSlideTransitionOverride(item?.transition),
    source: item?.source,
    songSnapshot: deckSnapshot ? undefined : snapshot,
    sequence: item?.sequence,
    render: {
      ...(item?.render && typeof item.render === "object" ? item.render : {}),
      backgroundPath,
    },
    ...(deckSnapshot ? { deckSnapshot } : {}),
  };
}

export async function loadEmprojSnapshot(projectPath) {
  const extractRoot = await mkdtemp(path.join(os.tmpdir(), "ems-emproj-"));
  try {
    return await readEmprojSnapshotInto(projectPath, extractRoot);
  } catch (err) {
    await rm(extractRoot, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

async function readEmprojSnapshotInto(projectPath, extractRoot) {
  const zipfile = await openZip(projectPath);
  let archiveComment = null;
  try {
    archiveComment = parseProjectArchiveComment(zipfile.comment);
  } catch (err) {
    zipfile.close();
    throw err;
  }
  const extractedMediaPaths = new Map();
  const rootFiles = new Map();
  const songFiles = new Map();
  const deckFiles = new Map();
  const entryHashes = new Map();

  await new Promise((resolve, reject) => {
    zipfile.on("entry", async (entry) => {
      try {
        const inZipPath = assertSafeArchivePath(entry.fileName);
        if (inZipPath.endsWith("/")) {
          zipfile.readEntry();
          return;
        }
        if (
          inZipPath === "mimetype" ||
          inZipPath === "manifest.json" ||
          inZipPath === "queue.json" ||
          inZipPath === "assets.json" ||
          inZipPath === "outputs.json" ||
          inZipPath === "diagnostics.json" ||
          inZipPath === PROJECT_DOCUMENTS_INDEX_PATH
        ) {
          const buffer = await readEntryBuffer(zipfile, entry);
          rootFiles.set(inZipPath, buffer);
          entryHashes.set(inZipPath, await sha256Buffer(buffer));
          zipfile.readEntry();
          return;
        }
        if (isLegacyDocumentArchivePath(inZipPath)) {
          entryHashes.set(inZipPath, await hashZipEntry(zipfile, entry));
          zipfile.readEntry();
          return;
        }
        if (inZipPath.startsWith("songs/") && inZipPath.endsWith(".json")) {
          const buffer = await readEntryBuffer(zipfile, entry);
          songFiles.set(inZipPath, buffer);
          entryHashes.set(inZipPath, await sha256Buffer(buffer));
          zipfile.readEntry();
          return;
        }
        if (inZipPath.startsWith("slides/") && inZipPath.endsWith(".json")) {
          const buffer = await readEntryBuffer(zipfile, entry);
          deckFiles.set(inZipPath, buffer);
          entryHashes.set(inZipPath, await sha256Buffer(buffer));
          zipfile.readEntry();
          return;
        }
        if (inZipPath.startsWith("media/") || inZipPath.startsWith("presentations/")) {
          const outPath = path.join(extractRoot, inZipPath);
          entryHashes.set(inZipPath, await extractEntryToFile(zipfile, entry, outPath));
          extractedMediaPaths.set(inZipPath, outPath);
        }
        zipfile.readEntry();
      } catch (err) {
        reject(err);
      }
    });
    zipfile.once("error", reject);
    zipfile.once("end", resolve);
    zipfile.readEntry();
  });

  const mimetype = rootFiles.get("mimetype")?.toString("utf8").trim();
  if (mimetype !== MIME_TYPE) {
    throw new Error("Invalid project mimetype");
  }

  let manifestJson = {};
  const manifestJsonRaw = rootFiles.get("manifest.json");
  if (!manifestJsonRaw) {
    throw new Error("Project missing manifest.json");
  }
  try {
    manifestJson = JSON.parse(manifestJsonRaw.toString("utf8"));
  } catch (err) {
    throw new Error(`Project manifest.json is corrupt: ${err.message}`);
  }
  await verifyProjectArchiveComment(archiveComment, manifestJson, manifestJsonRaw);
  verifyManifestIntegrity(manifestJson, entryHashes);

  const queueJsonRaw = rootFiles.get("queue.json");
  if (!queueJsonRaw) throw new Error("Project missing queue.json");
  let queueJson;
  try {
    queueJson = JSON.parse(queueJsonRaw.toString("utf8"));
  } catch (err) {
    throw new Error(`Project queue.json is corrupt: ${err.message}`);
  }
  const sequence = Array.isArray(queueJson.sequence) ? queueJson.sequence : [];
  let assetsJson = { assets: [] };
  const assetsJsonRaw = rootFiles.get("assets.json");
  if (assetsJsonRaw) {
    try {
      assetsJson = JSON.parse(assetsJsonRaw.toString("utf8"));
    } catch (err) {
      throw new Error(`Project assets.json is corrupt: ${err.message}`);
    }
  }
  const assets = Array.isArray(assetsJson.assets) ? assetsJson.assets : [];
  verifyAssetIntegrityHashes(assets, manifestJson);
  const assetById = new Map();
  const assetByPath = new Map();
  for (const asset of assets) {
    if (!asset || typeof asset !== "object") continue;
    if (typeof asset.id === "string") assetById.set(asset.id, asset);
    if (typeof asset.path === "string") assetByPath.set(asset.path, asset);
  }

  const projectScriptureText =
    queueJson.projectScriptureText && typeof queueJson.projectScriptureText === "object"
      ? queueJson.projectScriptureText
      : {};
  const projectScripturePresentation =
    projectScriptureText.presentation && typeof projectScriptureText.presentation === "object"
      ? projectScriptureText.presentation
      : {};
  const projectScriptureBackgroundAssetId =
    typeof projectScripturePresentation.backgroundAssetId === "string"
      ? projectScripturePresentation.backgroundAssetId
      : typeof projectScriptureText.themeOverrides?.background?.assetId === "string"
        ? projectScriptureText.themeOverrides.background.assetId
        : "";
  const projectScriptureBackgroundAsset = projectScriptureBackgroundAssetId
    ? assetById.get(projectScriptureBackgroundAssetId) || null
    : null;
  const projectScriptureOverrides = normalizeProjectScriptureOverrides({
    fontFamily:
      typeof projectScripturePresentation.fontFamily === "string"
        ? projectScripturePresentation.fontFamily
        : typeof projectScriptureText.themeOverrides?.textContainer?.typography?.fontFamily ===
            "string"
          ? projectScriptureText.themeOverrides.textContainer.typography.fontFamily
          : "",
    fontSize:
      Number.isFinite(projectScripturePresentation.fontSize)
        ? projectScripturePresentation.fontSize
        : Number.isFinite(projectScriptureText.themeOverrides?.textContainer?.typography?.fontSize)
          ? projectScriptureText.themeOverrides.textContainer.typography.fontSize
          : undefined,
    autosizeMode:
      typeof projectScripturePresentation.autosizeMode === "string"
        ? projectScripturePresentation.autosizeMode
        : typeof projectScriptureText.themeOverrides?.textContainer?.typography?.autosizeMode ===
            "string"
          ? projectScriptureText.themeOverrides.textContainer.typography.autosizeMode
          : "",
    minFontSize:
      Number.isFinite(projectScripturePresentation.minFontSize)
        ? projectScripturePresentation.minFontSize
        : Number.isFinite(projectScriptureText.themeOverrides?.textContainer?.typography?.minFontSize)
          ? projectScriptureText.themeOverrides.textContainer.typography.minFontSize
          : undefined,
    autoSplit:
      typeof projectScripturePresentation.autoSplit === "boolean"
        ? projectScripturePresentation.autoSplit
        : typeof projectScriptureText.themeOverrides?.textContainer?.typography?.autoSplit ===
            "boolean"
          ? projectScriptureText.themeOverrides.textContainer.typography.autoSplit
          : undefined,
    color:
      typeof projectScripturePresentation.textColor === "string"
        ? projectScripturePresentation.textColor
        : typeof projectScriptureText.themeOverrides?.textContainer?.typography?.fontColor ===
            "string"
          ? projectScriptureText.themeOverrides.textContainer.typography.fontColor
          : "",
    backgroundColor:
      typeof projectScripturePresentation.backgroundColor === "string"
        ? projectScripturePresentation.backgroundColor
        : typeof projectScriptureText.themeOverrides?.background?.color === "string"
          ? projectScriptureText.themeOverrides.background.color
          : "",
    backgroundPath:
      typeof projectScriptureBackgroundAsset?.path === "string"
        ? extractedMediaPaths.get(projectScriptureBackgroundAsset.path) ||
          projectScriptureBackgroundAsset.path
        : typeof projectScripturePresentation.backgroundPath === "string"
          ? projectScripturePresentation.backgroundPath
          : "",
  });

  const mediaQueue = (
    await Promise.all(sequence.map(async (item) => {
      if (!item || typeof item !== "object" || isLegacySlideQueueItem(item)) return null;
      if (item.type === "scripture" || item.scripture) {
        return buildBibleQueueItemFromSequenceItem(item, assetById, extractedMediaPaths);
      }
      if (item.type === "song" || item.songSnapshot) {
        const built = buildSongQueueItemFromSequenceItem(item, assetById, extractedMediaPaths, songFiles);
        if (built) {
          // If the source is actually a deck, attach the embedded deck snapshot so
          // the renderer can reconstruct the deck-specific editor on demand.
          if (item?.source?.kind === "deck" || item?.source?.deckId || item?.deckSnapshot) {
            const deckId = item.source?.deckId || item.deckSnapshot?.id || built.songSnapshot?.id;
            const rawDeck = deckId ? deckFiles.get(`slides/${deckId}.json`) : null;
            if (rawDeck) {
              try {
                built.deckSnapshot = resolveDeckSnapshotAssetPaths(
                  JSON.parse(rawDeck.toString("utf8")),
                  assetById,
                  extractedMediaPaths,
                );
                built.source = item.source;
              } catch (err) {
                console.error(`Failed to parse embedded deck ${deckId}:`, err);
              }
            } else if (item.deckSnapshot && typeof item.deckSnapshot === "object") {
              built.deckSnapshot = resolveDeckSnapshotAssetPaths(
                item.deckSnapshot,
                assetById,
                extractedMediaPaths,
              );
              built.source = item.source;
            }
          }
        }
        return built;
      }
      let relPath = "";
      if (typeof item?.source?.path === "string") relPath = item.source.path;
      else if (typeof item?.presentationPath === "string") relPath = item.presentationPath;
      else if (typeof item?.path === "string") relPath = item.path;
      if (!relPath) return null;
      const extractedPath = extractedMediaPaths.get(relPath);
      const resolvedPath = extractedPath || relPath;
      const asset =
        (typeof item.assetId === "string" && assetById.get(item.assetId)) ||
        assetByPath.get(relPath) ||
        null;
      const queueItem = queueItemFromSequenceItem(item, resolvedPath, asset);
      if (!extractedPath && item?.source?.kind !== "bundled") {
        try {
          const fsPath = /^file:\/\//i.test(resolvedPath)
            ? fileUrlToPath(resolvedPath)
            : resolvedPath;
          const info = await stat(fsPath);
          queueItem.missing = !info.isFile();
        } catch {
          queueItem.missing = true;
        }
      }
      return queueItem;
    }))
  ).filter(Boolean);
  const manifestProjectGuid = normalizeProjectGuid(manifestJson?.project?.guid) || randomUUID();
  const manifestProjectCreated =
    typeof manifestJson?.project?.created === "string" &&
    manifestJson.project.created.length > 0
      ? manifestJson.project.created
      : new Date().toISOString();

  return {
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    projectPath,
    projectGuid: manifestProjectGuid,
    projectCreated: manifestProjectCreated,
    project: {
      id:
        typeof manifestJson?.project?.id === "string"
          ? manifestJson.project.id
          : undefined,
      guid: manifestProjectGuid,
      name:
        typeof manifestJson?.project?.name === "string"
          ? manifestJson.project.name
          : "EMS Project",
      created: manifestProjectCreated,
      modified:
        typeof manifestJson?.project?.modified === "string"
          ? manifestJson.project.modified
          : undefined,
    },
    currentMode: 0,
    currentQueueIndex: -1,
    previewCueIndex: -1,
    projectStorageMode: manifestJson?.storage?.mode === "packed" ? "packed" : "working",
    projectScriptureText: projectScriptureTextFromOverrides(projectScriptureOverrides),
    mediaQueue,
  };
}

async function addZipFromBuffersAndFiles(targetZipPath, buffers, files, comment = "") {
  await mkdir(path.dirname(targetZipPath), { recursive: true });
  const zipFile = new yazl.ZipFile();
  const out = createWriteStream(targetZipPath);
  const done = new Promise((resolve, reject) => {
    out.on("close", resolve);
    out.on("error", reject);
    zipFile.outputStream.on("error", reject);
  });
  zipFile.outputStream.pipe(out);
  for (const item of buffers) {
    zipFile.addBuffer(item.buffer, item.path, { compress: item.compress !== false });
  }
  for (const item of files) {
    zipFile.addFile(item.realPath, item.path, { compress: item.compress !== false });
  }
  if (comment) {
    zipFile.end({ comment });
  } else {
    zipFile.end();
  }
  await done;
}

export async function saveEmprojSnapshot(
  projectPath,
  snapshot,
  appInfo = {},
  opts = {},
) {
  const packMedia = opts?.packMedia === true;
  const applicationInfo = normalizeApplicationInfo(appInfo);
  const queue = Array.isArray(snapshot?.mediaQueue) ? snapshot.mediaQueue : [];
  const projectScriptureOverrides = normalizeProjectScriptureOverrides(
    snapshot?.projectScriptureText?.presentation && typeof snapshot.projectScriptureText.presentation === "object"
      ? {
          fontFamily: snapshot.projectScriptureText.presentation.fontFamily,
          fontSize: snapshot.projectScriptureText.presentation.fontSize,
          autosizeMode: snapshot.projectScriptureText.presentation.autosizeMode,
          minFontSize: snapshot.projectScriptureText.presentation.minFontSize,
          autoSplit: snapshot.projectScriptureText.presentation.autoSplit,
          color: snapshot.projectScriptureText.presentation.textColor,
          backgroundColor: snapshot.projectScriptureText.presentation.backgroundColor,
          backgroundPath: snapshot.projectScriptureText.presentation.backgroundPath,
          lowerThirdColor: snapshot.projectScriptureText.presentation.lowerThirdTextColor,
          lowerThirdChromaKeyColor:
            snapshot.projectScriptureText.presentation.lowerThirdChromaKeyColor,
        }
      : {},
  );
  const nowIso = new Date().toISOString();
  const projectMetadata = projectMetadataFromSnapshot(snapshot, nowIso);
  const fileIndex = new Map();
  const queueSequence = [];
  const assets = [];
  const fileEntries = [];
  let itemCounter = 0;

  async function registerAssetForPath(filePath, fallback = {}) {
    if (typeof filePath !== "string" || filePath.length === 0) return null;
    const isFileUrl = /^file:\/\//i.test(filePath);
    const normalizedPath = isFileUrl ? fileUrlToPath(filePath) : filePath;
    const isExternalUrl = /^(https?|m3u8|mpd):/i.test(filePath);
    if (isExternalUrl) return null;

    let assetSize = Number.isFinite(fallback.sizeBytes) ? fallback.sizeBytes : undefined;
    let assetFingerprint = assetFingerprintFields(fallback);
    let assetModifiedTime =
      typeof fallback.modifiedTime === "string" ? fallback.modifiedTime : undefined;
    let assetMissing = fallback.missing === true;

    try {
      const info = await stat(normalizedPath);
      if (!info.isFile()) return null;
      const previousSize = assetSize;
      const previousModifiedTime = assetModifiedTime;
      assetSize = info.size;
      assetModifiedTime = statModifiedTime(info);
      assetMissing = false;
      const kind = classifyKindFromPath(normalizedPath);
      const existing = fileIndex.get(normalizedPath);
      if (existing) {
        return {
          assetId: existing.assetId,
          bundledPath: existing.bundledPath,
          normalizedPath,
          kind,
          assetFingerprint,
          assetSize,
          assetModifiedTime,
          assetMissing,
        };
      }
      const ext = path.extname(normalizedPath).toLowerCase();
      const folder = contentLocationForKind(kind);
      const safeBase = path.basename(normalizedPath).replace(/[^A-Za-z0-9._-]/g, "_");
      const assetId = makeId("asset", fileIndex.size + 1);
      let bundledPath = normalizedPath;
      if (packMedia) {
        const bundledName = `${String(fileIndex.size + 1).padStart(4, "0")}_${safeBase}`;
        bundledPath = `${folder}/${bundledName}`;
        fileEntries.push({ realPath: normalizedPath, path: bundledPath, compress: false });
      }
      if (
        packMedia ||
        !storedFileHashFromRecord(assetFingerprint) ||
        previousSize !== assetSize ||
        previousModifiedTime !== assetModifiedTime
      ) {
        try {
          assetFingerprint = baselineFileHashFields(await hashMediaFile(normalizedPath));
        } catch {
          assetFingerprint = {};
        }
      }
      const assetIntegrity = packMedia
        ? packedIntegrityFields(await sha256File(normalizedPath))
        : {};
      fileIndex.set(normalizedPath, { bundledPath, assetId });
      assets.push({
        id: assetId,
        kind,
        path: packMedia ? bundledPath : normalizedPath,
        originalPath: fallback.originalPath || normalizedPath,
        originalName: fallback.originalName || basenameAny(normalizedPath),
        mimeType: kind === "presentation"
          ? (ext === ".pptx"
              ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
              : "application/pdf")
          : undefined,
        ...assetFingerprint,
        ...assetIntegrity,
        sizeBytes: assetSize,
        modifiedTime: assetModifiedTime,
        missingBehavior: "showPlaceholder",
        compatibilityWarnings: [],
      });
      return {
        assetId,
        bundledPath,
        normalizedPath,
        kind,
        assetFingerprint,
        assetSize,
        assetModifiedTime,
        assetMissing,
      };
    } catch {
      return null;
    }
  }

  const deckSnapshotsForExport = new Map();

  async function registerDeckMediaRef(holder, key = "path") {
    if (!holder || typeof holder !== "object" || typeof holder[key] !== "string") return;
    const originalPath = holder[key];
    const asset = await registerAssetForPath(originalPath, {
      originalPath,
      originalName: basenameAny(originalPath),
    });
    if (!asset?.assetId) return;
    holder.assetId = asset.assetId;
    if (packMedia && asset.bundledPath) holder[key] = asset.bundledPath;
  }

  async function deckSnapshotForArchive(item) {
    const deck = item?.deckSnapshot;
    if (!deck || typeof deck !== "object") return null;
    const deckId = deck.id || item.source?.deckId || "";
    if (deckId && deckSnapshotsForExport.has(deckId)) {
      return deckSnapshotsForExport.get(deckId);
    }
    const copy = cloneJsonValue(deck);
    if (copy?.theme && typeof copy.theme.backgroundPath === "string") {
      const asset = await registerAssetForPath(copy.theme.backgroundPath, {
        originalPath: copy.theme.backgroundPath,
        originalName: basenameAny(copy.theme.backgroundPath),
      });
      if (asset?.assetId) {
        copy.theme.backgroundAssetId = asset.assetId;
        if (packMedia && asset.bundledPath) copy.theme.backgroundPath = asset.bundledPath;
      }
    }
    for (const page of Array.isArray(copy?.pages) ? copy.pages : []) {
      await registerDeckMediaRef(page?.background);
      for (const obj of Array.isArray(page?.objects) ? page.objects : []) {
        await registerDeckMediaRef(obj?.background);
        await registerDeckMediaRef(obj?.image);
      }
    }
    if (deckId) deckSnapshotsForExport.set(deckId, copy);
    return copy;
  }

  for (const item of queue) {
    if (
      !item ||
      isLegacySlideQueueItem(item) ||
      typeof item.path !== "string" ||
      item.path.length === 0
    ) {
      continue;
    }
    if (
      item.type === "bible" ||
      (typeof item.path === "string" && item.path.startsWith(BIBLE_URI_PREFIX))
    ) {
      itemCounter += 1;
      const scripture = bibleProjectReferenceOnly(item.bible || {}, {
        pathEntry: parseBibleArchivePath(item.path),
      });
      const backgroundAsset = await registerAssetForPath(scripture.backgroundPath, {
        originalPath: scripture.backgroundPath,
        originalName: basenameAny(scripture.backgroundPath || ""),
      });
      const scripturePath = bibleArchivePath(scripture.reference, scripture.version);
      const projectScripture = {
        ...scripture,
        backgroundAssetId: backgroundAsset?.assetId,
      };
      queueSequence.push({
        id: makeId("item", itemCounter),
        label: `${scripture.reference || ""} ${scripture.version || "KJV"}`.trim() || "Bible",
        type: "scripture",
        source: {
          kind: "generated",
          path: scripturePath,
        },
        scripture: projectScripture,
        transition: projectSlideTransitionOverride(item.transition),
        playback: {
          startTime: 0,
          volume: Number.isFinite(item.cueVolume) ? item.cueVolume : undefined,
          loop: false,
          autoAdvance: item.autoAdvance !== false,
        },
        routing: {
          main: true,
          stage: false,
          stream: true,
          ndi: false,
          alpha: "none",
        },
      });
      continue;
    }
    if (
      item.type === "song" ||
      item.type === "deck" ||
      (typeof item.path === "string" && item.path.startsWith(SONG_URI_PREFIX)) ||
      item.songSnapshot ||
      item.deckSnapshot
    ) {
      itemCounter += 1;
      const snapshot = item.songSnapshot && typeof item.songSnapshot === "object"
        ? item.songSnapshot
        : null;
      const songId =
        snapshot?.id ||
        item.deckSnapshot?.id ||
        parseSongArchivePath(item.path) ||
        item.source?.songId ||
        item.source?.deckId ||
        makeId("song", itemCounter);
      const render = item.render && typeof item.render === "object" ? { ...item.render } : {};
      const backgroundAsset = await registerAssetForPath(render.backgroundPath, {
        originalPath: render.backgroundPath,
        originalName: basenameAny(render.backgroundPath || ""),
      });
      if (backgroundAsset?.assetId) {
        render.backgroundAssetId = backgroundAsset.assetId;
      }
      const deckSnapshot = await deckSnapshotForArchive(item);
      const source = {
        kind: item.source?.kind || (item.type === "deck" ? "deck" : "library"),
        songId,
        path: item.type === "deck" ? `deck://${encodeURIComponent(songId)}` : songArchivePath(songId),
      };
      if (item.type === "deck" && (item.source?.deckId || deckSnapshot?.id)) {
        source.kind = "deck";
        source.deckId = item.source?.deckId || deckSnapshot.id;
      }
      if (item.source?.pageId || item.render?.currentSectionId) {
        source.pageId = item.source?.pageId || item.render.currentSectionId;
      }
      queueSequence.push({
        id: makeId("item", itemCounter),
        label: item.name || snapshot?.title || "Song",
        type: item.type === "deck" ? "deck" : "song",
        source,
        songSnapshot: deckSnapshot ? undefined : snapshot,
        deckSnapshot: deckSnapshot || undefined,
        sequence: item.sequence,
        render,
        transition: projectSlideTransitionOverride(item.transition),
        playback: {
          startTime: 0,
          volume: Number.isFinite(item.cueVolume) ? item.cueVolume : undefined,
          loop: false,
          autoAdvance: item.autoAdvance !== false,
        },
        routing: {
          main: true,
          stage: false,
          stream: true,
          ndi: false,
          alpha: "none",
        },
      });
      continue;
    }
    const sourcePath = item.path;
    const isFileUrl = /^file:\/\//i.test(sourcePath);
    const normalizedPath = isFileUrl ? fileUrlToPath(sourcePath) : sourcePath;
    const isExternalUrl = /^(https?|m3u8|mpd):/i.test(sourcePath);
    let sourceKind = "external";
    let bundledPath = normalizedPath;
    let assetId = "";
    let assetSize = Number.isFinite(item.sizeBytes) ? item.sizeBytes : undefined;
    let assetFingerprint = assetFingerprintFields(item);
    let assetModifiedTime =
      typeof item.modifiedTime === "string" ? item.modifiedTime : undefined;
    let assetMissing = item.missing === true;
    let assetRegistered = false;
    if (!isExternalUrl) {
      try {
        const info = await stat(normalizedPath);
        if (info.isFile()) {
          const previousSize = assetSize;
          const previousModifiedTime = assetModifiedTime;
          assetSize = info.size;
          assetModifiedTime = statModifiedTime(info);
          assetMissing = false;
          if (packMedia) sourceKind = "bundled";
          const kind = classifyKindFromPath(normalizedPath);
          const existing = fileIndex.get(normalizedPath);
          if (existing) {
            bundledPath = existing.bundledPath;
            assetId = existing.assetId;
            assetRegistered = true;
          } else {
            const ext = path.extname(normalizedPath).toLowerCase();
            const folder = contentLocationForKind(kind);
            const safeBase = path.basename(normalizedPath).replace(/[^A-Za-z0-9._-]/g, "_");
            assetId = makeId("asset", fileIndex.size + 1);
            if (packMedia) {
              const bundledName = `${String(fileIndex.size + 1).padStart(4, "0")}_${safeBase}`;
              bundledPath = `${folder}/${bundledName}`;
              fileEntries.push({ realPath: normalizedPath, path: bundledPath, compress: false });
            }
            if (
              packMedia ||
              !storedFileHashFromRecord(assetFingerprint) ||
              previousSize !== assetSize ||
              previousModifiedTime !== assetModifiedTime
            ) {
              try {
                assetFingerprint = baselineFileHashFields(
                  await hashMediaFile(normalizedPath),
                );
              } catch {
                assetFingerprint = {};
              }
            }
            const assetIntegrity = packMedia
              ? packedIntegrityFields(await sha256File(normalizedPath))
              : {};
            fileIndex.set(normalizedPath, { bundledPath, assetId });
            assets.push({
              id: assetId,
              kind,
              path: packMedia ? bundledPath : normalizedPath,
              originalPath: item.originalPath || normalizedPath,
              originalName: item.originalName || basenameAny(normalizedPath),
              mimeType: kind === "presentation"
                ? (ext === ".pptx"
                    ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    : "application/pdf")
                : undefined,
              ...assetFingerprint,
              ...assetIntegrity,
              sizeBytes: assetSize,
              modifiedTime: assetModifiedTime,
              missingBehavior: "showPlaceholder",
              compatibilityWarnings: [],
            });
            assetRegistered = true;
          }
        }
      } catch {
        sourceKind = "missing";
        assetMissing = true;
      }
      if (!assetRegistered) {
        const kind = classifyKindFromPath(normalizedPath);
        const ext = path.extname(normalizedPath).toLowerCase();
        const existing = fileIndex.get(normalizedPath);
        if (existing) {
          assetId = existing.assetId;
          bundledPath = existing.bundledPath;
        } else {
            assetId = makeId("asset", fileIndex.size + 1);
            fileIndex.set(normalizedPath, { bundledPath, assetId });
            assets.push({
              id: assetId,
              kind,
              path: normalizedPath,
              originalPath: item.originalPath || normalizedPath,
              originalName: item.originalName || basenameAny(normalizedPath),
              mimeType: kind === "presentation"
                ? (ext === ".pptx"
                    ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    : "application/pdf")
                : undefined,
              ...assetFingerprintFields(item),
              sizeBytes: assetSize,
              modifiedTime: assetModifiedTime,
              missingBehavior: "showPlaceholder",
              compatibilityWarnings: assetMissing ? ["missing"] : [],
            });
          }
      }
    }
    itemCounter += 1;
    const kind = classifyKindFromPath(sourcePath);
    const isPresentation = kind === "presentation";
    const queueLiveSource = !isExternalUrl
      ? liveSourceFields(item.liveSource, normalizedPath, {
          mode: packMedia ? "packaged" : "linked",
        })
      : undefined;
    queueSequence.push({
      id: makeId("item", itemCounter),
      label: item.name || basenameAny(sourcePath),
      type: isPresentation ? "presentation" : "media",
      assetId: assetId || undefined,
      source: {
        kind: sourceKind,
        path: bundledPath,
        mediaId: assetId || undefined,
        missingBehavior: sourceKind === "missing" ? "showPlaceholder" : undefined,
      },
      presentationPath: isPresentation ? bundledPath : undefined,
      transition: isPresentation ? projectSlideTransitionOverride(item.transition) : undefined,
      liveSource: queueLiveSource,
      startSlide:
        Number.isFinite(item.pptxSlideIndex) && item.pptxSlideIndex >= 0
          ? item.pptxSlideIndex + 1
          : undefined,
      playback: {
        startTime: queueItemPlaybackStartTime(item),
        volume: Number.isFinite(item.cueVolume) ? item.cueVolume : undefined,
        loop: item.loop === true,
        autoAdvance: item.autoAdvance !== false,
      },
      routing: {
        main: true,
        stage: false,
        stream: true,
        ndi: false,
        alpha: "none",
      },
    });
  }

  const projectScriptureBackgroundAsset = await registerAssetForPath(
    projectScriptureOverrides.backgroundPath,
    {
      originalPath: projectScriptureOverrides.backgroundPath,
      originalName: basenameAny(projectScriptureOverrides.backgroundPath || ""),
    },
  );

  const queueJson = {
    id: "queue_main",
    name: "EMS Project",
    loopQueue: false,
    created: nowIso,
    modified: nowIso,
    projectScriptureText: (() => {
      const scriptureText = projectScriptureTextFromOverrides(projectScriptureOverrides);
      if (!scriptureText) return undefined;
      if (scriptureText.themeOverrides?.background) {
        scriptureText.themeOverrides.background.assetId = projectScriptureBackgroundAsset?.assetId;
      }
      if (scriptureText.presentation) {
        scriptureText.presentation.backgroundAssetId = projectScriptureBackgroundAsset?.assetId;
      }
      return scriptureText;
    })(),
    sequence: queueSequence,
  };
  const assetsJson = { assets };
  const outputsJson = { outputs: [] };
  const diagnosticsJson = {
    lastValidated: nowIso,
    status: "clean",
    warnings: [],
    errors: [],
  };

  const queueBuf = Buffer.from(canonicalJson(queueJson), "utf8");
  const assetsBuf = Buffer.from(canonicalJson(assetsJson), "utf8");
  const outputsBuf = Buffer.from(canonicalJson(outputsJson), "utf8");
  const diagnosticsBuf = Buffer.from(canonicalJson(diagnosticsJson), "utf8");

  const songBuffers = [];
  const processedSongs = new Set();
  const deckBuffers = [];
  const processedDecks = new Set();
  for (const item of queue) {
    if (!item) continue;
    if (item.type === "song" || item.songSnapshot) {
      const songSnap = item.songSnapshot;
      const songId = songSnap?.id || parseSongArchivePath(item.path) || item.source?.songId;
      if (songId && !processedSongs.has(songId) && songSnap) {
        processedSongs.add(songId);
        const normalized = normalizeToSongAST(songSnap);
        songBuffers.push({
          path: `songs/${songId}.json`,
          buffer: Buffer.from(canonicalJson(normalized), "utf8"),
        });
      }
    }
    const deckSnap = await deckSnapshotForArchive(item);
    if (deckSnap && deckSnap.id && !processedDecks.has(deckSnap.id)) {
      processedDecks.add(deckSnap.id);
      deckBuffers.push({
        path: `slides/${deckSnap.id}.json`,
        buffer: Buffer.from(canonicalJson(deckSnap), "utf8"),
      });
    }
  }

  const hashes = {
    "queue.json": await sha256Buffer(queueBuf),
    "assets.json": await sha256Buffer(assetsBuf),
    "outputs.json": await sha256Buffer(outputsBuf),
    "diagnostics.json": await sha256Buffer(diagnosticsBuf),
  };
  for (const entry of songBuffers) {
    hashes[entry.path] = await sha256Buffer(entry.buffer);
  }
  for (const entry of deckBuffers) {
    hashes[entry.path] = await sha256Buffer(entry.buffer);
  }
  for (const entry of assets) {
    const archivePath = typeof entry?.path === "string" ? entry.path : "";
    const integrityHash = normalizeSha256Hex(entry?.integrityHash);
    if (isPackedArchiveMediaPath(archivePath) && integrityHash) {
      hashes[archivePath] = integrityHash;
    }
  }

  const manifestJson = {
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    format: "EMS Project",
    formatExtension: "emproj",
    application: {
      name: applicationInfo.name,
      version: applicationInfo.version,
      platform: process.platform,
    },
    project: projectMetadata,
    storage: packMedia
      ? { mode: "packed", mediaPolicy: "bundled", pathMode: "relative" }
      : { mode: "working", mediaPolicy: "external", pathMode: "mixed" },
    features: {
      media: true,
      presentations: true,
      themes: false,
      scriptures: true,
      ccli: false,
    },
    integrity: {
      algorithm: "sha256",
      generatedAt: nowIso,
      hashes,
    },
    compatibility: {
      minimumReaderSchemaVersion: PROJECT_FILE_SCHEMA_VERSION,
      unknownFields: "preserve",
      unknownCueTypes: "showPlaceholder",
    },
  };
  const manifestBuf = Buffer.from(canonicalJson(manifestJson), "utf8");
  const manifestHash = await sha256Buffer(manifestBuf);
  const archiveComment = buildProjectArchiveComment({
    application: applicationInfo,
    manifestHash,
    projectGuid: projectMetadata.guid,
    savedAt: nowIso,
  });
  const mimeBuf = Buffer.from(`${MIME_TYPE}\n`, "utf8");

  // Use a per-save temp path so overlapping saves do not race on the same file.
  const tmpPath = `${projectPath}.${randomUUID()}.tmp`;
  const bakPath = `${projectPath}.bak`;
  const zipBuffers = [
    { path: "mimetype", buffer: mimeBuf, compress: false },
    { path: "manifest.json", buffer: manifestBuf, compress: true },
    { path: "queue.json", buffer: queueBuf, compress: true },
    { path: "assets.json", buffer: assetsBuf, compress: true },
    { path: "outputs.json", buffer: outputsBuf, compress: true },
    { path: "diagnostics.json", buffer: diagnosticsBuf, compress: true },
    ...songBuffers.map((entry) => ({
      path: entry.path,
      buffer: entry.buffer,
      compress: true,
    })),
    ...deckBuffers.map((entry) => ({
      path: entry.path,
      buffer: entry.buffer,
      compress: true,
    })),
  ];

  await addZipFromBuffersAndFiles(
    tmpPath,
    zipBuffers,
    packMedia ? fileEntries : [],
    archiveComment,
  );
  try {
    await copyFile(projectPath, bakPath);
  } catch {
    // No prior file.
  }
  await rename(tmpPath, projectPath);
  return {
    ok: true,
    filePath: projectPath,
    projectGuid: projectMetadata.guid,
    projectCreated: projectMetadata.created,
  };
}

export async function cleanupExtractedProjectMedia(snapshot) {
  const queue = snapshot?.mediaQueue;
  if (!Array.isArray(queue) || queue.length === 0) return;
  const marker = `${path.sep}ems-emproj-`;
  let root = "";
  for (const entry of queue) {
    const entryPath = entry?.path;
    if (typeof entryPath !== "string") continue;
    const idx = entryPath.indexOf(marker);
    if (idx < 0) continue;
    const sepIdx = entryPath.indexOf(path.sep, idx + marker.length);
    root = sepIdx >= 0 ? entryPath.slice(0, sepIdx) : entryPath;
    break;
  }
  if (!root || root.length < marker.length) return;
  try {
    await rm(root, { recursive: true, force: true });
  } catch {
    // best-effort temp cleanup
  }
}
