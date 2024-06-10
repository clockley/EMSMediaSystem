//"use strict";
//Project Alchemy
//Copyright 2019 - 2024 Christian Lockley
const { ipcRenderer, path, __dirname } = window.electron;

var nextFile = null;
var timers = [];
var timeRemaining = "00:00:00:000";
var dontSyncRemote = false;
var pidSeeking = false;
var mediaPlayDelay = null;
var video = null;
var masterPauseState = false;
var activeLiveStream = false;
var targetTime = 0;
var startTime = 0;
var prePathname = '';
var savedCurTime = '';
var playingMediaAudioOnly = false;
var audioOnlyFile = false;
var installedVideoEventListener = false;
var mediaCntDnEle = null;
var CrVL = 1;
var opMode = -1;
var osName = '';
var localTimeStampUpdateIsRunning = false;
var dontPauseOnPipExit = false;
var mediaFile;
var currentMediaFile;
var fileEnded = false;
var dyneForm = null;
var mediaSessionPause = false;
const MEDIAPLAYER = 0;
const MEDIAPLAYERYT = 1;
const WEKLYSCHD = 2;
const SPECIALEVNTS = 3;
const ALARMS = 4;
const imageExtensions = new Set(["bmp", "gif", "jpg", "jpeg", "png", "webp"]);

let lastUpdateTime = 0;
let lastTimeDifference = 0; // Last time difference for derivative calculation
let integral = 0; // Integral sum for error accumulation
let kP = 0.005; // Proportional gain
let kI = 0.001; // Integral gain
let kD = 0.003; // Derivative gain
let synchronizationThreshold = 0.01; // Threshold to keep local video within .01 second of remote
let isActiveMediaWindowCache = false;

const padStart = (num, targetLength, padString) => {
    const numStr = num.toString();
    let paddingNeeded = targetLength - numStr.length;
    let padding = '';

    while (paddingNeeded > 0) {
        padding += padString;
        paddingNeeded--;
    }

    return padding + numStr;
}

const toHHMMSS = (secs) => {
    return `${padStart((secs / 3600) | 0, 2, '0')}:${padStart(((secs % 3600) / 60) | 0, 2, '0')}:${padStart((secs % 60) | 0, 2, '0')}:${padStart(((secs * 1000) % 1000) | 0, 3, '0')}`;
};

function isActiveMediaWindow() {
    return isActiveMediaWindowCache;
}

function updateTimestamp(oneShot) {
    if (oneShot && mediaCntDnEle) {
        mediaCntDnEle.textContent = toHHMMSS(video.duration - video.currentTime);
        return;
    }
    if (localTimeStampUpdateIsRunning) {
        return;
    }
    if (!mediaCntDnEle) {
        localTimeStampUpdateIsRunning = false;
        return;
    }
    if (playingMediaAudioOnly || !video.paused)
        localTimeStampUpdateIsRunning = true;
    let lastUpdateTimeLocalPlayer = 0;

    // Function to update the timestamp text
    const update = (time) => {
        // Update at most 30 times per second
        if (time - lastUpdateTimeLocalPlayer >= 33.33) {
            if (mediaCntDnEle && audioOnlyFile) {
                mediaCntDnEle.textContent = toHHMMSS(video.duration - video.currentTime);
            } else {
                localTimeStampUpdateIsRunning = false;
                return;
            }
            lastUpdateTimeLocalPlayer = time;
        }
        if (!video.paused) {
            requestAnimationFrame(update);
        } else {
            localTimeStampUpdateIsRunning = false;
        }
    };
    if (!video.paused) {
        requestAnimationFrame(update);
    } else {
        localTimeStampUpdateIsRunning = false;
    }
}

async function installIPCHandler() {
    ipcRenderer.on('timeRemaining-message', function (evt, message) {
        var now = Date.now();
        const sendTime = message[3];
        const ipcDelay = now - sendTime; // Compute the IPC delay

        // Measure DOM update time and add to IPC delay
        let domUpdateTimeStart = now;
        let timeStamp = message[0];
        if (opMode == MEDIAPLAYER) {
            requestAnimationFrame(() => {
                if (mediaCntDnEle != null) {
                    mediaCntDnEle.textContent = timeStamp;
                }
                timeStamp = null;
            });
        }
        let domUpdateTime = Date.now() - domUpdateTimeStart;

        let adjustedIpcDelay = ipcDelay + domUpdateTime; // Adjust IPC delay by adding DOM update time

        targetTime = message[2] - (adjustedIpcDelay * .001); // Adjust target time considering the modified IPC delay
        //const intervalReductionFactor = Math.max(0.5, Math.min(1, (message[2] - message[3]) * .1));
        //const syncInterval = 1000 * intervalReductionFactor; // Reduced sync interval to 1 second


        if (now - lastUpdateTime > .5) {
            if (opMode == MEDIAPLAYER) {
                if (!video.paused && video != null && !video.seeking) {
                    hybridSync(targetTime);
                    lastUpdateTime = now;
                    if (!audioOnlyFile && !video.paused && !activeLiveStream) {
                        dynamicPIDTuning();
                    }
                }
            }
        }
        message = null;
    });

    ipcRenderer.on('update-playback-state', async (event, playbackState) => {
        // Handle play/pause state
        if (!video) {
            return;
        }
        if (playbackState.playing && video.paused) {
            masterPauseState = false;
            if (video && !isImg(mediaFile)) {
                await video.play();
            }
        } else if (!playbackState.playing && !video.paused) {
            masterPauseState = true;
            if (video) {
                video.currentTime = playbackState.currentTime; //sync on pause
                await video.pause();
            }
        }
    });

    ipcRenderer.on('mediasession-pause', () => {
        mediaSessionPause = true;
    });

    ipcRenderer.on('mediasession-play', () => {
        mediaSessionPause = false;
    });

    ipcRenderer.on('media-window-closed', async (event, id) => {
        isActiveMediaWindowCache = false;
        saveMediaFile();
        let isImgFile = isImg(mediaFile);
        if (!isImgFile) {
            if (video.src != window.location.href) {
                waitForMetadata().then(() => { audioOnlyFile = (opMode == MEDIAPLAYER && video.videoTracks && video.videoTracks.length === 0) });
            }
            video.src = mediaFile;
        }

        let imgEle = null;
        if (imgEle = document.querySelector('img') && !isImgFile) {
            imgEle.remove();
            document.getElementById("preview").style.display = '';
            document.getElementById("cntdndiv").style.display = '';
        } else if (isImgFile) {
            if (imgEle) {
                imgEle.src = mediaFile;
            } else {
                let imgEle = null;
                if ((imgEle = document.querySelector('img')) != null) {
                    imgEle.remove();
                    document.getElementById("cntdndiv").style.display = '';
                }
                video.src = '';
                img = document.createElement('img');
                img.src = mediaFile;
                img.setAttribute("id", "preview");
                if (!document.getElementById("preview"))
                    document.getElementById("preview").style.display = 'none';
                document.getElementById("preview").parentNode.appendChild(img);
                document.getElementById("cntdndiv").style.display = 'none';
            }
        }
        if (video != null) {
            video.muted = true;
            video.pause();
            video.currentTime = 0;
            targetTime = 0;
        }
        if (document.getElementById("mediaCntDn") != null) {
            document.getElementById("mediaCntDn").innerText = "00:00:00:000";
        }
        if (document.getElementById("mediaWindowPlayButton") != null) {
            document.getElementById("mediaWindowPlayButton").innerText = "▶️";
        } else {
            document.getElementById("MdPlyrRBtnFrmID").addEventListener("click", function () {
                document.getElementById("mediaWindowPlayButton").innerText = "▶️";
            }, { once: true });
        }
        timeRemaining = "00:00:00:000"
        masterPauseState = false;
        saveMediaFile();
    });
}

