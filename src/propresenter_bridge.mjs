import { spawn } from "child_process";
import { randomBytes } from "crypto";
import { access, mkdir, rm } from "fs/promises";
import net from "net";
import path from "path";

const DEFAULT_HTTP_HOST = "127.0.0.1";
const DEFAULT_HTTP_PORT = "50001";

function projectRootFromDerivedSource() {
  return path.dirname(path.dirname(import.meta.dirname));
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function makeBridgeEndpoint(app) {
  if (process.platform === "win32") {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    return {
      network: "tcp",
      address: `${address.address}:${address.port}`,
      server,
      cleanup: () => {},
    };
  }

  const dir = path.join(app.getPath("userData"), "propresenter-api");
  await mkdir(dir, { recursive: true });
  const socketPath = path.join(dir, `bridge-${process.pid}.sock`);
  await rm(socketPath, { force: true });
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    network: "unix",
    address: socketPath,
    server,
    cleanup: () => rm(socketPath, { force: true }).catch(() => {}),
  };
}

function sidecarBinaryCandidates(app) {
  const exe = process.platform === "win32" ? "propresenter-api.exe" : "propresenter-api";
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "sidecar", exe));
  }
  candidates.push(path.join(projectRootFromDerivedSource(), "sidecar", "bin", exe));
  return candidates;
}

async function resolveSidecarCommand(app) {
  for (const candidate of sidecarBinaryCandidates(app)) {
    if (await pathExists(candidate)) {
      return {
        command: candidate,
        args: [],
        cwd: projectRootFromDerivedSource(),
      };
    }
  }

  if (!app.isPackaged) {
    return {
      command: "go",
      args: ["run", "./sidecar/cmd/propresenter-api"],
      cwd: projectRootFromDerivedSource(),
    };
  }

  return null;
}

function writeJsonLine(socket, value) {
  socket.write(`${JSON.stringify(value)}\n`);
}

function attachBridgeConnection(socket, secret, handleRequest) {
  socket.setEncoding("utf8");
  let buffer = "";

  socket.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;

      void (async () => {
        let request;
        try {
          request = JSON.parse(line);
        } catch {
          writeJsonLine(socket, {
            id: null,
            error: { code: "bad_json", message: "Invalid JSON request." },
          });
          return;
        }

        const id = typeof request.id === "string" ? request.id : null;
        if (request.secret !== secret) {
          writeJsonLine(socket, {
            id,
            error: { code: "unauthorized", message: "Invalid bridge secret." },
          });
          return;
        }

        try {
          const result = await handleRequest(request.method, request.params || {});
          writeJsonLine(socket, { id, result });
        } catch (error) {
          writeJsonLine(socket, {
            id,
            error: {
              code: error?.code || "bridge_error",
              message: error?.message || "Bridge request failed.",
            },
          });
        }
      })();
    }
  });
}

export async function startProPresenterCompatibilitySidecar({
  app,
  handleRequest,
  isDevMode = false,
}) {
  const secret = randomBytes(32).toString("hex");
  const endpoint = await makeBridgeEndpoint(app);
  endpoint.server.on("connection", (socket) => {
    attachBridgeConnection(socket, secret, handleRequest);
  });

  const command = await resolveSidecarCommand(app);
  if (!command) {
    console.warn("ProPresenter API sidecar binary was not found.");
    return {
      stop: () => {
        endpoint.server.close();
        endpoint.cleanup();
      },
    };
  }

  const child = spawn(command.command, command.args, {
    cwd: command.cwd,
    env: {
      ...process.env,
      EMS_PROPRESENTER_API_HOST:
        process.env.EMS_PROPRESENTER_API_HOST || DEFAULT_HTTP_HOST,
      EMS_PROPRESENTER_API_PORT:
        process.env.EMS_PROPRESENTER_API_PORT || DEFAULT_HTTP_PORT,
      EMS_PROPRESENTER_BRIDGE_NETWORK: endpoint.network,
      EMS_PROPRESENTER_BRIDGE_ADDRESS: endpoint.address,
      EMS_PROPRESENTER_BRIDGE_SECRET: secret,
    },
    stdio: isDevMode ? "inherit" : ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  if (!isDevMode) {
    child.stdout?.on("data", (chunk) => {
      console.log(`[propresenter-api] ${String(chunk).trimEnd()}`);
    });
    child.stderr?.on("data", (chunk) => {
      console.error(`[propresenter-api] ${String(chunk).trimEnd()}`);
    });
  }

  child.on("error", (error) => {
    console.error("Failed to start ProPresenter API sidecar:", error);
  });
  child.on("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM") {
      console.error(
        `ProPresenter API sidecar exited with code ${code} signal ${signal || ""}`,
      );
    }
  });

  return {
    stop: () => {
      child.kill();
      endpoint.server.close();
      endpoint.cleanup();
    },
  };
}
