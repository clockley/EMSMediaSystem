import { createHash, randomUUID } from "crypto";
import { createWriteStream } from "fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "fs/promises";
import path from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import yauzl from "yauzl";
import yazl from "yazl";
import { normalizeTheme } from "./theme-normalize.mjs";
import { themeRevision } from "./theme-resolver.mjs";
import { resolveManagedThemeAsset } from "./theme-assets.mjs";

export const THEME_PACK_EXTENSION = ".emtheme";
export const THEME_PACK_MIME_TYPE = "application/vnd.ems.theme+zip";
export const THEME_PACK_SCHEMA = "ems.theme-pack.v1";
const MAX_ENTRIES = 256;
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const sha256 = data => createHash("sha256").update(data).digest("hex");
const canonical = value => `${JSON.stringify(value, null, 2)}\n`;

function safeArchivePath(value) {
  const name = String(value || "").replace(/\\/g, "/");
  if (!name || name.startsWith("/") || name.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe theme-pack path: ${value}`);
  }
  return name;
}

const openZip = filePath => new Promise((resolve, reject) =>
  yauzl.open(filePath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true },
    (error, zip) => error ? reject(error) : resolve(zip)));

function openEntryStream(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream));
  });
}

async function inspectEntry(zip, entry, { capture = false } = {}) {
  const stream = await openEntryStream(zip, entry);
  const hash = createHash("sha256");
  const chunks = capture ? [] : null;
  const maxBytes = capture ? MAX_METADATA_BYTES : MAX_ENTRY_BYTES;
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maxBytes) {
      stream.destroy();
      throw new Error(capture ? "Theme-pack metadata is too large" : "Theme-pack entry is too large");
    }
    hash.update(chunk);
    if (chunks) chunks.push(chunk);
  }
  return {
    size,
    sha256: hash.digest("hex"),
    ...(chunks ? { buffer: Buffer.concat(chunks) } : {}),
  };
}

async function extractThemePackAssets(packPath, theme, staging, manifest) {
  const targets = new Map();
  for (const asset of theme.assets) {
    const archivePath = safeArchivePath(asset.path);
    if (!archivePath.startsWith("assets/")) {
      throw new Error(`Theme asset must be under assets/: ${asset.id}`);
    }
    targets.set(archivePath, {
      destination: path.join(staging, archivePath),
      integrity: manifest.files?.[archivePath],
    });
  }

  const zip = await openZip(packPath);
  const extracted = new Set();
  try {
    await new Promise((resolve, reject) => {
      zip.on("entry", async entry => {
        try {
          const name = safeArchivePath(entry.fileName);
          const target = targets.get(name);
          if (!target) {
            zip.readEntry();
            return;
          }
          if (extracted.has(name)) throw new Error(`Duplicate theme-pack entry: ${name}`);
          const unixType = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (name.endsWith("/") || unixType === 0o120000) {
            throw new Error("Theme pack contains a directory or symlink");
          }
          if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
            throw new Error("Theme-pack entry is too large");
          }
          await mkdir(path.dirname(target.destination), { recursive: true });
          const stream = await openEntryStream(zip, entry);
          const hash = createHash("sha256");
          let size = 0;
          const verifier = new Transform({
            transform(chunk, _encoding, callback) {
              size += chunk.length;
              if (size > MAX_ENTRY_BYTES) {
                callback(new Error("Theme-pack entry is too large"));
                return;
              }
              hash.update(chunk);
              callback(null, chunk);
            },
          });
          await pipeline(
            stream,
            verifier,
            createWriteStream(target.destination, { flags: "wx" }),
          );
          const digest = hash.digest("hex");
          if (digest !== target.integrity?.sha256?.toLowerCase()) {
            throw new Error(`Theme-pack hash mismatch: ${name}`);
          }
          if (
            target.integrity?.size !== undefined &&
            target.integrity.size !== size
          ) {
            throw new Error(`Theme-pack size mismatch: ${name}`);
          }
          extracted.add(name);
          zip.readEntry();
        } catch (error) { reject(error); }
      });
      zip.once("error", reject);
      zip.once("end", resolve);
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  for (const name of targets.keys()) {
    if (!extracted.has(name)) throw new Error(`Theme-pack asset is missing: ${name}`);
  }
}

export async function exportThemePack({ theme, themeDir, destination, app = {}, metadata = {} }) {
  const normalized = normalizeTheme(theme);
  const themeData = Buffer.from(canonical(normalized));
  const files = [{ archivePath: "theme.json", data: themeData, hash: sha256(themeData) }];
  for (const asset of normalized.assets) {
    const source = await resolveManagedThemeAsset(themeDir, asset);
    if (!source) throw new Error(`Theme asset is missing or unmanaged: ${asset.id}`);
    const archivePath = safeArchivePath(asset.path);
    if (!archivePath.startsWith("assets/")) throw new Error(`Theme asset must be under assets/: ${asset.id}`);
    const data = await readFile(source); const hash = sha256(data);
    if (asset.hash && asset.hash.toLowerCase() !== hash) throw new Error(`Theme asset hash mismatch: ${asset.id}`);
    files.push({ archivePath, source, hash, size: data.length });
  }
  const manifest = {
    schema: THEME_PACK_SCHEMA,
    mimeType: THEME_PACK_MIME_TYPE,
    themeId: normalized.id,
    themeRevision: themeRevision(normalized),
    exportedAt: new Date().toISOString(),
    createdBy: { name: app.name || "EMS Media System", version: app.version || "unknown" },
    metadata: { author: metadata.author || "", source: metadata.source || "", license: metadata.license || "" },
    files: Object.fromEntries(files.map(file => [file.archivePath, {
      sha256: file.hash, ...(file.size !== undefined ? { size: file.size } : {}),
    }])),
  };
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`; const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(`${THEME_PACK_MIME_TYPE}\n`), "mimetype", { compress: false });
  zip.addBuffer(Buffer.from(canonical(manifest)), "manifest.json");
  zip.addBuffer(themeData, "theme.json");
  for (const file of files.slice(1)) zip.addFile(file.source, file.archivePath);
  zip.end();
  try {
    await pipeline(zip.outputStream, createWriteStream(temporary, { flags: "wx" }));
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {}); throw error;
  }
  return { destination, manifest };
}

