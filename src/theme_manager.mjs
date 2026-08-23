const api = window.themeManager;
let records = [];
let activeThemeId = null;
let selectedId = null;
let original = null;
let draft = null;
const initialParams = new URLSearchParams(window.location.search);
let outputRole = initialParams.get("outputRole") === "lowerThird" ? "lowerThird" : "audience";

const $ = id => document.getElementById(id);
const copy = value => structuredClone(value);
const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback;
const profile = () => draft?.profiles?.[$("tmKind").value]?.[outputRole];
const isBuiltIn = () => records.find(item => item.id === selectedId)?.source === "built-in";
const isDirty = () => original && draft && JSON.stringify(original) !== JSON.stringify(draft);
const isSelectedActive = () => Boolean(selectedId) && selectedId === activeThemeId;

function applyOpenContext(context = {}) {
  const contentKind = ["song", "scripture", "text"].includes(context?.contentKind)
    ? context.contentKind
    : "song";
  outputRole = context?.outputRole === "lowerThird" ? "lowerThird" : "audience";
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
  $("tmApply").disabled = isSelectedActive() && !dirty;
  $("tmRevert").disabled = !dirty;
  $("tmDelete").disabled = builtIn;
  $("tmBuiltinNote").hidden = !builtIn;
  $("tmEditor").querySelectorAll("input,select").forEach(control => { control.disabled = builtIn; });
}

function fillEditor() {
  if (!draft) return; const target = ensureProfile($("tmKind").value, outputRole);
  $("tmTitle").textContent = draft.name; $("tmName").value = draft.name || "";
  $("tmFont").value = target.typography.fontFamily || draft.tokens?.fontFamily || "Adwaita Sans";
  $("tmFontSize").value = Number(target.typography.fontSize) || (outputRole === "lowerThird" ? 52 : 64);
  $("tmTextColor").value = color(target.typography.color || draft.tokens?.textColor, "#ffffff");
  $("tmAlign").value = ["left", "center", "right"].includes(target.typography.align) ? target.typography.align : "center";
  $("tmBackground").value = color(
    outputRole === "lowerThird"
      ? target.canvas.background.color || target.key?.chromaColor
      : target.canvas.background.color,
    outputRole === "lowerThird" ? "#00ff00" : "#000000",
  );
  $("tmSafeMargin").value = Math.round((Number(target.canvas.safeMargins.left) || .06) * 100);
  $("tmBackdrop").checked = target.backdrop.enabled === true;
  $("tmBackdropColor").value = color(target.backdrop.background.color, "#101010");
  $("tmTransition").value = ["none", "fade", "slide-left", "slide-right", "zoom"].includes(target.transition.type) ? target.transition.type : "fade";
  $("tmDuration").value = Number.isFinite(Number(target.transition.durationMs)) ? Number(target.transition.durationMs) : 350;
  updateDirtyState(); renderPreview();
}

function readEditor() {
  if (!draft || isBuiltIn()) return;
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
    target.canvas.background = {
      ...target.canvas.background,
      type: "color",
      color: $("tmBackground").value,
    };
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
  preview.style.background = target.canvas?.background?.color || (outputRole === "lowerThird" ? "#00ff00" : "#000000");
  const margins = target.canvas?.safeMargins || {}; const left = (Number(margins.left) || .06) * 100; const right = (Number(margins.right) || .06) * 100;
  if (outputRole === "lowerThird") { frame.style.cssText = `left:${left}%;right:${right}%;bottom:8%;height:24%;justify-content:flex-start;text-align:${target.typography?.align || "left"}`; text.innerHTML = "Amazing grace, how sweet the sound"; $("tmPreviewReference").textContent = "Sample Song"; }
  else { frame.style.cssText = `left:${left}%;right:${right}%;top:${(Number(margins.top)||.06)*100}%;bottom:${(Number(margins.bottom)||.06)*100}%;text-align:${target.typography?.align || "center"}`; text.innerHTML = $("tmKind").value === "scripture" ? "The light shines in the darkness" : $("tmKind").value === "text" ? "Welcome to today’s service" : "Amazing grace<br>How sweet the sound"; $("tmPreviewReference").textContent = $("tmKind").value === "scripture" ? "John 1:5" : "Sample Song · Verse 1"; }
  plate.style.background = target.backdrop?.enabled ? target.backdrop?.background?.color || "#101010" : "transparent";
  plate.style.borderRadius = `${Number(target.backdrop?.cornerRadius) || 8}px`;
  plate.style.color = target.typography?.color || "#ffffff"; plate.style.fontFamily = target.typography?.fontFamily || draft.tokens?.fontFamily || "sans-serif";
  plate.style.fontSize = `${Math.max(12, (Number(target.typography?.fontSize) || 64) * .34)}px`; plate.style.fontWeight = target.typography?.fontWeight || 700;
  plate.style.textAlign = target.typography?.align || "center";
}

