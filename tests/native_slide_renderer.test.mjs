import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createNativeSlideRenderer, NATIVE_SLIDE_RENDERER_CSS,
  renderSongSectionHTML, renderSongSegmentHTML, songSegmentStyleAttribute, escapeHtml,
  renderSlideObjects, renderSlideTextObjectBackground, fitTextElementToBox, fitFullscreenScriptureRender,
} from "../src/shared/native-slide-renderer.mjs";

const line = (text, style) => ({ id: text, type: "lyricLine", primary: { lang: "en", segments: [{ text, ...(style ? { style } : {}) }] } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

// Small layout-aware DOM, with real ownership, removal, events and observable
// media operations. No browser globals, installed dependencies, or eval needed.
function harness({ width = 960, height = 540, observer = true, raf = true, fonts = true } = {}) {
  const elements = [], observers = [], frames = new Map(), events = new Map();
  const fontReady = deferred();
  let nextFrame = 0;
  const decode = (html) => html.replace(/<\/div>/g, "\n").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, "&").replace(/\n$/, "");
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.ownerDocument = document;
      this.children = []; this.parentElement = null; this.dataset = {}; this.hidden = false;
      this.attributes = new Map(); this.listeners = new Map(); this.className = "";
      this.style = { setProperty(key, value) { this[key] = value; }, removeProperty(key) { delete this[key]; } };
      this.classList = {
        contains: (value) => this.className.split(/\s+/).includes(value),
        add: (...values) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...values])].join(" "); },
        remove: (...values) => { this.className = this.className.split(/\s+/).filter((value) => !values.includes(value)).join(" "); },
      };
      this._text = ""; this._html = ""; this.htmlWrites = 0;
      this.playCalls = 0; this.pauseCalls = 0; this.loadCalls = 0; this.srcWrites = 0;
      this.paused = true; this.currentTime = 0; this.duration = NaN;
      elements.push(this);
    }
    get textContent() { return this._text + this.children.map((el) => el.textContent).join(""); }
    set textContent(value) { this.replaceChildren(); this._html = ""; this._text = String(value); }
    get innerHTML() { return this._html; }
    set innerHTML(value) { this.replaceChildren(); this._html = value; this._text = decode(value); this.htmlWrites++; }
    appendChild(el) { el.remove(); this.children.push(el); el.parentElement = this; return el; }
    append(...els) { els.forEach((el) => this.appendChild(el)); }
    replaceChildren(...els) {
      for (const child of this.children) child.parentElement = null;
      this.children = []; this._text = ""; this._html = ""; this.append(...els);
    }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((el) => el !== this);
      this.parentElement = null;
    }
    querySelectorAll(selector) {
      const matches = (el) => selector.startsWith(".") ? el.classList.contains(selector.slice(1)) : el.tagName === selector.toUpperCase();
      return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    removeAttribute(key) { this.attributes.delete(key); }
    set src(value) { this.srcWrites++; this.attributes.set("src", value); }
    get src() { return this.getAttribute("src") || ""; }
    addEventListener(event, callback) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event).add(callback);
    }
    removeEventListener(event, callback) { this.listeners.get(event)?.delete(callback); }
    dispatch(event) { for (const callback of this.listeners.get(event) || []) callback(); }
    play() { this.playCalls++; this.paused = false; return document.playResult?.(this) ?? Promise.resolve(); }
    pause() { this.pauseCalls++; this.paused = true; }
    load() { this.loadCalls++; this.currentTime = 0; }
    inherited(key, fallback) { return this.style[key] || this.parentElement?.inherited(key, fallback) || fallback; }
    dimension(value, parent) {
      if (!value) return parent;
      if (value.startsWith("min(")) return Math.min(parent * 0.9, 1720);
      return value.endsWith("%") ? parent * Number.parseFloat(value) / 100 : Number.parseFloat(value);
    }
    get clientWidth() { return this._width ?? this.dimension(this.style.width, this.parentElement?.clientWidth || 1920); }
    get clientHeight() {
      if (this._height !== undefined) return this._height;
      if (this.style.height) return this.dimension(this.style.height, this.parentElement?.clientHeight || 1080);
      if (/__(body|reference|attribution)$/.test(this.className) || this.classList.contains("slide-text-output-object__body")) return this.scrollHeight;
      return this.parentElement?.clientHeight || 1080;
    }
    get scrollWidth() { return this.hidden || !this.textContent ? 0 : Math.min(this.clientWidth, Math.max(...this.textContent.split("\n").map((s) => s.length)) * Number.parseFloat(this.inherited("fontSize", "66")) * 0.55); }
    get scrollHeight() {
      if (this.hidden || !this.textContent) return 0;
      const size = Number.parseFloat(this.inherited("fontSize", "66"));
      const lines = this.textContent.split("\n").reduce((n, text) => n + Math.max(1, Math.ceil(text.length * size * 0.55 / Math.max(1, this.clientWidth))), 0);
      return lines * size * Number(this.inherited("lineHeight", "1.32"));
    }
    getBoundingClientRect() { return { width: this.clientWidth, height: this.clientHeight }; }
  }
  const document = {
    createElement: (tag) => new Element(tag),
    ...(fonts ? { fonts: { ready: fontReady.promise } } : {}),
    defaultView: {
      ...(raf ? {
        requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
        cancelAnimationFrame(id) { frames.delete(id); },
      } : {}),
      ...(observer ? { ResizeObserver: class {
        constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
        observe(el) { this.element = el; }
        disconnect() { this.disconnected = true; }
      } } : {}),
      addEventListener(event, callback) { events.set(event, callback); },
      removeEventListener(event, callback) { if (events.get(event) === callback) events.delete(event); },
      getComputedStyle(el) {
        const [y = "0", x = y] = (el.style.padding || "0").split(" ");
        return { rowGap: "22px", paddingTop: y, paddingBottom: y, paddingLeft: x, paddingRight: x };
      },
    },
  };
  const viewport = document.createElement("div"); viewport._width = width; viewport._height = height;
  const renderer = createNativeSlideRenderer({ viewport });
  return {
    document, viewport, renderer, elements, observers, frames, events, fontReady,
    find: (selector) => viewport.querySelector(selector),
    all: (selector) => viewport.querySelectorAll(selector),
    flush() { const queued = [...frames.values()]; frames.clear(); queued.forEach((callback) => callback()); },
    resize(w, h) { viewport._width = w; viewport._height = h; observers[0]?.callback(); events.get("resize")?.(); },
  };
}

