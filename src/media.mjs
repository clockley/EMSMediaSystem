/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

const { ipcRenderer, argv, birth, attachCubicWaveShaper } = window.electron;
let video = null;
/**
 * Live-stream player handles are hoisted to module scope so that slipstream
 * transitions can tear them down when switching away from a stream. Without
 * this, an hls.js / dash.js instance created in loadMedia would keep feeding
 * the shared <video> element after we slipstream to a different media type.
 */
let hlsInstance = null;
let dashPlayer = null;
/** Object URL backing the active dash.js manifest, revoked when the player is torn down. */
let dashManifestObjectUrl = null;
/** Guards one-time installation of the <video> playback event wiring. */
let videoPlaybackWiringInstalled = false;
var img = null;
var mediaFile;
var loopFile = false;
var strtvl = 1;
var strtTm = 0;
var isText = false;
var liveStreamMode = false;
var isImg = false;
var isPptx = false;
var isLowerThirdOutput = false;
var pptxStartSlide = 0;
var pptxCurrentSlide = 0;
var autoPlay = false;
var seekOnly = false;
let pptxIpcHandlersInstalled = false;
let textIpcHandlersInstalled = false;
let ipcHandlersInstalled = false;
const PPTX_SMALL_DECK_MAX_SLIDES = 30;
const PPTX_LARGE_DECK_MIN_SLIDES = 151;
const SCRIPTURE_FONT_FAMILY = "'CMG Sans'";
const SCRIPTURE_BODY_FONT_SIZE = 66;
const SCRIPTURE_REFERENCE_FONT_SIZE = 38;
const SCRIPTURE_FONT_WEIGHT = 700;
const SCRIPTURE_LINE_HEIGHT = 1.32;
const SCRIPTURE_LOOK_FULLSCREEN = "fullscreen";
const SCRIPTURE_LOOK_LOWER_THIRD = "lower-third";
const SCRIPTURE_REFERENCE_LIGHT_COLOR = "rgba(255, 255, 255, 0.78)";
const SCRIPTURE_REFERENCE_DARK_COLOR = "rgba(24, 24, 28, 0.84)";
const SCRIPTURE_REFERENCE_LIGHT_SHADOW = "0 2px 14px rgba(0, 0, 0, 0.72)";
const SCRIPTURE_REFERENCE_DARK_SHADOW = "0 2px 12px rgba(255, 255, 255, 0.62)";
const SCRIPTURE_REFERENCE_LIGHT_BACKGROUND_LUMINANCE = 0.58;
const SCRIPTURE_MIN_BODY_FONT_SIZE = 38;
const SCRIPTURE_ABSOLUTE_MIN_BODY_FONT_SIZE = 20;
const SCRIPTURE_MIN_REFERENCE_FONT_SIZE = 20;
const SCRIPTURE_FIT_HEIGHT_RATIO = 0.86;
const SCRIPTURE_AUTOSIZE_NONE = "none";
const SCRIPTURE_AUTOSIZE_FIT = "fit";
const SCRIPTURE_AUTOSIZE_NORMALIZE = "normalize";
const SCRIPTURE_DEFAULT_AUTOSIZE_MODE = SCRIPTURE_AUTOSIZE_FIT;
const TEXT_BACKGROUND_VIDEO_LOAD_COMPENSATION_SEC = 0.15;
/** Live edge: true HLS-style live (no sync/duration UI); false for YouTube VOD in stream mode. */
var streamActsAsLiveEdge = false;
let i = argv.length - 1;

function setLoopEnabled(enabled) {
  loopFile = !!enabled;
  if (video) {
    video.loop = loopFile;
  }
  return loopFile;
}

function waitForDomReady() {
  if (
    document.readyState === "interactive" ||
    document.readyState === "complete"
  ) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    document.addEventListener("DOMContentLoaded", resolve, { once: true });
  });
}

function reportProjectionError(context, error) {
  const detail =
    error?.stack ||
    error?.message ||
    (typeof error === "string" ? error : JSON.stringify(error));
  const message = `${context}: ${detail}`;
  console.error(message, error);
  if (liveStreamMode) {
    showStreamStatus(
      "error",
      "Stream unavailable",
      "The live stream could not be loaded.",
    );
  }
  try {
    ipcRenderer.send("media-window-error", message);
  } catch {
    /* Main process may already be gone during shutdown. */
  }
}

function showStreamStatus(state, title, detail = "") {
  const overlay = document.getElementById("streamStatusOverlay");
  if (!overlay) return;
  overlay.dataset.state = state;
  overlay.setAttribute("role", state === "error" ? "alert" : "status");
  overlay.setAttribute("aria-live", state === "error" ? "assertive" : "polite");
  overlay.hidden = false;
  const titleEl = document.getElementById("streamStatusTitle");
  const detailEl = document.getElementById("streamStatusDetail");
  if (titleEl) titleEl.textContent = title || "";
  if (detailEl) detailEl.textContent = detail || "";
}

function hideStreamStatus() {
  const overlay = document.getElementById("streamStatusOverlay");
  if (!overlay) return;
  overlay.hidden = true;
  overlay.dataset.state = "";
}

function showStreamLoading(detail = "Connecting to live stream") {
  if (liveStreamMode) {
    showStreamStatus("loading", "Loading stream", detail);
  }
}

/**
 * Tracks the media-element listeners installed for the current live stream so
 * they can be removed before a new stream attaches. Without this, every
 * slipstream into a stream would stack another set of buffering/ready
 * listeners on the persistent <video> element.
 */
let liveStreamStatusListeners = null;

function clearLiveStreamStatusHandlers() {
  if (!liveStreamStatusListeners) return;
  const { mediaEl, entries } = liveStreamStatusListeners;
  for (const [type, handler, options] of entries) {
    mediaEl.removeEventListener(type, handler, options);
  }
  liveStreamStatusListeners = null;
}

function installLiveStreamStatusHandlers(mediaEl, hls = null) {
  if (!liveStreamMode || !mediaEl) return;
  // Drop any listeners left over from a previous stream before re-attaching.
  clearLiveStreamStatusHandlers();
  const showBuffering = () => {
    if (
      !mediaEl.error &&
      mediaEl.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
    ) {
      showStreamLoading("Buffering live stream");
    }
  };
  const hideReady = () => hideStreamStatus();
  const showLoadingOnce = () => showStreamLoading();

  mediaEl.addEventListener("loadstart", showLoadingOnce, { once: true });
  mediaEl.addEventListener("waiting", showBuffering);
  mediaEl.addEventListener("stalled", showBuffering);
  mediaEl.addEventListener("canplay", hideReady);
  mediaEl.addEventListener("playing", hideReady);
  liveStreamStatusListeners = {
    mediaEl,
    entries: [
      ["loadstart", showLoadingOnce, { once: true }],
      ["waiting", showBuffering, undefined],
      ["stalled", showBuffering, undefined],
      ["canplay", hideReady, undefined],
      ["playing", hideReady, undefined],
    ],
  };

  const hlsEvents = hls?.constructor?.Events;
  if (hlsEvents?.MANIFEST_PARSED) {
    hls.on(hlsEvents.MANIFEST_PARSED, () =>
      showStreamLoading("Buffering live stream"),
    );
  }
  if (hlsEvents?.ERROR) {
    hls.on(hlsEvents.ERROR, (_event, data) => {
      if (data?.fatal) {
        reportProjectionError(
          "Live stream playback failed",
          data?.details || data?.reason || data?.type || "HLS error",
        );
      }
    });
  }
}

