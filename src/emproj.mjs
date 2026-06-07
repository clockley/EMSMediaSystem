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
const IMAGE_EXT = new Set([".bmp", ".gif", ".jpg", ".jpeg", ".png", ".webp", ".svg", ".ico"]);
const VIDEO_EXT = new Set([".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".wmv"]);
const AUDIO_EXT = new Set([".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".wma"]);
const PRESENTATION_EXT = new Set([".pptx"]);
const SCRIPTURE_FONT_FAMILY = "'CMG Sans'";
const SCRIPTURE_BODY_FONT_SIZE = 66;

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

function normalizeProjectScriptureOverrides(overrides = {}) {
  if (!overrides || typeof overrides !== "object") {
    return {
      fontFamily: "",
      fontSize: undefined,
      color: "",
      backgroundColor: "",
      backgroundPath: "",
    };
  }
  return {
    fontFamily:
      typeof overrides.fontFamily === "string" ? overrides.fontFamily : "",
    fontSize:
      Number.isFinite(overrides.fontSize) ? overrides.fontSize : undefined,
    color:
      typeof overrides.color === "string" ? overrides.color : "",
    backgroundColor:
      typeof overrides.backgroundColor === "string" ? overrides.backgroundColor : "",
    backgroundPath:
      typeof overrides.backgroundPath === "string" ? overrides.backgroundPath : "",
  };
}

function projectScriptureTextFromOverrides(overrides = {}) {
  const normalized = normalizeProjectScriptureOverrides(overrides);
  if (
    !normalized.fontFamily &&
    !Number.isFinite(normalized.fontSize) &&
    !normalized.color &&
    !normalized.backgroundColor &&
    !normalized.backgroundPath
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
      textColor: normalized.color || undefined,
      backgroundColor: normalized.backgroundColor || undefined,
      backgroundPath: normalized.backgroundPath || "",
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
  const reference = typeof scripture.reference === "string" ? scripture.reference : "";
  const version = typeof scripture.version === "string" ? scripture.version : "KJV";
  return {
    path:
      typeof item?.source?.path === "string" && item.source.path.length > 0
        ? item.source.path
        : `bible://${encodeURIComponent(`${version}:${reference}`)}`,
    name: item?.label || `${reference} ${version}`.trim(),
    type: "bible",
    missing: false,
    originalPath: undefined,
    originalName: undefined,
    autoAdvance: item?.playback?.autoAdvance !== false,
    cueStartTime: 0,
    cueVolume: Number.isFinite(item?.playback?.volume) ? item.playback.volume : undefined,
    bible: {
      version,
      reference,
      text: typeof scripture.text === "string" ? scripture.text : "",
      book: typeof scripture.book === "string" ? scripture.book : "",
      chapter: Number.isFinite(scripture.chapter) ? scripture.chapter : 1,
      verse: Number.isFinite(scripture.verse) ? scripture.verse : 0,
      verseEnd: Number.isFinite(scripture.verseEnd) ? scripture.verseEnd : 0,
      fontFamily:
        typeof scripture.fontFamily === "string"
          ? scripture.fontFamily
          : SCRIPTURE_FONT_FAMILY,
      fontSize: Number.isFinite(scripture.fontSize) ? scripture.fontSize : undefined,
      color: typeof scripture.color === "string" ? scripture.color : "#ffffff",
      backgroundColor:
        typeof scripture.backgroundColor === "string"
          ? scripture.backgroundColor
          : "#000000",
      backgroundPath,
    },
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
    schemaVersion: 1,
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
          color: snapshot.projectScriptureText.presentation.textColor,
          backgroundColor: snapshot.projectScriptureText.presentation.backgroundColor,
          backgroundPath: snapshot.projectScriptureText.presentation.backgroundPath,
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
    if (item.type === "bible" && item.bible && typeof item.bible === "object") {
      itemCounter += 1;
      const scripture = item.bible;
      const backgroundAsset = await registerAssetForPath(scripture.backgroundPath, {
        originalPath: scripture.backgroundPath,
        originalName: basenameAny(scripture.backgroundPath || ""),
      });
      queueSequence.push({
        id: makeId("item", itemCounter),
        label: item.name || `${scripture.reference || ""} ${scripture.version || "KJV"}`.trim(),
        type: "scripture",
        source: {
          kind: "generated",
          path: item.path,
        },
        scripture: {
          version: scripture.version || "KJV",
          reference: scripture.reference || "",
          text: scripture.text || "",
          book: scripture.book || "",
          chapter: Number.isFinite(scripture.chapter) ? scripture.chapter : 1,
          verse: Number.isFinite(scripture.verse) ? scripture.verse : 0,
          verseEnd: Number.isFinite(scripture.verseEnd) ? scripture.verseEnd : 0,
          fontFamily: scripture.fontFamily || SCRIPTURE_FONT_FAMILY,
          fontSize: Number.isFinite(scripture.fontSize) ? scripture.fontSize : undefined,
          color: scripture.color || "#ffffff",
          backgroundColor: scripture.backgroundColor || "#000000",
          backgroundAssetId: backgroundAsset?.assetId,
          backgroundPath: scripture.backgroundPath || "",
        },
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
    schemaVersion: 1,
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
      minimumReaderSchemaVersion: 1,
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
