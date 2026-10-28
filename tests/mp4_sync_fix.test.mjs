import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  Mp4FormatError,
  analyzeMp4SyncSamples,
  analyzeMp4SyncSamplesUncached,
  clearMp4SyncAnalysisCache,
  createStssPatch,
  fileIdentityKey,
  iterateBoxes,
  parseMoovForVideoSyncTable,
} from "../src/main-process/mp4-sync-fix.mjs";
import { applyPatch, box, buildMp4, findBoxOffset, largeBox } from "./fixtures/synthetic-mp4.mjs";

// A YouTube-style GOP structure: IDRs, recovery-point I-frames and P-frames.
const MIXED_KINDS = ["idr", "p", "p", "i", "p", "p", "idr", "p", "i", "p", "i", "p"];
const MIXED_IDR_SAMPLES = [1, 7];

let tmpDir;
test.before(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "ems-mp4-sync-"));
});
test.after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});
test.beforeEach(() => clearMp4SyncAnalysisCache());

let fileCounter = 0;
async function writeMp4(buffer, ext = ".mp4") {
  const filePath = path.join(tmpDir, `clip-${++fileCounter}${ext}`);
  await writeFile(filePath, buffer);
  return filePath;
}

function moovOf(file) {
  const moov = [...iterateBoxes(file, 0, file.length)].find((b) => b.type === "moov");
  return file.subarray(moov.start, moov.end);
}

function readStssEntries(file) {
  return parseMoovForVideoSyncTable(moovOf(file)).syncSamples;
}

test("mixed IDR / recovery-point stss gets a same-length IDR-only patch", async () => {
  const file = buildMp4({ kinds: MIXED_KINDS });
  const filePath = await writeMp4(file);
  const result = await analyzeMp4SyncSamplesUncached(filePath);

  assert.ok(result, "expected a patch");
  assert.equal(result.originalSyncCount, 5);
  assert.equal(result.idrSyncCount, 2);
  assert.equal(result.fileSize, file.length);
  assert.equal(result.stssOffset, findBoxOffset(file, "stss"));
  const originalStssSize = file.readUInt32BE(result.stssOffset);
  assert.equal(result.patchBytes.length, originalStssSize, "patch must not move any byte");

  const patched = applyPatch(file, result.stssOffset, result.patchBytes);
  assert.equal(patched.length, file.length);
  assert.deepEqual(readStssEntries(patched), MIXED_IDR_SAMPLES);
  // Removed entries (3 x 4 bytes) became a `free` box right after the stss.
  const newStssSize = patched.readUInt32BE(result.stssOffset);
  assert.equal(newStssSize, 16 + MIXED_IDR_SAMPLES.length * 4);
  assert.equal(patched.toString("latin1", result.stssOffset + newStssSize + 4, result.stssOffset + newStssSize + 8), "free");
  assert.equal(patched.readUInt32BE(result.stssOffset + newStssSize), 12);
  // Only the stss region differs.
  assert.deepEqual(patched.subarray(0, result.stssOffset), file.subarray(0, result.stssOffset));
  const after = result.stssOffset + result.patchBytes.length;
  assert.deepEqual(patched.subarray(after), file.subarray(after));

  // The repaired file needs nothing further.
  assert.equal(await analyzeMp4SyncSamplesUncached(await writeMp4(patched)), null);
});

test("files whose sync samples are all IDR are served unchanged", async () => {
  const filePath = await writeMp4(buildMp4({ kinds: ["idr", "p", "p", "idr", "p", "idr"] }));
  assert.equal(await analyzeMp4SyncSamplesUncached(filePath), null);
});

test("files with no IDR sync sample at all are left alone", async () => {
  const filePath = await writeMp4(buildMp4({ kinds: ["i", "p", "i", "p"] }));
  assert.equal(await analyzeMp4SyncSamplesUncached(filePath), null);
});

test("files without an stss (every sample is sync) are left alone", async () => {
  const filePath = await writeMp4(buildMp4({ kinds: ["idr", "i", "p"], withoutStss: true }));
  assert.equal(await analyzeMp4SyncSamplesUncached(filePath), null);
});

