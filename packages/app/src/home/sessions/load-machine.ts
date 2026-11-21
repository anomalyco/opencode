import type { ServerConnection } from "@/runtime/server/registry"

/** Matches `staleTime` in `queries.ts`: a cached list younger than this shows without a refetch. */
export const HOME_SESSIONS_STALE_MS = 30_000

export const HOME_SESSIONS_FETCH_TIMEOUT_MS = 30_000

export const HOME_SESSIONS_CONNECT_TIMEOUT_MS = 15_000

export const HOME_SESSIONS_PLACEHOLDER_DELAY_MS = 250

// Matches the list's reveal animation in view.css.
export const HOME_SESSIONS_REVEAL_MS = 200

export type HomeSessionsUnavailableReason = "offline" | "auth" | "incompatible"

/**
 * The focused server as the list sees it. `cached` says the shared `["home-sessions", conn]` cache holds a list, which
 * the list shows whatever the phase; `stale` says that list is missing, invalidated or older than the stale time.
 */
export type HomeSessionsTarget = {
  readonly server: ServerConnection.Key
  readonly connection: "connected" | "connecting" | HomeSessionsUnavailableReason
  readonly cached: boolean
  readonly stale: boolean
}

export type HomeSessionsFailure = { readonly type: "rejected"; readonly message: string } | { readonly type: "timeout" }

/**
 * The focused server's session index. The list itself lives in the shared query cache; this machine owns only the
 * phase. `connecting` and `loading` show placeholder rows once `since`'s delay passes (`skeleton`), and carry it across
 * the connect so the rows never restart. `reveal` is non-zero while the list fades in over the placeholder rows, and
 * names the fetch that revealed it. `queued` records a refresh asked for while a fetch was in flight: one more fetch
 * runs when it settles.
 */
export type HomeSessionsLoadState =
  | { readonly status: "idle"; readonly issued: number }
  | {
      readonly status: "connecting"
      readonly issued: number
      readonly server: ServerConnection.Key
      readonly attempt: number
      readonly since: number
      readonly skeleton: boolean
    }
  | {
      readonly status: "loading"
      readonly issued: number
      readonly server: ServerConnection.Key
      readonly attempt: number
      readonly since: number
      readonly skeleton: boolean
      readonly queued: boolean
    }
  | {
      readonly status: "ready"
      readonly issued: number
      readonly server: ServerConnection.Key
      readonly reveal: number
    }
  | {
      readonly status: "refreshing"
      readonly issued: number
      readonly server: ServerConnection.Key
      readonly attempt: number
      readonly reveal: number
      readonly queued: boolean
    }
  | {
      readonly status: "unavailable"
      readonly issued: number
      readonly server: ServerConnection.Key
      readonly reason: HomeSessionsUnavailableReason
    }
  | {
      readonly status: "error"
      readonly issued: number
      readonly server: ServerConnection.Key
      readonly failure: HomeSessionsFailure
    }
  | { readonly status: "disposed" }

export type HomeSessionsTimer = "placeholder" | "deadline" | "reveal"

export type HomeSessionsTimerEvent =
  | { readonly type: "placeholder.due"; readonly since: number }
  | { readonly type: "connect.timed-out"; readonly attempt: number }
  | { readonly type: "fetch.timed-out"; readonly attempt: number }
  | { readonly type: "reveal.completed"; readonly attempt: number }

export type HomeSessionsLoadEvent =
  | HomeSessionsTimerEvent
  | { readonly type: "context.changed"; readonly target: HomeSessionsTarget | undefined }
  | { readonly type: "fetch.succeeded"; readonly attempt: number; readonly reducedMotion: boolean }
  | { readonly type: "fetch.failed"; readonly attempt: number; readonly message: string }
  /** The cached list was invalidated, or the browser came back online while it was stale. */
  | { readonly type: "refresh"; readonly server: ServerConnection.Key }
  | { readonly type: "retry" }
  | { readonly type: "disposed" }

