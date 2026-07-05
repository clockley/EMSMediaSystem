/*
Copyright (C) 2026 Christian Lockley

Helpers for the EMS Slide Deck AST (schema "ems.slideDeck.v1").

Decks reuse the EMS song block/segment grammar so the existing presentation
pipeline can render deck pages without code duplication. The bridge is
`deckToTransientSong()` (and `deckPagesToSongSections()`), which emit a
schema-conformant ems.song.v1 where each deck page becomes one section.
*/

import { EMS_SLIDE_DECK_SCHEMA_ID } from "./schemas/ems-slide.types.mjs";
import { normalizeToSongAST } from "./app-song-utils.mjs";

export { EMS_SLIDE_DECK_SCHEMA_ID };

export const slideDeckUriPrefix = "deck://";
export const DEFAULT_CANVAS = Object.freeze({ width: 1920, height: 1080 });
export const DEFAULT_TEXT_FRAME = Object.freeze({ x: 0.06, y: 0.18, width: 0.88, height: 0.64 });
export const SONG_DECK_DOCUMENT_TYPE = "song";

export const DEFAULT_DECK_THEME = Object.freeze({
  fontFamily: "Adwaita Sans",
  fontSize: 96,
  minFontSize: 38,
  autosizeMode: "fit",
  textColor: "#ffffff",
  backgroundColor: "#000000",
});

export function deckQueuePath(deckId, pageId) {
  const safeDeck = encodeURIComponent(String(deckId || "").trim());
  if (pageId) {
    return `${slideDeckUriPrefix}${safeDeck}#${encodeURIComponent(String(pageId).trim())}`;
  }
  return `${slideDeckUriPrefix}${safeDeck}`;
}

export function isDeckPath(filePath) {
  return typeof filePath === "string" && filePath.startsWith(slideDeckUriPrefix);
}

export function isSlideDeckDocument(value) {
  return Boolean(value && typeof value === "object" && value.schema === EMS_SLIDE_DECK_SCHEMA_ID);
}

export function parseDeckQueuePath(filePath) {
  if (!isDeckPath(filePath)) return null;
  const tail = filePath.slice(slideDeckUriPrefix.length);
  const hash = tail.indexOf("#");
  let id, page;
  if (hash >= 0) {
    id = tail.slice(0, hash);
    page = tail.slice(hash + 1);
  } else {
    id = tail;
    page = "";
  }
  try {
    return { deckId: decodeURIComponent(id), pageId: page ? decodeURIComponent(page) : null };
  } catch {
    return { deckId: id, pageId: page || null };
  }
}

function shortId(prefix = "id") {
  try {
    const uuid =
      typeof globalThis !== "undefined" &&
      globalThis.crypto &&
      typeof globalThis.crypto.randomUUID === "function"
        ? globalThis.crypto.randomUUID().replace(/-/g, "")
        : "";
    if (uuid) return `${prefix}_${uuid.slice(0, 12)}`;
  } catch {}
  return `${prefix}_${Math.random().toString(36).slice(2, 14)}`;
}

export function createTextObject({
  text = "",
  frame = DEFAULT_TEXT_FRAME,
  role = "body",
  style = null,
  background = null,
  zIndex = 1,
} = {}) {
  return {
    id: shortId("obj"),
    kind: "text",
    role,
    frame: { ...frame },
    zIndex,
    opacity: 1,
    autofit: "fit",
    style: style || {},
    ...(background ? { background: normalizeBackground(background) } : {}),
    blocks: textToSegmentsBlocks(text),
  };
}

export function createImageObject({
  path = "",
  assetId = null,
  fit = "contain",
  frame = { x: 0, y: 0, width: 1, height: 1 },
  zIndex = 0,
} = {}) {
  return {
    id: shortId("obj"),
    kind: "image",
    frame: { ...frame },
    zIndex,
    opacity: 1,
    image: { path, ...(assetId ? { assetId } : {}), fit },
  };
}

export function createShapeObject({
  type = "rect",
  fill = "#ffffff",
  stroke = null,
  strokeWidth = 0,
  radius = 0,
  frame = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
  zIndex = 0,
} = {}) {
  return {
    id: shortId("obj"),
    kind: "shape",
    frame: { ...frame },
    zIndex,
    opacity: 1,
    shape: { type, fill, ...(stroke ? { stroke } : {}), strokeWidth, radius },
  };
}

export function createBlankPage({ label = "", text = "", background = null, objects = null, transition = null } = {}) {
  return {
    id: shortId("page"),
    label: label || "",
    durationMs: 0,
    autoAdvance: false,
    ...(transition ? { transition: { ...transition } } : {}),
    background: background || { type: "color", color: DEFAULT_DECK_THEME.backgroundColor },
    notes: "",
    objects: Array.isArray(objects)
      ? objects
      : text
        ? [createTextObject({ text })]
        : [],
  };
}

