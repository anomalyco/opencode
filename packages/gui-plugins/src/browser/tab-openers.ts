import type { Browser } from "@opencode/plugin-browser/rpc"

/**
 * Which tab each tab was opened from, while that still places the next one: Chrome's tab openers
 * (`TabStripModel` in chrome/browser/ui/tabs/tab_strip_model.cc). A tab with no entry was opened by nothing, or the
 * person has moved on since.
 */
export type Openers = ReadonlyMap<Browser.TabID, Browser.TabID>

/**
 * The tab a new tab stands after when `opener` opens it (`DetermineInsertionIndex`). One that takes the pane stands
 * right after its opener. One that stays behind stands after the tabs its opener already opened, and those they
 * opened, as far as they stand in a row to the opener's right, so several open in the order they were asked for.
 */
export function placedAfter(tabs: readonly Browser.TabID[], openers: Openers, opener: Browser.TabID, front: boolean) {
  if (front) return opener

  const family = new Set([opener])
  const row = tabs.slice(tabs.indexOf(opener) + 1)

  const end = row.findIndex((tab) => {
    const from = openers.get(tab)

    if (!from || !family.has(from)) return true
    family.add(tab)

    return false
  })

  return row.slice(0, end === -1 ? row.length : end).at(-1) ?? opener
}

/** The openers once `opener` has opened `tab`. A tab that takes the pane starts over: only it has an opener then. */
export function openersAfterOpen(openers: Openers, tab: Browser.TabID, opener: Browser.TabID, front: boolean): Openers {
  return new Map(front ? [] : openers).set(tab, opener)
}

/**
 * The openers once the person has selected `to` while `from` was in front (`OnActiveTabChanged`). Moving between a
 * tab and the tab that opened it, or between two tabs with the same opener or none, keeps them. Any other move is
 * the person going elsewhere, and every opener is forgotten.
 */
export function openersAfterSelect(openers: Openers, from: Browser.TabID | null, to: Browser.TabID): Openers {
  if (openers.size === 0 || from === null || from === to) return openers
  const next = openers.get(to)
  const previous = openers.get(from)

  return next === previous || next === from || previous === to ? openers : new Map()
}

/** The openers once `tab` has closed: what it opened counts as opened by its own opener (`FixOpeners`). */
export function openersAfterClose(openers: Openers, tab: Browser.TabID): Openers {
  if (openers.size === 0) return openers
  const parent = openers.get(tab)

  return new Map(
    Array.from(openers).flatMap(([child, opener]): [Browser.TabID, Browser.TabID][] => {
      if (child === tab) return []

      if (opener !== tab) return [[child, opener]]

      return parent ? [[child, parent]] : []
    }),
  )
}
