import { describe, expect, test, mock } from "bun:test"
import { createRoot } from "solid-js"
import { createSwipeHandlers, isHorizontalSwipe, clampSwipeOffset } from "./swipe"

// Helper to create mock TouchEvent
function createTouchEvent(type: string, clientX: number, clientY: number): TouchEvent {
  return {
    type,
    touches: [{ clientX, clientY }],
    preventDefault: mock(() => {}),
  } as unknown as TouchEvent
}

describe("swipe utilities", () => {
  describe("isHorizontalSwipe", () => {
    test("returns true when horizontal movement is greater", () => {
      expect(isHorizontalSwipe(100, 50)).toBe(true)
      expect(isHorizontalSwipe(-100, 50)).toBe(true)
      expect(isHorizontalSwipe(100, -50)).toBe(true)
    })

    test("returns false when vertical movement is greater", () => {
      expect(isHorizontalSwipe(50, 100)).toBe(false)
      expect(isHorizontalSwipe(50, -100)).toBe(false)
      expect(isHorizontalSwipe(-50, 100)).toBe(false)
    })

    test("returns false when movements are equal", () => {
      expect(isHorizontalSwipe(50, 50)).toBe(false)
      expect(isHorizontalSwipe(0, 0)).toBe(false)
    })
  })

  describe("clampSwipeOffset", () => {
    const threshold = 80

    test("clamps left swipe within bounds", () => {
      expect(clampSwipeOffset(-50, threshold, "left")).toBe(-50)
      expect(clampSwipeOffset(-100, threshold, "left")).toBe(-100)
      expect(clampSwipeOffset(-150, threshold, "left")).toBe(-100) // maxSwipe = 80 + 20
    })

    test("prevents right swipe when direction is left", () => {
      expect(clampSwipeOffset(50, threshold, "left")).toBe(0)
      expect(clampSwipeOffset(100, threshold, "left")).toBe(0)
    })

    test("clamps right swipe within bounds", () => {
      expect(clampSwipeOffset(50, threshold, "right")).toBe(50)
      expect(clampSwipeOffset(100, threshold, "right")).toBe(100)
      expect(clampSwipeOffset(150, threshold, "right")).toBe(100) // maxSwipe = 80 + 20
    })

    test("prevents left swipe when direction is right", () => {
      expect(clampSwipeOffset(-50, threshold, "right")).toBe(0)
      expect(clampSwipeOffset(-100, threshold, "right")).toBe(0)
    })
  })

  describe("createSwipeHandlers", () => {
    test("initializes with default state", () => {
      createRoot((dispose) => {
        const { state } = createSwipeHandlers()

        expect(state.x()).toBe(0)
        expect(state.swiping()).toBe(false)
        expect(state.triggered()).toBe(false)

        dispose()
      })
    })

    test("tracks swipe state during touch", () => {
      createRoot((dispose) => {
        const { state, handlers } = createSwipeHandlers({ direction: "left" })

        // Start touch
        handlers.onTouchStart(createTouchEvent("touchstart", 200, 100))
        expect(state.swiping()).toBe(true)

        // Move left (horizontal swipe)
        handlers.onTouchMove(createTouchEvent("touchmove", 150, 100))
        expect(state.x()).toBe(-50)

        // End touch
        handlers.onTouchEnd()
        expect(state.swiping()).toBe(false)
        expect(state.x()).toBe(0)

        dispose()
      })
    })

    test("triggers callback when threshold is reached", () => {
      createRoot((dispose) => {
        const onSwipe = mock(() => {})
        const { state, handlers } = createSwipeHandlers({
          direction: "left",
          threshold: 80,
          onSwipe,
        })

        // Start and swipe past threshold
        handlers.onTouchStart(createTouchEvent("touchstart", 200, 100))
        handlers.onTouchMove(createTouchEvent("touchmove", 100, 100)) // -100px, past threshold
        handlers.onTouchEnd()

        expect(onSwipe).toHaveBeenCalledTimes(1)
        expect(state.triggered()).toBe(true)

        dispose()
      })
    })

    test("does not trigger when threshold is not reached", () => {
      createRoot((dispose) => {
        const onSwipe = mock(() => {})
        const { state, handlers } = createSwipeHandlers({
          direction: "left",
          threshold: 80,
          onSwipe,
        })

        // Start and swipe but not past threshold
        handlers.onTouchStart(createTouchEvent("touchstart", 200, 100))
        handlers.onTouchMove(createTouchEvent("touchmove", 160, 100)) // -40px, under threshold
        handlers.onTouchEnd()

        expect(onSwipe).not.toHaveBeenCalled()
        expect(state.triggered()).toBe(false)

        dispose()
      })
    })

    test("ignores vertical swipes", () => {
      createRoot((dispose) => {
        const { state, handlers } = createSwipeHandlers({ direction: "left" })

        // Start touch
        handlers.onTouchStart(createTouchEvent("touchstart", 200, 100))

        // Move vertically (scroll gesture)
        handlers.onTouchMove(createTouchEvent("touchmove", 190, 200))

        // X should not change for vertical movement
        expect(state.x()).toBe(0)

        dispose()
      })
    })

    test("ignores wrong direction swipes", () => {
      createRoot((dispose) => {
        const { state, handlers } = createSwipeHandlers({ direction: "left" })

        handlers.onTouchStart(createTouchEvent("touchstart", 100, 100))
        handlers.onTouchMove(createTouchEvent("touchmove", 200, 100)) // Right swipe

        expect(state.x()).toBe(0) // Should not move

        dispose()
      })
    })

    test("respects enabled option", () => {
      createRoot((dispose) => {
        const onSwipe = mock(() => {})
        const { state, handlers } = createSwipeHandlers({
          direction: "left",
          enabled: false,
          onSwipe,
        })

        handlers.onTouchStart(createTouchEvent("touchstart", 200, 100))
        expect(state.swiping()).toBe(false)

        handlers.onTouchMove(createTouchEvent("touchmove", 100, 100))
        expect(state.x()).toBe(0)

        handlers.onTouchEnd()
        expect(onSwipe).not.toHaveBeenCalled()

        dispose()
      })
    })

    test("right swipe direction works correctly", () => {
      createRoot((dispose) => {
        const onSwipe = mock(() => {})
        const { state, handlers } = createSwipeHandlers({
          direction: "right",
          threshold: 80,
          onSwipe,
        })

        handlers.onTouchStart(createTouchEvent("touchstart", 100, 100))
        handlers.onTouchMove(createTouchEvent("touchmove", 200, 100)) // +100px right
        expect(state.x()).toBe(100)

        handlers.onTouchEnd()
        expect(onSwipe).toHaveBeenCalledTimes(1)

        dispose()
      })
    })
  })
})
