// Branch lookups each run git on the server, so load them a few at a time.
export const BRANCH_BATCH = 4

// A lookup that never settles frees its slot after this long, so one hung server cannot stall the rest.
export const BRANCH_LOAD_TIMEOUT_MS = 15_000

export const BRANCH_RETRY_DELAY_MS = 1_000

export const BRANCH_RETRY_MAX_DELAY_MS = 4_000

// Retries after the first failed lookup, before the location rests as failed until its server reconnects.
export const BRANCH_RETRY_LIMIT = 2

export type InboxBranchTarget = {
  readonly key: string
  readonly server: string
}

/**
 * One location's git branch load. `initial` is true until the first attempt settles, so only that attempt shows a
 * loader. `failures` counts failed attempts since the location was enqueued or its server reconnected.
 * - `queued`: waiting in `queue` for one of the `BRANCH_BATCH` slots.
 * - `loading`: holding a slot with `attempt` in flight.
 * - `retrying`: waiting off-queue for backoff `attempt`, holding no slot.
 * - `ok`: loaded; live updates arrive through `vcs.branch.updated`.
 * - `failed`: retries exhausted; rests until `server` reconnects.
 */
export type InboxBranchEntry =
  | { readonly phase: "queued"; readonly server: string; readonly initial: boolean; readonly failures: number }
  | {
      readonly phase: "loading"
      readonly server: string
      readonly attempt: number
      readonly initial: boolean
      readonly failures: number
    }
  | { readonly phase: "retrying"; readonly server: string; readonly attempt: number; readonly failures: number }
  | { readonly phase: "ok"; readonly server: string }
  | { readonly phase: "failed"; readonly server: string }

export type InboxBranchState =
  | {
      readonly status: "active"
      readonly issued: number
      readonly connected: ReadonlySet<string>
      readonly queue: readonly string[]
      readonly entries: Readonly<Record<string, InboxBranchEntry>>
    }
  | { readonly status: "disposed" }

export type InboxBranchEvent =
  | { readonly type: "enqueue"; readonly targets: readonly InboxBranchTarget[] }
  | { readonly type: "load.succeeded"; readonly key: string; readonly attempt: number }
  | { readonly type: "load.failed"; readonly key: string; readonly attempt: number }
  | { readonly type: "load.timed-out"; readonly key: string; readonly attempt: number }
  | { readonly type: "retry.due"; readonly key: string; readonly attempt: number }
  | { readonly type: "connections.changed"; readonly connected: readonly string[] }
  | { readonly type: "disposed" }

export type InboxBranchEffect =
  | { readonly type: "load.start"; readonly key: string; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "retry.schedule"; readonly key: string; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "timer.clear"; readonly attempt: number }
  | { readonly type: "timers.clear" }

export type InboxBranchTransition = {
  readonly state: InboxBranchState
  readonly effects: readonly InboxBranchEffect[]
}

type ActiveState = Extract<InboxBranchState, { status: "active" }>

const NONE: readonly InboxBranchEffect[] = Object.freeze([])

export const INITIAL_INBOX_BRANCH_STATE: InboxBranchState = Object.freeze({
  status: "active",
  issued: 0,
  connected: new Set<string>(),
  queue: Object.freeze([]),
  entries: Object.freeze({}),
})

const DISPOSED_INBOX_BRANCH_STATE: InboxBranchState = Object.freeze({ status: "disposed" })

export function branchRetryDelay(failures: number) {
  return Math.min(BRANCH_RETRY_DELAY_MS * 2 ** (failures - 1), BRANCH_RETRY_MAX_DELAY_MS)
}

