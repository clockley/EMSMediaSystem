//Project Alchemy
//Copyright 2019 - Ephesus Apprentice Alchemist
const { app, BrowserWindow, ipcMain, ipcRenderer } = require('electron');

var nextFile = null;
var timers = [];
var alarmFileMetadata = [];
var timeRemaining = "00:00:000";
var dontSyncRemote = false;
var mediaPlayDelay = null;
var video = null;
var masterPauseState = false;
var activeLiveStream = false;
var targetTime;
var startTime = 0;
var prePathname = '';

var toHHMMSS = (secs) => {
    if (isNaN(secs)) {
      return "00:00:000";
    }
    var pad = function(num, size) { return ('000' + num).slice(size * -1); },
    time = parseFloat(secs).toFixed(3),
    hours = Math.floor(time / 60 / 60),
    minutes = Math.floor(time / 60) % 60,
    seconds = Math.floor(time - minutes * 60);

    return pad(hours, 2) + ':' + pad(minutes, 2) + ':' + pad(seconds, 2);
}

let lastUpdateTime = performance.now(); 

ipcRenderer.on('update-playback-state', (event, playbackState) => {
    // Handle play/pause state
    if (!video) {
        return;
    }
    if (playbackState.playing && video.paused) {
        masterPauseState = false;
        if (video) {
            video.play();
        }
    } else if (!playbackState.playing && !video.paused) {
        masterPauseState = true;
        if (video) {
            video.pause();
            video.currentTime=playbackState.currentTime; //sync on pause
        }
    }
});

// Initialize an array to hold the last 30 seconds of IPC delays
let ipcDelays = [];
const maxDelayEntries = 30;  // to hold last 30-second values

ipcRenderer.on('timeRemaining-message', function (evt, message) {
    if (mediaWindow == null) {
        return;
    }

    const now = performance.now();
    const sendTime = message[4];
    const ipcDelay = new Date() - sendTime;

    // Update the rolling average of IPC delays
    ipcDelays.push(ipcDelay);
    if (ipcDelays.length > maxDelayEntries) {
        ipcDelays.shift();  // Remove the oldest entry to maintain the size
    }

    const averageIpcDelay = ipcDelays.reduce((acc, val) => acc + val, 0) / ipcDelays.length;
    const timeToEnd = message[2] - message[3];
    let adjustedIpcDelay = ipcDelay;

    // If the time remaining is less than or equal to 10 times the average IPC delay, ignore the IPC delay
    if (timeToEnd <= 10 * averageIpcDelay) {
        adjustedIpcDelay = 0;
    }

    targetTime = message[3] - (adjustedIpcDelay / 1000); // Adjust target time considering the potentially modified IPC delay

    mediaCntDwn = null;

    if ((mediaCntDwn = document.getElementById('mediaCntDn')) != null) {
        const intervalReductionFactor = Math.max(0.5, Math.min(1, timeToEnd / 10));
        const syncInterval = 2500 * intervalReductionFactor;

        if (now - lastUpdateTime > syncInterval) {
            hybridSync(targetTime, timeToEnd);
            lastUpdateTime = now;
        }
        mediaCntDwn.innerHTML = message[0];
    } else {
        timeRemaining = message;
    }
    duration = message[2];
});

function adjustPlaybackRate(targetTime, timeToEnd) {
    const currentTime = video.currentTime;
    const timeDifference = targetTime - currentTime;
    const rateAdjustmentFactor = 0.005;  // More gradual adjustment
    let playbackRate = 1.0 + (timeDifference * rateAdjustmentFactor);
    playbackRate = Math.max(0.8, Math.min(1.2, playbackRate));  // Smaller range to reduce drastic changes

    video.playbackRate = playbackRate;
    if (timeToEnd > 2 && Math.abs(timeDifference) < 0.1) {  // Reset rate more conditionally
        setTimeout(() => {
            video.playbackRate = 1.0;
        }, 1000 * timeToEnd);  // Longer delay to allow smoother transition
    }
}

function hybridSync(targetTime, timeToEnd) {
    const currentTime = video.currentTime;
    const timeDifference = targetTime - currentTime;

    // Prioritize rate adjustment over direct jumps
    adjustPlaybackRate(targetTime, timeToEnd);
}

