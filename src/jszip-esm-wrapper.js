/*
Copyright (C) 2019-2024 Christian Lockley

ESM wrapper for JSZip UMD. @aiden0z/pptx-renderer imports "jszip" as a bare
specifier; Electron's renderer resolves it via an import map pointing here.
*/

const jszipUrl = new URL(
  "../node_modules/jszip/dist/jszip.min.js",
  import.meta.url,
).href;

function loadJSZip() {
  const xhr = new XMLHttpRequest();
  xhr.open("GET", jszipUrl, false);
  xhr.send(null);
  if (xhr.status !== 0 && (xhr.status < 200 || xhr.status >= 300)) {
    throw new Error(
      `Failed to load JSZip from ${jszipUrl} (HTTP ${xhr.status})`,
    );
  }
  const mod = { exports: {} };
  // JSZip UMD assigns to module.exports when present.
  // eslint-disable-next-line no-new-func
  new Function("module", "exports", xhr.responseText)(mod, mod.exports);
  return mod.exports.default || mod.exports;
}

export default loadJSZip();