do {
  if (argv[i].startsWith("__mediaf")) {
    mediaFile = decodeURIComponent(argv[i].substring(16));
  } else if (argv[i] === "__isImg") {
    isImg = true;
  } else if (argv[i] === "__isPptx") {
    isPptx = true;
  } else if (argv[i].startsWith("__pptxSlide=")) {
    pptxStartSlide = parseInt(argv[i].substring(12), 10) || 0;
  } else if (argv[i] === "__live-stream=true") {
    liveStreamMode = true;
  } else if (argv[i].startsWith("__start-t")) {
    strtTm = parseFloat(argv[i].substring(13));
  } else if (argv[i].startsWith("__start-v")) {
    strtvl = parseFloat(argv[i].substring(12));
  } else if (argv[i] === "__media-loop=true") {
    loopFile = true;
  } else if (argv[i] === "__autoplay=true") {
    autoPlay = true;
  } else if (argv[i] === "__seek-only") {
    seekOnly = true;
  } else if (argv[i] === "__isText") {
    isText = true;
  } else if (argv[i] === "__lowerThirdOutput") {
    isLowerThirdOutput = true;
  }
  --i;
} while (argv[i][0] !== "-");

function getPptxListRenderOptions(slideCount) {
  if (Number.isFinite(slideCount) && slideCount <= PPTX_SMALL_DECK_MAX_SLIDES) {
    return {
      batchSize: 12,
      windowed: true,
      initialSlides: 4,
      overscanViewport: 1.5,
    };
  }
  if (Number.isFinite(slideCount) && slideCount >= PPTX_LARGE_DECK_MIN_SLIDES) {
    return {
      batchSize: 4,
      windowed: true,
      initialSlides: 2,
      overscanViewport: 2,
    };
  }
  return {
    batchSize: 8,
    windowed: true,
    initialSlides: 4,
    overscanViewport: 1.5,
  };
}

function waitForMediaMetadata(mediaEl) {
  if (!mediaEl) {
    return Promise.reject(new Error("Missing media element"));
  }
  if (mediaEl.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      mediaEl.removeEventListener("loadedmetadata", onLoaded);
      mediaEl.removeEventListener("error", onError);
    };
    const onLoaded = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(mediaEl.error ?? new Error("Failed to load media metadata"));
    };
    mediaEl.addEventListener("loadedmetadata", onLoaded, { once: true });
    mediaEl.addEventListener("error", onError, { once: true });
  });
}

async function applyVideoStartTime(mediaEl, requestedStartTime) {
  if (!mediaEl || !Number.isFinite(requestedStartTime) || requestedStartTime <= 0) {
    return;
  }
  await waitForMediaMetadata(mediaEl);
  let safeTime = requestedStartTime;
  if (Number.isFinite(mediaEl.duration) && mediaEl.duration > 0) {
    safeTime = Math.min(requestedStartTime, Math.max(0, mediaEl.duration - 0.15));
  }
  if (safeTime < 0) safeTime = 0;
  mediaEl.currentTime = safeTime;
}

/**
 * hls.js tuning for network streams (YouTube live HLS, generic m3u8) in the
 * projection window. Start quickly on live streams, then let ABR climb once
 * hls.js has measured real segment throughput.
 */
const HLS_PRESENTATION_CONFIG = {
  maxBufferLength: 30,
  maxMaxBufferLength: 180,
  maxBufferSize: 80 * 1000 * 1000,
  startFragPrefetch: true,
  highBufferWatchdogPeriod: 1,
  /** Live only: stay about 30s behind live for a larger stability cushion. */
  liveSyncDuration: 30,
  /** Prefer filling the standard buffer over LL-HLS “stay on the edge” behaviour */
  lowLatencyMode: false,
  /** Quality: never cap quality to player render size — projection is fullscreen. */
  capLevelToPlayerSize: false,
  /** Let hls.js measure bandwidth instead of assuming top-quality capacity. */
  testBandwidth: true,
  /** Conservative startup estimate; ABR can still ramp up after playback begins. */
  abrEwmaDefaultEstimate: 5_000_000,
  /** Start in ABR mode instead of pinning the first fragment to the highest level. */
  startLevel: -1,
};

async function createStreamingHls() {
  const { default: Hls } = await import(
    "../../node_modules/hls.js/dist/hls.mjs",
  );
  return new Hls(HLS_PRESENTATION_CONFIG);
}

/** dash.js tuning for YouTube DASH (and similar): higher buffer targets before switching down */
function configureDashAggressiveBuffer(player) {
  player.updateSettings({
    streaming: {
      buffer: {
        bufferTimeDefault: 45,
        bufferTimeAtTopQuality: 35,
        bufferTimeAtTopQualityLongForm: 90,
        initialBufferLevel: 15,
        bufferToKeep: 40,
      },
      scheduling: {
        scheduleWhilePaused: true,
      },
    },
  });
}

function isDubbedOrDescriptiveLabel(label) {
  if (typeof label !== "string" || label.length === 0) return false;
  return /(dub(?:bed)?|translated|translation|voice.?over|describ|narrat)/i.test(
    label,
  );
}

function scoreAudioTrack(track, index) {
  const label = [
    track?.name,
    track?.label,
    track?.lang,
    track?.language,
    track?.id,
    Array.isArray(track?.roles) ? track.roles.join(" ") : "",
  ]
    .filter((value) => typeof value === "string" && value.length > 0)
    .join(" ");
  let score = 0;
  if (track?.default === true || track?.audio_is_default === true) score += 200;
  if (/\boriginal\b/i.test(label)) score += 120;
  if (/\b(main|primary|default)\b/i.test(label)) score += 60;
  if (isDubbedOrDescriptiveLabel(label)) score -= 300;
  score -= index * 0.01;
  return score;
}

function pickPreferredTrackIndex(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) return -1;
  let bestIndex = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < tracks.length; i += 1) {
    const score = scoreAudioTrack(tracks[i], i);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function selectPreferredNativeAudioTrack(videoEl) {
  const tracks = videoEl?.audioTracks;
  if (!tracks || typeof tracks.length !== "number" || tracks.length === 0) return;
  const list = [];
  for (let i = 0; i < tracks.length; i += 1) {
    list.push(tracks[i]);
  }
  const preferredIndex = pickPreferredTrackIndex(list);
  if (preferredIndex < 0) return;
  for (let i = 0; i < tracks.length; i += 1) {
    tracks[i].enabled = i === preferredIndex;
  }
}

function selectPreferredHlsAudioTrack(hls) {
  const trackList = hls?.audioTracks;
  if (!Array.isArray(trackList) || trackList.length === 0) return;
  const idx = pickPreferredTrackIndex(trackList);
  if (idx >= 0 && hls.audioTrack !== idx) {
    hls.audioTrack = idx;
  }
}

function ensurePreferredDashAudioTrack(player, maxAttempts = 25) {
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    try {
      const tracks = player.getTracksFor("audio");
      if (Array.isArray(tracks) && tracks.length > 0) {
        const idx = pickPreferredTrackIndex(tracks);
        if (idx >= 0 && tracks[idx]) {
          player.setCurrentTrack(tracks[idx]);
        }
        clearInterval(timer);
        return;
      }
    } catch {
      // Ignore transient startup errors while dash.js enumerates tracks.
    }
    if (attempts >= maxAttempts) {
      clearInterval(timer);
    }
  }, 200);
}

/**
 * Resolve which kind of content a slipstream payload describes. Every supported
 * content type is represented here so the transition logic can be expressed as
 * a single any-to-any state machine instead of a chain of pairwise special
 * cases.
 */
