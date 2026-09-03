import { MEDIA_AVAILABILITY } from "../shared/media-library-contract.mjs";
import {
  bindTransportTimeDisplay,
  paintTransportTimeDisplay,
} from "../shared/app-controls-utils.mjs";
import {
  clampPptxSlideIndex,
  enforcePptxCoverFit,
  getElementContentSize,
  getPptxNaturalSlideSize,
  getPptxPdfjsConfig,
  getPptxRenderedSlideElement,
  waitForNextFrame,
} from "../shared/app-pptx-utils.mjs";

const LIBRARY_PREVIEW_PLAY_ICON = `<path d="M8 5v14l11-7z"/>`;
const LIBRARY_PREVIEW_PAUSE_ICON = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
const LIBRARY_PREVIEW_VOLUME_ICON = `<path d="M1 5h3l3-3v12L4 11H1z"/><path d="M9 7.5c.5 0 .5 1 0 1M10 6c1 0 1 4 0 4M12 4c2 0 2 8 0 8" fill="none" stroke="currentColor" stroke-width="1"/>`;
const LIBRARY_PREVIEW_MUTE_ICON = `<path d="M1 5h3l3-3v12L4 11H1z"/><path d="M8 3l7 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`;

export const MEDIA_ITEM_DRAG_TYPE = "application/x-ems-media-library-item";
let mediaLibraryDragItemId = "";
let mediaLibraryDragConsumedClick = false;
const PAGE_SIZE = 60;
const MEDIA_LIBRARY_NARROW_MAX = 560;
const MEDIA_LIBRARY_MEDIUM_MAX = 840;

let bridge = null;
let installed = false;
let refreshTimer = null;
let pickerRequest = null;
let posterObserver = null;
let layoutObserver = null;
let activePosterJobs = 0;
const posterQueue = [];
const posterCache = new Map();
let presentationPreviewToken = 0;
let presentationViewer = null;
let presentationSlideHandle = null;
let presentationViewerHost = null;
let presentationResizeObserver = null;
let presentationSlideIndex = 0;
let presentationSlideCount = 0;
let returnToLibraryAfterPreview = false;
let scrollRestoreToken = 0;
const pendingPreviewActivityIds = new Set();
const state = {
  snapshot: { revision: 0, sources: [], counts: {} },
  sourceId: "all",
  kind: "",
  parentId: "",
  folders: [],
  query: "",
  items: [],
  total: 0,
  hasMore: false,
  selectedId: "",
  highlightedIds: new Set(),
  requestId: 0,
  loadingMore: false,
  restoringScroll: false,
};

function element(id) {
  return document.getElementById(id);
}

function humanBytes(value) {
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${unit}`;
}

function kindIcon(kind) {
  if (kind === "image") return `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="9" width="36" height="30" rx="3"/><circle cx="17" cy="19" r="4"/><path d="m9 34 10-9 7 6 6-7 9 10"/></svg>`;
  if (kind === "video") return `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="9" width="36" height="30" rx="3"/><path d="m20 17 12 7-12 7z"/></svg>`;
  if (kind === "audio") return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M20 35V13l18-4v21M20 18l18-4"/><circle cx="14" cy="35" r="6"/><circle cx="32" cy="30" r="6"/></svg>`;
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 5h17l8 8v30H12z"/><path d="M29 5v9h8M18 22h13M18 28h13M18 34h9"/></svg>`;
}

function availabilityLabel(availability) {
  if (availability === MEDIA_AVAILABILITY.missing) return "Missing";
  if (availability === MEDIA_AVAILABILITY.sourceOffline) return "Source offline";
  if (availability === MEDIA_AVAILABILITY.preparing) return "Preparing";
  if (availability === MEDIA_AVAILABILITY.failed) return "Failed";
  return "Available";
}

function pumpPosterQueue() {
  while (activePosterJobs < 2 && posterQueue.length) {
    const job = posterQueue.shift();
    if (!job.thumbnail?.isConnected) continue;
    activePosterJobs += 1;
    if (job.item.kind === "presentation") {
      void renderPresentationCardThumbnail(job)
        .catch(() => {})
        .finally(() => { activePosterJobs -= 1; pumpPosterQueue(); });
      continue;
    }
    void bridge.invoke("media-library:thumbnail", { itemId: job.item.id, size: 512 })
      .then((poster) => {
        if (!poster?.ok || !poster.output || !job.thumbnail.isConnected) return;
        const url = bridge.pathToMediaUrl(poster.output, Number.isFinite(poster.mtime) ? String(poster.mtime) : undefined);
        posterCache.set(`${job.item.id}:${job.item.contentIdentity}`, url);
        const image = document.createElement("img");
        image.alt = "";
        image.loading = "lazy";
        image.src = url;
        image.addEventListener("error", () => {
          posterCache.delete(`${job.item.id}:${job.item.contentIdentity}`);
          image.remove();
          job.thumbnail.insertAdjacentHTML("afterbegin", kindIcon(job.item.kind));
        }, { once: true });
        job.thumbnail.querySelector("svg")?.replaceWith(image);
      })
      .catch(() => {})
      .finally(() => { activePosterJobs -= 1; pumpPosterQueue(); });
  }
}

async function renderPresentationCardThumbnail({ thumbnail, item }) {
  if (!thumbnail?.isConnected) return;
  if (!globalThis.process) globalThis.process = { env: {} };
  else globalThis.process.env ||= {};
  const [{ PptxViewer, RECOMMENDED_ZIP_LIMITS }, arrayBuffer] = await Promise.all([
    import("../../node_modules/@aiden0z/pptx-renderer/dist/aiden0z-pptx-renderer.browser.es.js"),
    bridge.invoke("read-file-as-arraybuffer", item.localPath),
  ]);
  if (!thumbnail.isConnected) return;
  const host = document.createElement("div");
  host.className = "media-library__presentation-renderer-host";
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);
  let viewer = null;
  let handle = null;
  let retained = false;
  let viewport = null;
  try {
    viewer = await PptxViewer.open(arrayBuffer, host, {
      zipLimits: RECOMMENDED_ZIP_LIMITS,
      fitMode: "contain",
      renderMode: "slide",
      pdfjs: getPptxPdfjsConfig(),
    });
    if (!thumbnail.isConnected) return;
    viewport = document.createElement("span");
    viewport.className = "media-library__pptx-card-viewport";
    thumbnail.insertBefore(viewport, thumbnail.querySelector(".media-library__kind-badge"));
    handle = viewer.renderThumbnailToContainer(0, viewport, {
      width: Math.max(180, Math.round(thumbnail.clientWidth || 240)),
    });
    await handle?.ready;
    if (!thumbnail.isConnected) return;
    thumbnail.querySelector("svg")?.remove();
    handle?.element?.classList?.add("media-library__pptx-card-slide");
    enforcePptxCoverFit(handle?.element);
    thumbnail._mediaLibraryPreviewCleanup = () => {
      try { handle?.dispose?.(); } catch {}
      try { viewer?.destroy?.(); } catch {}
      host.remove();
    };
    retained = true;
  } finally {
    if (!retained) {
      try { handle?.dispose?.(); } catch {}
      try { viewer?.destroy?.(); } catch {}
      host.remove();
      viewport?.remove();
    }
  }
}

function observeMediaThumbnail(thumbnail, item) {
  const cached = posterCache.get(`${item.id}:${item.contentIdentity}`);
  if (cached) {
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.src = cached;
    image.addEventListener("error", () => {
      posterCache.delete(`${item.id}:${item.contentIdentity}`);
      image.remove();
      thumbnail.insertAdjacentHTML("afterbegin", kindIcon(item.kind));
    }, { once: true });
    thumbnail.querySelector("svg")?.replaceWith(image);
    return;
  }
  posterObserver ||= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      posterObserver.unobserve(entry.target);
      const queuedItem = entry.target._mediaLibraryItem;
      if (queuedItem) posterQueue.push({ thumbnail: entry.target, item: queuedItem });
    }
    pumpPosterQueue();
  }, { root: element("mediaLibraryItems"), rootMargin: "160px" });
  thumbnail._mediaLibraryItem = item;
  posterObserver.observe(thumbnail);
}