function selectTheme(id) {
  if (isDirty() && !window.confirm("Discard unsaved theme changes?")) return;
  const record = records.find(item => item.id === id); if (!record) return;
  selectedId = id; original = copy(record.theme); draft = copy(record.theme); setStatus(); renderList(); fillEditor();
}

async function reload(preferredId = selectedId) {
  const result = await api.list();
  records = result.themes; activeThemeId = result.activeThemeId;
  renderList(); selectTheme(records.some(item => item.id === preferredId) ? preferredId : records[0]?.id);
}

async function apply() {
  readEditor();
  const dirty = isDirty();
  if (!dirty && isSelectedActive()) return;
  try {
    let appliedName = draft.name;
    if (dirty && !isBuiltIn()) {
      const result = await api.save(draft);
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
    const activation = await api.activate(selectedId);
    activeThemeId = activation.activeThemeId;
    await reload(selectedId);
    setStatus(`Applied “${appliedName}”.`);
  }
  catch (error) { setStatus(error.message || "Could not apply theme.", true); }
}

async function duplicate() {
  if (!selectedId) return;
  try { const result = await api.duplicate(selectedId); await reload(result.theme.id); setStatus("Theme created. You can now edit the copy."); }
  catch (error) { setStatus(error.message || "Could not create theme.", true); }
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
  $("tmAudienceTab").addEventListener("click", () => { outputRole = "audience"; $("tmAudienceTab").setAttribute("aria-pressed", "true"); $("tmLowerThirdTab").setAttribute("aria-pressed", "false"); fillEditor(); });
  $("tmLowerThirdTab").addEventListener("click", () => { outputRole = "lowerThird"; $("tmAudienceTab").setAttribute("aria-pressed", "false"); $("tmLowerThirdTab").setAttribute("aria-pressed", "true"); fillEditor(); });
  $("tmKind").addEventListener("change", fillEditor); $("tmEditor").addEventListener("input", readEditor); $("tmEditor").addEventListener("change", readEditor);
  $("tmApply").addEventListener("click", () => void apply()); $("tmRevert").addEventListener("click", () => { draft = copy(original); fillEditor(); renderList(); setStatus("Changes reverted."); });
  $("tmDuplicate").addEventListener("click", () => void duplicate());
  $("tmMenuButton").addEventListener("click", event => { event.stopPropagation(); toggleMenu(); });
  $("tmMenu").addEventListener("click", event => { if (event.target.closest("button")) closeMenu(); });
  document.addEventListener("click", event => { if (!event.target.closest(".tm-menu-wrap")) closeMenu(); });
  $("tmDelete").addEventListener("click", async () => {
    const result = await api.delete(selectedId);
    if (result.deleted) { activeThemeId = result.activeThemeId || activeThemeId; await reload(); }
  });
  $("tmImport").addEventListener("click", async () => { try { const result = await api.importPack(); if (!result.canceled) { await reload(result.theme.id); setStatus("Theme imported."); } } catch (error) { setStatus(error.message || "Could not import theme.", true); } });
  $("tmExport").addEventListener("click", async () => { try { const result = await api.exportPack(selectedId); if (!result.canceled) setStatus("Theme pack exported."); } catch (error) { setStatus(error.message || "Could not export theme.", true); } });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") { if (!$("tmMenu").hidden) { closeMenu(); return; } requestClose(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void apply(); }
  });
}

wire();
applyOpenContext({
  contentKind: initialParams.get("contentKind"),
  outputRole,
});
window.themeManager.onOpenContext?.(applyOpenContext);
reload().catch(error => setStatus(error.message || "Could not load themes.", true));
