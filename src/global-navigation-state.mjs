export const NAVIGATION_STATES = Object.freeze({
  MEDIA: "media",
  SONGS: "songs",
  BIBLE: "bible",
  SLIDES: "slides",
  STAGE: "stage",
});

const VALID_STATES = new Set(Object.values(NAVIGATION_STATES));

export function createNavigationStateMachine(initialState = NAVIGATION_STATES.MEDIA) {
  if (!VALID_STATES.has(initialState)) throw new TypeError("Unknown navigation state");
  let state = initialState;
  const listeners = new Set();

  return Object.freeze({
    get state() {
      return state;
    },
    transition(nextState) {
      if (!VALID_STATES.has(nextState)) throw new TypeError("Unknown navigation state");
      if (nextState === state) return { state, changed: false };
      const previousState = state;
      state = nextState;
      for (const listener of listeners) listener(state, previousState);
      return { state, previousState, changed: true };
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Navigation listener must be a function");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
