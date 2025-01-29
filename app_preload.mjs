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
import { Bible } from './Bible.mjs';
import { Script } from 'vm';

async function initializeBible() {
  const bible = new Bible();
  const bibleAPI = {
    getBooks: () => bible.getBooks(),
    getVersions: () => bible.getVersions(),
    getText: (version, book, verse) => bible.getText(version, book, verse),
    getBookInfo: (version, name) => bible.getBookInfo(version, name),
    getChapterInfo: (version, name, chapterNumber) => bible.getChapterInfo(version, name, chapterNumber),
    init: () => bible.init()
  };

  return bibleAPI;
}

async function executeWasmScript() {
  const wasmExecScript = await readFile(`${import.meta.dirname}/wasm_exec.js`, 'utf8');
  new Script(wasmExecScript).runInThisContext();
}

// Execute WASM script and initialize Bible in parallel
const [bibleAPI] = await Promise.all([
  executeWasmScript().then(() => initializeBible())
]);

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: ipcRenderer.send.bind(ipcRenderer),
    on: ipcRenderer.on.bind(ipcRenderer),
    once: ipcRenderer.once.bind(ipcRenderer),
    invoke: ipcRenderer.invoke.bind(ipcRenderer),
  },
  __dirname: import.meta.dirname,
  bibleAPI: bibleAPI,
  webUtils: webUtils
});

contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.send('minimize-window'),
  maximize: () => ipcRenderer.send('maximize-window'),
  onMaximizeChange: (callback) => ipcRenderer.on('maximize-change', callback)
});

Object.freeze(window.electron);
Object.freeze(window.windowControls);