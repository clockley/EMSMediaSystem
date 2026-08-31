let currentWorkspaceSong = null;
let currentWorkspaceSongDeck = null;
let currentEditingSongId = null;
let currentSongRenderState = { ...DEFAULT_SONG_RENDER };
let currentSongSectionId = null;
let currentSongSequenceEntryId = null;
let currentSongSlideId = null;
let currentSongQueueItem = null;
let currentSongThemeEditingContext = null;
let currentSongFolderFilter = "__all__";
let songFoldersCache = [];
let selectedSongIds = new Set();
let songsBulkDeleteArmed = false;
let songSlideNavigatorRenderToken = 0;
let songPreviewRenderToken = 0;
let songPreviewRerenderRaf = 0;
let songLibraryClickTimer = null;
let deckPageClickTimer = null;

const SONG_PREVIEW_OUTPUT_WIDTH = 1920;
const SONG_PREVIEW_OUTPUT_HEIGHT = 1080;
const SONG_FOLDER_ALL = "__all__";
const SONG_FOLDER_UNFILED = "__unfiled__";

function asSongArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatSongListLabel(song) {
  const authorSuffix = song.author ? ` (${song.author})` : "";
  return `${song.title || "Untitled Song"}${authorSuffix}`;
}

function formatSongListNumber(song) {
  return Number.isFinite(song.songNumber) && song.songNumber > 0 ? `#${song.songNumber}` : "";
}

function songFontFamilyCSS(fontFamily = DEFAULT_SONG_RENDER.fontFamily) {
  const family = String(fontFamily || DEFAULT_SONG_RENDER.fontFamily).trim();
  if (!family) return `${DEFAULT_SONG_RENDER.fontFamily}, sans-serif`;
  return family.includes(",") ? family : `${family}, sans-serif`;
}

function songDeckDocumentFromSongDocument(document, render = currentSongRenderState) {
  if (!document) return null;
  const deck = isSlideDeckDocument(document)
    ? normalizeSlideDeck({
        ...document,
        documentType: document.documentType || SONG_DECK_DOCUMENT_TYPE,
        type: SONG_DECK_DOCUMENT_TYPE,
      })
    : songAstToDeck(normalizeToSongAST(document), { documentType: SONG_DECK_DOCUMENT_TYPE });
  if (!deck) return null;
  deck.documentType = SONG_DECK_DOCUMENT_TYPE;
  deck.type = SONG_DECK_DOCUMENT_TYPE;
  if (render && typeof render === "object") {
    deck.theme = {
      ...(deck.theme || DEFAULT_DECK_THEME),
      ...(render.fontFamily ? { fontFamily: render.fontFamily } : {}),
      ...(Number.isFinite(Number(render.fontSize)) ? { fontSize: Number(render.fontSize) } : {}),
      ...(Number.isFinite(Number(render.minFontSize)) ? { minFontSize: Number(render.minFontSize) } : {}),
      ...(render.autosizeMode ? { autosizeMode: render.autosizeMode } : {}),
      ...(render.color ? { textColor: render.color } : {}),
      ...(render.backgroundColor ? { backgroundColor: render.backgroundColor } : {}),
      ...(render.backgroundPath ? { backgroundPath: render.backgroundPath } : {}),
    };
  }
  return normalizeSlideDeck(deck);
}

function songDeckWithResolvedTheme(deck, resolvedTheme) {
  if (!deck || !resolvedTheme) return deck;
  const typography = resolvedTheme.typography || {};
  const background = resolvedTheme.canvas?.background || {};
  const textFrame = resolvedTheme.textFrame || DEFAULT_TEXT_FRAME;
  const backdrop = resolvedTheme.backdrop || {};
  const themed = structuredClone(deck);
  themed.theme = {
    ...(themed.theme || DEFAULT_DECK_THEME),
    fontFamily: typography.fontFamily || DEFAULT_DECK_THEME.fontFamily,
    fontSize: Number(typography.fontSize) || DEFAULT_DECK_THEME.fontSize,
    minFontSize: Number(typography.minFontSize) || DEFAULT_DECK_THEME.minFontSize,
    autosizeMode: typography.autosizeMode || "fit",
    textColor: typography.color || typography.fontColor || DEFAULT_DECK_THEME.textColor,
    backgroundColor: background.color || DEFAULT_DECK_THEME.backgroundColor,
    align: typography.align || "center",
    verticalAlign: typography.verticalAlign || "center",
    fontWeight: typography.fontWeight || 700,
    fontStyle: typography.fontStyle || "normal",
    lineHeight: Number(typography.lineHeight) || 1.18,
    textFrame: { ...textFrame },
    backdrop: structuredClone(backdrop),
    transition: structuredClone(resolvedTheme.transition || {}),
  };
  for (const page of themed.pages || []) {
    page.background = background.type === "image" || background.type === "video"
      ? { type: background.type, color: background.color || "#000000", path: background.path || background.url || "", ...(background.assetId ? { assetId: background.assetId } : {}) }
      : { type: "color", color: background.color || DEFAULT_DECK_THEME.backgroundColor };
    if (resolvedTheme.transition) page.transition = {
      effect: resolvedTheme.transition.type || "none",
      durationMs: resolvedTheme.transition.durationMs || 0,
    };
    for (const object of page.objects || []) {
      if (object.kind !== "text") continue;
      clearTextObjectInlineStyles(object);
      object.frame = { ...textFrame };
      object.autofit = typography.autosizeMode || "fit";
      object.style = {
        ...(object.style || {}),
        fontFamily: themed.theme.fontFamily,
        fontSize: themed.theme.fontSize,
        minFontSize: themed.theme.minFontSize,
        color: themed.theme.textColor,
        align: themed.theme.align,
        verticalAlign: themed.theme.verticalAlign,
        fontWeight: themed.theme.fontWeight,
        fontStyle: themed.theme.fontStyle,
        lineHeight: themed.theme.lineHeight,
      };
      object.background = backdrop.enabled
        ? { type: "color", color: backdrop.background?.color || "#101010" }
        : null;
    }
  }
  return normalizeSlideDeck(themed);
}

function itemThemeProfileFromSongDeck(deck, baseProfile = {}) {
  const theme = deck?.theme || {};
  const firstText = deck?.pages?.flatMap(page => page.objects || []).find(object => object.kind === "text");
  const style = firstText?.style || {};
  const frame = firstText?.frame || theme.textFrame || DEFAULT_TEXT_FRAME;
  const pageBackground = deck?.pages?.[0]?.background || {};
  return {
    ...structuredClone(baseProfile || {}),
    typography: {
      ...(baseProfile.typography || {}),
      fontFamily: theme.fontFamily,
      fontSize: Number(theme.fontSize),
      minFontSize: Number(theme.minFontSize),
      autosizeMode: theme.autosizeMode || firstText?.autofit || "fit",
      color: theme.textColor,
      align: style.align || theme.align || "center",
      verticalAlign: style.verticalAlign || theme.verticalAlign || "center",
      fontWeight: style.fontWeight || theme.fontWeight || 700,
      fontStyle: style.fontStyle || theme.fontStyle || "normal",
      lineHeight: Number(style.lineHeight || theme.lineHeight) || 1.18,
    },
    canvas: {
      ...(baseProfile.canvas || {}),
      background: { ...(baseProfile.canvas?.background || {}), ...pageBackground },
    },
    textFrame: { ...frame },
    backdrop: structuredClone(theme.backdrop || baseProfile.backdrop || {}),
    transition: (() => {
      const transition = deck?.pages?.[0]?.transition || theme.transition || baseProfile.transition || {};
      return { type: transition.type || transition.effect || "none", durationMs: Number(transition.durationMs) || 0 };
    })(),
  };
}

function transientSongFromSongDocument(document) {
  if (!document) return null;
  if (isSlideDeckDocument(document)) {
    return deckToTransientSong(document);
  }
  return normalizeToSongAST(document);
}

function songRenderStateFromSongDocument(document) {
  if (isSlideDeckDocument(document)) {
    return mergeSongRenderState(DEFAULT_SONG_RENDER, deckDefaultRender(document));
  }
  return document?.defaultRender
    ? songRenderStateFromDefaultRender(document.defaultRender)
    : mergeSongRenderState();
}

function buildSongQueueEntryFromDeck({
  deck,
  render = currentSongRenderState,
  currentSectionId = currentSongSectionId,
  sourceKind = "library",
} = {}) {
  const canonicalDeck = songDeckDocumentFromSongDocument(deck, render);
  if (!canonicalDeck) return null;
  const transientSong = deckToTransientSong(canonicalDeck);
  if (!transientSong) return null;
  const pageId = currentSectionId || canonicalDeck.pages?.[0]?.id || transientSong.sections?.[0]?.id || null;
  const page = findPage(canonicalDeck, pageId);
  const pageRender = {
    ...deckDefaultRender(canonicalDeck),
    ...definedSongQueueRenderValues(render),
    // A page is the most specific visual scope. Theme/song defaults must not
    // replace a color, media background, text frame, or transition explicitly
    // edited on this slide.
    ...pageRenderOverrides(page, canonicalDeck),
  };
  const entry = queueEntryFromSong({
    song: transientSong,
    render: pageRender,
    currentSectionId: pageId,
  });
  entry.type = "song";
  entry.path = songQueuePath(canonicalDeck.id);
  entry.name = canonicalDeck.title || "Song";
  entry.source = {
    kind: sourceKind,
    songId: canonicalDeck.id,
    pageId,
  };
  entry.deckSnapshot = canonicalDeck;
  const transitionOverride = normalizeItemSlideTransitionOverride(page?.transition || render?.transition);
  if (transitionOverride) entry.transition = transitionOverride;
  return entry;
}

function definedSongQueueRenderValues(render = {}) {
  if (!render || typeof render !== "object") return {};
  const keys = [
    "backgroundColor",
    "backgroundPath",
    "color",
    "fontFamily",
    "fontFamilyOverride",
    "fontSize",
    "autosizeMode",
    "minFontSize",
    "copyrightPlacement",
    "textBoxPosition",
    "copyright",
    "ccliNumber",
    "oneLicense",
    "transition",
  ];
  const values = {};
  for (const key of keys) {
    if (render[key] !== undefined) values[key] = render[key];
  }
  return values;
}

function songSectionsFromParsedSections(sections) {
  return normalizeToSongAST({
    id: "editor_song",
    title: "Editor Song",
    metadata: {},
    sections: Array.isArray(sections) ? sections : [],
  })?.sections || [];
}

function songEditorTextFromSections(sections) {
  const parts = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    const label = (section.label || "").trim();
    parts.push(label ? `[${label}]` : "");
    for (const text of songSectionBlockTexts(section)) {
      parts.push(text.trim() === "" ? "" : text);
    }
    parts.push("");
  }
  return parts.join("\n").trim();
}

function renderSongBlocksIntoPreview(preview, blocks, color = "#ffffff", textBoxPosition = null) {
  preview.innerHTML = "";
  const container = document.createElement("div");
  container.className = "song-preview-text-box";
  if (textBoxPosition) {
    container.style.position = "absolute";
    container.style.left = textBoxPosition.left || "10%";
    container.style.top = textBoxPosition.top || "10%";
    container.style.width = textBoxPosition.width || "80%";
    container.style.height = textBoxPosition.height || "80%";
  }
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.alignItems = "center";
  container.style.justifyContent = "center";
  container.style.pointerEvents = "none";

  const astBlocks = Array.isArray(blocks) ? blocks : [];
  for (const block of astBlocks) {
    const lineEl = document.createElement("div");
    if (typeof block?.id === "string" && block.id) {
      lineEl.dataset.songBlockId = block.id;
    }
    const text = block?.type === "lyricLine"
      ? block.primary?.segments?.map((segment) => segment?.text || "").join("") || ""
      : "";
    lineEl.className = text.trim() === ""
      ? "song-preview-block song-preview-block--spacer"
      : "song-preview-block";
    lineEl.style.color = color;
    if (text.trim() === "") {
      lineEl.innerHTML = "&nbsp;";
    } else {
      const segments = Array.isArray(block.primary?.segments) ? block.primary.segments : [];
      for (const segment of segments) {
        const span = document.createElement("span");
        span.textContent = segment?.text || "";
        applySongSegmentStyleToElement(span, segment?.style);
        lineEl.appendChild(span);
      }
    }
    container.appendChild(lineEl);
  }
  preview.appendChild(container);
}

function renderSlideObjectsIntoPreview(preview, objects, message = {}) {
  preview.innerHTML = "";
  const previewScale = Math.max(preview.clientWidth || 1920, 1) / 1920;
  const orderedObjects = (Array.isArray(objects) ? objects : [])
    .map((object, index) => ({ object, index }))
    .sort((a, b) => {
      const az = Number.isFinite(a.object?.zIndex) ? a.object.zIndex : 0;
      const bz = Number.isFinite(b.object?.zIndex) ? b.object.zIndex : 0;
      return az === bz ? a.index - b.index : az - bz;
    })
    .map(({ object }) => object);
  for (const object of orderedObjects) {
    if (!object) continue;
    const kind = object?.kind === "image" || object?.kind === "shape" ? object.kind : "text";
    const position = object?.textBoxPosition || {};
    const box = document.createElement("div");
    box.className = `song-preview-slide-object song-preview-slide-object--${kind}`;
    if (kind === "text") box.classList.add("song-preview-text-box");
    box.style.position = "absolute";
    box.style.left = position.left || "10%";
    box.style.top = position.top || "10%";
    box.style.width = position.width || "80%";
    box.style.height = position.height || "80%";
    box.style.overflow = "hidden";
    box.style.pointerEvents = "none";
    box.style.zIndex = String(Number.isFinite(object.zIndex) ? object.zIndex : 0);
    box.style.opacity = String(clampSlideOpacity(object.opacity, 1));

    if (kind === "image") {
      const image = object.image && typeof object.image === "object" ? object.image : {};
      const src = image.imageUrl || image.url || (image.path ? pathToUrlSafe(image.path) : "");
      if (src) {
        const img = document.createElement("img");
        img.className = "song-preview-slide-object__image";
        img.src = src;
        img.alt = "";
        img.draggable = false;
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.display = "block";
        img.style.objectFit = image.fit === "cover" || image.fit === "fill" ? image.fit : "contain";
        box.appendChild(img);
      }
      preview.appendChild(box);
      continue;
    }

    if (kind === "shape") {
      const shape = object.shape && typeof object.shape === "object" ? object.shape : {};
      const shapeEl = document.createElement("div");
      shapeEl.className = "song-preview-slide-object__shape";
      shapeEl.style.position = "absolute";
      shapeEl.style.inset = "0";
      if (shape.type === "ellipse") {
        shapeEl.style.borderRadius = "999px";
      } else if (Number.isFinite(shape.radius) && shape.radius > 0) {
        shapeEl.style.borderRadius = `${shape.radius}px`;
      }
      shapeEl.style.backgroundColor = shape.type === "line" ? "transparent" : (shape.fill || "#ffffff");
      if (shape.stroke || Number.isFinite(shape.strokeWidth)) {
        const strokeWidth = Number.isFinite(shape.strokeWidth) ? shape.strokeWidth : 1;
        shapeEl.style.border = `${strokeWidth}px solid ${shape.stroke || shape.fill || "#ffffff"}`;
      }
      if (shape.type === "line") {
        const strokeWidth = Number.isFinite(shape.strokeWidth) && shape.strokeWidth > 0 ? shape.strokeWidth : 4;
        shapeEl.style.inset = "50% 0 auto 0";
        shapeEl.style.height = "0";
        shapeEl.style.border = "none";
        shapeEl.style.borderTop = `${strokeWidth}px solid ${shape.stroke || shape.fill || "#ffffff"}`;
      }
      box.appendChild(shapeEl);
      preview.appendChild(box);
      continue;
    }

    box.style.display = "flex";
    box.style.flexDirection = "column";
    box.style.justifyContent =
      object.verticalAlign === "top"
        ? "flex-start"
        : object.verticalAlign === "bottom"
          ? "flex-end"
          : "center";
    box.style.alignItems =
      object.align === "left" ? "flex-start" : object.align === "right" ? "flex-end" : "center";
    box.style.textAlign = object.align || "center";
    box.style.color = object.color || message.color || "#ffffff";
    box.style.fontFamily = songFontFamilyCSS(object.fontFamily || message.fontFamily);
    box.style.fontWeight = object.fontWeight || message.fontWeight || "";
    box.style.fontStyle = object.fontStyle || "";
    box.style.textDecoration = object.textDecoration || "";
    const objectFontSize = Math.max(
      12,
      (Number(object.fontSize) || Number(message.fontSize) || DEFAULT_SONG_RENDER.fontSize) * previewScale,
    );
    box.style.fontSize = `${objectFontSize}px`;
    box.style.lineHeight = object.lineHeight || message.lineHeight || SCRIPTURE_LINE_HEIGHT;

    const bg = object.background && typeof object.background === "object" ? object.background : null;
    if (bg?.type === "color") {
      box.style.backgroundColor = bg.color || "transparent";
    } else if (bg?.backgroundVideo || (bg?.path && bg.type === "video")) {
      const videoEl = document.createElement("video");
      videoEl.src = bg.backgroundVideo || pathToUrlSafe(bg.path);
      videoEl.autoplay = true;
      videoEl.loop = true;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.style.position = "absolute";
      videoEl.style.inset = "0";
      videoEl.style.width = "100%";
      videoEl.style.height = "100%";
      videoEl.style.objectFit = "cover";
      videoEl.style.zIndex = "0";
      box.appendChild(videoEl);
      void videoEl.play().catch(() => {});
    } else if (bg?.backgroundImage || bg?.path) {
      box.style.backgroundImage = `url('${bg.backgroundImage || pathToUrlSafe(bg.path)}')`;
      box.style.backgroundSize = "cover";
      box.style.backgroundPosition = "center";
    }

    const content = document.createElement("div");
    content.style.position = "relative";
    content.style.zIndex = "1";
    content.style.width = "100%";
    for (const block of Array.isArray(object.blocks) ? object.blocks : []) {
      const lineEl = document.createElement("div");
      lineEl.className = "song-preview-block";
      if (typeof block?.id === "string" && block.id) {
        lineEl.dataset.songBlockId = block.id;
      }
      const segments = block?.type === "lyricLine" && Array.isArray(block.primary?.segments)
        ? block.primary.segments
        : [];
      if (!segments.length || segments.every((segment) => !segment?.text?.trim())) {
        lineEl.classList.add("song-preview-block--spacer");
        lineEl.textContent = "\u00a0";
      } else {
        for (const segment of segments) {
          const span = document.createElement("span");
          span.textContent = segment?.text || "";
          applySongSegmentStyleToElement(span, segment?.style);
          lineEl.appendChild(span);
        }
      }
      content.appendChild(lineEl);
    }
    box.appendChild(content);
    preview.appendChild(box);
    fitTextElementToBox(box, content, {
      baseSize: objectFontSize,
      minSize: Math.max(
        8,
        (Number(object.minFontSize) || Number(message.minFontSize) || DEFAULT_SONG_RENDER.minFontSize) * previewScale,
      ),
      mode: object.autofit || message.autosizeMode || "fit",
    });
  }
}

function renderSongCopyrightIntoPreview(preview, copyrightText) {
  if (!preview) return;
  const text = String(copyrightText || "").trim();
  let copyright = preview.querySelector(".song-copyright-overlay");
  if (!text) {
    copyright?.remove();
    return;
  }
  if (!copyright) {
    copyright = document.createElement("div");
    copyright.className = "song-copyright-overlay";
  }
  copyright.textContent = text;
  preview.appendChild(copyright);
}

function renderResolvedSongMessageIntoPreview(preview, message = {}, { fontSize } = {}) {
  if (!preview) return;
  const outputFontSize = Number(message.fontSize) || DEFAULT_SONG_RENDER.fontSize;
  const renderedFontSize = Number(fontSize) || outputFontSize;
  const backgroundImage =
    message.backgroundImage ||
    (message.backgroundPath ? pathToUrlSafe(message.backgroundPath) : "");
  preview.style.backgroundColor = message.backgroundColor || "#000000";
  preview.style.backgroundImage = backgroundImage
    ? `url('${backgroundImage}')`
    : "";
  preview.style.setProperty("--base-font-size", outputFontSize);
  preview.style.setProperty("--song-preview-font-size", `${renderedFontSize}px`);
  preview.style.setProperty(
    "--font-family",
    songFontFamilyCSS(message.fontFamily || DEFAULT_SONG_RENDER.fontFamily),
  );
  preview.style.setProperty("--song-preview-font-weight", String(message.fontWeight || 700));
  preview.style.setProperty("--song-preview-font-style", message.fontStyle || "normal");
  preview.style.setProperty("--song-preview-line-height", String(message.lineHeight || 1.35));

  const slideObjects = Array.isArray(message.slideObjects) && message.slideObjects.length > 0
    ? message.slideObjects
    : Array.isArray(message.slideTextObjects)
      ? message.slideTextObjects
      : [];
  if (slideObjects.length > 0) {
    renderSlideObjectsIntoPreview(preview, slideObjects, message);
  } else {
    renderSongBlocksIntoPreview(
      preview,
      message.blocks,
      message.color || "#ffffff",
      message.textBoxPosition || null,
    );
  }

  if (message.referenceText) {
    const reference = document.createElement("div");
    reference.className = "song-preview-reference";
    reference.style.color = message.referenceColor || message.color || "#ffffff";
    reference.textContent = message.referenceText;
    preview.appendChild(reference);
  }
  if (message.attributionText) {
    const attribution = document.createElement("div");
    attribution.className = "song-preview-attribution";
    attribution.textContent = message.attributionText;
    preview.appendChild(attribution);
  }
  renderSongCopyrightIntoPreview(preview, message.copyrightText);
}

function textStyleFromSegment(segment) {
  const style = segment?.style && typeof segment.style === "object" ? segment.style : {};
  const normalized = {};
  if (typeof style.color === "string" && style.color.trim()) normalized.color = style.color.trim();
  if (typeof style.fontFamily === "string" && style.fontFamily.trim()) normalized.fontFamily = style.fontFamily.trim();
  if (Number.isFinite(Number(style.fontSize)) && Number(style.fontSize) > 0) {
    normalized.fontSize = Number(style.fontSize);
  }
  if (typeof style.backgroundColor === "string" && style.backgroundColor.trim()) {
    normalized.backgroundColor = style.backgroundColor.trim();
  }
  if (typeof style.fontWeight === "string" && style.fontWeight.trim()) {
    normalized.fontWeight = style.fontWeight.trim();
  } else if (Number.isFinite(Number(style.fontWeight))) {
    normalized.fontWeight = String(Number(style.fontWeight));
  }
  if (typeof style.fontStyle === "string" && style.fontStyle.trim()) {
    normalized.fontStyle = style.fontStyle.trim();
  }
  if (typeof style.textDecoration === "string" && style.textDecoration.trim()) {
    normalized.textDecoration = style.textDecoration.trim();
  }
  return normalized;
}

function mergeSongSegmentStyle(baseStyle = {}, overrideStyle = {}) {
  const merged = { ...textStyleFromSegment({ style: baseStyle }) };
  const override = textStyleFromSegment({ style: overrideStyle });
  for (const [key, value] of Object.entries(override)) {
    if (value == null || value === "") {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function sameSongSegmentStyle(a = {}, b = {}) {
  const left = textStyleFromSegment({ style: a });
  const right = textStyleFromSegment({ style: b });
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left[key] || "") !== (right[key] || "")) return false;
  }
  return true;
}

function applySongSegmentStyleToElement(el, style = {}) {
  if (!el) return;
  const normalized = textStyleFromSegment({ style });
  if (normalized.color) el.style.color = normalized.color;
  if (normalized.fontFamily) el.style.fontFamily = songFontFamilyCSS(normalized.fontFamily);
  if (normalized.fontSize) el.style.fontSize = `${normalized.fontSize}px`;
  if (normalized.backgroundColor) el.style.backgroundColor = normalized.backgroundColor;
  if (normalized.fontWeight) el.style.fontWeight = normalized.fontWeight;
  if (normalized.fontStyle) el.style.fontStyle = normalized.fontStyle;
  if (normalized.textDecoration) el.style.textDecoration = normalized.textDecoration;
}

function normalizeSongSegments(segments = []) {
  const merged = [];
  for (const segment of Array.isArray(segments) ? segments : []) {
    const text = typeof segment?.text === "string" ? segment.text : "";
    if (!text) continue;
    const style = textStyleFromSegment(segment);
    const normalized = {
      type: segment?.type || "text",
      text,
      ...(Object.keys(style).length > 0 ? { style } : {}),
    };
    const previous = merged[merged.length - 1];
    if (previous && previous.type === normalized.type && sameSongSegmentStyle(previous.style, normalized.style)) {
      previous.text += normalized.text;
    } else {
      merged.push(normalized);
    }
  }
  return merged;
}

function applySongStyleToBlockRange(block, start, end, style) {
  if (!block || block.type !== "lyricLine" || !Array.isArray(block.primary?.segments)) return block;
  if (end <= start) return block;

  const nextSegments = [];
  let offset = 0;
  for (const segment of block.primary.segments) {
    const text = typeof segment?.text === "string" ? segment.text : "";
    const segmentStart = offset;
    const segmentEnd = segmentStart + text.length;
    offset = segmentEnd;

    if (!text || end <= segmentStart || start >= segmentEnd) {
      nextSegments.push(segment);
      continue;
    }

    const localStart = Math.max(0, start - segmentStart);
    const localEnd = Math.min(text.length, end - segmentStart);
    if (localStart > 0) {
      nextSegments.push({ ...segment, text: text.slice(0, localStart) });
    }
    const styledText = text.slice(localStart, localEnd);
    if (styledText) {
      const nextStyle = mergeSongSegmentStyle(segment.style, style);
      nextSegments.push({
        ...segment,
        text: styledText,
        ...(Object.keys(nextStyle).length > 0 ? { style: nextStyle } : {}),
      });
    }
    if (localEnd < text.length) {
      nextSegments.push({ ...segment, text: text.slice(localEnd) });
    }
  }

  return {
    ...block,
    primary: {
      ...(block.primary || {}),
      segments: normalizeSongSegments(nextSegments),
    },
  };
}

function applySongStyleToWholeBlock(block, style) {
  const text = songBlockText(block);
  return applySongStyleToBlockRange(block, 0, text.length, style);
}

function applySongStyleToSectionRange(section, start, end, style) {
  if (!section || !Array.isArray(section.blocks)) return section;
  let offset = 0;
  return {
    ...section,
    blocks: section.blocks.map((block, blockIndex) => {
      const blockText = songBlockText(block);
      const blockStart = offset;
      const blockEnd = blockStart + blockText.length;
      offset = blockEnd + (blockIndex < section.blocks.length - 1 ? 1 : 0);
      if (end <= blockStart || start >= blockEnd) return block;
      return applySongStyleToBlockRange(
        block,
        Math.max(0, start - blockStart),
        Math.min(blockText.length, end - blockStart),
        style,
      );
    }),
  };
}

function applySongStyleToWholeSection(section, style) {
  if (!section || !Array.isArray(section.blocks)) return section;
  return {
    ...section,
    blocks: section.blocks.map((block) => applySongStyleToWholeBlock(block, style)),
  };
}

function currentSongEditorStyleScope() {
  const scope = document.getElementById("songEditorStyleScope")?.value;
  return scope === "selection" || scope === "page" || scope === "allSlides" ? scope : "allSlides";
}

function setSongEditorStyleScope(scope) {
  const select = document.getElementById("songEditorStyleScope");
  if (select && (scope === "selection" || scope === "page" || scope === "allSlides")) {
    select.value = scope;
  }
}

function selectedSongEditorTextRange(textarea) {
  const savedPos = saveSongEditorCursorPosition(textarea);
  if (!savedPos) return null;
  let { start, end } = savedPos;
  if (start !== end) return { start: Math.min(start, end), end: Math.max(start, end) };
  const value = textarea.innerText || textarea.textContent || "";
  if (!value) return null;
  if (start < value.length && value[start] !== "\n") return { start, end: start + 1 };
  if (start > 0 && value[start - 1] !== "\n") return { start: start - 1, end: start };
  return null;
}

function updateSongEditorSection(index, section) {
  if (index < 0 || index >= songEditorSections.length || !section) return;
  songEditorSections[index] = section;
  if (currentWorkspaceSong) {
    currentWorkspaceSong.sections = songEditorSections;
  }
}

function saveSongEditorCursorPosition(contentEditableEl) {
  const selection = window.getSelection();
  if (!selection.rangeCount || !contentEditableEl.contains(selection.anchorNode)) return null;
  
  const range = selection.getRangeAt(0);
  let start = 0, end = 0, currentOffset = 0;
  let foundStart = false, foundEnd = false;

  const walk = (node) => {
    if (foundEnd) return;
    if (node.nodeType === 3) {
      if (!foundStart && range.startContainer === node) { start = currentOffset + range.startOffset; foundStart = true; }
      if (!foundEnd && range.endContainer === node) { end = currentOffset + range.endOffset; foundEnd = true; }
      currentOffset += node.textContent.length;
    } else if (node.nodeType === 1) {
      for (let i = 0; i < node.childNodes.length; i++) {
        if (!foundStart && range.startContainer === node && range.startOffset === i) { start = currentOffset; foundStart = true; }
        if (!foundEnd && range.endContainer === node && range.endOffset === i) { end = currentOffset; foundEnd = true; }
        walk(node.childNodes[i]);
      }
      if (!foundStart && range.startContainer === node && range.startOffset === node.childNodes.length) { start = currentOffset; foundStart = true; }
      if (!foundEnd && range.endContainer === node && range.endOffset === node.childNodes.length) { end = currentOffset; foundEnd = true; }
      
      if ((node.tagName === "DIV" || node.tagName === "P") && node.nextSibling) {
        currentOffset += 1;
      }
    }
  };

  walk(contentEditableEl);
  if (!foundStart) start = currentOffset;
  if (!foundEnd) end = start;
  return { start, end };
}

function restoreSongEditorCursorPosition(contentEditableEl, savedPosition) {
  if (!savedPosition) return;
  const { start, end } = savedPosition;
  let currentOffset = 0;
  const range = document.createRange();
  range.setStart(contentEditableEl, 0);
  range.collapse(true);
  
  let foundStart = false, foundEnd = false;

  const walk = (node) => {
    if (foundEnd) return;
    if (node.nodeType === 3) {
      const len = node.textContent.length;
      if (!foundStart && start >= currentOffset && start <= currentOffset + len) {
        range.setStart(node, start - currentOffset);
        foundStart = true;
      }
      if (foundStart && !foundEnd && end >= currentOffset && end <= currentOffset + len) {
        range.setEnd(node, end - currentOffset);
        foundEnd = true;
      }
      currentOffset += len;
    } else if (node.nodeType === 1) {
      for (const child of node.childNodes) walk(child);
      if ((node.tagName === "DIV" || node.tagName === "P") && node.nextSibling) {
        currentOffset += 1;
      }
    }
  };
  
  walk(contentEditableEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function refreshSongEditorAfterStyleChange() {
  syncSongEditorHiddenTextarea();
  if (currentWorkspaceSong) {
    currentWorkspaceSongDeck = songDeckDocumentFromSongDocument(
      currentWorkspaceSong,
      currentSongRenderState,
    );
    slideThumbnailCache.clear();
    syncSongSlideNavigator();
  }
  const activeSection = songEditorSections[songEditorActiveIndex];
  if (activeSection) {
    renderSongSectionPreview(activeSection);
    void syncActiveScheduledSongPresentation().catch(console.error);
  }
  renderSongEditorSlideList();
  const textarea = document.getElementById("songEditorSlideTextarea");
  if (textarea && activeSection) {
    const savedPos = saveSongEditorCursorPosition(textarea);
    populateSongEditorTextarea(textarea, activeSection);
    restoreSongEditorCursorPosition(textarea, savedPos);
  }
}

function populateSongEditorTextarea(textarea, section) {
  if (!textarea || !section) return;
  textarea.innerHTML = "";
  const blocks = Array.isArray(section.blocks) ? section.blocks : [];
  for (const block of blocks) {
    const lineEl = document.createElement("div");
    lineEl.dataset.blockId = block.id;
    if (block.type === "spacer" || !block.primary?.segments?.length) {
      lineEl.innerHTML = "<br>";
    } else {
      for (const segment of block.primary.segments) {
        const span = document.createElement("span");
        span.textContent = segment.text || "";
        applySongSegmentStyleToElement(span, segment.style);
        lineEl.appendChild(span);
      }
    }
    textarea.appendChild(lineEl);
    if (block.manualBreakAfter === true) {
      const breakEl = document.createElement("div");
      breakEl.dataset.manualSlideBreak = "true";
      breakEl.textContent = "---";
      textarea.appendChild(breakEl);
    }
  }
}

function applySongEditorTextStyle(style, scope = currentSongEditorStyleScope()) {
  if (!style || typeof style !== "object") return;
  const textarea = document.getElementById("songEditorSlideTextarea");
  if (scope === "allSlides") {
    songEditorSections = songEditorSections.map((section) => applySongStyleToWholeSection(section, style));
    if (currentWorkspaceSong) currentWorkspaceSong.sections = songEditorSections;
  } else if (scope === "page") {
    const activeSection = songEditorSections[songEditorActiveIndex];
    updateSongEditorSection(songEditorActiveIndex, applySongStyleToWholeSection(activeSection, style));
  } else {
    const activeSection = songEditorSections[songEditorActiveIndex];
    const range = selectedSongEditorTextRange(textarea);
    if (!activeSection || !range) return;
    updateSongEditorSection(
      songEditorActiveIndex,
      applySongStyleToSectionRange(activeSection, range.start, range.end, style),
    );
  }
  syncCurrentWorkspaceSongDefaultRender();
  refreshSongEditorAfterStyleChange();
}

function songListExcerpt(song) {
  const sections = Array.isArray(song?.sections) ? song.sections : [];
  for (const section of sections) {
    for (const blockText of songSectionBlockTexts(section)) {
      const text = blockText.trim();
      if (text.length > 0) return text.length > 60 ? text.slice(0, 57) + "…" : text;
    }
  }
  return "";
}

function syncSongsBulkMoveFolderOptions() {
  const select = document.getElementById("songsBulkMoveFolder");
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML =
    '<option value="">Move to folder…</option><option value="__unfiled__">Default</option>';
  for (const folder of songFoldersCache) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.name;
    select.appendChild(option);
  }
  if (currentValue) select.value = currentValue;
}

function syncSongsBulkActions() {
  const bar = document.getElementById("songsBulkActions");
  const countEl = document.getElementById("songsBulkCount");
  const deleteBtn = document.getElementById("songsBulkDeleteBtn");
  const count = selectedSongIds.size;
  if (bar) bar.hidden = count === 0;
  if (countEl) countEl.textContent = `${count} selected`;
  if (deleteBtn && songsBulkDeleteArmed) {
    deleteBtn.textContent = `Confirm delete ${count}`;
  } else if (deleteBtn) {
    deleteBtn.textContent = "Delete";
  }
  syncSongsBulkMoveFolderOptions();
}

function clearSongSelection() {
  selectedSongIds.clear();
  songsBulkDeleteArmed = false;
  syncSongsBulkActions();
  document.querySelectorAll(".songs-list-item.is-checked").forEach((row) => {
    row.classList.remove("is-checked");
    const checkbox = row.querySelector(".songs-list-item__checkbox");
    if (checkbox) checkbox.checked = false;
  });
}

function setSongRowSelected(row, songId, checked) {
  if (checked) selectedSongIds.add(songId);
  else selectedSongIds.delete(songId);
  row.classList.toggle("is-checked", checked);
  songsBulkDeleteArmed = false;
  syncSongsBulkActions();
}

async function bulkMoveSelectedSongs() {
  const folderSelect = document.getElementById("songsBulkMoveFolder");
  const value = folderSelect?.value || "";
  if (!value || selectedSongIds.size === 0) {
    showGnomeToast("Choose a folder and select songs to move");
    return;
  }
  const folderId = value === SONG_FOLDER_UNFILED ? null : value;
  const ids = [...selectedSongIds];
  let moved = 0;
  for (const id of ids) {
    try {
      await songsAPI.moveToFolder(id, folderId);
      moved += 1;
      if (currentWorkspaceSong?.id === id) {
        currentWorkspaceSong.folderId = folderId;
      }
    } catch (err) {
      console.error(`Failed to move song ${id}:`, err);
    }
  }
  clearSongSelection();
  await refreshSongFolders();
  const searchInput = document.getElementById("songsSearchInput");
  await refreshSongsBrowser(searchInput?.value || "");
  syncSongsMoveFolderSelect(currentWorkspaceSong);
  showGnomeToast(`Moved ${moved} song${moved === 1 ? "" : "s"}`);
}

async function bulkScheduleSelectedSongs() {
  if (selectedSongIds.size === 0) {
    showGnomeToast("Select songs to schedule");
    return;
  }
  const entries = [];
  for (const id of selectedSongIds) {
    try {
      const song = await songsAPI.get(id);
      const entry = buildSongQueueEntryFromDeck({
        deck: song,
        render: renderStateForLibrarySong(song),
      });
      if (entry) entries.push(entry);
    } catch (err) {
      console.error(`Failed to load song ${id} for schedule:`, err);
    }
  }
  if (entries.length === 0) {
    showGnomeToast("Could not schedule selected songs");
    return;
  }
  invalidateQueueUndoToastAfterMutation();
  insertQueueEntriesAfterSelection(entries);
  renderQueue();
  saveMediaFile();
  clearSongSelection();
  showGnomeToast(`Scheduled ${entries.length} song${entries.length === 1 ? "" : "s"}`);
}

async function bulkDeleteSelectedSongs() {
  const count = selectedSongIds.size;
  if (count === 0) return;
  if (!songsBulkDeleteArmed) {
    songsBulkDeleteArmed = true;
    syncSongsBulkActions();
    return;
  }
  const ids = [...selectedSongIds];
  let deleted = 0;
  for (const id of ids) {
    try {
      await songsAPI.delete(id);
      deleted += 1;
      if (currentWorkspaceSong?.id === id) {
        await loadSongIntoWorkspace(null);
      }
    } catch (err) {
      console.error(`Failed to delete song ${id}:`, err);
    }
  }
  songsBulkDeleteArmed = false;
  clearSongSelection();
  await refreshSongFolders();
  const searchInput = document.getElementById("songsSearchInput");
  await refreshSongsBrowser(searchInput?.value || "");
  showGnomeToast(`Deleted ${deleted} song${deleted === 1 ? "" : "s"}`);
}

async function handleSongsDatabaseCleared() {
  songsBulkDeleteArmed = false;
  clearSongSelection();
  currentSongFolderFilter = SONG_FOLDER_ALL;
  const searchInput = document.getElementById("songsSearchInput");
  if (searchInput) searchInput.value = "";
  if (currentWorkspaceSong) {
    await loadSongIntoWorkspace(null);
  }
  await refreshSongFolders();
  await refreshSongsBrowser("");
  showGnomeToast("Songs database cleared");
}

function songSearchOptionsForCurrentFolder() {
  if (currentSongFolderFilter === SONG_FOLDER_ALL) {
    return { all: true };
  }
  if (currentSongFolderFilter === SONG_FOLDER_UNFILED) {
    return { unfiled: true };
  }
  return { folderId: currentSongFolderFilter };
}

async function ensureSongFolder(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  const folder = await songsAPI.createFolder(trimmed);
  await refreshSongFolders();
  return folder?.id || null;
}

function syncSongEditorFolderOptions(selectedFolderId = "") {
  const select = document.getElementById("songEditorFolder");
  if (!select) return;
  const currentValue =
    selectedFolderId ||
    (typeof select.value === "string" ? select.value : "") ||
    "";
  select.innerHTML = '<option value="">Default</option>';
  for (const folder of songFoldersCache) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.name;
    select.appendChild(option);
  }
  select.value = currentValue;
}

