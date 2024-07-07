export class Bible {
    constructor() {
          const go = new Go();
        WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject).then((result) => {
            go.run(result.instance);
        });
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
