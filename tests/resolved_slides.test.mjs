import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveSongArrangement } from "../src/song-arrangement.mjs";
import { chunkSongSection } from "../src/song-chunking.mjs";
import {
  clearResolvedSongCache,
  resolveSongSlides,
  resolvedSongCacheStats,
} from "../src/song-slides.mjs";
import {
  clearResolvedScriptureCache,
  resolveScriptureSlides,
} from "../src/scripture-slides.mjs";
import {
  renderScriptureForTarget,
  renderSongForTarget,
} from "../src/theme-render-message.mjs";
import {
  resolvedTextBounds,
  themeTextSafeMargins,
  waitForTextFonts,
} from "../src/text-measure.mjs";
import {
  normalizeToSongAST,
  songRenderFromItem,
} from "../src/app-song-utils.mjs";
import {
  deckToTransientSong,
  songAstToDeck,
} from "../src/app-slide-utils.mjs";

const readFixture = async (name) =>
  JSON.parse(
    await readFile(new URL(`fixtures/resolution/${name}`, import.meta.url), "utf8"),
  );

function capacityMeasure(capacity, fontSize = 60) {
  return (text) => {
    const lineCount = String(text).split("\n").length;
    const overflow = Array.from(String(text)).length > capacity;
    return {
      fits: !overflow,
      overflow,
      lineCount,
      resolvedFontSize: fontSize,
    };
  };
}

test("song arrangement retains repeats and identifies occurrences independently", async () => {
  const song = await readFixture("long-song.json");
  song.playOrder.splice(1, 0, { id: "disabled", sectionId: "chorus", enabled: false });
  const arrangement = resolveSongArrangement(song, { includeDisabled: true });
  assert.deepEqual(
    arrangement.entries.map(({ sequenceEntryId, enabled }) => [sequenceEntryId, enabled]),
    [
      ["play_v1", true],
      ["disabled", false],
      ["play_c1", true],
      ["play_c2", true],
    ],
  );
  assert.equal(arrangement.entries[2].occurrenceIndex, 1);
  assert.equal(arrangement.entries[3].occurrenceIndex, 2);

  song.arrangements = [{
    id: "alternate",
    sequence: [{ id: "alternate_only", sectionId: "chorus" }],
  }];
  const explicit = resolveSongArrangement(song, {
    arrangementId: "alternate",
    sequence: song.playOrder,
  });
  assert.equal(explicit.enabledEntries[0].sequenceEntryId, "play_v1");
});

test("canonical normalization generates deterministic fallback IDs", () => {
  const draft = {
    schema: "ems.song.v1",
    id: "draft",
    title: "Draft",
    sections: [{
      kind: "verse",
      label: "Verse",
      blocks: [{ type: "lyricLine", primary: { lang: "en", text: "Line" } }],
    }],
  };
  const first = normalizeToSongAST(draft);
  const second = normalizeToSongAST(draft);
  assert.equal(first.sections[0].id, second.sections[0].id);
  assert.equal(first.sections[0].blocks[0].id, second.sections[0].blocks[0].id);
});

test("manual break inputs survive the deck editor compatibility round-trip", async () => {
  const song = await readFixture("long-song.json");
  song.sections[0].blocks[1].manualBreakAfter = true;
  const roundTrip = deckToTransientSong(songAstToDeck(song));
  assert.equal(roundTrip.sections[0].blocks[1].manualBreakAfter, true);
  assert.deepEqual(roundTrip.presentation.manualBreaks, song.presentation.manualBreaks);
});

test("explicit song deck pages are not chunked a second time for audience output", async () => {
  const song = await readFixture("long-song.json");
  const deckSong = deckToTransientSong(songAstToDeck(song));
  const audience = resolveSongSlides(deckSong, {
    outputRole: "audience",
    outputSize: { width: 1920, height: 1080 },
    measure: capacityMeasure(1000),
  });
  assert.equal(deckSong.presentation.explicitPageBoundaries, true);
  assert.equal(
    audience.slides.filter((slide) => slide.sectionId === "verse_1").length,
    1,
  );

  const lowerThird = resolveSongSlides(deckSong, {
    outputRole: "lowerThird",
    outputSize: { width: 1920, height: 1080 },
    typography: { maxLines: 2 },
    chunking: { mode: "autoFit", avoidOrphans: true, spacerBreaks: true },
    measure: (text) => ({
      fits: true,
      overflow: false,
      lineCount: String(text).split("\n").length,
      resolvedFontSize: 52,
    }),
  });
  assert.equal(
    lowerThird.slides.filter((slide) => slide.sectionId === "verse_1").length,
    3,
  );
});

