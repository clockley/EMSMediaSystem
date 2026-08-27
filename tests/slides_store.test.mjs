import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SlidesStore } from "../src/slides_store.mjs";

function deck(id, title = "Deck") {
  return {
    schema: "ems.slideDeck.v1",
    ...(id ? { id } : {}),
    title,
    canvas: { width: 1920, height: 1080 },
    pages: [{ id: "page_1", objects: [] }],
    pageSequence: ["page_1"],
  };
}

async function withStore(run) {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "ems-slides-store-"));
  try {
    await run(new SlidesStore({ userDataPath }), path.join(userDataPath, "decks"));
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
}

test("new decks receive generated IDs that are also used as filenames", async () => {
  await withStore(async (store, root) => {
    const saved = await store.save(deck("renderer_provisional_id"));
    assert.match(saved.id, /^deck_[0-9a-f]{32}$/);
    assert.equal((await store.get(saved.id)).title, "Deck");
    assert.deepEqual(await readdir(root), [`${saved.id}.ems-slide.json`]);
  });
});

test("different unsafe caller IDs cannot collide or overwrite decks", async () => {
  await withStore(async (store) => {
    const first = await store.save(deck("a/b", "First"));
    const second = await store.save(deck("a?b", "Second"));
    assert.notEqual(first.id, second.id);
    assert.equal((await store.get(first.id)).title, "First");
    assert.equal((await store.get(second.id)).title, "Second");
  });
});

test("legacy decks are looked up by exact embedded ID and migrate safely", async () => {
  await withStore(async (store, root) => {
    await mkdir(root, { recursive: true });
    const legacy = deck("a/b", "Legacy");
    const legacyPath = path.join(root, "a_b.ems-slide.json");
    await writeFile(legacyPath, JSON.stringify(legacy), "utf8");

    assert.equal((await store.get("a/b")).title, "Legacy");
    const saved = await store.save({ ...legacy, title: "Updated" });
    assert.equal(saved.id, "a/b");
    assert.equal((await store.get("a/b")).title, "Updated");

    const files = await readdir(root);
    assert.equal(files.length, 1);
    assert.match(files[0], /^deck_[0-9a-f]{32}\.ems-slide\.json$/);
    assert.equal(JSON.parse(await readFile(path.join(root, files[0]), "utf8")).id, "a/b");
  });
});

test("duplicate gets a distinct generated ID and remains independently addressable", async () => {
  await withStore(async (store) => {
    const original = await store.save(deck(null, "Original"));
    const copy = await store.duplicate(original.id);
    assert.match(copy.id, /^deck_[0-9a-f]{32}$/);
    assert.notEqual(copy.id, original.id);
    assert.equal((await store.get(copy.id)).title, "Original (Copy)");
  });
});
