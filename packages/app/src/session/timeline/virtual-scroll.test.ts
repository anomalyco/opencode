import { expect, test } from "bun:test"
import { Virtualizer } from "@tanstack/solid-virtual"
import { stopVirtualScroll, virtualScroll } from "./virtual-scroll"

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

// A real TanStack instance over 100 rows of 50px in a 600px view. Its scroll writes are recorded and move nothing,
// as while a smooth scroll is still on its way, so every row is below the fold: a row that resizes moves the target
// and not the offset.
function mount() {
  const writes: number[] = []
  const element = document.createElement("div")
  // happy-dom lays nothing out, and TanStack reads the scroll range from the element.
  Object.defineProperties(element, { scrollHeight: { value: 10_000 }, clientHeight: { value: 600 } })

  const virtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>({
    count: 100,
    getScrollElement: () => element,
    estimateSize: () => 50,
    scrollToFn: (offset) => writes.push(offset),
    observeElementRect: (_, report) => report({ width: 400, height: 600 }),
    observeElementOffset: (_, report) => report(0, false),
    // As the Solid adapter does: TanStack takes a new size into its rows when they are read.
    onChange: (instance) => instance.getVirtualItems(),
  })

  virtualizer._willUpdate()
  // Mounting writes the initial offset.
  writes.length = 0

  return { virtualizer, writes }
}

test("a stopped scroll writes nothing when a row before its target resizes, where a running one writes the target again", async () => {
  const running = mount()
  const stopped = mount()
  running.virtualizer.scrollToIndex(60, { align: "start" })
  stopped.virtualizer.scrollToIndex(60, { align: "start" })

  expect(virtualScroll(stopped.virtualizer)).toBeTruthy()
  stopVirtualScroll(stopped.virtualizer)

  expect(virtualScroll(stopped.virtualizer)).toBeFalsy()
  running.virtualizer.resizeItem(30, 80)
  stopped.virtualizer.resizeItem(30, 80)
  await frame()
  await frame()

  expect(running.writes).toEqual([3000, 3030])
  expect(stopped.writes).toEqual([3000])
  stopVirtualScroll(running.virtualizer)
})