function syncSongsMoveFolderSelect(song = currentWorkspaceSong, inLibrary = true) {
  const select = document.getElementById("songsMoveFolderSelect");
  if (!select) return;
  const selectedFolderId = song?.folderId || "";
  select.innerHTML =
    '<option value="">Move to folder…</option><option value="__unfiled__">Default</option>';
  for (const folder of songFoldersCache) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.name;
    select.appendChild(option);
  }
  select.disabled = !song?.id || !inLibrary;
  select.value = selectedFolderId || "";
}

function restoreSongWorkspaceView() {
  const launcher = document.getElementById("songsLauncher");
  const slide = document.getElementById("songsPreviewSlide");
  if (!launcher || !slide) return;
  if (currentWorkspaceSong) {
    launcher.hidden = true;
    slide.hidden = false;
  } else {
    launcher.hidden = false;
    slide.hidden = true;
  }
  syncSongSlideNavigator();
}

function currentSongEnabledSections() {
  if (!currentWorkspaceSong) return [];
  const enabled = enabledSongSections(currentWorkspaceSong);
  return enabled.length ? enabled : (currentWorkspaceSong.sections || []);
}

function currentSongSequenceItems() {
  if (!currentWorkspaceSong) return [];
  const sections = Array.isArray(currentWorkspaceSong.sections) ? currentWorkspaceSong.sections : [];
  const byId = new Map(sections.map((section) => [section.id, section]));
  return arrangementSequenceEntries(currentWorkspaceSong)
    .filter((entry) => entry.enabled !== false)
    .map((entry, index) => ({
      entry,
      entryId: entry.id || `play_${index}`,
      section: byId.get(entry.sectionId),
    }))
    .filter((item) => item.section);
}

function syncCurrentSongSequenceEntry() {
  const items = currentSongSequenceItems();
  if (items.some((item) => item.entryId === currentSongSequenceEntryId)) return;
  currentSongSequenceEntryId =
    items.find((item) => item.section.id === currentSongSectionId)?.entryId ||
    items[0]?.entryId ||
    null;
}

function currentSongActiveSection() {
  if (!currentWorkspaceSong) return null;
  const sections = currentSongEnabledSections();
  return (
    sections.find((section) => section.id === currentSongSectionId) ||
    sections[0] ||
    currentWorkspaceSong.sections?.[0] ||
    null
  );
}

function currentResolvedSongPresentation() {
  if (!currentWorkspaceSong) return null;
  return resolvedSongPresentation(songItemForAudienceResolution(currentSongPresentationItem()));
}

function scheduleSongPreviewRerender() {
  if (songPreviewRerenderRaf) {
    cancelAnimationFrame(songPreviewRerenderRaf);
  }
  songPreviewRerenderRaf = requestAnimationFrame(() => {
    songPreviewRerenderRaf = requestAnimationFrame(() => {
      songPreviewRerenderRaf = 0;
      if (!isSongsWorkspaceVisible()) return;
      const section = currentSongActiveSection();
      if (section) renderSongSectionPreview(section);
    });
  });
}

function layoutSongPreviewStage(preview = document.getElementById("songsPreviewSlide")) {
  if (!preview) return { width: 0, height: 0, scale: 0 };
  const container = preview.parentElement;
  if (!container) return { width: 0, height: 0, scale: 0 };
  const { width: containerWidth, height: containerHeight } = getElementContentSize(container);
  if (!containerWidth || !containerHeight) {
    return { width: 0, height: 0, scale: 0 };
  }
  const outputSize = selectedBiblePreviewOutputSize("dspSelct");
  const scale = Math.min(
    containerWidth / outputSize.width,
    containerHeight / outputSize.height,
  );
  const width = Math.max(1, outputSize.width * scale);
  const height = Math.max(1, outputSize.height * scale);
  preview.style.width = `${width}px`;
  preview.style.height = `${height}px`;
  preview.style.setProperty("--song-preview-output-scale", String(scale));
  return { width, height, scale, outputSize };
}

function setSongNavigatorDeckMode(enabled) {
  const navigator = document.querySelector("#songsWorkspace .songs-workspace__navigator");
  const slideNavigator = document.getElementById("songSlideNavigator");
  if (navigator) navigator.dataset.view = enabled ? "deck" : "browser";
  if (slideNavigator) slideNavigator.hidden = !enabled;
  if (!enabled) {
    songSlideNavigatorRenderToken += 1;
    const list = document.getElementById("songSlideThumbnailList");
    if (list) list.innerHTML = "";
  }
}

function syncSongSlideNavigator() {
  const hasDeckPages = Boolean(currentWorkspaceSong);
  setSongNavigatorDeckMode(hasDeckPages);
  if (hasDeckPages) {
    renderSongSlideNavigator();
  }
}

function songDeckPageForSection(section, index = 0) {
  if (!currentWorkspaceSongDeck) return null;
  return (
    findPage(currentWorkspaceSongDeck, section?.id) ||
    currentWorkspaceSongDeck.pages?.[index] ||
    null
  );
}

function updateSongArrangementSelection() {
  const strip = document.getElementById("songArrangementStrip");
  if (!strip) return;
  strip.querySelectorAll(".pill-button").forEach((btn) => {
    const isActive = currentSongSequenceEntryId
      ? btn.dataset.sequenceEntryId === currentSongSequenceEntryId
      : btn.dataset.sectionId === currentSongSectionId;
    btn.classList.toggle("primary-action", isActive);
  });
}

function updateSongSlideNavigatorSelection({ scroll = true } = {}) {
  const list = document.getElementById("songSlideThumbnailList");
  if (!list) return;
  let active = null;
  list.querySelectorAll(".song-slide-thumbnail-button").forEach((button) => {
    const isActive = currentSongSlideId
      ? button.dataset.slideId === currentSongSlideId
      : currentSongSequenceEntryId
      ? button.dataset.sequenceEntryId === currentSongSequenceEntryId
      : button.dataset.sectionId === currentSongSectionId;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
    button.tabIndex = isActive ? 0 : -1;
    if (isActive && !active) active = button;
  });
  if (scroll) active?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
}

function syncCurrentSongQueueItemSection(sectionId, slideId = currentSongSlideId) {
  if (!currentSongQueueItem || !sectionId) return;
  if (!currentSongQueueItem.render || typeof currentSongQueueItem.render !== "object") {
    currentSongQueueItem.render = {};
  }
  currentSongQueueItem.render.currentSectionId = sectionId;
  currentSongQueueItem.render.currentSlideId = slideId || null;
  currentSongQueueItem.render.currentSequenceEntryId = currentSongSequenceEntryId || null;
  currentSongQueueItem.currentSlideId = slideId || null;
  currentSongQueueItem.currentSequenceEntryId = currentSongSequenceEntryId || null;
  if (currentSongQueueItem.sequence && typeof currentSongQueueItem.sequence === "object") {
    currentSongQueueItem.sequence.currentSequenceEntryId = currentSongSequenceEntryId || null;
  }
  if (!currentSongQueueItem.source || typeof currentSongQueueItem.source !== "object") {
    currentSongQueueItem.source = {};
  }
  currentSongQueueItem.source.pageId = sectionId;
  const page = currentWorkspaceSongDeck ? findPage(currentWorkspaceSongDeck, sectionId) : null;
  const transitionOverride = normalizeItemSlideTransitionOverride(
    page?.transition || currentSongRenderState.transition,
  );
  if (transitionOverride) {
    currentSongQueueItem.transition = transitionOverride;
  } else {
    delete currentSongQueueItem.transition;
  }
}

async function selectSongSection(sectionId, opts = {}) {
  if (!currentWorkspaceSong || !sectionId) return false;
  const sections = currentSongEnabledSections();
  const section =
    sections.find((s) => s.id === sectionId) ||
    currentWorkspaceSong.sections?.find((s) => s.id === sectionId) ||
    null;
  if (!section) return false;
  currentSongSectionId = section.id;
  if (opts.sequenceEntryId) {
    currentSongSequenceEntryId = opts.sequenceEntryId;
  } else {
    syncCurrentSongSequenceEntry();
  }
  const resolved = currentResolvedSongPresentation();
  const selectedUnit =
    (opts.slideId
      ? resolved?.resolvedPresentation?.slides?.find((unit) => unit.slideId === opts.slideId)
      : null) ||
    resolved?.resolvedPresentation?.slides?.find(
      (unit) => unit.sequenceEntryId === currentSongSequenceEntryId,
    ) ||
    resolved?.activeUnit ||
    null;
  currentSongSlideId = selectedUnit?.slideId || null;
  currentSongSequenceEntryId =
    selectedUnit?.sequenceEntryId || currentSongSequenceEntryId;
  currentSongSectionId = selectedUnit?.sectionId || section.id;
  await renderSongSectionPreview(section);
  if (
    selectedUnit?.slideId &&
    (currentSongSlideId !== selectedUnit.slideId ||
      currentSongSequenceEntryId !== selectedUnit.sequenceEntryId)
  ) {
    return false;
  }
  setSongLowerThirdCue(0);
  syncCurrentSongQueueItemSection(currentSongSectionId, currentSongSlideId);
  if (currentSongQueueItem) saveMediaFile();
  updateSongArrangementSelection();
  updateSongSlideNavigatorSelection({ scroll: opts.scroll !== false });
  updateSongNavButtonsState();
  if (opts.syncLive !== false) {
    await syncActiveScheduledSongPresentation();
  }
  return true;
}

function renderSongSlideNavigator() {
  const list = document.getElementById("songSlideThumbnailList");
  if (!list || !currentWorkspaceSong) return;
  const presentation = currentResolvedSongPresentation()?.resolvedPresentation;
  const slides = presentation?.slides || [];
  const baseThumbnailItem = currentSongPresentationItem();
  ++songSlideNavigatorRenderToken;
  list.innerHTML = "";

  const renderToken = songSlideNavigatorRenderToken;
  slides.forEach((unit, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "song-slide-thumbnail-button";
    button.dataset.sectionId = unit.sectionId;
    button.dataset.sequenceEntryId = unit.sequenceEntryId;
    button.dataset.slideId = unit.slideId;
    button.dataset.layoutKey = presentation.layoutKey;
    button.setAttribute("role", "option");
    button.setAttribute("aria-label", `Go to slide ${index + 1}`);

    const number = document.createElement("span");
    number.className = "song-slide-thumbnail-button__number";
    number.textContent = String(index + 1);

    const viewport = document.createElement("div");
    viewport.className = "song-slide-thumbnail-button__viewport";

    const thumb = document.createElement("div");
    thumb.className = "slides-page-list__thumb song-slide-thumbnail-button__thumb";
    const renderSurface = document.createElement("div");
    renderSurface.className = "songs-preview-slide song-slide-thumbnail-button__render-surface";
    const thumbnailItem = songItemForAudienceResolution(baseThumbnailItem);
    if (thumbnailItem) {
      thumbnailItem.currentSlideId = unit.slideId;
      thumbnailItem.currentSequenceEntryId = unit.sequenceEntryId;
      thumbnailItem.render.currentSlideId = unit.slideId;
      thumbnailItem.render.currentSequenceEntryId = unit.sequenceEntryId;
    }
    const thumbnailMessage = resolvedSongPresentation(thumbnailItem)?.message || {};
    thumb.appendChild(renderSurface);
    viewport.appendChild(thumb);

    button.appendChild(number);
    button.appendChild(viewport);
    button.addEventListener("click", () => {
      void selectSongSection(unit.sectionId, {
        sequenceEntryId: unit.sequenceEntryId,
        slideId: unit.slideId,
      }).catch(console.error);
    });
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void recoverOutputHoldsToSongSection(unit.sectionId, {
        sequenceEntryId: unit.sequenceEntryId,
        slideId: unit.slideId,
      }).catch(console.error);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const buttons = [...list.querySelectorAll(".song-slide-thumbnail-button")];
        const currentIndex = buttons.indexOf(button);
        const next = buttons[Math.min(currentIndex + 1, buttons.length - 1)];
        next?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const buttons = [...list.querySelectorAll(".song-slide-thumbnail-button")];
        const currentIndex = buttons.indexOf(button);
        const prev = buttons[Math.max(currentIndex - 1, 0)];
        prev?.focus();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void selectSongSection(unit.sectionId, {
          sequenceEntryId: unit.sequenceEntryId,
          slideId: unit.slideId,
        }).catch(console.error);
      }
    });
    list.appendChild(button);

    void waitForTextFonts(
      [thumbnailMessage.fontFamily, currentSongRenderState.fontFamily],
      {
        documentRef: globalThis.document,
        sample: unit.bodyText || currentWorkspaceSong.title || "EMS",
        fontSize: thumbnailMessage.fontSize || currentSongRenderState.fontSize,
      },
    ).catch(() => {}).then(() => {
      if (renderToken !== songSlideNavigatorRenderToken || !renderSurface.isConnected) return;
      renderResolvedSongMessageIntoPreview(renderSurface, thumbnailMessage);
    });
  });
  updateSongSlideNavigatorSelection({ scroll: false });
}

function closeSongFolderPrompt() {
  document.getElementById("songFolderPrompt")?.setAttribute("hidden", "");
}

function openSongFolderPrompt() {
  const prompt = document.getElementById("songFolderPrompt");
  const input = document.getElementById("songFolderPromptInput");
  if (!prompt || !input) return;
  input.value = "";
  prompt.removeAttribute("hidden");
  input.focus();
}

// Visual WYSIWYG Song Editor state and helpers
let songEditorSections = [];
let songEditorActiveIndex = 0;

function renderSongEditorSlideList() {
  const list = document.getElementById("songEditorSlideList");
  if (!list) return;

  list.innerHTML = "";
  songEditorSections.forEach((section, i) => {
    const item = document.createElement("div");
    item.className = "song-editor-slide-item";
    if (i === songEditorActiveIndex) {
      item.classList.add("active");
    }
    item.setAttribute("data-index", i);
    item.setAttribute("title", "Double-click to rename");
    item.addEventListener("click", () => {
      selectSongEditorSlide(i);
    });
    item.addEventListener("dblclick", () => {
      const newLabel = prompt("Enter section label (e.g. Verse 1, Chorus):", section.label);
      if (newLabel !== null) {
        const trimmed = newLabel.trim();
        if (trimmed) {
          section.label = trimmed;
          labelEl.textContent = trimmed;
          syncSongEditorHiddenTextarea();
          if (currentWorkspaceSong) {
            currentWorkspaceSong.sections = songEditorSections;
            renderSongSectionPreview(section);
            void syncActiveScheduledSongPresentation().catch(console.error);
          }
        }
      }
    });

    const indexEl = document.createElement("div");
    indexEl.className = "song-editor-slide-item__index";
    indexEl.textContent = i + 1;

    const detailsEl = document.createElement("div");
    detailsEl.className = "song-editor-slide-item__details";

    const labelEl = document.createElement("div");
    labelEl.className = "song-editor-slide-item__label";
    labelEl.textContent = section.label || `Section ${i + 1}`;

    const snippetEl = document.createElement("div");
    snippetEl.className = "song-editor-slide-item__snippet";
    const textContent = songSectionLyricsText(section);
    const linesText = textContent.split("\n")
      .filter(t => t.trim() !== "")
      .slice(0, 2)
      .join(" / ");
    snippetEl.textContent = linesText || "Empty slide";

    detailsEl.appendChild(labelEl);
    detailsEl.appendChild(snippetEl);
    item.appendChild(indexEl);
    item.appendChild(detailsEl);
    list.appendChild(item);
  });
}

function selectSongEditorSlide(index) {
  if (index < 0 || index >= songEditorSections.length) return;
  songEditorActiveIndex = index;

  const items = document.querySelectorAll(".song-editor-slide-item");
  items.forEach((item, i) => {
    if (i === index) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  const section = songEditorSections[index];
  const textarea = document.getElementById("songEditorSlideTextarea");
  if (textarea) {
    populateSongEditorTextarea(textarea, section);
  }

  const label = section.label || "";
  const match = label.match(/^(Verse|Chorus|Bridge|Pre-Chorus|Tag)\s*(\d*)$/i);
  const typeSelect = document.getElementById("songEditorSectionType");
  const numInput = document.getElementById("songEditorSectionNumber");
  const customInput = document.getElementById("songEditorSectionCustomLabel");

  if (typeSelect && numInput && customInput) {
    if (match) {
      typeSelect.value = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
      numInput.value = match[2] || "1";
      numInput.style.display = "block";
      customInput.style.display = "none";
    } else {
      typeSelect.value = "Custom";
      customInput.value = label;
      numInput.style.display = "none";
      customInput.style.display = "block";
    }
  }

  if (currentWorkspaceSong) {
    currentWorkspaceSong.sections = songEditorSections;
    currentSongSectionId = section.id;
    renderSongSectionPreview(section);
    void syncActiveScheduledSongPresentation().catch(console.error);
  }
}

function syncSongEditorWorkspaceStyles(message = null) {
  const style = mergeSongRenderState(currentSongRenderState, {
    backgroundColor: message?.backgroundColor,
    backgroundPath: message?.backgroundPath,
    color: message?.color,
    fontFamily: message?.fontFamily,
    fontSize: message?.fontSize,
    textBoxPosition: message?.textBoxPosition,
  });
  const preview = document.getElementById("songEditorLivePreviewSlide");
  const canvas = document.getElementById("songEditorSlideCanvas");
  if (canvas) {
    canvas.style.backgroundColor = style.backgroundColor || DEFAULT_SONG_RENDER.backgroundColor;
    if (message?.backgroundImage) {
      canvas.style.backgroundImage = `url('${message.backgroundImage}')`;
    } else {
      canvas.style.backgroundImage = "";
    }
    canvas.style.color = style.color || DEFAULT_SONG_RENDER.color;
    canvas.style.fontFamily = songFontFamilyCSS(style.fontFamily);
    canvas.style.setProperty("--base-font-size", style.fontSize || DEFAULT_SONG_RENDER.fontSize);
    canvas.style.setProperty("--font-family", songFontFamilyCSS(style.fontFamily));
  }
  if (preview) {
    preview.style.setProperty("--base-font-size", style.fontSize || DEFAULT_SONG_RENDER.fontSize);
    preview.style.setProperty("--font-family", songFontFamilyCSS(style.fontFamily));
  }
  const activeSection = Array.isArray(songEditorSections) && Number.isFinite(songEditorActiveIndex) 
    ? songEditorSections[songEditorActiveIndex] 
    : null;
  const sectionStyle = activeSection?.primary?.style || {};
  const activeColor = sectionStyle.color || style.color || DEFAULT_SONG_RENDER.color;
  const activeFontFamily = sectionStyle.fontFamily || style.fontFamily;
  const activeFontSize = sectionStyle.fontSize || style.fontSize || DEFAULT_SONG_RENDER.fontSize;

  const textBox = document.getElementById("songEditorTextBox");
  if (textBox) {
    textBox.style.color = activeColor;
    textBox.style.fontFamily = songFontFamilyCSS(activeFontFamily);
    textBox.style.setProperty("--base-font-size", activeFontSize);
    textBox.style.setProperty("--font-family", songFontFamilyCSS(activeFontFamily));
  }
  const textarea = document.getElementById("songEditorSlideTextarea");
  if (textarea) {
    textarea.style.color = activeColor;
    textarea.style.fontFamily = songFontFamilyCSS(activeFontFamily);
    textarea.style.setProperty("--font-family", songFontFamilyCSS(activeFontFamily));
  }
  if (textBox && style.textBoxPosition) {
    const pos = style.textBoxPosition;
    textBox.style.left = pos.left;
    textBox.style.top = pos.top;
    textBox.style.width = pos.width;
    textBox.style.height = pos.height;
  }
}

function initSongEditorTextBoxDragAndDrop() {
  const textBox = document.getElementById("songEditorTextBox");
  const canvas = document.getElementById("songEditorSlideCanvas");
  const handle = document.getElementById("songEditorDragHandle");
  const resizeHandle = document.getElementById("songEditorResizeHandle");

  if (!textBox || !canvas || !handle) return;

  let isDragging = false;
  let isResizing = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let startWidth = 0;
  let startHeight = 0;
  let resizeStartLeft = 0;
  let resizeStartTop = 0;

  const snapThreshold = 10;
  const minResizeWidth = 72;
  const minResizeHeight = 48;

  const clamp = (value, min, max) => {
    if (!Number.isFinite(max) || max <= 0) return min;
    if (max < min) return max;
    return Math.max(min, Math.min(value, max));
  };

  const toPercent = (value, total) => {
    if (!total) return "0%";
    return `${(value / total) * 100}%`;
  };

  const renderActiveSongEditorSection = () => {
    if (!currentWorkspaceSong) return;
    const section =
      enabledSongSections(currentWorkspaceSong).find((s) => s.id === currentSongSectionId) ||
      currentWorkspaceSong.sections?.[0];
    if (section) renderSongSectionPreview(section);
  };

  const saveTextBoxPosition = () => {
    if (!currentSongRenderState) return;
    currentSongRenderState.textBoxPosition = {
      left: textBox.style.left || "10%",
      top: textBox.style.top || "10%",
      width: textBox.style.width || "80%",
      height: textBox.style.height || "80%",
    };
    syncCurrentWorkspaceSongDefaultRender();
    renderActiveSongEditorSection();
    void syncActiveScheduledSongPresentation().catch(console.error);
  };

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = textBox.offsetLeft;
    startTop = textBox.offsetTop;

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  function onMouseMove(e) {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newLeft = startLeft + dx;
    let newTop = startTop + dy;

    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;
    const boxWidth = textBox.offsetWidth;
    const boxHeight = textBox.offsetHeight;

    const guideV = document.getElementById("snapGuideV");
    const guideH = document.getElementById("snapGuideH");
    let showGuideV = false;
    let showGuideH = false;

    const boxCenterH = newLeft + boxWidth / 2;
    const canvasCenterH = canvasWidth / 2;
    const marginL = canvasWidth * 0.1;
    const marginR = canvasWidth * 0.9;

    if (Math.abs(boxCenterH - canvasCenterH) < snapThreshold) {
      newLeft = canvasCenterH - boxWidth / 2;
      showGuideV = true;
      if (guideV) guideV.style.left = `${canvasCenterH}px`;
    } else if (Math.abs(newLeft - marginL) < snapThreshold) {
      newLeft = marginL;
      showGuideV = true;
      if (guideV) guideV.style.left = `${marginL}px`;
    } else if (Math.abs((newLeft + boxWidth) - marginR) < snapThreshold) {
      newLeft = marginR - boxWidth;
      showGuideV = true;
      if (guideV) guideV.style.left = `${marginR}px`;
    }

    const boxCenterV = newTop + boxHeight / 2;
    const canvasCenterV = canvasHeight / 2;
    const marginT = canvasHeight * 0.1;
    const marginB = canvasHeight * 0.9;

    if (Math.abs(boxCenterV - canvasCenterV) < snapThreshold) {
      newTop = canvasCenterV - boxHeight / 2;
      showGuideH = true;
      if (guideH) guideH.style.top = `${canvasCenterV}px`;
    } else if (Math.abs(newTop - marginT) < snapThreshold) {
      newTop = marginT;
      showGuideH = true;
      if (guideH) guideH.style.top = `${marginT}px`;
    } else if (Math.abs((newTop + boxHeight) - marginB) < snapThreshold) {
      newTop = marginB - boxHeight;
      showGuideH = true;
      if (guideH) guideH.style.top = `${marginB}px`;
    }

    if (guideV) guideV.style.display = showGuideV ? "block" : "none";
    if (guideH) guideH.style.display = showGuideH ? "block" : "none";

    newLeft = Math.max(0, Math.min(newLeft, canvasWidth - boxWidth));
    newTop = Math.max(0, Math.min(newTop, canvasHeight - boxHeight));

    const leftPct = (newLeft / canvasWidth) * 100;
    const topPct = (newTop / canvasHeight) * 100;

    textBox.style.left = `${leftPct}%`;
    textBox.style.top = `${topPct}%`;
  }

  function onMouseUp() {
    if (!isDragging) return;
    isDragging = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);

    const guideV = document.getElementById("snapGuideV");
    const guideH = document.getElementById("snapGuideH");
    if (guideV) guideV.style.display = "none";
    if (guideH) guideH.style.display = "none";

    saveTextBoxPosition();
  }

  if (resizeHandle) {
    resizeHandle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;

      const textBoxRect = textBox.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      startWidth = textBoxRect.width;
      startHeight = textBoxRect.height;
      resizeStartLeft = textBoxRect.left - canvasRect.left;
      resizeStartTop = textBoxRect.top - canvasRect.top;

      document.addEventListener("mousemove", onResizeMove);
      document.addEventListener("mouseup", onResizeUp);
    });
  }

  function onResizeMove(e) {
    if (!isResizing) return;

    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;
    if (!canvasWidth || !canvasHeight) return;

    const maxWidth = Math.max(0, canvasWidth - resizeStartLeft);
    const maxHeight = Math.max(0, canvasHeight - resizeStartTop);
    const width = clamp(
      startWidth + e.clientX - startX,
      Math.min(minResizeWidth, maxWidth),
      maxWidth,
    );
    const height = clamp(
      startHeight + e.clientY - startY,
      Math.min(minResizeHeight, maxHeight),
      maxHeight,
    );

    textBox.style.width = toPercent(width, canvasWidth);
    textBox.style.height = toPercent(height, canvasHeight);
  }

  function onResizeUp() {
    if (!isResizing) return;
    isResizing = false;
    document.removeEventListener("mousemove", onResizeMove);
    document.removeEventListener("mouseup", onResizeUp);
    saveTextBoxPosition();
  }
}

function getOrCreateBodyColorInput(id, realInputId) {
  let input = document.getElementById(id);
  if (!input) {
    input = document.createElement("input");
    input.type = "color";
    input.id = id;
    input.style.position = "fixed";
    input.style.left = "-100px";
    input.style.top = "-100px";
    input.style.width = "32px";
    input.style.height = "32px";
    input.style.opacity = "0.01";
    input.style.pointerEvents = "none";
    input.style.zIndex = "999999";
    input.style.border = "0";
    input.style.margin = "0";
    input.style.padding = "0";
    document.body.appendChild(input);

    const updateRealInput = (e) => {
      const realInput = document.getElementById(realInputId);
      if (realInput) {
        realInput.value = e.target.value;
        realInput.dispatchEvent(new Event("input"));
        realInput.dispatchEvent(new Event("change"));
      }
    };
    input.addEventListener("input", updateRealInput);
    input.addEventListener("change", updateRealInput);
  }
  return input;
}

function initSongEditorContextMenu() {
  const canvas = document.getElementById("songEditorSlideCanvas");
  const textarea = document.getElementById("songEditorSlideTextarea");
  const menu = document.getElementById("songEditorContextMenu");

  if (!canvas || !textarea || !menu) return;

  let menuAnchor = { x: 0, y: 0 };

  const hideMenu = () => {
    menu.style.display = "none";
    menu.style.visibility = "";
  };

  const positionColorInput = (input, fallbackEvent) => {
    const anchorX = Number.isFinite(menuAnchor.x) && menuAnchor.x > 0
      ? menuAnchor.x
      : fallbackEvent?.clientX || 0;
    const anchorY = Number.isFinite(menuAnchor.y) && menuAnchor.y > 0
      ? menuAnchor.y
      : fallbackEvent?.clientY || 0;
    const x = Math.max(0, Math.min(anchorX, window.innerWidth - input.offsetWidth));
    const y = Math.max(0, Math.min(anchorY, window.innerHeight - input.offsetHeight));
    input.style.left = `${x}px`;
    input.style.top = `${y}px`;
    input.getBoundingClientRect();
  };

  const showColorInputPicker = (input) => {
    input.focus({ preventScroll: true });
    try {
      if (typeof input.showPicker === "function") {
        input.showPicker();
        return;
      }
    } catch (err) {
      console.debug("Color input showPicker failed, falling back to click:", err);
    }
    input.click();
  };

  const openColorPickerFromMenu = (event, inputId, realInputId) => {
    event.preventDefault();
    event.stopPropagation();
    const colorInput = getOrCreateBodyColorInput(inputId, realInputId);
    const realInput = document.getElementById(realInputId);
    if (realInput) {
      colorInput.value = realInput.value;
    }
    positionColorInput(colorInput, event);
    hideMenu();
    showColorInputPicker(colorInput);
  };

  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || menu.style.display === "none") return;
    if (menu.contains(event.target)) return;
    hideMenu();
  }, true);

  document.addEventListener("click", (event) => {
    if (menu.contains(event.target)) return;
    hideMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideMenu();
  });

  textarea.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setSongEditorStyleScope("selection");

    menu.innerHTML = "";

    const header = document.createElement("div");
    header.className = "song-editor-context-menu__header";
    header.textContent = "Text Format";
    menu.appendChild(header);

    const colorOpt = document.createElement("div");
    colorOpt.className = "song-editor-context-menu__item";
    colorOpt.innerHTML = `<span class="icon">🎨</span> Change Text Color`;
    colorOpt.addEventListener("click", (evt) => {
      setSongEditorStyleScope("selection");
      openColorPickerFromMenu(evt, "tempBodyTextColorInput", "songEditorTextColor");
    });
    menu.appendChild(colorOpt);

    menu.appendChild(document.createElement("div")).className = "song-editor-context-menu__separator";

    const fontHeader = document.createElement("div");
    fontHeader.className = "song-editor-context-menu__header";
    fontHeader.textContent = "Font Family";
    menu.appendChild(fontHeader);

    const fontInput = document.getElementById("songEditorFontInput");
    const fonts = fontInput
      ? Array.from(fontInput.options).map((option) => ({
          label: option.textContent || option.value,
          value: option.value,
        }))
      : [
          { label: "CMG Sans", value: "'CMG Sans'" },
          { label: "Arial", value: "'Arial'" },
          { label: "Times New Roman", value: "'Times New Roman'" },
          { label: "Georgia", value: "'Georgia'" },
        ];
    for (const font of fonts) {
      const fontOpt = document.createElement("div");
      fontOpt.className = "song-editor-context-menu__item";
      fontOpt.textContent = font.label;
      if (currentSongRenderState.fontFamily === font.value) {
        fontOpt.classList.add("song-editor-context-menu__item--active");
      }
      fontOpt.addEventListener("click", () => {
        if (fontInput) {
          setSongEditorStyleScope("selection");
          fontInput.value = font.value;
          fontInput.dispatchEvent(new Event("change"));
        }
        hideMenu();
      });
      menu.appendChild(fontOpt);
    }

    showMenu(e.clientX, e.clientY);
  });

  canvas.addEventListener("contextmenu", (e) => {
    if (e.target === textarea) return;
    e.preventDefault();
    e.stopPropagation();
    showBackgroundMenu(e.clientX, e.clientY);
  });

  function showBackgroundMenu(x, y) {
    menu.innerHTML = "";

    const header = document.createElement("div");
    header.className = "song-editor-context-menu__header";
    header.textContent = "Background Options";
    menu.appendChild(header);

    const colorOpt = document.createElement("div");
    colorOpt.className = "song-editor-context-menu__item";
    colorOpt.innerHTML = `<span class="icon">🎨</span> Change Background Color`;
    colorOpt.addEventListener("click", (evt) => {
      openColorPickerFromMenu(evt, "tempBodyBackgroundColorInput", "songEditorBackgroundColor");
    });
    menu.appendChild(colorOpt);

    const graphicOpt = document.createElement("div");
    graphicOpt.className = "song-editor-context-menu__item";
    graphicOpt.innerHTML = `<span class="icon">🖼️</span> Choose Background Graphic`;
    graphicOpt.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      hideMenu();
      document.getElementById("songEditorBackgroundInput")?.click();
    });
    menu.appendChild(graphicOpt);

    if (currentSongRenderState.backgroundPath) {
      const clearOpt = document.createElement("div");
      clearOpt.className = "song-editor-context-menu__item";
      clearOpt.innerHTML = `<span class="icon">❌</span> Clear Background`;
      clearOpt.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        hideMenu();
        document.getElementById("songEditorClearBackgroundBtn")?.click();
      });
      menu.appendChild(clearOpt);
    }

    showMenu(x, y);
  }

  function showMenu(x, y) {
    menuAnchor = { x, y };
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.visibility = "hidden";
    menu.style.display = "block";

    const rect = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, Math.max(8, window.innerWidth - rect.width - 8)));
    const top = Math.max(8, Math.min(y, Math.max(8, window.innerHeight - rect.height - 8)));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = "";
  }
}