function itemMeta(item) {
  return humanBytes(item.size);
}

function mediaItemElement(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `media-library__item${item.id === state.selectedId ? " is-selected" : ""}${state.highlightedIds.has(item.id) ? " is-drop-revealed" : ""}`;
  button.dataset.mediaItemId = item.id;
  button.setAttribute("role", "option");
  button.setAttribute("aria-selected", String(item.id === state.selectedId));
  button.setAttribute("aria-label", [item.displayName, itemMeta(item), availabilityLabel(item.availability)].filter(Boolean).join(", "));
  button.draggable = item.availability === MEDIA_AVAILABILITY.available;

  const thumbnail = document.createElement("span");
  thumbnail.className = "media-library__thumbnail";
  thumbnail.innerHTML = kindIcon(item.kind);
  const kindBadge = document.createElement("span");
  kindBadge.className = "media-library__kind-badge";
  kindBadge.textContent = item.kind === "presentation" ? "Slides" : item.kind;
  thumbnail.appendChild(kindBadge);
  if ((item.kind === "image" || item.kind === "video" || item.kind === "presentation") && item.localPath && item.availability === MEDIA_AVAILABILITY.available) {
    observeMediaThumbnail(thumbnail, item);
  }

  const copy = document.createElement("span");
  copy.className = "media-library__item-copy";
  const name = document.createElement("span");
  name.className = "media-library__item-name";
  name.textContent = item.displayName;
  const meta = document.createElement("span");
  meta.className = "media-library__item-meta";
  const metaText = itemMeta(item);
  meta.textContent = metaText;
  copy.append(name);
  if (metaText) copy.append(meta);
  if (item.availability !== MEDIA_AVAILABILITY.available) {
    const status = document.createElement("span");
    status.className = "media-library__item-meta media-library__availability";
    status.textContent = `⚠ ${availabilityLabel(item.availability)}`;
    copy.appendChild(status);
  }
  button.append(thumbnail, copy);
  return button;
}

function visibleFolders() {
  if (state.query || ["all", "recent", "added-files"].includes(state.sourceId)) return [];
  return state.folders;
}

function folderItemElement(folder) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "media-library__item media-library__item--folder";
  button.dataset.mediaFolder = folder.id;
  const count = Number.isFinite(folder.itemCount) ? folder.itemCount : 0;
  button.setAttribute("aria-label", `${folder.name} folder, ${count} item${count === 1 ? "" : "s"}`);
  const thumbnail = document.createElement("span");
  thumbnail.className = "media-library__thumbnail";
  thumbnail.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 14h14l4 4h18v22H6z"/></svg>`;
  const copy = document.createElement("span");
  copy.className = "media-library__item-copy";
  const name = document.createElement("span");
  name.className = "media-library__item-name";
  name.textContent = folder.name;
  const meta = document.createElement("span");
  meta.className = "media-library__item-meta";
  meta.textContent = `${count} item${count === 1 ? "" : "s"}`;
  copy.append(name, meta);
  button.append(thumbnail, copy);
  return button;
}

function renderItems({ appendFrom = -1 } = {}) {
  const container = element("mediaLibraryItems");
  const empty = element("mediaLibraryEmpty");
  if (!container || !empty) return;
  const folderCards = appendFrom >= 0 ? [] : visibleFolders().map(folderItemElement);
  if (appendFrom >= 0) {
    container.append(...state.items.slice(appendFrom).map(mediaItemElement));
  } else {
    container.querySelectorAll(".media-library__thumbnail").forEach((thumbnail) => posterObserver?.unobserve(thumbnail));
    container.querySelectorAll(".media-library__thumbnail").forEach((thumbnail) => thumbnail._mediaLibraryPreviewCleanup?.());
    container.replaceChildren(...folderCards, ...state.items.map(mediaItemElement));
  }
  const noResults = state.items.length === 0 && (appendFrom >= 0 || folderCards.length === 0);
  container.hidden = noResults;
  empty.hidden = !noResults;
  const title = element("mediaLibraryEmptyTitle");
  const detail = element("mediaLibraryEmptyDetail");
  const action = element("mediaLibraryEmptyAction");
  if (state.query) {
    title.textContent = `No results for “${state.query}”`;
    detail.textContent = "Try another search or clear the active type filter.";
    action.textContent = "Clear Search";
    action.dataset.action = "clear-search";
  } else if (state.snapshot.sources.filter((source) => source.id !== "added-files").length === 0) {
    title.textContent = "Add your media folders";
    detail.textContent = "Browse, preview, and schedule files without moving the originals.";
    action.textContent = "Add Media Folder";
    action.dataset.action = "add-source";
  } else {
    title.textContent = state.sourceId === "recent" ? "No recent media" : "No supported files here";
    detail.textContent = state.kind ? `No ${state.kind} items match this view.` : "This source contains no supported media files.";
    action.textContent = state.kind ? "Show All Types" : "Refresh";
    action.dataset.action = state.kind ? "clear-filter" : "refresh";
  }
  element("mediaLibraryResultSummary").textContent = `${state.total} item${state.total === 1 ? "" : "s"}`;
  element("mediaLibraryLiveRegion").textContent = `${state.total} media item${state.total === 1 ? "" : "s"} found`;
  requestAnimationFrame(maybeLoadMore);
}

function sourceIcon(source) {
  if (source.id === "added-files") return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h7l3 3v9H3zM10 2v4h3"/></svg>`;
  return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4.5h5l1.5 2h6.5v7h-13z"/></svg>`;
}

function renderSources() {
  const sources = element("mediaLibrarySources");
  if (!sources) return;
  sources.replaceChildren();
  for (const source of state.snapshot.sources) {
    const row = document.createElement("div");
    row.className = "media-library__source-row";
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.mediaSource = source.id;
    button.className = source.id === state.sourceId ? "is-active" : "";
    button.setAttribute("aria-current", source.id === state.sourceId ? "page" : "false");
    button.innerHTML = `${sourceIcon(source)}<span></span><i class="media-library__source-status" data-status="${source.status}"></i>`;
    button.querySelector("span").textContent = source.displayName;
    const statusLabel = source.status === "offline" ? "Offline" : source.status === "indexing" ? "Indexing" : "Ready";
    const status = button.querySelector(".media-library__source-status");
    status.title = statusLabel;
    status.setAttribute("aria-label", `Source status: ${statusLabel}`);
    row.appendChild(button);
    if (source.id !== "added-files") {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "media-library__source-remove";
      remove.dataset.removeMediaSource = source.id;
      remove.setAttribute("aria-label", `Remove ${source.displayName} from Media`);
      remove.title = "Remove from Media (files stay in place)";
      remove.textContent = "×";
      row.appendChild(remove);
    }
    sources.appendChild(row);
  }
  document.querySelectorAll("[data-media-source]").forEach((button) => {
    const selected = button.dataset.mediaSource === state.sourceId;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-current", selected ? "page" : "false");
  });
  element("mediaLibraryAllCount").textContent = state.snapshot.counts?.all ?? "";
  const indexing = state.snapshot.sources.filter((source) => source.status === "indexing");
  const offline = state.snapshot.sources.filter((source) => source.status === "offline");
  const indexStatus = element("mediaLibraryIndexStatus");
  indexStatus.textContent = indexing.length
    ? `Indexing ${indexing.map((source) => source.displayName).join(", ")}…`
    : offline.length
      ? `${offline.length} source${offline.length === 1 ? " is" : "s are"} offline`
      : "";
  indexStatus.hidden = !indexStatus.textContent;
}

