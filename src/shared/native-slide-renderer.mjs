import {
  normalizeScriptureFontSize,
  scriptureReferencePresentationForBackground,
  SCRIPTURE_FONT_FAMILY,
  SCRIPTURE_FONT_WEIGHT,
  SCRIPTURE_LINE_HEIGHT,
  SCRIPTURE_MIN_BODY_FONT_SIZE,
} from "./app-bible-scripture-render.mjs";
import { deckToTransientSong } from "./app-slide-utils.mjs";
import { messageFromResolvedPresentation, renderSongForTarget } from "./theme-render-message.mjs";

/** Scoped, self-installed CSS contract. The host supplies viewport dimensions and fonts.
 * Geometry uses virtual-canvas pixels/percentages, never stage-window vw/vh units.
 */
export const NATIVE_SLIDE_RENDERER_CSS = `
.stage-native-viewport { position: relative; overflow: hidden; }
.stage-native-slide { position: absolute; overflow: hidden; transform-origin: 0 0; isolation: isolate; }
.stage-native-slide__background { position: absolute; inset: 0; z-index: 0; background: center / cover no-repeat; }
.stage-native-slide__background > video { width: 100%; height: 100%; object-fit: cover; }
.stage-native-slide__content { position: absolute; inset: 0; z-index: 1; display: flex; box-sizing: border-box; }
.stage-native-slide .scripture-render__box { position: relative; display: flex; flex-direction: column; box-sizing: border-box; min-width: 0; max-height: none; gap: 22px; }
.stage-native-slide .scripture-render__body,
.stage-native-slide .scripture-render__reference,
.stage-native-slide .scripture-render__attribution { flex: 0 0 auto; min-height: 0; font-family: inherit; font-weight: inherit; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
.stage-native-slide .scripture-render__body { width: 100%; text-shadow: 0 2px 14px rgba(0,0,0,.72); }
.stage-native-slide .scripture-render__reference,
.stage-native-slide .scripture-render__attribution { line-height: 1.2; }
.stage-native-slide .scripture-render--slide-objects { display: block; text-align: initial; }
.stage-native-slide .slide-output-object { position: absolute; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; }
.stage-native-slide .slide-output-object--image,
.stage-native-slide .slide-output-object--shape { display: block; }
.stage-native-slide .slide-output-object__image { width: 100%; height: 100%; display: block; }
.stage-native-slide .slide-output-object__shape { position: absolute; inset: 0; pointer-events: none; }
.stage-native-slide .slide-output-object__shape--line { inset: 50% 0 auto 0; height: 0; transform: translateY(-50%); }
.stage-native-slide .slide-text-output-object__background { position: absolute; inset: 0; z-index: 0; background: center / cover no-repeat; pointer-events: none; }
.stage-native-slide .slide-text-output-object__background video { width: 100%; height: 100%; display: block; object-fit: cover; }
.stage-native-slide .slide-text-output-object__body { position: relative; z-index: 1; width: 100%; white-space: pre-wrap; overflow-wrap: anywhere; text-shadow: 0 2px 14px rgba(0,0,0,.72); }
.stage-native-slide .song-block { white-space: pre-wrap; }
.stage-native-slide .song-block--spacer { min-height: 1em; }
.stage-native-slide__copyright { position: absolute; z-index: 2; left: 2%; bottom: 2%; max-width: calc(100% - 24px); color: rgba(255,255,255,.78); font-size: 15px; line-height: 1.25; white-space: pre-wrap; text-align: left; text-shadow: 0 2px 14px rgba(0,0,0,.72); pointer-events: none; }
.stage-native-slide [hidden] { display: none !important; }
`;

