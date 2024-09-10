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

if (isDevMode === false) {
  Menu.setApplicationMenu(null);
}

function secondsToTime(seconds) {
  const wholeSecs = seconds | 0;
  const ms = ((seconds - wholeSecs) * 1000 + 0.5) | 0;
  const h = (wholeSecs * 0.0002777777777777778) | 0;  // 1/3600
  const t = h * 3600;
  const m = ((wholeSecs - t) * 0.016666666666666666) | 0;  // 1/60
  const s = wholeSecs - (t + m * 60);

  return ((h < 10 ? '0' : '') + h) + ':' + ((m < 10 ? '0' : '') + m) + ':' + ((s < 10 ? '0' : '') + s) + ':' + (ms < 100 ? '0' : '') + (ms < 10 ? '0' : '') + ms;
}

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

function sendRemainingTime(event, arg) {
  win?.webContents.send('timeRemaining-message', [secondsToTime(arg[0] - arg[1]), arg[0], arg[1], arg[2]]);
}

app.commandLine.appendSwitch('enable-experimental-web-platform-features', 'true');

async function getSetting(_, setting) {
  return settingsModule.get(setting);
}

function handleCloseMediaWindow(event, id) {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
      mediaWindow.close();
      disablePowerSave();
  }
}

function handleCreateMediaWindow(event, windowOptions) {
  return measurePerformance('Creating media window', () => {
      mediaWindow = new BrowserWindow(windowOptions);
      mediaWindow.loadFile("media.html");
      mediaWindow.on('closed', () => {
          if (win) win.webContents.send('media-window-closed', mediaWindow.id);
      });
      return mediaWindow.id;
  });
}

function handlePlayCtl(event, cmd, id) {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
      mediaWindow.send('play-ctl', cmd);
      enablePowersave();
  }
}

function handleRemotePlayPause(_, arg) {
  win.webContents.send('remoteplaypause', arg);
}

function handlePlaybackStateChange(event, playbackState) {
  if (win) {
      win.webContents.send('update-playback-state', playbackState);
  }
}

async function handleGetMediaCurrentTime() {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
      return await mediaWindow.webContents.executeJavaScript('window.api.video.currentTime');
  }
}

function handleSetMode(event, arg) {
  settingsModule.set('operating-mode', arg)
    .catch(error => {
      console.error('Error saving window bounds:', error);
    });
}

function handleDisablePowerSave() {
  if (!mediaWindow || mediaWindow.isDestroyed()) {
      disablePowerSave();
  }
}

function handleEnablePowerSave() {
  if (!mediaWindow || mediaWindow.isDestroyed()) {
      enablePowersave();
  }
}

function handleTimeGotoMessage(event, arg) {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
      mediaWindow.send('timeGoto-message', arg);
  }
}

function handleVlcl(event, v, id) {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
      mediaWindow.send('vlcl', v);
  }
}

app.once('browser-window-created', async () => {
  ipcMain.on('set-mode', handleSetMode);
  ipcMain.handle('get-setting', getSetting);
  ipcMain.handle('get-all-displays', screen.getAllDisplays.bind(screen));
  ipcMain.on('disable-powersave', handleDisablePowerSave);
  ipcMain.on('enable-powersave', handleEnablePowerSave);
  ipcMain.on('remoteplaypause', handleRemotePlayPause);
  ipcMain.on('playback-state-change', handlePlaybackStateChange);
  ipcMain.handle('get-media-current-time', handleGetMediaCurrentTime);
  ipcMain.on('close-media-window', handleCloseMediaWindow);
  ipcMain.on('timeRemaining-message', sendRemainingTime);
  ipcMain.on('vlcl', handleVlcl);
  ipcMain.handle('create-media-window', handleCreateMediaWindow);
  ipcMain.on('timeGoto-message', handleTimeGotoMessage);
  ipcMain.on('play-ctl', handlePlayCtl);
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