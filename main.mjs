"use strict";
import { app, BrowserWindow, ipcMain, screen, powerSaveBlocker, Menu } from 'electron';
var settingsModule = null;
const isDevMode = process.env.ems_dev === 'true';

function measurePerformance(operation, func) {
  if (isDevMode) {
    const start = performance.now();
    const result = func();
    const end = performance.now();
    console.log(`${operation} took ${(end - start).toFixed(2)} ms`);
    return result;
  } else {
    return func();
  }
}

async function measurePerformanceAsync(operation, func) {
  if (isDevMode) {
    const start = performance.now();
    const result = await func();
    const end = performance.now();
    console.log(`${operation} took ${(end - start).toFixed(2)} ms`);
    return result;
  } else {
    return func();
  }
}

const appStartTime = isDevMode ? performance.now() : null;

let mediaWindow = null;
let windowBounds = measurePerformanceAsync('Getting window bounds', async () => {
  settingsModule = await import('electron-settings');
  return settingsModule.get('windowBounds');
});
let win = null;

Menu.setApplicationMenu(null);

function padStart(num, targetLength, padString) {
  const numStr = num.toString();
  let paddingNeeded = targetLength - numStr.length;
  let padding = '';

  while (paddingNeeded > 0) {
      padding += padString;
      paddingNeeded--;
  }

  return padding + numStr;
}

function toHHMMSS(secs) {
  return `${padStart((secs / 3600) | 0, 2, '0')}:${padStart(((secs % 3600) / 60) | 0, 2, '0')}:${padStart((secs % 60) | 0, 2, '0')}:${padStart(((secs * 1000) % 1000) | 0, 3, '0')}`;
};


const saveWindowBounds = (function () {
  let timeoutId = null;

  return async function () {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(async () => {
      settingsModule.set('windowBounds', win.getBounds())
        .catch(error => {
          console.error('Error saving window bounds:', error);
        });
    }, 300);
  };
})();

function createWindow() {
  win = measurePerformance('Creating BrowserWindow', () => new BrowserWindow(mainWindowOptions));
  //win.openDevTools()
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('ready');
    measurePerformance('Setting window aspect ratio', () => win.setAspectRatio(1.618));
    win.on('resize', saveWindowBounds);
  });

  win.on('closed', () => {
    win = null;
    app.quit();
  });

  measurePerformanceAsync('Loading index.html', () => win.loadFile('index.html'));
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

app.commandLine.appendSwitch('enable-experimental-web-platform-features', 'true');

app.once('browser-window-created', async () => {
  ipcMain.on('set-mode', (event, arg) => {
    settingsModule.set('operating-mode', arg)
      .catch(error => {
        console.error('Error saving window bounds:', error);
      });
  });

  ipcMain.handle('get-setting', async (event, setting) => {
    return settingsModule.get(setting);
  });

  ipcMain.handle('get-all-displays', () => {
    return screen.getAllDisplays();
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

  ipcMain.on('remoteplaypause', (_, arg) => {
    win.webContents.send('remoteplaypause', arg);
  });

  ipcMain.on('playback-state-change', (event, playbackState) => {
    if (win) {
      win.webContents.send('update-playback-state', playbackState);
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

  ipcMain.on('vlcl', (event, v, id) => {
    if (mediaWindow && !mediaWindow.isDestroyed()) {
      mediaWindow.send('vlcl', v);
    }
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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!win) {
    measurePerformance('Creating window on activate', createWindow);
  }
});

app.whenReady().then(async () => {
  measurePerformance('Creating window', createWindow);
  if (isDevMode) {
    const appReadyTime = performance.now();
    console.log(`Application ready in ${(appReadyTime - appStartTime).toFixed(2)} ms`);
  }
});

windowBounds = await windowBounds;
const mainWindowOptions = {
  width: windowBounds ? windowBounds.width : 1068,
  height: windowBounds ? windowBounds.height : 660,
  minWidth: 1096,
  minHeight: 681,
  webPreferences: {
    nodeIntegration: true,
    userGesture: true,
    backgroundThrottling: false,
    autoplayPolicy: 'no-user-gesture-required',
    preload: `${import.meta.dirname}/app_preload.mjs`
  }
};