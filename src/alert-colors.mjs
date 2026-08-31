const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const DEFAULT_ALERT_BACKGROUND_COLOR = "#7a1010";
export const DEFAULT_ALERT_TEXT_COLOR = "#ffffff";

export function normalizeAlertColor(value, fallback) {
  const color = String(value || "").trim();
  return HEX_COLOR.test(color) ? color.toLowerCase() : fallback;
}
