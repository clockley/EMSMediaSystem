import { createReadStream } from "fs";
import { createXXHash3 } from "hash-wasm";

/** Algorithm used for media file content fingerprints. */
export const MEDIA_FILE_HASH_ALG = "xxh3-64";

const XXH3_64_RE = /^[a-f0-9]{16}$/i;

export function isValidMediaFileHash(hex) {
  return typeof hex === "string" && XXH3_64_RE.test(hex);
}

/** Read a stored XXH3 fingerprint from a queue item, asset, or preflight payload. */
export function storedFileHashFromRecord(record) {
  if (!record || typeof record !== "object") return null;
  const alg = record.fileHashAlg;
  const hash =
    typeof record.fileHash === "string" ? record.fileHash.toLowerCase() : "";
  if (alg === MEDIA_FILE_HASH_ALG && isValidMediaFileHash(hash)) {
    return hash;
  }
  return null;
}

export function hasStoredFileHash(record) {
  return storedFileHashFromRecord(record) !== null;
}

export function baselineFileHashFields(digestHex) {
  return {
    fileHash: digestHex,
    fileHashAlg: MEDIA_FILE_HASH_ALG,
  };
}

async function streamHashFile(filePath, onData) {
  const input = createReadStream(filePath);
  input.on("data", onData);
  await new Promise((resolve, reject) => {
    input.on("end", resolve);
    input.on("error", reject);
  });
}

/** Stream-hash a local file with XXH3-64 (fast; suitable for large media). */
export async function hashMediaFile(filePath) {
  const hasher = await createXXHash3(0, 0);
  hasher.init();
  await streamHashFile(filePath, (chunk) => hasher.update(chunk));
  return hasher.digest();
}
