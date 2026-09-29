import assert from "node:assert/strict";
import test from "node:test";

import {
  firstPlayableScheduleIndex,
  isEmbeddedScheduleItem,
  isScheduleItemPlayable,
  isScheduleSectionItem,
  isScheduleItemVisible,
  nextPlayableScheduleIndex,
  previousPlayableScheduleIndex,
  reorderScheduleItemsAtInsertion,
  scheduleDropPlacementForTarget,
  scheduleInsertionIndexAfterItem,
  scheduleSectionBlockDropPlacement,
  scheduleSectionEndIndex,
  scheduleSectionIndexForInsertion,
  scheduleSectionIndexForItem,
} from "../src/shared/schedule-item-availability.mjs";

const song = { type: "song", path: "song://1", name: "Song" };
const bible = { type: "bible", path: "bible://KJV:John%203:16", name: "John 3:16" };
const video = { type: "video", path: "/media/video.mp4", name: "Video" };
const missing = { type: "video", path: "/media/gone.mp4", name: "Gone", missing: true };
const section = { type: "section", name: "Scripture Reading" };
const embeddedDeck = {
  type: "deck",
  path: "deck://native-slides",
  name: "Native Slides",
  deckSnapshot: { schema: "ems.slideDeck.v1", pages: [] },
  missing: true,
};

test("disabled Bible UI hides Bible items and leaves other items visible", () => {
  assert.equal(isScheduleItemVisible(bible, { bibleUiEnabled: true }), true);
  assert.equal(isScheduleItemVisible(bible, { bibleUiEnabled: false }), false);
  assert.equal(isScheduleItemVisible(song, { bibleUiEnabled: false }), true);
});

test("schedule advance skips hidden Bible items and missing media", () => {
  const items = [song, section, bible, missing, video];
  assert.equal(isScheduleSectionItem(section), true);
  assert.equal(isScheduleItemVisible(section), true);
  assert.equal(isScheduleItemPlayable(section), false);
  assert.equal(isScheduleItemPlayable(bible, { bibleUiEnabled: false }), false);
  assert.equal(isScheduleItemPlayable(missing, { bibleUiEnabled: false }), false);
  assert.equal(nextPlayableScheduleIndex(items, 0, { bibleUiEnabled: false }), 4);
  assert.equal(firstPlayableScheduleIndex(items, { bibleUiEnabled: false }), 0);
  assert.equal(previousPlayableScheduleIndex(items, 4, { bibleUiEnabled: false }), 0);
});

test("enabled Bible UI still treats Scripture as playable", () => {
  const items = [bible, song];
  assert.equal(nextPlayableScheduleIndex(items, -1, { bibleUiEnabled: true }), 0);
  assert.equal(nextPlayableScheduleIndex(items, 0, { bibleUiEnabled: true }), 1);
});

test("embedded native decks do not depend on their library path", () => {
  assert.equal(isEmbeddedScheduleItem(embeddedDeck), true);
  assert.equal(isScheduleItemPlayable(embeddedDeck), true);
  assert.equal(firstPlayableScheduleIndex([missing, embeddedDeck]), 1);
});

test("section boundaries remain correct with several sections", () => {
  const first = { type: "section", name: "Welcome" };
  const second = { type: "section", name: "Message" };
  const empty = { type: "section", name: "Closing" };
  const items = [song, first, bible, video, second, song, empty];

  assert.equal(scheduleSectionIndexForItem(items, 0), -1);
  assert.equal(scheduleSectionIndexForItem(items, 3), 1);
  assert.equal(scheduleSectionIndexForItem(items, 5), 4);
  assert.equal(scheduleSectionEndIndex(items, 1), 4);
  assert.equal(scheduleSectionEndIndex(items, 4), 6);
  assert.equal(scheduleSectionEndIndex(items, 6), 7);
  assert.equal(scheduleInsertionIndexAfterItem(items, 1), 4);
  assert.equal(scheduleInsertionIndexAfterItem(items, 4), 6);
  assert.equal(scheduleSectionIndexForInsertion(items, 4), 1);
  assert.equal(scheduleSectionIndexForInsertion(items, 6), 4);
  assert.equal(scheduleSectionIndexForInsertion(items, 7), 6);
});

test("dropping on a section targets the end of that exact section", () => {
  const first = { type: "section", name: "Welcome" };
  const second = { type: "section", name: "Message" };
  const empty = { type: "section", name: "Closing" };
  const items = [first, song, bible, second, video, empty];

  assert.deepEqual(scheduleDropPlacementForTarget(items, 0), {
    insertIndex: 3,
    sectionIndex: 0,
    targetIndex: 0,
    kind: "section-end",
  });
  assert.deepEqual(scheduleDropPlacementForTarget(items, 3), {
    insertIndex: 5,
    sectionIndex: 3,
    targetIndex: 3,
    kind: "section-end",
  });
  assert.deepEqual(scheduleDropPlacementForTarget(items, 5), {
    insertIndex: 6,
    sectionIndex: 5,
    targetIndex: 5,
    kind: "section-end",
  });
  assert.equal(scheduleDropPlacementForTarget(items, 4, { afterTarget: false }).insertIndex, 4);
  assert.equal(scheduleDropPlacementForTarget(items, 4, { afterTarget: true }).insertIndex, 5);
});

test("dragging whole sections snaps to section boundaries", () => {
  const first = { type: "section", name: "Welcome" };
  const second = { type: "section", name: "Message" };
  const items = [song, first, bible, second, video];

  assert.deepEqual(scheduleSectionBlockDropPlacement(items, 3), {
    insertIndex: 3,
    sectionIndex: 3,
    targetIndex: 3,
    kind: "before-section",
  });
  assert.deepEqual(scheduleSectionBlockDropPlacement(items, 4, { afterSection: true }), {
    insertIndex: 5,
    sectionIndex: 3,
    targetIndex: 4,
    kind: "after-section",
  });
  assert.equal(scheduleSectionBlockDropPlacement(items, 0).insertIndex, 1);
});

test("queue reordering adjusts insertion boundaries after removals", () => {
  const first = { type: "section", name: "Welcome" };
  const firstA = { type: "song", name: "First A" };
  const firstB = { type: "song", name: "First B" };
  const second = { type: "section", name: "Message" };
  const secondA = { type: "song", name: "Second A" };
  const items = [first, firstA, firstB, second, secondA];

  const toSecondSection = reorderScheduleItemsAtInsertion(items, [1], 5);
  assert.deepEqual(toSecondSection.items, [first, firstB, second, secondA, firstA]);
  assert.equal(toSecondSection.insertIndex, 4);
  assert.equal(toSecondSection.changed, true);

  const wholeFirstSection = reorderScheduleItemsAtInsertion(items, [0, 1, 2], 5);
  assert.deepEqual(wholeFirstSection.items, [second, secondA, first, firstA, firstB]);
  assert.equal(wholeFirstSection.insertIndex, 2);
  assert.equal(wholeFirstSection.changed, true);

  const unchanged = reorderScheduleItemsAtInsertion(items, [1, 2], 3);
  assert.deepEqual(unchanged.items, items);
  assert.equal(unchanged.changed, false);
});
