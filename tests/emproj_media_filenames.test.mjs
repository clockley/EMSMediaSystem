import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import fsPromises, { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import test from "node:test";
import { configureMediaFileHasher } from "../src/shared/media-file-hash.mjs";
import yauzl from "yauzl";
import yazl from "yazl";

import {
  cleanupExtractedProjectMedia,
  loadEmprojSnapshot,
  saveEmprojSnapshot,
} from "../src/main-process/emproj.mjs";

function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) reject(err);
      else resolve(zipfile);
    });
  });
}

async function readZipEntries(zipPath) {
  const zipfile = await openZip(zipPath);
  const entries = [];
  await new Promise((resolve, reject) => {
    zipfile.on("entry", (entry) => {
      if (entry.fileName.endsWith("/")) {
        zipfile.readEntry();
        return;
      }
      zipfile.openReadStream(entry, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.once("error", reject);
        stream.once("end", () => {
          entries.push({ path: entry.fileName, buffer: Buffer.concat(chunks) });
          zipfile.readEntry();
        });
      });
    });
    zipfile.once("error", reject);
    zipfile.once("end", resolve);
    zipfile.readEntry();
  });
  return entries;
}

async function writeZipEntries(zipPath, entries) {
  const zipfile = new yazl.ZipFile();
  const writing = pipeline(zipfile.outputStream, createWriteStream(zipPath));
  for (const entry of entries) {
    zipfile.addBuffer(entry.buffer, entry.path);
  }
  zipfile.end();
  await writing;
}

function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function replaceString(value, original, replacement) {
  if (value === original) return replacement;
  if (Array.isArray(value)) {
    return value.map((entry) => replaceString(entry, original, replacement));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        replaceString(entry, original, replacement),
      ]),
    );
  }
  return value;
}

