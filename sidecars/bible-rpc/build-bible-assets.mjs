#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
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
const outputBinDir = path.join(derivedRoot, "bin");
const rpcProbeTimeoutMs = Number.parseInt(process.env.BIBLE_RPC_PROBE_TIMEOUT_MS || "", 10) || 60000;

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
  rmSync(outputDbDir, { recursive: true, force: true });
  mkdirSync(outputDbDir, { recursive: true });
  copyFileSync(buildDbPath, outputDbPath);
}

function targetBinaryName(target) {
  const extension = target.platform === "win32" ? ".exe" : "";
  return `bible-rpc-${target.platform}-${target.arch}${extension}`;
}

function currentGoTarget() {
  const goarchByNodeArch = {
    arm64: "arm64",
    x64: "amd64",
  };
  const goosByNodePlatform = {
    linux: "linux",
    win32: "windows",
  };
  const goos = goosByNodePlatform[process.platform];
  const goarch = goarchByNodeArch[process.arch];
  if (!goos || !goarch) return null;
  return {
    platform: process.platform,
    arch: process.arch,
    goos,
    goarch,
  };
}

function sidecarTargets() {
  const targets = [
    { platform: "linux", arch: "x64", goos: "linux", goarch: "amd64" },
    { platform: "win32", arch: "x64", goos: "windows", goarch: "amd64" },
  ];
  const current = currentGoTarget();
  if (
    current &&
    !targets.some((target) => target.platform === current.platform && target.arch === current.arch)
  ) {
    targets.push(current);
  }
  return targets;
}

function buildSidecars() {
  const goBinary = resolveGoBinary();
  const targets = sidecarTargets();

  rmSync(outputBinDir, { recursive: true, force: true });
  mkdirSync(outputBinDir, { recursive: true });

  for (const target of targets) {
    const outputPath = path.join(outputBinDir, targetBinaryName(target));
    console.log(`Building Bible RPC sidecar: ${target.platform}/${target.arch}`);
    run(goBinary, ["build", "-trimpath", "-ldflags", "-s -w", "-o", outputPath, "."], {
      cwd: scriptDir,
      env: {
        ...process.env,
        CGO_ENABLED: "0",
        GOOS: target.goos,
        GOARCH: target.goarch,
      },
    });
    if (target.platform !== "win32") {
      chmodSync(outputPath, 0o755);
    }
  }

  return targets;
}

function currentSidecarPath(targets) {
  const current = currentGoTarget();
  if (!current) return "";
  const target = targets.find(
    (candidate) => candidate.platform === current.platform && candidate.arch === current.arch,
  );
  return target ? path.join(outputBinDir, targetBinaryName(target)) : "";
}

