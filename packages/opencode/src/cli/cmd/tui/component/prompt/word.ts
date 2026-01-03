// Word characters are [A-Za-z0-9] only, matching Readline's isalnum() and
// Emacs' word syntax class. Underscore and punctuation are non-word chars.
export function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9]/.test(ch)
}

export function getWordBoundaries(text: string, cursorOffset: number): { start: number; end: number } | null {
  if (text.length === 0) return null

  const effectiveOffset = Math.min(cursorOffset, text.length)

  // Readline/Emacs forward-word semantics: skip non-word chars, then advance
  // through word chars. If no next word exists, fall back to the previous word
  // (more useful than Emacs' silent no-op at end of buffer).
  let pos = effectiveOffset
  while (pos < text.length && !isWordChar(text[pos])) pos++

  if (pos >= text.length) {
    // No next word — fall back to previous word
    let end = effectiveOffset
    while (end > 0 && !isWordChar(text[end - 1])) end--
    if (end === 0) return null
    let start = end
    while (start > 0 && isWordChar(text[start - 1])) start--
    return { start, end }
  }

  const start = pos
  while (pos < text.length && isWordChar(text[pos])) pos++
  return { start, end: pos }
}

export function lowercaseWord(text: string, start: number, end: number): string {
  return text.slice(0, start) + text.slice(start, end).toLowerCase() + text.slice(end)
}

export function uppercaseWord(text: string, start: number, end: number): string {
  return text.slice(0, start) + text.slice(start, end).toUpperCase() + text.slice(end)
}

export function capitalizeWord(text: string, start: number, end: number): string {
  const segment = text.slice(start, end)
  const capitalized = segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase()
  return text.slice(0, start) + capitalized + text.slice(end)
}