function handleSongEditorCanvasTextInput(editorDiv) {
  const activeSection = songEditorSections[songEditorActiveIndex];
  if (!activeSection) return;

  const previousBlocks = Array.isArray(activeSection.blocks) ? activeSection.blocks : [];
  const blocks = [];

  for (const node of editorDiv.childNodes) {
    if (node.nodeType === 3) { // Text node outside div
      if (node.textContent.trim() !== "") {
        if (node.textContent.trim() === "---") {
          if (blocks.length > 0) blocks[blocks.length - 1].manualBreakAfter = true;
          continue;
        }
        blocks.push({
          type: "lyricLine",
          id: "block_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
          primary: { lang: "en", segments: [{ type: "text", text: node.textContent }] },
          translations: [], annotations: []
        });
      }
    } else if (node.nodeType === 1) { // Element
      if (node.tagName === "BR") {
        blocks.push({ type: "spacer", id: "block_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6) });
      } else if (node.tagName === "DIV" || node.tagName === "P") {
        if (node.dataset.manualSlideBreak === "true" || node.textContent.trim() === "---") {
          if (blocks.length > 0) blocks[blocks.length - 1].manualBreakAfter = true;
          continue;
        }
        const segments = [];
        const walk = (n, currentStyle) => {
          if (n.nodeType === 3) {
            if (n.textContent) segments.push({ type: "text", text: n.textContent, style: currentStyle });
          } else if (n.nodeType === 1 && n.tagName !== "BR") {
            const newStyle = { ...currentStyle };
            if (n.style.fontFamily) newStyle.fontFamily = n.style.fontFamily;
            if (n.style.fontSize) newStyle.fontSize = Number.parseFloat(n.style.fontSize);
            if (n.style.color) newStyle.color = n.style.color;
            for (const child of n.childNodes) walk(child, newStyle);
          }
        };
        for (const child of node.childNodes) walk(child, {});
        
        let blockId = node.dataset.blockId || ("block_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6));
        const existingBlock = previousBlocks.find(b => b.id === blockId);
        
        if (segments.length === 0) {
          blocks.push(
            existingBlock && existingBlock.type === "spacer"
              ? { ...existingBlock, manualBreakAfter: false }
              : { type: "spacer", id: blockId, manualBreakAfter: false },
          );
        } else {
          blocks.push({
            ...(existingBlock || {}),
            type: "lyricLine",
            id: blockId,
            primary: { lang: "en", segments },
            translations: existingBlock?.translations || [],
            annotations: existingBlock?.annotations || [],
            manualBreakAfter: false,
          });
        }
      }
    }
  }

  activeSection.blocks = blocks;

  syncSongEditorHiddenTextarea();

  if (currentWorkspaceSong) {
    currentWorkspaceSong.sections = songEditorSections;
    currentSongSectionId = activeSection.id;
    renderSongSectionPreview(activeSection);
    void syncActiveScheduledSongPresentation().catch(console.error);
  }

  const snippetEl = document.querySelector(`.song-editor-slide-item[data-index="${songEditorActiveIndex}"] .song-editor-slide-item__snippet`);
  if (snippetEl) {
    snippetEl.textContent = songSectionBlockTexts(activeSection).filter(t => t.trim() !== "").slice(0, 2).join(" / ") || "Empty slide";
  }
}

function syncSongEditorHiddenTextarea() {
  const hiddenTextarea = document.getElementById("songEditorTextarea");
  if (hiddenTextarea) {
    hiddenTextarea.value = songEditorTextFromSections(songEditorSections);
  }
}

function handleSongEditorSectionMetaChange() {
  const activeSection = songEditorSections[songEditorActiveIndex];
  if (!activeSection) return;

  const typeSelect = document.getElementById("songEditorSectionType");
  const numInput = document.getElementById("songEditorSectionNumber");
  const customInput = document.getElementById("songEditorSectionCustomLabel");

  if (!typeSelect || !numInput || !customInput) return;

  let label = "";
  if (typeSelect.value === "Custom") {
    customInput.style.display = "block";
    numInput.style.display = "none";
    label = customInput.value.trim();
    activeSection.kind = "custom";
  } else {
    customInput.style.display = "none";
    numInput.style.display = "block";
    const type = typeSelect.value;
    const num = numInput.value;
    label = `${type} ${num}`.trim();
    activeSection.kind = type.toLowerCase();
    activeSection.number = Number(num) || 1;
  }

  activeSection.label = label || "Untitled Section";

  const labelEl = document.querySelector(`.song-editor-slide-item[data-index="${songEditorActiveIndex}"] .song-editor-slide-item__label`);
  if (labelEl) {
    labelEl.textContent = activeSection.label;
  }

  syncSongEditorHiddenTextarea();
  if (currentWorkspaceSong) {
    currentWorkspaceSong.sections = songEditorSections;
    currentSongSectionId = activeSection.id;
    renderSongSectionPreview(activeSection);
    void syncActiveScheduledSongPresentation().catch(console.error);
  }
}

function handleSongEditorAddSection() {
  const verseCount = songEditorSections.filter(s => s.kind === "verse").length;
  const newSection = {
    id: `sec_${crypto.randomUUID().slice(0, 8)}`,
    kind: "verse",
    number: verseCount + 1,
    label: `Verse ${verseCount + 1}`,
    blocks: []
  };
  songEditorSections.splice(songEditorActiveIndex + 1, 0, newSection);
  syncSongEditorHiddenTextarea();
  renderSongEditorSlideList();
  selectSongEditorSlide(songEditorActiveIndex + 1);
}

function handleSongEditorDeleteSection() {
  if (songEditorSections.length <= 1) {
    showGnomeToast("Cannot delete the only section.");
    return;
  }
  const indexToDelete = songEditorActiveIndex;
  songEditorSections.splice(indexToDelete, 1);
  syncSongEditorHiddenTextarea();
  renderSongEditorSlideList();
  const nextIndex = Math.min(indexToDelete, songEditorSections.length - 1);
  selectSongEditorSlide(nextIndex);
}

function handleSongEditorMoveSectionUp() {
  if (songEditorActiveIndex <= 0) return;
  const idx = songEditorActiveIndex;
  const temp = songEditorSections[idx];
  songEditorSections[idx] = songEditorSections[idx - 1];
  songEditorSections[idx - 1] = temp;
  syncSongEditorHiddenTextarea();
  renderSongEditorSlideList();
  selectSongEditorSlide(idx - 1);
}

function handleSongEditorMoveSectionDown() {
  if (songEditorActiveIndex >= songEditorSections.length - 1) return;
  const idx = songEditorActiveIndex;
  const temp = songEditorSections[idx];
  songEditorSections[idx] = songEditorSections[idx + 1];
  songEditorSections[idx + 1] = temp;
  syncSongEditorHiddenTextarea();
  renderSongEditorSlideList();
  selectSongEditorSlide(idx + 1);
}

function closeSongEditor() {
  document.getElementById("songEditorDrawer")?.setAttribute("hidden", "");
  restoreSongWorkspaceView();
  if (currentWorkspaceSong) {
    const activeSection =
      enabledSongSections(currentWorkspaceSong).find((s) => s.id === currentSongSectionId) ||
      currentWorkspaceSong.sections?.[0] ||
      null;
    if (activeSection) renderSongSectionPreview(activeSection);
  }
}

async function refreshSongFolders(prefetchedFolders = null) {
  try {
    songFoldersCache = asSongArray(
      prefetchedFolders ?? (await songsAPI.listFolders()),
    );
  } catch (err) {
    console.error("Failed to load song folders:", err);
    songFoldersCache = [];
  }

  const list = document.getElementById("songsFolderList");
  if (!list) return;

  list.innerHTML = "";
  const entries = [
    { id: SONG_FOLDER_ALL, name: "All Songs", count: null },
    ...songFoldersCache.map((folder) => ({
      id: folder.id,
      name: folder.name,
      count: folder.songCount,
    })),
  ];

  for (const entry of entries) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "songs-folder-item";
    row.dataset.folderId = entry.id;
    if (entry.id === currentSongFolderFilter) {
      row.classList.add("is-selected");
    }

    const label = document.createElement("span");
    label.textContent = entry.name;
    row.appendChild(label);

    if (Number.isFinite(entry.count)) {
      const count = document.createElement("span");
      count.className = "songs-folder-item__count";
      count.textContent = String(entry.count);
      row.appendChild(count);
    }

    row.addEventListener("click", () => {
      currentSongFolderFilter = entry.id;
      clearSongSelection();
      list.querySelectorAll(".songs-folder-item").forEach((el) => {
        el.classList.toggle("is-selected", el === row);
      });
      const searchInput = document.getElementById("songsSearchInput");
      void refreshSongsBrowser(searchInput?.value || "").catch(console.error);
    });

    if (entry.id !== SONG_FOLDER_ALL) {
      row.addEventListener("dragover", (event) => {
        if (!songDragSongId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        list.querySelectorAll(".songs-folder-item--drag-over").forEach((el) => {
          if (el !== row) el.classList.remove("songs-folder-item--drag-over");
        });
        row.classList.add("songs-folder-item--drag-over");
      });
      row.addEventListener("dragleave", (event) => {
        if (
          typeof event.relatedTarget === "object" &&
          event.relatedTarget &&
          row.contains(event.relatedTarget)
        ) {
          return;
        }
        row.classList.remove("songs-folder-item--drag-over");
      });
      row.addEventListener("drop", (event) => {
        if (!songDragSongId) return;
        event.preventDefault();
        event.stopPropagation();
        row.classList.remove("songs-folder-item--drag-over");
        const songId = songDragSongId;
        clearSongDragVisualState();
        const folderId = entry.id === SONG_FOLDER_UNFILED ? null : entry.id;
        void songsAPI
          .moveToFolder(songId, folderId)
          .then(async (updated) => {
            if (updated && currentWorkspaceSong?.id === songId) {
              currentWorkspaceSong = updated;
            } else if (currentWorkspaceSong?.id === songId) {
              currentWorkspaceSong.folderId = folderId;
            }
            syncSongsMoveFolderSelect(currentWorkspaceSong);
            await refreshSongFolders();
            const searchInput = document.getElementById("songsSearchInput");
            await refreshSongsBrowser(searchInput?.value || "");
            showGnomeToast("Song moved");
          })
          .catch((err) => {
            console.error("Failed to move song to folder:", err);
            showGnomeToast("Failed to move song");
          });
      });
    }

    list.appendChild(row);
  }

  syncSongEditorFolderOptions();
  syncSongsMoveFolderSelect();
  syncSongsBulkMoveFolderOptions();
}

function readSongEditorRenderState() {
  const fontInput = document.getElementById("songEditorFontInput");
  const fontSizeInput = document.getElementById("songEditorFontSizeInput");
  const autosizeModeInput = document.getElementById("songEditorAutosizeModeInput");
  const minFontSizeInput = document.getElementById("songEditorMinFontSizeInput");
  const textColor = document.getElementById("songEditorTextColor")?.value;
  const backgroundColor = document.getElementById("songEditorBackgroundColor")?.value;
  const transition = readSlideTransitionControls(
    "songEditorTransitionEffect",
    "songEditorTransitionDuration",
    { allowInherit: true },
  );
  return mergeSongRenderState(currentSongRenderState, {
    fontFamily: fontInput ? fontInput.value : DEFAULT_SONG_RENDER.fontFamily,
    fontSize: fontSizeInput && fontSizeInput.value ? Number(fontSizeInput.value) : DEFAULT_SONG_RENDER.fontSize,
    autosizeMode: autosizeModeInput ? autosizeModeInput.value : DEFAULT_SONG_RENDER.autosizeMode,
    minFontSize: minFontSizeInput && minFontSizeInput.value ? Number(minFontSizeInput.value) : DEFAULT_SONG_RENDER.minFontSize,
    color: textColor || DEFAULT_SONG_RENDER.color,
    backgroundColor: backgroundColor || DEFAULT_SONG_RENDER.backgroundColor,
    backgroundPath: currentSongRenderState.backgroundPath || "",
    textBoxPosition: currentSongRenderState.textBoxPosition || null,
    transition,
  });
}

function syncSongEditorRenderControls(render = currentSongRenderState) {
  const fontInput = document.getElementById("songEditorFontInput");
  const fontSizeInput = document.getElementById("songEditorFontSizeInput");
  const autosizeModeInput = document.getElementById("songEditorAutosizeModeInput");
  const minFontSizeInput = document.getElementById("songEditorMinFontSizeInput");
  const textColorInput = document.getElementById("songEditorTextColor");
  const backgroundColorInput = document.getElementById("songEditorBackgroundColor");

  if (fontInput) fontInput.value = render.fontFamily || DEFAULT_SONG_RENDER.fontFamily;
  if (fontSizeInput) fontSizeInput.value = render.fontSize || DEFAULT_SONG_RENDER.fontSize;
  if (autosizeModeInput) autosizeModeInput.value = render.autosizeMode || DEFAULT_SONG_RENDER.autosizeMode;
  if (minFontSizeInput) minFontSizeInput.value = render.minFontSize || DEFAULT_SONG_RENDER.minFontSize;

  if (textColorInput) textColorInput.value = render.color || DEFAULT_SONG_RENDER.color;
  if (backgroundColorInput) {
    backgroundColorInput.value = render.backgroundColor || DEFAULT_SONG_RENDER.backgroundColor;
  }
  syncSlideTransitionControls(
    "songEditorTransitionEffect",
    "songEditorTransitionDuration",
    render.transition,
    { allowInherit: true },
  );
  syncSongBackgroundLabel(render.backgroundPath || "");
}

function syncSongBackgroundLabel(filePath = currentSongRenderState.backgroundPath) {
  const label = document.getElementById("songEditorBackgroundLabel");
  if (!label) return;
  if (!filePath) {
    label.textContent = "No background image";
    return;
  }
  label.textContent = queueBasename(filePath);
}

function syncCurrentWorkspaceSongDefaultRender() {
  if (!currentWorkspaceSong) return;
  currentWorkspaceSong.defaultRender = songDefaultRenderFromRender(currentSongRenderState);
  if (currentWorkspaceSongDeck) {
    currentWorkspaceSongDeck = songDeckDocumentFromSongDocument(
      currentWorkspaceSongDeck,
      currentSongRenderState,
    );
  }
}

function currentWorkspaceSongSequenceEntries() {
  const arrangedEntries = arrangementSequenceEntries(currentWorkspaceSong);
  if (
    !currentSongSectionId ||
    arrangedEntries.some(
      (entry) => entry.enabled !== false && entry.sectionId === currentSongSectionId,
    )
  ) {
    return arrangedEntries;
  }
  return (currentWorkspaceSong?.sections || [])
    .map((section, index) => (
      section?.id
        ? { id: `workspace_${index}_${section.id}`, sectionId: section.id, enabled: true }
        : null
    ))
    .filter(Boolean);
}

function flushSongEditorStateForSave() {
  const slideTextarea = document.getElementById("songEditorSlideTextarea");
  const activeSection = songEditorSections[songEditorActiveIndex];
  if (slideTextarea && activeSection) {
    handleSongEditorCanvasTextInput(slideTextarea);
  }
  currentSongRenderState = readSongEditorRenderState();
  if (currentWorkspaceSong) {
    currentWorkspaceSong.sections = songEditorSections;
  }
  syncCurrentWorkspaceSongDefaultRender();
  return currentSongRenderState;
}

function currentSongPresentationItem() {
  if (!currentWorkspaceSongDeck && !currentWorkspaceSong) return null;
  const item = buildSongQueueEntryFromDeck({
    deck: currentWorkspaceSongDeck || currentWorkspaceSong,
    render: {
      ...currentSongRenderState,
      currentSectionId: currentSongSectionId,
      currentSlideId: currentSongSlideId,
      currentSequenceEntryId: currentSongSequenceEntryId,
    },
    currentSectionId: currentSongSectionId,
  });
  if (!item) return null;
  item.currentSlideId = currentSongSlideId;
  item.currentSequenceEntryId = currentSongSequenceEntryId;
  item.render.currentSlideId = currentSongSlideId;
  item.render.currentSequenceEntryId = currentSongSequenceEntryId;
  if (currentSongQueueItem?.itemTheme) {
    item.itemTheme = normalizeItemTheme(currentSongQueueItem.itemTheme);
  }
  const outputSize = selectedBiblePreviewOutputSize("dspSelct");
  item.render.outputRole = "audience";
  item.render.outputSize = outputSize;
  item.resolvedTheme = resolvedThemeForItem(item, "song", "audience", outputSize);
  item.sequence.currentSequenceEntryId = currentSongSequenceEntryId;
  return item;
}

function songItemForAudienceResolution(item) {
  if (!item) return null;
  const outputSize = selectedBiblePreviewOutputSize("dspSelct");
  return {
    ...item,
    render: {
      ...(item.render || {}),
      outputRole: "audience",
      outputSize,
    },
    resolvedTheme: resolvedThemeForItem(item, "song", "audience", outputSize),
  };
}

function songItemForLowerThirdResolution(item) {
  if (!item) return null;
  const outputSize = selectedBiblePreviewOutputSize("lowerThirdDspSelct");
  const baseResolvedTheme = resolvedThemeForItem(item, "song", "lowerThird", outputSize);
  const resolvedTheme = baseResolvedTheme
    ? {
        ...baseResolvedTheme,
        typography: {
          ...(baseResolvedTheme.typography || {}),
          maxLines: 2,
        },
      }
    : null;
  return {
    ...item,
    render: {
      ...(item.render || {}),
      outputRole: "lowerThird",
      outputSize,
      fontFamily:
        bibleDesignerState.lowerThirdFontFamily ||
        bibleDesignerState.fontFamily ||
        item.render?.fontFamily,
      fontSize:
        bibleDesignerState.lowerThirdFontSize ||
        bibleDesignerState.fontSize ||
        item.render?.fontSize,
      minFontSize: bibleDesignerState.minFontSize || SCRIPTURE_MIN_BODY_FONT_SIZE,
      lineHeight: SCRIPTURE_LINE_HEIGHT,
      maxLines: 2,
    },
    resolvedTheme,
    chunking: {
      mode: "autoFit",
      avoidOrphans: true,
      spacerBreaks: true,
    },
  };
}

function songPresentationSourceId(item) {
  return (
    item?.deckSnapshot?.id ||
    item?.songSnapshot?.id ||
    item?.source?.songId ||
    parseSongQueuePath(item?.path) ||
    null
  );
}

function markSongShowNowPresentation(item) {
  const sourceId = songPresentationSourceId(item);
  setSharedRendererState({ songShowNowModeActive: Boolean(sourceId) });
  setSharedRendererState({ songShowNowSourceId: sourceId });
}

function clearSongShowNowPresentation() {
  setSharedRendererState({ songShowNowModeActive: false });
  setSharedRendererState({ songShowNowSourceId: null });
}

function isCurrentWorkspaceSongShownNow() {
  return Boolean(
    songShowNowModeActive &&
      currentWorkspaceSong &&
      songShowNowSourceId &&
      currentWorkspaceSong.id === songShowNowSourceId
  );
}

async function loadSongItemIntoWorkspace(item, token) {
  currentSongQueueItem = item || null;
  currentSongSlideId = item?.currentSlideId || item?.render?.currentSlideId || null;
  currentSongSequenceEntryId =
    item?.currentSequenceEntryId ||
    item?.sequence?.currentSequenceEntryId ||
    item?.render?.currentSequenceEntryId ||
    null;
  if (item?.deckSnapshot) {
    const deck = normalizeSlideDeck(item.deckSnapshot);
    const itemRender = songRenderFromItem({
      ...item,
      songSnapshot: deckToTransientSong(deck),
    });
    currentSongRenderState = mergeSongRenderState(songRenderStateFromSongDocument(deck), itemRender);
    currentSongSectionId = itemRender.currentSectionId || item?.source?.pageId || null;
    if (typeof token === "number" && !isCurrentPreviewLoad(token)) return;
    await loadSongIntoWorkspace(deck, { render: currentSongRenderState });
    return;
  }
  if (item?.songSnapshot) {
    const songSnapshot = transientSongFromSongDocument(item.songSnapshot);
    const itemRender = songRenderFromItem({ ...item, songSnapshot });
    currentSongRenderState = itemRender;
    currentSongSectionId = itemRender.currentSectionId || null;
    if (typeof token === "number" && !isCurrentPreviewLoad(token)) return;
    await loadSongIntoWorkspace(item.songSnapshot, { render: itemRender });
    return;
  }
  if (item?.source?.songId) {
    const song = await songsAPI.get(item.source.songId);
    if (typeof token === "number" && !isCurrentPreviewLoad(token)) return;
    const songSnapshot = transientSongFromSongDocument(song);
    const itemRender = songRenderFromItem({ ...item, songSnapshot });
    currentSongRenderState = mergeSongRenderState(songRenderStateFromSongDocument(song), itemRender);
    currentSongSectionId = itemRender.currentSectionId || null;
    await loadSongIntoWorkspace(song, { render: itemRender });
  }
}

function queueItemDeckId(item) {
  if (!item || typeof item !== "object") return null;
  return (
    item.deckSnapshot?.id ||
    item.source?.deckId ||
    parseDeckQueuePath(item.path) ||
    null
  );
}

function queueItemMatchesDeck(item, deck) {
  const itemDeckId = queueItemDeckId(item);
  return Boolean(deck?.id && itemDeckId && itemDeckId === deck.id);
}

function normalizedCssUnit(value, fallback) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.endsWith("%")) {
      const pct = Number.parseFloat(trimmed.slice(0, -1));
      return Number.isFinite(pct) ? pct / 100 : fallback;
    }
    if (/px$/i.test(trimmed)) return fallback;
    const numeric = Number.parseFloat(trimmed);
    if (Number.isFinite(numeric)) return numeric > 1 ? numeric / 100 : numeric;
    return fallback;
  }
  if (Number.isFinite(value)) return value > 1 ? value / 100 : value;
  return fallback;
}

function frameFromSongTextBoxPosition(position = {}) {
  const fallback = DEFAULT_TEXT_FRAME;
  return normalizeSlideTextObjectFrame({
    x: normalizedCssUnit(position.left, fallback.x),
    y: normalizedCssUnit(position.top, fallback.y),
    width: normalizedCssUnit(position.width, fallback.width),
    height: normalizedCssUnit(position.height, fallback.height),
  });
}

function blocksClone(blocks, fallbackText = "") {
  const source = Array.isArray(blocks) && blocks.length
    ? blocks
    : textToSegmentsBlocks(fallbackText);
  try {
    return structuredClone(source);
  } catch {
    return JSON.parse(JSON.stringify(source));
  }
}

function compactStyle(style) {
  return Object.fromEntries(
    Object.entries(style || {}).filter(([, value]) => value !== undefined && value !== null),
  );
}

function deckObjectFromSongPresentation(object, { fallbackText = "", sectionId = "", pageIndex = 0, objectIndex = 0 } = {}) {
  const hasImage = object?.kind === "image" || (object?.image && typeof object.image === "object");
  const hasShape = object?.kind === "shape" || (object?.shape && typeof object.shape === "object");
  const kind = hasImage ? "image" : hasShape ? "shape" : "text";
  const base = {
    id: object?.id || `obj_${sectionId || pageIndex}_${objectIndex}`,
    kind,
    frame: frameFromSongTextBoxPosition(object?.textBoxPosition || {}),
    zIndex: Number.isFinite(object?.zIndex) ? object.zIndex : objectIndex + 1,
    opacity: Number.isFinite(object?.opacity) ? object.opacity : 1,
  };

  if (kind === "image") {
    const image = object?.image && typeof object.image === "object" ? object.image : {};
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
    const shape = object?.shape && typeof object.shape === "object" ? object.shape : {};
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
    role: "body",
    autofit: object?.autofit || "fit",
    style: compactStyle({
      color: object?.color,
      fontFamily: object?.fontFamily,
      fontSize: Number.isFinite(Number(object?.fontSize)) ? Number(object.fontSize) : undefined,
      minFontSize: Number.isFinite(Number(object?.minFontSize)) ? Number(object.minFontSize) : undefined,
      align: object?.align,
      verticalAlign: object?.verticalAlign,
      fontWeight: object?.fontWeight,
      fontStyle: object?.fontStyle,
      textDecoration: object?.textDecoration,
      lineHeight: Number.isFinite(Number(object?.lineHeight)) ? Number(object.lineHeight) : undefined,
    }),
    ...(object?.background && typeof object.background === "object"
      ? { background: { ...object.background } }
      : {}),
    blocks: blocksClone(object?.blocks, fallbackText),
  };
}

function deckFromSongQueueItem(item) {
  const song = item?.songSnapshot ? normalizeToSongAST(item.songSnapshot) : null;
  if (!song?.sections?.length) return null;
  const render = {
    ...(song.defaultRender && typeof song.defaultRender === "object" ? song.defaultRender : {}),
    ...(item.render && typeof item.render === "object" ? item.render : {}),
  };
  const theme = {
    ...DEFAULT_DECK_THEME,
    ...(render.fontFamily ? { fontFamily: render.fontFamily } : {}),
    ...(Number.isFinite(Number(render.fontSize)) ? { fontSize: Number(render.fontSize) } : {}),
    ...(render.color ? { textColor: render.color } : {}),
    ...(render.backgroundColor ? { backgroundColor: render.backgroundColor } : {}),
  };
  const pages = song.sections.map((section, index) => {
    const fallbackText = blocksToText(section.blocks || []);
    const sectionObjects = Array.isArray(section.slideObjects) && section.slideObjects.length
      ? section.slideObjects
      : Array.isArray(section.slideTextObjects) && section.slideTextObjects.length
        ? section.slideTextObjects
        : null;
    const objects = sectionObjects
      ? sectionObjects.map((object, objectIndex) => deckObjectFromSongPresentation(object, {
          fallbackText,
          sectionId: section.id,
          pageIndex: index,
          objectIndex,
        }))
      : [createTextObject({ text: fallbackText })];
    return {
      id: section.id || `page_${index + 1}`,
      label: section.label || `Page ${index + 1}`,
      durationMs: 0,
      autoAdvance: false,
      background: {
        type: "color",
        color: theme.backgroundColor || DEFAULT_DECK_THEME.backgroundColor,
      },
      notes: "",
      objects,
    };
  });
  return normalizeSlideDeck({
    id: queueItemDeckId(item) || song.id,
    title: item?.name || song.title || "Slide Deck",
    folderId: null,
    theme,
    pages,
  });
}

function deckFromQueueItem(item) {
  if (!isQueueItemDeck(item)) return null;
  const snapshot = item?.deckSnapshot ? normalizeSlideDeck(item.deckSnapshot) : null;
  return snapshot || deckFromSongQueueItem(item);
}

async function loadDeckQueueItemIntoWorkspace(item, token) {
  const deck = deckFromQueueItem(item);
  if (!deck) return false;
  if (typeof token === "number" && !isCurrentPreviewLoad(token)) return false;
  const pageId =
    item?.render?.currentSectionId ||
    item?.source?.pageId ||
    deck.pages?.[0]?.id ||
    null;
  currentSongQueueItem = item || null;
  currentWorkspaceSongDeck = deck;
  currentWorkspaceSong = item?.songSnapshot || deckToTransientSong(deck);
  currentSongRenderState = mergeSongRenderState(
    DEFAULT_SONG_RENDER,
    item?.render || deckDefaultRender(deck),
  );
  currentSongSectionId = pageId;
  loadDeckIntoWorkspace(deck, {
    pageId,
    queueItem: item || null,
    documentType: item?.type === "song" ? SONG_DECK_DOCUMENT_TYPE : "deck",
  });
  return true;
}

async function loadSongIntoWorkspace(song, opts = {}) {
  const sourceDocument = song || null;
  currentWorkspaceSongDeck = sourceDocument
    ? songDeckDocumentFromSongDocument(sourceDocument, opts.render || currentSongRenderState)
    : null;
  currentWorkspaceSong = currentWorkspaceSongDeck
    ? transientSongFromSongDocument(currentWorkspaceSongDeck)
    : null;

  const nextLowerThirdSongId = currentWorkspaceSong?.id || "";
  if (
    songLowerThirdState.sourceKey &&
    !songLowerThirdState.sourceKey.startsWith(`${nextLowerThirdSongId}\u0000`)
  ) {
    songLowerThirdState.sourceKey = nextLowerThirdSongId
      ? `${nextLowerThirdSongId}\u0000`
      : "";
    songLowerThirdState.sectionId = "";
    songLowerThirdState.sourceText = "";
    songLowerThirdState.layoutKey = "";
    songLowerThirdState.segments = [];
    songLowerThirdState.index = 0;
    document.getElementById("songLowerThirdCueList")?.replaceChildren();
    document.getElementById("songLowerThirdPreviewText")?.replaceChildren();
    document.getElementById("songLowerThirdPreviewReference")?.replaceChildren();
    document
      .getElementById("songLowerThirdPreviewRender")
      ?.classList.remove("is-operator-cued");
    markSongAudiencePreviewSelection({ text: "", blockIds: [] });
  }

  const launcher = document.getElementById("songsLauncher");
  const slide = document.getElementById("songsPreviewSlide");
  if (launcher && slide) {
    if (currentWorkspaceSong) {
      launcher.hidden = true;
      slide.hidden = false;
    } else {
      launcher.hidden = false;
      slide.hidden = true;
    }
  }

  if (!song) {
    document.getElementById("songsWorkspaceTitle").textContent = "Select a Song";
    document.getElementById("songsShowNowBtn").disabled = true;
    document.getElementById("songsAddScheduleBtn").disabled = true;
    document.getElementById("songsEditBtn").disabled = true;
    document.getElementById("songsDeleteBtn").disabled = true;
    const saveToLibraryBtn = document.getElementById("songsSaveToLibraryBtn");
    if (saveToLibraryBtn) {
      saveToLibraryBtn.disabled = true;
      saveToLibraryBtn.hidden = true;
    }
    document.getElementById("songEditorDrawer")?.setAttribute("hidden", "");
    document.getElementById("songArrangementStrip").innerHTML = "";
    const prevBtn = document.getElementById("songPrevSecBtn");
    const nextBtn = document.getElementById("songNextSecBtn");
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (slide) slide.innerHTML = "";
    currentSongSectionId = null;
    currentSongSequenceEntryId = null;
    currentSongSlideId = null;
    currentSongQueueItem = null;
    currentWorkspaceSongDeck = null;
    syncSongsMoveFolderSelect(null);
    syncSongSlideNavigator();
    syncSongLowerThirdForSection(null);
    return;
  }

  if (opts.render) {
    currentSongRenderState = mergeSongRenderState(currentSongRenderState, opts.render);
  } else if (sourceDocument) {
    currentSongRenderState = mergeSongRenderState(
      currentSongRenderState,
      songRenderStateFromSongDocument(sourceDocument),
    );
  }

  const inLibrary = await checkIfSongInLibrary(currentWorkspaceSong.id);
  const saveToLibraryBtn = document.getElementById("songsSaveToLibraryBtn");
  if (saveToLibraryBtn) {
    saveToLibraryBtn.hidden = inLibrary;
    saveToLibraryBtn.disabled = inLibrary;
  }

  document.getElementById("songsWorkspaceTitle").textContent = currentWorkspaceSong.title;
  document.getElementById("songsShowNowBtn").disabled = false;
  document.getElementById("songsAddScheduleBtn").disabled = false;
  document.getElementById("songsEditBtn").disabled = false;
  document.getElementById("songsDeleteBtn").disabled = !inLibrary;
  document.getElementById("songEditorDrawer")?.setAttribute("hidden", "");
  syncSongsMoveFolderSelect(currentWorkspaceSongDeck || currentWorkspaceSong, inLibrary);

  const enabledSections = currentSongEnabledSections();
  if (!currentSongSectionId || !enabledSections.some((s) => s.id === currentSongSectionId)) {
    currentSongSectionId = enabledSections[0]?.id || currentWorkspaceSong.sections?.[0]?.id || null;
  }
  syncCurrentSongSequenceEntry();
  const initialPresentation = currentResolvedSongPresentation();
  const initialUnit =
    initialPresentation?.resolvedPresentation?.slides?.find(
      (unit) => unit.slideId === currentSongSlideId,
    ) ||
    initialPresentation?.resolvedPresentation?.slides?.find(
      (unit) => unit.sequenceEntryId === currentSongSequenceEntryId,
    ) ||
    initialPresentation?.activeUnit;
  currentSongSlideId = initialUnit?.slideId || null;
  currentSongSequenceEntryId =
    initialUnit?.sequenceEntryId || currentSongSequenceEntryId;

  const strip = document.getElementById("songArrangementStrip");
  if (strip) {
    strip.innerHTML = "";
    for (const { section, entryId } of currentSongSequenceItems()) {
      const chip = document.createElement("button");
      chip.className = "pill-button";
      chip.type = "button";
      chip.textContent = section.label;
      chip.dataset.sectionId = section.id;
      chip.dataset.sequenceEntryId = entryId;
      if (entryId === currentSongSequenceEntryId) {
        chip.classList.add("primary-action");
      }
      chip.addEventListener("click", () => {
        void selectSongSection(section.id, { sequenceEntryId: entryId }).catch(console.error);
      });
      strip.appendChild(chip);
    }
  }

  const activeSection = currentSongActiveSection();
  if (activeSection) {
    renderSongSectionPreview(activeSection);
    syncCurrentSongQueueItemSection(activeSection.id);
  }
  updateSongNavButtonsState();
  syncSongSlideNavigator();
}

function updateSongNavButtonsState() {
  const prevBtn = document.getElementById("songPrevSecBtn");
  const nextBtn = document.getElementById("songNextSecBtn");
  if (!prevBtn || !nextBtn || !currentWorkspaceSong) {
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }
  const slides = currentResolvedSongPresentation()?.resolvedPresentation?.slides || [];
  if (slides.length <= 1) {
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }
  const currentIndex = slides.findIndex((item) => item.slideId === currentSongSlideId);
  prevBtn.disabled = currentIndex <= 0;
  nextBtn.disabled = currentIndex >= slides.length - 1 || currentIndex === -1;
}

function navigateSongSection(direction) {
  if (!currentWorkspaceSong) return;
  const slides = currentResolvedSongPresentation()?.resolvedPresentation?.slides || [];
  if (slides.length === 0) return;
  const currentIndex = slides.findIndex((item) => item.slideId === currentSongSlideId);
  if (currentIndex === -1) return;
  const nextIndex = currentIndex + direction;
  if (nextIndex >= 0 && nextIndex < slides.length) {
    const nextItem = slides[nextIndex];
    void selectSongSection(nextItem.sectionId, {
      sequenceEntryId: nextItem.sequenceEntryId,
      slideId: nextItem.slideId,
    }).catch(console.error);
  }
}

async function renderSongSectionPreview(section) {
  try {
  const renderToken = ++songPreviewRenderToken;
  const isEditing = document.getElementById("songEditorDrawer")?.hidden === false;
  const targetId = isEditing ? "songEditorLivePreviewSlide" : "songsPreviewSlide";
  const preview = document.getElementById(targetId);
  if (!preview || !section || !currentWorkspaceSong) return;
  currentSongSectionId = section.id;
  const targetItem = songItemForAudienceResolution(currentSongPresentationItem());
  await waitForTextFonts(
    [
      targetItem?.resolvedTheme?.typography?.fontFamily,
      currentSongRenderState.fontFamily,
    ],
    {
      documentRef: globalThis.document,
      sample: currentWorkspaceSong.title || "EMS",
      fontSize:
        targetItem?.resolvedTheme?.typography?.fontSize ||
        currentSongRenderState.fontSize,
    },
  );
  if (renderToken !== songPreviewRenderToken) return;

  let presentation = currentResolvedSongPresentation();
  if (
    presentation?.activeUnit?.sectionId &&
    presentation.activeUnit.sectionId !== section.id
  ) {
    currentSongSlideId = null;
    currentSongSequenceEntryId =
      currentSongSequenceItems().find((item) => item.section.id === section.id)?.entryId ||
      currentSongSequenceEntryId;
    presentation = currentResolvedSongPresentation();
  }
  const message = presentation?.message;
  if (!message) return;
  currentSongSlideId = presentation.activeUnit?.slideId || currentSongSlideId;
  currentSongSequenceEntryId =
    presentation.activeUnit?.sequenceEntryId || currentSongSequenceEntryId;

  preview.style.backgroundColor = message.backgroundColor || "#000000";
  const outputFontSize = Number(message.fontSize) || DEFAULT_SONG_RENDER.fontSize;
  const fittedStage = isEditing ? null : layoutSongPreviewStage(preview);
  const previewRect = preview.getBoundingClientRect?.() || {};
  const previewWidth =
    fittedStage?.width ||
    preview.clientWidth ||
    previewRect.width ||
    preview.parentElement?.clientWidth ||
    0;
  if (!previewWidth && !isEditing && isSongsWorkspaceVisible()) {
    scheduleSongPreviewRerender();
  }
  const scaledPreviewFontSize = Math.max(
    12,
    outputFontSize *
      Math.max(previewWidth || 1280, 1) /
      (fittedStage?.outputSize?.width || selectedBiblePreviewOutputSize("dspSelct").width),
  );
  preview.style.setProperty('--base-font-size', outputFontSize);
  preview.style.setProperty('--song-preview-font-size', `${scaledPreviewFontSize}px`);
  if (message.fontFamily) {
    preview.style.setProperty('--font-family', songFontFamilyCSS(message.fontFamily));
  }
  renderResolvedSongMessageIntoPreview(preview, message, { fontSize: scaledPreviewFontSize });
  applyOperatorSelectionContrast(preview, message);

  if (isEditing) {
    syncSongEditorWorkspaceStyles(message);
  } else {
    updateSongArrangementSelection();
    updateSongSlideNavigatorSelection({ scroll: false });
  }
  syncSongLowerThirdForSection(section);
  } catch (err) {
     try {
       window.electron?.ipcRenderer?.send("log-to-file", `[ERROR] in renderSongSectionPreview: ${err.message}\n${err.stack}`);
     } catch (e) {}
     console.error(err);
  }
}

function songLowerThirdCueKey(index = songLowerThirdState.index) {
  return `${currentWorkspaceSong?.id || "song"}\u0000${songLowerThirdState.sectionId}\u0000${index}`;
}

function syncSongLowerThirdForSection(section = currentSongActiveSection(), { rebuild = false } = {}) {
  const panel = document.getElementById("songLowerThirdPanel");
  if (!panel) return;
  const lowerThirdEnabled = isBibleLowerThirdFeatureEnabled();
  panel.hidden = !currentWorkspaceSong || !lowerThirdEnabled;
  panel.setAttribute("aria-hidden", panel.hidden ? "true" : "false");
  if (!lowerThirdEnabled || !currentWorkspaceSong || !section) {
    songLowerThirdState.sourceKey = "";
    songLowerThirdState.sectionId = "";
    songLowerThirdState.sourceText = "";
    songLowerThirdState.layoutKey = "";
    songLowerThirdState.segments = [];
    songLowerThirdState.index = 0;
    renderSongLowerThirdControls();
    return;
  }
  const resolved = resolvedSongPresentation(
    songItemForLowerThirdResolution(currentSongPresentationItem()),
  );
  const presentation = resolved?.resolvedPresentation;
  const sectionSlides = (presentation?.slides || []).filter(
    (slide) =>
      slide.sequenceEntryId === currentSongSequenceEntryId ||
      (!currentSongSequenceEntryId && slide.sectionId === section.id),
  );
  const audiencePresentation = currentResolvedSongPresentation()?.resolvedPresentation;
  const audienceSlide =
    audiencePresentation?.slides?.find((slide) => slide.slideId === currentSongSlideId) ||
    audiencePresentation?.activeSlide ||
    null;
  const audienceBlockIds = new Set(
    (Array.isArray(audienceSlide?.blocks) ? audienceSlide.blocks : [])
      .map((block) => block?.id)
      .filter((blockId) => typeof blockId === "string" && blockId.length > 0),
  );
  const slidesForAudienceCue = audienceSlide
    ? sectionSlides.filter((slide) => {
        const sharesBlock = (Array.isArray(slide.blocks) ? slide.blocks : []).some(
          (block) => audienceBlockIds.has(block?.id),
        );
        if (sharesBlock) return true;
        return (
          Number.isFinite(slide.sourceBlockStart) &&
          Number.isFinite(slide.sourceBlockEnd) &&
          Number.isFinite(audienceSlide.sourceBlockStart) &&
          Number.isFinite(audienceSlide.sourceBlockEnd) &&
          slide.sourceBlockEnd >= audienceSlide.sourceBlockStart &&
          slide.sourceBlockStart <= audienceSlide.sourceBlockEnd
        );
      })
    : sectionSlides;
  const cueSlides = slidesForAudienceCue.length > 0 ? slidesForAudienceCue : sectionSlides;
  const sourceText = cueSlides.map((slide) => slide.bodyText).join("\n").trim();
  const sourceKey = [
    currentWorkspaceSong.id || "song",
    currentSongSequenceEntryId || section.id,
    audienceSlide?.slideId || currentSongSlideId || "",
  ].join("\u0000");
  const layoutKey = presentation?.layoutKey || "";
  const sourceChanged =
    songLowerThirdState.sourceKey !== sourceKey ||
    songLowerThirdState.sectionId !== section.id ||
    songLowerThirdState.sourceText !== sourceText ||
    songLowerThirdState.layoutKey !== layoutKey;
  if (rebuild || sourceChanged || songLowerThirdState.segments.length === 0) {
    songLowerThirdState.sourceKey = sourceKey;
    songLowerThirdState.sectionId = section.id;
    songLowerThirdState.sourceText = sourceText;
    songLowerThirdState.layoutKey = layoutKey;
    songLowerThirdState.segments = cueSlides.map((slide) => ({
      text: slide.bodyText,
      slideId: slide.slideId,
      sequenceEntryId: slide.sequenceEntryId,
      sourceBlockStart: slide.sourceBlockStart,
      sourceBlockEnd: slide.sourceBlockEnd,
      blockIds: (Array.isArray(slide.blocks) ? slide.blocks : [])
        .map((block) => block?.id)
        .filter((blockId) => typeof blockId === "string" && blockId.length > 0),
    }));
    songLowerThirdState.index = 0;
  }
  songLowerThirdState.index = clampLowerThirdSegmentIndex(
    songLowerThirdState.index,
    songLowerThirdState.segments,
  );
  renderSongLowerThirdControls();
}

