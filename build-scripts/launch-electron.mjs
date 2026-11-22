import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { confidenceCaptureLaunchArguments } from "../src/main-process/confidence-capture-runtime.mjs";

const require = createRequire(import.meta.url);
const args = confidenceCaptureLaunchArguments({
  platform: process.platform,
  electronVersion: require("electron/package.json").version,
  args: [".", ...process.argv.slice(2)],
  x11Available: Boolean(process.env.DISPLAY),
});
const child = spawn(require("electron"), args, {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { if (!child.killed) child.kill(signal); });
}
child.once("error", (error) => { console.error(error); process.exitCode = 1; });
child.once("exit", (code, signal) => {
  if (signal) console.error(`EMS Electron terminated by ${signal}`);
  process.exitCode = signal ? 1 : code ?? 1;
});