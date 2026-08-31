import assert from "node:assert/strict";
import test from "node:test";

import { stageContentFromPresentation, stageSlideText } from "../src/shared/stage-content.mjs";

test("stage next uses the following resolved slide", () => {
  const content = stageContentFromPresentation(
    {
      bodyText: "Current verse",
      resolvedPresentation: {
        navigation: { activeSlideId: "a", nextSlideId: "b" },
        slides: [
          { slideId: "a", bodyText: "Bless the Lord" },
          { slideId: "b", bodyText: "O my soul" },
        ],
      },
    },
    { type: "song" },
  );
  assert.equal(content.current, "Bless the Lord");
  assert.equal(content.next, "O my soul");
});

test("stage next falls back to the next playable schedule item", () => {
  const content = stageContentFromPresentation(
    {
      bodyText: "Last slide",
      title: "Great Are You Lord",
      resolvedPresentation: {
        navigation: { activeSlideId: "last", nextSlideId: null },
        slides: [{ slideId: "last", bodyText: "Last slide" }],
      },
    },
    { type: "song", nextItemText: "John 3:16 KJV" },
  );
  assert.equal(content.current, "Last slide");
  assert.equal(content.next, "John 3:16 KJV");
  assert.equal(content.serviceItem, "Great Are You Lord");
});

test("stage current still works when resolved slides are missing", () => {
  const content = stageContentFromPresentation(
    { bodyText: "For God so loved the world", referenceText: "John 3:16 KJV" },
    { type: "bible", nextItemText: "Announcement video" },
  );
  assert.equal(content.current, "For God so loved the world");
  assert.equal(content.next, "Announcement video");
});

test("stageSlideText reads lyric blocks when bodyText is empty", () => {
  assert.equal(
    stageSlideText({
      blocks: [
        { primary: { segments: [{ text: "Line one" }] } },
        { primary: { segments: [{ text: "Line two" }] } },
      ],
    }),
    "Line one\nLine two",
  );
});

test("stage content exposes section labels and notes", () => {
  const content = stageContentFromPresentation({
    resolvedPresentation: {
      navigation: { activeSlideId: "v1" },
      slides: [{ slideId: "v1", bodyText: "Line", sectionLabel: "Verse 1", notes: "Softly" }],
    },
  }, { type: "song" });
  assert.equal(content.sectionLabel, "Verse 1");
  assert.equal(content.notes, "Softly");
});
