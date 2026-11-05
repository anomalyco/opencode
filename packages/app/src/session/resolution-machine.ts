import { isFallbackTitle } from "@opencode/util/session-title-fallback"
import { isSessionNotFoundError } from "@/runtime/server/errors"
import type { ServerHealth } from "@/runtime/server/health-machine"

/** How long an uncached session may wait for a connection or its metadata before the route calls the server unreachable. */
export const SESSION_RESOLUTION_TIMEOUT_MS = 30_000

// One routed session: its ID within the session store that resolves it. A replaced store is a new target.
export type SessionTarget<Scope> = {
  readonly scope: Scope
  readonly sessionID: string
}

// `attempt` correlates a metadata sync and the resolution timeout with the target they were started for: it advances
// whenever the target changes, a pending session starts or settles, a reconnect retries an unresolved target,
// resolving times out, or the route unmounts, so a late result is ignored.
// `preparing` is a new session whose tab promotion still owns its creation (`pending`); nothing loads until it settles.
export type SessionResolutionState<T, Scope, P = never> =
  | { readonly status: "idle"; readonly attempt: number }
  | {
      readonly status: "preparing"
      readonly target: SessionTarget<Scope>
      readonly pending: P
      readonly attempt: number
    }
  | { readonly status: "resolving"; readonly target: SessionTarget<Scope>; readonly attempt: number }
  | { readonly status: "unreachable"; readonly target: SessionTarget<Scope>; readonly attempt: number }
  | { readonly status: "ready"; readonly target: SessionTarget<Scope>; readonly session: T; readonly attempt: number }
  | { readonly status: "not-found"; readonly target: SessionTarget<Scope>; readonly attempt: number }
  | {
      readonly status: "error"
      readonly target: SessionTarget<Scope>
      readonly error: unknown
      readonly attempt: number
    }

