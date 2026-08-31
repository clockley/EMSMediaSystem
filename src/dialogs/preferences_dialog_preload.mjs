/*
Copyright (C) 2026 Christian Lockley
*/
import { contextBridge, ipcRenderer } from "electron/renderer";

const PREFERENCES_DIALOG_CLOSE_CHANNEL = "preferences-dialog-close";

function basename(filePath = "") {
  const normalized = String(filePath).replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function normalizeHexColor(value, fallback = "#000000") {
  const color = String(value || "").trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ? color : fallback;
}

function pathToFileUrl(filePath) {
  if (!filePath || typeof filePath !== "string") return "";
  if (/^(file|https?|blob):/i.test(filePath)) return filePath;
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    return `file://${encodeURI(normalized)}`;
  }
  return `file:///${encodeURI(normalized)}`;
}

let draft = {
  logoPath: "",
  logoFit: "contain",
  logoBackground: "#000000",
  lowerThirdChromaKeyColor: "#00ff00",
  bibleUiEnabled: true,
  lowerThirdUiEnabled: true,
  switcherConnections: [],
};

function readFormIntoDraft() {
  const fitSelect = document.getElementById("preferencesLogoFit");
  const backgroundInput = document.getElementById("preferencesLogoBackground");
  const lowerThirdChromaKeyInput = document.getElementById("preferencesLowerThirdChromaKey");
  draft.logoFit = fitSelect?.value === "cover" ? "cover" : "contain";
  draft.logoBackground = normalizeHexColor(backgroundInput?.value, "#000000");
  draft.lowerThirdChromaKeyColor = normalizeHexColor(
    lowerThirdChromaKeyInput?.value,
    "#00ff00",
  );
  draft.bibleUiEnabled = document.getElementById("preferencesBibleUiEnabled")?.checked !== false;
  draft.lowerThirdUiEnabled = document.getElementById("preferencesLowerThirdUiEnabled")?.checked !== false;
}

function isVideoLogoPath(filePath = "") {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(String(filePath));
}

function syncLogoPreview() {
  const pathEl = document.getElementById("preferencesLogoPath");
  const preview = document.getElementById("preferencesLogoPreview");
  if (!pathEl || !preview) return;

  const logoPath = String(draft.logoPath || "").trim();
  if (!logoPath) {
    pathEl.textContent = "No logo selected";
    pathEl.classList.add("is-empty");
    pathEl.title = "";
    preview.innerHTML =
      '<span class="preferences-logo-preview__empty">Preview appears here</span>';
    preview.style.backgroundColor = draft.logoBackground;
    preview.setAttribute("aria-hidden", "true");
    return;
  }

  pathEl.textContent = logoPath;
  pathEl.classList.remove("is-empty");
  pathEl.title = logoPath;
  preview.style.backgroundColor = draft.logoBackground;
  preview.setAttribute("aria-hidden", "false");
  preview.innerHTML = "";
  const mediaUrl = pathToFileUrl(logoPath);
  if (isVideoLogoPath(logoPath)) {
    const video = document.createElement("video");
    video.src = mediaUrl;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.autoplay = true;
    video.style.objectFit = draft.logoFit === "cover" ? "cover" : "contain";
    video.style.maxWidth = "100%";
    video.style.maxHeight = "120px";
    preview.appendChild(video);
    return;
  }
  const img = document.createElement("img");
  img.alt = basename(logoPath);
  img.src = mediaUrl;
  img.style.objectFit = draft.logoFit === "cover" ? "cover" : "contain";
  preview.appendChild(img);
}

function applyDraftToForm() {
  const fitSelect = document.getElementById("preferencesLogoFit");
  const backgroundInput = document.getElementById("preferencesLogoBackground");
  const lowerThirdChromaKeyInput = document.getElementById("preferencesLowerThirdChromaKey");
  const bibleUiInput = document.getElementById("preferencesBibleUiEnabled");
  const lowerThirdUiInput = document.getElementById("preferencesLowerThirdUiEnabled");
  if (fitSelect) fitSelect.value = draft.logoFit === "cover" ? "cover" : "contain";
  if (backgroundInput) {
    backgroundInput.value = normalizeHexColor(draft.logoBackground, "#000000");
  }
  if (lowerThirdChromaKeyInput) {
    lowerThirdChromaKeyInput.value = normalizeHexColor(
      draft.lowerThirdChromaKeyColor,
      "#00ff00",
    );
  }
  if (bibleUiInput) bibleUiInput.checked = draft.bibleUiEnabled !== false;
  if (lowerThirdUiInput) lowerThirdUiInput.checked = draft.lowerThirdUiEnabled !== false;
  renderSwitcherConnections();
  syncLogoPreview();
}

