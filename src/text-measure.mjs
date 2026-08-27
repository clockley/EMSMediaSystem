import {
  normalizeResolvedOutputSize,
  stableValueHash,
} from "./resolved-presentation.mjs";

export const TEXT_MEASURE_ALGORITHM_VERSION = 1;
export const DEFAULT_TEXT_SAFE_MARGINS = Object.freeze({
  top: 0.08,
  right: 0.08,
  bottom: 0.08,
  left: 0.08,
});

function marginPixels(value, axisSize, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return Math.round(axisSize * fallback);
  return Math.round(number <= 1 ? number * axisSize : number);
}

export function resolvedTextBounds(outputSize, safeMargins = DEFAULT_TEXT_SAFE_MARGINS) {
  const size = normalizeResolvedOutputSize(outputSize);
  const source = safeMargins && typeof safeMargins === "object" ? safeMargins : {};
  const left = marginPixels(source.left ?? source.x, size.width, DEFAULT_TEXT_SAFE_MARGINS.left);
  const right = marginPixels(
    source.right ?? source.x,
    size.width,
    DEFAULT_TEXT_SAFE_MARGINS.right,
  );
  const top = marginPixels(source.top ?? source.y, size.height, DEFAULT_TEXT_SAFE_MARGINS.top);
  const bottom = marginPixels(
    source.bottom ?? source.y,
    size.height,
    DEFAULT_TEXT_SAFE_MARGINS.bottom,
  );
  return {
    width: Math.max(1, size.width - left - right),
    height: Math.max(1, size.height - top - bottom),
    left,
    top,
    right,
    bottom,
  };
}

export function themeTextSafeMargins(resolvedTheme = {}, outputSize = null) {
  const base =
    resolvedTheme?.safeMargins ||
    resolvedTheme?.canvas?.safeMargins ||
    resolvedTheme?.textContainer?.safeMargins ||
    resolvedTheme?.textContainer?.padding ||
    DEFAULT_TEXT_SAFE_MARGINS;
  const frame = resolvedTheme?.textFrame;
  const backdrop = resolvedTheme?.backdrop;
  const hasBackdropPadding = backdrop?.enabled === true && backdrop?.paddingPx;
  if ((!frame || typeof frame !== "object") && !hasBackdropPadding) return base;
  const size = normalizeResolvedOutputSize(outputSize);
  const basePixels = {
    top: marginPixels(base.top ?? base.y, size.height, DEFAULT_TEXT_SAFE_MARGINS.top),
    right: marginPixels(base.right ?? base.x, size.width, DEFAULT_TEXT_SAFE_MARGINS.right),
    bottom: marginPixels(base.bottom ?? base.y, size.height, DEFAULT_TEXT_SAFE_MARGINS.bottom),
    left: marginPixels(base.left ?? base.x, size.width, DEFAULT_TEXT_SAFE_MARGINS.left),
  };
  const x = Number(frame?.x);
  const y = Number(frame?.y);
  const width = Number(frame?.width);
  const height = Number(frame?.height);
  const hasFrame = [x, y, width, height].every(Number.isFinite);
  const paddingX = hasBackdropPadding ? Math.max(0, Number(backdrop.paddingPx.x) || 0) : 0;
  const paddingY = hasBackdropPadding ? Math.max(0, Number(backdrop.paddingPx.y) || 0) : 0;
  return {
    top: Math.max(basePixels.top, hasFrame ? y * size.height : 0) + paddingY,
    right:
      Math.max(basePixels.right, hasFrame ? Math.max(0, 1 - x - width) * size.width : 0) +
      paddingX,
    bottom:
      Math.max(basePixels.bottom, hasFrame ? Math.max(0, 1 - y - height) * size.height : 0) +
      paddingY,
    left: Math.max(basePixels.left, hasFrame ? x * size.width : 0) + paddingX,
  };
}

