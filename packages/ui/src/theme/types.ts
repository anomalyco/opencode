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
}

export interface ThemeVariant {
  seeds: ThemeSeedColors
  overrides?: Record<string, ColorValue>
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

export type ThemeToken = string

export type CssVarRef = `var(--${string})`

export type ColorValue = HexColor | CssVarRef

export type ResolvedTheme = Record<ThemeToken, ColorValue>
