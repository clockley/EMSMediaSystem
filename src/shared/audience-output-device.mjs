const AUDIENCE_DISPLAY_SELECT_IDS = Object.freeze(["dspSelct", "dspSelctStreams"]);

let pendingAudienceOutputRequest = null;

function stringValue(value) {
  return value === undefined || value === null ? "" : String(value);
}

export function normalizeAudienceDisplays(displays = []) {
  const normalized = [];
  const seen = new Set();
  for (const display of Array.isArray(displays) ? displays : []) {
    const value = stringValue(display?.value).trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push({
      value,
      label: stringValue(display?.label).trim() || `Display ${normalized.length + 1}`,
      isSecondary: display?.isSecondary === true,
      bounds: display?.bounds && typeof display.bounds === "object"
        ? {
            width: Number(display.bounds.width) || 0,
            height: Number(display.bounds.height) || 0,
          }
        : null,
    });
  }
  return normalized;
}

function audienceDisplaySelects(doc) {
  return AUDIENCE_DISPLAY_SELECT_IDS
    .map((id) => doc?.getElementById?.(id))
    .filter(Boolean);
}

export function selectedAudienceDisplay(doc = globalThis.document) {
  for (const select of audienceDisplaySelects(doc)) {
    const value = stringValue(select.value);
    if (value) return value;
  }
  return "";
}

export function audienceDisplaysFromDocument(doc = globalThis.document) {
  const displays = [];
  const seen = new Set();
  for (const select of audienceDisplaySelects(doc)) {
    for (const option of Array.from(select.options || [])) {
      const value = stringValue(option.value).trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      displays.push({
        value,
        label: stringValue(option.textContent).trim() || `Display ${displays.length + 1}`,
        isSecondary: false,
        bounds: {
          width: Number(option.dataset?.displayWidth) || 0,
          height: Number(option.dataset?.displayHeight) || 0,
        },
      });
    }
  }
  return displays;
}

export function refreshAudienceDisplaySelects(
  displays,
  doc = globalThis.document,
) {
  const normalized = normalizeAudienceDisplays(displays);

  for (const select of audienceDisplaySelects(doc)) {
    const previousValue = stringValue(select.value);
    const emptyLabel = select.id === "dspSelct" ? "No Audience Output" : "No Output";
    select.options.length = 0;

    const emptyOption = doc.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = emptyLabel;
    select.appendChild(emptyOption);

    for (const display of normalized) {
      const option = doc.createElement("option");
      option.value = display.value;
      option.textContent = display.label;
      if (display.bounds?.width > 0) {
        option.dataset.displayWidth = String(display.bounds.width);
      }
      if (display.bounds?.height > 0) {
        option.dataset.displayHeight = String(display.bounds.height);
      }
      select.appendChild(option);
    }

    select.value = normalized.some((display) => display.value === previousValue)
      ? previousValue
      : "";
  }
}

export function applyAudienceDisplaySelection(
  value,
  doc = globalThis.document,
) {
  const selectedValue = stringValue(value).trim();
  if (!selectedValue) return "";

  const selects = audienceDisplaySelects(doc);
  for (const select of selects) select.value = selectedValue;

  const eventTarget = selects.find((select) => select.value === selectedValue);
  if (!eventTarget) return "";
  if (eventTarget.dispatchEvent) {
    const EventConstructor = doc?.defaultView?.Event || globalThis.Event;
    if (typeof EventConstructor === "function") {
      eventTarget.dispatchEvent(new EventConstructor("change", { bubbles: true }));
    }
  }
  return selectedValue;
}

function preferredDisplayValue(displays) {
  return displays.find((display) => display.isSecondary)?.value || displays[0]?.value || "";
}

