/*
Copyright (C) 2024 Christian Lockley

Song file import (TXT, JSON, hymnal, future third-party formats) is handled
only by songs-rpc (Go). This module normalizes already-imported canonical AST
for rendering, projects, and the editor — it does not parse import files.
*/

import {
  DEFAULT_ITEM_SLIDE_TRANSITION,
  imageRegex,
  pathToMediaUrl,
  slideTransitionOverrideSnapshot,
} from "./app-media-utils.mjs";
import {
  SCRIPTURE_BODY_FONT_SIZE,
  SCRIPTURE_FONT_FAMILY,
  SCRIPTURE_FONT_WEIGHT,
  SCRIPTURE_LINE_HEIGHT,
  SCRIPTURE_LOOK_FULLSCREEN,
  SCRIPTURE_REFERENCE_FONT_SIZE,
  normalizeScriptureFontSize,
  scriptureReferencePresentationForBackground,
} from "./app-bible-scripture-render.mjs";
import { resolveSongSlides } from "./song-slides.mjs";
import { stableValueHash } from "./resolved-presentation.mjs";

export const songUriPrefix = "song://";

export function isSongPath(filePath) {
  return typeof filePath === "string" && filePath.startsWith(songUriPrefix);
}

export function songQueuePath(songId) {
  const safeId = String(songId || "").trim();
  return `${songUriPrefix}${encodeURIComponent(safeId)}`;
}

export function parseSongQueuePath(filePath) {
  if (!isSongPath(filePath)) return null;
  try {
    return decodeURIComponent(filePath.slice(songUriPrefix.length));
  } catch {
    return filePath.slice(songUriPrefix.length);
  }
}

export const DEFAULT_SONG_RENDER = Object.freeze({
  backgroundColor: "#000000",
  backgroundPath: "",
  color: "#ffffff",
  fontFamily: SCRIPTURE_FONT_FAMILY,
  fontSize: SCRIPTURE_BODY_FONT_SIZE,
  autosizeMode: "fit",
  minFontSize: 38,
  copyrightPlacement: "firstSlide",
  transition: DEFAULT_ITEM_SLIDE_TRANSITION,
});

export function songBlockText(block) {
  if (!block || typeof block !== "object") return "";
  if (block.type !== "lyricLine" || !Array.isArray(block.primary?.segments)) return "";
  return block.primary.segments.map((segment) => segment?.text || "").join("");
}

export function songSectionBlockTexts(section) {
  if (!section || !Array.isArray(section.blocks)) return [];
  return section.blocks.map(songBlockText);
}

