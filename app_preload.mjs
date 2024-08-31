"use strict";
import { ipcRenderer } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { Bible } from './Bible.mjs';
import vm from 'vm';

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
  const wasmExecScript = await fs.readFile(path.join(__dirname, 'wasm_exec.js'), 'utf8');
  new vm.Script(wasmExecScript).runInThisContext();
}

(async () => {
  await executeWasmScript();
  const bibleAPI = await initializeBible();

  // Expose APIs directly to the global object
  globalThis.electron = {
    ipcRenderer: {
      send: (channel, data) => ipcRenderer.send(channel, data),
      on: (channel, callback) => ipcRenderer.on(channel, (event, ...args) => callback(event, ...args)),
      invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    },
    path: path,
    __dirname: __dirname,
    bibleAPI: bibleAPI
  };
})();