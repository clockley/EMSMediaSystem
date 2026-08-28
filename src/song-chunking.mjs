import { fitTextLayoutSync, themeTextSafeMargins } from "./text-measure.mjs";

export const SONG_CHUNKING_ALGORITHM_VERSION = 1;

export function songBlockText(block) {
  if (!block || typeof block !== "object") return "";
  if (block.type === "spacer") return "";
  const segments = Array.isArray(block.primary?.segments) ? block.primary.segments : [];
  if (segments.length > 0) return segments.map((segment) => segment?.text || "").join("");
  return typeof block.primary?.text === "string" ? block.primary.text : "";
}

export function songChunkBodyText(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .map(songBlockText)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function visualBlockCount(blocks) {
  return Math.max(
    1,
    (Array.isArray(blocks) ? blocks : []).filter((block) => block?.type !== "spacer").length,
  );
}

function normalizeChunking(song, section, options = {}) {
  if (song?.presentation?.explicitPageBoundaries === true && !options.chunking) {
    return {
      mode: "blocksPerSlide",
      maxLines: Number.MAX_SAFE_INTEGER,
      maxBlocks: Number.MAX_SAFE_INTEGER,
      avoidOrphans: false,
      spacerBreaks: false,
    };
  }
  const configured =
    options.chunking ||
    section?.presentation?.chunking ||
    song?.presentation?.defaultChunking ||
    {};
  const mode =
    configured.mode === "linesPerSlide" ||
    configured.mode === "blocksPerSlide" ||
    configured.mode === "autoFit"
      ? configured.mode
      : "autoFit";
  return {
    mode,
    maxLines: Math.max(1, Math.round(Number(configured.maxLines) || 4)),
    maxBlocks: Math.max(1, Math.round(Number(configured.maxBlocks) || 4)),
    avoidOrphans: configured.avoidOrphans !== false,
    spacerBreaks: configured.spacerBreaks !== false,
  };
}

function manualBreakIds(song, section, options = {}) {
  if (song?.presentation?.explicitPageBoundaries === true && !options.chunking) {
    return new Set();
  }
  const source = [
    ...(Array.isArray(song?.presentation?.manualBreaks) ? song.presentation.manualBreaks : []),
    ...(Array.isArray(section?.manualBreaks) ? section.manualBreaks : []),
    ...(Array.isArray(options.manualBreaks) ? options.manualBreaks : []),
  ];
  return new Set(
    source
      .filter((entry) => {
        if (typeof entry === "string") return true;
        if (!entry || typeof entry !== "object") return false;
        return !entry.sectionId || entry.sectionId === section?.id;
      })
      .map((entry) =>
        typeof entry === "string"
          ? entry
          : entry.afterBlockId || entry.blockId || entry.after || "",
      )
      .filter(Boolean),
  );
}

function hardGroups(blocks, manualIds, spacerBreaks) {
  const groups = [];
  let current = [];
  let endedByManualBreak = false;
  const push = () => {
    while (current[0]?.type === "spacer") current.shift();
    while (current[current.length - 1]?.type === "spacer") current.pop();
    if (current.length > 0) groups.push({ blocks: current, endedByManualBreak });
    current = [];
    endedByManualBreak = false;
  };
  for (const block of blocks) {
    if (block?.manualBreakBefore === true && current.length > 0) {
      endedByManualBreak = true;
      push();
    }
    if (block?.type === "manualBreak") {
      endedByManualBreak = true;
      push();
      continue;
    }
    current.push(block);
    if (manualIds.has(block?.id) || block?.manualBreakAfter === true) {
      endedByManualBreak = true;
      push();
    } else if (spacerBreaks && block?.type === "spacer") {
      push();
    }
  }
  push();
  return groups;
}

function defaultMeasure(bodyText, blocks, options) {
  const typography = options.typography || options.resolvedTheme?.textContainer?.typography || {};
  return fitTextLayoutSync({
    text: bodyText,
    outputSize: options.outputSize,
    safeMargins:
      options.safeMargins ||
      themeTextSafeMargins(
        options.resolvedTheme,
        options.outputSize || options.target?.outputSize,
      ),
    style: {
      fontFamily: typography.fontFamily || options.fontFamily,
      fontWeight: typography.fontWeight || options.fontWeight,
      fontSize: typography.fontSize || options.fontSize,
      minFontSize: typography.minFontSize || options.minFontSize,
      lineHeight: typography.lineHeight || options.lineHeight,
      autosizeMode: typography.autosizeMode || options.autosizeMode || "fit",
      direction: typography.direction || options.direction,
    },
    measureAt: options.measureAt,
    extraHeight: options.extraHeight,
  });
}

function measureBlocks(blocks, options) {
  const bodyText = songChunkBodyText(blocks);
  const maxLines = Number(options.typography?.maxLines || options.maxLines || 0);
  const result =
    typeof options.measure === "function"
      ? options.measure(bodyText, {
          blocks,
          outputSize: options.outputSize,
          typography: options.typography,
          resolvedTheme: options.resolvedTheme,
        })
      : defaultMeasure(bodyText, blocks, options);
  return {
    bodyText,
    layout: result && typeof result === "object"
      ? {
          ...result,
          fits:
            result.fits !== false &&
            result.overflow !== true &&
            !(maxLines > 0 && result.lineCount > maxLines),
          overflow:
            result.overflow === true ||
            result.fits === false ||
            (maxLines > 0 && result.lineCount > maxLines),
          measurementMode:
            result.measurementMode ||
            options.measurementMode ||
            (options.measureAt ? "injected" : options.measure ? "custom" : "heuristic"),
        }
      : { fits: true, overflow: false, lineCount: visualBlockCount(blocks) },
  };
}

function chunkFixed(group, limit) {
  const chunks = [];
  for (let index = 0; index < group.length; index += limit) {
    chunks.push(group.slice(index, index + limit));
  }
  return chunks;
}

function chunkAutoFit(group, options) {
  const chunks = [];
  let current = [];
  for (const block of group) {
    const candidate = [...current, block];
    if (current.length > 0 && measureBlocks(candidate, options).layout.overflow) {
      chunks.push(current);
      current = [block];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function avoidFinalOrphan(chunks, options, revalidate = false) {
  if (chunks.length < 2) return chunks;
  const last = chunks[chunks.length - 1];
  const previous = chunks[chunks.length - 2];
  if (
    visualBlockCount(last) === 1 &&
    visualBlockCount(previous) > 2 &&
    previous.length > 1
  ) {
    const moved = previous[previous.length - 1];
    const nextPrevious = previous.slice(0, -1);
    const nextLast = [moved, ...last];
    if (
      !revalidate ||
      (
        !measureBlocks(nextPrevious, options).layout.overflow &&
        !measureBlocks(nextLast, options).layout.overflow
      )
    ) {
      previous.pop();
      last.unshift(moved);
    }
  }
  return chunks;
}

export function chunkSongSection(song, section, options = {}) {
  const blocks = Array.isArray(section?.blocks) ? section.blocks.filter(Boolean) : [];
  if (blocks.length === 0) return [];
  const chunking = normalizeChunking(song, section, options);
  const groups = hardGroups(
    blocks,
    manualBreakIds(song, section, options),
    chunking.spacerBreaks,
  );
  const results = [];
  let sourceBlockOffset = 0;

  groups.forEach((group) => {
    let chunks;
    if (chunking.mode === "linesPerSlide") {
      chunks = chunkFixed(group.blocks, chunking.maxLines);
    } else if (chunking.mode === "blocksPerSlide") {
      chunks = chunkFixed(group.blocks, chunking.maxBlocks);
    } else {
      chunks = chunkAutoFit(group.blocks, options);
    }
    if (chunking.avoidOrphans) {
      chunks = avoidFinalOrphan(chunks, options, chunking.mode === "autoFit");
    }
    chunks.forEach((chunkBlocks, groupChunkIndex) => {
      const measured = measureBlocks(chunkBlocks, options);
      results.push({
        blocks: chunkBlocks,
        bodyText: measured.bodyText,
        layout: measured.layout,
        sourceBlockStart: sourceBlockOffset,
        sourceBlockEnd: sourceBlockOffset + chunkBlocks.length - 1,
        manualBreak:
          group.endedByManualBreak && groupChunkIndex === chunks.length - 1,
      });
      sourceBlockOffset += chunkBlocks.length;
    });
  });

  return results;
}
