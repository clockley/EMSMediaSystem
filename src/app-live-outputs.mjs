/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/*
 * Live outputs: stage, alerts, live layers, audience text, and lower-third routing.
 */

import {
  NAVIGATION_STATES,
  SCRIPTURE_LOWER_THIRD_CHROMA_KEY_COLOR,
  STREAMPLAYER,
  activeLiveStream,
  activeLowerThirdContentType,
  activeMediaWindowContentType,
  alertQueueRow,
  appendQuickMessageGroup,
  appliedPresentationTheme,
  applyBiblePreview,
  audienceTextMessageForSend,
  bibleDesignerState,
  bibleLowerThirdLiveCueKey,
  bibleLowerThirdOutputActive,
  bibleShowNowModeActive,
  bibleUiEnabled,
  buildSongLowerThirdMessage,
  clearLiveBibleText,
  clearLiveSongText,
  closeSettingsControls,
  createOutputCommand,
  currentBibleScheduleOutputSize,
  currentLiveQueueItem,
  currentMode,
  currentResolvedSongPresentation,
  currentSongActiveSection,
  currentSongPresentationItem,
  currentSongRenderState,
  currentWorkspaceSong,
  enrichLowerThirdPresentationMessage,
  ensureBibleLowerThirdOutput,
  hideBibleWorkspace,
  invoke,
  isActiveMediaWindow,
  isBibleLowerThirdFeatureEnabled,
  isPlaying,
  isQueueItemAudio,
  isQueueItemBible,
  isQueueItemDeck,
  isQueueItemImage,
  isQueueItemPptx,
  isQueueItemSong,
  isQueueItemVideo,
  isQueuePlaying,
  isSongsWorkspaceVisible,
  lastAudienceBibleTextMessage,
  lastAudienceSongTextMessage,
  lastLowerThirdBibleTextMessage,
  latestOutputStatus,
  liveTextClearActive,
  lowerThirdKeyOnlyMessage,
  lowerThirdOutputUpdateToken,
  lowerThirdPreferenceChromaKeyColor,
  lowerThirdUiEnabled,
  mergeSongRenderState,
  navigationState,
  navigationStateBeforeStage,
  nextPlayableQueueItemStageText,
  pathToMediaUrl,
  projectScriptureOverrides,
  projectStageConfig,
  queueItemStageLabel,
  renderSongLowerThirdControls,
  renderSongSectionPreview,
  renderSongSlideNavigator,
  resolveThemeForTarget,
  resolvedAudienceBackgroundFields,
  resolvedBibleEntryForItem,
  resolvedFontFamilyFields,
  resolvedSongPresentation,
  restoreLiveBibleText,
  restoreLiveSongText,
  scripturePresentation,
  selectedBiblePreviewOutputSize,
  send,
  sendBibleLowerThirdTextMessage,
  sendBibleLowerThirdTextToOutput,
  sendSongLowerThirdForLiveItem,
  setCurrentSongRenderState,
  setSharedRendererState,
  showGnomeToast,
  songItemForAudienceResolution,
  songLowerThirdState,
  songShowNowModeActive,
  stageContentCache,
  stageContentFromPresentation,
  stageSessionIdCache,
  syncBuiltInLowerThirdFeatureAvailability,
  syncConfidenceMonitorCarousel,
  syncScheduleAfterBibleFeatureChange,
  syncStageRendererPreviewCapture,
  syncStreamRendererPreviewCapture,
  themeAudienceMessageIfApplied,
  updateOutputHoldButtonStates,
} from "./app-renderer.mjs";

const stageLayerRevisions = new Map();

let currentAlertsSnapshot = { alert: null, queue: [], nurseryAlerts: [] };

let activeLiveLayersPage = "nursery";

let recentAlertMessages = [];

let alertTokenDefinitionsDraft = {};

const READY_ALERT_MESSAGES = Object.freeze([
  "The service will begin shortly.",
  "Please silence your mobile devices.",
  "Your vehicle lights are on.",
  "Please move your vehicle.",
  "Please check in at the information desk.",
]);

function syncLowerThirdFeatureAvailability() {
  syncBuiltInLowerThirdFeatureAvailability();
  const lowerThirdEnabled = isBibleLowerThirdFeatureEnabled();
  document.querySelectorAll("[data-lower-third-feature]").forEach((element) => {
    const unavailable =
      !lowerThirdEnabled ||
      (element.id === "songLowerThirdPanel" && !currentWorkspaceSong);
    element.hidden = unavailable;
    element.setAttribute("aria-hidden", unavailable ? "true" : "false");
  });
  const bibleButton = document.getElementById("openBibleWorkspaceBtn");
  if (bibleButton) bibleButton.hidden = !bibleUiEnabled;
  if (!bibleUiEnabled && document.getElementById("bibleWorkspace")?.hidden === false) {
    hideBibleWorkspace();
  }
}

