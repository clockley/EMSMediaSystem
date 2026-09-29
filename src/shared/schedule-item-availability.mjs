import { bibleUriPrefix, songUriPrefix } from "./app-media-utils.mjs";
import { slideDeckUriPrefix } from "./app-slide-utils.mjs";

export function isBibleScheduleItem(item) {
  return Boolean(
    item && (item.type === "bible" || item.path?.startsWith?.(bibleUriPrefix)),
  );
}

export function isScheduleSectionItem(item) {
  return Boolean(item && item.type === "section");
}

export function scheduleSectionIndexForItem(items, itemIndex) {
  const list = Array.isArray(items) ? items : [];
  if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= list.length) {
    return -1;
  }
  for (let index = itemIndex; index >= 0; index -= 1) {
    if (isScheduleSectionItem(list[index])) return index;
  }
  return -1;
}

export function scheduleSectionEndIndex(items, sectionIndex) {
  const list = Array.isArray(items) ? items : [];
  if (
    !Number.isInteger(sectionIndex) ||
    sectionIndex < 0 ||
    sectionIndex >= list.length ||
    !isScheduleSectionItem(list[sectionIndex])
  ) {
    return Math.max(0, Math.min(Number.isInteger(sectionIndex) ? sectionIndex + 1 : 0, list.length));
  }
  for (let index = sectionIndex + 1; index < list.length; index += 1) {
    if (isScheduleSectionItem(list[index])) return index;
  }
  return list.length;
}

export function scheduleInsertionIndexAfterItem(items, itemIndex) {
  const list = Array.isArray(items) ? items : [];
  if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= list.length) {
    return list.length;
  }
  return isScheduleSectionItem(list[itemIndex])
    ? scheduleSectionEndIndex(list, itemIndex)
    : itemIndex + 1;
}

export function scheduleSectionIndexForInsertion(items, insertIndex) {
  const list = Array.isArray(items) ? items : [];
  const boundary = Math.max(
    0,
    Math.min(Number.isInteger(insertIndex) ? insertIndex : list.length, list.length),
  );
  for (let index = boundary - 1; index >= 0; index -= 1) {
    if (isScheduleSectionItem(list[index])) return index;
  }
  return -1;
}

export function scheduleDropPlacementForTarget(
  items,
  targetIndex,
  { afterTarget = false } = {},
) {
  const list = Array.isArray(items) ? items : [];
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= list.length) {
    const insertIndex = list.length;
    const sectionIndex = scheduleSectionIndexForInsertion(list, insertIndex);
    return {
      insertIndex,
      sectionIndex,
      targetIndex: -1,
      kind:
        sectionIndex >= 0 && scheduleSectionEndIndex(list, sectionIndex) === insertIndex
          ? "section-end"
          : "schedule-end",
    };
  }

  if (isScheduleSectionItem(list[targetIndex])) {
    return {
      insertIndex: scheduleSectionEndIndex(list, targetIndex),
      sectionIndex: targetIndex,
      targetIndex,
      kind: "section-end",
    };
  }

  const insertIndex = targetIndex + (afterTarget ? 1 : 0);
  const sectionIndex = scheduleSectionIndexForInsertion(list, insertIndex);
  return {
    insertIndex,
    sectionIndex,
    targetIndex,
    kind:
      sectionIndex >= 0 && scheduleSectionEndIndex(list, sectionIndex) === insertIndex
        ? "section-end"
        : afterTarget
          ? "after-item"
          : "before-item",
  };
}

export function scheduleSectionBlockDropPlacement(
  items,
  targetIndex,
  { afterSection = false } = {},
) {
  const list = Array.isArray(items) ? items : [];
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= list.length) {
    return {
      insertIndex: list.length,
      sectionIndex: scheduleSectionIndexForInsertion(list, list.length),
      targetIndex: -1,
      kind: "schedule-end",
    };
  }

  const sectionIndex = scheduleSectionIndexForItem(list, targetIndex);
  if (sectionIndex >= 0) {
    return {
      insertIndex: afterSection
        ? scheduleSectionEndIndex(list, sectionIndex)
        : sectionIndex,
      sectionIndex,
      targetIndex,
      kind: afterSection ? "after-section" : "before-section",
    };
  }

  const nextSectionIndex = list.findIndex(
    (item, index) => index > targetIndex && isScheduleSectionItem(item),
  );
  return {
    insertIndex: nextSectionIndex >= 0 ? nextSectionIndex : list.length,
    sectionIndex: nextSectionIndex,
    targetIndex,
    kind: nextSectionIndex >= 0 ? "before-section" : "schedule-end",
  };
}

export function reorderScheduleItemsAtInsertion(items, movingIndexes, rawInsertIndex) {
  const list = Array.isArray(items) ? items : [];
  const indexes = [...new Set(Array.isArray(movingIndexes) ? movingIndexes : [])]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < list.length)
    .sort((a, b) => a - b);
  if (!indexes.length) {
    return { items: [...list], insertIndex: list.length, changed: false };
  }

  const indexSet = new Set(indexes);
  const movingItems = indexes.map((index) => list[index]);
  const remaining = list.filter((_, index) => !indexSet.has(index));
  const boundary = Math.max(
    0,
    Math.min(Number.isInteger(rawInsertIndex) ? rawInsertIndex : list.length, list.length),
  );
  const removedBeforeBoundary = indexes.filter((index) => index < boundary).length;
  const insertIndex = Math.max(
    0,
    Math.min(boundary - removedBeforeBoundary, remaining.length),
  );
  remaining.splice(insertIndex, 0, ...movingItems);
  return {
    items: remaining,
    insertIndex,
    changed: remaining.some((item, index) => item !== list[index]),
  };
}

export function isEmbeddedScheduleItem(item) {
  if (!item) return false;
  return Boolean(
    isBibleScheduleItem(item) ||
      item.type === "song" ||
      item.path?.startsWith?.(songUriPrefix) ||
      item.songSnapshot ||
      item.type === "deck" ||
      item.path?.startsWith?.(slideDeckUriPrefix) ||
      item.source?.kind === "deck" ||
      item.source?.deckId ||
      item.deckSnapshot,
  );
}

export function isScheduleItemVisible(item, { bibleUiEnabled = true } = {}) {
  if (!item) return false;
  if (!bibleUiEnabled && isBibleScheduleItem(item)) return false;
  return true;
}

export function isScheduleItemPlayable(item, { bibleUiEnabled = true } = {}) {
  if (!isScheduleItemVisible(item, { bibleUiEnabled })) return false;
  if (isScheduleSectionItem(item)) return false;
  if (item.missing === true && !isEmbeddedScheduleItem(item)) return false;
  return true;
}

export function nextPlayableScheduleIndex(
  items,
  fromIndex,
  { bibleUiEnabled = true } = {},
) {
  const list = Array.isArray(items) ? items : [];
  const start = Number.isInteger(fromIndex) ? fromIndex : -1;
  for (let index = start + 1; index < list.length; index += 1) {
    if (isScheduleItemPlayable(list[index], { bibleUiEnabled })) return index;
  }
  return -1;
}

export function previousPlayableScheduleIndex(
  items,
  fromIndex,
  { bibleUiEnabled = true } = {},
) {
  const list = Array.isArray(items) ? items : [];
  const start = Number.isInteger(fromIndex) ? fromIndex : list.length;
  for (let index = start - 1; index >= 0; index -= 1) {
    if (isScheduleItemPlayable(list[index], { bibleUiEnabled })) return index;
  }
  return -1;
}

export function firstPlayableScheduleIndex(items, options = {}) {
  return nextPlayableScheduleIndex(items, -1, options);
}
