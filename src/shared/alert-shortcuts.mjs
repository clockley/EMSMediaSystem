export const LIVE_COMMANDS = Object.freeze({
  ALERT_SHOW: "alert.showOrUpdate",
  ALERT_CLEAR: "alert.clear",
  STAGE_SHOW: "stageMessage.showOrUpdate",
  STAGE_CLEAR: "stageMessage.clear",
  NEXT: "presentation.next",
  PREVIOUS: "presentation.previous",
  CLEAR: "presentation.clear",
  BLACK: "presentation.black",
  LOGO: "presentation.logo",
  GO_LIVE: "presentation.goLive",
});

export function commandForShortcut(event = {}) {
  if (event.repeat) return null;
  const key = String(event.key || "");
  if (key === "F8") {
    if (event.ctrlKey && event.shiftKey) return LIVE_COMMANDS.STAGE_CLEAR;
    if (event.ctrlKey) return LIVE_COMMANDS.STAGE_SHOW;
    if (event.shiftKey) return LIVE_COMMANDS.ALERT_CLEAR;
    return LIVE_COMMANDS.ALERT_SHOW;
  }
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (key === "PageDown") return LIVE_COMMANDS.NEXT;
  if (key === "PageUp") return LIVE_COMMANDS.PREVIOUS;
  if (key.toLowerCase() === "c") return LIVE_COMMANDS.CLEAR;
  if (key.toLowerCase() === "b") return LIVE_COMMANDS.BLACK;
  if (key.toLowerCase() === "l") return LIVE_COMMANDS.LOGO;
  if (key === "Enter") return LIVE_COMMANDS.GO_LIVE;
  return null;
}
