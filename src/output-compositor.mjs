import {
  OUTPUT_COMMAND_SCHEMA,
  OUTPUT_LAYERS,
  assertSafeOutputRoute,
  isOutputRole,
} from "./output-roles.mjs";

const COMMAND_TYPES = new Set(["layer.set", "layer.clear"]);

function integerRevision(value) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError("Output command revision must be a non-negative integer");
  }
  return revision;
}

export function createOutputCommand({
  commandId,
  sessionId,
  revision,
  targetRole,
  type = "layer.set",
  layer,
  payload = {},
  issuedAt = new Date().toISOString(),
}) {
  const command = {
    schema: OUTPUT_COMMAND_SCHEMA,
    commandId: String(commandId || "").trim(),
    sessionId: String(sessionId || "").trim(),
    revision: integerRevision(revision),
    targetRole,
    type,
    layer,
    payload: payload && typeof payload === "object" ? payload : {},
    issuedAt,
  };
  validateOutputCommand(command);
  return command;
}

export function validateOutputCommand(command, expectedRole = null) {
  if (!command || command.schema !== OUTPUT_COMMAND_SCHEMA) {
    throw new TypeError("Unknown output command schema");
  }
  if (!command.commandId || !command.sessionId) {
    throw new TypeError("Output commands require commandId and sessionId");
  }
  integerRevision(command.revision);
  if (!isOutputRole(command.targetRole)) throw new TypeError("Unknown output role");
  if (expectedRole && command.targetRole !== expectedRole) {
    throw new TypeError(`Command for ${command.targetRole} rejected by ${expectedRole}`);
  }
  if (!COMMAND_TYPES.has(command.type)) throw new TypeError("Unknown output command type");
  assertSafeOutputRoute(command.targetRole, command.layer, command.payload || {});
  return command;
}

export function createCompositorState(role, sessionId = "") {
  if (!isOutputRole(role)) throw new TypeError("Unknown output role");
  return {
    role,
    sessionId,
    layers: Object.fromEntries(OUTPUT_LAYERS[role].map((layer) => [layer, null])),
    revisions: Object.fromEntries(OUTPUT_LAYERS[role].map((layer) => [layer, -1])),
  };
}

export function applyOutputCommand(state, command) {
  validateOutputCommand(command, state?.role);
  if (state.sessionId && command.sessionId !== state.sessionId) {
    return { state, applied: false, reason: "session-mismatch" };
  }
  if (command.revision <= (state.revisions[command.layer] ?? -1)) {
    return { state, applied: false, reason: "stale-revision" };
  }
  const layers = { ...state.layers };
  layers[command.layer] = command.type === "layer.clear" ? null : { ...command.payload };
  return {
    applied: true,
    reason: "applied",
    state: {
      ...state,
      sessionId: state.sessionId || command.sessionId,
      layers,
      revisions: { ...state.revisions, [command.layer]: command.revision },
    },
  };
}

export function outputAcknowledgement(command, applied, error = "") {
  return {
    schema: "ems.output-ack.v1",
    commandId: command.commandId,
    outputRole: command.targetRole,
    revision: command.revision,
    applied: Boolean(applied),
    error: error ? String(error) : "",
  };
}
