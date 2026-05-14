import type { PromptKeyEvent, VimFindType } from "./vim-types"

export function vimKeyName(event: PromptKeyEvent) {
  if (event.name === "4" && event.shift) return "$"
  if (event.name === "6" && event.shift) return "^"
  if (event.name === "f" && event.shift) return "F"
  if (event.name === "t" && event.shift) return "T"
  if (event.name.length === 1 && event.shift && /[a-z]/.test(event.name)) return event.name.toUpperCase()
  return event.name
}

export function isFindKey(name: string): name is VimFindType {
  return name === "f" || name === "F" || name === "t" || name === "T"
}

export function reverseFind(find: VimFindType): VimFindType {
  if (find === "f") return "F"
  if (find === "F") return "f"
  if (find === "t") return "T"
  return "t"
}
