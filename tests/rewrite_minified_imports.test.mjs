import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("minified import rewrite leaves published node_modules filenames intact", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ems-import-rewrite-"));
  try {
    const fixture = path.join(directory, "fixture.mjs");
    writeFileSync(
      fixture,
      [
        'import helper from "./helper.mjs";',
        'const vendor = import("../../node_modules/vendor/dist/browser.es.js");',
      ].join("\n"),
    );

    execFileSync(process.execPath, [
      path.resolve("build-scripts/rewrite-minified-imports.cjs"),
      fixture,
    ]);

    const rewritten = readFileSync(fixture, "utf8");
    assert.match(rewritten, /"\.\/helper\.min\.mjs"/);
    assert.match(rewritten, /node_modules\/vendor\/dist\/browser\.es\.js/);
    assert.doesNotMatch(rewritten, /browser\.es\.min\.js/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