test("audience and stage share AST formatting and safe escaping", async () => {
  const audience = await readFile(new URL("../src/media-window/media.mjs", import.meta.url), "utf8");
  assert.match(audience, /import \{ renderSongSectionHTML \} from "\.\.\/shared\/native-slide-renderer\.min\.mjs"/);
  assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#039;");
  assert.equal(escapeHtml(0), ""); // Deliberately retain audience falsy semantics.
  assert.equal(renderSongSectionHTML(null), "");
  assert.equal(renderSongSectionHTML([]), "");
  assert.match(renderSongSectionHTML([line(""), { type: "spacer" }]), /song-block--spacer/);
  assert.match(renderSongSectionHTML([null, { type: "lyricLine", primary: { segments: {} } }]), /song-block--spacer/);
  assert.equal(songSegmentStyleAttribute({ color: "red;display:none", fontFamily: "bad;<img>", fontWeight: "999", fontStyle: "bad", textDecoration: "blink" }), "");
  assert.equal(songSegmentStyleAttribute({ color: " #abc ", backgroundColor: "rgba(0,0,0,.5)", fontFamily: "'CMG Sans'", fontWeight: 700, fontStyle: "italic", textDecoration: "underline line-through" }),
    "color: #abc; background-color: rgba(0,0,0,.5); font-family: 'CMG Sans'; font-weight: 700; font-style: italic; text-decoration: underline line-through");
  const html = renderSongSegmentHTML({ text: '<img src=x onerror="bad()">', style: { fontFamily: 'A" onmouseover="bad()' } });
  assert.match(html, /&lt;img/);
  assert.match(html, /&quot; onmouseover=&quot;/);
  assert.doesNotMatch(html, /<img|style="[^"]*" onmouseover=/);
});

test("default canvas is contained, centered, scoped and rescaled on ResizeObserver", () => {
  const h = harness({ width: 1000, height: 1000 });
  h.renderer.render({ text: "Text" });
  const slide = h.find(".stage-native-slide");
  assert.equal(h.viewport.classList.contains("stage-native-viewport"), true);
  assert.equal(slide.style.width, "1920px"); assert.equal(slide.style.height, "1080px");
  assert.equal(slide.style.transform, `scale(${1000 / 1920})`);
  assert.equal(slide.style.top, "218.75px"); assert.equal(slide.style.left, "0px");
  assert.equal(h.find("style").textContent, NATIVE_SLIDE_RENDERER_CSS);
  assert.equal(h.observers[0].element, h.viewport);
  h.resize(800, 200);
  assert.equal(slide.style.transform, `scale(${200 / 1080})`);
  assert.ok(Number.parseFloat(slide.style.left) > 0);
  assert.doesNotMatch(NATIVE_SLIDE_RENDERER_CSS, /\d(?:vw|vh)\b/);
  h.renderer.dispose();
});

