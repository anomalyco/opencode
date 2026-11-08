/** How long one load of the provider and model catalogs may take before it counts as failed. */
export const CATALOG_LOAD_TIMEOUT_MS = 15_000

// A cold Location lists its catalogs once its plugins activate, which can take longer than the server's 5 s wait. The
// same budget as the app's own catalog: 12 tries, 1 s apart doubling up to 5 s.
const RETRIES = 11

/** The server's data and the session's directory; an empty directory loads the server's default Location. */
export type CatalogTarget<Data> = { readonly data: Data; readonly directory: string }

/**
 * What the catalog of the current target is doing. `idle` has not loaded it yet: the view is detached, or there is
 * no target while the server is disconnected. A load or retry for a target that is gone is cancelled.
 */
export type CatalogPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly attempt: number; readonly retries: number }
  | { readonly kind: "retrying"; readonly attempt: number; readonly retries: number }
  | { readonly kind: "loaded" }
  | { readonly kind: "failed" }

export type CatalogState<Data> =
  | {
      readonly status: "open"
      readonly issued: number
      /** The view is selected; a detached view starts no load. */
      readonly active: boolean
      readonly target: CatalogTarget<Data> | undefined
      readonly phase: CatalogPhase
    }
  | { readonly status: "disposed" }

export type CatalogEvent<Data> =
  | { readonly type: "input.changed"; readonly active: boolean; readonly target: CatalogTarget<Data> | undefined }
  | { readonly type: "load.succeeded"; readonly attempt: number }
  | { readonly type: "load.failed"; readonly attempt: number; readonly retryable: boolean }
  /** The load hung past `CATALOG_LOAD_TIMEOUT_MS`. The data layer joins a load in flight, so retrying would wait on it. */
  | { readonly type: "load.timed-out"; readonly attempt: number }
  | { readonly type: "retry.due"; readonly attempt: number }
  /** The user opened the context view; a failed catalog loads again. */
  | { readonly type: "retry.requested" }
  | { readonly type: "disposed" }

export type CatalogEffect<Data> =
  | { readonly type: "load"; readonly attempt: number; readonly target: CatalogTarget<Data> }
  | { readonly type: "schedule-retry"; readonly attempt: number; readonly delay: number }
  /** Stops waiting for an attempt's load or retry timer; its result, if any, is ignored. */
  | { readonly type: "cancel"; readonly attempt: number }

export type CatalogTransition<Data> = {
  readonly state: CatalogState<Data>
  readonly effects: readonly CatalogEffect<Data>[]
}

export function createCatalogState<Data>(): CatalogState<Data> {
  return { status: "open", issued: 0, active: false, target: undefined, phase: { kind: "idle" } }
}

export function transitionCatalog<Data>(state: CatalogState<Data>, event: CatalogEvent<Data>): CatalogTransition<Data> {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: cancel<Data>(state.phase) }

  if (event.type === "input.changed") return inputChanged(state, event.active, event.target)

  if (event.type === "load.succeeded") {
    if (state.phase.kind !== "loading" || state.phase.attempt !== event.attempt) return { state, effects: [] }

    return { state: { ...state, phase: { kind: "loaded" } }, effects: [] }
  }

  if (event.type === "load.failed" || event.type === "load.timed-out") {
    if (state.phase.kind !== "loading" || state.phase.attempt !== event.attempt) return { state, effects: [] }
    const retries = state.phase.retries

    // A detached view stops retrying; selecting it again loads afresh.
    if (event.type === "load.timed-out" || !event.retryable || !state.active || retries >= RETRIES)
      return { state: { ...state, phase: { kind: "failed" } }, effects: [] }
    const attempt = state.issued + 1

    return {
      state: { ...state, issued: attempt, phase: { kind: "retrying", attempt, retries: retries + 1 } },
      effects: [{ type: "schedule-retry", attempt, delay: Math.min(1_000 * 2 ** retries, 5_000) }],
    }
  }

  if (event.type === "retry.due") {
    if (state.phase.kind !== "retrying" || state.phase.attempt !== event.attempt || !state.target)
      return { state, effects: [] }

    return {
      state: { ...state, phase: { kind: "loading", attempt: event.attempt, retries: state.phase.retries } },
      effects: [{ type: "load", attempt: event.attempt, target: state.target }],
    }
  }

  if (state.phase.kind !== "failed" || !state.target) return { state, effects: [] }

  return load(state, state.target)
}

function inputChanged<Data>(
  state: Extract<CatalogState<Data>, { status: "open" }>,
  active: boolean,
  target: CatalogTarget<Data> | undefined,
): CatalogTransition<Data> {
  if (!target) {
    if (state.active === active && !state.target) return { state, effects: [] }

    return {
      state: { ...state, active, target: undefined, phase: { kind: "idle" } },
      effects: cancel<Data>(state.phase),
    }
  }

  // Another session of the same directory on the same server keeps the catalog it loaded.
  if (!state.target || state.target.data !== target.data || state.target.directory !== target.directory) {
    const effects = cancel<Data>(state.phase)

    if (!active) return { state: { ...state, active, target, phase: { kind: "idle" } }, effects }
    const next = load({ ...state, active, target }, target)

    return { state: next.state, effects: [...effects, ...next.effects] }
  }

  if (active && (state.phase.kind === "idle" || state.phase.kind === "failed")) {
    return load({ ...state, active }, target)
  }

  if (!active && state.phase.kind === "retrying") {
    return { state: { ...state, active, phase: { kind: "failed" } }, effects: cancel<Data>(state.phase) }
  }

  if (state.active === active) return { state, effects: [] }

  return { state: { ...state, active }, effects: [] }
}

function load<Data>(
  state: Extract<CatalogState<Data>, { status: "open" }>,
  target: CatalogTarget<Data>,
): CatalogTransition<Data> {
  const attempt = state.issued + 1

  return {
    state: { ...state, issued: attempt, phase: { kind: "loading", attempt, retries: 0 } },
    effects: [{ type: "load", attempt, target }],
  }
}

function cancel<Data>(phase: CatalogPhase): CatalogEffect<Data>[] {
  return phase.kind === "loading" || phase.kind === "retrying" ? [{ type: "cancel", attempt: phase.attempt }] : []
}
