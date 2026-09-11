export const LARGE_PASTE_CHARS = 64 * 1024
export const LARGE_PASTE_LINES = 500

export const LEGACY_MANUAL_PASTE_POLICY = {
  chars: 8000,
  lines: 120,
}

export function normalizePaste(text: string) {
  if (!text.includes("\r")) return text
  return text.replace(/\r\n?/g, "\n")
}

export function isLargePaste(
  text: string,
  policy: { chars: number; lines: number } = { chars: LARGE_PASTE_CHARS, lines: LARGE_PASTE_LINES },
) {
  if (text.length >= policy.chars) return true
  let lines = 0
  for (const char of text) {
    if (char !== "\n") continue
    lines += 1
    if (lines >= policy.lines) return true
  }
  return false
}
