# EMS Media System 6.5.14

Version 6.5.14 is a reliability release focused on safer project save and switch, race-safe playback starts, and operator preview that no longer fights the live output. These notes cover changes since 6.5.13.

## Highlights

- Closing EMS now waits for a confirmed autosave. A failed save offers Retry Save, Cancel Close, or Exit Without Saving, and a stale reply from an older attempt cannot close the window.
- Opening another project first saves the current one. A recovered autosave must be saved under a new name, and a live presentation blocks the switch.
- Failed audience starts restore preview audio and stop reporting as live. A superseded take cannot cancel a newer one.
- Previewing a cue that has no scrubbable element of its own no longer shows the live transport, so hovering or seeking cannot move the audience output.

## Project save and switch

- Named projects are written to their own file before another project can replace the shared recovery autosave.
- Cancelling Save As leaves the current untitled or recovered session in place.
- A presentation that starts while the outgoing project is being saved still blocks staging cleanup.
- Project-switch errors now say why the switch was refused instead of a generic "Failed to open project".

## Playback

- Present, Show Now, resume-from-boundary, and output-closed advances all run under a playback transition token. If the selected cue is no longer playable, or a newer take has already started, the obsolete start reports failure and leaves the newer output alone.
- A failed local audio or audience-window start clears live state and restores preview media instead of leaving the header on Stop.
- Linked media-file watches follow the cue object through schedule reordering instead of a queue index, so a delayed file-change notice cannot mark the wrong item.
- Preview audio tracks stay muted while a presentation owns audio, including tracks that appear after a source change. A failed start re-enables the selected preview track.

## Preview and operator chrome

- Live and cued operator badges now match only the exact resolved slide, not another slide from the same source.
- Song lower-third preview resizes by scaling the existing surface. Resize no longer rebuilds the cue list.
- Stage countdown ticks only for the live video currently on the audience output.

## Stage display

- Opening a project clears stage content, notes, and countdown before the new identity is applied.
- Widgets such as countdown are cleared when the live cue changes, so a previous item's overlay cannot linger.
- Stage Next distinguishes a following slide from the next schedule cue. Editing the schedule while live refreshes Next and notes without changing the audience slide.
- Stage labels and notes prefer the current content payload over leftover widget text.

## Outputs and media library

- A lower-third window whose assigned display is disconnected is closed instead of being moved onto the operator's primary display.
- A failed Media Library query shows an error with Retry, and a later success clears it. Infinite scroll stops appending after a failed page.

## Maintenance

- Expanded regression coverage for close-save retries, project-switch preservation, playback ownership, preview audio tracks, stage Next, and Media Library query recovery.

**Full changelog:** [`6.5.13...6.5.14`](https://github.com/clockley/EMSMediaSystem/compare/6.5.13...6.5.14)
