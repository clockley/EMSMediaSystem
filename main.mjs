"use strict";
import { app, BrowserWindow, ipcMain, screen, powerSaveBlocker, Menu } from 'electron';
import settings from 'electron-settings';
import path from 'path';

function measurePerformance(operation, func) {
  const start = performance.now();
  const result = func();
  const end = performance.now();
  console.log(`${operation} took ${(end - start).toFixed(2)} ms`);
  return result;
}

async function measurePerformanceAsync(operation, func) {
  const start = performance.now();
  const result = await func();
  const end = performance.now();
  console.log(`${operation} took ${(end - start).toFixed(2)} ms`);
  return result;
}

const appStartTime = performance.now();

let mediaWindow = null;
let windowBounds = measurePerformanceAsync('Getting window bounds', () => settings.get('windowBounds'));
let win = null;
let ipcInitPromise = null;
app.commandLine.appendSwitch('enable-experimental-web-platform-features', 'true');
Menu.setApplicationMenu(null);

const padStart = (num, targetLength, padString) => {
  const numStr = num.toString();
  let paddingNeeded = targetLength - numStr.length;
  let padding = '';

  while (paddingNeeded > 0) {
    padding += padString;
    paddingNeeded--;
  }

  return padding + numStr;
};

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
  measurePerformance('Setting up IPC handlers', setupIPCHandlers);

  windowBounds = await windowBounds;

  win = measurePerformance('Creating BrowserWindow', () => new BrowserWindow({
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
  }));
  win.setProgressBar(.5);
  measurePerformanceAsync('Loading index.html', () => win.loadFile('index.html'));

  win.webContents.on('did-finish-load', () => {
    measurePerformance('Setting window aspect ratio', () => win.setAspectRatio(1.618));
    const saveWindowBounds = debounce(() => {
      settings.set('windowBounds', win.getBounds())
        .catch(error => {
          console.error('Error saving window bounds:', error);
        });
    }, 300);

    win.on('resize', saveWindowBounds);
  });

  win.on('closed', () => {
    win = null;
    app.quit();
  });

  await measurePerformanceAsync('Initializing IPC', () => ipcInitPromise);
}

function enablePowersave() {
  measurePerformance('Enabling power save blocker', () => {
    if (typeof enablePowersave.powerSaveBlockerId === 'undefined') {
      enablePowersave.powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
      console.log(`Power Save Blocker started: ${enablePowersave.powerSaveBlockerId}`);
    } else {
      console.log(`Power Save Blocker is already active: ${enablePowersave.powerSaveBlockerId}`);
    }
  });
}

function disablePowerSave() {
  measurePerformance('Disabling power save blocker', () => {
    if (typeof enablePowersave.powerSaveBlockerId !== 'undefined') {
      powerSaveBlocker.stop(enablePowersave.powerSaveBlockerId);
      console.log(`Power Save Blocker stopped: ${enablePowersave.powerSaveBlockerId}`);
      enablePowersave.powerSaveBlockerId = undefined;
    } else {
      console.log('No active Power Save Blocker to stop.');
    }
  });
}

let ipcHandlersSet = false; // Flag to ensure IPC handlers are set only once

function setupIPCHandlers() {
  if (ipcHandlersSet) return; // Check if handlers are already set
  ipcHandlersSet = true; // Set the flag to true

  ipcMain.on('set-mode', (event, arg) => {
    settings.set('operating-mode', arg)
      .catch(error => {
        console.error('Error saving window bounds:', error);
      });
  });

  ipcMain.handle('get-setting', async (event, setting) => {
    return settings.get(setting);
  });

  ipcMain.handle('get-all-displays', () => {
    return screen.getAllDisplays();
  });

  ipcMain.handle('create-media-window', (event, windowOptions) => {
    return measurePerformance('Creating media window', () => {
      mediaWindow = new BrowserWindow(windowOptions);
      mediaWindow.loadFile("media.html");
      mediaWindow.on('closed', () => {
        if (win) win.webContents.send('media-window-closed', mediaWindow.id);
      });
      return mediaWindow.id;
    });
  });

  ipcMain.on('vlcl', (event, v, id) => {
    if (mediaWindow && !mediaWindow.isDestroyed()) {
      mediaWindow.send('vlcl', v);
    }
  });

  ipcMain.on('timeGoto-message', (event, arg) => {
    if (mediaWindow && !mediaWindow.isDestroyed()) {
      mediaWindow.send('timeGoto-message', arg);
    }
  });

  ipcMain.on('play-ctl', (event, cmd, id) => {
    if (mediaWindow && !mediaWindow.isDestroyed()) {
      mediaWindow.send('play-ctl', cmd);
      enablePowersave();
    }
  });

  ipcMain.handle('get-media-current-time', async () => {
    if (mediaWindow && !mediaWindow.isDestroyed()) {
      return await mediaWindow.webContents.executeJavaScript('window.api.video.currentTime');
    }
  });

  ipcMain.on('close-media-window', (event, id) => {
    if (mediaWindow && !mediaWindow.isDestroyed()) {
      mediaWindow.hide();
      mediaWindow.close();
      disablePowerSave();
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

  ipcMain.on('disable-powersave', () => {
    if (!mediaWindow || mediaWindow.isDestroyed()) {
      disablePowerSave();
    }
  });

  ipcMain.on('enable-powersave', () => {
    if (!mediaWindow || mediaWindow.isDestroyed()) {
      enablePowersave();
    }
  });
}

app.on('will-finish-launching', async () => {
  ipcInitPromise = measurePerformanceAsync('Initializing IPC', setupIPCHandlers);
});

windowBounds = measurePerformance('Getting initial window bounds', () => settings.get('windowBounds'));

app.whenReady().then(() => measurePerformanceAsync('Creating window', createWindow));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!win) {
    measurePerformanceAsync('Creating window on activate', createWindow);
  }
});

app.on('ready', () => {
  const appReadyTime = performance.now();
  console.log(`Application ready in ${(appReadyTime - appStartTime).toFixed(2)} ms`);
});
