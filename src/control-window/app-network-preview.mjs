/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/*
 * Network preview: HLS, DASH, WebRTC, transport state, and schedule-item dialogs.
 */

import {
  MEDIAPLAYER,
  TAB_PANEL_MEDIA_ID,
  activeLiveStream,
  activeMediaWindowContentType,
  activePresentationOwnsPreviewAudio,
  activePreviewResolvedMediaFile,
  activeResolvedMediaFile,
  beginPreviewForwardingSuppression,
  clampMediaTime,
  classifyQueueMediaType,
  createQueueEntry,
  currentLiveQueueItem,
  currentMode,
  currentPreviewCue,
  currentQueueIndex,
  disableNativeVideoControls,
  endPreviewForwardingSuppression,
  generateNetworkItemDialogHTML,
  getConfidenceMonitorElement,
  insertQueueEntriesAfterSelection,
  invalidateQueueUndoToastAfterMutation,
  invoke,
  isActiveMediaWindow,
  isCurrentPreviewLoad,
  isLocalAppWindowPresentationActive,
  isNetworkStreamSource,
  isPlayInterruptedError,
  isVideoPreviewCueActive,
  mediaFile,
  mediaQueue,
  mediaSourcesMatch,
  networkPreviewCueDashManifestObjectUrl,
  networkPreviewCueDashPlayer,
  networkPreviewCueHlsInstance,
  networkPreviewCueLiveEdge,
  networkPreviewCueSource,
  networkPreviewMirrorLiveEdge,
  networkPreviewMirrorSource,
  normalizeLiveEdgeQueueItemsForSources,
  normalizeMediaPathForCompare,
  on,
  onQueueItemActivate,
  pathToMediaUrl,
  playVideoSafely,
  previewCueVideo,
  queueBasename,
  queueItemIsLiveEdgeStream,
  refreshPreviewControlsForCurrentMedia,
  renderQueue,
  saveMediaFile,
  send,
  setConfidenceMonitorActive,
  setPreviewCueVideoLocalAudio,
  setSBFormMediaPlayer,
  setSharedRendererState,
  setupCustomMediaControls,
  showGnomeToast,
  startTime,
  streamVolume,
  syncGtkSliderToCueState,
  syncPreviewAudioTrackState,
  video,
  vlCtl,
  waitForMediaElementBuffer,
  waitForMediaElementFrame,
} from "./app-renderer.mjs";

let networkPreviewHlsInstance = null;

let networkPreviewDashPlayer = null;

let networkPreviewDashManifestObjectUrl = null;

let networkPreviewMirrorStream = null;

let networkPreviewRtcPeer = null;

let networkPreviewRtcSessionId = "";

let networkPreviewRtcPendingCandidates = [];

let networkPreviewStatusToken = 0;

let networkPreviewStatusCleanup = null;

let networkPreviewStatusState = "";

let networkPreviewStatusShownAt = 0;

let networkPreviewTransportState = {
  currentTime: 0,
  duration: 0,
  updatedAt: 0,
  paused: true,
  volume: 1,
  muted: false,
  mediaFile: "",
};

const NETWORK_PREVIEW_PREROLL_BUFFER_SECONDS = 12;

const NETWORK_PREVIEW_PREROLL_TIMEOUT_MS = 12000;

const NETWORK_PREVIEW_MIN_LOADING_STATUS_MS = 500;

function networkPreviewRepresentsMediaFile(filePath) {
  if (!isNetworkStreamSource(filePath)) return false;
  const liveItem =
    currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
      ? mediaQueue[currentQueueIndex]
      : null;
  return [
    liveItem?.path,
    networkPreviewMirrorSource,
    activePreviewResolvedMediaFile,
    activeResolvedMediaFile,
  ].some(
    (candidate) =>
      candidate &&
      normalizeMediaPathForCompare(candidate) === normalizeMediaPathForCompare(filePath),
  );
}

function networkPreviewMirrorLiveEdgeMatches(...sources) {
  if (!networkPreviewMirrorLiveEdge || !networkPreviewMirrorSource) return false;
  return sources.some((source) => mediaSourcesMatch(networkPreviewMirrorSource, source));
}

function isNetworkVideoPreviewCueActive() {
  const cue = currentPreviewCue();
  return Boolean(
    isVideoPreviewCueActive() &&
      cue &&
      (isNetworkStreamSource(cue.item?.path) ||
        isNetworkStreamSource(networkPreviewCueSource)),
  );
}

function setNetworkPreviewCueAudio(el = previewCueVideo) {
  setPreviewCueVideoLocalAudio(el);
  if (!el || !activePresentationOwnsPreviewAudio()) return;
  el.muted = true;
  el.defaultMuted = true;
}

async function primeNetworkPreviewElement(mediaEl, restoreAudioState, options = {}) {
  if (!mediaEl) return false;
  if (mediaEl.srcObject) return false;
  const isCurrent =
    typeof options.isCurrent === "function" ? options.isCurrent : () => true;
  if (!isCurrent()) return false;
  const startTime = Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : 0;

  beginPreviewForwardingSuppression();
  try {
    mediaEl.preload = "auto";
    await waitForMediaElementFrame(mediaEl);
    if (!isCurrent()) return false;
    await waitForMediaElementBuffer(mediaEl);
    if (!isCurrent()) return false;
    if (
      Number.isFinite(mediaEl.duration) &&
      mediaEl.duration > 0 &&
      Number.isFinite(startTime) &&
      Math.abs(mediaEl.currentTime - startTime) > 0.1
    ) {
      try {
        mediaEl.currentTime = clampMediaTime(startTime, mediaEl.duration);
      } catch {}
    }
    return true;
  } catch (err) {
    if (!isPlayInterruptedError(err)) {
      console.error("Failed to prime network preview:", err);
    }
    return false;
  } finally {
    if (isCurrent() && typeof restoreAudioState === "function") {
      restoreAudioState(mediaEl);
    }
    endPreviewForwardingSuppression();
  }
}

