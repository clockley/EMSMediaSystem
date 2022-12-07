"use strict";
const { app, BrowserWindow, ipcMain } = require('electron');
require('@electron/remote/main').initialize();


// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win
var toHHMMSS = (secs) => {
  if (isNaN(secs)) {
    return "00:00:000";
  }
  var pad = function(num, size) { return ('000' + num).slice(size * -1); },
  time = parseFloat(secs).toFixed(3),
  hours = Math.floor(time / 60 / 60),
  minutes = Math.floor(time / 60) % 60,
  seconds = Math.floor(time - minutes * 60),
  milliseconds = time.slice(-3);

  return pad(hours, 2) + ':' + pad(minutes, 2) + ':' + pad(seconds, 2) + ':' + pad(milliseconds, 3);
}

function createWindow() {
  ipcMain.on('timeRemaining-message', (event, arg) => {
    if (win == null) {

    }
    win.webContents.send('timeRemaining-message', [toHHMMSS(arg[0] - arg[1]), (arg[1] / arg[0])*100+"%", arg[0], arg[1]])
  })

  ipcMain.on('timeGoto-message', function (evt, message) {
    //win.webContents.send('timeGoto-message', message)
     console.log("DUDU");
  });

// Create the browser window.
  win = new BrowserWindow({
    width: 800,
    height: 450,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  require("@electron/remote/main").enable(win.webContents);

  // and load the index.html of the app.
  win.loadFile('index.html')

  // Open the DevTools.
  //  win.webContents.openDevTools()

  // Emitted when the window is closed.
  win.on('closed', () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    win = null;
    app.quit();

  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow)

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (win === null) {
    createWindow()
  }
})