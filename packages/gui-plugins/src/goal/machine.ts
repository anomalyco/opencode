import type { Goal } from "@opencode/schema/goal"

/** How long `get` may take before the snapshot counts as failed. */
export const GOAL_SNAPSHOT_TIMEOUT_MS = 15_000

/** How long a pause, resume or clear may take before its button frees up again. */
export const GOAL_COMMAND_TIMEOUT_MS = 15_000

// Waits before the 1st, 2nd and 3rd refetch of a snapshot that failed; then the session shows no goal.
const RETRY_DELAYS = [1_000, 2_000, 4_000]

export type GoalAction = "pause" | "resume" | "clear"

/**
 * What the window knows of one session's goal, keyed by `session.key`. Only the routed session is fetched; another
 * session keeps the goal it last showed (`stale`), hidden, so switching back shows it while the refetch runs.
 */
export type GoalEntry =
  /** Fetching the snapshot. `cached` is the goal the session showed before, shown until the answer lands. */
  | {
      readonly status: "loading"
      readonly attempt: number
      readonly retries: number
      readonly cached: Goal.State | undefined
    }
  /** The last fetch failed; refetches when the timer of `attempt` fires. Shows no goal. */
  | { readonly status: "retrying"; readonly attempt: number; readonly retries: number }
  /** The snapshot or a later change: authoritative while subscribed. */
  | { readonly status: "live"; readonly goal: Goal.State | null }
  /** Not routed, or its server disconnected: kept to show while revalidating, never shown alone. */
  | { readonly status: "stale"; readonly goal: Goal.State }
  /**
   * Every fetch failed, as on a server without the goal plugin, or one whose plugin is still starting. The
   * subscription stays, so a change still brings it live.
   */
  | { readonly status: "failed" }

/** The routed, connected session: its change subscription is `subscription`. */
export type GoalTarget = {
  readonly subscription: number
  readonly key: string
  readonly serverID: string
  readonly sessionID: string
  readonly directory: string
}

export type GoalState =
  | {
      readonly status: "active"
      readonly issued: number
      readonly target: GoalTarget | undefined
      readonly sessions: ReadonlyMap<string, GoalEntry>
      /** The one pause, resume or clear in flight per session. */
      readonly commands: ReadonlyMap<string, { readonly attempt: number; readonly action: GoalAction }>
    }
  | { readonly status: "disposed" }

export type GoalEvent =
  | {
      readonly type: "target.attached"
      readonly key: string
      readonly serverID: string
      readonly sessionID: string
      readonly directory: string
    }
  | { readonly type: "target.detached" }
  /** A `changed` event from subscription `subscription`, for the session `key` on the same server. */
  | { readonly type: "changed"; readonly subscription: number; readonly key: string; readonly goal: Goal.State | null }
  | { readonly type: "snapshot.loaded"; readonly attempt: number; readonly goal: Goal.State | null }
  /** `get` rejected, or hung past `GOAL_SNAPSHOT_TIMEOUT_MS`. */
  | { readonly type: "snapshot.failed"; readonly attempt: number }
  | { readonly type: "retry.due"; readonly attempt: number }
  | {
      readonly type: "command.requested"
      readonly key: string
      readonly serverID: string
      readonly sessionID: string
      readonly action: GoalAction
    }
  | { readonly type: "command.succeeded"; readonly key: string; readonly attempt: number }
  /** `message` is the server's error; undefined when the command timed out. */
  | { readonly type: "command.failed"; readonly key: string; readonly attempt: number; readonly message?: string }
  /** The sessions of open shell tabs, plus the routed one; the rest are forgotten. */
  | { readonly type: "sessions.pruned"; readonly keep: ReadonlySet<string> }
  | { readonly type: "disposed" }

export type GoalEffect =
  | { readonly type: "subscribe"; readonly subscription: number; readonly serverID: string }
  | { readonly type: "unsubscribe"; readonly subscription: number }
  | {
      readonly type: "fetch"
      readonly attempt: number
      readonly serverID: string
      readonly sessionID: string
      readonly directory: string
    }
  | { readonly type: "schedule-retry"; readonly attempt: number; readonly delay: number }
  | {
      readonly type: "command"
      readonly attempt: number
      readonly key: string
      readonly serverID: string
      readonly sessionID: string
      readonly action: GoalAction
    }
  /** Stops a fetch, retry timer or command of `attempt`; its result, if any, is ignored. */
  | { readonly type: "cancel"; readonly attempt: number }
  | { readonly type: "toast-error"; readonly message?: string }