async function loadPreferences() {
  const prefs = await ipcRenderer.invoke("get-output-hold-preferences");
  draft = {
    logoPath: typeof prefs?.logoPath === "string" ? prefs.logoPath : "",
    logoFit: prefs?.logoFit === "cover" ? "cover" : "contain",
    logoBackground: normalizeHexColor(prefs?.logoBackground, "#000000"),
    lowerThirdChromaKeyColor: normalizeHexColor(
      prefs?.lowerThirdChromaKeyColor,
      "#00ff00",
    ),
    bibleUiEnabled: prefs?.bibleUiEnabled !== false,
    lowerThirdUiEnabled: prefs?.lowerThirdUiEnabled !== false,
    switcherConnections: Array.isArray(prefs?.switcherConnections)
      ? prefs.switcherConnections.map((connection) => ({ ...connection }))
      : [],
  };
  applyDraftToForm();
}

async function closeDialog() {
  const rows = [...document.querySelectorAll(".switcher-connection-row")];
  for (const row of rows) await updateSwitcherConnection(row);
  ipcRenderer.send(PREFERENCES_DIALOG_CLOSE_CHANNEL);
}

async function savePreferences() {
  readFormIntoDraft();
  await ipcRenderer.invoke("save-output-hold-preferences", { ...draft });
}

function createTextInput({ value, placeholder, label, field }) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  input.placeholder = placeholder;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", label);
  input.dataset.field = field;
  return input;
}

function renderSwitcherConnections() {
  const container = document.getElementById("preferencesSwitcherConnections");
  if (!container) return;
  container.replaceChildren();
  if (draft.switcherConnections.length === 0) {
    const empty = document.createElement("div");
    empty.className = "switcher-connections-empty";
    empty.textContent = "No switchers configured";
    container.appendChild(empty);
    return;
  }

  for (const connection of draft.switcherConnections) {
    const row = document.createElement("div");
    row.className = "switcher-connection-row";
    row.dataset.connectionId = connection.id;

    const fields = document.createElement("div");
    fields.className = "switcher-connection-fields";
    fields.append(
      createTextInput({ value: connection.name, placeholder: "Switcher name", label: "Switcher name", field: "name" }),
      createTextInput({ value: connection.host, placeholder: "192.168.1.240", label: `${connection.name} IP address`, field: "host" }),
    );

    const actions = document.createElement("div");
    actions.className = "switcher-connection-actions";
    const enabled = document.createElement("label");
    enabled.className = "switch";
    enabled.title = "Enable this switcher";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = connection.enabled !== false;
    checkbox.dataset.field = "enabled";
    const track = document.createElement("span");
    track.className = "switch-track";
    const thumb = document.createElement("span");
    thumb.className = "switch-thumb";
    enabled.append(checkbox, track, thumb);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "pill-button";
    remove.dataset.action = "remove";
    remove.textContent = "Remove";
    actions.append(enabled, remove);

    const status = document.createElement("p");
    status.className = "preferences-inline-status";
    status.dataset.role = "status";
    status.setAttribute("role", "status");
    status.hidden = true;
    row.append(fields, actions, status);
    container.appendChild(row);
  }
}

function setSwitcherStatus(row, message, variant = "") {
  const status = row?.querySelector('[data-role="status"]');
  if (!status) return;
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle("is-error", variant === "error");
  status.classList.toggle("is-success", variant === "success");
}

async function updateSwitcherConnection(row) {
  const id = row?.dataset.connectionId;
  const current = draft.switcherConnections.find((connection) => connection.id === id);
  if (!id || !current) return;
  const name = row.querySelector('[data-field="name"]')?.value || "";
  const host = row.querySelector('[data-field="host"]')?.value || "";
  const enabled = row.querySelector('[data-field="enabled"]')?.checked !== false;
  try {
    const saved = await ipcRenderer.invoke("switcher-connections:update", id, { name, host, enabled });
    Object.assign(current, saved);
    setSwitcherStatus(row, host.trim() ? "Saved" : "Add an IP address to use this switcher", host.trim() ? "success" : "");
  } catch (error) {
    setSwitcherStatus(row, error?.message || "Could not save switcher", "error");
  }
}

async function addSwitcherConnection() {
  const button = document.getElementById("preferencesAddAtemBtn");
  const status = document.getElementById("preferencesSwitcherConnectionsStatus");
  if (button?.disabled) return;
  if (button) button.disabled = true;
  if (status) {
    status.textContent = "";
    status.hidden = true;
    status.classList.remove("is-error");
  }
  try {
    const connection = await ipcRenderer.invoke("switcher-connections:add", {});
    if (!connection?.id) throw new Error("The switcher registry returned an invalid entry");
    draft.switcherConnections.push(connection);
    renderSwitcherConnections();
    const row = document.querySelector(`[data-connection-id="${connection.id}"]`);
    row?.querySelector('[data-field="name"]')?.focus();
  } catch (error) {
    console.error("Could not add ATEM switcher:", error);
    if (status) {
      status.textContent = error?.message || "Could not add the ATEM switcher";
      status.hidden = false;
      status.classList.add("is-error");
    }
  } finally {
    if (button) button.disabled = false;
  }
}

