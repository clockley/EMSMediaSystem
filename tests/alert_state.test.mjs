import test from "node:test";
import assert from "node:assert/strict";
import { advanceAlertState, clearAlert, createAlertState, showAlert } from "../src/alert-state.mjs";
import { commandForShortcut, LIVE_COMMANDS } from "../src/alert-shortcuts.mjs";
import { createOutputStatus, mergeOutputStatus } from "../src/output-status.mjs";
import { createBackgroundState, revertLiveBackground, setLiveBackground } from "../src/live-background.mjs";
import { normalizeAlertTemplate, resolveAlertTokens } from "../src/alert-tokens.mjs";
import { addNurseryAlert, createNurseryAlertsState, expireNurseryAlerts, removeNurseryAlert } from "../src/nursery-alerts.mjs";
import { DEFAULT_TICKER_SPEED_PX_PER_SECOND, tickerDurationSeconds, tickerPhaseDelaySeconds } from "../src/alert-motion.mjs";

test("high-priority alerts replace normal alerts and repeats expire deterministically", () => {
  let state = showAlert(createAlertState(), { message: "Normal", durationMs: 100 }, 0);
  state = showAlert(state, { message: "Urgent", priority: "high", durationMs: 50, repeatCount: 2 }, 10);
  assert.equal(state.live.message, "Urgent");
  assert.equal(state.queue[0].message, "Normal");
  state = advanceAlertState(state, 60);
  assert.equal(state.live.repeatsRemaining, 1);
  state = advanceAlertState(state, 110);
  assert.equal(state.live.message, "Normal");
  assert.equal(clearAlert(state).live, null);
});

test("shortcut registry maps alert and essential booth commands", () => {
  assert.equal(commandForShortcut({ key: "F8" }), LIVE_COMMANDS.ALERT_SHOW);
  assert.equal(commandForShortcut({ key: "F8", shiftKey: true }), LIVE_COMMANDS.ALERT_CLEAR);
  assert.equal(commandForShortcut({ key: "PageDown" }), LIVE_COMMANDS.NEXT);
  assert.equal(commandForShortcut({ key: "F8", repeat: true }), null);
});

test("unified status merges one role without dropping the others", () => {
  const status = mergeOutputStatus(createOutputStatus("s"), { audience: { window: "open", alert: "live" } });
  assert.equal(status.audience.alert, "live");
  assert.equal(status.stage.window, "closed");
});

test("live background state supports safe revert", () => {
  let state = setLiveBackground(createBackgroundState(), { source: "/media/one.jpg" });
  state = setLiveBackground(state, { source: "/media/two.mp4", transition: "cut" });
  state = revertLiveBackground(state);
  assert.equal(state.current.source, "/media/one.jpg");
  assert.equal(state.previous.source, "/media/two.mp4");
});

test("normal message alerts queue while priority messages interrupt", () => {
  let state = showAlert(createAlertState(), { id: "one", message: "One", durationMs: 1000 }, 0);
  state = showAlert(state, { id: "two", message: "Two", durationMs: 1000 }, 1);
  assert.equal(state.live.id, "one");
  assert.equal(state.queue[0].id, "two");
  state = showAlert(state, { id: "urgent", message: "Urgent", priority: "high" }, 2);
  assert.equal(state.live.id, "urgent");
});

test("general ticker may omit a title without receiving a notice prefix", () => {
  const state = showAlert(createAlertState(), { message: "Parking lights are on" }, 0);
  assert.equal(state.live.title, "");
  assert.equal(state.live.backgroundColor, "#7a1010");
  assert.equal(state.live.textColor, "#ffffff");
  const custom = showAlert(createAlertState(), {
    message: "Custom",
    backgroundColor: "#112233",
    textColor: "#AABBCC",
  }, 0);
  assert.equal(custom.live.backgroundColor, "#112233");
  assert.equal(custom.live.textColor, "#aabbcc");
});

test("nursery identifiers coexist, expire, and remove independently", () => {
  let state = addNurseryAlert(createNurseryAlertsState(), { id: "a", identifier: "42", durationMs: 100 }, 0);
  state = addNurseryAlert(state, { id: "b", identifier: "17", durationMs: 200 }, 0);
  state = removeNurseryAlert(state, "a");
  assert.deepEqual(state.alerts.map((alert) => alert.identifier), ["17"]);
  assert.equal(expireNurseryAlerts(state, 201).alerts.length, 0);
});

test("nursery alerts preserve valid custom colors and reject invalid color input", () => {
  let state = addNurseryAlert(createNurseryAlertsState(), {
    identifier: "42",
    backgroundColor: "#123ABC",
    textColor: "not-a-color",
  }, 0);
  assert.equal(state.alerts[0].backgroundColor, "#123abc");
  assert.equal(state.alerts[0].textColor, "#ffffff");
});

test("message templates resolve clock, countdown, and text tokens", () => {
  const template = normalizeAlertTemplate({ name: "Start", message: "Starts {{countdown}}", tokenDefinitions: { countdown: { type: "countdown", target: "2026-01-01T00:01:00.000Z" } } });
  assert.equal(resolveAlertTokens(template.message, template.tokenDefinitions, Date.parse("2026-01-01T00:00:00.000Z")), "Starts 1:00");
  assert.match(resolveAlertTokens("Time {{clock}}", {}, Date.now()), /^Time /);
});

test("live alert state preserves token definitions for the renderers", () => {
  const tokenDefinitions = {
    countdown: {
      type: "countdown",
      target: "2026-01-01T00:01:00.000Z",
      allowOverrun: false,
    },
  };
  const state = showAlert(
    createAlertState(),
    { message: "Starts {{countdown}}", tokenDefinitions },
    Date.parse("2026-01-01T00:00:00.000Z"),
  );
  assert.deepEqual(state.live.tokenDefinitions, tokenDefinitions);
  assert.equal(
    resolveAlertTokens(
      state.live.message,
      state.live.tokenDefinitions,
      Date.parse("2026-01-01T00:00:00.000Z"),
    ),
    "Starts 1:00",
  );
});

test("countdown completion dismisses an alert without repeating it", () => {
  const target = "2026-01-01T00:01:00.000Z";
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  let state = showAlert(createAlertState(), {
    message: "Starts in {{countdown}}",
    repeatCount: 3,
    dismissAtCountdownEnd: true,
    tokenDefinitions: {
      countdown: { type: "countdown", target, allowOverrun: false },
    },
  }, start);
  assert.equal(state.live.expiresAt, Date.parse(target));
  state = advanceAlertState(state, Date.parse(target));
  assert.equal(state.live, null);
});

test("ticker motion uses a readable constant speed with safe duration bounds", () => {
  assert.equal(DEFAULT_TICKER_SPEED_PX_PER_SECOND, 96);
  assert.equal(tickerDurationSeconds({ viewportWidth: 1920, textWidth: 960 }), 30);
  assert.equal(tickerDurationSeconds({ viewportWidth: 100, textWidth: 100 }), 8);
  assert.equal(tickerDurationSeconds({ viewportWidth: 10000, textWidth: 10000 }), 45);
  assert.equal(tickerPhaseDelaySeconds({ shownAt: 1000, now: 6500, duration: 20 }), -5.5);
  assert.equal(tickerPhaseDelaySeconds({ shownAt: 1000, now: 26500, duration: 20 }), -5.5);
});
