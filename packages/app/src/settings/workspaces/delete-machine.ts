import type { WorkspaceDeleteInspection } from "@/workspaces/paths"

/** How long a deleted row takes to collapse before it leaves the list. */
export const WORKSPACE_COLLAPSE_MS = 150

/** How long one worktree's check and removal may run before the list moves on. */
export const WORKSPACE_DELETE_TIMEOUT_MS = 60_000

export type WorkspaceTarget = {
  readonly key: string
  readonly directory: string
  readonly projectID: string
  readonly projectWorktree: string
}

/** Which confirmation asked: one worktree (deleted with force after its own check), all of them, or the unused ones. */
export type WorkspaceDeleteScope = "one" | "all" | "unused"

export type WorkspaceSkipReason =
  | { readonly kind: "blocked"; readonly inspection: WorkspaceDeleteInspection }
  | { readonly kind: "failed"; readonly message: string | undefined }
  | { readonly kind: "timed-out" }

type Run = {
  readonly issued: number
  readonly attempt: number
  readonly force: boolean
  /** The directory the settings were opened from, which a bulk delete keeps. */
  readonly active: string | undefined
  readonly current: WorkspaceTarget
  readonly queue: readonly WorkspaceTarget[]
  readonly removed: Readonly<Record<string, true>>
}

/**
 * Deleting worktrees from Settings › Worktrees. One confirmation or one sequential batch at a time. `removed` holds
 * rows that finished collapsing until the inventory drops them, so they never reappear in between. Attempts come from
 * `issued`: a confirmation and each worktree's removal take one, and a result whose attempt the state no longer holds
 * is stale.
 */
export type WorkspaceDeleteState =
  | { readonly status: "idle"; readonly issued: number; readonly removed: Readonly<Record<string, true>> }
  | {
      readonly status: "confirming"
      readonly issued: number
      readonly attempt: number
      readonly scope: WorkspaceDeleteScope
      readonly active: string | undefined
      readonly targets: readonly WorkspaceTarget[]
      readonly removed: Readonly<Record<string, true>>
    }
  | ({ readonly status: "deleting" } & Run)
  | ({ readonly status: "collapsing" } & Run)
  | { readonly status: "disposed" }

export type WorkspaceDeleteEvent =
  | {
      readonly type: "confirm.opened"
      readonly scope: WorkspaceDeleteScope
      readonly active: string | undefined
      readonly targets: readonly WorkspaceTarget[]
    }
  /** The confirmation closed. Its dialog reports this after its exit animation, possibly after another one opened. */
  | { readonly type: "confirm.cancelled"; readonly attempt: number }
  | { readonly type: "confirm.accepted"; readonly attempt: number }
  | { readonly type: "delete.succeeded"; readonly attempt: number; readonly target: WorkspaceTarget }
  | { readonly type: "delete.skipped"; readonly attempt: number; readonly reason: WorkspaceSkipReason }
  | { readonly type: "delete.timed-out"; readonly attempt: number }
  | { readonly type: "collapse.completed"; readonly attempt: number }
  /** The worktree keys the inventory lists now. */
  | { readonly type: "inventory.synced"; readonly keys: readonly string[] }
  | { readonly type: "disposed" }

export type WorkspaceDeleteEffect =
  | {
      readonly type: "open.confirm"
      readonly attempt: number
      readonly scope: WorkspaceDeleteScope
      readonly active: string | undefined
      readonly targets: readonly WorkspaceTarget[]
    }
  /** Starts the attempt's timeout, then checks (unless forced) and removes the worktree. */
  | {
      readonly type: "delete.run"
      readonly attempt: number
      readonly target: WorkspaceTarget
      readonly force: boolean
      readonly active: string | undefined
      readonly timeoutMs: number
    }
  | { readonly type: "delete.timer.stop"; readonly attempt: number }
  | { readonly type: "collapse.start"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "collapse.cancel" }
  /** Moves drafts off the removed worktree, tells plugins, and refreshes the inventories. */
  | { readonly type: "finalize.removed"; readonly target: WorkspaceTarget }
  | { readonly type: "toast.skipped"; readonly reason: WorkspaceSkipReason }

export type WorkspaceDeleteTransition = {
  readonly state: WorkspaceDeleteState
  readonly effects: readonly WorkspaceDeleteEffect[]
}

const NONE: readonly WorkspaceDeleteEffect[] = []

export function createWorkspaceDeleteState(): WorkspaceDeleteState {
  return { status: "idle", issued: 0, removed: {} }
}

