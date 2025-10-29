import { SyntaxStyle, RGBA } from "@opentui/core"
import { createMemo, createSignal, createEffect } from "solid-js"
import { useSync } from "@tui/context/sync"
import { createSimpleContext } from "./helper"
import aura from "../../../../../../tui/internal/theme/themes/aura.json" with { type: "json" }
import ayu from "../../../../../../tui/internal/theme/themes/ayu.json" with { type: "json" }
import catppuccin from "../../../../../../tui/internal/theme/themes/catppuccin.json" with { type: "json" }
import cobalt2 from "../../../../../../tui/internal/theme/themes/cobalt2.json" with { type: "json" }
import dracula from "../../../../../../tui/internal/theme/themes/dracula.json" with { type: "json" }
import everforest from "../../../../../../tui/internal/theme/themes/everforest.json" with { type: "json" }
import github from "../../../../../../tui/internal/theme/themes/github.json" with { type: "json" }
import gruvbox from "../../../../../../tui/internal/theme/themes/gruvbox.json" with { type: "json" }
import kanagawa from "../../../../../../tui/internal/theme/themes/kanagawa.json" with { type: "json" }
import material from "../../../../../../tui/internal/theme/themes/material.json" with { type: "json" }
import matrix from "../../../../../../tui/internal/theme/themes/matrix.json" with { type: "json" }
import monokai from "../../../../../../tui/internal/theme/themes/monokai.json" with { type: "json" }
import nord from "../../../../../../tui/internal/theme/themes/nord.json" with { type: "json" }
import onedark from "../../../../../../tui/internal/theme/themes/one-dark.json" with { type: "json" }
import opencode from "../../../../../../tui/internal/theme/themes/opencode.json" with { type: "json" }
import palenight from "../../../../../../tui/internal/theme/themes/palenight.json" with { type: "json" }
import rosepine from "../../../../../../tui/internal/theme/themes/rosepine.json" with { type: "json" }
import solarized from "../../../../../../tui/internal/theme/themes/solarized.json" with { type: "json" }
import synthwave84 from "../../../../../../tui/internal/theme/themes/synthwave84.json" with { type: "json" }
import tokyonight from "../../../../../../tui/internal/theme/themes/tokyonight.json" with { type: "json" }
import vesper from "../../../../../../tui/internal/theme/themes/vesper.json" with { type: "json" }
import zenburn from "../../../../../../tui/internal/theme/themes/zenburn.json" with { type: "json" }
import { iife } from "@/util/iife"
import { createStore, reconcile } from "solid-js/store"

type Theme = {
  primary: RGBA
  secondary: RGBA
  accent: RGBA
  error: RGBA
  warning: RGBA
  success: RGBA
  info: RGBA
  text: RGBA
  textMuted: RGBA
  background: RGBA
  backgroundPanel: RGBA
  backgroundElement: RGBA
  border: RGBA
  borderActive: RGBA
  borderSubtle: RGBA
  diffAdded: RGBA
  diffRemoved: RGBA
  diffContext: RGBA
  diffHunkHeader: RGBA
  diffHighlightAdded: RGBA
  diffHighlightRemoved: RGBA
  diffAddedBg: RGBA
  diffRemovedBg: RGBA
  diffContextBg: RGBA
  diffLineNumber: RGBA
  diffAddedLineNumberBg: RGBA
  diffRemovedLineNumberBg: RGBA
  markdownText: RGBA
  markdownHeading: RGBA
  markdownLink: RGBA
  markdownLinkText: RGBA
  markdownCode: RGBA
  markdownBlockQuote: RGBA
  markdownEmph: RGBA
  markdownStrong: RGBA
  markdownHorizontalRule: RGBA
  markdownListItem: RGBA
  markdownListEnumeration: RGBA
  markdownImage: RGBA
  markdownImageText: RGBA
  markdownCodeBlock: RGBA
}

type HexColor = `#${string}`
type RefName = string
type ColorModeObj = {
  dark: HexColor | RefName
  light: HexColor | RefName
}
type ColorValue = HexColor | RefName | ColorModeObj
type ThemeJson = {
  $schema?: string
  defs?: Record<string, HexColor | RefName>
  theme: Record<keyof Theme, ColorValue>
}

export const THEMES = {
  aura: resolveTheme(aura),
  ayu: resolveTheme(ayu),
  catppuccin: resolveTheme(catppuccin),
  cobalt2: resolveTheme(cobalt2),
  dracula: resolveTheme(dracula),
  everforest: resolveTheme(everforest),
  github: resolveTheme(github),
  gruvbox: resolveTheme(gruvbox),
  kanagawa: resolveTheme(kanagawa),
  material: resolveTheme(material),
  matrix: resolveTheme(matrix),
  monokai: resolveTheme(monokai),
  nord: resolveTheme(nord),
  ["one-dark"]: resolveTheme(onedark),
  opencode: resolveTheme(opencode),
  palenight: resolveTheme(palenight),
  rosepine: resolveTheme(rosepine),
  solarized: resolveTheme(solarized),
  synthwave84: resolveTheme(synthwave84),
  tokyonight: resolveTheme(tokyonight),
  vesper: resolveTheme(vesper),
  zenburn: resolveTheme(zenburn),
}

