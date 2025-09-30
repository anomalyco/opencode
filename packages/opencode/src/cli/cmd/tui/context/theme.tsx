import { SyntaxStyle } from "@opentui/core"

const OPENCODE_THEME = {
  primary: {
    dark: "#fab283",
    light: "#3b7dd8",
  },
  secondary: {
    dark: "#5c9cf5",
    light: "#7b5bb6",
  },
  accent: {
    dark: "#9d7cd8",
    light: "#d68c27",
  },
  error: {
    dark: "#e06c75",
    light: "#d1383d",
  },
  warning: {
    dark: "#f5a742",
    light: "#d68c27",
  },
  success: {
    dark: "#7fd88f",
    light: "#3d9a57",
  },
  info: {
    dark: "#56b6c2",
    light: "#318795",
  },
  text: {
    dark: "#eeeeee",
    light: "#1a1a1a",
  },
  textMuted: {
    dark: "#808080",
    light: "#8a8a8a",
  },
  background: {
    dark: "#0a0a0a",
    light: "#ffffff",
  },
  backgroundPanel: {
    dark: "#141414",
    light: "#fafafa",
  },
  backgroundElement: {
    dark: "#1e1e1e",
    light: "#f5f5f5",
  },
  border: {
    dark: "#484848",
    light: "#b8b8b8",
  },
  borderActive: {
    dark: "#606060",
    light: "#a0a0a0",
  },
  borderSubtle: {
    dark: "#3c3c3c",
    light: "#d4d4d4",
  },
  diffAdded: {
    dark: "#4fd6be",
    light: "#1e725c",
  },
  diffRemoved: {
    dark: "#c53b53",
    light: "#c53b53",
  },
  diffContext: {
    dark: "#828bb8",
    light: "#7086b5",
  },
  diffHunkHeader: {
    dark: "#828bb8",
    light: "#7086b5",
  },
  diffHighlightAdded: {
    dark: "#b8db87",
    light: "#4db380",
  },
  diffHighlightRemoved: {
    dark: "#e26a75",
    light: "#f52a65",
  },
  diffAddedBg: {
    dark: "#20303b",
    light: "#d5e5d5",
  },
  diffRemovedBg: {
    dark: "#37222c",
    light: "#f7d8db",
  },
  diffContextBg: {
    dark: "#141414",
    light: "#fafafa",
  },
  diffLineNumber: {
    dark: "#1e1e1e",
    light: "#f5f5f5",
  },
  diffAddedLineNumberBg: {
    dark: "#1b2b34",
    light: "#c5d5c5",
  },
  diffRemovedLineNumberBg: {
    dark: "#2d1f26",
    light: "#e7c8cb",
  },
  markdownText: {
    dark: "#eeeeee",
    light: "#1a1a1a",
  },
  markdownHeading: {
    dark: "#9d7cd8",
    light: "#d68c27",
  },
  markdownLink: {
    dark: "#fab283",
    light: "#3b7dd8",
  },
  markdownLinkText: {
    dark: "#56b6c2",
    light: "#318795",
  },
  markdownCode: {
    dark: "#7fd88f",
    light: "#3d9a57",
  },
  markdownBlockQuote: {
    dark: "#e5c07b",
    light: "#b0851f",
  },
  markdownEmph: {
    dark: "#e5c07b",
    light: "#b0851f",
  },
  markdownStrong: {
    dark: "#f5a742",
    light: "#d68c27",
  },
  markdownHorizontalRule: {
    dark: "#808080",
    light: "#8a8a8a",
  },
  markdownListItem: {
    dark: "#fab283",
    light: "#3b7dd8",
  },
  markdownListEnumeration: {
    dark: "#56b6c2",
    light: "#318795",
  },
  markdownImage: {
    dark: "#fab283",
    light: "#3b7dd8",
  },
  markdownImageText: {
    dark: "#56b6c2",
    light: "#318795",
  },
  markdownCodeBlock: {
    dark: "#eeeeee",
    light: "#1a1a1a",
  },
  syntaxComment: {
    dark: "#808080",
    light: "#8a8a8a",
  },
  syntaxKeyword: {
    dark: "#9d7cd8",
    light: "#d68c27",
  },
  syntaxFunction: {
    dark: "#fab283",
    light: "#3b7dd8",
  },
  syntaxVariable: {
    dark: "#e06c75",
    light: "#d1383d",
  },
  syntaxString: {
    dark: "#7fd88f",
    light: "#3d9a57",
  },
  syntaxNumber: {
    dark: "#f5a742",
    light: "#d68c27",
  },
  syntaxType: {
    dark: "#e5c07b",
    light: "#b0851f",
  },
  syntaxOperator: {
    dark: "#56b6c2",
    light: "#318795",
  },
  syntaxPunctuation: {
    dark: "#eeeeee",
    light: "#1a1a1a",
  },
} as const

type Theme = {
  primary: string
  secondary: string
  accent: string
  error: string
  warning: string
  success: string
  info: string
  text: string
  textMuted: string
  background: string
  backgroundPanel: string
  backgroundElement: string
  border: string
  borderActive: string
  borderSubtle: string
  diffAdded: string
  diffRemoved: string
  diffContext: string
  diffHunkHeader: string
  diffHighlightAdded: string
  diffHighlightRemoved: string
  diffAddedBg: string
  diffRemovedBg: string
  diffContextBg: string
  diffLineNumber: string
  diffAddedLineNumberBg: string
  diffRemovedLineNumberBg: string
  markdownText: string
  markdownHeading: {}
  markdownLink: string
  markdownLinkText: string
  markdownCode: string
  markdownBlockQuote: string
  markdownEmph: string
  markdownStrong: string
  markdownHorizontalRule: string
  markdownListItem: string
  markdownListEnumeration: {}
  markdownImage: string
  markdownImageText: string
  markdownCodeBlock: string
}

export const Theme = Object.entries(OPENCODE_THEME).reduce((acc, [key, value]) => {
  acc[key as keyof Theme] = value.dark
  return acc
}, {} as Theme)

const syntaxThemeDark = [
  {
    scope: ["prompt"],
    style: {
      foreground: "#56b6c2",
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

export const syntaxTheme = SyntaxStyle.fromTheme(syntaxThemeDark)
