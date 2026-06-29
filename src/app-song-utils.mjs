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

export function arrangementSequenceEntries(song, arrangementId = "arr_default") {
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
  return (section.lines || [])
    .map((line) => (line.kind === "spacer" ? "" : line.text || ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function songCopyrightAttribution(metadata = {}, placement = "firstSlide") {
  if (placement === "none") return "";
  const parts = [];
  const copyright = typeof metadata.copyright === "string" ? metadata.copyright.trim() : "";
  const ccli =
    metadata.ccliNumber != null && String(metadata.ccliNumber).trim()
      ? `CCLI #${String(metadata.ccliNumber).trim()}`
      : "";
  const oneLicense =
    metadata.oneLicense != null && String(metadata.oneLicense).trim()
      ? `ONE LICENSE #${String(metadata.oneLicense).trim()}`
      : "";
  if (copyright) parts.push(copyright);
  if (ccli) parts.push(ccli);
  if (oneLicense) parts.push(oneLicense);
  return parts.join(" · ");
}

export function mergeSongRenderState(base = {}, overrides = {}) {
  return {
    ...DEFAULT_SONG_RENDER,
    ...(base && typeof base === "object" ? base : {}),
    ...(overrides && typeof overrides === "object" ? overrides : {}),
  };
}

export function songRenderFromItem(item) {
  const render = item?.render && typeof item.render === "object" ? item.render : {};
  const snapshotRender =
    item?.songSnapshot?.defaultRender && typeof item.songSnapshot.defaultRender === "object"
      ? item.songSnapshot.defaultRender
      : {};
  return mergeSongRenderState(
    {
      backgroundColor:
        render.backgroundColor ||
        snapshotRender.background?.color ||
        DEFAULT_SONG_RENDER.backgroundColor,
      backgroundPath: render.backgroundPath || snapshotRender.background?.path || "",
      color: render.color || snapshotRender.textColor || DEFAULT_SONG_RENDER.color,
      fontFamily: render.fontFamily || DEFAULT_SONG_RENDER.fontFamily,
      fontSize: Number.isFinite(render.fontSize)
        ? render.fontSize
        : DEFAULT_SONG_RENDER.fontSize,
      autosizeMode: render.autosizeMode || DEFAULT_SONG_RENDER.autosizeMode,
      minFontSize: Number.isFinite(render.minFontSize)
        ? render.minFontSize
        : DEFAULT_SONG_RENDER.minFontSize,
      copyrightPlacement:
        render.copyrightPlacement ||
        snapshotRender.copyrightPlacement ||
        DEFAULT_SONG_RENDER.copyrightPlacement,
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
  const attributionText = showCopyright
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
    text: bodyText,
    bodyText,
    reference: referenceText,
    referenceText,
    attributionText,
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
  if (!song || typeof song !== "object") return song;
  const sections = Array.isArray(song.sections) ? song.sections : [];
  const arrangements = (Array.isArray(song.arrangements) ? song.arrangements : []).map(
    (arrangement, index) => ({
      id: arrangement?.id || (index === 0 ? "arr_default" : `arr_${index + 1}`),
      name: arrangement?.name || "Default",
      sequence: arrangementSequenceIdsForLibrary(arrangement?.sequence, sections),
    }),
  );
  if (arrangements.length === 0) {
    arrangements.push({
      id: "arr_default",
      name: "Default",
      sequence: arrangementSequenceIdsForLibrary(null, sections),
    });
  }
  return {
    schema: song.schema || "ems.song.v1",
    id: song.id,
    title: song.title || "Untitled Song",
    folderId: typeof song.folderId === "string" && song.folderId.trim() ? song.folderId.trim() : null,
    ...(Number.isFinite(song.songNumber) && song.songNumber > 0 ? { songNumber: song.songNumber } : {}),
    metadata: {
      authors: Array.isArray(song.metadata?.authors) ? song.metadata.authors : [],
      copyright: song.metadata?.copyright || "",
      ccliNumber: song.metadata?.ccliNumber || null,
      oneLicense: song.metadata?.oneLicense || null,
    },
    sections,
    arrangements,
    ...(song.defaultRender ? { defaultRender: song.defaultRender } : {}),
  };
}

export function songSnapshotForSchedule(song, projectMetadata = {}) {
  const snapshot = structuredClone(song);
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
        themeId: "song_default",
        background: {
          mode: render.backgroundPath ? "custom" : "color",
          color: render.backgroundColor || DEFAULT_SONG_RENDER.backgroundColor,
          path: render.backgroundPath || "",
        },
        textColor: render.color || DEFAULT_SONG_RENDER.color,
        copyrightPlacement: render.copyrightPlacement || "firstSlide",
      },
    }),
    sequence: {
      arrangementId: song.arrangements?.[0]?.id || "arr_default",
      entries,
    },
    render: {
      themeId: "song_default",
      backgroundColor: render.backgroundColor || DEFAULT_SONG_RENDER.backgroundColor,
      backgroundPath: render.backgroundPath || "",
      color: render.color || DEFAULT_SONG_RENDER.color,
      fontFamily: render.fontFamily || DEFAULT_SONG_RENDER.fontFamily,
      fontSize: render.fontSize || DEFAULT_SONG_RENDER.fontSize,
      copyrightPlacement: render.copyrightPlacement || "firstSlide",
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
