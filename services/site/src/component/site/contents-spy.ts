// "Contents" as the reader scrolls (on-this-page.tsx), with no Solid, so the hydrated pages, the
// static pages (src/client/contents.ts) and the docs (src/docs/client.ts) mark the same section.

/**
 * The section being read: the last whose heading has passed a third of the way down the window. At
 * the bottom of the page, where the last headings can't reach that line, the one the address names
 * (a Contents link or a shared link) while its heading is in view, else the last in view.
 */
export function activeSection(ids: string[]) {
  const headings = ids.flatMap((id) => {
    const heading = document.getElementById(id)
    return heading ? [{ id, top: heading.getBoundingClientRect().top }] : []
  })
  const passed = headings.filter((heading) => heading.top <= innerHeight / 3)
  const bottom = scrollY + innerHeight >= document.documentElement.scrollHeight - 2
  const visible = headings.filter((heading) => heading.top >= 0 && heading.top < innerHeight)
  const named = visible.find((heading) => `#${heading.id}` === decodeURIComponent(location.hash)) ?? visible.at(-1)
  return bottom && named ? named.id : (passed.at(-1)?.id ?? ids[0])
}

/**
 * The aside's rail scrolls on its own when it is taller than the window: keeps the current section's
 * link in view, 24px from the edge it went past.
 */
export function keepInRail(link?: Element | null) {
  const box = link?.closest("[data-component='aside'] > *")
  if (!link || !box) return
  const item = link.getBoundingClientRect()
  const view = box.getBoundingClientRect()
  if (item.top < view.top) box.scrollTop -= view.top - item.top + 24
  if (item.bottom > view.bottom) box.scrollTop += item.bottom - view.bottom + 24
}

/**
 * The phone Contents bar draws its lines once pinned (data-stuck, on-this-page.css): its top at its
 * sticky offset, once the page has scrolled. Measured, so it works where CSS scroll-state queries
 * don't (WebKit). Hidden from 60rem up (display: none), the bar has no box to measure.
 */
export function markStuck(menu?: HTMLElement | null) {
  if (!menu?.offsetParent) return
  menu.toggleAttribute(
    "data-stuck",
    scrollY > 0 && menu.getBoundingClientRect().top <= parseFloat(getComputedStyle(menu).top) + 0.5,
  )
}
