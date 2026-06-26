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

const { contextBridge, ipcRenderer } = require("electron/renderer");

const audioFxPromise = import(`./audioFx.min.mjs`);
let timeRemainingPort = null;

ipcRenderer.on("timeRemaining-port", (event) => {
  const [port] = event.ports || [];
  if (!port) return;

  if (timeRemainingPort) {
    try {
      timeRemainingPort.close();
    } catch {}
  }

  timeRemainingPort = port;
  timeRemainingPort.start?.();
});

function sendTimeRemaining(payload) {
  if (!timeRemainingPort) return false;
  try {
    timeRemainingPort.postMessage(payload);
    return true;
  } catch {
    try {
      timeRemainingPort.close();
    } catch {}
    timeRemainingPort = null;
    return false;
  }
}

function exposeMediaApi() {
  const video = document.getElementById("bigPlayer");

  contextBridge.exposeInMainWorld("api", {
    video,
  });
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", exposeMediaApi, { once: true });
} else {
  exposeMediaApi();
}

contextBridge.exposeInMainWorld("electron", {
  ipcRenderer: {
    send: ipcRenderer.send.bind(ipcRenderer),
    on: ipcRenderer.on.bind(ipcRenderer),
    invoke: ipcRenderer.invoke.bind(ipcRenderer),
  },
  timeRemaining: {
    send: sendTimeRemaining,
    isPortReady: () => Boolean(timeRemainingPort),
  },
  attachCubicWaveShaper: async (...args) => {
    const { attachCubicWaveShaper } = await audioFxPromise;
    return attachCubicWaveShaper(...args);
  },
  argv: process.argv,
  birth: process.argv[process.argv.length - 1],

  createFadeOut: (duration = 3, debug = false) => {
    const fadePromise = audioFxPromise.then(
      ({ FadeOut }) => new FadeOut(duration, debug),
    );
    return {
      attach: async (mediaEl, limiter = null) =>
        (await fadePromise).attach(mediaEl, limiter),
      fade: async (mediaEl, onComplete) =>
        (await fadePromise).fade(mediaEl, onComplete),
      cancel: async (mediaEl) => (await fadePromise).cancel(mediaEl),
      detach: async (mediaEl) => (await fadePromise).detach(mediaEl),
      detachAll: async () => (await fadePromise).detachAll(),
    };
  },
});