function resetPIDOnSeek() {
    integral = 0; // Reset integral
    lastTimeDifference = 0; // Reset last time difference
}

function adjustPlaybackRate(targetTime) {
    const currentTime = video.currentTime;
    const timeDifference = targetTime - currentTime;
    const derivative = timeDifference - lastTimeDifference;
    integral += timeDifference; // Accumulate the error
    lastTimeDifference = timeDifference;

    let playbackRate;
    let minRate = 0.8;
    let maxRate = 1.2;

    // Dynamic clamping based on time difference
    if (Math.abs(timeDifference) > .5) {
        integral = 0;
        // Loosen the clamp when the difference is more than .5 second
        minRate = 0.5;
        maxRate = 1.5;
    }

    // Immediate synchronization for very large discrepancies
    if (Math.abs(timeDifference) > 1 || timeDifference < -1) {
        // Directly jump to the target time if difference is more than 1 second
        pidSeeking = true;
        video.currentTime = targetTime;
        playbackRate = 1.0; // Reset playback rate
        dynamicPIDTuning();
    } else {
        // Calculate new playback rate within dynamically adjusted bounds
        playbackRate = video.playbackRate + (kP * timeDifference) + (kI * integral) + (kD * derivative);
        playbackRate = Math.max(minRate, Math.min(maxRate, playbackRate));
    }

    if (!isNaN(playbackRate)) {
        video.playbackRate = playbackRate;
    }

    // Adjust control parameters dynamically based on synchronization accuracy
    if (Math.abs(timeDifference) <= synchronizationThreshold) {
        video.playbackRate = 1.0; // Reset playback rate if within the tight synchronization threshold
    }
}

function hybridSync(targetTime) {
    if (audioOnlyFile)
        return;
    // Adjust using a smooth transition algorithm
    adjustPlaybackRate(targetTime);
}
function dynamicPIDTuning() {
    let isOscillating = false;
    let lastCrossing = performance.now();
    let numberOfCrossings = 0;
    let accumulatedPeriod = 0;
    let significantErrorThreshold = 0.1; // Threshold to consider error significant for zero-crossing
    let decayFactor = 0.9; // Decay factor for accumulated period and crossings
    let maxAllowedPeriod = 5000; // Max period in ms to wait before forcing parameter update

    return function adjustPID(currentError) {
        const now = performance.now();
        const period = now - lastCrossing;

        // Check if the error sign has changed (zero-crossing point)
        if (Math.abs(currentError) < significantErrorThreshold && currentError * lastTimeDifference < 0) {
            if (isOscillating) {
                accumulatedPeriod = accumulatedPeriod * decayFactor + period * (1 - decayFactor);
                numberOfCrossings = numberOfCrossings * decayFactor + 1;
                lastCrossing = now;

                // After a few cycles, calculate Tu and adjust Ku
                if (numberOfCrossings >= 5) {
                    let averagePeriod = accumulatedPeriod / numberOfCrossings;
                    let Tu = averagePeriod;
                    let Ku = kP; // Assuming current kP is inducing oscillation

                    // Smooth transition for PID parameters
                    kP = kP * (1 - 0.1) + 0.1 * (0.6 * Ku);
                    kI = kI * (1 - 0.1) + 0.1 * (2 * kP / Tu);
                    kD = kD * (1 - 0.1) + 0.1 * (kP * Tu / 8);

                    // Reset for next tuning phase
                    isOscillating = false;
                    numberOfCrossings = 0;
                    accumulatedPeriod = 0;
                }
            }
        } else {
            // Increment kP to induce oscillation if not already oscillating
            if (!isOscillating) {
                kP += 0.01 * (Math.abs(currentError) > 1 ? 2 : 1);  // More aggressive if error is large
                isOscillating = true;
            }
        }

        // Ensure adjustments even in non-oscillating conditions
        if (numberOfCrossings < 5 && period > maxAllowedPeriod) {
            kP += 0.05;  // More aggressive increment
            lastCrossing = now;
            isOscillating = true;  // Assume we need to force oscillation
        }

        lastTimeDifference = currentError;
    };
}


class Timer {
    constructor(timeout, callback, timerID) {
        this.timerID = timerID;
        this.timeout = timeout;
        this.callback = callback;
        this.timerID = timerID;
        this.active = true;
        this.audioElement = null;
        this.timerHandle = setTimeout(this.callback, timeout, this.timerID);
    }
    resetTimer() {
        clearTimeout(this.timerHandle);
        this.active = false;
    }
    setAudioElement(ae) {
        this.audioElement = ae;
    }
    getAudioElement() {
        return this.audioElement;
    }
    stopAudio() {
        this.resetTimer();
        if (this.audioElement != null) {
            this.audioElement.pause();
            this.audioElement.currentTime = 0;
        }
    }
};