export async function inspectThemePack(packPath) {
  const zip = await openZip(packPath);
  const entries = new Map();
  const metadata = new Map();
  let count = 0;
  let total = 0;
  try {
    await new Promise((resolve, reject) => {
      zip.on("entry", async entry => {
        try {
          count += 1; if (count > MAX_ENTRIES) throw new Error("Theme pack has too many entries");
          const name = safeArchivePath(entry.fileName);
          const unixType = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (name.endsWith("/") || unixType === 0o120000) throw new Error("Theme pack contains a directory or symlink");
          if (entry.uncompressedSize > MAX_ENTRY_BYTES) throw new Error("Theme-pack entry is too large");
          total += entry.uncompressedSize; if (total > MAX_TOTAL_BYTES) throw new Error("Theme pack is too large");
          if (entries.has(name)) throw new Error(`Duplicate theme-pack entry: ${name}`);
          const capture = ["mimetype", "manifest.json", "theme.json"].includes(name);
          const inspected = await inspectEntry(zip, entry, { capture });
          entries.set(name, { size: inspected.size, sha256: inspected.sha256 });
          if (inspected.buffer) metadata.set(name, inspected.buffer);
          zip.readEntry();
        } catch (error) { reject(error); }
      });
      zip.once("error", reject); zip.once("end", resolve); zip.readEntry();
    });
  } finally { zip.close(); }
  if (metadata.get("mimetype")?.toString("utf8").trim() !== THEME_PACK_MIME_TYPE) throw new Error("Invalid theme-pack MIME type");
  let manifest; let theme;
  try {
    manifest = JSON.parse(metadata.get("manifest.json")?.toString("utf8") || "");
    theme = normalizeTheme(JSON.parse(metadata.get("theme.json")?.toString("utf8") || ""));
  } catch (error) { throw new Error(`Invalid theme-pack metadata: ${error.message}`); }
  if (manifest.schema !== THEME_PACK_SCHEMA || manifest.themeId !== theme.id) throw new Error("Theme-pack manifest does not match its theme");
  const declared = manifest.files && typeof manifest.files === "object" ? manifest.files : {};
  for (const name of entries.keys()) {
    if (!["mimetype", "manifest.json"].includes(name) && !declared[name]) throw new Error(`Undeclared theme-pack file: ${name}`);
  }
  for (const [name, integrity] of Object.entries(declared)) {
    safeArchivePath(name); const inspected = entries.get(name);
    if (!inspected) throw new Error(`Missing theme-pack file: ${name}`);
    if (!/^[a-f0-9]{64}$/i.test(integrity?.sha256 || "") || inspected.sha256 !== integrity.sha256.toLowerCase()) throw new Error(`Theme-pack hash mismatch: ${name}`);
    if (
      integrity?.size !== undefined &&
      (!Number.isSafeInteger(integrity.size) || integrity.size < 0 || integrity.size !== inspected.size)
    ) {
      throw new Error(`Theme-pack size mismatch: ${name}`);
    }
  }
  if (manifest.themeRevision !== themeRevision(theme)) throw new Error("Theme-pack revision mismatch");
  for (const asset of theme.assets) {
    if (!asset.path || !entries.has(safeArchivePath(asset.path))) throw new Error(`Theme-pack asset is missing: ${asset.id}`);
  }
  return { manifest, theme, entries };
}

