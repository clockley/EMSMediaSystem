/*👉
Copyright (C) 2019-2024 Christian Lockley
This library is free software; you can redistribute it and/or modify it
under the terms of the GNU Lesser General Public License as published by
the Free Software Foundation; either version 3 of the License, or
(at your option) any later version.

This library is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
Lesser General Public License for more details.

You should have received a copy of the GNU Lesser General Public License
along with this library. If not, see <https://www.gnu.org/licenses/>.
*/

//Project Alchemy

"use strict";

const { ipcRenderer, __dirname, bibleAPI, webUtils, getHostnameOrBasename } = window.electron;

var pidSeeking = false;
var streamVolume = 1;
var video = null;
var masterPauseState = false;
var activeLiveStream = false;
var targetTime = 0;
var startTime = 0;
var prePathname = '';
var playingMediaAudioOnly = false;
var audioOnlyFile = false;
var opMode = -1;
var localTimeStampUpdateIsRunning = false;
var mediaFile;
var currentMediaFile;
var fileEnded = false;
var mediaSessionPause = false;
let isPlaying = false;
let img = null;
let itc = 0;
const MEDIAPLAYER = 0, MEDIAPLAYERYT = 1, BULKMEDIAPLAYER = 5, TEXTPLAYER = 6;
const imageRegex = /\.(bmp|gif|jpe?g|png|webp|svg|ico)$/i;
let isActiveMediaWindowCache = false;
const SECONDS = new Int32Array(1);
const SECONDSFLOAT = new Float64Array(1);
const textNode = document.createTextNode('');

const updatePending = new Int32Array(1);

const send = ipcRenderer.send;
const invoke = ipcRenderer.invoke;
const on = ipcRenderer.on;
const getPathForFile = webUtils.getPathForFile;
const mediaPlayerInputState = {
    fileInpt: null,
    urlInpt: null,
    clear() {
        this.fileInpt = null;
        this.urlInpt = null;
    }
};

class PIDController {
    constructor(video) {
        this.video = video;

        this.adaptiveCoefficients = {
            kP: {
                value: 0.6,
                minValue: 0.3,
                maxValue: 0.9,
                adjustmentRate: 0.01
            },
            kI: {
                value: 0.08,
                minValue: 0.02,
                maxValue: 0.2,
                adjustmentRate: 0.005
            },
            kD: {
                value: 0.12,
                minValue: 0.05,
                maxValue: 0.2,
                adjustmentRate: 0.01
            }
        };

        this.patterns = {
            STABLE: 'stable',
            OSCILLATING: 'oscillating',
            LAGGING: 'lagging',
            SYSTEM_STRESS: 'systemStress'
        };

        this.performancePatterns = {
            [this.patterns.STABLE]: {
                maxRate: 1.1, threshold: 0.033
            },
            [this.patterns.OSCILLATING]: {
                maxRate: 1.05, threshold: 0.05
            },
            [this.patterns.LAGGING]: {
                maxRate: 1.2, threshold: 0.066
            },
            [this.patterns.SYSTEM_STRESS]: {
                maxRate: 1.05, threshold: 0.1
            }
        };

        this.systemLag = 0;
        this.overshoots = 0;
        this.avgResponseTime = 0;
        this.currentPattern = this.patterns.STABLE;

        this.lastWallTime = null;
        this.maxTimeGap = 1000;

        this.synchronizationThreshold = 0.005;
        this.maxIntegralError = 0.5;
        this.fastSyncThreshold = 1;
        this.maxFastSyncRate = 2;

        this.maxHistoryLength = 30;
        this.isFirstAdjustment = true;

        // Pre-allocate arrays for history
        this.timeArray = new Float64Array(this.maxHistoryLength);
        this.diffArray = new Float64Array(this.maxHistoryLength);
        this.responseArray = new Float64Array(this.maxHistoryLength);
        this.historyIndex = 0;
        this.historySize = 0;
    }

    updateSystemMetrics(timeDifference, timestamp) {
        this.timeArray[this.historyIndex] = timestamp;
        this.diffArray[this.historyIndex] = timeDifference;
        this.responseArray[this.historyIndex] = this.historySize > 0
            ? timestamp - this.timeArray[(this.historyIndex - 1 + this.maxHistoryLength) % this.maxHistoryLength]
            : 0;

        this.historyIndex = (this.historyIndex + 1) % this.maxHistoryLength;
        if (this.historySize < this.maxHistoryLength) {
            this.historySize++;
        }

        if (this.historySize >= 10) {
            let variance = 0;
            let trend = 0;
            let sumTimeDifference = 0;

            const startIdx = (this.historyIndex - 10 + this.maxHistoryLength) % this.maxHistoryLength;
            let previousTimeDiff = startIdx > 0
                ? this.diffArray[(startIdx - 1 + this.maxHistoryLength) % this.maxHistoryLength]
                : 0;

            for (let i = 0; i < 10; i++) {
                const bufferIdx = (startIdx + i) % this.maxHistoryLength;
                const currentTimeDiff = this.diffArray[bufferIdx];
                sumTimeDifference += currentTimeDiff;
                variance += currentTimeDiff * currentTimeDiff;

                if (i > 0) {
                    trend += currentTimeDiff - previousTimeDiff;
                }
                previousTimeDiff = currentTimeDiff;
            }

            const mean = sumTimeDifference / 10;
            variance = (variance / 10) - (mean * mean);
            trend = trend / 9;

            if (variance > 0.1 && this.overshoots > 3) {
                this.currentPattern = this.patterns.OSCILLATING;
            } else if (trend > 0.05 || this.avgResponseTime > 0.15) {
                this.currentPattern = this.patterns.LAGGING;
            } else if (this.systemLag > 100 || this.avgResponseTime > 0.2) {
                this.currentPattern = this.patterns.SYSTEM_STRESS;
            } else {
                this.currentPattern = this.patterns.STABLE;
            }
        }
    }

    detectPattern() {
        if (this.historySize < 10) return;

        let variance = 0;
        let trend = 0;
        let sumOfDifferences = 0;

        const startIdx = (this.historyIndex - 10 + this.maxHistoryLength) % this.maxHistoryLength;
        let previousTimeDiff = startIdx > 0
            ? this.diffArray[(startIdx - 1 + this.maxHistoryLength) % this.maxHistoryLength]
            : 0;

        for (let i = 0; i < 10; i++) {
            const currentTimeDiff = this.diffArray[(startIdx + i) % this.maxHistoryLength];
            sumOfDifferences += currentTimeDiff;
            variance += currentTimeDiff * currentTimeDiff;

            if (i > 0) {
                trend += currentTimeDiff - previousTimeDiff;
            }
            previousTimeDiff = currentTimeDiff;
        }

        const mean = sumOfDifferences / 10;
        variance = (variance / 10) - (mean * mean);
        trend = trend / 9;

        if (variance > 0.1 && this.overshoots > 3) {
            this.currentPattern = this.patterns.OSCILLATING;
        } else if (trend > 0.05 || this.avgResponseTime > 0.15) {
            this.currentPattern = this.patterns.LAGGING;
        } else if (this.systemLag > 100 || this.avgResponseTime > 0.2) {
            this.currentPattern = this.patterns.SYSTEM_STRESS;
        } else {
            this.currentPattern = this.patterns.STABLE;
        }
    }