function rpcProbe(binaryPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, ["--db", outputDbPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "";
    let stderr = "";
    let nextId = 1;
    const pending = new Map();

    const stop = () => {
      if (!child.killed) child.kill();
    };

    const send = (method, params = []) => {
      const id = nextId;
      nextId += 1;
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      return new Promise((requestResolve, requestReject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          const detail = stderr.trim() ? `: ${stderr.trim()}` : "";
          requestReject(new Error(`RPC timed out after ${rpcProbeTimeoutMs}ms: ${method}${detail}`));
        }, rpcProbeTimeoutMs);
        pending.set(id, { resolve: requestResolve, reject: requestReject, timer });
        child.stdin.write(`${payload}\n`, "utf8", (err) => {
          if (!err) return;
          clearTimeout(timer);
          pending.delete(id);
          requestReject(err);
        });
      });
    };

    const rejectPending = (err) => {
      for (const [id, request] of pending) {
        clearTimeout(request.timer);
        request.reject(err);
        pending.delete(id);
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
        if (!line) continue;

        let message;
        try {
          message = JSON.parse(line);
        } catch (err) {
          reject(err);
          stop();
          return;
        }

        const request = pending.get(message.id);
        if (!request) continue;
        clearTimeout(request.timer);
        pending.delete(message.id);
        if (message.error) {
          request.reject(new Error(message.error.message || "RPC error"));
        } else {
          request.resolve(message.result);
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      rejectPending(err);
      reject(err);
    });
    child.on("exit", (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      const err = new Error(`Bible sidecar exited with ${detail}${stderr ? `: ${stderr}` : ""}`);
      rejectPending(err);
    });

    (async () => {
      try {
        await send("bible.ready");
        const versions = await send("bible.getVersions");
        const versionKeys = Object.keys(versions || {}).sort();
        const versionRecords = Object.values(versions || {});
        const missingAttribution = versionRecords
          .filter((version) => !String(version?.attribution?.text || "").trim())
          .map((version) => version?.abbreviation || version?.version || "(unknown)");
        if (missingAttribution.length) {
          throw new Error(
            `sidecar version attribution missing for ${missingAttribution.join(", ")}`,
          );
        }
        if (!versions?.KJV?.attribution?.publicDomain) {
          throw new Error("sidecar KJV attribution is not marked public domain");
        }
        const paidTranslations = paidBibleTranslations();
        const exposedPaidVersions = paidTranslations.filter((translation) =>
          versionKeys.includes(translation.abbreviation),
        );
        if (edition === "public" && exposedPaidVersions.length) {
          throw new Error(
            `public sidecar exposes paid version(s): ${exposedPaidVersions
              .map((translation) => translation.abbreviation)
              .join(", ")}`,
          );
        }
        if (edition === "paid") {
          const missingPaidVersions = paidTranslations.filter(
            (translation) => !versionKeys.includes(translation.abbreviation),
          );
          if (missingPaidVersions.length) {
            throw new Error(
              `paid sidecar does not expose paid version(s): ${missingPaidVersions
                .map((translation) => translation.abbreviation)
                .join(", ")}`,
            );
          }
        }

        const passage = await send("bible.getPassage", ["KJV", "John 3:16"]);
        if (!passage?.text || !passage.text.includes("God")) {
          throw new Error("sidecar passage probe returned unexpected text");
        }
        if (!String(passage?.attribution?.text || "").includes("King James Version")) {
          throw new Error("sidecar passage probe returned no KJV attribution");
        }

        const suggestions = await send("bible.suggestReferences", ["KJV", "jhnn 3 16"]);
        if (!Array.isArray(suggestions?.suggestions) || suggestions.suggestions.length === 0) {
          throw new Error("sidecar suggestion probe returned no suggestions");
        }

        const search = await send("bible.searchText", ["KJV", "God loved world", 5]);
        const foundJohn316 = search?.results?.some(
          (result) =>
            result.reference === "John 3:16" &&
            result.text?.includes("God") &&
            result.attribution?.text,
        );
        if (!foundJohn316) {
          throw new Error("sidecar FTS search probe did not find John 3:16");
        }

        const phraseSearch = await send("bible.searchText", [
          "KJV",
          "God so loved",
          { mode: "phrase", limit: 5 },
        ]);
        const foundJohn316Phrase = phraseSearch?.results?.some(
          (result) => result.reference === "John 3:16" && result.version === "KJV",
        );
        if (!foundJohn316Phrase) {
          throw new Error("sidecar phrase search probe did not find John 3:16");
        }

        const partialPhraseSearch = await send("bible.searchText", [
          "KJV",
          "God so lov",
          { mode: "phrase", limit: 5 },
        ]);
        const foundJohn316PartialPhrase = partialPhraseSearch?.results?.some(
          (result) => result.reference === "John 3:16" && result.version === "KJV",
        );
        if (!foundJohn316PartialPhrase) {
          throw new Error("sidecar partial phrase search probe did not find John 3:16");
        }

        const allVersionSearch = await send("bible.searchText", [
          "*",
          "God so loved",
          { mode: "phrase", limit: 12 },
        ]);
        const versionMatches = new Set(
          (Array.isArray(allVersionSearch?.results) ? allVersionSearch.results : []).map(
            (result) => result.version,
          ),
        );
        if (!versionMatches.has("KJV")) {
          throw new Error("sidecar all-version search probe did not include KJV");
        }

        if (edition === "paid") {
          const paidProbeVersion = paidBibleTranslations()[0]?.abbreviation;
          if (!paidProbeVersion) {
            throw new Error("paid sidecar probe has no paid version to check");
          }
          const paidPassage = await send("bible.getPassage", [paidProbeVersion, "John 3:16"]);
          if (
            !paidPassage?.text ||
            paidPassage.version !== paidProbeVersion ||
            !String(paidPassage.attribution?.text || "").trim()
          ) {
            throw new Error("paid sidecar passage probe returned unexpected text or attribution");
          }
        }

        stop();
        resolve(versionKeys);
      } catch (err) {
        stop();
        reject(err);
      }
    })();
  });
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

const targets = buildSidecars();
const probePath = currentSidecarPath(targets);
if (probePath) {
  const versionKeys = await rpcProbe(probePath);
  console.log(`Verified ${edition} Bible RPC sidecar with versions: ${versionKeys.join(", ")}`);
} else {
  console.log("Skipped local sidecar probe for unsupported host platform");
}

process.exit(0);