test("song chunking honors manual breaks and avoids a one-line orphan", async () => {
  const song = await readFixture("long-song.json");
  const verse = song.sections[0];
  const manual = chunkSongSection(song, verse, { measure: capacityMeasure(1000) });
  assert.deepEqual(manual.map((chunk) => chunk.blocks.length), [4, 2]);
  assert.equal(manual[0].manualBreak, true);

  const orphanSong = structuredClone(song);
  orphanSong.presentation.manualBreaks = [];
  orphanSong.presentation.defaultChunking = {
    mode: "linesPerSlide",
    maxLines: 4,
    avoidOrphans: true,
  };
  orphanSong.sections[0].blocks = orphanSong.sections[0].blocks.slice(0, 5);
  const balanced = chunkSongSection(orphanSong, orphanSong.sections[0]);
  assert.deepEqual(balanced.map((chunk) => chunk.blocks.length), [3, 2]);
});

test("song slide IDs are stable while layout keys invalidate for content, theme, and size", async () => {
  clearResolvedSongCache();
  const song = await readFixture("long-song.json");
  const baseOptions = {
    outputSize: { width: 1920, height: 1080 },
    measure: capacityMeasure(500),
  };
  const first = resolveSongSlides(song, baseOptions);
  const second = resolveSongSlides(structuredClone(song), baseOptions);
  assert.deepEqual(first.slides.map((slide) => slide.slideId), [
    "play_v1:0",
    "play_v1:1",
    "play_c1:0",
    "play_c2:0",
  ]);
  assert.equal(first.layoutKey, second.layoutKey);
  const selectedElsewhere = resolveSongSlides(song, {
    ...baseOptions,
    measure: undefined,
    render: {
      fontSize: 60,
      currentSlideId: "play_c2:0",
      currentSequenceEntryId: "play_c2",
    },
  });
  const selectedFirst = resolveSongSlides(song, {
    ...baseOptions,
    measure: undefined,
    render: {
      fontSize: 60,
      currentSlideId: "play_v1:0",
      currentSequenceEntryId: "play_v1",
    },
  });
  assert.equal(selectedElsewhere.layoutKey, selectedFirst.layoutKey);
  assert.ok(resolvedSongCacheStats().entries >= 1);

  const contentChanged = structuredClone(song);
  contentChanged.sections[0].blocks[0].primary.segments[0].text += " changed";
  const changed = resolveSongSlides(contentChanged, baseOptions);
  const themed = resolveSongSlides(song, {
    ...baseOptions,
    resolvedTheme: { themeRevision: "theme_2", resolvedThemeVersion: 1 },
  });
  const resized = resolveSongSlides(song, {
    ...baseOptions,
    outputSize: { width: 1024, height: 768 },
  });
  const marginOverride = resolveSongSlides(song, {
    ...baseOptions,
    safeMargins: { top: 100, right: 100, bottom: 100, left: 100 },
  });
  assert.notEqual(first.layoutKey, changed.layoutKey);
  assert.notEqual(first.layoutKey, themed.layoutKey);
  assert.notEqual(first.layoutKey, resized.layoutKey);
  assert.notEqual(first.layoutKey, marginOverride.layoutKey);
  assert.deepEqual(
    first.slides.map((slide) => slide.slideId),
    changed.slides.map((slide) => slide.slideId),
  );

  const chorusOnly = resolveSongSlides(song, {
    ...baseOptions,
    sequenceEntries: [{ id: "chorus_only", sectionId: "chorus" }],
  });
  const verseOnly = resolveSongSlides(song, {
    ...baseOptions,
    sequenceEntries: [{ id: "verse_only", sectionId: "verse_1" }],
  });
  assert.deepEqual(chorusOnly.slides.map((slide) => slide.slideId), ["chorus_only:0"]);
  assert.deepEqual(verseOnly.slides.map((slide) => slide.slideId), [
    "verse_only:0",
    "verse_only:1",
  ]);

  const domMeasured = resolveSongSlides(song, {
    ...baseOptions,
    measure: undefined,
    measureAt: (_text, fontSize) => ({
      width: 100,
      height: 100,
      lineCount: 1,
      resolvedFontSize: fontSize,
    }),
    measurementMode: "dom",
  });
  assert.notEqual(first.layoutKey, domMeasured.layoutKey);
});

