import { registerCustomTheme } from "@pierre/diffs"
import { ArgusTheme } from "./marked-theme"

let registered = false

export function registerArgusTheme() {
  if (registered) return
  registered = true
  registerCustomTheme("Argus", () => Promise.resolve(ArgusTheme))
}
