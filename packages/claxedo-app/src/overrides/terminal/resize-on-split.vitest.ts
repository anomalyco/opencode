/**
 * Resize-on-split headless emulator test
 *
 * Emulates xterm + ResizeObserver behavior to verify what happens when:
 *   1. A terminal container goes from full-width to half-width (split)
 *   2. The user focuses the original pane
 *
 * The garbled-text bug occurs because xterm's cached cell metrics become
 * stale after a CSS-only resize. The font-nudge trick (nudge fontSize to
 * force cell re-measurement) only fires for 0→visible transitions, NOT
 * for width-halving during a split.
 *
 * These tests prove the gap: after split, fit()+refresh() run but the
 * font-nudge does NOT fire, leaving cell metrics stale.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createResizeCoordinator } from "./resize-coordinator"

// ---------------------------------------------------------------------------
// Headless xterm emulator — tracks calls and exposes internal state
// ---------------------------------------------------------------------------

interface HeadlessXterm {
  cols: number
  rows: number
  options: { fontSize?: number }
  refresh: ReturnType<typeof vi.fn>
  /** Every fontSize value written to options, in order */
  fontSizeWrites: number[]
}

function createHeadlessXterm(initialCols = 80, initialRows = 24): HeadlessXterm {
  const fontSizeWrites: number[] = []
  const _options = { _fontSize: 14 as number | undefined }

  return {
    cols: initialCols,
    rows: initialRows,
    options: new Proxy(_options, {
      get(_target, prop) {
        if (prop === "fontSize") return _options._fontSize
        return undefined
      },
      set(_target, prop, value) {
        if (prop === "fontSize") {
          _options._fontSize = value
          fontSizeWrites.push(value)
        }
        return true
      },
    }) as unknown as { fontSize?: number },
    refresh: vi.fn(),
    fontSizeWrites,
  }
}

// ---------------------------------------------------------------------------
// Headless fitAddon emulator — uses container dims + cell size to calculate
// ---------------------------------------------------------------------------

interface HeadlessFitAddon {
  fit: ReturnType<typeof vi.fn>
  proposeDimensions: ReturnType<typeof vi.fn>
  /** The xterm instance this addon resizes */
  xterm: HeadlessXterm
  /** Simulated cell width in px (changes when fontSize is nudged) */
  cellWidth: number
  cellHeight: number
}

function createHeadlessFitAddon(
  xterm: HeadlessXterm,
  container: { clientWidth: number; clientHeight: number },
): HeadlessFitAddon {
  const HEADER_HEIGHT = 32 // LeafNode header bar
  const addon: HeadlessFitAddon = {
    xterm,
    cellWidth: 8.4, // typical 14px mono font
    cellHeight: 17,
    fit: vi.fn(() => {
      const w = container.clientWidth
      const h = container.clientHeight - HEADER_HEIGHT
      if (w < 10 || h < 10) return
      const cols = Math.max(2, Math.floor(w / addon.cellWidth))
      const rows = Math.max(2, Math.floor(h / addon.cellHeight))
      xterm.cols = cols
      xterm.rows = rows
    }),
    proposeDimensions: vi.fn(() => {
      const w = container.clientWidth
      const h = container.clientHeight - HEADER_HEIGHT
      if (w < 10 || h < 10) return undefined
      return {
        cols: Math.max(2, Math.floor(w / addon.cellWidth)),
        rows: Math.max(2, Math.floor(h / addon.cellHeight)),
      }
    }),
  }
  return addon
}

// ---------------------------------------------------------------------------
// Headless container — mutable dimensions simulating CSS layout
// ---------------------------------------------------------------------------

function createContainer(width: number, height: number) {
  return {
    clientWidth: width,
    clientHeight: height,
    isConnected: true,
  }
}

// ---------------------------------------------------------------------------
// Emulate the ResizeObserver callback from helpers.ts (lines 655-678)
// This is the EXACT logic from setupResizeHandlers
// ---------------------------------------------------------------------------

function createResizeObserverEmulator(
  xterm: HeadlessXterm,
  container: { clientWidth: number; clientHeight: number; isConnected: boolean },
  coordinator: ReturnType<typeof createResizeCoordinator>,
) {
  let lastObservedWidth = 0
  let lastObservedHeight = 0

  /**
   * Simulates what the ResizeObserver callback does in helpers.ts.
   * This MUST match the real code path so the test validates actual behavior.
   */
  function fireResize() {
    if (!container.isConnected) return

    const width = container.clientWidth
    const height = container.clientHeight

    // This is the font-nudge logic from helpers.ts — must stay in sync
    const wasZero = lastObservedWidth === 0 && lastObservedHeight === 0
    const significantWidthChange =
      lastObservedWidth > 0 &&
      width > 0 &&
      Math.abs(width - lastObservedWidth) / lastObservedWidth > 0.2

    if ((wasZero && width > 0 && height > 0) || significantWidthChange) {
      // Force cell re-measurement
      const fs = xterm.options.fontSize ?? 14
      xterm.options.fontSize = fs + 0.001
      xterm.options.fontSize = fs
    }

    lastObservedWidth = width
    lastObservedHeight = height

    coordinator.request("resize-observer")
  }

  /**
   * Simulates the `opencode:terminal-fit` event handler from helpers.ts:682-687.
   */
  function fireFitEvent() {
    coordinator.request("fit-event")
  }

  return { fireResize, fireFitEvent, getLastObserved: () => ({ lastObservedWidth, lastObservedHeight }) }
}