export type HomeSessionsLoadEffect =
  | { readonly type: "fetch.start"; readonly server: ServerConnection.Key; readonly attempt: number }
  | { readonly type: "fetch.cancel"; readonly server: ServerConnection.Key }
  | { readonly type: "probe.servers" }
  | {
      readonly type: "timer.start"
      readonly timer: HomeSessionsTimer
      readonly delayMs: number
      readonly event: HomeSessionsTimerEvent
    }
  | { readonly type: "timer.stop"; readonly timer: HomeSessionsTimer }

export type HomeSessionsLoadTransition = {
  readonly state: HomeSessionsLoadState
  readonly effects: readonly HomeSessionsLoadEffect[]
}

export type HomeSessionsListView =
  | { readonly status: "loading"; readonly skeleton: boolean }
  | { readonly status: "ready"; readonly revealing: boolean }
  | { readonly status: "unavailable"; readonly reason: HomeSessionsUnavailableReason }
  | { readonly status: "error"; readonly failure: HomeSessionsFailure }

type LiveState = Exclude<HomeSessionsLoadState, { status: "disposed" }>

export const INITIAL_HOME_SESSIONS_LOAD_STATE: HomeSessionsLoadState = Object.freeze({ status: "idle", issued: 0 })

const DISPOSED: HomeSessionsLoadState = Object.freeze({ status: "disposed" })

const NONE: readonly HomeSessionsLoadEffect[] = Object.freeze([])

const PROBE: HomeSessionsLoadEffect = Object.freeze({ type: "probe.servers" })

export function transitionHomeSessionsLoad(
  state: HomeSessionsLoadState,
  event: HomeSessionsLoadEvent,
): HomeSessionsLoadTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return { state: DISPOSED, effects: stop(state) }

  if (event.type === "context.changed") return retarget(state, event.target)

  if (event.type === "placeholder.due") {
    if (state.status !== "connecting" && state.status !== "loading") return unchanged(state)

    if (state.skeleton || state.since !== event.since) return unchanged(state)

    return { state: { ...state, skeleton: true }, effects: NONE }
  }

  if (event.type === "connect.timed-out") {
    if (state.status !== "connecting" || state.attempt !== event.attempt) return unchanged(state)

    return {
      state: { status: "unavailable", issued: state.issued, server: state.server, reason: "offline" },
      effects: stop(state),
    }
  }

  if (event.type === "fetch.succeeded") return succeeded(state, event)

  if (event.type === "fetch.failed" || event.type === "fetch.timed-out") return failed(state, event)

  if (event.type === "reveal.completed") {
    if (state.status !== "ready" && state.status !== "refreshing") return unchanged(state)

    if (state.reveal === 0 || state.reveal !== event.attempt) return unchanged(state)

    return { state: { ...state, reveal: 0 }, effects: NONE }
  }

  if (event.type === "refresh") return refresh(state, event.server)

  if (state.status === "error") return load(state, state.server)

  if (state.status === "unavailable" && state.reason === "offline") return connect(state, state.server, [PROBE])

  return unchanged(state)
}

/** Placeholder rows and the search spinner show only while a connect or first fetch is in flight, both bounded. */
export function selectHomeSessionsSearchLoading(state: HomeSessionsLoadState) {
  return state.status === "connecting" || state.status === "loading"
}

/** What the list area shows. `hasSessions`: the cached index or the server's live store holds sessions to list. */
export function selectHomeSessionsListView(state: HomeSessionsLoadState, hasSessions: boolean): HomeSessionsListView {
  if (state.status === "connecting" || state.status === "loading")
    return { status: "loading", skeleton: state.skeleton }

  if (state.status === "ready" || state.status === "refreshing")
    return { status: "ready", revealing: state.reveal !== 0 }

  if (state.status === "error") return { status: "error", failure: state.failure }

  if (state.status === "unavailable" && !hasSessions) return { status: "unavailable", reason: state.reason }

  return { status: "ready", revealing: false }
}

