import test from "node:test";
import assert from "node:assert/strict";
import { commandsForAlert, normalizeAlert } from "../src/alert-routing.mjs";
import { applyOutputCommand, createCompositorState, createOutputCommand } from "../src/output-compositor.mjs";

const command = (overrides = {}) => createOutputCommand({
  commandId: "cmd-1", sessionId: "session-1", revision: 1,
  targetRole: "stage", type: "layer.set", layer: "privateMessage",
  payload: { kind: "privateStage", message: "Ready" }, ...overrides,
});

test("private stage messages cannot normalize to an audience route", () => {
  assert.throws(() => normalizeAlert({ kind: "privateStage", message: "Secret", routes: { audience: true } }), /cannot be routed/);
  const [routed] = commandsForAlert(
    { id: "a", kind: "privateStage", message: "Secret" },
    { sessionId: "s", commandId: (role) => `c-${role}`, revision: () => 1 },
  );
  assert.equal(routed.targetRole, "stage");
  assert.equal(routed.layer, "privateMessage");
});

test("stage compositor rejects role mismatch and stale revisions", () => {
  const initial = createCompositorState("stage", "session-1");
  const first = applyOutputCommand(initial, command());
  assert.equal(first.applied, true);
  assert.equal(first.state.layers.privateMessage.message, "Ready");
  assert.equal(applyOutputCommand(first.state, command()).reason, "stale-revision");
  assert.throws(() => applyOutputCommand(first.state, command({ targetRole: "audience", layer: "alert" })), /cannot be routed|rejected/);
});

test("clear commands remove only their addressed layer", () => {
  const initial = applyOutputCommand(createCompositorState("stage", "session-1"), command()).state;
  const cleared = applyOutputCommand(initial, command({ commandId: "cmd-2", revision: 2, type: "layer.clear" }));
  assert.equal(cleared.state.layers.privateMessage, null);
  assert.equal(cleared.state.revisions.privateMessage, 2);
});
