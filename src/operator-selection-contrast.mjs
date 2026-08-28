function parseCssColor(value) {
  const source = String(value || "").trim();
  const match = source.match(/^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i);
  if (!match) {
    const rgbMatch = source.match(
      /^rgba?\(\s*([\d.]+)%?\s*[, ]\s*([\d.]+)%?\s*[, ]\s*([\d.]+)%?(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i,
    );
    if (!rgbMatch) return null;
    const percentage = source.slice(0, source.lastIndexOf(")")).includes("%");
    return rgbMatch.slice(1, 4).map((part) => {
      const channel = Number(part) * (percentage ? 2.55 : 1);
      return Math.max(0, Math.min(255, Math.round(channel)));
    });
  }
  const colorHex = match[1];
  const hex = colorHex.length <= 4
    ? [...colorHex.slice(0, 3)].map((part) => `${part}${part}`).join("")
    : colorHex.slice(0, 6);
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function relativeLuminance(rgb) {
  if (!rgb) return 0;
  const channels = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first, second) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Choose a compact operator-only cue treatment that remains readable without
 * drawing boxes around every wrapped line of Scripture.
 */
export function operatorSelectionContrast({
  backgroundColor,
  textColor,
  hasVariableBackground = false,
} = {}) {
  const background = parseCssColor(backgroundColor) || [0, 0, 0];
  const text = parseCssColor(textColor);
  const black = [8, 8, 8];
  const white = [255, 255, 255];
  const backgroundIsDark = relativeLuminance(background) < 0.42;
  let color;

  if (hasVariableBackground) {
    // Images and video can change underneath the text. A warm highlight with
    // a dark halo is recognizable over both light and dark frames.
    color = text && relativeLuminance(text) < 0.42 ? "#ffffff" : "#ffe36e";
  } else {
    const ideal = contrastRatio(background, white) >= contrastRatio(background, black)
      ? { css: "#ffffff", rgb: white }
      : { css: "#080808", rgb: black };
    const tooSimilarToBody = text && contrastRatio(text, ideal.rgb) < 1.8;
    color = tooSimilarToBody
      ? backgroundIsDark ? "#ffe36e" : "#004fc4"
      : ideal.css;
  }

  const colorRgb = parseCssColor(color);
  const shadow = relativeLuminance(colorRgb) > 0.42
    ? "rgba(0, 0, 0, 0.96)"
    : "rgba(255, 255, 255, 0.96)";
  return {
    color,
    shadow,
    strokeWidth: hasVariableBackground ? "0.055em" : "0.032em",
  };
}

/** Apply the shared operator cue palette to a Bible or Song preview root. */
export function applyOperatorSelectionContrast(element, message = {}) {
  if (!element?.style?.setProperty) return null;
  const selection = operatorSelectionContrast({
    backgroundColor: message.backgroundColor,
    textColor: message.color,
    hasVariableBackground: Boolean(
      message.backgroundImage || message.backgroundVideo || message.backgroundPath,
    ),
  });
  element.style.setProperty("--operator-selection-color", selection.color);
  element.style.setProperty("--operator-selection-shadow", selection.shadow);
  element.style.setProperty("--operator-selection-stroke-width", selection.strokeWidth);
  return selection;
}
