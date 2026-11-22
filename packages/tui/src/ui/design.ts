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

/**
 * Every icon has a portable fallback and a Nerd Font variant. The portable set deliberately keeps the glyphs the
 * upstream TUI already shipped: they render in any UTF-8 terminal, while the private-use Nerd Font codepoints do not.
 * Keeping the fallback visually identical is what lets `ui.style: "opencode"` stay byte-for-byte upstream.
 */
export const iconCatalog = {
  branch: ["git:", "\ue725"],
  folder: ["dir:", "\uf07b"],
  file: ["file:", "\uf15b"],
  git: ["git:", "\uf1d3"],
  check: ["✓", "\uf00c"],
  cross: ["✗", "\uf00d"],
  close: ["✕", "\uf00d"],
  warning: ["⚠", "\uf071"],
  dot: ["●", "\uf111"],
  dotSmall: ["•", "\uf111"],
  circle: ["○", "\uf10c"],
  dotSelected: ["◉", "\uf192"],
  square: ["▪", "\uf0c8"],
  squareLarge: ["■", "\uf0c8"],
  triangle: ["△", "\uf071"],
  chevronRight: ["▶", "\uf054"],
  chevronDown: ["▼", "\uf078"],
  chevronSmall: ["›", "\uf054"],
  angleLeft: ["‹", "\uf104"],
  angleRight: ["›", "\uf105"],
  caretRight: ["▸", "\uf054"],
  caretDown: ["▾", "\uf078"],
  arrowRight: ["→", "\uf061"],
  arrowLeft: ["←", "\uf060"],
  arrowUp: ["↑", "\uf062"],
  arrowDown: ["↓", "\uf063"],
  levelDown: ["↳", "\uf148"],
  pipe: ["│", "│"],
  enter: ["↵", "\uf3b5"],
  branchMark: ["⎇", "\ue725"],
  search: ["⌕", "\uf002"],
  globe: ["◈", "\uf0ac"],
  gear: ["⚙", "\uf013"],
  sparkle: ["✱", "\uf069"],
  refresh: ["↻", "\uf021"],
  retry: ["⟳", "\uf021"],
  goal: ["◎", "\uf140"],
  diamond: ["◆", "\uf219"],
  diamondOutline: ["◇", "\uf10d"],
  copy: ["copy", "\uf0c5"],
  terminal: [">", "\uf120"],
  separator: ["·", "│"],
  tab: ["⇆", "\uf0ec"],
  question: ["?", "\uf059"],
  mcp: ["⊙", "\uf1e6"],
  sidebar: ["⬖", "\uf0c9"],
  edit: ["→", "\uf044"],
  editBlock: ["←", "\uf044"],
  created: ["#", "\uf067"],
  deleted: ["#", "\uf068"],
  read: ["→", "\uf15b"],
  list: ["→", "\uf0ca"],
  glob: ["✱", "\uf002"],
  grep: ["✱", "\uf002"],
  shell: ["#", "\uf120"],
  subagent: ["#", "\uf0c0"],
  webfetch: ["%", "\uf0ac"],
  websearch: ["◈", "\uf0ac"],
  lsp: ["→", "\uf121"],
  external: ["←", "\uf08e"],
  doom: ["⟳", "\uf021"],
  tool: ["⚙", "\uf013"],
  skill: ["→", "\uf0eb"],
  patch: ["%", "\uf044"],
  code: ["◇", "\uf121"],
  message: ["◇", "\uf075"],
} as const satisfies Record<string, readonly [ascii: string, nerd: string]>

export type IconName = keyof typeof iconCatalog

export const asciiIcons = Object.fromEntries(
  Object.entries(iconCatalog).map(([name, pair]) => [name, pair[0]]),
) as Readonly<Record<IconName, string>>

export const nerdIcons = Object.fromEntries(
  Object.entries(iconCatalog).map(([name, pair]) => [name, pair[1]]),
) as Readonly<Record<IconName, string>>

/** Motion frames are shared by every icon mode: they are not Nerd Font glyphs. */
export const motion = {
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  arcs: ["◜", "◝", "◞", "◟"],
  quadrants: ["◴", "◷", "◶", "◵"],
  shapes: ["⬥", "◆", "⬩", "⬪"],
  active: "■",
  idle: "⬝",
}

/** Keyboard labels are typography, not icons, but they should not be scattered through keymap code either. */
export const keys = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  enter: "↵",
  tab: "⇆",
} as const

export type KeyName = keyof typeof keys

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

// The terminal-wide mode is resolved once from `ui.icons`; pure helpers (permission, todo, tab labels) can therefore use
// the same icon set without threading a mode through every call site. Components should prefer `useDesign().icon`.
let active: ResolvedIconMode = "ascii"

export function setIconMode(mode: ResolvedIconMode) {
  active = mode
}

export function activeIconMode(): ResolvedIconMode {
  return active
}

export function icons(mode: ResolvedIconMode = active): Readonly<Record<IconName, string>> {
  return mode === "nerd" ? nerdIcons : asciiIcons
}

export function icon(name: IconName, mode: ResolvedIconMode = active): string {
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