function isImg(pathname) {
    return imageExtensions.has(pathname.substring((pathname.lastIndexOf(".") - 1 >>> 0) + 2).toLowerCase());
}

function clearPlaylist() {
    document.getElementById("playlist").innerHTML = "";
}

function resetMediaSrc() {
    playFile("");
}

function resetPlayer() {
    document.getElementById("audio").style.visibility = document.getElementById("plystCtrl").style.visibility = "visible";
    document.getElementById("audio").style.display = document.getElementById("plystCtrl").style.display = "";
    if (!playingMediaAudioOnly) {
        clearPlaylist();
        resetMediaSrc();
    }
}

function saveRestoreAlrmFrm(divId, op) {
    if (typeof saveRestoreAlrmFrm.alrmForm == 'undefined') {
        saveRestoreAlrmFrm.alrmForm = document.getElementById(divId).cloneNode(true);
    } else if (op == "save") {
        saveRestoreAlrmFrm.alrmForm = document.getElementById(divId).cloneNode(true);
    } else if (op == "restore" && typeof saveRestoreAlrmFrm.alrmForm != 'undefined') {
        document.getElementById(divId).innerHTML = saveRestoreAlrmFrm.alrmForm.innerHTML;
    }
}

function registerAudioObj(ID, aObj) {
    timers[ID - 1].setAudioElement(aObj);
}

function timerCallback(timerID) {
    var reader = new FileReader();

    reader.onload = function (e) {
        var audioElement = new Audio(this.result);
        audioElement.play();
        audioElement.addEventListener("ended", function (e) {
            audioOnlyFile = false;
            if (document.getElementById("as1") != null) {
                document.getElementById("as" + timerID).innerText = "▶️";
            } else {
                document.getElementById("AlrmsRBtnFrmID").addEventListener("click", function () {
                    document.getElementById("as" + timerID).innerText = "▶️";
                }, { once: true });
            }
        });
        registerAudioObj(timerID, audioElement);
    }
    reader.readAsDataURL(document.getElementById("af" + timerID).files[0]);
}

function vlCtl(v) {
    if (!audioOnlyFile) {
        ipcRenderer.send('vlcl', v, 0);
    } else {
        video.volume = v;
    }
}

async function pauseMedia(e) {
    if (activeLiveStream) {
        await ipcRenderer.send('pauseVideo');
        return;
    }
    if (video.src == window.location.href || isImg(video.src)) {
        return;
    }

    if (!playingMediaAudioOnly) {
        ipcRenderer.send('pauseVideo');
        ipcRenderer.invoke('get-media-current-time').then(r => { targetTime = r });
    }
    resetPIDOnSeek();
}

async function unPauseMedia(e) {
    if (activeLiveStream) {
        await ipcRenderer.send('playVideo');
        return;
    }
    if (video.src == window.location.href || isImg(video.src)) {
        return;
    }

    if (!playingMediaAudioOnly) {
        resetPIDOnSeek();
        await ipcRenderer.send('playVideo');
    }
    if (playingMediaAudioOnly && document.getElementById("mediaWindowPlayButton")) {
        document.getElementById("mediaWindowPlayButton").textContent = "⏹️";
    }
}

function pauseButton(e) {
    if (video.src == window.location.href) {
        return;
    }
    if (video != null) {
        if (!video.paused) {
            video.pause();
        } else {
            unPauseMedia();
            video.play();
        }
    }
}

function waitForMetadata() {
    if (!video || !video.src || video.src === window.location.href || isLiveStream(video.src) || isImg(video.src)) {
        playingMediaAudioOnly = false;
        audioOnlyFile = false;
        return Promise.reject("Invalid source or live stream.");
    }

    return new Promise((resolve, reject) => {
        const onCanPlayThrough = (e) => {
            if (video.src === window.location.href) {
                e.preventDefault();
                resolve(video);
                return;
            }
            video.currentTime = 0;
            audioOnlyFile = video.videoTracks && video.videoTracks.length === 0;
            resolve(video);
        };

        const onError = (e) => {
            reject(e);
        };

        video.addEventListener('canplaythrough', onCanPlayThrough, { once: true });
        video.addEventListener('error', onError, { once: true });

        video.load();
    });
}

function playMedia(e) {
    if (!e && audioOnlyFile && opMode == MEDIAPLAYER) {
        e = {};
        e.target = document.getElementById("mediaWindowPlayButton");
    }
    fileEnded = false;
    if (video != null && encodeURI(mediaFile) != removeFileProtocol(video.src)) {
        saveMediaFile();
    }

    if (document.getElementById("mdFile").value == "" && !playingMediaAudioOnly) {
        if (e.target.textContent == "⏹️") {
            ipcRenderer.send('close-media-window', 0);
            saveMediaFile();
            video.currentTime = 0;
            video.pause();
            e.target.textContent = "▶️";
            localTimeStampUpdateIsRunning = false;
        }
        return;
    }

    if (e.target.textContent == "▶️") {
        e.target.textContent = "⏹️";
        ipcRenderer.send('disable-powersave');
        if (opMode == MEDIAPLAYER) {
            if (isImg(mediaFile)) {
                createMediaWindow();
                video.currentTime = 0;
                if (!video.paused)
                    video.src = '';
                return;
            }
        }
        let mdly = document.getElementById("mdDelay");
        audioOnlyFile = opMode == MEDIAPLAYER && video.videoTracks && video.videoTracks.length === 0;
        if (audioOnlyFile) {
            video.muted = false;
            video.loop = document.getElementById("mdLpCtlr").checked;
            playingMediaAudioOnly = true;
            currentMediaFile = document.getElementById("mdFile").files;
            if (audioOnlyFile && mdly != null && mdly.value > 0) {
                mediaPlayDelay = setTimeout(playAudioFileAfterDelay, mdly.value * 1000);
                return;
            }
            video.play();
            updateTimestamp(false);
            return;
        }

        currentMediaFile = document.getElementById("mdFile").files;
        if (opMode == MEDIAPLAYER && document.getElementById("malrm1").value != "") {
            var deadlinestr = "";
            var deadlinestrarr = String(new Date()).split(" ");
            deadlinestrarr[4] = document.getElementById("malrm1").value;
            for (i = 0; i < deadlinestrarr.length; ++i) { deadlinestr += (deadlinestrarr[i] + " ") }
            deadline = new Date(deadlinestr);
            mdly.value = ((deadline.getTime() - new Date().getTime()) / 1000);
        }
        if (mdly != null && mdly.value > 0) {
            mediaPlayDelay = setTimeout(createMediaWindow, mdly.value * 1000);
        } else {
            createMediaWindow();
        }
        dontSyncRemote = false;
    } else if (e.target.textContent = "⏹️") {
        ipcRenderer.send('close-media-window', 0);
        ipcRenderer.send('enable-powersave');
        playingMediaAudioOnly = false;
        dontSyncRemote = true;
        clearTimeout(mediaPlayDelay);
        if (opMode == MEDIAPLAYER)
            document.getElementById('mediaCntDn').textContent = "00:00:00:000";
        if (!audioOnlyFile)
            activeLiveStream = true;
        e.target.textContent = "▶️";
        video.pause();
        video.currentTime = 0;
        if (audioOnlyFile) {
            activeLiveStream = false;
            saveMediaFile();
            if (opMode == MEDIAPLAYER)
                document.getElementById('mediaCntDn').textContent = "00:00:00:000";
            if (video) {
                video.muted = true;
            }
            audioOnlyFile = false;
        }
        localTimeStampUpdateIsRunning = false;
        waitForMetadata().then(() => {
            saveMediaFile();
        }).catch((error) => {
            saveMediaFile();
        });
    }
}

