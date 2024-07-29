"use strict";
import { app, BrowserWindow, ipcMain, screen, powerSaveBlocker, Menu } from 'electron';
import settings from 'electron-settings';
import path from 'path';

let mediaWindow = null;
let windowBounds;
let win = null;
let ipcInitPromise = null;
app.commandLine.appendSwitch('enable-experimental-web-platform-features', 'true');
Menu.setApplicationMenu(null)

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

function debounce(func, delay) {
  let timeoutId = null;
  const boundFunc = func.bind(this);
  return (...args) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => boundFunc(...args), delay);
  };
}

async function createWindow() {
  windowBounds = await windowBounds;
  ipcMain.on('set-mode', (event, arg) => {
    settings.set('operating-mode', arg)
      .catch(error => {
        console.error('Error saving window bounds:', error);
      });
  });

  ipcMain.handle('get-setting', async (event, setting) => {
    return settings.get(setting);
  });

  ipcMain.handle('get-app-path', () => {
    return app.getAppPath();
  })

  win = new BrowserWindow({
    width: windowBounds ? windowBounds.width : 1068,
    height: windowBounds ? windowBounds.height : 660,
    minWidth: 1096,
    minHeight: 681,
    webPreferences: {
      nodeIntegration: true,
      userGesture: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      preload: path.join(app.getAppPath(), 'app_preload.mjs')
    }
  })
  win.setAspectRatio(1.618);
  win.loadFile('index.html');

  win.webContents.on('did-finish-load', async () => {
    const saveWindowBounds = debounce(() => {
      settings.set('windowBounds', win.getBounds())
        .catch(error => {
          console.error('Error saving window bounds:', error);
        });
    }, 300);

    win.on('resize', saveWindowBounds);
  });

  //win.webContents.openDevTools()

  win.on('closed', () => {
    win = null;
    app.quit();

  });
  await ipcInitPromise;
}

function enablePowersave() {
  if (typeof enablePowersave.powerSaveBlockerId === 'undefined') {
    enablePowersave.powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    console.log('Power Save Blocker started:', enablePowersave.powerSaveBlockerId);
  } else {
    console.log('Power Save Blocker is already active:', enablePowersave.powerSaveBlockerId);
  }
}

function disablePowerSave() {
  if (typeof enablePowersave.powerSaveBlockerId !== 'undefined') {
    powerSaveBlocker.stop(enablePowersave.powerSaveBlockerId);
    console.log('Power Save Blocker stopped:', enablePowersave.powerSaveBlockerId);
    enablePowersave.powerSaveBlockerId = undefined;
  } else {
    console.log('No active Power Save Blocker to stop.');
  }
}


async function initializeIPC() {
  ipcMain.handle('get-all-displays', () => {
    return screen.getAllDisplays();
  });

  ipcMain.handle('create-media-window', (event, windowOptions) => {
    mediaWindow = new BrowserWindow(windowOptions);
    mediaWindow.loadFile("media.html");
    mediaWindow.on('closed', () => {
      if (win)
        win.webContents.send('media-window-closed', mediaWindow.id);
    });
    return mediaWindow.id;
  });

  ipcMain.on('disable-powersave', () => {
    disablePowerSave();
  });

  ipcMain.on('enable-powersave', () => {
    enablePowersave();
  });

  ipcMain.on('vlcl', (event, v, id) => {
    if (mediaWindow != null && !mediaWindow.isDestroyed()) {
      mediaWindow.send('vlcl', v);
    }
  });

  ipcMain.on('timeGoto-message', (event, arg) => {
    if (mediaWindow != null && !mediaWindow.isDestroyed()) {
      mediaWindow.send('timeGoto-message', arg);
    }
  });

  ipcMain.on('play-ctl', (event, cmd, id) => {
    if (mediaWindow != null && !mediaWindow.isDestroyed()) {
      mediaWindow.send('play-ctl', cmd);
    }
  });

  ipcMain.handle('get-media-current-time', async () => {
    if (mediaWindow != null && !mediaWindow.isDestroyed()) {
      return await mediaWindow.webContents.executeJavaScript('document.querySelector("video").currentTime');
    }
  });

  ipcMain.on('close-media-window', (event, id) => {
    if (mediaWindow != null && !mediaWindow.isDestroyed()) {
      mediaWindow.hide();
      mediaWindow.close();
    }
  });

  ipcMain.on('timeRemaining-message', (event, arg) => {
    if (win) {
      win.webContents.send('timeRemaining-message', [toHHMMSS(arg[0] - arg[1]), arg[0], arg[1], arg[2]]);
    }
  });

  ipcMain.on('mediasession-pause', () => {
    win.webContents.send('mediasession-pause');
  });

  ipcMain.on('mediasession-play', () => {
    win.webContents.send('mediasession-play');
  });

  ipcMain.on('playback-state-change', (event, playbackState) => {
    if (win) {
      win.webContents.send('update-playback-state', playbackState);
    }
  });

}

app.on('will-finish-launching', async () => {
  ipcInitPromise = initializeIPC();
});

windowBounds = settings.get('windowBounds');

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (win === null) {
    createWindow()
  }
})