import type { SettingsView } from "./route"

/** How long a reveal looks for its target, which a scoped page may mount late or never. */
export const SEARCH_REVEAL_WAIT_MS = 5_000

/** How long a found row keeps its highlight when its animation never ends, as in a detached row. */
export const SEARCH_REVEAL_ANIMATION_MS = 2_500

/**
 * One activation's reveal: `navigating` until the route shows its activation, `seeking` its target in the page,
 * `highlighting` the found row, then `done`.
 */
export type SearchReveal =
  | { readonly phase: "navigating" | "seeking" | "highlighting"; readonly view: SettingsView }
  | { readonly phase: "done" }

/**
 * `activation` is the last activation issued; only `opened` and `revealing` own it. The route carries it as
 * `searchActivation`, so a view without it (a link inside the page, history) ends the activation.
 */
export type SettingsSearchState =
  | { readonly status: "idle"; readonly query: string; readonly activation: number }
  | {
      /** A Command Palette jump: it reveals its target without a sidebar search. */
      readonly status: "revealing"
      readonly activation: number
      readonly reveal: Exclude<SearchReveal, { readonly phase: "done" }>
    }
  | (Session & { readonly status: "browsing" })
  | (Session & {
      readonly status: "opened"
      readonly selected: string
      readonly reveal: SearchReveal
    })

type Session = {
  readonly query: string
  /** The view the search started on, where Back and Escape return from an opened result. */
  readonly origin: SettingsView
  readonly highlighted: string
  readonly scrollTop: number
  readonly expanded: boolean
  readonly activation: number
}

export type SettingsSearchEvent =
  | { readonly type: "input.changed"; readonly query: string; readonly view: SettingsView }
  | { readonly type: "expanded" }
  | { readonly type: "highlighted"; readonly id: string }
  | { readonly type: "scrolled"; readonly scrollTop: number }
  | { readonly type: "result.opened"; readonly id: string; readonly destination: SettingsView }
  | { readonly type: "palette.opened"; readonly destination: SettingsView }
  | { readonly type: "back.requested"; readonly view: SettingsView }
  | { readonly type: "escape.pressed"; readonly view: SettingsView }
  | { readonly type: "cleared" }
  | { readonly type: "view.synced"; readonly view: SettingsView }
  | { readonly type: "screen.unmounted" }
  | { readonly type: "settings.closed" }
  | { readonly type: "reveal.highlighted"; readonly activation: number }
  | { readonly type: "reveal.completed"; readonly activation: number }
  | { readonly type: "reveal.timed-out"; readonly activation: number }

export type SettingsSearchEffect =
  | { readonly type: "navigate"; readonly view: SettingsView }
  | { readonly type: "exit" }
  | {
      readonly type: "reveal.start"
      readonly activation: number
      readonly view: SettingsView
      readonly timeoutMs: number
    }
  | { readonly type: "reveal.highlight"; readonly activation: number; readonly timeoutMs: number }
  | { readonly type: "reveal.cancel" }

export type SettingsSearchTransition = {
  readonly state: SettingsSearchState
  readonly effects: readonly SettingsSearchEffect[]
}

type Active = Extract<SettingsSearchState, { readonly status: "browsing" | "opened" }>

type Opened = Extract<SettingsSearchState, { readonly status: "opened" }>

type Revealing = Extract<SettingsSearchState, { readonly status: "revealing" | "opened" }> & {
  readonly reveal: Exclude<SearchReveal, { readonly phase: "done" }>
}

const NO_EFFECTS: readonly SettingsSearchEffect[] = Object.freeze([])

const CANCEL: SettingsSearchEffect = Object.freeze({ type: "reveal.cancel" })

const EXIT: readonly SettingsSearchEffect[] = Object.freeze([{ type: "exit" }])

export function createSettingsSearchState(): SettingsSearchState {
  return { status: "idle", query: "", activation: 0 }
}

export function transitionSettingsSearch(
  state: SettingsSearchState,
  event: SettingsSearchEvent,
): SettingsSearchTransition {
  switch (event.type) {
    case "input.changed":
      return input(state, event.query, event.view)
    case "expanded":
      if (!isSearchActive(state) || state.expanded) return unchanged(state)

      return changed({ ...state, expanded: true })
    case "highlighted":
      if (!isSearchActive(state) || !event.id || event.id === state.highlighted) return unchanged(state)

      return changed({ ...state, highlighted: event.id })
    case "scrolled":
      if (!isSearchActive(state) || event.scrollTop === state.scrollTop) return unchanged(state)

      return changed({ ...state, scrollTop: event.scrollTop })
    case "result.opened": {
      if (!isSearchActive(state)) return unchanged(state)
      const activation = state.activation + 1
      const view = { ...event.destination, searchActivation: activation }

      return changed(
        {
          status: "opened",
          query: state.query,
          origin: state.origin,
          selected: event.id,
          highlighted: event.id,
          scrollTop: state.scrollTop,
          expanded: false,
          activation,
          reveal: { phase: "navigating", view },
        },
        [...cancel(state), { type: "navigate", view }],
      )
    }
    case "palette.opened": {
      const activation = state.activation + 1
      const view = { ...event.destination, searchActivation: activation }

      return changed({ status: "revealing", activation, reveal: { phase: "navigating", view } }, [
        ...cancel(state),
        { type: "navigate", view },
      ])
    }
    case "back.requested":
      if (state.status !== "opened" || !canReturnToSearchOrigin(state, event.view)) return unchanged(state)

      return returnToOrigin(state)
    case "escape.pressed":
      if (state.status === "opened" && canReturnToSearchOrigin(state, event.view)) return returnToOrigin(state)

      // The sidebar search only shows on root pages, so only there does Escape clear it.
      if (isSearchActive(state) && event.view.type === "root") return changed(idle(state), cancel(state))

      return { state, effects: EXIT }
    case "cleared":
      if (state.status === "idle" && state.query === "") return unchanged(state)

      return changed(idle(state), cancel(state))
    case "view.synced":
      return synced(state, event.view)
    case "screen.unmounted":
      // The page that held the reveal is gone; a remounted page starts it again.
      if (!hasActiveReveal(state) || state.reveal.phase === "navigating") return unchanged(state)

      return changed({ ...state, reveal: { phase: "navigating", view: state.reveal.view } }, [CANCEL])
    case "settings.closed":
      if (state.status === "idle" && state.query === "") return unchanged(state)

      return changed(idle(state), cancel(state))
    case "reveal.highlighted":
      if (!hasActiveReveal(state) || event.activation !== state.activation || state.reveal.phase !== "seeking")
        return unchanged(state)

      return changed({ ...state, reveal: { phase: "highlighting", view: state.reveal.view } }, [
        { type: "reveal.highlight", activation: state.activation, timeoutMs: SEARCH_REVEAL_ANIMATION_MS },
      ])
    case "reveal.completed":
    case "reveal.timed-out":
      if (!hasActiveReveal(state) || event.activation !== state.activation || state.reveal.phase === "navigating")
        return unchanged(state)

      if (state.status === "revealing") return changed(idle(state), [CANCEL])

      return changed({ ...state, reveal: { phase: "done" } }, [CANCEL])
  }
}

