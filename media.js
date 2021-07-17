const electron = require("electron");
const { ipcRenderer } = require('electron')

var mediaFile = electron.remote.getCurrentWindow().webContents.browserWindowOptions.mediaFile;

var toHHMMSS = (secs) => {
    var sec_num = parseInt(secs, 10)
    var hours   = Math.floor(sec_num / 3600)
    var minutes = Math.floor(sec_num / 60) % 60
    var seconds = sec_num % 60

    return [hours,minutes,seconds]
        .map(v => v < 10 ? "0" + v : v)
        .filter((v,i) => v !== "00" || i > 0)
        .join(":")
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

function sendRemainingTime(video) {
    setInterval(function(){ 
        ipcRenderer.send('timeRemaining-message', toHHMMSS(video.duration - video.currentTime))
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