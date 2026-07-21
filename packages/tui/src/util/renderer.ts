import type { CliRenderer } from "@opentui/core"

export function destroyRenderer(renderer: Pick<CliRenderer, "isDestroyed" | "setTerminalTitle" | "destroy">) {
  renderer.setTerminalTitle("")
  if (process.platform === "win32") process.title = ""
  if (renderer.isDestroyed) return
  renderer.destroy()
}
