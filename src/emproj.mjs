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
import yauzl from "yauzl";
import yazl from "yazl";

const MIME_TYPE = "application/vnd.ems.project+zip";
const IMAGE_EXT = new Set([".bmp", ".gif", ".jpg", ".jpeg", ".png", ".webp", ".svg", ".ico"]);
const VIDEO_EXT = new Set([".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".wmv"]);
const AUDIO_EXT = new Set([".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".wma"]);
const PRESENTATION_EXT = new Set([".pptx"]);

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeArchivePath(p) {
  return String(p || "").replace(/\\/g, "/");
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

function queueItemFromSequenceItem(item, resolvedPath) {
  const kind = classifyKindFromPath(resolvedPath);
  return {
    path: resolvedPath,
    name: item?.label || path.basename(resolvedPath),
    type: kind === "presentation" ? "pptx" : kind,
    cueStartTime: Number.isFinite(item?.playback?.startTime) ? item.playback.startTime : 0,
    cueVolume: Number.isFinite(item?.playback?.volume) ? item.playback.volume : undefined,
    pptxSlideIndex: Number.isFinite(item?.startSlide) ? item.startSlide - 1 : -1,
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

  const queueJsonRaw = rootFiles.get("queue.json");
  if (!queueJsonRaw) throw new Error("Project missing queue.json");
  const queueJson = JSON.parse(queueJsonRaw.toString("utf8"));
  const sequence = Array.isArray(queueJson.sequence) ? queueJson.sequence : [];

  const mediaQueue = sequence
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      let relPath = "";
      if (typeof item?.source?.path === "string") relPath = item.source.path;
      else if (typeof item?.presentationPath === "string") relPath = item.presentationPath;
      else if (typeof item?.path === "string") relPath = item.path;
      if (!relPath) return null;
      const resolvedPath = extractedMediaPaths.get(relPath) || relPath;
      return queueItemFromSequenceItem(item, resolvedPath);
    })
    .filter(Boolean);

  return {
    schemaVersion: 1,
    projectPath,
    currentMode: 0,
    currentQueueIndex: mediaQueue.length > 0 ? 0 : -1,
    previewCueIndex: -1,
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
  const nowIso = new Date().toISOString();
  const fileIndex = new Map();
  const queueSequence = [];
  const assets = [];
  const fileEntries = [];
  let itemCounter = 0;

  for (const item of queue) {
    if (!item || typeof item.path !== "string" || item.path.length === 0) continue;
    const sourcePath = item.path;
    const isFileUrl = /^file:\/\//i.test(sourcePath);
    const normalizedPath = isFileUrl ? new URL(sourcePath).pathname : sourcePath;
    const isExternalUrl = /^(https?|m3u8|mpd):/i.test(sourcePath);
    let sourceKind = "external";
    let bundledPath = normalizedPath;
    let assetId = "";
    if (packMedia && !isExternalUrl) {
      try {
        const info = await stat(normalizedPath);
        if (info.isFile()) {
          sourceKind = "bundled";
          const ext = path.extname(normalizedPath).toLowerCase();
          const kind = classifyKindFromPath(normalizedPath);
          const folder = contentLocationForKind(kind);
          const existing = fileIndex.get(normalizedPath);
          if (existing) {
            bundledPath = existing.bundledPath;
            assetId = existing.assetId;
          } else {
            const safeBase = path.basename(normalizedPath).replace(/[^A-Za-z0-9._-]/g, "_");
            const bundledName = `${String(fileIndex.size + 1).padStart(4, "0")}_${safeBase}`;
            bundledPath = `${folder}/${bundledName}`;
            assetId = makeId("asset", fileIndex.size + 1);
            fileIndex.set(normalizedPath, { bundledPath, assetId });
            fileEntries.push({ realPath: normalizedPath, path: bundledPath, compress: false });
            const sha = await sha256File(normalizedPath);
            assets.push({
              id: assetId,
              kind,
              path: bundledPath,
              originalPath: normalizedPath,
              originalName: path.basename(normalizedPath),
              mimeType: kind === "presentation"
                ? (ext === ".pptx"
                    ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    : "application/pdf")
                : undefined,
              sha256: sha,
              sizeBytes: info.size,
              missingBehavior: "showPlaceholder",
              compatibilityWarnings: [],
            });
          }
        }
      } catch {
        sourceKind = "missing";
      }
    }
    itemCounter += 1;
    const kind = classifyKindFromPath(sourcePath);
    const isPresentation = kind === "presentation";
    queueSequence.push({
      id: makeId("item", itemCounter),
      label: item.name || path.basename(sourcePath),
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
        startTime: Number.isFinite(item.cueStartTime) ? item.cueStartTime : 0,
        volume: Number.isFinite(item.cueVolume) ? item.cueVolume : undefined,
        loop: false,
        autoAdvance: true,
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

  const queueJson = {
    id: "queue_main",
    name: "EMS Project",
    loopQueue: false,
    created: nowIso,
    modified: nowIso,
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
      scriptures: false,
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

  const tmpPath = `${projectPath}.tmp`;
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