function folderPathSegments() {
  const source = state.snapshot.sources.find((entry) => entry.id === state.sourceId);
  if (!source || ["all", "recent", "added-files"].includes(state.sourceId)) return [];
  const segments = [{ id: "", name: source.displayName }];
  let accumulated = "";
  for (const part of state.parentId.split("/").filter(Boolean)) {
    accumulated = accumulated ? `${accumulated}/${part}` : part;
    segments.push({ id: accumulated, name: part });
  }
  return segments;
}

function renderFolders() {
  const bar = element("mediaLibraryFolderBar");
  if (!bar) return;
  const segments = folderPathSegments();
  if (segments.length <= 1) {
    bar.hidden = true;
    bar.replaceChildren();
    return;
  }

  const overflow = document.createElement("button");
  overflow.type = "button";
  overflow.id = "mediaLibraryPathOverflow";
  overflow.className = "media-library__path-overflow";
  overflow.hidden = true;
  overflow.setAttribute("aria-label", "Ancestor folders");
  overflow.setAttribute("aria-haspopup", "menu");
  overflow.setAttribute("aria-expanded", "false");
  overflow.textContent = "⋯";

  const menu = document.createElement("div");
  menu.id = "mediaLibraryPathMenu";
  menu.className = "media-library__path-menu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");

  const path = document.createElement("div");
  path.className = "media-library__path";
  path.append(overflow, menu);

  segments.forEach((segment, index) => {
    const crumb = document.createElement("span");
    crumb.className = "media-library__path-crumb";
    if (index === segments.length - 1) {
      const current = document.createElement("span");
      current.className = "media-library__path-current";
      current.setAttribute("aria-current", "page");
      current.textContent = segment.name;
      crumb.appendChild(current);
    } else {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.mediaFolder = segment.id;
      button.textContent = segment.name;
      crumb.appendChild(button);
      const chevron = document.createElement("span");
      chevron.className = "media-library__path-chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.innerHTML = `<svg viewBox="0 0 16 16"><path d="m6 3 5 5-5 5"/></svg>`;
      crumb.appendChild(chevron);
    }
    path.appendChild(crumb);
  });

  overflow.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    overflow.setAttribute("aria-expanded", String(open));
    if (open) {
      const rect = overflow.getBoundingClientRect();
      menu.style.top = `${Math.round(rect.bottom + 4)}px`;
      menu.style.left = `${Math.round(rect.left)}px`;
    }
  });

  bar.replaceChildren(path);
  bar.hidden = false;
  requestAnimationFrame(syncPathBarOverflow);
}

function syncPathBarOverflow() {
  const bar = element("mediaLibraryFolderBar");
  const path = bar?.querySelector(".media-library__path");
  const overflow = element("mediaLibraryPathOverflow");
  const menu = element("mediaLibraryPathMenu");
  if (!bar || bar.hidden || !path || !overflow || !menu) return;
  const crumbs = [...path.querySelectorAll(".media-library__path-crumb")];
  crumbs.forEach((crumb) => { crumb.hidden = false; });
  overflow.hidden = true;
  overflow.setAttribute("aria-expanded", "false");
  menu.hidden = true;
  menu.replaceChildren();
  if (crumbs.length <= 1) return;
  overflow.hidden = true;
  if (path.scrollWidth <= path.clientWidth + 1) return;
  overflow.hidden = false;
  const hidden = [];
  for (let i = 0; i < crumbs.length - 1; i += 1) {
    if (path.scrollWidth <= path.clientWidth + 1) break;
    crumbs[i].hidden = true;
    hidden.push(crumbs[i]);
  }
  for (const crumb of hidden) {
    const sourceButton = crumb.querySelector("[data-media-folder]");
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.dataset.mediaFolder = sourceButton?.dataset.mediaFolder || "";
    item.textContent = sourceButton?.textContent || "";
    menu.appendChild(item);
  }
  if (!hidden.length) overflow.hidden = true;
}

async function refreshSnapshot() {
  state.snapshot = await bridge.invoke("media-library:snapshot");
  renderSources();
}

async function runQuery({ append = false } = {}) {
  if (append && (!state.hasMore || state.loadingMore)) return;
  if (append) state.loadingMore = true;
  const requestId = ++state.requestId;
  const offset = append ? state.items.length : 0;
  try {
    const [result, folders] = await Promise.all([
      bridge.invoke("media-library:query", {
        sourceId: state.sourceId,
        parentId: state.parentId,
        query: state.query,
        kinds: state.kind ? [state.kind] : (pickerRequest?.kinds || []),
        sort: state.sourceId === "recent" ? "recent" : "name",
        offset,
        limit: PAGE_SIZE,
      }),
      bridge.invoke("media-library:list-folders", state.sourceId, state.parentId),
    ]);
    if (requestId !== state.requestId) return;
    state.items = append ? state.items.concat(result.items) : result.items;
    state.total = result.total;
    state.hasMore = result.hasMore;
    state.folders = Array.isArray(folders) ? folders : [];
    renderItems({ appendFrom: append ? offset : -1 });
    renderFolders();
  } finally {
    if (append) state.loadingMore = false;
  }
}

function maybeLoadMore() {
  const container = element("mediaLibraryItems");
  if (!container || container.hidden || !state.hasMore || state.loadingMore || state.restoringScroll) return;
  const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
  if (remaining < Math.max(480, container.clientHeight * 0.75)) void runQuery({ append: true });
}

function captureMediaScrollAnchor(preferredItemId = "") {
  const container = element("mediaLibraryItems");
  if (!container || container.hidden) return null;
  const containerRect = container.getBoundingClientRect();
  const cards = [...container.querySelectorAll("[data-media-item-id]")];
  const card = (preferredItemId && cards.find((entry) => entry.dataset.mediaItemId === preferredItemId))
    || cards.find((entry) => entry.getBoundingClientRect().bottom > containerRect.top + 1);
  return {
    itemId: card?.dataset.mediaItemId || "",
    offset: card ? card.getBoundingClientRect().top - containerRect.top : 0,
    scrollTop: container.scrollTop,
    loadedCount: state.items.length,
  };
}

function restoreMediaScrollAnchor(anchor) {
  if (!anchor) return;
  const container = element("mediaLibraryItems");
  if (!container) return;
  const card = anchor.itemId
    ? container.querySelector(`[data-media-item-id="${CSS.escape(anchor.itemId)}"]`)
    : null;
  if (!card) {
    container.scrollTop = anchor.scrollTop;
    return;
  }
  const currentOffset = card.getBoundingClientRect().top - container.getBoundingClientRect().top;
  container.scrollTop += currentOffset - anchor.offset;
}

function restoreMediaScrollAnchorAfterLayout(anchor) {
  const token = ++scrollRestoreToken;
  if (!anchor) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (token === scrollRestoreToken) restoreMediaScrollAnchor(anchor);
  }));
}

async function refresh({ preserveScroll = true } = {}) {
  const anchor = preserveScroll ? captureMediaScrollAnchor() : null;
  state.restoringScroll = Boolean(anchor);
  try {
    await refreshSnapshot();
    await runQuery();
    while (anchor && state.hasMore && state.items.length < anchor.loadedCount) {
      await runQuery({ append: true });
    }
    if (anchor) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      restoreMediaScrollAnchor(anchor);
    }
  } catch (err) {
    console.error("Media library refresh failed:", err);
    bridge.showToast("Media could not be loaded");
  } finally {
    state.restoringScroll = false;
  }
}

function scheduleRefresh(delay = 120) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refresh(), delay);
}

function detailsAreOpen() {
  return Boolean(state.selectedId) && element("mediaLibraryDetails")?.hidden === false;
}

