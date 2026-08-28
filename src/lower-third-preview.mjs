"use strict";

export function lowerThirdPreviewMarkup(options = {}) {
  const prefix = String(options.prefix || "lowerThird");
  const shellClasses = [
    "lower-third-preview",
    "bible-preview-surface",
    "bible-preview-surface--lower-third",
    options.shellClass || "",
  ].filter(Boolean).join(" ");
  const renderClasses = [
    "lower-third-preview__render",
    "bible-preview-copy",
    "scripture-render",
    "scripture-render--lower-third",
    options.renderClass || "",
  ].filter(Boolean).join(" ");
  const label = options.label
    ? `<span class="bible-preview-surface-label">${options.label}</span>`
    : "";
  const attribution = options.attribution === false
    ? ""
    : `<div id="${prefix}Attribution" class="bible-preview-attribution scripture-render__attribution"></div>`;
  const feature = options.feature ? " data-lower-third-feature hidden" : "";
  return `<section id="${prefix}Shell" class="${shellClasses}" aria-label="${options.ariaLabel || "Lower-third preview"}"${feature}>
    ${label}
    <div id="${prefix}Render" class="${renderClasses}">
      <div class="scripture-render__box">
        <div id="${prefix}Text" class="bible-preview-text scripture-render__body"></div>
        <div id="${prefix}Reference" class="bible-preview-reference scripture-render__reference"></div>
        ${attribution}
      </div>
    </div>
  </section>`;
}

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
    ? widthFit ? rect.width / width : Math.min(rect.width / width, rect.height / height)
    : 1;
  const safeScale = Math.max(0.01, scale);
  const offsetX = Math.max(0, (rect.width - width * safeScale) / 2);
  const offsetY = options.align === "bottom"
    ? rect.height - height * safeScale
    : Math.max(0, (rect.height - height * safeScale) / 2);
  surface.style.setProperty("--bible-preview-output-scale", `${safeScale}`);
  surface.style.setProperty("--bible-preview-scaled-width", `${width * safeScale}px`);
  surface.style.setProperty("--bible-preview-scaled-height", `${height * safeScale}px`);
  surface.style.setProperty("--bible-preview-scripture-gap", `${Math.max(1, Math.round(24 * safeScale))}px`);
  surface.style.setProperty("--bible-preview-output-offset-x", `${offsetX}px`);
  surface.style.setProperty("--bible-preview-output-offset-y", `${offsetY}px`);
}

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

export function renderLowerThirdPreview(options = {}) {
  const { shell, render, body, reference, message, outputSize, renderMessage } = options;
  if (!shell || !render || !body || !reference || !message) return false;
  shell.style.backgroundColor = message.chromaKeyColor || "#00ff00";
  applyLowerThirdPreviewScale(shell, outputSize, { fit: "width", align: "bottom" });
  renderMessage?.(render, body, reference, message);
  render.classList.toggle("is-operator-cued", options.cued === true);
  return true;
}
