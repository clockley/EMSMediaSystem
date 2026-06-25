/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
import { contextBridge, ipcRenderer } from "electron/renderer";

const PREFLIGHT_DIALOG_IPC_CHANNEL = "preflight-dialog-response";
let preflightDefaultAction = "ok";

function dismiss(action = preflightDefaultAction) {
  const normalizedAction =
    action === "reload" || action === "keep" || action === "ok"
      ? action
      : preflightDefaultAction;
  ipcRenderer.send(PREFLIGHT_DIALOG_IPC_CHANNEL, normalizedAction);
}

function formatPreflightTime(iso) {
  if (typeof iso !== "string" || !iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSection(title, rowsHtml) {
  if (!rowsHtml) return "";
  return `
    <section class="preflight-section" aria-labelledby="${escapeHtml(title).replace(/\s+/g, "-").toLowerCase()}">
      <h2 class="preflight-section__title" id="${escapeHtml(title).replace(/\s+/g, "-").toLowerCase()}">${escapeHtml(title)}</h2>
      <div class="preflight-list" role="list">${rowsHtml}</div>
    </section>`;
}

function renderChangedRow(item) {
  const saved = formatPreflightTime(item.savedModifiedTime);
  const current = formatPreflightTime(item.currentModifiedTime);
  const timeDetail =
    saved && current
      ? `Saved ${saved} → now ${current}`
      : item.confirmedByHash === false
        ? "Modified time changed (content not verified)"
        : "Content changed since last save";
  const actionDetail =
    item.canKeepOld === true
      ? "Keep Old is available"
      : "EMS will reload this linked file from disk";
  const detail = `${timeDetail}. ${actionDetail}.`;
  return `
    <div class="preflight-row preflight-row--changed" role="listitem">
      <span class="preflight-row__icon" aria-hidden="true">⚠</span>
      <span class="preflight-row__text">
        <span class="preflight-row__title" title="${escapeHtml(item.path || item.name || "")}">${escapeHtml(item.name || item.path || "Unknown file")}</span>
        <span class="preflight-row__detail">${escapeHtml(detail)}</span>
      </span>
    </div>`;
}

function renderMissingRow(item) {
  return `
    <div class="preflight-row preflight-row--missing" role="listitem">
      <span class="preflight-row__icon" aria-hidden="true">✕</span>
      <span class="preflight-row__text">
        <span class="preflight-row__title" title="${escapeHtml(item.path || item.name || "")}">${escapeHtml(item.name || item.path || "Unknown file")}</span>
        <span class="preflight-row__detail">File could not be found</span>
      </span>
    </div>`;
}

function renderPreflight(payload) {
  const intro = document.getElementById("preflight_dialog_intro");
  const body = document.getElementById("preflight_dialog_body");
  if (!intro || !body) return;

  const changedItems = Array.isArray(payload?.changedItems) ? payload.changedItems : [];
  const missingItems = Array.isArray(payload?.missingItems) ? payload.missingItems : [];
  const actionMode =
    payload?.actionMode === "choice" || payload?.actionMode === "reload-only"
      ? payload.actionMode
      : "ok";
  const parts = [];
  if (changedItems.length > 0) parts.push(`${changedItems.length} changed`);
  if (missingItems.length > 0) parts.push(`${missingItems.length} missing`);

  if (actionMode === "choice") {
    preflightDefaultAction = "keep";
    intro.textContent =
      `Some linked media files differ from the versions recorded when this project was last saved (${parts.join(", ")}). Choose Reload to use the file on disk, or Keep Old for files EMS has safely staged.`;
  } else if (actionMode === "reload-only") {
    preflightDefaultAction = "reload";
    intro.textContent =
      `Some linked media files differ from the versions recorded when this project was last saved (${parts.join(", ")}). EMS cannot keep the old linked version on this system, so reload before going live.`;
  } else {
    preflightDefaultAction = "ok";
    intro.textContent =
      parts.length > 0
        ? `Some media files differ from the versions recorded when this project was last saved (${parts.join(", ")}). Review the list below before going live.`
        : "All scheduled media matches the last saved project.";
  }

  const changedHtml = changedItems.map(renderChangedRow).join("");
  const missingHtml = missingItems.map(renderMissingRow).join("");
  body.innerHTML =
    renderSection("Changed since last saved", changedHtml) +
    renderSection("Missing files", missingHtml);

  const ok = document.getElementById("preflight_dialog_ok");
  const keep = document.getElementById("preflight_dialog_keep");
  const reload = document.getElementById("preflight_dialog_reload");
  if (ok) ok.hidden = changedItems.length > 0;
  if (keep) keep.hidden = actionMode !== "choice";
  if (reload) reload.hidden = changedItems.length === 0;
}

contextBridge.exposeInMainWorld("preflightDialog", { render: renderPreflight, dismiss });

let preflightDialogButtonsWired = false;

function wireDialogButtons() {
  if (preflightDialogButtonsWired) return;
  const ok = document.getElementById("preflight_dialog_ok");
  const keep = document.getElementById("preflight_dialog_keep");
  const reload = document.getElementById("preflight_dialog_reload");
  const closeBtn = document.querySelector(".window-control.close");
  if (!ok || !keep || !reload) return;
  preflightDialogButtonsWired = true;

  const handleDismiss = (action) => (event) => {
    if (typeof event.button === "number" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dismiss(action);
  };

  ok.addEventListener("click", handleDismiss("ok"));
  keep.addEventListener("click", handleDismiss("keep"));
  reload.addEventListener("click", handleDismiss("reload"));
  if (closeBtn) closeBtn.addEventListener("click", handleDismiss());
}

function wireDialogButtonsWhenReady() {
  wireDialogButtons();
  if (!preflightDialogButtonsWired) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", wireDialogButtons, { once: true });
    }
    requestAnimationFrame(() => {
      wireDialogButtons();
      if (!preflightDialogButtonsWired) setTimeout(wireDialogButtons, 0);
    });
  }
}

wireDialogButtonsWhenReady();
