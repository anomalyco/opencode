/** @jsxImportSource react */

/** Theme tokens for Ink components. All color values are valid chalk color names. */
export const theme = {
  colors: {
    primary: "cyan",
    success: "green",
    warning: "yellow",
    error: "red",
    muted: "gray",
  },
  tool: {
    running: { icon: "yellow", text: "gray" },
    completed: { icon: "green", text: "gray" },
    error: { icon: "red", text: "gray" },
  },
  task: {
    running: { icon: "yellow", text: "cyan" },
    completed: { icon: "green", text: "cyan" },
  },
  prompt: {
    agent: "cyan",
    separator: "cyan",
    symbol: "❯",
  },
  status: {
    dimColor: true,
  },
} as const

/** Theme type for type checking consumers. */
export type Theme = typeof theme