test("a one-entry removal also drops a later IDR to make a valid free box", async () => {
  const file = buildMp4({ kinds: ["idr", "p", "i", "p", "idr", "p"] });
  const result = await analyzeMp4SyncSamplesUncached(await writeMp4(file));
  assert.ok(result);
  assert.equal(result.originalSyncCount, 3);
  assert.equal(result.idrSyncCount, 1);
  const patched = applyPatch(file, result.stssOffset, result.patchBytes);
  assert.equal(patched.readUInt32BE(result.stssOffset), 20);
  assert.equal(patched.readUInt32BE(result.stssOffset + 12), 1);
  assert.deepEqual(readStssEntries(patched), [1]);
  assert.equal(patched.readUInt32BE(result.stssOffset + 20), 8);
  assert.equal(patched.toString("latin1", result.stssOffset + 24, result.stssOffset + 28), "free");
});

test("a one-entry removal with only one IDR is left unchanged", async () => {
  const filePath = await writeMp4(buildMp4({ kinds: ["idr", "p", "i", "p"] }));
  assert.equal(await analyzeMp4SyncSamplesUncached(filePath), null);
});

test("moov-first, multi-sample chunks and co64 offsets are located correctly", async () => {
  for (const options of [
    { moovFirst: true },
    { samplesPerChunk: 4 },
    { samplesPerChunk: 5 }, // last chunk is partial -> two stsc entries
    { co64: true, samplesPerChunk: 3 },
    { moovFirst: true, co64: true, samplesPerChunk: 2, largeMdat: true },
  ]) {
    const file = buildMp4({ kinds: MIXED_KINDS, ...options });
    const result = await analyzeMp4SyncSamplesUncached(await writeMp4(file));
    assert.ok(result, `expected a patch for ${JSON.stringify(options)}`);
    assert.deepEqual(readStssEntries(applyPatch(file, result.stssOffset, result.patchBytes)), MIXED_IDR_SAMPLES);
  }
});

test("an audio track next to the video track does not prevent the repair", async () => {
  const result = await analyzeMp4SyncSamplesUncached(await writeMp4(buildMp4({ kinds: MIXED_KINDS, withAudioTrack: true })));
  assert.ok(result);
  assert.equal(result.idrSyncCount, 2);
});

test("zero padding after the final video sample-entry child is accepted", async () => {
  const result = await analyzeMp4SyncSamplesUncached(await writeMp4(buildMp4({
    kinds: MIXED_KINDS,
    sampleEntryPadding: 4,
  })));
  assert.ok(result);
  assert.equal(result.idrSyncCount, 2);
});

test("an IDR anywhere in the sample is kept, matching FFmpeg trace_headers", async () => {
  const file = buildMp4({
    kinds: ["mixed-vcl-idr", "p", "i", "p", "idr", "p", "i", "p"],
  });
  const result = await analyzeMp4SyncSamplesUncached(await writeMp4(file));
  assert.ok(result);
  assert.deepEqual(readStssEntries(applyPatch(file, result.stssOffset, result.patchBytes)), [1, 5]);
});

test("the first video track is repaired when additional video tracks exist", async () => {
  const result = await analyzeMp4SyncSamplesUncached(await writeMp4(buildMp4({
    kinds: MIXED_KINDS,
    videoTracks: 2,
  })));
  assert.ok(result);
  assert.equal(result.idrSyncCount, 2);
});

test("unsupported layouts are served unchanged", async (t) => {
  const cases = {
    "fragmented (mvex in moov)": { kinds: MIXED_KINDS, withMvex: true },
    "fragmented (top-level moof)": { kinds: MIXED_KINDS, trailingMoof: true },
    "HEVC (deferred)": { kinds: MIXED_KINDS, codec: "hvc1" },
    "encrypted sample entry": { kinds: MIXED_KINDS, codec: "encv" },
    "multiple sample descriptions": { kinds: MIXED_KINDS, sampleDescriptions: 2 },
    "compact sample sizes": { kinds: MIXED_KINDS, compactSizes: true },
    "extended-size stss": { kinds: MIXED_KINDS, largeStss: true },
  };
  for (const [name, options] of Object.entries(cases)) {
    await t.test(name, async () => {
      assert.equal(await analyzeMp4SyncSamplesUncached(await writeMp4(buildMp4(options))), null);
    });
  }
});