test("plain/scripture text preserves theme metrics, frame, alignment, reference, attribution and copyright safely", () => {
  const h = harness();
  const message = {
    contentKind: "scripture", bodyText: '<script>bad()</script>\nFor God so loved',
    blocks: [line("Should not replace scripture")], referenceText: "John <3:16>", attributionText: "Version & name", copyrightText: "  © Owner  ",
    fontSize: 64, referenceFontSize: 30, fontFamily: "Test Face", fontWeight: 500, fontStyle: "italic", lineHeight: 1.4,
    color: "#123456", referenceColor: "red", referenceTextShadow: "none", backgroundColor: "#eeeeee",
    textBoxPosition: { left: "12%", top: "13%", width: "70%", height: "65%" }, position: { horizontal: "right", vertical: "bottom" },
    resolvedTheme: { backdrop: { enabled: true, background: { color: "#222" }, opacity: 0.6, cornerRadius: 9, paddingPx: { x: 25, y: 12 } } },
  };
  h.renderer.render(message);
  const content = h.find(".stage-native-slide__content"), box = h.find(".scripture-render__box"), body = h.find(".scripture-render__body");
  assert.equal(body.textContent, message.bodyText); assert.equal(body.htmlWrites, 0);
  assert.equal(content.style.fontFamily, "Test Face"); assert.equal(content.style.fontWeight, 500);
  assert.equal(content.style.fontStyle, "italic"); assert.equal(content.style.lineHeight, "1.4"); assert.equal(content.style.color, "#123456");
  assert.equal(content.style.textAlign, "right"); assert.equal(content.style.justifyContent, "flex-end"); assert.equal(content.style.alignItems, "flex-end");
  assert.equal(box.style.left, "12%"); assert.equal(box.style.top, "13%"); assert.equal(box.style.width, "70%"); assert.equal(box.style.height, "65%");
  assert.equal(box.style.backgroundColor, "#222"); assert.equal(box.style.opacity, "0.6"); assert.equal(box.style.borderRadius, "9px"); assert.equal(box.style.padding, "12px 25px");
  assert.equal(h.find(".scripture-render__reference").textContent, "John <3:16>");
  assert.equal(h.find(".scripture-render__reference").style.color, "red");
  assert.equal(h.find(".scripture-render__attribution").textContent, "Version & name");
  assert.equal(h.find(".stage-native-slide__copyright").textContent, "© Owner");
  h.renderer.render({ text: "Plain", backgroundColor: "white", position: { horizontal: "left", vertical: "top" } });
  assert.equal(h.find(".scripture-render__body").textContent, "Plain");
  assert.equal(h.find(".scripture-render__reference").hidden, true);
  assert.equal(h.find(".scripture-render__attribution").hidden, true);
  assert.equal(h.find(".stage-native-slide__copyright").hidden, true);
  assert.equal(h.find(".scripture-render__box").style.backgroundColor, undefined);
  assert.equal(content.style.justifyContent, "flex-start"); assert.equal(content.style.alignItems, "flex-start");
  h.renderer.dispose();
});

test("background images and backgroundPath fallback are CSS values, never HTML", () => {
  const h = harness();
  for (const field of ["backgroundImage", "backgroundPath"]) {
    const path = `file:///image's \"name\".jpg`;
    h.renderer.render({ text: field, [field]: path, backgroundColor: "navy" });
    assert.equal(h.find(".stage-native-slide__background").style.backgroundImage, `url(${JSON.stringify(path)})`);
    assert.equal(h.find(".stage-native-slide__background").style.backgroundColor, "navy");
    assert.equal(h.all("video").length, 0);
  }
  h.renderer.render({ text: "Clear image" });
  assert.equal(h.find(".stage-native-slide__background").style.backgroundImage, "");
  h.renderer.dispose();
});

test("resolved song blocks use only escaped AST HTML and retain inline segment styles", () => {
  const h = harness();
  const blocks = [line('<svg onload="bad()"> & Lyrics', { color: "yellow", fontWeight: "bold" }), { type: "spacer" }];
  h.renderer.render({ contentKind: "song", blocks, bodyText: "fallback" });
  const body = h.find(".scripture-render__body");
  assert.equal(body.innerHTML, renderSongSectionHTML(blocks));
  assert.match(body.innerHTML, /style="color: yellow; font-weight: bold"/);
  assert.doesNotMatch(body.innerHTML, /<svg/);
  assert.deepEqual(h.elements.filter((el) => el.htmlWrites), [body]);
  h.renderer.dispose();
});

