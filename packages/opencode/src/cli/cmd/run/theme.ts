// Theme resolution for direct interactive mode.
//
// Derives scrollback and footer colors from the terminal's actual palette.
// resolveRunTheme() queries the renderer for the terminal's palette,
// detects dark/light mode, builds a small system theme locally, and maps it to
// the run footer + scrollback color model. Falls back to a hardcoded dark-mode
// palette if detection fails.
import { RGBA, SyntaxStyle, type CliRenderer, type ColorInput, type TerminalColors } from "@opentui/core"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { EntryKind } from "./types"

type Tone = {
  body: ColorInput
  start?: ColorInput
}

export type RunEntryTheme = Record<EntryKind, Tone>

export type RunSplashTheme = {
  left: ColorInput
  right: ColorInput
  leftShadow: ColorInput
  rightShadow: ColorInput
}

export type RunFooterTheme = {
  highlight: ColorInput
  selected: ColorInput
  selectedText: ColorInput
  warning: ColorInput
  success: ColorInput
  error: ColorInput
  muted: ColorInput
  text: ColorInput
  status: ColorInput
  statusAccent: ColorInput
  shade: ColorInput
  surface: ColorInput
  pane: ColorInput
  border: ColorInput
  line: ColorInput
}

export type RunBlockTheme = {
  highlight: ColorInput
  warning: ColorInput
  text: ColorInput
  muted: ColorInput
  syntax?: SyntaxStyle
  subtleSyntax?: SyntaxStyle
  diffAdded: ColorInput
  diffRemoved: ColorInput
  diffAddedBg: ColorInput
  diffRemovedBg: ColorInput
  diffContextBg: ColorInput
  diffHighlightAdded: ColorInput
  diffHighlightRemoved: ColorInput
  diffLineNumber: ColorInput
  diffAddedLineNumberBg: ColorInput
  diffRemovedLineNumberBg: ColorInput
}

export type RunTheme = {
  background: ColorInput
  footer: RunFooterTheme
  entry: RunEntryTheme
  splash: RunSplashTheme
  block: RunBlockTheme
}

type ThemeColor = Exclude<keyof TuiThemeCurrent, "thinkingOpacity">
type HexColor = `#${string}`
type RefName = string
type Variant = {
  dark: HexColor | RefName
  light: HexColor | RefName
}
type ColorValue = HexColor | RefName | Variant | RGBA | number
type ThemeJson = {
  defs?: Record<string, HexColor | RefName>
  theme: Omit<Record<ThemeColor, ColorValue>, "selectedListItemText" | "backgroundMenu"> & {
    selectedListItemText?: ColorValue
    backgroundMenu?: ColorValue
    thinkingOpacity?: number
  }
}

type SharedSyntaxTheme = TuiThemeCurrent & {
  _hasSelectedListItemText: boolean
}

export const transparent = RGBA.fromValues(0, 0, 0, 0)

function alpha(color: RGBA, value: number): RGBA {
  return RGBA.fromValues(color.r, color.g, color.b, Math.max(0, Math.min(1, value)))
}

function rgba(hex: string, value?: number): RGBA {
  const color = RGBA.fromHex(hex)
  return value === undefined ? color : alpha(color, value)
}

function mode(bg: RGBA): "dark" | "light" {
  return luminance(bg) > 0.5 ? "light" : "dark"
}

function luminance(color: RGBA): number {
  return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b
}

function fade(color: RGBA, base: RGBA, fallback: number, scale: number, limit: number): RGBA {
  if (color.a === 0) {
    return RGBA.fromValues(color.r, color.g, color.b, Math.max(0, Math.min(1, fallback)))
  }

  const target = Math.min(limit, color.a * scale)
  const mix = Math.min(1, target / color.a)

  return RGBA.fromValues(
    base.r + (color.r - base.r) * mix,
    base.g + (color.g - base.g) * mix,
    base.b + (color.b - base.b) * mix,
    color.a,
  )
}

