import { RGBA } from "@opentui/core"
import type { Theme, ThemeJson } from "../index"
import { DEFAULT_THEME } from "./defaults"
import type { ThemeFile } from "./index"

type ThemeColor = Exclude<keyof Theme, "thinkingOpacity" | "_hasSelectedListItemText">

export function migrateV1(theme: ThemeJson): ThemeFile {
  return {
    version: 2,
    standalone: true,
    light: migrateMode(resolveV1(theme, "light"), "light"),
    dark: migrateMode(resolveV1(theme, "dark"), "dark"),
  }
}

function migrateMode(theme: Theme, mode: "light" | "dark"): ThemeFile["light"] {
  const color = (key: ThemeColor) => hex(theme[key])
  const selected = hex(selectedForeground(theme, theme.primary))
  const destructive = hex(selectedForeground(theme, theme.error))

  return {
    hue: {
      ...DEFAULT_THEME[mode].hue,
      accent: hueScale(theme.secondary),
    },
    text: {
      default: color("text"),
      subdued: color("textMuted"),
      action: {
        primary: {
          default: selected,
          $disabled: color("textMuted"),
          $focused: selected,
        },
        secondary: {
          default: "$text.default",
          $disabled: color("textMuted"),
        },
        destructive: { default: destructive, $disabled: color("textMuted") },
      },
      formfield: {
        default: color("text"),
        $focused: color("primary"),
        $pressed: color("primary"),
        $disabled: color("textMuted"),
        $selected: color("primary"),
      },
      feedback: {
        error: { default: color("error") },
        warning: { default: color("warning") },
        success: { default: color("success") },
        info: { default: color("info") },
      },
    },
    background: {
      default: color("background"),
      surface: {
        offset: color("backgroundPanel"),
        overlay: color("backgroundMenu"),
      },
      action: {
        primary: { default: color("primary"), $focused: color("primary") },
        secondary: {
          default: "$background.default",
          $focused: color("backgroundElement"),
          $pressed: color("backgroundElement"),
        },
        destructive: { default: color("error") },
      },
      formfield: {
        default: "$background.default",
      },
      feedback: {
        error: { default: "$background.default" },
        warning: { default: "$background.default" },
        success: { default: "$background.default" },
        info: { default: "$background.default" },
      },
    },
    border: { default: color("border") },
    scrollbar: { default: color("borderActive") },
    diff: {
      text: {
        added: color("diffAdded"),
        removed: color("diffRemoved"),
        context: color("diffContext"),
        hunkHeader: color("diffHunkHeader"),
      },
      background: {
        added: color("diffAddedBg"),
        removed: color("diffRemovedBg"),
        context: color("diffContextBg"),
      },
      highlight: { added: color("diffHighlightAdded"), removed: color("diffHighlightRemoved") },
      lineNumber: {
        text: color("diffLineNumber"),
        background: {
          added: color("diffAddedLineNumberBg"),
          removed: color("diffRemovedLineNumberBg"),
        },
      },
    },
    syntax: {
      comment: color("syntaxComment"),
      keyword: color("syntaxKeyword"),
      function: color("syntaxFunction"),
      variable: color("syntaxVariable"),
      string: color("syntaxString"),
      number: color("syntaxNumber"),
      type: color("syntaxType"),
      operator: color("syntaxOperator"),
      punctuation: color("syntaxPunctuation"),
    },
    markdown: {
      text: color("markdownText"),
      heading: color("markdownHeading"),
      link: color("markdownLink"),
      linkText: color("markdownLinkText"),
      code: color("markdownCode"),
      blockQuote: color("markdownBlockQuote"),
      emphasis: color("markdownEmph"),
      strong: color("markdownStrong"),
      horizontalRule: color("markdownHorizontalRule"),
      listItem: color("markdownListItem"),
      listEnumeration: color("markdownListEnumeration"),
      image: color("markdownImage"),
      imageText: color("markdownImageText"),
      codeBlock: color("markdownCodeBlock"),
    },
    "@context:elevated": {
      background: {
        default: "$background.surface.offset",
        action: {
          primary: {
            default: color("primary"),
            $focused: color("primary"),
          },
          secondary: {
            default: "$background.surface.offset",
          },
        },
      },
    },
    "@context:overlay": { background: { default: "$background.surface.overlay" } },
  }
}

