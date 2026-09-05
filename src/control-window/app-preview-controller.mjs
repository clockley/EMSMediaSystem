/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/*
 * PPTX preview, slide navigation, and PowerPoint thumbnail chrome.
 */

import {
  PPTX_SIDEBAR_DEFAULT_WIDTH,
  PPTX_SIDEBAR_MAX_WIDTH,
  PPTX_SIDEBAR_MIN_WIDTH,
  PPTX_SIDEBAR_STORAGE_KEY,
  PREVIEW_SURFACE_LIVE,
  PREVIEW_SURFACE_PPTX,
  activeMediaWindowContentType,
  clearVideoPreviewCueOverlay,
  clampPptxSlideIndexValue,
  currentLiveQueueItem,
  currentPreviewCue,
  currentQueueIndex,
  enforcePptxCoverFit,
  findQueueIndexByPath,
  getElementContentSize,
  getPptxListRenderOptions,
  getPptxNaturalSlideSize,
  getPptxPdfjsConfig,
  getPptxRenderedSlideElement,
  getPptxSlideElementFromHandle,
  invoke,
  isActiveMediaWindow,
  isImg,
  isLocalAppWindowPresentationActive,
  isQueueItemPptx,
  isQueuePlaying,
  isQueuePresentationActive,
  isSavedPptxSlideIndex,
  mediaFile,
  mediaPlayerInputState,
  mediaQueue,
  mediaReadPayloadForPath,
  nextPlayableQueueItemStageText,
  normalizeMediaPathForCompare,
  pptxRegex,
  queueItemStageLabel,
  resolveQueuePresentationVideo,
  restoreLivePreview,
  scheduleAutosaveProjectState,
  send,
  sendCachedStageContent,
  setPreviewStackSurface,
  setSharedRendererState,
  slideTransitionPayloadForQueueItem,
  stageContentCache,
  stopLiveAudioPresentation,
  stopPreviewAudioCue,
  syncPreviewAudioTrackState,
  syncPreviewStackSurface,
  updateQueueFileLabel,
  video,
  waitForNextFrame,
} from "./app-renderer.mjs";

let pptxViewer = null;

let pptxViewerHost = null;

let pptxPreviewSlideHandle = null;

let pptxThumbnailHandles = new Map();

let pptxThumbnailHandleOwners = new Map();

let pptxThumbnailObserver = null;

let pptxSlideCount = 0;

let pptxCurrentSlide = 0;

let pptxFilePath = null;

let pptxLayoutRefreshRaf = 0;

let pptxPreviewRequestToken = 0;

let pptxOpenAbortController = null;

let pptxSlideRenderToken = 0;

let pptxThumbnailRenderToken = 0;

let pptxSlideNavigationTarget = null;

let pptxSlideNavigationPromise = null;

function clampPptxSlideIndex(index, count = pptxSlideCount) {
  return clampPptxSlideIndexValue(index, count);
}

