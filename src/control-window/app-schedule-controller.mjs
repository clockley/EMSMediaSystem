/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

/*
 * Schedule queue rendering, selection, drag/drop, and insertion/removal.
 */

import {
  reorderScheduleItemsAtInsertion,
  scheduleDropPlacementForTarget,
  scheduleInsertionIndexAfterItem,
  scheduleSectionBlockDropPlacement,
  scheduleSectionEndIndex,
  scheduleSectionIndexForInsertion,
  scheduleSectionIndexForItem,
} from "../shared/schedule-item-availability.mjs";

import {
  BIBLE_VERSE_DRAG_MIME,
  MEDIAPLAYER,
  activeMediaWindowContentType,
  approvePendingMediaUpdate,
  bibleQueueItemDisplayName,
  bibleUiEnabled,
  bibleVerseDragPayload,
  bibleVerseDragPayloadFromDataTransfer,
  buildSongQueueEntryFromDeck,
  captureQueueClearUndoState,
  clearBibleVerseDragVisualState,
  clearSongDragVisualState,
  clearVideoPreviewCueOverlay,
  createQueueEntry,
  currentMode,
  currentQueueIndex,
  currentWorkspaceSong,
  currentWorkspaceSongDeck,
  dataTransferHasType,
  escapeHtml,
  finalizeQueueClearDestructive,
  firstDroppedProjectPath,
  formatCueTime,
  generateProjectGuid,
  getPathForFile,
  hidePptxPreviewIfNeeded,
  hideQueueDropIndicator,
  hideScheduleBibleContextMenu,
  insertQueueEntriesAfterSelection,
  invalidateQueueUndoToastAfterMutation,
  invoke,
  isActiveMediaWindow,
  isLocalAppWindowPresentationActive,
  isPlaying,
  isPreparingSeparateCue,
  isQueueItemAudio,
  isQueueItemBible,
  isQueueItemSection,
  isQueueItemSong,
  isQueuePlaying,
  isQueuePresentationActive,
  isScheduleItemCurrentlyPlayable,
  isScheduleItemCurrentlyVisible,
  isVideoPreviewCueActive,
  keepPendingMediaUpdate,
  liveAudio,
  liveAudioQueueIndex,
  loadQueueItemIntoControlWindow,
  loadQueueItemIntoPreviewCue,
  manualBoundaryPauseIndex,
  mediaLibraryDragIsActive,
  mediaLibraryItemIdFromDataTransfer,
  mediaQueue,
  nextPlayableQueueIndexAfter,
  onQueueItemActivate,
  openProjectByPath,
  openSongEditor,
  pauseLocalPreviewAfterQueueClear,
  pendingQueueClearPostClose,
  pendingQueueSwitchIndex,
  pendingQueueSwitchStartTime,
  playCurrentQueueItem,
  playingMediaAudioOnly,
  previewAudioCueIndex,
  previewCueIndex,
  previewCueVideoIndex,
  queueDropIndicatorIndex,
  queueEntriesForBibleVerseDragPayload,
  queueIndexInRange,
  queueIndexIsLiveForDisplay,
  queueInsertionSelectionExplicit,
  queueItemCanKeepOldMediaVersion,
  queueItemCueStartTime,
  queueItemStageLabel,
  queueSelectionRangeAnchorIndex,
  queueTypeIconMarkup,
  refreshLiveAudioControls,
  releaseOutputHoldsAndGoLiveQueueIndex,
  renderStateForLibrarySong,
  recordScheduledMediaPaths,
  resetPreviewSurfaceToEmptyState,
  resolveMediaLibraryDragItem,
  restoreCountdownForLiveMedia,
  saveMediaFile,
  schedulePptxThumbnailRefresh,
  selectedQueueAnchorIndex,
  send,
  setSBFormMediaPlayer,
  setSelectedQueueAnchor,
  setSharedRendererState,
  shiftQueueIndexesForInsertion,
  showGnomeToast,
  showMediaWorkspace,
  showQueueClearedUndoToast,
  showRendererPrompt,
  showScheduleBibleContextMenu,
  slideTransitionBadgeMarkup,
  songDragSongId,
  songsAPI,
  stampBaselineForQueueItems,
  startTime,
  stopPreviewAudioCue,
  syncMediaLoopState,
  syncPlayPauseIconToControlMedia,
  syncPreviewAudioTrackState,
  updateDynUI,
  updatePreviewCueUI,
  updatePreviewEmptyState,
} from "./app-renderer.mjs";

function nextPlayableQueueItemStageText(fromIndex = currentQueueIndex) {
  const index = nextPlayableQueueIndexAfter(fromIndex);
  return index >= 0 ? queueItemStageLabel(mediaQueue[index]) : "";
}

const selectedQueueItems = new Set();

/** After reorder drop, ignore the synthetic click on the row. */
let ignoreNextQueueItemClick = false;

let ignoreQueueItemClicksUntil = 0;

let queueItemClickTimer = null;

let queueDragFromIndex = -1;

const recentlyAddedQueueItems = new Set();

let recentlyAddedQueueItemsTimer = null;

let queueDropIndicator = null;

const DEFAULT_SCHEDULE_SECTION_NAME = "New Section";

function normalizeScheduleSectionName(value) {
  const name = String(value || "").trim();
  return name || DEFAULT_SCHEDULE_SECTION_NAME;
}

function createScheduleSectionEntry(name = DEFAULT_SCHEDULE_SECTION_NAME) {
  return {
    id: `section-${generateProjectGuid()}`,
    type: "section",
    name: normalizeScheduleSectionName(name),
    collapsed: false,
  };
}

function sectionItemCount(sectionIndex) {
  if (!queueIndexInRange(sectionIndex) || !isQueueItemSection(mediaQueue[sectionIndex])) {
    return 0;
  }
  let count = 0;
  for (let index = sectionIndex + 1; index < mediaQueue.length; index += 1) {
    const item = mediaQueue[index];
    if (isQueueItemSection(item)) break;
    if (isScheduleItemCurrentlyVisible(item)) count += 1;
  }
  return count;
}

function sectionChildShouldShowWhenCollapsed(index, item, selectedQueueIndex, separatePreviewCue) {
  return (
    queueIndexIsLiveForDisplay(index) ||
    (separatePreviewCue && index === previewCueIndex) ||
    (selectedQueueItems.size > 0
      ? selectedQueueItems.has(item)
      : index === selectedQueueIndex)
  );
}

