import type { PartRef } from "./timeline-row"

export type TurnLimitKind = "free-limit" | "go-limit" | "budget-limit" | "model-budget-limit"

export type TurnErrorInfo = {
  readonly text: string
  readonly kind?: TurnLimitKind
  readonly resetAt?: number
}

export type TurnThinkingPlacement = "separate" | "grouped" | "hidden"

/**
 * Where one turn stands. `working` means the model runs, between steps too; `thinking` is working with a reasoning part
 * still streaming where the reader can see it. `retrying`, `failed` and `interrupted` end the live phase even while the
 * Session status has not settled yet.
 */
export type TurnPhase =
  | { readonly status: "idle" }
  | { readonly status: "working" }
  | { readonly status: "thinking"; readonly ref: PartRef; readonly placement: "separate" | "grouped" }
  | { readonly status: "retrying"; readonly attempt: number; readonly message: string; readonly next: number }
  | { readonly status: "failed"; readonly error: TurnErrorInfo }
  | { readonly status: "interrupted" }

/** The facts of one turn in order: whether it can run, then each step it took. Notices are not steps. */
export type TurnPhaseEvent =
  | { readonly type: "started"; readonly live: boolean }
  | {
      readonly type: "step"
      readonly active: boolean
      readonly session: "idle" | "busy" | "retry"
      readonly completed: boolean
      readonly reasoning?: { readonly ref: PartRef; readonly placement: TurnThinkingPlacement }
      readonly retry?: { readonly attempt: number; readonly message: string; readonly next: number }
      readonly error?: { readonly interrupted: true } | { readonly interrupted: false; readonly info: TurnErrorInfo }
    }
  | { readonly type: "idle.failed"; readonly error: TurnErrorInfo }

export const IDLE_TURN_PHASE: TurnPhase = Object.freeze({ status: "idle" })

export const WORKING_TURN_PHASE: TurnPhase = Object.freeze({ status: "working" })

export const INTERRUPTED_TURN_PHASE: TurnPhase = Object.freeze({ status: "interrupted" })

export function transitionTurnPhase(state: TurnPhase, event: TurnPhaseEvent): TurnPhase {
  if (event.type === "started") return event.live ? WORKING_TURN_PHASE : IDLE_TURN_PHASE

  if (event.type === "idle.failed") return { status: "failed", error: event.error }

  if (event.active && event.retry) return { status: "retrying", ...event.retry }

  if (event.error)
    return event.error.interrupted ? INTERRUPTED_TURN_PHASE : { status: "failed", error: event.error.info }

  if (!event.active || event.session === "idle") return IDLE_TURN_PHASE

  if (event.session === "busy" && !event.completed && event.reasoning && event.reasoning.placement !== "hidden")
    return state.status === "thinking" &&
      state.placement === event.reasoning.placement &&
      sameRef(state.ref, event.reasoning.ref)
      ? state
      : { status: "thinking", ref: event.reasoning.ref, placement: event.reasoning.placement }

  return WORKING_TURN_PHASE
}

export function viewTurnPhase(state: TurnPhase) {
  const live = state.status === "working" || state.status === "thinking"

  return {
    /** The model is producing this turn, so its content is still changing. */
    live,
    /** Settled turns keep their last text as the answer. */
    settled: state.status === "idle" || state.status === "failed" || state.status === "interrupted",
    /** The reply is not final yet, so it offers no Copy. */
    hideCopy: live || state.status === "retrying",
    separateThinkingRef: state.status === "thinking" && state.placement === "separate" ? state.ref : undefined,
    streamingReasoningRef: state.status === "thinking" ? state.ref : undefined,
    retry: state.status === "retrying" ? state : undefined,
    error: state.status === "failed" ? state.error : undefined,
  }
}

export function sameTurnPhase(a: TurnPhase, b: TurnPhase) {
  if (a === b) return true

  if (a.status === "thinking") return b.status === "thinking" && a.placement === b.placement && sameRef(a.ref, b.ref)

  if (a.status === "retrying")
    return b.status === "retrying" && a.attempt === b.attempt && a.message === b.message && a.next === b.next

  if (a.status === "failed")
    return (
      b.status === "failed" &&
      a.error.text === b.error.text &&
      a.error.kind === b.error.kind &&
      a.error.resetAt === b.error.resetAt
    )

  return a.status === b.status
}

export function isInterruptedError(error: { readonly type: string } | undefined) {
  const type = error?.type.toLowerCase()

  return !!type && (type.includes("abort") || type.includes("interrupt"))
}

export function sameRef(a: PartRef | undefined, b: PartRef | undefined) {
  return a === b || (!!a && !!b && a.messageID === b.messageID && a.partID === b.partID)
}
