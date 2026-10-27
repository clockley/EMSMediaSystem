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
  scheduleSectionIndexesForItems,
  synchronizeScheduleGroupMembership,
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
  assert.deepEqual(scheduleSectionIndexesForItems(items), [-1, 1, 1, 1, 4, 4, 6]);
  assert.equal(scheduleSectionEndIndex(items, 1), 4);
  assert.equal(scheduleSectionEndIndex(items, 4), 6);
  assert.equal(scheduleSectionEndIndex(items, 6), 7);
  assert.equal(scheduleInsertionIndexAfterItem(items, 1), 4);
  assert.equal(scheduleInsertionIndexAfterItem(items, 4), 6);
  assert.equal(scheduleSectionIndexForInsertion(items, 4), 1);
  assert.equal(scheduleSectionIndexForInsertion(items, 6), 4);
  assert.equal(scheduleSectionIndexForInsertion(items, 7), 6);
});

test("legacy positional sections migrate to explicit group ids", () => {
  const first = { id: "group-welcome", type: "section", name: "Welcome" };
  const second = { id: "group-message", type: "section", name: "Message" };
  const firstCue = { ...song };
  const secondCue = { ...video };
  const items = [{ ...bible }, first, firstCue, second, secondCue];

  assert.equal(firstCue.groupId, undefined);
  synchronizeScheduleGroupMembership(items, { preserveExisting: true });
  assert.equal(items[0].groupId, null);
  assert.equal(firstCue.groupId, first.id);
  assert.equal(secondCue.groupId, second.id);
});

test("explicit group ids identify membership independently of cue position", () => {
  const first = { id: "group-welcome", type: "section", name: "Welcome" };
  const second = { id: "group-message", type: "section", name: "Message" };
  const cue = { ...song, groupId: second.id };
  const items = [first, cue, second];

  assert.equal(scheduleSectionIndexForItem(items, 1), 2);
  assert.deepEqual(scheduleSectionIndexesForItems(items), [0, 2, 2]);
  synchronizeScheduleGroupMembership(items, { preserveExisting: true });
  assert.equal(cue.groupId, second.id);
  synchronizeScheduleGroupMembership(items);
  assert.equal(cue.groupId, first.id);
  assert.equal(scheduleSectionIndexForItem(items, 1), 0);
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
  assert.equal(scheduleSectionBlockDropPlacement(items, 0).insertIndex, 0);
  assert.equal(
    scheduleSectionBlockDropPlacement(items, 0, { afterTarget: true }).insertIndex,
    1,
  );
});

test("explicit top-level cues remain outside a preceding section", () => {
  const first = { id: "group-welcome", type: "section", name: "Welcome" };
  const groupedCue = { ...song, groupId: first.id };
  const topLevelCue = { ...video, groupId: null };
  const second = { id: "group-message", type: "section", name: "Message" };
  const items = [first, groupedCue, topLevelCue, second];

  assert.deepEqual(scheduleSectionIndexesForItems(items), [0, 0, -1, 3]);
  assert.equal(scheduleSectionEndIndex(items, 0), 2);
  assert.equal(scheduleSectionIndexForInsertion(items, 3), -1);
  synchronizeScheduleGroupMembership(items, { preserveExisting: true });
  assert.equal(topLevelCue.groupId, null);
});

test("a cue can be dropped before a section as a top-level item", () => {
  const first = { id: "group-welcome", type: "section", name: "Welcome" };
  const items = [first, { ...song, groupId: first.id }];

  assert.deepEqual(
    scheduleDropPlacementForTarget(items, 0, {
      afterTarget: false,
      allowBeforeSection: true,
    }),
    {
      insertIndex: 0,
      sectionIndex: -1,
      targetIndex: 0,
      kind: "before-section",
    },
  );
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

test("whole service groups can move above or below adjacent sections", () => {
  const first = { id: "group-first", type: "section", name: "First" };
  const firstCue = { type: "song", name: "First Cue", groupId: first.id };
  const empty = { id: "group-empty", type: "section", name: "Empty" };
  const last = { id: "group-last", type: "section", name: "Last" };
  const lastCue = { type: "song", name: "Last Cue", groupId: last.id };
  const items = [first, firstCue, empty, last, lastCue];

  const membership = scheduleSectionIndexesForItems(items);
  const firstGroupIndexes = membership
    .map((sectionIndex, index) => sectionIndex === 0 ? index : -1)
    .filter((index) => index >= 0);
  const afterLast = scheduleSectionBlockDropPlacement(items, 4, {
    afterSection: true,
  });
  const movedDown = reorderScheduleItemsAtInsertion(
    items,
    firstGroupIndexes,
    afterLast.insertIndex,
  );
  assert.deepEqual(movedDown.items, [empty, last, lastCue, first, firstCue]);

  const emptyIndex = movedDown.items.indexOf(empty);
  const lastIndex = movedDown.items.indexOf(last);
  const movedEmptyDown = reorderScheduleItemsAtInsertion(
    movedDown.items,
    [emptyIndex],
    scheduleSectionBlockDropPlacement(movedDown.items, lastIndex, {
      afterSection: true,
    }).insertIndex,
  );
  assert.deepEqual(movedEmptyDown.items, [last, lastCue, empty, first, firstCue]);
});

test("whole service groups can move across top-level cues", () => {
  const rootCue = { type: "song", name: "Prelude", groupId: null };
  const service = { id: "group-service", type: "section", name: "Service" };
  const serviceCue = { type: "song", name: "Welcome", groupId: service.id };
  const items = [rootCue, service, serviceCue];

  const movedUp = reorderScheduleItemsAtInsertion(items, [1, 2], 0);
  assert.deepEqual(movedUp.items, [service, serviceCue, rootCue]);

  const rootIndex = movedUp.items.indexOf(rootCue);
  const placement = scheduleSectionBlockDropPlacement(
    movedUp.items,
    rootIndex,
    { afterTarget: true },
  );
  const movedDown = reorderScheduleItemsAtInsertion(
    movedUp.items,
    [0, 1],
    placement.insertIndex,
  );
  assert.deepEqual(movedDown.items, items);
});
