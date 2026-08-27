import {
  createResolvedPresentation,
  resolvedLayoutKey,
  stableValueHash,
} from "./resolved-presentation.mjs";
import { resolveSongArrangement } from "./song-arrangement.mjs";
import { chunkSongSection } from "./song-chunking.mjs";
import {
  domTextMeasurement,
  themeTextSafeMargins,
  waitForTextFonts,
} from "./text-measure.mjs";

export const SONG_SLIDE_RESOLVER_VERSION = 1;
const resolvedSongCache = new Map();
const MAX_CACHE_ENTRIES = 100;

function clone(value) {
  if (value == null) return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function cacheSet(key, value) {
  if (resolvedSongCache.has(key)) resolvedSongCache.delete(key);
  resolvedSongCache.set(key, clone(value));
  while (resolvedSongCache.size > MAX_CACHE_ENTRIES) {
    resolvedSongCache.delete(resolvedSongCache.keys().next().value);
  }
}

export function clearResolvedSongCache() {
  resolvedSongCache.clear();
}

export function resolvedSongCacheStats() {
  return { entries: resolvedSongCache.size, maxEntries: MAX_CACHE_ENTRIES };
}

function selectedActiveSlideId(slides, options = {}) {
  if (options.activeSlideId && slides.some((slide) => slide.slideId === options.activeSlideId)) {
    return options.activeSlideId;
  }
  const sequenceEntryId =
    options.sequenceEntryId ||
    options.currentSequenceEntryId ||
    options.render?.currentSequenceEntryId;
  if (sequenceEntryId) {
    const slide = slides.find((entry) => entry.sequenceEntryId === sequenceEntryId);
    if (slide) return slide.slideId;
  }
  const sectionId =
    options.sectionId ||
    options.currentSectionId ||
    options.render?.currentSectionId;
  if (sectionId) {
    const slide = slides.find((entry) => entry.sectionId === sectionId);
    if (slide) return slide.slideId;
  }
  return slides[0]?.slideId || null;
}

function copyrightForSlide(song, options, index) {
  const placement = options.copyrightPlacement || options.render?.copyrightPlacement || "firstSlide";
  if (placement === "none") return "";
  if (placement === "firstSlide" && index !== 0) return "";
  if (typeof options.copyrightText === "string") return options.copyrightText;
  const metadata = song?.metadata || {};
  const parts = [];
  if (Array.isArray(metadata.authors) && metadata.authors.length > 0) {
    parts.push(metadata.authors.join(", "));
  }
  if (metadata.copyright) parts.push(String(metadata.copyright));
  if (metadata.ccliNumber) parts.push(`CCLI #${metadata.ccliNumber}`);
  if (metadata.oneLicense) parts.push(`OneLicense #${metadata.oneLicense}`);
  return parts.join("\n");
}

export function resolveSongSlides(song, options = {}) {
  if (
    !options.measure &&
    !options.measureAt &&
    options.documentRef !== null &&
    (options.documentRef || globalThis.document)?.body &&
    (options.documentRef || globalThis.document)?.fonts?.status === "loaded"
  ) {
    const documentRef = options.documentRef || globalThis.document;
    options = {
      ...options,
      measurementMode: "dom",
      measureAt: (text, fontSize, bounds, style) =>
        domTextMeasurement(text, fontSize, bounds, style, { documentRef }),
    };
  }
  const arrangement = resolveSongArrangement(song, {
    arrangementId: options.arrangementId,
    sequence: options.sequenceEntries,
  });
  const target = {
    outputRole: options.outputRole || options.target?.outputRole || "audience",
    outputSize: options.outputSize || options.target?.outputSize,
  };
  const typographySource =
    options.typography ||
    options.resolvedTheme?.textContainer?.typography ||
    options.render ||
    song?.defaultRender ||
    {};
  const typography = {
    fontFamily: typographySource.fontFamily,
    fontWeight: typographySource.fontWeight,
    fontStyle: typographySource.fontStyle,
    fontSize: typographySource.fontSize,
    minFontSize: typographySource.minFontSize,
    lineHeight: typographySource.lineHeight,
    letterSpacing: typographySource.letterSpacing,
    autosizeMode: typographySource.autosizeMode,
    direction: typographySource.direction,
    maxLines: typographySource.maxLines,
  };
  const sourceRevision = options.sourceRevision || stableValueHash({
    resolverVersion: SONG_SLIDE_RESOLVER_VERSION,
    song,
    arrangementId: arrangement.arrangementId,
    sequenceEntries: options.sequenceEntries || null,
  });
  const layoutKey = resolvedLayoutKey({
    content: { sourceRevision, arrangementId: arrangement.arrangementId },
    target,
    resolvedTheme: options.resolvedTheme,
    typography,
    presentation: {
      defaultChunking: song?.presentation?.defaultChunking,
      manualBreaks: song?.presentation?.manualBreaks,
      overrides: options.chunking,
      safeMargins: options.safeMargins || null,
      extraHeight: options.extraHeight ?? null,
      optionManualBreaks: options.manualBreaks || null,
      copyrightPlacement: options.copyrightPlacement || null,
      copyrightText: options.copyrightText || null,
      sequenceEntries: options.sequenceEntries || null,
      measurementMode:
        options.measurementMode ||
        options.measurementKey ||
        (options.measureAt ? "injected" : options.measure ? "custom" : "heuristic"),
      resolverVersion: SONG_SLIDE_RESOLVER_VERSION,
    },
  });
  const cached = options.cache !== false ? resolvedSongCache.get(layoutKey) : null;
  let slides;
  if (cached) {
    slides = clone(cached);
  } else {
    slides = [];
    for (const occurrence of arrangement.enabledEntries) {
      const chunks = chunkSongSection(song, occurrence.section, {
        ...options,
        typography,
        outputSize: target.outputSize,
        safeMargins:
          options.safeMargins ||
          themeTextSafeMargins(
            options.resolvedTheme,
            options.outputSize || options.target?.outputSize,
          ),
      });
      chunks.forEach((chunk, chunkIndex) => {
        slides.push({
          slideId: `${occurrence.sequenceEntryId}:${chunkIndex}`,
          sequenceEntryId: occurrence.sequenceEntryId,
          sectionId: occurrence.sectionId,
          sequenceIndex: occurrence.sequenceIndex,
          occurrenceIndex: occurrence.occurrenceIndex,
          chunkIndex,
          sectionLabel: occurrence.section?.label || "",
          sectionKind: occurrence.section?.kind || "verse",
          blocks: clone(chunk.blocks),
          bodyText: chunk.bodyText,
          referenceText: "",
          attributionText: "",
          manualBreak: chunk.manualBreak === true,
          sourceBlockStart: chunk.sourceBlockStart,
          sourceBlockEnd: chunk.sourceBlockEnd,
          layout: chunk.layout,
          ...(Array.isArray(occurrence.section?.slideObjects)
            ? { slideObjects: clone(occurrence.section.slideObjects) }
            : {}),
        });
      });
    }
    slides = slides.map((slide, index) => ({
      ...slide,
      copyrightText: copyrightForSlide(song, options, index),
    }));
    if (options.cache !== false) cacheSet(layoutKey, slides);
  }
  const activeSlideId = selectedActiveSlideId(slides, options);
  return createResolvedPresentation({
    contentKind: "song",
    source: {
      id: String(song?.id || "song"),
      revision: sourceRevision,
      arrangementId: arrangement.arrangementId,
    },
    slides,
    target,
    resolvedTheme: options.resolvedTheme,
    layoutKey,
    activeSlideId,
    warnings: slides.some((slide) => slide.layout?.overflow)
      ? ["One or more song slides overflow at minimum font size"]
      : [],
  });
}

export async function resolveSongSlidesAfterFonts(song, options = {}) {
  const typography =
    options.typography ||
    options.resolvedTheme?.textContainer?.typography ||
    options.render ||
    song?.defaultRender ||
    {};
  await waitForTextFonts([typography.fontFamily], {
    documentRef: options.documentRef || globalThis.document,
    sample: song?.title || "EMS",
    fontSize: typography.fontSize,
  });
  return resolveSongSlides(song, {
    ...options,
    measurementMode: "dom",
    measureAt:
      options.measureAt ||
      ((text, fontSize, bounds, style) =>
        domTextMeasurement(text, fontSize, bounds, style, {
          documentRef: options.documentRef || globalThis.document,
        })),
  });
}
