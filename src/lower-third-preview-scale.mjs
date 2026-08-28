"use strict";

/** Scale a fixed-size output canvas into a resizable operator preview. */
export function applyLowerThirdPreviewScale(surface, outputSize, options = {}) {
  if (!surface || !outputSize) return;
  const width = Math.max(1, Math.round(outputSize.width));
  const height = Math.max(1, Math.round(outputSize.height));
  surface.style.setProperty("--bible-preview-output-width", `${width}px`);
  surface.style.setProperty("--bible-preview-output-height", `${height}px`);
  const rect = surface.getBoundingClientRect();
  const widthFit = options.fit === "width";
  const scale = rect.width > 0 && rect.height > 0
    ? widthFit
      ? rect.width / width
      : Math.min(rect.width / width, rect.height / height)
    : 1;
  const safeScale = Math.max(0.01, scale);
  const offsetX = Math.max(0, (rect.width - width * safeScale) / 2);
  const offsetY = options.align === "bottom"
    ? rect.height - height * safeScale
    : Math.max(0, (rect.height - height * safeScale) / 2);
  surface.style.setProperty("--bible-preview-output-scale", `${safeScale}`);
  surface.style.setProperty("--bible-preview-scaled-width", `${width * safeScale}px`);
  surface.style.setProperty("--bible-preview-scaled-height", `${height * safeScale}px`);
  surface.style.setProperty(
    "--bible-preview-scripture-gap",
    `${Math.max(1, Math.round(24 * safeScale))}px`,
  );
  surface.style.setProperty("--bible-preview-output-offset-x", `${offsetX}px`);
  surface.style.setProperty("--bible-preview-output-offset-y", `${offsetY}px`);
}

/** Install one resize observer on a preview surface, with a window fallback. */
export function installLowerThirdPreviewScaleObserver(surface, onResize, propertyName) {
  if (!surface || typeof onResize !== "function") return null;
  const key = propertyName || "_lowerThirdPreviewScaleObserver";
  if (surface[key]) return surface[key];
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => onResize());
    observer.observe(surface);
    surface[key] = observer;
    return observer;
  }
  window.addEventListener("resize", onResize);
  surface[key] = { disconnect: () => window.removeEventListener("resize", onResize) };
  return surface[key];
}
