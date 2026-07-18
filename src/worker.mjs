import { readdir, rm, stat, mkdir, copyFile } from "fs/promises";
import { constants as fsConstants } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Local imports (all referenced using .min.mjs as they run in the derived folder at runtime)
import {
  loadEmprojSnapshot,
  saveEmprojSnapshot,
  readEmprojProjectGuid,
} from "./emproj.min.mjs";

import {
  StagingIndex,
  normalizeProjectGuid,
  normalizeSnapshotId,
  snapshotIdFromStagedFilename,
} from "./staging-index.min.mjs";

import {
  hashMediaFile,
  storedFileHashFromRecord,
  baselineFileHashFields,
  MEDIA_FILE_HASH_ALG,
} from "./media-file-hash.min.mjs";

const activeTasks = new Map(); // taskId -> cancelFlag { canceled: false }

// Helper for bounded concurrency
async function mapLimit(items, limit, fn) {
  const results = [];
  const promises = [];
  let index = 0;

  async function runNext() {
    if (index >= items.length) return;
    const curIndex = index++;
    const item = items[curIndex];
    results[curIndex] = await fn(item);
    await runNext();
  }

  for (let i = 0; i < Math.min(limit, items.length); i++) {
    promises.push(runNext());
  }
  await Promise.all(promises);
  return results;
}

// Helpers for paths and classifiers
function isRemoteMediaPath(p) {
  return typeof p === "string" && /^(https?|m3u8|mpd|blob):/i.test(p);
}

// Check if a media path represents a virtual resource (e.g. bible or song rpc)
function isVirtualMediaPath(p) {
  return typeof p === "string" && /^(bible|song):\/\//i.test(p);
}

function localFileSystemPathFromMediaPath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("Invalid file path");
  }
  const trimmed = filePath.trim();
  return /^file:\/\//i.test(trimmed) ? fileURLToPath(trimmed) : trimmed;
}

function mediaFileMtimeIso(info) {
  return info.mtime instanceof Date && Number.isFinite(info.mtime.getTime())
    ? info.mtime.toISOString()
    : undefined;
}

async function computeMediaVersion(fsPath) {
  const info = await stat(fsPath);
  if (!info.isFile()) throw new Error("Media source is not a file");
  const fileHash = await hashMediaFile(fsPath);
  return {
    fileHash,
    fileHashAlg: MEDIA_FILE_HASH_ALG,
    sizeBytes: info.size,
    modifiedTime: mediaFileMtimeIso(info),
    mtimeMs: info.mtimeMs,
  };
}

async function computeMediaBaseline(p) {
  if (isRemoteMediaPath(p) || isVirtualMediaPath(p)) return null;
  let fsPath;
  let info;
  try {
    fsPath = localFileSystemPathFromMediaPath(p);
    info = await stat(fsPath);
    if (!info.isFile()) return null;
  } catch {
    return null;
  }
  let fileHash;
  try {
    fileHash = await hashMediaFile(fsPath);
  } catch {
    return {
      sizeBytes: info.size,
      modifiedTime: mediaFileMtimeIso(info),
    };
  }
  return {
    sizeBytes: info.size,
    modifiedTime: mediaFileMtimeIso(info),
    ...baselineFileHashFields(fileHash),
  };
}

// 1. Project actions
async function loadProject(payload) {
  const { projectPath } = payload;
  return await loadEmprojSnapshot(projectPath);
}

async function saveProject(payload) {
  const { projectPath, snapshot, appInfo, options } = payload;
  return await saveEmprojSnapshot(projectPath, snapshot, appInfo, options);
}

// 2. Media actions
async function computeMediaBaselines(payload) {
  const { paths } = payload;
  if (!Array.isArray(paths)) return [];
  
  return await mapLimit(paths, 2, async (p) => {
    const baseline = await computeMediaBaseline(p);
    return { path: p, baseline: baseline?.fileHash ? baseline : null };
  });
}

