export const TYPEAHEAD_REQUEST_TIMEOUT_MS = 15_000

export type TypeaheadInitial<T> = { readonly items: T[]; readonly failed?: boolean }

type TypeaheadLive<T> = {
  /** The input's text; the query is this text trimmed. */
  readonly input: string
  /** The user has typed, so later result changes animate the list height. */
  readonly searched: boolean
  /** Some answer has arrived, so the empty row may show. */
  readonly answered: boolean
  /** The parent's opening results, shown for the empty query. */
  readonly initial: TypeaheadInitial<T> | undefined
  readonly cache: ReadonlyMap<string, T[]>
  readonly shown: T[]
  /** `shown` holds rows the pending query does not match; they stay dimmed instead of collapsing the list. */
  readonly stale: boolean
  /** The last attempt issued, so the next request gets a fresh one. */
  readonly issued: number
}

/**
 * `debouncing` waits for typing to pause; `loading` has a request in flight. Both name their `attempt`, and a timer or
 * result from another attempt is ignored. `failed` is the current query's failure only.
 */
export type TypeaheadState<T> =
  | (TypeaheadLive<T> & { readonly status: "ready" | "failed" })
  | (TypeaheadLive<T> & { readonly status: "debouncing" | "loading"; readonly attempt: number })
  | { readonly status: "disposed" }

