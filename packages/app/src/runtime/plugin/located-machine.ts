/** A write held for a session whose location stays unknown this long is dropped, so it cannot ambush a later visit. */
export const LOCATED_WRITE_TTL_MS = 30_000

/** Held writes beyond this drop the oldest, so a session that never locates cannot grow the queue without bound. */
export const LOCATED_WRITE_MAX_QUEUE = 256

export type HeldLocatedWrite = { readonly id: number; readonly key: string; readonly run: () => void }

/**
 * Layout writes held until their session's location is known, by session key. A session's writes run in call order:
 * while any of its writes is held or `draining`, a new write for it joins the end of the queue, even once it is located.
 */
export type LocatedWritesState =
  | {
      readonly status: "active"
      readonly nextId: number
      /** Session keys whose held writes are running now, one at a time. */
      readonly draining: readonly string[]
      readonly queue: readonly HeldLocatedWrite[]
    }
  /** The owner went away: held writes are dropped and new ones never run. */
  | { readonly status: "disposed" }

export type LocatedWritesEvent =
  | { readonly type: "write"; readonly key: string; readonly located: boolean; readonly run: () => void }
  /** The session's location became known. */
  | { readonly type: "drain.start"; readonly key: string }
  /** Runs the session's next held write, or ends its drain. */
  | { readonly type: "drain.next"; readonly key: string }
  | { readonly type: "expire"; readonly id: number }
  | { readonly type: "disposed" }

export type LocatedWritesEffect =
  | { readonly type: "run"; readonly run: () => void }
  | { readonly type: "drain"; readonly key: string }
  | { readonly type: "schedule.expire"; readonly id: number; readonly timeoutMs: number }
  | { readonly type: "cancel.expire"; readonly ids: readonly number[] }

export type LocatedWritesTransition = {
  readonly state: LocatedWritesState
  readonly effects: readonly LocatedWritesEffect[]
}

export function createLocatedWritesState(): LocatedWritesState {
  return { status: "active", nextId: 0, draining: [], queue: [] }
}

export function transitionLocatedWrites(state: LocatedWritesState, event: LocatedWritesEvent): LocatedWritesTransition {
  if (state.status === "disposed") return step(state)

  if (event.type === "disposed")
    return step(
      { status: "disposed" },
      state.queue.length > 0 ? [{ type: "cancel.expire", ids: state.queue.map((item) => item.id) }] : [],
    )

  if (event.type === "write") {
    const draining = state.draining.includes(event.key)
    const held = state.queue.some((item) => item.key === event.key)

    if (event.located && !draining && !held) return step(state, [{ type: "run", run: event.run }])
    const id = state.nextId + 1
    const overflow = state.queue.length >= LOCATED_WRITE_MAX_QUEUE ? state.queue.slice(0, 1) : []
    const queue = [...state.queue.slice(overflow.length), { id, key: event.key, run: event.run }]

    const evicted: LocatedWritesEffect[] =
      overflow.length > 0 ? [{ type: "cancel.expire", ids: overflow.map((item) => item.id) }] : []

    if (!event.located)
      return step({ ...state, nextId: id, queue }, [
        ...evicted,
        { type: "schedule.expire", id, timeoutMs: LOCATED_WRITE_TTL_MS },
      ])

    if (draining) return step({ ...state, nextId: id, queue }, evicted)

    // Located before the location watcher ran: the writes held before it run first, in order.
    return step({ ...state, nextId: id, queue, draining: [...state.draining, event.key] }, [
      ...evicted,
      { type: "drain", key: event.key },
    ])
  }

  if (event.type === "drain.start") {
    if (state.draining.includes(event.key) || !state.queue.some((item) => item.key === event.key)) return step(state)

    return step({ ...state, draining: [...state.draining, event.key] }, [{ type: "drain", key: event.key }])
  }

  if (event.type === "drain.next") {
    if (!state.draining.includes(event.key)) return step(state)
    const head = state.queue.find((item) => item.key === event.key)

    if (!head) return step({ ...state, draining: state.draining.filter((key) => key !== event.key) })

    return step({ ...state, queue: state.queue.filter((item) => item !== head) }, [
      { type: "cancel.expire", ids: [head.id] },
      { type: "run", run: head.run },
    ])
  }

  if (!state.queue.some((item) => item.id === event.id)) return step(state)

  return step({ ...state, queue: state.queue.filter((item) => item.id !== event.id) })
}

/** Whether a write for `key` would wait behind earlier ones. */
export function selectLocatedSessionBusy(state: LocatedWritesState, key: string) {
  return state.status === "active" && (state.draining.includes(key) || state.queue.some((item) => item.key === key))
}

export function selectLocatedDraining(state: LocatedWritesState, key: string) {
  return state.status === "active" && state.draining.includes(key)
}

/** Session keys with held writes that wait for a location, in first-held order. */
export function selectLocatedWaitingKeys(state: LocatedWritesState): readonly string[] {
  if (state.status === "disposed") return []

  return Array.from(new Set(state.queue.flatMap((item) => (state.draining.includes(item.key) ? [] : [item.key]))))
}

function step(state: LocatedWritesState, effects: readonly LocatedWritesEffect[] = []): LocatedWritesTransition {
  return { state, effects }
}
