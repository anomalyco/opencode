/**
 * Regression test: Floating sidebar hangs (does not collapse)
 *
 * Bug: The sidebar appears as a floating panel when the mouse moves past the
 * left edge (hot zone), but it doesn't go away when the mouse moves away from it.
 *
 * Root cause #1 (lock/unlock): When a dropdown menu is open (rail is "locked"),
 * handleMouseLeave() returns early. After the dropdown closes (unlock()), nothing
 * re-triggers collapse.
 *
 * Root cause #2 (pointer-events): When the sidebar is collapsed, the nav element
 * has `pointer-events: none`. Hot zone detection uses document-level `mousemove`.
 * When expansion triggers, `pointer-events` transitions to `auto` while the mouse
 * is already over the element. The browser does NOT fire `mouseenter` (no boundary
 * crossing). When the mouse later moves away, `mouseleave` doesn't fire either
 * (no prior `mouseenter`). So `handleMouseLeave()` is never called.
 *
 * Fix: The document-level mousemove handler must also detect mouse-outside-rail
 * when the sidebar is expanded and floating. The rail context exposes a
 * `trackPosition(clientX, railRight)` method that handles both hot zone detection
 * AND floating collapse via a unified position check.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { ensureLayoutMocked, getInitLayout } from "./_test-helper"

// Ensure window.setTimeout is available in test environment
if (typeof globalThis.window === "undefined") {
  ;(globalThis as any).window = globalThis
}

let initLayout: () => any

beforeAll(async () => {
  await ensureLayoutMocked()
  initLayout = getInitLayout()
})

function createTestLayout() {
  let dispose!: () => void
  const api = createRoot((d) => {
    dispose = d
    return initLayout()
  })
  return { api, dispose }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// EXPAND_DELAY_MS and COLLAPSE_DELAY_MS are both 100ms in the source.
// Wait a bit longer to guarantee the timer has fired.
const TIMER_WAIT = 150

// Rail bounding rect for tests — sidebar starts at top-7 (28px), extends to bottom
const RAIL_RECT_COLLAPSED = { top: 28, right: 56, bottom: 800 }
const RAIL_RECT_EXPANDED = { top: 28, right: 260, bottom: 800 }
const MID_Y = 400 // Y coordinate safely within rail vertical bounds

// ---------------------------------------------------------------------------
// Baseline: normal expand/collapse flow
// ---------------------------------------------------------------------------

describe("rail sidebar: normal expand/collapse flow", () => {
  test("sidebar is initially collapsed and not pinned", () => {
    const { api, dispose } = createTestLayout()
    try {
      expect(api.rail.collapsed()).toBe(true)
      expect(api.rail.pinned()).toBe(false)
      expect(api.rail.hovered()).toBe(false)
      expect(api.rail.locked()).toBe(false)
    } finally {
      dispose()
    }
  })

  test("hot zone enter sets hovered immediately and expands after delay", async () => {
    const { api, dispose } = createTestLayout()
    try {
      api.rail.handleHotZoneEnter()

      // hovered is set synchronously
      expect(api.rail.hovered()).toBe(true)
      // collapsed is still true until the timer fires
      expect(api.rail.collapsed()).toBe(true)

      await sleep(TIMER_WAIT)

      // Now expanded
      expect(api.rail.collapsed()).toBe(false)
    } finally {
      dispose()
    }
  })

  test("mouse leave collapses the sidebar after delay", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // Expand
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // Mouse leaves
      api.rail.handleMouseLeave()
      await sleep(TIMER_WAIT)

      // Collapsed again
      expect(api.rail.collapsed()).toBe(true)
      expect(api.rail.hovered()).toBe(false)
    } finally {
      dispose()
    }
  })

  test("mouse leave before expand timer fires cancels expansion", async () => {
    const { api, dispose } = createTestLayout()
    try {
      api.rail.handleHotZoneEnter()
      expect(api.rail.hovered()).toBe(true)

      // Leave immediately — before the 100ms expand delay
      api.rail.handleMouseLeave()

      await sleep(TIMER_WAIT)

      // Expand was cancelled, collapse was scheduled and fired
      expect(api.rail.collapsed()).toBe(true)
      expect(api.rail.hovered()).toBe(false)
    } finally {
      dispose()
    }
  })

  test("cancel collapse prevents collapse when mouse re-enters during delay", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // Expand
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // Start leaving
      api.rail.handleMouseLeave()

      // Re-enter within the 100ms collapse delay
      await sleep(30)
      api.rail.cancelCollapse()

      // Wait past the original collapse timer
      await sleep(TIMER_WAIT)

      // Still expanded
      expect(api.rail.collapsed()).toBe(false)
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// Pinned sidebar
// ---------------------------------------------------------------------------

describe("rail sidebar: pinned ignores hover events", () => {
  test("pinned sidebar ignores handleHotZoneEnter and handleMouseLeave", async () => {
    const { api, dispose } = createTestLayout()
    try {
      api.rail.pin()
      expect(api.rail.pinned()).toBe(true)
      expect(api.rail.collapsed()).toBe(false)

      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)

      api.rail.handleMouseLeave()
      await sleep(TIMER_WAIT)

      // Still expanded (pinned)
      expect(api.rail.collapsed()).toBe(false)
      expect(api.rail.pinned()).toBe(true)
    } finally {
      dispose()
    }
  })

  test("toggle pin then unpin collapses the sidebar", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.rail.toggle()
      expect(api.rail.pinned()).toBe(true)
      expect(api.rail.collapsed()).toBe(false)

      api.rail.toggle()
      expect(api.rail.pinned()).toBe(false)
      expect(api.rail.collapsed()).toBe(true)
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// Cooldown after left-edge exit
// ---------------------------------------------------------------------------

describe("rail sidebar: cooldown after left-edge exit", () => {
  test("collapsing with mouse at left edge sets cooldown preventing re-expand", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // Expand
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // Mouse leaves to the left edge (clientX=5, within HOT_ZONE_WIDTH=12)
      api.rail.handleMouseLeave({ clientX: 5 } as MouseEvent)
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(true)

      // Immediately attempt re-expand — should be blocked by 500ms cooldown
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(true)
    } finally {
      dispose()
    }
  })

  test("cooldown expires and re-expand is allowed after 500ms", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // Expand
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // Collapse from left edge
      api.rail.handleMouseLeave({ clientX: 5 } as MouseEvent)
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(true)

      // Wait for cooldown to expire (500ms)
      await sleep(550)

      // Now re-expand should work
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// Lock/unlock and dropdown interaction
// ---------------------------------------------------------------------------

describe("rail sidebar: lock prevents collapse while dropdown is open", () => {
  test("handleMouseLeave is no-op while locked", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // Expand
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // Open dropdown → lock
      api.rail.lock()
      expect(api.rail.locked()).toBe(true)

      // Mouse leave while locked
      api.rail.handleMouseLeave()
      await sleep(TIMER_WAIT)

      // Still expanded — correctly prevented by lock
      expect(api.rail.collapsed()).toBe(false)
    } finally {
      dispose()
    }
  })

  test("lock during collapse delay prevents collapse in timer callback", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // Expand
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // Mouse leaves → collapse scheduled
      api.rail.handleMouseLeave()

      // Dropdown opens mid-delay → lock
      await sleep(30)
      api.rail.lock()

      // Wait for collapse timer to fire
      await sleep(TIMER_WAIT)

      // Timer callback found locked=true → skipped collapse
      expect(api.rail.collapsed()).toBe(false)
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// REGRESSION: sidebar hangs after unlock (the actual bug)
// ---------------------------------------------------------------------------

describe("regression: sidebar hangs after unlock when mouse already left", () => {
  test("sidebar should collapse after unlock when mouse left during lock", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // 1. Expand the sidebar via hot zone
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // 2. Open a dropdown menu → lock
      api.rail.lock()

      // 3. Mouse leaves the rail while locked — handleMouseLeave returns early
      api.rail.handleMouseLeave()
      await sleep(TIMER_WAIT)

      // Rail is still expanded (correctly, because locked)
      expect(api.rail.collapsed()).toBe(false)

      // 4. Dropdown closes → unlock
      api.rail.unlock()

      // 5. Wait for any collapse that should be triggered by unlock
      await sleep(TIMER_WAIT)

      // The sidebar should now be collapsed because:
      //   - The mouse already left the rail
      //   - The dropdown is closed
      //   - Nothing is keeping it open
      // Regression: unlock() only sets locked=false without re-triggering collapse,
      // which previously caused the sidebar to stay expanded forever (the "hang").
      expect(api.rail.collapsed()).toBe(true)
    } finally {
      dispose()
    }
  })

  test("sidebar should collapse after unlock when lock happened during collapse delay", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // 1. Expand
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // 2. Mouse leaves → collapse timer scheduled (100ms)
      api.rail.handleMouseLeave()

      // 3. Dropdown opens during the delay → lock
      await sleep(30)
      api.rail.lock()

      // 4. Collapse timer fires but bails because locked
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // 5. Dropdown closes → unlock
      api.rail.unlock()
      await sleep(TIMER_WAIT)

      // Same issue as above — the collapse timer already fired and bailed,
      // unlock doesn't schedule a new one, causing the sidebar to stay expanded.
      // This test verifies the fix works correctly.
      expect(api.rail.collapsed()).toBe(true)
    } finally {
      dispose()
    }
  })

  test("workaround: sidebar collapses if user triggers a new mouse-leave after unlock", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // Reproduce the hang
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      api.rail.lock()
      api.rail.handleMouseLeave()
      await sleep(TIMER_WAIT)
      api.rail.unlock()
      await sleep(TIMER_WAIT)

      // Sidebar is still expanded (the hang)
      // User discovers they need to move mouse back INTO the rail and out again
      // to trigger a new mouseleave event
      api.rail.cancelCollapse() // mouseenter
      api.rail.handleMouseLeave() // mouseleave
      await sleep(TIMER_WAIT)

      // Now it collapses — but the user had to "jiggle" the mouse
      expect(api.rail.collapsed()).toBe(true)
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// REGRESSION: sidebar hangs due to pointer-events transition
// (onMouseLeave never fires because onMouseEnter never fired)
//
// The document-level `handleMouseMove` must detect mouse-outside-rail when
// the sidebar is floating. The context provides `rail.trackPosition()` for
// this — a unified method that the component calls on every document mousemove
// with the current cursor X and the rail's right edge.
// ---------------------------------------------------------------------------

describe("regression: trackPosition handles both hot zone and floating collapse", () => {
  test("rail exposes trackPosition method", () => {
    const { api, dispose } = createTestLayout()
    try {
      expect(typeof api.rail.trackPosition).toBe("function")
    } finally {
      dispose()
    }
  })

  test("trackPosition triggers hot zone enter when collapsed and mouse in hot zone", async () => {
    const { api, dispose } = createTestLayout()
    try {
      expect(api.rail.collapsed()).toBe(true)

      // Mouse at X=5, rail collapsed (right edge irrelevant, but pass collapsed width)
      api.rail.trackPosition(5, MID_Y, RAIL_RECT_COLLAPSED)
      await sleep(TIMER_WAIT)

      expect(api.rail.collapsed()).toBe(false)
    } finally {
      dispose()
    }
  })

  test("trackPosition does nothing when collapsed and mouse outside hot zone", async () => {
    const { api, dispose } = createTestLayout()
    try {
      expect(api.rail.collapsed()).toBe(true)

      // Mouse at X=100, well past hot zone (12px)
      api.rail.trackPosition(100, MID_Y, RAIL_RECT_COLLAPSED)
      await sleep(TIMER_WAIT)

      expect(api.rail.collapsed()).toBe(true)
    } finally {
      dispose()
    }
  })

  test("trackPosition triggers collapse when expanded and mouse past rail right edge", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // Expand
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // Mouse at X=300, rail right edge at 260
      api.rail.trackPosition(300, MID_Y, RAIL_RECT_EXPANDED)
      await sleep(TIMER_WAIT)

      expect(api.rail.collapsed()).toBe(true)
    } finally {
      dispose()
    }
  })

  test("trackPosition cancels collapse when mouse moves back inside rail", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // Expand
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // Mouse outside → collapse scheduled
      api.rail.trackPosition(300, MID_Y, RAIL_RECT_EXPANDED)

      // Mouse back inside before collapse fires
      await sleep(30)
      api.rail.trackPosition(100, MID_Y, RAIL_RECT_EXPANDED)
      await sleep(TIMER_WAIT)

      // Should still be expanded — collapse was cancelled
      expect(api.rail.collapsed()).toBe(false)
    } finally {
      dispose()
    }
  })

  test("trackPosition does not collapse when pinned", async () => {
    const { api, dispose } = createTestLayout()
    try {
      api.rail.pin()
      expect(api.rail.collapsed()).toBe(false)

      // Mouse way outside rail
      api.rail.trackPosition(500, MID_Y, RAIL_RECT_EXPANDED)
      await sleep(TIMER_WAIT)

      // Still expanded (pinned)
      expect(api.rail.collapsed()).toBe(false)
    } finally {
      dispose()
    }
  })

  test("trackPosition does not collapse when locked (dropdown open)", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // Expand then lock
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      api.rail.lock()

      // Mouse outside rail while locked
      api.rail.trackPosition(300, MID_Y, RAIL_RECT_EXPANDED)
      await sleep(TIMER_WAIT)

      // Still expanded
      expect(api.rail.collapsed()).toBe(false)
    } finally {
      dispose()
    }
  })

  test("trackPosition is idempotent — repeated calls outside rail do not stack timers", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // Expand
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // Simulate rapid mousemove events all outside the rail
      api.rail.trackPosition(300, MID_Y, RAIL_RECT_EXPANDED)
      api.rail.trackPosition(310, MID_Y, RAIL_RECT_EXPANDED)
      api.rail.trackPosition(320, MID_Y, RAIL_RECT_EXPANDED)
      api.rail.trackPosition(350, MID_Y, RAIL_RECT_EXPANDED)
      await sleep(TIMER_WAIT)

      // Should collapse exactly once, no issues
      expect(api.rail.collapsed()).toBe(true)
    } finally {
      dispose()
    }
  })

  test("full cycle via trackPosition: hot zone → expand → outside → collapse", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // 1. Mouse in hot zone (collapsed) → expand
      api.rail.trackPosition(5, MID_Y, RAIL_RECT_COLLAPSED)
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // 2. Mouse inside expanded rail → no collapse
      api.rail.trackPosition(100, MID_Y, RAIL_RECT_EXPANDED)
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // 3. Mouse moves outside rail → collapse
      api.rail.trackPosition(300, MID_Y, RAIL_RECT_EXPANDED)
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(true)

      // 4. Mouse still at X=300 after collapse → stays collapsed (X > hot zone)
      api.rail.trackPosition(300, MID_Y, RAIL_RECT_COLLAPSED)
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(true)
    } finally {
      dispose()
    }
  })

  test("full cycle: expand → outside → collapse → hot zone → re-expand → outside → collapse", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // First cycle
      api.rail.trackPosition(5, MID_Y, RAIL_RECT_COLLAPSED)
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      api.rail.trackPosition(300, MID_Y, RAIL_RECT_EXPANDED)
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(true)

      // Wait for any cooldown (mouse didn't leave from left edge, so no cooldown)
      await sleep(50)

      // Second cycle — should work identically
      api.rail.trackPosition(5, MID_Y, RAIL_RECT_COLLAPSED)
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      api.rail.trackPosition(400, MID_Y, RAIL_RECT_EXPANDED)
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(true)
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// REGRESSION: sidebar hangs when mouse exits vertically (root cause #3)
//
// When the mouse exits the rail VERTICALLY (moves up to tab bar or below
// the viewport), onMouseLeave fires and schedules collapse. But the next
// mousemove event calls trackPosition with clientX still within rail bounds.
// Without Y-axis checking, trackPosition sees clientX <= railRight and calls
// cancelCollapse(), cancelling the valid collapse.
//
// Browser event ordering: mouseleave fires BEFORE mousemove for the same
// pointer movement. So the sequence is:
//   1. onMouseLeave → schedules collapse timer
//   2. mousemove → trackPosition(100, 10, rect) → X in range → cancelCollapse()!
//
// Fix: trackPosition must check clientY against rail top/bottom bounds.
// ---------------------------------------------------------------------------

describe("regression: sidebar hangs on vertical exit (Y-axis check)", () => {
  test("trackPosition triggers collapse when mouse is above rail top", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // Expand
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // Mouse at X=100 (within rail width), but Y=10 (above rail top of 28)
      api.rail.trackPosition(100, 10, RAIL_RECT_EXPANDED)
      await sleep(TIMER_WAIT)

      expect(api.rail.collapsed()).toBe(true)
    } finally {
      dispose()
    }
  })

  test("trackPosition triggers collapse when mouse is below rail bottom", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // Expand
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // Mouse at X=100 (within rail width), but Y=850 (below rail bottom of 800)
      api.rail.trackPosition(100, 850, RAIL_RECT_EXPANDED)
      await sleep(TIMER_WAIT)

      expect(api.rail.collapsed()).toBe(true)
    } finally {
      dispose()
    }
  })

  test("vertical exit: onMouseLeave collapse is NOT cancelled by subsequent trackPosition above rail", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // Expand
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // 1. onMouseLeave fires (mouse exits upward to tab bar)
      api.rail.handleMouseLeave()

      // 2. Next mousemove: X=100 (in rail), Y=10 (above rail top=28)
      //    This must NOT cancel the pending collapse
      await sleep(30)
      api.rail.trackPosition(100, 10, RAIL_RECT_EXPANDED)

      await sleep(TIMER_WAIT)

      // Should be collapsed — the vertical exit was not incorrectly cancelled
      expect(api.rail.collapsed()).toBe(true)
    } finally {
      dispose()
    }
  })

  test("vertical exit: onMouseLeave collapse is NOT cancelled by subsequent trackPosition below rail", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // Expand
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // 1. onMouseLeave fires (mouse exits downward past rail bottom)
      api.rail.handleMouseLeave()

      // 2. Next mousemove: X=50 (in rail), Y=850 (below rail bottom=800)
      await sleep(30)
      api.rail.trackPosition(50, 850, RAIL_RECT_EXPANDED)

      await sleep(TIMER_WAIT)

      expect(api.rail.collapsed()).toBe(true)
    } finally {
      dispose()
    }
  })

  test("mouse re-entering rail vertically (Y back in range) correctly cancels collapse", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // Expand
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // Mouse exits upward
      api.rail.trackPosition(100, 10, RAIL_RECT_EXPANDED)

      // Mouse comes back into rail bounds before collapse fires
      await sleep(30)
      api.rail.trackPosition(100, MID_Y, RAIL_RECT_EXPANDED)

      await sleep(TIMER_WAIT)

      // Should still be expanded — mouse came back
      expect(api.rail.collapsed()).toBe(false)
    } finally {
      dispose()
    }
  })

  test("full vertical cycle: expand → exit above → collapse → hot zone → re-expand", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // Expand via hot zone
      api.rail.trackPosition(5, MID_Y, RAIL_RECT_COLLAPSED)
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // Mouse moves up above rail (to tab bar area)
      api.rail.trackPosition(100, 10, RAIL_RECT_EXPANDED)
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(true)

      // Mouse comes back to hot zone
      api.rail.trackPosition(5, MID_Y, RAIL_RECT_COLLAPSED)
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)
    } finally {
      dispose()
    }
  })

  test("mouse at exact rail boundary (Y == top) stays inside", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // Expand
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // Mouse at Y exactly equal to rail top — should be considered inside
      api.rail.trackPosition(100, 28, RAIL_RECT_EXPANDED)
      await sleep(TIMER_WAIT)

      expect(api.rail.collapsed()).toBe(false)
    } finally {
      dispose()
    }
  })

  test("mouse at exact rail boundary (Y == bottom) stays inside", async () => {
    const { api, dispose } = createTestLayout()
    try {
      // Expand
      api.rail.handleHotZoneEnter()
      await sleep(TIMER_WAIT)
      expect(api.rail.collapsed()).toBe(false)

      // Mouse at Y exactly equal to rail bottom — should be considered inside
      api.rail.trackPosition(100, 800, RAIL_RECT_EXPANDED)
      await sleep(TIMER_WAIT)

      expect(api.rail.collapsed()).toBe(false)
    } finally {
      dispose()
    }
  })
})