function clampPptxSidebarWidth(width) {
  if (!Number.isFinite(width)) return PPTX_SIDEBAR_DEFAULT_WIDTH;
  return Math.min(PPTX_SIDEBAR_MAX_WIDTH, Math.max(PPTX_SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function currentPptxSidebarWidth() {
  const container = document.getElementById("pptxPreviewContainer");
  const raw = container?.style?.getPropertyValue("--pptx-sidebar-width") || "";
  const parsed = Number.parseFloat(raw);
  return clampPptxSidebarWidth(parsed || PPTX_SIDEBAR_DEFAULT_WIDTH);
}

function syncPptxResizeHandleAria(width = currentPptxSidebarWidth()) {
  const handle = document.getElementById("pptxSidebarResizeHandle");
  if (!handle) return;
  const safeWidth = clampPptxSidebarWidth(width);
  handle.setAttribute("aria-valuemin", String(PPTX_SIDEBAR_MIN_WIDTH));
  handle.setAttribute("aria-valuemax", String(PPTX_SIDEBAR_MAX_WIDTH));
  handle.setAttribute("aria-valuenow", String(safeWidth));
  handle.setAttribute("aria-valuetext", `Slides pane width ${safeWidth} pixels`);
}

function applyPptxSidebarWidth(width, opts = {}) {
  const container = document.getElementById("pptxPreviewContainer");
  if (!container) return;
  const safeWidth = clampPptxSidebarWidth(width);
  container.style.setProperty("--pptx-sidebar-width", `${safeWidth}px`);
  syncPptxResizeHandleAria(safeWidth);
  if (opts.persist !== false) {
    try {
      window.localStorage.setItem(PPTX_SIDEBAR_STORAGE_KEY, String(safeWidth));
    } catch {}
  }
}

function restorePptxSidebarWidth(container) {
  if (!container) return;
  let savedWidth = PPTX_SIDEBAR_DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(PPTX_SIDEBAR_STORAGE_KEY);
    const parsed = Number.parseFloat(raw || "");
    if (Number.isFinite(parsed)) savedWidth = parsed;
  } catch {}
  container.style.setProperty(
    "--pptx-sidebar-width",
    `${clampPptxSidebarWidth(savedWidth)}px`,
  );
}

function schedulePptxLayoutRefresh() {
  schedulePptxLiveRelayout();
}

function applyPptxThumbnailAspectRatio(viewport, width, height) {
  if (!viewport || !(width > 0) || !(height > 0)) return;
  const aspectRatio = `${width} / ${height}`;
  viewport.style.aspectRatio = aspectRatio;
  viewport.closest(".pptx-thumbnail-frame")?.style.setProperty(
    "aspect-ratio",
    aspectRatio,
  );
}

function layoutPptxSlideStage(stage, slideEl, containerEl, fallbackSize = {}) {
  if (!stage || !containerEl) return;
  const { width, height } = getPptxNaturalSlideSize(slideEl, fallbackSize);
  if (fallbackSize.matchContainerAspectRatio === true && width > 0 && height > 0) {
    // Native decks are 16:9, but imported presentations may be 4:3 or use a
    // custom page size. Match the thumbnail viewport to the imported deck so
    // contain-fitting does not leave a black strip beside the slide.
    applyPptxThumbnailAspectRatio(containerEl, width, height);
  }
  const { width: cw, height: ch } = getElementContentSize(containerEl);
  const scale = cw && ch ? Math.min(cw / width, ch / height) : 1;
  stage.style.width = `${width * scale}px`;
  stage.style.height = `${height * scale}px`;
  if (slideEl) {
    slideEl.style.width = `${width}px`;
    slideEl.style.height = `${height}px`;
    slideEl.style.maxWidth = "none";
    slideEl.style.maxHeight = "none";
    slideEl.style.transform = `scale(${scale})`;
    slideEl.style.transformOrigin = "top left";
  }
  enforcePptxCoverFit(stage);
}

function relayoutVisiblePptxThumbnails() {
  const thumbnailList = document.getElementById("pptxThumbnailList");
  if (!thumbnailList) return;
  thumbnailList.querySelectorAll(".pptx-thumbnail-button").forEach((button) => {
    const viewport = button.querySelector(".pptx-thumbnail-viewport");
    const stage = viewport?.querySelector(".pptx-thumbnail-stage");
    if (!viewport || !stage) return;
    const index = Number(button.dataset.slideIndex);
    const slideEl = getPptxSlideElementFromHandle(
      pptxThumbnailHandles.get(index),
      stage,
    );
    layoutPptxSlideStage(stage, slideEl, viewport, {
      slideWidth: pptxViewer?.slideWidth,
      slideHeight: pptxViewer?.slideHeight,
      matchContainerAspectRatio: true,
    });
    stage.style.visibility = "";
  });
}

function relayoutCurrentPptxSlide() {
  const mainPane = document.getElementById("pptxMainSlidePane");
  const stage = mainPane?.querySelector(".pptx-preview-stage");
  if (!mainPane || !stage) return;
  const slideEl = getPptxRenderedSlideElement(pptxPreviewSlideHandle, stage);
  layoutPptxSlideStage(stage, slideEl, mainPane, {
    slideWidth: pptxViewer?.slideWidth,
    slideHeight: pptxViewer?.slideHeight,
  });
  stage.style.visibility = "";
}

function schedulePptxLiveRelayout() {
  if (pptxLayoutRefreshRaf) return;
  pptxLayoutRefreshRaf = requestAnimationFrame(() => {
    pptxLayoutRefreshRaf = 0;
    if (!pptxViewer) return;
    relayoutCurrentPptxSlide();
    relayoutVisiblePptxThumbnails();
  });
}

function cancelPptxLayoutRefresh() {
  if (!pptxLayoutRefreshRaf) return;
  cancelAnimationFrame(pptxLayoutRefreshRaf);
  pptxLayoutRefreshRaf = 0;
}

function bindPptxSidebarResize(container) {
  const handle = document.getElementById("pptxSidebarResizeHandle");
  if (!container || !handle || handle.dataset.resizeBound === "1") return;
  handle.dataset.resizeBound = "1";
  syncPptxResizeHandleAria();

  const finishResize = () => {
    document.body.classList.remove("is-pptx-sidebar-resizing");
    schedulePptxLayoutRefresh();
  };

  handle.addEventListener("dblclick", () => {
    applyPptxSidebarWidth(PPTX_SIDEBAR_DEFAULT_WIDTH);
    finishResize();
  });

  handle.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 32 : 16;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      applyPptxSidebarWidth(currentPptxSidebarWidth() - step);
      finishResize();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      applyPptxSidebarWidth(currentPptxSidebarWidth() + step);
      finishResize();
    } else if (event.key === "Home") {
      event.preventDefault();
      applyPptxSidebarWidth(PPTX_SIDEBAR_MIN_WIDTH);
      finishResize();
    } else if (event.key === "End") {
      event.preventDefault();
      applyPptxSidebarWidth(PPTX_SIDEBAR_MAX_WIDTH);
      finishResize();
    }
  });

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    const containerRect = container.getBoundingClientRect();
    document.body.classList.add("is-pptx-sidebar-resizing");
    handle.setPointerCapture(pointerId);

    const onPointerMove = (moveEvent) => {
      const nextWidth = clampPptxSidebarWidth(
        moveEvent.clientX - containerRect.left,
      );
      applyPptxSidebarWidth(nextWidth, { persist: false });
      schedulePptxLiveRelayout();
    };

    const onPointerUp = () => {
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerUp);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {}
      applyPptxSidebarWidth(currentPptxSidebarWidth());
      finishResize();
    };

    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerUp);
  });
}

