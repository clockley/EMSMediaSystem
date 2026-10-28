import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  cleanupExtractedProjectMedia,
  loadEmprojSnapshot,
  saveEmprojSnapshot,
} from "../src/main-process/emproj.mjs";
import {
  SCHEDULE_NOTE_MAX_LENGTH,
  copyScheduleNoteFields,
  mergeStageNotes,
  normalizeScheduleNoteText,
  scheduleGroupForItem,
  scheduleItemHasNote,
  scheduleItemStageNotes,
  scheduleNoteFields,
  scheduleNotePreview,
} from "../src/shared/schedule-item-notes.mjs";
import { stageContentFromPresentation } from "../src/shared/stage-content.mjs";

const SRC_ROOT = new URL("../src/", import.meta.url);

test("note text is normalized to a canonical, capped form", () => {
  assert.equal(normalizeScheduleNoteText("  \r\n\r\nPastor  \r\nprays   \n\n"), "Pastor\nprays");
  assert.equal(normalizeScheduleNoteText(null), "");
  assert.equal(normalizeScheduleNoteText(42), "");
  assert.equal(normalizeScheduleNoteText("   "), "");
  const long = "x".repeat(SCHEDULE_NOTE_MAX_LENGTH + 50);
  assert.equal(normalizeScheduleNoteText(long).length, SCHEDULE_NOTE_MAX_LENGTH);
  assert.equal(scheduleItemHasNote({ notes: " \n " }), false);
  assert.equal(scheduleItemHasNote({ notes: "Key of G" }), true);
});

test("persisted note fields omit empty notes and only keep an explicit stage opt-in", () => {
  assert.deepEqual(scheduleNoteFields({}), {});
  assert.deepEqual(scheduleNoteFields({ notes: "  ", notesOnStage: true }), {});
  assert.deepEqual(scheduleNoteFields({ notes: "Cue band", notesOnStage: "yes" }), { notes: "Cue band" });
  assert.deepEqual(
    scheduleNoteFields({ notes: "Cue band", notesOnStage: true }),
    { notes: "Cue band", notesOnStage: true },
  );
  const target = { id: "b", notes: "stale", notesOnStage: true };
  copyScheduleNoteFields({ notes: "fresh" }, target);
  assert.deepEqual(target, { id: "b", notes: "fresh" });
  copyScheduleNoteFields({}, target);
  assert.deepEqual(target, { id: "b" });
});

test("row previews are single-line and report hidden content", () => {
  assert.deepEqual(scheduleNotePreview(""), { text: "", truncated: false });
  assert.deepEqual(scheduleNotePreview("Short"), { text: "Short", truncated: false });
  assert.deepEqual(scheduleNotePreview("Line one\nLine two"), { text: "Line one", truncated: true });
  const preview = scheduleNotePreview("abcdefghij", 6);
  assert.equal(preview.text, "abcde…");
  assert.equal(preview.truncated, true);
});

test("stage notes are opt-in and put the group note before the item note", () => {
  const group = { id: "g1", type: "section", name: "Offering", notes: "Ushers forward", notesOnStage: true };
  const song = { id: "s1", type: "song", groupId: "g1", notes: "Tag chorus twice", notesOnStage: true };
  const privateSong = { id: "s2", type: "song", groupId: "g1", notes: "Operator only" };
  const items = [group, song, privateSong];

  assert.equal(scheduleGroupForItem(items, song), group);
  assert.equal(scheduleGroupForItem(items, group), null);
  assert.equal(scheduleGroupForItem(items, { type: "song", groupId: "missing" }), null);
  assert.equal(scheduleGroupForItem(items, { type: "song" }), null);

  assert.equal(scheduleItemStageNotes(song, group), "Ushers forward\n\nTag chorus twice");
  assert.equal(scheduleItemStageNotes(privateSong, group), "Ushers forward");
  assert.equal(scheduleItemStageNotes(privateSong, { ...group, notesOnStage: false }), "");
  assert.equal(mergeStageNotes("", "  ", "a", ["b", null]), "a\n\nb");
});

test("stage content merges schedule notes ahead of slide notes", () => {
  const content = stageContentFromPresentation(
    {
      resolvedPresentation: {
        navigation: { activeSlideId: "a" },
        slides: [{ slideId: "a", bodyText: "Verse", notes: "Watch for key change" }],
      },
    },
    { type: "song", itemNotes: "Tag chorus twice" },
  );
  assert.equal(content.notes, "Tag chorus twice\n\nWatch for key change");
  assert.equal(content.slideNotes, "Watch for key change");

  const withoutItemNotes = stageContentFromPresentation(
    { bodyText: "Verse", notes: "Slide only" },
    { type: "song" },
  );
  assert.equal(withoutItemNotes.notes, "Slide only");
  assert.equal(withoutItemNotes.slideNotes, "Slide only");
});

