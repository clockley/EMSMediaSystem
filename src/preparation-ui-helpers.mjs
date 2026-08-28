function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function resolvedSlideWarning(slide, preferredFontSize, minimumFontSize) {
  const layout = slide?.layout || {};
  const preferred = finiteNumber(preferredFontSize);
  const minimum = finiteNumber(layout.minFontSize ?? minimumFontSize);
  const resolved = finiteNumber(layout.resolvedFontSize ?? layout.fontSize);
  if (layout.overflow === true || layout.fits === false) {
    return {
      level: "overflow",
      label: "Overflow",
      message: "Content overflows at the minimum font size",
    };
  }
  if (
    resolved !== null &&
    minimum !== null &&
    preferred !== null &&
    resolved < preferred &&
    resolved <= minimum
  ) {
    return {
      level: "minimum-font",
      label: "Minimum font",
      message: `Text was reduced to the ${Math.round(minimum)}px minimum`,
    };
  }
  return null;
}

export function presentationWarnings(presentation, typography = {}) {
  const warnings = [];
  for (const slide of Array.isArray(presentation?.slides) ? presentation.slides : []) {
    const warning = resolvedSlideWarning(
      slide,
      typography.fontSize,
      typography.minFontSize,
    );
    if (!warning) continue;
    warnings.push({
      ...warning,
      slideId: slide.slideId || null,
      sequenceEntryId: slide.sequenceEntryId || null,
    });
  }
  const overflowCount = warnings.filter((warning) => warning.level === "overflow").length;
  const minimumFontCount = warnings.length - overflowCount;
  return {
    warnings,
    overflowCount,
    minimumFontCount,
    banner:
      overflowCount > 0
        ? `${overflowCount} slide${overflowCount === 1 ? " overflows" : "s overflow"} at minimum font size`
        : minimumFontCount > 0
          ? `${minimumFontCount} slide${minimumFontCount === 1 ? "" : "s"} use the minimum font size`
          : "",
  };
}

export function groupResolvedSongSlides(presentation, sections = []) {
  const labels = new Map(
    (Array.isArray(sections) ? sections : []).map((section) => [
      section?.id,
      section?.label || section?.kind || "Section",
    ]),
  );
  const groups = [];
  for (const slide of Array.isArray(presentation?.slides) ? presentation.slides : []) {
    const groupKey = slide.sequenceEntryId || slide.sectionId || "";
    let group = groups[groups.length - 1];
    if (!group || group.key !== groupKey) {
      group = {
        key: groupKey,
        sequenceEntryId: slide.sequenceEntryId || null,
        sectionId: slide.sectionId || null,
        label:
          slide.sectionLabel ||
          labels.get(slide.sectionId) ||
          slide.sectionKind ||
          "Section",
        slides: [],
      };
      groups.push(group);
    }
    group.slides.push(slide);
  }
  return groups;
}

export function setManualBreakAfter(blocks, blockId, enabled) {
  return (Array.isArray(blocks) ? blocks : []).map((block) =>
    block?.id === blockId
      ? { ...block, manualBreakAfter: enabled === true }
      : { ...block },
  );
}

export function resetManualBreaks(sections, sectionId = null) {
  return (Array.isArray(sections) ? sections : []).map((section) => {
    if (sectionId && section?.id !== sectionId) return section;
    return {
      ...section,
      blocks: (Array.isArray(section?.blocks) ? section.blocks : []).map((block) => {
        const next = { ...block };
        delete next.manualBreakAfter;
        return next;
      }),
    };
  });
}

export function adjacentResolvedSlideIndex(slides, activeSlideId, delta) {
  const values = Array.isArray(slides) ? slides : [];
  if (values.length === 0) return -1;
  const found = values.findIndex((slide) => slide?.slideId === activeSlideId);
  const current = found >= 0 ? found : 0;
  return Math.max(0, Math.min(values.length - 1, current + Math.sign(delta || 0)));
}

export function resolvedSlideMarkers(slides, currentSlideId, liveSlideId) {
  const values = Array.isArray(slides) ? slides : [];
  const found = values.findIndex((slide) => slide?.slideId === currentSlideId);
  const currentIndex = found >= 0 ? found : values.length > 0 ? 0 : -1;
  return values.map((slide, index) => ({
    current: slide?.slideId === currentSlideId,
    next: currentIndex >= 0 && index === currentIndex + 1,
    live: Boolean(liveSlideId) && slide?.slideId === liveSlideId,
  }));
}

export function bindCueFirstSlideActivation(
  target,
  { cue, takeLive, onError = console.error } = {},
) {
  if (!target?.addEventListener || typeof cue !== "function" || typeof takeLive !== "function") {
    return false;
  }
  const run = (action) => {
    try {
      Promise.resolve(action()).catch(onError);
    } catch (error) {
      onError(error);
    }
  };
  target.addEventListener("click", () => run(cue));
  target.addEventListener("dblclick", (event) => {
    event.preventDefault();
    run(takeLive);
  });
  return true;
}
