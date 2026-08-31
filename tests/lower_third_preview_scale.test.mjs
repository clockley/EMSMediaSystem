import test from "node:test";
import assert from "node:assert/strict";

import {
  applyLowerThirdPreviewScale,
  lowerThirdPreviewMarkup,
} from "../src/shared/lower-third-preview.mjs";

test("shared lower-third markup provides stable component slots", () => {
  const markup = lowerThirdPreviewMarkup({
    prefix: "scriptureLowerThird",
    label: "Lower Third",
    feature: true,
  });
  assert.match(markup, /class="lower-third-preview bible-preview-surface/);
  assert.match(markup, /id="scriptureLowerThirdShell"/);
  assert.match(markup, /id="scriptureLowerThirdRender"/);
  assert.match(markup, /id="scriptureLowerThirdText"/);
  assert.match(markup, /id="scriptureLowerThirdReference"/);
  assert.match(markup, /id="scriptureLowerThirdAttribution"/);
  assert.match(markup, /data-lower-third-feature hidden/);
});

function fakeSurface(width, height) {
  const values = new Map();
  return {
    style: {
      setProperty(name, value) {
        values.set(name, value);
      },
    },
    getBoundingClientRect() {
      return { width, height };
    },
    value(name) {
      return values.get(name);
    },
  };
}

test("lower-third preview scales down with its resized surface", () => {
  const surface = fakeSurface(480, 270);
  applyLowerThirdPreviewScale(surface, { width: 1920, height: 1080 }, {
    fit: "width",
    align: "bottom",
  });
  assert.equal(surface.value("--bible-preview-output-scale"), "0.25");
  assert.equal(surface.value("--bible-preview-scaled-width"), "480px");
  assert.equal(surface.value("--bible-preview-scaled-height"), "270px");
  assert.equal(surface.value("--bible-preview-output-offset-y"), "0px");
});

test("lower-third preview recomputes a smaller scale after another resize", () => {
  const surface = fakeSurface(240, 180);
  applyLowerThirdPreviewScale(surface, { width: 1920, height: 1080 }, {
    fit: "width",
    align: "bottom",
  });
  assert.equal(surface.value("--bible-preview-output-scale"), "0.125");
  assert.equal(surface.value("--bible-preview-scaled-width"), "240px");
  assert.equal(surface.value("--bible-preview-scaled-height"), "135px");
  assert.equal(surface.value("--bible-preview-output-offset-y"), "45px");
});