test("shared rich objects retain audience defaults, stable z order, opacity, image and shape semantics", () => {
  const h = harness();
  h.renderer.render({ slideObjects: [
    { kind: "text", zIndex: 2, opacity: 2, blocks: [line("Top")], align: "right", verticalAlign: "bottom", color: "pink", fontFamily: "Object Face", fontWeight: 900, fontStyle: "italic", textDecoration: "underline", lineHeight: 1.5, fontSize: 48, minFontSize: 24, autofit: "none", textBoxPosition: { left: "5%", top: "6%", width: "50%", height: "40%" } },
    { kind: "image", zIndex: -1, opacity: -1, image: { imageUrl: "file:///photo.png", fit: "cover" } },
    { kind: "shape", shape: { type: "ellipse", fill: "red", stroke: "blue", strokeWidth: 3 } },
    { kind: "shape", shape: { type: "line", fill: "yellow" } },
    { kind: "shape", shape: { radius: 5 } },
    null,
  ] });
  const boxes = h.all(".slide-output-object");
  assert.equal(boxes.length, 5);
  assert.deepEqual(boxes.map((el) => el.style.zIndex), ["-1", "0", "0", "0", "2"]);
  assert.equal(boxes[0].style.opacity, "0"); assert.equal(boxes[4].style.opacity, "1");
  assert.equal(boxes[0].style.left, "10%"); assert.equal(boxes[0].style.top, "10%"); assert.equal(boxes[0].style.width, "80%"); assert.equal(boxes[0].style.height, "80%");
  const image = h.find(".slide-output-object__image");
  assert.equal(image.src, "file:///photo.png"); assert.equal(image.alt, ""); assert.equal(image.draggable, false); assert.equal(image.style.objectFit, "cover");
  const shapes = h.all(".slide-output-object__shape");
  assert.equal(shapes[0].style.borderRadius, "999px"); assert.equal(shapes[0].style.border, "3px solid blue");
  assert.equal(shapes[1].style.borderTop, "4px solid yellow"); assert.equal(shapes[1].style.backgroundColor, "transparent");
  assert.equal(shapes[2].style.borderRadius, "5px"); assert.equal(shapes[2].style.backgroundColor, "#ffffff");
  const body = h.find(".slide-text-output-object__body");
  assert.equal(body.style.fontFamily, "Object Face"); assert.equal(body.style.fontWeight, 900); assert.equal(body.style.color, "pink");
  assert.equal(body.style.fontStyle, "italic"); assert.equal(body.style.textDecoration, "underline"); assert.equal(body.style.lineHeight, "1.5");
  assert.equal(body.dataset.fitBaseSize, "48"); assert.equal(body.dataset.fitMinSize, "24"); assert.equal(body.dataset.fitMode, "none");
  assert.equal(body.parentElement.style.textAlign, "right"); assert.equal(body.parentElement.style.justifyContent, "flex-end");
  h.renderer.render({ slideTextObjects: [{ blocks: [line("Legacy object")] }] });
  assert.equal(h.find(".slide-text-output-object__body").style.fontFamily, "'CMG Sans'");
  assert.equal(h.find(".slide-text-output-object__body").style.fontWeight, 700);
  assert.equal(h.find(".slide-text-output-object__body").style.lineHeight, "1.32");
  h.renderer.dispose();
});

test("object image URL aliases and fitting fallbacks match the audience", () => {
  const h = harness(), content = h.document.createElement("div");
  h.viewport.appendChild(content);
  for (const key of ["url", "src"]) {
    renderSlideObjects(content, [{ kind: "image", image: { [key]: "image.png", fit: "invalid" } }]);
    assert.equal(content.querySelector("img").src, "image.png");
    assert.equal(content.querySelector("img").style.objectFit, "contain");
  }
  renderSlideObjects(content, [{ kind: "image", image: { src: "stretch.png", fit: "fill" } }]);
  assert.equal(content.querySelector("img").style.objectFit, "fill");
  renderSlideObjects(content, [{ kind: "shape", shape: { type: "line", stroke: "black", strokeWidth: 2 } }]);
  assert.equal(content.querySelector(".slide-output-object__shape").style.borderTop, "2px solid black");
  h.renderer.dispose();
});

