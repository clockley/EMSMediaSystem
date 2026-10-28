/**
 * Builds small synthetic ISO BMFF (MP4) files in memory for the ems-media /
 * stss-repair tests. No FFmpeg: every box is assembled by hand with only the
 * fields the analyzer reads, plus enough structure to look like a real file.
 */

export function box(type, ...payloads) {
  const body = Buffer.concat(payloads.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, body]);
}

/** Box with a 64-bit "largesize" header (size field = 1). */
export function largeBox(type, ...payloads) {
  const body = Buffer.concat(payloads);
  const header = Buffer.alloc(16);
  header.writeUInt32BE(1, 0);
  header.write(type, 4, "latin1");
  header.writeBigUInt64BE(BigInt(16 + body.length), 8);
  return Buffer.concat([header, body]);
}

export function fullBox(type, version, flags, ...payloads) {
  const vf = Buffer.alloc(4);
  vf.writeUInt32BE(((version & 0xff) << 24) | (flags & 0xffffff), 0);
  return box(type, vf, ...payloads);
}

function u32(...values) {
  const out = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => out.writeUInt32BE(v, i * 4));
  return out;
}

function u64(...values) {
  const out = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => out.writeBigUInt64BE(BigInt(v), i * 8));
  return out;
}

/** Length-prefixed (4-byte) NAL units. */
function nalSample(...nals) {
  return Buffer.concat(nals.map((nal) => Buffer.concat([u32(nal.length), nal])));
}

const SPS = Buffer.from([0x67, 0x64, 0x00, 0x28, 0xac, 0xd9]);
const PPS = Buffer.from([0x68, 0xeb, 0xe3, 0xcb]);
const SEI_RECOVERY_POINT = Buffer.from([0x06, 0x06, 0x01, 0xc4, 0x80]);
const AUD = Buffer.from([0x09, 0xf0]);

/**
 * Sample payload for one access unit.
 *   "idr"     IDR slice (avc3: preceded by in-band SPS/PPS unless `bare`)
 *   "idr-bare" IDR slice without parameter sets
 *   "mixed-vcl-idr" non-IDR VCL followed by an IDR VCL in the same sample
 *   "i"       non-IDR I slice with a recovery-point SEI (the problem case)
 *   "p"       non-IDR P slice
 */
export function accessUnit(kind, codec = "avc1", index = 0) {
  const filler = Buffer.alloc(24 + (index % 7), 0x5a);
  switch (kind) {
    case "idr":
      return codec === "avc3"
        ? nalSample(AUD, SPS, PPS, Buffer.concat([Buffer.from([0x65, 0xb8]), filler]))
        : nalSample(AUD, Buffer.concat([Buffer.from([0x65, 0xb8]), filler]));
    case "idr-bare":
      return nalSample(AUD, Buffer.concat([Buffer.from([0x65, 0xb8]), filler]));
    case "mixed-vcl-idr":
      return nalSample(
        AUD,
        Buffer.concat([Buffer.from([0x41, 0xb8]), filler]),
        Buffer.concat([Buffer.from([0x65, 0xb8]), filler]),
      );
    case "i":
      return nalSample(AUD, SEI_RECOVERY_POINT, Buffer.concat([Buffer.from([0x41, 0xb8]), filler]));
    case "p":
      return nalSample(Buffer.concat([Buffer.from([0x41, 0xb8]), filler]));
    default:
      throw new Error(`unknown access unit kind ${kind}`);
  }
}

function hdlr(handlerType) {
  return fullBox("hdlr", 0, 0, u32(0), Buffer.from(handlerType, "latin1"), Buffer.alloc(12), Buffer.from("\0"));
}

function visualSampleEntry(codec, trailingPadding = 0) {
  // 6 reserved + 2 data_reference_index + 70 bytes of VisualSampleEntry fields.
  const fixed = Buffer.alloc(78);
  fixed.writeUInt16BE(1, 6);
  fixed.writeUInt16BE(64, 24); // width
  fixed.writeUInt16BE(36, 26); // height
  if (codec === "hvc1") {
    return box(codec, fixed, box("hvcC", Buffer.alloc(23)));
  }
  // avcC: version/profile/level, 4-byte NAL lengths, one SPS and one PPS.
  const avcC = box(
    "avcC",
    Buffer.from([0x01, 0x64, 0x00, 0x28, 0xff, 0xe1]),
    Buffer.from([0x00, SPS.length]),
    SPS,
    Buffer.from([0x01, 0x00, PPS.length]),
    PPS,
  );
  return box(codec, fixed, avcC, Buffer.alloc(trailingPadding));
}

/**
 * Build a progressive MP4.
 * @param {object} options
 * @param {string[]} options.kinds access-unit kinds per video sample
 * @param {number[]} [options.syncSamples] 1-based stss entries (default: every non-"p" sample)
 * @param {"avc1"|"avc3"|"hvc1"} [options.codec]
 * @param {number} [options.samplesPerChunk]
 * @param {boolean} [options.co64]
 * @param {boolean} [options.moovFirst]
 * @param {boolean} [options.withAudioTrack]
 * @param {number} [options.videoTracks]
 * @param {boolean} [options.withMvex]
 * @param {boolean} [options.withoutStss]
 * @param {boolean} [options.trailingMoof]
 * @param {boolean} [options.largeMdat]
 * @param {boolean} [options.largeStss]
 * @param {number} [options.sampleDescriptions]
 * @param {boolean} [options.compactSizes]
 * @param {number} [options.sampleEntryPadding]
 */