function applyLowerThirdOutputPreferences(prefs = {}) {
  setSharedRendererState({ bibleUiEnabled: prefs?.bibleUiEnabled !== false });
  setSharedRendererState({ lowerThirdUiEnabled: prefs?.lowerThirdUiEnabled !== false });
  syncLowerThirdFeatureAvailability();
  syncScheduleAfterBibleFeatureChange();
  const color = String(prefs?.lowerThirdChromaKeyColor || "").trim();
  setSharedRendererState({ lowerThirdPreferenceChromaKeyColor: /^#[0-9a-f]{6}$/i.test(color)
    ? color
    : SCRIPTURE_LOWER_THIRD_CHROMA_KEY_COLOR });
  if (!projectScriptureOverrides.lowerThirdChromaKeyColor) {
    bibleDesignerState.lowerThirdChromaKeyColor = lowerThirdPreferenceChromaKeyColor;
  }
  const input = document.getElementById("bibleLowerThirdChromaKeyInput");
  if (input) input.value = bibleDesignerState.lowerThirdChromaKeyColor;
  if (document.getElementById("bibleWorkspace")?.hidden === false) {
    applyBiblePreview(bibleDesignerState, { show: false });
  }
  if (bibleLowerThirdOutputActive) {
    if (activeLowerThirdContentType === "song") {
      sendBibleLowerThirdTextMessage(buildSongLowerThirdMessage());
    } else if (activeLowerThirdContentType === "bible") {
      void sendBibleLowerThirdTextToOutput(bibleDesignerState);
    }
  }
}

function nonTextPresentationObjects(objects) {
  return (Array.isArray(objects) ? objects : [])
    .filter((object) => object?.kind === "image" || object?.kind === "shape")
    .map((object) => ({ ...object }));
}

function clearTextFromPresentationMessage(message = {}) {
  const cleared = {
    ...message,
    blocks: [],
    text: "",
    bodyText: "",
    fullBodyText: "",
    referenceText: "",
    attributionText: "",
    copyrightText: "",
    lowerThirdSegments: [],
    lowerThirdSegmentIndex: 0,
    lowerThirdSegmentCount: 0,
  };
  const slideObjects = nonTextPresentationObjects(message.slideObjects);
  if (slideObjects.length > 0) {
    cleared.slideObjects = slideObjects;
  } else {
    delete cleared.slideObjects;
  }
  delete cleared.slideTextObjects;
  return cleared;
}

function shouldApplyLiveTextClearState(type, options = {}) {
  return (
    options.respectLiveTextClearState !== false &&
    liveTextClearActive &&
    (type === "bible" ||
      type === "song" ||
      type === "deck" ||
      type === "lower-third")
  );
}

function rememberAudienceTextMessage(type, message) {
  const copy = message && typeof message === "object" ? { ...message } : null;
  if (type === "bible") {
    setSharedRendererState({ lastAudienceBibleTextMessage: copy });
  } else if (type === "song") {
    setSharedRendererState({ lastAudienceSongTextMessage: copy });
  }
}

function sendAudienceTextMessage(type, message, options = {}) {
  const remember = options.remember !== false;
  const clearToggle = options.clearToggle !== false;
  const applyClearState = shouldApplyLiveTextClearState(type, options);
  const audienceContentKind = type === "bible" ? "scripture" : type === "song" ? "song" : null;
  const themedMessage = audienceContentKind
    ? themeAudienceMessageIfApplied(message, audienceContentKind)
    : message;
  if (remember) {
    rememberAudienceTextMessage(type, themedMessage);
  }
  send("update-text", audienceTextMessageForSend(type, themedMessage, options));
  void syncStageContentFromAudienceMessage(type, themedMessage);
  if (clearToggle && !applyClearState) {
    setSharedRendererState({ liveTextClearActive: false });
  }
  updateClearLiveTextButtonState();
  updateOutputHoldButtonStates();
}

function livePresentationForStage(type, message = {}) {
  const embedded = message?.resolvedPresentation;
  const embeddedCount = Array.isArray(embedded?.slides) ? embedded.slides.length : 0;
  if (embeddedCount > 1) return embedded;
  if (type === "song") {
    const liveItem = currentLiveQueueItem();
    const sourceItem = isQueueItemSong(liveItem)
      ? songItemForAudienceResolution(liveItem)
      : songItemForAudienceResolution(currentSongPresentationItem());
    const live = sourceItem
      ? resolvedSongPresentation(sourceItem)?.resolvedPresentation
      : currentResolvedSongPresentation()?.resolvedPresentation;
    if ((live?.slides?.length || 0) > embeddedCount) return live;
  }
  if (type === "bible") {
    const live = lastAudienceBibleTextMessage?.resolvedPresentation || embedded;
    if ((live?.slides?.length || 0) > embeddedCount) return live;
  }
  return embedded || null;
}

async function sendCachedStageContent() {
  const status = await invoke("get-output-status").catch(() => null);
  if (status?.stage?.window !== "open") return false;
  setSharedRendererState({ stageSessionIdCache: status.sessionId || stageSessionIdCache });
  return sendStageLayer("content", stageContentCache);
}

async function syncStageContentFromAudienceMessage(type, message = {}) {
  const presentation = livePresentationForStage(type, message);
  const payload = stageContentFromPresentation(
    { ...message, resolvedPresentation: presentation || message?.resolvedPresentation },
    {
      type,
      nextItemText: nextPlayableQueueItemStageText(),
      slides: presentation?.slides,
    },
  );
  setSharedRendererState({ stageContentCache: {
    ...stageContentCache,
    ...payload,
  } });
  return sendCachedStageContent();
}

