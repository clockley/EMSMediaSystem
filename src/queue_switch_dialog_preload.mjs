/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
import { contextBridge, ipcRenderer } from "electron/renderer";

const QUEUE_SWITCH_DIALOG_IPC_CHANNEL = "queue-switch-dialog-response";

function respond(accepted) {
  return ipcRenderer.invoke(
    QUEUE_SWITCH_DIALOG_IPC_CHANNEL,
    accepted === true,
  );
}

contextBridge.exposeInMainWorld("queueSwitchDialog", { respond });

function wireDialogButtons() {
  document
    .getElementById("queue_switch_dialog_cancel")
    ?.addEventListener("click", () => {
      void respond(false);
    });
  document
    .getElementById("queue_switch_dialog_confirm")
    ?.addEventListener("click", () => {
      void respond(true);
    });
  document.querySelector(".window-control.close")?.addEventListener("click", () => {
    void respond(false);
  });
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", wireDialogButtons, { once: true });
} else {
  wireDialogButtons();
}
