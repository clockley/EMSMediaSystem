/*
Copyright (C) 2019-2024 Christian Lockley

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

/** Hidden host for the persistent <video id="preview"> across tab switches. */
export const PREVIEW_STASH_ID = "previewStash";
/** Persistent tab shells under `#dyneForm` — built once, shown/hidden per tab. */
export const TAB_PANEL_MEDIA_ID = "tab-panel-media";
export const TAB_PANEL_STREAMS_ID = "tab-panel-streams";

export function generateDyneTabShellHTML() {
  return (
    `<div id="${TAB_PANEL_MEDIA_ID}" class="tab-panel tab-panel--media"></div>` +
    `<div id="${TAB_PANEL_STREAMS_ID}" class="tab-panel tab-panel--streams" hidden></div>`
  );
}

export function generateStreamsPanelHTML() {
  return `
    <div class="media-container">
        <div class="video-wrapper stream-preview-host" data-network-stream-active="false">
            <video id="streamRendererPreview" class="stream-renderer-preview" autoplay muted playsinline disablePictureInPicture hidden></video>
            <div id="streamPreviewEmptyState" class="stream-preview-empty-state" role="status" aria-live="polite">
                <svg class="stream-preview-empty-state__icon" viewBox="0 0 64 64" aria-hidden="true">
                    <rect x="12" y="14" width="40" height="28" rx="4" fill="none" stroke="currentColor" stroke-width="3"/>
                    <path d="M25 50h14M32 42v8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                    <path d="M22 28h8m4 0h8M24 34h16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.55"/>
                    <path d="M20 20l24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                </svg>
                <span>No network streams loaded</span>
            </div>
        </div>
        <div class="control-panel">
            <div class="control-group">
                <span class="control-label">URL</span>
                <input type="url"
                       name="mdFile"
                       id="mdFile"
                       placeholder="Paste your video URL here..."
                       class="url-input"
                       accept="video/mp4,video/x-m4v,video/*,audio/x-m4a,audio/*">
            </div>

            <div class="control-group">
                <span class="control-label">Display</span>
                <select name="dspSelctStreams" id="dspSelctStreams" class="display-select">
                    <option value="" disabled>Select Display</option>
                </select>
            </div>

            <div class="control-group">
                <span class="control-label">Volume</span>
                <div class="volume-control">
                    <input
                    id="volume-slider"
                    class="volume-slider"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value="1"
                    >
                </div>
            </div>
        </div>
    </div>
    `;
}