export function normalizeToSongAST(song) {
  if (!song || typeof song !== "object") return null;

  const sourceSong = structuredClone(song);
  const id = song.id || "";
  const title = song.title || "Untitled Song";
  const songNumber = Number.isFinite(song.songNumber) && song.songNumber > 0 ? song.songNumber : undefined;
  const folderId = typeof song.folderId === "string" && song.folderId.trim() ? song.folderId.trim() : null;

  const authors = Array.isArray(song.metadata?.authors) ? song.metadata.authors : [];
  const copyright = song.metadata?.copyright || "";
  const ccliNumber = song.metadata?.ccliNumber || song.metadata?.ccli_number || "";
  const oneLicense = song.metadata?.oneLicense || song.metadata?.one_license || "";
  const meter = song.metadata?.meter || song.metadata?.hymnal?.meter || "";
  const rawHymnal =
    song.metadata?.hymnal && typeof song.metadata.hymnal === "object"
      ? song.metadata.hymnal
      : { name: null, number: null, display: null };
  const hymnal = { ...rawHymnal, ...(meter ? { meter } : {}) };

  const sections = (Array.isArray(song.sections) ? song.sections : []).map((sec, sectionIndex) => {
    const kind = (sec.kind || "verse").toLowerCase();
    const label = sec.label || "";
    const sectionId =
      sec.id ||
      `sec_${stableValueHash({ songId: id, title, sectionIndex, kind, label })}`;

    let blocks = [];
    if (Array.isArray(sec.blocks)) {
      blocks = sec.blocks.map((block, blockIndex) => {
        const explicitSegments = Array.isArray(block.primary?.segments)
          ? block.primary.segments
          : null;
        const fallbackText = block.primary?.text || "";
        const isSpacer =
          block.type === "spacer" ||
          (explicitSegments ? explicitSegments.length === 0 : fallbackText.trim() === "");
        const blockType = ["lyricLine", "spacer", "comment", "speaker"].includes(block.type)
          ? block.type
          : isSpacer
            ? "spacer"
            : "lyricLine";
        return {
          ...structuredClone(block),
          type: blockType,
          id:
            block.id ||
            `block_${stableValueHash({
              sectionId,
              blockIndex,
              type: blockType,
              primary: block.primary,
            })}`,
          primary: {
            ...(block.primary && typeof block.primary === "object" ? structuredClone(block.primary) : {}),
            lang: block.primary?.lang || "en",
            segments: blockType === "spacer"
              ? []
              : explicitSegments || [{ type: "text", text: fallbackText }]
          },
          translations: Array.isArray(block.translations) ? block.translations : [],
          annotations: Array.isArray(block.annotations) ? block.annotations : []
        };
      });
    }

    return {
      ...structuredClone(sec),
      id: sectionId,
      kind,
      ...(Number.isFinite(sec.number) && sec.number > 0 ? { number: sec.number } : {}),
      label,
      blocks,
      ...(Array.isArray(sec.slideObjects)
        ? { slideObjects: structuredClone(sec.slideObjects) }
        : {}),
      ...(Array.isArray(sec.slideTextObjects)
        ? { slideTextObjects: structuredClone(sec.slideTextObjects) }
        : {}),
    };
  });

  const playOrder = [];
  if (Array.isArray(song.playOrder)) {
    for (const item of song.playOrder) {
      const sectionId =
        typeof item === "string"
          ? item
          : typeof item?.sectionId === "string"
            ? item.sectionId
            : typeof item?.id === "string"
              ? item.id
              : "";
      if (sectionId) {
        playOrder.push({
          ...(typeof item?.id === "string" ? { id: item.id } : {}),
          sectionId,
          enabled: item?.enabled !== false,
        });
      }
    }
  } else if (Array.isArray(song.arrangements?.[0]?.sequence)) {
    for (const entry of song.arrangements[0].sequence) {
      const sectionId =
        typeof entry === "string"
          ? entry
          : typeof entry?.sectionId === "string"
            ? entry.sectionId
            : typeof entry?.id === "string"
              ? entry.id
              : "";
      if (sectionId) {
        playOrder.push({ sectionId, enabled: entry?.enabled !== false });
      }
    }
  } else {
    for (const sec of sections) {
      playOrder.push({ sectionId: sec.id });
    }
  }

  const defaultRender = song.defaultRender || undefined;

  return {
    ...sourceSong,
    schema: "ems.song.v1",
    id,
    title,
    songNumber,
    folderId,
    metadata: {
      ...(song.metadata && typeof song.metadata === "object"
        ? structuredClone(song.metadata)
        : {}),
      authors,
      copyright,
      ccliNumber,
      oneLicense,
      meter,
      hymnal
    },
    languages: song.languages || [
      { id: "en", name: "English", default: true }
    ],
    sections,
    playOrder,
    arrangements: Array.isArray(song.arrangements) ? structuredClone(song.arrangements) : [],
    presentation: song.presentation || {
      defaultChunking: {
        mode: "blocksPerSlide",
        maxBlocks: 4
      }
    },
    defaultRender
  };
}

/**
 * Build a flat search-text string from a canonical EMS song AST.
 *
 * Includes (per Section 8 of the EMS song plan): title, song number,
 * authors, hymnal number, CCLI number, OneLicense number, meter,
 * section labels, lyric text, and translation text.
 *
 * The returned string is whitespace-collapsed and safe to feed into
 * full-text search indexes (sqlite FTS5, lunr, etc.).
 *
 * @param {EmsSong|Object} song
 * @returns {string}
 */
