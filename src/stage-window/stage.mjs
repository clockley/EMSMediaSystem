import {
  applyOutputCommand,
  createCompositorState,
  outputAcknowledgement,
} from "../shared/output-compositor.min.mjs";
import { resolveAlertTokens } from "../shared/alert-tokens.min.mjs";

const api = window.stageOutput;
let state = createCompositorState("stage", api.sessionId);

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value || "");
}

function renderOverlay(id, titleId, textId, payload) {
  const element = document.getElementById(id);
  if (!element) return;
  element.hidden = !payload;
  setText(titleId, payload?.title);
  setText(textId, resolveAlertTokens(payload?.message, payload?.tokenDefinitions, Date.now()));
}

function render() {
  const content = state.layers.content || {};
  const widgets = state.layers.widgets || {};
  const root = document.getElementById("stageRoot");
  root.dataset.profile = content.profile || widgets.profile || "current-next";
  setText("stageCurrent", content.current || "Waiting for live content");
  setText("stageNext", content.next || "—");
  setText("stageServiceItem", widgets.serviceItem || content.serviceItem || "");
  setText("stageSectionLabel", widgets.sectionLabel || content.sectionLabel || "");
  setText("stageNotes", widgets.notes || content.notes || "");
  setText("stageCountdown", widgets.countdown || widgets.mediaRemaining || content.countdown || "");
  renderOverlay("stageAlert", "stageAlertTitle", "stageAlertMessage", state.layers.alert);
  renderOverlay("stagePrivateMessage", "stagePrivateTitle", "stagePrivateText", state.layers.privateMessage);
  document.getElementById("stageFault").hidden = !state.layers.fault;
}

function updateClock() {
  setText("stageClock", new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()));
}

api.onCommand((command) => {
  try {
    const result = applyOutputCommand(state, command);
    state = result.state;
    if (result.applied) render();
    api.acknowledge(outputAcknowledgement(command, result.applied, result.applied ? "" : result.reason));
  } catch (error) {
    api.acknowledge(outputAcknowledgement(command, false, error?.message || error));
  }
});

updateClock();
setInterval(updateClock, 1000);
setInterval(() => {
  if (state.layers.alert || state.layers.privateMessage) render();
}, 1000);
api.ready();