function setSBFormYouTubeMediaPlayer() {
    if (opMode == MEDIAPLAYERYT) {
        return;
    }
    opMode = MEDIAPLAYERYT;
    ipcRenderer.send('set-mode', opMode);
    resetPlayer();
    if (mediaFile != null && undeisLiveStream(mediaFile)) {
        document.getElementById("mdFile").value = mediaFile;
    }
    if (!isActiveMediaWindow()) {
        if (document.getElementById("mediaCntDn") != null) {
            document.getElementById("mediaCntDn").textContent = "00:00:00:000";
        }
    }

    document.getElementById("audio").style.display = "none";
    document.getElementById("plystCtrl").style.display = "none";
    dyneForm.innerHTML =
        `
        <form>
        <input type="url" name="mdFile" id="mdFile" placeholder="Paste your video URL here..." style="width: 80%; padding: 15px; font-size: 16px; border: 2px solid #ddd; border-radius: 8px; outline: none;" onfocus="this.style.borderColor='#0056b3';" onblur="this.style.borderColor='#ddd';" accept="video/mp4,video/x-m4v,video/*,audio/x-m4a,audio/*">
        <br>
        <br>
            <select name="dspSelct" id="dspSelct">
                <option value="" disabled>--Select Display Device--</option>
            </select>
            <br>
            <br>
            <button id="mediaWindowPlayButton" type="button">▶️</button>

        </form>
        <br>
    `;

    ipcRenderer.invoke('get-all-displays').then(displays => {
        for (let i = 0; i < displays.length; i++) {
            var el = document.createElement("option");
            let dspSelct = document.getElementById("dspSelct");
            el.textContent = `Display ${i + 1} ${displays[i].bounds.width}x${displays[i].bounds.height}`;
            dspSelct.appendChild(el);

            if (dspSelct.options.length > 1) {
                dspSelct.selectedIndex = 1; // Hardcode 2nd option
            } else if (dspSelct.options.length === 1) {
                dspSelct.selectedIndex = 0;
            }
        }
    });

    document.getElementById("mediaWindowPlayButton").addEventListener("click", playMedia);

    if (playingMediaAudioOnly) {
        document.getElementById("mediaWindowPlayButton").textContent = "⏹️";
        return;
    }
    restoreMediaFile();

    if (document.getElementById("mdFile").value.includes(":\\fakepath\\")) {
        document.getElementById("mdFile").value = '';
    }

    if (!isActiveMediaWindow()) {
        document.getElementById("mediaWindowPlayButton").textContent = "▶️";
    } else {
        document.getElementById("mediaWindowPlayButton").textContent = "⏹️";
    }
}

