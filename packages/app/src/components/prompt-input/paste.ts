const LARGE_PASTE_CHARS = 8000
const LARGE_PASTE_BREAKS = 120

function largePaste(text: string) {
  if (text.length >= LARGE_PASTE_CHARS) return true
  let breaks = 0
  for (const char of text) {
    if (char !== "\n") continue
    breaks += 1
    if (breaks >= LARGE_PASTE_BREAKS) return true
  }
  return false
}

export function normalizePaste(text: string) {
  if (!text.includes("\r")) return text
  return text.replace(/\r\n?/g, "\n")
}

export function pasteMode(text: string) {
  if (largePaste(text)) return "manual"
  if (text.includes("\n") || text.includes("\r")) return "manual"
  return "native"
}