function nextPptxPreviewRequestToken() {
  pptxPreviewRequestToken += 1;
  return pptxPreviewRequestToken;
}

function isCurrentPptxPreviewRequest(token) {
  return token === pptxPreviewRequestToken;
}

function resolvePptxPreviewStartSlide(filePath, opts) {
  if (Number.isFinite(opts?.startSlide)) {
    return Math.max(0, Math.floor(opts.startSlide));
  }
  const sameDeck =
    pptxFilePath &&
    normalizeMediaPathForCompare(pptxFilePath) === normalizeMediaPathForCompare(filePath);
  if (sameDeck) return clampPptxSlideIndex(pptxCurrentSlide);
  const queueIndex = findQueueIndexByPath(filePath);
  const savedSlide = queueIndex >= 0 ? mediaQueue[queueIndex]?.pptxSlideIndex : null;
  return isSavedPptxSlideIndex(savedSlide) ? Math.max(0, Math.floor(savedSlide)) : 0;
}

function rememberPptxSlide(filePath, slideIndex) {
  if (!filePath || !Number.isFinite(slideIndex)) return false;
  const safeSlide = Math.max(0, Math.floor(slideIndex));
  const normalized = normalizeMediaPathForCompare(filePath);
  let changed = false;
  mediaQueue.forEach((item) => {
    if (isQueueItemPptx(item) && normalizeMediaPathForCompare(item.path) === normalized) {
      if (item.pptxSlideIndex !== safeSlide) {
        item.pptxSlideIndex = safeSlide;
        changed = true;
      }
    }
  });
  return changed;
}

async function loadPptxPreview(filePath, opts = {}) {
  const requestToken = nextPptxPreviewRequestToken();
  const startSlide = resolvePptxPreviewStartSlide(filePath, opts);
  const preserveLiveAudio = opts?.preserveLiveAudio === true;
  const preserveLiveVideo = opts?.preserveLiveVideo === true;
  const preserveLiveBible = opts?.preserveLiveBible === true;
  const preserveLiveMedia = preserveLiveAudio || preserveLiveVideo || preserveLiveBible;
  // Some third-party ESM bundles expect a Node-like `process` object.
  // Electron renderer (browser context) does not provide it by default.
  if (!globalThis.process) {
    globalThis.process = { env: {} };
  } else if (!globalThis.process.env) {
    globalThis.process.env = {};
  }
  const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import("../../node_modules/@aiden0z/pptx-renderer/dist/aiden0z-pptx-renderer.browser.es.js");
  if (!isCurrentPptxPreviewRequest(requestToken)) return;
  const container = document.getElementById("pptxPreviewContainer");
  if (!container) return;
  if (!preserveLiveAudio && !preserveLiveBible) stopLiveAudioPresentation();
  stopPreviewAudioCue();
  clearVideoPreviewCueOverlay();
  if (video && !preserveLiveMedia) {
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch {}
  }
  if (!preserveLiveBible) {
    document
      .getElementById("customControls")
      ?.style.setProperty("visibility", "hidden");
    const videoPreview = document.getElementById("preview");
    if (videoPreview) videoPreview.style.display = "none";
  }
  disposePptxRenderResources();
  disposePptxViewerHost();
  container.innerHTML = "";
  container.style.display = "flex";
  setPreviewStackSurface(PREVIEW_SURFACE_PPTX);
  ensurePptxPreviewShell(container);
  const readPayload = await mediaReadPayloadForPath(filePath);
  const arrayBuffer = await invoke("read-file-as-arraybuffer", readPayload);
  if (!isCurrentPptxPreviewRequest(requestToken)) return;
  // Each in-flight open gets an isolated host. A superseded request can then
  // destroy and remove its own viewer without touching the newer request.
  const viewerHost = createPptxViewerHost();
  const openAbortController = new AbortController();
  pptxOpenAbortController = openAbortController;
  const viewerOptions = {
    zipLimits: RECOMMENDED_ZIP_LIMITS,
    fitMode: "contain",
    renderMode: "slide",
    pdfjs: getPptxPdfjsConfig(),
    // `renderMode: "slide"` keeps preview cheap; these options apply if the
    // viewer is later asked to render a list (windowed mounting by default).
    listOptions: getPptxListRenderOptions(),
  };
  let openedViewer = null;
  try {
    // Own the instance before opening it. The static factory cannot return an
    // instance when parsing rejects, which would leave no way to destroy it.
    openedViewer = new PptxViewer(viewerHost, viewerOptions);
    await openedViewer.open(arrayBuffer, {
      renderMode: "slide",
      listOptions: viewerOptions.listOptions,
      signal: openAbortController.signal,
    });
  } catch (err) {
    try {
      openedViewer?.destroy?.();
    } catch {}
    disposePptxViewerHost(viewerHost);
    if (
      openAbortController.signal.aborted ||
      !isCurrentPptxPreviewRequest(requestToken)
    ) {
      return;
    }
    throw err;
  } finally {
    if (pptxOpenAbortController === openAbortController) {
      pptxOpenAbortController = null;
    }
  }
  if (!isCurrentPptxPreviewRequest(requestToken)) {
    try {
      openedViewer?.destroy?.();
    } catch {}
    disposePptxViewerHost(viewerHost);
    return;
  }
  viewerHost.id = "pptxRendererHost";
  pptxViewerHost = viewerHost;
  pptxViewer = openedViewer;
  pptxFilePath = filePath;
  pptxSlideCount = pptxViewer.slideCount ?? pptxViewer.slides?.length ?? 1;
  buildPptxNavigator();
  if (container.dataset.pptxResizeBound !== "1") {
    container.dataset.pptxResizeBound = "1";
    window.addEventListener("resize", () => {
      if (!pptxViewer) return;
      ensurePptxPreviewShell(container);
      schedulePptxLayoutRefresh();
    });
  }
  const didRender = await showPptxSlide(
    clampPptxSlideIndex(startSlide, pptxSlideCount),
  );
  if (!isCurrentPptxPreviewRequest(requestToken)) return;
  if (!didRender) return;
  if (rememberPptxSlide(filePath, pptxCurrentSlide)) {
    scheduleAutosaveProjectState();
  }
  setPreviewStackSurface(PREVIEW_SURFACE_PPTX);
  if (preserveLiveMedia) {
    syncPreviewAudioTrackState();
  }
}

