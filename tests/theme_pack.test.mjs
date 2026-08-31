import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ThemeLibrary } from "../src/shared/theme-manager.mjs";
import { importThemeAsset } from "../src/shared/theme-assets.mjs";
import { exportThemePack, importThemePack, inspectThemePack, THEME_PACK_SCHEMA } from "../src/shared/theme-pack.mjs";

test(".emtheme round trip includes verified assets and handles ID collisions", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-theme-pack-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceLibrary = await new ThemeLibrary(path.join(root, "source")).init();
  const themeDir = sourceLibrary.themeDir("shared_theme");
  const sourceAsset = path.join(root, "background.png");
  await writeFile(sourceAsset, Buffer.from("not-a-real-png-but-portable"));
  const asset = await importThemeAsset(sourceAsset, path.join(themeDir, "assets"), { id: "background", name: "Blue background" });
  const theme = {
    schema: "ems.theme.v1", id: "shared_theme", name: "Shared Theme",
    profiles: { song: { audience: { canvas: { background: { type: "image", assetId: asset.id, color: "#000000" } } } }, scripture: {}, text: {} },
    assets: [asset],
  };
  await sourceLibrary.save(theme);
  const packPath = path.join(root, "shared.emtheme");
  const exported = await exportThemePack({ theme, themeDir, destination: packPath, app: { version: "test" } });
  assert.equal(exported.manifest.schema, THEME_PACK_SCHEMA);
  const inspected = await inspectThemePack(packPath);
  assert.equal(inspected.theme.name, "Shared Theme");
  assert.deepEqual(inspected.entries.get(asset.path), await readFile(sourceAsset));

  const destinationLibrary = await new ThemeLibrary(path.join(root, "destination")).init();
  const first = await importThemePack(packPath, destinationLibrary);
  assert.equal(first.theme.id, "shared_theme");
  assert.deepEqual(await readFile(path.join(destinationLibrary.themeDir("shared_theme"), asset.path)), await readFile(sourceAsset));
  const second = await importThemePack(packPath, destinationLibrary);
  assert.equal(second.importedAsCopy, true);
  assert.notEqual(second.theme.id, "shared_theme");
  await assert.rejects(importThemePack(packPath, destinationLibrary, { conflict: "reject" }), /already exists/i);
});
