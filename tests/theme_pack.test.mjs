import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  await destinationLibrary.save({ ...theme, name: "Locally Modified" });
  const replaced = await importThemePack(packPath, destinationLibrary, { conflict: "replace" });
  assert.equal(replaced.theme.name, "Shared Theme");
  assert.equal((await destinationLibrary.get("shared_theme")).name, "Shared Theme");
  const second = await importThemePack(packPath, destinationLibrary);
  assert.equal(second.importedAsCopy, true);
  assert.notEqual(second.theme.id, "shared_theme");
  await assert.rejects(importThemePack(packPath, destinationLibrary, { conflict: "reject" }), /already exists/i);
});

test("theme packs import across filesystem boundaries", async t => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "ems-theme-pack-source-"));
  t.after(() => rm(sourceRoot, { recursive: true, force: true }));
  const sourceDevice = (await stat(sourceRoot)).dev;
  let destinationRoot = "";
  for (const candidate of [os.homedir(), "/dev/shm"]) {
    try {
      if ((await stat(candidate)).dev === sourceDevice) continue;
      destinationRoot = await mkdtemp(path.join(candidate, ".ems-theme-pack-destination-"));
      break;
    } catch {}
  }
  if (!destinationRoot) {
    t.skip("no writable second filesystem is available");
    return;
  }
  t.after(() => rm(destinationRoot, { recursive: true, force: true }));

  const theme = {
    schema: "ems.theme.v1",
    id: "cross_device_theme",
    name: "Cross Device Theme",
    profiles: {},
    assets: [],
  };
  const sourceLibrary = await new ThemeLibrary(path.join(sourceRoot, "library")).init();
  await sourceLibrary.save(theme);
  const packPath = path.join(sourceRoot, "cross-device.emtheme");
  await exportThemePack({ theme, themeDir: sourceLibrary.themeDir(theme.id), destination: packPath });
  const destinationLibrary = await new ThemeLibrary(path.join(destinationRoot, "library")).init();
  const imported = await importThemePack(packPath, destinationLibrary);
  assert.equal(imported.theme.id, theme.id);
  assert.equal((await destinationLibrary.get(theme.id)).name, theme.name);
});

test("failed replacement restores the previous theme", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-theme-replace-rollback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceLibrary = await new ThemeLibrary(path.join(root, "source")).init();
  const replacement = {
    schema: "ems.theme.v1",
    id: "rollback_theme",
    name: "Replacement Theme",
    profiles: {},
    assets: [],
  };
  await sourceLibrary.save(replacement);
  const packPath = path.join(root, "replacement.emtheme");
  await exportThemePack({
    theme: replacement,
    themeDir: sourceLibrary.themeDir(replacement.id),
    destination: packPath,
  });

  const destinationLibrary = await new ThemeLibrary(path.join(root, "destination")).init();
  await destinationLibrary.save({ ...replacement, name: "Original Theme" });
  const rebuildIndex = destinationLibrary.rebuildIndex.bind(destinationLibrary);
  let injectedFailure = false;
  destinationLibrary.rebuildIndex = async () => {
    if (!injectedFailure) {
      injectedFailure = true;
      throw new Error("injected index failure");
    }
    return rebuildIndex();
  };

  await assert.rejects(
    importThemePack(packPath, destinationLibrary, { conflict: "replace" }),
    /injected index failure/,
  );
  assert.equal((await destinationLibrary.get("rollback_theme")).name, "Original Theme");
  assert.equal((await destinationLibrary.list()).some((entry) => entry.name === "Original Theme"), true);
});

