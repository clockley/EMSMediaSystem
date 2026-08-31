/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

"use strict";

let toastDeps = {
  getVideo: () => null,
};

export function configureToasts(deps = {}) {
  toastDeps = { ...toastDeps, ...deps };
}

function getPreviewVideo() {
  return toastDeps.getVideo?.() || null;
}

let hasShownPreviewWarning = false;
let toastTimer = null;
/** Auto-hide deadline (ms since epoch) for interactive #gnomeToast hover pause. */
let toastHideDeadline = 0;
/** AbortController for mouseenter/mouseleave on interactive toast. */
let toastHoverAbort = null;
/** onUndoExpire while an interactive undo toast is active (cleared on undo or dismiss). */
let activeInteractiveUndoExpire = null;

let previewToastTimer = null;

export function resetPreviewWarningState() {
  hasShownPreviewWarning = false;
}

/**
 * Dismisses a visible interactive undo toast: clears timers/hover, runs expire callback
 * (discards undo snapshot), and removes toast content. Used before new toasts or when
 * queue state changes and the old undo is no longer valid.
 */
function dismissInteractiveGnomeToastForReplacement() {
  if (toastHoverAbort) {
    toastHoverAbort.abort();
    toastHoverAbort = null;
  }
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  toastHideDeadline = 0;
  const toast = document.getElementById("gnomeToast");
  const hadInteractive = toast?.classList.contains("gnome-osd-toast--interactive");
  if (hadInteractive && typeof activeInteractiveUndoExpire === "function") {
    const fn = activeInteractiveUndoExpire;
    activeInteractiveUndoExpire = null;
    fn();
  } else {
    activeInteractiveUndoExpire = null;
  }
  if (hadInteractive && toast) {
    toast.classList.remove("visible");
    toast.replaceChildren();
    toast.classList.remove("gnome-osd-toast--interactive");
    toast.style.display = "none";
  }
}

export function invalidateQueueUndoToastAfterMutation() {
  dismissInteractiveGnomeToastForReplacement();
}

/**
 * @param {string} message
 * @param {number | { onUndo?: () => void; onUndoExpire?: () => void; duration?: number; undoLabel?: string; undoStyle?: "pill-accent" }} [durationOrOptions]
 */
export function showGnomeToast(message, durationOrOptions = 3000) {
  const FADE_OUT_DURATION = 300;
  let duration = 3000;
  /** @type {(() => void) | null} */
  let onUndo = null;
  /** @type {(() => void) | null} */
  let onUndoExpire = null;
  let undoLabel = "Undo";
  /** @type {"pill-accent" | null} */
  let undoStyle = null;

  if (typeof durationOrOptions === "number" && Number.isFinite(durationOrOptions)) {
    duration = durationOrOptions;
  } else if (
    durationOrOptions &&
    typeof durationOrOptions === "object" &&
    typeof durationOrOptions.onUndo === "function"
  ) {
    onUndo = durationOrOptions.onUndo;
    duration =
      typeof durationOrOptions.duration === "number"
        ? durationOrOptions.duration
        : 10000;
    if (typeof durationOrOptions.undoLabel === "string") {
      undoLabel = durationOrOptions.undoLabel;
    }
    if (typeof durationOrOptions.onUndoExpire === "function") {
      onUndoExpire = durationOrOptions.onUndoExpire;
    }
    if (durationOrOptions.undoStyle === "pill-accent") {
      undoStyle = "pill-accent";
    }
  }

  const interactive = onUndo !== null;
  /** @type {((ms: number) => void) | null} */
  let startInteractiveAutoHide = null;

  let toast = document.getElementById("gnomeToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "gnomeToast";
    toast.className = "gnome-osd-toast";
    document.body.appendChild(toast);
  }

  dismissInteractiveGnomeToastForReplacement();

  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  toastHideDeadline = 0;

  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.setAttribute("aria-atomic", "true");

  const dismissAfterUndo = () => {
    if (toastHoverAbort) {
      toastHoverAbort.abort();
      toastHoverAbort = null;
    }
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    toastHideDeadline = 0;
    activeInteractiveUndoExpire = null;
    toast.classList.remove("visible");
    setTimeout(() => {
      toast.style.display = "none";
      toast.replaceChildren();
      toast.classList.remove("gnome-osd-toast--interactive");
    }, FADE_OUT_DURATION);
  };

  if (interactive) {
    toast.classList.add("gnome-osd-toast--interactive");
    toast.replaceChildren();
    const msg = document.createElement("span");
    msg.className = "gnome-osd-toast__message";
    msg.textContent = message;
    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.className = "gnome-osd-toast__undo";
    undoBtn.textContent = undoLabel;
    undoBtn.setAttribute("aria-label", undoLabel);
    if (undoStyle === "pill-accent") {
      undoBtn.classList.add("gnome-osd-toast__undo--pill-accent");
    }

    activeInteractiveUndoExpire = onUndoExpire;

    const runUndoExpire = () => {
      const ex = activeInteractiveUndoExpire;
      activeInteractiveUndoExpire = null;
      if (typeof ex === "function") {
        ex();
      }
    };

    const ac = new AbortController();
    toastHoverAbort = ac;

    let resumeMs = duration;

    const finishTimeoutHide = () => {
      if (toastHoverAbort) {
        toastHoverAbort.abort();
        toastHoverAbort = null;
      }
      toast.classList.remove("visible");
      toastTimer = null;
      toastHideDeadline = 0;
      setTimeout(() => {
        toast.style.display = "none";
        toast.replaceChildren();
        toast.classList.remove("gnome-osd-toast--interactive");
        runUndoExpire();
      }, FADE_OUT_DURATION);
    };

    const scheduleHide = (ms) => {
      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
      if (ms <= 0) {
        finishTimeoutHide();
        return;
      }
      toastHideDeadline = Date.now() + ms;
      toastTimer = setTimeout(() => {
        toastTimer = null;
        finishTimeoutHide();
      }, ms);
    };

    toast.addEventListener(
      "mouseenter",
      () => {
        if (toastHideDeadline <= 0) return;
        if (toastTimer) {
          clearTimeout(toastTimer);
          toastTimer = null;
        }
        resumeMs = Math.max(0, toastHideDeadline - Date.now());
      },
      { signal: ac.signal },
    );

    toast.addEventListener(
      "mouseleave",
      () => {
        if (toastHideDeadline <= 0) return;
        scheduleHide(resumeMs);
      },
      { signal: ac.signal },
    );

    undoBtn.addEventListener("click", () => {
      if (toastHoverAbort) {
        toastHoverAbort.abort();
        toastHoverAbort = null;
      }
      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
      toastHideDeadline = 0;
      activeInteractiveUndoExpire = null;
      onUndo();
      dismissAfterUndo();
    });
    toast.appendChild(msg);
    toast.appendChild(undoBtn);
    toast.style.display = "flex";

    startInteractiveAutoHide = scheduleHide;
  } else {
    toast.classList.remove("gnome-osd-toast--interactive");
    toast.replaceChildren(document.createTextNode(message));
    toast.style.display = "block";
  }

  toast.classList.add("visible");

  if (startInteractiveAutoHide) {
    startInteractiveAutoHide(duration);
  } else {
    toastTimer = setTimeout(() => {
      toast.classList.remove("visible");
      toastTimer = null;
      setTimeout(() => {
        toast.style.display = "none";
        toast.classList.remove("gnome-osd-toast--interactive");
      }, FADE_OUT_DURATION);
    }, duration);
  }
}

