import { SyntaxStyle, RGBA } from "@opentui/core"
import { createMemo, createSignal } from "solid-js"
import { useSync } from "@tui/context/sync"
import { createSimpleContext } from "./helper"
import aura from "./theme/aura.json" with { type: "json" }
import ayu from "./theme/ayu.json" with { type: "json" }
import catppuccin from "./theme/catppuccin.json" with { type: "json" }
import cobalt2 from "./theme/cobalt2.json" with { type: "json" }
import dracula from "./theme/dracula.json" with { type: "json" }
import everforest from "./theme/everforest.json" with { type: "json" }
import github from "./theme/github.json" with { type: "json" }
import gruvbox from "./theme/gruvbox.json" with { type: "json" }
import kanagawa from "./theme/kanagawa.json" with { type: "json" }
import material from "./theme/material.json" with { type: "json" }
import matrix from "./theme/matrix.json" with { type: "json" }
import monokai from "./theme/monokai.json" with { type: "json" }
import nightowl from "./theme/nightowl.json" with { type: "json" }
import nord from "./theme/nord.json" with { type: "json" }
import onedark from "./theme/one-dark.json" with { type: "json" }
import opencode from "./theme/opencode.json" with { type: "json" }
import palenight from "./theme/palenight.json" with { type: "json" }
import rosepine from "./theme/rosepine.json" with { type: "json" }
import solarized from "./theme/solarized.json" with { type: "json" }
import synthwave84 from "./theme/synthwave84.json" with { type: "json" }
import tokyonight from "./theme/tokyonight.json" with { type: "json" }
import vesper from "./theme/vesper.json" with { type: "json" }
import zenburn from "./theme/zenburn.json" with { type: "json" }
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
  syntaxComment: RGBA
  syntaxKeyword: RGBA
  syntaxFunction: RGBA
  syntaxVariable: RGBA
  syntaxString: RGBA
  syntaxNumber: RGBA
  syntaxType: RGBA
  syntaxOperator: RGBA
  syntaxPunctuation: RGBA
}

type HexColor = `#${string}`
type RefName = string
type Variant = {
  dark: HexColor | RefName
  light: HexColor | RefName
}
type ColorValue = HexColor | RefName | Variant
type ThemeJson = {
  $schema?: string
  defs?: Record<string, HexColor | RefName>
  theme: Record<keyof Theme, ColorValue>
}

export const THEMES: Record<string, ThemeJson> = {
  aura,
  ayu,
  catppuccin,
  cobalt2,
  dracula,
  everforest,
  github,
  gruvbox,
  kanagawa,
  material,
  matrix,
  monokai,
  nightowl,
  nord,
  ["one-dark"]: onedark,
  opencode,
  palenight,
  rosepine,
  solarized,
  synthwave84,
  tokyonight,
  vesper,
  zenburn,
}

