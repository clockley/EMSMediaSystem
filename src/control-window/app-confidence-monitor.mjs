const presentationPreviewSnapshots = new WeakMap();

function getOrCreatePreviewStash() {
  let stash = document.getElementById(PREVIEW_STASH_ID);
  if (stash) return stash;

  stash = document.createElement("div");
  stash.id = PREVIEW_STASH_ID;
  stash.setAttribute("aria-hidden", "true");
  // Keep it in the DOM (so HTMLMediaElement playback survives) but invisible
  // and non-interactive so it cannot intercept layout, focus, or hit-testing.
  stash.style.cssText =
    "position: fixed; left: -100000px; top: -100000px;" +
    "width: 1px; height: 1px;" +
    "pointer-events: none; visibility: hidden;" +
    "contain: strict;";
  document.body.appendChild(stash);
  return stash;
}

function stashLivePreview() {
  const dyne = document.getElementById("dyneForm");
  if (!dyne) return;
  const stash = getOrCreatePreviewStash();
  // Match by tag+id so we never sweep stray elements that happen to share id.
  // Image-mode previews leave a hidden <video id="preview"> next to the
  // visible <img id="preview"> — both must travel together so re-entering
  // Media mode finds the same elements in the same order.
  const persistentEls = dyne.querySelectorAll(
    'video#preview, img#preview',
  );
  for (const el of persistentEls) {
    if (el.parentNode !== stash) {
      stash.appendChild(el);
    }
  }
}

/**
 * Ensure the persistent media panel exists under `#dyneForm`. Destroyed when
 * switching to legacy full-destroy modes, recreated here on next media visit.
 */
function ensureDyneTabShell() {
  const dyne = document.getElementById("dyneForm");
  if (!dyne) return;
  if (!document.getElementById(TAB_PANEL_MEDIA_ID)) {
    dyne.innerHTML = generateDyneTabShellHTML();
  }
}

function ensureMediaPanelBuilt() {
  ensureDyneTabShell();
  const panel = document.getElementById(TAB_PANEL_MEDIA_ID);
  if (!panel || panel.dataset.mediaShellBuilt === "1") {
    return;
  }
  panel.innerHTML = generateMediaFormHTML();
  ensureNetworkItemDialog(panel);
  panel.dataset.mediaShellBuilt = "1";
}

function ensureStreamsPanelBuilt() {
  ensureDyneTabShell();
  const panel = document.getElementById(TAB_PANEL_STREAMS_ID);
  if (!panel || panel.dataset.streamsShellBuilt === "1") {
    return;
  }
  panel.innerHTML = generateStreamsPanelHTML();
  panel.dataset.streamsShellBuilt = "1";
  const vol = panel.querySelector("#volume-slider");
  if (vol && panel.dataset.streamsVolumeBound !== "1") {
    panel.dataset.streamsVolumeBound = "1";
    vol.addEventListener("input", handleVolumeChange);
  }
}

function getPreviewMountWrapperForPanel(panelEl) {
  if (!panelEl) return null;
  const streamHost = panelEl.querySelector(".stream-preview-host");
  if (streamHost) return streamHost;
  const previewStack = panelEl.querySelector("#previewStack");
  if (previewStack) return previewStack;
  const mediaWrap = panelEl.querySelector(".video-wrapper");
  if (mediaWrap && !mediaWrap.classList.contains("stream-preview-host")) {
    return mediaWrap;
  }
  const legacyPreview = panelEl.querySelector("video#preview");
  return legacyPreview?.parentElement ?? null;
}

/**
 * Move the stashed live preview (`video#preview` / `img#preview`) into the
 * given panel. Legacy stream layouts use an empty `.stream-preview-host` (no
 * duplicate `#preview` ids while both shells exist); Media uses `.video-wrapper`
 * with a placeholder `<video id="preview">` from `generateMediaFormHTML`, or
 * inserts one if the wrapper was left empty after a stash.
 */
function restoreLivePreviewIntoPanel(panelEl) {
  const stash = document.getElementById(PREVIEW_STASH_ID);
  if (!stash || !panelEl) return false;

  const wrapper = getPreviewMountWrapperForPanel(panelEl);
  if (!wrapper) return false;

  const stashedVideo = stash.querySelector("video#preview");
  const stashedImg = stash.querySelector("img#preview");
  const isStreamsLayout = wrapper.classList.contains("stream-preview-host");

  if (stashedVideo) {
    disableNativeVideoControls(stashedVideo);
    if (isStreamsLayout) {
      const orphan = wrapper.querySelector("video#preview");
      if (orphan && orphan !== stashedVideo) {
        orphan.remove();
      }
      if (stashedVideo.parentNode !== wrapper) {
        wrapper.appendChild(stashedVideo);
      }
    } else {
      let placeholder = wrapper.querySelector("video#preview");
      if (!placeholder) {
        placeholder = document.createElement("video");
        placeholder.id = "preview";
        disableNativeVideoControls(placeholder);
        const cue = wrapper.querySelector("#previewCue");
        const cnt = wrapper.querySelector("#mediaCntDn");
        if (cue && cue.parentNode === wrapper) {
          wrapper.insertBefore(placeholder, cue);
        } else if (cnt && cnt.parentNode === wrapper) {
          cnt.insertAdjacentElement("afterend", placeholder);
        } else {
          wrapper.prepend(placeholder);
        }
      }
      if (placeholder !== stashedVideo) {
        wrapper.replaceChild(stashedVideo, placeholder);
      }
    }
  } else if (isStreamsLayout && !wrapper.querySelector("video#preview")) {
    const v = document.createElement("video");
    v.id = "preview";
    disableNativeVideoControls(v);
    wrapper.appendChild(v);
  }

  if (stashedImg) {
    const orphanImg = wrapper.querySelector("img#preview");
    if (orphanImg && orphanImg !== stashedImg) {
      orphanImg.remove();
    }
    if (stashedImg.parentNode !== wrapper) {
      wrapper.appendChild(stashedImg);
    }
  }

  return Boolean(wrapper.querySelector("video#preview"));
}

/**
 * Restore stashed preview into whichever shell matches `currentMode`, or fall
 * back to scanning `#dyneForm` for legacy layouts (e.g. Text mode teardown).
 */