function syncMediaLibraryLayout(width) {
  const workspace = element("mediaLibraryWorkspace");
  if (!workspace || !Number.isFinite(width)) return;
  const isNarrow = width < MEDIA_LIBRARY_NARROW_MAX;
  const isMedium = !isNarrow && width < MEDIA_LIBRARY_MEDIUM_MAX;
  const useFullPreview = isNarrow || isMedium;
  workspace.classList.toggle("is-narrow", isNarrow);
  workspace.classList.toggle("is-medium", isMedium);
  // GNOME NavigationSplitView keeps the content visible when collapsing.
  // Only leave the source list when the operator presses Back.
  if (!isNarrow) workspace.classList.remove("is-browsing");
  requestAnimationFrame(syncPathBarOverflow);
  if (!detailsAreOpen()) return;
  if (useFullPreview) enterInspect({ focus: false });
  else exitInspectToSidebar();
}

function setSource(sourceId) {
  state.sourceId = sourceId || "all";
  state.parentId = "";
  state.selectedId = "";
  state.highlightedIds.clear();
  closeDetails({ preserveScroll: false });
  const source = state.snapshot.sources.find((entry) => entry.id === state.sourceId);
  element("mediaLibraryTitle").textContent = state.sourceId === "recent" ? "Recent" : source?.displayName || "Media";
  element("mediaLibraryWorkspace").classList.remove("is-browsing");
  renderSources();
  void runQuery();
}

function setKind(kind) {
  state.kind = kind || "";
  state.highlightedIds.clear();
  element("mediaLibraryFilters")?.querySelectorAll("[data-media-kind]").forEach((button) => {
    const active = button.dataset.mediaKind === state.kind;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  void runQuery();
}

async function addSource() {
  try {
    const result = await bridge.invoke("media-library:add-source-dialog");
    if (!result?.canceled && result?.source) {
      state.sourceId = result.source.id;
      bridge.showToast(`Added ${result.source.displayName} to Media`, {
        onUndo: () => void bridge.invoke("media-library:remove-source", result.source.id).then(refresh),
      });
      await refresh({ preserveScroll: false });
    }
  } catch (err) {
    console.error("Add Media source failed:", err);
    bridge.showToast("The media folder could not be added");
  }
}

function canDragLibraryPreviewItem(item) {
  return Boolean(
    item &&
    item.availability === MEDIA_AVAILABILITY.available &&
    item.localPath &&
    (item.kind === "image" || item.kind === "video" || item.kind === "audio"),
  );
}

function beginMediaLibraryItemDrag(event, item) {
  if (!item || item.availability !== MEDIA_AVAILABILITY.available || !item.localPath || !event.dataTransfer) {
    event.preventDefault();
    return false;
  }
  mediaLibraryDragItemId = item.id;
  mediaLibraryDragConsumedClick = true;
  event.stopPropagation();
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(MEDIA_ITEM_DRAG_TYPE, item.id);
  event.dataTransfer.setData("text/plain", item.displayName);
  return true;
}

function isLibraryPreviewControlPointer(event) {
  return Boolean(event.target.closest?.(".media-library__preview-controls"));
}

function isLivePresentationActive() {
  return Boolean(bridge?.isLivePresentationActive?.());
}

function applyDefaultLibraryPreviewAudibility(media) {
  if (isLivePresentationActive()) {
    media.muted = true;
    media.volume = 0;
    return true;
  }
  media.muted = false;
  media.volume = 1;
  return false;
}

function bindLibraryPreviewTransport(media, { audio = false } = {}) {
  const player = document.createElement("div");
  player.className = `media-library__preview-player${audio ? " media-library__preview-player--audio" : ""}`;
  if (audio) {
    const icon = document.createElement("div");
    icon.className = "media-library__preview-audio-icon";
    icon.innerHTML = kindIcon("audio");
    player.appendChild(icon);
  }
  player.appendChild(media);

  const overlay = document.createElement("div");
  overlay.className = "media-library__preview-controls";
  overlay.innerHTML = `
    <button type="button" class="control-button" data-library-preview-play aria-label="Play">
      <svg viewBox="0 0 24 24">${LIBRARY_PREVIEW_PLAY_ICON}</svg>
    </button>
    <span class="time-display" data-library-preview-current></span>
    <input type="range" min="0" max="100" value="0" step="0.1" class="timeline-slider" data-library-preview-timeline aria-label="Seek">
    <span class="time-display" data-library-preview-duration></span>
    <button type="button" class="control-button" data-library-preview-mute aria-label="Mute">
      <svg viewBox="0 0 16 16" data-library-preview-mute-icon>${LIBRARY_PREVIEW_VOLUME_ICON}</svg>
    </button>
    <input type="range" min="0" max="100" value="100" step="1" class="timeline-slider media-library__preview-volume" data-library-preview-volume aria-label="Volume">
  `;
  player.appendChild(overlay);

  const playBtn = overlay.querySelector("[data-library-preview-play]");
  const playIcon = playBtn.querySelector("svg");
  const currentEl = overlay.querySelector("[data-library-preview-current]");
  const durationEl = overlay.querySelector("[data-library-preview-duration]");
  const timeline = overlay.querySelector("[data-library-preview-timeline]");
  const muteBtn = overlay.querySelector("[data-library-preview-mute]");
  const muteIcon = overlay.querySelector("[data-library-preview-mute-icon]");
  const volumeSlider = overlay.querySelector("[data-library-preview-volume]");
  bindTransportTimeDisplay(currentEl);
  bindTransportTimeDisplay(durationEl);

  applyDefaultLibraryPreviewAudibility(media);
  let lastAudibleVolume = media.muted || media.volume <= 0 ? 1 : media.volume;
  let dragging = false;
  const paint = () => {
    const duration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0;
    const current = Number.isFinite(media.currentTime) ? media.currentTime : 0;
    paintTransportTimeDisplay(currentEl, current);
    paintTransportTimeDisplay(durationEl, duration);
    if (!dragging) {
      timeline.value = duration > 0 ? String((current / duration) * 100) : "0";
      timeline.disabled = duration <= 0;
    }
    playIcon.innerHTML = media.paused ? LIBRARY_PREVIEW_PLAY_ICON : LIBRARY_PREVIEW_PAUSE_ICON;
    playBtn.setAttribute("aria-label", media.paused ? "Play" : "Pause");
    const muted = media.muted || media.volume <= 0;
    volumeSlider.value = String(Math.round((muted ? 0 : media.volume) * 100));
    muteIcon.innerHTML = muted ? LIBRARY_PREVIEW_MUTE_ICON : LIBRARY_PREVIEW_VOLUME_ICON;
    muteBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
    muteBtn.setAttribute("aria-pressed", String(muted));
  };

  playBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (media.paused) void media.play().catch(() => {});
    else media.pause();
  });
  muteBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const muted = media.muted || media.volume <= 0;
    if (muted) {
      media.muted = false;
      media.volume = lastAudibleVolume > 0 ? lastAudibleVolume : 1;
    } else {
      lastAudibleVolume = media.volume > 0 ? media.volume : 1;
      media.muted = true;
      media.volume = 0;
    }
    paint();
  });
  volumeSlider.addEventListener("pointerdown", (event) => event.stopPropagation());
  volumeSlider.addEventListener("input", (event) => {
    event.stopPropagation();
    const volume = Number(volumeSlider.value) / 100;
    media.volume = volume;
    media.muted = volume <= 0;
    if (volume > 0) lastAudibleVolume = volume;
    paint();
  });
  timeline.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    dragging = true;
  });
  timeline.addEventListener("input", () => {
    const duration = media.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    media.currentTime = (Number(timeline.value) / 100) * duration;
    paintTransportTimeDisplay(currentEl, media.currentTime);
  });
  timeline.addEventListener("change", () => {
    dragging = false;
    paint();
  });
  media.addEventListener("timeupdate", paint);
  media.addEventListener("loadedmetadata", paint);
  media.addEventListener("durationchange", paint);
  media.addEventListener("play", paint);
  media.addEventListener("pause", paint);
  media.addEventListener("ended", paint);
  paint();
  return player;
}

function markPreviewMediaDraggable(media, item) {
  media.draggable = true;
  media.dataset.mediaItemId = item.id;
}