export function songAstToSearchText(song) {
  if (!song || typeof song !== "object") return "";
  const parts = [];

  if (song.title) parts.push(String(song.title));
  if (Number.isFinite(song.songNumber) && song.songNumber > 0) {
    parts.push(`#${song.songNumber}`);
    parts.push(String(song.songNumber));
  }

  const metadata = song.metadata && typeof song.metadata === "object" ? song.metadata : {};
  if (Array.isArray(metadata.authors)) {
    for (const author of metadata.authors) {
      if (author) parts.push(String(author));
    }
  }
  if (metadata.copyright) parts.push(String(metadata.copyright));
  if (metadata.ccliNumber) parts.push(`CCLI ${metadata.ccliNumber}`);
  if (metadata.oneLicense) parts.push(`OneLicense ${metadata.oneLicense}`);
  if (metadata.meter) parts.push(String(metadata.meter));

  const hymnal = metadata.hymnal && typeof metadata.hymnal === "object" ? metadata.hymnal : null;
  if (hymnal) {
    if (hymnal.name) parts.push(String(hymnal.name));
    if (hymnal.number) parts.push(String(hymnal.number));
    if (hymnal.meter && hymnal.meter !== metadata.meter) parts.push(String(hymnal.meter));
    if (hymnal.display) parts.push(String(hymnal.display));
  }

  if (Array.isArray(metadata.tags)) {
    for (const tag of metadata.tags) {
      if (tag) parts.push(String(tag));
    }
  }

  const sections = Array.isArray(song.sections) ? song.sections : [];
  for (const section of sections) {
    if (section?.label) parts.push(String(section.label));
    const blocks = Array.isArray(section?.blocks) ? section.blocks : [];
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      if (block.type !== "lyricLine") continue;
      const primarySegs = Array.isArray(block.primary?.segments) ? block.primary.segments : [];
      const lineText = primarySegs.map((seg) => seg?.text || "").join("");
      if (lineText.trim()) parts.push(lineText);
      const translations = Array.isArray(block.translations) ? block.translations : [];
      for (const translation of translations) {
        const segs = Array.isArray(translation?.segments) ? translation.segments : [];
        const text = segs.map((seg) => seg?.text || "").join("");
        if (text.trim()) parts.push(text);
      }
    }
  }

  return parts
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function arrangementSequenceEntries(song, arrangementId = "arr_default") {
  if (song?.schema === "ems.song.v1") {
    const playOrder = Array.isArray(song.playOrder) ? song.playOrder : [];
    return playOrder
      .map((entry, idx) => {
        const sectionId =
          typeof entry === "string"
            ? entry
            : typeof entry?.sectionId === "string"
              ? entry.sectionId
              : typeof entry?.id === "string"
                ? entry.id
                : "";
        if (!sectionId) return null;
        return {
          id: typeof entry?.id === "string" ? entry.id : `play_${idx}`,
          sectionId,
          enabled: entry?.enabled !== false,
        };
      })
      .filter(Boolean);
  }
  const arrangement =
    song?.arrangements?.find((a) => a.id === arrangementId) ||
    song?.arrangements?.[0];
  if (!arrangement) return [];
  const raw = arrangement.sequence;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => {
      if (typeof entry === "string") {
        return { id: entry, sectionId: entry, enabled: true };
      }
      if (entry && typeof entry === "object") {
        return {
          id: entry.id || entry.sectionId,
          sectionId: entry.sectionId || entry.id,
          enabled: entry.enabled !== false,
        };
      }
      return null;
    })
    .filter(Boolean);
}

export function reconcileSongPlayOrder(playOrder, sections) {
  const sectionIds = (Array.isArray(sections) ? sections : [])
    .map((section) => section?.id)
    .filter(Boolean);
  const validIds = new Set(sectionIds);
  const represented = new Set();
  const reconciled = [];
  for (const [index, entry] of (Array.isArray(playOrder) ? playOrder : []).entries()) {
    const sectionId =
      typeof entry === "string"
        ? entry
        : typeof entry?.sectionId === "string"
          ? entry.sectionId
          : "";
    if (!validIds.has(sectionId)) continue;
    represented.add(sectionId);
    reconciled.push({
      id: typeof entry?.id === "string" && entry.id ? entry.id : `play_${index}`,
      sectionId,
      enabled: entry?.enabled !== false,
    });
  }
  for (const sectionId of sectionIds) {
    if (represented.has(sectionId)) continue;
    reconciled.push({
      id: `play_${sectionId}`,
      sectionId,
      enabled: true,
    });
  }
  return reconciled;
}

