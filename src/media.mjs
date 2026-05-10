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
  video.setAttribute("loop", loopFile);

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
        const { default: Hls } = await import(
          "../../node_modules/hls.js/dist/hls.mjs",
        );
        h = new Hls();
        h.loadSource(ytResolved.url);
      } else if (ytResolved.type === "progressive") {
        video.src = ytResolved.url;
      } else if (ytResolved.type === "dash") {
        const { MediaPlayer } = await import("dashjs");
        const player = MediaPlayer().create();
        const blobUrl = URL.createObjectURL(
          new Blob([ytResolved.manifest], { type: "application/dash+xml" }),
        );
        player.initialize(video, blobUrl, false);
      }
    } else {
      video.src = mediaFile;
      const { default: Hls } = await import(
        "../../node_modules/hls.js/dist/hls.mjs",
      );
      h = new Hls();
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
      h.attachMedia(video);
    }
    video.play().catch(() => {});
  }
}

loadMedia();
