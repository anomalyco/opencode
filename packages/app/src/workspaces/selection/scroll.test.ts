import { expect, test } from "bun:test"
import { createTreeTouchScrollController } from "./scroll"

test("bridges upward touch movement into tree scrolling", () => {
  const scroller = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 }
  const touch = createTreeTouchScrollController(() => scroller)

  touch.start(300)

  expect(touch.move(220)).toBeTrue()
  expect(scroller.scrollTop).toBe(80)
})

test("clears the touch anchor after a gesture ends", () => {
  const scroller = { scrollTop: 80, scrollHeight: 1000, clientHeight: 200 }
  const touch = createTreeTouchScrollController(() => scroller)

  touch.start(300)
  touch.end()

  expect(touch.move(220)).toBeFalse()
  expect(scroller.scrollTop).toBe(80)
})

test("consumes one synthetic click after dragging", () => {
  const scroller = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 }
  const touch = createTreeTouchScrollController(() => scroller)

  touch.start(300)
  touch.move(298)
  touch.move(295)
  touch.end()

  expect(touch.consumeClick()).toBeTrue()
  expect(touch.consumeClick()).toBeFalse()

  touch.start(300)
  touch.end()
  expect(touch.consumeClick()).toBeFalse()
})
