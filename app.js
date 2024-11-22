"use strict";
//console.time("start");
//Project Alchemy
//Devel
//Copyright 2019 - 2024 Christian Lockley

const { ipcRenderer, __dirname, bibleAPI, webUtils } = window.electron;

var dontSyncRemote = false;
var pidSeeking = false;
var video = null;
var masterPauseState = false;
var activeLiveStream = false;
var targetTime = 0;
var startTime = 0;
var prePathname = '';
var savedCurTime = '';
var playingMediaAudioOnly = false;
var audioOnlyFile = false;
var CrVL = 1;
var opMode = -1;
var osName = navigator.userAgentData.platform;
var localTimeStampUpdateIsRunning = false;
var mediaFile;
var currentMediaFile;
var fileEnded = false;
var dyneForm = null;
var mediaSessionPause = false;
let isPlaying = false;
let img = null;
const MEDIAPLAYER = 0, MEDIAPLAYERYT = 1, BULKMEDIAPLAYER = 5, TEXTPLAYER = 6;
const imageRegex = /\.(bmp|gif|jpe?g|png|webp|svg|ico)$/i;
let isActiveMediaWindowCache = false;
const SECONDS = new Int32Array(1);
const SECONDSFLOAT = new Float64Array(1);
const textNode = document.createTextNode('');

