import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  cloneScheduleQueueForUndo,
  restoreScheduleQueueFromUndo,
} from "../src/shared/schedule-clear-undo.mjs";

function functionSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return source.slice(start, end);
}

test("queue Clear Undo preserves complete nested runtime documents without aliases", () => {
  const queue = [
    {
      path: "song://song-1",
      type: "song",
      autoAdvance: false,
      source: { kind: "library", songId: "song-1" },
      songSnapshot: {
        id: "song-1",
        title: "Scheduled lyrics",
        sections: [{ id: "verse-1", blocks: [{ text: "Original words" }] }],
      },
      sequence: { entries: [{ sectionId: "verse-1" }] },
      render: { currentSectionId: "verse-1", currentSlideId: "slide-2" },
      itemTheme: { snapshot: { id: "theme-1", name: "Scheduled theme" } },
    },
    {
      path: "deck://deck-1/page-2",
      type: "deck",
      deckSnapshot: {
        id: "deck-1",
        pages: [{ id: "page-2", objects: [{ type: "text", blocks: [{ text: "Deck text" }] }] }],
      },
    },
    {
      path: "bible://KJV:John%203%3A16",
      type: "bible",
      presentationId: "scripture-stable-id",
      autoAdvance: false,
      bible: {
        reference: "John 3:16",
        selectedVerses: [16],
        verseRows: [{ verseNumber: 16, text: "For God so loved" }],
      },
    },
    {
      path: "/media/clip.mp4",
      type: "video",
      autoAdvance: false,
      fileHash: "old-file-hash",
      pendingMediaUpdate: { status: "ready", fileHash: "new-file-hash" },
      liveSource: {
        mode: "linked",
        strategy: "snapshot",
        snapshotId: "pinned-snapshot",
        originalPath: "/media/clip.mp4",
      },
    },
  ];

  const snapshot = cloneScheduleQueueForUndo(queue);
  queue[0].songSnapshot.sections[0].blocks[0].text = "Library was edited";
  queue[1].deckSnapshot.pages[0].objects[0].blocks[0].text = "Deck was edited";
  queue[2].bible.verseRows[0].text = "Text was edited";
  queue[3].liveSource.snapshotId = "different-snapshot";

  assert.equal(snapshot[0].songSnapshot.sections[0].blocks[0].text, "Original words");
  assert.equal(snapshot[1].deckSnapshot.pages[0].objects[0].blocks[0].text, "Deck text");
  assert.equal(snapshot[2].bible.verseRows[0].text, "For God so loved");
  assert.equal(snapshot[3].liveSource.snapshotId, "pinned-snapshot");
  assert.equal(snapshot[0].autoAdvance, false);
  assert.equal(snapshot[2].presentationId, "scripture-stable-id");

  const restored = restoreScheduleQueueFromUndo(snapshot);
  restored[0].render.currentSlideId = "slide-3";
  restored[3].pendingMediaUpdate.status = "accepted";
  assert.equal(snapshot[0].render.currentSlideId, "slide-2");
  assert.equal(snapshot[3].pendingMediaUpdate.status, "ready");
});

test("queue Clear Undo rejects a non-array snapshot", () => {
  assert.throws(
    () => cloneScheduleQueueForUndo({}),
    /requires an array of queue items/,
  );
});

test("Clear and Undo are transactional around output closure and playback restore", async () => {
  const [renderer, schedule, playback] = await Promise.all([
    readFile(new URL("../src/control-window/app-renderer.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/control-window/app-schedule-controller.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/control-window/app-presentation-playback.mjs", import.meta.url), "utf8"),
  ]);

  const capture = functionSource(
    renderer,
    "function captureQueueClearUndoState(",
    "function showQueueClearedUndoToast(",
  );
  assert.match(capture, /cloneScheduleQueueForUndo\(mediaQueue\)/);
  assert.doesNotMatch(capture, /await|\.map\(\(x\)/);
  assert.match(capture, /lowerThirdWasActive/);
  assert.match(capture, /localAudioWasActive/);

  const restore = functionSource(
    renderer,
    "async function restoreQueueClearUndoSnapshot(",
    "async function openThemeManagerForQueueItem(",
  );
  assert.match(restore, /restoreScheduleQueueFromUndo\(snap\.items\)/);
  assert.match(restore, /snap\.outputs/);
  assert.match(restore, /restoreQueueClearSelectionState\(snap\)/);
  assert.doesNotMatch(restore, /snap\.items\.map/);
  assert.doesNotMatch(restore, /currentQueueIndex\s*=\s*0/);

  const selectionRestore = functionSource(
    renderer,
    "function restoreQueueClearSelectionState(",
    "async function restoreQueueClearUndoSnapshot(",
  );
  assert.match(selectionRestore, /selectedQueueItems\.clear\(\)/);

  const finalizeWithoutAudience = functionSource(
    renderer,
    "async function finalizeQueueClearDestructive(",
    "async function finalizeQueueClearAfterAudienceClose(",
  );
  assert.match(
    finalizeWithoutAudience,
    /if \(bibleLowerThirdOutputActive\)[\s\S]*await closeBibleLowerThirdOutput\(\)/,
  );

  const clear = functionSource(
    schedule,
    "async function onClearMediaQueueClick(",
    "function removeFromQueue(",
  );
  assert.match(clear, /queueClearInFlight/);
  assert.match(clear, /captureQueueClearUndoState\(\)/);
  assert.match(clear, /await closeActiveMediaWindowNow\(\)/);
  assert.doesNotMatch(clear, /showQueueClearedUndoToast/);

  const closeHandler = functionSource(
    playback,
    "async function handleMediaWindowClosed(",
    "function updatePlayButtonOnMediaWindow(",
  );
  assert.match(
    closeHandler,
    /if \(pendingQueueClearPostClose\)[\s\S]*await finalizeQueueClearAfterAudienceClose\(\)/,
  );

  const play = functionSource(
    playback,
    "async function playCurrentQueueItem(",
    "async function advanceQueueAfterMediaWindowClosed(",
  );
  assert.match(play, /opts\?\.outputRoles/);
  assert.match(play, /if \(loaded === false\) return failPlaybackStart\(""\)/);
});
