import { normalizeAlert } from "./alert-routing.mjs";

export const ALERT_STATE_SCHEMA = "ems.alert-state.v1";

function repeatCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) ? Math.max(1, Math.min(20, count)) : 1;
}

function nextRevision(state) {
  return Number.isSafeInteger(state?.revision) ? state.revision + 1 : 1;
}

export function createAlertState() {
  return { schema: ALERT_STATE_SCHEMA, revision: 0, live: null, queue: [] };
}

export function prepareAlert(input, now = Date.now()) {
  const alert = normalizeAlert(input);
  const repeats = repeatCount(input.repeatCount);
  return {
    ...alert,
    id: alert.id || `alert-${now}`,
    repeatCount: repeats,
    repeatsRemaining: repeats,
    lifecycle: "queued",
    queuedAt: now,
    shownAt: null,
    expiresAt: null,
  };
}

function makeLive(alert, now) {
  const countdownTarget = alert.dismissAtCountdownEnd
    ? Date.parse(alert.tokenDefinitions?.countdown?.target || "")
    : NaN;
  return {
    ...alert,
    lifecycle: "live",
    shownAt: now,
    expiresAt: Number.isFinite(countdownTarget)
      ? Math.max(now, countdownTarget)
      : alert.durationMs > 0
        ? now + alert.durationMs
        : null,
  };
}

function priorityRank(alert) {
  return alert?.priority === "high" ? 1 : 0;
}

export function showAlert(state, input, now = Date.now()) {
  const current = state?.schema === ALERT_STATE_SCHEMA ? state : createAlertState();
  const alert = prepareAlert(input, now);
  const live = current.live;
  if (live && priorityRank(live) >= priorityRank(alert)) {
    return {
      ...current,
      revision: nextRevision(current),
      queue: [...current.queue, alert],
    };
  }
  const displaced = live ? [{ ...live, lifecycle: "queued", queuedAt: now }] : [];
  return {
    ...current,
    revision: nextRevision(current),
    live: makeLive(alert, now),
    queue: [...displaced, ...current.queue],
  };
}

function takeNext(queue, now) {
  if (!queue.length) return { live: null, queue: [] };
  let selected = 0;
  for (let index = 1; index < queue.length; index += 1) {
    if (priorityRank(queue[index]) > priorityRank(queue[selected])) selected = index;
  }
  const next = queue[selected];
  return {
    live: makeLive(next, now),
    queue: queue.filter((_item, index) => index !== selected),
  };
}

export function clearAlert(state, { id = null, route = null } = {}, now = Date.now()) {
  const current = state?.schema === ALERT_STATE_SCHEMA ? state : createAlertState();
  const matches = (alert) =>
    alert && (!id || alert.id === id) && (!route || alert.routes?.[route] === true);
  const queue = current.queue.filter((alert) => !matches(alert));
  if (!matches(current.live)) {
    return queue.length === current.queue.length
      ? current
      : { ...current, revision: nextRevision(current), queue };
  }
  const promoted = takeNext(queue, now);
  return { ...current, revision: nextRevision(current), ...promoted };
}

export function dismissLiveAlert(state, now = Date.now()) {
  const current = state?.schema === ALERT_STATE_SCHEMA ? state : createAlertState();
  if (!current.live) return current;
  const promoted = takeNext(current.queue, now);
  return { ...current, revision: nextRevision(current), ...promoted };
}

export function removeAlert(state, id, now = Date.now()) {
  const current = state?.schema === ALERT_STATE_SCHEMA ? state : createAlertState();
  if (!id) return current;
  if (current.live?.id === id) return dismissLiveAlert(current, now);
  const queue = current.queue.filter((alert) => alert.id !== id);
  return queue.length === current.queue.length
    ? current
    : { ...current, revision: nextRevision(current), queue };
}

export function prioritizeAlert(state, id, now = Date.now()) {
  const current = state?.schema === ALERT_STATE_SCHEMA ? state : createAlertState();
  if (current.live?.id === id) {
    return { ...current, revision: nextRevision(current), live: { ...current.live, priority: "high", expiresAt: null } };
  }
  const selected = current.queue.find((alert) => alert.id === id);
  if (!selected) return current;
  const queue = current.queue.filter((alert) => alert.id !== id);
  if (current.live) queue.unshift({ ...current.live, lifecycle: "queued", queuedAt: now });
  return {
    ...current,
    revision: nextRevision(current),
    live: makeLive({ ...selected, priority: "high" }, now),
    queue,
  };
}

export function advanceAlertState(state, now = Date.now()) {
  const current = state?.schema === ALERT_STATE_SCHEMA ? state : createAlertState();
  if (!current.live?.expiresAt || now < current.live.expiresAt) return current;
  if (!current.live.dismissAtCountdownEnd && current.live.repeatsRemaining > 1) {
    const repeated = {
      ...current.live,
      repeatsRemaining: current.live.repeatsRemaining - 1,
    };
    return {
      ...current,
      revision: nextRevision(current),
      live: makeLive(repeated, now),
    };
  }
  const promoted = takeNext(current.queue, now);
  return { ...current, revision: nextRevision(current), ...promoted };
}

export function nextAlertDeadline(state) {
  return Number.isFinite(state?.live?.expiresAt) ? state.live.expiresAt : null;
}