export function buildMp4(options) {
  const {
    kinds,
    codec = "avc1",
    samplesPerChunk = 1,
    co64 = false,
    moovFirst = false,
    withAudioTrack = false,
    videoTracks = 1,
    withMvex = false,
    withoutStss = false,
    trailingMoof = false,
    largeMdat = false,
    largeStss = false,
    sampleDescriptions = 1,
    compactSizes = false,
    sampleEntryPadding = 0,
  } = options;
  const syncSamples = options.syncSamples
    ?? kinds.flatMap((kind, i) => (kind === "p" ? [] : [i + 1]));
  const samples = kinds.map((kind, i) => accessUnit(kind, codec, i));
  const payload = Buffer.concat(samples);
  const ftyp = box("ftyp", Buffer.from("isom", "latin1"), u32(0x200), Buffer.from("isomiso2avc1mp41", "latin1"));

  const chunkCount = Math.ceil(samples.length / samplesPerChunk);
  const relativeChunkOffsets = [];
  let cursor = 0;
  for (let c = 0; c < chunkCount; c++) {
    relativeChunkOffsets.push(cursor);
    for (let s = c * samplesPerChunk; s < Math.min(samples.length, (c + 1) * samplesPerChunk); s++) {
      cursor += samples[s].length;
    }
  }
  const lastChunkSamples = samples.length - (chunkCount - 1) * samplesPerChunk;

  const buildMoov = (payloadBase) => {
    const offsets = relativeChunkOffsets.map((o) => payloadBase + o);
    const stscEntries = lastChunkSamples === samplesPerChunk || chunkCount === 1
      ? [[1, chunkCount === 1 ? lastChunkSamples : samplesPerChunk, 1]]
      : [[1, samplesPerChunk, 1], [chunkCount, lastChunkSamples, 1]];
    const stbl = box(
      "stbl",
      fullBox(
        "stsd",
        0,
        0,
        u32(sampleDescriptions),
        ...Array.from({ length: sampleDescriptions }, () => visualSampleEntry(codec, sampleEntryPadding)),
      ),
      fullBox("stts", 0, 0, u32(1, samples.length, 512)),
      ...(withoutStss
        ? []
        : [largeStss
            ? largeBox("stss", Buffer.alloc(4), u32(syncSamples.length, ...syncSamples))
            : fullBox("stss", 0, 0, u32(syncSamples.length, ...syncSamples))]),
      fullBox("stsc", 0, 0, u32(stscEntries.length, ...stscEntries.flat())),
      ...(compactSizes
        ? [fullBox("stz2", 0, 0, Buffer.from([0, 0, 0, 8]), u32(samples.length), Buffer.alloc(samples.length))]
        : [fullBox("stsz", 0, 0, u32(0, samples.length, ...samples.map((s) => s.length)))]),
      co64
        ? fullBox("co64", 0, 0, u32(offsets.length), u64(...offsets))
        : fullBox("stco", 0, 0, u32(offsets.length, ...offsets)),
    );
    const videoTrak = box(
      "trak",
      fullBox("tkhd", 0, 3, Buffer.alloc(80)),
      box("mdia", fullBox("mdhd", 0, 0, Buffer.alloc(20)), hdlr("vide"), box("minf", stbl)),
    );
    const audioTrak = box(
      "trak",
      fullBox("tkhd", 0, 3, Buffer.alloc(80)),
      box("mdia", fullBox("mdhd", 0, 0, Buffer.alloc(20)), hdlr("soun"), box("minf", box("stbl"))),
    );
    return box(
      "moov",
      fullBox("mvhd", 0, 0, Buffer.alloc(96)),
      ...Array.from({ length: videoTracks }, () => videoTrak),
      ...(withAudioTrack ? [audioTrak] : []),
      ...(withMvex ? [box("mvex", fullBox("trex", 0, 0, Buffer.alloc(20)))] : []),
    );
  };

  const mdatHeaderSize = largeMdat ? 16 : 8;
  const mdat = (largeMdat ? largeBox : box)("mdat", payload);
  const tail = trailingMoof ? [box("moof", fullBox("mfhd", 0, 0, u32(1)))] : [];
  if (moovFirst) {
    const probe = buildMoov(0);
    const moov = buildMoov(ftyp.length + probe.length + mdatHeaderSize);
    return Buffer.concat([ftyp, moov, mdat, ...tail]);
  }
  const moov = buildMoov(ftyp.length + mdatHeaderSize);
  return Buffer.concat([ftyp, mdat, moov, ...tail]);
}

/** Byte offset of the first `type` box header found by scanning for its fourcc. */
export function findBoxOffset(buffer, type) {
  const index = buffer.indexOf(Buffer.from(type, "latin1"));
  return index < 0 ? -1 : index - 4;
}

/** Copy of `file` with `patch` written at `offset` (what ems-media serves). */
export function applyPatch(file, offset, patch) {
  const out = Buffer.from(file);
  patch.copy(out, offset);
  return out;
}
