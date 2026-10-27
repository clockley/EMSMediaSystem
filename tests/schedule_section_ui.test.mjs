import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_SCHEDULE_GROUP_NAME,
  scheduleSectionIndexesForItems,
  synchronizeScheduleGroupMembership,
  ungroupScheduleSectionMembers,
} from "../src/shared/schedule-item-availability.mjs";

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
  assert.match(renderer, /"Empty group"/);
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
  assert.match(source, /title: "Add Group"/);
  assert.match(source, /title: "Rename Group"/);
  assert.match(source, />Remove Group<\/button>/);
  assert.match(source, /Move out of group/);
});

test("schedule group wording is user-facing while section identifiers stay internal", async () => {
  const template = await readFile(
    new URL("../src/shared/app-ui-templates.mjs", import.meta.url),
    "utf8",
  );
  const source = await readFile(
    new URL("../src/control-window/app-schedule-controller.mjs", import.meta.url),
    "utf8",
  );

  assert.match(template, /aria-label="Add schedule group"/);
  assert.match(template, /<span>Group<\/span>/);
  assert.match(source, /const DEFAULT_SCHEDULE_SECTION_NAME = DEFAULT_SCHEDULE_GROUP_NAME/);
  assert.match(source, /function createScheduleSectionEntry/);
  assert.match(source, /type: "section"/);
  assert.match(source, /data-queue-section-toggle/);
});

test("default group name has a single shared definition", async () => {
  assert.equal(DEFAULT_SCHEDULE_GROUP_NAME, "New Group");
  const files = [
    "../src/control-window/app-schedule-controller.mjs",
    "../src/control-window/app-project-session.mjs",
    "../src/main-process/emproj.mjs",
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /DEFAULT_SCHEDULE_GROUP_NAME/, file);
    assert.doesNotMatch(source, /"New (Group|Section)"/, file);
  }
});

function groupRemovalFixture() {
  return [
    { id: "cue-top", type: "media", groupId: null },
    { id: "section-a", type: "section", name: "A" },
    { id: "cue-a1", type: "media", groupId: "section-a" },
    { id: "section-b", type: "section", name: "B" },
    { id: "cue-b1", type: "media", groupId: "section-b" },
    // Belongs to B only by position (e.g. a split Bible cue without groupId).
    { id: "cue-b2", type: "bible" },
    { id: "section-c", type: "section", name: "C" },
    { id: "cue-c1", type: "media", groupId: "section-c" },
  ];
}

function removeSection(items, sectionId) {
  const index = items.findIndex((item) => item.id === sectionId);
  const detached = ungroupScheduleSectionMembers(items, index);
  items.splice(index, 1);
  synchronizeScheduleGroupMembership(items, { preserveExisting: true });
  return detached;
}

test("removing a group keeps its cues as top-level items", () => {
  const items = groupRemovalFixture();
  const detached = removeSection(items, "section-b");

  assert.equal(detached, 2);
  assert.deepEqual(
    items.map((item) => item.id),
    ["cue-top", "section-a", "cue-a1", "cue-b1", "cue-b2", "section-c", "cue-c1"],
  );
  const byId = new Map(items.map((item) => [item.id, item]));
  // Former members are explicitly top-level, not re-adopted by group A.
  assert.equal(byId.get("cue-b1").groupId, null);
  assert.equal(byId.get("cue-b2").groupId, null);
  // Other groups are untouched.
  assert.equal(byId.get("cue-a1").groupId, "section-a");
  assert.equal(byId.get("cue-c1").groupId, "section-c");

  const sectionIndexes = scheduleSectionIndexesForItems(items);
  assert.equal(sectionIndexes[items.indexOf(byId.get("cue-b1"))], -1);
  assert.equal(sectionIndexes[items.indexOf(byId.get("cue-b2"))], -1);
});

test("removed group's cues stay top-level after a positional resync", () => {
  const items = groupRemovalFixture();
  removeSection(items, "section-b");
  // Simulate save/reload normalization of the explicit membership.
  const reloaded = items.map((item) => ({ ...item }));
  synchronizeScheduleGroupMembership(reloaded, { preserveExisting: true });
  const byId = new Map(reloaded.map((item) => [item.id, item]));
  assert.equal(byId.get("cue-b1").groupId, null);
  assert.equal(byId.get("cue-b2").groupId, null);
  assert.equal(byId.get("cue-a1").groupId, "section-a");
});

test("ungrouping ignores non-section indexes", () => {
  const items = groupRemovalFixture();
  assert.equal(ungroupScheduleSectionMembers(items, 2), 0);
  assert.equal(ungroupScheduleSectionMembers(items, -1), 0);
  assert.equal(ungroupScheduleSectionMembers(items, items.length), 0);
  assert.equal(items[2].groupId, "section-a");
});

test("Remove Group explains that items are kept", async () => {
  const source = await readFile(
    new URL("../src/control-window/app-schedule-controller.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /title="Remove the group and keep its items in the schedule">Remove Group</);
  assert.match(source, /ungroupScheduleSectionMembers\(mediaQueue, index\)/);
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