    adjustPIDCoefficients() {
        const { STABLE, OSCILLATING, LAGGING, SYSTEM_STRESS } = this.patterns;

        switch (this.currentPattern) {
            case STABLE:
                this.adaptiveCoefficients.kP.value = (this.adaptiveCoefficients.kP.value + this.adaptiveCoefficients.kP.adjustmentRate > this.adaptiveCoefficients.kP.maxValue) ?
                    this.adaptiveCoefficients.kP.maxValue : this.adaptiveCoefficients.kP.value + this.adaptiveCoefficients.kP.adjustmentRate;
                this.adaptiveCoefficients.kI.value = (this.adaptiveCoefficients.kI.value + this.adaptiveCoefficients.kI.adjustmentRate > this.adaptiveCoefficients.kI.maxValue) ?
                    this.adaptiveCoefficients.kI.maxValue : this.adaptiveCoefficients.kI.value + this.adaptiveCoefficients.kI.adjustmentRate;
                this.adaptiveCoefficients.kD.value = (this.adaptiveCoefficients.kD.value + this.adaptiveCoefficients.kD.adjustmentRate > this.adaptiveCoefficients.kD.maxValue) ?
                    this.adaptiveCoefficients.kD.maxValue : this.adaptiveCoefficients.kD.value + this.adaptiveCoefficients.kD.adjustmentRate;
                break;
            case OSCILLATING:
                this.adaptiveCoefficients.kP.value = (this.adaptiveCoefficients.kP.value - this.adaptiveCoefficients.kP.adjustmentRate < this.adaptiveCoefficients.kP.minValue) ?
                    this.adaptiveCoefficients.kP.minValue : this.adaptiveCoefficients.kP.value - this.adaptiveCoefficients.kP.adjustmentRate;
                this.adaptiveCoefficients.kI.value = (this.adaptiveCoefficients.kI.value - this.adaptiveCoefficients.kI.adjustmentRate < this.adaptiveCoefficients.kI.minValue) ?
                    this.adaptiveCoefficients.kI.minValue : this.adaptiveCoefficients.kI.value - this.adaptiveCoefficients.kI.adjustmentRate;
                this.adaptiveCoefficients.kD.value = (this.adaptiveCoefficients.kD.value + this.adaptiveCoefficients.kD.adjustmentRate > this.adaptiveCoefficients.kD.maxValue) ?
                    this.adaptiveCoefficients.kD.maxValue : this.adaptiveCoefficients.kD.value + this.adaptiveCoefficients.kD.adjustmentRate;
                break;
            case LAGGING:
                this.adaptiveCoefficients.kP.value = (this.adaptiveCoefficients.kP.value + this.adaptiveCoefficients.kP.adjustmentRate > this.adaptiveCoefficients.kP.maxValue) ?
                    this.adaptiveCoefficients.kP.maxValue : this.adaptiveCoefficients.kP.value + this.adaptiveCoefficients.kP.adjustmentRate;
                this.adaptiveCoefficients.kI.value = (this.adaptiveCoefficients.kI.value + this.adaptiveCoefficients.kI.adjustmentRate > this.adaptiveCoefficients.kI.maxValue) ?
                    this.adaptiveCoefficients.kI.maxValue : this.adaptiveCoefficients.kI.value + this.adaptiveCoefficients.kI.adjustmentRate;
                this.adaptiveCoefficients.kD.value = (this.adaptiveCoefficients.kD.value - this.adaptiveCoefficients.kD.adjustmentRate < this.adaptiveCoefficients.kD.minValue) ?
                    this.adaptiveCoefficients.kD.minValue : this.adaptiveCoefficients.kD.value - this.adaptiveCoefficients.kD.adjustmentRate;
                break;
            case SYSTEM_STRESS:
                this.adaptiveCoefficients.kP.value = (this.adaptiveCoefficients.kP.value - this.adaptiveCoefficients.kP.adjustmentRate < this.adaptiveCoefficients.kP.minValue) ?
                    this.adaptiveCoefficients.kP.minValue : this.adaptiveCoefficients.kP.value - this.adaptiveCoefficients.kP.adjustmentRate;
                this.adaptiveCoefficients.kI.value = (this.adaptiveCoefficients.kI.value - this.adaptiveCoefficients.kI.adjustmentRate < this.adaptiveCoefficients.kI.minValue) ?
                    this.adaptiveCoefficients.kI.minValue : this.adaptiveCoefficients.kI.value - this.adaptiveCoefficients.kI.adjustmentRate;
                this.adaptiveCoefficients.kD.value = (this.adaptiveCoefficients.kD.value - this.adaptiveCoefficients.kD.adjustmentRate < this.adaptiveCoefficients.kD.minValue) ?
                    this.adaptiveCoefficients.kD.minValue : this.adaptiveCoefficients.kD.value - this.adaptiveCoefficients.kD.adjustmentRate;
                break;
        }
    }

    calculateHistoricalAdjustment(timeDifference, deltaTime) {
        this.integral += timeDifference * deltaTime;
        this.integral = (this.integral < -this.maxIntegralError) ? -this.maxIntegralError :
            (this.integral > this.maxIntegralError) ? this.maxIntegralError : this.integral;

        const derivative = (timeDifference - this.lastTimeDifference) / deltaTime;
        this.lastTimeDifference = timeDifference;

        return (this.adaptiveCoefficients.kP.value * timeDifference) +
            (this.adaptiveCoefficients.kI.value * this.integral) +
            (this.adaptiveCoefficients.kD.value * derivative);
    }

    adjustPlaybackRate(targetTime) {
        const now = performance.now();
        const wallNow = Date.now();
        if (!this.video || this.video.paused || this.video.seeking) {
            return;
        }

        if (this.isFirstAdjustment || this.lastWallTime === null) {
            this.lastWallTime = wallNow;
            this.lastUpdateTime = now;
            this.isFirstAdjustment = false;
            const timeDifference = targetTime - this.video.currentTime;
            this.updateSystemMetrics(timeDifference, wallNow);
            return timeDifference;
        }

        const wallTimeDelta = wallNow - this.lastWallTime;

        if (wallTimeDelta > this.maxTimeGap) {
            pidSeeking = true;
            this.video.currentTime = targetTime;
            this.lastWallTime = wallNow;
            this.isFirstAdjustment = false;
            const timeDifference = targetTime - this.video.currentTime;
            this.updateSystemMetrics(timeDifference, wallNow);
            return timeDifference;
        }

        const deltaTime = (now - this.lastUpdateTime) / 1000;
        this.lastUpdateTime = now;
        this.lastWallTime = wallNow;

        const timeDifference = targetTime - this.video.currentTime;
        const timeDifferenceAbs = timeDifference < 0 ? -timeDifference : timeDifference;

        this.updateSystemMetrics(timeDifference, wallNow);

        const finalAdjustment = this.calculateHistoricalAdjustment(timeDifference, deltaTime);

        if (timeDifferenceAbs > this.fastSyncThreshold) {
            let playbackRate;
            if (timeDifference > 0) {
                const calcRate = 1 + (timeDifferenceAbs / deltaTime);
                playbackRate = calcRate > this.maxFastSyncRate ? this.maxFastSyncRate : calcRate;
            } else {
                const calcRate = 1 - (timeDifferenceAbs / deltaTime);
                const minRate = 1 / this.maxFastSyncRate;
                playbackRate = calcRate < minRate ? minRate : calcRate;
            }
            this.video.playbackRate = playbackRate;
            return timeDifference;
        }

        const maxRate = this.performancePatterns[this.currentPattern].maxRate;
        const minRate = 2 - maxRate;
        let playbackRate = 1.0 + finalAdjustment;

        playbackRate = (playbackRate < minRate) ? minRate :
            (playbackRate > maxRate) ? maxRate : playbackRate;

        if (timeDifferenceAbs <= this.synchronizationThreshold) {
            playbackRate = 1.0;
            this.integral = 0;
        }

        if (playbackRate >= 0 || playbackRate <= 0) {
            this.video.playbackRate = playbackRate;
        }

        return timeDifference;
    }


    reset() {
        if (!isActiveMediaWindow()) {
            return;
        }
        this.lastError = 0;
        this.integral = 0;
        this.lastTimeDifference = 0;
        this.lastUpdateTime = performance.now();
        this.isFirstAdjustment = true;
        this.lastWallTime = null;

        this.historyIndex = 0;
        this.historySize = 0;

        this.systemLag = 0;
        this.overshoots = 0;
        this.avgResponseTime = 0;
        this.currentPattern = this.patterns.STABLE;

        this.adaptiveCoefficients = {
            kP: {
                value: 0.6,
                minValue: 0.3,
                maxValue: 0.9,
                adjustmentRate: 0.01
            },
            kI: {
                value: 0.08,
                minValue: 0.02,
                maxValue: 0.2,
                adjustmentRate: 0.005
            },
            kD: {
                value: 0.12,
                minValue: 0.05,
                maxValue: 0.2,
                adjustmentRate: 0.01
            }
        };
    }
}
let pidController;