export function createBlankDeck({
  title = "Untitled Deck",
  folderId = null,
  canvas = DEFAULT_CANVAS,
  theme = DEFAULT_DECK_THEME,
  pages = null,
} = {}) {
  const now = new Date().toISOString();
  const deckPages = pages && pages.length ? pages : [createBlankPage({ label: "Page 1" })];
  return {
    schema: EMS_SLIDE_DECK_SCHEMA_ID,
    id: shortId("deck"),
    title,
    folderId,
    createdAt: now,
    updatedAt: now,
    canvas: { ...canvas },
    theme: { ...DEFAULT_DECK_THEME, ...theme },
    pageSequence: normalizePageSequence(deckPages, null),
    pages: deckPages,
  };
}

/* ── Text ↔ blocks ──────────────────────────────────────────── */

export function textToSegmentsBlocks(text) {
  const str = typeof text === "string" ? text : "";
  if (!str.length) {
    return [{
      type: "spacer",
      id: shortId("block"),
      primary: { lang: "en", segments: [] },
      translations: [],
      annotations: [],
    }];
  }
  const lines = str.split(/\r?\n/);
  return lines.map((line) => ({
    type: line.trim() === "" ? "spacer" : "lyricLine",
    id: shortId("block"),
    primary: {
      lang: "en",
      segments: line.trim() === "" ? [] : [{ type: "text", text: line }],
    },
    translations: [],
    annotations: [],
  }));
}

export function blocksToText(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return "";
  return blocks
    .map((b) => {
      if (!b) return "";
      if (b.type === "spacer") return "";
      const segs = Array.isArray(b.primary?.segments) ? b.primary.segments : [];
      return segs.map((s) => (s && typeof s.text === "string" ? s.text : "")).join("");
    })
    .join("\n");
}

/* ── Normalize ──────────────────────────────────────────────── */

function normalizeFrame(frame) {
  const f = frame && typeof frame === "object" ? frame : {};
  const clamp = (v, def) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  return {
    x: clamp(f.x, 0),
    y: clamp(f.y, 0),
    width: clamp(f.width, 1),
    height: clamp(f.height, 1),
  };
}

function normalizeObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  const kind = obj.kind === "image" || obj.kind === "shape" ? obj.kind : "text";
  const base = {
    id: obj.id || shortId("obj"),
    kind,
    frame: normalizeFrame(obj.frame),
    zIndex: Number.isFinite(obj.zIndex) ? obj.zIndex : 0,
    opacity: Number.isFinite(obj.opacity) ? obj.opacity : 1,
  };
  if (kind === "text") {
    return {
      ...base,
      role: obj.role || "body",
      autofit: obj.autofit || "fit",
      style: obj.style && typeof obj.style === "object" ? { ...obj.style } : {},
      ...(obj.background && typeof obj.background === "object"
        ? { background: normalizeBackground(obj.background) }
        : {}),
      blocks: Array.isArray(obj.blocks) && obj.blocks.length
        ? obj.blocks.map((b) => {
            const explicitSegments = Array.isArray(b?.primary?.segments)
              ? b.primary.segments
              : null;
            const fallbackText = b?.primary?.text || "";
            const isSpacer =
              b?.type === "spacer" ||
              (explicitSegments ? explicitSegments.length === 0 : fallbackText.trim() === "");
            return {
              type: isSpacer ? "spacer" : "lyricLine",
              id: b?.id || shortId("block"),
              primary: {
                lang: b?.primary?.lang || "en",
                segments: isSpacer
                  ? []
                  : explicitSegments || [{ type: "text", text: fallbackText }],
              },
              translations: Array.isArray(b?.translations) ? b.translations : [],
              annotations: Array.isArray(b?.annotations) ? b.annotations : [],
            };
          })
        : textToSegmentsBlocks(""),
    };
  }
  if (kind === "image") {
    const img = obj.image && typeof obj.image === "object" ? obj.image : {};
    return {
      ...base,
      image: {
        path: typeof img.path === "string" ? img.path : "",
        ...(img.assetId ? { assetId: String(img.assetId) } : {}),
        fit: img.fit === "cover" || img.fit === "fill" ? img.fit : "contain",
      },
    };
  }
  // shape
  const sh = obj.shape && typeof obj.shape === "object" ? obj.shape : {};
  return {
    ...base,
    shape: {
      type: sh.type === "ellipse" || sh.type === "line" ? sh.type : "rect",
      fill: sh.fill || "#ffffff",
      ...(sh.stroke ? { stroke: sh.stroke } : {}),
      strokeWidth: Number.isFinite(sh.strokeWidth) ? sh.strokeWidth : 0,
      radius: Number.isFinite(sh.radius) ? sh.radius : 0,
    },
  };
}

