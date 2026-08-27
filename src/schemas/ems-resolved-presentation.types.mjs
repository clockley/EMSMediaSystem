/*
Copyright (C) 2026 Christian Lockley

JSDoc typedefs for target-specific resolved presentation units.
*/

/** @typedef {{width:number, height:number}} EmsResolvedOutputSize */

/**
 * @typedef {Object} EmsResolvedSlideLayout
 * @property {boolean} fits
 * @property {boolean} overflow
 * @property {number} [resolvedFontSize]
 * @property {number} [lineCount]
 * @property {string} [measurementKey]
 */

/**
 * @typedef {Object} EmsResolvedSlideUnit
 * @property {string} slideId
 * @property {number} index
 * @property {string} [sectionId]
 * @property {string} [sequenceEntryId]
 * @property {number} chunkIndex
 * @property {Object[]} [blocks]
 * @property {string} bodyText
 * @property {string} [referenceText]
 * @property {string} [attributionText]
 * @property {string} [copyrightText]
 * @property {boolean} [manualBreak]
 * @property {EmsResolvedSlideLayout} layout
 */

/**
 * @typedef {Object} EmsResolvedPresentation
 * @property {"ems.resolvedPresentation.v1"} schema
 * @property {"song"|"scripture"|"text"} contentKind
 * @property {{outputRole:string, outputSize:EmsResolvedOutputSize}} target
 * @property {{id:string, revision:string, arrangementId?:string}} source
 * @property {EmsResolvedSlideUnit[]} slides
 * @property {EmsResolvedSlideUnit|null} activeSlide
 * @property {{slideCount:number, activeSlideId:string|null, previousSlideId:string|null, nextSlideId:string|null}} navigation
 * @property {string} layoutKey
 * @property {string[]} warnings
 */

export const EMS_RESOLVED_PRESENTATION_SCHEMA_ID = "ems.resolvedPresentation.v1";
