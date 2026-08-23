import { resolveThemeForTarget } from "./theme-resolver.mjs";
import { legacyStyleToThemeOverrides } from "./theme-legacy-adapter.mjs";

export function createThemeRenderMessage({ content, contentKind, outputRole = "audience", outputSize, theme, projectOverrides, itemOverrides, objectOverrides, liveOverrides, getThemeById, legacyStyle } = {}) {
  const compatibility = legacyStyle ? legacyStyleToThemeOverrides(legacyStyle, outputRole) : undefined;
  const resolvedTheme = resolveThemeForTarget({ theme, contentKind, outputRole, outputSize, projectOverrides, itemOverrides: itemOverrides || compatibility, objectOverrides, liveOverrides, getThemeById });
  return Object.freeze({ type: "ems-themed-render", content, target: Object.freeze({ contentKind, outputRole, outputSize: resolvedTheme.outputSize }), themeId: resolvedTheme.themeId, themeRevision: resolvedTheme.themeRevision, resolvedThemeVersion: resolvedTheme.resolvedThemeVersion, resolvedTheme });
}

export const renderSongForTarget = (songAst, targetContext, resolvedTheme) => ({ type: "song", content: songAst, target: targetContext, resolvedTheme });
export const renderTextForTarget = (textAst, targetContext, resolvedTheme) => ({ type: "text", content: textAst, target: targetContext, resolvedTheme });
export const renderScriptureForTarget = (scriptureEntry, targetContext, resolvedTheme) => ({ type: "scripture", content: scriptureEntry, target: targetContext, resolvedTheme });