class AlarmInputState {
    constructor(fileInputValue, timeInputValue) {
        this.fileInputValue = fileInputValue;
        this.timeInputValue = timeInputValue;
    }
    getTimeInputValue() {
        return this.timeInputValue;
    }
    getFileInputValue() {
        return this.fileInputValue;
    }
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

function getMediaFilesFolder() {
    return require('path').dirname(require('@electron/remote').app.getPath('exe')) + process && process.type === 'renderer' ? "/../../../." : "/../.";
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
    if (document.getElementById('mediaCntDn') != null) {
        document.getElementById('mediaCntDn').innerHTML = "00:00";
    }
    clearPlaylist();
    resetMediaSrc();
}

function setSBFormWkly() {
    saveMediaFile();
    resetPlayer();
    document.getElementById("dyneForm").innerHTML =
        `
    <select id="dtselcter">
    </select>
    `
    getPlaylistByWeek(ISO8601_week_no(new Date()));
    var sel = document.getElementById('dtselcter');
    var wn = ISO8601_week_no(new Date());
    for (var i = 1; i <= 52; ++i) {
        var tmp = document.createElement('option');
        tmp.selected = i == wn ? true : false;
        tmp.value = i;
        tmp.innerText = i;
        sel.appendChild(tmp);
    }

    document.getElementById("dtselcter").addEventListener("change", (event) => {
        resetPlayer();
        getPlaylistByWeek(event.target.value);
    })
}

function setSBFormSpcl() {
    saveMediaFile();
    resetPlayer();

    document.getElementById("dyneForm").innerHTML =
        `
    <select id="spcleventslst">
        <option value="Communion">Communion</option>
        <option value="Wedding">Wedding</option>
    </select>
    `;
    getPlaylistByEvent(document.getElementById("spcleventslst").value);
    document.getElementById("spcleventslst").addEventListener("change", (event) => {
        resetPlayer();
        getPlaylistByEvent(event.target.value);
    })
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

function setTimer(e) {
    if (e.target == undefined) {
        return;
    }

    var timerID = parseInt(e.target.attributes.getNamedItem("id").value.match(/\d/g).join``.trim());

    if (document.getElementById("af" + timerID).files.length == 0 && e.target.innerText == "▶️") {
        return;
    }

    if (e.target.innerText == "⏹️") {
        e.target.innerText = "▶️";
        if (timers[timerID - 1] == null) {
            return;
        }
        timers[timerID - 1].stopAudio();
        timers[timerID - 1] = null;
        alarmFileMetadata[timerID - 1] = null;
        saveRestoreAlrmFrm("dyneForm", "save");
        return;
    }

    e.target.innerText = "⏹️"

    saveRestoreAlrmFrm("dyneForm", "save");

    alarmFileMetadata[timerID - 1] = new AlarmInputState(document.getElementById("af" + timerID).files, document.getElementById("alrm" + timerID).value);

    var h = parseInt(document.getElementById("alrm" + timerID).value.split(":")[0]);
    var m = parseInt(document.getElementById("alrm" + timerID).value.split(":")[1]);
    var cur = new Date();
    var duration = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), h, m, 0, 0) - cur;

    if (duration < 0) {
        duration += 86400000;
    }

    timers[timerID - 1] = new Timer(duration, timerCallback, timerID);
}

