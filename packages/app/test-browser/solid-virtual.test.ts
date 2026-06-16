import { expect, test } from "bun:test"
import { createVirtualizer } from "@tanstack/solid-virtual"
import { createRoot, createSignal } from "solid-js"

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