function renderQueue() {
  const listContainer = document.getElementById("mediaQueueList");
  if (!listContainer) return;

  for (const item of selectedQueueItems) {
    if (!mediaQueue.includes(item)) selectedQueueItems.delete(item);
  }
  if (!queueIndexInRange(selectedQueueAnchorIndex)) {
    selectedQueueItems.clear();
    setSharedRendererState({ queueSelectionRangeAnchorIndex: -1 });
  } else if (selectedQueueItems.size === 0) {
    selectedQueueItems.add(mediaQueue[selectedQueueAnchorIndex]);
  }

  const bibleHint = bibleUiEnabled ? ", or Bible text" : "";
  const separatePreviewCue = isPreparingSeparateCue();
  const selectedQueueIndex = selectedQueueIndexForDisplay();
  const visibleQueueItems = [];
  let currentSectionIndex = -1;
  let collapsedSectionIndex = -1;

  mediaQueue.forEach((item, index) => {
    if (!isScheduleItemCurrentlyVisible(item)) return;
    if (isQueueItemSection(item)) {
      visibleQueueItems.push({
        item,
        index,
        inSection: false,
        collapsedPreview: false,
      });
      currentSectionIndex = index;
      collapsedSectionIndex = item.collapsed === true ? index : -1;
      return;
    }
    const collapsedPreview =
      collapsedSectionIndex >= 0 &&
      sectionChildShouldShowWhenCollapsed(index, item, selectedQueueIndex, separatePreviewCue);
    if (collapsedSectionIndex >= 0 && !collapsedPreview) return;
    visibleQueueItems.push({
      item,
      index,
      inSection: currentSectionIndex >= 0,
      collapsedPreview,
    });
  });

  if (visibleQueueItems.length === 0) {
    listContainer.innerHTML =
      '<div class="list-placeholder">' +
      '<span class="list-placeholder-title">No items scheduled</span>' +
      `<span class="list-placeholder-hint">Add media, network items${bibleHint}</span>` +
      "</div>";
  } else {
    // Queue order is the primary source of truth. Badges show live/cued
    // state, plus an optional start-offset label for non-zero cue starts.
    listContainer.innerHTML = visibleQueueItems
      .map(({ item, index, inSection, collapsedPreview }, visibleIndex) => {
        const cueStartTime = queueItemCueStartTime(item);
        const hasCueStart = cueStartTime > 0;

        const isLive = queueIndexIsLiveForDisplay(index);
        const isCued = separatePreviewCue && index === previewCueIndex;
        const isSelected =
          selectedQueueItems.size > 0
            ? selectedQueueItems.has(item)
            : index === selectedQueueIndex;
        if (isQueueItemSection(item)) {
          const collapsed = item.collapsed === true;
          const childCount = sectionItemCount(index);
          const sectionName = item.name || DEFAULT_SCHEDULE_SECTION_NAME;
          const childLabel = childCount === 0
            ? "Empty section"
            : `${childCount} item${childCount === 1 ? "" : "s"}`;
          const classes = [
            "queue-item",
            "queue-item--section",
            isSelected ? "is-selected" : "",
            collapsed ? "is-collapsed" : "",
            recentlyAddedQueueItems.has(item) ? "is-newly-added" : "",
          ].filter(Boolean).join(" ");
          return `<div class="${classes}" role="listitem" tabindex="0" data-queue-index="${index}" draggable="true" ${isSelected ? 'data-selected="true"' : ""}>
      <button type="button" class="section-toggle-btn" draggable="false" data-queue-section-toggle="${index}" aria-label="${collapsed ? "Expand section" : "Collapse section"}" aria-expanded="${collapsed ? "false" : "true"}" ${childCount === 0 ? "disabled" : ""}>
        <svg class="section-toggle-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m4.75 6.25 3.25 3.5 3.25-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <span class="section-folder-icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16"><path d="M1.75 4.25c0-.83.67-1.5 1.5-1.5h3.1l1.4 1.5h5c.83 0 1.5.67 1.5 1.5v6.5c0 .55-.45 1-1 1h-10.5c-.55 0-1-.45-1-1v-8Z" fill="currentColor" opacity=".24"/><path d="M1.75 5.25h12.5v7c0 .55-.45 1-1 1h-10.5c-.55 0-1-.45-1-1v-7Z" fill="currentColor"/></svg>
      </span>
      <span class="item-text section-text">
        <span class="item-label" title="${escapeHtml(sectionName)}">${escapeHtml(sectionName)}</span>
        <span class="section-count">${childLabel}</span>
      </span>
      <button type="button" class="section-menu-btn" draggable="false" data-queue-section-menu="${index}" title="Section options" aria-label="Options for ${escapeHtml(sectionName)}" aria-haspopup="menu">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.25" fill="currentColor"/><circle cx="8" cy="8" r="1.25" fill="currentColor"/><circle cx="13" cy="8" r="1.25" fill="currentColor"/></svg>
      </button>
    </div>`;
        }
        const autoAdvanceEnabled = item.autoAdvance !== false;
        const isLastSectionChild =
          inSection &&
          (visibleIndex === visibleQueueItems.length - 1 ||
            isQueueItemSection(visibleQueueItems[visibleIndex + 1]?.item));

        const classes = [
          "queue-item",
          inSection ? "queue-item--section-child" : "",
          isLastSectionChild ? "queue-item--section-child-last" : "",
          collapsedPreview ? "queue-item--collapsed-preview" : "",
          isSelected ? "is-selected" : "",
          recentlyAddedQueueItems.has(item) ? "is-newly-added" : "",
          isLive ? "is-live" : "",
          isCued ? "is-cued" : "",
          item.pendingMediaUpdate?.status === "ready" ? "queue-item--pending-update" : "",
        ].filter(Boolean).join(" ");
        const cueStartMarkup = hasCueStart
          ? `<span class="item-cue-start">Start @ ${formatCueTime(cueStartTime)}</span>`
          : "";
        const badges = [];
        if (isLive) {
          badges.push('<span class="state-badge state-badge--live">Live</span>');
        }
        if (isCued) {
          badges.push('<span class="state-badge state-badge--cued">Cued</span>');
        }
        if (item.itemTheme) {
          badges.push('<span class="state-badge" title="This item overrides the project theme">Theme override</span>');
        }
        const transitionBadge = slideTransitionBadgeMarkup(item);
        if (transitionBadge) {
          badges.push(transitionBadge);
        }
        if (item.missing && !isQueueItemSong(item)) {
          badges.push(
            '<span class="state-badge state-badge--missing" title="File could not be found">Missing</span>',
          );
        } else if (item.pendingMediaUpdate?.status === "stabilizing" && !isQueueItemSong(item)) {
          badges.push(
            '<span class="state-badge state-badge--changed" title="Source file is still being saved">Updating</span>',
          );
        } else if (item.pendingMediaUpdate?.status === "error" && !isQueueItemSong(item)) {
          badges.push(
            '<span class="state-badge state-badge--missing" title="EMS could not inspect the changed source file">Update Error</span>',
          );
        } else if (item.pendingMediaUpdate?.status === "ready" && !isQueueItemSong(item)) {
          badges.push(
            '<span class="state-badge state-badge--changed" title="Source file changed outside EMS">Updated</span>',
          );
        } else if (item.changedSinceSave && !isQueueItemSong(item)) {
          badges.push(
            '<span class="state-badge state-badge--changed" title="Source file changed since this project was last saved">Changed</span>',
          );
        }
        const statusMarkup =
          badges.length || hasCueStart
            ? `<span class="item-status-row">${badges.join("")}${cueStartMarkup}</span>`
            : "";
        const canKeepOldUpdate =
          item.pendingMediaUpdate?.status === "ready" &&
          queueItemCanKeepOldMediaVersion(item);
        const updateActionMarkup =
          item.pendingMediaUpdate?.status === "ready"
            ? `<span class="item-update-actions">${canKeepOldUpdate ? `<button type="button" class="row-media-update-btn" data-queue-keep-update="${index}" title="Keep using the staged old version and clear this update notice" aria-label="Keep old media file">Keep</button>` : ""}<button type="button" class="row-media-update-btn" data-queue-reload-update="${index}" title="Reload this schedule item from the changed source file" aria-label="Reload media file">Reload</button></span>`
            : "";
        const secondaryMarkup =
          statusMarkup || updateActionMarkup
            ? `<span class="item-secondary-row">${statusMarkup}${updateActionMarkup}</span>`
            : "";
        const autoStartBadgeMarkup = autoAdvanceEnabled
          ? '<span class="queue-auto-start-badge" title="Starts when the previous item finishes">Auto</span>'
          : "";
        return `<div class="${classes}" role="listitem" data-queue-index="${index}" draggable="true" ${isSelected ? 'data-selected="true"' : ""} ${isLive ? 'data-live="true"' : ""} ${isCued ? 'data-cued="true"' : ""}>
      <span class="item-icon">${queueTypeIconMarkup(item)}</span>
      <span class="item-text">
        <span class="item-label" title="${escapeHtml(item.name)}">${escapeHtml(isQueueItemBible(item) ? bibleQueueItemDisplayName(item) : item.name)}</span>
        ${secondaryMarkup}
      </span>
      <span class="queue-item-trailing-actions">
      ${autoStartBadgeMarkup}
      <button type="button" class="remove-btn" draggable="false" data-queue-remove="${index}" title="Remove from schedule" aria-label="Remove from schedule">✕</button>
      </span>
    </div>`;
      })
      .join("");
  }
  updateClearQueueButtonState();
  updateQueueStartControls();
  updatePreviewCueUI();
}

function updateQueueStartControls() {
  const controls = document.getElementById("queueStartControls");
  if (!controls) return;
  const index = selectedQueueIndexForDisplay();
  const hasPlayableSelection =
    queueIndexInRange(index) && isScheduleItemCurrentlyPlayable(mediaQueue[index]);
  controls.hidden = !hasPlayableSelection;
  controls.dataset.queueIndex = hasPlayableSelection ? String(index) : "";
  controls.querySelectorAll("[data-queue-start-mode]").forEach((button) => {
    const mode = button.getAttribute("data-queue-start-mode");
    const active =
      hasPlayableSelection &&
      (mode === "auto") === (mediaQueue[index].autoAdvance !== false);
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.disabled = !hasPlayableSelection;
  });
}

function setScheduleSectionCollapsed(index, collapsed) {
  if (!queueIndexInRange(index) || !isQueueItemSection(mediaQueue[index])) return;
  mediaQueue[index].collapsed = collapsed === true;
  renderQueue();
  saveMediaFile();
}

function toggleScheduleSectionCollapsed(index) {
  if (!queueIndexInRange(index) || !isQueueItemSection(mediaQueue[index])) return;
  if (sectionItemCount(index) === 0) return;
  setScheduleSectionCollapsed(index, mediaQueue[index].collapsed !== true);
}