export function generateMediaFormHTML() {
  return `
  <div class="media-container">
    <form onsubmit="return false;" class="control-panel control-panel--media">
      <!--
        Schedule is the dominant sidebar content per GNOME HIG adaptive guidance:
        primary task surface fills the space, secondary controls (output
        selector, switches) sit below in a collapsed expander so the schedule
        gets every spare pixel.
      -->
      <div class="queue-section">
        <div class="list-header">
          <span class="queue-section-title">Schedule</span>
          <button type="button" id="clearQueueBtn" class="pill-button destructive-action" title="Clear the schedule" aria-label="Clear schedule" hidden>Clear</button>
        </div>
        <div id="mediaQueueList" class="boxed-list" role="list" aria-label="Schedule">
          <div class="list-placeholder">
            <span class="list-placeholder-title">No items scheduled</span>
            <span class="list-placeholder-hint">Add media or Bible text to begin</span>
          </div>
        </div>
      </div>

      <button type="button" id="openBibleWorkspaceBtn" class="sidebar-bible-button">
        Bible
      </button>

      <div id="confidenceMonitor" class="confidence-monitor" aria-label="Live audience output">
        <video id="confidenceMonitorPreview" class="confidence-monitor__video" autoplay muted playsinline disablePictureInPicture></video>
      </div>

      <!--
        Settings expander: Output Display and Autoplay. Collapsed by default
        to maximize schedule real estate; open-state is persisted to localStorage
        so users who routinely toggle the switches don't have to re-expand
        each session.
      -->
      <details class="options-expander" id="mediaOptionsExpander">
        <summary class="options-expander__summary">
          <span class="options-expander__title">Settings</span>
          <svg class="options-expander__chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M6 4l4 4-4 4"/>
          </svg>
        </summary>
        <div class="options-expander__body">
          <div class="control-group">
            <span class="control-label">Output Display</span>
            <div class="display-select-group">
              <select name="dspSelct" id="dspSelct" class="display-select">
                <option value="" disabled>--Select Display Device--</option>
              </select>
            </div>
          </div>

          <div class="control-group media-toggle-rows">
            <div class="loop-control">
              <span class="control-label">Autoplay</span>
              <label class="switch">
                <input type="checkbox" checked name="autoPlayCtl" id="autoPlayCtl">
                <span class="switch-track"></span>
                <span class="switch-thumb"></span>
              </label>
            </div>
          </div>
        </div>
      </details>
    </form>

    <div class="video-wrapper">
      <div id="previewStack" class="preview-stack" data-active-surface="live">
        <video id="preview" disablePictureInPicture controls=false></video>
        <!--
          Dedicated cue scrub element. The main #preview element used to be
          re-loaded with the cued media's src when the operator clicked a
          non-live queue item, which forcibly paused the live mirror. With
          a separate #previewCue overlay the main mirror keeps playing
          uninterrupted while the operator scrubs the cued item on top of
          it. Hidden by default; revealed only while a video cue is loaded.
        -->
        <!--
          controls is a boolean HTML attribute: any value (even "false") turns
          the native scrubber on. We omit the attribute entirely and re-assert
          controls=false in JS (see ensurePreviewCueVideoElement) so the
          operator never sees two scrubbers — the custom controls bar and the
          browser's stock <video> chrome — stacked on top of each other.
        -->
        <video id="previewCue" class="preview-cue-overlay" disablePictureInPicture muted hidden></video>
        <div id="bibleWorkspace" class="bible-workspace" hidden>
        <aside class="bible-workspace__navigator" aria-label="Bible chapter navigator">
          <div class="bible-workspace__heading">Bible</div>
          <div class="bible-workspace__selectors">
            <select id="bibleVersionSelect" class="display-select" aria-label="Bible version"></select>
          </div>
          <div class="bible-reference-field">
            <input
              type="text"
              class="url-input"
              id="bibleReferenceInput"
              autocomplete="off"
              placeholder="Enter reference"
              aria-haspopup="listbox"
              aria-expanded="false"
              aria-controls="bibleReferenceSuggestions"
            >
            <button
              type="button"
              class="bible-reference-toggle"
              id="bibleReferenceToggle"
              aria-label="Show Bible books"
              aria-haspopup="listbox"
              aria-expanded="false"
              aria-controls="bibleReferenceSuggestions"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M4 6l4 4 4-4"/>
              </svg>
            </button>
            <div
              id="bibleReferenceSuggestions"
              class="bible-reference-suggestions"
              role="listbox"
              aria-label="Bible reference suggestions"
              hidden
            ></div>
          </div>
          <div id="bibleVerseList" class="bible-verse-list" role="listbox" aria-label="Chapter verses">
            <div class="list-placeholder">
              <span class="list-placeholder-title">Loading Bible…</span>
            </div>
          </div>
        </aside>
        <section class="bible-workspace__main" aria-label="Bible text preview editor">
          <div class="bible-workspace__toolbar">
            <span id="bibleWorkspaceTitle" class="bible-workspace__title">Bible</span>
            <div class="bible-action-row">
              <button type="button" id="bibleShowNowBtn" class="pill-button suggested-action">Show Now</button>
              <button type="button" id="bibleInsertQueueBtn" class="pill-button secondary">Add to Schedule</button>
            </div>
          </div>
          <div id="biblePreviewPanel" class="bible-preview-panel">
            <video id="biblePreviewBackgroundVideo" class="bible-preview-background-video" muted loop playsinline hidden></video>
            <div class="bible-preview-copy">
              <div class="bible-preview-body-anchor">
                <div id="biblePreviewText" class="bible-preview-text"></div>
              </div>
              <div id="biblePreviewReference" class="bible-preview-reference"></div>
            </div>
          </div>
          <div class="bible-editor-drawer">
            <div class="bible-editor-controls">
              <div class="bible-editor-fields">
                <label class="bible-field bible-field--font">Font <input id="bibleFontInput" type="text" class="url-input" value="'CMG Sans'"></label>
                <label class="bible-field">Size <input id="bibleFontSizeInput" type="number" min="24" max="160" value="66" class="url-input"></label>
                <label class="bible-field">Text <input id="bibleTextColorInput" type="color" value="#ffffff"></label>
                <label class="bible-field">Backdrop <input id="bibleBackgroundColorInput" type="color" value="#000000"></label>
                <label class="file-input-label bible-background-picker">
                  <input id="bibleBackgroundInput" type="file" accept="image/*,video/*" hidden>
                  <span id="bibleBackgroundLabel">Choose Background…</span>
                </label>
              </div>
              <div class="bible-editor-actions">
                <button type="button" id="bibleApplyFontAllBtn" class="pill-button secondary">Apply Font to All</button>
                <button type="button" id="bibleApplyFontSizeAllBtn" class="pill-button secondary">Apply Size to All</button>
                <button type="button" id="bibleApplyTextColorAllBtn" class="pill-button secondary">Apply Text Color to All</button>
                <button type="button" id="bibleApplyBackgroundAllBtn" class="pill-button secondary">Apply Bg to All Text</button>
                <button type="button" id="bibleClearBackgroundBtn" class="pill-button secondary">Remove Background</button>
              </div>
            </div>
          </div>
        </section>
        </div>
        <div id="pptxPreviewContainer"></div>
        <div id="previewEmptyState" class="preview-empty-state" hidden>
          <div class="preview-empty-state__card" role="button" tabindex="0" aria-label="Add media to schedule">
            <svg class="preview-empty-state__icon" width="48" height="48" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
                    d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>
              <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                    d="M12 11v6M9 14h6"/>
            </svg>
            <span class="preview-empty-state__title">Drop media here</span>
            <span class="preview-empty-state__hint">or click <strong>Add Media</strong></span>
          </div>
        </div>
        <div id="audioCuePanel" class="audio-cue-panel" hidden>
          <div class="audio-cue-icon" aria-hidden="true">Audio</div>
          <div class="audio-cue-copy">
            <span class="audio-cue-heading">Preview / Cue Audio Track</span>
            <span id="audioCueTitle" class="audio-cue-title"></span>
            <span id="audioCueStart" class="audio-cue-start">Start from: 0:00.000</span>
            <span id="audioCueHelp" class="audio-cue-help">Scrubbing is silent so the live output is not interrupted.</span>
          </div>
        </div>
      </div>
      <div id="mediaCntDn"></div>

      <div id="customControls" class="controls-overlay">

        <button class="control-button custom-media-control" id="mediaWindowRepeatButton" title="Loop off" aria-label="Loop playback" aria-pressed="false">
            <svg viewBox="0 0 24 24">
                <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v3z"/>
            </svg>
        </button>
        <span id="loopStatusBadge" class="loop-status-badge" hidden>Loop On</span>

        <button class="control-button" id="playPauseBtn">
            <svg viewBox="0 0 24 24" id="playPauseIcon"><path d="M8 5v14l11-7z"/></svg>
        </button>

        <span class="time-display" id="currentTime">0:00</span>
        <input type="range" min="0" max="100" value="0" step="0.1" class="timeline-slider" id="timeline">
        <span class="time-display" id="durationTime">0:00</span>

        <div class="gtk-volume-popover" id="gtkVolPopover">
        <button class="gtk-control-btn" id="gtkVolBtn" aria-label="Volume">
            <svg id="gtkVolIcon" viewBox="0 0 16 16" fill="currentColor">
                <path d="M 1 5 L 4 5 L 7 2 L 7 14 L 4 11 L 1 11 Z"/>
                <path d="M 9 7.5 C 9.5 7.5 9.5 8.5 9 8.5" fill="none" stroke="currentColor" stroke-width="1" id="arc1"/>
                <path d="M 10 6 C 11 6 11 10 10 10" fill="none" stroke="currentColor" stroke-width="1" id="arc2"/>
                <path d="M 12 4 C 14 4 14 12 12 12" fill="none" stroke="currentColor" stroke-width="1" id="arc3"/>
            </svg>
        </button>

          <div class="gtk-volume-slider-container">
            <input id="gtkVolSlider"
                   type="range"
                   min="0" max="100" value="100"
                   step="1"
                   orient="vertical"
                   class="gtk-volume-slider-vertical">
          </div>
        </div>

      </div>
    </div>
  </div>`;
}

