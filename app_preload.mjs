import { contextBridge, ipcRenderer } from 'electron';
import path from 'path';
import fs from 'fs';
import { Bible } from './Bible.mjs';
import vm from 'vm';

const dirname = ipcRenderer.invoke('get-app-path');

const wasmExecPath = path.join(__dirname, 'wasm_exec.js');
const wasmExecScript = fs.readFileSync(wasmExecPath, 'utf8');
vm.runInThisContext(wasmExecScript);
const bible = new Bible();
const bibleAPI = {
    getBooks: () => bible.getBooks(),
    getVersions: () => bible.getVersions(),
    getText: (version, book, verse) => bible.getText(version, book, verse),
    getBookInfo: (version, name) => bible.getBookInfo(version, name),
    getChapterInfo: (version, name, chapterNumber) => bible.getChapterInfo(version, name, chapterNumber),
    init: () => bible.init()
};

contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        send: (channel, data) => ipcRenderer.send(channel, data),
        on: (channel, callback) => ipcRenderer.on(channel, (event, ...args) => callback(event, ...args)),
        invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    },
    path: path,
    __dirname: await dirname,
    bibleAPI: bibleAPI
});
