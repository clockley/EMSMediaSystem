/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

//import { enableCompileCache } from 'module';
//process.env.NODE_COMPILE_CACHE = enableCompileCache().directory;
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  screen,
  powerSaveBlocker,
  session,
  shell,
} from "electron/main";
import { constants as fsConstants } from "fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import {
  baselineFileHashFields,
  hashMediaFile,
  MEDIA_FILE_HASH_ALG,
  storedFileHashFromRecord,
} from "./media-file-hash.min.mjs";
import { BibleRpcClient } from "./bible_rpc_client.min.mjs";
import { SongsRpcClient } from "./songs_rpc_client.min.mjs";
import { SlidesStore } from "./slides_store.min.mjs";
import settings from "./settings.min.mjs";
import {
  loadEmprojSnapshot,
  saveEmprojSnapshot,
  cleanupExtractedProjectMedia,
  readEmprojProjectGuid,
} from "./emproj.min.mjs";
import { MediaWatcher } from "./media-watcher.min.mjs";
import {
  StagingIndex,
  normalizeProjectGuid,
  normalizeSnapshotId,
  snapshotIdFromStagedFilename,
} from "./staging-index.min.mjs";
let sessionID = 0;
let innertubePromise = null;
const youtubePathNTransformCache = new Map();
const isDevMode = process.env.ems_dev === "true";
const openDevConsole = process.env.ems_dev_console === "true";
let lastKnownDisplayState = null;
let wasDisplayDisconnected = false;
let aboutWindow = null;
let helpWindow = null;
let queueSwitchDialogWindow = null;
/** IPC channel for queue-switch modal responses. */
const QUEUE_SWITCH_DIALOG_IPC_CHANNEL = "queue-switch-dialog-response";
let queueSwitchDialogResponseListener = null;
let preflightDialogWindow = null;
const PREFLIGHT_DIALOG_IPC_CHANNEL = "preflight-dialog-response";
let preflightDialogResponseListener = null;
let allowMainWindowClose = false;
let quitCleanupStarted = false;
const TIME_REMAINING_PORT_CHANNEL = "timeRemaining-port";
let pendingProjectOpenPath = null;
const bibleRpcClient = new BibleRpcClient({
  app,
  devRoot: path.dirname(import.meta.dirname),
});
const songsRpcClient = new SongsRpcClient({
  app,
  devRoot: path.dirname(import.meta.dirname),
});
const slidesStore = new SlidesStore({
  userDataPath: app.getPath("userData"),
});

app.commandLine.appendSwitch("enable-features", "CustomizableSelectElement");

// Force IPv4 for all outbound connections. YouTube signs HLS/DASH segment
// URLs against the *exact* client IP that requested the manifest (the URL
// embeds the IP in its path, e.g. `.../ip/<ipv6>/...`). When the host has
// IPv6, Chromium's "happy eyeballs" opens new sockets per fragment fetch
// and often lands on either a different IPv6 address (privacy extensions
// rotate the temporary address) or on IPv4, neither of which matches the
// IP encoded in the signed URL — and the segment server 403s every
// fragment. Pinning the network stack to IPv4 makes the egress IP stable
// across the manifest fetch and all subsequent segment fetches. Must run
// before `app.whenReady` so the network service starts in IPv4-only mode.
app.commandLine.appendSwitch("disable-ipv6");

settings.init(app.getPath("userData"));

/**
 * Fullscreen presentation window must not use {@link session.defaultSession}.
 * Set in {@link app.whenReady} — {@link session.fromPartition} is invalid before then.
 */
let mediaPresentationSession = null;

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
  return settings.getSync("windowBounds");
}

//not ideal but this is necessary to keep compatibility with older config file
function getHelpWindowBounds() {
  return settings.getSync("windowHelpBounds");
}

let mediaWindow = null;
let lowerThirdWindow = null;
let mediaWindowCreatePromise = null;
let windowBounds = measurePerformance("Getting window bounds", getWindowBounds);
let win = null;
const mediaWatcher = new MediaWatcher({
  app,
  devRoot: path.dirname(import.meta.dirname),
  sendToRenderer(channel, payload) {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  },
});

function isProjectFilePath(filePath) {
  return (
    typeof filePath === "string" &&
    /\.(emproj|zip)$/i.test(filePath)
  );
}

function firstProjectPathFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv) {
    if (isProjectFilePath(arg)) return arg;
  }
  return null;
}

function dispatchProjectOpenPath(filePath) {
  if (!isProjectFilePath(filePath)) return;
  pendingProjectOpenPath = filePath;
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send("open-project-path", filePath);
  }
}

function saveWindowBounds(bounds) {
  settings.set("windowBounds", bounds).catch((error) => {
    console.error("Error saving window bounds:", error);
  });
}

function saveHelpWindowBounds(bounds) {
  settings.set("windowHelpBounds", bounds).catch((error) => {
    console.error("Error saving window bounds:", error);
  });
}

async function checkHelpWindowState() {
  const bounds = helpWindow.getBounds();
  saveHelpWindowBounds(bounds);
  const targetScreen = screen.getDisplayMatching(bounds);

  if (helpWindow.isMaximized()) {
    helpWindow.webContents.send("window-maximized", true);
    return;
  }

  // Check if window is actually tiled/snapped
  // A window is considered tiled if it touches TWO or more edges
  const touchingLeft = bounds.x === 0;
  const touchingTop = bounds.y === 0;
  const touchingRight = bounds.x + bounds.width === targetScreen.bounds.width;
  const touchingBottom =
    bounds.y + bounds.height === targetScreen.bounds.height;

  const edgeCount = [
    touchingLeft,
    touchingTop,
    touchingRight,
    touchingBottom,
  ].filter(Boolean).length;

  const isTiled = edgeCount >= 2; // Only consider it tiled if touching multiple edges

  helpWindow.webContents.send("window-maximized", isTiled);
}

async function checkWindowState() {
  const bounds = win.getBounds();
  saveWindowBounds(bounds);
  const targetScreen = screen.getDisplayMatching(bounds);

  if (win.isMaximized()) {
    win.webContents.send("window-maximized", true);
    return;
  }

  // Check if window is actually tiled/snapped
  // A window is considered tiled if it touches TWO or more edges
  const touchingLeft = bounds.x === 0;
  const touchingTop = bounds.y === 0;
  const touchingRight = bounds.x + bounds.width === targetScreen.bounds.width;
  const touchingBottom =
    bounds.y + bounds.height === targetScreen.bounds.height;

  const edgeCount = [
    touchingLeft,
    touchingTop,
    touchingRight,
    touchingBottom,
  ].filter(Boolean).length;

  const isTiled = edgeCount >= 2; // Only consider it tiled if touching multiple edges

  win.webContents.send("window-maximized", isTiled);
}

function lateInit() {
  measurePerformance(
    "Setting window aspect ratio",
    win.setAspectRatio.bind(win, 1.778),
  );
  win.show();
}

function handleMaximizeChange(isMaximized) {
  saveWindowBounds();
  win.setBackgroundColor("#00000000");
  win?.webContents.send("maximize-change", isMaximized);
}

function handleMaximizeChangeHelpWindow(isMaximized) {
  saveHelpWindowBounds();
  helpWindow.setBackgroundColor("#00000000");
  helpWindow?.webContents.send("maximize-change", isMaximized);
}

function createWindow() {
  if (!gotSingleInstanceLock) return;
  win = measurePerformance(
    "Creating BrowserWindow",
    () => new BrowserWindow(mainWindowOptions),
  );
  win.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
  });
  if (openDevConsole) {
    win.openDevTools();
  }

  win.webContents.on("did-finish-load", lateInit);
  win.webContents.on("did-finish-load", installTimeRemainingMessagePort);
  win.webContents.on("did-finish-load", () => {
    if (pendingProjectOpenPath) {
      win.webContents.send("open-project-path", pendingProjectOpenPath);
    }
  });
  win.on("maximize", handleMaximizeChange.bind(null, true));
  win.on("unmaximize", handleMaximizeChange.bind(null, false));
  wireMainWindowCloseAutosave(win);

  win.on("closed", async () => {
    win = null;
    app.quit();
    await settings.flush();
  });

  measurePerformanceAsync(
    "Loading index.prod.html",
    win.loadFile.bind(
      win,
      `${path.dirname(import.meta.dirname)}/src/index.prod.html`,
    ),
  ).catch((error) => {
    if (app.isQuitting || !gotSingleInstanceLock) return;
    console.error("Failed to load main window:", error);
  });
}

function startMediaPlaybackPowerHint() {
  measurePerformance("Enabling power save blocker", () => {
    if (typeof startMediaPlaybackPowerHint.powerSaveBlockerId === "undefined") {
      startMediaPlaybackPowerHint.powerSaveBlockerId = powerSaveBlocker.start(
        "prevent-display-sleep",
      );
      console.log(
        `Power Save Blocker started: ${startMediaPlaybackPowerHint.powerSaveBlockerId}`,
      );
    } else {
      console.log(
        `Power Save Blocker is already active: ${startMediaPlaybackPowerHint.powerSaveBlockerId}`,
      );
    }
  });
}

function stopMediaPlaybackPowerHint() {
  measurePerformance("Disabling power save blocker", () => {
    if (typeof startMediaPlaybackPowerHint.powerSaveBlockerId !== "undefined") {
      powerSaveBlocker.stop(startMediaPlaybackPowerHint.powerSaveBlockerId);
      console.log(
        `Power Save Blocker stopped: ${startMediaPlaybackPowerHint.powerSaveBlockerId}`,
      );
      startMediaPlaybackPowerHint.powerSaveBlockerId = undefined;
    } else {
      console.log("No active Power Save Blocker to stop.");
    }
  });
}

function installTimeRemainingMessagePort() {
  if (
    !win ||
    win.isDestroyed() ||
    win.webContents.isDestroyed() ||
    !mediaWindow ||
    mediaWindow.isDestroyed() ||
    mediaWindow.webContents.isDestroyed()
  ) {
    return false;
  }

  const { port1, port2 } = new MessageChannelMain();
  try {
    win.webContents.postMessage(TIME_REMAINING_PORT_CHANNEL, null, [port1]);
    mediaWindow.webContents.postMessage(TIME_REMAINING_PORT_CHANNEL, null, [
      port2,
    ]);
    return true;
  } catch (err) {
    try {
      port1.close();
    } catch {}
    try {
      port2.close();
    } catch {}
    console.error("Failed to install time remaining MessagePort:", err);
    return false;
  }
}

function getSetting(_, setting) {
  if (setting === EMBEDDED_AUTOSAVE_STATE_KEY) return undefined;
  if (typeof setting === "string" && setting.length > 0) {
    return readSettings()[setting];
  }
  return readSettings();
}

function handleCloseMediaWindow(event, id) {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    mediaWindow.close();
  }
  // Closing the projection window ends any active YouTube live HLS session;
  // clear the flag so the next item (often a VOD) isn't given the iOS UA.
  youtubeLiveSessionActive = false;
}

function isMediaWindowCapturable() {
  return Boolean(
    mediaWindow &&
      !mediaWindow.isDestroyed() &&
      !mediaWindow.webContents.isDestroyed(),
  );
}

function handleMediaWindowCaptureAvailable() {
  return isMediaWindowCapturable();
}

function handleMediaWindowDisplayMediaRequest(request, callback) {
  if (!request.videoRequested || !isMediaWindowCapturable()) {
    callback({});
    return;
  }

  // Video-only frame capture keeps the Streams preview in-app; audio stays
  // routed through the normal presentation controls.
  callback({ video: mediaWindow.webContents.mainFrame });
}

async function handleCloseMediaWindowNow() {
  if (!mediaWindow || mediaWindow.isDestroyed()) {
    youtubeLiveSessionActive = false;
    return false;
  }

  const windowToClose = mediaWindow;
  const closed = new Promise((resolve) => {
    windowToClose.once("closed", () => resolve(true));
  });
  windowToClose.close();
  youtubeLiveSessionActive = false;
  return closed;
}

async function handleCloseLowerThirdWindowNow() {
  if (!lowerThirdWindow || lowerThirdWindow.isDestroyed()) {
    return false;
  }
  const windowToClose = lowerThirdWindow;
  const closed = new Promise((resolve) => {
    windowToClose.once("closed", () => resolve(true));
  });
  windowToClose.close();
  return closed;
}

function localMediaStateUpdate(event, id, state) {
  switch (state) {
    case "play":
      startMediaPlaybackPowerHint();
      break;
    case "stop":
      stopMediaPlaybackPowerHint();
      youtubeLiveSessionActive = false;
      break;
  }
}

function displayForExplicitIndex(displayIndex) {
  if (!Number.isInteger(displayIndex) || displayIndex < 0) return null;
  const displays = screen.getAllDisplays();
  return displays[displayIndex] || null;
}

function fullscreenWindowBoundsForDisplay(display) {
  return {
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
  };
}

function boundsPayload(bounds) {
  if (!bounds) return null;
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function handleGetMediaWindowBounds() {
  if (!mediaWindow || mediaWindow.isDestroyed()) return null;
  return boundsPayload(mediaWindow.getContentBounds?.() || mediaWindow.getBounds());
}

async function handleCreateMediaWindow(event, windowOptions, displayIndex) {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    const targetDisplay = displayForExplicitIndex(displayIndex);
    if (!targetDisplay) return null;
    mediaWindow.setBounds(fullscreenWindowBoundsForDisplay(targetDisplay));
    mediaWindow.setFullScreen(true);
    installTimeRemainingMessagePort();
    return mediaWindow.id;
  }
  if (mediaWindowCreatePromise) return mediaWindowCreatePromise;

  mediaWindowCreatePromise = measurePerformance("Creating media window", async () => {
    const targetDisplay = displayForExplicitIndex(displayIndex);
    if (!targetDisplay) return null;

    const { webPreferences: incomingPrefs = {}, ...restWindowOptions } =
      windowOptions;

    const finalWindowOptions = {
      ...restWindowOptions,
      backgroundThrottling: false,
      backgroundColor: "#00000000",
      transparent: true,
      fullscreen: true,
      frame: false,
      icon: `${import.meta.dirname}/icon.png`,
      ...fullscreenWindowBoundsForDisplay(targetDisplay),
      webPreferences: {
        ...incomingPrefs,
        session: mediaPresentationSession,
      },
    };

    const createdMediaWindow = new BrowserWindow(finalWindowOptions);
    mediaWindow = createdMediaWindow;
    createdMediaWindow.setIgnoreMouseEvents(true);
    //mediaWindow.openDevTools()
    await createdMediaWindow.loadFile("derived/src/media.prod.html");
    installTimeRemainingMessagePort();
    createdMediaWindow.on("closed", () => {
      const closedId = createdMediaWindow.id;
      const wasActiveMediaWindow = mediaWindow === createdMediaWindow;
      if (wasActiveMediaWindow) {
        mediaWindow = null;
        stopMediaPlaybackPowerHint();
        if (win && !win.isDestroyed()) {
          win.webContents.send("media-window-closed", closedId);
        }
      }
    });

    // Save the selected display index
    settings.set("lastDisplayIndex", displayIndex).catch((error) => {
      console.error("Error saving display preference:", error);
    });

    return createdMediaWindow.id;
  });

  try {
    return await mediaWindowCreatePromise;
  } finally {
    mediaWindowCreatePromise = null;
  }
}

