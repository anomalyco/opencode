import { registerCustomTheme } from "@pierre/diffs"
import { PencodeTheme } from "./marked-theme"

let registered = false

export function registerPencodeTheme() {
  if (registered) return
  registered = true
  registerCustomTheme("Pencode", () => Promise.resolve(PencodeTheme))
}
