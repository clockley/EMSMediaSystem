/*
Copyright (C) 2026 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import {
  audiencePlaybackCoordinator,
  createAudiencePlaybackId,
} from "./playback-transition-coordinator.mjs";

/**
 * Activate an audience source while keeping renderer and control-window
 * playback identities in one transaction.
 *
 * The identity is staged before IPC because the audience renderer can emit
 * playback state before the IPC promise resolves. It is committed only after
 * the renderer acknowledges the activation. A newer activation (or cancel)
 * invalidates the staged identity, so an obsolete completion cannot take
 * ownership back from the current request.
 */
async function activateAudiencePlayback(
  invokeActivation,
  {
    coordinator = audiencePlaybackCoordinator,
    playbackId = createAudiencePlaybackId(),
    isAcknowledged = (activation) => Boolean(activation),
    acknowledgedPlaybackId = () => playbackId,
  } = {},
) {
  if (typeof invokeActivation !== "function") {
    throw new TypeError("Audience playback activation requires an IPC function");
  }

  const normalizedPlaybackId = String(playbackId || "");
  if (!normalizedPlaybackId) {
    throw new TypeError("Audience playback activation requires a playback identity");
  }

  const stagedPlaybackId = coordinator.stagePlayback(normalizedPlaybackId);
  try {
    const activation = await invokeActivation(normalizedPlaybackId);
    if (!isAcknowledged(activation)) {
      return {
        ok: false,
        reason: "rejected",
        playbackId: normalizedPlaybackId,
        activation,
      };
    }

    const confirmedPlaybackId = String(
      acknowledgedPlaybackId(activation, normalizedPlaybackId) || "",
    );
    if (confirmedPlaybackId !== normalizedPlaybackId) {
      return {
        ok: false,
        reason: "identity-mismatch",
        playbackId: normalizedPlaybackId,
        activation,
      };
    }

    if (!coordinator.commitStagedPlayback(normalizedPlaybackId)) {
      return {
        ok: false,
        reason: "superseded",
        playbackId: normalizedPlaybackId,
        activation,
      };
    }

    return {
      ok: true,
      playbackId: normalizedPlaybackId,
      activation,
    };
  } finally {
    // No-op after a successful commit. On failure this restores the previously
    // committed playback, unless a newer request has already replaced us.
    coordinator.discardStagedPlayback(stagedPlaybackId);
  }
}

async function activateAudienceSlipstream(
  invokeSlipstream,
  payload,
  options = {},
) {
  return activateAudiencePlayback(
    (playbackId) => invokeSlipstream({
      ...(payload && typeof payload === "object" ? payload : {}),
      playbackId,
    }),
    {
      ...options,
      isAcknowledged: (activation) => activation === true || activation?.ok === true,
      acknowledgedPlaybackId: (activation, playbackId) =>
        activation?.playbackId || playbackId,
    },
  );
}

export { activateAudiencePlayback, activateAudienceSlipstream };
