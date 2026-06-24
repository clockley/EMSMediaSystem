#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");

const edition = process.argv[2] || "public";
const derivedRoot = path.resolve(repoRoot, process.argv[3] || "derived");
const privateBibleRoot = path.resolve(
  repoRoot,
  process.env.BIBLE_PRIVATE_ROOT || "private-bibles",
);

const sourceDbPath = path.join(scriptDir, "bible-sqlite.db");
const bibleImporterPath = path.join(scriptDir, "import-bibles.mjs");
const paidBibleMetadataPath = path.join(privateBibleRoot, "bible-imports.json");
const buildRoot = path.join(repoRoot, "build-artifacts", `bible-assets-${edition}`);
const buildDbPath = path.join(buildRoot, "bible-sqlite.db");
const outputDbDir = path.join(derivedRoot, "bible");
const outputDbPath = path.join(outputDbDir, "bible-sqlite.db");

function fail(message) {
  console.error(`build-bible-assets: ${message}`);
  process.exit(1);
}

function assertFile(filePath, label) {
  if (!existsSync(filePath)) {
    fail(`${label} not found: ${filePath}`);
  }
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    fail(`failed to parse ${label}: ${err.message}`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    fail(`${command} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${command} exited with status ${result.status}`);
  }
}

function querySqlite(dbPath, sql) {
  try {
    return execFileSync("sqlite3", [dbPath, sql], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 32,
    });
  } catch (err) {
    fail(`sqlite query failed: ${err.stderr?.toString() || err.message}`);
  }
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function mustQuoteSqlIdentifier(identifier) {
  const value = String(identifier || "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    fail(`unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function runSqlite(dbPath, sql) {
  const result = spawnSync("sqlite3", [dbPath], {
    input: sql,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 32,
  });

  if (result.error) {
    fail(`failed to run sqlite3: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(result.stderr || `sqlite3 exited with status ${result.status}`);
  }
}

const PUBLIC_DOMAIN_ATTRIBUTIONS = {
  ASV: "American Standard Version (ASV, 1901). Public Domain.",
  BBE: "Bible in Basic English (BBE). Public Domain.",
  KJV: "King James Version (KJV). Public Domain.",
  WEB: "World English Bible (WEB). Public Domain.",
  YLT: "Young's Literal Translation (YLT). Public Domain.",
};

function goVersionIsSupported(output) {
  const match = String(output || "").match(/go(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 22);
}

function resolveGoBinary() {
  if (process.env.GO) return process.env.GO;

  for (const candidate of ["/usr/local/go/bin/go", "go"]) {
    const result = spawnSync(candidate, ["version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status === 0 && goVersionIsSupported(result.stdout)) return candidate;
  }

  fail("Go 1.22+ toolchain not found");
}

function prepareBuildDb() {
  rmSync(buildRoot, { recursive: true, force: true });
  mkdirSync(buildRoot, { recursive: true });
  copyFileSync(sourceDbPath, buildDbPath);
}

function paidBibleTranslations() {
  if (edition !== "paid" && !existsSync(paidBibleMetadataPath)) {
    return [];
  }
  assertFile(paidBibleMetadataPath, "paid Bible import metadata");
  const metadata = readJson(paidBibleMetadataPath, "paid Bible import metadata");
  const translations = Array.isArray(metadata) ? metadata : metadata?.translations;
  if (!Array.isArray(translations) || translations.length === 0) {
    fail("paid Bible import metadata has no translations");
  }
  return translations.map((translation) => ({
    abbreviation: String(translation?.abbreviation || "").trim(),
    tableName: String(translation?.tableName || "").trim(),
    jsonFile: String(translation?.jsonFile || "").trim(),
  })).map((translation) => {
    if (!translation.abbreviation || !translation.tableName || !translation.jsonFile) {
      fail(`paid Bible import metadata has an incomplete translation: ${JSON.stringify(translation)}`);
    }
    return translation;
  });
}

function preparePublicDb() {
  const paidTranslations = paidBibleTranslations();
  if (paidTranslations.length === 0) return;
  const dropTables = paidTranslations
    .map((translation) => `DROP TABLE IF EXISTS ${mustQuoteSqlIdentifier(translation.tableName)};`)
    .join("\n");
  const abbreviations = paidTranslations
    .map((translation) => sqlString(translation.abbreviation))
    .join(", ");
  const tables = paidTranslations
    .map((translation) => sqlString(translation.tableName))
    .join(", ");
  runSqlite(
    buildDbPath,
    `
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;
${dropTables}
DELETE FROM bible_version_key WHERE abbreviation IN (${abbreviations}) OR "table" IN (${tables});
COMMIT;
VACUUM;
`,
  );
}

function preparePaidDb() {
  paidBibleTranslations().forEach((translation) => {
    assertFile(path.resolve(privateBibleRoot, translation.jsonFile), `${translation.abbreviation} JSON`);
  });
  assertFile(paidBibleMetadataPath, "paid Bible import metadata");
  assertFile(bibleImporterPath, "paid Bible importer");
  run(process.execPath, [bibleImporterPath, paidBibleMetadataPath, buildDbPath]);
  runSqlite(buildDbPath, "VACUUM;");
}

function applyBuiltInAttributionMetadata() {
  const updates = Object.entries(PUBLIC_DOMAIN_ATTRIBUTIONS)
    .map(([abbreviation, copyrightInfo]) => {
      return `
UPDATE bible_version_key
SET
  copyright = 'Public Domain',
  copyright_info = ${sqlString(copyrightInfo)}
WHERE abbreviation = ${sqlString(abbreviation)};`;
    })
    .join("\n");

  runSqlite(
    buildDbPath,
    `
BEGIN IMMEDIATE;
${updates}
COMMIT;
`,
  );
}

function optimizeDb() {
  const goBinary = resolveGoBinary();
  console.log("Optimizing Bible DB with chapter-level LZFSE text BLOBs and FTS5 lookup");
  run(goBinary, ["run", "./cmd/bible-db-optimize", "--db", buildDbPath], {
    cwd: scriptDir,
    env: {
      ...process.env,
      CGO_ENABLED: "0",
    },
  });
}

function versionKeysFromDb(dbPath) {
  return querySqlite(dbPath, "SELECT abbreviation FROM bible_version_key ORDER BY abbreviation;")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
}

function tableExists(dbPath, tableName) {
  const escaped = String(tableName).replaceAll("'", "''");
  return Boolean(
    querySqlite(
      dbPath,
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${escaped}';`,
    ).trim(),
  );
}

function bibleVersionMetadataRows(dbPath) {
  const separator = "\u001f";
  return querySqlite(
    dbPath,
    `
SELECT abbreviation || char(31) || version || char(31) || copyright || char(31) || copyright_info || char(31) || publisher
FROM bible_version_key
ORDER BY abbreviation;`,
  )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [abbreviation, version, copyright, copyrightInfo, publisher] = line.split(separator);
      return { abbreviation, version, copyright, copyrightInfo, publisher };
    });
}

