const compact = value => Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));

export function legacyStyleToThemeOverrides(style = {}, outputRole = "audience") {
  if (outputRole === "lowerThird") return compact({
    typography: compact({ fontFamily: style.lowerThirdFontFamily || style.fontFamily, fontSize: style.lowerThirdFontSize, color: style.lowerThirdColor || style.color }),
    canvas: { background: compact({ type: "color", color: style.lowerThirdChromaKeyColor }) },
    backdrop: compact({ enabled: true, background: compact({ type: style.lowerThirdBarBackgroundPath ? "image" : "color", color: style.lowerThirdBarBackgroundColor, path: style.lowerThirdBarBackgroundPath }) }),
    key: compact({ mode: "chroma", chromaColor: style.lowerThirdChromaKeyColor }),
  });
  return compact({
    typography: compact({ fontFamily: style.fontFamily, fontSize: style.fontSize, minFontSize: style.minFontSize, color: style.color || style.textColor, autosizeMode: style.autosizeMode }),
    canvas: { background: compact({ type: style.backgroundPath ? "image" : "color", color: style.backgroundColor, path: style.backgroundPath }) },
    transition: style.transition,
  });
}

export function legacySongOverrides(song = {}) { return legacyStyleToThemeOverrides(song.defaultRender || song.render || {}); }
export function legacyScriptureOverrides(entry = {}, outputRole = "audience") { return legacyStyleToThemeOverrides(entry, outputRole); }
export function legacyDeckOverrides(deck = {}) { return legacyStyleToThemeOverrides(deck.theme || {}); }