function disposePptxThumbnails() {
  pptxThumbnailRenderToken += 1;
  if (pptxThumbnailObserver) {
    try {
      pptxThumbnailObserver.disconnect();
    } catch {}
    pptxThumbnailObserver = null;
  }
  pptxThumbnailHandles.forEach((handle) => {
    try {
      handle?.dispose?.();
    } catch {}
  });
  pptxThumbnailHandleOwners.forEach((button) => {
    button
      ?.querySelector?.(".pptx-thumbnail-viewport")
      ?.replaceChildren?.();
  });
  pptxThumbnailHandles.clear();
  pptxThumbnailHandleOwners.clear();
}

function disposePptxPreviewSlide() {
  pptxSlideRenderToken += 1;
  const handle = pptxPreviewSlideHandle;
  pptxPreviewSlideHandle = null;
  try {
    handle?.dispose?.();
  } catch {}
  document.getElementById("pptxMainSlidePane")?.replaceChildren();
}

function disposePptxRenderResources() {
  // pptx-renderer deliberately does not own handles returned by
  // renderSlideToContainer(). Release every external handle before destroying
  // the viewer so charts, media nodes, and their callbacks cannot survive it.
  try {
    pptxOpenAbortController?.abort?.();
  } catch {}
  pptxOpenAbortController = null;
  cancelPptxLayoutRefresh();
  disposePptxPreviewSlide();
  disposePptxThumbnails();
  const viewer = pptxViewer;
  pptxViewer = null;
  try {
    viewer?.destroy?.();
  } catch {}
}

function createPptxViewerHost() {
  const host = document.createElement("div");
  host.className = "pptx-renderer-host";
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);
  return host;
}

function ensurePptxViewerHost() {
  if (pptxViewerHost?.isConnected) return pptxViewerHost;
  pptxViewerHost = createPptxViewerHost();
  pptxViewerHost.id = "pptxRendererHost";
  return pptxViewerHost;
}

function disposePptxViewerHost(host = pptxViewerHost) {
  if (!host) return;
  try {
    host.remove();
  } catch {}
  if (pptxViewerHost === host) pptxViewerHost = null;
}

function ensurePptxPreviewShell(container) {
  let mainPane = document.getElementById("pptxMainSlidePane");
  let thumbnailList = document.getElementById("pptxThumbnailList");
  if (mainPane && thumbnailList) return { mainPane, thumbnailList };

  container.innerHTML = "";
  restorePptxSidebarWidth(container);
  const sidebar = document.createElement("aside");
  sidebar.id = "pptxSlideNavigator";
  sidebar.setAttribute("aria-label", "PowerPoint slide navigator");

  const header = document.createElement("div");
  header.className = "pptx-slide-navigator__header songs-workspace__nav-header";

  const heading = document.createElement("div");
  heading.className = "pptx-slide-navigator__heading songs-workspace__heading";
  heading.textContent = "Slides";
  header.appendChild(heading);

  const navigatorBody = document.createElement("div");
  navigatorBody.className = "pptx-slide-navigator__body song-slide-navigator";

  thumbnailList = document.createElement("div");
  thumbnailList.id = "pptxThumbnailList";
  thumbnailList.className = "pptx-thumbnail-list song-slide-thumbnail-list";
  thumbnailList.setAttribute("role", "listbox");
  thumbnailList.setAttribute("aria-label", "PowerPoint slides");
  navigatorBody.appendChild(thumbnailList);

  mainPane = document.createElement("div");
  mainPane.id = "pptxMainSlidePane";
  mainPane.setAttribute("aria-label", "Selected PowerPoint slide");

  const resizeHandle = document.createElement("div");
  resizeHandle.id = "pptxSidebarResizeHandle";
  resizeHandle.className = "pptx-sidebar-resize-handle song-sidebar-resize-handle";
  resizeHandle.setAttribute("role", "separator");
  resizeHandle.setAttribute("aria-label", "Resize slides pane");
  resizeHandle.setAttribute("aria-orientation", "vertical");
  resizeHandle.tabIndex = 0;

  sidebar.appendChild(header);
  sidebar.appendChild(navigatorBody);
  container.appendChild(sidebar);
  container.appendChild(resizeHandle);
  container.appendChild(mainPane);
  bindPptxSidebarResize(container);
  return { mainPane, thumbnailList };
}

