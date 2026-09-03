import { expect, test } from "bun:test"
import { createTreeTouchScrollController, findTreeTouch, type TreeTouch } from "./scroll"

function touchList(...touches: TreeTouch[]) {
  return {
    length: touches.length,
    item(index: number) {
      return touches[index] ?? null
    },
  }
}

test("finds the active touch when touch list order changes", () => {
  const first = { identifier: 1, clientY: 300 }
  const second = { identifier: 2, clientY: 100 }

  expect(findTreeTouch(touchList(second, first), first.identifier)).toBe(first)
  expect(findTreeTouch(touchList(second), first.identifier)).toBeUndefined()
})

test("bridges upward touch movement into tree scrolling", () => {
  const scroller = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 }
  const touch = createTreeTouchScrollController(() => scroller)

  touch.start(1, 300)

  expect(touch.move(1, 220)).toBeTrue()
  expect(scroller.scrollTop).toBe(80)
})

test("clears the touch anchor after a gesture ends", () => {
  const scroller = { scrollTop: 80, scrollHeight: 1000, clientHeight: 200 }
  const touch = createTreeTouchScrollController(() => scroller)

  touch.start(1, 300)
  touch.end(1)

  expect(touch.move(1, 220)).toBeFalse()
  expect(scroller.scrollTop).toBe(80)
})

test("consumes one synthetic click after dragging", () => {
  const scroller = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 }
  const touch = createTreeTouchScrollController(() => scroller)

  touch.start(1, 300)
  touch.move(1, 298)
  touch.move(1, 295)
  touch.end(1)

  expect(touch.consumeClick()).toBeTrue()
  expect(touch.consumeClick()).toBeFalse()

  touch.start(2, 300)
  touch.end(2)
  expect(touch.consumeClick()).toBeFalse()
})

test("tracks one touch and ignores additional fingers", () => {
  const scroller = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 }
  const touch = createTreeTouchScrollController(() => scroller)

  expect(touch.start(1, 300)).toBeTrue()
  expect(touch.start(2, 100)).toBeFalse()
  expect(touch.move(2, 20)).toBeFalse()
  expect(scroller.scrollTop).toBe(0)
  expect(touch.move(1, 220)).toBeTrue()
  expect(scroller.scrollTop).toBe(80)
  expect(touch.end(2)).toBeFalse()
  expect(touch.identifier).toBe(1)
  expect(touch.end(1)).toBeTrue()
})

test("keeps sub-threshold movement as a tap", () => {
  const scroller = { scrollTop: 80, scrollHeight: 1000, clientHeight: 200 }
  const touch = createTreeTouchScrollController(() => scroller)

  touch.start(1, 300)
  expect(touch.move(1, 297)).toBeFalse()
  touch.end(1)

  expect(scroller.scrollTop).toBe(80)
  expect(touch.consumeClick()).toBeFalse()
})
