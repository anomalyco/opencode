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
  // Original themes
  oc1Theme,
  oc2Theme,
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
  carbonfoxTheme,
  gruvboxTheme,
  auraTheme,
  // New themes from CLI conversion
  catppuccinFrappeTheme,
  catppuccinMacchiatoTheme,
  cobalt2Theme,
  cursorTheme,
  everforestTheme,
  flexokiTheme,
  githubTheme,
  kanagawaTheme,
  lucentOrngTheme,
  materialTheme,
  matrixTheme,
  mercuryTheme,
  oneDarkTheme,
  opencodeTheme,
  orngTheme,
  osakaJadeTheme,
  palenightTheme,
  rosepineTheme,
  synthwave84Theme,
  vercelTheme,
  zenburnTheme,
} from "./default-themes"
