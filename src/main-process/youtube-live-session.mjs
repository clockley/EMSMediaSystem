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

/**
 * Gives each renderer its own monotonic YouTube-resolution token. A resolved
 * URL may change shared Electron Session headers only while its token is still
 * the renderer's newest request.
 */
export function createYouTubeResolutionRegistry() {
  const currentRequests = new WeakMap();
  let nextToken = 0;

  const newToken = () => {
    nextToken += 1;
    if (!Number.isSafeInteger(nextToken)) nextToken = 1;
    return nextToken;
  };

  return Object.freeze({
    begin(owner) {
      if (!isSessionObject(owner)) return 0;
      const token = newToken();
      currentRequests.set(owner, { token, value: undefined });
      return token;
    },
    invalidate(owner) {
      if (!isSessionObject(owner)) return false;
      currentRequests.set(owner, { token: newToken(), value: undefined });
      return true;
    },
    isCurrent(owner, token) {
      return (
        isSessionObject(owner) &&
        Number.isSafeInteger(token) &&
        token > 0 &&
        currentRequests.get(owner)?.token === token
      );
    },
    complete(owner, token, value) {
      if (
        !isSessionObject(owner) ||
        !Number.isSafeInteger(token) ||
        currentRequests.get(owner)?.token !== token
      ) {
        return false;
      }
      currentRequests.set(owner, { token, value });
      return true;
    },
    value(owner, token) {
      const request = isSessionObject(owner)
        ? currentRequests.get(owner)
        : undefined;
      return request?.token === token ? request.value : undefined;
    },
  });
}