export type GoalTransition = { readonly state: GoalState; readonly effects: readonly GoalEffect[] }

type Active = Extract<GoalState, { status: "active" }>

type ActiveTransition = { readonly state: Active; readonly effects: readonly GoalEffect[] }

export function createGoalState(): GoalState {
  return { status: "active", issued: 0, target: undefined, sessions: new Map(), commands: new Map() }
}

export function transitionGoal(state: GoalState, event: GoalEvent): GoalTransition {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed") {
    return {
      state: { status: "disposed" },
      effects: [
        ...leave(state).effects,
        ...[...state.commands.values()].map((command): GoalEffect => ({ type: "cancel", attempt: command.attempt })),
      ],
    }
  }

  if (event.type === "target.attached") return attach(state, event)

  if (event.type === "target.detached") {
    if (!state.target) return { state, effects: [] }

    return leave(state)
  }

  if (event.type === "changed") return changed(state, event.subscription, event.key, event.goal)

  if (event.type === "snapshot.loaded") {
    const entry = loading(state, event.attempt)

    if (!entry) return { state, effects: [] }

    return { state: put(state, entry.key, { status: "live", goal: event.goal }), effects: [] }
  }

  if (event.type === "snapshot.failed") return snapshotFailed(state, event.attempt)

  if (event.type === "retry.due") {
    const target = state.target
    const entry = target ? state.sessions.get(target.key) : undefined

    if (!target || entry?.status !== "retrying" || entry.attempt !== event.attempt) return { state, effects: [] }

    return {
      state: put(state, target.key, {
        status: "loading",
        attempt: entry.attempt,
        retries: entry.retries,
        cached: undefined,
      }),
      effects: [fetch(entry.attempt, target)],
    }
  }

  if (event.type === "command.requested") {
    // A second click while the first is in flight would fail on the server ("No active goal to pause.").
    if (state.commands.has(event.key)) return { state, effects: [] }
    const attempt = state.issued + 1

    return {
      state: {
        ...state,
        issued: attempt,
        commands: new Map(state.commands).set(event.key, { attempt, action: event.action }),
      },
      effects: [
        {
          type: "command",
          attempt,
          key: event.key,
          serverID: event.serverID,
          sessionID: event.sessionID,
          action: event.action,
        },
      ],
    }
  }

  if (event.type === "command.succeeded" || event.type === "command.failed") {
    if (state.commands.get(event.key)?.attempt !== event.attempt) return { state, effects: [] }
    const commands = new Map(state.commands)
    commands.delete(event.key)

    return {
      state: { ...state, commands },
      effects: event.type === "command.failed" ? [{ type: "toast-error", message: event.message }] : [],
    }
  }

  return prune(state, event.keep)
}

/** The goal the composer pill shows for a session: only a live answer, or the cached one while it revalidates. */
export function selectGoal(state: GoalState, key: string) {
  if (state.status !== "active") return
  const entry = state.sessions.get(key)

  return entry ? shown(entry) : undefined
}

/** Whether a pause, resume or clear for the session is in flight; its buttons wait meanwhile. */
export function selectGoalBusy(state: GoalState, key: string) {
  return state.status === "active" && state.commands.has(key)
}

function attach(state: Active, event: Extract<GoalEvent, { type: "target.attached" }>): GoalTransition {
  if (state.target?.key === event.key && state.target.directory === event.directory) return { state, effects: [] }
  const left = leave(state)
  const previous = left.state.sessions.get(event.key)
  const subscription = left.state.issued + 1
  const attempt = subscription + 1

  const target = {
    subscription,
    key: event.key,
    serverID: event.serverID,
    sessionID: event.sessionID,
    directory: event.directory,
  }

  const entry: GoalEntry = {
    status: "loading",
    attempt,
    retries: 0,
    cached: previous?.status === "stale" ? previous.goal : undefined,
  }

  return {
    state: { ...put(left.state, event.key, entry), issued: attempt, target },
    effects: [...left.effects, { type: "subscribe", subscription, serverID: event.serverID }, fetch(attempt, target)],
  }
}