async function handleCreateLowerThirdWindow(event, windowOptions, displayIndex) {
  return measurePerformance("Creating lower third window", async () => {
    const targetDisplay = displayForExplicitIndex(displayIndex);
    if (!targetDisplay) return null;

    const { webPreferences: incomingPrefs = {}, ...restWindowOptions } =
      windowOptions || {};
    const backgroundColor =
      typeof restWindowOptions.backgroundColor === "string"
        ? restWindowOptions.backgroundColor
        : "#00ff00";

    if (lowerThirdWindow && !lowerThirdWindow.isDestroyed()) {
      lowerThirdWindow.setBounds(fullscreenWindowBoundsForDisplay(targetDisplay));
      lowerThirdWindow.setFullScreen(true);
      lowerThirdWindow.setBackgroundColor(backgroundColor);
      return lowerThirdWindow.id;
    }

    const createdLowerThirdWindow = new BrowserWindow({
      ...restWindowOptions,
      backgroundThrottling: false,
      backgroundColor,
      transparent: false,
      fullscreen: true,
      frame: false,
      skipTaskbar: true,
      icon: `${import.meta.dirname}/icon.png`,
      ...fullscreenWindowBoundsForDisplay(targetDisplay),
      webPreferences: {
        ...incomingPrefs,
        session: mediaPresentationSession,
      },
    });
    lowerThirdWindow = createdLowerThirdWindow;
    createdLowerThirdWindow.setIgnoreMouseEvents(true);
    await createdLowerThirdWindow.loadFile("derived/src/media.prod.html");
    createdLowerThirdWindow.on("closed", () => {
      if (lowerThirdWindow === createdLowerThirdWindow) {
        lowerThirdWindow = null;
        if (win && !win.isDestroyed()) {
          win.webContents.send("lower-third-window-closed");
        }
      }
    });
    settings.set("lastLowerThirdDisplayIndex", displayIndex).catch((error) => {
      console.error("Error saving lower third display preference:", error);
    });
    return createdLowerThirdWindow.id;
  });
}

async function handleDisplayChange() {
  const currentDisplays = screen.getAllDisplays();

  if (mediaWindow && !mediaWindow.isDestroyed()) {
    const currentBounds = mediaWindow.getBounds();
    const currentDisplayIndex = settings.getSync("lastDisplayIndex");

    if (!lastKnownDisplayState) {
      lastKnownDisplayState = {
        bounds: currentBounds,
        displayIndex: currentDisplayIndex,
      };
    }

    const isOnValidDisplay = currentDisplays.some(
      (display) =>
        currentBounds.x >= display.bounds.x &&
        currentBounds.y >= display.bounds.y &&
        currentBounds.x < display.bounds.x + display.bounds.width &&
        currentBounds.y < display.bounds.y + display.bounds.height,
    );

    if (!isOnValidDisplay) {
      wasDisplayDisconnected = true;
      const primaryDisplay = screen.getPrimaryDisplay();
      mediaWindow.setBounds({
        x: primaryDisplay.bounds.x,
        y: primaryDisplay.bounds.y,
        width: primaryDisplay.bounds.width,
        height: primaryDisplay.bounds.height,
      });

      await settings.set("lastMediaWindowBounds", lastKnownDisplayState.bounds);
      await settings.set(
        "lastDisplayIndex",
        lastKnownDisplayState.displayIndex,
      );
    } else if (wasDisplayDisconnected) {
      const savedBounds = settings.getSync("lastMediaWindowBounds");
      const savedDisplayIndex = settings.getSync("lastDisplayIndex");

      if (savedBounds && savedDisplayIndex !== undefined) {
        const targetDisplay = currentDisplays[savedDisplayIndex];

        if (targetDisplay) {
          // Ensure targetDisplay is defined
          mediaWindow.setBounds({
            x: targetDisplay.bounds.x,
            y: targetDisplay.bounds.y,
            width: targetDisplay.bounds.width,
            height: targetDisplay.bounds.height,
          });
          wasDisplayDisconnected = false;
          lastKnownDisplayState = null;
        }
      }
    }
  }

  if (win && !win.isDestroyed()) {
    win.webContents.send("display-changed");
  }
}

function handlePlayCtl(event, cmd, id) {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    mediaWindow.send("play-ctl", cmd);
    startMediaPlaybackPowerHint();
  }
}

function handleRemotePlayPause(_, arg) {
  win.webContents.send("remoteplaypause", arg);
}

function handlePlaybackStateChange(event, playbackState) {
  if (win) {
    win.webContents.send("update-playback-state", playbackState);
  }
}

async function handleGetMediaCurrentTime() {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    const t = await mediaWindow.webContents.executeJavaScript(
      "window.api.video.currentTime",
    );
    return typeof t === "number" && Number.isFinite(t) ? t : 0;
  }
  return 0;
}

async function handleGetPptxCurrentSlide() {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    const slide = await mediaWindow.webContents.executeJavaScript(
      "typeof window.emsGetPptxCurrentSlide === 'function' ? window.emsGetPptxCurrentSlide() : null",
    );
    return typeof slide === "number" && Number.isFinite(slide) ? slide : null;
  }
  return null;
}

async function handleSetLoopStatus(event, arg) {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    if (arg !== undefined) {
      const enabled = arg === true;
      return await mediaWindow.webContents.executeJavaScript(
        `typeof window.emsSetLoopEnabled === "function" ? window.emsSetLoopEnabled(${enabled}) : (window.api && window.api.video ? (window.api.video.loop = ${enabled}, window.api.video.loop) : false)`,
      );
    }
    return await mediaWindow.webContents.executeJavaScript(
      'typeof window.emsGetLoopEnabled === "function" ? window.emsGetLoopEnabled() : !!(window.api && window.api.video && window.api.video.loop)',
    );
  }
  return false;
}

function handleSetMode(event, arg) {
  settings.set("operating-mode", arg).catch((error) => {
    console.error("Error saving window bounds:", error);
  });
}

function handleTimeGotoMessage(event, arg) {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    mediaWindow.send("timeGoto-message", arg);
  }
}

function handleVlcl(event, v, id) {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    mediaWindow.send("vlcl", v);
  }
}

const DRM_PATH = "/sys/class/drm";

function parseManufacturerId(edidBuffer) {
  try {
    const manBytes = edidBuffer.readUInt16BE(8);
    if (manBytes === 0 || manBytes === 0xffff) return null;

    // Calculate ASCII codes and verify they're valid uppercase letters
    const char1 = ((manBytes >> 10) & 0x1f) + 64;
    const char2 = ((manBytes >> 5) & 0x1f) + 64;
    const char3 = (manBytes & 0x1f) + 64;

    // Verify each character is a valid uppercase letter
    if (
      char1 < 65 ||
      char1 > 90 ||
      char2 < 65 ||
      char2 > 90 ||
      char3 < 65 ||
      char3 > 90
    ) {
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
    if (descriptorType === 0xfc || descriptorType === 0xff) {
      // Monitor name or Serial
      let text = "";
      for (let i = 0; i < 13; i++) {
        const charCode = edidBuffer[blockStart + 5 + i];
        // Stop at terminator or invalid characters
        if (charCode === 0x0a || charCode === 0x00 || charCode > 127) break;
        // Only accept printable ASCII
        if (charCode >= 32) {
          text += String.fromCharCode(charCode);
        }
      }
      return {
        type: descriptorType,
        text: text.trim(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function validateResolution(width, height) {
  // Sanity check for reasonable resolution values
  return width >= 640 && width <= 7680 && height >= 480 && height <= 4320;
}

function parseEdid(edidBuffer) {
  try {
    // Verify buffer size
    if (!edidBuffer || edidBuffer.length < 128) {
      throw new Error("EDID data too short");
    }

    // Verify EDID header
    const header = Buffer.from([
      0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00,
    ]);
    if (!edidBuffer.subarray(0, 8).equals(header)) {
      throw new Error("Invalid EDID header");
    }

    // Parse with fallbacks for each section
    const result = {
      manufacturer: null,
      modelName: null,
      serialNumber: null,
      year: null,
      week: null,
      resolution: null,
    };

    // Manufacturer ID
    result.manufacturer = parseManufacturerId(edidBuffer);

    // Parse descriptor blocks
    for (let i = 54; i <= 108; i += 18) {
      try {
        const block = parseDescriptorBlock(edidBuffer, i);
        if (block) {
          if (block.type === 0xfc && !result.modelName) {
            result.modelName = block.text;
          } else if (block.type === 0xff && !result.serialNumber) {
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
      if (
        week >= 1 &&
        week <= 53 &&
        year >= 1990 &&
        year <= new Date().getFullYear()
      ) {
        result.week = week;
        result.year = year;
      }
    } catch {
      // Keep null values if date parsing fails
    }

    // Resolution
    try {
      const hPixels = ((edidBuffer[4] >> 4) & 0x0f) * 16 + edidBuffer[2];
      const vPixels = ((edidBuffer[7] >> 4) & 0x0f) * 16 + edidBuffer[5];

      if (validateResolution(hPixels, vPixels)) {
        result.resolution = {
          width: hPixels,
          height: vPixels,
        };
      }
    } catch {
      // Keep null resolution if parsing fails
    }

    // Generate display name with fallbacks
    let displayName = "";
    if (result.manufacturer) displayName += result.manufacturer + " ";
    if (result.modelName) {
      displayName += result.modelName;
    } else {
      displayName += "Display";
    }

    return {
      ...result,
      displayName: displayName.trim(),
    };
  } catch (error) {
    console.error("EDID parse error:", error);
    return null;
  }
}

async function getConnectedDisplays() {
  try {
    const entries = await readdir(DRM_PATH);
    const displays = await Promise.all(
      entries.map(async (entry) => {
        if (!entry.match(/card\d+[-\w]+/)) return null;

        const displayPath = DRM_PATH + "/" + entry;
        try {
          // Check if display is connected
          const statusPath = displayPath + "/" + "status";
          const status = await readFile(statusPath, "utf8").catch(
            () => "disconnected",
          );
          if (status.trim() !== "connected") return null;

          // Try to read EDID
          const edidPath = displayPath + "/" + "edid";
          let edidInfo = null;

          try {
            const edidBuffer = await readFile(edidPath);
            edidInfo = parseEdid(edidBuffer);
          } catch (edidError) {
            console.debug(`Failed to read EDID for ${entry}:`, edidError);
          }

          const isInternalDisplay = entry.includes("eDP");
          const name = edidInfo?.displayName || entry.replace(/^card\d+-/, "");

          // Return all information without attempting to match displays yet
          return {
            path: displayPath,
            name,
            manufacturer: edidInfo?.manufacturer || null,
            serialNumber: edidInfo?.serialNumber || null,
            manufactureDate: edidInfo?.year
              ? {
                  year: edidInfo.year,
                  week: edidInfo.week,
                }
              : null,
            nativeResolution: edidInfo?.resolution || null,
            internal: isInternalDisplay,
            connector: entry,
          };
        } catch (error) {
          console.debug(`Error processing display ${entry}:`, error);
          return null;
        }
      }),
    );

    return displays.filter(Boolean);
  } catch (error) {
    console.error("Failed to get display info:", error);
    return [];
  }
}

async function handleGetAllDisplays() {
  const displays = screen.getAllDisplays();
  let edidDisplayInfo = [];
  const savedDisplayIndex = settings.getSync("lastDisplayIndex");
  const savedLowerThirdDisplayIndex = settings.getSync("lastLowerThirdDisplayIndex");

  const defaultDisplayIndex =
    Number.isInteger(savedDisplayIndex) && displays[savedDisplayIndex]
      ? savedDisplayIndex
      : "";
  const defaultLowerThirdDisplayIndex =
    Number.isInteger(savedLowerThirdDisplayIndex) && displays[savedLowerThirdDisplayIndex]
      ? savedLowerThirdDisplayIndex
      : "";

  if (process.platform === "linux") {
    try {
      edidDisplayInfo = await getConnectedDisplays();

      // Sort EDID info to match Electron's display order
      edidDisplayInfo.sort((a, b) => {
        // Put internal display (eDP) first
        const aIsInternal = a.connector.includes("eDP");
        const bIsInternal = b.connector.includes("eDP");
        if (aIsInternal !== bIsInternal) return bIsInternal ? 1 : -1;

        // Then sort by connector number
        const aNum = parseInt(a.connector.match(/\d+/)?.[0] || 0);
        const bNum = parseInt(b.connector.match(/\d+/)?.[0] || 0);
        return aNum - bNum;
      });
    } catch (error) {
      console.error("Failed to get EDID info:", error);
    }
  }

  if (isDevMode) {
    console.log("EDID Display Info:", edidDisplayInfo);
    console.log("Electron Displays:", displays);
  }

  const displayOptions = displays.map((display, index) => {
    let name;

    switch (process.platform) {
      case "linux":
        // Match displays based on index after sorting
        const matchingDisplay = edidDisplayInfo[index];

        if (matchingDisplay) {
          const manufacturer = matchingDisplay.manufacturer
            ? `${matchingDisplay.manufacturer} `
            : "";
          name = matchingDisplay.name.includes(manufacturer)
            ? matchingDisplay.name
            : `${manufacturer}${matchingDisplay.name}`;
        } else {
          name = display.internal ? "Internal Display" : "External Display";
        }
        break;

      case "win32":
      case "darwin":
        name = display.label;
        break;

      default:
        name = display.label || "Display";
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
        height: display.bounds.height,
      },
    };
  });

  return {
    displays: displayOptions,
    defaultDisplayIndex,
    defaultLowerThirdDisplayIndex,
  };
}

function handleSetDisplayIndex(event, index) {
  const displayIndex = Number.isInteger(index) && index >= 0 ? index : -1;
  settings.set("lastDisplayIndex", displayIndex).catch((error) => {
    console.error("Error saving display index:", error);
  });

  // If there's an active media window, move it to the new display
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    const targetDisplay = displayForExplicitIndex(displayIndex);
    if (!targetDisplay) {
      mediaWindow.close();
      return;
    }

    mediaWindow.setBounds(fullscreenWindowBoundsForDisplay(targetDisplay));
  }
}

function handleSetLowerThirdDisplayIndex(event, index) {
  const displayIndex = Number.isInteger(index) && index >= 0 ? index : -1;
  settings.set("lastLowerThirdDisplayIndex", displayIndex).catch((error) => {
    console.error("Error saving lower third display index:", error);
  });

  if (lowerThirdWindow && !lowerThirdWindow.isDestroyed()) {
    const targetDisplay = displayForExplicitIndex(displayIndex);
    if (!targetDisplay) {
      lowerThirdWindow.close();
      return;
    }
    lowerThirdWindow.setBounds(fullscreenWindowBoundsForDisplay(targetDisplay));
    lowerThirdWindow.setFullScreen(true);
  }
}

async function getSystemTIme() {
  const [seconds, nanoseconds] = process.hrtime();
  return {
    systemTime: seconds + nanoseconds / 1e9,
    ipcTimestamp: Date.now(),
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
  let helpWindowWidth = 800; // Default width
  let helpWindowHeight = 600; // Default height

  let ovrdHWindBnd = getHelpWindowBounds();
  if (ovrdHWindBnd != undefined) {
    helpWindowX = ovrdHWindBnd.x;
    helpWindowY = ovrdHWindBnd.y;
    helpWindowWidth = ovrdHWindBnd.width;
    helpWindowHeight = ovrdHWindBnd.height;
  }

  helpWindow = new BrowserWindow({
    width: helpWindowWidth,
    height: helpWindowHeight,
    minWidth: 700,
    minHeight: 600,
    resizable: true,
    minimizable: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
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
      devTools: false,
    },
  });

  helpWindow.loadFile("derived/src/help.prod.html");

  helpWindow.on("move", checkHelpWindowState);
  helpWindow.on("resize", checkHelpWindowState);
  helpWindow.on("maximize", handleMaximizeChangeHelpWindow.bind(null, true));
  helpWindow.on("unmaximize", handleMaximizeChangeHelpWindow.bind(null, false));

  helpWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
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
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: false,
      sandbox: true,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: false,
    },
  });

  aboutWindow.loadFile("derived/src/about.prod.html");

  // Position it centered relative to parent
  aboutWindow.once("ready-to-show", () => {
    const parentBounds = parentWindow.getBounds();
    const x = parentBounds.x + (parentBounds.width - 500) / 2;
    const y = parentBounds.y + (parentBounds.height - 480) / 2;
    aboutWindow.setBounds({ x, y, width: 500, height: 480 });
    aboutWindow.show();
  });

  aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  return aboutWindow;
}

function createQueueSwitchDialogWindow(parentWindow, message) {
  return new Promise((resolve) => {
    if (queueSwitchDialogWindow && !queueSwitchDialogWindow.isDestroyed()) {
      if (!queueSwitchDialogWindow.webContents.isDestroyed()) {
        queueSwitchDialogWindow.focus();
        queueSwitchDialogWindow.webContents.focus();
        resolve(false);
        return;
      }
      queueSwitchDialogWindow = null;
    }

    let resolved = false;
    const finish = (accepted) => {
      if (resolved) return;
      resolved = true;
      try {
        ipcMain.removeHandler(QUEUE_SWITCH_DIALOG_IPC_CHANNEL);
      } catch {
        /* no handler registered */
      }
      if (queueSwitchDialogResponseListener) {
        ipcMain.removeListener(
          QUEUE_SWITCH_DIALOG_IPC_CHANNEL,
          queueSwitchDialogResponseListener,
        );
        queueSwitchDialogResponseListener = null;
      }
      resolve(accepted === true);
    };

    const onResponse = (_event, accepted) => {
      if (resolved) {
        return true;
      }
      const dlg = queueSwitchDialogWindow;
      if (!dlg || dlg.isDestroyed()) {
        return false;
      }
      // Do not compare event.sender to webContents — on some platforms that
      // identity check fails sporadically, so finish() never runs and the main
      // process invoke("show_queue_switch_dialog") hangs with dead buttons.
      finish(accepted === true);
      if (!queueSwitchDialogWindow.isDestroyed()) {
        queueSwitchDialogWindow.close();
      }
      return true;
    };

    try {
      ipcMain.removeHandler(QUEUE_SWITCH_DIALOG_IPC_CHANNEL);
    } catch {
      /* channel had no handler */
    }
    if (queueSwitchDialogResponseListener) {
      ipcMain.removeListener(
        QUEUE_SWITCH_DIALOG_IPC_CHANNEL,
        queueSwitchDialogResponseListener,
      );
    }
    queueSwitchDialogResponseListener = onResponse;
    ipcMain.on(QUEUE_SWITCH_DIALOG_IPC_CHANNEL, onResponse);
    ipcMain.handle(QUEUE_SWITCH_DIALOG_IPC_CHANNEL, onResponse);

    queueSwitchDialogWindow = new BrowserWindow({
      parent: parentWindow,
      modal: true,
      width: 440,
      height: 260,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      transparent: true,
      acceptFirstMouse: true,
      show: false,
      skipTaskbar: true,
      title: "Switch presentation",
      backgroundColor: "#00000000",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        webviewTag: false,
        navigateOnDragDrop: false,
        spellcheck: false,
        devTools: isDevMode,
        preload: path.join(
          import.meta.dirname,
          "queue_switch_dialog_preload.min.mjs",
        ),
      },
    });

    queueSwitchDialogWindow.once("closed", () => {
      try {
        ipcMain.removeHandler(QUEUE_SWITCH_DIALOG_IPC_CHANNEL);
      } catch {
        /* already removed after a button response */
      }
      queueSwitchDialogWindow = null;
      finish(false);
    });

    queueSwitchDialogWindow.loadFile("derived/src/queue_switch_dialog.prod.html");

    queueSwitchDialogWindow.webContents.once("did-finish-load", () => {
      if (
        !queueSwitchDialogWindow ||
        queueSwitchDialogWindow.isDestroyed()
      ) {
        return;
      }
      const literal = JSON.stringify(message ?? "");
      queueSwitchDialogWindow.webContents
        .executeJavaScript(
          `document.getElementById('queue_switch_dialog_text').textContent = ${literal};`,
        )
        .catch(() => {});
    });

    queueSwitchDialogWindow.once("ready-to-show", () => {
      if (
        !queueSwitchDialogWindow ||
        queueSwitchDialogWindow.isDestroyed()
      ) {
        return;
      }
      const parentBounds = parentWindow.getBounds();
      const w = 440;
      const h = 260;
      const x = parentBounds.x + (parentBounds.width - w) / 2;
      const y = parentBounds.y + (parentBounds.height - h) / 2;
      queueSwitchDialogWindow.setBounds({ x, y, width: w, height: h });
      queueSwitchDialogWindow.show();
      queueSwitchDialogWindow.focus();
      if (!queueSwitchDialogWindow.webContents.isDestroyed()) {
        queueSwitchDialogWindow.webContents.focus();
      }
    });

    queueSwitchDialogWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: "deny" };
    });
  });
}