async function syncStageContentFromQueueItem(item = currentLiveQueueItem()) {
  if (!item) return false;
  if (isQueueItemSong(item) || isQueueItemBible(item)) {
    return false;
  }
  const nextText = nextPlayableQueueItemStageText();
  setSharedRendererState({ stageContentCache: {
    ...stageContentCache,
    current: queueItemStageLabel(item) || "Live content",
    next: nextText,
    serviceItem: queueItemStageLabel(item),
  } });
  return sendCachedStageContent();
}

function nextStageRevision(layer) {
  const next = Math.max(Date.now(), (stageLayerRevisions.get(layer) || 0) + 1);
  stageLayerRevisions.set(layer, next);
  return next;
}

async function sendStageLayer(layer, payload = {}, type = "layer.set") {
  if (!stageSessionIdCache) {
    const status = await invoke("get-output-status").catch(() => null);
    setSharedRendererState({ stageSessionIdCache: status?.sessionId || "" });
  }
  if (!stageSessionIdCache) return { delivered: false, reason: "stage-closed" };
  const command = createOutputCommand({
    commandId: globalThis.crypto?.randomUUID?.() || `stage-${Date.now()}-${Math.random()}`,
    sessionId: stageSessionIdCache,
    revision: nextStageRevision(layer),
    targetRole: "stage",
    type,
    layer,
    payload,
  });
  return invoke("stage-output-command", command);
}

function updateStageStatusUi(status) {
  setSharedRendererState({ latestOutputStatus: status || latestOutputStatus });
  const stage = status?.stage || {};
  if (status?.sessionId) setSharedRendererState({ stageSessionIdCache: status.sessionId });
  const open = stage.window === "open";
  const text = open
    ? `Stage output open · ${stage.privateMessage === "live" ? "private message live" : stage.profile || "ready"}`
    : "Stage output closed";
  const label = document.getElementById("stageOutputStatus");
  if (label) label.textContent = text;
  const dot = document.getElementById("stageNavStatus");
  dot?.classList.toggle("is-open", open);
  dot?.setAttribute("aria-label", text);
  const alertDot = document.getElementById("alertNavStatus");
  const alertLive = status?.audience?.alert === "live" || status?.stage?.alert === "live";
  alertDot?.classList.toggle("is-live", alertLive);
  alertDot?.setAttribute("aria-label", alertLive ? "Alert live" : "No live alert");
  void syncStageRendererPreviewCapture().catch(() => {});
}

function audienceAlertDraft() {
  const route = document.getElementById("alertRouteSelect")?.value || "audience";
  const countdownValue = document.getElementById("alertCountdownTarget")?.value || "";
  const countdownTarget = Date.parse(countdownValue);
  const tokenDefinitions = structuredClone(alertTokenDefinitionsDraft);
  if (Number.isFinite(countdownTarget)) {
    tokenDefinitions.countdown = {
      type: "countdown",
      target: new Date(countdownTarget).toISOString(),
      allowOverrun: false,
    };
  }
  return {
    id: globalThis.crypto?.randomUUID?.() || `alert-${Date.now()}`,
    kind: "general",
    title: "",
    message: document.getElementById("alertMessageText")?.value?.trim() || "",
    backgroundColor: document.getElementById("messageAlertBackgroundColor")?.value || "#7a1010",
    textColor: document.getElementById("messageAlertTextColor")?.value || "#ffffff",
    mode: "scroll-needed",
    priority: document.getElementById("alertPrioritySelect")?.value || "normal",
    durationMs: Math.max(0, Number(document.getElementById("alertDurationSeconds")?.value) || 0) * 1000,
    dismissAtCountdownEnd: document.getElementById("alertDismissAtCountdownEnd")?.checked === true,
    repeatCount: Math.max(1, Number(document.getElementById("alertRepeatCount")?.value) || 1),
    routes: { audience: route !== "stage", stage: route === "stage" || route === "both" },
    tokenDefinitions,
  };
}

function updateAlertsSnapshot(result) {
  if (!result) return;
  currentAlertsSnapshot = {
    alert: result.alert || null,
    queue: Array.isArray(result.queue) ? result.queue : [],
    nurseryAlerts: Array.isArray(result.nurseryAlerts) ? result.nurseryAlerts : [],
  };
  updateStageStatusUi(result.status);
  renderAlertLists();
  updateAlertComposerActions();
  syncConfidenceMonitorCarousel();
  syncStreamRendererPreviewCapture();
}

function renderAlertLists() {
  const nurseryList = document.getElementById("nurseryAlertList");
  const nurseryRows = currentAlertsSnapshot.nurseryAlerts.map((alert) => alertQueueRow(alert, true, true));
  if (nurseryList) {
    if (nurseryRows.length) nurseryList.replaceChildren(...nurseryRows);
    else {
      const empty = document.createElement("p");
      empty.className = "live-layer-empty-state";
      empty.textContent = "No nursery alerts are on screen.";
      nurseryList.replaceChildren(empty);
    }
  }
  const messageList = document.getElementById("messageAlertQueue");
  const rows = [
    ...(currentAlertsSnapshot.alert ? [alertQueueRow(currentAlertsSnapshot.alert, true)] : []),
    ...currentAlertsSnapshot.queue.map((alert) => alertQueueRow(alert)),
  ];
  if (messageList) {
    if (rows.length) messageList.replaceChildren(...rows);
    else {
      const empty = document.createElement("p");
      empty.className = "live-layer-empty-state";
      empty.textContent = "No messages are live or waiting.";
      messageList.replaceChildren(empty);
    }
  }
}