function restoreLivePreview() {
  const panel =
    currentMode === STREAMPLAYER
      ? document.getElementById(TAB_PANEL_STREAMS_ID)
      : document.getElementById(TAB_PANEL_MEDIA_ID);
  if (panel) {
    return restoreLivePreviewIntoPanel(panel);
  }
  const dyne = document.getElementById("dyneForm");
  return dyne ? restoreLivePreviewIntoPanel(dyne) : false;
}

function getStreamRendererPreviewElement() {
  return document.getElementById("streamRendererPreview");
}

function getConfidenceMonitorElement() {
  return document.getElementById("confidenceMonitorPreview");
}

function getLowerThirdConfidenceMonitorElement() {
  return document.getElementById("confidenceLowerThirdPreview");
}

function getStageConfidenceMonitorElement() {
  return document.getElementById("confidenceStagePreview");
}

let confidenceMonitorPage = "audience";
let confidenceMonitorPopoutActive = false;
let confidenceMonitorPopoutWindow = null;

function audienceAlertActiveForConfidence() {
  const liveAlert = currentAlertsSnapshot.alert;
  const audienceMessageActive = Boolean(
    liveAlert && liveAlert.routes?.audience !== false,
  );
  return Boolean(
    currentAlertsSnapshot.nurseryAlerts.length ||
      audienceMessageActive ||
      latestOutputStatus?.audience?.alert === "live"
  );
}

function activeAlertConfidencePage() {
  const liveAlert = currentAlertsSnapshot.alert;
  if (
    currentAlertsSnapshot.nurseryAlerts.length ||
    (liveAlert && liveAlert.routes?.audience !== false) ||
    latestOutputStatus?.audience?.alert === "live"
  ) {
    return "audience";
  }
  if (
    liveAlert?.routes?.stage ||
    latestOutputStatus?.stage?.alert === "live"
  ) {
    return "stage";
  }
  return null;
}

function audienceOutputAvailableForConfidence() {
  return Boolean(
    isActiveMediaWindow() ||
      (audienceAlertActiveForConfidence() &&
        latestOutputStatus?.audience?.window === "open")
  );
}

function activeConfidenceMonitorPages() {
  const alertPage = activeAlertConfidencePage();
  if (alertPage === "audience" && audienceOutputAvailableForConfidence()) {
    return ["audience"];
  }
  if (alertPage === "stage" && latestOutputStatus?.stage?.window === "open") {
    return ["stage"];
  }
  const pages = [];
  if (audienceOutputAvailableForConfidence()) pages.push("audience");
  if (bibleLowerThirdOutputActive && lastLowerThirdBibleTextMessage) pages.push("lower-third");
  if (latestOutputStatus?.stage?.window === "open") pages.push("stage");
  return pages;
}

function currentConfidenceMonitorVideo() {
  if (confidenceMonitorPage === "lower-third") return getLowerThirdConfidenceMonitorElement();
  if (confidenceMonitorPage === "stage") return getStageConfidenceMonitorElement();
  return getConfidenceMonitorElement();
}

function confidenceMonitorPipPageLabel(page) {
  return page === "lower-third" ? "Lower Third" : page === "stage" ? "Stage" : "Audience";
}

function confidenceMonitorPopoutTitle() {
  return `EMS Confidence Monitor — ${confidenceMonitorPipPageLabel(confidenceMonitorPage)}`;
}

function handleConfidenceMonitorPopoutClosed() {
  confidenceMonitorPopoutWindow = null;
  if (!confidenceMonitorPopoutActive) return;
  confidenceMonitorPopoutActive = false;
  applyConfidenceMonitorOverlayPopout(false);
  syncConfidenceCaptureQualityForPopout();
  setConfidenceMonitorPopoutButtonState();
}

function buildConfidenceMonitorPopout(windowRef) {
  const popoutDocument = windowRef.document;
  popoutDocument.title = confidenceMonitorPopoutTitle();
  const style = popoutDocument.createElement("style");
  style.textContent = `
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #000; }
    video { width: 100%; height: 100%; display: block; object-fit: contain; background: #000; }
    button {
      position: fixed; top: 50%; z-index: 2; width: 52px; height: 76px;
      border: 1px solid rgba(255, 255, 255, .3); border-radius: 8px;
      background: rgba(0, 0, 0, .58); color: #fff; font: 48px/1 system-ui, sans-serif;
      cursor: pointer; transform: translateY(-50%); opacity: .72;
    }
    button:hover, button:focus-visible { opacity: 1; background: rgba(0, 0, 0, .8); }
    button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    button[hidden] { display: none; }
    #emsConfidenceMonitorPrevious { left: 14px; }
    #emsConfidenceMonitorNext { right: 14px; }
  `;
  const video = popoutDocument.createElement("video");
  video.id = "emsConfidenceMonitorPopoutVideo";
  video.autoplay = true;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.disablePictureInPicture = true;
  const previous = popoutDocument.createElement("button");
  previous.id = "emsConfidenceMonitorPrevious";
  previous.type = "button";
  previous.textContent = "‹";
  previous.setAttribute("aria-label", "Previous confidence display");
  previous.title = "Previous confidence display";
  previous.addEventListener("click", () => stepConfidenceMonitorPage(-1));
  const next = popoutDocument.createElement("button");
  next.id = "emsConfidenceMonitorNext";
  next.type = "button";
  next.textContent = "›";
  next.setAttribute("aria-label", "Next confidence display");
  next.title = "Next confidence display";
  next.addEventListener("click", () => stepConfidenceMonitorPage(1));
  popoutDocument.head.replaceChildren(style);
  popoutDocument.body.replaceChildren(video, previous, next);
  windowRef.addEventListener("pagehide", handleConfidenceMonitorPopoutClosed, { once: true });
  return video;
}