function showAudienceOutputDialog({ displays, doc = globalThis.document, loadFailed = false }) {
  const dialog = doc?.getElementById?.("audienceOutputDialog");
  const select = doc?.getElementById?.("audienceOutputDialogSelect");
  const status = doc?.getElementById?.("audienceOutputDialogStatus");
  const cancelButton = doc?.getElementById?.("audienceOutputDialogCancel");
  const confirmButton = doc?.getElementById?.("audienceOutputDialogConfirm");
  if (!dialog || !select || !cancelButton || !confirmButton) return Promise.resolve("");

  select.options.length = 0;
  for (const display of displays) {
    const option = doc.createElement("option");
    option.value = display.value;
    option.textContent = display.label;
    select.appendChild(option);
  }

  const hasDisplays = displays.length > 0;
  select.disabled = !hasDisplays;
  select.value = preferredDisplayValue(displays);
  confirmButton.disabled = !hasDisplays;
  if (status) {
    status.hidden = hasDisplays && !loadFailed;
    status.textContent = loadFailed
      ? "Connected displays could not be loaded. Check the display connection and try again."
      : "No connected displays were found. Connect a display and try again.";
  }

  return new Promise((resolve) => {
    const closeDialog = (returnValue) => {
      if (dialog.open) dialog.close(returnValue);
    };
    const finish = () => {
      resolve(dialog.returnValue === "select" ? stringValue(select.value) : "");
    };
    dialog.addEventListener("close", finish, { once: true });
    cancelButton.onclick = () => closeDialog("cancel");
    confirmButton.onclick = () => {
      if (select.value) closeDialog("select");
    };
    select.onkeydown = (event) => {
      if (event.key === "Enter" && select.value) {
        event.preventDefault();
        closeDialog("select");
      }
    };
    dialog.returnValue = "";
    try {
      dialog.showModal();
    } catch (error) {
      dialog.removeEventListener("close", finish);
      console.error("Failed to open audience output dialog:", error);
      resolve("");
      return;
    }
    if (hasDisplays) select.focus();
    else cancelButton.focus();
  });
}

async function resolveAudienceOutputRequest({
  invoke,
  doc,
  chooseDisplay,
}) {
  const loadConnectedDisplays = async () => {
    try {
      const result = await invoke("get-all-displays");
      return {
        displays: normalizeAudienceDisplays(result?.displays),
        loadFailed: false,
      };
    } catch (error) {
      console.error("Failed to load audience output displays:", error);
      return { displays: [], loadFailed: true };
    }
  };

  let discovery = await loadConnectedDisplays();
  refreshAudienceDisplaySelects(discovery.displays, doc);

  for (;;) {
    const selectedValue = stringValue(
      await chooseDisplay({ ...discovery, doc }),
    ).trim();
    if (!selectedValue) return "";

    // Confirm against a fresh Electron display snapshot. The chooser can be
    // open while a projector is unplugged or its display id changes.
    const latestDiscovery = await loadConnectedDisplays();
    refreshAudienceDisplaySelects(latestDiscovery.displays, doc);
    if (
      !latestDiscovery.loadFailed &&
      latestDiscovery.displays.some((display) => display.value === selectedValue)
    ) {
      return applyAudienceDisplaySelection(selectedValue, doc);
    }

    // Reopen with the current list (or a discovery error) instead of allowing
    // a stale option to start a presentation on no display.
    discovery = latestDiscovery;
  }
}

/**
 * Ask for an audience display and resolve with its display value. Concurrent
 * presentation attempts share one dialog so a double-click cannot open two.
 */
export function requestAudienceOutputDevice({
  invoke,
  doc = globalThis.document,
  chooseDisplay = showAudienceOutputDialog,
} = {}) {
  const existing = selectedAudienceDisplay(doc);
  if (existing) {
    return Promise.resolve(applyAudienceDisplaySelection(existing, doc));
  }
  if (typeof invoke !== "function") return Promise.resolve("");
  if (pendingAudienceOutputRequest) {
    // The request that opened the dialog owns the presentation intent. Later
    // callers wait for it to finish but must not also continue playback.
    return pendingAudienceOutputRequest.then(
      () => "",
      () => "",
    );
  }

  pendingAudienceOutputRequest = resolveAudienceOutputRequest({
    invoke,
    doc,
    chooseDisplay,
  }).finally(() => {
    pendingAudienceOutputRequest = null;
  });
  return pendingAudienceOutputRequest;
}
