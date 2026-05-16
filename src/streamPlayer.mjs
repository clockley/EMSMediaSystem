/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

/**
 * Loads network streams into the control window preview <video>. Uses the same
 * main-process YouTube resolver as the projection window (HLS / progressive /
 * DASH). Plain m3u8 / mpd URLs use hls.js / dash.js directly.
 */

function getRendererIpc() {
  const r = globalThis.window?.electron?.ipcRenderer;
  if (!r?.invoke) throw new Error("Preload IPC bridge not ready");
  return r;
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

const HLS_PREVIEW_CONFIG = {
  maxBufferLength: 60,
  maxMaxBufferLength: 600,
  maxBufferSize: 120 * 1000 * 1000,
  startFragPrefetch: true,
  liveSyncDurationCount: 6,
  lowLatencyMode: false,
  /** Preview is small; capping to size saves bandwidth without hurting UX. */
  capLevelToPlayerSize: true,
  /** Skip low-bitrate probe so the preview doesn't start at the worst quality. */
  testBandwidth: false,
  /** Assume 15 Mbps available to bias ABR toward higher variants from the start. */
  abrEwmaDefaultEstimate: 15_000_000,
};

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
      scheduling: { scheduleWhilePaused: true },
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

function looksLikeHlsUrl(url) {
  const lower = url.toLowerCase();
  return (
    lower.includes(".m3u8") || lower.includes("m3u8") || lower.includes("/playlist")
  );
}

function looksLikeDashUrl(url) {
  const lower = url.toLowerCase();
  return lower.includes(".mpd") || lower.includes("/manifest");
}

export async function attachStream(videoEl, url, options = {}) {
  if (!videoEl) throw new Error("videoEl is required");
  if (!url) throw new Error("url is required");

  const { autoplay = true } = options;
  const ipcRenderer = getRendererIpc();

  let hls = null;
  let dashPlayer = null;
  let blobUrl = null;
  const onLoadedMetadata = () => {
    selectPreferredNativeAudioTrack(videoEl);
  };

  const tryPlay = () => {
    const p = videoEl.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  };

  if (matchYouTubeUrl(url)) {
    const resolved = await ipcRenderer.invoke("resolve-youtube-stream", url);
    if (resolved.type === "hls") {
      const { default: Hls } = await import(
        "../../node_modules/hls.js/dist/hls.mjs",
      );
      hls = new Hls(HLS_PREVIEW_CONFIG);
      if (Hls.Events?.MANIFEST_PARSED) {
        hls.on(Hls.Events.MANIFEST_PARSED, () => selectPreferredHlsAudioTrack(hls));
      }
      if (Hls.Events?.AUDIO_TRACKS_UPDATED) {
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () =>
          selectPreferredHlsAudioTrack(hls),
        );
      }
      hls.loadSource(resolved.url);
      hls.attachMedia(videoEl);
    } else if (resolved.type === "progressive") {
      videoEl.src = resolved.url;
    } else if (resolved.type === "dash") {
      const { MediaPlayer } = await import(
        "../../node_modules/dashjs/dist/modern/esm/dash.all.min.js"
      );
      dashPlayer = MediaPlayer().create();
      configureDashAggressiveBuffer(dashPlayer);
      blobUrl = URL.createObjectURL(
        new Blob([resolved.manifest], { type: "application/dash+xml" }),
      );
      dashPlayer.initialize(videoEl, blobUrl, false);
    }
  } else if (looksLikeHlsUrl(url)) {
    const { default: Hls } = await import(
      "../../node_modules/hls.js/dist/hls.mjs",
    );
    hls = new Hls(HLS_PREVIEW_CONFIG);
    if (Hls.Events?.MANIFEST_PARSED) {
      hls.on(Hls.Events.MANIFEST_PARSED, () => selectPreferredHlsAudioTrack(hls));
    }
    if (Hls.Events?.AUDIO_TRACKS_UPDATED) {
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () =>
        selectPreferredHlsAudioTrack(hls),
      );
    }
    hls.loadSource(url);
    hls.attachMedia(videoEl);
  } else if (looksLikeDashUrl(url)) {
    const { MediaPlayer } = await import(
      "../../node_modules/dashjs/dist/modern/esm/dash.all.min.js"
    );
    dashPlayer = MediaPlayer().create();
    configureDashAggressiveBuffer(dashPlayer);
    dashPlayer.initialize(videoEl, url, false);
  } else {
    videoEl.src = url;
  }

  videoEl.addEventListener("loadedmetadata", onLoadedMetadata);

  if (autoplay) {
    if (videoEl.readyState >= 2) {
      tryPlay();
    } else {
      videoEl.addEventListener("loadedmetadata", tryPlay, { once: true });
    }
  }

  return {
    resolvedUrl: url,
    destroy() {
      if (hls) {
        try {
          hls.destroy();
        } catch {
          /* */
        }
        hls = null;
      }
      if (dashPlayer) {
        try {
          dashPlayer.reset();
        } catch {
          /* */
        }
        dashPlayer = null;
      }
      if (blobUrl) {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch {
          /* */
        }
        blobUrl = null;
      }
      try {
        videoEl.pause();
      } catch {
        /* */
      }
      videoEl.removeAttribute("src");
      try {
        videoEl.srcObject = null;
      } catch {
        /* */
      }
      try {
        videoEl.load();
      } catch {
        /* */
      }
      try {
        videoEl.removeEventListener("loadedmetadata", onLoadedMetadata);
      } catch {
        /* */
      }
    },
  };
}