export function selectSearchQuery(state: SettingsSearchState) {
  return state.status === "revealing" ? "" : state.query
}

export function isSearchActive(state: SettingsSearchState): state is Active {
  return state.status === "browsing" || state.status === "opened"
}

/** Whether the results are expanded; opening a result collapses them, which only the narrow layout shows. */
export function isSearchExpanded(state: SettingsSearchState) {
  return isSearchActive(state) && state.expanded
}

export function selectSearchSelected(state: SettingsSearchState) {
  return state.status === "opened" ? state.selected : undefined
}

export function selectSearchHighlighted(state: SettingsSearchState) {
  return isSearchActive(state) ? state.highlighted || undefined : undefined
}

export function selectSearchScrollTop(state: SettingsSearchState) {
  return isSearchActive(state) ? state.scrollTop : 0
}

/** Whether Back and Escape on a page opened from a sidebar result return to where that search started. */
export function canReturnToSearchOrigin(state: SettingsSearchState, view: SettingsView) {
  return state.status === "opened" && view.type !== "root" && view.searchActivation === state.activation
}

function input(state: SettingsSearchState, query: string, view: SettingsView): SettingsSearchTransition {
  if (!query.trim()) {
    if (state.status === "idle") return query === state.query ? unchanged(state) : changed({ ...state, query })

    return changed({ status: "idle", query, activation: state.activation }, cancel(state))
  }

  // Typing on an opened result refines the results and keeps the opened page, its reveal, and its way back.
  if (state.status === "opened") return changed({ ...state, query, highlighted: "", scrollTop: 0, expanded: true })

  return changed(
    {
      status: "browsing",
      query,
      origin: state.status === "browsing" ? state.origin : { ...view, target: undefined, searchActivation: undefined },
      highlighted: "",
      scrollTop: 0,
      expanded: true,
      activation: state.activation,
    },
    cancel(state),
  )
}

function synced(state: SettingsSearchState, view: SettingsView): SettingsSearchTransition {
  if (state.status !== "opened" && state.status !== "revealing") return unchanged(state)

  // A page reached another way (a link inside the page, history) ends the activation and its way back.
  if (view.searchActivation !== state.activation) {
    if (state.status === "revealing") return changed(idle(state), [CANCEL])

    return changed(
      {
        status: "browsing",
        query: state.query,
        origin: state.origin,
        highlighted: state.highlighted,
        scrollTop: state.scrollTop,
        expanded: state.expanded,
        activation: state.activation,
      },
      cancel(state),
    )
  }

  if (state.reveal.phase !== "navigating") return unchanged(state)

  return changed({ ...state, reveal: { phase: "seeking", view: state.reveal.view } }, [
    { type: "reveal.start", activation: state.activation, view: state.reveal.view, timeoutMs: SEARCH_REVEAL_WAIT_MS },
  ])
}

function returnToOrigin(state: Opened): SettingsSearchTransition {
  return changed(
    {
      status: "browsing",
      query: state.query,
      origin: state.origin,
      highlighted: state.selected,
      scrollTop: state.scrollTop,
      expanded: true,
      activation: state.activation,
    },
    [...cancel(state), { type: "navigate", view: state.origin }],
  )
}

function idle(state: SettingsSearchState): SettingsSearchState {
  return { status: "idle", query: "", activation: state.activation }
}

function hasActiveReveal(state: SettingsSearchState): state is Revealing {
  return state.status === "revealing" || (state.status === "opened" && state.reveal.phase !== "done")
}

// A reveal still navigating has started nothing in the page yet.
function cancel(state: SettingsSearchState) {
  return hasActiveReveal(state) && state.reveal.phase !== "navigating" ? [CANCEL] : NO_EFFECTS
}

function changed(state: SettingsSearchState, effects: readonly SettingsSearchEffect[] = NO_EFFECTS) {
  return { state, effects }
}

function unchanged(state: SettingsSearchState): SettingsSearchTransition {
  return { state, effects: NO_EFFECTS }
}
