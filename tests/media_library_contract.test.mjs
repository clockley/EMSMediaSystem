import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyMediaFile,
  displayNameForMedia,
  mediaSourceSupports,
  normalizeMediaQuery,
} from "../src/shared/media-library-contract.mjs";

test("classifyMediaFile recognizes the supported first-release kinds", () => {
  assert.equal(classifyMediaFile("welcome.JPG").kind, "image");
  assert.equal(classifyMediaFile("sermon.webm").kind, "video");
  assert.equal(classifyMediaFile("walk-in.FLAC").kind, "audio");
  assert.equal(classifyMediaFile("announcements.pptx").kind, "presentation");
  assert.equal(classifyMediaFile("handout.pdf"), null);
  assert.equal(classifyMediaFile("legacy.ppt"), null);
  assert.equal(classifyMediaFile("slides.odp"), null);
  assert.equal(classifyMediaFile("notes.txt"), null);
  assert.equal(displayNameForMedia("welcome.JPG"), "welcome");
});

test("normalizeMediaQuery bounds renderer-controlled query input", () => {
  const query = normalizeMediaQuery({
    query: `  ${"a".repeat(500)}  `,
    kinds: ["image", "executable", "video"],
    limit: 1000,
    offset: -20,
    availability: "invented",
    sort: "unknown",
  });
  assert.equal(query.query.length, 300);
  assert.deepEqual(query.kinds, ["image", "video"]);
  assert.equal(query.limit, 200);
  assert.equal(query.offset, 0);
  assert.equal(query.availability, "");
  assert.equal(query.sort, "name");
});

test("mediaSourceSupports uses declared provider capabilities", () => {
  assert.equal(mediaSourceSupports({ capabilities: ["browse", "read"] }, "read"), true);
  assert.equal(mediaSourceSupports({ capabilities: ["browse"] }, "delete"), false);
});
