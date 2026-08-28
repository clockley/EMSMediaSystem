import {
  createResolvedPresentation,
  resolvedLayoutKey,
  stableValueHash,
} from "./resolved-presentation.mjs";
import {
  domTextMeasurement,
  fitTextLayoutSync,
  themeTextSafeMargins,
  waitForTextFonts,
} from "./text-measure.mjs";

export const SCRIPTURE_SLIDE_RESOLVER_VERSION = 2;
const scriptureCache = new Map();

function cleanText(value) {
  return String(value || "").replace(/[ \t]+/g, " ").trim();
}

function selectedVerseNumbers(entry) {
  if (Array.isArray(entry?.selectedVerses) && entry.selectedVerses.length > 0) {
    return entry.selectedVerses
      .map((value) => Math.trunc(Number(value)))
      .filter((value) => value > 0);
  }
  const start = Math.trunc(Number(entry?.verse));
  const end = Math.trunc(Number(entry?.verseEnd)) || start;
  if (start <= 0) return [];
  const result = [];
  for (let verse = start; verse <= Math.max(start, end); verse += 1) result.push(verse);
  return result;
}

export function scriptureVerseRows(entry = {}) {
  if (Array.isArray(entry.verseRows) && entry.verseRows.length > 0) {
    return entry.verseRows
      .map((row, index) => ({
        verseNumber: Math.trunc(Number(row?.verseNumber ?? row?.verse ?? index + 1)),
        text: cleanText(row?.text),
      }))
      .filter((row) => row.verseNumber > 0 && row.text);
  }
  const lines = String(entry.text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = lines
    .map((line) => {
      const match = line.match(/^(\d+)[.)]?\s+(.+)$/u);
      return match
        ? { verseNumber: Number.parseInt(match[1], 10), text: cleanText(match[2]) }
        : null;
    })
    .filter(Boolean);
  if (parsed.length === lines.length && parsed.length > 0) return parsed;
  const selected = selectedVerseNumbers(entry);
  if (selected.length === lines.length && selected.length > 0) {
    return lines.map((text, index) => ({ verseNumber: selected[index], text: cleanText(text) }));
  }
  return [{
    verseNumber: selected[0] || Math.max(1, Math.trunc(Number(entry.verse)) || 1),
    text: cleanText(entry.text),
  }].filter((row) => row.text);
}

function verseText(row, includeNumber = true) {
  return includeNumber ? `${row.verseNumber}. ${row.text}` : row.text;
}

function chunkReference(entry, verseNumbers) {
  if (verseNumbers.length === 0) return entry.reference || "";
  const book = String(entry.book || "").trim();
  const chapter = Math.trunc(Number(entry.chapter));
  if (!book || chapter <= 0) return entry.reference || "";
  if (verseNumbers.length === 1) return `${book} ${chapter}:${verseNumbers[0]}`;
  return `${book} ${chapter}:${verseNumbers[0]}-${verseNumbers[verseNumbers.length - 1]}`;
}

