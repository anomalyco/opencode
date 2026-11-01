import { RendererControlState, type CliRenderer } from "@opentui/core"

type TitleRenderer = Pick<CliRenderer, "isDestroyed" | "controlState" | "setTerminalTitle">

// OpenTUI rejects terminal control from suspend() until resume() completes, e.g. while $EDITOR runs.
export function setTerminalTitle(renderer: TitleRenderer, title: string) {
  if (renderer.isDestroyed || renderer.controlState === RendererControlState.EXPLICIT_SUSPENDED) return
  // The native layer rejects control characters (for example a newline in a generated session
  // title) with InvalidArgument, which would otherwise crash the TUI.
  renderer.setTerminalTitle(title.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " "))
}

export function destroyRenderer(renderer: TitleRenderer & Pick<CliRenderer, "destroy">) {
  if (renderer.isDestroyed) return
  setTerminalTitle(renderer, "")
  renderer.destroy()
}