function syncConfidenceMonitorPopoutWindow() {
  const windowRef = confidenceMonitorPopoutWindow;
  if (!windowRef || windowRef.closed) return false;
  const sourceVideo = currentConfidenceMonitorVideo();
  if (!sourceVideo?.srcObject) return false;
  windowRef.document.title = confidenceMonitorPopoutTitle();
  const popoutVideo =
    windowRef.document.getElementById("emsConfidenceMonitorPopoutVideo") ||
    buildConfidenceMonitorPopout(windowRef);
  const canStep = activeConfidenceMonitorPages().length >= 2;
  const previous = windowRef.document.getElementById("emsConfidenceMonitorPrevious");
  const next = windowRef.document.getElementById("emsConfidenceMonitorNext");
  if (previous) previous.hidden = !canStep;
  if (next) next.hidden = !canStep;
  if (popoutVideo.srcObject !== sourceVideo.srcObject) {
    popoutVideo.srcObject = sourceVideo.srcObject;
  }
  void popoutVideo.play().catch(() => {});
  return true;
}

function openConfidenceMonitorWindow() {
  const existingWindow = confidenceMonitorPopoutWindow;
  if (existingWindow && !existingWindow.closed) {
    existingWindow.focus();
    return syncConfidenceMonitorPopoutWindow();
  }
  const windowRef = window.open(
    "about:blank",
    "ems-confidence-monitor",
    "popup,width=960,height=540",
  );
  if (!windowRef) return false;
  confidenceMonitorPopoutWindow = windowRef;
  buildConfidenceMonitorPopout(windowRef);
  return syncConfidenceMonitorPopoutWindow();
}

function confidenceMonitorPopoutButtonLabels(active) {
  return active
    ? {
        label: "Dock confidence monitor",
        title: "Dock confidence monitor",
      }
    : {
        label: "Open larger Picture-in-Picture",
        title: "Open larger Picture-in-Picture",
      };
}

function setConfidenceMonitorPopoutButtonState() {
  const button = document.getElementById("confidenceMonitorPopout");
  if (!button) return;
  const pages = activeConfidenceMonitorPages();
  const video = currentConfidenceMonitorVideo();
  const available = pages.length > 0 && Boolean(video);
  const active =
    confidenceMonitorPopoutActive || document.pictureInPictureElement === video;
  const labels = confidenceMonitorPopoutButtonLabels(active);
  button.hidden = !available;
  button.disabled = false;
  button.setAttribute("aria-pressed", active ? "true" : "false");
  button.setAttribute("aria-label", labels.label);
  button.title = labels.title;
}

function applyConfidenceMonitorOverlayPopout(active) {
  document
    .getElementById("confidenceMonitor")
    ?.classList.toggle("confidence-monitor--popout", active === true);
}

function syncConfidenceCaptureQualityForPopout() {
  streamRendererPreviewQualityMode = null;
  if (streamRendererPreviewStream) {
    syncRendererCaptureQuality(streamRendererPreviewStream);
  }
  if (typeof syncLowerThirdRendererPreviewCaptureQuality === "function") {
    syncLowerThirdRendererPreviewCaptureQuality();
  }
  syncStageRendererPreviewCaptureQuality();
}

async function closeConfidenceMonitorPopout() {
  confidenceMonitorPopoutActive = false;
  const popoutWindow = confidenceMonitorPopoutWindow;
  confidenceMonitorPopoutWindow = null;
  if (popoutWindow && !popoutWindow.closed) {
    popoutWindow.close();
  }
  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture().catch(() => {});
  }
  applyConfidenceMonitorOverlayPopout(false);
  syncConfidenceCaptureQualityForPopout();
  setConfidenceMonitorPopoutButtonState();
}

async function openConfidenceMonitorPopout() {
  confidenceMonitorPopoutActive = true;
  if (openConfidenceMonitorWindow()) {
    applyConfidenceMonitorOverlayPopout(false);
    syncConfidenceCaptureQualityForPopout();
    setConfidenceMonitorPopoutButtonState();
    return;
  }
  applyConfidenceMonitorOverlayPopout(true);
  syncConfidenceCaptureQualityForPopout();
  setConfidenceMonitorPopoutButtonState();
}

async function toggleConfidenceMonitorPopout() {
  if (confidenceMonitorPopoutActive) {
    await closeConfidenceMonitorPopout();
    return;
  }
  await openConfidenceMonitorPopout();
}

function setConfidenceMonitorPage(page) {
  const pages = activeConfidenceMonitorPages();
  confidenceMonitorPage = pages.includes(page) ? page : (pages[0] || "audience");
  const idle = document.getElementById("confidenceMonitorIdle");
  const audience = document.getElementById("confidenceAudiencePage");
  const lowerThird = document.getElementById("confidenceLowerThirdPage");
  const stage = document.getElementById("confidenceStagePage");
  if (idle) idle.hidden = pages.length > 0;
  if (audience) audience.hidden = !pages.includes("audience") || confidenceMonitorPage !== "audience";
  if (lowerThird) lowerThird.hidden = !pages.includes("lower-third") || confidenceMonitorPage !== "lower-third";
  if (stage) stage.hidden = !pages.includes("stage") || confidenceMonitorPage !== "stage";
  document.querySelectorAll(".confidence-monitor__dot").forEach((dot) => {
    dot.setAttribute("aria-current", dot.dataset.page === confidenceMonitorPage ? "true" : "false");
  });
  setConfidenceMonitorPopoutButtonState();
  if (confidenceMonitorPopoutActive && confidenceMonitorPopoutWindow) {
    syncConfidenceMonitorPopoutWindow();
  }
}

function stepConfidenceMonitorPage(delta) {
  const pages = activeConfidenceMonitorPages();
  if (pages.length < 2) return;
  const current = Math.max(0, pages.indexOf(confidenceMonitorPage));
  setConfidenceMonitorPage(pages[(current + delta + pages.length) % pages.length]);
}

