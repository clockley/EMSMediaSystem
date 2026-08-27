/*
Copyright (C) 2026 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { createInterface } from "node:readline";
import { isIP } from "node:net";
import atemConnection from "atem-connection";

const { Atem } = atemConnection;
const CONNECT_TIMEOUT_MS = 10_000;

let atem = null;
let connection = { connected: false, connecting: false, host: null, product: null };

function rpcError(code, message, data) {
  return { code, message, ...(data === undefined ? {} : { data }) };
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function notify(method, params) {
  write({ jsonrpc: "2.0", method, params });
}

function setConnection(patch) {
  connection = { ...connection, ...patch };
  notify("atem.connectionChanged", { ...connection });
}

function requireObjectParams(params) {
  if (params == null) return {};
  if (typeof params !== "object" || Array.isArray(params)) {
    throw rpcError(-32602, "params must be an object");
  }
  return params;
}

function requireInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw rpcError(-32602, `${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

async function disconnect() {
  const current = atem;
  atem = null;
  if (current) {
    current.removeAllListeners();
    await current.disconnect().catch(() => {});
  }
  setConnection({ connected: false, connecting: false, host: null, product: null });
  return { ...connection };
}

async function connect(params) {
  const { host } = requireObjectParams(params);
  if (typeof host !== "string" || isIP(host.trim()) === 0) {
    throw rpcError(-32602, "host must be a valid IPv4 or IPv6 address");
  }
  const normalizedHost = host.trim();
  if (connection.connected && connection.host === normalizedHost) return { ...connection };
  await disconnect();

  const next = new Atem({ disableMultithreaded: true });
  atem = next;
  setConnection({ connected: false, connecting: true, host: normalizedHost, product: null });

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void disconnect();
      reject(rpcError(-32001, `Timed out connecting to ATEM at ${normalizedHost}`));
    }, CONNECT_TIMEOUT_MS);

    const fail = (error) => {
      console.error(`[atem-rpc] ${error?.stack || error}`);
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void disconnect();
      reject(rpcError(-32001, `Could not connect to ATEM at ${normalizedHost}`));
    };

    next.on("error", fail);
    next.on("disconnected", () => {
      if (atem === next) setConnection({ connected: false, connecting: false });
    });
    next.once("connected", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const product = next.state?.info?.productIdentifier || null;
      setConnection({ connected: true, connecting: false, host: normalizedHost, product });
      resolve({ ...connection });
    });
    void next.connect(normalizedHost).catch(fail);
  });
}

function requireConnected() {
  if (!atem || !connection.connected) {
    throw rpcError(-32002, "ATEM is not connected");
  }
  return atem;
}

async function handle(method, rawParams) {
  switch (method) {
    case "atem.ready":
    case "atem.status":
      return { ...connection };
    case "atem.connect":
      return connect(rawParams);
    case "atem.disconnect":
      return disconnect();
    case "atem.setProgramInput": {
      const params = requireObjectParams(rawParams);
      const input = requireInteger(params.input, "input", 0, 65535);
      const me = requireInteger(params.me ?? 0, "me", 0, 3);
      await requireConnected().changeProgramInput(input, me);
      return { input, me };
    }
    case "atem.setPreviewInput": {
      const params = requireObjectParams(rawParams);
      const input = requireInteger(params.input, "input", 0, 65535);
      const me = requireInteger(params.me ?? 0, "me", 0, 3);
      await requireConnected().changePreviewInput(input, me);
      return { input, me };
    }
    default:
      throw rpcError(-32601, `Unknown method: ${method}`);
  }
}

async function processLine(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    write({ jsonrpc: "2.0", id: null, error: rpcError(-32700, "Parse error") });
    return;
  }

  const id = request?.id ?? null;
  if (request?.jsonrpc !== "2.0" || typeof request?.method !== "string") {
    write({ jsonrpc: "2.0", id, error: rpcError(-32600, "Invalid Request") });
    return;
  }

  try {
    const result = await handle(request.method, request.params);
    if (request.id !== undefined) write({ jsonrpc: "2.0", id, result });
  } catch (error) {
    const normalized = Number.isInteger(error?.code)
      ? error
      : rpcError(-32000, error?.message || "ATEM operation failed");
    if (request.id !== undefined) write({ jsonrpc: "2.0", id, error: normalized });
  }
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
input.on("line", (line) => {
  if (!line.trim()) return;
  queue = queue.then(() => processLine(line)).catch((error) => {
    console.error(`[atem-rpc] ${error?.stack || error}`);
  });
});
input.on("close", () => {
  void disconnect().finally(() => process.exit(0));
});
