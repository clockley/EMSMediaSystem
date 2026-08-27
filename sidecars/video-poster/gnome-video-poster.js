#!/usr/bin/gjs

/* Copyright (C) 2026 Christian Lockley — GPL-3.0-or-later */

"use strict";

const { GLib } = imports.gi;
let loadedGnomeDesktop = null;

function loadGnomeDesktop() {
  if (loadedGnomeDesktop !== null) return loadedGnomeDesktop;
  const failures = [];
  for (const version of ["4.0", "3.0"]) {
    try {
      imports.gi.versions.GnomeDesktop = version;
      loadedGnomeDesktop = { module: imports.gi.GnomeDesktop, version };
      return loadedGnomeDesktop;
    } catch (error) {
      failures.push(`${version}: ${error.message}`);
    }
  }
  throw new Error(`GnomeDesktop typelib unavailable (${failures.join("; ")})`);
}

function callWithOptionalCancellable(method, receiver, args) {
  return method.length > args.length
    ? method.call(receiver, ...args, null)
    : method.call(receiver, ...args);
}

function createPoster(inputPath, requestedSize = 512) {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    return { ok: false, code: "invalid_request", message: "Missing video path" };
  }
  const { Gio } = imports.gi;
  const loaded = loadGnomeDesktop();
  const GnomeDesktop = loaded.module;
  const file = Gio.File.new_for_commandline_arg(inputPath);
  if (!file.query_exists(null)) {
    return { ok: false, code: "not_found", message: "Video file does not exist" };
  }
  const info = file.query_info(
    "standard::content-type,standard::type,time::modified",
    Gio.FileQueryInfoFlags.NONE,
    null,
  );
  if (info.get_file_type() !== Gio.FileType.REGULAR) {
    return { ok: false, code: "not_a_file", message: "Video path is not a regular file" };
  }
  const uri = file.get_uri();
  const mimeType = info.get_content_type() || "application/octet-stream";
  const mtime = info.get_attribute_uint64("time::modified");
  if (!mimeType.startsWith("video/")) {
    return { ok: false, code: "unsupported", message: `Not a video MIME type: ${mimeType}` };
  }
  const factory = GnomeDesktop.DesktopThumbnailFactory.new(
    requestedSize <= 128
      ? GnomeDesktop.DesktopThumbnailSize.NORMAL
      : GnomeDesktop.DesktopThumbnailSize.LARGE,
  );
  let output = factory.lookup(uri, mtime);
  if (output !== null) {
    return {
      ok: true, cached: true, output, mtime, mimeType,
      provider: "gnome-desktop", providerVersion: loaded.version,
    };
  }
  if (factory.has_valid_failed_thumbnail(uri, mtime)) {
    return { ok: false, code: "previous_failure", provider: "gnome-desktop" };
  }
  if (!factory.can_thumbnail(uri, mimeType, mtime)) {
    return { ok: false, code: "unsupported", provider: "gnome-desktop" };
  }
  const thumbnail = callWithOptionalCancellable(
    factory.generate_thumbnail, factory, [uri, mimeType],
  );
  if (thumbnail === null) {
    callWithOptionalCancellable(
      factory.create_failed_thumbnail, factory, [uri, mtime],
    );
    return { ok: false, code: "generation_failed", provider: "gnome-desktop" };
  }
  callWithOptionalCancellable(
    factory.save_thumbnail, factory, [thumbnail, uri, mtime],
  );
  output = factory.lookup(uri, mtime);
  if (output === null) {
    return {
      ok: false, code: "cache_write_failed",
      message: "GNOME generated a thumbnail but did not save it",
      provider: "gnome-desktop",
    };
  }
  return {
    ok: true, cached: false, output, mtime, mimeType,
    provider: "gnome-desktop", providerVersion: loaded.version,
  };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function handleRequest(request) {
  const id = request?.id ?? null;
  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return rpcError(id, -32600, "Invalid Request");
  }
  if (request.method === "poster.ready") {
    const loaded = loadGnomeDesktop();
    return {
      jsonrpc: "2.0", id,
      result: { ready: true, provider: "gnome-desktop", providerVersion: loaded.version },
    };
  }
  if (request.method !== "poster.generate") {
    return rpcError(id, -32601, "Method not found");
  }
  const options = Array.isArray(request.params) ? request.params[0] : request.params;
  if (!options || typeof options.path !== "string") {
    return rpcError(id, -32602, "Invalid params");
  }
  try {
    return {
      jsonrpc: "2.0", id,
      result: createPoster(options.path, Number(options.size) || 512),
    };
  } catch (error) {
    return {
      jsonrpc: "2.0", id,
      result: {
        ok: false,
        code: "internal_error",
        message: error?.message || `${error}`,
        provider: "gnome-desktop",
      },
    };
  }
}

const stdin = GLib.IOChannel.unix_new(0);
while (true) {
  const [status, line] = stdin.read_line();
  if (status === GLib.IOStatus.EOF) break;
  if (status !== GLib.IOStatus.NORMAL || !line?.trim()) continue;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    print(JSON.stringify(rpcError(null, -32700, "Parse error")));
    continue;
  }
  print(JSON.stringify(handleRequest(request)));
}
