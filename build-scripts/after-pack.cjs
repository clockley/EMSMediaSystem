"use strict";

const verifyPackagedBibleAssets = require("../scripts/verify-packaged-bible-assets.cjs");
const { installLinuxConfidenceLauncher } = require("./linux-confidence-launcher.cjs");

// Runs once on the shared app directory BEFORE AppImage/DEB/RPM archives.
module.exports = async function afterPack(context) {
  await verifyPackagedBibleAssets(context);
  await installLinuxConfidenceLauncher(context);
};