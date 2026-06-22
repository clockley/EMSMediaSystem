#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultMetadataPath = path.join(scriptDir, "bible-imports.json");
const defaultDbPath = path.join(scriptDir, "bible-sqlite.db");

const [metadataArg, dbArg] = process.argv.slice(2);
const metadataPath = path.resolve(process.cwd(), metadataArg || defaultMetadataPath);
const dbPath = path.resolve(process.cwd(), dbArg || defaultDbPath);
const metadataDir = path.dirname(metadataPath);

function fail(message) {
  console.error(`import-bibles: ${message}`);
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

function querySqlite(sql) {
  try {
    return execFileSync("sqlite3", [dbPath, sql], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 32,
    });
  } catch (err) {
    fail(`sqlite query failed: ${err.stderr?.toString() || err.message}`);
  }
}

function runSqlite(sql) {
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

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function quoteIdentifier(identifier) {
  const value = String(identifier || "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    fail(`unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    fail(`invalid ${label}: ${value}`);
  }
  return number;
}

function sortedNumericEntries(record, label) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    fail(`${label} must be an object`);
  }

  return Object.entries(record).sort(([left], [right]) => {
    return positiveInteger(left, label) - positiveInteger(right, label);
  });
}

function textSaysPublicDomain(value) {
  return String(value || "").toLowerCase().includes("public domain");
}

function requiredText(record, key, label) {
  const value = String(record?.[key] || "").trim();
  if (!value) fail(`${label} is missing ${key}`);
  return value;
}

function optionalText(record, key) {
  return String(record?.[key] || "").trim();
}

function tableNameFor(translation) {
  return optionalText(translation, "tableName") ||
    `t_${requiredText(translation, "abbreviation", "translation").toLowerCase()}`;
}

function verseIndexName(tableName) {
  return `idx_verses_${tableName.replace(/^t_/, "")}`;
}

function normalizeTranslation(raw) {
  const abbreviation = requiredText(raw, "abbreviation", "translation");
  const tableName = tableNameFor(raw);
  quoteIdentifier(tableName);
  const translation = {
    abbreviation,
    tableName,
    jsonFile: requiredText(raw, "jsonFile", abbreviation),
    language: optionalText(raw, "language") || "english",
    version: requiredText(raw, "version", abbreviation),
    infoText: optionalText(raw, "infoText"),
    infoUrl: optionalText(raw, "infoUrl"),
    publisher: optionalText(raw, "publisher"),
    copyright: optionalText(raw, "copyright"),
    copyrightInfo: optionalText(raw, "copyrightInfo"),
  };

  const publicDomain =
    textSaysPublicDomain(translation.copyright) ||
    textSaysPublicDomain(translation.copyrightInfo);
  if (!translation.copyrightInfo) {
    fail(`${abbreviation} is missing copyrightInfo`);
  }
  if (!translation.copyright) {
    fail(`${abbreviation} is missing copyright`);
  }
  if (!publicDomain && !translation.publisher) {
    fail(`${abbreviation} is missing publisher`);
  }

  return translation;
}

function loadImportMetadata() {
  assertFile(metadataPath, "Bible import metadata");
  const parsed = readJson(metadataPath, "Bible import metadata");
  const translations = Array.isArray(parsed) ? parsed : parsed?.translations;
  if (!Array.isArray(translations) || translations.length === 0) {
    fail("Bible import metadata must include a non-empty translations array");
  }
  return translations.map(normalizeTranslation);
}

function loadBookRows() {
  const raw = querySqlite(`SELECT b || '|' || n FROM key_english ORDER BY b;`).trim();
  if (!raw) fail("key_english is empty");
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf("|");
      if (separatorIndex === -1) fail(`unexpected key_english row: ${line}`);
      return {
        id: positiveInteger(line.slice(0, separatorIndex), "book id"),
        name: line.slice(separatorIndex + 1),
      };
    });
}

function loadBibleJson(translation) {
  const jsonPath = path.resolve(metadataDir, translation.jsonFile);
  assertFile(jsonPath, `${translation.abbreviation} JSON`);
  return readJson(jsonPath, `${translation.abbreviation} JSON`);
}

function validateBibleJson(translation, bible, bookRows) {
  const bookMap = new Map(bookRows.map((book) => [book.name, book.id]));
  const jsonBookNames = Object.keys(bible || {});
  const unknownBooks = jsonBookNames.filter((name) => !bookMap.has(name));
  const missingBooks = bookRows.map((book) => book.name).filter((name) => !bible?.[name]);

  if (unknownBooks.length) {
    fail(`${translation.abbreviation} JSON contains unknown books: ${unknownBooks.join(", ")}`);
  }
  if (missingBooks.length) {
    fail(`${translation.abbreviation} JSON is missing books: ${missingBooks.join(", ")}`);
  }
}

