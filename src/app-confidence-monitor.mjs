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
let confidenceMonitorPipTransfer = false;

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

function nativePictureInPictureAvailable() {
  return Boolean(
    document.pictureInPictureEnabled &&
      typeof HTMLVideoElement !== "undefined" &&
      HTMLVideoElement.prototype.requestPictureInPicture,
  );
}

function confidenceMonitorPipPageLabel(page) {
  return page === "lower-third" ? "Lower Third" : page === "stage" ? "Stage" : "Audience";
}

function setMediaSessionAction(action, handler) {
  try {
    navigator.mediaSession?.setActionHandler(action, handler);
  } catch {}
}

function syncConfidenceMonitorPipMediaSession() {
  const session = navigator.mediaSession;
  if (!session) return;
  const pipVideo = isConfidenceMonitorVideo(document.pictureInPictureElement)
    ? document.pictureInPictureElement
    : null;
  if (!pipVideo) {
    setMediaSessionAction("previoustrack", null);
    setMediaSessionAction("nexttrack", null);
    return;
  }
  const canStep = activeConfidenceMonitorPages().length >= 2;
  try {
    session.metadata = new MediaMetadata({
      title: confidenceMonitorPipPageLabel(confidenceMonitorPage),
      artist: "EMS Confidence Monitor",
    });
    session.playbackState = "playing";
  } catch {}
  setMediaSessionAction("previoustrack", canStep ? () => stepConfidenceMonitorPage(-1) : null);
  setMediaSessionAction("nexttrack", canStep ? () => stepConfidenceMonitorPage(1) : null);
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
  const lowerThirdStream = lowerThirdRendererPreviewStream;
  if (lowerThirdStream) {
    const [track] = lowerThirdStream.getVideoTracks();
    track
      ?.applyConstraints?.(rendererCaptureVideoConstraints(activeRendererCaptureQualityMode()))
      .catch(() => {});
  }
  const stageStream = stageRendererPreviewStream;
  if (stageStream) {
    const [track] = stageStream.getVideoTracks();
    track?.applyConstraints?.(rendererCaptureVideoConstraints(activeRendererCaptureQualityMode())).catch(() => {});
  }
}

async function requestVideoPictureInPicture(video) {
  if (!video || typeof video.requestPictureInPicture !== "function") {
    throw new Error("Picture-in-Picture is not available");
  }
  video.disablePictureInPicture = false;
  if (video.readyState < 2) {
    await Promise.race([
      new Promise((resolve) => video.addEventListener("loadeddata", resolve, { once: true })),
      new Promise((resolve) => window.setTimeout(resolve, 400)),
    ]);
  }
  return video.requestPictureInPicture();
}

async function syncConfidenceMonitorNativePip() {
  if (!confidenceMonitorPopoutActive || !nativePictureInPictureAvailable()) return false;
  const video = currentConfidenceMonitorVideo();
  if (!video?.srcObject) return false;
  if (document.pictureInPictureElement === video) return true;
  if (document.pictureInPictureElement) {
    confidenceMonitorPipTransfer = true;
    try {
      await document.exitPictureInPicture();
    } catch {
      /* continue and try the new video */
    } finally {
      confidenceMonitorPipTransfer = false;
    }
  }
  await requestVideoPictureInPicture(video);
  syncConfidenceMonitorPipMediaSession();
  return document.pictureInPictureElement === video;
}

async function closeConfidenceMonitorPopout() {
  confidenceMonitorPopoutActive = false;
  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture().catch(() => {});
  }
  applyConfidenceMonitorOverlayPopout(false);
  syncConfidenceCaptureQualityForPopout();
  setConfidenceMonitorPopoutButtonState();
  syncConfidenceMonitorPipMediaSession();
}

async function openConfidenceMonitorPopout() {
  const video = currentConfidenceMonitorVideo();
  confidenceMonitorPopoutActive = true;
  if (nativePictureInPictureAvailable() && video?.srcObject) {
    try {
      if (await syncConfidenceMonitorNativePip()) {
        applyConfidenceMonitorOverlayPopout(false);
        syncConfidenceCaptureQualityForPopout();
        setConfidenceMonitorPopoutButtonState();
        return;
      }
    } catch (error) {
      console.error("Picture-in-Picture failed:", error);
    }
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
  if (confidenceMonitorPopoutActive && nativePictureInPictureAvailable()) {
    void syncConfidenceMonitorNativePip().catch(() => {});
  }
  syncConfidenceMonitorPipMediaSession();
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
    document.addEventListener("enterpictureinpicture", (event) => {
      if (!isConfidenceMonitorVideo(event.target)) return;
      confidenceMonitorPopoutActive = true;
      applyConfidenceMonitorOverlayPopout(false);
      syncConfidenceCaptureQualityForPopout();
      setConfidenceMonitorPopoutButtonState();
      syncConfidenceMonitorPipMediaSession();
    }, true);
    document.addEventListener("leavepictureinpicture", (event) => {
      if (!isConfidenceMonitorVideo(event.target)) return;
      if (confidenceMonitorPipTransfer || document.pictureInPictureElement) return;
      confidenceMonitorPopoutActive = false;
      applyConfidenceMonitorOverlayPopout(false);
      syncConfidenceCaptureQualityForPopout();
      setConfidenceMonitorPopoutButtonState();
      syncConfidenceMonitorPipMediaSession();
    }, true);
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
    frameRate: { ideal: 30, max: 30 },
  };
}

