export const SETTING_WRITE_TIMEOUT_MS = 15_000

/** `message` is empty when the error carried none. */
export type SettingWriteFailure = { readonly kind: "failed"; readonly message: string } | { readonly kind: "timeout" }

/** The read in flight for the current source. Once a write is accepted its value is stale, so it only fills `meta`. */
type SettingLoad = { readonly attempt: number; readonly metaOnly: boolean }

/**
 * A setting `T` written optimistically to a source `S` (a server, the desktop shell), with read-only `M` loaded beside
 * it (a server's shell list). Writes run one at a time: `active` is on the wire, `queued` holds the latest choice made
 * meanwhile, and `confirmed` is the value the source last accepted, which a failure rolls back to.
 */
export type OptimisticSettingState<T, M, S> =
  | { readonly status: "disabled"; readonly issued: number; readonly value: T; readonly meta: M }
  | {
      readonly status: "idle"
      readonly issued: number
      readonly source: S
      readonly value: T
      readonly meta: M
      readonly load: SettingLoad | undefined
    }
  | {
      readonly status: "writing"
      readonly issued: number
      readonly source: S
      readonly meta: M
      readonly load: SettingLoad | undefined
      readonly attempt: number
      readonly confirmed: T
      readonly active: T
      readonly queued: { readonly value: T } | undefined
    }

export type OptimisticSettingEvent<T, M, S> =
  /** `undefined` while no source can take the setting. */
  | { readonly type: "source.synced"; readonly source: S | undefined }
  | { readonly type: "load.succeeded"; readonly attempt: number; readonly value: T; readonly meta: M }
  | { readonly type: "load.failed"; readonly attempt: number }
  | { readonly type: "write.requested"; readonly value: T }
  | { readonly type: "write.succeeded"; readonly attempt: number }
  | { readonly type: "write.failed"; readonly attempt: number; readonly message: string }
  | { readonly type: "write.timed-out"; readonly attempt: number }

export type OptimisticSettingEffect<T, S> =
  | { readonly type: "load"; readonly attempt: number; readonly source: S }
  | { readonly type: "write"; readonly attempt: number; readonly source: S; readonly value: T; readonly timeoutMs: number }
  | { readonly type: "notify.error"; readonly failure: SettingWriteFailure }

export type OptimisticSettingTransition<T, M, S> = {
  readonly state: OptimisticSettingState<T, M, S>
  readonly effects: readonly OptimisticSettingEffect<T, S>[]
}

type Writing<T, M, S> = Extract<OptimisticSettingState<T, M, S>, { status: "writing" }>

export function createOptimisticSettingState<T, M, S>(value: T, meta: M): OptimisticSettingState<T, M, S> {
  return { status: "disabled", issued: 0, value, meta }
}

export function transitionOptimisticSetting<T, M, S>(
  state: OptimisticSettingState<T, M, S>,
  event: OptimisticSettingEvent<T, M, S>,
): OptimisticSettingTransition<T, M, S> {
  if (event.type === "source.synced") return synced(state, event.source)

  if (event.type === "write.requested") return requested(state, event.value)

  if (event.type === "load.succeeded" || event.type === "load.failed") return loaded(state, event)

  if (state.status !== "writing" || state.attempt !== event.attempt) return { state, effects: [] }

  if (event.type === "write.succeeded") return succeeded(state)

  return failed(state, event.type === "write.failed" ? { kind: "failed", message: event.message } : { kind: "timeout" })
}

/** What the control shows: the newest choice while writes are in flight. */
export function selectSettingValue<T, M, S>(state: OptimisticSettingState<T, M, S>) {
  if (state.status !== "writing") return state.value

  return state.queued ? state.queued.value : state.active
}

export function selectSettingMeta<T, M, S>(state: OptimisticSettingState<T, M, S>) {
  return state.meta
}

