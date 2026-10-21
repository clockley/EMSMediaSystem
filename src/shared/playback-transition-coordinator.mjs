/*
Copyright (C) 2026 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/**
 * Owns the asynchronous hand-off between schedule state and the audience
 * renderer. Queue indexes are deliberately not stored here: an index is a
 * view of the schedule at one instant, while the item object is the stable
 * identity that survives insertion and reordering.
 */
class PlaybackTransitionCoordinator {
  #generation = 0;

  #transition = null;

  #pendingClose = null;

  #activePlaybackId = "";

  #activePlaybackEndConsumed = false;

  begin(item, options = {}) {
    if (!item || typeof item !== "object") {
      throw new TypeError("A playback transition requires a queue item");
    }
    this.#generation += 1;
    const token = Object.freeze({
      generation: this.#generation,
      item,
      startTime:
        typeof options.startTime === "number" && Number.isFinite(options.startTime)
          ? Math.max(0, options.startTime)
          : 0,
    });
    this.#transition = token;
    this.#pendingClose = null;
    return token;
  }

  owns(token) {
    return Boolean(
      token &&
        token === this.#transition &&
        token.generation === this.#generation,
    );
  }

  indexOf(token, queue) {
    if (!this.owns(token) || !Array.isArray(queue)) return -1;
    return queue.indexOf(token.item);
  }

  isTransitioningItem(item) {
    return Boolean(item && this.#transition?.item === item);
  }

  setPendingClose(token, startTime = token?.startTime) {
    if (!this.owns(token)) return false;
    this.#pendingClose = {
      token,
      startTime:
        typeof startTime === "number" && Number.isFinite(startTime)
          ? Math.max(0, startTime)
          : 0,
    };
    return true;
  }

  pendingCloseItem() {
    return this.#pendingClose && this.owns(this.#pendingClose.token)
      ? this.#pendingClose.token.item
      : null;
  }

  consumePendingClose(queue) {
    const pending = this.#pendingClose;
    this.#pendingClose = null;
    if (!pending || !this.owns(pending.token)) return null;
    const index = this.indexOf(pending.token, queue);
    if (index < 0) return null;
    return {
      token: pending.token,
      item: pending.token.item,
      index,
      startTime: pending.startTime,
    };
  }

  complete(token) {
    if (!this.owns(token)) return false;
    this.#transition = null;
    this.#pendingClose = null;
    return true;
  }

  cancel() {
    this.#generation += 1;
    this.#transition = null;
    this.#pendingClose = null;
  }

  activatePlayback(playbackId) {
    const normalized = String(playbackId || "");
    if (!normalized) {
      throw new TypeError("An audience playback requires a non-empty identity");
    }
    this.#activePlaybackId = normalized;
    this.#activePlaybackEndConsumed = false;
    return normalized;
  }

  deactivatePlayback(playbackId = this.#activePlaybackId) {
    if (String(playbackId || "") !== this.#activePlaybackId) return false;
    this.#activePlaybackId = "";
    this.#activePlaybackEndConsumed = false;
    return true;
  }

  activePlaybackId() {
    return this.#activePlaybackId;
  }

  matchesActivePlayback(payload) {
    const playbackId = String(payload?.playbackId || "");
    return Boolean(playbackId && playbackId === this.#activePlaybackId);
  }

  claimPlaybackEnd(payload) {
    if (!this.matchesActivePlayback(payload) || this.#activePlaybackEndConsumed) {
      return false;
    }
    this.#activePlaybackEndConsumed = true;
    return true;
  }
}

let playbackIdSequence = 0;

function createAudiencePlaybackId() {
  playbackIdSequence += 1;
  const randomPart = globalThis.crypto?.randomUUID?.();
  return randomPart || `audience-${Date.now().toString(36)}-${playbackIdSequence.toString(36)}`;
}

const audiencePlaybackCoordinator = new PlaybackTransitionCoordinator();

export {
  PlaybackTransitionCoordinator,
  audiencePlaybackCoordinator,
  createAudiencePlaybackId,
};