function syncConfidenceMonitorCarousel() {
  const monitor = document.getElementById("confidenceMonitor");
  if (!monitor) return;
  const pages = activeConfidenceMonitorPages();
  const controls = document.getElementById("confidenceMonitorControls");
  const dots = document.getElementById("confidenceMonitorDots");
  monitor.hidden = currentMode !== MEDIAPLAYER;
  if (currentMode !== MEDIAPLAYER && confidenceMonitorPopoutActive) {
    void closeConfidenceMonitorPopout();
  }
  if (controls) controls.hidden = pages.length < 2;
  if (dots) {
    dots.replaceChildren();
    pages.forEach((page) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "confidence-monitor__dot";
      dot.dataset.page = page;
      dot.setAttribute("aria-label", `Show ${page === "lower-third" ? "lower third" : page} output`);
      dot.addEventListener("click", () => setConfidenceMonitorPage(page));
      dots.append(dot);
    });
  }

  applyConfidenceMonitorOverlayPopout(
    confidenceMonitorPopoutActive &&
      !confidenceMonitorPopoutWindow &&
      document.pictureInPictureElement !== currentConfidenceMonitorVideo(),
  );
  setConfidenceMonitorPage(confidenceMonitorPage);

  if (monitor.dataset.carouselBound !== "1") {
    monitor.dataset.carouselBound = "1";
    document.getElementById("confidenceMonitorPrevious")?.addEventListener("click", () => stepConfidenceMonitorPage(-1));
    document.getElementById("confidenceMonitorNext")?.addEventListener("click", () => stepConfidenceMonitorPage(1));
    document.getElementById("confidenceMonitorPopout")?.addEventListener("click", () => {
      void toggleConfidenceMonitorPopout().catch(console.error);
    });
  }
}

function isNetworkStreamSource(source) {
  if (source === undefined || source === null || isBiblePath(source) || isSongPath(source)) {
    return false;
  }
  const text = String(source).trim();
  if (!text) return false;
  if (isLiveStream(text)) return true;
  try {
    const url = new URL(text);
    return ["http:", "https:", "rtsp:", "rtmp:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function streamsTabNetworkStreamLoaded() {
  return Boolean(
    currentMode === STREAMPLAYER &&
      isActiveMediaWindow() &&
      (activeLiveStream || isNetworkStreamSource(mediaFile)),
  );
}

function setStreamsPreviewNetworkState(active) {
  const host = document.querySelector(".stream-preview-host");
  if (!host) return;
  host.dataset.networkStreamActive = active ? "true" : "false";
  const emptyState = host.querySelector("#streamPreviewEmptyState");
  if (emptyState) emptyState.hidden = active;
  if (!active) {
    const previewEl = getStreamRendererPreviewElement();
    if (previewEl) {
      previewEl.pause();
      previewEl.srcObject = null;
      previewEl.hidden = true;
    }
  }
}

const RENDERER_CAPTURE_QUALITY_STREAMS = "streams";
const RENDERER_CAPTURE_QUALITY_CONFIDENCE = "confidence";
const RENDERER_CAPTURE_QUALITY_CONFIDENCE_PIP = "confidence-pip";

function activeRendererCaptureQualityMode() {
  if (stageAudienceRelay) {
    return RENDERER_CAPTURE_QUALITY_STREAMS;
  }
  if (currentMode === MEDIAPLAYER) {
    return confidenceMonitorPopoutActive
      ? RENDERER_CAPTURE_QUALITY_CONFIDENCE_PIP
      : RENDERER_CAPTURE_QUALITY_CONFIDENCE;
  }
  return RENDERER_CAPTURE_QUALITY_STREAMS;
}

function rendererCaptureVideoConstraints(mode = activeRendererCaptureQualityMode()) {
  if (mode === RENDERER_CAPTURE_QUALITY_CONFIDENCE_PIP) {
    return {
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 },
      frameRate: { ideal: 30, max: 30 },
    };
  }
  if (mode === RENDERER_CAPTURE_QUALITY_CONFIDENCE) {
    return {
      width: { ideal: 426, max: 640 },
      height: { ideal: 240, max: 360 },
      frameRate: { ideal: 30, max: 30 },
    };
  }

  return {
    width: { ideal: 1920, max: 1920 },
    height: { ideal: 1080, max: 1080 },
    frameRate: { ideal: 30, max: 30 },
  };
}

function rendererCaptureRequestOptions() {
  // Ask Electron for the media-window frame first; downscale the track after
  // capture starts so display-capture constraint validation cannot reject setup.
  let controller = null;
  if (typeof CaptureController === "function") {
    try {
      controller = new CaptureController();
      controller.setFocusBehavior?.("no-focus-change");
    } catch {
      controller = null;
    }
  }
  return {
    video: true,
    audio: false,
    ...(controller ? { controller } : {}),
  };
}

function createPresentationPreviewSnapshotStream(target, sessionId) {
  let stream;
  let disposed = false;
  const snapshot = createStagePreviewSnapshot({
    document,
    sessionId,
    getFrame: () => invoke("presentation-preview-frame", { target, sessionId }),
    isCurrent: () => !disposed &&
      (!stream || stream.getVideoTracks().some((track) => track.readyState === "live")),
    onStream(value) { stream = value; },
    onError(error) {
      console.error("Failed to refresh presentation snapshot preview:", error);
    },
  });
  stream = snapshot.stream;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    snapshot.dispose();
  };
  // Retain the weak entry after disposal so quality updates can never treat
  // this canvas track as a native capture. Track.stop() emits no ended event.
  presentationPreviewSnapshots.set(stream, dispose);
  stream.getVideoTracks().forEach((track) => {
    track.addEventListener("ended", dispose, { once: true });
  });
  return stream;
}

function stopRendererCaptureStream(stream) {
  if (!stream) return;
  try {
    if (typeof presentationPreviewSnapshots !== "undefined") {
      presentationPreviewSnapshots.get(stream)?.();
    }
  } catch {}
  for (const track of stream.getTracks()) {
    if (track.readyState !== "ended") {
      try { track.stop(); } catch {}
    }
  }
}

async function captureElectronPresentationWindow(target) {
  if (target !== "media" && target !== "lower-third") {
    throw new Error("Unsupported presentation preview target");
  }
  // Main owns the runtime/window safety decision. In particular, snapshots
  // must never enumerate sources, request permissions or enter native capture.
  const source = await invoke("presentation-preview-source", target);
  if (source?.mode === "snapshot" && typeof source.sessionId === "string" && source.sessionId) {
    return createPresentationPreviewSnapshotStream(target, source.sessionId);
  }
  if (
    (source !== true && source?.mode !== "native") ||
    typeof navigator.mediaDevices?.getDisplayMedia !== "function"
  ) {
    throw new Error("Presentation preview capture is unavailable");
  }
  const request = displayMediaCaptureRequestChain.then(async () => {
    await invoke("set-display-media-capture-target", target);
    return navigator.mediaDevices.getDisplayMedia(rendererCaptureRequestOptions());
  });
  displayMediaCaptureRequestChain = request.then(() => undefined, () => undefined);
  return request;
}