const SLIPSTREAM_TARGET_TEXT = "text";
const SLIPSTREAM_TARGET_PPTX = "pptx";
const SLIPSTREAM_TARGET_IMAGE = "image";
const SLIPSTREAM_TARGET_VIDEO = "video";

function resolveSlipstreamTargetType(data) {
  if (data?.isText) return SLIPSTREAM_TARGET_TEXT;
  if (data?.isPptx) return SLIPSTREAM_TARGET_PPTX;
  if (data?.isImg) return SLIPSTREAM_TARGET_IMAGE;
  return SLIPSTREAM_TARGET_VIDEO;
}

function ensurePptxProcessEnv() {
  if (!globalThis.process) {
    globalThis.process = { env: {} };
  } else if (!globalThis.process.env) {
    globalThis.process.env = {};
  }
}

/** Destroy any live-stream player attached to the shared <video> element. */
function teardownStreamingPlayers() {
  clearLiveStreamStatusHandlers();
  if (hlsInstance) {
    try {
      hlsInstance.destroy();
    } catch {}
    hlsInstance = null;
  }
  if (dashPlayer) {
    try {
      dashPlayer.reset();
    } catch {}
    try {
      dashPlayer.destroy?.();
    } catch {}
    dashPlayer = null;
  }
  if (dashManifestObjectUrl) {
    try {
      URL.revokeObjectURL(dashManifestObjectUrl);
    } catch {}
    dashManifestObjectUrl = null;
  }
}

/** Stop the <video> element and fully detach its current source. */
function teardownVideoElement() {
  teardownStreamingPlayers();
  const videoEl = document.querySelector("video");
  try {
    video?.pause();
  } catch {
    /* element may already be paused-at-end */
  }
  if (video) {
    video.removeAttribute("src");
    video.load();
  }
  if (videoEl) videoEl.style.display = "none";
}

function teardownImageElement() {
  if (img) img.style.display = "none";
}

function teardownTextPresentation() {
  textPresentationState.signature = "";
  const textCanvas = document.getElementById("textCanvas");
  if (textCanvas) {
    textCanvas.style.display = "none";
    textCanvas.style.backgroundImage = "";
    textCanvas.style.backgroundSize = "";
    textCanvas.style.backgroundPosition = "";
  }
  const backgroundVideo = document.getElementById("textBackgroundVideo");
  if (backgroundVideo) {
    resetTextBackgroundVideo(backgroundVideo);
  }
}

function teardownPptxViewer() {
  const pptxCanvas = document.getElementById("pptxCanvas");
  if (pptxCanvas) pptxCanvas.style.display = "none";
  if (window._pptxMediaViewer) {
    try {
      window._pptxMediaViewer.destroy();
    } catch {}
    window._pptxMediaViewer = null;
  }
}

function activateTextTarget(data) {
  installTextHandlers();
  const textCanvas = document.getElementById("textCanvas");
  if (textCanvas) textCanvas.style.display = "flex";
  if (data.textPayload) {
    applyTextMessage(data.textPayload);
  }
}

async function activatePptxTarget(data) {
  installPptxIpcHandlers();
  ensurePptxProcessEnv();
  // teardownPptxViewer only runs when switching away from PPTX; for a
  // PPTX -> PPTX swap we still need a fresh viewer for the new deck.
  if (window._pptxMediaViewer) {
    try {
      window._pptxMediaViewer.destroy();
    } catch {}
    window._pptxMediaViewer = null;
  }
  const pptxCanvas = document.getElementById("pptxCanvas");
  pptxCanvas.style.display = "flex";
  pptxCanvas.innerHTML = "";
  const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import(
    "../../node_modules/@aiden0z/pptx-renderer/dist/aiden0z-pptx-renderer.es.js"
  );
  const arrayBuffer = await ipcRenderer.invoke(
    "read-file-as-arraybuffer",
    mediaFile
  );
  window._pptxMediaViewer = await PptxViewer.open(arrayBuffer, pptxCanvas, {
    zipLimits: RECOMMENDED_ZIP_LIMITS,
    fitMode: "contain",
    renderMode: "slide",
    // Single-slide mode is already cheap; list renders use windowed mounting.
    listOptions: getPptxListRenderOptions(),
  });
  await applyPptxContainPolicyMedia();
  await showPptxSlideInMediaWindow(data.pptxStartSlide || 0);
}

function activateImageTarget() {
  if (!img) {
    img = document.createElement("img");
    img.setAttribute("id", "bigPlayer");
    document.body.appendChild(img);
  }
  img.src = mediaFile;
  img.style.display = "block";
}

async function activateVideoTarget(data) {
  // A previous live stream could still own the <video> element; drop its
  // player so it can't keep pushing data into the element we're reusing.
  teardownStreamingPlayers();
  const videoEl = document.querySelector("video");
  setLoopEnabled(loopFile);
  if (data.startVolume != null && video) {
    video.volume = data.startVolume;
  }
  // Per HTML5 spec, assigning to .src aborts the current load and resets the
  // media element. Don't call removeAttribute("src") + load() here — that
  // briefly puts the element in NETWORK_EMPTY and races the new src assignment.
  video.src = mediaFile;
  if (videoEl) videoEl.style.display = "block";
  // A video reached via slipstream (e.g. image -> video) must behave exactly
  // like one loaded fresh, including firing media-playback-ended for queue
  // auto-advance. Install the shared wiring here in case the initial media
  // type bypassed it.
  installVideoPlaybackWiring();
  if (Number.isFinite(data.startTime) && data.startTime > 0) {
    try {
      await applyVideoStartTime(video, data.startTime);
    } catch {}
  }
  await video.play().catch(() => {});
}

/**
 * Attach a live stream (HLS / DASH / progressive, including resolved YouTube
 * URLs) to the shared <video> element during the initial window load. Any
 * previously attached stream player and its status listeners are destroyed
 * first. Live streams are not slipstreamed; the queue uses a close/reopen cycle
 * for them.
 */
async function startLiveStreamPlayback(url) {
  teardownStreamingPlayers();
  try {
    video.pause();
  } catch {}
  liveStreamMode = true;

  let ytResolved = null;
  streamActsAsLiveEdge = !matchYouTubeUrl(url);
  if (matchYouTubeUrl(url)) {
    showStreamLoading("Resolving YouTube stream");
    ytResolved = await ipcRenderer.invoke("resolve-youtube-stream", url);
    streamActsAsLiveEdge = ytResolved.type === "hls";
  }

  showStreamLoading("Connecting to live stream");
  if (ytResolved) {
    if (ytResolved.type === "hls") {
      hlsInstance = await createStreamingHls();
      installLiveStreamStatusHandlers(video, hlsInstance);
      hlsInstance.loadSource(ytResolved.url);
    } else if (ytResolved.type === "progressive") {
      installLiveStreamStatusHandlers(video);
      video.src = ytResolved.url;
    } else if (ytResolved.type === "dash") {
      installLiveStreamStatusHandlers(video);
      const { MediaPlayer } = await import(
        "../../node_modules/dashjs/dist/modern/esm/dash.all.min.js"
      );
      dashPlayer = MediaPlayer().create();
      configureDashAggressiveBuffer(dashPlayer);
      dashManifestObjectUrl = URL.createObjectURL(
        new Blob([ytResolved.manifest], { type: "application/dash+xml" }),
      );
      dashPlayer.initialize(video, dashManifestObjectUrl, false);
    }
  } else {
    hlsInstance = await createStreamingHls();
    installLiveStreamStatusHandlers(video, hlsInstance);
    hlsInstance.loadSource(url);
  }

  // A non-live-edge stream (e.g. YouTube VOD) behaves like a finite clip, so it
  // gets the full playback wiring (remaining time, end-of-media). A true live
  // edge only needs end-of-media handling for unexpected stops.
  if (!streamActsAsLiveEdge) {
    installVideoPlaybackWiring();
  } else {
    video.onended = () => {
      if (loopFile || video.loop) return;
      video.style.display = "none";
      ipcRenderer.send("media-playback-ended", mediaFile);
    };
  }

  if (hlsInstance) {
    const hlsEvents = hlsInstance.constructor?.Events;
    if (hlsEvents?.MANIFEST_PARSED) {
      hlsInstance.on(hlsEvents.MANIFEST_PARSED, () =>
        selectPreferredHlsAudioTrack(hlsInstance),
      );
    }
    if (hlsEvents?.AUDIO_TRACKS_UPDATED) {
      hlsInstance.on(hlsEvents.AUDIO_TRACKS_UPDATED, () =>
        selectPreferredHlsAudioTrack(hlsInstance),
      );
    }
    hlsInstance.attachMedia(video);
  }
  // once:true so each stream load installs exactly one track-selection pass and
  // nothing accumulates on the persistent <video> element across slipstreams.
  video.addEventListener(
    "loadedmetadata",
    () => selectPreferredNativeAudioTrack(video),
    { once: true },
  );
  video
    .play()
    .catch((error) =>
      reportProjectionError("Live stream playback did not start", error),
    );
}