test("resolved song slide objects contain only the active chunk blocks", async () => {
  const song = await readFixture("long-song.json");
  song.sections[0].slideObjects = [{
    id: "verse_text",
    kind: "text",
    blocks: structuredClone(song.sections[0].blocks),
  }];
  const resolved = resolveSongSlides(song, {
    outputSize: { width: 1920, height: 1080 },
    measure: capacityMeasure(500),
  });
  const verseSlides = resolved.slides.filter((slide) => slide.sectionId === "verse_1");
  assert.equal(verseSlides.length, 2);
  for (const slide of verseSlides) {
    assert.deepEqual(
      slide.slideObjects[0].blocks.map((block) => block.id),
      slide.blocks.map((block) => block.id),
    );
  }
  assert.notDeepEqual(
    verseSlides[0].slideObjects[0].blocks.map((block) => block.id),
    verseSlides[1].slideObjects[0].blocks.map((block) => block.id),
  );
});

test("theme text frame participates in bounds and cache identity", async () => {
  const song = await readFixture("long-song.json");
  const wideTheme = {
    themeRevision: "same",
    resolvedThemeVersion: 1,
    canvas: { safeMargins: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 } },
    textFrame: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
  };
  const narrowTheme = {
    ...wideTheme,
    textFrame: { x: 0.3, y: 0.1, width: 0.4, height: 0.8 },
  };
  const wideBounds = resolvedTextBounds(
    { width: 1920, height: 1080 },
    themeTextSafeMargins(wideTheme),
  );
  const narrowBounds = resolvedTextBounds(
    { width: 1920, height: 1080 },
    themeTextSafeMargins(narrowTheme, { width: 1920, height: 1080 }),
  );
  assert.ok(narrowBounds.width < wideBounds.width);
  const paddedBounds = resolvedTextBounds(
    { width: 1920, height: 1080 },
    themeTextSafeMargins(
      {
        ...wideTheme,
        backdrop: { enabled: true, paddingPx: { x: 36, y: 14 } },
      },
      { width: 1920, height: 1080 },
    ),
  );
  assert.equal(paddedBounds.width, wideBounds.width - 72);
  assert.equal(paddedBounds.height, wideBounds.height - 28);
  const wide = resolveSongSlides(song, {
    resolvedTheme: wideTheme,
    measure: capacityMeasure(500),
  });
  const narrow = resolveSongSlides(song, {
    resolvedTheme: narrowTheme,
    measure: capacityMeasure(500),
  });
  assert.notEqual(wide.layoutKey, narrow.layoutKey);
});

test("auto-fit orphan balancing never creates an overflowing chunk", () => {
  const makeBlock = (id, text) => ({
    id,
    type: "lyricLine",
    primary: { lang: "en", segments: [{ type: "text", text }] },
  });
  const section = {
    id: "verse",
    blocks: [
      makeBlock("a", "aaaa"),
      makeBlock("b", "bbbb"),
      makeBlock("c", "cccc"),
      makeBlock("d", "dddd"),
      makeBlock("e", "eeeeeeeeeeeeeeeeee"),
    ],
  };
  const song = {
    presentation: { defaultChunking: { mode: "autoFit", avoidOrphans: true } },
  };
  const chunks = chunkSongSection(song, section, {
    measure: capacityMeasure(22),
  });
  assert.deepEqual(chunks.map((chunk) => chunk.blocks.length), [4, 1]);
  assert.ok(chunks.every((chunk) => chunk.layout.overflow === false));
});

test("lower-third song chunking limits resolved units to two measured lines", () => {
  const blocks = ["one", "two", "three", "four", "five"].map((text, index) => ({
    id: `line_${index}`,
    type: "lyricLine",
    primary: { lang: "en", segments: [{ type: "text", text }] },
  }));
  const chunks = chunkSongSection(
    { presentation: { defaultChunking: { mode: "autoFit" } } },
    { id: "verse", blocks },
    {
      typography: { maxLines: 2 },
      measure: (text) => ({
        fits: true,
        overflow: false,
        lineCount: String(text).split("\n").length,
        resolvedFontSize: 40,
      }),
    },
  );
  assert.deepEqual(chunks.map((chunk) => chunk.blocks.length), [2, 2, 1]);
  assert.ok(chunks.every((chunk) => chunk.layout.lineCount <= 2));
});

