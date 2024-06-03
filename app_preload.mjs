import { contextBridge, ipcRenderer } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        send: (channel, data) => ipcRenderer.send(channel, data),
        on: (channel, callback) => ipcRenderer.on(channel, (event, ...args) => callback(event, ...args)),
        invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
        sendSync: (channel, ...args) => ipcRenderer.sendSync(channel, ...args)
    },
    path: path,
    fs: {
        readdirSync: (dirPath) => fs.readdirSync(dirPath),
        readFileSync: (filePath, encoding) => fs.readFileSync(filePath, encoding),
        writeFileSync: (filePath, data) => fs.writeFileSync(filePath, data)
    },
    __dirname: __dirname
});
