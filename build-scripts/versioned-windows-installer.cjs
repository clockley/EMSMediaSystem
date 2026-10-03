"use strict";

const { version } = require("../package.json");

if (typeof version !== "string" || version.trim() === "") {
  throw new Error("package.json must contain a version for the Windows installer");
}

// A distinct Windows identity prevents NSIS from treating another release as
// an upgrade and silently uninstalling it. Keep the root appId unchanged for
// non-Windows packages; the stable productName keeps application data shared.
const identifierVersion = version.replace(/[^0-9A-Za-z.-]/g, "-");
const versionedName = `EMS Media System ${version}`;

module.exports = {
  win: {
    appId: `com.ejaxmediasystem.app.${identifierVersion}`,
    executableName: versionedName,
    fileAssociations: [
      {
        ext: "emproj",
        name: `EMS.MediaSystem.${identifierVersion}.Project`,
        description: "EMS Media System Project",
        role: "Editor",
      },
    ],
  },
  nsis: {
    include: "build-scripts/versioned-windows-installer.nsh",
    shortcutName: versionedName,
    uninstallDisplayName: versionedName,
  },
};
