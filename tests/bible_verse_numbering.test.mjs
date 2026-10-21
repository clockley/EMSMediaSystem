import test from "node:test";
import assert from "node:assert/strict";

import { bibleTextVerseRows } from "../src/shared/app-bible-reference-utils.mjs";

test("Bible chapter rows preserve source verse numbers across an omitted verse", () => {
  assert.deepEqual(
    bibleTextVerseRows({
      verses: ["Verse 36", "Verse 38", "Verse 39", "Verse 40"],
      verseRows: [
        { verse: 36, text: "Verse 36" },
        { verse: 38, text: "Verse 38" },
        { verse: 39, text: "Verse 39" },
        { verse: 40, text: "Verse 40" },
      ],
    }),
    [
      { verseNumber: 36, text: "Verse 36" },
      { verseNumber: 38, text: "Verse 38" },
      { verseNumber: 39, text: "Verse 39" },
      { verseNumber: 40, text: "Verse 40" },
    ],
  );
});

test("Bible chapter rows remain compatible with legacy string arrays", () => {
  assert.deepEqual(bibleTextVerseRows({ verses: ["One", "Two"] }), [
    { verseNumber: 1, text: "One" },
    { verseNumber: 2, text: "Two" },
  ]);
});
