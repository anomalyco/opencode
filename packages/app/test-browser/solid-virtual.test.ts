import { expect, test } from "bun:test"
import { createVirtualizer, defaultRangeExtractor, Virtualizer } from "@tanstack/solid-virtual"
import { createRoot, createSignal } from "solid-js"
import { filterVirtualIndexes } from "@/pages/session/timeline/virtual-items"

test("end anchoring survives consecutive resizes when the first scroll write is clamped", () => {
  const writes: { offset: number; adjustments?: number }[] = []
  const virtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>({
    count: 5,
    estimateSize: () => 50,
    initialOffset: 50,
    initialRect: { width: 400, height: 200 },
    anchorTo: "end",
    scrollEndThreshold: 1,
    getScrollElement: () => null,
    scrollToFn: (offset, options) => writes.push({ offset, adjustments: options.adjustments }),
    observeElementRect: () => {},
    observeElementOffset: () => {},
  })

  virtualizer.getTotalSize()
  virtualizer.resizeItem(4, 120)
  expect(writes).toEqual([{ offset: 50, adjustments: 70 }])
  writes.length = 0

  virtualizer.resizeItem(4, 200)
  expect(writes).toEqual([{ offset: 120, adjustments: 80 }])
})

test("reactive count updates preserve measured row sizes", () => {
  createRoot((dispose) => {
    const [count, setCount] = createSignal(2)
    const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
      get count() {
        return count()
      },
      getScrollElement: () => null,
      estimateSize: () => 60,
      initialRect: { width: 800, height: 600 },
    })

    expect(virtualizer.getTotalSize()).toBe(120)
    virtualizer.resizeItem(0, 100)
    expect(virtualizer.getTotalSize()).toBe(160)

    setCount(3)

    expect(virtualizer.itemSizeCache.get(0)).toBe(100)
    expect(virtualizer.getTotalSize()).toBe(220)
    dispose()
  })
})

test("initial rect projects rows before a scroll element connects", () => {
  createRoot((dispose) => {
    const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
      count: 100,
      getScrollElement: () => null,
      estimateSize: () => 28,
      initialRect: { width: 0, height: 600 },
      overscan: 10,
    })

    expect(virtualizer.getVirtualItems().length).toBeGreaterThan(0)
    dispose()
  })
})

test("clamps oversized offsets with scroll margin and padding changes", () => {
  const options = (paddingEnd: number) => ({
    count: 20,
    estimateSize: () => 60,
    initialOffset: Number.MAX_SAFE_INTEGER,
    initialRect: { width: 800, height: 600 },
    scrollMargin: 64,
    paddingEnd,
    overscan: 1,
    getScrollElement: () => null,
    scrollToFn: () => {},
    observeElementRect: () => {},
    observeElementOffset: () => {},
  })
  const virtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>(options(64))

  expect(virtualizer.getVirtualItems().map((item) => item.index)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])

  virtualizer.setOptions(options(600))
  expect(virtualizer.getVirtualItems().map((item) => item.index)).toEqual([18, 19])
})

test("stale pinned indexes do not produce missing virtual items after count shrinks", () => {
  createRoot((dispose) => {
    const [count, setCount] = createSignal(2)
    const pinned = [1]
    const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
      get count() {
        return count()
      },
      getScrollElement: () => null,
      estimateSize: () => 60,
      initialRect: { width: 800, height: 600 },
      rangeExtractor: (range) =>
        filterVirtualIndexes([...new Set([...defaultRangeExtractor(range), ...pinned])], range.count),
    })

    expect(virtualizer.getVirtualItems().map((item) => item.index)).toEqual([0, 1])
    setCount(1)
    expect(virtualizer.getVirtualItems().map((item) => item.index)).toEqual([0])
    expect(() => new Map(virtualizer.getVirtualItems().map((item) => [item.key, item]))).not.toThrow()
    dispose()
  })
})