// Shared by audience and stage so AST formatting and escaping stay identical.
export function renderSongSectionHTML(blocks) {
  if (Array.isArray(blocks) && blocks.length > 0) {
    return blocks
      .map(block => {
        if (block?.type === "lyricLine" && Array.isArray(block.primary?.segments)) {
          const hasText = block.primary.segments.some((segment) => String(segment?.text || "").length > 0);
          if (!hasText) {
            return `<div class="song-block song-block--spacer">&nbsp;</div>`;
          }
          const html = block.primary.segments
            .map((segment) => renderSongSegmentHTML(segment))
            .join("");
          return `<div class="song-block">${html || "&nbsp;"}</div>`;
        }
        return `<div class="song-block song-block--spacer">&nbsp;</div>`;
      })
      .join("");
  }
  return "";
}

export function renderSongSegmentHTML(segment) {
  const text = segment?.text || "";
  const style = songSegmentStyleAttribute(segment?.style);
  return `<span${style ? ` style="${escapeHtml(style)}"` : ""}>${escapeHtml(text)}</span>`;
}

export function songSegmentStyleAttribute(style) {
  if (!style || typeof style !== "object") return "";
  const declarations = [];
  const color = typeof style.color === "string" ? style.color.trim() : "";
  const fontFamily = typeof style.fontFamily === "string" ? style.fontFamily.trim() : "";
  const backgroundColor = typeof style.backgroundColor === "string" ? style.backgroundColor.trim() : "";
  const fontWeight = typeof style.fontWeight === "string" || Number.isFinite(Number(style.fontWeight))
    ? String(style.fontWeight).trim()
    : "";
  const fontStyle = typeof style.fontStyle === "string" ? style.fontStyle.trim() : "";
  const textDecoration = typeof style.textDecoration === "string" ? style.textDecoration.trim() : "";
  if (/^(#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|[a-z]+)$/i.test(color)) {
    declarations.push(`color: ${color}`);
  }
  if (/^(#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|[a-z]+)$/i.test(backgroundColor)) {
    declarations.push(`background-color: ${backgroundColor}`);
  }
  if (fontFamily && !/[;{}<>]/.test(fontFamily)) {
    declarations.push(`font-family: ${fontFamily}`);
  }
  if (/^(normal|bold|bolder|lighter|[1-9]00)$/i.test(fontWeight)) {
    declarations.push(`font-weight: ${fontWeight}`);
  }
  if (/^(normal|italic|oblique)$/i.test(fontStyle)) {
    declarations.push(`font-style: ${fontStyle}`);
  }
  if (/^(none|underline|line-through|overline)(\s+(underline|line-through|overline))*$/i.test(textDecoration)) {
    declarations.push(`text-decoration: ${textDecoration}`);
  }
  return declarations.join("; ");
}

export function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const videoStates = new WeakMap();
const cssUrl = (value) => `url(${JSON.stringify(String(value))})`;
const mediaPath = (path) => /^[a-z]+:\/\//i.test(path) ? path : `file://${String(path).replace(/\\/g, "/")}`;

function silence(video) {
  video.muted = true;
  video.defaultMuted = true;
  video.volume = 0;
  video.loop = true;
  video.playsInline = true;
}

function updateVideoTransport(video, sync) {
  const state = videoStates.get(video);
  if (!state?.active) return;
  state.sync = sync;
  silence(video);
  const playing = typeof sync?.playing === "boolean" ? sync.playing : sync?.paused !== true;
  let time = Number.isFinite(sync?.targetTime) ? sync.targetTime : sync?.currentTime;
  if (Number.isFinite(time)) {
    // Audience messages carry a preview sample, not the current playhead. A
    // cached stage bootstrap (or delayed metadata) can receive it much later.
    // Match the audience's preview compensation; explicit targets/pauses stay exact.
    if (playing && !Number.isFinite(sync?.targetTime) && Number.isFinite(sync?.capturedAt)) {
      time += Math.max(0, (Date.now() - sync.capturedAt) * 0.001) + 0.15;
    }
    time = Math.max(0, time);
    if (Number.isFinite(video.duration) && video.duration > 0) time %= video.duration;
    try { video.currentTime = time; } catch { /* Retry the latest snapshot on metadata. */ }
  }
  video.autoplay = playing;
  state.playing = playing;
  if (!playing) {
    state.requested = false;
    video.pause();
  } else if (!state.requested) {
    state.requested = true;
    try {
      void Promise.resolve(video.play()).then(() => {
        // A pending play must not resurrect a disposed or subsequently paused video.
        if (!state.active || !state.playing) video.pause();
      }).catch(() => { state.requested = false; });
    } catch { state.requested = false; }
  }
}

function createSilentVideo(document, source, sync) {
  const video = document.createElement("video");
  silence(video);
  const state = { active: true, requested: false, playing: false, sync };
  state.metadata = () => updateVideoTransport(video, state.sync);
  videoStates.set(video, state);
  video.addEventListener("loadedmetadata", state.metadata);
  video.src = source;
  video.load();
  updateVideoTransport(video, sync);
  return video;
}

function releaseVideos(root) {
  for (const video of root.querySelectorAll("video")) {
    const state = videoStates.get(video);
    if (state) {
      state.active = false;
      video.removeEventListener("loadedmetadata", state.metadata);
      videoStates.delete(video);
    }
    video.autoplay = false;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}

export function renderSlideTextObjectBackground(box, object) {
  const bg = object?.background && typeof object.background === "object" ? object.background : null;
  if (!bg) return;
  const document = box.ownerDocument;
  const bgEl = document.createElement("div");
  bgEl.className = "slide-text-output-object__background";
  if (bg.type === "color") {
    bgEl.style.backgroundColor = bg.color || "transparent";
  } else if (bg.backgroundVideo) {
    bgEl.appendChild(createSilentVideo(document, bg.backgroundVideo));
  } else if (bg.backgroundImage) {
    bgEl.style.backgroundImage = cssUrl(bg.backgroundImage);
  } else if (bg.path) {
    const src = mediaPath(bg.path);
    if (bg.type === "video") {
      bgEl.appendChild(createSilentVideo(document, src));
    } else {
      bgEl.style.backgroundImage = cssUrl(src);
    }
  }
  box.appendChild(bgEl);
}

export function fitTextElementToBox(box, textEl, { baseSize, minSize, mode = "fit" } = {}) {
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
  // Match the audience emergency floor even when autosizing is disabled.
  while (size > hardMin && overflows()) {
    size = Math.max(hardMin, Math.floor(size * 0.92));
    textEl.style.fontSize = `${size}px`;
  }
}

export function renderSlideObjects(textContent, objects, message = {}) {
  const document = textContent.ownerDocument;
  releaseVideos(textContent);
  textContent.textContent = "";
  textContent.classList.add("scripture-render--slide-objects");
  const safeObjects = (Array.isArray(objects) ? objects : [])
    .map((object, index) => ({ object, index }))
    .sort((a, b) => {
      const az = Number.isFinite(a.object?.zIndex) ? a.object.zIndex : 0;
      const bz = Number.isFinite(b.object?.zIndex) ? b.object.zIndex : 0;
      return az === bz ? a.index - b.index : az - bz;
    })
    .map(({ object }) => object);
  for (const object of safeObjects) {
    if (!object) continue;
    const kind = object.kind === "image" || object.kind === "shape" ? object.kind : "text";
    const position = object?.textBoxPosition || {};
    const box = document.createElement("div");
    box.className = `slide-text-output-object slide-output-object slide-output-object--${kind}`;
    box.style.left = position.left || "10%";
    box.style.top = position.top || "10%";
    box.style.width = position.width || "80%";
    box.style.height = position.height || "80%";
    box.style.zIndex = String(Number.isFinite(object.zIndex) ? object.zIndex : 0);
    box.style.opacity = String(Math.max(0, Math.min(1, Number.isFinite(Number(object.opacity)) ? Number(object.opacity) : 1)));

    if (kind === "image") {
      const image = object.image && typeof object.image === "object" ? object.image : {};
      const src = image.imageUrl || image.url || image.src || "";
      if (src) {
        const img = document.createElement("img");
        img.className = "slide-output-object__image";
        img.src = src;
        img.alt = "";
        img.draggable = false;
        img.style.objectFit = image.fit === "cover" || image.fit === "fill" ? image.fit : "contain";
        box.appendChild(img);
      }
      textContent.appendChild(box);
      continue;
    }

    if (kind === "shape") {
      const shape = object.shape && typeof object.shape === "object" ? object.shape : {};
      const shapeEl = document.createElement("div");
      shapeEl.className = "slide-output-object__shape";
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
        shapeEl.classList.add("slide-output-object__shape--line");
        shapeEl.style.border = "none";
        shapeEl.style.borderTop = `${strokeWidth}px solid ${shape.stroke || shape.fill || "#ffffff"}`;
      }
      box.appendChild(shapeEl);
      textContent.appendChild(box);
      continue;
    }

    box.style.textAlign = object.align || "center";
    box.style.alignItems =
      object.align === "left" ? "flex-start" : object.align === "right" ? "flex-end" : "center";
    box.style.justifyContent =
      object.verticalAlign === "top" ? "flex-start" : object.verticalAlign === "bottom" ? "flex-end" : "center";
    renderSlideTextObjectBackground(box, object);
    const body = document.createElement("div");
    body.className = "slide-text-output-object__body";
    const bodyFontSize = normalizeScriptureFontSize(object.fontSize, message.fontSize);
    body.style.color = object.color || message.color || "#ffffff";
    body.style.fontFamily = object.fontFamily || message.fontFamily || SCRIPTURE_FONT_FAMILY;
    body.style.fontSize = `${bodyFontSize}px`;
    body.style.fontWeight = object.fontWeight || message.fontWeight || SCRIPTURE_FONT_WEIGHT;
    body.style.fontStyle = object.fontStyle || "";
    body.style.textDecoration = object.textDecoration || "";
    body.style.lineHeight = String(object.lineHeight || message.lineHeight || SCRIPTURE_LINE_HEIGHT);
    body.innerHTML = renderSongSectionHTML(object.blocks);
    const fitMinSize = normalizeScriptureFontSize(object.minFontSize, message.minFontSize || SCRIPTURE_MIN_BODY_FONT_SIZE);
    const fitMode = object.autofit || message.autosizeMode || "fit";
    body.dataset.fitBaseSize = String(bodyFontSize);
    body.dataset.fitMinSize = String(fitMinSize);
    body.dataset.fitMode = fitMode;
    box.appendChild(body);
    textContent.appendChild(box);
    fitTextElementToBox(box, body, { baseSize: bodyFontSize, minSize: fitMinSize, mode: fitMode });
  }
}

/** Fit body AND its reference/attribution into the actual virtual text frame. */
export function fitFullscreenScriptureRender(content, message = {}) {
  const box = content?.querySelector(".scripture-render__box");
  const body = box?.querySelector(".scripture-render__body");
  if (!body) return;
  const reference = box.querySelector(".scripture-render__reference");
  const attribution = box.querySelector(".scripture-render__attribution");
  const base = normalizeScriptureFontSize(message.fontSize, 66);
  const resolvedSize = message.resolvedLayout?.measurementMode === "dom" ? message.resolvedLayout.resolvedFontSize : null;
  let size = Number.isFinite(resolvedSize) ? resolvedSize : Number.isFinite(message.autosizeGroupFontSize)
    ? Math.min(base, Math.max(message.minFontSize || 38, message.autosizeGroupFontSize)) : base;
  const referenceBase = Math.max(14, Math.round(message.referenceFontSize || 38));
  const computed = content.ownerDocument.defaultView?.getComputedStyle?.(box);
  const px = (value) => Number.parseFloat(value) || 0;
  const width = Math.max(1, box.clientWidth - px(computed?.paddingLeft) - px(computed?.paddingRight));
  const height = Math.max(1, box.clientHeight - px(computed?.paddingTop) - px(computed?.paddingBottom));
  const visible = [body, reference, attribution].filter((el) => el && !el.hidden);
  const gap = px(computed?.rowGap ?? computed?.gap ?? "22");
  const apply = () => {
    const refSize = Math.max(20, Math.round(size * referenceBase / base));
    body.style.fontSize = `${size}px`;
    reference.style.fontSize = `${refSize}px`;
    attribution.style.fontSize = `${Math.max(12, Math.round(refSize * 0.42))}px`;
    content.style.setProperty("--scripture-font-size", `${size}px`);
    content.style.setProperty("--scripture-reference-font-size", `${refSize}px`);
    content.style.setProperty("--scripture-attribution-font-size", attribution.style.fontSize);
  };
  apply();
  const overflows = () => visible.some((el) => el.scrollWidth > Math.ceil(width) + 1) ||
    visible.reduce((sum, el) => sum + el.scrollHeight, gap * (visible.length - 1)) > Math.ceil(height) + 1;
  while (size > 8 && overflows()) {
    size = Math.max(8, Math.floor(size * 0.92));
    apply();
  }
}

function resolvedMessage(input, defaultOutputSize) {
  if (input.message && typeof input.message === "object") return {
    ...input.message,
    resolvedTheme: input.message.resolvedTheme || input.resolvedTheme,
    outputSize: input.message.outputSize || input.outputSize || input.message.target?.outputSize || input.target?.outputSize,
  };
  const presentation = input.resolvedPresentation || input.presentation;
  if (presentation?.activeSlide && !input.blocks && !input.bodyText) return messageFromResolvedPresentation(presentation, { resolvedTheme: input.resolvedTheme || presentation.resolvedTheme });
  const ast = input.content || input;
  if (ast.schema === "ems.song.v1" || ast.schema === "ems.slideDeck.v1") {
    // Raw documents are optional convenience inputs; normal stage traffic is
    // already resolved and must not be re-paginated for the smaller viewport.
    if (input.blocks || input.resolvedUnit || input.slideObjects) return input;
    const song = ast.schema === "ems.slideDeck.v1" ? deckToTransientSong(ast) : ast;
    const result = renderSongForTarget(song, {
      outputRole: "audience", outputSize: input.outputSize || ast.canvas || defaultOutputSize,
      sectionId: input.sectionId || input.pageId,
      activeSlideId: input.activeSlideId, render: input.render || song.defaultRender || {},
      documentRef: null,
    }, input.resolvedTheme);
    return result.message;
  }
  return input;
}

// Only consumed visual fields participate: stage clocks/overlays and transport
// snapshots must never destroy the current DOM or restart object videos.
const visualFields = ["text", "bodyText", "referenceText", "attributionText", "copyrightText", "blocks", "slideObjects", "slideTextObjects", "fontSize", "minFontSize", "fontFamily", "fontWeight", "fontStyle", "textDecoration", "lineHeight", "color", "referenceColor", "referenceTextShadow", "referenceFontSize", "autosizeMode", "autosizeGroupFontSize", "resolvedLayout", "contentKind", "position", "textBoxPosition", "backgroundColor", "backgroundImage", "backgroundVideo", "backgroundPath"];
function signature(value) {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]])) : entry);
}
const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const align = (value) => value === "left" || value === "top" ? "flex-start" : value === "right" || value === "bottom" ? "flex-end" : "center";

