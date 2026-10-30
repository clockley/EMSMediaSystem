/*
Copyright (C) 2026 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

/**
 * Lossless, virtual MP4 sync-sample (`stss`) repair for Chromium seeking.
 *
 * Some H.264 MP4s (notably YouTube downloads) advertise non-IDR I-frames that
 * carry a recovery-point SEI as sync samples. Chromium >= 134 (Electron >= 35)
 * seeks to the nearest preceding sync sample, and when that sample is not an
 * IDR the following P/B frames can reference pictures from before it. The
 * FFmpeg decoder then raises a fatal PIPELINE_ERROR_DECODE and the <video>
 * element freezes for good.
 *
 * `analyzeMp4SyncSamples()` parses the ISO BMFF box tree directly (no FFmpeg
 * process), inspects the NAL units of every advertised sync sample and, when
 * some of them are not IDR access units, returns a same-length replacement for
 * the original `stss` box that lists only the verified IDR samples. The bytes
 * freed by the removed entries become a `free` box, so no other atom, chunk
 * offset or media payload moves. The original file is never modified; callers
 * overlay `patchBytes` at `stssOffset` while streaming the file.
 *
 * Anything unexpected (fragmented or encrypted files, non-H.264 video, several
 * sample descriptions, malformed boxes, ...) yields `null`, i.e. "serve the
 * original bytes unchanged".
 */

import { open } from "node:fs/promises";

/** Refuse to buffer absurd `moov` boxes (2 h feature films are ~10–40 MiB). */
const MAX_MOOV_BYTES = 192 * 1024 * 1024;
/** Upper bound on top-level boxes walked before giving up. */
const MAX_TOP_LEVEL_BOXES = 100_000;
/** Defensive ceiling; ordinary access units contain only a handful of NALs. */
const MAX_NALS_PER_SAMPLE = 1_000_000;
/** Bytes read up front from each sync sample; SEI + slice header fit easily. */
const SAMPLE_PROBE_BYTES = 4096;
/** Cached analyses kept (keyed by path plus the complete fs.Stat identity). */
const CACHE_LIMIT = 64;

const H264_SAMPLE_ENTRIES = new Set(["avc1", "avc3"]);
const NAL_TYPE_IDR_SLICE = 5;
const NAL_TYPE_SPS = 7;
const NAL_TYPE_PPS = 8;

export class Mp4FormatError extends Error {
  constructor(message) {
    super(message);
    this.name = "Mp4FormatError";
  }
}

function fail(message) {
  throw new Mp4FormatError(message);
}

// ---------------------------------------------------------------------------
// Box parsing helpers (in-memory buffer)
// ---------------------------------------------------------------------------

/**
 * Iterate the boxes contained in `buf[start, end)`.
 * @returns {Generator<{type: string, start: number, size: number, headerSize: number, bodyStart: number, end: number}>}
 */
export function* iterateBoxes(buf, start, end) {
  let offset = start;
  while (offset < end) {
    if (offset + 8 > end) fail(`truncated box header at ${offset}`);
    let size = buf.readUInt32BE(offset);
    const type = buf.toString("latin1", offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) fail(`truncated large box header at ${offset}`);
      const large = buf.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) fail(`box ${type} too large`);
      size = Number(large);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) {
      fail(`box ${type} at ${offset} has invalid size ${size}`);
    }
    yield { type, start: offset, size, headerSize, bodyStart: offset + headerSize, end: offset + size };
    offset += size;
  }
}

function findChild(buf, parent, type) {
  for (const box of iterateBoxes(buf, parent.bodyStart, parent.end)) {
    if (box.type === type) return box;
  }
  return null;
}

function findUniqueChild(buf, parent, type) {
  let found = null;
  for (const box of iterateBoxes(buf, parent.bodyStart, parent.end)) {
    if (box.type !== type) continue;
    if (found) fail(`${parent.type} contains multiple ${type} boxes`);
    found = box;
  }
  return found;
}