function resolveTheme(theme: ThemeJson) {
  const defs = theme.defs ?? {}
  function resolveColor(c: ColorValue): RGBA {
    if (typeof c === "string") return c.startsWith("#") ? RGBA.fromHex(c) : resolveColor(defs[c])
    // TODO: support light theme when opentui has the equivalent of lipgloss.AdaptiveColor
    return resolveColor(c.dark)
  }
  return Object.fromEntries(
    Object.entries(theme.theme).map(([key, value]) => {
      return [key, resolveColor(value)]
    }),
  ) as Theme
}

const syntaxThemeDark = [
  {
    scope: ["prompt"],
    style: {
      foreground: "#56b6c2",
    },
  },
  {
    scope: ["extmark.file"],
    style: {
      foreground: "#f5a742",
      bold: true,
    },
  },
  {
    scope: ["extmark.agent"],
    style: {
      foreground: "#fab283",
      bold: true,
    },
  },
  {
    scope: ["extmark.paste"],
    style: {
      foreground: "#0a0a0a",
      background: "#f5a742",
      bold: true,
    },
  },
  {
    scope: ["comment"],
    style: {
      foreground: "#808080",
      italic: true,
    },
  },
  {
    scope: ["comment.documentation"],
    style: {
      foreground: "#808080",
      italic: true,
    },
  },
  {
    scope: ["string", "symbol"],
    style: {
      foreground: "#7fd88f",
    },
  },
  {
    scope: ["number", "boolean"],
    style: {
      foreground: "#f5a742",
    },
  },
  {
    scope: ["character.special"],
    style: {
      foreground: "#7fd88f",
    },
  },
  {
    scope: ["keyword.return", "keyword.conditional", "keyword.repeat", "keyword.coroutine"],
    style: {
      foreground: "#9d7cd8",
      italic: true,
    },
  },
  {
    scope: ["keyword.type"],
    style: {
      foreground: "#e5c07b",
      bold: true,
      italic: true,
    },
  },
  {
    scope: ["keyword.function", "function.method"],
    style: {
      foreground: "#fab283",
    },
  },
  {
    scope: ["keyword"],
    style: {
      foreground: "#9d7cd8",
      italic: true,
    },
  },
  {
    scope: ["keyword.import"],
    style: {
      foreground: "#9d7cd8",
    },
  },
  {
    scope: ["operator", "keyword.operator", "punctuation.delimiter"],
    style: {
      foreground: "#56b6c2",
    },
  },
  {
    scope: ["keyword.conditional.ternary"],
    style: {
      foreground: "#56b6c2",
    },
  },
  {
    scope: ["variable", "variable.parameter", "function.method.call", "function.call"],
    style: {
      foreground: "#e06c75",
    },
  },
  {
    scope: ["variable.member", "function", "constructor"],
    style: {
      foreground: "#fab283",
    },
  },
  {
    scope: ["type", "module"],
    style: {
      foreground: "#e5c07b",
    },
  },
  {
    scope: ["constant"],
    style: {
      foreground: "#e06c75",
    },
  },
  {
    scope: ["property"],
    style: {
      foreground: "#e06c75",
    },
  },
  {
    scope: ["class"],
    style: {
      foreground: "#e5c07b",
    },
  },
  {
    scope: ["parameter"],
    style: {
      foreground: "#eeeeee",
    },
  },
  {
    scope: ["punctuation", "punctuation.bracket"],
    style: {
      foreground: "#eeeeee",
    },
  },
  {
    scope: ["variable.builtin", "type.builtin", "function.builtin", "module.builtin", "constant.builtin"],
    style: {
      foreground: "#7fd88f",
    },
  },
  {
    scope: ["variable.super"],
    style: {
      foreground: "#e06c75",
    },
  },
  {
    scope: ["string.escape", "string.regexp"],
    style: {
      foreground: "#7fd88f",
    },
  },
  {
    scope: ["keyword.directive"],
    style: {
      foreground: "#9d7cd8",
      italic: true,
    },
  },
  {
    scope: ["punctuation.special"],
    style: {
      foreground: "#56b6c2",
    },
  },
  {
    scope: ["keyword.modifier"],
    style: {
      foreground: "#9d7cd8",
      italic: true,
    },
  },
  {
    scope: ["keyword.exception"],
    style: {
      foreground: "#9d7cd8",
      italic: true,
    },
  },
]

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: () => {
    const sync = useSync()
    const [selectedTheme, setSelectedTheme] = createSignal<keyof typeof THEMES>("opencode")
    const [theme, setTheme] = createStore({} as Theme)
    const syntaxTheme = createMemo(() => SyntaxStyle.fromTheme(syntaxThemeDark))

    createEffect(() => {
      if (!sync.ready) return
      setSelectedTheme(
        iife(() => {
          if (typeof sync.data.config.theme === "string" && sync.data.config.theme in THEMES) {
            return sync.data.config.theme as keyof typeof THEMES
          }
          return "opencode"
        }),
      )
    })
    createEffect(() => {
      setTheme(reconcile(THEMES[selectedTheme()]))
    })

    return {
      theme,
      syntaxTheme,
      selectedTheme,
      setSelectedTheme,
      get ready() {
        return sync.ready
      },
    }
  },
})