function ansiToRgba(code: number): RGBA {
  if (code < 16) {
    const ansi = [
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
    return RGBA.fromHex(ansi[code] ?? "#000000")
  }

  if (code < 232) {
    const index = code - 16
    const b = index % 6
    const g = Math.floor(index / 6) % 6
    const r = Math.floor(index / 36)
    const value = (x: number) => (x === 0 ? 0 : x * 40 + 55)
    return RGBA.fromInts(value(r), value(g), value(b))
  }

  if (code < 256) {
    const gray = (code - 232) * 10 + 8
    return RGBA.fromInts(gray, gray, gray)
  }

  return RGBA.fromInts(0, 0, 0)
}

function tint(base: RGBA, overlay: RGBA, value: number): RGBA {
  return RGBA.fromInts(
    Math.round((base.r + (overlay.r - base.r) * value) * 255),
    Math.round((base.g + (overlay.g - base.g) * value) * 255),
    Math.round((base.b + (overlay.b - base.b) * value) * 255),
  )
}

function blend(color: RGBA, bg: RGBA): RGBA {
  if (color.a >= 1) {
    return color
  }

  return RGBA.fromValues(
    bg.r + (color.r - bg.r) * color.a,
    bg.g + (color.g - bg.g) * color.a,
    bg.b + (color.b - bg.b) * color.a,
    1,
  )
}

function chroma(color: RGBA) {
  return Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b)
}

function opaqueSyntaxStyle(style: SyntaxStyle | undefined, bg: RGBA): SyntaxStyle | undefined {
  if (!style) {
    return undefined
  }

  return SyntaxStyle.fromStyles(
    Object.fromEntries(
      [...style.getAllStyles()].map(([name, value]) => [
        name,
        {
          ...value,
          fg: value.fg ? blend(value.fg, bg) : value.fg,
          bg: value.bg ? blend(value.bg, bg) : value.bg,
        },
      ]),
    ),
  )
}

function indexedPalette(colors: TerminalColors, size: number = Math.max(colors.palette.length, 16)): RGBA[] {
  return Array.from({ length: size }, (_, index) => {
    const value = colors.palette[index]
    return RGBA.fromIndex(index, value ? RGBA.fromHex(value) : ansiToRgba(index))
  })
}

function srgbToLinear(value: number): number {
  if (value <= 0.04045) {
    return value / 12.92
  }

  return ((value + 0.055) / 1.055) ** 2.4
}

