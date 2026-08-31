import { createOutputCommand } from "./output-compositor.mjs";
import {
  DEFAULT_ALERT_BACKGROUND_COLOR,
  DEFAULT_ALERT_TEXT_COLOR,
  normalizeAlertColor,
} from "./alert-colors.mjs";

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
    identifier: String(input.identifier || "").trim().slice(0, 50),
    title: String(input.title ?? (privateStage ? "Stage message" : "")).trim().slice(0, 100),
    message,
    backgroundColor: normalizeAlertColor(input.backgroundColor, DEFAULT_ALERT_BACKGROUND_COLOR),
    textColor: normalizeAlertColor(input.textColor, DEFAULT_ALERT_TEXT_COLOR),
    priority: PRIORITIES.has(input.priority) ? input.priority : "normal",
    mode: ["scroll", "scroll-needed"].includes(input.mode) ? input.mode : "static",
    durationMs: Math.max(0, Math.min(300000, Number(input.durationMs) || 0)),
    dismissAtCountdownEnd: input.dismissAtCountdownEnd === true,
    tokenDefinitions: input.tokenDefinitions && typeof input.tokenDefinitions === "object"
      ? structuredClone(input.tokenDefinitions)
      : {},
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
