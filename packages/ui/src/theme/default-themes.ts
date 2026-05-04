import type { DesktopTheme } from "./types"
import oc2ThemeJson from "./themes/oc-2.json"
import aetherThemeJson from "./themes/aether.json"
import amoledThemeJson from "./themes/amoled.json"
import arcThemeJson from "./themes/arc.json"
import auraThemeJson from "./themes/aura.json"
// New themes from CLI conversion
import catppuccinFrappeThemeJson from "./themes/catppuccin-frappe.json"
import catppuccinMacchiatoThemeJson from "./themes/catppuccin-macchiato.json"
import cobalt2ThemeJson from "./themes/cobalt2.json"
import cursorThemeJson from "./themes/cursor.json"
import everforestThemeJson from "./themes/everforest.json"
import flexokiThemeJson from "./themes/flexoki.json"
import githubThemeJson from "./themes/github.json"
import kanagawaThemeJson from "./themes/kanagawa.json"
import lucentOrngThemeJson from "./themes/lucent-orng.json"
import materialThemeJson from "./themes/material.json"
import matrixThemeJson from "./themes/matrix.json"
import mercuryThemeJson from "./themes/mercury.json"
import oneDarkThemeJson from "./themes/one-dark.json"
import opencodeThemeJson from "./themes/opencode.json"
import orngThemeJson from "./themes/orng.json"
import osakaJadeThemeJson from "./themes/osaka-jade.json"
import palenightThemeJson from "./themes/palenight.json"
import rosepineThemeJson from "./themes/rosepine.json"
import synthwave84ThemeJson from "./themes/synthwave84.json"
import vercelThemeJson from "./themes/vercel.json"
import zenburnThemeJson from "./themes/zenburn.json"

export const oc2Theme = oc2ThemeJson as DesktopTheme
export const aetherTheme = aetherThemeJson as DesktopTheme
export const amoledTheme = amoledThemeJson as DesktopTheme
export const arcTheme = arcThemeJson as DesktopTheme
export const auraTheme = auraThemeJson as DesktopTheme
export const ayuTheme = ayuThemeJson as DesktopTheme
export const carbonfoxTheme = carbonfoxThemeJson as DesktopTheme
export const catppuccinTheme = catppuccinThemeJson as DesktopTheme
export const catppuccinFrappeTheme = catppuccinFrappeThemeJson as DesktopTheme
export const catppuccinMacchiatoTheme = catppuccinMacchiatoThemeJson as DesktopTheme
export const cobalt2Theme = cobalt2ThemeJson as DesktopTheme
export const cursorTheme = cursorThemeJson as DesktopTheme
export const draculaTheme = draculaThemeJson as DesktopTheme
export const everforestTheme = everforestThemeJson as DesktopTheme
export const flexokiTheme = flexokiThemeJson as DesktopTheme
export const githubTheme = githubThemeJson as DesktopTheme
export const gruvboxTheme = gruvboxThemeJson as DesktopTheme
export const kanagawaTheme = kanagawaThemeJson as DesktopTheme
export const lucentOrngTheme = lucentOrngThemeJson as DesktopTheme
export const materialTheme = materialThemeJson as DesktopTheme
export const matrixTheme = matrixThemeJson as DesktopTheme
export const mercuryTheme = mercuryThemeJson as DesktopTheme
export const monokaiTheme = monokaiThemeJson as DesktopTheme
export const nightowlTheme = nightowlThemeJson as DesktopTheme
export const nordTheme = nordThemeJson as DesktopTheme
export const oneDarkTheme = oneDarkThemeJson as DesktopTheme
export const oneDarkProTheme = oneDarkProThemeJson as DesktopTheme
export const opencodeTheme = opencodeThemeJson as DesktopTheme
export const orngTheme = orngThemeJson as DesktopTheme
export const osakaJadeTheme = osakaJadeThemeJson as DesktopTheme
export const palenightTheme = palenightThemeJson as DesktopTheme
export const rosepineTheme = rosepineThemeJson as DesktopTheme
export const shadesOfPurpleTheme = shadesOfPurpleThemeJson as DesktopTheme
export const solarizedTheme = solarizedThemeJson as DesktopTheme
export const synthwave84Theme = synthwave84ThemeJson as DesktopTheme
export const tokyonightTheme = tokyonightThemeJson as DesktopTheme
export const vercelTheme = vercelThemeJson as DesktopTheme
export const vesperTheme = vesperThemeJson as DesktopTheme
export const zenburnTheme = zenburnThemeJson as DesktopTheme

