import { themeBackdropCornerRadius, themeSafeMargin } from "../shared/theme-editor-values.min.mjs";

const api = window.themeManager;
let records = [];
let activeThemeId = null;
let selectedId = null;
let original = null;
let draft = null;
let applyRevision = 0;
let reloadRevision = 0;
const pendingAssetIdsByTheme = new Map();
const initialParams = new URLSearchParams(window.location.search);
let outputRole = initialParams.get("outputRole") === "lowerThird" ? "lowerThird" : "audience";
let applyContext = {
  scope: initialParams.get("scope") === "item" ? "item" : "global",
  queueIndex: /^\d+$/.test(initialParams.get("queueIndex") || "") ? Number(initialParams.get("queueIndex")) : null,
};

const $ = id => document.getElementById(id);
const copy = value => structuredClone(value);
const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback;
const fileName = value => String(value || "").split(/[/\\]/).filter(Boolean).at(-1) || "";
const profile = () => draft?.profiles?.[$("tmKind").value]?.[outputRole];
const isBuiltIn = () => records.find(item => item.id === selectedId)?.source === "built-in";
const isDirty = () => original && draft && JSON.stringify(original) !== JSON.stringify(draft);
const isSelectedActive = () => Boolean(selectedId) && selectedId === activeThemeId;

function rememberPendingAsset(themeId, assetId) {
  if (!themeId || !assetId) return;
  let ids = pendingAssetIdsByTheme.get(themeId);
  if (!ids) {
    ids = new Set();
    pendingAssetIdsByTheme.set(themeId, ids);
  }
  ids.add(assetId);
}

function referencedThemeAssetIds(theme) {
  const ids = new Set();
  const visit = value => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "assetId" && typeof child === "string" && child) ids.add(child);
      else visit(child);
    }
  };
  visit(theme?.profiles);
  return ids;
}

function pruneDiscardedPendingAssets(theme) {
  const pendingIds = pendingAssetIdsByTheme.get(theme?.id);
  if (!Array.isArray(theme?.assets)) return;
  const referencedIds = referencedThemeAssetIds(theme);
  theme.assets = theme.assets.filter(
    asset => (
      referencedIds.has(asset?.id) ||
      (!pendingIds?.has(asset?.id) && !["image", "video"].includes(asset?.type))
    ),
  );
}

function applyOpenContext(context = {}) {
  const contentKind = ["song", "scripture", "text"].includes(context?.contentKind)
    ? context.contentKind
    : "song";
  outputRole = context?.outputRole === "lowerThird" ? "lowerThird" : "audience";
  applyContext = {
    scope: context?.scope === "item" ? "item" : "global",
    queueIndex: Number.isInteger(context?.queueIndex) ? context.queueIndex : null,
  };
  $("tmKind").value = contentKind;
  $("tmAudienceTab").setAttribute("aria-pressed", outputRole === "audience" ? "true" : "false");
  $("tmLowerThirdTab").setAttribute("aria-pressed", outputRole === "lowerThird" ? "true" : "false");
  if (draft) fillEditor();
}

function setStatus(message = "", error = false) {
  $("tmStatus").textContent = message;
  $("tmStatus").classList.toggle("is-error", error);
}

function ensureProfile(kind, role) {
  draft.profiles ||= {}; draft.profiles[kind] ||= {}; draft.profiles[kind][role] ||= {};
  const target = draft.profiles[kind][role]; target.typography ||= {}; target.canvas ||= {};
  target.canvas.background ||= {}; target.canvas.safeMargins ||= {};
  target.backdrop ||= {}; target.backdrop.background ||= {};
  target.transition ||= {};
  return target;
}

function themeSwatch(theme) {
  return color(theme?.profiles?.song?.audience?.canvas?.background?.color || theme?.tokens?.surfaceColor, "#000000");
}