function retarget(state: LiveState, target: HomeSessionsTarget | undefined): HomeSessionsLoadTransition {
  if (!target) {
    if (state.status === "idle") return unchanged(state)

    return { state: { status: "idle", issued: state.issued }, effects: stop(state) }
  }

  if (state.status === "idle" || state.server !== target.server) return enter(state, target)

  if (target.connection === "connected") {
    if (state.status === "connecting") return fetch(state, state.since, state.skeleton)

    if (state.status === "ready") {
      // The cache lost the list it showed (another connection object for the server): load it again.
      if (!target.cached) return enter(state, target)

      return target.stale ? refetch(state, state.reveal) : unchanged(state)
    }

    // A fetch in flight keeps running; a failed one waits for the user's retry.
    if (state.status !== "unavailable") return unchanged(state)

    return enter(state, target)
  }

  if (target.connection === "connecting")
    return state.status === "unavailable" ? enter(state, target) : unchanged(state)

  // A list already shown stays shown while the server is away.
  if (state.status === "ready") return unchanged(state)

  if (state.status === "refreshing") {
    return {
      state: { status: "ready", issued: state.issued, server: state.server, reveal: state.reveal },
      effects: [stopTimer("deadline")],
    }
  }

  if (state.status === "unavailable" && state.reason === target.connection) return unchanged(state)

  return enter(state, target)
}

// A new target starts over: a list cached for it shows at once, and only a connected server is asked for one.
function enter(state: LiveState, target: HomeSessionsTarget): HomeSessionsLoadTransition {
  const effects = stop(state)

  if (target.cached && (target.connection !== "connected" || !target.stale))
    return { state: { status: "ready", issued: state.issued, server: target.server, reveal: 0 }, effects }

  if (target.cached) return refetch({ issued: state.issued, server: target.server }, 0, effects)

  if (target.connection === "connected") return load(state, target.server, effects)

  if (target.connection === "connecting") return connect(state, target.server, effects)

  return {
    state: { status: "unavailable", issued: state.issued, server: target.server, reason: target.connection },
    effects,
  }
}

function refresh(state: LiveState, server: ServerConnection.Key): HomeSessionsLoadTransition {
  if (state.status === "idle" || state.server !== server) return unchanged(state)

  if (state.status === "ready") return refetch(state, state.reveal)

  if (state.status === "loading" || state.status === "refreshing") {
    return state.queued ? unchanged(state) : { state: { ...state, queued: true }, effects: NONE }
  }

  if (state.status === "error") return load(state, server)

  return unchanged(state)
}

function succeeded(
  state: LiveState,
  event: Extract<HomeSessionsLoadEvent, { type: "fetch.succeeded" }>,
): HomeSessionsLoadTransition {
  if (state.status === "loading" && state.attempt === event.attempt) {
    const reveal = state.skeleton && !event.reducedMotion ? state.attempt : 0

    const effects = [
      ...placeholderStop(state),
      ...(reveal ? [startTimer("reveal", HOME_SESSIONS_REVEAL_MS, { type: "reveal.completed", attempt: reveal })] : []),
    ]

    if (state.queued) return refetch(state, reveal, effects)

    return {
      state: { status: "ready", issued: state.issued, server: state.server, reveal },
      effects: [...effects, stopTimer("deadline")],
    }
  }

  if (state.status !== "refreshing" || state.attempt !== event.attempt) return unchanged(state)

  if (state.queued) return refetch(state, state.reveal)

  return {
    state: { status: "ready", issued: state.issued, server: state.server, reveal: state.reveal },
    effects: [stopTimer("deadline")],
  }
}

function failed(
  state: LiveState,
  event: Extract<HomeSessionsLoadEvent, { type: "fetch.failed" | "fetch.timed-out" }>,
): HomeSessionsLoadTransition {
  if ((state.status !== "loading" && state.status !== "refreshing") || state.attempt !== event.attempt)
    return unchanged(state)

  // A request that timed out may still hold the shared query; cancelling it lets the next fetch start fresh.
  const settle: HomeSessionsLoadEffect[] = [
    stopTimer("deadline"),
    ...(event.type === "fetch.timed-out" ? [{ type: "fetch.cancel" as const, server: state.server }] : []),
  ]

  // A failed refresh keeps the list it shows.
  if (state.status === "refreshing")
    return {
      state: { status: "ready", issued: state.issued, server: state.server, reveal: state.reveal },
      effects: settle,
    }

  const failure: HomeSessionsFailure =
    event.type === "fetch.failed" ? { type: "rejected", message: event.message } : { type: "timeout" }

  return {
    state: { status: "error", issued: state.issued, server: state.server, failure },
    effects: [...placeholderStop(state), ...settle],
  }
}