test("emproj round-trip preserves notes on groups, songs, scripture, and media", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ems-schedule-notes-"));
  const projectPath = path.join(root, "notes.emproj");
  const resavedPath = path.join(root, "notes-resaved.emproj");
  const snapshot = {
    project: { name: "Notes" },
    mediaQueue: [
      {
        id: "section-offering",
        type: "section",
        name: "Offering",
        notes: "Ushers forward on the last chorus",
        notesOnStage: true,
      },
      {
        id: "cue-song",
        groupId: "section-offering",
        path: "song://notes_song",
        name: "Notes Song",
        type: "song",
        songSnapshot: {
          schema: "ems.song.v1",
          id: "notes_song",
          title: "Notes Song",
          sections: [{ id: "verse_1", label: "Verse 1", blocks: [{ id: "b1", text: "Hello" }] }],
          playOrder: [{ id: "play_v1", sectionId: "verse_1" }],
        },
        notes: "Tag the chorus twice\r\nthen hold",
      },
      {
        id: "cue-scripture",
        groupId: null,
        path: "bible://KJV%3AJohn%203%3A16",
        name: "John 3:16 KJV",
        type: "bible",
        bible: { version: "KJV", reference: "John 3:16", book: "John", chapter: 3, verse: 3 },
        notes: "Reader: Sam",
        notesOnStage: true,
      },
      {
        id: "cue-video",
        groupId: null,
        path: path.join(root, "missing-announcements.mp4"),
        name: "Announcements",
        type: "video",
        notes: "Start at 0:12",
      },
      {
        id: "cue-video-empty",
        groupId: null,
        path: path.join(root, "missing-countdown.mp4"),
        name: "Countdown",
        type: "video",
        notes: "   ",
        notesOnStage: true,
      },
    ],
  };
  let loaded;
  let reloaded;
  try {
    await saveEmprojSnapshot(projectPath, snapshot, { name: "EMS Media System", version: "test" });
    loaded = await loadEmprojSnapshot(projectPath);
    const byId = new Map(loaded.mediaQueue.map((item) => [item.id, item]));
    const fields = (id) => ({ notes: byId.get(id)?.notes, notesOnStage: byId.get(id)?.notesOnStage });

    assert.deepEqual(fields("section-offering"), {
      notes: "Ushers forward on the last chorus",
      notesOnStage: true,
    });
    assert.deepEqual(fields("cue-song"), { notes: "Tag the chorus twice\nthen hold", notesOnStage: undefined });
    assert.deepEqual(fields("cue-scripture"), { notes: "Reader: Sam", notesOnStage: true });
    assert.deepEqual(fields("cue-video"), { notes: "Start at 0:12", notesOnStage: undefined });
    assert.equal(byId.has("cue-video-empty"), true);
    assert.equal("notes" in byId.get("cue-video-empty"), false);
    assert.equal("notesOnStage" in byId.get("cue-video-empty"), false);

    await saveEmprojSnapshot(resavedPath, loaded, { name: "EMS Media System", version: "test" });
    reloaded = await loadEmprojSnapshot(resavedPath);
    assert.deepEqual(
      reloaded.mediaQueue.map((item) => scheduleNoteFields(item)),
      loaded.mediaQueue.map((item) => scheduleNoteFields(item)),
    );
  } finally {
    if (reloaded) await cleanupExtractedProjectMedia(reloaded);
    if (loaded) await cleanupExtractedProjectMedia(loaded);
    await rm(root, { recursive: true, force: true });
  }
});

async function listSourceFiles(dirUrl) {
  const out = [];
  for (const entry of await readdir(dirUrl, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dirUrl);
    if (entry.isDirectory()) out.push(...await listSourceFiles(child));
    else if (/\.(mjs|js)$/.test(entry.name)) out.push(child);
  }
  return out;
}

