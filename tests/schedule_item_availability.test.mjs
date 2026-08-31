import assert from "node:assert/strict";
import test from "node:test";

import {
  firstPlayableScheduleIndex,
  isEmbeddedScheduleItem,
  isScheduleItemPlayable,
  isScheduleItemVisible,
  nextPlayableScheduleIndex,
  previousPlayableScheduleIndex,
} from "../src/shared/schedule-item-availability.mjs";

const song = { type: "song", path: "song://1", name: "Song" };
const bible = { type: "bible", path: "bible://KJV:John%203:16", name: "John 3:16" };
const video = { type: "video", path: "/media/video.mp4", name: "Video" };
const missing = { type: "video", path: "/media/gone.mp4", name: "Gone", missing: true };
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
  const items = [song, bible, missing, video];
  assert.equal(isScheduleItemPlayable(bible, { bibleUiEnabled: false }), false);
  assert.equal(isScheduleItemPlayable(missing, { bibleUiEnabled: false }), false);
  assert.equal(nextPlayableScheduleIndex(items, 0, { bibleUiEnabled: false }), 3);
  assert.equal(firstPlayableScheduleIndex(items, { bibleUiEnabled: false }), 0);
  assert.equal(previousPlayableScheduleIndex(items, 3, { bibleUiEnabled: false }), 0);
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