export type SessionResolutionEvent<T, Scope, P = never> =
  | {
      readonly type: "target.changed"
      readonly target: SessionTarget<Scope> | undefined
      readonly pending?: P
      readonly cached: T | undefined
      readonly connected: boolean
      readonly refresh: boolean
    }
  | {
      readonly type: "pending.changed"
      readonly target: SessionTarget<Scope>
      readonly pending: P | undefined
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
  | { readonly type: "resolve.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type SessionResolutionEffect<Scope> =
  | { readonly type: "sync.transcript"; readonly target: SessionTarget<Scope> }
  | { readonly type: "sync.metadata"; readonly target: SessionTarget<Scope>; readonly attempt: number }
  | { readonly type: "timer.start"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "timer.clear" }

export type SessionResolutionTransition<T, Scope, P = never> = {
  readonly state: SessionResolutionState<T, Scope, P>
  readonly effects: readonly SessionResolutionEffect<Scope>[]
}

export type SessionRouteView<T, P = never> =
  | { readonly type: "idle" }
  | { readonly type: "incompatible"; readonly sessionID: string }
  | { readonly type: "preparing"; readonly sessionID: string; readonly pending: P }
  | { readonly type: "signed-out"; readonly sessionID: string }
  | { readonly type: "unreachable"; readonly sessionID: string }
  | { readonly type: "resolving"; readonly sessionID: string }
  | { readonly type: "ready"; readonly sessionID: string; readonly session: T }
  | { readonly type: "not-found"; readonly sessionID: string }
  | { readonly type: "error"; readonly sessionID: string; readonly error: unknown }

type Targeted<T, Scope, P> = Exclude<SessionResolutionState<T, Scope, P>, { readonly status: "idle" }>

const NO_EFFECTS: readonly SessionResolutionEffect<never>[] = []

const IDLE_VIEW: SessionRouteView<never, never> = { type: "idle" }

export function createSessionResolutionState<T, Scope, P = never>(): SessionResolutionState<T, Scope, P> {
  return { status: "idle", attempt: 0 }
}

export function transitionSessionResolution<T, Scope, P = never>(
  state: SessionResolutionState<T, Scope, P>,
  event: SessionResolutionEvent<T, Scope, P>,
): SessionResolutionTransition<T, Scope, P> {
  if (event.type === "disposed") return released(state)

  if (event.type === "target.changed") return targetChanged(state, event)

  if (event.type === "resolve.timed-out") {
    if (state.status !== "resolving" || state.attempt !== event.attempt) return unchanged(state)

    return changed(state, { status: "unreachable", target: state.target, attempt: state.attempt + 1 })
  }

  if (state.status === "idle" || !sameTarget(state.target, event.target)) return unchanged(state)

  if (event.type === "pending.changed") return pendingChanged(state, event)

  // The tab promotion owns a preparing session: it creates the session, so neither its early cache entry nor a
  // reconnect starts loading before the promotion settles.
  if (state.status === "preparing") return unchanged(state)

  if (event.type === "cache.changed") return cacheChanged(state, event.session)

  if (event.type === "connected") return reconnected(state, event.refresh)

  // Only the sync started for the current attempt answers a target that is still resolving: once the
  // cache holds the session it is authoritative, and a deleted session is evicted from it.
  if (state.status !== "resolving" || state.attempt !== event.attempt) return unchanged(state)

  if (event.type === "sync.settled") {
    if (event.session === undefined) {
      return changed(state, { status: "not-found", target: state.target, attempt: state.attempt })
    }

    return changed(state, { status: "ready", target: state.target, session: event.session, attempt: state.attempt })
  }

  if (isSessionNotFoundError(event.error, state.target.sessionID)) {
    return changed(state, { status: "not-found", target: state.target, attempt: state.attempt })
  }

  return changed(state, { status: "error", target: state.target, error: event.error, attempt: state.attempt })
}

export function sessionRouteView<T, Scope, P = never>(
  state: SessionResolutionState<T, Scope, P>,
  health: ServerHealth | undefined,
): SessionRouteView<T, P> {
  if (state.status === "idle") return IDLE_VIEW
  const sessionID = state.target.sessionID

  // A server this app cannot talk to wins over everything, including a session that is still being created.
  if (health?.type === "incompatible") return { type: "incompatible", sessionID }

  if (state.status === "preparing") return { type: "preparing", sessionID, pending: state.pending }

  if (state.status === "ready") return { type: "ready", sessionID, session: state.session }

  if (state.status === "not-found") return { type: "not-found", sessionID }

  if (state.status === "error") return { type: "error", sessionID, error: state.error }

  // Nothing is cached and a server waiting for sign-in cannot resolve the session until the user signs in.
  if (health?.type === "auth" || health?.type === "unauthorized") return { type: "signed-out", sessionID }

  // Nothing is cached and an unreachable, stopped or silent server never resolves the session, so explain instead of
  // waiting blank.
  if (state.status === "unreachable" || health?.type === "unreachable" || health?.type === "stopped") {
    return { type: "unreachable", sessionID }
  }

  return { type: "resolving", sessionID }
}

/** The directory whose models the route offers: the draft's while a new session is prepared, then the session's. */
export function sessionModelDirectory<
  T extends { readonly location: { readonly directory: string } },
  Scope,
  P extends { readonly draft: { readonly directory: string } },
>(state: SessionResolutionState<T, Scope, P>) {
  if (state.status === "preparing") return state.pending.draft.directory

  if (state.status === "ready") return state.session.location.directory

  return undefined
}

/** The session the user is looking at, which only a shown session is. */
export function viewedSessionID<T, P>(view: SessionRouteView<T, P>) {
  return view.type === "ready" ? view.sessionID : undefined
}

export function sessionDocumentTitle<T extends { readonly title?: string }, P>(view: SessionRouteView<T, P>) {
  if (view.type !== "ready") return undefined

  return isFallbackTitle(view.session.title) ? undefined : view.session.title
}

function targetChanged<T, Scope, P>(
  state: SessionResolutionState<T, Scope, P>,
  event: Extract<SessionResolutionEvent<T, Scope, P>, { readonly type: "target.changed" }>,
): SessionResolutionTransition<T, Scope, P> {
  if (!event.target) return released(state)

  if (state.status !== "idle" && sameTarget(state.target, event.target)) return unchanged(state)
  const attempt = state.attempt + 1

  if (event.pending !== undefined) {
    return changed(state, { status: "preparing", target: event.target, pending: event.pending, attempt })
  }

  return opened(state, event.target, attempt, event)
}

function pendingChanged<T, Scope, P>(
  state: Targeted<T, Scope, P>,
  event: Extract<SessionResolutionEvent<T, Scope, P>, { readonly type: "pending.changed" }>,
): SessionResolutionTransition<T, Scope, P> {
  if (event.pending !== undefined) {
    if (state.status === "preparing" && state.pending === event.pending) return unchanged(state)

    return changed(state, {
      status: "preparing",
      target: state.target,
      pending: event.pending,
      attempt: state.attempt + 1,
    })
  }

  if (state.status !== "preparing") return unchanged(state)

  // The promotion settled: the created session is usually cached by now, so it shows without a resolving frame.
  return opened(state, state.target, state.attempt + 1, event)
}

// Start independent reads before constructing the selected view, including when its metadata is
// cached but its transcript has never been loaded.
function opened<T, Scope, P>(
  state: SessionResolutionState<T, Scope, P>,
  target: SessionTarget<Scope>,
  attempt: number,
  input: { readonly cached: T | undefined; readonly connected: boolean; readonly refresh: boolean },
): SessionResolutionTransition<T, Scope, P> {
  const effects = input.connected ? syncs(target, attempt, input.cached === undefined || input.refresh) : NO_EFFECTS

  if (input.cached === undefined) return changed(state, { status: "resolving", target, attempt }, effects)

  return changed(state, { status: "ready", target, session: input.cached, attempt }, effects)
}

function cacheChanged<T, Scope, P>(
  state: Exclude<Targeted<T, Scope, P>, { readonly status: "preparing" }>,
  session: T | undefined,
): SessionResolutionTransition<T, Scope, P> {
  // The viewed session stays cached, so losing it after it resolved means it was deleted, possibly by another client.
  if (session === undefined) {
    if (state.status !== "ready") return unchanged(state)

    return changed(state, { status: "not-found", target: state.target, attempt: state.attempt })
  }

  if (state.status === "ready" && state.session === session) return unchanged(state)

  return changed(state, { status: "ready", target: state.target, session, attempt: state.attempt })
}

// Queued inputs ride along with the transcript so a reconnect refreshes them instead of leaving the
// pre-disconnect queue on screen. A resolved session keeps its content visible while it refreshes;
// any other target retries from scratch.
function reconnected<T, Scope, P>(
  state: Exclude<Targeted<T, Scope, P>, { readonly status: "preparing" }>,
  refresh: boolean,
): SessionResolutionTransition<T, Scope, P> {
  if (state.status === "ready") return { state, effects: syncs(state.target, state.attempt, refresh) }
  const attempt = state.attempt + 1

  return changed(state, { status: "resolving", target: state.target, attempt }, syncs(state.target, attempt, true))
}

function released<T, Scope, P>(state: SessionResolutionState<T, Scope, P>): SessionResolutionTransition<T, Scope, P> {
  if (state.status === "idle") return unchanged(state)

  return changed(state, { status: "idle", attempt: state.attempt + 1 })
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

// Owns the resolution timeout: every entry into `resolving` starts it for the new attempt, and every exit clears it.
function changed<T, Scope, P>(
  previous: SessionResolutionState<T, Scope, P>,
  next: SessionResolutionState<T, Scope, P>,
  effects: readonly SessionResolutionEffect<Scope>[] = NO_EFFECTS,
): SessionResolutionTransition<T, Scope, P> {
  if (next.status === "resolving") {
    return {
      state: next,
      effects: [...effects, { type: "timer.start", attempt: next.attempt, delayMs: SESSION_RESOLUTION_TIMEOUT_MS }],
    }
  }

  if (previous.status === "resolving") return { state: next, effects: [...effects, { type: "timer.clear" }] }

  return { state: next, effects }
}

function unchanged<T, Scope, P>(state: SessionResolutionState<T, Scope, P>): SessionResolutionTransition<T, Scope, P> {
  return { state, effects: NO_EFFECTS }
}
