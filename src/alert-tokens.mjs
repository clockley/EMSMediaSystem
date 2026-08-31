import {
  DEFAULT_ALERT_BACKGROUND_COLOR,
  DEFAULT_ALERT_TEXT_COLOR,
  normalizeAlertColor,
} from "./alert-colors.mjs";

export const ALERT_TEMPLATE_SCHEMA = "ems.alert-template.v1";

function formatDuration(milliseconds, allowOverrun = false) {
  const negative = milliseconds < 0;
  const absolute = Math.abs(milliseconds);
  if (negative && !allowOverrun) return "00:00";
  const total = Math.floor(absolute / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const value = `${hours ? `${hours}:` : ""}${String(minutes).padStart(hours ? 2 : 1, "0")}:${String(seconds).padStart(2, "0")}`;
  return negative ? `-${value}` : value;
}

export function normalizeAlertTemplate(input = {}) {
  const name = String(input.name || "").trim().slice(0, 100);
  const message = String(input.message || "").trim().slice(0, 1000);
  if (!name || !message) throw new TypeError("Alert templates require a name and message");
  return {
    schema: ALERT_TEMPLATE_SCHEMA,
    id: String(input.id || `template-${Date.now()}`),
    name,
    message,
    backgroundColor: normalizeAlertColor(input.backgroundColor, DEFAULT_ALERT_BACKGROUND_COLOR),
    textColor: normalizeAlertColor(input.textColor, DEFAULT_ALERT_TEXT_COLOR),
    mode: ["static", "scroll", "scroll-needed"].includes(input.mode) ? input.mode : "static",
    repeatCount: Math.max(1, Math.min(20, Number(input.repeatCount) || 1)),
    tokenDefinitions: input.tokenDefinitions && typeof input.tokenDefinitions === "object"
      ? structuredClone(input.tokenDefinitions)
      : {},
  };
}

export function resolveAlertTokens(message, definitions = {}, now = Date.now()) {
  return String(message || "").replace(/\{\{\s*([\w.-]+)(?::([^}]+))?\s*\}\}/g, (_match, name, inlineValue) => {
    if (name === "clock") {
      return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(new Date(now));
    }
    const definition = definitions[name] || {};
    if (name === "countdown" || definition.type === "countdown") {
      const target = Date.parse(inlineValue || definition.target || "");
      return Number.isFinite(target) ? formatDuration(target - now, definition.allowOverrun === true) : "--:--";
    }
    if (definition.type === "clock") {
      return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(new Date(now));
    }
    return String(definition.value ?? inlineValue ?? "");
  });
}
