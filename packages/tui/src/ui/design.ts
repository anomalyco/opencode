import { RGBA } from "@opentui/core"

export type UiStyle = "fork" | "opencode"
export type ColorDepth = "auto" | "truecolor" | "256"
export type ResolvedColorDepth = Exclude<ColorDepth, "auto">
export type IconMode = "auto" | "nerd" | "ascii"
export type ResolvedIconMode = Exclude<IconMode, "auto">
export type MotionPreference = "auto" | "full" | "reduced"
export type ResolvedMotion = Exclude<MotionPreference, "auto">

/** Spacing scale shared by every client. Values are terminal cells. */
export const spacing = {
  none: 0,
  xs: 1,
  sm: 2,
  md: 3,
  lg: 4,
  xl: 6,
} as const

/** Corner radii in cells. Components that cannot round a corner fall back to `none`. */
export const radius = {
  none: 0,
  sm: 1,
  md: 2,
  lg: 3,
} as const

type Environment = Readonly<Record<string, string | undefined>>

const TRUECOLOR_TERMINALS = new Set(["iTerm.app", "WezTerm", "vscode", "ghostty", "kitty", "Hyper"])

/**
 * Resolves the configured color depth. `auto` only promises truecolor when the terminal advertises it, so an
 * unknown terminal gets the safe 256-color palette instead of broken escape sequences.
 */
export function resolveColorDepth(
  value: ColorDepth | undefined,
  environment: Environment = process.env,
): ResolvedColorDepth {
  if (value === "truecolor" || value === "256") return value
  const colorterm = environment.COLORTERM?.toLowerCase()
  if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor"
  const term = environment.TERM?.toLowerCase() ?? ""
  if (term.includes("direct") || term.includes("truecolor")) return "truecolor"
  if (environment.TERM_PROGRAM && TRUECOLOR_TERMINALS.has(environment.TERM_PROGRAM)) return "truecolor"
  return "256"
}

const asciiIcons = {
  branch: "git:",
  folder: "dir:",
  check: "ok",
  cross: "x",
  warning: "!",
  arrowRight: "->",
  copy: "copy",
  terminal: ">",
  search: "?",
  git: "git:",
} as const

export type IconName = keyof typeof asciiIcons

const nerdIcons: Record<IconName, string> = {
  branch: "\ue725",
  folder: "\uf07b",
  check: "\uf00c",
  cross: "\uf00d",
  warning: "\uf071",
  arrowRight: "\uf061",
  copy: "\uf0c5",
  terminal: "\uf120",
  search: "\uf002",
  git: "\uf1d3",
}

/**
 * Resolves the icon set. Nerd Fonts need a patched terminal font, which cannot be detected reliably, so `auto`
 * stays on ASCII unless the user opts in through the environment.
 */
export function resolveIconMode(
  value: IconMode | undefined,
  environment: Environment = process.env,
): ResolvedIconMode {
  if (value === "nerd" || value === "ascii") return value
  const flag = environment.OPENCODE_NERD_FONT ?? environment.NERD_FONT
  return flag === "1" || flag?.toLowerCase() === "true" ? "nerd" : "ascii"
}

export function icons(mode: ResolvedIconMode): Readonly<Record<IconName, string>> {
  return mode === "nerd" ? nerdIcons : asciiIcons
}

export function icon(name: IconName, mode: ResolvedIconMode): string {
  return icons(mode)[name]
}

/** `auto` maps to full motion: a terminal has no reliable reduced-motion signal, so users opt in explicitly. */
export function resolveMotion(
  value: MotionPreference | undefined,
  environment: Environment = process.env,
): ResolvedMotion {
  if (value === "full" || value === "reduced") return value
  const flag = environment.OPENCODE_REDUCED_MOTION ?? environment.REDUCED_MOTION
  return flag === "1" || flag?.toLowerCase() === "true" ? "reduced" : "full"
}

const ANSI_LEVELS = [0, 95, 135, 175, 215, 255] as const
let xtermPalette: ReadonlyArray<readonly [number, number, number]> | undefined

/** The 256-color ANSI palette: 16 system colors, a 6×6×6 cube and 24 grays. */
function palette256() {
  if (xtermPalette) return xtermPalette
  const colors: Array<readonly [number, number, number]> = [
    [0, 0, 0],
    [128, 0, 0],
    [0, 128, 0],
    [128, 128, 0],
    [0, 0, 128],
    [128, 0, 128],
    [0, 128, 128],
    [192, 192, 192],
    [128, 128, 128],
    [255, 0, 0],
    [0, 255, 0],
    [255, 255, 0],
    [0, 0, 255],
    [255, 0, 255],
    [0, 255, 255],
    [255, 255, 255],
  ]
  for (const r of ANSI_LEVELS) for (const g of ANSI_LEVELS) for (const b of ANSI_LEVELS) colors.push([r, g, b])
  for (let index = 0; index < 24; index += 1) {
    const gray = 8 + index * 10
    colors.push([gray, gray, gray])
  }
  xtermPalette = colors
  return colors
}

function byte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value * 255)))
}

/** Quantizes a truecolor value to the nearest 256-color palette entry, keeping alpha. */
export function to256(color: RGBA): RGBA {
  if (color.a === 0) return color
  const r = byte(color.r)
  const g = byte(color.g)
  const b = byte(color.b)
  let best = 0
  let distance = Number.POSITIVE_INFINITY
  palette256().forEach(([pr, pg, pb], index) => {
    const next = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2
    if (next < distance) {
      best = index
      distance = next
    }
  })
  const [pr, pg, pb] = palette256()[best]!
  return RGBA.fromInts(pr, pg, pb, Math.round(color.a * 255))
}

/** Replaces a color with its perceived luminance, keeping alpha. */
export function toMonochrome(color: RGBA): RGBA {
  if (color.a === 0) return color
  const value = byte(0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b)
  return RGBA.fromInts(value, value, value, Math.round(color.a * 255))
}

/**
 * Builds the transform applied to every resolved theme color. Mono runs first so the 256-color fallback can pick
 * from the gray ramp instead of quantizing three separate channels.
 */
export function colorTransform(depth: ResolvedColorDepth, mono: boolean): (color: RGBA) => RGBA {
  return (color) => {
    const next = mono ? toMonochrome(color) : color
    return depth === "256" ? to256(next) : next
  }
}