function normalizeBackground(bg) {
  if (!bg || typeof bg !== "object") return { type: "color", color: DEFAULT_DECK_THEME.backgroundColor };
  const type = bg.type === "image" || bg.type === "video" ? bg.type : "color";
  if (type === "color") return { type, color: bg.color || DEFAULT_DECK_THEME.backgroundColor };
  return {
    type,
    color: bg.color || DEFAULT_DECK_THEME.backgroundColor,
    ...(bg.path ? { path: String(bg.path) } : {}),
    ...(bg.assetId ? { assetId: String(bg.assetId) } : {}),
  };
}

function normalizePage(page) {
  if (!page || typeof page !== "object") return null;
  return {
    id: page.id || shortId("page"),
    label: typeof page.label === "string" ? page.label : "",
    durationMs: Number.isFinite(page.durationMs) ? page.durationMs : 0,
    autoAdvance: page.autoAdvance === true,
    ...(page.transition ? { transition: { ...page.transition } } : {}),
    notes: typeof page.notes === "string" ? page.notes : "",
    background: normalizeBackground(page.background),
    objects: (Array.isArray(page.objects) ? page.objects : [])
      .map(normalizeObject)
      .filter(Boolean),
  };
}

function normalizePageSequence(pages, pageSequence) {
  const pageIds = pages.map((page) => page?.id).filter(Boolean);
  const validIds = new Set(pageIds);
  const seen = new Set();
  const sequence = [];
  const source = Array.isArray(pageSequence) ? pageSequence : pageIds;
  for (const rawId of source) {
    const id = typeof rawId === "string" ? rawId : String(rawId || "");
    if (!id || !validIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    sequence.push(id);
  }
  for (const id of pageIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    sequence.push(id);
  }
  return sequence;
}

export function normalizeSlideDeck(deck) {
  if (!deck || typeof deck !== "object") return null;
  const now = new Date().toISOString();
  const canvas = deck.canvas && typeof deck.canvas === "object" ? deck.canvas : DEFAULT_CANVAS;
  const theme = { ...DEFAULT_DECK_THEME, ...(deck.theme && typeof deck.theme === "object" ? deck.theme : {}) };
  let pages = (Array.isArray(deck.pages) ? deck.pages : [])
    .map(normalizePage)
    .filter(Boolean);
  if (!pages.length) pages = [createBlankPage({ label: "Page 1" })];
  const pageSequence = normalizePageSequence(pages, deck.pageSequence);
  return {
    schema: EMS_SLIDE_DECK_SCHEMA_ID,
    id: deck.id || shortId("deck"),
    title: typeof deck.title === "string" && deck.title.trim() ? deck.title : "Untitled Deck",
    folderId: typeof deck.folderId === "string" && deck.folderId.trim() ? deck.folderId.trim() : null,
    ...(deck.documentType ? { documentType: String(deck.documentType) } : {}),
    ...(deck.type === SONG_DECK_DOCUMENT_TYPE ? { type: SONG_DECK_DOCUMENT_TYPE } : {}),
    ...(Number.isFinite(deck.songNumber) && deck.songNumber > 0 ? { songNumber: deck.songNumber } : {}),
    ...(deck.metadata && typeof deck.metadata === "object" ? { metadata: structuredClone(deck.metadata) } : {}),
    createdAt: deck.createdAt || now,
    updatedAt: deck.updatedAt || now,
    canvas: {
      width: Number.isFinite(canvas.width) ? canvas.width : DEFAULT_CANVAS.width,
      height: Number.isFinite(canvas.height) ? canvas.height : DEFAULT_CANVAS.height,
      ...(canvas.safeMargins ? { safeMargins: canvas.safeMargins } : {}),
    },
    theme,
    pageSequence,
    pages,
  };
}

export function orderedDeckPages(deck) {
  if (!deck || !Array.isArray(deck.pages)) return [];
  const pages = deck.pages.filter(Boolean);
  const byId = new Map(pages.map((page) => [page.id, page]));
  const ordered = [];
  const seen = new Set();
  const sequence = Array.isArray(deck.pageSequence)
    ? deck.pageSequence
    : pages.map((page) => page.id);
  for (const rawId of sequence) {
    const id = typeof rawId === "string" ? rawId : String(rawId || "");
    const page = byId.get(id);
    if (!page || seen.has(id)) continue;
    seen.add(id);
    ordered.push(page);
  }
  for (const page of pages) {
    if (!page?.id || seen.has(page.id)) continue;
    seen.add(page.id);
    ordered.push(page);
  }
  return ordered;
}

export function normalizeDeckPageSequence(deck) {
  if (!deck || typeof deck !== "object") return [];
  const pages = Array.isArray(deck.pages) ? deck.pages : [];
  deck.pageSequence = normalizePageSequence(pages, deck.pageSequence);
  return deck.pageSequence;
}

/* ── Search text (FTS-friendly) ─────────────────────────────── */

export function slideDeckToSearchText(deck) {
  const norm = normalizeSlideDeck(deck);
  if (!norm) return "";
  const parts = [];
  if (norm.title) parts.push(norm.title);
  for (const page of orderedDeckPages(norm)) {
    if (page.label) parts.push(page.label);
    for (const obj of page.objects) {
      if (obj.kind !== "text") continue;
      const t = blocksToText(obj.blocks);
      if (t) parts.push(t);
    }
    if (page.notes) parts.push(page.notes);
  }
  return parts
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/* ── Adapter to song AST ────────────────────────────────────── */

function pageTextObjects(page) {
  if (!page || !Array.isArray(page.objects)) return [];
  return page.objects.filter((o) => o && o.kind === "text");
}

function orderedPageObjects(page) {
  if (!page || !Array.isArray(page.objects)) return [];
  return page.objects
    .map((object, index) => ({ object, index }))
    .filter(({ object }) => object)
    .sort((a, b) => {
      const az = Number.isFinite(a.object.zIndex) ? a.object.zIndex : 0;
      const bz = Number.isFinite(b.object.zIndex) ? b.object.zIndex : 0;
      return az === bz ? a.index - b.index : az - bz;
    })
    .map(({ object }) => object);
}

function orderedTextObjects(page) {
  return pageTextObjects(page)
    .map((object, index) => ({ object, index }))
    .sort((a, b) => {
      const az = Number.isFinite(a.object.zIndex) ? a.object.zIndex : 0;
      const bz = Number.isFinite(b.object.zIndex) ? b.object.zIndex : 0;
      return az === bz ? a.index - b.index : az - bz;
    })
    .map(({ object }) => object);
}

function primaryTextObject(page) {
  return pageTextObjects(page)[0] || null;
}

function frameToTextBoxPosition(frame) {
  const f = normalizeFrame(frame);
  return {
    left: `${f.x * 100}%`,
    top: `${f.y * 100}%`,
    width: `${f.width * 100}%`,
    height: `${f.height * 100}%`,
  };
}

function objectPresentationBase(obj) {
  return {
    id: obj.id,
    kind: obj.kind,
    zIndex: Number.isFinite(obj.zIndex) ? obj.zIndex : 0,
    opacity: Number.isFinite(obj.opacity) ? Math.max(0, Math.min(1, obj.opacity)) : 1,
    textBoxPosition: frameToTextBoxPosition(obj.frame || DEFAULT_TEXT_FRAME),
  };
}

function textObjectPresentation(obj, theme = DEFAULT_DECK_THEME) {
  if (!obj || obj.kind !== "text") return null;
  const style = obj.style && typeof obj.style === "object" ? obj.style : {};
  const fontSize = Number(style.fontSize);
  const themeFontSize = Number(theme.fontSize);
  const minFontSize = Number(style.minFontSize);
  const themeMinFontSize = Number(theme.minFontSize);
  return {
    ...objectPresentationBase(obj),
    blocks: Array.isArray(obj.blocks) ? obj.blocks : textToSegmentsBlocks(""),
    autofit: obj.autofit || theme.autosizeMode || DEFAULT_DECK_THEME.autosizeMode,
    color: style.color || theme.textColor || DEFAULT_DECK_THEME.textColor,
    fontFamily: style.fontFamily || theme.fontFamily || DEFAULT_DECK_THEME.fontFamily,
    fontSize: Number.isFinite(fontSize)
      ? fontSize
      : Number.isFinite(themeFontSize)
        ? themeFontSize
        : DEFAULT_DECK_THEME.fontSize,
    minFontSize: Number.isFinite(minFontSize)
      ? minFontSize
      : Number.isFinite(themeMinFontSize)
        ? themeMinFontSize
        : DEFAULT_DECK_THEME.minFontSize,
    align: style.align || "center",
    verticalAlign: style.verticalAlign || "center",
    fontWeight: style.fontWeight || undefined,
    fontStyle: style.fontStyle || undefined,
    textDecoration: style.textDecoration || undefined,
    lineHeight: Number.isFinite(style.lineHeight) ? style.lineHeight : undefined,
    background: obj.background && typeof obj.background === "object"
      ? normalizeBackground(obj.background)
      : null,
  };
}

function imageObjectPresentation(obj) {
  if (!obj || obj.kind !== "image") return null;
  const image = obj.image && typeof obj.image === "object" ? obj.image : {};
  return {
    ...objectPresentationBase(obj),
    image: {
      path: typeof image.path === "string" ? image.path : "",
      ...(image.assetId ? { assetId: String(image.assetId) } : {}),
      fit: image.fit === "cover" || image.fit === "fill" ? image.fit : "contain",
    },
  };
}

function shapeObjectPresentation(obj) {
  if (!obj || obj.kind !== "shape") return null;
  const shape = obj.shape && typeof obj.shape === "object" ? obj.shape : {};
  return {
    ...objectPresentationBase(obj),
    shape: {
      type: shape.type === "ellipse" || shape.type === "line" ? shape.type : "rect",
      fill: shape.fill || "#ffffff",
      ...(shape.stroke ? { stroke: shape.stroke } : {}),
      strokeWidth: Number.isFinite(shape.strokeWidth) ? shape.strokeWidth : 0,
      radius: Number.isFinite(shape.radius) ? shape.radius : 0,
    },
  };
}

function slideObjectPresentation(obj, theme = DEFAULT_DECK_THEME) {
  if (obj?.kind === "image") return imageObjectPresentation(obj);
  if (obj?.kind === "shape") return shapeObjectPresentation(obj);
  return textObjectPresentation(obj, theme);
}

function combineTextObjects(textObjects) {
  // Stable order by zIndex then existing order
  const ordered = [...textObjects].sort((a, b) => {
    const az = Number.isFinite(a.zIndex) ? a.zIndex : 0;
    const bz = Number.isFinite(b.zIndex) ? b.zIndex : 0;
    return az - bz;
  });
  const blocks = [];
  ordered.forEach((obj, idx) => {
    if (idx > 0) {
      blocks.push({
        type: "spacer",
        id: shortId("block"),
        primary: { lang: "en", segments: [] },
      });
    }
    for (const b of obj.blocks || []) blocks.push(b);
  });
  return blocks.length ? blocks : textToSegmentsBlocks("");
}

export function deckPagesToSongSections(deck) {
  const norm = normalizeSlideDeck(deck);
  if (!norm) return [];
  return orderedDeckPages(norm).map((page, idx) => {
    const textObjects = orderedTextObjects(page);
    const slideObjects = orderedPageObjects(page)
      .map((obj) => slideObjectPresentation(obj, norm.theme || DEFAULT_DECK_THEME))
      .filter(Boolean);
    const slideTextObjects = slideObjects.filter((obj) => obj.kind === "text");
    const txt = combineTextObjects(textObjects);
    return {
      id: page.id,
      kind: "verse",
      label: page.label || `Page ${idx + 1}`,
      blocks: txt,
      slideObjects,
      slideTextObjects,
    };
  });
}

/**
 * Convert a deck into a schema-conformant ems.song.v1, mapping one section
 * per page. This lets the existing song presentation pipeline render decks.
 *
 * @param {import("./schemas/ems-slide.types.mjs").EmsSlideDeck} deck
 * @returns {object} ems.song.v1 song
 */
export function deckToTransientSong(deck) {
  const norm = normalizeSlideDeck(deck);
  if (!norm) return null;
  const sections = deckPagesToSongSections(norm);
  const metadata = norm.metadata && typeof norm.metadata === "object" ? norm.metadata : {};
  const meter = metadata.meter || metadata.hymnal?.meter || "";
  const hymnal =
    metadata.hymnal && typeof metadata.hymnal === "object"
      ? { ...metadata.hymnal, ...(meter ? { meter } : {}) }
      : { name: null, number: norm.songNumber ? String(norm.songNumber) : null, display: null, ...(meter ? { meter } : {}) };
  const song = {
    schema: "ems.song.v1",
    id: norm.id,
    title: norm.title,
    ...(Number.isFinite(norm.songNumber) && norm.songNumber > 0 ? { songNumber: norm.songNumber } : {}),
    folderId: norm.folderId || null,
    metadata: {
      authors: Array.isArray(metadata.authors) ? metadata.authors : [],
      copyright: metadata.copyright || "",
      ccliNumber: metadata.ccliNumber || metadata.ccli_number || null,
      oneLicense: metadata.oneLicense || metadata.one_license || null,
      meter,
      hymnal,
      tags: Array.isArray(metadata.tags) ? metadata.tags : [norm.documentType === SONG_DECK_DOCUMENT_TYPE ? "song" : "deck"],
      extra: {
        ...(metadata.extra && typeof metadata.extra === "object" ? metadata.extra : {}),
        source: "ems.slideDeck.v1",
        documentType: norm.documentType || norm.type || "deck",
      },
    },
    languages: [{ id: "en", name: "English", default: true }],
    sections,
    playOrder: sections.map((s) => ({ sectionId: s.id, enabled: true })),
    presentation: { defaultChunking: { mode: "blocksPerSlide", maxBlocks: 99 } },
    defaultRender: deckDefaultRender(norm),
  };
  return normalizeToSongAST(song);
}

function songDefaultRenderToDeckTheme(defaultRender = {}) {
  const render = defaultRender && typeof defaultRender === "object" ? defaultRender : {};
  const background = render.background && typeof render.background === "object" ? render.background : {};
  const fontSize = Number(render.fontSize);
  const minFontSize = Number(render.minFontSize);
  return {
    ...DEFAULT_DECK_THEME,
    ...(render.fontFamily ? { fontFamily: render.fontFamily } : {}),
    ...(Number.isFinite(fontSize) && fontSize > 0 ? { fontSize } : {}),
    ...(Number.isFinite(minFontSize) && minFontSize > 0 ? { minFontSize } : {}),
    ...(render.autosizeMode ? { autosizeMode: render.autosizeMode } : {}),
    ...(render.textColor || render.color ? { textColor: render.textColor || render.color } : {}),
    ...(background.color || render.backgroundColor ? { backgroundColor: background.color || render.backgroundColor } : {}),
    ...(background.path || render.backgroundPath ? { backgroundPath: background.path || render.backgroundPath } : {}),
  };
}

function songSectionOrder(song) {
  const sections = Array.isArray(song?.sections) ? song.sections : [];
  const byId = new Map(sections.map((section) => [section.id, section]));
  const ordered = [];
  const playOrder = Array.isArray(song?.playOrder) ? song.playOrder : [];
  for (const entry of playOrder) {
    const sectionId =
      typeof entry === "string"
        ? entry
        : typeof entry?.sectionId === "string"
          ? entry.sectionId
          : "";
    if (!sectionId || entry?.enabled === false) continue;
    const section = byId.get(sectionId);
    if (section && !ordered.includes(section)) ordered.push(section);
  }
  return ordered.length ? ordered : sections;
}

function cssUnitToFrameValue(value, fallback) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.endsWith("%")) {
      const n = Number.parseFloat(trimmed);
      return Number.isFinite(n) ? n / 100 : fallback;
    }
    const n = Number.parseFloat(trimmed);
    return Number.isFinite(n) ? (n > 1 ? n / 100 : n) : fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? (n > 1 ? n / 100 : n) : fallback;
}

