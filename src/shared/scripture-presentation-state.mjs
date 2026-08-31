export const SCRIPTURE_PRESENTATION_STATUS = Object.freeze({
  IDLE: "idle",
  PREVIEWING: "previewing",
  TAKING: "taking",
  LIVE: "live",
});

export const SCRIPTURE_FOLLOW_MODE = Object.freeze({
  LINKED: "linked",
  MANUAL: "manual",
});

const OUTPUT_NAMES = ["audience", "lowerThird"];

function outputState(enabled = false, follow = SCRIPTURE_FOLLOW_MODE.LINKED) {
  return {
    enabled: Boolean(enabled),
    status: enabled ? "pending" : "disabled",
    follow,
    slideId: null,
  };
}

export function createScripturePresentationState() {
  return {
    status: SCRIPTURE_PRESENTATION_STATUS.IDLE,
    revision: 0,
    source: null,
    cursor: null,
    outputs: {
      audience: outputState(false),
      lowerThird: outputState(false),
    },
  };
}

function nextRevision(state) {
  return Math.max(0, Number(state?.revision) || 0) + 1;
}

function normalizedSource(source) {
  if (!source || typeof source !== "object") return null;
  const id = String(source.id || "").trim();
  if (!id) return null;
  const origin = source.origin === "schedule" ? "schedule" : "show-now";
  return {
    id,
    origin,
    ...(Number.isInteger(source.scheduleIndex)
      ? { scheduleIndex: source.scheduleIndex }
      : {}),
  };
}

function normalizedCursor(cursor) {
  if (!cursor || typeof cursor !== "object") return null;
  const contentUnitId = String(cursor.contentUnitId || "").trim();
  const verseNumbers = Array.isArray(cursor.verseNumbers)
    ? [...new Set(cursor.verseNumbers.map(Number).filter((value) => Number.isInteger(value) && value > 0))]
    : [];
  return {
    contentUnitId,
    verseNumbers,
    fragmentIndex: Math.max(0, Math.trunc(Number(cursor.fragmentIndex) || 0)),
    audienceSlideId: cursor.audienceSlideId ? String(cursor.audienceSlideId) : null,
  };
}

function sourceMatches(state, sourceId) {
  return !sourceId || state.source?.id === sourceId;
}

