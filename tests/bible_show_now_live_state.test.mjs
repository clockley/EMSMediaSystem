import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const bibleWorkspace = await readFile(
  new URL("../src/control-window/app-bible-workspace.mjs", import.meta.url),
  "utf8",
);

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
