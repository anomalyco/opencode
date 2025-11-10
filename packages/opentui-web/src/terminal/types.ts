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

// OpenCode TUI Theme - VS Code Dark+ inspired
export const Colors = {
  // Backgrounds
  BG_MAIN: "#1e1e1e", // Main editor background
  BG_PANEL: "#252526", // Sidebar background
  BG_DARK: "#1a1a1a", // Darker elements
  BG_INPUT: "#3c3c3c", // Input fields
  BG_HOVER: "#2a2d2e", // Hover state

  // Borders
  BORDER: "#3e3e3e", // Main borders
  BORDER_LIGHT: "#5e5e5e", // Lighter borders

  // Text
  TEXT_MAIN: "#cccccc", // Primary text
  TEXT_MUTED: "#858585", // Secondary text
  TEXT_BRIGHT: "#ffffff", // Emphasis text
  TEXT_DIM: "#6a6a6a", // Dimmed text

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

// Standard ASCII characters only (codes 32-126)
// NO Unicode - separation is done via background colors
export const Chars = {
  SPACE: " ",
  BLOCK: "#", // Used for context bar segments and filled areas
  CIRCLE: "o", // Used for inactive tabs/bullets
  STAR: "*", // Used for active tabs/bullets
  TRIANGLE: ">", // Used for collapsed sections
  DOWN_ARROW: "v", // Used for expanded sections
  PROMPT: ">",
  LEFT_BRACKET: "[",
  RIGHT_BRACKET: "]",
  VERTICAL_BAR: "|",
  DASH: "-",
  PLUS: "+",
  EQUALS: "=",
} as const
