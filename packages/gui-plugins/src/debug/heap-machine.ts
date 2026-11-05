/** Bounds a whole capture, so one that never settles cannot hold the queue. */
export const HEAP_CAPTURE_TIMEOUT_MS = 15 * 60_000

export type HeapCaptureResult = {
  readonly directory: string
  readonly complete: boolean
}

/** Answers one `HeapSnapshots.write` call. */
export type HeapCaptureReply = {
  readonly resolve: (result: HeapCaptureResult) => void
  readonly reject: (error: Error) => void
}

/** A command capture answers every caller that joined it; a signal capture answers nobody and logs a failure. */
export type HeapCaptureJob =
  | {
      readonly source: "command"
      readonly root: string
      readonly includeServer: boolean
      readonly replies: readonly HeapCaptureReply[]
    }
  | { readonly source: "signal"; readonly root: string; readonly includeServer: boolean }

/**
 * Main's heap snapshot queue. One capture runs (`active`) and at most one of the other source waits (`pending`):
 * a repeated command joins the command job, and a repeated `SIGUSR2` joins the signal job, so repeats never fill the
 * disk with queued dumps. Every outcome, a timeout included, starts `pending`.
 */
export type HeapCaptureState =
  | { readonly status: "idle"; readonly attempt: number }
  | {
      readonly status: "capturing"
      readonly attempt: number
      readonly active: HeapCaptureJob
      readonly pending: HeapCaptureJob | undefined
    }
  | { readonly status: "disposed" }

