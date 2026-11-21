import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { adjacentBibleVerseEntry } from "../src/shared/bible-verse-navigation.mjs";
import { parseScriptureReference } from "../src/shared/app-bible-reference-utils.mjs";

const books = [
  { name: "Genesis", abbreviation: "Gen", chapters: 2 },
  { name: "Empty", chapters: 0 },
  { name: "Tobit", abbreviation: "Tob", chapters: 1 },
  { name: "4 Maccabees", abbreviation: "4 Mac", chapters: 1 },
];
const chapters = {
  "Genesis 1": [1, 2, 4],
  "Genesis 2": [1, 2],
  "Tobit 1": [1, 2],
  "4 Maccabees 1": [1, 2],
};
function apiFixture() {
  return {
    async getBookMetadata(version) { return { version, books }; },
    async getText(version, book, chapter) {
      return {
        attribution: { abbreviation: version },
        verseRows: (chapters[`${book} ${chapter}`] || []).map((verseNumber) => ({
          verseNumber, text: `${book} ${chapter}:${verseNumber} text`,
        })),
      };
    },
  };
}
function entry(book = "Genesis", chapter = 1, verse = 1, extra = {}) {
  return { version: "TEST", book, chapter, verse, verseEnd: 0,
    reference: `${book} ${chapter}:${verse}`, selectedVerses: [verse], ...extra };
}
function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

test("adjacent verses skip omitted verse numbers in both directions", async () => {
  const next = await adjacentBibleVerseEntry(entry("Genesis", 1, 2), 1, apiFixture());
  assert.equal(next.reference, "Genesis 1:4");
  assert.equal(next.text, "Genesis 1:4 text");
  assert.deepEqual(next.selectedVerses, [4]);
  assert.equal(next.verseEnd, 0);
  const previous = await adjacentBibleVerseEntry(next, -1, apiFixture());
  assert.equal(previous.reference, "Genesis 1:2");
});

test("ranges advance beyond the last verse and go back before the first", async () => {
  const range = entry("Genesis", 1, 2, { verseEnd: 4, selectedVerses: [4, 2] });
  assert.equal((await adjacentBibleVerseEntry(range, 1, apiFixture())).reference, "Genesis 2:1");
  assert.equal((await adjacentBibleVerseEntry(range, -1, apiFixture())).reference, "Genesis 1:1");
  const legacyRange = { ...range, selectedVerses: [] };
  assert.equal((await adjacentBibleVerseEntry(legacyRange, 1, apiFixture())).reference, "Genesis 2:1");
});

test("navigation crosses chapters and follows the translation's book order", async () => {
  const api = apiFixture();
  assert.equal((await adjacentBibleVerseEntry(entry("Genesis", 1, 4), 1, api)).reference, "Genesis 2:1");
  assert.equal((await adjacentBibleVerseEntry(entry("Genesis", 2, 1), -1, api)).reference, "Genesis 1:4");
  assert.equal((await adjacentBibleVerseEntry(entry("Genesis", 2, 2), 1, api)).reference, "Tobit 1:1");
  assert.equal((await adjacentBibleVerseEntry(entry("Tobit", 1, 1), -1, api)).reference, "Genesis 2:2");
  assert.equal((await adjacentBibleVerseEntry(entry("Tobit", 1, 2), 1, api)).reference, "4 Maccabees 1:1");
});

test("navigation stops at Bible boundaries without wrapping", async () => {
  assert.equal(await adjacentBibleVerseEntry(entry(), -1, apiFixture()), null);
  assert.equal(await adjacentBibleVerseEntry(entry("4 Maccabees", 1, 2), 1, apiFixture()), null);
});

test("chapter-only input navigates from chapter boundaries", async () => {
  const chapter = entry("Genesis", 2, 0, { selectedVerses: [], reference: "Genesis 2" });
  assert.equal((await adjacentBibleVerseEntry(chapter, 1, apiFixture())).reference, "Genesis 2:1");
  assert.equal((await adjacentBibleVerseEntry(chapter, -1, apiFixture())).reference, "Genesis 1:4");
});

test("empty chapters are skipped but API errors are not mistaken for boundaries", async () => {
  const api = apiFixture();
  const original = api.getText;
  api.getText = (version, book, chapter) => book === "Genesis" && chapter === "2"
    ? Promise.resolve({ verseRows: [] }) : original(version, book, chapter);
  assert.equal((await adjacentBibleVerseEntry(entry("Genesis", 1, 4), 1, api)).reference, "Tobit 1:1");
  api.getText = async () => ({ error: "Offline" });
  await assert.rejects(adjacentBibleVerseEntry(entry(), 1, api), /Offline/);
  api.getBookMetadata = async () => ({ version: "WRONG", books });
  await assert.rejects(adjacentBibleVerseEntry(entry(), 1, api), /Could not load Bible books/);
});

