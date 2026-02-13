import { batch, createMemo, onCleanup, type Accessor } from "solid-js"
import type { SetStoreFunction } from "solid-js/store"
import type { ClaxedoLayoutStore } from "./types"

export const RAIL_COLLAPSED_WIDTH = 56
export const RAIL_EXPANDED_WIDTH = 260
export const HOT_ZONE_WIDTH = 12

const EXPAND_DELAY_MS = 100
const COLLAPSE_DELAY_MS = 100

export function createRailState(input: { store: ClaxedoLayoutStore; setStore: SetStoreFunction<ClaxedoLayoutStore> }) {
  const { store, setStore } = input

  let expandTimer: number | undefined
  let collapseTimer: number | undefined
  let cooldownUntil: number | undefined
  let collapseNeeded = false

  onCleanup(() => {
    if (expandTimer) clearTimeout(expandTimer)
    if (collapseTimer) clearTimeout(collapseTimer)
  })

  const rail = {
    collapsed: (() => store.rail.collapsed) as Accessor<boolean>,
    hovered: (() => store.rail.hovered) as Accessor<boolean>,
    pinned: (() => store.rail.pinned) as Accessor<boolean>,
    locked: (() => store.rail.locked) as Accessor<boolean>,
    width: createMemo(() => (store.rail.collapsed && !store.rail.pinned ? RAIL_COLLAPSED_WIDTH : RAIL_EXPANDED_WIDTH)),

    lock() {
      setStore("rail", "locked", true)
    },

    unlock() {
      setStore("rail", "locked", false)
      if (collapseNeeded) {
        collapseNeeded = false
        rail.handleMouseLeave()
      }
    },

    expand() {
      if (collapseTimer) {
        clearTimeout(collapseTimer)
        collapseTimer = undefined
      }
      setStore("rail", "collapsed", false)
    },

    collapse() {
      if (store.rail.pinned) return
      if (expandTimer) {
        clearTimeout(expandTimer)
        expandTimer = undefined
      }
      setStore("rail", "collapsed", true)
      setStore("rail", "hovered", false)
    },

    toggle() {
      if (expandTimer) {
        clearTimeout(expandTimer)
        expandTimer = undefined
      }
      if (collapseTimer) {
        clearTimeout(collapseTimer)
        collapseTimer = undefined
      }

      batch(() => {
        if (store.rail.pinned) {
          setStore("rail", "pinned", false)
          setStore("rail", "collapsed", true)
          setStore("rail", "hovered", false)
          return
        }
        setStore("rail", "pinned", true)
        setStore("rail", "collapsed", false)
        setStore("rail", "hovered", false)
      })
    },

    pin() {
      setStore("rail", "pinned", true)
      setStore("rail", "collapsed", false)
    },

    unpin() {
      setStore("rail", "pinned", false)
    },

    handleHotZoneEnter() {
      if (store.rail.pinned || !store.rail.collapsed) return
      if (cooldownUntil && Date.now() < cooldownUntil) return

      setStore("rail", "hovered", true)

      if (collapseTimer) {
        clearTimeout(collapseTimer)
        collapseTimer = undefined
      }

      const timer = window.setTimeout(() => {
        setStore("rail", "collapsed", false)
        expandTimer = undefined
      }, EXPAND_DELAY_MS)

      expandTimer = timer
    },

    handleMouseLeave(e?: MouseEvent) {
      if (store.rail.pinned) return
      if (store.rail.locked) {
        collapseNeeded = true
        return
      }

      collapseNeeded = false

      if (expandTimer) {
        clearTimeout(expandTimer)
        expandTimer = undefined
      }

      const isLeavingToLeft = e && e.clientX <= HOT_ZONE_WIDTH
      const timer = window.setTimeout(() => {
        if (store.rail.locked) {
          collapseNeeded = true
          return
        }
        batch(() => {
          setStore("rail", "collapsed", true)
          setStore("rail", "hovered", false)
          collapseTimer = undefined
          if (isLeavingToLeft) {
            cooldownUntil = Date.now() + 500
          }
        })
      }, COLLAPSE_DELAY_MS)

      collapseTimer = timer
    },

    cancelCollapse() {
      collapseNeeded = false
      if (collapseTimer) {
        clearTimeout(collapseTimer)
        collapseTimer = undefined
      }
    },

    trackPosition(clientX: number, clientY: number, railRect: { top: number; right: number; bottom: number }) {
      if (store.rail.pinned) return

      if (store.rail.collapsed) {
        if (clientX <= HOT_ZONE_WIDTH) {
          rail.handleHotZoneEnter()
        }
        return
      }

      const isOutside = clientX > railRect.right || clientY < railRect.top || clientY > railRect.bottom
      if (isOutside) {
        if (!collapseTimer) {
          rail.handleMouseLeave()
        }
        return
      }

      rail.cancelCollapse()
    },
  }

  return rail
}
