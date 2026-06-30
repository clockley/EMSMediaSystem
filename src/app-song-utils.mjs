/*
Copyright (C) 2024 Christian Lockley
*/

import { imageRegex, pathToMediaUrl } from "./app-media-utils.mjs";
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

  const id = song.id || "";
  const title = song.title || "Untitled Song";
  const songNumber = Number.isFinite(song.songNumber) && song.songNumber > 0 ? song.songNumber : undefined;
  const folderId = typeof song.folderId === "string" && song.folderId.trim() ? song.folderId.trim() : null;

  const authors = Array.isArray(song.metadata?.authors) ? song.metadata.authors : [];
  const copyright = song.metadata?.copyright || "";
  const ccliNumber = song.metadata?.ccliNumber || song.metadata?.ccli_number || "";
  const oneLicense = song.metadata?.oneLicense || song.metadata?.one_license || "";
  const hymnal = song.metadata?.hymnal || { name: null, number: null, display: null };

  const sections = (Array.isArray(song.sections) ? song.sections : []).map(sec => {
    const kind = (sec.kind || "verse").toLowerCase();
    const label = sec.label || "";

    let blocks = [];
    if (Array.isArray(sec.blocks)) {
      blocks = sec.blocks.map(block => ({
        type: block.type || "lyricLine",
        id: block.id || `block_${Math.random().toString(36).substring(2, 9)}`,
        primary: {
          lang: block.primary?.lang || "en",
          segments: Array.isArray(block.primary?.segments) ? block.primary.segments : [
            { type: "text", text: block.primary?.text || "" }
          ]
        },
        translations: Array.isArray(block.translations) ? block.translations : [],
        annotations: Array.isArray(block.annotations) ? block.annotations : []
      }));
    }

    return {
      id: sec.id || `sec_${Math.random().toString(36).substring(2, 9)}`,
      kind,
      label,
      blocks
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
    schema: "ems.song.v1",
    id,
    title,
    songNumber,
    folderId,
    metadata: {
      authors,
      copyright,
      ccliNumber,
      oneLicense,
      hymnal
    },
    languages: song.languages || [
      { id: "en", name: "English", default: true }
    ],
    sections,
    playOrder,
    presentation: song.presentation || {
      defaultChunking: {
        mode: "blocksPerSlide",
        maxBlocks: 4
      }
    },
    defaultRender
  };
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

export function songCopyrightAttribution(metadata = {}, placement = "firstSlide") {
  if (!metadata) return "";
  const parts = [];
  if (metadata.authors && metadata.authors.length > 0) {
    parts.push(metadata.authors.join(", "));
  }
  if (metadata.copyright) {
    parts.push(metadata.copyright);
  }
  if (metadata.ccliNumber) {
    parts.push(`CCLI #${metadata.ccliNumber}`);
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
    },
    {},
  );
}

export function buildSongTextMessage({
  song,
  section,
  render = {},
  showCopyright = true,
}) {
  const style = mergeSongRenderState({}, render);
  const bodyText = songSectionLyricsText(section);
  const referenceText = "";
  const attributionText = "";
  const copyrightText = showCopyright
    ? songCopyrightAttribution(song?.metadata, style.copyrightPlacement)
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

  return {
    blocks: section?.blocks || [],
    text: bodyText,
    bodyText,
    reference: referenceText,
    referenceText,
    attributionText,
    copyrightText,
    version: "",
    fontFamily: style.fontFamily || SCRIPTURE_FONT_FAMILY,
    fontSize: normalizeScriptureFontSize(style.fontSize, SCRIPTURE_BODY_FONT_SIZE),
    autosizeMode: style.autosizeMode || "fit",
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
  snapshot.metadata = {
    ...(snapshot.metadata || {}),
    authors: Array.isArray(snapshot.metadata?.authors) ? snapshot.metadata.authors : [],
    copyright: projectMetadata.copyright || snapshot.metadata?.copyright || "",
    ccliNumber: projectMetadata.ccliNumber ?? snapshot.metadata?.ccliNumber ?? null,
    oneLicense: projectMetadata.oneLicense ?? snapshot.metadata?.oneLicense ?? null,
    hymnal: snapshot.metadata?.hymnal || { name: null, number: null, display: null },
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
      defaultRender: {
        ...songDefaultRenderFromRender(render),
      },
    }),
    sequence: {
      arrangementId: song.arrangements?.[0]?.id || "arr_default",
      entries,
    },
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
      copyright: render.copyright || song.metadata?.copyright || "",
      currentSectionId: section?.id || null,
    },
  };
}

export function resolvedSongPresentation(item) {
  const song = item?.songSnapshot;
  if (!song) return null;
  const render = songRenderFromItem(item);
  const entries = item?.sequence?.entries || arrangementSequenceEntries(song);
  const enabled = enabledSongSections(song, entries);
  const section =
    enabled.find((s) => s.id === render.currentSectionId) ||
    enabled.find((s) => s.id === item?.render?.currentSectionId) ||
    enabled[0] ||
    song.sections?.[0] ||
    null;
  const showCopyright =
    render.copyrightPlacement !== "none" &&
    (render.copyrightPlacement !== "firstSlide" || section === enabled[0]);
  return {
    song,
    section,
    render,
    message: buildSongTextMessage({
      song,
      section,
      render,
      showCopyright,
    }),
  };
}
