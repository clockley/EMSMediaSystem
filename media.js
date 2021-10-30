const electron = require("electron");
const { ipcRenderer } = require('electron');

var video = document.createElement('video');
var mediaFile = electron.remote.getCurrentWindow().webContents.browserWindowOptions.mediaFile;
var cntDnInt = null;

ipcRenderer.on('timeGoto-message', function (evt, message) {
    video.currentTime=video.duration*message;
    console.log(message)
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

function loadMedia() {
    video.setAttribute("id", "bigPlayer");
    video.src = mediaFile;
    video.setAttribute("controls", "controls");
    video.addEventListener("ended", function () {
        electron.remote.getCurrentWindow().close();
    });
    document.body.appendChild(video);
    checkElement('bigPlayer');
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