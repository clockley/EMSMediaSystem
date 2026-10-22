export function isWindowTiled(bounds, displayBounds) {
  if (!bounds || !displayBounds) return false;
  const values = [
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    displayBounds.x,
    displayBounds.y,
    displayBounds.width,
    displayBounds.height,
  ];
  if (!values.every(Number.isFinite)) return false;

  const touchingEdges = [
    bounds.x === displayBounds.x,
    bounds.y === displayBounds.y,
    bounds.x + bounds.width === displayBounds.x + displayBounds.width,
    bounds.y + bounds.height === displayBounds.y + displayBounds.height,
  ];
  return touchingEdges.filter(Boolean).length >= 2;
}

export function isWindowOnConnectedDisplay(bounds, displays) {
  if (!bounds || !Array.isArray(displays)) return false;
  return displays.some((display) => {
    const displayBounds = display?.bounds;
    if (!displayBounds) return false;
    return (
      bounds.x >= displayBounds.x &&
      bounds.y >= displayBounds.y &&
      bounds.x < displayBounds.x + displayBounds.width &&
      bounds.y < displayBounds.y + displayBounds.height
    );
  });
}