test("packed media names stay stable across repeated restore and autosave cycles", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-packed-name-stability-"));
  const sourceName = `${"R".repeat(205)}.png`;
  const sourcePath = path.join(root, sourceName);
  const sourceBytes = Buffer.from("stable packed media");
  const loadedSnapshots = [];
  t.after(async () => {
    for (const snapshot of loadedSnapshots) {
      await cleanupExtractedProjectMedia(snapshot);
    }
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(sourcePath, sourceBytes);

  let snapshot = {
    project: { name: "Packed filename stability" },
    mediaQueue: [{ path: sourcePath, name: "R", type: "image" }],
  };
  const extractedNames = [];
  for (let round = 0; round < 4; round += 1) {
    const projectPath = path.join(root, `autosave-${round}.emproj`);
    await saveEmprojSnapshot(projectPath, snapshot, {}, { packMedia: true });
    const archiveEntries = await readZipEntries(projectPath);
    const assetsEntry = archiveEntries.find(entry => entry.path === "assets.json");
    const assets = JSON.parse(assetsEntry.buffer.toString("utf8"));
    assert.equal(path.posix.basename(assets.assets[0].path), `0001_${sourceName}`);
    assert.ok(path.posix.basename(assets.assets[0].path).length > 200);
    snapshot = await loadEmprojSnapshot(projectPath);
    loadedSnapshots.push(snapshot);
    extractedNames.push(path.basename(snapshot.mediaQueue[0].path));
    assert.equal(snapshot.mediaQueue[0].originalName, sourceName);
    assert.deepEqual(await readFile(snapshot.mediaQueue[0].path), sourceBytes);
  }

  assert.equal(new Set(extractedNames).size, 1);
});

test("project loading recovers packed media with an overlong legacy archive name", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-packed-name-recovery-"));
  const sourcePath = path.join(root, "R.png");
  const projectPath = path.join(root, "source.emproj");
  const legacyProjectPath = path.join(root, "legacy-overlong.emproj");
  const sourceBytes = Buffer.from("legacy packed media");
  let loaded;
  t.after(async () => {
    if (loaded) await cleanupExtractedProjectMedia(loaded);
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(sourcePath, sourceBytes);
  await saveEmprojSnapshot(
    projectPath,
    {
      project: { name: "Legacy filename recovery" },
      mediaQueue: [{ path: sourcePath, name: "R", type: "image" }],
    },
    {},
    { packMedia: true },
  );

  const entries = await readZipEntries(projectPath);
  const byPath = new Map(entries.map((entry) => [entry.path, entry.buffer]));
  const assets = JSON.parse(byPath.get("assets.json").toString("utf8"));
  const originalArchivePath = assets.assets[0].path;
  const overlongArchivePath = `media/${"0001_".repeat(60)}R.png`;
  assert.ok(path.posix.basename(overlongArchivePath).length > 255);

  assets.assets[0].path = overlongArchivePath;
  const queue = replaceString(
    JSON.parse(byPath.get("queue.json").toString("utf8")),
    originalArchivePath,
    overlongArchivePath,
  );
  const manifest = JSON.parse(byPath.get("manifest.json").toString("utf8"));
  manifest.integrity.hashes[overlongArchivePath] =
    manifest.integrity.hashes[originalArchivePath];
  delete manifest.integrity.hashes[originalArchivePath];
  const assetsBuffer = canonicalJson(assets);
  const queueBuffer = canonicalJson(queue);
  manifest.integrity.hashes["assets.json"] = sha256(assetsBuffer);
  manifest.integrity.hashes["queue.json"] = sha256(queueBuffer);

  const rewrittenEntries = entries.map((entry) => {
    if (entry.path === originalArchivePath) {
      return { ...entry, path: overlongArchivePath };
    }
    if (entry.path === "assets.json") return { ...entry, buffer: assetsBuffer };
    if (entry.path === "queue.json") return { ...entry, buffer: queueBuffer };
    if (entry.path === "manifest.json") {
      return { ...entry, buffer: canonicalJson(manifest) };
    }
    return entry;
  });
  await writeZipEntries(legacyProjectPath, rewrittenEntries);

  loaded = await loadEmprojSnapshot(legacyProjectPath);
  assert.ok(path.basename(loaded.mediaQueue[0].path).length < 100);
  assert.equal(loaded.mediaQueue[0].originalName, "R.png");
  assert.deepEqual(await readFile(loaded.mediaQueue[0].path), sourceBytes);
});

test("packed saves use the pinned version of each cue and retain the prior archive on mismatch", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-project-pins-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stagingDir = path.join(root, "staging");
  const source = path.join(root, "Service.MP4");
  const project = path.join(root, "Service.emproj");
  await mkdir(stagingDir);
  const fingerprint = bytes => sha256(bytes).slice(0, 16);
  configureMediaFileHasher(async file => fingerprint(await readFile(file)));
  const cues = [];
  for (const bytes of ["first version", "second version"]) {
    const pin = fingerprint(bytes);
    await writeFile(path.join(stagingDir, pin + ".mp4"), bytes);
    cues.push({ path: source, liveSource: { mode: "linked", strategy: "snapshot", stagingTier: "full", snapshotId: pin } });
  }
  const opts = { packMedia: true, stagingDir };
  // One pin comes from staging, the other from a matching original.
  await rm(path.join(stagingDir, fingerprint("second version") + ".mp4"));
  await writeFile(source, "second version");
  await saveEmprojSnapshot(project, { mediaQueue: cues }, {}, opts);
  const loaded = await loadEmprojSnapshot(project);
  t.after(() => cleanupExtractedProjectMedia(loaded));
  assert.deepEqual(await Promise.all(loaded.mediaQueue.map(cue => readFile(cue.path, "utf8"))), ["first version", "second version"]);
  const saved = await readFile(project);
  await writeFile(source, "replacement");
  await assert.rejects(saveEmprojSnapshot(project, { mediaQueue: cues }, {}, opts), /Pinned media does not match/);
  assert.deepEqual(await readFile(project), saved);
  assert.equal((await readdir(root)).some(name => name.startsWith(".ems-save-")), false);
});

test("archive bytes and both manifest hashes survive removal of the original during save", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-project-capture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "original.mp4");
  const project = path.join(root, "snapshot.emproj");
  const bytes = Buffer.from("original frame sequence");
  await writeFile(source, bytes);
  configureMediaFileHasher(async file => {
    await rm(source);
    return sha256(await readFile(file)).slice(0, 16);
  });
  await saveEmprojSnapshot(project, { mediaQueue: [{ path: source }] }, {}, { packMedia: true });
  const entries = new Map((await readZipEntries(project)).map(entry => [entry.path, entry.buffer]));
  const [asset] = JSON.parse(entries.get("assets.json")).assets;
  assert.equal(asset.fileHash, sha256(bytes).slice(0, 16));
  assert.equal(JSON.parse(entries.get("manifest.json")).integrity.hashes[asset.path], sha256(bytes));
  assert.deepEqual(entries.get(asset.path), bytes);
});