const PAD = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09'];

const NUM_BUFFER = new Int32Array(4);
const REM_BUFFER = new Int32Array(1);

function isActiveMediaWindow() {
    return isActiveMediaWindowCache;
}

let lastUpdateTimeLocalPlayer = 0;

function getAudioDevices() {
    return navigator.mediaDevices.enumerateDevices().then(devices =>
        devices.reduce((audioOutputs, device) => {
            if (device.kind === 'audiooutput') {
                audioOutputs.push(device);
            }
            return audioOutputs;
        }, [])
    );
}

let audioOutputs = [];
let audioContext = null;
let audioSource = null;


async function changeAudioOutput(deviceIds) {
    if (!video) return;

    // Cleanup existing audio setup
    if (audioOutputs.length) {
        audioOutputs.forEach(audio => {
            audio.pause();
            audio.srcObject = null;
        });
        audioOutputs = [];
    }

    if (audioSource) {
        audioSource.disconnect();
    }

    // Create new audio context if needed
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioSource = audioContext.createMediaElementSource(video);
    }

    // Create outputs for each device
    audioOutputs = await Promise.all(
        deviceIds.map(async deviceId => {
            const dest = audioContext.createMediaStreamDestination();
            const audio = new Audio();
            await audio.setSinkId(deviceId);
            audioSource.connect(dest);
            audio.srcObject = dest.stream;
            await audio.play();
            return audio;
        })
    );
}

function addFilenameToTitlebar(path) {
    document.title = getHostnameOrBasename(path) + " - EMS Media System";
}

function removeFilenameFromTitlebar() {
    document.title = "EMS Media System";
}

function update(time) {
    if (time - lastUpdateTimeLocalPlayer >= 33.33) {
        if (opMode === MEDIAPLAYER) {
            SECONDSFLOAT[0] = video.duration - video.currentTime;
            NUM_BUFFER[0] = ((SECONDSFLOAT[0] | 0) / 3600) | 0;
            REM_BUFFER[0] = (SECONDSFLOAT[0] | 0) % 3600;
            NUM_BUFFER[1] = (REM_BUFFER[0] / 60) | 0;
            NUM_BUFFER[2] = REM_BUFFER[0] % 60;
            NUM_BUFFER[3] = ((SECONDSFLOAT - (SECONDSFLOAT | 0)) * 1000 + 0.5) | 0;
            if (!updatePending[0]) {
                updatePending[0] = 1;
                requestAnimationFrame(updateCountdownNode);
            }
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
}

function updateTimestamp() {
    if (localTimeStampUpdateIsRunning) {
        return;
    }

    if (opMode !== MEDIAPLAYER) {
        localTimeStampUpdateIsRunning = false;
        return;
    }

    if (!video.paused) {
        localTimeStampUpdateIsRunning = true;
        if (!video.paused) {
            requestAnimationFrame(update);
        } else {
            localTimeStampUpdateIsRunning = false;
        }
    }
}

let lastUpdateTime = 0;

const STRING_BUFFER = new Array(20);
const COLON = ':';
const DOT = '.';
const ZERO = '0';
const DOUBLE_ZERO = '00';

function updateCountdownNode() {
    STRING_BUFFER[0] = NUM_BUFFER[0] < 10 ? PAD[NUM_BUFFER[0] & 63] : NUM_BUFFER[0] & 63;
    STRING_BUFFER[1] = COLON;

    STRING_BUFFER[3] = NUM_BUFFER[1] < 10 ? PAD[NUM_BUFFER[1]] : NUM_BUFFER[1];
    STRING_BUFFER[4] = COLON;

    STRING_BUFFER[5] = NUM_BUFFER[2] < 10 ? PAD[NUM_BUFFER[2]] : NUM_BUFFER[2];
    STRING_BUFFER[6] = DOT;
    STRING_BUFFER.length = 7;
    if (NUM_BUFFER[3] < 10) {
        STRING_BUFFER[++STRING_BUFFER.length] = DOUBLE_ZERO;
        STRING_BUFFER[++STRING_BUFFER.length] = NUM_BUFFER[3];
    } else if (NUM_BUFFER[3] < 100) {
        STRING_BUFFER[++STRING_BUFFER.length] = ZERO;
        STRING_BUFFER[++STRING_BUFFER.length] = NUM_BUFFER[3];
    } else {
        STRING_BUFFER[++STRING_BUFFER.length] = NUM_BUFFER[3];
    }

    textNode.data = STRING_BUFFER.join('');
    updatePending[0] = 0;
}

let now = 0;
function handleTimeMessage(_, message) {
    now = Date.now();

    if (opMode === MEDIAPLAYER) {
        SECONDSFLOAT[0] = message[0] - message[1];
        NUM_BUFFER[0] = ((SECONDSFLOAT[0] | 0) / 3600) | 0;
        REM_BUFFER[0] = (SECONDSFLOAT[0] | 0) % 3600;
        NUM_BUFFER[1] = (REM_BUFFER[0] / 60) | 0;
        NUM_BUFFER[2] = REM_BUFFER[0] % 60;
        NUM_BUFFER[3] = ((SECONDSFLOAT - (SECONDSFLOAT | 0)) * 1000 + 0.5) | 0;
        if (!updatePending[0]) {
            updatePending[0] = 1;
            requestAnimationFrame(updateCountdownNode);
        }
    }

    // Perform timestamp calculations only if enough time has passed
    if (now - lastUpdateTime > 500) {
        if (video && !video.paused && !video.seeking) {
            targetTime = message[1] - (((now - message[2]) + (Date.now() - now)) * 0.001);
            hybridSync(targetTime);
            lastUpdateTime = now;
        }
    }
}

async function handlePlaybackState(event, playbackState) {
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
            video.currentTime = playbackState.currentTime;
            await video.pause();
        }
    }
}

function handlePlayPause(event, arg) {
    mediaSessionPause = arg;
}

function handleMediaseek(event, seekTime) {
    if (video) {
        const newTime = video.currentTime + seekTime;
        if (newTime >= 0 && newTime <= video.duration) {
            video.currentTime = newTime;
        }
    }
}

function handleWindowMax(event, isMaximized) {
    document.querySelector('.window-container').classList.toggle('maximized', isMaximized);

}

function installIPCHandler() {
    on('timeRemaining-message', handleTimeMessage);
    on('update-playback-state', handlePlaybackState);
    on('remoteplaypause', handlePlayPause);
    on('media-window-closed', handleMediaWindowClosed);
    on('media-seek', handleMediaseek);
    on('window-maximized', handleWindowMax);
}

async function handleMediaWindowClosed(event, id) {
    if (isLiveStream(mediaFile)) {
        saveMediaFile();
    }

    if (video) {
        if (video.audioTracks.length !== 0) {
            video.audioTracks[0].enabled = true;
        }

        if (video.loop && video.currentTime > 0 &&
            video.duration - video.currentTime < 0.5) {  // Small threshold near end
            startTime = 0;
            targetTime = 0;
            video.currentTime = 0;
            video.play()
            await createMediaWindow();
            return;
        }
    }

    isPlaying = false;
    updateDynUI();
    isActiveMediaWindowCache = false;

    let isImgFile = isImg(mediaFile);
    handleMediaPlayback(isImgFile);

    let imgEle = document.querySelector('img');
    handleImageDisplay(isImgFile, imgEle);

    resetVideoState();
    resetMediaCountdown();

    updatePlayButtonOnMediaWindow();
    masterPauseState = false;
    saveMediaFile();
    removeFilenameFromTitlebar();
    textNode.data = "";
}

function isAudioFile() {
    return opMode === MEDIAPLAYER && video.videoTracks && video.videoTracks.length === 0;
}

