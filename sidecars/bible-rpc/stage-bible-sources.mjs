#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const edition = process.argv[2] || "public";
const derivedRoot = path.resolve(repoRoot, process.argv[3] || "derived");
const outputDir = path.join(derivedRoot, "bible");
const outputSourcesDir = path.join(outputDir, "sources");

if (!new Set(["public", "paid"]).has(edition)) throw new Error(`Unsupported Bible edition: ${edition}`);

function sourcesIn(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith(".manifest.json")).sort().map((name) => {
    const filePath = path.join(directory, name);
    const manifest = JSON.parse(readFileSync(filePath, "utf8"));
    if (manifest.format !== "ems.bible-manifest.v1") throw new Error(`Invalid Bible manifest format: ${filePath}`);
    for (const field of ["id", "abbreviation", "name", "language", "revision", "contentFile"]) {
      if (typeof manifest[field] !== "string" || !manifest[field].trim()) throw new Error(`${filePath} is missing ${field}`);
    }
    if (path.basename(manifest.contentFile) !== manifest.contentFile) throw new Error(`${filePath} contentFile must be a basename`);
    const contentPath = path.join(directory, manifest.contentFile);
    if (!existsSync(contentPath)) throw new Error(`Bible content is missing: ${contentPath}`);
    return { manifest, filePath, contentPath };
  });
}

const sources = sourcesIn(path.join(repoRoot, "public-bibles"));
if (edition === "paid") sources.push(...sourcesIn(path.join(repoRoot, "private-bibles")));
const ids = new Set();
const abbreviations = new Set();
for (const source of sources) {
  const abbreviation = source.manifest.abbreviation.toUpperCase();
  if (ids.has(source.manifest.id)) throw new Error(`Duplicate Bible id: ${source.manifest.id}`);
  if (abbreviations.has(abbreviation)) throw new Error(`Duplicate Bible abbreviation: ${abbreviation}`);
  if (edition === "public" && source.manifest.id.startsWith("private:")) throw new Error(`Private Bible in public edition: ${source.manifest.id}`);
  ids.add(source.manifest.id);
  abbreviations.add(abbreviation);
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputSourcesDir, { recursive: true });
const listedSources = [];
for (const source of sources) {
  const manifestName = path.basename(source.filePath);
  copyFileSync(source.filePath, path.join(outputSourcesDir, manifestName));
  copyFileSync(source.contentPath, path.join(outputSourcesDir, source.manifest.contentFile));
  listedSources.push(`sources/${manifestName}`);
}
writeFileSync(path.join(outputDir, "bundle.manifest.json"), `${JSON.stringify({
  format: "ems.bible-bundle.v1", edition, sources: listedSources,
}, null, 2)}\n`);
console.log(`Staged ${sources.length} Bible sources for the ${edition} edition.`);
