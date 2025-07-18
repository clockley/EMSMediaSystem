/*
Copyright (C) 2019-2024 Christian Lockley
This library is free software; you can redistribute it and/or modify it
under the terms of the GNU General Public License as published by
the Free Software Foundation; either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
Lesser General Public License for more details.

You should have received a copy of the GNU General Public License
along with this library. If not, see <https://www.gnu.org/licenses/>.
*/

//import { enableCompileCache } from 'module';
//process.env.NODE_COMPILE_CACHE = enableCompileCache().directory;
import { app, BrowserWindow, ipcMain, screen, powerSaveBlocker, session, shell } from 'electron/main';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import settings from './settings.min.mjs'
let sessionID = 0;
const isDevMode = process.env.ems_dev === 'true';
const openDevConsole = process.env.ems_dev_console === 'true';
let lastKnownDisplayState = null;
let wasDisplayDisconnected = false;
let aboutWindow = null;
let helpWindow = null;
app.commandLine.appendSwitch('js-flags', '--maglev --no-use-osr');
settings.init(app.getPath('userData'));

if (isDevMode) {
  console.log(process.versions);

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
  return settings.getSync('windowBounds');
}

//not ideal but this is necessary to keep compatibility with older config file
function getHelpWindowBounds() {
  return settings.getSync('windowHelpBounds');
}

let mediaWindow = null;
let windowBounds = measurePerformance('Getting window bounds', getWindowBounds);
let win = null;

function saveWindowBounds(bounds) {
  settings.set('windowBounds', bounds)
    .catch(error => {
      console.error('Error saving window bounds:', error);
    });
};

function saveHelpWindowBounds(bounds) {
  settings.set('windowHelpBounds', bounds)
    .catch(error => {
      console.error('Error saving window bounds:', error);
    });
};

async function checkHelpWindowState() {
  const bounds = helpWindow.getBounds();
  saveHelpWindowBounds(bounds);
  const targetScreen = screen.getDisplayMatching(bounds);

  if (helpWindow.isMaximized()) {
    helpWindow.webContents.send('window-maximized', true);
    return;
  }

  // Check if window is actually tiled/snapped
  // A window is considered tiled if it touches TWO or more edges
  const touchingLeft = bounds.x === 0;
  const touchingTop = bounds.y === 0;
  const touchingRight = bounds.x + bounds.width === targetScreen.bounds.width;
  const touchingBottom = bounds.y + bounds.height === targetScreen.bounds.height;

  const edgeCount = [touchingLeft, touchingTop, touchingRight, touchingBottom]
    .filter(Boolean).length;

  const isTiled = edgeCount >= 2;  // Only consider it tiled if touching multiple edges

  helpWindow.webContents.send('window-maximized', isTiled);
}

async function checkWindowState() {
  const bounds = win.getBounds();
  saveWindowBounds(bounds);
  const targetScreen = screen.getDisplayMatching(bounds);

  if (win.isMaximized()) {
    win.webContents.send('window-maximized', true);
    return;
  }

  // Check if window is actually tiled/snapped
  // A window is considered tiled if it touches TWO or more edges
  const touchingLeft = bounds.x === 0;
  const touchingTop = bounds.y === 0;
  const touchingRight = bounds.x + bounds.width === targetScreen.bounds.width;
  const touchingBottom = bounds.y + bounds.height === targetScreen.bounds.height;

  const edgeCount = [touchingLeft, touchingTop, touchingRight, touchingBottom]
    .filter(Boolean).length;

  const isTiled = edgeCount >= 2;  // Only consider it tiled if touching multiple edges

  win.webContents.send('window-maximized', isTiled);
}

function lateInit() {
  measurePerformance('Setting window aspect ratio', win.setAspectRatio.bind(win, 1.778));
  win.show();
}

function handleMaximizeChange(isMaximized) {
  saveWindowBounds();
  win.setBackgroundColor('#00000000');
  win?.webContents.send('maximize-change', isMaximized);
}

function handleMaximizeChangeHelpWindow(isMaximized) {
  saveHelpWindowBounds();
  helpWindow.setBackgroundColor('#00000000');
  helpWindow?.webContents.send('maximize-change', isMaximized);
}

