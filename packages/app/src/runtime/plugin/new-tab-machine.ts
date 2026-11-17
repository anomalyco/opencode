import { SESSION_PANES, type SessionPane } from "@/shell/state/session-tabs"

/** A pane's drawn tabs and the tab it selects. */
export type PaneTabSnapshot = {
  readonly active: string | undefined
  readonly keys: readonly string[]
}

/** What the region shows, read each time it changes. */
export type RegionTabSnapshot = {
  /** The routed session's key. */
  readonly session: string
  /** The strip holds no tab, hidden ones included. */
  readonly empty: boolean
  /** The tab the region selects, in any pane. */
  readonly regionActive: string | undefined
  /** The side region is open on screen, after the layout loaded. */
  readonly sideOpen: boolean
  readonly panes: Readonly<Record<SessionPane, PaneTabSnapshot>>
}

/** A pane's New tabs, in strip order, and the one it shows over its selected tab. */
export type PaneNewTabs = {
  readonly ids: readonly string[]
  /** Always `undefined` or an element of `ids`. */
  readonly chosen: string | undefined
}

/**
 * The host's New tab views, each listing the launchers in a pane until the user closes it or a tab opened from it
 * replaces it. They belong to the session they opened in.
 */
export type NewTabsState = {
  readonly serial: number
  readonly session: string
  /** The current session is in an open-and-empty span of the side region, which opened its New tab once. */
  readonly openedEmpty: boolean
  readonly panes: Readonly<Record<SessionPane, PaneNewTabs>>
  /** The region as the last `sync` saw it, which the next one compares against. */
  readonly snapshot: RegionTabSnapshot | undefined
}

export type NewTabsEvent =
  | { readonly type: "sync"; readonly snapshot: RegionTabSnapshot }
  | { readonly type: "open"; readonly pane: SessionPane }
  | { readonly type: "select.new"; readonly pane: SessionPane; readonly id: string }
  /** The user selects a tab of the pane, which shows over its New tabs. */
  | { readonly type: "select.tab"; readonly pane: SessionPane }
  /** `empty`: the strip holds no tab, so closing the last New tab empties the region. */
  | { readonly type: "dismiss"; readonly id: string; readonly empty: boolean }

/** The last New tab of a strip with no tabs closed: the region closes, as closing its last tab does. */
export type NewTabsEffect = { readonly type: "emptied" }

export type NewTabsTransition = {
  readonly state: NewTabsState
  readonly effects: readonly NewTabsEffect[]
}

export function createNewTabsState(): NewTabsState {
  return { serial: 0, session: "", openedEmpty: false, panes: emptyPanes(), snapshot: undefined }
}

export function transitionNewTabs(state: NewTabsState, event: NewTabsEvent): NewTabsTransition {
  if (event.type === "sync") return { state: sync(state, event.snapshot), effects: [] }

  if (event.type === "open") return { state: open(state, event.pane), effects: [] }

  if (event.type === "select.new") {
    const pane = state.panes[event.pane]

    if (!pane.ids.includes(event.id) || pane.chosen === event.id) return { state, effects: [] }

    return { state: withPane(state, event.pane, { ids: pane.ids, chosen: event.id }), effects: [] }
  }

  if (event.type === "select.tab") {
    const pane = state.panes[event.pane]

    if (pane.chosen === undefined) return { state, effects: [] }

    return { state: withPane(state, event.pane, { ids: pane.ids, chosen: undefined }), effects: [] }
  }

  const owner = SESSION_PANES.find((pane) => state.panes[pane].ids.includes(event.id))

  if (!owner) return { state, effects: [] }

  // Closing the shown New tab shows the one after it, else the one before, as a browser does.
  const pane = state.panes[owner]
  const index = pane.ids.indexOf(event.id)
  const chosen = pane.chosen === event.id ? (pane.ids[index + 1] ?? pane.ids[index - 1]) : pane.chosen
  const next = withPane(state, owner, { ids: pane.ids.filter((id) => id !== event.id), chosen })

  return { state: next, effects: event.empty && !selectHasNewTabs(next) ? [{ type: "emptied" }] : [] }
}

/** The New tabs a pane lists, in strip order. */
export function selectPaneNewTabs(state: NewTabsState, pane: SessionPane) {
  return state.panes[pane].ids
}

/** The New tab a pane shows: the chosen one, else the newest while the pane selects no tab. */
export function selectShownNewTab(state: NewTabsState, pane: SessionPane, paneActive: string | undefined) {
  return shown(state.panes[pane], paneActive)
}

