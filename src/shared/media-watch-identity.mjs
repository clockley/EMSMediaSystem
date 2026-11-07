/*
Copyright (C) 2026 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/** Keep watcher notifications tied to cue objects as the schedule is reordered. */
export function createMediaWatchIdentityRegistry() {
  const ids = new WeakMap();
  const sessionId = globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let sequence = 0;

  return {
    idFor(item) {
      if (!item || typeof item !== "object") return "";
      let id = ids.get(item);
      if (!id) {
        id = `media-watch-${sessionId}-${++sequence}`;
        ids.set(item, id);
      }
      return id;
    },
    matches(item, id) {
      return Boolean(item && typeof item === "object" && ids.get(item) === String(id));
    },
  };
}
