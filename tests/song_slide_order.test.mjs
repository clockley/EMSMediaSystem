import assert from "node:assert/strict";
import test from "node:test";

import {
  clearTextObjectInlineStyles,
  deckToTransientSong,
  normalizeSlideDeck,
  pageRenderOverrides,
  songAstToDeck,
} from "../src/app-slide-utils.mjs";
import {
  normalizeToSongAST,
  reconcileSongPlayOrder,
  resolvedSongPresentation,
  songAstToSearchText,
} from "../src/app-song-utils.mjs";

test("page background color remains more specific than the deck theme", () => {
  const deck = normalizeSlideDeck({
    schema: "ems.slideDeck.v1",
    id: "background_test",
    title: "Background Test",
    theme: { backgroundColor: "#000000" },
    pages: [{ id: "page_1", background: { type: "color", color: "#7a2048" }, objects: [] }],
  });
  assert.equal(deck.pages[0].background.color, "#7a2048");
  assert.equal(pageRenderOverrides(deck.pages[0], deck).backgroundColor, "#7a2048");
});

test("resetting text to a theme clears word-level formatting", () => {
  const object = {
    kind: "text",
    blocks: [{
      primary: {
        segments: [
          { type: "text", text: "Theme " },
          { type: "text", text: "me", style: { color: "#ff0000", fontWeight: "400" } },
        ],
      },
      translations: [{
        segments: [{ type: "text", text: "Translation", style: { color: "#00ff00" } }],
      }],
    }],
  };
  clearTextObjectInlineStyles(object);
  assert.equal(object.blocks[0].primary.segments[1].style, undefined);
  assert.equal(object.blocks[0].translations[0].segments[0].style, undefined);
});

test("distinct song page backgrounds survive deck and canonical song conversion", () => {
  const deck = normalizeSlideDeck({
    schema: "ems.slideDeck.v1",
    id: "background_round_trip",
    title: "Background Round Trip",
    documentType: "song",
    type: "song",
    pages: [
      { id: "verse_1", label: "Verse 1", background: { type: "color", color: "#7a2048" }, objects: [] },
      { id: "chorus", label: "Chorus", background: { type: "color", color: "#184f78" }, objects: [] },
    ],
  });
  const restored = songAstToDeck(deckToTransientSong(deck));
  assert.deepEqual(restored.pages.map((page) => page.background.color), ["#7a2048", "#184f78"]);
});

test("page background overrides the resolved theme in preview and audience messages", () => {
  const song = deckToTransientSong(normalizeSlideDeck({
    schema: "ems.slideDeck.v1",
    id: "background_render",
    title: "Background Render",
    documentType: "song",
    type: "song",
    pages: [{
      id: "verse_1",
      label: "Verse 1",
      background: { type: "color", color: "#7a2048" },
      objects: [],
    }],
  }));
  const presentation = resolvedSongPresentation({
    songSnapshot: song,
    render: { currentSectionId: "verse_1", backgroundColor: "#000000" },
    resolvedTheme: {
      canvas: { background: { type: "color", color: "#184f78" } },
      typography: {},
    },
  });
  assert.equal(presentation.message.backgroundColor, "#7a2048");
  assert.equal(presentation.message.backgroundPath, "");
});

test("a song editor font override survives resolved theme styling", () => {
  const song = deckToTransientSong(normalizeSlideDeck({
    schema: "ems.slideDeck.v1",
    id: "font_override_render",
    title: "Font Override Render",
    documentType: "song",
    type: "song",
    theme: { fontFamily: "Editor Sans", fontFamilyOverride: true },
    pages: [{ id: "verse_1", label: "Verse 1", objects: [] }],
  }));
  song.defaultRender.fontFamilyOverride = true;
  const presentation = resolvedSongPresentation({
    songSnapshot: song,
    render: {
      currentSectionId: "verse_1",
      fontFamily: "Editor Sans",
      fontFamilyOverride: true,
    },
    resolvedTheme: {
      canvas: { background: { type: "color", color: "#000000" } },
      typography: { fontFamily: "Theme Sans" },
    },
  });
  assert.equal(presentation.message.fontFamily, "Editor Sans");
});

test("song deck conversion preserves repeated stanza play order", () => {
  const song = {
    schema: "ems.song.v1",
    id: "song_order_test",
    title: "Ordered Song",
    metadata: {},
    sections: [
      { id: "verse_1", kind: "verse", label: "Verse 1", blocks: [] },
      { id: "chorus", kind: "chorus", label: "Chorus", blocks: [] },
      { id: "verse_2", kind: "verse", label: "Verse 2", blocks: [] },
    ],
    playOrder: [
      { id: "seq_1", sectionId: "verse_1", enabled: true },
      { id: "seq_2", sectionId: "chorus", enabled: true },
      { id: "seq_3", sectionId: "verse_2", enabled: true },
      { id: "seq_4", sectionId: "chorus", enabled: true },
    ],
  };

  const deck = songAstToDeck(song);
  assert.deepEqual(deck.playOrder.map((entry) => entry.sectionId), [
    "verse_1",
    "chorus",
    "verse_2",
    "chorus",
  ]);

  const roundTripped = deckToTransientSong(normalizeSlideDeck(deck));
  assert.deepEqual(roundTripped.playOrder.map((entry) => entry.sectionId), [
    "verse_1",
    "chorus",
    "verse_2",
    "chorus",
  ]);
  assert.equal(roundTripped.sections.find((section) => section.id === "chorus")?.kind, "chorus");
});

