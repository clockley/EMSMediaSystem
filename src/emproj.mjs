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
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import yauzl from "yauzl";
import yazl from "yazl";

const MIME_TYPE = "application/vnd.ems.project+zip";
const PROJECT_FILE_SCHEMA_VERSION = 2;
const BIBLE_URI_PREFIX = "bible://";
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

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeArchivePath(p) {
  return String(p || "").replace(/\\/g, "/");
}

function basenameAny(p) {
  const parts = String(p || "").split(/[/\\]/);
  return parts[parts.length - 1] || String(p || "");
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

async function sha256Buffer(buf) {
  const hash = createHash("sha256");
  hash.update(buf);
  return hash.digest("hex");
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  const input = createReadStream(filePath);
  input.on("data", (chunk) => hash.update(chunk));
  await new Promise((resolve, reject) => {
    input.on("end", resolve);
    input.on("error", reject);
  });
  return hash.digest("hex");
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

async function extractEntryToFile(zipfile, entry, outPath) {
  await mkdir(path.dirname(outPath), { recursive: true });
  const rs = await openZipReadStream(zipfile, entry);
  await pipeline(rs, createWriteStream(outPath));
}

function makeId(prefix, n) {
  return `${prefix}_${String(n).padStart(4, "0")}`;
}

function queueItemFromSequenceItem(item, resolvedPath, asset = null) {
  const kind = classifyKindFromPath(resolvedPath);
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
    sha256: typeof asset?.sha256 === "string" ? asset.sha256 : undefined,
    sizeBytes: Number.isFinite(asset?.sizeBytes) ? asset.sizeBytes : undefined,
    modifiedTime:
      typeof asset?.modifiedTime === "string" ? asset.modifiedTime : undefined,
    autoAdvance: item?.playback?.autoAdvance !== false,
    cueStartTime: sequenceItemPlaybackStartTime(item, kind),
    cueVolume: Number.isFinite(item?.playback?.volume) ? item.playback.volume : undefined,
    loop: item?.playback?.loop === true && kind !== "presentation",
    pptxSlideIndex: Number.isFinite(item?.startSlide) ? item.startSlide - 1 : -1,
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
    bible: scriptureReference,
  };
}

export async function loadEmprojSnapshot(projectPath) {
  const zipfile = await openZip(projectPath);
  const extractRoot = await mkdtemp(path.join(os.tmpdir(), "ems-emproj-"));
  const extractedMediaPaths = new Map();
  const rootFiles = new Map();

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
          inZipPath === "diagnostics.json"
        ) {
          rootFiles.set(inZipPath, await readEntryBuffer(zipfile, entry));
          zipfile.readEntry();
          return;
        }
        if (inZipPath.startsWith("media/") || inZipPath.startsWith("presentations/")) {
          const outPath = path.join(extractRoot, inZipPath);
          await extractEntryToFile(zipfile, entry, outPath);
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
  if (manifestJsonRaw) {
    try {
      manifestJson = JSON.parse(manifestJsonRaw.toString("utf8"));
    } catch {
      manifestJson = {};
    }
  }

  const queueJsonRaw = rootFiles.get("queue.json");
  if (!queueJsonRaw) throw new Error("Project missing queue.json");
  const queueJson = JSON.parse(queueJsonRaw.toString("utf8"));
  const sequence = Array.isArray(queueJson.sequence) ? queueJson.sequence : [];
  let assetsJson = { assets: [] };
  const assetsJsonRaw = rootFiles.get("assets.json");
  if (assetsJsonRaw) {
    try {
      assetsJson = JSON.parse(assetsJsonRaw.toString("utf8"));
    } catch {
      assetsJson = { assets: [] };
    }
  }
  const assets = Array.isArray(assetsJson.assets) ? assetsJson.assets : [];
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
      if (!item || typeof item !== "object") return null;
      if (item.type === "scripture" || item.scripture) {
        return buildBibleQueueItemFromSequenceItem(item, assetById, extractedMediaPaths);
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

  return {
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    projectPath,
    currentMode: 0,
    currentQueueIndex: -1,
    previewCueIndex: -1,
    projectStorageMode: manifestJson?.storage?.mode === "packed" ? "packed" : "working",
    projectScriptureText: projectScriptureTextFromOverrides(projectScriptureOverrides),
    mediaQueue,
  };
}

async function addZipFromBuffersAndFiles(targetZipPath, buffers, files) {
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
  zipFile.end();
  await done;
}

export async function saveEmprojSnapshot(
  projectPath,
  snapshot,
  appVersion = "1.0.0",
  opts = {},
) {
  const packMedia = opts?.packMedia === true;
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
    let assetSha = typeof fallback.sha256 === "string" ? fallback.sha256 : undefined;
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
          assetSha,
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
        !assetSha ||
        previousSize !== assetSize ||
        previousModifiedTime !== assetModifiedTime
      ) {
        assetSha = await sha256File(normalizedPath);
      }
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
        sha256: assetSha,
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
        assetSha,
        assetSize,
        assetModifiedTime,
        assetMissing,
      };
    } catch {
      return null;
    }
  }

  for (const item of queue) {
    if (!item || typeof item.path !== "string" || item.path.length === 0) continue;
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
    let assetSha = typeof item.sha256 === "string" ? item.sha256 : undefined;
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
              !assetSha ||
              previousSize !== assetSize ||
              previousModifiedTime !== assetModifiedTime
            ) {
              assetSha = await sha256File(normalizedPath);
            }
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
              sha256: assetSha,
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
              sha256: assetSha,
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

  const hashes = {
    "queue.json": await sha256Buffer(queueBuf),
    "assets.json": await sha256Buffer(assetsBuf),
    "outputs.json": await sha256Buffer(outputsBuf),
    "diagnostics.json": await sha256Buffer(diagnosticsBuf),
  };
  for (const entry of assets) {
    if (entry?.path && entry?.sha256) hashes[entry.path] = entry.sha256;
  }

  const manifestJson = {
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    format: "EMS Project",
    formatExtension: "emproj",
    application: {
      name: "EMS Media System",
      version: appVersion,
      platform: process.platform,
    },
    project: {
      id: `proj_${randomUUID().replace(/-/g, "")}`,
      name: "EMS Project",
      created: nowIso,
      modified: nowIso,
    },
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
  ];

  await addZipFromBuffersAndFiles(tmpPath, zipBuffers, packMedia ? fileEntries : []);
  try {
    await copyFile(projectPath, bakPath);
  } catch {
    // No prior file.
  }
  await rename(tmpPath, projectPath);
  return { ok: true, filePath: projectPath };
}

export async function cleanupExtractedProjectMedia(snapshot) {
  const queue = snapshot?.mediaQueue;
  if (!Array.isArray(queue) || queue.length === 0) return;
  const firstPath = queue[0]?.path;
  if (typeof firstPath !== "string") return;
  const marker = `${path.sep}ems-emproj-`;
  const idx = firstPath.indexOf(marker);
  if (idx < 0) return;
  const root = firstPath.slice(0, firstPath.indexOf(path.sep, idx + marker.length));
  if (!root || root.length < marker.length) return;
  try {
    await rm(root, { recursive: true, force: true });
  } catch {
    // best-effort temp cleanup
  }
}
