import { isSessionNotFoundError } from "@/runtime/server/errors"
import type { ServerHealth } from "@/runtime/server/health-machine"

// One routed session: its ID within the session store that resolves it. A replaced store is a new target.
export type SessionTarget<Scope> = {
  readonly scope: Scope
  readonly sessionID: string
}

// `attempt` correlates a metadata sync with the target it was started for: it advances whenever the
// target changes, a reconnect retries an unresolved target, or the route unmounts, so a late result is ignored.
export type SessionResolutionState<T, Scope> =
  | { readonly status: "idle"; readonly attempt: number }
  | { readonly status: "resolving"; readonly target: SessionTarget<Scope>; readonly attempt: number }
  | { readonly status: "ready"; readonly target: SessionTarget<Scope>; readonly session: T; readonly attempt: number }
  | { readonly status: "not-found"; readonly target: SessionTarget<Scope>; readonly attempt: number }
  | {
      readonly status: "error"
      readonly target: SessionTarget<Scope>
      readonly error: unknown
      readonly attempt: number
    }

export type SessionResolutionEvent<T, Scope> =
  | {
      readonly type: "target.changed"
      readonly target: SessionTarget<Scope> | undefined
      readonly cached: T | undefined
      readonly connected: boolean
      readonly refresh: boolean
    }
  | { readonly type: "cache.changed"; readonly target: SessionTarget<Scope>; readonly session: T | undefined }
  | { readonly type: "connected"; readonly target: SessionTarget<Scope>; readonly refresh: boolean }
  | {
      readonly type: "sync.settled"
      readonly target: SessionTarget<Scope>
      readonly attempt: number
      readonly session: T | undefined
    }
  | {
      readonly type: "sync.failed"
      readonly target: SessionTarget<Scope>
      readonly attempt: number
      readonly error: unknown
    }
  | { readonly type: "disposed" }

export type SessionResolutionEffect<Scope> =
  | { readonly type: "sync.transcript"; readonly target: SessionTarget<Scope> }
  | { readonly type: "sync.metadata"; readonly target: SessionTarget<Scope>; readonly attempt: number }

export type SessionResolutionTransition<T, Scope> = {
  readonly state: SessionResolutionState<T, Scope>
  readonly effects: readonly SessionResolutionEffect<Scope>[]
}

export type SessionRouteView<T> =
  | { readonly type: "idle" }
  | { readonly type: "incompatible"; readonly sessionID: string }
  | { readonly type: "unreachable"; readonly sessionID: string }
  | { readonly type: "resolving"; readonly sessionID: string }
  | { readonly type: "ready"; readonly sessionID: string; readonly session: T }
  | { readonly type: "not-found"; readonly sessionID: string }
  | { readonly type: "error"; readonly sessionID: string; readonly error: unknown }

type Targeted<T, Scope> = Exclude<SessionResolutionState<T, Scope>, { readonly status: "idle" }>

export function createSessionResolutionState<T, Scope>(): SessionResolutionState<T, Scope> {
  return { status: "idle", attempt: 0 }
}

export function transitionSessionResolution<T, Scope>(
  state: SessionResolutionState<T, Scope>,
  event: SessionResolutionEvent<T, Scope>,
): SessionResolutionTransition<T, Scope> {
  if (event.type === "disposed") return released(state)

  if (event.type === "target.changed") return targetChanged(state, event)

  if (state.status === "idle" || !sameTarget(state.target, event.target)) return unchanged(state)

  if (event.type === "cache.changed") return cacheChanged(state, event.session)

  if (event.type === "connected") return reconnected(state, event.refresh)

  // Only the sync started for the current attempt answers a target that is still resolving: once the
  // cache holds the session it is authoritative, and a deleted session is evicted from it.
  if (state.status !== "resolving" || state.attempt !== event.attempt) return unchanged(state)

  if (event.type === "sync.settled") {
    if (event.session === undefined) {
      return changed({ status: "not-found", target: state.target, attempt: state.attempt })
    }

    return changed({ status: "ready", target: state.target, session: event.session, attempt: state.attempt })
  }

  if (isSessionNotFoundError(event.error, state.target.sessionID)) {
    return changed({ status: "not-found", target: state.target, attempt: state.attempt })
  }

  return changed({ status: "error", target: state.target, error: event.error, attempt: state.attempt })
}

