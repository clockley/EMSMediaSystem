import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Cue / Next owns the scrubber while Live remains a read-only readout", async () => {
  const [source, template, css] = await Promise.all([
    readFile(new URL("../src/control-window/app-operator-chrome.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/app-ui-templates.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /Cue \/ Next \$\{concisePosition\(cueCurrent\)\}/);
  assert.match(source, /timeline\.setAttribute\?\.\("aria-label", separateCue \? "Seek cued or next item"/);
  assert.match(source, /isQueueItemAudio\(liveItem\) \|\| isQueueItemVideo\(liveItem\)/);
  assert.match(source, /livePositionLabel\.hidden = !showTimedLiveReadout/);
  assert.match(template, /Live timing is read-only/);
  assert.match(css, /transport-timeline-shell\[data-mode="cue"\]/);
  assert.doesNotMatch(template, /cueTimelineMarker|liveTimelineMarker/);
  assert.doesNotMatch(css, /transport-position-marker/);
});