function addAlarm(e) {
    if (typeof addAlarm.counter == 'undefined') {
        addAlarm.counter = 4;
    }

    var x = parseInt(document.getElementById("intrnlArmlFrmDiv").childElementCount - addAlarm.counter) + 1;
    var nodeInput = document.createElement("input");
    nodeInput.setAttribute("name", "alrm" + x);
    nodeInput.setAttribute("type", "time");
    var nodeLabel = document.createElement("label");
    var nodeFileInput = document.createElement("input");
    nodeFileInput.setAttribute("type", "file");
    var alrmSetBtn = document.createElement("button");
    alrmSetBtn.setAttribute("id", "as" + x);
    alrmSetBtn.setAttribute("class", "setTimerButton");
    alrmSetBtn.setAttribute("type", "button");
    alrmSetBtn.innerText = "▶️";
    nodeLabel.setAttribute("for", "alrm" + x);
    nodeInput.setAttribute("id", "alrm" + x);
    nodeLabel.innerText = " Alarm " + x + " ";
    nodeFileInput.setAttribute("id", "af" + x);
    document.getElementById("intrnlArmlFrmDiv").appendChild(nodeInput);
    document.getElementById("intrnlArmlFrmDiv").appendChild(nodeLabel);
    document.getElementById("intrnlArmlFrmDiv").appendChild(nodeFileInput);
    document.getElementById("intrnlArmlFrmDiv").appendChild(alrmSetBtn);
    document.getElementById("intrnlArmlFrmDiv").appendChild(document.createElement("br"));
    addAlarm.counter += 4;

    document.getElementById("as" + x).addEventListener('click', setTimer);

    saveRestoreAlrmFrm("dyneForm", "save");
}

function setSBFormAlrms() {
    saveMediaFile();
    resetPlayer();

    document.getElementById("audio").style.visibility = "hidden";
    document.getElementById("plystCtrl").style.visibility = "hidden";
    document.getElementById("dyneForm").innerHTML =
        `
        <form id="alrmForm">
            <div id="intrnlArmlFrmDiv">
                <input name="alrm1" id="alrm1" type="time"><label for="alrm1"> Alarm 1 </label><input id="af1" type="file"><button id="as1" type="button" class="setTimerButton">▶️</button>
                <br>
            </div>
            <button id="addAlrm" type="button">+</button>
        </form>
    `;
    saveRestoreAlrmFrm("dyneForm", "restore");

    for (var i = 1; i <= alarmFileMetadata.length; ++i) {
        if (alarmFileMetadata[i - 1] == null) {
            continue;
        }
        document.getElementById("alrm" + i).value = alarmFileMetadata[i - 1].getTimeInputValue();
        document.getElementById("af" + i).files = alarmFileMetadata[i - 1].getFileInputValue();
    }

    document.getElementById("addAlrm").addEventListener("click", addAlarm);

    var setAlrmButtonList = document.getElementsByClassName("setTimerButton");
    for (var i = 0; i < setAlrmButtonList.length; i++) {
        setAlrmButtonList[i].addEventListener('click', setTimer);
    }
}

function vlCtl(v) {
    if (mediaWindow != null) {
        mediaWindow.send('vlcl', v);
    }
}

function pauseMedia(e) {
    if (mediaWindow != null) {
        mediaWindow.send('pauseCtl', 0);
    }
}

function unPauseMedia(e) {
    if (mediaWindow != null) {
        mediaWindow.send('playCtl', 0);
    }
}

function pauseButton(e) {
    if (video != null) {
        if (!video.paused) {
            video.pause();
        } else {
            video.play();
        }
    }
}

function playMedia(e) {
    //new Date().setHours(document.getElementById("cntTmeVidStrt").value.split(":")[0], document.getElementById("cntTmeVidStrt").value.split(":")[1], 00)
    if (!e) {
        return;
    }

    if (document.getElementById("mdFile").value == "") {
        return;
    }

    if (e.target.innerText == "▶️") {
        videoEnded = false;
        e.target.innerText = "⏹️";
        currentMediaFile = document.getElementById("mdFile").files;

        if (document.getElementById("malrm1") != null && document.getElementById("malrm1").value != "") {
            var deadlinestr = "";
            var deadlinestrarr = String(new Date()).split(" ");
            deadlinestrarr[4] = document.getElementById("malrm1").value;
            for (i = 0; i < deadlinestrarr.length; ++i) {deadlinestr+=(deadlinestrarr[i]+" ")}
            deadline=new Date(deadlinestr);
            document.getElementById("mdDelay").value = ((deadline.getTime() - new Date().getTime())/1000);
        }
        if (document.getElementById("mdDelay") != null) {
            mediaPlayDelay = setTimeout(createMediaWindow, document.getElementById("mdDelay").value*1000);
        } else {
            createMediaWindow();
        }
    } else if (e.target.innerText = "⏹️") {
        clearTimeout(mediaPlayDelay);
        if (document.getElementById('mediaCntDn') != null)
            document.getElementById('mediaCntDn').innerHTML = "00:00:000";

        e.target.innerText = "▶️";
        try {
            activeLiveStream = false;
            saveMediaFile();
            mediaWindow.close();
            mediaWindow = null;
        } catch (err) {
            ;
        }

    }
}