function previewNode(item) {
  if (item.availability !== MEDIA_AVAILABILITY.available || !item.localPath) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = kindIcon(item.kind);
    return wrapper.firstElementChild;
  }
  if (item.kind === "image") {
    const image = document.createElement("img");
    image.alt = `Preview of ${item.displayName}`;
    image.src = bridge.pathToMediaUrl(item.localPath, item.contentIdentity);
    markPreviewMediaDraggable(image, item);
    return image;
  }
  if (item.kind === "video") {
    const video = document.createElement("video");
    video.src = bridge.pathToMediaUrl(item.localPath, item.contentIdentity);
    video.controls = false;
    video.preload = "metadata";
    video.disablePictureInPicture = true;
    markPreviewMediaDraggable(video, item);
    return bindLibraryPreviewTransport(video);
  }
  if (item.kind === "audio") {
    const audio = document.createElement("audio");
    audio.src = bridge.pathToMediaUrl(item.localPath, item.contentIdentity);
    audio.controls = false;
    audio.preload = "metadata";
    markPreviewMediaDraggable(audio, item);
    return bindLibraryPreviewTransport(audio, { audio: true });
  }
  const wrapper = document.createElement("div");
  wrapper.innerHTML = kindIcon(item.kind);
  return wrapper.firstElementChild;
}

function disposePresentationPreview() {
  presentationPreviewToken += 1;
  presentationResizeObserver?.disconnect?.();
  presentationResizeObserver = null;
  try { presentationSlideHandle?.dispose?.(); } catch {}
  presentationSlideHandle = null;
  try { presentationViewer?.destroy?.(); } catch {}
  presentationViewer = null;
  presentationViewerHost?.remove?.();
  presentationViewerHost = null;
  presentationSlideIndex = 0;
  presentationSlideCount = 0;
}

function fitPresentationSlide(viewport) {
  const stage = viewport?.querySelector(".media-library__presentation-stage");
  if (!stage) return;
  const slide = getPptxRenderedSlideElement(presentationSlideHandle, stage);
  const { width, height } = getPptxNaturalSlideSize(slide, {
    slideWidth: presentationViewer?.slideWidth,
    slideHeight: presentationViewer?.slideHeight,
  });
  const { width: availableWidth, height: availableHeight } = getElementContentSize(viewport);
  const scale = availableWidth && availableHeight
    ? Math.min(availableWidth / width, availableHeight / height)
    : 1;
  stage.style.width = `${width * scale}px`;
  stage.style.height = `${height * scale}px`;
  if (slide) {
    slide.style.width = `${width}px`;
    slide.style.height = `${height}px`;
    slide.style.maxWidth = "none";
    slide.style.maxHeight = "none";
    slide.style.transform = `scale(${scale})`;
    slide.style.transformOrigin = "top left";
  }
  enforcePptxCoverFit(stage);
}

function updatePresentationControls(shell) {
  const previous = shell.querySelector("[data-presentation-step='previous']");
  const next = shell.querySelector("[data-presentation-step='next']");
  const position = shell.querySelector(".media-library__presentation-position");
  if (previous) previous.disabled = presentationSlideIndex <= 0;
  if (next) next.disabled = presentationSlideIndex >= presentationSlideCount - 1;
  if (position) position.textContent = `Slide ${presentationSlideIndex + 1} of ${Math.max(1, presentationSlideCount)}`;
}

async function renderPresentationSlide(shell, requestedIndex, token) {
  if (!presentationViewer || token !== presentationPreviewToken || !shell.isConnected) return;
  presentationSlideIndex = clampPptxSlideIndex(requestedIndex, presentationSlideCount);
  const viewport = shell.querySelector(".media-library__presentation-viewport");
  try { presentationSlideHandle?.dispose?.(); } catch {}
  presentationSlideHandle = null;
  viewport.replaceChildren();
  const stage = document.createElement("div");
  stage.className = "media-library__presentation-stage";
  stage.style.visibility = "hidden";
  viewport.appendChild(stage);
  presentationSlideHandle = presentationViewer.renderSlideToContainer(presentationSlideIndex, stage, 1);
  try { await presentationSlideHandle?.ready; } catch {}
  await waitForNextFrame();
  if (token !== presentationPreviewToken || !shell.isConnected) return;
  fitPresentationSlide(viewport);
  stage.style.visibility = "";
  updatePresentationControls(shell);
}

async function loadPresentationPreview(item, preview) {
  disposePresentationPreview();
  const token = presentationPreviewToken;
  const shell = document.createElement("div");
  shell.className = "media-library__presentation-preview";
  shell.innerHTML = `
    <div class="media-library__presentation-viewport" role="img" aria-label="PowerPoint slide preview">
      <span class="media-library__presentation-loading">Loading slides…</span>
    </div>
    <div class="media-library__presentation-controls" aria-label="Slide navigation">
      <button type="button" data-presentation-step="previous" aria-label="Previous slide" title="Previous slide">‹</button>
      <span class="media-library__presentation-position" aria-live="polite">Slide 1</span>
      <button type="button" data-presentation-step="next" aria-label="Next slide" title="Next slide">›</button>
    </div>`;
  preview.replaceChildren(shell);
  shell.addEventListener("click", (event) => {
    const direction = event.target.closest("[data-presentation-step]")?.dataset.presentationStep;
    if (direction === "previous") void renderPresentationSlide(shell, presentationSlideIndex - 1, token);
    if (direction === "next") void renderPresentationSlide(shell, presentationSlideIndex + 1, token);
  });
  shell.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    void renderPresentationSlide(shell, presentationSlideIndex + (event.key === "ArrowLeft" ? -1 : 1), token);
  });
  try {
    if (!globalThis.process) globalThis.process = { env: {} };
    else globalThis.process.env ||= {};
    const [{ PptxViewer, RECOMMENDED_ZIP_LIMITS }, arrayBuffer] = await Promise.all([
      import("../../node_modules/@aiden0z/pptx-renderer/dist/aiden0z-pptx-renderer.browser.es.js"),
      bridge.invoke("read-file-as-arraybuffer", item.localPath),
    ]);
    if (token !== presentationPreviewToken || !shell.isConnected) return;
    const viewerHost = document.createElement("div");
    viewerHost.className = "media-library__presentation-renderer-host";
    viewerHost.setAttribute("aria-hidden", "true");
    document.body.appendChild(viewerHost);
    presentationViewerHost = viewerHost;
    const openedViewer = await PptxViewer.open(arrayBuffer, viewerHost, {
      zipLimits: RECOMMENDED_ZIP_LIMITS,
      fitMode: "contain",
      renderMode: "slide",
      pdfjs: getPptxPdfjsConfig(),
    });
    if (token !== presentationPreviewToken || !shell.isConnected) {
      try { openedViewer?.destroy?.(); } catch {}
      viewerHost.remove();
      return;
    }
    presentationViewer = openedViewer;
    presentationSlideCount = presentationViewer.slideCount ?? presentationViewer.slides?.length ?? 1;
    presentationResizeObserver = new ResizeObserver(() => fitPresentationSlide(shell.querySelector(".media-library__presentation-viewport")));
    presentationResizeObserver.observe(shell.querySelector(".media-library__presentation-viewport"));
    await renderPresentationSlide(shell, 0, token);
  } catch (error) {
    if (token !== presentationPreviewToken || !shell.isConnected) return;
    console.error("Failed to preview PowerPoint presentation:", error);
    shell.querySelector(".media-library__presentation-viewport").textContent = "This presentation could not be previewed.";
    shell.querySelector(".media-library__presentation-controls").hidden = true;
  }
}

function resetDetailsScroll(details) {
  if (!details) return;
  details.scrollTop = 0;
  const body = element("mediaLibraryDetailsBody");
  if (body) body.scrollTop = 0;
}

function isInspecting() {
  return element("mediaLibraryWorkspace")?.classList.contains("is-inspecting") === true;
}

