import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../src/main-process/main.mjs", import.meta.url), "utf8");

// Electron sends a sendSync reply on the FIRST assignment to event.returnValue
// and ignores later ones. An early `event.returnValue = ""` default therefore
// made every renderer receive "" and silently fall back to file:// URLs, which
// bypassed the stss repair and brought the rapid-seek freeze back.
test("ems-media path registration replies to sendSync exactly once", () => {
  const match = mainSource.match(/ipcMain\.on\("ems-media-register-path",[^]*?\n  \}\);/);
  assert.ok(match, "main process registers the ems-media path handler");
  const assignments = match[0].match(/event\.returnValue\s*=/g) || [];
  assert.equal(assignments.length, 1, "event.returnValue must be assigned once, after the URL is computed");
  assert.match(match[0], /registerPath\([^]*event\.returnValue\s*=/, "the reply is sent after registration");
});
