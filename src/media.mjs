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

const { ipcRenderer, argv, birth, FadeOut, attachCubicWaveShaper } =
  window.electron;
const { video } = window.api;
var img = null;
var mediaFile;
var loopFile = false;
var strtvl = 1;
var strtTm = 0;
var isText = false;
var liveStreamMode = false;
var isImg = false;
var autoPlay = false;
var seekOnly = false;
/** Live edge: true HLS-style live (no sync/duration UI); false for YouTube VOD in stream mode. */
var streamActsAsLiveEdge = false;
let i = argv.length - 1;

do {
  if (argv[i].startsWith("__mediaf")) {
    mediaFile = decodeURIComponent(argv[i].substring(16));
  } else if (argv[i] === "__isImg") {
    isImg = true;
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
  }
  --i;
} while (argv[i][0] !== "-");

/**
 * hls.js tuning for network streams (YouTube live HLS, generic m3u8) in the
 * projection window. Goal: maximum video quality on a presentation display.
 * We hold a large forward buffer, prefetch the next fragment early, stay
 * farther from the live edge for stability, and bias adaptive bitrate (ABR)
 * toward the highest available variant.
 */
const HLS_AGGRESSIVE_BUFFER_CONFIG = {
  maxBufferLength: 75,
  maxMaxBufferLength: 600,
  maxBufferSize: 120 * 1000 * 1000,
  startFragPrefetch: true,
  highBufferWatchdogPeriod: 1,
  /** Live only: more segments behind the live edge = fewer edge-of-playlist stalls */
  liveSyncDurationCount: 6,
  /** Prefer filling the standard buffer over LL-HLS “stay on the edge” behaviour */
  lowLatencyMode: false,
  /** Quality: never cap quality to player render size — projection is fullscreen. */
  capLevelToPlayerSize: false,
  /** Quality: skip the low-bitrate probe; we have plenty of bandwidth for live. */
  testBandwidth: false,
  /** Quality: assume 25 Mbps available so ABR starts near the top variant. */
  abrEwmaDefaultEstimate: 25_000_000,
  /** Quality: pick the highest quality level immediately rather than starting low. */
  startLevel: -1,
};

async function createStreamingHls() {
  const { default: Hls } = await import(
    "../../node_modules/hls.js/dist/hls.mjs",
  );
  return new Hls(HLS_AGGRESSIVE_BUFFER_CONFIG);
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

function installICPHandlers() {
  if (!streamActsAsLiveEdge) {
    ipcRenderer.on("timeGoto-message", function (evt, message) {
      const localTs = performance.now();
      const now = Date.now();
      const travelTime = now - message.timestamp;

      const adjustedTime = message.currentTime + travelTime * 0.001;
      requestAnimationFrame(() => {
        video.currentTime =
          adjustedTime + (performance.now() - localTs) * 0.001;
      });
    });
  }

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

function installTextHandlers() {
  ipcRenderer.on("update-text", (evt, message) => {
    const textCanvas = document.getElementById("textCanvas");
    const textContent = document.getElementById("textContent");

    textContent.textContent = message.text;

    if (message.color) {
      textContent.style.color = message.color;
    }

    if (message.fontSize) {
      textContent.style.fontSize = `${message.fontSize}px`;
    }

    if (message.position) {
      textCanvas.style.alignItems = message.position.vertical || "center";
      textCanvas.style.justifyContent = message.position.horizontal || "center";
    }

    if (message.backgroundColor) {
      textContent.style.backgroundColor = message.backgroundColor;
    }

    if (message.backgroundImage) {
      textCanvas.style.backgroundImage = `url('${message.backgroundImage}')`;
      textCanvas.style.backgroundSize = "cover";
      textCanvas.style.backgroundPosition = "center";
    }
  });
}

async function loadMedia() {
  let h = null;
  let dashPlayer = null;

  if (isText) {
    document.querySelector("video").style.display = "none";
    textCanvas.style.display = "flex";
    installTextHandlers();
    return;
  }

  textCanvas.style.display = "none";

  if (isImg) {
    img = document.createElement("img");
    img.src = mediaFile;
    img.setAttribute("id", "bigPlayer");
    document.body.appendChild(img);
    document.querySelector("video").style.display = "none";
    return;
  }

  let ytResolved = null;
  streamActsAsLiveEdge = liveStreamMode && !matchYouTubeUrl(mediaFile);
  if (liveStreamMode && matchYouTubeUrl(mediaFile)) {
    ytResolved = await ipcRenderer.invoke("resolve-youtube-stream", mediaFile);
    streamActsAsLiveEdge = ytResolved.type === "hls";
  }

  installICPHandlers();

  video.volume = strtvl;
  // `loop` is a boolean HTML attribute — its mere presence enables looping,
  // so setAttribute("loop", false) would still loop. Use the IDL property.
  video.loop = !!loopFile;
  video.preload = "auto";

  ipcRenderer
    .invoke("get-platform")
    .then((operatingSystem) => {
      attachCubicWaveShaper(video, undefined, undefined, operatingSystem);
    })
    .catch((error) => {
      console.error("Failed to get platform, skipping audio setup:", error);
    });

  if (liveStreamMode) {
    if (ytResolved) {
      if (ytResolved.type === "hls") {
        video.src = ytResolved.url;
        h = await createStreamingHls();
        h.loadSource(ytResolved.url);
      } else if (ytResolved.type === "progressive") {
        video.src = ytResolved.url;
      } else if (ytResolved.type === "dash") {
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
      video.src = mediaFile;
      h = await createStreamingHls();
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
      if (Number.isFinite(video.duration) && video.duration > 0) {
        t = Math.min(t, Math.max(0, video.duration - 0.15));
      }
      if (t < 0) t = 0;
      video.currentTime = t;
    }

    video.addEventListener("play", playbackStateUpdate);
    video.addEventListener("pause", playbackStateUpdate);
  }

  if (!liveStreamMode && autoPlay) {
    video.play().catch(() => {});
  }

  video.onended = () => {
    if (loopFile) return;
    ipcRenderer.send("media-playback-ended");
    window.close();
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
          // Pin the projection player to the highest video variant once we
          // know the manifest. ABR can still react to sustained stalls, but
          // we start at top quality instead of climbing up from the bottom.
          const levels = h.levels;
          if (Array.isArray(levels) && levels.length > 0) {
            const topIndex = levels.reduce(
              (best, lvl, i) =>
                (lvl?.bitrate ?? 0) > (levels[best]?.bitrate ?? 0) ? i : best,
              0,
            );
            try {
              h.startLevel = topIndex;
              h.nextLevel = topIndex;
            } catch {
              /* hls.js setter may throw if levels race; safe to ignore. */
            }
          }
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
    video.play().catch(() => {});
  }
}

loadMedia();
