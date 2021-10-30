//Project Alchemy
//Copyright 2019 - Ephesus Apprentice Alchemist
const { app, BrowserWindow, ipcMain, ipcRenderer } = require('electron');

var nextFile = null;
var timers = [];
var alarmFileMetadata = [];
var timeRemaining = "00:00:000";
var duration = 0;
var mediaPlayDelay = null;

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

ipcRenderer.on('timeRemaining-message', function (evt, message) {
    if (mediaWindow == null) {
        return;
    }
    if (document.getElementById('mediaCntDn') != null) {
        document.getElementById('mediaCntDn').innerHTML = message[0];
        document.getElementById("custom-seekbar").children[0].style.width = message[1];
        document.getElementById('mediaCntUpDn').innerHTML = toHHMMSS(message[3]) + "/" + toHHMMSS(message[2]);
    } else {
        timeRemaining = message;
    }
    duration = message[2];
});

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
    return require('path').dirname(require('electron').remote.app.getPath('exe')) + process && process.type === 'renderer' ? "/../../../." : "/../.";
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
    if (document.getElementById('mediaCntUpDn') != null) {
        document.getElementById('mediaCntUpDn').innerHTML = "00:00/00:00";
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

function playMedia(e) {
    if (!e) {
        return;
    }

    if (document.getElementById("mdFile").value == "") {
        return;
    }

    if (e.target.innerText == "▶️") {
        e.target.innerText = "⏹️";
        currentMediaFile = document.getElementById("mdFile").files;

        if (document.getElementById("malrm1").value != "") {
            var deadlinestr = "";
            var deadlinestrarr = String(new Date()).split(" ");
            deadlinestrarr[4] = document.getElementById("malrm1").value;
            for (i = 0; i < deadlinestrarr.length; ++i) {deadlinestr+=(deadlinestrarr[i]+" ")}
            deadline=new Date(deadlinestr);
            document.getElementById("mdDelay").value = ((deadline.getTime() - new Date().getTime())/1000);
        }
        mediaPlayDelay = setTimeout(createMediaWindow, document.getElementById("mdDelay").value*1000);
    } else if (e.target.innerText = "⏹️") {
        clearTimeout(mediaPlayDelay);
        if (document.getElementById('mediaCntDn') != null)
            document.getElementById('mediaCntDn').innerHTML = "00:00";
        e.target.innerText = "▶️";
        try {
            mediaWindow.close();
            mediaWindow = null;
            if (document.getElementById('mediaCntUpDn') != null) {
                document.getElementById('mediaCntUpDn').innerHTML = "00:00/00:00";
            }
        } catch (err) {
            ;
        }

    }

}

function setSeekBar(evt) {
    var rect = document.querySelector("#custom-seekbar").getBoundingClientRect();
    var offset = { 
        top: rect.top + window.scrollY, 
        left: rect.left + window.scrollX, 
    };
    var left = (evt.pageX - offset.left);
    //var totalWidth = document.getElementById("custom-seekbar").children[0].getBoundingClientRect().width;
    var totalWidth = 400; //FIXME
    var percentage = ( left / totalWidth );
    if (percentage < 0) {
        return;
    }
    mediaWindow.send('timeGoto-message', percentage);
    //console.log(document.getElementById("custom-seekbar").children[0].style.width);
    console.log(percentage);
}

function setSBFormMediaPlayer() {
    resetPlayer();
    document.getElementById("audio").style.display = "none";
    document.getElementById("plystCtrl").style.display = "none";
    document.getElementById("dyneForm").innerHTML =
        `
        <form>
            <input type="file" name="mdFile" id="mdFile" accept="video/mp4,video/x-m4v,video/*,audio/x-m4a,audio/*">

             <br>

            <input type="number" min="0" max="60" step="1" value="0" name="mdTimeout" id="mdDelay">
            <label for="mdTimeout">Delay</label>
  
            <input name="malrm1" id="malrm1" type="time">
            <label for="malrm1"> Run At </label>
            <input checked type="checkbox" name="mdScrCtlr" id="mdScrCtlr">
            <label for=""mdScrCtrl>Second Monitor</label>
        
            <br>

            <button id="mediaWindowPlayButton" type="button">▶️</button>
        </form>
        <br>
        <br>
        <center><span style="color:red;font-size: larger;" id="mediaCntDn">00:00:000<span></center>
        <br>
        <div id="custom-seekbar"><span draggable="true"></span></div>
        <div><span id="mediaCntUpDn">00:00/00:00</span></div>
    `;
    restoreMediaFile();
    document.getElementById("custom-seekbar").onclick = setSeekBar;
    document.getElementById("custom-seekbar").ondrag = setSeekBar;

    if (mediaWindow == null) {
        document.getElementById("mediaWindowPlayButton").innerText = "▶️";
        document.getElementById("mediaCntDn").innerText = "00:00:000";
        if (document.getElementById('mediaCntUpDn') != null) {
            document.getElementById('mediaCntUpDn').innerHTML = "00:00/00:00";
        }
    } else {
        document.getElementById('mediaCntDn').innerHTML = timeRemaining;
        timeRemaining = "00:00:000";
        document.getElementById("mediaWindowPlayButton").innerText = "⏹️";
        document.getElementById("mdFile").files = currentMediaFile;
        if (document.getElementById('mediaCntUpDn') != null) {
            document.getElementById('mediaCntUpDn').innerHTML = "00:00/00:00";
        }
    }

    document.getElementById("mediaWindowPlayButton").addEventListener("click", playMedia);
}

function saveMediaFile() {
    if (document.getElementById("mdFile") != null && document.getElementById("mdFile") != 'undefined') {
        saveMediaFile.fileInpt = document.getElementById("mdFile").files;
    }
}

function restoreMediaFile() {
    if (saveMediaFile.fileInpt != null && document.getElementById("mdFile") != null) {
        document.getElementById("mdFile").files = saveMediaFile.fileInpt;
    }
}

function installSidebarFormEvents() {
    document.getElementById("WklyRBtnFrmID").onclick = setSBFormWkly;
    document.getElementById("SpclRBtnFrmID").onclick = setSBFormSpcl;
    document.getElementById("AlrmsRBtnFrmID").onclick = setSBFormAlrms;
    document.getElementById("MdPlyrRBtnFrmID").onclick = setSBFormMediaPlayer;
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
        rmtm: require('electron').remote,
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

async function createMediaWindow(path) {
    const electron = require('electron').remote;
    const app = electron.app;
    const { BrowserWindow } = electron;

    var electronScreen = electron.screen;
    var displays = electronScreen.getAllDisplays();
    var externalDisplay = null;
    for (var i in displays) {
        if (displays[i].bounds.x != 0 || displays[i].bounds.y != 0) {
            externalDisplay = displays[i];
            break;
        }
    }

    if (externalDisplay && document.getElementById("mdScrCtlr").checked) {
        mediaWindow = new BrowserWindow({
            x: externalDisplay.bounds.x + 50,
            y: externalDisplay.bounds.y + 50,
            width: externalDisplay.width,
            height: externalDisplay.height,
            fullscreen: true,
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: true
            },
            mediaFile: document.getElementById("mdFile").files[0].path
        });
    } else {
        mediaWindow = new BrowserWindow({
            width: displays[0].width,
            height: displays[0].height,
            fullscreen: true,
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: true
            },
            mediaFile: document.getElementById("mdFile").files[0].path
        });
    }
    mediaWindow.on('timeGoto-message', function (evt, message) {
        //video.currentTime = message;
        console.log(message)
    });
    mediaWindow.on('closed', () => {
        document.getElementById("mediaCntDn").innerText = "00:00:000";
        mediaWindow = null;
        if (document.getElementById('mediaCntUpDn') != null) {
            document.getElementById('mediaCntUpDn').innerHTML = "00:00/00:00";
        }
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

    mediaWindow.loadFile("media.html");
}