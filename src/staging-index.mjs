import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { isValidMediaFileHash } from "./media-file-hash.min.mjs";

export const STAGING_INDEX_FILENAME = "staging-index.json";
export const STAGING_INDEX_SCHEMA_VERSION = 1;

const PROJECT_GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGED_SNAPSHOT_FILENAME_RE = /^([a-f0-9]{16})(\.[^.]+)?$/i;

function emptyIndex() {
  return {
    schemaVersion: STAGING_INDEX_SCHEMA_VERSION,
    snapshots: {},
    projects: {},
  };
}

export function normalizeProjectGuid(value) {
  const guid = typeof value === "string" ? value.trim().toLowerCase() : "";
  return PROJECT_GUID_RE.test(guid) ? guid : "";
}

export function normalizeSnapshotId(value) {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isValidMediaFileHash(id) ? id : "";
}

export function snapshotIdFromStagedFilename(filename) {
  const base = path.basename(String(filename || ""));
  const match = STAGED_SNAPSHOT_FILENAME_RE.exec(base);
  return match ? normalizeSnapshotId(match[1]) : "";
}

function sortedUnique(values, normalize) {
  const out = new Set();
  if (Array.isArray(values)) {
    for (const value of values) {
      const normalized = normalize(value);
      if (normalized) out.add(normalized);
    }
  }
  return [...out].sort();
}

function normalizeIndex(raw) {
  if (!raw || typeof raw !== "object") return emptyIndex();

  const rawProjects = raw.projects && typeof raw.projects === "object"
    ? raw.projects
    : {};
  const rawSnapshots = raw.snapshots && typeof raw.snapshots === "object"
    ? raw.snapshots
    : {};
  const projects = {};
  const snapshots = {};

  for (const [rawGuid, rawProject] of Object.entries(rawProjects)) {
    const projectGuid = normalizeProjectGuid(rawGuid);
    if (!projectGuid || !rawProject || typeof rawProject !== "object") continue;
    const snapshotIds = sortedUnique(rawProject.snapshotIds, normalizeSnapshotId);
    projects[projectGuid] = {
      path: typeof rawProject.path === "string" ? rawProject.path : "",
      lastOpenedMs: Number.isFinite(rawProject.lastOpenedMs)
        ? rawProject.lastOpenedMs
        : 0,
      snapshotIds,
      unsaved: rawProject.unsaved === true || undefined,
    };
  }

  for (const [rawId, rawSnapshot] of Object.entries(rawSnapshots)) {
    const snapshotId = normalizeSnapshotId(rawId);
    if (!snapshotId || !rawSnapshot || typeof rawSnapshot !== "object") continue;
    snapshots[snapshotId] = {
      refCount: 0,
      projectGuids: [],
      protectedBy: sortedUnique(rawSnapshot.protectedBy, normalizeProjectGuid),
      lastPinnedMs: Number.isFinite(rawSnapshot.lastPinnedMs)
        ? rawSnapshot.lastPinnedMs
        : 0,
    };
  }

  for (const [projectGuid, project] of Object.entries(projects)) {
    for (const snapshotId of project.snapshotIds) {
      if (!snapshots[snapshotId]) {
        snapshots[snapshotId] = {
          refCount: 0,
          projectGuids: [],
          protectedBy: [],
          lastPinnedMs: 0,
        };
      }
      if (!snapshots[snapshotId].projectGuids.includes(projectGuid)) {
        snapshots[snapshotId].projectGuids.push(projectGuid);
      }
    }
  }

  for (const [snapshotId, snapshot] of Object.entries(snapshots)) {
    snapshot.projectGuids = sortedUnique(snapshot.projectGuids, normalizeProjectGuid);
    snapshot.protectedBy = sortedUnique(snapshot.protectedBy, normalizeProjectGuid)
      .filter((guid) => snapshot.projectGuids.includes(guid));
    snapshot.refCount = snapshot.projectGuids.length;
    if (snapshot.refCount === 0 && snapshot.protectedBy.length === 0) {
      delete snapshots[snapshotId];
    }
  }

  return {
    schemaVersion: STAGING_INDEX_SCHEMA_VERSION,
    snapshots,
    projects,
  };
}

async function atomicWriteJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

function snapshotDeletionEligible(snapshot) {
  return (
    !snapshot ||
    ((Number(snapshot.refCount) || 0) === 0 &&
      (!Array.isArray(snapshot.protectedBy) || snapshot.protectedBy.length === 0))
  );
}

