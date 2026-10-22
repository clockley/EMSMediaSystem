/*
Copyright (C) 2026 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/**
 * Queue entries are runtime documents, not just media paths. Songs, slide
 * decks, Scripture, pinned media and per-item themes all carry nested state.
 * Clear/Undo therefore snapshots the complete data graph instead of keeping a
 * second hand-written list of fields that can drift from the queue schema.
 */
function cloneScheduleQueueForUndo(items) {
  if (!Array.isArray(items)) {
    throw new TypeError("A schedule Undo snapshot requires an array of queue items");
  }
  return structuredClone(items);
}

function restoreScheduleQueueFromUndo(items) {
  return cloneScheduleQueueForUndo(items);
}

export {
  cloneScheduleQueueForUndo,
  restoreScheduleQueueFromUndo,
};
