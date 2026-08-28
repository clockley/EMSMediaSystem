import assert from "node:assert/strict";
import test from "node:test";

import {
  adjacentResolvedSlideIndex,
  bindCueFirstSlideActivation,
  groupResolvedSongSlides,
  presentationWarnings,
  resolvedSlideMarkers,
  resetManualBreaks,
  setManualBreakAfter,
} from "../src/preparation-ui-helpers.mjs";

test("resolved song slides stay grouped by repeated sequence entry", () => {
  const groups = groupResolvedSongSlides(
    {
      slides: [
        { slideId: "verse_a:0", sequenceEntryId: "verse_a", sectionId: "verse" },
        { slideId: "verse_a:1", sequenceEntryId: "verse_a", sectionId: "verse" },
        { slideId: "verse_b:0", sequenceEntryId: "verse_b", sectionId: "verse" },
      ],
    },
    [{ id: "verse", label: "Verse 1" }],
  );
  assert.deepEqual(groups.map((group) => [group.key, group.label, group.slides.length]), [
    ["verse_a", "Verse 1", 2],
    ["verse_b", "Verse 1", 1],
  ]);
});

test("manual break edits are immutable and reset by section or song", () => {
  const sections = [
    {
      id: "verse",
      blocks: [{ id: "line_1" }, { id: "line_2", manualBreakAfter: true }],
    },
    { id: "chorus", blocks: [{ id: "line_3", manualBreakAfter: true }] },
  ];
  const toggled = setManualBreakAfter(sections[0].blocks, "line_1", true);
  assert.equal(toggled[0].manualBreakAfter, true);
  assert.equal(sections[0].blocks[0].manualBreakAfter, undefined);

  const sectionReset = resetManualBreaks(sections, "verse");
  assert.equal(sectionReset[0].blocks[1].manualBreakAfter, undefined);
  assert.equal(sectionReset[1], sections[1]);
  assert.equal(resetManualBreaks(sections)[1].blocks[0].manualBreakAfter, undefined);
});

test("warning presenter gives overflow deterministic precedence", () => {
  const result = presentationWarnings(
    {
      slides: [
        { slideId: "a", layout: { resolvedFontSize: 30, minFontSize: 30 } },
        { slideId: "b", layout: { overflow: true, resolvedFontSize: 30 } },
      ],
    },
    { fontSize: 64, minFontSize: 30 },
  );
  assert.equal(result.minimumFontCount, 1);
  assert.equal(result.overflowCount, 1);
  assert.equal(result.banner, "1 slide overflows at minimum font size");
  assert.deepEqual(result.warnings.map((warning) => warning.level), [
    "minimum-font",
    "overflow",
  ]);
});

test("local navigator clamps previous and next boundaries", () => {
  const slides = [{ slideId: "a" }, { slideId: "b" }];
  assert.equal(adjacentResolvedSlideIndex(slides, "a", -1), 0);
  assert.equal(adjacentResolvedSlideIndex(slides, "a", 1), 1);
  assert.equal(adjacentResolvedSlideIndex(slides, "b", 1), 1);
  assert.deepEqual(resolvedSlideMarkers(slides, "a", "b"), [
    { current: true, next: false, live: false },
    { current: false, next: true, live: true },
  ]);
});

test("cue-first activation keeps single click preview-only and double click explicit", async () => {
  const listeners = new Map();
  const target = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  const actions = [];
  assert.equal(
    bindCueFirstSlideActivation(target, {
      cue: () => actions.push("cue"),
      takeLive: () => actions.push("live"),
    }),
    true,
  );

  listeners.get("click")({});
  await Promise.resolve();
  assert.deepEqual(actions, ["cue"]);

  let prevented = false;
  listeners.get("dblclick")({ preventDefault: () => { prevented = true; } });
  await Promise.resolve();
  assert.equal(prevented, true);
  assert.deepEqual(actions, ["cue", "live"]);
});
