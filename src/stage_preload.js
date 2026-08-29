const { contextBridge, ipcRenderer } = require("electron/renderer");

contextBridge.exposeInMainWorld("stageOutput", Object.freeze({
  sessionId: process.argv.find((arg) => arg.startsWith("__stage-session="))?.split("=")[1] || "",
  onCommand(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("stage-output-command", listener);
    return () => ipcRenderer.removeListener("stage-output-command", listener);
  },
  acknowledge(acknowledgement) {
    ipcRenderer.send("stage-output-ack", acknowledgement);
  },
  ready() {
    ipcRenderer.send("stage-output-ready");
  },
}));
