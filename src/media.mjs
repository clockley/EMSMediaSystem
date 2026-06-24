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

function installLiveStreamStatusHandlers(mediaEl, hls = null) {
  if (!liveStreamMode || !mediaEl) return;
  const showBuffering = () => {
    if (
      !mediaEl.error &&
      mediaEl.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
    ) {
      showStreamLoading("Buffering live stream");
    }
  };
  const hideReady = () => hideStreamStatus();

  mediaEl.addEventListener("loadstart", () => showStreamLoading(), {
    once: true,
  });
  mediaEl.addEventListener("waiting", showBuffering);
  mediaEl.addEventListener("stalled", showBuffering);
  mediaEl.addEventListener("canplay", hideReady);
  mediaEl.addEventListener("playing", hideReady);

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

async function applySlipstream(data) {
  hideStreamStatus();
  const newIsText = !!data.isText;
  mediaFile = data.mediaFile ?? mediaFile;
  setLoopEnabled(!!data.loopFile);
  isImg = !!data.isImg;
  const newIsPptx = !!data.isPptx;

  if (newIsText) {
    isText = true;
    isPptx = false;
    streamActsAsLiveEdge = false;
    liveStreamMode = false;
    installTextHandlers();
    const pptxCanvas = document.getElementById("pptxCanvas");
    if (pptxCanvas) pptxCanvas.style.display = "none";
    if (window._pptxMediaViewer) {
      try {
        window._pptxMediaViewer.destroy();
      } catch {}
      window._pptxMediaViewer = null;
    }
    document.querySelector("video").style.display = "none";
    try {
      video.pause();
    } catch {}
    video.removeAttribute("src");
    video.load();
    if (img) img.style.display = "none";
    const textCanvas = document.getElementById("textCanvas");
    textCanvas.style.display = "flex";
    if (data.textPayload) {
      applyTextMessage(data.textPayload);
    }
    return;
  }

  if (isText && !newIsText) {
    isText = false;
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

  if (newIsPptx) {
    isPptx = true;
    streamActsAsLiveEdge = false;
    liveStreamMode = false;
    installPptxIpcHandlers();
    if (!globalThis.process) {
      globalThis.process = { env: {} };
    } else if (!globalThis.process.env) {
      globalThis.process.env = {};
    }
    const pptxCanvas = document.getElementById("pptxCanvas");
    try {
      video.pause();
    } catch {}
    video.removeAttribute("src");
    video.load();
    pptxCanvas.style.display = "flex";
    document.querySelector("video").style.display = "none";
    if (img) img.style.display = "none";
    if (window._pptxMediaViewer) {
      try {
        window._pptxMediaViewer.destroy();
      } catch {}
      window._pptxMediaViewer = null;
    }
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
    return;
  }

  if (isPptx && !newIsPptx) {
    isPptx = false;
    const pptxCanvas = document.getElementById("pptxCanvas");
    if (pptxCanvas) pptxCanvas.style.display = "none";
    if (window._pptxMediaViewer) {
      try {
        window._pptxMediaViewer.destroy();
      } catch {}
      window._pptxMediaViewer = null;
    }
  }

  if (isImg) {
    streamActsAsLiveEdge = false;
    liveStreamMode = false;
    try {
      video.pause();
    } catch {
      /* element may already be paused-at-end */
    }
    video.removeAttribute("src");
    video.load();
    document.querySelector("video").style.display = "none";

    if (!img) {
      img = document.createElement("img");
      img.setAttribute("id", "bigPlayer");
      document.body.appendChild(img);
    }
    img.src = mediaFile;
    img.style.display = "block";
    return;
  }

  if (img) {
    img.style.display = "none";
  }

  const videoEl = document.querySelector("video");
  streamActsAsLiveEdge = false;
  liveStreamMode = false;
  setLoopEnabled(loopFile);
  if (data.startVolume != null) {
    video.volume = data.startVolume;
  }
  // Per HTML5 spec, assigning to .src aborts the current load and resets the
  // media element. Don't call removeAttribute("src") + load() here — that
  // briefly puts the element in NETWORK_EMPTY and races the new src assignment.
  video.src = mediaFile;
  videoEl.style.display = "block";
  if (Number.isFinite(data.startTime) && data.startTime > 0) {
    try {
      await applyVideoStartTime(video, data.startTime);
    } catch {}
  }
  await video.play().catch(() => {});
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
    // Update only if at least 33.33 milliseconds have passed
    if (currentTime - lastTime > interval && !video.paused) {
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
  let h = null;
  let dashPlayer = null;
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

  let ytResolved = null;
  streamActsAsLiveEdge = liveStreamMode && !matchYouTubeUrl(mediaFile);
  if (liveStreamMode && matchYouTubeUrl(mediaFile)) {
    showStreamLoading("Resolving YouTube stream");
    ytResolved = await ipcRenderer.invoke("resolve-youtube-stream", mediaFile);
    streamActsAsLiveEdge = ytResolved.type === "hls";
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

  if (liveStreamMode) {
    showStreamLoading("Connecting to live stream");
    if (ytResolved) {
      if (ytResolved.type === "hls") {
        h = await createStreamingHls();
        installLiveStreamStatusHandlers(video, h);
        h.loadSource(ytResolved.url);
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
        const blobUrl = URL.createObjectURL(
          new Blob([ytResolved.manifest], { type: "application/dash+xml" }),
        );
        dashPlayer.initialize(video, blobUrl, false);
      }
    } else {
      h = await createStreamingHls();
      installLiveStreamStatusHandlers(video, h);
      h.loadSource(mediaFile);
    }
  } else {
    video.src = mediaFile;
  }

  if (!streamActsAsLiveEdge) {
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

    video.addEventListener("play", playbackStateUpdate);
    video.addEventListener("pause", playbackStateUpdate);
  }

  if (!liveStreamMode && autoPlay) {
    video.play().catch(() => {});
  }

  video.onended = () => {
    if (loopFile || video.loop) return;
    video.style.display = "none";
    ipcRenderer.send("media-playback-ended", mediaFile);
  };

  if (!streamActsAsLiveEdge) {
    sendRemainingTime(video);
    video.addEventListener("pause", (event) => {
      if (video.duration - video.currentTime < 0.1) {
        video.currentTime = video.duration;
      }
    });
  }

  if (liveStreamMode) {
    if (h) {
      const hlsEvents = h.constructor?.Events;
      if (hlsEvents?.MANIFEST_PARSED) {
        h.on(hlsEvents.MANIFEST_PARSED, () => {
          selectPreferredHlsAudioTrack(h);
        });
      }
      if (hlsEvents?.AUDIO_TRACKS_UPDATED) {
        h.on(hlsEvents.AUDIO_TRACKS_UPDATED, () => selectPreferredHlsAudioTrack(h));
      }
      h.attachMedia(video);
    }
    video.addEventListener("loadedmetadata", () => {
      selectPreferredNativeAudioTrack(video);
    });
    video
      .play()
      .catch((error) =>
        reportProjectionError("Live stream playback did not start", error),
      );
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
