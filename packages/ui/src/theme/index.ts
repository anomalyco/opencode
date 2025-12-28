/**
 * Desktop Theme System
 *
 * Provides JSON-based theming for the desktop app. Unlike TUI themes,
 * desktop themes use more design tokens and generate full color scales
 * from seed colors.
 *
 * Usage:
 * ```ts
 * import { applyTheme } from "@opencode/ui/theme"
 * import myTheme from "./themes/my-theme.json"
 *
 * applyTheme(myTheme)
 * ```
 */

// Types
export type {
  DesktopTheme,
  ThemeSeedColors,
  ThemeVariant,
  HexColor,
  OklchColor,
  ResolvedTheme,
  ColorValue,
  CssVarRef,
} from "./types"

// Color utilities
export {
  hexToRgb,
  rgbToHex,
  hexToOklch,
  oklchToHex,
  rgbToOklch,
  oklchToRgb,
  generateScale,
  generateNeutralScale,
  generateAlphaScale,
  mixColors,
  lighten,
  darken,
  withAlpha,
} from "./color"

// Theme resolution
export { resolveThemeVariant, resolveTheme, themeToCss } from "./resolve"

// Theme loader
export { applyTheme, loadThemeFromUrl, getActiveTheme, removeTheme, setColorScheme } from "./loader"

// Theme context (SolidJS)
export { ThemeProvider, useTheme, type ColorScheme } from "./context"

// Preload script utilities
export { generatePreloadScript, generatePreloadScriptFormatted, STORAGE_KEYS, getThemeCacheKey } from "./preload"

// Default themes
export {
  DEFAULT_THEMES,
  oc1Theme,
  tokyonightTheme,
  draculaTheme,
  monokaiTheme,
  solarizedTheme,
  nordTheme,
  catppuccinTheme,
  ayuTheme,
  oneDarkProTheme,
  shadesOfPurpleTheme,
} from "./default-themes"