function resolveTheme(theme: ThemeJson, mode: "dark" | "light") {
  const defs = theme.defs ?? {}
  function resolveColor(c: ColorValue): RGBA {
    if (typeof c === "string") return c.startsWith("#") ? RGBA.fromHex(c) : resolveColor(defs[c])
    return resolveColor(c[mode])
  }
  return Object.fromEntries(
    Object.entries(theme.theme).map(([key, value]) => {
      return [key, resolveColor(value)]
    }),
  ) as Theme
}

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: (props: { mode: "dark" | "light" }) => {
    const sync = useSync()
    const kv = useKV()

    const [theme, setTheme] = createSignal(sync.data.config.theme ?? kv.get("theme", "opencode"))
    const [mode, setMode] = createSignal(props.mode)

    const values = createMemo(() => {
      return resolveTheme(THEMES[theme()] ?? THEMES.opencode, mode())
    })

    const syntax = createMemo(() => {
      return SyntaxStyle.fromTheme([
        {
          scope: ["prompt"],
          style: {
            foreground: values().accent,
          },
        },
        {
          scope: ["extmark.file"],
          style: {
            foreground: values().warning,
            bold: true,
          },
        },
        {
          scope: ["extmark.agent"],
          style: {
            foreground: values().secondary,
            bold: true,
          },
        },
        {
          scope: ["extmark.paste"],
          style: {
            foreground: values().background,
            background: values().warning,
            bold: true,
          },
        },
        {
          scope: ["comment"],
          style: {
            foreground: values().syntaxComment,
            italic: true,
          },
        },
        {
          scope: ["comment.documentation"],
          style: {
            foreground: values().syntaxComment,
            italic: true,
          },
        },
        {
          scope: ["string", "symbol"],
          style: {
            foreground: values().syntaxString,
          },
        },
        {
          scope: ["number", "boolean"],
          style: {
            foreground: values().syntaxNumber,
          },
        },
        {
          scope: ["character.special"],
          style: {
            foreground: values().syntaxString,
          },
        },
        {
          scope: ["keyword.return", "keyword.conditional", "keyword.repeat", "keyword.coroutine"],
          style: {
            foreground: values().syntaxKeyword,
            italic: true,
          },
        },
        {
          scope: ["keyword.type"],
          style: {
            foreground: values().syntaxType,
            bold: true,
            italic: true,
          },
        },
        {
          scope: ["keyword.function", "function.method"],
          style: {
            foreground: values().syntaxFunction,
          },
        },
        {
          scope: ["keyword"],
          style: {
            foreground: values().syntaxKeyword,
            italic: true,
          },
        },
        {
          scope: ["keyword.import"],
          style: {
            foreground: values().syntaxKeyword,
          },
        },
        {
          scope: ["operator", "keyword.operator", "punctuation.delimiter"],
          style: {
            foreground: values().syntaxOperator,
          },
        },
        {
          scope: ["keyword.conditional.ternary"],
          style: {
            foreground: values().syntaxOperator,
          },
        },
        {
          scope: ["variable", "variable.parameter", "function.method.call", "function.call"],
          style: {
            foreground: values().syntaxVariable,
          },
        },
        {
          scope: ["variable.member", "function", "constructor"],
          style: {
            foreground: values().syntaxFunction,
          },
        },
        {
          scope: ["type", "module"],
          style: {
            foreground: values().syntaxType,
          },
        },
        {
          scope: ["constant"],
          style: {
            foreground: values().syntaxNumber,
          },
        },
        {
          scope: ["property"],
          style: {
            foreground: values().syntaxVariable,
          },
        },
        {
          scope: ["class"],
          style: {
            foreground: values().syntaxType,
          },
        },
        {
          scope: ["parameter"],
          style: {
            foreground: values().syntaxVariable,
          },
        },
        {
          scope: ["punctuation", "punctuation.bracket"],
          style: {
            foreground: values().syntaxPunctuation,
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
            foreground: values().error,
          },
        },
        {
          scope: ["variable.super"],
          style: {
            foreground: values().error,
          },
        },
        {
          scope: ["string.escape", "string.regexp"],
          style: {
            foreground: values().syntaxKeyword,
          },
        },
        {
          scope: ["keyword.directive"],
          style: {
            foreground: values().syntaxKeyword,
            italic: true,
          },
        },
        {
          scope: ["punctuation.special"],
          style: {
            foreground: values().syntaxOperator,
          },
        },
        {
          scope: ["keyword.modifier"],
          style: {
            foreground: values().syntaxKeyword,
            italic: true,
          },
        },
        {
          scope: ["keyword.exception"],
          style: {
            foreground: values().syntaxKeyword,
            italic: true,
          },
        },
        // Markdown specific styles
        {
          scope: ["markup.heading"],
          style: {
            foreground: values().markdownHeading,
            bold: true,
          },
        },
        {
          scope: ["markup.heading.1"],
          style: {
            foreground: values().markdownHeading,
            bold: true,
          },
        },
        {
          scope: ["markup.heading.2"],
          style: {
            foreground: values().markdownHeading,
            bold: true,
          },
        },
        {
          scope: ["markup.heading.3"],
          style: {
            foreground: values().markdownHeading,
            bold: true,
          },
        },
        {
          scope: ["markup.heading.4"],
          style: {
            foreground: values().markdownHeading,
            bold: true,
          },
        },
        {
          scope: ["markup.heading.5"],
          style: {
            foreground: values().markdownHeading,
            bold: true,
          },
        },
        {
          scope: ["markup.heading.6"],
          style: {
            foreground: values().markdownHeading,
            bold: true,
          },
        },
        {
          scope: ["markup.bold", "markup.strong"],
          style: {
            foreground: values().markdownStrong,
            bold: true,
          },
        },
        {
          scope: ["markup.italic"],
          style: {
            foreground: values().markdownEmph,
            italic: true,
          },
        },
        {
          scope: ["markup.list"],
          style: {
            foreground: values().markdownListItem,
          },
        },
        {
          scope: ["markup.quote"],
          style: {
            foreground: values().markdownBlockQuote,
            italic: true,
          },
        },
        {
          scope: ["markup.raw", "markup.raw.block"],
          style: {
            foreground: values().markdownCode,
          },
        },
        {
          scope: ["markup.raw.inline"],
          style: {
            foreground: values().markdownCode,
            background: values().background,
          },
        },
        {
          scope: ["markup.link"],
          style: {
            foreground: values().markdownLink,
            underline: true,
          },
        },
        {
          scope: ["markup.link.label"],
          style: {
            foreground: values().markdownLinkText,
            underline: true,
          },
        },
        {
          scope: ["markup.link.url"],
          style: {
            foreground: values().markdownLink,
            underline: true,
          },
        },
        {
          scope: ["label"],
          style: {
            foreground: values().markdownLinkText,
          },
        },
        {
          scope: ["spell", "nospell"],
          style: {
            foreground: values().text,
          },
        },
        {
          scope: ["conceal"],
          style: {
            foreground: values().textMuted,
          },
        },
        // Additional common highlight groups
        {
          scope: ["string.special", "string.special.url"],
          style: {
            foreground: values().markdownLink,
            underline: true,
          },
        },
        {
          scope: ["character"],
          style: {
            foreground: values().syntaxString,
          },
        },
        {
          scope: ["float"],
          style: {
            foreground: values().syntaxNumber,
          },
        },
        {
          scope: ["comment.error"],
          style: {
            foreground: values().error,
            italic: true,
            bold: true,
          },
        },
        {
          scope: ["comment.warning"],
          style: {
            foreground: values().warning,
            italic: true,
            bold: true,
          },
        },
        {
          scope: ["comment.todo", "comment.note"],
          style: {
            foreground: values().info,
            italic: true,
            bold: true,
          },
        },
        {
          scope: ["namespace"],
          style: {
            foreground: values().syntaxType,
          },
        },
        {
          scope: ["field"],
          style: {
            foreground: values().syntaxVariable,
          },
        },
        {
          scope: ["type.definition"],
          style: {
            foreground: values().syntaxType,
            bold: true,
          },
        },
        {
          scope: ["keyword.export"],
          style: {
            foreground: values().syntaxKeyword,
          },
        },
        {
          scope: ["attribute", "annotation"],
          style: {
            foreground: values().warning,
          },
        },
        {
          scope: ["tag"],
          style: {
            foreground: values().error,
          },
        },
        {
          scope: ["tag.attribute"],
          style: {
            foreground: values().syntaxKeyword,
          },
        },
        {
          scope: ["tag.delimiter"],
          style: {
            foreground: values().syntaxOperator,
          },
        },
        {
          scope: ["markup.strikethrough"],
          style: {
            foreground: values().textMuted,
          },
        },
        {
          scope: ["markup.underline"],
          style: {
            foreground: values().text,
            underline: true,
          },
        },
        {
          scope: ["markup.list.checked"],
          style: {
            foreground: values().success,
          },
        },
        {
          scope: ["markup.list.unchecked"],
          style: {
            foreground: values().textMuted,
          },
        },
        {
          scope: ["diff.plus"],
          style: {
            foreground: values().diffAdded,
          },
        },
        {
          scope: ["diff.minus"],
          style: {
            foreground: values().diffRemoved,
          },
        },
        {
          scope: ["diff.delta"],
          style: {
            foreground: values().diffContext,
          },
        },
        {
          scope: ["error"],
          style: {
            foreground: values().error,
            bold: true,
          },
        },
        {
          scope: ["warning"],
          style: {
            foreground: values().warning,
            bold: true,
          },
        },
        {
          scope: ["info"],
          style: {
            foreground: values().info,
          },
        },
        {
          scope: ["debug"],
          style: {
            foreground: values().textMuted,
          },
        },
      ])
    })

    return {
      theme: new Proxy(values(), {
        get(_target, prop) {
          // @ts-expect-error
          return values()[prop]
        },
      }),
      get selected() {
        return theme()
      },
      syntax,
      mode,
      setMode(mode: "dark" | "light") {
        setMode(mode)
      },
      set(theme: string) {
        if (!THEMES[theme]) return
        setTheme(theme)
        kv.set("theme", theme)
      },
      get ready() {
        return sync.ready
      },
    }
  },
})
