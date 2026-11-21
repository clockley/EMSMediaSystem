/*
 * Real installed-library smoke test; run with the installed Electron CLI:
 * node <installed-electron-40.10.6-cli> tests/browser/audience-pptx.electron.cjs
 *
 * Loads the existing production audience page. Only the Electron boundary is
 * substituted; PptxViewer, ZIP parsing, rendering, queues and fitting are real.
 * No build step, application edits, persistent fixtures or viewer monkeypatches.
 */
const path = require("node:path");

if (process.type === "renderer") {
  const { contextBridge, ipcRenderer } = require("electron/renderer");
  const messages = [];
  const handlers = new Map();
  const send = (channel, ...args) => {
    messages.push({ channel, payload: args[0] });
    ipcRenderer.send(channel, ...args);
  };
  contextBridge.exposeInMainWorld("electron", {
    ipcRenderer: {
      send,
      invoke: ipcRenderer.invoke.bind(ipcRenderer),
      on(channel, callback) {
        const listeners = handlers.get(channel) || [];
        listeners.push(callback);
        handlers.set(channel, listeners);
        ipcRenderer.on(channel, (_event, ...args) => callback({}, ...args));
      },
    },
    // The production parser scans backwards until a leading '-' sentinel.
    argv: ["--ems-pptx-smoke", ...process.argv.filter((arg) => arg.startsWith("__"))],
    birth: null,
    timeRemaining: { sendTick: () => false, isPortReady: () => false },
    attachCubicWaveShaper() { throw new Error("Unexpected audio setup in PPTX smoke"); },
    emsMediaUrlForPath() { throw new Error("Unexpected video registration in PPTX smoke"); },
    createFadeOut() { throw new Error("Unexpected audio fade in PPTX smoke"); },
  });
  // Deliberately omit optional window.api.video: the real bootstrap falls back
  // to #bigPlayer. A DOM node cannot be copied through contextBridge.
  contextBridge.exposeInMainWorld("pptxSmoke", {
    messages: () => messages,
    emit(channel, payload) {
      const listeners = handlers.get(channel);
      if (!listeners?.length) throw new Error(`Missing audience IPC listener: ${channel}`);
      for (const callback of listeners) callback({}, payload);
    },
    resize: (width, height) => ipcRenderer.invoke("pptx-smoke:resize", width, height),
  });
} else {
  const assert = require("node:assert/strict");
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const { zipSync, strToU8 } = require("fflate");
  const { app, BrowserWindow, ipcMain } = require("electron");
  const root = path.resolve(__dirname, "../..");
  const productionPage = path.join(root, "derived/src/media-window/media.prod.html");
  const libraryPath = "../../../node_modules/@aiden0z/pptx-renderer/dist/aiden0z-pptx-renderer.browser.es.js";
  const errors = [];
  const outputFailures = [];
  let temporaryDirectory;
  let win;
  let watchdog;
  let smokeSession;
  let cleanupPromise;

  // Minimal OPC presentation: two explicit text shapes, a blank layout/master,
  // and a theme. All fixtures are original synthetic text and temporary files.
  function makeDeck(label, height) {
    const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
    const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const xml = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;
    const relationships = (entries) => xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map(([id, type, target]) => `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`).join("")}</Relationships>`);
    const group = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
    const parts = {
      "_rels/.rels": relationships([["rId1", "officeDocument", "ppt/presentation.xml"]]),
      "ppt/presentation.xml": xml(`<p:presentation xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId3"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="${height}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`),
      "ppt/_rels/presentation.xml.rels": relationships([["rId1", "slide", "slides/slide1.xml"], ["rId2", "slide", "slides/slide2.xml"], ["rId3", "slideMaster", "slideMasters/slideMaster1.xml"]]),
      "ppt/slideLayouts/slideLayout1.xml": xml(`<p:sldLayout xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`),
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels": relationships([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]),
      "ppt/slideMasters/slideMaster1.xml": xml(`<p:sldMaster xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld><p:spTree>${group}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`),
      "ppt/slideMasters/_rels/slideMaster1.xml.rels": relationships([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ["rId2", "theme", "../theme/theme1.xml"]]),
      "ppt/theme/theme1.xml": xml(`<a:theme xmlns:a="${a}" name="Smoke"><a:themeElements><a:clrScheme name="Smoke"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="101020"/></a:dk2><a:lt2><a:srgbClr val="EEEEFF"/></a:lt2>${[1, 2, 3, 4, 5, 6].map((n) => `<a:accent${n}><a:srgbClr val="336699"/></a:accent${n}>`).join("")}<a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Smoke"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Smoke"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`),
    };
    for (let index = 1; index <= 2; index++) {
      parts[`ppt/slides/slide${index}.xml`] = xml(`<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="18334D"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${group}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Smoke text"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="7315200" cy="1828800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="3200" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>EMS Smoke ${label} slide ${index}</a:t></a:r><a:endParaRPr lang="en-US" sz="3200"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
      parts[`ppt/slides/_rels/slide${index}.xml.rels`] = relationships([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"]]);
    }
    const types = {
      "ppt/presentation.xml": "presentationml.presentation.main",
      "ppt/slides/slide1.xml": "presentationml.slide",
      "ppt/slides/slide2.xml": "presentationml.slide",
      "ppt/slideLayouts/slideLayout1.xml": "presentationml.slideLayout",
      "ppt/slideMasters/slideMaster1.xml": "presentationml.slideMaster",
      "ppt/theme/theme1.xml": "theme",
    };
    parts["[Content_Types].xml"] = xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${Object.entries(types).map(([name, type]) => `<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`).join("")}</Types>`);
    return zipSync(Object.fromEntries(Object.entries(parts).map(([name, text]) => [name, strToU8(text)])));
  }

  async function rendererSmoke({ deckA, deckB, libraryPath }) {
    const results = [];
    const failures = [];
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const timeout = (promise, label, ms = 15000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms);
      Promise.resolve(promise).then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
    });
    const frame = () => timeout(new Promise((resolve) => requestAnimationFrame(resolve)), "animation frame");
    const until = async (predicate, label) => {
      const deadline = performance.now() + 15000;
      while (!predicate()) {
        check(performance.now() < deadline, `Timed out: ${label}`);
        await frame();
      }
    };
    const messages = () => window.pptxSmoke.messages();
    const publications = () => messages().filter((m) => m.channel === "stage-local-media" && m.payload.kind === "pptx").map((m) => m.payload);
    const goto = (index, playbackId, filePath) => window.pptxSmoke.emit("pptx-goto-slide", { slideIndex: index, playbackId, filePath });
    const latest = (index, playbackId) => {
      const last = publications().at(-1);
      return last?.slideIndex === index && last.playbackId === playbackId && window.emsGetPptxCurrentSlide() === index;
    };
    const libraryErrors = [];
    function observe(viewer) {
      for (const name of ["slideerror", "nodeerror"]) viewer.addEventListener(name, (event) => libraryErrors.push(`${name}: ${event.detail?.error?.stack || event.detail?.error}`));
    }
    async function bounds(label, index, playbackId, expectedText) {
      await until(() => latest(index, playbackId), label);
      await document.fonts.ready;
      await frame();
      await frame();
      const canvas = document.getElementById("pptxCanvas");
      const viewer = window._pptxMediaViewer;
      const host = canvas.firstElementChild;
      const wrapper = host?.firstElementChild;
      const slide = wrapper?.firstElementChild;
      check(viewer && viewer.slideCount === 2, `${label}: actual two-slide viewer missing`);
      check(host.children.length === 1 && wrapper.children.length === 1, `${label}: expected a single rendered slide`);
      check(slide.textContent.includes(expectedText), `${label}: wrong rendered DOM text: ${slide.textContent}`);
      check(viewer.currentSlideIndex === index, `${label}: real viewer index differs`);
      check(viewer.fitMode === "none" && viewer.zoomPercent === 100, `${label}: wrong real fit/zoom state`);
      check(canvas.checkVisibility() && slide.checkVisibility(), `${label}: hidden output`);
      const viewport = canvas.getBoundingClientRect();
      const rect = slide.getBoundingClientRect();
      const outer = wrapper.getBoundingClientRect();
      const scale = Math.min(viewport.width / viewer.slideWidth, viewport.height / viewer.slideHeight);
      const near = (x, y) => Math.abs(x - y) < 1.5;
      // Aggregate geometry assertions so a real fitting bug does not prevent
      // the remaining navigation/replacement/resize checks from being run.
      // Every failure is returned to main and makes the executable exit 1.
      const geometryCheck = (condition, message) => { if (!condition) failures.push(`${label}: ${message}`); };
      geometryCheck(near(rect.width, viewer.slideWidth * scale) && near(rect.height, viewer.slideHeight * scale), "slide is not contained at the expected aspect ratio/scale");
      geometryCheck(near(outer.width, rect.width) && near(outer.height, rect.height), "wrapper/slide dimensions differ");
      geometryCheck(near(rect.x, (viewport.width - rect.width) / 2) && near(rect.y, (viewport.height - rect.height) / 2), "slide is not centered");
      geometryCheck(rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1, "slide extends beyond viewport");
      const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
      const textRects = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        for (const ink of range.getClientRects()) {
          geometryCheck(ink.width > 0 && ink.height > 0, "empty text bounds");
          geometryCheck(ink.left >= rect.left - 2 && ink.right <= rect.right + 2 && ink.top >= rect.top - 2 && ink.bottom <= rect.bottom + 2, "text outside slide");
          const hit = document.elementFromPoint(ink.x + ink.width / 2, ink.y + ink.height / 2);
          geometryCheck(hit && slide.contains(hit), "rendered text obscured");
          textRects.push({ x: ink.x, y: ink.y, width: ink.width, height: ink.height });
        }
      }
      check(textRects.length > 0, `${label}: no real DOM text bounds`);
      const publication = publications().at(-1);
      check(publication.audienceSessionId === "pptx-smoke-session" && Number.isInteger(publication.sourceGeneration), `${label}: stage identity missing`);
      const result = { label, viewport: [innerWidth, innerHeight], intrinsic: [viewer.slideWidth, viewer.slideHeight], expected: [viewer.slideWidth * scale, viewer.slideHeight * scale], slide: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, wrapper: { width: outer.width, height: outer.height }, style: { width: slide.style.width, height: slide.style.height, transform: slide.style.transform, flexShrink: getComputedStyle(slide).flexShrink, offsetWidth: slide.offsetWidth, offsetHeight: slide.offsetHeight }, text: expectedText, textRects, slideIndex: index };
      results.push(result);
      console.log(`PPTX_SMOKE_CHECK ${JSON.stringify(result)}`);
      return viewer;
    }

    await until(() => messages().some((m) => m.channel === "audience-output-ready") || messages().some((m) => m.channel === "audience-output-failed"), "audience bootstrap");
    const failed = messages().filter((m) => m.channel === "audience-output-failed");
    check(failed.length === 0, `audience-output-failed: ${JSON.stringify(failed)}`);
    const { PptxViewer } = await import(libraryPath);
    check(window._pptxMediaViewer instanceof PptxViewer, "Production did not instantiate the real installed PptxViewer");
    const ready = messages().find((m) => m.channel === "audience-output-ready").payload;
    check(ready.playbackId === "pptx-smoke-boot" && ready.audienceSessionId === "pptx-smoke-session", "Wrong startup identity");
    let viewer = await bounds("boot-slide-0", 0, "pptx-smoke-boot", "EMS Smoke A slide 1");
    observe(viewer);
    goto(1, "pptx-smoke-boot", deckA);
    await bounds("goto-slide-1", 1, "pptx-smoke-boot", "EMS Smoke A slide 2");

    // Synchronous delivery of three real IPC callbacks exercises latest-wins
    // production queueing, without replacing any viewer method.
    let before = publications().length;
    goto(0, "pptx-smoke-boot", deckA);
    goto(1, "pptx-smoke-boot", deckA);
    goto(0, "pptx-smoke-boot", deckA);
    await until(() => publications().length > before && latest(0, "pptx-smoke-boot"), "rapid 0 -> 1 -> 0");
    await bounds("rapid-0-1-0", 0, "pptx-smoke-boot", "EMS Smoke A slide 1");
    check(publications().slice(before).every((m) => m.slideIndex === 0), "Obsolete rapid navigation published");

    // A real sliderendered event fires before the library appends its wrapper
    // and before renderSlide resolves. Replacing here exercises late detached
    // painting, not an artificial deferred/mock render.
    async function replaceDuringRealRender(payload, expectedOldText) {
      const oldViewer = window._pptxMediaViewer;
      const oldHost = document.getElementById("pptxCanvas").firstElementChild;
      const publicationCount = publications().length;
      const race = await timeout(new Promise((resolve, reject) => {
        oldViewer.addEventListener("sliderendered", (event) => {
          try {
            check(oldViewer.isRendering && oldHost.isConnected, "Replacement did not interrupt a real pending render");
            check(event.detail.element.textContent.includes(expectedOldText), "Pending render was not real slide text");
            const activation = window.emsApplySlipstream(payload);
            check(!oldHost.isConnected && oldHost.parentNode === null, "Old host was not detached synchronously");
            resolve({ activation });
          } catch (error) { reject(error); }
        }, { once: true });
        goto(1, publications().at(-1).playbackId, publications().at(-1).url);
      }), "replacement inside real sliderendered event");
      const acknowledgement = await timeout(race.activation, "replacement activation");
      check(acknowledgement.playbackId === payload.playbackId, "Wrong replacement acknowledgement");
      await timeout(oldViewer.renderChain, "old real render drain");
      await frame();
      check(!oldHost.isConnected, "Late render reattached old host");
      check(oldHost.textContent.includes(expectedOldText), "Expected real late paint into detached host did not occur");
      check(!publications().slice(publicationCount).some((m) => m.playbackId !== payload.playbackId), "Old render published after replacement");
      check(oldViewer.slideCount === 0, "Old viewer was not destroyed");
      return { detachedLatePaint: true, pendingRealRender: true };
    }

    const textRace = await replaceDuringRealRender({ isText: true, mediaFile: "", playbackId: "pptx-smoke-text", textPayload: { text: "Text replaces a pending PPTX", bodyText: "Text replaces a pending PPTX", backgroundColor: "#102030", fontSize: 56 } }, "EMS Smoke A slide 2");
    await frame();
    await frame();
    check(window._pptxMediaViewer === null && window.emsGetPptxCurrentSlide() === null, "Text replacement retained PPTX viewer/index");
    check(document.getElementById("pptxCanvas").style.display === "none", "Text replacement left PPTX visible");
    check(document.getElementById("textCanvas").checkVisibility() && document.getElementById("textContent").textContent.includes("Text replaces a pending PPTX"), "Real text replacement not visible");
    results.push({ label: "text-replaces-pending-render", ...textRace });

    await timeout(window.emsApplySlipstream({ isPptx: true, mediaFile: deckA, pptxStartSlide: 0, playbackId: "pptx-smoke-reload" }), "PPTX reload after text");
    viewer = await bounds("pptx-reload-after-text", 0, "pptx-smoke-reload", "EMS Smoke A slide 1");
    check(viewer instanceof PptxViewer, "Reload did not use real constructor");
    observe(viewer);

    const deckRace = await replaceDuringRealRender({ isPptx: true, mediaFile: deckB, pptxStartSlide: 1, playbackId: "pptx-smoke-deck-b" }, "EMS Smoke A slide 2");
    viewer = await bounds("deck-replaces-pending-render", 1, "pptx-smoke-deck-b", "EMS Smoke B slide 2");
    check(viewer instanceof PptxViewer, "Replacement deck did not use real constructor");
    observe(viewer);
    results.push({ label: "deck-replacement-ownership", ...deckRace });

    // Stale identities must not redirect the new deck.
    before = publications().length;
    goto(0, "pptx-smoke-reload", deckA);
    await frame();
    await frame();
    check(publications().length === before && latest(1, "pptx-smoke-deck-b"), "Stale deck navigation accepted");
    for (const [width, height] of [[1000, 800], [640, 960], [1280, 720]]) {
      before = publications().length;
      await window.pptxSmoke.resize(width, height);
      await until(() => innerWidth === width && innerHeight === height && publications().length > before, `actual window resize ${width}x${height}`);
      await bounds(`resize-${width}x${height}`, 1, "pptx-smoke-deck-b", "EMS Smoke B slide 2");
    }
    goto(0, "pptx-smoke-deck-b", deckB);
    await bounds("replacement-deck-slide-0", 0, "pptx-smoke-deck-b", "EMS Smoke B slide 1");
    check(libraryErrors.length === 0, `Real library errors: ${libraryErrors.join("; ")}`);
    check(messages().every((m) => !["audience-output-failed", "media-window-error"].includes(m.channel)), "Audience reported an output failure");
    return { results, failures, libraryErrors, stagePublications: publications(), ready };
  }

  function cleanup() {
    cleanupPromise ||= (async () => {
      clearTimeout(watchdog);
      if (win && !win.isDestroyed()) win.destroy();
      if (smokeSession) {
        smokeSession.flushStorageData();
        await smokeSession.closeAllConnections();
      }
      if (temporaryDirectory) {
        await fs.rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        console.log("PPTX_SMOKE_CLEANUP temporary fixtures/profile removed; window destroyed");
      }
    })();
    return cleanupPromise;
  }

  async function main() {
    assert.equal(process.versions.electron, "40.10.6", "This smoke must run on installed Electron 40.10.6");
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ems-audience-pptx-"));
    app.setPath("userData", path.join(temporaryDirectory, "profile"));
    app.commandLine.appendSwitch("disable-renderer-backgrounding");
    app.commandLine.appendSwitch("disable-background-timer-throttling");
    app.on("window-all-closed", () => {});
    watchdog = setTimeout(() => {
      console.error("PPTX_SMOKE_FAIL overall 90s deadline exceeded");
      cleanup().finally(() => app.exit(1));
    }, 90000);
    const deckA = path.join(temporaryDirectory, "wide deck A.pptx");
    const deckB = path.join(temporaryDirectory, "standard deck B.pptx");
    await Promise.all([fs.writeFile(deckA, makeDeck("A", 5143500)), fs.writeFile(deckB, makeDeck("B", 6858000)), fs.access(productionPage)]);
    const bundle = await fs.readFile(path.join(root, "derived/src/media-window/media.min.mjs"), "utf8");
    for (const token of ["activationGeneration", "slideRevision", "AbortController"]) assert.ok(bundle.includes(token), `Revised production bundle missing ${token}; build it before running`);
    await app.whenReady();
    ipcMain.handle("read-file-as-arraybuffer", async (_event, filename) => {
      assert.ok([deckA, deckB].includes(filename), `Unexpected file request: ${filename}`);
      const buffer = await fs.readFile(filename);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    });
    ipcMain.handle("pptx-smoke:resize", (_event, width, height) => {
      win.setContentSize(width, height);
      return true;
    });
    for (const channel of ["audience-output-failed", "media-window-error"]) ipcMain.on(channel, (_event, payload) => outputFailures.push({ channel, payload }));
    win = new BrowserWindow({
      // Hidden avoids the desktop WM asynchronously constraining requested
      // viewport sizes. Chromium still lays out/paints with throttling off.
      show: false, width: 1100, height: 800, useContentSize: true,
      webPreferences: {
        preload: __filename, contextIsolation: true, sandbox: false,
        nodeIntegration: false, backgroundThrottling: false,
        additionalArguments: [`__mediafilename=${encodeURIComponent(deckA)}`, "__isPptx", "__audience-playback=pptx-smoke-boot", "__audience-session=pptx-smoke-session", "__disable-content-transitions=true"],
      },
    });
    win.webContents.on("preload-error", (_event, filename, error) => errors.push(`preload ${filename}: ${error.stack || error}`));
    win.webContents.on("render-process-gone", (_event, details) => errors.push(`renderer exited: ${JSON.stringify(details)}`));
    win.webContents.on("console-message", (details) => {
      if (details.message?.startsWith("PPTX_SMOKE_CHECK")) console.log(details.message);
      if (details.level === "error" || details.level === 3) errors.push(`console: ${details.message}`);
    });
    win.webContents.debugger.attach("1.3");
    win.webContents.debugger.on("message", (_event, method, params) => {
      if (method === "Runtime.exceptionThrown") errors.push(`exception/promise: ${params.exceptionDetails.exception?.description || params.exceptionDetails.text}`);
    });
    // On Electron 40, awaiting Runtime.enable before the initial navigation
    // can stall indefinitely. Subscribe first, but navigate concurrently.
    const runtimeEnabled = win.webContents.debugger.sendCommand("Runtime.enable");
    smokeSession = win.webContents.session;
    smokeSession.webRequest.onErrorOccurred((details) => errors.push(`resource: ${details.error} ${details.url}`));
    const libraryPackage = JSON.parse(await fs.readFile(path.join(path.dirname(require.resolve("@aiden0z/pptx-renderer")), "../package.json"), "utf8"));
    console.log(`PPTX_SMOKE_RUNTIME ${JSON.stringify({ electron: process.versions.electron, chrome: process.versions.chrome, productionPage, pptxRenderer: libraryPackage.version })}`);
    await Promise.all([win.loadFile(productionPage), runtimeEnabled]);
    const result = await win.webContents.executeJavaScript(`(${rendererSmoke.toString()})(${JSON.stringify({ deckA, deckB, libraryPath })})`, true);
    console.log(`PPTX_SMOKE_RESULT ${JSON.stringify({ checks: result.results.length, runtimeErrors: errors.length, outputFailures: outputFailures.length, ...result })}`);
    assert.deepEqual(errors, [], "Runtime, promise, console or resource errors");
    assert.deepEqual(outputFailures, [], "Audience output failures");
    assert.deepEqual(result.failures, [], "Actual production fitted DOM geometry assertions");
    console.log("PPTX_SMOKE_PASS all real-library, ownership and fitted DOM assertions passed");
  }

  main().then(async () => {
    try { await cleanup(); app.exit(0); }
    catch (error) { console.error("PPTX_SMOKE_CLEANUP_FAIL", error); app.exit(1); }
  }, async (error) => {
    console.error("PPTX_SMOKE_FAIL", error.stack || error);
    if (errors.length || outputFailures.length) console.error(JSON.stringify({ errors, outputFailures }));
    try { await cleanup(); }
    catch (cleanupError) { console.error("PPTX_SMOKE_CLEANUP_FAIL", cleanupError); }
    finally { app.exit(1); }
  });
}