export function enabledSongSections(song, sequenceEntries = null) {
  const entries = sequenceEntries || arrangementSequenceEntries(song);
  const sections = Array.isArray(song?.sections) ? song.sections : [];
  const byId = new Map(sections.map((s) => [s.id, s]));
  return entries
    .filter((entry) => entry.enabled !== false)
    .map((entry) => byId.get(entry.sectionId))
    .filter(Boolean);
}

export function songSectionLyricsText(section) {
  if (!section) return "";
  return songSectionBlockTexts(section)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = value == null ? "" : String(value).trim();
    if (text) return text;
  }
  return "";
}

export function normalizeSongCopyrightText(value) {
  const text = value == null ? "" : String(value).trim().replace(/\s+/g, " ");
  if (!text) return "";
  const compact = text.replace(/[\s_-]+/g, "").toLowerCase();
  if (compact === "publicdomain") return "Public Domain";
  return text;
}

function songCopyrightMetadata(song, render = {}) {
  const metadata = song?.metadata && typeof song.metadata === "object"
    ? song.metadata
    : {};
  return {
    authors: Array.isArray(metadata.authors) ? metadata.authors : [],
    copyright: normalizeSongCopyrightText(firstNonEmptyString(render.copyright, metadata.copyright)),
    ccliNumber: firstNonEmptyString(
      render.ccliNumber,
      metadata.ccliNumber,
      metadata.ccli_number,
    ),
    oneLicense: firstNonEmptyString(
      render.oneLicense,
      metadata.oneLicense,
      metadata.one_license,
    ),
  };
}

export function songCopyrightAttribution(metadata = {}) {
  if (!metadata) return "";
  const parts = [];
  if (metadata.authors && metadata.authors.length > 0) {
    parts.push(metadata.authors.join(", "));
  }
  const copyright = normalizeSongCopyrightText(metadata.copyright);
  if (copyright) {
    parts.push(copyright);
  }
  if (metadata.ccliNumber) {
    parts.push(`CCLI #${metadata.ccliNumber}`);
  }
  if (metadata.oneLicense) {
    parts.push(`OneLicense #${metadata.oneLicense}`);
  }
  return parts.join("\n").trim();
}

function definedRenderValues(value = {}) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

export function mergeSongRenderState(base = {}, overrides = {}) {
  return {
    ...DEFAULT_SONG_RENDER,
    ...definedRenderValues(base),
    ...definedRenderValues(overrides),
  };
}

export function songDefaultRenderFromRender(render = {}) {
  const style = mergeSongRenderState({}, render);
  return {
    themeId: "song_default",
    background: {
      mode: style.backgroundPath ? "custom" : "color",
      color: style.backgroundColor || DEFAULT_SONG_RENDER.backgroundColor,
      path: style.backgroundPath || "",
    },
    textColor: style.color || DEFAULT_SONG_RENDER.color,
    fontFamily: style.fontFamily || DEFAULT_SONG_RENDER.fontFamily,
    fontSize: Number.isFinite(style.fontSize) ? style.fontSize : DEFAULT_SONG_RENDER.fontSize,
    autosizeMode: style.autosizeMode || DEFAULT_SONG_RENDER.autosizeMode,
    minFontSize: Number.isFinite(style.minFontSize)
      ? style.minFontSize
      : DEFAULT_SONG_RENDER.minFontSize,
    copyrightPlacement: style.copyrightPlacement || DEFAULT_SONG_RENDER.copyrightPlacement,
    textBoxPosition: style.textBoxPosition || null,
  };
}