function findChildren(buf, parent, type) {
  const out = [];
  for (const box of iterateBoxes(buf, parent.bodyStart, parent.end)) {
    if (box.type === type) out.push(box);
  }
  return out;
}

/**
 * VisualSampleEntry children are boxes, but MOV/MP4 writers in the wild may
 * leave up to seven zero padding bytes after the final child. A normal box
 * walker quite correctly rejects those bytes as a truncated header, so handle
 * this sample-entry-specific convention here.
 */
function* iterateSampleEntryChildren(buf, start, end) {
  let offset = start;
  while (offset + 8 <= end) {
    const { value: child } = iterateBoxes(buf, offset, end).next();
    yield child;
    offset = child.end;
  }
  if (offset < end && !buf.subarray(offset, end).every((value) => value === 0)) {
    fail(`non-zero trailing bytes in video sample entry at ${offset}`);
  }
}

function requireBodyBytes(box, needed) {
  if (box.end - box.bodyStart < needed) fail(`${box.type} box is truncated`);
}

function requireZeroFullBoxHeader(buf, box) {
  requireBodyBytes(box, 4);
  if (buf.readUInt32BE(box.bodyStart) !== 0) fail(`${box.type} has unsupported version or flags`);
}

/** Read a full box's entry table header: [version/flags (4)] [entry_count (4)]. */
function fullBoxEntryCount(buf, box, entrySize) {
  requireBodyBytes(box, 8);
  requireZeroFullBoxHeader(buf, box);
  const count = buf.readUInt32BE(box.bodyStart + 4);
  if (box.bodyStart + 8 + count * entrySize > box.end) {
    fail(`${box.type} entry table exceeds its box`);
  }
  return count;
}

// ---------------------------------------------------------------------------
// Track / sample-table parsing
// ---------------------------------------------------------------------------

function parseHandlerType(buf, hdlr) {
  requireBodyBytes(hdlr, 12);
  return buf.toString("latin1", hdlr.bodyStart + 8, hdlr.bodyStart + 12);
}

/**
 * Parse `stsd` and return the single H.264 sample entry's NAL length size, or
 * null when the track is not a plain (unencrypted) single-description H.264
 * track.
 */
function parseH264SampleDescription(buf, stsd) {
  requireBodyBytes(stsd, 8);
  requireZeroFullBoxHeader(buf, stsd);
  const count = buf.readUInt32BE(stsd.bodyStart + 4);
  if (count !== 1) return null;
  const entries = [...iterateBoxes(buf, stsd.bodyStart + 8, stsd.end)];
  if (entries.length !== 1) fail("stsd entry count does not match its contents");
  const entry = entries[0];
  if (!H264_SAMPLE_ENTRIES.has(entry.type)) return null;
  // VisualSampleEntry fixed fields are 78 bytes after the box header.
  const childrenStart = entry.bodyStart + 78;
  if (childrenStart > entry.end) fail(`${entry.type} sample entry is truncated`);
  let avcC = null;
  for (const child of iterateSampleEntryChildren(buf, childrenStart, entry.end)) {
    if (child.type === "avcC") {
      if (avcC) fail(`${entry.type} sample entry has multiple avcC boxes`);
      avcC = child;
    }
  }
  if (!avcC) fail("H.264 sample entry has no avcC");
  requireBodyBytes(avcC, 5);
  if (buf.readUInt8(avcC.bodyStart) !== 1) fail("unsupported avcC version");
  const nalLengthSize = (buf.readUInt8(avcC.bodyStart + 4) & 0x03) + 1;
  if (nalLengthSize === 3) fail("invalid avcC NAL length size");
  const parameterSets = validateAvcCParameterSets(buf, avcC);
  if (entry.type === "avc1" && (parameterSets.spsCount === 0 || parameterSets.ppsCount === 0)) {
    fail("avc1 sample entry has incomplete decoder configuration");
  }
  return { codec: entry.type, nalLengthSize };
}

