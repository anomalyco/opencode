import type { CliRenderer } from "@opentui/core"

type SignalTarget = {
  prependListener(event: "SIGWINCH", listener: () => void): unknown
  removeListener(event: "SIGWINCH", listener: () => void): unknown
}

type TerminalOutput = Pick<NodeJS.WriteStream, "isTTY"> & {
  _refreshSize?: () => void
}

export function installTerminalResizeRefresh(
  target: SignalTarget = process,
  stdout: TerminalOutput = process.stdout,
) {
  if (!stdout.isTTY || !stdout._refreshSize) return () => {}
  // Bun can leave columns/rows stale in some PTY hosts until the stream refreshes its cached window size.
  const refresh = () => stdout._refreshSize?.()
  refresh()
  target.prependListener("SIGWINCH", refresh)
  return () => target.removeListener("SIGWINCH", refresh)
}

export function destroyRenderer(renderer: Pick<CliRenderer, "isDestroyed" | "setTerminalTitle" | "destroy">) {
  renderer.setTerminalTitle("")
  if (renderer.isDestroyed) return
  renderer.destroy()
}