/**
 * Swap the projection window to a new piece of media without tearing the window
 * down. This is an any-to-any transition between local media files, PPTX decks,
 * images, and text/scripture: whatever is currently showing is torn down before
 * the new target is activated, so every combination behaves identically. (Live
 * streams are not slipstreamed; the queue close/reopens the window for those.)
 */
async function applySlipstream(data) {
  hideStreamStatus();
  const target = resolveSlipstreamTargetType(data);
  mediaFile = data.mediaFile ?? mediaFile;
  setLoopEnabled(!!data.loopFile);

  // Canonical content-type flags are derived solely from the new target so
  // stale flags from the previous type can never leak through.
  isText = target === SLIPSTREAM_TARGET_TEXT;
  isPptx = target === SLIPSTREAM_TARGET_PPTX;
  isImg = target === SLIPSTREAM_TARGET_IMAGE;
  streamActsAsLiveEdge = false;
  liveStreamMode = false;

  // Tear down every subsystem that is not the new target. Each teardown is
  // idempotent, so it is safe regardless of what was previously showing.
  if (target !== SLIPSTREAM_TARGET_TEXT) teardownTextPresentation();
  if (target !== SLIPSTREAM_TARGET_PPTX) teardownPptxViewer();
  if (target !== SLIPSTREAM_TARGET_IMAGE) teardownImageElement();
  // The video target reuses the <video> element directly (assigning .src), so
  // the element must not be detached here; every other target releases it.
  if (target !== SLIPSTREAM_TARGET_VIDEO) teardownVideoElement();

  switch (target) {
    case SLIPSTREAM_TARGET_TEXT:
      activateTextTarget(data);
      return;
    case SLIPSTREAM_TARGET_PPTX:
      await activatePptxTarget(data);
      return;
    case SLIPSTREAM_TARGET_IMAGE:
      activateImageTarget();
      return;
    default:
      await activateVideoTarget(data);
      return;
  }
}

window.emsApplySlipstream = applySlipstream;
window.emsGetPptxCurrentSlide = () => (isPptx ? pptxCurrentSlide : null);
window.emsSetLoopEnabled = setLoopEnabled;
window.emsGetLoopEnabled = () => !!loopFile;

function installICPHandlers() {
  if (ipcHandlersInstalled) return;
  ipcHandlersInstalled = true;

  ipcRenderer.on("timeGoto-message", function (evt, message) {
    if (
      streamActsAsLiveEdge ||
      isText ||
      isPptx ||
      isImg ||
      !message ||
      !Number.isFinite(message.currentTime) ||
      !Number.isFinite(message.timestamp)
    ) {
      return;
    }

    const localTs = performance.now();
    const now = Date.now();
    const travelTime = now - message.timestamp;

    const adjustedTime = message.currentTime + travelTime * 0.001;
    requestAnimationFrame(() => {
      video.currentTime =
        adjustedTime + (performance.now() - localTs) * 0.001;
    });
  });

  ipcRenderer.on("play-ctl", async function (event, cmd) {
    if (cmd == "pause") {
      video.pause();
    } else if (cmd == "play") {
      await video.play();
    }
  });

  ipcRenderer.on("vlcl", function (evt, message) {
    video.volume = message;
  });

  ipcRenderer.on("slipstream", async (event, data) => {
    await applySlipstream(data);
  });
}

function getPptxSlidesInMediaWindow(pptxCanvas) {
  const queried = Array.from(pptxCanvas.querySelectorAll("[data-slide-index]"));
  if (queried.length > 0) {
    const byIndex = new Map();
    queried.forEach((el) => {
      const idx = Number.parseInt(el.getAttribute("data-slide-index"), 10);
      if (Number.isFinite(idx) && !byIndex.has(idx)) byIndex.set(idx, { idx, el });
    });
    if (byIndex.size > 0) {
      return Array.from(byIndex.entries())
        .sort((a, b) => a[0] - b[0])
        .map((entry) => entry[1]);
    }
  }
  return Array.from(pptxCanvas.children)
    .filter((el) => el && el.nodeType === 1)
    .map((el, idx) => ({ idx, el }));
}

async function showPptxSlideInMediaWindow(index) {
  const pptxCanvas = document.getElementById("pptxCanvas");
  if (!pptxCanvas) return;
  pptxCurrentSlide = index;
  try {
    await window._pptxMediaViewer?.renderSlide(index);
  } catch {}
  const slides = Array.from(pptxCanvas.children).filter((el) => el && el.nodeType === 1);
  slides.forEach((slideEl) => {
    slideEl.style.display = "flex";
    const svgs = slideEl.querySelectorAll("svg");
    svgs.forEach((svg) => {
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.style.width = "100%";
      svg.style.height = "100%";
      svg.style.display = "block";
    });
  });
  await applyPptxContainPolicyMedia();
}

async function applyPptxContainPolicyMedia() {
  const viewer = window._pptxMediaViewer;
  if (!viewer) return;
  try {
    await viewer.setFitMode("contain");
    await viewer.setZoom(100);
  } catch {}
}

function installPptxIpcHandlers() {
  if (pptxIpcHandlersInstalled) return;
  pptxIpcHandlersInstalled = true;
  ipcRenderer.on("pptx-goto-slide", (event, data) => {
    if (typeof data?.slideIndex === "number") {
      void showPptxSlideInMediaWindow(data.slideIndex);
    }
  });
}

function sendRemainingTime(video) {
  let lastTime = 0; // Last time the message was sent
  const interval = 1000 / 30; // Set the interval for 30 updates per second

  const send = () => {
    const currentTime = performance.now();
    // Update only if at least 33.33 milliseconds have passed. Skip live-edge
    // streams: this loop is installed once for the window's lifetime, so a
    // slipstream into a true live stream must not start emitting bogus
    // (Infinity-duration) remaining-time updates.
    if (
      currentTime - lastTime > interval &&
      !video.paused &&
      !streamActsAsLiveEdge
    ) {
      ipcRenderer.send("timeRemaining-message", [
        video.duration,
        video.currentTime,
        Date.now() + (currentTime - performance.now()),
        mediaFile,
      ]);
      lastTime = currentTime;
    }
    requestAnimationFrame(send);
  };
  requestAnimationFrame(send);
}