test("theme duplication does not publish a copy with missing assets", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-theme-duplicate-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = await new ThemeLibrary(path.join(root, "themes")).init();
  const themeDir = library.themeDir("source_theme");
  const sourceAsset = path.join(root, "asset.png");
  await writeFile(sourceAsset, Buffer.from("asset"));
  const asset = await importThemeAsset(sourceAsset, path.join(themeDir, "assets"), { id: "asset" });
  await library.save({
    schema: "ems.theme.v1",
    id: "source_theme",
    name: "Source Theme",
    profiles: {},
    assets: [asset],
  });

  const duplicate = await library.duplicate("source_theme", { id: "complete_copy" });
  assert.deepEqual(
    await readFile(path.join(library.themeDir("complete_copy"), asset.path)),
    await readFile(sourceAsset),
  );
  assert.equal(duplicate.theme.id, "complete_copy");

  await rm(path.join(themeDir, asset.path), { force: true });
  await assert.rejects(
    library.duplicate("source_theme", { id: "broken_copy" }),
    /asset is missing or unmanaged/i,
  );
  await assert.rejects(readFile(path.join(library.themeDir("broken_copy"), "theme.json")), /ENOENT/);
  assert.equal((await library.list()).some((entry) => entry.id === "broken_copy"), false);
});

test("theme save rolls the theme file back when index publication fails", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-theme-save-rollback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = await new ThemeLibrary(path.join(root, "themes")).init();
  const original = {
    schema: "ems.theme.v1",
    id: "save_rollback",
    name: "Original",
    profiles: {},
    assets: [],
  };
  await library.save(original);
  const rebuildIndex = library.rebuildIndex.bind(library);
  let failed = false;
  library.rebuildIndex = async () => {
    if (!failed) {
      failed = true;
      throw new Error("injected index failure");
    }
    return rebuildIndex();
  };

  await assert.rejects(library.save({ ...original, name: "Uncommitted" }), /injected index failure/);
  assert.equal((await library.get(original.id)).name, "Original");
  assert.equal((await library.list()).find((entry) => entry.id === original.id).name, "Original");
});

test("theme delete restores the directory when index publication fails", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-theme-delete-rollback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = await new ThemeLibrary(path.join(root, "themes")).init();
  const theme = {
    schema: "ems.theme.v1",
    id: "delete_rollback",
    name: "Keep Me",
    profiles: {},
    assets: [],
  };
  await library.save(theme);
  const rebuildIndex = library.rebuildIndex.bind(library);
  let failed = false;
  library.rebuildIndex = async () => {
    if (!failed) {
      failed = true;
      throw new Error("injected delete index failure");
    }
    return rebuildIndex();
  };

  await assert.rejects(library.delete(theme.id), /injected delete index failure/);
  assert.equal((await library.get(theme.id)).name, "Keep Me");
  assert.equal((await library.list()).some((entry) => entry.id === theme.id), true);
});

test("theme initialization removes files not declared by the saved theme", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-theme-orphan-assets-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const themesRoot = path.join(root, "themes");
  const library = await new ThemeLibrary(themesRoot).init();
  const theme = {
    schema: "ems.theme.v1",
    id: "orphan_cleanup",
    name: "Orphan Cleanup",
    profiles: {},
    assets: [],
  };
  await library.save(theme);
  const orphan = path.join(library.themeDir(theme.id), "assets", "discarded.png");
  await writeFile(orphan, "discarded", "utf8");

  await new ThemeLibrary(themesRoot).init();
  await assert.rejects(readFile(orphan), /ENOENT/);
});

test("saving a replacement background removes the previously committed asset file", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-theme-replaced-asset-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = await new ThemeLibrary(path.join(root, "themes")).init();
  const sourceAsset = path.join(root, "old.png");
  await writeFile(sourceAsset, "old asset", "utf8");
  const themeDir = library.themeDir("asset_replacement");
  const asset = await importThemeAsset(sourceAsset, path.join(themeDir, "assets"), {
    id: "old_background",
  });
  const theme = {
    schema: "ems.theme.v1",
    id: "asset_replacement",
    name: "Asset Replacement",
    profiles: {
      song: {
        audience: {
          canvas: { background: { type: "image", assetId: asset.id } },
        },
      },
    },
    assets: [asset],
  };
  await library.save(theme);
  const managedAsset = path.join(themeDir, asset.path);
  assert.equal((await stat(managedAsset)).isFile(), true);

  await library.save({ ...theme, profiles: {}, assets: [] });

  await assert.rejects(readFile(managedAsset), /ENOENT/);
});
