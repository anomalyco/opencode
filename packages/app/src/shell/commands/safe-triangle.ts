import { onCleanup } from "solid-js"

type Point = { x: number; y: number }

/**
 * Keeps a flyout open while the pointer heads toward it across neighboring rows. The triangle runs from the
 * pointer's last position on the owning row to the flyout's near corners. A pointer that rests inside it hands
 * over to the row underneath after `timeout`, as on macOS.
 */
export function createSafeTriangle(input: { flyout: () => Element | undefined; timeout?: number }) {
  let apex: Point | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))

  const corners = () => {
    const box = input.flyout()?.getBoundingClientRect()

    if (!box || !apex) return

    const x = box.left > apex.x ? box.left : box.right

    return [apex, { x, y: box.top }, { x, y: box.bottom }]
  }

  const contains = (point: Point) => {
    const triangle = corners()

    if (!triangle) return false
    const side = (a: Point, b: Point) => (point.x - b.x) * (a.y - b.y) - (a.x - b.x) * (point.y - b.y)
    const signs = [side(triangle[0], triangle[1]), side(triangle[1], triangle[2]), side(triangle[2], triangle[0])]

    return !(signs.some((value) => value < 0) && signs.some((value) => value > 0))
  }

  return {
    corners,
    contains,
    /** Records the pointer on the row that owns the open flyout. */
    anchor(point: Point) {
      clearTimeout(timer)
      apex = point
    },
    /** Returns whether a pointer on another row should leave the flyout alone, scheduling `settle` if it rests. */
    hold(point: Point, settle: () => void) {
      clearTimeout(timer)

      if (!contains(point)) return false
      timer = setTimeout(() => {
        apex = undefined
        settle()
      }, input.timeout ?? 300)

      return true
    },
    /** Cancels a pending hand-over, such as when the pointer reaches the flyout. */
    cancel() {
      clearTimeout(timer)
    },
    reset() {
      clearTimeout(timer)
      apex = undefined
    },
  }
}
