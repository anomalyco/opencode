// The header pinned to the window's top: the announcement banner, the top bar under it and the page's
// Contents row under that. Nothing on the page may draw over it, but a menu in the top layer (a
// popover) draws over everything whatever its z-index, so such a menu is cut at the header's lower
// edge instead and scrolls under it like the rest of the page.
const header = [
  '[data-component="announcement-banner"]',
  '[data-component="topbar"]',
  '[data-component="contents-menu"]',
].join(", ")

const watched = new WeakMap<HTMLElement, () => void>()

/**
 * The header's lower edge in the window, 0 when nothing is pinned: the bars stacked down from the
 * window's top edge (a Contents row further down the page isn't pinned yet). A bar that holds `menu`
 * doesn't count.
 */
export function headerBottom(menu: HTMLElement) {
  const bars = [...document.querySelectorAll<HTMLElement>(header)]
    .filter((bar) => !bar.contains(menu))
    .map((bar) => bar.getBoundingClientRect())
    .filter((rect) => rect.height > 0)
    .sort((a, b) => a.top - b.top)
  let bottom = 0
  for (const rect of bars) if (rect.top <= bottom + 1) bottom = Math.max(bottom, rect.bottom)
  return bottom
}

/**
 * Keeps an open top-layer menu under the header while the page scrolls: whatever part of it is
 * above the header's lower edge is cut off (drawing and pointer alike). `anchor` is the element the
 * menu is anchored to. It stops once the menu closes or leaves the page.
 */
export function keepUnderHeader(menu: HTMLElement, anchor: HTMLElement) {
  watched.get(menu)?.()
  // The menu's top edge from the anchor's. The browser moves an anchored menu for a scroll only in
  // the next frame, so while the page scrolls the anchor, always where it's drawn, places it, and it's
  // measured two frames after scrolling ends (it may have flipped to the anchor's other side). The
  // opening animation scales the menu, so it's measured again once that ends.
  let offset = 0
  const measure = () => {
    offset = menu.getBoundingClientRect().top - anchor.getBoundingClientRect().top
    update()
  }
  const settled = () => requestAnimationFrame(() => requestAnimationFrame(measure))
  const update = () => {
    if (!menu.isConnected || !menu.matches(":popover-open")) return stop()
    const bottom = headerBottom(menu)
    const cut = bottom - anchor.getBoundingClientRect().top - offset
    // Only the top edge is cut; the other sides reach far out, so the menu keeps its shadow.
    menu.style.clipPath = bottom > 0 && cut > 0 ? `inset(${cut}px -100vmax -100vmax)` : ""
  }
  const stop = () => {
    menu.style.clipPath = ""
    window.removeEventListener("scroll", update, true)
    window.removeEventListener("scrollend", settled, true)
    window.removeEventListener("resize", measure)
    menu.removeEventListener("animationend", measure)
    menu.removeEventListener("toggle", measure)
    watched.delete(menu)
  }
  watched.set(menu, stop)
  // Capturing, so a scrolling box inside the page (the product carousel's track) counts too.
  window.addEventListener("scroll", update, { capture: true, passive: true })
  window.addEventListener("scrollend", settled, { capture: true, passive: true })
  window.addEventListener("resize", measure, { passive: true })
  menu.addEventListener("animationend", measure)
  menu.addEventListener("toggle", measure)
  measure()
}
