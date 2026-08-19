import { describe, expect, test } from "bun:test"
import { SEGMENTS, TOTAL_FRAMES, segmentState } from "./busy-wave"

describe("segmentState", () => {
  test("sweeps an active head left to right", () => {
    for (let frame = 0; frame < SEGMENTS; frame++) {
      const head = segmentState(frame, frame)
      expect(head.alpha).toBe(1)
      expect(head.active).toBe(true)
    }
  })

  test("renders a gradient trail behind the head", () => {
    const head = segmentState(4, 4)
    const trailing = segmentState(4, 2)
    expect(trailing.alpha).toBeLessThan(head.alpha)
    expect(trailing.active).toBe(true)
  })

  test("marks segments beyond the trail as inactive", () => {
    const inactive = segmentState(4, 7)
    expect(inactive.active).toBe(false)
  })

  test("stays within valid alpha bounds across the whole cycle", () => {
    for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
      for (let char = 0; char < SEGMENTS; char++) {
        const state = segmentState(frame, char)
        expect(state.alpha).toBeGreaterThanOrEqual(0)
        expect(state.alpha).toBeLessThanOrEqual(1)
      }
    }
  })

  test("has exactly TRAIL_STEPS active positions when head is mid-sweep", () => {
    let active = 0
    for (let char = 0; char < SEGMENTS; char++) {
      if (segmentState(5, char).active) active++
    }
    expect(active).toBe(6)
  })
})