function validateAvcCParameterSets(buf, avcC) {
  requireBodyBytes(avcC, 7);
  let cursor = avcC.bodyStart + 6;
  const end = avcC.end;
  const spsCount = buf.readUInt8(avcC.bodyStart + 5) & 0x1f;
  for (let i = 0; i < spsCount; i++) {
    if (cursor + 2 > end) fail("avcC SPS length is truncated");
    const length = buf.readUInt16BE(cursor);
    cursor += 2;
    if (length === 0 || cursor + length > end) fail("avcC SPS is truncated");
    const nal = buf.subarray(cursor, cursor + length);
    if ((nal[0] & 0x1f) !== NAL_TYPE_SPS) fail("avcC contains an invalid SPS");
    cursor += length;
  }
  if (cursor + 1 > end) fail("avcC PPS count is truncated");
  const ppsCount = buf.readUInt8(cursor++);
  for (let i = 0; i < ppsCount; i++) {
    if (cursor + 2 > end) fail("avcC PPS length is truncated");
    const length = buf.readUInt16BE(cursor);
    cursor += 2;
    if (length === 0 || cursor + length > end) fail("avcC PPS is truncated");
    const nal = buf.subarray(cursor, cursor + length);
    if ((nal[0] & 0x1f) !== NAL_TYPE_PPS) fail("avcC contains an invalid PPS");
    cursor += length;
  }
  return { spsCount, ppsCount };
}

function parseStsz(buf, stsz) {
  requireBodyBytes(stsz, 12);
  requireZeroFullBoxHeader(buf, stsz);
  const fixedSize = buf.readUInt32BE(stsz.bodyStart + 4);
  const count = buf.readUInt32BE(stsz.bodyStart + 8);
  if (fixedSize === 0 && stsz.bodyStart + 12 + count * 4 > stsz.end) {
    fail("stsz table exceeds its box");
  }
  const tableStart = stsz.bodyStart + 12;
  return {
    count,
    sizeOf: fixedSize !== 0
      ? () => fixedSize
      : (sampleNumber) => buf.readUInt32BE(tableStart + (sampleNumber - 1) * 4),
  };
}

function parseStsc(buf, stsc) {
  const count = fullBoxEntryCount(buf, stsc, 12);
  const entries = new Array(count);
  let previousFirstChunk = 0;
  for (let i = 0; i < count; i++) {
    const base = stsc.bodyStart + 8 + i * 12;
    const firstChunk = buf.readUInt32BE(base);
    const samplesPerChunk = buf.readUInt32BE(base + 4);
    const sampleDescriptionIndex = buf.readUInt32BE(base + 8);
    if (firstChunk <= previousFirstChunk) fail("stsc first_chunk values are not increasing");
    if (samplesPerChunk === 0) fail("stsc samples_per_chunk must be positive");
    if (sampleDescriptionIndex !== 1) fail("stsc references an unsupported sample description");
    previousFirstChunk = firstChunk;
    entries[i] = { firstChunk, samplesPerChunk, sampleDescriptionIndex };
  }
  return entries;
}

function parseChunkOffsets(buf, stbl) {
  const stco = findUniqueChild(buf, stbl, "stco");
  const co64 = findUniqueChild(buf, stbl, "co64");
  if (stco && co64) fail("sample table contains both stco and co64");
  if (stco) {
    const count = fullBoxEntryCount(buf, stco, 4);
    const base = stco.bodyStart + 8;
    return { count, offsetOf: (index) => buf.readUInt32BE(base + index * 4) };
  }
  if (co64) {
    const count = fullBoxEntryCount(buf, co64, 8);
    const base = co64.bodyStart + 8;
    return {
      count,
      offsetOf: (index) => {
        const value = buf.readBigUInt64BE(base + index * 8);
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("co64 offset too large");
        return Number(value);
      },
    };
  }
  fail("sample table has no chunk offsets");
}

