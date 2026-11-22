import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const bibleWorkspace = await readFile(
  new URL("../src/control-window/app-bible-workspace.mjs", import.meta.url),
  "utf8",
);

test("double-clicking a verse while idle starts Show Now with the selected text", async () => {
  const state = { version: "KJV", book: "John", chapter: 11 };
  const takes = [];
  const context = vm.createContext({
    bibleDesignerState: state,
    selectedBibleVerseNumbers: () => [35],
    bibleVerseSelectionRequestMatchesCurrent: () => true,
    document: { getElementById: () => ({}) },
    setBiblePreviewText(reference, text) {
      Object.assign(state, { reference, text });
      return true;
    },
    isQueuePresentationActive: () => false,
    isActiveMediaWindow: () => false,
    isLocalAppWindowPresentationActive: () => false,
    isPlaying: false,
    showBibleTextNow: () => takes.push([state.reference, state.text]),
  });
  vm.runInContext(bibleWorkspace.slice(
    bibleWorkspace.indexOf("async function presentBibleSelectionFromDoubleClick("),
    bibleWorkspace.indexOf("function selectedBibleVerseNumbers("),
  ), context);

  await context.presentBibleSelectionFromDoubleClick(35, "Jesus wept.");
  assert.deepEqual(takes, [["John 11:35", "Jesus wept."]]);
});

test("committing Bible audience text refreshes the Show Now live state", () => {
  const start = bibleWorkspace.indexOf("async function sendBibleTextToOutput");
  const end = bibleWorkspace.indexOf(
    "function isPresentationActiveForBibleLowerThird",
    start,
  );
  const sendBibleTextToOutput = bibleWorkspace.slice(start, end);

  const sendIndex = sendBibleTextToOutput.indexOf(
    'sendAudienceTextMessage("bible", message)',
  );
  const syncIndex = sendBibleTextToOutput.indexOf(
    "syncBibleOperatorPreviewState()",
  );

  assert.ok(sendIndex >= 0, "Bible text should be sent to the audience output");
  assert.ok(
    syncIndex > sendIndex,
    "the live indicator should refresh after the audience message is committed",
  );
});
