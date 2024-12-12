//This is a JS port of electron-settings it only works in the main process and only only reads the file once
/*MIT License

Copyright (c) 2020 Nathan Buchar <hello@nathanbuchar.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import { readFileSync, existsSync, mkdirSync } from 'fs';
import writeFileAtomic from 'write-file-atomic';
import { app } from 'electron';

// Memory cache
const cache = {
    data: null,
    dirPath: null,
    filePath: null,
};

function getSettingsDirPath() {
    if (cache.dirPath) {
        return cache.dirPath;
    }
    cache.dirPath = app.getPath('userData');
    return cache.dirPath;
}

function getSettingsFilePath() {
    if (cache.filePath) {
        return cache.filePath;
    }
    cache.filePath = getSettingsDirPath() +'/'+ 'settings.json';
    return cache.filePath;
}

// Optimized get value from object using path
function getValueByPath(obj, path) {
    if (!path) return obj;
    const parts = Array.isArray(path) ? path : path.split('.');
    let result = obj;
    for (const part of parts) {
        if (result === null || result === undefined) return undefined;
        // Handle array index notation
        if (part.includes('[') && part.includes(']')) {
            const [key, index] = part.split('[');
            result = result[key]?.[parseInt(index)];
        } else {
            result = result[part];
        }
    }
    return result;
}

// Optimized set value in object using path
function setValueByPath(obj, path, value) {
    const parts = Array.isArray(path) ? path : path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!(part in current)) {
            current[part] = {};
        }
        current = current[part];
    }
    current[parts[parts.length - 1]] = value;
    return obj;
}

// Load settings from disk
function loadSettings() {
    if (cache.data) {
        return cache.data;
    }

    try {
        const filePath = getSettingsFilePath();
        if (!existsSync(filePath)) {
            cache.data = {};
            return cache.data;
        }

        const data = readFileSync(filePath, 'utf-8');
        cache.data = JSON.parse(data);
        return cache.data;
    } catch (err) {
        cache.data = {};
        return cache.data;
    }
}

function saveSettings(data) {
    const filePath = getSettingsFilePath();
    const dirPath = getSettingsDirPath();

    if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
    }

    writeFileAtomic.sync(filePath, JSON.stringify(data));
    cache.data = data;
}

// Core functions
function get(keyPath) {
    const settings = loadSettings();
    return getValueByPath(settings, keyPath);
}

function has(keyPath) {
    const settings = loadSettings();
    const value = getValueByPath(settings, keyPath);
    return value !== undefined;
}

async function set(keyPath, value) {
    if (arguments.length === 1) {
        saveSettings(keyPath);
        return;
    }

    const settings = loadSettings();
    setValueByPath(settings, keyPath, value);
    saveSettings(settings);
}

function setSync(keyPath, value) {
    if (arguments.length === 1) {
        saveSettings(keyPath);
        return;
    }

    const settings = loadSettings();
    setValueByPath(settings, keyPath, value);
    saveSettings(settings);
}

async function unset(keyPath) {
    if (!keyPath) {
        saveSettings({});
        return;
    }

    const settings = loadSettings();
    const parts = Array.isArray(keyPath) ? keyPath : keyPath.split('.');
    let current = settings;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!(parts[i] in current)) return;
        current = current[parts[i]];
    }
    delete current[parts[parts.length - 1]];
    saveSettings(settings);
}

function unsetSync(keyPath) {
    if (!keyPath) {
        saveSettings({});
        return;
    }

    const settings = loadSettings();
    const parts = Array.isArray(keyPath) ? keyPath : keyPath.split('.');
    let current = settings;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!(parts[i] in current)) return;
        current = current[parts[i]];
    }
    delete current[parts[parts.length - 1]];
    saveSettings(settings);
}

function file() {
    return getSettingsFilePath();
}

// getSync is just an alias for get since get is already sync
const getSync = get;
const hasSync = has;

export {
    get,
    getSync,
    set,
    setSync,
    has,
    hasSync,
    unset,
    unsetSync,
    file
};

export default {
    get,
    getSync,
    set,
    setSync,
    has,
    hasSync,
    unset,
    unsetSync,
    file
};