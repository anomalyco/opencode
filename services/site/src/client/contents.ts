import { holdOpenMenu } from "~/component/site/menu-hold"
import { $, $$, html, on, target } from "./dom"

// "Contents" (on-this-page.tsx): the aside's list and the phone Contents bar mark the section being
// read, the last whose heading has passed a third of the way down the window; at the bottom of the
// page, the one the address names while its heading is in view, else the last in view. The rail keeps
// it in view; the phone bar draws its lines once pinned (data-stuck) and opens as a dropdown that a
// choice, a tap outside or Escape closes.

const lists = '[data-component="on-this-page"], [data-component="contents-menu"]'
let links: HTMLAnchorElement[] = []
let frame = 0
let active: string | undefined

export function startContents() {
  refreshContents()
  if (!links.length) return
  addEventListener("scroll", schedule, { passive: true })
  addEventListener("resize", schedule, { passive: true })
  addEventListener("hashchange", schedule)
  on("click", (event) => {
    const link = target(event).closest<HTMLAnchorElement>(`:is(${lists}) a`)
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
  on("pointerdown", (event) => {
    const menu = $<HTMLDetailsElement>('[data-component="contents-menu"][open]')
    if (menu && !menu.contains(target(event))) menu.open = false
  })
  on("keydown", (event) => {
    const menu = $<HTMLDetailsElement>('[data-component="contents-menu"][open]')
    if (event.key !== "Escape" || !menu) return
    menu.open = false
    $("summary", menu)?.focus()
  })
}

/** Reads the lists again, after an island swapped their items (the legal pages' History). */
export function refreshContents() {
  links = $$<HTMLAnchorElement>(`:is(${lists}) a`)
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
  // Hidden from 60rem up (display: none), the phone bar has no box to measure.
  const menu = $('[data-component="contents-menu"]')
  if (menu?.offsetParent)
    menu.toggleAttribute(
      "data-stuck",
      scrollY > 0 && menu.getBoundingClientRect().top <= parseFloat(getComputedStyle(menu).top) + 0.5,
    )
  const ids = [...new Set(links.map((link) => decodeURIComponent(link.hash.slice(1))))]
  const headings = ids.flatMap((id) => {
    const heading = document.getElementById(id)
    return heading ? [{ id, top: heading.getBoundingClientRect().top }] : []
  })
  const passed = headings.filter((heading) => heading.top <= innerHeight / 3)
  const bottom = scrollY + innerHeight >= html.scrollHeight - 2
  const visible = headings.filter((heading) => heading.top >= 0 && heading.top < innerHeight)
  const named = visible.find((heading) => `#${heading.id}` === decodeURIComponent(location.hash)) ?? visible.at(-1)
  mark(bottom && named ? named.id : (passed.at(-1)?.id ?? ids[0]))
}

function mark(id: string | undefined) {
  if (id === active) return
  active = id
  links.forEach((link) =>
    decodeURIComponent(link.hash.slice(1)) === id
      ? link.setAttribute("aria-current", "location")
      : link.removeAttribute("aria-current"),
  )
  // The rail scrolls on its own when it is taller than the window: keep the current section in view,
  // 24px from the edge it went past.
  const link = $('[data-component="on-this-page"] [aria-current]')
  const box = link?.closest<HTMLElement>('[data-component="aside"] > *')
  if (!link || !box) return
  const item = link.getBoundingClientRect()
  const view = box.getBoundingClientRect()
  if (item.top < view.top) box.scrollTop -= view.top - item.top + 24
  if (item.bottom > view.bottom) box.scrollTop += item.bottom - view.bottom + 24
}