function oklab(color: RGBA) {
  const r = srgbToLinear(color.r)
  const g = srgbToLinear(color.g)
  const b = srgbToLinear(color.b)

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

function nearestIndexed(indexed: RGBA[], rgba: RGBA): RGBA {
  const target = oklab(rgba)
  const hit = indexed.reduce(
    (best, item) => {
      const sample = oklab(item)
      const dl = sample.l - target.l
      const da = sample.a - target.a
      const db = sample.b - target.b
      const dist = dl * dl * 2 + da * da + db * db
      if (dist >= best.dist) return best
      return {
        dist,
        item,
      }
    },
    {
      dist: Number.POSITIVE_INFINITY,
      item: indexed[0]!,
    },
  )

  return RGBA.clone(hit.item)
}

function paletteColor(colors: TerminalColors, index: number): RGBA {
  const value = colors.palette[index]
  return value ? RGBA.fromHex(value) : ansiToRgba(index)
}

function splashShadow(indexed: RGBA[], base: RGBA, overlay: RGBA, value: number): RGBA {
  const mixed = tint(base, overlay, value)
  return nearestIndexed(indexed, mixed)
}

export function resolveTheme(theme: ThemeJson, pick: "dark" | "light"): TuiThemeCurrent {
  const defs = theme.defs ?? {}

  const resolveColor = (value: ColorValue, chain: string[] = []): RGBA => {
    if (value instanceof RGBA) return value

    if (typeof value === "number") {
      return RGBA.fromIndex(value, ansiToRgba(value))
    }

    if (typeof value !== "string") {
      return resolveColor(value[pick], chain)
    }

    if (value === "transparent" || value === "none") {
      return RGBA.fromInts(0, 0, 0, 0)
    }

    if (value.startsWith("#")) {
      return RGBA.fromHex(value)
    }

    if (chain.includes(value)) {
      throw new Error(`Circular color reference: ${[...chain, value].join(" -> ")}`)
    }

    const next = defs[value] ?? theme.theme[value as ThemeColor]
    if (next === undefined) {
      throw new Error(`Color reference "${value}" not found in defs or theme`)
    }

    return resolveColor(next, [...chain, value])
  }

  const resolved = Object.fromEntries(
    Object.entries(theme.theme)
      .filter(([key]) => key !== "selectedListItemText" && key !== "backgroundMenu" && key !== "thinkingOpacity")
      .map(([key, value]) => [key, resolveColor(value as ColorValue)]),
  ) as Partial<Record<ThemeColor, RGBA>>

  return {
    ...(resolved as Record<ThemeColor, RGBA>),
    selectedListItemText:
      theme.theme.selectedListItemText === undefined
        ? resolved.background!
        : resolveColor(theme.theme.selectedListItemText),
    backgroundMenu:
      theme.theme.backgroundMenu === undefined ? resolved.backgroundElement! : resolveColor(theme.theme.backgroundMenu),
    thinkingOpacity: theme.theme.thinkingOpacity ?? 0.6,
  }
}

function generateGrayScale(bg: RGBA, isDark: boolean, map: (rgba: RGBA) => RGBA): Record<number, RGBA> {
  const r = bg.r * 255
  const g = bg.g * 255
  const b = bg.b * 255
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  const cast = 0.25 * (1 - chroma(bg)) ** 2

  const gray = (level: number) => {
    const factor = level / 12

    if (isDark && lum < 10) {
      const value = Math.floor(factor * 0.4 * 255)
      return map(RGBA.fromInts(value, value, value))
    }

    if (!isDark && lum > 245) {
      const value = Math.floor(255 - factor * 0.4 * 255)
      return map(RGBA.fromInts(value, value, value))
    }

    const value = isDark ? lum + (255 - lum) * factor * 0.4 : lum * (1 - factor * 0.4)
    const tone = RGBA.fromInts(Math.floor(value), Math.floor(value), Math.floor(value))
    if (cast === 0) return map(tone)

    const ratio = lum === 0 ? 0 : value / lum
    return map(
      tint(
        tone,
        RGBA.fromInts(
          Math.floor(Math.max(0, Math.min(r * ratio, 255))),
          Math.floor(Math.max(0, Math.min(g * ratio, 255))),
          Math.floor(Math.max(0, Math.min(b * ratio, 255))),
        ),
        cast,
      ),
    )
  }

  return Object.fromEntries(Array.from({ length: 12 }, (_, index) => [index + 1, gray(index + 1)]))
}

function generateMutedTextColor(bg: RGBA, isDark: boolean, map: (rgba: RGBA) => RGBA): RGBA {
  const lum = 0.299 * bg.r * 255 + 0.587 * bg.g * 255 + 0.114 * bg.b * 255
  const gray = isDark
    ? lum < 10
      ? 180
      : Math.min(Math.floor(160 + lum * 0.3), 200)
    : lum > 245
      ? 75
      : Math.max(Math.floor(100 - (255 - lum) * 0.2), 60)

  return map(RGBA.fromInts(gray, gray, gray))
}

export function generateSystem(colors: TerminalColors, pick: "dark" | "light"): ThemeJson {
  const bg_snapshot = RGBA.fromHex(colors.defaultBackground ?? colors.palette[0]!)
  const fg_snapshot = RGBA.fromHex(colors.defaultForeground ?? colors.palette[7]!)
  const bg = RGBA.defaultBackground(bg_snapshot)
  const fg = RGBA.defaultForeground(fg_snapshot)
  const isDark = pick === "dark"

  const color = (index: number) => paletteColor(colors, index)

  const grays = generateGrayScale(bg_snapshot, isDark, (rgba) => rgba)
  const textMuted = generateMutedTextColor(bg_snapshot, isDark, (rgba) => rgba)

  const ansi = {
    red: color(1),
    green: color(2),
    yellow: color(3),
    blue: color(4),
    magenta: color(5),
    cyan: color(6),
    red_bright: color(9),
    green_bright: color(10),
  }

  const diff_alpha = isDark ? 0.22 : 0.14
  const diff_context_bg = grays[2]
  const primary = ansi.cyan
  const secondary = ansi.magenta

  return {
    theme: {
      primary,
      secondary,
      accent: primary,
      error: ansi.red,
      warning: ansi.yellow,
      success: ansi.green,
      info: ansi.cyan,
      text: fg,
      textMuted,
      selectedListItemText: bg,
      background: alpha(bg, 0),
      backgroundPanel: grays[2],
      backgroundElement: grays[3],
      backgroundMenu: grays[3],
      borderSubtle: grays[6],
      border: grays[7],
      borderActive: grays[8],
      diffAdded: ansi.green,
      diffRemoved: ansi.red,
      diffContext: grays[7],
      diffHunkHeader: grays[7],
      diffHighlightAdded: ansi.green_bright,
      diffHighlightRemoved: ansi.red_bright,
      diffAddedBg: tint(bg_snapshot, ansi.green, diff_alpha),
      diffRemovedBg: tint(bg_snapshot, ansi.red, diff_alpha),
      diffContextBg: diff_context_bg,
      diffLineNumber: textMuted,
      diffAddedLineNumberBg: tint(diff_context_bg, ansi.green, diff_alpha),
      diffRemovedLineNumberBg: tint(diff_context_bg, ansi.red, diff_alpha),
      markdownText: fg,
      markdownHeading: fg,
      markdownLink: ansi.blue,
      markdownLinkText: ansi.cyan,
      markdownCode: ansi.green,
      markdownBlockQuote: ansi.yellow,
      markdownEmph: ansi.yellow,
      markdownStrong: fg,
      markdownHorizontalRule: grays[7],
      markdownListItem: ansi.blue,
      markdownListEnumeration: ansi.cyan,
      markdownImage: ansi.blue,
      markdownImageText: ansi.cyan,
      markdownCodeBlock: fg,
      syntaxComment: textMuted,
      syntaxKeyword: ansi.magenta,
      syntaxFunction: ansi.blue,
      syntaxVariable: fg,
      syntaxString: ansi.green,
      syntaxNumber: ansi.yellow,
      syntaxType: ansi.cyan,
      syntaxOperator: ansi.cyan,
      syntaxPunctuation: fg,
    },
  }
}

function quantizeColor(indexed: RGBA[], rgba: RGBA): RGBA {
  if (rgba.a === 0 || rgba.intent === "default" || rgba.intent === "indexed") {
    return RGBA.clone(rgba)
  }

  return nearestIndexed(indexed, rgba)
}

function quantizeTheme(theme: TuiThemeCurrent, indexed: RGBA[]): TuiThemeCurrent {
  const resolved = Object.fromEntries(
    Object.entries(theme)
      .filter(([key]) => key !== "thinkingOpacity")
      .map(([key, value]) => [key, quantizeColor(indexed, value as RGBA)]),
  ) as Partial<Record<ThemeColor, RGBA>>

  return {
    ...(resolved as Record<ThemeColor, RGBA>),
    thinkingOpacity: theme.thinkingOpacity,
  }
}

function splashTheme(theme: TuiThemeCurrent, indexed: RGBA[]): RunSplashTheme {
  const left = nearestIndexed(indexed, theme.textMuted)
  const right = nearestIndexed(indexed, theme.text)
  return {
    left,
    right,
    leftShadow: splashShadow(indexed, theme.background, left, 0.14),
    rightShadow: splashShadow(indexed, theme.background, right, 0.14),
  }
}

function map(
  footerTheme: TuiThemeCurrent,
  scrollbackTheme: TuiThemeCurrent,
  splash: RunSplashTheme,
  syntax?: SyntaxStyle,
  subtleSyntax?: SyntaxStyle,
): RunTheme {
  const opaqueSubtleSyntax = opaqueSyntaxStyle(subtleSyntax, scrollbackTheme.background)
  subtleSyntax?.destroy()
  const footerBackground = alpha(footerTheme.background, 1)
  const footerMode = mode(footerBackground)
  const shade = fade(footerTheme.backgroundMenu, footerTheme.background, 0.12, 0.56, 0.72)
  const surface = fade(footerTheme.backgroundMenu, footerTheme.background, 0.18, 0.76, 0.9)
  const line = fade(footerTheme.backgroundMenu, footerTheme.background, 0.24, 0.9, 0.98)
  const statusBase = tint(footerBackground, rgba("#000000"), footerMode === "dark" ? 0.12 : 0.06)
  const statusAccentBase =
    footerMode === "dark" ? tint(footerBackground, rgba("#ffffff"), 0.06) : tint(statusBase, rgba("#000000"), 0.04)
  const collapsedStatus = footerMode === "dark" && luminance(statusBase) <= 0.04
  // Pure-black backgrounds need a slight lift or the row disappears into the terminal background.
  const status = collapsedStatus ? tint(statusBase, statusAccentBase, 0.7) : statusBase
  const statusAccent = collapsedStatus ? tint(status, rgba("#ffffff"), 0.06) : statusAccentBase

  return {
    background: footerTheme.background,
    footer: {
      highlight: footerTheme.primary,
      selected: footerTheme.backgroundElement,
      selectedText: footerTheme.selectedListItemText,
      warning: footerTheme.warning,
      success: footerTheme.success,
      error: footerTheme.error,
      muted: footerTheme.textMuted,
      text: footerTheme.text,
      status,
      statusAccent,
      shade,
      surface,
      pane: footerTheme.backgroundMenu,
      border: footerTheme.border,
      line,
    },
    entry: {
      system: {
        body: scrollbackTheme.textMuted,
      },
      user: {
        body: scrollbackTheme.primary,
      },
      assistant: {
        body: scrollbackTheme.text,
      },
      reasoning: {
        body: scrollbackTheme.textMuted,
      },
      tool: {
        body: scrollbackTheme.text,
        start: scrollbackTheme.textMuted,
      },
      error: {
        body: scrollbackTheme.error,
      },
    },
    splash,
    block: {
      highlight: scrollbackTheme.primary,
      warning: scrollbackTheme.warning,
      text: scrollbackTheme.text,
      muted: scrollbackTheme.textMuted,
      syntax,
      subtleSyntax: opaqueSubtleSyntax,
      diffAdded: scrollbackTheme.diffAdded,
      diffRemoved: scrollbackTheme.diffRemoved,
      diffAddedBg: transparent,
      diffRemovedBg: transparent,
      diffContextBg: transparent,
      diffHighlightAdded: scrollbackTheme.diffHighlightAdded,
      diffHighlightRemoved: scrollbackTheme.diffHighlightRemoved,
      diffLineNumber: scrollbackTheme.diffLineNumber,
      diffAddedLineNumberBg: scrollbackTheme.diffAddedLineNumberBg,
      diffRemovedLineNumberBg: scrollbackTheme.diffRemovedLineNumberBg,
    },
  }
}

const seed = {
  highlight: RGBA.fromIndex(6, rgba("#38bdf8")),
  muted: RGBA.fromIndex(8, rgba("#64748b")),
  text: RGBA.defaultForeground(rgba("#f8fafc")),
  panel: rgba("#0f172a"),
  success: RGBA.fromIndex(2, rgba("#22c55e")),
  warning: RGBA.fromIndex(3, rgba("#f59e0b")),
  error: RGBA.fromIndex(1, rgba("#ef4444")),
}

function tone(body: ColorInput, start?: ColorInput): Tone {
  return {
    body,
    start,
  }
}

const fallbackSplashIndexed = Array.from({ length: 256 }, (_, index) => RGBA.fromIndex(index))
const fallbackSplashLeft = RGBA.fromIndex(67)
const fallbackSplashRight = RGBA.fromIndex(110)

export const RUN_THEME_FALLBACK: RunTheme = {
  background: RGBA.fromValues(0, 0, 0, 0),
  footer: {
    highlight: seed.highlight,
    selected: seed.text,
    selectedText: seed.panel,
    warning: seed.warning,
    success: seed.success,
    error: seed.error,
    muted: seed.muted,
    text: seed.text,
    status: tint(seed.panel, rgba("#000000"), 0.12),
    statusAccent: tint(seed.panel, rgba("#ffffff"), 0.06),
    shade: alpha(seed.panel, 0.68),
    surface: alpha(seed.panel, 0.86),
    pane: seed.panel,
    border: seed.muted,
    line: alpha(seed.panel, 0.96),
  },
  entry: {
    system: tone(seed.muted),
    user: tone(seed.highlight),
    assistant: tone(seed.text),
    reasoning: tone(seed.muted),
    tool: tone(seed.text, seed.muted),
    error: tone(seed.error),
  },
  splash: {
    left: fallbackSplashLeft,
    right: fallbackSplashRight,
    leftShadow: splashShadow(fallbackSplashIndexed, RGBA.fromValues(0, 0, 0, 0), fallbackSplashLeft, 0.14),
    rightShadow: splashShadow(fallbackSplashIndexed, RGBA.fromValues(0, 0, 0, 0), fallbackSplashRight, 0.14),
  },
  block: {
    highlight: seed.highlight,
    warning: seed.warning,
    text: seed.text,
    muted: seed.muted,
    diffAdded: seed.success,
    diffRemoved: seed.error,
    diffAddedBg: alpha(seed.success, 0.18),
    diffRemovedBg: alpha(seed.error, 0.18),
    diffContextBg: alpha(seed.panel, 0.72),
    diffHighlightAdded: seed.success,
    diffHighlightRemoved: seed.error,
    diffLineNumber: seed.muted,
    diffAddedLineNumberBg: alpha(seed.success, 0.12),
    diffRemovedLineNumberBg: alpha(seed.error, 0.12),
  },
}

export async function resolveRunTheme(renderer: CliRenderer): Promise<RunTheme> {
  try {
    const colors = await renderer.getPalette({
      size: 256,
    })
    const bg = colors.defaultBackground ?? colors.palette[0]
    if (!bg) {
      return RUN_THEME_FALLBACK
    }

    // Palette-only terminal reloads can leave renderer.themeMode stale, but
    // ANSI slot zero is not the terminal background when OSC 11 is absent.
    const pick = colors.defaultBackground
      ? mode(RGBA.fromHex(colors.defaultBackground))
      : (renderer.themeMode ?? mode(RGBA.fromHex(bg)))
    const footerTheme = resolveTheme(generateSystem(colors, pick), pick)
    const indexed = indexedPalette(colors, 256)
    const scrollbackTheme = quantizeTheme(footerTheme, indexed)
    const shared = await import("@opencode-ai/tui/context/theme")
    const syntaxTheme: SharedSyntaxTheme = {
      ...scrollbackTheme,
      _hasSelectedListItemText: true,
    }
    const syntax = shared.generateSyntax(syntaxTheme)
    return map(
      footerTheme,
      scrollbackTheme,
      splashTheme(scrollbackTheme, indexed),
      syntax,
      shared.generateSubtleSyntax(syntaxTheme),
    )
  } catch {
    return RUN_THEME_FALLBACK
  }
}
