const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        send: (channel, data) => ipcRenderer.send(channel, data),
        on: (channel, callback) => ipcRenderer.on(channel, (event, ...args) => callback(event, ...args)),
        once: (channel, callback) => ipcRenderer.once(channel, (event, ...args) => callback(event, ...args)),
        invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
        sendSync: (channel, ...args) => ipcRenderer.sendSync(channel, ...args)
    },
    argv: process.argv,
    process: {
        platform: process.platform,
        versions: process.versions
    }
});