function updateAlertComposerActions() {
  const nurseryReady = Boolean(document.getElementById("nurseryAlertIdentifier")?.value?.trim());
  const messageReady = Boolean(document.getElementById("alertMessageText")?.value?.trim());
  const nurseryButton = document.getElementById("addNurseryAlertBtn");
  const messageButton = document.getElementById("showAudienceAlertBtn");
  const stopButton = document.getElementById("clearAudienceAlertBtn");
  if (nurseryButton) nurseryButton.disabled = !nurseryReady;
  if (messageButton) messageButton.disabled = !messageReady;
  if (stopButton) stopButton.disabled = !currentAlertsSnapshot.alert;
}

async function addNurseryAlertFromDraft() {
  const input = document.getElementById("nurseryAlertIdentifier");
  const identifier = input?.value?.trim() || "";
  if (!identifier) {
    showGnomeToast("Enter a nursery identifier");
    input?.focus();
    return;
  }
  const result = await invoke("alerts:show", {
    kind: "nursery",
    identifier,
    backgroundColor: document.getElementById("nurseryAlertBackgroundColor")?.value || "#7a1010",
    textColor: document.getElementById("nurseryAlertTextColor")?.value || "#ffffff",
    durationMs: 0,
    routes: { audience: true, stage: false },
  });
  if (input) input.value = "";
  updateAlertsSnapshot(result);
  updateAlertComposerActions();
}

async function showAudienceAlert() {
  const alert = audienceAlertDraft();
  if (!alert.message) {
    showGnomeToast("Enter an alert message");
    document.getElementById("alertMessageText")?.focus();
    return false;
  }
  if (
    /\{\{\s*countdown(?:\s*|:[^}]+)\}\}/i.test(alert.message) &&
    !Number.isFinite(Date.parse(alert.tokenDefinitions?.countdown?.target || "")) &&
    !/\{\{\s*countdown:[^}]+\}\}/i.test(alert.message)
  ) {
    showGnomeToast("Choose when the countdown should end");
    const target = document.getElementById("alertCountdownTarget");
    target?.closest("details")?.setAttribute("open", "");
    target?.focus();
    return false;
  }
  if (
    alert.dismissAtCountdownEnd &&
    !Number.isFinite(Date.parse(alert.tokenDefinitions?.countdown?.target || ""))
  ) {
    showGnomeToast("Choose when the countdown should end");
    const target = document.getElementById("alertCountdownTarget");
    target?.closest("details")?.setAttribute("open", "");
    target?.focus();
    return false;
  }
  const result = await invoke("alerts:show", alert);
  updateAlertsSnapshot(result);
  await rememberRecentAlertMessage(
    alert.message,
    alert.tokenDefinitions,
    alert.dismissAtCountdownEnd,
  );
  showGnomeToast(alert.routes.audience ? "Message alert added" : "Foldback message added");
  return true;
}

function renderQuickAlertMessages() {
  const select = document.getElementById("quickAlertMessageSelect");
  if (!select) return;
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a common or recent message…";
  select.appendChild(placeholder);
  appendQuickMessageGroup(select, "Ready to use", READY_ALERT_MESSAGES);
  appendQuickMessageGroup(select, "Recently used", recentAlertMessages);
  select.value = "";
}

async function rememberRecentAlertMessage(
  message,
  tokenDefinitions = {},
  dismissAtCountdownEnd = false,
) {
  const normalized = String(message || "").trim();
  if (!normalized) return;
  const recentEntry = {
    message: normalized,
    tokenDefinitions: structuredClone(tokenDefinitions),
    dismissAtCountdownEnd: dismissAtCountdownEnd === true,
  };
  recentAlertMessages = [
    recentEntry,
    ...recentAlertMessages.filter((item) =>
      String(typeof item === "string" ? item : item.message || "").toLocaleLowerCase() !==
      normalized.toLocaleLowerCase()),
  ].slice(0, 8);
  renderQuickAlertMessages();
  await invoke("set-setting", "recentAlertMessages", recentAlertMessages).catch(() => {});
}

