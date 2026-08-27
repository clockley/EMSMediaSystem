import assert from "node:assert/strict";
import test from "node:test";

import {
  deckToTransientSong,
  normalizeSlideDeck,
  songAstToDeck,
} from "../src/app-slide-utils.mjs";
import {
  normalizeToSongAST,
  reconcileSongPlayOrder,
  songAstToSearchText,
} from "../src/app-song-utils.mjs";

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
