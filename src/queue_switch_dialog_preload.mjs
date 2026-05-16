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

let queueSwitchDialogButtonsWired = false;

function wireDialogButtons() {
  if (queueSwitchDialogButtonsWired) {
    return;
  }
  const cancel = document.getElementById("queue_switch_dialog_cancel");
  const confirm = document.getElementById("queue_switch_dialog_confirm");
  const closeBtn = document.querySelector(".window-control.close");
  if (!cancel || !confirm) {
    return;
  }
  queueSwitchDialogButtonsWired = true;

  cancel.addEventListener("click", () => {
    void respond(false);
  });
  confirm.addEventListener("click", () => {
    void respond(true);
  });
  closeBtn?.addEventListener("click", () => {
    void respond(false);
  });
}

function wireDialogButtonsWhenReady() {
  wireDialogButtons();
  if (!queueSwitchDialogButtonsWired) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", wireDialogButtons, {
        once: true,
      });
    }
    requestAnimationFrame(() => {
      wireDialogButtons();
      if (!queueSwitchDialogButtonsWired) {
        setTimeout(wireDialogButtons, 0);
      }
    });
  }
}

wireDialogButtonsWhenReady();
