/**
 * Whether any menu, sheet or pop-up is open on the page, told to each caller and set as
 * `data-menu-open` on <html>, for floating things (the corner orb) to step aside. No framework code,
 * so the static pages' orb (voice/hex-orb.ts) loads none. It reads the page, not each component, so
 * new menus count on their own when they follow one of these patterns:
 * - a trigger with `aria-haspopup` and `aria-expanded="true"` (site menus, ProductAction, the docs
 *   lockup and version menus, Contents buttons, the docs page menu, ⌘K);
 * - a popover in the top layer, an open <dialog> or a shown modal dialog (sheets, the language picker);
 * - a `<details>` Contents menu (`data-component="contents-menu"`, or `data-menu` on any other);
 * - an explicit `data-menu-open` on an element (a product card while its menu is open);
 * plus the few disclosure-style menus with no `aria-haspopup`: the phone menu, the docs section
 * toggle and the console dropdowns.
 * Elements inside `ignore` (the orb's own pop-up) don't count.
 */
const openMenus = [
  '[aria-haspopup]:not([aria-haspopup="false"])[aria-expanded="true"]',
  ":popover-open",
  "dialog[open]",
  '[role="dialog"][aria-modal="true"]',
  'details[data-component="contents-menu"][open]',
  "details[data-menu][open]",
  "body [data-menu-open]",
  '[data-component="site-menu-sheet"][data-open]',
  '[data-slot="section-toggle"][aria-expanded="true"]',
  '[data-component="dropdown"] > [data-slot="trigger"][aria-expanded="true"]',
].join(", ")

const listeners = new Set<(open: boolean) => void>()
let open = false
let stop: (() => void) | undefined

/**
 * Calls `change` now and whenever a menu opens or the last one closes, until the returned function
 * runs. One watch is shared by every caller.
 */
export function watchMenus(ignore: string, change: (open: boolean) => void) {
  listeners.add(change)
  if (listeners.size === 1) {
    let frame = 0
    const check = () => {
      frame = 0
      const next = [...document.querySelectorAll<HTMLElement>(openMenus)].some(
        (el) =>
          !el.closest(ignore) &&
          // Sheets and dialogs stay in the page while closed: count only the shown ones.
          el.getClientRects().length > 0,
      )
      if (next === open) return
      open = next
      document.documentElement.toggleAttribute("data-menu-open", open)
      listeners.forEach((listener) => listener(open))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "open", "data-open", "data-menu-open", "popover", "hidden"],
    })
    document.addEventListener("toggle", schedule, true)
    check()
    stop = () => {
      observer.disconnect()
      document.removeEventListener("toggle", schedule, true)
      cancelAnimationFrame(frame)
      document.documentElement.removeAttribute("data-menu-open")
      open = false
    }
  }
  change(open)
  return () => {
    listeners.delete(change)
    if (!listeners.size) stop?.()
  }
}
