export type ComposerWrite<T> = (target: T) => void

/**
 * A routed session's draft that plugin writes wait for. Writes queue in call order, including a write a queued write
 * makes, which runs after the ones already waiting.
 */
export type ComposerTargetEntry<T> =
  /** The draft is still loading from storage. */
  | { readonly status: "loading"; readonly target: T; readonly queue: readonly ComposerWrite<T>[] }
  /** The draft loaded and its waiting writes run one at a time. */
  | { readonly status: "draining"; readonly target: T; readonly queue: readonly ComposerWrite<T>[] }

export type ComposerWriteState<T> =
  | { readonly status: "active"; readonly entries: readonly ComposerTargetEntry<T>[] }
  | { readonly status: "disposed" }

export type ComposerWriteEvent<T> =
  /** `load`: the target's draft load while it is still loading; a loaded draft takes the write at once. */
  | {
      readonly type: "write"
      readonly target: T
      readonly load: Promise<unknown> | undefined
      readonly write: ComposerWrite<T>
    }
  | { readonly type: "loaded"; readonly target: T }
  /** Runs the target's next waiting write, or ends its drain. */
  | { readonly type: "drain.next"; readonly target: T }
  | { readonly type: "failed"; readonly target: T; readonly cause: unknown }
  | { readonly type: "disposed" }

export type ComposerWriteEffect<T> =
  | { readonly type: "observe"; readonly target: T; readonly load: Promise<unknown> }
  | { readonly type: "apply"; readonly target: T; readonly write: ComposerWrite<T> }
  | { readonly type: "drain"; readonly target: T }
  | { readonly type: "log"; readonly cause: unknown }

export type ComposerWriteTransition<T> = {
  readonly state: ComposerWriteState<T>
  readonly effects: readonly ComposerWriteEffect<T>[]
}

export function createComposerWriteState<T>(): ComposerWriteState<T> {
  return { status: "active", entries: [] }
}

export function transitionComposerWrite<T>(
  state: ComposerWriteState<T>,
  event: ComposerWriteEvent<T>,
): ComposerWriteTransition<T> {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: [] }

  const entry = state.entries.find((item) => item.target === event.target)

  if (event.type === "write") {
    if (entry) return { state: replace(state, { ...entry, queue: [...entry.queue, event.write] }), effects: [] }

    if (!event.load) return { state, effects: [{ type: "apply", target: event.target, write: event.write }] }

    return {
      state: {
        status: "active",
        entries: [...state.entries, { status: "loading", target: event.target, queue: [event.write] }],
      },
      effects: [{ type: "observe", target: event.target, load: event.load }],
    }
  }

  if (event.type === "loaded") {
    if (entry?.status !== "loading") return { state, effects: [] }

    return {
      state: replace(state, { status: "draining", target: entry.target, queue: entry.queue }),
      effects: [{ type: "drain", target: entry.target }],
    }
  }

  // A draft that failed to load stays on disk untouched: writes made before the load settled are dropped rather than
  // replace it with an edited empty draft. Later writes apply as the user's own edits do.
  if (event.type === "failed") {
    if (entry?.status !== "loading") return { state, effects: [] }

    return { state: remove(state, entry.target), effects: [{ type: "log", cause: event.cause }] }
  }

  if (entry?.status !== "draining") return { state, effects: [] }

  const [head, ...rest] = entry.queue

  if (!head) return { state: remove(state, entry.target), effects: [] }

  return {
    state: replace(state, { status: "draining", target: entry.target, queue: rest }),
    effects: [
      { type: "apply", target: entry.target, write: head },
      { type: "drain", target: entry.target },
    ],
  }
}

function replace<T>(state: Extract<ComposerWriteState<T>, { status: "active" }>, entry: ComposerTargetEntry<T>) {
  return {
    status: "active" as const,
    entries: state.entries.map((item) => (item.target === entry.target ? entry : item)),
  }
}

function remove<T>(state: Extract<ComposerWriteState<T>, { status: "active" }>, target: T) {
  return { status: "active" as const, entries: state.entries.filter((item) => item.target !== target) }
}