function textSaysPublicDomain(value) {
  return String(value || "").toLowerCase().includes("public domain");
}

function verifyAttributionMetadata(dbPath) {
  const rows = bibleVersionMetadataRows(dbPath);
  if (!rows.length) {
    fail("Bible database has no version attribution rows");
  }
  for (const row of rows) {
    const abbreviation = String(row.abbreviation || "").trim();
    const version = String(row.version || "").trim();
    const copyright = String(row.copyright || "").trim();
    const copyrightInfo = String(row.copyrightInfo || "").trim();
    const publisher = String(row.publisher || "").trim();
    const publicDomain = textSaysPublicDomain(copyright) || textSaysPublicDomain(copyrightInfo);
    const attributionText = [version, abbreviation, copyrightInfo || copyright, publisher]
      .filter(Boolean)
      .join(" ");
    if (!abbreviation || !version) {
      fail(`Bible version row is missing abbreviation or full name: ${JSON.stringify(row)}`);
    }
    if (!attributionText.trim()) {
      fail(`Bible version ${abbreviation} is missing attribution text`);
    }
    if (publicDomain && !copyrightInfo) {
      fail(`Public-domain Bible version ${abbreviation} is missing copyright_info attribution text`);
    }
    if (!publicDomain && !copyrightInfo) {
      fail(`Copyrighted Bible version ${abbreviation} is missing copyright_info attribution text`);
    }
    if (!publicDomain && !publisher) {
      fail(`Copyrighted Bible version ${abbreviation} is missing publisher attribution metadata`);
    }
  }
}