test("object backgrounds match color/image/video/path precedence and always silence videos", () => {
  const h = harness();
  const backgrounds = [
    { type: "color", color: "green", backgroundVideo: "ignored.mp4" },
    { backgroundImage: "image.png" },
    { path: "/folder/image.png", type: "image" },
    { path: "https://example.test/image.png" },
    { backgroundVideo: "clip.mp4", backgroundImage: "ignored.png" },
    { path: "/folder/clip.mp4", type: "video" },
  ];
  h.renderer.render({ slideObjects: backgrounds.map((background) => ({ blocks: [line("Object")], background })) });
  const layers = h.all(".slide-text-output-object__background");
  assert.equal(layers[0].style.backgroundColor, "green");
  assert.equal(layers[1].style.backgroundImage, 'url("image.png")');
  assert.equal(layers[2].style.backgroundImage, 'url("file:///folder/image.png")');
  assert.equal(layers[3].style.backgroundImage, 'url("https://example.test/image.png")');
  const videos = h.all("video");
  assert.deepEqual(videos.map((el) => el.src), ["clip.mp4", "file:///folder/clip.mp4"]);
  for (const video of videos) {
    assert.equal(video.muted, true); assert.equal(video.defaultMuted, true); assert.equal(video.volume, 0);
    assert.equal(video.loop, true); assert.equal(video.playsInline, true); assert.equal(video.playCalls, 1);
  }
  h.renderer.clear();
  for (const video of videos) { assert.equal(video.paused, true); assert.equal(video.src, ""); assert.equal(video.loadCalls, 2); }
  const box = h.document.createElement("div");
  renderSlideTextObjectBackground(box, {});
  assert.equal(box.children.length, 0);
  h.renderer.dispose();
});

test("identical renders and unrelated overlay/clock fields retain all DOM and video state", () => {
  const h = harness();
  const message = { text: "Song", backgroundVideo: "background.mp4", backgroundVideoSync: { currentTime: 12, playing: true }, slideObjects: [{ blocks: [line("Object")], background: { backgroundVideo: "object.mp4" } }] };
  h.renderer.render(message);
  const videos = h.all("video"), body = h.find(".slide-text-output-object__body");
  const count = h.elements.length;
  for (let i = 0; i < 10; i++) h.renderer.render({ ...structuredClone(message), clock: i, overlay: { text: String(i) } });
  assert.equal(h.elements.length, count);
  assert.equal(h.find(".slide-text-output-object__body"), body);
  assert.deepEqual(h.all("video"), videos);
  for (const video of videos) { assert.equal(video.playCalls, 1); assert.equal(video.srcWrites, 1); assert.equal(video.loadCalls, 1); }
  h.renderer.render({ ...message, backgroundVideoSync: { targetTime: 42, playing: false } });
  assert.equal(h.find(".slide-text-output-object__body"), body);
  assert.equal(videos[0].currentTime, 42); assert.equal(videos[0].paused, true);
  assert.equal(videos[1].paused, false); assert.equal(videos[1].playCalls, 1);
  h.renderer.render({ ...message, backgroundVideoSync: { currentTime: 50, playing: true } });
  assert.equal(videos[0].currentTime, 50); assert.equal(videos[0].playCalls, 2);
  assert.equal(h.elements.length, count);
  h.renderer.dispose();
});

test("paused snapshots and explicit targets retry exact positions on metadata", () => {
  const h = harness();
  h.renderer.render({ backgroundVideo: "clip.mp4", backgroundVideoSync: { currentTime: 8, capturedAt: 0, playing: false } });
  const video = h.find("video");
  assert.equal(video.currentTime, 8); assert.equal(video.playCalls, 0); assert.equal(video.autoplay, false);
  video.duration = 10;
  h.renderer.render({ backgroundVideo: "clip.mp4", backgroundVideoSync: { currentTime: 4, targetTime: 17, playing: false } });
  video.currentTime = 0; video.dispatch("loadedmetadata");
  assert.equal(video.currentTime, 7); assert.equal(video.playCalls, 0);
  h.renderer.render({ backgroundVideo: "clip.mp4", backgroundVideoSync: { currentTime: -5, paused: true } });
  assert.equal(video.currentTime, 0);
  h.renderer.render({ backgroundVideo: "clip.mp4", backgroundVideoSync: { currentTime: 9, playing: true } });
  assert.equal(video.playCalls, 1); assert.equal(video.muted, true); assert.equal(video.volume, 0);
  h.renderer.dispose();
});