const updatePending = new Int32Array(1);

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

        this.performanceHistory = [];
        this.systemLag = 0;
        this.overshoots = 0;
        this.avgResponseTime = 0;
        this.currentPattern = this.patterns.STABLE;

        this.lastWallTime = null;
        this.maxTimeGap = 1000;

        this.synchronizationThreshold = 0.005;
        this.maxIntegralError = 0.5;
        this.fastSyncThreshold = 1; // Trigger fast sync if the absolute time difference is greater than 1 second
        this.maxFastSyncRate = 2; // Maximum speed-up rate for fast sync

        this.maxHistoryLength = 30;
        this.isFirstAdjustment = true;
        this.reset();
    }

    responseTimeReducer(acc, curr) {
        acc + curr.responseTime;
    }

    timeDifferenceReducer(acc, curr) {
        acc + curr.timeDifference;
    }

    updateSystemMetrics(timeDifference, timestamp) {
        if (this.performanceHistory.length >= this.maxHistoryLength) {
            this.performanceHistory.shift();
        }

        this.performanceHistory.push({
            timeDifference,
            timestamp,
            responseTime: this.performanceHistory.length > 1
                ? timestamp - this.performanceHistory[this.performanceHistory.length - 2].timestamp
                : 0
        });

        if (this.performanceHistory.length >= 10) {
            let variance = 0;
            let trend = 0;
            let sumTimeDifference = 0;
            let previousTimeDiff = this.performanceHistory[this.performanceHistory.length - 11]?.timeDifference || 0;

            for (let i = this.performanceHistory.length - 10; i < this.performanceHistory.length; i++) {
                const currentTimeDiff = this.performanceHistory[i].timeDifference;
                sumTimeDifference += currentTimeDiff;
                variance += currentTimeDiff * currentTimeDiff;  // Squared differences for variance

                if (i > this.performanceHistory.length - 10) {
                    trend += currentTimeDiff - previousTimeDiff;  // Calculate the trend
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
        if (this.performanceHistory.length < 10) return;

        let variance = 0;
        let trend = 0;
        let sumOfDifferences = 0;
        let previousTimeDiff = this.performanceHistory[this.performanceHistory.length - 11]?.timeDifference || 0;

        for (let i = this.performanceHistory.length - 10; i < this.performanceHistory.length; i++) {
            const currentTimeDiff = this.performanceHistory[i].timeDifference;
            sumOfDifferences += currentTimeDiff;
            variance += currentTimeDiff * currentTimeDiff;  // Squared differences for variance

            if (i > this.performanceHistory.length - 10) {
                trend += currentTimeDiff - previousTimeDiff;  // Calculate the trend
            }

            previousTimeDiff = currentTimeDiff;
        }

        const mean = sumOfDifferences / 10;
        variance = (variance / 10) - (mean * mean);

        trend = trend / 9;  // Dividing by 9 because trend is the sum of 9 differences between consecutive values

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
                // Replace Math.min with ternary operators
                this.adaptiveCoefficients.kP.value = (this.adaptiveCoefficients.kP.value + this.adaptiveCoefficients.kP.adjustmentRate > this.adaptiveCoefficients.kP.maxValue) ?
                    this.adaptiveCoefficients.kP.maxValue : this.adaptiveCoefficients.kP.value + this.adaptiveCoefficients.kP.adjustmentRate;
                this.adaptiveCoefficients.kI.value = (this.adaptiveCoefficients.kI.value + this.adaptiveCoefficients.kI.adjustmentRate > this.adaptiveCoefficients.kI.maxValue) ?
                    this.adaptiveCoefficients.kI.maxValue : this.adaptiveCoefficients.kI.value + this.adaptiveCoefficients.kI.adjustmentRate;
                this.adaptiveCoefficients.kD.value = (this.adaptiveCoefficients.kD.value + this.adaptiveCoefficients.kD.adjustmentRate > this.adaptiveCoefficients.kD.maxValue) ?
                    this.adaptiveCoefficients.kD.maxValue : this.adaptiveCoefficients.kD.value + this.adaptiveCoefficients.kD.adjustmentRate;
                break;
            case OSCILLATING:
                // Replace Math.max/min with ternary operators
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

    calculateVariance(values) {
        let sum = 0;
        let varianceSum = 0;
        const length = values.length;

        for (let i = 0; i < length; i++) {
            const value = values[i];
            sum += value;
            varianceSum += value * value;
        }

        const mean = sum / length;
        return (varianceSum / length) - (mean * mean);
    }

    calculateTrend(values) {
        let trend = 0;
        for (let i = 1; i < values.length; i++) {
            trend += values[i] - values[i - 1];
        }
        return trend / values.length;
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

        const historicalAdjustment = this.calculateHistoricalAdjustment(timeDifference, deltaTime);
        let finalAdjustment = historicalAdjustment;

        if (timeDifferenceAbs > this.fastSyncThreshold) {
            if (timeDifference > 0) {
                const fastSyncRate = (this.maxFastSyncRate < 1 + (timeDifferenceAbs / deltaTime)) ?
                    this.maxFastSyncRate : 1 + (timeDifferenceAbs / deltaTime);
                this.video.playbackRate = fastSyncRate;
            } else {
                const fastSyncRate = (1 / this.maxFastSyncRate > 1 - (timeDifferenceAbs / deltaTime)) ?
                    1 / this.maxFastSyncRate : 1 - (timeDifferenceAbs / deltaTime);
                this.video.playbackRate = fastSyncRate;
            }
            return timeDifference;
        }

        const currentSettings = this.performancePatterns[this.currentPattern];
        const maxRate = currentSettings.maxRate;
        const minRate = 2 - maxRate;
        let playbackRate = 1.0 + finalAdjustment;

        playbackRate = (playbackRate < minRate) ? minRate :
            (playbackRate > maxRate) ? maxRate : playbackRate;

        if (timeDifferenceAbs <= this.synchronizationThreshold) {
            playbackRate = 1.0;
            this.integral = 0;
        }

        if (playbackRate === playbackRate) {
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

        this.performanceHistory = [];
        this.overshoots = 0;
        this.systemLag = 0;
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

async function getAudioDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioOutputs = devices.filter(device => device.kind === 'audiooutput');
    return audioOutputs;
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

const basename = (input) => {
    const urlMatch = input.match(/^(?:https?:\/\/)?(?:www\.)?([^/]+)/);
    if (urlMatch) return urlMatch[1];

    const uncMatch = input.match(/^\\\\[^\\]+\\[^\\]+/);
    if (uncMatch) return input.split(/[/\\]/).pop();

    return input.replace(/^[A-Z]:/i, '').split(/[/\\]/).pop();
};

function addFilenameToTitlebar(path) {
    document.title = basename(path) + " - EMS Media System";
}

function removeFilenameFromTitlebar() {
    document.title = "EMS Media System";
}

function updateTextNode() {
    textNode.data = `${NUM_BUFFER[0] < 10 ? PAD[NUM_BUFFER[0]] : NUM_BUFFER[0]}:${NUM_BUFFER[1] < 10 ? PAD[NUM_BUFFER[1]] : NUM_BUFFER[1]}:${NUM_BUFFER[2] < 10 ? PAD[NUM_BUFFER[2]] : NUM_BUFFER[2]}.${NUM_BUFFER[3] < 10 ? '00' : NUM_BUFFER[3] < 100 ? '0' : ''}${NUM_BUFFER[3]}`;
    updatePending[0] = 0;
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
                requestAnimationFrame(updateTextNode);
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

function updateTimestampUI(currentMessage) {
    if (opMode !== MEDIAPLAYER) {
        return;
    }
    if (!updatePending[0]) {
        updatePending[0] = 1;
        requestAnimationFrame(() => {
            textNode.data = currentMessage;
            updatePending[0] = 0;
        });
    }
}

const boundUpdateTimestampUI = (message) => updateTimestampUI(message);
let lastUpdateTime = 0;

function handleTimeMessage(_, message) {
    const now = Date.now();

    if (opMode === MEDIAPLAYER) {
        SECONDSFLOAT[0] = message[0];
        NUM_BUFFER[0] = ((SECONDSFLOAT[0] | 0) / 3600) | 0;
        REM_BUFFER[0] = (SECONDSFLOAT[0] | 0) % 3600;
        NUM_BUFFER[1] = (REM_BUFFER[0] / 60) | 0;
        NUM_BUFFER[2] = REM_BUFFER[0] % 60;
        NUM_BUFFER[3] = ((SECONDSFLOAT - (SECONDSFLOAT | 0)) * 1000 + 0.5) | 0;
        requestAnimationFrame(() => boundUpdateTimestampUI(`${NUM_BUFFER[0] < 10 ? PAD[NUM_BUFFER[0]] : NUM_BUFFER[0]}:${NUM_BUFFER[1] < 10 ? PAD[NUM_BUFFER[1]] : NUM_BUFFER[1]}:${NUM_BUFFER[2] < 10 ? PAD[NUM_BUFFER[2]] : NUM_BUFFER[2]}.${NUM_BUFFER[3] < 10 ? '00' : NUM_BUFFER[3] < 100 ? '0' : ''}${NUM_BUFFER[3]}`));
    }

    // Perform timestamp calculations only if enough time has passed
    if (now - lastUpdateTime > 500) {
        if (video && !video.paused && !video.seeking) {
            targetTime = message[2] - (((now - message[3]) + (Date.now() - now)) * 0.001);
            hybridSync(targetTime);
            lastUpdateTime = now;
        }
    }
}

function installIPCHandler() {
    ipcRenderer.on('timeRemaining-message', handleTimeMessage);

    ipcRenderer.on('update-playback-state', async (event, playbackState) => {
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
    });

    ipcRenderer.on('remoteplaypause', (_, arg) => {
        mediaSessionPause = arg;
    });

    ipcRenderer.on('media-window-closed', handleMediaWindowClosed);
}

async function handleMediaWindowClosed(event, id) {
    if (isLiveStream(mediaFile)) {
        saveMediaFile();
    }

    video.audioTracks[0].enabled = true;
    if (video.loop && video.currentTime > 0 &&
        video.duration - video.currentTime < 0.5) {  // Small threshold near end
        startTime = 0;
        targetTime = 0;
        video.currentTime = 0;
        video.play()
        await createMediaWindow();
        return;
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
        ipcRenderer.send('vlcl', v, 0);
    } else {
        video.volume = v;
    }
}

async function pauseMedia(e) {
    if (activeLiveStream) {
        await ipcRenderer.send('play-ctl', 'pause');
        return;
    }
    if (video.src === window.location.href || video.readyState === 0) {
        return;
    }

    if (!playingMediaAudioOnly) {
        await ipcRenderer.send('play-ctl', 'pause');
        ipcRenderer.invoke('get-media-current-time').then(r => { targetTime = r });
    }
    resetPIDOnSeek();
}

async function unPauseMedia(e) {
    if (activeLiveStream) {
        await ipcRenderer.send('play-ctl', 'play');
        return;
    }
    if (video.src === window.location.href || video.readyState === 0) {
        return;
    }

    if (!playingMediaAudioOnly && e !== null && e !== undefined && e.target.isConnected) {
        resetPIDOnSeek();
        await ipcRenderer.send('play-ctl', 'play');
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
    startTime = video.currentTime;
    targetTime = startTime;
    if (e === undefined && audioOnlyFile && opMode === MEDIAPLAYER) {
        e = {};
        e.target = document.getElementById("mediaWindowPlayButton");
    }
    fileEnded = false;
    if (opMode === MEDIAPLAYER && mediaFile !== decodeURI(removeFileProtocol(video.src))) {
        saveMediaFile();
    }

    if (!audioOnlyFile && video.readyState && video.videoTracks && video.videoTracks.length === 0) {
        audioOnlyFile = true;
    }

    const mdFIle = document.getElementById("mdFile");

    if (mediaFile !== decodeURI(removeFileProtocol(video.src))) {
        if (isPlaying === false && mdFIle.value === "" && opMode !== MEDIAPLAYER) {
            return;
        }
    }

    if (mdFIle.value === "" && !playingMediaAudioOnly) {
        if (isPlaying) {
            isPlaying = false;
            ipcRenderer.send('close-media-window', 0);
            saveMediaFile();
            video.currentTime = 0;
            video.pause();
            isPlaying = false;
            updateDynUI();
            localTimeStampUpdateIsRunning = false;
            return;
        } else if (!isPlaying && video.src !== null && video.src !== '' && saveMediaFile.fileInpt != null) {
            let t1 = saveMediaFile.fileInpt[0].name;
            let t2 = basename(removeFileProtocol(decodeURI(video.src)))
            if (t1 == null || t2 == null || t1 !== t2) {
                return;
            } else {
                mdFIle.files = saveMediaFile.fileInpt;
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
            ipcRenderer.send("localMediaState", 0, "play");
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
        dontSyncRemote = false;
    } else {
        startTime = 0;
        isPlaying = false;
        updateDynUI();
        ipcRenderer.send('close-media-window', 0);
        isActiveMediaWindowCache = false;
        playingMediaAudioOnly = false;
        dontSyncRemote = true;
        if (!audioOnlyFile)
            activeLiveStream = true;
        video.pause();
        video.currentTime = 0;
        if (audioOnlyFile) {
            ipcRenderer.send("localMediaState", 0, "stop");
            removeFilenameFromTitlebar();
            activeLiveStream = false;
            saveMediaFile();

            audioOnlyFile = false;
        }
        localTimeStampUpdateIsRunning = false;
        if (mediaFile !== decodeURI(removeFileProtocol(video.src))) {
            waitForMetadata().then(saveMediaFile);
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
        ipcRenderer.send('set-display-index', parseInt(event.target.value));
    });

    try {
        const { displays, defaultDisplayIndex } = await ipcRenderer.invoke('get-all-displays');

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
    ipcRenderer.send('set-mode', opMode);

    dyneForm.innerHTML =
        `
        <form onsubmit="return false;">
        <input type="url" name="mdFile" id="mdFile" placeholder="Paste your video URL here..." style="width: 80%; padding: 15px; font-size: 16px; border: 2px solid #ddd; border-radius: 8px; outline: none;" onfocus="this.style.borderColor='#0056b3';" onblur="this.style.borderColor='#ddd';" accept="video/mp4,video/x-m4v,video/*,audio/x-m4a,audio/*">
        <br>
            <button id="mediaWindowPlayButton" type="button">Start Presentation</button>
        <br>
            <select name="dspSelct" id="dspSelct">
                <option value="" disabled>--Select Display Device--</option>
            </select>
            <br>
            <br>
        </form>
        <br>
    `;

    if (mediaFile !== null && isLiveStream(mediaFile)) {
        document.getElementById("mdFile").value = mediaFile;
    }

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
    ipcRenderer.send('set-mode', opMode);

    dyneForm.innerHTML = `
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

const isLinux = osName === "Linux";
const sliderClass = isLinux ? 'adwaita-slider' : 'WinStyle-slider';
const lineHeight = isLinux ? '1' : '1.2';

const MEDIA_FORM_HTML = `
  <form onsubmit="return false;">
    <input type="file" name="mdFile" id="mdFile" accept="video/mp4,video/x-m4v,video/*,audio/x-m4a,audio/*,image/*">
    <select name="dspSelct" id="dspSelct">
      <option value="" disabled>--Select Display Device--</option>
    </select>
    <input type="checkbox" name="mdLpCtlr" id="mdLpCtlr">
    <label for="mdLpCtlr">Loop</label>
    <br><br>
    <button id="mediaWindowPlayButton" type="button">Start Presentation</button>
    <br>
  </form>
  <br><br>
  <video style="display: flex; margin: auto;" disablePictureInPicture controls id="preview"></video>
  <div id="mediaCntDn" style="display: flex; justify-content: center;contain: layout style; color: red; font-weight: bold; font-family: 'Courier New', monospace; font-size: 2.5em;"></div>
`;

function installDisplayChangeHandler() {
    if (installDisplayChangeHandler.initialized) return;

    ipcRenderer.on('display-changed', async () => {
        await populateDisplaySelect();
    });

    installDisplayChangeHandler.initialized = true;
}

function loopCtlHandler(event) {
    video.loop = event.target.checked;
    if (isActiveMediaWindow()) {
        ipcRenderer.invoke('set-media-loop-status', event.target.checked);
    }
}

function setSBFormMediaPlayer() {
    if (opMode === MEDIAPLAYER) {
        return;
    }
    opMode = MEDIAPLAYER;
    ipcRenderer.send('set-mode', opMode);
    dyneForm.innerHTML = MEDIA_FORM_HTML;
    mediaCntDn.appendChild(textNode);
    installDisplayChangeHandler();
    populateDisplaySelect();

    if (video === null) {
        video = document.getElementById('preview');
    }

    restoreMediaFile();
    updateTimestamp();

    const loopctl = document.getElementById("mdLpCtlr");
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
    dontSyncRemote = true;
    let isImgFile;
    if (mdFile !== null) {
        if (document.getElementById("preview").parentNode !== null) {
            if (!masterPauseState && video !== null && !video.paused) {
                dontSyncRemote = false;
                if (!isImg(mediaFile)) {
                    video.play();
                }
            }
            if (video !== null) {
                if (!isActiveMW) {
                    if (!mdFile.value.includes("fake")) {
                        mediaFile = mdFile.value;
                    } else {
                        mediaFile = document.getElementById("YtPlyrRBtnFrmID").checked === true ? mdFile.value : webUtils.getPathForFile(mdFile.files[0]);
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
            return;
        }
    }
    if (encodeURI(mediaFile) !== removeFileProtocol(video.src)) {
        saveMediaFile();
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

    if (mdfileElement.files !== null && mdfileElement.files.length !== 0 && encodeURI(webUtils.getPathForFile(mdfileElement.files[0])) === removeFileProtocol(video.src)) {
        return;
    }

    if (playingMediaAudioOnly && opMode === MEDIAPLAYER) {
        if (mdfileElement.files[0].length === 0) {
            return;
        }
        mediaFile = webUtils.getPathForFile(mdfileElement.files[0]);
        return;
    }

    if (mdfileElement !== null && mdfileElement !== 'undefined') {
        if (mdfileElement.files !== null && mdfileElement.files.length === 0) {
            return;
        } else if (mdfileElement.value === "") {
            return;
        }
        if (opMode !== MEDIAPLAYER && dontSyncRemote !== true)
            dontSyncRemote = true;
        saveMediaFile.fileInpt = mdfileElement.files;
        saveMediaFile.urlInpt = mdfileElement.value.toLowerCase();
    }
    const isActiveMW = isActiveMediaWindow();
    if (isActiveMW) {
        return;
    }

    mediaFile = opMode === MEDIAPLAYERYT ? document.getElementById("mdFile").value : webUtils.getPathForFile(document.getElementById("mdFile").files[0]);

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
    if (opMode === MEDIAPLAYER && mediaFile !== null) {
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

function fileOpenShortcutHandler(event) {
    if ((event.ctrlKey || event.metaKey) && (event.key === 'o' || event.key === 'O')) {
        if (document.getElementById("mdFile")) {
            document.getElementById("mdFile").click();
        }
    }
}

function modeSwitchHandler(event) {
    if (event.target.type === 'radio') {
        if (event.target.value === 'Media Player') {
            installPreviewEventHandlers();
            dontSyncRemote = true;
            if (video && !activeLiveStream && isActiveMediaWindow()) {
                dontSyncRemote = false;
            }
            updateTimestamp();
        }
    }
}

function cleanRefs() {
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
    if (mcd) {
        mcd.removeChild(textNode);
    }
}

function installEvents() {
    document.getElementById("MdPlyrRBtnFrmID").addEventListener('click', () => {
        cleanRefs();
        setSBFormMediaPlayer();
    }, { passive: true });

    document.getElementById("YtPlyrRBtnFrmID").addEventListener('click', () => {
        cleanRefs();
        setSBFormYouTubeMediaPlayer();
    }, { passive: true });

    //document.getElementById("TxtPlyrRBtnFrmID").onclick = setSBFormTextPlayer;

    document.addEventListener('keydown', fileOpenShortcutHandler);

    document.querySelector('form').addEventListener('change', modeSwitchHandler, { passive: true });
}

function playAudioFileAfterDelay() {
    video.play();
    updateTimestamp();
}

function playLocalMedia(event) {
    if (!isActiveMediaWindow()) {
        video.audioTracks[0].enabled = true;
    }
    mediaSessionPause = false;
    if (!audioOnlyFile && video.readyState && video.videoTracks && video.videoTracks.length === 0) {
        audioOnlyFile = true;
    }
    if (audioOnlyFile) {
        ipcRenderer.send("localMediaState", 0, "play");
        addFilenameToTitlebar(removeFileProtocol(decodeURI(video.src)));
        isPlaying = true;
        updateDynUI();
        updateTimestamp();
        if (!playingMediaAudioOnly) {
            let t1 = encodeURI(saveMediaFile.fileInpt[0].name);
            let t2 = removeFileProtocol(video.src).split(/[\\/]/).pop();
            if (t1 != null && t2 != null && t1 === t2) {
                document.getElementById("mdFile").files = saveMediaFile.fileInpt;
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
    if (dontSyncRemote === true) {
        dontSyncRemote = false;
        return;
    }
    if (e.target.isConnected) {
        ipcRenderer.send('timeGoto-message', { currentTime: e.target.currentTime, timestamp: Date.now() });
        ipcRenderer.invoke('get-media-current-time').then(r => { targetTime = r });
    }
}

function seekingLocalMedia(e) {
    if (pidSeeking) {
        pidSeeking = false;
        e.preventDefault();
    } else {
        pidController.reset();
    }
    if (dontSyncRemote === true) {
        return;
    }
    if (e.target.isConnected) {
        ipcRenderer.send('timeGoto-message', { currentTime: e.target.currentTime, timestamp: Date.now() });
        ipcRenderer.invoke('get-media-current-time').then(r => { targetTime = r });
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
    ipcRenderer.send("localMediaState", 0, "stop");
    removeFilenameFromTitlebar();
    video.pause();
    masterPauseState = false;
    resetPIDOnSeek();
    localTimeStampUpdateIsRunning = false;
}

function pauseLocalMedia(event) {
    if (mediaSessionPause) {
        ipcRenderer.invoke('get-media-current-time').then(r => { targetTime = r });
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
    dyneForm = document.getElementById("dyneForm");

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

function initPlayer() {
    ipcRenderer.invoke('get-setting', "operating-mode").then(loadOpMode);
}

function isLiveStream(mediaFile) {
    if (mediaFile === undefined || mediaFile === null) {
        return false;
    }
    return /(?:m3u8|mpd|youtube\.com|videoplayback|youtu\.be)/i.test(mediaFile);
}

async function createMediaWindow() {
    mediaFile = opMode === MEDIAPLAYERYT ? document.getElementById("mdFile").value : webUtils.getPathForFile(document.getElementById("mdFile").files[0]);
    var liveStreamMode = isLiveStream(mediaFile);

    if (liveStreamMode === false && video !== null) {
        startTime = video.currentTime;
    }

    var selectedIndex = document.getElementById("dspSelct").selectedIndex - 1;
    activeLiveStream = liveStreamMode;

    if (liveStreamMode === false) {
        if (video === null) {
            video = document.getElementById("preview");
        }
        if (video === null) {
            video.setAttribute("src", mediaFile);
            video.id = "preview";
            video.currentTime = startTime;
            video.controlsList = "noplaybackrate";
            if (document.getElementById("mdLpCtlr") !== null) {
                video.loop = document.getElementById("mdLpCtlr").checked;
            }
        }
    } else {
        if (video && !isImg(video.src))
            video.src = '';
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

    let strtVl = video.volume;
    const windowOptions = {
        webPreferences: {
            additionalArguments: [
                '__mediafile-ems=' + encodeURIComponent(mediaFile),
                startTime !== 0 ? '__start-time=' + startTime : "",
                strtVl !== 1 ? '__start-vol=' + strtVl : "",
                document.getElementById("mdLpCtlr") !== null ? (document.getElementById("mdLpCtlr").checked ? '__media-loop=true' : '') : "",
                liveStreamMode ? '__live-stream=' + liveStreamMode : '', isImgFile ? "__isImg" : ""
            ],
            preload: `${__dirname}/media_preload.js`
        }
    };

    await ipcRenderer.invoke('create-media-window', windowOptions, selectedIndex);
    isActiveMediaWindowCache = true;

    if (pidController) {
        pidController.reset();
    }

    if (video.audioTracks && video.audioTracks[0]) {
        video.audioTracks[0].enabled = false;
    } else {
        video.addEventListener('loadedmetadata', () => {
            video.audioTracks[0].enabled = false;
        }, { once: true });
    }

    if (video.audioTracks && video.audioTracks[0]) {
        video.audioTracks[0].enabled = false;
    }

    video.muted = false;
    pidSeeking = true;
    unPauseMedia();
    if (opMode !== MEDIAPLAYERYT) {
        if (video !== null && !isImgFile) {
            pidSeeking = true;
            await video.play();
        }
    }
    addFilenameToTitlebar(removeFileProtocol(decodeURI(video.src)));
}

const WIN32 = 'Windows';
const LINUX = 'Linux';
const WIN_STYLE = 'WinStyle'

function loadPlatformCSS() {
    document.body.classList.add(WIN_STYLE);
}

loadPlatformCSS();
installIPCHandler();
installEvents();

ipcRenderer.once('ready', initPlayer);
