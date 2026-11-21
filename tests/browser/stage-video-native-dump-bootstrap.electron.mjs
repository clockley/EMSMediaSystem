/** Diagnostic entry only: initialize offline Crashpad, then import the unchanged built production main. */
import { app, crashReporter } from "electron";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const reportDir = process.env.EMS_NATIVE_DUMP_REPORT;
const profile = process.env.EMS_NATIVE_DUMP_PROFILE;
assert.ok(process.argv.includes("--native-dump"), "Diagnostic bootstrap requires --native-dump");
assert.ok(reportDir && path.isAbsolute(reportDir) && profile && path.isAbsolute(profile), "Owned diagnostic paths required");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert.equal(pkg.name, "emsmediasystem");
assert.equal(pkg.main, "derived/src/main-process/main.min.mjs");
assert.equal(app.isReady(), false, "Crashpad must precede production ready handlers");
process.chdir(root);
app.setAppPath(root);
app.setName(pkg.name);
fs.mkdirSync(profile, { recursive: true });
const dumps = path.join(reportDir, "dumps");
fs.mkdirSync(dumps, { recursive: true });
app.setPath("userData", profile);
app.setPath("crashDumps", dumps);
// Electron v40 docs: submitURL is optional with uploadToServer:false;
// neither productName nor companyName is required. An invalid URL is defense
// in depth only. Never enable uploads or use a symbol server with private dumps.
crashReporter.start({ productName: pkg.name, uploadToServer: false,
  submitURL: "https://invalid.invalid", compress: false,
  globalExtra: { diagnostic: "stage-video-ui-native-dump" } });
assert.equal(crashReporter.getUploadToServer(), false);
const mainURL = pathToFileURL(path.join(root, pkg.main)).href;
const state = { pid: process.pid, appPath: app.getAppPath(), cwd: process.cwd(),
  appName: app.getName(), userData: app.getPath("userData"), crashDumps: app.getPath("crashDumps"),
  uploadToServer: crashReporter.getUploadToServer(), beforeReady: !app.isReady(),
  main: pkg.main, mainURL, productionImportStarted: true, productionImportCompleted: false };
const record = () => fs.writeFileSync(path.join(reportDir, "native-bootstrap.json"), JSON.stringify(state, null, 2));
record();
await import(mainURL);
state.productionImportCompleted = true;
record();