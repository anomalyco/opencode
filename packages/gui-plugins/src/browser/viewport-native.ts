import type { PaneEvent, Viewport } from "./ipc"
import { viewportScale } from "./viewport-layout"

type Preview = Pick<Extract<PaneEvent, { type: "page" }>, "viewport" | "viewportNotice"> & { scale: number }

type Size = { width: number; height: number }

const AUTO: Preview = { viewport: { mode: "auto" }, scale: 1 }

function preview(viewport: Viewport, bounds: Size, zoom: number): Preview {
  // Each request needs a distinct identity, including Auto → Fixed → Auto.
  if (viewport.mode === "auto") return { ...AUTO }

  if (zoom !== 1) return { ...AUTO, viewportNotice: "zoom" }

  return { viewport, scale: viewportScale(viewport, bounds) }
}

function same(a: Preview, b: Preview) {
  if (a.scale !== b.scale || a.viewportNotice !== b.viewportNotice) return false

  if (a.viewport.mode === "auto" || b.viewport.mode === "auto") return a.viewport.mode === b.viewport.mode

  return (
    a.viewport.width === b.viewport.width &&
    a.viewport.height === b.viewport.height &&
    a.viewport.preset === b.viewport.preset &&
    a.viewport.scale === b.viewport.scale
  )
}

/** A page has one metrics writer. Captures share its queue: CDP temporarily sets and restores metrics for a clip. */
export function createViewportWriter(
  apply: (next: Preview) => Promise<void>,
  changed: () => void,
  closed: () => boolean,
) {
  let requested = AUTO
  let applied = AUTO
  let queue = Promise.resolve()
  let writing = queue

  function exclusive<T>(action: () => Promise<T>) {
    const result = queue.then(action)
    queue = result.then(
      () => undefined,
      () => undefined,
    )

    return result
  }

  return {
    requested: () => requested.viewport,
    applied: () => applied,
    settled: () => queue,
    exclusive,
    set(viewport: Viewport, bounds: Size, zoom: number) {
      const next = preview(viewport, bounds, zoom)

      if (same(requested, next)) return writing
      requested = next

      writing = exclusive(async () => {
        if (closed()) throw new Error("browser.pane.unavailable")

        if (requested !== next) return

        try {
          await apply(next)
          applied = next
        } catch (error) {
          if (closed() || requested !== next) throw error
          const fallback: Preview = { ...AUTO, viewportNotice: "failed" }

          // A rejected override can have changed the renderer. Confirm the clear before reporting Auto.
          try {
            await apply(fallback)
            applied = fallback
          } catch {
            applied = { ...applied, viewportNotice: "failed" }
          }

          if (requested === next) {
            requested = applied

            if (!closed()) changed()
          }

          throw error
        }

        if (!closed() && requested === applied) changed()
      })

      return writing
    },
  }
}