// Leaving the routed session closes its subscription and keeps only a goal it showed, as `stale`.
function leave(state: Active): ActiveTransition {
  const target = state.target

  if (!target) return { state, effects: [] }
  const entry = state.sessions.get(target.key)
  const sessions = new Map(state.sessions)
  const goal = entry ? shown(entry) : undefined

  if (goal) sessions.set(target.key, { status: "stale", goal })

  if (!goal) sessions.delete(target.key)

  return {
    state: { ...state, target: undefined, sessions },
    effects: [
      { type: "unsubscribe", subscription: target.subscription },
      ...(entry?.status === "loading" || entry?.status === "retrying"
        ? [{ type: "cancel" as const, attempt: entry.attempt }]
        : []),
    ],
  }
}

// A change is newer than any snapshot in flight. Another session's change updates only a goal this window showed.
function changed(state: Active, subscription: number, key: string, goal: Goal.State | null): GoalTransition {
  if (state.target?.subscription !== subscription) return { state, effects: [] }
  const entry = state.sessions.get(key)

  if (key === state.target.key) {
    return {
      state: put(state, key, { status: "live", goal }),
      effects:
        entry?.status === "loading" || entry?.status === "retrying" ? [{ type: "cancel", attempt: entry.attempt }] : [],
    }
  }

  if (!entry) return { state, effects: [] }

  if (!goal) return { state: drop(state, key), effects: [] }

  return { state: put(state, key, { status: "stale", goal }), effects: [] }
}

// A failed refetch drops the cached goal at once: it can no longer be trusted as current.
function snapshotFailed(state: Active, attempt: number): GoalTransition {
  const entry = loading(state, attempt)

  if (!entry) return { state, effects: [] }
  const delay = RETRY_DELAYS[entry.retries]

  if (delay === undefined) return { state: put(state, entry.key, { status: "failed" }), effects: [] }
  const next = state.issued + 1

  return {
    state: {
      ...put(state, entry.key, { status: "retrying", attempt: next, retries: entry.retries + 1 }),
      issued: next,
    },
    effects: [{ type: "schedule-retry", attempt: next, delay }],
  }
}

function prune(state: Active, keep: ReadonlySet<string>): GoalTransition {
  const kept = (key: string) => keep.has(key) || key === state.target?.key
  const dropped = [...state.commands].filter(([key]) => !kept(key))

  if (dropped.length === 0 && [...state.sessions.keys()].every(kept)) return { state, effects: [] }

  return {
    state: {
      ...state,
      sessions: new Map([...state.sessions].filter(([key]) => kept(key))),
      commands: new Map([...state.commands].filter(([key]) => kept(key))),
    },
    effects: dropped.map(([, command]) => ({ type: "cancel", attempt: command.attempt })),
  }
}

// The routed session's entry while its snapshot `attempt` is in flight.
function loading(state: Active, attempt: number) {
  const key = state.target?.key
  const entry = key ? state.sessions.get(key) : undefined

  if (!key || entry?.status !== "loading" || entry.attempt !== attempt) return

  return { key, retries: entry.retries }
}

function fetch(attempt: number, target: GoalTarget): GoalEffect {
  return {
    type: "fetch",
    attempt,
    serverID: target.serverID,
    sessionID: target.sessionID,
    directory: target.directory,
  }
}

// The goal an entry puts on screen: a live answer, or the cached one while its refetch runs.
function shown(entry: GoalEntry) {
  if (entry.status === "live") return entry.goal ?? undefined

  if (entry.status === "loading") return entry.cached
}

function put(state: Active, key: string, entry: GoalEntry): Active {
  return { ...state, sessions: new Map(state.sessions).set(key, entry) }
}

function drop(state: Active, key: string): Active {
  const sessions = new Map(state.sessions)
  sessions.delete(key)

  return { ...state, sessions }
}