export function transitionInboxBranch(state: InboxBranchState, event: InboxBranchEvent): InboxBranchTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed") return { state: DISPOSED_INBOX_BRANCH_STATE, effects: [{ type: "timers.clear" }] }

  if (event.type === "enqueue") {
    const added = [
      ...new Map(
        event.targets.filter((target) => !state.entries[target.key]).map((target) => [target.key, target] as const),
      ).values(),
    ]

    if (added.length === 0) return { state, effects: NONE }

    return pump(
      {
        ...state,
        queue: [...state.queue, ...added.map((target) => target.key)],
        entries: {
          ...state.entries,
          ...Object.fromEntries(
            added.map((target) => [
              target.key,
              { phase: "queued", server: target.server, initial: true, failures: 0 } satisfies InboxBranchEntry,
            ]),
          ),
        },
      },
      NONE,
    )
  }

  if (event.type === "connections.changed") return reconnect(state, new Set(event.connected))

  if (event.type === "retry.due") {
    const entry = state.entries[event.key]

    if (entry?.phase !== "retrying" || entry.attempt !== event.attempt) return { state, effects: NONE }

    return pump(
      {
        ...state,
        queue: [...state.queue, event.key],
        entries: {
          ...state.entries,
          [event.key]: { phase: "queued", server: entry.server, initial: false, failures: entry.failures },
        },
      },
      NONE,
    )
  }

  const entry = state.entries[event.key]

  if (entry?.phase !== "loading" || entry.attempt !== event.attempt) return { state, effects: NONE }

  // A timeout fires from the attempt's own timer, so only the other results clear it.
  const cleared: readonly InboxBranchEffect[] =
    event.type === "load.timed-out" ? NONE : [{ type: "timer.clear", attempt: entry.attempt }]

  if (event.type === "load.succeeded") {
    return pump(
      { ...state, entries: { ...state.entries, [event.key]: { phase: "ok", server: entry.server } } },
      cleared,
    )
  }

  if (entry.failures >= BRANCH_RETRY_LIMIT) {
    return pump(
      { ...state, entries: { ...state.entries, [event.key]: { phase: "failed", server: entry.server } } },
      cleared,
    )
  }

  const failures = entry.failures + 1
  const attempt = state.issued + 1

  return pump(
    {
      ...state,
      issued: attempt,
      entries: { ...state.entries, [event.key]: { phase: "retrying", server: entry.server, attempt, failures } },
    },
    [...cleared, { type: "retry.schedule", key: event.key, attempt, delayMs: branchRetryDelay(failures) }],
  )
}

/** True while a location's first lookup has not settled. Background retries do not show a loader. */
export function selectBranchLoading(state: InboxBranchState, key: string) {
  if (state.status === "disposed") return false
  const entry = state.entries[key]

  if (!entry) return true

  return (entry.phase === "queued" || entry.phase === "loading") && entry.initial
}

// A server that connects again wakes its failed and backing-off locations with a fresh retry budget.
function reconnect(state: ActiveState, connected: ReadonlySet<string>): InboxBranchTransition {
  if (connected.size === state.connected.size && [...connected].every((server) => state.connected.has(server))) {
    return { state, effects: NONE }
  }

  const woken = Object.entries(state.entries).filter(
    ([, entry]) =>
      (entry.phase === "failed" || entry.phase === "retrying") &&
      connected.has(entry.server) &&
      !state.connected.has(entry.server),
  )

  if (woken.length === 0) return { state: { ...state, connected }, effects: NONE }

  return pump(
    {
      ...state,
      connected,
      queue: [...state.queue, ...woken.map(([key]) => key)],
      entries: {
        ...state.entries,
        ...Object.fromEntries(
          woken.map(([key, entry]) => [
            key,
            { phase: "queued", server: entry.server, initial: false, failures: 0 } satisfies InboxBranchEntry,
          ]),
        ),
      },
    },
    woken.flatMap(([, entry]) =>
      entry.phase === "retrying" ? [{ type: "timer.clear", attempt: entry.attempt } satisfies InboxBranchEffect] : [],
    ),
  )
}

// Fill free slots from the head of the queue, so each settled lookup starts the next one.
function pump(state: ActiveState, prior: readonly InboxBranchEffect[]): InboxBranchTransition {
  const slots = BRANCH_BATCH - Object.values(state.entries).filter((entry) => entry.phase === "loading").length

  if (slots <= 0 || state.queue.length === 0) return { state, effects: prior }

  const starting = state.queue.slice(0, slots).flatMap((key, index) => {
    const entry = state.entries[key]

    return entry?.phase === "queued" ? [{ key, entry, attempt: state.issued + index + 1 }] : []
  })

  return {
    state: {
      ...state,
      issued: state.issued + Math.min(slots, state.queue.length),
      queue: state.queue.slice(slots),
      entries: {
        ...state.entries,
        ...Object.fromEntries(
          starting.map((item) => [
            item.key,
            {
              phase: "loading",
              server: item.entry.server,
              attempt: item.attempt,
              initial: item.entry.initial,
              failures: item.entry.failures,
            } satisfies InboxBranchEntry,
          ]),
        ),
      },
    },
    effects: [
      ...prior,
      ...starting.map((item): InboxBranchEffect => ({
        type: "load.start",
        key: item.key,
        attempt: item.attempt,
        timeoutMs: BRANCH_LOAD_TIMEOUT_MS,
      })),
    ],
  }
}
