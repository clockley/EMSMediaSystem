export class Bible {
    constructor() {
        this.initialized = false;
    }

    async init() {
        const go = new Go();
        const result = await WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject);
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
