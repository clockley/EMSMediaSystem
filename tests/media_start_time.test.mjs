import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [preloadSource, mediaSource] = await Promise.all([
  readFile(new URL("../src/media-window/media_preload.js", import.meta.url), "utf8"),
  readFile(new URL("../src/media-window/media.mjs", import.meta.url), "utf8"),
]);

function declaredFunction(name) {
  const match = mediaSource.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(match, `media renderer declares ${name}`);
  return match[0];
}

function preloadElectron(argv) {
  let electron;
  const ipcRenderer = { on() {}, send() {}, invoke() {} };
  // Audio effects are unrelated to argument delivery and require Electron's
  // module loader. Keep the actual preload and its exposed bridge in this test.
  const source = preloadSource.replace(
    /^const audioFxPromise = import\([^\n]+\);$/m,
    "const audioFxPromise = Promise.resolve({});",
  );
  assert.notEqual(source, preloadSource);
  vm.runInNewContext(source, {
    require() {
      return {
        ipcRenderer,
        contextBridge: {
          exposeInMainWorld(name, value) {
            if (name === "electron") electron = value;
          },
        },
      };
    },
    process: { argv },
    document: { readyState: "loading" },
    window: { addEventListener() {} },
  });
  return electron;
}

async function startProjection(extraArguments, { seekOnly = false, stream = false } = {}) {
  const argv = [
    "electron",
    "--type=renderer",
    "__mediafile-ems=file%3A%2F%2F%2Fclip.mp4",
    "__start-time=42",
    "__autoplay=true",
    ...(seekOnly ? ["__seek-only"] : []),
    ...extraArguments,
  ];
  const { birth } = preloadElectron(argv);
  const starts = [];
  const video = {
    currentTime: 0,
    duration: 120,
    readyState: 1,
    addEventListener() {},
    removeEventListener() {},
    play() {
      starts.push(this.currentTime);
      return Promise.resolve();
    },
  };
  const context = vm.createContext({
    argv,
    birth,
    i: argv.length - 1,
    strtTm: 0,
    strtvl: 1,
    seekOnly: false,
    loopFile: false,
    autoPlay: false,
    logoHoldOnly: false,
    isText: false,
    isImg: false,
    isPptx: false,
    liveStreamMode: false,
    mediaFile: "",
    video,
    videoSourceGeneration: 0,
    CUE_START_TOLERANCE_SECONDS: 0.25,
    HTMLMediaElement: { HAVE_METADATA: 1 },
    Date: { now: () => 2000125 },
    ipcRenderer: {
      invoke: async (channel) => channel === "get-system-time"
        ? { systemTime: 1000.75, ipcTimestamp: 2000000 }
        : "linux",
    },
    document: { getElementById: () => null },
    attachCubicWaveShaper: async () => {},
    teardownStreamingPlayers() {},
    hideStreamStatus() {},
    installICPHandlers() {},
    installVideoPlaybackWiring() {},
    setLoopEnabled() {},
    beginPlaybackStateStabilizing() {},
  });
  const argumentParser = mediaSource.match(/^do \{[^]*?^\} while \(argv\[i\]\[0\] !== "-"\);/m);
  assert.ok(argumentParser, "media renderer parses window arguments");
  vm.runInContext([
    argumentParser[0],
    ...[
      "setProjectionVideoSource",
      "waitForMediaMetadata",
      "cueStartTimeWithinDuration",
      "holdVideoStartTime",
      "applyVideoStartTime",
      "effectiveWindowStartTime",
      "playVideoWithStartupBuffer",
      "loadMedia",
    ].map(declaredFunction),
  ].join("\n"), context);
  if (stream) {
    // Seekable network media uses the same cue application with this helper.
    await vm.runInContext(
      "(async () => { await applyVideoStartTime(video, await effectiveWindowStartTime()); await video.play(); })()",
      context,
    );
  } else {
    await vm.runInContext("loadMedia()", context);
  }
  return { birth, starts, currentTime: video.currentTime };
}

for (const timestamp of ["1000.25", "__media-birth=1000.25"]) {
  for (const alertArguments of [[], ["__disable-content-transitions=true"]]) {
    test(`projection starts at its cue with ${timestamp} before appended session/alert arguments ${alertArguments.length}`, async () => {
      const result = await startProjection([
        timestamp,
        "__audience-session=test-session",
        ...alertArguments,
      ]);
      assert.equal(result.birth, 1000.25);
      assert.deepEqual(result.starts, [42.625]);
      assert.equal(result.currentTime, 42.625);
    });
  }
}

test("named media birth wins over unrelated numeric arguments", async () => {
  const result = await startProjection([
    "__media-birth=1000.25",
    "9999",
    "__audience-session=test-session",
  ]);
  assert.equal(result.birth, 1000.25);
  assert.deepEqual(result.starts, [42.625]);
});

test("seek-only projection starts at the exact cue without startup compensation", async () => {
  const result = await startProjection([
    "__media-birth=1000.25",
    "__audience-session=test-session",
  ], { seekOnly: true });
  assert.deepEqual(result.starts, [42]);
});

test("seekable network media preserves the cue when audience arguments follow its birth time", async () => {
  const result = await startProjection([
    "__media-birth=1000.25",
    "__audience-session=test-session",
    "__disable-content-transitions=true",
  ], { stream: true });
  assert.deepEqual(result.starts, [42.625]);
});

for (const timestamp of [[], ["__media-birth="], ["__media-birth=invalid"]]) {
  test(`missing or invalid birth preserves the requested cue: ${timestamp.join() || "missing"}`, async () => {
    const result = await startProjection([
      ...timestamp,
      "__audience-session=test-session",
    ]);
    assert.equal(result.birth, null);
    assert.deepEqual(result.starts, [42.125]);
  });
}
