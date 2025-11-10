// Terminal grid types for character-based rendering

export interface TerminalCell {
  char: string
  fg: string // foreground color
  bg: string // background color
  bold: boolean
  italic: boolean
  underline: boolean
}

export interface TerminalDimensions {
  cols: number
  rows: number
}

export interface Position {
  col: number
  row: number
}

export interface Region {
  startCol: number
  startRow: number
  width: number
  height: number
}

// OpenCode TUI Theme - Darker theme matching actual TUI
export const Colors = {
  // Backgrounds
  BG_MAIN: "#0a0a0a", // Main editor background - very dark
  BG_PANEL: "#1a1a1a", // Sidebar background - slightly lighter
  BG_DARK: "#050505", // Darker elements
  BG_INPUT: "#2a2a2a", // Input fields
  BG_HOVER: "#1f1f1f", // Hover state

  // Borders
  BORDER: "#2a2a2a", // Main borders - subtle
  BORDER_LIGHT: "#3a3a3a", // Lighter borders

  // Text
  TEXT_MAIN: "#d4d4d4", // Primary text - brighter
  TEXT_MUTED: "#6a6a6a", // Secondary text
  TEXT_BRIGHT: "#ffffff", // Emphasis text - pure white
  TEXT_DIM: "#4a4a4a", // Dimmed text

  // Syntax highlighting (VS Code Dark+)
  SYNTAX_CYAN: "#4ec9b0", // Functions, methods
  SYNTAX_YELLOW: "#dcdcaa", // Variables, parameters
  SYNTAX_ORANGE: "#ce9178", // Strings
  SYNTAX_PURPLE: "#c586c0", // Keywords
  SYNTAX_BLUE: "#569cd6", // Types, classes
  SYNTAX_GREEN: "#6a9955", // Comments
  SYNTAX_RED: "#f48771", // Errors, warnings

  // UI accents
  ACCENT_CYAN: "#4ec9b0",
  ACCENT_YELLOW: "#dcdcaa",
  ACCENT_ORANGE: "#ce9178",
  ACCENT_PURPLE: "#c586c0",
  ACCENT_BLUE: "#569cd6",
  ACCENT_GREEN: "#6a9955",
  ACCENT_RED: "#f48771",

  // Status indicators
  STATUS_QUEUED: "#d4a233",
  STATUS_RUNNING: "#4ec9b0",
  STATUS_COMPLETED: "#4ec9b0",
  STATUS_ERROR: "#f48771",
  STATUS_CANCELLED: "#858585",

  // Interactive
  SELECTION: "#264f78",
  CURSOR: "#dcdcaa",
  ACTIVE_LINE: "#282828",
} as const

// Unicode characters for terminal UI
export const Chars = {
  SPACE: " ",
  BLOCK: "█", // Full block for context bar
  CIRCLE_FILLED: "●",
  CIRCLE_EMPTY: "○",
  CHEVRON_RIGHT: "›",
  CHEVRON_DOWN: "v",
  TRIANGLE_RIGHT: "▶",
  TRIANGLE_DOWN: "▼",
  PROMPT: ">",
  LEFT_BRACKET: "[",
  RIGHT_BRACKET: "]",
} as const