function handleMediaPlayback(isImgFile) {
    if (!isImgFile) {
        if (video.src !== window.location.href) {
            waitForMetadata().then(isAudioFile);
        }
        video.src = mediaFile;
    }
}

function handleImageDisplay(isImgFile, imgEle) {
    if (imgEle && !isImgFile) {
        imgEle.remove();
        document.getElementById("preview").style.display = '';
    } else if (isImgFile) {
        if (imgEle) {
            imgEle.src = mediaFile;
        } else {
            if ((imgEle = document.querySelector('img')) !== null) {
                imgEle.remove();
            }
            video.src = '';
            img = document.createElement('img');
            img.src = mediaFile;
            img.setAttribute("id", "preview");
            if (!document.getElementById("preview")) {
                document.getElementById("preview").style.display = 'none';
            }
            document.getElementById("preview").parentNode.appendChild(img);
        }
    }
}

function resetVideoState() {
    if (video !== null) {
        video.pause();
        video.currentTime = 0;
        targetTime = 0;
    }
}

function resetMediaCountdown() {
}

function updatePlayButtonOnMediaWindow() {
    const playButton = document.getElementById("mediaWindowPlayButton");
    if (playButton !== null) {
        updateDynUI();
    } else {
        document.getElementById("MdPlyrRBtnFrmID").addEventListener("click", updateDynUI, { once: true });
    }
}

function resetPIDOnSeek() {
    if (pidController) {
        pidController.integral = 0;
        pidController.lastTimeDifference = 0;
    }
}

function hybridSync(targetTime) {
    if (audioOnlyFile) return;
    if (!isActiveMediaWindow()) return;
    if (!activeLiveStream) {
        pidController.adjustPlaybackRate(targetTime);
    }
}

function isImg(pathname) {
    return imageRegex.test(pathname);
}

function vlCtl(v) {
    if (!audioOnlyFile) {
        send('vlcl', v, 0);
    } else {
        video.volume = v;
    }
}

async function pauseMedia(e) {
    if (activeLiveStream) {
        await send('play-ctl', 'pause');
        return;
    }
    if (video.src === window.location.href || video.readyState === 0) {
        return;
    }

    if (!playingMediaAudioOnly) {
        await send('play-ctl', 'pause');
        invoke('get-media-current-time').then(r => { targetTime = r });
    }
    resetPIDOnSeek();
}

async function unPauseMedia(e) {
    if (activeLiveStream) {
        await send('play-ctl', 'play');
        return;
    }
    if (video.src === window.location.href || video.readyState === 0) {
        return;
    }

    if (!playingMediaAudioOnly && e !== null && e !== undefined && e.target.isConnected) {
        resetPIDOnSeek();
        await send('play-ctl', 'play');
    }
    if (playingMediaAudioOnly && document.getElementById("mediaWindowPlayButton")) {
        updateDynUI();
    }
}

function handleCanPlayThrough(e, resolve) {
    if (video.src === window.location.href) {
        e.preventDefault();
        resolve(video);
        return;
    }
    video.currentTime = 0;
    audioOnlyFile = video.videoTracks && video.videoTracks.length === 0;
    resolve(video);
}

function handleError(e, reject) {
    reject(e);
}

function waitForMetadata() {
    if (!video || !video.src || video.src === window.location.href || isLiveStream(video.src) || isImg(video.src)) {
        playingMediaAudioOnly = false;
        audioOnlyFile = false;
        return Promise.reject("Invalid source or live stream.");
    }

    return new Promise((resolve, reject) => {
        const onCanPlayThrough = (e) => handleCanPlayThrough(e, resolve);
        const onError = (e) => handleError(e, reject);

        video.addEventListener('canplaythrough', onCanPlayThrough, { once: true });
        video.addEventListener('error', onError, { once: true });

        if (video.readyState === 0) {
            video.load();
        }
    });
}

function playMedia(e) {
    if (video) {
        itc = performance.now() * .001;
        startTime = video.currentTime;
    }
    targetTime = startTime;
    if (e === undefined && audioOnlyFile && opMode === MEDIAPLAYER) {
        e = {};
        e.target = document.getElementById("mediaWindowPlayButton");
    }
    fileEnded = false;
    if (opMode === MEDIAPLAYER && mediaFile !== decodeURI(removeFileProtocol(video.src))) {
        saveMediaFile();
    }

    if (video && !audioOnlyFile && video.readyState && video.videoTracks && video.videoTracks.length === 0) {
        audioOnlyFile = true;
    }

    const mdFIle = document.getElementById("mdFile");

    if (video && (mediaFile !== decodeURI(removeFileProtocol(video.src)))) {
        if (isPlaying === false && mdFIle.value === "" && opMode !== MEDIAPLAYER) {
            return;
        }
    }

    if (isImg(mediaFile) && document.getElementById("mdFile").files.length === 0 && video.style.display === 'none') {
        mdFile.files = mediaPlayerInputState.fileInpt;
    }

    if (mdFIle.value === "" && !playingMediaAudioOnly) {
        if (isPlaying) {
            isPlaying = false;
            send('close-media-window', 0);
            saveMediaFile();
            video.currentTime = 0;
            video.pause();
            isPlaying = false;
            updateDynUI();
            localTimeStampUpdateIsRunning = false;
            return;
        } else if (opMode === MEDIAPLAYER && !isPlaying && video.src !== null && video.src !== '' && mediaPlayerInputState.fileInpt != null) {
            let t1 = mediaPlayerInputState.fileInpt[0].name;
            let t2 = getHostnameOrBasename(removeFileProtocol(decodeURI(video.src)))
            if (t1 == null || t2 == null || t1 !== t2) {
                return;
            } else {
                mdFIle.files = mediaPlayerInputState.fileInpt;
            }
        } else {
            return;
        }
    }

    if (!isPlaying) {
        isPlaying = true;
        updateDynUI()
        if (opMode === MEDIAPLAYER) {
            if (isImg(mediaFile)) {
                createMediaWindow();
                video.currentTime = 0;
                if (!video.paused)
                    video.src = '';
                return;
            }
        } else if (opMode === MEDIAPLAYERYT) {
            audioOnlyFile = false;
            createMediaWindow();
            return;
        }
        if (audioOnlyFile) {
            send("localMediaState", 0, "play");
            addFilenameToTitlebar(removeFileProtocol(decodeURI(video.src)));
            isPlaying = true;
            if (document.getElementById("mdLpCtlr"))
                video.loop = document.getElementById("mdLpCtlr").checked;
            playingMediaAudioOnly = true;
            currentMediaFile = mdFIle.files;
            video.play();
            updateTimestamp();
            return;
        }

        currentMediaFile = mdFIle.files;
        createMediaWindow();
    } else {
        startTime = 0;
        isPlaying = false;
        updateDynUI();
        send('close-media-window', 0);
        isActiveMediaWindowCache = false;
        playingMediaAudioOnly = false;
        if (!audioOnlyFile)
            activeLiveStream = true;
        video.pause();
        video.currentTime = 0;
        if (audioOnlyFile) {
            send("localMediaState", 0, "stop");
            removeFilenameFromTitlebar();
            activeLiveStream = false;
            saveMediaFile();

            audioOnlyFile = false;
        }
        localTimeStampUpdateIsRunning = false;
        if (mediaFile !== decodeURI(removeFileProtocol(video.src))) {
            waitForMetadata().then(saveMediaFile).catch(function (rej) { console.log(rej); });
        }
        if (isImg(mediaFile)) {
            saveMediaFile();
        }
    }
    updateDynUI();
}

function updateDynUI() {
    textNode.data = "";
    const playButton = document.getElementById("mediaWindowPlayButton");
    if (playButton) {
        playButton.textContent = isPlaying ? "Stop Presentation" : "Start Presentation";
    }

    if (document.getElementById("dspSelct")) {
        document.getElementById("dspSelct").disabled = (isPlaying && audioOnlyFile);
    }
}

