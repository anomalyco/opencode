import type { DesktopTheme } from "./types"
import oc1ThemeJson from "./themes/oc-1.json"
import tokyoThemeJson from "./themes/tokyonight.json"
import draculaThemeJson from "./themes/dracula.json"
import monokaiThemeJson from "./themes/monokai.json"
import solarizedThemeJson from "./themes/solarized.json"
import nordThemeJson from "./themes/nord.json"
import catppuccinThemeJson from "./themes/catppuccin.json"
import ayuThemeJson from "./themes/ayu.json"
import oneDarkProThemeJson from "./themes/onedarkpro.json"
import shadesOfPurpleThemeJson from "./themes/shadesofpurple.json"
import nightowlThemeJson from "./themes/nightowl.json"
import vesperThemeJson from "./themes/vesper.json"

export const oc1Theme = oc1ThemeJson as DesktopTheme
export const tokyonightTheme = tokyoThemeJson as DesktopTheme
export const draculaTheme = draculaThemeJson as DesktopTheme
export const monokaiTheme = monokaiThemeJson as DesktopTheme
export const solarizedTheme = solarizedThemeJson as DesktopTheme
export const nordTheme = nordThemeJson as DesktopTheme
export const catppuccinTheme = catppuccinThemeJson as DesktopTheme
export const ayuTheme = ayuThemeJson as DesktopTheme
export const oneDarkProTheme = oneDarkProThemeJson as DesktopTheme
export const shadesOfPurpleTheme = shadesOfPurpleThemeJson as DesktopTheme
export const nightowlTheme = nightowlThemeJson as DesktopTheme
export const vesperTheme = vesperThemeJson as DesktopTheme

export const DEFAULT_THEMES: Record<string, DesktopTheme> = {
  "oc-1": oc1Theme,
  tokyonight: tokyonightTheme,
  dracula: draculaTheme,
  monokai: monokaiTheme,
  solarized: solarizedTheme,
  nord: nordTheme,
  catppuccin: catppuccinTheme,
  ayu: ayuTheme,
  onedarkpro: oneDarkProTheme,
  shadesofpurple: shadesOfPurpleTheme,
  nightowl: nightowlTheme,
  vesper: vesperTheme,
}