function createWindow() {
  win = measurePerformance('Creating BrowserWindow', () => new BrowserWindow(mainWindowOptions));
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
  });
  if (openDevConsole) {
    win.openDevTools();
  }

  win.webContents.on('did-finish-load', lateInit);
  win.on('maximize', handleMaximizeChange.bind(null, true));
  win.on('unmaximize', handleMaximizeChange.bind(null, false));

  win.on('closed', async () => {
    win = null;
    app.quit();
    await settings.flush();
  });

  measurePerformanceAsync('Loading index.prod.html', win.loadFile.bind(win, `${path.dirname(import.meta.dirname)}/src/index.prod.html`));
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
  let tarr = new Float64Array([arg[0], arg[1], arg[2]]);
  win?.webContents.send('timeRemaining-message', tarr, [tarr]);
}

function getSetting(_, setting) {
  return settings.getSync(setting);
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
      icon: `${import.meta.dirname}/icon.png`,
      x: targetDisplay.bounds.x,
      y: targetDisplay.bounds.y,
      width: targetDisplay.bounds.width,
      height: targetDisplay.bounds.height
    };

    mediaWindow = new BrowserWindow(finalWindowOptions);
    //mediaWindow.openDevTools()
    await mediaWindow.loadFile("derived/src/media.prod.html");
    mediaWindow.on('closed', () => {
      if (win) win.webContents.send('media-window-closed', mediaWindow.id);
      stopMediaPlaybackPowerHint();
    });

    // Save the selected display index
    settings.set('lastDisplayIndex', displayIndex).catch(error => {
      console.error('Error saving display preference:', error);
    });

    return mediaWindow.id;
  });
}

