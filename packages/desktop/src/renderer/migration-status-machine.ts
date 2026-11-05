import type { ExperimentalMigrationV1StatusOutput } from "@opencode/client/promise"

export const MIGRATION_POLL_MS = 1_000
export const MIGRATION_POLL_TIMEOUT_MS = 10_000
const MAX_RETRY_EXPONENT = 5

export type MigrationProgress = Extract<ExperimentalMigrationV1StatusOutput, { status: "running" }>["progress"]

// `progress` is the last running answer: a transport failure keeps it, so the toast does not flicker.
export type MigrationState =
  | {
      readonly status: "waiting" | "polling"
      readonly attempt: number
      readonly failures: number
      readonly progress: MigrationProgress | undefined
    }
  | { readonly status: "completed" }
  | { readonly status: "failed"; readonly error: string }
  | { readonly status: "disposed" }

export type MigrationEvent =
  | { readonly type: "poll.due"; readonly attempt: number }
  | { readonly type: "poll.succeeded"; readonly attempt: number; readonly output: ExperimentalMigrationV1StatusOutput }
  | { readonly type: "poll.failed"; readonly attempt: number }
  | { readonly type: "poll.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type MigrationEffect =
  | { readonly type: "start-wait"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "start-poll"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "cancel-timer" }
  | { readonly type: "abort-poll" }
  | { readonly type: "show-error"; readonly error: string }

export type MigrationTransition = {
  readonly state: MigrationState
  readonly effects: readonly MigrationEffect[]
}

export function createMigrationState(): MigrationTransition {
  return {
    state: { status: "waiting", attempt: 1, failures: 0, progress: undefined },
    effects: [{ type: "start-wait", attempt: 1, delayMs: MIGRATION_POLL_MS }],
  }
}

export function transitionMigration(state: MigrationState, event: MigrationEvent): MigrationTransition {
  if (event.type === "disposed") {
    if (state.status === "disposed") return unchanged(state)
    if (state.status === "waiting") return { state: { status: "disposed" }, effects: [{ type: "cancel-timer" }] }
    if (state.status === "polling")
      return { state: { status: "disposed" }, effects: [{ type: "cancel-timer" }, { type: "abort-poll" }] }

    return { state: { status: "disposed" }, effects: [] }
  }

  if (event.type === "poll.due") {
    if (state.status !== "waiting" || state.attempt !== event.attempt) return unchanged(state)
    const attempt = state.attempt + 1

    return {
      state: { ...state, status: "polling", attempt },
      effects: [{ type: "start-poll", attempt, timeoutMs: MIGRATION_POLL_TIMEOUT_MS }],
    }
  }

  if (state.status !== "polling" || state.attempt !== event.attempt) return unchanged(state)

  if (event.type === "poll.succeeded") {
    const output = event.output

    if (output.status === "completed") return { state: { status: "completed" }, effects: [{ type: "cancel-timer" }] }
    if (output.status === "error")
      return {
        state: { status: "failed", error: output.error },
        effects: [{ type: "cancel-timer" }, { type: "show-error", error: output.error }],
      }

    return wait(state.attempt + 1, 0, output.status === "running" ? output.progress : undefined, [{ type: "cancel-timer" }])
  }

  // A transport failure or a hung request says nothing about the migration: keep the toast and retry with backoff.
  const delay = MIGRATION_POLL_MS * 2 ** Math.min(state.failures, MAX_RETRY_EXPONENT)
  const before: MigrationEffect[] =
    event.type === "poll.timed-out" ? [{ type: "abort-poll" }] : [{ type: "cancel-timer" }]

  return wait(state.attempt + 1, state.failures + 1, state.progress, before, delay)
}

export function selectMigrationProgress(state: MigrationState) {
  if (state.status === "waiting" || state.status === "polling") return state.progress

  return undefined
}

export function selectMigrationToastVisible(state: MigrationState) {
  return selectMigrationProgress(state) !== undefined
}

function wait(
  attempt: number,
  failures: number,
  progress: MigrationProgress | undefined,
  before: readonly MigrationEffect[],
  delayMs = MIGRATION_POLL_MS,
): MigrationTransition {
  return {
    state: { status: "waiting", attempt, failures, progress },
    effects: [...before, { type: "start-wait", attempt, delayMs }],
  }
}

function unchanged(state: MigrationState): MigrationTransition {
  return { state, effects: [] }
}
