const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm, stat, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, net, protocol, session } = require("electron");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// Electron requires this synchronous call before the first asynchronous turn.
protocol.registerSchemesAsPrivileged([{
  scheme: "ems-media",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true,
    bypassCSP: true,
  },
}]);

async function importFromRoot(relativePath) {
  return import(pathToFileURL(path.join(__dirname, "../..", relativePath)).href);
}

async function main() {
  const mediaProtocol = await importFromRoot("src/main-process/media-protocol.mjs");
  await app.whenReady();

  const [{ analyzeMp4SyncSamples }, { applyPatch, buildMp4 }] = await Promise.all([
    importFromRoot("src/main-process/mp4-sync-fix.mjs"),
    importFromRoot("tests/fixtures/synthetic-mp4.mjs"),
  ]);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "ems-media-electron-"));
  try {
    const original = buildMp4({
      kinds: ["idr", "p", "p", "i", "p", "p", "idr", "p", "i", "p"],
    });
    const filePath = path.join(tmpDir, "integration clip.mp4");
    await writeFile(filePath, original);
    const patch = await analyzeMp4SyncSamples(filePath, await stat(filePath));
    assert.ok(patch);
    const expected = applyPatch(original, patch.stssOffset, patch.patchBytes);

    const registry = mediaProtocol.createEmsMediaPathRegistry();
    const handler = mediaProtocol.createEmsMediaProtocolHandler({
      accessToken: registry.accessToken,
      pathForMediaId: registry.pathForId,
      logger: { info() {}, warn() {} },
    });
    await mediaProtocol.installEmsMediaProtocol(session.defaultSession, handler);
    const url = registry.registerPath(filePath);

    const full = await net.fetch(url);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), expected);
    assert.deepEqual(await readFile(filePath), original);

    const start = patch.stssOffset - 4;
    const end = patch.stssOffset + 23;
    const partial = await net.fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), `bytes ${start}-${end}/${original.length}`);
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), expected.subarray(start, end + 1));

    // Optional release-gate run against the real reproduction clip:
    // EMS_MEDIA_TEST_VIDEO=/path/to/video.mp4 yarn test:media-protocol:electron
    const testVideo = process.env.EMS_MEDIA_TEST_VIDEO;
    if (testVideo) {
      const actualPatch = await analyzeMp4SyncSamples(testVideo, await stat(testVideo));
      assert.ok(actualPatch, "the supplied release-gate video must need an stss repair");
      const actualUrl = registry.registerPath(testVideo);
      assert.ok(actualUrl);

      // Prove Electron receives the virtual replacement at the real offset.
      const patchEnd = actualPatch.stssOffset + actualPatch.patchBytes.length - 1;
      const patchedRange = await net.fetch(actualUrl, {
        headers: { Range: `bytes=${actualPatch.stssOffset}-${patchEnd}` },
      });
      assert.equal(patchedRange.status, 206);
      assert.deepEqual(Buffer.from(await patchedRange.arrayBuffer()), actualPatch.patchBytes);

      const win = new BrowserWindow({
        show: false,
        webPreferences: { backgroundThrottling: false },
      });
      try {
        await win.loadFile(path.join(__dirname, "ems-media-seek.html"));
        const outcome = await win.webContents.executeJavaScript(
          `window.runEmsMediaSeekTest(${JSON.stringify(actualUrl)})`,
          true,
        );
        assert.deepEqual(outcome.errors, []);
        assert.equal(outcome.badRounds, 0, JSON.stringify(outcome));
      } finally {
        win.destroy();
      }
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
