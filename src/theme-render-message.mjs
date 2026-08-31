import { resolveThemeForTarget } from "./theme-resolver.mjs";
import { legacyStyleToThemeOverrides } from "./theme-legacy-adapter.mjs";
import { resolveScriptureSlides } from "./scripture-slides.mjs";
import { resolveSongSlides } from "./song-slides.mjs";

export function createThemeRenderMessage({ content, contentKind, outputRole = "audience", outputSize, theme, projectOverrides, itemOverrides, objectOverrides, liveOverrides, getThemeById, legacyStyle } = {}) {
  const compatibility = legacyStyle ? legacyStyleToThemeOverrides(legacyStyle, outputRole) : undefined;
  const resolvedTheme = resolveThemeForTarget({ theme, contentKind, outputRole, outputSize, projectOverrides, itemOverrides: itemOverrides || compatibility, objectOverrides, liveOverrides, getThemeById });
  return Object.freeze({ type: "ems-themed-render", content, target: Object.freeze({ contentKind, outputRole, outputSize: resolvedTheme.outputSize }), themeId: resolvedTheme.themeId, themeRevision: resolvedTheme.themeRevision, resolvedThemeVersion: resolvedTheme.resolvedThemeVersion, resolvedTheme });
}

function resolvedBackground(resolvedTheme = {}, fallback = {}) {
  const background = resolvedTheme?.canvas?.background || {};
  return {
    backgroundColor: background.color || fallback.backgroundColor || "#000000",
    backgroundPath: background.path || fallback.backgroundPath || "",
    backgroundImage: background.type === "image"
      ? background.url || background.path || fallback.backgroundImage || ""
      : fallback.backgroundImage || "",
    backgroundVideo: background.type === "video"
      ? background.url || background.path || fallback.backgroundVideo || ""
      : fallback.backgroundVideo || "",
  };
}

export function resolvedAudienceBackgroundFields(message = {}, resolvedTheme = {}) {
  const background = resolvedTheme.canvas?.background || {};
  const themeMedia = background.assetUrl || background.url || background.path || "";
  const messageMedia = message.backgroundImage || message.backgroundVideo || "";
  const previousBackground = message.resolvedTheme?.canvas?.background || {};
  const previousThemeMedia =
    previousBackground.assetUrl || previousBackground.url || previousBackground.path || "";
  const hasItemMediaOverride = Boolean(messageMedia) && messageMedia !== previousThemeMedia;
  if (hasItemMediaOverride) {
    return {
      backgroundColor: message.backgroundColor || background.color || "#000000",
      backgroundPath: message.backgroundPath || messageMedia,
      backgroundImage: message.backgroundImage || "",
      backgroundVideo: message.backgroundVideo || "",
    };
  }
  return {
    backgroundColor: background.color || message.backgroundColor || "#000000",
    backgroundPath: themeMedia,
    backgroundImage: background.type === "image" ? themeMedia : "",
    backgroundVideo: background.type === "video" ? themeMedia : "",
  };
}

export function resolvedFontFamilyFields(message = {}, resolvedTheme = {}, { lowerThird = false } = {}) {
  const localFontFamily = lowerThird
    ? message.lowerThirdFontFamily || message.fontFamily
    : message.fontFamily;
  const hasLocalOverride = lowerThird
    ? message.lowerThirdFontFamilyOverride === true || message.fontFamilyOverride === true
    : message.fontFamilyOverride === true;
  const fontFamily = hasLocalOverride && localFontFamily
    ? localFontFamily
    : resolvedTheme.typography?.fontFamily || localFontFamily || "'CMG Sans'";
  return lowerThird
    ? { fontFamily, lowerThirdFontFamily: fontFamily }
    : { fontFamily };
}

function resolvedDisplayText(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return String(
    value.shortText ||
      value.text ||
      value.name ||
      value.abbreviation ||
      value.version ||
      "",
  );
}