function syncRendererCaptureQuality(stream, mode = activeRendererCaptureQualityMode()) {
  if (!stream) {
    streamRendererPreviewQualityMode = null;
    return;
  }
  if (typeof presentationPreviewSnapshots !== "undefined" && presentationPreviewSnapshots.has(stream)) return;
  if (streamRendererPreviewQualityMode === mode) return;
  streamRendererPreviewQualityMode = mode;
  const [track] = stream.getVideoTracks();
  if (!track?.applyConstraints) return;
  track.applyConstraints(rendererCaptureVideoConstraints(mode)).catch((error) => {
    console.error("Failed to update media renderer preview quality:", error);
  });
}

function syncLowerThirdRendererPreviewCaptureQuality(stream = lowerThirdRendererPreviewStream) {
  if (!stream || (typeof presentationPreviewSnapshots !== "undefined" && presentationPreviewSnapshots.has(stream))) return;
  const [track] = stream.getVideoTracks();
  try {
    Promise.resolve(track?.applyConstraints?.(
      rendererCaptureVideoConstraints(activeRendererCaptureQualityMode()),
    )).catch(() => {});
  } catch {}
}

function mediaRendererCaptureAllowedForCurrentMode() {
  if (networkPreviewUsesRendererCapture()) return false;
  if (currentMode === MEDIAPLAYER) return true;
  if (currentMode === STREAMPLAYER) return streamsTabNetworkStreamLoaded();
  return false;
}

function activeMediaRendererCaptureElements() {
  const sinks = [];
  if (currentMode === STREAMPLAYER) {
    const streamPreview = getStreamRendererPreviewElement();
    if (streamPreview) sinks.push(streamPreview);
  }
  if (currentMode === MEDIAPLAYER) {
    const confidenceMonitor = getConfidenceMonitorElement();
    if (confidenceMonitor) sinks.push(confidenceMonitor);
  }
  return [...new Set(sinks)];
}

function activeMediaRendererCaptureElement() {
  return activeMediaRendererCaptureElements()[0] || null;
}

function allMediaRendererCaptureElements() {
  return [
    getStreamRendererPreviewElement(),
    getConfidenceMonitorElement(),
  ].filter(Boolean);
}

function setStreamRendererPreviewActive(active) {
  const host = document.querySelector(".stream-preview-host");
  if (!host) return;
  if (active) {
    host.dataset.rendererPreviewActive = "true";
  } else {
    delete host.dataset.rendererPreviewActive;
  }
  setStreamsPreviewNetworkState(Boolean(active && streamsTabNetworkStreamLoaded()));
}

function setConfidenceMonitorActive(active) {
  const monitor = document.getElementById("confidenceMonitor");
  if (!monitor) return;
  monitor.hidden = currentMode !== MEDIAPLAYER;
  if (active) {
    monitor.dataset.rendererPreviewActive = "true";
  } else {
    delete monitor.dataset.rendererPreviewActive;
  }
  syncConfidenceMonitorCarousel();
}

function disableCapturedAudioTracks(stream) {
  stream.getAudioTracks().forEach((track) => {
    track.enabled = false;
    track.stop();
  });
}

function prepareRendererCaptureElement(el, stream) {
  if (!el) return;
  disableCapturedAudioTracks(stream);
  if (el.srcObject !== stream) {
    el.srcObject = stream;
  }
  el.muted = true;
  el.defaultMuted = true;
  el.volume = 0;
  disableNativeVideoControls(el);
  el.hidden = false;
  el.play().catch((error) => {
    console.error("Failed to start media renderer preview:", error);
  });
}

function hideRendererCaptureElement(el) {
  if (!el) return;
  el.pause();
  el.srcObject = null;
  el.hidden = true;
}

function syncRendererCaptureSinks(stream = streamRendererPreviewStream) {
  const activeEls = new Set(
    stream && audienceOutputAvailableForConfidence()
      ? activeMediaRendererCaptureElements()
      : [],
  );
  if (activeEls.size > 0) {
    syncRendererCaptureQuality(stream);
  }
  allMediaRendererCaptureElements().forEach((el) => {
    if (activeEls.has(el)) {
      prepareRendererCaptureElement(el, stream);
    } else {
      hideRendererCaptureElement(el);
    }
  });
  setStreamRendererPreviewActive(activeEls.has(getStreamRendererPreviewElement()));
  setConfidenceMonitorActive(activeEls.has(getConfidenceMonitorElement()));
}

function sharedAudienceCaptureActive() {
  if (stageAudienceRelay?.sourceKey) return true;
  if (
    !mediaRendererCaptureAllowedForCurrentMode() ||
    !audienceOutputAvailableForConfidence()
  ) {
    return false;
  }
  return activeMediaRendererCaptureElements().length > 0;
}

function stopStreamRendererPreviewCapture(options = {}) {
  const force = options?.force === true;
  if (
    !force &&
    stageAudienceRelay?.sourceKey &&
    (!streamRendererPreviewSourceKey ||
      streamRendererPreviewSourceKey === stageAudienceRelay.sourceKey)
  ) {
    syncRendererCaptureSinks(streamRendererPreviewStream);
    return;
  }
  audienceCaptureGeneration += 1;
  const stream = streamRendererPreviewStream;
  streamRendererPreviewStream = null;
  streamRendererPreviewStartPromise = null;
  streamRendererPreviewQualityMode = null;
  streamRendererPreviewSourceKey = "";
  if (typeof stopRendererCaptureStream === "function") {
    stopRendererCaptureStream(stream);
  } else if (stream) {
    stream.getTracks().forEach((track) => {
      try { track.stop(); } catch {}
    });
  }
  syncRendererCaptureSinks(null);
}

