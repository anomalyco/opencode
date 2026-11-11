import { holdOpenMenu } from "./menu-hold"

// "Contents" as the reader scrolls (on-this-page.tsx), with no Solid, so the hydrated pages, the
// static pages (src/client/entry.ts) and the docs (src/docs/client.ts) mark the same section.

const lists = '[data-component="on-this-page"], [data-component="contents-menu"]'
let links: HTMLAnchorElement[] = []
let frame = 0
let active: string | undefined
let marked: ((id: string | undefined) => void) | undefined

/**
 * Runs "Contents" on a page that never hydrates: the aside's list and the phone Contents bar mark the
 * section being read, the rail keeps it in view and the phone bar draws its lines once pinned. The
 * bar opens as a dropdown that a choice, a tap outside or Escape closes, as ContentsMenu does.
 * `onMark` hears each section marked.
 */
export function startContents(onMark?: (id: string | undefined) => void) {
  marked = onMark
  refreshContents()
  if (!links.length) return
  addEventListener("scroll", schedule, { passive: true })
  addEventListener("resize", schedule, { passive: true })
  addEventListener("hashchange", schedule)
  document.addEventListener("click", (event) => {
    const link = (event.target as Element).closest?.<HTMLAnchorElement>(`:is(${lists}) a`)
    if (!link) return
    mark(decodeURIComponent(link.hash.slice(1)))
    const menu = link.closest("details")
    if (menu) menu.open = false
  })
  document.addEventListener(
    "toggle",
    (event) => (event.target as Element).matches?.('[data-component="contents-menu"]') && holdOpenMenu(),
    true,
  )
  document.addEventListener("pointerdown", (event) => {
    const menu = document.querySelector<HTMLDetailsElement>('[data-component="contents-menu"][open]')
    if (menu && !menu.contains(event.target as Node)) menu.open = false
  })
  document.addEventListener("keydown", (event) => {
    const menu = document.querySelector<HTMLDetailsElement>('[data-component="contents-menu"][open]')
    if (event.key !== "Escape" || !menu) return
    menu.open = false
    menu.querySelector("summary")?.focus()
  })
}

/** Reads the lists again, after an island swapped their items (the legal pages' History). */
export function refreshContents() {
  links = [...document.querySelectorAll<HTMLAnchorElement>(`:is(${lists}) a`)]
  active = undefined
  track()
}

function schedule() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    track()
  })
}

function track() {
  markStuck(document.querySelector('[data-component="contents-menu"]'))
  mark(activeSection([...new Set(links.map((link) => decodeURIComponent(link.hash.slice(1))))]))
}

function mark(id: string | undefined) {
  if (id === active) return
  active = id
  links.forEach((link) =>
    decodeURIComponent(link.hash.slice(1)) === id
      ? link.setAttribute("aria-current", "location")
      : link.removeAttribute("aria-current"),
  )
  keepInRail(document.querySelector('[data-component="on-this-page"] [aria-current]'))
  marked?.(id)
}

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
