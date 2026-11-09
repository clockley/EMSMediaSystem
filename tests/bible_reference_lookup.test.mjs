import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  normalizeScriptureReference,
  parseScriptureReference,
} from "../src/shared/app-bible-reference-utils.mjs";

const source = await readFile(
  new URL("../src/control-window/app-bible-workspace.mjs", import.meta.url),
  "utf8",
);

function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing source section: ${start}`);
  return source.slice(from, to);
}

const books = [
  { name: "Genesis", abbreviation: "Gen", testament: "OT", category: "Law", aliases: ["ge"] },
  { name: "Exodus", abbreviation: "Ex", testament: "OT", category: "Law" },
  { name: "Matthew", abbreviation: "Matt", testament: "NT", category: "Gospels", aliases: ["mat", "mt"] },
  { name: "Mark", abbreviation: "Mk", testament: "NT", category: "Gospels", aliases: ["mar"] },
  { name: "John", abbreviation: "Jn", testament: "NT", aliases: ["jhn"] },
  { name: "1 John", abbreviation: "1 Jn", testament: "NT" },
  { name: "Psalms", abbreviation: "Ps", testament: "OT" },
  { name: "Song of Solomon", abbreviation: "Song", testament: "OT" },
  { name: "Revelation", abbreviation: "Rev", testament: "NT" },
  { name: "Tobit", abbreviation: "Tob", testament: "OT" },
  { name: "Judith", abbreviation: "Jdt", testament: "OT" },
  { name: "4 Maccabees", abbreviation: "4 Mac", testament: "OT" },
];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

class Element {
  constructor() {
    this.children = [];
    this.hidden = true;
    this.value = "";
    this.style = {};
    this.dataset = {};
    this.attributes = {};
  }
  set innerHTML(_html) { this.children = []; }
  appendChild(child) {
    if (child.fragment) this.children.push(...child.children);
    else this.children.push(child);
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener() {}
}

function harness(overrides = {}) {
  const elements = new Map([
    ["bibleReferenceInput", new Element()],
    ["bibleReferenceSuggestions", new Element()],
    ["bibleReferenceToggle", new Element()],
    ["bibleVersionSelect", new Element()],
  ]);
  const versionSelect = elements.get("bibleVersionSelect");
  versionSelect.value = "KJV";
  versionSelect.options = ["KJV", "NKJV", "NIV"].map((value) => ({ value, textContent: value }));
  const api = {
    async getBookMetadata(version) { return { version, books }; },
    async resolveReference(version, reference) {
      return { version, reference, book: "John", chapter: 3, verse: 16 };
    },
    async suggestReferences(version, reference) { return suggestionResult(version, reference); },
    ...overrides,
  };
  const context = vm.createContext({
    bibleAPI: api,
    normalizeScriptureReference,
    parseScriptureReference,
    document: {
      getElementById: (id) => elements.get(id),
      createElement: () => new Element(),
      createDocumentFragment: () => Object.assign(new Element(), { fragment: true }),
    },
    positionBibleReferenceSuggestionsOverlay() {},
    updateBibleReferenceSuggestionActiveState() {},
  });
  vm.runInContext(`
    const DEFAULT_BIBLE_VERSION = "KJV";
    const bibleDesignerState = { version: "KJV" };
    const bibleVersionMetadataByKey = new Map();
    let bibleReferenceSuggestionIndex = -1;
    function normalizedProjectBibleVersion(version) { return version || "KJV"; }
    function bibleVersionValue(version) { return version; }
    function setSharedRendererState(patch) {
      bibleReferenceSuggestionIndex = patch.bibleReferenceSuggestionIndex;
    }
    ${section("const BIBLE_REFERENCE_VERSION_SUFFIX_MAX_WORDS", "async function firstBibleReferenceForVersion")}
    ${section("function hideBibleReferenceSuggestions()", "async function applyBibleReferenceSuggestion")}
    ${section("async function renderBibleReferenceSuggestions", "function isBibleReferenceSuggestionsOpen")}
    globalThis.state = bibleDesignerState;
  `, context);
  return {
    context,
    api,
    input: elements.get("bibleReferenceInput"),
    suggestions: elements.get("bibleReferenceSuggestions"),
    versionSelect,
  };
}

function suggestionResult(version, reference) {
  return { version, suggestions: [{ type: "reference", book: "John", reference }] };
}

test("API aliases, book-name typos and translation suffixes remain supported", async () => {
  const { context: c } = harness();
  for (const [input, expected] of [
    ["gnesis1:1", "Genesis 1:1"],
    ["song sol2:1", "Song of Solomon 2:1"],
    ["rev1:1", "Revelation 1:1"],
    ["tob2:1", "Tobit 2:1"],
    ["4mac1:1", "4 Maccabees 1:1"],
  ]) {
    assert.equal(await c.normalizeBibleReferenceQueryForLookup(input, "KJV"), expected);
  }
  for (const [input, reference, version] of [
    ["jn3:16 nkjv", "John 3:16", "NKJV"],
    ["ps23 niv", "Psalms 23", "NIV"],
  ]) {
    const result = await c.parseBibleReferenceLookupInput(input, { allowVersionSuffix: true });
    assert.equal(result.reference, reference);
    assert.equal(result.version, version);
    assert.equal(result.explicitVersion, true);
  }
});

test("space-separated chapter and verse work in lookups and realtime suggestions", async () => {
  const { context: c } = harness();
  for (const [input, expected] of [
    ["1 John 1 1", "1 John 1:1"],
    ["Ex 20 8", "Exodus 20:8"],
    ["  Ex   20   8  ", "Exodus 20:8"],
    ["1jn1 1", "1 John 1:1"],
    ["Ex 20 8-11", "Exodus 20:8-11"],
    ["4 Mac 1 1", "4 Maccabees 1:1"],
    ["1 John 1", "1 John 1"],
    ["Ex 20", "Exodus 20"],
  ]) {
    const resolved = await c.normalizeBibleReferenceInput(input, "KJV");
    assert.equal(resolved.reference, expected, input);
    const suggestions = await c.bibleReferenceSuggestionsForInput(input);
    assert.equal(suggestions[0].value, expected, input);
  }
  const parsed = await c.parseBibleReferenceLookupInput("Ex 20 8 nkjv", { allowVersionSuffix: true });
  assert.equal(parsed.reference, "Exodus 20:8");
  assert.equal(parsed.version, "NKJV");
});

test("testament/category metadata and non-string aliases are not book aliases", async () => {
  const { context: c } = harness();
  const lookup = await c.bibleBookLookupForVersion("KJV");
  for (const alias of ["ot", "nt", "law", "gospels"]) {
    assert.equal(lookup.aliasToBook.has(alias), false, alias);
  }
  assert.equal(await c.resolveCanonicalBibleBookName("NT", "KJV"), "");
  const aliases = c.collectBibleBookAliasStrings({ name: "John", aliases: [123, {}, "Jn"] });
  assert.equal(aliases.has("123"), false);
  assert.equal(aliases.has("[object Object]"), false);
  assert.equal(aliases.has("Jn"), true);
});

test("ambiguous API aliases and fuzzy ties never select the first book", async () => {
  const { context: c } = harness({
    async getBookMetadata(version) {
      return { version, books: books.map((book) => ({
        ...book,
        aliases: [...(book.aliases || []), ...(["Matthew", "Mark"].includes(book.name) ? ["ma"] : [])],
      })) };
    },
  });
  assert.equal(await c.resolveCanonicalBibleBookName("ma", "KJV"), "");
  assert.equal(await c.resolveCanonicalBibleBookName("matk", "KJV"), "");
  assert.equal(await c.resolveCanonicalBibleBookName("gnesis", "KJV"), "Genesis");
});

test("canonical names outrank another book's alias", async () => {
  const { context: c } = harness({
    async getBookMetadata(version) {
      return { version, books: [{ name: "Exodus", aliases: ["Genesis"] }, { name: "Genesis" }] };
    },
  });
  assert.equal(await c.resolveCanonicalBibleBookName("Genesis", "KJV"), "Genesis");
});

test("fuzzy matching preserves numbered books, including books beyond three", async () => {
  const { context: c } = harness();
  assert.equal(await c.resolveCanonicalBibleBookName("2 John", "KJV"), "");
  assert.equal(await c.resolveCanonicalBibleBookName("1 Jhon", "KJV"), "1 John");
  assert.equal(await c.resolveCanonicalBibleBookName("4 Maccabes", "KJV"), "4 Maccabees");
});

test("alias indexes contain only books from the requested translation", async () => {
  const { context: c } = harness({
    async getBookMetadata(version) {
      return { version, books: version === "NIV" ? [{ name: "John", abbreviation: "Jn" }] : books };
    },
  });
  assert.equal(await c.resolveCanonicalBibleBookName("Tobit", "KJV"), "Tobit");
  assert.equal(await c.resolveCanonicalBibleBookName("Tobit", "NIV"), "");
});

test("failed metadata requests are shared in flight but retried afterwards", async () => {
  for (const failure of ["throw", "error", "wrong-version", "malformed"]) {
    const first = deferred();
    let calls = 0;
    const { context: c } = harness({
      getBookMetadata(version) {
        calls += 1;
        return calls === 1 ? first.promise : Promise.resolve({ version, books });
      },
    });
    const a = c.bibleBookLookupForVersion("KJV");
    const b = c.bibleBookLookupForVersion("KJV");
    assert.equal(calls, 1);
    if (failure === "throw") first.reject(new Error("temporary failure"));
    else if (failure === "error") first.resolve({ error: "not ready" });
    else if (failure === "wrong-version") first.resolve({ version: "NIV", books });
    else first.resolve({ version: "KJV" });
    assert.equal(await a, null);
    assert.equal(await b, null);
    assert.ok((await c.bibleBookLookupForVersion("KJV")).aliasToBook.size > 0);
    assert.equal(calls, 2, failure);
    await c.bibleBookLookupForVersion("KJV");
    assert.equal(calls, 2, "successful metadata is cached");
  }
});

test("explicit translation suffix does not bypass source-version ownership", async () => {
  const response = deferred();
  const { context: c } = harness({ suggestReferences: () => response.promise });
  const request = c.bibleReferenceSuggestionsForInput("jn3:16 niv");
  await new Promise(setImmediate);
  c.state.version = "NKJV";
  response.resolve(suggestionResult("NIV", "John 3:16"));
  assert.equal((await request).length, 0);
});

test("newer suggestions win even when old replies arrive last", async () => {
  const pending = [];
  const { context: c, input, suggestions } = harness({
    suggestReferences(version, query) {
      const request = deferred();
      pending.push({ ...request, version, query });
      return request.promise;
    },
  });
  input.value = "jn3:16";
  const old = c.renderBibleReferenceSuggestions();
  await new Promise(setImmediate);
  input.value = "ex1:1";
  const latest = c.renderBibleReferenceSuggestions();
  await new Promise(setImmediate);
  pending[1].resolve(suggestionResult("KJV", "Exodus 1:1"));
  await latest;
  assert.equal(suggestions.children[0].dataset.referenceValue, "Exodus 1:1");
  pending[0].resolve(suggestionResult("KJV", "John 3:16"));
  await old;
  assert.equal(suggestions.children[0].dataset.referenceValue, "Exodus 1:1");
});

test("a new request immediately removes selectable obsolete rows", async () => {
  const { context: c, input, suggestions, api } = harness();
  input.value = "jn3:16";
  await c.renderBibleReferenceSuggestions();
  assert.equal(suggestions.hidden, false);
  const response = deferred();
  api.suggestReferences = () => response.promise;
  input.value = "ex1:1";
  const request = c.renderBibleReferenceSuggestions();
  assert.equal(suggestions.hidden, true);
  assert.equal(suggestions.children.length, 0);
  await new Promise(setImmediate);
  response.resolve(suggestionResult("KJV", "Exodus 1:1"));
  await request;
});

test("dismissal, changed input, and changed translations prevent late rendering", async () => {
  for (const change of ["dismiss", "input", "state-version", "control-version"]) {
    const response = deferred();
    const { context: c, input, suggestions, versionSelect } = harness({
      suggestReferences: () => response.promise,
    });
    input.value = "jn3:16 niv";
    const request = c.renderBibleReferenceSuggestions();
    await new Promise(setImmediate);
    if (change === "dismiss") c.hideBibleReferenceSuggestions();
    else if (change === "input") input.value = "";
    else if (change === "state-version") c.state.version = "NKJV";
    else versionSelect.value = "NKJV";
    response.resolve(suggestionResult("NIV", "John 3:16"));
    await request;
    assert.equal(suggestions.hidden, true, change);
    assert.equal(suggestions.children.length, 0, change);
  }
});

test("an obsolete empty reply cannot hide newer suggestions", async () => {
  const oldResponse = deferred();
  let calls = 0;
  const { context: c, input, suggestions } = harness({
    suggestReferences(version, query) {
      calls += 1;
      return calls === 1 ? oldResponse.promise : Promise.resolve(suggestionResult(version, query));
    },
  });
  input.value = "jn3:16";
  const old = c.renderBibleReferenceSuggestions();
  await new Promise(setImmediate);
  input.value = "ex1:1";
  await c.renderBibleReferenceSuggestions();
  oldResponse.resolve({ version: "KJV", suggestions: [] });
  await old;
  assert.equal(suggestions.hidden, false);
  assert.equal(suggestions.children[0].dataset.referenceValue, "Exodus 1:1");
});

test("show-all metadata responses also respect dismissal", async () => {
  const metadata = deferred();
  const { context: c, suggestions } = harness({ getBookMetadata: () => metadata.promise });
  const request = c.renderBibleReferenceSuggestions({ showAll: true });
  c.hideBibleReferenceSuggestions();
  metadata.resolve({ version: "KJV", books });
  await request;
  assert.equal(suggestions.hidden, true);
  assert.equal(suggestions.children.length, 0);
});