function pauseMediaSessionHandler() {
  ipcRenderer.send("remoteplaypause", true);
  video.pause();
}

function playMediaSessionHandler() {
  ipcRenderer.send("remoteplaypause", false);
  video.play();
}

function matchYouTubeUrl(url) {
  if (typeof url !== "string" || url.length === 0) return false;
  if (/^[\w-]{11}$/.test(url.trim())) return true;
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    const h = u.hostname.replace(/^www\./, "").toLowerCase();
    return (
      h === "youtu.be" ||
      h === "youtube.com" ||
      h === "m.youtube.com" ||
      h === "music.youtube.com"
    );
  } catch {
    return false;
  }
}

function playbackStateUpdate() {
  // A true live-edge stream has no meaningful preview mirror; don't forward its
  // play/pause state (these listeners persist for the window's lifetime and may
  // still be attached from an earlier non-stream clip).
  if (streamActsAsLiveEdge) return;
  const playbackState = {
    currentTime: video.currentTime,
    playing: !video.paused,
  };
  ipcRenderer.send("playback-state-change", playbackState);
  if (strtvl != null) {
    video.volume = strtvl;
    strtvl = null;
  }
}

/**
 * Install the media-session controls, playback-state listeners, remaining-time
 * reporting and end-of-media handling on the shared <video> element. Safe to
 * call from any entry point (initial load or a slipstream transition) — the
 * guard ensures the listeners are only attached once, while the persistent
 * handlers always read the current `mediaFile` / `loopFile` globals.
 */
function installVideoPlaybackWiring() {
  if (videoPlaybackWiringInstalled || !video) return;
  videoPlaybackWiringInstalled = true;

  navigator.mediaSession.setActionHandler("play", playMediaSessionHandler);
  navigator.mediaSession.setActionHandler("pause", pauseMediaSessionHandler);
  navigator.mediaSession.setActionHandler("seekbackward", () => {
    ipcRenderer.send("media-seek", -10);
  });
  navigator.mediaSession.setActionHandler("seekforward", () => {
    ipcRenderer.send("media-seek", 10);
  });
  navigator.mediaSession.setActionHandler("seekto", (details) => {
    ipcRenderer.send("media-seekto", details.seekTime);
  });

  video.addEventListener("play", playbackStateUpdate);
  video.addEventListener("pause", playbackStateUpdate);

  video.onended = () => {
    if (loopFile || video.loop) return;
    video.style.display = "none";
    ipcRenderer.send("media-playback-ended", mediaFile);
  };

  sendRemainingTime(video);
  video.addEventListener("pause", () => {
    if (video.duration - video.currentTime < 0.1) {
      video.currentTime = video.duration;
    }
  });
}

const DEFAULT_TEXT_PRESENTATION = Object.freeze({
  text: "",
  color: "#ffffff",
  fontSize: SCRIPTURE_BODY_FONT_SIZE,
  autosizeMode: SCRIPTURE_DEFAULT_AUTOSIZE_MODE,
  minFontSize: SCRIPTURE_MIN_BODY_FONT_SIZE,
  autoSplit: true,
  autosizeGroupFontSize: undefined,
  fontFamily: SCRIPTURE_FONT_FAMILY,
  fontWeight: SCRIPTURE_FONT_WEIGHT,
  lineHeight: SCRIPTURE_LINE_HEIGHT,
  referenceFontSize: SCRIPTURE_REFERENCE_FONT_SIZE,
  attributionText: "",
  backgroundColor: "#000000",
  backgroundImage: "",
  backgroundVideo: "",
  backgroundVideoSync: null,
  chromaKeyColor: "#00ff00",
  outputRole: "",
  bodyText: "",
  referenceText: "",
  referenceColor: "",
  referenceTextShadow: "",
  fullBodyText: "",
  look: SCRIPTURE_LOOK_FULLSCREEN,
  lowerThirdSegments: [],
  lowerThirdSegmentIndex: 0,
  lowerThirdSegmentCount: 0,
  position: {
    vertical: "center",
    horizontal: "center",
  },
});

const textPresentationState = {
  backgroundVideo: "",
  lastMessage: null,
  signature: "",
};
let textPresentationResizeFrame = 0;

function normalizeScriptureLook(value) {
  return value === SCRIPTURE_LOOK_LOWER_THIRD
    ? SCRIPTURE_LOOK_LOWER_THIRD
    : SCRIPTURE_LOOK_FULLSCREEN;
}

function normalizeScriptureAutosizeMode(value) {
  if (value === SCRIPTURE_AUTOSIZE_NONE) return SCRIPTURE_AUTOSIZE_NONE;
  if (value === SCRIPTURE_AUTOSIZE_NORMALIZE) return SCRIPTURE_AUTOSIZE_NORMALIZE;
  return SCRIPTURE_AUTOSIZE_FIT;
}

function normalizeScriptureFontSize(value, fallback = SCRIPTURE_BODY_FONT_SIZE) {
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) ? numeric : fallback;
  return Math.max(
    SCRIPTURE_ABSOLUTE_MIN_BODY_FONT_SIZE,
    Math.min(160, Math.round(resolved)),
  );
}

function normalizeScriptureMinFontSize(value, preferredFontSize = SCRIPTURE_BODY_FONT_SIZE) {
  const preferred = normalizeScriptureFontSize(preferredFontSize);
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) ? numeric : SCRIPTURE_MIN_BODY_FONT_SIZE;
  return Math.max(
    SCRIPTURE_ABSOLUTE_MIN_BODY_FONT_SIZE,
    Math.min(preferred, Math.round(resolved)),
  );
}

function scriptureLowerThirdFontSize(fontSize) {
  const base = Number.isFinite(fontSize) ? fontSize : SCRIPTURE_BODY_FONT_SIZE;
  return Math.max(26, Math.min(72, Math.round(base * 0.68)));
}

function scriptureColorToRgb(value) {
  const color = String(value || "").trim();
  const hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return {
        r: Number.parseInt(hex[0] + hex[0], 16),
        g: Number.parseInt(hex[1] + hex[1], 16),
        b: Number.parseInt(hex[2] + hex[2], 16),
      };
    }
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }
  const rgbMatch = color.match(
    /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+[\d.]+)?\s*\)$/i,
  );
  if (!rgbMatch) return null;
  return {
    r: Math.max(0, Math.min(255, Number.parseInt(rgbMatch[1], 10))),
    g: Math.max(0, Math.min(255, Number.parseInt(rgbMatch[2], 10))),
    b: Math.max(0, Math.min(255, Number.parseInt(rgbMatch[3], 10))),
  };
}

function scriptureRelativeLuminance({ r, g, b }) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function scriptureReferencePresentationForBackground(backgroundColor, options = {}) {
  if (options.forceLight === true) {
    return {
      color: SCRIPTURE_REFERENCE_LIGHT_COLOR,
      shadow: SCRIPTURE_REFERENCE_LIGHT_SHADOW,
    };
  }
  const rgb = scriptureColorToRgb(backgroundColor);
  if (!rgb) {
    return {
      color: SCRIPTURE_REFERENCE_LIGHT_COLOR,
      shadow: SCRIPTURE_REFERENCE_LIGHT_SHADOW,
    };
  }
  const isLightBackground =
    scriptureRelativeLuminance(rgb) >= SCRIPTURE_REFERENCE_LIGHT_BACKGROUND_LUMINANCE;
  return isLightBackground
    ? {
        color: SCRIPTURE_REFERENCE_DARK_COLOR,
        shadow: SCRIPTURE_REFERENCE_DARK_SHADOW,
      }
    : {
        color: SCRIPTURE_REFERENCE_LIGHT_COLOR,
        shadow: SCRIPTURE_REFERENCE_LIGHT_SHADOW,
      };
}

