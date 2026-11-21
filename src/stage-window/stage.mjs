import {
  applyOutputCommand,
  createCompositorState,
  outputAcknowledgement,
} from "../shared/output-compositor.min.mjs";
import { resolveAlertTokens } from "../shared/alert-tokens.min.mjs";
import {
  ensurePptxProcessEnv,
  renderPptxSlideThumbnail,
} from "../shared/app-pptx-thumbnail.min.mjs";
import { LocalVideoRelay } from "../shared/local-video-relay.min.mjs";
import { createStageVideoSync } from "../shared/stage-video-sync.min.mjs";
import { createNativeSlideRenderer } from "../shared/native-slide-renderer.min.mjs";

const api = window.stageOutput;
let state = createCompositorState("stage", api.sessionId);
let stageDisposed = false;
let audienceSource = null;
let audienceSourcePushed = false;
let audienceStream = null;
let audiencePeerSession = null;
let audiencePeerSequence = 0;
let localMedia = null;
let localMediaRevision = -1;
let localPlayback = null;
let currentVideoActive = false;
let currentPptxToken = 0;
let currentPptxKey = "";
let currentPptxCleanup = null;
const stageVideoSync = createStageVideoSync({ video: document.getElementById("stageAudiencePreview") });
const stageNativeSlides = createNativeSlideRenderer({ viewport: document.getElementById("stageCurrentNative") });
let currentNativeActive = false;
let nextPptxToken = 0;
let nextPptxRenderKey = "";
let nextPptxRetryAt = 0;
let nextPptxCleanup = null;
let pptxRendererModulePromise = null;

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value || "");
}

function safeFileThumbnailUrl(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "file:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function renderOverlay(id, titleId, textId, payload) {
  const element = document.getElementById(id);
  if (!element) return;
  element.hidden = !payload;
  setText(titleId, payload?.title);
  setText(textId, resolveAlertTokens(payload?.message, payload?.tokenDefinitions, Date.now()));
}

function clearNextPptx() {
  nextPptxToken += 1;
  nextPptxRenderKey = "";
  nextPptxRetryAt = 0;
  const cleanup = nextPptxCleanup;
  nextPptxCleanup = null;
  try {
    cleanup?.();
  } catch {}
}

function loadPptxRendererModule() {
  pptxRendererModulePromise ||= import("../../../node_modules/@aiden0z/pptx-renderer/dist/aiden0z-pptx-renderer.browser.es.js").catch(() => {
    pptxRendererModulePromise = null;
    return null;
  });
  return pptxRendererModulePromise;
}

