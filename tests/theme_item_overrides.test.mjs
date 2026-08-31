import test from "node:test";
import assert from "node:assert/strict";
import { itemThemeForRole, normalizeItemTheme, setItemThemeRole } from "../src/shared/theme-item-overrides.mjs";

const theme = {
  schema: "ems.theme.v1", id: "warm", name: "Warm", tokens: {}, profiles: {
    song: { audience: { typography: { fontSize: 64 } } }, scripture: {}, text: {},
  }, assets: [],
};

test("per-item theme roles retain independent style overrides", () => {
  const audience = setItemThemeRole(null, { theme, outputRole: "audience", profile: { typography: { fontSize: 72, color: "#ffeecc" } } });
  const both = setItemThemeRole(audience, { theme, outputRole: "lowerThird", profile: { typography: { fontSize: 48 } } });
  assert.equal(itemThemeForRole({ itemTheme: both }, "audience").itemOverrides.typography.fontSize, 72);
  assert.equal(itemThemeForRole({ itemTheme: both }, "lowerThird").itemOverrides.typography.fontSize, 48);
  assert.equal(both.snapshot.id, "warm");
});

test("changing an item's selected theme clears overrides from the previous theme", () => {
  const first = setItemThemeRole(null, { theme, profile: { typography: { fontSize: 80 } } });
  const next = setItemThemeRole(first, { theme: { ...theme, id: "cool", name: "Cool" } });
  assert.deepEqual(next.overrides, {});
  assert.equal(normalizeItemTheme(next).themeId, "cool");
  assert.equal(next.editorMaterialized, false);
});

test("normalization preserves the saved WYSIWYG materialization marker", () => {
  const selected = setItemThemeRole({
    schema: "ems.item-theme.v1",
    themeId: "warm",
    snapshot: theme,
    overrides: {},
    editorMaterialized: true,
  }, { theme });
  assert.equal(selected.editorMaterialized, true);
});
