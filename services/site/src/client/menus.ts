import { navMenusOnIntent } from "~/component/site/nav-intent"
import { addMenuCloser, runMenuClosers } from "~/component/site/menu-closers"
import type { SheetControl } from "~/component/site/sheet-motion"
import { browserPlatform, touchDevice } from "~/lib/user-agent"
import { placeMenu } from "~/component/site/place-menu"
import { keepUnderHeader } from "~/component/site/under-header"
import { $, $$, html, on, t, target } from "./dom"

// The site's menus on the static pages: the phone menu, the language picker (a popover, or the bottom
// sheet on touch phones), and the shared logo menu. Escape closes what's open and gives focus back to
// its button; any link chosen in one, a wider window or a page restored from the back/forward cache
// closes them all.

/** Registers a menu's close with closeMenus: islands' menus too, and the Solid overlays' (menu-closers.ts). */
export function onCloseMenus(close: () => void) {
  addMenuCloser(close)
}

/** Closes every menu, sheet and pop-up, and the Contents menus. */
export function closeMenus() {
  runMenuClosers()
  $$<HTMLDetailsElement>('details[data-component="contents-menu"][open], details[data-menu][open]').forEach(
    (details) => (details.open = false),
  )
  $$(":popover-open").forEach((popover) => popover.hidePopover())
}

export function startMenus() {
  phoneMenu()
  languagePicker()
  siteMenus()
  // The logo menu (packages/nav-menus), loaded on first use (nav-intent.ts); home, Brand and Press
  // stay in the page's language. Opening it closes the site's own menus.
  const locale = html.dataset.locale
  const navMenus = navMenusOnIntent({
    link: (path) =>
      locale && locale !== "en" && ["/", "/brand", "/press"].includes(path)
        ? `/${locale}${path === "/" ? "" : path}`
        : path,
  })
  const closeNav = () => navMenus.close()
  onCloseMenus(closeNav)
  on("opencode-nav-menu-open" as keyof DocumentEventMap, () => runMenuClosers(closeNav))

  // One highlighted row per menu: keyboard focus follows the pointer into another row (as Site does).
  on("pointerover", (event) => {
    if (event.pointerType !== "mouse") return
    const row = target(event).closest<HTMLElement>(
      '[data-component="site-menu"] [data-slot="menu"] > *, [data-component="language-picker"] [data-slot="item"], [data-slot="menu"] [role="menuitem"]',
    )
    const popup = row?.closest('[data-slot="menu"], [data-slot="dropdown"]')
    if (!row || !popup?.contains(document.activeElement) || document.activeElement === row) return
    row.focus({ preventScroll: true })
  })
  // A link chosen in a menu closes them all, after its own handlers have run (menu-open.ts
  // closeMenusOnLinks on the hydrated pages).
  on(
    "click",
    (event) => {
      const link = target(event).closest("a[href]")
      if (!link || link.matches("[aria-haspopup], [aria-expanded]")) return
      if (link.closest('[role="menu"], [data-slot="menu"], [popover], dialog, details[data-component="contents-menu"]'))
        setTimeout(closeMenus)
    },
    { capture: true },
  )
  matchMedia("(min-width: 60.0625rem)").addEventListener("change", closeMenus)
  window.addEventListener("pageshow", (event) => event.persisted && closeMenus())
}

// The small-screen header's menu button and the sheet it opens (phone-menu.tsx). While it is open the
// page behind leaves the tab order and doesn't scroll.
function phoneMenu() {
  const toggle = $('[data-component="menu-toggle"]')
  const sheet = $("#site-menu")
  if (!toggle || !sheet) return
  const set = (open: boolean, focus = false) => {
    if (sheet.hasAttribute("data-open") === open) return
    sheet.toggleAttribute("data-open", open)
    toggle.setAttribute("aria-expanded", String(open))
    toggle.setAttribute("aria-label", t(open ? "site.closeMenu" : "nav.openMenu"))
    $$('[data-slot="frame"], [data-component="site-footer"]').forEach((element) => (element.inert = open))
    html.style.overflow = open ? "hidden" : ""
    if (focus) toggle.focus()
  }
  onCloseMenus(() => set(false))
  toggle.addEventListener("click", () => {
    const open = !sheet.hasAttribute("data-open")
    if (open) closeMenus()
    set(open)
  })
  sheet.addEventListener("click", (event) => {
    if (target(event).closest('[data-slot="backdrop"], a')) set(false)
  })
  on("keydown", (event) => event.key === "Escape" && sheet.hasAttribute("data-open") && set(false, true))
}

