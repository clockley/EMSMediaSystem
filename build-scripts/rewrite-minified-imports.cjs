#!/usr/bin/env node
const fs = require("node:fs");

const filePath = process.argv[2];
if (!filePath) throw new Error("Expected a minified module path");

const source = fs.readFileSync(filePath, "utf8");
const rewritten = source.replace(
  /((?:from\s*|import\s*\()\s*["'])(\.{1,2}\/[^"']+?)(\.m?js)(["'])/g,
  (match, prefix, modulePath, extension, quote) => {
    // Dependencies are shipped under their published filenames. Rewriting a
    // node_modules import (for example pptx-renderer's browser bundle) points
    // at a .min.js file that may not exist and breaks the dynamic import.
    if (modulePath.endsWith(".min") || modulePath.split(/[\\/]/).includes("node_modules")) {
      return match;
    }
    return `${prefix}${modulePath}.min${extension}${quote}`;
  },
);
fs.writeFileSync(filePath, rewritten);
