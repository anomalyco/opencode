/** A completed render waits this long for inline path checks before it reports ready anyway. */
export const INLINE_PATH_CHECK_TIMEOUT_MS = 2_000

/**
 * `static` never streamed and renders its text in one pass. `streaming` projects each delta through the worker as live
 * blocks. `settled` streamed earlier and now projects the final text once more as completed blocks, so the streamed DOM
 * and the user's selection survive.
 */
export type MarkdownMode = "static" | "streaming" | "settled"

/**
 * Whether one Markdown component can report `data-markdown-ready`. `pending` waits for a render of the current text in
 * the current mode. `checking` has rendered a completed text and waits for its inline path checks, numbered `attempt`.
 * `ready` has rendered the current text and every check it needs. `attempts` counts started checks, so a check that
 * settles after another started is stale. Every streamed delta dispatches here, so an event that changes nothing returns
 * the same state, and every state with no started check is a frozen singleton.
 */
export type MarkdownPhaseState =
  | { readonly status: "pending"; readonly mode: MarkdownMode; readonly attempts: number }
  | { readonly status: "checking"; readonly mode: Exclude<MarkdownMode, "streaming">; readonly attempt: number }
  | { readonly status: "ready"; readonly mode: MarkdownMode; readonly attempts: number }
  | { readonly status: "disposed" }

export type MarkdownPhaseEvent =
  | { readonly type: "props.sync"; readonly streaming: boolean }
  | {
      readonly type: "dom.rendered"
      /** The DOM shows a finished render of the current text, made for the current mode. */
      readonly rendered: boolean
      /** Inline path checks the rendered blocks still wait for. */
      readonly pendingChecks: number
      /** Every block is the one the previous DOM pass rendered, so no new check started. */
      readonly reused: boolean
    }
  | { readonly type: "checks.settled"; readonly attempt: number }
  | { readonly type: "checks.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

const PENDING = {
  static: Object.freeze({ status: "pending", mode: "static", attempts: 0 }),
  streaming: Object.freeze({ status: "pending", mode: "streaming", attempts: 0 }),
  settled: Object.freeze({ status: "pending", mode: "settled", attempts: 0 }),
} as const satisfies Record<MarkdownMode, MarkdownPhaseState>

const READY = {
  static: Object.freeze({ status: "ready", mode: "static", attempts: 0 }),
  streaming: Object.freeze({ status: "ready", mode: "streaming", attempts: 0 }),
  settled: Object.freeze({ status: "ready", mode: "settled", attempts: 0 }),
} as const satisfies Record<MarkdownMode, MarkdownPhaseState>

export const DISPOSED_MARKDOWN_PHASE_STATE: MarkdownPhaseState = Object.freeze({ status: "disposed" })

export const DISPOSED_MARKDOWN_PHASE_EVENT: MarkdownPhaseEvent = Object.freeze({ type: "disposed" })

export function createMarkdownPhaseState(streaming: boolean): MarkdownPhaseState {
  return streaming ? PENDING.streaming : PENDING.static
}

export function transitionMarkdownPhase(state: MarkdownPhaseState, event: MarkdownPhaseEvent): MarkdownPhaseState {
  if (state.status === "disposed") return state

  if (event.type === "disposed") return DISPOSED_MARKDOWN_PHASE_STATE
  const attempts = state.status === "checking" ? state.attempt : state.attempts

  if (event.type === "props.sync") {
    if (event.streaming) return state.mode === "streaming" ? state : phase("pending", "streaming", attempts)

    // The last live render is not the settled one: completed blocks still need their path checks.
    return state.mode === "streaming" ? phase("pending", "settled", attempts) : state
  }

  if (event.type === "checks.settled" || event.type === "checks.timed-out") {
    if (state.status !== "checking" || event.attempt !== state.attempt) return state

    return phase("ready", state.mode, state.attempt)
  }

  if (!event.rendered) return state.status === "pending" ? state : phase("pending", state.mode, attempts)

  // A streaming answer renders again on the next delta, so it never waits for path checks.
  if (state.mode === "streaming" || event.pendingChecks === 0)
    return state.status === "ready" ? state : phase("ready", state.mode, attempts)

  // A pass that kept every block started no check, so the running check or a reached `ready` still holds.
  if (event.reused && state.status !== "pending") return state

  return { status: "checking", mode: state.mode, attempt: attempts + 1 }
}

export function markdownMode(state: MarkdownPhaseState): MarkdownMode {
  return state.status === "disposed" ? "static" : state.mode
}

export function markdownReady(state: MarkdownPhaseState) {
  return state.status === "ready"
}

function phase(status: "pending" | "ready", mode: MarkdownMode, attempts: number): MarkdownPhaseState {
  if (attempts === 0) return status === "pending" ? PENDING[mode] : READY[mode]

  return { status, mode, attempts }
}