// Another source (new credentials) reads again and drops writes meant for the previous one. Until it answers, the last
// value stays, as it did with the resource this replaced.
function synced<T, M, S>(
  state: OptimisticSettingState<T, M, S>,
  source: S | undefined,
): OptimisticSettingTransition<T, M, S> {
  const value = selectSettingValue(state)

  if (source === undefined) {
    if (state.status === "disabled") return { state, effects: [] }

    return { state: { status: "disabled", issued: state.issued, value, meta: state.meta }, effects: [] }
  }

  if (state.status !== "disabled" && Object.is(state.source, source)) return { state, effects: [] }
  const attempt = state.issued + 1

  return {
    state: { status: "idle", issued: attempt, source, value, meta: state.meta, load: { attempt, metaOnly: false } },
    effects: [{ type: "load", attempt, source }],
  }
}

function requested<T, M, S>(
  state: OptimisticSettingState<T, M, S>,
  value: T,
): OptimisticSettingTransition<T, M, S> {
  if (state.status === "disabled" || Object.is(value, selectSettingValue(state))) return { state, effects: [] }

  if (state.status === "writing") {
    return { state: { ...state, queued: Object.is(value, state.active) ? undefined : { value } }, effects: [] }
  }

  const attempt = state.issued + 1

  return {
    state: {
      status: "writing",
      issued: attempt,
      source: state.source,
      meta: state.meta,
      load: state.load,
      attempt,
      confirmed: state.value,
      active: value,
      queued: undefined,
    },
    effects: [write(attempt, state.source, value)],
  }
}

function loaded<T, M, S>(
  state: OptimisticSettingState<T, M, S>,
  event: Extract<OptimisticSettingEvent<T, M, S>, { type: "load.succeeded" | "load.failed" }>,
): OptimisticSettingTransition<T, M, S> {
  if (state.status === "disabled" || state.load?.attempt !== event.attempt) return { state, effects: [] }

  if (event.type === "load.failed") return { state: { ...state, load: undefined }, effects: [] }

  const fresh = !state.load.metaOnly

  if (state.status === "idle") {
    return {
      state: { ...state, load: undefined, meta: event.meta, value: fresh ? event.value : state.value },
      effects: [],
    }
  }

  // A write is on the wire: the read only moves what a failure rolls back to.
  return {
    state: { ...state, load: undefined, meta: event.meta, confirmed: fresh ? event.value : state.confirmed },
    effects: [],
  }
}

function succeeded<T, M, S>(state: Writing<T, M, S>): OptimisticSettingTransition<T, M, S> {
  const load = state.load && { attempt: state.load.attempt, metaOnly: true }

  if (!state.queued || Object.is(state.queued.value, state.active)) {
    return {
      state: { status: "idle", issued: state.issued, source: state.source, value: state.active, meta: state.meta, load },
      effects: [],
    }
  }

  return next({ ...state, load, confirmed: state.active }, state.queued.value)
}

// A failure rolls back to what the source last accepted, unless a newer choice is waiting: that one goes next.
function failed<T, M, S>(state: Writing<T, M, S>, failure: SettingWriteFailure): OptimisticSettingTransition<T, M, S> {
  if (state.queued && !Object.is(state.queued.value, state.confirmed)) return next(state, state.queued.value)

  const rolledBack = {
    status: "idle" as const,
    issued: state.issued,
    source: state.source,
    value: state.confirmed,
    meta: state.meta,
    load: state.load,
  }

  // The user already chose the confirmed value again, so nothing they see is lost.
  if (state.queued) return { state: rolledBack, effects: [] }

  if (failure.kind === "failed") return { state: rolledBack, effects: [{ type: "notify.error", failure }] }

  // A write that timed out may still land, so read the source again to show what it kept.
  const attempt = state.issued + 1

  return {
    state: { ...rolledBack, issued: attempt, load: { attempt, metaOnly: false } },
    effects: [
      { type: "notify.error", failure },
      { type: "load", attempt, source: state.source },
    ],
  }
}

function next<T, M, S>(state: Writing<T, M, S>, value: T): OptimisticSettingTransition<T, M, S> {
  const attempt = state.issued + 1

  return {
    state: { ...state, issued: attempt, attempt, active: value, queued: undefined },
    effects: [write(attempt, state.source, value)],
  }
}

function write<T, S>(attempt: number, source: S, value: T): OptimisticSettingEffect<T, S> {
  return { type: "write", attempt, source, value, timeoutMs: SETTING_WRITE_TIMEOUT_MS }
}