function validateSampleToChunkTable(stscEntries, chunkCount, sampleCount) {
  if (stscEntries.length === 0) fail("stsc has no entries");
  if (stscEntries[0].firstChunk !== 1) fail("stsc does not begin at the first chunk");
  let describedSamples = 0n;
  for (let i = 0; i < stscEntries.length; i++) {
    const entry = stscEntries[i];
    const nextFirstChunk = i + 1 < stscEntries.length
      ? stscEntries[i + 1].firstChunk
      : chunkCount + 1;
    if (entry.firstChunk > chunkCount || nextFirstChunk > chunkCount + 1) {
      fail("stsc references a missing chunk");
    }
    describedSamples += BigInt(nextFirstChunk - entry.firstChunk) * BigInt(entry.samplesPerChunk);
  }
  if (describedSamples !== BigInt(sampleCount)) {
    fail("stsc chunk layout does not match stsz sample count");
  }
}

/**
 * Resolve the file offset and size of each requested sample.
 * @param {number[]} wanted strictly increasing 1-based sample numbers
 */
function locateSamples(wanted, stscEntries, chunkOffsets, sampleSizes) {
  validateSampleToChunkTable(stscEntries, chunkOffsets.count, sampleSizes.count);
  const located = [];
  let want = 0;
  let sampleNumber = 1;
  for (let e = 0; e < stscEntries.length && want < wanted.length; e++) {
    const { firstChunk, samplesPerChunk } = stscEntries[e];
    const nextFirstChunk = e + 1 < stscEntries.length
      ? stscEntries[e + 1].firstChunk
      : chunkOffsets.count + 1;
    for (let chunk = firstChunk; chunk < nextFirstChunk && want < wanted.length; chunk++) {
      if (chunk > chunkOffsets.count) fail("stsc references a missing chunk");
      const lastInChunk = sampleNumber + samplesPerChunk - 1;
      if (wanted[want] > lastInChunk) {
        sampleNumber += samplesPerChunk;
        continue;
      }
      let offset = chunkOffsets.offsetOf(chunk - 1);
      for (let i = 0; i < samplesPerChunk && want < wanted.length; i++, sampleNumber++) {
        if (sampleNumber > sampleSizes.count) fail("stsc describes more samples than stsz");
        const size = sampleSizes.sizeOf(sampleNumber);
        if (sampleNumber === wanted[want]) {
          located.push({ sampleNumber, offset, size });
          want++;
        }
        offset += size;
      }
      // Skip the remainder of the chunk without summing sizes.
      sampleNumber = lastInChunk + 1;
    }
  }
  if (want !== wanted.length) fail("could not locate every sync sample");
  return located;
}

// ---------------------------------------------------------------------------
// H.264 access-unit inspection
// ---------------------------------------------------------------------------

