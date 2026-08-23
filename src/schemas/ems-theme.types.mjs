/** @typedef {'song'|'scripture'|'text'} ThemeContentKind */
/** @typedef {'audience'|'lowerThird'} ThemeOutputRole */
/**
 * @typedef {Object} EmsThemeV1
 * @property {'ems.theme.v1'} schema
 * @property {string} id
 * @property {string} name
 * @property {string|null} [baseThemeId]
 * @property {Record<string, unknown>} [tokens]
 * @property {Record<ThemeContentKind, Partial<Record<ThemeOutputRole, Record<string, unknown>>>>} profiles
 * @property {Array<Record<string, unknown>>} [assets]
 */
/** @typedef {Readonly<Record<string, any>>} ResolvedTheme */
export const THEME_SCHEMA = "ems.theme.v1";
export const THEME_CONTENT_KINDS = Object.freeze(["song", "scripture", "text"]);
export const THEME_OUTPUT_ROLES = Object.freeze(["audience", "lowerThird"]);
