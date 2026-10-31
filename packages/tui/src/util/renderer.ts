import { RendererControlState, type CliRenderer } from "@opentui/core"

type TitleRenderer = Pick<CliRenderer, "isDestroyed" | "controlState" | "setTerminalTitle">

// OpenTUI rejects terminal control from suspend() until resume() completes, e.g. while $EDITOR runs.
export function setTerminalTitle(renderer: TitleRenderer, title: string) {
  if (renderer.isDestroyed || renderer.controlState === RendererControlState.EXPLICIT_SUSPENDED) return
  renderer.setTerminalTitle(title)
}

export function destroyRenderer(renderer: TitleRenderer & Pick<CliRenderer, "setProgramStatus" | "destroy">) {
  if (renderer.isDestroyed) return
  setTerminalTitle(renderer, "")
  // Terminals keep the idle root OSC 7501 record after exit. Solid cleanup runs after destroy, too late to clear it.
  if (renderer.controlState !== RendererControlState.EXPLICIT_SUSPENDED) renderer.setProgramStatus({ state: "clear" })
  renderer.destroy()
}
