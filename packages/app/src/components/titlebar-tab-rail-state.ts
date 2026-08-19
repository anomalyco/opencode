import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"

export const TAB_RAIL_WIDTH_DEFAULT = 224
export const TAB_RAIL_WIDTH_MIN = 180
export const TAB_RAIL_WIDTH_MAX = 400
// Dragging the resizer narrower than this collapses the rail to icons only.
export const TAB_RAIL_COLLAPSE_THRESHOLD = 150
// Fixed width of the collapsed (icon-only) rail. Wide enough for a large icon
// button (36px) plus the rail's 8px padding on each side.
export const TAB_RAIL_COLLAPSED_WIDTH = 56

/**
 * Persisted layout state for the vertical tab rail: its expanded width and
 * whether it is collapsed to an icon-only strip. Shared as a single global
 * store so the width survives reloads and the collapse toggle stays in sync.
 */
export function createTabRailState() {
  const [store, setStore] = persisted(
    Persist.global("tab-rail"),
    createStore({
      width: TAB_RAIL_WIDTH_DEFAULT,
      collapsed: false,
    }),
  )

  return {
    width: () => store.width,
    collapsed: () => store.collapsed,
    resize: (width: number) =>
      setStore("width", Math.min(TAB_RAIL_WIDTH_MAX, Math.max(TAB_RAIL_WIDTH_MIN, width))),
    setCollapsed: (collapsed: boolean) => setStore("collapsed", collapsed),
    toggleCollapsed: () => setStore("collapsed", (value) => !value),
  }
}