function setSBFormYouTubeMediaPlayer() {
    resetPlayer();
    if (mediaWindow == null) {
        if (document.getElementById("mediaCntDn")!= null) {
            document.getElementById("mediaCntDn").innerText = "00:00:000";
        }
    }

    document.getElementById("audio").style.display = "none";
    document.getElementById("plystCtrl").style.display = "none";
    document.getElementById("dyneForm").innerHTML =
        `
        <form>
            <input type="url" name="mdFile" id="mdFile" accept="video/mp4,video/x-m4v,video/*,audio/x-m4a,audio/*">

            <br>

            <input checked type="checkbox" name="mdScrCtlr" id="mdScrCtlr">
            <label for=""mdScrCtrl>Second Monitor</label>

            <br>

            <button id="mediaWindowPlayButton" type="button">▶️</button>
        </form>
        <br>
    `;
    restoreMediaFile();

    if (document.getElementById("mdFile").value.includes(":\\fakepath\\")) {
        document.getElementById("mdFile").value='';
    }

    if (mediaWindow == null) {
        document.getElementById("mediaWindowPlayButton").innerText = "▶️";
    } else {
        document.getElementById("mediaWindowPlayButton").innerText = "⏹️";
    }

    document.getElementById("mediaWindowPlayButton").addEventListener("click", playMedia);
}

function setSBFormTimeoutMediaPlayer() {
    resetPlayer();
    if (mediaWindow == null) {
        if (document.getElementById("mediaCntDn")!= null) {
            document.getElementById("mediaCntDn").innerText = "00:00:000";
        }
    }

    document.getElementById("audio").style.display = "none";
    document.getElementById("plystCtrl").style.display = "none";
    document.getElementById("dyneForm").innerHTML =
        `
        <form>
            <input type="url" name="mdFile" id="mdFile" accept="video/mp4,video/x-m4v,video/*,audio/x-m4a,audio/*">

            <input checked type="time" name="cntTmeVidStrt" id="cntTmeVidStrt" value="11:00">
            <input checked type="checkbox" name="mdScrCtlr" id="mdScrCtlr">
            <label for=""mdScrCtrl>Second Monitor</label>
        
            <br>

            <button id="mediaWindowPlayButton" type="button">▶️</button>
        </form>
        <br>
    `;
    document.getElementById("mdFile").value=require('path').join(require('os').homedir(), 'Desktop')+"/cntDwnWthStartTime.mp4"
    restoreMediaFile();

    if (mediaWindow == null) {
        document.getElementById("mediaWindowPlayButton").innerText = "▶️";
    } else {
        document.getElementById("mediaWindowPlayButton").innerText = "⏹️";
    }

    document.getElementById("mediaWindowPlayButton").addEventListener("click", playMedia);
}