export function queueTypeIconMarkup(itemOrType) {
  const item =
    typeof itemOrType === "object" && itemOrType !== null
      ? itemOrType
      : { type: itemOrType };
  if (item?.missing) {
    return `<svg class="queue-item-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.5l6.2 11A1 1 0 0 1 13.3 14H2.7a1 1 0 0 1-.9-1.5l6.2-11zM7.3 6.2v3.9h1.4V6.2H7.3zm0 5.2v1.4h1.4v-1.4H7.3z"/></svg>`;
  }
  const type = item.type;
  switch (type) {
    case "video":
      return `<svg class="queue-item-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V8.5l3 2V4.5l-3 2V4a1 1 0 0 0-1-1H2z"/></svg>`;
    case "audio":
      return `<svg class="queue-item-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M12 1v9.5a2.5 2.5 0 1 1-1-2.15V5H8V1h4zM5.5 9A1.5 1.5 0 1 0 7 10.5 1.5 1.5 0 0 0 5.5 9z"/></svg>`;
    case "image":
      return `<svg class="queue-item-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 2h12v12H2V2zm1 1v8.59l2.5-2.5 2 2L13 5.41V3H3zm7.5 1a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/></svg>`;
    case "pptx":
      return `<svg class="queue-item-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 2h8l4 4v8H2V2zm8 1.2V6h2.8L10 3.2zM4 8h8v1H4V8zm0 2h8v1H4v-1z"/></svg>`;
    case "bible":
      return `<svg class="queue-item-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3 1.5h8.5A1.5 1.5 0 0 1 13 3v11.5H4.5A1.5 1.5 0 0 1 3 13V1.5zM4.5 12.5a.5.5 0 0 0 0 1H12v-1H4.5zM6 4h4v1H8.5v4H7.5V5H6V4z"/></svg>`;
    default:
      return `<svg class="queue-item-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3 2h10v12H3V2zm1 1v10h8V3H4zm1 1h6v1H5V4zm0 2h4v1H5V6zm0 2h6v1H5V8z"/></svg>`;
  }
}
