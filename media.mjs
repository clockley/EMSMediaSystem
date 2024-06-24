const { ipcRenderer, argv } = window.electron;
import hls from './node_modules/hls.js/dist/hls.mjs';

var video = null;
var img = null;
var mediaFile;
var loopFile = false;
var strtvl = 1;
var strtTm = 0;
var liveStreamMode = false;
var prom = null;
for (const arg of argv) {
    if (arg.startsWith('--mediafile-ems=')) {
        mediaFile = arg.substring(16);
    } else if (arg === '--media-loop=true') {
        loopFile = true;
    } else if (arg.startsWith('--start-vol=')) {
        strtvl = parseFloat(arg.substring(12));
    } else if (arg.startsWith('--start-time=')) {
        strtTm = parseFloat(arg.substring(13));
    } else if (arg === '--live-stream=true') {
        liveStreamMode = true;
    }
}

mediaFile=decodeURIComponent(mediaFile);

async function installICPHandlers() {
    if (!liveStreamMode) {
        ipcRenderer.on('timeGoto-message', function (evt, message) {
            const localTs = performance.now();
            const now = Date.now();
            const travelTime = now - message.timestamp;

            const adjustedTime = message.currentTime + (travelTime * .001);
            requestAnimationFrame(() => {
                video.currentTime = adjustedTime + ((performance.now() - localTs)*.001);
            });
        });
    }

    ipcRenderer.on('play-ctl', async function (event, cmd) {
        if (cmd == "pause") {
            video.pause();
        } else if (cmd == "play") {
            await video.play();
        }
    });

    ipcRenderer.on('vlcl', function (evt, message) {
        video.volume = message;
    });
}

function getFileExt(fname) {
    return (fname.slice((fname.lastIndexOf(".") - 1 >>> 0) + 2)).toLowerCase();
}

function sendRemainingTime(video) {
    let lastTime = 0;  // Last time the message was sent
    const interval = 1000 / 30;  // Set the interval for 30 updates per second

    const send = () => {
        const currentTime = performance.now();
        // Update only if at least 33.33 milliseconds have passed
        if (currentTime - lastTime > interval && !video.paused) {
            ipcRenderer.send('timeRemaining-message', [video.duration, video.currentTime, Date.now()+(currentTime - performance.now())]);
            lastTime = currentTime;
        }
        requestAnimationFrame(send);
    };
    requestAnimationFrame(send);
}

function pauseMediaSessionHandler() {
    ipcRenderer.send('mediasession-pause');;
    video.pause()
}

function playMediaSessionHandler() {
    ipcRenderer.send('mediasession-play');
    video.play()
}

async function loadMedia() {
    navigator.mediaSession.setActionHandler('play', playMediaSessionHandler);
    navigator.mediaSession.setActionHandler('pause', pauseMediaSessionHandler);
    var h = null;
    var isImg = false;

    switch (getFileExt(mediaFile)) {
        case "bmp":
        case "gif":
        case "jpg":
        case "jpeg":
        case "png":
        case "webp":
            isImg = true;
            break;
        default:
            isImg = false;
    }

    if (isImg) {
        img = document.createElement('img');
        img.src=mediaFile;
        img.setAttribute("id", "bigPlayer");
        document.body.appendChild(img);
        document.querySelector('video').style.display='none';
        return;
    } else {
        prom = installICPHandlers();
        video = document.getElementById("bigPlayer");
    }
    video.volume=strtvl;
    video.setAttribute("src", mediaFile);

    if (liveStreamMode) {
        if (mediaFile.includes("youtu")) {
            const response = await fetch(mediaFile);
            const body = await response.text();
            const regex = /"hlsManifestUrl":"([^"]+)"/;
            const match = body.match(regex);
            if (match && match[1]) {
                mediaFile = decodeURIComponent(match[1]);
                video.src = mediaFile;
            } else {
                throw new Error('M3U8 URL not found');
            }
        }

        mediaFile=video.src;
        h = new hls();
        h.loadSource(mediaFile);
    } else {
        video.currentTime = strtTm;
        video.addEventListener('play', () => {
            const playbackState = {
              currentTime: video.currentTime,
              playing: !video.paused,
            };
            ipcRenderer.send('playback-state-change', playbackState);
            if (strtvl != null) {
                video.volume = strtvl;
                strtvl = null;
            }
        });

        video.addEventListener('pause', () => {
            const playbackState = {
              currentTime: video.currentTime,
              playing: !video.paused,
            };
            ipcRenderer.send('playback-state-change', playbackState);
        }
        );
    }

    await prom;

    if (loopFile) {
        video.setAttribute("loop", true);
    }
    video.addEventListener("ended", function () {
        close();
    });

    if (liveStreamMode) {
        h.attachMedia(video);
    }

    if (!liveStreamMode) {
        sendRemainingTime(video);
        video.addEventListener('pause', (event) => {
            if (video.duration-video.currentTime < 0.1) {
                video.currentTime = video.duration;
            }
        })
    }
}

if (document.readyState == 'interactive') {
    loadMedia();
} else {
    document.addEventListener('DOMContentLoaded', function () {
        loadMedia();
    });
}