async function populateDisplaySelect() {
    const displaySelect = document.getElementById("dspSelct");
    if (!displaySelect) return;

    displaySelect.addEventListener('change', (event) => {
        send('set-display-index', parseInt(event.target.value));
    });

    try {
        const { displays, defaultDisplayIndex } = await invoke('get-all-displays');

        // Clear existing options except the first disabled one
        while (displaySelect.options.length > 1) {
            displaySelect.remove(1);
        }

        const fragment = document.createDocumentFragment();
        displays.forEach(({ value, label }) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            fragment.appendChild(option);
        });

        displaySelect.appendChild(fragment);
        displaySelect.value = defaultDisplayIndex;

    } catch (error) {
        console.error('Failed to populate display select:', error);
    }
}

function setSBFormYouTubeMediaPlayer() {
    if (opMode === MEDIAPLAYERYT) {
        return;
    }
    opMode = MEDIAPLAYERYT;
    send('set-mode', opMode);

    document.getElementById("dyneForm").innerHTML = `
    <div class="media-container">
        <div class="control-panel">
            <div class="control-group">
                <span class="control-label">URL</span>
                <input type="url" 
                       name="mdFile" 
                       id="mdFile" 
                       placeholder="Paste your video URL here..." 
                       class="url-input"
                       accept="video/mp4,video/x-m4v,video/*,audio/x-m4a,audio/*">
            </div>
    
            <div class="control-group">
                <span class="control-label">Display</span>
                <select name="dspSelct" id="dspSelct" class="display-select">
                    <option value="" disabled>Select Display</option>
                </select>
            </div>

            <div class="control-group">
                <span class="control-label">Volume</span>
                <div class="volume-control">
                    <input
                    id="volume-slider"
                    class="volume-slider"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value="1"
                    >
                </div>
            </div>
        </div>      
    </div>
    `;

    if (mediaFile !== null && isLiveStream(mediaFile)) {
        document.getElementById("mdFile").value = mediaFile;
    }

    document.getElementById("volume-slider").value = streamVolume;
    document.getElementById("volume-slider").addEventListener("input", handleVolumeChange);

    installDisplayChangeHandler();
    populateDisplaySelect();

    document.getElementById("mediaWindowPlayButton").addEventListener("click", playMedia, { passive: true });

    if (playingMediaAudioOnly) {
        isPlaying = true;
        updateDynUI();
        return;
    }
    restoreMediaFile();

    if (document.getElementById("mdFile").value.includes(":\\fakepath\\")) {
        document.getElementById("mdFile").value = '';
    }

    if (!isActiveMediaWindow()) {
        isPlaying = false;
    } else {
        isPlaying = true;
    }
    updateDynUI();
}


async function setSBFormTextPlayer() {
    if (opMode === TEXTPLAYER) {
        return;
    }
    opMode = TEXTPLAYER;
    send('set-mode', opMode);

    document.getElementById("dyneForm").innerHTML = `
        <form onsubmit="return false;">
            <label for="scriptureInput">Scripture:</label>
            <input type="text" id="scriptureInput" class="input-field" placeholder="e.g., Genesis 1:1">
            <ul id="bookSuggestions" style="list-style-type: none; padding: 0; margin-top: 5px; border: 1px solid #ccc; background-color: white; width: 200px; position: absolute; display: none; max-height: 200px; overflow-y: auto;"></ul>
            <div id="versesDisplay" style="width: 1200px;height: 200px; overflow-y: scroll; background-color: #f8f8f8; padding: 10px;"></div>
        </form>
    `;

    const scriptureInput = document.getElementById('scriptureInput');
    const versesDisplay = document.getElementById('versesDisplay');
    const bookSuggestions = document.getElementById('bookSuggestions');
    if (setSBFormTextPlayer.bibleAPIInit == undefined) {
        await bibleAPI.init();
        setSBFormTextPlayer.bibleAPIInit = true;
    }
    const books = bibleAPI.getBooks().sort((a, b) => a.name.localeCompare(b.name));
    const booksById = bibleAPI.getBooks().sort((a, b) => a.id - b.id);

    let selectedIndex = -1;

    scriptureInput.addEventListener('input', function (event) {
        const value = this.value.trim();
        updateBookSuggestions(value);
    });

    scriptureInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            event.preventDefault(); // Prevent form submission
            if (selectedIndex >= 0 && bookSuggestions.children[selectedIndex]) {
                bookSuggestions.children[selectedIndex].click();
            } else {
                scriptureInput.value = normalizeScriptureReference(scriptureInput.value);
                updateVersesDisplay();
            }
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (selectedIndex < bookSuggestions.children.length - 1) {
                selectedIndex++; // Increment to move down in the list
                updateSuggestionsHighlight();
            }
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (selectedIndex > 0) {
                selectedIndex--; // Decrement to move up in the list
                updateSuggestionsHighlight();
            }
        }
    });

    function updateSuggestionsHighlight() {
        Array.from(bookSuggestions.children).forEach((item, index) => {
            if (index === selectedIndex) {
                item.classList.add('highlight');
                item.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); // Ensure the highlighted item is visible
            } else {
                item.classList.remove('highlight');
            }
        });
    }

    let lastHighlighted = null;

    scriptureInput.addEventListener('input', function (event) {
        const value = this.value.trim();
        updateBookSuggestions(value, event);
    });

    scriptureInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            scriptureInput.value = normalizeScriptureReference(scriptureInput.value)
            event.preventDefault(); // Prevent the default form submission
            updateVersesDisplay();
        }
    });

    function normalizeScriptureReference(input) {
        let parts = input.split(' ');
        let normalizedParts = [];

        for (let i = 0; i < parts.length; ++i) {
            let part = parts[i];
            if (part.includes(':')) {
                let subParts = part.split(':');
                subParts = subParts.filter(Boolean);
                normalizedParts.push(subParts.join(':'));
            } else {
                normalizedParts.push(part);
            }
        }

        return normalizedParts.join(' ');
    }

    function parseScriptureReference(input) {
        let tokens = input.split(/\s+/);
        let book = "";
        let chapter = undefined;
        let verse = undefined;

        // Process each token and determine if it's a number or part of a book name
        tokens.forEach((token, index) => {
            if (token.includes(":")) {
                // Handle chapter and verse notation
                const parts = token.split(":");
                chapter = parseInt(parts[0], 10);  // Assume the part before ':' is chapter
                verse = parseInt(parts[1], 10);    // Assume the part after ':' is verse
            } else if (!isNaN(parseInt(token)) && index === tokens.length - 1) {
                // Last token is a number and no verse has been defined, assume it's a chapter
                chapter = parseInt(token, 10);
            } else {
                // Append to book name
                book = book ? `${book} ${token}` : token;
            }
        });

        return { book, chapter, verse };
    }

    function splitOnLastSpace(input) {
        let lastIndex = input.lastIndexOf(' ');

        if (lastIndex === -1) {
            return [input]; // Return the whole string as an array if no space found
        }

        let firstPart = input.substring(0, lastIndex);
        let lastPart = input.substring(lastIndex + 1);

        return [firstPart, lastPart];
    }

    function updateBookSuggestions(input, event) {
        let parts = input.split(/[\s:]+/);
        let bookPart = input.match(/^\d?\s?[a-zA-Z]+/); // Matches any leading number followed by book names
        bookPart = bookPart ? bookPart[0].trim() : ""; // Ensure the match is not null and trim it
        bookSuggestions.innerHTML = '';
        const filteredBooks = books.filter(book =>
            book.name.toLowerCase().startsWith(bookPart.toLowerCase())
        );
        if (filteredBooks.length) {
            if (filteredBooks.length === 1) {
                if (splitOnLastSpace(scriptureInput.value)[0] === filteredBooks[0].name) {
                    return;
                }

                if (event != null && event.inputType === 'insertText') {
                    scriptureInput.value = filteredBooks[0].name + " ";
                    bookSuggestions.style.display = 'none';
                    return;
                }
            }
            bookSuggestions.style.display = 'block';
            filteredBooks.forEach(book => {
                const li = document.createElement('li');
                li.textContent = book.name;
                li.onclick = () => {
                    scriptureInput.value = book.name + (parts.length > 1 ? " " + parts.slice(1).join(" ") : " ");
                    bookSuggestions.style.display = 'none';
                    scriptureInput.focus(); // Refocus on input after selection
                    updateVersesDisplay();
                };
                bookSuggestions.appendChild(li);
            });
        } else {
            bookSuggestions.style.display = 'none';
        }
    }

    function updateVersesDisplay() {
        scriptureInput.value = normalizeScriptureReference(scriptureInput.value);
        const { book, chapter, verse } = parseScriptureReference(scriptureInput.value);

        fetchVerses(book, chapter + "", verse + "");
    }

    function fetchVerses(book, chapter, verse) {
        versesDisplay.innerHTML = ''; // Clear previous verses
        const textData = bibleAPI.getText("KJV", book, chapter);
        if (textData && textData.verses) {
            textData.verses.forEach((verseText, index) => {
                const verseNumber = index + 1;
                const p = document.createElement('p');
                p.innerHTML = `<strong>${chapter}:${verseNumber}</strong> ${verseText}`;
                p.style.cursor = 'pointer';
                p.addEventListener('dblclick', () => {
                    highlightVerse(p);
                    scriptureInput.value = `${book} ${chapter}:${verseNumber}`;
                });
                versesDisplay.appendChild(p);
                if (verse && parseInt(verse) === verseNumber) {
                    highlightVerse(p, true); // Pass true to indicate scrolling is needed
                }
            });
        }
    }

    function highlightVerse(p, scrollToView = false) {
        if (lastHighlighted) {
            lastHighlighted.style.background = ''; // Remove previous highlight
        }
        p.style.background = 'yellow'; // Highlight the new verse
        lastHighlighted = p;
        if ([scrollToView]) {
            p.scrollIntoView({ behavior: 'smooth', block: 'center' }); // Scroll to make the highlighted verse centered
        }
    }

    document.addEventListener('click', function (event) {
        if (!bookSuggestions.contains(event.target) && event.target !== scriptureInput) {
            bookSuggestions.style.display = 'none';
        }
    });
}