function setSBFormMediaPlayer() {
    if (opMode == MEDIAPLAYER) {
        return;
    }
    opMode = MEDIAPLAYER;
    ipcRenderer.send('set-mode', opMode);
    resetPlayer();
    document.getElementById("audio").style.display = "none";
    document.getElementById("plystCtrl").style.display = "none";
    if (osName == "Linux") {
        dyneForm.innerHTML =
            `
            <form>
                <input type="file" name="mdFile" id="mdFile" accept="video/mp4,video/x-m4v,video/*,audio/x-m4a,audio/*,image/*">

                <br>

                <input type="number" min="0" max="60" step="1" value="0" name="mdTimeout" id="mdDelay">
                <label for="mdTimeout">Start Delay</label>
    
                <input name="malrm1" id="malrm1" type="time">
                <label for="malrm1"> Schedule </label>
                <select name="dspSelct" id="dspSelct">
                    <option value="" disabled>--Select Display Device--</option>
                </select>
                <input type="checkbox" name="mdLpCtlr" id="mdLpCtlr">
                <label for=""mdLpCtlr>Loop</label>

                <label for="volumeControl">🎧</label>
                <input type="range" class="adwaita-slider" id="volumeControl" min="0" max="1" step="0.01" value="1"

                <br>
                <br>

                <button id="mediaWindowPlayButton" type="button">▶️</button>
                <button id="mediaWindowPauseButton" type="button">⏸️</button>
                <br>

            </form>
            <br>
            <br>
            <center><video disablePictureInPicture controls id="preview"></video></center>
            <div id=cntdndiv>
            <span style="contain: layout style;transform: translateX(50px);will-change: transform;top:80%;transform: translate(-50%, -50%);color:red;font-weight: bold;font-family: 'Courier New', monospace;text-align: center;overflow: hidden;user-select: none;font-size: calc(1vw + 80%);line-height: 1;" id="mediaCntDn">00:00:00:000<span>
            </div>
        `;
    } else {
        dyneForm.innerHTML =
            `
        <form>
            <input type="file" name="mdFile" id="mdFile" accept="video/mp4,video/x-m4v,video/*,audio/x-m4a,audio/*,image/*">

            <br>

            <input type="number" min="0" max="60" step="1" value="0" name="mdTimeout" id="mdDelay">
            <label for="mdTimeout">Start Delay</label>

            <input name="malrm1" id="malrm1" type="time">
            <label for="malrm1"> Schedule </label>
            <select name="dspSelct" id="dspSelct">
                <option value="" disabled>--Select Display Device--</option>
            </select>

            <input type="checkbox" name="mdLpCtlr" id="mdLpCtlr">
            <label for=""mdLpCtlr>Loop</label>

            <label for="volumeControl">🎧</label>
            <input type="range" class="WinStyle-slider" id="volumeControl" min="0" max="1" step="0.01" value="1"

            <br>
            <br>

            <button id="mediaWindowPlayButton" type="button">▶️</button>
            <button id="mediaWindowPauseButton" type="button">⏸️</button>
            <br>

        </form>
        <br>
        <br>
        <center><video disablePictureInPicture controls id="preview"></video></center>
        <div id=cntdndiv>
        <span style="contain: layout style;transform: translateX(50px);will-change: transform;top:80%;transform: translate(-50%, -50%);color:red;font-weight: bold;font-family: 'Courier New', monospace;text-align: center;overflow: hidden;user-select: none;font-size: calc(1vw + 80%);line-height: 1.2;" id="mediaCntDn">00:00:00:000<span>
        </div>
    `;
    }

    ipcRenderer.invoke('get-all-displays').then(displays => {
        for (let i = 0; i < displays.length; i++) {
            var el = document.createElement("option");
            let dspSelct = document.getElementById("dspSelct");
            el.textContent = `Display ${i + 1} ${displays[i].bounds.width}x${displays[i].bounds.height}`;
            dspSelct.appendChild(el);

            if (dspSelct.options.length > 1) {
                dspSelct.selectedIndex = 1; // Hardcode 2nd option
            } else if (dspSelct.options.length === 1) {
                dspSelct.selectedIndex = 0;
            }
        }
    });

    if (video == null) {
        video = document.getElementById('preview');
    }

    restoreMediaFile();
    updateTimestamp(false);
    const vc = document.getElementById('volumeControl');
    vc.addEventListener('input', function () {
        vlCtl(this.value);
        CrVL = this.value;
    });
    vc.value = CrVL;
    const mdFile = document.getElementById("mdFile");
    mdFile.addEventListener("change", saveMediaFile);
    const isActiveMW = isActiveMediaWindow();
    let plyBtn = document.getElementById("mediaWindowPlayButton");
    if (!isActiveMW && !playingMediaAudioOnly) {
        plyBtn.textContent = "▶️";
        document.getElementById("mediaCntDn").textContent = "00:00:00:000";
    } else {
        plyBtn.textContent = "⏹️";
        document.getElementById('mediaCntDn').textContent = timeRemaining;
        timeRemaining = "00:00:00:000";
        if (typeof currentMediaFile === 'undefined') {
            currentMediaFile = mdFile.files
        } else {
            mdFile.files = currentMediaFile;
        }
    }
    plyBtn.addEventListener("click", playMedia);
    dontSyncRemote = true;
    document.getElementById("mediaWindowPauseButton").addEventListener("click", pauseButton);
    let isImgFile;
    if (mdFile != null) {
        if (document.getElementById("preview").parentNode != null) {
            if (!masterPauseState && video != null && !video.paused) {
                dontSyncRemote = false;
                if (!isImg(mediaFile)) {
                    video.play();
                }
            }
            if (video != null) {
                if (!isActiveMW) {
                    if (!mdFile.value.includes("fake")) {
                        mediaFile = mdFile.value;
                    } else {
                        mediaFile = document.getElementById("YtPlyrRBtnFrmID").checked == true ? mdFile.value : mdFile.files[0].path;
                    }
                }
                const isImgFile = isImg(mediaFile);
                if (isActiveMW && mediaFile != null && !isLiveStream(mediaFile)) {
                    if (video == null) {
                        video = document.getElementById("preview");
                        saveMediaFile();
                    }
                    if (video) {
                        if (targetTime != null) {
                            if (!masterPauseState && !isImgFile) {
                                video.play();
                            }
                        }
                    }
                    dontSyncRemote = false;
                }
                document.getElementById("preview").parentNode.replaceChild(video, document.getElementById("preview"));
            }
        } else {
            dontSyncRemote = false;
        }

        if (isImgFile && !document.querySelector('img')) {
            img = document.createElement('img');
            video.src = '';
            img.src = mediaFile;
            img.setAttribute("id", "preview");
            document.getElementById("preview").style.display = 'none';
            document.getElementById("preview").parentNode.appendChild(img);
            document.getElementById("cntdndiv").style.display = 'none';
            return;
        }
    }
    if (encodeURI(mediaFile) != removeFileProtocol(video.src)) {
        saveMediaFile();
    }
}

function removeFileProtocol(filePath) {
    return filePath.slice(7);
}

