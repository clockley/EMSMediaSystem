const { ipcRenderer } = require('electron');
var video = document.createElement('video');
var img = document.createElement('img');
var mediaFile;
var cntDnInt = null;
var endTime;
var loopFile = false;

for (var i = 0; i < window.process.argv.length; ++i) {
    if (window.process.argv[i].includes('--endtime-ems=')) {
        endTime=window.process.argv[i].split('=')[1]
    }
    if (window.process.argv[i].includes('--mediafile-ems=')) {
        mediaFile=window.process.argv[i].split('=')[1]
    }
    if (window.process.argv[i].includes('--media-loop=true')) {
        loopFile=true;
    }
}
mediaFile=decodeURIComponent(mediaFile);
console.log(mediaFile)
var liveStreamMode = (mediaFile.includes("m3u8") || mediaFile.includes("mpd") || mediaFile.includes("youtube.com") || mediaFile.includes("videoplayback")) == true ? true : false;

ipcRenderer.on('timeGoto-message', function (evt, message) {
    video.currentTime=message;
});

ipcRenderer.on('pauseCtl', function (evt, message) {
    if (video.paused) {
        video.play();
    } else if (!video.paused) {
        video.pause();
    }
});

ipcRenderer.on('playCtl', function (evt, message) {
    if (video.paused) {
        video.play();
    }
});

function getFileExt(fname) {
    return fname.slice((fname.lastIndexOf(".") - 1 >>> 0) + 2);
}

function rafAsync() {
    return new Promise(resolve => {
        requestAnimationFrame(resolve); //faster than set time out
    });
}

function checkElement(selector) {
    if (document.querySelector(selector) === null) {
        return rafAsync().then(() => checkElement(selector));
    } else {
        return Promise.resolve(true);
    }
}

let lastSendTime = performance.now();  // Track last time message was sent
function sendRemainingTime(video) {
    const send = () => {
        ipcRenderer.send('timeRemaining-message', [video.duration, video.currentTime, new Date()]);
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
        img.src=mediaFile;
        img.setAttribute("id", "bigPlayer");
        document.body.appendChild(img);
        return;
    }

    video.setAttribute("id", "bigPlayer");
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
    document.body.appendChild(video);
    checkElement('bigPlayer');
    if (!liveStreamMode) {
        sendRemainingTime(video);

        video.addEventListener('pause', (event) => {
            clearInterval(cntDnInt);
        })

        video.addEventListener('play', (event) => {
            cntDnInt = setInterval(function(){ 
                ipcRenderer.send('timeRemaining-message', [video.duration, video.currentTime, new Date()])
            }, 10);
        })

        video.addEventListener('seeked', (event) => {
            cntDnInt = setInterval(function(){ 
                ipcRenderer.send('timeRemaining-message', [video.duration, video.currentTime, new Date()])
            }, 10);
        })

        video.addEventListener('seeking', (event) => {
            clearInterval(cntDnInt);
            ipcRenderer.send('timeRemaining-message', [video.duration, video.currentTime, new Date()]);
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
    video.controls = false;
    video.play();
}

document.addEventListener('DOMContentLoaded', function () {
    loadMedia();
}
);