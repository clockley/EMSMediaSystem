const performanceStart = performance.now();
const epochStart = Date.now();

const { ipcRenderer } = require('electron');
var video = null;
var img = null;
var mediaFile;
var loopFile = false;
var strtvl = 1;
var strtTm = 0;

for (let i = 0; i < window.process.argv.length; ++i) {
    let parts = window.process.argv[i].split('=');
    let key = parts[0];
    let value = parts[1] || ''; // Handles cases where there might not be a value

    switch (key) {
        case '--mediafile-ems':
            mediaFile = value;
            break;
        case '--media-loop':
            loopFile = value === 'true';
            break;
        case '--start-vol':
            strtvl = value;
            break;
        case '--start-time':
            strtTm = value;
            break;
    }
}

mediaFile=decodeURIComponent(mediaFile);
var liveStreamMode = mediaFile.includes("m3u8") || mediaFile.includes("mpd") || mediaFile.includes("youtube.com") || mediaFile.includes("videoplayback") || mediaFile.includes("youtu.be");

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

ipcRenderer.on('pauseCtl', function (evt, message) {
    if (video.paused) {
        video.play();
    } else if (!video.paused) {
        video.pause();
    }
});

ipcRenderer.on('playCtl', function (evt, message) {
    if (!liveStreamMode)
        if (video.paused) {
            video.play();
        }
});

ipcRenderer.on('vlcl', function (evt, message) {
    video.volume = message;
});

function getFileExt(fname) {
    return fname.slice((fname.lastIndexOf(".") - 1 >>> 0) + 2);
}

function getHighPrecisionTimestamp() {
    const currentPerformance = performance.now();
    const elapsed = currentPerformance - performanceStart;
    const highPrecisionTimestamp = epochStart + elapsed;
    const timestampInSeconds = highPrecisionTimestamp * 0.001;

    return timestampInSeconds;
}

function sendRemainingTime(video) {
    let lastTime = 0;  // Last time the message was sent
    const interval = 1000 / 30;  // Set the interval for 30 updates per second

    const send = () => {
        const currentTime = performance.now();
        // Update only if at least 33.33 milliseconds have passed
        if (currentTime - lastTime > interval) {
            ipcRenderer.send('timeRemaining-message', [video.duration, video.currentTime, getHighPrecisionTimestamp()+(currentTime - performance.now())]);
            lastTime = currentTime;
        }
        requestAnimationFrame(send);
    };
    requestAnimationFrame(send);
}

async function loadMedia() {
    var h = null;
    var isImg = false;

    switch (getFileExt(mediaFile.toLowerCase())) {
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
        video = document.getElementById("bigPlayer");
    }

    video.setAttribute("src", mediaFile);

    if (liveStreamMode) {
        const youtubedl = require('youtube-dl-exec')
        try {
            await youtubedl(mediaFile, {getUrl: true, addHeader: ['referer:youtube.com','user-agent:googlebot']}).then(r => {video.src=r})
        } catch (error) {
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
        }

        mediaFile=video.src;
        const hls = require("hls.js");
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

document.addEventListener('DOMContentLoaded', function () {
    loadMedia();
}
);