// New themes from CLI
export const catppuccinFrappeTheme = catppuccinFrappeThemeJson as DesktopTheme
export const catppuccinMacchiatoTheme = catppuccinMacchiatoThemeJson as DesktopTheme
export const cobalt2Theme = cobalt2ThemeJson as DesktopTheme
export const cursorTheme = cursorThemeJson as DesktopTheme
export const everforestTheme = everforestThemeJson as DesktopTheme
export const flexokiTheme = flexokiThemeJson as DesktopTheme
export const githubTheme = githubThemeJson as DesktopTheme
export const kanagawaTheme = kanagawaThemeJson as DesktopTheme
export const lucentOrngTheme = lucentOrngThemeJson as DesktopTheme
export const materialTheme = materialThemeJson as DesktopTheme
export const matrixTheme = matrixThemeJson as DesktopTheme
export const mercuryTheme = mercuryThemeJson as DesktopTheme
export const oneDarkTheme = oneDarkThemeJson as DesktopTheme
export const opencodeTheme = opencodeThemeJson as DesktopTheme
export const orngTheme = orngThemeJson as DesktopTheme
export const osakaJadeTheme = osakaJadeThemeJson as DesktopTheme
export const palenightTheme = palenightThemeJson as DesktopTheme
export const rosepineTheme = rosepineThemeJson as DesktopTheme
export const synthwave84Theme = synthwave84ThemeJson as DesktopTheme
export const vercelTheme = vercelThemeJson as DesktopTheme
export const zenburnTheme = zenburnThemeJson as DesktopTheme

export const DEFAULT_THEMES: Record<string, DesktopTheme> = {
  "oc-2": oc2Theme,
  aether: aetherTheme,
  amoled: amoledTheme,
  arc: arcTheme,
  aura: auraTheme,
  ayu: ayuTheme,
  carbonfox: carbonfoxTheme,
  catppuccin: catppuccinTheme,
  "catppuccin-frappe": catppuccinFrappeTheme,
  "catppuccin-macchiato": catppuccinMacchiatoTheme,
  cobalt2: cobalt2Theme,
  cursor: cursorTheme,
  dracula: draculaTheme,
  everforest: everforestTheme,
  flexoki: flexokiTheme,
  github: githubTheme,
  gruvbox: gruvboxTheme,
  kanagawa: kanagawaTheme,
  "lucent-orng": lucentOrngTheme,
  material: materialTheme,
  matrix: matrixTheme,
  mercury: mercuryTheme,
  monokai: monokaiTheme,
  nightowl: nightowlTheme,
  nord: nordTheme,
  "one-dark": oneDarkTheme,
  onedarkpro: oneDarkProTheme,
  opencode: opencodeTheme,
  orng: orngTheme,
  "osaka-jade": osakaJadeTheme,
  palenight: palenightTheme,
  rosepine: rosepineTheme,
  shadesofpurple: shadesOfPurpleTheme,
  solarized: solarizedTheme,
  synthwave84: synthwave84Theme,
  tokyonight: tokyonightTheme,
  vercel: vercelTheme,
  vesper: vesperTheme,

  // New themes from CLI conversion
  "catppuccin-frappe": catppuccinFrappeTheme,
  "catppuccin-macchiato": catppuccinMacchiatoTheme,
  cobalt2: cobalt2Theme,
  cursor: cursorTheme,
  everforest: everforestTheme,
  flexoki: flexokiTheme,
  github: githubTheme,
  kanagawa: kanagawaTheme,
  "lucent-orng": lucentOrngTheme,
  material: materialTheme,
  matrix: matrixTheme,
  mercury: mercuryTheme,
  "one-dark": oneDarkTheme,
  opencode: opencodeTheme,
  orng: orngTheme,
  "osaka-jade": osakaJadeTheme,
  palenight: palenightTheme,
  rosepine: rosepineTheme,
  synthwave84: synthwave84Theme,
  vercel: vercelTheme,
  zenburn: zenburnTheme,
}
