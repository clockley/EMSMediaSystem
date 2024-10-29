"use strict";
import { app, BrowserWindow, ipcMain, screen, powerSaveBlocker, Menu, dialog } from 'electron';
import settings from 'electron-settings';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
const isDevMode = process.env.ems_dev === 'true';
let lastKnownDisplayState = null;
let wasDisplayDisconnected = false;

if (isDevMode) {
  console.log(`Node version: ${process.versions.node}`);
  console.log(`Electron version: ${process.versions.electron}`);
}

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

function getWindowBounds() {
  return settings.get('windowBounds');
}

let mediaWindow = null;
let windowBounds = measurePerformanceAsync('Getting window bounds', getWindowBounds);
let win = null;

if (isDevMode === false) {
  Menu.setApplicationMenu(null);
}

const pad = (n) => (n < 10 ? '0' : '') + n;
const padMs = (n) => (n < 10 ? '00' : n < 100 ? '0' : '') + n;

function secondsToTime(seconds) {
  const wholeSecs = seconds | 0;
  const ms = ((seconds - wholeSecs) * 1000 + 0.5) | 0;
  const h = (wholeSecs / 3600) | 0;
  const m = ((wholeSecs / 60) | 0) % 60;
  const s = wholeSecs % 60;

  return `${pad(h)}:${pad(m)}:${pad(s)}.${padMs(ms)}`;
}

const saveWindowBounds = (function () {
  let timeoutId = null;

  return async function () {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(async () => {
      settings.set('windowBounds', win.getBounds())
        .catch(error => {
          console.error('Error saving window bounds:', error);
        });
    }, 300);
  };
})();

function lateInit() {
  win.webContents.send('ready');
  measurePerformance('Setting window aspect ratio', win.setAspectRatio.bind(win, 1.618));
  win.on('resize', saveWindowBounds);
}

function createWindow() {
  win = measurePerformance('Creating BrowserWindow', () => new BrowserWindow(mainWindowOptions));
  //win.openDevTools()
  win.webContents.on('did-finish-load', lateInit);

  win.on('closed', () => {
    win = null;
    app.quit();
  });

  measurePerformanceAsync('Loading index.html', win.loadFile.bind(win, 'index.html'));
}

function startMediaPlaybackPowerHint() {
  measurePerformance('Enabling power save blocker', () => {
    if (typeof startMediaPlaybackPowerHint.powerSaveBlockerId === 'undefined') {
      startMediaPlaybackPowerHint.powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
      console.log(`Power Save Blocker started: ${startMediaPlaybackPowerHint.powerSaveBlockerId}`);
    } else {
      console.log(`Power Save Blocker is already active: ${startMediaPlaybackPowerHint.powerSaveBlockerId}`);
    }
  });
}

