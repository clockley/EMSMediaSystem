import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("paid Bible staging includes legacy private import metadata", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "ems-bible-stage-"));
  try {
    const privateRoot = path.join(workspace, "private-bibles");
    const derivedRoot = path.join(workspace, "derived");
    mkdirSync(privateRoot, { recursive: true });
    writeFileSync(
      path.join(privateRoot, "bible-imports.json"),
      `${JSON.stringify({
        translations: [
          {
            abbreviation: "TPV",
            jsonFile: "TEST PRIVATE VERSION.json",
            language: "english",
            version: "Test Private Version",
            infoUrl: "https://example.test/tpv",
            publisher: "Example Publisher",
            copyright: "Copyright 2026 Example Publisher",
            copyrightInfo: "Test Private Version. Used by permission.",
          },
        ],
      }, null, 2)}\n`,
    );
    writeFileSync(
      path.join(privateRoot, "TEST PRIVATE VERSION.json"),
      `${JSON.stringify({ Genesis: { 1: { 1: "Private test verse." } } }, null, 2)}\n`,
    );

    const result = spawnSync(
      process.execPath,
      [path.resolve("sidecars/bible-rpc/stage-bible-sources.mjs"), "paid", derivedRoot],
      {
        cwd: path.resolve("."),
        env: { ...process.env, BIBLE_PRIVATE_ROOT: privateRoot },
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const bundlePath = path.join(derivedRoot, "bible", "bundle.manifest.json");
    const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
    assert.equal(bundle.edition, "paid");
    assert.ok(bundle.sources.includes("sources/TEST PRIVATE VERSION.manifest.json"));

    const manifestPath = path.join(derivedRoot, "bible", "sources", "TEST PRIVATE VERSION.manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.id, "private:tpv");
    assert.equal(manifest.abbreviation, "TPV");
    assert.equal(manifest.name, "Test Private Version");
    assert.equal(manifest.contentFile, "TEST PRIVATE VERSION.json");
    assert.equal(manifest.publicDomain, false);
    assert.ok(existsSync(path.join(derivedRoot, "bible", "sources", manifest.contentFile)));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