function useQuickAlertMessage() {
  const select = document.getElementById("quickAlertMessageSelect");
  const input = document.getElementById("alertMessageText");
  if (!select?.value || !input) return;
  input.value = select.value;
  try {
    alertTokenDefinitionsDraft = JSON.parse(
      select.selectedOptions[0]?.dataset.tokenDefinitions || "{}",
    );
  } catch {
    alertTokenDefinitionsDraft = {};
  }
  const countdownTarget = alertTokenDefinitionsDraft.countdown?.target;
  const countdownInput = document.getElementById("alertCountdownTarget");
  const dismissInput = document.getElementById("alertDismissAtCountdownEnd");
  if (dismissInput) {
    dismissInput.checked =
      select.selectedOptions[0]?.dataset.dismissAtCountdownEnd === "true";
  }
  if (countdownInput && Number.isFinite(Date.parse(countdownTarget || ""))) {
    const local = new Date(countdownTarget);
    const localOffset = local.getTimezoneOffset() * 60000;
    countdownInput.value = new Date(local.getTime() - localOffset).toISOString().slice(0, 16);
  } else if (countdownInput) {
    countdownInput.value = "";
  }
  select.value = "";
  updateAlertComposerActions();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function insertAlertToken(token) {
  const input = document.getElementById("alertMessageText");
  if (!input) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.setRangeText(token, start, end, "end");
  updateAlertComposerActions();
  input.focus();
}

async function clearAudienceAlert() {
  const result = await invoke("alerts:clear");
  updateAlertsSnapshot(result);
  showGnomeToast(result?.alert ? "Next queued alert shown" : "Alert cleared");
  return true;
}

const LIVE_LAYER_PAGE_ORDER = ["nursery", "message"];

function selectLiveLayersPage(page, { focus = false } = {}) {
  const selected = LIVE_LAYER_PAGE_ORDER.includes(page) ? page : "nursery";
  activeLiveLayersPage = selected;
  for (const tab of document.querySelectorAll("[data-live-layer-tab]")) {
    const active = tab.dataset.liveLayerTab === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  for (const panel of document.querySelectorAll("[data-live-layer-page]")) {
    panel.hidden = panel.dataset.liveLayerPage !== selected;
  }
  if (focus) {
    const focusTarget = selected === "nursery"
      ? document.getElementById("nurseryAlertIdentifier")
      : document.getElementById("alertMessageText");
    focusTarget?.focus();
  }
}

function handleLiveLayersTabKeydown(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const current = LIVE_LAYER_PAGE_ORDER.indexOf(event.currentTarget.dataset.liveLayerTab);
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? LIVE_LAYER_PAGE_ORDER.length - 1
      : (current + (event.key === "ArrowRight" ? 1 : -1) + LIVE_LAYER_PAGE_ORDER.length) % LIVE_LAYER_PAGE_ORDER.length;
  selectLiveLayersPage(LIVE_LAYER_PAGE_ORDER[next], { focus: false });
  document.querySelector(`[data-live-layer-tab="${LIVE_LAYER_PAGE_ORDER[next]}"]`)?.focus();
}

async function openLiveLayers(page = activeLiveLayersPage) {
  document.getElementById("liveLayersBackdrop")?.removeAttribute("hidden");
  selectLiveLayersPage(page);
  const [alerts, recentMessages] = await Promise.all([
    invoke("alerts:get").catch(() => null),
    invoke("get-setting", "recentAlertMessages").catch(() => []),
  ]);
  recentAlertMessages = Array.isArray(recentMessages)
    ? recentMessages.filter((item) =>
      (typeof item === "string" && item.trim()) ||
      (item && typeof item.message === "string" && item.message.trim())).slice(0, 8)
    : [];
  renderQuickAlertMessages();
  updateAlertsSnapshot(alerts);
  updateAlertComposerActions();
  selectLiveLayersPage(page, { focus: true });
}

function closeLiveLayers() {
  document.getElementById("liveLayersBackdrop")?.setAttribute("hidden", "");
}

async function populateStageDisplaySelect() {
  const select = document.getElementById("stageDisplaySelect");
  if (!select) return;
  const result = await invoke("get-all-displays");
  select.options.length = 1;
  for (const display of result.displays || []) {
    const option = document.createElement("option");
    option.value = display.value;
    option.textContent = display.label;
    select.appendChild(option);
  }
  select.value = projectStageConfig.display || result.defaultStageDisplayIndex || "";
}

async function ensureStageOutput() {
  const display = document.getElementById("stageDisplaySelect")?.value || "";
  if (!display) {
    showGnomeToast("Choose a stage output display");
    return false;
  }
  const created = await invoke("create-stage-window", display);
  if (!created) return false;
  setSharedRendererState({ stageSessionIdCache: created.sessionId || stageSessionIdCache });
  await sendStageLayer("content", {
    ...stageContentCache,
    profile: document.getElementById("stageProfileSelect")?.value || "current-next",
  });
  updateStageStatusUi(await invoke("get-output-status"));
  return true;
}

async function showPrivateStageMessage() {
  const message = document.getElementById("stageMessageText")?.value?.trim() || "";
  if (!message) {
    showGnomeToast("Enter a private stage message");
    return false;
  }
  if (!(await ensureStageOutput())) return false;
  const result = await sendStageLayer("privateMessage", {
    schema: "ems.alert.v1",
    id: globalThis.crypto?.randomUUID?.() || `message-${Date.now()}`,
    kind: "privateStage",
    title: "Stage message",
    message: message.slice(0, 500),
    priority: "normal",
    routes: { audience: false, stage: true },
  });
  showGnomeToast(result?.delivered ? "Private message shown on stage" : "Stage message was not delivered");
  return result?.delivered === true;
}

async function clearPrivateStageMessage() {
  const result = await sendStageLayer("privateMessage", {}, "layer.clear");
  showGnomeToast(result?.delivered ? "Private stage message cleared" : "Stage output is closed");
  return result?.delivered === true;
}

async function openStageControls() {
  if (!document.getElementById("settingsControlsBackdrop")?.hidden) {
    closeSettingsControls();
  }
  await populateStageDisplaySelect().catch(console.error);
  updateStageStatusUi(await invoke("get-output-status").catch(() => null));
  document.getElementById("stageControlsBackdrop")?.removeAttribute("hidden");
  if (navigationState.state !== NAVIGATION_STATES.STAGE) {
    setSharedRendererState({ navigationStateBeforeStage: navigationState.state });
  }
  navigationState.transition(NAVIGATION_STATES.STAGE);
  document.getElementById("stageMessageText")?.focus();
}

function closeStageControls() {
  document.getElementById("stageControlsBackdrop")?.setAttribute("hidden", "");
  if (navigationState.state === NAVIGATION_STATES.STAGE) {
    navigationState.transition(navigationStateBeforeStage);
  }
}

function selectedDisplayValueFromSelect(id) {
  const select = document.getElementById(id);
  if (!select || select.value === "") return null;
  return select.value;
}

function hasAudienceOutputSelected() {
  const selectId = currentMode === STREAMPLAYER ? "dspSelctStreams" : "dspSelct";
  return selectedDisplayValueFromSelect(selectId) !== null;
}

function hasLowerThirdOutputSelected() {
  if (!isBibleLowerThirdFeatureEnabled()) return false;
  return selectedDisplayValueFromSelect("lowerThirdDspSelct") !== null;
}

function hasLiveLowerThirdText(contentType = null) {
  if (!isBibleLowerThirdFeatureEnabled() || !bibleLowerThirdOutputActive) return false;
  if (!activeLowerThirdContentType) return false;
  return contentType ? activeLowerThirdContentType === contentType : true;
}

function canClearLiveText() {
  return Boolean(
    hasLiveAudienceTextPresentation("bible") ||
      hasLiveAudienceTextPresentation("song") ||
      hasLiveLowerThirdText(),
  );
}

function hasLiveAudienceTextPresentation(type) {
  if (activeMediaWindowContentType !== type) return false;
  if (isActiveMediaWindow()) return true;
  if (type === "bible") {
    return Boolean(
      bibleShowNowModeActive ||
        (isQueuePlaying && isQueueItemBible(currentLiveQueueItem())) ||
        (isPlaying && !activeLiveStream),
    );
  }
  if (type === "song") {
    return Boolean(
      songShowNowModeActive ||
        (isQueuePlaying && isQueueItemSong(currentLiveQueueItem())) ||
        (isPlaying && !activeLiveStream),
    );
  }
  return false;
}

function updateClearLiveTextButtonState() {
  const button = document.getElementById("clearLiveTextButton");
  if (!button) return;
  const available = canClearLiveText();
  if (!available && liveTextClearActive) {
    setSharedRendererState({ liveTextClearActive: false });
  }
  const textHidden = available && liveTextClearActive;
  const label = document.getElementById("clearLiveTextButtonLabel");
  const buttonLabel = textHidden ? "Show Text" : "Clear Text";
  const buttonDescription = textHidden
    ? "Show live text"
    : "Clear live text and keep background";
  button.hidden = !available;
  button.disabled = !available;
  button.setAttribute("aria-hidden", available ? "false" : "true");
  button.setAttribute("aria-label", buttonDescription);
  button.title = buttonDescription;
  button.setAttribute("aria-pressed", textHidden ? "true" : "false");
  button.classList.toggle("is-active", textHidden);
  if (label) label.textContent = buttonLabel;
}

async function clearLiveText() {
  const hasBibleText =
    hasLiveAudienceTextPresentation("bible") || hasLiveLowerThirdText("bible");
  const hasSongText = hasLiveAudienceTextPresentation("song");
  if (!hasBibleText && !hasSongText) {
    showGnomeToast("No live text to clear");
    updateClearLiveTextButtonState();
    return false;
  }

  const restoringText = liveTextClearActive;
  let changed = false;
  if (hasBibleText) {
    changed =
      (restoringText
        ? await restoreLiveBibleText({ quiet: true })
        : await clearLiveBibleText({ quiet: true })) || changed;
  }
  if (hasSongText) {
    changed =
      (restoringText
        ? await restoreLiveSongText({ quiet: true })
        : await clearLiveSongText({ quiet: true })) || changed;
  }
  if (changed) {
    setSharedRendererState({ liveTextClearActive: !restoringText });
    send("set-audience-clear-state", liveTextClearActive);
    showGnomeToast(restoringText ? "Live text restored" : "Live text cleared");
  } else {
    showGnomeToast(restoringText ? "Could not restore live text" : "Could not clear live text");
  }
  updateClearLiveTextButtonState();
  updateOutputHoldButtonStates();
  return changed;
}

function mediaSourceSupportsLowerThird(item) {
  if (!item) return false;
  // File/media identity wins over any stale text snapshot fields retained by
  // an older project. A PowerPoint or regular media item must never keep a
  // song/Scripture lower third visible merely because it carries legacy data.
  if (
    isQueueItemPptx(item) ||
    isQueueItemDeck(item) ||
    isQueueItemAudio(item) ||
    isQueueItemImage(item) ||
    isQueueItemVideo(item)
  ) {
    return false;
  }
  return isQueueItemBible(item) || isQueueItemSong(item);
}

async function clearLowerThirdForUnsupportedMediaSource(item) {
  if (mediaSourceSupportsLowerThird(item)) return false;
  if (scripturePresentation.state.status !== "idle") {
    scripturePresentation.dispatch({ type: "STOPPED" });
  }
  setSharedRendererState({ lowerThirdOutputUpdateToken: lowerThirdOutputUpdateToken + (1) });
  const keyOnlyMessage = lowerThirdKeyOnlyMessage(
    lastLowerThirdBibleTextMessage || {},
    bibleDesignerState.lowerThirdChromaKeyColor || SCRIPTURE_LOWER_THIRD_CHROMA_KEY_COLOR,
  );
  // Drop the live content type before the send so the header's clear/restore
  // control cannot put the old cue back on air over the new schedule item.
  setSharedRendererState({ activeLowerThirdContentType: null });
  setSharedRendererState({ bibleLowerThirdLiveCueKey: "" });
  songLowerThirdState.liveKey = "";
  // This is an imperative renderer reset, separate from the normal text
  // update/diff pipeline. It guarantees stale song object DOM is destroyed.
  send("clear-lower-third-text", {
    chromaKeyColor: keyOnlyMessage.chromaKeyColor,
  });
  const rendererCleared = await invoke("clear-lower-third-text-now", {
    chromaKeyColor: keyOnlyMessage.chromaKeyColor,
  }).catch((error) => {
    console.error("Failed to confirm lower-third clear:", error);
    return false;
  });
  if (!rendererCleared && bibleLowerThirdOutputActive) {
    console.warn("Lower-third renderer did not acknowledge the clear update");
  }
  sendBibleLowerThirdTextMessage(keyOnlyMessage, {
    remember: false,
    clearToggle: false,
    respectLiveTextClearState: false,
  });
  renderSongLowerThirdControls();
  return true;
}

async function updateLowerThirdForSupportedScheduleItem(item, expectedRevision = null) {
  if (!mediaSourceSupportsLowerThird(item) || !hasLowerThirdOutputSelected()) {
    return false;
  }
  if (!isBibleLowerThirdFeatureEnabled()) return false;
  if (isQueueItemBible(item)) {
    const entry = await resolvedBibleEntryForItem(item);
    return ensureBibleLowerThirdOutput(entry, expectedRevision);
  }
  if (isQueueItemSong(item)) {
    return sendSongLowerThirdForLiveItem();
  }
  return false;
}

function liveThemeFields(resolved) {
  const typography = resolved.typography || {};
  const background = resolved.canvas?.background || {};
  const backgroundMedia = background.assetUrl || background.url || background.path || "";
  const textFrame = resolved.textFrame || {};
  return {
    fontFamily: typography.fontFamily,
    fontSize: typography.fontSize,
    minFontSize: typography.minFontSize,
    fontWeight: typography.fontWeight,
    lineHeight: typography.lineHeight,
    color: typography.color,
    backgroundColor: background.color,
    backgroundPath: backgroundMedia,
    backgroundImage: background.type === "image" ? backgroundMedia : "",
    backgroundVideo: background.type === "video" ? backgroundMedia : "",
    textBoxPosition: Number.isFinite(textFrame.x)
      ? {
          left: `${textFrame.x * 100}%`,
          top: `${textFrame.y * 100}%`,
          width: `${textFrame.width * 100}%`,
          height: `${textFrame.height * 100}%`,
        }
      : undefined,
    transition: {
      effect: resolved.transition?.type || "none",
      durationMs: resolved.transition?.durationMs || 0,
    },
    themeId: resolved.themeId,
    themeRevision: resolved.themeRevision,
    resolvedThemeVersion: resolved.resolvedThemeVersion,
    resolvedTheme: resolved,
  };
}

function themedAudienceMessage(message, resolved) {
  if (!message) return null;
  const fields = liveThemeFields(resolved);
  return {
    ...message,
    ...fields,
    ...resolvedFontFamilyFields(message, resolved),
    ...resolvedAudienceBackgroundFields(message, resolved),
    referenceText: resolved.reference?.visible === false ? "" : message.referenceText,
    attributionText: resolved.attribution?.visible === false ? "" : message.attributionText,
    copyrightText: resolved.copyright?.visible === false ? "" : message.copyrightText,
  };
}

function themedLowerThirdMessage(message, resolved) {
  if (!message) return null;
  const fields = liveThemeFields(resolved);
  const backdrop = resolved.backdrop?.background || {};
  // The Theme Manager exposes the lower-third canvas background as the chroma
  // color. Prefer it so themes saved before key.chromaColor was synchronized
  // also render with the color the operator selected.
  const chroma = resolved.canvas?.background?.color || resolved.key?.chromaColor || "#00ff00";
  return enrichLowerThirdPresentationMessage({
    ...message,
    ...fields,
    ...resolvedFontFamilyFields(message, resolved, { lowerThird: true }),
    lowerThirdFontSize: resolved.typography?.fontSize,
    lowerThirdColor: resolved.typography?.color,
    lowerThirdBarBackgroundColor:
      resolved.backdrop?.enabled === false ? "transparent" : backdrop.color || "#101010",
    lowerThirdBarBackgroundPath:
      resolved.backdrop?.enabled === false ? "" : backdrop.assetUrl || backdrop.path || "",
    lowerThirdBackingPlateEnabled: resolved.backdrop?.enabled !== false,
    lowerThirdChromaKeyColor: chroma,
    backgroundColor: chroma,
    chromaKeyColor: chroma,
  }, pathToMediaUrl);
}

function themeLowerThirdMessageIfApplied(message, contentKind) {
  if (message?.resolvedTheme?.themeId) return message;
  if (!appliedPresentationTheme || !message) return message;
  const outputSize = selectedBiblePreviewOutputSize("lowerThirdDspSelct");
  const resolved = resolveThemeForTarget({
    theme: appliedPresentationTheme,
    contentKind,
    outputRole: "lowerThird",
    outputSize,
  });
  return themedLowerThirdMessage(message, resolved);
}

async function applyThemeToLivePresentation(theme) {
  setSharedRendererState({ appliedPresentationTheme: theme });
  const size = await currentBibleScheduleOutputSize().catch(() => ({ width: 1920, height: 1080 }));
  if (hasLiveAudienceTextPresentation("song") && lastAudienceSongTextMessage) {
    const resolved = resolveThemeForTarget({ theme, contentKind: "song", outputRole: "audience", outputSize: size });
    const message = themedAudienceMessage(lastAudienceSongTextMessage, resolved);
    const themeFields = liveThemeFields(resolved);
    if (currentSongRenderState.fontFamilyOverride) delete themeFields.fontFamily;
    setCurrentSongRenderState(mergeSongRenderState(currentSongRenderState, themeFields));
    sendAudienceTextMessage("song", message);
  }
  if (hasLiveAudienceTextPresentation("bible") && lastAudienceBibleTextMessage) {
    const resolved = resolveThemeForTarget({ theme, contentKind: "scripture", outputRole: "audience", outputSize: size });
    const message = themedAudienceMessage(lastAudienceBibleTextMessage, resolved);
    const themeFields = liveThemeFields(resolved);
    if (bibleDesignerState.fontFamilyOverride) delete themeFields.fontFamily;
    Object.assign(bibleDesignerState, themeFields);
    sendAudienceTextMessage("bible", message);
    applyBiblePreview(bibleDesignerState);
  }
  if (bibleLowerThirdOutputActive && activeLowerThirdContentType === "bible" && lastLowerThirdBibleTextMessage) {
    const resolved = resolveThemeForTarget({ theme, contentKind: "scripture", outputRole: "lowerThird", outputSize: size });
    const message = themedLowerThirdMessage(lastLowerThirdBibleTextMessage, resolved);
    Object.assign(bibleDesignerState, {
      ...(!bibleDesignerState.lowerThirdFontFamilyOverride
        ? { lowerThirdFontFamily: resolved.typography?.fontFamily }
        : {}),
      lowerThirdFontSize: resolved.typography?.fontSize,
      lowerThirdColor: resolved.typography?.color,
      lowerThirdChromaKeyColor: resolved.key?.chromaColor,
      lowerThirdBackingPlateEnabled: resolved.backdrop?.enabled !== false,
      lowerThirdBarBackgroundColor:
        resolved.backdrop?.enabled === false
          ? "transparent"
          : resolved.backdrop?.background?.color,
    });
    sendBibleLowerThirdTextMessage({
      ...message,
      transition: { effect: "none", durationMs: 0 },
    });
  }
  if (bibleLowerThirdOutputActive && activeLowerThirdContentType === "song") {
    sendBibleLowerThirdTextMessage({
      ...buildSongLowerThirdMessage(),
      transition: { effect: "none", durationMs: 0 },
    });
  }
  if (document.getElementById("bibleWorkspace")?.hidden === false) {
    applyBiblePreview(bibleDesignerState, { show: false });
  }
  if (isSongsWorkspaceVisible()) {
    const section = currentSongActiveSection();
    if (section) {
      await renderSongSectionPreview(section);
      renderSongSlideNavigator();
    }
  }
  renderSongLowerThirdControls();
  showGnomeToast(`Applied “${theme.name}” to live outputs`);
}

export {
  LIVE_LAYER_PAGE_ORDER,
  READY_ALERT_MESSAGES,
  activeLiveLayersPage,
  addNurseryAlertFromDraft,
  alertTokenDefinitionsDraft,
  applyLowerThirdOutputPreferences,
  applyThemeToLivePresentation,
  audienceAlertDraft,
  canClearLiveText,
  clearAudienceAlert,
  clearLiveText,
  clearLowerThirdForUnsupportedMediaSource,
  clearPrivateStageMessage,
  clearTextFromPresentationMessage,
  closeLiveLayers,
  closeStageControls,
  currentAlertsSnapshot,
  ensureStageOutput,
  handleLiveLayersTabKeydown,
  hasAudienceOutputSelected,
  hasLiveAudienceTextPresentation,
  hasLiveLowerThirdText,
  hasLowerThirdOutputSelected,
  insertAlertToken,
  livePresentationForStage,
  liveThemeFields,
  mediaSourceSupportsLowerThird,
  nextStageRevision,
  nonTextPresentationObjects,
  openLiveLayers,
  openStageControls,
  populateStageDisplaySelect,
  recentAlertMessages,
  rememberAudienceTextMessage,
  rememberRecentAlertMessage,
  renderAlertLists,
  renderQuickAlertMessages,
  selectLiveLayersPage,
  selectedDisplayValueFromSelect,
  sendAudienceTextMessage,
  sendCachedStageContent,
  sendStageLayer,
  shouldApplyLiveTextClearState,
  showAudienceAlert,
  showPrivateStageMessage,
  stageLayerRevisions,
  syncLowerThirdFeatureAvailability,
  syncStageContentFromAudienceMessage,
  syncStageContentFromQueueItem,
  themeLowerThirdMessageIfApplied,
  themedAudienceMessage,
  themedLowerThirdMessage,
  updateAlertComposerActions,
  updateAlertsSnapshot,
  updateClearLiveTextButtonState,
  updateLowerThirdForSupportedScheduleItem,
  updateStageStatusUi,
  useQuickAlertMessage,
};