function scriptureAttributionText(value) {
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

function typographyFor(entry, options) {
  const themeTypography = options.resolvedTheme?.textContainer?.typography || {};
  return {
    fontFamily: options.typography?.fontFamily || themeTypography.fontFamily || entry.fontFamily,
    fontWeight:
      options.typography?.fontWeight || themeTypography.fontWeight || entry.fontWeight || 700,
    fontSize: Number(
      options.typography?.fontSize || themeTypography.fontSize || entry.fontSize || 66,
    ),
    minFontSize: Number(
      options.typography?.minFontSize ||
        themeTypography.minFontSize ||
        entry.minFontSize ||
        38,
    ),
    lineHeight: Number(
      options.typography?.lineHeight || themeTypography.lineHeight || entry.lineHeight || 1.32,
    ),
    autosizeMode:
      options.typography?.autosizeMode ||
      themeTypography.autosizeMode ||
      entry.autosizeMode ||
      "fit",
    maxLines: Number(
      options.typography?.maxLines ||
        themeTypography.maxLines ||
        entry.maxLines ||
        0,
    ),
    direction: options.typography?.direction || themeTypography.direction || entry.direction,
  };
}

function measureBody(bodyText, entry, options, typography) {
  const result =
    typeof options.measure === "function"
      ? options.measure(bodyText, {
          entry,
          outputSize: options.outputSize || options.target?.outputSize,
          typography,
        })
      : fitTextLayoutSync({
          text: bodyText,
          outputSize: options.outputSize || options.target?.outputSize,
          safeMargins:
            options.safeMargins ||
            themeTextSafeMargins(
              options.resolvedTheme,
              options.outputSize || options.target?.outputSize,
            ),
          extraHeight: options.referenceReserve ?? typography.fontSize * 1.3,
          style: typography,
          measureAt: options.measureAt,
        });
  return {
    ...result,
    fits:
      result?.fits !== false &&
      result?.overflow !== true &&
      !(typography.maxLines > 0 && result?.lineCount > typography.maxLines),
    overflow:
      result?.overflow === true ||
      result?.fits === false ||
      (typography.maxLines > 0 && result?.lineCount > typography.maxLines),
    measurementMode:
      result?.measurementMode ||
      options.measurementMode ||
      (options.measureAt ? "injected" : options.measure ? "custom" : "heuristic"),
  };
}

function segmentWords(text, locale) {
  if (typeof Intl?.Segmenter === "function") {
    return [...new Intl.Segmenter(locale || undefined, { granularity: "word" }).segment(text)]
      .map((entry) => entry.segment)
      .filter((entry) => entry.length > 0);
  }
  return String(text || "").split(/(\s+)/u).filter(Boolean);
}

function segmentGraphemes(text, locale) {
  if (typeof Intl?.Segmenter === "function") {
    return [...new Intl.Segmenter(locale || undefined, { granularity: "grapheme" }).segment(text)]
      .map((entry) => entry.segment);
  }
  return Array.from(String(text || ""));
}

function splitOversizedVerse(row, entry, options, typography, includeVerseNumber = true) {
  const tokens = segmentWords(row.text, entry.language || entry.lang);
  const parts = [];
  let current = "";
  let first = true;
  const bodyTextFor = (text) =>
    first && includeVerseNumber ? `${row.verseNumber}. ${text.trimStart()}` : text.trimStart();
  const overflows = (text) =>
    measureBody(bodyTextFor(text), entry, options, typography).overflow;
  const flush = () => {
    if (!current.trim()) return;
    const bodyText = bodyTextFor(current).trim();
    parts.push({
      bodyText,
      verseNumbers: [row.verseNumber],
      intraVerse: true,
      layout: measureBody(bodyText, entry, options, typography),
    });
    current = "";
    first = false;
  };
  for (const token of tokens) {
    const candidateText = `${current}${token}`;
    if (!overflows(candidateText)) {
      current = candidateText;
      continue;
    }
    if (current) flush();
    const trimmedToken = token.trimStart();
    if (!trimmedToken) continue;
    if (!overflows(trimmedToken)) {
      current = trimmedToken;
      continue;
    }
    for (const grapheme of segmentGraphemes(trimmedToken, entry.language || entry.lang)) {
      const pieceCandidate = `${current}${grapheme}`;
      if (current && overflows(pieceCandidate)) flush();
      current += grapheme;
    }
  }
  if (current.trim()) {
    const wasFirst = first;
    flush();
    if (wasFirst && parts.length === 1) parts[0].intraVerse = false;
  }
  return parts;
}

function normalizeGroupLayout(chunks, entry, options, typography) {
  if (typography.autosizeMode !== "normalize" || chunks.length <= 1) return chunks;
  const groupFontSize = Math.min(
    ...chunks
      .map((chunk) => Number(chunk.layout?.resolvedFontSize))
      .filter(Number.isFinite),
    typography.fontSize,
  );
  const normalizedTypography = {
    ...typography,
    fontSize: groupFontSize,
    minFontSize: groupFontSize,
    autosizeMode: "none",
  };
  return chunks.map((chunk) => ({
    ...chunk,
    layout: {
      ...measureBody(chunk.bodyText, entry, options, normalizedTypography),
      normalized: true,
      normalizedGroupFontSize: groupFontSize,
    },
  }));
}

export function resolveScriptureSlides(entry = {}, options = {}) {
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
  const rows = scriptureVerseRows(entry);
  const target = {
    outputRole: options.outputRole || options.target?.outputRole || "audience",
    outputSize: options.outputSize || options.target?.outputSize,
  };
  const includeVerseNumbers =
    options.includeVerseNumbers ?? target.outputRole !== "audience";
  const typography = typographyFor(entry, options);
  const passageKey =
    options.passageKey ||
    stableValueHash({
      version: entry.version || "",
      book: entry.book || "",
      chapter: entry.chapter || 0,
      selectedVerses: selectedVerseNumbers(entry),
      reference: entry.reference || "",
    });
  const revisionEntry = { ...entry };
  delete revisionEntry.currentSlideId;
  delete revisionEntry.currentLowerThirdSlideId;
  delete revisionEntry.lowerThirdSegmentIndex;
  delete revisionEntry.lowerThirdSegments;
  delete revisionEntry.lowerThirdSourceText;
  const sourceRevision = options.sourceRevision || stableValueHash({
    resolverVersion: SCRIPTURE_SLIDE_RESOLVER_VERSION,
    entry: revisionEntry,
    rows,
  });
  const autoSplit = options.forceAutoSplit === true || entry.autoSplit !== false;
  const layoutKey = resolvedLayoutKey({
    content: { passageKey, sourceRevision, rows },
    target,
    resolvedTheme: options.resolvedTheme,
    typography,
    presentation: {
      autoSplit,
      includeVerseNumbers,
      safeMargins: options.safeMargins || null,
      referenceReserve: options.referenceReserve ?? null,
      measurementMode:
        options.measurementMode ||
        options.measurementKey ||
        (options.measureAt ? "injected" : options.measure ? "custom" : "heuristic"),
      resolverVersion: SCRIPTURE_SLIDE_RESOLVER_VERSION,
    },
  });
  let chunks = options.cache !== false ? scriptureCache.get(layoutKey) : null;
  if (chunks) {
    chunks = structuredClone(chunks);
  } else if (!autoSplit) {
    const bodyText = rows.length > 1
      ? rows.map((row) => verseText(row, includeVerseNumbers)).join("\n")
      : cleanText(entry.text) || rows.map((row) => verseText(row, false)).join("\n");
    chunks = [{
      bodyText,
      verseNumbers: rows.map((row) => row.verseNumber),
      layout: measureBody(bodyText, entry, options, typography),
    }];
  } else {
    chunks = [];
    let currentRows = [];
    for (const row of rows) {
      const candidateRows = [...currentRows, row];
      const candidateBody = candidateRows
        .map((value) => verseText(value, includeVerseNumbers))
        .join("\n");
      if (currentRows.length > 0 && measureBody(candidateBody, entry, options, typography).overflow) {
        const bodyText = currentRows
          .map((value) => verseText(value, includeVerseNumbers))
          .join("\n");
        chunks.push({
          bodyText,
          verseNumbers: currentRows.map((value) => value.verseNumber),
          layout: measureBody(bodyText, entry, options, typography),
        });
        currentRows = [row];
      } else {
        currentRows = candidateRows;
      }
    }
    if (currentRows.length > 0) {
      const bodyText = currentRows
        .map((value) => verseText(value, includeVerseNumbers))
        .join("\n");
      chunks.push({
        bodyText,
        verseNumbers: currentRows.map((value) => value.verseNumber),
        layout: measureBody(bodyText, entry, options, typography),
      });
    }
    chunks = chunks.flatMap((chunk) => {
      if (!chunk.layout.overflow || chunk.verseNumbers.length !== 1) return [chunk];
      const row = rows.find((value) => value.verseNumber === chunk.verseNumbers[0]);
      return row
        ? splitOversizedVerse(row, entry, options, typography, includeVerseNumbers)
        : [chunk];
    });
    chunks = normalizeGroupLayout(chunks, entry, options, typography);
    if (options.cache !== false) scriptureCache.set(layoutKey, structuredClone(chunks));
  }

  const slides = chunks.map((chunk, chunkIndex) => ({
    slideId: `${passageKey}:${chunkIndex}`,
    passageKey,
    chunkIndex,
    bodyText: chunk.bodyText,
    fullBodyText: cleanText(entry.text),
    referenceText: `${chunkReference(entry, chunk.verseNumbers)} ${entry.version || ""}`.trim(),
    attributionText: scriptureAttributionText(entry.attribution),
    verseNumbers: chunk.verseNumbers,
    intraVerse: chunk.intraVerse === true,
    layout: chunk.layout,
  }));
  return createResolvedPresentation({
    contentKind: "scripture",
    source: { id: passageKey, revision: sourceRevision },
    slides,
    target,
    resolvedTheme: options.resolvedTheme,
    layoutKey,
    activeSlideId: options.activeSlideId || entry.currentSlideId,
    warnings: slides.some((slide) => slide.layout?.overflow)
      ? ["One or more Scripture slides overflow at minimum font size"]
      : [],
  });
}

export async function resolveScriptureSlidesAfterFonts(entry = {}, options = {}) {
  const typography = typographyFor(entry, options);
  await waitForTextFonts([typography.fontFamily], {
    documentRef: options.documentRef || globalThis.document,
    sample: entry.text || "EMS",
    fontSize: typography.fontSize,
  });
  return resolveScriptureSlides(entry, {
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

export function clearResolvedScriptureCache() {
  scriptureCache.clear();
}
