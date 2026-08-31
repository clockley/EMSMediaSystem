import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cleanupExtractedProjectMedia,
  loadEmprojSnapshot,
  saveEmprojSnapshot,
} from "../src/emproj.mjs";

test("project round-trip preserves resolved slide identity and manual breaks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-resolved-persistence-"));
  const projectPath = path.join(root, "resolved.emproj");
  const song = JSON.parse(
    await readFile(new URL("fixtures/resolution/long-song.json", import.meta.url), "utf8"),
  );
  song.sections[0].blocks[1].manualBreakAfter = true;
  const snapshot = {
    project: { name: "Resolved state" },
    projectThemes: {
      schema: "ems.project-themes.v1",
      bindings: { song: "warm", scripture: "warm", text: "warm", lowerThird: "warm" },
      snapshots: { warm: { theme: { schema: "ems.theme.v1", id: "warm", name: "Warm", tokens: {}, profiles: {}, assets: [] } } },
    },
    projectOutputs: {
      schema: "ems.project-outputs.v1",
      stage: { display: "display:123", profile: "current-next" },
    },
    mediaQueue: [
      {
        path: "song://fixture_long_song",
        name: "Long Song",
        type: "song",
        source: { kind: "library", songId: song.id },
        songSnapshot: song,
        sequence: {
          arrangementId: "arr_default",
          entries: song.playOrder,
          currentSequenceEntryId: "play_v1",
        },
        render: {
          currentSectionId: "verse_1",
          currentSequenceEntryId: "play_v1",
          currentSlideId: "play_v1:1",
        },
        currentSequenceEntryId: "play_v1",
        currentSlideId: "play_v1:1",
        itemTheme: {
          schema: "ems.item-theme.v1",
          themeId: "warm",
          snapshot: { schema: "ems.theme.v1", id: "warm", name: "Warm", tokens: {}, profiles: {}, assets: [] },
          overrides: { audience: { typography: { fontSize: 72, color: "#ffeecc" } } },
          editorMaterialized: true,
        },
      },
      {
        path: "bible://KJV%3AJohn%201%3A1-3",
        name: "John 1:1-3 KJV",
        type: "bible",
        bible: {
          version: "KJV",
          reference: "John 1:1-3",
          book: "John",
          chapter: 1,
          verse: 1,
          verseEnd: 3,
          selectedVerses: [1, 2, 3],
          currentSlideId: "passage:1",
          currentLowerThirdSlideId: "passage:3",
        },
        currentSlideId: "passage:1",
      },
    ],
  };
  let loaded;
  try {
    await saveEmprojSnapshot(
      projectPath,
      snapshot,
      { name: "EMS Media System", version: "test" },
    );
    loaded = await loadEmprojSnapshot(projectPath);
    const loadedSong = loaded.mediaQueue[0];
    const loadedBible = loaded.mediaQueue[1];
    assert.equal(loadedSong.currentSlideId, "play_v1:1");
    assert.equal(loadedSong.currentSequenceEntryId, "play_v1");
    assert.equal(
      loadedSong.songSnapshot.sections[0].blocks[1].manualBreakAfter,
      true,
    );
    assert.deepEqual(
      loadedSong.songSnapshot.presentation.manualBreaks,
      song.presentation.manualBreaks,
    );
    assert.equal(loadedBible.currentSlideId, "passage:1");
    assert.equal(loadedBible.bible.currentSlideId, "passage:1");
    assert.equal(loadedBible.bible.currentLowerThirdSlideId, "passage:3");
    assert.equal(loaded.projectThemes.bindings.song, "warm");
    assert.equal(loadedSong.itemTheme.themeId, "warm");
    assert.equal(loadedSong.itemTheme.overrides.audience.typography.fontSize, 72);
    assert.equal(loadedSong.itemTheme.editorMaterialized, true);
    assert.deepEqual(loaded.projectOutputs, snapshot.projectOutputs);
  } finally {
    if (loaded) await cleanupExtractedProjectMedia(loaded);
    await rm(root, { recursive: true, force: true });
  }
});
