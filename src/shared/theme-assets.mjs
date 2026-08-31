import { createHash, randomUUID } from "crypto";
import { copyFile, mkdir, readFile, realpath, stat } from "fs/promises";
import path from "path";

export async function hashThemeAsset(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

export async function importThemeAsset(sourcePath, assetsDir, metadata = {}) {
  const info = await stat(sourcePath);
  if (!info.isFile()) throw new TypeError("Theme asset must be a file");
  await mkdir(assetsDir, { recursive: true });
  const hash = await hashThemeAsset(sourcePath);
  const extension = path.extname(sourcePath).toLowerCase().replace(/[^.a-z0-9]/g, "");
  const id = metadata.id || `asset_${randomUUID().replace(/-/g, "")}`;
  const filename = `${id}${extension}`;
  const destination = path.join(assetsDir, filename);
  await copyFile(sourcePath, destination);
  return { id, type: metadata.type || inferThemeAssetType(extension), path: `assets/${filename}`, hash, name: metadata.name || path.basename(sourcePath), ...(metadata.license ? { license: metadata.license } : {}) };
}

export function inferThemeAssetType(extension) {
  if ([".mp4", ".m4v", ".mov", ".mkv", ".webm"].includes(extension)) return "video";
  if ([".ttf", ".otf", ".woff", ".woff2"].includes(extension)) return "font";
  return "image";
}

export async function resolveManagedThemeAsset(themeDir, asset) {
  if (!asset?.path || path.isAbsolute(asset.path) || asset.path.includes("..")) return null;
  const root = await realpath(themeDir);
  let candidate;
  try { candidate = await realpath(path.join(root, asset.path)); } catch { return null; }
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  return candidate;
}

export function backgroundWithAssetFallback(background = {}, assetUrl) {
  if ((background.type === "image" || background.type === "video") && !assetUrl) return { type: "color", color: background.color || "#000000", assetId: null, missingAssetId: background.assetId || null };
  return { ...background, ...(assetUrl ? { assetUrl } : {}) };
}
