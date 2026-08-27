import { EMS_RESOLVED_PRESENTATION_SCHEMA_ID } from "./schemas/ems-resolved-presentation.types.mjs";

export const RESOLVED_LAYOUT_ALGORITHM_VERSION = 1;
export const DEFAULT_RESOLVED_OUTPUT_SIZE = Object.freeze({ width: 1920, height: 1080 });

export function normalizeResolvedOutputSize(value, fallback = DEFAULT_RESOLVED_OUTPUT_SIZE) {
  const width = Math.round(Number(value?.width));
  const height = Math.round(Number(value?.height));
  return {
    width: Number.isFinite(width) && width > 0 ? width : fallback.width,
    height: Number.isFinite(height) && height > 0 ? height : fallback.height,
  };
}

export function stableSerialize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
    .join(",")}}`;
}

export function stableValueHash(value) {
  const text = stableSerialize(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function resolvedLayoutKey({
  content,
  target,
  resolvedTheme,
  typography,
  presentation,
  algorithmVersion = RESOLVED_LAYOUT_ALGORITHM_VERSION,
} = {}) {
  return stableValueHash({
    algorithmVersion,
    content,
    target: {
      outputRole: target?.outputRole || "audience",
      outputSize: normalizeResolvedOutputSize(target?.outputSize),
    },
    resolvedTheme: resolvedTheme || null,
    typography: typography || null,
    presentation: presentation || null,
  });
}

export function resolvedNavigation(slides, requestedSlideId = null) {
  const list = Array.isArray(slides) ? slides : [];
  let index = requestedSlideId
    ? list.findIndex((slide) => slide?.slideId === requestedSlideId)
    : -1;
  if (index < 0 && list.length > 0) index = 0;
  return {
    slideCount: list.length,
    activeSlideId: list[index]?.slideId || null,
    previousSlideId: index > 0 ? list[index - 1]?.slideId || null : null,
    nextSlideId: index >= 0 && index < list.length - 1 ? list[index + 1]?.slideId || null : null,
  };
}

export function createResolvedPresentation({
  contentKind,
  source,
  slides,
  target,
  resolvedTheme,
  layoutKey,
  activeSlideId,
  warnings = [],
} = {}) {
  const normalizedSlides = (Array.isArray(slides) ? slides : []).map((slide, index) => ({
    ...slide,
    index,
  }));
  const navigation = resolvedNavigation(normalizedSlides, activeSlideId);
  const activeSlide =
    normalizedSlides.find((slide) => slide.slideId === navigation.activeSlideId) || null;
  return {
    schema: EMS_RESOLVED_PRESENTATION_SCHEMA_ID,
    contentKind,
    target: {
      outputRole: target?.outputRole || "audience",
      outputSize: normalizeResolvedOutputSize(target?.outputSize),
    },
    source: {
      id: String(source?.id || ""),
      revision: String(source?.revision || stableValueHash(source || {})),
      ...(source?.arrangementId ? { arrangementId: source.arrangementId } : {}),
    },
    themeId: resolvedTheme?.themeId || null,
    themeRevision: resolvedTheme?.themeRevision || null,
    resolvedThemeVersion: resolvedTheme?.resolvedThemeVersion ?? null,
    resolvedTheme: resolvedTheme || null,
    slides: normalizedSlides,
    activeSlide,
    navigation,
    layoutKey: String(layoutKey || stableValueHash({ contentKind, source, target })),
    warnings: [...warnings],
  };
}