const checkIconMarkup = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 4.5l-7 7-3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderList() {
  const query = $("tmSearch").value.trim().toLocaleLowerCase(); const list = $("tmList"); list.replaceChildren();
  for (const source of ["built-in", "user", "project"]) {
    const matching = records.filter(record => record.source === source && `${record.name} ${record.description || ""}`.toLocaleLowerCase().includes(query));
    if (!matching.length) continue;
    const heading = document.createElement("li"); heading.className = "tm-section"; heading.textContent = source === "built-in" ? "Built-in" : source === "user" ? "My Themes" : "Project"; list.appendChild(heading);
    for (const record of matching) {
      const isActive = record.id === activeThemeId;
      const item = document.createElement("li"); const button = document.createElement("button");
      button.type = "button"; button.className = "tm-row"; button.dataset.id = record.id;
      button.setAttribute("aria-selected", record.id === selectedId ? "true" : "false");
      button.dataset.active = isActive ? "true" : "false";
      button.innerHTML = `<span class="tm-swatch" aria-hidden="true"></span><span class="tm-row__text"><span class="tm-row__name"></span><span class="tm-row__meta"></span></span><span class="tm-row__check" title="Active theme">${checkIconMarkup}</span>`;
      button.querySelector(".tm-swatch").style.background = themeSwatch(record.theme);
      button.querySelector(".tm-row__name").textContent = record.name;
      const metaBase = record.source === "built-in" ? "Built-in · read only" : "User theme";
      button.querySelector(".tm-row__meta").textContent = isActive ? `${metaBase} · Active` : metaBase;
      button.addEventListener("click", () => selectTheme(record.id)); item.appendChild(button); list.appendChild(item);
    }
  }
}

function updateDirtyState() {
  const dirty = isDirty(); const builtIn = isBuiltIn();
  $("tmDirty").hidden = !dirty;
  $("tmActiveBadge").hidden = !isSelectedActive();
  // Apply always lets the operator (re-)activate whatever is selected: a
  // built-in or unedited theme just becomes the live theme, while unsaved
  // edits are saved first. It only disables once there is truly nothing to
  // do (the selection is already active and has no pending edits).
  $("tmApply").disabled = applyContext.scope === "item" ? !selectedId : isSelectedActive() && !dirty;
  $("tmApply").textContent = applyContext.scope === "item" ? "Apply to Item" : "Apply";
  $("tmUseDefault").hidden = applyContext.scope !== "item";
  $("tmRevert").disabled = !dirty;
  $("tmDelete").disabled = builtIn;
  $("tmBuiltinNote").hidden = !builtIn;
  $("tmEditor").querySelectorAll("input,select").forEach(control => { control.disabled = builtIn && applyContext.scope !== "item"; });
  $("tmBuiltinNote").querySelector("span").textContent = builtIn && applyContext.scope === "item"
    ? "Local changes apply only to this scheduled item; the built-in theme remains unchanged."
    : "This is the built-in default and can't be edited. Use New Theme to create an editable copy.";
}

