import type { CliRenderer } from "@opentui/core"

// On Windows an inverted console viewport leaves the screen black, and no event
// reliably reports the recovery, so the viewport is checked on a timer.
const WATCH_MS = 500
const MAX_DIMENSION = 0xffffffff

type Size = { width: number; height: number }
type Viewport = { valid(): boolean; size(): Size | undefined; repair(): void }

export function guardTerminalResize(renderer: CliRenderer, viewport: Viewport | undefined) {
  const request = renderer.requestResize
  const state = renderer as unknown as {
    _terminalWidth: number
    _terminalHeight: number
    forceFullRepaintRequested: boolean
  }
  let broken = false

  const rebuild = () => {
    renderer.root.resize(renderer.width, renderer.height)
    state.forceFullRepaintRequested = true
    renderer.requestRender()
  }

  const check = (view: Viewport) => {
    if (!view.valid()) {
      broken = true
      return view.repair()
    }
    if (!broken) return
    broken = false
    const actual = view.size()
    if (actual && (actual.width !== state._terminalWidth || actual.height !== state._terminalHeight)) {
      return request.call(renderer, actual.width, actual.height)
    }
    rebuild()
  }

  const watch = viewport && setInterval(() => check(viewport), WATCH_MS)
  watch?.unref?.()

  renderer.requestResize = (width: number, height: number) => {
    // A bogus reading (2^64) means the viewport is inverted.
    if (!(width > 0 && height > 0 && width <= MAX_DIMENSION && height <= MAX_DIMENSION)) {
      if (viewport) check(viewport)
      return
    }
    broken = false
    // Forward the same size too: it replaces any resize still pending in OpenTUI.
    if (width === state._terminalWidth && height === state._terminalHeight) {
      request.call(renderer, width, height)
      return rebuild()
    }
    return request.call(renderer, width, height)
  }

  return () => {
    if (watch) clearInterval(watch)
    renderer.requestResize = request
  }
}

