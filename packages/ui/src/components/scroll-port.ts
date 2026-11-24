/**
 * The part of a scroll container its reader can see, in client coordinates: the container's box less its scroll
 * padding. A container that scrolls on under a header or a floating region declares each as scroll padding, which
 * the browser already honours when focus scrolls a control into view. Page and land a target here, not in the box.
 */
export function scrollPort(element: HTMLElement) {
  const box = element.getBoundingClientRect()
  const style = getComputedStyle(element)

  return {
    top: box.top + (parseFloat(style.scrollPaddingTop) || 0),
    bottom: box.bottom - (parseFloat(style.scrollPaddingBottom) || 0),
  }
}

/** How far a page key moves a scroll container: 80% of the part its reader can see. */
export function scrollPage(element: HTMLElement) {
  const port = scrollPort(element)

  return Math.max(0, port.bottom - port.top) * 0.8
}
