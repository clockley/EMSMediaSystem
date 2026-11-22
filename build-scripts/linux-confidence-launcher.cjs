"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const MARKER = "# EMS native confidence launcher v1";

function shellString(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function launcherScript(executableName) {
  return `#!/bin/sh
${MARKER}
# This wrapper runs BEFORE Electron initializes Chromium's Ozone backend.
# Keep the real executable beside its resources and preserve the caller's cwd.
self=$(readlink -f -- "$0") || exit 1
directory=$(dirname -- "$self") || exit 1
binary="$directory/"${shellString(`${executableName}.bin`)}
if [ ! -x "$binary" ]; then
  printf '%s\\n' "EMS runtime is missing or not executable: $binary" >&2
  exit 1
fi
explicit_platform=0
for argument do
  case "$argument" in
    --ozone-platform|--ozone-platform=*) explicit_platform=1 ;;
  esac
done
if [ -n "\${DISPLAY:-}" ] && [ -z "\${ELECTRON_RUN_AS_NODE:-}" ] && [ "$explicit_platform" -eq 0 ]; then
  exec "$binary" --ozone-platform=x11 "$@"
fi
exec "$binary" "$@"
`;
}

async function installLinuxConfidenceLauncher(context) {
  if (context.electronPlatformName !== "linux") return false;
  const version = context.packager?.info?.framework?.version;
  if (typeof version !== "string" || !/^\d+\./.test(version)) {
    throw new Error("Cannot determine the packaged Electron runtime for Linux confidence capture");
  }
  if (!/^40\./.test(version)) return false;
  const name = context.packager.executableName;
  if (typeof name !== "string" || !name || name === "." || name === ".." || /[/\\\r\n\0]/.test(name)) {
    throw new Error("Invalid Linux executable name for confidence launcher");
  }
  // electron-builder applies configured fuses AFTER afterPack to the original
  // executable path. Fail explicitly rather than trying to fuse a shell script.
  if (context.packager.config?.electronFuses != null) {
    throw new Error("Linux confidence launcher must be installed after Electron fuses are applied");
  }
  const launcher = path.join(context.appOutDir, name);
  const binary = `${launcher}.bin`;
  const stat = await fs.lstat(launcher);
  if (!stat.isFile() || !(stat.mode & 0o111)) throw new Error(`Linux executable is missing or not executable: ${launcher}`);
  const hasBinary = await fs.lstat(binary).then(() => true, (error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  if (hasBinary) {
    const header = await fs.open(launcher, "r");
    let ownLauncher;
    try {
      const bytes = Buffer.alloc(128);
      const { bytesRead } = await header.read(bytes, 0, bytes.length, 0);
      ownLauncher = bytes.subarray(0, bytesRead).toString("utf8").startsWith(`#!/bin/sh\n${MARKER}\n`);
    } finally { await header.close(); }
    const binaryStat = await fs.lstat(binary);
    if (!ownLauncher || !binaryStat.isFile() || !(binaryStat.mode & 0o111)) {
      throw new Error(`Refusing to overwrite an existing runtime: ${binary}`);
    }
  } else {
    await fs.rename(launcher, binary);
  }
  try {
    await fs.writeFile(launcher, launcherScript(name), { mode: 0o755 });
    await fs.chmod(launcher, 0o755);
  } catch (error) {
    if (!hasBinary) {
      await fs.rm(launcher, { force: true });
      await fs.rename(binary, launcher);
    }
    throw error;
  }
  console.log(`[OK] Linux Electron ${version} confidence launcher: ${name} -> ${name}.bin (X11/XWayland when available)`);
  return true;
}

module.exports = { installLinuxConfidenceLauncher, launcherScript };