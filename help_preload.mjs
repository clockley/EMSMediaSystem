import { contextBridge, ipcRenderer } from 'electron/renderer';

contextBridge.exposeInMainWorld('windowControls', {
    minimize: () => ipcRenderer.send('minimize-window'),
    maximize: () => ipcRenderer.send('maximize-window'),
    onMaximizeChange: (callback) => ipcRenderer.on('maximize-change', callback)
});

Object.freeze(window.windowControls);