function updatePptxNavigatorSelection() {
  const thumbnailList = document.getElementById("pptxThumbnailList");
  if (!thumbnailList) return;
  thumbnailList.querySelectorAll(".pptx-thumbnail-button").forEach((button) => {
    const isActive = Number(button.dataset.slideIndex) === pptxCurrentSlide;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
    button.tabIndex = isActive ? 0 : -1;
  });
  const active = thumbnailList.querySelector(".pptx-thumbnail-button.is-active");
  active?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
}

async function renderPptxThumbnail(index, button, opts = {}) {
  if (!pptxViewer || !button?.isConnected) return;
  const viewer = pptxViewer;
  const renderToken = pptxThumbnailRenderToken;
  const force = opts?.force === true;
  const viewport = button.querySelector(".pptx-thumbnail-viewport");
  if (!viewport) return;
  const existingHandle = pptxThumbnailHandles.get(index);
  if (existingHandle) {
    const existingOwner = pptxThumbnailHandleOwners.get(index);
    const existingStage = viewport.querySelector(".pptx-thumbnail-stage");
    const existingSlide = getPptxSlideElementFromHandle(existingHandle, existingStage);
    if (
      !force &&
      existingOwner === button &&
      existingStage &&
      existingSlide &&
      viewport.contains(existingSlide)
    ) {
      layoutPptxSlideStage(existingStage, existingSlide, viewport, {
        slideWidth: viewer.slideWidth,
        slideHeight: viewer.slideHeight,
        matchContainerAspectRatio: true,
      });
      existingStage.style.visibility = "";
      return;
    }
    try {
      existingHandle.dispose?.();
    } catch {}
    pptxThumbnailHandles.delete(index);
    pptxThumbnailHandleOwners.delete(index);
  }
  viewport.innerHTML = "";
  applyPptxThumbnailAspectRatio(viewport, viewer.slideWidth, viewer.slideHeight);
  const stage = document.createElement("div");
  stage.className = "pptx-thumbnail-stage";
  stage.style.visibility = "hidden";
  viewport.appendChild(stage);

  let handle = null;
  try {
    // Render at the deck's natural size, then apply one measured transform.
    // renderThumbnailToContainer() already scales its slide; forcing its SVG
    // to fill our viewport applies a second scale and makes it microscopic.
    handle = viewer.renderSlideToContainer(index, stage, 1);
  } catch (err) {
    console.error("Failed to render PPTX thumbnail:", err);
  }
  if (!handle) return;
  pptxThumbnailHandles.set(index, handle);
  pptxThumbnailHandleOwners.set(index, button);
  try {
    await handle.ready;
  } catch (err) {
    if (
      renderToken === pptxThumbnailRenderToken &&
      viewer === pptxViewer &&
      pptxThumbnailHandles.get(index) === handle
    ) {
      console.error("Failed to finish PPTX thumbnail render:", err);
    }
  }
  await waitForNextFrame();
  if (
    renderToken !== pptxThumbnailRenderToken ||
    viewer !== pptxViewer ||
    pptxThumbnailHandles.get(index) !== handle ||
    pptxThumbnailHandleOwners.get(index) !== button ||
    !button.isConnected
  ) {
    if (pptxThumbnailHandles.get(index) === handle) {
      pptxThumbnailHandles.delete(index);
      pptxThumbnailHandleOwners.delete(index);
    }
    try {
      handle.dispose?.();
    } catch {}
    stage.remove();
    return;
  }
  const slideEl = getPptxSlideElementFromHandle(handle, stage);
  layoutPptxSlideStage(stage, slideEl, viewport, {
    slideWidth: viewer.slideWidth,
    slideHeight: viewer.slideHeight,
    matchContainerAspectRatio: true,
  });
  stage.style.visibility = "";
}

function unmountPptxThumbnail(index, button) {
  const handle = pptxThumbnailHandles.get(index);
  if (!handle) return;
  if (pptxThumbnailHandleOwners.get(index) !== button) return;
  const viewport = button?.querySelector?.(".pptx-thumbnail-viewport");
  try {
    handle.dispose?.();
  } catch {}
  if (viewport) viewport.innerHTML = "";
  pptxThumbnailHandles.delete(index);
  pptxThumbnailHandleOwners.delete(index);
}

function refreshVisiblePptxThumbnails() {
  const thumbnailList = document.getElementById("pptxThumbnailList");
  if (!pptxViewer || !thumbnailList) return;
  const listRect = thumbnailList.getBoundingClientRect();
  thumbnailList.querySelectorAll(".pptx-thumbnail-button").forEach((button) => {
    const index = Number(button.dataset.slideIndex);
    if (!Number.isFinite(index)) return;
    const rect = button.getBoundingClientRect();
    const isVisible =
      rect.bottom >= listRect.top - 240 && rect.top <= listRect.bottom + 240;
    if (isVisible) void renderPptxThumbnail(index, button);
  });
}

function schedulePptxThumbnailRefresh() {
  const renderToken = pptxThumbnailRenderToken;
  requestAnimationFrame(() => {
    if (renderToken !== pptxThumbnailRenderToken || !pptxViewer) return;
    refreshVisiblePptxThumbnails();
    requestAnimationFrame(() => {
      if (renderToken !== pptxThumbnailRenderToken || !pptxViewer) return;
      refreshVisiblePptxThumbnails();
    });
  });
}

