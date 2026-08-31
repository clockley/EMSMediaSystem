import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createResolvedPresentation,
  resolvedNavigation,
  stableSerialize,
  stableValueHash,
} from "../src/shared/resolved-presentation.mjs";

test("resolved presentation contract exposes stable target and navigation state", () => {
  const slides = [
    { slideId: "entry_a:0", bodyText: "One", chunkIndex: 0, layout: { fits: true, overflow: false } },
    { slideId: "entry_a:1", bodyText: "Two", chunkIndex: 1, layout: { fits: true, overflow: false } },
  ];
  const presentation = createResolvedPresentation({
    contentKind: "song",
    source: { id: "song_a", revision: "rev_1" },
    slides,
    target: { outputRole: "audience", outputSize: { width: 1920, height: 1080 } },
    activeSlideId: "entry_a:1",
    layoutKey: "layout_1",
  });
  assert.equal(presentation.schema, "ems.resolvedPresentation.v1");
  assert.equal(presentation.activeSlide.slideId, "entry_a:1");
  assert.equal(presentation.navigation.previousSlideId, "entry_a:0");
  assert.equal(presentation.navigation.nextSlideId, null);
  assert.deepEqual(resolvedNavigation(slides, "missing"), {
    slideCount: 2,
    activeSlideId: "entry_a:0",
    previousSlideId: null,
    nextSlideId: "entry_a:1",
  });
});

test("stable serialization and revision hashes ignore object key insertion order", () => {
  const left = { font: { family: "CMG Sans", size: 66 }, width: 1920 };
  const right = { width: 1920, font: { size: 66, family: "CMG Sans" } };
  assert.equal(stableSerialize(left), stableSerialize(right));
  assert.equal(stableValueHash(left), stableValueHash(right));
});

test("resolved presentation JSON schema declares the v1 contract", async () => {
  const schema = JSON.parse(
    await readFile(new URL("../src/schemas/ems-resolved-presentation.v1.schema.json", import.meta.url)),
  );
  assert.equal(schema.properties.schema.const, "ems.resolvedPresentation.v1");
  assert.ok(schema.required.includes("slides"));
  assert.ok(schema.$defs.SlideUnit.required.includes("layout"));
});
