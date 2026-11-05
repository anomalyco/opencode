// How far the session header gave way so the title fits: the worktree name hides first, then the project name, then the
// actions drop their details (`compact`). Runs on every header resize, so it returns the same object when nothing
// changes and the steady states are frozen singletons. Keep it in a signal, never a Solid store.
export type HeaderFitState =
  | { readonly status: "full" }
  | { readonly status: "worktree-hidden" }
  | { readonly status: "project-hidden" }
  | {
      readonly status: "compact"
      /** The actions' expanded width on entry, until the compact width is measured. */
      readonly expandedWidth: number | undefined
      /** The width compacting freed. Expanding takes it back, whatever the actions beside the details do meanwhile. */
      readonly saved: number
    }

export type HeaderFitMeasuredEvent = {
  readonly type: "measured"
  readonly locationWidth: number
  readonly titleBoxWidth: number
  /** What the title section's content needs. */
  readonly titleWidth: number
  readonly projectWidth: number
  readonly worktreeWidth: number
  readonly hasWorktree: boolean
  /** The location's maximum width. */
  readonly limit: number
  readonly hasActions: boolean
  readonly actionsWidth: number
}

/** The actions were measured right after they rendered compact. */
export type HeaderFitCompactSettledEvent = {
  readonly type: "compact.settled"
  readonly actionsWidth: number
}

export type HeaderFitEvent = HeaderFitMeasuredEvent | HeaderFitCompactSettledEvent

export const INITIAL_HEADER_FIT_STATE: HeaderFitState = Object.freeze({ status: "full" })

const WORKTREE_HIDDEN: HeaderFitState = Object.freeze({ status: "worktree-hidden" })

const PROJECT_HIDDEN: HeaderFitState = Object.freeze({ status: "project-hidden" })

export function transitionHeaderFit(state: HeaderFitState, event: HeaderFitEvent): HeaderFitState {
  if (event.type === "compact.settled") {
    if (state.status !== "compact" || state.expandedWidth === undefined) return state

    return { status: "compact", expandedWidth: undefined, saved: Math.max(0, state.expandedWidth - event.actionsWidth) }
  }

  // Hidden labels keep their intrinsic width, so fitting never depends on a previous truncation.
  const collapse = headerFitCollapse(state)

  const expanded =
    event.locationWidth + (collapse >= 1 ? event.worktreeWidth : 0) + (collapse >= 2 ? event.projectWidth : 0)

  const saved =
    state.status !== "compact"
      ? 0
      : state.expandedWidth === undefined
        ? state.saved
        : Math.max(0, state.expandedWidth - event.actionsWidth)

  // Everything outside the location and title sections is reserved for the actions, so candidates are fitted against
  // expanded actions: compact actions expand again once the title fits beside them.
  const available = event.locationWidth + event.titleBoxWidth - event.titleWidth - saved

  if (Math.min(expanded, event.limit) <= available) return INITIAL_HEADER_FIT_STATE

  if (event.hasWorktree && Math.min(expanded - event.worktreeWidth, event.limit) <= available) return WORKTREE_HIDDEN

  if (!event.hasActions || Math.min(expanded - event.worktreeWidth - event.projectWidth, event.limit) <= available)
    return PROJECT_HIDDEN

  if (state.status !== "compact") return { status: "compact", expandedWidth: event.actionsWidth, saved: 0 }

  if (state.expandedWidth === undefined) return state

  return { status: "compact", expandedWidth: undefined, saved }
}

/** 0 shows the whole location, 1 hides the worktree name, 2 also hides the project name. */
export function headerFitCollapse(state: HeaderFitState) {
  if (state.status === "full") return 0

  if (state.status === "worktree-hidden") return 1

  return 2
}

/** The title does not fit even with the location collapsed, so the actions show without their details. */
export function headerFitCompact(state: HeaderFitState) {
  return state.status === "compact"
}
