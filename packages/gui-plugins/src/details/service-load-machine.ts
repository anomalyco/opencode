/** How long one MCP, plugins or skills list load may run before it gives up. */
export const SERVICE_LOAD_TIMEOUT_MS = 15_000

/** The server's data store a list loads from, compared by identity: a restarted server brings a new one. */
export type ServiceStore = object

/**
 * One Extensions service list's load (MCP, plugins or skills). Each load takes the next attempt number from `issued`,
 * so a result whose attempt the state no longer holds is stale. `source` is the server's data store the list loads
 * from, and `shown` whether the details popover or drawer shows it.
 */
export type ServiceLoadState<T> =
  /** Not loaded from `source` yet, and not shown since. */
  | {
      readonly status: "idle"
      readonly issued: number
      readonly shown: boolean
      readonly source: ServiceStore | undefined
    }
  /** The first load runs. `queued` runs one more once it settles, for a change announced meanwhile. */
  | {
      readonly status: "loading"
      readonly issued: number
      readonly attempt: number
      readonly shown: boolean
      readonly source: ServiceStore
      readonly queued: boolean
    }
  | {
      readonly status: "ready"
      readonly issued: number
      readonly shown: boolean
      readonly source: ServiceStore
      readonly value: T
    }
  /** Loads again while `value` stays on show. */
  | {
      readonly status: "refreshing"
      readonly issued: number
      readonly attempt: number
      readonly shown: boolean
      readonly source: ServiceStore
      readonly value: T
      readonly queued: boolean
    }
  /** The first load failed or timed out, with nothing loaded to fall back to. */
  | { readonly status: "error"; readonly issued: number; readonly shown: boolean; readonly source: ServiceStore }
  | { readonly status: "disposed" }

