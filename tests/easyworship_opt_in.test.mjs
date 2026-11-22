import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const main = await readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8");
const handler = main.slice(main.indexOf("let easyWorshipPrompt ="), main.indexOf("async function handleBibleRPC"));

function harness(installed, response, settings = {}, load = () => true) {
  const calls = [];
  const win = { isDestroyed: () => false, webContents: {} };
  const context = vm.createContext({
    win,
    USE_INSTALLED_EASYWORSHIP_KEY: "useInstalledEasyWorshipBibles",
    readSettings: () => settings,
    writeSettings: async (patch) => Object.assign(settings, patch),
    bibleRpcClient: { call: async (method) => {
      calls.push(method);
      if (method === "bible.loadInstalledEasyWorship") return load();
      return installed;
    } },
    handleShowRendererMessageBox: async (event, options) => {
      assert.equal(event.sender, win.webContents);
      assert.deepEqual(Array.from(options.buttons), ["Not Now", "Use Bibles"]);
      assert.equal(options.cancelId, 0);
      calls.push("dialog");
      return { response };
    },
  });
  vm.runInContext(handler, context);
  return { request: () => context.requestInstalledEasyWorshipBibles({ sender: win.webContents }), calls, settings };
}

test("only an affirmative dialog response enables and remembers installed Bibles", async () => {
  const absent = harness(false, 1);
  await absent.request();
  assert.deepEqual(absent.calls, ["bible.hasEasyWorshipInstallation"]);

  const cancelled = harness(true, 0);
  await Promise.all([cancelled.request(), cancelled.request()]);
  await cancelled.request();
  assert.deepEqual(cancelled.calls, ["bible.hasEasyWorshipInstallation", "dialog"]);
  assert.deepEqual(cancelled.settings, {});

  const accepted = harness(true, 1);
  await Promise.all([accepted.request(), accepted.request()]);
  await accepted.request();
  assert.deepEqual(accepted.calls, ["bible.hasEasyWorshipInstallation", "dialog", "bible.loadInstalledEasyWorship"]);
  assert.equal(accepted.settings.useInstalledEasyWorshipBibles, true);

  const restarted = harness(true, 0, accepted.settings);
  await restarted.request();
  assert.deepEqual(restarted.calls, []);
});

test("a second workspace opening waits for the approved catalog and a failed load can be retried", async () => {
  let markStarted, failLoad;
  const started = new Promise(resolve => { markStarted = resolve; });
  const delayedLoad = new Promise((_, reject) => { failLoad = reject; });
  let attempts = 0;
  const h = harness(true, 1, {}, () => {
    if (++attempts === 1) {
      markStarted();
      return delayedLoad;
    }
    return true;
  });
  const first = h.request();
  await started;
  assert.equal(h.settings.useInstalledEasyWorshipBibles, true);
  const second = h.request();
  const failures = Promise.all([first, second].map(request => assert.rejects(request, /interrupted/)));
  failLoad(new Error("interrupted"));
  await failures;
  await h.request();
  await h.request();
  assert.equal(attempts, 2);
  assert.equal(h.calls.filter(call => call === "dialog").length, 1);
});
