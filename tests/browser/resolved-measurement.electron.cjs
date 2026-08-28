const assert = require("node:assert/strict");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

async function main() {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });
  await window.loadFile(path.join(__dirname, "resolved-measurement.html"));
  const deadline = Date.now() + 20_000;
  let result = null;
  while (!result && Date.now() < deadline) {
    result = await window.webContents.executeJavaScript(
      "window.__emsResolvedMeasurementResult || null",
    );
    if (!result) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(result, "browser measurement timed out");
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(
    result.results.map(({ width, height }) => [width, height]),
    [
      [1280, 720],
      [1920, 1080],
      [1440, 900],
      [1024, 768],
      [2560, 1080],
      [1080, 1920],
    ],
  );
  for (const target of result.results) {
    assert.ok(target.slideIds.length > 0);
    assert.ok(target.layouts.every((layout) => layout.overflow === false));
  }
  await window.close();
}

main()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
