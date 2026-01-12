/**
 * Terminal Markdown Renderer
 *
 * Inspired by Python's mdv (terminal_markdown_viewer)
 * Transforms markdown into beautifully formatted terminal output
 * with box-drawing characters, ANSI colors, and proper layout.
 *
 * This is a lightweight implementation that doesn't require external
 * markdown parsing libraries - it uses regex-based parsing for common
 * markdown elements.
 */

const Box = {
  topLeft: "\u250c",
  topRight: "\u2510",
  bottomLeft: "\u2514",
  bottomRight: "\u2518",
  horizontal: "\u2500",
  vertical: "\u2502",
  leftT: "\u251c",
  rightT: "\u2524",
  topT: "\u252c",
  bottomT: "\u2534",
  cross: "\u253c",
  dblHorizontal: "\u2550",
  dblVertical: "\u2551",
  dblTopLeft: "\u2554",
  dblTopRight: "\u2557",
  dblBottomLeft: "\u255a",
  dblBottomRight: "\u255d",
  topLeftMixed: "\u2552",
  topRightMixed: "\u2555",
  bottomLeftMixed: "\u2558",
  bottomRightMixed: "\u255b",
  leftTMixed: "\u255e",
  rightTMixed: "\u2561",
  topTMixed: "\u2564",
  bottomTMixed: "\u2567",
  crossMixed: "\u256a",
} as const

const Ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  fg: {
    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    gray: "\x1b[90m",
    brightRed: "\x1b[91m",
    brightGreen: "\x1b[92m",
    brightYellow: "\x1b[93m",
    brightBlue: "\x1b[94m",
    brightMagenta: "\x1b[95m",
    brightCyan: "\x1b[96m",
    brightWhite: "\x1b[97m",
  },
  fg256: (n: number) => `\x1b[38;5;${n}m`,
  bg256: (n: number) => `\x1b[48;5;${n}m`,
} as const

const Theme = {
  heading: Ansi.bold,
  headingBar: Ansi.fg.gray,
  headingBg: Ansi.bg256(236),
  text: Ansi.reset,
  code: Ansi.fg.green,
  codeBlock: Ansi.reset,
  link: Ansi.fg.blue + Ansi.underline,
  linkText: Ansi.fg.cyan,
  bold: Ansi.bold,
  italic: Ansi.fg.yellow + Ansi.italic,
  dim: Ansi.dim,
  listBullet: Ansi.fg.blue,
  listNumber: Ansi.fg.cyan,
  blockquote: Ansi.fg.yellow + Ansi.italic,
  hr: Ansi.dim,
  tableHeader: Ansi.fg.cyan,
  tableBorder: Ansi.dim,
  tableCell: Ansi.reset,
  diffAdded: Ansi.fg.green,
  diffRemoved: Ansi.fg.red,
} as const

export interface TerminalMarkdownOptions {
  cols?: number
  indent?: string
  codePrefix?: string
  listPrefix?: string
  colors?: boolean
  theme?: MarkdownTheme
}

/**
 * Strip ANSI escape codes from a string
 */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "")
}

/**
 * Get visible width of string (excluding ANSI codes)
 */
function visibleWidth(str: string): number {
  return stripAnsi(str).length
}

/**
 * Pad string to width, accounting for ANSI codes
 */
function padRight(str: string, width: number, char = " "): string {
  const visible = visibleWidth(str)
  return visible >= width ? str : str + char.repeat(width - visible)
}

function padCenter(str: string, width: number, char = " "): string {
  const visible = visibleWidth(str)
  if (visible >= width) return str
  const left = Math.floor((width - visible) / 2)
  const right = width - visible - left
  return char.repeat(left) + str + char.repeat(right)
}

/**
 * Word wrap text to specified width
 */
function wordWrap(text: string, width: number, indent = ""): string {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = indent

  for (const word of words) {
    const testLine = line + (line === indent ? "" : " ") + word
    if (visibleWidth(testLine) > width && line !== indent) {
      lines.push(line)
      line = indent + word
    } else {
      line = testLine
    }
  }

  if (line !== indent) lines.push(line)
  return lines.join("\n")
}

// ============================================================================
// LEGACY FUNCTIONS - Used only by transformTables() export
// Main rendering now uses renderMarkdownThemedStyled() + textChunksToAnsi()
// ============================================================================

/**
 * Format a table with box-drawing characters (legacy)
 * @deprecated Use renderMarkdownThemedStyled() for new code
 */

/**
 * Main render function - uses shared implementation with TUI
 */
export function renderMarkdown(md: string, options: TerminalMarkdownOptions = {}): string {
  const cols = options.cols ?? process.stdout.columns ?? 80
  const colors = options.colors ?? true

  if (!colors) {
    return renderMarkdownSimple(md, options)
  }

  const theme = options.theme ?? createDefaultCliTheme()
  const styledText = renderMarkdownThemedStyled(md, theme, { cols })
  return textChunksToAnsi(styledText.chunks)
}

