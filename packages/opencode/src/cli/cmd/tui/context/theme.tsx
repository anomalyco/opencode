import { SyntaxStyle, RGBA } from "@opentui/core"
import { createMemo, createSignal } from "solid-js"
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
import { useKV } from "./kv"

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

export const THEMES: Record<string, Theme> = {
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
      foreground: "#7dcfff",
    },
  },
  {
    scope: ["extmark.file"],
    style: {
      foreground: "#ff9e64",
      bold: true,
    },
  },
  {
    scope: ["extmark.agent"],
    style: {
      foreground: "#bb9af7",
      bold: true,
    },
  },
  {
    scope: ["extmark.paste"],
    style: {
      foreground: "#1a1b26",
      background: "#ff9e64",
      bold: true,
    },
  },
  {
    scope: ["comment"],
    style: {
      foreground: "#565f89",
      italic: true,
    },
  },
  {
    scope: ["comment.documentation"],
    style: {
      foreground: "#565f89",
      italic: true,
    },
  },
  {
    scope: ["string", "symbol"],
    style: {
      foreground: "#9ece6a",
    },
  },
  {
    scope: ["number", "boolean"],
    style: {
      foreground: "#ff9e64",
    },
  },
  {
    scope: ["character.special"],
    style: {
      foreground: "#9ece6a",
    },
  },
  {
    scope: ["keyword.return", "keyword.conditional", "keyword.repeat", "keyword.coroutine"],
    style: {
      foreground: "#bb9af7",
      italic: true,
    },
  },
  {
    scope: ["keyword.type"],
    style: {
      foreground: "#2ac3de",
      bold: true,
      italic: true,
    },
  },
  {
    scope: ["keyword.function", "function.method"],
    style: {
      foreground: "#bb9af7",
    },
  },
  {
    scope: ["keyword"],
    style: {
      foreground: "#bb9af7",
      italic: true,
    },
  },
  {
    scope: ["keyword.import"],
    style: {
      foreground: "#bb9af7",
    },
  },
  {
    scope: ["operator", "keyword.operator", "punctuation.delimiter"],
    style: {
      foreground: "#89ddff",
    },
  },
  {
    scope: ["keyword.conditional.ternary"],
    style: {
      foreground: "#89ddff",
    },
  },
  {
    scope: ["variable", "variable.parameter", "function.method.call", "function.call"],
    style: {
      foreground: "#7dcfff",
    },
  },
  {
    scope: ["variable.member", "function", "constructor"],
    style: {
      foreground: "#7aa2f7",
    },
  },
  {
    scope: ["type", "module"],
    style: {
      foreground: "#2ac3de",
    },
  },
  {
    scope: ["constant"],
    style: {
      foreground: "#ff9e64",
    },
  },
  {
    scope: ["property"],
    style: {
      foreground: "#73daca",
    },
  },
  {
    scope: ["class"],
    style: {
      foreground: "#2ac3de",
    },
  },
  {
    scope: ["parameter"],
    style: {
      foreground: "#e0af68",
    },
  },
  {
    scope: ["punctuation", "punctuation.bracket"],
    style: {
      foreground: "#89ddff",
    },
  },
  {
    scope: [
      "variable.builtin",
      "type.builtin",
      "function.builtin",
      "module.builtin",
      "constant.builtin",
    ],
    style: {
      foreground: "#f7768e",
    },
  },
  {
    scope: ["variable.super"],
    style: {
      foreground: "#f7768e",
    },
  },
  {
    scope: ["string.escape", "string.regexp"],
    style: {
      foreground: "#bb9af7",
    },
  },
  {
    scope: ["keyword.directive"],
    style: {
      foreground: "#bb9af7",
      italic: true,
    },
  },
  {
    scope: ["punctuation.special"],
    style: {
      foreground: "#89ddff",
    },
  },
  {
    scope: ["keyword.modifier"],
    style: {
      foreground: "#bb9af7",
      italic: true,
    },
  },
  {
    scope: ["keyword.exception"],
    style: {
      foreground: "#bb9af7",
      italic: true,
    },
  },
  // Markdown specific styles
  {
    scope: ["markup.heading"],
    style: {
      foreground: "#7aa2f7",
      bold: true,
    },
  },
  {
    scope: ["markup.heading.1"],
    style: {
      foreground: "#bb9af7",
      bold: true,
    },
  },
  {
    scope: ["markup.heading.2"],
    style: {
      foreground: "#7aa2f7",
      bold: true,
    },
  },
  {
    scope: ["markup.heading.3"],
    style: {
      foreground: "#7dcfff",
      bold: true,
    },
  },
  {
    scope: ["markup.heading.4"],
    style: {
      foreground: "#73daca",
      bold: true,
    },
  },
  {
    scope: ["markup.heading.5"],
    style: {
      foreground: "#9ece6a",
      bold: true,
    },
  },
  {
    scope: ["markup.heading.6"],
    style: {
      foreground: "#565f89",
      bold: true,
    },
  },
  {
    scope: ["markup.bold", "markup.strong"],
    style: {
      foreground: "#e6edf3",
      bold: true,
    },
  },
  {
    scope: ["markup.italic"],
    style: {
      foreground: "#e6edf3",
      italic: true,
    },
  },
  {
    scope: ["markup.list"],
    style: {
      foreground: "#ff9e64",
    },
  },
  {
    scope: ["markup.quote"],
    style: {
      foreground: "#565f89",
      italic: true,
    },
  },
  {
    scope: ["markup.raw", "markup.raw.block"],
    style: {
      foreground: "#9ece6a",
    },
  },
  {
    scope: ["markup.raw.inline"],
    style: {
      foreground: "#9ece6a",
      background: "#1a1b26",
    },
  },
  {
    scope: ["markup.link"],
    style: {
      foreground: "#7aa2f7",
      underline: true,
    },
  },
  {
    scope: ["markup.link.label"],
    style: {
      foreground: "#7dcfff",
      underline: true,
    },
  },
  {
    scope: ["markup.link.url"],
    style: {
      foreground: "#7aa2f7",
      underline: true,
    },
  },
  {
    scope: ["label"],
    style: {
      foreground: "#73daca",
    },
  },
  {
    scope: ["spell", "nospell"],
    style: {
      foreground: "#e6edf3",
    },
  },
  {
    scope: ["conceal"],
    style: {
      foreground: "#565f89",
    },
  },
  // Additional common highlight groups
  {
    scope: ["string.special", "string.special.url"],
    style: {
      foreground: "#73daca",
      underline: true,
    },
  },
  {
    scope: ["character"],
    style: {
      foreground: "#9ece6a",
    },
  },
  {
    scope: ["float"],
    style: {
      foreground: "#ff9e64",
    },
  },
  {
    scope: ["comment.error"],
    style: {
      foreground: "#f7768e",
      italic: true,
      bold: true,
    },
  },
  {
    scope: ["comment.warning"],
    style: {
      foreground: "#e0af68",
      italic: true,
      bold: true,
    },
  },
  {
    scope: ["comment.todo", "comment.note"],
    style: {
      foreground: "#7aa2f7",
      italic: true,
      bold: true,
    },
  },
  {
    scope: ["namespace"],
    style: {
      foreground: "#2ac3de",
    },
  },
  {
    scope: ["field"],
    style: {
      foreground: "#73daca",
    },
  },
  {
    scope: ["type.definition"],
    style: {
      foreground: "#2ac3de",
      bold: true,
    },
  },
  {
    scope: ["keyword.export"],
    style: {
      foreground: "#bb9af7",
    },
  },
  {
    scope: ["attribute", "annotation"],
    style: {
      foreground: "#e0af68",
    },
  },
  {
    scope: ["tag"],
    style: {
      foreground: "#f7768e",
    },
  },
  {
    scope: ["tag.attribute"],
    style: {
      foreground: "#bb9af7",
    },
  },
  {
    scope: ["tag.delimiter"],
    style: {
      foreground: "#89ddff",
    },
  },
  {
    scope: ["markup.strikethrough"],
    style: {
      foreground: "#565f89",
    },
  },
  {
    scope: ["markup.underline"],
    style: {
      foreground: "#e6edf3",
      underline: true,
    },
  },
  {
    scope: ["markup.list.checked"],
    style: {
      foreground: "#9ece6a",
    },
  },
  {
    scope: ["markup.list.unchecked"],
    style: {
      foreground: "#565f89",
    },
  },
  {
    scope: ["diff.plus"],
    style: {
      foreground: "#9ece6a",
    },
  },
  {
    scope: ["diff.minus"],
    style: {
      foreground: "#f7768e",
    },
  },
  {
    scope: ["diff.delta"],
    style: {
      foreground: "#7dcfff",
    },
  },
  {
    scope: ["error"],
    style: {
      foreground: "#f7768e",
      bold: true,
    },
  },
  {
    scope: ["warning"],
    style: {
      foreground: "#e0af68",
      bold: true,
    },
  },
  {
    scope: ["info"],
    style: {
      foreground: "#7dcfff",
    },
  },
  {
    scope: ["debug"],
    style: {
      foreground: "#565f89",
    },
  },
]

export const SyntaxTheme = SyntaxStyle.fromTheme(syntaxThemeDark)

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: () => {
    const sync = useSync()
    const kv = useKV()

    const [theme, setTheme] = createSignal(sync.data.config.theme ?? kv.data.theme)

    const values = createMemo(() => {
      return THEMES[theme()] ?? THEMES.opencode
    })

    return {
      theme: new Proxy(values(), {
        get(_target, prop) {
          // @ts-expect-error
          return values()[prop]
        },
      }),
      get selectedTheme() {
        return kv.data.theme
      },
      setSelectedTheme(theme: string) {
        setTheme(theme)
        kv.set("theme", theme)
      },
      get ready() {
        return sync.ready
      },
    }
  },
})