export function songRenderStateFromDefaultRender(defaultRender = {}) {
  if (!defaultRender || typeof defaultRender !== "object") {
    return mergeSongRenderState();
  }
  const fontSize = Number(defaultRender.fontSize);
  const minFontSize = Number(defaultRender.minFontSize);
  return mergeSongRenderState(DEFAULT_SONG_RENDER, {
    backgroundColor: defaultRender.background?.color || defaultRender.backgroundColor,
    backgroundPath: defaultRender.background?.path || defaultRender.backgroundPath || "",
    color: defaultRender.textColor || defaultRender.color,
    fontFamily: defaultRender.fontFamily,
    fontSize: Number.isFinite(fontSize) && fontSize > 0 ? fontSize : undefined,
    autosizeMode: defaultRender.autosizeMode,
    minFontSize: Number.isFinite(minFontSize) && minFontSize > 0 ? minFontSize : undefined,
    copyrightPlacement: defaultRender.copyrightPlacement,
    textBoxPosition: defaultRender.textBoxPosition || null,
  });
}

export function songRenderFromItem(item) {
  const render = item?.render && typeof item.render === "object" ? item.render : {};
  const snapshotRender =
    item?.songSnapshot?.defaultRender && typeof item.songSnapshot.defaultRender === "object"
      ? item.songSnapshot.defaultRender
      : {};
  const snapshotStyle = songRenderStateFromDefaultRender(snapshotRender);
  return mergeSongRenderState(
    {
      backgroundColor:
        render.backgroundColor ||
        snapshotStyle.backgroundColor ||
        DEFAULT_SONG_RENDER.backgroundColor,
      backgroundPath: render.backgroundPath || snapshotStyle.backgroundPath || "",
      color: render.color || snapshotStyle.color || DEFAULT_SONG_RENDER.color,
      fontFamily: render.fontFamily || snapshotStyle.fontFamily || DEFAULT_SONG_RENDER.fontFamily,
      fontSize: Number.isFinite(render.fontSize)
        ? render.fontSize
        : snapshotStyle.fontSize,
      autosizeMode: render.autosizeMode || snapshotStyle.autosizeMode || DEFAULT_SONG_RENDER.autosizeMode,
      minFontSize: Number.isFinite(render.minFontSize)
        ? render.minFontSize
        : snapshotStyle.minFontSize,
      copyrightPlacement:
        render.copyrightPlacement ||
        snapshotStyle.copyrightPlacement ||
        DEFAULT_SONG_RENDER.copyrightPlacement,
      textBoxPosition: render.textBoxPosition || snapshotStyle.textBoxPosition || null,
      transition: item?.transition || render.transition || DEFAULT_ITEM_SLIDE_TRANSITION,
      copyright: normalizeSongCopyrightText(
        firstNonEmptyString(render.copyright, item?.songSnapshot?.metadata?.copyright),
      ),
      ccliNumber: firstNonEmptyString(
        render.ccliNumber,
        item?.songSnapshot?.metadata?.ccliNumber,
        item?.songSnapshot?.metadata?.ccli_number,
      ),
      oneLicense: firstNonEmptyString(
        render.oneLicense,
        item?.songSnapshot?.metadata?.oneLicense,
        item?.songSnapshot?.metadata?.one_license,
      ),
      outputRole: render.outputRole,
      outputSize: render.outputSize,
      fontWeight: render.fontWeight,
      lineHeight: render.lineHeight,
      maxLines: render.maxLines,
      currentSectionId: render.currentSectionId,
    },
    {},
  );
}