export type HeapCaptureEvent =
  | {
      readonly type: "command.requested"
      readonly root: string
      readonly includeServer: boolean
      readonly reply: HeapCaptureReply
    }
  | { readonly type: "signal.received"; readonly root: string; readonly includeServer: boolean }
  | { readonly type: "capture.succeeded"; readonly attempt: number; readonly result: HeapCaptureResult }
  | { readonly type: "capture.failed"; readonly attempt: number; readonly error: Error }
  | { readonly type: "capture.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type HeapCaptureEffect =
  /** Starts a capture and arms its timeout. */
  | {
      readonly type: "capture.run"
      readonly attempt: number
      readonly root: string
      readonly includeServer: boolean
      readonly timeoutMs: number
    }
  | { readonly type: "timer.cancel" }
  | {
      readonly type: "replies.settle"
      readonly replies: readonly HeapCaptureReply[]
      readonly outcome:
        | { readonly ok: true; readonly result: HeapCaptureResult }
        | { readonly ok: false; readonly error: Error }
    }
  | { readonly type: "signal.failed"; readonly error: string }

export type HeapCaptureTransition = {
  readonly state: HeapCaptureState
  readonly effects: readonly HeapCaptureEffect[]
}

export function createHeapCaptureState(): HeapCaptureState {
  return { status: "idle", attempt: 0 }
}

export function transitionHeapCapture(state: HeapCaptureState, event: HeapCaptureEvent): HeapCaptureTransition {
  if (state.status === "disposed") {
    if (event.type !== "command.requested") return { state, effects: [] }

    return { state, effects: [settle([event.reply], { ok: false, error: new Error("Heap capture disposed") })] }
  }

  if (event.type === "disposed") {
    if (state.status === "idle") return { state: { status: "disposed" }, effects: [] }
    const replies = [state.active, state.pending].flatMap((job) => (job?.source === "command" ? job.replies : []))

    return {
      state: { status: "disposed" },
      effects: [
        { type: "timer.cancel" },
        ...(replies.length ? [settle(replies, { ok: false, error: new Error("Heap capture disposed") })] : []),
      ],
    }
  }

  if (event.type === "command.requested") {
    if (state.status === "idle") {
      return start(state.attempt + 1, {
        source: "command",
        root: event.root,
        includeServer: event.includeServer,
        replies: [event.reply],
      })
    }

    if (state.active.source === "command") {
      return {
        state: { ...state, active: { ...state.active, replies: [...state.active.replies, event.reply] } },
        effects: [],
      }
    }

    // A signal capture is running: the command waits for it, and later commands join it there.
    return {
      state: {
        ...state,
        pending: {
          source: "command",
          root: event.root,
          includeServer: event.includeServer,
          replies: state.pending?.source === "command" ? [...state.pending.replies, event.reply] : [event.reply],
        },
      },
      effects: [],
    }
  }

  if (event.type === "signal.received") {
    if (state.status === "idle") {
      return start(state.attempt + 1, { source: "signal", root: event.root, includeServer: event.includeServer })
    }

    if (state.active.source === "signal" || state.pending) return { state, effects: [] }

    return {
      state: { ...state, pending: { source: "signal", root: event.root, includeServer: event.includeServer } },
      effects: [],
    }
  }

  if (state.status === "idle" || event.attempt !== state.attempt) return { state, effects: [] }

  const outcome =
    event.type === "capture.succeeded"
      ? { ok: true as const, result: event.result }
      : {
          ok: false as const,
          error: event.type === "capture.failed" ? event.error : new Error("Heap capture timed out"),
        }

  const settled: HeapCaptureEffect[] = [
    { type: "timer.cancel" },
    ...(state.active.source === "command"
      ? [settle(state.active.replies, outcome)]
      : outcome.ok
        ? []
        : [{ type: "signal.failed" as const, error: outcome.error.message }]),
  ]

  if (!state.pending) return { state: { status: "idle", attempt: state.attempt }, effects: settled }
  const next = start(state.attempt + 1, state.pending)

  return { state: next.state, effects: [...settled, ...next.effects] }
}

function start(attempt: number, job: HeapCaptureJob): HeapCaptureTransition {
  return {
    state: { status: "capturing", attempt, active: job, pending: undefined },
    effects: [
      {
        type: "capture.run",
        attempt,
        root: job.root,
        includeServer: job.includeServer,
        timeoutMs: HEAP_CAPTURE_TIMEOUT_MS,
      },
    ],
  }
}

function settle(
  replies: readonly HeapCaptureReply[],
  outcome: Extract<HeapCaptureEffect, { type: "replies.settle" }>["outcome"],
): HeapCaptureEffect {
  return { type: "replies.settle", replies, outcome }
}

// --- The palette command in a window ---

/** One window's "Capture heap snapshots" command: a run while one is in flight shows nothing new. */
export type HeapCommandState =
  | { readonly status: "idle"; readonly issued: number }
  | { readonly status: "capturing"; readonly attempt: number }
  | { readonly status: "disposed" }

export type HeapCommandEvent =
  | { readonly type: "run" }
  | { readonly type: "succeeded"; readonly attempt: number; readonly result: HeapCaptureResult }
  | { readonly type: "failed"; readonly attempt: number }
  | { readonly type: "disposed" }

export type HeapCommandEffect =
  /** Shows the loading toast and asks main for the capture. */
  | { readonly type: "capture.start"; readonly attempt: number }
  /** Dismisses the loading toast and stops waiting for main. */
  | { readonly type: "capture.abort"; readonly attempt: number }
  | { readonly type: "toast.result"; readonly attempt: number; readonly result: HeapCaptureResult }
  | { readonly type: "toast.failed"; readonly attempt: number }

export type HeapCommandTransition = {
  readonly state: HeapCommandState
  readonly effects: readonly HeapCommandEffect[]
}

export function createHeapCommandState(): HeapCommandState {
  return { status: "idle", issued: 0 }
}

export function transitionHeapCommand(state: HeapCommandState, event: HeapCommandEvent): HeapCommandTransition {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed") {
    if (state.status === "idle") return { state: { status: "disposed" }, effects: [] }

    return { state: { status: "disposed" }, effects: [{ type: "capture.abort", attempt: state.attempt }] }
  }

  if (event.type === "run") {
    if (state.status === "capturing") return { state, effects: [] }
    const attempt = state.issued + 1

    return { state: { status: "capturing", attempt }, effects: [{ type: "capture.start", attempt }] }
  }

  if (state.status === "idle" || event.attempt !== state.attempt) return { state, effects: [] }

  return {
    state: { status: "idle", issued: state.attempt },
    effects: [
      event.type === "succeeded"
        ? { type: "toast.result", attempt: event.attempt, result: event.result }
        : { type: "toast.failed", attempt: event.attempt },
    ],
  }
}

/** Whether the palette offers the command: not while this window's capture runs. */
export function isHeapCommandEnabled(state: HeapCommandState) {
  return state.status === "idle"
}
