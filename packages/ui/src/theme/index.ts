export type {
  DesktopTheme,
  ThemePaletteColors,
  ThemeSeedColors,
  ThemeVariant,
  HexColor,
  OklchColor,
  ResolvedTheme,
  ColorValue,
  CssVarRef,
  V2ColorValue,
  ResolvedV2Theme,
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
  fitOklch,
  blend,
  mixColors,
  shift,
  withAlpha,
} from "./color"

export { resolveThemeVariant, themeToCss } from "./resolve"

export { resolveThemeVariantV2, resolveThemeV2, themeV2ToCss, generateV2Primitives } from "./v2/resolve"

export { ThemeProvider, useTheme, type ColorScheme } from "./context"
