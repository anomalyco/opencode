import { SyntaxStyle, RGBA, type TerminalColors } from "@opentui/core"
import path from "path"
import { createEffect, createMemo, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { createSimpleContext } from "./helper"
import aura from "./theme/aura.json" with { type: "json" }
import ayu from "./theme/ayu.json" with { type: "json" }
import catppuccin from "./theme/catppuccin.json" with { type: "json" }
import cobalt2 from "./theme/cobalt2.json" with { type: "json" }
import dracula from "./theme/dracula.json" with { type: "json" }
import everforest from "./theme/everforest.json" with { type: "json" }
import flexoki from "./theme/flexoki.json" with { type: "json" }
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
import { useRenderer } from "@opentui/solid"
import { createStore, produce } from "solid-js/store"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"

type ThemeColors = {
  primary: RGBA
  secondary: RGBA
  accent: RGBA
  error: RGBA
  warning: RGBA
  success: RGBA
  info: RGBA
  text: RGBA
  textMuted: RGBA
  selectedListItemText: RGBA
  background: RGBA
  backgroundPanel: RGBA
  backgroundElement: RGBA
  backgroundMenu: RGBA
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

type Theme = ThemeColors & {
  _hasSelectedListItemText: boolean
}

export function selectedForeground(theme: Theme): RGBA {
  // If theme explicitly defines selectedListItemText, use it
  if (theme._hasSelectedListItemText) {
    return theme.selectedListItemText
  }

  // For transparent backgrounds, calculate contrast based on primary color
  if (theme.background.a === 0) {
    const { r, g, b } = theme.primary
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b
    return luminance > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
  }

  // Fall back to background color
  return theme.background
}

type HexColor = `#${string}`
type RefName = string
type Variant = {
  dark: HexColor | RefName
  light: HexColor | RefName
}
type ColorValue = HexColor | RefName | Variant | RGBA
type ThemeJson = {
  $schema?: string
  defs?: Record<string, HexColor | RefName>
  theme: Omit<Record<keyof ThemeColors, ColorValue>, "selectedListItemText" | "backgroundMenu"> & {
    selectedListItemText?: ColorValue
    backgroundMenu?: ColorValue
  }
}

export const DEFAULT_THEMES: Record<string, ThemeJson> = {
  aura,
  ayu,
  catppuccin,
  cobalt2,
  dracula,
  everforest,
  flexoki,
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
    if (c instanceof RGBA) return c
    if (typeof c === "string") {
      if (c === "transparent" || c === "none") return RGBA.fromInts(0, 0, 0, 0)

      if (c.startsWith("#")) return RGBA.fromHex(c)

      if (defs[c]) {
        return resolveColor(defs[c])
      } else if (theme.theme[c as keyof ThemeColors] !== undefined) {
        return resolveColor(theme.theme[c as keyof ThemeColors]!)
      } else {
        throw new Error(`Color reference "${c}" not found in defs or theme`)
      }
    }
    return resolveColor(c[mode])
  }

  const resolved = Object.fromEntries(
    Object.entries(theme.theme)
      .filter(([key]) => key !== "selectedListItemText" && key !== "backgroundMenu")
      .map(([key, value]) => {
        return [key, resolveColor(value)]
      }),
  ) as Partial<ThemeColors>

  // Handle selectedListItemText separately since it's optional
  const hasSelectedListItemText = theme.theme.selectedListItemText !== undefined
  if (hasSelectedListItemText) {
    resolved.selectedListItemText = resolveColor(theme.theme.selectedListItemText!)
  } else {
    // Backward compatibility: if selectedListItemText is not defined, use background color
    // This preserves the current behavior for all existing themes
    resolved.selectedListItemText = resolved.background
  }

  // Handle backgroundMenu - optional with fallback to backgroundElement
  if (theme.theme.backgroundMenu !== undefined) {
    resolved.backgroundMenu = resolveColor(theme.theme.backgroundMenu)
  } else {
    resolved.backgroundMenu = resolved.backgroundElement
  }

  return {
    ...resolved,
    _hasSelectedListItemText: hasSelectedListItemText,
  } as Theme
}

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: (props: { mode: "dark" | "light" }) => {
    const sync = useSync()
    const kv = useKV()
    const [store, setStore] = createStore({
      themes: DEFAULT_THEMES,
      mode: kv.get("theme_mode", props.mode),
      active: (sync.data.config.theme ?? kv.get("theme", "opencode")) as string,
      ready: false,
    })

    createEffect(async () => {
      const custom = await getCustomThemes()
      setStore(
        produce((draft) => {
          Object.assign(draft.themes, custom)
          draft.ready = true
        }),
      )
    })

    const renderer = useRenderer()
    renderer
      .getPalette({
        size: 16,
      })
      .then((colors) => {
        if (!colors.palette[0]) return
        setStore("themes", "system", generateSystem(colors, store.mode))
      })

    const values = createMemo(() => {
      return resolveTheme(store.themes[store.active] ?? store.themes.opencode, store.mode)
    })

    const syntax = createMemo(() => generateSyntax(values()))
    const subtleSyntax = createMemo(() => generateSubtleSyntax(values()))

    return {
      theme: new Proxy(values(), {
        get(_target, prop) {
          // @ts-expect-error
          return values()[prop]
        },
      }),
      get selected() {
        return store.active
      },
      all() {
        return store.themes
      },
      syntax,
      subtleSyntax,
      mode() {
        return store.mode
      },
      setMode(mode: "dark" | "light") {
        setStore("mode", mode)
        kv.set("theme_mode", mode)
      },
      set(theme: string) {
        setStore("active", theme)
        kv.set("theme", theme)
      },
      get ready() {
        return store.ready
      },
    }
  },
})

