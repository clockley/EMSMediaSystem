import { blocksToText } from "./app-slide-utils.mjs";

export function stageSlideText(slide) {
  if (!slide || typeof slide !== "object") return "";
  const body = String(slide.bodyText || slide.text || "").trim();
  if (body) return body;
  return String(blocksToText(slide.blocks || []) || "").trim();
}

function fallbackCurrentLabel(type) {
  if (type === "bible" || type === "scripture") return "Scripture";
  if (type === "song") return "Song";
  return "Live content";
}

function activeSlideIndex(slides, presentation) {
  const list = Array.isArray(slides) ? slides : [];
  if (list.length === 0) return -1;
  const activeId =
    presentation?.navigation?.activeSlideId ||
    presentation?.activeSlide?.slideId ||
    null;
  const found = activeId
    ? list.findIndex((slide) => slide?.slideId === activeId)
    : -1;
  return found >= 0 ? found : 0;
}

export function stageContentFromPresentation(
  message = {},
  { type = "", nextItemText = "", slides: overrideSlides = null } = {},
) {
  const presentation = message?.resolvedPresentation || null;
  const slides = Array.isArray(overrideSlides)
    ? overrideSlides
    : Array.isArray(presentation?.slides)
      ? presentation.slides
      : [];
  const activeIndex = activeSlideIndex(slides, presentation);
  const currentFromSlide = activeIndex >= 0 ? stageSlideText(slides[activeIndex]) : "";
  const current =
    currentFromSlide ||
    String(message.bodyText || message.text || "").trim();
  const nextId = presentation?.navigation?.nextSlideId || null;
  const nextFromNavigation = nextId
    ? slides.find((slide) => slide?.slideId === nextId)
    : null;
  const nextSlide =
    nextFromNavigation || (activeIndex >= 0 ? slides[activeIndex + 1] : null);
  const next =
    stageSlideText(nextSlide) || String(nextItemText || "").trim();
  return {
    current: current || fallbackCurrentLabel(type),
    next,
    serviceItem: String(
      message.title || message.referenceText || message.reference || "",
    ).trim(),
  };
}
