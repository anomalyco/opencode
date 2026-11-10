import { activeSection, keepInRail, markStuck } from "~/component/site/contents-spy"
import { holdOpenMenu } from "~/component/site/menu-hold"
import { $, $$, on, target } from "./dom"

// "Contents" (on-this-page.tsx): the aside's list and the phone Contents bar mark the section being
// read (contents-spy.ts), the rail keeps it in view and the phone bar draws its lines once pinned. The
// bar opens as a dropdown that a choice, a tap outside or Escape closes, as ContentsMenu does.

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
  markStuck($('[data-component="contents-menu"]'))
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
  keepInRail($('[data-component="on-this-page"] [aria-current]'))
}
