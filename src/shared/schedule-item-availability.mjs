import { bibleUriPrefix, songUriPrefix } from "./app-media-utils.mjs";
import { slideDeckUriPrefix } from "./app-slide-utils.mjs";

export function isBibleScheduleItem(item) {
  return Boolean(
    item && (item.type === "bible" || item.path?.startsWith?.(bibleUriPrefix)),
  );
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