test("timestamped native backgrounds match audience elapsed time on bootstrap and deferred metadata", (t) => {
  let now = 12000;
  t.mock.method(Date, "now", () => now);
  const h = harness();
  h.renderer.render({ backgroundVideo: "clip.mp4", backgroundVideoSync: { currentTime: 8, capturedAt: 10000 } });
  const video = h.find("video");
  assert.ok(Math.abs(video.currentTime - 10.15) < 0.00001);
  video.duration = 10;
  now = 15000;
  video.dispatch("loadedmetadata");
  assert.ok(Math.abs(video.currentTime - 3.15) < 0.00001);
  h.renderer.render({ backgroundVideo: "clip.mp4", backgroundVideoSync: { currentTime: 4, capturedAt: now + 1000 } });
  assert.ok(Math.abs(video.currentTime - 4.15) < 0.00001, "future timestamps never subtract playback time");
  h.renderer.render({ backgroundVideo: "clip.mp4", backgroundVideoSync: { currentTime: 4, targetTime: 7, capturedAt: 0, playing: true } });
  assert.equal(video.currentTime, 7, "explicit target is already resolved");
  h.renderer.render({ backgroundVideo: "clip.mp4", backgroundVideoSync: { currentTime: 2, capturedAt: 0, playing: false } });
  assert.equal(video.currentTime, 2);
  h.renderer.dispose();
});

test("video play failures are bounded and pending play cannot resurrect cleared or paused sources", async () => {
  const h = harness();
  h.document.playResult = () => Promise.reject(new Error("Autoplay denied"));
  h.renderer.render({ backgroundVideo: "denied.mp4" });
  const denied = h.find("video");
  await settle();
  for (let i = 0; i < 5; i++) h.renderer.render({ backgroundVideo: "denied.mp4" });
  assert.equal(denied.playCalls, 1);
  const pending = deferred(); h.document.playResult = () => pending.promise;
  h.renderer.render({ backgroundVideo: "pending.mp4" });
  const old = h.find("video");
  h.renderer.render({ backgroundVideo: "pending.mp4", backgroundVideoSync: { playing: false } });
  assert.equal(old.paused, true);
  h.renderer.clear(); pending.resolve(); await settle();
  assert.equal(old.paused, true); assert.equal(old.src, ""); assert.equal(old.listeners.get("loadedmetadata").size, 0);
  old.dispatch("loadedmetadata"); assert.equal(old.playCalls, 1);
  h.document.playResult = () => { throw new Error("Synchronous failure"); };
  assert.doesNotThrow(() => h.renderer.render({ backgroundVideo: "throws.mp4" }));
  h.renderer.dispose();
});

test("render changes, clear and disposal stop and unload background and object videos", () => {
  const h = harness();
  const message = { backgroundVideo: "background.mp4", slideObjects: [{ blocks: [line("Text")], background: { type: "video", path: "/object.mp4" } }] };
  h.renderer.render(message);
  const old = h.all("video");
  h.renderer.render({ ...message, color: "red" });
  for (const video of old) { assert.equal(video.paused, true); assert.equal(video.src, ""); }
  const next = h.all("video");
  h.renderer.clear();
  for (const video of next) { assert.equal(video.paused, true); assert.equal(video.src, ""); }
  assert.equal(h.find(".stage-native-slide").hidden, true);
  assert.equal(h.find(".stage-native-slide__content").children.length, 0);
  h.renderer.render(message);
  const final = h.all("video");
  h.renderer.dispose(); h.renderer.dispose();
  for (const video of final) { assert.equal(video.paused, true); assert.equal(video.src, ""); }
  assert.equal(h.viewport.children.length, 0); assert.equal(h.observers[0].disconnected, true);
  assert.equal(h.viewport.classList.contains("stage-native-viewport"), false);
  h.renderer.render(message); h.resize(1, 1); h.renderer.clear();
  assert.equal(h.viewport.children.length, 0);
});

test("standalone object helper cleans old videos before rebuilding", () => {
  const h = harness(), parent = h.document.createElement("div");
  const object = { blocks: [line("Text")], background: { backgroundVideo: "object.mp4" } };
  renderSlideObjects(parent, [object]);
  const video = parent.querySelector("video");
  renderSlideObjects(parent, []);
  assert.equal(video.src, ""); assert.equal(video.paused, true);
  h.renderer.dispose();
});

