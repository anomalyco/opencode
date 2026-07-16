import { RGBA } from "@opentui/core"
import { oklchToHex, rgbToOklch } from "@opencode-ai/ui/theme/color"
import type { Theme, ThemeJson } from "../index"
import { DEFAULT_THEME } from "./defaults"
import type { ThemeFile } from "./index"
import { HueStep } from "./schema"

type ThemeColor = Exclude<keyof Theme, "thinkingOpacity" | "_hasSelectedListItemText">
type ChromaticHue = "red" | "orange" | "yellow" | "green" | "cyan" | "blue" | "purple"

const chromaticHues: readonly ChromaticHue[] = ["red", "orange", "yellow", "green", "cyan", "blue", "purple"]
const minimumChroma = 0.03
const lightThreshold = 0.6

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
  const hues = inferHues(theme, mode)
  const text = mode === "light" ? "$hue.neutral.900" : "$hue.neutral.100"
  const textMuted = mode === "light" ? "$hue.neutral.700" : "$hue.neutral.300"
  const primary = mode === "light" ? "$hue.interactive.900" : "$hue.interactive.100"
  const background = mode === "light" ? "$hue.neutral.100" : "$hue.neutral.900"
  const backgroundPanel = mode === "light" ? "$hue.neutral.200" : "$hue.neutral.800"
  const backgroundMenu = mode === "light" ? "$hue.neutral.300" : "$hue.neutral.700"

  return {
    hue: {
      gray: neutralScale(theme, mode),
      ...Object.fromEntries(
        chromaticHues.map((name) => {
          const match = hues[name]
          return [name, match ? hueScale(match.color, mode) : "$hue.gray"]
        }),
      ),
      accent: ambiguous(theme.accent) ? "$hue.gray" : hueScale(theme.accent, mode),
      interactive: ambiguous(theme.primary) ? "$hue.gray" : hueScale(theme.primary, mode),
      neutral: "$hue.gray",
    },
    text: {
      default: text,
      subdued: textMuted,
      action: {
        primary: {
          default: "$text.default",
          $disabled: textMuted,
          $focused: selected,
          $selected: primary,
        },
        destructive: { default: destructive, $disabled: textMuted },
      },
      formfield: {
        default: text,
        $focused: primary,
        $pressed: primary,
        $disabled: textMuted,
        $selected: primary,
      },
      feedback: {
        error: { default: color("error") },
        warning: { default: color("warning") },
        success: { default: color("success") },
        info: { default: color("info") },
      },
    },
    background: {
      default: background,
      surface: {
        offset: backgroundPanel,
        overlay: backgroundMenu,
      },
      action: {
        primary: { default: "transparent", $focused: primary, $selected: primary },
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
    "@context:elevated": { background: { default: "$background.surface.offset" } },
    "@context:overlay": { background: { default: "$background.surface.overlay" } },
  }
}

function inferHues(theme: Theme, mode: "light" | "dark") {
  return [theme.accent, theme.success, theme.warning, theme.primary, theme.error, theme.info, theme.secondary].reduce<
    Partial<Record<ChromaticHue, { color: RGBA; distance: number }>>
  >((result, color) => {
    const value = toOklch(color)
    if (ambiguous(color, value.c)) return result
    const anchor = inferenceAnchor(value.l)
    const nearest = chromaticHues
      .map((name) => ({
        name,
        distance: hueDistance(value.h, toOklch(RGBA.fromHex(DEFAULT_THEME[mode].hue[name][anchor])).h),
      }))
      .sort((first, second) => first.distance - second.distance)[0]
    const current = result[nearest.name]
    if (current && current.distance <= nearest.distance) return result
    return { ...result, [nearest.name]: { color, distance: nearest.distance } }
  }, {})
}

function inferenceAnchor(lightness: number): HueStep {
  return lightness >= lightThreshold ? 300 : 700
}

function hueDistance(first: number, second: number) {
  const difference = Math.abs(first - second)
  return Math.min(difference, 360 - difference)
}

function ambiguous(color: RGBA, chroma = toOklch(color).c) {
  return color.toInts()[3] === 0 || chroma < minimumChroma
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

function hueScale(color: RGBA, mode: "light" | "dark") {
  const value = toOklch(color)
  const anchor = mode === "light" ? 900 : 100
  const endpoint = mode === "light" ? Math.max(0.97, value.l) : Math.min(0.18, value.l)
  const alpha = color.toInts()[3]
  return Object.fromEntries(
    HueStep.literals.map((step) => {
      if (step === anchor) return [step, hex(color)]
      const progress = mode === "light" ? (900 - step) / 800 : (step - 100) / 800
      const generated = oklchToHex({
        l: value.l + (endpoint - value.l) * progress,
        c: value.c * (1 - progress * 0.5),
        h: value.h,
      })
      return [step, alpha === 255 ? generated : `${generated}${byte(alpha)}`]
    }),
  ) as Record<HueStep, string>
}

function neutralScale(theme: Theme, mode: "light" | "dark") {
  const anchors = neutralAnchors(theme, mode)
  return Object.fromEntries(
    HueStep.literals.map((step) => {
      const exact = anchors.find((anchor) => anchor.step === step)
      if (exact) return [step, hex(exact.color)]
      const lower = anchors.filter((anchor) => anchor.step < step).at(-1)!
      const upper = anchors.find((anchor) => anchor.step > step)!
      return [step, interpolate(lower.color, upper.color, (step - lower.step) / (upper.step - lower.step))]
    }),
  ) as Record<HueStep, string>
}

function neutralAnchors(theme: Theme, mode: "light" | "dark") {
  const light: { step: HueStep; color: RGBA }[] = [
    { step: 100, color: theme.background },
    { step: 200, color: theme.backgroundPanel },
    { step: 300, color: theme.backgroundMenu },
    { step: 700, color: theme.textMuted },
    { step: 900, color: theme.text },
  ]
  if (mode === "light") return light
  return light.toReversed().map((source) => ({ ...source, step: (1000 - source.step) as HueStep }))
}

function interpolate(first: RGBA, second: RGBA, amount: number) {
  const start = toOklch(first)
  const end = toOklch(second)
  const hue = ((((end.h - start.h) % 360) + 540) % 360) - 180
  const generated = oklchToHex({
    l: start.l + (end.l - start.l) * amount,
    c: start.c + (end.c - start.c) * amount,
    h: start.h + hue * amount,
  })
  const alpha = Math.round(first.toInts()[3] + (second.toInts()[3] - first.toInts()[3]) * amount)
  return alpha === 255 ? generated : `${generated}${byte(alpha)}`
}

function toOklch(color: RGBA) {
  const [red, green, blue] = color.toInts()
  return rgbToOklch(red / 255, green / 255, blue / 255)
}

function hex(color: RGBA) {
  return hexInts(...color.toInts())
}

function hexInts(r: number, g: number, b: number, a: number) {
  return `#${byte(r)}${byte(g)}${byte(b)}${a === 255 ? "" : byte(a)}`
}

function byte(value: number) {
  return value.toString(16).padStart(2, "0")
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
