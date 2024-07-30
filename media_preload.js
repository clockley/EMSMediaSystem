const { contextBridge, ipcRenderer } = require('electron');
window.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('bigPlayer');

    contextBridge.exposeInMainWorld('api', {
        video
    });
});
contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        send: (channel, data) => ipcRenderer.send(channel, data),
        on: (channel, callback) => ipcRenderer.on(channel, (event, ...args) => callback(event, ...args)),
    },
    argv: process.argv,
});