test("font fitting uses actual frame bounds and emergency floor, even with autosize none", () => {
  const h = harness();
  const box = h.document.createElement("div"), body = h.document.createElement("div");
  box._width = 180; box._height = 80; box.appendChild(body); body.textContent = "Many words ".repeat(12);
  fitTextElementToBox(box, body, { baseSize: 80, minSize: 60, mode: "none" });
  assert.ok(Number.parseFloat(body.style.fontSize) < 60);
  assert.ok(Number.parseFloat(body.style.fontSize) >= 8);
  assert.ok(body.scrollHeight <= 81);
  fitTextElementToBox(null, body);
  h.renderer.render({ bodyText: "Text ".repeat(70), referenceText: "John 3:16", attributionText: "Version", fontSize: 100, autosizeMode: "none", textBoxPosition: { left: "0%", top: "0%", width: "30%", height: "25%" } });
  const rendered = h.find(".scripture-render__body");
  assert.ok(Number.parseFloat(rendered.style.fontSize) < 100);
  assert.ok(Number.parseFloat(rendered.style.fontSize) >= 8);
  const frame = h.find(".scripture-render__box");
  assert.ok(frame.children.reduce((sum, el) => sum + el.scrollHeight, 44) <= frame.clientHeight + 1);
  fitFullscreenScriptureRender(null);
  h.renderer.dispose();
});

test("resize and font-ready refreshes refit without rebuilding or stale asynchronous work", async () => {
  const h = harness();
  h.renderer.render({ slideObjects: [{ blocks: [line("Fitting words ".repeat(60))], fontSize: 100 }] });
  const body = h.find(".slide-text-output-object__body"), before = h.elements.length;
  body.style.fontSize = "1px";
  h.resize(320, 240);
  assert.ok(Number.parseFloat(body.style.fontSize) > 1);
  assert.equal(h.elements.length, before);
  h.fontReady.resolve(); await settle(); h.flush();
  assert.equal(h.find(".slide-text-output-object__body"), body);
  const stale = [...h.frames.values()];
  h.renderer.clear();
  stale.forEach((callback) => callback()); h.observers[0].callback();
  assert.equal(h.find(".stage-native-slide").hidden, true);
  h.renderer.render({ text: "New" });
  h.renderer.dispose(); h.flush(); h.observers[0].callback();
  assert.equal(h.viewport.children.length, 0);
});

test("a late fonts-ready promise cannot schedule work after clear or dispose", async () => {
  for (const action of ["clear", "dispose"]) {
    const h = harness();
    h.renderer.render({ text: "Old" });
    const stale = [...h.frames.values()];
    h.renderer[action]();
    h.fontReady.resolve(); await settle();
    stale.forEach((callback) => callback());
    assert.equal(h.frames.size, 0);
    assert.equal(h.find(".scripture-render__body"), null);
    h.renderer.dispose();
  }
});

test("outputSize, custom defaults, zero-size viewports and browser API fallbacks", () => {
  const h = harness({ observer: false, raf: false, fonts: false });
  h.renderer.render({ text: "4:3", outputSize: { width: 1024, height: 768 } });
  assert.equal(h.find(".stage-native-slide").style.width, "1024px");
  assert.equal(h.find(".stage-native-slide").style.height, "768px");
  h.resize(0, 0);
  assert.equal(h.find(".stage-native-slide").style.transform, "scale(0)");
  h.resize(900, 600);
  h.renderer.dispose(); assert.equal(h.events.size, 0);
  h.viewport.classList.add("stage-native-viewport");
  const renderer = createNativeSlideRenderer({ viewport: h.viewport, width: 1280, height: 720 });
  renderer.render({ text: "Defaults", outputSize: { width: -1, height: "invalid" } });
  assert.equal(h.find(".stage-native-slide").style.width, "1280px");
  assert.equal(h.find(".stage-native-slide").style.height, "720px");
  renderer.render(null); assert.equal(h.find(".stage-native-slide").hidden, true);
  renderer.dispose(); assert.equal(h.viewport.classList.contains("stage-native-viewport"), true);
  assert.throws(() => createNativeSlideRenderer(), /viewport/);
});

test("accepts resolved wrappers/presentations without repagination and honors audience output dimensions", () => {
  const h = harness();
  h.renderer.render({ message: { blocks: [line("Wrapped")], bodyText: "Wrapped" }, target: { outputSize: { width: 1600, height: 900 } } });
  assert.match(h.find(".scripture-render__body").innerHTML, /Wrapped/);
  assert.equal(h.find(".stage-native-slide").style.width, "1600px");
  h.renderer.render({ presentation: {
    schema: "ems.song.v1", contentKind: "song", target: { outputRole: "audience", outputSize: { width: 1280, height: 800 } },
    activeSlide: { slideId: "slide", bodyText: "Resolved", blocks: [line("Resolved")], layout: { resolvedFontSize: 56, measurementMode: "dom" } },
  } });
  assert.match(h.find(".scripture-render__body").innerHTML, /Resolved/);
  assert.equal(h.find(".scripture-render__body").style.fontSize, "56px");
  assert.equal(h.find(".stage-native-slide").style.height, "800px");
  h.renderer.dispose();
});

