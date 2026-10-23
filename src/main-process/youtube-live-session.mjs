/* Copyright (C) 2026 Christian Lockley — GPL-3.0-or-later */

function isSessionObject(session) {
  return (typeof session === "object" && session !== null) || typeof session === "function";
}

/**
 * Tracks YouTube live-HLS header mode independently for each Electron Session.
 * A WeakSet keeps Session lifetime owned by Electron instead of this registry.
 */
export function createYouTubeLiveSessionRegistry() {
  const activeSessions = new WeakSet();
  return Object.freeze({
    set(session, active) {
      if (!isSessionObject(session)) return false;
      if (active) activeSessions.add(session);
      else activeSessions.delete(session);
      return activeSessions.has(session);
    },
    has(session) {
      return isSessionObject(session) && activeSessions.has(session);
    },
  });
}