async function renameScheduleSection(index) {
  if (!queueIndexInRange(index) || !isQueueItemSection(mediaQueue[index])) return;
  const currentName = mediaQueue[index].name || DEFAULT_SCHEDULE_SECTION_NAME;
  const nextName = await showRendererPrompt("Section name", currentName, {
    title: "Rename Section",
    confirmLabel: "Rename",
    required: true,
    maxLength: 80,
  });
  if (nextName === null) return;
  const normalized = normalizeScheduleSectionName(nextName);
  if (normalized === currentName) return;
  mediaQueue[index].name = normalized;
  renderQueue();
  saveMediaFile();
}

async function addScheduleSectionAfterSelection() {
  const name = await showRendererPrompt("Section name", DEFAULT_SCHEDULE_SECTION_NAME, {
    title: "Add Section",
    confirmLabel: "Add",
    required: true,
    maxLength: 80,
  });
  if (name === null) return;
  invalidateQueueUndoToastAfterMutation();
  const insertIndex = queueInsertionIndexAfterSelection();
  insertQueueEntriesAt([createScheduleSectionEntry(name)], insertIndex);
  renderQueue();
  saveMediaFile();
}

function fallbackSelectedQueueIndex() {
  const separatePreviewCue = isPreparingSeparateCue();
  if (separatePreviewCue && queueIndexInRange(previewCueIndex)) {
    return previewCueIndex;
  }
  if (queueIndexInRange(currentQueueIndex)) {
    return currentQueueIndex;
  }
  return -1;
}

function selectedQueueIndexForDisplay() {
  return queueIndexInRange(selectedQueueAnchorIndex)
    ? selectedQueueAnchorIndex
    : fallbackSelectedQueueIndex();
}

function selectedQueueIndexForInsertion() {
  if (!queueInsertionSelectionExplicit) return -1;
  const selectedIndexes = mediaQueue
    .map((item, index) => (selectedQueueItems.has(item) ? index : -1))
    .filter((index) => index >= 0);
  if (selectedIndexes.length > 0) return Math.max(...selectedIndexes);
  return queueIndexInRange(selectedQueueAnchorIndex) ? selectedQueueAnchorIndex : -1;
}

function queueInsertionIndexAfterSelection() {
  const selectedIndex = selectedQueueIndexForInsertion();
  return selectedIndex >= 0
    ? scheduleInsertionIndexAfterItem(mediaQueue, selectedIndex)
    : mediaQueue.length;
}

function extendQueueSelectionTo(index) {
  if (!queueIndexInRange(index)) return;
  setSharedRendererState({ queueInsertionSelectionExplicit: true });
  const anchor = queueIndexInRange(queueSelectionRangeAnchorIndex)
    ? queueSelectionRangeAnchorIndex
    : queueIndexInRange(selectedQueueAnchorIndex)
      ? selectedQueueAnchorIndex
      : index;
  selectedQueueItems.clear();
  for (let i = Math.min(anchor, index); i <= Math.max(anchor, index); i += 1) {
    selectedQueueItems.add(mediaQueue[i]);
  }
  setSharedRendererState({ queueSelectionRangeAnchorIndex: anchor });
  setSharedRendererState({ selectedQueueAnchorIndex: index });
}

function revealNewQueueEntries(entries) {
  const addedEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!addedEntries.length) return;
  selectedQueueItems.clear();
  addedEntries.forEach((item) => {
    selectedQueueItems.add(item);
    recentlyAddedQueueItems.add(item);
  });
  setSharedRendererState({ selectedQueueAnchorIndex: mediaQueue.indexOf(addedEntries[addedEntries.length - 1]) });
  setSharedRendererState({ queueSelectionRangeAnchorIndex: mediaQueue.indexOf(addedEntries[0]) });
  setSharedRendererState({ queueInsertionSelectionExplicit: true });

  if (recentlyAddedQueueItemsTimer !== null) {
    window.clearTimeout(recentlyAddedQueueItemsTimer);
  }
  requestAnimationFrame(() => {
    const firstIndex = mediaQueue.indexOf(addedEntries[0]);
    document
      .querySelector(`.queue-item[data-queue-index="${firstIndex}"]`)
      ?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  });
  recentlyAddedQueueItemsTimer = window.setTimeout(() => {
    addedEntries.forEach((item) => recentlyAddedQueueItems.delete(item));
    document.querySelectorAll(".queue-item.is-newly-added").forEach((row) => {
      row.classList.remove("is-newly-added");
    });
    recentlyAddedQueueItemsTimer = null;
  }, 1800);
}

function updateQueueSelectionVisual() {
  const selectedIndex = selectedQueueIndexForDisplay();
  document.querySelectorAll(".queue-item[data-queue-index]").forEach((row) => {
    const index = Number.parseInt(row.getAttribute("data-queue-index"), 10);
    const isSelected =
      Number.isFinite(index) &&
      (selectedQueueItems.size > 0
        ? selectedQueueItems.has(mediaQueue[index])
        : index === selectedIndex);
    row.classList.toggle("is-selected", isSelected);
    if (isSelected) {
      row.dataset.selected = "true";
    } else {
      delete row.dataset.selected;
    }
  });
  updateQueueStartControls();
}

function insertQueueEntriesAt(entries, insertIndex) {
  const nextEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!nextEntries.length) return -1;
  const index = Math.max(0, Math.min(insertIndex, mediaQueue.length));
  mediaQueue.splice(index, 0, ...nextEntries);
  shiftQueueIndexesForInsertion(index, nextEntries.length);
  revealNewQueueEntries(nextEntries);
  return index;
}

function queueDropPlacementFromEvent(list, event, options = {}) {
  const row = event.target.closest(".queue-item[data-queue-index]");
  if (!row || !list.contains(row)) {
    return options.sectionBlock === true
      ? scheduleSectionBlockDropPlacement(mediaQueue, -1)
      : scheduleDropPlacementForTarget(mediaQueue, -1);
  }
  const idx = Number.parseInt(row.getAttribute("data-queue-index"), 10);
  if (Number.isNaN(idx)) {
    return options.sectionBlock === true
      ? scheduleSectionBlockDropPlacement(mediaQueue, -1)
      : scheduleDropPlacementForTarget(mediaQueue, -1);
  }
  const rect = row.getBoundingClientRect();
  const afterTarget = event.clientY > rect.top + rect.height / 2;
  if (options.sectionBlock === true) {
    return scheduleSectionBlockDropPlacement(mediaQueue, idx, {
      // A section dropped anywhere on another section's children belongs
      // after that whole section, never in the middle of its child rows.
      afterSection: isQueueItemSection(mediaQueue[idx]) ? afterTarget : true,
    });
  }
  return scheduleDropPlacementForTarget(mediaQueue, idx, { afterTarget });
}

function queueDropInsertIndexFromEvent(list, event) {
  return queueDropPlacementFromEvent(list, event).insertIndex;
}

function ensureQueueDropIndicator(list) {
  if (!queueDropIndicator) {
    queueDropIndicator = document.createElement("div");
    queueDropIndicator.className = "queue-drop-indicator";
    queueDropIndicator.hidden = true;
    queueDropIndicator.setAttribute("aria-hidden", "true");
  }
  if (queueDropIndicator.parentNode !== list) {
    list.appendChild(queueDropIndicator);
  }
  return queueDropIndicator;
}