function setSBFormMediaPlayer() {
    resetPlayer();
    if (mediaWindow == null) {
        if (document.getElementById("mediaCntDn")!= null) {
            document.getElementById("mediaCntDn").innerText = "00:00:000";
        }
    }
    document.getElementById("audio").style.display = "none";
    document.getElementById("plystCtrl").style.display = "none";
    document.getElementById("dyneForm").innerHTML =
        `
        <form>
            <input type="file" name="mdFile" id="mdFile" accept="video/mp4,video/x-m4v,video/*,audio/x-m4a,audio/*,image/*">

             <br>

            <input type="number" min="0" max="60" step="1" value="0" name="mdTimeout" id="mdDelay">
            <label for="mdTimeout">Delay</label>
  
            <input name="malrm1" id="malrm1" type="time">
            <label for="malrm1"> Run At </label>
            <input checked type="checkbox" name="mdScrCtlr" id="mdScrCtlr">
            <label for=""mdScrCtrl>Second Monitor</label>
            <input type="checkbox" name="mdLpCtlr" id="mdLpCtlr">
            <label for=""mdLpCtlr>🔁</label>

            <label for="volumeControl">Volume:</label>
            <input type="range" id="volumeControl" min="0" max="1" step="0.01" value="1"

            <br>
            <br>

            <button id="mediaWindowPlayButton" type="button">▶️</button>
            <button id="mediaWindowPauseButton" type="button">⏸️</button>
            <br>

        </form>
        <br>
        <br>
        <center><video id="preview"></video></center>
        <center><span style="color:red;font-size: xx-large;font-weight: bold;font-family: sans-serif;" id="mediaCntDn">00:00:000<span></center>
    `;
    restoreMediaFile();
    document.getElementById("mdFile").addEventListener("change", saveMediaFile)

    if (mediaWindow == null) {
        document.getElementById("mediaWindowPlayButton").innerText = "▶️";
        document.getElementById("mediaCntDn").innerText = "00:00:000";
    } else {
        document.getElementById('mediaCntDn').innerHTML = timeRemaining;
        timeRemaining = "00:00:000";
        document.getElementById("mediaWindowPlayButton").innerText = "⏹️";
        document.getElementById("mdFile").files = currentMediaFile;
    }
    document.getElementById('volumeControl').addEventListener('input', function() {
        vlCtl(this.value);
    });

    document.getElementById("mediaWindowPlayButton").addEventListener("click", playMedia);
    document.getElementById("mediaWindowPauseButton").addEventListener("click", pauseButton);
    if (document.getElementById("mdFile") != null) {
        if (document.getElementById("preview").parentNode != null) {
            if (!masterPauseState && video != null && !video.paused) {
                video.currentTime = targetTime;
                video.play();
            }
            dontSyncRemote = true;
            if (video != null) {
                if (!document.getElementById("mdFile").value.includes("fake")) {
                    mediaFile = document.getElementById("mdFile").value;
                } else {
                    mediaFile = document.getElementById("YtPlyrRBtnFrmID").checked == true ? document.getElementById("mdFile").value : document.getElementById("mdFile").files[0].path;
                }
                if (mediaWindow != null && mediaFile != null && isLiveStream(mediaFile)) {
                    video.currentTime = targetTime;
                    video.play()
                }
                document.getElementById("preview").parentNode.replaceChild(video, document.getElementById("preview"));
            }
        }
    }
}

function saveMediaFile() {
    if (!document.getElementById("mdFile")) {
        return;
    }
    if (document.getElementById("mdFile") != null && document.getElementById("mdFile") != 'undefined') {
        if (document.getElementById("mdFile").files != null && document.getElementById("mdFile").files.length == 0) {
            return;
        } else if (document.getElementById("mdFile").value == "") {
            return;
        }
        saveMediaFile.fileInpt = document.getElementById("mdFile").files;
        saveMediaFile.urlInpt = document.getElementById("mdFile").value;
    }

    if (!document.getElementById("mdFile").value.includes("fake")) {
        mediaFile = document.getElementById("mdFile").value;
    } else {
        mediaFile = document.getElementById("YtPlyrRBtnFrmID").checked == true ? document.getElementById("mdFile").value : document.getElementById("mdFile").files[0].path;
    }

    if ((document.getElementById("mdFile") != null && (mediaWindow == null && document.getElementById("mdFile") != null &&
        !(isLiveStream(mediaFile)))) || (mediaWindow !=null && document.getElementById("mdFile") != null && isLiveStream(mediaFile))) {
        if (video == null) {
            video = document.createElement('video');
        }
        video.muted = true;
        if (prePathname != document.getElementById("mdFile").files[0].path) {
            prePathname = document.getElementById("mdFile").files[0].path;
            startTime = 0;
        }
        video.setAttribute("src", document.getElementById("mdFile").files[0].path);
        video.setAttribute("controls", "true");
        video.setAttribute("disablePictureInPicture", "true");
        video.id="preview";
        video.currentTime = startTime;
        video.controlsList = "noplaybackrate";
        if (document.getElementById("mdLpCtlr") != null) {
            video.loop = document.getElementById("mdLpCtlr").checked;
        }
        document.getElementById("preview").parentNode.replaceChild(video, document.getElementById("preview"));
    }
}

