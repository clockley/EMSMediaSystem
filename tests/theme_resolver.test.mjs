import assert from "node:assert/strict";
import test from "node:test";
import { EMS_SAFE_DEFAULT_THEME, resolveThemeForTarget, themeRevision } from "../src/theme-resolver.mjs";
import { validateTheme } from "../src/theme-normalize.mjs";
import { legacyStyleToThemeOverrides } from "../src/theme-legacy-adapter.mjs";
import { createProjectThemeSnapshot, resolveProjectTheme } from "../src/theme-project.mjs";
import { lowerThirdThemeFieldsFromStyle } from "../src/lower-third-theme.mjs";

const theme = { schema: "ems.theme.v1", id: "test", name: "Test", tokens: { fontFamily: "Inter", textColor: "#eeeeee" }, profiles: { song: { audience: { typography: { fontSize: 70 } } }, scripture: {}, text: {} }, assets: [] };

test("safe default resolves all six targets", () => {
  for (const contentKind of ["song", "scripture", "text"]) for (const outputRole of ["audience", "lowerThird"]) {
    const resolved = resolveThemeForTarget({ contentKind, outputRole });
    assert.equal(resolved.themeId, EMS_SAFE_DEFAULT_THEME.id); assert.ok(resolved.typography.fontSize); assert.ok(Object.isFrozen(resolved.typography));
  }
});

test("resolution applies documented precedence and null clearing", () => {
  const resolved = resolveThemeForTarget({ theme, contentKind: "song", outputRole: "audience", projectOverrides: { typography: { fontSize: 72, fontStyle: "italic" } }, itemOverrides: { typography: { fontSize: 74 } }, objectOverrides: { typography: { fontSize: 76 } }, liveOverrides: { typography: { fontSize: 78 }, reference: null } });
  assert.equal(resolved.typography.fontFamily, "Inter"); assert.equal(resolved.typography.fontSize, 78); assert.equal(resolved.typography.fontStyle, "italic"); assert.equal(resolved.reference, null);
});

test("base inheritance detects cycles", () => {
  const a = { ...theme, id: "a", baseThemeId: "b" }; const b = { ...theme, id: "b", baseThemeId: "a" };
  assert.throws(() => resolveThemeForTarget({ theme: a, contentKind: "text", outputRole: "audience", getThemeById: id => id === "a" ? a : b }), /cycle/i);
});

test("validation, stable revisions, legacy mapping, and embedded snapshots", () => {
  assert.equal(validateTheme(theme).valid, true); assert.equal(themeRevision(theme), themeRevision({ ...theme }));
  assert.equal(legacyStyleToThemeOverrides({ lowerThirdFontSize: 44 }, "lowerThird").typography.fontSize, 44);
  const packaged = createProjectThemeSnapshot([theme], { song: "test" });
  const embedded = resolveProjectTheme(packaged, "test", { ...theme, name: "Changed" });
  assert.equal(embedded.name, "Test");
});

test("lower-third compatibility utility accepts resolved themes", () => {
  const resolvedTheme = resolveThemeForTarget({ theme, contentKind: "scripture", outputRole: "lowerThird" });
  const fields = lowerThirdThemeFieldsFromStyle({ resolvedTheme });
  assert.equal(fields.lowerThirdFontFamily, "Inter");
  assert.equal(fields.lowerThirdChromaKeyColor, "#00ff00");
});

test("lower-third compatibility utility honors a disabled backing plate", () => {
  const disabledTheme = {
    ...theme,
    profiles: {
      ...theme.profiles,
      song: {
        ...theme.profiles.song,
        lowerThird: {
          backdrop: {
            enabled: false,
            background: { type: "image", color: "#123456", path: "plate.png" },
          },
        },
      },
    },
  };
  const resolvedTheme = resolveThemeForTarget({
    theme: disabledTheme,
    contentKind: "song",
    outputRole: "lowerThird",
  });
  const fields = lowerThirdThemeFieldsFromStyle({ resolvedTheme });

  assert.equal(fields.lowerThirdBarBackgroundColor, "transparent");
  assert.equal(fields.lowerThirdBarBackgroundPath, "");
});
