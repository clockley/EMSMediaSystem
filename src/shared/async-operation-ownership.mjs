/*
Copyright (C) 2026 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/**
 * Creates a monotonic ownership gate for asynchronous UI work.
 *
 * Starting or invalidating a request permanently supersedes every older
 * token.  An optional owner can be captured with the token so callers that
 * edit mutable workspace state can require both "latest request" and stable
 * object identity before committing a result.
 */
export function createLatestRequestGate() {
  let revision = 0;

  return Object.freeze({
    begin(owner = undefined) {
      revision += 1;
      return Object.freeze({ revision, owner });
    },

    invalidate() {
      revision += 1;
      return revision;
    },

    isCurrent(request) {
      return Boolean(request) && request.revision === revision;
    },

    owns(request, owner) {
      return Boolean(request) && request.revision === revision && request.owner === owner;
    },

    currentRevision() {
      return revision;
    },
  });
}

/**
 * Runs asynchronous operations one at a time in submission order. A rejected
 * operation does not poison the queue, while its own caller still receives the
 * rejection. This is useful for multi-step state transactions whose individual
 * awaits must not interleave with the next transaction.
 */
export function createSerializedAsyncQueue() {
  let tail = Promise.resolve();

  return Object.freeze({
    run(operation) {
      if (typeof operation !== "function") {
        throw new TypeError("A serialized operation must be a function");
      }
      const result = tail.catch(() => {}).then(operation);
      tail = result.catch(() => {});
      return result;
    },
  });
}

/**
 * Coalesces repeated UI actions for the same logical target while the first
 * action is running and for a short cooldown after it completes.  The cooldown
 * covers the two separate `click` tasks emitted by a physical double-click;
 * an in-flight flag alone is not sufficient for synchronous insertions.
 */
export function createAsyncActionCoalescer({ cooldownMs = 400, now = Date.now } = {}) {
  const activeKeys = new Set();
  const cooldownUntilByKey = new Map();
  const normalizedCooldown = Math.max(0, Number(cooldownMs) || 0);

  return Object.freeze({
    async run(key, operation) {
      if (typeof operation !== "function") {
        throw new TypeError("A coalesced action requires an operation");
      }
      const normalizedKey = String(key || "default");
      const currentTime = Number(now()) || 0;
      const cooldownUntil = cooldownUntilByKey.get(normalizedKey) || 0;
      if (activeKeys.has(normalizedKey) || currentTime < cooldownUntil) {
        return false;
      }

      activeKeys.add(normalizedKey);
      try {
        return await operation();
      } finally {
        activeKeys.delete(normalizedKey);
        cooldownUntilByKey.set(
          normalizedKey,
          (Number(now()) || currentTime) + normalizedCooldown,
        );
        // Keep the map bounded without installing timers that outlive tests or
        // short-lived renderer documents.
        if (cooldownUntilByKey.size > 256) {
          const cleanupTime = Number(now()) || currentTime;
          for (const [candidateKey, expiresAt] of cooldownUntilByKey) {
            if (expiresAt <= cleanupTime) cooldownUntilByKey.delete(candidateKey);
          }
        }
      }
    },

    isActive(key) {
      return activeKeys.has(String(key || "default"));
    },
  });
}
