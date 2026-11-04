export * as ShellPhase from "./phase.js"

import type { Fiber } from "effect"

export type Outcome = {
  readonly status: "exited" | "timeout"
  readonly exit?: number
  readonly signal?: string
  readonly completed: number
}

// `ending` covers the window after the exit or timeout is recorded while the process is still being
// killed or its output drained; public Info keeps reporting "running" until `terminal`.
export type State =
  | { readonly status: "running"; readonly timer?: Fiber.Fiber<unknown, unknown> }
  | { readonly status: "ending"; readonly outcome: Outcome }
  | { readonly status: "terminal" }
  | { readonly status: "removed" }

export type Event =
  | { readonly type: "exit-observed"; readonly outcome: Outcome }
  | { readonly type: "timed-out"; readonly timer: Fiber.Fiber<unknown, unknown>; readonly completed: number }
  | { readonly type: "retimed"; readonly timer?: Fiber.Fiber<unknown, unknown> }
  | { readonly type: "output-drained" }
  | { readonly type: "removed" }

// Late timers, exits, and drains that no longer apply return the same state.
export function transition(state: State, event: Event): State {
  if (state.status === "removed") return state
  if (event.type === "removed") return { status: "removed" }
  if (state.status === "ending") return event.type === "output-drained" ? { status: "terminal" } : state
  if (state.status === "terminal") return state
  if (event.type === "exit-observed") return { status: "ending", outcome: event.outcome }
  if (event.type === "retimed") return { status: "running", timer: event.timer }
  if (event.type === "timed-out" && event.timer === state.timer)
    return { status: "ending", outcome: { status: "timeout", completed: event.completed } }
  return state
}