test("raw EMS song and native slideDeck ASTs use existing shared resolvers", () => {
  const h = harness();
  const song = { schema: "ems.song.v1", id: "song", title: "Song", sections: [{ id: "verse", kind: "verse", blocks: [line("Song AST")] }], playOrder: [{ sectionId: "verse", enabled: true }] };
  h.renderer.render(song);
  assert.match(h.find(".scripture-render__body").innerHTML, /Song AST/);
  const deck = { schema: "ems.slideDeck.v1", id: "deck", title: "Deck", canvas: { width: 1920, height: 1080 }, pages: [
    { id: "page", objects: [{ id: "object", kind: "text", frame: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 }, blocks: [line("Native AST")] }] },
  ] };
  h.renderer.render(deck);
  assert.match(h.find(".slide-text-output-object__body").innerHTML, /Native AST/);
  assert.equal(h.find(".slide-output-object").style.left, "10%");
  assert.equal(h.find(".slide-output-object").style.top, "20%");
  h.renderer.dispose();
});

test("metadata retries a failed pre-metadata seek and never restores an obsolete snapshot", () => {
  const h = harness();
  const create = h.document.createElement;
  let time = 0, ready = false;
  h.document.createElement = (tag) => {
    const el = create(tag);
    if (tag === "video") Object.defineProperty(el, "currentTime", {
      get: () => time,
      set(value) { if (!ready) throw new Error("No metadata yet"); time = value; },
    });
    // Loading is observable but need not reset a not-yet-seekable test element.
    if (tag === "video") el.load = () => { el.loadCalls++; };
    return el;
  };
  assert.doesNotThrow(() => h.renderer.render({ backgroundVideo: "clip.mp4", backgroundVideoSync: { currentTime: 3, playing: false } }));
  const video = h.find("video");
  h.renderer.render({ backgroundVideo: "clip.mp4", backgroundVideoSync: { targetTime: 11, playing: false } });
  ready = true; video.dispatch("loadedmetadata");
  assert.equal(time, 11); assert.equal(video.playCalls, 0);
  h.renderer.dispose();
});

test("old animation/font callbacks cannot refit a newer render; key order does not defeat dedup", async () => {
  const h = harness();
  h.renderer.render({ text: "Old", fontSize: 50 });
  const stale = [...h.frames.values()];
  h.renderer.render({ text: "New", fontSize: 70, position: { horizontal: "left", vertical: "top" } });
  const body = h.find(".scripture-render__body");
  body.style.fontSize = "71px";
  stale.forEach((callback) => callback());
  assert.equal(body.style.fontSize, "71px");
  h.renderer.render({ position: { vertical: "top", horizontal: "left" }, fontSize: 70, text: "New" });
  assert.equal(h.find(".scripture-render__body"), body);
  assert.equal(body.style.fontSize, "71px");
  h.fontReady.resolve(); await settle(); h.flush();
  assert.equal(body.style.fontSize, "70px");
  h.renderer.dispose();
});

test("disabled/default backdrops, reference contrast and wrapper theme/outputSize fallbacks", () => {
  const h = harness();
  h.renderer.render({ message: { text: "Text", referenceText: "Reference" }, outputSize: { width: 1440, height: 900 }, resolvedTheme: { backdrop: { enabled: true } } });
  assert.equal(h.find(".scripture-render__box").style.backgroundColor, "#101010");
  assert.equal(h.find(".scripture-render__box").style.opacity, "1");
  assert.equal(h.find(".stage-native-slide").style.width, "1440px");
  h.renderer.render({ text: "Text", referenceText: "Ref", backgroundColor: "#ffffff", resolvedTheme: { backdrop: { enabled: false, background: { color: "red" } } } });
  assert.equal(h.find(".scripture-render__box").style.backgroundColor, undefined);
  assert.equal(h.find(".scripture-render__reference").style.color, "rgba(24, 24, 28, 0.84)");
  h.renderer.render({ text: "Text", referenceText: "Ref", backgroundColor: "#ffffff", backgroundImage: "image.png" });
  assert.equal(h.find(".scripture-render__reference").style.color, "rgba(255, 255, 255, 0.78)");
  h.renderer.dispose();
});