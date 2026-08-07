import { describe, expect, test } from "bun:test"
import { layoutTimelineNavBeads, pickTimelineNavMessage } from "./message-nav"

describe("pickTimelineNavMessage", () => {
  const items = [
    { id: "a", top: 100, bottom: 200 },
    { id: "b", top: 300, bottom: 400 },
    { id: "c", top: 700, bottom: 800 },
  ]

  test("returns the shown message containing the line", () => {
    const result = pickTimelineNavMessage({ line: 350, viewportTop: 0, viewportBottom: 1000, items })
    expect(result).toBe("b")
  })

  test("falls back to the nearest shown message when the line misses", () => {
    const result = pickTimelineNavMessage({ line: 260, viewportTop: 0, viewportBottom: 1000, items })
    expect(result).toBe("b")
  })

  test("breaks distance ties towards the smaller top", () => {
    const tied = [
      { id: "a", top: 100, bottom: 140 },
      { id: "b", top: 200, bottom: 240 },
    ]
    const result = pickTimelineNavMessage({ line: 150, viewportTop: 0, viewportBottom: 1000, items: tied })
    expect(result).toBe("a")
  })

  test("ignores items outside the viewport", () => {
    const result = pickTimelineNavMessage({ line: 750, viewportTop: 0, viewportBottom: 500, items })
    expect(result).toBe("b")
  })

  test("falls back to the last item above the line when nothing intersects the viewport", () => {
    const result = pickTimelineNavMessage({ line: 900, viewportTop: 2000, viewportBottom: 3000, items })
    expect(result).toBe("c")
  })

  test("falls back to the first item when the line is above everything", () => {
    const result = pickTimelineNavMessage({ line: 10, viewportTop: 2000, viewportBottom: 3000, items })
    expect(result).toBe("a")
  })

  test("returns undefined for empty items", () => {
    const result = pickTimelineNavMessage({ line: 100, viewportTop: 0, viewportBottom: 500, items: [] })
    expect(result).toBeUndefined()
  })
})

describe("layoutTimelineNavBeads", () => {
  test("fits at max size with room to spare", () => {
    expect(layoutTimelineNavBeads({ count: 5, height: 200 })).toEqual({ size: 8, gap: 4, overflow: false })
  })

  test("shrinks the bead size before touching the gap", () => {
    expect(layoutTimelineNavBeads({ count: 10, height: 100 })).toEqual({ size: 6, gap: 4, overflow: false })
  })

  test("drops to the minimum size and gap when beads no longer fit", () => {
    expect(layoutTimelineNavBeads({ count: 20, height: 120 })).toEqual({ size: 4, gap: 2, overflow: false })
  })

  test("reports overflow when even minimum beads exceed the height", () => {
    expect(layoutTimelineNavBeads({ count: 30, height: 100 })).toEqual({ size: 4, gap: 2, overflow: true })
  })

  test("returns defaults when there is nothing to lay out", () => {
    expect(layoutTimelineNavBeads({ count: 0, height: 100 })).toEqual({ size: 8, gap: 4, overflow: false })
    expect(layoutTimelineNavBeads({ count: 5, height: 0 })).toEqual({ size: 8, gap: 4, overflow: false })
  })

  test("honours custom bounds", () => {
    expect(layoutTimelineNavBeads({ count: 3, height: 100, maxSize: 20, gap: 10 })).toEqual({
      size: 20,
      gap: 10,
      overflow: false,
    })
    expect(layoutTimelineNavBeads({ count: 2, height: 30, maxSize: 20, gap: 10, minSize: 12, minGap: 4 })).toEqual({
      size: 12,
      gap: 4,
      overflow: false,
    })
  })
})
