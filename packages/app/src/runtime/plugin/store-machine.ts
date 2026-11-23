import type { Mutable } from "@opencode/plugin/gui"

/** A `Persisted` write, kept as data while it waits. */
export type StoreWrite<T> =
  | { readonly kind: "update"; readonly mutate: (draft: Mutable<T>) => undefined }
  | { readonly kind: "set"; readonly value: T }

/** One opened plugin store, from its storage read until its owner goes away. */
export type StoreLoadState<T> =
  /** The storage read is pending; writes wait, in call order. */
  | { readonly status: "loading"; readonly queue: readonly StoreWrite<T>[] }
  | { readonly status: "ready" }
  /** The storage read failed: the value never loads, and writes are dropped. */
  | { readonly status: "failed" }
  | { readonly status: "disposed" }

export type StoreLoadEvent<T> =
  | { readonly type: "write"; readonly write: StoreWrite<T> }
  | { readonly type: "loaded" }
  | { readonly type: "failed"; readonly cause: unknown }
  | { readonly type: "disposed" }

export type StoreLoadEffect<T> =
  /**
   * `hydrated`: the writes that waited for the read. Each applies on its own, so an invalid one cannot keep the rest
   * or the value from loading, and the load settles after them. Otherwise one write, which throws to its caller.
   */
  | { readonly type: "apply"; readonly writes: readonly StoreWrite<T>[]; readonly hydrated: boolean }
  /** Settles the load as failed; `log` reports a real failure rather than a disposal. */
  | { readonly type: "reject"; readonly cause: unknown; readonly log: boolean }

export type StoreLoadTransition<T> = {
  readonly state: StoreLoadState<T>
  readonly effects: readonly StoreLoadEffect<T>[]
}

/** `async`: storage answers through a promise, so the value loads later. */
export function createStoreLoadState<T>(async: boolean): StoreLoadState<T> {
  return async ? { status: "loading", queue: [] } : { status: "ready" }
}

export function transitionStoreLoad<T>(state: StoreLoadState<T>, event: StoreLoadEvent<T>): StoreLoadTransition<T> {
  if (state.status === "disposed") return step(state)

  if (event.type === "disposed") {
    if (state.status !== "loading") return step({ status: "disposed" })

    return step({ status: "disposed" }, [{ type: "reject", cause: new Error("Plugin store disposed"), log: false }])
  }

  if (state.status === "ready") {
    if (event.type !== "write") return step(state)

    return step(state, [{ type: "apply", writes: [event.write], hydrated: false }])
  }

  if (state.status === "failed") return step(state)

  if (event.type === "write") return step({ status: "loading", queue: [...state.queue, event.write] })

  if (event.type === "loaded")
    return step({ status: "ready" }, [{ type: "apply", writes: state.queue, hydrated: true }])

  return step({ status: "failed" }, [{ type: "reject", cause: event.cause, log: true }])
}

/** The value has loaded: `Persisted.value` and `ready()` read it. */
export function selectStoreReady<T>(state: StoreLoadState<T>) {
  return state.status === "ready"
}

/** A `Persisted` over a store that opens later, and opens again when its key moves (a new directory or mount). */
export type DeferredStoreState<H, T> =
  /** No store is open, before the first or between two: writes wait for the next one, in call order. */
  | { readonly status: "pending"; readonly queue: readonly StoreWrite<T>[] }
  | { readonly status: "open"; readonly handle: H }
  | { readonly status: "disposed" }

export type DeferredStoreEvent<H, T> =
  /** The store currently open, if any. */
  | { readonly type: "sync"; readonly handle: H | undefined }
  | { readonly type: "write"; readonly write: StoreWrite<T> }
  | { readonly type: "disposed" }

export type DeferredStoreEffect<H, T> =
  /** The writes that waited: each applies on its own, in order. */
  | { readonly type: "handover"; readonly handle: H; readonly writes: readonly StoreWrite<T>[] }
  /** A write to the open store, which throws to its caller. */
  | { readonly type: "forward"; readonly handle: H; readonly write: StoreWrite<T> }

export type DeferredStoreTransition<H, T> = {
  readonly state: DeferredStoreState<H, T>
  readonly effects: readonly DeferredStoreEffect<H, T>[]
}

export function createDeferredStoreState<H, T>(): DeferredStoreState<H, T> {
  return { status: "pending", queue: [] }
}

export function transitionDeferredStore<H, T>(
  state: DeferredStoreState<H, T>,
  event: DeferredStoreEvent<H, T>,
): DeferredStoreTransition<H, T> {
  if (state.status === "disposed") return deferredStep(state)

  if (event.type === "disposed") return deferredStep({ status: "disposed" })

  if (state.status === "open") {
    if (event.type === "write")
      return deferredStep(state, [{ type: "forward", handle: state.handle, write: event.write }])

    if (event.handle === state.handle) return deferredStep(state)

    if (event.handle === undefined) return deferredStep({ status: "pending", queue: [] })

    return deferredStep({ status: "open", handle: event.handle })
  }

  if (event.type === "write") return deferredStep({ status: "pending", queue: [...state.queue, event.write] })

  if (event.handle === undefined) return deferredStep(state)

  if (state.queue.length === 0) return deferredStep({ status: "open", handle: event.handle })

  return deferredStep({ status: "open", handle: event.handle }, [
    { type: "handover", handle: event.handle, writes: state.queue },
  ])
}

function step<T>(state: StoreLoadState<T>, effects: readonly StoreLoadEffect<T>[] = []): StoreLoadTransition<T> {
  return { state, effects }
}

function deferredStep<H, T>(
  state: DeferredStoreState<H, T>,
  effects: readonly DeferredStoreEffect<H, T>[] = [],
): DeferredStoreTransition<H, T> {
  return { state, effects }
}
