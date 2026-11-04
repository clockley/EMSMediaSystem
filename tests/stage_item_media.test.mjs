import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { stageContentFromPresentation } from "../src/shared/stage-content.mjs";
import { renderPptxSlideThumbnail } from "../src/shared/app-pptx-thumbnail.mjs";
import {
  sanitizeStageContentPayload,
  stageDeckKey,
} from "../src/main-process/stage-item-media.mjs";

const [
  html,
  renderer,
  preload,
  main,
  css,
  liveOutputs,
  previewController,
  mediaLibrary,
  projectSession,
  operatorChrome,
  mediaWindow,
] = await Promise.all([
  readFile(new URL("../src/stage-window/stage.html", import.meta.url), "utf8"),
  readFile(new URL("../src/stage-window/stage.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/stage-window/stage_preload.js", import.meta.url), "utf8"),
  readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/main.css", import.meta.url), "utf8"),
  readFile(new URL("../src/control-window/app-live-outputs.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/control-window/app-preview-controller.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/control-window/app-project-session.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/control-window/app-operator-chrome.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/media-window/media.mjs", import.meta.url), "utf8"),
]);

test("stage content identifies a next schedule cue separately from a next slide", () => {
  const cue = stageContentFromPresentation(
    { bodyText: "Only slide", slides: [{ bodyText: "Only slide" }], activeIndex: 0 },
    { type: "song", nextItemText: "Welcome video" },
  );
  assert.equal(cue.next, "Welcome video");
  assert.equal(cue.nextIsItem, true);

  const slide = stageContentFromPresentation(
    {
      bodyText: "Verse one",
      resolvedPresentation: {
        navigation: { activeSlideId: "one", nextSlideId: "two" },
        slides: [
          { slideId: "one", bodyText: "Verse one" },
          { slideId: "two", bodyText: "Verse two" },
        ],
      },
    },
    { type: "song", nextItemText: "Welcome video" },
  );
  assert.equal(slide.next, "Verse two");
  assert.equal(slide.nextIsItem, false);
});

test("main strips paths and non-file thumbnails from stage media descriptors", () => {
  const unsafe = sanitizeStageContentPayload({
    currentMedia: { kind: "audio", name: "Song.mp3", sourcePath: "/secret/song.mp3" },
    nextMedia: {
      kind: "image",
      name: "Still.jpg",
      sourcePath: "/secret/still.jpg",
      thumbnailUrl: "https://example.test/still.jpg",
    },
    nextIsItem: 1,
  }, (value) => value);
  assert.deepEqual(unsafe.payload.currentMedia, { kind: "audio", name: "Song.mp3" });
  assert.deepEqual(unsafe.payload.nextMedia, { kind: "image", name: "Still.jpg" });
  assert.equal(unsafe.payload.nextIsItem, false);
  assert.equal("sourcePath" in unsafe.payload.nextMedia, false);

  const safe = sanitizeStageContentPayload({
    nextMedia: {
      kind: "video",
      name: "Clip.mp4",
      thumbnailUrl: "file:///tmp/clip.jpg?v=1",
    },
  }, (value) => value);
  assert.equal(safe.payload.nextMedia.thumbnailUrl, "file:///tmp/clip.jpg?v=1");
});

test("PowerPoint descriptors establish one opaque deck allow-list key", () => {
  const localPath = "/srv/media/Service.pptx";
  const result = sanitizeStageContentPayload({
    nextMedia: {
      kind: "pptx",
      name: "Service.pptx",
      revision: "rev-2",
      slideIndex: 4,
      sourcePath: localPath,
    },
    nextIsItem: true,
  }, (value) => value);
  assert.equal(result.pptxPath, localPath);
  assert.equal(result.deckKey, stageDeckKey(localPath, "rev-2"));
  assert.deepEqual(result.payload.nextMedia, {
    kind: "pptx",
    name: "Service.pptx",
    revision: "rev-2",
    slideIndex: 4,
    deckKey: result.deckKey,
  });

  const rejected = sanitizeStageContentPayload({
    nextMedia: { kind: "pptx", name: "Notes", sourcePath: "/srv/media/notes.txt" },
  }, (value) => value);
  assert.equal(rejected.pptxPath, "");
  assert.equal(rejected.payload.nextMedia.deckKey, undefined);

  const invalidSlide = sanitizeStageContentPayload({
    nextMedia: {
      kind: "pptx",
      name: "Service.pptx",
      slideIndex: 10000,
      sourcePath: localPath,
    },
  }, (value) => value);
  assert.equal(invalidSlide.payload.nextMedia.slideIndex, undefined);
});

