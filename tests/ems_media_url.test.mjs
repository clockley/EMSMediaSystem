import assert from "node:assert/strict";
import test from "node:test";

import {
  EMS_MEDIA_URL_PREFIX,
  installEmsMediaCrossOriginPolicy,
  isEmsMediaEligiblePath,
  isEmsMediaUrl,
  isValidEmsMediaAccessToken,
  localPathFromFileUrl,
  parseEmsMediaUrl,
  registeredMediaIdToEmsMediaUrl,
} from "../src/shared/ems-media-url.mjs";
import {
  configureEmsMediaUrls,
  emsMediaUrlsEnabled,
  localPathToFileUrl,
  mediaSourceAsFileUrl,
  mediaSourceAsLocalPath,
  pathToMediaUrl,
} from "../src/shared/app-media-utils.mjs";

const TOKEN = "e0123456789abcdef0123456789abcdef";
const registrations = new Map();

function registerPath(filePath) {
  let mediaId = registrations.get(filePath);
  if (!mediaId) {
    mediaId = `media_id_${String(registrations.size + 1).padStart(16, "0")}`;
    registrations.set(filePath, mediaId);
  }
  const displayName = filePath.split(/[/\\]/).pop();
  return registeredMediaIdToEmsMediaUrl(mediaId, displayName, TOKEN);
}

test("access token validation keeps tokens usable as URL hosts", () => {
  assert.ok(isValidEmsMediaAccessToken(TOKEN));
  assert.equal(isValidEmsMediaAccessToken("0123456789abcdef0"), false, "must not parse as IPv4");
  assert.equal(isValidEmsMediaAccessToken("eShort"), false);
  assert.equal(isValidEmsMediaAccessToken("E0123456789ABCDEF"), false);
  assert.equal(isValidEmsMediaAccessToken("e0123456789abcde/"), false);
  assert.equal(isValidEmsMediaAccessToken(undefined), false);
});

test("eligible paths are local MP4-family files, not URLs", () => {
  assert.ok(isEmsMediaEligiblePath("/home/me/a.mp4"));
  assert.ok(isEmsMediaEligiblePath("C:\\clips\\A.MOV"));
  assert.ok(isEmsMediaEligiblePath("/x/y.m4v"));
  assert.equal(isEmsMediaEligiblePath("/x/y.webm"), false);
  assert.equal(isEmsMediaEligiblePath("/x/y.mp3"), false);
  assert.equal(isEmsMediaEligiblePath("file:///x/y.mp4"), false);
  assert.equal(isEmsMediaEligiblePath("https://example.com/y.mp4"), false);
  assert.equal(isEmsMediaEligiblePath(""), false);
});

test("registered URLs expose only an opaque ID and cosmetic file name", () => {
  const mediaId = "media_id_0123456789abcdef";
  const url = registeredMediaIdToEmsMediaUrl(mediaId, "My Clip #1 100%.mp4", TOKEN);
  assert.ok(url.startsWith(`${EMS_MEDIA_URL_PREFIX}${TOKEN}/${mediaId}/`), url);
  assert.ok(isEmsMediaUrl(url));
  assert.equal(url.includes("/home/me"), false);
  assert.deepEqual(parseEmsMediaUrl(url), {
    token: TOKEN,
    mediaId,
    displayName: "My Clip #1 100%.mp4",
  });
  assert.deepEqual(parseEmsMediaUrl(new URL(url).href), parseEmsMediaUrl(url));
  assert.deepEqual(parseEmsMediaUrl(`${url}?v=123#t=4`), parseEmsMediaUrl(url));
});

test("invalid inputs never produce or parse as ems-media URLs", () => {
  assert.equal(registeredMediaIdToEmsMediaUrl("short", "clip.mp4", TOKEN), "");
  assert.equal(registeredMediaIdToEmsMediaUrl("media_id_0123456789", "clip.mp4", "bad"), "");
  assert.equal(parseEmsMediaUrl("file:///home/me/a.mp4"), null);
  assert.equal(parseEmsMediaUrl(`ems-media://${TOKEN}`), null);
  assert.equal(parseEmsMediaUrl(`ems-media://${TOKEN}/`), null);
  assert.equal(parseEmsMediaUrl(`ems-media://${TOKEN}/media_id_0123456789/%E0%A4%A.mp4`), null, "bad escape");
  assert.equal(parseEmsMediaUrl(`ems-media://${TOKEN}/media_id_0123456789/a%00.mp4`), null, "NUL byte");
  assert.equal(parseEmsMediaUrl(`ems-media://${TOKEN}/media_id_0123456789/a%2Fb.mp4`), null, "encoded slash");
  assert.equal(parseEmsMediaUrl(`EMS-MEDIA://${TOKEN.toUpperCase()}/media_id_0123456789/a.mp4`).token, TOKEN);
});