function renderNextMedia(content = {}) {
  const media = content.nextMedia || null;
  const card = document.getElementById("stageNextCard");
  const container = document.getElementById("stageNextMedia");
  const image = document.getElementById("stageNextImage");
  const pptxViewport = document.getElementById("stageNextPptx");
  const audioNote = document.getElementById("stageNextAudio");

  if (!media || media.kind === "text") {
    clearNextPptx();
    if (card?.dataset) card.dataset.nextMedia = "none";
    if (container) container.hidden = true;
    if (image) {
      image.hidden = true;
      image.removeAttribute?.("src");
    }
    if (pptxViewport) pptxViewport.hidden = true;
    if (audioNote) audioNote.hidden = true;
    return;
  }

  if (media.kind === "audio") {
    clearNextPptx();
    if (card?.dataset) card.dataset.nextMedia = "audio";
    if (container) container.hidden = false;
    if (image) {
      image.hidden = true;
      image.removeAttribute?.("src");
    }
    if (pptxViewport) pptxViewport.hidden = true;
    if (audioNote) audioNote.hidden = false;
    return;
  }

  const thumbnailUrl = safeFileThumbnailUrl(media.thumbnailUrl);
  if ((media.kind === "image" || media.kind === "video") && thumbnailUrl) {
    clearNextPptx();
    if (card?.dataset) card.dataset.nextMedia = media.kind;
    if (container) container.hidden = false;
    if (pptxViewport) pptxViewport.hidden = true;
    if (audioNote) audioNote.hidden = true;
    if (image) {
      image.src = thumbnailUrl;
      image.hidden = false;
    }
    return;
  }

  if (media.kind === "pptx" && media.deckKey) {
    const slideIndex = Number.isInteger(media.slideIndex) && media.slideIndex >= 0
      ? media.slideIndex
      : 0;
    const renderKey = `${media.deckKey}:${slideIndex}:${media.revision || ""}`;
    if (
      nextPptxRenderKey === renderKey &&
      (nextPptxCleanup || Date.now() < nextPptxRetryAt)
    ) {
      if (card?.dataset) card.dataset.nextMedia = "pptx";
      if (container) container.hidden = false;
      if (pptxViewport) pptxViewport.hidden = false;
      return;
    }
    clearNextPptx();
    nextPptxRenderKey = renderKey;
    const token = ++nextPptxToken;
    if (card?.dataset) card.dataset.nextMedia = "pptx";
    if (container) container.hidden = false;
    if (image) {
      image.hidden = true;
      image.removeAttribute?.("src");
    }
    if (audioNote) audioNote.hidden = true;
    if (pptxViewport) {
      pptxViewport.innerHTML = "";
      pptxViewport.hidden = false;
    }
    void (async () => {
      ensurePptxProcessEnv();
      const [renderer, arrayBuffer] = await Promise.all([
        loadPptxRendererModule(),
        api.getNextPptx(media.deckKey),
      ]);
      if (
        stageDisposed ||
        token !== nextPptxToken ||
        !renderer ||
        !arrayBuffer ||
        !pptxViewport
      ) {
        if ((!arrayBuffer || !renderer) && token === nextPptxToken) nextPptxRetryAt = Date.now() + 2000;
        return;
      }
      const rendered = await renderPptxSlideThumbnail({
        renderer,
        arrayBuffer,
        viewport: pptxViewport,
        width: Math.max(220, Math.round(pptxViewport.clientWidth || 320)),
        slideIndex,
        hostClassName: "stage-card__pptx-renderer-host",
        isCurrent: () => !stageDisposed && token === nextPptxToken,
      });
      if (!rendered || stageDisposed || token !== nextPptxToken) {
        rendered?.dispose?.();
        if (token === nextPptxToken) nextPptxRetryAt = Date.now() + 2000;
        return;
      }
      rendered.element?.classList?.add("stage-card__pptx-slide");
      nextPptxCleanup = rendered.dispose;
    })().catch(() => {
      if (token === nextPptxToken) nextPptxRetryAt = Date.now() + 2000;
    });
    return;
  }

  clearNextPptx();
  if (card?.dataset) card.dataset.nextMedia = "none";
  if (container) container.hidden = true;
}

function getAudienceSourceKey(source = audienceSource) {
  if (
    !source ||
    source.available !== true ||
    typeof source.sourceKey !== "string" ||
    !source.sourceKey
  ) {
    return "";
  }
  return source.sourceKey;
}

function detachAudienceStream({ stopTracks = false } = {}) {
  const currentStream = audienceStream;
  audienceStream = null;
  const preview = document.getElementById("stageAudiencePreview");
  if (preview && currentStream && preview.srcObject === currentStream) {
    preview.pause?.();
    preview.srcObject = null;
  }
  if (stopTracks && currentStream) {
    currentStream.getTracks?.().forEach((track) => {
      try {
        track.stop();
      } catch {}
    });
  }
}

function attachAudienceStream(stream) {
  if (stageDisposed) return;
  const videoTrack = stream?.getVideoTracks?.()[0] || null;
  if (!stream || (videoTrack && videoTrack.readyState === "ended")) {
    detachAudienceStream();
    render();
    return;
  }
  if (audienceStream && audienceStream !== stream) {
    detachAudienceStream();
  }
  audienceStream = stream;
  videoTrack?.addEventListener?.(
    "ended",
    () => {
      if (audienceStream === stream) {
        detachAudienceStream();
        render();
      }
    },
    { once: true },
  );
  render();
}

