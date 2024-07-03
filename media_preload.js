const { contextBridge, ipcRenderer } = require('electron');

// Function to get high-resolution real time in milliseconds since process start
const getHrtimeMs = () => {
    const [seconds, nanoseconds] = process.hrtime();
    return (seconds * 1000) + (nanoseconds / 1000000);
};

// Function to initialize and fetch the reference time asynchronously
const initializeSynchronizedTime = async () => {
    const referenceTimeMs = await ipcRenderer.invoke('get-reference-time');
    const hrtimeMs = getHrtimeMs();
    const offsetMs = referenceTimeMs - hrtimeMs;

    contextBridge.exposeInMainWorld('electron', {
        ipcRenderer: {
            send: (channel, data) => ipcRenderer.send(channel, data),
            on: (channel, callback) => ipcRenderer.on(channel, (event, ...args) => callback(event, ...args)),
        },
        argv: process.argv,
        getSynchronizedTime: () => getHrtimeMs() + offsetMs,
    });
};

initializeSynchronizedTime();
