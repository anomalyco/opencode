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

export { resolveThemeVariant, resolveTheme, themeToCss } from "./resolve"
export { applyTheme, loadThemeFromUrl, getActiveTheme, removeTheme, setColorScheme } from "./loader"
export { ThemeProvider, useTheme, type ColorScheme } from "./context"

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
  nightowlTheme,
  vesperTheme,
} from "./default-themes"
