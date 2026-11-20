import type { ConfigEntry } from "@opencode/client"
import type { TreeRefreshTarget } from "./tree-model"

/** The workspace a refresh action reads. Targets never carry over to another. */
export type TreeRefreshScope = { readonly serverID: string; readonly root: string }

type TreeRefreshRunningState = Extract<TreeRefreshState, { status: "running" }>

/** The transition `startTargets` always produces: its state is running by construction. */
type TreeRefreshRunningTransition = { state: TreeRefreshRunningState; effects: readonly TreeRefreshEffect[] }

export type TreeRefreshState =
  | { readonly status: "idle"; readonly attempt: number }
  /** The click's targets are captured and the action's config is being read; duplicate clicks do nothing. */
  | { readonly status: "starting"; readonly attempt: number; readonly scope: TreeRefreshScope; readonly targets: readonly TreeRefreshTarget[] }
  | {
      readonly status: "running"
      readonly attempt: number
      readonly scope: TreeRefreshScope
      /** How many syncs may run at once, read from the config when the action started. */
      readonly concurrency: number
      /** Targets whose sync has not started yet, in capture order. */
      readonly pending: readonly TreeRefreshTarget[]
      /** Started syncs still in flight, by the target's normalized dir. */
      readonly active: ReadonlySet<string>
      /** Rejected sync messages, reported once when the action settles. */
      readonly errors: readonly string[]
    }
  | { readonly status: "disposed"; readonly attempt: number }

export type TreeRefreshEvent =
  | {
      readonly type: "started"
      readonly scope: TreeRefreshScope
      readonly targets: readonly TreeRefreshTarget[]
    }
  | { readonly type: "config.settled"; readonly attempt: number; readonly concurrency: number }
  | { readonly type: "config.failed"; readonly attempt: number; readonly error: string }
  | { readonly type: "sync.settled"; readonly attempt: number; readonly dir: string; readonly error?: string }
  | { readonly type: "sync.skipped"; readonly attempt: number; readonly dir: string }
  | { readonly type: "scope.changed" }
  | { readonly type: "disposed" }

export type TreeRefreshEffect =
  | { readonly type: "sync"; readonly attempt: number; readonly target: TreeRefreshTarget }
  | { readonly type: "report"; readonly attempt: number; readonly errors: readonly string[] }

export type TreeRefreshTransition = {
  readonly state: TreeRefreshState
  readonly effects: readonly TreeRefreshEffect[]
}

export const INITIAL_TREE_REFRESH_STATE: TreeRefreshState = { status: "idle", attempt: 0 }

/** The action's sync count when no configuration file names one. */
export const DEFAULT_TREE_REFRESH_CONCURRENCY = 4

/**
 * The refresh concurrency the server's config entries name: the last config document that names one wins, and a
 * directory root names none. 4 when none does.
 */
export function treeRefreshConcurrency(entries: readonly ConfigEntry[]) {
  let concurrency = DEFAULT_TREE_REFRESH_CONCURRENCY

  for (const entry of entries) {
    if (entry.type !== "document") continue

    const value = entry.info.file_tree?.refresh_concurrency

    if (value !== undefined) concurrency = value
  }

  return concurrency
}

/** Whether the refresh button is busy: a click would be a no-op duplicate. */
export function isTreeRefreshPending(state: TreeRefreshState) {
  return state.status === "starting" || state.status === "running"
}

const NONE: readonly TreeRefreshEffect[] = []

export function transitionTreeRefresh(state: TreeRefreshState, event: TreeRefreshEvent): TreeRefreshTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed") return { state: { status: "disposed", attempt: state.attempt }, effects: NONE }

  if (event.type === "scope.changed") {
    // The in-flight syncs are not cancellable; their settles no longer match the action's attempt, and neither the
    // dropped targets nor the dropped errors notify anyone.
    return { state: { status: "idle", attempt: state.attempt }, effects: NONE }
  }

  if (event.type === "started")
    // One action at a time: a click while the previous one runs is a no-op.
    return state.status === "idle"
      ? {
          state: {
            status: "starting",
            attempt: state.attempt + 1,
            scope: event.scope,
            targets: event.targets,
          },
          effects: NONE,
        }
      : { state, effects: NONE }

  if (state.status === "starting") {
    if (event.attempt !== state.attempt) return { state, effects: NONE }

    if (event.type === "config.failed")
      return {
        state: { status: "idle", attempt: state.attempt },
        effects: [{ type: "report", attempt: state.attempt, errors: [event.error] }],
      }

    if (event.type !== "config.settled") return { state, effects: NONE }

    return startTargets(state.attempt, state.scope, event.concurrency, state.targets, new Set(), [])
  }

  if (state.status !== "running" || event.attempt !== state.attempt) return { state, effects: NONE }

  if (event.type !== "sync.settled" && event.type !== "sync.skipped") return { state, effects: NONE }

  if (!state.active.has(event.dir)) return { state, effects: NONE }

  const active = new Set(state.active)
  active.delete(event.dir)

  const errors =
    event.type === "sync.settled" && event.error !== undefined ? [...state.errors, event.error] : state.errors

  // A settled sync schedules at most one next target; the action ends when nothing is pending or in flight.
  const next = startTargets(state.attempt, state.scope, state.concurrency, state.pending, active, errors)

  if (next.state.pending.length === 0 && next.state.active.size === 0)
    return {
      state: { status: "idle", attempt: state.attempt },
      effects:
        next.state.errors.length > 0
          ? [{ type: "report", attempt: state.attempt, errors: next.state.errors }]
          : NONE,
    }

  return next
}

/**
 * Starts syncs for as many pending targets as the action's free slots hold, keeping the rest pending. The driver may
 * skip a pruned target with `sync.skipped`, which settles it and schedules the next one.
 */
function startTargets(
  attempt: number,
  scope: TreeRefreshScope,
  concurrency: number,
  pending: readonly TreeRefreshTarget[],
  active: ReadonlySet<string>,
  errors: readonly string[],
): TreeRefreshRunningTransition {
  const slots = Math.max(concurrency - active.size, 0)
  const begin = pending.slice(0, slots)
  const rest = pending.slice(slots)

  const nextActive = new Set(active)

  for (const target of begin) nextActive.add(target.dir)

  return {
    state: { status: "running", attempt, scope, concurrency, pending: rest, active: nextActive, errors },
    effects: begin.map((target) => ({ type: "sync", attempt, target })),
  } satisfies TreeRefreshRunningTransition
}
