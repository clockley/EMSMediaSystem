import { contextBridge, ipcRenderer } from 'electron/renderer';

contextBridge.exposeInMainWorld('windowControls', {
    minimize: () => ipcRenderer.send('minimize-window'),
    maximize: () => ipcRenderer.send('maximize-window'),
    onMaximizeChange: (callback) => ipcRenderer.on('maximize-change', callback),
    getSessionID: () => ipcRenderer.invoke('get-session-id'),
});

Object.freeze(window.windowControls);