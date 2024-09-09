"use strict";
import { app, BrowserWindow, ipcMain, screen, powerSaveBlocker, Menu } from 'electron';
const settings = import('electron-settings');
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
  const settingsModule = await import('electron-settings');
  return settingsModule.get('windowBounds');
});
let win = null;
let ipcInitPromise = null;

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

function toHHMMSS(secs) {
  return `${padStart((secs / 3600) | 0, 2, '0')}:${padStart(((secs % 3600) / 60) | 0, 2, '0')}:${padStart((secs % 60) | 0, 2, '0')}:${padStart(((secs * 1000) % 1000) | 0, 3, '0')}`;
};

const saveWindowBounds = (function() {
  let timeoutId = null;

  return async function() {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(async () => {
      const settingsModule = await settings;
      settingsModule.set('windowBounds', win.getBounds())
        .catch(error => {
          console.error('Error saving window bounds:', error);
        });
    }, 300);
  };
})();

async function createWindow() {
  win = measurePerformance('Creating BrowserWindow', () => new BrowserWindow(mainWindowOptions));
  //win.openDevTools()
  win.webContents.on('did-finish-load', () => {
    measurePerformance('Setting window aspect ratio', () => win.setAspectRatio(1.618));
    win.on('resize', saveWindowBounds);
  });

  win.on('closed', () => {
    win = null;
    app.quit();
  });

  measurePerformanceAsync('Loading index.html', () => win.loadFile('index.html'));

  await ipcInitPromise;
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

async function setupIPCHandlers() {
  const settingsModule = await settings;

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

  ipcMain.on('remoteplaypause', (_, arg) => {
      win.webContents.send('remoteplaypause', arg);
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

app.commandLine.appendSwitch('enable-experimental-web-platform-features', 'true');
app.on('will-finish-launching', async () => {
  ipcInitPromise = measurePerformanceAsync('Initializing IPC', setupIPCHandlers);
});

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

app.on('ready', async () => {
  await measurePerformanceAsync('Creating window', createWindow);
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