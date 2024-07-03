import { contextBridge, ipcRenderer } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to get high-resolution real time in milliseconds since process start
const getHrtimeMs = () => {
    const [seconds, nanoseconds] = process.hrtime();
    return (seconds * 1000) + (nanoseconds / 1000000);
};

// Fetch the common reference time from the main process
const referenceTimeMs = await ipcRenderer.invoke('get-reference-time');

// Calculate the offset between system time and high-resolution time
const hrtimeMs = getHrtimeMs();
const offsetMs = referenceTimeMs - hrtimeMs;

contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        send: (channel, data) => ipcRenderer.send(channel, data),
        on: (channel, callback) => ipcRenderer.on(channel, (event, ...args) => callback(event, ...args)),
        invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    },
    path: path,
    __dirname: __dirname,
    getSynchronizedTime: () => getHrtimeMs() + offsetMs
});
