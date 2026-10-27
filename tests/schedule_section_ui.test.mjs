import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("schedule sections render as compact native hierarchy rows", async () => {
  const source = await readFile(
    new URL("../src/control-window/app-schedule-controller.mjs", import.meta.url),
    "utf8",
  );
  const css = await readFile(new URL("../src/main.css", import.meta.url), "utf8");
  const renderStart = source.indexOf("function renderQueue()");
  const renderEnd = source.indexOf("\nfunction updateQueueStartControls()", renderStart);
  const renderer = source.slice(renderStart, renderEnd);

  // Join class tokens with an explicit separator: concatenating them makes
  // the section lose all row layout, as well as its styling.
  assert.match(renderer, /"queue-item",\s*"queue-item--section"/);
  assert.match(renderer, /\.filter\(Boolean\)\.join\(" "\)/);
  assert.match(renderer, /class="section-toggle-icon"/);
  assert.match(renderer, /class="section-folder-icon"/);
  assert.match(renderer, /class="section-drag-handle"/);
  assert.match(renderer, /class="section-count"/);
  assert.match(renderer, /class="section-menu-btn"/);
  assert.match(renderer, /data-queue-ungroup/);
  assert.match(renderer, /"Empty section"/);
  assert.match(renderer, /const sectionIndexes = scheduleSectionIndexesForItems\(mediaQueue\)/);
  assert.match(renderer, /const visibleSectionItemCounts = new Map\(\)/);
  assert.doesNotMatch(renderer, /scheduleSectionIndexForItem\(mediaQueue/);

  assert.match(css, /\.queue-item--section-child::before/);
  assert.match(css, /\.queue-item--section-child::after/);
  assert.match(css, /\.queue-item--section\.is-collapsed \.section-toggle-icon/);
  assert.match(css, /\.section-menu-btn:focus-visible/);
  assert.match(css, /\.queue-item \.queue-ungroup-btn/);
});

test("project snapshots preserve explicit service-group membership", async () => {
  const source = await readFile(
    new URL("../src/control-window/app-project-session.mjs", import.meta.url),
    "utf8",
  );
  const snapshotStart = source.indexOf("function buildProjectQueueSnapshot()");
  const snapshotEnd = source.indexOf("\nfunction buildProjectQueueItemSnapshot", snapshotStart);
  const snapshotBuilder = source.slice(snapshotStart, snapshotEnd);

  assert.match(
    snapshotBuilder,
    /ensureProjectQueueIdentityAndGroups\(\{ preserveExistingGroups: true \}\)/,
  );
});

test("schedule section options are discoverable without a context click", async () => {
  const source = await readFile(
    new URL("../src/control-window/app-schedule-controller.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /data-queue-section-menu/);
  assert.match(source, /data-schedule-section-action="rename"/);
  assert.match(source, /data-schedule-section-action="toggle"/);
  assert.match(source, /data-schedule-section-action="move-up"/);
  assert.match(source, /data-schedule-section-action="move-down"/);
  assert.match(source, /data-schedule-section-action="remove"/);
  assert.match(source, /event\.key === "F2"/);
  assert.match(source, /event\.altKey && event\.key === "ArrowUp"/);
  assert.match(source, /event\.altKey && event\.key === "ArrowDown"/);
});

test("schedule drag and drop uses section-aware insertion boundaries", async () => {
  const source = await readFile(
    new URL("../src/control-window/app-schedule-controller.mjs", import.meta.url),
    "utf8",
  );
  const css = await readFile(new URL("../src/main.css", import.meta.url), "utf8");

  assert.match(source, /function queueDropPlacementFromEvent\(/);
  assert.match(source, /scheduleDropPlacementForTarget\(mediaQueue, idx/);
  assert.match(source, /scheduleSectionBlockDropPlacement\(mediaQueue, idx/);
  assert.match(source, /scheduleInsertionIndexAfterItem\(mediaQueue, selectedIndex\)/);
  assert.match(source, /reorderScheduleItemsAtInsertion\(/);
  assert.match(source, /to end of “\$\{sectionName\}”/);
  assert.match(source, /sectionBlock: isQueueItemSection\(mediaQueue\[queueDragFromIndex\]\)/);
  assert.match(source, /allowBeforeSection: !isQueueItemSection\(mediaQueue\[queueDragFromIndex\]\)/);
  assert.match(source, /destinationGroupId: scheduleGroupIdForDropPlacement\(placement\)/);
  assert.match(source, /destinationGroupId: scheduleGroupIdForSectionIndex\(sectionIndex\)/);
  assert.match(source, /insertionPoint: captureQueueInsertionPoint\(placement\?\.insertIndex/);
  assert.match(source, /placement\?\.destinationGroupId/);
  assert.doesNotMatch(
    source.slice(
      source.indexOf("function scheduleGroupIdForDropPlacement("),
      source.indexOf("function queueDropPlacementWithStableContext("),
    ),
    /placement\?\.sectionIndex/,
  );
  assert.ok(
    (source.match(/resolveQueueDropInsertIndex\(placement\)/g) || []).length >= 4,
  );
  assert.match(source, /if \(!reordered\.changed && !membershipChanged\) return/);
  assert.match(css, /\.queue-item--section\.is-drop-target/);
  assert.match(css, /\.section-drag-handle/);
});

test("the emproj contract distinguishes top-level and legacy group membership", async () => {
  const architecture = await readFile(
    new URL("../docs/ems_architecture.md", import.meta.url),
    "utf8",
  );

  assert.match(architecture, /Every newly saved content cue includes `groupId`/);
  assert.match(architecture, /`null` means the cue is explicitly top-level/);
  assert.match(architecture, /omitted `groupId` is accepted only when opening legacy projects/);
});
