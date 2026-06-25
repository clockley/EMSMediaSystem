"use strict";

const fs = require("node:fs");
const path = require("node:path");

const XXHASH_BINDING_RE = /^xxhash\.(.+)\.node$/;
const PARCEL_WATCHER_BINDING = "watcher.node";
const PARCEL_WATCHER_MIN_BYTES = 1024;

function listDirs(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function findStoreRoot(projectRoot) {
  const candidates = [
    path.join(projectRoot, "node_modules", ".store"),
    path.join(projectRoot, "node_modules", ".pnpm"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function archNameFromBuilderArch(arch) {
  const archNames = {
    0: "ia32",
    1: "x64",
    2: "armv7l",
    3: "arm64",
    4: "universal",
  };
  return archNames[arch] || String(arch || process.arch);
}

function isRealNativeFile(filePath, minBytes = 1024) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size >= minBytes;
  } catch {
    return false;
  }
}

function findPackageDirByName(storeRoot, packageName, requiredFile) {
  for (const packageDir of packageDirs(storeRoot)) {
    const manifest = readJson(path.join(packageDir, "package.json"));
    if (!manifest || manifest.name !== packageName || manifest.mocked) continue;
    if (requiredFile && !isRealNativeFile(path.join(packageDir, requiredFile))) continue;
    return packageDir;
  }
  return null;
}

function packageDirs(storeRoot) {
  const dirs = [];
  for (const entry of listDirs(storeRoot)) {
    if (!entry.isDirectory()) continue;
    const packageDir = path.join(storeRoot, entry.name, "package");
    if (fs.existsSync(packageDir)) dirs.push(packageDir);
  }
  return dirs;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function inferBindingMetadata(bindingName) {
  const match = bindingName.match(XXHASH_BINDING_RE);
  if (!match) return null;

  const platformKey = match[1];
  const metadata = {
    main: bindingName,
    os: [],
    cpu: [],
    libc: [],
  };

  if (platformKey.startsWith("linux-")) {
    metadata.os.push("linux");
    if (platformKey.endsWith("-gnu")) {
      metadata.libc.push("glibc");
    } else if (platformKey.includes("musl")) {
      metadata.libc.push("musl");
    }
  } else if (platformKey.startsWith("win32-")) {
    metadata.os.push("win32");
  } else if (platformKey.startsWith("darwin-")) {
    metadata.os.push("darwin");
  } else if (platformKey.startsWith("freebsd-")) {
    metadata.os.push("freebsd");
  } else if (platformKey.startsWith("android-")) {
    metadata.os.push("android");
  }

  if (platformKey.includes("arm64")) {
    metadata.cpu.push("arm64");
  } else if (platformKey.includes("x64") || platformKey.includes("x64-msvc")) {
    metadata.cpu.push("x64");
  } else if (platformKey.includes("ia32")) {
    metadata.cpu.push("ia32");
  } else if (platformKey.includes("arm-eabi") || platformKey.includes("gnueabihf")) {
    metadata.cpu.push("arm");
  }

  for (const field of ["os", "cpu", "libc"]) {
    if (metadata[field].length === 0) delete metadata[field];
  }

  return metadata;
}

function fixMockedPlatformPackage(packageDir) {
  const packageJsonPath = path.join(packageDir, "package.json");
  const manifest = readJson(packageJsonPath);
  if (!manifest || !manifest.mocked) return null;

  const bindingName = listDirs(packageDir)
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .find((name) => XXHASH_BINDING_RE.test(name));
  if (!bindingName) return null;

  const metadata = inferBindingMetadata(bindingName);
  if (!metadata) return null;

  const nextManifest = {
    name: manifest.name,
    version: manifest.version || "1.7.6",
    main: metadata.main,
  };
  if (metadata.os) nextManifest.os = metadata.os;
  if (metadata.cpu) nextManifest.cpu = metadata.cpu;
  if (metadata.libc) nextManifest.libc = metadata.libc;

  fs.writeFileSync(packageJsonPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
  return bindingName;
}

function copyBindingIntoMainPackage(projectRoot, bindingName) {
  const storeRoot = findStoreRoot(projectRoot);
  if (!storeRoot) return null;

  let sourcePath = null;
  for (const packageDir of packageDirs(storeRoot)) {
    const candidate = path.join(packageDir, bindingName);
    if (fs.existsSync(candidate)) {
      sourcePath = candidate;
      break;
    }
  }
  if (!sourcePath) return null;

  const mainPackageDir = path.join(projectRoot, "node_modules", "@node-rs", "xxhash");
  let resolvedMainDir = mainPackageDir;
  try {
    resolvedMainDir = fs.realpathSync(mainPackageDir);
  } catch {
    return null;
  }

  const targetPath = path.join(resolvedMainDir, bindingName);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
}

function copyPackageDir(sourceDir, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    dereference: true,
    force: true,
    verbatimSymlinks: false,
  });
}

function copyParcelWatcherPackageIntoMainPackage(projectRoot, packageName) {
  const storeRoot = findStoreRoot(projectRoot);
  if (!storeRoot) return null;

  const sourceDir = findPackageDirByName(storeRoot, packageName, PARCEL_WATCHER_BINDING);
  if (!sourceDir) {
    throw new Error(
      `${packageName} with a real ${PARCEL_WATCHER_BINDING} was not found. ` +
        "Run yarn install with supportedArchitectures including the target OS/CPU/libc.",
    );
  }

  const mainPackageDir = path.join(projectRoot, "node_modules", "@parcel", "watcher");
  let resolvedMainDir = mainPackageDir;
  try {
    resolvedMainDir = fs.realpathSync(mainPackageDir);
  } catch (err) {
    throw new Error(`Could not resolve @parcel/watcher package: ${err?.message || err}`);
  }

  const packageBaseName = packageName.split("/").pop();
  const targetDir = path.join(resolvedMainDir, "node_modules", "@parcel", packageBaseName);
  copyPackageDir(sourceDir, targetDir);
  return path.join(targetDir, PARCEL_WATCHER_BINDING);
}

function resolveBindingName(platform, arch) {
  const archName = archNameFromBuilderArch(arch);
  const bindings = {
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
  return bindings[platform]?.[archName] || null;
}

function resolveParcelWatcherPackageName(platform, arch) {
  const archName = archNameFromBuilderArch(arch);
  const packages = {
    linux: {
      x64: "@parcel/watcher-linux-x64-glibc",
      arm64: "@parcel/watcher-linux-arm64-glibc",
    },
    win32: {
      x64: "@parcel/watcher-win32-x64",
      arm64: "@parcel/watcher-win32-arm64",
      ia32: "@parcel/watcher-win32-ia32",
    },
  };
  return packages[platform]?.[archName] || null;
}

function fixCrossPlatformNativeBindings(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const storeRoot = findStoreRoot(projectRoot);
  if (!storeRoot) return [];

  const fixed = [];
  for (const packageDir of packageDirs(storeRoot)) {
    const bindingName = fixMockedPlatformPackage(packageDir);
    if (bindingName) fixed.push(bindingName);
  }

  const targetBinding = options.targetBinding || null;
  if (targetBinding) {
    const copiedTo = copyBindingIntoMainPackage(projectRoot, targetBinding);
    if (copiedTo) fixed.push(copiedTo);
  }

  const targetParcelWatcherPackage = options.targetParcelWatcherPackage || null;
  if (targetParcelWatcherPackage) {
    const copiedTo = copyParcelWatcherPackageIntoMainPackage(
      projectRoot,
      targetParcelWatcherPackage,
    );
    if (copiedTo) fixed.push(copiedTo);
  }

  return fixed;
}

async function prepareNativeBindings(context = {}) {
  const projectRoot = context.appDir || process.cwd();
  const platform = context.electronPlatformName || process.platform;
  const arch = context.electronPlatformName != null ? context.arch : process.arch;
  const bindingName =
    context.electronPlatformName != null ? resolveBindingName(platform, arch) : null;
  const parcelWatcherPackage = resolveParcelWatcherPackageName(platform, arch);
  const fixed = fixCrossPlatformNativeBindings({
    projectRoot,
    targetBinding: bindingName,
    targetParcelWatcherPackage: parcelWatcherPackage,
  });

  if (fixed.length > 0) {
    const label =
      context.electronPlatformName != null
        ? `${context.electronPlatformName}/${context.arch}`
        : "install";
    console.log(`[OK] Prepared native bindings for ${label}: ${fixed.join(", ")}`);
  }
}

module.exports = prepareNativeBindings;

if (require.main === module) {
  prepareNativeBindings().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
