import { createOutputCommand } from "./output-compositor.mjs";

const ALERT_KINDS = new Set(["nursery", "general", "privateStage"]);
const PRIORITIES = new Set(["normal", "high"]);

export function normalizeAlert(input = {}) {
  const kind = ALERT_KINDS.has(input.kind) ? input.kind : "general";
  const message = String(input.message || "").trim().slice(0, 500);
  if (!message) throw new TypeError("A message is required");
  const privateStage = kind === "privateStage";
  if (privateStage && input.routes?.audience === true) {
    throw new TypeError("Private stage messages cannot be routed to audience output");
  }
  return {
    schema: "ems.alert.v1",
    id: String(input.id || "").trim(),
    kind,
    title: String(input.title || (privateStage ? "Stage message" : "Notice")).trim().slice(0, 100),
    message,
    priority: PRIORITIES.has(input.priority) ? input.priority : "normal",
    mode: "static",
    durationMs: Math.max(0, Math.min(300000, Number(input.durationMs) || 0)),
    routes: privateStage
      ? { audience: false, stage: true }
      : { audience: input.routes?.audience !== false, stage: input.routes?.stage === true },
  };
}

export function commandsForAlert(alertInput, context) {
  const alert = normalizeAlert(alertInput);
  const commands = [];
  const common = {
    sessionId: context.sessionId,
    type: context.clear ? "layer.clear" : "layer.set",
  };
  if (alert.routes.audience) {
    commands.push(createOutputCommand({
      ...common,
      commandId: context.commandId("audience"),
      revision: context.revision("audience"),
      targetRole: "audience",
      layer: "alert",
      payload: alert,
    }));
  }
  if (alert.routes.stage) {
    commands.push(createOutputCommand({
      ...common,
      commandId: context.commandId("stage"),
      revision: context.revision("stage"),
      targetRole: "stage",
      layer: alert.kind === "privateStage" ? "privateMessage" : "alert",
      payload: alert,
    }));
  }
  return commands;
}