/** Close the queue-switch modal if open (e.g. queue auto-advanced while user had not answered). */
async function handleDismissQueueSwitchDialog() {
  const w = queueSwitchDialogWindow;
  if (!w || w.isDestroyed()) return;
  await new Promise((resolve) => {
    w.once("closed", resolve);
    w.close();
  });
}

function getPlatform() {
  return process.platform;
}

function extractYouTubeVideoId(input) {
  if (typeof input !== "string" || input.length === 0) return null;
  if (/^[\w-]{11}$/.test(input)) return input;
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (
    host !== "youtube.com" &&
    host !== "m.youtube.com" &&
    host !== "music.youtube.com"
  ) {
    return null;
  }
  const v = url.searchParams.get("v");
  if (v && /^[\w-]{11}$/.test(v)) return v;
  const m = url.pathname.match(
    /^\/(?:live|embed|v|shorts)\/([\w-]{11})(?:[/?#]|$)/,
  );
  return m ? m[1] : null;
}

let youtubePlayerEvalInstalled = false;

/**
 * youtubei.js's Node entry loads {@code Platform.shim.eval} as a stub that throws.
 * Transforming the live HLS `n` challenge requires executing YouTube's extracted
 * player code — same as ytjs.dev "custom JavaScript interpreter" / FreeTube's
 * manifest decipher step.
 */
function installYoutubePlayerEval(Platform) {
  if (youtubePlayerEvalInstalled) return;
  Platform.shim.eval = async (data, _env) =>
    new Function(`"use strict";\n${data.output}`)();
  youtubePlayerEvalInstalled = true;
}

async function getInnertube() {
  if (!innertubePromise) {
    innertubePromise = (async () => {
      const { Innertube, Platform } = await import("youtubei.js");
      installYoutubePlayerEval(Platform);
      const po = process.env.EMS_YOUTUBE_PO_TOKEN?.trim();
      // Use Chromium's network stack (same as renderer playback) so any
      // YouTube signed URL decisions are based on the same egress behavior
      // as subsequent media segment requests.
      const sessionFetch =
        mediaPresentationSession?.fetch?.bind(mediaPresentationSession) ??
        session.defaultSession?.fetch?.bind(session.defaultSession);
      return Innertube.create({
        generate_session_locally: true,
        ...(sessionFetch ? { fetch: sessionFetch } : {}),
        ...(po ? { po_token: po } : {}),
      });
    })().catch((err) => {
      // Reset so a retry can re-attempt session creation.
      innertubePromise = null;
      throw err;
    });
  }
  return innertubePromise;
}

function youtubePathParts(url) {
  try {
    const u = new URL(url);
    const raw = u.pathname.split("/").filter(Boolean);
    return {
      url: u,
      raw,
      decoded: raw.map((part) => decodeURIComponent(part)),
    };
  } catch {
    return null;
  }
}

async function transformYoutubePathNUrl(url) {
  if (typeof url !== "string" || !url.includes("googlevideo.com")) {
    return null;
  }
  const parsed = youtubePathParts(url);
  if (!parsed) return null;
  const nIndex = parsed.decoded.indexOf("n");
  if (nIndex < 0 || nIndex + 1 >= parsed.decoded.length) {
    return null;
  }

  const originalN = parsed.decoded[nIndex + 1];
  if (!originalN) return null;
  let transformedN = youtubePathNTransformCache.get(originalN);

  if (!transformedN) {
    const yt = await getInnertube();
    const player = yt.session?.player;
    if (!player) return null;

    // youtubei.js transforms query-string `n`, while live WEB HLS segment
    // URLs carry it in the path (`.../n/<token>/...`). Temporarily mirror the
    // path token into the query, let the player transform it, then write the
    // transformed value back into the original path.
    const probe = new URL(url);
    probe.searchParams.set("n", originalN);
    const deciphered = await player.decipher(probe.href);
    transformedN = new URL(deciphered).searchParams.get("n");
    if (!transformedN || transformedN === originalN) return null;
    youtubePathNTransformCache.set(originalN, transformedN);
    youtubePathNTransformCache.set(transformedN, transformedN);
    if (youtubePathNTransformCache.size > 512) {
      const oldestKey = youtubePathNTransformCache.keys().next().value;
      youtubePathNTransformCache.delete(oldestKey);
    }
  }

  parsed.raw[nIndex + 1] = encodeURIComponent(transformedN);
  parsed.url.pathname = `/${parsed.raw.join("/")}`;
  return parsed.url.href;
}

/** Clients to try for live HLS; IOS-first because its manifest works with the iOS UA spoof. */
const YOUTUBE_LIVE_INFO_CLIENTS = [
  "IOS",
  "ANDROID_VR",
  "WEB",
  "ANDROID",
];

/**
 * Tracks whether the active YouTube media session is a live IOS-client HLS
 * stream. We flip this on the moment {@link handleResolveYouTubeStream}
 * resolves an HLS URL so the `webRequest` header-injector knows to apply the
 * iOS User-Agent to every `googlevideo.com` segment fetch, not just URLs that
 * happen to include client/path markers. Live HLS segment URLs frequently
 * omit `c=IOS` / `yt_live_broadcast` (they're path-style:
 * `/videoplayback/id/<id>/.../index.m3u8/sq/<n>/.../file/seg.ts`), and
 * without the iOS UA those segment fetches return 403 even though the
 * manifest itself loaded fine.
 *
 * Cleared by {@link handleCloseMediaWindow} and on `localMediaState` "stop"
 * so VOD playback that follows a live session does not get the iOS UA
 * spoof (which would 403 TV_SIMPLY-signed URLs).
 */
let youtubeLiveSessionActive = false;

/**
 * Clients to try for VOD playback. {@code TV_SIMPLY} (TVHTML5 simply embedded
 * player) is preferred because its signed URLs are not bound to a specific
 * IP / User-Agent the way IOS / ANDROID URLs are, so dash.js fetches from
 * the Electron renderer aren't 403'd by googlevideo. {@code WEB_EMBEDDED}
 * and {@code MWEB} are close-enough fallbacks; raw {@code IOS} is last
 * because its URLs trigger 403s once the renderer's source IP or UA differs
 * from what the manifest was signed against.
 */
const YOUTUBE_VOD_INFO_CLIENTS = [
  "TV_SIMPLY",
  "WEB_EMBEDDED",
  "MWEB",
  "ANDROID_VR",
  "IOS",
];

/**
 * Returns true when an audio adaptive format should be DROPPED from the DASH
 * manifest. We keep all video-only formats, drop any audio format flagged as
 * a dub/auto-dub/description/secondary, and drop formats whose `audio_track`
 * metadata says it is not the default. The aim is to leave a single audio
 * AdaptationSet (the speaker's original track), preventing both auto-dub
 * playback and dash.js audio-track switching mid-playback.
 */
function shouldFilterOutAudioFormat(format) {
  if (!format?.has_audio) return false;
  if (format.has_video) return false; // keep combined formats untouched
  if (
    format.is_dubbed ||
    format.is_auto_dubbed ||
    format.is_descriptive ||
    format.is_secondary
  ) {
    return true;
  }
  if (format.audio_track && format.audio_track.audio_is_default === false) {
    return true;
  }
  return false;
}

/**
 * Resolves a YouTube URL to something the media window can play.
 * @returns {{ type: 'hls', url: string } | { type: 'progressive', url: string } | { type: 'dash', manifest: string }}
 */
async function handleResolveYouTubeStream(_event, url) {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    throw new Error(`Could not extract a YouTube video ID from: ${url}`);
  }
  const yt = await getInnertube();
  const player = yt.session?.player;

  // Probe with WEB first to cheaply learn live vs VOD; pick the right client
  // list, then iterate to find a playable stream.
  let isLive = false;
  try {
    const probe = await yt.getBasicInfo(videoId).catch(() => null);
    isLive =
      probe?.basic_info?.is_live === true ||
      probe?.page?.[0]?.video_details?.is_live === true;
  } catch {
    // Fall through; treat as VOD by default and let the per-client loop sort it out.
  }

  const clients = isLive ? YOUTUBE_LIVE_INFO_CLIENTS : YOUTUBE_VOD_INFO_CLIENTS;
  let lastError = null;
  for (const client of clients) {
    try {
      const info = await yt.getInfo(videoId, { client });

      const liveAccordingToClient =
        info.basic_info?.is_live === true ||
        info.page?.[0]?.video_details?.is_live === true;

      if (liveAccordingToClient) {
        let hlsUrl = info?.streaming_data?.hls_manifest_url;
        if (hlsUrl) {
          if (player) {
            hlsUrl = await player.decipher(hlsUrl);
          }
          // Flag this as an active live session so the webRequest header
          // injector applies the iOS User-Agent to every segment fetch —
          // path-style live segment URLs do not always carry the
          // `c=IOS` / `yt_live_broadcast` markers we'd otherwise key on.
          youtubeLiveSessionActive = true;
          return { type: "hls", url: hlsUrl };
        }
        continue;
      }

      if (!info.streaming_data) {
        continue;
      }

      // Going down the VOD path; any leftover live flag must be cleared so
      // we don't poison TV_SIMPLY-signed URLs with an iOS UA spoof (which
      // would re-introduce VOD 403s).
      youtubeLiveSessionActive = false;

      try {
        const preferredFormat = info.chooseFormat({
          quality: "best",
          type: "video+audio",
          format: "mp4",
          language: "original",
        });
        const progressiveUrl = preferredFormat?.decipher
          ? await preferredFormat.decipher(player)
          : preferredFormat?.url;
        if (progressiveUrl) {
          return { type: "progressive", url: progressiveUrl };
        }
      } catch {
        // No combined progressive format (typical for 1080p+); use DASH below.
      }

      const manifest = await info.toDash({
        format_filter: shouldFilterOutAudioFormat,
      });
      if (manifest) {
        return { type: "dash", manifest };
      }
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(
    lastError?.message ??
      "No playable stream is available for this YouTube video.",
  );
}

const ALLOWED_MEDIA_EXTENSIONS = [
  "mp4",
  "m4v",
  "webm",
  "ogg",
  "ogv",
  "mkv",
  "mov",
  "avi",
  "mp3",
  "wav",
  "flac",
  "m4a",
  "aac",
  "opus",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "svg",
  "pptx",
];

const ALLOWED_MEDIA_EXTENSION_SET = new Set(
  ALLOWED_MEDIA_EXTENSIONS.map((ext) => "." + ext.toLowerCase()),
);
const PROJECT_FILE_EXTENSIONS = ["emproj", "zip"];
const AUTOSAVE_PROJECT_FILENAME = "autosave.emproj";
const AUTOSAVE_PROJECT_PATH_KEY = "autosaveProjectPath";
const EMBEDDED_AUTOSAVE_STATE_KEY = "autosaveProjectState";
const LAST_BIBLE_VERSION_KEY = "lastBibleVersion";

function autosaveProjectFilePath() {
  return path.join(app.getPath("userData"), AUTOSAVE_PROJECT_FILENAME);
}

function sanitizeSettingsData(data) {
  const next = data && typeof data === "object" ? { ...data } : {};
  delete next[EMBEDDED_AUTOSAVE_STATE_KEY];
  return next;
}

function readSettings() {
  const data = settings.getSync();
  return sanitizeSettingsData(data);
}

async function writeSettings(partial) {
  if (!partial || typeof partial !== "object") return;
  await settings.set(sanitizeSettingsData({ ...readSettings(), ...partial }));
  await settings.flush();
}

async function purgeEmbeddedAutosaveProjectState() {
  const raw = settings.getSync();
  if (
    !raw ||
    typeof raw !== "object" ||
    !Object.prototype.hasOwnProperty.call(raw, EMBEDDED_AUTOSAVE_STATE_KEY)
  ) {
    return;
  }
  await settings.set(sanitizeSettingsData(raw));
  await settings.flush();
}

function autosaveProjectPathFromSettings() {
  const savedPath = readSettings()[AUTOSAVE_PROJECT_PATH_KEY];
  return typeof savedPath === "string" && savedPath.length > 0 ? savedPath : "";
}

function isExtractedProjectTempPath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return false;
  return localFileSystemPathFromMediaPath(filePath).includes(`${path.sep}ems-emproj-`);
}

async function autosaveSnapshotHasMissingExtractedMedia(snapshot) {
  const queue = Array.isArray(snapshot?.mediaQueue) ? snapshot.mediaQueue : [];
  for (const item of queue) {
    const itemPath = typeof item?.path === "string" ? item.path : "";
    if (!isExtractedProjectTempPath(itemPath)) continue;
    try {
      const info = await stat(localFileSystemPathFromMediaPath(itemPath));
      if (!info.isFile()) return true;
    } catch {
      return true;
    }
  }
  return false;
}

async function loadAutosaveProjectSnapshotFromSettings() {
  const filePath = autosaveProjectPathFromSettings();
  if (!filePath) return null;
  try {
    const snapshot = await loadEmprojSnapshot(filePath);
    if (await autosaveSnapshotHasMissingExtractedMedia(snapshot)) {
      console.warn("Ignoring autosave with missing extracted project media:", filePath);
      await cleanupExtractedProjectMedia(snapshot).catch(() => {});
      await writeSettings({ [AUTOSAVE_PROJECT_PATH_KEY]: "" });
      return null;
    }
    return snapshot;
  } catch (err) {
    console.error("Failed to load autosave project:", err);
    return null;
  }
}

async function pathExists(dir) {
  if (typeof dir !== "string" || dir.length === 0) return false;
  try {
    const info = await stat(dir);
    return info.isDirectory();
  } catch {
    return false;
  }
}

async function rememberMediaFolder(fileOrFolderPath) {
  if (typeof fileOrFolderPath !== "string" || fileOrFolderPath.length === 0) {
    return;
  }
  let folder = fileOrFolderPath;
  try {
    const info = await stat(fileOrFolderPath);
    folder = info.isDirectory()
      ? fileOrFolderPath
      : path.dirname(fileOrFolderPath);
  } catch {
    folder = path.dirname(fileOrFolderPath);
  }
  if (!(await pathExists(folder))) return;
  await writeSettings({ lastMediaFolder: folder });
}

async function getInitialMediaFolder() {
  const { lastMediaFolder } = readSettings();
  if (lastMediaFolder && (await pathExists(lastMediaFolder))) {
    return lastMediaFolder;
  }
  for (const name of ["videos", "music", "documents", "home"]) {
    let candidate;
    try {
      candidate = app.getPath(name);
    } catch {
      continue;
    }
    if (candidate && (await pathExists(candidate))) {
      return candidate;
    }
  }
  return undefined;
}

async function rememberProjectFolder(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return;
  const folder = path.dirname(filePath);
  if (!(await pathExists(folder))) return;
  await writeSettings({ lastProjectFolder: folder });
}

async function rememberLastBibleVersion(version) {
  const normalized = typeof version === "string" ? version.trim() : "";
  if (!normalized) return;
  await writeSettings({ [LAST_BIBLE_VERSION_KEY]: normalized });
}

async function getInitialProjectFolder() {
  const { lastProjectFolder } = readSettings();
  if (lastProjectFolder && (await pathExists(lastProjectFolder))) {
    return lastProjectFolder;
  }
  return getInitialMediaFolder();
}

async function handleShowMediaFilesDialog(event) {
  const mainWindow = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { canceled: true, filePaths: [] };
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open media",
    defaultPath: await getInitialMediaFolder(),
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Media", extensions: ALLOWED_MEDIA_EXTENSIONS },
      { name: "PowerPoint Presentations", extensions: ["pptx"] },
    ],
  });
  if (result.canceled || !result.filePaths?.length) {
    return { canceled: true, filePaths: [] };
  }
  await rememberMediaFolder(result.filePaths[0]);
  return { canceled: false, filePaths: result.filePaths };
}

