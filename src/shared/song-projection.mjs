// A playback can change songs in-place through Show Now. A song can also span
// many slides, including blank slides and temporary output holds.
export function createProjectionTracker(publish) {
  let current = null;
  return {
    update(song, { visible, replay = false, playbackId = "" } = {}) {
      if (!song?.songId) {
        current = null;
        return;
      }
      if (song.songId !== current?.songId || playbackId !== current.playbackId) {
        current = { songId: song.songId, playbackId, event: null };
      }
      if (!visible || (current.event && !replay)) return;
      current.event ||= { ...song, id: crypto.randomUUID(), timeMillis: Date.now() };
      publish(current.event);
    },
  };
}