export function sessionRouteView<T, Scope>(
  state: SessionResolutionState<T, Scope>,
  health: ServerHealth | undefined,
): SessionRouteView<T> {
  if (state.status === "idle") return { type: "idle" }
  const sessionID = state.target.sessionID

  if (health?.type === "incompatible") return { type: "incompatible", sessionID }

  if (state.status === "ready") return { type: "ready", sessionID, session: state.session }

  if (state.status === "not-found") return { type: "not-found", sessionID }

  if (state.status === "error") return { type: "error", sessionID, error: state.error }

  // Nothing is cached and an unreachable server never resolves the session, so explain instead of waiting blank.
  // Only a failed health check counts: a version mismatch has its own panel, and a rejected credential is not an outage.
  if (health?.type === "unreachable") return { type: "unreachable", sessionID }

  return { type: "resolving", sessionID }
}

function targetChanged<T, Scope>(
  state: SessionResolutionState<T, Scope>,
  event: Extract<SessionResolutionEvent<T, Scope>, { readonly type: "target.changed" }>,
): SessionResolutionTransition<T, Scope> {
  if (!event.target) return released(state)

  if (state.status !== "idle" && sameTarget(state.target, event.target)) return unchanged(state)
  const attempt = state.attempt + 1

  // Start independent reads before constructing the selected view, including when its metadata is
  // cached but its transcript has never been loaded.
  const effects = event.connected ? syncs(event.target, attempt, event.cached === undefined || event.refresh) : []

  if (event.cached === undefined) return changed({ status: "resolving", target: event.target, attempt }, effects)

  return changed({ status: "ready", target: event.target, session: event.cached, attempt }, effects)
}

function cacheChanged<T, Scope>(
  state: Targeted<T, Scope>,
  session: T | undefined,
): SessionResolutionTransition<T, Scope> {
  // The viewed session stays cached, so losing it after it resolved means it was deleted, possibly by another client.
  if (session === undefined) {
    if (state.status !== "ready") return unchanged(state)

    return changed({ status: "not-found", target: state.target, attempt: state.attempt })
  }

  if (state.status === "ready" && state.session === session) return unchanged(state)

  return changed({ status: "ready", target: state.target, session, attempt: state.attempt })
}

// Queued inputs ride along with the transcript so a reconnect refreshes them instead of leaving the
// pre-disconnect queue on screen. A resolved session keeps its content visible while it refreshes;
// any other target retries from scratch.
function reconnected<T, Scope>(state: Targeted<T, Scope>, refresh: boolean): SessionResolutionTransition<T, Scope> {
  if (state.status === "ready") return changed(state, syncs(state.target, state.attempt, refresh))
  const attempt = state.attempt + 1

  return changed({ status: "resolving", target: state.target, attempt }, syncs(state.target, attempt, true))
}

function released<T, Scope>(state: SessionResolutionState<T, Scope>): SessionResolutionTransition<T, Scope> {
  if (state.status === "idle") return unchanged(state)

  return changed({ status: "idle", attempt: state.attempt + 1 })
}

// The timeline owns transcript errors, so only metadata reports back to the machine.
function syncs<Scope>(
  target: SessionTarget<Scope>,
  attempt: number,
  metadata: boolean,
): readonly SessionResolutionEffect<Scope>[] {
  if (!metadata) return [{ type: "sync.transcript", target }]

  return [
    { type: "sync.transcript", target },
    { type: "sync.metadata", target, attempt },
  ]
}

function sameTarget<Scope>(left: SessionTarget<Scope>, right: SessionTarget<Scope>) {
  return left.scope === right.scope && left.sessionID === right.sessionID
}

function changed<T, Scope>(
  state: SessionResolutionState<T, Scope>,
  effects: readonly SessionResolutionEffect<Scope>[] = [],
): SessionResolutionTransition<T, Scope> {
  return { state, effects }
}

function unchanged<T, Scope>(state: SessionResolutionState<T, Scope>): SessionResolutionTransition<T, Scope> {
  return { state, effects: [] }
}
