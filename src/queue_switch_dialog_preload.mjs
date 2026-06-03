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
  ipcRenderer.send(QUEUE_SWITCH_DIALOG_IPC_CHANNEL, accepted === true);
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

  const addResponseHandlers = (element, accepted) => {
    let responded = false;
    const handleResponse = (event) => {
      if (
        responded ||
        (typeof event.button === "number" && event.button !== 0)
      ) {
        return;
      }
      responded = true;
      event.preventDefault();
      event.stopPropagation();
      respond(accepted);
    };
    element.addEventListener("pointerdown", handleResponse, { capture: true });
    element.addEventListener("mousedown", handleResponse, { capture: true });
    element.addEventListener("pointerup", handleResponse, { capture: true });
    element.addEventListener("mouseup", handleResponse, { capture: true });
    element.addEventListener("click", handleResponse, { capture: true });
  };

  addResponseHandlers(cancel, false);
  addResponseHandlers(confirm, true);
  if (closeBtn) {
    addResponseHandlers(closeBtn, false);
  }
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
