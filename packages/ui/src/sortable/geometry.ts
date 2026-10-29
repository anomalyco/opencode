// Geometry for a 1D sortable list in flow coordinates: positions grow with the item index, so a right-to-left strip is
// measured from the right edge and negated rather than special-cased.
export type Slot = { start: number; size: number }

/** The index the dragged slot lands on after travelling `delta`: it passes a slot once its leading edge crosses that slot's center. */
export function targetIndex(slots: readonly Slot[], from: number, delta: number) {
  const moved = slots[from]!

  return slots.reduce((to, slot, index) => {
    const middle = slot.start + slot.size / 2

    if (index > from && end(moved) + delta > middle) return to + 1

    if (index < from && moved.start + delta < middle) return to - 1

    return to
  }, from)
}

/** How far each slot travels along the flow when the slot at `from` moves to `to`. */
export function shifts(slots: readonly Slot[], from: number, to: number) {
  const moved = slots[from]!

  return slots.map((slot, index) => {
    if (index === from && to > from) return end(slots[to]!) - end(moved)

    if (index === from) return slots[to]!.start - moved.start

    if (from < to && index > from && index <= to) return moved.start - slots[from + 1]!.start

    if (to < from && index >= to && index < from) return end(moved) - end(slots[from - 1]!)

    return 0
  })
}

/** Keeps the dragged slot inside the list's first and last slots. */
export function clampDelta(slots: readonly Slot[], from: number, delta: number) {
  const moved = slots[from]!

  return Math.min(Math.max(delta, slots[0]!.start - moved.start), end(slots.at(-1)!) - end(moved))
}

/** Auto-scroll speed in px/s: zero outside the edge bands, easing in to `max` at and past the container edges. */
export function edgeSpeed(pointer: number, start: number, finish: number, max = 900) {
  const band = Math.min(48, (finish - start) / 4)

  if (band <= 0) return 0
  const depth = (edge: number) => Math.min(1, Math.max(0, (band - edge) / band)) ** 2

  return max * (depth(finish - pointer) - depth(pointer - start))
}

const end = (slot: Slot) => slot.start + slot.size
