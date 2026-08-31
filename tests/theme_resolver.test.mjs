import assert from "node:assert/strict";
import test from "node:test";
import { EMS_SAFE_DEFAULT_THEME, resolveThemeForTarget, themeRevision } from "../src/shared/theme-resolver.mjs";
import { validateTheme } from "../src/shared/theme-normalize.mjs";
import { legacyStyleToThemeOverrides } from "../src/shared/theme-legacy-adapter.mjs";
import { createProjectThemeSnapshot, resolveProjectTheme } from "../src/shared/theme-project.mjs";
import { lowerThirdThemeFieldsFromStyle } from "../src/shared/lower-third-theme.mjs";
import {
  messageFromResolvedPresentation,
  resolvedAudienceBackgroundFields,
  resolvedFontFamilyFields,
} from "../src/shared/theme-render-message.mjs";

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
  assert.equal(
    themeRevision({ ...theme, assets: [{ id: "photo", assetUrl: "file:///first/photo.png" }] }),
    themeRevision({ ...theme, assets: [{ id: "photo", assetUrl: "file:///second/photo.png" }] }),
  );
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

test("lower-third compatibility enrichment preserves an explicit editor font", () => {
  const resolvedTheme = resolveThemeForTarget({
    theme,
    contentKind: "scripture",
    outputRole: "lowerThird",
  });
  const fields = lowerThirdThemeFieldsFromStyle({
    resolvedTheme,
    fontFamily: "Audience Sans",
    lowerThirdFontFamily: "Lower Third Sans",
    lowerThirdFontFamilyOverride: true,
  });
  assert.equal(fields.lowerThirdFontFamily, "Lower Third Sans");
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
  assert.equal(fields.lowerThirdBackingPlateEnabled, false);
});

test("legacy lower-third no-backing state does not get forced back on", () => {
  const fields = lowerThirdThemeFieldsFromStyle({
    lowerThirdBarBackgroundColor: "transparent",
    lowerThirdBarBackgroundPath: "stale-plate.png",
    lowerThirdBackingPlateEnabled: false,
  });
  const overrides = legacyStyleToThemeOverrides({
    lowerThirdBarBackgroundColor: "transparent",
    lowerThirdBarBackgroundPath: "stale-plate.png",
    lowerThirdBackingPlateEnabled: false,
  }, "lowerThird");

  assert.equal(fields.lowerThirdBackingPlateEnabled, false);
  assert.equal(fields.lowerThirdBarBackgroundColor, "transparent");
  assert.equal(fields.lowerThirdBarBackgroundPath, "");
  assert.equal(overrides.backdrop.enabled, false);
});

test("audience theme graphics resolve managed assets and allow per-item replacement", () => {
  const graphicTheme = {
    ...theme,
    assets: [{
      id: "background_photo",
      type: "image",
      path: "assets/background.png",
      assetUrl: "file:///managed/background.png",
    }],
    profiles: {
      ...theme.profiles,
      song: {
        ...theme.profiles.song,
        audience: {
          canvas: {
            background: {
              type: "image",
              color: "#000000",
              assetId: "background_photo",
              path: "assets/background.png",
            },
          },
        },
      },
    },
  };
  const themed = resolveThemeForTarget({
    theme: graphicTheme,
    contentKind: "song",
    outputRole: "audience",
  });
  const overridden = resolveThemeForTarget({
    theme: graphicTheme,
    contentKind: "song",
    outputRole: "audience",
    itemOverrides: {
      canvas: {
        background: {
          type: "image",
          color: "#000000",
          assetId: null,
          path: "/project/item-background.jpg",
        },
      },
    },
  });

  assert.equal(themed.canvas.background.assetUrl, "file:///managed/background.png");
  assert.equal(overridden.canvas.background.path, "/project/item-background.jpg");
  assert.equal(overridden.canvas.background.assetUrl, undefined);

  const themeFields = resolvedAudienceBackgroundFields({}, themed);
  const itemFields = resolvedAudienceBackgroundFields({
    backgroundColor: "#111111",
    backgroundPath: "/project/item-background.jpg",
    backgroundImage: "file:///project/item-background.jpg",
    resolvedTheme: themed,
  }, themed);
  assert.equal(themeFields.backgroundImage, "file:///managed/background.png");
  assert.equal(itemFields.backgroundImage, "file:///project/item-background.jpg");
  assert.equal(itemFields.backgroundPath, "/project/item-background.jpg");
});

test("an editor font overrides the theme only when marked as a local override", () => {
  const resolved = { typography: { fontFamily: "Theme Sans" } };
  assert.deepEqual(
    resolvedFontFamilyFields({ fontFamily: "Editor Sans", fontFamilyOverride: true }, resolved),
    { fontFamily: "Editor Sans" },
  );
  assert.deepEqual(
    resolvedFontFamilyFields({ fontFamily: "Editor Sans" }, resolved),
    { fontFamily: "Theme Sans" },
  );
  assert.deepEqual(
    resolvedFontFamilyFields({
      fontFamily: "Body Sans",
      lowerThirdFontFamily: "Lower Sans",
      lowerThirdFontFamilyOverride: true,
    }, resolved, { lowerThird: true }),
    { fontFamily: "Lower Sans", lowerThirdFontFamily: "Lower Sans" },
  );
});

test("resolved lower-third messages retain the editor font override", () => {
  const resolvedTheme = { typography: { fontFamily: "Theme Sans" } };
  const message = messageFromResolvedPresentation({
    target: { outputRole: "lowerThird" },
    activeSlide: { bodyText: "Lower third" },
    resolvedTheme,
  }, {
    style: {
      fontFamily: "Body Sans",
      lowerThirdFontFamily: "Lower Sans",
      lowerThirdFontFamilyOverride: true,
    },
    resolvedTheme,
  });
  assert.equal(message.fontFamily, "Lower Sans");
  assert.equal(message.fontFamilyOverride, true);
});