export type ServiceLoadEvent<T> =
  /**
   * The inputs changed: whether the list is `shown`, the server's data store (`source`), and the list that store
   * already holds (`cached`), for lists that live in the store. `retain` keeps a list the machine holds across a new
   * store, for lists that do not.
   */
  | {
      readonly type: "context.changed"
      readonly shown: boolean
      readonly source: ServiceStore
      readonly cached: T | undefined
      readonly retain: boolean
    }
  /** The flyout or the drawer opened the list. Joins a load that runs. */
  | { readonly type: "refresh.requested" }
  /** The error view's Retry. */
  | { readonly type: "retry.requested" }
  /** The server announced a change to the list (`plugin.updated`, `skill.updated`). */
  | { readonly type: "invalidated" }
  | { readonly type: "load.succeeded"; readonly attempt: number; readonly value: T }
  | { readonly type: "load.failed"; readonly attempt: number }
  | { readonly type: "load.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type ServiceLoadEffect =
  /** Starts the attempt's controller and timeout, then loads. */
  | { readonly type: "run"; readonly attempt: number; readonly timeoutMs: number }
  /** Ends the attempt's controller and timeout. */
  | { readonly type: "abort"; readonly attempt: number }

export type ServiceLoadTransition<T> = {
  readonly state: ServiceLoadState<T>
  readonly effects: readonly ServiceLoadEffect[]
}

/** What the list shows: a loading message, the error, or the list, `busy` while a load runs. */
export type ServiceLoadView<T> =
  | { readonly status: "loading"; readonly busy: boolean; readonly value: undefined }
  | { readonly status: "ready"; readonly busy: boolean; readonly value: T }
  | { readonly status: "error"; readonly busy: false; readonly value: undefined }

export function initialServiceLoadState<T>(): ServiceLoadState<T> {
  return { status: "idle", issued: 0, shown: false, source: undefined }
}

const NONE: readonly ServiceLoadEffect[] = []

export function transitionServiceLoad<T>(
  state: ServiceLoadState<T>,
  event: ServiceLoadEvent<T>,
): ServiceLoadTransition<T> {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed")
    return { state: { status: "disposed" }, effects: running(state) ? [abort(state.attempt)] : NONE }

  if (event.type === "context.changed") return changed(state, event)

  if (event.type === "refresh.requested" || event.type === "retry.requested" || event.type === "invalidated") {
    if (state.status === "loading" || state.status === "refreshing") {
      if (event.type !== "invalidated" || !state.shown || state.queued) return { state, effects: NONE }

      return { state: { ...state, queued: true }, effects: NONE }
    }

    if (event.type === "invalidated" && !state.shown) return { state, effects: NONE }

    if (event.type === "retry.requested" && state.status === "idle") return { state, effects: NONE }

    if (state.source === undefined) return { state, effects: NONE }

    return load(
      { issued: state.issued, shown: state.shown, source: state.source },
      state.status === "ready" ? state.value : undefined,
    )
  }

  if (!running(state) || state.attempt !== event.attempt) return { state, effects: NONE }
  const value = event.type === "load.succeeded" ? event.value : state.status === "refreshing" ? state.value : undefined

  // A change announced during the load loads again, whatever this load's outcome.
  if (state.queued) {
    const next = load(state, value)

    return { state: next.state, effects: [abort(state.attempt), ...next.effects] }
  }

  // A failed refresh keeps the list it had.
  return {
    state:
      value === undefined
        ? { status: "error", issued: state.issued, shown: state.shown, source: state.source }
        : { status: "ready", issued: state.issued, shown: state.shown, source: state.source, value },
    effects: [abort(state.attempt)],
  }
}

export function serviceLoadView<T>(state: ServiceLoadState<T>): ServiceLoadView<T> {
  if (state.status === "ready") return { status: "ready", busy: false, value: state.value }

  if (state.status === "refreshing") return { status: "ready", busy: true, value: state.value }

  if (state.status === "error") return { status: "error", busy: false, value: undefined }

  // A list that never loaded is not empty yet.
  return { status: "loading", busy: state.status === "loading", value: undefined }
}

function changed<T>(
  state: Exclude<ServiceLoadState<T>, { status: "disposed" }>,
  event: Extract<ServiceLoadEvent<T>, { type: "context.changed" }>,
): ServiceLoadTransition<T> {
  const held = state.status === "ready" || state.status === "refreshing" ? state.value : undefined

  // Another data store: what the previous one loaded is no list of this one's, unless the machine holds it.
  if (state.source !== event.source) {
    const value = event.cached ?? (event.retain ? held : undefined)
    const stop = running(state) ? [abort(state.attempt)] : NONE

    if (event.shown) {
      const next = load({ issued: state.issued, shown: true, source: event.source }, value)

      return { state: next.state, effects: [...stop, ...next.effects] }
    }

    return { state: settled({ issued: state.issued, shown: false, source: event.source }, value), effects: stop }
  }

  if (state.source === undefined) return { state, effects: NONE }
  const source = state.source
  const value = event.cached ?? held

  // Hiding the list ends its load; it loads again on the next show.
  if (state.shown && !event.shown)
    return {
      state: settled({ issued: state.issued, shown: false, source }, value),
      effects: running(state) ? [abort(state.attempt)] : NONE,
    }

  if (!state.shown && event.shown && !running(state)) return load({ issued: state.issued, shown: true, source }, value)
  // Showing a list whose load already runs, as the drawer's row starts one.
  const current = state.shown === event.shown ? state : { ...state, shown: event.shown }

  if (event.cached === undefined) return { state: current, effects: NONE }

  // The store gained the list another way: show it.
  if (current.status === "loading")
    return {
      state: {
        status: "refreshing",
        issued: current.issued,
        attempt: current.attempt,
        shown: current.shown,
        source,
        value: event.cached,
        queued: current.queued,
      },
      effects: NONE,
    }

  if (current.status === "idle" || current.status === "error")
    return { state: settled({ issued: current.issued, shown: current.shown, source }, event.cached), effects: NONE }

  return { state: current, effects: NONE }
}

/** Where a list stands: the attempts issued so far, whether it shows, and its data store. */
type ServicePlace = { readonly issued: number; readonly shown: boolean; readonly source: ServiceStore }

// Starts the next attempt, keeping `value` on show while it runs.
function load<T>(place: ServicePlace, value: T | undefined): ServiceLoadTransition<T> {
  const attempt = place.issued + 1
  const shown = place.shown
  const source = place.source
  const effects: readonly ServiceLoadEffect[] = [{ type: "run", attempt, timeoutMs: SERVICE_LOAD_TIMEOUT_MS }]

  if (value === undefined)
    return { state: { status: "loading", issued: attempt, attempt, shown, source, queued: false }, effects }

  return { state: { status: "refreshing", issued: attempt, attempt, shown, source, value, queued: false }, effects }
}

function settled<T>(place: ServicePlace, value: T | undefined): ServiceLoadState<T> {
  if (value === undefined) return { status: "idle", issued: place.issued, shown: place.shown, source: place.source }

  return { status: "ready", issued: place.issued, shown: place.shown, source: place.source, value }
}

function running<T>(
  state: ServiceLoadState<T>,
): state is Extract<ServiceLoadState<T>, { status: "loading" | "refreshing" }> {
  return state.status === "loading" || state.status === "refreshing"
}

function abort(attempt: number): ServiceLoadEffect {
  return { type: "abort", attempt }
}
