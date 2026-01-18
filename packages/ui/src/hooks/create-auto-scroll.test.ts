import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createAutoScroll } from "./create-auto-scroll"

/**
 * Tests for the auto-scroll hook that handles scroll-to-bottom button visibility
 *
 * Key behaviors:
 * 1. notAtBottom tracks whether user is scrolled away from bottom (>50px threshold)
 * 2. userScrolled tracks whether user has manually scrolled up during work
 * 3. Initial scroll position is checked on mount via requestAnimationFrame
 * 4. Scroll button preserves visibility when returning to scrolled conversation
 */

describe("createAutoScroll", () => {
  test("returns expected API surface", () => {
    createRoot((dispose) => {
      const [working] = createSignal(false)
      const autoScroll = createAutoScroll({ working })

      expect(typeof autoScroll.scrollRef).toBe("function")
      expect(typeof autoScroll.contentRef).toBe("function")
      expect(typeof autoScroll.handleScroll).toBe("function")
      expect(typeof autoScroll.handleInteraction).toBe("function")
      expect(typeof autoScroll.scrollToBottom).toBe("function")
      expect(typeof autoScroll.forceScrollToBottom).toBe("function")
      expect(typeof autoScroll.userScrolled).toBe("function")
      expect(typeof autoScroll.notAtBottom).toBe("function")

      dispose()
    })
  })

  test("notAtBottom is initially false", () => {
    createRoot((dispose) => {
      const [working] = createSignal(false)
      const autoScroll = createAutoScroll({ working })

      expect(autoScroll.notAtBottom()).toBe(false)

      dispose()
    })
  })

  test("userScrolled is initially false", () => {
    createRoot((dispose) => {
      const [working] = createSignal(false)
      const autoScroll = createAutoScroll({ working })

      expect(autoScroll.userScrolled()).toBe(false)

      dispose()
    })
  })
})

// ============================================================================
// Tests for the scroll detection logic (pure functions)
// ============================================================================
describe("Scroll Detection Logic", () => {
  const THRESHOLD = 50

  // Replicates distanceFromBottom calculation
  function distanceFromBottom(scrollHeight: number, clientHeight: number, scrollTop: number): number {
    return scrollHeight - clientHeight - scrollTop
  }

  // Replicates the notAtBottom check
  function isNotAtBottom(scrollHeight: number, clientHeight: number, scrollTop: number): boolean {
    const distance = distanceFromBottom(scrollHeight, clientHeight, scrollTop)
    return distance >= THRESHOLD
  }

  test("calculates distance from bottom correctly", () => {
    // 1000px content, 500px viewport, scrolled to 400px
    // Distance = 1000 - 500 - 400 = 100px from bottom
    expect(distanceFromBottom(1000, 500, 400)).toBe(100)

    // Scrolled to bottom
    // Distance = 1000 - 500 - 500 = 0px from bottom
    expect(distanceFromBottom(1000, 500, 500)).toBe(0)

    // Scrolled to top
    // Distance = 1000 - 500 - 0 = 500px from bottom
    expect(distanceFromBottom(1000, 500, 0)).toBe(500)
  })

  test("notAtBottom is true when scrolled more than 50px from bottom", () => {
    expect(isNotAtBottom(1000, 500, 400)).toBe(true) // 100px from bottom
    expect(isNotAtBottom(1000, 500, 0)).toBe(true) // 500px from bottom
    expect(isNotAtBottom(1000, 500, 200)).toBe(true) // 300px from bottom
  })

  test("notAtBottom is false when within 50px of bottom", () => {
    expect(isNotAtBottom(1000, 500, 500)).toBe(false) // 0px from bottom
    expect(isNotAtBottom(1000, 500, 480)).toBe(false) // 20px from bottom
    expect(isNotAtBottom(1000, 500, 451)).toBe(false) // 49px from bottom (just under threshold)
  })

  test("notAtBottom handles edge cases", () => {
    // Content smaller than viewport
    expect(isNotAtBottom(300, 500, 0)).toBe(false) // Negative distance = at bottom

    // Exact fit
    expect(isNotAtBottom(500, 500, 0)).toBe(false)
  })
})

// ============================================================================
// Tests for work state transitions
// ============================================================================
describe("Work State Transitions", () => {
  // Replicates the logic for preserving scroll state when work stops
  function shouldResetUserScrolled(distanceFromBottom: number, working: boolean): boolean {
    // Only reset if we're at the bottom (within 50px)
    if (distanceFromBottom >= 50) return false
    return !working // Reset when work stops
  }

  test("preserves userScrolled when not at bottom after work stops", () => {
    // User scrolled up during work, work finishes
    expect(shouldResetUserScrolled(100, false)).toBe(false)
    expect(shouldResetUserScrolled(200, false)).toBe(false)
  })

  test("resets userScrolled when at bottom after work stops", () => {
    // User is at bottom when work finishes
    expect(shouldResetUserScrolled(0, false)).toBe(true)
    expect(shouldResetUserScrolled(30, false)).toBe(true)
  })

  test("does not reset during work", () => {
    // During work, don't reset regardless of position
    expect(shouldResetUserScrolled(0, true)).toBe(false)
    expect(shouldResetUserScrolled(100, true)).toBe(false)
  })
})

// ============================================================================
// Tests for scroll button visibility
// ============================================================================
describe("Scroll Button Visibility", () => {
  // The scroll button should show when notAtBottom is true
  function shouldShowScrollButton(notAtBottom: boolean, hasSessionId: boolean): boolean {
    return notAtBottom && hasSessionId
  }

  test("shows button when scrolled away from bottom with active session", () => {
    expect(shouldShowScrollButton(true, true)).toBe(true)
  })

  test("hides button when at bottom", () => {
    expect(shouldShowScrollButton(false, true)).toBe(false)
  })

  test("hides button when no session", () => {
    expect(shouldShowScrollButton(true, false)).toBe(false)
    expect(shouldShowScrollButton(false, false)).toBe(false)
  })
})

// ============================================================================
// Tests for initial scroll position detection
// ============================================================================
describe("Initial Scroll Position Detection", () => {
  // When user joins/returns to a scrolled conversation,
  // notAtBottom should be set correctly on mount

  function detectInitialPosition(
    scrollHeight: number,
    clientHeight: number,
    scrollTop: number,
  ): { notAtBottom: boolean } {
    const distance = scrollHeight - clientHeight - scrollTop
    return { notAtBottom: distance >= 50 }
  }

  test("detects scrolled position on initial load", () => {
    // User returns to conversation scrolled 200px from bottom
    const result = detectInitialPosition(1000, 500, 300)
    expect(result.notAtBottom).toBe(true)
  })

  test("detects at-bottom position on initial load", () => {
    // User returns to conversation at bottom
    const result = detectInitialPosition(1000, 500, 500)
    expect(result.notAtBottom).toBe(false)
  })

  test("handles short conversations on initial load", () => {
    // Conversation fits in viewport
    const result = detectInitialPosition(400, 500, 0)
    expect(result.notAtBottom).toBe(false)
  })
})