function saveMediaFile() {
    var mdfileElement = document.getElementById("mdFile");
    if (!mdfileElement) {
        return;
    }

    if (mdfileElement.files != null && mdfileElement.files.length != 0 && encodeURI(mdfileElement.files[0].path) == removeFileProtocol(video.src)) {
        return;
    }

    if (playingMediaAudioOnly && opMode == MEDIAPLAYER) {
        if (mdfileElement.files[0].length == 0) {
            return;
        }
        mediaFile = mdfileElement.files[0].path;
        return;
    }

    if (mdfileElement != null && mdfileElement != 'undefined') {
        if (mdfileElement.files != null && mdfileElement.files.length == 0) {
            return;
        } else if (mdfileElement.value == "") {
            return;
        }
        if (opMode != MEDIAPLAYER && dontSyncRemote != true)
            dontSyncRemote = true;
        saveMediaFile.fileInpt = mdfileElement.files;
        saveMediaFile.urlInpt = mdfileElement.value.toLowerCase();
    }
    const isActiveMW = isActiveMediaWindow();
    if (isActiveMW) {
        return;
    }

    if (!mdfileElement.value.includes("fake")) {
        mediaFile = mdfileElement.value;
    } else {
        mediaFile = document.getElementById("YtPlyrRBtnFrmID").checked == true ? mdfileElement.value : mdfileElement.files[0].path;
    }

    let imgEle = null;
    if (imgEle = document.querySelector('img')) {
        imgEle.remove();
        document.getElementById("preview").style.display = '';
        document.getElementById("cntdndiv").style.display = '';
    }
    let iM;
    if ((iM = isImg(mediaFile))) {
        playingMediaAudioOnly = false;
        audioOnlyFile = false;
    }

    if (iM && !document.querySelector('img') && (!isActiveMW)) {
        let imgEle = null;
        if ((imgEle = document.querySelector('img')) != null) {
            imgEle.remove();
            document.getElementById("cntdndiv").style.display = '';
            if (video) {
                video.style.display = 'none';
            }
        }
        img = document.createElement('img');
        video.src = '';
        img.src = mediaFile;
        img.setAttribute("id", "preview");
        document.getElementById("preview").style.display = 'none';
        document.getElementById("preview").parentNode.appendChild(img);
        document.getElementById("cntdndiv").style.display = 'none';
        return;
    }
    let liveStream = isLiveStream(mediaFile);
    if ((mdfileElement != null && (!isActiveMW && mdfileElement != null &&
        !(liveStream))) || (isActiveMW && mdfileElement != null && liveStream) || activeLiveStream && isActiveMW) {
        if (video == null) {
            video = document.getElementById('preview');
        }
        if (video) {
            if (!audioOnlyFile)
                video.muted = true;
            if (mdfileElement != null && mdfileElement.files && prePathname != mdfileElement.files[0].path) {
                prePathname = mdfileElement.files[0].path;
                startTime = 0;
            }
            if (!playingMediaAudioOnly && mdfileElement.files) {
                let uncachedLoad;
                if ((uncachedLoad = encodeURI(mdfileElement.files[0].path) != removeFileProtocol(video.src))) {
                    video.setAttribute("src", mdfileElement.files[0].path);
                }
                video.id = "preview";
                video.currentTime = startTime;
                video.controlsList = "noplaybackrate";
                if (document.getElementById("mdLpCtlr") != null) {
                    video.loop = document.getElementById("mdLpCtlr").checked;
                }
                if (uncachedLoad) {
                    video.load();
                }
            }
        }
    }
    if (opMode == MEDIAPLAYER && mediaFile != null) {
        dontSyncRemote = false;
    }
}

function restoreMediaFile() {
    if (saveMediaFile.fileInpt != null && document.getElementById("mdFile") != null) {
        if (document.getElementById("YtPlyrRBtnFrmID") != null && document.getElementById("YtPlyrRBtnFrmID").checked) {
            document.getElementById("mdFile").value = saveMediaFile.urlInpt;
        } else {
            document.getElementById("mdFile").files = saveMediaFile.fileInpt;
        }
    }
}

function installSidebarFormEvents() {
    document.getElementById("MdPlyrRBtnFrmID").onclick = setSBFormMediaPlayer;
    document.getElementById("YtPlyrRBtnFrmID").onclick = setSBFormYouTubeMediaPlayer;

    document.querySelector('form').addEventListener('change', function (event) {
        if (event.target.type === 'radio') {
            if (event.target.value == 'Media Player') {
                installPreviewEventHandlers();
                dontSyncRemote = true;
                if (video && !activeLiveStream && isActiveMediaWindow()) {
                    dontSyncRemote = false;
                }
                mediaCntDnEle = document.getElementById('mediaCntDn');
                updateTimestamp(false);
                if (masterPauseState) {
                    mediaCntDnEle.textContent = savedCurTime;
                }
                document.getElementById("playlist").style.display = 'none';
            } else {
                document.getElementById("playlist").style.display = '';
                if (mediaCntDnEle)
                    savedCurTime = mediaCntDnEle.textContent;
                mediaCntDnEle = null;
            }
        }
    });
}

function endOfPlaylist() {
    if (document.getElementById("plystLpctrlPlst").checked) {
        nextFile = getFirstFile();
        playFile(nextFile.getAttribute("data-path"));
        setNextFile(nextFile);
    }
}

function installOnFileEndEventHandler() {
    document.getElementById("audio").addEventListener("ended", function (e) {
        if (e) {
            if (nextFile == null) {
                endOfPlaylist();
                return;
            }
            playFile(nextFile.getAttribute("data-path"));
            setNextFile(nextFile);
        }
    });
}

function installFileLoopCtlEventHandler() {
    document.getElementById("plystLpctrlLpFl").addEventListener("change", function (e) {
        if (e) {
            document.getElementById("audio").loop = e.currentTarget.checked;
        }
    });
}

function getFirstFile() {
    return document.getElementById("playlist").childNodes[0].firstChild;
}

function setNextFile(elm) {
    nextFile = elm.parentNode.nextElementSibling != null ? elm.parentNode.nextElementSibling.childNodes[0] : null;
}

function installFilePickerEventHandler() {
    document.getElementById("playlist").addEventListener("click", function (e) {
        if (e.target.getAttribute("data-path") != null) {
            setNextFile(e.target);
            playFile(e.target.getAttribute("data-path"));
        }
    });
}

function installEvents() {
    installSidebarFormEvents();
    installFilePickerEventHandler();
    installOnFileEndEventHandler();
    installFileLoopCtlEventHandler();
}

function ISO8601_week_no(dt) {
    var tdt = new Date(dt.valueOf());
    var dayn = (dt.getDay() + 6) % 7;
    tdt.setDate(tdt.getDate() - dayn + 3);
    var firstThursday = tdt.valueOf();
    tdt.setMonth(0, 1);
    if (tdt.getDay() !== 4) {
        tdt.setMonth(0, 1 + ((4 - tdt.getDay()) + 7) % 7);
    }
    return 1 + Math.ceil((firstThursday - tdt) / 604800000);
}

function playAudioFileAfterDelay() {
    video.play();
    updateTimestamp(false);
}

