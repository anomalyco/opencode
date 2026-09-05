export const LARGE_PASTE_CHARS = 8000
export const LARGE_PASTE_BREAKS = 120

export type PasteMode = "native" | "manual"

// The scan stops as soon as the verdict is known, so a multi-megabyte paste never
// allocates a line array just to discover that it is large.
export function largePaste(text: string) {
  if (text.length >= LARGE_PASTE_CHARS) return true
  let breaks = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) continue
    breaks += 1
    if (breaks >= LARGE_PASTE_BREAKS) return true
  }
  return false
}

export function normalizePaste(text: string) {
  if (!text.includes("\r")) return text
  return text.replace(/\r\n?/g, "\n")
}

// "native" lets the browser insert the text so small edits keep undo history, IME and
// selection semantics. "manual" means the paste has to be applied to the prompt model
// instead, because letting the browser build one node per line is what stalls the
// renderer on large pastes.
export function pasteMode(text: string): PasteMode {
  if (largePaste(text)) return "manual"
  if (text.includes("\n") || text.includes("\r")) return "manual"
  return "native"
}
