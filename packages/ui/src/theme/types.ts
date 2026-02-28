export type HexColor = `#${string}`

export interface OklchColor {
  l: number // Lightness 0-1
  c: number // Chroma 0-0.4+
  h: number // Hue 0-360
}

export interface ThemeSeedColors {
  neutral: HexColor
  primary: HexColor
  success: HexColor
  warning: HexColor
  error: HexColor
  info: HexColor
  interactive: HexColor
  diffAdd: HexColor
  diffDelete: HexColor
  /** Accent color for glows, highlights, and interactive emphasis. Falls back to `interactive`. */
  accent?: HexColor
  /** Secondary accent (e.g. assistant borders, secondary highlights). Falls back to `info`. */
  accentSecondary?: HexColor
  /** Tertiary accent (e.g. attention, warm highlights). Falls back to `warning`. */
  accentTertiary?: HexColor
}

export interface ThemeVariant {
  seeds: ThemeSeedColors
  overrides?: Record<string, TokenValue>
}

export interface DesktopTheme {
  $schema?: string
  name: string
  id: string
  light: ThemeVariant
  dark: ThemeVariant
}

export type TokenCategory =
  | "background"
  | "surface"
  | "text"
  | "border"
  | "icon"
  | "input"
  | "button"
  | "syntax"
  | "markdown"
  | "diff"
  | "avatar"
  | "accent"
  | "glow"
  | "glass"
  | "motion"
  | "radius"
  | "message"

export type ThemeToken = string

export type CssVarRef = `var(--${string})`

export type ColorValue = HexColor | CssVarRef

/** Any CSS-valid token value — hex colors, rgba(), box-shadow strings, easing functions, etc. */
export type TokenValue = string

export type ResolvedTheme = Record<ThemeToken, TokenValue>
