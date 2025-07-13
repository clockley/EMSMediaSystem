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

import fs from 'fs/promises';
import path from 'path';

export class Bible {
    constructor() {
        this.initialized = false;
    }

    async init() {
        const go = new Go();
        const result = await WebAssembly.instantiate(await fs.readFile(path.join(__dirname, 'main.wasm')), go.importObject);
        go.run(result.instance);
        this.initialized = true;
        await this.ensureInitialized();
    }

    async ensureInitialized() {
        if (!this.initialized) {
            await this.initPromise;
        }
    }

    getBooks() {
        return JSON.parse(_getBooks());
    }

    getVersions() {
        return JSON.parse(_getVersions());
    }

    getText(version, book, verse) {
        return JSON.parse(_getText(version, book, verse));
    }

    getBookInfo(version, name) {
        return JSON.parse(_getBookInfo(version, name));
    }

    getChapterInfo(version, name, verse) {
        return JSON.parse(_getChapterInfo(version, name, verse));
    }
}