function load(
  state: { readonly issued: number },
  server: ServerConnection.Key,
  effects: readonly HomeSessionsLoadEffect[] = NONE,
): HomeSessionsLoadTransition {
  const attempt = state.issued + 1

  return fetch({ issued: state.issued, server }, attempt, false, [...effects, placeholder(attempt)])
}

// Keeps `since` and `skeleton`, so placeholder rows shown while connecting stay up through the first fetch.
function fetch(
  state: { readonly issued: number; readonly server: ServerConnection.Key },
  since: number,
  skeleton: boolean,
  effects: readonly HomeSessionsLoadEffect[] = NONE,
): HomeSessionsLoadTransition {
  const attempt = state.issued + 1

  return {
    state: { status: "loading", issued: attempt, server: state.server, attempt, since, skeleton, queued: false },
    effects: [...effects, ...request(state.server, attempt)],
  }
}

function refetch(
  state: { readonly issued: number; readonly server: ServerConnection.Key },
  reveal: number,
  effects: readonly HomeSessionsLoadEffect[] = NONE,
): HomeSessionsLoadTransition {
  const attempt = state.issued + 1

  return {
    state: { status: "refreshing", issued: attempt, server: state.server, attempt, reveal, queued: false },
    effects: [...effects, ...request(state.server, attempt)],
  }
}

function connect(
  state: { readonly issued: number },
  server: ServerConnection.Key,
  effects: readonly HomeSessionsLoadEffect[] = NONE,
): HomeSessionsLoadTransition {
  const attempt = state.issued + 1

  return {
    state: { status: "connecting", issued: attempt, server, attempt, since: attempt, skeleton: false },
    effects: [
      ...effects,
      placeholder(attempt),
      startTimer("deadline", HOME_SESSIONS_CONNECT_TIMEOUT_MS, { type: "connect.timed-out", attempt }),
    ],
  }
}

function request(server: ServerConnection.Key, attempt: number): HomeSessionsLoadEffect[] {
  return [
    { type: "fetch.start", server, attempt },
    startTimer("deadline", HOME_SESSIONS_FETCH_TIMEOUT_MS, { type: "fetch.timed-out", attempt }),
  ]
}

function placeholder(since: number) {
  return startTimer("placeholder", HOME_SESSIONS_PLACEHOLDER_DELAY_MS, { type: "placeholder.due", since })
}

// A superseded fetch keeps running and fills the shared cache; only its result is ignored here.
function stop(state: LiveState): HomeSessionsLoadEffect[] {
  if (state.status === "connecting" || state.status === "loading")
    return [...placeholderStop(state), stopTimer("deadline")]

  if (state.status === "refreshing") return [stopTimer("deadline"), ...(state.reveal ? [stopTimer("reveal")] : [])]

  if (state.status === "ready" && state.reveal) return [stopTimer("reveal")]

  return []
}

function placeholderStop(state: { readonly skeleton: boolean }): HomeSessionsLoadEffect[] {
  return state.skeleton ? [] : [stopTimer("placeholder")]
}

function startTimer(timer: HomeSessionsTimer, delayMs: number, event: HomeSessionsTimerEvent): HomeSessionsLoadEffect {
  return { type: "timer.start", timer, delayMs, event }
}

function stopTimer(timer: HomeSessionsTimer): HomeSessionsLoadEffect {
  return { type: "timer.stop", timer }
}

function unchanged(state: HomeSessionsLoadState): HomeSessionsLoadTransition {
  return { state, effects: NONE }
}
