import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { BibleRpcClient } from "../src/main-process/bible_rpc_client.mjs";

async function harness(t) {
  const children = [];
  const root = await mkdtemp(path.join(tmpdir(), "ems-bible-lifecycle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "bundle.manifest.json"), "{}");
  const spawn = t.mock.method(childProcess, "spawn", () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      exitCode: null, signalCode: null, killed: false,
      kill() { this.killed = true; },
    });
    children.push(child);
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { spawn.mock.restore(); syncBuiltinESMExports(); });
  const client = new BibleRpcClient({ app: { getPath: () => root }, devRoot: root });
  client.binaryPath = () => process.execPath;
  client.bundleDirectory = () => root;
  t.after(() => client.close());
  return { client, children };
}

function reply(child, result) {
  const { id } = JSON.parse(child.stdin.read().toString());
  child.stdout.write(JSON.stringify({ id, result }) + "\n");
}

test("shutdown settles concurrent Bible requests and prevents late IPC from restarting the service", async t => {
  const { client, children } = await harness(t);
  const requests = [client.ready(), client.call("bible.getVersions")];
  client.close();
  await Promise.all(requests.map(request => assert.rejects(request, /stopped/)));
  await assert.rejects(client.ready(), /closed/);
  assert.equal(children.length, 1);
  assert.equal(children[0].killed, true);
});

test("a broken Bible pipe rejects outstanding calls and a late close leaves the replacement usable", async t => {
  const { client, children } = await harness(t);
  const requests = [client.ready(), client.call("bible.getVersions")];
  const rejected = Promise.all(requests.map(request => assert.rejects(request, /broken pipe/)));
  children[0].stdin.destroy(Object.assign(new Error("broken pipe"), { code: "EPIPE" }));
  await rejected;
  const fresh = client.call("bible.getVersions");
  children[0].emit("close", 1, null);
  reply(children[1], ["KJV"]);
  assert.deepEqual(await fresh, ["KJV"]);
});

test("a final Bible reply can arrive after exit while a new process serves other calls", async t => {
  const { client, children } = await harness(t);
  const oldRequest = client.call("bible.getVersions");
  children[0].exitCode = 0;
  children[0].emit("exit", 0, null);
  const newRequest = client.call("bible.getVersions");
  reply(children[0], ["RSV"]);
  children[0].emit("close", 0, null);
  reply(children[1], ["NVI"]);
  assert.deepEqual(await Promise.all([oldRequest, newRequest]), [["RSV"], ["NVI"]]);
});