function restoreMediaFile() {
    if (saveMediaFile.fileInpt != null && document.getElementById("mdFile") != null) {
        if (document.getElementById("YtPlyrRBtnFrmID") != null && document.getElementById("YtPlyrRBtnFrmID").checked) {
            document.getElementById("mdFile").value = saveMediaFile.urlInpt;
        }else {
            document.getElementById("mdFile").files = saveMediaFile.fileInpt;
        }
    }
}

function installSidebarFormEvents() {
    document.getElementById("WklyRBtnFrmID").onclick = setSBFormWkly;
    document.getElementById("SpclRBtnFrmID").onclick = setSBFormSpcl;
    document.getElementById("AlrmsRBtnFrmID").onclick = setSBFormAlrms;
    document.getElementById("MdPlyrRBtnFrmID").onclick = setSBFormMediaPlayer;
    document.getElementById("YtPlyrRBtnFrmID").onclick = setSBFormYouTubeMediaPlayer;
    document.getElementById("TmOut").onclick = setSBFormTimeoutMediaPlayer;
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

function installEvents(x) {
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

function initPlayer() {
    setSBFormWkly();
}

window.addEventListener("load", (event) => {
    initPlayer();
    installEvents();
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

function getPlaylistByWeek(wnum) {
    const remote = {
        rmtm: require('@electron/remote'),
        fs: require('fs')
    }

    try {
        remote.fs.readdirSync(getMediaFilesFolder() + wnum).forEach(file => {
            addToPlaylist(getMediaFilesFolder() + wnum, file);
        });
    } catch (err) {
        if (err.code == 'ENOENT') {
            console.log('Finle not found');
        }
    }
}

function getPlaylistByEvent(evnt) {
    getPlaylistByWeek(evnt);
}

let mediaWindow = null;

function isLiveStream(mediaFile) {
    return mediaFile.includes("m3u8") || mediaFile.includes("mpd") ||
                    mediaFile.includes("youtube.com") || mediaFile.includes("videoplayback");
}

async function createMediaWindow(path) {
    const electron = require('@electron/remote');
    const app = electron.app;
    const { BrowserWindow } = electron;

    if (!document.getElementById("mdFile").value.includes("fake")) {
        mediaFile = document.getElementById("mdFile").value;
    } else {
        mediaFile = document.getElementById("YtPlyrRBtnFrmID").checked == true ? document.getElementById("mdFile").value : document.getElementById("mdFile").files[0].path;
    }
    var liveStreamMode = (mediaFile.includes("m3u8") || mediaFile.includes("mpd") || mediaFile.includes("youtube.com") || mediaFile.includes("videoplayback")) == true ? true : false;

    if (liveStreamMode == false && video != null) {
        video.pause();
        startTime = video.currentTime;
    }

    var electronScreen = electron.screen;
    var displays = electronScreen.getAllDisplays();
    var externalDisplay = null;
    for (var i in displays) {
        if (displays[i].bounds.x != 0 || displays[i].bounds.y != 0) {
            externalDisplay = displays[i];
            break;
        }
    }
    activeLiveStream = liveStreamMode;
    if (liveStreamMode == false) {
        video = document.createElement('video');
        video.muted = true;
        video.setAttribute("src", mediaFile);
        video.setAttribute("controls", "true");
        video.setAttribute("disablePictureInPicture", "true");
        video.id="preview";
        video.currentTime = startTime;
        video.controlsList = "noplaybackrate";
        if (document.getElementById("mdLpCtlr") != null) {
            video.loop = document.getElementById("mdLpCtlr").checked;
        }
        if (document.getElementById("preview") != null) {
            //https://stackoverflow.com/questions/3258587/how-to-properly-unload-destroy-a-video-element
            document.getElementById("preview").removeAttribute('src');
            document.getElementById("preview").load();
        }
        document.getElementById("preview").parentNode.replaceChild(video, document.getElementById("preview"));
        document.getElementById("preview").addEventListener('pause', (event) => {
            if (activeLiveStream) {
                return;
            }
            if (video.currentTime - video.duration == 0) {
                return;
            }
            if (!event.target.isConnected) {
                event.preventDefault();
                event.target.play();
            }
            if (event.target.clientHeight == 0) {
                event.preventDefault();
                return;
                //event.target.play(); //continue to play even if detached
            }
            if (event.target.parentNode != null) {
                pauseMedia();
            }
        });
        document.getElementById("preview").addEventListener('play', (event) => {
            if (event.target.clientHeight == 0) {
                event.preventDefault();
                //event.target.play(); //continue to play even if detached
            }
            unPauseMedia();
        });

        video.addEventListener('seeked', (e) => {
            if (mediaWindow == null) {
                return;
            }
            if (dontSyncRemote) {
                dontSyncRemote = false;
                return;
            }
            if (e.target.isConnected) {
                mediaWindow.send('timeGoto-message', e.target.currentTime);
            }
        });

        video.addEventListener('seeking', (e) => {
            if (dontSyncRemote) {
                return;
            }
            if (e.target.isConnected && mediaWindow != null) {
                mediaWindow.send('timeGoto-message', e.target.currentTime);
            }
        });

        video.addEventListener('ended', (e) => {
            videoEnded = true;
            saveMediaFile();
        });
    }
    var endTime = '0';
    if (document.getElementById("cntTmeVidStrt")) {
        endTime = document.getElementById("cntTmeVidStrt").value;
    }
    var strtVl = 1;
    if (document.getElementById('volumeControl') != null) {
        strtVl = document.getElementById('volumeControl').value;
    }

    if (externalDisplay && document.getElementById("mdScrCtlr").checked) {
        mediaWindow = new BrowserWindow({
            backgroundColor: '#000000',
            x: externalDisplay.bounds.x + 50,
            y: externalDisplay.bounds.y + 50,
            width: externalDisplay.width,
            height: externalDisplay.height,
            fullscreen: true,
            autoHideMenuBar: true,
            frame: false,
            webPreferences: {
                nodeIntegration: true,
                webSecurity: false,
                contextIsolation: false,
                nativeWindowOpen: false,
                additionalArguments: ['--start-time='.concat(startTime),'--start-vol='.concat(strtVl),'--endtime-ems='.concat(endTime), '--mediafile-ems='.concat(encodeURIComponent(mediaFile)), document.getElementById("mdLpCtlr")!=undefined?'--media-loop='.concat(document.getElementById("mdLpCtlr").checked):"",]
            },
        });
    } else {
        mediaWindow = new BrowserWindow({
            backgroundColor: '#000000',
            width: displays[0].width,
            height: displays[0].height,
            fullscreen: true,
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: true,
                webSecurity: false,
                contextIsolation: false,
                nativeWindowOpen: false,
                additionalArguments: ['--start-time='.concat(startTime),'--start-vol='.concat(strtVl),'--endtime-ems='.concat(endTime), '--mediafile-ems='.concat(encodeURIComponent(mediaFile)), document.getElementById("mdLpCtlr")!=undefined?'--media-loop='.concat(document.getElementById("mdLpCtlr").checked):""]
            }
        });
    }

    if (mediaWindow != null) {
        mediaWindow.on('closed', () => {
            if (video != null) {
                video.pause();
                video.currentTime=0;
            }
            if (document.getElementById("mediaCntDn") != null) {
                document.getElementById("mediaCntDn").innerText = "00:00:000";
            }
            mediaWindow = null;
            if (document.getElementById("mediaWindowPlayButton") != null) {
                document.getElementById("mediaWindowPlayButton").innerText = "▶️";
                ipcRenderer.send('timeRemaining-message', 0);
            } else {
                document.getElementById("MdPlyrRBtnFrmID").addEventListener("click", function () {
                    ipcRenderer.send('timeRemaining-message', 0);
                    document.getElementById("mediaWindowPlayButton").innerText = "▶️";
                }, { once: true });
            }
            timeRemaining = "00:00:000"
        });
    }

    mediaWindow.loadFile("media.html");
}
