export function themeSafeMargin(value, fallback = 0.06) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function themeBackdropCornerRadius(value, fallback = 8) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