test("song queue render normalization preserves lower-third resolution fields", () => {
  const render = songRenderFromItem({
    render: {
      outputRole: "lowerThird",
      outputSize: { width: 1920, height: 1080 },
      maxLines: 2,
      lineHeight: 1.18,
    },
  });
  assert.equal(render.outputRole, "lowerThird");
  assert.deepEqual(render.outputSize, { width: 1920, height: 1080 });
  assert.equal(render.maxLines, 2);
  assert.equal(render.lineHeight, 1.18);
});

test("Scripture prefers verse boundaries and splits an oversized verse by words", async () => {
  clearResolvedScriptureCache();
  const entry = await readFixture("long-scripture.json");
  const presentation = resolveScriptureSlides(entry, {
    outputSize: { width: 1280, height: 720 },
    measure: capacityMeasure(58),
  });
  assert.ok(presentation.slides.length > entry.verseRows.length);
  assert.ok(presentation.slides.every((slide) => slide.layout.overflow === false));
  assert.doesNotMatch(presentation.slides[0].bodyText, /^1\.\s+/u);
  assert.equal(presentation.slides[0].referenceText, "John 1:1 KJV");
  assert.ok(
    presentation.slides
      .filter((slide) => slide.intraVerse)
      .every((slide) => !/^\d+\.\s*$/u.test(slide.bodyText)),
  );
});

test("lower-third Scripture units use at most two lines and normalize attribution objects", () => {
  const presentation = resolveScriptureSlides(
    {
      version: "TEST",
      book: "Test",
      chapter: 1,
      verse: 1,
      text: "one two three four five six seven eight",
      attribution: { shortText: "Test attribution", text: "Long attribution" },
    },
    {
      cache: false,
      typography: { maxLines: 2 },
      measure: (text) => ({
        fits: true,
        overflow: false,
        lineCount: Math.ceil(String(text).length / 12),
        resolvedFontSize: 40,
      }),
    },
  );
  assert.ok(presentation.slides.length > 1);
  assert.ok(presentation.slides.every((slide) => slide.layout.lineCount <= 2));
  assert.ok(presentation.slides.every((slide) => slide.attributionText === "Test attribution"));
});

test("Scripture autoSplit false preserves one overflowing unit", async () => {
  const entry = await readFixture("long-scripture.json");
  entry.autoSplit = false;
  const presentation = resolveScriptureSlides(entry, {
    measure: capacityMeasure(20),
    cache: false,
  });
  assert.equal(presentation.slides.length, 1);
  assert.equal(presentation.slides[0].layout.overflow, true);
  const forcedLowerThird = resolveScriptureSlides(entry, {
    measure: capacityMeasure(20),
    cache: false,
    forceAutoSplit: true,
  });
  assert.ok(forcedLowerThird.slides.length > 1);
  assert.ok(forcedLowerThird.slides.every((slide) => slide.layout.overflow === false));
});

test("Scripture direct geometry overrides invalidate the resolved cache", async () => {
  const entry = await readFixture("long-scripture.json");
  const base = resolveScriptureSlides(entry, {
    measure: capacityMeasure(500),
  });
  const overridden = resolveScriptureSlides(entry, {
    measure: capacityMeasure(500),
    safeMargins: { top: 100, right: 100, bottom: 100, left: 100 },
    referenceReserve: 200,
  });
  assert.notEqual(base.layoutKey, overridden.layoutKey);
});

test("Scripture navigation state does not invalidate resolved layout", async () => {
  const entry = await readFixture("long-scripture.json");
  const first = resolveScriptureSlides({
    ...entry,
    currentSlideId: "audience:0",
    currentLowerThirdSlideId: "lower:0",
    lowerThirdSegmentIndex: 0,
  }, {
    measure: capacityMeasure(500),
  });
  const navigated = resolveScriptureSlides({
    ...entry,
    currentSlideId: "audience:4",
    currentLowerThirdSlideId: "lower:3",
    lowerThirdSegmentIndex: 3,
  }, {
    measure: capacityMeasure(500),
  });
  assert.equal(first.layoutKey, navigated.layoutKey);
});

