import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAudienceDisplaySelection,
  normalizeAudienceDisplays,
  requestAudienceOutputDevice,
  selectedAudienceDisplay,
} from "../src/shared/audience-output-device.mjs";

class FakeSelect {
  constructor(id, emptyLabel) {
    this.id = id;
    this._value = "";
    this.options = [{ value: "", textContent: emptyLabel, dataset: {} }];
    this.events = [];
  }

  get value() {
    return this._value;
  }

  set value(value) {
    const normalized = String(value ?? "");
    this._value = this.options?.some((option) => option.value === normalized)
      ? normalized
      : "";
  }

  appendChild(option) {
    this.options.push(option);
    return option;
  }

  dispatchEvent(event) {
    this.events.push(event.type);
    return true;
  }
}

function fakeDocument() {
  const elements = new Map([
    ["dspSelct", new FakeSelect("dspSelct", "No Audience Output")],
    ["dspSelctStreams", new FakeSelect("dspSelctStreams", "No Output")],
  ]);
  return {
    defaultView: { Event },
    createElement() {
      return { value: "", textContent: "", dataset: {} };
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
  };
}

test("connected audience displays are normalized and de-duplicated", () => {
  assert.deepEqual(
    normalizeAudienceDisplays([
      { value: "display:1", label: "Sanctuary 1920x1080", isSecondary: true },
      { value: "display:1", label: "Duplicate" },
      { value: "", label: "No output" },
      { value: 2, label: "Lobby", bounds: { width: 1280, height: 720 } },
    ]),
    [
      {
        value: "display:1",
        label: "Sanctuary 1920x1080",
        isSecondary: true,
        bounds: null,
      },
      {
        value: "2",
        label: "Lobby",
        isSecondary: false,
        bounds: { width: 1280, height: 720 },
      },
    ],
  );
});

test("choosing a display refreshes and synchronizes both audience selectors", async () => {
  const doc = fakeDocument();
  let chooserDisplays = null;
  const selected = await requestAudienceOutputDevice({
    doc,
    invoke: async (channel) => {
      assert.equal(channel, "get-all-displays");
      return {
        displays: [
          { value: "primary", label: "Operator 1920x1080", isSecondary: false },
          { value: "projector", label: "Projector 1920x1080", isSecondary: true },
        ],
      };
    },
    chooseDisplay: async ({ displays }) => {
      chooserDisplays = displays;
      return "projector";
    },
  });

  assert.equal(selected, "projector");
  assert.equal(selectedAudienceDisplay(doc), "projector");
  assert.equal(doc.getElementById("dspSelct").value, "projector");
  assert.equal(doc.getElementById("dspSelctStreams").value, "projector");
  assert.deepEqual(doc.getElementById("dspSelct").events, ["change"]);
  assert.deepEqual(doc.getElementById("dspSelctStreams").events, []);
  assert.deepEqual(
    chooserDisplays.map(({ value }) => value),
    ["primary", "projector"],
  );
  assert.deepEqual(
    doc.getElementById("dspSelct").options.map(({ value }) => value),
    ["", "primary", "projector"],
  );
});

test("canceling the display dialog leaves output unselected", async () => {
  const doc = fakeDocument();
  const selected = await requestAudienceOutputDevice({
    doc,
    invoke: async () => ({
      displays: [{ value: "projector", label: "Projector", isSecondary: true }],
    }),
    chooseDisplay: async () => "",
  });

  assert.equal(selected, "");
  assert.equal(selectedAudienceDisplay(doc), "");
  assert.deepEqual(doc.getElementById("dspSelct").events, []);
});

test("only the presentation attempt that opened the dialog may continue", async () => {
  const doc = fakeDocument();
  let invokeCount = 0;
  let resolveChoice;
  let markChooserOpened;
  const chooserOpened = new Promise((resolve) => {
    markChooserOpened = resolve;
  });
  const chooseDisplay = () => new Promise((resolve) => {
    resolveChoice = resolve;
    markChooserOpened();
  });
  const options = {
    doc,
    invoke: async () => {
      invokeCount += 1;
      return { displays: [{ value: "projector", label: "Projector" }] };
    },
    chooseDisplay,
  };

  const first = requestAudienceOutputDevice(options);
  const second = requestAudienceOutputDevice(options);
  await chooserOpened;
  resolveChoice("projector");

  assert.equal(await first, "projector");
  assert.equal(await second, "");
  assert.equal(invokeCount, 2);
});

test("an existing selection is reused and synchronized without reopening the dialog", async () => {
  const doc = fakeDocument();
  for (const id of ["dspSelct", "dspSelctStreams"]) {
    doc.getElementById(id).options.push({
      value: "projector",
      textContent: "Projector",
      dataset: {},
    });
  }
  doc.getElementById("dspSelct").value = "projector";
  let invokeCount = 0;
  const selected = await requestAudienceOutputDevice({
    doc,
    invoke: async () => {
      invokeCount += 1;
      return { displays: [] };
    },
  });

  assert.equal(selected, "projector");
  assert.equal(doc.getElementById("dspSelctStreams").value, "projector");
  assert.equal(invokeCount, 0);
});

test("manual display selection dispatches one change event", () => {
  const doc = fakeDocument();
  for (const id of ["dspSelct", "dspSelctStreams"]) {
    doc.getElementById(id).options.push({
      value: "projector",
      textContent: "Projector",
      dataset: {},
    });
  }
  assert.equal(applyAudienceDisplaySelection("projector", doc), "projector");
  assert.equal(doc.getElementById("dspSelct").value, "projector");
  assert.equal(doc.getElementById("dspSelctStreams").value, "projector");
  assert.deepEqual(doc.getElementById("dspSelct").events, ["change"]);
});

test("a disconnected display cannot be applied from a stale option", () => {
  const doc = fakeDocument();
  assert.equal(applyAudienceDisplaySelection("disconnected", doc), "");
  assert.equal(selectedAudienceDisplay(doc), "");
  assert.deepEqual(doc.getElementById("dspSelct").events, []);
});

test("the selected display is revalidated and the chooser refreshes after hotplug", async () => {
  const doc = fakeDocument();
  let invokeCount = 0;
  const chooserSnapshots = [];
  const selected = await requestAudienceOutputDevice({
    doc,
    invoke: async () => {
      invokeCount += 1;
      return invokeCount === 1
        ? { displays: [{ value: "old", label: "Old projector" }] }
        : { displays: [{ value: "new", label: "New projector" }] };
    },
    chooseDisplay: async ({ displays }) => {
      chooserSnapshots.push(displays.map(({ value }) => value));
      return displays[0]?.value || "";
    },
  });

  assert.equal(selected, "new");
  assert.equal(invokeCount, 3);
  assert.deepEqual(chooserSnapshots, [["old"], ["new"]]);
  assert.equal(doc.getElementById("dspSelct").value, "new");
});

test("display discovery failure does not fall back to stale selector options", async () => {
  const doc = fakeDocument();
  for (const id of ["dspSelct", "dspSelctStreams"]) {
    doc.getElementById(id).options.push({
      value: "stale",
      textContent: "Stale projector",
      dataset: {},
    });
  }
  let chooserState = null;
  const selected = await requestAudienceOutputDevice({
    doc,
    invoke: async () => {
      throw new Error("display service unavailable");
    },
    chooseDisplay: async ({ displays, loadFailed }) => {
      chooserState = { displays, loadFailed };
      return "";
    },
  });

  assert.equal(selected, "");
  assert.deepEqual(chooserState, { displays: [], loadFailed: true });
  assert.deepEqual(
    doc.getElementById("dspSelct").options.map(({ value }) => value),
    [""],
  );
});