test("schedule notes never flow into audience or lower-third outputs", async () => {
  // Only these modules may touch the schedule-note helpers. Audience,
  // lower-third, and output-compositor modules must never import them.
  const allowed = new Set([
    "main-process/emproj.mjs",
    "control-window/app-project-session.mjs",
    "control-window/app-song-slides-workspace.mjs",
    "control-window/app-bible-workspace.mjs",
    "control-window/app-live-outputs.mjs",
    "control-window/app-schedule-controller.mjs",
    "shared/stage-content.mjs",
  ]);
  const importers = [];
  for (const fileUrl of await listSourceFiles(SRC_ROOT)) {
    const source = await readFile(fileUrl, "utf8");
    if (/from\s+["'][^"']*schedule-item-notes(?:\.min)?\.mjs["']/.test(source)) {
      importers.push(fileUrl.pathname.slice(SRC_ROOT.pathname.length));
    }
  }
  for (const file of importers) {
    assert.ok(allowed.has(file), `${file} must not import schedule note helpers`);
  }

  // Within live outputs, the opted-in note text is only computed inside
  // stage-specific functions.
  const liveOutputs = await readFile(new URL("control-window/app-live-outputs.mjs", SRC_ROOT), "utf8");
  const callSites = [...liveOutputs.matchAll(/liveScheduleItemStageNotes\(/g)];
  assert.ok(callSites.length >= 3);
  for (const match of callSites) {
    const before = liveOutputs.slice(0, match.index);
    const owner = [...before.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(/g)].at(-1)?.[1] || "";
    assert.match(owner, /Stage/, `liveScheduleItemStageNotes called from non-stage function ${owner}`);
  }
});

test("notes survive session snapshots and in-place item rebuilds", async () => {
  const session = await readFile(new URL("control-window/app-project-session.mjs", SRC_ROOT), "utf8");
  const builderStart = session.indexOf("function buildProjectQueueItemSnapshot");
  assert.ok(builderStart >= 0);
  assert.match(session.slice(builderStart), /\.\.\.scheduleNoteFields\(item\)/);
  const restoreStart = session.indexOf("function applyProjectStateSnapshot");
  assert.ok(restoreStart >= 0);
  assert.equal(
    (session.slice(restoreStart).match(/\.\.\.scheduleNoteFields\(x\)/g) || []).length >= 2,
    true,
    "both section and cue restore paths keep notes",
  );

  const songs = await readFile(new URL("control-window/app-song-slides-workspace.mjs", SRC_ROOT), "utf8");
  assert.match(songs, /\.\.\.SCHEDULE_NOTE_FIELDS\]/);

  const bible = await readFile(new URL("control-window/app-bible-workspace.mjs", SRC_ROOT), "utf8");
  assert.match(bible, /copyScheduleNoteFields\(originalItem, splitEntries\[0\]\)/);
});

test("the note editor is modeless, keyboard-first, and never stops live output", async () => {
  const controller = await readFile(new URL("control-window/app-schedule-controller.mjs", SRC_ROOT), "utf8");
  const templates = await readFile(new URL("shared/app-ui-templates.mjs", SRC_ROOT), "utf8");

  // Inline editor in the schedule inspector, not a modal dialog.
  assert.match(templates, /id="queueNoteEditor"/);
  assert.match(templates, /id="queueNoteInput"[^>]*maxlength="2000"/s);
  assert.match(templates, /id="queueNoteStageToggle"/);
  assert.doesNotMatch(templates, /id="queueNoteCallouts"/);
  assert.doesNotMatch(controller, /queue-note-callout|renderScheduleNoteCallouts/);

  // Escape inside the editor is consumed before the global handler, which
  // would otherwise stop the live presentation.
  const keydownStart = controller.indexOf('input.addEventListener("keydown"');
  assert.ok(keydownStart >= 0);
  const keydown = controller.slice(keydownStart, controller.indexOf("});", keydownStart));
  assert.match(keydown, /event\.key === "Escape"/);
  assert.match(keydown, /event\.stopPropagation\(\)/);

  // N opens the editor, but never while typing or with a dialog/menu open.
  assert.match(controller, /event\.key !== "n" && event\.key !== "N"/);
  assert.match(controller, /\[role="dialog"\], \[role="menu"\]/);

  // Every schedule context menu offers note actions.
  for (const menu of ["showScheduleSongContextMenu", "showScheduleSectionContextMenu"]) {
    const start = controller.indexOf(`function ${menu}`);
    assert.ok(start >= 0, menu);
    const end = controller.indexOf("\nfunction ", start + 1);
    assert.match(controller.slice(start, end), /attachScheduleNoteMenuItems\(menu, index\)/, menu);
  }
});

