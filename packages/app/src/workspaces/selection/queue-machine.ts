export type TaskPriority = "user" | "background"

/**
 * The directory picker's listing queue: at most `concurrency` tasks run, and a free slot takes the newest `user` task
 * before the oldest `background` one. `busy` always has a running task.
 */
export type PriorityQueueState =
  | { readonly status: "idle" }
  | {
      readonly status: "busy"
      readonly running: readonly string[]
      readonly user: readonly string[]
      readonly background: readonly string[]
    }

export type PriorityQueueEvent =
  | { readonly type: "scheduled"; readonly key: string; readonly priority: TaskPriority }
  | { readonly type: "promoted"; readonly key: string }
  | { readonly type: "settled"; readonly key: string }
  | { readonly type: "aborted"; readonly key: string }
  | { readonly type: "cleared" }

export type PriorityQueueEffect =
  | { readonly type: "start"; readonly key: string }
  /** Aborts the tasks and resolves their promises with undefined at once, so a task that never settles frees its slot. */
  | { readonly type: "cancel"; readonly keys: readonly string[] }

export type PriorityQueueTransition = {
  readonly state: PriorityQueueState
  readonly effects: readonly PriorityQueueEffect[]
}

const IDLE: PriorityQueueState = { status: "idle" }

export function transitionPriorityQueue(
  state: PriorityQueueState,
  event: PriorityQueueEvent,
  concurrency: number,
): PriorityQueueTransition {
  if (event.type === "scheduled" && state.status === "idle")
    return {
      state: { status: "busy", running: [event.key], user: [], background: [] },
      effects: [{ type: "start", key: event.key }],
    }

  if (state.status === "idle") return { state, effects: [] }

  if (event.type === "cleared")
    return { state: IDLE, effects: [{ type: "cancel", keys: [...state.user, ...state.background, ...state.running] }] }

  if (event.type === "scheduled" || event.type === "promoted") {
    const priority = event.type === "promoted" ? "user" : event.priority

    if (state.background.includes(event.key)) {
      if (priority !== "user") return { state, effects: [] }

      return {
        state: {
          ...state,
          user: [...state.user, event.key],
          background: state.background.filter((key) => key !== event.key),
        },
        effects: [],
      }
    }

    if (event.type === "promoted" || state.running.includes(event.key) || state.user.includes(event.key))
      return { state, effects: [] }

    if (state.running.length < concurrency)
      return {
        state: { ...state, running: [...state.running, event.key] },
        effects: [{ type: "start", key: event.key }],
      }

    return {
      state:
        priority === "user"
          ? { ...state, user: [...state.user, event.key] }
          : { ...state, background: [...state.background, event.key] },
      effects: [],
    }
  }

  if (event.type === "aborted" && (state.user.includes(event.key) || state.background.includes(event.key)))
    return {
      state: {
        ...state,
        user: state.user.filter((key) => key !== event.key),
        background: state.background.filter((key) => key !== event.key),
      },
      effects: [{ type: "cancel", keys: [event.key] }],
    }

  if (!state.running.includes(event.key)) return { state, effects: [] }
  const running = state.running.filter((key) => key !== event.key)
  const next = state.user.at(-1) ?? state.background[0]
  const cancel: readonly PriorityQueueEffect[] = event.type === "aborted" ? [{ type: "cancel", keys: [event.key] }] : []

  if (next === undefined) return { state: running.length === 0 ? IDLE : { ...state, running }, effects: cancel }

  return {
    state: {
      status: "busy",
      running: [...running, next],
      user: state.user.filter((key) => key !== next),
      background: state.background.filter((key) => key !== next),
    },
    effects: [...cancel, { type: "start", key: next }],
  }
}

export type DirectoryCacheEntry<T> =
  | { readonly status: "loading"; readonly attempt: number }
  | { readonly status: "ready"; readonly items: readonly T[] }

export type PickerLocation = { readonly directory: string; readonly workspace?: string }

/**
 * The picker dialog's cache of folder listings for path autocomplete. Concurrent lookups of one folder share a read.
 * A failed read answers its lookups with no folders and leaves the cache, so the next keystroke reads it again.
 */
export type DirectoryCacheState<T> =
  | {
      readonly status: "active"
      readonly issued: number
      readonly entries: Readonly<Record<string, DirectoryCacheEntry<T>>>
    }
  | { readonly status: "disposed" }

export type DirectoryCacheEvent<T> =
  | {
      readonly type: "lookup.requested"
      readonly key: string
      readonly location: PickerLocation
      readonly directory: string
    }
  | { readonly type: "lookup.succeeded"; readonly key: string; readonly attempt: number; readonly items: readonly T[] }
  | { readonly type: "lookup.failed"; readonly key: string; readonly attempt: number }
  | { readonly type: "disposed" }

export type DirectoryCacheEffect<T> =
  | {
      readonly type: "fetch"
      readonly key: string
      readonly attempt: number
      readonly location: PickerLocation
      readonly directory: string
    }
  /** Answers every lookup waiting on `attempt`. */
  | { readonly type: "resolve"; readonly attempt: number; readonly items: readonly T[] }
  /** Aborts every read and answers every waiting lookup with no folders. */
  | { readonly type: "abort-all" }

export type DirectoryCacheTransition<T> = {
  readonly state: DirectoryCacheState<T>
  readonly effects: readonly DirectoryCacheEffect<T>[]
}

export function createDirectoryCacheState<T>(): DirectoryCacheState<T> {
  return { status: "active", issued: 0, entries: {} }
}

export function transitionDirectoryCache<T>(
  state: DirectoryCacheState<T>,
  event: DirectoryCacheEvent<T>,
): DirectoryCacheTransition<T> {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: [{ type: "abort-all" }] }

  if (event.type === "lookup.requested") {
    if (state.entries[event.key]) return { state, effects: [] }
    const attempt = state.issued + 1

    return {
      state: { ...state, issued: attempt, entries: { ...state.entries, [event.key]: { status: "loading", attempt } } },
      effects: [{ type: "fetch", key: event.key, attempt, location: event.location, directory: event.directory }],
    }
  }

  const entry = state.entries[event.key]

  if (entry?.status !== "loading" || entry.attempt !== event.attempt) return { state, effects: [] }

  if (event.type === "lookup.succeeded")
    return {
      state: { ...state, entries: { ...state.entries, [event.key]: { status: "ready", items: event.items } } },
      effects: [{ type: "resolve", attempt: event.attempt, items: event.items }],
    }

  return {
    state: {
      ...state,
      entries: Object.fromEntries(Object.entries(state.entries).filter(([key]) => key !== event.key)),
    },
    effects: [{ type: "resolve", attempt: event.attempt, items: [] }],
  }
}

export function directoryCacheEntry<T>(state: DirectoryCacheState<T>, key: string) {
  return state.status === "active" ? state.entries[key] : undefined
}
