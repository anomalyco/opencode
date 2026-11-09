/** A run of failed writes backs off up to `2 ** 6 = 64` times the base delay. */
export const MAX_RETRY_EXPONENT = 6

/**
 * A write-behind buffer: rows wait in `scheduled` for the timer, are written in one batch in `flushing`, and go back
 * to `scheduled` with a longer delay when the write fails, so no acknowledged row is left without a pending write.
 * `attempt` names the current timer and write; a result for another attempt is stale.
 */
export type WriteBehindState<T> =
  | { readonly status: "idle" }
  | {
      readonly status: "scheduled"
      readonly pending: ReadonlyMap<string, T>
      readonly attempt: number
      /** Consecutive failed writes, for the retry backoff. */
      readonly failures: number
    }
  | {
      readonly status: "flushing"
      readonly inFlight: ReadonlyMap<string, T>
      /** Rows set while the batch is written; they win over `inFlight` for the same key. */
      readonly queued: ReadonlyMap<string, T>
      readonly attempt: number
      readonly failures: number
      /** The buffer closes once this write settles. */
      readonly closing: boolean
    }
  | { readonly status: "closed" }

export type WriteBehindEvent<T> =
  | { readonly type: "set"; readonly key: string; readonly value: T }
  | { readonly type: "drop"; readonly predicate: (value: T) => boolean }
  | { readonly type: "timer.fired"; readonly attempt: number }
  | { readonly type: "flush.requested" }
  | { readonly type: "close.requested" }
  | { readonly type: "write.succeeded"; readonly attempt: number }
  | { readonly type: "write.failed"; readonly attempt: number; readonly error: unknown }

export type WriteBehindCommand<T> =
  | { readonly type: "start-timer"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "cancel-timer" }
  | { readonly type: "write"; readonly attempt: number; readonly batch: Map<string, T> }
  | { readonly type: "report-error"; readonly error: unknown }
  | { readonly type: "reject-closed" }

export type WriteBehindTransition<T> = {
  readonly state: WriteBehindState<T>
  readonly commands: readonly WriteBehindCommand<T>[]
}

const IDLE = Object.freeze({ status: "idle" as const })

const CLOSED = Object.freeze({ status: "closed" as const })

const EMPTY: ReadonlyMap<string, never> = new Map<string, never>()

export function initialWriteBehindState<T>(): WriteBehindState<T> {
  return IDLE
}

export function transitionWriteBehind<T>(
  state: WriteBehindState<T>,
  event: WriteBehindEvent<T>,
  delay: number,
): WriteBehindTransition<T> {
  if (state.status === "closed")
    return event.type === "set" ? unchanged(state, [{ type: "reject-closed" }]) : unchanged(state)

  if (state.status === "idle") {
    if (event.type === "close.requested") return { state: CLOSED, commands: [] }

    if (event.type !== "set") return unchanged(state)

    return {
      state: { status: "scheduled", pending: new Map([[event.key, event.value]]), attempt: 1, failures: 0 },
      commands: [{ type: "start-timer", attempt: 1, delayMs: delay }],
    }
  }

  if (state.status === "scheduled") return scheduled(state, event)

  return flushing(state, event, delay)
}

function scheduled<T>(
  state: Extract<WriteBehindState<T>, { status: "scheduled" }>,
  event: WriteBehindEvent<T>,
): WriteBehindTransition<T> {
  if (event.type === "set")
    return { state: { ...state, pending: put(state.pending, event.key, event.value) }, commands: [] }

  if (event.type === "drop") {
    const pending = without(state.pending, event.predicate)

    if (pending === state.pending) return unchanged(state)

    if (pending.size === 0) return { state: IDLE, commands: [{ type: "cancel-timer" }] }

    return { state: { ...state, pending }, commands: [] }
  }

  if (event.type === "timer.fired" && event.attempt !== state.attempt) return unchanged(state)

  if (event.type === "timer.fired" || event.type === "flush.requested" || event.type === "close.requested") {
    const attempt = state.attempt + 1

    return {
      state: {
        status: "flushing",
        inFlight: state.pending,
        queued: EMPTY,
        attempt,
        failures: state.failures,
        closing: event.type === "close.requested",
      },
      commands: [{ type: "cancel-timer" }, { type: "write", attempt, batch: new Map(state.pending) }],
    }
  }

  return unchanged(state)
}

function flushing<T>(
  state: Extract<WriteBehindState<T>, { status: "flushing" }>,
  event: WriteBehindEvent<T>,
  delay: number,
): WriteBehindTransition<T> {
  if (event.type === "set") {
    if (state.closing) return unchanged(state, [{ type: "reject-closed" }])

    return { state: { ...state, queued: put(state.queued, event.key, event.value) }, commands: [] }
  }

  // A cleared row must not come back when a failed batch is queued again.
  if (event.type === "drop") {
    const inFlight = without(state.inFlight, event.predicate)
    const queued = without(state.queued, event.predicate)

    if (inFlight === state.inFlight && queued === state.queued) return unchanged(state)

    return { state: { ...state, inFlight, queued }, commands: [] }
  }

  if (event.type === "close.requested")
    return state.closing ? unchanged(state) : { state: { ...state, closing: true }, commands: [] }

  if (event.type !== "write.succeeded" && event.type !== "write.failed") return unchanged(state)

  if (event.attempt !== state.attempt) return unchanged(state)

  const attempt = state.attempt + 1

  if (event.type === "write.succeeded") {
    if (state.closing) return { state: CLOSED, commands: [] }

    if (state.queued.size === 0) return { state: IDLE, commands: [] }

    return {
      state: { status: "scheduled", pending: state.queued, attempt, failures: 0 },
      commands: [{ type: "start-timer", attempt, delayMs: delay }],
    }
  }

  const report = { type: "report-error", error: event.error } as const

  // The database is closing with the app; there is no later write to retry with.
  if (state.closing) return { state: CLOSED, commands: [report] }

  // The renderer already saw these rows saved, so they are written again; rows set since then win.
  const pending = new Map([...state.inFlight, ...state.queued])

  if (pending.size === 0) return { state: IDLE, commands: [report] }

  // The retry is scheduled before the error is reported, so a report that throws cannot leave the rows unscheduled.
  return {
    state: { status: "scheduled", pending, attempt, failures: state.failures + 1 },
    commands: [
      { type: "start-timer", attempt, delayMs: delay * 2 ** Math.min(state.failures, MAX_RETRY_EXPONENT) },
      report,
    ],
  }
}

function put<T>(map: ReadonlyMap<string, T>, key: string, value: T) {
  return new Map(map).set(key, value)
}

function without<T>(map: ReadonlyMap<string, T>, predicate: (value: T) => boolean) {
  const kept = new Map([...map].filter(([, value]) => !predicate(value)))

  return kept.size === map.size ? map : kept
}

function unchanged<T>(
  state: WriteBehindState<T>,
  commands: readonly WriteBehindCommand<T>[] = [],
): WriteBehindTransition<T> {
  return { state, commands }
}

/** New rows are refused: the buffer closed, or closes once its last write settles. */
export function isWriteBehindClosed<T>(state: WriteBehindState<T>) {
  return state.status === "closed" || (state.status === "flushing" && state.closing)
}

/** The rows not yet written, by key; a row set during a write wins over the one being written. */
export function selectPendingRows<T>(state: WriteBehindState<T>): ReadonlyMap<string, T> {
  if (state.status === "scheduled") return state.pending

  if (state.status === "flushing")
    return state.queued.size === 0 ? state.inFlight : new Map([...state.inFlight, ...state.queued])

  return EMPTY
}
