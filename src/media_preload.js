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

window.addEventListener("DOMContentLoaded", () => {
  const video = document.getElementById("bigPlayer");

  contextBridge.exposeInMainWorld("api", {
    video,
  });
});

(async () => {
  const { attachCubicWaveShaper } = await import(`./audioFx.min.mjs`);

  contextBridge.exposeInMainWorld("electron", {
    ipcRenderer: {
      send: ipcRenderer.send.bind(ipcRenderer),
      on: ipcRenderer.on.bind(ipcRenderer),
      invoke: ipcRenderer.invoke.bind(ipcRenderer),
    },
    attachCubicWaveShaper,
    argv: process.argv,
    birth: process.argv[process.argv.length - 1],

    createFadeOut: (duration = 3, debug = false) => {
      const fade = new FadeOut(duration, debug);
      return {
        attach: (mediaEl, limiter = null) => fade.attach(mediaEl, limiter),
        fade: (mediaEl, onComplete) => fade.fade(mediaEl, onComplete),
        cancel: (mediaEl) => fade.cancel(mediaEl),
        detach: (mediaEl) => fade.detach(mediaEl),
        detachAll: () => fade.detachAll(),
      };
    },
  });
})();