export type TypeaheadEvent<T> =
  | { readonly type: "initial.synced"; readonly initial: TypeaheadInitial<T> | undefined }
  | {
      readonly type: "input.changed"
      readonly input: string
      readonly delayMs: number
      readonly match: (item: T, query: string) => boolean
    }
  | { readonly type: "debounce.elapsed"; readonly attempt: number }
  | { readonly type: "retry.requested" }
  | { readonly type: "request.succeeded"; readonly attempt: number; readonly items: T[] }
  | { readonly type: "request.failed"; readonly attempt: number }
  | { readonly type: "request.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

/** Each effect first cancels the pending debounce or request, then starts its own work. */
export type TypeaheadEffect =
  | { readonly type: "cancel" }
  | { readonly type: "debounce"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "request"; readonly attempt: number; readonly query: string }

export type TypeaheadTransition<T> = {
  readonly state: TypeaheadState<T>
  readonly effects: readonly TypeaheadEffect[]
}

type Live<T> = Exclude<TypeaheadState<T>, { status: "disposed" }>

const NONE: readonly TypeaheadEffect[] = Object.freeze([])

const CANCEL: readonly TypeaheadEffect[] = Object.freeze([Object.freeze({ type: "cancel" })])

const DISPOSED = Object.freeze({ status: "disposed" as const })

const EMPTY: never[] = []

export function createTypeaheadState<T>(initial: TypeaheadInitial<T> | undefined): TypeaheadTransition<T> {
  const live = {
    input: "",
    searched: false,
    answered: initial !== undefined,
    initial,
    cache: new Map<string, T[]>(),
    shown: initial && !initial.failed ? initial.items : [],
    stale: false,
    issued: 0,
  }

  if (initial) return { state: { ...live, status: initial.failed ? "failed" : "ready" }, effects: NONE }

  return {
    state: { ...live, issued: 1, status: "loading", attempt: 1 },
    effects: [{ type: "request", attempt: 1, query: "" }],
  }
}

export function transitionTypeahead<T>(state: TypeaheadState<T>, event: TypeaheadEvent<T>): TypeaheadTransition<T> {
  if (state.status === "disposed") return { state, effects: NONE }

  switch (event.type) {
    case "disposed":
      return { state: DISPOSED, effects: busy(state) ? CANCEL : NONE }
    case "initial.synced":
      return syncInitial(state, event.initial)
    case "input.changed":
      return changeInput(state, event)
    case "debounce.elapsed":
      if (state.status !== "debouncing" || state.attempt !== event.attempt) return { state, effects: NONE }

      return {
        state: { ...state, status: "loading" },
        effects: [{ type: "request", attempt: state.attempt, query: query(state) }],
      }
    case "retry.requested": {
      if (state.status !== "failed") return { state, effects: NONE }
      const attempt = state.issued + 1

      return {
        state: { ...live(state), issued: attempt, status: "loading", attempt },
        effects: [{ type: "request", attempt, query: query(state) }],
      }
    }

    case "request.succeeded":
      if (state.status !== "loading" || state.attempt !== event.attempt) return { state, effects: NONE }

      return {
        state: {
          ...live(state),
          cache: new Map(state.cache).set(query(state), event.items),
          shown: event.items,
          stale: false,
          answered: true,
          status: "ready",
        },
        effects: CANCEL,
      }
    case "request.failed":
    case "request.timed-out":
      if (state.status !== "loading" || state.attempt !== event.attempt) return { state, effects: NONE }

      return {
        state: { ...live(state), shown: EMPTY, stale: false, answered: true, status: "failed" },
        effects: CANCEL,
      }
  }
}

export function selectTypeaheadInput<T>(state: TypeaheadState<T>) {
  return state.status === "disposed" ? "" : state.input
}

export function selectTypeaheadPending<T>(state: TypeaheadState<T>) {
  return state.status === "debouncing" || state.status === "loading"
}

export function selectTypeaheadFailed<T>(state: TypeaheadState<T>) {
  return state.status === "failed"
}

export function selectTypeaheadItems<T>(state: TypeaheadState<T>): T[] {
  return state.status === "disposed" ? EMPTY : state.shown
}

export function selectTypeaheadStale<T>(state: TypeaheadState<T>) {
  return state.status !== "disposed" && state.stale
}

export function selectTypeaheadAnimateHeight<T>(state: TypeaheadState<T>) {
  return state.status !== "disposed" && state.searched && state.shown.length > 0
}

export function selectTypeaheadAnswered<T>(state: TypeaheadState<T>) {
  return state.status !== "disposed" && state.answered
}

// The parent owns the opening list, so a refresh reaches an open panel for the empty query; a typed query keeps its
// own results and picks the new list up when it is cleared.
function syncInitial<T>(state: Live<T>, initial: TypeaheadInitial<T> | undefined): TypeaheadTransition<T> {
  if (initial === state.initial) return { state, effects: NONE }

  // A request for the empty query is already on its way and answers for itself.
  if (!initial || query(state) !== "" || state.status === "loading")
    return { state: { ...state, initial }, effects: NONE }
  const cache = new Map(state.cache)
  cache.delete("")

  return {
    state: {
      ...live(state),
      initial,
      cache,
      shown: initial.failed ? EMPTY : initial.items,
      stale: false,
      answered: true,
      status: initial.failed ? "failed" : "ready",
    },
    effects: NONE,
  }
}

// A cached or empty query answers at once; a typed one waits for `delayMs`. Rows narrow while it is pending, and
// broadening waits for an answer so speculative rows never flash.
function changeInput<T>(
  state: Live<T>,
  event: Extract<TypeaheadEvent<T>, { type: "input.changed" }>,
): TypeaheadTransition<T> {
  const next = event.input.trim()

  if (next === query(state)) {
    if (event.input === state.input && state.searched) return { state, effects: NONE }

    return { state: { ...state, input: event.input, searched: true }, effects: NONE }
  }

  const base = { ...live(state), input: event.input, searched: true }
  const cancel = busy(state) ? CANCEL : NONE
  const opening = next === "" ? state.initial : undefined
  const cached = state.cache.get(next) ?? (opening && !opening.failed ? opening.items : undefined)

  if (cached)
    return { state: { ...base, shown: cached, stale: false, answered: true, status: "ready" }, effects: cancel }

  if (opening?.failed)
    return { state: { ...base, shown: EMPTY, stale: false, answered: true, status: "failed" }, effects: cancel }
  const attempt = state.issued + 1
  const narrowed = state.shown.filter((item) => event.match(item, next))

  const rows =
    narrowed.length > 0 ? { shown: narrowed, stale: false } : { shown: state.shown, stale: state.shown.length > 0 }

  if (next === "" || event.delayMs <= 0)
    return {
      state: { ...base, ...rows, issued: attempt, status: "loading", attempt },
      effects: [{ type: "request", attempt, query: next }],
    }

  return {
    state: { ...base, ...rows, issued: attempt, status: "debouncing", attempt },
    effects: [{ type: "debounce", attempt, delayMs: event.delayMs }],
  }
}

function query<T>(state: Live<T>) {
  return state.input.trim()
}

function busy<T>(state: Live<T>) {
  return state.status === "debouncing" || state.status === "loading"
}

function live<T>(state: Live<T>): TypeaheadLive<T> {
  return {
    input: state.input,
    searched: state.searched,
    answered: state.answered,
    initial: state.initial,
    cache: state.cache,
    shown: state.shown,
    stale: state.stale,
    issued: state.issued,
  }
}
