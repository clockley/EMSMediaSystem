const electron = require("electron");
var mediaFile = electron.remote.getCurrentWindow().webContents.browserWindowOptions.mediaFile;

function loadMedia() {
    var video = document.createElement('video');
    video.setAttribute("id", "bigPlayer");
    video.src = mediaFile;
    video.setAttribute("controls", "controls");
    video.addEventListener("ended", function () {
        electron.remote.getCurrentWindow().close();
    });
    document.body.appendChild(video);
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