const CUSTOM_THEME_GLOB = new Bun.Glob("themes/*.json")
async function getCustomThemes() {
  const directories = [
    Global.Path.config,
    ...(await Array.fromAsync(
      Filesystem.up({
        targets: [".opencode"],
        start: process.cwd(),
      }),
    )),
  ]

  const result: Record<string, ThemeJson> = {}
  for (const dir of directories) {
    for await (const item of CUSTOM_THEME_GLOB.scan({
      absolute: true,
      followSymlinks: true,
      dot: true,
      cwd: dir,
    })) {
      const name = path.basename(item, ".json")
      result[name] = await Bun.file(item).json()
    }
  }
  return result
}

function generateSystem(colors: TerminalColors, mode: "dark" | "light"): ThemeJson {
  const bg = RGBA.fromHex(colors.defaultBackground ?? colors.palette[0]!)
  const fg = RGBA.fromHex(colors.defaultForeground ?? colors.palette[7]!)
  const palette = colors.palette.filter((x) => x !== null).map((x) => RGBA.fromHex(x))
  const isDark = mode == "dark"

  // Generate gray scale based on terminal background
  const grays = generateGrayScale(bg, isDark)
  const textMuted = generateMutedTextColor(bg, isDark)

  // ANSI color references
  const ansiColors = {
    black: palette[0],
    red: palette[1],
    green: palette[2],
    yellow: palette[3],
    blue: palette[4],
    magenta: palette[5],
    cyan: palette[6],
    white: palette[7],
  }

  return {
    theme: {
      // Primary colors using ANSI
      primary: ansiColors.cyan,
      secondary: ansiColors.magenta,
      accent: ansiColors.cyan,

      // Status colors using ANSI
      error: ansiColors.red,
      warning: ansiColors.yellow,
      success: ansiColors.green,
      info: ansiColors.cyan,

      // Text colors
      text: fg,
      textMuted,
      selectedListItemText: bg,

      // Background colors
      background: bg,
      backgroundPanel: grays[2],
      backgroundElement: grays[3],
      backgroundMenu: grays[3],

      // Border colors
      borderSubtle: grays[6],
      border: grays[7],
      borderActive: grays[8],

      // Diff colors
      diffAdded: ansiColors.green,
      diffRemoved: ansiColors.red,
      diffContext: grays[7],
      diffHunkHeader: grays[7],
      diffHighlightAdded: ansiColors.green,
      diffHighlightRemoved: ansiColors.red,
      diffAddedBg: grays[2],
      diffRemovedBg: grays[2],
      diffContextBg: grays[1],
      diffLineNumber: grays[6],
      diffAddedLineNumberBg: grays[3],
      diffRemovedLineNumberBg: grays[3],

      // Markdown colors
      markdownText: fg,
      markdownHeading: fg,
      markdownLink: ansiColors.blue,
      markdownLinkText: ansiColors.cyan,
      markdownCode: ansiColors.green,
      markdownBlockQuote: ansiColors.yellow,
      markdownEmph: ansiColors.yellow,
      markdownStrong: fg,
      markdownHorizontalRule: grays[7],
      markdownListItem: ansiColors.blue,
      markdownListEnumeration: ansiColors.cyan,
      markdownImage: ansiColors.blue,
      markdownImageText: ansiColors.cyan,
      markdownCodeBlock: fg,

      // Syntax colors
      syntaxComment: textMuted,
      syntaxKeyword: ansiColors.magenta,
      syntaxFunction: ansiColors.blue,
      syntaxVariable: fg,
      syntaxString: ansiColors.green,
      syntaxNumber: ansiColors.yellow,
      syntaxType: ansiColors.cyan,
      syntaxOperator: ansiColors.cyan,
      syntaxPunctuation: fg,
    },
  }
}