function buildResolvedSongUnitTextMessage({
  song,
  section,
  render = {},
  showCopyright = true,
  resolvedPresentation = null,
  resolvedUnit = null,
}) {
  const style = mergeSongRenderState({}, render);
  const bodyText = resolvedUnit?.bodyText ?? songSectionLyricsText(section);
  const referenceText = "";
  const attributionText = "";
  const copyrightText = showCopyright
    ? songCopyrightAttribution(songCopyrightMetadata(song, style))
    : "";
  const backgroundUrl = style.backgroundPath ? pathToMediaUrl(style.backgroundPath) : "";
  const backgroundVideo =
    !imageRegex.test(style.backgroundPath) &&
    /\.(mp4|m4v|mov|mkv|webm)$/i.test(style.backgroundPath)
      ? backgroundUrl
      : "";
  const referencePresentation = scriptureReferencePresentationForBackground(
    style.backgroundColor,
    { forceLight: Boolean(style.backgroundPath || backgroundVideo) },
  );
  const sourceSlideObjects = Array.isArray(resolvedUnit?.slideObjects)
    ? resolvedUnit.slideObjects
    : Array.isArray(section?.slideObjects) && section.slideObjects.length > 0
    ? section.slideObjects
    : Array.isArray(section?.slideTextObjects)
      ? section.slideTextObjects
      : [];
  const slideObjects = sourceSlideObjects.map((object) => {
    const kind = object?.kind === "image" || object?.kind === "shape" ? object.kind : "text";
    const bg = object?.background && typeof object.background === "object"
      ? { ...object.background }
      : null;
    if (bg?.path) {
      const url = pathToMediaUrl(bg.path);
      if (
        bg.type === "video" ||
        (!imageRegex.test(bg.path) && /\.(mp4|m4v|mov|mkv|webm)$/i.test(bg.path))
      ) {
        bg.backgroundVideo = url;
      } else {
        bg.backgroundImage = url;
      }
    }
    if (kind === "image") {
      const image = object?.image && typeof object.image === "object" ? { ...object.image } : {};
      if (image.path) image.imageUrl = pathToMediaUrl(image.path);
      return {
        ...object,
        kind,
        image,
      };
    }
    return {
      ...object,
      kind,
      ...(bg ? { background: bg } : {}),
    };
  });
  const slideTextObjects = slideObjects.filter((object) => object?.kind === "text");

  return {
    blocks: resolvedUnit?.blocks || section?.blocks || [],
    text: bodyText,
    bodyText,
    reference: referenceText,
    referenceText,
    attributionText,
    copyrightText,
    version: "",
    fontFamily: style.fontFamily || SCRIPTURE_FONT_FAMILY,
    fontSize: normalizeScriptureFontSize(
      resolvedUnit?.layout?.resolvedFontSize ?? style.fontSize,
      SCRIPTURE_BODY_FONT_SIZE,
    ),
    preferredFontSize: normalizeScriptureFontSize(style.fontSize, SCRIPTURE_BODY_FONT_SIZE),
    autosizeMode: resolvedUnit ? "none" : style.autosizeMode || "fit",
    minFontSize: normalizeScriptureFontSize(style.minFontSize, 38),
    autoSplit: false,
    color: style.color || "#ffffff",
    backgroundColor: style.backgroundColor || "#000000",
    backgroundPath: style.backgroundPath || "",
    backgroundImage:
      style.backgroundPath && imageRegex.test(style.backgroundPath) ? backgroundUrl : "",
    backgroundVideo,
    referenceColor: referencePresentation.color,
    referenceTextShadow: referencePresentation.shadow,
    referenceFontSize: SCRIPTURE_REFERENCE_FONT_SIZE,
    fontWeight: SCRIPTURE_FONT_WEIGHT,
    lineHeight: SCRIPTURE_LINE_HEIGHT,
    look: SCRIPTURE_LOOK_FULLSCREEN,
    position: { vertical: "center", horizontal: "center" },
    textBoxPosition: style.textBoxPosition || null,
    ...(slideObjects.length > 0 ? { slideObjects } : {}),
    ...(slideTextObjects.length > 0 ? { slideTextObjects } : {}),
    ...(resolvedPresentation
      ? {
          resolvedPresentation,
          resolvedUnit,
          slideId: resolvedUnit?.slideId || null,
          layoutKey: resolvedPresentation.layoutKey,
          resolvedLayout: resolvedUnit?.layout || null,
        }
      : {}),
  };
}