function applyScriptureRenderVariables(el, message) {
  if (!el) return;
  const bodyFontSize = normalizeScriptureFontSize(
    message.fontSize,
    SCRIPTURE_BODY_FONT_SIZE,
  );
  const referenceFontSize = Math.max(
    14,
    Math.round(message.referenceFontSize || SCRIPTURE_REFERENCE_FONT_SIZE),
  );
  const attributionFontSize = Math.max(12, Math.round(referenceFontSize * 0.42));
  el.style.setProperty("--scripture-font-size", `${bodyFontSize}px`);
  el.style.setProperty(
    "--scripture-lower-third-font-size",
    `${scriptureLowerThirdFontSize(bodyFontSize)}px`,
  );
  el.style.setProperty("--scripture-reference-font-size", `${referenceFontSize}px`);
  el.style.setProperty("--scripture-attribution-font-size", `${attributionFontSize}px`);
  el.style.setProperty("--scripture-line-height", `${message.lineHeight || SCRIPTURE_LINE_HEIGHT}`);
  el.style.setProperty("--scripture-font-weight", `${message.fontWeight || SCRIPTURE_FONT_WEIGHT}`);
  el.style.setProperty("--scripture-color", message.color || "#ffffff");
  const referencePresentation = scriptureReferencePresentationForBackground(
    message.backgroundColor,
    {
      forceLight:
        normalizeScriptureLook(message.look) === SCRIPTURE_LOOK_LOWER_THIRD ||
        Boolean(message.backgroundImage || message.backgroundVideo || message.backgroundPath),
    },
  );
  el.style.setProperty(
    "--scripture-reference-color",
    message.referenceColor || referencePresentation.color,
  );
  el.style.setProperty(
    "--scripture-reference-shadow",
    message.referenceTextShadow || referencePresentation.shadow,
  );
  el.style.fontFamily = message.fontFamily || SCRIPTURE_FONT_FAMILY;
}

function scriptureReferenceSizeForBody(bodyFontSize, baseReferenceSize, baseBodySize) {
  const referenceScale = baseReferenceSize / Math.max(1, baseBodySize);
  return Math.max(
    SCRIPTURE_MIN_REFERENCE_FONT_SIZE,
    Math.round(bodyFontSize * referenceScale),
  );
}

function setFullscreenScriptureRenderFontSize(
  render,
  bodyFontSize,
  baseReferenceSize,
  baseBodySize,
) {
  const referenceFontSize = scriptureReferenceSizeForBody(
    bodyFontSize,
    baseReferenceSize,
    baseBodySize,
  );
  render.style.setProperty("--scripture-font-size", `${bodyFontSize}px`);
  render.style.setProperty("--scripture-reference-font-size", `${referenceFontSize}px`);
  render.style.setProperty(
    "--scripture-attribution-font-size",
    `${Math.max(12, Math.round(referenceFontSize * 0.42))}px`,
  );
  return referenceFontSize;
}

function scriptureRenderBoxFits(render, box, maxHeight) {
  const boxBounds = box.getBoundingClientRect();
  const availableWidth = Math.max(1, box.clientWidth || boxBounds.width || render.clientWidth);
  return (
    box.scrollHeight <= Math.ceil(maxHeight) + 1 &&
    box.scrollWidth <= Math.ceil(availableWidth) + 1
  );
}

function findLargestFittingScriptureFontSize(
  render,
  box,
  maxHeight,
  minBodySize,
  maxBodySize,
  applyCandidate,
) {
  const highLimit = Math.max(minBodySize, Math.round(maxBodySize));
  applyCandidate(highLimit);
  if (scriptureRenderBoxFits(render, box, maxHeight)) return highLimit;

  let low = minBodySize;
  let high = highLimit;
  let best = minBodySize;
  while (low <= high) {
    const candidate = Math.floor((low + high) / 2);
    applyCandidate(candidate);
    if (scriptureRenderBoxFits(render, box, maxHeight)) {
      best = candidate;
      low = candidate + 1;
    } else {
      high = candidate - 1;
    }
  }
  applyCandidate(best);
  return best;
}

function fitFullscreenScriptureRender(render, message) {
  if (!render || normalizeScriptureLook(message?.look) !== SCRIPTURE_LOOK_FULLSCREEN) return;
  const box = render.querySelector(".scripture-render__box");
  if (!box) return;
  const autosizeMode = normalizeScriptureAutosizeMode(message.autosizeMode);
  const baseBodySize = normalizeScriptureFontSize(
    message.fontSize,
    SCRIPTURE_BODY_FONT_SIZE,
  );
  const baseReferenceSize = Math.max(
    14,
    Math.round(message.referenceFontSize || SCRIPTURE_REFERENCE_FONT_SIZE),
  );
  const minBodySize = normalizeScriptureMinFontSize(message.minFontSize, baseBodySize);
  const renderBounds = render.getBoundingClientRect();
  const maxHeight =
    Math.max(180, render.clientHeight || renderBounds.height || window.innerHeight || 720) *
    SCRIPTURE_FIT_HEIGHT_RATIO;
  const groupFontSize = Number.isFinite(message.autosizeGroupFontSize)
    ? Math.max(
        minBodySize,
        Math.min(baseBodySize, normalizeScriptureFontSize(message.autosizeGroupFontSize)),
      )
    : null;

  const applyCandidate = (fontSize) =>
    setFullscreenScriptureRenderFontSize(
      render,
      fontSize,
      baseReferenceSize,
      baseBodySize,
    );

  if (autosizeMode === SCRIPTURE_AUTOSIZE_NONE) {
    applyCandidate(baseBodySize);
    return;
  }

  if (groupFontSize !== null) {
    applyCandidate(groupFontSize);
    if (!scriptureRenderBoxFits(render, box, maxHeight)) {
      findLargestFittingScriptureFontSize(
        render,
        box,
        maxHeight,
        minBodySize,
        groupFontSize,
        applyCandidate,
      );
    }
    return;
  }

  findLargestFittingScriptureFontSize(
    render,
    box,
    maxHeight,
    minBodySize,
    baseBodySize,
    applyCandidate,
  );
}

function refitCurrentTextPresentation() {
  if (!textPresentationState.lastMessage) return;
  const textContent = document.getElementById("textContent");
  if (!textContent) return;
  fitFullscreenScriptureRender(textContent, textPresentationState.lastMessage);
}

function scheduleTextPresentationRefit() {
  if (textPresentationResizeFrame) {
    window.cancelAnimationFrame(textPresentationResizeFrame);
  }
  textPresentationResizeFrame = window.requestAnimationFrame(() => {
    textPresentationResizeFrame = 0;
    refitCurrentTextPresentation();
  });
}

function ensureScriptureTextShell(textContent) {
  if (!textContent) return {};
  let box = textContent.querySelector(".scripture-render__box");
  if (!box) {
    textContent.textContent = "";
    box = document.createElement("div");
    box.className = "scripture-render__box";
    const body = document.createElement("div");
    body.id = "textBody";
    body.className = "scripture-render__body";
    const reference = document.createElement("div");
    reference.id = "textReference";
    reference.className = "scripture-render__reference";
    const attribution = document.createElement("div");
    attribution.id = "textAttribution";
    attribution.className = "scripture-render__attribution";
    box.append(body, reference, attribution);
    textContent.appendChild(box);
  }
  if (!box.querySelector(".scripture-render__attribution")) {
    const attribution = document.createElement("div");
    attribution.id = "textAttribution";
    attribution.className = "scripture-render__attribution";
    box.appendChild(attribution);
  }
  return {
    box,
    body: box.querySelector(".scripture-render__body"),
    reference: box.querySelector(".scripture-render__reference"),
    attribution: box.querySelector(".scripture-render__attribution"),
  };
}