function frameFromTextBoxPosition(position = {}, fallback = DEFAULT_TEXT_FRAME) {
  return normalizeFrame({
    x: cssUnitToFrameValue(position.left, fallback.x),
    y: cssUnitToFrameValue(position.top, fallback.y),
    width: cssUnitToFrameValue(position.width, fallback.width),
    height: cssUnitToFrameValue(position.height, fallback.height),
  });
}

function cloneBlocks(blocks, fallbackText = "") {
  const source = Array.isArray(blocks) && blocks.length ? blocks : textToSegmentsBlocks(fallbackText);
  try {
    return structuredClone(source);
  } catch {
    return JSON.parse(JSON.stringify(source));
  }
}

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined && entryValue !== null),
  );
}

function textLineCountFromBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return 1;
  return Math.max(1, blocks.filter((block) => block?.type === "lyricLine").length);
}

function importedSongTextFrame(section, explicitPosition = null) {
  if (explicitPosition) return frameFromTextBoxPosition(explicitPosition, DEFAULT_TEXT_FRAME);
  const lineCount = textLineCountFromBlocks(section?.blocks);
  if (lineCount >= 8) return { x: 0.04, y: 0.04, width: 0.92, height: 0.9 };
  if (lineCount >= 5) return { x: 0.05, y: 0.07, width: 0.9, height: 0.84 };
  return { x: 0.06, y: 0.14, width: 0.88, height: 0.72 };
}

