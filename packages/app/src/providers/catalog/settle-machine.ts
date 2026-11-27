// The server loads a Console workspace's providers after a credential change, so the first catalog
// refresh can still show only the free catalog. This machine polls briefly for the workspace.
export const CONSOLE_SETTLE_POLL_MS = 250

export const CONSOLE_SETTLE_TIMEOUT_MS = 10_000

export type ConsoleSettleOutcome = "loaded" | "timed-out" | "cancelled"

export type ConsoleSettleState =
  | { readonly status: "idle"; readonly attempt: number }
  /** `syncing` is true while a catalog read is in flight; the next poll waits for it. */
  | { readonly status: "waiting"; readonly attempt: number; readonly syncing: boolean }
  | { readonly status: "disposed"; readonly attempt: number }

export type ConsoleSettleEvent =
  | { readonly type: "started"; readonly loaded: boolean }
  | { readonly type: "catalog.loaded" }
  | { readonly type: "poll.due"; readonly attempt: number; readonly loaded: boolean }
  | { readonly type: "sync.settled"; readonly attempt: number; readonly loaded: boolean }
  | { readonly type: "timed-out"; readonly attempt: number; readonly loaded: boolean }
  | { readonly type: "cancelled" }
  | { readonly type: "disposed" }

export type ConsoleSettleEffect =
  | { readonly type: "poll.schedule"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "deadline.start"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "timers.stop" }
  | { readonly type: "sync"; readonly attempt: number }
  | { readonly type: "settled"; readonly attempt: number; readonly outcome: ConsoleSettleOutcome }

export type ConsoleSettleTransition = {
  readonly state: ConsoleSettleState
  readonly effects: readonly ConsoleSettleEffect[]
}

export function createConsoleSettleState(): ConsoleSettleState {
  return { status: "idle", attempt: 0 }
}

export function transitionConsoleSettle(state: ConsoleSettleState, event: ConsoleSettleEvent): ConsoleSettleTransition {
  if (state.status === "disposed") {
    // A caller that asks after its owner is gone still gets an answer, so nothing awaits forever.
    if (event.type !== "started") return { state, effects: [] }
    const attempt = state.attempt + 1

    return { state: { status: "disposed", attempt }, effects: [{ type: "settled", attempt, outcome: "cancelled" }] }
  }

  if (event.type === "started") {
    const cancelled = state.status === "waiting" ? stop(state.attempt, "cancelled") : []
    const attempt = state.attempt + 1

    if (event.loaded)
      return {
        state: { status: "idle", attempt },
        effects: [...cancelled, { type: "settled", attempt, outcome: "loaded" }],
      }

    return {
      state: { status: "waiting", attempt, syncing: false },
      effects: [
        ...cancelled,
        { type: "deadline.start", attempt, timeoutMs: CONSOLE_SETTLE_TIMEOUT_MS },
        { type: "poll.schedule", attempt, delayMs: CONSOLE_SETTLE_POLL_MS },
      ],
    }
  }

  if (event.type === "disposed")
    return {
      state: { status: "disposed", attempt: state.attempt },
      effects: state.status === "waiting" ? stop(state.attempt, "cancelled") : [],
    }

  if (state.status === "idle") return { state, effects: [] }

  if (event.type === "catalog.loaded") return settle(state, "loaded")

  if (event.type === "cancelled") return settle(state, "cancelled")

  if (event.attempt !== state.attempt) return { state, effects: [] }

  if (event.type === "timed-out") return settle(state, event.loaded ? "loaded" : "timed-out")

  if (event.type === "poll.due") {
    if (state.syncing) return { state, effects: [] }

    if (event.loaded) return settle(state, "loaded")

    return { state: { ...state, syncing: true }, effects: [{ type: "sync", attempt: state.attempt }] }
  }

  if (!state.syncing) return { state, effects: [] }

  if (event.loaded) return settle(state, "loaded")

  return {
    state: { ...state, syncing: false },
    effects: [{ type: "poll.schedule", attempt: state.attempt, delayMs: CONSOLE_SETTLE_POLL_MS }],
  }
}

function settle(state: Extract<ConsoleSettleState, { status: "waiting" }>, outcome: ConsoleSettleOutcome) {
  return { state: { status: "idle", attempt: state.attempt } as const, effects: stop(state.attempt, outcome) }
}

function stop(attempt: number, outcome: ConsoleSettleOutcome): ConsoleSettleEffect[] {
  return [{ type: "timers.stop" }, { type: "settled", attempt, outcome }]
}