test("stage note ownership is explicit during Show Now and slipstream transitions", async () => {
  const liveOutputs = await readFile(new URL("control-window/app-live-outputs.mjs", SRC_ROOT), "utf8");
  const songs = await readFile(new URL("control-window/app-song-slides-workspace.mjs", SRC_ROOT), "utf8");
  const bible = await readFile(new URL("control-window/app-bible-workspace.mjs", SRC_ROOT), "utf8");
  const playback = await readFile(new URL("control-window/app-presentation-playback.mjs", SRC_ROOT), "utf8");

  assert.match(
    liveOutputs,
    /hasOwnProperty\.call\(options, "stageItem"\)[\s\S]*syncStageContentFromAudienceMessage\(type, themedMessage, stageItem\)/,
  );
  assert.match(
    liveOutputs,
    /syncStageContentFromAudienceMessage\([\s\S]*item = currentLiveQueueItem\(\)[\s\S]*itemNotes: liveScheduleItemStageNotes\(item\)/,
  );
  assert.match(songs, /mediaQueue\.includes\(item\) \? item : null/);
  assert.match(songs, /sendAudienceTextMessage\("song", audienceMessage, \{[\s\S]*stageItem: null/);
  assert.match(bible, /sendAudienceTextMessage\("bible", audienceMessage, \{[\s\S]*stageItem: null/);
  assert.match(
    playback,
    /sendAudienceTextMessage\(slipstreamAudienceType, slipstreamAudienceMessage, \{[\s\S]*stageItem: nextItem/,
  );
});

test("lower-third-only text cues initialize stage notes and clear stale slide notes", async () => {
  const liveOutputs = await readFile(new URL("control-window/app-live-outputs.mjs", SRC_ROOT), "utf8");
  const playback = await readFile(new URL("control-window/app-presentation-playback.mjs", SRC_ROOT), "utf8");
  const bible = await readFile(new URL("control-window/app-bible-workspace.mjs", SRC_ROOT), "utf8");

  const queueSyncStart = liveOutputs.indexOf("async function syncStageContentFromQueueItem(");
  const queueSyncEnd = liveOutputs.indexOf("\n/**", queueSyncStart);
  const queueSync = liveOutputs.slice(queueSyncStart, queueSyncEnd);
  assert.doesNotMatch(queueSync, /isQueueItemSong\(item\)|isQueueItemBible\(item\)/);
  assert.match(queueSync, /slideNotes: ""/);
  assert.match(queueSync, /notes: liveScheduleItemStageNotes\(item\)/);

  const lowerThirdOnlySyncs = playback.match(
    /if \(!audienceStarted && lowerThirdStarted\) \{\s*void syncStageContentFromQueueItem\(item\)/g,
  ) || [];
  assert.equal(lowerThirdOnlySyncs.length, 2, "Scripture and song takes both initialize stage content");
  assert.match(
    bible,
    /if \(!audienceStarted && lowerThirdStarted\) \{\s*void syncStageContentFromQueueItem\(transientEntry\)/,
  );
});

test("clearing a note clears its stage opt-in and Saved waits for autosave", async () => {
  const controller = await readFile(new URL("control-window/app-schedule-controller.mjs", SRC_ROOT), "utf8");
  const project = await readFile(new URL("control-window/app-project-session.mjs", SRC_ROOT), "utf8");

  const inputStart = controller.indexOf('input.addEventListener("input"');
  const inputEnd = controller.indexOf('input.addEventListener("keydown"', inputStart);
  const inputHandler = controller.slice(inputStart, inputEnd);
  assert.match(inputHandler, /delete item\.notes;\s*delete item\.notesOnStage;/);
  assert.match(inputHandler, /stage\.checked = false/);

  const persistStart = controller.indexOf("function persistScheduleNoteChange(");
  const persistEnd = controller.indexOf("\n/**", persistStart);
  const persist = controller.slice(persistStart, persistEnd);
  assert.match(persist, /setScheduleNoteStatus\("Saving…", \{ transient: false \}\)/);
  assert.match(persist, /Promise\.resolve\(scheduleAutosaveProjectState\(\)\)\.then\(\(saved\)/);
  assert.match(persist, /if \(saved\) \{[\s\S]*setScheduleNoteStatus\(status\)/);
  assert.match(persist, /setScheduleNoteStatus\("Autosave failed", \{ transient: false \}\)/);

  const editorSyncStart = controller.indexOf("function syncScheduleNoteEditor(");
  const editorSyncEnd = controller.indexOf("\n/**", editorSyncStart);
  const editorSync = controller.slice(editorSyncStart, editorSyncEnd);
  assert.match(
    editorSync,
    /if \(item !== noteEditorItem\) \{[\s\S]*flushScheduleNoteEdit\(\);[\s\S]*noteSaveStatusRevision \+= 1;/,
  );

  const autosaveStart = project.indexOf("function scheduleAutosaveProjectState(");
  const autosaveEnd = project.indexOf("\nasync function stampBaselineForQueueItems", autosaveStart);
  const autosave = project.slice(autosaveStart, autosaveEnd);
  assert.match(autosave, /const completion = new Promise/);
  assert.match(autosave, /await autosaveWriteQueue\.run/);
  assert.match(autosave, /return completion;/);
});
