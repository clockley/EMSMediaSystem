import assert from "node:assert/strict";
import test from "node:test";
import {
  NAVIGATION_STATES,
  createNavigationStateMachine,
} from "../src/global-navigation-state.mjs";

test("global navigation has one authoritative state", () => {
  const machine = createNavigationStateMachine();
  const transitions = [];
  machine.subscribe((state, previous) => transitions.push([previous, state]));

  assert.equal(machine.state, NAVIGATION_STATES.MEDIA);
  assert.equal(machine.transition(NAVIGATION_STATES.SONGS).changed, true);
  assert.equal(machine.transition(NAVIGATION_STATES.SONGS).changed, false);
  assert.equal(machine.transition(NAVIGATION_STATES.SETTINGS).changed, true);
  assert.equal(machine.transition(NAVIGATION_STATES.MEDIA).changed, true);
  assert.deepEqual(transitions, [
    ["media", "songs"],
    ["songs", "settings"],
    ["settings", "media"],
  ]);
});

test("global navigation rejects states outside the machine", () => {
  const machine = createNavigationStateMachine();
  assert.throws(() => machine.transition("powerpoint"), /Unknown navigation state/);
});