test("avc3 IDRs count by NAL type even without in-band SPS/PPS", async () => {
  const file = buildMp4({
    codec: "avc3",
    kinds: ["idr", "p", "i", "p", "idr-bare", "p", "i", "p", "idr", "p"],
  });
  const result = await analyzeMp4SyncSamplesUncached(await writeMp4(file));
  assert.ok(result);
  assert.deepEqual(readStssEntries(applyPatch(file, result.stssOffset, result.patchBytes)), [1, 5, 9]);
});

test("IDR classification does not depend on re-parsing slice PPS/SPS IDs", async () => {
  const mismatchedConfig = Buffer.from(buildMp4({ kinds: MIXED_KINDS }));
  const avcC = findBoxOffset(mismatchedConfig, "avcC");
  // PPS id 0 now references absent SPS id 1 instead of configured SPS id 0.
  mismatchedConfig[avcC + 26] = 0xa0;
  const configResult = await analyzeMp4SyncSamplesUncached(await writeMp4(mismatchedConfig));
  assert.ok(configResult);
  assert.deepEqual(
    readStssEntries(applyPatch(mismatchedConfig, configResult.stssOffset, configResult.patchBytes)),
    [1, 7],
  );

  const mismatchedSlice = Buffer.from(buildMp4({ kinds: MIXED_KINDS }));
  const firstSamplePayload = findBoxOffset(mismatchedSlice, "mdat") + 8;
  // first_mb=0, slice_type=2, pic_parameter_set_id=1 (only PPS 0 exists).
  mismatchedSlice[firstSamplePayload + 11] = 0xb4;
  const result = await analyzeMp4SyncSamplesUncached(await writeMp4(mismatchedSlice));
  assert.ok(result);
  assert.deepEqual(readStssEntries(applyPatch(mismatchedSlice, result.stssOffset, result.patchBytes)), [1, 7]);
});

test("malformed files raise Mp4FormatError and are reported, not patched", async () => {
  const good = buildMp4({ kinds: MIXED_KINDS });
  const moovOffset = findBoxOffset(good, "moov");

  const truncated = good.subarray(0, good.length - 10);
  await assert.rejects(analyzeMp4SyncSamplesUncached(await writeMp4(truncated)), Mp4FormatError);

  const badSize = Buffer.from(good);
  badSize.writeUInt32BE(4, moovOffset); // smaller than its own header
  await assert.rejects(analyzeMp4SyncSamplesUncached(await writeMp4(badSize)), Mp4FormatError);

  const badNal = Buffer.from(good);
  const firstSample = findBoxOffset(good, "mdat") + 8;
  badNal.writeUInt32BE(0xffffff, firstSample); // NAL length beyond the sample
  await assert.rejects(analyzeMp4SyncSamplesUncached(await writeMp4(badNal)), Mp4FormatError);

  const sampleOutsideMdat = Buffer.from(good);
  const stco = findBoxOffset(sampleOutsideMdat, "stco");
  sampleOutsideMdat.writeUInt32BE(findBoxOffset(sampleOutsideMdat, "mdat"), stco + 16);
  await assert.rejects(
    analyzeMp4SyncSamplesUncached(await writeMp4(sampleOutsideMdat)),
    /sync sample does not lie inside an mdat box/,
  );

  const incompleteAvcConfig = Buffer.from(good);
  const avcC = findBoxOffset(incompleteAvcConfig, "avcC");
  incompleteAvcConfig[avcC + 13] = 0xe0; // zero SPS entries
  await assert.rejects(
    analyzeMp4SyncSamplesUncached(await writeMp4(incompleteAvcConfig)),
    /incomplete decoder configuration/,
  );

  const invalidStsc = Buffer.from(good);
  const stsc = findBoxOffset(invalidStsc, "stsc");
  invalidStsc.writeUInt32BE(2, stsc + 16); // first_chunk must be one
  await assert.rejects(
    analyzeMp4SyncSamplesUncached(await writeMp4(invalidStsc)),
    /does not begin at the first chunk/,
  );

  const filePath = await writeMp4(badSize);
  const errors = [];
  const result = await analyzeMp4SyncSamples(filePath, await stat(filePath), { onError: (e) => errors.push(e) });
  assert.equal(result, null);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof Mp4FormatError);
});