function fillEditor() {
  if (!draft) return; const target = ensureProfile($("tmKind").value, outputRole);
  $("tmTitle").textContent = draft.name; $("tmName").value = draft.name || "";
  const fontFamily = target.typography.fontFamily || draft.tokens?.fontFamily || "'Adwaita Sans'";
  const normalizedFontFamily = fontFamily.replace(/^['\"]|['\"]$/g, "");
  let matchingFontOption = [...$("tmFont").options].find(
    option => option.value.replace(/^['\"]|['\"]$/g, "") === normalizedFontFamily,
  );
  if (!matchingFontOption) {
    const option = document.createElement("option");
    option.value = fontFamily; option.textContent = normalizedFontFamily;
    $("tmFont").appendChild(option);
    matchingFontOption = option;
  }
  $("tmFont").value = matchingFontOption.value;
  $("tmFontSize").value = Number(target.typography.fontSize) || (outputRole === "lowerThird" ? 52 : 64);
  $("tmTextColor").value = color(target.typography.color || draft.tokens?.textColor, "#ffffff");
  $("tmAlign").value = ["left", "center", "right"].includes(target.typography.align) ? target.typography.align : "center";
  $("tmBackground").value = color(
    outputRole === "lowerThird"
      ? target.canvas.background.color || target.key?.chromaColor
      : target.canvas.background.color,
    outputRole === "lowerThird" ? "#00ff00" : "#000000",
  );
  const background = target.canvas.background || {};
  const backgroundAsset = draft.assets?.find(asset => asset.id === background.assetId);
  $("tmBackgroundAssetRow").hidden = outputRole !== "audience";
  $("tmBackgroundAssetLabel").textContent = background.type === "image"
    ? background.name || backgroundAsset?.name || fileName(background.path) || "Selected graphic"
    : "None";
  $("tmChooseBackground").disabled = isBuiltIn() && applyContext.scope !== "item";
  $("tmClearBackground").disabled = background.type !== "image";
  $("tmSafeMargin").value = Math.round(themeSafeMargin(target.canvas.safeMargins.left) * 100);
  $("tmBackdrop").checked = target.backdrop.enabled === true;
  $("tmBackdropColor").value = color(target.backdrop.background.color, "#101010");
  $("tmTransition").value = ["none", "fade", "slide-left", "slide-right", "zoom"].includes(target.transition.type) ? target.transition.type : "fade";
  $("tmDuration").value = Number.isFinite(Number(target.transition.durationMs)) ? Number(target.transition.durationMs) : 350;
  updateDirtyState(); renderPreview();
}

function readEditor() {
  if (!draft || (isBuiltIn() && applyContext.scope !== "item")) return;
  draft.name = $("tmName").value.trim() || "Unnamed Theme";
  // "Content sample" changes only the preview copy. The visual controls define
  // the coordinated role appearance, so commit them to every content kind.
  // Previously a Song sample silently edited only the Song profile, leaving a
  // live Scripture lower third on the old colors.
  for (const kind of ["song", "scripture", "text"]) {
    const target = ensureProfile(kind, outputRole);
    target.typography.fontFamily = $("tmFont").value.trim() || "Adwaita Sans";
    target.typography.fontSize = Math.max(8, Math.min(400, Number($("tmFontSize").value) || 64));
    target.typography.color = $("tmTextColor").value;
    target.typography.align = $("tmAlign").value;
    const existingBackground = target.canvas.background || {};
    target.canvas.background = outputRole === "audience" && existingBackground.type === "image"
      ? { ...existingBackground, color: $("tmBackground").value }
      : { type: "color", color: $("tmBackground").value, assetId: null };
    if (outputRole === "lowerThird") {
      target.key = {
        ...(target.key || {}),
        mode: "chroma",
        chromaColor: $("tmBackground").value,
      };
    }
    const margin = Math.max(0, Math.min(.25, (Number($("tmSafeMargin").value) || 0) / 100));
    target.canvas.safeMargins = { top: margin, right: margin, bottom: margin, left: margin };
    target.backdrop.enabled = $("tmBackdrop").checked;
    target.backdrop.background = {
      ...target.backdrop.background,
      type: "color",
      color: $("tmBackdropColor").value,
    };
    target.transition.type = $("tmTransition").value;
    target.transition.durationMs = Math.max(0, Math.min(5000, Number($("tmDuration").value) || 0));
  }
  draft.updatedAt = new Date().toISOString(); $("tmTitle").textContent = draft.name;
  updateDirtyState(); renderPreview(); renderList();
}

function renderPreview() {
  const target = profile(); if (!target) return;
  const preview = $("tmPreview"); const frame = $("tmPreviewFrame"); const plate = $("tmPreviewBackdrop"); const text = $("tmPreviewText");
  const background = target.canvas?.background || {};
  const backgroundAsset = draft.assets?.find(asset => asset.id === background.assetId);
  const backgroundUrl = background.assetUrl || backgroundAsset?.assetUrl || "";
  preview.style.backgroundColor = background.color || (outputRole === "lowerThird" ? "#00ff00" : "#000000");
  preview.style.backgroundImage = outputRole === "audience" && background.type === "image" && backgroundUrl
    ? `url(${JSON.stringify(backgroundUrl)})`
    : "none";
  preview.style.backgroundSize = background.fit || "cover";
  preview.style.backgroundPosition = background.position || "center";
  const margins = target.canvas?.safeMargins || {}; const left = themeSafeMargin(margins.left) * 100; const right = themeSafeMargin(margins.right) * 100;
  if (outputRole === "lowerThird") { frame.style.cssText = `left:${left}%;right:${right}%;bottom:8%;height:24%;justify-content:flex-start;text-align:${target.typography?.align || "left"}`; text.innerHTML = "Amazing grace, how sweet the sound"; $("tmPreviewReference").textContent = "Sample Song"; }
  else { frame.style.cssText = `left:${left}%;right:${right}%;top:${themeSafeMargin(margins.top)*100}%;bottom:${themeSafeMargin(margins.bottom)*100}%;text-align:${target.typography?.align || "center"}`; text.innerHTML = $("tmKind").value === "scripture" ? "The light shines in the darkness" : $("tmKind").value === "text" ? "Welcome to today’s service" : "Amazing grace<br>How sweet the sound"; $("tmPreviewReference").textContent = $("tmKind").value === "scripture" ? "John 1:5" : "Sample Song · Verse 1"; }
  plate.style.background = target.backdrop?.enabled ? target.backdrop?.background?.color || "#101010" : "transparent";
  plate.style.borderRadius = `${themeBackdropCornerRadius(target.backdrop?.cornerRadius)}px`;
  plate.style.color = target.typography?.color || "#ffffff"; plate.style.fontFamily = target.typography?.fontFamily || draft.tokens?.fontFamily || "sans-serif";
  plate.style.fontSize = `${Math.max(12, (Number(target.typography?.fontSize) || 64) * .34)}px`; plate.style.fontWeight = target.typography?.fontWeight || 700;
  plate.style.textAlign = target.typography?.align || "center";
}

async function chooseAudienceBackground() {
  if (!draft || outputRole !== "audience") return;
  const revision = ++applyRevision;
  const targetId = selectedId;
  const targetDraft = draft;
  const targetRole = outputRole;
  const targetContext = { ...applyContext };
  const result = await api.chooseBackgroundAsset(targetId, targetContext);
  if (result?.canceled || !result?.asset) return;
  if (targetContext.scope !== "item") {
    // Record managed assets even when the UI owner changed while the native
    // picker was open, so later save/close cleanup can remove the orphan.
    rememberPendingAsset(targetId, result.asset.id);
  }
  if (
    revision !== applyRevision ||
    selectedId !== targetId ||
    draft !== targetDraft ||
    outputRole !== targetRole
  ) return;
  if (targetContext.scope !== "item") {
    draft.assets ||= [];
    draft.assets = [...draft.assets.filter(asset => asset.id !== result.asset.id), result.asset];
  }
  for (const kind of ["song", "scripture", "text"]) {
    const target = ensureProfile(kind, "audience");
    target.canvas.background = {
      type: "image",
      color: $("tmBackground").value,
      assetId: targetContext.scope === "item" ? null : result.asset.id,
      path: result.asset.path,
      ...(result.asset.assetUrl ? { assetUrl: result.asset.assetUrl } : {}),
      name: result.asset.name,
      fit: "cover",
      position: "center",
    };
  }
  draft.updatedAt = new Date().toISOString();
  fillEditor();
}

function clearAudienceBackground() {
  if (!draft || outputRole !== "audience") return;
  for (const kind of ["song", "scripture", "text"]) {
    const target = ensureProfile(kind, "audience");
    target.canvas.background = {
      type: "color",
      color: $("tmBackground").value,
      assetId: null,
    };
  }
  draft.updatedAt = new Date().toISOString();
  fillEditor();
}

function selectTheme(id, { discardCurrent = false } = {}) {
  if (!discardCurrent && isDirty() && !window.confirm("Discard unsaved theme changes?")) return;
  const record = records.find(item => item.id === id); if (!record) return;
  applyRevision += 1;
  selectedId = id; original = copy(record.theme); draft = copy(record.theme); setStatus(); renderList(); fillEditor();
}

async function reload(preferredId = selectedId, options = {}) {
  const revision = ++reloadRevision;
  const result = await api.list();
  if (revision !== reloadRevision) return false;
  records = result.themes; activeThemeId = result.activeThemeId;
  const initialSelection = records.some(item => item.id === preferredId)
    ? preferredId
    : records.some(item => item.id === activeThemeId)
      ? activeThemeId
      : records[0]?.id;
  renderList();
  selectTheme(initialSelection, options);
  return true;
}

async function refreshRecordsPreservingEditor() {
  const revision = ++reloadRevision;
  const result = await api.list();
  if (revision !== reloadRevision) return false;
  records = result.themes;
  activeThemeId = result.activeThemeId;
  if (records.some(item => item.id === selectedId)) {
    renderList();
    updateDirtyState();
    return true;
  }
  const fallbackId = records.some(item => item.id === activeThemeId)
    ? activeThemeId
    : records[0]?.id;
  selectTheme(fallbackId, { discardCurrent: true });
  return true;
}

async function apply() {
  readEditor();
  const revision = ++applyRevision;
  const targetId = selectedId;
  const targetRole = outputRole;
  const targetKind = $("tmKind").value;
  const targetContext = { ...applyContext, contentKind: targetKind, outputRole: targetRole };
  const targetProfile = copy(ensureProfile(targetKind, targetRole));
  const targetDraft = copy(draft);
  const stillOwnsApply = () => revision === applyRevision && selectedId === targetId;
  const dirty = isDirty();
  if (applyContext.scope === "item") {
    try {
      await api.applyToItem(targetId, targetContext, targetProfile);
      if (!stillOwnsApply()) return;
      original = copy(targetDraft);
      draft = copy(targetDraft);
      setStatus(`Applied “${targetDraft.name}” to this scheduled item.`);
      updateDirtyState();
    } catch (error) {
      if (stillOwnsApply()) setStatus(error.message || "Could not apply theme to item.", true);
    }
    return;
  }
  if (!dirty && isSelectedActive()) return;
  try {
    let appliedName = targetDraft.name;
    if (dirty && !isBuiltIn()) {
      pruneDiscardedPendingAssets(targetDraft);
      const result = await api.save(targetDraft);
      if (!stillOwnsApply()) return;
      pendingAssetIdsByTheme.delete(result.theme.id);
      // Saving commits the draft. Mark it clean before reload() reselects the
      // theme, otherwise selectTheme() mistakes the just-saved changes for
      // unsaved work and opens the discard confirmation.
      original = copy(result.theme);
      draft = copy(result.theme);
      appliedName = result.theme.name;
    }
    // Activating is independent of saving: it is how a built-in or already
    // clean theme (e.g. switching back to the default after a custom style)
    // becomes the live theme again, which plain saving can never do.
    const activation = await api.activate(targetId);
    if (!stillOwnsApply()) return;
    if (activation.superseded) return;
    activeThemeId = activation.activeThemeId;
    await reload(targetId);
    setStatus(`Applied “${appliedName}”.`);
  }
  catch (error) {
    if (stillOwnsApply()) setStatus(error.message || "Could not apply theme.", true);
  }
}

async function duplicate() {
  if (!selectedId) return;
  const revision = ++applyRevision;
  const targetId = selectedId;
  try {
    const result = await api.duplicate(targetId);
    if (revision !== applyRevision || selectedId !== targetId) {
      await refreshRecordsPreservingEditor();
      return;
    }
    await reload(result.theme.id);
    setStatus("Theme created. You can now edit the copy.");
  }
  catch (error) {
    if (revision === applyRevision && selectedId === targetId) {
      setStatus(error.message || "Could not create theme.", true);
    }
  }
}

async function useProjectDefault() {
  const revision = ++applyRevision;
  const targetId = selectedId;
  const targetContext = { ...applyContext, contentKind: $("tmKind").value, outputRole };
  try {
    await api.clearItem(targetContext);
    if (revision === applyRevision && selectedId === targetId) {
      setStatus("This item now uses the project default theme.");
    }
  } catch (error) {
    if (revision === applyRevision && selectedId === targetId) {
      setStatus(error.message || "Could not reset item theme.", true);
    }
  }
}

function closeMenu() {
  $("tmMenu").hidden = true;
  $("tmMenuButton").setAttribute("aria-expanded", "false");
}

function toggleMenu() {
  const opening = $("tmMenu").hidden;
  $("tmMenu").hidden = !opening;
  $("tmMenuButton").setAttribute("aria-expanded", opening ? "true" : "false");
}

function requestClose() {
  if (isDirty() && !window.confirm("Close without applying your changes?")) return;
  api.close();
}

function wire() {
  $("tmClose").addEventListener("click", requestClose); $("tmSearch").addEventListener("input", renderList);
  $("tmAudienceTab").addEventListener("click", () => { applyRevision += 1; outputRole = "audience"; $("tmAudienceTab").setAttribute("aria-pressed", "true"); $("tmLowerThirdTab").setAttribute("aria-pressed", "false"); fillEditor(); });
  $("tmLowerThirdTab").addEventListener("click", () => { applyRevision += 1; outputRole = "lowerThird"; $("tmAudienceTab").setAttribute("aria-pressed", "false"); $("tmLowerThirdTab").setAttribute("aria-pressed", "true"); fillEditor(); });
  $("tmKind").addEventListener("change", () => { applyRevision += 1; fillEditor(); });
  $("tmEditor").addEventListener("input", () => { applyRevision += 1; readEditor(); });
  $("tmEditor").addEventListener("change", () => { applyRevision += 1; readEditor(); });
  $("tmApply").addEventListener("click", () => void apply()); $("tmRevert").addEventListener("click", () => { draft = copy(original); fillEditor(); renderList(); setStatus("Changes reverted."); });
  $("tmUseDefault").addEventListener("click", () => void useProjectDefault());
  $("tmDuplicate").addEventListener("click", () => void duplicate());
  $("tmChooseBackground").addEventListener("click", () => {
    void chooseAudienceBackground().catch(error => {
      setStatus(error.message || "Could not add the background graphic.", true);
    });
  });
  $("tmClearBackground").addEventListener("click", clearAudienceBackground);
  $("tmMenuButton").addEventListener("click", event => { event.stopPropagation(); toggleMenu(); });
  $("tmMenu").addEventListener("click", event => { if (event.target.closest("button")) closeMenu(); });
  document.addEventListener("click", event => { if (!event.target.closest(".tm-menu-wrap")) closeMenu(); });
  $("tmDelete").addEventListener("click", async () => {
    const revision = ++applyRevision;
    const targetId = selectedId;
    try {
      const result = await api.delete(targetId);
      if (!result.deleted) return;
      activeThemeId = result.activeThemeId || activeThemeId;
      if (revision !== applyRevision || selectedId !== targetId) {
        await refreshRecordsPreservingEditor();
        return;
      }
      // The deleted draft no longer has a valid persistence target. Move to a
      // surviving theme without asking whether to retain an impossible edit.
      await reload(undefined, { discardCurrent: true });
    } catch (error) {
      if (revision === applyRevision && selectedId === targetId) {
        setStatus(error.message || "Could not delete theme.", true);
      }
    }
  });
  $("tmImport").addEventListener("click", async () => {
    const revision = ++applyRevision;
    const targetId = selectedId;
    try {
      const result = await api.importPack();
      if (result.canceled) return;
      if (revision !== applyRevision || selectedId !== targetId) {
        await refreshRecordsPreservingEditor();
        return;
      }
      await reload(result.theme.id);
      setStatus("Theme imported.");
    } catch (error) {
      if (revision === applyRevision && selectedId === targetId) {
        setStatus(error.message || "Could not import theme.", true);
      }
    }
  });
  $("tmExport").addEventListener("click", async () => {
    const revision = ++applyRevision;
    const targetId = selectedId;
    try {
      const result = await api.exportPack(targetId);
      if (!result.canceled && revision === applyRevision && selectedId === targetId) {
        setStatus("Theme pack exported.");
      }
    } catch (error) {
      if (revision === applyRevision && selectedId === targetId) {
        setStatus(error.message || "Could not export theme.", true);
      }
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") { if (!$("tmMenu").hidden) { closeMenu(); return; } requestClose(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void apply(); }
  });
}

wire();
applyOpenContext({
  contentKind: initialParams.get("contentKind"),
  outputRole,
  scope: applyContext.scope,
  queueIndex: applyContext.queueIndex,
});
window.themeManager.onOpenContext?.(applyOpenContext);
reload().catch(error => setStatus(error.message || "Could not load themes.", true));
