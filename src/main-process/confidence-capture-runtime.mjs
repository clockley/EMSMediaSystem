/** Check the backend Electron actually initialized; never change Ozone late. */
export function configureConfidenceCaptureRuntime({ platform, electronVersion, commandLine, target = "audience" }) {
  if (platform !== "linux" || !/^40\./.test(electronVersion || "")) return true;
  // X11 is NOT enough for concurrent audience + stage native capture: the
  // real queue/Present/enable-stage VP9 workflow still reproduced SIGILL,
  // including with GPU/zero-copy disabled. Gate BEFORE requesting a source;
  // a JavaScript rejection handler cannot recover from a native browser exit.
  // Only the CONTROL stage thumbnail uses snapshots. The stage itself keeps
  // its local video/PPTX/image/AST rendering, and audience capture stays native.
  if (target === "stage") return false;
  return commandLine.getSwitchValue("ozone-platform") === "x11";
}

/** Run in the Node launcher, BEFORE Electron/Chromium initializes Ozone. */
export function confidenceCaptureLaunchArguments({ platform, electronVersion, args, x11Available }) {
  // Electron 40 native capture reproduced SIGILL on Wayland, even with GPU
  // disabled. X11/XWayland passed the full production workflow with GPU on.
  if (platform === "linux" && /^40\./.test(electronVersion || "") && x11Available &&
      !args.some((arg) => /^--ozone-platform(?:=|$)/.test(arg))) {
    return [...args, "--ozone-platform=x11"];
  }
  return [...args];
}