/** Owns only the appended canvas; clear is reusable, dispose is terminal. */
export function createNativeSlideRenderer({ viewport, width = 1920, height = 1080 } = {}) {
  if (!viewport?.ownerDocument) throw new TypeError("A DOM viewport is required");
  const document = viewport.ownerDocument;
  const view = document.defaultView || globalThis;
  const baseWidth = positive(width, 1920), baseHeight = positive(height, 1080);
  let canvasWidth = baseWidth, canvasHeight = baseHeight;
  let disposed = false, generation = 0, frame = null, lastSignature = null, syncSignature = null, current = null;
  const hadViewportClass = viewport.classList.contains("stage-native-viewport");
  viewport.classList.add("stage-native-viewport");
  const create = (tag, className, parent) => {
    const el = document.createElement(tag);
    el.className = className;
    parent?.appendChild(el);
    return el;
  };
  const slide = create("div", "stage-native-slide", viewport);
  slide.hidden = true;
  const stylesheet = create("style", "", slide);
  stylesheet.textContent = NATIVE_SLIDE_RENDERER_CSS;
  const background = create("div", "stage-native-slide__background", slide);
  const content = create("div", "stage-native-slide__content scripture-render scripture-render--fullscreen", slide);
  const copyright = create("div", "stage-native-slide__copyright song-copyright-overlay", slide);

  function refit() {
    if (!current || disposed) return;
    const bodies = content.querySelectorAll(".slide-text-output-object__body");
    for (const body of bodies) fitTextElementToBox(body.parentElement, body, {
      baseSize: body.dataset.fitBaseSize, minSize: body.dataset.fitMinSize, mode: body.dataset.fitMode,
    });
    if (!bodies.length) fitFullscreenScriptureRender(content, current);
  }
  function resize() {
    if (disposed) return;
    const bounds = viewport.getBoundingClientRect();
    const vw = viewport.clientWidth || bounds.width || 0, vh = viewport.clientHeight || bounds.height || 0;
    const scale = Math.min(vw / canvasWidth, vh / canvasHeight);
    Object.assign(slide.style, {
      width: `${canvasWidth}px`, height: `${canvasHeight}px`,
      left: `${Math.max(0, (vw - canvasWidth * scale) / 2)}px`, top: `${Math.max(0, (vh - canvasHeight * scale) / 2)}px`,
      transform: `scale(${scale})`,
    });
    refit();
  }
  function cancelRefresh() {
    generation++;
    if (frame !== null) view.cancelAnimationFrame?.(frame);
    frame = null;
  }
  function scheduleRefresh() {
    const token = generation;
    const schedule = () => {
      if (disposed || !current || token !== generation) return;
      if (frame !== null) view.cancelAnimationFrame?.(frame);
      if (view.requestAnimationFrame) frame = view.requestAnimationFrame(() => {
        frame = null;
        if (!disposed && token === generation) resize();
      });
      else resize();
    };
    schedule();
    if (document.fonts?.ready?.then) void document.fonts.ready.then(schedule).catch(() => {});
  }
  function clear() {
    cancelRefresh();
    releaseVideos(slide);
    background.replaceChildren();
    content.replaceChildren();
    background.style.backgroundImage = "";
    background.style.backgroundColor = "";
    copyright.textContent = "";
    slide.hidden = true;
    lastSignature = syncSignature = current = null;
  }
  function render(input) {
    if (disposed) return;
    if (!input || typeof input !== "object") { clear(); return; }
    const message = resolvedMessage(input, { width: baseWidth, height: baseHeight });
    const m = { fontSize: 66, minFontSize: 38, fontFamily: SCRIPTURE_FONT_FAMILY, fontWeight: SCRIPTURE_FONT_WEIGHT, lineHeight: SCRIPTURE_LINE_HEIGHT, color: "#ffffff", backgroundColor: "#000000", ...message };
    const output = message.outputSize || message.target?.outputSize || message.resolvedTheme?.outputSize;
    const w = positive(output?.width, baseWidth), h = positive(output?.height, baseHeight);
    const key = signature({ ...Object.fromEntries(visualFields.map((field) => [field, m[field]])), backdrop: m.resolvedTheme?.backdrop, width: w, height: h });
    const nextSync = signature(m.backgroundVideoSync ?? null);
    if (lastSignature === key) {
      if (syncSignature !== nextSync) {
        const video = background.querySelector("video");
        if (video) updateVideoTransport(video, m.backgroundVideoSync);
        syncSignature = nextSync;
      }
      return;
    }
    clear();
    current = m;
    lastSignature = key;
    syncSignature = nextSync;
    canvasWidth = w;
    canvasHeight = h;
    slide.hidden = false;
    background.style.backgroundColor = m.backgroundColor;
    const image = m.backgroundImage || (!m.backgroundVideo ? m.backgroundPath : "");
    background.style.backgroundImage = image ? cssUrl(image) : "";
    if (m.backgroundVideo) background.appendChild(createSilentVideo(document, m.backgroundVideo, m.backgroundVideoSync));
    content.classList.remove("scripture-render--slide-objects");
    Object.assign(content.style, {
      fontFamily: m.fontFamily, fontWeight: m.fontWeight, fontStyle: m.fontStyle || "", color: m.color,
      lineHeight: String(m.lineHeight), textDecoration: m.textDecoration || "",
      textAlign: m.position?.horizontal || "center", alignItems: align(m.position?.vertical), justifyContent: align(m.position?.horizontal),
    });
    content.style.setProperty("--scripture-line-height", String(m.lineHeight));
    content.style.setProperty("--scripture-font-weight", String(m.fontWeight));
    content.style.setProperty("--scripture-color", m.color);
    copyright.textContent = String(m.copyrightText || "").trim();
    copyright.hidden = !copyright.textContent;
    const objects = Array.isArray(m.slideObjects) && m.slideObjects.length ? m.slideObjects : m.slideTextObjects;
    if (Array.isArray(objects) && objects.length) {
      renderSlideObjects(content, objects, m);
    } else {
      const box = create("div", "scripture-render__box", content);
      const position = m.textBoxPosition;
      Object.assign(box.style, {
        width: "min(90%, 1720px)", height: "86%", alignItems: "stretch", justifyContent: align(m.position?.vertical),
      });
      if (position) Object.assign(box.style, { position: "absolute", left: position.left, top: position.top, width: position.width, height: position.height });
      const backdrop = m.resolvedTheme?.backdrop;
      if (backdrop?.enabled) Object.assign(box.style, {
        backgroundColor: backdrop.background?.color || "#101010", opacity: String(backdrop.opacity ?? 1),
        borderRadius: `${Number(backdrop.cornerRadius) || 0}px`,
        padding: `${Number(backdrop.paddingPx?.y) || 0}px ${Number(backdrop.paddingPx?.x) || 0}px`,
        boxSizing: "border-box",
      });
      const body = create("div", "scripture-render__body", box);
      const html = m.contentKind === "scripture" ? "" : renderSongSectionHTML(m.blocks);
      if (html) body.innerHTML = html;
      else body.textContent = m.bodyText || m.text || "";
      const referencePresentation = scriptureReferencePresentationForBackground(m.backgroundColor, { forceLight: Boolean(m.backgroundImage || m.backgroundVideo || m.backgroundPath) });
      for (const [kind, value] of [["reference", m.referenceText], ["attribution", m.attributionText]]) {
        const el = create("div", `scripture-render__${kind}`, box);
        el.textContent = value || "";
        el.hidden = !value;
        el.style.color = m.referenceColor || referencePresentation.color;
        el.style.textShadow = m.referenceTextShadow || referencePresentation.shadow;
      }
      content.style.setProperty("--scripture-reference-color", m.referenceColor || referencePresentation.color);
      content.style.setProperty("--scripture-reference-shadow", m.referenceTextShadow || referencePresentation.shadow);
    }
    resize();
    scheduleRefresh();
  }
  const ResizeObserver = view.ResizeObserver || globalThis.ResizeObserver;
  const observer = ResizeObserver ? new ResizeObserver(resize) : null;
  observer?.observe(viewport);
  if (!observer) view.addEventListener?.("resize", resize);
  resize();
  return { render, clear, dispose() {
    if (disposed) return;
    clear();
    disposed = true;
    observer?.disconnect();
    if (!observer) view.removeEventListener?.("resize", resize);
    slide.remove();
    if (!hadViewportClass) viewport.classList.remove("stage-native-viewport");
  } };
}