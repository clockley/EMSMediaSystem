// Bible.js
export class Bible {
    constructor() {
        // Load the Go runtime
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
}
