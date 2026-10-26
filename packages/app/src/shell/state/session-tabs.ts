/** Where a tab shows: the side pane, the pane split below it, or the bottom pane under the session. */
export type SessionPane = "side" | "split" | "bottom"

export const SESSION_PANES: readonly SessionPane[] = ["side", "split", "bottom"]

export type SessionTabs = {
  active?: string
  all: string[]
  /** The pane of each stored tab outside the side pane. */
  panes?: Record<string, "split" | "bottom">
  /** The tab each pane shows; the pane holding `active` shows `active`. */
  selected?: Partial<Record<SessionPane, string>>
}

export type SessionTabState = {
  tabs: SessionTabs
  preview?: string
}

export const sessionTabPane = (tabs: SessionTabs, tab: string): SessionPane => tabs.panes?.[tab] ?? "side"

const paneTabs = (tabs: SessionTabs, pane: SessionPane) => tabs.all.filter((tab) => sessionTabPane(tabs, tab) === pane)

/**
 * Carries pane placement from `previous` into `next`, the strip and selection a tab operation just wrote. Kept tabs
 * keep their pane unless `next` places them. A new tab goes to `target` when given, else to the pane of the tab it
 * replaced in place (a preview), else to the pane of the last tab of its extension, else to the side pane. A pane
 * whose shown tab left shows that tab's nearest neighbour.
 */
export function placeSessionTabs(previous: SessionTabs, next: SessionTabs, target?: SessionPane): SessionTabs {
  const kept = new Set(previous.all)
  const placement = next.panes ? next : previous

  const placed = (tab: string, index: number): SessionPane => {
    if (kept.has(tab)) return sessionTabPane(placement, tab)

    if (target) return target
    const replaced = previous.all[index]

    if (replaced !== undefined && !next.all.includes(replaced)) return sessionTabPane(previous, replaced)
    const extension = tab.slice(0, tab.indexOf(":") + 1)
    const sibling = extension ? previous.all.findLast((item) => item.startsWith(extension)) : undefined

    return sibling ? sessionTabPane(previous, sibling) : "side"
  }

  const panes: Record<string, "split" | "bottom"> = Object.fromEntries(
    next.all.flatMap((tab, index) => {
      const pane = placed(tab, index)

      return pane === "side" ? [] : [[tab, pane]]
    }),
  )

  const tabs = { all: next.all, panes }
  const activePane = next.active === undefined ? undefined : sessionTabPane(tabs, next.active)

  const selected: Partial<Record<SessionPane, string>> = Object.fromEntries(
    SESSION_PANES.flatMap((pane) => {
      if (pane === activePane) return [[pane, next.active]]
      const shown = sessionPaneTab(previous, pane)
      const members = paneTabs(tabs, pane)

      if (shown === undefined) return members.length > 0 && pane !== "side" ? [[pane, members[0]]] : []

      // A tab the strip never stored, e.g. a pinned one, shows in the side pane.
      if (members.includes(shown) || (pane === "side" && !kept.has(shown) && !next.all.includes(shown)))
        return [[pane, shown]]

      const before = paneTabs(previous, pane)
      const index = before.indexOf(shown)

      const neighbour = [...before.slice(0, Math.max(0, index)).toReversed(), ...before.slice(index + 1)].find((tab) =>
        members.includes(tab),
      )

      const fallback = neighbour ?? members[0]

      return fallback === undefined ? [] : [[pane, fallback]]
    }),
  )

  return {
    all: next.all,
    active: next.active,
    panes: Object.keys(panes).length > 0 ? panes : undefined,
    selected: Object.keys(selected).length > 0 ? selected : undefined,
  }
}

/**
 * Moves `tab` into `pane` and selects it: before `before`, at the pane's start when `before` is a tab the strip does
 * not store (a pinned one), or at the pane's end without `before`.
 */