async function removeSwitcherConnection(row) {
  const id = row?.dataset.connectionId;
  if (!id) return;
  await ipcRenderer.invoke("switcher-connections:remove", id);
  draft.switcherConnections = draft.switcherConnections.filter((connection) => connection.id !== id);
  renderSwitcherConnections();
}

async function browseLogo() {
  const result = await ipcRenderer.invoke("show-logo-file-dialog");
  if (result?.canceled || !result?.filePath) return;
  draft.logoPath = result.filePath;
  syncLogoPreview();
  await savePreferences();
}

async function clearLogo() {
  draft.logoPath = "";
  syncLogoPreview();
  await savePreferences();
}

function setClearSongsStatus(message, variant = "") {
  const statusEl = document.getElementById("preferencesClearSongsStatus");
  if (!statusEl) return;
  const text = String(message || "");
  statusEl.textContent = text;
  statusEl.hidden = text === "";
  statusEl.classList.toggle("is-error", variant === "error");
  statusEl.classList.toggle("is-success", variant === "success");
}

async function clearSongsDatabase() {
  const button = document.getElementById("preferencesClearSongsBtn");
  if (button?.disabled) return;
  if (button) button.disabled = true;
  setClearSongsStatus("Clearing songs database…");
  try {
    const result = await ipcRenderer.invoke("clear-songs-database");
    if (result?.cleared) {
      setClearSongsStatus("Songs database cleared. Ready to load new songs.", "success");
    } else {
      setClearSongsStatus("");
    }
  } catch (error) {
    console.error("Failed to clear songs database:", error);
    setClearSongsStatus("Could not clear the songs database.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

function wirePreferencesDialog() {
  document.getElementById("preferencesBrowseLogoBtn")?.addEventListener("click", () => {
    void browseLogo().catch(console.error);
  });
  document.getElementById("preferencesClearLogoBtn")?.addEventListener("click", () => {
    void clearLogo().catch(console.error);
  });
  document.getElementById("preferencesClearSongsBtn")?.addEventListener("click", () => {
    void clearSongsDatabase().catch(console.error);
  });
  document.getElementById("preferencesCloseButton")?.addEventListener("click", () => {
    void closeDialog().catch(console.error);
  });
  document.getElementById("preferencesLogoFit")?.addEventListener("change", () => {
    readFormIntoDraft();
    syncLogoPreview();
    void savePreferences().catch(console.error);
  });
  document.getElementById("preferencesLogoBackground")?.addEventListener("input", () => {
    readFormIntoDraft();
    syncLogoPreview();
  });
  document.getElementById("preferencesLogoBackground")?.addEventListener("change", () => {
    void savePreferences().catch(console.error);
  });
  document.getElementById("preferencesLowerThirdChromaKey")?.addEventListener("change", () => {
    void savePreferences().catch(console.error);
  });
  document.getElementById("preferencesBibleUiEnabled")?.addEventListener("change", () => {
    void savePreferences().catch(console.error);
  });
  document.getElementById("preferencesLowerThirdUiEnabled")?.addEventListener("change", () => {
    void savePreferences().catch(console.error);
  });
  document.getElementById("preferencesAddAtemBtn")?.addEventListener("click", () => {
    void addSwitcherConnection();
  });
  document.getElementById("preferencesSwitcherConnections")?.addEventListener("change", (event) => {
    const row = event.target?.closest?.(".switcher-connection-row");
    void updateSwitcherConnection(row).catch(console.error);
  });
  document.getElementById("preferencesSwitcherConnections")?.addEventListener("input", (event) => {
    const row = event.target?.closest?.(".switcher-connection-row");
    setSwitcherStatus(row, "");
  });
  document.getElementById("preferencesSwitcherConnections")?.addEventListener("click", (event) => {
    const button = event.target?.closest?.('[data-action="remove"]');
    if (!button) return;
    const row = button.closest(".switcher-connection-row");
    void removeSwitcherConnection(row).catch(console.error);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void closeDialog().catch(console.error);
    }
  });
}

contextBridge.exposeInMainWorld("preferencesDialog", {
  load: loadPreferences,
});

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      wirePreferencesDialog();
      void loadPreferences().catch(console.error);
    },
    { once: true },
  );
} else {
  wirePreferencesDialog();
  void loadPreferences().catch(console.error);
}
