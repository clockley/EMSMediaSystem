export const PPTX_SMALL_DECK_MAX_SLIDES = 30;
export const PPTX_LARGE_DECK_MIN_SLIDES = 151;

export function clampPptxSlideIndex(index, count) {
  const maxIndex = Math.max(0, (Number.isFinite(count) ? count : 1) - 1);
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.floor(index)), maxIndex);
}

export function isSavedPptxSlideIndex(index) {
  return Number.isFinite(index) && index >= 0;
}

export function getPptxListRenderOptions(slideCount) {
  if (Number.isFinite(slideCount) && slideCount <= PPTX_SMALL_DECK_MAX_SLIDES) {
    return {
      batchSize: 12,
      windowed: true,
      initialSlides: 4,
      overscanViewport: 1.5,
    };
  }
  if (Number.isFinite(slideCount) && slideCount >= PPTX_LARGE_DECK_MIN_SLIDES) {
    return {
      batchSize: 4,
      windowed: true,
      initialSlides: 2,
      overscanViewport: 2,
    };
  }
  return {
    batchSize: 8,
    windowed: true,
    initialSlides: 4,
    overscanViewport: 1.5,
  };
}

export function enforcePptxCoverFit(slideEl) {
  if (!slideEl) return;
  const svgs = slideEl.querySelectorAll("svg");
  svgs.forEach((svg) => {
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.display = "block";
  });
}

export function waitForNextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

export function getPptxRenderedSlideElement(handle, stage) {
  return handle?.element || stage?.firstElementChild || null;
}

export function getPptxSlideElementFromHandle(handle, stage) {
  return handle?.element || stage?.firstElementChild || null;
}

export function getPptxNaturalSlideSize(slideEl, fallback = {}) {
  const svg = slideEl?.querySelector?.("svg");
  const viewBox = svg?.getAttribute?.("viewBox")?.split(/\s+/).map(Number);
  const viewBoxWidth = viewBox?.length === 4 && Number.isFinite(viewBox[2]) ? viewBox[2] : 0;
  const viewBoxHeight = viewBox?.length === 4 && Number.isFinite(viewBox[3]) ? viewBox[3] : 0;
  const rect = slideEl?.getBoundingClientRect?.();
  const width =
    slideEl?.offsetWidth ||
    slideEl?.scrollWidth ||
    rect?.width ||
    viewBoxWidth ||
    fallback.slideWidth ||
    16;
  const height =
    slideEl?.offsetHeight ||
    slideEl?.scrollHeight ||
    rect?.height ||
    viewBoxHeight ||
    fallback.slideHeight ||
    9;
  return { width, height };
}

export function getElementContentSize(el) {
  if (!el) return { width: 0, height: 0 };
  const styles = window.getComputedStyle(el);
  const horizontalPadding =
    Number.parseFloat(styles.paddingLeft || "0") +
    Number.parseFloat(styles.paddingRight || "0");
  const verticalPadding =
    Number.parseFloat(styles.paddingTop || "0") +
    Number.parseFloat(styles.paddingBottom || "0");
  return {
    width: Math.max(0, el.clientWidth - horizontalPadding),
    height: Math.max(0, el.clientHeight - verticalPadding),
  };
}