export function reduceScripturePresentation(state, event = {}) {
  const current = state || createScripturePresentationState();
  switch (event.type) {
    case "SOURCE_PREVIEWED": {
      const source = normalizedSource(event.source);
      if (!source) return current;
      const sourceChanged = current.source?.id !== source.id;
      return {
        ...current,
        status:
          current.status === SCRIPTURE_PRESENTATION_STATUS.LIVE && !sourceChanged
            ? current.status
            : SCRIPTURE_PRESENTATION_STATUS.PREVIEWING,
        source,
        cursor: normalizedCursor(event.cursor),
      };
    }
    case "TAKE_REQUESTED": {
      const source = normalizedSource(event.source);
      if (!source) return current;
      const revision = nextRevision(current);
      return {
        ...current,
        status: SCRIPTURE_PRESENTATION_STATUS.TAKING,
        revision,
        source,
        cursor: normalizedCursor(event.cursor),
        outputs: {
          audience: outputState(event.outputs?.audience === true),
          lowerThird: outputState(event.outputs?.lowerThird === true),
        },
      };
    }
    case "TAKE_CONFIRMED": {
      if (event.revision !== current.revision || current.status !== SCRIPTURE_PRESENTATION_STATUS.TAKING) {
        return current;
      }
      const outputs = {};
      for (const name of OUTPUT_NAMES) {
        const enabled = current.outputs[name].enabled;
        const live = enabled && event.outputs?.[name] === true;
        outputs[name] = {
          ...current.outputs[name],
          status: live ? "live" : enabled ? "failed" : "disabled",
        };
      }
      return {
        ...current,
        status: OUTPUT_NAMES.some((name) => outputs[name].status === "live")
          ? SCRIPTURE_PRESENTATION_STATUS.LIVE
          : SCRIPTURE_PRESENTATION_STATUS.PREVIEWING,
        outputs,
      };
    }
    case "CURSOR_CHANGED": {
      if (!sourceMatches(current, event.sourceId)) return current;
      const cursor = normalizedCursor(event.cursor);
      if (!cursor) return current;
      const revision = nextRevision(current);
      return {
        ...current,
        revision,
        cursor,
        outputs: {
          audience: {
            ...current.outputs.audience,
            slideId: cursor.audienceSlideId,
          },
          lowerThird: {
            ...current.outputs.lowerThird,
            slideId:
              current.outputs.lowerThird.follow === SCRIPTURE_FOLLOW_MODE.LINKED
                ? event.lowerThirdSlideId || null
                : current.outputs.lowerThird.slideId,
          },
        },
      };
    }
    case "LOWER_THIRD_CUED": {
      if (!sourceMatches(current, event.sourceId)) return current;
      return {
        ...current,
        outputs: {
          ...current.outputs,
          lowerThird: {
            ...current.outputs.lowerThird,
            follow: SCRIPTURE_FOLLOW_MODE.MANUAL,
            slideId: event.slideId ? String(event.slideId) : null,
          },
        },
      };
    }
    case "LOWER_THIRD_FOLLOW_SET": {
      const linked = event.follow !== SCRIPTURE_FOLLOW_MODE.MANUAL;
      return {
        ...current,
        outputs: {
          ...current.outputs,
          lowerThird: {
            ...current.outputs.lowerThird,
            follow: linked ? SCRIPTURE_FOLLOW_MODE.LINKED : SCRIPTURE_FOLLOW_MODE.MANUAL,
            slideId: linked ? event.slideId || null : current.outputs.lowerThird.slideId,
          },
        },
      };
    }
    case "OUTPUT_STATUS_CHANGED": {
      if (!OUTPUT_NAMES.includes(event.output) || current.status === SCRIPTURE_PRESENTATION_STATUS.IDLE) {
        return current;
      }
      const enabled = event.status !== "disabled" && event.status !== "closed";
      const output = {
        ...current.outputs[event.output],
        enabled,
        status: String(event.status || (enabled ? "live" : "disabled")),
      };
      const outputs = { ...current.outputs, [event.output]: output };
      return {
        ...current,
        status: OUTPUT_NAMES.some((name) => outputs[name].status === "live")
          ? SCRIPTURE_PRESENTATION_STATUS.LIVE
          : SCRIPTURE_PRESENTATION_STATUS.PREVIEWING,
        outputs,
      };
    }
    case "STOPPED":
      return {
        ...createScripturePresentationState(),
        revision: nextRevision(current),
      };
    default:
      return current;
  }
}

export function createScripturePresentationMachine(initialState) {
  let state = initialState || createScripturePresentationState();
  const listeners = new Set();
  return Object.freeze({
    get state() {
      return state;
    },
    dispatch(event) {
      const previous = state;
      state = reduceScripturePresentation(state, event);
      if (state !== previous) {
        for (const listener of listeners) listener(state, previous, event);
      }
      return state;
    },
    isCurrentRevision(revision) {
      return state.revision === revision;
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Listener must be a function");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

export function scriptureCursorForSlide(slide, slides = []) {
  if (!slide) return null;
  const verseNumbers = Array.isArray(slide.verseNumbers)
    ? slide.verseNumbers.map(Number).filter((value) => Number.isInteger(value) && value > 0)
    : [];
  const primaryVerse = verseNumbers[0] || null;
  const candidates = primaryVerse
    ? slides.filter((candidate) => candidate?.verseNumbers?.includes(primaryVerse))
    : [];
  const fragmentIndex = Math.max(0, candidates.findIndex((candidate) => candidate.slideId === slide.slideId));
  return {
    contentUnitId: `${slide.passageKey || "scripture"}:v${verseNumbers.join("-") || "0"}:f${fragmentIndex}`,
    verseNumbers,
    fragmentIndex,
    audienceSlideId: slide.slideId || null,
  };
}

export function resolveScriptureSlideForCursor(slides = [], cursor) {
  if (!Array.isArray(slides) || slides.length === 0 || !cursor) return null;
  const wanted = new Set(cursor.verseNumbers || []);
  const exact = slides.find((slide) => slide.slideId === cursor.audienceSlideId);
  if (
    exact &&
    (wanted.size === 0 || exact.verseNumbers?.some((verse) => wanted.has(verse)))
  ) {
    return exact;
  }
  const candidates = wanted.size
    ? slides.filter((slide) => slide.verseNumbers?.some((verse) => wanted.has(verse)))
    : [];
  if (!candidates.length) return slides[0] || null;
  return candidates[Math.min(Math.max(0, cursor.fragmentIndex || 0), candidates.length - 1)];
}