function versionIDFor(translation) {
  const existingVersionId = querySqlite(
    `SELECT id FROM bible_version_key WHERE abbreviation = ${sqlString(translation.abbreviation)} OR "table" = ${sqlString(translation.tableName)} ORDER BY id LIMIT 1;`,
  ).trim();
  if (existingVersionId) return positiveInteger(existingVersionId, `${translation.abbreviation} existing version id`);

  const nextVersionId = querySqlite(`SELECT COALESCE(MAX(id), 0) + 1 FROM bible_version_key;`).trim();
  return positiveInteger(nextVersionId, `${translation.abbreviation} next version id`);
}

function importTranslation(translation, bookRows) {
  const bible = loadBibleJson(translation);
  validateBibleJson(translation, bible, bookRows);

  const tableName = quoteIdentifier(translation.tableName);
  const tableIDIndex = quoteIdentifier(`${translation.tableName}_id`);
  const tableUniqueIDIndex = quoteIdentifier(`${translation.tableName}_id_2`);
  const tableReferenceIndex = quoteIdentifier(verseIndexName(translation.tableName));
  const versionId = versionIDFor(translation);
  const statements = [
    "PRAGMA foreign_keys = OFF;",
    "BEGIN IMMEDIATE;",
    `DROP TABLE IF EXISTS ${tableName};`,
    `CREATE TABLE ${tableName} (
  "id" INTEGER NOT NULL,
  "b" INTEGER NOT NULL,
  "c" INTEGER NOT NULL,
  "v" INTEGER NOT NULL,
  "t" TEXT NOT NULL,
  PRIMARY KEY ("id")
);`,
    `CREATE INDEX ${tableIDIndex} ON ${tableName} ("id");`,
    `CREATE UNIQUE INDEX ${tableUniqueIDIndex} ON ${tableName} ("id");`,
    `CREATE INDEX ${tableReferenceIndex} ON ${tableName} ("b", "c", "v");`,
    `DELETE FROM bible_version_key WHERE abbreviation = ${sqlString(translation.abbreviation)} OR "table" = ${sqlString(translation.tableName)};`,
    `INSERT INTO bible_version_key (
  "id",
  "table",
  "abbreviation",
  "language",
  "version",
  "info_text",
  "info_url",
  "publisher",
  "copyright",
  "copyright_info"
) VALUES (
  ${versionId},
  ${sqlString(translation.tableName)},
  ${sqlString(translation.abbreviation)},
  ${sqlString(translation.language)},
  ${sqlString(translation.version)},
  ${sqlString(translation.infoText)},
  ${sqlString(translation.infoUrl)},
  ${sqlString(translation.publisher)},
  ${sqlString(translation.copyright)},
  ${sqlString(translation.copyrightInfo)}
);`,
  ];

  let verseCount = 0;
  for (const book of bookRows) {
    const chapters = bible[book.name];
    for (const [chapterKey, verses] of sortedNumericEntries(chapters, `${book.name} chapters`)) {
      const chapter = positiveInteger(chapterKey, `${book.name} chapter`);
      for (const [verseKey, text] of sortedNumericEntries(
        verses,
        `${book.name} ${chapter} verses`,
      )) {
        const verse = positiveInteger(verseKey, `${book.name} ${chapter} verse`);
        if (typeof text !== "string") {
          fail(`${translation.abbreviation} ${book.name} ${chapter}:${verse} text must be a string`);
        }

        const id = book.id * 1_000_000 + chapter * 1_000 + verse;
        statements.push(
          `INSERT INTO ${tableName} ("id", "b", "c", "v", "t") VALUES (${id}, ${book.id}, ${chapter}, ${verse}, ${sqlString(text)});`,
        );
        verseCount += 1;
      }
    }
  }

  statements.push("COMMIT;");
  runSqlite(`${statements.join("\n")}\n`);

  const importedVerseCount = querySqlite(`SELECT COUNT(*) FROM ${tableName};`).trim();
  const versionRow = querySqlite(
    `SELECT id || '|' || "table" || '|' || abbreviation || '|' || version FROM bible_version_key WHERE abbreviation = ${sqlString(translation.abbreviation)};`,
  ).trim();

  console.log(`Imported ${importedVerseCount} ${translation.abbreviation} verses.`);
  console.log(`Source verse count: ${verseCount}`);
  console.log(`Version row: ${versionRow}`);
}

assertFile(dbPath, "SQLite database");

const translations = loadImportMetadata();
const bookRows = loadBookRows();
for (const translation of translations) {
  importTranslation(translation, bookRows);
}
