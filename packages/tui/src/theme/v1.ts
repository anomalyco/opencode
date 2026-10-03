import type { ThemeV1Json } from "@opencode/theme/tui/v1"
import aura from "./assets/aura.json" with { type: "json" }
import ayu from "./assets/ayu.json" with { type: "json" }
import carbonfox from "./assets/carbonfox.json" with { type: "json" }
import catppuccinFrappe from "./assets/catppuccin-frappe.json" with { type: "json" }
import catppuccinMacchiato from "./assets/catppuccin-macchiato.json" with { type: "json" }
import catppuccin from "./assets/catppuccin.json" with { type: "json" }
import cobalt2 from "./assets/cobalt2.json" with { type: "json" }
import cursor from "./assets/cursor.json" with { type: "json" }
import dracula from "./assets/dracula.json" with { type: "json" }
import everforest from "./assets/everforest.json" with { type: "json" }
import flexoki from "./assets/flexoki.json" with { type: "json" }
import github from "./assets/github.json" with { type: "json" }
import gruvbox from "./assets/gruvbox.json" with { type: "json" }
import kanagawa from "./assets/kanagawa.json" with { type: "json" }
import lucentOrng from "./assets/lucent-orng.json" with { type: "json" }
import material from "./assets/material.json" with { type: "json" }
import matrix from "./assets/matrix.json" with { type: "json" }
import mercury from "./assets/mercury.json" with { type: "json" }
import monokai from "./assets/monokai.json" with { type: "json" }
import nightowl from "./assets/nightowl.json" with { type: "json" }
import nord from "./assets/nord.json" with { type: "json" }
import onedark from "./assets/one-dark.json" with { type: "json" }
import orng from "./assets/orng.json" with { type: "json" }
import osakaJade from "./assets/osaka-jade.json" with { type: "json" }
import palenight from "./assets/palenight.json" with { type: "json" }
import rosepine from "./assets/rosepine.json" with { type: "json" }
import solarized from "./assets/solarized.json" with { type: "json" }
import synthwave84 from "./assets/synthwave84.json" with { type: "json" }
import tokyonight from "./assets/tokyonight.json" with { type: "json" }
import vercel from "./assets/vercel.json" with { type: "json" }
import vesper from "./assets/vesper.json" with { type: "json" }
import zenburn from "./assets/zenburn.json" with { type: "json" }

export type { ColorValue, Theme, ThemeColor, ThemeV1Json } from "@opencode/theme/tui/v1"

export const DEFAULT_THEMES: Record<string, ThemeV1Json> = {
  aura,
  ayu,
  catppuccin,
  ["catppuccin-frappe"]: catppuccinFrappe,
  ["catppuccin-macchiato"]: catppuccinMacchiato,
  cobalt2,
  cursor,
  dracula,
  everforest,
  flexoki,
  github,
  gruvbox,
  kanagawa,
  material,
  matrix,
  mercury,
  monokai,
  nightowl,
  nord,
  ["one-dark"]: onedark,
  ["osaka-jade"]: osakaJade,
  orng,
  ["lucent-orng"]: lucentOrng,
  palenight,
  rosepine,
  solarized,
  synthwave84,
  tokyonight,
  vesper,
  vercel,
  zenburn,
  carbonfox,
}