function importedSongFontSize(section, theme) {
  const lineCount = textLineCountFromBlocks(section?.blocks);
  const base = Number(theme?.fontSize) || DEFAULT_DECK_THEME.fontSize;
  if (lineCount >= 8) return Math.min(base, 76);
  if (lineCount >= 5) return Math.min(base, 86);
  return base;
}

function deckObjectFromSongSlideObject(object, { fallbackText = "", fallbackFrame = DEFAULT_TEXT_FRAME, index = 0 } = {}) {
  if (!object || typeof object !== "object") return null;
  const kind = object.kind === "image" || object.kind === "shape" ? object.kind : "text";
  const base = {
    id: object.id || shortId("obj"),
    kind,
    frame: frameFromTextBoxPosition(object.textBoxPosition || {}, fallbackFrame),
    zIndex: Number.isFinite(object.zIndex) ? object.zIndex : index + 1,
    opacity: Number.isFinite(object.opacity) ? object.opacity : 1,
  };
  if (kind === "image") {
    const image = object.image && typeof object.image === "object" ? object.image : {};
    return {
      ...base,
      image: {
        path: typeof image.path === "string" ? image.path : "",
        ...(image.assetId ? { assetId: String(image.assetId) } : {}),
        fit: image.fit === "cover" || image.fit === "fill" ? image.fit : "contain",
      },
    };
  }
  if (kind === "shape") {
    const shape = object.shape && typeof object.shape === "object" ? object.shape : {};
    return {
      ...base,
      shape: {
        type: shape.type === "ellipse" || shape.type === "line" ? shape.type : "rect",
        fill: shape.fill || "#ffffff",
        ...(shape.stroke ? { stroke: shape.stroke } : {}),
        strokeWidth: Number.isFinite(shape.strokeWidth) ? shape.strokeWidth : 0,
        radius: Number.isFinite(shape.radius) ? shape.radius : 0,
      },
    };
  }
  return {
    ...base,
    role: object.role || "body",
    autofit: object.autofit || "fit",
    style: compactObject({
      color: object.color,
      fontFamily: object.fontFamily,
      fontSize: Number.isFinite(Number(object.fontSize)) ? Number(object.fontSize) : undefined,
      minFontSize: Number.isFinite(Number(object.minFontSize)) ? Number(object.minFontSize) : undefined,
      align: object.align,
      verticalAlign: object.verticalAlign,
      fontWeight: object.fontWeight,
      fontStyle: object.fontStyle,
      textDecoration: object.textDecoration,
      lineHeight: Number.isFinite(Number(object.lineHeight)) ? Number(object.lineHeight) : undefined,
    }),
    ...(object.background && typeof object.background === "object"
      ? { background: normalizeBackground(object.background) }
      : {}),
    blocks: cloneBlocks(object.blocks, fallbackText),
  };
}