const hasAudiencePeerSupport = () =>
  typeof LocalVideoRelay === "function" &&
  typeof api?.sendAudiencePeerSignal === "function";

function closeAudiencePeerSession({ notify = true } = {}) {
  const active = audiencePeerSession;
  audiencePeerSession = null;
  detachAudienceStream({ stopTracks: true });
  active?.relay?.close(notify);
}

function syncAudiencePeerConnection({ allowStream = true } = {}) {
  if (!hasAudiencePeerSupport()) return;
  const sourceKey =
    allowStream &&
    !stageDisposed &&
    audienceSource?.kind !== "audio" &&
    audienceSource?.kind !== "none"
      ? getAudienceSourceKey()
      : "";
  if (!sourceKey) {
    if (audiencePeerSession || audienceStream) {
      closeAudiencePeerSession({ notify: true });
    }
    return;
  }
  if (audiencePeerSession?.sourceKey === sourceKey) {
    return;
  }
  closeAudiencePeerSession({ notify: true });
  const peerId = `stage-peer-${++audiencePeerSequence}`;
  let session;
  const relay = new LocalVideoRelay({
    sendSignal(signal) {
      api.sendAudiencePeerSignal({ ...signal, peerId, sourceKey });
    },
    onStream(stream) {
      if (audiencePeerSession !== session) return;
      attachAudienceStream(stream);
    },
    onClose() {
      if (audiencePeerSession === session) {
        audiencePeerSession = null;
        detachAudienceStream({ stopTracks: true });
        render();
      }
    },
  });
  session = { peerId, sourceKey, relay };
  audiencePeerSession = session;
  api.sendAudiencePeerSignal({ type: "request", peerId, sourceKey });
}

function render() {
  const content = state.layers.content || {};
  const widgets = state.layers.widgets || {};
  const profile = content.profile || widgets.profile || "current-next";
  const currentKind =
    content.currentMedia?.kind === "audio" ? "audio" : localMedia?.kind || content.currentMedia?.kind || "text";
  const isAudioCurrent = currentKind === "audio";
  const allowLivePeer = profile !== "clock" && !isAudioCurrent;
  if (typeof syncAudiencePeerConnection === "function") {
    syncAudiencePeerConnection({ allowStream: allowLivePeer });
  }
  const activeAudienceStream =
    allowLivePeer && typeof audienceStream !== "undefined" ? audienceStream : null;
  const isVisualCurrent = renderCurrentMedia(
    profile === "clock" || isAudioCurrent ? null : localMedia,
    activeAudienceStream,
  );
  const root = document.getElementById("stageRoot");
  const currentAudio = document.getElementById("stageCurrentAudio");
  if (root?.dataset) {
    root.dataset.profile = profile;
    root.dataset.currentMedia = currentKind;
    root.dataset.audiencePreview = isVisualCurrent
      ? "live"
      : isAudioCurrent && profile !== "clock"
        ? "audio"
        : "off";
  }
  setText(
    "stageCurrentLabel",
    isAudioCurrent && content.currentMedia?.name
      ? `Current — ${content.currentMedia.name}`
      : "Current",
  );
  setText("stageCurrent", content.current || "Waiting for live content");
  if (currentAudio) currentAudio.hidden = !(isAudioCurrent && profile !== "clock");
  setText("stageNext", content.next || "—");
  if (typeof renderNextMedia === "function") {
    renderNextMedia(profile === "current-next" ? content : {});
  }
  setText("stageServiceItem", content.serviceItem || widgets.serviceItem || "");
  setText("stageSectionLabel", content.sectionLabel || widgets.sectionLabel || "");
  setText("stageNotes", content.notes || widgets.notes || "");
  setText(
    "stageCountdown",
    widgets.countdown || widgets.mediaRemaining || content.countdown || "",
  );
  renderOverlay(
    "stageAlert",
    "stageAlertTitle",
    "stageAlertMessage",
    state.layers.alert,
  );
  renderOverlay(
    "stagePrivateMessage",
    "stagePrivateTitle",
    "stagePrivateText",
    state.layers.privateMessage,
  );
  const fault = document.getElementById("stageFault");
  if (fault) fault.hidden = !state.layers.fault;
}