function buildPptxNavigator() {
  const container = document.getElementById("pptxPreviewContainer");
  if (!container) return;
  if (container.dataset.stopMediaToggleBound !== "1") {
    container.dataset.stopMediaToggleBound = "1";
    container.addEventListener("click", (event) => event.stopPropagation());
    container.addEventListener("dblclick", (event) => event.stopPropagation());
    container.tabIndex = 0;
    container.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      void jumpToPptxSlide(pptxCurrentSlide + (event.key === "ArrowLeft" ? -1 : 1));
    });
  }
  const { thumbnailList } = ensurePptxPreviewShell(container);
  disposePptxThumbnails();
  thumbnailList.innerHTML = "";

  for (let i = 0; i < pptxSlideCount; i++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pptx-thumbnail-button song-slide-thumbnail-button";
    button.dataset.slideIndex = String(i);
    button.setAttribute("role", "option");
    button.setAttribute("aria-label", `Go to slide ${i + 1}`);
    button.innerHTML = `
      <span class="pptx-thumbnail-number song-slide-thumbnail-button__number">${i + 1}</span>
      <span class="pptx-thumbnail-frame song-slide-thumbnail-button__viewport">
        <span class="pptx-thumbnail-viewport slides-page-list__thumb song-slide-thumbnail-button__thumb"></span>
      </span>
    `;
    button.addEventListener("click", () => {
      void jumpToPptxSlide(i);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = thumbnailList.querySelector(
          `.pptx-thumbnail-button[data-slide-index="${Math.min(i + 1, pptxSlideCount - 1)}"]`,
        );
        next?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const previous = thumbnailList.querySelector(
          `.pptx-thumbnail-button[data-slide-index="${Math.max(i - 1, 0)}"]`,
        );
        previous?.focus();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void jumpToPptxSlide(i);
      }
    });
    thumbnailList.appendChild(button);
  }

  if ("IntersectionObserver" in window) {
    pptxThumbnailObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const index = Number(entry.target.dataset.slideIndex);
          if (!Number.isFinite(index)) return;
          if (entry.isIntersecting) {
            void renderPptxThumbnail(index, entry.target);
          } else {
            unmountPptxThumbnail(index, entry.target);
          }
        });
      },
      {
        root: thumbnailList,
        rootMargin: "240px 0px",
      },
    );
    thumbnailList.querySelectorAll(".pptx-thumbnail-button").forEach((button) => {
      pptxThumbnailObserver.observe(button);
    });
  } else {
    thumbnailList.querySelectorAll(".pptx-thumbnail-button").forEach((button) => {
      const index = Number(button.dataset.slideIndex);
      if (Number.isFinite(index)) void renderPptxThumbnail(index, button);
    });
  }
  updatePptxNavigatorSelection();
}

async function showPptxSlide(index) {
  const container = document.getElementById("pptxPreviewContainer");
  const viewer = pptxViewer;
  if (!container || !viewer) return false;
  const { mainPane } = ensurePptxPreviewShell(container);
  const slideIndex = clampPptxSlideIndex(index);
  disposePptxPreviewSlide();
  const renderToken = pptxSlideRenderToken;
  mainPane.innerHTML = "";
  const stage = document.createElement("div");
  stage.className = "pptx-preview-stage";
  stage.style.visibility = "hidden";
  mainPane.appendChild(stage);
  let handle = null;
  try {
    handle = viewer.renderSlideToContainer(slideIndex, stage, 1);
  } catch (err) {
    console.error("Failed to render PPTX preview slide:", err);
  }
  if (!handle) {
    stage.remove();
    return false;
  }
  pptxPreviewSlideHandle = handle;
  try {
    await handle.ready;
  } catch (err) {
    if (renderToken === pptxSlideRenderToken) {
      console.error("Failed to finish PPTX preview render:", err);
    }
  }
  await waitForNextFrame();
  if (
    renderToken !== pptxSlideRenderToken ||
    viewer !== pptxViewer ||
    pptxPreviewSlideHandle !== handle ||
    !stage.isConnected
  ) {
    if (pptxPreviewSlideHandle === handle) pptxPreviewSlideHandle = null;
    try {
      handle.dispose?.();
    } catch {}
    stage.remove();
    return false;
  }
  const slideEl = getPptxRenderedSlideElement(handle, stage);
  layoutPptxSlideStage(stage, slideEl, mainPane, {
    slideWidth: viewer.slideWidth,
    slideHeight: viewer.slideHeight,
  });
  stage.style.visibility = "";
  pptxCurrentSlide = slideIndex;
  updatePptxNavigatorSelection();
  return true;
}

function sendPptxSlideToMediaWindow(slideIndex) {
  const livePptxItem =
    isQueuePlaying &&
    currentQueueIndex >= 0 &&
    currentQueueIndex < mediaQueue.length &&
    isQueueItemPptx(mediaQueue[currentQueueIndex])
      ? mediaQueue[currentQueueIndex]
      : null;
  send("pptx-goto-slide", {
    slideIndex,
    filePath: pptxFilePath,
    transition: livePptxItem ? slideTransitionPayloadForQueueItem(livePptxItem) : undefined,
  });
  const nextSlide =
    Number.isInteger(slideIndex) && slideIndex + 1 < pptxSlideCount
      ? `Slide ${slideIndex + 2}`
      : nextPlayableQueueItemStageText();
  setSharedRendererState({ stageContentCache: {
    ...stageContentCache,
    current: `Slide ${Math.max(1, (Number(slideIndex) || 0) + 1)}`,
    next: nextSlide,
    serviceItem: queueItemStageLabel(livePptxItem) || "",
  } });
  void sendCachedStageContent().catch(() => {});
}

