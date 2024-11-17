const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('bigPlayer');

    contextBridge.exposeInMainWorld('api', {
        video
    });
});

contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        send: ipcRenderer.send.bind(ipcRenderer),
        on: ipcRenderer.on.bind(ipcRenderer),
    },
    argv: process.argv,
});
