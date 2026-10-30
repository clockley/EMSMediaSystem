/*
Copyright (C) 2026 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

/**
 * PowerPoint slide thumbnails drawn live by pptx-renderer.
 *
 * Shared by the media library cards and the stage display's "Next" card so
 * both show the same rendering. The caller imports the renderer module
 * itself: dynamic import specifiers resolve relative to the importing file,
 * and the control-window bundle and the stage module live at different
 * depths.
 */

import { enforcePptxCoverFit, getPptxPdfjsConfig } from "./app-pptx-utils.mjs";

/** pptx-renderer's browser build reads `process.env` at module evaluation. */
export function ensurePptxProcessEnv() {
  if (!globalThis.process) globalThis.process = { env: {} };
  else globalThis.process.env ||= {};
}

/**
 * Render one slide of `arrayBuffer` into `viewport`.
 *
 * @param {object} options
 * @param {{ PptxViewer: any, RECOMMENDED_ZIP_LIMITS: any }} options.renderer
 * @param {ArrayBuffer} options.arrayBuffer
 * @param {HTMLElement} options.viewport  Element that receives the slide.
 * @param {number} [options.width]        Thumbnail render width in CSS px.
 * @param {number} [options.slideIndex]   Zero-based slide index.
 * @param {string} [options.hostClassName] Class for the off-screen parse host.
 * @param {() => boolean} [options.isCurrent] Return false to abandon a stale render.
 * @returns {Promise<{ element: Element | null, dispose(): void } | null>}
 *   null when the render went stale; the caller owns `dispose()` otherwise.
 */
export async function renderPptxSlideThumbnail({
  renderer,
  arrayBuffer,
  viewport,
  width = 240,
  slideIndex = 0,
  hostClassName = "",
  isCurrent = () => true,
}) {
  const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = renderer || {};
  if (!PptxViewer || !arrayBuffer || !viewport) return null;
  const host = document.createElement("div");
  if (hostClassName) host.className = hostClassName;
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);
  let viewer = null;
  let handle = null;
  let retained = false;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try { handle?.dispose?.(); } catch {}
    try { viewer?.destroy?.(); } catch {}
    handle = null;
    viewer = null;
    host.remove();
  };
  try {
    viewer = await PptxViewer.open(arrayBuffer, host, {
      zipLimits: RECOMMENDED_ZIP_LIMITS,
      fitMode: "contain",
      renderMode: "slide",
      pdfjs: getPptxPdfjsConfig(),
    });
    if (!isCurrent()) return null;
    const requestedSlide = Number.isInteger(slideIndex) && slideIndex >= 0
      ? slideIndex
      : 0;
    handle = viewer.renderThumbnailToContainer(requestedSlide, viewport, {
      width: Math.max(180, Math.round(Number(width) || 240)),
    });
    await handle?.ready;
    if (!isCurrent()) return null;
    enforcePptxCoverFit(handle?.element);
    retained = true;
    return { element: handle?.element || null, dispose };
  } finally {
    if (!retained) dispose();
  }
}

/** Backwards-compatible convenience wrapper for media-library cue cards. */
export function renderPptxFirstSlideThumbnail(options) {
  return renderPptxSlideThumbnail({ ...options, slideIndex: 0 });
}
