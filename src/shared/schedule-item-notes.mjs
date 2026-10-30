/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/*
 * Schedule item notes: operator-only text attached to a schedule cue or group.
 *
 * Notes are never part of audience or lower-third payloads. A note reaches the
 * stage/foldback output only when its `notesOnStage` flag is set.
 */

export const SCHEDULE_NOTE_MAX_LENGTH = 2000;

/** Queue-item keys owned by the notes feature (preserve these on item rebuilds). */
export const SCHEDULE_NOTE_FIELDS = Object.freeze(["notes", "notesOnStage"]);

/**
 * Canonical persisted form: LF line endings, no trailing whitespace on lines,
 * no leading/trailing blank lines, capped length. Returns "" for non-strings.
 */
export function normalizeScheduleNoteText(value) {
  if (typeof value !== "string") return "";
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/^\s*\n/, "")
    .trim();
  return text.length > SCHEDULE_NOTE_MAX_LENGTH
    ? text.slice(0, SCHEDULE_NOTE_MAX_LENGTH).trimEnd()
    : text;
}

export function scheduleItemNoteText(item) {
  return normalizeScheduleNoteText(item?.notes);
}

export function scheduleItemHasNote(item) {
  return scheduleItemNoteText(item).length > 0;
}

/**
 * Fields to spread into a persisted cue/section record. Empty notes are
 * omitted entirely so projects without notes are byte-for-byte unchanged.
 */
export function scheduleNoteFields(item) {
  const notes = scheduleItemNoteText(item);
  if (!notes) return {};
  return item?.notesOnStage === true ? { notes, notesOnStage: true } : { notes };
}

/** Copy note fields from one queue item onto a rebuilt/replacement item. */
export function copyScheduleNoteFields(source, target) {
  if (!target || typeof target !== "object") return target;
  for (const key of SCHEDULE_NOTE_FIELDS) delete target[key];
  Object.assign(target, scheduleNoteFields(source));
  return target;
}

/**
 * Compact single-line preview for schedule rows.
 * Returns { text, truncated } where `truncated` means more content exists.
 */
export function scheduleNotePreview(value, maxLength = 140) {
  const text = normalizeScheduleNoteText(value);
  if (!text) return { text: "", truncated: false };
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const first = lines[0] || "";
  const clipped = first.length > maxLength ? `${first.slice(0, maxLength - 1).trimEnd()}…` : first;
  return { text: clipped, truncated: lines.length > 1 || clipped !== first };
}

/** Join non-empty note parts with a blank line, in the given order. */
export function mergeStageNotes(...parts) {
  return parts
    .flat()
    .map((part) => normalizeScheduleNoteText(part))
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Notes for the stage output for a live cue: the containing group's note
 * first (service-block context), then the cue's own note. Only notes that
 * opted in with `notesOnStage` are included.
 */
export function scheduleItemStageNotes(item, groupItem = null) {
  const stageText = (entry) =>
    entry?.notesOnStage === true ? scheduleItemNoteText(entry) : "";
  return mergeStageNotes(stageText(groupItem), stageText(item));
}

/** The group (section) entry a cue belongs to, resolved by stable `groupId`. */
export function scheduleGroupForItem(items, item) {
  if (!item || item.type === "section") return null;
  const groupId = typeof item.groupId === "string" ? item.groupId.trim() : "";
  if (!groupId) return null;
  return (Array.isArray(items) ? items : []).find(
    (entry) => entry?.type === "section" && entry.id === groupId,
  ) || null;
}
