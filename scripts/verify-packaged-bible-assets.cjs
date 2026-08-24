"use strict";

const fs = require("node:fs");
const path = require("node:path");

const archNames = {
  0: "ia32",
  1: "x64",
  2: "armv7l",
  3: "arm64",
  4: "universal",
};
const bibleRpcBinaries = {
  linux: {
    x64: "bible-rpc-linux-x64",
    arm64: "bible-rpc-linux-arm64",
  },
  win32: {
    x64: "bible-rpc-win32-x64.exe",
    arm64: "bible-rpc-win32-arm64.exe",
  },
};
const mediaWatcherBinaries = {
  linux: {
    x64: "media-watcher-linux-x64",
    arm64: "media-watcher-linux-arm64",
  },
  win32: {
    x64: "media-watcher-win32-x64.exe",
    arm64: "media-watcher-win32-arm64.exe",
  },
};

function requireFile(filePath, label) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    throw new Error(`${label} is missing from packaged resources: ${filePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`${label} is not a file in packaged resources: ${filePath}`);
  }
  return stat;
}

function readJSON(filePath, label) {
  requireFile(filePath, label);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new Error(`${label} is invalid JSON: ${err.message}`);
  }
}

function verifyBibleBundle(bibleDir) {
  const bundlePath = path.join(bibleDir, "bundle.manifest.json");
  const bundle = readJSON(bundlePath, "Bible bundle manifest");
  if (bundle.format !== "ems.bible-bundle.v1" || !["public", "paid"].includes(bundle.edition)) {
    throw new Error(`Invalid Bible bundle manifest: ${bundlePath}`);
  }
  if (!Array.isArray(bundle.sources) || bundle.sources.length === 0) {
    throw new Error(`Bible bundle contains no sources: ${bundlePath}`);
  }
  const ids = new Set();
  const abbreviations = new Set();
  for (const source of bundle.sources) {
    if (!source || typeof source !== "object" || typeof source.id !== "string" || typeof source.abbreviation !== "string") {
      throw new Error(`Invalid Bible source record in ${bundlePath}`);
    }
    if (bundle.edition === "public" && source.id.startsWith("private:")) {
      throw new Error(`Private Bible ${source.id} is present in a public bundle`);
    }
    if (ids.has(source.id) || abbreviations.has(source.abbreviation)) {
      throw new Error(`Duplicate Bible identity in bundle: ${source.id}/${source.abbreviation}`);
    }
    ids.add(source.id);
    abbreviations.add(source.abbreviation);
  }
  const packagedEntries = fs.readdirSync(bibleDir, { withFileTypes: true });
  for (const entry of packagedEntries) {
    if (entry.isDirectory() || (entry.name.endsWith(".json") && entry.name !== "bundle.manifest.json")) {
      throw new Error(`Bible source material must not be packaged: ${entry.name}`);
    }
  }
  const cachePath = path.join(bibleDir, "bible-runtime.sqlite");
  const cacheStat = requireFile(cachePath, "Prebuilt Bible cache");
  if (cacheStat.size < 1024 * 1024) throw new Error(`Prebuilt Bible cache is unexpectedly small: ${cachePath}`);
  return { bundlePath, bundle, cachePath, cacheStat };
}

function sidecarName(platform, arch) {
  const archName = archNames[arch] || String(arch || "");
  const platformBinaries = bibleRpcBinaries[platform];
  if (!platformBinaries) {
    throw new Error(`Unsupported Bible RPC sidecar platform for packaging: ${platform}`);
  }
  const binaryName = platformBinaries[archName];
  if (!binaryName) {
    throw new Error(`Unsupported Bible RPC sidecar architecture for packaging: ${platform}/${archName}`);
  }
  return binaryName;
}

function mediaWatcherSidecarName(platform, arch) {
  const archName = archNames[arch] || String(arch || "");
  const platformBinaries = mediaWatcherBinaries[platform];
  if (!platformBinaries) {
    throw new Error(`Unsupported media watcher sidecar platform for packaging: ${platform}`);
  }
  const binaryName = platformBinaries[archName];
  if (!binaryName) {
    throw new Error(`Unsupported media watcher sidecar architecture for packaging: ${platform}/${archName}`);
  }
  return binaryName;
}

module.exports = async function verifyPackagedBibleAssets(context) {
  const resourcesDir = path.join(context.appOutDir, "resources");
  const legacySidecarDir = path.join(resourcesDir, "sidecar");
  const bibleDir = path.join(resourcesDir, "bible");
  const binaryPath = path.join(
    resourcesDir,
    "bin",
    sidecarName(context.electronPlatformName, context.arch),
  );
  const mediaWatcherBinaryPath = path.join(
    resourcesDir,
    "bin",
    mediaWatcherSidecarName(context.electronPlatformName, context.arch),
  );

  if (fs.existsSync(legacySidecarDir)) {
    throw new Error(`Legacy sidecar directory must not be packaged: ${legacySidecarDir}`);
  }

  const { bundlePath, bundle, cachePath, cacheStat } = verifyBibleBundle(bibleDir);
  const binaryStat = requireFile(binaryPath, "Bible RPC sidecar");
  const mediaWatcherBinaryStat = requireFile(mediaWatcherBinaryPath, "media watcher sidecar");

  if (context.electronPlatformName !== "win32" && (binaryStat.mode & 0o111) === 0) {
    throw new Error(`Bible RPC sidecar is not executable: ${binaryPath}`);
  }
  if (context.electronPlatformName !== "win32" && (mediaWatcherBinaryStat.mode & 0o111) === 0) {
    throw new Error(`Media watcher sidecar is not executable: ${mediaWatcherBinaryPath}`);
  }

  console.log(
    `[OK] Packaged Bible assets for ${context.electronPlatformName}/${context.arch}: ` +
      `${path.relative(context.appOutDir, bundlePath)} (${bundle.edition}, ${bundle.sources.length} sources), ` +
      `${path.relative(context.appOutDir, cachePath)} (${cacheStat.size} bytes), ` +
      `${path.relative(context.appOutDir, binaryPath)} (${binaryStat.size} bytes), ` +
      `${path.relative(context.appOutDir, mediaWatcherBinaryPath)} (${mediaWatcherBinaryStat.size} bytes)`,
  );
};