async function startStreamRendererPreviewCapture() {
  if (!sharedAudienceCaptureActive()) {
    stopStreamRendererPreviewCapture({ force: true });
    return null;
  }

  if (
    streamRendererPreviewStream &&
    streamRendererPreviewStream.getVideoTracks().some((track) => track.readyState === "live")
  ) {
    if (
      stageAudienceRelay?.sourceKey &&
      streamRendererPreviewSourceKey &&
      streamRendererPreviewSourceKey !== stageAudienceRelay.sourceKey
    ) {
      stopStreamRendererPreviewCapture({ force: true });
    } else {
      if (stageAudienceRelay?.sourceKey && !streamRendererPreviewSourceKey) {
        streamRendererPreviewSourceKey = stageAudienceRelay.sourceKey;
      }
      syncRendererCaptureQuality(streamRendererPreviewStream);
      syncRendererCaptureSinks(streamRendererPreviewStream);
      return streamRendererPreviewStream;
    }
  }

  if (streamRendererPreviewStartPromise) {
    return streamRendererPreviewStartPromise;
  }

  const generation = audienceCaptureGeneration;
  let capturedStream = null;
  // A stopped start may settle after a replacement has taken ownership.
  const isCurrent = () =>
    generation === audienceCaptureGeneration &&
    streamRendererPreviewStartPromise === startPromise;
  const startPromise = (async () => {
    const sourceInfo = await invoke("stage-audience-source").catch(() => null);
    const hasStructuredSource = Boolean(
      sourceInfo && typeof sourceInfo === "object" && "available" in sourceInfo,
    );
    const available = hasStructuredSource
      ? Boolean(sourceInfo.available && sourceInfo.sourceKey)
      : Boolean(await invoke("media-window-capture-available").catch(() => false));
    if (!isCurrent()) return null;
    if (!sharedAudienceCaptureActive() || !available) {
      stopStreamRendererPreviewCapture({ force: true });
      return null;
    }

    const capturedSourceKey =
      stageAudienceRelay?.sourceKey ||
      (hasStructuredSource ? String(sourceInfo.sourceKey || "") : "");
    const qualityMode = activeRendererCaptureQualityMode();
    const stream = await captureElectronPresentationWindow("media");
    capturedStream = stream;
    const releaseStream = (targetStream) => {
      if (capturedStream === targetStream) {
        capturedStream = null;
      }
      if (typeof stopRendererCaptureStream === "function") {
        stopRendererCaptureStream(targetStream);
      } else if (targetStream) {
        targetStream.getTracks().forEach((track) => {
          try { track.stop(); } catch {}
        });
      }
    };
    if (!isCurrent() || !sharedAudienceCaptureActive()) {
      releaseStream(stream);
      return null;
    }

    const latestSource = await invoke("stage-audience-source").catch(() => null);
    if (!isCurrent() || !sharedAudienceCaptureActive()) {
      releaseStream(stream);
      return null;
    }
    const latestStructured = Boolean(
      latestSource && typeof latestSource === "object" && "available" in latestSource,
    );
    const desiredSourceKey =
      stageAudienceRelay?.sourceKey ||
      (latestStructured ? String(latestSource.sourceKey || "") : capturedSourceKey);
    if (
      (latestStructured && !latestSource.available) ||
      (desiredSourceKey && capturedSourceKey && desiredSourceKey !== capturedSourceKey)
    ) {
      releaseStream(stream);
      if (sharedAudienceCaptureActive() && desiredSourceKey && desiredSourceKey !== capturedSourceKey) {
        streamRendererPreviewStartPromise = null;
        return startStreamRendererPreviewCapture();
      }
      return null;
    }

    disableCapturedAudioTracks(stream);
    streamRendererPreviewStream = stream;
    streamRendererPreviewSourceKey = desiredSourceKey || capturedSourceKey;
    syncRendererCaptureQuality(stream, activeRendererCaptureQualityMode() || qualityMode);
    stream.getVideoTracks().forEach((track) => {
      track.addEventListener(
        "ended",
        () => {
          if (streamRendererPreviewStream === stream) {
            stopStreamRendererPreviewCapture({ force: true });
          }
        },
        { once: true },
      );
    });
    syncRendererCaptureSinks(stream);
    return stream;
  })();
  streamRendererPreviewStartPromise = startPromise;

  try {
    return await startPromise;
  } catch (error) {
    console.error("Failed to capture media renderer preview:", error);
    if (isCurrent()) stopStreamRendererPreviewCapture({ force: true });
    return null;
  } finally {
    if (capturedStream && streamRendererPreviewStream !== capturedStream) {
      if (typeof stopRendererCaptureStream === "function") {
        stopRendererCaptureStream(capturedStream);
      } else {
        capturedStream.getTracks().forEach((track) => {
          if (track.readyState !== "ended") track.stop();
        });
      }
    }
    if (streamRendererPreviewStartPromise === startPromise) {
      streamRendererPreviewStartPromise = null;
    }
  }
}

function stopLowerThirdRendererPreviewCapture() {
  const stream = lowerThirdRendererPreviewStream;
  lowerThirdRendererPreviewStream = null;
  lowerThirdRendererPreviewStartPromise = null;
  stopRendererCaptureStream(stream);
  hideRendererCaptureElement(getLowerThirdConfidenceMonitorElement());
}

