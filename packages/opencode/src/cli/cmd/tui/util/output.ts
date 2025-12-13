// Spinner characters and status prefixes used by CLI tools (ora, clack, listr, etc.)
const ANIMATED_PREFIXES = [
  // Quarter-circle spinners (ora "dots" variants)
  "◒",
  "◐",
  "◓",
  "◑",
  // Braille spinners (ora default)
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
  "⣾",
  "⣽",
  "⣻",
  "⢿",
  "⡿",
  "⣟",
  "⣯",
  "⣷",
  // ASCII spinners
  "|",
  "/",
  "-",
  "\\",
  // Status indicators (clack, listr, etc.) - these prefix "in progress" lines
  "○",
  "◇",
  "●",
  "◆",
  "■",
  "□",
  "▪",
  "▫",
  "►",
  "▸",
  "→",
  "•",
  "·",
  "∙",
  "⋅",
  "★",
  "☆",
  "✓",
  "✔",
  "✗",
  "✘",
  "⧗",
  "⧖",
]

const ANIMATED_PREFIX_SET = new Set(ANIMATED_PREFIXES)

const PROGRESS_BAR = /\[[=>#\-\s.]+\]/g
const PERCENT_SUFFIX = /\s+\d+(?:\.\d+)?%\s*$/
const FRACTION_SUFFIX = /\s+\d+\s*\/\s*\d+\s*$/
const DOT_SUFFIX = /(?:\.{1,}|…)+\s*$/

function stripCarriageReturn(line: string): string {
  const idx = line.lastIndexOf("\r")
  if (idx === -1) return line
  return line.slice(idx + 1)
}

function hasAnimatedPrefix(line: string): boolean {
  const trimmed = line.trimStart()
  for (const symbol of ANIMATED_PREFIX_SET) {
    if (trimmed.startsWith(symbol)) {
      return true
    }
  }
  return false
}

function stripAnimatedPrefix(line: string): string {
  const trimmed = line.trimStart()
  for (const symbol of ANIMATED_PREFIXES) {
    if (trimmed.startsWith(symbol)) {
      return trimmed.slice(symbol.length).trimStart()
    }
  }
  return trimmed
}

function normalizeBase(line: string): string {
  const trimmed = line.trimEnd()
  if (!trimmed) return ""
  return stripAnimatedPrefix(trimmed)
    .replace(PROGRESS_BAR, " ")
    .replace(PERCENT_SUFFIX, " ")
    .replace(FRACTION_SUFFIX, " ")
    .replace(DOT_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Normalizes terminal output by collapsing animated frames (spinners, progress bars, dots)
 * and applying carriage-return semantics.
 *
 * Lines with animated prefixes (spinners, status indicators) that share the same
 * base text are collapsed to show only the latest frame.
 */
export function normalizeTerminalOutput(text: string): string {
  const lines = text.split("\n")
  const result: string[] = []
  let prev = ""
  let idx = -1

  for (const raw of lines) {
    const line = stripCarriageReturn(raw)
    const animated = hasAnimatedPrefix(line)
    const base = normalizeBase(line)

    // If this line has an animated prefix and matches the last tracked base, replace it
    if (animated && base && prev === base && idx >= 0) {
      result[idx] = line
      continue
    }

    result.push(line)

    // Track base text for lines with animated prefixes
    if (!animated || !base) {
      prev = ""
      idx = -1
      continue
    }
    prev = base
    idx = result.length - 1
  }

  return result.join("\n")
}
