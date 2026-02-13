const MAX_TITLE_LENGTH = 32

/**
 * Regex matching ANSI escape sequences:
 * - CSI sequences: \x1b[ ... <letter>
 * - OSC sequences: \x1b] ... BEL or ST
 */
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)/g

/**
 * Strip ANSI escape codes from text and prepare it for use as a tab title.
 * Returns null if the cleaned text is empty.
 */
export function sanitizeForTitle(text: string): string | null {
  const cleaned = text.replace(ANSI_REGEX, "").trim()
  if (!cleaned) return null
  return cleaned.length > MAX_TITLE_LENGTH ? cleaned.slice(0, MAX_TITLE_LENGTH) : cleaned
}
