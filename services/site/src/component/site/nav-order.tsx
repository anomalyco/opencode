import "./nav-order.css"
import { createSignal, onCleanup } from "solid-js"
import { designMode } from "./design-copy"
import { historyGroup } from "./history"
import { createVersions } from "./versions"
import {
  defaultNavConfig,
  navDefaults,
  normalizeNavConfig,
  setSiteSetting,
  siteSettings,
  type NavEntry,
} from "./settings"

/**
 * The primary nav's items as Design mode edits them (settings navConfig): drag an item or focus it
 * and press ⌥↑/⌥↓ to move it, the eye beside it to show or hide it, and click its label to rename
 * it. Every known item renders (hidden ones only show in Design mode, dimmed), so the nav renders
 * the saved list once the settings load; before that, the pre-paint script writes navConfigRules
 * (flex `order`, visibility, numbers and labels) so a saved list shows on first paint.
 */

import { navFlags } from "./nav-config"

export { navConfigRules, navFlags, navSequence } from "./nav-config"
export { navDefaults, normalizeNavConfig }

// While an item is being dragged, the draft order drives the nav instead of the saved one.
const [draft, setDraft] = createSignal<string[]>()

/** The list the nav shows now: the saved one, in the draft order while an item is dragged. */
export const navList = (): NavEntry[] => {
  const order = draft()
  const config = siteSettings.navConfig
  if (!order) return config
  return order.flatMap((id) => config.filter((entry) => entry.id === id))
}

/** True while a nav item is being dragged (Design mode hides its hover outline meanwhile). */
export const navSorting = () => draft() !== undefined

/** The item whose label is being renamed in Design mode. */
export const [navEditing, setNavEditing] = createSignal<string>()

export function navConfigChanged() {
  return JSON.stringify(siteSettings.navConfig) !== JSON.stringify(defaultNavConfig())
}

export function resetNav() {
  setSiteSetting("navConfig", defaultNavConfig())
}

export function setNavVisible(id: string, visible: boolean) {
  setSiteSetting(
    "navConfig",
    siteSettings.navConfig.map((entry) => (entry.id === id ? { ...entry, visible } : entry)),
  )
}

/**
 * An entry's saved label for the given locale. Renamed known items are English text, so they only
 * apply in English; a custom link has no translated label, so its label applies everywhere.
 */
export function navSavedLabel(entry: NavEntry | undefined, locale: string) {
  if (!entry?.label) return undefined
  return entry.id.startsWith("custom-") || locale === "en" ? entry.label : undefined
}

/**
 * Saves a new label; an empty one, or the default label, goes back to the default. A custom link
 * has no default, so an empty label keeps the one it has.
 */