async function handleShowImportSongDialog(event) {
  const mainWindow = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { canceled: true, filePaths: [] };
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import Songs",
    defaultPath: await getInitialMediaFolder(),
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Song Files", extensions: ["json", "txt"] },
    ],
  });
  if (result.canceled || !result.filePaths?.length) {
    return { canceled: true, filePaths: [] };
  }
  await rememberMediaFolder(result.filePaths[0]);
  return { canceled: false, filePaths: result.filePaths };
}

async function handleReadFileAsText(_, filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("File path is required");
  }
  return readFile(filePath, "utf8");
}

async function handleShowOpenProjectDialog(event) {
  const mainWindow = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { canceled: true, filePaths: [] };
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open Project",
    defaultPath: await getInitialProjectFolder(),
    properties: ["openFile"],
    filters: [{ name: "EMS Project", extensions: PROJECT_FILE_EXTENSIONS }],
  });
  if (result.canceled || !result.filePaths?.length) {
    return { canceled: true, filePaths: [] };
  }
  await rememberProjectFolder(result.filePaths[0]);
  return { canceled: false, filePaths: result.filePaths };
}

async function handleShowSaveProjectDialog(event, opts = {}) {
  const mainWindow = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { canceled: true, filePath: "" };
  }
  const requested = typeof opts?.defaultPath === "string" ? opts.defaultPath : "";
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Save Project",
    defaultPath: requested || (await getInitialProjectFolder()),
    filters: [{ name: "EMS Project", extensions: ["emproj"] }],
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true, filePath: "" };
  }
  await rememberProjectFolder(result.filePath);
  return { canceled: false, filePath: result.filePath };
}

async function handleShowExportProjectDialog(event, opts = {}) {
  const mainWindow = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { canceled: true, filePath: "" };
  }
  const requested = typeof opts?.defaultPath === "string" ? opts.defaultPath : "";
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export Portable Project",
    defaultPath: requested || (await getInitialProjectFolder()),
    filters: [{ name: "EMS Project", extensions: ["emproj"] }],
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true, filePath: "" };
  }
  await rememberProjectFolder(result.filePath);
  return { canceled: false, filePath: result.filePath };
}

async function handleShowMissingProjectFilesDialog(event, opts = {}) {
  const mainWindow = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const missingFiles = Array.isArray(opts?.missingFiles) ? opts.missingFiles : [];
  if (missingFiles.length === 0) return false;
  const previewLines = missingFiles.slice(0, 10).map((x) => `• ${x}`);
  const extra = missingFiles.length > 10
    ? `\n… and ${missingFiles.length - 10} more`
    : "";
  const detail =
    "The project loaded, but some media files could not be found:\n\n" +
    previewLines.join("\n") +
    extra;
  await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Missing Project Files",
    message: `${missingFiles.length} file(s) are missing`,
    detail,
    buttons: ["OK"],
    defaultId: 0,
  });
  return true;
}

async function handleShowRelinkFolderDialog(event) {
  const mainWindow = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { canceled: true, filePath: "" };
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Relink Missing Files",
    defaultPath: await getInitialMediaFolder(),
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths?.length) {
    return { canceled: true, filePath: "" };
  }
  await rememberMediaFolder(result.filePaths[0]);
  return { canceled: false, filePath: result.filePaths[0] };
}

function relinkOriginalName(item) {
  const candidates = [
    item?.originalName,
    item?.originalPath,
    item?.path,
    item?.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    const parts = candidate.split(/[/\\]/);
    return parts[parts.length - 1] || candidate;
  }
  return "";
}

async function scoreRelinkCandidate(item, candidatePath, expectedName) {
  let info;
  try {
    info = await stat(candidatePath);
    if (!info.isFile()) return null;
  } catch {
    return null;
  }

  const expectedSize = Number.isFinite(item?.sizeBytes) ? item.sizeBytes : null;
  if (expectedSize !== null && info.size !== expectedSize) {
    return null;
  }

  let score = 100;
  if (path.basename(candidatePath) === expectedName) score += 20;
  if (expectedSize !== null) score += 80;

  const storedHash = storedFileHashFromRecord(item);
  if (storedHash) {
    let computedHash = "";
    try {
      computedHash = await hashMediaFile(candidatePath);
    } catch {
      return null;
    }
    if (computedHash !== storedHash) return null;
    score += 500;
    return {
      path: candidatePath,
      score,
      sizeBytes: info.size,
      modifiedTime:
        info.mtime instanceof Date && Number.isFinite(info.mtime.getTime())
          ? info.mtime.toISOString()
          : undefined,
      ...baselineFileHashFields(computedHash),
    };
  }

  return {
    path: candidatePath,
    score,
    sizeBytes: info.size,
    modifiedTime:
      info.mtime instanceof Date && Number.isFinite(info.mtime.getTime())
        ? info.mtime.toISOString()
        : undefined,
  };
}

async function findRelinkCandidateFiles(searchRoot, wantedNames) {
  const candidatesByName = new Map();
  const stack = [searchRoot];
  let scannedFiles = 0;
  const skipDirs = new Set([
    ".git",
    "node_modules",
    "derived",
    "dist",
    "build",
    ".cache",
    ".config",
  ]);

  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      scannedFiles += 1;
      const lowerName = entry.name.toLowerCase();
      if (!wantedNames.has(lowerName)) continue;
      const list = candidatesByName.get(lowerName) || [];
      list.push(fullPath);
      candidatesByName.set(lowerName, list);
    }
  }

  return { candidatesByName, scannedFiles };
}

async function handleRelinkMissingMedia(_, payload = {}) {
  const searchRoot = typeof payload?.searchRoot === "string" ? payload.searchRoot : "";
  const missingItems = Array.isArray(payload?.missingItems) ? payload.missingItems : [];
  if (!searchRoot || missingItems.length === 0) {
    return { matches: [], unresolved: [] };
  }

  const wantedNames = new Set();
  const itemNames = new Map();
  for (const item of missingItems) {
    const originalName = relinkOriginalName(item);
    if (!originalName) continue;
    const lowerName = originalName.toLowerCase();
    wantedNames.add(lowerName);
    itemNames.set(item.index, originalName);
  }

  const { candidatesByName } = await findRelinkCandidateFiles(searchRoot, wantedNames);
  const matches = [];
  const unresolved = [];

  for (const item of missingItems) {
    const originalName = itemNames.get(item.index) || relinkOriginalName(item);
    const candidatePaths = candidatesByName.get(originalName.toLowerCase()) || [];
    if (candidatePaths.length === 0) {
      unresolved.push({
        index: item.index,
        name: originalName || item.name || item.path || "Unknown file",
        reason: "not-found",
      });
      continue;
    }

    const scored = [];
    for (const candidatePath of candidatePaths) {
      const score = await scoreRelinkCandidate(item, candidatePath, originalName);
      if (score) scored.push(score);
    }
    scored.sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      unresolved.push({
        index: item.index,
        name: originalName,
        reason: "metadata-mismatch",
      });
      continue;
    }
    if (scored.length > 1 && scored[0].score === scored[1].score) {
      unresolved.push({
        index: item.index,
        name: originalName,
        reason: "ambiguous",
        candidateCount: scored.length,
      });
      continue;
    }

    matches.push({
      index: item.index,
      path: scored[0].path,
      originalPath: item.originalPath,
      sizeBytes: scored[0].sizeBytes,
      modifiedTime: scored[0].modifiedTime,
      fileHash: scored[0].fileHash,
      fileHashAlg: scored[0].fileHashAlg,
    });
  }

  return { matches, unresolved };
}

async function handleShowRelinkSummaryDialog(event, opts = {}) {
  const mainWindow = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const matchedCount = Number.isFinite(opts?.matchedCount) ? opts.matchedCount : 0;
  const totalCount = Number.isFinite(opts?.totalCount) ? opts.totalCount : matchedCount;
  const unresolved = Array.isArray(opts?.unresolved) ? opts.unresolved : [];
  const unresolvedLines = unresolved
    .slice(0, 10)
    .map((item) => `• ${item.name || "Unknown file"} (${item.reason || "unresolved"})`);
  const extra = unresolved.length > 10 ? `\n… and ${unresolved.length - 10} more` : "";
  const detail =
    unresolved.length > 0
      ? `EMS searched:\n${opts?.searchedFolder || ""}\n\nStill missing:\n${unresolvedLines.join("\n")}${extra}`
      : `EMS searched:\n${opts?.searchedFolder || ""}`;
  await dialog.showMessageBox(mainWindow, {
    type: unresolved.length > 0 ? "warning" : "info",
    title: "Relink Missing Files",
    message: `Relinked ${matchedCount} of ${totalCount} missing file(s)`,
    detail,
    buttons: ["OK"],
    defaultId: 0,
  });
  return true;
}

let activeProjectSnapshot = null;

function projectGuidFromSnapshot(snapshot) {
  return (
    normalizeProjectGuid(snapshot?.projectGuid) ||
    normalizeProjectGuid(snapshot?.project?.guid)
  );
}

function projectWriterAppInfo() {
  return {
    name: app.getName(),
    version: app.getVersion(),
  };
}

async function reconcileStagingFromSnapshot(snapshot, opts = {}) {
  const projectGuid = projectGuidFromSnapshot(snapshot);
  if (!projectGuid) return;
  await reconcileStagingForProject({
    projectGuid,
    projectPath: typeof snapshot?.projectPath === "string" ? snapshot.projectPath : "",
    queue: Array.isArray(snapshot?.mediaQueue) ? snapshot.mediaQueue : [],
    detectProtected: opts.detectProtected === true,
  });
}

async function handleReadProjectFile(_, filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("Invalid project path");
  }
  const snapshot = await loadEmprojSnapshot(filePath);
  const previousSnapshot = activeProjectSnapshot;
  activeProjectSnapshot = snapshot;
  if (previousSnapshot) {
    await cleanupExtractedProjectMedia(previousSnapshot).catch(() => {});
  }
  activeProjectPath = filePath;
  activeProjectGuid = projectGuidFromSnapshot(snapshot);
  await getStagingIndex().removeProjectsAtPathExcept(filePath, activeProjectGuid)
    .then(async (result) => {
      for (const snapshotId of result.eligibleSnapshotIds || []) {
        await deleteStagedSnapshotsById(mediaStagingDir(), snapshotId);
      }
    });
  await reconcileStagingFromSnapshot(snapshot, { detectProtected: false });
  await writeSettings({ lastOpenedProjectPath: filePath });
  return { filePath, data: JSON.stringify(snapshot) };
}

async function handleWriteProjectFile(_, payload) {
  const filePath = typeof payload?.filePath === "string" ? payload.filePath : "";
  const data = typeof payload?.data === "string" ? payload.data : "";
  const mode = payload?.mode === "packed" ? "packed" : "working";
  const activateProject = payload?.activateProject !== false;
  if (!filePath) throw new Error("Invalid project path");
  if (!data) throw new Error("Project data is empty");
  let snapshot;
  try {
    snapshot = JSON.parse(data);
  } catch {
    throw new Error("Project data is invalid JSON");
  }
  const result = await saveEmprojSnapshot(filePath, snapshot, projectWriterAppInfo(), {
    packMedia: mode === "packed",
  });
  const projectGuid = normalizeProjectGuid(result?.projectGuid) || projectGuidFromSnapshot(snapshot);
  if (activateProject) {
    activeProjectPath = filePath;
    activeProjectGuid = projectGuid;
    snapshot.projectPath = filePath;
    snapshot.projectGuid = activeProjectGuid;
    if (typeof result?.projectCreated === "string") {
      snapshot.projectCreated = result.projectCreated;
    }
    await getStagingIndex().removeProjectsAtPathExcept(filePath, activeProjectGuid)
      .then(async (cleanupResult) => {
        for (const snapshotId of cleanupResult.eligibleSnapshotIds || []) {
          await deleteStagedSnapshotsById(mediaStagingDir(), snapshotId);
        }
      });
    await reconcileStagingFromSnapshot(snapshot, { detectProtected: false });
    await writeSettings({ lastOpenedProjectPath: filePath });
  }
  await rememberProjectFolder(filePath);
  return {
    ok: true,
    filePath,
    projectGuid,
    projectCreated: result?.projectCreated,
  };
}

