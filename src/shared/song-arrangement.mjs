import { stableValueHash } from "./resolved-presentation.mjs";

function normalizedSequence(song, arrangementId, explicitSequence) {
  const arrangements = Array.isArray(song?.arrangements) ? song.arrangements : [];
  const arrangement =
    arrangements.find((entry) => entry?.id === arrangementId) ||
    arrangements[0] ||
    null;
  const sequence =
    Array.isArray(explicitSequence) && explicitSequence.length > 0
      ? explicitSequence
      : Array.isArray(arrangement?.sequence) && arrangement.sequence.length > 0
      ? arrangement.sequence
      : Array.isArray(song?.playOrder) && song.playOrder.length > 0
        ? song.playOrder
        : (Array.isArray(song?.sections) ? song.sections : []).map((section) => ({
            sectionId: section?.id,
            enabled: true,
          }));
  return {
    arrangementId: arrangement?.id || arrangementId || "arr_default",
    sequence,
  };
}

export function resolveSongArrangement(
  song,
  { arrangementId, sequence, includeDisabled = false } = {},
) {
  const sections = Array.isArray(song?.sections) ? song.sections.filter(Boolean) : [];
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const normalized = normalizedSequence(song, arrangementId, sequence);
  const idCounts = new Map();
  const sectionOccurrences = new Map();
  const entries = [];

  normalized.sequence.forEach((rawEntry, sequenceIndex) => {
    const entry =
      typeof rawEntry === "string"
        ? { sectionId: rawEntry, enabled: true }
        : rawEntry && typeof rawEntry === "object"
          ? rawEntry
          : {};
    const sectionId = String(entry.sectionId || entry.section || entry.id || "").trim();
    const section = sectionById.get(sectionId);
    if (!section) return;
    const enabled = entry.enabled !== false;
    const occurrenceIndex = sectionOccurrences.get(sectionId) || 0;
    sectionOccurrences.set(sectionId, occurrenceIndex + 1);

    const preferredId = String(entry.sequenceEntryId || entry.id || "").trim();
    const baseId =
      preferredId ||
      `seq_${stableValueHash({
        arrangementId: normalized.arrangementId,
        sectionId,
        occurrenceIndex,
      })}`;
    const duplicateIndex = idCounts.get(baseId) || 0;
    idCounts.set(baseId, duplicateIndex + 1);
    const sequenceEntryId = duplicateIndex === 0 ? baseId : `${baseId}_${duplicateIndex + 1}`;
    const resolved = {
      sequenceEntryId,
      id: sequenceEntryId,
      sectionId,
      section,
      sequenceIndex,
      occurrenceIndex,
      enabled,
      sourceEntry: entry,
    };
    if (enabled || includeDisabled) entries.push(resolved);
  });

  return {
    arrangementId: normalized.arrangementId,
    entries,
    enabledEntries: entries.filter((entry) => entry.enabled),
    sourceRevision: stableValueHash({
      songId: song?.id || "",
      sections,
      arrangementId: normalized.arrangementId,
      sequence: normalized.sequence,
    }),
  };
}

export function songSequenceEntry(
  arrangement,
  { sequenceEntryId, sectionId, occurrenceIndex } = {},
) {
  const entries = Array.isArray(arrangement?.enabledEntries)
    ? arrangement.enabledEntries
    : Array.isArray(arrangement?.entries)
      ? arrangement.entries.filter((entry) => entry?.enabled !== false)
      : [];
  if (sequenceEntryId) {
    const exact = entries.find((entry) => entry.sequenceEntryId === sequenceEntryId);
    if (exact) return exact;
  }
  if (sectionId) {
    const matching = entries.filter((entry) => entry.sectionId === sectionId);
    const index = Number.isFinite(occurrenceIndex) ? Math.max(0, occurrenceIndex) : 0;
    if (matching[index]) return matching[index];
  }
  return entries[0] || null;
}