export function songAstToDeck(song, { documentType = SONG_DECK_DOCUMENT_TYPE } = {}) {
  if (isSlideDeckDocument(song)) {
    return normalizeSlideDeck({
      ...song,
      documentType: song.documentType || documentType,
      ...(documentType === SONG_DECK_DOCUMENT_TYPE ? { type: SONG_DECK_DOCUMENT_TYPE } : {}),
    });
  }
  const ast = normalizeToSongAST(song);
  if (!ast) return null;
  const theme = songDefaultRenderToDeckTheme(ast.defaultRender || {});
  const defaultBackground = theme.backgroundPath
    ? {
        type: /\.(mp4|m4v|mov|mkv|webm)$/i.test(theme.backgroundPath) ? "video" : "image",
        color: theme.backgroundColor,
        path: theme.backgroundPath,
      }
    : { type: "color", color: theme.backgroundColor || DEFAULT_DECK_THEME.backgroundColor };
  const orderedSections = songSectionOrder(ast);
  const pages = orderedSections.map((section, index) => {
    const fallbackText = blocksToText(section.blocks || []);
    const fallbackFrame = importedSongTextFrame(section, ast.defaultRender?.textBoxPosition || null);
    const sourceObjects = Array.isArray(section.slideObjects) && section.slideObjects.length
      ? section.slideObjects
      : Array.isArray(section.slideTextObjects) && section.slideTextObjects.length
        ? section.slideTextObjects
        : null;
    const objects = sourceObjects
      ? sourceObjects
          .map((object, objectIndex) =>
            deckObjectFromSongSlideObject(object, {
              fallbackText,
              fallbackFrame,
              index: objectIndex,
            }),
          )
          .filter(Boolean)
      : [
          createTextObject({
            text: "",
            frame: fallbackFrame,
            style: {
              fontFamily: theme.fontFamily,
              fontSize: importedSongFontSize(section, theme),
              minFontSize: theme.minFontSize,
              color: theme.textColor,
              align: "center",
              verticalAlign: "center",
            },
            zIndex: 1,
          }),
        ];
    if (!sourceObjects && objects[0]) {
      objects[0].blocks = cloneBlocks(section.blocks, "");
    }
    return {
      id: section.id || shortId("page"),
      label: section.label || `Slide ${index + 1}`,
      kind: section.kind || "verse",
      durationMs: 0,
      autoAdvance: false,
      background: { ...defaultBackground },
      notes: "",
      objects,
    };
  });
  return normalizeSlideDeck({
    schema: EMS_SLIDE_DECK_SCHEMA_ID,
    id: ast.id,
    title: ast.title,
    folderId: ast.folderId || null,
    documentType,
    ...(documentType === SONG_DECK_DOCUMENT_TYPE ? { type: SONG_DECK_DOCUMENT_TYPE } : {}),
    ...(Number.isFinite(ast.songNumber) && ast.songNumber > 0 ? { songNumber: ast.songNumber } : {}),
    metadata: structuredClone(ast.metadata || {}),
    canvas: DEFAULT_CANVAS,
    theme,
    pages,
  });
}

