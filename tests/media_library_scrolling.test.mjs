import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Media uses automatic pagination instead of a visible Load More control", async () => {
  const source = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const template = await readFile(new URL("../src/shared/app-ui-templates.mjs", import.meta.url), "utf8");
  assert.match(source, /function maybeLoadMore\(\)/);
  assert.match(source, /addEventListener\("scroll", maybeLoadMore/);
  assert.doesNotMatch(source, /mediaLibraryLoadMore|Load More/);
  assert.doesNotMatch(template, /mediaLibraryLoadMore|Load More/);
});

test("Media cards use Adwaita hover and dropped-item highlighting", async () => {
  const css = await readFile(new URL("../src/main.css", import.meta.url), "utf8");
  assert.match(css, /\.media-library__item:hover\s*\{/);
  assert.match(css, /\.media-library__item:focus-visible\s*\{/);
  assert.match(css, /\.media-library__item\.is-drop-revealed\s*\{/);
});

test("Presentation cards lazily render their first PPTX slide", async () => {
  const source = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function renderPresentationCardThumbnail(");
  const end = source.indexOf("\nfunction observeMediaThumbnail(", start);
  const renderer = source.slice(start, end);
  assert.match(renderer, /PptxViewer\.open/);
  assert.match(renderer, /renderThumbnailToContainer\(0,/);
});

test("external file drops reveal matching items under Added Files", async () => {
  const source = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function revealAddedItems(");
  const end = source.indexOf("\nasync function handlePreviewDrop(", start);
  const reveal = source.slice(start, end);
  assert.match(reveal, /state\.sourceId = "added-files"/);
  assert.match(reveal, /state\.kind = kinds\.length === 1 \? kinds\[0\] : ""/);
  assert.match(reveal, /is-drop-revealed/);
  assert.match(reveal, /scrollIntoView/);
  const dropStart = source.indexOf("async function handleExternalDrop(");
  const dropEnd = source.indexOf("\nasync function revealAddedItems(", dropStart);
  const drop = source.slice(dropStart, dropEnd);
  assert.match(drop, /media-library:add-dropped-paths/);
  assert.doesNotMatch(drop, /media-library:add-source/);
});

test("Media grid keeps GNOME Videos-style card sizing and a visible scrollbar", async () => {
  const css = await readFile(new URL("../src/main.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const template = await readFile(new URL("../src/shared/app-ui-templates.mjs", import.meta.url), "utf8");
  const start = css.indexOf(".media-library__items {");
  const end = css.indexOf(".media-library__availability", start);
  const mediaGrid = css.slice(start, end);
  assert.match(mediaGrid, /minmax\(180px, 1fr\)/);
  assert.match(mediaGrid, /grid-auto-rows: max-content/);
  assert.match(mediaGrid, /overflow-y: scroll/);
  assert.match(mediaGrid, /scrollbar-gutter: stable/);
  assert.match(mediaGrid, /aspect-ratio: 16 \/ 9/);
  assert.match(mediaGrid, /-webkit-line-clamp: 2/);
  assert.doesNotMatch(css, /media-library\[data-view="list"\]|media-library__view-controls/);
  assert.doesNotMatch(source, /mediaLibraryGridBtn|mediaLibraryListBtn|emsMediaLibraryView|function setView\(/);
  assert.doesNotMatch(template, /mediaLibraryGridBtn|mediaLibraryListBtn|media-library__view-controls/);
});

test("opening preview and reactive refreshes preserve the media scroll anchor", async () => {
  const source = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  assert.match(source, /function captureMediaScrollAnchor\(/);
  assert.match(source, /function restoreMediaScrollAnchorAfterLayout\(/);
  const detailsStart = source.indexOf("function showDetails(");
  const detailsEnd = source.indexOf("\nfunction closeDetails(", detailsStart);
  const details = source.slice(detailsStart, detailsEnd);
  assert.match(details, /details\?\.hidden \? captureMediaScrollAnchor\(item\.id\) : null/);
  assert.match(details, /if \(scrollAnchor\) restoreMediaScrollAnchorAfterLayout\(scrollAnchor\)/);
  assert.match(source, /cameFromThisPreview \|\| state\.sourceId !== "recent"/);
});

test("background pagination cannot dismiss an open media preview", async () => {
  const source = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function runQuery(");
  const end = source.indexOf("\nfunction maybeLoadMore(", start);
  const query = source.slice(start, end);
  assert.doesNotMatch(query, /closeDetails\(/);
});

test("Media preview stays pinned while details metadata scrolls", async () => {
  const css = await readFile(new URL("../src/main.css", import.meta.url), "utf8");
  assert.match(css, /\.media-library__details \{ position: relative;[^}]*overflow: hidden/);
  assert.match(css, /\.media-library__details-body \{/);
  assert.match(css, /\.media-library__preview \{[^}]*flex: 0 0 auto/);
});

test("selecting another media item reveals its preview after details scrolling", async () => {
  const source = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const template = await readFile(new URL("../src/shared/app-ui-templates.mjs", import.meta.url), "utf8");
  const detailsStart = source.indexOf("function showDetails(");
  const detailsEnd = source.indexOf("\nfunction closeDetails(", detailsStart);
  const details = source.slice(detailsStart, detailsEnd);
  assert.match(template, /id="mediaLibraryDetailsBody"/);
  assert.match(details, /const selectionChanged = state\.selectedId !== item\.id/);
  assert.match(details, /if \(selectionChanged\) resetDetailsScroll\(details\)/);
  assert.match(details, /restoreMediaScrollAnchorAfterLayout\(null\)/);
});

test("keyboard selection loads the open Media preview instead of dismissing it", async () => {
  const source = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const start = source.indexOf('element("mediaLibraryItems")?.addEventListener("keydown"');
  const end = source.indexOf('element("mediaLibraryItems")?.addEventListener("dragstart"', start);
  const keydown = source.slice(start, end);
  assert.match(keydown, /if \(item && !element\("mediaLibraryDetails"\)\?\.hidden\) showDetails\(item\)/);
});

test("preview activity does not rebuild a deeply paginated Media grid", async () => {
  const source = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  assert.match(source, /const pendingPreviewActivityIds = new Set\(\)/);
  assert.match(source, /function recordPreviewActivity\(itemId\)/);
  assert.match(source, /const cameFromThisPreview = changedIds\.length > 0/);
  assert.match(source, /if \(cameFromThisPreview \|\| state\.sourceId !== "recent" \|\| state\.selectedId\) return/);
});

test("Media workspace stops preview-stack clicks from stealing library selection", async () => {
  const source = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function bindEvents(workspace)");
  const end = source.indexOf("element(\"mediaLibraryAddSourceBtn\")", start);
  const bind = source.slice(start, end);
  assert.match(bind, /event\.stopPropagation\(\)/);
  const overlay = await readFile(new URL("../src/control-window/app-workspace-shell.mjs", import.meta.url), "utf8");
  assert.match(overlay, /isMediaLibraryWorkspaceVisible\(\)/);
});

test("clicking the Media preview fills the workspace and Back returns to the picker", async () => {
  const source = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/main.css", import.meta.url), "utf8");
  const template = await readFile(new URL("../src/shared/app-ui-templates.mjs", import.meta.url), "utf8");
  assert.match(source, /function enterInspect\(\{ focus = true \} = \{\}\)/);
  assert.match(source, /function leaveInspect\(\)/);
  assert.match(source, /function shouldUseFullPreview\(\)/);
  assert.match(source, /if \(inspect \|\| shouldUseFullPreview\(\)\) enterInspect\(\)/);
  assert.match(source, /function leaveInspect\(\) \{\s*closeDetails\(\);/);
  assert.match(source, /function exitInspectToSidebar\(\)/);
  assert.match(source, /workspace\.classList\.add\("is-inspecting"\)/);
  assert.match(source, /mediaLibraryLeaveInspectBtn/);
  assert.match(source, /mediaLibraryPreview"\)\?\.addEventListener\("click"/);
  assert.match(source, /inspect: true/);
  assert.match(template, /id="mediaLibraryLeaveInspectBtn"/);
  const inspectBar = template.slice(template.indexOf('class="media-library__inspect-bar"'), template.indexOf('id="mediaLibraryPreview"'));
  assert.match(inspectBar, /id="mediaLibraryLeaveInspectBtn"/);
  assert.match(inspectBar, />Browse<\/span>/);
  assert.match(inspectBar, /id="mediaLibraryAddScheduleBtn"/);
  assert.ok(inspectBar.indexOf("mediaLibraryLeaveInspectBtn") < inspectBar.indexOf("mediaLibraryAddScheduleBtn"));
  assert.match(css, /\.media-library\.is-inspecting \{/);
  assert.match(css, /\.media-library\.is-inspecting \.media-library__content \{ display: none/);
  const inspectBackStart = css.indexOf(".media-library__inspect-back {");
  const inspectBack = css.slice(inspectBackStart, css.indexOf("}", inspectBackStart) + 1);
  assert.match(inspectBack, /display: inline-flex/);
  assert.doesNotMatch(inspectBack, /display: none/);
  assert.doesNotMatch(css, /\.media-library\.is-medium \.media-library__details \{/);
  assert.doesNotMatch(css, /\.media-library\.is-narrow \.media-library__details \{/);
});

test("Media uses a GNOME NavigationSplitView instead of viewport media queries", async () => {
  const source = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/main.css", import.meta.url), "utf8");
  const template = await readFile(new URL("../src/shared/app-ui-templates.mjs", import.meta.url), "utf8");
  const layoutStart = source.indexOf("function syncMediaLibraryLayout(");
  const layoutEnd = source.indexOf("\nfunction setSource(", layoutStart);
  const layout = source.slice(layoutStart, layoutEnd);
  assert.match(source, /const MEDIA_LIBRARY_NARROW_MAX = 560/);
  assert.match(source, /const MEDIA_LIBRARY_MEDIUM_MAX = 840/);
  assert.match(layout, /workspace\.classList\.toggle\("is-narrow", isNarrow\)/);
  assert.match(layout, /workspace\.classList\.toggle\("is-medium", isMedium\)/);
  assert.doesNotMatch(layout, /classList\.add\("is-browsing"\)/);
  assert.match(layout, /if \(!isNarrow\) workspace\.classList\.remove\("is-browsing"\)/);
  assert.match(layout, /enterInspect\(\{ focus: false \}\)/);
  assert.match(layout, /exitInspectToSidebar\(\)/);
  assert.match(css, /\.media-library\.is-medium \{/);
  assert.match(css, /\.media-library\.is-narrow \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.media-library\.is-narrow:not\(\.is-browsing\) \.media-library__back/);
  assert.doesNotMatch(template, /id="mediaLibraryBackBtn"[^>]*\bhidden\b/);
  const mediaLibraryCss = css.slice(css.indexOf("/* GNOME HIG Media library workspace */"));
  assert.doesNotMatch(mediaLibraryCss, /@media \(max-width: 1240px\)/);
  assert.doesNotMatch(mediaLibraryCss, /@media \(max-width: 900px\)[\s\S]*\.media-library \{ grid-template-columns: 1fr \}/);
});

test("Media file information omits type and source", async () => {
  const source = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const metaStart = source.indexOf("function itemMeta(item)");
  const metaEnd = source.indexOf("\nfunction mediaItemElement(", metaStart);
  const itemMeta = source.slice(metaStart, metaEnd);
  assert.match(itemMeta, /humanBytes\(item\.size\)/);
  assert.doesNotMatch(itemMeta, /item\.kind|sourceName|Presentation/);
  assert.doesNotMatch(source, /mediaLibraryDetailsStatus|mediaLibraryDetailsMeta/);
});

test("Media preview does not expose Properties, Keep, or Remove item actions", async () => {
  const source = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const template = await readFile(new URL("../src/shared/app-ui-templates.mjs", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/main.css", import.meta.url), "utf8");
  const markupStart = template.indexOf("function mediaLibraryWorkspaceMarkup()");
  const markupEnd = template.indexOf("export function generateDyneTabShellHTML", markupStart);
  const markup = template.slice(markupStart, markupEnd);
  assert.doesNotMatch(markup, /mediaLibraryKeepBtn|Keep in Media/);
  assert.doesNotMatch(markup, /mediaLibraryOpenPropertiesBtn|>Properties</);
  assert.doesNotMatch(markup, /mediaLibraryRemoveItemBtn|Remove from Media/);
  assert.doesNotMatch(markup, /mediaLibraryProperties/);
  assert.doesNotMatch(source, /mediaLibraryKeepBtn|mediaLibraryOpenPropertiesBtn|mediaLibraryRemoveItemBtn|mediaLibraryProperties/);
  assert.doesNotMatch(css, /\.media-library__properties/);
});

test("Media browse sidebar follows Adwaita sidebar patterns", async () => {
  const source = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/main.css", import.meta.url), "utf8");
  const template = await readFile(new URL("../src/shared/app-ui-templates.mjs", import.meta.url), "utf8");
  const markupStart = template.indexOf("function mediaLibraryWorkspaceMarkup()");
  const markupEnd = template.indexOf("export function generateDyneTabShellHTML", markupStart);
  const markup = template.slice(markupStart, markupEnd);
  assert.doesNotMatch(markup, /<strong>Browse<\/strong>/);
  assert.match(markup, />Sources<\/span>/);
  assert.match(markup, /id="mediaLibraryAddSourceCompactBtn"[^>]*class="media-library__icon-button"/);
  const headingStart = css.indexOf(".media-library__source-heading {");
  const headingEnd = css.indexOf("}", headingStart);
  const heading = css.slice(headingStart, headingEnd + 1);
  assert.match(heading, /\.media-library__source-heading \{/);
  assert.doesNotMatch(heading, /text-transform:\s*uppercase/);
  assert.match(css, /\.media-library__source-row > \[data-media-source\] \{\s*grid-template-columns: 16px minmax\(0, 1fr\) 10px/);
  assert.match(source, /indexStatus\.hidden = !indexStatus\.textContent/);
});

test("Media uses a GNOME path bar and shows child folders in the grid", async () => {
  const source = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/main.css", import.meta.url), "utf8");
  const foldersStart = source.indexOf("function renderFolders()");
  const foldersEnd = source.indexOf("\nfunction syncPathBarOverflow(", foldersStart);
  const folders = source.slice(foldersStart, foldersEnd);
  assert.match(folders, /media-library__path/);
  assert.match(folders, /mediaLibraryPathOverflow/);
  assert.doesNotMatch(folders, /folder-separator| · /);
  assert.match(source, /function folderItemElement\(/);
  assert.match(source, /media-library__item--folder/);
  assert.match(source, /visibleFolders\(\)\.map\(folderItemElement\)/);
  assert.match(css, /\.media-library__path \{/);
  assert.match(css, /\.media-library__path-overflow/);
  assert.match(css, /\.media-library__item--folder/);
});

test("selecting a schedule item leaves Media and shows the preview", async () => {
  const source = await readFile(new URL("../src/control-window/app-renderer.mjs", import.meta.url), "utf8");
  const activateStart = source.indexOf("async function onQueueItemActivate(");
  const activateEnd = source.indexOf("\nasync function pauseQueuePresentationAtBoundary(", activateStart);
  const activate = source.slice(activateStart, activateEnd);
  assert.match(activate, /hideMediaLibraryWorkspaceForSchedulePreview\(\)/);
  assert.match(activate, /syncPreviewStackSurface\(\)/);
  assert.match(activate, /hideBibleWorkspace\(\)/);
  assert.match(activate, /loadQueueItemIntoControlWindow/);
});

test("taking a schedule item live leaves Media browse and shows the presenting preview", async () => {
  const source = await readFile(new URL("../src/control-window/app-presentation-playback.mjs", import.meta.url), "utf8");
  const liveStart = source.indexOf("async function takeQueueItemLive(");
  const liveEnd = source.indexOf("\nasync function stopQueuePresentationUserClosed(", liveStart);
  const live = source.slice(liveStart, liveEnd);
  assert.match(source, /hideMediaLibraryWorkspaceForSchedulePreview/);
  assert.match(live, /hideMediaLibraryWorkspaceForSchedulePreview\(\)/);
  assert.match(live, /syncPreviewStackSurface\(\)/);
});

test("Schedule selection pulses grey while Media library is open", async () => {
  const workspace = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/main.css", import.meta.url), "utf8");
  assert.match(workspace, /function syncScheduleSelectionForLibraryMode\(/);
  assert.match(workspace, /is-media-library-open/);
  assert.match(css, /\.queue-section\.is-media-library-open \.queue-item\.is-selected/);
  assert.match(css, /@keyframes queue-selection-library-pulse/);
});

test("Browse Media button in the headerbar opens the media library", async () => {
  const html = await readFile(new URL("../src/control-window/index.html", import.meta.url), "utf8");
  const template = await readFile(new URL("../src/shared/app-ui-templates.mjs", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../src/control-window/app-renderer.mjs", import.meta.url), "utf8");
  const chrome = await readFile(new URL("../src/control-window/app-operator-chrome.mjs", import.meta.url), "utf8");
  assert.match(html, /id="headerBrowseMediaButton"/);
  assert.match(html, />Browse Media<\/span>/);
  const browsePos = html.indexOf("headerBrowseMediaButton");
  const addPos = html.indexOf("headerAddMediaButton");
  assert.ok(browsePos < addPos, "Browse Media should appear before Add Media in headerbar");
  assert.doesNotMatch(template, /id="mediaLibraryReturnBtn"/);
  assert.doesNotMatch(template, /browseMediaLibraryBtn/);
  assert.match(chrome, /installBrowseMediaLibraryButton/);
  assert.match(chrome, /headerBrowseMediaButton/);
  assert.match(chrome, /showMediaLibraryWorkspace\(\)/);
  assert.match(workspace, /function hideMediaLibraryWorkspaceForSchedulePreview\(/);
  assert.match(workspace, /revealSchedulePreviewForLibraryPath/);
  assert.match(renderer, /function revealSchedulePreviewForLibraryPath\(/);
});

test("headerbar Add Media records files to Recent", async () => {
  const chrome = await readFile(new URL("../src/control-window/app-operator-chrome.mjs", import.meta.url), "utf8");
  const openStart = chrome.indexOf("async function openMediaFilesDialog()");
  const openEnd = chrome.indexOf("\nfunction ", openStart + 10);
  const fn = chrome.slice(openStart, openEnd);
  assert.match(fn, /recordScheduledMediaPaths\(res\.filePaths\)/);
});

test("Media library mode disables the workspace scrubber", async () => {
  const workspace = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const chrome = await readFile(new URL("../src/control-window/app-operator-chrome.mjs", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/main.css", import.meta.url), "utf8");
  assert.match(workspace, /function disableMediaWorkspaceScrubber\(/);
  assert.match(workspace, /function hideMediaLibraryCountdown\(/);
  assert.match(workspace, /disableMediaWorkspaceScrubber\(\)/);
  assert.match(workspace, /hideMediaLibraryCountdown\(\)/);
  assert.match(workspace, /video\.controls = false/);
  assert.match(workspace, /function bindLibraryPreviewTransport\(/);
  assert.match(workspace, /function applyDefaultLibraryPreviewAudibility\(/);
  assert.match(workspace, /isLivePresentationActive\(\)/);
  assert.match(workspace, /data-library-preview-volume/);
  assert.doesNotMatch(workspace, /disableLibraryPreviewScrubber/);
  assert.match(css, /\.media-library__preview-controls \{/);
  const renderer = await readFile(new URL("../src/control-window/app-renderer.mjs", import.meta.url), "utf8");
  assert.match(renderer, /isLivePresentationActive:/);
  assert.match(chrome, /overlayBlocksTransport = isPreviewWorkspaceOverlayVisible\(\)/);
  assert.match(chrome, /!isPreviewWorkspaceOverlayVisible\(\)/);
  assert.match(css, /\.video-wrapper:has\(#mediaLibraryWorkspace:not\(\[hidden\]\)\) \.controls-overlay/);
  assert.match(css, /\.video-wrapper:has\(#mediaLibraryWorkspace:not\(\[hidden\]\)\) #mediaCntDn/);
  assert.doesNotMatch(css, /\.media-library__preview video::-webkit-media-controls-timeline/);
  const shell = await readFile(new URL("../src/control-window/app-workspace-shell.mjs", import.meta.url), "utf8");
  const showStart = shell.indexOf("function showMediaWorkspace()");
  const showEnd = shell.indexOf("\nfunction markAudiencePreviewTextSelection(", showStart);
  const showMedia = shell.slice(showStart, showEnd);
  assert.match(showMedia, /setMediaCountdownOverlayVisible\(false\)/);
  assert.match(showMedia, /setMediaCountdownText\(""\)/);
});

test("Schedule accepts drops from library cards, preview media, and the OS file manager", async () => {
  const workspace = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const schedule = await readFile(new URL("../src/control-window/app-schedule-controller.mjs", import.meta.url), "utf8");
  const chrome = await readFile(new URL("../src/control-window/app-operator-chrome.mjs", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/main.css", import.meta.url), "utf8");
  const previewDragStart = workspace.indexOf('element("mediaLibraryPreview")?.addEventListener("dragstart"');
  const previewDragEnd = workspace.indexOf('element("mediaLibraryPreview")?.addEventListener("dragend"', previewDragStart);
  const previewDrag = workspace.slice(previewDragStart, previewDragEnd);
  assert.match(workspace, /export const MEDIA_ITEM_DRAG_TYPE = "application\/x-ems-media-library-item"/);
  assert.match(workspace, /function beginMediaLibraryItemDrag\(/);
  assert.match(workspace, /function canDragLibraryPreviewItem\(/);
  assert.match(workspace, /function markPreviewMediaDraggable\(/);
  assert.match(workspace, /function setLibraryPreviewDragImage\(/);
  assert.match(workspace, /isLibraryPreviewControlPointer/);
  assert.match(workspace, /mediaLibraryDragItemId = item.id/);
  assert.match(workspace, /event\.stopPropagation\(\)/);
  assert.match(workspace, /function mediaLibraryDragIsActive\(/);
  assert.match(workspace, /addEventListener\("dragstart"/);
  assert.match(previewDrag, /closest\?\.\("img, video, \.media-library__preview-audio-icon"\)/);
  assert.match(previewDrag, /setLibraryPreviewDragImage\(event, media\)/);
  assert.doesNotMatch(previewDrag, /media-library__preview-player/);
  assert.match(css, /\.media-library__preview \{[^}]*-webkit-user-drag: none/);
  assert.match(css, /\.media-library__preview-player \{[^}]*-webkit-user-drag: none/);
  assert.match(schedule, /closest\("\.queue-section"\)/);
  assert.match(schedule, /mediaLibraryDragIsActive\(e\.dataTransfer\)/);
  assert.match(schedule, /resolveMediaLibraryDragItem\(droppedMediaLibraryItemId\)/);
  assert.match(schedule, /extractAndFilterDroppedMediaPaths\(e\.dataTransfer\)/);
  assert.match(schedule, /applyDroppedMediaPaths\(\[item\.localPath\], \{ insertIndex, preserveWorkspace: true \}\)/);
  assert.match(chrome, /#mediaLibraryPreview/);
});

test("Media files can be added to the Schedule from a context menu", async () => {
  const workspace = await readFile(new URL("../src/control-window/app-media-library-workspace.mjs", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/main.css", import.meta.url), "utf8");
  assert.match(workspace, /function showMediaLibraryContextMenu\(/);
  assert.match(workspace, /function ensureMediaLibraryContextMenu\(/);
  assert.match(workspace, /menu\.className = "song-context-menu"/);
  assert.match(workspace, /Add to Schedule/);
  assert.match(workspace, /pickerRequest \? "Choose" : "Add to Schedule"/);
  assert.match(workspace, /addEventListener\("contextmenu"/);
  assert.match(workspace, /closest\("#mediaLibraryItems \[data-media-item-id\]"\)/);
  assert.match(workspace, /void addItemToSchedule\(item\)/);
  assert.match(workspace, /window\.addEventListener\("resize", hideMediaLibraryContextMenu\)/);
  assert.match(workspace, /window\.addEventListener\("scroll", hideMediaLibraryContextMenu, true\)/);
  assert.match(css, /\.song-context-menu \{/);
  assert.match(css, /\.song-context-menu button:disabled/);
});
