import { RGBA } from "@opentui/core"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import aura from "./theme/aura.json" with { type: "json" }
import ayu from "./theme/ayu.json" with { type: "json" }
import catppuccin from "./theme/catppuccin.json" with { type: "json" }
import catppuccinFrappe from "./theme/catppuccin-frappe.json" with { type: "json" }
import catppuccinMacchiato from "./theme/catppuccin-macchiato.json" with { type: "json" }
import cobalt2 from "./theme/cobalt2.json" with { type: "json" }
import cursor from "./theme/cursor.json" with { type: "json" }
import dracula from "./theme/dracula.json" with { type: "json" }
import everforest from "./theme/everforest.json" with { type: "json" }
import flexoki from "./theme/flexoki.json" with { type: "json" }
import github from "./theme/github.json" with { type: "json" }
import gruvbox from "./theme/gruvbox.json" with { type: "json" }
import kanagawa from "./theme/kanagawa.json" with { type: "json" }
import material from "./theme/material.json" with { type: "json" }
import matrix from "./theme/matrix.json" with { type: "json" }
import mercury from "./theme/mercury.json" with { type: "json" }
import monokai from "./theme/monokai.json" with { type: "json" }
import nightowl from "./theme/nightowl.json" with { type: "json" }
import nord from "./theme/nord.json" with { type: "json" }
import osakaJade from "./theme/osaka-jade.json" with { type: "json" }
import onedark from "./theme/one-dark.json" with { type: "json" }
import opencode from "./theme/opencode.json" with { type: "json" }
import orng from "./theme/orng.json" with { type: "json" }
import lucentOrng from "./theme/lucent-orng.json" with { type: "json" }
import palenight from "./theme/palenight.json" with { type: "json" }
import rosepine from "./theme/rosepine.json" with { type: "json" }
import solarized from "./theme/solarized.json" with { type: "json" }
import synthwave84 from "./theme/synthwave84.json" with { type: "json" }
import tokyonight from "./theme/tokyonight.json" with { type: "json" }
import vercel from "./theme/vercel.json" with { type: "json" }
import vesper from "./theme/vesper.json" with { type: "json" }
import zenburn from "./theme/zenburn.json" with { type: "json" }
import carbonfox from "./theme/carbonfox.json" with { type: "json" }

export type Theme = TuiThemeCurrent & {
  _hasSelectedListItemText: boolean
}

type ThemeColor = Exclude<keyof TuiThemeCurrent, "thinkingOpacity">
type HexColor = `#${string}`
type RefName = string
type Variant = {
  dark: HexColor | RefName
  light: HexColor | RefName
}
type ColorValue = HexColor | RefName | Variant | RGBA

export type ThemeJson = {
  $schema?: string
  defs?: Record<string, HexColor | RefName>
  theme: Omit<
    Record<ThemeColor, ColorValue>,
    "selectedListItemText" | "backgroundMenu" | "syntaxTag" | "syntaxAttribute" | "syntaxTagDelimiter"
  > & {
    selectedListItemText?: ColorValue
    backgroundMenu?: ColorValue
    syntaxTag?: ColorValue
    syntaxAttribute?: ColorValue
    syntaxTagDelimiter?: ColorValue
    thinkingOpacity?: number
  }
}

export const DEFAULT_THEMES: Record<string, ThemeJson> = {
  aura,
  ayu,
  catppuccin,
  ["catppuccin-frappe"]: catppuccinFrappe,
  ["catppuccin-macchiato"]: catppuccinMacchiato,
  cobalt2,
  cursor,
  dracula,
  everforest,
  flexoki,
  github,
  gruvbox,
  kanagawa,
  material,
  matrix,
  mercury,
  monokai,
  nightowl,
  nord,
  ["one-dark"]: onedark,
  ["osaka-jade"]: osakaJade,
  opencode,
  orng,
  ["lucent-orng"]: lucentOrng,
  palenight,
  rosepine,
  solarized,
  synthwave84,
  tokyonight,
  vesper,
  vercel,
  zenburn,
  carbonfox,
}

export function resolveTheme(theme: ThemeJson, mode: "dark" | "light") {
  const defs = theme.defs ?? {}
  function resolveColor(c: ColorValue, chain: string[] = []): RGBA {
    if (c instanceof RGBA) return c
    if (typeof c === "string") {
      if (c === "transparent" || c === "none") return RGBA.fromInts(0, 0, 0, 0)
      if (c.startsWith("#")) return RGBA.fromHex(c)
      if (chain.includes(c)) {
        throw new Error(`Circular color reference: ${[...chain, c].join(" -> ")}`)
      }

      const next = defs[c] ?? theme.theme[c as ThemeColor]
      if (next === undefined) {
        throw new Error(`Color reference "${c}" not found in defs or theme`)
      }
      return resolveColor(next, [...chain, c])
    }
    if (typeof c === "number") return ansiToRgba(c)
    return resolveColor(c[mode], chain)
  }

  const resolved = Object.fromEntries(
    Object.entries(theme.theme)
      .filter(
        ([key]) =>
          key !== "selectedListItemText" &&
          key !== "backgroundMenu" &&
          key !== "thinkingOpacity" &&
          key !== "syntaxTag" &&
          key !== "syntaxAttribute" &&
          key !== "syntaxTagDelimiter",
      )
      .map(([key, value]) => [key, resolveColor(value as ColorValue)]),
  ) as Partial<Record<ThemeColor, RGBA>>

  const hasSelectedListItemText = theme.theme.selectedListItemText !== undefined
  if (hasSelectedListItemText) {
    resolved.selectedListItemText = resolveColor(theme.theme.selectedListItemText!)
  } else {
    resolved.selectedListItemText = resolved.background
  }

  if (theme.theme.backgroundMenu !== undefined) {
    resolved.backgroundMenu = resolveColor(theme.theme.backgroundMenu)
  } else {
    resolved.backgroundMenu = resolved.backgroundElement
  }

  if (theme.theme.syntaxTag !== undefined) {
    resolved.syntaxTag = resolveColor(theme.theme.syntaxTag)
  } else {
    resolved.syntaxTag = resolved.error
  }

  if (theme.theme.syntaxAttribute !== undefined) {
    resolved.syntaxAttribute = resolveColor(theme.theme.syntaxAttribute)
  } else {
    resolved.syntaxAttribute = resolved.syntaxKeyword
  }

  if (theme.theme.syntaxTagDelimiter !== undefined) {
    resolved.syntaxTagDelimiter = resolveColor(theme.theme.syntaxTagDelimiter)
  } else {
    resolved.syntaxTagDelimiter = resolved.syntaxOperator
  }

  const thinkingOpacity = theme.theme.thinkingOpacity ?? 0.6

  return {
    ...resolved,
    _hasSelectedListItemText: hasSelectedListItemText,
    thinkingOpacity,
  } as Theme
}

export function ansiToRgba(code: number): RGBA {
  if (code < 16) {
    const ansiColors = [
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
    return RGBA.fromHex(ansiColors[code] ?? "#000000")
  }

  if (code < 232) {
    const index = code - 16
    const b = index % 6
    const g = Math.floor(index / 6) % 6
    const r = Math.floor(index / 36)
    const val = (x: number) => (x === 0 ? 0 : x * 40 + 55)
    return RGBA.fromInts(val(r), val(g), val(b))
  }

  if (code < 256) {
    const gray = (code - 232) * 10 + 8
    return RGBA.fromInts(gray, gray, gray)
  }

  return RGBA.fromInts(0, 0, 0)
}