test("the resolver checks ownership after asynchronous metadata and text loads", async () => {
  for (const method of ["getBookMetadata", "getText"]) {
    let current = true;
    const api = apiFixture();
    const original = api[method];
    api[method] = async (...args) => { current = false; return original(...args); };
    assert.equal(await adjacentBibleVerseEntry(entry(), 1, api, () => current), null);
  }
});

const workspace = await readFile(new URL("../src/control-window/app-bible-workspace.mjs", import.meta.url), "utf8");
const navigationCode = workspace.slice(
  workspace.indexOf("function cancelBibleVerseNavigation()"),
  workspace.indexOf("async function nextBibleVerseEntryFromDesigner()"),
);

function navigationHarness({ follow = false, live = false, api = apiFixture(), render = async () => {}, take = async () => {} } = {}) {
  const state = entry();
  const elements = new Map([
    ["bibleReferenceInput", { value: state.reference }],
    ["bibleVersionSelect", { value: state.version }],
    ["bibleVerseFollowLive", { checked: follow }],
    ["biblePreviousVerseBtn", {}], ["bibleNextVerseBtn", {}],
    ["bibleVerseNavigationMode", {}],
    ["bibleVerseNavigation", { setAttribute() {} }],
  ]);
  const previews = [];
  const takes = [];
  const toasts = [];
  let selected = [1];
  const context = vm.createContext({
    bibleDesignerState: state,
    document: { getElementById: (id) => elements.get(id) },
    adjacentBibleVerseEntry,
    bibleAPI: api,
    selectedBibleVerseNumbers: () => selected,
    cancelBibleVersePreviewSync() {},
    hideBibleReferenceSuggestions() {},
    async normalizeBibleReferenceInput(input, version) {
      const parsed = parseScriptureReference(input);
      return { ...parsed, version, reference: input, selectedVerses: [], verseEnd: parsed.verseEnd || 0 };
    },
    setBibleDesignerVersion(version) { state.version = version; },
    setBibleVerseSelectionFromEntry(next) { selected = [...next.selectedVerses]; },
    setBibleNavigatorMode() {},
    syncBibleSelectorsFromState() {
      elements.get("bibleReferenceInput").value = state.reference;
      elements.get("bibleVersionSelect").value = state.version;
    },
    getBibleDesignerStyle: () => ({}),
    renderBibleVerseList: render,
    applyBiblePreview(value, options) { previews.push({ reference: value.reference, options }); },
    scrollBibleViewerToCurrentVerse() {},
    isScripturePresentationLive: () => live,
    async performShowBibleTextNow({ isCurrent = () => true } = {}) {
      await take();
      if (!isCurrent()) return false;
      takes.push(state.reference);
      return true;
    },
    showGnomeToast(message) { toasts.push(message); },
  });
  vm.runInContext(`
    let bibleVerseNavigationTail = Promise.resolve();
    let bibleVerseNavigationEpoch = 0;
    let bibleVerseNavigationPending = 0;
    let bibleVerseNavigationBoundary = null;
    ${navigationCode}
  `, context);
  return { context, state, elements, previews, takes, toasts };
}

test("rapid navigation clicks execute in order rather than losing steps", async () => {
  const { context: c, state, previews, takes } = navigationHarness({ live: true });
  assert.deepEqual(await Promise.all([c.navigateBibleVerse(1), c.navigateBibleVerse(1), c.navigateBibleVerse(1)]), [true, true, true]);
  assert.equal(state.reference, "Genesis 2:1");
  assert.deepEqual(previews.map((value) => value.reference), ["Genesis 1:2", "Genesis 1:4", "Genesis 2:1"]);
  assert.deepEqual(takes, [], "preview-only must not touch an existing live output");
});

test("Follow Live takes each step only when Scripture is already live", async () => {
  for (const live of [false, true]) {
    const { context: c, takes } = navigationHarness({ follow: true, live });
    await Promise.all([c.navigateBibleVerse(1), c.navigateBibleVerse(1)]);
    assert.deepEqual(takes, live ? ["Genesis 1:2", "Genesis 1:4"] : []);
  }
});

