/**
 * Preload script for slide editor dialog.
 * Exposes safe IPC access for slide creation.
 */

import { ipcRenderer, contextBridge } from "electron";

contextBridge.exposeInMainWorld("electron", {
  ipcRenderer: {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  },
});
