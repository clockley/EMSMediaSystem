# EMS Media System 6.5.13

Version 6.5.13 adds schedule groups and operator notes, asks for an audience display before a presentation starts without one, and repairs seeking on a class of local H.264 videos. These notes cover changes since 6.5.12.

## Highlights

- Schedule cues can be organized into groups. Membership is stored on each cue, and removing a group keeps its cues in the schedule.
- Cues and groups can carry operator notes. Notes stay off the audience and lower thirds, and can be shown on the stage display when opted in.
- Starting a presentation with no audience display opens a chooser. The presentation starts after a connected display is selected.
- Local MP4, M4V, and MOV files are served through an `ems-media://` handler that can repair a bad sync-sample table while streaming, so Chromium can seek those files without freezing. The original file is not modified.

## Schedule

- Groups appear as labeled rows in the schedule. A new group is named "New Group" until it is renamed.
- Cues remember their group by id. Reordering no longer depends on a cue simply sitting under a heading.
- Removing a group detaches its cues as top-level items. The remove action says that the items are kept.
- A group can be collapsed. Drag-and-drop inserts at group boundaries, and a group moves as one block.
- Older projects that only implied a group by position still open. Explicit top-level cues stay top-level.

## Operator notes

- Notes are edited in the schedule inspector without a dialog. The editor writes into the cue or group, and saving does not stop live output.
- Note text is stored with normalized line endings and a 2000-character cap. An empty note is omitted from the project file.
- A note can be opted onto the stage display. A group note is shown before the cue note. Schedule notes are kept ahead of slide notes.
- Notes are not included in audience or lower-third output.
- Notes survive project save and load, session snapshots, and in-place item rebuilds, including songs, Scripture, media, and groups.

## Audience display

- Songs, Scripture, media, logo hold, and other presentation starts share one display request. If a display is already selected, that selection is reused.
- Canceling the chooser leaves the output unselected. A newer presentation attempt replaces an older one, so a stale choice cannot start the wrong output.
- A disconnected display cannot be applied from a stale option. After a display is connected or removed, the selection is checked again.
- If the display list cannot be read, EMS does not fall back to whatever options were last shown.

## Video and playback

- Electron is now 40.10.6. A newer Electron was not used because of [electron#54670](https://github.com/electron/electron/issues/54670).
- Some H.264 files, including many YouTube downloads, advertise non-IDR frames as sync samples. Chromium 134 and later seeks to those samples and then freezes with a decode error. EMS streams the original file and overlays a same-length sync-sample table that lists only verified IDR samples.
- Files that need no repair, and files EMS cannot safely inspect, are streamed unchanged.
- Media-key and Media Session seeks are applied on the audience video, which is the playback clock. The control preview follows that position, including while the preview is paused.
- A clip that reaches its end is not seeked again before the end handler runs. An end event from a clip that has already been replaced cannot advance the schedule.
- Live mute sets the audience volume to zero and does not take ownership of the autoplay mute state.

## Preview

- The empty-preview overlay stays hidden while the Bible, Songs, or Slides workspace is open.

## Media library

- Media file fingerprints are now XXH3-64, computed by the Go media watcher. `hash-wasm` is no longer used. Stored hashes from the previous algorithm are treated as missing and hashed again.

## Build

- Direct dependencies updated: `youtubei.js` 18, `write-file-atomic` 8, `electron-builder` 26.18.1, `dashjs` 5.2, `pdfjs-dist` 6.4, `atem-connection` 3.10, and `yauzl` 3.4. Unused `zod` was removed.
- `yarn test` runs the Makefile test target. An Electron check covers the `ems-media://` protocol.

## Maintenance

- Expanded regression coverage for schedule groups, notes, the audience-display chooser, MP4 sync repair, playback transitions, and media-element seek suppression.

**Full changelog:** [`6.5.12...6.5.13`](https://github.com/clockley/EMSMediaSystem/compare/6.5.12...6.5.13)