function textPresentationSignature(message, bodyText, referenceText, attributionText) {
  const position =
    message && typeof message.position === "object"
      ? message.position
      : DEFAULT_TEXT_PRESENTATION.position;
  return JSON.stringify({
    text: message.text || "",
    bodyText,
    referenceText,
    attributionText,
    reference: message.reference || "",
    version: message.version || "",
    book: message.book || "",
    chapter: Number.isFinite(message.chapter) ? message.chapter : 0,
    verse: Number.isFinite(message.verse) ? message.verse : 0,
    verseEnd: Number.isFinite(message.verseEnd) ? message.verseEnd : 0,
    color: message.color || "",
    fontSize: Number.isFinite(message.fontSize) ? message.fontSize : DEFAULT_TEXT_PRESENTATION.fontSize,
    autosizeMode: normalizeScriptureAutosizeMode(message.autosizeMode),
    minFontSize: Number.isFinite(message.minFontSize)
      ? message.minFontSize
      : DEFAULT_TEXT_PRESENTATION.minFontSize,
    autoSplit:
      typeof message.autoSplit === "boolean"
        ? message.autoSplit
        : DEFAULT_TEXT_PRESENTATION.autoSplit,
    autosizeGroupFontSize: Number.isFinite(message.autosizeGroupFontSize)
      ? message.autosizeGroupFontSize
      : 0,
    fontFamily: message.fontFamily || "",
    fontWeight: Number.isFinite(message.fontWeight)
      ? message.fontWeight
      : DEFAULT_TEXT_PRESENTATION.fontWeight,
    lineHeight: Number.isFinite(message.lineHeight)
      ? message.lineHeight
      : DEFAULT_TEXT_PRESENTATION.lineHeight,
    referenceFontSize: Number.isFinite(message.referenceFontSize)
      ? message.referenceFontSize
      : DEFAULT_TEXT_PRESENTATION.referenceFontSize,
    referenceColor: message.referenceColor || "",
    referenceTextShadow: message.referenceTextShadow || "",
    look: normalizeScriptureLook(message.look),
    lowerThirdSegmentIndex: Number.isFinite(message.lowerThirdSegmentIndex)
      ? message.lowerThirdSegmentIndex
      : 0,
    lowerThirdSegmentCount: Number.isFinite(message.lowerThirdSegmentCount)
      ? message.lowerThirdSegmentCount
      : 0,
    lowerThirdSegments: Array.isArray(message.lowerThirdSegments)
      ? message.lowerThirdSegments.map((segment) => segment?.text || segment).join("|")
      : "",
    backgroundColor: message.backgroundColor || "",
    backgroundImage: message.backgroundImage || "",
    backgroundVideo: message.backgroundVideo || "",
    backgroundPath: message.backgroundPath || "",
    chromaKeyColor: message.chromaKeyColor || "",
    outputRole: message.outputRole || "",
    vertical: position.vertical || "",
    horizontal: position.horizontal || "",
  });
}

function seekTextBackgroundVideoToPreview(backgroundVideo, sync) {
  if (
    !backgroundVideo ||
    !sync ||
    !Number.isFinite(sync.currentTime) ||
    !Number.isFinite(sync.capturedAt)
  ) {
    return;
  }
  const elapsed = Math.max(0, (Date.now() - sync.capturedAt) * 0.001);
  let target = Math.max(
    0,
    sync.currentTime + elapsed + TEXT_BACKGROUND_VIDEO_LOAD_COMPENSATION_SEC,
  );
  if (Number.isFinite(backgroundVideo.duration) && backgroundVideo.duration > 0) {
    target %= backgroundVideo.duration;
  }
  try {
    backgroundVideo.currentTime = target;
  } catch {}
}

function resetTextBackgroundVideo(backgroundVideo, { keepSource = false } = {}) {
  if (!backgroundVideo) return;
  backgroundVideo.pause();
  if (!keepSource) {
    backgroundVideo.removeAttribute("src");
    backgroundVideo.load();
    textPresentationState.backgroundVideo = "";
  }
  backgroundVideo.style.display = "none";
}

function applyTextBackgroundVideoState(safeMessage, textCanvas) {
  let backgroundVideo = document.getElementById("textBackgroundVideo");
  if (safeMessage.backgroundVideo) {
    if (!backgroundVideo) {
      backgroundVideo = document.createElement("video");
      backgroundVideo.id = "textBackgroundVideo";
      backgroundVideo.autoplay = true;
      backgroundVideo.loop = true;
      backgroundVideo.muted = true;
      backgroundVideo.playsInline = true;
      textCanvas.prepend(backgroundVideo);
    }

    const shouldReloadVideo =
      textPresentationState.backgroundVideo !== safeMessage.backgroundVideo ||
      backgroundVideo.getAttribute("src") !== safeMessage.backgroundVideo;
    if (shouldReloadVideo) {
      backgroundVideo.addEventListener(
        "loadedmetadata",
        () => seekTextBackgroundVideoToPreview(backgroundVideo, safeMessage.backgroundVideoSync),
        { once: true },
      );
      backgroundVideo.src = safeMessage.backgroundVideo;
      backgroundVideo.load();
      textPresentationState.backgroundVideo = safeMessage.backgroundVideo;
    } else {
      seekTextBackgroundVideoToPreview(backgroundVideo, safeMessage.backgroundVideoSync);
    }
    backgroundVideo.style.display = "block";
    backgroundVideo.muted = true;
    backgroundVideo.defaultMuted = true;
    backgroundVideo.loop = true;
    if (shouldReloadVideo || backgroundVideo.paused) {
      void backgroundVideo.play().catch(() => {});
    }
  } else if (backgroundVideo) {
    resetTextBackgroundVideo(backgroundVideo);
  }
}

