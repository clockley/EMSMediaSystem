const { ipcRenderer, argv} = window.electron;
const { video } = window.api;
import hls from './node_modules/hls.js/dist/hls.mjs';
var img = null;
var mediaFile;
var loopFile = false;
var strtvl = 1;
var strtTm = 0;
var liveStreamMode = false;
var prom = null;
var isImg = false;
let i = argv.length - 1;

do {
    if (argv[i].startsWith('__mediaf')) {
        mediaFile = decodeURIComponent(argv[i].substring(16));
    } else if (argv[i] === '__isImg') {
        isImg = true;
    } else if (argv[i] === '__live-stream=true') {
        liveStreamMode = true;
    } else if (argv[i].startsWith('__start-t')) {
        strtTm = parseFloat(argv[i].substring(13));
    } else if (argv[i].startsWith('__start-v')) {
        strtvl = parseFloat(argv[i].substring(12));
    } else if (argv[i] === '__media-loop=true') {
        loopFile = true;
    }
    --i;
} while (argv[i][0] !== '-');

async function installICPHandlers() {
    if (!liveStreamMode) {
        ipcRenderer.on('timeGoto-message', function (evt, message) {
            const localTs = performance.now();
            const now = Date.now();
            const travelTime = now - message.timestamp;

            const adjustedTime = message.currentTime + (travelTime * .001);
            requestAnimationFrame(() => {
                video.currentTime = adjustedTime + ((performance.now() - localTs) * .001);
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

function sendRemainingTime(video) {
    let lastTime = 0;  // Last time the message was sent
    const interval = 1000 / 30;  // Set the interval for 30 updates per second

    const send = () => {
        const currentTime = performance.now();
        // Update only if at least 33.33 milliseconds have passed
        if (currentTime - lastTime > interval && !video.paused) {
            ipcRenderer.send('timeRemaining-message', [video.duration, video.currentTime, Date.now() + (currentTime - performance.now())]);
            lastTime = currentTime;
        }
        requestAnimationFrame(send);
    };
    requestAnimationFrame(send);
}

function pauseMediaSessionHandler() {
    ipcRenderer.send('remoteplaypause', true);
    video.pause()
}

function playMediaSessionHandler() {
    ipcRenderer.send('remoteplaypause', false);
    video.play()
}

async function loadMedia() {
    let h = null;

    if (isImg) {
        img = document.createElement('img');
        img.src = mediaFile;
        img.setAttribute("id", "bigPlayer");
        document.body.appendChild(img);
        document.querySelector('video').style.display = 'none';
        return;
    } else {
        prom = installICPHandlers();
    }
    video.volume = strtvl;
    video.src = mediaFile;
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

        mediaFile = video.src;
        h = new hls();
        h.loadSource(mediaFile);
    } else {
        navigator.mediaSession.setActionHandler('play', playMediaSessionHandler);
        navigator.mediaSession.setActionHandler('pause', pauseMediaSessionHandler);
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
        });
    }

    await prom;

    if (loopFile) {
        video.setAttribute("loop", loopFile);
    }

    video.onended = () => close();

    if (!liveStreamMode) {
        sendRemainingTime(video);
        video.addEventListener('pause', (event) => {
            if (video.duration - video.currentTime < 0.1) {
                video.currentTime = video.duration;
            }
        });
    } else {
        h.attachMedia(video);
    }
}

if (document.readyState == 'interactive') {
    loadMedia();
} else {
    document.addEventListener('DOMContentLoaded', function () {
        loadMedia();
    });
}