export class StagingIndex {
  constructor(stagingDir) {
    this.stagingDir = stagingDir;
    this.index = emptyIndex();
    this.loaded = false;
  }

  get filePath() {
    return path.join(this.stagingDir, STAGING_INDEX_FILENAME);
  }

  async load() {
    if (this.loaded) return this.index;
    await mkdir(this.stagingDir, { recursive: true });
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8"));
      this.index = normalizeIndex(raw);
    } catch (err) {
      if (err?.code !== "ENOENT") {
        const backupPath = `${this.filePath}.bak`;
        await rm(backupPath, { force: true }).catch(() => {});
        await rename(this.filePath, backupPath).catch(() => {});
        console.error("Staging index was corrupt; starting with an empty index:", err);
      }
      this.index = emptyIndex();
    }
    this.loaded = true;
    return this.index;
  }

  async save() {
    await this.load();
    this.index = normalizeIndex(this.index);
    await atomicWriteJson(this.filePath, this.index);
  }

  async registerSnapshot({ projectGuid, projectPath = "", snapshotId, unsaved = false }) {
    const guid = normalizeProjectGuid(projectGuid);
    const id = normalizeSnapshotId(snapshotId);
    if (!guid || !id) return { ok: false };
    await this.load();

    const now = Date.now();
    const project = this.index.projects[guid] || {
      path: "",
      lastOpenedMs: now,
      snapshotIds: [],
    };
    project.path = typeof projectPath === "string" ? projectPath : "";
    project.lastOpenedMs = now;
    project.unsaved = unsaved === true || undefined;
    if (!project.snapshotIds.includes(id)) project.snapshotIds.push(id);
    project.snapshotIds = sortedUnique(project.snapshotIds, normalizeSnapshotId);
    this.index.projects[guid] = project;

    const snapshot = this.index.snapshots[id] || {
      refCount: 0,
      projectGuids: [],
      protectedBy: [],
      lastPinnedMs: 0,
    };
    if (!snapshot.projectGuids.includes(guid)) snapshot.projectGuids.push(guid);
    snapshot.projectGuids = sortedUnique(snapshot.projectGuids, normalizeProjectGuid);
    snapshot.protectedBy = sortedUnique(snapshot.protectedBy, normalizeProjectGuid)
      .filter((protectedGuid) => snapshot.projectGuids.includes(protectedGuid));
    snapshot.refCount = snapshot.projectGuids.length;
    snapshot.lastPinnedMs = now;
    this.index.snapshots[id] = snapshot;

    await this.save();
    return { ok: true };
  }

  async reconcileProject({
    projectGuid,
    projectPath = "",
    snapshotIds = [],
    protectedSnapshotIds,
    unsaved = false,
  }) {
    const guid = normalizeProjectGuid(projectGuid);
    if (!guid) return { ok: false, eligibleSnapshotIds: [] };
    await this.load();

    const now = Date.now();
    const nextIds = new Set(sortedUnique(snapshotIds, normalizeSnapshotId));
    const hasProtectedSnapshotIds = Array.isArray(protectedSnapshotIds);
    const nextProtectedIds = hasProtectedSnapshotIds
      ? new Set(sortedUnique(protectedSnapshotIds, normalizeSnapshotId))
      : null;
    const previousIds = new Set(this.index.projects[guid]?.snapshotIds || []);
    const idsToTouch = new Set([...previousIds, ...nextIds]);

    if (nextIds.size > 0) {
      this.index.projects[guid] = {
        path: typeof projectPath === "string" ? projectPath : "",
        lastOpenedMs: now,
        snapshotIds: [...nextIds].sort(),
        unsaved: unsaved === true || undefined,
      };
    } else {
      delete this.index.projects[guid];
    }

    const eligibleSnapshotIds = [];
    for (const snapshotId of idsToTouch) {
      let snapshot = this.index.snapshots[snapshotId] || {
        refCount: 0,
        projectGuids: [],
        protectedBy: [],
        lastPinnedMs: 0,
      };
      const projectGuids = new Set(snapshot.projectGuids || []);
      const protectedBy = new Set(snapshot.protectedBy || []);

      if (nextIds.has(snapshotId)) {
        projectGuids.add(guid);
        if (hasProtectedSnapshotIds) {
          if (nextProtectedIds.has(snapshotId)) protectedBy.add(guid);
          else protectedBy.delete(guid);
        }
        if (!snapshot.lastPinnedMs) snapshot.lastPinnedMs = now;
      } else {
        projectGuids.delete(guid);
        protectedBy.delete(guid);
      }

      snapshot.projectGuids = sortedUnique([...projectGuids], normalizeProjectGuid);
      snapshot.protectedBy = sortedUnique([...protectedBy], normalizeProjectGuid)
        .filter((protectedGuid) => snapshot.projectGuids.includes(protectedGuid));
      snapshot.refCount = snapshot.projectGuids.length;

      if (snapshotDeletionEligible(snapshot)) {
        delete this.index.snapshots[snapshotId];
        eligibleSnapshotIds.push(snapshotId);
      } else {
        this.index.snapshots[snapshotId] = snapshot;
      }
    }

    await this.save();
    return { ok: true, eligibleSnapshotIds };
  }

  async removeProject(projectGuid) {
    const guid = normalizeProjectGuid(projectGuid);
    if (!guid) return { ok: false, eligibleSnapshotIds: [] };
    await this.load();
    const project = this.index.projects[guid];
    const snapshotIds = Array.isArray(project?.snapshotIds) ? project.snapshotIds : [];
    return this.reconcileProject({
      projectGuid: guid,
      projectPath: "",
      snapshotIds: [],
      protectedSnapshotIds: [],
      unsaved: false,
    }).then((result) => ({
      ...result,
      eligibleSnapshotIds: sortedUnique(
        [...(result.eligibleSnapshotIds || []), ...snapshotIds],
        normalizeSnapshotId,
      ).filter((snapshotId) => !this.index.snapshots[snapshotId]),
    }));
  }

  async removeProjectsAtPathExcept(projectPath, projectGuid) {
    const keepGuid = normalizeProjectGuid(projectGuid);
    const normalizedPath = typeof projectPath === "string" ? projectPath : "";
    if (!normalizedPath) return { ok: true, eligibleSnapshotIds: [] };
    await this.load();
    const eligibleSnapshotIds = [];
    for (const [guid, project] of Object.entries({ ...this.index.projects })) {
      if (guid === keepGuid) continue;
      if (project?.path !== normalizedPath) continue;
      const result = await this.removeProject(guid);
      eligibleSnapshotIds.push(...(result.eligibleSnapshotIds || []));
    }
    return {
      ok: true,
      eligibleSnapshotIds: sortedUnique(eligibleSnapshotIds, normalizeSnapshotId),
    };
  }

  async sweepGhostProjects(readProjectGuid) {
    await this.load();
    const eligibleSnapshotIds = [];
    for (const [projectGuid, project] of Object.entries({ ...this.index.projects })) {
      if (project?.unsaved === true) {
        const result = await this.removeProject(projectGuid);
        eligibleSnapshotIds.push(...(result.eligibleSnapshotIds || []));
        continue;
      }
      const projectPath = typeof project?.path === "string" ? project.path : "";
      if (!projectPath) {
        if (!Array.isArray(project?.snapshotIds) || project.snapshotIds.length === 0) {
          delete this.index.projects[projectGuid];
        }
        continue;
      }
      let exists = false;
      try {
        const info = await stat(projectPath);
        exists = info.isFile();
      } catch {
        exists = false;
      }
      if (!exists) {
        const result = await this.removeProject(projectGuid);
        eligibleSnapshotIds.push(...(result.eligibleSnapshotIds || []));
        continue;
      }
      let actualGuid = "";
      try {
        actualGuid = normalizeProjectGuid(await readProjectGuid(projectPath));
      } catch {
        actualGuid = "";
      }
      if (!actualGuid || actualGuid !== projectGuid) {
        const result = await this.removeProject(projectGuid);
        eligibleSnapshotIds.push(...(result.eligibleSnapshotIds || []));
      }
    }
    await this.save();
    return sortedUnique(eligibleSnapshotIds, normalizeSnapshotId);
  }

  async orphanSnapshotIdsOnDisk() {
    await this.load();
    let entries = [];
    try {
      entries = await readdir(this.stagingDir);
    } catch (err) {
      if (err?.code === "ENOENT") return [];
      throw err;
    }
    const orphanIds = new Set();
    for (const entry of entries) {
      if (entry === STAGING_INDEX_FILENAME || entry.startsWith(".ems-reflink-probe")) {
        continue;
      }
      const snapshotId = snapshotIdFromStagedFilename(entry);
      if (!snapshotId) continue;
      const snapshot = this.index.snapshots[snapshotId];
      if (snapshotDeletionEligible(snapshot)) orphanIds.add(snapshotId);
    }
    return [...orphanIds].sort();
  }
}
