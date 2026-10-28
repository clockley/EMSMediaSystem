import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import test from "node:test";
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
