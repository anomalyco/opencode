import { expect, test } from "bun:test"
import { createVirtualizer, defaultRangeExtractor } from "@tanstack/solid-virtual"
import { createRoot, createSignal } from "solid-js"
import { filterVirtualIndexes } from "@/pages/session/timeline/virtual-items"

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

test("logical scroll offset includes pending measurement adjustments", () => {
  createRoot((dispose) => {
    const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
      count: 2,
      getScrollElement: () => null,
      estimateSize: () => 60,
      initialOffset: 100,
      initialRect: { width: 800, height: 60 },
    })

    virtualizer.getTotalSize()
    virtualizer.resizeItem(0, 100)

    expect(virtualizer.scrollOffset).toBe(100)
    expect(virtualizer.getLogicalScrollOffset()).toBe(140)
    dispose()
  })
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
