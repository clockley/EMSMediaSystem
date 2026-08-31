import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mediaHtmlPath = new URL("../src/media.html", import.meta.url);
const mediaModulePath = new URL("../src/media.mjs", import.meta.url);

test("lower-third chroma text is alpha-hardened and outlined before compositing", async () => {
  const html = await readFile(mediaHtmlPath, "utf8");

  assert.match(html, /chroma-edge-no-plate\.scripture-render--lower-third[^\{]+scripture-render__body/);
  assert.match(html, /chroma-edge-opaque-plate\.scripture-render--lower-third[^\{]+scripture-render__box/);
  assert.match(html, /filter: url\(#ems-chroma-text-edge\)/);
  assert.match(html, /<feComponentTransfer in="SourceGraphic" result="hardened-text">/);
  assert.match(
    html,
    /tableValues="0 0 \.042 \.084 \.152 \.232 \.312 \.392 \.486 \.580 \.675 \.769 \.863 \.900 \.938 \.975 1 1"/,
  );
  assert.match(html, /<feMorphology[^>]+radius="0\.75"/);
  assert.match(html, /flood-color="#101010" flood-opacity="0\.95"/);
});

test("chroma-only layout snaps lower-third margins to whole pixels", async () => {
  const source = await readFile(mediaModulePath, "utf8");

  assert.match(source, /snapToDevicePixel\(window\.innerWidth \* 0\.04\)/);
  assert.match(source, /snapToDevicePixel\(window\.innerHeight \* 0\.08\)/);
  assert.match(source, /Math\.round\(value \* scale\) \/ scale/);
  assert.match(source, /morphology\.setAttribute\("radius", String\(0\.75 \/ scale\)\)/);
  assert.match(source, /classList\.toggle\("chroma-edge-optimized", enabled\)/);
  assert.match(source, /classList\.toggle\("chroma-edge-no-plate", enabled && !opaquePlate\)/);
  assert.match(source, /classList\.toggle\("chroma-edge-opaque-plate", opaquePlate\)/);
  assert.match(source, /typeof message\.lowerThirdBackingPlateEnabled === "boolean"/);
});
