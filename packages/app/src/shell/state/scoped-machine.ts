/**
 * Startup order of session-scoped stores: names tracked before the stored layout loads merge into the stored list
 * before the first prune, so pruning a session also drops the stores of plugins that mounted early.
 */
export type ScopedSessionState =
  | { readonly status: "hydrating"; readonly active: string | undefined; readonly tracked: readonly string[] }
  | { readonly status: "awaiting-active" }
  | { readonly status: "pruned"; readonly active: string }
  | { readonly status: "disposed" }

export type ScopedSessionEvent =
  | { readonly type: "track"; readonly name: string }
  | { readonly type: "touch"; readonly sessionKey: string }
  | { readonly type: "hydrated" }
  | { readonly type: "disposed" }

export type ScopedSessionEffect =
  | { readonly type: "scoped.merge"; readonly names: readonly string[] }
  | { readonly type: "session.prune"; readonly keep: string }

export type ScopedSessionTransition = {
  readonly state: ScopedSessionState
  readonly effects: readonly ScopedSessionEffect[]
}

export const INITIAL_SCOPED_SESSION_STATE: ScopedSessionState = { status: "hydrating", active: undefined, tracked: [] }

const NO_EFFECTS: readonly ScopedSessionEffect[] = []

export function transitionScopedSession(state: ScopedSessionState, event: ScopedSessionEvent): ScopedSessionTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: NO_EFFECTS }

  if (state.status === "hydrating") {
    if (event.type === "track")
      return state.tracked.includes(event.name)
        ? { state, effects: NO_EFFECTS }
        : { state: { ...state, tracked: [...state.tracked, event.name] }, effects: NO_EFFECTS }

    if (event.type === "touch")
      return state.active === event.sessionKey
        ? { state, effects: NO_EFFECTS }
        : { state: { ...state, active: event.sessionKey }, effects: NO_EFFECTS }

    const merge: ScopedSessionEffect[] = state.tracked.length ? [{ type: "scoped.merge", names: state.tracked }] : []

    if (!state.active) return { state: { status: "awaiting-active" }, effects: merge }

    return {
      state: { status: "pruned", active: state.active },
      effects: [...merge, { type: "session.prune", keep: state.active }],
    }
  }

  if (event.type === "track") return { state, effects: [{ type: "scoped.merge", names: [event.name] }] }

  if (event.type === "hydrated") return { state, effects: NO_EFFECTS }

  if (state.status === "awaiting-active")
    return {
      state: { status: "pruned", active: event.sessionKey },
      effects: [{ type: "session.prune", keep: event.sessionKey }],
    }

  if (state.active === event.sessionKey) return { state, effects: NO_EFFECTS }

  return { state: { status: "pruned", active: event.sessionKey }, effects: NO_EFFECTS }
}

/** The session key the user is on, which pruning keeps. */
export const selectActiveSessionKey = (state: ScopedSessionState) =>
  state.status === "hydrating" || state.status === "pruned" ? state.active : undefined

/** Both stores have loaded, so pruning reads real layout state and the full list of scoped stores. */
export const canPruneSessions = (state: ScopedSessionState) =>
  state.status === "awaiting-active" || state.status === "pruned"