/**
 * Simple markdown renderer without colors (fallback for colors: false)
 */
function renderMarkdownSimple(md: string, options: TerminalMarkdownOptions = {}): string {
  const cols = options.cols ?? process.stdout.columns ?? 80
  const indent = options.indent ?? "  "
  const listPrefix = options.listPrefix ?? "- "

  const lines = md.split("\n")
  const result: string[] = []
  let i = 0
  let inCodeBlock = false
  let codeBlockContent: string[] = []

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith("```")) {
      if (inCodeBlock) {
        result.push(indent + codeBlockContent.join("\n" + indent))
        codeBlockContent = []
        inCodeBlock = false
      } else {
        inCodeBlock = true
      }
      i++
      continue
    }

    if (inCodeBlock) {
      codeBlockContent.push(line)
      i++
      continue
    }

    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headerMatch) {
      result.push("\n" + headerMatch[2] + "\n")
      i++
      continue
    }

    if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) {
      result.push("\n" + Box.horizontal.repeat(Math.min(cols - 4, 60)) + "\n")
      i++
      continue
    }

    const listMatch = line.match(/^(\s*)[-*+]\s+(.+)$/)
    if (listMatch) {
      const depth = Math.floor(listMatch[1].length / 2)
      result.push(indent.repeat(depth) + listPrefix + listMatch[2])
      i++
      continue
    }

    result.push(line)
    i++
  }

  return result.join("\n")
}

/**
 * Simple function to render markdown (drop-in replacement for UI.markdown)

/**
 * Transform only tables in markdown to box-drawing format.
 * If borderColor is provided, ANSI escape codes are added for coloring.

/**
 * Convert RGB values to ANSI 24-bit color escape sequence
 */
