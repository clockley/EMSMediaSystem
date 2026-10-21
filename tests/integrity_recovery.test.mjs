import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import test from "node:test";
import yazl from "yazl";

import { BibleRpcClient, platformBinaryName } from "../src/main-process/bible_rpc_client.mjs";
import {
  cleanupExtractedProjectMedia,
  loadEmprojSnapshot,
  saveEmprojSnapshot,
} from "../src/main-process/emproj.mjs";
import settings from "../src/main-process/settings.mjs";
import { StagingIndex } from "../src/main-process/staging-index.mjs";

const PROJECT_GUID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT_ID = "0123456789abcdef";

test("corrupt settings are preserved before replacement settings are written", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-settings-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "settings.json"), "{broken", "utf8");

  settings.init(root);
  await settings.set("fresh", true);
  await settings.flush();

  const entries = await readdir(root);
  const backup = entries.find((entry) => entry.startsWith("settings.json.corrupt-"));
  assert.ok(backup);
  assert.equal(await readFile(path.join(root, backup), "utf8"), "{broken");
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "settings.json"), "utf8")), {
    fresh: true,
  });
});

test("corrupt staging metadata quarantines existing files without disabling future cleanup", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-staging-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "staging-index.json"), "{broken", "utf8");
  await writeFile(path.join(root, `${SNAPSHOT_ID}.mp4`), "snapshot", "utf8");

  const first = new StagingIndex(root);
  await first.load();
  assert.equal(first.index.recoveryRequired, false);
  assert.deepEqual(first.index.recoverySnapshotIds, [SNAPSHOT_ID]);
  assert.deepEqual(await first.orphanSnapshotIdsOnDisk(), []);
  const futureOrphanId = "fedcba9876543210";
  await writeFile(path.join(root, `${futureOrphanId}.mp4`), "future orphan", "utf8");
  assert.deepEqual(await first.orphanSnapshotIdsOnDisk(), [futureOrphanId]);
  await first.save();

  const second = new StagingIndex(root);
  await second.load();
  assert.equal(second.index.recoveryRequired, false);
  assert.deepEqual(second.index.recoverySnapshotIds, [SNAPSHOT_ID]);
  assert.deepEqual(await second.orphanSnapshotIdsOnDisk(), [futureOrphanId]);
  assert.equal(await readFile(path.join(root, `${SNAPSHOT_ID}.mp4`), "utf8"), "snapshot");

  await second.reconcileProject({
    projectGuid: PROJECT_GUID,
    projectPath: path.join(root, "recovered.emproj"),
    snapshotIds: [SNAPSHOT_ID],
  });
  assert.deepEqual(second.index.recoverySnapshotIds, []);
  const released = await second.reconcileProject({
    projectGuid: PROJECT_GUID,
    projectPath: path.join(root, "recovered.emproj"),
    snapshotIds: [],
  });
  assert.deepEqual(released.eligibleSnapshotIds, [SNAPSHOT_ID]);
});

test("transient project-read failures retain staging references", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-staging-transient-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectPath = path.join(root, "project.emproj");
  await writeFile(projectPath, "temporarily unreadable project", "utf8");
  const index = new StagingIndex(path.join(root, "staging"));
  await index.reconcileProject({
    projectGuid: PROJECT_GUID,
    projectPath,
    snapshotIds: [SNAPSHOT_ID],
  });

  const eligible = await index.sweepGhostProjects(async () => {
    throw Object.assign(new Error("temporary network failure"), { code: "EIO" });
  });

  assert.deepEqual(eligible, []);
  assert.deepEqual(index.index.projects[PROJECT_GUID].snapshotIds, [SNAPSHOT_ID]);

  await rm(projectPath);
  const missingEligible = await index.sweepGhostProjects(async () => {
    throw new Error("reader should not run for a missing path");
  });
  assert.deepEqual(missingEligible, []);
  assert.deepEqual(index.index.projects[PROJECT_GUID].snapshotIds, [SNAPSHOT_ID]);
});

test("extracted-project cleanup never deletes a similarly named user directory", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-cleanup-safety-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const userDirectory = path.join(root, "ems-emproj-sunday-service");
  const mediaPath = path.join(userDirectory, "video.mp4");
  await mkdir(userDirectory);
  await writeFile(mediaPath, "user media", "utf8");

  await cleanupExtractedProjectMedia({ mediaQueue: [{ path: mediaPath }] });

  assert.equal((await stat(mediaPath)).isFile(), true);
});

test("failed project publication removes its temporary archive", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-project-temp-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const destination = path.join(root, "blocked.emproj");
  await mkdir(destination);

  await assert.rejects(
    saveEmprojSnapshot(destination, { project: { name: "Blocked" }, mediaQueue: [] }),
  );

  assert.deepEqual(
    (await readdir(root)).filter((entry) => entry.startsWith("blocked.emproj.") && entry.endsWith(".tmp")),
    [],
  );
});

test("project loading rejects archives with excessive entry counts", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-project-budget-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archivePath = path.join(root, "too-many.emproj");
  const zip = new yazl.ZipFile();
  const writing = pipeline(zip.outputStream, createWriteStream(archivePath));
  for (let index = 0; index <= 10_000; index += 1) {
    zip.addEmptyDirectory(`entry-${index}/`);
  }
  zip.end();
  await writing;

  await assert.rejects(loadEmprojSnapshot(archivePath), /too many entries/i);
});

test("Bible sidecar can restart after an executable spawn error", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-bible-restart-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binDir = path.join(root, "bin");
  const bundleDir = path.join(root, "bible");
  await mkdir(binDir, { recursive: true });
  await mkdir(bundleDir, { recursive: true });
  await writeFile(path.join(bundleDir, "bundle.manifest.json"), "{}", "utf8");
  const binaryPath = path.join(binDir, platformBinaryName());
  await writeFile(binaryPath, "not executable", { mode: 0o644 });
  const client = new BibleRpcClient({
    app: { isPackaged: false, getPath: () => root },
    devRoot: root,
  });
  t.after(() => client.stop());

  await assert.rejects(client.ready());
  assert.equal(client.child, null);

  await writeFile(
    binaryPath,
    [
      "#!/usr/bin/env node",
      "let buffer = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', chunk => {",
      "  buffer += chunk;",
      "  let newline;",
      "  while ((newline = buffer.indexOf('\\n')) >= 0) {",
      "    const line = buffer.slice(0, newline);",
      "    buffer = buffer.slice(newline + 1);",
      "    if (!line.trim()) continue;",
      "    const request = JSON.parse(line);",
      "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: true }) + '\\n');",
      "  }",
      "});",
    ].join("\n"),
    "utf8",
  );
  await chmod(binaryPath, 0o755);

  assert.equal(await client.ready(), true);
});