function shouldUseFullPreview() {
  const workspace = element("mediaLibraryWorkspace");
  if (!workspace) return false;
  if (workspace.classList.contains("is-narrow") || workspace.classList.contains("is-medium")) return true;
  return workspace.getBoundingClientRect().width < MEDIA_LIBRARY_MEDIUM_MAX;
}

function enterInspect({ focus = true } = {}) {
  const workspace = element("mediaLibraryWorkspace");
  if (!workspace || !state.selectedId) return;
  workspace.classList.remove("is-browsing");
  workspace.classList.add("is-inspecting");
  if (focus) element("mediaLibraryLeaveInspectBtn")?.focus?.();
}

function exitInspectToSidebar() {
  element("mediaLibraryWorkspace")?.classList.remove("is-inspecting");
}

function leaveInspect() {
  closeDetails();
}

function showDetails(item, { focus = false, inspect = false } = {}) {
  if (!item) return;
  if (mediaLibraryDragItemId) return;
  if (item.localPath && bridge.revealSchedulePreviewForLibraryPath?.(item.localPath)) {
    state.selectedId = item.id;
    syncItemHighlights();
    const details = element("mediaLibraryDetails");
    if (details) details.hidden = true;
    element("mediaLibraryWorkspace")?.classList.remove("is-inspecting");
    return;
  }
  const details = element("mediaLibraryDetails");
  const scrollAnchor = details?.hidden ? captureMediaScrollAnchor(item.id) : null;
  const selectionChanged = state.selectedId !== item.id;
  // Invalidate a pending two-frame anchor restoration from the item that
  // previously opened the details pane. Otherwise a quick second selection
  // can be followed by the old selection moving the grid underneath it.
  restoreMediaScrollAnchorAfterLayout(null);
  disposePresentationPreview();
  state.selectedId = item.id;
  details.hidden = false;
  // Keep the preview pinned. Metadata below it scrolls separately, so a
  // previous item's details-body offset cannot hide the replacement media.
  if (selectionChanged) resetDetailsScroll(details);
  const preview = element("mediaLibraryPreview");
  preview.replaceChildren(previewNode(item));
  preview.draggable = canDragLibraryPreviewItem(item);
  if (preview.draggable) preview.dataset.mediaItemId = item.id;
  else delete preview.dataset.mediaItemId;
  if (item.kind === "presentation" && item.availability === MEDIA_AVAILABILITY.available && item.localPath) {
    void loadPresentationPreview(item, preview);
  }
  element("mediaLibraryDetailsName").textContent = item.displayName;
  const addButton = element("mediaLibraryAddScheduleBtn");
  addButton.disabled = item.availability !== MEDIA_AVAILABILITY.available;
  addButton.dataset.mediaItemId = item.id;
  syncItemHighlights();
  if (scrollAnchor) restoreMediaScrollAnchorAfterLayout(scrollAnchor);
  recordPreviewActivity(item.id);
  if (inspect || shouldUseFullPreview()) enterInspect();
  if (focus) details.focus?.();
}

function closeDetails({ preserveScroll = true } = {}) {
  element("mediaLibraryWorkspace")?.classList.remove("is-inspecting");
  const scrollAnchor = preserveScroll ? captureMediaScrollAnchor(state.selectedId) : null;
  restoreMediaScrollAnchorAfterLayout(null);
  disposePresentationPreview();
  state.selectedId = "";
  const details = element("mediaLibraryDetails");
  const preview = element("mediaLibraryPreview");
  preview?.querySelectorAll("video, audio").forEach((media) => media.pause());
  if (preview) {
    preview.draggable = false;
    delete preview.dataset.mediaItemId;
  }
  if (details) details.hidden = true;
  syncItemHighlights();
  restoreMediaScrollAnchorAfterLayout(scrollAnchor);
}

function syncItemHighlights() {
  element("mediaLibraryItems")?.querySelectorAll("[data-media-item-id]").forEach((button) => {
    const selected = button.dataset.mediaItemId === state.selectedId;
    button.classList.toggle("is-selected", selected);
    button.classList.toggle("is-drop-revealed", state.highlightedIds.has(button.dataset.mediaItemId));
    button.setAttribute("aria-selected", String(selected));
  });
}

function selectedItem() {
  return state.items.find((item) => item.id === state.selectedId) || null;
}

function recordPreviewActivity(itemId) {
  if (!itemId) return;
  pendingPreviewActivityIds.add(itemId);
  void bridge.invoke("media-library:record-activity", {
    itemId,
    actionKind: "previewed",
  }).catch((error) => {
    console.warn("Failed to record Media preview activity:", error);
  }).finally(() => {
    // The sidecar normally sends its notification before resolving this
    // request. Retain a grace period for IPC delivery under a busy renderer.
    window.setTimeout(() => pendingPreviewActivityIds.delete(itemId), 1000);
  });
}

async function addItemToSchedule(item = selectedItem()) {
  if (!item || item.availability !== MEDIA_AVAILABILITY.available || !item.localPath) return;
  if (pickerRequest) {
    const request = pickerRequest;
    pickerRequest = null;
    await bridge.invoke("media-library:record-activity", { itemId: item.id, actionKind: "applied" });
    element("mediaLibraryWorkspace").hidden = true;
    element("mediaLibraryCancelPickerBtn").hidden = true;
    element("mediaLibraryAddScheduleBtn").textContent = "Add to Schedule";
    element("mediaLibraryTitle").textContent = "Media";
    request.resolve(item);
    return;
  }
  bridge.addToSchedule([item.localPath], { preserveWorkspace: true });
  await bridge.invoke("media-library:record-activity", { itemId: item.id, actionKind: "scheduled" });
  bridge.showToast(`Added ${item.displayName} to the schedule`);
}

async function handleExternalDrop(dataTransfer) {
  const paths = [];
  for (const file of Array.from(dataTransfer?.files || [])) {
    const localPath = bridge.getPathForFile(file);
    if (localPath) paths.push(localPath);
  }
  if (!paths.length) return;
  const dropResult = await bridge.invoke("media-library:add-dropped-paths", paths);
  const sources = Array.isArray(dropResult?.sources) ? dropResult.sources : [];
  const added = Array.isArray(dropResult?.items) ? dropResult.items : [];
  const count = sources.length + added.length;
  if (count) {
    bridge.showToast(`Kept ${count} item${count === 1 ? "" : "s"} in Media`, {
      onUndo: () => void Promise.all([
        ...sources.map((source) => bridge.invoke("media-library:remove-source", source.id)),
        added.length ? bridge.invoke("media-library:remove-added-items", added.map((item) => item.id)) : null,
      ].filter(Boolean)).then(refresh),
    });
  } else {
    bridge.showToast("No supported media found");
  }
  if (added.length) {
    await revealAddedItems(added);
  } else {
    await refresh();
  }
}

