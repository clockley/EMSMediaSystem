const { contextBridge, ipcRenderer } = require("electron/renderer");

contextBridge.exposeInMainWorld("stageOutput", Object.freeze({
  sessionId: process.argv.find((arg) => arg.startsWith("__stage-session="))?.split("=")[1] || "",
  onCommand(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("stage-output-command", listener);
    return () => ipcRenderer.removeListener("stage-output-command", listener);
  },
  getAudienceSource() {
    return ipcRenderer.invoke("stage-audience-source");
  },
  onAudienceSource(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("stage-audience-source", listener);
    return () => ipcRenderer.removeListener("stage-audience-source", listener);
  },
  onAudiencePeerSignal(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("stage-audience-peer", listener);
    return () => ipcRenderer.removeListener("stage-audience-peer", listener);
  },
  sendAudiencePeerSignal(message) {
    ipcRenderer.send("stage-audience-peer", message);
  },
  getLocalMedia() {
    return ipcRenderer.invoke("stage-local-media");
  },
  onLocalMedia(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("stage-local-media", listener);
    return () => ipcRenderer.removeListener("stage-local-media", listener);
  },
  onLocalPlayback(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("stage-local-playback", listener);
    return () => ipcRenderer.removeListener("stage-local-playback", listener);
  },
  getNextPptx(deckKey) {
    return ipcRenderer.invoke("stage-next-pptx", deckKey);
  },
  acknowledge(acknowledgement) {
    ipcRenderer.send("stage-output-ack", acknowledgement);
  },
  ready() {
    ipcRenderer.send("stage-output-ready");
  },
}));