export function setNavLabel(id: string, text: string, fallback: string) {
  // Pasted text can carry line breaks and zero-width characters; it renders on one line.
  const label = text
    .replace(/[\u200b\u2060]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  const custom = id.startsWith("custom-")
  if (custom && !label) return
  setSiteSetting(
    "navConfig",
    siteSettings.navConfig.map((entry) => {
      if (entry.id !== id) return entry
      if (custom || (label && label !== fallback)) return { ...entry, label }
      return Object.fromEntries(Object.entries(entry).filter((field) => field[0] !== "label")) as NavEntry
    }),
  )
}

/** Deletes an item from the nav; it keeps its place in the list so it can be added back. */
export function removeNavItem(id: string) {
  setSiteSetting(
    "navConfig",
    siteSettings.navConfig.map((entry) => (entry.id === id ? { ...entry, removed: true } : entry)),
  )
}

/** Adds a deleted item back, shown, where it was. */
export function restoreNavItem(id: string) {
  setSiteSetting(
    "navConfig",
    siteSettings.navConfig.map((entry) =>
      entry.id === id
        ? (Object.fromEntries(
            Object.entries({ ...entry, visible: true }).filter((field) => field[0] !== "removed"),
          ) as NavEntry)
        : entry,
    ),
  )
}

/** Adds a link of your own at the end of the nav. A URL with no scheme or leading slash is https. */
export function addCustomNavItem(label: string, url: string) {
  const text = label.trim()
  const link = url.trim()
  if (!text || !link) return false
  const href = /^([a-z][a-z0-9+.-]*:|\/|#)/i.test(link) ? link : `https://${link}`
  setSiteSetting("navConfig", [
    ...siteSettings.navConfig,
    { id: `custom-${Date.now().toString(36)}`, visible: true, label: text, href },
  ])
  return true
}

/** The deleted items, to add back (known ones by their own label, custom links by theirs). */
export const removedNavItems = () => siteSettings.navConfig.filter((entry) => entry.removed)

type CustomItem = { id: string; label: string; href: string; arrow: boolean; external: boolean; company: boolean }
const customItems = new Map<string, CustomItem>()

/**
 * The custom links of a nav list as nav items, the same object while a link is unchanged (so a
 * reorder moves it in place). Off-site links open in a new tab with the arrow, like GitHub.
 */
export function navCustomItems(config: readonly NavEntry[]) {
  return config.flatMap((entry) => {
    if (!entry.href || !entry.label) return []
    const key = `${entry.id} ${entry.label} ${entry.href}`
    const cached = customItems.get(key)
    if (cached) return [cached]
    const external = /^[a-z][a-z0-9+.-]*:/i.test(entry.href) && !entry.href.startsWith(window.location.origin)
    const item = { id: entry.id, label: entry.label, href: entry.href, arrow: external, external, company: false }
    customItems.set(key, item)
    return [item]
  })
}

/** Saved versions of the nav list (versions.ts); switching animates the items to their places. */
export const navVersions = createVersions<NavEntry[]>({
  versions: () => siteSettings.navVersions,
  active: () => siteSettings.navVersion,
  current: () => siteSettings.navConfig,
  base: defaultNavConfig,
  // Built in, next to Default: a shorter, even list (products as Apps, Subscriptions as Plans, the Console's
  // enterprise page as Teams).
  presets: () => [
    {
      id: "short-and-even",
      name: "Version 3 · Short and even",
      config: [
        { id: "docs", visible: true },
        { id: "products", visible: true, label: "Apps" },
        { id: "data", visible: true },
        { id: "console", visible: true },
        { id: "models", visible: true },
        { id: "subscriptions", visible: true, label: "Plans" },
        { id: "enterprise", visible: true, label: "Teams" },
        { id: "changelog", visible: false },
        { id: "github", visible: false },
      ],
    },
  ],
  write: (change, label) =>
    animateNav(() =>
      historyGroup(() => {
        if (change.versions) setSiteSetting("navVersions", change.versions)
        if (change.active) setSiteSetting("navVersion", change.active)
        if (change.current) setSiteSetting("navConfig", change.current)
      }, label),
    ),
})

// The rendered nav lists (sidebar and phone menu), for animating a change to the whole list.
const lists = new Set<HTMLUListElement>()

/** Runs `change` and slides every item that moved from where it was (FLIP). */
export function animateNav(change: () => void) {
  if (reduced()) return change()
  const before = new Map(
    [...lists].flatMap((list) =>
      [...list.querySelectorAll<HTMLElement>(":scope > li")]
        .filter((li) => li.offsetHeight > 0)
        .map((li) => [li, li.getBoundingClientRect().top] as const),
    ),
  )
  change()
  before.forEach((top, li) => {
    if (!li.isConnected || li.offsetHeight === 0) return
    const delta = top - li.getBoundingClientRect().top
    if (Math.abs(delta) < 1) return
    li.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], { duration: 220, easing: ease })
  })
}

function reorder(order: string[]) {
  return order.flatMap((id) => siteSettings.navConfig.filter((entry) => entry.id === id))
}

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
const ease = "cubic-bezier(0.2, 0, 0, 1)"
// How far the pointer moves before a press on an item becomes a drag; less is a click.
const threshold = 4

type Drag = {
  id: string
  start: string[]
  pointer: number
  // Where the press started, the pointer now, and how far into the item it holds it.
  from: { x: number; y: number }
  y: number
  grab: number
  lifted: boolean
}

/**
 * Makes a rendered nav list editable in Design mode (use as the `ul`'s ref). The items need
 * `data-nav-id`; the list must render every item in `navList()` order.
 */