async function readExactly(fh, position, length) {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await fh.read(buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return filled === length ? buffer : buffer.subarray(0, filled);
}

/**
 * Return whether one length-prefixed H.264 sample contains an IDR NAL.
 *
 * This intentionally matches FFmpeg's `trace_headers` rule used by the proven
 * physical-rewrite script: a packet is retained when *any* NAL in it has
 * nal_unit_type 5. In particular, do not stop at the first VCL NAL and do not
 * reject an IDR because a second, partial slice-header parser cannot prove its
 * PPS/SPS chain.
 * @returns {Promise<boolean>}
 */
export async function inspectH264Sample(fh, sample, nalLengthSize) {
  const probeLength = Math.min(sample.size, SAMPLE_PROBE_BYTES);
  const probe = await readExactly(fh, sample.offset, probeLength);
  let cursor = 0;
  let nalCount = 0;
  while (cursor < sample.size) {
    if (++nalCount > MAX_NALS_PER_SAMPLE) {
      fail(`too many NAL units in sample ${sample.sampleNumber}`);
    }
    if (cursor + nalLengthSize + 1 > sample.size) {
      fail(`truncated NAL header in sample ${sample.sampleNumber}`);
    }
    let header;
    if (cursor + nalLengthSize + 1 <= probe.length) {
      header = probe.subarray(cursor, cursor + nalLengthSize + 1);
    } else {
      header = await readExactly(fh, sample.offset + cursor, nalLengthSize + 1);
      if (header.length < nalLengthSize + 1) fail("sample truncated");
    }
    let nalLength = 0;
    for (let i = 0; i < nalLengthSize; i++) nalLength = nalLength * 256 + header[i];
    if (nalLength === 0 || cursor + nalLengthSize + nalLength > sample.size) {
      fail(`invalid NAL length in sample ${sample.sampleNumber}`);
    }
    const nalHeader = header[nalLengthSize];
    if (nalHeader & 0x80) fail(`forbidden_zero_bit set in sample ${sample.sampleNumber}`);
    const nalType = nalHeader & 0x1f;
    if (nalType === NAL_TYPE_IDR_SLICE) return true;
    cursor += nalLengthSize + nalLength;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Patch construction
// ---------------------------------------------------------------------------

/**
 * Build a replacement for an `stss` box of `originalBoxSize` bytes that lists
 * only `keptSamples`. The result has exactly `originalBoxSize` bytes:
 *   - a shrunk `stss` followed by a valid `free` box covering the removed
 *     entries, or
 *   - an unchanged-size `stss` when there is no spare space.
 * Tiny trailing padding is deliberately rejected: conventional `stss` syntax
 * has no padding field, and a `free` box must be at least eight bytes.
 * @param {Buffer} originalBox the complete original box (32-bit header)
 * @param {number[]} keptSamples strictly increasing 1-based sample numbers
 */
export function createStssPatch(originalBox, keptSamples) {
  const originalBoxSize = originalBox.length;
  if (originalBoxSize < 16 || originalBox.toString("latin1", 4, 8) !== "stss") {
    fail("not an stss box");
  }
  if (originalBox.readUInt32BE(0) !== originalBoxSize) fail("only 32-bit stss boxes are supported");
  if (originalBox.readUInt32BE(8) !== 0) fail("stss has unsupported version or flags");
  const originalCount = originalBox.readUInt32BE(12);
  if (originalBoxSize !== 16 + originalCount * 4) fail("stss is not a conventional entry table");
  if (keptSamples.length === 0) fail("no sync samples would remain");
  for (let i = 0; i < keptSamples.length; i++) {
    const n = keptSamples[i];
    if (!Number.isInteger(n) || n < 1 || n > 0xffffffff || (i > 0 && n <= keptSamples[i - 1])) {
      fail("invalid sync sample number");
    }
  }
  const tableSize = 16 + keptSamples.length * 4;
  const spare = originalBoxSize - tableSize;
  if (spare < 0 || (spare > 0 && spare < 8)) fail("replacement leaves no room for a valid free box");
  const out = Buffer.alloc(originalBoxSize);
  const stssSize = spare > 0 ? tableSize : originalBoxSize;
  out.writeUInt32BE(stssSize, 0);
  out.write("stss", 4, "latin1");
  // Conventional stss is a version-0 full box with zero flags.
  out.writeUInt32BE(keptSamples.length, 12);
  keptSamples.forEach((n, i) => out.writeUInt32BE(n, 16 + i * 4));
  if (spare > 0) {
    out.writeUInt32BE(spare, tableSize);
    out.write("free", tableSize + 4, "latin1");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Top-level analysis
// ---------------------------------------------------------------------------

async function findTopLevelMoov(fh, fileSize) {
  const header = Buffer.alloc(16);
  let offset = 0;
  let moov = null;
  const mdats = [];
  for (let i = 0; offset + 8 <= fileSize; i++) {
    if (i >= MAX_TOP_LEVEL_BOXES) fail("too many top-level boxes");
    const { bytesRead } = await fh.read(header, 0, 16, offset);
    if (bytesRead < 8) fail("truncated top-level box header");
    let size = header.readUInt32BE(0);
    const type = header.toString("latin1", 4, 8);
    let headerSize = 8;
    if (size === 1) {
      if (bytesRead < 16) fail("truncated top-level large box header");
      const large = header.readBigUInt64BE(8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) fail("top-level box too large");
      size = Number(large);
      headerSize = 16;
    } else if (size === 0) {
      size = fileSize - offset;
    }
    if (size < headerSize || offset + size > fileSize) fail(`top-level ${type} has invalid size`);
    // Fragmented MP4: sync information lives in trun/tfhd, not in stss.
    if (type === "moof") return { fragmented: true };
    if (type === "moov") {
      if (moov) fail("multiple moov boxes");
      moov = { offset, size };
    }
    if (type === "mdat") mdats.push({ start: offset + headerSize, end: offset + size });
    offset += size;
  }
  if (offset !== fileSize) fail("trailing bytes do not form a complete top-level box");
  return moov ? { moov, mdats } : null;
}

function sampleIsInsideMdat(sample, mdats) {
  const sampleEnd = sample.offset + sample.size;
  return mdats.some((mdat) => sample.offset >= mdat.start && sampleEnd <= mdat.end);
}

/**
 * Pure function over an in-memory `moov` buffer: find the first H.264 video
 * track and return its sample-table pieces, or null if unsupported.
 */
export function parseMoovForVideoSyncTable(moovBuf) {
  const [moov] = [...iterateBoxes(moovBuf, 0, moovBuf.length)];
  if (!moov || moov.type !== "moov") fail("buffer does not start with moov");
  if (findChild(moovBuf, moov, "mvex")) return null; // fragmented
  const videoTracks = [];
  for (const trak of findChildren(moovBuf, moov, "trak")) {
    const mdia = findUniqueChild(moovBuf, trak, "mdia");
    const hdlr = mdia && findUniqueChild(moovBuf, mdia, "hdlr");
    if (!hdlr || parseHandlerType(moovBuf, hdlr) !== "vide") continue;
    videoTracks.push({ trak, mdia });
  }
  if (videoTracks.length === 0) return null;
  const { mdia } = videoTracks[0];
  const minf = findUniqueChild(moovBuf, mdia, "minf");
  const stbl = minf && findUniqueChild(moovBuf, minf, "stbl");
  if (!stbl) fail("video track has no stbl");
  const stsd = findUniqueChild(moovBuf, stbl, "stsd");
  if (!stsd) fail("video track has no stsd");
  const description = parseH264SampleDescription(moovBuf, stsd);
  if (!description) return null;
  const stss = findUniqueChild(moovBuf, stbl, "stss");
  if (!stss) return null; // every sample is a sync sample
  if (stss.headerSize !== 8) return null;
  const syncCount = fullBoxEntryCount(moovBuf, stss, 4);
  if (stss.size !== 16 + syncCount * 4) fail("stss is not a conventional entry table");
  const syncSamples = new Array(syncCount);
  for (let i = 0; i < syncCount; i++) {
    syncSamples[i] = moovBuf.readUInt32BE(stss.bodyStart + 8 + i * 4);
    if (syncSamples[i] < 1 || (i > 0 && syncSamples[i] <= syncSamples[i - 1])) {
      fail("stss entries are not strictly increasing");
    }
  }
  if (findUniqueChild(moovBuf, stbl, "stz2")) return null;
  const stsz = findUniqueChild(moovBuf, stbl, "stsz");
  const stsc = findUniqueChild(moovBuf, stbl, "stsc");
  if (!stsz || !stsc) fail("video sample table is incomplete");
  const sampleSizes = parseStsz(moovBuf, stsz);
  if (syncSamples.length && syncSamples[syncSamples.length - 1] > sampleSizes.count) {
    fail("stss references a sample beyond stsz");
  }
  return {
    description,
    stss,
    syncSamples,
    sampleSizes,
    stscEntries: parseStsc(moovBuf, stsc),
    chunkOffsets: parseChunkOffsets(moovBuf, stbl),
  };
}

/**
 * Analyse `filePath` and describe the virtual `stss` patch it needs.
 *
 * @returns {Promise<null | {
 *   filePath: string, fileSize: number, mtimeMs: number, ctimeMs: number, ino: number, dev: number,
 *   stssOffset: number, patchBytes: Buffer,
 *   originalSyncCount: number, idrSyncCount: number,
 * }>} null when the file needs (or supports) no patch.
 */
export async function analyzeMp4SyncSamplesUncached(filePath) {
  const fh = await open(filePath, "r");
  try {
    const stat = await fh.stat();
    if (!stat.isFile()) return null;
    const fileSize = stat.size;
    const top = await findTopLevelMoov(fh, fileSize);
    if (!top || top.fragmented) return null;
    const { moov, mdats } = top;
    if (moov.size > MAX_MOOV_BYTES) return null;
    const moovBuf = await readExactly(fh, moov.offset, moov.size);
    if (moovBuf.length !== moov.size) fail("moov truncated");
    const table = parseMoovForVideoSyncTable(moovBuf);
    if (!table) return null;
    const { description, stss, syncSamples } = table;

    const located = locateSamples(syncSamples, table.stscEntries, table.chunkOffsets, table.sampleSizes);
    const kept = [];
    for (const sample of located) {
      if (sample.offset + sample.size > fileSize) fail("sync sample lies beyond end of file");
      if (!sampleIsInsideMdat(sample, mdats)) fail("sync sample does not lie inside an mdat box");
      if (await inspectH264Sample(fh, sample, description.nalLengthSize)) {
        kept.push(sample.sampleNumber);
      }
    }
    if (kept.length === syncSamples.length || kept.length === 0) return null;

    // Removing one 4-byte entry leaves too little room for a valid free box.
    // Conservatively remove one additional later IDR when possible; preserving
    // the first IDR keeps startup behavior intact. With only one IDR, decline
    // the patch rather than emit nonstandard padding inside stss.
    if (syncSamples.length - kept.length === 1) {
      if (kept.length < 2) return null;
      kept.pop();
    }

    const originalBox = moovBuf.subarray(stss.start, stss.end);
    const patchBytes = createStssPatch(originalBox, kept);
    return {
      filePath,
      fileSize,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      ino: stat.ino,
      dev: stat.dev,
      stssOffset: moov.offset + stss.start,
      patchBytes,
      originalSyncCount: syncSamples.length,
      idrSyncCount: kept.length,
    };
  } finally {
    await fh.close();
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** Identity key that changes whenever the file is replaced or rewritten. */
export function fileIdentityKey(filePath, stat) {
  return `${filePath}\0${stat.size}\0${stat.mtimeMs}\0${stat.ctimeMs}\0${stat.ino}\0${stat.dev}`;
}

/** Compare all stable identity fields available from fs.Stat. */
export function fileIdentityMatches(stat, identity) {
  if (!stat || !identity) return false;
  const expectedSize = identity.fileSize ?? identity.size;
  return stat.size === expectedSize
    && stat.mtimeMs === identity.mtimeMs
    && stat.ctimeMs === identity.ctimeMs
    && stat.ino === identity.ino
    && stat.dev === identity.dev;
}

const analysisCache = new Map();

/**
 * Cached + de-duplicated {@link analyzeMp4SyncSamplesUncached}. Errors are
 * reported to `onError` and cached as "no patch" for that file identity.
 */
export function analyzeMp4SyncSamples(filePath, stat, { onError } = {}) {
  const key = fileIdentityKey(filePath, stat);
  let entry = analysisCache.get(key);
  if (entry) {
    analysisCache.delete(key);
    analysisCache.set(key, entry); // LRU refresh
    return entry;
  }
  entry = analyzeMp4SyncSamplesUncached(filePath).then(
    (result) => {
      // Drop results whose file changed while we were reading it.
      if (result && !fileIdentityMatches(stat, result)) {
        analysisCache.delete(key);
        return null;
      }
      return result;
    },
    (error) => {
      if (typeof onError === "function") onError(error);
      return null;
    },
  );
  analysisCache.set(key, entry);
  while (analysisCache.size > CACHE_LIMIT) {
    analysisCache.delete(analysisCache.keys().next().value);
  }
  return entry;
}

export function clearMp4SyncAnalysisCache() {
  analysisCache.clear();
}