// The language control (language-picker.tsx): a native popover anchored to its button. Opened from
// the keyboard, focus moves to the current language. On touch phones its button opens the language
// sheet instead (language-sheet.tsx).
function languagePicker() {
  document.addEventListener(
    "toggle",
    (event) => {
      const menu = event.target as HTMLElement
      if (
        !(event instanceof ToggleEvent) ||
        !menu.matches?.('[data-component="language-picker"] [data-slot="dropdown"]')
      )
        return
      const trigger = menu.previousElementSibling as HTMLElement
      trigger.setAttribute("aria-expanded", String(event.newState === "open"))
      if (event.newState !== "open") return
      keepUnderHeader(menu, trigger)
      if (trigger.matches(":focus-visible")) $('[aria-current="true"]', menu)?.focus()
    },
    true,
  )
  on(
    "click",
    (event) => {
      const trigger = target(event).closest<HTMLElement>('[data-component="language-picker"] [data-slot="trigger"]')
      const root = $('[data-component="sheet"][data-sheet="language"]')
      if (!trigger || !root || !prefersSheet()) return
      event.preventDefault()
      openSheet(root, trigger)
    },
    { capture: true },
  )
}

// The site's dropdowns (site-menu.tsx): the trigger opens its menu where it fits (placeMenu), or the
// bottom sheet on touch phones. Arrow keys, Home and End move between rows; Escape and a click outside
// close it, Escape giving focus back to the trigger; opened from the keyboard, focus moves to the
// first row.
function siteMenus() {
  const set = (root: HTMLElement, open: boolean) => {
    const menu = $('[data-slot="menu"]', root)
    if (!menu || (menu.hidden === true) === !open) return
    menu.hidden = !open
    $('[data-slot="trigger"]', root)?.setAttribute("aria-expanded", String(open))
    if (open) placeMenu(menu)
  }
  const roots = () => $$('[data-component="site-menu"]')
  onCloseMenus(() => roots().forEach((root) => set(root, false)))
  on("click", (event) => {
    const trigger = target(event).closest<HTMLElement>('[data-component="site-menu"] > [data-slot="trigger"]')
    const root = trigger?.parentElement
    if (!trigger || !root) return
    const sheet = $('[data-component="sheet"]', root)
    if (sheet && prefersSheet()) return openSheet(sheet, trigger)
    const open = $('[data-slot="menu"]', root)?.hidden === true
    if (open) closeMenus()
    set(root, open)
    if (open && event.detail === 0) $('[role="menuitem"]', root)?.focus({ preventScroll: true })
  })
  on("pointerdown", (event) => roots().forEach((root) => !root.contains(target(event)) && set(root, false)))
  on("keydown", (event) => {
    const root = roots().find((item) => $('[data-slot="menu"]:not([hidden])', item))
    if (!root) return
    if (event.key === "Escape") {
      set(root, false)
      return $('[data-slot="trigger"]', root)?.focus()
    }
    const rows = $$('[role="menuitem"]', root)
    const at = rows.indexOf(document.activeElement as HTMLElement)
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: rows.length - 1 }[event.key]
    if (next === undefined || at === -1) return
    event.preventDefault()
    rows[(next + rows.length) % rows.length]?.focus()
  })
}

/** Touch phones and tablets get the bottom sheet (sheet-motion.ts). */
const prefersSheet = () => touchDevice(browserPlatform())

// A sheet's motion loads when a sheet first opens, as only touch devices get sheets, and from the
// first touch on a menu's button, so it's usually there by the tap.
const sheets = new WeakMap<HTMLElement, Promise<SheetControl>>()
let motion: Promise<typeof import("~/component/site/sheet-motion")> | undefined
const loadMotion = () => (motion ??= import("~/component/site/sheet-motion"))
on("pointerdown", (event) => {
  if (prefersSheet() && target(event).closest('[data-slot="trigger"]')) void loadMotion()
})

function openSheet(root: HTMLElement, trigger: HTMLElement) {
  let sheet = sheets.get(root)
  if (!sheet) {
    const loaded = loadMotion().then(({ sheetMotion }) => sheetMotion(root))
    // Registered now, so a close while the motion loads still lands after the open.
    onCloseMenus(() => void loaded.then((control) => control.close()))
    sheets.set(root, (sheet = loaded))
  }
  void sheet.then((control) => control.open(trigger))
}