function clearCurrentPptx() {
  currentPptxToken += 1;
  currentPptxKey = "";
  currentPptxCleanup?.();
  currentPptxCleanup = null;
}

function renderCurrentMedia(media, liveStream = null) {
  const preview = document.getElementById("stageAudiencePreview");
  const container = document.getElementById("stageCurrentMedia");
  const image = document.getElementById("stageCurrentImage");
  const viewport = document.getElementById("stageCurrentPptx");
  const nativeViewport = document.getElementById("stageCurrentNative");
  if (liveStream) {
    if (currentNativeActive) {
      stageNativeSlides.clear();
      currentNativeActive = false;
    }
    if (currentPptxKey) clearCurrentPptx();
    if (currentVideoActive) {
      stageVideoSync.clear();
      currentVideoActive = false;
    }
    if (image) {
      image.hidden = true;
      image.removeAttribute("src");
    }
    if (viewport) viewport.hidden = true;
    if (nativeViewport) nativeViewport.hidden = true;
    if (container) container.hidden = true;
    if (preview) {
      preview.hidden = false;
      if (preview.srcObject !== liveStream) {
        preview.removeAttribute?.("src");
        preview.srcObject = liveStream;
      }
      preview.muted = true;
      preview.defaultMuted = true;
      preview.volume = 0;
      try {
        Promise.resolve(preview.play?.()).catch(() => {});
      } catch {}
    }
    return true;
  }
  if (preview && preview.srcObject) {
    preview.pause?.();
    preview.srcObject = null;
  }
  const isVideo = media?.kind === "video" && Boolean(media.url);
  const isImage = media?.kind === "image" && Boolean(media.url);
  const isPptx = media?.kind === "pptx" && Boolean(media.deckKey);
  const isNative = media?.kind === "native" && Boolean(media.presentation);
  if (preview) preview.hidden = !isVideo;
  if (container) container.hidden = !(isImage || isPptx || isNative);
  if (nativeViewport) nativeViewport.hidden = !isNative;
  if (isNative) {
    stageNativeSlides.render(media.presentation);
    currentNativeActive = true;
  } else if (currentNativeActive) {
    stageNativeSlides.clear();
    currentNativeActive = false;
  }
  if (image) {
    image.hidden = !isImage;
    if (isImage && image.getAttribute("src") !== media.url) image.src = media.url;
    else if (!isImage) image.removeAttribute("src");
  }
  if (viewport) viewport.hidden = !isPptx;
  if (isVideo) {
    const changed = stageVideoSync.setSource(media);
    if ((!currentVideoActive || changed) && localPlayback) stageVideoSync.receive(localPlayback);
    currentVideoActive = true;
  } else if (currentVideoActive) {
    stageVideoSync.clear();
    currentVideoActive = false;
  }
  if (!isPptx) {
    if (currentPptxKey) clearCurrentPptx();
  } else if (viewport) {
    const key = `${media.deckKey}:${media.slideIndex}`;
    if (key !== currentPptxKey) {
      clearCurrentPptx();
      currentPptxKey = key;
      const token = ++currentPptxToken;
      viewport.innerHTML = "";
      void (async () => {
        ensurePptxProcessEnv();
        const [renderer, arrayBuffer] = await Promise.all([
          loadPptxRendererModule(), api.getNextPptx(media.deckKey),
        ]);
        const isCurrent = () => !stageDisposed && token === currentPptxToken;
        if (!isCurrent() || !renderer || !arrayBuffer) return;
        const rendered = await renderPptxSlideThumbnail({
          renderer, arrayBuffer, viewport,
          width: Math.max(320, Math.round(viewport.clientWidth || 640)),
          slideIndex: media.slideIndex || 0,
          hostClassName: "stage-card__pptx-renderer-host", isCurrent,
        });
        if (!isCurrent()) return rendered?.dispose?.();
        rendered?.element?.classList?.add("stage-card__pptx-slide");
        currentPptxCleanup = rendered?.dispose || null;
      })().catch((error) => console.warn("Stage slide could not be rendered:", error));
    }
  }
  return isVideo || isImage || isPptx || isNative;
}

