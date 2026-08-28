function entrySectionId(entry) {
  if (typeof entry === "string") return entry.trim();
  return typeof entry?.sectionId === "string" ? entry.sectionId.trim() : "";
}

function uniqueEntryId(preferredId, sectionId, usedIds) {
  const preferred = typeof preferredId === "string" ? preferredId.trim() : "";
  const stem = preferred || `play_${sectionId || "section"}`;
  if (!usedIds.has(stem)) return stem;
  let suffix = 2;
  while (usedIds.has(`${stem}_${suffix}`)) suffix += 1;
  return `${stem}_${suffix}`;
}

function normalizedEntries(playOrder) {
  const usedIds = new Set();
  const entries = [];
  for (const entry of Array.isArray(playOrder) ? playOrder : []) {
    const sectionId = entrySectionId(entry);
    if (!sectionId) continue;
    const id = uniqueEntryId(
      typeof entry === "object" ? entry?.id : "",
      sectionId,
      usedIds,
    );
    usedIds.add(id);
    entries.push({
      ...(entry && typeof entry === "object" ? entry : {}),
      id,
      sectionId,
      enabled: entry?.enabled !== false,
    });
  }
  return entries;
}

function insertedEntryId(sectionId, entries, preferredId) {
  return uniqueEntryId(
    preferredId,
    sectionId,
    new Set(entries.map((entry) => entry.id)),
  );
}

export function insertSongPlayOrderEntry(
  playOrder,
  sectionId,
  { index, id, enabled = true } = {},
) {
  const normalizedSectionId = String(sectionId || "").trim();
  const entries = normalizedEntries(playOrder);
  if (!normalizedSectionId) return entries;
  const insertionIndex = Number.isInteger(index)
    ? Math.max(0, Math.min(index, entries.length))
    : entries.length;
  entries.splice(insertionIndex, 0, {
    id: insertedEntryId(normalizedSectionId, entries, id),
    sectionId: normalizedSectionId,
    enabled: enabled !== false,
  });
  return entries;
}

export function repeatSongPlayOrderEntry(playOrder, entryId, { index, id } = {}) {
  const entries = normalizedEntries(playOrder);
  const sourceIndex = entries.findIndex((entry) => entry.id === entryId);
  if (sourceIndex < 0) return entries;
  const source = entries[sourceIndex];
  return insertSongPlayOrderEntry(entries, source.sectionId, {
    index: Number.isInteger(index) ? index : sourceIndex + 1,
    id,
    enabled: source.enabled,
  });
}

export function reorderSongPlayOrderEntry(playOrder, entryId, toIndex) {
  const entries = normalizedEntries(playOrder);
  const fromIndex = entries.findIndex((entry) => entry.id === entryId);
  if (fromIndex < 0 || !Number.isInteger(toIndex)) return entries;
  const [entry] = entries.splice(fromIndex, 1);
  entries.splice(Math.max(0, Math.min(toIndex, entries.length)), 0, entry);
  return entries;
}

export function removeSongPlayOrderEntry(playOrder, entryId) {
  return normalizedEntries(playOrder).filter((entry) => entry.id !== entryId);
}

export function setSongPlayOrderEntryEnabled(playOrder, entryId, enabled) {
  return normalizedEntries(playOrder).map((entry) =>
    entry.id === entryId ? { ...entry, enabled: enabled !== false } : entry,
  );
}

export function resetSongPlayOrderToSectionOrder(playOrder, sections) {
  const entries = normalizedEntries(playOrder);
  const availableBySection = new Map();
  for (const entry of entries) {
    const available = availableBySection.get(entry.sectionId) || [];
    available.push(entry);
    availableBySection.set(entry.sectionId, available);
  }
  const usedIds = new Set();
  const reset = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    const sectionId = typeof section?.id === "string" ? section.id.trim() : "";
    if (!sectionId) continue;
    const retained = availableBySection.get(sectionId)?.shift();
    const id = uniqueEntryId(retained?.id, sectionId, usedIds);
    usedIds.add(id);
    reset.push({
      ...(retained || {}),
      id,
      sectionId,
      enabled: true,
    });
  }
  return reset;
}

export function withSongPlayOrder(deck, playOrder) {
  if (!deck || typeof deck !== "object") return deck;
  const entries = normalizedEntries(playOrder);
  return {
    ...deck,
    playOrder: entries.map((entry) => ({ ...entry })),
    ...(deck.canonicalSong && typeof deck.canonicalSong === "object"
      ? {
          canonicalSong: {
            ...deck.canonicalSong,
            playOrder: entries.map((entry) => ({ ...entry })),
          },
        }
      : {}),
  };
}

function cursorId(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0) || null;
}

export function synchronizeSongQueueNavigationState(item) {
  if (!item || typeof item !== "object") return item;
  const currentSlideId = cursorId(item.currentSlideId, item.render?.currentSlideId);
  const currentSequenceEntryId = cursorId(
    item.currentSequenceEntryId,
    item.sequence?.currentSequenceEntryId,
    item.render?.currentSequenceEntryId,
  );
  return {
    ...item,
    currentSlideId,
    currentSequenceEntryId,
    sequence: {
      ...(item.sequence && typeof item.sequence === "object" ? item.sequence : {}),
      currentSequenceEntryId,
    },
    render: {
      ...(item.render && typeof item.render === "object" ? item.render : {}),
      currentSlideId,
      currentSequenceEntryId,
    },
  };
}

export function preserveSongQueueNavigationState(refreshedItem, previousItem) {
  if (!refreshedItem || typeof refreshedItem !== "object") return refreshedItem;
  const previous = synchronizeSongQueueNavigationState(previousItem || {});
  return synchronizeSongQueueNavigationState({
    ...refreshedItem,
    currentSlideId: previous.currentSlideId,
    currentSequenceEntryId: previous.currentSequenceEntryId,
    sequence: {
      ...(refreshedItem.sequence && typeof refreshedItem.sequence === "object"
        ? refreshedItem.sequence
        : {}),
      currentSequenceEntryId: previous.currentSequenceEntryId,
    },
    render: {
      ...(refreshedItem.render && typeof refreshedItem.render === "object"
        ? refreshedItem.render
        : {}),
      ...(previous.render?.currentSectionId
        ? { currentSectionId: previous.render.currentSectionId }
        : {}),
      currentSlideId: previous.currentSlideId,
      currentSequenceEntryId: previous.currentSequenceEntryId,
    },
  });
}
