"use strict";

const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const path = require("node:path");
const songModels = require("../sidecars/songs-rpc/internal/embedding/assets.json");
const verifyPackagedBibleAssets = require("../scripts/verify-packaged-bible-assets.cjs");
const { installLinuxConfidenceLauncher } = require("./linux-confidence-launcher.cjs");

// Runs once on the shared app directory BEFORE AppImage/DEB/RPM archives.
module.exports = async function afterPack(context) {
  for (const [name, asset] of Object.entries(songModels.files)) {
    const hash = createHash("sha256");
    const file = path.join(context.appOutDir, "resources", "models", name);
    // Including one extra byte detects oversized files while bounding the read.
    for await (const chunk of createReadStream(file, { end: asset.size })) hash.update(chunk);
    if (hash.digest("hex") !== asset.sha256) throw new Error(`Invalid checksum for packaged ${name}`);
  }
  await verifyPackagedBibleAssets(context);
  await installLinuxConfidenceLauncher(context);
};