test("a ZIP source read error rejects the save and keeps the previous project", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-zip-read-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "image.png");
  const project = path.join(root, "service.emproj");
  await writeFile(source, "image");
  await saveEmprojSnapshot(project, { mediaQueue: [] });
  const previous = await readFile(project);
  const addFile = yazl.ZipFile.prototype.addFile;
  t.mock.method(yazl.ZipFile.prototype, "addFile", function(file, ...args) {
    return addFile.call(this, file + ".missing", ...args);
  });
  configureMediaFileHasher(async file => sha256(await readFile(file)).slice(0, 16));
  await assert.rejects(saveEmprojSnapshot(project, { mediaQueue: [{ path: source }] }, {}, { packMedia: true }), { code: "ENOENT" });
  assert.deepEqual(await readFile(project), previous);
  assert.deepEqual((await readdir(root)).sort(), ["image.png", "service.emproj"]);
});

test("a rewrite during capture retries from the new version and repeated changes preserve the prior save", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-moving-media-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "clip.mp4");
  const project = path.join(root, "output.emproj");
  await writeFile(source, "one");
  configureMediaFileHasher(async file => sha256(await readFile(file)).slice(0, 16));
  const copyFile = fsPromises.copyFile;
  let changes = ["second version"];
  const mocked = t.mock.method(fsPromises, "copyFile", async (from, to, flags) => {
    await copyFile(from, to, flags);
    if (from === source && changes.length) await writeFile(source, changes.shift());
  });
  syncBuiltinESMExports();
  t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
  const save = () => saveEmprojSnapshot(project, { mediaQueue: [{ path: source }] }, {}, { packMedia: true });
  await save();
  const restored = await loadEmprojSnapshot(project);
  t.after(() => cleanupExtractedProjectMedia(restored));
  assert.equal(await readFile(restored.mediaQueue[0].path, "utf8"), "second version");
  const previous = await readFile(project);
  changes = ["third", "fourth version"];
  await assert.rejects(save(), /Media changed while saving/);
  assert.deepEqual(await readFile(project), previous);
});

test("a working cue stays linked when the same media is embedded as a logo", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-project-working-link-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "logo.png");
  const project = path.join(root, "working.emproj");
  await writeFile(source, "logo");
  configureMediaFileHasher(async file => sha256(await readFile(file)).slice(0, 16));
  await saveEmprojSnapshot(project, { mediaQueue: [{ path: source }], projectOutputHold: { logoPath: source } });
  const restored = await loadEmprojSnapshot(project);
  t.after(() => cleanupExtractedProjectMedia(restored));
  assert.equal(restored.mediaQueue[0].path, source);
  assert.notEqual(restored.projectOutputHold.logoPath, source);
  assert.equal(await readFile(restored.projectOutputHold.logoPath, "utf8"), "logo");
});