export function deckDefaultRender(deck) {
  const norm = normalizeSlideDeck(deck) || deck || {};
  const theme = norm.theme || DEFAULT_DECK_THEME;
  return {
    backgroundColor: theme.backgroundColor || DEFAULT_DECK_THEME.backgroundColor,
    backgroundPath: theme.backgroundPath || "",
    color: theme.textColor || DEFAULT_DECK_THEME.textColor,
    fontFamily: theme.fontFamily || DEFAULT_DECK_THEME.fontFamily,
    fontSize: Number.isFinite(theme.fontSize) ? theme.fontSize : DEFAULT_DECK_THEME.fontSize,
    autosizeMode: theme.autosizeMode || "fit",
    minFontSize: Number.isFinite(theme.minFontSize) ? theme.minFontSize : DEFAULT_DECK_THEME.minFontSize,
  };
}

/**
 * Per-page render overrides (background image / color from the page).
 *
 * @returns {{backgroundColor?:string, backgroundPath?:string, color?:string, fontFamily?:string, fontSize?:number, autosizeMode?:string, minFontSize?:number}}
 */
export function pageRenderOverrides(page, deck) {
  const norm = normalizeSlideDeck(deck) || {};
  const theme = norm.theme || DEFAULT_DECK_THEME;
  const textObject = primaryTextObject(page);
  const textStyle =
    textObject?.style && typeof textObject.style === "object" ? textObject.style : {};
  const textFontSize = Number(textStyle.fontSize);
  const bg = page?.background || null;
  const overrides = {
    color: textStyle.color || theme.textColor || DEFAULT_DECK_THEME.textColor,
    fontFamily: textStyle.fontFamily || theme.fontFamily || DEFAULT_DECK_THEME.fontFamily,
    fontSize: Number.isFinite(textFontSize)
      ? textFontSize
      : Number.isFinite(theme.fontSize)
        ? theme.fontSize
        : DEFAULT_DECK_THEME.fontSize,
    autosizeMode: theme.autosizeMode || "fit",
    minFontSize: Number.isFinite(theme.minFontSize) ? theme.minFontSize : DEFAULT_DECK_THEME.minFontSize,
  };
  if (textObject?.frame) {
    overrides.textBoxPosition = frameToTextBoxPosition(textObject.frame);
  }
  if (bg && bg.type === "color") {
    overrides.backgroundColor = bg.color || theme.backgroundColor;
    overrides.backgroundPath = "";
  } else if (bg && (bg.type === "image" || bg.type === "video") && bg.path) {
    overrides.backgroundColor = theme.backgroundColor;
    overrides.backgroundPath = bg.path;
  } else {
    overrides.backgroundColor = theme.backgroundColor;
    overrides.backgroundPath = theme.backgroundPath || "";
  }
  return overrides;
}

/**
 * Find a page by id. Returns null if not found.
 * @param {object} deck
 * @param {string} pageId
 */
export function findPage(deck, pageId) {
  if (!deck || !Array.isArray(deck.pages) || !pageId) return null;
  return deck.pages.find((p) => p.id === pageId) || null;
}

/**
 * Replace the body text of the first text object on a page (creates one if missing).
 *
 * @param {object} page
 * @param {string} text
 */
export function setPagePrimaryText(page, text) {
  if (!page) return;
  if (!Array.isArray(page.objects)) page.objects = [];
  let obj = page.objects.find((o) => o && o.kind === "text");
  if (!obj) {
    obj = createTextObject({ text });
    page.objects.push(obj);
  } else {
    obj.blocks = textToSegmentsBlocks(text);
  }
}

/**
 * Get the primary text object's text for editing (first text object).
 */
export function getPagePrimaryText(page) {
  if (!page || !Array.isArray(page.objects)) return "";
  const obj = page.objects.find((o) => o && o.kind === "text");
  return obj ? blocksToText(obj.blocks) : "";
}
