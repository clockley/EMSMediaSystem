/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

const SEEK_EVENTS = new Set(["seeking", "seeked"]);

/**
 * Suppresses only the media-element events caused by a mirror synchronization.
 *
 * A long-lived global boolean cannot distinguish a projection sync from an
 * operator action. This guard instead owns short, per-element operations. Seek
 * operations are also tied to their requested position: if the element moves
 * to a different position, the sync has been superseded and its suppression is
 * cancelled synchronously so the operator event can be forwarded.
 */
class MediaElementForwardingSuppression {
  constructor(options = {}) {
    this.operationsByElement = new WeakMap();
    this.seekToleranceSeconds = options.seekToleranceSeconds ?? 0.25;
    this.settleDelayMs = options.settleDelayMs ?? 25;
    this.noSeekGraceMs = options.noSeekGraceMs ?? 100;
    this.seekTimeoutMs = options.seekTimeoutMs ?? 1500;
    this.pauseTimeoutMs = options.pauseTimeoutMs ?? 500;
    this.setTimer = options.setTimer ?? globalThis.setTimeout.bind(globalThis);
    this.clearTimer = options.clearTimer ?? globalThis.clearTimeout.bind(globalThis);
  }

  _operations(mediaEl, create = false) {
    let operations = this.operationsByElement.get(mediaEl);
    if (!operations && create) {
      operations = new Set();
      this.operationsByElement.set(mediaEl, operations);
    }
    return operations || null;
  }

  _finish(operation, reason = "settled") {
    if (!operation?.active) return;
    operation.active = false;
    if (operation.hardTimer !== null) this.clearTimer(operation.hardTimer);
    if (operation.settleTimer !== null) this.clearTimer(operation.settleTimer);
    for (const [eventName, listener] of operation.listeners) {
      operation.mediaEl.removeEventListener(eventName, listener);
    }
    operation.listeners.length = 0;

    const operations = this._operations(operation.mediaEl);
    operations?.delete(operation);
    if (operations?.size === 0) {
      this.operationsByElement.delete(operation.mediaEl);
    }
    operation.resolve(reason);
  }

  _start(mediaEl, kind, eventNames, timeoutMs, targetTime = null) {
    // The newest projection state owns the mirror. Keeping an older operation
    // alive would let one eventual event complete both unrelated requests.
    for (const operation of [...(this._operations(mediaEl) || [])]) {
      if (operation.kind === kind) this._finish(operation, "superseded");
    }
    // Finishing the last old operation removes the WeakMap entry, so acquire
    // the replacement set only after superseded operations have been drained.
    const operations = this._operations(mediaEl, true);

    let resolve;
    const done = new Promise((settle) => {
      resolve = settle;
    });
    const operation = {
      active: true,
      done,
      eventNames: new Set(eventNames),
      hardTimer: null,
      kind,
      listeners: [],
      mediaEl,
      resolve,
      sawSeeking: false,
      settleTimer: null,
      targetTime,
    };
    operations.add(operation);
    operation.hardTimer = this.setTimer(
      () => this._finish(operation, "timeout"),
      timeoutMs,
    );
    return operation;
  }

  _listen(operation, eventName, listener) {
    operation.mediaEl.addEventListener(eventName, listener);
    operation.listeners.push([eventName, listener]);
  }

  _seekMatches(operation) {
    const actual = Number(operation.mediaEl.currentTime);
    return (
      Number.isFinite(actual) &&
      Number.isFinite(operation.targetTime) &&
      Math.abs(actual - operation.targetTime) <= this.seekToleranceSeconds
    );
  }

  _scheduleSettled(operation, delayMs = this.settleDelayMs) {
    if (!operation.active) return;
    if (operation.settleTimer !== null) this.clearTimer(operation.settleTimer);
    operation.settleTimer = this.setTimer(() => {
      operation.settleTimer = null;
      if (!operation.active) return;
      // A stale queued seeked event can arrive while the replacement seek is
      // still running. Keep the guard until the element itself says it has
      // settled; a later seeking/seeked pair resets this drain timer.
      if (operation.kind === "seek" && operation.mediaEl.seeking) {
        this._scheduleSettled(operation);
        return;
      }
      this._finish(operation);
    }, delayMs);
  }

  /**
   * Called by the permanent media handlers. Returns true only when this exact
   * element/event family belongs to a pending projection-to-preview sync.
   */
  shouldSuppress(mediaEl, eventName) {
    const operations = this._operations(mediaEl);
    if (!operations) return false;

    let suppress = false;
    for (const operation of [...operations]) {
      if (!operation.active || !operation.eventNames.has(eventName)) continue;
      if (
        operation.kind === "seek" &&
        SEEK_EVENTS.has(eventName) &&
        !this._seekMatches(operation)
      ) {
        // A different position is operator intent (or a newer owner). Remove
        // this operation before returning so the current event is forwarded.
        this._finish(operation, "superseded");
        continue;
      }
      suppress = true;
    }
    return suppress;
  }

  /**
   * Seek as mirror synchronization and wait until its own event sequence has
   * drained. A seeked that was already queued before this call is ignored
   * unless a matching seeking event has also been observed.
   */
  suppressSeek(mediaEl, requestedTime) {
    if (!mediaEl || !Number.isFinite(requestedTime)) return Promise.resolve("ignored");
    const operation = this._start(
      mediaEl,
      "seek",
      SEEK_EVENTS,
      this.seekTimeoutMs,
      requestedTime,
    );

    this._listen(operation, "seeking", () => {
      if (!operation.active) return;
      if (!this._seekMatches(operation)) {
        this._finish(operation, "superseded");
        return;
      }
      operation.sawSeeking = true;
      if (operation.settleTimer !== null) {
        this.clearTimer(operation.settleTimer);
        operation.settleTimer = null;
      }
    });
    this._listen(operation, "seeked", () => {
      if (!operation.active) return;
      if (!this._seekMatches(operation)) {
        this._finish(operation, "superseded");
        return;
      }
      // This can be a seeked task queued by an operation that completed before
      // our currentTime write. It cannot complete the new operation by itself.
      if (!operation.sawSeeking) return;
      this._scheduleSettled(operation);
    });
    this._listen(operation, "error", () => this._finish(operation, "error"));

    try {
      mediaEl.currentTime = requestedTime;
      // currentTime reports the normalized/clamped seek target while seeking.
      // Track that value so a browser adjustment is not mistaken for a user
      // override, while a later operator write still cancels the operation.
      if (Number.isFinite(mediaEl.currentTime)) {
        operation.targetTime = mediaEl.currentTime;
      }
    } catch {
      this._finish(operation, "error");
      return operation.done;
    }

    if (mediaEl.readyState === 0) {
      // HAVE_NOTHING stores a default start position and emits no seek events.
      this._finish(operation, "no-metadata");
    } else if (!mediaEl.seeking) {
      // Same-position and non-seekable writes may either queue a short event
      // pair or emit nothing. Give queued tasks a bounded chance to drain.
      this._scheduleSettled(operation, this.noSeekGraceMs);
    }
    return operation.done;
  }

  /** Suppress the pause event caused by a projection-to-preview mirror update. */
  suppressPause(mediaEl) {
    if (!mediaEl) return Promise.resolve("ignored");
    const operation = this._start(
      mediaEl,
      "pause",
      ["pause"],
      this.pauseTimeoutMs,
    );
    this._listen(operation, "pause", () => this._scheduleSettled(operation));

    try {
      mediaEl.pause();
    } catch (error) {
      this._finish(operation, "error");
      return Promise.reject(error);
    }
    return operation.done;
  }
}

export { MediaElementForwardingSuppression };
