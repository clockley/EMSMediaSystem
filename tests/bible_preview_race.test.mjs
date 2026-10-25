import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const bibleWorkspace = await readFile(
  new URL("../src/control-window/app-bible-workspace.mjs", import.meta.url),
  "utf8",
);
const presentationPlayback = await readFile(
  new URL("../src/control-window/app-presentation-playback.mjs", import.meta.url),
  "utf8",
);
const mediaRuntime = await readFile(
  new URL("../src/control-window/app-media-runtime.mjs", import.meta.url),
  "utf8",
);
const mediaWindow = await readFile(
  new URL("../src/media-window/media.mjs", import.meta.url),
  "utf8",
);

function functionSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return source.slice(start, end);
}

test("an obsolete scheduled Scripture lookup cannot repaint a newer preview", () => {
  const loadQueueItem = functionSource(
    presentationPlayback,
    "async function loadQueueItemIntoControlWindow",
    "async function playCurrentQueueItem",
  );
  const resolveIndex = loadQueueItem.indexOf("await resolvedBibleEntryForItem(item)");
  const ownershipIndex = loadQueueItem.indexOf(
    "if (!previewRequestStillOwnsMainSurface()) return",
    resolveIndex,
  );
  const applyIndex = loadQueueItem.indexOf("loadBibleEntryIntoEditor(bibleEntry", resolveIndex);

  assert.ok(resolveIndex >= 0, "the scheduled Scripture should be resolved asynchronously");
  assert.ok(
    ownershipIndex > resolveIndex && ownershipIndex < applyIndex,
    "the lookup must still own the preview before it can update the editor",
  );
  assert.match(
    loadQueueItem.slice(applyIndex, applyIndex + 180),
    /previewLoadToken:\s*loadToken/,
    "the editor must receive the same preview request token",
  );
});

test("an obsolete verse click cannot replace the current Scripture body", () => {
  const applySelection = functionSource(
    bibleWorkspace,
    "async function applySelectedBibleVersePreview",
    "async function refreshBibleLookupPreview",
  );
  const lookupIndex = applySelection.indexOf("await bibleEntryFromSelectedVerses()");
  const currentSelectionIndex = applySelection.indexOf(
    "bibleEntryMatchesCurrentVerseSelection(selectedEntry)",
  );
  const applyIndex = applySelection.indexOf("Object.assign(bibleDesignerState, selectedEntry)");

  assert.ok(lookupIndex >= 0, "the verse text should be loaded asynchronously");
  assert.ok(
    currentSelectionIndex > lookupIndex && currentSelectionIndex < applyIndex,
    "the selection must still be current before its reference and body are applied",
  );
});

test("an obsolete typed reference lookup cannot replace newer controls", () => {
  const refreshLookup = functionSource(
    bibleWorkspace,
    "async function refreshBibleLookupPreview",
    "async function currentBibleQueueEntry",
  );
  const lookupIndex = refreshLookup.indexOf("await lookupBibleReference(");
  const identityIndex = refreshLookup.indexOf(
    "bibleDesignerState.reference !== requestedReference",
  );
  const applyIndex = refreshLookup.indexOf("Object.assign(bibleDesignerState, result");

  assert.ok(lookupIndex >= 0, "the reference should be loaded asynchronously");
  assert.ok(
    identityIndex > lookupIndex && identityIndex < applyIndex,
    "the reference and version must still be current before lookup text is applied",
  );
});

test("audience Scripture updates require freshly resolved body text", () => {
  const sendToAudience = functionSource(
    bibleWorkspace,
    "async function sendBibleTextToOutput",
    "function isPresentationActiveForBibleLowerThird",
  );
  const resolveIndex = sendToAudience.indexOf(
    "bibleEntryWithLookupText(entry, { requireLookup: true })",
  );
  const rejectIndex = sendToAudience.indexOf(
    "if (!resolvedEntry || updateToken !== bibleAudienceOutputUpdateToken) return false",
  );
  const sendIndex = sendToAudience.indexOf('sendAudienceTextMessage("bible", message)');

  assert.ok(resolveIndex >= 0, "audience text should require a current Bible lookup");
  assert.ok(
    rejectIndex > resolveIndex && rejectIndex < sendIndex,
    "a failed lookup must leave the prior complete Scripture live",
  );
  assert.match(
    sendToAudience.slice(resolveIndex, sendIndex),
    /updateToken !== bibleAudienceOutputUpdateToken/,
    "only the newest concurrent audience lookup may be sent",
  );
});