function syncAudienceSource(source) {
  if (stageDisposed || !source || typeof source !== "object") return;
  audienceSource = source;
  render();
}

function syncLocalMedia(snapshot) {
  if (stageDisposed || !snapshot || !Number.isInteger(snapshot.revision) || snapshot.revision <= localMediaRevision) return;
  localMediaRevision = snapshot.revision;
  localMedia = snapshot.media;
  localPlayback = snapshot.playback;
  render();
}

function syncLocalPlayback(playback) {
  if (stageDisposed || localMedia?.kind !== "video" ||
      playback?.playbackId !== localMedia.playbackId ||
      playback?.audienceSessionId !== localMedia.audienceSessionId ||
      playback?.sourceGeneration !== localMedia.sourceGeneration) return;
  localPlayback = playback;
  if (currentVideoActive) stageVideoSync.receive(playback);
}

function updateClock() {
  setText(
    "stageClock",
    new Intl.DateTimeFormat([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date()),
  );
}

const removeCommandListener = api.onCommand((command) => {
  try {
    const result = applyOutputCommand(state, command);
    state = result.state;
    if (result.applied) render();
    api.acknowledge(
      outputAcknowledgement(
        command,
        result.applied,
        result.applied ? "" : result.reason,
      ),
    );
  } catch (error) {
    api.acknowledge(
      outputAcknowledgement(command, false, error?.message || error),
    );
  }
});

const removeAudienceSourceListener = api.onAudienceSource?.((source) => {
  audienceSourcePushed = true;
  syncAudienceSource(source);
});
const removeAudiencePeerListener = api.onAudiencePeerSignal?.((message) => {
  if (
    stageDisposed ||
    !audiencePeerSession ||
    !message ||
    typeof message !== "object"
  ) {
    return;
  }
  if (message.peerId && message.peerId !== audiencePeerSession.peerId) {
    return;
  }
  if (message.type === "close") {
    closeAudiencePeerSession({ notify: false });
    render();
    return;
  }
  void audiencePeerSession.relay.receive(message);
});
const removeLocalMediaListener = api.onLocalMedia?.(syncLocalMedia);
const removeLocalPlaybackListener = api.onLocalPlayback?.(syncLocalPlayback);

updateClock();
const clockInterval = setInterval(updateClock, 1000);
const overlayInterval = setInterval(() => {
  if (state.layers.alert || state.layers.privateMessage) render();
}, 1000);

window.addEventListener("beforeunload", () => {
  stageDisposed = true;
  clearInterval(clockInterval);
  clearInterval(overlayInterval);
  removeCommandListener?.();
  removeAudienceSourceListener?.();
  removeAudiencePeerListener?.();
  removeLocalMediaListener?.();
  removeLocalPlaybackListener?.();
  closeAudiencePeerSession({ notify: true });
  clearNextPptx();
  clearCurrentPptx();
  stageVideoSync.dispose();
  stageNativeSlides.dispose();
});

if (typeof api.getAudienceSource === "function") {
  void Promise.resolve(api.getAudienceSource())
    .then((source) => {
      if (!audienceSourcePushed) syncAudienceSource(source);
    })
    .catch(() => {});
}

void Promise.resolve(api.getLocalMedia?.())
  .then(syncLocalMedia)
  .catch(() => {});

api.ready();
