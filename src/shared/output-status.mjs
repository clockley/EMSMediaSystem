import { OUTPUT_STATUS_SCHEMA } from "./output-roles.mjs";

const ROLE_DEFAULTS = Object.freeze({
  audience: { window: "closed", display: "", content: "none", hold: "none", text: "visible", alert: "clear", background: "none", health: "inactive" },
  lowerThird: { window: "closed", display: "", content: "none", health: "inactive" },
  stage: { window: "closed", display: "", profile: "current-next", privateMessage: "clear", alert: "clear", health: "inactive" },
});

export function createOutputStatus(sessionId = "") {
  return {
    schema: OUTPUT_STATUS_SCHEMA,
    sessionId,
    audience: { ...ROLE_DEFAULTS.audience },
    lowerThird: { ...ROLE_DEFAULTS.lowerThird },
    stage: { ...ROLE_DEFAULTS.stage },
  };
}

export function mergeOutputStatus(status, patch = {}) {
  const base = status?.schema === OUTPUT_STATUS_SCHEMA
    ? status
    : createOutputStatus(patch.sessionId || "");
  return {
    ...base,
    ...patch,
    schema: OUTPUT_STATUS_SCHEMA,
    audience: { ...base.audience, ...(patch.audience || {}) },
    lowerThird: { ...base.lowerThird, ...(patch.lowerThird || {}) },
    stage: { ...base.stage, ...(patch.stage || {}) },
  };
}

export function outputStatusSummary(status) {
  const current = mergeOutputStatus(status);
  return ["audience", "lowerThird", "stage"].map((role) => {
    const value = current[role];
    const overlays = [value.alert === "live" && "alert", value.alert === "pending" && "alert pending", value.privateMessage === "live" && "private message", value.hold !== "none" && value.hold].filter(Boolean);
    return { role, label: `${role}: ${value.window}${overlays.length ? ` · ${overlays.join(" · ")}` : ""}`, health: value.health };
  });
}
