import { describe, expect, test } from "bun:test"
import { createResizeCoordinator, type ResizeCoordinatorDeps } from "./resize-coordinator"
import { SETTLE_MS, MIN_CONTAINER_PX } from "./config"

// ---------------------------------------------------------------------------
// Fake clock + raf for deterministic testing (zero async)
// ---------------------------------------------------------------------------

function fakeClock() {
  const timers: Array<{ id: number; fn: () => void; at: number }> = []
  let now = 0
  let nextId = 1

  return {
    now: () => now,
    setTimeout(fn: () => void, ms: number) {
      const id = nextId++
      timers.push({ id, fn, at: now + ms })
      return id
    },
    clearTimeout(id: number) {
      const idx = timers.findIndex((t) => t.id === id)
      if (idx >= 0) timers.splice(idx, 1)
    },
    advance(ms: number) {
      const target = now + ms
      // Fire timers in chronological order
      while (true) {
        const next = timers
          .filter((t) => t.at <= target)
          .sort((a, b) => a.at - b.at)[0]
        if (!next) break
        now = next.at
        const idx = timers.findIndex((t) => t.id === next.id)
        if (idx >= 0) timers.splice(idx, 1)
        next.fn()
      }
      now = target
    },
    pending: () => timers.length,
  }
}

function fakeRaf() {
  const queue: Array<{ id: number; fn: () => void }> = []
  let nextId = 1

  return {
    request(fn: () => void) {
      const id = nextId++
      queue.push({ id, fn })
      return id
    },
    cancel(id: number) {
      const idx = queue.findIndex((q) => q.id === id)
      if (idx >= 0) queue.splice(idx, 1)
    },
    flush() {
      const fns = queue.splice(0)
      for (const { fn } of fns) fn()
    },
    pending: () => queue.length,
  }
}

interface Call {
  name: string
  args?: unknown[]
}

function makeDeps(overrides?: Partial<ResizeCoordinatorDeps>) {
  const calls: Call[] = []
  let cols = 80
  let rows = 24
  let width = 800
  let height = 600

  const clock = fakeClock()
  const raf = fakeRaf()

  const deps: ResizeCoordinatorDeps = {
    fit: () => { calls.push({ name: "fit" }) },
    measure: () => ({ width, height }),
    getCols: () => cols,
    getRows: () => rows,
    refresh: () => { calls.push({ name: "refresh" }) },
    notify: (c, r) => { calls.push({ name: "notify", args: [c, r] }) },
    clock,
    raf,
    ...overrides,
  }

  return {
    deps,
    calls,
    clock,
    raf,
    setCols: (c: number) => { cols = c },
    setRows: (r: number) => { rows = r },
    setSize: (w: number, h: number) => { width = w; height = h },
  }
}

// ---------------------------------------------------------------------------
// Phase 1: Core coordinator (pure logic, no DOM)
// ---------------------------------------------------------------------------