function stopMediaPlaybackPowerHint() {
  measurePerformance('Disabling power save blocker', () => {
    if (typeof startMediaPlaybackPowerHint.powerSaveBlockerId !== 'undefined') {
      powerSaveBlocker.stop(startMediaPlaybackPowerHint.powerSaveBlockerId);
      console.log(`Power Save Blocker stopped: ${startMediaPlaybackPowerHint.powerSaveBlockerId}`);
      startMediaPlaybackPowerHint.powerSaveBlockerId = undefined;
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
  return settings.get(setting);
}

function handleCloseMediaWindow(event, id) {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    mediaWindow.close();
  }
}

function localMediaStateUpdate(event, id, state) {
  switch (state) {
    case "play":
      startMediaPlaybackPowerHint();
      break;
    case "stop":
      stopMediaPlaybackPowerHint();
      break;
  }
}


async function handleCreateMediaWindow(event, windowOptions, displayIndex) {
  return measurePerformance('Creating media window', async () => {
    const displays = screen.getAllDisplays();

    // Save the selected display index
    await settings.set('lastDisplayIndex', displayIndex).catch(error => {
      console.error('Error saving display preference:', error);
    });

    // Use selected display or fall back
    const targetDisplay = displays[displayIndex] ||
      displays.find(d => d.bounds.x !== 0 || d.bounds.y !== 0) ||
      displays[0];

    const finalWindowOptions = {
      ...windowOptions,
      backgroundThrottling: false,
      backgroundColor: '#00000000',
      transparent: true,
      fullscreen: true,
      frame: false,
      x: targetDisplay.bounds.x,
      y: targetDisplay.bounds.y,
      width: targetDisplay.bounds.width,
      height: targetDisplay.bounds.height
    };

    mediaWindow = new BrowserWindow(finalWindowOptions);
    mediaWindow.loadFile("media.html");
    mediaWindow.on('closed', () => {
      if (win) win.webContents.send('media-window-closed', mediaWindow.id);
      stopMediaPlaybackPowerHint();
    });

    return mediaWindow.id;
  });
}

async function handleDisplayChange() {
  const currentDisplays = screen.getAllDisplays();
  
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    const currentBounds = mediaWindow.getBounds();
    const currentDisplayIndex = await settings.get('lastDisplayIndex');
    
    // Save current state if we haven't yet
    if (!lastKnownDisplayState) {
      lastKnownDisplayState = {
        bounds: currentBounds,
        displayIndex: currentDisplayIndex
      };
    }

    // Check if the display the window was on is still available
    const isOnValidDisplay = currentDisplays.some(display => 
      currentBounds.x >= display.bounds.x &&
      currentBounds.y >= display.bounds.y &&
      currentBounds.x < display.bounds.x + display.bounds.width &&
      currentBounds.y < display.bounds.y + display.bounds.height
    );

    if (!isOnValidDisplay) {
      // Display was disconnected - move window to primary display
      wasDisplayDisconnected = true;
      const primaryDisplay = screen.getPrimaryDisplay();
      mediaWindow.setBounds({
        x: primaryDisplay.bounds.x,
        y: primaryDisplay.bounds.y,
        width: primaryDisplay.bounds.width,
        height: primaryDisplay.bounds.height
      });
      
      // Save the last known good state if we haven't already
      await settings.set('lastMediaWindowBounds', lastKnownDisplayState.bounds);
      await settings.set('lastDisplayIndex', lastKnownDisplayState.displayIndex);
    } else if (wasDisplayDisconnected) {
      // Check if the original display is back
      const savedBounds = await settings.get('lastMediaWindowBounds');
      const savedDisplayIndex = await settings.get('lastDisplayIndex');
      
      if (savedBounds && savedDisplayIndex !== undefined) {
        const targetDisplay = currentDisplays[savedDisplayIndex];
        
        // If the original display is back, restore the window
        if (targetDisplay && findDisplayByBounds(currentDisplays, targetDisplay.bounds)) {
          mediaWindow.setBounds({
            x: targetDisplay.bounds.x,
            y: targetDisplay.bounds.y,
            width: targetDisplay.bounds.width,
            height: targetDisplay.bounds.height
          });
          wasDisplayDisconnected = false;
          lastKnownDisplayState = null;
        }
      }
    }
  }

  // Notify renderer about display change
  if (win && !win.isDestroyed()) {
    win.webContents.send('display-changed');
  }
}

function handlePlayCtl(event, cmd, id) {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    mediaWindow.send('play-ctl', cmd);
    startMediaPlaybackPowerHint();
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
  settings.set('operating-mode', arg)
    .catch(error => {
      console.error('Error saving window bounds:', error);
    });
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

const DRM_PATH = '/sys/class/drm';

function parseManufacturerId(edidBuffer) {
  try {
    const manBytes = edidBuffer.readUInt16BE(8);
    if (manBytes === 0 || manBytes === 0xFFFF) return null;

    // Calculate ASCII codes and verify they're valid uppercase letters
    const char1 = ((manBytes >> 10) & 0x1F) + 64;
    const char2 = ((manBytes >> 5) & 0x1F) + 64;
    const char3 = (manBytes & 0x1F) + 64;

    // Verify each character is a valid uppercase letter
    if (char1 < 65 || char1 > 90 ||
      char2 < 65 || char2 > 90 ||
      char3 < 65 || char3 > 90) {
      return null;
    }

    return String.fromCharCode(char1, char2, char3);
  } catch {
    return null;
  }
}

function parseDescriptorBlock(edidBuffer, blockStart) {
  try {
    // Validate block header
    if (edidBuffer[blockStart] !== 0 || edidBuffer[blockStart + 1] !== 0) {
      return null;
    }

    // Get descriptor type
    const descriptorType = edidBuffer[blockStart + 3];

    // Parse text fields
    if (descriptorType === 0xFC || descriptorType === 0xFF) { // Monitor name or Serial
      let text = '';
      for (let i = 0; i < 13; i++) {
        const charCode = edidBuffer[blockStart + 5 + i];
        // Stop at terminator or invalid characters
        if (charCode === 0x0A || charCode === 0x00 || charCode > 127) break;
        // Only accept printable ASCII
        if (charCode >= 32) {
          text += String.fromCharCode(charCode);
        }
      }
      return {
        type: descriptorType,
        text: text.trim()
      };
    }
    return null;
  } catch {
    return null;
  }
}

function validateResolution(width, height) {
  // Sanity check for reasonable resolution values
  return width >= 640 && width <= 7680 &&
    height >= 480 && height <= 4320;
}

function parseEdid(edidBuffer) {
  try {
    // Verify buffer size
    if (!edidBuffer || edidBuffer.length < 128) {
      throw new Error('EDID data too short');
    }

    // Verify EDID header
    const header = Buffer.from([0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00]);
    if (!edidBuffer.subarray(0, 8).equals(header)) {
      throw new Error('Invalid EDID header');
    }

    // Parse with fallbacks for each section
    const result = {
      manufacturer: null,
      modelName: null,
      serialNumber: null,
      year: null,
      week: null,
      resolution: null
    };

    // Manufacturer ID
    result.manufacturer = parseManufacturerId(edidBuffer);

    // Parse descriptor blocks
    for (let i = 54; i <= 108; i += 18) {
      try {
        const block = parseDescriptorBlock(edidBuffer, i);
        if (block) {
          if (block.type === 0xFC && !result.modelName) {
            result.modelName = block.text;
          } else if (block.type === 0xFF && !result.serialNumber) {
            result.serialNumber = block.text;
          }
        }
      } catch {
        continue; // Skip invalid blocks
      }
    }

    // Manufacturing date
    try {
      const week = edidBuffer[16];
      const year = edidBuffer[17] + 1990;

      // Validate date is reasonable
      if (week >= 1 && week <= 53 && year >= 1990 && year <= new Date().getFullYear()) {
        result.week = week;
        result.year = year;
      }
    } catch {
      // Keep null values if date parsing fails
    }

    // Resolution
    try {
      const hPixels = ((edidBuffer[4] >> 4) & 0x0F) * 16 + edidBuffer[2];
      const vPixels = ((edidBuffer[7] >> 4) & 0x0F) * 16 + edidBuffer[5];

      if (validateResolution(hPixels, vPixels)) {
        result.resolution = {
          width: hPixels,
          height: vPixels
        };
      }
    } catch {
      // Keep null resolution if parsing fails
    }

    // Generate display name with fallbacks
    let displayName = '';
    if (result.manufacturer) displayName += result.manufacturer + ' ';
    if (result.modelName) {
      displayName += result.modelName;
    } else {
      displayName += 'Display';
    }

    return {
      ...result,
      displayName: displayName.trim()
    };
  } catch (error) {
    console.error('EDID parse error:', error);
    return null;
  }
}

async function getConnectedDisplays() {
  try {
    const entries = await readdir(DRM_PATH);
    const displays = await Promise.all(entries.map(async (entry) => {
      if (!entry.match(/card\d+[-\w]+/)) return null;

      const displayPath = path.join(DRM_PATH, entry);
      try {
        // Check if display is connected
        const statusPath = path.join(displayPath, 'status');
        const status = await readFile(statusPath, 'utf8').catch(() => 'disconnected');
        if (status.trim() !== 'connected') return null;

        // Try to read EDID
        const edidPath = path.join(displayPath, 'edid');
        let edidInfo = null;

        try {
          const edidBuffer = await readFile(edidPath);
          edidInfo = parseEdid(edidBuffer);
        } catch (edidError) {
          console.debug(`Failed to read EDID for ${entry}:`, edidError);
        }

        const isInternalDisplay = entry.includes('eDP');
        const name = edidInfo?.displayName || entry.replace(/^card\d+-/, '');

        // Return all information without attempting to match displays yet
        return {
          path: displayPath,
          name,
          manufacturer: edidInfo?.manufacturer || null,
          serialNumber: edidInfo?.serialNumber || null,
          manufactureDate: edidInfo?.year ? {
            year: edidInfo.year,
            week: edidInfo.week
          } : null,
          nativeResolution: edidInfo?.resolution || null,
          internal: isInternalDisplay,
          connector: entry
        };
      } catch (error) {
        console.debug(`Error processing display ${entry}:`, error);
        return null;
      }
    }));

    return displays.filter(Boolean);
  } catch (error) {
    console.error('Failed to get display info:', error);
    return [];
  }
}

async function handleGetAllDisplays() {
  const displays = screen.getAllDisplays();
  let edidDisplayInfo = [];

  // Get saved display preference from electron-settings
  const savedDisplayIndex = await settings.get('lastDisplayIndex');
  let defaultDisplayIndex;

  if (savedDisplayIndex !== undefined && displays[savedDisplayIndex]) {
    // Use saved preference if it exists and is valid
    defaultDisplayIndex = savedDisplayIndex;
  } else {
    // No saved preference or invalid - fall back to secondary display
    defaultDisplayIndex = displays.findIndex(d => d.bounds.x !== 0 || d.bounds.y !== 0);
    if (defaultDisplayIndex === -1) defaultDisplayIndex = 0;
  }

  // Only Linux needs EDID info for display names
  if (process.platform === 'linux') {
    try {
      edidDisplayInfo = await getConnectedDisplays();
    } catch (error) {
      console.error('Failed to get EDID info:', error);
    }
  }

  if (isDevMode) {
    console.log('Saved display index:', savedDisplayIndex);
    console.log('Default display index:', defaultDisplayIndex);
    console.log('All displays:', displays);
  }

  const displayOptions = displays.map((display, index) => {
    let name;

    switch (process.platform) {
      case 'linux':
        const edidDisplay = edidDisplayInfo.find(info => {
          return display.bounds.width === 2520 && display.bounds.height === 1680 ?
            info.connector.includes('eDP') :
            info.connector.includes('HDMI');
        });

        if (edidDisplay) {
          if (edidDisplay.name.includes(edidDisplay.manufacturer)) {
            name = edidDisplay.name;
          } else {
            const manufacturerPrefix = edidDisplay.manufacturer ? `${edidDisplay.manufacturer} ` : '';
            name = manufacturerPrefix ? `${manufacturerPrefix}${edidDisplay.name}` : edidDisplay.name;
          }
        }
        break;

      case 'win32':
      case 'darwin':
        name = display.label;
        break;

      default:
        name = display.label || 'Display';
    }

    name = name || (display.internal ? 'Internal Display' : 'External Display');

    return {
      value: index,
      label: `${name} ${display.bounds.width}x${display.bounds.height}`,
      isSecondary: display.bounds.x !== 0 || display.bounds.y !== 0,
      x: display.bounds.x,
      y: display.bounds.y,
      internal: display.internal,
      bounds: {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height
      }
    };
  });

  return {
    displays: displayOptions,
    defaultDisplayIndex
  };
}

function handleSetDisplayIndex(event, index) {
  settings.set('lastDisplayIndex', index)
      .catch(error => {
          console.error('Error saving display index:', error);
      });

  // If there's an active media window, move it to the new display
  if (mediaWindow && !mediaWindow.isDestroyed()) {
      const displays = screen.getAllDisplays();
      const targetDisplay = displays[index] || 
                          displays.find(d => d.bounds.x !== 0 || d.bounds.y !== 0) || 
                          displays[0];

      mediaWindow.setBounds({
          x: targetDisplay.bounds.x,
          y: targetDisplay.bounds.y,
          width: targetDisplay.bounds.width,
          height: targetDisplay.bounds.height
      });
  }
}

app.once('browser-window-created', async () => {
  ipcMain.on('set-mode', handleSetMode);
  ipcMain.handle('get-setting', getSetting);
  ipcMain.handle('get-all-displays', handleGetAllDisplays);
  ipcMain.on('remoteplaypause', handleRemotePlayPause);
  ipcMain.on('localMediaState', localMediaStateUpdate);
  ipcMain.on('playback-state-change', handlePlaybackStateChange);
  ipcMain.handle('get-media-current-time', handleGetMediaCurrentTime);
  ipcMain.on('close-media-window', handleCloseMediaWindow);
  ipcMain.on('timeRemaining-message', sendRemainingTime);
  ipcMain.on('vlcl', handleVlcl);
  ipcMain.handle('create-media-window', handleCreateMediaWindow);
  ipcMain.on('timeGoto-message', handleTimeGotoMessage);
  ipcMain.on('play-ctl', handlePlayCtl);
  ipcMain.on('set-display-index', handleSetDisplayIndex);
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
  screen.on('display-added', handleDisplayChange);
  screen.on('display-removed', handleDisplayChange);
  screen.on('display-metrics-changed', handleDisplayChange);
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
    preload: `${import.meta.dirname}/app_preload.mjs`,
  }
};