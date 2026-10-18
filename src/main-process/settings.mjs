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

import { readFileSync, existsSync, mkdirSync, renameSync } from 'fs';

// Memory cache
const cache = {
    data: null,
    dirPath: null,
    filePath: null,
    isDirty: false,
    writeBlocked: false,
    loadError: null
};

function init(settingsDirPath) {
    cache.dirPath = settingsDirPath;
    cache.filePath = `${settingsDirPath}/settings.json`;
    cache.data = null;
    cache.isDirty = false;
    cache.writeBlocked = false;
    cache.loadError = null;
    loadSettings();
}

function getSettingsDirPath() {
    return cache.dirPath;
}

function getSettingsFilePath() {
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
        const parsed = JSON.parse(data);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            const invalid = new TypeError('Settings file must contain a JSON object');
            invalid.code = 'EMS_INVALID_SETTINGS';
            throw invalid;
        }
        cache.data = parsed;
        return cache.data;
    } catch (err) {
        const filePath = getSettingsFilePath();
        const isCorrupt = err instanceof SyntaxError || err?.code === 'EMS_INVALID_SETTINGS';
        if (isCorrupt) {
            const backupPath = `${filePath}.corrupt-${Date.now()}-${process.pid}`;
            try {
                renameSync(filePath, backupPath);
                console.error(`Settings file was corrupt and was preserved at ${backupPath}:`, err);
            } catch (backupError) {
                cache.writeBlocked = true;
                cache.loadError = backupError;
                console.error('Settings file was corrupt and could not be preserved; writes are disabled:', backupError);
            }
        } else if (err?.code !== 'ENOENT') {
            cache.writeBlocked = true;
            cache.loadError = err;
            console.error('Settings file could not be read; writes are disabled to preserve it:', err);
        }
        cache.data = {};
        return cache.data;
    }
}

async function saveSettings(data) {
    if (cache.writeBlocked) {
        const detail = cache.loadError?.message ? `: ${cache.loadError.message}` : '';
        throw new Error(`Settings writes are disabled because the existing file could not be read safely${detail}`);
    }
    const filePath = getSettingsFilePath();
    const dirPath = getSettingsDirPath();

    if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
    }

    const writeFileAtomic = await import('write-file-atomic');
    writeFileAtomic.default.sync(filePath, JSON.stringify(data));
    cache.isDirty = false;
}

// Core functions
function get(keyPath) {
    return getValueByPath(cache.data, keyPath);
}

function has(keyPath) {
    const value = getValueByPath(cache.data, keyPath);
    return value !== undefined;
}

async function set(keyPath, value) {
    if (arguments.length === 1) {
        cache.data = keyPath;
    } else {
        setValueByPath(cache.data, keyPath, value);
    }
    cache.isDirty = true;
}

function setSync(keyPath, value) {
    if (arguments.length === 1) {
        cache.data = keyPath;
    } else {
        setValueByPath(cache.data, keyPath, value);
    }
    cache.isDirty = true;
}

async function unset(keyPath) {
    if (!keyPath) {
        cache.data = {};
        cache.isDirty = true;
        return;
    }

    const parts = Array.isArray(keyPath) ? keyPath : keyPath.split('.');
    let current = cache.data;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!(parts[i] in current)) return;
        current = current[parts[i]];
    }
    delete current[parts[parts.length - 1]];
    cache.isDirty = true;
}

function unsetSync(keyPath) {
    if (!keyPath) {
        cache.data = {};
        cache.isDirty = true;
        return;
    }

    const parts = Array.isArray(keyPath) ? keyPath : keyPath.split('.');
    let current = cache.data;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!(parts[i] in current)) return;
        current = current[parts[i]];
    }
    delete current[parts[parts.length - 1]];
    cache.isDirty = true;
}

function file() {
    return getSettingsFilePath();
}

async function flush() {
    if (cache.isDirty) {
        await saveSettings(cache.data);
    }
}

const getSync = get;
const hasSync = has;

const settings = {
    init,
    get,
    getSync,
    set,
    setSync,
    has,
    hasSync,
    unset,
    unsetSync,
    file,
    flush
};

export default settings;