async function handleSaveAutosaveProjectState(_, state) {
  if (!state || typeof state !== "object") return { ok: false };
  if (typeof state.projectPath === "string") {
    activeProjectPath = state.projectPath;
  }
  const filePath = autosaveProjectFilePath();
  const packAutosaveMedia = state.projectStorageMode === "packed";
  const result = await saveEmprojSnapshot(filePath, state, projectWriterAppInfo(), {
    packMedia: packAutosaveMedia,
  });
  const projectGuid =
    normalizeProjectGuid(result?.projectGuid) ||
    projectGuidFromSnapshot(state) ||
    activeProjectGuid;
  const autosaveSnapshot = {
    ...state,
    projectPath: filePath,
    projectGuid,
    projectCreated: result?.projectCreated || state.projectCreated,
    projectStorageMode: packAutosaveMedia ? "packed" : "working",
    project: {
      ...(state.project && typeof state.project === "object" ? state.project : {}),
      guid: projectGuid,
      created: result?.projectCreated || state.project?.created,
    },
  };
  activeProjectGuid = projectGuid;
  rememberSessionProject(activeProjectGuid, filePath, autosaveSnapshot.mediaQueue);
  await writeSettings({ [AUTOSAVE_PROJECT_PATH_KEY]: filePath });
  await reconcileStagingFromSnapshot(autosaveSnapshot, { detectProtected: false }).catch((err) => {
    console.error("autosave staging reconciliation failed:", err);
  });
  return {
    ok: true,
    filePath,
    projectGuid,
    projectCreated: result?.projectCreated,
  };
}

async function handleSetActiveProjectPath(_, payload = {}) {
  activeProjectPath =
    payload && typeof payload.projectPath === "string" ? payload.projectPath : "";
  activeProjectGuid = normalizeProjectGuid(payload?.projectGuid) || activeProjectGuid;
  return { ok: true };
}

async function handleLoadAutosaveProjectState() {
  const snapshot = await loadAutosaveProjectSnapshotFromSettings();
  if (!snapshot) return null;
  const previousSnapshot = activeProjectSnapshot;
  activeProjectSnapshot = snapshot;
  if (previousSnapshot) {
    await cleanupExtractedProjectMedia(previousSnapshot).catch(() => {});
  }
  activeProjectPath = typeof snapshot.projectPath === "string" ? snapshot.projectPath : "";
  activeProjectGuid = projectGuidFromSnapshot(snapshot) || activeProjectGuid;
  return snapshot;
}

async function handleRememberMediaFolder(_, paths) {
  if (!Array.isArray(paths)) return;
  for (const p of paths) {
    if (typeof p === "string" && p.length > 0) {
      await rememberMediaFolder(p);
      return;
    }
  }
}

async function handleRememberLastBibleVersion(_, version) {
  await rememberLastBibleVersion(version);
}

/** Filter renderer-supplied dropped paths to those with a recognized media extension. */
function handleFilterMediaDropPaths(_, paths) {
  if (!Array.isArray(paths)) return [];
  const out = [];
  for (const p of paths) {
    if (typeof p !== "string" || p.length === 0) continue;
    const dot = p.lastIndexOf(".");
    if (dot < 0) continue;
    const ext = p.slice(dot).toLowerCase();
    if (ALLOWED_MEDIA_EXTENSION_SET.has(ext)) out.push(p);
  }
  return out;
}

async function handleReadFileAsArrayBuffer(_, filePath) {
  const resolvedPath =
    filePath && typeof filePath === "object"
      ? await resolveStagedMediaPath(filePath)
      : localFileSystemPathFromMediaPath(filePath);
  const buf = await readFile(resolvedPath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function localFileSystemPathFromMediaPath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("Invalid file path");
  }
  const trimmed = filePath.trim();
  return /^file:\/\//i.test(trimmed) ? fileURLToPath(trimmed) : trimmed;
}

const COW_FSTYPES_BY_PLATFORM = Object.freeze({
  linux: new Set(["btrfs", "xfs", "zfs"]),
  darwin: new Set(["apfs"]),
});
const stagingCapabilityCache = new Map();
/** project.guid -> Set<snapshotId> staged this app session */
const sessionStagingByProject = new Map();
const sessionProjectQueues = new Map();
const sessionProjectPaths = new Map();
let stagingIndexInstance = null;
let activeProjectPath = "";
let activeProjectGuid = "";

function projectPathForStaging(projectPath) {
  return typeof projectPath === "string" ? projectPath : "";
}

function projectGuidForStaging(projectGuid) {
  return normalizeProjectGuid(projectGuid) || activeProjectGuid;
}

function getStagingIndex() {
  if (!stagingIndexInstance) {
    stagingIndexInstance = new StagingIndex(mediaStagingDir());
  }
  return stagingIndexInstance;
}

function rememberSessionProject(projectGuid, projectPath, queue) {
  const guid = normalizeProjectGuid(projectGuid);
  if (!guid) return;
  sessionProjectPaths.set(guid, projectPathForStaging(projectPath));
  if (Array.isArray(queue)) {
    sessionProjectQueues.set(guid, queue);
  }
}

async function registerSessionStagedSnapshot(projectGuid, projectPath, snapshotId) {
  const id = normalizeSnapshotId(snapshotId);
  if (!id) return;
  const guid = projectGuidForStaging(projectGuid);
  if (!guid) return;
  const resolvedPath = projectPathForStaging(projectPath || activeProjectPath);
  rememberSessionProject(guid, resolvedPath);
  let ids = sessionStagingByProject.get(guid);
  if (!ids) {
    ids = new Set();
    sessionStagingByProject.set(guid, ids);
  }
  ids.add(id);
  await getStagingIndex().registerSnapshot({
    projectGuid: guid,
    projectPath: resolvedPath,
    snapshotId: id,
    unsaved: resolvedPath.length === 0,
  });
}

function collectSnapshotIdsFromQueue(queue) {
  const ids = new Set();
  if (!Array.isArray(queue)) return ids;
  for (const item of queue) {
    const liveSource = item?.liveSource;
    if (
      !liveSource ||
      liveSource.mode !== "linked" ||
      liveSource.strategy !== "snapshot" ||
      liveSource.stagingTier !== "full"
    ) {
      continue;
    }
    const snapshotId = normalizeSnapshotId(liveSource.snapshotId || liveSource.pinnedFileHash);
    const previousSnapshotId = normalizeSnapshotId(liveSource.previousSnapshotId);
    if (snapshotId) ids.add(snapshotId);
    if (previousSnapshotId) ids.add(previousSnapshotId);
  }
  return ids;
}

async function deleteStagedSnapshotsById(stagingDir, snapshotId) {
  const normalizedId = normalizeSnapshotId(snapshotId);
  if (!normalizedId) return;
  let entries = [];
  try {
    entries = await readdir(stagingDir);
  } catch (err) {
    if (err?.code !== "ENOENT") {
      console.error("Failed to read media staging dir:", err);
    }
    return;
  }
  await Promise.all(
    entries.map(async (entry) => {
      if (snapshotIdFromStagedFilename(entry) !== normalizedId) return;
      try {
        await rm(path.join(stagingDir, entry), { force: true });
      } catch (err) {
        if (err?.code !== "ENOENT") {
          console.error(`Failed to remove staged media file ${entry}:`, err);
        }
      }
    }),
  );
}

async function deleteStagedSnapshots(snapshotIds) {
  const stagingDir = mediaStagingDir();
  const uniqueIds = new Set(
    (Array.isArray(snapshotIds) ? snapshotIds : [])
      .map((snapshotId) => normalizeSnapshotId(snapshotId))
      .filter(Boolean),
  );
  for (const snapshotId of uniqueIds) {
    await deleteStagedSnapshotsById(stagingDir, snapshotId);
  }
}

async function maintainMediaStagingIndexOnStartup() {
  const stagingDir = mediaStagingDir();
  await mkdir(stagingDir, { recursive: true });
  const index = getStagingIndex();
  await index.load();
  const ghostSnapshotIds = await index.sweepGhostProjects(readEmprojProjectGuid);
  await deleteStagedSnapshots(ghostSnapshotIds);
  const orphanSnapshotIds = await index.orphanSnapshotIdsOnDisk();
  await deleteStagedSnapshots(orphanSnapshotIds);
  await removeReflinkProbeFiles(stagingDir);
}

async function removeReflinkProbeFiles(stagingDir) {
  let entries = [];
  try {
    entries = await readdir(stagingDir);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(".ems-reflink-probe"))
      .map((entry) => rm(path.join(stagingDir, entry), { force: true }).catch(() => {})),
  );
}

function mediaStagingDir() {
  return path.join(app.getPath("userData"), "media-staging");
}

function queueItemOriginalPathForStaging(item) {
  const liveSource = item?.liveSource;
  if (typeof liveSource?.originalPath === "string" && liveSource.originalPath.length > 0) {
    return liveSource.originalPath;
  }
  if (typeof item?.originalPath === "string" && item.originalPath.length > 0) {
    return item.originalPath;
  }
  return typeof item?.path === "string" ? item.path : "";
}

/** Staged pins to keep when the linked source on disk differs from the active snapshot. */
async function collectProtectedStagingSnapshotIds(queue) {
  const protectedIds = new Set();
  let mediaQueue = queue;
  if (!Array.isArray(mediaQueue)) {
    const autosaveSnapshot = await loadAutosaveProjectSnapshotFromSettings();
    mediaQueue = autosaveSnapshot?.mediaQueue;
  }
  if (!Array.isArray(mediaQueue)) return protectedIds;

  for (const item of mediaQueue) {
    const liveSource = item?.liveSource;
    if (
      !liveSource ||
      liveSource.mode !== "linked" ||
      liveSource.strategy !== "snapshot" ||
      liveSource.stagingTier !== "full"
    ) {
      continue;
    }
    const pinnedSnapshotId = normalizeSnapshotId(
      liveSource.pinnedFileHash || liveSource.snapshotId,
    );
    if (!pinnedSnapshotId) continue;

    const rawPath = queueItemOriginalPathForStaging(item);
    if (!rawPath || isRemoteMediaPath(rawPath)) continue;

    const sourcePath = localFileSystemPathFromMediaPath(rawPath);
    try {
      const version = await computeMediaVersion(sourcePath);
      if (version.fileHash.toLowerCase() !== pinnedSnapshotId) {
        protectedIds.add(pinnedSnapshotId);
        const previousSnapshotId = normalizeSnapshotId(liveSource.previousSnapshotId);
        if (previousSnapshotId) {
          protectedIds.add(previousSnapshotId);
        }
      }
    } catch {
      // Source missing or unreadable — retain the staged pin referenced by autosave.
      protectedIds.add(pinnedSnapshotId);
      const previousSnapshotId = normalizeSnapshotId(liveSource.previousSnapshotId);
      if (previousSnapshotId) {
        protectedIds.add(previousSnapshotId);
      }
    }
  }
  return protectedIds;
}

/**
 * Reconcile one project's queue refs. Staged files are deleted only after the
 * index confirms no project guid still references the snapshot.
 */
async function reconcileStagingForProject({
  projectGuid,
  projectPath,
  queue,
  protectedSnapshotIds,
  detectProtected = true,
}) {
  const guid = projectGuidForStaging(projectGuid);
  const stagingDir = mediaStagingDir();
  if (!guid) {
    await removeReflinkProbeFiles(stagingDir);
    return;
  }
  const resolvedPath = projectPathForStaging(projectPath || activeProjectPath);
  const mediaQueue = Array.isArray(queue) ? queue : [];
  const snapshotIds = collectSnapshotIdsFromQueue(mediaQueue);
  let protectedIds = protectedSnapshotIds;
  if (!Array.isArray(protectedIds) && detectProtected) {
    protectedIds = [...(await collectProtectedStagingSnapshotIds(mediaQueue))];
  }

  rememberSessionProject(guid, resolvedPath, mediaQueue);
  const result = await getStagingIndex().reconcileProject({
    projectGuid: guid,
    projectPath: resolvedPath,
    snapshotIds: [...snapshotIds],
    protectedSnapshotIds: Array.isArray(protectedIds) ? protectedIds : undefined,
    unsaved: resolvedPath.length === 0,
  });

  if (snapshotIds.size > 0) {
    sessionStagingByProject.set(guid, new Set(snapshotIds));
  } else {
    sessionStagingByProject.delete(guid);
  }
  if (Array.isArray(result?.eligibleSnapshotIds)) {
    for (const snapshotId of result.eligibleSnapshotIds) {
      await deleteStagedSnapshotsById(stagingDir, snapshotId);
    }
  }
  await removeReflinkProbeFiles(stagingDir);
}

/** Reconcile all touched projects before quit and remove eligible cache files. */
async function cleanupMediaStagingDir() {
  const autosaveSnapshot = await loadAutosaveProjectSnapshotFromSettings();
  const projectPath =
    typeof autosaveSnapshot?.projectPath === "string"
      ? autosaveSnapshot.projectPath
      : activeProjectPath;
  const projectGuid =
    projectGuidFromSnapshot(autosaveSnapshot) || activeProjectGuid;
  const queue = autosaveSnapshot?.mediaQueue;
  try {
    await reconcileStagingForProject({
      projectGuid,
      projectPath,
      queue,
      detectProtected: true,
    });
  } catch (err) {
    console.error("Failed to reconcile active media staging files:", err);
  }

  for (const [guid, projectQueue] of [...sessionProjectQueues.entries()]) {
    if (guid === projectGuid) continue;
    try {
      await reconcileStagingForProject({
        projectGuid: guid,
        projectPath: sessionProjectPaths.get(guid) || "",
        queue: projectQueue,
        detectProtected: true,
      });
    } catch (err) {
      console.error("Failed to reconcile media staging for project:", guid, err);
    }
  }

  const index = getStagingIndex();
  for (const [guid, projectPathHint] of [...sessionProjectPaths.entries()]) {
    if (projectPathHint) continue;
    try {
      const result = await index.removeProject(guid);
      for (const snapshotId of result.eligibleSnapshotIds || []) {
        await deleteStagedSnapshotsById(mediaStagingDir(), snapshotId);
      }
    } catch (err) {
      console.error("Failed to remove unsaved staging refs:", guid, err);
    }
  }
  sessionStagingByProject.clear();
  sessionProjectQueues.clear();
  sessionProjectPaths.clear();
  stagingCapabilityCache.clear();
  if (autosaveSnapshot && autosaveSnapshot !== activeProjectSnapshot) {
    await cleanupExtractedProjectMedia(autosaveSnapshot).catch(() => {});
  }
}

async function handleCleanupProjectStaging(_, payload = {}) {
  const projectPath =
    typeof payload?.projectPath === "string" ? payload.projectPath : activeProjectPath;
  const projectGuid = normalizeProjectGuid(payload?.projectGuid) || activeProjectGuid;
  const queue = Array.isArray(payload?.mediaQueue) ? payload.mediaQueue : [];
  await reconcileStagingForProject({
    projectGuid,
    projectPath,
    queue,
    detectProtected: true,
  });
  return { ok: true };
}

function decodeMountPath(value) {
  return String(value || "").replace(/\\([0-7]{3})/g, (_match, octal) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  );
}

function pathWithinMount(filePath, mountPoint) {
  const normalizedPath = path.resolve(filePath);
  const normalizedMount = path.resolve(mountPoint);
  if (normalizedMount === path.parse(normalizedMount).root) return true;
  return (
    normalizedPath === normalizedMount ||
    normalizedPath.startsWith(`${normalizedMount}${path.sep}`)
  );
}

async function linuxFilesystemTypeForPath(filePath) {
  let mountinfo = "";
  try {
    mountinfo = await readFile("/proc/self/mountinfo", "utf8");
  } catch {
    return null;
  }
  const resolvedPath = path.resolve(filePath);
  let best = null;
  for (const line of mountinfo.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split(" ");
    const separatorIndex = parts.indexOf("-");
    if (separatorIndex < 0 || separatorIndex + 1 >= parts.length) continue;
    const mountPoint = decodeMountPath(parts[4]);
    if (!pathWithinMount(resolvedPath, mountPoint)) continue;
    if (!best || mountPoint.length > best.mountPoint.length) {
      best = {
        mountPoint,
        filesystem: parts[separatorIndex + 1],
      };
    }
  }
  return best?.filesystem || null;
}

async function filesystemTypeForPath(filePath) {
  if (process.platform === "linux") {
    return linuxFilesystemTypeForPath(filePath);
  }
  return null;
}