function updateQueueDropIndicator(list, placementOrIndex, options = {}) {
  const indicator = ensureQueueDropIndicator(list);
  const insertIndex = Number.isInteger(placementOrIndex)
    ? placementOrIndex
    : placementOrIndex?.insertIndex;
  const safeInsertIndex = Number.isInteger(insertIndex)
    ? Math.max(0, Math.min(insertIndex, mediaQueue.length))
    : mediaQueue.length;
  const sectionIndex = Number.isInteger(placementOrIndex?.sectionIndex)
    ? placementOrIndex.sectionIndex
    : scheduleSectionIndexForInsertion(mediaQueue, safeInsertIndex);
  const placementKind = placementOrIndex?.kind || "";
  const verb = options.verb === "Move" ? "Move" : "Add";
  const rows = [...list.querySelectorAll(".queue-item[data-queue-index]")];
  const beforeItem = safeInsertIndex < mediaQueue.length ? mediaQueue[safeInsertIndex] : null;
  const section = sectionIndex >= 0 ? mediaQueue[sectionIndex] : null;
  const sectionName = section?.name || DEFAULT_SCHEDULE_SECTION_NAME;
  if (placementKind === "before-section" && section) {
    indicator.dataset.label = `${verb} before “${sectionName}”`;
  } else if (placementKind === "after-section" && section) {
    indicator.dataset.label = `${verb} after “${sectionName}”`;
  } else if (
    section &&
    scheduleSectionEndIndex(mediaQueue, sectionIndex) === safeInsertIndex
  ) {
    indicator.dataset.label = `${verb} to end of “${sectionName}”`;
  } else if (beforeItem?.name) {
    indicator.dataset.label = `${verb} before “${beforeItem.name}”`;
  } else {
    indicator.dataset.label = `${verb} to end of Schedule`;
  }
  list.querySelectorAll(".queue-item--section.is-drop-target").forEach((sectionRow) => {
    sectionRow.classList.remove("is-drop-target");
  });
  if (sectionIndex >= 0) {
    list
      .querySelector(`.queue-item--section[data-queue-index="${sectionIndex}"]`)
      ?.classList.add("is-drop-target");
  }
  if (rows.length === 0) {
    indicator.style.top = "0px";
  } else {
    const nextRow = rows.find((row) => {
      const rowIndex = Number.parseInt(row.getAttribute("data-queue-index"), 10);
      return Number.isInteger(rowIndex) && rowIndex >= safeInsertIndex;
    });
    if (!nextRow) {
      const lastRow = rows[rows.length - 1];
      indicator.style.top = `${lastRow.offsetTop + lastRow.offsetHeight}px`;
    } else {
      indicator.style.top = `${nextRow.offsetTop}px`;
    }
  }
  indicator.hidden = false;
  setSharedRendererState({ queueDropIndicatorIndex: safeInsertIndex });
}

function updateClearQueueButtonState() {
  const btn = document.getElementById("clearQueueBtn");
  if (btn) {
    const empty = mediaQueue.length === 0;
    // Per HIG: don't draw attention to actions that have no effect.
    // Hide the Clear button entirely when there is nothing to clear,
    // rather than leaving a disabled control next to the empty header.
    btn.hidden = empty;
    btn.disabled = empty;
    btn.setAttribute("aria-disabled", empty ? "true" : "false");
  }
  updatePreviewEmptyState();
}

function reorderQueueEntriesAtInsertIndex(fromIndex, rawInsertIndex, options = {}) {
  if (!queueIndexInRange(fromIndex) || !Number.isInteger(rawInsertIndex)) return;
  const sourceIsSection = isQueueItemSection(mediaQueue[fromIndex]);
  let movingIndexes;
  if (sourceIsSection) {
    const endIndex = scheduleSectionEndIndex(mediaQueue, fromIndex);
    movingIndexes = Array.from(
      { length: Math.max(0, endIndex - fromIndex) },
      (_, offset) => fromIndex + offset,
    );
  } else if (options.forceSingle === true) {
    movingIndexes = [fromIndex];
  } else {
    const selectedIndexes = mediaQueue
      .map((item, index) => (selectedQueueItems.has(item) ? index : -1))
      .filter((index) => index >= 0);
    const selectionContainsSection = selectedIndexes.some((index) =>
      isQueueItemSection(mediaQueue[index]),
    );
    movingIndexes =
      selectedIndexes.length > 1 &&
      selectedIndexes.includes(fromIndex) &&
      !selectionContainsSection
        ? selectedIndexes
        : [fromIndex];
  }
  if (!movingIndexes.length) return;

  const movingItems = movingIndexes.map((index) => mediaQueue[index]);
  const movingSet = new Set(movingItems);
  const activeItem = queueIndexInRange(currentQueueIndex) ? mediaQueue[currentQueueIndex] : null;
  const cueItem = queueIndexInRange(previewCueIndex) ? mediaQueue[previewCueIndex] : null;
  const previewAudioItem = queueIndexInRange(previewAudioCueIndex)
    ? mediaQueue[previewAudioCueIndex]
    : null;
  const liveAudioItem = queueIndexInRange(liveAudioQueueIndex)
    ? mediaQueue[liveAudioQueueIndex]
    : null;
  const boundaryItem = queueIndexInRange(manualBoundaryPauseIndex)
    ? mediaQueue[manualBoundaryPauseIndex]
    : null;
  const pendingSwitchItem = queueIndexInRange(pendingQueueSwitchIndex)
    ? mediaQueue[pendingQueueSwitchIndex]
    : null;
  const movedLiveAudio = Boolean(
    (liveAudioItem && movingSet.has(liveAudioItem)) ||
    (activeItem &&
      movingSet.has(activeItem) &&
      (playingMediaAudioOnly || liveAudio?.paused === false || isQueueItemAudio(activeItem))),
  );
  const rangeAnchorItem = queueIndexInRange(queueSelectionRangeAnchorIndex)
    ? mediaQueue[queueSelectionRangeAnchorIndex]
    : movingItems[0];
  const focusItem = queueIndexInRange(selectedQueueAnchorIndex)
    ? mediaQueue[selectedQueueAnchorIndex]
    : movingItems[movingItems.length - 1];

  const reordered = reorderScheduleItemsAtInsertion(
    mediaQueue,
    movingIndexes,
    rawInsertIndex,
  );
  if (!reordered.changed) return;
  mediaQueue.splice(0, mediaQueue.length, ...reordered.items);

  setSharedRendererState({ currentQueueIndex: activeItem ? mediaQueue.indexOf(activeItem) : -1 });
  setSharedRendererState({ previewCueIndex: cueItem ? mediaQueue.indexOf(cueItem) : -1 });
  setSharedRendererState({ previewAudioCueIndex: previewAudioItem ? mediaQueue.indexOf(previewAudioItem) : -1 });
  setSharedRendererState({ liveAudioQueueIndex: liveAudioItem ? mediaQueue.indexOf(liveAudioItem) : -1 });
  setSharedRendererState({ manualBoundaryPauseIndex: boundaryItem ? mediaQueue.indexOf(boundaryItem) : -1 });
  if (pendingSwitchItem) setSharedRendererState({ pendingQueueSwitchIndex: mediaQueue.indexOf(pendingSwitchItem) });
  if (previewCueVideoIndex >= 0) setSharedRendererState({ previewCueVideoIndex: previewCueIndex });
  setSharedRendererState({ queueSelectionRangeAnchorIndex: mediaQueue.indexOf(rangeAnchorItem) });
  setSharedRendererState({ selectedQueueAnchorIndex: mediaQueue.indexOf(focusItem) });

  ignoreNextQueueItemClick = true;
  ignoreQueueItemClicksUntil = performance.now() + 1500;
  window.setTimeout(() => {
    ignoreNextQueueItemClick = false;
  }, 400);
  invalidateQueueUndoToastAfterMutation();
  renderQueue();
  if (movedLiveAudio) {
    hidePptxPreviewIfNeeded();
    restoreCountdownForLiveMedia();
    refreshLiveAudioControls();
    syncPlayPauseIconToControlMedia();
    syncPreviewAudioTrackState();
  }
  saveMediaFile();
}

function reorderMediaQueue(fromIndex, toIndex) {
  if (!queueIndexInRange(fromIndex) || !queueIndexInRange(toIndex)) return;
  if (isQueueItemSection(mediaQueue[fromIndex])) {
    reorderScheduleSectionBlock(fromIndex, toIndex);
    return;
  }
  const insertIndex = fromIndex < toIndex ? toIndex + 1 : toIndex;
  reorderQueueEntriesAtInsertIndex(fromIndex, insertIndex, { forceSingle: true });
}

function reorderScheduleSectionBlock(fromIndex, toIndex) {
  if (
    !queueIndexInRange(fromIndex) ||
    !isQueueItemSection(mediaQueue[fromIndex]) ||
    !queueIndexInRange(toIndex)
  ) {
    return;
  }
  const placement = scheduleSectionBlockDropPlacement(mediaQueue, toIndex, {
    afterSection: toIndex > fromIndex,
  });
  reorderQueueEntriesAtInsertIndex(fromIndex, placement.insertIndex, {
    forceSingle: true,
  });
}

function reorderSelectedMediaQueue(fromIndex, toIndex) {
  if (!queueIndexInRange(fromIndex) || !queueIndexInRange(toIndex)) return;
  if (isQueueItemSection(mediaQueue[fromIndex])) {
    reorderScheduleSectionBlock(fromIndex, toIndex);
    return;
  }
  const insertIndex = fromIndex < toIndex ? toIndex + 1 : toIndex;
  reorderQueueEntriesAtInsertIndex(fromIndex, insertIndex);
}