async function revealAddedItems(added) {
  state.sourceId = "added-files";
  state.parentId = "";
  state.selectedId = "";
  state.highlightedIds = new Set(added.map((item) => item.id));
  state.query = "";
  element("mediaLibrarySearch").value = "";
  const kinds = [...new Set(added.map((item) => item.kind).filter(Boolean))];
  state.kind = kinds.length === 1 ? kinds[0] : "";
  element("mediaLibraryFilters")?.querySelectorAll("[data-media-kind]").forEach((button) => {
    const active = button.dataset.mediaKind === state.kind;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  element("mediaLibraryTitle").textContent = "Added Files";
  element("mediaLibraryWorkspace").classList.remove("is-browsing");
  await refreshSnapshot();
  await runQuery();
  while (state.hasMore && added.some((item) => !state.items.some((entry) => entry.id === item.id))) {
    await runQuery({ append: true });
  }
  requestAnimationFrame(() => {
    const first = element("mediaLibraryItems")?.querySelector(".media-library__item.is-drop-revealed");
    first?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    first?.focus?.({ preventScroll: true });
  });
}

async function handlePreviewDrop(dataTransfer) {
  const file = Array.from(dataTransfer?.files || [])[0];
  const localPath = file ? bridge.getPathForFile(file) : "";
  if (!localPath) return;
  const activity = await bridge.invoke("media-library:record-activity", { localPath, actionKind: "previewed" });
  if (!activity?.itemId) { bridge.showToast("This file cannot be previewed"); return; }
  const item = await bridge.invoke("media-library:get-item", activity.itemId);
  if (item) showDetails(item, { focus: true });
}

function bindEvents(workspace) {
  workspace.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (pickerRequest) {
      event.preventDefault();
      finishPicker(null);
      return;
    }
    if (isInspecting()) {
      event.preventDefault();
      leaveInspect();
    }
  });
  // Media sits inside the live preview stack. Stop pointer events from
  // reaching #preview, which would toggle playback instead of selecting
  // the next library item.
  ["pointerdown", "mousedown", "mouseup", "click"].forEach((eventName) => {
    workspace.addEventListener(eventName, (event) => event.stopPropagation());
  });
  workspace.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    if (!event.target?.closest?.("input, textarea, select")) event.preventDefault();
  });
  element("mediaLibraryAddSourceBtn")?.addEventListener("click", addSource);
  element("mediaLibraryAddSourceCompactBtn")?.addEventListener("click", addSource);
  element("mediaLibraryBackBtn")?.addEventListener("click", () => {
    closeDetails({ preserveScroll: false });
    workspace.classList.add("is-browsing");
  });
  element("mediaLibraryCloseDetails")?.addEventListener("click", closeDetails);
  element("mediaLibraryLeaveInspectBtn")?.addEventListener("click", leaveInspect);
  element("mediaLibraryReturnBtn")?.addEventListener("click", () => {
    bridge.showMediaWorkspace?.();
  });
  element("mediaLibraryPreview")?.addEventListener("pointerdown", (event) => {
    const media = event.currentTarget.querySelector("video, audio");
    if (!media) return;
    media.draggable = !isLibraryPreviewControlPointer(event);
  }, true);
  element("mediaLibraryPreview")?.addEventListener("dragstart", (event) => {
    const preview = element("mediaLibraryPreview");
    const media = preview?.querySelector("img, video, audio");
    const item = selectedItem();
    if (!preview || !canDragLibraryPreviewItem(item) || isLibraryPreviewControlPointer(event)) {
      event.preventDefault();
      return;
    }
    if (event.target !== preview && event.target !== media && !event.target.closest?.(".media-library__preview-player, .media-library__preview-audio-icon")) {
      event.preventDefault();
      return;
    }
    if (!beginMediaLibraryItemDrag(event, item)) return;
    (media || preview).classList.add("is-dragging");
  });
  element("mediaLibraryPreview")?.addEventListener("dragend", () => {
    mediaLibraryDragItemId = "";
    element("mediaLibraryPreview")?.classList.remove("is-dragging");
    element("mediaLibraryPreview")?.querySelectorAll(".is-dragging").forEach((media) => {
      media.classList.remove("is-dragging");
    });
  });
  element("mediaLibraryPreview")?.addEventListener("click", (event) => {
    if (mediaLibraryDragConsumedClick) {
      mediaLibraryDragConsumedClick = false;
      return;
    }
    if (event.target.closest(".media-library__preview-controls, .media-library__presentation-controls, button, input")) return;
    if (isInspecting()) {
      const media = event.currentTarget.querySelector("video, audio");
      if (media) {
        if (media.paused) void media.play().catch(() => {});
        else media.pause();
      }
      return;
    }
    enterInspect();
  });
  element("mediaLibraryCancelPickerBtn")?.addEventListener("click", () => finishPicker(null));
  element("mediaLibraryItems")?.addEventListener("scroll", maybeLoadMore, { passive: true });
  element("mediaLibraryAddScheduleBtn")?.addEventListener("click", () => void addItemToSchedule());
  element("mediaLibraryEmptyAction")?.addEventListener("click", (event) => {
    const action = event.currentTarget.dataset.action;
    if (action === "add-source") void addSource();
    if (action === "clear-search") { element("mediaLibrarySearch").value = ""; state.query = ""; void runQuery(); }
    if (action === "clear-filter") setKind("");
    if (action === "refresh") void bridge.invoke("media-library:rescan", state.sourceId === "all" ? "" : state.sourceId).then(refresh);
  });

  let searchTimer = null;
  element("mediaLibrarySearch")?.addEventListener("input", (event) => {
    state.query = event.currentTarget.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void runQuery(), 140);
  });
  element("mediaLibraryFilters")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-media-kind]");
    if (button) setKind(button.dataset.mediaKind);
  });
  document.addEventListener("click", (event) => {
    const menu = element("mediaLibraryPathMenu");
    if (!menu || menu.hidden) return;
    if (event.target.closest("#mediaLibraryPathMenu, #mediaLibraryPathOverflow")) return;
    menu.hidden = true;
    element("mediaLibraryPathOverflow")?.setAttribute("aria-expanded", "false");
  });
  workspace.addEventListener("click", async (event) => {
    const remove = event.target.closest("[data-remove-media-source]");
    if (remove) {
      const source = state.snapshot.sources.find((entry) => entry.id === remove.dataset.removeMediaSource);
      const confirmation = source
        ? await bridge.invoke("show-renderer-message-box", {
            type: "question",
            title: "Remove Media Source",
            message: `Remove “${source.displayName}” from Media?`,
            detail: "The original files will stay in place.",
            buttons: ["Cancel", "Remove"],
            defaultId: 0,
            cancelId: 0,
          })
        : null;
      if (source && confirmation?.response === 1) {
        await bridge.invoke("media-library:remove-source", source.id);
        if (state.sourceId === source.id) state.sourceId = "all";
        bridge.showToast(`Removed ${source.displayName} from Media`);
        await refresh();
      }
      return;
    }
    const sourceButton = event.target.closest("[data-media-source]");
    if (sourceButton) { setSource(sourceButton.dataset.mediaSource); return; }
    const folderButton = event.target.closest("[data-media-folder]");
    if (folderButton) {
      state.parentId = folderButton.dataset.mediaFolder || "";
      closeDetails({ preserveScroll: false });
      const folderName = state.parentId.split("/").pop();
      const source = state.snapshot.sources.find((entry) => entry.id === state.sourceId);
      element("mediaLibraryTitle").textContent = folderName || source?.displayName || "Media";
      await runQuery();
      return;
    }
    const itemButton = event.target.closest("[data-media-item-id]");
    if (itemButton && itemButton.closest("#mediaLibraryItems")) {
      if (mediaLibraryDragConsumedClick) {
        mediaLibraryDragConsumedClick = false;
        return;
      }
      state.highlightedIds.clear();
      showDetails(state.items.find((item) => item.id === itemButton.dataset.mediaItemId));
    }
  });
  element("mediaLibraryItems")?.addEventListener("dblclick", (event) => {
    const button = event.target.closest("[data-media-item-id]");
    if (button) showDetails(state.items.find((item) => item.id === button.dataset.mediaItemId), { focus: true, inspect: true });
  });
  element("mediaLibraryItems")?.addEventListener("keydown", (event) => {
    const buttons = [...element("mediaLibraryItems").querySelectorAll("[data-media-item-id], .media-library__item--folder")];
    if (!buttons.length) return;
    const current = document.activeElement.closest?.("[data-media-item-id], .media-library__item--folder");
    let index = Math.max(0, buttons.indexOf(current));
    if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      index += ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1;
      const next = buttons[Math.max(0, Math.min(buttons.length - 1, index))];
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest" });
      const item = state.items.find((entry) => entry.id === next.dataset.mediaItemId);
      if (item && !element("mediaLibraryDetails")?.hidden) showDetails(item);
    } else if (event.key === "Enter" && event.ctrlKey && selectedItem()) {
      event.preventDefault(); void addItemToSchedule();
    } else if (event.key === "Enter" && current?.dataset.mediaFolder != null) {
      event.preventDefault();
      current.click();
    } else if (event.key === "Enter" && current) {
      event.preventDefault();
      showDetails(state.items.find((item) => item.id === current.dataset.mediaItemId), { focus: true, inspect: true });
    } else if (event.key === " " && selectedItem()) {
      event.preventDefault();
      const media = element("mediaLibraryPreview")?.querySelector("video, audio");
      if (media) media.paused ? void media.play() : media.pause();
    }
  });
  element("mediaLibraryItems")?.addEventListener("dragstart", (event) => {
    const button = event.target.closest("[data-media-item-id]");
    const item = state.items.find((entry) => entry.id === button?.dataset.mediaItemId);
    if (!beginMediaLibraryItemDrag(event, item)) return;
    button.classList.add("is-dragging");
  });
  element("mediaLibraryItems")?.addEventListener("dragend", () => {
    mediaLibraryDragItemId = "";
    element("mediaLibraryItems")?.querySelectorAll(".is-dragging").forEach((card) => {
      card.classList.remove("is-dragging");
    });
  });
  workspace.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types || !Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy";
  });
  workspace.addEventListener("drop", (event) => {
    event.preventDefault(); event.stopPropagation();
    if (mediaLibraryDragIsActive(event.dataTransfer)) return;
    const operation = event.target.closest?.("#mediaLibraryDetails")
      ? handlePreviewDrop(event.dataTransfer)
      : handleExternalDrop(event.dataTransfer);
    void operation.catch((err) => { console.error(err); bridge.showToast("Dropped media could not be added"); });
  });
}

