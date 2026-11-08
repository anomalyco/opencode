import type { Demand } from "./model"

/** One `Changes.watch` hold: which view shows the screen's changes. */
export type ReviewScreenWatch = { readonly id: number; readonly source: keyof Demand }

export type ReviewScreenEntry =
  /** Views watch the screen's changes before it routes a session or renders the review panel. */
  | { readonly phase: "watching"; readonly watches: readonly ReviewScreenWatch[] }
  /** The screen has a review model, kept while it is routed, a review panel renders it, or a view watches it. */
  | {
      readonly phase: "ready"
      /** The model's number; a dispose for another number is stale. */
      readonly attempt: number
      readonly panels: readonly number[]
      readonly watches: readonly ReviewScreenWatch[]
    }

/** The review model of each session screen. Screens and leases are numbered by the driver. */
export type ReviewScreenState =
  | {
      readonly status: "active"
      /** The last model number handed out. */
      readonly issued: number
      /** The screen the route shows. */
      readonly routed: number | undefined
      readonly entries: Readonly<Record<number, ReviewScreenEntry>>
    }
  | { readonly status: "disposed" }

export type ReviewScreenEvent =
  | { readonly type: "route.entered"; readonly screenID: number }
  | { readonly type: "route.left" }
  | { readonly type: "panel.mounted"; readonly screenID: number; readonly panelID: number }
  | { readonly type: "panel.unmounted"; readonly screenID: number; readonly panelID: number }
  | { readonly type: "watch.added"; readonly screenID: number; readonly watchID: number; readonly source: keyof Demand }
  | { readonly type: "watch.removed"; readonly screenID: number; readonly watchID: number }
  | { readonly type: "disposed" }

export type ReviewScreenEffect =
  | { readonly type: "model.create"; readonly screenID: number; readonly attempt: number }
  | { readonly type: "model.dispose"; readonly screenID: number; readonly attempt: number }

export type ReviewScreenTransition = {
  readonly state: ReviewScreenState
  readonly effects: readonly ReviewScreenEffect[]
}

type Active = Extract<ReviewScreenState, { status: "active" }>

export const INITIAL_REVIEW_SCREEN_STATE: ReviewScreenState = {
  status: "active",
  issued: 0,
  routed: undefined,
  entries: {},
}

const NONE: readonly ReviewScreenEffect[] = []

export function transitionReviewScreen(state: ReviewScreenState, event: ReviewScreenEvent): ReviewScreenTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      effects: Object.entries(state.entries).flatMap(([id, entry]): ReviewScreenEffect[] =>
        entry.phase === "ready" ? [{ type: "model.dispose", screenID: Number(id), attempt: entry.attempt }] : [],
      ),
    }

  if (event.type === "route.entered") {
    if (state.routed === event.screenID) return unchanged(state)
    const routed = { ...state, routed: event.screenID }

    const entered =
      routed.entries[event.screenID]?.phase === "ready" ? changed(routed) : create(routed, event.screenID, [])

    return state.routed === undefined ? entered : settle(entered, state.routed)
  }

  if (event.type === "route.left")
    return state.routed === undefined
      ? unchanged(state)
      : settle(changed({ ...state, routed: undefined }), state.routed)

  const entry = state.entries[event.screenID]

  // A panel can render its screen before the route publishes it, as on a server switch: it gets the model at once.
  if (event.type === "panel.mounted") {
    if (entry?.phase !== "ready") return create(state, event.screenID, [event.panelID])

    if (entry.panels.includes(event.panelID)) return unchanged(state)

    return changed(put(state, event.screenID, { ...entry, panels: [...entry.panels, event.panelID] }))
  }

  if (event.type === "panel.unmounted") {
    if (entry?.phase !== "ready" || !entry.panels.includes(event.panelID)) return unchanged(state)

    return settle(
      changed(put(state, event.screenID, { ...entry, panels: entry.panels.filter((id) => id !== event.panelID) })),
      event.screenID,
    )
  }

  if (event.type === "watch.added") {
    if (entry?.watches.some((watch) => watch.id === event.watchID)) return unchanged(state)
    const watch: ReviewScreenWatch = { id: event.watchID, source: event.source }

    return changed(
      put(
        state,
        event.screenID,
        entry ? { ...entry, watches: [...entry.watches, watch] } : { phase: "watching", watches: [watch] },
      ),
    )
  }

  // A released watch releases only its own hold, once.
  if (!entry?.watches.some((watch) => watch.id === event.watchID)) return unchanged(state)

  return settle(
    changed(
      put(state, event.screenID, { ...entry, watches: entry.watches.filter((watch) => watch.id !== event.watchID) }),
    ),
    event.screenID,
  )
}

/** The number of the screen's live model, if it has one. */
export function reviewScreenModel(state: ReviewScreenState, screenID: number) {
  if (state.status !== "active") return undefined
  const entry = state.entries[screenID]

  return entry?.phase === "ready" ? entry.attempt : undefined
}

/** The screens with a model, the routed one first. */
export function reviewScreenModels(state: ReviewScreenState) {
  if (state.status !== "active") return []
  const ids = Object.keys(state.entries).map(Number)

  return (state.routed === undefined ? ids : [state.routed, ...ids.filter((id) => id !== state.routed)]).filter(
    (id) => state.entries[id]?.phase === "ready",
  )
}

/** How many views of each kind show the screen's changes. */
export function reviewScreenDemand(state: ReviewScreenState, screenID: number): Demand {
  const watches = state.status === "active" ? (state.entries[screenID]?.watches ?? []) : []
  const count = (source: keyof Demand) => watches.filter((watch) => watch.source === source).length

  return { tree: count("tree"), files: count("files"), panel: count("panel"), details: count("details") }
}

/** Gives a screen without a model one, keeping the watches it already holds. */
function create(state: Active, screenID: number, panels: readonly number[]): ReviewScreenTransition {
  const attempt = state.issued + 1

  return {
    state: put({ ...state, issued: attempt }, screenID, {
      phase: "ready",
      attempt,
      panels,
      watches: state.entries[screenID]?.watches ?? [],
    }),
    effects: [{ type: "model.create", screenID, attempt }],
  }
}

/** Forgets a screen nothing holds anymore, disposing its model. */
function settle(transition: ReviewScreenTransition, screenID: number): ReviewScreenTransition {
  const state = transition.state

  if (state.status !== "active" || state.routed === screenID) return transition
  const entry = state.entries[screenID]

  if (!entry || entry.watches.length > 0 || (entry.phase === "ready" && entry.panels.length > 0)) return transition
  const entries = Object.fromEntries(Object.entries(state.entries).filter(([id]) => Number(id) !== screenID))

  return {
    state: { ...state, entries },
    effects:
      entry.phase === "ready"
        ? [...transition.effects, { type: "model.dispose", screenID, attempt: entry.attempt }]
        : transition.effects,
  }
}

function put(state: Active, screenID: number, entry: ReviewScreenEntry): Active {
  return { ...state, entries: { ...state.entries, [screenID]: entry } }
}

function changed(state: ReviewScreenState): ReviewScreenTransition {
  return { state, effects: NONE }
}

function unchanged(state: ReviewScreenState): ReviewScreenTransition {
  return { state, effects: NONE }
}
