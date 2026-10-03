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
  assert.match(renderer, /class="section-count"/);
  assert.match(renderer, /class="section-menu-btn"/);
  assert.match(renderer, /"Empty section"/);

  assert.match(css, /\.queue-item--section-child::before/);
  assert.match(css, /\.queue-item--section-child::after/);
  assert.match(css, /\.queue-item--section\.is-collapsed \.section-toggle-icon/);
  assert.match(css, /\.section-menu-btn:focus-visible/);
});

test("schedule section options are discoverable without a context click", async () => {
  const source = await readFile(
    new URL("../src/control-window/app-schedule-controller.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /data-queue-section-menu/);
  assert.match(source, /data-schedule-section-action="rename"/);
  assert.match(source, /data-schedule-section-action="toggle"/);
  assert.match(source, /data-schedule-section-action="remove"/);
  assert.match(source, /event\.key === "F2"/);
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
  assert.match(css, /\.queue-item--section\.is-drop-target/);
});