test("an oversized unbroken Scripture word splits at grapheme boundaries in any position", () => {
  const presentation = resolveScriptureSlides({
    version: "TEST",
    book: "Test",
    chapter: 1,
    verse: 1,
    text: "short Supercalifragilisticexpialidocious",
    autoSplit: true,
  }, {
    cache: false,
    measure: capacityMeasure(12),
  });
  assert.ok(presentation.slides.length > 1);
  assert.ok(presentation.slides.every((slide) => slide.layout.overflow === false));
  assert.doesNotMatch(presentation.slides[0].bodyText, /^1\.\s+/u);
});

test("normalize mode applies one group font size", async () => {
  const entry = await readFixture("long-scripture.json");
  entry.autosizeMode = "normalize";
  const presentation = resolveScriptureSlides(entry, {
    cache: false,
    measure: (text) => ({
      fits: true,
      overflow: false,
      lineCount: 1,
      resolvedFontSize: text.length > 70 ? 42 : 60,
    }),
  });
  const sizes = new Set(
    presentation.slides.map((slide) => slide.layout.resolvedFontSize),
  );
  assert.equal(sizes.size, 1);
});

test("Unicode and RTL text remains unchanged through resolution", () => {
  const entry = {
    id: "rtl",
    version: "AR",
    book: "المزامير",
    chapter: 1,
    verse: 1,
    reference: "المزامير 1:1",
    text: "طُوبَى لِلرَّجُلِ الَّذِي لَمْ يَسْلُكْ",
    direction: "rtl",
  };
  const resolved = resolveScriptureSlides(entry, {
    cache: false,
    measure: capacityMeasure(500),
  });
  assert.match(resolved.slides[0].bodyText, /طُوبَى/u);
});

test("preview, thumbnail, and audience messages share the selected stable unit", async () => {
  const song = await readFixture("long-song.json");
  const target = {
    outputRole: "audience",
    outputSize: { width: 1920, height: 1080 },
    measure: capacityMeasure(500),
    activeSlideId: "play_v1:1",
  };
  const preview = renderSongForTarget(song, target);
  const audience = renderSongForTarget(song, target);
  assert.equal(preview.message.slideId, "play_v1:1");
  assert.equal(preview.message.slideId, audience.message.slideId);
  assert.equal(preview.presentation.layoutKey, audience.presentation.layoutKey);
  assert.equal(
    preview.presentation.slides.find((slide) => slide.slideId === preview.message.slideId).slideId,
    audience.activeUnit.slideId,
  );

  const scripture = await readFixture("long-scripture.json");
  const scripturePreview = renderScriptureForTarget(scripture, {
    ...target,
    activeSlideId: null,
  });
  const lowerThird = renderScriptureForTarget(scripture, {
    ...target,
    activeSlideId: scripturePreview.activeUnit.slideId,
  });
  assert.equal(scripturePreview.activeUnit.slideId, lowerThird.activeUnit.slideId);
});

test("browser font gate awaits requested fonts and readiness", async () => {
  const calls = [];
  let readyResolved = false;
  const documentRef = {
    fonts: {
      load: async (descriptor, sample) => calls.push([descriptor, sample]),
      ready: Promise.resolve().then(() => {
        readyResolved = true;
      }),
    },
  };
  await waitForTextFonts(["Inter", "Inter", "Noto Sans Arabic"], {
    documentRef,
    sample: "مرحبا",
    fontSize: 72,
  });
  assert.deepEqual(calls.map(([descriptor]) => descriptor), [
    "72px Inter",
    "72px Noto Sans Arabic",
  ]);
  assert.equal(readyResolved, true);
});

test("golden target matrix remains deterministic and non-overflowing", async () => {
  const entry = await readFixture("long-scripture.json");
  const sizes = [
    [1280, 720],
    [1920, 1080],
    [1024, 768],
    [2560, 1080],
    [1080, 1920],
  ];
  for (const [width, height] of sizes) {
    const options = {
      outputSize: { width, height },
      measure: capacityMeasure(Math.max(36, Math.round((width * height) / 18000))),
      cache: false,
    };
    const first = resolveScriptureSlides(entry, options);
    const second = resolveScriptureSlides(entry, options);
    assert.deepEqual(first, second);
    assert.ok(first.slides.every((slide) => slide.layout.overflow === false));
  }
});
