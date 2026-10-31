import type { CliRenderer } from "@opentui/core"

// On Windows an inverted console viewport leaves the screen black, and no event
// reliably reports the recovery, so the viewport is checked on the renderer's clock.
const WATCH_MS = 500
const MAX_DIMENSION = 0xffffffff

type Size = { width: number; height: number }
type Viewport = { valid(): boolean; size(): Size | undefined; repair(alternate: boolean): void }

export function guardTerminalResize(renderer: CliRenderer, viewport: Viewport | undefined) {
  const request = renderer.requestResize
  // OpenTUI does not expose a way to force a full repaint.
  const state = renderer as unknown as { forceFullRepaintRequested: boolean }
  let broken = false

  const rebuild = () => {
    renderer.root.resize(renderer.width, renderer.height)
    state.forceFullRepaintRequested = true
    renderer.requestRender()
  }

  const check = (view: Viewport) => {
    if (!view.valid()) {
      broken = true
      return view.repair(renderer.screenMode === "alternate-screen")
    }
    if (!broken) return
    broken = false
    const actual = view.size()
    if (actual && (actual.width !== renderer.width || actual.height !== renderer.height)) {
      return request.call(renderer, actual.width, actual.height)
    }
    rebuild()
  }

  const watch = viewport && renderer.clock.setInterval(() => check(viewport), WATCH_MS)

  renderer.requestResize = (width: number, height: number) => {
    // A bogus reading (2^64) means the viewport is inverted.
    if (!(width > 0 && height > 0 && width <= MAX_DIMENSION && height <= MAX_DIMENSION)) {
      if (viewport) check(viewport)
      return
    }
    // After a repair, a same-size resize must still reach OpenTUI (it replaces any
    // pending resize), and then the layout is rebuilt.
    if (broken && width === renderer.width && height === renderer.height) {
      broken = false
      request.call(renderer, width, height)
      return rebuild()
    }
    broken = false
    return request.call(renderer, width, height)
  }

  return () => {
    if (watch) renderer.clock.clearInterval(watch)
    renderer.requestResize = request
  }
}
