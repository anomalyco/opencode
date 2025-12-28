/**
 * Desktop Theme System
 *
 * Unlike the TUI themes, desktop themes require more design tokens and use
 * OKLCH color space for generating color scales from seed colors.
 */

/** A hex color string like "#ffffff" or "#fff" */
export type HexColor = `#${string}`

/** OKLCH color representation for calculations */
export interface OklchColor {
  l: number // Lightness 0-1
  c: number // Chroma 0-0.4+
  h: number // Hue 0-360
}

/** The minimum colors needed to define a theme variant */
export interface ThemeSeedColors {
  /** Base neutral color - used to generate gray scale (smoke/ink) */
  neutral: HexColor
  /** Primary brand/accent color */
  primary: HexColor
  /** Success color (green) */
  success: HexColor
  /** Warning color (yellow/orange) */
  warning: HexColor
  /** Error/critical color (red) */
  error: HexColor
  /** Info color (purple/blue) */
  info: HexColor
  /** Interactive/link color (blue) */
  interactive: HexColor
  /** Diff add color */
  diffAdd: HexColor
  /** Diff delete color */
  diffDelete: HexColor
}

/** A theme variant (light or dark) with seed colors and optional overrides */
export interface ThemeVariant {
  /** Seed colors used to generate the full palette */
  seeds: ThemeSeedColors
  /** Optional direct overrides for any CSS variable (without -- prefix) */
  overrides?: Record<string, ColorValue>
}

/** A complete desktop theme definition */
export interface DesktopTheme {
  /** Schema version for future compatibility */
  $schema?: string
  /** Theme display name */
  name: string
  /** Theme identifier (slug) */
  id: string
  /** Light mode variant */
  light: ThemeVariant
  /** Dark mode variant */
  dark: ThemeVariant
}

/**
 * Categories of CSS variables that get generated from seed colors.
 * Each category maps to specific CSS custom properties.
 */
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

/**
 * All CSS variable names (without -- prefix) that the theme system generates.
 * These match the variables defined in theme.css
 */
export type ThemeToken = string

/** A CSS variable reference like "var(--text-weak)" */
export type CssVarRef = `var(--${string})`

/** A color value - either a hex color or a CSS variable reference */
export type ColorValue = HexColor | CssVarRef

/**
 * Resolved theme - all tokens mapped to their final colors
 */
export type ResolvedTheme = Record<ThemeToken, ColorValue>
