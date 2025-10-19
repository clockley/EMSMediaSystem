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

import { contextBridge, ipcRenderer, webUtils } from 'electron/renderer';
import { readFile } from 'fs/promises';
import { Bible } from './Bible.min.mjs';
import { Script } from 'vm';
import { AudioLimiter } from './audioLimiter.min.mjs';

let isInitialized = false;
let initPromise = null;
let bibleInstance = null;

async function initialize() {
  if (isInitialized) return;
  if (!initPromise) {
    initPromise = (async () => {
      // Load WASM script
      const wasmExecScript = await readFile(`${import.meta.dirname}/wasm_exec.min.js`, 'utf8');
      new Script(wasmExecScript).runInThisContext();
      
      // Initialize Bible
      bibleInstance = new Bible();
      await bibleInstance.init();
      isInitialized = true;
    })();
  }
  return initPromise;
}

const bibleAPI = {
  getBooks: () => {
    if (!isInitialized) throw new Error('Bible API not initialized');
    return bibleInstance.getBooks();
  },
  getVersions: () => {
    if (!isInitialized) throw new Error('Bible API not initialized');
    return bibleInstance.getVersions();
  },
  getText: (version, book, verse) => {
    if (!isInitialized) throw new Error('Bible API not initialized');
    return bibleInstance.getText(version, book, verse);
  },
  getBookInfo: (version, name) => {
    if (!isInitialized) throw new Error('Bible API not initialized');
    return bibleInstance.getBookInfo(version, name);
  },
  getChapterInfo: (version, name, chapterNumber) => {
    if (!isInitialized) throw new Error('Bible API not initialized');
    return bibleInstance.getChapterInfo(version, name, chapterNumber);
  }
};

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: ipcRenderer.send.bind(ipcRenderer),
    on: ipcRenderer.on.bind(ipcRenderer),
    once: ipcRenderer.once.bind(ipcRenderer),
    invoke: ipcRenderer.invoke.bind(ipcRenderer),
  },
  __dirname: import.meta.dirname,
  bibleAPI,
  webUtils,
  createAudioLimiter: (thresholdDb) => {
    const limiter = new AudioLimiter(thresholdDb);
    return {
      attach: (mediaEl) => limiter.attach(mediaEl),
      dispose: () => limiter.dispose()
    };
  }
});

contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.send('minimize-window'),
  maximize: () => ipcRenderer.send('maximize-window'),
  onMaximizeChange: (callback) => ipcRenderer.on('maximize-change', callback)
});

// Freeze objects after initialization
initialize().then(() => {
  Object.freeze(window.electron);
  Object.freeze(window.windowControls);
}).catch(console.error);