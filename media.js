const electron = require("electron");
const { ipcRenderer } = require('electron')

var mediaFile = electron.remote.getCurrentWindow().webContents.browserWindowOptions.mediaFile;

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
    setInterval(function(){ 
        ipcRenderer.send('timeRemaining-message', video.duration - video.currentTime)
    }, 500);
}

function loadMedia() {
    var video = document.createElement('video');
    video.setAttribute("id", "bigPlayer");
    video.src = mediaFile;
    video.setAttribute("controls", "controls");
    video.addEventListener("ended", function () {
        electron.remote.getCurrentWindow().close();
    });
    document.body.appendChild(video);
    checkElement('bigPlayer');
    sendRemainingTime(video);
    video.addEventListener('seeking', (event) => {
        ipcRenderer.send('timeRemaining-message', video.duration - video.currentTime);
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