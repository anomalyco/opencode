import type { CliRenderer } from "@opentui/core"

export function destroyRenderer(renderer: Pick<CliRenderer, "isDestroyed" | "setTerminalTitle" | "destroy">) {
  if (renderer.isDestroyed) return
  renderer.setTerminalTitle("")
  renderer.destroy()
}
