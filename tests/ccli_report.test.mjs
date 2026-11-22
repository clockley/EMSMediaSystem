import assert from "node:assert/strict";
import test from "node:test";
import { projectionReportCsv } from "../src/shared/ccli-report.mjs";
import { createProjectionTracker } from "../src/shared/song-projection.mjs";
import { resolvedSongPresentation } from "../src/shared/app-song-utils.mjs";

test("audience holds, blank slides and verse changes preserve a projection identity", () => {
  const events = [];
  const tracker = createProjectionTracker(event => events.push(event));
  const a = { songId: "a" }, b = { songId: "b" };
  tracker.update(a, { visible: false });
  tracker.update(b, { visible: false });
  assert.equal(events.length, 0);
  tracker.update(b, { visible: true });
  tracker.update(b, { visible: false });
  tracker.update(b, { visible: true });
  assert.equal(events.length, 1);
  tracker.update(b, { visible: true, replay: true });
  assert.equal(events[0].id, events[1].id);
  tracker.update(a, { visible: true });
  tracker.update(b, { visible: true });
  tracker.update(null, { visible: false });
  tracker.update(b, { visible: true });
  tracker.update(b, { visible: true, playbackId: "next-cue" });
  assert.equal(new Set(events.map(e => e.id)).size, 5);
});

test("the report carries snapshot metadata independently of the on-slide credit", () => {
  const item = {
    type: "song", songSnapshot: { id: "a", title: "Title", metadata: { authors: ["A", "B"], ccli_number: 1234 }, sections: [] },
    render: { copyrightPlacement: "none" },
  };
  const { message } = resolvedSongPresentation(item);
  assert.equal(message.copyrightText, "");
  assert.deepEqual(message.projectionSong, { songId: "a", title: "Title", authors: "A, B", ccliNumber: "1234" });
  assert.equal(resolvedSongPresentation({ ...item, type: "deck" }).message.projectionSong, undefined);
});

test("manual summary groups selected uses by song number and escapes spreadsheet cells", () => {
  const row = { title: '=A,"B"', authors: "C\nD", ccliNumber: "123", included: true };
  const csv = projectionReportCsv([row, { ...row, title: "Alias" }, { ...row, ccliNumber: "456" },
    { ...row, included: false }, { ...row, ccliNumber: "unknown" }], "2026-02-01", "2026-02-28");
  assert.ok(csv.includes(`"123","'=A,""B""","C\nD","2"`));
  assert.ok(csv.includes(`"456","'=A,""B""","C\nD","1"`));
  assert.throws(() => projectionReportCsv([{ ...row, ccliNumber: "" }]), /Include a projection/);
});