describe("createResizeCoordinator", () => {
  test("1: single request settles after SETTLE_MS", () => {
    const { deps, calls, clock } = makeDeps()
    const coord = createResizeCoordinator(deps)

    coord.request()

    // fit() not called immediately
    expect(calls.filter((c) => c.name === "fit")).toHaveLength(0)

    // Advance just under SETTLE_MS — still not fired
    clock.advance(SETTLE_MS - 1)
    expect(calls.filter((c) => c.name === "fit")).toHaveLength(0)

    // Advance to SETTLE_MS — fires
    clock.advance(1)
    expect(calls.filter((c) => c.name === "fit")).toHaveLength(1)

    coord.dispose()
  })

  test("2: rapid requests coalesce into single settle", () => {
    const { deps, calls, clock } = makeDeps()
    const coord = createResizeCoordinator(deps)

    coord.request()
    clock.advance(30)
    coord.request()
    clock.advance(30)
    coord.request()

    // Advance SETTLE_MS from last request
    clock.advance(SETTLE_MS)
    expect(calls.filter((c) => c.name === "fit")).toHaveLength(1)

    coord.dispose()
  })

  test("3: settle skips notify when dims unchanged", () => {
    const { deps, calls, clock } = makeDeps()
    // getCols/getRows return 80/24, which are the "previous" defaults
    const coord = createResizeCoordinator(deps)

    coord.request()
    clock.advance(SETTLE_MS)

    expect(calls.filter((c) => c.name === "fit")).toHaveLength(1)
    expect(calls.filter((c) => c.name === "refresh")).toHaveLength(1)
    expect(calls.filter((c) => c.name === "notify")).toHaveLength(0)

    coord.dispose()
  })

  test("4: settle calls notify when dims change", () => {
    const { deps, calls, clock, setCols, setRows } = makeDeps()
    const coord = createResizeCoordinator(deps)

    // After fit(), dims will be 120x30
    deps.fit = () => {
      calls.push({ name: "fit" })
      setCols(120)
      setRows(30)
    }

    coord.request()
    clock.advance(SETTLE_MS)

    expect(calls.filter((c) => c.name === "notify")).toHaveLength(1)
    expect(calls.find((c) => c.name === "notify")?.args).toEqual([120, 30])

    coord.dispose()
  })

  test("5: settle skips fit when container < MIN_CONTAINER_PX", () => {
    const { deps, calls, clock, setSize } = makeDeps()
    setSize(5, 5) // Below MIN_CONTAINER_PX
    const coord = createResizeCoordinator(deps)

    coord.request()
    clock.advance(SETTLE_MS)

    expect(calls.filter((c) => c.name === "fit")).toHaveLength(0)

    coord.dispose()
  })

  test("6: resize does not scroll or clear — preserves TUI viewport", () => {
    const { deps, calls, clock, raf, setCols, setRows } = makeDeps()
    const coord = createResizeCoordinator(deps)

    deps.fit = () => {
      calls.push({ name: "fit" })
      setCols(100)
      setRows(20)
    }

    coord.request()
    clock.advance(SETTLE_MS)
    raf.flush()

    // Only fit, refresh, notify — no scrollToBottom, no clear
    const callNames = calls.map((c) => c.name)
    expect(callNames).not.toContain("scrollToBottom")
    expect(callNames).not.toContain("clear")
    expect(callNames).toContain("fit")
    expect(callNames).toContain("notify")

    coord.dispose()
  })

  test("6b: calls clear() when provided and dims change", () => {
    const { deps, calls, clock, raf, setCols, setRows } = makeDeps({
      clear: () => {
        calls.push({ name: "clear" })
      },
    })
    const coord = createResizeCoordinator(deps)

    deps.fit = () => {
      calls.push({ name: "fit" })
      setCols(100)
      setRows(20)
    }

    coord.request()
    clock.advance(SETTLE_MS)
    raf.flush()

    const callNames = calls.map((c) => c.name)
    expect(callNames).toContain("fit")
    expect(callNames).toContain("clear")
    expect(callNames).toContain("notify")

    coord.dispose()
  })

  test("7: dimsChanged() reflects dimension changes", () => {
    const { deps, calls, clock, setCols, setRows } = makeDeps()
    const coord = createResizeCoordinator(deps)

    expect(coord.dimsChanged()).toBe(false)

    deps.fit = () => {
      calls.push({ name: "fit" })
      setCols(100)
      setRows(20)
    }

    coord.request()
    clock.advance(SETTLE_MS)

    expect(coord.dimsChanged()).toBe(true)

    coord.dispose()
  })

  test("8: suspend prevents settle", () => {
    const { deps, calls, clock } = makeDeps()
    const coord = createResizeCoordinator(deps)

    coord.request()
    coord.suspend()
    clock.advance(SETTLE_MS * 2)

    expect(calls.filter((c) => c.name === "fit")).toHaveLength(0)

    coord.dispose()
  })

  test("9: resume after suspend triggers settle", () => {
    const { deps, calls, clock } = makeDeps()
    const coord = createResizeCoordinator(deps)

    coord.request()
    coord.suspend()
    clock.advance(SETTLE_MS * 2)
    expect(calls.filter((c) => c.name === "fit")).toHaveLength(0)

    coord.resume()
    clock.advance(SETTLE_MS)
    expect(calls.filter((c) => c.name === "fit")).toHaveLength(1)

    coord.dispose()
  })

  test("10: flush() triggers immediate settle", () => {
    const { deps, calls } = makeDeps()
    const coord = createResizeCoordinator(deps)

    coord.request()
    coord.flush()

    expect(calls.filter((c) => c.name === "fit")).toHaveLength(1)

    coord.dispose()
  })

  test("11: dispose clears timer, prevents future settles", () => {
    const { deps, calls, clock } = makeDeps()
    const coord = createResizeCoordinator(deps)

    coord.request()
    coord.dispose()
    clock.advance(SETTLE_MS * 2)

    expect(calls.filter((c) => c.name === "fit")).toHaveLength(0)

    // Further requests are no-ops
    coord.request()
    clock.advance(SETTLE_MS * 2)
    expect(calls.filter((c) => c.name === "fit")).toHaveLength(0)
  })

  test("12: notify only called when dims actually change", () => {
    const { deps, calls, clock, setCols, setRows } = makeDeps()
    const coord = createResizeCoordinator(deps)

    // First: dims change
    deps.fit = () => {
      calls.push({ name: "fit" })
      setCols(120)
      setRows(30)
    }

    coord.request()
    clock.advance(SETTLE_MS)

    expect(calls.filter((c) => c.name === "notify")).toHaveLength(1)

    // Reset
    calls.length = 0

    // Second: dims don't change (120x30 → 120x30)
    deps.fit = () => { calls.push({ name: "fit" }) }

    coord.request()
    clock.advance(SETTLE_MS)

    expect(calls.filter((c) => c.name === "fit")).toHaveLength(1)
    expect(calls.filter((c) => c.name === "notify")).toHaveLength(0)

    coord.dispose()
  })

  // -------------------------------------------------------------------------
  // Phase 2: Multiple trigger sources coalescing
  // -------------------------------------------------------------------------

  test("13: ResizeObserver + window resize + fit event within SETTLE_MS → 1 fit", () => {
    const { deps, calls, clock } = makeDeps()
    const coord = createResizeCoordinator(deps)

    // Three different sources within SETTLE_MS
    coord.request("resize-observer")
    clock.advance(20)
    coord.request("window-resize")
    clock.advance(20)
    coord.request("fit-event")

    // All coalesce into 1 settle
    clock.advance(SETTLE_MS)
    expect(calls.filter((c) => c.name === "fit")).toHaveLength(1)

    coord.dispose()
  })

  test("14: global suspension pauses coordinator, resume drains", () => {
    const { deps, calls, clock } = makeDeps()
    const coord = createResizeCoordinator(deps)

    // Simulate dataset.terminalResizeSuspended=1
    coord.request()
    coord.suspend()
    clock.advance(SETTLE_MS * 3)
    expect(calls.filter((c) => c.name === "fit")).toHaveLength(0)

    // Simulate dataset.terminalResizeSuspended removed
    coord.resume()
    clock.advance(SETTLE_MS)
    expect(calls.filter((c) => c.name === "fit")).toHaveLength(1)

    coord.dispose()
  })

  // -------------------------------------------------------------------------
  // Phase 3: Visibility + mount triggers coalesce
  // -------------------------------------------------------------------------

  test("15: visibilitychange (hidden→visible) calls coordinator.request", () => {
    const { deps, calls, clock } = makeDeps()
    const coord = createResizeCoordinator(deps)

    // Simulate hidden→visible via coordinator
    coord.request("visibility")
    clock.advance(SETTLE_MS)

    expect(calls.filter((c) => c.name === "fit")).toHaveLength(1)

    coord.dispose()
  })

  test("16: visibilitychange when hidden does nothing (no request)", () => {
    const { deps, calls, clock } = makeDeps()
    const coord = createResizeCoordinator(deps)

    // No request made when hidden — caller checks document.hidden first
    clock.advance(SETTLE_MS * 2)

    expect(calls.filter((c) => c.name === "fit")).toHaveLength(0)

    coord.dispose()
  })

  test("17: visibilitychange + ResizeObserver within SETTLE_MS coalesce", () => {
    const { deps, calls, clock } = makeDeps()
    const coord = createResizeCoordinator(deps)

    coord.request("visibility")
    clock.advance(30)
    coord.request("resize-observer")

    clock.advance(SETTLE_MS)
    expect(calls.filter((c) => c.name === "fit")).toHaveLength(1)

    coord.dispose()
  })

  // -------------------------------------------------------------------------
  // Phase 4: Buffer restore settle-aware flush
  // -------------------------------------------------------------------------

  test("18: flush() forces immediate settle during restore", () => {
    const { deps, calls } = makeDeps()
    const coord = createResizeCoordinator(deps)

    // Simulate buffer restore: request + immediate flush
    coord.request("restore")
    coord.flush()

    // fit() called immediately without waiting SETTLE_MS
    expect(calls.filter((c) => c.name === "fit")).toHaveLength(1)
    expect(calls.filter((c) => c.name === "refresh")).toHaveLength(1)

    coord.dispose()
  })

  // -------------------------------------------------------------------------
  // Integration: terminal mount must fill available container space
  // -------------------------------------------------------------------------

  test("terminal fills container within one frame of mount — not stuck small in top-left", () => {
    // A terminal mounts in a 800×600px container (supports ~120 cols × 30 rows).
    // It must fill this space on the first animation frame (~16ms).
    // Without the eager RAF fast-path, the coordinator would wait SETTLE_MS (80ms),
    // leaving the terminal at default 80×24 — small in the top-left corner,
    // with empty space at the bottom and right.
    //
    // Fix: scheduleSettle() fires an eager RAF alongside the debounce timer.
    // The RAF settles on the next frame; the timer handles the final settle
    // after rapid events stop. Whichever fires first cancels the other.

    const { deps, calls, clock, raf, setCols, setRows } = makeDeps()

    // Container: 800×600 with space for 120 cols × 30 rows
    deps.fit = () => {
      calls.push({ name: "fit" })
      setCols(120)
      setRows(30)
    }

    const coord = createResizeCoordinator(deps)

    // === Mount sequence (what setupResizeHandlers does) ===
    coord.request("resize-observer")
    coord.request("mount")

    // === First animation frame: browser paints, RAF callbacks fire ===
    clock.advance(16)
    raf.flush()

    // Terminal fills the 800×600 container on the first frame
    const fitCount = calls.filter((c) => c.name === "fit").length
    expect(fitCount).toBeGreaterThan(0)
    expect(deps.getCols()).toBe(120)
    expect(deps.getRows()).toBe(30)

    coord.dispose()
  })

  test("19: flush() followed by request() still debounces the second", () => {
    const { deps, calls, clock } = makeDeps()
    const coord = createResizeCoordinator(deps)

    // First: immediate flush
    coord.request("restore")
    coord.flush()
    expect(calls.filter((c) => c.name === "fit")).toHaveLength(1)

    // Second: normal request should debounce
    coord.request("resize-observer")
    expect(calls.filter((c) => c.name === "fit")).toHaveLength(1) // still 1

    clock.advance(SETTLE_MS)
    expect(calls.filter((c) => c.name === "fit")).toHaveLength(2) // now 2

    coord.dispose()
  })
})
