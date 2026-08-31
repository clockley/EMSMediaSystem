import assert from "node:assert/strict";
import test from "node:test";
import {
  SCRIPTURE_FOLLOW_MODE,
  SCRIPTURE_PRESENTATION_STATUS,
  createScripturePresentationMachine,
  resolveScriptureSlideForCursor,
  scriptureCursorForSlide,
} from "../src/shared/scripture-presentation-state.mjs";

const source = { id: "schedule:item-7", origin: "schedule", scheduleIndex: 7 };
const audienceSlides = [
  { slideId: "audience:0", passageKey: "John 3:16", verseNumbers: [16] },
  { slideId: "audience:1", passageKey: "John 3:16", verseNumbers: [17] },
];
const lowerThirdSlides = [
  { slideId: "lower:0", verseNumbers: [16] },
  { slideId: "lower:1", verseNumbers: [16] },
  { slideId: "lower:2", verseNumbers: [17] },
];

test("one take revision owns audience and lower-third activation", () => {
  const machine = createScripturePresentationMachine();
  const cursor = scriptureCursorForSlide(audienceSlides[0], audienceSlides);
  const taking = machine.dispatch({
    type: "TAKE_REQUESTED",
    source,
    cursor,
    outputs: { audience: true, lowerThird: true },
  });
  assert.equal(taking.status, SCRIPTURE_PRESENTATION_STATUS.TAKING);

  const stale = machine.dispatch({
    type: "TAKE_CONFIRMED",
    revision: taking.revision - 1,
    outputs: { audience: true, lowerThird: true },
  });
  assert.equal(stale.status, SCRIPTURE_PRESENTATION_STATUS.TAKING);

  const live = machine.dispatch({
    type: "TAKE_CONFIRMED",
    revision: taking.revision,
    outputs: { audience: true, lowerThird: true },
  });
  assert.equal(live.status, SCRIPTURE_PRESENTATION_STATUS.LIVE);
  assert.equal(live.outputs.audience.status, "live");
  assert.equal(live.outputs.lowerThird.status, "live");
});

test("linked cursor maps the same verse across different pagination", () => {
  const cursor = scriptureCursorForSlide(audienceSlides[1], audienceSlides);
  assert.equal(resolveScriptureSlideForCursor(lowerThirdSlides, cursor).slideId, "lower:2");

  const machine = createScripturePresentationMachine();
  machine.dispatch({ type: "SOURCE_PREVIEWED", source, cursor });
  const state = machine.dispatch({
    type: "CURSOR_CHANGED",
    sourceId: source.id,
    cursor,
    lowerThirdSlideId: "lower:2",
  });
  assert.equal(state.outputs.audience.slideId, "audience:1");
  assert.equal(state.outputs.lowerThird.slideId, "lower:2");
});

test("a lower-third cue maps back to its containing audience slide", () => {
  const lowerThirdCursor = scriptureCursorForSlide(lowerThirdSlides[2], lowerThirdSlides);
  assert.equal(
    resolveScriptureSlideForCursor(audienceSlides, lowerThirdCursor).slideId,
    "audience:1",
  );

  const previousCursor = scriptureCursorForSlide(lowerThirdSlides[0], lowerThirdSlides);
  assert.equal(
    resolveScriptureSlideForCursor(audienceSlides, previousCursor).slideId,
    "audience:0",
  );
});

test("manual lower-third cue is preserved until linked mode is restored", () => {
  const machine = createScripturePresentationMachine();
  const first = scriptureCursorForSlide(audienceSlides[0], audienceSlides);
  machine.dispatch({ type: "SOURCE_PREVIEWED", source, cursor: first });
  machine.dispatch({ type: "LOWER_THIRD_CUED", sourceId: source.id, slideId: "lower:1" });
  const second = scriptureCursorForSlide(audienceSlides[1], audienceSlides);
  const manual = machine.dispatch({
    type: "CURSOR_CHANGED",
    sourceId: source.id,
    cursor: second,
    lowerThirdSlideId: "lower:2",
  });
  assert.equal(manual.outputs.lowerThird.follow, SCRIPTURE_FOLLOW_MODE.MANUAL);
  assert.equal(manual.outputs.lowerThird.slideId, "lower:1");

  const linked = machine.dispatch({
    type: "LOWER_THIRD_FOLLOW_SET",
    follow: SCRIPTURE_FOLLOW_MODE.LINKED,
    slideId: "lower:2",
  });
  assert.equal(linked.outputs.lowerThird.slideId, "lower:2");
});

test("stopping invalidates outstanding asynchronous work", () => {
  const machine = createScripturePresentationMachine();
  const taking = machine.dispatch({
    type: "TAKE_REQUESTED",
    source,
    outputs: { audience: true, lowerThird: true },
  });
  const stopped = machine.dispatch({ type: "STOPPED" });
  assert.equal(stopped.status, SCRIPTURE_PRESENTATION_STATUS.IDLE);
  assert.equal(machine.isCurrentRevision(taking.revision), false);
  assert.equal(
    machine.dispatch({
      type: "TAKE_CONFIRMED",
      revision: taking.revision,
      outputs: { audience: true, lowerThird: true },
    }).status,
    SCRIPTURE_PRESENTATION_STATUS.IDLE,
  );
});

test("lower-third-only changes do not cancel an audience render for the same content", () => {
  const machine = createScripturePresentationMachine();
  const taking = machine.dispatch({
    type: "TAKE_REQUESTED",
    source,
    outputs: { audience: true, lowerThird: true },
  });
  machine.dispatch({ type: "LOWER_THIRD_CUED", sourceId: source.id, slideId: "lower:1" });
  machine.dispatch({ type: "OUTPUT_STATUS_CHANGED", output: "lowerThird", status: "closed" });
  assert.equal(machine.isCurrentRevision(taking.revision), true);
});
