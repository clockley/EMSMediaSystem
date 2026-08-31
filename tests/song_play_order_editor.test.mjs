import assert from "node:assert/strict";
import test from "node:test";

import {
  insertSongPlayOrderEntry,
  preserveSongQueueNavigationState,
  removeSongPlayOrderEntry,
  reorderSongPlayOrderEntry,
  repeatSongPlayOrderEntry,
  resetSongPlayOrderToSectionOrder,
  setSongPlayOrderEntryEnabled,
  synchronizeSongQueueNavigationState,
  withSongPlayOrder,
} from "../src/shared/song-play-order-editor.mjs";

const original = [
  { id: "verse_first", sectionId: "verse", enabled: true },
  { id: "chorus_first", sectionId: "chorus", enabled: true },
  { id: "chorus_repeat", sectionId: "chorus", enabled: true },
];

test("play-order mutations retain existing entry IDs and create unique repeat IDs", () => {
  const inserted = insertSongPlayOrderEntry(original, "bridge", { index: 1 });
  assert.deepEqual(inserted.map((entry) => entry.id), [
    "verse_first",
    "play_bridge",
    "chorus_first",
    "chorus_repeat",
  ]);

  const repeated = repeatSongPlayOrderEntry(inserted, "chorus_first");
  assert.deepEqual(repeated.map((entry) => entry.id), [
    "verse_first",
    "play_bridge",
    "chorus_first",
    "play_chorus",
    "chorus_repeat",
  ]);
  assert.equal(repeated[3].sectionId, "chorus");

  const reordered = reorderSongPlayOrderEntry(repeated, "chorus_repeat", 0);
  assert.equal(reordered[0].id, "chorus_repeat");
  assert.equal(reordered[3].id, "chorus_first");

  const disabled = setSongPlayOrderEntryEnabled(reordered, "play_bridge", false);
  assert.equal(disabled.find((entry) => entry.id === "play_bridge")?.enabled, false);

  const removed = removeSongPlayOrderEntry(disabled, "play_chorus");
  assert.equal(removed.some((entry) => entry.id === "play_chorus"), false);
  assert.deepEqual(original.map((entry) => entry.id), [
    "verse_first",
    "chorus_first",
    "chorus_repeat",
  ]);
});

test("reset follows canonical section order while reusing stable entry IDs", () => {
  const reset = resetSongPlayOrderToSectionOrder(
    [
      { id: "repeat_chorus", sectionId: "chorus", enabled: false },
      { id: "stable_verse", sectionId: "verse", enabled: true },
      { id: "extra_chorus", sectionId: "chorus", enabled: true },
    ],
    [{ id: "verse" }, { id: "chorus" }, { id: "bridge" }],
  );
  assert.deepEqual(reset, [
    { id: "stable_verse", sectionId: "verse", enabled: true },
    { id: "repeat_chorus", sectionId: "chorus", enabled: true },
    { id: "play_bridge", sectionId: "bridge", enabled: true },
  ]);
});

test("deck play order updates canonical snapshot without losing presentation", () => {
  const deck = {
    playOrder: original,
    canonicalSong: {
      playOrder: original,
      presentation: {
        defaultChunking: { mode: "linesPerSlide", maxLines: 4 },
        manualBreaks: [{ sectionId: "verse", afterBlockId: "line_2" }],
      },
      sections: [{
        id: "verse",
        blocks: [{ id: "line_2", manualBreakAfter: true }],
      }],
    },
  };
  const nextOrder = repeatSongPlayOrderEntry(original, "verse_first", { id: "verse_repeat" });
  const updated = withSongPlayOrder(deck, nextOrder);

  assert.deepEqual(updated.playOrder, updated.canonicalSong.playOrder);
  assert.equal(updated.canonicalSong.playOrder[1].id, "verse_repeat");
  assert.deepEqual(updated.canonicalSong.presentation, deck.canonicalSong.presentation);
  assert.equal(updated.canonicalSong.sections[0].blocks[0].manualBreakAfter, true);
});

test("song queue navigation stays consistent across nested and refreshed copies", () => {
  const nestedOnly = synchronizeSongQueueNavigationState({
    sequence: { entries: original, currentSequenceEntryId: "chorus_repeat" },
    render: { currentSectionId: "chorus", currentSlideId: "chorus_repeat:1" },
  });
  assert.equal(nestedOnly.currentSlideId, "chorus_repeat:1");
  assert.equal(nestedOnly.currentSequenceEntryId, "chorus_repeat");
  assert.equal(nestedOnly.render.currentSequenceEntryId, "chorus_repeat");

  const refreshed = preserveSongQueueNavigationState(
    {
      sequence: { entries: original },
      render: { currentSectionId: "verse" },
      currentSlideId: null,
    },
    nestedOnly,
  );
  assert.equal(refreshed.currentSlideId, "chorus_repeat:1");
  assert.equal(refreshed.currentSequenceEntryId, "chorus_repeat");
  assert.equal(refreshed.sequence.currentSequenceEntryId, "chorus_repeat");
  assert.equal(refreshed.render.currentSequenceEntryId, "chorus_repeat");
  assert.equal(refreshed.render.currentSectionId, "chorus");
});
