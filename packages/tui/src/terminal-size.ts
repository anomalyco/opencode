import { RendererControlState, type CliRenderer } from "@opentui/core"
import { exclusiveTerminal } from "./terminal-queue"

// On Windows an inverted console viewport leaves the screen black, and no event
// reliably reports the recovery, so the viewport is checked on the renderer's clock.
const WATCH_MS = 500
const MAX_DIMENSION = 0xffffffff

type Size = { width: number; height: number }
type Viewport = { valid(): boolean; size(): Size | undefined; repair(): void }

export function guardTerminalResize(
  renderer: CliRenderer,
  viewport: Viewport | undefined,
  report: (message: string, error: unknown) => void,
) {
  const request = renderer.requestResize
  let broken = false
  // At most one restart per broken episode, so a viewport that stays inverted does not restart every tick.
  let restarted = false
  let disposed = false

  // suspend() and resume() are the renderer's own terminal re-init, the same calls the
  // external editor makes. resume() repaints everything. The state is checked when the
  // restart runs, so a restart queued behind the editor does nothing while it is open,
  // and one queued after the guard is removed does nothing at all.
  const restart = () =>
    exclusiveTerminal(renderer, async () => {
      if (disposed || renderer.controlState === RendererControlState.EXPLICIT_SUSPENDED) return
      try {
        await renderer.suspend()
        // A failed resume leaves the renderer suspended, so it is retried once before giving up.
        await renderer.resume().catch(() => renderer.resume())
      } catch (error) {
        report("Failed to restart the renderer after a console viewport repair", error)
      }
    })

  const restartOnce = () => {
    if (restarted) return
    restarted = true
    void restart()
  }

  const check = (view: Viewport) => {
    if (!view.valid()) {
      broken = true
      view.repair()
      // Conhost ignores the repair on the alternate screen, so the screen is re-entered.
      if (!view.valid() && renderer.screenMode === "alternate-screen") restartOnce()
      return
    }
    if (!broken) return
    broken = false
    const actual = view.size()
    if (actual && (actual.width !== renderer.width || actual.height !== renderer.height)) {
      restarted = false
      return request.call(renderer, actual.width, actual.height)
    }
    restartOnce()
    restarted = false
  }

  const watch = viewport && renderer.clock.setInterval(() => check(viewport), WATCH_MS)

  renderer.requestResize = (width: number, height: number) => {
    // A bogus reading (2^64) means the viewport is inverted. Drop it and check now.
    if (!(width > 0 && height > 0 && width <= MAX_DIMENSION && height <= MAX_DIMENSION)) {
      if (viewport) check(viewport)
      return
    }
    return request.call(renderer, width, height)
  }

  return () => {
    disposed = true
    if (watch) renderer.clock.clearInterval(watch)
    renderer.requestResize = request
  }
}