export async function importThemePack(packPath, library, { conflict = "copy" } = {}) {
  if (!["copy", "replace", "reject"].includes(conflict)) throw new TypeError(`Unknown theme conflict policy: ${conflict}`);
  const inspected = await inspectThemePack(packPath); let theme = inspected.theme;
  const existing = (await library.list()).some(item => item.id === theme.id);
  if (existing && conflict === "reject") throw new Error(`Theme already exists: ${theme.id}`);
  if (existing && conflict === "copy") theme = { ...theme, id: `theme_${randomUUID().replace(/-/g, "")}`, name: `${theme.name} (Imported)` };
  const targetDir = library.themeDir(theme.id);
  const targetParent = path.dirname(targetDir);
  await mkdir(targetParent, { recursive: true });
  // Keep staging on the destination filesystem so the final rename remains
  // atomic even when the OS temp directory is mounted on another device.
  const staging = await mkdtemp(path.join(targetParent, ".ems-theme-import-"));
  let backupDir = "";
  let installed = false;
  try {
    await mkdir(path.join(staging, "assets"), { recursive: true });
    await extractThemePackAssets(packPath, theme, staging, inspected.manifest);
    await writeFile(path.join(staging, "theme.json"), canonical(theme), { flag: "wx" });
    if (existing && conflict === "replace") {
      backupDir = path.join(targetParent, `.ems-theme-backup-${randomUUID()}`);
      await rename(targetDir, backupDir);
    }
    await rename(staging, targetDir);
    installed = true;
    await library.rebuildIndex();
    if (backupDir) await rm(backupDir, { recursive: true, force: true });
    return { theme, importedAsCopy: existing && conflict === "copy", manifest: inspected.manifest };
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    if (installed) {
      await rm(targetDir, { recursive: true, force: true }).catch(() => {});
    }
    if (backupDir) {
      await rename(backupDir, targetDir).catch(() => {});
      await library.rebuildIndex().catch(() => {});
    }
    throw error;
  }
}
