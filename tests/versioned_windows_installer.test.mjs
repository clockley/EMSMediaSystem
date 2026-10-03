import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const packageMetadata = require("../package.json");
const installerConfig = require(
  "../build-scripts/versioned-windows-installer.cjs",
);

test("Windows installer identity and visible names include the release version", () => {
  const { version } = packageMetadata;
  const identifierVersion = version.replace(/[^0-9A-Za-z.-]/g, "-");

  assert.equal(
    packageMetadata.build.extends,
    "file:build-scripts/versioned-windows-installer.cjs",
  );
  assert.equal(
    installerConfig.win.appId,
    `com.ejaxmediasystem.app.${identifierVersion}`,
  );
  assert.equal(installerConfig.win.executableName, `EMS Media System ${version}`);
  assert.equal(installerConfig.nsis.shortcutName, `EMS Media System ${version}`);
  assert.equal(
    installerConfig.nsis.uninstallDisplayName,
    `EMS Media System ${version}`,
  );
  assert.equal(
    installerConfig.win.fileAssociations[0].name,
    `EMS.MediaSystem.${identifierVersion}.Project`,
  );
});

test("Windows installer uses a versioned directory without overriding /D", async () => {
  const include = await readFile(
    new URL("../build-scripts/versioned-windows-installer.nsh", import.meta.url),
    "utf8",
  );

  assert.match(include, /!macro customInit/);
  assert.match(include, /!insertmacro GetDParameter/);
  assert.match(include, /\\\$\{PRODUCT_NAME\} \$\{VERSION\}/);
});

test("Windows installer lets users choose an installation directory", () => {
  assert.equal(packageMetadata.build.nsis.oneClick, false);
  assert.equal(packageMetadata.build.nsis.allowToChangeInstallationDirectory, true);
});