test("non-MP4 garbage is rejected without throwing past the cache", async () => {
  const filePath = await writeMp4(Buffer.from("definitely not an mp4 file"));
  const errors = [];
  assert.equal(await analyzeMp4SyncSamples(filePath, await stat(filePath), { onError: (e) => errors.push(e) }), null);
  assert.equal(errors.length, 1);
});

test("analysis is cached per file identity and de-duplicated", async () => {
  const filePath = await writeMp4(buildMp4({ kinds: MIXED_KINDS }));
  const info = await stat(filePath);
  const first = analyzeMp4SyncSamples(filePath, info);
  const second = analyzeMp4SyncSamples(filePath, info);
  assert.equal(first, second, "concurrent requests share one analysis");
  assert.ok(await first);

  const changed = { ...info, size: info.size, mtimeMs: info.mtimeMs + 1000, ino: info.ino, dev: info.dev };
  assert.notEqual(fileIdentityKey(filePath, changed), fileIdentityKey(filePath, info));
  // A stale stat (mtime differs from the file) never yields a patch.
  assert.equal(await analyzeMp4SyncSamples(filePath, changed), null);

  const replacedIdentity = { ...info, ino: info.ino + 1 };
  assert.notEqual(fileIdentityKey(filePath, replacedIdentity), fileIdentityKey(filePath, info));
  assert.equal(await analyzeMp4SyncSamples(filePath, replacedIdentity), null);
});

test("createStssPatch validates its input and always preserves the box size", () => {
  const original = box("stss", Buffer.from([0, 0, 0, 0]), Buffer.from([0, 0, 0, 4, 0, 0, 0, 1, 0, 0, 0, 5, 0, 0, 0, 9, 0, 0, 0, 13]));
  const twoKept = createStssPatch(original, [1, 9]);
  assert.equal(twoKept.length, original.length);
  assert.equal(twoKept.readUInt32BE(0), 24);
  assert.equal(twoKept.toString("latin1", 28, 32), "free");
  assert.throws(() => createStssPatch(original, [1, 5, 9]), Mp4FormatError);

  assert.throws(() => createStssPatch(original, []), Mp4FormatError);
  assert.throws(() => createStssPatch(original, [5, 1]), Mp4FormatError);
  assert.throws(() => createStssPatch(original, [0]), Mp4FormatError);
  assert.throws(() => createStssPatch(original, [1, 2, 3, 4, 5]), Mp4FormatError);
  assert.throws(() => createStssPatch(box("free", Buffer.alloc(12)), [1]), Mp4FormatError);
  const nonzeroVersion = Buffer.from(original);
  nonzeroVersion[8] = 1;
  assert.throws(() => createStssPatch(nonzeroVersion, [1, 9]), Mp4FormatError);
});

test("iterateBoxes handles 64-bit and to-end sizes and rejects overruns", () => {
  const large = largeBox("mdat", Buffer.alloc(5));
  const toEnd = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from("free", "latin1"), Buffer.alloc(3)]);
  const boxes = [...iterateBoxes(Buffer.concat([large, toEnd]), 0, large.length + toEnd.length)];
  assert.deepEqual(boxes.map((b) => [b.type, b.size, b.headerSize]), [["mdat", 21, 16], ["free", 11, 8]]);

  const overrun = box("moov", Buffer.alloc(4));
  overrun.writeUInt32BE(100, 0);
  assert.throws(() => [...iterateBoxes(overrun, 0, overrun.length)], Mp4FormatError);
  assert.throws(() => [...iterateBoxes(Buffer.alloc(5), 0, 5)], Mp4FormatError);
});
