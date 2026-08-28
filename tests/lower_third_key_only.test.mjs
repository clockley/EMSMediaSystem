import assert from "node:assert/strict";
import test from "node:test";

import { lowerThirdKeyOnlyMessage } from "../src/app-media-utils.mjs";

test("unsupported schedule items leave only the lower-third key color", () => {
  const message = lowerThirdKeyOnlyMessage({
    bodyText: "Visible text",
    referenceText: "John 3:16",
    chromaKeyColor: "#12ab34",
    lowerThirdBarBackgroundColor: "#101010",
    lowerThirdBarBackgroundImage: "plate.png",
    lowerThirdBarBackgroundVideo: "plate.mp4",
    slideObjects: [{ kind: "text" }],
  });

  assert.equal(message.bodyText, "");
  assert.equal(message.clearLowerThird, true);
  assert.equal(message.referenceText, "");
  assert.deepEqual(message.slideObjects, []);
  assert.equal(message.lowerThirdBarBackgroundColor, "transparent");
  assert.equal(message.lowerThirdBarBackgroundImage, "");
  assert.equal(message.lowerThirdBarBackgroundVideo, "");
  assert.equal(message.backgroundColor, "#12ab34");
  assert.equal(message.chromaKeyColor, "#12ab34");
  assert.deepEqual(message.transition, { effect: "none", durationMs: 0 });
});