function resolveV1(theme: ThemeJson, mode: "dark" | "light"): Theme {
  const defs = theme.defs ?? {}

  function resolveColor(value: unknown, chain: string[] = []): RGBA {
    if (value instanceof RGBA) return value
    if (typeof value === "string") {
      if (value === "transparent" || value === "none") return RGBA.fromInts(0, 0, 0, 0)
      if (value.startsWith("#")) return RGBA.fromHex(value)
      if (chain.includes(value)) throw new Error(`Circular color reference: ${[...chain, value].join(" -> ")}`)
      const next = defs[value] ?? theme.theme[value as ThemeColor]
      if (next === undefined) throw new Error(`Color reference "${value}" not found in defs or theme`)
      return resolveColor(next, [...chain, value])
    }
    if (typeof value === "number") return ansi(value)
    if (!value || typeof value !== "object" || !(mode in value)) throw new Error("Invalid V1 theme color")
    return resolveColor((value as Record<"dark" | "light", unknown>)[mode], chain)
  }

  const resolved = Object.fromEntries(
    Object.entries(theme.theme)
      .filter(([key]) => key !== "selectedListItemText" && key !== "backgroundMenu" && key !== "thinkingOpacity")
      .map(([key, value]) => [key, resolveColor(value)]),
  ) as Partial<Record<ThemeColor, RGBA>>
  const hasSelectedListItemText = theme.theme.selectedListItemText !== undefined
  resolved.selectedListItemText = hasSelectedListItemText
    ? resolveColor(theme.theme.selectedListItemText)
    : resolved.background
  resolved.backgroundMenu = theme.theme.backgroundMenu
    ? resolveColor(theme.theme.backgroundMenu)
    : resolved.backgroundElement

  return {
    ...resolved,
    _hasSelectedListItemText: hasSelectedListItemText,
    thinkingOpacity: theme.theme.thinkingOpacity ?? 0.6,
  } as Theme
}

function selectedForeground(theme: Theme, background: RGBA) {
  if (theme._hasSelectedListItemText) return theme.selectedListItemText
  if (theme.background.a !== 0) return theme.background
  return 0.299 * background.r + 0.587 * background.g + 0.114 * background.b > 0.5
    ? RGBA.fromInts(0, 0, 0)
    : RGBA.fromInts(255, 255, 255)
}

function hueScale(color: RGBA) {
  return {
    100: mix(color, 255, 0.8),
    200: mix(color, 255, 0.6),
    300: mix(color, 255, 0.4),
    400: mix(color, 255, 0.2),
    500: hex(color),
    600: mix(color, 0, 0.15),
    700: mix(color, 0, 0.3),
    800: mix(color, 0, 0.45),
    900: mix(color, 0, 0.6),
  }
}

function mix(color: RGBA, target: number, amount: number) {
  const [r, g, b, a] = color.toInts()
  return hexInts(
    Math.round(r + (target - r) * amount),
    Math.round(g + (target - g) * amount),
    Math.round(b + (target - b) * amount),
    a,
  )
}

function hex(color: RGBA) {
  return hexInts(...color.toInts())
}

function hexInts(r: number, g: number, b: number, a: number) {
  const byte = (value: number) => value.toString(16).padStart(2, "0")
  return `#${byte(r)}${byte(g)}${byte(b)}${a === 255 ? "" : byte(a)}`
}

function ansi(code: number) {
  if (code < 16) {
    const colors = [
      "#000000",
      "#800000",
      "#008000",
      "#808000",
      "#000080",
      "#800080",
      "#008080",
      "#c0c0c0",
      "#808080",
      "#ff0000",
      "#00ff00",
      "#ffff00",
      "#0000ff",
      "#ff00ff",
      "#00ffff",
      "#ffffff",
    ]
    return RGBA.fromHex(colors[code] ?? "#000000")
  }
  if (code < 232) {
    const index = code - 16
    const value = (part: number) => (part === 0 ? 0 : part * 40 + 55)
    return RGBA.fromInts(value(Math.floor(index / 36)), value(Math.floor(index / 6) % 6), value(index % 6))
  }
  if (code < 256) {
    const gray = (code - 232) * 10 + 8
    return RGBA.fromInts(gray, gray, gray)
  }
  return RGBA.fromInts(0, 0, 0)
}
