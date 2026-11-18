/** True when the element lays out right to left (the `dir` it inherits, or a CSS `direction`). */
export function isRtl(element: Element) {
  return getComputedStyle(element).direction === "rtl"
}

/**
 * The arrow key as it reads on screen: in right-to-left text ArrowLeft moves forward and ArrowRight
 * moves back, so handlers written for left to right can keep comparing against "ArrowRight".
 */
export function inlineKey(event: KeyboardEvent) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return event.key
  // Listeners on window or document read the page's direction.
  const element = event.currentTarget instanceof Element ? event.currentTarget : document.documentElement
  if (!isRtl(element)) return event.key
  return event.key === "ArrowLeft" ? "ArrowRight" : "ArrowLeft"
}

/**
 * How far an element is scrolled from its inline start, as a positive number in both directions
 * (right-to-left scrollers report 0 at the start and negative values after it).
 */
export function scrollStart(element: Element) {
  return Math.abs(element.scrollLeft)
}

/** The scrollLeft that puts `offset` pixels from the inline start at the start edge. */
export function scrollLeftFor(element: Element, offset: number) {
  return isRtl(element) ? -offset : offset
}
