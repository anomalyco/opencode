import { headerBottom, keepUnderHeader } from "./under-header"

let anchors = 0

/**
 * Opens a dropdown's menu where it fits. Call it as soon as the menu is in the page, laid out by its
 * CSS against its positioning box (the trigger, or a split button): beside it, at its gap, with its
 * width and inline alignment. The menu opens below unless only above has room; with room on neither
 * side it takes the taller one and scrolls. The room above ends at the pinned header (under-header.ts).
 * Sideways it keeps 16px clear of the window's edges, and on phones takes that whole width (long rows
 * end in an ellipsis).
 *
 * The menu then moves to the top layer (a manual popover), so no scrolling box, such as the product
 * carousel's track, cuts it off, and stays tied to its box by CSS anchor positioning as the page
 * scrolls, cut where it passes under the header, which stays on top. A browser without anchor
 * positioning keeps it in its box.
 */
export function placeMenu(menu: HTMLElement) {
  const box = menu.offsetParent
  if (!(box instanceof HTMLElement)) return
  // Measured as laid out, not as drawn: the opening animation scales the menu from a corner.
  menu.style.animation = "none"
  const left = 16
  const right = document.documentElement.clientWidth - 16
  menu.style.maxWidth = `${right - left}px`
  if (window.matchMedia("(max-width: 40rem)").matches) menu.style.width = `${right - left}px`
  const anchor = box.getBoundingClientRect()
  const laid = menu.getBoundingClientRect()
  const gap = Math.max(0, laid.top >= anchor.bottom ? laid.top - anchor.bottom : anchor.top - laid.bottom)
  const below = window.innerHeight - anchor.bottom - gap - 8
  const above = anchor.top - gap - 8 - headerBottom(menu)
  const side = laid.height <= below || (laid.height > above && below >= above) ? "below" : "above"
  const room = side === "below" ? below : above
  const shift = Math.max(left - laid.left, Math.min(0, right - laid.right))

  menu.dataset.side = side
  menu.style.setProperty("--menu-shift", side === "below" ? "-4px" : "4px")
  menu.style.transformOrigin = `${getComputedStyle(menu).transformOrigin.split(" ")[0]} ${side === "below" ? "top" : "bottom"}`
  menu.style.maxHeight = laid.height > room ? `${Math.floor(room)}px` : ""
  menu.style.overflowY = laid.height > room ? "auto" : ""
  if (!CSS.supports("anchor-name: --menu") || typeof menu.showPopover !== "function") {
    menu.style.top = side === "below" ? `calc(100% + ${gap}px)` : "auto"
    menu.style.bottom = side === "above" ? `calc(100% + ${gap}px)` : "auto"
    menu.style.translate = shift ? `${shift}px 0` : ""
    menu.style.animation = ""
    return
  }
  const name = box.style.getPropertyValue("anchor-name") || `--menu-${++anchors}`
  box.style.setProperty("anchor-name", name)
  menu.style.setProperty("position-anchor", name)
  menu.style.position = "fixed"
  menu.style.inset = "auto"
  menu.style.left = `calc(anchor(left) + ${laid.left + shift - anchor.left}px)`
  if (side === "below") menu.style.top = `calc(anchor(bottom) + ${gap}px)`
  if (side === "above") menu.style.bottom = `calc(anchor(top) + ${gap}px)`
  // Its width as laid out against its box; a percentage would now be of the window.
  menu.style.width = `${laid.width}px`
  menu.style.minWidth = "0"
  menu.popover = "manual"
  menu.showPopover()
  menu.style.animation = ""
  keepUnderHeader(menu, box)
}
