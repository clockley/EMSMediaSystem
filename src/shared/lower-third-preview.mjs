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
    <div class="lower-third-preview__chrome">
      ${label}
      <span id="${prefix}KeySwatch" class="lower-third-preview__key-swatch" title="Lower-third key color">
        <span class="lower-third-preview__key-swatch-color" aria-hidden="true"></span>
        <span>Key</span>
      </span>
      <span class="lower-third-preview__mode-switch" role="group" aria-label="Preview background">
        <button type="button" id="${prefix}OnAirMode" class="lower-third-preview__mode-button is-active" data-lower-third-preview-mode="on-air" aria-pressed="true">On-air</button>
        <button type="button" id="${prefix}KeyMode" class="lower-third-preview__mode-button" data-lower-third-preview-mode="key" aria-pressed="false">Key</button>
      </span>
    </div>
    <div id="${prefix}Render" class="${renderClasses}">
      <div class="scripture-render__box">
        <div id="${prefix}Text" class="bible-preview-text scripture-render__body"></div>
        <div id="${prefix}Reference" class="bible-preview-reference scripture-render__reference"></div>
        ${attribution}
      </div>
    </div>
  </section>`;
}

function syncLowerThirdPreviewMode(shell) {
  const mode = shell.dataset.lowerThirdPreviewMode === "key" ? "key" : "on-air";
  shell.dataset.lowerThirdPreviewMode = mode;
  shell.querySelectorAll("[data-lower-third-preview-mode]").forEach((button) => {
    const active = button.dataset.lowerThirdPreviewMode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

/** Install the operator-only composite/key background switch once per preview. */
export function installLowerThirdPreviewModeControls(shell) {
  if (!shell) return;
  if (shell.dataset.lowerThirdPreviewMode !== "key") {
    shell.dataset.lowerThirdPreviewMode = "on-air";
  }
  if (shell._lowerThirdPreviewModeControlsInstalled !== true) {
    shell._lowerThirdPreviewModeControlsInstalled = true;
    shell.querySelectorAll("[data-lower-third-preview-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        shell.dataset.lowerThirdPreviewMode =
          button.dataset.lowerThirdPreviewMode === "key" ? "key" : "on-air";
        syncLowerThirdPreviewMode(shell);
      });
    });
  }
  syncLowerThirdPreviewMode(shell);
}

/** Render a persistent, operator-only Live/Cued state on an audience preview. */
export function renderOperatorPreviewState(surface, options = {}) {
  if (!surface) return "";
  const state = options.live === true ? "live" : options.cued === true ? "cued" : "";
  surface.classList.toggle("is-operator-live", state === "live");
  surface.classList.toggle("is-operator-cued", state === "cued");
  if (state) surface.dataset.operatorPreviewState = state;
  else delete surface.dataset.operatorPreviewState;

  let status = surface.querySelector(".operator-preview-state");
  if (!status && state) {
    status = document.createElement("span");
    status.className = "operator-preview-state";
    status.setAttribute("aria-live", "polite");
    surface.append(status);
  }
  if (status) {
    status.hidden = !state;
    status.textContent = state === "live" ? "Live" : state === "cued" ? "Cued" : "";
  }
  return state;
}

/** True when two resolved messages point at the same source and output slide. */
export function resolvedPreviewMessagesMatch(liveMessage, previewMessage) {
  if (!liveMessage || !previewMessage) return false;
  const liveSourceId = liveMessage.resolvedPresentation?.source?.id || "";
  const previewSourceId = previewMessage.resolvedPresentation?.source?.id || "";
  const liveSlideId =
    liveMessage.slideId || liveMessage.resolvedPresentation?.navigation?.activeSlideId || "";
  const previewSlideId =
    previewMessage.slideId || previewMessage.resolvedPresentation?.navigation?.activeSlideId || "";
  if (liveSourceId && previewSourceId) {
    return (
      liveSourceId === previewSourceId &&
      (!liveSlideId || !previewSlideId || liveSlideId === previewSlideId)
    );
  }
  return (
    String(liveMessage.contentKind || "") === String(previewMessage.contentKind || "") &&
    String(liveMessage.bodyText || liveMessage.text || "").trim() ===
      String(previewMessage.bodyText || previewMessage.text || "").trim()
  );
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
  const keyColor = message.chromaKeyColor || "#00ff00";
  shell.style.setProperty("--lower-third-preview-key-color", keyColor);
  const keySwatch = shell.querySelector(".lower-third-preview__key-swatch");
  if (keySwatch) {
    keySwatch.title = `Lower-third key color ${keyColor}`;
    keySwatch.setAttribute("aria-label", `Lower-third key color ${keyColor}`);
  }
  installLowerThirdPreviewModeControls(shell);
  applyLowerThirdPreviewScale(shell, outputSize, { fit: "width", align: "bottom" });
  renderMessage?.(render, body, reference, message);
  const live = options.live === true;
  render.classList.toggle("is-operator-live", live);
  render.classList.toggle("is-operator-cued", !live && options.cued === true);
  render.dataset.operatorPreviewState = live ? "live" : options.cued === true ? "cued" : "";
  return true;
}