function pptxStartSlideForItem(item) {
  if (!isQueueItemPptx(item)) return 0;
  const sameDeck =
    pptxFilePath &&
    item?.path &&
    normalizeMediaPathForCompare(pptxFilePath) === normalizeMediaPathForCompare(item.path);
  if (sameDeck) return clampPptxSlideIndex(pptxCurrentSlide);
  const savedSlide = isSavedPptxSlideIndex(item?.pptxSlideIndex)
    ? item.pptxSlideIndex
    : null;
  return isSavedPptxSlideIndex(savedSlide) ? clampPptxSlideIndex(savedSlide) : 0;
}

async function jumpToPptxSlide(index) {
  const slideIndex = clampPptxSlideIndex(index);

  // A browser double-click dispatches two click events. Avoid rendering the
  // same slide twice: overlapping renderer calls dispose and recreate the
  // visible stage, which can expose a blank frame in both preview and output.
  if (pptxSlideNavigationPromise) {
    if (pptxSlideNavigationTarget === slideIndex) {
      await pptxSlideNavigationPromise;
      return;
    }
    await pptxSlideNavigationPromise;
    return jumpToPptxSlide(slideIndex);
  }
  if (
    slideIndex === pptxCurrentSlide &&
    pptxPreviewSlideHandle &&
    document.querySelector("#pptxMainSlidePane .pptx-preview-stage")
  ) {
    updatePptxNavigatorSelection();
    return;
  }

  pptxSlideNavigationTarget = slideIndex;
  const navigation = (async () => {
    const didRender = await showPptxSlide(slideIndex);
    if (!didRender) return;
    if (pptxFilePath && rememberPptxSlide(pptxFilePath, pptxCurrentSlide)) {
      scheduleAutosaveProjectState();
    }
    if (isActiveMediaWindow() && activeMediaWindowContentType === "pptx") {
      sendPptxSlideToMediaWindow(pptxCurrentSlide);
    }
  })();
  pptxSlideNavigationPromise = navigation;
  try {
    await navigation;
  } finally {
    if (pptxSlideNavigationPromise === navigation) {
      pptxSlideNavigationPromise = null;
      pptxSlideNavigationTarget = null;
    }
  }
}

function hidePptxPreview(options = {}) {
  nextPptxPreviewRequestToken();
  const restoreVideoPreview = options.restoreVideoPreview !== false;
  const container = document.getElementById("pptxPreviewContainer");
  if (container) container.style.display = "none";
  const videoPreview = document.getElementById("preview");
  if (videoPreview && restoreVideoPreview) videoPreview.style.display = "";
  if (mediaFile && isImg(mediaFile)) {
    document
      .getElementById("customControls")
      ?.style.setProperty("visibility", "hidden");
  } else {
    document.getElementById("customControls")?.style.setProperty("visibility", "");
  }
  disposePptxRenderResources();
  disposePptxViewerHost();
  pptxFilePath = null;
  pptxSlideCount = 0;
  pptxCurrentSlide = 0;
  syncPreviewStackSurface();
}

function isPptxPreviewVisible() {
  const container = document.getElementById("pptxPreviewContainer");
  return Boolean(
    pptxViewer ||
      (container && container.style.display !== "none" && container.style.display !== ""),
  );
}

function hidePptxPreviewIfNeeded(options = {}) {
  if (isPptxPreviewVisible()) {
    hidePptxPreview(options);
  } else {
    // A slow PPTX load may still be between the async import/read steps and
    // the first visible render. Invalidate it even when there is nothing on
    // screen yet, otherwise it can re-activate after the user returns to live.
    nextPptxPreviewRequestToken();
  }
}

function restoreNonPptxPreviewSurface(options = {}) {
  const isImage = options.isImage === true;
  hidePptxPreviewIfNeeded({ restoreVideoPreview: !isImage });
  restoreLivePreview();
  resolveQueuePresentationVideo();
  setPreviewStackSurface(PREVIEW_SURFACE_LIVE);

  if (!isImage) {
    const liveImg = document.querySelector("img#preview");
    if (liveImg) {
      liveImg.remove();
      liveImg.src = "";
    }
    const previewEl = document.querySelector("video#preview");
    if (previewEl) {
      setSharedRendererState({ video: previewEl });
      previewEl.hidden = false;
      previewEl.style.display = "";
      previewEl.style.visibility = "";
    }
  }
}

function currentPptxPreviewFilePath() {
  if (mediaFile && pptxRegex.test(mediaFile)) return mediaFile;
  const liveItem = currentLiveQueueItem();
  if (isQueuePresentationActive() && isQueueItemPptx(liveItem)) return liveItem.path;
  return null;
}

