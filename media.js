const performanceStart = performance.now();
const epochStart = Date.now();

const { ipcRenderer } = require('electron');
var video = document.createElement('video');
var img = null;
var mediaFile;
var cntDnInt = null;
var endTime;
var loopFile = false;
var strtvl = 1;
var strtTm = 0;

window.process.argv.forEach(arg => {
    let parts = arg.split('=');
    let key = parts[0];
    let value = parts[1] || ''; // Handles cases where there might not be a value

    switch (key) {
        case '--endtime-ems':
            endTime = value;
            break;
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
});

mediaFile=decodeURIComponent(mediaFile);
var liveStreamMode = (mediaFile.includes("m3u8") || mediaFile.includes("mpd") || mediaFile.includes("youtube.com") || mediaFile.includes("videoplayback")) == true ? true : false;

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

function whenElementAdded(selector, callback) {
    const observer = new MutationObserver((mutations, obs) => {
        if (document.querySelector(selector)) {
            callback();
            obs.disconnect(); // Stop observing after the element is found and handled
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: false,
        attributes: false,
        characterData: false
    });
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
            ipcRenderer.send('timeRemaining-message', [video.duration, video.currentTime, getHighPrecisionTimestamp()]);
            lastTime = currentTime;
        }
        requestAnimationFrame(send);
    };
    requestAnimationFrame(send);
}


async function loadMedia() {
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
        return;
    }

    video.setAttribute("id", "bigPlayer");
    video.setAttribute("autoplay", true);
    video.src = mediaFile;
    if (mediaFile.includes("m3u8") || mediaFile.includes("mpd") || mediaFile.includes("youtube.com")) {
        const youtubedl = require('youtube-dl-exec')
        await youtubedl(mediaFile, {getUrl: true, addHeader: ['referer:youtube.com','user-agent:googlebot']}).then(r => {video.src=r})
        mediaFile=video.src
        const hls = require("hls.js");
        h = new hls();
        h.loadSource(mediaFile);
    } else {
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
    video.setAttribute("controls", "controls");
    if (loopFile) {
        video.setAttribute("loop", true);
    }
    video.addEventListener("ended", function () {
        close();
    });
    if (mediaFile.includes("m3u8") || mediaFile.includes("mpd") || mediaFile.includes("videoplayback")) {
        h.attachMedia(video);
    }
    video.controls = false;
    video.currentTime = strtTm;
    video.load();
    if (!liveStreamMode) {
        sendRemainingTime(video);
        video.addEventListener('pause', (event) => {
            if (video.duration-video.currentTime < 0.1) {
                video.currentTime = video.duration;
            }
            clearInterval(cntDnInt);
        })

        video.addEventListener('loadeddata', (event) => {
            if (endTime != 0) {
                clearInterval(cntDnInt);
                if (endTime != 0||endTime != null) {
                    var endTme = new Date();
                    endTme.setHours(endTime.split(":")[0]);
                    endTme.setMinutes(endTime.split(":")[1]);
                    var curTime=new Date();
                    video.currentTime = video.duration - ((curTime - endTme) / 1000);
                }
            }
        })
    }
    document.body.appendChild(video);
    whenElementAdded('#bigPlayer', () => {
        console.log('BigPlayer video element has been added to the DOM.');
    
        const playbackState = {
            currentTime: video.currentTime,
            playing: true,
          };
        ipcRenderer.send('playback-state-change', playbackState);
        video.play();
    });
}

document.addEventListener('DOMContentLoaded', function () {
    loadMedia();
}
);