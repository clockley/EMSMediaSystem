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
  screen,
  powerSaveBlocker,
  session,
  shell,
} from "electron/main";
import { readdir, readFile } from "fs/promises";
import path from "path";
import settings from "./settings.min.mjs";
let sessionID = 0;
let innertubePromise = null;
const isDevMode = process.env.ems_dev === "true";
const openDevConsole = process.env.ems_dev_console === "true";
let lastKnownDisplayState = null;
let wasDisplayDisconnected = false;
let aboutWindow = null;
let helpWindow = null;
let queueSwitchDialogWindow = null;
/** IPC channel for queue-switch modal; use invoke/handle so responses are routed reliably. */
const QUEUE_SWITCH_DIALOG_IPC_CHANNEL = "queue-switch-dialog-response";

app.commandLine.appendSwitch("js-flags", "--maglev --no-use-osr");
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
let windowBounds = measurePerformance("Getting window bounds", getWindowBounds);
let win = null;

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
  win.on("maximize", handleMaximizeChange.bind(null, true));
  win.on("unmaximize", handleMaximizeChange.bind(null, false));

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
  );
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

function sendRemainingTime(event, arg) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("timeRemaining-message", {
    duration: arg?.[0],
    currentTime: arg?.[1],
    timestamp: arg?.[2],
    mediaFile: arg?.[3],
  });
}

function getSetting(_, setting) {
  return settings.getSync(setting);
}

function handleCloseMediaWindow(event, id) {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    mediaWindow.close();
  }
  // Closing the projection window ends any active YouTube live HLS session;
  // clear the flag so the next item (often a VOD) isn't given the iOS UA.
  youtubeLiveSessionActive = false;
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

async function handleCreateMediaWindow(event, windowOptions, displayIndex) {
  return measurePerformance("Creating media window", async () => {
    const displays = screen.getAllDisplays();
    // Use selected display or fall back
    const targetDisplay =
      displays[displayIndex] ||
      displays.find((d) => d.bounds.x !== 0 || d.bounds.y !== 0) ||
      displays[0];

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
      x: targetDisplay.bounds.x,
      y: targetDisplay.bounds.y,
      width: targetDisplay.bounds.width,
      height: targetDisplay.bounds.height,
      webPreferences: {
        ...incomingPrefs,
        session: mediaPresentationSession,
      },
    };

    mediaWindow = new BrowserWindow(finalWindowOptions);
    mediaWindow.setIgnoreMouseEvents(true);
    //mediaWindow.openDevTools()
    await mediaWindow.loadFile("derived/src/media.prod.html");
    mediaWindow.on("closed", () => {
      const closedId = mediaWindow?.id;
      mediaWindow = null;
      stopMediaPlaybackPowerHint();
      if (win && !win.isDestroyed()) {
        win.webContents.send("media-window-closed", closedId);
      }
    });

    // Save the selected display index
    settings.set("lastDisplayIndex", displayIndex).catch((error) => {
      console.error("Error saving display preference:", error);
    });

    return mediaWindow.id;
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

async function handleSetLoopStatus(event, arg) {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    if (arg !== undefined) {
      if (arg === true) {
        await mediaWindow.webContents.executeJavaScript(
          "window.api.video.loop=true",
        );
      } else {
        await mediaWindow.webContents.executeJavaScript(
          "window.api.video.loop=false",
        );
      }
    }
    return await mediaWindow.webContents.executeJavaScript(
      "window.api.video.loop",
    );
  }
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

  let defaultDisplayIndex;
  if (savedDisplayIndex !== undefined && displays[savedDisplayIndex]) {
    defaultDisplayIndex = savedDisplayIndex;
  } else {
    defaultDisplayIndex = displays.findIndex(
      (d) => d.bounds.x !== 0 || d.bounds.y !== 0,
    );
    if (defaultDisplayIndex === -1) defaultDisplayIndex = 0;
  }

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
  };
}

function handleSetDisplayIndex(event, index) {
  settings.set("lastDisplayIndex", index).catch((error) => {
    console.error("Error saving display index:", error);
  });

  // If there's an active media window, move it to the new display
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    const displays = screen.getAllDisplays();
    const targetDisplay =
      displays[index] ||
      displays.find((d) => d.bounds.x !== 0 || d.bounds.y !== 0) ||
      displays[0];

    mediaWindow.setBounds({
      x: targetDisplay.bounds.x,
      y: targetDisplay.bounds.y,
      width: targetDisplay.bounds.width,
      height: targetDisplay.bounds.height,
    });
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
];

const ALLOWED_MEDIA_EXTENSION_SET = new Set(
  ALLOWED_MEDIA_EXTENSIONS.map((ext) => "." + ext.toLowerCase()),
);

async function handleShowMediaFilesDialog(event) {
  const mainWindow = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { canceled: true, filePaths: [] };
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open media",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Media", extensions: ALLOWED_MEDIA_EXTENSIONS },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths?.length) {
    return { canceled: true, filePaths: [] };
  }
  return { canceled: false, filePaths: result.filePaths };
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

function setIPC() {
  ipcMain.handle("get-system-time", getSystemTIme);
  ipcMain.handle("get-platform", getPlatform);
  ipcMain.handle("resolve-youtube-stream", handleResolveYouTubeStream);
  ipcMain.on("set-mode", handleSetMode);
  ipcMain.handle("get-setting", getSetting);
  ipcMain.handle("get-all-displays", handleGetAllDisplays);
  ipcMain.handle("show-media-files-dialog", handleShowMediaFilesDialog);
  ipcMain.handle("filter-media-drop-paths", handleFilterMediaDropPaths);
  ipcMain.on("remoteplaypause", handleRemotePlayPause);
  ipcMain.on("localMediaState", localMediaStateUpdate);
  ipcMain.on("playback-state-change", handlePlaybackStateChange);
  ipcMain.handle("get-media-current-time", handleGetMediaCurrentTime);
  ipcMain.handle("set-media-loop-status", handleSetLoopStatus);
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
  ipcMain.handle("slipstream-media-window", async (event, data) => {
    if (mediaWindow && !mediaWindow.isDestroyed()) {
      mediaWindow.setIgnoreMouseEvents(true);
      mediaWindow.setSkipTaskbar(false);
      await mediaWindow.webContents.executeJavaScript(
        `window.emsApplySlipstream(${JSON.stringify(data)})`,
      );
      return true;
    }
    return false;
  });
  ipcMain.on("timeRemaining-message", sendRemainingTime);
  ipcMain.on("vlcl", handleVlcl);
  ipcMain.handle("create-media-window", handleCreateMediaWindow);
  ipcMain.on("timeGoto-message", handleTimeGotoMessage);
  ipcMain.on("play-ctl", handlePlayCtl);
  ipcMain.on("set-display-index", handleSetDisplayIndex);
  ipcMain.on("media-seekto", (event, seekTime) => {
    win?.webContents.send("timeGoto-message", {
      currentTime: seekTime,
      timestamp: Date.now(),
    });
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (!win) {
    measurePerformance("Creating window on activate", createWindow);
  }
});

app.whenReady().then(async () => {
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
  session.defaultSession.webRequest.onBeforeSendHeaders(
    injectGooglevideoHeaders,
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
