/*
Copyright (C) 2026 Christian Lockley

JSDoc typedefs for the canonical EMS Slide Deck AST (schema "ems.slideDeck.v1").
Text objects reuse the EMS song block/segment grammar from ems-song.types.mjs.
*/

/**
 * @typedef {Object} EmsSlideFrame
 * @property {number} x   normalized 0..1
 * @property {number} y   normalized 0..1
 * @property {number} width   normalized 0..1
 * @property {number} height  normalized 0..1
 */

/**
 * @typedef {Object} EmsSlideObjectStyle
 * @property {string} [fontFamily]
 * @property {number} [fontSize]
 * @property {string} [color]
 * @property {"left"|"center"|"right"} [align]
 * @property {"top"|"center"|"bottom"} [verticalAlign]
 * @property {string} [fontWeight]
 * @property {string} [fontStyle]
 * @property {string} [textDecoration]
 * @property {string} [backgroundColor]
 * @property {number} [minFontSize]
 * @property {number} [lineHeight]
 */

/**
 * @typedef {Object} EmsSlideTextObject
 * @property {string} id
 * @property {"text"} kind
 * @property {EmsSlideFrame} frame
 * @property {number} [zIndex]
 * @property {number} [opacity]
 * @property {"fit"|"normalize"|"none"} [autofit]
 * @property {string} [role]   e.g. "title" | "body" | "footer" | "attribution"
 * @property {EmsSlideObjectStyle} [style]
 * @property {EmsSlidePageBackground} [background]
 * @property {import("./ems-song.types.mjs").EmsSongBlock[]} blocks
 */

/**
 * @typedef {Object} EmsSlideImageObject
 * @property {string} id
 * @property {"image"} kind
 * @property {EmsSlideFrame} frame
 * @property {number} [zIndex]
 * @property {number} [opacity]
 * @property {{path?:string, assetId?:string, fit?:"cover"|"contain"|"fill"}} image
 */

/**
 * @typedef {Object} EmsSlideShapeObject
 * @property {string} id
 * @property {"shape"} kind
 * @property {EmsSlideFrame} frame
 * @property {number} [zIndex]
 * @property {number} [opacity]
 * @property {{type:"rect"|"ellipse"|"line", fill?:string, stroke?:string, strokeWidth?:number, radius?:number}} shape
 */

/**
 * @typedef {EmsSlideTextObject|EmsSlideImageObject|EmsSlideShapeObject} EmsSlideObject
 */

/**
 * @typedef {Object} EmsSlidePageBackground
 * @property {"color"|"image"|"video"} type
 * @property {string} [color]
 * @property {string} [path]
 * @property {string} [assetId]
 */

/**
 * @typedef {Object} EmsSlideTransition
 * @property {string} [type]   e.g. "none" | "fade" | "slide-left" | "slide-right" | "zoom"
 * @property {number} [durationMs]
 */

/**
 * @typedef {Object} EmsSlidePage
 * @property {string} id
 * @property {string} [label]
 * @property {number} [durationMs]
 * @property {boolean} [autoAdvance]
 * @property {EmsSlideTransition} [transition]
 * @property {string} [notes]
 * @property {EmsSlidePageBackground} [background]
 * @property {EmsSlideObject[]} objects
 */

/**
 * @typedef {Object} EmsSlideCanvas
 * @property {number} width    e.g. 1920
 * @property {number} height   e.g. 1080
 * @property {{top?:number, right?:number, bottom?:number, left?:number}} [safeMargins]
 */

/**
 * @typedef {Object} EmsSlideDeckTheme
 * @property {string} [fontFamily]
 * @property {number} [fontSize]
 * @property {number} [minFontSize]
 * @property {"fit"|"normalize"|"none"} [autosizeMode]
 * @property {string} [textColor]
 * @property {string} [backgroundColor]
 * @property {string} [backgroundPath]
 * @property {EmsSlideTransition} [transition]
 */

/**
 * The canonical EMS slide deck shape.
 *
 * @typedef {Object} EmsSlideDeck
 * @property {"ems.slideDeck.v1"} schema
 * @property {string} id
 * @property {string} title
 * @property {?string} [folderId]
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 * @property {EmsSlideCanvas} canvas
 * @property {EmsSlideDeckTheme} [theme]
 * @property {string[]} pageSequence ordered page ids for display/playback
 * @property {EmsSlidePage[]} pages
 */

export const EMS_SLIDE_DECK_SCHEMA_ID = "ems.slideDeck.v1";