test("shared PowerPoint thumbnail renderer uses the requested slide and disposes once", async () => {
  const previousDocument = globalThis.document;
  let requestedSlide = -1;
  let handleDisposals = 0;
  let viewerDisposals = 0;
  let hostRemovals = 0;
  const host = {
    className: "",
    setAttribute() {},
    remove() { hostRemovals += 1; },
  };
  globalThis.document = {
    createElement: () => host,
    body: { appendChild() {} },
  };
  try {
    const rendered = await renderPptxSlideThumbnail({
      renderer: {
        RECOMMENDED_ZIP_LIMITS: {},
        PptxViewer: {
          async open() {
            return {
              renderThumbnailToContainer(slideIndex) {
                requestedSlide = slideIndex;
                return {
                  element: { querySelectorAll: () => [] },
                  ready: Promise.resolve(),
                  dispose() { handleDisposals += 1; },
                };
              },
              destroy() { viewerDisposals += 1; },
            };
          },
        },
      },
      arrayBuffer: new ArrayBuffer(8),
      viewport: {},
      slideIndex: 3,
    });
    assert.equal(requestedSlide, 3);
    rendered.dispose();
    rendered.dispose();
    assert.equal(handleDisposals, 1);
    assert.equal(viewerDisposals, 1);
    assert.equal(hostRemovals, 1);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("stage markup and styles provide thumbnail and audio panels", () => {
  assert.match(html, /img-src 'self' file: data: blob:/);
  assert.match(html, /worker-src 'self' blob:/);
  assert.match(html, /id="stageNextMedia"/);
  assert.match(html, /id="stageNextPptx"/);
  assert.match(html, /id="stageCurrentAudio"/);
  assert.match(html, /stage-card__music-note[^>]*>♪</);
  assert.match(css, /data-next-media="pptx"/);
  assert.match(css, /data-current-media="audio"[^}]*stage-card__audience/);
  assert.match(css, /\.stage-media__music-note[^}]*color: #33d17a/);
});

test("stage renderer only accepts file thumbnails and lazily renders PPTX", () => {
  assert.match(renderer, /parsed\.protocol === "file:"/);
  assert.match(renderer, /import\("\.\.\/\.\.\/node_modules\/@aiden0z\/pptx-renderer/);
  assert.match(renderer, /api\.getNextPptx\(media\.deckKey\)/);
  assert.match(renderer, /renderPptxSlideThumbnail\(\{/);
  assert.match(renderer, /slideIndex,/);
  assert.match(renderer, /const media = content\.nextMedia \|\| null/);
  assert.match(renderer, /nextPptxRetryAt = Date\.now\(\) \+ 2000/);
  assert.match(renderer, /currentKind === "audio"/);
  assert.match(preload, /ipcRenderer\.invoke\("stage-next-pptx"/);
});

test("control and main wire schedule thumbnails through guarded IPC", () => {
  assert.match(liveOutputs, /invoke\("stage-item-thumbnail", \{ kind, path: filePath, revision \}\)/);
  assert.match(liveOutputs, /kind === "image" \|\| kind === "video"/);
  assert.match(main, /assertControlSender\(event\);\s+if \(request\?\.kind !== "video" && request\?\.kind !== "image"\)/);
  assert.match(main, /nativeImage\.createFromPath\(localPath\)/);
  assert.match(main, /source\.resize\(\{ width: 640, quality: "good" \}\)/);
  assert.match(main, /STAGE_IMAGE_THUMBNAIL_CACHE_LIMIT = 200/);
  assert.match(main, /rm\(entry\.filePath, \{ force: true \}\)/);
  assert.match(main, /event\.sender !== stageWindow\.webContents/);
  assert.match(main, /deckKey !== stageNextPptxKey/);
  assert.match(main, /STAGE_IMAGE_THUMBNAIL_CACHE_LIMIT/);
  assert.match(main, /await pruneStageThumbnailCache\(outputDir, output\)/);
});

test("live PowerPoint sends the following rendered slide, then the next cue", () => {
  assert.match(previewController, /const nextIsItem = !hasNextSlide && Boolean\(nextItemText\)/);
  assert.match(previewController, /nextPptxSlideIndex: hasNextSlide \? slideIndex \+ 1 : null/);
  assert.match(previewController, /currentMediaSourcePath: activeResolvedMediaFile \|\| livePptxPath/);
  assert.match(liveOutputs, /pptxSlideIndex: nextPptxSlideIndex,/);
  assert.match(liveOutputs, /nextMedia: stageContentCache\.nextMedia \|\| null/);
});

test("stage media previews resolve pinned snapshots before reading files", () => {
  assert.match(liveOutputs, /liveSource\?\.strategy !== "snapshot"/);
  assert.match(liveOutputs, /resolveQueueItemMediaPath\(item\)/);
  assert.match(liveOutputs, /const stageResolvedMediaPaths = new WeakMap\(\)/);
});

test("project changes clear stale stage content before auto-start", () => {
  const reset = projectSession.indexOf("await resetStageContentForProjectChange(nextStageProfile)");
  const activate = projectSession.indexOf("currentProjectPath = nextProjectPath", reset);
  assert.ok(reset >= 0 && activate > reset);
  assert.match(liveOutputs, /async function resetStageContentForProjectChange\(profile = "current-next"\)/);
  assert.match(liveOutputs, /await sendStageLayer\("widgets", \{\}, "layer\.clear"\)/);
  assert.match(liveOutputs, /current: "Waiting for live content"/);
  assert.match(liveOutputs, /notes: ""/);
});

test("stage countdown ticks are finite and carry cue identity every time", () => {
  assert.match(mediaWindow, /sendTimeRemainingTick\(duration, playbackTime, timestamp, mediaFile\)/);
  assert.doesNotMatch(mediaWindow, /sendTimeRemainingTick\(duration, playbackTime, timestamp\);/);
  assert.match(operatorChrome, /if \(!mediaPath \|\| !mediaPathMatchesCurrentLiveMedia\(mediaPath\)\) return/);
  assert.match(operatorChrome, /!Number\.isFinite\(duration\)/);
  assert.match(operatorChrome, /!Number\.isFinite\(currentTime\)/);
});

test("media-library PowerPoint cards use the shared first-slide helper", () => {
  assert.match(mediaLibrary, /renderPptxFirstSlideThumbnail\(\{/);
});