const NETWORK_ITEM_KINDS = new Set(["auto", "stream", "video", "audio"]);

const NETWORK_ITEM_PROTOCOLS = new Set(["http:", "https:", "rtsp:", "rtmp:"]);

function normalizeNetworkScheduleUrl(value) {
  let candidate = String(value || "").trim();
  if (!candidate) return "";
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate);
  if (!hasScheme) {
    if (
      /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]|[^/\s]+\.[^/\s]+)(?::\d+)?(?:[/?#]|$)/i.test(
        candidate,
      )
    ) {
      candidate = `https://${candidate}`;
    } else {
      return "";
    }
  }
  try {
    const url = new URL(candidate);
    if (!NETWORK_ITEM_PROTOCOLS.has(url.protocol)) return "";
    if (!url.hostname) return "";
    return url.href;
  } catch {
    return "";
  }
}

function networkItemTypeFromKind(url, kind) {
  switch (kind) {
    case "audio":
      return "audio";
    case "stream":
    case "video":
      return "video";
    default:
      return classifyQueueMediaType(url);
  }
}

function networkItemNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (/youtu\.be|youtube\.com/i.test(parsed.hostname)) return "YouTube Video";
    const pathName = decodeURIComponent(parsed.pathname || "");
    const leaf = pathName.split("/").filter(Boolean).pop();
    if (leaf) return leaf;
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return queueBasename(url);
  }
}

async function resolveNetworkItemDisplayName(url, name) {
  const details = await resolveNetworkItemDetails(url, name);
  return details.displayName;
}

async function resolveNetworkItemDetails(url, name) {
  const explicitName = typeof name === "string" ? name.trim() : "";
  const details = {
    displayName: explicitName || networkItemNameFromUrl(url),
    youtubeMetadata: null,
  };
  if (!matchYouTubeNetworkUrl(url)) return details;

  try {
    const metadata = await invoke("get-youtube-metadata", url);
    details.youtubeMetadata = metadata && typeof metadata === "object" ? metadata : null;
    const title = typeof metadata?.title === "string" ? metadata.title.trim() : "";
    if (!explicitName && title) details.displayName = title;
  } catch (err) {
    console.error("Failed to resolve YouTube title:", err);
  }
  return details;
}

function createNetworkQueueEntry({ url, name, kind, youtubeMetadata = null }) {
  const safeKind = NETWORK_ITEM_KINDS.has(kind) ? kind : "auto";
  const displayName =
    typeof name === "string" && name.trim().length > 0
      ? name.trim()
      : networkItemNameFromUrl(url);
  const entry = createQueueEntry(url, {
    name: displayName,
    type: networkItemTypeFromKind(url, safeKind),
  });
  entry.originalName = displayName;
  entry.originalPath = url;
  entry.missing = false;
  entry.liveSource = undefined;
  entry.networkSource = {
    kind: safeKind,
    addedAt: new Date().toISOString(),
  };
  if (youtubeMetadata && typeof youtubeMetadata === "object") {
    entry.networkSource.youtubeVideoId =
      typeof youtubeMetadata.videoId === "string" ? youtubeMetadata.videoId : undefined;
    entry.networkSource.author =
      typeof youtubeMetadata.author === "string" ? youtubeMetadata.author : undefined;
    entry.networkSource.isLive = youtubeMetadata.isLive === true;
  }
  if (safeKind === "stream") {
    entry.networkSource.isLive = true;
  }
  if (queueItemIsLiveEdgeStream(entry)) {
    entry.loop = false;
    entry.cueStartTime = 0;
  }
  return entry;
}

async function enqueueNetworkScheduleItem(options) {
  const url = normalizeNetworkScheduleUrl(options?.url);
  if (!url) return false;
  if (currentMode !== MEDIAPLAYER) {
    setSBFormMediaPlayer();
  }

  invalidateQueueUndoToastAfterMutation();
  const itemDetails = await resolveNetworkItemDetails(url, options?.name);
  const entry = createNetworkQueueEntry({
    url,
    name: itemDetails.displayName,
    kind: options?.kind,
    youtubeMetadata: itemDetails.youtubeMetadata,
  });
  const firstNewIndex = insertQueueEntriesAfterSelection([entry]);
  if (firstNewIndex < 0) return false;
  renderQueue();
  saveMediaFile();
  showGnomeToast("Network item added");

  if (
    !isActiveMediaWindow() &&
    !isLocalAppWindowPresentationActive() &&
    mediaQueue[firstNewIndex]
  ) {
    try {
      await onQueueItemActivate(firstNewIndex);
    } catch (err) {
      console.error("Failed to load network item preview:", err);
    }
  }
  return true;
}

function ensureNetworkItemDialog(panel = document.getElementById(TAB_PANEL_MEDIA_ID)) {
  if (!panel) return null;
  let dialog = document.getElementById("networkItemDialog");
  if (!dialog) {
    panel.insertAdjacentHTML("beforeend", generateNetworkItemDialogHTML());
    dialog = document.getElementById("networkItemDialog");
  }
  return dialog;
}

function networkItemDialogElements() {
  const dialog = document.getElementById("networkItemDialog");
  if (!dialog) return {};
  return {
    dialog,
    form: document.getElementById("networkItemForm"),
    urlInput: document.getElementById("networkItemUrlInput"),
    nameInput: document.getElementById("networkItemNameInput"),
    addButton: document.getElementById("networkItemAddBtn"),
    cancelButton: document.getElementById("networkItemCancelBtn"),
    validation: document.getElementById("networkItemValidation"),
  };
}

function selectedNetworkItemKind(form) {
  const checked = form?.querySelector?.('input[name="networkItemKind"]:checked');
  const value = checked?.value || "auto";
  return NETWORK_ITEM_KINDS.has(value) ? value : "auto";
}