function verifyDb(dbPath) {
  const versions = versionKeysFromDb(dbPath);
  const paidTranslations = paidBibleTranslations();

  if (edition === "public") {
    const leaked = paidTranslations.filter((translation) => {
      return versions.includes(translation.abbreviation) || tableExists(dbPath, translation.tableName);
    });
    if (leaked.length) {
      fail(
        `public Bible database still contains paid translation(s): ${leaked
          .map((translation) => translation.abbreviation)
          .join(", ")}`,
      );
    }
  }

  if (edition === "paid") {
    for (const translation of paidTranslations) {
      if (!versions.includes(translation.abbreviation)) {
        fail(`paid Bible database is missing ${translation.abbreviation}`);
      }
      if (!tableExists(dbPath, translation.tableName)) {
        fail(`paid Bible database is missing ${translation.tableName}`);
      }
      const verseCount = Number(
        querySqlite(dbPath, `SELECT COUNT(*) FROM ${mustQuoteSqlIdentifier(translation.tableName)};`).trim(),
      );
      if (!Number.isInteger(verseCount) || verseCount <= 0) {
        fail(`paid Bible database has no ${translation.abbreviation} verses`);
      }
    }
  }

  verifyAttributionMetadata(dbPath);

  if (!tableExists(dbPath, "bible_storage_metadata")) {
    fail("Bible database is missing storage metadata");
  }
  if (!tableExists(dbPath, "bible_verse_lookup")) {
    fail("Bible database is missing verse lookup table");
  }
  if (!tableExists(dbPath, "bible_text_fts")) {
    fail("Bible database is missing FTS5 table");
  }
  if (!tableExists(dbPath, "bible_chapter_text")) {
    fail("Bible database is missing compressed chapter table");
  }

  const textEncoding = querySqlite(
    dbPath,
    "SELECT value FROM bible_storage_metadata WHERE key = 'text_encoding';",
  ).trim();
  if (textEncoding !== "lzfse") {
    fail(`Bible database text encoding is ${textEncoding || "unset"}, expected lzfse`);
  }

  const textStorage = querySqlite(
    dbPath,
    "SELECT value FROM bible_storage_metadata WHERE key = 'text_storage';",
  ).trim();
  if (textStorage !== "chapter_lzfse_json") {
    fail(`Bible database text storage is ${textStorage || "unset"}, expected chapter_lzfse_json`);
  }

  const schemaVersion = querySqlite(
    dbPath,
    "SELECT value FROM bible_storage_metadata WHERE key = 'schema_version';",
  ).trim();
  if (schemaVersion !== "3") {
    fail(`Bible database schema version is ${schemaVersion || "unset"}, expected 3`);
  }

  const kjvTextColumnCount = Number(
    querySqlite(dbPath, "SELECT COUNT(*) FROM pragma_table_info('t_kjv') WHERE name = 't';").trim(),
  );
  if (kjvTextColumnCount !== 0) {
    fail("KJV reference table still contains a legacy text column");
  }

  const lookupCount = Number(querySqlite(dbPath, "SELECT COUNT(*) FROM bible_verse_lookup;").trim());
  const ftsCount = Number(querySqlite(dbPath, "SELECT COUNT(*) FROM bible_text_fts;").trim());
  const chapterCount = Number(querySqlite(dbPath, "SELECT COUNT(*) FROM bible_chapter_text;").trim());
  const chapterTextType = querySqlite(
    dbPath,
    "SELECT typeof(t) FROM bible_chapter_text LIMIT 1;",
  ).trim();
  if (!Number.isInteger(lookupCount) || lookupCount <= 0) {
    fail("Bible verse lookup table is empty");
  }
  if (ftsCount !== lookupCount) {
    fail(`Bible FTS row count (${ftsCount}) does not match lookup count (${lookupCount})`);
  }
  if (!Number.isInteger(chapterCount) || chapterCount <= 0) {
    fail("Bible compressed chapter table is empty");
  }
  if (chapterTextType !== "blob") {
    fail(`Bible compressed chapter storage is ${chapterTextType || "unset"}, expected blob`);
  }

  console.log(`Prepared ${edition} Bible DB with versions: ${versions.join(", ")}`);
}

function copyDbToDerived() {
  // Only replace the database file. Other files in this directory (e.g. the
  // Make edition record) must survive so timestamp-based rebuilds stay correct.
  mkdirSync(outputDbDir, { recursive: true });
  rmSync(outputDbPath, { force: true });
  copyFileSync(buildDbPath, outputDbPath);
}

if (!["public", "paid"].includes(edition)) {
  fail("edition must be either 'public' or 'paid'");
}

assertFile(sourceDbPath, "Bible SQLite database");

prepareBuildDb();
if (edition === "paid") {
  preparePaidDb();
} else {
  preparePublicDb();
}
applyBuiltInAttributionMetadata();
optimizeDb();
verifyDb(buildDbPath);
copyDbToDerived();
rmSync(path.join(derivedRoot, "src", "main.wasm"), { force: true });
rmSync(path.join(derivedRoot, "src", "Bible.min.mjs"), { force: true });
rmSync(path.join(derivedRoot, "src", "wasm_exec.min.js"), { force: true });

console.log(`Prepared ${edition} Bible database at ${outputDbPath}`);

process.exit(0);