async function preflightCheckMedia(payload) {
  const { items } = payload;
  if (!Array.isArray(items)) return [];
  
  return await mapLimit(items, 2, async (raw) => {
    const p = typeof raw?.path === "string" ? raw.path : "";
    if (!p) {
      return { path: p, status: "missing" };
    }
    if (isRemoteMediaPath(p)) {
      return { path: p, status: "ok" };
    }
    let fsPath;
    let info;
    try {
      fsPath = localFileSystemPathFromMediaPath(p);
      info = await stat(fsPath);
      if (!info.isFile()) throw new Error("Not a file");
    } catch {
      return { path: p, status: "missing" };
    }
    const currentSizeBytes = info.size;
    const currentModifiedTime = mediaFileMtimeIso(info);
    const currentMtimeMs = info.mtimeMs;
    const baseSize = Number.isFinite(raw?.sizeBytes) ? raw.sizeBytes : null;
    const baseMtime = typeof raw?.modifiedTime === "string" ? raw.modifiedTime : "";
    const storedHash = storedFileHashFromRecord(raw);
    const hasBaseline =
      baseSize !== null || Boolean(baseMtime) || storedHash !== null;
    if (!hasBaseline) {
      return {
        path: p,
        status: "unverifiable",
        currentSizeBytes,
        currentModifiedTime,
        currentMtimeMs,
      };
    }
    if (baseSize !== null && currentSizeBytes !== baseSize) {
      return {
        path: p,
        status: "changed",
        confirmedByHash: false,
        currentSizeBytes,
        currentModifiedTime,
        currentMtimeMs,
      };
    }
    let needConfirm;
    if (baseMtime) {
      if (currentModifiedTime === baseMtime) {
        return { path: p, status: "ok", currentSizeBytes, currentModifiedTime, currentMtimeMs };
      }
      needConfirm = true;
    } else {
      needConfirm = storedHash !== null;
    }
    if (!needConfirm) {
      return { path: p, status: "ok", currentSizeBytes, currentModifiedTime, currentMtimeMs };
    }
    if (storedHash) {
      let computedHash = "";
      try {
        computedHash = await hashMediaFile(fsPath);
      } catch {
        computedHash = "";
      }
      if (computedHash && computedHash === storedHash) {
        return {
          path: p,
          status: "ok",
          currentSizeBytes,
          currentModifiedTime,
          currentMtimeMs,
          currentFileHash: computedHash,
          currentFileHashAlg: MEDIA_FILE_HASH_ALG,
        };
      } else {
        return {
          path: p,
          status: "changed",
          confirmedByHash: true,
          currentSizeBytes,
          currentModifiedTime,
          currentMtimeMs,
          currentFileHash: computedHash || undefined,
          currentFileHashAlg: computedHash ? MEDIA_FILE_HASH_ALG : undefined,
        };
      }
    }
    return { path: p, status: "ok", currentSizeBytes, currentModifiedTime, currentMtimeMs };
  });
}

// 3. Relink scan
function relinkOriginalName(item) {
  const candidates = [
    item?.originalName,
    item?.originalPath,
    item?.path,
    item?.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    const parts = candidate.split(/[/\\]/);
    return parts[parts.length - 1] || candidate;
  }
  return "";
}

async function scoreRelinkCandidate(item, candidatePath, expectedName) {
  let info;
  try {
    info = await stat(candidatePath);
    if (!info.isFile()) return null;
  } catch {
    return null;
  }

  const expectedSize = Number.isFinite(item?.sizeBytes) ? item.sizeBytes : null;
  if (expectedSize !== null && info.size !== expectedSize) {
    return null;
  }

  let score = 100;
  if (path.basename(candidatePath) === expectedName) score += 20;
  if (expectedSize !== null) score += 80;

  const storedHash = storedFileHashFromRecord(item);
  if (storedHash) {
    let computedHash = "";
    try {
      computedHash = await hashMediaFile(candidatePath);
    } catch {
      return null;
    }
    if (computedHash !== storedHash) return null;
    score += 500;
    return {
      path: candidatePath,
      score,
      sizeBytes: info.size,
      modifiedTime:
        info.mtime instanceof Date && Number.isFinite(info.mtime.getTime())
          ? info.mtime.toISOString()
          : undefined,
      ...baselineFileHashFields(computedHash),
    };
  }

  return {
    path: candidatePath,
    score,
    sizeBytes: info.size,
    modifiedTime:
      info.mtime instanceof Date && Number.isFinite(info.mtime.getTime())
        ? info.mtime.toISOString()
        : undefined,
  };
}