export function transitionWorkspaceDelete(
  state: WorkspaceDeleteState,
  event: WorkspaceDeleteEvent,
): WorkspaceDeleteTransition {
  if (state.status === "disposed") {
    // The server removed it after the list closed; drafts, plugins and caches still follow.
    if (event.type === "delete.succeeded")
      return { state, effects: [{ type: "finalize.removed", target: event.target }] }

    return { state, effects: NONE }
  }

  if (event.type === "disposed") {
    if (state.status === "deleting")
      return { state: { status: "disposed" }, effects: [{ type: "delete.timer.stop", attempt: state.attempt }] }

    if (state.status === "collapsing")
      return {
        state: { status: "disposed" },
        effects: [{ type: "collapse.cancel" }, { type: "finalize.removed", target: state.current }],
      }

    return { state: { status: "disposed" }, effects: NONE }
  }

  if (event.type === "inventory.synced") {
    const listed = new Set(event.keys)
    const kept = Object.keys(state.removed).filter((key) => listed.has(key))

    if (kept.length === Object.keys(state.removed).length) return { state, effects: NONE }

    return { state: { ...state, removed: Object.fromEntries(kept.map((key) => [key, true as const])) }, effects: NONE }
  }

  // A removal that timed out and succeeded later still removed the worktree.
  if (event.type === "delete.succeeded" && !(state.status === "deleting" && state.attempt === event.attempt)) {
    if (state.status === "collapsing" && state.attempt === event.attempt) return { state, effects: NONE }

    return { state, effects: [{ type: "finalize.removed", target: event.target }] }
  }

  if (state.status === "idle") {
    if (event.type !== "confirm.opened" || event.targets.length === 0) return { state, effects: NONE }
    const attempt = state.issued + 1

    return {
      state: {
        status: "confirming",
        issued: attempt,
        attempt,
        scope: event.scope,
        active: event.active,
        targets: event.targets,
        removed: state.removed,
      },
      effects: [{ type: "open.confirm", attempt, scope: event.scope, active: event.active, targets: event.targets }],
    }
  }

  if (state.status === "confirming") {
    if ((event.type !== "confirm.cancelled" && event.type !== "confirm.accepted") || event.attempt !== state.attempt)
      return { state, effects: NONE }

    if (event.type === "confirm.cancelled")
      return { state: { status: "idle", issued: state.issued, removed: state.removed }, effects: NONE }

    const [current, ...queue] = state.targets

    if (!current) return { state: { status: "idle", issued: state.issued, removed: state.removed }, effects: NONE }

    return start({
      issued: state.issued,
      force: state.scope === "one",
      active: state.active,
      current,
      queue,
      removed: state.removed,
    })
  }

  if (!("attempt" in event) || event.attempt !== state.attempt) return { state, effects: NONE }

  if (state.status === "collapsing") {
    if (event.type !== "collapse.completed") return { state, effects: NONE }
    const next = advance(state, { ...state.removed, [state.current.key]: true })

    return { state: next.state, effects: [{ type: "finalize.removed", target: state.current }, ...next.effects] }
  }

  const stop: WorkspaceDeleteEffect = { type: "delete.timer.stop", attempt: state.attempt }

  if (event.type === "delete.succeeded")
    return {
      state: { ...state, status: "collapsing" },
      effects: [stop, { type: "collapse.start", attempt: state.attempt, delayMs: WORKSPACE_COLLAPSE_MS }],
    }

  if (event.type !== "delete.skipped" && event.type !== "delete.timed-out") return { state, effects: NONE }
  const next = advance(state, state.removed)
  const reason: WorkspaceSkipReason = event.type === "delete.skipped" ? event.reason : { kind: "timed-out" }

  return { state: next.state, effects: [stop, { type: "toast.skipped", reason }, ...next.effects] }
}

export function isWorkspaceDeleteBusy(state: WorkspaceDeleteState) {
  return state.status === "confirming" || state.status === "deleting" || state.status === "collapsing"
}

/** The listed worktrees without the ones that finished collapsing. */
export function visibleWorkspaces<T>(state: WorkspaceDeleteState, items: readonly T[], keyOf: (item: T) => string) {
  if (state.status === "disposed" || Object.keys(state.removed).length === 0) return [...items]
  const removed = state.removed

  return items.filter((item) => !removed[keyOf(item)])
}

export function workspaceRowView(state: WorkspaceDeleteState, key: string) {
  if ((state.status === "deleting" || state.status === "collapsing") && state.current.key === key)
    return { deleting: true, collapsing: state.status === "collapsing" }

  if (state.status !== "disposed" && state.removed[key]) return { deleting: true, collapsing: true }

  return { deleting: false, collapsing: false }
}

function start(run: Omit<Run, "attempt">): WorkspaceDeleteTransition {
  const attempt = run.issued + 1

  return {
    state: {
      status: "deleting",
      issued: attempt,
      attempt,
      force: run.force,
      active: run.active,
      current: run.current,
      queue: run.queue,
      removed: run.removed,
    },
    effects: [
      {
        type: "delete.run",
        attempt,
        target: run.current,
        force: run.force,
        active: run.active,
        timeoutMs: WORKSPACE_DELETE_TIMEOUT_MS,
      },
    ],
  }
}

function advance(state: Run, removed: Readonly<Record<string, true>>): WorkspaceDeleteTransition {
  const [current, ...queue] = state.queue

  if (!current) return { state: { status: "idle", issued: state.issued, removed }, effects: NONE }

  return start({ ...state, current, queue, removed })
}