function stagingCapabilityPayload(tier, reason, filesystem, stagingDir) {
  return {
    tier,
    reason,
    filesystem: filesystem || null,
    stagingDir,
  };
}

async function canReflinkOnMount(stagingDir) {
  const probeSrc = path.join(stagingDir, ".ems-reflink-probe-src");
  const probeDst = path.join(stagingDir, ".ems-reflink-probe-dst");
  await writeFile(probeSrc, "x");
  try {
    // Match ensureStagedMediaFile: FICLONE works on ZFS/XFS/Btrfs/APFS but
    // FICLONE_FORCE returns ENOTSUP on some CoW filesystems (notably ZFS).
    await copyFile(
      probeSrc,
      probeDst,
      fsConstants.COPYFILE_EXCL | fsConstants.COPYFILE_FICLONE,
    );
    return true;
  } catch {
    return false;
  } finally {
    await rm(probeSrc, { force: true }).catch(() => {});
    await rm(probeDst, { force: true }).catch(() => {});
  }
}

async function getSessionMediaStagingCapability() {
  const stagingDir = mediaStagingDir();
  if (process.platform === "win32") {
    return stagingCapabilityPayload("warn-only", "windows", null, stagingDir);
  }
  await mkdir(stagingDir, { recursive: true });
  const stagingRealPath = await realpath(stagingDir).catch(() => stagingDir);
  const stagingInfo = await stat(stagingRealPath);
  const filesystem = await filesystemTypeForPath(stagingRealPath);
  const supported = COW_FSTYPES_BY_PLATFORM[process.platform];
  if (!supported || !supported.has(filesystem)) {
    return stagingCapabilityPayload(
      "warn-only",
      "unsupported-filesystem",
      filesystem,
      stagingDir,
    );
  }
  const cacheKey = `${stagingInfo.dev}:${filesystem}`;
  if (!stagingCapabilityCache.has(cacheKey)) {
    stagingCapabilityCache.set(cacheKey, await canReflinkOnMount(stagingDir));
  }
  if (!stagingCapabilityCache.get(cacheKey)) {
    return stagingCapabilityPayload(
      "warn-only",
      "reflink-unsupported",
      filesystem,
      stagingDir,
    );
  }
  return stagingCapabilityPayload("full", null, filesystem, stagingDir);
}

async function getItemMediaStagingCapability(sourcePath) {
  const sessionCapability = await getSessionMediaStagingCapability();
  if (sessionCapability.tier !== "full") return sessionCapability;
  let sourceRealPath;
  let stagingRealPath;
  try {
    sourceRealPath = await realpath(sourcePath);
    stagingRealPath = await realpath(sessionCapability.stagingDir);
  } catch {
    return stagingCapabilityPayload(
      "warn-only",
      "unsupported-filesystem",
      sessionCapability.filesystem,
      sessionCapability.stagingDir,
    );
  }
  const [sourceInfo, stagingInfo] = await Promise.all([
    stat(sourceRealPath),
    stat(stagingRealPath),
  ]);
  const sourceFilesystem = await filesystemTypeForPath(sourceRealPath);
  const supported = COW_FSTYPES_BY_PLATFORM[process.platform];
  if (!supported || !supported.has(sourceFilesystem)) {
    return stagingCapabilityPayload(
      "warn-only",
      "unsupported-filesystem",
      sourceFilesystem,
      sessionCapability.stagingDir,
    );
  }
  if (sourceInfo.dev !== stagingInfo.dev) {
    return stagingCapabilityPayload(
      "warn-only",
      "cross-device",
      sourceFilesystem,
      sessionCapability.stagingDir,
    );
  }
  return stagingCapabilityPayload(
    "full",
    null,
    sourceFilesystem,
    sessionCapability.stagingDir,
  );
}

function mediaFileMtimeIso(info) {
  return info.mtime instanceof Date && Number.isFinite(info.mtime.getTime())
    ? info.mtime.toISOString()
    : undefined;
}

async function computeMediaVersion(fsPath) {
  const info = await stat(fsPath);
  if (!info.isFile()) throw new Error("Media source is not a file");
  const fileHash = await hashMediaFile(fsPath);
  return {
    fileHash,
    fileHashAlg: MEDIA_FILE_HASH_ALG,
    sizeBytes: info.size,
    modifiedTime: mediaFileMtimeIso(info),
    mtimeMs: info.mtimeMs,
  };
}

function stagedMediaPathForSnapshot(stagingDir, sourcePath, snapshotId) {
  const ext = path.extname(sourcePath || "").toLowerCase();
  return path.join(stagingDir, `${snapshotId}${ext}`);
}

async function ensureStagedMediaFile(
  sourcePath,
  snapshotId,
  capability,
  projectPath = activeProjectPath,
  projectGuid = activeProjectGuid,
) {
  const stagedPath = stagedMediaPathForSnapshot(
    capability.stagingDir,
    sourcePath,
    snapshotId,
  );
  try {
    const existing = await stat(stagedPath);
    if (existing.isFile()) {
      await registerSessionStagedSnapshot(projectGuid, projectPath, snapshotId);
      return stagedPath;
    }
  } catch {}
  await mkdir(path.dirname(stagedPath), { recursive: true });
  await copyFile(
    sourcePath,
    stagedPath,
    fsConstants.COPYFILE_EXCL | fsConstants.COPYFILE_FICLONE,
  ).catch(async (err) => {
    if (err?.code === "EEXIST") return;
    throw err;
  });
  await registerSessionStagedSnapshot(projectGuid, projectPath, snapshotId);
  return stagedPath;
}

function requestedLiveSourceStrategy(filePath, type, liveSource) {
  if (liveSource?.mode === "packaged") return "reference";
  return filePath || type ? "snapshot" : "reference";
}

function liveSourceModeForPin(liveSource) {
  return liveSource?.mode === "packaged" ? "packaged" : "linked";
}

function activePinnedSnapshotId(liveSource) {
  return normalizeSnapshotId(liveSource?.snapshotId || liveSource?.pinnedFileHash);
}

function pinnedModifiedTimeIso(liveSource, stagedStat = null) {
  if (Number.isFinite(liveSource?.pinnedMtimeMs)) {
    return new Date(liveSource.pinnedMtimeMs).toISOString();
  }
  if (stagedStat) return mediaFileMtimeIso(stagedStat);
  return undefined;
}

async function stagedSnapshotFileExists(stagingDir, sourcePath, snapshotId) {
  const stagedPath = stagedMediaPathForSnapshot(stagingDir, sourcePath, snapshotId);
  try {
    const info = await stat(stagedPath);
    return info.isFile() ? { stagedPath, info } : null;
  } catch {
    return null;
  }
}

function buildLinkedSnapshotPinResult(
  rawPath,
  sourcePath,
  snapshotId,
  capability,
  opts = {},
) {
  const previousLiveSource =
    opts.previousLiveSource && typeof opts.previousLiveSource === "object"
      ? opts.previousLiveSource
      : {};
  const stagedStat = opts.stagedStat || null;
  const pinnedMtimeMs = Number.isFinite(opts.pinnedMtimeMs)
    ? opts.pinnedMtimeMs
    : stagedStat?.mtimeMs ?? null;
  const pinnedSizeBytes = Number.isFinite(opts.pinnedSizeBytes)
    ? opts.pinnedSizeBytes
    : stagedStat?.size ?? null;
  const resolvedPath =
    typeof opts.resolvedPath === "string" && opts.resolvedPath.length > 0
      ? opts.resolvedPath
      : stagedMediaPathForSnapshot(capability.stagingDir, sourcePath, snapshotId);
  return {
    path: rawPath,
    ...baselineFileHashFields(snapshotId),
    sizeBytes: pinnedSizeBytes,
    modifiedTime: pinnedModifiedTimeIso({ pinnedMtimeMs }, stagedStat),
    liveSource: {
      mode: "linked",
      strategy: "snapshot",
      stagingTier: capability.tier,
      originalPath: previousLiveSource.originalPath || rawPath,
      snapshotId,
      pinnedMtimeMs,
      pinnedSizeBytes,
      pinnedFileHash: snapshotId,
      previousSnapshotId:
        normalizeSnapshotId(opts.previousSnapshotId) ||
        normalizeSnapshotId(previousLiveSource.previousSnapshotId) ||
        null,
      reason: typeof opts.reason === "string" ? opts.reason : null,
    },
    resolvedPath,
  };
}

/** Reuse an existing staged clone when the operator kept an older pinned version. */
async function tryResolvePreservedStagedPin({
  sourcePath,
  rawPath,
  previousLiveSource,
  capability,
  diskVersion,
  forceRefresh,
  projectPath = activeProjectPath,
  projectGuid = activeProjectGuid,
}) {
  if (forceRefresh) return null;
  const pinnedSnapshotId = activePinnedSnapshotId(previousLiveSource);
  if (!pinnedSnapshotId || capability.tier !== "full") return null;
  if (diskVersion.fileHash.toLowerCase() === pinnedSnapshotId) return null;

  const staged = await stagedSnapshotFileExists(
    capability.stagingDir,
    sourcePath,
    pinnedSnapshotId,
  );
  if (!staged) return null;

  await registerSessionStagedSnapshot(projectGuid, projectPath, pinnedSnapshotId);

  return buildLinkedSnapshotPinResult(rawPath, sourcePath, pinnedSnapshotId, capability, {
    previousLiveSource,
    stagedStat: staged.info,
    resolvedPath: staged.stagedPath,
    pinnedMtimeMs: Number.isFinite(previousLiveSource.pinnedMtimeMs)
      ? previousLiveSource.pinnedMtimeMs
      : staged.info.mtimeMs,
    pinnedSizeBytes: Number.isFinite(previousLiveSource.pinnedSizeBytes)
      ? previousLiveSource.pinnedSizeBytes
      : staged.info.size,
  });
}

async function pinMediaSource(payload = {}) {
  const rawPath =
    typeof payload?.path === "string"
      ? payload.path
      : typeof payload?.originalPath === "string"
        ? payload.originalPath
        : "";
  if (!rawPath || isRemoteMediaPath(rawPath) || isVirtualMediaPath(rawPath)) {
    return null;
  }
  const sourcePath = localFileSystemPathFromMediaPath(rawPath);
  const type = typeof payload?.type === "string" ? payload.type : "";
  const previousLiveSource =
    payload?.liveSource && typeof payload.liveSource === "object"
      ? payload.liveSource
      : {};
  const mode = liveSourceModeForPin(previousLiveSource);
  const requestedStrategy = requestedLiveSourceStrategy(
    sourcePath,
    type,
    previousLiveSource,
  );
  const version = await computeMediaVersion(sourcePath);
  let forceRefresh = payload?.forceRefresh === true;
  const preservePreviousSnapshot = payload?.preservePreviousSnapshot === true;
  const verifyStagedPin = payload?.verifyStagedPin === true;
  const projectPath =
    typeof payload?.projectPath === "string" ? payload.projectPath : activeProjectPath;
  const projectGuid = normalizeProjectGuid(payload?.projectGuid) || activeProjectGuid;

  if (mode === "packaged") {
    return {
      path: rawPath,
      ...baselineFileHashFields(version.fileHash),
      sizeBytes: version.sizeBytes,
      modifiedTime: version.modifiedTime,
      liveSource: {
        mode: "packaged",
        strategy: "reference",
        stagingTier: "full",
        originalPath: previousLiveSource.originalPath || rawPath,
        snapshotId: null,
        pinnedMtimeMs: version.mtimeMs,
        pinnedSizeBytes: version.sizeBytes,
        pinnedFileHash: version.fileHash,
        previousSnapshotId: null,
        reason: null,
      },
      resolvedPath: sourcePath,
    };
  }

  let capability = await getItemMediaStagingCapability(sourcePath);
  let strategy = requestedStrategy;
  let snapshotId = null;
  let resolvedPath = sourcePath;
  let previousSnapshotId =
    preservePreviousSnapshot && typeof previousLiveSource.previousSnapshotId === "string"
      ? previousLiveSource.previousSnapshotId
      : null;

  if (requestedStrategy === "snapshot" && capability.tier === "full") {
    const preservedPin = await tryResolvePreservedStagedPin({
      sourcePath,
      rawPath,
      previousLiveSource,
      capability,
      diskVersion: version,
      forceRefresh,
      projectPath,
      projectGuid,
    });
    if (preservedPin) {
      return preservedPin;
    }

    const pinnedSnapshotId = activePinnedSnapshotId(previousLiveSource);
    if (!forceRefresh && pinnedSnapshotId) {
      const staged = await stagedSnapshotFileExists(
        capability.stagingDir,
        sourcePath,
        pinnedSnapshotId,
      );
      if (!staged) {
        if (pinnedSnapshotId === version.fileHash.toLowerCase()) {
          resolvedPath = await ensureStagedMediaFile(
            sourcePath,
            pinnedSnapshotId,
            capability,
            projectPath,
            projectGuid,
          );
          return buildLinkedSnapshotPinResult(
            rawPath,
            sourcePath,
            pinnedSnapshotId,
            capability,
            {
              previousLiveSource,
              resolvedPath,
              pinnedMtimeMs: version.mtimeMs,
              pinnedSizeBytes: version.sizeBytes,
            },
          );
        }
        if (verifyStagedPin) {
          console.warn(
            "Staged keep-old pin missing on restore; reloading linked source:",
            rawPath,
          );
          forceRefresh = true;
          previousSnapshotId = preservePreviousSnapshot ? pinnedSnapshotId : null;
        }
      }
    }

    try {
      resolvedPath = await ensureStagedMediaFile(
        sourcePath,
        version.fileHash,
        capability,
        projectPath,
        projectGuid,
      );
      snapshotId = version.fileHash;
      if (
        typeof previousLiveSource.snapshotId === "string" &&
        previousLiveSource.snapshotId.length > 0 &&
        previousLiveSource.snapshotId !== snapshotId &&
        preservePreviousSnapshot
      ) {
        previousSnapshotId = previousLiveSource.snapshotId;
        await registerSessionStagedSnapshot(projectGuid, projectPath, previousSnapshotId);
      }
    } catch (err) {
      console.error("Failed to stage media source; falling back to warn-only:", err);
      capability = {
        ...capability,
        tier: "warn-only",
        reason: err?.code || "reflink-unsupported",
      };
      strategy = "reference";
      snapshotId = null;
      resolvedPath = sourcePath;
    }
  } else if (capability.tier !== "full") {
    strategy = "reference";
  }

  return {
    path: rawPath,
    ...baselineFileHashFields(version.fileHash),
    sizeBytes: version.sizeBytes,
    modifiedTime: version.modifiedTime,
    liveSource: {
      mode: "linked",
      strategy,
      stagingTier: capability.tier,
      originalPath: previousLiveSource.originalPath || rawPath,
      snapshotId,
      pinnedMtimeMs: version.mtimeMs,
      pinnedSizeBytes: version.sizeBytes,
      pinnedFileHash: version.fileHash,
      previousSnapshotId,
      reason: capability.reason,
    },
    resolvedPath,
  };
}

