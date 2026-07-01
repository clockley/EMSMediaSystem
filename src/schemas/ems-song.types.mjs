/*
Copyright (C) 2026 Christian Lockley

JSDoc typedefs for the canonical EMS Song AST (schema "ems.song.v1").
These are non-executing type definitions used by editors and tooling.
The matching JSON Schema lives next to this file as ems-song.v1.schema.json.
*/

/**
 * @typedef {Object} EmsSongSegment
 * @property {"text"} type
 * @property {string} text
 * @property {Object<string, *>} [style]
 */

/**
 * @typedef {Object} EmsSongLineLanguage
 * @property {string} lang
 * @property {EmsSongSegment[]} segments
 */

/**
 * @typedef {Object} EmsSongAnnotation
 * @property {"chord"|"note"|"cue"} type
 * @property {string} [value]
 * @property {number} [offset]
 */

/**
 * @typedef {Object} EmsSongBlock
 * @property {"lyricLine"|"spacer"|"comment"|"speaker"} type
 * @property {string} id
 * @property {EmsSongLineLanguage} primary
 * @property {EmsSongLineLanguage[]} [translations]
 * @property {EmsSongAnnotation[]} [annotations]
 */

/**
 * @typedef {Object} EmsSongSection
 * @property {string} id
 * @property {string} kind
 * @property {number} [number]
 * @property {string} [label]
 * @property {EmsSongBlock[]} blocks
 */

/**
 * @typedef {Object} EmsSongPlayOrderEntry
 * @property {string} [id]
 * @property {string} sectionId
 * @property {boolean} [enabled]
 */

/**
 * @typedef {Object} EmsSongManualBreak
 * @property {string} sectionId
 * @property {string} [afterBlockId]
 */

/**
 * @typedef {Object} EmsSongChunking
 * @property {"autoFit"|"linesPerSlide"|"blocksPerSlide"} mode
 * @property {number} [maxLines]
 * @property {number} [maxBlocks]
 * @property {boolean} [avoidOrphans]
 */

/**
 * @typedef {Object} EmsSongPresentation
 * @property {EmsSongChunking} [defaultChunking]
 * @property {EmsSongManualBreak[]} [manualBreaks]
 */

/**
 * @typedef {Object} EmsSongHymnal
 * @property {?string} [name]
 * @property {?string} [number]
 * @property {string} [meter]
 * @property {?string} [display]
 */

/**
 * @typedef {Object} EmsSongMetadata
 * @property {string[]} authors
 * @property {string} copyright
 * @property {?string} [ccliNumber]
 * @property {?string} [oneLicense]
 * @property {string} [meter]
 * @property {EmsSongHymnal} [hymnal]
 * @property {string[]} [tags]
 * @property {Object<string, *>} [extra]
 */

/**
 * @typedef {Object} EmsSongLanguage
 * @property {string} id
 * @property {string} [name]
 * @property {boolean} [default]
 */

/**
 * The canonical EMS song AST shape.
 *
 * @typedef {Object} EmsSong
 * @property {"ems.song.v1"} schema
 * @property {string} id
 * @property {string} title
 * @property {number} [songNumber]
 * @property {?string} [folderId]
 * @property {EmsSongMetadata} metadata
 * @property {EmsSongLanguage[]} [languages]
 * @property {EmsSongSection[]} sections
 * @property {EmsSongPlayOrderEntry[]} [playOrder]
 * @property {EmsSongPresentation} [presentation]
 * @property {Object<string, *>} [defaultRender]
 */

export const EMS_SONG_SCHEMA_ID = "ems.song.v1";
