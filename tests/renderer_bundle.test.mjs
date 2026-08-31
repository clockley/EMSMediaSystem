import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as esbuild from "esbuild";

test("renderer entry stays a thin static import of the composition module", async () => {
  const source = await readFile(new URL("../src/control-window/app.js", import.meta.url), "utf8");
  const lines = source.split(/\r?\n/).length;
  assert.ok(lines <= 30, `src/control-window/app.js should remain a bootstrap entry, found ${lines} lines`);
  assert.match(source, /import\s+["']\.\/app-renderer\.mjs["']/);
  assert.doesNotMatch(source, /\bimport\s*\(/);
});

test("renderer bundle is one IIFE with no lazy chunks", async () => {
  const result = await esbuild.build({
    absWorkingDir: new URL("..", import.meta.url).pathname,
    entryPoints: ["src/control-window/app.js"],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  const outputs = Object.keys(result.metafile.outputs);
  assert.equal(outputs.length, 1, `expected one bundle output, got ${outputs.join(", ")}`);
  const output = result.metafile.outputs[outputs[0]];
  assert.equal(output.imports?.length || 0, 0);
  assert.ok(result.outputFiles[0].text.length > 0);
});

test("feature modules do not import each other", async () => {
  const files = [
    "app-bible-workspace.mjs",
    "app-song-slides-workspace.mjs",
    "app-confidence-monitor.mjs",
    "app-network-preview.mjs",
    "app-preview-controller.mjs",
    "app-project-session.mjs",
    "app-schedule-controller.mjs",
    "app-presentation-playback.mjs",
    "app-live-outputs.mjs",
    "app-logo-hold.mjs",
    "app-media-loop.mjs",
    "app-preview-surfaces.mjs",
    "app-operator-chrome.mjs",
    "app-media-runtime.mjs",
    "app-workspace-shell.mjs",
  ];
  const sources = await Promise.all(
    files.map((name) => readFile(new URL(`../src/control-window/${name}`, import.meta.url), "utf8")),
  );
  for (let i = 0; i < files.length; i += 1) {
    for (const other of files.filter((_, j) => j !== i)) {
      assert.doesNotMatch(
        sources[i],
        new RegExp(`from\\s+["']\\./${other.replace(".", "\\.")}["']`),
        `${files[i]} must not import ${other}`,
      );
    }
  }
});

function importedNames(source) {
  const names = new Set();
  for (const block of source.matchAll(/import\s+\{([\s\S]*?)\}\s+from\s+["'][^"']+["']/g)) {
    for (const part of block[1].split(",")) {
      const ident = part.trim();
      if (!ident) continue;
      const [imported, alias] = ident.split(/\s+as\s+/);
      names.add(imported.trim());
      if (alias) names.add(alias.trim());
    }
  }
  return names;
}

function localDeclarationNames(source) {
  return new Set(
    [...source.matchAll(/^(?:export\s+)?(?:async function|function|let|const|var|class) (\w+)/gm)].map(
      (match) => match[1],
    ),
  );
}

function collectIdentifiers(src) {
  const names = new Set();
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      if (i < 0) break;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i + 2);
      if (i < 0) break;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      i += 1;
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === "`") {
      i += 1;
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          i += 2;
          let depth = 1;
          const start = i;
          while (i < src.length && depth > 0) {
            if (src[i] === "{") depth += 1;
            else if (src[i] === "}") depth -= 1;
            i += 1;
          }
          for (const name of collectIdentifiers(src.slice(start, i - 1))) names.add(name);
          continue;
        }
        if (src[i] === "`") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[\w$]/.test(src[j])) j += 1;
      let k = i - 1;
      while (k >= 0 && /[ \t]/.test(src[k])) k -= 1;
      let keyBefore = k;
      while (keyBefore >= 0 && /\s/.test(src[keyBefore])) keyBefore -= 1;
      let keyAfter = j;
      while (keyAfter < src.length && /\s/.test(src[keyAfter])) keyAfter += 1;
      const objectKey =
        keyBefore >= 0 &&
        (src[keyBefore] === "{" || src[keyBefore] === ",") &&
        src[keyAfter] === ":";
      if (!objectKey && (k < 0 || src[k] !== ".")) names.add(src.slice(i, j));
      i = j;
      continue;
    }
    i += 1;
  }
  return names;
}

const FEATURE_MODULE_FILES = [
  "app-bible-workspace.mjs",
  "app-song-slides-workspace.mjs",
  "app-confidence-monitor.mjs",
  "app-network-preview.mjs",
  "app-preview-controller.mjs",
  "app-project-session.mjs",
  "app-schedule-controller.mjs",
  "app-presentation-playback.mjs",
  "app-live-outputs.mjs",
  "app-logo-hold.mjs",
  "app-media-loop.mjs",
  "app-preview-surfaces.mjs",
  "app-operator-chrome.mjs",
  "app-media-runtime.mjs",
  "app-workspace-shell.mjs",
];

test("feature modules import renderer bindings they use", async () => {
  const renderer = await readFile(new URL("../src/control-window/app-renderer.mjs", import.meta.url), "utf8");
  const rendererNames = new Set([
    ...[...renderer.matchAll(/^(?:async function|function|let|const|var) (\w+)/gm)].map((match) => match[1]),
    ...[...renderer.matchAll(/^\s+([A-Z][A-Z0-9_]{2,})\s*=/gm)].map((match) => match[1]),
  ]);
  for (const block of renderer.matchAll(/^import\s+\{([\s\S]*?)\}\s+from\s+["'][^"']+["']/gm)) {
    for (const part of block[1].split(",")) {
      for (const name of part.trim().split(/\s+as\s+/).map((piece) => piece.trim()).filter(Boolean)) {
        rendererNames.add(name);
      }
    }
  }
  for (const file of FEATURE_MODULE_FILES) {
    const source = await readFile(new URL(`../src/control-window/${file}`, import.meta.url), "utf8");
    const imported = importedNames(source);
    const local = localDeclarationNames(source);
    const used = collectIdentifiers(source);
    const missing = [...used].filter((name) => {
      if (!rendererNames.has(name) || imported.has(name) || local.has(name)) return false;
      if (name.length <= 2) return false;
      return true;
    }).sort();
    assert.deepEqual(missing, [], `${file} uses renderer bindings without importing them`);
  }
});
