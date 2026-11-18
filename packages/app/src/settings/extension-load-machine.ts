/** How long one list read may run before the section offers Retry. */
export const EXTENSION_LOAD_TIMEOUT_MS = 15_000

/**
 * One keyed read for a Settings › Extensions list: the server's plugins, a project's plugins, or a project's language
 * server config. `key` is what the list belongs to (a server or a project folder); a new key drops the previous key's
 * value and aborts its read. `queued` marks a change (a config or plugin event, a reconnect) that arrived during a
 * read, so one more read follows it. A failed refresh keeps the value it already shows.
 */
export type ExtensionLoadState<T, K> =
  | { readonly status: "idle"; readonly issued: number }
  | {
      readonly status: "loading"
      readonly issued: number
      readonly attempt: number
      readonly key: K
      readonly queued: boolean
    }
  | { readonly status: "ready"; readonly issued: number; readonly key: K; readonly value: T }
  | {
      readonly status: "refreshing"
      readonly issued: number
      readonly attempt: number
      readonly key: K
      readonly value: T
      readonly queued: boolean
    }
  | { readonly status: "error"; readonly issued: number; readonly key: K }
  | { readonly status: "disposed" }

export type ExtensionLoadEvent<T, K> =
  | { readonly type: "target.synced"; readonly key: K }
  /** A config or plugin event for this list, or the event stream reconnected. */
  | { readonly type: "invalidated" }
  | { readonly type: "retry.requested" }
  | { readonly type: "load.succeeded"; readonly attempt: number; readonly value: T }
  | { readonly type: "load.failed"; readonly attempt: number }
  | { readonly type: "load.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type ExtensionLoadEffect<K> =
  | { readonly type: "run"; readonly attempt: number; readonly key: K; readonly timeoutMs: number }
  | { readonly type: "abort"; readonly attempt: number }

export type ExtensionLoadTransition<T, K> = {
  readonly state: ExtensionLoadState<T, K>
  readonly effects: readonly ExtensionLoadEffect<K>[]
}

export function createExtensionLoadState<T, K>(): ExtensionLoadState<T, K> {
  return { status: "idle", issued: 0 }
}

export function transitionExtensionLoad<T, K>(
  state: ExtensionLoadState<T, K>,
  event: ExtensionLoadEvent<T, K>,
): ExtensionLoadTransition<T, K> {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      effects: state.status === "loading" || state.status === "refreshing" ? [abort(state.attempt)] : [],
    }

  if (event.type === "target.synced") {
    if (state.status !== "idle" && Object.is(state.key, event.key)) return { state, effects: [] }
    const next = load<T, K>(state.issued, event.key)

    if (state.status === "loading" || state.status === "refreshing")
      return { state: next.state, effects: [abort(state.attempt), ...next.effects] }

    return next
  }

  if (state.status === "idle") return { state, effects: [] }

  if (event.type === "invalidated") {
    if (state.status === "ready") return refresh(state.issued, state.key, state.value)

    if (state.status === "error") return load<T, K>(state.issued, state.key)

    if (state.queued) return { state, effects: [] }

    return { state: { ...state, queued: true }, effects: [] }
  }

  if (event.type === "retry.requested") {
    if (state.status !== "error") return { state, effects: [] }

    return load<T, K>(state.issued, state.key)
  }

  if ((state.status !== "loading" && state.status !== "refreshing") || state.attempt !== event.attempt)
    return { state, effects: [] }
  const settle = abort(state.attempt)

  if (event.type === "load.succeeded") {
    const next = state.queued
      ? refresh(state.issued, state.key, event.value)
      : { state: { status: "ready", issued: state.issued, key: state.key, value: event.value } as const, effects: [] }

    return { state: next.state, effects: [settle, ...next.effects] }
  }

  if (state.queued) {
    const next =
      state.status === "refreshing"
        ? refresh(state.issued, state.key, state.value)
        : load<T, K>(state.issued, state.key)

    return { state: next.state, effects: [settle, ...next.effects] }
  }

  return {
    state:
      state.status === "refreshing"
        ? { status: "ready", issued: state.issued, key: state.key, value: state.value }
        : { status: "error", issued: state.issued, key: state.key },
    effects: [settle],
  }
}

/** What a list shows for `key`, the key it renders now; a state for another key reads as loading. */
export function extensionLoadView<T, K>(
  state: ExtensionLoadState<T, K>,
  key: K,
): { readonly status: "loading" } | { readonly status: "ready"; readonly value: T } | { readonly status: "error" } {
  if (state.status === "idle" || state.status === "disposed" || !Object.is(state.key, key)) return { status: "loading" }

  if (state.status === "ready" || state.status === "refreshing") return { status: "ready", value: state.value }

  if (state.status === "error") return { status: "error" }

  return { status: "loading" }
}

function load<T, K>(issued: number, key: K): ExtensionLoadTransition<T, K> {
  const attempt = issued + 1

  return {
    state: { status: "loading", issued: attempt, attempt, key, queued: false },
    effects: [{ type: "run", attempt, key, timeoutMs: EXTENSION_LOAD_TIMEOUT_MS }],
  }
}

function refresh<T, K>(issued: number, key: K, value: T): ExtensionLoadTransition<T, K> {
  const attempt = issued + 1

  return {
    state: { status: "refreshing", issued: attempt, attempt, key, value, queued: false },
    effects: [{ type: "run", attempt, key, timeoutMs: EXTENSION_LOAD_TIMEOUT_MS }],
  }
}

function abort(attempt: number): ExtensionLoadEffect<never> {
  return { type: "abort", attempt }
}
