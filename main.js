"use strict";
const { app, BrowserWindow, ipcMain } = require('electron');
const settings = require('electron-settings');
const rmt = require('@electron/remote/main');
rmt.initialize();
console.time("mstart");

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win;
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-experimental-web-platform-features', 'true');


var toHHMMSS = (secs) => {
  return `${((secs / 3600) | 0).toString().padStart(2, '0')}:${(((secs % 3600) / 60) | 0).toString().padStart(2, '0')}:${((secs % 60) | 0).toString().padStart(2, '0')}:${(((secs * 1000) % 1000) | 0).toString().padStart(3, '0')}`;
};

function debounce(func, delay) {
  let timeoutId = null;
  return (...args) => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
}

function createWindow() {
  ipcMain.on('set-mode', (event, arg) => {
    settings.set('operating-mode', arg)
        .catch(error => {
            console.error('Error saving window bounds:', error);
        });
  });

  ipcMain.handle('get-setting', async (event, setting) => {
    return await settings.get(setting);
  });

  settings.get('windowBounds').then(windowBounds => {
    win = new BrowserWindow({
      width: windowBounds ? windowBounds.width : 1068,
      height: windowBounds ? windowBounds.height : 660,
      minWidth: 735,
      minHeight: 531,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        userGesture: true,
        webSecurity: false
      }
    })
    win.setAspectRatio(1.618);

    rmt.enable(win.webContents);

    const saveWindowBounds = debounce(() => {
      settings.set('windowBounds', win.getBounds())
          .catch(error => {
              console.error('Error saving window bounds:', error);
          });
  }, 300); 

    win.on('resize', saveWindowBounds);

    // and load the index.html of the app.
    win.loadFile('index.html');

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
    console.timeEnd("mstart");
  });
  ipcMain.on('timeRemaining-message', (event, arg) => {
    if (win != null) {
      win.webContents.send('timeRemaining-message', [toHHMMSS(arg[0] - arg[1]), arg[0], arg[1], arg[2]])
    }
  });
  ipcMain.on('playback-state-change', (event, playbackState) => {
    win.webContents.send('update-playback-state', playbackState);
  });
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