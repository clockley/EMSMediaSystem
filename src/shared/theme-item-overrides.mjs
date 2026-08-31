import { mergeThemeValues, normalizeProfile, normalizeTheme } from "./theme-normalize.mjs";

export const THEME_ITEM_SCHEMA = "ems.item-theme.v1";

const copy = value => value == null ? value : structuredClone(value);

export function normalizeItemTheme(value) {
  if (!value || typeof value !== "object") return null;
  const theme = value.snapshot && typeof value.snapshot === "object"
    ? normalizeTheme(value.snapshot)
    : null;
  const themeId = typeof value.themeId === "string" && value.themeId
    ? value.themeId
    : theme?.id || null;
  if (!themeId && !theme) return null;
  const overrides = {};
  for (const role of ["audience", "lowerThird"]) {
    if (value.overrides?.[role] && typeof value.overrides[role] === "object") {
      overrides[role] = normalizeProfile(value.overrides[role]);
    }
  }
  return {
    schema: THEME_ITEM_SCHEMA,
    themeId,
    snapshot: theme,
    overrides,
    editorMaterialized: value.editorMaterialized === true,
  };
}

export function setItemThemeRole(itemTheme, { theme, outputRole = "audience", profile } = {}) {
  if (!theme || typeof theme !== "object") throw new TypeError("A theme is required");
  if (!["audience", "lowerThird"].includes(outputRole)) throw new TypeError("Unsupported output role");
  const normalizedTheme = normalizeTheme(theme);
  const current = normalizeItemTheme(itemTheme) || {
    schema: THEME_ITEM_SCHEMA,
    themeId: normalizedTheme.id,
    snapshot: normalizedTheme,
    overrides: {},
  };
  const sameTheme = current.themeId === normalizedTheme.id;
  const overrides = sameTheme ? copy(current.overrides) : {};
  if (profile && typeof profile === "object") overrides[outputRole] = normalizeProfile(profile);
  return normalizeItemTheme({
    schema: THEME_ITEM_SCHEMA,
    themeId: normalizedTheme.id,
    snapshot: normalizedTheme,
    overrides,
    editorMaterialized: sameTheme && current.editorMaterialized === true,
  });
}

export function itemThemeForRole(item, outputRole = "audience") {
  const selected = normalizeItemTheme(item?.itemTheme);
  return {
    theme: selected?.snapshot || null,
    itemOverrides: selected?.overrides?.[outputRole] || undefined,
    themeId: selected?.themeId || null,
  };
}

export function mergeItemThemeOverride(existing, override) {
  return normalizeProfile(mergeThemeValues(existing || {}, override || {}));
}