async function resolveStagedMediaPath(payload = {}) {
  if (typeof payload === "string") {
    return localFileSystemPathFromMediaPath(payload);
  }
  const liveSource =
    payload?.liveSource && typeof payload.liveSource === "object"
      ? payload.liveSource
      : {};
  const rawPath =
    typeof payload?.path === "string"
      ? payload.path
      : typeof liveSource.originalPath === "string"
        ? liveSource.originalPath
        : "";
  const projectPath =
    typeof payload?.projectPath === "string" ? payload.projectPath : activeProjectPath;
  const projectGuid = normalizeProjectGuid(payload?.projectGuid) || activeProjectGuid;
  if (!rawPath || isRemoteMediaPath(rawPath) || isVirtualMediaPath(rawPath)) return rawPath;
  const sourcePath = localFileSystemPathFromMediaPath(rawPath);
  if (
    liveSource.mode === "linked" &&
    liveSource.strategy === "snapshot" &&
    liveSource.stagingTier === "full" &&
    typeof liveSource.snapshotId === "string" &&
    liveSource.snapshotId.length > 0
  ) {
    const capability = await getSessionMediaStagingCapability();
    const pinnedSnapshotId = activePinnedSnapshotId(liveSource);
    if (!pinnedSnapshotId) return sourcePath;
    const staged = await stagedSnapshotFileExists(
      capability.stagingDir,
      sourcePath,
      pinnedSnapshotId,
    );
    if (staged) {
      await registerSessionStagedSnapshot(projectGuid, projectPath, pinnedSnapshotId);
      return staged.stagedPath;
    }

    let diskVersion = null;
    try {
      diskVersion = await computeMediaVersion(sourcePath);
    } catch {
      return sourcePath;
    }
    if (diskVersion.fileHash.toLowerCase() === pinnedSnapshotId) {
      try {
        return await ensureStagedMediaFile(
          sourcePath,
          pinnedSnapshotId,
          capability,
          projectPath,
          projectGuid,
        );
      } catch {
        return sourcePath;
      }
    }

    // Staged keep-old bytes are gone — read from the linked source instead of ENOENT.
    return sourcePath;
  }
  return sourcePath;
}

async function handleGetMediaStagingCapability(_, payload = {}) {
  const sourceCandidate =
    typeof payload === "string"
      ? payload
      : typeof payload?.path === "string"
        ? payload.path
        : "";
  const sourcePath = sourceCandidate
    ? localFileSystemPathFromMediaPath(sourceCandidate)
    : "";
  if (sourcePath) return getItemMediaStagingCapability(sourcePath);
  return getSessionMediaStagingCapability();
}

async function handlePinMediaSource(_, payload) {
  return pinMediaSource(payload);
}

async function handleResolveStagedMediaPath(_, payload) {
  return resolveStagedMediaPath(payload);
}

async function handleApproveMediaRefresh(_, payload) {
  return pinMediaSource({ ...(payload || {}), forceRefresh: true });
}

async function handleRollbackMediaRefresh(_, payload = {}) {
  const liveSource =
    payload?.liveSource && typeof payload.liveSource === "object"
      ? payload.liveSource
      : null;
  if (
    !liveSource ||
    liveSource.strategy !== "snapshot" ||
    typeof liveSource.previousSnapshotId !== "string" ||
    liveSource.previousSnapshotId.length === 0
  ) {
    return null;
  }
  return {
    liveSource: {
      ...liveSource,
      snapshotId: liveSource.previousSnapshotId,
      previousSnapshotId:
        typeof liveSource.snapshotId === "string" ? liveSource.snapshotId : null,
      pinnedFileHash: liveSource.previousSnapshotId,
    },
  };
}

async function handleReadMediaOriginalBytes(_, payload = {}) {
  const rawPath =
    typeof payload === "string"
      ? payload
      : typeof payload?.originalPath === "string"
        ? payload.originalPath
        : typeof payload?.path === "string"
          ? payload.path
          : "";
  const buf = await readFile(localFileSystemPathFromMediaPath(rawPath));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function handleRegisterMediaWatches(_, items) {
  return mediaWatcher.sync(items);
}

async function handleCheckMediaPathsExist(_, paths) {
  if (!Array.isArray(paths)) return [];
  const out = [];
  for (const p of paths) {
    if (typeof p !== "string" || p.length === 0) {
      out.push({ path: p, exists: false });
      continue;
    }
    if (/^(https?|m3u8|mpd|blob):/i.test(p)) {
      out.push({ path: p, exists: true });
      continue;
    }
    let fsPath;
    try {
      fsPath = localFileSystemPathFromMediaPath(p);
    } catch {
      out.push({ path: p, exists: false });
      continue;
    }
    try {
      const info = await stat(fsPath);
      out.push({ path: p, exists: info.isFile() });
    } catch {
      out.push({ path: p, exists: false });
    }
  }
  return out;
}

function isRemoteMediaPath(p) {
  return typeof p === "string" && /^(https?|m3u8|mpd|blob):/i.test(p);
}

function isVirtualMediaPath(p) {
  return typeof p === "string" && /^(bible|song):\/\//i.test(p);
}

async function computeMediaBaseline(p) {
  if (isRemoteMediaPath(p) || isVirtualMediaPath(p)) return null;
  let fsPath;
  let info;
  try {
    fsPath = localFileSystemPathFromMediaPath(p);
    info = await stat(fsPath);
    if (!info.isFile()) return null;
  } catch {
    return null;
  }
  let fileHash;
  try {
    fileHash = await hashMediaFile(fsPath);
  } catch {
    return {
      sizeBytes: info.size,
      modifiedTime: mediaFileMtimeIso(info),
    };
  }
  return {
    sizeBytes: info.size,
    modifiedTime: mediaFileMtimeIso(info),
    ...baselineFileHashFields(fileHash),
  };
}

async function handleComputeMediaBaselines(_, paths) {
  if (!Array.isArray(paths)) return [];
  const out = [];
  for (const p of paths) {
    const baseline = await computeMediaBaseline(p);
    out.push({ path: p, baseline: baseline?.fileHash ? baseline : null });
  }
  return out;
}

// Classify each item against its stored baseline {sizeBytes, modifiedTime, fileHash}.
// Status is one of: ok | missing | changed | unverifiable.
// Strategy: compare size+mtime first (cheap); hash with XXH3 only when metadata
// drifted and a baseline fingerprint exists.
async function handlePreflightCheckMedia(_, items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const raw of items) {
    const p = typeof raw?.path === "string" ? raw.path : "";
    if (!p) {
      out.push({ path: p, status: "missing" });
      continue;
    }
    if (isRemoteMediaPath(p)) {
      out.push({ path: p, status: "ok" });
      continue;
    }
    let fsPath;
    let info;
    try {
      fsPath = localFileSystemPathFromMediaPath(p);
      info = await stat(fsPath);
      if (!info.isFile()) throw new Error("Not a file");
    } catch {
      out.push({ path: p, status: "missing" });
      continue;
    }
    const currentSizeBytes = info.size;
    const currentModifiedTime = mediaFileMtimeIso(info);
    const currentMtimeMs = info.mtimeMs;
    const baseSize = Number.isFinite(raw?.sizeBytes) ? raw.sizeBytes : null;
    const baseMtime = typeof raw?.modifiedTime === "string" ? raw.modifiedTime : "";
    const storedHash = storedFileHashFromRecord(raw);
    const hasBaseline =
      baseSize !== null || Boolean(baseMtime) || storedHash !== null;
    if (!hasBaseline) {
      out.push({
        path: p,
        status: "unverifiable",
        currentSizeBytes,
        currentModifiedTime,
        currentMtimeMs,
      });
      continue;
    }
    if (baseSize !== null && currentSizeBytes !== baseSize) {
      out.push({
        path: p,
        status: "changed",
        confirmedByHash: false,
        currentSizeBytes,
        currentModifiedTime,
        currentMtimeMs,
      });
      continue;
    }
    let needConfirm;
    if (baseMtime) {
      if (currentModifiedTime === baseMtime) {
        out.push({ path: p, status: "ok", currentSizeBytes, currentModifiedTime, currentMtimeMs });
        continue;
      }
      needConfirm = true;
    } else {
      needConfirm = storedHash !== null;
    }
    if (!needConfirm) {
      out.push({ path: p, status: "ok", currentSizeBytes, currentModifiedTime, currentMtimeMs });
      continue;
    }
    if (storedHash) {
      let computedHash = "";
      try {
        computedHash = await hashMediaFile(fsPath);
      } catch {
        computedHash = "";
      }
      if (computedHash && computedHash === storedHash) {
        out.push({
          path: p,
          status: "ok",
          currentSizeBytes,
          currentModifiedTime,
          currentMtimeMs,
          currentFileHash: computedHash,
          currentFileHashAlg: MEDIA_FILE_HASH_ALG,
        });
      } else {
        out.push({
          path: p,
          status: "changed",
          confirmedByHash: true,
          currentSizeBytes,
          currentModifiedTime,
          currentMtimeMs,
          currentFileHash: computedHash || undefined,
          currentFileHashAlg: computedHash ? MEDIA_FILE_HASH_ALG : undefined,
        });
      }
      continue;
    }
    out.push({
      path: p,
      status: "changed",
      confirmedByHash: false,
      currentSizeBytes,
      currentModifiedTime,
      currentMtimeMs,
    });
  }
  return out;
}

function wireMainWindowCloseAutosave(mainWindow) {
  allowMainWindowClose = false;
  mainWindow.on("close", (event) => {
    if (allowMainWindowClose) return;
    if (!mainWindow.webContents || mainWindow.webContents.isDestroyed()) return;
    event.preventDefault();
    let finished = false;
    const finishClose = () => {
      if (finished) return;
      finished = true;
      ipcMain.removeListener("app-close-autosave-complete", onAutosaveComplete);
      allowMainWindowClose = true;
      if (!mainWindow.isDestroyed()) {
        mainWindow.close();
      }
    };
    const onAutosaveComplete = () => finishClose();
    ipcMain.once("app-close-autosave-complete", onAutosaveComplete);
    mainWindow.webContents.send("app-close-autosave-requested");
    setTimeout(finishClose, 30000);
  });
}

function createPreflightDialogWindow(parentWindow, payload) {
  return new Promise((resolve) => {
    if (preflightDialogWindow && !preflightDialogWindow.isDestroyed()) {
      if (!preflightDialogWindow.webContents.isDestroyed()) {
        preflightDialogWindow.focus();
        preflightDialogWindow.webContents.focus();
        resolve("dismiss");
        return;
      }
      preflightDialogWindow = null;
    }

    let resolved = false;
    const finish = (action = "dismiss") => {
      if (resolved) return;
      resolved = true;
      if (preflightDialogResponseListener) {
        ipcMain.removeListener(
          PREFLIGHT_DIALOG_IPC_CHANNEL,
          preflightDialogResponseListener,
        );
        preflightDialogResponseListener = null;
      }
      resolve(action);
    };

    const onResponse = (_event, action) => {
      const dlg = preflightDialogWindow;
      if (!dlg || dlg.isDestroyed()) {
        return false;
      }
      const normalizedAction =
        action === "reload" || action === "keep" || action === "ok"
          ? action
          : "dismiss";
      finish(normalizedAction);
      if (!preflightDialogWindow.isDestroyed()) {
        preflightDialogWindow.close();
      }
      return true;
    };

    if (preflightDialogResponseListener) {
      ipcMain.removeListener(
        PREFLIGHT_DIALOG_IPC_CHANNEL,
        preflightDialogResponseListener,
      );
    }
    preflightDialogResponseListener = onResponse;
    ipcMain.on(PREFLIGHT_DIALOG_IPC_CHANNEL, onResponse);

    const changedCount = Array.isArray(payload?.changedItems)
      ? payload.changedItems.length
      : 0;
    const missingCount = Array.isArray(payload?.missingItems)
      ? payload.missingItems.length
      : 0;
    const rowCount = changedCount + missingCount;
    const sectionCount =
      (changedCount > 0 ? 1 : 0) + (missingCount > 0 ? 1 : 0);
    // Base height fits header + intro + one section title + one row + OK without scrolling.
    const dialogHeight = Math.min(
      680,
      Math.max(420, 340 + sectionCount * 36 + rowCount * 58),
    );

    preflightDialogWindow = new BrowserWindow({
      parent: parentWindow,
      modal: true,
      width: 520,
      height: dialogHeight,
      minWidth: 420,
      minHeight: 420,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      transparent: true,
      acceptFirstMouse: true,
      show: false,
      skipTaskbar: true,
      title: "Media Preflight",
      backgroundColor: "#00000000",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        webviewTag: false,
        navigateOnDragDrop: false,
        spellcheck: false,
        devTools: isDevMode,
        preload: path.join(import.meta.dirname, "preflight_dialog_preload.min.mjs"),
      },
    });

    preflightDialogWindow.once("closed", () => {
      if (preflightDialogResponseListener) {
        ipcMain.removeListener(
          PREFLIGHT_DIALOG_IPC_CHANNEL,
          preflightDialogResponseListener,
        );
        preflightDialogResponseListener = null;
      }
      preflightDialogWindow = null;
      finish();
    });

    preflightDialogWindow.loadFile("derived/src/preflight_dialog.prod.html");

    preflightDialogWindow.webContents.once("did-finish-load", () => {
      if (!preflightDialogWindow || preflightDialogWindow.isDestroyed()) {
        return;
      }
      const literal = JSON.stringify(payload ?? {});
      preflightDialogWindow.webContents
        .executeJavaScript(
          `window.preflightDialog?.render?.(${literal});`,
        )
        .catch(() => {});
    });

    preflightDialogWindow.once("ready-to-show", () => {
      if (!preflightDialogWindow || preflightDialogWindow.isDestroyed()) {
        return;
      }
      const parentBounds = parentWindow.getBounds();
      const w = 520;
      const h = dialogHeight;
      const x = parentBounds.x + (parentBounds.width - w) / 2;
      const y = parentBounds.y + (parentBounds.height - h) / 2;
      preflightDialogWindow.setBounds({ x, y, width: w, height: h });
      preflightDialogWindow.show();
      preflightDialogWindow.focus();
      if (!preflightDialogWindow.webContents.isDestroyed()) {
        preflightDialogWindow.webContents.focus();
      }
    });

    preflightDialogWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: "deny" };
    });
  });
}

async function handleShowPreflightSummaryDialog(event, opts = {}) {
  const mainWindow = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow || mainWindow.isDestroyed()) return "dismiss";
  const changedItems = Array.isArray(opts?.changedItems) ? opts.changedItems : [];
  const missingItems = Array.isArray(opts?.missingItems) ? opts.missingItems : [];
  const actionMode =
    opts?.actionMode === "choice" || opts?.actionMode === "reload-only"
      ? opts.actionMode
      : "ok";
  if (changedItems.length === 0 && missingItems.length === 0) return "ok";
  return createPreflightDialogWindow(mainWindow, {
    changedItems,
    missingItems,
    actionMode,
  });
}

async function handleBibleRPC(_event, method, params = []) {
  if (typeof method !== "string" || !method.startsWith("bible.")) {
    throw new Error("Invalid Bible RPC method");
  }
  if (!Array.isArray(params)) {
    throw new Error("Invalid Bible RPC params");
  }
  return bibleRpcClient.call(method, params);
}
async function handleSongsRPC(_event, method, params = []) {
  if (typeof method !== "string" || !method.startsWith("songs.")) {
    throw new Error("Invalid Songs RPC method");
  }
  if (!Array.isArray(params)) {
    throw new Error("Invalid Songs RPC params");
  }
  return songsRpcClient.call(method, params);
}