async function findRelinkMatches(id, payload) {
  const { searchRoot, missingItems } = payload;
  const wantedNames = new Set();
  const itemNames = new Map();
  for (const item of missingItems) {
    const originalName = relinkOriginalName(item);
    if (!originalName) continue;
    const lowerName = originalName.toLowerCase();
    wantedNames.add(lowerName);
    itemNames.set(item.index, originalName);
  }

  const cancelToken = { canceled: false };
  activeTasks.set(id, cancelToken);

  try {
    const candidatesByName = new Map();
    const stack = [searchRoot];
    let scannedFiles = 0;
    const skipDirs = new Set([
      ".git",
      "node_modules",
      "derived",
      "dist",
      "build",
      ".cache",
      ".config",
    ]);

    while (stack.length > 0) {
      if (cancelToken.canceled) {
        throw new Error("Task cancelled");
      }
      const dir = stack.pop();
      let entries = [];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (cancelToken.canceled) {
          throw new Error("Task cancelled");
        }
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name)) stack.push(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        scannedFiles += 1;
        
        if (scannedFiles % 100 === 0) {
          process.parentPort.postMessage({ id, type: "progress", progress: { scannedFiles } });
        }

        const lowerName = entry.name.toLowerCase();
        if (!wantedNames.has(lowerName)) continue;
        const list = candidatesByName.get(lowerName) || [];
        list.push(fullPath);
        candidatesByName.set(lowerName, list);
      }
    }

    process.parentPort.postMessage({ id, type: "progress", progress: { scannedFiles } });

    const matches = [];
    const unresolved = [];

    for (const item of missingItems) {
      if (cancelToken.canceled) {
        throw new Error("Task cancelled");
      }
      const originalName = itemNames.get(item.index) || relinkOriginalName(item);
      const candidatePaths = candidatesByName.get(originalName.toLowerCase()) || [];
      if (candidatePaths.length === 0) {
        unresolved.push({
          index: item.index,
          name: originalName || item.name || item.path || "Unknown file",
          reason: "not-found",
        });
        continue;
      }

      const scored = [];
      for (const candidatePath of candidatePaths) {
        if (cancelToken.canceled) {
          throw new Error("Task cancelled");
        }
        const score = await scoreRelinkCandidate(item, candidatePath, originalName);
        if (score) scored.push(score);
      }
      scored.sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        unresolved.push({
          index: item.index,
          name: originalName,
          reason: "metadata-mismatch",
        });
        continue;
      }
      if (scored.length > 1 && scored[0].score === scored[1].score) {
        unresolved.push({
          index: item.index,
          name: originalName,
          reason: "ambiguous",
          candidateCount: scored.length,
        });
        continue;
      }

      matches.push({
        index: item.index,
        path: scored[0].path,
        sizeBytes: scored[0].sizeBytes,
        modifiedTime: scored[0].modifiedTime,
        fileHash: scored[0].fileHash,
        fileHashAlg: scored[0].fileHashAlg,
      });
    }

    return { matches, unresolved };
  } finally {
    activeTasks.delete(id);
  }
}

// 4. Staging Index & Reconciliation
let stagingIndexInstance = null;
function getStagingIndex(stagingDir) {
  if (!stagingIndexInstance) {
    stagingIndexInstance = new StagingIndex(stagingDir);
  }
  return stagingIndexInstance;
}

const sessionStagingByProject = new Map();
const sessionProjectQueues = new Map();
const sessionProjectPaths = new Map();
let stagingMutationQueue = Promise.resolve();

function enqueueStagingMutation(operation) {
  const run = stagingMutationQueue.catch(() => {}).then(operation);
  stagingMutationQueue = run.catch(() => {});
  return run;
}

function projectPathForStaging(projectPath) {
  return typeof projectPath === "string" ? projectPath : "";
}

function projectGuidForStaging(projectGuid, activeProjectGuid) {
  return normalizeProjectGuid(projectGuid) || activeProjectGuid;
}

