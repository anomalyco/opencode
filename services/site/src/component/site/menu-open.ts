import { onCleanup } from "solid-js"
import { addMenuCloser, runMenuClosers } from "./menu-closers"

/**
 * Registers a menu's close with closeAllMenus (menu-closers.ts). Call it while a component is created;
 * the close is dropped again when the component is cleaned up.
 */
export function onCloseMenus(close: () => void) {
  onCleanup(addMenuCloser(close))
}

/** Closes every registered menu, sheet and pop-up, and the `<details>` menus, with their submenus. */
export function closeAllMenus() {
  runMenuClosers()
  document
    .querySelectorAll<HTMLDetailsElement>('details[data-component="contents-menu"][open], details[data-menu][open]')
    .forEach((details) => (details.open = false))
}

// Where a link is a menu's item: menus, flyouts, pop-ups, sheets, dialogs and disclosure menus.
const menuContainers = [
  '[role="menu"]',
  '[data-slot="menu"]',
  '[data-slot="submenu"]',
  "[popover]",
  "dialog",
  'details[data-component="contents-menu"]',
  "details[data-menu]",
  '[data-component="site-menu-sheet"]',
  '[data-slot="section-body"]',
].join(", ")

// When an internal link in a menu was last chosen; a link that only downloads never navigates, so
// the mark expires.
let chosen = 0

/**
 * Whether this navigation came from a link just chosen in a menu (then cleared), so the new page's
 * content can take focus instead of the menu's trigger.
 */
export function takeMenuNavigation() {
  const recent = performance.now() - chosen < 2000
  chosen = 0
  return recent
}

/**
 * Closes every menu once a link inside one is chosen (click, tap or Enter), whether it navigates,
 * jumps on the page, downloads or opens a new tab. Links that open a submenu don't count. The link is
 * read in the capture phase, while its menu is still in the page, and the menus close after the
 * event, so the link's own handlers and the router's still run. Returns the function that stops it.
 */
export function closeMenusOnLinks() {
  const click = (event: MouseEvent) => {
    const link = (event.target as Element).closest?.<HTMLAnchorElement>("a[href]")
    if (!link || link.matches("[aria-haspopup], [aria-expanded]") || !link.closest(menuContainers)) return
    chosen = !link.target && !link.hasAttribute("download") && link.origin === location.origin ? performance.now() : 0
    setTimeout(closeAllMenus)
  }
  document.addEventListener("click", click, true)
  return () => document.removeEventListener("click", click, true)
}
