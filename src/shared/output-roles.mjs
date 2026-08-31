export const OUTPUT_COMMAND_SCHEMA = "ems.output-command.v1";
export const OUTPUT_STATUS_SCHEMA = "ems.output-status.v1";

export const OUTPUT_ROLES = Object.freeze({
  AUDIENCE: "audience",
  LOWER_THIRD: "lowerThird",
  STAGE: "stage",
});

export const OUTPUT_LAYERS = Object.freeze({
  audience: Object.freeze(["base", "media", "content", "alert", "clearText", "hold"]),
  lowerThird: Object.freeze(["base", "content"]),
  stage: Object.freeze(["base", "content", "widgets", "alert", "privateMessage", "fault"]),
});

export function isOutputRole(value) {
  return Object.values(OUTPUT_ROLES).includes(value);
}

export function isLayerAllowedForRole(role, layer) {
  return isOutputRole(role) && OUTPUT_LAYERS[role].includes(layer);
}

export function assertSafeOutputRoute(role, layer, payload = {}) {
  if (!isLayerAllowedForRole(role, layer)) {
    throw new TypeError(`Layer ${String(layer)} is not allowed for ${String(role)}`);
  }
  if (
    role === OUTPUT_ROLES.AUDIENCE &&
    (layer === "privateMessage" || payload?.kind === "privateStage" || "privateMessage" in payload)
  ) {
    throw new TypeError("Private stage messages cannot be routed to audience output");
  }
  return true;
}
