import path from "path";
import { normalizeTheme } from "./theme-normalize.mjs";
import { themeRevision } from "./theme-resolver.mjs";

export function createProjectThemeSnapshot(themes = [], bindings = {}) {
  const snapshots = Object.fromEntries(themes.map(theme => { const normalized = normalizeTheme(theme); return [normalized.id, { theme: normalized, revision: themeRevision(normalized) }]; }));
  return { schema: "ems.project-themes.v1", bindings: { song: bindings.song || null, scripture: bindings.scripture || null, text: bindings.text || null, lowerThird: bindings.lowerThird || null }, snapshots };
}

export function resolveProjectTheme(projectThemes, binding, libraryTheme) {
  const embedded = projectThemes?.snapshots?.[binding]?.theme;
  return embedded ? normalizeTheme(embedded) : libraryTheme ? normalizeTheme(libraryTheme) : null;
}

export function projectThemeArchiveEntries(projectThemes) {
  const entries = [];
  for (const [id, snapshot] of Object.entries(projectThemes?.snapshots || {})) {
    const theme = normalizeTheme(snapshot.theme); entries.push({ archivePath: `themes/${id}/theme.json`, data: `${JSON.stringify(theme, null, 2)}\n` });
    for (const asset of theme.assets) if (asset.path) entries.push({ archivePath: `themes/${id}/${asset.path}`, sourcePath: asset.managedPath || asset.sourcePath || null });
  }
  return entries;
}

export function isSafeProjectThemeArchivePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  return normalized.startsWith("themes/") && !normalized.split("/").includes("..") && !path.posix.isAbsolute(normalized);
}
