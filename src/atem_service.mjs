/* Copyright (C) 2026 Christian Lockley — GPL-3.0-or-later */

import { AtemRpcClient } from "./atem_rpc_client.min.mjs";

export class AtemService {
  constructor(options) {
    this.connectionState = { connected: false, connecting: false, host: null, product: null };
    this.client = new AtemRpcClient({
      ...options,
      onNotification: (method, params) => {
        if (method === "atem.connectionChanged") {
          this.connectionState = { ...params };
          options?.onConnectionChanged?.(this.connectionState);
        }
      },
    });
  }

  async connect(host) {
    this.connectionState = await this.client.call("atem.connect", { host });
    return this.connectionState;
  }

  async disconnect() {
    this.connectionState = await this.client.call("atem.disconnect");
    return this.connectionState;
  }

  async status() {
    this.connectionState = await this.client.call("atem.status");
    return this.connectionState;
  }

  setProgramInput(input, me = 0) {
    return this.client.call("atem.setProgramInput", { input, me });
  }

  setPreviewInput(input, me = 0) {
    return this.client.call("atem.setPreviewInput", { input, me });
  }

  stop() {
    this.client.stop();
  }
}