function rememberSessionProject(projectGuid, projectPath, queue) {
  const guid = normalizeProjectGuid(projectGuid);
  if (!guid) return;
  sessionProjectPaths.set(guid, projectPathForStaging(projectPath));
  if (Array.isArray(queue)) {
    sessionProjectQueues.set(guid, queue);
  }
}

async function deleteStagedSnapshotsById(stagingDir, snapshotId) {
  const normalizedId = normalizeSnapshotId(snapshotId);
  if (!normalizedId) return;
  let entries = [];
  try {
    entries = await readdir(stagingDir);
  } catch (err) {
    if (err?.code !== "ENOENT") {
      console.error("Failed to read media staging dir:", err);
    }
    return;
  }
  await Promise.all(
    entries.map(async (entry) => {
      if (snapshotIdFromStagedFilename(entry) !== normalizedId) return;
      try {
        await rm(path.join(stagingDir, entry), { force: true });
      } catch (err) {
        if (err?.code !== "ENOENT") {
          console.error(`Failed to remove staged media file ${entry}:`, err);
        }
      }
    }),
  );
}

async function deleteStagedSnapshots(stagingDir, snapshotIds) {
  const uniqueIds = new Set(
    (Array.isArray(snapshotIds) ? snapshotIds : [])
      .map((snapshotId) => normalizeSnapshotId(snapshotId))
      .filter(Boolean),
  );
  for (const snapshotId of uniqueIds) {
    await deleteStagedSnapshotsById(stagingDir, snapshotId);
  }
}

async function removeReflinkProbeFiles(stagingDir) {
  let entries = [];
  try {
    entries = await readdir(stagingDir);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(".ems-reflink-probe"))
      .map((entry) => rm(path.join(stagingDir, entry), { force: true }).catch(() => {})),
  );
}

async function maintainMediaStagingIndexOnStartup(payload) {
  const { stagingDir } = payload;
  await mkdir(stagingDir, { recursive: true });
  const index = getStagingIndex(stagingDir);
  await index.load();
  const ghostSnapshotIds = await index.sweepGhostProjects(readEmprojProjectGuid);
  await deleteStagedSnapshots(stagingDir, ghostSnapshotIds);
  const orphanSnapshotIds = await index.orphanSnapshotIdsOnDisk();
  await deleteStagedSnapshots(stagingDir, orphanSnapshotIds);
  await removeReflinkProbeFiles(stagingDir);
  return { ok: true };
}

function queueItemOriginalPathForStaging(item) {
  const liveSource = item?.liveSource;
  if (typeof liveSource?.originalPath === "string" && liveSource.originalPath.length > 0) {
    return liveSource.originalPath;
  }
  if (typeof item?.originalPath === "string" && item.originalPath.length > 0) {
    return item.originalPath;
  }
  return typeof item?.path === "string" ? item.path : "";
}

async function collectProtectedStagingSnapshotIds(queue) {
  const protectedIds = new Set();
  if (!Array.isArray(queue)) return protectedIds;

  for (const item of queue) {
    const liveSource = item?.liveSource;
    if (
      !liveSource ||
      liveSource.mode !== "linked" ||
      liveSource.strategy !== "snapshot" ||
      liveSource.stagingTier !== "full"
    ) {
      continue;
    }
    const pinnedSnapshotId = normalizeSnapshotId(
      liveSource.pinnedFileHash || liveSource.snapshotId,
    );
    if (!pinnedSnapshotId) continue;

    const rawPath = queueItemOriginalPathForStaging(item);
    if (!rawPath || isRemoteMediaPath(rawPath)) continue;

    const sourcePath = localFileSystemPathFromMediaPath(rawPath);
    try {
      const version = await computeMediaVersion(sourcePath);
      if (version.fileHash.toLowerCase() !== pinnedSnapshotId) {
        protectedIds.add(pinnedSnapshotId);
        const previousSnapshotId = normalizeSnapshotId(liveSource.previousSnapshotId);
        if (previousSnapshotId) {
          protectedIds.add(previousSnapshotId);
        }
      }
    } catch {
      protectedIds.add(pinnedSnapshotId);
      const previousSnapshotId = normalizeSnapshotId(liveSource.previousSnapshotId);
      if (previousSnapshotId) {
        protectedIds.add(previousSnapshotId);
      }
    }
  }
  return protectedIds;
}

