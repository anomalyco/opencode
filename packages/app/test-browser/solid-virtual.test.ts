import { expect, test } from "bun:test"
import { createVirtualizer, defaultRangeExtractor, Virtualizer } from "@tanstack/solid-virtual"
import { createRoot, createSignal } from "solid-js"
import { filterVirtualIndexes } from "@/session/timeline/virtual-items"

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

test("start anchoring preserves a stable visible item across prepends", () => {
  const root = document.createElement("div")
  const writes: number[] = []
  const options = (keys: string[]) => ({
    count: keys.length,
    estimateSize: () => 50,
    initialOffset: 50,
    initialRect: { width: 400, height: 100 },
    anchorTo: "start" as const,
    getItemKey: (index: number) => keys[index]!,
    getScrollElement: () => root,
    scrollToFn: (offset: number) => writes.push(offset),
    observeElementRect: () => {},
    observeElementOffset: (_element: HTMLDivElement, callback: (offset: number, isScrolling: boolean) => void) => {
      callback(50, false)
    },
  })
  const virtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>(options(["c", "d", "e"]))
  virtualizer._willUpdate()
  virtualizer.getVirtualItems()

  virtualizer.setOptions(options(["a", "b", "c", "d", "e"]))
  virtualizer._willUpdate()

  expect(virtualizer.getScrollOffset()).toBe(150)
  expect(writes.at(-1)).toBe(150)
})

// A pagination boundary can re-key the row at the viewport top when the truncated
// leading turn regroups under its freshly loaded user message. The anchor must fall
// back to the next surviving key instead of leaving the offset on the new content.
test("prepend anchoring survives when the nearest keys are re-keyed", () => {
  const root = document.createElement("div")
  const writes: number[] = []
  const options = (keys: string[]) => ({
    count: keys.length,
    estimateSize: () => 50,
    initialOffset: 50,
    initialRect: { width: 400, height: 100 },
    anchorTo: "start" as const,
    getItemKey: (index: number) => keys[index]!,
    getScrollElement: () => root,
    scrollToFn: (offset: number) => writes.push(offset),
    observeElementRect: () => {},
    observeElementOffset: (_element: HTMLDivElement, callback: (offset: number, isScrolling: boolean) => void) => {
      callback(50, false)
    },
  })
  // Viewport sits at offset 50: rows "orphan-c" (anchor) and "d" visible.
  const virtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>(options(["orphan-c", "d", "e"]))
  virtualizer._willUpdate()
  virtualizer.getVirtualItems()

  // Prepend re-keys the boundary row ("orphan-c" -> "c") while "d" and "e" survive.
  virtualizer.setOptions(options(["a", "b", "c", "d", "e"]))
  virtualizer._willUpdate()

  // "d" was 50px below the anchor at old start 50; restored at new start 150 => offset 150.
  expect(virtualizer.getScrollOffset()).toBe(150)
  expect(writes.at(-1)).toBe(150)
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
