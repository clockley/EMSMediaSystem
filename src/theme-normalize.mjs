import { THEME_CONTENT_KINDS, THEME_OUTPUT_ROLES, THEME_SCHEMA } from "./schemas/ems-theme.types.mjs";

const PLAIN_OBJECT = Object.getPrototypeOf({});
export const isPlainObject = value => value !== null && typeof value === "object" && Object.getPrototypeOf(value) === PLAIN_OBJECT;
export const cloneThemeValue = value => Array.isArray(value)
  ? value.map(cloneThemeValue)
  : isPlainObject(value)
    ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneThemeValue(child)]))
    : value;

export function mergeThemeValues(base, override) {
  if (override === undefined) return cloneThemeValue(base);
  if (override === null || Array.isArray(override) || !isPlainObject(override)) return cloneThemeValue(override);
  const result = isPlainObject(base) ? cloneThemeValue(base) : {};
  for (const [key, value] of Object.entries(override)) result[key] = mergeThemeValues(result[key], value);
  return result;
}

const clamp = (value, min, max, fallback) => Number.isFinite(Number(value))
  ? Math.min(max, Math.max(min, Number(value))) : fallback;

export function normalizeProfile(profile = {}) {
  const result = cloneThemeValue(isPlainObject(profile) ? profile : {});
  const typography = result.typography ||= {};
  typography.fontSize = clamp(typography.fontSize, 8, 400, 64);
  typography.minFontSize = clamp(typography.minFontSize, 8, typography.fontSize, Math.min(28, typography.fontSize));
  typography.fontWeight = clamp(typography.fontWeight, 100, 900, 700);
  typography.lineHeight = clamp(typography.lineHeight, 0.5, 3, 1.18);
  typography.letterSpacing = clamp(typography.letterSpacing, -10, 40, 0);
  typography.maxLines = Math.round(clamp(typography.maxLines, 1, 100, 8));
  result.transition ||= {};
  result.transition.durationMs = Math.round(clamp(result.transition.durationMs, 0, 5000, 350));
  for (const group of [result.canvas?.safeMargins, result.textFrame]) {
    if (!isPlainObject(group)) continue;
    for (const key of ["top", "right", "bottom", "left", "x", "y", "width", "height"]) {
      if (key in group) group[key] = clamp(group[key], 0, 1, 0);
    }
  }
  return result;
}

export function validateTheme(theme) {
  const errors = [];
  if (!isPlainObject(theme)) return { valid: false, errors: ["Theme must be an object"] };
  if (theme.schema !== THEME_SCHEMA) errors.push(`schema must be ${THEME_SCHEMA}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(theme.id || "")) errors.push("id is invalid");
  if (typeof theme.name !== "string" || !theme.name.trim()) errors.push("name is required");
  if (!isPlainObject(theme.profiles)) errors.push("profiles must be an object");
  if (theme.assets !== undefined && !Array.isArray(theme.assets)) errors.push("assets must be an array");
  const assetIds = new Set();
  for (const asset of Array.isArray(theme.assets) ? theme.assets : []) {
    if (!isPlainObject(asset) || typeof asset.id !== "string" || !asset.id) errors.push("each asset needs an id");
    else if (assetIds.has(asset.id)) errors.push(`duplicate asset id: ${asset.id}`);
    else assetIds.add(asset.id);
  }
  return { valid: errors.length === 0, errors };
}

export function normalizeTheme(theme, { strict = true } = {}) {
  const validation = validateTheme(theme);
  if (strict && !validation.valid) throw new TypeError(`Invalid EMS theme: ${validation.errors.join("; ")}`);
  const result = cloneThemeValue(theme || {});
  result.schema = THEME_SCHEMA;
  result.id = String(result.id || "theme_unnamed");
  result.name = String(result.name || "Unnamed Theme");
  result.baseThemeId = typeof result.baseThemeId === "string" && result.baseThemeId ? result.baseThemeId : null;
  result.tokens = isPlainObject(result.tokens) ? result.tokens : {};
  result.assets = Array.isArray(result.assets) ? result.assets : [];
  result.profiles = isPlainObject(result.profiles) ? result.profiles : {};
  for (const kind of THEME_CONTENT_KINDS) {
    result.profiles[kind] = isPlainObject(result.profiles[kind]) ? result.profiles[kind] : {};
    for (const role of THEME_OUTPUT_ROLES) {
      result.profiles[kind][role] = isPlainObject(result.profiles[kind][role]) ? result.profiles[kind][role] : {};
    }
  }
  return result;
}

export function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
