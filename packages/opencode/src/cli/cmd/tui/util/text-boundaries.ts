// Word boundary characters - characters that separate words
const WORD_BOUNDARY_CHARS = /[\s.,;:!?'"()\[\]{}<>\/\\|`~@#$%^&*+=\-]/

// Find word boundaries around a character index in a line
export function findWordBoundaries(
  line: string,
  charIndex: number,
): { start: number; end: number; word: string } | undefined {
  if (!line || charIndex < 0 || charIndex >= line.length) return undefined

  // Check if we're on a boundary character
  if (WORD_BOUNDARY_CHARS.test(line[charIndex])) return undefined

  // Find start of word by scanning backwards
  let start = charIndex
  while (start > 0 && !WORD_BOUNDARY_CHARS.test(line[start - 1])) {
    start--
  }

  // Find end of word by scanning forwards
  let end = charIndex
  while (end + 1 < line.length && !WORD_BOUNDARY_CHARS.test(line[end + 1])) {
    end++
  }

  const word = line.substring(start, end + 1)
  return word.length > 0 ? { start, end: end + 1, word } : undefined
}

// Extract word at approximate screen position
// Assumes monospace font where each character is 1 unit wide
// x = column (0-indexed), y = line (0-indexed relative to text start)
export function extractWordAtPosition(
  x: number,
  y: number,
  text: string,
  elementX: number,
  elementY: number,
): string | undefined {
  if (!text) return undefined

  const lines = text.split("\n")
  // Calculate relative line index from click position
  const lineIndex = y - elementY
  if (lineIndex < 0 || lineIndex >= lines.length) return undefined

  const line = lines[lineIndex]
  if (!line) return undefined

  // Calculate character index from X position (accounting for element's X offset)
  const charIndex = x - elementX
  if (charIndex < 0 || charIndex >= line.length) return undefined

  const result = findWordBoundaries(line, charIndex)
  return result?.word
}

// Extract line at approximate screen position
export function extractLineAtPosition(
  y: number,
  text: string,
  elementY: number,
): string | undefined {
  if (!text) return undefined

  const lines = text.split("\n")
  const lineIndex = y - elementY
  if (lineIndex < 0 || lineIndex >= lines.length) return undefined

  const line = lines[lineIndex]
  return line?.trim() || undefined
}
