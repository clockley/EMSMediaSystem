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

import { contextBridge, ipcRenderer, webUtils } from "electron/renderer";
import { FadeOut, attachCubicWaveShaper } from "./audioFx.min.mjs";

let isInitialized = false;
let initPromise = null;

async function initialize() {
  if (isInitialized) return;
  if (!initPromise) {
    initPromise = (async () => {
      await ipcRenderer.invoke("bible-rpc", "bible.ready", []);
      isInitialized = true;
    })();
  }
  return initPromise;
}

async function callBible(method, params = []) {
  await initialize();
  return ipcRenderer.invoke("bible-rpc", method, params);
}

const bibleAPI = {
  waitForReady: () => initialize(),
  getVersions: () => callBible("bible.getVersions"),
  getText: (version, book, verse) => callBible("bible.getText", [version, book, verse]),
  getBookInfo: (version, name) => callBible("bible.getBookInfo", [version, name]),
  getChapterInfo: (version, name, chapterNumber) =>
    callBible("bible.getChapterInfo", [version, name, chapterNumber]),
  resolveReference: (version, reference) =>
    callBible("bible.resolveReference", [version, reference]),
  getPassage: (version, reference) => callBible("bible.getPassage", [version, reference]),
  getBookMetadata: (version) => callBible("bible.getBookMetadata", [version]),
  suggestReferences: (version, input) =>
    input === undefined
      ? callBible("bible.suggestReferences", [version])
      : callBible("bible.suggestReferences", [version, input]),
};

contextBridge.exposeInMainWorld("electron", {
  ipcRenderer: {
    send: ipcRenderer.send.bind(ipcRenderer),
    on: ipcRenderer.on.bind(ipcRenderer),
    once: ipcRenderer.once.bind(ipcRenderer),
    invoke: ipcRenderer.invoke.bind(ipcRenderer),
  },
  __dirname: import.meta.dirname,
  bibleAPI,
  webUtils,
  attachCubicWaveShaper,

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

contextBridge.exposeInMainWorld("windowControls", {
  minimize: () => ipcRenderer.send("minimize-window"),
  maximize: () => ipcRenderer.send("maximize-window"),
  onMaximizeChange: (callback) => ipcRenderer.on("maximize-change", callback),
});

// Freeze objects after initialization
initialize()
  .then(() => {
    Object.freeze(window.electron);
    Object.freeze(window.windowControls);
  })
  .catch(console.error);