function generateGrayScale(bg: RGBA, isDark: boolean): Record<number, RGBA> {
  const grays: Record<number, RGBA> = {}

  // RGBA stores floats in range 0-1, convert to 0-255
  const bgR = bg.r * 255
  const bgG = bg.g * 255
  const bgB = bg.b * 255

  const luminance = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB

  for (let i = 1; i <= 12; i++) {
    const factor = i / 12.0

    let grayValue: number
    let newR: number
    let newG: number
    let newB: number

    if (isDark) {
      if (luminance < 10) {
        grayValue = Math.floor(factor * 0.4 * 255)
        newR = grayValue
        newG = grayValue
        newB = grayValue
      } else {
        const newLum = luminance + (255 - luminance) * factor * 0.4

        const ratio = newLum / luminance
        newR = Math.min(bgR * ratio, 255)
        newG = Math.min(bgG * ratio, 255)
        newB = Math.min(bgB * ratio, 255)
      }
    } else {
      if (luminance > 245) {
        grayValue = Math.floor(255 - factor * 0.4 * 255)
        newR = grayValue
        newG = grayValue
        newB = grayValue
      } else {
        const newLum = luminance * (1 - factor * 0.4)

        const ratio = newLum / luminance
        newR = Math.max(bgR * ratio, 0)
        newG = Math.max(bgG * ratio, 0)
        newB = Math.max(bgB * ratio, 0)
      }
    }

    grays[i] = RGBA.fromInts(Math.floor(newR), Math.floor(newG), Math.floor(newB))
  }

  return grays
}

function generateMutedTextColor(bg: RGBA, isDark: boolean): RGBA {
  // RGBA stores floats in range 0-1, convert to 0-255
  const bgR = bg.r * 255
  const bgG = bg.g * 255
  const bgB = bg.b * 255

  const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB

  let grayValue: number

  if (isDark) {
    if (bgLum < 10) {
      // Very dark/black background
      grayValue = 180 // #b4b4b4
    } else {
      // Scale up for lighter dark backgrounds
      grayValue = Math.min(Math.floor(160 + bgLum * 0.3), 200)
    }
  } else {
    if (bgLum > 245) {
      // Very light/white background
      grayValue = 75 // #4b4b4b
    } else {
      // Scale down for darker light backgrounds
      grayValue = Math.max(Math.floor(100 - (255 - bgLum) * 0.2), 60)
    }
  }

  return RGBA.fromInts(grayValue, grayValue, grayValue)
}

