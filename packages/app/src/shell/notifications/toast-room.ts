import { createSignal } from "solid-js"

// The room each composer docked at the bottom of the window takes up there. A narrow window's toasts sit 16px from the
// bottom, over the composer and its Send button, so they rise above the tallest instead.
const rooms = new Map<Element, number>()

const [room, setRoom] = createSignal(0)

/** Reports how far `element` reaches up from the window's bottom edge, or `undefined` once it no longer does. */
export function reserveToastRoom(element: Element, height: number | undefined) {
  if (height === undefined) rooms.delete(element)

  if (height !== undefined) rooms.set(element, height)
  setRoom(Math.max(0, ...rooms.values()))
}

/** The bottom offset of a narrow window's toasts: 8px above the tallest docked composer, else the 16px default. */
export function toastMobileBottom() {
  return room() > 0 ? room() + 8 : 16
}