function enqueuePathsFromFilePicker(paths, options = {}) {
  if (currentMode !== MEDIAPLAYER || !paths.length) return;
  invalidateQueueUndoToastAfterMutation();
  const biblePresentationLive =
    isActiveMediaWindow() && activeMediaWindowContentType === "bible";
  const newEntries = paths.map(createQueueEntry);
  const requestedInsertIndex = Number.isInteger(options.insertIndex)
    ? Math.max(0, Math.min(options.insertIndex, mediaQueue.length))
    : null;
  const insertionAnchorIndex =
    requestedInsertIndex === null ? selectedQueueIndexForInsertion() : requestedInsertIndex - 1;
  const insertionAnchorName =
    insertionAnchorIndex >= 0 ? mediaQueue[insertionAnchorIndex]?.name : "";
  const firstNewIndex =
    requestedInsertIndex === null
      ? insertQueueEntriesAfterSelection(newEntries)
      : insertQueueEntriesAt(newEntries, requestedInsertIndex);
  if (firstNewIndex < 0) return;
  renderQueue();
  const addedLabel = `${newEntries.length} media item${newEntries.length === 1 ? "" : "s"}`;
  showGnomeToast(
    insertionAnchorName
      ? `Added ${addedLabel} after ${insertionAnchorName}`
      : `Added ${addedLabel} to the end of the schedule`,
  );
  void (async () => {
    try {
        if (
          !options.preserveWorkspace &&
          ((!isActiveMediaWindow() &&
            !isLocalAppWindowPresentationActive()) ||
            biblePresentationLive) &&
          mediaQueue[firstNewIndex]
        ) {
        // The newly-added row is already painted as selected. Load it before
        // the slower integrity-baseline work so selection and preview cannot
        // visibly disagree while a large video is being inspected.
        await onQueueItemActivate(firstNewIndex);
      }
    } finally {
      await stampBaselineForQueueItems(newEntries);
    }
  })().catch((err) => console.error(err));
}

async function extractAndFilterDroppedMediaPaths(dataTransfer) {
  if (!dataTransfer?.files?.length) return [];
  const paths = [];
  for (const file of dataTransfer.files) {
    const p = getPathForFile(file);
    if (typeof p === "string" && p.length > 0) paths.push(p);
  }
  if (paths.length === 0) return [];
  try {
    const filtered = await invoke("filter-media-drop-paths", paths);
    return Array.isArray(filtered) ? filtered : [];
  } catch (err) {
    console.error("filter-media-drop-paths failed:", err);
    return [];
  }
}

function applyDroppedMediaPaths(paths, options = {}) {
  if (!paths || paths.length === 0) return;
  if (currentMode !== MEDIAPLAYER) setSBFormMediaPlayer();
  if (!options.preserveWorkspace) showMediaWorkspace();
  enqueuePathsFromFilePicker(paths, options);
  saveMediaFile();
  invoke("remember-media-folder", paths).catch((err) => {
    console.error("remember-media-folder failed:", err);
  });
  void recordScheduledMediaPaths(paths).catch((err) => {
    console.error("Failed to record scheduled media in Recent:", err);
  });
}

function clearMediaQueue() {
  stopPreviewAudioCue();
  clearVideoPreviewCueOverlay();
  setSharedRendererState({ mediaQueue: [] });
  setSharedRendererState({ currentQueueIndex: -1 });
  setSharedRendererState({ previewCueIndex: -1 });
  setSharedRendererState({ selectedQueueAnchorIndex: -1 });
  setSharedRendererState({ isQueuePlaying: false });
  setSharedRendererState({ manualBoundaryPauseIndex: -1 });
  // Hand the countdown overlay back to the live media (or hide it if the
  // queue clear leaves nothing playing). Without this, a cleared queue
  // that previously hosted an image cue would leave the overlay hidden
  // even after the operator dragged in a new audio/video clip.
  restoreCountdownForLiveMedia();
  syncMediaLoopState({ notify: false });
  resetPreviewSurfaceToEmptyState();
  renderQueue();
}

async function onClearMediaQueueClick() {
  if (mediaQueue.length === 0) return;
  setSharedRendererState({ pendingQueueSwitchIndex: null });
  setSharedRendererState({ pendingQueueSwitchStartTime: 0 });
  await captureQueueClearUndoState();

  if (isActiveMediaWindow()) {
    setSharedRendererState({ pendingQueueClearPostClose: true });
    setSharedRendererState({ isQueuePlaying: false });
    setSharedRendererState({ isPlaying: false });
    updateDynUI();
    clearMediaQueue();
    pauseLocalPreviewAfterQueueClear();
    showQueueClearedUndoToast();
    send("close-media-window", 0);
    return;
  }

  await finalizeQueueClearDestructive();
}

function removeFromQueue(index) {
  if (index < 0 || index >= mediaQueue.length) return;
  const removedItem = mediaQueue[index];
  const removedCurrentItem = index === currentQueueIndex;
  if (removedCurrentItem && isQueuePresentationActive()) {
    showGnomeToast("Stop the presentation to remove the current item");
    return;
  }
  invalidateQueueUndoToastAfterMutation();
  mediaQueue.splice(index, 1);
  selectedQueueItems.delete(removedItem);
  if (selectedQueueAnchorIndex === index) {
    setSharedRendererState({ selectedQueueAnchorIndex: mediaQueue.length > 0 ? Math.min(index, mediaQueue.length - 1) : -1 });
  } else if (selectedQueueAnchorIndex > index) {
    setSharedRendererState({ selectedQueueAnchorIndex: selectedQueueAnchorIndex - 1 });
  } else if (selectedQueueAnchorIndex >= mediaQueue.length) {
    setSharedRendererState({ selectedQueueAnchorIndex: -1 });
  }
  if (queueSelectionRangeAnchorIndex === index) {
    setSharedRendererState({ queueSelectionRangeAnchorIndex: selectedQueueAnchorIndex });
  } else if (queueSelectionRangeAnchorIndex > index) {
    setSharedRendererState({ queueSelectionRangeAnchorIndex: queueSelectionRangeAnchorIndex - 1 });
  } else if (queueSelectionRangeAnchorIndex >= mediaQueue.length) {
    setSharedRendererState({ queueSelectionRangeAnchorIndex: selectedQueueAnchorIndex });
  }
  if (selectedQueueItems.size > 0) {
    const firstSelectedIndex = mediaQueue.findIndex((item) => selectedQueueItems.has(item));
    if (!selectedQueueItems.has(mediaQueue[selectedQueueAnchorIndex])) {
      setSharedRendererState({ selectedQueueAnchorIndex: firstSelectedIndex });
    }
    if (!selectedQueueItems.has(mediaQueue[queueSelectionRangeAnchorIndex])) {
      setSharedRendererState({ queueSelectionRangeAnchorIndex: firstSelectedIndex });
    }
  } else if (queueIndexInRange(selectedQueueAnchorIndex)) {
    selectedQueueItems.add(mediaQueue[selectedQueueAnchorIndex]);
  }
  if (currentQueueIndex > index) setSharedRendererState({ currentQueueIndex: currentQueueIndex - 1 });
  else if (removedCurrentItem) {
    if (mediaQueue.length === 0) {
      setSharedRendererState({ currentQueueIndex: -1 });
    } else if (index >= mediaQueue.length) {
      setSharedRendererState({ currentQueueIndex: mediaQueue.length - 1 });
    } else {
      setSharedRendererState({ currentQueueIndex: index });
    }
  } else if (currentQueueIndex >= mediaQueue.length) setSharedRendererState({ currentQueueIndex: -1 });
  if (manualBoundaryPauseIndex === index) {
    setSharedRendererState({ manualBoundaryPauseIndex: -1 });
  } else if (manualBoundaryPauseIndex > index) {
    setSharedRendererState({ manualBoundaryPauseIndex: manualBoundaryPauseIndex - 1 });
  } else if (manualBoundaryPauseIndex >= mediaQueue.length) {
    setSharedRendererState({ manualBoundaryPauseIndex: -1 });
  }
  if (previewCueIndex === index) {
    setSharedRendererState({ previewCueIndex: -1 });
    stopPreviewAudioCue();
    clearVideoPreviewCueOverlay();
    // The removed item was the cue, so the cue is gone — hand the
    // countdown overlay back to the live media (image: hidden;
    // audio/video: repainted with live time).
    restoreCountdownForLiveMedia();
    syncPlayPauseIconToControlMedia();
  } else if (previewCueIndex > index) {
    setSharedRendererState({ previewCueIndex: previewCueIndex - 1 });
    // Keep the cue overlay's index in sync with the shifted cue index so
    // isVideoPreviewCueActive() keeps recognising the loaded overlay as
    // the still-active cue after the surrounding queue shrinks.
    if (previewCueVideoIndex > index) setSharedRendererState({ previewCueVideoIndex: previewCueVideoIndex - 1 });
  } else if (previewCueIndex >= mediaQueue.length) setSharedRendererState({ previewCueIndex: -1 });
  syncMediaLoopState({ notify: false });
  if (mediaQueue.length === 0) {
    resetPreviewSurfaceToEmptyState();
  }
  renderQueue();
  if (
    removedCurrentItem &&
    currentMode === MEDIAPLAYER &&
    mediaQueue.length > 0 &&
    !isQueuePresentationActive()
  ) {
    const previewIndex =
      currentQueueIndex >= 0 && currentQueueIndex < mediaQueue.length
        ? currentQueueIndex
        : 0;
    void loadQueueItemIntoControlWindow(mediaQueue[previewIndex]).catch(
      (err) => console.error(err),
    );
  }
  saveMediaFile();
}