function installPreviewEventHandlers() {
    if (!installedVideoEventListener) {
        video.addEventListener('loadstart', function (event) {
            if (video.src == window.location.href) {
                event.preventDefault();
                return;
            }
        });
        video.addEventListener('loadedmetadata', function (event) {
            if (video.src == window.location.href || isImg(video.src)) {
                return;
            }
            audioOnlyFile = video.videoTracks && video.videoTracks.length === 0;
        });
        video.addEventListener('seeked', (e) => {
            if (pidSeeking) {
                pidSeeking = false;
                e.preventDefault();
            }
            resetPIDOnSeek();
            if (video.src == window.location.href) {
                e.preventDefault();
                return;
            }
            if (dontSyncRemote == true) {
                dontSyncRemote = false;
                return;
            }
            updateTimestamp(true);
            if (e.target.isConnected) {
                ipcRenderer.send('timeGoto-message', { currentTime: e.target.currentTime, timestamp: Date.now() });
                ipcRenderer.invoke('get-media-current-time').then(r => { targetTime = r });
                resetPIDOnSeek();
            }
        });

        video.addEventListener('seeking', (e) => {
            if (pidSeeking) {
                pidSeeking = false;
                e.preventDefault();
            }
            resetPIDOnSeek();
            if (dontSyncRemote == true) {
                return;
            }
            updateTimestamp(true);
            if (e.target.isConnected) {
                ipcRenderer.send('timeGoto-message', { currentTime: e.target.currentTime, timestamp: Date.now() });
                ipcRenderer.invoke('get-media-current-time').then(r => { targetTime = r });
            }
            resetPIDOnSeek();
        });

        video.addEventListener('ended', (e) => {
            ipcRenderer.send('enable-powersave');
            audioOnlyFile = false;
            if (document.getElementById("mediaWindowPlayButton")) {
                document.getElementById("mediaWindowPlayButton").textContent = "▶️";
            }
            if (playingMediaAudioOnly) {
                playingMediaAudioOnly = false;
                if (document.getElementById('mediaCntDn'))
                    document.getElementById('mediaCntDn').textContent = "00:00:00:000";
                if (video) {
                    video.muted = true;
                }
                if (video != null) {
                    video.currentTime = 0;
                }
                if (document.getElementById("mediaCntDn") != null) {
                    document.getElementById("mediaCntDn").innerText = "00:00:00:000";
                }

                if (document.getElementById("mediaWindowPlayButton") != null) {
                    document.getElementById("mediaWindowPlayButton").innerText = "▶️";
                } else {
                    document.getElementById("MdPlyrRBtnFrmID").addEventListener("click", function () {
                        document.getElementById("mediaWindowPlayButton").innerText = "▶️";
                    }, { once: true });
                }
                timeRemaining = "00:00:00:000";
                masterPauseState = false;
                saveMediaFile();
            }
            targetTime = 0;
            fileEnded = true;
            video.pause();
            masterPauseState = false;
            resetPIDOnSeek();
            if (video) {
                video.muted = true;
            }
            localTimeStampUpdateIsRunning = false;
        });

        video.addEventListener('pause', (event) => {
            if (mediaSessionPause) {
                ipcRenderer.invoke('get-media-current-time').then(r => { targetTime = r });
                return;
            }
            if (fileEnded) {
                fileEnded = false;
                return;
            }
            if (dontPauseOnPipExit) {
                dontPauseOnPipExit = false;
                event.preventDefault();
                video.play();
                return;
            }
            if (!event.target.isConnected) {
                if ((!isActiveMediaWindow()) && playingMediaAudioOnly == false) {
                    return;
                }
                event.preventDefault();
                video.play().then(() => {
                    ;
                }).catch(error => {
                    playingMediaAudioOnly = false;
                });

                masterPauseState = false;
                return;
            }
            if (event.target.clientHeight == 0) {
                event.preventDefault();
                event.target.play(); //continue to play even if detached
                return;
            }
            if (video.src == window.location.href) {
                event.preventDefault();
                return;
            }
            if (activeLiveStream) {
                return;
            }
            if (video.currentTime - video.duration == 0) {
                return;
            }
            if (event.target.parentNode != null) {
                if (isActiveMediaWindow()) {
                    pauseMedia();
                    masterPauseState = true;
                }
            }
        });
        video.addEventListener('play', (event) => {
            let mdly = document.getElementById("mdDelay");
            if (audioOnlyFile && mdly != null && mdly.value > 0) {
                event.preventDefault();
                mediaPlayDelay = setTimeout(playAudioFileAfterDelay, mdly.value * 1000);
                mdly.value = 0;
                document.getElementById('mediaWindowPlayButton').textContent = "⏹️";
                video.pause();
                return;
            }
            mediaSessionPause = false;
            if (!audioOnlyFile && video.readyState && video.videoTracks && video.videoTracks.length === 0) {
                audioOnlyFile = true;
            }
            if (audioOnlyFile) {
                updateTimestamp(false);
            }
            if (isActiveMediaWindow()) {
                unPauseMedia();
                return;
            }
            let mediaScrnPlyBtn = document.getElementById("mediaWindowPlayButton");
            if (mediaScrnPlyBtn && audioOnlyFile) {
                if (mediaScrnPlyBtn.textContent == '▶️') {
                    fileEnded = false;
                    video.muted = false;
                    ipcRenderer.send('disable-powersave');
                    if (document.getElementById("mdLpCtlr")) {
                        video.loop = document.getElementById("mdLpCtlr").checked;
                    }
                    mediaScrnPlyBtn.textContent = '⏹️';
                    audioOnlyFile = true;
                    playingMediaAudioOnly = true;
                    updateTimestamp(false);
                    return;
                }
            }
            if (isImg(video.src)) {
                return;
            }
            if (video.src == window.location.href) {
                event.preventDefault();
                return;
            }
            masterPauseState = false;
            if (isImg(video.src)) {
                audioOnlyFile = false;
                playingMediaAudioOnly = false;
            } else {
                if (audioOnlyFile) {
                    video.muted = false;
                    ipcRenderer.send('disable-powersave');
                    if (document.getElementById("mdLpCtlr")) {
                        video.loop = document.getElementById("mdLpCtlr").checked;
                    }
                    if (document.getElementById('volumeControl')) {
                        video.volume = document.getElementById('volumeControl').value;
                    }
                    playingMediaAudioOnly = true;
                    updateTimestamp(false);
                    return;
                }
            }
        });


        installedVideoEventListener = true;
    }
}

