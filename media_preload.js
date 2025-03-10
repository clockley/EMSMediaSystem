/*
Copyright (C) 2019-2024 Christian Lockley
This library is free software; you can redistribute it and/or modify it
under the terms of the GNU General Public License as published by
the Free Software Foundation; either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
Lesser General Public License for more details.

You should have received a copy of the GNU General Public License
along with this library. If not, see <https://www.gnu.org/licenses/>.
*/


const { contextBridge, ipcRenderer } = require('electron/renderer');

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
        invoke: ipcRenderer.invoke.bind(ipcRenderer)
    },
    argv: process.argv,
    birth: process.argv[process.argv.length-1]
});