function setQueueItemAutoAdvance(index, autoAdvanceEnabled, options = {}) {
  if (index < 0 || index >= mediaQueue.length) return;
  const nextAutoAdvanceEnabled = autoAdvanceEnabled !== false;
  const wasAutoAdvanceEnabled = mediaQueue[index].autoAdvance !== false;
  if (wasAutoAdvanceEnabled === nextAutoAdvanceEnabled) {
    updateQueueStartControls();
    return;
  }
  mediaQueue[index].autoAdvance = nextAutoAdvanceEnabled;
  renderQueue();
  schedulePptxThumbnailRefresh();
  saveMediaFile();
  if (nextAutoAdvanceEnabled && options.resumeIfReady === true) {
    void resumeQueueFromManualBoundaryIfReady(index).catch((err) =>
      console.error("Failed to resume queue after auto-advance toggle:", err),
    );
  }
}

function toggleQueueItemAutoAdvance(index) {
  if (index < 0 || index >= mediaQueue.length) return;
  setQueueItemAutoAdvance(index, mediaQueue[index].autoAdvance === false, {
    resumeIfReady: true,
  });
}

function hideScheduleSongContextMenu() {
  document.getElementById("scheduleSongContextMenu")?.setAttribute("hidden", "");
}

function hideScheduleSectionContextMenu() {
  document.getElementById("scheduleSectionContextMenu")?.setAttribute("hidden", "");
}