function generateMediaFormHTML(video = null) {
    return `
<div class="media-container">
  <form onsubmit="return false;" class="control-panel">
    <div class="control-group">
      <span class="control-label">Media</span>
      <label class="file-input-label">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
        <path 
            fill="none"
            stroke="currentColor" 
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M2.5 2.5h11a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"
        />
        <circle 
            cx="5.5" 
            cy="5.5" 
            r="1" 
            fill="currentColor"
        />
        <path 
            fill="none"
            stroke="currentColor" 
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M3.5 11.5l2.5-2.5c.4-.4 1-.4 1.4 0l2.1 2.1m-1-1l1-1c.4-.4 1-.4 1.4 0l2.1 2.1"
        />
        </svg>
        <span>Open</span>
        <input type="file" class="file-input" name="mdFile" id="mdFile"
               accept="video/mp4,video/x-m4v,video/*,audio/x-m4a,audio/*,image/*">
      </label>
    </div>
    
    <div class="control-group">
      <span class="control-label">Display</span>
      <div class="display-select-group">
        <select name="dspSelct" id="dspSelct" class="display-select">
          <option value="" disabled>--Select Display Device--</option>
        </select>
      </div>
    </div>
    <div class="control-group">
        <div class="control-group">
            <div class="loop-control">
                <span class="control-label">Repeat</span>
                <label class="switch">
                <input type="checkbox" name="mdLpCtlr" id="mdLpCtlr" ${video?.loop ? 'checked' : ''}>
                <span class="switch-track"></span>
                <span class="switch-thumb"></span>
                </label>
            </div>
    </div>
    </div>
    <div id="mediaCntDn"></div>
  </form>

  <div class="video-wrapper">
    <video id="preview" disablePictureInPicture controls></video>
  </div>
</div>`;
}

function installDisplayChangeHandler() {
    if (installDisplayChangeHandler.initialized) return;

    on('display-changed', async () => {
        await populateDisplaySelect();
    });

    installDisplayChangeHandler.initialized = true;
}

function loopCtlHandler(event) {
    video.loop = event.target.checked;
    if (isActiveMediaWindow()) {
        invoke('set-media-loop-status', event.target.checked);
    }
}

function setSBFormMediaPlayer() {
    if (opMode === MEDIAPLAYER) {
        return;
    }
    opMode = MEDIAPLAYER;
    send('set-mode', opMode);
    document.getElementById("dyneForm").innerHTML = generateMediaFormHTML(video);
    mediaCntDn.appendChild(textNode);
    mediaCntDn.style.color = "#5c87b2";
    installDisplayChangeHandler();
    populateDisplaySelect();

    if (video === null) {
        video = document.getElementById('preview');
    }

    if (mediaFile) {
        const fileNameSpan = document.querySelector('.file-input-label span');
        if (fileNameSpan) {
            fileNameSpan.textContent = getHostnameOrBasename(mediaFile);
        }
    }

    if (isLiveStream(document.querySelector('.file-input-label span').innerText)) {
        document.querySelector('.file-input-label span').innerText = 'Open';
    }

    restoreMediaFile();
    updateTimestamp();

    const loopctl = document.getElementById("mdLpCtlr");
    if (video.loop === true) {
        document.getElementById("mdLpCtlr").checked = true
    }
    loopctl.addEventListener('change', loopCtlHandler);

    const mdFile = document.getElementById("mdFile");
    mdFile.addEventListener("change", saveMediaFile);
    const isActiveMW = isActiveMediaWindow();
    let plyBtn = document.getElementById("mediaWindowPlayButton");
    if (!isActiveMW && !playingMediaAudioOnly) {
        isPlaying = false;
    } else {
        isPlaying = true;
        if (typeof currentMediaFile === 'undefined') {
            currentMediaFile = mdFile.files
        } else {
            mdFile.files = currentMediaFile;
        }
    }
    updateDynUI();
    plyBtn.addEventListener("click", playMedia);
    let isImgFile;
    if (mdFile !== null) {
        if (document.getElementById("preview").parentNode !== null) {
            if (!masterPauseState && video !== null && !video.paused) {
                if (!isImg(mediaFile)) {
                    video.play();
                }
            }
            if (video !== null) {
                if (!isActiveMW) {
                    if (!mdFile.value.includes("fake")) {
                        mediaFile = mdFile.value;
                    } else {
                        mediaFile = document.getElementById("YtPlyrRBtnFrmID").checked === true ? mdFile.value : getPathForFile(mdFile.files[0]);
                    }
                }
                const isImgFile = isImg(mediaFile);
                if (isActiveMW && mediaFile !== null && !isLiveStream(mediaFile)) {
                    if (video === null) {
                        video = document.getElementById("preview");
                        saveMediaFile();
                    }
                    if (video) {
                        if (targetTime !== null) {
                            if (!masterPauseState && !isImgFile) {
                                video.play();
                            }
                        }
                    }
                }
                document.getElementById("preview").parentNode.replaceChild(video, document.getElementById("preview"));
            }
        }

        if (isImgFile && !document.querySelector('img')) {
            img = document.createElement('img');
            video.src = '';
            img.src = mediaFile;
            img.setAttribute("id", "preview");
            document.getElementById("preview").style.display = 'none';
            document.getElementById("preview").parentNode.appendChild(img);
            return;
        }
    }
    if (encodeURI(mediaFile) !== removeFileProtocol(video.src)) {
        saveMediaFile();
    }

    if (isImg(mediaFile)) {
        document.getElementById("preview").parentNode.appendChild(img);
    }
    //console.timeEnd("start");
}

function removeFileProtocol(filePath) {
    return filePath.slice(7);
}