function initPlayer() {
    ipcRenderer.invoke('get-setting', "operating-mode").then(mode => {
        dyneForm = document.getElementById("dyneForm");
        switch (mode) {
            case MEDIAPLAYER:
                document.getElementById("MdPlyrRBtnFrmID").checked = true;
                setSBFormMediaPlayer();
                installPreviewEventHandlers();
                mediaCntDnEle = document.getElementById('mediaCntDn');
                document.getElementById("playlist").style.display = 'none';
                break;
            case MEDIAPLAYERYT:
                document.getElementById("YtPlyrRBtnFrmID").checked = true;
                setSBFormYouTubeMediaPlayer();
                break;
            default:
                document.getElementById("MdPlyrRBtnFrmID").checked = true;
                setSBFormMediaPlayer();
                installPreviewEventHandlers();
                mediaCntDnEle = document.getElementById('mediaCntDn');
                document.getElementById("playlist").style.display = 'none';
        }
    });
}

var ipcprom = installIPCHandler();

window.addEventListener("load", async (event) => {
    initPlayer();
    installEvents();
    await ipcprom;
});

function addToPlaylist(wnum, song) {
    var li = document.createElement("li");
    var header = document.createElement("header");
    header.appendChild(document.createTextNode(song));
    li.appendChild(header);
    li.classList.add("plEntry");
    li.setAttribute("draggable", "true");
    header.setAttribute("data-path", "../" + wnum + "/" + song);
    document.getElementById("playlist").appendChild(li);
}

function playFile(path) {
    var audio = document.getElementById("audio");
    document.getElementById("audioSource").src = encodeURI(path);
    audio.load();
    if (path != "")
        return audio.play();
}

function isLiveStream(mediaFile) {
    return mediaFile.includes("m3u8") || mediaFile.includes("mpd") ||
        mediaFile.includes("youtube.com") || mediaFile.includes("videoplayback") || mediaFile.includes("youtu.be");
}

async function createMediaWindow() {
    if (!document.getElementById("mdFile").value.includes("fake")) {
        mediaFile = document.getElementById("mdFile").value;
    } else {
        mediaFile = document.getElementById("YtPlyrRBtnFrmID").checked == true ? document.getElementById("mdFile").value : document.getElementById("mdFile").files[0].path;
    }

    var liveStreamMode = (mediaFile.includes("m3u8") || mediaFile.includes("mpd") || mediaFile.includes("youtube.com") || mediaFile.includes("videoplayback")) == true ? true : false;

    if (liveStreamMode == false && video != null) {
        //video.pause();
        startTime = video.currentTime;
    }

    saveMediaFile();

    var displays = await ipcRenderer.invoke('get-all-displays');
    var externalDisplay = null;
    externalDisplay = displays[document.getElementById("dspSelct").selectedIndex - 1];
    activeLiveStream = liveStreamMode;
    if (liveStreamMode == false) {
        if (video == null) {
            video = document.getElementById("preview");
        }
        if (video == null) {
            video.muted = true;
            video.setAttribute("src", mediaFile);
            video.id = "preview";
            video.currentTime = startTime;
            video.controlsList = "noplaybackrate";
            if (document.getElementById("mdLpCtlr") != null) {
                video.loop = document.getElementById("mdLpCtlr").checked;
            }
            document.getElementById("cntdndiv").style.display = '';
        }
    } else {
        if (video && !isImg(video.src))
            video.src = '';
    }

    var strtVl = 1;
    if (document.getElementById('volumeControl') != null) {
        strtVl = document.getElementById('volumeControl').value;
    }

    if (audioOnlyFile && !isActiveMediaWindow()) {
        video.muted = false;
        video.loop = document.getElementById("mdLpCtlr").checked;
        video.volume = document.getElementById('volumeControl').value;
        if (!isImg(mediaFile)) {
            await video.play();
        } else {
            video.src = '';
        }
        playingMediaAudioOnly = true;
        if (playingMediaAudioOnly)
            updateTimestamp(false);
        return;
    } else {
        playingMediaAudioOnly = false;
        if (document.getElementById('mediaCntDn'))
            document.getElementById('mediaCntDn').textContent = "00:00:00:000";
        if (video) {
            video.muted = true;
        }
    }

    const windowOptions = {
        backgroundColor: '#00000000',
        transparent: true,
        width: externalDisplay.width,
        height: externalDisplay.height,
        fullscreen: true,
        frame: false,
        webPreferences: {
            backgroundThrottling: false,
            additionalArguments: [
                '--start-time=' + startTime,
                '--start-vol=' + strtVl,
                '--mediafile-ems=' + encodeURIComponent(mediaFile),
                document.getElementById("mdLpCtlr") != undefined ? '--media-loop=' + document.getElementById("mdLpCtlr").checked : "",
                '--live-stream=' + liveStreamMode
            ],
            preload: path.join(__dirname, 'media_preload.js')
        }
    };

    windowOptions.x = externalDisplay.bounds.x + 50;
    windowOptions.y = externalDisplay.bounds.y + 50;

    await ipcRenderer.invoke('create-media-window', windowOptions);
    isActiveMediaWindowCache = true;

    unPauseMedia();
    if (opMode != MEDIAPLAYERYT) {
        if (video != null && !isImg(mediaFile)) {
            await video.play();
        }
    }
}

function loadPlatformCSS(mode) {
    const bodyClass = document.body.classList;
    switch (mode) {
        case 'win32':
            osName = 'Windows';
            bodyClass.add('WinStyle');
            break;
        case 'darwin':
            break;
        case 'linux':
            osName = 'Linux';
            /*const slider = document.getElementById('adwaita-slider');
            const updateSlider = (event) => {
                const value = (event.target.value - event.target.min) / (event.target.max - event.target.min);
                event.target.style.background = `linear-gradient(to right, #4a90d9 0%, #4a90d9 ${value * 100}%, #b3b3b3 ${value * 100}%, #b3b3b3 100%)`;
            };
            slider.addEventListener('input', updateSlider);
            updateSlider({target: slider});*/
            bodyClass.add('WinStyle');
            break;
    }
}

if (document.readyState == 'interactive') {
    ipcRenderer.invoke('get-platform').then(mode => {
        loadPlatformCSS(mode);
    });
} else {
    document.addEventListener('DOMContentLoaded', () => {
        ipcRenderer.invoke('get-platform').then(mode => {
            loadPlatformCSS(mode);
        });
    });
}
