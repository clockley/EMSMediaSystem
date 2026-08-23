import { mkdir, readFile, readdir, rename, rm, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { normalizeTheme } from "./theme-normalize.mjs";
import { themeRevision } from "./theme-resolver.mjs";

const json = value => `${JSON.stringify(value, null, 2)}\n`;
const safeId = id => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id || "")) throw new TypeError("Invalid theme id");
  return id;
};

export class ThemeLibrary {
  constructor(rootDir) { this.rootDir = rootDir; }
  themeDir(id) { return path.join(this.rootDir, safeId(id)); }
  async init() { await mkdir(this.rootDir, { recursive: true }); await this.rebuildIndex(); return this; }
  async list() {
    try { return JSON.parse(await readFile(path.join(this.rootDir, "index.json"), "utf8")).themes || []; }
    catch { return this.rebuildIndex(); }
  }
  async get(id) { return normalizeTheme(JSON.parse(await readFile(path.join(this.themeDir(id), "theme.json"), "utf8"))); }
  async save(theme) {
    const normalized = normalizeTheme(theme); const dir = this.themeDir(normalized.id);
    await mkdir(path.join(dir, "assets"), { recursive: true });
    const temporary = path.join(dir, `theme.${randomUUID()}.tmp`);
    await writeFile(temporary, json(normalized), { flag: "wx" }); await rename(temporary, path.join(dir, "theme.json"));
    await this.rebuildIndex(); return { theme: normalized, revision: themeRevision(normalized) };
  }
  async duplicate(id, { id: newId = `theme_${randomUUID().replace(/-/g, "")}`, name } = {}) {
    const source = await this.get(id); return this.save({ ...source, id: newId, name: name || `${source.name} Copy`, baseThemeId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  async delete(id) { await rm(this.themeDir(id), { recursive: true, force: true }); return this.rebuildIndex(); }
  async rebuildIndex() {
    await mkdir(this.rootDir, { recursive: true }); const themes = [];
    for (const entry of await readdir(this.rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try { const theme = await this.get(entry.name); themes.push({ id: theme.id, name: theme.name, description: theme.description || "", revision: themeRevision(theme), updatedAt: theme.updatedAt || null }); } catch {}
    }
    themes.sort((a, b) => a.name.localeCompare(b.name)); await writeFile(path.join(this.rootDir, "index.json"), json({ schema: "ems.theme-library.v1", themes })); return themes;
  }
}

export function createThemeEditorSession(theme) {
  const original = normalizeTheme(theme); let draft = structuredClone(original);
  return { get original() { return structuredClone(original); }, get draft() { return structuredClone(draft); }, get dirty() { return JSON.stringify(original) !== JSON.stringify(draft); }, update(patch) { draft = { ...draft, ...structuredClone(patch), updatedAt: new Date().toISOString() }; return this.draft; }, revert() { draft = structuredClone(original); return this.draft; }, apply() { return normalizeTheme(draft); } };
}