function setIPC() {
  ipcMain.handle("get-system-time", getSystemTIme);
  ipcMain.handle("get-platform", getPlatform);
  ipcMain.handle("resolve-youtube-stream", handleResolveYouTubeStream);
  ipcMain.on("set-mode", handleSetMode);
  ipcMain.handle("get-setting", getSetting);
  ipcMain.handle("get-all-displays", handleGetAllDisplays);
  ipcMain.handle("show-media-files-dialog", handleShowMediaFilesDialog);
  ipcMain.handle("show-import-song-dialog", handleShowImportSongDialog);
  ipcMain.handle("get-songs-database-path", () => songsRpcClient.databasePath());
  ipcMain.handle("read-file-as-text", handleReadFileAsText);
  ipcMain.handle("show-open-project-dialog", handleShowOpenProjectDialog);
  ipcMain.handle("show-save-project-dialog", handleShowSaveProjectDialog);
  ipcMain.handle("show-export-project-dialog", handleShowExportProjectDialog);
  ipcMain.handle("show-missing-project-files-dialog", handleShowMissingProjectFilesDialog);
  ipcMain.handle("show-relink-folder-dialog", handleShowRelinkFolderDialog);
  ipcMain.handle("relink-missing-media", handleRelinkMissingMedia);
  ipcMain.handle("show-relink-summary-dialog", handleShowRelinkSummaryDialog);
  ipcMain.handle("read-project-file", handleReadProjectFile);
  ipcMain.handle("write-project-file", handleWriteProjectFile);
  ipcMain.handle("save-autosave-project-state", handleSaveAutosaveProjectState);
  ipcMain.handle("set-active-project-path", handleSetActiveProjectPath);
  ipcMain.handle("load-autosave-project-state", handleLoadAutosaveProjectState);
  ipcMain.handle("remember-media-folder", handleRememberMediaFolder);
  ipcMain.handle("remember-last-bible-version", handleRememberLastBibleVersion);
  ipcMain.handle("filter-media-drop-paths", handleFilterMediaDropPaths);
  ipcMain.handle("read-file-as-arraybuffer", handleReadFileAsArrayBuffer);
  ipcMain.handle("check-media-paths-exist", handleCheckMediaPathsExist);
  ipcMain.handle("compute-media-baselines", handleComputeMediaBaselines);
  ipcMain.handle("preflight-check-media", handlePreflightCheckMedia);
  ipcMain.handle("get-media-staging-capability", handleGetMediaStagingCapability);
  ipcMain.handle("pin-media-source", handlePinMediaSource);
  ipcMain.handle("cleanup-project-staging", handleCleanupProjectStaging);
  ipcMain.handle("resolve-staged-media-path", handleResolveStagedMediaPath);
  ipcMain.handle("approve-media-refresh", handleApproveMediaRefresh);
  ipcMain.handle("rollback-media-refresh", handleRollbackMediaRefresh);
  ipcMain.handle("read-media-original-bytes", handleReadMediaOriginalBytes);
  ipcMain.handle("register-media-watches", handleRegisterMediaWatches);
  ipcMain.handle("show-preflight-summary-dialog", handleShowPreflightSummaryDialog);
  ipcMain.handle("bible-rpc", handleBibleRPC);
  ipcMain.handle("songs-rpc", handleSongsRPC);
  ipcMain.handle("slides:list", (_e, opts) => slidesStore.list(opts || {}));
  ipcMain.handle("slides:get", (_e, id) => slidesStore.get(id));
  ipcMain.handle("slides:save", (_e, deck) => slidesStore.save(deck));
  ipcMain.handle("slides:delete", (_e, id) => slidesStore.delete(id));
  ipcMain.handle("slides:duplicate", (_e, id, opts) => slidesStore.duplicate(id, opts || {}));
  ipcMain.handle("slides:list-folders", () => slidesStore.listFolders());
  ipcMain.handle("slides:create-folder", (_e, name) => slidesStore.createFolder(name));
  ipcMain.handle("slides:rename-folder", (_e, id, name) => slidesStore.renameFolder(id, name));
  ipcMain.handle("slides:delete-folder", (_e, id) => slidesStore.deleteFolder(id));
  ipcMain.handle("slides:move-to-folder", (_e, deckId, folderId) => slidesStore.moveToFolder(deckId, folderId));
  ipcMain.handle("slides:ready", () => slidesStore.ready());
  ipcMain.on("remoteplaypause", handleRemotePlayPause);
  ipcMain.on("localMediaState", localMediaStateUpdate);
  ipcMain.on("playback-state-change", handlePlaybackStateChange);
  ipcMain.handle("get-media-current-time", handleGetMediaCurrentTime);
  ipcMain.handle("get-media-window-bounds", handleGetMediaWindowBounds);
  ipcMain.handle("get-pptx-current-slide", handleGetPptxCurrentSlide);
  ipcMain.handle("set-media-loop-status", handleSetLoopStatus);
  ipcMain.handle(
    "media-window-capture-available",
    handleMediaWindowCaptureAvailable,
  );
  ipcMain.on("close-media-window", handleCloseMediaWindow);
  ipcMain.handle("close-media-window-now", handleCloseMediaWindowNow);
  ipcMain.on("media-playback-ended", (event, endedMediaFile) => {
    // The window stays visible-but-transparent between queue items; the
    // renderer hides its <video>/<img> via CSS so nothing paints on screen.
    // Calling mediaWindow.hide() here would trigger Electron #50250, where
    // a hidden+throttled renderer stops decoding video frames after un-hide.
    if (mediaWindow && !mediaWindow.isDestroyed()) {
      mediaWindow.setIgnoreMouseEvents(true);
      mediaWindow.setSkipTaskbar(true);
    }
    if (win && !win.isDestroyed()) {
      win.webContents.send("media-playback-ended", endedMediaFile);
    }
  });
  ipcMain.on("media-window-error", (_event, message) => {
    console.error("[media-window]", message);
  });
  ipcMain.handle("slipstream-media-window", async (event, data) => {
    const targetMediaWindow = mediaWindow;
    if (targetMediaWindow && !targetMediaWindow.isDestroyed()) {
      targetMediaWindow.setIgnoreMouseEvents(true);
      targetMediaWindow.setSkipTaskbar(false);
      try {
        await targetMediaWindow.webContents.executeJavaScript(
          `window.emsApplySlipstream(${JSON.stringify(data)})`,
        );
      } catch (err) {
        if (!targetMediaWindow.isDestroyed()) {
          console.error("Failed to slipstream media window:", err);
        }
        return false;
      }
      return true;
    }
    return false;
  });
  ipcMain.on("vlcl", handleVlcl);
  ipcMain.on("update-text", (_event, message) => {
    if (mediaWindow && !mediaWindow.isDestroyed()) {
      mediaWindow.webContents.send("update-text", message);
    }
  });
  ipcMain.on("update-lower-third-text", (_event, message) => {
    if (lowerThirdWindow && !lowerThirdWindow.isDestroyed()) {
      lowerThirdWindow.webContents.send("update-text", message);
    }
  });
  ipcMain.handle("create-media-window", handleCreateMediaWindow);
  ipcMain.handle("create-lower-third-window", handleCreateLowerThirdWindow);
  ipcMain.handle("close-lower-third-window-now", handleCloseLowerThirdWindowNow);
  ipcMain.on("timeGoto-message", handleTimeGotoMessage);
  ipcMain.on("play-ctl", handlePlayCtl);
  ipcMain.on("pptx-goto-slide", (_event, data) => {
    if (mediaWindow && !mediaWindow.isDestroyed()) {
      mediaWindow.webContents.send("pptx-goto-slide", data);
    }
  });
  ipcMain.on("set-display-index", handleSetDisplayIndex);
  ipcMain.on("set-lower-third-display-index", handleSetLowerThirdDisplayIndex);
  ipcMain.on("media-seekto", (event, seekTime) => {
    win?.webContents.send("timeGoto-message", {
      currentTime: seekTime,
      timestamp: Date.now(),
    });
  });
  ipcMain.on("log-to-file", (event, data) => {
    writeFile('/home/christian/EMSMediaSystem/derived/renderer_log.txt', data + "\n", { flag: 'a' })
      .catch(err => console.error("failed to log to file", err));
  });
  ipcMain.on("minimize-window", (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    senderWindow.minimize();
  });

  ipcMain.on("maximize-window", (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);

    if (senderWindow) {
      if (senderWindow.isMaximized()) {
        senderWindow.unmaximize();
      } else {
        senderWindow.maximize();
      }
    }
  });
  ipcMain.handle("open-about-window", (event) => {
    const mainWindow = BrowserWindow.fromWebContents(event.sender);
    createAboutWindow(mainWindow);
  });
  ipcMain.handle("show_queue_switch_dialog", async (event, opts) => {
    const mainWindow = BrowserWindow.fromWebContents(event.sender);
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const message =
      opts && typeof opts.message === "string"
        ? opts.message
        : "Switch to another item?";
    return createQueueSwitchDialogWindow(mainWindow, message);
  });
  ipcMain.handle("dismiss-queue-switch-dialog", handleDismissQueueSwitchDialog);
  ipcMain.handle("open-help-window", (event) => {
    createHelpWindow();
  });
  ipcMain.handle("get-session-id", () => {
    if (sessionID === 0) {
      sessionID =
        process.hrtime.bigint().toString(36) +
        Math.random().toString(36).substr(2, 9);
    }
    return sessionID;
  });
}

app.once("browser-window-created", setIPC);

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.isQuitting = true;
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    const projectPath = firstProjectPathFromArgv(argv);
    if (projectPath) {
      dispatchProjectOpenPath(projectPath);
    }
  });
}

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (isProjectFilePath(filePath)) {
    dispatchProjectOpenPath(filePath);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  event.preventDefault();
  bibleRpcClient.stop();
  mediaWatcher.closeAll();
  const cleanupTasks = [cleanupMediaStagingDir()];
  if (activeProjectSnapshot) {
    const snapshotToClean = activeProjectSnapshot;
    activeProjectSnapshot = null;
    cleanupTasks.push(cleanupExtractedProjectMedia(snapshotToClean));
  }
  void Promise.allSettled(cleanupTasks).finally(() => {
    app.quit();
  });
});

app.on("activate", () => {
  if (!win) {
    measurePerformance("Creating window on activate", createWindow);
  }
});

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  await purgeEmbeddedAutosaveProjectState().catch((err) => {
    console.error("failed to purge embedded autosave project state:", err);
  });
  await maintainMediaStagingIndexOnStartup().catch((err) => {
    console.error("media staging index maintenance failed:", err);
  });
  const startupProjectPath = firstProjectPathFromArgv(process.argv.slice(1));
  if (startupProjectPath) {
    pendingProjectOpenPath = startupProjectPath;
  }
  // The main UI enables COOP + COEP (`require-corp`) for high-resolution timers /
  // SharedArrayBuffer; that policy blocks cross-origin XHR from hls.js to
  // `*.googlevideo.com` because those responses do not opt into CORP.
  mediaPresentationSession = session.fromPartition(
    "persist:ems-media-presentation",
  );

  // Many googlevideo URLs expect a YouTube Referer; hls.js / dash.js XHRs
  // do not send one by default.
  //
  // Live HLS URLs come from the IOS-client manifest and the segment URLs are
  // signed against the *exact* request shape the IOS app would send: the
  // iOS User-Agent string, and crucially, *no* Referer / Origin / Sec-CH-UA*
  // client hints. If we add browser-style headers to those requests, YouTube
  // 403s every fragment because the request no longer looks like an iOS app.
  //
  // VOD URLs from TV_SIMPLY / WEB_EMBEDDED are signed against a browser
  // request and *do* expect a YouTube Referer + Origin; for those we keep
  // the original Chromium UA and inject Referer / Origin.
  //
  // The primary live signal is {@link youtubeLiveSessionActive} (set by the
  // resolver when it hands back an HLS URL); URL-substring patterns are a
  // defensive fallback for late-arriving requests.
  //
  // IOS_USER_AGENT must match youtubei.js's Constants.CLIENTS.IOS.USER_AGENT
  // verbatim — the manifest is signed against this exact string and any
  // drift (older version, different device model, trailing semicolon, etc.)
  // makes the segment server reject the URL.
  const IOS_USER_AGENT =
    "com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)";
  const urlLooksLikeLiveSegment = (url) =>
    url.includes("yt_live_broadcast") ||
    url.includes("/source/yt_live") ||
    url.includes("c=IOS") ||
    url.includes("client=ios") ||
    // Path-style live HLS segment markers used by the IOS manifest.
    /\/videoplayback\/.+?\/index\.m3u8\//.test(url) ||
    url.includes("/file/seg.ts");
  const needsIosUserAgent = (url) =>
    url.includes("googlevideo.com") &&
    (youtubeLiveSessionActive || urlLooksLikeLiveSegment(url));
  const stripBrowserIdentityHeaders = (headers) => {
    // Chromium fills in these on every fetch and leaks the real browser
    // identity even after we override `User-Agent`. The iOS app never sends
    // them, so YouTube's signed-URL validator on live segments rejects the
    // request if they are present. Strip in-place.
    const out = { ...headers };
    for (const key of Object.keys(out)) {
      const k = key.toLowerCase();
      if (
        k === "sec-ch-ua" ||
        k.startsWith("sec-ch-ua-") ||
        k === "sec-fetch-site" ||
        k === "sec-fetch-mode" ||
        k === "sec-fetch-dest" ||
        k === "sec-fetch-user" ||
        k === "referer" ||
        k === "origin"
      ) {
        delete out[key];
      }
    }
    return out;
  };
  const injectGooglevideoHeaders = (details, callback) => {
    let requestHeaders = details.requestHeaders;
    if (details.url.includes("googlevideo.com")) {
      if (needsIosUserAgent(details.url)) {
        // iOS-signed live segments: strip browser identity, then set iOS UA.
        // NB: order matters — we strip first so a leftover lowercase
        // "user-agent" from Chromium does not shadow our override.
        const stripped = stripBrowserIdentityHeaders(details.requestHeaders);
        for (const k of Object.keys(stripped)) {
          if (k.toLowerCase() === "user-agent") delete stripped[k];
        }
        requestHeaders = { ...stripped, "User-Agent": IOS_USER_AGENT };
      } else {
        // VOD / browser-style googlevideo URLs need a YouTube Referer +
        // Origin; UA stays as Chromium because the URL was signed for it.
        requestHeaders = {
          ...details.requestHeaders,
          Referer: "https://www.youtube.com/",
          Origin: "https://www.youtube.com",
        };
      }
    }
    callback({ requestHeaders });
  };
  const redirectGooglevideoPathN = (details, callback) => {
    transformYoutubePathNUrl(details.url)
      .then((redirectURL) => {
        callback(
          redirectURL && redirectURL !== details.url ? { redirectURL } : {},
        );
      })
      .catch((err) => {
        console.error("Failed to transform YouTube HLS segment URL:", err);
        callback({});
      });
  };
  const googlevideoRequestFilter = { urls: ["*://*.googlevideo.com/*"] };
  mediaPresentationSession.webRequest.onBeforeRequest(
    googlevideoRequestFilter,
    redirectGooglevideoPathN,
  );
  mediaPresentationSession.webRequest.onBeforeSendHeaders(
    injectGooglevideoHeaders,
  );

  // COOP + COEP for the main renderer only (SharedArrayBuffer / high-res timers).
  // Do not attach this to mediaPresentationSession.
  const headersHandler = (details, callback) => {
    if (!details.responseHeaders) details.responseHeaders = {};

    details.responseHeaders["Cross-Origin-Opener-Policy"] = ["same-origin"];
    details.responseHeaders["Cross-Origin-Embedder-Policy"] = ["require-corp"];

    callback({ responseHeaders: details.responseHeaders });
  };

  session.defaultSession.webRequest.onHeadersReceived(headersHandler);

  // Mirror the googlevideo header injection for the control window's stream
  // preview (uses defaultSession). Same conditional UA logic as the
  // presentation session: iOS UA only for live broadcast URLs.
  session.defaultSession.webRequest.onBeforeRequest(
    googlevideoRequestFilter,
    redirectGooglevideoPathN,
  );
  session.defaultSession.webRequest.onBeforeSendHeaders(
    injectGooglevideoHeaders,
  );
  session.defaultSession.setDisplayMediaRequestHandler(
    handleMediaWindowDisplayMediaRequest,
    { useSystemPicker: false },
  );
  measurePerformance("Creating window", createWindow);
  if (isDevMode) {
    const appReadyTime = performance.now();
    console.log(
      `Application ready in ${(appReadyTime - appStartTime).toFixed(2)} ms`,
    );
  }

  win.on("move", checkWindowState);
  win.on("resize", checkWindowState);

  screen.on("display-added", handleDisplayChange);
  screen.on("display-removed", handleDisplayChange);
  screen.on("display-metrics-changed", handleDisplayChange);
});

const mainWindowOptions = {
  frame: false,
  transparent: true,
  width: windowBounds ? windowBounds.width : 960,
  height: windowBounds ? windowBounds.height : 548,
  x: windowBounds ? windowBounds.x : 0,
  y: windowBounds ? windowBounds.y : 0,
  minWidth: 960,
  minHeight: 548,
  icon: `${import.meta.dirname}/icon.png`,
  paintWhenInitiallyHidden: true,
  show: false,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    v8CacheOptions: "bypassHeatCheck",
    userGesture: true,
    backgroundThrottling: false,
    experimentalFeatures: true,
    autoplayPolicy: "no-user-gesture-required",
    preload: `${path.dirname(import.meta.dirname)}/src/app_preload.min.mjs`,
    devTools: isDevMode,
  },
};