function applyTextMessage(message) {
  const textCanvas = document.getElementById("textCanvas");
  const textContent = document.getElementById("textContent");
  const safeMessage =
    message && typeof message === "object"
      ? {
          ...DEFAULT_TEXT_PRESENTATION,
          ...message,
          position: {
            ...DEFAULT_TEXT_PRESENTATION.position,
            ...(message.position || {}),
          },
        }
      : DEFAULT_TEXT_PRESENTATION;

  const lowerThirdOutput = isLowerThirdOutput || safeMessage.outputRole === "lower-third";
  if (lowerThirdOutput) {
    safeMessage.look = SCRIPTURE_LOOK_LOWER_THIRD;
    safeMessage.backgroundImage = "";
    safeMessage.backgroundVideo = "";
    safeMessage.backgroundPath = "";
  }

  const activeSegment =
    Array.isArray(safeMessage.lowerThirdSegments) &&
    safeMessage.look === SCRIPTURE_LOOK_LOWER_THIRD
      ? safeMessage.lowerThirdSegments[
          Number.isFinite(safeMessage.lowerThirdSegmentIndex)
            ? Math.max(0, Math.trunc(safeMessage.lowerThirdSegmentIndex))
            : 0
        ]
      : null;
  const bodyText =
    (typeof activeSegment?.text === "string" ? activeSegment.text : "") ||
    (typeof activeSegment === "string" ? activeSegment : "") ||
    safeMessage.bodyText ||
    safeMessage.text ||
    "";
  const referenceText = safeMessage.referenceText || "";
  const attributionText = safeMessage.attributionText || "";
  const signature = textPresentationSignature(
    safeMessage,
    bodyText,
    referenceText,
    attributionText,
  );
  const look = lowerThirdOutput
    ? SCRIPTURE_LOOK_LOWER_THIRD
    : normalizeScriptureLook(safeMessage.look);
  if (signature === textPresentationState.signature) {
    if (normalizeScriptureLook(safeMessage.look) === SCRIPTURE_LOOK_LOWER_THIRD) {
      const backgroundVideo = document.getElementById("textBackgroundVideo");
      if (backgroundVideo) resetTextBackgroundVideo(backgroundVideo);
    } else {
      applyTextBackgroundVideoState(safeMessage, textCanvas);
    }
    textPresentationState.lastMessage = { ...safeMessage, look };
    refitCurrentTextPresentation();
    return;
  }
  textPresentationState.signature = signature;
  const shell = ensureScriptureTextShell(textContent);
  textContent.classList.toggle("scripture-render--fullscreen", look === SCRIPTURE_LOOK_FULLSCREEN);
  textContent.classList.toggle("scripture-render--lower-third", look === SCRIPTURE_LOOK_LOWER_THIRD);
  textContent.dataset.scriptureLook = look;
  applyScriptureRenderVariables(textContent, safeMessage);
  if (shell.body) shell.body.textContent = bodyText;
  if (shell.reference) {
    shell.reference.textContent = referenceText;
    shell.reference.hidden = !referenceText;
  }
  if (shell.attribution) {
    shell.attribution.textContent = attributionText;
    shell.attribution.hidden = !attributionText;
  }
  textPresentationState.lastMessage = { ...safeMessage, look };
  refitCurrentTextPresentation();

  textCanvas.style.alignItems = safeMessage.position.vertical;
  textCanvas.style.justifyContent = safeMessage.position.horizontal;
  textCanvas.style.backgroundColor =
    lowerThirdOutput
      ? safeMessage.chromaKeyColor || "#00ff00"
      : look === SCRIPTURE_LOOK_LOWER_THIRD
      ? "transparent"
      : safeMessage.backgroundColor;
  textCanvas.style.backgroundRepeat = "no-repeat";

  if (!lowerThirdOutput && look !== SCRIPTURE_LOOK_LOWER_THIRD && safeMessage.backgroundImage) {
    textCanvas.style.backgroundImage = `url('${safeMessage.backgroundImage}')`;
    textCanvas.style.backgroundSize = "cover";
    textCanvas.style.backgroundPosition = "center";
  } else {
    textCanvas.style.backgroundImage = "";
    textCanvas.style.backgroundSize = "";
    textCanvas.style.backgroundPosition = "";
  }

  if (lowerThirdOutput || look === SCRIPTURE_LOOK_LOWER_THIRD) {
    const backgroundVideo = document.getElementById("textBackgroundVideo");
    if (backgroundVideo) resetTextBackgroundVideo(backgroundVideo);
  } else {
    applyTextBackgroundVideoState(safeMessage, textCanvas);
  }
}

function installTextHandlers() {
  if (textIpcHandlersInstalled) return;
  textIpcHandlersInstalled = true;
  ipcRenderer.on("update-text", (evt, message) => {
    applyTextMessage(message);
  });
  window.addEventListener("resize", scheduleTextPresentationRefit);
}

async function loadMedia() {
  // Reuse the module-level stream handles so slipstream transitions can later
  // tear these players down when switching to a different media type.
  teardownStreamingPlayers();
  hideStreamStatus();

  const textCanvas = document.getElementById("textCanvas");

  if (isText) {
    installICPHandlers();
    const videoEl = document.querySelector("video");
    if (videoEl) videoEl.style.display = "none";
    if (textCanvas) textCanvas.style.display = "flex";
    installTextHandlers();
    return;
  }

  if (textCanvas) textCanvas.style.display = "none";
  const pptxCanvas = document.getElementById("pptxCanvas");
  if (pptxCanvas) pptxCanvas.style.display = "none";

  if (isImg) {
    // Slipstream still needs to work when the first queue item is an image
    // (e.g. image -> video). Install the IPC listeners before the early return
    // so the "slipstream" message can swap us into a video later.
    installICPHandlers();
    img = document.createElement("img");
    img.src = mediaFile;
    img.setAttribute("id", "bigPlayer");
    document.body.appendChild(img);
    document.querySelector("video").style.display = "none";
    return;
  }

  if (isPptx) {
    installICPHandlers();
    installPptxIpcHandlers();
    if (!globalThis.process) {
      globalThis.process = { env: {} };
    } else if (!globalThis.process.env) {
      globalThis.process.env = {};
    }
    document.querySelector("video").style.display = "none";
    try {
      video.pause();
    } catch {}
    video.removeAttribute("src");
    video.load();
    if (pptxCanvas) pptxCanvas.style.display = "flex";
    const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import(
      "../../node_modules/@aiden0z/pptx-renderer/dist/aiden0z-pptx-renderer.es.js"
    );
    const arrayBuffer = await ipcRenderer.invoke(
      "read-file-as-arraybuffer",
      mediaFile
    );
    window._pptxMediaViewer = await PptxViewer.open(arrayBuffer, pptxCanvas, {
      zipLimits: RECOMMENDED_ZIP_LIMITS,
      fitMode: "contain",
      renderMode: "slide",
      // Single-slide mode is already cheap; list renders use windowed mounting.
      listOptions: getPptxListRenderOptions(),
    });
    await applyPptxContainPolicyMedia();
    await showPptxSlideInMediaWindow(pptxStartSlide);
    if (!window._pptxResizeBound) {
      window._pptxResizeBound = true;
      window.addEventListener("resize", () => {
        void applyPptxContainPolicyMedia();
        void showPptxSlideInMediaWindow(pptxCurrentSlide);
      });
    }
    return;
  }

  installICPHandlers();

  video.volume = strtvl;
  // `loop` is a boolean HTML attribute — its mere presence enables looping,
  // so setAttribute("loop", false) would still loop. Use the IDL property.
  setLoopEnabled(loopFile);
  video.preload = "auto";

  ipcRenderer
    .invoke("get-platform")
    .then(async (operatingSystem) => {
      await attachCubicWaveShaper(video, undefined, undefined, operatingSystem);
    })
    .catch((error) => {
      console.error("Failed to get platform, skipping audio setup:", error);
    });

  // Live streams (HLS / DASH / progressive / YouTube) share the same setup as
  // slipstream transitions so the two code paths cannot drift apart.
  if (liveStreamMode) {
    await startLiveStreamPlayback(mediaFile);
    return;
  }

  video.src = mediaFile;

  let ts = await ipcRenderer.invoke("get-system-time");
  if (strtTm != 0) {
    let t = seekOnly
      ? strtTm
      : strtTm +
        (ts.systemTime - birth) +
        (Date.now() - ts.ipcTimestamp) * 0.001;
    try {
      await applyVideoStartTime(video, t);
    } catch {}
  }

  installVideoPlaybackWiring();

  if (autoPlay) {
    video.play().catch(() => {});
  }
}

async function bootstrapMediaWindow() {
  await waitForDomReady();
  video = window.api?.video ?? document.getElementById("bigPlayer");
  if (!video) {
    throw new Error("Projection media element #bigPlayer was not found.");
  }
  video.addEventListener("error", () => {
    const err = video.error;
    const code = err?.code ? ` code ${err.code}` : "";
    const detail = err?.message || "unknown media element error";
    reportProjectionError("Projection media playback failed", `${detail}${code}`);
  });
  await loadMedia();
}

bootstrapMediaWindow().catch((error) => {
  reportProjectionError("Failed to load projection media", error);
});
