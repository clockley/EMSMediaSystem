import {
  DEFAULT_ALERT_BACKGROUND_COLOR,
  DEFAULT_ALERT_TEXT_COLOR,
  normalizeAlertColor,
} from "./alert-colors.mjs";

export const NURSERY_ALERTS_SCHEMA = "ems.nursery-alerts.v1";

export function createNurseryAlertsState() {
  return { schema: NURSERY_ALERTS_SCHEMA, revision: 0, alerts: [] };
}

export function addNurseryAlert(state, input, now = Date.now()) {
  const current = state?.schema === NURSERY_ALERTS_SCHEMA ? state : createNurseryAlertsState();
  const identifier = String(input?.identifier || input?.message || "").trim().slice(0, 50);
  if (!identifier) throw new TypeError("A nursery identifier is required");
  const durationMs = Math.max(0, Math.min(300000, Number(input?.durationMs) || 15000));
  const alert = {
    id: String(input?.id || `nursery-${now}-${current.revision + 1}`),
    identifier,
    backgroundColor: normalizeAlertColor(input?.backgroundColor, DEFAULT_ALERT_BACKGROUND_COLOR),
    textColor: normalizeAlertColor(input?.textColor, DEFAULT_ALERT_TEXT_COLOR),
    shownAt: now,
    expiresAt: durationMs > 0 ? now + durationMs : null,
  };
  return { ...current, revision: current.revision + 1, alerts: [...current.alerts, alert] };
}

export function removeNurseryAlert(state, id) {
  const current = state?.schema === NURSERY_ALERTS_SCHEMA ? state : createNurseryAlertsState();
  const alerts = current.alerts.filter((alert) => alert.id !== id);
  return alerts.length === current.alerts.length ? current : { ...current, revision: current.revision + 1, alerts };
}

export function expireNurseryAlerts(state, now = Date.now()) {
  const current = state?.schema === NURSERY_ALERTS_SCHEMA ? state : createNurseryAlertsState();
  const alerts = current.alerts.filter((alert) => !alert.expiresAt || alert.expiresAt > now);
  return alerts.length === current.alerts.length ? current : { ...current, revision: current.revision + 1, alerts };
}

export function nextNurseryDeadline(state) {
  const deadlines = (state?.alerts || []).map((alert) => alert.expiresAt).filter(Number.isFinite);
  return deadlines.length ? Math.min(...deadlines) : null;
}
