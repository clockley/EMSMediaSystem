import { pathToFileURL } from "node:url";
import { stageDeckKey } from "./stage-item-media.min.mjs";

/** Only the authenticated audience renderer supplies these descriptors. */
export function sanitizeStageLocalMedia(input, resolveLocalPath) {
  const identity = {
    playbackId: String(input?.playbackId || ""),
    audienceSessionId: String(input?.audienceSessionId || ""),
    sourceGeneration: Number.isInteger(input?.sourceGeneration) ? input.sourceGeneration : 0,
  };
  const empty = { ...identity, kind: "text" };
  if (input?.kind === "native" && input.presentation && typeof input.presentation === "object") {
    // Carry only the active resolved slide, never the entire song/deck,
    // editor state or arbitrary HTML. The local renderer consumes AST blocks.
    const fields = [
      "text", "bodyText", "referenceText", "attributionText", "copyrightText",
      "blocks", "slideObjects", "slideTextObjects", "contentKind", "slideId",
      "fontSize", "minFontSize", "fontFamily", "fontWeight", "fontStyle",
      "textDecoration", "lineHeight", "color", "referenceFontSize",
      "referenceColor", "referenceTextShadow", "autosizeMode", "autosizeGroupFontSize",
      "position", "textBoxPosition", "resolvedLayout", "outputSize", "transition",
      "backgroundColor", "backgroundImage", "backgroundVideo", "backgroundPath", "backgroundVideoSync",
    ];
    const presentation = Object.fromEntries(fields.filter((key) => key in input.presentation)
      .map((key) => [key, input.presentation[key]]));
    if (input.presentation.resolvedTheme?.backdrop) {
      presentation.resolvedTheme = { backdrop: input.presentation.resolvedTheme.backdrop };
    }
    try {
      const json = JSON.stringify(presentation);
      if (json.length > 2 * 1024 * 1024) return { media: empty, pptxPath: "" };
      return { media: { ...identity, kind: "native", presentation: JSON.parse(json) }, pptxPath: "" };
    } catch { return { media: empty, pptxPath: "" }; }
  }
  if (!input || !["video", "image", "pptx", "audio"].includes(input.kind)) {
    return { media: empty, pptxPath: "" };
  }
  if (input.kind === "audio") return { media: { ...identity, kind: "audio" }, pptxPath: "" };
  const raw = typeof input.url === "string" ? input.url : "";
  // Audio cues are visual placeholders, never extra media decoders/outputs.
  if (input.kind === "video" && /\.(?:mp3|wav|flac|aac|m4a|ogg|opus|aiff?|wma)(?:[?#]|$)/i.test(raw)) {
    return { media: { ...identity, kind: "audio" }, pptxPath: "" };
  }
  const localPath = raw ? resolveLocalPath(raw) : "";
  if (input.kind === "pptx") {
    if (!localPath || !/\.pptx$/i.test(localPath)) return { media: empty, pptxPath: "" };
    return {
      media: {
        ...identity, kind: "pptx", deckKey: stageDeckKey(localPath),
        slideIndex: Number.isInteger(input.slideIndex) ? Math.max(0, Math.min(9999, input.slideIndex)) : 0,
      },
      pptxPath: localPath,
    };
  }
  let url = "";
  if (localPath && !raw.startsWith("ems-media:")) url = pathToFileURL(localPath).href;
  else {
    try {
      const parsed = new URL(raw);
      if (["https:", "http:", "ems-media:"].includes(parsed.protocol)) url = parsed.href;
    } catch {}
  }
  return { media: url ? { ...identity, kind: input.kind, url } : empty, pptxPath: "" };
}