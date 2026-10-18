import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { normalizeTheme } from "./theme-normalize.mjs";
import { themeRevision } from "./theme-resolver.mjs";
import { resolveManagedThemeAsset } from "./theme-assets.mjs";

const json = value => `${JSON.stringify(value, null, 2)}\n`;
const safeId = id => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id || "")) throw new TypeError("Invalid theme id");
  return id;
};

export class ThemeLibrary {
  constructor(rootDir) { this.rootDir = rootDir; }
  themeDir(id) { return path.join(this.rootDir, safeId(id)); }
  async init() {
    await mkdir(this.rootDir, { recursive: true });
    await this.rebuildIndex();
    await this.pruneOrphanedAssetFiles().catch(error => {
      console.error("Failed to prune orphaned theme assets:", error);
    });
    return this;
  }
  async list() {
    try { return JSON.parse(await readFile(path.join(this.rootDir, "index.json"), "utf8")).themes || []; }
    catch { return this.rebuildIndex(); }
  }
  async get(id) { return normalizeTheme(JSON.parse(await readFile(path.join(this.themeDir(id), "theme.json"), "utf8"))); }
  async save(theme) {
    const normalized = normalizeTheme(theme); const dir = this.themeDir(normalized.id);
    await mkdir(path.join(dir, "assets"), { recursive: true });
    const temporary = path.join(dir, `theme.${randomUUID()}.tmp`);
    const themePath = path.join(dir, "theme.json");
    let previousTheme = null;
    try { previousTheme = await readFile(themePath); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    let committed = false;
    try {
      await writeFile(temporary, json(normalized), { flag: "wx" });
      await rename(temporary, themePath);
      committed = true;
      await this.rebuildIndex();
      await this.pruneOrphanedAssetFiles(normalized.id).catch(error => {
        console.error("Failed to prune orphaned theme assets:", error);
      });
      return { theme: normalized, revision: themeRevision(normalized) };
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      if (!committed) throw error;
      const rollbackErrors = [];
      try {
        if (previousTheme === null) {
          await rm(themePath, { force: true });
        } else {
          const rollbackPath = path.join(dir, `theme.${randomUUID()}.rollback.tmp`);
          try {
            await writeFile(rollbackPath, previousTheme, { flag: "wx" });
            await rename(rollbackPath, themePath);
          } finally {
            await rm(rollbackPath, { force: true }).catch(() => {});
          }
        }
      } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      try { await this.rebuildIndex(); }
      catch (rollbackError) { rollbackErrors.push(rollbackError); }
      if (rollbackErrors.length > 0) {
        throw new AggregateError([error, ...rollbackErrors], "Theme save failed and rollback was incomplete");
      }
      throw error;
    }
  }
  async duplicate(id, { id: newId = `theme_${randomUUID().replace(/-/g, "")}`, name } = {}) {
    const source = await this.get(id);
    const now = new Date().toISOString();
    const duplicate = normalizeTheme({ ...source, id: newId, name: name || `${source.name} Copy`, baseThemeId: null, createdAt: now, updatedAt: now });
    await mkdir(this.rootDir, { recursive: true });
    const staging = await mkdtemp(path.join(this.rootDir, ".ems-theme-duplicate-"));
    const target = this.themeDir(newId);
    let installed = false;
    try {
      await mkdir(path.join(staging, "assets"), { recursive: true });
      for (const asset of source.assets || []) {
        const sourcePath = await resolveManagedThemeAsset(this.themeDir(id), asset);
        if (!sourcePath) throw new Error(`Theme asset is missing or unmanaged: ${asset.id}`);
        const destination = path.join(staging, asset.path);
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(sourcePath, destination);
      }
      await writeFile(path.join(staging, "theme.json"), json(duplicate), { flag: "wx" });
      await rename(staging, target);
      installed = true;
      await this.rebuildIndex();
      return { theme: duplicate, revision: themeRevision(duplicate) };
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      if (installed) {
        await rm(target, { recursive: true, force: true }).catch(() => {});
        await this.rebuildIndex().catch(() => {});
      }
      throw error;
    }
  }
  async delete(id) {
    const target = this.themeDir(id);
    const backup = path.join(this.rootDir, `.ems-theme-delete-${randomUUID()}`);
    try { await rename(target, backup); }
    catch (error) {
      if (error?.code === "ENOENT") return this.rebuildIndex();
      throw error;
    }
    try {
      const themes = await this.rebuildIndex();
      await rm(backup, { recursive: true, force: true }).catch((error) => {
        console.error("Failed to remove deleted theme backup:", error);
      });
      return themes;
    } catch (error) {
      const rollbackErrors = [];
      try { await rename(backup, target); }
      catch (rollbackError) { rollbackErrors.push(rollbackError); }
      try { await this.rebuildIndex(); }
      catch (rollbackError) { rollbackErrors.push(rollbackError); }
      if (rollbackErrors.length > 0) {
        throw new AggregateError([error, ...rollbackErrors], "Theme delete failed and rollback was incomplete");
      }
      throw error;
    }
  }
  async pruneOrphanedAssetFiles(themeId = null) {
    for (const entry of await readdir(this.rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (themeId && entry.name !== themeId) continue;
      let theme;
      let dir;
      try {
        dir = this.themeDir(entry.name);
        theme = await this.get(entry.name);
      } catch { continue; }
      if (theme.id !== entry.name) continue;
      const keep = new Set();
      for (const asset of theme.assets || []) {
        const managedPath = await resolveManagedThemeAsset(dir, asset);
        if (managedPath) keep.add(path.resolve(managedPath));
      }
      const assetsDir = path.join(dir, "assets");
      const visit = async currentDir => {
        let entries;
        try { entries = await readdir(currentDir, { withFileTypes: true }); }
        catch (error) { if (error?.code === "ENOENT") return; throw error; }
        for (const assetEntry of entries) {
          const candidate = path.join(currentDir, assetEntry.name);
          if (assetEntry.isDirectory()) {
            await visit(candidate);
            const remaining = await readdir(candidate).catch(() => ["unreadable"]);
            if (remaining.length === 0) await rm(candidate, { recursive: true, force: true });
          } else if (!keep.has(path.resolve(candidate))) {
            await rm(candidate, { force: true });
          }
        }
      };
      await visit(assetsDir);
    }
  }
  async rebuildIndex() {
    await mkdir(this.rootDir, { recursive: true }); const themes = [];
    for (const entry of await readdir(this.rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try { const theme = await this.get(entry.name); if (theme.id !== entry.name) continue; themes.push({ id: theme.id, name: theme.name, description: theme.description || "", revision: themeRevision(theme), updatedAt: theme.updatedAt || null }); } catch {}
    }
    themes.sort((a, b) => a.name.localeCompare(b.name));
    const indexPath = path.join(this.rootDir, "index.json");
    const temporary = path.join(this.rootDir, `.index.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, json({ schema: "ems.theme-library.v1", themes }), { flag: "wx" });
      await rename(temporary, indexPath);
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
    return themes;
  }
}

export function createThemeEditorSession(theme) {
  const original = normalizeTheme(theme); let draft = structuredClone(original);
  return { get original() { return structuredClone(original); }, get draft() { return structuredClone(draft); }, get dirty() { return JSON.stringify(original) !== JSON.stringify(draft); }, update(patch) { draft = { ...draft, ...structuredClone(patch), updatedAt: new Date().toISOString() }; return this.draft; }, revert() { draft = structuredClone(original); return this.draft; }, apply() { return normalizeTheme(draft); } };
}
