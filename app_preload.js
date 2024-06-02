const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');


contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        send: (channel, data) => ipcRenderer.send(channel, data),
        on: (channel, callback) => ipcRenderer.on(channel, (event, ...args) => callback(event, ...args)),
        once: (channel, callback) => ipcRenderer.once(channel, (event, ...args) => callback(event, ...args)),
        invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
        sendSync: (channel, ...args) => ipcRenderer.sendSync(channel, ...args)
    },
    argv: process.argv,
    path: path,
    fs: {
        readdirSync: (dirPath) => fs.readdirSync(dirPath),
        readFileSync: (filePath, encoding) => fs.readFileSync(filePath, encoding),
        writeFileSync: (filePath, data) => fs.writeFileSync(filePath, data)
    },
    process: {
        platform: process.platform,
        versions: process.versions
    },
    __filename: __filename,
    __dirname: __dirname
});