function applyResolvedThemeToSongMessage(message, resolvedTheme) {
  if (!resolvedTheme) return message;
  const typography = resolvedTheme.typography || {};
  const background = resolvedTheme.canvas?.background || {};
  const backgroundPath = background.assetUrl || background.path || "";
  const backgroundUrl =
    background.assetUrl ||
    background.url ||
    (backgroundPath ? pathToMediaUrl(backgroundPath) : "");
  return {
    ...message,
    fontFamily: typography.fontFamily || message.fontFamily,
    preferredFontSize: typography.fontSize || message.preferredFontSize,
    minFontSize: typography.minFontSize || message.minFontSize,
    fontWeight: typography.fontWeight || message.fontWeight,
    lineHeight: typography.lineHeight || message.lineHeight,
    color: typography.color || typography.fontColor || message.color,
    backgroundColor: background.color || message.backgroundColor,
    backgroundPath,
    backgroundImage: background.type === "image" ? backgroundUrl : "",
    backgroundVideo: background.type === "video" ? backgroundUrl : "",
    textBoxPosition: resolvedTheme.textFrame
      ? {
          left: `${resolvedTheme.textFrame.x * 100}%`,
          top: `${resolvedTheme.textFrame.y * 100}%`,
          width: `${resolvedTheme.textFrame.width * 100}%`,
          height: `${resolvedTheme.textFrame.height * 100}%`,
        }
      : message.textBoxPosition,
    position: {
      vertical: typography.verticalAlign || message.position?.vertical || "center",
      horizontal: typography.align || message.position?.horizontal || "center",
    },
    resolvedTheme,
  };
}

function arrangementSequenceIdsForLibrary(sequence, sections = []) {
  const sectionIds = (Array.isArray(sections) ? sections : [])
    .map((section) => section?.id)
    .filter(Boolean);
  if (!Array.isArray(sequence) || sequence.length === 0) {
    return sectionIds;
  }
  const ids = sequence
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        return typeof entry.sectionId === "string" ? entry.sectionId : entry.id;
      }
      return null;
    })
    .filter(Boolean);
  return ids.length > 0 ? ids : sectionIds;
}

export function songForLibraryDatabase(song) {
  return normalizeToSongAST(song);
}

export function songSnapshotForSchedule(song, projectMetadata = {}) {
  const astSong = normalizeToSongAST(song);
  const snapshot = structuredClone(astSong);
  const meter = projectMetadata.meter || snapshot.metadata?.meter || snapshot.metadata?.hymnal?.meter || "";
  const rawHymnal =
    snapshot.metadata?.hymnal && typeof snapshot.metadata.hymnal === "object"
      ? snapshot.metadata.hymnal
      : { name: null, number: null, display: null };
  snapshot.metadata = {
    ...(snapshot.metadata || {}),
    authors: Array.isArray(snapshot.metadata?.authors) ? snapshot.metadata.authors : [],
    copyright: normalizeSongCopyrightText(projectMetadata.copyright || snapshot.metadata?.copyright || ""),
    ccliNumber: projectMetadata.ccliNumber ?? snapshot.metadata?.ccliNumber ?? null,
    oneLicense: projectMetadata.oneLicense ?? snapshot.metadata?.oneLicense ?? null,
    meter,
    hymnal: { ...rawHymnal, ...(meter ? { meter } : {}) },
    tags: Array.isArray(snapshot.metadata?.tags) ? snapshot.metadata.tags : [],
    extra: snapshot.metadata?.extra || {},
  };
  if (projectMetadata.defaultRender) {
    snapshot.defaultRender = {
      ...(snapshot.defaultRender || {}),
      ...projectMetadata.defaultRender,
    };
  }
  delete snapshot.import;
  return snapshot;
}