test("manual input changes cancel an in-flight lookup and all queued steps", async () => {
  const text = deferred();
  const api = apiFixture();
  api.getText = () => text.promise;
  const { context: c, elements, state, previews } = navigationHarness({ api });
  const first = c.navigateBibleVerse(1);
  const second = c.navigateBibleVerse(1);
  await new Promise(setImmediate);
  elements.get("bibleReferenceInput").value = "Tobit 1:1";
  text.resolve({ verseRows: [{ verseNumber: 2, text: "Old text" }] });
  assert.equal(await first, false);
  assert.equal(await second, false);
  assert.equal(state.reference, "Genesis 1:1");
  assert.deepEqual(previews, []);
});

test("a cancelled request cannot cancel navigation in a newer epoch", async () => {
  const text = deferred();
  const api = apiFixture();
  const original = api.getText;
  let calls = 0;
  api.getText = (...args) => ++calls === 1 ? text.promise : original(...args);
  const { context: c, state } = navigationHarness({ api });
  const old = c.navigateBibleVerse(1);
  await new Promise(setImmediate);
  c.cancelBibleVerseNavigation();
  const latest = c.navigateBibleVerse(1);
  text.resolve({ verseRows: [{ verseNumber: 2, text: "Old text" }] });
  assert.equal(await old, false);
  assert.equal(await latest, true);
  assert.equal(state.reference, "Genesis 1:2");
});

test("selection changes during chapter rendering prevent preview and live updates", async () => {
  const rendered = deferred();
  const { context: c, elements, previews, takes } = navigationHarness({
    follow: true, live: true, render: () => rendered.promise,
  });
  const request = c.navigateBibleVerse(1);
  const queued = c.navigateBibleVerse(1);
  await new Promise(setImmediate);
  elements.get("bibleVersionSelect").value = "OTHER";
  rendered.resolve();
  assert.equal(await request, false);
  assert.equal(await queued, false);
  assert.deepEqual(previews, []);
  assert.deepEqual(takes, []);
});

test("turning Follow Live off cancels a preparing take and queued steps", async () => {
  const taking = deferred();
  const { context: c, elements, takes } = navigationHarness({
    follow: true, live: true, take: () => taking.promise,
  });
  const request = c.navigateBibleVerse(1);
  const queued = c.navigateBibleVerse(1);
  await new Promise(setImmediate);
  elements.get("bibleVerseFollowLive").checked = false;
  c.cancelBibleVerseNavigation();
  taking.resolve();
  await request;
  assert.equal(await queued, false);
  assert.deepEqual(takes, []);
});

test("Show Now's navigation guard is checked after text resolution, before any output take", async () => {
  const text = deferred();
  let current = true;
  const context = vm.createContext({ currentBibleTextOnlyEntry: () => text.promise });
  vm.runInContext(workspace.slice(
    workspace.indexOf("async function performShowBibleTextNow("),
    workspace.indexOf("async function slipstreamBiblePresentation("),
  ), context);
  const request = context.performShowBibleTextNow({ isCurrent: () => current });
  current = false;
  text.resolve({ bible: entry() });
  assert.equal(await request, false);
});

test("boundary buttons disable and API errors leave navigation retryable", async () => {
  const { context: c, elements, toasts } = navigationHarness();
  assert.equal(await c.navigateBibleVerse(-1), false);
  assert.equal(elements.get("biblePreviousVerseBtn").disabled, true);
  assert.equal(elements.get("bibleNextVerseBtn").disabled, false);
  assert.deepEqual(toasts, ["Beginning of Bible"]);
  c.cancelBibleVerseNavigation();
  assert.equal(elements.get("biblePreviousVerseBtn").disabled, false,
    "manual selection changes clear the old boundary immediately");
  const api = apiFixture();
  api.getText = async () => { throw new Error("Temporary failure"); };
  const retryable = navigationHarness({ api });
  assert.equal(await retryable.context.navigateBibleVerse(1), false);
  assert.equal(retryable.elements.get("bibleNextVerseBtn").disabled, false);
  api.getText = apiFixture().getText;
  assert.equal(await retryable.context.navigateBibleVerse(1), true);
});

test("verse controls expose accessible symbolic actions and a default-off switch", async () => {
  const template = await readFile(new URL("../src/shared/app-ui-templates.mjs", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/main.css", import.meta.url), "utf8");
  assert.match(template, /id="biblePreviousVerseBtn"[^>]*aria-label="Previous verse"/);
  assert.match(template, /id="bibleNextVerseBtn"[^>]*aria-label="Next verse"/);
  assert.match(template, /id="bibleVerseNavigationMode" role="status">Preview only/);
  const input = template.match(/<input[^>]*id="bibleVerseFollowLive"[^>]*>/)?.[0];
  assert.ok(input);
  assert.match(input, /role="switch"/);
  assert.doesNotMatch(input, /\bchecked\b/);
  assert.match(css, /\.bible-verse-navigation__buttons button:focus-visible/);
});