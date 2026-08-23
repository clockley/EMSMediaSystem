import { contextBridge, ipcRenderer } from "electron/renderer";

contextBridge.exposeInMainWorld("themeManager", Object.freeze({
  list: () => ipcRenderer.invoke("themes:list"),
  save: theme => ipcRenderer.invoke("themes:save", theme),
  activate: id => ipcRenderer.invoke("themes:apply", id),
  duplicate: id => ipcRenderer.invoke("themes:duplicate", id),
  delete: id => ipcRenderer.invoke("themes:delete", id),
  importPack: () => ipcRenderer.invoke("themes:import"),
  exportPack: id => ipcRenderer.invoke("themes:export", id),
  onOpenContext: callback => {
    const listener = (_event, context) => callback(context);
    ipcRenderer.on("theme-manager-open-context", listener);
    return () => ipcRenderer.removeListener("theme-manager-open-context", listener);
  },
  close: () => ipcRenderer.send("theme-manager-close"),
}));