function buildSongLowerThirdMessage() {
  const cue = songLowerThirdState.segments[songLowerThirdState.index] || null;
  const item = songItemForLowerThirdResolution(currentSongPresentationItem());
  if (item && cue?.slideId) {
    item.currentSlideId = cue.slideId;
    item.currentSequenceEntryId = cue.sequenceEntryId || item.currentSequenceEntryId;
    item.render.currentSlideId = cue.slideId;
    item.render.currentSequenceEntryId = item.currentSequenceEntryId;
  }
  const presentation = resolvedSongPresentation(item);
  const base = presentation?.message || {};
  const text = presentation?.activeUnit?.bodyText || cue?.text || "";
  const keyColor =
    bibleDesignerState.lowerThirdChromaKeyColor || lowerThirdPreferenceChromaKeyColor;
  const message = {
    ...base,
    blocks: [],
    slideObjects: [],
    slideTextObjects: [],
    text,
    bodyText: text,
    fullBodyText: songLowerThirdState.sourceText,
    referenceText: "",
    attributionText: "",
    copyrightText: "",
    textBoxPosition: null,
    fontFamily: base.fontFamily || SCRIPTURE_FONT_FAMILY,
    lowerThirdFontFamily: base.fontFamily || "",
    fontSize: base.fontSize || SCRIPTURE_BODY_FONT_SIZE,
    lowerThirdFontSize: base.fontSize || SCRIPTURE_LOWER_THIRD_DEFAULT_FONT_SIZE,
    minFontSize: base.minFontSize || SCRIPTURE_MIN_BODY_FONT_SIZE,
    fontWeight: base.fontWeight || SCRIPTURE_FONT_WEIGHT,
    lineHeight: base.lineHeight || SCRIPTURE_LINE_HEIGHT,
    color: bibleDesignerState.lowerThirdColor || SCRIPTURE_LOWER_THIRD_TEXT_COLOR,
    lowerThirdColor: bibleDesignerState.lowerThirdColor || SCRIPTURE_LOWER_THIRD_TEXT_COLOR,
    lowerThirdBarBackgroundColor:
      bibleDesignerState.lowerThirdBarBackgroundColor || SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND,
    lowerThirdBarBackgroundPath: bibleDesignerState.lowerThirdBarBackgroundPath || "",
    look: SCRIPTURE_LOOK_LOWER_THIRD,
    outputRole: "lower-third",
    backgroundColor: keyColor,
    chromaKeyColor: keyColor,
    backgroundImage: "",
    backgroundVideo: "",
    backgroundPath: "",
    lowerThirdSegments: songLowerThirdState.segments,
    lowerThirdSegmentIndex: songLowerThirdState.index,
    lowerThirdSegmentCount: songLowerThirdState.segments.length,
    resolvedPresentation: presentation?.resolvedPresentation || null,
    resolvedUnit: presentation?.activeUnit || null,
    slideId: presentation?.activeUnit?.slideId || cue?.slideId || null,
    position: { vertical: "center", horizontal: "center" },
  };
  return themeLowerThirdMessageIfApplied(
    enrichLowerThirdPresentationMessage(message, pathToMediaUrl),
    "song",
  );
}

function installSongLowerThirdPreviewScaleObserver() {
  const shell = document.getElementById("songLowerThirdPreviewShell");
  installLowerThirdPreviewScaleObserver(
    shell,
    renderSongLowerThirdControls,
    "_songLowerThirdPreviewScaleObserver",
  );
}

function renderSongLowerThirdControls() {
  const list = document.getElementById("songLowerThirdCueList");
  if (!list) return;
  list.replaceChildren();
  songLowerThirdState.segments.forEach((segment, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "bible-lower-third-cue-row";
    row.dataset.cueIndex = String(index);
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", index === songLowerThirdState.index ? "true" : "false");
    row.classList.toggle("is-cued", index === songLowerThirdState.index);
    // Bind the generated row itself. The Songs workspace can be rebuilt,
    // replacing the cue-list element and its delegated listener; direct row
    // activation ensures every regenerated cue remains selectable, including
    // the final row at the bottom of the scrolling list.
    row.addEventListener("click", () => setSongLowerThirdCue(index, { focus: true }));
    const isLive = bibleLowerThirdOutputActive && songLowerThirdState.liveKey === songLowerThirdCueKey(index);
    row.classList.toggle("is-live", isLive);
    const marker = document.createElement("span");
    marker.className = "bible-lower-third-cue-row__marker";
    marker.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "bible-lower-third-cue-row__text";
    text.textContent = segment.text;
    const live = document.createElement("span");
    live.className = "bible-lower-third-cue-row__live";
    live.textContent = isLive ? "Live" : "";
    row.append(marker, text, live);
    list.append(row);
  });
  list.querySelector(".is-cued")?.scrollIntoView?.({ block: "nearest" });

  const count = songLowerThirdState.segments.length;
  const index = songLowerThirdState.index;
  const status = document.getElementById("songLowerThirdStatus");
  if (status) status.textContent = `Cue ${count ? index + 1 : 0} of ${count}`;
  const prev = document.getElementById("songLowerThirdPrevBtn");
  const next = document.getElementById("songLowerThirdNextBtn");
  const show = document.getElementById("songLowerThirdShowBtn");
  if (prev) prev.disabled = count === 0 || index <= 0;
  if (next) next.disabled = count === 0 || index >= count - 1;
  if (show) {
    show.disabled = count === 0;
    show.textContent = bibleLowerThirdOutputActive ? "Update" : "Show";
  }

  const shell = document.getElementById("songLowerThirdPreviewShell");
  const render = document.getElementById("songLowerThirdPreviewRender");
  const body = document.getElementById("songLowerThirdPreviewText");
  const reference = document.getElementById("songLowerThirdPreviewReference");
  const message = buildSongLowerThirdMessage();
  renderLowerThirdPreview({
    shell,
    render,
    body,
    reference,
    message,
    outputSize: selectedBiblePreviewOutputSize("lowerThirdDspSelct"),
    renderMessage: applyScriptureRenderToPreview,
    cued: count > 0,
  });
  const selectedCueText = normalizedCueMatchText(message.bodyText).toLocaleLowerCase();
  const selectedCueOccurrence = songLowerThirdState.segments
    .slice(0, index)
    .filter(
      (segment) =>
        normalizedCueMatchText(segment?.text).toLocaleLowerCase() === selectedCueText,
    ).length;
  markSongAudiencePreviewSelection(
    songLowerThirdState.segments[index] || { text: message.bodyText },
    selectedCueOccurrence,
  );
}

function setSongLowerThirdCue(index, options = {}) {
  songLowerThirdState.index = clampLowerThirdSegmentIndex(index, songLowerThirdState.segments);
  renderSongLowerThirdControls();
  if (options.focus === true) {
    const selectedIndex = songLowerThirdState.index;
    requestAnimationFrame(() => {
      const selectedRow = document.querySelector(
        `#songLowerThirdCueList [data-cue-index="${selectedIndex}"]`,
      );
      selectedRow?.focus?.({ preventScroll: true });
      selectedRow?.scrollIntoView?.({ block: "nearest" });
    });
  }
}

async function waitForSongLowerThirdFonts() {
  const item = songItemForLowerThirdResolution(currentSongPresentationItem());
  await waitForTextFonts(
    [
      item?.resolvedTheme?.typography?.fontFamily,
      item?.render?.fontFamily,
      bibleDesignerState.lowerThirdFontFamily,
    ],
    {
      documentRef: globalThis.document,
      sample: songLowerThirdState.sourceText || currentWorkspaceSong?.title || "EMS",
      fontSize:
        item?.resolvedTheme?.typography?.fontSize ||
        bibleDesignerState.lowerThirdFontSize ||
        item?.render?.fontSize,
    },
  );
}

function pushLiveSongLowerThirdMessage() {
  sendBibleLowerThirdTextMessage(buildSongLowerThirdMessage());
  setSharedRendererState({ activeLowerThirdContentType: "song" });
  setSharedRendererState({ bibleLowerThirdLiveCueKey: "" });
  songLowerThirdState.liveKey = songLowerThirdCueKey();
  renderSongLowerThirdControls();
}

async function sendSongLowerThirdForLiveItem() {
  if (!isBibleLowerThirdFeatureEnabled() || !hasLowerThirdOutputSelected()) {
    return false;
  }
  const alreadyOpen = bibleLowerThirdOutputActive;
  const updateToken = nextLowerThirdOutputUpdateToken();
  syncSongLowerThirdForSection();
  await waitForSongLowerThirdFonts();
  if (updateToken !== lowerThirdOutputUpdateToken) return false;
  if (alreadyOpen) {
    pushLiveSongLowerThirdMessage();
    return true;
  }
  const displayValue = selectedDisplayValueFromSelect("lowerThirdDspSelct");
  if (!displayValue) return false;
  const message = buildSongLowerThirdMessage();
  const windowOptions = {
    backgroundColor: message.chromaKeyColor,
    webPreferences: {
      v8CacheOptions: "bypassHeatCheckAndEagerCompile",
      contextIsolation: true,
      sandbox: true,
      enableWebSQL: false,
      webgl: false,
      skipTaskbar: true,
      additionalArguments: [
        "__mediafile-ems=" + encodeURIComponent(songQueuePath(currentWorkspaceSong?.id || "song")),
        "__isText",
        "__lowerThirdOutput",
      ],
      preload: `${__dirname}/../media-window/media_preload.min.js`,
      devTools: true,
    },
  };
  const windowId = await invoke("create-lower-third-window", windowOptions, displayValue);
  setSharedRendererState({ bibleLowerThirdOutputActive: Boolean(windowId) });
  if (!bibleLowerThirdOutputActive) return false;
  if (updateToken !== lowerThirdOutputUpdateToken) {
    sendBibleLowerThirdTextMessage(lowerThirdKeyOnlyMessage(
      message,
      message.chromaKeyColor || SCRIPTURE_LOWER_THIRD_CHROMA_KEY_COLOR,
    ), { remember: false, clearToggle: false, respectLiveTextClearState: false });
    return false;
  }
  window.setTimeout(() => {
    if (updateToken !== lowerThirdOutputUpdateToken) return;
    pushLiveSongLowerThirdMessage();
  }, 100);
  return true;
}

async function ensureSongLowerThirdOutput() {
  if (!isBibleLowerThirdFeatureEnabled()) {
    showGnomeToast("Lower-third controls are disabled in Preferences");
    return false;
  }
  if (!hasLowerThirdOutputSelected()) {
    showGnomeToast("Choose a lower-third output display");
    return false;
  }
  const started = await sendSongLowerThirdForLiveItem();
  if (!started) return false;
  setSharedRendererState({ isPlaying: true });
  setSharedRendererState({ isQueuePlaying: false });
  const item = currentSongPresentationItem();
  if (item) markSongShowNowPresentation(item);
  updateDynUI();
  return true;
}

async function showCuedSongLowerThird() {
  if (!isBibleLowerThirdFeatureEnabled()) {
    showGnomeToast("Lower-third controls are disabled in Preferences");
    return false;
  }
  if (!songLowerThirdState.segments.length) return false;
  if (!bibleLowerThirdOutputActive) return ensureSongLowerThirdOutput();
  const started = await sendSongLowerThirdForLiveItem();
  if (started) showGnomeToast("Song lower third updated");
  return started;
}

async function sendSongTextToOutput(item = null) {
  const sourceItem = songItemForAudienceResolution(item || currentSongPresentationItem());
  await waitForTextFonts(
    [
      sourceItem?.resolvedTheme?.typography?.fontFamily,
      sourceItem?.render?.fontFamily || sourceItem?.songSnapshot?.defaultRender?.fontFamily,
    ],
    {
      documentRef: globalThis.document,
      sample: sourceItem?.songSnapshot?.title || "EMS",
      fontSize: sourceItem?.render?.fontSize,
    },
  );
  const presentation = resolvedSongPresentation(sourceItem);
  if (!presentation?.message) return;
  const message = { ...presentation.message };
  const transitionItem =
    item && isQueueItemTransitionCapable(item)
      ? item
      : item && mediaQueue.includes(item) && isQueueItemSong(item)
        ? item
        : null;
  if (transitionItem) {
    message.transition = slideTransitionPayloadForQueueItem(transitionItem);
  }
  sendAudienceTextMessage("song", message);
}

function liveSongAudienceTextMessageForClear() {
  const liveItem = currentLiveQueueItem();
  if (isQueueItemSong(liveItem)) {
    return resolvedSongPresentation(songItemForAudienceResolution(liveItem))?.message || null;
  }
  if (lastAudienceSongTextMessage) return lastAudienceSongTextMessage;
  const presentation = resolvedSongPresentation(
    currentSongPresentationItem(),
  );
  return presentation?.message || null;
}

async function clearLiveSongText({ quiet = false } = {}) {
  if (!hasLiveAudienceTextPresentation("song")) {
    if (!quiet) showGnomeToast("No song text is live");
    return false;
  }
  const message = liveSongAudienceTextMessageForClear();
  if (!message) {
    if (!quiet) showGnomeToast("Could not clear song text");
    return false;
  }
  const clearedMessage = clearTextFromPresentationMessage(message);
  sendAudienceTextMessage("song", clearedMessage, {
    remember: false,
    clearToggle: false,
  });
  if (!quiet) showGnomeToast("Song text cleared");
  return true;
}

async function restoreLiveSongText({ quiet = false } = {}) {
  if (!hasLiveAudienceTextPresentation("song")) {
    if (!quiet) showGnomeToast("No song text is live");
    return false;
  }
  const message = lastAudienceSongTextMessage || liveSongAudienceTextMessageForClear();
  if (!message) {
    if (!quiet) showGnomeToast("Could not restore song text");
    return false;
  }
  sendAudienceTextMessage("song", message, { respectLiveTextClearState: false });
  if (!quiet) showGnomeToast("Song text restored");
  return true;
}

async function syncActiveScheduledSongPresentation() {
  if (!hasLiveAudienceTextPresentation("song")) return false;
  const liveIndex = currentQueueIndex;
  if (liveIndex < 0 || liveIndex >= mediaQueue.length) {
    if (!isCurrentWorkspaceSongShownNow()) return false;
    const item = currentSongPresentationItem();
    if (!item) return false;
    await sendSongTextToOutput(item);
    return true;
  }
  const item = mediaQueue[liveIndex];
  if (!isQueueItemSong(item)) {
    if (!isCurrentWorkspaceSongShownNow()) return false;
    const currentItem = currentSongPresentationItem();
    if (!currentItem) return false;
    await sendSongTextToOutput(currentItem);
    return true;
  }
  await sendSongTextToOutput(item);
  return true;
}

async function showSongTextNow() {
  if (!currentWorkspaceSong) {
    showGnomeToast("Choose a song to show");
    return false;
  }
  if (!hasAudienceOutputSelected()) {
    showGnomeToast("Choose an audience output display");
    return false;
  }

  const transientEntry = buildSongQueueEntryFromDeck({
    deck: currentWorkspaceSongDeck || currentWorkspaceSong,
    render: currentSongRenderState,
    currentSectionId: currentSongSectionId,
  });
  if (!transientEntry) return false;

  try {
    setSharedRendererState({ mediaPlaybackEndedPending: false });
    setSharedRendererState({ pendingQueueSwitchIndex: null });
    setSharedRendererState({ pendingQueueSwitchStartTime: 0 });
    setSharedRendererState({ userStopPresentationPending: false });
    setSharedRendererState({ currentQueueIndex: -1 });

    if (isActiveMediaWindow() && activeMediaWindowContentType === "song") {
      await sendSongTextToOutput(transientEntry);
      setSharedRendererState({ isPlaying: true });
      setSharedRendererState({ isQueuePlaying: false });
      setSharedRendererState({ activeMediaWindowContentType: "song" });
      markSongShowNowPresentation(transientEntry);
      setSharedRendererState({ isActiveMediaWindowCache: true });
      updateDynUI();
      renderQueue();
      return true;
    }

    const audienceStarted = await createMediaWindow({
      textItem: transientEntry,
      transientText: true,
      songItem: true,
    });
    if (!audienceStarted) {
      showGnomeToast("No song output started");
      return false;
    }
    setSharedRendererState({ activeMediaWindowContentType: "song" });
    setSharedRendererState({ isPlaying: true });
    setSharedRendererState({ isQueuePlaying: false });
    markSongShowNowPresentation(transientEntry);
    setSharedRendererState({ isActiveMediaWindowCache: true });
    updateDynUI();
    renderQueue();
    return true;
  } catch (err) {
    console.error("Failed to show song:", err);
    showGnomeToast("Failed to show song");
    return false;
  }
}

async function insertSongInSchedule() {
  if (!currentWorkspaceSong) {
    showGnomeToast("Choose a song to schedule");
    return false;
  }
  const entry = buildSongQueueEntryFromDeck({
    deck: currentWorkspaceSongDeck || currentWorkspaceSong,
    render: currentSongRenderState,
    currentSectionId: currentSongSectionId,
  });
  if (!entry) return false;
  invalidateQueueUndoToastAfterMutation();
  insertQueueEntriesAfterSelection([entry]);
  renderQueue();
  saveMediaFile();
  showGnomeToast(`Scheduled ${entry.name}`);
  return true;
}

async function importSongFromDialog() {
  try {
    const res = await invoke("show-import-song-dialog");
    if (!res || res.canceled) return;
    const filePaths = Array.isArray(res.filePaths)
      ? res.filePaths.filter(Boolean)
      : typeof res.filePath === "string" && res.filePath
        ? [res.filePath]
        : typeof res.filePaths === "string" && res.filePaths
          ? [res.filePaths]
          : [];
    if (filePaths.length === 0) return;

    const searchInput = document.getElementById("songsSearchInput");
    const defaultFolderId =
      currentSongFolderFilter !== SONG_FOLDER_ALL &&
      currentSongFolderFilter !== SONG_FOLDER_UNFILED
        ? currentSongFolderFilter
        : null;

    const result = await songsAPI.importFiles(filePaths, {
      defaultFolderId,
      search: {
        query: searchInput?.value || "",
        ...songSearchOptionsForCurrentFolder(),
      },
    });

    const importedCount = Array.isArray(result?.imported) ? result.imported.length : 0;
    const failedCount = Array.isArray(result?.failed) ? result.failed.length : 0;

    if (result?.lastSong) {
      currentSongRenderState = mergeSongRenderState(DEFAULT_SONG_RENDER, {
        copyright: result.lastSong.metadata?.copyright || "",
        ccliNumber: result.lastSong.metadata?.ccliNumber || null,
      });
      await loadSongIntoWorkspace(result.lastSong, {
        render: currentSongRenderState,
      });
    }

    await refreshSongFolders(result?.folders ?? null);
    if (searchInput) {
      await refreshSongsBrowser(searchInput.value, result?.searchResults ?? null);
    }

    if (importedCount > 0 && failedCount === 0) {
      showGnomeToast(`Imported ${importedCount} song${importedCount === 1 ? "" : "s"}`);
    } else if (importedCount > 0) {
      showGnomeToast(`Imported ${importedCount} song(s), ${failedCount} failed`);
    } else {
      showGnomeToast(
        failedCount === 1 ? "Song could not be imported" : `${failedCount} songs could not be imported`,
      );
    }

    const failures = Array.isArray(result?.failed) ? result.failed : [];
    for (const failure of failures) {
      console.error(`Song import failed for ${failure.path}:`, failure.error);
    }
    if (failures.length > 0) {
      await invoke("show-song-import-results-dialog", {
        importedCount,
        failed: failures,
      });
    }
  } catch (err) {
    console.error("Song import failed:", err);
    const message =
      err instanceof Error && err.message ? err.message : "An unknown import error occurred.";
    showGnomeToast("Song import could not start");
    await invoke("show-song-import-results-dialog", {
      importedCount: 0,
      failed: [{ path: "Song import", error: message }],
    }).catch((dialogError) => {
      console.error("Could not show song import error details:", dialogError);
    });
  }
}

async function openSongsWorkspaceFromButton() {
  currentWorkspaceSong = null;
  currentWorkspaceSongDeck = null;
  currentSongSectionId = null;
  currentSongSequenceEntryId = null;
  currentSongSlideId = null;
  currentSongQueueItem = null;
  document.getElementById("songEditorDrawer")?.setAttribute("hidden", "");
  const launcher = document.getElementById("songsLauncher");
  const slide = document.getElementById("songsPreviewSlide");
  if (launcher) launcher.hidden = false;
  if (slide) slide.hidden = true;
  syncSongSlideNavigator();

  showSongsWorkspace();
  await songsAPI.waitForReady();
  await refreshSongFolders();
  await refreshSongsBrowser();
}

/* ════════════════════════════════════════════════════════════
   SLIDES WORKSPACE
   ════════════════════════════════════════════════════════════ */

let currentDeck = null;
let currentDeckPageId = null;
let currentDeckFolderFilter = null;
let currentDeckDocumentType = "deck";
let activeSlideTextObjectId = null;
let slideTextObjectBackgroundTargetId = null;
let slideObjectImageTargetId = null;
let slideObjectImageInsertPoint = null;
let slideTextSelectionState = null;
let slideObjectClipboard = null;
let slideObjectPasteCount = 0;
let deckDirty = false;
let deckLibraryDecks = [];
let deckLibraryFolders = [];
const SLIDE_UNDO_LIMIT = 50;
let slideUndoStack = [];
let slideRedoStack = [];
let slideUndoTransaction = null;
let slideUndoRestoring = false;
const SLIDE_THUMBNAIL_WIDTH = 320;
const SLIDE_THUMBNAIL_HEIGHT = 180;
const SLIDE_THUMBNAIL_MIN_PIXEL_RATIO = 2;

function slideThumbnailPixelRatio() {
  const deviceRatio = Number(globalThis.devicePixelRatio) || 1;
  return Math.max(SLIDE_THUMBNAIL_MIN_PIXEL_RATIO, Math.min(3, deviceRatio));
}
const SLIDE_THUMBNAIL_IDLE_MS = 3000;
const slideThumbnailCache = new Map();
const slideThumbnailTimers = new Map();

const SLIDE_LAYOUT_TEMPLATES = Object.freeze([
  {
    id: "blank",
    label: "Blank",
    objects: [],
  },
  {
    id: "center",
    label: "Center",
    objects: [
      { frame: { x: 0.12, y: 0.2, width: 0.76, height: 0.6 }, align: "center", verticalAlign: "center" },
    ],
  },
  {
    id: "left",
    label: "Left",
    objects: [
      { frame: { x: 0.07, y: 0.16, width: 0.46, height: 0.68 }, align: "left", verticalAlign: "center" },
    ],
  },
  {
    id: "right",
    label: "Right",
    objects: [
      { frame: { x: 0.47, y: 0.16, width: 0.46, height: 0.68 }, align: "right", verticalAlign: "center" },
    ],
  },
  {
    id: "two-column",
    label: "Two Columns",
    objects: [
      { frame: { x: 0.07, y: 0.16, width: 0.4, height: 0.68 }, align: "left", verticalAlign: "center" },
      { frame: { x: 0.53, y: 0.16, width: 0.4, height: 0.68 }, align: "left", verticalAlign: "center" },
    ],
  },
  {
    id: "title-body",
    label: "Title + Body",
    objects: [
      { frame: { x: 0.1, y: 0.1, width: 0.8, height: 0.18 }, align: "center", verticalAlign: "center", fontScale: 0.78 },
      { frame: { x: 0.14, y: 0.36, width: 0.72, height: 0.44 }, align: "center", verticalAlign: "center", fontScale: 0.58 },
    ],
  },
  {
    id: "lower-third",
    label: "Lower Third",
    objects: [
      { frame: { x: 0.08, y: 0.65, width: 0.84, height: 0.22 }, align: "center", verticalAlign: "center", fontScale: 0.62 },
    ],
  },
]);

function setDeckDirty(dirty) {
  deckDirty = !!dirty;
  const saveBtn = document.getElementById("slidesSaveDeckBtn");
  if (saveBtn) saveBtn.disabled = !currentDeck || !deckDirty;
  syncSlidesWorkspaceTitle();
  syncSlideUndoRedoButtons();
  if (deckDirty) scheduleCurrentSlideThumbnailRefresh();
}

function syncSlidesWorkspaceTitle() {
  const titleEl = document.getElementById("slidesWorkspaceTitle");
  if (titleEl) {
    titleEl.textContent = currentDeck
      ? `${currentDeckIsSongDocument() ? "Song: " : ""}${currentDeck.title || "Untitled Deck"}${deckDirty ? " •" : ""}`
      : "Select or Create a Deck";
  }
  const titleBtn = document.getElementById("slidesWorkspaceTitleButton");
  if (titleBtn) titleBtn.disabled = !currentDeck;
}

function currentDeckIsSongDocument() {
  return Boolean(
    currentDeckDocumentType === SONG_DECK_DOCUMENT_TYPE ||
      currentDeck?.documentType === SONG_DECK_DOCUMENT_TYPE ||
      currentDeck?.type === SONG_DECK_DOCUMENT_TYPE,
  );
}