function rendererCaptureRequestOptions() {
  // Ask Electron for the media-window frame first; downscale the track after
  // capture starts so display-capture constraint validation cannot reject setup.
  return {
    video: true,
    audio: false,
  };
}

function captureElectronPresentationWindow(target) {
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
  if (streamRendererPreviewQualityMode === mode) return;
  streamRendererPreviewQualityMode = mode;
  const [track] = stream.getVideoTracks();
  if (!track?.applyConstraints) return;
  track.applyConstraints(rendererCaptureVideoConstraints(mode)).catch((error) => {
    console.error("Failed to update media renderer preview quality:", error);
  });
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

function stopStreamRendererPreviewCapture() {
  const stream = streamRendererPreviewStream;
  streamRendererPreviewStream = null;
  streamRendererPreviewStartPromise = null;
  streamRendererPreviewQualityMode = null;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
  syncRendererCaptureSinks(null);
}

async function startStreamRendererPreviewCapture() {
  if (!mediaRendererCaptureAllowedForCurrentMode()) {
    stopStreamRendererPreviewCapture();
    return;
  }

  const previewEls = activeMediaRendererCaptureElements();
  if (!previewEls.length || !navigator.mediaDevices?.getDisplayMedia) {
    syncRendererCaptureSinks(null);
    return;
  }

  const available = await invoke("media-window-capture-available").catch(() => false);
  if (!mediaRendererCaptureAllowedForCurrentMode()) {
    stopStreamRendererPreviewCapture();
    return;
  }
  if (!available) {
    stopStreamRendererPreviewCapture();
    return;
  }

  if (
    streamRendererPreviewStream &&
    streamRendererPreviewStream.getVideoTracks().some((track) => track.readyState === "live")
  ) {
    syncRendererCaptureSinks(streamRendererPreviewStream);
    return;
  }

  if (streamRendererPreviewStartPromise) {
    await streamRendererPreviewStartPromise;
    return;
  }

  streamRendererPreviewStartPromise = (async () => {
    const qualityMode = activeRendererCaptureQualityMode();
    const stream = await captureElectronPresentationWindow("media");
    if (
      !mediaRendererCaptureAllowedForCurrentMode() ||
      !audienceOutputAvailableForConfidence()
    ) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    disableCapturedAudioTracks(stream);
    streamRendererPreviewStream = stream;
    syncRendererCaptureQuality(stream, qualityMode);
    stream.getVideoTracks().forEach((track) => {
      track.addEventListener("ended", stopStreamRendererPreviewCapture, {
        once: true,
      });
    });
    syncRendererCaptureSinks(stream);
  })();

  try {
    await streamRendererPreviewStartPromise;
  } catch (error) {
    console.error("Failed to capture media renderer preview:", error);
    stopStreamRendererPreviewCapture();
  } finally {
    streamRendererPreviewStartPromise = null;
  }
}

function stopLowerThirdRendererPreviewCapture() {
  const stream = lowerThirdRendererPreviewStream;
  lowerThirdRendererPreviewStream = null;
  lowerThirdRendererPreviewStartPromise = null;
  if (stream) stream.getTracks().forEach((track) => track.stop());
  hideRendererCaptureElement(getLowerThirdConfidenceMonitorElement());
}

async function startLowerThirdRendererPreviewCapture() {
  if (!bibleLowerThirdOutputActive || currentMode !== MEDIAPLAYER) {
    stopLowerThirdRendererPreviewCapture();
    return;
  }
  const available = await invoke("media-window-capture-available", "lower-third").catch(() => false);
  if (!available || !bibleLowerThirdOutputActive) {
    stopLowerThirdRendererPreviewCapture();
    return;
  }
  if (lowerThirdRendererPreviewStream?.getVideoTracks().some((track) => track.readyState === "live")) {
    prepareRendererCaptureElement(getLowerThirdConfidenceMonitorElement(), lowerThirdRendererPreviewStream);
    return;
  }
  if (lowerThirdRendererPreviewStartPromise) return lowerThirdRendererPreviewStartPromise;
  lowerThirdRendererPreviewStartPromise = (async () => {
    const stream = await captureElectronPresentationWindow("lower-third");
    if (!bibleLowerThirdOutputActive || currentMode !== MEDIAPLAYER) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    disableCapturedAudioTracks(stream);
    lowerThirdRendererPreviewStream = stream;
    const [track] = stream.getVideoTracks();
    track
      ?.applyConstraints?.(rendererCaptureVideoConstraints(activeRendererCaptureQualityMode()))
      .catch(() => {});
    track?.addEventListener("ended", stopLowerThirdRendererPreviewCapture, { once: true });
    prepareRendererCaptureElement(getLowerThirdConfidenceMonitorElement(), stream);
    syncConfidenceMonitorCarousel();
  })();
  try {
    await lowerThirdRendererPreviewStartPromise;
  } catch (error) {
    console.error("Failed to capture lower-third renderer preview:", error);
    stopLowerThirdRendererPreviewCapture();
  } finally {
    lowerThirdRendererPreviewStartPromise = null;
  }
}

function syncLowerThirdRendererPreviewCapture() {
  if (!bibleLowerThirdOutputActive || currentMode !== MEDIAPLAYER) {
    stopLowerThirdRendererPreviewCapture();
    return;
  }
  void startLowerThirdRendererPreviewCapture();
}

function stopStageRendererPreviewCapture() {
  const stream = stageRendererPreviewStream;
  stageRendererPreviewStream = null;
  stageRendererPreviewStartPromise = null;
  if (stream) stream.getTracks().forEach((track) => track.stop());
  hideRendererCaptureElement(getStageConfidenceMonitorElement());
  syncConfidenceMonitorCarousel();
}

async function syncStageRendererPreviewCapture() {
  if (latestOutputStatus?.stage?.window !== "open" || currentMode !== MEDIAPLAYER) {
    stopStageRendererPreviewCapture();
    return;
  }
  if (!getStageConfidenceMonitorElement() || !navigator.mediaDevices?.getDisplayMedia) return;
  const available = await invoke("media-window-capture-available", "stage").catch(() => false);
  if (!available) {
    stopStageRendererPreviewCapture();
    return;
  }
  if (stageRendererPreviewStream?.getVideoTracks().some((track) => track.readyState === "live")) {
    prepareRendererCaptureElement(getStageConfidenceMonitorElement(), stageRendererPreviewStream);
    syncConfidenceMonitorCarousel();
    return;
  }
  if (stageRendererPreviewStartPromise) return stageRendererPreviewStartPromise;
  stageRendererPreviewStartPromise = (async () => {
    const stream = await captureElectronPresentationWindow("stage");
    if (latestOutputStatus?.stage?.window !== "open") {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    disableCapturedAudioTracks(stream);
    stageRendererPreviewStream = stream;
    const [track] = stream.getVideoTracks();
    track?.applyConstraints?.(rendererCaptureVideoConstraints(activeRendererCaptureQualityMode())).catch(() => {});
    track?.addEventListener("ended", stopStageRendererPreviewCapture, { once: true });
    prepareRendererCaptureElement(getStageConfidenceMonitorElement(), stream);
    syncConfidenceMonitorCarousel();
  })();
  try {
    await stageRendererPreviewStartPromise;
  } catch (error) {
    console.error("Failed to capture stage renderer preview:", error);
    stopStageRendererPreviewCapture();
  } finally {
    stageRendererPreviewStartPromise = null;
  }
}

function syncStreamRendererPreviewCapture() {
  if (networkPreviewUsesRendererCapture()) {
    stopStreamRendererPreviewCapture();
    syncNetworkPreviewMirrorCapture();
    return;
  }
  if (
    !mediaRendererCaptureAllowedForCurrentMode() ||
    !audienceOutputAvailableForConfidence()
  ) {
    stopStreamRendererPreviewCapture();
    return;
  }
  syncRendererCaptureSinks(streamRendererPreviewStream);
  void startStreamRendererPreviewCapture();
}

function installDisplayChangeHandler() {
  if (installDisplayChangeHandler.initialized) return;

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
  isConfidenceMonitorVideo,
  isLiveStream,
  isSongPath,
  lastLowerThirdBibleTextMessage,
  latestOutputStatus,
  mediaFile,
  networkPreviewUsesRendererCapture,
  on,
  populateDisplaySelect,
  syncNetworkPreviewMirrorCapture,
  video,
} from "./app-renderer.mjs";

let streamRendererPreviewStream = null;
let streamRendererPreviewStartPromise = null;
let streamRendererPreviewQualityMode = null;
let lowerThirdRendererPreviewStream = null;
let lowerThirdRendererPreviewStartPromise = null;
let stageRendererPreviewStream = null;
let stageRendererPreviewStartPromise = null;
let displayMediaCaptureRequestChain = Promise.resolve();