function saveMediaFile() {
    textNode.data = "";
    const mdfileElement = document.getElementById("mdFile");
    if (!mdfileElement) {
        return;
    }

    if (mdfileElement.files !== null && mdfileElement.files.length !== 0 && encodeURI(getPathForFile(mdfileElement.files[0])) === removeFileProtocol(video.src)) {
        return;
    }

    if (playingMediaAudioOnly && opMode === MEDIAPLAYER) {
        if (mdfileElement.files[0].length === 0) {
            return;
        }
        mediaFile = getPathForFile(mdfileElement.files[0]);
        return;
    }

    if (mdfileElement !== null && mdfileElement !== 'undefined') {
        if (mdfileElement.files !== null && mdfileElement.files.length === 0) {
            return;
        } else if (mdfileElement.value === "") {
            return;
        }

        mediaPlayerInputState.clear();

        mediaPlayerInputState.fileInpt = mdfileElement.files;
        mediaPlayerInputState.urlInpt = mdfileElement.value.toLowerCase();
    }
    const isActiveMW = isActiveMediaWindow();
    if (isActiveMW) {
        return;
    }

    mediaFile = opMode === MEDIAPLAYERYT ? document.getElementById("mdFile").value : getPathForFile(document.getElementById("mdFile").files[0]);

    if (mediaFile) {
        const fileNameSpan = document.querySelector('.file-input-label span');
        if (fileNameSpan) {
            fileNameSpan.textContent = getHostnameOrBasename(mediaFile);
        }
    }

    let imgEle = null;
    if (imgEle = document.querySelector('img')) {
        imgEle.remove();
        document.getElementById("preview").style.display = '';
    }
    let iM;
    if ((iM = isImg(mediaFile))) {
        playingMediaAudioOnly = false;
        audioOnlyFile = false;
    }

    if (iM && !document.querySelector('img') && (!isActiveMW)) {
        let imgEle = null;
        if ((imgEle = document.querySelector('img')) !== null) {
            imgEle.remove();
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
        return;
    }
    let liveStream = isLiveStream(mediaFile);
    if ((mdfileElement !== null && (!isActiveMW && mdfileElement !== null &&
        !(liveStream))) || (isActiveMW && mdfileElement !== null && liveStream) || activeLiveStream && isActiveMW) {
        if (video === null) {
            video = document.getElementById('preview');
        }
        if (video) {
            if (mdfileElement !== null && mdfileElement.files && prePathname !== mediaFile) {
                prePathname = mediaFile;
                startTime = 0;
            }
            if (!playingMediaAudioOnly && mdfileElement.files) {
                let uncachedLoad;
                if (uncachedLoad = (mediaFile !== decodeURI(removeFileProtocol(video.src)))) {
                    video.setAttribute("src", mediaFile);
                }
                video.id = "preview";
                video.currentTime = startTime;
                video.controlsList = "noplaybackrate";
                if (document.getElementById("mdLpCtlr") !== null) {
                    video.loop = document.getElementById("mdLpCtlr").checked;
                }
                if (uncachedLoad) {
                    video.load();
                }
            }
        }
    }
}

function restoreMediaFile() {
    if (mediaPlayerInputState.fileInpt != null && document.getElementById("mdFile") != null) {
        if (document.getElementById("YtPlyrRBtnFrmID") != null && document.getElementById("YtPlyrRBtnFrmID").checked) {
            document.getElementById("mdFile").value = mediaPlayerInputState.urlInpt;
        } else {
            document.getElementById("mdFile").files = mediaPlayerInputState.fileInpt;
        }
    }
}

function fileOpenShortcutHandler(event) {
    if ((event.ctrlKey || event.metaKey) && (event.key === 'o' || event.key === 'O')) {
        if (document.getElementById("mdFile")) {
            document.getElementById("mdFile").click();
        }
    }
}

function appCloseShortcutHandler(event) {
    if ((event.ctrlKey || event.metaKey) && (event.key === 'q' || event.key === 'Q')) {
        close();
    }
}

function modeSwitchHandler(event) {
    if (event.target.type === 'radio') {
        if (event.target.value === 'Media Player') {
            installPreviewEventHandlers();
            updateTimestamp();
        }
    }
}

function cleanRefs() {
    let vsl = document.getElementById("volume-slider");
    if (vsl) {
        vsl.removeEventListener("input", handleVolumeChange);
    }

    let playButton = document.querySelector("#mediaWindowPlayButton");
    if (playButton) {
        playButton.removeEventListener("click", playMedia);
        playButton = null;
    }

    let loopctl = document.getElementById("mdLpCtlr");
    if (loopctl) {
        loopctl.removeEventListener("change", loopCtlHandler);
        loopctl = null;
    }

    let mdFile = document.getElementById("mdFile");
    if (mdFile) {
        mdFile.removeEventListener("change", saveMediaFile);
    }
    let mcd = document.getElementById("mediaCntDn");
    if (mcd && mcd.contains(textNode)) {
        mcd.removeChild(textNode);
    }
    document.getElementById("dyneForm").innerHTML = '';
}

function installEvents() {
    document.getElementById("MdPlyrRBtnFrmID").addEventListener('click', () => {
        if (opMode === MEDIAPLAYER) {
            return;
        }
        cleanRefs();
        setSBFormMediaPlayer();
    }, { passive: true });

    document.getElementById("YtPlyrRBtnFrmID").addEventListener('click', () => {
        if (opMode === MEDIAPLAYERYT) {
            return;
        }
        cleanRefs();
        setSBFormYouTubeMediaPlayer();
    }, { passive: true });

    //document.getElementById("TxtPlyrRBtnFrmID").onclick = setSBFormTextPlayer;

    document.addEventListener('keydown', fileOpenShortcutHandler);
    document.addEventListener('keydown', appCloseShortcutHandler);

    document.querySelector('form').addEventListener('change', modeSwitchHandler, { passive: true });
}

function playAudioFileAfterDelay() {
    video.play();
    updateTimestamp();
}

function playLocalMedia(event) {
    if (!isActiveMediaWindow()) {
        if (video.audioTracks.length !== 0) {
            video.audioTracks[0].enabled = true;
        }
    }
    mediaSessionPause = false;
    if (!audioOnlyFile && video.readyState && video.videoTracks && video.videoTracks.length === 0) {
        audioOnlyFile = true;
    }
    if (audioOnlyFile) {
        send("localMediaState", 0, "play");
        addFilenameToTitlebar(removeFileProtocol(decodeURI(video.src)));
        isPlaying = true;
        updateDynUI();
        updateTimestamp();
        if (!playingMediaAudioOnly) {
            let t1 = encodeURI(mediaPlayerInputState.fileInpt[0].name);
            let t2 = removeFileProtocol(video.src).split(/[\\/]/).pop();
            if (t1 != null && t2 != null && t1 === t2) {
                document.getElementById("mdFile").files = mediaPlayerInputState.fileInpt;
            }
        }
    }
    if (isActiveMediaWindow()) {
        unPauseMedia(event);
        return;
    }

    let mediaScrnPlyBtn = document.getElementById("mediaWindowPlayButton");
    if (mediaScrnPlyBtn && audioOnlyFile) {
        if (isPlaying) {
            fileEnded = false;
            if (document.getElementById("mdLpCtlr")) {
                video.loop = document.getElementById("mdLpCtlr").checked;
            }
            audioOnlyFile = true;
            playingMediaAudioOnly = true;
            updateTimestamp();
            return;
        }
    }
    if (isImg(video.src)) {
        return;
    }
    if (video.src === window.location.href) {
        event.preventDefault();
        return;
    }
    masterPauseState = false;
    if (isImg(video.src)) {
        audioOnlyFile = false;
        playingMediaAudioOnly = false;
    } else {
        updateTimestamp();
        if (audioOnlyFile) {
            if (document.getElementById("mdLpCtlr")) {
                video.loop = document.getElementById("mdLpCtlr").checked;
            }
            if (document.getElementById('volumeControl')) {
                video.volume = document.getElementById('volumeControl').value;
            }
            playingMediaAudioOnly = true;
            return;
        }
    }
}

function loadLocalMediaHandler(event) {
    if (pidController) {
        pidController.reset();
    }
    if (video.src === window.location.href) {
        event.preventDefault();
        return;
    }
}

function loadedmetadataHandler(e) {
    if (video.src === window.location.href || isImg(video.src)) {
        return;
    }
    audioOnlyFile = video.videoTracks && video.videoTracks.length === 0;
}

function seekLocalMedia(e) {
    if (pidSeeking) {
        pidSeeking = false;
        e.preventDefault();
    } else {
        pidController.reset();
    }
    if (video.src === window.location.href) {
        e.preventDefault();
        return;
    }
    if (e.target.isConnected) {
        send('timeGoto-message', { currentTime: e.target.currentTime, timestamp: Date.now() });
        invoke('get-media-current-time').then(r => { targetTime = r });
    }
}

function seekingLocalMedia(e) {
    if (pidSeeking) {
        pidSeeking = false;
        e.preventDefault();
    } else {
        pidController.reset();
    }
    if (e.target.isConnected) {
        send('timeGoto-message', { currentTime: e.target.currentTime, timestamp: Date.now() });
        invoke('get-media-current-time').then(r => { targetTime = r });
    }
}

function endLocalMedia() {
    textNode.data = "";
    if (video.loop && video.currentTime >= video.duration) {
        video.currentTime = 0;
        playLocalMedia();
        return;
    }

    isPlaying = false;
    updateDynUI();
    audioOnlyFile = false;
    if (document.getElementById("mediaWindowPlayButton")) {
        updateDynUI();
    }
    if (playingMediaAudioOnly) {
        video.src = '';
        playingMediaAudioOnly = false;

        if (video !== null) {
            video.currentTime = 0;
        }

        if (document.getElementById("mediaWindowPlayButton") !== null) {
            updateDynUI();
        } else {
            document.getElementById("MdPlyrRBtnFrmID").addEventListener("click", function () {
                updateDynUI();
            }, { once: true });
        }
        masterPauseState = false;
        saveMediaFile();
    }
    targetTime = 0;
    fileEnded = true;
    send("localMediaState", 0, "stop");
    send('close-media-window', 0);
    removeFilenameFromTitlebar();
    video.pause();
    masterPauseState = false;
    resetPIDOnSeek();
    localTimeStampUpdateIsRunning = false;
}

function pauseLocalMedia(event) {
    if (mediaSessionPause) {
        invoke('get-media-current-time').then(r => { targetTime = r });
        return;
    }
    if (fileEnded) {
        fileEnded = false;
        return;
    }
    if (!event.target.isConnected) {
        if ((!isActiveMediaWindow()) && playingMediaAudioOnly === false) {
            return;
        }
        event.preventDefault();
        video.play().then(() => {
            isPlaying = true;
            updateDynUI();
        }).catch(error => {
            playingMediaAudioOnly = false;
        });

        masterPauseState = false;
        return;
    }
    if (event.target.clientHeight === 0) {
        event.preventDefault();
        event.target.play(); //continue to play even if detached
        return;
    }
    if (video.src === window.location.href) {
        event.preventDefault();
        return;
    }
    if (activeLiveStream) {
        return;
    }
    if (video.currentTime - video.duration === 0) {
        return;
    }
    if (event.target.parentNode !== null) {
        if (isActiveMediaWindow()) {
            pauseMedia();
            masterPauseState = true;
        }
    }
}

function handleVolumeChange(event) {
    if (event.target.id === 'volume-slider' && !isLiveStream(mediaFile)) {
        return;
    }
    if (opMode === MEDIAPLAYERYT) {
        streamVolume = event.target.value;
        vlCtl(streamVolume);
        return;
    }
    event.target.muted ? vlCtl(0) : vlCtl(event.target.volume);
}

function installPreviewEventHandlers() {
    if (!installPreviewEventHandlers.installedVideoEventListener) {
        video.addEventListener('loadstart', loadLocalMediaHandler);
        video.addEventListener('loadedmetadata', loadedmetadataHandler);
        video.addEventListener('seeked', seekLocalMedia);
        video.addEventListener('seeking', seekingLocalMedia);
        video.addEventListener('ended', endLocalMedia);
        video.addEventListener('pause', pauseLocalMedia);
        video.addEventListener('play', playLocalMedia);
        video.addEventListener('volumechange', handleVolumeChange);
        pidController = new PIDController(video);
        installPreviewEventHandlers.installedVideoEventListener = true;
    }
}

function loadOpMode(mode) {
    if (mode === MEDIAPLAYERYT) {
        document.getElementById("YtPlyrRBtnFrmID").checked = true;
        setSBFormYouTubeMediaPlayer();
    } else if (mode === TEXTPLAYER) {
        document.getElementById("TxtPlyrRBtnFrmID").checked = true;
        setSBFormTextPlayer();
    } else {
        document.getElementById("MdPlyrRBtnFrmID").checked = true;
        setSBFormMediaPlayer();
        installPreviewEventHandlers();
    }
}

function isLiveStream(mediaFile) {
    if (mediaFile === undefined || mediaFile === null) {
        return false;
    }
    return /(?:m3u8|mpd|youtube\.com|videoplayback|youtu\.be)/i.test(mediaFile);
}

async function createMediaWindow() {
    let ts = await invoke('get-system-time');
    let birth = ts.systemTime + ((Date.now() - ts.ipcTimestamp)*.001) +((performance.now()*.001)-itc)+'';
    mediaFile = opMode === MEDIAPLAYERYT ? document.getElementById("mdFile").value : getPathForFile(document.getElementById("mdFile").files[0]);
    var liveStreamMode = isLiveStream(mediaFile);
    var selectedIndex = document.getElementById("dspSelct").selectedIndex - 1;
    activeLiveStream = liveStreamMode;

    if (liveStreamMode === true) {
        if (video && !isImg(video.src)) {
            video.src = '';
        }
    }

    const isImgFile = isImg(mediaFile);

    if (audioOnlyFile && !isActiveMediaWindow()) {
        video.loop = document.getElementById("mdLpCtlr").checked;
        if (!isImgFile) {
            await video.play();
        } else {
            video.src = '';
        }
        playingMediaAudioOnly = true;
        if (playingMediaAudioOnly)
            updateTimestamp();
        return;
    } else {
        playingMediaAudioOnly = false;
    }
    let strtVl = 0;
    if (opMode === MEDIAPLAYER) {
        strtVl = video.volume;
    } else {
        strtVl = streamVolume;
    }

    if (liveStreamMode === false && video !== null) {
        startTime = video.currentTime;
    }

    const windowOptions = {
        webPreferences: {
            v8CacheOptions: 'bypassHeatCheckAndEagerCompile',
            contextIsolation: true,
            sandbox: true,
            enableWebSQL: false,
            webgl: false,
            additionalArguments: [
                '__mediafile-ems=' + encodeURIComponent(mediaFile),
                startTime !== 0 ? '__start-time=' + startTime : "",
                strtVl !== 1 ? '__start-vol=' + strtVl : "",
                document.getElementById("mdLpCtlr") !== null ? (document.getElementById("mdLpCtlr").checked ? '__media-loop=true' : '') : "",
                liveStreamMode ? '__live-stream=' + liveStreamMode : '', isImgFile ? "__isImg" : "", birth
            ],
            preload: `${__dirname}/media_preload.js`
        }
    };

    await invoke('create-media-window', windowOptions, selectedIndex);
    isActiveMediaWindowCache = true;

    if (pidController) {
        pidController.reset();
    }

    if (video) {
        if (video.audioTracks && video.audioTracks[0]) {
            video.audioTracks[0].enabled = false;
        } else {
            video.addEventListener('loadedmetadata', () => {
                if (video.audioTracks.length !== 0) {
                    video.audioTracks[0].enabled = false;
                }
            }, { once: true });
        }

        if (video.audioTracks.length !== 0 && video.audioTracks[0]) {
            video.audioTracks[0].enabled = false;
        }
        video.muted = false;
    }
    pidSeeking = true;
    unPauseMedia();
    if (opMode !== MEDIAPLAYERYT) {
        if (video !== null && !isImgFile) {
            pidSeeking = true;
            await video.play();
        }
    }

    if (video) {
        addFilenameToTitlebar(removeFileProtocol(decodeURI(video.src)));
    }
}

installIPCHandler();
installEvents();
invoke('get-setting', "operating-mode").then(loadOpMode);
