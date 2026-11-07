// Keep preview media's actual audio tracks in sync with presentation ownership.
// A new source can add tracks after the state changes, so remember the desired
// state and apply it again when metadata or the track list changes.
const previewTrackStates = new WeakMap();

function syncPreviewMediaAudioTracks(mediaEl, enabled) {
  if (!mediaEl) return;

  let state = previewTrackStates.get(mediaEl);
  if (!state) {
    state = {
      enabled: false,
      tracks: null,
      onAddTrack: null,
      enabledBeforeSuppression: new WeakMap(),
    };
    state.onAddTrack = () => syncPreviewMediaAudioTracks(mediaEl, state.enabled);
    previewTrackStates.set(mediaEl, state);
    mediaEl.addEventListener?.("loadedmetadata", state.onAddTrack);
  }
  state.enabled = Boolean(enabled);

  const tracks = mediaEl.audioTracks;
  if (tracks !== state.tracks) {
    state.tracks?.removeEventListener?.("addtrack", state.onAddTrack);
    state.tracks = tracks;
    tracks?.addEventListener?.("addtrack", state.onAddTrack);
  }
  if (!tracks || typeof tracks.length !== "number") return;
  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i];
    if (!state.enabled) {
      if (!state.enabledBeforeSuppression.has(track)) {
        state.enabledBeforeSuppression.set(track, track.enabled);
      }
      track.enabled = false;
    } else if (state.enabledBeforeSuppression.has(track)) {
      track.enabled = state.enabledBeforeSuppression.get(track);
      state.enabledBeforeSuppression.delete(track);
    }
  }
}

export { syncPreviewMediaAudioTracks };
