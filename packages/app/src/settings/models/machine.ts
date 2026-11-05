/** How long a reveal waits for its provider to appear, e.g. while the catalog loads; a missing one gives up. */
export const MODELS_REVEAL_TIMEOUT_MS = 5_000

/**
 * Revealing the provider picked on the Providers page: `waiting` for its section to be listed and mounted (expanding
 * the path to it once), then `scrolling` to it on the next frame. Every exit consumes the target.
 */
export type ModelsRevealState =
  | { readonly status: "idle"; readonly attempt: number }
  | { readonly status: "waiting"; readonly attempt: number; readonly provider: string; readonly expanded: boolean }
  | { readonly status: "scrolling"; readonly attempt: number; readonly provider: string }

export type ModelsRevealEvent =
  | {
      readonly type: "target.synced"
      readonly active: boolean
      readonly provider: string | undefined
      readonly hasFilter: boolean
    }
  | {
      readonly type: "catalog.synced"
      readonly hasFilter: boolean
      readonly inCatalog: boolean
      readonly inConsoleGroup: boolean
      readonly sectionReady: boolean
    }
  | { readonly type: "section.ready"; readonly provider: string }
  | { readonly type: "frame.completed"; readonly attempt: number }
  | { readonly type: "filter.typed" }
  | { readonly type: "reveal.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type ModelsRevealEffect =
  | { readonly type: "filter.clear" }
  | { readonly type: "section.expand"; readonly provider: string; readonly expandConsole: boolean }
  | { readonly type: "frame.scroll"; readonly attempt: number; readonly provider: string }
  | { readonly type: "frame.cancel" }
  | { readonly type: "timeout.start"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "timeout.cancel" }
  | { readonly type: "target.consume" }

export type ModelsRevealTransition = {
  readonly state: ModelsRevealState
  readonly effects: readonly ModelsRevealEffect[]
}

type Revealing = Exclude<ModelsRevealState, { readonly status: "idle" }>

const NO_EFFECTS: readonly ModelsRevealEffect[] = Object.freeze([])

const CONSUME: ModelsRevealEffect = Object.freeze({ type: "target.consume" })

export function createModelsRevealState(): ModelsRevealState {
  return { status: "idle", attempt: 0 }
}

export function transitionModelsReveal(state: ModelsRevealState, event: ModelsRevealEvent): ModelsRevealTransition {
  if (event.type === "target.synced") return synced(state, event)

  if (state.status === "idle") return unchanged(state)

  if (event.type === "catalog.synced") {
    // The filter is cleared when the reveal starts; a missing provider waits for the catalog until the timeout.
    if (state.status !== "waiting" || event.hasFilter || !event.inCatalog) return unchanged(state)

    const expand: ModelsRevealEffect = {
      type: "section.expand",
      provider: state.provider,
      expandConsole: event.inConsoleGroup,
    }

    if (event.sectionReady) return scroll(state, state.expanded ? [] : [expand])

    // A provider nested in a collapsed OpenCode Console group mounts only once the group expands.
    if (state.expanded) return unchanged(state)

    return { state: { ...state, expanded: true }, effects: [expand] }
  }

  if (event.type === "section.ready") {
    if (state.status !== "waiting" || !state.expanded || event.provider !== state.provider) return unchanged(state)

    return scroll(state, [])
  }

  if (event.type === "frame.completed") {
    if (state.status !== "scrolling" || event.attempt !== state.attempt) return unchanged(state)

    return { state: idle(state), effects: [CONSUME] }
  }

  if (event.type === "reveal.timed-out") {
    if (state.status !== "waiting" || event.attempt !== state.attempt) return unchanged(state)

    return { state: idle(state), effects: [CONSUME] }
  }

  // Typing a search, or leaving with `disposed`, ends the reveal so it never fights the user.
  return { state: idle(state), effects: [...cancel(state), CONSUME] }
}

/** The provider a reveal is still looking for, which the catalog sync checks. */
export function revealingModelProvider(state: ModelsRevealState) {
  return state.status === "idle" ? undefined : state.provider
}

function synced(
  state: ModelsRevealState,
  event: Extract<ModelsRevealEvent, { readonly type: "target.synced" }>,
): ModelsRevealTransition {
  if (!event.provider) {
    if (state.status === "idle") return unchanged(state)

    return { state: idle(state), effects: cancel(state) }
  }

  if (!event.active) {
    // A target set while another tab still shows waits for the Models tab; leaving it mid-reveal drops the target.
    if (state.status === "idle") return unchanged(state)

    return { state: idle(state), effects: [...cancel(state), CONSUME] }
  }

  if (state.status !== "idle" && state.provider === event.provider) return unchanged(state)
  const attempt = state.attempt + 1

  return {
    state: { status: "waiting", attempt, provider: event.provider, expanded: false },
    effects: [
      ...(state.status === "idle" ? [] : cancel(state)),
      ...(event.hasFilter ? [{ type: "filter.clear" as const }] : []),
      { type: "timeout.start", attempt, timeoutMs: MODELS_REVEAL_TIMEOUT_MS },
    ],
  }
}

function scroll(
  state: Extract<ModelsRevealState, { readonly status: "waiting" }>,
  effects: readonly ModelsRevealEffect[],
): ModelsRevealTransition {
  return {
    state: { status: "scrolling", attempt: state.attempt, provider: state.provider },
    effects: [
      ...effects,
      { type: "timeout.cancel" },
      { type: "frame.scroll", attempt: state.attempt, provider: state.provider },
    ],
  }
}

function cancel(state: Revealing): readonly ModelsRevealEffect[] {
  return state.status === "waiting" ? [{ type: "timeout.cancel" }] : [{ type: "frame.cancel" }]
}

function idle(state: ModelsRevealState): ModelsRevealState {
  return { status: "idle", attempt: state.attempt }
}

function unchanged(state: ModelsRevealState): ModelsRevealTransition {
  return { state, effects: NO_EFFECTS }
}