export function queueEntryFromSong({
  song,
  render = {},
  sequenceEntries = null,
  currentSectionId = null,
}) {
  const entries = sequenceEntries || arrangementSequenceEntries(song);
  const enabled = enabledSongSections(song, entries);
  const section =
    enabled.find((s) => s.id === currentSectionId) || enabled[0] || song?.sections?.[0] || null;

  return {
    path: songQueuePath(song.id),
    name: song.title || "Song",
    type: "song",
    autoAdvance: false,
    cueStartTime: 0,
    source: {
      kind: "library",
      songId: song.id,
    },
    songSnapshot: songSnapshotForSchedule(song, {
      copyright: render.copyright,
      ccliNumber: render.ccliNumber,
      oneLicense: render.oneLicense,
      meter: song.metadata?.meter || song.metadata?.hymnal?.meter || "",
      defaultRender: {
        ...songDefaultRenderFromRender(render),
      },
    }),
    sequence: {
      arrangementId: song.arrangements?.[0]?.id || "arr_default",
      entries,
      currentSequenceEntryId: entries.find((entry) => entry.sectionId === section?.id)?.id || null,
    },
    currentSlideId: null,
    currentSequenceEntryId:
      entries.find((entry) => entry.sectionId === section?.id)?.id || null,
    render: {
      themeId: "song_default",
      backgroundColor: render.backgroundColor,
      backgroundPath: render.backgroundPath,
      color: render.color,
      fontFamily: render.fontFamily,
      fontSize: render.fontSize,
      autosizeMode: render.autosizeMode,
      minFontSize: render.minFontSize,
      copyrightPlacement: render.copyrightPlacement,
      textBoxPosition: render.textBoxPosition || null,
      ccliNumber:
        render.ccliNumber != null && String(render.ccliNumber).trim()
          ? String(render.ccliNumber).trim()
          : null,
      oneLicense:
        render.oneLicense != null && String(render.oneLicense).trim()
          ? String(render.oneLicense).trim()
          : null,
      copyright: normalizeSongCopyrightText(render.copyright || song.metadata?.copyright || ""),
      currentSectionId: section?.id || null,
      currentSlideId: null,
      currentSequenceEntryId:
        entries.find((entry) => entry.sectionId === section?.id)?.id || null,
    },
    transition: slideTransitionOverrideSnapshot(render.transition),
  };
}

export function resolvedSongPresentation(item) {
  const song = item?.songSnapshot;
  if (!song) return null;
  const render = songRenderFromItem(item);
  const entries = item?.sequence?.entries || arrangementSequenceEntries(song);
  const enabled = enabledSongSections(song, entries);
  const resolutionSong = entries === song.playOrder
    ? song
    : { ...song, playOrder: entries };
  const resolved = resolveSongSlides(resolutionSong, {
    render,
    typography: item?.resolvedTheme?.typography || render,
    resolvedTheme: item?.resolvedTheme || null,
    chunking: item?.chunking,
    currentSectionId: render.currentSectionId || item?.render?.currentSectionId,
    activeSlideId: item?.currentSlideId || render.currentSlideId,
    sequenceEntryId:
      item?.currentSequenceEntryId ||
      item?.sequence?.currentSequenceEntryId ||
      render.currentSequenceEntryId,
    arrangementId: item?.sequence?.arrangementId,
    sequenceEntries: entries,
    outputRole: render.outputRole || "audience",
    outputSize: render.outputSize,
    copyrightPlacement: render.copyrightPlacement,
  });
  const activeUnit = resolved.activeSlide;
  const section =
    song.sections?.find((entry) => entry.id === activeUnit?.sectionId) ||
    enabled.find((s) => s.id === render.currentSectionId) ||
    enabled[0] ||
    song.sections?.[0] ||
    null;
  const firstSection = enabled[0] || song.sections?.[0] || null;
  const showCopyright =
    render.copyrightPlacement !== "none" &&
    (
      render.copyrightPlacement !== "firstSlide" ||
      (Number.isFinite(activeUnit?.index)
        ? activeUnit.index === 0
        : Boolean(section?.id) && section.id === firstSection?.id)
    );
  const message = buildResolvedSongUnitTextMessage({
    song,
    section,
    render,
    showCopyright,
    resolvedPresentation: resolved,
    resolvedUnit: activeUnit,
  });
  return {
    song,
    section,
    render,
    resolvedPresentation: resolved,
    activeUnit,
    message: applyResolvedThemeToSongMessage(message, item?.resolvedTheme),
  };
}