function cloneSlideDeckValue(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function createSlideEditorCheckpoint() {
  if (!currentDeck) return null;
  return {
    deck: cloneSlideDeckValue(currentDeck),
    pageId: currentDeckPageId,
    activeObjectId: activeSlideTextObjectId,
    dirty: deckDirty,
  };
}

function slideCheckpointSignature(checkpoint) {
  if (!checkpoint?.deck) return "";
  try {
    return JSON.stringify({
      deck: checkpoint.deck,
      pageId: checkpoint.pageId || null,
      activeObjectId: checkpoint.activeObjectId || null,
      dirty: Boolean(checkpoint.dirty),
    });
  } catch {
    return "";
  }
}

function slideCheckpointsEqual(left, right) {
  return Boolean(left && right && slideCheckpointSignature(left) === slideCheckpointSignature(right));
}

function pushSlideHistoryEntry(stack, checkpoint) {
  if (!checkpoint?.deck) return false;
  const last = stack[stack.length - 1];
  if (slideCheckpointsEqual(last, checkpoint)) return false;
  stack.push(checkpoint);
  if (stack.length > SLIDE_UNDO_LIMIT) stack.shift();
  return true;
}

function syncSlideUndoRedoButtons() {
  const undoBtn = document.getElementById("slidesUndoBtn");
  const redoBtn = document.getElementById("slidesRedoBtn");
  if (undoBtn) undoBtn.disabled = !currentDeck || slideUndoStack.length === 0;
  if (redoBtn) redoBtn.disabled = !currentDeck || slideRedoStack.length === 0;
}

function clearSlideUndoHistory() {
  slideUndoStack = [];
  slideRedoStack = [];
  slideUndoTransaction = null;
  syncSlideUndoRedoButtons();
}

function pushSlideUndoCheckpoint(checkpoint, { clearRedo = true } = {}) {
  pushSlideHistoryEntry(slideUndoStack, checkpoint);
  if (clearRedo) slideRedoStack = [];
  syncSlideUndoRedoButtons();
}

function beginSlideUndoTransaction(label = "Edit slide") {
  if (slideUndoRestoring || !currentDeck || slideUndoTransaction) return;
  slideUndoTransaction = {
    label,
    before: createSlideEditorCheckpoint(),
  };
}

function commitSlideUndoTransaction() {
  if (!slideUndoTransaction) return false;
  const transaction = slideUndoTransaction;
  slideUndoTransaction = null;
  const after = createSlideEditorCheckpoint();
  if (!after || slideCheckpointsEqual(transaction.before, after)) {
    syncSlideUndoRedoButtons();
    return false;
  }
  pushSlideUndoCheckpoint(transaction.before);
  return true;
}

function recordSlideUndoCheckpoint(label = "Edit slide", { flush = true } = {}) {
  if (slideUndoRestoring || !currentDeck) return;
  commitSlideUndoTransaction();
  if (flush) flushSlideEditorTextToModel({ recordUndo: false });
  pushSlideUndoCheckpoint({
    ...createSlideEditorCheckpoint(),
    label,
  });
}

function recordSlideUndoForMutation(label = "Edit slide") {
  if (slideUndoRestoring || !currentDeck || slideUndoTransaction) return;
  recordSlideUndoCheckpoint(label, { flush: false });
}

function restoreSlideEditorCheckpoint(checkpoint) {
  if (!checkpoint?.deck) return false;
  slideUndoRestoring = true;
  try {
    currentDeck = normalizeSlideDeck(cloneSlideDeckValue(checkpoint.deck));
    currentDeckPageId =
      checkpoint.pageId && findPage(currentDeck, checkpoint.pageId)
        ? checkpoint.pageId
        : currentDeck?.pages?.[0]?.id || null;
    const page = currentPage();
    activeSlideTextObjectId = slideObjectById(page, checkpoint.activeObjectId)
      ? checkpoint.activeObjectId
      : orderedSlideObjects(page)[0]?.id || null;
    setDeckDirty(Boolean(checkpoint.dirty));
    syncSlidesDeckFolderSelect();
    renderSlidesList();
    renderSlideEditorState();
    queueAllSlideThumbnailRenders(250);
    void syncActiveDeckPresentation().catch(console.error);
    return true;
  } finally {
    slideUndoRestoring = false;
    syncSlideUndoRedoButtons();
  }
}

function undoSlideEdit() {
  if (!currentDeck) return false;
  commitSlideUndoTransaction();
  const previous = slideUndoStack.pop();
  if (!previous) {
    syncSlideUndoRedoButtons();
    return false;
  }
  pushSlideHistoryEntry(slideRedoStack, createSlideEditorCheckpoint());
  restoreSlideEditorCheckpoint(previous);
  return true;
}

function redoSlideEdit() {
  if (!currentDeck) return false;
  commitSlideUndoTransaction();
  const next = slideRedoStack.pop();
  if (!next) {
    syncSlideUndoRedoButtons();
    return false;
  }
  pushSlideUndoCheckpoint(createSlideEditorCheckpoint(), { clearRedo: false });
  restoreSlideEditorCheckpoint(next);
  return true;
}

function renameCurrentDeck() {
  if (!currentDeck) return;
  const nextTitle = (window.prompt("Deck name", currentDeck.title || "Untitled Deck") || "").trim();
  if (!nextTitle || nextTitle === currentDeck.title) return;
  recordSlideUndoCheckpoint("Rename deck");
  currentDeck.title = nextTitle;
  const titleInput = document.getElementById("slidesDeckTitleInput");
  if (titleInput) titleInput.value = nextTitle;
  setDeckDirty(true);
  renderSlidesList();
}

function deckSummaryFromDeck(deck) {
  if (!deck) return null;
  return {
    id: deck.id,
    title: deck.title || "Untitled Deck",
    folderId: deck.folderId || null,
    pageCount: Array.isArray(deck.pages) ? deck.pages.length : 0,
    updatedAt: deck.updatedAt || null,
  };
}

async function openSlidesWorkspaceFromButton() {
  currentDeck = null;
  currentDeckPageId = null;
  currentDeckDocumentType = "deck";
  clearSlideUndoHistory();
  clearSlideThumbnailState();
  setDeckDirty(false);
  showSlidesWorkspace();
  try {
    await slidesAPI.waitForReady();
  } catch (err) {
    console.warn("Slides store not ready:", err);
  }
  await refreshSlidesFolderList();
  await refreshSlidesList();
  renderSlideEditorState();
}

async function refreshSlidesList(query = "") {
  try {
    const list = await slidesAPI.list({ search: query, folderId: currentDeckFolderFilter });
    deckLibraryDecks = Array.isArray(list) ? list : [];
  } catch (err) {
    console.error("Failed to list decks:", err);
    deckLibraryDecks = [];
  }
  renderSlidesList();
}

function renderSlidesList() {
  const host = document.getElementById("slidesList");
  if (!host) return;
  host.innerHTML = "";
  if (deckLibraryDecks.length === 0) {
    const empty = document.createElement("span");
    empty.className = "list-placeholder-title";
    empty.textContent = "No decks yet";
    host.appendChild(empty);
    return;
  }
  for (const summary of deckLibraryDecks) {
    const item = document.createElement("div");
    item.className = "slides-list-item";
    if (currentDeck && currentDeck.id === summary.id) item.classList.add("is-selected");
    item.dataset.deckId = summary.id;
    item.setAttribute("role", "option");

    const title = document.createElement("span");
    title.className = "slides-list-item__title";
    title.textContent = summary.title || "Untitled Deck";
    const count = document.createElement("span");
    count.className = "slides-list-item__count";
    count.textContent = `${summary.pageCount || 0}`;
    item.appendChild(title);
    item.appendChild(count);

    item.addEventListener("click", () => {
      void activateDeckFromLibrary(summary.id).catch(console.error);
    });
    item.addEventListener("dblclick", () => {
      void activateDeckFromLibrary(summary.id).catch(console.error);
    });
    host.appendChild(item);
  }
}

async function refreshSlidesFolderList() {
  try {
    const folders = await slidesAPI.listFolders();
    deckLibraryFolders = Array.isArray(folders) ? folders : [];
  } catch (err) {
    console.error("Failed to list deck folders:", err);
    deckLibraryFolders = [];
  }
  renderSlidesFolderList();
  syncSlidesDeckFolderSelect();
}

function renderSlidesFolderList() {
  const host = document.getElementById("slidesFolderList");
  if (!host) return;
  host.innerHTML = "";
  const allRow = document.createElement("div");
  allRow.className = "songs-folder-item";
  if (currentDeckFolderFilter === null) allRow.classList.add("is-selected");
  allRow.textContent = "All Decks";
  allRow.addEventListener("click", () => {
    currentDeckFolderFilter = null;
    renderSlidesFolderList();
    void refreshSlidesList(document.getElementById("slidesSearchInput")?.value || "");
  });
  host.appendChild(allRow);
  const unfiledRow = document.createElement("div");
  unfiledRow.className = "songs-folder-item";
  if (currentDeckFolderFilter === "") unfiledRow.classList.add("is-selected");
  unfiledRow.textContent = "Default";
  unfiledRow.addEventListener("click", () => {
    currentDeckFolderFilter = "";
    renderSlidesFolderList();
    void refreshSlidesList(document.getElementById("slidesSearchInput")?.value || "");
  });
  host.appendChild(unfiledRow);
  for (const folder of deckLibraryFolders) {
    const row = document.createElement("div");
    row.className = "songs-folder-item";
    if (currentDeckFolderFilter === folder.id) row.classList.add("is-selected");
    const label = document.createElement("span");
    label.textContent = folder.name;
    row.appendChild(label);
    row.addEventListener("click", () => {
      currentDeckFolderFilter = folder.id;
      renderSlidesFolderList();
      void refreshSlidesList(document.getElementById("slidesSearchInput")?.value || "");
    });
    host.appendChild(row);
  }
}

function syncSlidesDeckFolderSelect() {
  const select = document.getElementById("slidesDeckFolderSelect");
  if (!select) return;
  const currentValue = currentDeck?.folderId || "";
  select.innerHTML = "";
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "Default";
  select.appendChild(defaultOpt);
  for (const folder of deckLibraryFolders) {
    const opt = document.createElement("option");
    opt.value = folder.id;
    opt.textContent = folder.name;
    select.appendChild(opt);
  }
  select.value = currentValue;
}

async function activateDeckFromLibrary(deckId) {
  if (deckDirty && currentDeck && !confirm("Discard unsaved changes to current deck?")) return;
  try {
    const deck = await slidesAPI.get(deckId);
    if (!deck) {
      showGnomeToast("Deck not found");
      return;
    }
    loadDeckIntoWorkspace(normalizeSlideDeck(deck));
  } catch (err) {
    console.error("Failed to load deck:", err);
    showGnomeToast("Failed to load deck");
  }
}

function loadDeckIntoWorkspace(deck, opts = {}) {
  clearSlideThumbnailState();
  clearSlideUndoHistory();
  currentDeck = deck;
  currentDeckDocumentType =
    opts.documentType ||
    (deck?.documentType === SONG_DECK_DOCUMENT_TYPE || deck?.type === SONG_DECK_DOCUMENT_TYPE
      ? SONG_DECK_DOCUMENT_TYPE
      : "deck");
  if (currentDeckDocumentType === SONG_DECK_DOCUMENT_TYPE && currentDeck) {
    currentDeck.documentType = SONG_DECK_DOCUMENT_TYPE;
    currentDeck.type = SONG_DECK_DOCUMENT_TYPE;
  }
  const requestedPageId = opts.pageId || null;
  currentDeckPageId =
    requestedPageId && findPage(deck, requestedPageId)
      ? requestedPageId
      : deck?.pages?.[0]?.id || null;
  activeSlideTextObjectId = null;
  if (Object.prototype.hasOwnProperty.call(opts, "queueItem")) {
    currentSongQueueItem = opts.queueItem || null;
  } else if (!queueItemMatchesDeck(currentSongQueueItem, deck)) {
    currentSongQueueItem = null;
  }
  setDeckDirty(false);
  syncSlidesDeckFolderSelect();
  renderSlidesList();
  renderSlideEditorState();
  queueAllSlideThumbnailRenders(250);
}

function createNewDeck() {
  if (deckDirty && currentDeck && !confirm("Discard unsaved changes to current deck?")) return;
  clearSlideThumbnailState();
  clearSlideUndoHistory();
  const deck = createBlankDeck({ folderId: currentDeckFolderFilter || null });
  currentDeck = deck;
  currentDeckDocumentType = "deck";
  currentDeckPageId = deck.pages[0].id;
  activeSlideTextObjectId = null;
  setDeckDirty(true);
  syncSlidesDeckFolderSelect();
  renderSlideEditorState();
  queueAllSlideThumbnailRenders(250);
}

async function saveCurrentDeck() {
  if (!currentDeck) return;
  commitSlideUndoTransaction();
  flushSlideEditorTextToModel();
  if (currentDeckIsSongDocument()) {
    if (currentSongThemeEditingContext && queueIndexInRange(currentSongThemeEditingContext.queueIndex)) {
      const index = currentSongThemeEditingContext.queueIndex;
      const previous = mediaQueue[index];
      const updated = buildSongQueueEntryFromDeck({
        deck: currentDeck,
        render: deckDefaultRender(currentDeck),
        currentSectionId: currentDeckPageId,
      });
      if (!updated) return;
      updated.autoAdvance = previous.autoAdvance;
      updated.cueStartTime = queueItemCueStartTime(previous);
      updated.cueVolume = previous.cueVolume;
      updated.transition = previous.transition;
      updated.itemTheme = setItemThemeRole(previous.itemTheme, {
        theme: currentSongThemeEditingContext.theme,
        outputRole: "audience",
        profile: itemThemeProfileFromSongDeck(currentDeck, currentSongThemeEditingContext.baseProfile),
      });
      updated.itemTheme.editorMaterialized = true;
      mediaQueue[index] = updated;
      currentSongQueueItem = updated;
      currentWorkspaceSongDeck = currentDeck;
      currentWorkspaceSong = deckToTransientSong(currentDeck);
      currentSongRenderState = mergeSongRenderState(currentSongRenderState, deckDefaultRender(currentDeck));
      clearSlideUndoHistory();
      setDeckDirty(false);
      renderQueue();
      saveMediaFile();
      showGnomeToast(`Saved local theme and song changes for ${currentDeck.title || "song"}`);
      return;
    }
    try {
      currentDeck.documentType = SONG_DECK_DOCUMENT_TYPE;
      currentDeck.type = SONG_DECK_DOCUMENT_TYPE;
      currentDeck.updatedAt = new Date().toISOString();
      const saved = await songsAPI.save(currentDeck);
      const savedDeckSource = saved || currentDeck;
      const savedDeck = songDeckDocumentFromSongDocument(
        savedDeckSource,
        deckDefaultRender(savedDeckSource),
      );
      currentDeck = savedDeck || currentDeck;
      currentWorkspaceSongDeck = currentDeck;
      currentWorkspaceSong = deckToTransientSong(currentDeck);
      currentSongRenderState = mergeSongRenderState(currentSongRenderState, deckDefaultRender(currentDeck));
      currentEditingSongId = currentDeck.id;
      clearSlideUndoHistory();
      setDeckDirty(false);
      const searchInput = document.getElementById("songsSearchInput");
      await refreshSongFolders();
      if (searchInput) await refreshSongsBrowser(searchInput.value);
      showGnomeToast(`Saved ${currentDeck.title || "song"}`);
    } catch (err) {
      console.error("Failed to save song deck:", err);
      showGnomeToast(`Save failed: ${err.message || err}`);
    }
    return;
  }
  try {
    const summary = await slidesAPI.save(currentDeck);
    if (summary?.id) currentDeck.id = summary.id;
    currentDeck.updatedAt = summary?.updatedAt || new Date().toISOString();
    clearSlideUndoHistory();
    setDeckDirty(false);
    await refreshSlidesList(document.getElementById("slidesSearchInput")?.value || "");
    showGnomeToast(`Saved ${currentDeck.title || "deck"}`);
  } catch (err) {
    console.error("Failed to save deck:", err);
    showGnomeToast(`Save failed: ${err.message || err}`);
  }
}

function resetCurrentSongToThemeDefault() {
  if (!currentDeck || !currentDeckIsSongDocument()) return;
  const selected = itemThemeForRole(currentSongQueueItem, "audience");
  const theme = currentSongThemeEditingContext?.theme || selected.theme || appliedPresentationTheme;
  if (!theme) {
    showGnomeToast("Select or apply a theme before resetting this song");
    return;
  }

  const outputSize = selectedBiblePreviewOutputSize("dspSelct");
  const resolvedTheme = resolveThemeForTarget({
    theme,
    contentKind: "song",
    outputRole: "audience",
    outputSize,
  });
  recordSlideUndoCheckpoint("Reset song to theme");
  currentDeck = songDeckWithResolvedTheme(currentDeck, resolvedTheme);
  currentDeck.documentType = SONG_DECK_DOCUMENT_TYPE;
  currentDeck.type = SONG_DECK_DOCUMENT_TYPE;
  currentWorkspaceSongDeck = currentDeck;
  currentWorkspaceSong = deckToTransientSong(currentDeck);
  currentSongRenderState = mergeSongRenderState(
    songRenderStateFromSongDocument(currentDeck),
    liveThemeFields(resolvedTheme),
  );
  if (currentSongThemeEditingContext) {
    // Subsequent saves persist the clean theme profile instead of rebuilding
    // overrides from the profile that existed before the reset.
    currentSongThemeEditingContext.baseProfile = resolvedTheme;
  }
  setDeckDirty(true);
  renderSlideEditorState();
  queueAllSlideThumbnailRenders(0);
  showGnomeToast(`Reset ${currentDeck.title || "song"} to “${theme.name || "Theme"}”`);
}

async function deleteCurrentDeck() {
  if (!currentDeck) return;
  if (!confirm(`Delete "${currentDeck.title || "Untitled Deck"}"?`)) return;
  if (currentDeckIsSongDocument()) {
    try {
      await songsAPI.delete(currentDeck.id);
      currentDeck = null;
      currentDeckPageId = null;
      currentDeckDocumentType = "deck";
      currentWorkspaceSongDeck = null;
      currentWorkspaceSong = null;
      clearSlideUndoHistory();
      setDeckDirty(false);
      const searchInput = document.getElementById("songsSearchInput");
      await refreshSongFolders();
      if (searchInput) await refreshSongsBrowser(searchInput.value);
      showSongsWorkspace();
    } catch (err) {
      console.error("Failed to delete song:", err);
      showGnomeToast(`Delete failed: ${err.message || err}`);
    }
    return;
  }
  try {
    await slidesAPI.delete(currentDeck.id);
    currentDeck = null;
    currentDeckPageId = null;
    clearSlideUndoHistory();
    setDeckDirty(false);
    await refreshSlidesList(document.getElementById("slidesSearchInput")?.value || "");
    renderSlideEditorState();
  } catch (err) {
    console.error("Failed to delete deck:", err);
    showGnomeToast(`Delete failed: ${err.message || err}`);
  }
}

async function duplicateCurrentDeck() {
  if (!currentDeck) return;
  if (deckDirty && !confirm("Save changes before duplicating? Duplicating will save first.")) return;
  if (deckDirty) await saveCurrentDeck();
  try {
    const copy = await slidesAPI.duplicate(currentDeck.id, {});
    if (copy) loadDeckIntoWorkspace(normalizeSlideDeck(copy));
    await refreshSlidesList(document.getElementById("slidesSearchInput")?.value || "");
  } catch (err) {
    console.error("Failed to duplicate deck:", err);
    showGnomeToast(`Duplicate failed: ${err.message || err}`);
  }
}

/* ── Page operations ──────────────────────────────────────── */

function currentPage() {
  if (!currentDeck || !currentDeckPageId) return null;
  return findPage(currentDeck, currentDeckPageId);
}

function selectDeckPage(pageId) {
  commitSlideUndoTransaction();
  flushSlideEditorTextToModel();
  currentDeckPageId = pageId;
  activeSlideTextObjectId = null;
  renderSlideEditorState();
  void syncActiveDeckPresentation().catch(console.error);
}

function addDeckPage() {
  if (!currentDeck) return;
  recordSlideUndoCheckpoint("Add page");
  const page = createBlankPage({ label: `Page ${currentDeck.pages.length + 1}` });
  currentDeck.pages.push(page);
  if (currentDeckIsSongDocument()) {
    currentDeck.playOrder = reconcileSongPlayOrder(currentDeck.playOrder, currentDeck.pages);
  }
  currentDeckPageId = page.id;
  activeSlideTextObjectId = null;
  setDeckDirty(true);
  renderSlideEditorState();
}

function duplicateDeckPage() {
  if (!currentDeck) return;
  const page = currentPage();
  if (!page) return;
  recordSlideUndoCheckpoint("Duplicate page");
  const copy = JSON.parse(JSON.stringify(page));
  copy.id = `page_${(crypto.randomUUID?.() || String(Math.random())).replace(/-/g, "").slice(0, 12)}`;
  for (const obj of copy.objects || []) {
    obj.id = `obj_${(crypto.randomUUID?.() || String(Math.random())).replace(/-/g, "").slice(0, 12)}`;
  }
  const idx = currentDeck.pages.findIndex((p) => p.id === page.id);
  currentDeck.pages.splice(idx + 1, 0, copy);
  if (currentDeckIsSongDocument()) {
    currentDeck.playOrder = reconcileSongPlayOrder(currentDeck.playOrder, currentDeck.pages);
  }
  currentDeckPageId = copy.id;
  activeSlideTextObjectId = null;
  setDeckDirty(true);
  renderSlideEditorState();
}

function deleteDeckPage() {
  if (!currentDeck) return;
  if (currentDeck.pages.length <= 1) {
    showGnomeToast("A deck must have at least one page");
    return;
  }
  const idx = currentDeck.pages.findIndex((p) => p.id === currentDeckPageId);
  if (idx < 0) return;
  recordSlideUndoCheckpoint("Delete page");
  currentDeck.pages.splice(idx, 1);
  if (currentDeckIsSongDocument()) {
    currentDeck.playOrder = reconcileSongPlayOrder(currentDeck.playOrder, currentDeck.pages);
  }
  currentDeckPageId = currentDeck.pages[Math.min(idx, currentDeck.pages.length - 1)].id;
  activeSlideTextObjectId = null;
  setDeckDirty(true);
  renderSlideEditorState();
}

/* ── Editor render ────────────────────────────────────────── */

function renderSlideEditorState() {
  const hasDeck = Boolean(currentDeck);
  const page = currentPage();
  const isSong = currentDeckIsSongDocument();

  syncSlidesWorkspaceTitle();
  const themeEditorGroup = document.getElementById("slidesThemeEditorGroup");
  const propertiesPanel = document.querySelector(".slides-workspace__properties");
  if (themeEditorGroup && propertiesPanel && themeEditorGroup.parentElement !== propertiesPanel) {
    propertiesPanel.prepend(themeEditorGroup);
  }
  const themeEditorTitle = themeEditorGroup?.querySelector(".boxed-list-title");
  if (themeEditorTitle) {
    themeEditorTitle.textContent = currentSongThemeEditingContext && isSong
      ? "Theme Style · Local Song Override"
      : "Theme Style";
  }
  const resetSongThemeRow = document.getElementById("slidesResetSongThemeRow");
  const resetSongThemeBtn = document.getElementById("slidesResetSongThemeBtn");
  const resetTheme = currentSongThemeEditingContext?.theme ||
    itemThemeForRole(currentSongQueueItem, "audience").theme ||
    appliedPresentationTheme;
  if (resetSongThemeRow) resetSongThemeRow.hidden = !isSong;
  if (resetSongThemeBtn) resetSongThemeBtn.disabled = !isSong || !resetTheme;

  const titleInput = document.getElementById("slidesDeckTitleInput");
  if (titleInput) titleInput.value = currentDeck?.title || "";

  const fontFamily = document.getElementById("slidesDeckFontFamily");
  if (fontFamily) fontFamily.value = currentDeck?.theme?.fontFamily || DEFAULT_DECK_THEME.fontFamily;
  const fontSize = document.getElementById("slidesDeckFontSize");
  if (fontSize) fontSize.value = currentDeck?.theme?.fontSize ?? DEFAULT_DECK_THEME.fontSize;
  const textColor = document.getElementById("slidesDeckTextColor");
  if (textColor) textColor.value = currentDeck?.theme?.textColor || DEFAULT_DECK_THEME.textColor;
  const bgColor = document.getElementById("slidesDeckBgColor");
  if (bgColor) bgColor.value = currentDeck?.theme?.backgroundColor || DEFAULT_DECK_THEME.backgroundColor;
  const deckTheme = currentDeck?.theme || DEFAULT_DECK_THEME;
  const themeControls = {
    slidesDeckMinFontSize: deckTheme.minFontSize ?? DEFAULT_DECK_THEME.minFontSize,
    slidesDeckAutosizeMode: deckTheme.autosizeMode || "fit",
    slidesDeckAlign: deckTheme.align || "center",
    slidesDeckVerticalAlign: deckTheme.verticalAlign || "center",
    slidesDeckFontWeight: String(deckTheme.fontWeight || 700),
    slidesDeckFontStyle: deckTheme.fontStyle || "normal",
    slidesDeckLineHeight: deckTheme.lineHeight || 1.18,
    slidesDeckBackdropColor: deckTheme.backdrop?.background?.color || "#101010",
  };
  for (const [id, value] of Object.entries(themeControls)) {
    const control = document.getElementById(id);
    if (control) control.value = value;
  }
  const backdropEnabled = document.getElementById("slidesDeckBackdropEnabled");
  if (backdropEnabled) backdropEnabled.checked = deckTheme.backdrop?.enabled === true;

  const songMetadataGroup = document.getElementById("slidesSongMetadataGroup");
  if (songMetadataGroup) songMetadataGroup.hidden = !isSong;
  const songMetadata = currentDeck?.metadata || {};
  const songHymnal = songMetadata.hymnal || {};
  const songFieldValues = {
    slidesSongNumber:
      Number.isFinite(currentDeck?.songNumber) && currentDeck.songNumber > 0
        ? String(currentDeck.songNumber)
        : "",
    slidesSongAuthors: Array.isArray(songMetadata.authors) ? songMetadata.authors.join(", ") : "",
    slidesSongCopyright: songMetadata.copyright || "",
    slidesSongCcli: songMetadata.ccliNumber || songMetadata.ccli_number || "",
    slidesSongLicense: songMetadata.oneLicense || songMetadata.one_license || "",
    slidesSongHymnalName: songHymnal.name || "",
    slidesSongHymnalNumber: songHymnal.number || "",
    slidesSongMeter: songMetadata.meter || songHymnal.meter || "",
  };
  for (const [id, value] of Object.entries(songFieldValues)) {
    const field = document.getElementById(id);
    if (field) {
      field.value = isSong ? value : "";
      field.disabled = !isSong;
    }
  }

  const pageLabel = document.getElementById("slidesPageLabelInput");
  if (pageLabel) pageLabel.value = page?.label || "";
  const pageBg = document.getElementById("slidesPageBackgroundColor");
  if (pageBg) {
    pageBg.value = page?.background?.color || currentDeck?.theme?.backgroundColor || DEFAULT_DECK_THEME.backgroundColor;
  }
  const bgLabel = document.getElementById("slidesPageBackgroundLabel");
  if (bgLabel) {
    if (page?.background?.type === "image" || page?.background?.type === "video") {
      const p = page.background.path || "";
      bgLabel.textContent = p ? p.split(/[\\/]/).pop() : (page.background.type === "video" ? "Video" : "Image");
    } else {
      bgLabel.textContent = "None";
    }
  }
  const pageNotes = document.getElementById("slidesPageNotes");
  if (pageNotes) pageNotes.value = page?.notes || "";
  syncSlideTransitionControls(
    "slidesPageTransitionEffect",
    "slidesPageTransitionDuration",
    page?.transition,
    { allowInherit: true },
  );
  renderSlideTemplatePicker();

  // Buttons enable/disable
  for (const id of [
    "slidesShowNowBtn",
    "slidesAddScheduleBtn",
    "slidesDeleteDeckBtn",
    "slidesDuplicateDeckBtn",
    "slidesAddPageBtn",
    "slidesDuplicatePageBtn",
    "slidesDeletePageBtn",
    "slidesAddTextBoxBtn",
    "slidesAddImageBtn",
    "slidesAddRectBtn",
    "slidesAddEllipseBtn",
    "slidesAddLineBtn",
  ]) {
    const el = document.getElementById(id);
    if (el) el.disabled = !hasDeck;
  }
  const saveBtn = document.getElementById("slidesSaveDeckBtn");
  if (saveBtn) saveBtn.disabled = !hasDeck || !deckDirty;
  syncSlideUndoRedoButtons();

  renderDeckPageStrip();
  renderSlideCanvas();
}

function applyDeckPageThumbnailBackground(thumb, page) {
  const bg = page?.background || {};
  thumb.style.backgroundColor = "#000";
  thumb.style.backgroundImage = "";
  thumb.style.backgroundRepeat = "no-repeat";
  thumb.style.backgroundSize = "contain";
  thumb.style.backgroundPosition = "center";
  if (bg.type === "image" && bg.path) {
    thumb.style.backgroundColor = "#000";
    thumb.style.backgroundImage = `url("${pathToUrlSafe(bg.path)}")`;
  } else if (bg.type === "color" && bg.color) {
    thumb.style.backgroundColor = bg.color;
  }
}

function applyDeckPageThumbnailObjectBox(el, object) {
  const frame = normalizeSlideTextObjectFrame(object?.frame || DEFAULT_TEXT_FRAME);
  el.style.left = `${frame.x * 100}%`;
  el.style.top = `${frame.y * 100}%`;
  el.style.width = `${frame.width * 100}%`;
  el.style.height = `${frame.height * 100}%`;
  el.style.zIndex = String(Number.isFinite(object?.zIndex) ? object.zIndex : 0);
  el.style.opacity = String(clampSlideOpacity(object?.opacity, 1));
}

function deckFontSizeToThumbCqw(fontSizePx, deckWidth) {
  const width = Number(deckWidth) > 0 ? Number(deckWidth) : 1920;
  const cqw = (Math.max(1, Number(fontSizePx) || 1) / width) * 100;
  return `${Math.max(0.4, cqw).toFixed(3)}cqw`;
}

function createDeckPageThumbnailObject(object, deck = currentDeck) {
  const kind = object?.kind === "image" || object?.kind === "shape" ? object.kind : "text";
  const el = document.createElement("div");
  el.className = `slides-page-list__thumb-object slides-page-list__thumb-object--${kind}`;
  applyDeckPageThumbnailObjectBox(el, object);

  if (kind === "image") {
    const image = object.image && typeof object.image === "object" ? object.image : {};
    if (image.path) {
      const img = document.createElement("img");
      img.src = pathToUrlSafe(image.path);
      img.alt = "";
      img.draggable = false;
      img.style.objectFit = image.fit === "cover" || image.fit === "fill" ? image.fit : "contain";
      el.appendChild(img);
    }
    return el;
  }

  if (kind === "shape") {
    const shape = object.shape && typeof object.shape === "object" ? object.shape : {};
    const shapeEl = document.createElement("div");
    shapeEl.className = "slides-page-list__thumb-shape";
    if (shape.type === "ellipse") {
      shapeEl.style.borderRadius = "999px";
    } else if (Number.isFinite(shape.radius) && shape.radius > 0) {
      shapeEl.style.borderRadius = `${Math.max(1, shape.radius / 8)}px`;
    }
    shapeEl.style.backgroundColor = shape.type === "line" ? "transparent" : (shape.fill || "#ffffff");
    if (shape.stroke || Number.isFinite(shape.strokeWidth)) {
      const strokeWidth = Number.isFinite(shape.strokeWidth) ? Math.max(1, shape.strokeWidth / 3) : 1;
      shapeEl.style.border = `${strokeWidth}px solid ${shape.stroke || shape.fill || "#ffffff"}`;
    }
    if (shape.type === "line") {
      const strokeWidth = Number.isFinite(shape.strokeWidth) && shape.strokeWidth > 0
        ? Math.max(1, shape.strokeWidth / 3)
        : 1;
      shapeEl.classList.add("slides-page-list__thumb-shape--line");
      shapeEl.style.border = "none";
      shapeEl.style.borderTop = `${strokeWidth}px solid ${shape.stroke || shape.fill || "#ffffff"}`;
    }
    el.appendChild(shapeEl);
    return el;
  }

  const style = object.style && typeof object.style === "object" ? object.style : {};
  el.style.color = style.color || deck?.theme?.textColor || "#ffffff";
  el.style.fontFamily = songFontFamilyCSS(style.fontFamily || deck?.theme?.fontFamily);
  // Thumbnails render before they're attached to the DOM, so pixel widths
  // can't be measured here. Express font sizes as container-query width
  // units instead (relative to the deck's own coordinate system), so text
  // scales correctly with the actual rendered thumbnail width - whatever
  // that ends up being - the same way the PPTX renderer's SVGs always
  // scale cleanly to their container regardless of size.
  const deckWidth = Number(deck?.canvas?.width) || 1920;
  el.style.fontSize = deckFontSizeToThumbCqw(Number(style.fontSize) || Number(deck?.theme?.fontSize) || 72, deckWidth);
  el.style.lineHeight = String(style.lineHeight || 1.15);
  el.style.textAlign = style.align || "center";
  el.style.alignItems =
    style.align === "left" ? "flex-start" : style.align === "right" ? "flex-end" : "center";
  el.style.justifyContent =
    style.verticalAlign === "top"
      ? "flex-start"
      : style.verticalAlign === "bottom"
        ? "flex-end"
        : "center";
  const blocks = Array.isArray(object.blocks) ? object.blocks : [];
  for (const block of blocks) {
    const line = document.createElement("div");
    line.className = "slides-page-list__thumb-text-line";
    const segments = Array.isArray(block?.primary?.segments) ? block.primary.segments : [];
    if (block?.type === "spacer" || segments.length === 0) {
      line.textContent = "\u00a0";
    } else {
      for (const segment of segments) {
        const span = document.createElement("span");
        span.textContent = segment?.text || "";
        const segmentStyle = textStyleFromSegment(segment);
        if (segmentStyle.color) span.style.color = segmentStyle.color;
        if (segmentStyle.fontFamily) span.style.fontFamily = songFontFamilyCSS(segmentStyle.fontFamily);
        if (segmentStyle.fontSize) {
          span.style.fontSize = deckFontSizeToThumbCqw(segmentStyle.fontSize, deckWidth);
        }
        if (segmentStyle.backgroundColor) span.style.backgroundColor = segmentStyle.backgroundColor;
        if (segmentStyle.fontWeight) span.style.fontWeight = segmentStyle.fontWeight;
        if (segmentStyle.fontStyle) span.style.fontStyle = segmentStyle.fontStyle;
        if (segmentStyle.textDecoration) span.style.textDecoration = segmentStyle.textDecoration;
        line.appendChild(span);
      }
    }
    el.appendChild(line);
  }
  if (blocks.length === 0) el.textContent = slideTextObjectText(object);
  return el;
}

function renderDeckPageThumbnail(thumb, page, deck = currentDeck) {
  thumb.innerHTML = "";
  const signature = slideThumbnailSignature(page, deck);
  const cached = slideThumbnailCache.get(page?.id);
  if (cached?.signature === signature && cached.dataUrl) {
    thumb.classList.add("slides-page-list__thumb--rendered");
    thumb.style.backgroundColor = "#000";
    thumb.style.backgroundImage = `url("${cached.dataUrl}")`;
    thumb.style.backgroundRepeat = "no-repeat";
    thumb.style.backgroundSize = "contain";
    thumb.style.backgroundPosition = "center";
    return;
  }
  thumb.classList.remove("slides-page-list__thumb--rendered");
  applyDeckPageThumbnailBackground(thumb, page);
  const objects = orderedSlideObjects(page);
  if (!objects.length) {
    const txt = getPagePrimaryText(page);
    const fallback = document.createElement("div");
    fallback.className = "slides-page-list__thumb-object slides-page-list__thumb-object--text";
    fallback.style.inset = "0";
    fallback.style.alignItems = "center";
    fallback.style.justifyContent = "center";
    fallback.style.color = deck?.theme?.textColor || "#ffffff";
    fallback.textContent = txt.length > 80 ? `${txt.slice(0, 77)}...` : txt;
    thumb.appendChild(fallback);
    return;
  }
  for (const object of objects) {
    thumb.appendChild(createDeckPageThumbnailObject(object, deck));
  }
}

function renderDeckPageStrip() {
  const host = document.getElementById("slidesPageList");
  if (!host) return;
  host.innerHTML = "";
  if (!currentDeck) return;
  currentDeck.pages.forEach((page, idx) => {
    const row = document.createElement("div");
    row.className = "slides-page-list__item";
    if (page.id === currentDeckPageId) row.classList.add("is-active");
    row.dataset.pageId = page.id;

    const idxEl = document.createElement("span");
    idxEl.className = "slides-page-list__index";
    idxEl.textContent = String(idx + 1);

    const wrap = document.createElement("div");
    wrap.style.flex = "1";
    wrap.style.minWidth = "0";

    const thumb = document.createElement("div");
    thumb.className = "slides-page-list__thumb";
    renderDeckPageThumbnail(thumb, page, currentDeck);

    const label = document.createElement("div");
    label.className = "slides-page-list__label";
    label.textContent = page.label || `Page ${idx + 1}`;

    wrap.appendChild(thumb);
    wrap.appendChild(label);
    row.appendChild(idxEl);
    row.appendChild(wrap);
    row.addEventListener("click", (event) => {
      if (event.detail > 1) return;
      if (deckPageClickTimer !== null) window.clearTimeout(deckPageClickTimer);
      deckPageClickTimer = window.setTimeout(() => {
        deckPageClickTimer = null;
        selectDeckPage(page.id);
      }, 220);
    });
    row.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (deckPageClickTimer !== null) {
        window.clearTimeout(deckPageClickTimer);
        deckPageClickTimer = null;
      }
      void recoverOutputHoldsToDeckPage(page.id).catch(console.error);
    });
    host.appendChild(row);
  });
}

function pathToUrlSafe(p) {
  if (!p) return "";
  if (/^[a-z]+:\/\//i.test(p)) return p;
  try {
    return `file://${p.replace(/\\/g, "/")}`;
  } catch {
    return p;
  }
}

function slideThumbnailSignature(page, deck = currentDeck) {
  if (!page || !deck) return "";
  try {
    return JSON.stringify({
      canvas: deck.canvas || null,
      rendererPixelRatio: slideThumbnailPixelRatio(),
      theme: deck.theme || null,
      background: page.background || null,
      objects: Array.isArray(page.objects) ? page.objects : [],
    });
  } catch {
    return `${Date.now()}`;
  }
}

function scheduleCurrentSlideThumbnailRefresh(delayMs = SLIDE_THUMBNAIL_IDLE_MS) {
  if (!currentDeck || !currentDeckPageId) return;
  queueSlideThumbnailRender(currentDeckPageId, delayMs);
}

function queueAllSlideThumbnailRenders(delayMs = 250) {
  if (!currentDeck || !Array.isArray(currentDeck.pages)) return;
  for (const page of currentDeck.pages) {
    queueSlideThumbnailRender(page.id, delayMs);
  }
}

function clearSlideThumbnailState() {
  for (const timer of slideThumbnailTimers.values()) {
    clearTimeout(timer);
  }
  slideThumbnailTimers.clear();
  slideThumbnailCache.clear();
}

function queueSlideThumbnailRender(pageId, delayMs = SLIDE_THUMBNAIL_IDLE_MS) {
  if (!currentDeck || !pageId) return;
  const page = findPage(currentDeck, pageId);
  if (!page) return;
  const signature = slideThumbnailSignature(page, currentDeck);
  const cached = slideThumbnailCache.get(pageId);
  if (cached?.signature === signature && cached.dataUrl) return;
  const existingTimer = slideThumbnailTimers.get(pageId);
  if (existingTimer) clearTimeout(existingTimer);
  const timer = setTimeout(() => {
    slideThumbnailTimers.delete(pageId);
    void renderSlideThumbnailForPage(pageId, signature).catch((err) => {
      console.warn("Failed to render slide thumbnail:", err);
    });
  }, Math.max(0, delayMs));
  slideThumbnailTimers.set(pageId, timer);
}

async function renderSlideThumbnailForPage(pageId, scheduledSignature) {
  const deck = currentDeck;
  const page = findPage(deck, pageId);
  if (!deck || !page) return;
  if (slideThumbnailSignature(page, deck) !== scheduledSignature) return;
  const dataUrl = await renderSlidePageThumbnailDataUrl(page, deck);
  if (!dataUrl) return;
  if (slideThumbnailSignature(page, deck) !== scheduledSignature) return;
  slideThumbnailCache.set(pageId, { signature: scheduledSignature, dataUrl });
  if (isSlidesWorkspaceVisible()) renderDeckPageStrip();
}

function slideThumbnailRectForFrame(frame) {
  const f = normalizeSlideTextObjectFrame(frame || DEFAULT_TEXT_FRAME);
  return {
    x: f.x * SLIDE_THUMBNAIL_WIDTH,
    y: f.y * SLIDE_THUMBNAIL_HEIGHT,
    width: f.width * SLIDE_THUMBNAIL_WIDTH,
    height: f.height * SLIDE_THUMBNAIL_HEIGHT,
  };
}

function loadSlideThumbnailImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), 1800);
    img.onload = () => {
      clearTimeout(timeout);
      finish(img);
    };
    img.onerror = () => {
      clearTimeout(timeout);
      finish(null);
    };
    img.src = src;
  });
}

function drawSlideThumbnailImage(ctx, img, x, y, width, height, fit = "cover") {
  if (!img || !width || !height) return;
  if (fit === "fill") {
    ctx.drawImage(img, x, y, width, height);
    return;
  }
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const scale = fit === "contain" ? Math.min(width / iw, height / ih) : Math.max(width / iw, height / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, x + (width - dw) / 2, y + (height - dh) / 2, dw, dh);
}

async function drawSlideThumbnailBackground(ctx, page, deck) {
  const bg = page?.background || {};
  const color = bg.color || deck?.theme?.backgroundColor || DEFAULT_DECK_THEME.backgroundColor;
  ctx.fillStyle = color || "#000000";
  ctx.fillRect(0, 0, SLIDE_THUMBNAIL_WIDTH, SLIDE_THUMBNAIL_HEIGHT);
  if (bg.type === "image" && bg.path) {
    const img = await loadSlideThumbnailImage(pathToUrlSafe(bg.path));
    if (img) drawSlideThumbnailImage(ctx, img, 0, 0, SLIDE_THUMBNAIL_WIDTH, SLIDE_THUMBNAIL_HEIGHT, "contain");
  }
}

