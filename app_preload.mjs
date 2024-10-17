"use strict";
import { contextBridge, ipcRenderer, webUtils } from 'electron';
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
