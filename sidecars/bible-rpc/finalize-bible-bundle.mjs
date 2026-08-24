#!/usr/bin/env node

import { readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";

const bibleDir = path.resolve(process.argv[2] || "derived/bible");
const bundlePath = path.join(bibleDir, "bundle.manifest.json");
const staged = JSON.parse(readFileSync(bundlePath, "utf8"));
const sources = staged.sources.map((relativeManifest) => {
  const manifest = JSON.parse(readFileSync(path.join(bibleDir, relativeManifest), "utf8"));
  return {
    id: manifest.id,
    abbreviation: manifest.abbreviation,
    name: manifest.name,
    language: manifest.language,
    revision: manifest.revision,
  };
});
writeFileSync(bundlePath, `${JSON.stringify({
  format: "ems.bible-bundle.v1",
  edition: staged.edition,
  sources,
}, null, 2)}\n`);
rmSync(path.join(bibleDir, "sources"), { recursive: true, force: true });
rmSync(path.join(bibleDir, "bible-runtime.fingerprint"), { force: true });
const now = new Date();
utimesSync(path.join(bibleDir, "bible-runtime.sqlite"), now, now);
console.log(`Finalized ${staged.edition} Bible bundle without source JSON.`);