export async function waitForTextFonts(
  fontFamilies,
  { documentRef = globalThis.document, sample = "EMS Aa 0123", fontSize = 66 } = {},
) {
  const fonts = documentRef?.fonts;
  if (!fonts) return;
  const families = [...new Set((Array.isArray(fontFamilies) ? fontFamilies : [fontFamilies])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
  await Promise.all(
    families.map((family) =>
      fonts.load(`${Math.max(1, Number(fontSize) || 66)}px ${family}`, sample),
    ),
  );
  await fonts.ready;
}

function normalizedTextStyle(style = {}) {
  const preferredFontSize = Math.max(1, Math.round(Number(style.fontSize) || 66));
  const minFontSize = Math.max(
    1,
    Math.min(preferredFontSize, Math.round(Number(style.minFontSize) || preferredFontSize)),
  );
  return {
    fontFamily: style.fontFamily || "sans-serif",
    fontWeight: style.fontWeight || 700,
    fontStyle: style.fontStyle || "normal",
    letterSpacing: Number.isFinite(Number(style.letterSpacing))
      ? Number(style.letterSpacing)
      : 0,
    lineHeight: Number.isFinite(Number(style.lineHeight)) && Number(style.lineHeight) > 0
      ? Number(style.lineHeight)
      : 1.25,
    textAlign: style.textAlign || style.align || "center",
    direction: style.direction || "auto",
    preferredFontSize,
    minFontSize,
    mode: style.mode || style.autosizeMode || "fit",
  };
}

export function layoutMeasurementKey({ text, outputSize, safeMargins, style } = {}) {
  return stableValueHash({
    version: TEXT_MEASURE_ALGORITHM_VERSION,
    text: String(text || ""),
    outputSize: normalizeResolvedOutputSize(outputSize),
    safeMargins,
    style: normalizedTextStyle(style),
  });
}

export function boxFitsMeasurement(measurement, bounds) {
  const width = Number(measurement?.width);
  const height = Number(measurement?.height);
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width <= Math.ceil(bounds.width) + 1 &&
    height <= Math.ceil(bounds.height) + 1
  );
}

export function findLargestFittingFontSize({
  minFontSize,
  maxFontSize,
  measureAt,
  fits = boxFitsMeasurement,
  bounds,
}) {
  const min = Math.max(1, Math.round(Number(minFontSize) || 1));
  const max = Math.max(min, Math.round(Number(maxFontSize) || min));
  let low = min;
  let high = max;
  let bestSize = min;
  let bestMeasurement = measureAt(min);
  while (low <= high) {
    const candidate = Math.floor((low + high) / 2);
    const measurement = measureAt(candidate);
    if (fits(measurement, bounds)) {
      bestSize = candidate;
      bestMeasurement = measurement;
      low = candidate + 1;
    } else {
      high = candidate - 1;
      if (candidate === min) bestMeasurement = measurement;
    }
  }
  return { fontSize: bestSize, measurement: bestMeasurement };
}

export function fitTextLayoutSync({
  text,
  outputSize,
  safeMargins,
  style,
  measureAt,
  extraHeight = 0,
} = {}) {
  const resolvedStyle = normalizedTextStyle(style);
  const outerBounds = resolvedTextBounds(outputSize, safeMargins);
  const bounds = {
    ...outerBounds,
    height: Math.max(1, outerBounds.height - Math.max(0, Number(extraHeight) || 0)),
  };
  const measure =
    typeof measureAt === "function"
      ? (fontSize) => measureAt(String(text || ""), fontSize, bounds, resolvedStyle)
      : (fontSize) => heuristicTextMeasurement(String(text || ""), fontSize, bounds, resolvedStyle);
  let fontSize = resolvedStyle.preferredFontSize;
  let measurement = measure(fontSize);
  if (resolvedStyle.mode !== "none" && !boxFitsMeasurement(measurement, bounds)) {
    const fitted = findLargestFittingFontSize({
      minFontSize: resolvedStyle.minFontSize,
      maxFontSize: resolvedStyle.preferredFontSize,
      measureAt: measure,
      bounds,
    });
    fontSize = fitted.fontSize;
    measurement = fitted.measurement;
  }
  const fits = boxFitsMeasurement(measurement, bounds);
  return {
    mode: resolvedStyle.mode,
    preferredFontSize: resolvedStyle.preferredFontSize,
    minFontSize: resolvedStyle.minFontSize,
    resolvedFontSize: fontSize,
    lineCount: Math.max(0, Math.round(Number(measurement?.lineCount) || 0)),
    width: Number(measurement?.width) || 0,
    height: Number(measurement?.height) || 0,
    bounds,
    fits,
    overflow: !fits,
    splitNeeded: resolvedStyle.mode !== "none" && !fits && fontSize <= resolvedStyle.minFontSize,
    measurementKey: layoutMeasurementKey({ text, outputSize, safeMargins, style: resolvedStyle }),
  };
}

export function heuristicTextMeasurement(text, fontSize, bounds, style = {}) {
  const normalized = String(text || "");
  const lineHeightPx = fontSize * (Number(style.lineHeight) || 1.25);
  const averageGlyphWidth = fontSize * 0.56 + (Number(style.letterSpacing) || 0);
  const charsPerLine = Math.max(1, Math.floor(bounds.width / Math.max(1, averageGlyphWidth)));
  let lines = 0;
  let widest = 0;
  for (const explicitLine of normalized.split(/\r?\n/)) {
    const units = Array.from(explicitLine);
    const wrapped = Math.max(1, Math.ceil(units.length / charsPerLine));
    lines += wrapped;
    widest = Math.max(widest, Math.min(units.length, charsPerLine) * averageGlyphWidth);
  }
  return {
    width: Math.ceil(widest),
    height: Math.ceil(lines * lineHeightPx),
    lineCount: lines,
  };
}

function ensureMeasureRoot(documentRef) {
  let root = documentRef.getElementById("emsSharedTextMeasure");
  if (!root) {
    root = documentRef.createElement("div");
    root.id = "emsSharedTextMeasure";
    root.setAttribute("aria-hidden", "true");
    Object.assign(root.style, {
      position: "fixed",
      left: "-100000px",
      top: "0",
      visibility: "hidden",
      pointerEvents: "none",
      whiteSpace: "pre-wrap",
      overflowWrap: "normal",
      wordBreak: "normal",
      boxSizing: "border-box",
      padding: "0",
      margin: "0",
      maxWidth: "none",
      maxHeight: "none",
    });
    documentRef.body.appendChild(root);
  }
  return root;
}

export function domTextMeasurement(
  text,
  fontSize,
  bounds,
  style = {},
  { documentRef = globalThis.document } = {},
) {
  if (!documentRef?.body) return heuristicTextMeasurement(text, fontSize, bounds, style);
  const root = ensureMeasureRoot(documentRef);
  root.style.width = `${Math.max(1, bounds.width)}px`;
  root.style.height = "auto";
  root.style.fontFamily = style.fontFamily || "sans-serif";
  root.style.fontSize = `${fontSize}px`;
  root.style.fontWeight = String(style.fontWeight || 700);
  root.style.fontStyle = style.fontStyle || "normal";
  root.style.letterSpacing = `${Number(style.letterSpacing) || 0}px`;
  root.style.lineHeight = String(style.lineHeight || 1.25);
  root.style.textAlign = style.textAlign || "center";
  root.style.direction = style.direction || "auto";
  root.textContent = String(text || " ");
  const rect = root.getBoundingClientRect();
  const computed = documentRef.defaultView?.getComputedStyle(root);
  const lineHeight = Number.parseFloat(computed?.lineHeight) || fontSize * (style.lineHeight || 1.25);
  return {
    width: Math.ceil(Math.max(root.scrollWidth, rect.width)),
    height: Math.ceil(Math.max(root.scrollHeight, rect.height)),
    lineCount: Math.max(1, Math.round(root.scrollHeight / Math.max(1, lineHeight))),
  };
}

export async function measureTextLayout(options = {}) {
  const style = normalizedTextStyle(options.style);
  await waitForTextFonts([style.fontFamily], {
    documentRef: options.documentRef,
    sample: String(options.text || "EMS"),
    fontSize: style.preferredFontSize,
  });
  return fitTextLayoutSync({
    ...options,
    style,
    measureAt: (text, fontSize, bounds, resolvedStyle) =>
      domTextMeasurement(text, fontSize, bounds, resolvedStyle, {
        documentRef: options.documentRef,
      }),
  });
}
