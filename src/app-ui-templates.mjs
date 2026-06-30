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
                    <option value="">No Output</option>
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
      
      <button type="button" id="openSongsWorkspaceBtn" class="sidebar-songs-button">
        Songs
      </button>

      <button type="button" id="openSlidesWorkspaceBtn" class="sidebar-slides-button">
        Slides
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
                <option value="">No Audience Output</option>
              </select>
            </div>
          </div>

          <div class="control-group" data-lower-third-feature hidden>
            <span class="control-label">Lower Third Display</span>
            <div class="display-select-group">
              <select name="lowerThirdDspSelct" id="lowerThirdDspSelct" class="display-select">
                <option value="">No Lower Third Output</option>
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

          <div class="control-group">
            <span class="control-label">Slide Transition</span>
            <div class="transition-inline-controls transition-inline-controls--global">
              <select id="globalSlideTransitionEffect" class="display-select" aria-label="Default slide transition">
                <option value="none">Off</option>
                <option value="fade">Fade</option>
                <option value="slide-left">Slide Left</option>
                <option value="slide-right">Slide Right</option>
                <option value="zoom">Zoom</option>
              </select>
              <input id="globalSlideTransitionDuration" class="url-input transition-duration-input" type="number" min="0" max="3000" step="50" value="350" aria-label="Default transition duration in milliseconds">
            </div>
          </div>
        </div>
      </details>
    </form>

    <div class="video-wrapper">
      <div id="previewStack" class="preview-stack" data-active-surface="live">
        <video id="preview" disablePictureInPicture></video>
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
          native controls disabled in JS (see ensurePreviewCueVideoElement) so the
          operator never sees two scrubbers — the custom controls bar and the
          browser's stock <video> chrome — stacked on top of each other.
        -->
        <video id="previewCue" class="preview-cue-overlay" disablePictureInPicture muted hidden></video>
        
        <div id="songsWorkspace" class="songs-workspace" hidden>
          <aside class="songs-workspace__navigator" aria-label="Songs navigator">
            <div class="songs-workspace__nav-header">
              <span class="songs-workspace__heading">Songs</span>
              <div class="songs-workspace__nav-actions">
                <button type="button" id="importSongBtn" class="songs-icon-btn" title="Import songs" aria-label="Import songs">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 1.5h5.5L13 5v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-13z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9.5 1.5v3.5h3.5" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M1 8h5M4 5.5L6.5 8 4 10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
                <button type="button" id="newSongBtn" class="songs-icon-btn songs-icon-btn--suggested" title="New song" aria-label="New song">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                </button>
              </div>
            </div>
            <div class="songs-search-field">
              <svg class="songs-search-field__icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              <input type="text" id="songsSearchInput" placeholder="Search songs…" aria-label="Search songs">
              <button type="button" id="songsSearchClearBtn" class="songs-search-field__clear" aria-label="Clear search" hidden>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              </button>
            </div>
            <div id="songsBulkActions" class="songs-bulk-actions" hidden>
              <span id="songsBulkCount" class="songs-bulk-actions__count">0 selected</span>
              <select id="songsBulkMoveFolder" aria-label="Move selected songs to folder">
                <option value="">Move to folder…</option>
                <option value="__unfiled__">Default</option>
              </select>
              <button type="button" id="songsBulkMoveBtn" class="pill-button">Move</button>
              <button type="button" id="songsBulkScheduleBtn" class="pill-button">Schedule</button>
              <button type="button" id="songsBulkDeleteBtn" class="pill-button">Delete</button>
              <button type="button" id="songsBulkClearBtn" class="pill-button">Clear</button>
            </div>
            <div class="songs-folder-panel" aria-label="Song folders">
              <div class="songs-folder-panel__header">
                <span class="songs-folder-panel__title">Folders</span>
                <button type="button" id="newSongFolderBtn" class="songs-icon-btn songs-icon-btn--small" title="New folder" aria-label="New folder">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                </button>
              </div>
              <div id="songsFolderList" class="songs-folder-list" role="listbox" aria-label="Song folders"></div>
            </div>
            <div id="songsList" class="songs-list" role="listbox">
               <span class="list-placeholder-title">No songs found</span>
            </div>
            <div id="songFolderPrompt" class="song-folder-prompt" hidden>
              <form id="songFolderPromptForm" class="song-folder-prompt__card">
                <label class="song-folder-prompt__label" for="songFolderPromptInput">New folder</label>
                <input type="text" id="songFolderPromptInput" class="song-folder-prompt__input" placeholder="Songbook or hymnal name" aria-label="Folder name" required>
                <div class="song-folder-prompt__actions">
                  <button type="button" id="songFolderPromptCancel" class="pill-button">Cancel</button>
                  <button type="submit" class="pill-button primary-action">Create</button>
                </div>
              </form>
            </div>
          </aside>
          <section class="songs-workspace__main" aria-label="Songs preview">
             <div class="songs-workspace__toolbar">
               <span id="songsWorkspaceTitle" class="songs-workspace__title">Select a Song</span>
               <div class="songs-workspace__actions-end">
                 <label class="songs-folder-move-field">
                   <span class="visually-hidden">Move to folder</span>
                   <select id="songsMoveFolderSelect" aria-label="Move song to folder" disabled>
                     <option value="">Move to folder…</option>
                   </select>
                 </label>
                 <div class="songs-workspace__btn-group">
                   <button type="button" id="songsShowNowBtn" class="songs-action-btn songs-action-btn--suggested" disabled title="Present this song on the audience display">
                     <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 3h14v9H1z" stroke="currentColor" stroke-width="1.4"/><path d="M5 14h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M6.5 6l4 2.5-4 2.5z" fill="currentColor"/></svg>
                     <span>Show Now</span>
                   </button>
                    <button type="button" id="songsAddScheduleBtn" class="songs-action-btn" disabled title="Add to the presentation schedule (or drag a song from the list)">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                      <span>Schedule</span>
                    </button>
                    <button type="button" id="songsSaveToLibraryBtn" class="songs-action-btn" disabled title="Save this song to the song library" hidden>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      <span>Save to Library</span>
                    </button>
                 </div>
                 <div class="songs-workspace__btn-group songs-workspace__btn-group--secondary">
                   <button type="button" id="songsEditBtn" class="songs-icon-btn" disabled title="Edit song lyrics">
                     <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.5l3 3L5 14H2v-3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9.5 3.5l3 3" stroke="currentColor" stroke-width="1.4"/></svg>
                   </button>
                   <button type="button" id="songsDeleteBtn" class="songs-icon-btn songs-icon-btn--destructive" disabled title="Delete song">
                     <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4h10l-1 10H4z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M2 4h12M6 2h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M6 7v4M8 7v4M10 7v4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
                   </button>
                 </div>
               </div>
             </div>
              <div class="song-arrangement-wrapper">
                <button type="button" id="songPrevSecBtn" class="pill-button songs-nav-btn" disabled title="Previous slide">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
                <div id="songArrangementStrip" class="song-arrangement-strip"></div>
                <button type="button" id="songNextSecBtn" class="pill-button songs-nav-btn" disabled title="Next slide">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
              </div>
             <div class="songs-preview-container">
               <div id="songsLauncher" class="songs-launcher">
                 <button class="songs-launcher-item" id="launcherEditSongsBtn">
                   <div class="songs-launcher-icon">
                     <svg viewBox="0 0 48 48" width="72" height="72"><path fill="currentColor" d="M6 34.5V42h7.5l22.13-22.13-7.5-7.5L6 34.5zm35.41-20.41c.78-.78.78-2.05 0-2.83l-4.67-4.67a2.003 2.003 0 0 0-2.83 0l-3.66 3.66 7.5 7.5 3.66-3.66z"/></svg>
                   </div>
                   <div class="songs-launcher-label">Edit Songs</div>
                 </button>
                 <button class="songs-launcher-item" id="launcherSearchSongsBtn">
                   <div class="songs-launcher-icon">
                     <svg viewBox="0 0 48 48" width="72" height="72"><path fill="currentColor" d="M31 28h-1.59l-.55-.55C30.82 25.18 32 22.23 32 19c0-7.18-5.82-13-13-13S6 11.82 6 19s5.82 13 13 13c3.23 0 6.18-1.18 8.45-3.13l.55.55V31l10 9.98L40.98 38 31 28zm-12 0c-4.97 0-9-4.03-9-9s4.03-9 9-9 9 4.03 9 9-4.03 9-9 9z"/></svg>
                   </div>
                   <div class="songs-launcher-label">Search Songs</div>
                 </button>
               </div>
               <div id="songsPreviewSlide" class="songs-preview-slide" hidden></div>
                      <div id="songEditorDrawer" class="song-editor-drawer" hidden>
                <div class="song-editor-drawer__headerbar">
                  <button type="button" id="songEditorCancelBtn" class="songs-icon-btn" title="Cancel editing" aria-label="Cancel editing">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                  </button>
                  <span class="song-editor-drawer__title" id="songEditorHeaderTitle">Edit Song</span>
                  <button type="button" id="songEditorSaveScheduleBtn" class="songs-action-btn songs-action-btn--compact">
                    <span>Save to Schedule</span>
                  </button>
                  <button type="button" id="songEditorSaveBtn" class="songs-action-btn songs-action-btn--suggested songs-action-btn--compact">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    <span>Save to Library</span>
                  </button>
                </div>
                <div class="song-editor-drawer__body">
                  <!-- Left Sidebar (Navigator + Properties Tabs) -->
                  <div class="song-editor-sidebar">
                    <!-- Segmented Tabs Control -->
                    <div class="song-editor-segmented-tabs">
                      <button type="button" id="songEditorTabSlidesBtn" class="song-editor-tab-btn active">Slides</button>
                      <button type="button" id="songEditorTabPropsBtn" class="song-editor-tab-btn">Properties</button>
                    </div>

                    <!-- Tab 1: Slides Navigator -->
                    <div id="songEditorTabSlides" class="song-editor-sidebar__tab-content">
                      <div id="songEditorSlideList" class="song-editor-slide-list"></div>
                      <div class="song-editor-slide-controls">
                        <button type="button" id="songEditorAddSlideBtn" title="Add slide/section">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3v10M3 8h10" stroke-linecap="round"/></svg>
                          <span>Add</span>
                        </button>
                        <button type="button" id="songEditorDeleteSlideBtn" title="Delete selected slide/section">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 5h10M5 5v8a1 1 0 001 1h4a1 1 0 001-1V5M6.5 5V3a1 1 0 011-1h1a1 1 0 011 1v2" stroke-linecap="round"/></svg>
                          <span>Delete</span>
                        </button>
                        <button type="button" id="songEditorMoveUpBtn" title="Move selected slide up">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 13V3M4 7l4-4 4 4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                          <span>Up</span>
                        </button>
                        <button type="button" id="songEditorMoveDownBtn" title="Move selected slide down">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3v10M4 9l4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                          <span>Down</span>
                        </button>
                      </div>
                    </div>

                    <!-- Tab 2: Properties Editor -->
                    <div id="songEditorTabProps" class="song-editor-sidebar__tab-content" style="display: none;">
                      <!-- Song Info Boxed List -->
                      <div class="boxed-list-group">
                        <div class="boxed-list-title">Song Info</div>
                        <div class="boxed-list">
                          <div class="boxed-list-row">
                            <label for="songEditorTitle">Title</label>
                            <input type="text" id="songEditorTitle" placeholder="Song Title" aria-label="Song Title">
                          </div>
                          <div class="boxed-list-row">
                            <label for="songEditorNumber">Number</label>
                            <input type="number" id="songEditorNumber" class="song-editor-number" min="1" placeholder="#" aria-label="Song number">
                          </div>
                          <div class="boxed-list-row">
                            <label for="songEditorAuthor">Author</label>
                            <input type="text" id="songEditorAuthor" placeholder="Author (e.g., John Newton)" aria-label="Author">
                          </div>
                          <div class="boxed-list-row">
                            <label for="songEditorFolder">Folder</label>
                            <select id="songEditorFolder" aria-label="Song folder">
                              <option value="">Default</option>
                            </select>
                          </div>
                        </div>
                      </div>



                      <!-- Presentation Boxed List -->
                      <div class="boxed-list-group">
                        <div class="boxed-list-title">Theme & Styling</div>
                        <div class="boxed-list">
                          <div class="boxed-list-row">
                            <label for="songEditorFontInput">Font Family</label>
                            <select id="songEditorFontInput" class="display-select">
                              <option value="'CMG Sans'">CMG Sans</option>
                              <option value="'Adwaita'">Adwaita</option>
                              <option value="'Arial'">Arial</option>
                              <option value="'Calibri'">Calibri</option>
                              <option value="'Cambria'">Cambria</option>
                              <option value="'Georgia'">Georgia</option>
                              <option value="'Segoe UI'">Segoe UI</option>
                              <option value="'Tahoma'">Tahoma</option>
                              <option value="'Times New Roman'">Times New Roman</option>
                              <option value="'Verdana'">Verdana</option>
                            </select>
                          </div>
                          <div class="boxed-list-row">
                            <label for="songEditorFontSizeInput">Font Size</label>
                            <input id="songEditorFontSizeInput" type="number" min="24" max="160" value="66">
                          </div>
                          <div class="boxed-list-row">
                            <label for="songEditorStyleScope">Apply To</label>
                            <select id="songEditorStyleScope" class="display-select">
                              <option value="allSlides">All Slides</option>
                              <option value="page">Current Slide</option>
                              <option value="selection">Current Text</option>
                            </select>
                          </div>
                          <div class="boxed-list-row">
                            <label for="songEditorTransitionEffect">Transition</label>
                            <div class="transition-inline-controls">
                              <select id="songEditorTransitionEffect" class="display-select" aria-label="Song slide transition">
                                <option value="inherit">Use Global</option>
                                <option value="none">Off</option>
                                <option value="fade">Fade</option>
                                <option value="slide-left">Slide Left</option>
                                <option value="slide-right">Slide Right</option>
                                <option value="zoom">Zoom</option>
                              </select>
                              <input id="songEditorTransitionDuration" class="url-input transition-duration-input" type="number" min="0" max="3000" step="50" value="350" aria-label="Song transition duration in milliseconds">
                            </div>
                          </div>
                          <div class="boxed-list-row">
                            <label for="songEditorTextColor">Text Color</label>
                            <div style="position: relative; display: flex; align-items: center; gap: 8px; flex: 1;">
                              <input type="color" id="songEditorTextColor" value="#ffffff" aria-label="Song text color" style="width: 40px; height: 28px; border: 1px solid var(--border-color); border-radius: 4px; padding: 0; cursor: pointer;">
                              <span style="font-size: 12px; color: var(--text-color-secondary);">Select color</span>
                            </div>
                          </div>
                          <div class="boxed-list-row">
                            <label for="songEditorBackgroundColor">Background</label>
                            <div style="position: relative; display: flex; align-items: center; gap: 8px; flex: 1;">
                              <input type="color" id="songEditorBackgroundColor" value="#000000" aria-label="Song background color" style="width: 40px; height: 28px; border: 1px solid var(--border-color); border-radius: 4px; padding: 0; cursor: pointer;">
                              <span style="font-size: 12px; color: var(--text-color-secondary);">Select color</span>
                            </div>
                          </div>
                          <div class="boxed-list-row">
                            <label>Image/Video</label>
                            <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;">
                              <button type="button" class="songs-icon-btn" title="Choose Background" style="position: relative; overflow: hidden; width: 32px; height: 32px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border-color); border-radius: 6px;">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"><rect x="2" y="3" width="12" height="10" rx="1.5" stroke-width="1.5"/><circle cx="5.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/><path d="M2 10l3-3 4 4 2-2 3 3" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                                <input type="file" id="songEditorBackgroundInput" accept="image/*,video/mp4,video/webm,video/quicktime" aria-label="Song background image or video" style="opacity: 0; position: absolute; inset: 0; cursor: pointer; width: 100%; height: 100%;">
                              </button>
                              <button type="button" id="songEditorClearBackgroundBtn" class="songs-icon-btn" title="Clear Background Image" aria-label="Clear background image" style="width: 32px; height: 32px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border-color); border-radius: 6px;">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="M12 4L4 12M4 4l8 8" stroke-width="1.5" stroke-linecap="round"/></svg>
                              </button>
                              <span id="songEditorBackgroundLabel" class="song-editor-background-label" style="font-size: 11px; margin-left: 4px;"></span>
                            </div>
                          </div>
                          <div class="boxed-list-row">
                            <label for="songEditorAutosizeModeInput">Autofit</label>
                            <select id="songEditorAutosizeModeInput">
                              <option value="fit">Fit</option>
                              <option value="normalize">Normalize</option>
                              <option value="none">Off</option>
                            </select>
                          </div>
                          <div class="boxed-list-row">
                            <label for="songEditorMinFontSizeInput">Min Size</label>
                            <input id="songEditorMinFontSizeInput" type="number" min="20" max="160" value="38">
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Center Pane: WYSIWYG Slide Content Editor -->
                  <div class="song-editor-workspace">
                    <div class="song-editor-workspace__toolbar">
                      <div class="song-editor-slide-meta-row">
                        <span class="song-editor-row-label">Slide Label</span>
                        <select id="songEditorSectionType" class="display-select" style="width: 120px;">
                          <option value="Verse">Verse</option>
                          <option value="Chorus">Chorus</option>
                          <option value="Bridge">Bridge</option>
                          <option value="Pre-Chorus">Pre-Chorus</option>
                          <option value="Tag">Tag</option>
                          <option value="Custom">Custom</option>
                        </select>
                        <input type="number" id="songEditorSectionNumber" min="1" value="1" style="width: 60px; height: 28px; border: 1px solid var(--border-color); border-radius: 4px; padding: 0 6px; background: var(--input-bg-color); color: var(--text-color);">
                        <input type="text" id="songEditorSectionCustomLabel" placeholder="Custom label..." style="display: none; flex: 1; height: 28px; border: 1px solid var(--border-color); border-radius: 4px; padding: 0 8px; background: var(--input-bg-color); color: var(--text-color);">
                      </div>
                    </div>


                    <!-- WYSIWYG Editor Canvas -->
                    <div class="song-editor-workspace__canvas-container">
                      <div id="songEditorSlideCanvas" class="song-editor-slide-canvas">
                        <div id="snapGuideV" class="snap-guide-line snap-guide-line--v" style="display: none;"></div>
                        <div id="snapGuideH" class="snap-guide-line snap-guide-line--h" style="display: none;"></div>
                        <div id="songEditorTextBox" class="draggable-text-box" style="position: absolute; left: 10%; top: 10%; width: 80%; height: 80%; cursor: default;">
                          <div id="songEditorDragHandle" class="draggable-text-box__handle"></div>
                          <div id="songEditorSlideTextarea" class="song-editor-slide-textarea" contenteditable="true" data-placeholder="Enter lyrics for this section..."></div>
                          <div id="songEditorResizeHandle" class="draggable-text-box__resize-handle" aria-hidden="true"></div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Right Pane: Live Preview -->
                  <div class="song-editor-preview-pane">
                    <div class="song-editor-preview-pane__title">Audience Preview</div>
                    <div class="song-editor-preview-pane__content">
                      <div id="songEditorLivePreviewSlide" class="songs-preview-slide"></div>
                    </div>
                  </div>
                </div>
                <!-- Hidden original textarea to preserve background functionality -->
                <textarea id="songEditorTextarea" style="display: none;"></textarea>
                <!-- Custom Context Menu for styling shortcuts -->
                <div id="songEditorContextMenu" class="song-editor-context-menu" style="display: none; position: fixed; z-index: 10000;"></div>
              </div>
           </section>
         </div>

        <div id="slidesWorkspace" class="slides-workspace" hidden>
          <aside class="slides-workspace__navigator" aria-label="Slide deck navigator">
            <div class="slides-workspace__nav-header">
              <span class="slides-workspace__heading">Slides</span>
              <div class="slides-workspace__nav-actions">
                <button type="button" id="newDeckBtn" class="songs-icon-btn songs-icon-btn--suggested" title="New slide deck" aria-label="New slide deck">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                </button>
              </div>
            </div>
            <div class="songs-search-field">
              <svg class="songs-search-field__icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              <input type="text" id="slidesSearchInput" placeholder="Search decks…" aria-label="Search slide decks">
              <button type="button" id="slidesSearchClearBtn" class="songs-search-field__clear" aria-label="Clear search" hidden>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              </button>
            </div>
            <div class="songs-folder-panel" aria-label="Deck folders">
              <div class="songs-folder-panel__header">
                <span class="songs-folder-panel__title">Folders</span>
                <button type="button" id="newDeckFolderBtn" class="songs-icon-btn songs-icon-btn--small" title="New folder" aria-label="New folder">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                </button>
              </div>
              <div id="slidesFolderList" class="songs-folder-list" role="listbox" aria-label="Deck folders"></div>
            </div>
            <div id="slidesList" class="songs-list" role="listbox">
              <span class="list-placeholder-title">No decks yet</span>
            </div>
          </aside>
          <section class="slides-workspace__main" aria-label="Deck editor">
            <div class="songs-workspace__toolbar">
              <button type="button" id="slidesWorkspaceTitleButton" class="songs-workspace__title slides-workspace__title-button" disabled title="Rename deck">
                <span id="slidesWorkspaceTitle">Select or Create a Deck</span>
              </button>
              <div class="songs-workspace__actions-end">
                <div class="songs-workspace__btn-group">
                  <button type="button" id="slidesShowNowBtn" class="songs-action-btn songs-action-btn--suggested" disabled title="Present current page on audience display">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 3h14v9H1z" stroke="currentColor" stroke-width="1.4"/><path d="M5 14h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M6.5 6l4 2.5-4 2.5z" fill="currentColor"/></svg>
                    <span>Show Now</span>
                  </button>
                  <button type="button" id="slidesAddScheduleBtn" class="songs-action-btn" disabled title="Add deck to schedule">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                    <span>Schedule</span>
                  </button>
                  <button type="button" id="slidesSaveDeckBtn" class="songs-action-btn" disabled title="Save deck to library">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    <span>Save</span>
                  </button>
                </div>
                <div class="songs-workspace__btn-group songs-workspace__btn-group--secondary">
                  <button type="button" id="slidesUndoBtn" class="songs-icon-btn" disabled title="Undo slide edit" aria-label="Undo slide edit">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4L3 7l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 7H10a3 3 0 1 1 0 6H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                  </button>
                  <button type="button" id="slidesRedoBtn" class="songs-icon-btn" disabled title="Redo slide edit" aria-label="Redo slide edit">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 4l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.5 7H6a3 3 0 1 0 0 6h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                  </button>
                  <button type="button" id="slidesDuplicateDeckBtn" class="songs-icon-btn" disabled title="Duplicate deck">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="3" y="3" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="5.5" y="5.5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.4" fill="var(--card-bg-color)"/></svg>
                  </button>
                  <button type="button" id="slidesDeleteDeckBtn" class="songs-icon-btn songs-icon-btn--destructive" disabled title="Delete deck">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4h10l-1 10H4z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M2 4h12M6 2h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
                  </button>
                </div>
              </div>
            </div>
            <div class="slides-workspace__editor">
              <aside class="slides-workspace__pages" aria-label="Pages">
                <div class="slides-workspace__pages-header">
                  <span>Pages</span>
                  <div class="slides-workspace__pages-actions">
                    <button type="button" id="slidesAddPageBtn" class="songs-icon-btn songs-icon-btn--small" title="Add page" disabled>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    </button>
                    <button type="button" id="slidesDuplicatePageBtn" class="songs-icon-btn songs-icon-btn--small" title="Duplicate page" disabled>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="2" y="2" width="6" height="6" stroke="currentColor" stroke-width="1.2"/><rect x="4" y="4" width="6" height="6" stroke="currentColor" stroke-width="1.2" fill="var(--card-bg-color)"/></svg>
                    </button>
                    <button type="button" id="slidesDeletePageBtn" class="songs-icon-btn songs-icon-btn--small songs-icon-btn--destructive" title="Delete page" disabled>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    </button>
                    <button type="button" id="slidesAddTextBoxBtn" class="songs-icon-btn songs-icon-btn--small" title="Add text box" disabled>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M6 3v6M4 9h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
                    </button>
                    <button type="button" id="slidesAddImageBtn" class="songs-icon-btn songs-icon-btn--small" title="Add image" disabled>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="2" width="9" height="8" rx="1" stroke="currentColor" stroke-width="1.2"/><circle cx="4" cy="4.5" r="1" fill="currentColor"/><path d="M2 8l2.5-2 2 1.8L8 6.5 10 8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <button type="button" id="slidesAddRectBtn" class="songs-icon-btn songs-icon-btn--small" title="Add rectangle" disabled>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="2" y="3" width="8" height="6" rx="1" stroke="currentColor" stroke-width="1.3"/></svg>
                    </button>
                    <button type="button" id="slidesAddEllipseBtn" class="songs-icon-btn songs-icon-btn--small" title="Add ellipse" disabled>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><ellipse cx="6" cy="6" rx="4" ry="3" stroke="currentColor" stroke-width="1.3"/></svg>
                    </button>
                    <button type="button" id="slidesAddLineBtn" class="songs-icon-btn songs-icon-btn--small" title="Add line" disabled>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 8l8-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    </button>
                  </div>
                </div>
                <div id="slidesPageList" class="slides-page-list" role="listbox" aria-label="Deck pages"></div>
              </aside>
              <div class="slides-workspace__canvas-wrap">
                <div id="slidesCanvasFrame" class="slides-canvas-frame">
                  <div id="slidesCanvas" class="slides-canvas" aria-label="Slide canvas">
                    <div id="slidesCanvasBackground" class="slides-canvas-background"></div>
                    <div id="slidesTextLayer" class="slides-canvas-text-layer" aria-label="Slide text objects"></div>
                  </div>
                </div>
              </div>
              <aside class="slides-workspace__properties" aria-label="Slide templates and page properties">
                <div class="boxed-list-group">
                  <div class="boxed-list-title">Templates</div>
                  <div id="slidesTemplateList" class="slides-template-grid" role="listbox" aria-label="Slide templates"></div>
                </div>
                <div class="boxed-list-group">
                  <div class="boxed-list-title">Page</div>
                  <div class="boxed-list">
                    <div class="boxed-list-row">
                      <label for="slidesPageLabelInput">Label</label>
                      <input type="text" id="slidesPageLabelInput" placeholder="Page 1" aria-label="Page label">
                    </div>
                    <div class="boxed-list-row">
                      <label for="slidesPageBackgroundColor">Background</label>
                      <input type="color" id="slidesPageBackgroundColor" value="#000000">
                    </div>
                    <div class="boxed-list-row">
                      <label>Image / Video</label>
                      <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;">
                        <button type="button" class="songs-icon-btn" title="Choose background" style="position: relative; overflow: hidden; width: 32px; height: 32px; flex-shrink: 0;">
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"><rect x="2" y="3" width="12" height="10" rx="1.5" stroke-width="1.5"/><circle cx="5.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/><path d="M2 10l3-3 4 4 2-2 3 3" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                          <input type="file" id="slidesPageBackgroundInput" accept="image/*,video/mp4,video/webm" aria-label="Page background image or video" style="opacity:0;position:absolute;inset:0;cursor:pointer;width:100%;height:100%;">
                        </button>
                        <span id="slidesPageBackgroundLabel" style="font-size:12px;color:var(--text-color-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;">None</span>
                        <button type="button" id="slidesPageBackgroundClearBtn" class="songs-icon-btn songs-icon-btn--small" title="Clear background">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                        </button>
                      </div>
                    </div>
                    <div class="boxed-list-row">
                      <label for="slidesPageNotes">Notes</label>
                      <textarea id="slidesPageNotes" rows="3" placeholder="Speaker notes (not shown to audience)" style="width:100%;resize:vertical;"></textarea>
                    </div>
                  </div>
                </div>
                <div class="boxed-list-group">
                  <div class="boxed-list-title">Transition</div>
                  <div class="boxed-list">
                    <div class="boxed-list-row">
                      <label for="slidesPageTransitionEffect">Effect</label>
                      <select id="slidesPageTransitionEffect" class="display-select" aria-label="Slide transition effect">
                        <option value="inherit">Use Global</option>
                        <option value="none">Off</option>
                        <option value="fade">Fade</option>
                        <option value="slide-left">Slide Left</option>
                        <option value="slide-right">Slide Right</option>
                        <option value="zoom">Zoom</option>
                      </select>
                    </div>
                    <div class="boxed-list-row">
                      <label for="slidesPageTransitionDuration">Duration</label>
                      <input id="slidesPageTransitionDuration" class="url-input transition-duration-input" type="number" min="0" max="3000" step="50" value="350" aria-label="Slide transition duration in milliseconds">
                    </div>
                  </div>
                </div>
              </aside>
              <div class="slides-hidden-settings" hidden>
                <input type="text" id="slidesDeckTitleInput" placeholder="Untitled Deck" aria-label="Deck title">
                <select id="slidesDeckFolderSelect" aria-label="Deck folder">
                  <option value="">Default</option>
                </select>
                <select id="slidesDeckFontFamily" class="display-select">
                  <option value="Adwaita Sans">Adwaita Sans</option>
                  <option value="CMG Sans">CMG Sans</option>
                  <option value="Arial">Arial</option>
                  <option value="Calibri">Calibri</option>
                  <option value="Cambria">Cambria</option>
                  <option value="Georgia">Georgia</option>
                  <option value="Segoe UI">Segoe UI</option>
                  <option value="Tahoma">Tahoma</option>
                  <option value="Times New Roman">Times New Roman</option>
                  <option value="Verdana">Verdana</option>
                </select>
                <input type="number" id="slidesDeckFontSize" min="24" max="200" value="96">
                <input type="color" id="slidesDeckTextColor" value="#ffffff">
                <input type="color" id="slidesDeckBgColor" value="#000000">
              </div>
              <input type="file" id="slidesTextObjectBackgroundInput" accept="image/*,video/mp4,video/webm" hidden>
              <input type="file" id="slidesObjectImageInput" accept="image/*" hidden>
              <div id="slidesEditorContextMenu" class="song-editor-context-menu" style="display: none; position: fixed; z-index: 10000;"></div>
            </div>
          </section>
        </div>

        <div id="bibleWorkspace" class="bible-workspace" hidden>
        <aside class="bible-workspace__navigator" aria-label="Bible chapter navigator">
          <div class="bible-workspace__heading">Bible</div>
          <div class="bible-workspace__selectors">
            <select id="bibleVersionSelect" class="display-select" aria-label="Bible version"></select>
          </div>
          <div id="bibleVersionAttribution" class="bible-version-attribution" role="note"></div>
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
          <div class="bible-navigator-switch" role="tablist" aria-label="Bible navigator mode">
            <button type="button" id="bibleBrowseModeBtn" class="bible-navigator-switch__button is-active" role="tab" aria-selected="true" aria-controls="bibleVerseList">Browse</button>
            <button type="button" id="bibleSearchModeBtn" class="bible-navigator-switch__button" role="tab" aria-selected="false" aria-controls="bibleSearchPanel">Search</button>
          </div>
          <div id="bibleSearchPanel" class="bible-search-panel" hidden>
            <div class="bible-search-field">
              <input
                type="search"
                class="url-input"
                id="bibleSearchInput"
                autocomplete="off"
                placeholder="Search text"
                aria-label="Search Bible text"
              >
              <button type="button" id="bibleSearchButton" class="bible-search-button" aria-label="Search Bible text">
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M11.3 11.3l3 3"/>
                  <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/>
                </svg>
              </button>
            </div>
            <div class="bible-search-options">
              <select id="bibleSearchScopeSelect" class="display-select" aria-label="Search scope">
                <option value="current">This Version</option>
                <option value="all">All Versions</option>
              </select>
              <div class="bible-search-mode-switch" role="group" aria-label="Match type">
                <button type="button" class="bible-search-mode-button is-active" data-search-mode="all" aria-pressed="true">All</button>
                <button type="button" class="bible-search-mode-button" data-search-mode="phrase" aria-pressed="false">Phrase</button>
                <button type="button" class="bible-search-mode-button" data-search-mode="any" aria-pressed="false">Any</button>
              </div>
            </div>
            <div id="bibleSearchStatus" class="bible-search-status" role="status"></div>
          </div>
          <div class="bible-action-row bible-navigator-actions" aria-label="Bible text actions">
            <button type="button" id="bibleShowNowBtn" class="pill-button suggested-action">Show Now</button>
            <button type="button" id="bibleInsertQueueBtn" class="pill-button secondary">Add to Schedule</button>
          </div>
          <div id="bibleVerseList" class="bible-verse-list" role="listbox" aria-label="Chapter verses">
            <div class="list-placeholder">
              <span class="list-placeholder-title">Loading Bible…</span>
            </div>
          </div>
          <div id="bibleSearchResults" class="bible-search-results" role="listbox" aria-label="Bible search results" hidden>
            <div class="list-placeholder">
              <span class="list-placeholder-title">Search Bible text</span>
              <span class="list-placeholder-hint">Choose words or an exact phrase</span>
            </div>
          </div>
        </aside>
        <section class="bible-workspace__main" aria-label="Bible text preview editor">
          <div class="bible-workspace__toolbar">
            <span id="bibleWorkspaceTitle" class="bible-workspace__title">Bible</span>
          </div>
          <div id="biblePreviewPanel" class="bible-preview-panel">
            <section id="bibleAudiencePreviewShell" class="bible-preview-surface bible-preview-surface--audience" aria-label="Audience output preview">
              <span class="bible-preview-surface-label">Audience</span>
              <video id="biblePreviewBackgroundVideo" class="bible-preview-background-video" muted loop playsinline hidden></video>
              <div id="biblePreviewRender" class="bible-preview-copy scripture-render scripture-render--fullscreen">
                <div class="scripture-render__box">
                  <div id="biblePreviewText" class="bible-preview-text scripture-render__body"></div>
                  <div id="biblePreviewReference" class="bible-preview-reference scripture-render__reference"></div>
                  <div id="biblePreviewAttribution" class="bible-preview-attribution scripture-render__attribution"></div>
                </div>
              </div>
            </section>
            <section id="bibleLowerThirdPreviewShell" class="bible-preview-surface bible-preview-surface--lower-third" aria-label="Lower third output preview" data-lower-third-feature hidden>
              <span class="bible-preview-surface-label">Lower Third</span>
              <div id="bibleLowerThirdPreviewRender" class="bible-preview-copy scripture-render scripture-render--lower-third">
                <div class="scripture-render__box">
                  <div id="bibleLowerThirdPreviewText" class="bible-preview-text scripture-render__body"></div>
                  <div id="bibleLowerThirdPreviewReference" class="bible-preview-reference scripture-render__reference"></div>
                  <div id="bibleLowerThirdPreviewAttribution" class="bible-preview-attribution scripture-render__attribution"></div>
                </div>
              </div>
            </section>
          </div>
          <div class="bible-editor-drawer">
            <div class="bible-editor-controls">
              <div class="bible-output-controls" data-lower-third-feature hidden>
                <div id="bibleLowerThirdControls" class="bible-lower-third-controls" aria-label="Lower third cursor controls">
                  <span class="bible-lower-third-label">Lower Third Cursor</span>
                  <div class="bible-cursor-stepper" role="group" aria-label="Move lower third cursor">
                    <button type="button" id="bibleLowerThirdPrevBtn" class="pill-button secondary">Previous</button>
                    <button type="button" id="bibleLowerThirdNextBtn" class="pill-button secondary">Next</button>
                  </div>
                  <span id="bibleLowerThirdStatus" class="bible-lower-third-status">Segment 1 of 1</span>
                  <button type="button" id="bibleLowerThirdAutoSplitBtn" class="pill-button secondary">Auto Split</button>
                </div>
              </div>
              <div class="bible-editor-fields">
                <label class="bible-field bible-field--font">Font
                  <select id="bibleFontInput" class="display-select">
                    <option value="'CMG Sans'">CMG Sans</option>
                    <option value="'Adwaita'">Adwaita</option>
                    <option value="'Arial'">Arial</option>
                    <option value="'Calibri'">Calibri</option>
                    <option value="'Cambria'">Cambria</option>
                    <option value="'Georgia'">Georgia</option>
                    <option value="'Segoe UI'">Segoe UI</option>
                    <option value="'Tahoma'">Tahoma</option>
                    <option value="'Times New Roman'">Times New Roman</option>
                    <option value="'Verdana'">Verdana</option>
                  </select>
                </label>
                <label class="bible-field">Size <input id="bibleFontSizeInput" type="number" min="24" max="160" value="66" class="url-input"></label>
                <label class="bible-field">Audience Text <input id="bibleTextColorInput" type="color" value="#ffffff"></label>
                <label class="bible-field">Audience Backdrop <input id="bibleBackgroundColorInput" type="color" value="#000000"></label>
                <label class="bible-field" data-lower-third-feature hidden>Lower Text <input id="bibleLowerThirdTextColorInput" type="color" value="#ffffff"></label>
                <label class="bible-field" data-lower-third-feature data-lower-third-key-color hidden>Key Color <input id="bibleLowerThirdChromaKeyInput" type="color" value="#00ff00"></label>
                <label class="bible-field bible-field--transition">Transition
                  <span class="transition-inline-controls">
                    <select id="bibleTransitionEffectInput" class="display-select" aria-label="Bible text slide transition">
                      <option value="inherit">Use Global</option>
                      <option value="none">Off</option>
                      <option value="fade">Fade</option>
                      <option value="slide-left">Slide Left</option>
                      <option value="slide-right">Slide Right</option>
                      <option value="zoom">Zoom</option>
                    </select>
                    <input id="bibleTransitionDurationInput" type="number" min="0" max="3000" step="50" value="350" class="url-input transition-duration-input" aria-label="Bible text transition duration in milliseconds">
                  </span>
                </label>
                <label class="file-input-label bible-background-picker">
                  <input id="bibleBackgroundInput" type="file" accept="image/*,video/*" hidden>
                  <span id="bibleBackgroundLabel">Choose Background…</span>
                </label>
              </div>
              <div class="bible-autofit-panel" aria-label="Bible text autofit">
                <label class="bible-field bible-field--autosize">Autofit
                  <select id="bibleAutosizeModeInput" class="display-select">
                    <option value="fit">Fit</option>
                    <option value="normalize">Normalize</option>
                    <option value="none">Off</option>
                  </select>
                </label>
                <label class="bible-field bible-field--min-size">Min
                  <input id="bibleMinFontSizeInput" type="number" min="20" max="160" value="38" class="url-input">
                </label>
              </div>
              <div class="bible-editor-actions">
                <button type="button" id="bibleApplyCurrentBtn" class="pill-button suggested-action">Apply to Selected Text</button>
                <button type="button" id="bibleApplyStyleScheduleBtn" class="pill-button secondary">Apply to Scheduled Text</button>
                <button type="button" id="bibleUseStyleDefaultsBtn" class="pill-button secondary">Save as Default Style</button>
                <button type="button" id="bibleClearBackgroundBtn" class="pill-button secondary">Clear Background</button>
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
    case "song":
      return `<svg class="queue-item-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
    default:
      return `<svg class="queue-item-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3 2h10v12H3V2zm1 1v10h8V3H4zm1 1h6v1H5V4zm0 2h4v1H5V6zm0 2h6v1H5V8z"/></svg>`;
  }
}