export function configureMediaLibraryWorkspace(options) {
  bridge = options;
}

export function installMediaLibraryWorkspace() {
  const workspace = element("mediaLibraryWorkspace");
  if (!workspace || installed || !bridge) return;
  installed = true;
  bindEvents(workspace);
  layoutObserver = new ResizeObserver(([entry]) => {
    syncMediaLibraryLayout(entry.contentRect.width);
  });
  layoutObserver.observe(workspace);
  syncMediaLibraryLayout(workspace.getBoundingClientRect().width);
  bridge.on("media-library:changed", (...args) => {
    const change = args.find((value) => value && typeof value === "object" && typeof value.kind === "string") || null;
    if (change?.kind === "recent-changed") {
      const changedIds = Array.isArray(change.ids) ? change.ids : [];
      const cameFromThisPreview = changedIds.length > 0 &&
        changedIds.every((itemId) => pendingPreviewActivityIds.has(itemId));
      changedIds.forEach((itemId) => pendingPreviewActivityIds.delete(itemId));
      // showDetails() already committed this selection. Re-querying for its
      // activity used to collapse a deeply paginated grid to page one before
      // rebuilding it, making the newly selected preview appear to vanish.
      if (cameFromThisPreview || state.sourceId !== "recent" || state.selectedId) return;
    }
    scheduleRefresh();
  });
  void refresh({ preserveScroll: false });
}

function syncMediaLibraryReturnButton() {
  const button = element("mediaLibraryReturnBtn");
  if (!button) return;
  const libraryVisible = element("mediaLibraryWorkspace")?.hidden === false;
  button.hidden = libraryVisible || !returnToLibraryAfterPreview;
}

export function isMediaLibraryReturnable() {
  return returnToLibraryAfterPreview;
}

export function hideMediaLibraryWorkspaceForSchedulePreview() {
  const visible = element("mediaLibraryWorkspace")?.hidden === false;
  hideMediaLibraryWorkspace({ returnable: visible || returnToLibraryAfterPreview });
}

function disableMediaWorkspaceScrubber() {
  document.getElementById("customControls")?.style.setProperty("visibility", "hidden");
  const timeline = document.getElementById("timeline");
  if (timeline) timeline.disabled = true;
}

function hideMediaLibraryCountdown() {
  const countdown = document.getElementById("mediaCntDn");
  if (!countdown) return;
  countdown.dataset.countdownAllowed = "false";
  countdown.hidden = true;
  countdown.classList.remove("is-active");
}

export function showMediaLibraryWorkspace() {
  const workspace = element("mediaLibraryWorkspace");
  if (!workspace) return;
  if (pickerRequest) finishPicker(null);
  returnToLibraryAfterPreview = false;
  workspace.hidden = false;
  disableMediaWorkspaceScrubber();
  hideMediaLibraryCountdown();
  syncMediaLibraryReturnButton();
  element("previewEmptyState")?.setAttribute("hidden", "");
  element("mediaLibraryCancelPickerBtn")?.setAttribute("hidden", "");
  element("mediaLibraryFilters")?.querySelectorAll("[data-media-kind]").forEach((button) => { button.hidden = false; });
  const source = state.snapshot.sources.find((entry) => entry.id === state.sourceId);
  element("mediaLibraryTitle").textContent = state.sourceId === "recent" ? "Recent" : source?.displayName || "Media";
  installMediaLibraryWorkspace();
  scheduleRefresh(0);
}

export function hideMediaLibraryWorkspace({ returnable = false } = {}) {
  const workspace = element("mediaLibraryWorkspace");
  if (!workspace) return;
  returnToLibraryAfterPreview = returnable === true;
  workspace.classList.remove("is-inspecting");
  workspace.hidden = true;
  disposePresentationPreview();
  workspace.querySelectorAll("video, audio").forEach((media) => media.pause());
  syncMediaLibraryReturnButton();
}

function finishPicker(item) {
  if (!pickerRequest) return;
  const request = pickerRequest;
  pickerRequest = null;
  element("mediaLibraryWorkspace").hidden = true;
  element("mediaLibraryCancelPickerBtn").hidden = true;
  element("mediaLibraryAddScheduleBtn").textContent = "Add to Schedule";
  element("mediaLibraryTitle").textContent = "Media";
  closeDetails({ preserveScroll: false });
  request.resolve(item);
}

export function openMediaLibraryPicker({ title = "Choose Media", kinds = ["image", "video"] } = {}) {
  if (!bridge) return Promise.resolve(null);
  installMediaLibraryWorkspace();
  if (pickerRequest) finishPicker(null);
  return new Promise((resolve) => {
    pickerRequest = { resolve, kinds: Array.isArray(kinds) ? kinds : [] };
    state.sourceId = "all";
    state.parentId = "";
    state.kind = "";
    const workspace = element("mediaLibraryWorkspace");
    workspace.hidden = false;
    disableMediaWorkspaceScrubber();
    hideMediaLibraryCountdown();
    workspace.classList.remove("is-browsing");
    element("mediaLibraryTitle").textContent = title;
    element("mediaLibraryCancelPickerBtn").hidden = false;
    element("mediaLibraryAddScheduleBtn").textContent = "Choose";
    element("mediaLibraryFilters")?.querySelectorAll("[data-media-kind]").forEach((button) => {
      const kind = button.dataset.mediaKind;
      button.hidden = Boolean(kind && !pickerRequest.kinds.includes(kind));
    });
    closeDetails({ preserveScroll: false });
    void runQuery();
  });
}

export function mediaLibraryDragIsActive(dataTransfer) {
  if (mediaLibraryDragItemId) return true;
  return Boolean(dataTransfer?.types && Array.from(dataTransfer.types).includes(MEDIA_ITEM_DRAG_TYPE));
}

export function mediaLibraryItemIdFromDataTransfer(dataTransfer) {
  return mediaLibraryDragItemId || dataTransfer?.getData?.(MEDIA_ITEM_DRAG_TYPE) || "";
}

export async function resolveMediaLibraryDragItem(itemId) {
  return itemId && bridge ? bridge.invoke("media-library:get-item", itemId) : null;
}

export async function recordScheduledMediaPaths(paths) {
  if (!bridge || !Array.isArray(paths)) return;
  for (const localPath of paths) {
    await bridge.invoke("media-library:record-activity", { localPath, actionKind: "scheduled" });
  }
}
