import { SETTLE_MS, MIN_CONTAINER_PX } from "./config"

export interface ResizeCoordinatorDeps {
  fit: () => void
  measure: () => { width: number; height: number }
  getCols: () => number
  getRows: () => number
  refresh: () => void
  notify: (cols: number, rows: number) => void
  clock: {
    setTimeout: (fn: () => void, ms: number) => number
    clearTimeout: (id: number) => void
  }
  raf: {
    request: (fn: () => void) => number
    cancel: (id: number) => void
  }
}

export interface ResizeCoordinator {
  request(source?: string): void
  flush(): void
  suspend(): void
  resume(): void
  dimsChanged(): boolean
  dispose(): void
}

export function createResizeCoordinator(deps: ResizeCoordinatorDeps): ResizeCoordinator {
  let timerId: number | undefined
  let eagerRafId: number | undefined
  let suspended = false
  let disposed = false
  let pendingWhileSuspended = false
  let lastCols = deps.getCols()
  let lastRows = deps.getRows()
  let _dimsChanged = false

  function settle() {
    // Clear both schedulers — whichever fires first cancels the other
    if (timerId !== undefined) {
      deps.clock.clearTimeout(timerId)
      timerId = undefined
    }
    if (eagerRafId !== undefined) {
      deps.raf.cancel(eagerRafId)
      eagerRafId = undefined
    }

    if (disposed) return
    if (suspended) {
      pendingWhileSuspended = true
      return
    }

    const { width, height } = deps.measure()
    if (width < MIN_CONTAINER_PX || height < MIN_CONTAINER_PX) {
      return
    }

    try {
      deps.fit()
    } catch {
      return
    }

    try {
      deps.refresh()
    } catch {}

    const newCols = deps.getCols()
    const newRows = deps.getRows()
    _dimsChanged = newCols !== lastCols || newRows !== lastRows

    if (_dimsChanged) {
      lastCols = newCols
      lastRows = newRows
      deps.notify(newCols, newRows)
    }
  }

  function scheduleSettle() {
    if (disposed) return

    // Debounce timer: always reset on each request
    if (timerId !== undefined) {
      deps.clock.clearTimeout(timerId)
    }
    timerId = deps.clock.setTimeout(settle, SETTLE_MS)

    // Eager RAF: fire settle on the next animation frame (first-frame fast path).
    // Only one RAF per batch — subsequent requests just reset the debounce timer.
    // This mirrors the old schedule() behavior: RAF gives ~16ms first fit,
    // timer gives SETTLE_MS final settle after rapid events stop.
    if (eagerRafId === undefined) {
      eagerRafId = deps.raf.request(settle)
    }
  }

  return {
    request(_source?: string) {
      if (disposed) return
      if (suspended) {
        pendingWhileSuspended = true
        return
      }
      scheduleSettle()
    },

    flush() {
      if (disposed) return
      settle()
    },

    suspend() {
      suspended = true
      if (timerId !== undefined) {
        deps.clock.clearTimeout(timerId)
        timerId = undefined
        pendingWhileSuspended = true
      }
      if (eagerRafId !== undefined) {
        deps.raf.cancel(eagerRafId)
        eagerRafId = undefined
        pendingWhileSuspended = true
      }
    },

    resume() {
      suspended = false
      if (pendingWhileSuspended) {
        pendingWhileSuspended = false
        scheduleSettle()
      }
    },

    dimsChanged() {
      return _dimsChanged
    },

    dispose() {
      disposed = true
      if (timerId !== undefined) {
        deps.clock.clearTimeout(timerId)
        timerId = undefined
      }
      if (eagerRafId !== undefined) {
        deps.raf.cancel(eagerRafId)
        eagerRafId = undefined
      }
    },
  }
}
