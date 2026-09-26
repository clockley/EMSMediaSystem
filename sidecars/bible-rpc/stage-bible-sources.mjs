#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const edition = process.argv[2] || "public";
const derivedRoot = path.resolve(repoRoot, process.argv[3] || "derived");
const privateBibleRoot = path.resolve(repoRoot, process.env.BIBLE_PRIVATE_ROOT || "private-bibles");
const outputDir = path.join(derivedRoot, "bible");
const outputSourcesDir = path.join(outputDir, "sources");

if (!new Set(["public", "paid"]).has(edition)) throw new Error(`Unsupported Bible edition: ${edition}`);

function readJSON(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new Error(`Failed to parse ${label}: ${err.message}`);
  }
}

function requiredText(record, key, label) {
  const value = String(record?.[key] || "").trim();
  if (!value) throw new Error(`${label} is missing ${key}`);
  return value;
}

function optionalText(record, key) {
  return String(record?.[key] || "").trim();
}

function textSaysPublicDomain(value) {
  return String(value || "").toLowerCase().includes("public domain");
}

function privateIDFor(abbreviation) {
  const slug = abbreviation.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `private:${slug || abbreviation.toLowerCase()}`;
}

function safeRelativeContentPath(directory, jsonFile, label) {
  const contentPath = path.resolve(directory, jsonFile);
  const relative = path.relative(directory, contentPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} has unsafe jsonFile: ${jsonFile}`);
  }
  return contentPath;
}

function generatedManifestName(contentFile, abbreviation) {
  if (contentFile.toLowerCase().endsWith(".json")) {
    return `${contentFile.slice(0, -5)}.manifest.json`;
  }
  return `${abbreviation}.manifest.json`;
}

function sourcesIn(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith(".manifest.json")).sort().map((name) => {
    const filePath = path.join(directory, name);
    const manifest = readJSON(filePath, "Bible manifest");
    if (manifest.format !== "ems.bible-manifest.v1") throw new Error(`Invalid Bible manifest format: ${filePath}`);
    for (const field of ["id", "abbreviation", "name", "language", "revision", "contentFile"]) {
      if (typeof manifest[field] !== "string" || !manifest[field].trim()) throw new Error(`${filePath} is missing ${field}`);
    }
    if (path.basename(manifest.contentFile) !== manifest.contentFile) throw new Error(`${filePath} contentFile must be a basename`);
    const contentPath = path.join(directory, manifest.contentFile);
    if (!existsSync(contentPath)) throw new Error(`Bible content is missing: ${contentPath}`);
    return { manifest, filePath, contentPath, manifestName: name };
  });
}

function legacyPaidSourcesIn(directory) {
  const metadataPath = path.join(directory, "bible-imports.json");
  if (!existsSync(metadataPath)) return [];

  const metadata = readJSON(metadataPath, "paid Bible import metadata");
  const translations = Array.isArray(metadata) ? metadata : metadata?.translations;
  if (!Array.isArray(translations)) throw new Error(`${metadataPath} must include a translations array`);

  return translations.map((translation, index) => {
    const label = `paid Bible import #${index + 1}`;
    const abbreviation = requiredText(translation, "abbreviation", label).toUpperCase();
    const jsonFile = requiredText(translation, "jsonFile", `${label} (${abbreviation})`);
    const name =
      optionalText(translation, "name") ||
      optionalText(translation, "version") ||
      optionalText(translation, "infoText");
    if (!name) throw new Error(`${label} (${abbreviation}) is missing version`);

    const contentPath = safeRelativeContentPath(directory, jsonFile, `${label} (${abbreviation})`);
    if (!existsSync(contentPath)) throw new Error(`Bible content is missing: ${contentPath}`);

    const contentFile = path.basename(contentPath);
    const copyright = requiredText(translation, "copyright", `${label} (${abbreviation})`);
    const copyrightInfo = requiredText(translation, "copyrightInfo", `${label} (${abbreviation})`);
    const publisher = optionalText(translation, "publisher");
    const publicDomain = textSaysPublicDomain(copyright) || textSaysPublicDomain(copyrightInfo);
    if (!publicDomain && !publisher) {
      throw new Error(`${label} (${abbreviation}) is missing publisher`);
    }

    const manifest = {
      format: "ems.bible-manifest.v1",
      id: optionalText(translation, "id") || privateIDFor(abbreviation),
      abbreviation,
      name,
      language: optionalText(translation, "language") || "english",
      revision: optionalText(translation, "revision") || "1",
      contentFile,
      publicDomain,
      publisher,
      copyright,
      copyrightInfo,
      infoUrl: optionalText(translation, "infoUrl"),
    };
    return {
      manifest,
      manifestName: generatedManifestName(contentFile, abbreviation),
      contentPath,
    };
  }).sort((left, right) => left.manifestName.localeCompare(right.manifestName));
}

function privateSourcesIn(directory) {
  const manifestSources = sourcesIn(directory);
  const seenIDs = new Set(manifestSources.map((source) => source.manifest.id));
  const seenAbbreviations = new Set(manifestSources.map((source) => source.manifest.abbreviation.toUpperCase()));
  const legacySources = legacyPaidSourcesIn(directory).filter((source) => {
    const abbreviation = source.manifest.abbreviation.toUpperCase();
    if (seenIDs.has(source.manifest.id) || seenAbbreviations.has(abbreviation)) return false;
    seenIDs.add(source.manifest.id);
    seenAbbreviations.add(abbreviation);
    return true;
  });
  return [...manifestSources, ...legacySources];
}

const sources = sourcesIn(path.join(repoRoot, "public-bibles"));
if (edition === "paid") sources.push(...privateSourcesIn(privateBibleRoot));
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
const stagedNames = new Set();
function claimStagedName(name, label) {
  if (stagedNames.has(name)) throw new Error(`Duplicate staged Bible ${label}: ${name}`);
  stagedNames.add(name);
}

for (const source of sources) {
  const manifestName = source.manifestName;
  claimStagedName(manifestName, "manifest");
  claimStagedName(source.manifest.contentFile, "content file");
  if (source.filePath) {
    copyFileSync(source.filePath, path.join(outputSourcesDir, manifestName));
  } else {
    writeFileSync(path.join(outputSourcesDir, manifestName), `${JSON.stringify(source.manifest, null, 2)}\n`);
  }
  copyFileSync(source.contentPath, path.join(outputSourcesDir, source.manifest.contentFile));
  listedSources.push(`sources/${manifestName}`);
}
writeFileSync(path.join(outputDir, "bundle.manifest.json"), `${JSON.stringify({
  format: "ems.bible-bundle.v1", edition, sources: listedSources,
}, null, 2)}\n`);
console.log(`Staged ${sources.length} Bible sources for the ${edition} edition.`);
