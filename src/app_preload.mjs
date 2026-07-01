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
let timeRemainingPort = null;
let timeRemainingTickListener = null;

function closeTimeRemainingPort() {
  if (!timeRemainingPort) return;

  const port = timeRemainingPort;
  timeRemainingPort = null;
  port.onmessage = null;

  try {
    port.close();
  } catch {}
}

function handleTimeRemainingMessage(messageEvent) {
  const data = messageEvent.data;

  if (timeRemainingTickListener) {
    try {
      timeRemainingTickListener(data[0], data[1], data[2], data[3]);
    } catch (err) {
      console.error("timeRemaining tick listener failed:", err);
    }
  }
}

ipcRenderer.on("timeRemaining-port", (event) => {
  const port = event.ports?.[0];
  if (!port) return;

  closeTimeRemainingPort();
  timeRemainingPort = port;
  timeRemainingPort.onmessage = handleTimeRemainingMessage;
  timeRemainingPort.start?.();
});

async function initialize() {
  if (isInitialized) return;
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await Promise.all([
          ipcRenderer.invoke("bible-rpc", "bible.ready", []),
          ipcRenderer.invoke("songs-rpc", "songs.ready", [])
        ]);
        isInitialized = true;
      } catch (err) {
        initPromise = null;
        throw err;
      }
    })();
  }
  return initPromise;
}

async function callBible(method, params = []) {
  await initialize();
  return ipcRenderer.invoke("bible-rpc", method, params);
}

async function callSongs(method, params = []) {
  await initialize();
  return ipcRenderer.invoke("songs-rpc", method, params);
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
  searchText: (version, query, options = {}) =>
    callBible("bible.searchText", [version, query, options]),
  suggestReferences: (version, input) =>
    input === undefined
      ? callBible("bible.suggestReferences", [version])
      : callBible("bible.suggestReferences", [version, input]),
};

const songsAPI = {
  waitForReady: () => initialize(),
  search: (query = "", options = {}) =>
    callSongs("songs.search", [{ query, folderId: options.folderId ?? null, all: options.all === true, unfiled: options.unfiled === true }]),
  get: (id) => callSongs("songs.get", [id]),
  save: (song, originalJSON) => callSongs("songs.save", [song, originalJSON]),
  delete: (id) => callSongs("songs.delete", [id]),
  listFolders: () => callSongs("songs.folders.list", []),
  createFolder: (name) => callSongs("songs.folders.create", [name]),
  renameFolder: (id, name) => callSongs("songs.folders.rename", [id, name]),
  deleteFolder: (id) => callSongs("songs.folders.delete", [id]),
  moveToFolder: (songId, folderId) => callSongs("songs.moveToFolder", [songId, folderId ?? null]),
  importFiles: (paths, options = {}) =>
    callSongs("songs.importFiles", [{
      paths,
      defaultFolderId: options.defaultFolderId ?? null,
      search: {
        query: options.search?.query ?? "",
        folderId: options.search?.folderId ?? null,
        all: options.search?.all === true,
        unfiled: options.search?.unfiled === true,
      },
    }]),
  parseLyricsText: (text) => callSongs("songs.parseLyricsText", [text]),
};

const slidesAPI = {
  waitForReady: () => ipcRenderer.invoke("slides:ready"),
  list: (options = {}) => ipcRenderer.invoke("slides:list", options),
  get: (id) => ipcRenderer.invoke("slides:get", id),
  save: (deck) => ipcRenderer.invoke("slides:save", deck),
  delete: (id) => ipcRenderer.invoke("slides:delete", id),
  duplicate: (id, options = {}) => ipcRenderer.invoke("slides:duplicate", id, options),
  listFolders: () => ipcRenderer.invoke("slides:list-folders"),
  createFolder: (name) => ipcRenderer.invoke("slides:create-folder", name),
  renameFolder: (id, name) => ipcRenderer.invoke("slides:rename-folder", id, name),
  deleteFolder: (id) => ipcRenderer.invoke("slides:delete-folder", id),
  moveToFolder: (deckId, folderId) => ipcRenderer.invoke("slides:move-to-folder", deckId, folderId ?? null),
};

contextBridge.exposeInMainWorld("electron", {
  ipcRenderer: {
    send: ipcRenderer.send.bind(ipcRenderer),
    on: ipcRenderer.on.bind(ipcRenderer),
    once: ipcRenderer.once.bind(ipcRenderer),
    invoke: ipcRenderer.invoke.bind(ipcRenderer),
  },
  timeRemaining: {
    onTick: (listener) => {
      if (typeof listener !== "function") return () => {};
      timeRemainingTickListener = listener;
      return () => {
        if (timeRemainingTickListener === listener) {
          timeRemainingTickListener = null;
        }
      };
    },
    isPortReady: () => Boolean(timeRemainingPort),
  },
  __dirname: import.meta.dirname,
  bibleAPI,
  songsAPI,
  slidesAPI,
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