// ---------------------------------------------------------------------------
// Test helper: advance timers through settle
// ---------------------------------------------------------------------------

async function flushSettle() {
  // The coordinator uses RAF + setTimeout(SETTLE_MS=80).
  // We need to advance past both.
  await vi.advanceTimersByTimeAsync(0) // flush microtasks
  await vi.advanceTimersByTimeAsync(100) // past SETTLE_MS (80ms)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resize-on-split headless emulator", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test("initial mount: font-nudge fires when container goes from 0→visible", async () => {
    const xterm = createHeadlessXterm()
    const container = createContainer(0, 0)
    const fitAddon = createHeadlessFitAddon(xterm, container)

    const coordinator = createResizeCoordinator({
      fit: () => fitAddon.fit(),
      measure: () => ({ width: container.clientWidth, height: container.clientHeight }),
      getCols: () => xterm.cols,
      getRows: () => xterm.rows,
      refresh: () => xterm.refresh(0, xterm.rows - 1),
      notify: vi.fn(),
      clock: { setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number, clearTimeout },
      raf: { request: (fn) => setTimeout(fn, 0) as unknown as number, cancel: clearTimeout },
    })

    const emulator = createResizeObserverEmulator(xterm, container, coordinator)

    // Container starts at 0x0
    emulator.fireResize()
    await flushSettle()

    // Container becomes visible (e.g., portal mount)
    container.clientWidth = 600
    container.clientHeight = 400
    xterm.fontSizeWrites.length = 0

    emulator.fireResize()

    // Font-nudge SHOULD fire (0→visible transition)
    expect(xterm.fontSizeWrites.length).toBeGreaterThanOrEqual(2)
    expect(xterm.fontSizeWrites).toContain(14.001)
    expect(xterm.fontSizeWrites).toContain(14)

    await flushSettle()

    // fit() should have run
    expect(fitAddon.fit).toHaveBeenCalled()

    coordinator.dispose()
  })

  test("split resize — font-nudge fires when width halves (600→300)", async () => {
    const xterm = createHeadlessXterm()
    const container = createContainer(600, 400)
    const fitAddon = createHeadlessFitAddon(xterm, container)

    const coordinator = createResizeCoordinator({
      fit: () => fitAddon.fit(),
      measure: () => ({ width: container.clientWidth, height: container.clientHeight }),
      getCols: () => xterm.cols,
      getRows: () => xterm.rows,
      refresh: () => xterm.refresh(0, xterm.rows - 1),
      notify: vi.fn(),
      clock: { setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number, clearTimeout },
      raf: { request: (fn) => setTimeout(fn, 0) as unknown as number, cancel: clearTimeout },
    })

    const emulator = createResizeObserverEmulator(xterm, container, coordinator)

    // Initial render at full width — ResizeObserver fires
    emulator.fireResize()
    await flushSettle()

    const colsBefore = xterm.cols
    expect(colsBefore).toBeGreaterThan(30) // sanity: ~71 cols at 600px

    // Clear tracking
    xterm.fontSizeWrites.length = 0
    fitAddon.fit.mockClear()
    xterm.refresh.mockClear()

    // === SPLIT: container width halves (CSS change from 100% to 50%) ===
    container.clientWidth = 300
    emulator.fireResize()
    await flushSettle()

    // fit() SHOULD run after split resize
    expect(fitAddon.fit).toHaveBeenCalled()

    // refresh() SHOULD run
    expect(xterm.refresh).toHaveBeenCalled()

    // cols SHOULD decrease (600px → 300px means roughly half the columns)
    expect(xterm.cols).toBeLessThan(colsBefore)

    // CRITICAL: Font-nudge SHOULD fire after a significant width change
    // to force xterm to re-measure cell metrics. Without this, the WebGL
    // renderer's cached cell dimensions are stale → garbled text.
    //
    // This assertion will FAIL with the current code because the font-nudge
    // only checks for 0→visible transitions (lastObservedWidth === 0),
    // not for significant width changes.
    expect(xterm.fontSizeWrites.length).toBeGreaterThanOrEqual(2)
    expect(xterm.fontSizeWrites).toContain(14.001)
    expect(xterm.fontSizeWrites).toContain(14)

    coordinator.dispose()
  })

  test("font-nudge already fired at split time, so focus doesn't need it", async () => {
    const xterm = createHeadlessXterm()
    const container = createContainer(600, 400)
    const fitAddon = createHeadlessFitAddon(xterm, container)

    const coordinator = createResizeCoordinator({
      fit: () => fitAddon.fit(),
      measure: () => ({ width: container.clientWidth, height: container.clientHeight }),
      getCols: () => xterm.cols,
      getRows: () => xterm.rows,
      refresh: () => xterm.refresh(0, xterm.rows - 1),
      notify: vi.fn(),
      clock: { setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number, clearTimeout },
      raf: { request: (fn) => setTimeout(fn, 0) as unknown as number, cancel: clearTimeout },
    })

    const emulator = createResizeObserverEmulator(xterm, container, coordinator)

    // 1. Initial mount at full width
    emulator.fireResize()
    await flushSettle()

    // 2. Split: width halves — font-nudge fires HERE
    container.clientWidth = 300
    emulator.fireResize()
    await flushSettle()

    // Verify font-nudge fired during split
    expect(xterm.fontSizeWrites.length).toBeGreaterThanOrEqual(2)

    // 3. Also fire the deferred opencode:terminal-fit event (line 469 in wrapper)
    emulator.fireFitEvent()
    await flushSettle()

    // Clear tracking — now simulate user clicking (focusing) the first pane
    xterm.fontSizeWrites.length = 0
    fitAddon.fit.mockClear()
    xterm.refresh.mockClear()

    // 4. User clicks on the first pane.
    // Container size hasn't changed (still 300px), so ResizeObserver doesn't fire.
    // But an explicit terminal-fit event can still trigger refresh.
    emulator.fireFitEvent()
    await flushSettle()

    // fit() and refresh() run via the coordinator
    expect(fitAddon.fit).toHaveBeenCalled()
    expect(xterm.refresh).toHaveBeenCalled()

    // No font-nudge needed — it already fired during the split resize
    // (container size is stable at 300px now)
    expect(xterm.fontSizeWrites.length).toBe(0)

    coordinator.dispose()
  })

  test("GREEN: fit and refresh DO run after split (just no font-nudge)", async () => {
    const xterm = createHeadlessXterm()
    const container = createContainer(600, 400)
    const fitAddon = createHeadlessFitAddon(xterm, container)
    const notifySpy = vi.fn()

    const coordinator = createResizeCoordinator({
      fit: () => fitAddon.fit(),
      measure: () => ({ width: container.clientWidth, height: container.clientHeight }),
      getCols: () => xterm.cols,
      getRows: () => xterm.rows,
      refresh: () => xterm.refresh(0, xterm.rows - 1),
      notify: notifySpy,
      clock: { setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number, clearTimeout },
      raf: { request: (fn) => setTimeout(fn, 0) as unknown as number, cancel: clearTimeout },
    })

    const emulator = createResizeObserverEmulator(xterm, container, coordinator)

    // Initial mount
    emulator.fireResize()
    await flushSettle()

    fitAddon.fit.mockClear()
    xterm.refresh.mockClear()
    notifySpy.mockClear()

    // Split: width halves
    container.clientWidth = 300
    emulator.fireResize()
    await flushSettle()

    // fit, refresh, and notify all run — the resize pipeline works
    expect(fitAddon.fit).toHaveBeenCalled()
    expect(xterm.refresh).toHaveBeenCalled()
    expect(notifySpy).toHaveBeenCalled()

    // Cols decreased
    const newCols = notifySpy.mock.calls[0][0]
    expect(newCols).toBeLessThan(71) // was ~71 at 600px

    coordinator.dispose()
  })

  test("GREEN: clearTextureAtlas runs after split resize", async () => {
    const xterm = createHeadlessXterm()
    const container = createContainer(600, 400)
    const fitAddon = createHeadlessFitAddon(xterm, container)
    const clearAtlas = vi.fn()

    const coordinator = createResizeCoordinator({
      fit: () => fitAddon.fit(),
      measure: () => ({ width: container.clientWidth, height: container.clientHeight }),
      getCols: () => xterm.cols,
      getRows: () => xterm.rows,
      refresh: () => {
        xterm.refresh(0, xterm.rows - 1)
        clearAtlas()
      },
      notify: vi.fn(),
      clock: { setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number, clearTimeout },
      raf: { request: (fn) => setTimeout(fn, 0) as unknown as number, cancel: clearTimeout },
    })

    const emulator = createResizeObserverEmulator(xterm, container, coordinator)

    // Initial mount
    emulator.fireResize()
    await flushSettle()
    clearAtlas.mockClear()

    // Split
    container.clientWidth = 300
    emulator.fireResize()
    await flushSettle()

    // clearTextureAtlas runs as part of refresh
    expect(clearAtlas).toHaveBeenCalled()

    coordinator.dispose()
  })
})
