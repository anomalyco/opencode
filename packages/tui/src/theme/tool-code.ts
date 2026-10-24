import type { RGBA } from "@opentui/core"
import type { Theme } from "./index"
import type { YamlKind } from "../util/message-blocks"

type Slot = keyof Theme

// In the transcript red means a failed or rejected tool call, so code shown inside a tool call
// (a bash command, a heredoc body, a tool's input) or a user message must not draw a token in
// red. Each slot the syntax rules read that comes out red, or in the theme's error color, takes
// the first of its alternatives that does not; `text` is never red in a built-in theme and ends
// every list.
const ALTERNATIVES: Partial<Record<Slot, Slot[]>> = {
  error: ["syntaxFunction", "syntaxType", "text"],
  syntaxVariable: ["syntaxFunction", "syntaxType", "text"],
  syntaxFunction: ["syntaxType", "syntaxKeyword", "text"],
  syntaxKeyword: ["syntaxType", "syntaxFunction", "text"],
  syntaxNumber: ["syntaxType", "syntaxKeyword", "text"],
  syntaxString: ["success", "syntaxType", "text"],
  syntaxType: ["syntaxFunction", "text"],
  syntaxOperator: ["syntaxPunctuation", "text"],
  syntaxPunctuation: ["textMuted", "text"],
  syntaxComment: ["textMuted", "text"],
  markdownLink: ["syntaxString", "syntaxType", "text"],
  markdownLinkText: ["syntaxString", "syntaxType", "text"],
  markdownHeading: ["syntaxKeyword", "syntaxType", "text"],
  markdownCode: ["syntaxString", "success", "text"],
  markdownBlockQuote: ["syntaxType", "textMuted", "text"],
  markdownEmph: ["syntaxType", "text"],
  markdownStrong: ["text"],
  markdownListItem: ["syntaxType", "syntaxFunction", "text"],
  markdownListEnumeration: ["syntaxType", "syntaxFunction", "text"],
  warning: ["syntaxType", "text"],
}

export function toolCodeTheme(theme: Theme): Theme {
  const alarming = (color: RGBA) => isRedColor(color) || closeTo(color, theme.error)
  const replaced = Object.fromEntries(
    Object.entries(ALTERNATIVES).flatMap(([slot, alternatives]) => {
      const color = theme[slot as Slot] as RGBA
      if (slot !== "error" && !alarming(color)) return []
      const pick = alternatives.find((alternative) => !alarming(theme[alternative] as RGBA)) ?? "text"
      return [[slot, theme[pick]]]
    }),
  )
  return { ...theme, ...replaced }
}

// The colors of a `yaml` message block's segments: keys, values by type, and muted delimiters.
export function yamlColors(theme: Theme): Record<YamlKind, RGBA> {
  const code = toolCodeTheme(theme)
  return {
    indent: code.text,
    key: code.syntaxVariable,
    punctuation: code.syntaxPunctuation,
    string: code.syntaxString,
    number: code.syntaxNumber,
    boolean: code.syntaxKeyword,
    null: code.syntaxKeyword,
    fold: code.textMuted,
  }
}

// A hue within 20 degrees of pure red, saturated and neither near black nor near white.
export function isRedColor(color: RGBA) {
  const max = Math.max(color.r, color.g, color.b)
  const min = Math.min(color.r, color.g, color.b)
  const lightness = (max + min) / 2
  const delta = max - min
  if (delta === 0) return false
  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  const hue =
    max === color.r
      ? (((color.g - color.b) / delta) % 6) * 60
      : max === color.g
        ? ((color.b - color.r) / delta + 2) * 60
        : ((color.r - color.g) / delta + 4) * 60
  const degrees = hue < 0 ? hue + 360 : hue
  return (degrees >= 340 || degrees <= 20) && saturation >= 0.35 && lightness >= 0.2 && lightness <= 0.85
}

function closeTo(a: RGBA, b: RGBA) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b) < 0.08
}