export function selectHasNewTabs(state: NewTabsState) {
  return SESSION_PANES.some((pane) => state.panes[pane].ids.length > 0)
}

function sync(state: NewTabsState, snapshot: RegionTabSnapshot): NewTabsState {
  // Another session starts with none, and opens one when it routes into an open, empty side region.
  if (snapshot.session !== state.session) {
    const reset = { ...state, session: snapshot.session, panes: emptyPanes(), snapshot }
    const openedEmpty = snapshot.sideOpen && snapshot.empty

    return openedEmpty ? open({ ...reset, openedEmpty }, "side") : { ...reset, openedEmpty }
  }

  const previous = state.snapshot
  const listed = new Set(SESSION_PANES.flatMap((pane) => snapshot.panes[pane].keys))

  const syncPane = (pane: SessionPane): PaneNewTabs => {
    const current = state.panes[pane]
    const next = snapshot.panes[pane]

    // A split or bottom pane closes with its last tab, and its New tabs go with it.
    if (pane !== "side" && next.keys.length === 0)
      return current.ids.length === 0 ? current : { ids: [], chosen: undefined }

    if (!previous) return current
    const before = previous.panes[pane]
    const replaced = shown(current, before.active)

    if (!replaced || !replacedBy(before, next, previous.regionActive, listed)) return current

    return { ids: current.ids.filter((id) => id !== replaced), chosen: undefined }
  }

  const panes = { side: syncPane("side"), split: syncPane("split"), bottom: syncPane("bottom") }
  const changed = SESSION_PANES.some((pane) => panes[pane] !== state.panes[pane])

  const synced: NewTabsState = {
    ...state,
    panes: changed ? panes : state.panes,
    snapshot: previous && sameSnapshot(previous, snapshot) ? previous : snapshot,
  }

  // Opening the side region with no tabs shows a New tab, once per opening. One left from an earlier opening shows
  // again rather than being joined by another.
  const want = snapshot.sideOpen && snapshot.empty
  const opened = want && !state.openedEmpty

  const result =
    opened && selectShownNewTab(synced, "side", snapshot.panes.side.active) === undefined
      ? open({ ...synced, openedEmpty: true }, "side")
      : { ...synced, openedEmpty: want }

  if (result.panes === state.panes && result.openedEmpty === state.openedEmpty && result.snapshot === previous)
    return state

  return result
}

/**
 * A tab that selects itself while a New tab shows replaces that New tab, as one a launcher in it opens does: a tab new
 * to the pane, or a listed tab while the tab the pane and region selected stay listed. A pane falling back to another
 * tab after its own or the region's selected tab closed or moved away keeps it.
 */
function replacedBy(
  before: PaneTabSnapshot,
  next: PaneTabSnapshot,
  regionActive: string | undefined,
  listed: ReadonlySet<string>,
) {
  if (next.active === undefined || next.active === before.active) return false

  if (!before.keys.includes(next.active)) return true

  return (
    (before.active === undefined || next.keys.includes(before.active)) &&
    (regionActive === undefined || listed.has(regionActive))
  )
}

function open(state: NewTabsState, pane: SessionPane): NewTabsState {
  const serial = state.serial + 1
  const id = `new:${serial}`

  return { ...withPane(state, pane, { ids: [...state.panes[pane].ids, id], chosen: id }), serial }
}

function shown(pane: PaneNewTabs, paneActive: string | undefined) {
  return pane.chosen ?? (paneActive === undefined ? pane.ids.at(-1) : undefined)
}

function withPane(state: NewTabsState, pane: SessionPane, value: PaneNewTabs): NewTabsState {
  return { ...state, panes: { ...state.panes, [pane]: value } }
}

function emptyPanes(): Record<SessionPane, PaneNewTabs> {
  return {
    side: { ids: [], chosen: undefined },
    split: { ids: [], chosen: undefined },
    bottom: { ids: [], chosen: undefined },
  }
}

function sameSnapshot(a: RegionTabSnapshot, b: RegionTabSnapshot) {
  return (
    a.session === b.session &&
    a.empty === b.empty &&
    a.regionActive === b.regionActive &&
    a.sideOpen === b.sideOpen &&
    SESSION_PANES.every(
      (pane) =>
        a.panes[pane].active === b.panes[pane].active &&
        a.panes[pane].keys.length === b.panes[pane].keys.length &&
        a.panes[pane].keys.every((key, index) => key === b.panes[pane].keys[index]),
    )
  )
}
