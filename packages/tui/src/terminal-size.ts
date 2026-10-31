import { RendererControlState, type CliRenderer } from "@opentui/core"

// On Windows an inverted console viewport leaves the screen black, and no event
// reliably reports the recovery, so the viewport is checked on the renderer's clock.
const WATCH_MS = 500
const MAX_DIMENSION = 0xffffffff

type Size = { width: number; height: number }
type Viewport = { valid(): boolean; size(): Size | undefined; repair(): void }

export function guardTerminalResize(renderer: CliRenderer, viewport: Viewport | undefined) {
  const request = renderer.requestResize
  let broken = false
  let restarting = false

  // suspend() and resume() are the renderer's own terminal re-init, the same calls the
  // external editor makes. resume() repaints everything, and re-entering the alternate
  // screen recreates a valid console viewport.
  const restart = async () => {
    if (restarting || renderer.controlState === RendererControlState.EXPLICIT_SUSPENDED) return
    restarting = true
    try {
      await renderer.suspend()
      await renderer.resume()
    } catch {
      // A failed restart is not retried until the viewport breaks again.
    } finally {
      restarting = false
    }
  }

  const check = (view: Viewport) => {
    if (!view.valid()) {
      broken = true
      view.repair()
      // Conhost ignores the repair on the alternate screen, so the screen is re-entered.
      if (!view.valid() && renderer.screenMode === "alternate-screen") void restart()
      return
    }
    if (!broken) return
    broken = false
    const actual = view.size()
    if (actual && (actual.width !== renderer.width || actual.height !== renderer.height)) {
      return request.call(renderer, actual.width, actual.height)
    }
    void restart()
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
    if (watch) renderer.clock.clearInterval(watch)
    renderer.requestResize = request
  }
}