async function startLowerThirdRendererPreviewCapture() {
  if (!bibleLowerThirdOutputActive || currentMode !== MEDIAPLAYER) {
    stopLowerThirdRendererPreviewCapture();
    return;
  }
  if (lowerThirdRendererPreviewStartPromise) return lowerThirdRendererPreviewStartPromise;
  let capturedStream = null;
  const isCurrent = () => lowerThirdRendererPreviewStartPromise === startPromise &&
    bibleLowerThirdOutputActive && currentMode === MEDIAPLAYER;
  const startPromise = (async () => {
    const available = await invoke("media-window-capture-available", "lower-third").catch(() => false);
    if (!isCurrent()) return;
    if (!available) {
      stopLowerThirdRendererPreviewCapture();
      return;
    }
    if (lowerThirdRendererPreviewStream?.getVideoTracks().some((track) => track.readyState === "live")) {
      prepareRendererCaptureElement(getLowerThirdConfidenceMonitorElement(), lowerThirdRendererPreviewStream);
      return;
    }
    const stream = await captureElectronPresentationWindow("lower-third");
    capturedStream = stream;
    if (!isCurrent()) {
      stopRendererCaptureStream(stream);
      return;
    }
    disableCapturedAudioTracks(stream);
    lowerThirdRendererPreviewStream = stream;
    syncLowerThirdRendererPreviewCaptureQuality(stream);
    const [track] = stream.getVideoTracks();
    track?.addEventListener("ended", () => {
      if (lowerThirdRendererPreviewStream === stream) stopLowerThirdRendererPreviewCapture();
    }, { once: true });
    prepareRendererCaptureElement(getLowerThirdConfidenceMonitorElement(), stream);
    syncConfidenceMonitorCarousel();
  })();
  lowerThirdRendererPreviewStartPromise = startPromise;
  try {
    await startPromise;
  } catch (error) {
    console.error("Failed to capture lower-third renderer preview:", error);
    if (lowerThirdRendererPreviewStartPromise === startPromise) stopLowerThirdRendererPreviewCapture();
  } finally {
    if (capturedStream && lowerThirdRendererPreviewStream !== capturedStream) {
      stopRendererCaptureStream(capturedStream);
    }
    if (lowerThirdRendererPreviewStartPromise === startPromise) {
      lowerThirdRendererPreviewStartPromise = null;
    }
  }
}

function syncLowerThirdRendererPreviewCapture() {
  if (!bibleLowerThirdOutputActive || currentMode !== MEDIAPLAYER) {
    stopLowerThirdRendererPreviewCapture();
    return;
  }
  void startLowerThirdRendererPreviewCapture();
}

function stopStageRendererPreviewCapture(connection = stageRendererPreviewConnection) {
  if (!connection || connection.disposed) return;
  connection.disposed = true;
  try { connection.preview?.dispose(); } catch {}
  connection.disposeNative?.();
  if (connection.stream && connection.video.srcObject === connection.stream) {
    hideRendererCaptureElement(connection.video);
  }
  if (stageRendererPreviewConnection !== connection) return;
  stageRendererPreviewConnection = null;
  syncConfidenceMonitorCarousel();
}

function syncStageRendererPreviewCaptureQuality(connection = stageRendererPreviewConnection) {
  // Canvas snapshots keep their fixed <=640x360 / 10fps budget. Native stage
  // quality belongs to this connection, never the audience's quality cache.
  if (!connection || connection.disposed || !connection.disposeNative || !connection.stream) return;
  const mode = activeRendererCaptureQualityMode();
  if (connection.qualityMode === mode) return;
  connection.qualityMode = mode;
  const [track] = connection.stream.getVideoTracks();
  try {
    Promise.resolve(track?.applyConstraints?.(rendererCaptureVideoConstraints(mode))).catch(() => {});
  } catch {}
}

async function syncStageRendererPreviewCapture() {
  const sessionId = latestOutputStatus?.sessionId;
  const video = getStageConfidenceMonitorElement();
  if (!sessionId || !video || latestOutputStatus?.stage?.window !== "open" ||
      latestOutputStatus?.stage?.health !== "ok" || currentMode !== MEDIAPLAYER) {
    stopStageRendererPreviewCapture();
    return;
  }
  if (stageRendererPreviewConnection?.sessionId === sessionId &&
      stageRendererPreviewConnection.video === video &&
      (stageRendererPreviewConnection.pending ||
       stageRendererPreviewConnection.stream?.getVideoTracks().some((track) => track.readyState === "live"))) {
    return;
  }
  stopStageRendererPreviewCapture();
  const connection = { sessionId, video, stream: null, preview: null,
    pending: true, disposed: false, disposeNative: null, qualityMode: null };
  stageRendererPreviewConnection = connection;
  const isCurrent = () => !connection.disposed && stageRendererPreviewConnection === connection &&
    latestOutputStatus?.sessionId === sessionId && latestOutputStatus?.stage?.window === "open" &&
    latestOutputStatus?.stage?.health === "ok" &&
    currentMode === MEDIAPLAYER && getStageConfidenceMonitorElement() === video;
  const attach = (stream) => {
    connection.stream = stream;
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (connection.stream === stream) stopStageRendererPreviewCapture(connection);
    }, { once: true });
    prepareRendererCaptureElement(video, stream);
    syncConfidenceMonitorCarousel();
  };
  try {
    // Use the main-owned, fixed native WINDOW source, rather than the
    // WebFrameMain/tab getDisplayMedia path implicated in the stage crash.
    let source = null;
    try { source = await invoke("stage-preview-source", { sessionId }); } catch {}
    if (!isCurrent()) return;
    if (source?.sessionId === sessionId && typeof source.sourceId === "string" &&
        /^window:[1-9]\d*:\d+$/.test(source.sourceId) &&
        typeof navigator.mediaDevices?.getUserMedia === "function") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: source.sourceId,
            maxWidth: 640, maxHeight: 360, maxFrameRate: 30 } },
        });
        let disposed = false;
        connection.disposeNative = () => {
          if (disposed) return;
          disposed = true;
          for (const track of stream.getTracks()) {
            // prepareRendererCaptureElement already stops any unexpected audio.
            if (track.readyState !== "ended") {
              try { track.stop(); } catch {}
            }
          }
        };
        // Even a connection disposed while getUserMedia was pending owns this
        // late stream and must release it, without touching a replacement sink.
        if (!isCurrent()) { connection.disposeNative(); return; }
        if (!stream.getVideoTracks().some((track) => track.readyState === "live")) {
          throw new Error("Stage window capture has no live video track");
        }
        attach(stream);
        syncStageRendererPreviewCaptureQuality(connection);
        return;
      } catch {
        connection.disposeNative?.();
        if (connection.stream && video.srcObject === connection.stream) hideRendererCaptureElement(video);
        connection.stream = null;
        connection.disposeNative = null;
        if (!isCurrent()) return;
      }
    }
    // A failed/unavailable native acquisition selects snapshots for this
    // connection; status updates reuse it instead of retrying native capture.
    connection.preview = createStagePreviewSnapshot({
      document,
      sessionId,
      getFrame: () => invoke("stage-preview-frame", { sessionId }),
      isCurrent,
      onStream(stream) {
        if (isCurrent()) attach(stream);
      },
      onError(error) {
        if (isCurrent()) console.error("Failed to refresh stage snapshot preview:", error);
      },
    });
    if (!isCurrent()) connection.preview.dispose();
  } catch (error) {
    if (stageRendererPreviewConnection === connection) {
      console.error("Failed to start stage snapshot preview:", error);
      stopStageRendererPreviewCapture(connection);
    }
  } finally {
    connection.pending = false;
    if (!isCurrent()) stopStageRendererPreviewCapture(connection);
  }
}

