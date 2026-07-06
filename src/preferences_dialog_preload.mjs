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
};

function readFormIntoDraft() {
  const fitSelect = document.getElementById("preferencesLogoFit");
  const backgroundInput = document.getElementById("preferencesLogoBackground");
  draft.logoFit = fitSelect?.value === "cover" ? "cover" : "contain";
  draft.logoBackground = normalizeHexColor(backgroundInput?.value, "#000000");
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
  const img = document.createElement("img");
  img.alt = basename(logoPath);
  img.src = pathToFileUrl(logoPath);
  img.style.objectFit = draft.logoFit === "cover" ? "cover" : "contain";
  preview.appendChild(img);
}

function applyDraftToForm() {
  const fitSelect = document.getElementById("preferencesLogoFit");
  const backgroundInput = document.getElementById("preferencesLogoBackground");
  if (fitSelect) fitSelect.value = draft.logoFit === "cover" ? "cover" : "contain";
  if (backgroundInput) {
    backgroundInput.value = normalizeHexColor(draft.logoBackground, "#000000");
  }
  syncLogoPreview();
}

async function loadPreferences() {
  const prefs = await ipcRenderer.invoke("get-output-hold-preferences");
  draft = {
    logoPath: typeof prefs?.logoPath === "string" ? prefs.logoPath : "",
    logoFit: prefs?.logoFit === "cover" ? "cover" : "contain",
    logoBackground: normalizeHexColor(prefs?.logoBackground, "#000000"),
  };
  applyDraftToForm();
}

function closeDialog() {
  ipcRenderer.send(PREFERENCES_DIALOG_CLOSE_CHANNEL);
}

async function applyPreferences() {
  readFormIntoDraft();
  await ipcRenderer.invoke("save-output-hold-preferences", { ...draft });
  closeDialog();
}

async function browseLogo() {
  const result = await ipcRenderer.invoke("show-logo-file-dialog");
  if (result?.canceled || !result?.filePath) return;
  draft.logoPath = result.filePath;
  syncLogoPreview();
}

function clearLogo() {
  draft.logoPath = "";
  syncLogoPreview();
}

function wirePreferencesDialog() {
  document.getElementById("preferencesBrowseLogoBtn")?.addEventListener("click", () => {
    void browseLogo().catch(console.error);
  });
  document.getElementById("preferencesClearLogoBtn")?.addEventListener("click", clearLogo);
  document.getElementById("preferencesApplyBtn")?.addEventListener("click", () => {
    void applyPreferences().catch(console.error);
  });
  document.getElementById("preferencesCancelBtn")?.addEventListener("click", closeDialog);
  document.getElementById("preferencesCloseButton")?.addEventListener("click", closeDialog);
  document.getElementById("preferencesLogoFit")?.addEventListener("change", () => {
    readFormIntoDraft();
    syncLogoPreview();
  });
  document.getElementById("preferencesLogoBackground")?.addEventListener("input", () => {
    readFormIntoDraft();
    syncLogoPreview();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
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
