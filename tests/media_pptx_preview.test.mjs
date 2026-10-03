import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getPptxContainLayout } from "../src/shared/app-pptx-utils.mjs";

function functionSource(source, name, nextName) {
  const starts = [
    source.indexOf(`function ${name}(`),
    source.indexOf(`async function ${name}(`),
  ].filter((index) => index >= 0);
  const start = starts.length > 0 ? Math.min(...starts) : -1;
  const ends = [
    source.indexOf(`\nfunction ${nextName}(`, start + 1),
    source.indexOf(`\nasync function ${nextName}(`, start + 1),
  ].filter((index) => index >= 0);
  const end = ends.length > 0 ? Math.min(...ends) : -1;
  assert.ok(start >= 0 && end > start, `${name} should exist`);
  return source.slice(start, end);
}

test("scheduled PowerPoint preview shows every slide in a selectable navigator", async () => {
  const [source, css, renderer] = await Promise.all([
    readFile(new URL("../src/control-window/app-preview-controller.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main.css", import.meta.url), "utf8"),
    readFile(new URL("../src/control-window/app-renderer.mjs", import.meta.url), "utf8"),
  ]);
  const shell = functionSource(source, "ensurePptxPreviewShell", "updatePptxNavigatorSelection");
  const navigatorStart = source.indexOf("function buildPptxNavigator(");
  const navigatorEnd = source.indexOf("\nasync function showPptxSlide(", navigatorStart);
  assert.ok(navigatorStart >= 0 && navigatorEnd > navigatorStart, "buildPptxNavigator should exist");
  const navigator = source.slice(navigatorStart, navigatorEnd);
  const layout = functionSource(source, "layoutPptxSlideStage", "relayoutVisiblePptxThumbnails");
  assert.match(shell, /pptxSlideNavigator/);
  assert.match(shell, /pptxThumbnailList/);
  assert.match(shell, /bindPptxSidebarResize/);
  assert.match(shell, /songs-workspace__nav-header/);
  assert.match(shell, /songs-workspace__heading/);
  assert.match(shell, /song-slide-navigator/);
  assert.match(shell, /song-slide-thumbnail-list/);
  assert.match(navigator, /for \(let i = 0; i < pptxSlideCount; i\+\+\)/);
  assert.match(navigator, /pptx-thumbnail-button/);
  assert.match(navigator, /song-slide-thumbnail-button/);
  assert.match(navigator, /song-slide-thumbnail-button__number/);
  assert.match(navigator, /song-slide-thumbnail-button__viewport/);
  assert.match(navigator, /song-slide-thumbnail-button__thumb/);
  assert.doesNotMatch(navigator, /slides-page-list__label|Slide \$\{i \+ 1\}/);
  assert.match(navigator, /jumpToPptxSlide\(i\)/);
  assert.match(navigator, /IntersectionObserver/);
  assert.match(source, /renderSlideToContainer\(index, stage, 1\)/);
  assert.match(source, /layoutPptxSlideStage\(stage, slideEl, viewport/);
  assert.match(layout, /applyPptxThumbnailAspectRatio/);
  assert.match(source, /matchContainerAspectRatio:\s*true/);
  assert.match(source, /relayoutVisiblePptxThumbnails\(\)/);
  assert.doesNotMatch(source, /renderThumbnailToContainer\(index, viewport/);
  assert.match(css, /#pptxPreviewContainer\s*\{[^}]*--pptx-sidebar-width:\s*320px/s);
  assert.doesNotMatch(css, /#pptxSlideNavigator\s*\{[^}]*width:\s*112px/s);
  assert.match(renderer, /const PPTX_SIDEBAR_DEFAULT_WIDTH = 320/);
  assert.match(renderer, /const PPTX_SIDEBAR_MIN_WIDTH = 220/);
  assert.match(renderer, /const PPTX_SIDEBAR_MAX_WIDTH = 560/);
});

test("scheduled PowerPoint preview releases external renderer handles", async () => {
  const source = await readFile(
    new URL("../src/control-window/app-preview-controller.mjs", import.meta.url),
    "utf8",
  );
  const cleanup = functionSource(source, "disposePptxRenderResources", "createPptxViewerHost");
  const cleanupSlide = cleanup.indexOf("disposePptxPreviewSlide()");
  const cleanupThumbnails = cleanup.indexOf("disposePptxThumbnails()");
  const destroyViewer = cleanup.indexOf("viewer?.destroy?.()");
  assert.ok(cleanupSlide >= 0 && cleanupSlide < destroyViewer);
  assert.ok(cleanupThumbnails >= 0 && cleanupThumbnails < destroyViewer);
  assert.match(source, /pptxThumbnailHandleOwners\.get\(index\) !== button/);
  assert.match(source, /renderToken !== pptxThumbnailRenderToken/);
  assert.match(source, /renderToken !== pptxSlideRenderToken/);
  assert.match(source, /document\.getElementById\("pptxMainSlidePane"\)\?\.replaceChildren\(\)/);
  assert.match(source, /const viewerHost = createPptxViewerHost\(\)/);
  assert.match(source, /disposePptxViewerHost\(viewerHost\)/);
  assert.match(source, /openedViewer = new PptxViewer\(viewerHost, viewerOptions\)/);
  assert.match(cleanup, /pptxOpenAbortController\?\.abort/);

  const layoutRefresh = functionSource(source, "schedulePptxLayoutRefresh", "layoutPptxSlideStage");
  assert.match(layoutRefresh, /schedulePptxLiveRelayout\(\)/);
  assert.doesNotMatch(layoutRefresh, /showPptxSlide|buildPptxNavigator/);
});

test("Media presentation details render PPTX slides without a thumbnail strip", async () => {
  const source = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const loader = source.slice(source.indexOf("async function loadPresentationPreview("), source.indexOf("\nfunction showDetails("));
  const cleanup = functionSource(source, "disposePresentationPreview", "fitPresentationSlide");
  assert.match(loader, /PptxViewer/);
  assert.match(loader, /renderPresentationSlide/);
  assert.match(loader, /Previous slide/);
  assert.match(loader, /Next slide/);
  assert.doesNotMatch(loader, /thumbnail/i);
  assert.ok(cleanup.indexOf("handle?.dispose?.()") < cleanup.indexOf("presentationViewer?.destroy?.()"));
  assert.match(cleanup, /presentation-viewport/);
  assert.match(source, /slideRenderToken !== presentationSlideRenderToken/);
  assert.match(loader, /openingViewer = new PptxViewer\(viewerHost, viewerOptions\)/);
  assert.match(cleanup, /presentationOpenAbortController\?\.abort/);
});

test("PowerPoint contain layout respects both output dimensions", () => {
  assert.deepEqual(getPptxContainLayout(1280, 720, 2560, 1080), {
    scale: 1.5,
    displayWidth: 1920,
    displayHeight: 1080,
  });
  assert.deepEqual(getPptxContainLayout(1280, 720, 1024, 768), {
    scale: 0.8,
    displayWidth: 1024,
    displayHeight: 576,
  });
  assert.equal(getPptxContainLayout(1280, 720, 0, 1080), null);
});

test("audience PowerPoint output applies app-owned contain fitting", async () => {
  const source = await readFile(
    new URL("../src/media-window/media.mjs", import.meta.url),
    "utf8",
  );
  const fit = functionSource(
    source,
    "fitPptxSlidesToMediaCanvas",
    "applyPptxContainPolicyMedia",
  );
  const policy = functionSource(
    source,
    "applyPptxContainPolicyMedia",
    "installPptxIpcHandlers",
  );
  assert.match(fit, /getPptxContainLayout\(/);
  assert.match(fit, /pptxCanvas\?\.clientWidth/);
  assert.match(fit, /pptxCanvas\?\.clientHeight/);
  assert.match(fit, /slide\.style\.transform = `scale\(\$\{layout\.scale\}\)`/);
  assert.match(policy, /viewer\.setFitMode\("none"\)/);
  assert.match(policy, /fitPptxSlidesToMediaCanvas/);
  assert.doesNotMatch(source, /fitMode:\s*"contain"/);
});

test("audience PowerPoint output protects Windows glyph ink from clipping", async () => {
  const source = await readFile(
    new URL("../src/media-window/media.mjs", import.meta.url),
    "utf8",
  );
  const guard = functionSource(
    source,
    "applyPptxTextInkGuard",
    "schedulePptxTextInkGuard",
  );
  const schedule = functionSource(
    source,
    "schedulePptxTextInkGuard",
    "fitPptxSlidesToMediaCanvas",
  );
  const show = functionSource(
    source,
    "showPptxSlideInMediaWindow",
    "applyPptxTextInkGuard",
  );

  assert.match(guard, /textBox\.style\.flexDirection === "column"/);
  assert.match(guard, /textBox\.style\.overflowClipMargin = "8px"/);
  assert.match(guard, /emsPptxTextInkGuard/);
  assert.match(schedule, /document\.fonts\?\.ready/);
  assert.match(show, /schedulePptxTextInkGuard\(pptxCanvas\)/);
});