function collectSnapshotIdsFromQueue(queue) {
  const ids = new Set();
  if (!Array.isArray(queue)) return ids;
  for (const item of queue) {
    const liveSource = item?.liveSource;
    if (
      !liveSource ||
      liveSource.mode !== "linked" ||
      liveSource.strategy !== "snapshot" ||
      liveSource.stagingTier !== "full"
    ) {
      continue;
    }
    const snapshotId = normalizeSnapshotId(liveSource.snapshotId || liveSource.pinnedFileHash);
    const previousSnapshotId = normalizeSnapshotId(liveSource.previousSnapshotId);
    if (snapshotId) ids.add(snapshotId);
    if (previousSnapshotId) ids.add(previousSnapshotId);
  }
  return ids;
}

async function reconcileStagingForProject(payload) {
  const { projectGuid, projectPath, queue, protectedSnapshotIds, detectProtected, stagingDir, activeProjectGuid } = payload;
  const guid = projectGuidForStaging(projectGuid, activeProjectGuid);
  if (!guid) {
    await removeReflinkProbeFiles(stagingDir);
    return { ok: true };
  }
  const resolvedPath = projectPathForStaging(projectPath);
  const mediaQueue = Array.isArray(queue) ? queue : [];
  const snapshotIds = collectSnapshotIdsFromQueue(mediaQueue);
  let protectedIds = protectedSnapshotIds;
  if (!Array.isArray(protectedIds) && detectProtected) {
    protectedIds = [...(await collectProtectedStagingSnapshotIds(mediaQueue))];
  }

  rememberSessionProject(guid, resolvedPath, mediaQueue);
  const result = await getStagingIndex(stagingDir).reconcileProject({
    projectGuid: guid,
    projectPath: resolvedPath,
    snapshotIds: [...snapshotIds],
    protectedSnapshotIds: Array.isArray(protectedIds) ? protectedIds : undefined,
    unsaved: resolvedPath.length === 0,
  });

  if (snapshotIds.size > 0) {
    sessionStagingByProject.set(guid, new Set(snapshotIds));
  } else {
    sessionStagingByProject.delete(guid);
  }
  if (Array.isArray(result?.eligibleSnapshotIds)) {
    for (const snapshotId of result.eligibleSnapshotIds) {
      await deleteStagedSnapshotsById(stagingDir, snapshotId);
    }
  }
  await removeReflinkProbeFiles(stagingDir);
  return { ok: true };
}

async function cleanupMediaStagingDir(payload) {
  const { activeProjectSnapshot, activeProjectPath, activeProjectGuid, stagingDir } = payload;
  
  const queue = activeProjectSnapshot?.mediaQueue;
  try {
    await reconcileStagingForProject({
      projectGuid: activeProjectGuid,
      projectPath: activeProjectPath,
      queue,
      detectProtected: true,
      stagingDir,
      activeProjectGuid,
    });
  } catch (err) {
    console.error("Failed to reconcile active media staging files:", err);
  }

  for (const [guid, projectQueue] of [...sessionProjectQueues.entries()]) {
    if (guid === activeProjectGuid) continue;
    try {
      await reconcileStagingForProject({
        projectGuid: guid,
        projectPath: sessionProjectPaths.get(guid) || "",
        queue: projectQueue,
        detectProtected: true,
        stagingDir,
        activeProjectGuid,
      });
    } catch (err) {
      console.error("Failed to reconcile media staging for project:", guid, err);
    }
  }

  const index = getStagingIndex(stagingDir);
  for (const [guid, projectPathHint] of [...sessionProjectPaths.entries()]) {
    if (projectPathHint) continue;
    try {
      const result = await index.removeProject(guid);
      for (const snapshotId of result.eligibleSnapshotIds || []) {
        await deleteStagedSnapshotsById(stagingDir, snapshotId);
      }
    } catch (err) {
      console.error("Failed to remove unsaved staging refs:", guid, err);
    }
  }
  sessionStagingByProject.clear();
  sessionProjectQueues.clear();
  sessionProjectPaths.clear();
  return { ok: true };
}