function ensureScheduleSongContextMenu() {
  let menu = document.getElementById("scheduleSongContextMenu");
  if (menu) return menu;

  menu = document.createElement("div");
  menu.id = "scheduleSongContextMenu";
  menu.className = "song-context-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  menu.innerHTML = `
    <button type="button" role="menuitem" data-schedule-song-action="edit">Edit</button>
  `;

  menu.addEventListener("pointerdown", (event) => event.stopPropagation());
  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    const button = event.target.closest("[data-schedule-song-action]");
    if (!button) return;
    const index = menu._queueIndex;
    hideScheduleSongContextMenu();
    if (button.getAttribute("data-schedule-song-action") !== "edit") return;
    void loadQueueItemIntoPreviewCue(index)
      .then(() => openSongEditor(currentWorkspaceSongDeck || currentWorkspaceSong))
      .catch((error) => {
        console.error("Failed to open scheduled song editor:", error);
        showGnomeToast("Failed to open song editor");
      });
  });

  document.body.appendChild(menu);
  if (document.body.dataset.scheduleSongContextMenuBound !== "1") {
    document.body.dataset.scheduleSongContextMenuBound = "1";
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (event.target.closest?.("#scheduleSongContextMenu")) return;
        hideScheduleSongContextMenu();
      },
      true,
    );
    window.addEventListener("resize", hideScheduleSongContextMenu);
    window.addEventListener("scroll", hideScheduleSongContextMenu, true);
  }
  return menu;
}

function showScheduleSongContextMenu(event, index) {
  event.preventDefault();
  event.stopPropagation();
  hideScheduleBibleContextMenu();
  hideScheduleSectionContextMenu();
  const menu = ensureScheduleSongContextMenu();
  menu._queueIndex = index;
  menu.hidden = false;
  menu.style.left = "0px";
  menu.style.top = "0px";
  const menuRect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(event.clientX, window.innerWidth - menuRect.width - 8));
  const top = Math.max(8, Math.min(event.clientY, window.innerHeight - menuRect.height - 8));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function ensureScheduleSectionContextMenu() {
  let menu = document.getElementById("scheduleSectionContextMenu");
  if (menu) return menu;

  menu = document.createElement("div");
  menu.id = "scheduleSectionContextMenu";
  menu.className = "song-context-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  menu.innerHTML = `
    <button type="button" role="menuitem" data-schedule-section-action="rename">Rename</button>
    <button type="button" role="menuitem" data-schedule-section-action="toggle">Collapse</button>
    <div class="song-context-menu__separator" role="separator"></div>
    <button type="button" role="menuitem" data-schedule-section-action="remove" class="song-context-menu__destructive">Remove Section Header</button>
  `;

  menu.addEventListener("pointerdown", (event) => event.stopPropagation());
  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    const button = event.target.closest("[data-schedule-section-action]");
    if (!button) return;
    const index = menu._queueIndex;
    const action = button.getAttribute("data-schedule-section-action");
    hideScheduleSectionContextMenu();
    if (!queueIndexInRange(index) || !isQueueItemSection(mediaQueue[index])) return;
    if (action === "rename") {
      void renameScheduleSection(index);
    } else if (action === "toggle") {
      toggleScheduleSectionCollapsed(index);
    } else if (action === "remove") {
      removeFromQueue(index);
    }
  });

  document.body.appendChild(menu);
  if (document.body.dataset.scheduleSectionContextMenuBound !== "1") {
    document.body.dataset.scheduleSectionContextMenuBound = "1";
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (event.target.closest?.("#scheduleSectionContextMenu")) return;
        hideScheduleSectionContextMenu();
      },
      true,
    );
    window.addEventListener("resize", hideScheduleSectionContextMenu);
    window.addEventListener("scroll", hideScheduleSectionContextMenu, true);
  }
  return menu;
}

function showScheduleSectionContextMenu(event, index, options = {}) {
  event.preventDefault();
  event.stopPropagation();
  hideScheduleBibleContextMenu();
  hideScheduleSongContextMenu();
  const menu = ensureScheduleSectionContextMenu();
  menu._queueIndex = index;
  const toggleButton = menu.querySelector('[data-schedule-section-action="toggle"]');
  if (toggleButton) {
    toggleButton.textContent = mediaQueue[index]?.collapsed === true ? "Expand" : "Collapse";
    toggleButton.disabled = sectionItemCount(index) === 0;
  }
  menu.hidden = false;
  menu.style.left = "0px";
  menu.style.top = "0px";
  const menuRect = menu.getBoundingClientRect();
  const anchorRect = options.anchorElement?.getBoundingClientRect?.();
  const requestedLeft = anchorRect ? anchorRect.right - menuRect.width : event.clientX;
  const requestedTop = anchorRect ? anchorRect.bottom + 4 : event.clientY;
  const left = Math.max(8, Math.min(requestedLeft, window.innerWidth - menuRect.width - 8));
  const top = Math.max(8, Math.min(requestedTop, window.innerHeight - menuRect.height - 8));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

async function resumeQueueFromManualBoundaryIfReady(index) {
  if (
    manualBoundaryPauseIndex !== index ||
    isQueuePlaying ||
    isPlaying ||
    index < 0 ||
    index >= mediaQueue.length ||
    currentQueueIndex !== index ||
    mediaQueue[index]?.autoAdvance === false
  ) {
    return;
  }

  setSharedRendererState({ manualBoundaryPauseIndex: -1 });
  setSharedRendererState({ isQueuePlaying: true });
  setSharedRendererState({ isPlaying: true });
  updateDynUI();
  renderQueue();
  const item = mediaQueue[index];
  await playCurrentQueueItem({
    preservePreviewSeek: false,
    startTime: queueItemCueStartTime(item),
  });
}

function installMediaQueueListDelegation() {
  const list = document.getElementById("mediaQueueList");
  if (!list || list.dataset.queueDelegation === "1") return;
  list.dataset.queueDelegation = "1";
  const scheduleDropRoot = list.closest(".queue-section") || list;
  const queueRowActionSelector =
    "[data-queue-remove], [data-queue-reload-update], [data-queue-keep-update], [data-queue-apply-update], [data-queue-section-toggle], [data-queue-section-menu]";
  list.addEventListener("contextmenu", (event) => {
    if (event.target.closest(queueRowActionSelector)) return;
    const row = event.target.closest(".queue-item[data-queue-index]");
    if (!row || !list.contains(row)) return;
    const index = Number.parseInt(row.getAttribute("data-queue-index"), 10);
    if (!queueIndexInRange(index)) return;
    setSelectedQueueAnchor(index, { explicit: true });
    updateQueueSelectionVisual();
    if (isQueueItemBible(mediaQueue[index])) {
      showScheduleBibleContextMenu(event, index);
    } else if (isQueueItemSection(mediaQueue[index])) {
      showScheduleSectionContextMenu(event, index);
    } else if (["song", "deck"].includes(mediaQueue[index]?.type)) {
      showScheduleSongContextMenu(event, index);
    }
  });
  list.addEventListener("click", (e) => {
    const sectionMenuButton = e.target.closest("[data-queue-section-menu]");
    if (sectionMenuButton && list.contains(sectionMenuButton)) {
      e.preventDefault();
      const index = Number.parseInt(
        sectionMenuButton.getAttribute("data-queue-section-menu"),
        10,
      );
      if (!queueIndexInRange(index) || !isQueueItemSection(mediaQueue[index])) return;
      setSelectedQueueAnchor(index, { explicit: true });
      updateQueueSelectionVisual();
      showScheduleSectionContextMenu(e, index, { anchorElement: sectionMenuButton });
      return;
    }
    const sectionToggle = e.target.closest("[data-queue-section-toggle]");
    if (sectionToggle && list.contains(sectionToggle)) {
      e.preventDefault();
      toggleScheduleSectionCollapsed(
        Number.parseInt(sectionToggle.getAttribute("data-queue-section-toggle"), 10),
      );
      return;
    }
    const keepUpdateBtn = e.target.closest("[data-queue-keep-update]");
    if (keepUpdateBtn && list.contains(keepUpdateBtn)) {
      e.preventDefault();
      keepPendingMediaUpdate(
        Number.parseInt(keepUpdateBtn.getAttribute("data-queue-keep-update"), 10),
      );
      return;
    }
    const reloadUpdateBtn = e.target.closest(
      "[data-queue-reload-update], [data-queue-apply-update]",
    );
    if (reloadUpdateBtn && list.contains(reloadUpdateBtn)) {
      e.preventDefault();
      const rawIndex =
        reloadUpdateBtn.getAttribute("data-queue-reload-update") ??
        reloadUpdateBtn.getAttribute("data-queue-apply-update");
      void approvePendingMediaUpdate(Number.parseInt(rawIndex, 10));
      return;
    }
    const removeBtn = e.target.closest("[data-queue-remove]");
    if (removeBtn && list.contains(removeBtn)) {
      e.preventDefault();
      removeFromQueue(
        Number.parseInt(removeBtn.getAttribute("data-queue-remove"), 10),
      );
      return;
    }
    if (ignoreNextQueueItemClick || performance.now() < ignoreQueueItemClicksUntil) {
      return;
    }
    const row = e.target.closest(".queue-item[data-queue-index]");
    if (!row || !list.contains(row)) return;
    const idx = Number.parseInt(row.getAttribute("data-queue-index"), 10);
    if (Number.isNaN(idx)) return;
    if (e.shiftKey) {
      extendQueueSelectionTo(idx);
    } else {
      setSelectedQueueAnchor(idx, { explicit: true });
    }
    updateQueueSelectionVisual();
    if (isQueueItemSection(mediaQueue[idx])) {
      e.preventDefault();
      if (queueItemClickTimer !== null) {
        window.clearTimeout(queueItemClickTimer);
        queueItemClickTimer = null;
      }
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      if (queueItemClickTimer !== null) {
        window.clearTimeout(queueItemClickTimer);
        queueItemClickTimer = null;
      }
      return;
    }
    if (e.detail > 1) {
      if (queueItemClickTimer !== null) {
        window.clearTimeout(queueItemClickTimer);
        queueItemClickTimer = null;
      }
      return;
    }
    if (queueItemClickTimer !== null) {
      window.clearTimeout(queueItemClickTimer);
    }
    queueItemClickTimer = window.setTimeout(() => {
      queueItemClickTimer = null;
      void onQueueItemActivate(idx);
    }, 220);
  });

  list.addEventListener("keydown", (event) => {
    if (event.target.closest("button")) return;
    const row = event.target.closest(".queue-item--section[data-queue-index]");
    if (!row || !list.contains(row)) return;
    const index = Number.parseInt(row.getAttribute("data-queue-index"), 10);
    if (!queueIndexInRange(index) || !isQueueItemSection(mediaQueue[index])) return;
    if (event.key === "F2") {
      event.preventDefault();
      void renameScheduleSection(index);
    } else if ((event.key === "Enter" || event.key === " ") && sectionItemCount(index) > 0) {
      event.preventDefault();
      toggleScheduleSectionCollapsed(index);
    } else if (
      event.key === "ArrowLeft" &&
      sectionItemCount(index) > 0 &&
      mediaQueue[index].collapsed !== true
    ) {
      event.preventDefault();
      setScheduleSectionCollapsed(index, true);
    } else if (
      event.key === "ArrowRight" &&
      sectionItemCount(index) > 0 &&
      mediaQueue[index].collapsed === true
    ) {
      event.preventDefault();
      setScheduleSectionCollapsed(index, false);
    }
  });

  list.addEventListener("dblclick", (e) => {
    if (e.target.closest(queueRowActionSelector)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (queueItemClickTimer !== null) {
      window.clearTimeout(queueItemClickTimer);
      queueItemClickTimer = null;
    }
    const row = e.target.closest(".queue-item[data-queue-index]");
    if (!row || !list.contains(row)) return;
    const idx = Number.parseInt(row.getAttribute("data-queue-index"), 10);
    if (Number.isNaN(idx)) return;
    setSelectedQueueAnchor(idx, { explicit: true });
    updateQueueSelectionVisual();
    if (isQueueItemSection(mediaQueue[idx])) {
      toggleScheduleSectionCollapsed(idx);
      return;
    }
    void releaseOutputHoldsAndGoLiveQueueIndex(idx).catch((err) => console.error(err));
  });

  list.addEventListener("dragstart", (e) => {
    const row = e.target.closest(".queue-item[data-queue-index]");
    if (!row || !list.contains(row)) return;
    if (e.target.closest(queueRowActionSelector)) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    const idx = Number.parseInt(row.getAttribute("data-queue-index"), 10);
    if (Number.isNaN(idx)) return;
    const selectionContainsSection = [...selectedQueueItems].some((item) =>
      isQueueItemSection(item),
    );
    if (
      !selectedQueueItems.has(mediaQueue[idx]) ||
      isQueueItemSection(mediaQueue[idx]) ||
      selectionContainsSection
    ) {
      setSelectedQueueAnchor(idx, { explicit: true });
    }
    updateQueueSelectionVisual();
    queueDragFromIndex = idx;
    e.dataTransfer.setData("application/x-queue-index", String(idx));
    e.dataTransfer.setData("text/plain", String(idx));
    e.dataTransfer.effectAllowed = "move";
    list.querySelectorAll(".queue-item[data-queue-index]").forEach((queueRow) => {
      const queueIndex = Number.parseInt(queueRow.getAttribute("data-queue-index"), 10);
      if (selectedQueueItems.has(mediaQueue[queueIndex])) {
        queueRow.classList.add("queue-item-dragging");
      }
    });
  });

  list.addEventListener("dragend", (e) => {
    queueDragFromIndex = -1;
    hideQueueDropIndicator();
    list.querySelectorAll(".queue-item-dragging").forEach((el) => {
      el.classList.remove("queue-item-dragging");
    });
    list.querySelectorAll(".queue-item-drag-over").forEach((el) => {
      el.classList.remove("queue-item-drag-over");
    });
  });

  scheduleDropRoot.addEventListener("dragover", (e) => {
    const hasInternalQueueDrag = queueDragFromIndex >= 0;
    const hasSongDrag = Boolean(songDragSongId);
    const hasMediaLibraryDrag = mediaLibraryDragIsActive(e.dataTransfer);
    const hasBibleVerseDrag =
      Boolean(bibleVerseDragPayload) ||
      dataTransferHasType(e.dataTransfer, BIBLE_VERSE_DRAG_MIME);
    if ((hasSongDrag || hasBibleVerseDrag || hasMediaLibraryDrag) && !hasInternalQueueDrag) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      list.querySelectorAll(".queue-item-drag-over").forEach((el) => {
        el.classList.remove("queue-item-drag-over");
      });
      updateQueueDropIndicator(list, queueDropPlacementFromEvent(list, e));
      return;
    }
    if (
      !hasInternalQueueDrag &&
      e.dataTransfer?.types &&
      Array.from(e.dataTransfer.types).includes("Files")
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      list.querySelectorAll(".queue-item-drag-over").forEach((el) => {
        el.classList.remove("queue-item-drag-over");
      });
      updateQueueDropIndicator(list, queueDropPlacementFromEvent(list, e));
      return;
    }
    if (!hasInternalQueueDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    list.querySelectorAll(".queue-item-drag-over").forEach((el) => {
      el.classList.remove("queue-item-drag-over");
    });
    updateQueueDropIndicator(
      list,
      queueDropPlacementFromEvent(list, e, {
        sectionBlock: isQueueItemSection(mediaQueue[queueDragFromIndex]),
      }),
      { verb: "Move" },
    );
  });

  scheduleDropRoot.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget || !scheduleDropRoot.contains(e.relatedTarget)) {
      hideQueueDropIndicator();
    }
    const row = e.target.closest(".queue-item[data-queue-index]");
    if (
      row &&
      list.contains(row) &&
      typeof e.relatedTarget === "object" &&
      e.relatedTarget &&
      !row.contains(e.relatedTarget)
    ) {
      row.classList.remove("queue-item-drag-over");
    }
  });

  scheduleDropRoot.addEventListener("drop", async (e) => {
    const hasInternalQueueDrag = queueDragFromIndex >= 0;
    const droppedSongId = songDragSongId;
    const droppedBibleVersePayload = bibleVerseDragPayloadFromDataTransfer(e.dataTransfer);
    const droppedMediaLibraryItemId = mediaLibraryItemIdFromDataTransfer(e.dataTransfer);
    if (droppedMediaLibraryItemId && !hasInternalQueueDrag) {
      e.preventDefault();
      e.stopPropagation();
      const placement = queueDropPlacementFromEvent(list, e);
      hideQueueDropIndicator();
      try {
        const item = await resolveMediaLibraryDragItem(droppedMediaLibraryItemId);
        if (!item?.localPath || item.availability !== "available") {
          showGnomeToast("This media item is not available");
          return;
        }
        const insertIndex = placement.insertIndex;
        applyDroppedMediaPaths([item.localPath], { insertIndex, preserveWorkspace: true });
      } catch (err) {
        console.error("Failed to schedule Media item:", err);
        showGnomeToast("Failed to add media to the schedule");
      }
      return;
    }
    if (droppedSongId && !hasInternalQueueDrag) {
      e.preventDefault();
      e.stopPropagation();
      const placement = queueDropPlacementFromEvent(list, e);
      hideQueueDropIndicator();
      clearSongDragVisualState();
      try {
        const song = await songsAPI.get(droppedSongId);
        const entry = buildSongQueueEntryFromDeck({
          deck: song,
          render: renderStateForLibrarySong(song),
        });
        if (!entry) return;
        invalidateQueueUndoToastAfterMutation();
        insertQueueEntriesAt([entry], placement.insertIndex);
        renderQueue();
        saveMediaFile();
        showGnomeToast(`Scheduled ${entry.name}`);
      } catch (err) {
        console.error("Failed to schedule dropped song:", err);
        showGnomeToast("Failed to schedule song");
      }
      return;
    }
    if (droppedBibleVersePayload && !hasInternalQueueDrag) {
      e.preventDefault();
      e.stopPropagation();
      const placement = queueDropPlacementFromEvent(list, e);
      hideQueueDropIndicator();
      clearBibleVerseDragVisualState();
      if (!bibleUiEnabled) {
        showGnomeToast("Bible items are disabled in Preferences");
        return;
      }
      try {
        const entries = await queueEntriesForBibleVerseDragPayload(droppedBibleVersePayload);
        if (!entries.length) {
          showGnomeToast("No Bible verses found");
          return;
        }
        invalidateQueueUndoToastAfterMutation();
        insertQueueEntriesAt(entries, placement.insertIndex);
        renderQueue();
        saveMediaFile();
        showGnomeToast(
          entries.length > 1
            ? `Scheduled ${entries.length} Bible slides`
            : `Scheduled ${entries[0]?.name || "Bible text"}`,
        );
      } catch (err) {
        console.error("Failed to schedule dropped Bible verses:", err);
        showGnomeToast("Failed to schedule Bible verses");
      }
      return;
    }
    if (hasInternalQueueDrag) {
      e.preventDefault();
      e.stopPropagation();
      const from = queueDragFromIndex;
      const placement = queueDropPlacementFromEvent(list, e, {
        sectionBlock: isQueueItemSection(mediaQueue[from]),
      });
      hideQueueDropIndicator();
      list.querySelectorAll(".queue-item-drag-over").forEach((el) => {
        el.classList.remove("queue-item-drag-over");
      });
      queueDragFromIndex = -1;
      if (Number.isNaN(from)) return;
      reorderQueueEntriesAtInsertIndex(from, placement.insertIndex);
      return;
    }

    const hasOSFiles =
      e.dataTransfer?.files?.length > 0 ||
      (e.dataTransfer?.types &&
        Array.from(e.dataTransfer.types).includes("Files"));
    if (hasOSFiles) {
      e.preventDefault();
      e.stopPropagation();
      const placement = queueDropPlacementFromEvent(list, e);
      hideQueueDropIndicator();
      list.querySelectorAll(".queue-item-drag-over").forEach((el) => {
        el.classList.remove("queue-item-drag-over");
      });
      const droppedProject = firstDroppedProjectPath(e.dataTransfer);
      if (droppedProject) {
        try {
          await openProjectByPath(droppedProject);
        } catch (err) {
          console.error("Failed to open dropped project:", err);
          showGnomeToast("Failed to open project");
        }
        return;
      }
      const paths = await extractAndFilterDroppedMediaPaths(e.dataTransfer);
      applyDroppedMediaPaths(paths, { insertIndex: placement.insertIndex });
      return;
    }
    // Neither internal queue drag nor OS file drop.
    list.querySelectorAll(".queue-item-drag-over").forEach((el) => {
      el.classList.remove("queue-item-drag-over");
    });
  });
}

function installQueueStartControls() {
  const controls = document.getElementById("queueStartControls");
  if (!controls || controls.dataset.queueStartBound === "1") return;
  controls.dataset.queueStartBound = "1";
  controls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-queue-start-mode]");
    if (!button || !controls.contains(button)) return;
    event.preventDefault();
    const index = Number.parseInt(controls.dataset.queueIndex || "", 10);
    if (!queueIndexInRange(index)) return;
    setQueueItemAutoAdvance(index, button.getAttribute("data-queue-start-mode") === "auto");
  });
}

function installAddQueueSectionButton() {
  const button = document.getElementById("addQueueSectionBtn");
  if (!button || button.dataset.addSectionBound === "1") return;
  button.dataset.addSectionBound = "1";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    void addScheduleSectionAfterSelection().catch((err) => {
      console.error("Failed to add schedule section:", err);
      showGnomeToast("Failed to add section");
    });
  });
}

export {
  applyDroppedMediaPaths,
  clearMediaQueue,
  enqueuePathsFromFilePicker,
  ensureQueueDropIndicator,
  ensureScheduleSongContextMenu,
  extendQueueSelectionTo,
  extractAndFilterDroppedMediaPaths,
  fallbackSelectedQueueIndex,
  hideScheduleSongContextMenu,
  ignoreNextQueueItemClick,
  ignoreQueueItemClicksUntil,
  insertQueueEntriesAt,
  installAddQueueSectionButton,
  installMediaQueueListDelegation,
  installQueueStartControls,
  nextPlayableQueueItemStageText,
  onClearMediaQueueClick,
  queueDragFromIndex,
  queueDropIndicator,
  queueDropInsertIndexFromEvent,
  queueInsertionIndexAfterSelection,
  queueItemClickTimer,
  recentlyAddedQueueItems,
  recentlyAddedQueueItemsTimer,
  removeFromQueue,
  renderQueue,
  reorderMediaQueue,
  reorderSelectedMediaQueue,
  resumeQueueFromManualBoundaryIfReady,
  revealNewQueueEntries,
  selectedQueueIndexForDisplay,
  selectedQueueIndexForInsertion,
  selectedQueueItems,
  showScheduleSongContextMenu,
  toggleQueueItemAutoAdvance,
  updateClearQueueButtonState,
  updateQueueDropIndicator,
  updateQueueSelectionVisual,
  updateQueueStartControls,
};
