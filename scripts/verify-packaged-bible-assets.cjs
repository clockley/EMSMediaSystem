"use strict";

const fs = require("node:fs");
const path = require("node:path");

const minimumDbBytes = 1024 * 1024;
const xxhashBinaries = {
  linux: {
    x64: "xxhash.linux-x64-gnu.node",
    arm64: "xxhash.linux-arm64-gnu.node",
  },
  win32: {
    x64: "xxhash.win32-x64-msvc.node",
    arm64: "xxhash.win32-arm64-msvc.node",
    ia32: "xxhash.win32-ia32-msvc.node",
  },
};
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
  if (label === "Bible database" && stat.size < minimumDbBytes) {
    throw new Error(`${label} is unexpectedly small (${stat.size} bytes): ${filePath}`);
  }
  return stat;
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

function findPackagedFile(rootDir, fileName) {
  const skipDirs = new Set(["node_modules/.cache"]);
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const rel = path.relative(rootDir, entryPath).replace(/\\/g, "/");
        if (skipDirs.has(rel)) continue;
        stack.push(entryPath);
        continue;
      }
      if (entry.name === fileName) {
        return entryPath;
      }
    }
  }
  return null;
}

function requireXxhashBinding(appOutDir, platform, arch) {
  const archName = archNames[arch] || String(arch || "");
  const platformBinaries = xxhashBinaries[platform];
  if (!platformBinaries) {
    throw new Error(`Unsupported xxhash platform for packaging: ${platform}`);
  }
  const bindingName = platformBinaries[archName];
  if (!bindingName) {
    throw new Error(`Unsupported xxhash architecture for packaging: ${platform}/${archName}`);
  }

  const bindingPath = findPackagedFile(appOutDir, bindingName);
  if (!bindingPath) {
    throw new Error(
      `${bindingName} is missing from packaged app output. ` +
        "Cross-platform builds need supportedArchitectures in .yarnrc.yml " +
        "so Yarn installs real @node-rs/xxhash optional bindings (not mocked stubs).",
    );
  }

  const stat = fs.statSync(bindingPath);
  if (!stat.isFile() || stat.size < 1024) {
    throw new Error(`xxhash native binding is unexpectedly small: ${bindingPath}`);
  }
  return bindingPath;
}

module.exports = async function verifyPackagedBibleAssets(context) {
  const resourcesDir = path.join(context.appOutDir, "resources");
  const legacySidecarDir = path.join(resourcesDir, "sidecar");
  const dbPath = path.join(resourcesDir, "bible", "bible-sqlite.db");
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

  const dbStat = requireFile(dbPath, "Bible database");
  const binaryStat = requireFile(binaryPath, "Bible RPC sidecar");
  const mediaWatcherBinaryStat = requireFile(mediaWatcherBinaryPath, "media watcher sidecar");
  const xxhashBindingPath = requireXxhashBinding(
    context.appOutDir,
    context.electronPlatformName,
    context.arch,
  );

  if (context.electronPlatformName !== "win32" && (binaryStat.mode & 0o111) === 0) {
    throw new Error(`Bible RPC sidecar is not executable: ${binaryPath}`);
  }
  if (context.electronPlatformName !== "win32" && (mediaWatcherBinaryStat.mode & 0o111) === 0) {
    throw new Error(`Media watcher sidecar is not executable: ${mediaWatcherBinaryPath}`);
  }

  console.log(
    `[OK] Packaged Bible assets for ${context.electronPlatformName}/${context.arch}: ` +
      `${path.relative(context.appOutDir, dbPath)} (${dbStat.size} bytes), ` +
      `${path.relative(context.appOutDir, binaryPath)} (${binaryStat.size} bytes), ` +
      `${path.relative(context.appOutDir, mediaWatcherBinaryPath)} (${mediaWatcherBinaryStat.size} bytes), ` +
      `${path.relative(context.appOutDir, xxhashBindingPath)}`,
  );
};
