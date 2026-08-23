import { deepFreeze, mergeThemeValues, normalizeProfile, normalizeTheme } from "./theme-normalize.mjs";
import { THEME_CONTENT_KINDS, THEME_OUTPUT_ROLES } from "./schemas/ems-theme.types.mjs";

export const RESOLVED_THEME_VERSION = 1;
export const EMS_SAFE_DEFAULT_THEME = deepFreeze(normalizeTheme({
  schema: "ems.theme.v1", id: "ems_safe_default", name: "EMS Safe Default", tokens: {
    fontFamily: "'CMG Sans'", textColor: "#ffffff", accentColor: "#3584e4", surfaceColor: "#000000", lineHeight: 1.18,
  }, profiles: Object.fromEntries(THEME_CONTENT_KINDS.map(kind => [kind, {
    audience: { typography: { fontSize: 64, minFontSize: 28, fontWeight: 700, fontStyle: "normal", align: "center", verticalAlign: "center", autosizeMode: "fit", maxLines: 8 }, canvas: { background: { type: "color", color: "#000000", assetId: null, fit: "cover", position: "center" }, safeMargins: { top: .06, right: .06, bottom: .06, left: .06 } }, textFrame: { x: .08, y: .08, width: .84, height: .84, padding: { top: 0, right: 0, bottom: 0, left: 0 } }, backdrop: { enabled: false, background: { type: "color", color: "#101010", assetId: null }, opacity: 1, cornerRadius: 8, paddingPx: { x: 36, y: 14 }, fixedHeightLines: null }, reference: { visible: true, fontScale: .4, placement: "below" }, attribution: { visible: true, fontScale: .24, placement: "bottom" }, copyright: { visible: true, placement: "bottom" }, transition: { type: "fade", durationMs: 350 } },
    lowerThird: { typography: { fontSize: 52, minFontSize: 20, fontWeight: 700, align: "left", verticalAlign: "center", autosizeMode: "fit", maxLines: 2 }, canvas: { background: { type: "color", color: "#00ff00", assetId: null }, safeMargins: { top: .06, right: .04, bottom: .08, left: .04 } }, textFrame: { x: .04, y: .7, width: .92, height: .22, padding: { top: 0, right: 0, bottom: 0, left: 0 } }, backdrop: { enabled: true, background: { type: "color", color: "#101010", assetId: null }, opacity: 1, cornerRadius: 8, paddingPx: { x: 36, y: 14 }, fixedHeightLines: 2 }, key: { mode: "chroma", chromaColor: "#00ff00" }, placement: { horizontal: "center", vertical: "bottom", bottomMargin: .08, width: .92 }, cueLayout: { maxLines: 2, allowSingleLineFinalCue: true, avoidWordBreaks: true }, reference: { visible: true, fontScale: .4, placement: "below" }, attribution: { visible: true, fontScale: .24, placement: "bottom" }, copyright: { visible: true, placement: "bottom" }, transition: { type: "fade", durationMs: 350 } },
  }])), assets: [],
}));

const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
// Browser-safe deterministic revision. Asset integrity continues to use SHA-256;
// this identifier only invalidates renderer caches and aids diagnostics.
export function themeRevision(theme) {
  const input = JSON.stringify(stable(theme));
  let first = 2166136261; let second = 2246822519;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489917);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function themeChain(theme, getThemeById) {
  const chain = []; const seen = new Set(); let current = normalizeTheme(theme);
  while (current) {
    if (seen.has(current.id)) throw new Error(`Theme inheritance cycle detected at ${current.id}`);
    if (chain.length >= 8) throw new Error("Theme inheritance exceeds eight levels");
    seen.add(current.id); chain.unshift(current);
    if (!current.baseThemeId) break;
    const parent = getThemeById?.(current.baseThemeId);
    if (!parent) throw new Error(`Base theme not found: ${current.baseThemeId}`);
    current = normalizeTheme(parent);
  }
  return chain;
}

export function resolveThemeForTarget({ theme = EMS_SAFE_DEFAULT_THEME, contentKind, outputRole, outputSize = {}, projectOverrides, itemOverrides, objectOverrides, liveOverrides, getThemeById } = {}) {
  if (!THEME_CONTENT_KINDS.includes(contentKind)) throw new TypeError(`Unsupported content kind: ${contentKind}`);
  if (!THEME_OUTPUT_ROLES.includes(outputRole)) throw new TypeError(`Unsupported output role: ${outputRole}`);
  let profile = EMS_SAFE_DEFAULT_THEME.profiles[contentKind][outputRole];
  const chain = themeChain(theme, getThemeById);
  for (const entry of chain) {
    const tokens = { typography: { fontFamily: entry.tokens.fontFamily, color: entry.tokens.textColor, lineHeight: entry.tokens.lineHeight }, canvas: { background: { color: entry.tokens.surfaceColor } } };
    profile = mergeThemeValues(profile, tokens);
    profile = mergeThemeValues(profile, entry.profiles?.[contentKind]?.[outputRole]);
  }
  for (const override of [projectOverrides, itemOverrides, objectOverrides, liveOverrides]) profile = mergeThemeValues(profile, override);
  profile = normalizeProfile(profile);
  const selected = chain.at(-1) || EMS_SAFE_DEFAULT_THEME;
  return deepFreeze({ ...profile, themeId: selected.id, themeRevision: themeRevision(selected), resolvedThemeVersion: RESOLVED_THEME_VERSION, contentKind, outputRole, outputSize: { width: Math.max(1, Math.round(Number(outputSize.width) || 1920)), height: Math.max(1, Math.round(Number(outputSize.height) || 1080)) }, assets: selected.assets });
}
