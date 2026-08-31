export const LIVE_BACKGROUND_SCHEMA = "ems.live-background.v1";

function mediaKind(source) {
  if (/^(https?:|rtsp:|rtmp:)/i.test(source)) return "stream";
  if (/\.(mp4|webm|mov|mkv|m4v|avi)$/i.test(source)) return "video";
  return "image";
}

export function normalizeLiveBackground(input = {}) {
  const source = String(input.source || "").trim();
  if (!source) throw new TypeError("A background source is required");
  return {
    schema: LIVE_BACKGROUND_SCHEMA,
    id: String(input.id || source),
    name: String(input.name || source.split(/[\\/]/).pop() || "Background"),
    source,
    kind: ["image", "video", "stream"].includes(input.kind) ? input.kind : mediaKind(source),
    fit: input.fit === "contain" ? "contain" : "cover",
    transition: input.transition === "cut" ? "cut" : "fade",
    durationMs: Math.max(0, Math.min(5000, Number(input.durationMs) || 350)),
  };
}

export function createBackgroundState() {
  return { current: null, previous: null, revision: 0 };
}

export function setLiveBackground(state, input) {
  const current = state || createBackgroundState();
  const next = normalizeLiveBackground(input);
  return { current: next, previous: current.current, revision: current.revision + 1 };
}

export function clearLiveBackground(state) {
  const current = state || createBackgroundState();
  return { current: null, previous: current.current, revision: current.revision + 1 };
}

export function revertLiveBackground(state) {
  const current = state || createBackgroundState();
  return { current: current.previous, previous: current.current, revision: current.revision + 1 };
}
