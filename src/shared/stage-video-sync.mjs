import { PIDController } from './app-controls-utils.min.mjs';

/** Local, silent follower of audience playback. No transport messages or timers. */
export function createStageVideoSync({ video, PID = PIDController, now = () => Date.now() }) {
  let source = null;
  let latest = null;
  let startup = true;
  let pendingPlay = null;
  let disposed = false;
  let listening = false;
  const pid = new PID(video, { isActiveMediaWindow: () => !disposed });

  function mute() {
    if (!video.muted) video.muted = true;
    if (!video.defaultMuted) video.defaultMuted = true;
    if (video.volume !== 0) video.volume = 0;
  }

  function reset() {
    pid.reset();
    video.playbackRate = 1;
  }

  function wantsPlay() {
    return !disposed && source !== null && latest?.playing === true;
  }

  function play() {
    if (!video.paused || pendingPlay) return;
    // The token owns only this invocation, never a later source's play promise.
    const token = { source };
    pendingPlay = token;
    function settled() {
      if (pendingPlay === token) pendingPlay = null;
      mute();
      // Some media implementations finish an old play after pause()/load().
      // Reconcile current intent, not the playing snapshot that started it.
      if (!wantsPlay()) video.pause();
    }
    try {
      Promise.resolve(video.play()).then(settled, settled);
    } catch {
      settled();
    }
  }

  function apply() {
    mute();
    if (disposed || !source || !latest) return;
    const { playing, currentTime, explicitSeek, discontinuity } = latest;
    if (!playing) {
      video.pause();
      reset();
    }
    if (video.readyState < 1) return;

    // Deliberately do not extrapolate a retained playing snapshot on readiness:
    // a slow load must not invent playback beyond the last audience update.
    const target = Number.isFinite(video.duration) && video.duration >= 0
      ? Math.min(video.duration, currentTime) : currentTime;
    const drift = Math.abs(video.currentTime - target);
    const seek = explicitSeek ? drift > 0.001
      : !playing ? drift > 0.001
        : (startup || discontinuity) && drift > 0.25;
    if (explicitSeek || seek) reset();
    if (seek) {
      try {
        video.currentTime = target;
      } catch {
        // Keep startup/seek intent for the next metadata/canplay event.
        return;
      }
    }
    startup = false;
    latest.explicitSeek = false;
    latest.discontinuity = false;
    if (playing) {
      pid.adjustPlaybackRate(target);
      play();
    }
  }

  function listen(enabled) {
    if (listening === enabled) return;
    listening = enabled;
    const method = enabled ? 'addEventListener' : 'removeEventListener';
    video[method]('loadedmetadata', apply);
    video[method]('canplay', apply);
    video[method]('volumechange', mute);
  }

  function clear() {
    source = null;
    latest = null;
    pendingPlay = null;
    startup = true;
    listen(false);
    mute();
    video.pause();
    reset();
    video.srcObject = null;
    video.removeAttribute('src');
    video.load();
  }

  /** Returns true only when a different URL/playback/session/generation is loaded. */
  function setSource({ url, playbackId, sourceGeneration, audienceSessionId } = {}) {
    if (disposed) return false;
    mute();
    if (typeof url !== 'string' || !url) {
      clear();
      return false;
    }
    if (source && source.url === url && source.playbackId === playbackId &&
        source.sourceGeneration === sourceGeneration &&
        source.audienceSessionId === audienceSessionId) return false;
    source = { url, playbackId, sourceGeneration, audienceSessionId };
    latest = null;
    startup = true;
    pendingPlay = null;
    listen(true);
    video.pause();
    reset();
    video.srcObject = null;
    video.src = url;
    video.load();
    return true;
  }

  /** Returns false for stale, malformed, or stabilizing browser state. */
  function receive(state) {
    if (disposed || !source || !state) return false;
    if ((state.playbackId ?? state.audiencePlaybackId) !== source.playbackId ||
        (state.audiencePlaybackId !== undefined && state.audiencePlaybackId !== source.playbackId) ||
        state.audienceSessionId !== source.audienceSessionId ||
        state.sourceGeneration !== source.sourceGeneration ||
        (state.url !== undefined && state.url !== source.url) ||
        state.syncPhase === 'stabilizing' ||
        !Number.isFinite(state.currentTime) ||
        (typeof state.playing !== 'boolean' && state.ended !== true)) return false;
    const timestamp = now();
    const playing = state.playing === true && state.ended !== true;
    const currentTime = Math.max(0, state.currentTime);
    const elapsed = latest ? Math.max(0, timestamp - latest.timestamp) / 1000 : 0;
    const discontinuity = !!latest && (
      (playing && !latest.playing) ||
      Math.abs(currentTime - latest.currentTime - (latest.playing ? elapsed : 0)) > 0.25
    );
    latest = {
      playing, currentTime, timestamp,
      explicitSeek: state.positionIntent === 'explicit-seek' || latest?.explicitSeek === true,
      discontinuity: discontinuity || latest?.discontinuity === true,
    };
    apply();
    return true;
  }

  function dispose() {
    if (disposed) return;
    clear();
    disposed = true;
  }

  mute();
  return { setSource, receive, clear, dispose };
}