export function moveSessionTab(current: SessionTabs, tab: string, pane: SessionPane, before?: string): SessionTabs {
  const rest = current.all.filter((item) => item !== tab)
  const members = rest.filter((item) => sessionTabPane(current, item) === pane)
  const anchor = before === undefined ? undefined : members.includes(before) ? before : members[0]
  const last = members.at(-1)

  const position =
    anchor !== undefined ? rest.indexOf(anchor) : last !== undefined ? rest.indexOf(last) + 1 : rest.length

  const panes = Object.fromEntries(Object.entries(current.panes ?? {}).filter(([key]) => key !== tab))

  return placeSessionTabs(current, {
    all: [...rest.slice(0, position), tab, ...rest.slice(position)],
    active: tab,
    panes: pane === "side" ? panes : { ...panes, [tab]: pane },
  })
}

/** The tab a pane shows: the active tab in its pane, else the pane's own selection. */
export function sessionPaneTab(tabs: SessionTabs, pane: SessionPane) {
  if (tabs.active !== undefined && sessionTabPane(tabs, tabs.active) === pane) return tabs.active

  return tabs.selected?.[pane]
}

/**
 * A launcher tab (e.g. the file browser) stays replaceable by the next preview even after reload. With several
 * launchers open, the selected one is the one its pick replaces.
 */
const sessionTabPreview = (current: SessionTabState, launchers: ReadonlySet<string>) => {
  const active = current.tabs.active

  if (active && launchers.has(active)) return active

  return current.preview ?? current.tabs.all.find((tab) => launchers.has(tab))
}

export function previewSessionTab(
  current: SessionTabState,
  tab: string,
  launchers: ReadonlySet<string> = new Set(),
): SessionTabState {
  const preview = sessionTabPreview(current, launchers)
  const previewIndex = preview ? current.tabs.all.indexOf(preview) : -1
  const existingIndex = current.tabs.all.indexOf(tab)

  if (existingIndex !== -1) {
    if (previewIndex === -1 || preview === tab) {
      return { tabs: { all: current.tabs.all, active: tab }, preview: preview === tab ? tab : undefined }
    }

    return {
      tabs: { all: current.tabs.all.filter((item) => item !== preview), active: tab },
    }
  }

  if (previewIndex === -1) {
    return { tabs: { all: [...current.tabs.all, tab], active: tab }, preview: tab }
  }

  return {
    tabs: {
      all: current.tabs.all.map((item, index) => (index === previewIndex ? tab : item)),
      active: tab,
    },
    preview: tab,
  }
}

/** A `first` tab is stored first and keeps the preview tab, so closing it selects the first remaining tab. */
export function openSessionTab(
  current: SessionTabState,
  tab: string,
  launchers: ReadonlySet<string> = new Set(),
  first = false,
): SessionTabState {
  const preview = sessionTabPreview(current, launchers)

  if (first) {
    return {
      tabs: { all: [tab, ...current.tabs.all.filter((item) => item !== tab)], active: tab },
      preview,
    }
  }

  const previewIndex = preview ? current.tabs.all.indexOf(preview) : -1
  const existingIndex = current.tabs.all.indexOf(tab)

  if (existingIndex !== -1) {
    if (previewIndex === -1 || preview === tab) {
      return { tabs: { all: current.tabs.all, active: tab } }
    }

    return {
      tabs: { all: current.tabs.all.filter((item) => item !== preview), active: tab },
    }
  }

  if (previewIndex === -1) {
    return { tabs: { all: [...current.tabs.all, tab], active: tab } }
  }

  return {
    tabs: {
      all: current.tabs.all.map((item, index) => (index === previewIndex ? tab : item)),
      active: tab,
    },
  }
}

export function closeSessionTab(current: SessionTabState, tab: string): SessionTabState {
  const all = current.tabs.all.filter((item) => item !== tab)
  const preview = current.preview === tab ? undefined : current.preview

  if (current.tabs.active !== tab) return { tabs: { ...current.tabs, all }, preview }

  // The next tab of the same pane takes the selection, else the tab another pane shows.
  const pane = sessionTabPane(current.tabs, tab)
  const members = paneTabs(current.tabs, pane)
  const index = members.indexOf(tab)
  const other = SESSION_PANES.flatMap((item) => (item === pane ? [] : (sessionPaneTab(current.tabs, item) ?? [])))

  return {
    tabs: {
      ...current.tabs,
      all,
      active: members[index - 1] ?? members[index + 1] ?? other.find((item) => all.includes(item)) ?? all[0],
    },
    preview,
  }
}