function generateSyntax(theme: Theme) {
  return SyntaxStyle.fromTheme(getSyntaxRules(theme))
}

function generateSubtleSyntax(theme: Theme) {
  const rules = getSyntaxRules(theme)
  return SyntaxStyle.fromTheme(
    rules.map((rule) => {
      if (rule.style.foreground) {
        const fg = rule.style.foreground
        return {
          ...rule,
          style: {
            ...rule.style,
            foreground: RGBA.fromInts(
              Math.round(fg.r * 255),
              Math.round(fg.g * 255),
              Math.round(fg.b * 255),
              Math.round(0.6 * 255),
            ),
          },
        }
      }
      return rule
    }),
  )
}

function getSyntaxRules(theme: Theme) {
  return [
    {
      scope: ["prompt"],
      style: {
        foreground: theme.accent,
      },
    },
    {
      scope: ["extmark.file"],
      style: {
        foreground: theme.warning,
        bold: true,
      },
    },
    {
      scope: ["extmark.agent"],
      style: {
        foreground: theme.secondary,
        bold: true,
      },
    },
    {
      scope: ["extmark.paste"],
      style: {
        foreground: theme.background,
        background: theme.warning,
        bold: true,
      },
    },
    {
      scope: ["comment"],
      style: {
        foreground: theme.syntaxComment,
        italic: true,
      },
    },
    {
      scope: ["comment.documentation"],
      style: {
        foreground: theme.syntaxComment,
        italic: true,
      },
    },
    {
      scope: ["string", "symbol"],
      style: {
        foreground: theme.syntaxString,
      },
    },
    {
      scope: ["number", "boolean"],
      style: {
        foreground: theme.syntaxNumber,
      },
    },
    {
      scope: ["character.special"],
      style: {
        foreground: theme.syntaxString,
      },
    },
    {
      scope: ["keyword.return", "keyword.conditional", "keyword.repeat", "keyword.coroutine"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["keyword.type"],
      style: {
        foreground: theme.syntaxType,
        bold: true,
        italic: true,
      },
    },
    {
      scope: ["keyword.function", "function.method"],
      style: {
        foreground: theme.syntaxFunction,
      },
    },
    {
      scope: ["keyword"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["keyword.import"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["operator", "keyword.operator", "punctuation.delimiter"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["keyword.conditional.ternary"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["variable", "variable.parameter", "function.method.call", "function.call"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["variable.member", "function", "constructor"],
      style: {
        foreground: theme.syntaxFunction,
      },
    },
    {
      scope: ["type", "module"],
      style: {
        foreground: theme.syntaxType,
      },
    },
    {
      scope: ["constant"],
      style: {
        foreground: theme.syntaxNumber,
      },
    },
    {
      scope: ["property"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["class"],
      style: {
        foreground: theme.syntaxType,
      },
    },
    {
      scope: ["parameter"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["punctuation", "punctuation.bracket"],
      style: {
        foreground: theme.syntaxPunctuation,
      },
    },
    {
      scope: ["variable.builtin", "type.builtin", "function.builtin", "module.builtin", "constant.builtin"],
      style: {
        foreground: theme.error,
      },
    },
    {
      scope: ["variable.super"],
      style: {
        foreground: theme.error,
      },
    },
    {
      scope: ["string.escape", "string.regexp"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["keyword.directive"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["punctuation.special"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["keyword.modifier"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["keyword.exception"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    // Markdown specific styles
    {
      scope: ["markup.heading"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.1"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.2"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.3"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.4"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.5"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.6"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.bold", "markup.strong"],
      style: {
        foreground: theme.markdownStrong,
        bold: true,
      },
    },
    {
      scope: ["markup.italic"],
      style: {
        foreground: theme.markdownEmph,
        italic: true,
      },
    },
    {
      scope: ["markup.list"],
      style: {
        foreground: theme.markdownListItem,
      },
    },
    {
      scope: ["markup.quote"],
      style: {
        foreground: theme.markdownBlockQuote,
        italic: true,
      },
    },
    {
      scope: ["markup.raw", "markup.raw.block"],
      style: {
        foreground: theme.markdownCode,
      },
    },
    {
      scope: ["markup.raw.inline"],
      style: {
        foreground: theme.markdownCode,
        background: theme.background,
      },
    },
    {
      scope: ["markup.link"],
      style: {
        foreground: theme.markdownLink,
        underline: true,
      },
    },
    {
      scope: ["markup.link.label"],
      style: {
        foreground: theme.markdownLinkText,
        underline: true,
      },
    },
    {
      scope: ["markup.link.url"],
      style: {
        foreground: theme.markdownLink,
        underline: true,
      },
    },
    {
      scope: ["label"],
      style: {
        foreground: theme.markdownLinkText,
      },
    },
    {
      scope: ["spell", "nospell"],
      style: {
        foreground: theme.text,
      },
    },
    {
      scope: ["conceal"],
      style: {
        foreground: theme.textMuted,
      },
    },
    // Additional common highlight groups
    {
      scope: ["string.special", "string.special.url"],
      style: {
        foreground: theme.markdownLink,
        underline: true,
      },
    },
    {
      scope: ["character"],
      style: {
        foreground: theme.syntaxString,
      },
    },
    {
      scope: ["float"],
      style: {
        foreground: theme.syntaxNumber,
      },
    },
    {
      scope: ["comment.error"],
      style: {
        foreground: theme.error,
        italic: true,
        bold: true,
      },
    },
    {
      scope: ["comment.warning"],
      style: {
        foreground: theme.warning,
        italic: true,
        bold: true,
      },
    },
    {
      scope: ["comment.todo", "comment.note"],
      style: {
        foreground: theme.info,
        italic: true,
        bold: true,
      },
    },
    {
      scope: ["namespace"],
      style: {
        foreground: theme.syntaxType,
      },
    },
    {
      scope: ["field"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["type.definition"],
      style: {
        foreground: theme.syntaxType,
        bold: true,
      },
    },
    {
      scope: ["keyword.export"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["attribute", "annotation"],
      style: {
        foreground: theme.warning,
      },
    },
    {
      scope: ["tag"],
      style: {
        foreground: theme.error,
      },
    },
    {
      scope: ["tag.attribute"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["tag.delimiter"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["markup.strikethrough"],
      style: {
        foreground: theme.textMuted,
      },
    },
    {
      scope: ["markup.underline"],
      style: {
        foreground: theme.text,
        underline: true,
      },
    },
    {
      scope: ["markup.list.checked"],
      style: {
        foreground: theme.success,
      },
    },
    {
      scope: ["markup.list.unchecked"],
      style: {
        foreground: theme.textMuted,
      },
    },
    {
      scope: ["diff.plus"],
      style: {
        foreground: theme.diffAdded,
        background: theme.diffAddedBg,
      },
    },
    {
      scope: ["diff.minus"],
      style: {
        foreground: theme.diffRemoved,
        background: theme.diffRemovedBg,
      },
    },
    {
      scope: ["diff.delta"],
      style: {
        foreground: theme.diffContext,
        background: theme.diffContextBg,
      },
    },
    {
      scope: ["error"],
      style: {
        foreground: theme.error,
        bold: true,
      },
    },
    {
      scope: ["warning"],
      style: {
        foreground: theme.warning,
        bold: true,
      },
    },
    {
      scope: ["info"],
      style: {
        foreground: theme.info,
      },
    },
    {
      scope: ["debug"],
      style: {
        foreground: theme.textMuted,
      },
    },
  ]
}