function savedPptxSlideForPath(filePath) {
  const queueIndex = findQueueIndexByPath(filePath);
  const savedSlide = queueIndex >= 0 ? mediaQueue[queueIndex]?.pptxSlideIndex : null;
  return isSavedPptxSlideIndex(savedSlide) ? savedSlide : undefined;
}

async function getLivePptxSlideFromMediaWindow(filePath) {
  if (!isActiveMediaWindow()) return undefined;
  try {
    const slide = await invoke("get-pptx-current-slide");
    if (!isSavedPptxSlideIndex(slide)) return undefined;
    rememberPptxSlide(filePath, slide);
    return slide;
  } catch (err) {
    console.error("Failed to get current PPTX slide from media window:", err);
    return undefined;
  }
}

async function syncCurrentPptxSlideForProjectSnapshot() {
  const pptxPath = currentPptxPreviewFilePath();
  if (!pptxPath) return;

  const liveSlide = await getLivePptxSlideFromMediaWindow(pptxPath);
  if (isSavedPptxSlideIndex(liveSlide)) return;

  const samePreviewDeck =
    pptxFilePath &&
    normalizeMediaPathForCompare(pptxFilePath) === normalizeMediaPathForCompare(pptxPath);
  if (samePreviewDeck && isSavedPptxSlideIndex(pptxCurrentSlide)) {
    rememberPptxSlide(pptxPath, pptxCurrentSlide);
  }
}

async function restorePptxPreviewForMediaTab() {
  if (isNonPptxPreviewCueActive()) return;
  const pptxPath = currentPptxPreviewFilePath();
  if (!pptxPath) return;

  setSharedRendererState({ mediaFile: pptxPath });
  mediaPlayerInputState.filePaths = [pptxPath];
  const queueIndex = findQueueIndexByPath(pptxPath);
  if (queueIndex >= 0) updateQueueFileLabel(mediaQueue[queueIndex].name);

  const container = document.getElementById("pptxPreviewContainer");
  const liveSlide = await getLivePptxSlideFromMediaWindow(pptxPath);
  if (isNonPptxPreviewCueActive()) return;
  const savedSlide = isSavedPptxSlideIndex(liveSlide)
    ? liveSlide
    : savedPptxSlideForPath(pptxPath);
  const sameDeck =
    pptxViewer &&
    pptxFilePath &&
    normalizeMediaPathForCompare(pptxFilePath) === normalizeMediaPathForCompare(pptxPath);

  if (sameDeck) {
    const videoPreview = document.querySelector("video#preview");
    const imagePreview = document.querySelector("img#preview");
    if (videoPreview) videoPreview.style.display = "none";
    if (imagePreview) imagePreview.style.display = "none";
    if (container) container.style.display = "flex";
    setPreviewStackSurface(PREVIEW_SURFACE_PPTX);
    if (isSavedPptxSlideIndex(savedSlide) && savedSlide !== pptxCurrentSlide) {
      await showPptxSlide(savedSlide);
    } else {
      updatePptxNavigatorSelection();
    }
  } else {
    await loadPptxPreview(pptxPath, {
      startSlide: savedSlide,
      preserveLiveAudio: isLocalAppWindowPresentationActive(),
    });
  }

  document
    .getElementById("customControls")
    ?.style.setProperty("visibility", "hidden");
}

function isNonPptxPreviewCueActive() {
  const cue = currentPreviewCue();
  return Boolean(cue && !isQueueItemPptx(cue.item));
}

export {
  applyPptxSidebarWidth,
  bindPptxSidebarResize,
  buildPptxNavigator,
  clampPptxSidebarWidth,
  clampPptxSlideIndex,
  currentPptxPreviewFilePath,
  currentPptxSidebarWidth,
  disposePptxThumbnails,
  disposePptxViewerHost,
  ensurePptxPreviewShell,
  ensurePptxViewerHost,
  getLivePptxSlideFromMediaWindow,
  hidePptxPreview,
  hidePptxPreviewIfNeeded,
  isCurrentPptxPreviewRequest,
  isNonPptxPreviewCueActive,
  isPptxPreviewVisible,
  jumpToPptxSlide,
  layoutPptxSlideStage,
  loadPptxPreview,
  nextPptxPreviewRequestToken,
  pptxCurrentSlide,
  pptxFilePath,
  pptxLayoutRefreshRaf,
  pptxPreviewRequestToken,
  pptxPreviewSlideHandle,
  pptxSlideCount,
  pptxSlideNavigationPromise,
  pptxSlideNavigationTarget,
  pptxStartSlideForItem,
  pptxThumbnailHandles,
  pptxThumbnailObserver,
  pptxViewer,
  pptxViewerHost,
  refreshVisiblePptxThumbnails,
  relayoutCurrentPptxSlide,
  rememberPptxSlide,
  renderPptxThumbnail,
  resolvePptxPreviewStartSlide,
  restoreNonPptxPreviewSurface,
  restorePptxPreviewForMediaTab,
  restorePptxSidebarWidth,
  savedPptxSlideForPath,
  schedulePptxLayoutRefresh,
  schedulePptxLiveRelayout,
  schedulePptxThumbnailRefresh,
  sendPptxSlideToMediaWindow,
  showPptxSlide,
  syncCurrentPptxSlideForProjectSnapshot,
  syncPptxResizeHandleAria,
  unmountPptxThumbnail,
  updatePptxNavigatorSelection,
};