async function handleDisplayChange() {
  const currentDisplays = screen.getAllDisplays();

  if (mediaWindow && !mediaWindow.isDestroyed()) {
    const currentBounds = mediaWindow.getBounds();
    const currentDisplayIndex = settings.getSync('lastDisplayIndex');

    if (!lastKnownDisplayState) {
      lastKnownDisplayState = {
        bounds: currentBounds,
        displayIndex: currentDisplayIndex
      };
    }

    const isOnValidDisplay = currentDisplays.some(display =>
      currentBounds.x >= display.bounds.x &&
      currentBounds.y >= display.bounds.y &&
      currentBounds.x < display.bounds.x + display.bounds.width &&
      currentBounds.y < display.bounds.y + display.bounds.height
    );

    if (!isOnValidDisplay) {
      wasDisplayDisconnected = true;
      const primaryDisplay = screen.getPrimaryDisplay();
      mediaWindow.setBounds({
        x: primaryDisplay.bounds.x,
        y: primaryDisplay.bounds.y,
        width: primaryDisplay.bounds.width,
        height: primaryDisplay.bounds.height
      });

      await settings.set('lastMediaWindowBounds', lastKnownDisplayState.bounds);
      await settings.set('lastDisplayIndex', lastKnownDisplayState.displayIndex);
    } else if (wasDisplayDisconnected) {
      const savedBounds = settings.getSync('lastMediaWindowBounds');
      const savedDisplayIndex = settings.getSync('lastDisplayIndex');

      if (savedBounds && savedDisplayIndex !== undefined) {
        const targetDisplay = currentDisplays[savedDisplayIndex];

        if (targetDisplay) {  // Ensure targetDisplay is defined
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

async function handleSetLoopStatus(event, arg) {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    if (arg !== undefined) {
      if (arg === true) {
        await mediaWindow.webContents.executeJavaScript('window.api.video.loop=true');
      } else {
        await mediaWindow.webContents.executeJavaScript('window.api.video.loop=false');
      }
    }
    return await mediaWindow.webContents.executeJavaScript('window.api.video.loop');
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

      const displayPath = DRM_PATH + '/' + entry;
      try {
        // Check if display is connected
        const statusPath = displayPath + '/' + 'status';
        const status = await readFile(statusPath, 'utf8').catch(() => 'disconnected');
        if (status.trim() !== 'connected') return null;

        // Try to read EDID
        const edidPath = displayPath + '/' + 'edid';
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
  const savedDisplayIndex = settings.getSync('lastDisplayIndex');

  let defaultDisplayIndex;
  if (savedDisplayIndex !== undefined && displays[savedDisplayIndex]) {
    defaultDisplayIndex = savedDisplayIndex;
  } else {
    defaultDisplayIndex = displays.findIndex(d => d.bounds.x !== 0 || d.bounds.y !== 0);
    if (defaultDisplayIndex === -1) defaultDisplayIndex = 0;
  }

  if (process.platform === 'linux') {
    try {
      edidDisplayInfo = await getConnectedDisplays();

      // Sort EDID info to match Electron's display order
      edidDisplayInfo.sort((a, b) => {
        // Put internal display (eDP) first
        const aIsInternal = a.connector.includes('eDP');
        const bIsInternal = b.connector.includes('eDP');
        if (aIsInternal !== bIsInternal) return bIsInternal ? 1 : -1;

        // Then sort by connector number
        const aNum = parseInt(a.connector.match(/\d+/)?.[0] || 0);
        const bNum = parseInt(b.connector.match(/\d+/)?.[0] || 0);
        return aNum - bNum;
      });
    } catch (error) {
      console.error('Failed to get EDID info:', error);
    }
  }

  if (isDevMode) {
    console.log('EDID Display Info:', edidDisplayInfo);
    console.log('Electron Displays:', displays);
  }

  const displayOptions = displays.map((display, index) => {
    let name;

    switch (process.platform) {
      case 'linux':
        // Match displays based on index after sorting
        const matchingDisplay = edidDisplayInfo[index];

        if (matchingDisplay) {
          const manufacturer = matchingDisplay.manufacturer ? `${matchingDisplay.manufacturer} ` : '';
          name = matchingDisplay.name.includes(manufacturer) ?
            matchingDisplay.name :
            `${manufacturer}${matchingDisplay.name}`;
        } else {
          name = display.internal ? 'Internal Display' : 'External Display';
        }
        break;

      case 'win32':
      case 'darwin':
        name = display.label;
        break;

      default:
        name = display.label || 'Display';
    }

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

async function getSystemTIme() {
  const [seconds, nanoseconds] = process.hrtime();
  return {
    systemTime: seconds + (nanoseconds / 1e9),
    ipcTimestamp: Date.now()
  };
}

function createHelpWindow() {
  if (helpWindow != null && !helpWindow?.isDestroyed()) {
    if (helpWindow.isMinimized()) {
      helpWindow.restore();
    }
    helpWindow.focus();
    return;
  }
  const primaryDisplay = screen.getPrimaryDisplay();
  const { x, y, width } = primaryDisplay.workArea;
  let helpWindowX = x + 50;
  let helpWindowY = y + 50;
  let ovrdHWindBnd = getHelpWindowBounds();
  if (ovrdHWindBnd != undefined) {
    helpWindowX = ovrdHWindBnd.x;
    helpWindowY = ovrdHWindBnd.y;
  }

  helpWindow = new BrowserWindow({
    width: ovrdHWindBnd.width,
    height: ovrdHWindBnd.height,
    minWidth: 700,
    minHeight: 600,
    resizable: true,
    minimizable: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    x: helpWindowX,
    y: helpWindowY,
    title: "Help",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: false,
      sandbox: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      preload: `${path.dirname(import.meta.dirname)}/src/help_preload.min.mjs`,
      devTools: false
    }
  });

  helpWindow.loadFile('derived/src/help.prod.html');

  helpWindow.on('move', checkHelpWindowState);
  helpWindow.on('resize', checkHelpWindowState);
  helpWindow.on('maximize', handleMaximizeChangeHelpWindow.bind(null, true));
  helpWindow.on('unmaximize', handleMaximizeChangeHelpWindow.bind(null, false));
  helpWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return helpWindow;
}

function createAboutWindow(parentWindow) {
  if (aboutWindow != null && !aboutWindow?.isDestroyed()) {
    return;
  }
  aboutWindow = new BrowserWindow({
    parent: parentWindow,
    modal: true,
    width: 500,
    height: 480,
    resizable: false,
    minimizable: false,
    frame: false,
    transparent: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: false,
      sandbox: true,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: false
    }
  });

  aboutWindow.loadFile('derived/src/about.prod.html');

  // Position it centered relative to parent
  aboutWindow.once('ready-to-show', () => {
    const parentBounds = parentWindow.getBounds();
    const x = parentBounds.x + (parentBounds.width - 500) / 2;
    const y = parentBounds.y + (parentBounds.height - 480) / 2;
    aboutWindow.setBounds({ x, y, width: 500, height: 480 });
    aboutWindow.show();
  });

  aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return aboutWindow;
}

function setIPC() {
  ipcMain.handle('get-system-time', getSystemTIme);
  ipcMain.on('set-mode', handleSetMode);
  ipcMain.handle('get-setting', getSetting);
  ipcMain.handle('get-all-displays', handleGetAllDisplays);
  ipcMain.on('remoteplaypause', handleRemotePlayPause);
  ipcMain.on('localMediaState', localMediaStateUpdate);
  ipcMain.on('playback-state-change', handlePlaybackStateChange);
  ipcMain.handle('get-media-current-time', handleGetMediaCurrentTime);
  ipcMain.handle('set-media-loop-status', handleSetLoopStatus);
  ipcMain.on('close-media-window', handleCloseMediaWindow);
  ipcMain.on('timeRemaining-message', sendRemainingTime);
  ipcMain.on('vlcl', handleVlcl);
  ipcMain.handle('create-media-window', handleCreateMediaWindow);
  ipcMain.on('timeGoto-message', handleTimeGotoMessage);
  ipcMain.on('play-ctl', handlePlayCtl);
  ipcMain.on('set-display-index', handleSetDisplayIndex);
  ipcMain.on('media-seekto', (event, seekTime) => {
    win?.webContents.send('timeGoto-message', {
      currentTime: seekTime,
      timestamp: Date.now()
    })
  });
  ipcMain.on('minimize-window', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    senderWindow.minimize();
  });

  ipcMain.on('load-theme', (event, theme) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    senderWindow.webContents.executeJavaScript(`document.body.classList.add('${theme}')`);
  });

  ipcMain.on('remove-theme', (event, theme) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    senderWindow.webContents.executeJavaScript(`document.body.classList.remove('${theme}')`);
  });

  ipcMain.on('maximize-window', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);

    if (senderWindow) {
      if (senderWindow.isMaximized()) {
        senderWindow.unmaximize();
      } else {
        senderWindow.maximize();
      }
    }
  });
  ipcMain.handle('open-about-window', (event) => {
    const mainWindow = BrowserWindow.fromWebContents(event.sender);
    createAboutWindow(mainWindow);
  });
  ipcMain.handle('open-help-window', (event) => {
    createHelpWindow();
  });
  ipcMain.handle('get-session-id', () => {
    if (sessionID === 0) {
      sessionID = process.hrtime.bigint().toString(36) + Math.random().toString(36).substr(2, 9);
    }
    return sessionID;
  });
}

app.once('browser-window-created', setIPC);

app.on('browser-window-created', (event, window) => {
  window.webContents.on('did-finish-load', () => {
    //window.webContents.executeJavaScript(`document.body.classList.add('windows-xp-theme')`);
    //theme.load(window);
  });
});

function loadTheme() {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((win, index) => {
    theme.load(win);
  });
}

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
  //needed for high performance timers in renderer
  const headersHandler = (details, callback) => {
    if (!details.responseHeaders) details.responseHeaders = {};

    details.responseHeaders['Cross-Origin-Opener-Policy'] = ['same-origin'];
    details.responseHeaders['Cross-Origin-Embedder-Policy'] = ['require-corp'];

    callback({ responseHeaders: details.responseHeaders });
  };

  session.defaultSession.webRequest.onHeadersReceived(headersHandler);
  measurePerformance('Creating window', createWindow);
  if (isDevMode) {
    const appReadyTime = performance.now();
    console.log(`Application ready in ${(appReadyTime - appStartTime).toFixed(2)} ms`);
  }

  win.on('move', checkWindowState);
  win.on('resize', checkWindowState);

  screen.on('display-added', handleDisplayChange);
  screen.on('display-removed', handleDisplayChange);
  screen.on('display-metrics-changed', handleDisplayChange);
});

const mainWindowOptions = {
  frame: false,
  transparent: true,
  width: windowBounds ? windowBounds.width : 960,
  height: windowBounds ? windowBounds.height : 540,
  x: windowBounds ? windowBounds.x : 0,
  y: windowBounds ? windowBounds.y : 0,
  minWidth: 960,
  minHeight: 540,
  icon: `${import.meta.dirname}/icon.png`,
  paintWhenInitiallyHidden: true,
  show: false,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: true,
    v8CacheOptions: 'bypassHeatCheck',
    userGesture: true,
    backgroundThrottling: false,
    experimentalFeatures: true,
    autoplayPolicy: 'no-user-gesture-required',
    preload: `${path.dirname(import.meta.dirname)}/src/app_preload.min.mjs`,
    devTools: isDevMode
  }
};
