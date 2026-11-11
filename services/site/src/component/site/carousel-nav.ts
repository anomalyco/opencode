/**
 * What the products carousel's previous and next do (ProductsArrows renders them, products-arrows.tsx,
 * in the app and on the static pages): shown while the cards overflow, each end aria-disabled once
 * the cards reach it, and a press moves by as many whole cards as fit (at least one), which the snap
 * lines up. No framework code. `nav` holds the two buttons; returns its stop.
 */
export function carouselNav(nav: HTMLElement, track: HTMLElement) {
  const [previous, next] = nav.querySelectorAll("button")
  const measure = () => {
    const max = track.scrollWidth - track.clientWidth
    const at = Math.abs(track.scrollLeft)
    nav.hidden = max <= 1
    disable(previous, at < 2)
    disable(next, at > max - 2)
  }
  const page = (direction: 1 | -1) => {
    const card = track.firstElementChild
    if (!(card instanceof HTMLElement)) return
    const style = getComputedStyle(track)
    const step = card.offsetWidth + (parseFloat(style.columnGap) || 0)
    const cards = Math.max(1, Math.floor(track.clientWidth / step))
    track.scrollBy({
      left: direction * (style.direction === "rtl" ? -1 : 1) * step * cards,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    })
  }
  const click = (event: MouseEvent) => {
    const button = (event.target as Element).closest("button")
    if (!button || button.getAttribute("aria-disabled") === "true") return
    page(button === previous ? -1 : 1)
  }
  nav.addEventListener("click", click)
  const resize = new ResizeObserver(measure)
  resize.observe(track)
  track.addEventListener("scroll", measure, { passive: true })
  measure()
  return () => {
    nav.removeEventListener("click", click)
    resize.disconnect()
    track.removeEventListener("scroll", measure)
  }
}

function disable(button: HTMLButtonElement, disabled: boolean) {
  if (disabled) return button.setAttribute("aria-disabled", "true")
  button.removeAttribute("aria-disabled")
}