export function showPreviewWarningToast() {
  const songsWorkspace = document.getElementById("songsWorkspace");
  const bibleWorkspace = document.getElementById("bibleWorkspace");
  if (songsWorkspace && !songsWorkspace.hidden) return;
  if (bibleWorkspace && !bibleWorkspace.hidden) return;

  const video = getPreviewVideo();
  // 1. Safety Check: Ensure video element exists
  if (!video) return;
  if (video.src === "") return;

  if (hasShownPreviewWarning) {
    return;
  }

  // 3. Find target container (Video parent)
  // We attach to the parentNode so the absolute positioning is relative to the container, not the window
  const container = video.parentNode;

  // Ensure container has relative positioning for the absolute toast to work
  if (window.getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }

  // 4. Create or Select the Toast Element
  let toast = container.querySelector(".gnome-osd-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "gnome-osd-toast";
    container.appendChild(toast);
  }

  // 5. Set Text (GNOME HID Compliant Message)
  toast.textContent =
    'Press "Present" to show on the selected display.';

  // 6. Manage Animation and Timer
  // Force a reflow to ensure the transition triggers if element was just added
  void toast.offsetWidth;

  // Show the toast
  requestAnimationFrame(() => {
    toast.classList.add("visible");
  });

  // Clear any existing timer to prevent premature removal
  if (previewToastTimer) {
    clearTimeout(previewToastTimer);
  }

  // Set 5-second timer to remove
  previewToastTimer = setTimeout(() => {
    // Check if the toast element still exists in the DOM before manipulating classes
    if (!toast || !toast.parentNode) {
      previewToastTimer = null;
      return; // Exit if the toast or its parent is already gone
    }

    toast.classList.remove("visible");

    // Wait for CSS transition (250ms) to finish before removing from DOM
    setTimeout(() => {
      // Double-check the parent's existence right before removal
      if (toast && toast.parentNode) {
        // Use try...catch as a final safety measure against unexpected detachment
        try {
          toast.parentNode.removeChild(toast);
        } catch (e) {
          // Log the error if removal fails, but continue the cleanup
          // console.error("Toast removal failed:", e);
        }
      }
      previewToastTimer = null;
    }, 250);
  }, 5000);

  hasShownPreviewWarning = true;
}