async function drawSlideThumbnailObject(ctx, object, deck) {
  if (!object) return;
  const kind = object.kind === "image" || object.kind === "shape" ? object.kind : "text";
  const rect = slideThumbnailRectForFrame(object.frame);
  ctx.save();
  ctx.globalAlpha = clampSlideOpacity(object.opacity, 1);
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();

  if (kind === "image") {
    const image = object.image && typeof object.image === "object" ? object.image : {};
    const img = await loadSlideThumbnailImage(pathToUrlSafe(image.path));
    if (img) drawSlideThumbnailImage(ctx, img, rect.x, rect.y, rect.width, rect.height, image.fit || "contain");
    ctx.restore();
    return;
  }

  if (kind === "shape") {
    const shape = object.shape && typeof object.shape === "object" ? object.shape : {};
    const rawStrokeWidth = Number(shape.strokeWidth);
    const hasStroke = Boolean(shape.stroke) || (Number.isFinite(rawStrokeWidth) && rawStrokeWidth > 0);
    ctx.fillStyle = shape.fill || "#ffffff";
    ctx.strokeStyle = shape.stroke || shape.fill || "#ffffff";
    ctx.lineWidth = hasStroke ? Math.max(1, rawStrokeWidth || 1) : 0;
    if (shape.type === "line") {
      ctx.beginPath();
      ctx.moveTo(rect.x, rect.y + rect.height / 2);
      ctx.lineTo(rect.x + rect.width, rect.y + rect.height / 2);
      ctx.lineWidth = Math.max(1, Number(shape.strokeWidth) || 4);
      ctx.stroke();
    } else if (shape.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      if (hasStroke) ctx.stroke();
    } else {
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      if (hasStroke) ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
    ctx.restore();
    return;
  }

  const bg = object.background && typeof object.background === "object" ? object.background : null;
  if (bg?.type === "color") {
    ctx.fillStyle = bg.color || "transparent";
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  } else if (bg?.type === "image" && bg.path) {
    const bgImg = await loadSlideThumbnailImage(pathToUrlSafe(bg.path));
    if (bgImg) drawSlideThumbnailImage(ctx, bgImg, rect.x, rect.y, rect.width, rect.height, "cover");
  }

  const style = object.style && typeof object.style === "object" ? object.style : {};
  const deckFontSize = Number(deck?.theme?.fontSize) || DEFAULT_DECK_THEME.fontSize;
  const scale = SLIDE_THUMBNAIL_WIDTH / (deck?.canvas?.width || 1920);
  const baseFontSize = Math.max(3, (Number(style.fontSize) || deckFontSize) * scale);
  const baseFamily = style.fontFamily || deck?.theme?.fontFamily;
  const baseColor = style.color || deck?.theme?.textColor || "#ffffff";
  const blocks = Array.isArray(object.blocks) ? object.blocks : [];
  const lines = blocks.length
    ? blocks.map((block) => {
        const segments = Array.isArray(block?.primary?.segments) ? block.primary.segments : [];
        return segments.map((segment) => {
          const segmentStyle = textStyleFromSegment(segment);
          return {
            text: segment?.text || "",
            color: segmentStyle.color || baseColor,
            backgroundColor: segmentStyle.backgroundColor || "",
            fontFamily: segmentStyle.fontFamily || baseFamily,
            fontSize: Math.max(3, (segmentStyle.fontSize || Number(style.fontSize) || deckFontSize) * scale),
            fontWeight: segmentStyle.fontWeight || style.fontWeight || "700",
            fontStyle: segmentStyle.fontStyle || style.fontStyle || "normal",
          };
        });
      })
    : slideTextObjectText(object).split(/\r?\n/).map((text) => [{
        text,
        color: baseColor,
        backgroundColor: "",
        fontFamily: baseFamily,
        fontSize: baseFontSize,
        fontWeight: style.fontWeight || "700",
        fontStyle: style.fontStyle || "normal",
      }]);
  const lineHeights = lines.map((runs) =>
    Math.max(baseFontSize, ...runs.map((run) => run.fontSize)) * (Number(style.lineHeight) || 1.15));
  const totalHeight = Math.max(baseFontSize, lineHeights.reduce((sum, height) => sum + height, 0));
  const pad = Math.max(3, baseFontSize * 0.25);
  const verticalAlign = style.verticalAlign || "center";
  let y = rect.y + pad;
  if (verticalAlign === "center") y = rect.y + (rect.height - totalHeight) / 2;
  if (verticalAlign === "bottom") y = rect.y + rect.height - totalHeight - pad;
  const align = style.align || "center";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (const [lineIndex, runs] of lines.entries()) {
    const measuredRuns = [];
    let lineWidth = 0;
    for (const run of runs) {
      const family = songFontFamilyCSS(run.fontFamily);
      const font = `${run.fontStyle} ${run.fontWeight} ${run.fontSize}px ${family}`;
      try {
        await document.fonts?.load?.(font, run.text || " ");
      } catch {}
      ctx.font = font;
      const width = ctx.measureText(run.text).width;
      measuredRuns.push({ ...run, font, width });
      lineWidth += width;
    }
    let x = rect.x + pad;
    if (align === "center") x = rect.x + (rect.width - lineWidth) / 2;
    if (align === "right") x = rect.x + rect.width - pad - lineWidth;
    for (const run of measuredRuns) {
      ctx.font = run.font;
      if (run.backgroundColor) {
        ctx.fillStyle = run.backgroundColor;
        ctx.fillRect(x, y, run.width, lineHeights[lineIndex]);
      }
      ctx.fillStyle = run.color;
      ctx.fillText(run.text || " ", x, y);
      x += run.width;
    }
    y += lineHeights[lineIndex];
  }
  ctx.restore();
}

async function renderSlidePageThumbnailDataUrl(page, deck) {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  const pixelRatio = slideThumbnailPixelRatio();
  canvas.width = Math.round(SLIDE_THUMBNAIL_WIDTH * pixelRatio);
  canvas.height = Math.round(SLIDE_THUMBNAIL_HEIGHT * pixelRatio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale(pixelRatio, pixelRatio);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  await drawSlideThumbnailBackground(ctx, page, deck);
  for (const object of orderedSlideObjects(page)) {
    await drawSlideThumbnailObject(ctx, object, deck);
  }
  try {
    // PNG keeps text edges and per-segment colors exact; JPEG introduces
    // visible color shifts and halos in small lyric thumbnails.
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

function clampSlideFrame(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function slideTextObjectsForPage(page, { create = false } = {}) {
  if (!page) return [];
  if (!Array.isArray(page.objects)) {
    if (!create) return [];
    page.objects = [];
  }
  let textObjects = page.objects.filter((o) => o && o.kind === "text");
  if (textObjects.length === 0 && create) {
    const obj = createTextObject({});
    page.objects.push(obj);
    textObjects = [obj];
    setDeckDirty(true);
  }
  return textObjects;
}

function slideObjectsForPage(page, { createText = false } = {}) {
  if (!page) return [];
  if (!Array.isArray(page.objects)) {
    if (!createText) return [];
    page.objects = [];
  }
  if (createText) slideTextObjectsForPage(page, { create: true });
  return Array.isArray(page.objects) ? page.objects.filter(Boolean) : [];
}

function slideObjectById(page, objectId) {
  if (!page || !objectId || !Array.isArray(page.objects)) return null;
  return page.objects.find((o) => o && o.id === objectId) || null;
}

function slideTextObjectById(page, objectId) {
  const obj = slideObjectById(page, objectId);
  return obj?.kind === "text" ? obj : null;
}

function activeSlideTextObject(page = currentPage(), { create = false } = {}) {
  const textObjects = slideTextObjectsForPage(page, { create });
  if (textObjects.length === 0) return null;
  let obj = slideTextObjectById(page, activeSlideTextObjectId);
  if (!obj) {
    obj = textObjects[0];
    activeSlideTextObjectId = obj.id;
  }
  return obj;
}

function orderedSlideObjects(page, { kind = null } = {}) {
  const objects = slideObjectsForPage(page);
  return objects
    .map((object, index) => ({ object, index }))
    .filter(({ object }) => !kind || object.kind === kind)
    .sort((a, b) => {
      const az = Number.isFinite(a.object?.zIndex) ? a.object.zIndex : 0;
      const bz = Number.isFinite(b.object?.zIndex) ? b.object.zIndex : 0;
      return az === bz ? a.index - b.index : az - bz;
    })
    .map(({ object }) => object);
}

function maxSlideObjectZIndex(page) {
  return slideObjectsForPage(page).reduce(
    (max, obj) => Math.max(max, Number.isFinite(obj?.zIndex) ? obj.zIndex : 0),
    0,
  );
}

function newSlideObjectId() {
  return `obj_${(crypto.randomUUID?.() || String(Math.random())).replace(/-/g, "").slice(0, 12)}`;
}

function cloneSlideObject(object) {
  try {
    return structuredClone(object);
  } catch {
    return JSON.parse(JSON.stringify(object));
  }
}

function clampSlideOpacity(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function slideObjectFrameAtCanvasPoint(frame, { clientX = null, clientY = null } = {}) {
  const canvas = document.getElementById("slidesCanvas");
  const f = normalizeSlideTextObjectFrame(frame || DEFAULT_TEXT_FRAME);
  if (!canvas || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return f;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return f;
  return {
    ...f,
    x: Math.max(0, Math.min(1 - f.width, (clientX - rect.left) / rect.width - f.width / 2)),
    y: Math.max(0, Math.min(1 - f.height, (clientY - rect.top) / rect.height - f.height / 2)),
  };
}

function offsetSlideObjectFrame(frame, { clientX = null, clientY = null } = {}) {
  const f = normalizeSlideTextObjectFrame(frame || DEFAULT_TEXT_FRAME);
  if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
    return slideObjectFrameAtCanvasPoint(f, { clientX, clientY });
  }
  const offset = Math.min(0.24, (slideObjectPasteCount + 1) * 0.04);
  return {
    ...f,
    x: Math.max(0, Math.min(1 - f.width, f.x + offset)),
    y: Math.max(0, Math.min(1 - f.height, f.y + offset)),
  };
}

function selectSlideObject(objectId, { focus = false } = {}) {
  activeSlideTextObjectId = objectId || null;
  document.querySelectorAll(".slides-canvas-text-object").forEach((el) => {
    const active = Boolean(objectId) && el.dataset.objectId === objectId;
    el.classList.toggle("is-active", active);
    if (active && focus) {
      el.querySelector(".slides-canvas-text-input")?.focus({ preventScroll: true });
    }
  });
}

function selectSlideTextObject(objectId, opts = {}) {
  selectSlideObject(objectId, opts);
}

function slideTextFrameFromDom(objectEl) {
  const canvas = document.getElementById("slidesCanvas");
  const textObj = objectEl || document.querySelector(".slides-canvas-text-object.is-active");
  if (!canvas || !textObj || textObj.style.display === "none") return null;
  const canvasRect = canvas.getBoundingClientRect();
  const textRect = textObj.getBoundingClientRect();
  if (!canvasRect.width || !canvasRect.height || !textRect.width || !textRect.height) {
    return null;
  }
  const x = clampSlideFrame((textRect.left - canvasRect.left) / canvasRect.width);
  const y = clampSlideFrame((textRect.top - canvasRect.top) / canvasRect.height);
  return {
    x,
    y,
    width: Math.max(0.01, Math.min(1 - x, textRect.width / canvasRect.width)),
    height: Math.max(0.01, Math.min(1 - y, textRect.height / canvasRect.height)),
  };
}

function slideFramesEqual(a, b) {
  if (!a || !b) return false;
  const epsilon = 0.0005;
  return (
    Math.abs(Number(a.x) - Number(b.x)) < epsilon &&
    Math.abs(Number(a.y) - Number(b.y)) < epsilon &&
    Math.abs(Number(a.width) - Number(b.width)) < epsilon &&
    Math.abs(Number(a.height) - Number(b.height)) < epsilon
  );
}

function slideTextObjectText(object) {
  return blocksToText(object?.blocks || []);
}

function slideBlocksEqual(a, b) {
  try {
    return JSON.stringify(a || []) === JSON.stringify(b || []);
  } catch {
    return false;
  }
}

function renderSlideTextInputFromBlocks(editor, blocks) {
  if (!editor) return;
  editor.innerHTML = "";
  const source = Array.isArray(blocks) && blocks.length ? blocks : textToSegmentsBlocks("");
  for (const block of source) {
    const lineEl = document.createElement("div");
    lineEl.className = "slides-canvas-text-line";
    if (block?.id) lineEl.dataset.blockId = block.id;
    const segments = block?.type === "lyricLine" && Array.isArray(block.primary?.segments)
      ? block.primary.segments
      : [];
    if (!segments.length || segments.every((segment) => !segment?.text)) {
      lineEl.appendChild(document.createElement("br"));
    } else {
      for (const segment of segments) {
        const span = document.createElement("span");
        span.textContent = segment?.text || "";
        applySongSegmentStyleToElement(span, segment?.style);
        lineEl.appendChild(span);
      }
    }
    editor.appendChild(lineEl);
  }
}

function isSlideTextBlockElement(node) {
  return (
    node?.nodeType === Node.ELEMENT_NODE &&
    ["DIV", "P", "LI"].includes(node.tagName)
  );
}

function styleFromDomElement(element, inherited = {}) {
  const next = { ...inherited };
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return next;
  const style = element.style || {};
  if (style.color) next.color = style.color;
  if (style.fontFamily) next.fontFamily = style.fontFamily;
  if (style.backgroundColor) next.backgroundColor = style.backgroundColor;
  if (style.fontWeight) next.fontWeight = style.fontWeight;
  if (style.fontStyle) next.fontStyle = style.fontStyle;
  const decoration = style.textDecorationLine || style.textDecoration;
  if (decoration) next.textDecoration = decoration;
  return textStyleFromSegment({ style: next });
}

function appendRichTextSegment(lines, text, style) {
  if (typeof text !== "string" || text.length === 0) return;
  const parts = text.replace(/\u00a0/g, " ").split("\n");
  for (let i = 0; i < parts.length; i += 1) {
    if (i > 0) lines.push([]);
    if (!parts[i]) continue;
    lines[lines.length - 1].push({
      type: "text",
      text: parts[i],
      ...(Object.keys(style || {}).length > 0 ? { style } : {}),
    });
  }
}

function collectRichTextLines(node, inheritedStyle = {}) {
  const lines = [[]];
  const walk = (current, style) => {
    if (!current) return;
    if (current.nodeType === Node.TEXT_NODE) {
      appendRichTextSegment(lines, current.nodeValue || "", style);
      return;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return;
    if (current.tagName === "BR") {
      lines.push([]);
      return;
    }
    const nextStyle = styleFromDomElement(current, style);
    for (const child of current.childNodes) {
      walk(child, nextStyle);
    }
  };
  walk(node, inheritedStyle);
  while (
    lines.length > 1 &&
    lines[lines.length - 1].length === 0 &&
    isSlideTextBlockElement(node)
  ) {
    lines.pop();
  }
  return lines;
}

function slideTextBlocksFromInput(editor, previousBlocks = []) {
  if (!editor) return textToSegmentsBlocks("");
  const childNodes = Array.from(editor.childNodes);
  const hasDirectBlocks = childNodes.some(isSlideTextBlockElement);
  const lines = [];
  if (hasDirectBlocks) {
    for (const child of childNodes) {
      if (isSlideTextBlockElement(child)) {
        lines.push(...collectRichTextLines(child));
      } else {
        const collected = collectRichTextLines(child);
        if (collected.some((line) => line.length > 0)) lines.push(...collected);
      }
    }
  } else {
    lines.push(...collectRichTextLines(editor));
  }
  const normalizedLines = lines.length ? lines : [[]];
  return normalizedLines.map((segments, index) => {
    const previous = previousBlocks[index] || {};
    const normalizedSegments = normalizeSongSegments(segments);
    if (!normalizedSegments.length) {
      return {
        type: "spacer",
        id: previous.id || `block_${(crypto.randomUUID?.() || String(Math.random())).replace(/-/g, "").slice(0, 8)}`,
        primary: {
          lang: previous.primary?.lang || "en",
          segments: [],
        },
        translations: Array.isArray(previous.translations) ? previous.translations : [],
        annotations: Array.isArray(previous.annotations) ? previous.annotations : [],
      };
    }
    return {
      type: "lyricLine",
      id: previous.id || `block_${(crypto.randomUUID?.() || String(Math.random())).replace(/-/g, "").slice(0, 8)}`,
      primary: {
        lang: previous.primary?.lang || "en",
        segments: normalizedSegments,
      },
      translations: Array.isArray(previous.translations) ? previous.translations : [],
      annotations: Array.isArray(previous.annotations) ? previous.annotations : [],
    };
  });
}

function slideTextObjectElementById(objectId) {
  if (!objectId) return null;
  return Array.from(document.querySelectorAll(".slides-canvas-text-object"))
    .find((el) => el.dataset.objectId === objectId) || null;
}

function slideTextInputForObject(objectId) {
  return slideTextObjectElementById(objectId)?.querySelector(".slides-canvas-text-input") || null;
}

function captureSlideTextSelection(objectId) {
  const editor = slideTextInputForObject(objectId);
  const range = editor ? saveSongEditorCursorPosition(editor) : null;
  if (range && range.start !== range.end) {
    slideTextSelectionState = {
      objectId,
      start: Math.min(range.start, range.end),
      end: Math.max(range.start, range.end),
    };
    return slideTextSelectionState;
  }
  slideTextSelectionState = null;
  return null;
}

function selectedSlideTextRange(objectId) {
  if (
    slideTextSelectionState &&
    slideTextSelectionState.objectId === objectId &&
    slideTextSelectionState.start !== slideTextSelectionState.end
  ) {
    return slideTextSelectionState;
  }
  const live = captureSlideTextSelection(objectId);
  if (live) return live;
  return null;
}

function fitTextElementToBox(box, textEl, { baseSize, minSize, mode = "fit" } = {}) {
  if (!box || !textEl) return;
  const boxWidth = Math.max(1, box.clientWidth || box.getBoundingClientRect().width || 0);
  const boxHeight = Math.max(1, box.clientHeight || box.getBoundingClientRect().height || 0);
  if (!boxWidth || !boxHeight) return;
  let size = Math.max(1, Number(baseSize) || 1);
  const min = Math.max(1, Math.min(size, Number(minSize) || size));
  const hardMin = Math.min(size, 8);
  textEl.style.fontSize = `${size}px`;
  const overflows = () =>
    textEl.scrollHeight > Math.ceil(boxHeight) + 1 ||
    textEl.scrollWidth > Math.ceil(boxWidth) + 1;
  const normalMin = mode === "none" ? size : min;
  while (size > normalMin && overflows()) {
    size = Math.max(normalMin, Math.floor(size * 0.92));
    textEl.style.fontSize = `${size}px`;
  }
  while (size > hardMin && overflows()) {
    size = Math.max(hardMin, Math.floor(size * 0.92));
    textEl.style.fontSize = `${size}px`;
  }
}

function fitSlideTextEditorElement(el, object, scale) {
  const editor = el?.querySelector(".slides-canvas-text-input");
  if (!el || !editor || object?.kind !== "text") return;
  const style = object.style && typeof object.style === "object" ? object.style : {};
  const deckFontSize = Number(currentDeck?.theme?.fontSize);
  const baseSize = Number.isFinite(Number(style.fontSize))
    ? Number(style.fontSize)
    : Number.isFinite(deckFontSize)
      ? deckFontSize
      : DEFAULT_DECK_THEME.fontSize;
  const minSize = Number.isFinite(Number(style.minFontSize))
    ? Number(style.minFontSize)
    : Number(currentDeck?.theme?.minFontSize) || DEFAULT_DECK_THEME.minFontSize;
  const audienceBaseSize = normalizeScriptureFontSize(baseSize, DEFAULT_DECK_THEME.fontSize);
  const audienceMinSize = normalizeScriptureMinFontSize(minSize, audienceBaseSize);
  fitTextElementToBox(el, editor, {
    baseSize: Math.max(8, audienceBaseSize * scale),
    minSize: Math.max(6, audienceMinSize * scale),
    mode: object.autofit || currentDeck?.theme?.autosizeMode || "fit",
  });
}

function applySlideTextObjectFormatting(style, objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideTextObjectById(page, objectId);
  if (!obj || !style || typeof style !== "object") return;
  const selected = selectedSlideTextRange(obj.id);
  if (!selected) {
    updateSlideTextObjectStyle(style, obj.id);
    return;
  }
  recordSlideUndoForMutation("Style selected text");
  const styledSection = applySongStyleToSectionRange(
    { blocks: obj.blocks || [] },
    selected.start,
    selected.end,
    style,
  );
  obj.blocks = styledSection.blocks;
  activeSlideTextObjectId = obj.id;
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  const editor = slideTextInputForObject(obj.id);
  if (editor) {
    editor.focus({ preventScroll: true });
    restoreSongEditorCursorPosition(editor, selected);
  }
  void syncActiveDeckPresentation().catch(console.error);
}

function normalizeSlideTextObjectFrame(frame = DEFAULT_TEXT_FRAME) {
  const x = clampSlideFrame(frame.x, DEFAULT_TEXT_FRAME.x);
  const y = clampSlideFrame(frame.y, DEFAULT_TEXT_FRAME.y);
  const width = Math.max(0.01, Math.min(1 - x, Number(frame.width) || DEFAULT_TEXT_FRAME.width));
  const height = Math.max(0.01, Math.min(1 - y, Number(frame.height) || DEFAULT_TEXT_FRAME.height));
  return { x, y, width, height };
}

function applySlideTextObjectBackground(el, object) {
  const bgEl = el.querySelector(".slides-canvas-text-object-bg");
  if (!bgEl) return;
  bgEl.innerHTML = "";
  bgEl.style.backgroundColor = "";
  bgEl.style.backgroundImage = "";
  const bg = object?.background && typeof object.background === "object" ? object.background : null;
  if (!bg) return;
  if (bg.type === "color") {
    bgEl.style.backgroundColor = bg.color || "transparent";
    return;
  }
  if (bg.path) {
    if (bg.type === "video") {
      const videoEl = document.createElement("video");
      videoEl.src = pathToUrlSafe(bg.path);
      videoEl.autoplay = true;
      videoEl.loop = true;
      videoEl.muted = true;
      videoEl.playsInline = true;
      bgEl.appendChild(videoEl);
      void videoEl.play().catch(() => {});
    } else {
      bgEl.style.backgroundImage = `url("${pathToUrlSafe(bg.path)}")`;
    }
  }
}

function applySlideObjectElementBoxStyle(el, object) {
  const frame = normalizeSlideTextObjectFrame(object.frame);
  object.frame = frame;
  el.style.left = `${frame.x * 100}%`;
  el.style.top = `${frame.y * 100}%`;
  el.style.width = `${frame.width * 100}%`;
  el.style.height = `${frame.height * 100}%`;
  el.style.zIndex = String(Number.isFinite(object.zIndex) ? object.zIndex : 1);
  el.style.setProperty("--slide-object-opacity", String(clampSlideOpacity(object.opacity, 1)));
}

function applySlideTextObjectElementStyle(el, editor, object, scale) {
  applySlideObjectElementBoxStyle(el, object);
  const style = object.style && typeof object.style === "object" ? object.style : {};
  const objectFontSize = Number(style.fontSize);
  const deckFontSize = Number(currentDeck?.theme?.fontSize);
  const fontSize = Number.isFinite(objectFontSize)
    ? objectFontSize
    : Number.isFinite(deckFontSize)
      ? deckFontSize
      : DEFAULT_DECK_THEME.fontSize;
  const audienceFontSize = normalizeScriptureFontSize(fontSize, DEFAULT_DECK_THEME.fontSize);
  editor.style.fontFamily =
    style.fontFamily || currentDeck?.theme?.fontFamily || DEFAULT_DECK_THEME.fontFamily;
  editor.style.fontSize = `${Math.max(8, audienceFontSize * scale)}px`;
  editor.style.color = style.color || currentDeck?.theme?.textColor || "#fff";
  editor.style.fontWeight = String(style.fontWeight || currentDeck?.theme?.fontWeight || 700);
  editor.style.fontStyle = style.fontStyle || currentDeck?.theme?.fontStyle || "normal";
  editor.style.textDecoration = style.textDecoration || "";
  editor.style.lineHeight = String(style.lineHeight || currentDeck?.theme?.lineHeight || SCRIPTURE_LINE_HEIGHT);
  editor.style.textShadow = `0 ${2 * scale}px ${14 * scale}px rgba(0, 0, 0, 0.72)`;
  editor.style.textAlign = style.align || "center";
  editor.style.alignItems =
    style.align === "left" ? "flex-start" : style.align === "right" ? "flex-end" : "center";
  editor.style.justifyContent =
    style.verticalAlign === "top"
      ? "flex-start"
      : style.verticalAlign === "bottom"
        ? "flex-end"
        : "center";
  applySlideTextObjectBackground(el, object);
}

function bindSlideTextObjectElement(el, editor, object) {
  editor.dataset.suppress = "1";
  renderSlideTextInputFromBlocks(editor, object.blocks);
  delete editor.dataset.suppress;

  const activate = () => selectSlideTextObject(object.id);
  el.addEventListener("pointerdown", activate);
  editor.addEventListener("focus", activate);
  editor.addEventListener("input", () => {
    if (editor.dataset.suppress === "1") return;
    beginSlideUndoTransaction("Edit text");
    object.blocks = slideTextBlocksFromInput(editor, object.blocks);
    setDeckDirty(true);
    const canvas = document.getElementById("slidesCanvas");
    const scale = canvas ? canvas.getBoundingClientRect().width / (currentDeck?.canvas?.width || 1920) : 1;
    fitSlideTextEditorElement(el, object, scale);
    renderDeckPageStrip();
    void syncActiveDeckPresentation().catch(console.error);
  });
  editor.addEventListener("blur", () => {
    object.blocks = slideTextBlocksFromInput(editor, object.blocks);
    commitSlideUndoTransaction();
  });
  editor.addEventListener("paste", (event) => {
    const text = event.clipboardData?.getData("text/plain") || "";
    if (!text) return;
    event.preventDefault();
    document.execCommand("insertText", false, text);
  });
  editor.addEventListener("keyup", () => captureSlideTextSelection(object.id));
  editor.addEventListener("mouseup", () => captureSlideTextSelection(object.id));
  editor.addEventListener("contextmenu", (event) => {
    captureSlideTextSelection(object.id);
    showSlideTextObjectContextMenu(event, object.id);
  });
  el.addEventListener("contextmenu", (event) => {
    captureSlideTextSelection(object.id);
    showSlideTextObjectContextMenu(event, object.id);
  });

  el.addEventListener("pointerdown", (event) => {
    if (
      event.button !== 0 ||
      event.target.closest?.(".slides-canvas-text-handle") ||
      event.target.closest?.(".slides-canvas-text-input")
    ) return;
    const canvas = document.getElementById("slidesCanvas");
    if (!canvas) return;
    selectSlideTextObject(object.id);
    const canvasRect = canvas.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startFrame = normalizeSlideTextObjectFrame(object.frame);
    const w = canvasRect.width;
    const h = canvasRect.height;
    const dragThreshold = 4;
    let dragging = false;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {}
    const move = (e) => {
      const pixelDx = e.clientX - startX;
      const pixelDy = e.clientY - startY;
      if (!dragging) {
        if (Math.hypot(pixelDx, pixelDy) < dragThreshold) return;
        dragging = true;
        beginSlideUndoTransaction("Move object");
        el.classList.add("slides-canvas-drag-overlay");
      }
      e.preventDefault();
      const dx = pixelDx / w;
      const dy = pixelDy / h;
      object.frame = {
        ...startFrame,
        x: Math.max(0, Math.min(1 - startFrame.width, startFrame.x + dx)),
        y: Math.max(0, Math.min(1 - startFrame.height, startFrame.y + dy)),
      };
      el.style.left = `${object.frame.x * 100}%`;
      el.style.top = `${object.frame.y * 100}%`;
      setDeckDirty(true);
    };
    const up = (e) => {
      if (dragging) {
        e.preventDefault();
        e.stopPropagation();
      }
      commitSlideUndoTransaction();
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {}
      el.classList.remove("slides-canvas-drag-overlay");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }, true);

  for (const handle of el.querySelectorAll(".slides-canvas-text-handle")) {
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const canvas = document.getElementById("slidesCanvas");
      if (!canvas) return;
      selectSlideTextObject(object.id);
      const which = handle.dataset.handle;
      const canvasRect = canvas.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const startFrame = normalizeSlideTextObjectFrame(object.frame);
      const w = canvasRect.width;
      const h = canvasRect.height;
      beginSlideUndoTransaction("Resize object");
      handle.setPointerCapture(event.pointerId);
      const move = (e) => {
        const dx = (e.clientX - startX) / w;
        const dy = (e.clientY - startY) / h;
        let { x, y, width, height } = startFrame;
        if (which.includes("e")) width = Math.max(0.05, startFrame.width + dx);
        if (which.includes("s")) height = Math.max(0.05, startFrame.height + dy);
        if (which.includes("w")) {
          width = Math.max(0.05, startFrame.width - dx);
          x = Math.min(startFrame.x + startFrame.width - 0.05, startFrame.x + dx);
        }
        if (which.includes("n")) {
          height = Math.max(0.05, startFrame.height - dy);
          y = Math.min(startFrame.y + startFrame.height - 0.05, startFrame.y + dy);
        }
        if (x + width > 1) width = 1 - x;
        if (y + height > 1) height = 1 - y;
        object.frame = { x, y, width, height };
        el.style.left = `${x * 100}%`;
        el.style.top = `${y * 100}%`;
        el.style.width = `${width * 100}%`;
        el.style.height = `${height * 100}%`;
        setDeckDirty(true);
      };
      const up = () => {
        commitSlideUndoTransaction();
        try {
          handle.releasePointerCapture(event.pointerId);
        } catch {}
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }
}

function bindSlideObjectBoxInteractions(el, object) {
  const activate = () => selectSlideObject(object.id);
  el.addEventListener("pointerdown", activate);
  el.addEventListener("contextmenu", (event) => {
    showSlideObjectContextMenu(event, object.id);
  });

  el.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest?.(".slides-canvas-text-handle")) return;
    const canvas = document.getElementById("slidesCanvas");
    if (!canvas) return;
    selectSlideObject(object.id);
    const canvasRect = canvas.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startFrame = normalizeSlideTextObjectFrame(object.frame);
    const w = canvasRect.width;
    const h = canvasRect.height;
    const dragThreshold = 4;
    let dragging = false;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {}
    const move = (e) => {
      const pixelDx = e.clientX - startX;
      const pixelDy = e.clientY - startY;
      if (!dragging) {
        if (Math.hypot(pixelDx, pixelDy) < dragThreshold) return;
        dragging = true;
        beginSlideUndoTransaction("Move object");
        el.classList.add("slides-canvas-drag-overlay");
      }
      e.preventDefault();
      const dx = pixelDx / w;
      const dy = pixelDy / h;
      object.frame = {
        ...startFrame,
        x: Math.max(0, Math.min(1 - startFrame.width, startFrame.x + dx)),
        y: Math.max(0, Math.min(1 - startFrame.height, startFrame.y + dy)),
      };
      el.style.left = `${object.frame.x * 100}%`;
      el.style.top = `${object.frame.y * 100}%`;
      setDeckDirty(true);
    };
    const up = (e) => {
      if (dragging) {
        e.preventDefault();
        e.stopPropagation();
      }
      commitSlideUndoTransaction();
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {}
      el.classList.remove("slides-canvas-drag-overlay");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }, true);

  for (const handle of el.querySelectorAll(".slides-canvas-text-handle")) {
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const canvas = document.getElementById("slidesCanvas");
      if (!canvas) return;
      selectSlideObject(object.id);
      const which = handle.dataset.handle;
      const canvasRect = canvas.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const startFrame = normalizeSlideTextObjectFrame(object.frame);
      const w = canvasRect.width;
      const h = canvasRect.height;
      beginSlideUndoTransaction("Resize object");
      handle.setPointerCapture(event.pointerId);
      const move = (e) => {
        const dx = (e.clientX - startX) / w;
        const dy = (e.clientY - startY) / h;
        let { x, y, width, height } = startFrame;
        if (which.includes("e")) width = Math.max(0.05, startFrame.width + dx);
        if (which.includes("s")) height = Math.max(0.05, startFrame.height + dy);
        if (which.includes("w")) {
          width = Math.max(0.05, startFrame.width - dx);
          x = Math.min(startFrame.x + startFrame.width - 0.05, startFrame.x + dx);
        }
        if (which.includes("n")) {
          height = Math.max(0.05, startFrame.height - dy);
          y = Math.min(startFrame.y + startFrame.height - 0.05, startFrame.y + dy);
        }
        if (x + width > 1) width = 1 - x;
        if (y + height > 1) height = 1 - y;
        object.frame = { x, y, width, height };
        el.style.left = `${x * 100}%`;
        el.style.top = `${y * 100}%`;
        el.style.width = `${width * 100}%`;
        el.style.height = `${height * 100}%`;
        setDeckDirty(true);
      };
      const up = () => {
        commitSlideUndoTransaction();
        try {
          handle.releasePointerCapture(event.pointerId);
        } catch {}
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }
}

function slideObjectHandles() {
  return ["se", "sw", "ne", "nw"].map((handleName) => {
    const handle = document.createElement("div");
    handle.className = "slides-canvas-text-handle";
    handle.dataset.handle = handleName;
    handle.setAttribute("aria-hidden", "true");
    return handle;
  });
}

function createSlideTextObjectElement(object, scale) {
  const el = document.createElement("div");
  el.className = "slides-canvas-text-object slides-canvas-object slides-canvas-object--text";
  el.tabIndex = -1;
  el.dataset.objectId = object.id;
  if (object.id === activeSlideTextObjectId) el.classList.add("is-active");

  const bgEl = document.createElement("div");
  bgEl.className = "slides-canvas-text-object-bg";
  const textarea = document.createElement("div");
  textarea.className = "slides-canvas-text-input";
  textarea.contentEditable = "true";
  textarea.dataset.placeholder = "Type slide text...";
  textarea.setAttribute("role", "textbox");
  textarea.setAttribute("aria-multiline", "true");
  textarea.setAttribute("aria-label", "Slide text");
  const handles = slideObjectHandles();
  el.append(bgEl, textarea, ...handles);
  applySlideTextObjectElementStyle(el, textarea, object, scale);
  bindSlideTextObjectElement(el, textarea, object);
  return el;
}

function createSlideImageObjectElement(object) {
  const el = document.createElement("div");
  el.className = "slides-canvas-text-object slides-canvas-object slides-canvas-object--image";
  el.tabIndex = -1;
  el.dataset.objectId = object.id;
  if (object.id === activeSlideTextObjectId) el.classList.add("is-active");

  const image = object.image && typeof object.image === "object" ? object.image : {};
  const img = document.createElement("img");
  img.className = "slides-canvas-object__image";
  if (image.path) img.src = pathToUrlSafe(image.path);
  img.alt = "";
  img.draggable = false;
  const fit = image.fit === "cover" || image.fit === "fill" ? image.fit : "contain";
  img.style.objectFit = fit === "fill" ? "fill" : fit;
  el.append(img, ...slideObjectHandles());
  applySlideObjectElementBoxStyle(el, object);
  bindSlideObjectBoxInteractions(el, object);
  return el;
}

function createSlideShapeObjectElement(object) {
  const el = document.createElement("div");
  el.className = "slides-canvas-text-object slides-canvas-object slides-canvas-object--shape";
  el.tabIndex = -1;
  el.dataset.objectId = object.id;
  if (object.id === activeSlideTextObjectId) el.classList.add("is-active");

  const shape = object.shape && typeof object.shape === "object" ? object.shape : {};
  const shapeEl = document.createElement("div");
  shapeEl.className = "slides-canvas-object__shape";
  const opacity = `var(--slide-object-opacity, 1)`;
  shapeEl.style.opacity = opacity;
  if (shape.type === "ellipse") {
    shapeEl.style.borderRadius = "999px";
  } else if (shape.type === "line") {
    shapeEl.classList.add("slides-canvas-object__shape--line");
  } else if (Number.isFinite(shape.radius) && shape.radius > 0) {
    shapeEl.style.borderRadius = `${shape.radius}px`;
  }
  shapeEl.style.backgroundColor = shape.type === "line" ? "transparent" : (shape.fill || "#ffffff");
  if (shape.stroke || Number.isFinite(shape.strokeWidth)) {
    const strokeWidth = Number.isFinite(shape.strokeWidth) ? shape.strokeWidth : 1;
    shapeEl.style.border = `${strokeWidth}px solid ${shape.stroke || shape.fill || "#ffffff"}`;
  }
  if (shape.type === "line") {
    const strokeWidth = Number.isFinite(shape.strokeWidth) && shape.strokeWidth > 0 ? shape.strokeWidth : 4;
    shapeEl.style.border = "none";
    shapeEl.style.borderTop = `${strokeWidth}px solid ${shape.stroke || shape.fill || "#ffffff"}`;
  }
  el.append(shapeEl, ...slideObjectHandles());
  applySlideObjectElementBoxStyle(el, object);
  bindSlideObjectBoxInteractions(el, object);
  return el;
}

function createSlideObjectElement(object, scale) {
  if (object?.kind === "image") return createSlideImageObjectElement(object);
  if (object?.kind === "shape") return createSlideShapeObjectElement(object);
  return createSlideTextObjectElement(object, scale);
}

function layoutSlideCanvasFrame() {
  const frame = document.getElementById("slidesCanvasFrame");
  const wrap = document.querySelector(".slides-workspace__canvas-wrap");
  if (!frame || !wrap) return;
  const deckWidth = Number(currentDeck?.canvas?.width) || DEFAULT_CANVAS.width;
  const deckHeight = Number(currentDeck?.canvas?.height) || DEFAULT_CANVAS.height;
  const { width: cw, height: ch } = getElementContentSize(wrap);
  if (!cw || !ch) return;
  const scale = Math.min(cw / deckWidth, ch / deckHeight);
  if (!Number.isFinite(scale) || scale <= 0) return;
  frame.style.width = `${deckWidth * scale}px`;
  frame.style.height = `${deckHeight * scale}px`;
}

function renderSlideCanvas() {
  const canvas = document.getElementById("slidesCanvas");
  const bgEl = document.getElementById("slidesCanvasBackground");
  const textLayer = document.getElementById("slidesTextLayer");
  if (!canvas || !textLayer || !bgEl) return;

  // Fit the slide frame to both dimensions of the available space (same
  // "contain" technique the PPTX preview uses) so tall/short windows never
  // clip the slide vertically the way a pure CSS aspect-ratio box would.
  layoutSlideCanvasFrame();

  const page = currentPage();
  const hasPage = Boolean(page);
  textLayer.style.display = hasPage ? "" : "none";
  bgEl.style.display = hasPage ? "" : "none";

  if (!hasPage) {
    textLayer.innerHTML = "";
    bgEl.style.backgroundColor = "#000";
    bgEl.style.backgroundImage = "";
    return;
  }

  // Background
  const bg = page.background || {};
  if (bg.type === "image" && bg.path) {
    bgEl.style.backgroundColor = "#000";
    bgEl.style.backgroundImage = `url("${pathToUrlSafe(bg.path)}")`;
  } else {
    bgEl.style.backgroundColor = bg.color || currentDeck.theme?.backgroundColor || "#000";
    bgEl.style.backgroundImage = "";
  }

  const objects = orderedSlideObjects(page);
  if (!slideObjectById(page, activeSlideTextObjectId)) {
    activeSlideTextObjectId = objects.find((object) => object?.kind === "text")?.id || objects[0]?.id || null;
  }
  const canvasRect = canvas.getBoundingClientRect();
  const scale = canvasRect.width / (currentDeck.canvas?.width || 1920);
  textLayer.innerHTML = "";
  for (const object of objects) {
    const objectEl = createSlideObjectElement(object, scale);
    textLayer.appendChild(objectEl);
    if (object?.kind === "text") {
      fitSlideTextEditorElement(objectEl, object, scale);
    }
  }
  // The audience waits for its requested fonts before final fitting. Mirror
  // that behavior here; otherwise the editor can fit using a fallback font
  // and keep those metrics after the real family finishes loading.
  const fontRequests = [];
  for (const object of objects) {
    if (object?.kind !== "text") continue;
    const style = object.style || {};
    const family = style.fontFamily || currentDeck?.theme?.fontFamily || DEFAULT_DECK_THEME.fontFamily;
    const size = normalizeScriptureFontSize(style.fontSize || currentDeck?.theme?.fontSize, DEFAULT_DECK_THEME.fontSize);
    const weight = style.fontWeight || currentDeck?.theme?.fontWeight || 700;
    const fontStyle = style.fontStyle || currentDeck?.theme?.fontStyle || "normal";
    fontRequests.push(document.fonts?.load?.(`${fontStyle} ${weight} ${size}px ${songFontFamilyCSS(family)}`, slideTextObjectText(object) || "EMS"));
  }
  const renderedDeck = currentDeck;
  const renderedPageId = page.id;
  void Promise.all(fontRequests.filter(Boolean)).then(() => {
    if (currentDeck !== renderedDeck || currentDeckPageId !== renderedPageId) return;
    for (const object of objects) {
      if (object?.kind !== "text") continue;
      const objectEl = slideTextObjectElementById(object.id);
      if (objectEl) fitSlideTextEditorElement(objectEl, object, scale);
    }
  }).catch(() => {});
}

function flushSlideEditorTextToModel(_opts = {}) {
  if (!currentDeck) return;
  const page = currentPage();
  if (!page) return;
  document.querySelectorAll(".slides-canvas-text-object").forEach((el) => {
    const obj = slideTextObjectById(page, el.dataset.objectId);
    if (!obj) return;
    const editor = el.querySelector(".slides-canvas-text-input");
    if (editor) {
      const nextBlocks = slideTextBlocksFromInput(editor, obj.blocks);
      if (!slideBlocksEqual(nextBlocks, obj.blocks)) {
        obj.blocks = nextBlocks;
        setDeckDirty(true);
      }
    }
    const frame = slideTextFrameFromDom(el);
    if (frame && !slideFramesEqual(obj.frame, frame)) {
      obj.frame = frame;
      setDeckDirty(true);
    }
  });

  const fontSizeInput = document.getElementById("slidesDeckFontSize");
  const fontSize = Number(fontSizeInput?.value);
  if (Number.isFinite(fontSize) && fontSize > 0 && currentDeck.theme?.fontSize !== fontSize) {
    currentDeck.theme = { ...(currentDeck.theme || {}), fontSize };
    setDeckDirty(true);
  }

  const fontFamilyInput = document.getElementById("slidesDeckFontFamily");
  if (fontFamilyInput?.value && currentDeck.theme?.fontFamily !== fontFamilyInput.value) {
    currentDeck.theme = { ...(currentDeck.theme || {}), fontFamily: fontFamilyInput.value };
    setDeckDirty(true);
  }

  const textColorInput = document.getElementById("slidesDeckTextColor");
  if (textColorInput?.value && currentDeck.theme?.textColor !== textColorInput.value) {
    currentDeck.theme = { ...(currentDeck.theme || {}), textColor: textColorInput.value };
    setDeckDirty(true);
  }
}

/* ── Text object styling / context menu ───────────────────── */

function renderSlideTemplatePicker() {
  const host = document.getElementById("slidesTemplateList");
  if (!host) return;
  host.innerHTML = "";
  for (const template of SLIDE_LAYOUT_TEMPLATES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "slides-template-card";
    button.disabled = !currentDeck || !currentPage();
    button.dataset.templateId = template.id;
    button.setAttribute("role", "option");
    button.setAttribute("aria-label", template.label);

    const preview = document.createElement("span");
    preview.className = "slides-template-card__preview";
    for (const object of template.objects) {
      const box = document.createElement("span");
      box.className = "slides-template-card__box";
      box.style.left = `${object.frame.x * 100}%`;
      box.style.top = `${object.frame.y * 100}%`;
      box.style.width = `${object.frame.width * 100}%`;
      box.style.height = `${object.frame.height * 100}%`;
      preview.appendChild(box);
    }

    const label = document.createElement("span");
    label.className = "slides-template-card__label";
    label.textContent = template.label;
    button.append(preview, label);
    button.addEventListener("click", () => applySlideTemplate(template.id));
    host.appendChild(button);
  }
}

function slideTemplateBlocksForSlot(textObjects, slotIndex, slotCount) {
  if (!textObjects.length) return textToSegmentsBlocks("");
  if (slotCount === 1) {
    const text = textObjects
      .map((object) => slideTextObjectText(object).trim())
      .filter(Boolean)
      .join("\n\n");
    return text ? textToSegmentsBlocks(text) : blocksClone(textObjects[0]?.blocks, "");
  }
  return blocksClone(textObjects[slotIndex]?.blocks, "");
}

function createSlideTemplateTextObject(spec, slotIndex, slotCount, textObjects, baseZIndex) {
  const fontScale = Number.isFinite(spec.fontScale) ? spec.fontScale : 1;
  const deckFontSize = Number(currentDeck?.theme?.fontSize) || DEFAULT_DECK_THEME.fontSize;
  const obj = createTextObject({
    text: "",
    frame: spec.frame,
    style: {
      fontFamily: currentDeck?.theme?.fontFamily || DEFAULT_DECK_THEME.fontFamily,
      fontSize: Math.max(24, Math.round(deckFontSize * fontScale)),
      color: currentDeck?.theme?.textColor || DEFAULT_DECK_THEME.textColor,
      align: spec.align || "center",
      verticalAlign: spec.verticalAlign || "center",
    },
    zIndex: baseZIndex + slotIndex + 1,
  });
  obj.blocks = slideTemplateBlocksForSlot(textObjects, slotIndex, slotCount);
  return obj;
}

function applySlideTemplate(templateId) {
  const page = currentPage();
  const template = SLIDE_LAYOUT_TEMPLATES.find((candidate) => candidate.id === templateId);
  if (!page || !template) return;
  recordSlideUndoCheckpoint("Apply template");
  flushSlideEditorTextToModel();
  if (!Array.isArray(page.objects)) page.objects = [];
  const existingObjects = orderedSlideObjects(page);
  const textObjects = existingObjects.filter((object) => object?.kind === "text");
  const nonTextObjects = existingObjects.filter((object) => object?.kind !== "text");
  const baseZIndex = nonTextObjects.reduce(
    (max, object) => Math.max(max, Number.isFinite(object?.zIndex) ? object.zIndex : 0),
    0,
  );
  const textSlots = template.objects || [];
  const newTextObjects = textSlots.map((spec, index) =>
    createSlideTemplateTextObject(spec, index, textSlots.length, textObjects, baseZIndex),
  );
  page.objects = [...nonTextObjects, ...newTextObjects];
  activeSlideTextObjectId = newTextObjects[0]?.id || nonTextObjects[0]?.id || null;
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  renderSlideTemplatePicker();
  if (activeSlideTextObjectId) {
    selectSlideObject(activeSlideTextObjectId, { focus: newTextObjects[0]?.id === activeSlideTextObjectId });
  }
}

function nextSlideTextObjectFrame(page) {
  const count = slideTextObjectsForPage(page).length;
  const offset = Math.min(0.24, count * 0.04);
  return {
    x: Math.min(0.72, DEFAULT_TEXT_FRAME.x + offset),
    y: Math.min(0.72, DEFAULT_TEXT_FRAME.y + offset),
    width: DEFAULT_TEXT_FRAME.width,
    height: DEFAULT_TEXT_FRAME.height,
  };
}

function nextSlideObjectFrame(page, kind = "shape", { clientX = null, clientY = null } = {}) {
  const count = slideObjectsForPage(page).length;
  const offset = Math.min(0.2, count * 0.035);
  const base =
    kind === "line"
      ? { x: 0.18, y: 0.48, width: 0.64, height: 0.06 }
      : kind === "image"
        ? { x: 0.16, y: 0.16, width: 0.68, height: 0.68 }
        : { x: 0.22, y: 0.22, width: 0.56, height: 0.42 };
  const frame = {
    ...base,
    x: Math.min(Math.max(0, 1 - base.width), base.x + offset),
    y: Math.min(Math.max(0, 1 - base.height), base.y + offset),
  };
  return slideObjectFrameAtCanvasPoint(frame, { clientX, clientY });
}

function addSlideTextBox() {
  const page = currentPage();
  if (!page) return;
  recordSlideUndoCheckpoint("Add text box");
  flushSlideEditorTextToModel();
  if (!Array.isArray(page.objects)) page.objects = [];
  const obj = createTextObject({
    text: "",
    frame: nextSlideTextObjectFrame(page),
    style: {
      fontFamily: currentDeck?.theme?.fontFamily || DEFAULT_DECK_THEME.fontFamily,
      fontSize: Number(currentDeck?.theme?.fontSize) || DEFAULT_DECK_THEME.fontSize,
      color: currentDeck?.theme?.textColor || DEFAULT_DECK_THEME.textColor,
      align: "center",
      verticalAlign: "center",
    },
    zIndex: maxSlideObjectZIndex(page) + 1,
  });
  page.objects.push(obj);
  activeSlideTextObjectId = obj.id;
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  selectSlideTextObject(obj.id, { focus: true });
}

function chooseSlideObjectImage({ targetId = null, clientX = null, clientY = null } = {}) {
  if (!currentPage()) return;
  slideObjectImageTargetId = targetId || null;
  slideObjectImageInsertPoint =
    Number.isFinite(clientX) && Number.isFinite(clientY) ? { clientX, clientY } : null;
  document.getElementById("slidesObjectImageInput")?.click();
}

function addSlideImageObject(filePath, { clientX = null, clientY = null } = {}) {
  const page = currentPage();
  if (!page || !filePath) return null;
  recordSlideUndoCheckpoint("Add image");
  if (!Array.isArray(page.objects)) page.objects = [];
  const obj = createImageObject({
    path: filePath,
    fit: "contain",
    frame: nextSlideObjectFrame(page, "image", { clientX, clientY }),
    zIndex: maxSlideObjectZIndex(page) + 1,
  });
  page.objects.push(obj);
  activeSlideTextObjectId = obj.id;
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  selectSlideObject(obj.id);
  return obj;
}

function replaceSlideImageObject(objectId, filePath) {
  const page = currentPage();
  const obj = slideObjectById(page, objectId);
  if (!obj || obj.kind !== "image" || !filePath) return false;
  recordSlideUndoCheckpoint("Replace image");
  obj.image = {
    ...(obj.image && typeof obj.image === "object" ? obj.image : {}),
    path: filePath,
  };
  activeSlideTextObjectId = obj.id;
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  selectSlideObject(obj.id);
  return true;
}

function addSlideShapeObject(type = "rect", { clientX = null, clientY = null } = {}) {
  const page = currentPage();
  if (!page) return null;
  const shapeType = type === "ellipse" || type === "line" ? type : "rect";
  recordSlideUndoCheckpoint(`Add ${shapeType}`);
  if (!Array.isArray(page.objects)) page.objects = [];
  const obj = createShapeObject({
    type: shapeType,
    fill: shapeType === "line" ? currentDeck?.theme?.textColor || "#ffffff" : "#3584e4",
    stroke: shapeType === "line" ? currentDeck?.theme?.textColor || "#ffffff" : null,
    strokeWidth: shapeType === "line" ? 6 : 0,
    radius: shapeType === "rect" ? 12 : 0,
    frame: nextSlideObjectFrame(page, shapeType, { clientX, clientY }),
    zIndex: maxSlideObjectZIndex(page) + 1,
  });
  page.objects.push(obj);
  activeSlideTextObjectId = obj.id;
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  selectSlideObject(obj.id);
  return obj;
}

function duplicateSlideTextObject(objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideTextObjectById(page, objectId);
  if (!page || !obj) return;
  insertSlideObjectCopy(obj);
}

function insertSlideObjectCopy(sourceObject, { clientX = null, clientY = null } = {}) {
  const page = currentPage();
  if (!page || !sourceObject) return null;
  recordSlideUndoCheckpoint("Duplicate object");
  flushSlideEditorTextToModel();
  if (!Array.isArray(page.objects)) page.objects = [];
  const copy = cloneSlideObject(sourceObject);
  copy.id = newSlideObjectId();
  copy.frame = offsetSlideObjectFrame(copy.frame, { clientX, clientY });
  copy.zIndex = maxSlideObjectZIndex(page) + 1;
  copy.opacity = clampSlideOpacity(copy.opacity, 1);
  page.objects.push(copy);
  activeSlideTextObjectId = copy.id;
  slideObjectPasteCount += 1;
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  selectSlideObject(copy.id, { focus: copy.kind === "text" });
  return copy;
}

function canRemoveSlideObject(page, object) {
  return Boolean(page && object);
}

function deleteSlideObject(objectId = activeSlideTextObjectId, { quiet = false } = {}) {
  const page = currentPage();
  if (!page || !Array.isArray(page.objects)) return false;
  const obj = slideObjectById(page, objectId);
  if (!obj) return false;
  if (!canRemoveSlideObject(page, obj)) return false;
  const idx = page.objects.findIndex((candidate) => candidate && candidate.id === objectId);
  if (idx < 0) return false;
  recordSlideUndoCheckpoint("Delete object");
  page.objects.splice(idx, 1);
  activeSlideTextObjectId = orderedSlideObjects(page)[Math.min(idx, page.objects.length - 1)]?.id || null;
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  return true;
}

function copySlideObject(objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideObjectById(page, objectId);
  if (!obj) return false;
  flushSlideEditorTextToModel();
  slideObjectClipboard = cloneSlideObject(obj);
  slideObjectPasteCount = 0;
  showGnomeToast("Copied slide object");
  return true;
}

function cutSlideObject(objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideObjectById(page, objectId);
  if (!obj) return false;
  if (!copySlideObject(objectId)) return false;
  return deleteSlideObject(objectId, { quiet: true });
}

function pasteSlideObject({ clientX = null, clientY = null } = {}) {
  if (!slideObjectClipboard) {
    showGnomeToast("No slide object copied");
    return null;
  }
  return insertSlideObjectCopy(slideObjectClipboard, { clientX, clientY });
}

function setSlideObjectOpacity(opacity, objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideObjectById(page, objectId);
  if (!obj) return;
  recordSlideUndoForMutation("Set object opacity");
  obj.opacity = clampSlideOpacity(opacity, 1);
  setDeckDirty(true);
  renderSlideCanvas();
  selectSlideObject(obj.id, { focus: obj.kind === "text" });
}

function setSlideObjectZOrder(action, objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideObjectById(page, objectId);
  if (!page || !obj) return;
  const ordered = orderedSlideObjects(page);
  const currentIndex = ordered.findIndex((candidate) => candidate?.id === obj.id);
  if (currentIndex < 0) return;
  let nextIndex = currentIndex;
  if (action === "front") nextIndex = ordered.length - 1;
  else if (action === "back") nextIndex = 0;
  else if (action === "forward") nextIndex = Math.min(ordered.length - 1, currentIndex + 1);
  else if (action === "backward") nextIndex = Math.max(0, currentIndex - 1);
  if (nextIndex === currentIndex) return;
  recordSlideUndoCheckpoint("Arrange object");
  const [moved] = ordered.splice(currentIndex, 1);
  ordered.splice(nextIndex, 0, moved);
  ordered.forEach((object, index) => {
    object.zIndex = index + 1;
  });
  page.objects = ordered;
  activeSlideTextObjectId = obj.id;
  setDeckDirty(true);
  renderSlideCanvas();
  selectSlideObject(obj.id, { focus: obj.kind === "text" });
}

function deleteSlideTextObject(objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideTextObjectById(page, objectId);
  if (!page || !obj) return;
  deleteSlideObject(objectId);
}

function updateSlideTextObjectStyle(style, objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideTextObjectById(page, objectId);
  if (!obj || !style || typeof style !== "object") return;
  recordSlideUndoForMutation("Style text object");
  obj.style = { ...(obj.style || {}), ...style };
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  selectSlideTextObject(obj.id, { focus: true });
  void syncActiveDeckPresentation().catch(console.error);
}

function setSlideTextObjectBackground(background, objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideTextObjectById(page, objectId);
  if (!obj) return;
  recordSlideUndoForMutation("Set text background");
  if (background) {
    obj.background = background;
  } else {
    delete obj.background;
  }
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  selectSlideTextObject(obj.id, { focus: true });
  void syncActiveDeckPresentation().catch(console.error);
}

function setSlideImageObjectFit(fit, objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideObjectById(page, objectId);
  if (!obj || obj.kind !== "image") return;
  const nextFit = fit === "cover" || fit === "fill" ? fit : "contain";
  if ((obj.image?.fit || "contain") === nextFit) return;
  recordSlideUndoForMutation("Set image fit");
  obj.image = {
    ...(obj.image && typeof obj.image === "object" ? obj.image : {}),
    fit: nextFit,
  };
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  selectSlideObject(obj.id);
}

function updateSlideShapeObject(shapePatch, objectId = activeSlideTextObjectId) {
  const page = currentPage();
  const obj = slideObjectById(page, objectId);
  if (!obj || obj.kind !== "shape" || !shapePatch || typeof shapePatch !== "object") return;
  recordSlideUndoForMutation("Style shape");
  const currentShape = obj.shape && typeof obj.shape === "object" ? obj.shape : {};
  const nextShape = { ...currentShape, ...shapePatch };
  if (nextShape.type !== "ellipse" && nextShape.type !== "line") nextShape.type = "rect";
  obj.shape = nextShape;
  setDeckDirty(true);
  renderSlideCanvas();
  renderDeckPageStrip();
  selectSlideObject(obj.id);
}

function getOrCreateCallbackColorInput(id, onColor) {
  let input = document.getElementById(id);
  if (!input) {
    input = document.createElement("input");
    input.type = "color";
    input.id = id;
    input.style.position = "fixed";
    input.style.left = "-100px";
    input.style.top = "-100px";
    input.style.width = "32px";
    input.style.height = "32px";
    input.style.opacity = "0.01";
    input.style.pointerEvents = "none";
    input.style.zIndex = "999999";
    document.body.appendChild(input);
  }
  input.oninput = (event) => onColor(event.target.value);
  input.onchange = (event) => {
    onColor(event.target.value);
    commitSlideUndoTransaction();
  };
  input.onblur = () => commitSlideUndoTransaction();
  return input;
}

function hideSlidesEditorContextMenu() {
  const menu = document.getElementById("slidesEditorContextMenu");
  if (!menu) return;
  menu.style.display = "none";
  menu.style.visibility = "";
}

function positionSlidesEditorContextMenu(menu, x, y) {
  menu.classList.add("slides-editor-context-menu");
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.style.visibility = "hidden";
  menu.style.display = "block";
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
  menu.style.visibility = "";
}

function showCallbackColorPicker(event, inputId, color, onColor) {
  event.preventDefault();
  event.stopPropagation();
  beginSlideUndoTransaction("Pick color");
  const input = getOrCreateCallbackColorInput(inputId, onColor);
  input.value = color || "#ffffff";
  input.style.left = `${event.clientX}px`;
  input.style.top = `${event.clientY}px`;
  hideSlidesEditorContextMenu();
  input.focus({ preventScroll: true });
  try {
    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }
  } catch {}
  input.click();
}

function appendSlidesMenuItem(menu, label, onClick, { active = false, icon = "" } = {}) {
  const item = document.createElement("div");
  item.className = "song-editor-context-menu__item";
  if (active) item.classList.add("song-editor-context-menu__item--active");
  item.innerHTML = icon ? `<span class="icon">${icon}</span> ${label}` : label;
  item.addEventListener("click", onClick);
  menu.appendChild(item);
  return item;
}

function appendSlidesMenuHeader(menu, label) {
  const header = document.createElement("div");
  header.className = "song-editor-context-menu__header";
  header.textContent = label;
  menu.appendChild(header);
}

function appendSlidesMenuSeparator(menu) {
  menu.appendChild(document.createElement("div")).className = "song-editor-context-menu__separator";
}

function appendSlidesMenuButtonRow(menu, buttons, { columns = 3 } = {}) {
  const row = document.createElement("div");
  row.className = "slides-editor-context-menu__button-row";
  row.style.gridTemplateColumns = `repeat(${Math.max(1, columns)}, minmax(0, 1fr))`;
  for (const buttonDef of buttons) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "slides-editor-context-menu__button";
    if (buttonDef.active) button.classList.add("is-active");
    if (buttonDef.disabled) button.disabled = true;
    button.textContent = buttonDef.label;
    if (buttonDef.title) button.title = buttonDef.title;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      buttonDef.onClick?.(event);
    });
    row.appendChild(button);
  }
  menu.appendChild(row);
  return row;
}

function appendSlidesMenuSelect(menu, value, options, onChange) {
  const row = document.createElement("div");
  row.className = "slides-editor-context-menu__select-row";
  const select = document.createElement("select");
  select.className = "slides-editor-context-menu__select";
  for (const option of options) {
    const optionEl = document.createElement("option");
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    select.appendChild(optionEl);
  }
  select.value = value;
  select.addEventListener("change", () => onChange?.(select.value));
  row.appendChild(select);
  menu.appendChild(row);
  return select;
}

function appendSlideObjectMenuItems(menu, object, event) {
  const opacity = clampSlideOpacity(object?.opacity, 1);

  appendSlidesMenuHeader(menu, "Object");
  appendSlidesMenuButtonRow(menu, [
    {
      label: "Copy",
      onClick: () => {
        copySlideObject(object.id);
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Cut",
      onClick: () => {
        cutSlideObject(object.id);
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Paste",
      active: Boolean(slideObjectClipboard),
      onClick: () => {
        pasteSlideObject({ clientX: event?.clientX, clientY: event?.clientY });
        hideSlidesEditorContextMenu();
      },
    },
  ]);

  appendSlidesMenuSeparator(menu);
  appendSlidesMenuHeader(menu, "Arrange");
  appendSlidesMenuButtonRow(menu, [
    {
      label: "Forward",
      onClick: () => {
        setSlideObjectZOrder("forward", object.id);
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Backward",
      onClick: () => {
        setSlideObjectZOrder("backward", object.id);
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Front",
      onClick: () => {
        setSlideObjectZOrder("front", object.id);
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Back",
      onClick: () => {
        setSlideObjectZOrder("back", object.id);
        hideSlidesEditorContextMenu();
      },
    },
  ], { columns: 2 });

  appendSlidesMenuSeparator(menu);
  appendSlidesMenuHeader(menu, "Opacity");
  appendSlidesMenuButtonRow(menu, [
    { label: "100%", value: 1 },
    { label: "75%", value: 0.75 },
    { label: "50%", value: 0.5 },
    { label: "25%", value: 0.25 },
    { label: "0%", value: 0 },
  ].map((option) => ({
    label: option.label,
    active: Math.abs(opacity - option.value) < 0.01,
    onClick: () => {
      setSlideObjectOpacity(option.value, object.id);
      hideSlidesEditorContextMenu();
    },
  })), { columns: 5 });
}

function showSlideObjectContextMenu(event, objectId) {
  event.preventDefault();
  event.stopPropagation();
  const page = currentPage();
  const obj = slideObjectById(page, objectId);
  const menu = document.getElementById("slidesEditorContextMenu");
  if (!obj || !menu) return;
  if (obj.kind === "text") {
    showSlideTextObjectContextMenu(event, objectId);
    return;
  }
  selectSlideObject(obj.id);
  menu.innerHTML = "";
  appendSlideObjectMenuItems(menu, obj, event);

  if (obj.kind === "image") {
    const image = obj.image && typeof obj.image === "object" ? obj.image : {};
    const fit = image.fit === "cover" || image.fit === "fill" ? image.fit : "contain";
    appendSlidesMenuSeparator(menu);
    appendSlidesMenuHeader(menu, "Image");
    appendSlidesMenuButtonRow(menu, [
      {
        label: "Replace",
        onClick: () => {
          chooseSlideObjectImage({ targetId: obj.id });
          hideSlidesEditorContextMenu();
        },
      },
      ...["cover", "contain", "fill"].map((value) => ({
        label: value[0].toUpperCase() + value.slice(1),
        active: fit === value,
        onClick: () => {
          setSlideImageObjectFit(value, obj.id);
          hideSlidesEditorContextMenu();
        },
      })),
    ], { columns: 2 });
  } else if (obj.kind === "shape") {
    const shape = obj.shape && typeof obj.shape === "object" ? obj.shape : {};
    const shapeType = shape.type === "ellipse" || shape.type === "line" ? shape.type : "rect";
    appendSlidesMenuSeparator(menu);
    appendSlidesMenuHeader(menu, "Shape");
    appendSlidesMenuButtonRow(menu, [
      {
        label: "Fill",
        onClick: (evt) => {
          showCallbackColorPicker(
            evt,
            "slidesShapeFillInput",
            shape.fill || "#3584e4",
            (color) => updateSlideShapeObject({ fill: color }, obj.id),
          );
        },
      },
      {
        label: "Stroke",
        onClick: (evt) => {
          showCallbackColorPicker(
            evt,
            "slidesShapeStrokeInput",
            shape.stroke || shape.fill || "#ffffff",
            (color) => updateSlideShapeObject({
              stroke: color,
              strokeWidth: Number.isFinite(shape.strokeWidth) && shape.strokeWidth > 0 ? shape.strokeWidth : 4,
            }, obj.id),
          );
        },
      },
    ], { columns: 2 });
    appendSlidesMenuButtonRow(menu, [
      { label: "Rect", value: "rect" },
      { label: "Ellipse", value: "ellipse" },
      { label: "Line", value: "line" },
    ].map((option) => ({
      label: option.label,
      active: shapeType === option.value,
      onClick: () => {
        updateSlideShapeObject({
          type: option.value,
          ...(option.value === "line" && !(Number.isFinite(shape.strokeWidth) && shape.strokeWidth > 0)
            ? { strokeWidth: 6, stroke: shape.stroke || shape.fill || "#ffffff" }
            : {}),
        }, obj.id);
        hideSlidesEditorContextMenu();
      },
    })), { columns: 3 });
  }

  appendSlidesMenuSeparator(menu);
  appendSlidesMenuButtonRow(menu, [
    {
      label: "Duplicate",
      onClick: () => {
        insertSlideObjectCopy(obj);
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Delete",
      onClick: () => {
        deleteSlideObject(obj.id);
        hideSlidesEditorContextMenu();
      },
    },
  ], { columns: 2 });
  positionSlidesEditorContextMenu(menu, event.clientX, event.clientY);
}

function showSlideTextObjectContextMenu(event, objectId) {
  event.preventDefault();
  event.stopPropagation();
  const page = currentPage();
  const obj = slideTextObjectById(page, objectId);
  const menu = document.getElementById("slidesEditorContextMenu");
  if (!obj || !menu) return;
  selectSlideTextObject(obj.id);
  captureSlideTextSelection(obj.id);
  const style = obj.style || {};
  const background = obj.background || null;
  menu.innerHTML = "";

  appendSlideObjectMenuItems(menu, obj, event);
  appendSlidesMenuSeparator(menu);
  appendSlidesMenuHeader(menu, "Text Format");
  appendSlidesMenuButtonRow(menu, [{
    label: "Text Color",
    onClick: (evt) => {
      showCallbackColorPicker(
        evt,
        "slidesObjectTextColorInput",
        style.color || currentDeck?.theme?.textColor || DEFAULT_DECK_THEME.textColor,
        (color) => applySlideTextObjectFormatting({ color }, obj.id),
      );
    },
  }], { columns: 1 });
  appendSlidesMenuButtonRow(menu, [
    {
      label: "Bold",
      active: String(style.fontWeight || "") === "700" || style.fontWeight === "bold",
      onClick: () => {
        applySlideTextObjectFormatting({ fontWeight: "700" }, obj.id);
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Italic",
      active: style.fontStyle === "italic",
      onClick: () => {
        applySlideTextObjectFormatting({ fontStyle: "italic" }, obj.id);
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Underline",
      active: String(style.textDecoration || "").includes("underline"),
      onClick: () => {
        applySlideTextObjectFormatting({ textDecoration: "underline" }, obj.id);
        hideSlidesEditorContextMenu();
      },
    },
  ], { columns: 3 });

  const fontInput = document.getElementById("slidesDeckFontFamily");
  const fonts = fontInput
    ? Array.from(fontInput.options).map((option) => ({
        label: option.textContent || option.value,
        value: option.value,
      }))
    : [
        { label: "Adwaita Sans", value: "Adwaita Sans" },
        { label: "CMG Sans", value: "CMG Sans" },
        { label: "Arial", value: "Arial" },
        { label: "Georgia", value: "Georgia" },
      ];
  appendSlidesMenuSeparator(menu);
  appendSlidesMenuHeader(menu, "Font Family");
  const activeFont = style.fontFamily || currentDeck?.theme?.fontFamily || DEFAULT_DECK_THEME.fontFamily;
  appendSlidesMenuSelect(menu, activeFont, fonts, (fontFamily) => {
    applySlideTextObjectFormatting({ fontFamily }, obj.id);
    hideSlidesEditorContextMenu();
  });

  appendSlidesMenuSeparator(menu);
  appendSlidesMenuHeader(menu, "Text Box Background");
  appendSlidesMenuButtonRow(menu, [
    {
      label: "Color",
      onClick: (evt) => {
        showCallbackColorPicker(
          evt,
          "slidesObjectBackgroundColorInput",
          background?.color || "#000000",
          (color) => setSlideTextObjectBackground({ type: "color", color }, obj.id),
        );
      },
    },
    {
      label: "Media",
      onClick: (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        slideTextObjectBackgroundTargetId = obj.id;
        hideSlidesEditorContextMenu();
        document.getElementById("slidesTextObjectBackgroundInput")?.click();
      },
    },
    ...(background
      ? [{
          label: "Clear",
          onClick: (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            setSlideTextObjectBackground(null, obj.id);
            hideSlidesEditorContextMenu();
          },
        }]
      : []),
  ], { columns: background ? 3 : 2 });

  appendSlidesMenuSeparator(menu);
  appendSlidesMenuButtonRow(menu, [
    {
      label: "Duplicate",
      onClick: () => {
        duplicateSlideTextObject(obj.id);
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Delete",
      onClick: () => {
        deleteSlideTextObject(obj.id);
        hideSlidesEditorContextMenu();
      },
    },
  ], { columns: 2 });

  positionSlidesEditorContextMenu(menu, event.clientX, event.clientY);
}

function showSlideCanvasContextMenu(event) {
  if (event.target.closest?.(".slides-canvas-text-object")) return;
  event.preventDefault();
  event.stopPropagation();
  const menu = document.getElementById("slidesEditorContextMenu");
  if (!menu) return;
  menu.innerHTML = "";
  appendSlidesMenuHeader(menu, "Canvas");
  appendSlidesMenuButtonRow(menu, [
    {
      label: "Text Box",
      onClick: () => {
        addSlideTextBox();
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Image",
      onClick: () => {
        chooseSlideObjectImage({ clientX: event.clientX, clientY: event.clientY });
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Rect",
      onClick: () => {
        addSlideShapeObject("rect", { clientX: event.clientX, clientY: event.clientY });
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Ellipse",
      onClick: () => {
        addSlideShapeObject("ellipse", { clientX: event.clientX, clientY: event.clientY });
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Line",
      onClick: () => {
        addSlideShapeObject("line", { clientX: event.clientX, clientY: event.clientY });
        hideSlidesEditorContextMenu();
      },
    },
    {
      label: "Paste",
      active: Boolean(slideObjectClipboard),
      onClick: () => {
        pasteSlideObject({ clientX: event.clientX, clientY: event.clientY });
        hideSlidesEditorContextMenu();
      },
    },
  ], { columns: 3 });
  positionSlidesEditorContextMenu(menu, event.clientX, event.clientY);
}

function slideEditorShortcutEditableTarget(event) {
  const target = event.target;
  const editable = target?.closest?.("input, textarea, select, [contenteditable='true']");
  if (!editable) return null;
  if (!editable.closest?.("#slidesWorkspace")) return editable;
  return editable;
}

function editableSelectionIsCollapsed(editable) {
  if (
    (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) &&
    typeof editable.selectionStart === "number" &&
    typeof editable.selectionEnd === "number"
  ) {
    return editable.selectionStart === editable.selectionEnd;
  }
  const selection = window.getSelection?.();
  return !selection || selection.isCollapsed;
}

function handleSlideEditorClipboardShortcut(event) {
  if (!isSlidesWorkspaceVisible()) return false;
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
  const key = String(event.key || "").toLowerCase();
  if (!["c", "x", "v"].includes(key)) return false;
  const editable = slideEditorShortcutEditableTarget(event);
  if (editable) {
    const isSlideTextBox = Boolean(editable.closest?.(".slides-canvas-text-object"));
    if (key === "v" || !isSlideTextBox || !editableSelectionIsCollapsed(editable)) {
      return false;
    }
  }
  event.preventDefault();
  event.stopPropagation();
  if (key === "c") return copySlideObject(), true;
  if (key === "x") return cutSlideObject(), true;
  pasteSlideObject();
  return true;
}

function handleSlideEditorUndoRedoShortcut(event) {
  if (!isSlidesWorkspaceVisible()) return false;
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
  const key = String(event.key || "").toLowerCase();
  const wantsUndo = key === "z" && !event.shiftKey;
  const wantsRedo = key === "y" || (key === "z" && event.shiftKey);
  if (!wantsUndo && !wantsRedo) return false;
  if (slideEditorShortcutEditableTarget(event)) return false;
  event.preventDefault();
  event.stopPropagation();
  return wantsUndo ? undoSlideEdit() : redoSlideEdit();
}

function handleSlideEditorDeleteShortcut(event) {
  if (!isSlidesWorkspaceVisible()) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key !== "Delete" && event.key !== "Backspace") return false;
  if (slideEditorShortcutEditableTarget(event)) return false;
  if (!activeSlideTextObjectId) return false;
  event.preventDefault();
  event.stopPropagation();
  return deleteSlideObject(activeSlideTextObjectId);
}

function bindSlideUndoControlTransactions() {
  const controls = [
    ["slidesDeckTitleInput", "Edit deck title"],
    ["slidesDeckFolderSelect", "Move deck"],
    ["slidesDeckFontFamily", "Change deck font"],
    ["slidesDeckFontSize", "Change deck font size"],
    ["slidesDeckTextColor", "Change deck text color"],
    ["slidesDeckBgColor", "Change deck background"],
    ["slidesSongNumber", "Edit song number"],
    ["slidesSongAuthors", "Edit song authors"],
    ["slidesSongCopyright", "Edit song copyright"],
    ["slidesSongCcli", "Edit song CCLI number"],
    ["slidesSongLicense", "Edit song license"],
    ["slidesSongHymnalName", "Edit song hymnal"],
    ["slidesSongHymnalNumber", "Edit song hymnal number"],
    ["slidesSongMeter", "Edit song meter"],
    ["slidesPageLabelInput", "Edit page label"],
    ["slidesPageBackgroundColor", "Change page background"],
    ["slidesPageNotes", "Edit page notes"],
    ["slidesPageTransitionEffect", "Change transition"],
    ["slidesPageTransitionDuration", "Change transition"],
  ];
  for (const [id, label] of controls) {
    const control = document.getElementById(id);
    if (!control || control.dataset.slideUndoBound === "1") continue;
    control.dataset.slideUndoBound = "1";
    control.addEventListener("focus", () => beginSlideUndoTransaction(label));
    control.addEventListener("pointerdown", () => beginSlideUndoTransaction(label));
    control.addEventListener("change", () => commitSlideUndoTransaction());
    control.addEventListener("blur", () => commitSlideUndoTransaction());
  }
}

function attachSlideCanvasInteractions() {
  const canvas = document.getElementById("slidesCanvas");
  if (!canvas || canvas.dataset.slideInteractionsInstalled === "1") return;
  canvas.dataset.slideInteractionsInstalled = "1";
  canvas.addEventListener("contextmenu", showSlideCanvasContextMenu);
  document.addEventListener("pointerdown", (event) => {
    const menu = document.getElementById("slidesEditorContextMenu");
    if (!menu || menu.style.display === "none") return;
    if (menu.contains(event.target)) return;
    hideSlidesEditorContextMenu();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (handleSlideEditorUndoRedoShortcut(event)) return;
    if (handleSlideEditorClipboardShortcut(event)) return;
    if (handleSlideEditorDeleteShortcut(event)) return;
    if (event.key === "Escape") hideSlidesEditorContextMenu();
  });

  const mediaInput = document.getElementById("slidesTextObjectBackgroundInput");
  mediaInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    const targetId = slideTextObjectBackgroundTargetId || activeSlideTextObjectId;
    slideTextObjectBackgroundTargetId = null;
    if (!file || !targetId) return;
    const filePath = typeof getPathForFile === "function" ? getPathForFile(file) : "";
    if (!filePath) {
      showGnomeToast("Could not resolve file path");
      return;
    }
    const type = /\.(mp4|webm|mov|m4v)$/i.test(filePath) ? "video" : "image";
    setSlideTextObjectBackground({ type, path: filePath }, targetId);
    event.target.value = "";
  });

  const imageInput = document.getElementById("slidesObjectImageInput");
  imageInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    const targetId = slideObjectImageTargetId;
    const insertPoint = slideObjectImageInsertPoint;
    slideObjectImageTargetId = null;
    slideObjectImageInsertPoint = null;
    if (!file) return;
    const filePath = typeof getPathForFile === "function" ? getPathForFile(file) : "";
    if (!filePath) {
      showGnomeToast("Could not resolve file path");
      return;
    }
    if (targetId) {
      replaceSlideImageObject(targetId, filePath);
    } else {
      addSlideImageObject(filePath, insertPoint || {});
    }
    event.target.value = "";
  });
}

function updateCurrentSlideTransitionFromControls() {
  const page = currentPage();
  if (!page) return;
  recordSlideUndoForMutation("Change transition");
  const transition = readSlideTransitionControls(
    "slidesPageTransitionEffect",
    "slidesPageTransitionDuration",
    { allowInherit: true },
  );
  const override = normalizeItemSlideTransitionOverride(transition);
  if (override) {
    page.transition = override;
  } else {
    delete page.transition;
  }
  setDeckDirty(true);
  void syncActiveDeckPresentation().catch(console.error);
}

/* ── Show Now / Schedule ──────────────────────────────────── */

function buildDeckQueueEntry({ pageId = null } = {}) {
  if (!currentDeck) return null;
  flushSlideEditorTextToModel();
  if (currentDeckIsSongDocument()) {
    return buildSongQueueEntryFromDeck({
      deck: currentDeck,
      render: {
        ...currentSongRenderState,
        ...deckDefaultRender(currentDeck),
      },
      currentSectionId: pageId || currentDeckPageId,
      sourceKind: "library",
    });
  }
  const transientSong = deckToTransientSong(currentDeck);
  if (!transientSong) return null;
  const targetPageId = pageId || currentDeckPageId || transientSong.sections[0]?.id || null;
  const page = findPage(currentDeck, targetPageId);
  const overrides = pageRenderOverrides(page, currentDeck);
  const render = { ...deckDefaultRender(currentDeck), ...overrides };
  const entry = queueEntryFromSong({
    song: transientSong,
    render,
    currentSectionId: targetPageId,
  });
  const transitionOverride = normalizeItemSlideTransitionOverride(page?.transition);
  if (transitionOverride) entry.transition = transitionOverride;
  // Runtime rendering still uses the transient song snapshot, while project
  // identity and editor routing come from type/source/deckSnapshot.
  entry.type = "deck";
  entry.path = deckQueuePath(currentDeck.id, targetPageId);
  entry.name = currentDeck.title || "Slide Deck";
  entry.source = {
    kind: "deck",
    deckId: currentDeck.id,
    pageId: targetPageId,
    songId: transientSong.id,
  };
  entry.deckSnapshot = normalizeSlideDeck(currentDeck);
  return entry;
}

function syncCurrentDeckQueueItemSnapshot() {
  if (!currentDeck || !currentDeckPageId || !queueItemMatchesDeck(currentSongQueueItem, currentDeck)) {
    return null;
  }
  const existingItem = currentSongQueueItem;
  const preserved = {
    autoAdvance: existingItem.autoAdvance,
    cueStartTime: queueItemCueStartTime(existingItem),
    cueVolume: existingItem.cueVolume,
    loop: existingItem.loop,
  };
  const updated = buildDeckQueueEntry({ pageId: currentDeckPageId });
  if (!updated) return null;
  Object.assign(existingItem, updated);
  existingItem.autoAdvance = preserved.autoAdvance;
  existingItem.cueStartTime = queueItemSupportsCueStartTime(existingItem)
    ? preserved.cueStartTime
    : 0;
  if (preserved.cueVolume !== undefined) existingItem.cueVolume = preserved.cueVolume;
  if (preserved.loop !== undefined) existingItem.loop = preserved.loop;
  currentWorkspaceSongDeck = existingItem.deckSnapshot || normalizeSlideDeck(currentDeck);
  currentWorkspaceSong = existingItem.songSnapshot || deckToTransientSong(currentWorkspaceSongDeck);
  currentSongRenderState = mergeSongRenderState(DEFAULT_SONG_RENDER, existingItem.render || {});
  currentSongSectionId = currentDeckPageId;
  return existingItem;
}

async function syncActiveDeckPresentation() {
  const item = syncCurrentDeckQueueItemSnapshot();
  if (!item) return false;
  return syncActiveScheduledSongPresentation();
}

async function showCurrentDeckNow() {
  if (!currentDeck) {
    showGnomeToast("Select a deck first");
    return;
  }
  if (typeof hasAudienceOutputSelected === "function" && !hasAudienceOutputSelected()) {
    showGnomeToast("Choose an audience output display");
    return;
  }
  const entry = buildDeckQueueEntry({});
  if (!entry) return;
  try {
    if (typeof currentWorkspaceSong !== "undefined") currentWorkspaceSong = entry.songSnapshot;
    if (typeof currentSongRenderState !== "undefined") {
      currentSongRenderState = mergeSongRenderState(DEFAULT_SONG_RENDER, entry.render || {});
    }
    if (typeof currentSongSectionId !== "undefined") currentSongSectionId = entry.render?.currentSectionId || null;
    if (typeof currentSongSequenceEntryId !== "undefined") {
      currentSongSequenceEntryId =
        entry.currentSequenceEntryId || entry.sequence?.currentSequenceEntryId || null;
    }
    if (typeof currentSongSlideId !== "undefined") {
      currentSongSlideId = entry.currentSlideId || entry.render?.currentSlideId || null;
    }
    if (typeof currentSongQueueItem !== "undefined") currentSongQueueItem = entry;
    if (typeof mediaPlaybackEndedPending !== "undefined") setSharedRendererState({ mediaPlaybackEndedPending: false });
    if (typeof pendingQueueSwitchIndex !== "undefined") setSharedRendererState({ pendingQueueSwitchIndex: null });
    if (typeof pendingQueueSwitchStartTime !== "undefined") setSharedRendererState({ pendingQueueSwitchStartTime: 0 });
    if (typeof userStopPresentationPending !== "undefined") setSharedRendererState({ userStopPresentationPending: false });
    if (typeof currentQueueIndex !== "undefined") setSharedRendererState({ currentQueueIndex: -1 });

    if (typeof isActiveMediaWindow === "function" && isActiveMediaWindow() && activeMediaWindowContentType === "song") {
      await sendSongTextToOutput(entry);
      if (typeof isPlaying !== "undefined") setSharedRendererState({ isPlaying: true });
      if (typeof isQueuePlaying !== "undefined") setSharedRendererState({ isQueuePlaying: false });
      setSharedRendererState({ activeMediaWindowContentType: "song" });
      if (typeof markSongShowNowPresentation === "function") {
        markSongShowNowPresentation(entry);
      }
      if (typeof isActiveMediaWindowCache !== "undefined") setSharedRendererState({ isActiveMediaWindowCache: true });
      if (typeof updateDynUI === "function") updateDynUI();
      if (typeof renderQueue === "function") renderQueue();
      return;
    }
    const started = await createMediaWindow({
      textItem: entry,
      transientText: true,
      songItem: true,
    });
    if (!started) {
      showGnomeToast("No output started");
      return;
    }
    setSharedRendererState({ activeMediaWindowContentType: "song" });
    if (typeof isPlaying !== "undefined") setSharedRendererState({ isPlaying: true });
    if (typeof isQueuePlaying !== "undefined") setSharedRendererState({ isQueuePlaying: false });
    if (typeof markSongShowNowPresentation === "function") {
      markSongShowNowPresentation(entry);
    }
    if (typeof isActiveMediaWindowCache !== "undefined") setSharedRendererState({ isActiveMediaWindowCache: true });
    if (typeof updateDynUI === "function") updateDynUI();
    if (typeof renderQueue === "function") renderQueue();
  } catch (err) {
    console.error("Failed to show deck:", err);
    showGnomeToast(`Failed to show deck: ${err.message || err}`);
  }
}

function scheduleCurrentDeck() {
  if (!currentDeck) {
    showGnomeToast("Select a deck first");
    return;
  }
  const entry = buildDeckQueueEntry({});
  if (!entry) return;
  invalidateQueueUndoToastAfterMutation();
  insertQueueEntriesAfterSelection([entry]);
  renderQueue();
  saveMediaFile();
  showGnomeToast(`Scheduled ${entry.name}`);
}

async function openSongEditor(song) {
  const drawer = document.getElementById("songEditorDrawer");
  if (!drawer) return;

  let songToEdit = song || null;
  const scheduledQueueIndex = mediaQueue.indexOf(currentSongQueueItem);
  const scheduledSongId =
    currentSongQueueItem?.deckSnapshot?.id ||
    currentSongQueueItem?.songSnapshot?.id ||
    currentSongQueueItem?.source?.songId ||
    parseSongQueuePath(currentSongQueueItem?.path) ||
    null;
  const editingScheduledSnapshot = Boolean(
    scheduledQueueIndex >= 0 &&
    songToEdit?.id &&
    scheduledSongId === songToEdit.id,
  );
  if (songToEdit?.id) {
    const exists = await checkIfSongInLibrary(songToEdit.id);
    if (exists && !editingScheduledSnapshot) {
      try {
        songToEdit = await songsAPI.get(songToEdit.id);
        currentWorkspaceSong = songToEdit;
        syncSongsMoveFolderSelect(songToEdit);
      } catch (err) {
        console.error("Failed to load song for editing:", err);
        showGnomeToast("Failed to load song for editing");
        return;
      }
    } else if (!exists) {
      console.warn("Song not found in library, editing local/schedule snapshot instead");
      currentWorkspaceSong = songToEdit;
      syncSongsMoveFolderSelect(songToEdit, false);
    } else {
      // A scheduled song owns a project-local deck snapshot and theme
      // overrides. Replacing it with the library row here discards prior
      // WYSIWYG edits every time the editor is reopened.
      currentWorkspaceSongDeck = isSlideDeckDocument(songToEdit)
        ? normalizeSlideDeck(songToEdit)
        : currentWorkspaceSongDeck;
      currentWorkspaceSong = transientSongFromSongDocument(songToEdit);
      syncSongsMoveFolderSelect(songToEdit, true);
    }
  }

  if (!songToEdit) {
    currentSongRenderState = { ...DEFAULT_SONG_RENDER };
    const blankSong = normalizeToSongAST({
      schema: "ems.song.v1",
      id: `song_${crypto.randomUUID()}`,
      title: "Untitled Song",
      metadata: { authors: [], copyright: "", ccliNumber: null, oneLicense: null },
      sections: [
        {
          id: `sec_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`,
          kind: "verse",
          label: "Verse 1",
          blocks: textToSegmentsBlocks(""),
        },
      ],
      playOrder: [],
    });
    songToEdit = songAstToDeck(blankSong, { documentType: SONG_DECK_DOCUMENT_TYPE });
  }

  let songDeck = songDeckDocumentFromSongDocument(songToEdit, currentSongRenderState);
  if (!songDeck) {
    showGnomeToast("Could not open song editor");
    return;
  }
  const queueIndex = scheduledQueueIndex;
  const editingScheduledItem = queueIndex >= 0 && (
    currentSongQueueItem?.source?.songId === songDeck.id ||
    currentSongQueueItem?.deckSnapshot?.id === songDeck.id ||
    currentSongQueueItem?.songSnapshot?.id === songDeck.id ||
    parseSongQueuePath(currentSongQueueItem?.path) === songDeck.id
  );
  currentSongThemeEditingContext = null;
  if (editingScheduledItem) {
    const outputSize = selectedBiblePreviewOutputSize("dspSelct");
    const resolvedTheme = resolvedThemeForItem(currentSongQueueItem, "song", "audience", outputSize);
    if (resolvedTheme) {
      if (currentSongQueueItem?.itemTheme?.editorMaterialized !== true) {
        songDeck = songDeckWithResolvedTheme(songDeck, resolvedTheme);
      }
      const selected = itemThemeForRole(currentSongQueueItem, "audience");
      currentSongThemeEditingContext = {
        queueIndex,
        theme: selected.theme || appliedPresentationTheme,
        baseProfile: resolvedTheme,
      };
      currentSongRenderState = mergeSongRenderState(currentSongRenderState, liveThemeFields(resolvedTheme));
    }
  }
  currentEditingSongId = songDeck.id;
  currentWorkspaceSongDeck = songDeck;
  currentWorkspaceSong = deckToTransientSong(songDeck);
  currentSongRenderState = mergeSongRenderState(
    songRenderStateFromSongDocument(songDeck),
    currentSongRenderState,
  );
  currentSongSectionId =
    currentSongSectionId && findPage(songDeck, currentSongSectionId)
      ? currentSongSectionId
      : songDeck.pages?.[0]?.id || null;
  document.getElementById("songEditorDrawer")?.setAttribute("hidden", "");
  showSlidesWorkspace();
  loadDeckIntoWorkspace(songDeck, {
    pageId: currentSongSectionId,
    documentType: SONG_DECK_DOCUMENT_TYPE,
  });
  return;

  const launcher = document.getElementById("songsLauncher");
  const slide = document.getElementById("songsPreviewSlide");
  if (launcher) launcher.hidden = true;
  if (slide) slide.hidden = true;
  drawer.removeAttribute("hidden");

  const titleInput = document.getElementById("songEditorTitle");
  const authorInput = document.getElementById("songEditorAuthor");
  const folderInput = document.getElementById("songEditorFolder");
  const numberInput = document.getElementById("songEditorNumber");
  const textarea = document.getElementById("songEditorTextarea");

  syncSongEditorFolderOptions(songToEdit?.folderId || "");

  // Initialize visual editor state
  songEditorSections = songToEdit
    ? (normalizeToSongAST(songToEdit)?.sections || [])
    : [];
  if (songEditorSections.length === 0) {
    songEditorSections.push({
      id: `sec_${crypto.randomUUID().slice(0, 8)}`,
      kind: "verse",
      number: 1,
      label: "Verse 1",
      blocks: []
    });
  }
  songEditorActiveIndex = 0;

  // Set default tab to "Slides"
  document.getElementById("songEditorTabSlidesBtn")?.classList.add("active");
  document.getElementById("songEditorTabPropsBtn")?.classList.remove("active");
  document.getElementById("songEditorTabSlides")?.removeAttribute("style");
  document.getElementById("songEditorTabProps")?.setAttribute("style", "display: none;");

  // Set Header Title
  const headerTitle = document.getElementById("songEditorHeaderTitle");
  if (headerTitle) {
    headerTitle.textContent = songToEdit ? `Edit: ${songToEdit.title}` : "New Song";
  }

  if (songToEdit) {
    currentEditingSongId = songToEdit.id;
    titleInput.value = songToEdit.title || "";
    if (numberInput) {
      numberInput.value =
        Number.isFinite(songToEdit.songNumber) && songToEdit.songNumber > 0
          ? String(songToEdit.songNumber)
          : "";
    }
    authorInput.value = songToEdit.metadata?.authors?.join(", ") || "";
    if (folderInput) folderInput.value = songToEdit.folderId || "";
    textarea.value = songEditorTextFromSections(songEditorSections);
    syncSongEditorRenderControls(currentSongRenderState);
  } else {
    currentEditingSongId = null;
    titleInput.value = "";
    if (numberInput) numberInput.value = "";
    authorInput.value = "";
    if (folderInput) {
      folderInput.value =
        currentSongFolderFilter !== SONG_FOLDER_ALL &&
        currentSongFolderFilter !== SONG_FOLDER_UNFILED
          ? currentSongFolderFilter
          : "";
    }
    textarea.value = "";
    currentSongRenderState = { ...DEFAULT_SONG_RENDER };
    syncSongEditorRenderControls();
    syncSongEditorWorkspaceStyles();
  }

  const textBox = document.getElementById("songEditorTextBox");
  if (textBox) {
    const pos = currentSongRenderState.textBoxPosition || { left: "10%", top: "10%", width: "80%", height: "80%" };
    textBox.style.left = pos.left;
    textBox.style.top = pos.top;
    textBox.style.width = pos.width;
    textBox.style.height = pos.height;
  }
  syncSongEditorWorkspaceStyles();

  // Build the list and select the first slide
  renderSongEditorSlideList();
  selectSongEditorSlide(0);
}

async function checkIfSongInLibrary(songId) {
  if (!songId) return false;
  try {
    const results = await songsAPI.search("", { all: true });
    return results.some(song => song.id === songId);
  } catch (err) {
    return false;
  }
}

async function updateScheduleSongsWithUpdatedSong(song, opts = {}) {
  const applyTransitionOverride = opts.applyTransitionOverride === true;
  const songDeck = songDeckDocumentFromSongDocument(song, currentSongRenderState);
  const songId = songDeck?.id || song?.id;
  let updatedCount = 0;
  for (let i = 0; i < mediaQueue.length; i++) {
    const item = mediaQueue[i];
    if (
      item.type === "song" &&
      (item.source?.songId === songId || item.deckSnapshot?.id === songId || parseSongQueuePath(item.path) === songId)
    ) {
      const updatedEntry = buildSongQueueEntryFromDeck({
        deck: songDeck,
        render: currentSongRenderState,
        currentSectionId: item.render?.currentSectionId || currentSongSectionId,
      });
      if (!updatedEntry) continue;
      updatedEntry.autoAdvance = item.autoAdvance;
      updatedEntry.cueStartTime = queueItemCueStartTime(item);
      if (applyTransitionOverride) {
        const transitionOverride = normalizeItemSlideTransitionOverride(currentSongRenderState.transition);
        if (transitionOverride) {
          updatedEntry.transition = transitionOverride;
        } else {
          delete updatedEntry.transition;
        }
      } else if (item.transition) {
        updatedEntry.transition = item.transition;
      }
      mediaQueue[i] = updatedEntry;
      updatedCount++;
    }
  }
  if (updatedCount > 0) {
    invalidateQueueUndoToastAfterMutation();
    renderQueue();
    saveMediaFile();
  }
}

async function saveSongEditor() {
  const titleInput = document.getElementById("songEditorTitle");
  const authorInput = document.getElementById("songEditorAuthor");
  const folderInput = document.getElementById("songEditorFolder");
  const numberInput = document.getElementById("songEditorNumber");
  const textarea = document.getElementById("songEditorTextarea");

  const title = titleInput.value.trim() || "Untitled Song";
  const authorText = authorInput.value.trim();
  const folderId = folderInput?.value?.trim() || null;
  const numberRaw = numberInput?.value?.trim() || "";
  const parsedNumber = numberRaw ? Number.parseInt(numberRaw, 10) : null;
  const songNumber = Number.isFinite(parsedNumber) && parsedNumber > 0 ? parsedNumber : null;
  currentSongRenderState = flushSongEditorStateForSave();
  const sections = normalizeToSongAST({
    id: currentEditingSongId || "editor_song",
    title,
    metadata: {},
    sections: songEditorSections,
  })?.sections || [];

  const song = {
    schema: "ems.song.v1",
    id: currentEditingSongId || `song_${crypto.randomUUID()}`,
    title,
    folderId,
    ...(songNumber ? { songNumber } : {}),
    metadata: {
      authors: authorText ? authorText.split(",").map((a) => a.trim()).filter(Boolean) : [],
      copyright: currentSongRenderState.copyright || "",
      ccliNumber: currentSongRenderState.ccliNumber || null,
      oneLicense: currentSongRenderState.oneLicense || null,
      meter: currentWorkspaceSong?.metadata?.meter || currentWorkspaceSong?.metadata?.hymnal?.meter || "",
    },
    sections,
    playOrder: reconcileSongPlayOrder(currentWorkspaceSong?.playOrder, sections),
    defaultRender: {
      ...songDefaultRenderFromRender(currentSongRenderState),
    },
  };
  const songDeck = songDeckDocumentFromSongDocument(song, currentSongRenderState);

  try {
    const saved = await songsAPI.save(songDeck);
    closeSongEditor();
    
    // Update schedule items with the saved song
    await updateScheduleSongsWithUpdatedSong(saved || songDeck);

    const searchInput = document.getElementById("songsSearchInput");
    await refreshSongFolders();
    if (searchInput) await refreshSongsBrowser(searchInput.value);
    await loadSongIntoWorkspace(saved || songDeck, { render: currentSongRenderState });
  } catch (err) {
    console.error("Failed to save song:", err);
    alert(`Failed to save song: ${err.message}`);
  }
}

async function saveSongToSchedule() {
  const titleInput = document.getElementById("songEditorTitle");
  const authorInput = document.getElementById("songEditorAuthor");
  const folderInput = document.getElementById("songEditorFolder");
  const numberInput = document.getElementById("songEditorNumber");
  const textarea = document.getElementById("songEditorTextarea");

  const title = titleInput.value.trim() || "Untitled Song";
  const authorText = authorInput.value.trim();
  const folderId = folderInput?.value?.trim() || null;
  const numberRaw = numberInput?.value?.trim() || "";
  const parsedNumber = numberRaw ? Number.parseInt(numberRaw, 10) : null;
  const songNumber = Number.isFinite(parsedNumber) && parsedNumber > 0 ? parsedNumber : null;
  currentSongRenderState = flushSongEditorStateForSave();
  const sections = normalizeToSongAST({
    id: currentEditingSongId || "editor_song",
    title,
    metadata: {},
    sections: songEditorSections,
  })?.sections || [];

  const songId = currentEditingSongId || `song_${crypto.randomUUID()}`;
  currentEditingSongId = songId;

  const song = {
    schema: "ems.song.v1",
    id: songId,
    title,
    folderId,
    ...(songNumber ? { songNumber } : {}),
    metadata: {
      authors: authorText ? authorText.split(",").map((a) => a.trim()).filter(Boolean) : [],
      copyright: currentSongRenderState.copyright || "",
      ccliNumber: currentSongRenderState.ccliNumber || null,
      oneLicense: currentSongRenderState.oneLicense || null,
      meter: currentWorkspaceSong?.metadata?.meter || currentWorkspaceSong?.metadata?.hymnal?.meter || "",
    },
    sections,
    playOrder: reconcileSongPlayOrder(currentWorkspaceSong?.playOrder, sections),
    defaultRender: {
      ...songDefaultRenderFromRender(currentSongRenderState),
    },
  };

  const songDeck = songDeckDocumentFromSongDocument(song, currentSongRenderState);
  const entry = buildSongQueueEntryFromDeck({
    deck: songDeck,
    render: currentSongRenderState,
    currentSectionId: currentSongSectionId,
  });
  if (!entry) return;

  let updatedCount = 0;
  for (let i = 0; i < mediaQueue.length; i++) {
    const item = mediaQueue[i];
    if (
      item.type === "song" &&
      (item.source?.songId === songId || item.deckSnapshot?.id === songId || parseSongQueuePath(item.path) === songId)
    ) {
      const updatedEntry = buildSongQueueEntryFromDeck({
        deck: songDeck,
        render: currentSongRenderState,
        currentSectionId: item.render?.currentSectionId || currentSongSectionId,
      });
      if (!updatedEntry) continue;
      updatedEntry.autoAdvance = item.autoAdvance;
      updatedEntry.cueStartTime = queueItemCueStartTime(item);
      const transitionOverride = normalizeItemSlideTransitionOverride(currentSongRenderState.transition);
      if (transitionOverride) {
        updatedEntry.transition = transitionOverride;
      } else {
        delete updatedEntry.transition;
      }
      mediaQueue[i] = updatedEntry;
      updatedCount++;
    }
  }

  if (updatedCount > 0) {
    showGnomeToast(`Updated ${entry.name} in schedule`);
  } else {
    insertQueueEntriesAfterSelection([entry]);
    showGnomeToast(`Scheduled ${entry.name}`);
  }

  closeSongEditor();
  currentWorkspaceSongDeck = songDeck;
  currentWorkspaceSong = deckToTransientSong(songDeck);
  await loadSongIntoWorkspace(songDeck, { render: currentSongRenderState });

  invalidateQueueUndoToastAfterMutation();
  renderQueue();
  saveMediaFile();
}

async function deleteSongFromLibrary(songId = currentWorkspaceSong?.id) {
  const id = typeof songId === "string" ? songId.trim() : "";
  if (!id) {
    showGnomeToast("Select a song to delete");
    return false;
  }

  const title = currentWorkspaceSong?.id === id
    ? currentWorkspaceSong.title
    : id;
  const accepted = window.confirm(`Delete "${title}" from the song library? Scheduled project copies will not be removed.`);
  if (!accepted) return false;

  try {
    await songsAPI.delete(id);
    if (currentWorkspaceSong?.id === id) {
      await loadSongIntoWorkspace(null);
      const launcher = document.getElementById("songsLauncher");
      const slide = document.getElementById("songsPreviewSlide");
      if (launcher) launcher.hidden = false;
      if (slide) slide.hidden = true;
    }
    const searchInput = document.getElementById("songsSearchInput");
    await refreshSongFolders();
    await refreshSongsBrowser(searchInput?.value || "");
    showGnomeToast(`Deleted ${title}`);
    return true;
  } catch (err) {
    console.error("Failed to delete song:", err);
    showGnomeToast(`Delete failed: ${err.message}`);
    return false;
  }
}

function renderStateForLibrarySong(song) {
  return mergeSongRenderState(songRenderStateFromSongDocument(song), {
    copyright: song?.metadata?.copyright || "",
    ccliNumber: song?.metadata?.ccliNumber || null,
    oneLicense: song?.metadata?.oneLicense || null,
  });
}

async function loadFullLibrarySong(songSummary) {
  if (songSummary?.sections?.length || isSlideDeckDocument(songSummary)) return songSummary;
  return songsAPI.get(songSummary.id);
}

async function activateSongFromLibrary(songSummary, { openEditor = false } = {}) {
  try {
    currentSongQueueItem = null;
    const fullSong = await loadFullLibrarySong(songSummary);
    currentSongRenderState = renderStateForLibrarySong(fullSong);
    await loadSongIntoWorkspace(fullSong);
    document.querySelectorAll(".songs-list-item").forEach((el) => {
      el.classList.toggle("is-selected", el.dataset.songId === fullSong.id);
    });
    if (openEditor) {
      await openSongEditor(fullSong);
    }
    return fullSong;
  } catch (err) {
    console.error("Failed to load song details:", err);
    showGnomeToast("Failed to load song");
    return null;
  }
}

async function scheduleSongFromLibrary(songSummary) {
  try {
    const song = await loadFullLibrarySong(songSummary);
    const entry = buildSongQueueEntryFromDeck({
      deck: song,
      render: renderStateForLibrarySong(song),
    });
    if (!entry) return false;
    invalidateQueueUndoToastAfterMutation();
    insertQueueEntriesAfterSelection([entry]);
    renderQueue();
    saveMediaFile();
    showGnomeToast(`Scheduled ${entry.name}`);
    return true;
  } catch (err) {
    console.error("Failed to schedule song:", err);
    showGnomeToast("Failed to schedule song");
    return false;
  }
}

async function showSongFromLibraryNow(songSummary) {
  try {
    const song = await loadFullLibrarySong(songSummary);
    currentSongRenderState = renderStateForLibrarySong(song);
    await loadSongIntoWorkspace(song);
    document.querySelectorAll(".songs-list-item").forEach((el) => {
      el.classList.toggle("is-selected", el.dataset.songId === song.id);
    });
    return showSongTextNow();
  } catch (err) {
    console.error("Failed to show song:", err);
    showGnomeToast("Failed to show song");
    return false;
  }
}

function hideSongContextMenu() {
  document.getElementById("songContextMenu")?.setAttribute("hidden", "");
}

function buildSongContextMenuMarkup() {
  const folderItems = [
    `<button type="button" role="menuitem" data-song-action="move" data-folder-id="${SONG_FOLDER_UNFILED}">Default</button>`,
    ...songFoldersCache.map(
      (folder) =>
        `<button type="button" role="menuitem" data-song-action="move" data-folder-id="${escapeHtml(folder.id)}">${escapeHtml(folder.name)}</button>`,
    ),
  ].join("");
  return `
    <button type="button" role="menuitem" data-song-action="edit">Open Editor</button>
    <button type="button" role="menuitem" data-song-action="schedule">Add to Schedule</button>
    <button type="button" role="menuitem" data-song-action="show">Show Now</button>
    <div class="song-context-menu__separator" role="separator"></div>
    <div class="song-context-menu__submenu-host">
      <button type="button" class="song-context-menu__submenu-trigger" aria-haspopup="true" aria-expanded="false">Move to Folder…</button>
      <div class="song-context-menu__submenu" role="menu">${folderItems}</div>
    </div>
    <div class="song-context-menu__separator" role="separator"></div>
    <button type="button" role="menuitem" data-song-action="delete" class="song-context-menu__destructive">Delete</button>
  `;
}

function ensureSongContextMenu() {
  let menu = document.getElementById("songContextMenu");
  if (menu) return menu;

  menu = document.createElement("div");
  menu.id = "songContextMenu";
  menu.className = "song-context-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;

  menu.addEventListener("pointerdown", (event) => event.stopPropagation());
  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    const moveBtn = event.target.closest("[data-song-action='move']");
    if (moveBtn) {
      const song = menu._targetSong;
      hideSongContextMenu();
      if (!song?.id) return;
      const folderId =
        moveBtn.getAttribute("data-folder-id") === SONG_FOLDER_UNFILED
          ? null
          : moveBtn.getAttribute("data-folder-id");
      void songsAPI
        .moveToFolder(song.id, folderId)
        .then(async (updated) => {
          if (updated && currentWorkspaceSong?.id === song.id) {
            currentWorkspaceSong = updated;
          } else if (currentWorkspaceSong?.id === song.id) {
            currentWorkspaceSong.folderId = folderId;
          }
          syncSongsMoveFolderSelect(currentWorkspaceSong);
          await refreshSongFolders();
          const searchInput = document.getElementById("songsSearchInput");
          await refreshSongsBrowser(searchInput?.value || "");
          showGnomeToast("Song moved");
        })
        .catch((err) => {
          console.error("Failed to move song:", err);
          showGnomeToast("Failed to move song");
        });
      return;
    }

    const button = event.target.closest("[data-song-action]");
    if (!button) return;
    const song = menu._targetSong;
    const action = button.getAttribute("data-song-action");
    hideSongContextMenu();
    if (!song) return;
    if (action === "edit") {
      void activateSongFromLibrary(song, { openEditor: true }).catch(console.error);
    } else if (action === "schedule") {
      void scheduleSongFromLibrary(song).catch(console.error);
    } else if (action === "show") {
      void showSongFromLibraryNow(song).catch(console.error);
    } else if (action === "delete") {
      void deleteSongFromLibrary(song.id).catch(console.error);
    }
  });

  document.body.appendChild(menu);
  if (document.body.dataset.songContextMenuBound !== "1") {
    document.body.dataset.songContextMenuBound = "1";
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (event.target.closest?.("#songContextMenu")) return;
        hideSongContextMenu();
      },
      true,
    );
    window.addEventListener("resize", hideSongContextMenu);
    window.addEventListener("scroll", hideSongContextMenu, true);
  }
  return menu;
}

function showSongContextMenu(event, song) {
  event.preventDefault();
  event.stopPropagation();
  const menu = ensureSongContextMenu();
  menu.innerHTML = buildSongContextMenuMarkup();
  menu._targetSong = song;
  menu.hidden = false;
  menu.style.left = "0px";
  menu.style.top = "0px";
  const menuRect = menu.getBoundingClientRect();
  const left = Math.max(
    8,
    Math.min(event.clientX, window.innerWidth - menuRect.width - 8),
  );
  const top = Math.max(
    8,
    Math.min(event.clientY, window.innerHeight - menuRect.height - 8),
  );
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

async function refreshSongsBrowser(query = "", prefetchedResults = null) {
  try {
    const trimmedQuery = String(query || "").trim();
    const results = asSongArray(
      prefetchedResults ??
        (await songsAPI.search(trimmedQuery, songSearchOptionsForCurrentFolder())),
    );
    const list = document.getElementById("songsList");
    if (!list) return;

    if (!list._delegationInitialized) {
      list._delegationInitialized = true;

      list.addEventListener("click", async (event) => {
        const deleteBtn = event.target.closest(".songs-list-item__delete");
        if (deleteBtn) {
          event.stopPropagation();
          const row = deleteBtn.closest(".songs-list-item");
          if (row) {
            const songId = row.dataset.songId;
            void deleteSongFromLibrary(songId).catch(console.error);
          }
          return;
        }

        const checkbox = event.target.closest(".songs-list-item__checkbox");
        if (checkbox) {
          event.stopPropagation();
          return;
        }

        const label = event.target.closest(".songs-list-item__label");
        if (label) {
          const row = label.closest(".songs-list-item");
          if (row) {
            const songId = row.dataset.songId;
            const songTitle = row.dataset.songTitle;
            const checkboxEl = row.querySelector(".songs-list-item__checkbox");
            if (event.shiftKey || event.ctrlKey || event.metaKey) {
              if (checkboxEl) {
                checkboxEl.checked = !checkboxEl.checked;
                setSongRowSelected(row, songId, checkboxEl.checked);
              }
              return;
            }
            if (event.detail > 1) return;
            if (songLibraryClickTimer !== null) window.clearTimeout(songLibraryClickTimer);
            songLibraryClickTimer = window.setTimeout(() => {
              songLibraryClickTimer = null;
              void activateSongFromLibrary({ id: songId, title: songTitle }).catch(console.error);
            }, 220);
          }
        }
      });

      list.addEventListener("change", (event) => {
        const checkbox = event.target.closest(".songs-list-item__checkbox");
        if (checkbox) {
          const row = checkbox.closest(".songs-list-item");
          if (row) {
            const songId = row.dataset.songId;
            setSongRowSelected(row, songId, checkbox.checked);
          }
        }
      });

      list.addEventListener("dblclick", (event) => {
        const row = event.target.closest(".songs-list-item");
        if (row) {
          if (
            event.target.closest(
              ".songs-list-item__checkbox, .songs-list-item__delete, .songs-list-item__drag-handle",
            )
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (songLibraryClickTimer !== null) {
            window.clearTimeout(songLibraryClickTimer);
            songLibraryClickTimer = null;
          }
          const songId = row.dataset.songId;
          const songTitle = row.dataset.songTitle;
          void scheduleSongFromLibrary({ id: songId, title: songTitle }).catch(console.error);
        }
      });

      list.addEventListener("contextmenu", (event) => {
        const row = event.target.closest(".songs-list-item");
        if (row) {
          if (event.target.closest(".songs-list-item__checkbox, .songs-list-item__delete")) {
            return;
          }
          const songId = row.dataset.songId;
          const songTitle = row.dataset.songTitle;
          showSongContextMenu(event, { id: songId, title: songTitle });
        }
      });

      list.addEventListener("dragstart", (event) => {
        const row = event.target.closest(".songs-list-item");
        if (row) {
          if (event.target.closest(".songs-list-item__checkbox, .songs-list-item__delete")) {
            event.preventDefault();
            return;
          }
          const songId = row.dataset.songId;
          const songTitle = row.dataset.songTitle;
          setSharedRendererState({ songDragSongId: songId });
          event.dataTransfer.setData(SONG_DRAG_MIME, songId);
          event.dataTransfer.setData("text/plain", songTitle || "Song");
          event.dataTransfer.effectAllowed = "copyMove";
          row.classList.add("songs-list-item--dragging");
        }
      });

      list.addEventListener("dragend", () => {
        clearSongDragVisualState();
      });
    }

    const existingRows = Array.from(list.children);
    if (
      existingRows.length === 1 &&
      (existingRows[0].classList.contains("list-placeholder-title") ||
        existingRows[0].classList.contains("list-placeholder") ||
        existingRows[0].tagName === "SPAN")
    ) {
      list.innerHTML = "";
      existingRows.length = 0;
    }

    if (results.length === 0) {
      list.innerHTML = '<span class="list-placeholder-title">No songs found</span>';
      syncSongsBulkActions();
      return;
    }

    const numResults = results.length;
    for (let i = 0; i < numResults; i++) {
      const song = results[i];
      let row = existingRows[i];
      let dragHandle, checkbox, numberEl, label, titleSpan, subtitleSpan, deleteBtn;

      if (row && row.classList.contains("songs-list-item")) {
        dragHandle = row.querySelector(".songs-list-item__drag-handle");
        checkbox = row.querySelector(".songs-list-item__checkbox");
        numberEl = row.querySelector(".songs-list-item__number");
        label = row.querySelector(".songs-list-item__label");
        titleSpan = row.querySelector(".songs-list-item__title");
        subtitleSpan = row.querySelector(".songs-list-item__subtitle");
        deleteBtn = row.querySelector(".songs-list-item__delete");
      } else {
        row = document.createElement("div");
        row.className = "songs-list-item";
        row.draggable = true;

        dragHandle = document.createElement("span");
        dragHandle.className = "songs-list-item__drag-handle";
        dragHandle.setAttribute("aria-hidden", "true");
        dragHandle.title = "Drag to schedule or folder";
        dragHandle.textContent = "⠿";

        checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "songs-list-item__checkbox";

        numberEl = document.createElement("span");
        numberEl.className = "songs-list-item__number";

        label = document.createElement("div");
        label.className = "songs-list-item__label";

        titleSpan = document.createElement("span");
        titleSpan.className = "songs-list-item__title";
        label.appendChild(titleSpan);

        deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "songs-list-item__delete";
        deleteBtn.textContent = "✕";

        row.appendChild(dragHandle);
        row.appendChild(checkbox);
        row.appendChild(numberEl);
        row.appendChild(label);
        row.appendChild(deleteBtn);
        list.appendChild(row);
      }

      row.dataset.songId = song.id;
      row.dataset.songTitle = song.title || "";

      row.className = "songs-list-item";
      if (currentWorkspaceSong?.id === song.id) {
        row.classList.add("is-selected");
      }
      if (selectedSongIds.has(song.id)) {
        row.classList.add("is-checked");
      }

      checkbox.checked = selectedSongIds.has(song.id);
      checkbox.setAttribute("aria-label", `Select ${song.title || "song"}`);

      numberEl.textContent = formatSongListNumber(song);

      titleSpan.textContent = formatSongListLabel(song);

      const firstLyric = songListExcerpt(song);
      if (firstLyric) {
        if (!subtitleSpan) {
          subtitleSpan = document.createElement("span");
          subtitleSpan.className = "songs-list-item__subtitle";
          label.appendChild(subtitleSpan);
        }
        subtitleSpan.textContent = firstLyric;
        subtitleSpan.style.display = "";
      } else if (subtitleSpan) {
        subtitleSpan.style.display = "none";
        subtitleSpan.textContent = "";
      }

      label.title = `${formatSongListNumber(song) ? `${formatSongListNumber(song)} ` : ""}${titleSpan.textContent}`;

      deleteBtn.title = `Delete ${song.title}`;
      deleteBtn.setAttribute("aria-label", `Delete ${song.title}`);
    }

    while (list.children.length > numResults) {
      list.removeChild(list.lastChild);
    }

    syncSongsBulkActions();
  } catch (err) {
    console.error("Failed to refresh songs browser:", err);
  }
}

function setCurrentSongFolderFilter(value) {
  currentSongFolderFilter = value;
}

function setCurrentSongRenderState(value) {
  currentSongRenderState = value;
}

function setCurrentWorkspaceSong(value) {
  currentWorkspaceSong = value;
}

export {
  SONG_FOLDER_UNFILED,
  addDeckPage,
  addSlideShapeObject,
  addSlideTextBox,
  applySongEditorTextStyle,
  attachSlideCanvasInteractions,
  bindSlideUndoControlTransactions,
  buildSongLowerThirdMessage,
  buildSongQueueEntryFromDeck,
  bulkDeleteSelectedSongs,
  bulkMoveSelectedSongs,
  bulkScheduleSelectedSongs,
  chooseSlideObjectImage,
  clearLiveSongText,
  clearSongSelection,
  clearSongShowNowPresentation,
  closeSongEditor,
  closeSongFolderPrompt,
  createNewDeck,
  currentDeck,
  currentDeckIsSongDocument,
  currentPage,
  currentResolvedSongPresentation,
  currentSongActiveSection,
  currentSongEditorStyleScope,
  currentSongFolderFilter,
  currentSongPresentationItem,
  currentSongRenderState,
  currentSongSectionId,
  currentWorkspaceSong,
  currentWorkspaceSongDeck,
  deleteCurrentDeck,
  deleteDeckPage,
  deleteSongFromLibrary,
  duplicateCurrentDeck,
  duplicateDeckPage,
  ensureSongFolder,
  handleSongEditorAddSection,
  handleSongEditorCanvasTextInput,
  handleSongEditorDeleteSection,
  handleSongEditorMoveSectionDown,
  handleSongEditorMoveSectionUp,
  handleSongEditorSectionMetaChange,
  handleSongsDatabaseCleared,
  importSongFromDialog,
  initSongEditorContextMenu,
  initSongEditorTextBoxDragAndDrop,
  insertSongInSchedule,
  installSongLowerThirdPreviewScaleObserver,
  loadDeckQueueItemIntoWorkspace,
  loadSongIntoWorkspace,
  loadSongItemIntoWorkspace,
  markSongShowNowPresentation,
  navigateSongSection,
  openSlidesWorkspaceFromButton,
  openSongEditor,
  openSongFolderPrompt,
  openSongsWorkspaceFromButton,
  queueItemMatchesDeck,
  readSongEditorRenderState,
  recordSlideUndoCheckpoint,
  recordSlideUndoForMutation,
  redoSlideEdit,
  refreshSlidesFolderList,
  refreshSlidesList,
  refreshSongFolders,
  refreshSongsBrowser,
  renameCurrentDeck,
  renderDeckPageStrip,
  renderSlideCanvas,
  renderSlideEditorState,
  renderSongLowerThirdControls,
  renderSongSectionPreview,
  renderSongSlideNavigator,
  renderStateForLibrarySong,
  resetCurrentSongToThemeDefault,
  restoreLiveSongText,
  saveCurrentDeck,
  saveSongEditor,
  saveSongToSchedule,
  scheduleCurrentDeck,
  scheduleSongPreviewRerender,
  selectDeckPage,
  selectSongSection,
  sendSongLowerThirdForLiveItem,
  sendSongTextToOutput,
  setCurrentSongFolderFilter,
  setCurrentSongRenderState,
  setCurrentWorkspaceSong,
  setDeckDirty,
  setSongLowerThirdCue,
  showCuedSongLowerThird,
  showCurrentDeckNow,
  showSongTextNow,
  songDeckDocumentFromSongDocument,
  songItemForAudienceResolution,
  songSectionsFromParsedSections,
  syncActiveScheduledSongPresentation,
  syncCurrentWorkspaceSongDefaultRender,
  syncSlidesWorkspaceTitle,
  syncSongBackgroundLabel,
  syncSongEditorWorkspaceStyles,
  syncSongLowerThirdForSection,
  syncSongSlideNavigator,
  syncSongsMoveFolderSelect,
  undoSlideEdit,
  updateCurrentSlideTransitionFromControls,
  updateScheduleSongsWithUpdatedSong,
};
/*
 * Songs and slide-deck workspace implementation.
 *
 * This module intentionally keeps the two editors together: songs are edited
 * as slide decks and both features share the same rendering and navigation
 * state. The renderer entry point owns cross-feature presentation state.
 */

import {
  DEFAULT_CANVAS,
  DEFAULT_DECK_THEME,
  DEFAULT_SONG_RENDER,
  DEFAULT_TEXT_FRAME,
  SCRIPTURE_BODY_FONT_SIZE,
  SCRIPTURE_FONT_FAMILY,
  SCRIPTURE_FONT_WEIGHT,
  SCRIPTURE_LINE_HEIGHT,
  SCRIPTURE_LOOK_LOWER_THIRD,
  SCRIPTURE_LOWER_THIRD_BAR_BACKGROUND,
  SCRIPTURE_LOWER_THIRD_CHROMA_KEY_COLOR,
  SCRIPTURE_LOWER_THIRD_DEFAULT_FONT_SIZE,
  SCRIPTURE_LOWER_THIRD_TEXT_COLOR,
  SCRIPTURE_MIN_BODY_FONT_SIZE,
  SONG_DECK_DOCUMENT_TYPE,
  SONG_DRAG_MIME,
  __dirname,
  activeLowerThirdContentType,
  activeMediaWindowContentType,
  appliedPresentationTheme,
  applyOperatorSelectionContrast,
  applyScriptureRenderToPreview,
  arrangementSequenceEntries,
  bibleDesignerState,
  bibleLowerThirdLiveCueKey,
  bibleLowerThirdOutputActive,
  blocksToText,
  clampLowerThirdSegmentIndex,
  clearSongDragVisualState,
  clearTextFromPresentationMessage,
  clearTextObjectInlineStyles,
  createBlankDeck,
  createBlankPage,
  createImageObject,
  createMediaWindow,
  createShapeObject,
  createTextObject,
  currentLiveQueueItem,
  currentQueueIndex,
  deckDefaultRender,
  deckQueuePath,
  deckToTransientSong,
  enabledSongSections,
  enrichLowerThirdPresentationMessage,
  escapeHtml,
  findPage,
  getElementContentSize,
  getPagePrimaryText,
  getPathForFile,
  hasAudienceOutputSelected,
  hasLiveAudienceTextPresentation,
  hasLowerThirdOutputSelected,
  img,
  insertQueueEntriesAfterSelection,
  installLowerThirdPreviewScaleObserver,
  invalidateQueueUndoToastAfterMutation,
  invoke,
  isActiveMediaWindow,
  isActiveMediaWindowCache,
  isBibleLowerThirdFeatureEnabled,
  isCurrentPreviewLoad,
  isPlaying,
  isQueueItemDeck,
  isQueueItemSong,
  isQueueItemTransitionCapable,
  isQueuePlaying,
  isSlideDeckDocument,
  isSlidesWorkspaceVisible,
  isSongsWorkspaceVisible,
  itemThemeForRole,
  lastAudienceSongTextMessage,
  liveThemeFields,
  lowerThirdKeyOnlyMessage,
  lowerThirdOutputUpdateToken,
  lowerThirdPreferenceChromaKeyColor,
  markSongAudiencePreviewSelection,
  mediaPlaybackEndedPending,
  mediaQueue,
  mergeSongRenderState,
  nextLowerThirdOutputUpdateToken,
  normalizeItemSlideTransitionOverride,
  normalizeItemTheme,
  normalizeScriptureFontSize,
  normalizeScriptureMinFontSize,
  normalizeSlideDeck,
  normalizeToSongAST,
  normalizedCueMatchText,
  pageRenderOverrides,
  parseDeckQueuePath,
  parseSongQueuePath,
  pathToMediaUrl,
  pendingQueueSwitchIndex,
  pendingQueueSwitchStartTime,
  queueBasename,
  queueEntryFromSong,
  queueIndexInRange,
  queueItemCueStartTime,
  queueItemSupportsCueStartTime,
  readSlideTransitionControls,
  reconcileSongPlayOrder,
  recoverOutputHoldsToDeckPage,
  recoverOutputHoldsToSongSection,
  renderLowerThirdPreview,
  renderQueue,
  resolveThemeForTarget,
  resolvedSongPresentation,
  resolvedThemeForItem,
  saveMediaFile,
  selectedBiblePreviewOutputSize,
  selectedDisplayValueFromSelect,
  sendAudienceTextMessage,
  sendBibleLowerThirdTextMessage,
  setItemThemeRole,
  setSharedRendererState,
  showGnomeToast,
  showSlidesWorkspace,
  showSongsWorkspace,
  slideTransitionPayloadForQueueItem,
  slidesAPI,
  songAstToDeck,
  songBlockText,
  songDefaultRenderFromRender,
  songDragSongId,
  songLowerThirdState,
  songQueuePath,
  songRenderFromItem,
  songRenderStateFromDefaultRender,
  songSectionBlockTexts,
  songSectionLyricsText,
  songShowNowModeActive,
  songShowNowSourceId,
  songsAPI,
  syncSlideTransitionControls,
  textToSegmentsBlocks,
  themeLowerThirdMessageIfApplied,
  updateDynUI,
  userStopPresentationPending,
  waitForTextFonts,
} from "./app-renderer.mjs";