function updateNetworkItemDialogState() {
  const { urlInput, addButton, validation } = networkItemDialogElements();
  if (!urlInput || !addButton) return;
  const rawUrl = urlInput.value || "";
  const normalized = normalizeNetworkScheduleUrl(rawUrl);
  const hasInput = rawUrl.trim().length > 0;
  const valid = normalized.length > 0;
  addButton.disabled = !valid;
  urlInput.setAttribute("aria-invalid", hasInput && !valid ? "true" : "false");
  if (validation) {
    validation.textContent = hasInput && !valid
      ? "Use an HTTP, HTTPS, RTSP, or RTMP URL."
      : "";
  }
}

function resetNetworkItemDialog() {
  const { form, urlInput, nameInput, validation } = networkItemDialogElements();
  if (form) form.reset();
  if (urlInput) urlInput.value = "";
  if (nameInput) nameInput.value = "";
  if (validation) validation.textContent = "";
  updateNetworkItemDialogState();
}

function openNetworkItemDialog() {
  const dialog = ensureNetworkItemDialog();
  if (!dialog) return;
  installNetworkItemDialog();
  if (dialog.open) return;
  resetNetworkItemDialog();
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
  window.setTimeout(() => {
    document.getElementById("networkItemUrlInput")?.focus();
  }, 0);
}

function closeNetworkItemDialog() {
  const { dialog } = networkItemDialogElements();
  if (!dialog) return;
  if (typeof dialog.close === "function" && dialog.open) {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
}

function installNetworkItemDialog() {
  const dialog = ensureNetworkItemDialog();
  if (!dialog || dialog.dataset.networkItemDialogBound === "1") return;
  dialog.dataset.networkItemDialogBound = "1";
  const { form, urlInput, nameInput, cancelButton } = networkItemDialogElements();
  urlInput?.addEventListener("input", updateNetworkItemDialogState);
  nameInput?.addEventListener("input", updateNetworkItemDialogState);
  form?.querySelectorAll?.('input[name="networkItemKind"]').forEach((radio) => {
    radio.addEventListener("change", updateNetworkItemDialogState);
  });
  cancelButton?.addEventListener("click", closeNetworkItemDialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeNetworkItemDialog();
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const normalizedUrl = normalizeNetworkScheduleUrl(urlInput?.value);
    if (!normalizedUrl) {
      updateNetworkItemDialogState();
      urlInput?.focus();
      return;
    }
    const kind = selectedNetworkItemKind(form);
    const name = nameInput?.value || "";
    closeNetworkItemDialog();
    void enqueueNetworkScheduleItem({
      url: normalizedUrl,
      name,
      kind,
    }).catch((err) => {
      console.error("Failed to add network item:", err);
      showGnomeToast("Failed to add network item");
    });
  });
  updateNetworkItemDialogState();
}

function installNetworkItemButton() {
  ensureNetworkItemDialog();
  installNetworkItemDialog();
  const button = document.getElementById("addNetworkItemBtn");
  if (!button || button.dataset.networkDialogBound === "1") return;
  button.dataset.networkDialogBound = "1";
  button.addEventListener("click", openNetworkItemDialog);
}

function activeNetworkPreviewSource() {
  const liveItem = currentLiveQueueItem();
  const candidates = [
    mediaFile,
    activeResolvedMediaFile,
    activePreviewResolvedMediaFile,
    liveItem?.path,
  ];
  return candidates.find((source) => isNetworkStreamSource(source)) || "";
}

function networkPreviewUsesRendererCapture() {
  return Boolean(
    currentMode === MEDIAPLAYER &&
      isActiveMediaWindow() &&
      activeMediaWindowContentType === "video" &&
      activeNetworkPreviewSource(),
  );
}

function networkPreviewTransportDuration() {
  return Number.isFinite(networkPreviewTransportState.duration) &&
    networkPreviewTransportState.duration > 0
    ? networkPreviewTransportState.duration
    : 0;
}

function networkPreviewTransportCurrentTime() {
  let current = Number.isFinite(networkPreviewTransportState.currentTime)
    ? networkPreviewTransportState.currentTime
    : 0;
  if (
    !networkPreviewTransportState.paused &&
    Number.isFinite(networkPreviewTransportState.updatedAt) &&
    networkPreviewTransportState.updatedAt > 0
  ) {
    current += Math.max(0, (Date.now() - networkPreviewTransportState.updatedAt) * 0.001);
  }
  const duration = networkPreviewTransportDuration();
  return duration > 0 ? clampMediaTime(current, duration) : Math.max(0, current);
}

function networkPreviewTransportSeekable() {
  return (
    networkPreviewUsesRendererCapture() &&
    !activeNetworkPreviewHidesScrubber() &&
    networkPreviewTransportDuration() > 0
  );
}

function resetNetworkPreviewTransportState(source = activeNetworkPreviewSource()) {
  const volume = Math.max(
    0,
    Math.min(
      1,
      Number.isFinite(video?.volume)
        ? video.volume
        : networkPreviewTransportState.volume,
    ),
  );
  networkPreviewTransportState = {
    currentTime: 0,
    duration: 0,
    updatedAt: Date.now(),
    paused: true,
    volume,
    muted: volume === 0,
    mediaFile: source || "",
  };
  refreshNetworkPreviewTransportControls();
}

function updateNetworkPreviewTransportState(state = {}) {
  if (!state || typeof state !== "object") return;
  if (Number.isFinite(state.duration) && state.duration > 0) {
    networkPreviewTransportState.duration = state.duration;
  }
  if (Number.isFinite(state.currentTime) && state.currentTime >= 0) {
    networkPreviewTransportState.currentTime = state.currentTime;
  }
  networkPreviewTransportState.updatedAt = Number.isFinite(state.timestamp)
    ? state.timestamp
    : Date.now();
  if (typeof state.paused === "boolean") {
    networkPreviewTransportState.paused = state.paused;
  }
  if (Number.isFinite(state.volume)) {
    networkPreviewTransportState.volume = Math.max(0, Math.min(1, state.volume));
  }
  if (typeof state.muted === "boolean") {
    networkPreviewTransportState.muted = state.muted;
  }
  if (typeof state.mediaFile === "string" && state.mediaFile.length > 0) {
    networkPreviewTransportState.mediaFile = state.mediaFile;
  }
  if (networkPreviewUsesRendererCapture() && video?.srcObject === networkPreviewMirrorStream) {
    setNetworkPreviewElementCaptureMuted();
  }
  refreshNetworkPreviewTransportControls();
}

