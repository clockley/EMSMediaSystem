/** Algorithm used for media file content fingerprints. */
export const MEDIA_FILE_HASH_ALG = "xxh3-64";

const XXH3_64_RE = /^[a-f0-9]{16}$/i;
let hashFileImplementation = null;

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

/** Supply the process-local implementation used for on-demand media hashing. */
export function configureMediaFileHasher(hashFile) {
  if (typeof hashFile !== "function") {
    throw new TypeError("Media file hasher must be a function");
  }
  hashFileImplementation = hashFile;
}

/** Hash a local file through the configured XXH3-64 sidecar. */
export async function hashMediaFile(filePath) {
  if (!hashFileImplementation) {
    throw new Error("Media file hasher is not configured");
  }
  const digest = await hashFileImplementation(filePath);
  if (!isValidMediaFileHash(digest)) {
    throw new Error("Media hashing sidecar returned an invalid XXH3-64 digest");
  }
  return digest.toLowerCase();
}
