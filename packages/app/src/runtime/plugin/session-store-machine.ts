/** Stores of sessions no tab has listed beyond this close, oldest first, so preloads without a tab stay bounded. */
export const SESSION_STORE_MAX_UNLISTED = 16

export type SessionStoreEntry<E> = {
  /**
   * `unlisted` until a tab lists the session: a deep link or a new session routes and preloads before the titlebar
   * adds its tab. Only a `listed` store closes with its tab.
   */
  readonly retention: "unlisted" | "listed"
  /** When the store opened, which picks the oldest unlisted store to close. */
  readonly order: number
  readonly value: E
}

/** The open stores of one declared session store, by session key. */
export type SessionStoreState<E> =
  | {
      readonly status: "active"
      readonly issued: number
      readonly entries: Readonly<Record<string, SessionStoreEntry<E>>>
    }
  | { readonly status: "disposed" }

export type SessionStoreEvent<E> =
  /** A store opened for a session that had none; `listed`: a tab lists the session already. */
  | {
      readonly type: "opened"
      readonly key: string
      readonly value: E
      readonly listed: boolean
      readonly routed: string | undefined
    }
  /** The sessions open tabs list, and the routed one. */
  | { readonly type: "sync"; readonly listed: ReadonlySet<string>; readonly routed: string | undefined }
  | { readonly type: "disposed" }

export type SessionStoreEffect<E> = { readonly type: "dispose"; readonly value: E }

export type SessionStoreTransition<E> = {
  readonly state: SessionStoreState<E>
  readonly effects: readonly SessionStoreEffect<E>[]
}

export function createSessionStoreState<E>(): SessionStoreState<E> {
  return { status: "active", issued: 0, entries: {} }
}

export function transitionSessionStore<E>(
  state: SessionStoreState<E>,
  event: SessionStoreEvent<E>,
): SessionStoreTransition<E> {
  if (state.status === "disposed") {
    if (event.type === "opened") return step(state, [dispose(event.value)])

    return step(state)
  }

  if (event.type === "disposed")
    return step(
      { status: "disposed" },
      Object.values(state.entries).map((entry) => dispose(entry.value)),
    )

  if (event.type === "opened") {
    if (state.entries[event.key]) return step(state, [dispose(event.value)])

    const issued = state.issued + 1

    const entry: SessionStoreEntry<E> = {
      retention: event.listed ? "listed" : "unlisted",
      order: issued,
      value: event.value,
    }

    return bounded({ status: "active", issued, entries: { ...state.entries, [event.key]: entry } }, event.routed, [])
  }

  const listed = event.listed
  const all = Object.entries(state.entries)
  // A listed store closes once its tab has: the routed session keeps its store until the route leaves it.
  const closed = all.filter(([key, entry]) => entry.retention === "listed" && !listed.has(key) && key !== event.routed)
  const changed = closed.length > 0 || all.some(([key, entry]) => entry.retention === "unlisted" && listed.has(key))

  if (!changed) return bounded(state, event.routed, [])

  const entries = Object.fromEntries(
    all.flatMap(([key, entry]) => {
      if (closed.some((item) => item[0] === key)) return []

      return [[key, listed.has(key) ? { ...entry, retention: "listed" as const } : entry] as const]
    }),
  )

  return bounded(
    { ...state, entries },
    event.routed,
    closed.map(([, entry]) => dispose(entry.value)),
  )
}

/** The value of a session's open store. */
export function selectSessionStoreEntry<E>(state: SessionStoreState<E>, key: string) {
  return state.status === "active" ? state.entries[key]?.value : undefined
}

/** Closes the oldest unlisted stores past the cap; the routed session keeps its store. */
function bounded<E>(
  state: Extract<SessionStoreState<E>, { status: "active" }>,
  routed: string | undefined,
  effects: readonly SessionStoreEffect<E>[],
): SessionStoreTransition<E> {
  const unlisted = Object.entries(state.entries)
    .filter(([key, entry]) => entry.retention === "unlisted" && key !== routed)
    .sort((a, b) => a[1].order - b[1].order)

  const evicted = unlisted.slice(0, Math.max(0, unlisted.length - SESSION_STORE_MAX_UNLISTED))

  if (evicted.length === 0) return step(state, effects)

  return step(
    {
      ...state,
      entries: Object.fromEntries(
        Object.entries(state.entries).filter(([key]) => !evicted.some((item) => item[0] === key)),
      ),
    },
    [...effects, ...evicted.map(([, entry]) => dispose(entry.value))],
  )
}

function dispose<E>(value: E): SessionStoreEffect<E> {
  return { type: "dispose", value }
}

function step<E>(
  state: SessionStoreState<E>,
  effects: readonly SessionStoreEffect<E>[] = [],
): SessionStoreTransition<E> {
  return { state, effects }
}