async function refreshNetworkPreviewTransportState() {
  if (!networkPreviewUsesRendererCapture()) return null;
  try {
    const state = await invoke("get-media-playback-state");
    if (state && typeof state === "object") {
      updateNetworkPreviewTransportState({
        ...state,
        timestamp: Date.now(),
        mediaFile: mediaFile || activeNetworkPreviewSource(),
      });
      return state;
    }
  } catch (err) {
    console.error("Failed to refresh media-window transport state:", err);
  }
  return null;
}

function refreshNetworkPreviewTransportControls() {
  if (!networkPreviewUsesRendererCapture()) return;
  setupCustomMediaControls.updateControlsForNetworkTransport?.();
  syncGtkSliderToCueState();
}

function setNetworkPreviewTransportPaused(paused) {
  networkPreviewTransportState.currentTime = networkPreviewTransportCurrentTime();
  networkPreviewTransportState.updatedAt = Date.now();
  networkPreviewTransportState.paused = !!paused;
  refreshNetworkPreviewTransportControls();
}

async function seekNetworkPreviewTransport(seekTime) {
  if (!networkPreviewTransportSeekable()) return networkPreviewTransportCurrentTime();
  const duration = networkPreviewTransportDuration();
  const safe = clampMediaTime(seekTime, duration);
  updateNetworkPreviewTransportState({
    currentTime: safe,
    duration,
    timestamp: Date.now(),
  });
  send("timeGoto-message", {
    currentTime: safe,
    timestamp: Date.now(),
  });
  if (
    video &&
    Number.isFinite(video.duration) &&
    video.duration > 0
  ) {
    beginPreviewForwardingSuppression();
    try {
      video.currentTime = clampMediaTime(safe, video.duration);
    } catch {}
    endPreviewForwardingSuppression();
  }
  window.setTimeout(() => {
    void refreshNetworkPreviewTransportState();
  }, 80);
  return safe;
}

function setNetworkPreviewVolume(volume, muted = false) {
  const safe = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
  networkPreviewTransportState.volume = safe;
  networkPreviewTransportState.muted = muted || safe === 0;
  setSharedRendererState({ streamVolume: safe });
  vlCtl(networkPreviewTransportState.muted ? 0 : safe);
  if (video && video.srcObject === networkPreviewMirrorStream) {
    setNetworkPreviewElementCaptureMuted();
  }
  syncGtkSliderToCueState();
}

function matchYouTubeNetworkUrl(url) {
  if (typeof url !== "string" || url.length === 0) return false;
  if (/^[\w-]{11}$/.test(url.trim())) return true;
  try {
    const parsed = new URL(url.includes("://") ? url : `https://${url}`);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    return (
      host === "youtu.be" ||
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com"
    );
  } catch {
    return false;
  }
}

