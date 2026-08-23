import { nextTreeScrollTop } from "./domain"

export type TreeScrollTarget = {
  scrollTop: number
  readonly scrollHeight: number
  readonly clientHeight: number
}

export function createTreeTouchScrollController(getScroller: () => TreeScrollTarget | undefined) {
  let lastY: number | undefined
  let dragged = false
  let distance = 0

  return {
    start(clientY: number) {
      lastY = clientY
      dragged = false
      distance = 0
    },
    move(clientY: number) {
      const previousY = lastY
      lastY = clientY
      if (previousY === undefined) return false
      const delta = previousY - clientY
      distance += Math.abs(delta)
      if (distance > 4) dragged = true

      const scroller = getScroller()
      if (!scroller) return dragged

      const next = nextTreeScrollTop(scroller.scrollTop, delta, scroller.scrollHeight, scroller.clientHeight)
      if (next === scroller.scrollTop) return dragged
      scroller.scrollTop = next
      return true
    },
    end() {
      lastY = undefined
    },
    cancel() {
      lastY = undefined
      dragged = false
      distance = 0
    },
    consumeClick() {
      if (!dragged) return false
      dragged = false
      return true
    },
  }
}