function syncStreamRendererPreviewCapture() {
  if (networkPreviewUsesRendererCapture()) {
    stopStreamRendererPreviewCapture();
    syncNetworkPreviewMirrorCapture();
    return;
  }
  if (!sharedAudienceCaptureActive()) {
    stopStreamRendererPreviewCapture();
    return;
  }
  syncRendererCaptureSinks(streamRendererPreviewStream);
  void startStreamRendererPreviewCapture();
}

function installStageAudienceRelay() {
  if (installStageAudienceRelay.initialized) return;
  on("stage-audience-relay", (_event, message = {}) => {
    if (!message || typeof message !== "object") return;
    const peerId = typeof message.peerId === "string" ? message.peerId : "";
    const sourceKey = typeof message.sourceKey === "string" ? message.sourceKey : "";
    if (message.type === "request") {
      if (!peerId || !sourceKey) return;
      const previous = stageAudienceRelay;
      stageAudienceRelay = { peerId, sourceKey, relay: null };
      if (previous?.relay) {
        previous.relay.close();
      }
      if (
        streamRendererPreviewStream &&
        streamRendererPreviewSourceKey &&
        streamRendererPreviewSourceKey !== sourceKey
      ) {
        stopStreamRendererPreviewCapture({ force: true });
      }
      streamRendererPreviewQualityMode = null;
      void (async () => {
        const stream = await startStreamRendererPreviewCapture();
        if (
          !stream ||
          stageAudienceRelay?.peerId !== peerId ||
          stageAudienceRelay?.sourceKey !== sourceKey ||
          (streamRendererPreviewSourceKey && streamRendererPreviewSourceKey !== sourceKey)
        ) {
          return;
        }
        syncRendererCaptureQuality(stream, activeRendererCaptureQualityMode());
        const relay = new LocalVideoRelay({
          sendSignal(signal) {
            send("stage-audience-relay", { ...signal, peerId, sourceKey });
          },
          onClose() {
            if (stageAudienceRelay?.peerId === peerId) {
              stageAudienceRelay = null;
              streamRendererPreviewQualityMode = null;
              syncStreamRendererPreviewCapture();
            }
          },
        });
        stageAudienceRelay.relay = relay;
        await relay.start(stream);
      })();
      return;
    }
    if (message.type === "close") {
      if (!stageAudienceRelay || (peerId && stageAudienceRelay.peerId !== peerId)) return;
      const active = stageAudienceRelay;
      stageAudienceRelay = null;
      streamRendererPreviewQualityMode = null;
      active.relay?.close();
      syncStreamRendererPreviewCapture();
      return;
    }
    if (!stageAudienceRelay || (peerId && stageAudienceRelay.peerId !== peerId)) return;
    stageAudienceRelay.relay?.receive(message);
  });
  installStageAudienceRelay.initialized = true;
}

function installDisplayChangeHandler() {
  if (installDisplayChangeHandler.initialized) return;

  installStageAudienceRelay();
  on("display-changed", async () => {
    await populateDisplaySelect({ force: true });
  });

  installDisplayChangeHandler.initialized = true;
}

export {
  ensureMediaPanelBuilt,
  ensureStreamsPanelBuilt,
  getConfidenceMonitorElement,
  getLowerThirdConfidenceMonitorElement,
  installDisplayChangeHandler,
  isNetworkStreamSource,
  restoreLivePreview,
  restoreLivePreviewIntoPanel,
  setConfidenceMonitorActive,
  stashLivePreview,
  stopLowerThirdRendererPreviewCapture,
  stopStreamRendererPreviewCapture,
  syncConfidenceMonitorCarousel,
  syncLowerThirdRendererPreviewCapture,
  syncStageRendererPreviewCapture,
  syncStreamRendererPreviewCapture,
};
/* Confidence-monitor, preview mounting, and renderer-capture lifecycle. */

import { LocalVideoRelay } from "../shared/local-video-relay.mjs";
import { createStagePreviewSnapshot } from "../shared/stage-preview-snapshot.mjs";
import {
  MEDIAPLAYER,
  PREVIEW_STASH_ID,
  STREAMPLAYER,
  TAB_PANEL_MEDIA_ID,
  TAB_PANEL_STREAMS_ID,
  activeLiveStream,
  bibleLowerThirdOutputActive,
  currentAlertsSnapshot,
  currentMode,
  disableNativeVideoControls,
  ensureNetworkItemDialog,
  generateDyneTabShellHTML,
  generateMediaFormHTML,
  generateStreamsPanelHTML,
  handleVolumeChange,
  invoke,
  isActiveMediaWindow,
  isBiblePath,
  isLiveStream,
  isSongPath,
  lastLowerThirdBibleTextMessage,
  latestOutputStatus,
  mediaFile,
  networkPreviewUsesRendererCapture,
  on,
  populateDisplaySelect,
  send,
  syncNetworkPreviewMirrorCapture,
  video,
} from "./app-renderer.mjs";

let streamRendererPreviewStream = null;
let streamRendererPreviewStartPromise = null;
let streamRendererPreviewQualityMode = null;
let streamRendererPreviewSourceKey = "";
let audienceCaptureGeneration = 0;
let stageAudienceRelay = null;
let lowerThirdRendererPreviewStream = null;
let lowerThirdRendererPreviewStartPromise = null;
let stageRendererPreviewConnection = null;
let displayMediaCaptureRequestChain = Promise.resolve();