async function ensureStagedMediaFile(payload) {
  const { sourcePath, snapshotId, stagingDir, projectPath, projectGuid, activeProjectGuid } = payload;
  const stagedPath = stagedMediaPathForSnapshot(
    stagingDir,
    sourcePath,
    snapshotId,
  );
  try {
    const existing = await stat(stagedPath);
    if (existing.isFile()) {
      await registerSessionStagedSnapshot({ projectGuid, projectPath, snapshotId, stagingDir, activeProjectGuid });
      return stagedPath;
    }
  } catch {}
  await mkdir(path.dirname(stagedPath), { recursive: true });
  await copyFile(
    sourcePath,
    stagedPath,
    fsConstants.COPYFILE_EXCL | fsConstants.COPYFILE_FICLONE,
  ).catch(async (err) => {
    if (err?.code === "EEXIST") return;
    throw err;
  });
  await registerSessionStagedSnapshot({ projectGuid, projectPath, snapshotId, stagingDir, activeProjectGuid });
  return stagedPath;
}

async function registerSessionStagedSnapshot(payload) {
  const { projectGuid, projectPath, snapshotId, stagingDir, activeProjectGuid } = payload;
  const id = normalizeSnapshotId(snapshotId);
  if (!id) return;
  const guid = projectGuidForStaging(projectGuid, activeProjectGuid);
  if (!guid) return;
  const resolvedPath = projectPathForStaging(projectPath);
  rememberSessionProject(guid, resolvedPath);
  let ids = sessionStagingByProject.get(guid);
  if (!ids) {
    ids = new Set();
    sessionStagingByProject.set(guid, ids);
  }
  ids.add(id);
  await getStagingIndex(stagingDir).registerSnapshot({
    projectGuid: guid,
    projectPath: resolvedPath,
    snapshotId: id,
  });
}

// Global process listeners
process.parentPort.on("message", async (event) => {
  const { id, action, payload } = event.data;
  
  if (action === "cancel") {
    const cancelToken = activeTasks.get(payload.id);
    if (cancelToken) {
      cancelToken.canceled = true;
    }
    return;
  }

  try {
    let result;
    switch (action) {
      case "loadEmprojSnapshot":
        result = await loadProject(payload);
        break;
      case "saveEmprojSnapshot":
        result = await saveProject(payload);
        break;
      case "hashMediaFile":
        result = await hashMediaFile(payload.filePath);
        break;
      case "computeMediaBaselines":
        result = await computeMediaBaselines(payload);
        break;
      case "preflightCheckMedia":
        result = await preflightCheckMedia(payload);
        break;
      case "findRelinkMatches":
        result = await findRelinkMatches(id, payload);
        break;
      case "maintainMediaStagingIndexOnStartup":
        result = await enqueueStagingMutation(() => maintainMediaStagingIndexOnStartup(payload));
        break;
      case "reconcileStagingForProject":
        result = await enqueueStagingMutation(() => reconcileStagingForProject(payload));
        break;
      case "cleanupMediaStagingDir":
        result = await enqueueStagingMutation(() => cleanupMediaStagingDir(payload));
        break;
      case "ensureStagedMediaFile":
        result = await enqueueStagingMutation(() => ensureStagedMediaFile(payload));
        break;
      case "registerSessionStagedSnapshot":
        result = await enqueueStagingMutation(() => registerSessionStagedSnapshot(payload));
        break;
      case "rememberSessionProject": {
        const { projectGuid, projectPath, queue } = payload;
        result = await enqueueStagingMutation(() => {
          rememberSessionProject(projectGuid, projectPath, queue);
          return { ok: true };
        });
        break;
      }
      case "removeProjectsAtPathExcept": {
        const { projectPath, activeProjectGuid, stagingDir } = payload;
        result = await enqueueStagingMutation(async () => {
          const indexResult = await getStagingIndex(stagingDir).removeProjectsAtPathExcept(projectPath, activeProjectGuid);
          for (const snapshotId of indexResult.eligibleSnapshotIds || []) {
            await deleteStagedSnapshotsById(stagingDir, snapshotId);
          }
          return { ok: true };
        });
        break;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }
    process.parentPort.postMessage({ id, result });
  } catch (err) {
    process.parentPort.postMessage({ id, error: err.message || String(err) });
  }
});
