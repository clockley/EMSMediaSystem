import { execFile, spawn } from "node:child_process";

const SCHEMA = "org.gnome.desktop.interface";
const KEY = "color-scheme";

export function parseGnomeColorScheme(value) {
  if (typeof value !== "string") return null;
  const choice = value.trim().match(/^(?:color-scheme:\s*)?'(prefer-dark|prefer-light|default)'$/)?.[1];
  if (choice === "prefer-dark") return "dark";
  if (choice === "prefer-light" || choice === "default") return "light";
  return null;
}

function readGnomeColorScheme() {
  return new Promise((resolve, reject) => {
    execFile("gsettings", ["get", SCHEMA, KEY], {
      encoding: "utf8", timeout: 2000, maxBuffer: 16384, windowsHide: true,
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

function watchGnomeColorScheme() {
  return spawn("gsettings", ["monitor", SCHEMA, KEY], {
    stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
}

/** Keep Chromium media queries/native widgets in sync; never rewrite UI CSS.
 * GNOME's modern preference can differ from GTK's legacy theme, and newer
 * Chromium can miss it when the desktop portal is unavailable. Follow that
 * preference explicitly on GNOME; other desktops/OSes keep Electron's backend.
 */
export async function installSystemAppearance({
  nativeTheme,
  platform = process.platform,
  env = process.env,
  readSetting = readGnomeColorScheme,
  watchSetting = watchGnomeColorScheme,
}) {
  nativeTheme.themeSource = "system";
  const desktop = env.XDG_CURRENT_DESKTOP || env.DESKTOP_SESSION || "";
  if (platform !== "linux" || !desktop.split(":").some((part) => /^(?:gnome|ubuntu)(?:-|$)/i.test(part))) {
    return () => {};
  }

  let disposed = false;
  let unavailable = false;
  let revision = 0;
  let buffer = "";
  let monitor = null;
  const apply = (raw) => {
    const source = parseGnomeColorScheme(raw);
    if (!source || disposed || unavailable) return false;
    revision++;
    if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source;
    return true;
  };
  const failed = () => {
    if (disposed || unavailable) return;
    unavailable = true;
    revision++;
    nativeTheme.themeSource = "system";
  };
  const onData = (chunk) => {
    if (disposed || unavailable) return;
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf("\n")) !== -1) {
      apply(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
    }
    if (buffer.length > 4096) buffer = "";
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    monitor?.stdout?.removeListener("data", onData);
    try { monitor?.kill(); } catch {}
    nativeTheme.themeSource = "system";
  };

  try {
    // Install the subscription first: a change while the initial read is in
    // flight must win over that read's possibly older value.
    monitor = watchSetting();
    monitor.stdout.on("data", onData);
    monitor.once("error", failed);
    monitor.once("close", failed);
    const readRevision = revision;
    const value = await readSetting();
    if (revision === readRevision) apply(value);
  } catch {
    // Missing gsettings/schema/session bus must not prevent application startup.
    // If a valid live update already arrived, a failed initial read cannot undo it.
    if (!revision) {
      dispose();
      return () => {};
    }
  }
  return dispose;
}