export function rgbToAnsi(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`
}

/**
 * Convert TextChunks to ANSI string for CLI output
 */
function textChunksToAnsi(chunks: TextChunk[]): string {
  let result = ""
  for (const chunk of chunks) {
    let codes = ""

    if (chunk.attributes) {
      if (chunk.attributes & Attr.BOLD) codes += "\x1b[1m"
      if (chunk.attributes & Attr.DIM) codes += "\x1b[2m"
      if (chunk.attributes & Attr.ITALIC) codes += "\x1b[3m"
      if (chunk.attributes & Attr.UNDERLINE) codes += "\x1b[4m"
      if (chunk.attributes & Attr.BLINK) codes += "\x1b[5m"
      if (chunk.attributes & Attr.INVERSE) codes += "\x1b[7m"
      if (chunk.attributes & Attr.HIDDEN) codes += "\x1b[8m"
      if (chunk.attributes & Attr.STRIKETHROUGH) codes += "\x1b[9m"
    }

    if (chunk.fg) {
      codes += rgbToAnsi(chunk.fg.r, chunk.fg.g, chunk.fg.b)
    }

    if (chunk.bg) {
      codes += `\x1b[48;2;${chunk.bg.r};${chunk.bg.g};${chunk.bg.b}m`
    }

    result += codes + chunk.text + (codes ? "\x1b[0m" : "")
  }
  return result
}

/**
 * Create a default CLI theme with ANSI-approximated colors
 */
function createDefaultCliTheme(): MarkdownTheme {
  const rgb = (r: number, g: number, b: number) => ({ r: r / 255, g: g / 255, b: b / 255, a: 1.0 })

  return {
    text: rgb(229, 229, 229),
    textMuted: rgb(102, 102, 102),
    accent: rgb(36, 114, 200),
    primary: rgb(36, 114, 200),
    border: rgb(102, 102, 102),
    background: rgb(0, 0, 0),
    backgroundPanel: rgb(60, 60, 60),
    backgroundElement: rgb(40, 40, 40),
    markdownText: rgb(229, 229, 229),
    markdownHeading: rgb(229, 229, 229),
    markdownLink: rgb(36, 114, 200),
    markdownLinkText: rgb(17, 168, 205),
    markdownCode: rgb(13, 188, 121),
    markdownCodeBlock: rgb(229, 229, 229),
    markdownBlockQuote: rgb(229, 229, 16),
    markdownEmph: rgb(229, 229, 16),
    markdownStrong: rgb(229, 229, 229),
    markdownListItem: rgb(36, 114, 200),
    markdownListEnumeration: rgb(17, 168, 205),
    markdownHorizontalRule: rgb(102, 102, 102),
    diffAdded: rgb(13, 188, 121),
    diffRemoved: rgb(205, 49, 49),
  }
}

/**
 * TextChunk interface matching OpenTUI's format
 */
export interface TextChunk {
  __isChunk: true
  text: string
  fg?: { r: number; g: number; b: number; a: number }
  bg?: { r: number; g: number; b: number; a: number }
  attributes?: number
}

/**
 * StyledText class matching OpenTUI's format
 */
export class StyledText {
  chunks: TextChunk[]
  constructor(chunks: TextChunk[]) {
    this.chunks = chunks
  }
}

// Standard ANSI colors (0-15)
const AnsiColors: Record<number, [number, number, number]> = {
  // Normal colors (30-37)
  30: [0, 0, 0], // black
  31: [205, 49, 49], // red
  32: [13, 188, 121], // green
  33: [229, 229, 16], // yellow
  34: [36, 114, 200], // blue
  35: [188, 63, 188], // magenta
  36: [17, 168, 205], // cyan
  37: [229, 229, 229], // white
  // Bright colors (90-97)
  90: [102, 102, 102], // bright black (gray)
  91: [241, 76, 76], // bright red
  92: [35, 209, 139], // bright green
  93: [245, 245, 67], // bright yellow
  94: [59, 142, 234], // bright blue
  95: [214, 112, 214], // bright magenta
  96: [41, 184, 219], // bright cyan
  97: [229, 229, 229], // bright white
}

// Background colors (40-47, 100-107)
const AnsiBgColors: Record<number, [number, number, number]> = {
  40: [0, 0, 0],
  41: [205, 49, 49],
  42: [13, 188, 121],
  43: [229, 229, 16],
  44: [36, 114, 200],
  45: [188, 63, 188],
  46: [17, 168, 205],
  47: [229, 229, 229],
  100: [102, 102, 102],
  101: [241, 76, 76],
  102: [35, 209, 139],
  103: [245, 245, 67],
  104: [59, 142, 234],
  105: [214, 112, 214],
  106: [41, 184, 219],
  107: [229, 229, 229],
}

// Text attribute flags (must match OpenTUI's TextAttributes exactly)
const Attr = {
  BOLD: 1 << 0, // 1
  DIM: 1 << 1, // 2
  ITALIC: 1 << 2, // 4
  UNDERLINE: 1 << 3, // 8
  BLINK: 1 << 4, // 16
  INVERSE: 1 << 5, // 32
  HIDDEN: 1 << 6, // 64
  STRIKETHROUGH: 1 << 7, // 128
} as const

/**
 * Parse ANSI escape codes and convert to StyledText with TextChunks
 */
export function ansiToStyledText(input: string): StyledText {
  const chunks: TextChunk[] = []
  const regex = /\x1b\[([0-9;]*)m/g

  let fg: { r: number; g: number; b: number; a: number } | undefined
  let bg: { r: number; g: number; b: number; a: number } | undefined
  let attributes = 0
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(input)) !== null) {
    // Add text before this escape sequence
    if (match.index > lastIndex) {
      const text = input.slice(lastIndex, match.index)
      if (text) {
        chunks.push({
          __isChunk: true,
          text,
          fg,
          bg,
          attributes,
        })
      }
    }

    // Parse the escape sequence
    const codes = match[1].split(";").map(Number)
    let i = 0

    while (i < codes.length) {
      const code = codes[i]

      if (code === 0) {
        // Reset
        fg = undefined
        bg = undefined
        attributes = 0
      } else if (code === 1) {
        attributes |= Attr.BOLD
      } else if (code === 2) {
        attributes |= Attr.DIM
      } else if (code === 3) {
        attributes |= Attr.ITALIC
      } else if (code === 4) {
        attributes |= Attr.UNDERLINE
      } else if (code === 5) {
        attributes |= Attr.BLINK
      } else if (code === 7) {
        attributes |= Attr.INVERSE
      } else if (code === 9) {
        attributes |= Attr.STRIKETHROUGH
      } else if (code >= 30 && code <= 37) {
        // Standard foreground
        const rgb = AnsiColors[code]
        fg = { r: rgb[0], g: rgb[1], b: rgb[2], a: 255 }
      } else if (code >= 40 && code <= 47) {
        // Standard background
        const rgb = AnsiBgColors[code]
        bg = { r: rgb[0], g: rgb[1], b: rgb[2], a: 255 }
      } else if (code >= 90 && code <= 97) {
        // Bright foreground
        const rgb = AnsiColors[code]
        fg = { r: rgb[0], g: rgb[1], b: rgb[2], a: 255 }
      } else if (code >= 100 && code <= 107) {
        // Bright background
        const rgb = AnsiBgColors[code]
        bg = { r: rgb[0], g: rgb[1], b: rgb[2], a: 255 }
      } else if (code === 38 && codes[i + 1] === 2) {
        // 24-bit foreground: 38;2;r;g;b
        const r = codes[i + 2] ?? 0
        const g = codes[i + 3] ?? 0
        const b = codes[i + 4] ?? 0
        fg = { r, g, b, a: 255 }
        i += 4
      } else if (code === 48 && codes[i + 1] === 2) {
        // 24-bit background: 48;2;r;g;b
        const r = codes[i + 2] ?? 0
        const g = codes[i + 3] ?? 0
        const b = codes[i + 4] ?? 0
        bg = { r, g, b, a: 255 }
        i += 4
      } else if (code === 38 && codes[i + 1] === 5) {
        // 256-color foreground: 38;5;n
        const n = codes[i + 2] ?? 0
        const rgb = ansi256ToRgb(n)
        fg = { r: rgb[0], g: rgb[1], b: rgb[2], a: 255 }
        i += 2
      } else if (code === 48 && codes[i + 1] === 5) {
        // 256-color background: 48;5;n
        const n = codes[i + 2] ?? 0
        const rgb = ansi256ToRgb(n)
        bg = { r: rgb[0], g: rgb[1], b: rgb[2], a: 255 }
        i += 2
      } else if (code === 39) {
        // Default foreground
        fg = undefined
      } else if (code === 49) {
        // Default background
        bg = undefined
      }

      i++
    }

    lastIndex = regex.lastIndex
  }

  // Add remaining text
  if (lastIndex < input.length) {
    const text = input.slice(lastIndex)
    if (text) {
      chunks.push({
        __isChunk: true,
        text,
        fg,
        bg,
        attributes,
      })
    }
  }

  return new StyledText(chunks)
}

/**
 * Convert 256-color index to RGB
 */
function ansi256ToRgb(n: number): [number, number, number] {
  if (n < 16) {
    // Standard colors
    const colors: [number, number, number][] = [
      [0, 0, 0],
      [128, 0, 0],
      [0, 128, 0],
      [128, 128, 0],
      [0, 0, 128],
      [128, 0, 128],
      [0, 128, 128],
      [192, 192, 192],
      [128, 128, 128],
      [255, 0, 0],
      [0, 255, 0],
      [255, 255, 0],
      [0, 0, 255],
      [255, 0, 255],
      [0, 255, 255],
      [255, 255, 255],
    ]
    return colors[n]
  } else if (n < 232) {
    // 216-color cube (6x6x6)
    const idx = n - 16
    const r = Math.floor(idx / 36)
    const g = Math.floor((idx % 36) / 6)
    const b = idx % 6
    return [r ? r * 40 + 55 : 0, g ? g * 40 + 55 : 0, b ? b * 40 + 55 : 0]
  } else {
    // Grayscale (24 levels)
    const gray = (n - 232) * 10 + 8
    return [gray, gray, gray]
  }
}

/**

/**
 * RGBA color type matching OpenTUI's format
 */
type RGBA = { r: number; g: number; b: number; a: number }

/**
 * Segment types for parsed markdown
 */
export type MarkdownSegment = { type: "text"; content: string } | { type: "code"; content: string; language: string }

/**
 * Parse markdown into segments - separates code blocks from other content
 * This allows code blocks to be rendered with tree-sitter highlighting
 */
export function parseMarkdownSegments(md: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = []
  const lines = md.split("\n")
  let currentText: string[] = []
  let inCodeBlock = false
  let codeBlockLang = ""
  let codeBlockContent: string[] = []

  const flushText = () => {
    if (currentText.length > 0) {
      segments.push({ type: "text", content: currentText.join("\n") })
      currentText = []
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        // End code block
        segments.push({
          type: "code",
          content: codeBlockContent.join("\n"),
          language: codeBlockLang,
        })
        codeBlockContent = []
        inCodeBlock = false
        codeBlockLang = ""
      } else {
        // Start code block
        flushText()
        inCodeBlock = true
        codeBlockLang = trimmed.slice(3).trim() || "text"
      }
      continue
    }

    if (inCodeBlock) {
      codeBlockContent.push(line)
    } else {
      currentText.push(line)
    }
  }

  // Flush remaining text
  flushText()

  // Handle unclosed code block
  if (inCodeBlock && codeBlockContent.length > 0) {
    segments.push({
      type: "code",
      content: codeBlockContent.join("\n"),
      language: codeBlockLang,
    })
  }

  return segments
}

/**
 * TUI Theme RGBA type (0-1 float values)
 */
type TuiRGBA = { r: number; g: number; b: number; a: number }

/**
 * Theme interface - accepts TUI theme directly (RGBA 0-1 floats)
 * The renderer will convert to 0-255 internally
 */
export interface MarkdownTheme {
  // Core colors
  text: TuiRGBA
  textMuted: TuiRGBA
  accent: TuiRGBA
  primary: TuiRGBA
  border: TuiRGBA
  background: TuiRGBA
  backgroundPanel: TuiRGBA
  backgroundElement: TuiRGBA

  // Markdown specific
  markdownText: TuiRGBA
  markdownHeading: TuiRGBA
  markdownLink: TuiRGBA
  markdownLinkText: TuiRGBA
  markdownCode: TuiRGBA
  markdownCodeBlock: TuiRGBA
  markdownBlockQuote: TuiRGBA
  markdownEmph: TuiRGBA
  markdownStrong: TuiRGBA
  markdownListItem: TuiRGBA
  markdownListEnumeration: TuiRGBA
  markdownHorizontalRule: TuiRGBA

  // Diff colors
  diffAdded: TuiRGBA
  diffRemoved: TuiRGBA
}

// Convert TUI RGBA (0-1 floats) to internal RGBA (0-255 ints)
function toIntRGBA(rgba: TuiRGBA): RGBA {
  return {
    r: Math.round(rgba.r * 255),
    g: Math.round(rgba.g * 255),
    b: Math.round(rgba.b * 255),
    a: Math.round(rgba.a * 255),
  }
}

/**
 * Render markdown directly to TextChunks using theme colors (no ANSI intermediate)
 */
export function renderMarkdownThemedStyled(
  md: string,
  tuiTheme: MarkdownTheme,
  options: { cols?: number } = {},
): StyledText {
  const cols = options.cols ?? process.stdout.columns ?? 80
  const chunks: TextChunk[] = []

  // Convert TUI theme (0-1 floats) to internal format (0-255 ints)
  const theme = {
    text: toIntRGBA(tuiTheme.text),
    textMuted: toIntRGBA(tuiTheme.textMuted),
    accent: toIntRGBA(tuiTheme.accent),
    primary: toIntRGBA(tuiTheme.primary),
    border: toIntRGBA(tuiTheme.border),
    background: toIntRGBA(tuiTheme.background),
    backgroundPanel: toIntRGBA(tuiTheme.backgroundPanel),
    backgroundElement: toIntRGBA(tuiTheme.backgroundElement),
    markdownText: toIntRGBA(tuiTheme.markdownText),
    markdownHeading: toIntRGBA(tuiTheme.markdownHeading),
    markdownLink: toIntRGBA(tuiTheme.markdownLink),
    markdownLinkText: toIntRGBA(tuiTheme.markdownLinkText),
    markdownCode: toIntRGBA(tuiTheme.markdownCode),
    markdownCodeBlock: toIntRGBA(tuiTheme.markdownCodeBlock),
    markdownBlockQuote: toIntRGBA(tuiTheme.markdownBlockQuote),
    markdownEmph: toIntRGBA(tuiTheme.markdownEmph),
    markdownStrong: toIntRGBA(tuiTheme.markdownStrong),
    markdownListItem: toIntRGBA(tuiTheme.markdownListItem),
    markdownListEnumeration: toIntRGBA(tuiTheme.markdownListEnumeration),
    markdownHorizontalRule: toIntRGBA(tuiTheme.markdownHorizontalRule),
    diffAdded: toIntRGBA(tuiTheme.diffAdded),
    diffRemoved: toIntRGBA(tuiTheme.diffRemoved),
  }

  const addChunk = (text: string, color?: RGBA, attrs: number = 0) => {
    if (text) {
      chunks.push({
        __isChunk: true,
        text,
        fg: color,
        attributes: attrs,
      })
    }
  }

  const addChunkWithBg = (text: string, fg?: RGBA, bg?: RGBA, attrs: number = 0) => {
    if (text) {
      chunks.push({
        __isChunk: true,
        text,
        fg,
        bg,
        attributes: attrs,
      })
    }
  }

  const lines = md.split("\n")
  let inCodeBlock = false
  let codeBlockLang = ""
  let inTable = false
  let tableLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Code block fence
    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        inCodeBlock = false
        codeBlockLang = ""
        continue
      }
      inCodeBlock = true
      codeBlockLang = trimmed.slice(3).trim()
      continue
    }

    // Inside code block - handle diff specially
    if (inCodeBlock) {
      if (codeBlockLang === "diff") {
        // Diff-style code with colors
        if (trimmed.startsWith("+")) {
          addChunk("  " + line + "\n", theme.diffAdded)
        } else if (trimmed.startsWith("-")) {
          addChunk("  " + line + "\n", theme.diffRemoved)
        } else {
          addChunk("  " + line + "\n", theme.markdownCodeBlock)
        }
      } else {
        addChunk("  " + line + "\n", theme.markdownCodeBlock, Attr.ITALIC)
      }
      continue
    }

    // Table detection
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (!inTable) {
        inTable = true
        tableLines = []
      }
      tableLines.push(trimmed)
      // Check if next line is not a table line or end of input
      const nextLine = lines[i + 1]?.trim()
      if (!nextLine || !nextLine.startsWith("|") || !nextLine.endsWith("|")) {
        // End of table, render it
        renderTableThemed(tableLines, theme, chunks, cols)
        inTable = false
        tableLines = []
      }
      continue
    }

    // Headers - prompt-style with thick vertical bar (like the prompt input)
    const headerMatch = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (headerMatch) {
      const level = headerMatch[1].length
      const text = headerMatch[2]

      // Use left half block for the accent bar (like prompt)
      const bar = "\u258c" // ▌ left half block

      if (level <= 2) {
        // h1/h2: prominent with grey bar + background
        // addChunk(bar, theme.border)
        addChunkWithBg("  ", theme.markdownHeading, theme.backgroundPanel, Attr.BOLD)
        renderInlineThemedWithDefault(text, theme, chunks, theme.markdownHeading, Attr.BOLD)
        addChunkWithBg("  \n", theme.markdownHeading, theme.backgroundPanel, Attr.BOLD)
      } else {
        // h3+: just bold text, less visual weight - process inline markdown
        renderInlineThemedWithDefault(text, theme, chunks, theme.markdownHeading, Attr.BOLD)
        addChunk("\n")
      }
      continue
    }

    // Horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
      addChunk(Box.horizontal.repeat(cols - 4) + "\n", theme.markdownHorizontalRule, Attr.DIM)
      continue
    }

    // Blockquote
    if (trimmed.startsWith(">")) {
      const content = trimmed.replace(/^>\s*/, "")
      addChunk("  " + Box.vertical + " ", theme.border, Attr.DIM)
      // Process inline formatting within blockquote
      renderInlineThemedWithDefault(content, theme, chunks, theme.markdownBlockQuote, Attr.ITALIC)
      addChunk("\n")
      continue
    }

    // Task list item with checkbox
    const taskMatch = trimmed.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/)
    if (taskMatch) {
      const indent = line.match(/^(\s*)/)?.[1] ?? ""
      const checked = taskMatch[1].toLowerCase() === "x"
      const content = taskMatch[2]
      addChunk(indent + "- ", theme.markdownListItem)
      addChunk("[", theme.markdownListItem)
      addChunk(checked ? "x" : " ", checked ? theme.diffAdded : theme.textMuted)
      addChunk("] ", theme.markdownListItem)
      renderInlineThemed(content, theme, chunks)
      addChunk("\n")
      continue
    }

    // Unordered list
    const ulMatch = trimmed.match(/^[-*+]\s+(.*)$/)
    if (ulMatch) {
      const indent = line.match(/^(\s*)/)?.[1] ?? ""
      const content = ulMatch[1]
      addChunk(indent + "- ", theme.markdownListItem)
      renderInlineThemed(content, theme, chunks)
      addChunk("\n")
      continue
    }

    // Ordered list
    const olMatch = trimmed.match(/^(\d+)[.)]\s+(.*)$/)
    if (olMatch) {
      const indent = line.match(/^(\s*)/)?.[1] ?? ""
      const num = olMatch[1]
      const content = olMatch[2]
      addChunk(indent + num + ". ", theme.markdownListEnumeration)
      renderInlineThemed(content, theme, chunks)
      addChunk("\n")
      continue
    }

    // Empty line
    if (trimmed === "") {
      addChunk("\n")
      continue
    }

    // Regular text with inline formatting
    renderInlineThemed(line, theme, chunks)
    addChunk("\n")
  }

  return new StyledText(chunks)
}

/**
 * Render inline markdown elements (bold, italic, code, links) with theme colors
 */
function renderInlineThemed(text: string, theme: MarkdownTheme, chunks: TextChunk[]) {
  renderInlineThemedWithDefault(text, theme, chunks, theme.markdownText, 0)
}

/**
 * Render inline markdown with a default color/attribute for plain text
 */
function renderInlineThemedWithDefault(
  text: string,
  theme: MarkdownTheme,
  chunks: TextChunk[],
  defaultColor: RGBA,
  defaultAttrs: number,
) {
  const addChunk = (t: string, color?: RGBA, attrs: number = 0) => {
    if (t) {
      chunks.push({
        __isChunk: true,
        text: t,
        fg: color,
        attributes: attrs,
      })
    }
  }

  // Process inline elements with regex
  let lastIndex = 0

  // Combined regex for inline elements - order matters
  // Matches: ***bold italic***, **bold *with italic* inside**, *italic **with bold** inside*, `code`, [text](url "title"), ~~strikethrough~~
  const inlineRegex =
    /(\*\*\*|___)(.*?)\1|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|~~(.+?)~~/g

  let match
  while ((match = inlineRegex.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      addChunk(text.slice(lastIndex, match.index), defaultColor, defaultAttrs)
    }

    if (match[1]) {
      // Bold+Italic (*** or ___)
      addChunk(match[2], theme.markdownStrong, Attr.BOLD | Attr.ITALIC)
    } else if (match[3] !== undefined) {
      // Bold (**) - may contain nested italic
      const boldContent = match[3]
      // Check for nested italic inside bold
      const nestedItalic = boldContent.match(/^(.*)?\*(.+?)\*(.*)$/)
      if (nestedItalic) {
        if (nestedItalic[1]) addChunk(nestedItalic[1], theme.markdownStrong, Attr.BOLD)
        addChunk(nestedItalic[2], theme.markdownStrong, Attr.BOLD | Attr.ITALIC)
        if (nestedItalic[3]) addChunk(nestedItalic[3], theme.markdownStrong, Attr.BOLD)
      } else {
        addChunk(boldContent, theme.markdownStrong, Attr.BOLD)
      }
    } else if (match[4] !== undefined) {
      // Italic (*) - may contain nested bold
      const italicContent = match[4]
      // Check for nested bold inside italic
      const nestedBold = italicContent.match(/^(.*)?\*\*(.+?)\*\*(.*)$/)
      if (nestedBold) {
        if (nestedBold[1]) addChunk(nestedBold[1], theme.markdownEmph, Attr.ITALIC)
        addChunk(nestedBold[2], theme.markdownStrong, Attr.BOLD | Attr.ITALIC)
        if (nestedBold[3]) addChunk(nestedBold[3], theme.markdownEmph, Attr.ITALIC)
      } else {
        addChunk(italicContent, theme.markdownEmph, Attr.ITALIC)
      }
    } else if (match[5] !== undefined) {
      // Inline code
      addChunk(match[5], theme.markdownCode)
    } else if (match[6] !== undefined) {
      // Link [text](url "title") - show text and URL like original
      const linkText = match[6]
      const url = match[7]
      addChunk(linkText, theme.markdownLinkText, Attr.UNDERLINE)
      addChunk(" (", theme.markdownText)
      addChunk(url, theme.markdownLink, Attr.UNDERLINE)
      addChunk(")", theme.markdownText)
    } else if (match[8] !== undefined) {
      // Strikethrough ~~text~~ - use muted color with strikethrough attribute
      addChunk(match[8], theme.textMuted, Attr.STRIKETHROUGH)
    }

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    addChunk(text.slice(lastIndex), defaultColor, defaultAttrs)
  }
}

/**
 * Render table with theme colors
 */
function renderTableThemed(tableLines: string[], theme: MarkdownTheme, chunks: TextChunk[], cols: number) {
  if (tableLines.length < 2) return

  const addChunk = (t: string, color?: { r: number; g: number; b: number; a: number }, attrs: number = 0) => {
    if (t) {
      chunks.push({
        __isChunk: true,
        text: t,
        fg: color,
        attributes: attrs,
      })
    }
  }

  // Parse table
  const parseRow = (row: string): string[] => {
    // Split on | but not \|, then unescape any \| to |
    const cells: string[] = []
    let cell = ""
    let i = 0

    while (i < row.length) {
      if (row[i] === "\\" && row[i + 1] === "|") {
        // Escaped pipe - add literal | and skip backslash
        cell += "|"
        i += 2
      } else if (row[i] === "|") {
        // Unescaped pipe - cell boundary
        cells.push(cell)
        cell = ""
        i++
      } else {
        cell += row[i]
        i++
      }
    }
    cells.push(cell)

    return cells.slice(1, -1).map((c) => c.trim())
  }

  // Check if a line is a separator line (contains only dashes, colons, pipes, spaces)
  const isSeparatorLine = (line: string): boolean => {
    return /^\|[\s\-:|\s]+\|$/.test(line)
  }

  // Calculate visible length (after markdown rendering)
  // Strips markdown syntax: **bold**, *italic*, `code`, ~~strike~~, [text](url)
  // Uses Bun.stringWidth() to account for double-width unicode chars (emojis, CJK)
  const visibleLength = (text: string): number => {
    const stripped = text
      .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    return Bun.stringWidth(stripped)
  }

  // Word wrap text to fit width, returns array of lines
  // Preserves markdown syntax by not breaking inside backticks
  // Falls back to breaking on . or - for long tokens
  const wordWrap = (text: string, width: number): string[] => {
    if (visibleLength(text) <= width) return [text]

    // Split into tokens, keeping backtick-quoted sections together
    const tokens: string[] = []
    let current = ""
    let inBacktick = false

    for (let i = 0; i < text.length; i++) {
      const char = text[i]
      if (char === "`") {
        inBacktick = !inBacktick
        current += char
      } else if (char === " " && !inBacktick) {
        if (current) tokens.push(current)
        tokens.push(" ")
        current = ""
      } else {
        current += char
      }
    }
    if (current) tokens.push(current)

    // Break a long token on . or - characters
    // If token is backtick-quoted, wrap each part in backticks
    const breakLongToken = (token: string, maxLen: number): string[] => {
      if (token.length <= maxLen) return [token]

      const isQuoted = token.startsWith("`") && token.endsWith("`")
      const inner = isQuoted ? token.slice(1, -1) : token

      const parts: string[] = []
      let part = ""
      for (let i = 0; i < inner.length; i++) {
        part += inner[i]
        // Break after . or - if we're getting long (leave room for backticks if quoted)
        const effectiveMax = isQuoted ? maxLen - 2 : maxLen
        if (part.length >= effectiveMax - 2 && ".-".includes(inner[i]) && i < inner.length - 1) {
          parts.push(isQuoted ? "`" + part + "`" : part)
          part = ""
        }
      }
      if (part) parts.push(isQuoted ? "`" + part + "`" : part)
      return parts
    }

    const lines: string[] = []
    let line = ""
    for (const token of tokens) {
      if (token === " ") {
        if (visibleLength(line) > 0 && visibleLength(line) < width) {
          line += " "
        }
      } else if (visibleLength(line) === 0) {
        // Token at start of line - break if too long
        if (visibleLength(token) > width) {
          for (const part of breakLongToken(token, width)) {
            if (visibleLength(line) === 0) {
              line = part
            } else if (visibleLength(line + part) <= width) {
              line += part
            } else {
              lines.push(line.trimEnd())
              line = part
            }
          }
        } else {
          line = token
        }
      } else if (visibleLength(line + token) <= width) {
        line += token
      } else {
        lines.push(line.trimEnd())
        // New line - break token if too long
        if (visibleLength(token) > width) {
          for (const part of breakLongToken(token, width)) {
            if (visibleLength(line) === 0) {
              line = part
            } else if (visibleLength(line + part) <= width) {
              line += part
            } else {
              lines.push(line.trimEnd())
              line = part
            }
          }
        } else {
          line = token
        }
      }
    }
    if (line) lines.push(line.trimEnd())
    return lines.length ? lines : [""]
  }

  const headerRow = parseRow(tableLines[0])
  // Filter out separator lines and parse remaining as data rows
  const dataRows = tableLines
    .slice(1)
    .filter((line) => !isSeparatorLine(line))
    .map(parseRow)

  // Calculate column widths - start with natural widths (using visible width with unicode)
  let colWidths = headerRow.map((h, i) => {
    const dataMax = Math.max(...dataRows.map((r) => visibleLength(r[i] ?? "")), 0)
    return Math.max(visibleLength(h), dataMax)
  })

  // Constrain table to available width (cols - 4 for padding)
  const maxWidth = cols - 4
  // Total width = sum of colWidths + 3 per col (2 padding + 1 border) + 1 (final border)
  const calcWidth = () => colWidths.reduce((a, b) => a + b + 3, 1)

  // Shrink columns proportionally if table is too wide
  while (calcWidth() > maxWidth && colWidths.some((w) => w > 10)) {
    const maxIdx = colWidths.indexOf(Math.max(...colWidths))
    colWidths[maxIdx] = Math.max(10, colWidths[maxIdx] - 1)
  }

  // Top border
  addChunk(
    Box.topLeft + colWidths.map((w) => Box.horizontal.repeat(w + 2)).join(Box.topT) + Box.topRight + "\n",
    theme.border,
  )

  // Header row (single line, no wrap for headers)
  addChunk(Box.vertical, theme.border)
  headerRow.forEach((cell, i) => {
    addChunk(" ", theme.border)
    const cellWidth = Bun.stringWidth(cell)
    const targetWidth = colWidths[i]
    if (cellWidth <= targetWidth) {
      // Pad with spaces
      addChunk(cell + " ".repeat(targetWidth - cellWidth), theme.markdownHeading, Attr.BOLD)
    } else {
      // Truncate - simple approach, may cut mid-emoji
      addChunk(cell.slice(0, targetWidth), theme.markdownHeading, Attr.BOLD)
    }
    addChunk(" " + Box.vertical, theme.border)
  })
  addChunk("\n")

  // Header separator
  addChunk(
    Box.leftT + colWidths.map((w) => Box.horizontal.repeat(w + 2)).join(Box.cross) + Box.rightT + "\n",
    theme.border,
  )

  // Helper to render cell with inline formatting and pad to width
  const renderCell = (text: string, width: number, isHeader: boolean) => {
    if (!text) {
      addChunk(" ".repeat(width), theme.markdownText)
      return
    }
    // Render inline markdown to temporary chunks
    const cellChunks: TextChunk[] = []
    if (isHeader) {
      cellChunks.push({ __isChunk: true, text, fg: theme.markdownHeading, attributes: Attr.BOLD })
    } else {
      renderInlineThemed(text, theme, cellChunks)
    }
    // Calculate visible length (accounting for double-width unicode) and add chunks
    let len = 0
    for (const c of cellChunks) {
      chunks.push(c)
      len += Bun.stringWidth(c.text)
    }
    // Pad remaining space
    if (len < width) {
      addChunk(" ".repeat(width - len), theme.markdownText)
    }
  }

  // Data rows with word wrap
  dataRows.forEach((row) => {
    // Wrap each cell and find max lines needed
    const wrappedCells = row.map((cell, i) => wordWrap(cell ?? "", colWidths[i] ?? 10))
    const maxLines = Math.max(...wrappedCells.map((w) => w.length))

    // Render each line of the row
    for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
      addChunk(Box.vertical, theme.border)
      wrappedCells.forEach((lines, i) => {
        addChunk(" ", theme.border)
        const text = lines[lineIdx] ?? ""
        renderCell(text, colWidths[i] ?? 0, false)
        addChunk(" " + Box.vertical, theme.border)
      })
      addChunk("\n")
    }
  })

  // Bottom border
  addChunk(
    Box.bottomLeft + colWidths.map((w) => Box.horizontal.repeat(w + 2)).join(Box.bottomT) + Box.bottomRight + "\n",
    theme.border,
  )
}

export { Box, Ansi, Theme }