test("Scripture slipstreams require fresh text before changing the audience window", () => {
  const slipstream = functionSource(
    bibleWorkspace,
    "async function slipstreamBiblePresentation",
    "async function syncLiveBiblePresentation",
  );
  const resolveIndex = slipstream.indexOf(
    "bibleEntryWithLookupText(entry, { requireLookup: true })",
  );
  const rejectIndex = slipstream.indexOf("if (!resolvedEntry) return false");
  const invokeIndex = slipstream.indexOf('invoke("slipstream-media-window"');

  assert.ok(resolveIndex >= 0, "the slipstream should require a current Bible lookup");
  assert.ok(
    rejectIndex > resolveIndex && rejectIndex < invokeIndex,
    "a failed lookup must not replace the audience window payload",
  );
  assert.match(slipstream, /activation\.reason !== "rejected"/);
  assert.match(slipstream, /return createMediaWindow\(\{/);
});

test("scheduled Scripture slipstreams reject fallback text", () => {
  const slipstream = functionSource(
    presentationPlayback,
    "async function slipstreamQueueItemAtIndex",
    "async function trySlipstreamNextQueueItem",
  );
  assert.match(
    slipstream,
    /resolvedBibleEntryForItem\(nextItem, \{ requireLookup: true \}\)/,
  );
  assert.match(slipstream, /if \(isBibleItem && !resolvedBibleEntry\) return false/);
  assert.match(
    slipstream,
    /scripturePresentation\.state\.takeRevision === scriptureTakeRevision/,
  );
  assert.match(
    slipstream,
    /confirmScriptureTake\(scriptureTakeRevision, \{\s*audience: scriptureAudienceStarted,\s*lowerThird: scriptureLowerThirdStarted,/,
  );
});

test("an acknowledged Scripture slipstream remains live after queue ownership loss", () => {
  const slipstream = functionSource(
    presentationPlayback,
    "async function slipstreamQueueItemAtIndex",
    "async function trySlipstreamNextQueueItem",
  );
  const activationIndex = slipstream.indexOf(
    "const slipstreamSuccess = slipstreamResult.ok === true",
  );
  const audienceStartedIndex = slipstream.indexOf(
    "scriptureAudienceStarted = true",
    activationIndex,
  );
  const ownershipIndex = slipstream.indexOf(
    "if (!audiencePlaybackCoordinator.owns(transitionToken)) return false",
    activationIndex,
  );

  assert.ok(activationIndex >= 0, "the slipstream activation should be acknowledged");
  assert.ok(
    audienceStartedIndex > activationIndex && audienceStartedIndex < ownershipIndex,
    "the audience must be recorded live before a lost queue token can return",
  );
});

test("Show Now exceptions settle owned takes and restore an unused queue selection", () => {
  const showNow = functionSource(
    bibleWorkspace,
    "async function showBibleTextNow",
    "async function slipstreamBiblePresentation",
  );
  assert.match(showNow, /let presentationRevision = null/);
  assert.match(showNow, /let audienceStarted = false/);
  assert.match(showNow, /let lowerThirdStarted = false/);
  assert.equal(
    (showNow.match(/onAudienceStarted:/g) || []).length,
    2,
    "both audience activation paths must report partial success before later bookkeeping",
  );
  assert.match(
    showNow,
    /scripturePresentation\.state\.takeRevision === presentationRevision/,
  );
  assert.match(
    showNow,
    /confirmScriptureTake\(presentationRevision, \{\s*audience: audienceStarted === true,\s*lowerThird: lowerThirdStarted === true,/,
  );
  assert.match(
    showNow,
    /!audienceStarted &&\s*!lowerThirdStarted[\s\S]*currentQueueIndex === -1[\s\S]*setSharedRendererState\(\{ currentQueueIndex: previousQueueIndex \}\)/,
  );
});

test("Show Now audience helpers report activation before fallible bookkeeping", () => {
  const bibleSlipstream = functionSource(
    bibleWorkspace,
    "async function slipstreamBiblePresentation",
    "async function syncLiveBiblePresentation",
  );
  const createWindow = functionSource(
    mediaRuntime,
    "async function createMediaWindow",
    "\nexport {",
  );
  assert.ok(
    bibleSlipstream.indexOf("options.onAudienceStarted?.") <
      bibleSlipstream.indexOf("setSharedRendererState({ activeMediaWindowContentType"),
    "slipstream activation must be reported before local state can throw",
  );
  assert.ok(
    createWindow.indexOf("options?.onAudienceStarted?.") <
      createWindow.indexOf("commitMediaWindowOutputState();"),
    "fresh-window activation must be reported before local state can throw",
  );
});

test("the audience renderer cannot let song blocks override Scripture body text", () => {
  const applyText = functionSource(
    mediaWindow,
    "function applyTextMessage",
    "function installTextHandlers",
  );
  assert.match(
    applyText,
    /safeMessage\.contentKind === "scripture"\s*\? ""\s*:\s*renderSongSectionHTML/,
  );
});

test("the renderer keeps no Bible metadata cache", () => {
  assert.doesNotMatch(bibleWorkspace, /bibleBookAbbreviationCache/);
  const displayName = functionSource(
    bibleWorkspace,
    "function bibleQueueItemDisplayName",
    "function isBiblePresentationActive",
  );
  assert.match(displayName, /bible\.bookAbbreviation/);
  assert.doesNotMatch(displayName, /getBookMetadata|new Map/);
});
