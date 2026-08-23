import { nextTreeScrollTop } from "./domain"

export type TreeScrollTarget = {
  scrollTop: number
  readonly scrollHeight: number
  readonly clientHeight: number
}

export type TreeTouch = {
  readonly identifier: number
  readonly clientY: number
}

export function findTreeTouch(
  touches: { readonly length: number; item(index: number): TreeTouch | null },
  identifier: number | undefined,
) {
  if (identifier === undefined) return
  for (let index = 0; index < touches.length; index++) {
    const touch = touches.item(index)
    if (touch?.identifier === identifier) return touch
  }
}

export function createTreeTouchScrollController(getScroller: () => TreeScrollTarget | undefined) {
  let identifier: number | undefined
  let lastY: number | undefined
  let dragged = false
  let distance = 0

  return {
    get identifier() {
      return identifier
    },
    start(nextIdentifier: number, clientY: number) {
      if (identifier !== undefined) return false
      identifier = nextIdentifier
      lastY = clientY
      dragged = false
      distance = 0
      return true
    },
    move(nextIdentifier: number, clientY: number) {
      if (nextIdentifier !== identifier) return false
      const previousY = lastY
      lastY = clientY
      if (previousY === undefined) return false
      const delta = previousY - clientY
      distance += Math.abs(delta)
      if (distance <= 4) return false
      dragged = true

      const scroller = getScroller()
      if (!scroller) return dragged

      const next = nextTreeScrollTop(scroller.scrollTop, delta, scroller.scrollHeight, scroller.clientHeight)
      if (next === scroller.scrollTop) return dragged
      scroller.scrollTop = next
      return true
    },
    end(nextIdentifier: number) {
      if (nextIdentifier !== identifier) return false
      identifier = undefined
      lastY = undefined
      return true
    },
    cancel(nextIdentifier: number) {
      if (nextIdentifier !== identifier) return false
      identifier = undefined
      lastY = undefined
      dragged = false
      distance = 0
      return true
    },
    consumeClick() {
      if (!dragged) return false
      dragged = false
      return true
    },
  }
}
