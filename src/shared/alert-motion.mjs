export const DEFAULT_TICKER_SPEED_PX_PER_SECOND = 96;

export function tickerDurationSeconds({
  viewportWidth,
  textWidth,
  speed = DEFAULT_TICKER_SPEED_PX_PER_SECOND,
} = {}) {
  const distance = Math.max(0, Number(viewportWidth) || 0) + Math.max(0, Number(textWidth) || 0);
  const pixelsPerSecond = Math.max(40, Math.min(240, Number(speed) || DEFAULT_TICKER_SPEED_PX_PER_SECOND));
  return Math.max(8, Math.min(45, distance / pixelsPerSecond));
}

export function tickerPhaseDelaySeconds({ shownAt, now = Date.now(), duration } = {}) {
  const started = Number(shownAt);
  const cycle = Number(duration);
  if (!Number.isFinite(started) || !Number.isFinite(cycle) || cycle <= 0) return 0;
  return -(Math.max(0, Number(now) - started) / 1000 % cycle);
}
