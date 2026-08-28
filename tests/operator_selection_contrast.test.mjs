import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOperatorSelectionContrast,
  operatorSelectionContrast,
} from "../src/operator-selection-contrast.mjs";

test("operator selection differs from light body text on a dark background", () => {
  const result = operatorSelectionContrast({
    backgroundColor: "#000000",
    textColor: "#ffffff",
  });
  assert.equal(result.color, "#ffe36e");
  assert.match(result.shadow, /0, 0, 0/);
  assert.equal(result.strokeWidth, "0.032em");
});

test("operator selection uses a dark contrasting color on a bright key color", () => {
  const result = operatorSelectionContrast({
    backgroundColor: "#00ff00",
    textColor: "#ffffff",
  });
  assert.equal(result.color, "#080808");
  assert.match(result.shadow, /255, 255, 255/);
});

test("variable image and video backgrounds receive a halo-safe highlight", () => {
  const result = operatorSelectionContrast({
    backgroundColor: "#ffffff",
    textColor: "#ffffff",
    hasVariableBackground: true,
  });
  assert.equal(result.color, "#ffe36e");
  assert.match(result.shadow, /0, 0, 0/);
  assert.equal(result.strokeWidth, "0.055em");
});

test("CSS rgb colors participate in contrast selection", () => {
  const result = operatorSelectionContrast({
    backgroundColor: "rgb(255, 255, 255)",
    textColor: "rgb(8, 8, 8)",
  });
  assert.equal(result.color, "#004fc4");
});

test("shared selection styling applies the palette to any preview root", () => {
  const properties = new Map();
  const element = {
    style: {
      setProperty(name, value) {
        properties.set(name, value);
      },
    },
  };
  const result = applyOperatorSelectionContrast(element, {
    backgroundColor: "#00ff00",
    color: "#ffffff",
  });
  assert.equal(properties.get("--operator-selection-color"), result.color);
  assert.equal(properties.get("--operator-selection-shadow"), result.shadow);
  assert.equal(properties.get("--operator-selection-stroke-width"), result.strokeWidth);
});