function networkPreviewSourceHidesScrubber(source) {
  if (typeof source !== "string" || source.trim().length === 0) return false;
  return /(?:^rtsp:|^rtmp:|\.m3u8(?:[?#]|$))/i.test(
    source,
  );
}

function queueItemHidesNetworkScrubber(item) {
  if (!item) return false;
  if (
    networkPreviewSourceHidesScrubber(item.path) ||
    networkPreviewSourceHidesScrubber(item.originalPath) ||
    networkPreviewSourceHidesScrubber(item.liveSource?.originalPath)
  ) {
    return true;
  }
  if (item.networkSource?.kind === "stream" || item.networkSource?.isLive === true) {
    return true;
  }
  if (
    item.networkSource &&
    (item.networkSource.kind === "video" ||
      item.networkSource.kind === "audio" ||
      matchYouTubeNetworkUrl(item.path))
  ) {
    return false;
  }
  return networkPreviewSourceHidesScrubber(item.path);
}

function activeNetworkPreviewHidesScrubber() {
  if (activeLiveStream || networkPreviewMirrorLiveEdge) return true;
  const liveItem = currentLiveQueueItem();
  if (queueItemHidesNetworkScrubber(liveItem)) return true;
  return [
    mediaFile,
    networkPreviewMirrorSource,
    activeResolvedMediaFile,
    activePreviewResolvedMediaFile,
    networkPreviewTransportState.mediaFile,
  ].some((source) => networkPreviewSourceHidesScrubber(source));
}

function isHlsNetworkSource(url) {
  return /\.m3u8(?:[?#]|$)/i.test(String(url || ""));
}

function isDashNetworkSource(url) {
  return /\.mpd(?:[?#]|$)/i.test(String(url || ""));
}

function networkPreviewStatusElements() {
  const overlay = document.getElementById("networkPreviewStatusOverlay");
  if (!overlay) return {};
  return {
    overlay,
    title: document.getElementById("networkPreviewStatusTitle"),
    detail: document.getElementById("networkPreviewStatusDetail"),
  };
}

function cleanupNetworkPreviewStatusHandlers() {
  if (typeof networkPreviewStatusCleanup === "function") {
    try {
      networkPreviewStatusCleanup();
    } catch {}
  }
  networkPreviewStatusCleanup = null;
}

function setNetworkPreviewStatus(state, title, detail = "", token = networkPreviewStatusToken) {
  if (token !== networkPreviewStatusToken) return false;
  const { overlay, title: titleEl, detail: detailEl } = networkPreviewStatusElements();
  if (!overlay) return false;
  overlay.dataset.state = state;
  overlay.setAttribute("role", state === "error" ? "alert" : "status");
  overlay.setAttribute("aria-live", state === "error" ? "assertive" : "polite");
  overlay.hidden = false;
  if (titleEl) titleEl.textContent = title || "";
  if (detailEl) detailEl.textContent = detail || "";
  networkPreviewStatusState = state;
  if (state === "loading") {
    networkPreviewStatusShownAt = Date.now();
  }
  return true;
}

function beginNetworkPreviewStatus(detail = "Connecting to stream") {
  networkPreviewStatusToken += 1;
  cleanupNetworkPreviewStatusHandlers();
  const token = networkPreviewStatusToken;
  setNetworkPreviewStatus("loading", "Loading stream", detail, token);
  return token;
}

function showNetworkPreviewLoading(detail = "Loading stream", token = networkPreviewStatusToken) {
  setNetworkPreviewStatus("loading", "Loading stream", detail, token);
}

function showNetworkPreviewError(
  detail = "The stream could not be loaded.",
  token = networkPreviewStatusToken,
) {
  if (token !== networkPreviewStatusToken) return;
  const elapsed = Date.now() - networkPreviewStatusShownAt;
  if (
    networkPreviewStatusState === "loading" &&
    elapsed < NETWORK_PREVIEW_MIN_LOADING_STATUS_MS
  ) {
    window.setTimeout(
      () => showNetworkPreviewError(detail, token),
      NETWORK_PREVIEW_MIN_LOADING_STATUS_MS - elapsed,
    );
    return;
  }
  setNetworkPreviewStatus("error", "Stream failed", detail, token);
}

function hideNetworkPreviewStatus(token = networkPreviewStatusToken) {
  if (token !== networkPreviewStatusToken) return;
  cleanupNetworkPreviewStatusHandlers();
  const { overlay } = networkPreviewStatusElements();
  if (overlay) {
    overlay.hidden = true;
    overlay.dataset.state = "";
  }
  networkPreviewStatusState = "";
}

function resetNetworkPreviewStatus() {
  networkPreviewStatusToken += 1;
  cleanupNetworkPreviewStatusHandlers();
  const { overlay } = networkPreviewStatusElements();
  if (overlay) {
    overlay.hidden = true;
    overlay.dataset.state = "";
  }
  networkPreviewStatusState = "";
}

function installNetworkPreviewStatusHandlers(mediaEl, resources = {}, token = networkPreviewStatusToken) {
  cleanupNetworkPreviewStatusHandlers();
  if (!mediaEl) return;

  const showLoading = () => showNetworkPreviewLoading("Connecting to stream", token);
  const showBuffering = () => {
    if (
      mediaEl.error ||
      mediaEl.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
    ) {
      return;
    }
    showNetworkPreviewLoading("Buffering stream", token);
  };
  const hideReady = () => hideNetworkPreviewStatus(token);
  const showError = () => showNetworkPreviewError("The stream could not be loaded.", token);
  const entries = [
    ["loadstart", showLoading, undefined],
    ["waiting", showBuffering, undefined],
    ["stalled", showBuffering, undefined],
    ["loadeddata", hideReady, undefined],
    ["canplay", hideReady, undefined],
    ["playing", hideReady, undefined],
    ["error", showError, undefined],
  ];

  entries.forEach(([type, handler, options]) => {
    mediaEl.addEventListener(type, handler, options);
  });

  const hlsHandlers = [];
  const hlsEvents = resources.hlsInstance?.constructor?.Events;
  if (resources.hlsInstance && hlsEvents?.MANIFEST_PARSED) {
    const handler = () => showNetworkPreviewLoading("Buffering stream", token);
    resources.hlsInstance.on(hlsEvents.MANIFEST_PARSED, handler);
    hlsHandlers.push([hlsEvents.MANIFEST_PARSED, handler]);
  }
  if (resources.hlsInstance && hlsEvents?.ERROR) {
    const handler = (_event, data) => {
      if (data?.fatal) {
        showNetworkPreviewError(
          data?.details || data?.reason || "The stream could not be loaded.",
          token,
        );
      }
    };
    resources.hlsInstance.on(hlsEvents.ERROR, handler);
    hlsHandlers.push([hlsEvents.ERROR, handler]);
  }

  networkPreviewStatusCleanup = () => {
    entries.forEach(([type, handler, options]) => {
      mediaEl.removeEventListener(type, handler, options);
    });
    if (resources.hlsInstance?.off) {
      hlsHandlers.forEach(([eventName, handler]) => {
        resources.hlsInstance.off(eventName, handler);
      });
    }
  };
}

async function createNetworkPreviewHls() {
  const { default: Hls } = await import("../../node_modules/hls.js/dist/hls.mjs");
  return new Hls({
    lowLatencyMode: false,
    backBufferLength: 180,
    maxBufferLength: 240,
    maxMaxBufferLength: 480,
    maxBufferSize: 240 * 1000 * 1000,
    maxBufferHole: 0.75,
    liveSyncDurationCount: 12,
    liveMaxLatencyDurationCount: 24,
    startFragPrefetch: true,
    testBandwidth: false,
    startLevel: -1,
  });
}

function configureNetworkPreviewDashPlayer(player) {
  try {
    player.updateSettings?.({
      streaming: {
        buffer: {
          stableBufferTime: 60,
          bufferTimeAtTopQuality: 90,
          bufferTimeAtTopQualityLongForm: 180,
          fastSwitchEnabled: true,
          flushBufferAtTrackSwitch: false,
        },
        delay: {
          liveDelayFragmentCount: 8,
        },
        liveCatchup: {
          enabled: false,
        },
      },
    });
  } catch (err) {
    console.error("Failed to configure DASH preview buffering:", err);
  }
}

function teardownNetworkMediaSourceResources(resources = {}) {
  if (resources.hlsInstance) {
    try {
      resources.hlsInstance.destroy();
    } catch {}
  }
  if (resources.dashPlayer) {
    try {
      resources.dashPlayer.reset();
      resources.dashPlayer.destroy?.();
    } catch {}
  }
  if (resources.dashManifestObjectUrl) {
    URL.revokeObjectURL(resources.dashManifestObjectUrl);
  }
}

async function attachNetworkMediaSourceToElement(targetEl, sourcePath, options = {}) {
  const resources = {
    hlsInstance: null,
    dashPlayer: null,
    dashManifestObjectUrl: null,
    liveEdge: false,
    cancelled: false,
  };
  if (!targetEl || !sourcePath) return resources;

  const isCurrent =
    typeof options.isCurrent === "function" ? options.isCurrent : () => true;
  const cancelIfStale = () => {
    if (isCurrent()) return false;
    resources.cancelled = true;
    teardownNetworkMediaSourceResources(resources);
    resources.hlsInstance = null;
    resources.dashPlayer = null;
    resources.dashManifestObjectUrl = null;
    return true;
  };

  const originalSource = String(sourcePath);
  const directUrl = pathToMediaUrl(originalSource);
  let youtubeResolved = null;
  if (matchYouTubeNetworkUrl(originalSource)) {
    youtubeResolved = await invoke("resolve-youtube-stream", originalSource);
    if (cancelIfStale()) return resources;
  }

  if (youtubeResolved?.type === "hls") {
    resources.liveEdge = true;
    resources.hlsInstance = await createNetworkPreviewHls();
    if (cancelIfStale()) return resources;
    resources.hlsInstance.loadSource(youtubeResolved.url);
    resources.hlsInstance.attachMedia(targetEl);
  } else if (youtubeResolved?.type === "dash") {
    const { MediaPlayer } = await import("../../node_modules/dashjs/dist/modern/esm/dash.all.min.js");
    if (cancelIfStale()) return resources;
    resources.dashPlayer = MediaPlayer().create();
    resources.dashManifestObjectUrl = URL.createObjectURL(
      new Blob([youtubeResolved.manifest], { type: "application/dash+xml" }),
    );
    configureNetworkPreviewDashPlayer(resources.dashPlayer);
    resources.dashPlayer.initialize(targetEl, resources.dashManifestObjectUrl, false);
  } else if (youtubeResolved?.type === "progressive") {
    if (cancelIfStale()) return resources;
    targetEl.src = youtubeResolved.url;
  } else if (isHlsNetworkSource(directUrl)) {
    resources.liveEdge = true;
    resources.hlsInstance = await createNetworkPreviewHls();
    if (cancelIfStale()) return resources;
    resources.hlsInstance.loadSource(directUrl);
    resources.hlsInstance.attachMedia(targetEl);
  } else if (isDashNetworkSource(directUrl)) {
    const { MediaPlayer } = await import("../../node_modules/dashjs/dist/modern/esm/dash.all.min.js");
    if (cancelIfStale()) return resources;
    resources.dashPlayer = MediaPlayer().create();
    configureNetworkPreviewDashPlayer(resources.dashPlayer);
    resources.dashPlayer.initialize(targetEl, directUrl, false);
  } else {
    if (cancelIfStale()) return resources;
    targetEl.src = directUrl;
  }

  return resources;
}

function teardownNetworkPreviewStreamingPlayers() {
  if (networkPreviewHlsInstance) {
    try {
      networkPreviewHlsInstance.destroy();
    } catch {}
    networkPreviewHlsInstance = null;
  }
  if (networkPreviewDashPlayer) {
    try {
      networkPreviewDashPlayer.reset();
      networkPreviewDashPlayer.destroy?.();
    } catch {}
    networkPreviewDashPlayer = null;
  }
  if (networkPreviewDashManifestObjectUrl) {
    URL.revokeObjectURL(networkPreviewDashManifestObjectUrl);
    networkPreviewDashManifestObjectUrl = null;
  }
}

function teardownNetworkPreviewCueStreamingPlayers() {
  teardownNetworkMediaSourceResources({
    hlsInstance: networkPreviewCueHlsInstance,
    dashPlayer: networkPreviewCueDashPlayer,
    dashManifestObjectUrl: networkPreviewCueDashManifestObjectUrl,
  });
  setSharedRendererState({ networkPreviewCueHlsInstance: null });
  setSharedRendererState({ networkPreviewCueDashPlayer: null });
  setSharedRendererState({ networkPreviewCueDashManifestObjectUrl: null });
  setSharedRendererState({ networkPreviewCueSource: "" });
  setSharedRendererState({ networkPreviewCueLiveEdge: false });
}

function clearNetworkPreviewMirrorStream() {
  if (networkPreviewMirrorStream) {
    networkPreviewMirrorStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {}
    });
  }
  networkPreviewMirrorStream = null;
}

function setNetworkPreviewElementCaptureMuted() {
  if (!video) return;
  video.muted = true;
  video.defaultMuted = true;
  video.volume = 0;
  video.playsInline = true;
  disableNativeVideoControls(video);
  syncPreviewAudioTrackState();
}

function setNetworkPreviewElementLocalAudio() {
  if (!video) return;
  const presentationOwnsAudio = activePresentationOwnsPreviewAudio();
  video.muted = presentationOwnsAudio;
  video.defaultMuted = presentationOwnsAudio;
  if (!Number.isFinite(video.volume) || video.volume <= 0) {
    video.volume = 1;
  }
  video.playsInline = true;
  disableNativeVideoControls(video);
  syncPreviewAudioTrackState();
}

function prepareNetworkPreviewRtcStream(stream) {
  if (!stream || !video) return false;
  resetNetworkPreviewStatus();
  networkPreviewMirrorStream = stream;
  try {
    video.pause();
    video.removeAttribute("src");
    video.srcObject = stream;
  } catch {}
  video.hidden = false;
  video.style.display = "";
  video.style.visibility = "";
  setNetworkPreviewElementCaptureMuted();
  refreshPreviewControlsForCurrentMedia();
  void video.play().catch((err) => {
    if (!isPlayInterruptedError(err)) {
      console.error("Failed to play network RTC preview:", err);
    }
  });

  const confidenceEl = getConfidenceMonitorElement();
  if (confidenceEl) {
    if (confidenceEl.srcObject !== stream) {
      confidenceEl.srcObject = stream;
    }
    confidenceEl.muted = true;
    confidenceEl.defaultMuted = true;
    confidenceEl.volume = 0;
    disableNativeVideoControls(confidenceEl);
    confidenceEl.hidden = false;
    void confidenceEl.play().catch((err) => {
      if (!isPlayInterruptedError(err)) {
        console.error("Failed to play network confidence preview:", err);
      }
    });
    setConfidenceMonitorActive(true);
  }
  return true;
}

function stopNetworkPreviewRtcCapture(options = {}) {
  const sessionId = networkPreviewRtcSessionId;
  if (options.notifyMedia !== false && sessionId) {
    send("media-preview-rtc-to-media", { type: "close", sessionId });
  }
  if (networkPreviewRtcPeer) {
    try {
      networkPreviewRtcPeer.ontrack = null;
      networkPreviewRtcPeer.onicecandidate = null;
      networkPreviewRtcPeer.onconnectionstatechange = null;
      networkPreviewRtcPeer.close();
    } catch {}
  }
  networkPreviewRtcPeer = null;
  networkPreviewRtcSessionId = "";
  networkPreviewRtcPendingCandidates = [];
  const stream = networkPreviewMirrorStream;
  if (video?.srcObject === stream) {
    try {
      video.pause();
      video.srcObject = null;
    } catch {}
  }
  const confidenceEl = getConfidenceMonitorElement();
  if (confidenceEl?.srcObject === stream) {
    try {
      confidenceEl.pause();
      confidenceEl.srcObject = null;
      confidenceEl.hidden = true;
    } catch {}
  }
  clearNetworkPreviewMirrorStream();
}

function syncNetworkPreviewMirrorCapture() {
  if (!networkPreviewUsesRendererCapture()) {
    stopNetworkPreviewRtcCapture();
    return false;
  }
  teardownNetworkPreviewStreamingPlayers();
  if (networkPreviewMirrorStream) {
    return prepareNetworkPreviewRtcStream(networkPreviewMirrorStream);
  }
  void startNetworkPreviewRtcCapture();
  return false;
}

async function attachNetworkPreviewMirrorSource(sourcePath, loadToken, ownsMainSurface) {
  if (!video || !sourcePath) return false;
  const isCurrent = () =>
    (typeof loadToken !== "number" || isCurrentPreviewLoad(loadToken)) &&
    (typeof ownsMainSurface !== "function" || ownsMainSurface());
  if (!isCurrent()) return false;

  const originalSource = String(sourcePath);
  stopNetworkPreviewRtcCapture();
  teardownNetworkPreviewStreamingPlayers();
  setSharedRendererState({ networkPreviewMirrorSource: originalSource });
  setSharedRendererState({ networkPreviewMirrorLiveEdge: false });
  const statusToken = beginNetworkPreviewStatus("Connecting to stream");
  try {
    video.pause();
    video.srcObject = null;
    video.removeAttribute("src");
    video.load();
  } catch {}

  try {
    const resources = await attachNetworkMediaSourceToElement(video, originalSource, {
      isCurrent,
    });
    if (resources.cancelled) {
      hideNetworkPreviewStatus(statusToken);
      return false;
    }
    networkPreviewHlsInstance = resources.hlsInstance;
    networkPreviewDashPlayer = resources.dashPlayer;
    networkPreviewDashManifestObjectUrl = resources.dashManifestObjectUrl;
    setSharedRendererState({ networkPreviewMirrorLiveEdge: resources.liveEdge || networkPreviewSourceHidesScrubber(originalSource) });
    if (networkPreviewMirrorLiveEdge) {
      normalizeLiveEdgeQueueItemsForSources(originalSource);
    }
    installNetworkPreviewStatusHandlers(video, resources, statusToken);

    video.hidden = false;
    video.style.display = "";
    video.style.visibility = "";
    setNetworkPreviewElementLocalAudio();
    await primeNetworkPreviewElement(video, setNetworkPreviewElementLocalAudio, {
      isCurrent,
    });
    if (!isCurrent()) {
      return false;
    }
    hideNetworkPreviewStatus(statusToken);
    setupCustomMediaControls.updateControlsForMetadata?.(video);
    return true;
  } catch (err) {
    showNetworkPreviewError("The stream could not be loaded.", statusToken);
    throw err;
  }
}

async function playNetworkPreviewMirror(context = "") {
  if (!video || !networkPreviewUsesRendererCapture()) return false;
  setNetworkPreviewElementCaptureMuted();
  if (!networkPreviewMirrorStream) {
    await startNetworkPreviewRtcCapture();
  }
  const played = await playVideoSafely(video, context, { logFailure: false });
  syncNetworkPreviewMirrorCapture();
  return played;
}

async function startNetworkPreviewRtcCapture() {
  if (!networkPreviewUsesRendererCapture() || typeof RTCPeerConnection !== "function") {
    return false;
  }
  if (
    networkPreviewRtcPeer &&
    ["connected", "completed"].includes(networkPreviewRtcPeer.iceConnectionState)
  ) {
    return true;
  }

  teardownNetworkPreviewStreamingPlayers();
  if (video && video.srcObject !== networkPreviewMirrorStream) {
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch {}
  }
  stopNetworkPreviewRtcCapture();
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const peer = new RTCPeerConnection();
  networkPreviewRtcPeer = peer;
  networkPreviewRtcSessionId = sessionId;
  networkPreviewRtcPendingCandidates = [];

  const inboundStream = new MediaStream();
  networkPreviewMirrorStream = inboundStream;
  peer.ontrack = (event) => {
    const [remoteStream] = event.streams || [];
    if (remoteStream) {
      networkPreviewMirrorStream = remoteStream;
    } else if (event.track && !inboundStream.getTracks().includes(event.track)) {
      inboundStream.addTrack(event.track);
    }
    prepareNetworkPreviewRtcStream(networkPreviewMirrorStream || inboundStream);
  };
  peer.onicecandidate = (event) => {
    if (!event.candidate) return;
    send("media-preview-rtc-to-media", {
      type: "candidate",
      sessionId,
      candidate: event.candidate.toJSON
        ? event.candidate.toJSON()
        : event.candidate,
    });
  };
  peer.onconnectionstatechange = () => {
    if (
      peer.connectionState === "failed" ||
      peer.connectionState === "closed" ||
      peer.connectionState === "disconnected"
    ) {
      if (networkPreviewRtcPeer === peer) {
        stopNetworkPreviewRtcCapture({ notifyMedia: peer.connectionState !== "closed" });
      }
    }
  };

  try {
    const offer = await peer.createOffer({
      offerToReceiveVideo: true,
    });
    await peer.setLocalDescription(offer);
    send("media-preview-rtc-to-media", {
      type: "offer",
      sessionId,
      sdp: peer.localDescription?.sdp || offer.sdp,
    });
    return true;
  } catch (err) {
    console.error("Failed to start network preview RTC capture:", err);
    stopNetworkPreviewRtcCapture();
    return false;
  }
}

async function handleMediaPreviewRtcSignal(_event, message = {}) {
  if (!message || message.sessionId !== networkPreviewRtcSessionId) return;
  const peer = networkPreviewRtcPeer;
  if (!peer) return;
  try {
    if (message.type === "answer" && message.sdp) {
      await peer.setRemoteDescription({ type: "answer", sdp: message.sdp });
      const pending = networkPreviewRtcPendingCandidates;
      networkPreviewRtcPendingCandidates = [];
      for (const candidate of pending) {
        await peer.addIceCandidate(candidate);
      }
    } else if (message.type === "candidate" && message.candidate) {
      if (!peer.remoteDescription) {
        networkPreviewRtcPendingCandidates.push(message.candidate);
        return;
      }
      await peer.addIceCandidate(message.candidate);
    } else if (message.type === "closed") {
      stopNetworkPreviewRtcCapture({ notifyMedia: false });
    }
  } catch (err) {
    console.error("Failed to handle network preview RTC signal:", err);
  }
}

export {
  NETWORK_ITEM_KINDS,
  NETWORK_ITEM_PROTOCOLS,
  NETWORK_PREVIEW_MIN_LOADING_STATUS_MS,
  NETWORK_PREVIEW_PREROLL_BUFFER_SECONDS,
  NETWORK_PREVIEW_PREROLL_TIMEOUT_MS,
  activeNetworkPreviewHidesScrubber,
  activeNetworkPreviewSource,
  attachNetworkMediaSourceToElement,
  attachNetworkPreviewMirrorSource,
  beginNetworkPreviewStatus,
  cleanupNetworkPreviewStatusHandlers,
  clearNetworkPreviewMirrorStream,
  closeNetworkItemDialog,
  configureNetworkPreviewDashPlayer,
  createNetworkPreviewHls,
  createNetworkQueueEntry,
  enqueueNetworkScheduleItem,
  ensureNetworkItemDialog,
  handleMediaPreviewRtcSignal,
  hideNetworkPreviewStatus,
  installNetworkItemButton,
  installNetworkItemDialog,
  installNetworkPreviewStatusHandlers,
  isDashNetworkSource,
  isHlsNetworkSource,
  isNetworkVideoPreviewCueActive,
  matchYouTubeNetworkUrl,
  networkItemDialogElements,
  networkItemNameFromUrl,
  networkItemTypeFromKind,
  networkPreviewDashManifestObjectUrl,
  networkPreviewDashPlayer,
  networkPreviewHlsInstance,
  networkPreviewMirrorLiveEdgeMatches,
  networkPreviewMirrorStream,
  networkPreviewRepresentsMediaFile,
  networkPreviewRtcPeer,
  networkPreviewRtcPendingCandidates,
  networkPreviewRtcSessionId,
  networkPreviewSourceHidesScrubber,
  networkPreviewStatusCleanup,
  networkPreviewStatusElements,
  networkPreviewStatusShownAt,
  networkPreviewStatusState,
  networkPreviewStatusToken,
  networkPreviewTransportCurrentTime,
  networkPreviewTransportDuration,
  networkPreviewTransportSeekable,
  networkPreviewTransportState,
  networkPreviewUsesRendererCapture,
  normalizeNetworkScheduleUrl,
  openNetworkItemDialog,
  playNetworkPreviewMirror,
  prepareNetworkPreviewRtcStream,
  primeNetworkPreviewElement,
  queueItemHidesNetworkScrubber,
  refreshNetworkPreviewTransportControls,
  refreshNetworkPreviewTransportState,
  resetNetworkItemDialog,
  resetNetworkPreviewStatus,
  resetNetworkPreviewTransportState,
  resolveNetworkItemDetails,
  resolveNetworkItemDisplayName,
  seekNetworkPreviewTransport,
  selectedNetworkItemKind,
  setNetworkPreviewCueAudio,
  setNetworkPreviewElementCaptureMuted,
  setNetworkPreviewElementLocalAudio,
  setNetworkPreviewStatus,
  setNetworkPreviewTransportPaused,
  setNetworkPreviewVolume,
  showNetworkPreviewError,
  showNetworkPreviewLoading,
  startNetworkPreviewRtcCapture,
  stopNetworkPreviewRtcCapture,
  syncNetworkPreviewMirrorCapture,
  teardownNetworkMediaSourceResources,
  teardownNetworkPreviewCueStreamingPlayers,
  teardownNetworkPreviewStreamingPlayers,
  updateNetworkItemDialogState,
  updateNetworkPreviewTransportState,
};
