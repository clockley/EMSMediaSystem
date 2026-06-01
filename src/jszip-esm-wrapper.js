/*
Copyright (C) 2019-2024 Christian Lockley

JSZip-compat wrapper backed by fflate for renderer use.
@aiden0z/pptx-renderer imports "jszip" as a bare specifier; Electron resolves
that through import maps to this file.
*/

import { unzip, strFromU8 } from "../node_modules/fflate/esm/browser.js";

function toUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new Error("Unsupported ZIP input type");
}

class JsZipCompatEntry {
  constructor(name, bytes) {
    this.name = name;
    this.dir = false;
    this._bytes = bytes;
    this._data = { uncompressedSize: bytes.byteLength };
  }

  async(type) {
    if (type === "uint8array") {
      return this._bytes;
    }
    if (type === "string") {
      return strFromU8(this._bytes);
    }
    throw new Error(`Unsupported async() output type: ${type}`);
  }
}

const JSZipCompat = {};

// Return object with JSZip-like shape expected by pptx-renderer.
JSZipCompat.loadAsync = async (input) => {
  const filesMap = await new Promise((resolve, reject) => {
    unzip(toUint8Array(input), (err, files) => {
      if (err) reject(err);
      else resolve(files);
    });
  });
  const entries = {};
  for (const [name, bytes] of Object.entries(filesMap)) {
    entries[name] = new JsZipCompatEntry(name, bytes);
  }
  return { files: entries };
};

export default JSZipCompat;