test("canonical song normalization preserves metadata, section numbers, and non-lyric blocks", () => {
  const song = normalizeToSongAST({
    schema: "ems.song.v1",
    id: "song_metadata_test",
    title: "Metadata Song",
    metadata: {
      authors: ["First Writer", "Second Writer"],
      copyright: "Copyright 2026",
      ccliNumber: "1234",
      oneLicense: "A-5678",
      meter: "8.6.8.6",
      hymnal: { name: "Test Hymnal", number: "42", display: "No. 42" },
      tags: ["traditional"],
      extra: { sourceId: "legacy-9" },
    },
    sections: [
      {
        id: "verse_1",
        kind: "verse",
        number: 1,
        label: "Verse 1",
        customSectionValue: true,
        blocks: [
          {
            type: "comment",
            id: "comment_1",
            primary: {
              lang: "en",
              segments: [{ type: "text", text: "Director cue" }],
            },
          },
        ],
      },
    ],
    playOrder: [
      { id: "first", sectionId: "verse_1", enabled: true },
      { id: "repeat", sectionId: "verse_1", enabled: true },
    ],
    import: { sourceType: "legacy" },
  });

  assert.equal(song.sections[0].number, 1);
  assert.equal(song.sections[0].customSectionValue, true);
  assert.equal(song.sections[0].blocks[0].type, "comment");
  assert.equal(song.metadata.hymnal.display, "No. 42");
  assert.deepEqual(song.metadata.tags, ["traditional"]);
  assert.deepEqual(song.metadata.extra, { sourceId: "legacy-9" });
  assert.deepEqual(song.import, { sourceType: "legacy" });
  assert.equal(song.playOrder.length, 2);
});

test("song deck round-trip retains complete editor metadata", () => {
  const song = {
    schema: "ems.song.v1",
    id: "song_editor_metadata",
    title: "Editor Metadata",
    songNumber: 17,
    metadata: {
      authors: ["One", "Two"],
      copyright: "Public Domain",
      ccliNumber: "111",
      oneLicense: "222",
      meter: "7.7.7.7",
      hymnal: { name: "Songs", number: "17", display: "Songs 17" },
      tags: ["hymn"],
      extra: { catalog: "abc" },
    },
    sections: [{ id: "verse", kind: "verse", label: "Verse", blocks: [] }],
    playOrder: [{ id: "play", sectionId: "verse", enabled: true }],
  };

  const deck = songAstToDeck(song);
  assert.equal(deck.canonicalSong.metadata.extra.catalog, "abc");
  const roundTripped = deckToTransientSong(deck);
  assert.equal(roundTripped.songNumber, 17);
  assert.deepEqual(roundTripped.metadata.authors, ["One", "Two"]);
  assert.equal(roundTripped.metadata.oneLicense, "222");
  assert.equal(roundTripped.metadata.hymnal.display, "Songs 17");
  assert.deepEqual(roundTripped.metadata.tags, ["hymn"]);
  assert.deepEqual(roundTripped.metadata.extra.catalog, "abc");
});

test("canonical search text includes complete metadata", () => {
  const text = songAstToSearchText({
    schema: "ems.song.v1",
    id: "search",
    title: "Search",
    metadata: {
      authors: ["Second Author"],
      copyright: "Rare Copyright",
      ccliNumber: "123",
      oneLicense: "A-456",
      hymnal: { name: "Hymnal Name", number: "9", display: "Display Nine" },
    },
    sections: [],
  });
  for (const expected of ["Second Author", "Rare Copyright", "CCLI 123", "OneLicense A-456", "Display Nine"]) {
    assert.match(text, new RegExp(expected));
  }
});

test("editor section changes reconcile play order without removing repeats", () => {
  const original = [
    { id: "one", sectionId: "verse", enabled: true },
    { id: "two", sectionId: "chorus", enabled: true },
    { id: "three", sectionId: "chorus", enabled: false },
    { id: "removed", sectionId: "bridge", enabled: true },
  ];
  const reconciled = reconcileSongPlayOrder(original, [
    { id: "verse" },
    { id: "chorus" },
    { id: "new_tag" },
  ]);
  assert.deepEqual(
    reconciled.map(({ id, sectionId, enabled }) => ({ id, sectionId, enabled })),
    [
      { id: "one", sectionId: "verse", enabled: true },
      { id: "two", sectionId: "chorus", enabled: true },
      { id: "three", sectionId: "chorus", enabled: false },
      { id: "play_new_tag", sectionId: "new_tag", enabled: true },
    ],
  );
});