export function sortableNav(list: HTMLUListElement) {
  const state: { drag?: Drag; swallow?: boolean } = {}
  const items = () => [...list.querySelectorAll<HTMLElement>(":scope > li")]
  const find = (id: string) => list.querySelector<HTMLElement>(`:scope > li[data-nav-id="${id}"]`)
  const ids = () => items().flatMap((li) => (li.dataset.navId ? [li.dataset.navId] : []))
  const label = (id: string) => find(id)?.querySelector('[data-slot="label"]')?.textContent ?? id
  // With grouped nav an item moves only among its own group.
  const peers = (id: string) => {
    if (siteSettings.navGroups === "flat") return ids()
    const company = (other: string) => navFlags.some((item) => item.id === other && item.company)
    return ids().filter((other) => company(other) === company(id))
  }

  // Puts the peers in `order` and keeps the other group's items in their places.
  function full(order: string[]) {
    const queue = [...order]
    return navList().map((entry) => (order.includes(entry.id) ? (queue.shift() ?? entry.id) : entry.id))
  }

  // Moves `id` to `index` among its peers; the others slide from where they were (FLIP).
  function place(id: string, index: number, commit: boolean) {
    const group = peers(id)
    const others = group.filter((other) => other !== id)
    const next = [...others.slice(0, index), id, ...others.slice(index)]
    if (next.join() === group.join()) return
    const before = new Map(
      items()
        .filter((li) => li.dataset.navId !== state.drag?.id || !state.drag?.lifted)
        .map((li) => [li, li.getBoundingClientRect().top] as const),
    )
    const order = full(next)
    if (commit) setSiteSetting("navConfig", reorder(order))
    if (!commit) setDraft(order)
    if (reduced()) return
    before.forEach((top, li) => {
      if (!li.isConnected) return
      const delta = top - li.getBoundingClientRect().top
      if (Math.abs(delta) < 1) return
      li.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], { duration: 200, easing: ease })
    })
  }

  // The item's top in the viewport as laid out, ignoring transforms (its own and the FLIP ones).
  function slot(li: HTMLElement) {
    const parent = li.offsetParent
    if (!parent) return li.getBoundingClientRect().top
    return parent.getBoundingClientRect().top + parent.clientTop + li.offsetTop - parent.scrollTop
  }

  function follow(drag: Drag) {
    const li = find(drag.id)
    if (!li) return
    // Where it would land: past the middle of each peer the pointer has crossed.
    const index = peers(drag.id)
      .filter((other) => other !== drag.id)
      .filter((other) => {
        const element = find(other)
        return !!element && slot(element) + element.offsetHeight / 2 < drag.y
      }).length
    place(drag.id, index, false)
    li.style.transform = `translateY(${drag.y - drag.grab - slot(li)}px)`
  }

  function settle(id: string) {
    const li = find(id)
    if (!li) return
    const from = li.style.transform
    li.style.transform = ""
    delete li.dataset.navLifted
    if (from && !reduced()) li.animate([{ transform: from }, { transform: "none" }], { duration: 180, easing: ease })
  }

  function end(commit: boolean) {
    const drag = state.drag
    state.drag = undefined
    document.removeEventListener("pointermove", move)
    document.removeEventListener("pointerup", up)
    document.removeEventListener("pointercancel", cancel)
    document.removeEventListener("keydown", escape, true)
    if (!drag?.lifted) return
    // The click that ends a drag doesn't follow the link or start a rename.
    state.swallow = true
    setTimeout(() => (state.swallow = false), 0)
    const order = draft()
    if (commit && order) setSiteSetting("navConfig", reorder(order))
    setDraft(undefined)
    settle(drag.id)
    const position = `position ${ids().indexOf(drag.id) + 1} of ${ids().length}`
    announce(commit ? `${label(drag.id)}, ${position}.` : `Cancelled. ${label(drag.id)} is back at ${position}.`)
  }

  const move = (event: PointerEvent) => {
    const drag = state.drag
    if (!drag || event.pointerId !== drag.pointer) return
    drag.y = event.clientY
    if (!drag.lifted && Math.hypot(event.clientX - drag.from.x, event.clientY - drag.from.y) < threshold) return
    if (!drag.lifted) {
      const li = find(drag.id)
      if (!li) return end(false)
      drag.lifted = true
      drag.grab = drag.from.y - slot(li)
      li.dataset.navLifted = ""
      setDraft(navList().map((entry) => entry.id))
    }
    event.preventDefault()
    follow(drag)
  }
  const up = (event: PointerEvent) => {
    if (event.pointerId === state.drag?.pointer) end(true)
  }
  const cancel = (event: PointerEvent) => {
    if (event.pointerId === state.drag?.pointer) end(false)
  }
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !state.drag?.lifted) return
    // Design mode stays on: the Escape only cancels the drag.
    event.preventDefault()
    event.stopImmediatePropagation()
    end(false)
  }

  const down = (event: PointerEvent) => {
    const target = event.target as Element
    const li = target.closest<HTMLElement>("li[data-nav-id]")
    if (!designMode() || event.button !== 0 || !li || state.drag || target.closest("button, input, [contenteditable]"))
      return
    state.drag = {
      id: li.dataset.navId ?? "",
      start: navList().map((entry) => entry.id),
      pointer: event.pointerId,
      from: { x: event.clientX, y: event.clientY },
      y: event.clientY,
      grab: 0,
      lifted: false,
    }
    document.addEventListener("pointermove", move)
    document.addEventListener("pointerup", up)
    document.addEventListener("pointercancel", cancel)
    document.addEventListener("keydown", escape, true)
  }
  const click = (event: MouseEvent) => {
    if (state.swallow) {
      state.swallow = false
      event.preventDefault()
      event.stopPropagation()
      return
    }
    // Design mode: a click on a label renames the item instead of following the link.
    const target = event.target as Element
    const li = target.closest<HTMLElement>("li[data-nav-id]")
    const label = target.closest<HTMLElement>('[data-slot="label"]')
    if (!designMode() || !li || !label) return
    event.preventDefault()
    event.stopPropagation()
    // A click inside the label being renamed places the caret.
    if (navEditing() === li.dataset.navId) return
    setNavEditing(li.dataset.navId)
    queueMicrotask(() => {
      label.focus()
      window.getSelection()?.selectAllChildren(label)
    })
  }
  // Links drag as URLs by default; in Design mode the item moves instead.
  const dragstart = (event: DragEvent) => {
    if (designMode()) event.preventDefault()
  }
  const key = (event: KeyboardEvent) => {
    if (!designMode() || !event.altKey || event.metaKey || event.ctrlKey) return
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
    const li = (event.target as Element).closest<HTMLElement>("li[data-nav-id]")
    if (!li || (event.target as Element).closest("input, [contenteditable]")) return
    event.preventDefault()
    const id = li.dataset.navId ?? ""
    const group = peers(id)
    const index = group.indexOf(id) + (event.key === "ArrowUp" ? -1 : 1)
    if (index < 0 || index >= group.length) return announce(`${label(id)} can't move further.`)
    place(id, index, true)
    // Moving the item in the page can drop focus; keep it on the link.
    const link = find(id)?.querySelector<HTMLElement>("a")
    if (link && document.activeElement !== link) link.focus({ preventScroll: true })
    announce(`${label(id)}, position ${ids().indexOf(id) + 1} of ${ids().length}.`)
  }

  function announce(text: string) {
    const region =
      list.parentElement?.querySelector<HTMLElement>(':scope > [data-slot="nav-announcer"]') ??
      list.parentElement?.appendChild(document.createElement("div"))
    if (!region) return
    region.dataset.slot = "nav-announcer"
    region.setAttribute("role", "status")
    region.setAttribute("aria-live", "assertive")
    region.textContent = text
  }

  lists.add(list)
  list.addEventListener("pointerdown", down)
  list.addEventListener("click", click, true)
  list.addEventListener("dragstart", dragstart)
  list.addEventListener("keydown", key)
  onCleanup(() => {
    lists.delete(list)
    if (state.drag) end(false)
    list.removeEventListener("pointerdown", down)
    list.removeEventListener("click", click, true)
    list.removeEventListener("dragstart", dragstart)
    list.removeEventListener("keydown", key)
  })
}
