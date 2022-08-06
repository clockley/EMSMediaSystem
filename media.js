const electron = require('@electron/remote');
const { ipcRenderer } = require('electron');
const hls = require("hls.js");

var video = document.createElement('video');
var mediaFile = window.process.argv.slice(-1)[0];
var liveStreamMode = (mediaFile[0].includes("m3u8") || mediaFile[0].includes("mpd") || mediaFile[0].includes("videoplayback")) == true ? true : false;
var cntDnInt = null;
var endTime = window.process.argv.slice(-2)[0];

ipcRenderer.on('timeGoto-message', function (evt, message) {
    video.currentTime=video.duration*message;
});

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

function sendRemainingTime(video) {
    cntDnInt = setInterval(function() { 
        ipcRenderer.send('timeRemaining-message', [video.duration, video.currentTime])
    }, 10);
}
var xxx = 0;
function loadMedia() {
    var h = new hls();
    video.setAttribute("id", "bigPlayer");
    video.src = mediaFile;
    if (mediaFile.includes("m3u8") || mediaFile.includes("mpd")) {
        h.loadSource(mediaFile);
    }
    video.setAttribute("controls", "controls");
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
                ipcRenderer.send('timeRemaining-message', [video.duration, video.currentTime])
            }, 10);
        })

        video.addEventListener('seeked', (event) => {
            cntDnInt = setInterval(function(){ 
                ipcRenderer.send('timeRemaining-message', [video.duration, video.currentTime])
            }, 10);
        })

        video.addEventListener('seeking', (event) => {
            clearInterval(cntDnInt);
            ipcRenderer.send('timeRemaining-message', [video.duration, video.currentTime]);
        })
        video.addEventListener('loadeddata', (event) => {
            if (endTime != 0) {
                clearInterval(cntDnInt);
                if (endTime != 0||endTime != null) {
                    var endTme = new Date();
                    endTme.setHours(window.process.argv.slice(-2)[0].split(":")[0]);
                    endTme.setMinutes(window.process.argv.slice(-2)[0].split(":")[1]);
                    var curTime=new Date();
                    video.currentTime = ((video.duration-6)-(Math.abs((curTime)-endTme)/1000));
                }
            }
        })
    }
    video.controls = false;
    video.load();
    video.play();
}

function installEvents() {
    document.addEventListener("keydown", event => {
        switch (event.key) {
            case "Escape":
                if (electron.remote.getCurrentWindow().isFullScreen()) {
                    electron.remote.getCurrentWindow().setFullScreen(false);
                }
                break;
        }
    });
}
document.addEventListener('DOMContentLoaded', function () {
    installEvents();
    loadMedia();
}
);