test("pathToMediaUrl keeps file:// until the opaque registry is configured", () => {
  configureEmsMediaUrls(null);
  try {
    assert.equal(emsMediaUrlsEnabled(), false);
    assert.equal(pathToMediaUrl("/home/me/a b.mp4"), "file:///home/me/a%20b.mp4");
    assert.equal(pathToMediaUrl("file:///home/me/a.mp4"), "file:///home/me/a.mp4");

    assert.equal(configureEmsMediaUrls("not a function"), false);
    assert.equal(pathToMediaUrl("/home/me/a.mp4"), "file:///home/me/a.mp4");

    assert.equal(configureEmsMediaUrls(registerPath), true);
    assert.equal(emsMediaUrlsEnabled(), true);
    assert.equal(pathToMediaUrl("/home/me/a b.mp4"), `${registerPath("/home/me/a b.mp4")}`);
    assert.equal(pathToMediaUrl("C:\\v\\a.MOV", "42"), `${registerPath("C:\\v\\a.MOV")}?v=42`);
    // Other media keeps its existing URL form.
    assert.equal(pathToMediaUrl("/home/me/a.webm"), "file:///home/me/a.webm");
    assert.equal(pathToMediaUrl("/home/me/a.png"), "file:///home/me/a.png");
    assert.equal(pathToMediaUrl("https://example.com/a.mp4"), "https://example.com/a.mp4");
    assert.equal(pathToMediaUrl("file:///home/me/a.mp4"), registerPath("/home/me/a.mp4"));
    const existing = registerPath("/home/me/a.mp4");
    assert.equal(pathToMediaUrl(existing), existing);
  } finally {
    configureEmsMediaUrls(null);
  }
});

test("mediaSourceAsFileUrl gives back the file:// URL an ems-media source replaced", () => {
  configureEmsMediaUrls(registerPath);
  try {
    for (const localPath of ["/home/me/My Clip #1.mp4", "C:\\Users\\me\\a b.mov", "\\\\srv\\share\\c.m4v"]) {
      const emsUrl = pathToMediaUrl(localPath, "7");
      assert.equal(mediaSourceAsFileUrl(emsUrl), `${localPathToFileUrl(localPath)}?v=7`);
      assert.equal(mediaSourceAsFileUrl(new URL(emsUrl).href), `${localPathToFileUrl(localPath)}?v=7`);
    }
    assert.equal(mediaSourceAsFileUrl("file:///x.mp4"), "file:///x.mp4");
    assert.equal(mediaSourceAsFileUrl("https://a/b.mp4"), "https://a/b.mp4");
    assert.equal(mediaSourceAsFileUrl(""), "");
    assert.equal(mediaSourceAsFileUrl(undefined), undefined);
  } finally {
    configureEmsMediaUrls(null);
  }
});

test("mediaSourceAsLocalPath decodes reserved characters and native path forms", () => {
  configureEmsMediaUrls(registerPath);
  try {
    for (const localPath of ["/home/me/a # 100%.mp4", "C:\\Users\\me\\a b.mov", "\\\\srv\\share\\c.m4v"]) {
      const emsUrl = pathToMediaUrl(localPath, "7");
      assert.equal(mediaSourceAsLocalPath(emsUrl), localPath);
      assert.equal(mediaSourceAsLocalPath(localPathToFileUrl(localPath)), localPath.replace(/\\/g, "/"));
    }
    assert.equal(mediaSourceAsLocalPath("https://example.com/a.mp4"), "https://example.com/a.mp4");
    assert.equal(localPathFromFileUrl("file:///home/me/a%23b.mp4?v=1"), "/home/me/a#b.mp4");
  } finally {
    configureEmsMediaUrls(null);
  }
});

/** Minimal DOM stand-in: attributes plus an accessor-backed `src`. */
function fakeDomGlobal() {
  class Element {
    constructor() {
      this.attributes = new Map();
    }
    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    }
    setAttribute(name, value) {
      this.attributes.set(String(name).toLowerCase(), String(value));
    }
    removeAttribute(name) {
      this.attributes.delete(name);
    }
  }
  class HTMLMediaElement extends Element {
    get src() {
      return this.getAttribute("src") ?? "";
    }
    set src(value) {
      Element.prototype.setAttribute.call(this, "src", value);
      this.loads = (this.loads || []).concat({ src: String(value), crossorigin: this.getAttribute("crossorigin") });
    }
  }
  return { Element, HTMLMediaElement };
}

test("ems-media sources load in CORS mode; other sources keep their mode", () => {
  const dom = fakeDomGlobal();
  assert.equal(installEmsMediaCrossOriginPolicy(dom), true);
  assert.equal(installEmsMediaCrossOriginPolicy(dom), false, "installs once");

  const video = new dom.HTMLMediaElement();
  const emsUrl = registerPath("/home/a.mp4");
  video.src = emsUrl;
  assert.deepEqual(video.loads.at(-1), { src: emsUrl, crossorigin: "anonymous" }, "set before the load starts");

  video.src = "file:///home/a.webm";
  assert.equal(video.getAttribute("crossorigin"), null, "policy-added attribute is removed again");

  video.setAttribute("SRC", emsUrl);
  assert.equal(video.getAttribute("crossorigin"), "anonymous");
  video.setAttribute("src", "https://example.com/stream.mp4");
  assert.equal(video.getAttribute("crossorigin"), null);

  // A crossorigin chosen by page code is never touched.
  const owned = new dom.HTMLMediaElement();
  owned.setAttribute("crossorigin", "use-credentials");
  owned.src = emsUrl;
  owned.src = "file:///x.mp4";
  assert.equal(owned.getAttribute("crossorigin"), "use-credentials");
});