export function messageFromResolvedPresentation(
  presentation,
  { source = {}, style = {}, resolvedTheme = presentation?.resolvedTheme } = {},
) {
  const unit = presentation?.activeSlide || null;
  const typography = resolvedTheme?.typography || style;
  const outputRole = presentation?.target?.outputRole || "audience";
  const lowerThird = outputRole === "lowerThird" || outputRole === "lower-third";
  const localFontFamily = lowerThird
    ? style.lowerThirdFontFamily || style.fontFamily
    : style.fontFamily;
  const localFontOverride = lowerThird
    ? style.lowerThirdFontFamilyOverride === true || style.fontFamilyOverride === true
    : style.fontFamilyOverride === true;
  const message = {
    type: "ems-resolved-slide",
    schema: presentation?.schema,
    contentKind: presentation?.contentKind,
    resolvedPresentation: presentation,
    resolvedUnit: unit,
    slideId: unit?.slideId || null,
    layoutKey: presentation?.layoutKey || "",
    target: presentation?.target,
    outputRole,
    blocks: unit?.blocks || [],
    text: unit?.bodyText || "",
    bodyText: unit?.bodyText || "",
    fullBodyText: unit?.fullBodyText || unit?.bodyText || "",
    reference: resolvedDisplayText(unit?.referenceText),
    referenceText: resolvedDisplayText(unit?.referenceText),
    attributionText: resolvedDisplayText(unit?.attributionText),
    copyrightText: resolvedDisplayText(unit?.copyrightText),
    fontFamily:
      (localFontOverride ? localFontFamily : "") ||
      typography.fontFamily ||
      localFontFamily ||
      "'CMG Sans'",
    fontFamilyOverride: localFontOverride,
    fontSize:
      unit?.layout?.resolvedFontSize ||
      typography.fontSize ||
      style.fontSize ||
      66,
    preferredFontSize: typography.fontSize || style.fontSize || 66,
    minFontSize: typography.minFontSize || style.minFontSize || 38,
    fontWeight: typography.fontWeight || style.fontWeight || 700,
    fontStyle: typography.fontStyle || style.fontStyle || "normal",
    lineHeight: typography.lineHeight || style.lineHeight || 1.25,
    color: typography.color || typography.fontColor || style.color || "#ffffff",
    autosizeMode: "none",
    autoSplit: false,
    resolvedLayout: unit?.layout || null,
    resolvedTheme,
    themeId: presentation?.themeId || resolvedTheme?.themeId || null,
    themeRevision: presentation?.themeRevision || resolvedTheme?.themeRevision || null,
    look: lowerThird ? "lower-third" : "fullscreen",
    position: {
      vertical: resolvedTheme?.typography?.verticalAlign || "center",
      horizontal: resolvedTheme?.typography?.align || "center",
    },
    textBoxPosition: resolvedTheme?.textFrame
      ? {
          left: `${resolvedTheme.textFrame.x * 100}%`,
          top: `${resolvedTheme.textFrame.y * 100}%`,
          width: `${resolvedTheme.textFrame.width * 100}%`,
          height: `${resolvedTheme.textFrame.height * 100}%`,
        }
      : style.textBoxPosition || null,
    ...resolvedBackground(resolvedTheme, style),
  };
  if (Array.isArray(unit?.slideObjects)) message.slideObjects = unit.slideObjects;
  if (presentation?.contentKind === "scripture") {
    message.version = source.version || "";
    message.book = source.book || "";
    message.chapter = source.chapter || 0;
    message.verse = unit?.verseNumbers?.[0] || source.verse || 0;
    message.verseEnd = unit?.verseNumbers?.at(-1) || source.verseEnd || 0;
  }
  return message;
}

function resolvedRenderResult(contentKind, source, presentation, style, resolvedTheme) {
  return {
    type: "ems-resolved-render",
    contentKind,
    source,
    target: presentation.target,
    resolvedTheme,
    presentation,
    activeUnit: presentation.activeSlide,
    message: messageFromResolvedPresentation(presentation, {
      source,
      style,
      resolvedTheme,
    }),
  };
}

export function renderSongForTarget(songAst, targetContext = {}, resolvedTheme = null) {
  const style = targetContext.render || targetContext.style || {};
  const presentation = resolveSongSlides(songAst, {
    ...targetContext,
    render: style,
    typography: resolvedTheme?.typography || style,
    resolvedTheme,
  });
  return resolvedRenderResult("song", songAst, presentation, style, resolvedTheme);
}

export function renderTextForTarget(textAst, targetContext = {}, resolvedTheme = null) {
  return {
    type: "text",
    content: textAst,
    target: targetContext,
    resolvedTheme,
  };
}

export function renderScriptureForTarget(
  scriptureEntry,
  targetContext = {},
  resolvedTheme = null,
) {
  const style = targetContext.style || scriptureEntry || {};
  const presentation = resolveScriptureSlides(scriptureEntry, {
    ...targetContext,
    typography: targetContext.typography || resolvedTheme?.typography || style,
    resolvedTheme,
  });
  return resolvedRenderResult(
    "scripture",
    scriptureEntry,
    presentation,
    style,
    resolvedTheme,
  );
}
