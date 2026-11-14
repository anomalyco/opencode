/**
 * How long a worker may take to open a file before the viewer gives up and the file view shows its binary placeholder.
 * Generous, because a large workbook parses for seconds on a slow machine; it only bounds an engine that hangs.
 */
export const WORKER_OPEN_TIMEOUT_MS = 60_000

/**
 * One Office viewer's worker. Each new set of bytes takes the next attempt number and a worker of its own, so a result
 * or crash whose attempt the state no longer holds is stale.
 */
export type WorkerState<T> =
  /** No bytes yet. */
  | { readonly status: "idle" }
  /** The attempt's worker is opening the bytes. */
  | { readonly status: "opening"; readonly attempt: number }
  /** The file shows; `value` is what the viewer needs to show it. */
  | { readonly status: "open"; readonly attempt: number; readonly value: T }
  /** The file could not be opened, or its worker stopped; the error was reported once. */
  | { readonly status: "failed"; readonly attempt: number }
  | { readonly status: "disposed" }

export type WorkerEvent<T> =
  /** The view received new bytes: a newly opened or reloaded file. */
  | { readonly type: "bytes.changed"; readonly bytes: Uint8Array }
  /** `details` are the facts about the file the toolbar shows, when the viewer knows them at open. */
  | {
      readonly type: "open.succeeded"
      readonly attempt: number
      readonly value: T
      readonly details: readonly string[] | undefined
    }
  /** The worker could not open the bytes, or its open call rejected. */
  | { readonly type: "open.failed"; readonly attempt: number }
  | { readonly type: "open.timed-out"; readonly attempt: number }
  /** The worker raised `error` or `messageerror`: it is gone, with whatever it showed. */
  | { readonly type: "worker.crashed"; readonly attempt: number }
  | { readonly type: "disposed" }

export type WorkerEffect =
  /** Starts the attempt's worker and open timeout, and opens the bytes in it. */
  | { readonly type: "open-worker"; readonly attempt: number; readonly bytes: Uint8Array; readonly timeoutMs: number }
  | { readonly type: "cancel-open-timeout"; readonly attempt: number }
  /** Ends the attempt's timeout, aborts its calls and terminates its worker, which frees the engine's memory. */
  | { readonly type: "close-worker"; readonly attempt: number }
  | { readonly type: "report-details"; readonly details: readonly string[] }
  | { readonly type: "report-error" }

export type WorkerTransition<T> = { readonly state: WorkerState<T>; readonly effects: readonly WorkerEffect[] }

const NONE: readonly WorkerEffect[] = []

export function transitionWorker<T>(state: WorkerState<T>, event: WorkerEvent<T>): WorkerTransition<T> {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: closeActive(state) }

  if (event.type === "bytes.changed") {
    const attempt = (state.status === "idle" ? 0 : state.attempt) + 1

    return {
      state: { status: "opening", attempt },
      effects: [
        ...closeActive(state),
        { type: "open-worker", attempt, bytes: event.bytes, timeoutMs: WORKER_OPEN_TIMEOUT_MS },
      ],
    }
  }

  // A failed attempt reported its error once: the open call that rejects after a crash, or a reply after a timeout,
  // changes nothing.
  if (state.status === "idle" || state.status === "failed" || event.attempt !== state.attempt)
    return { state, effects: NONE }

  if (event.type === "worker.crashed")
    return {
      state: { status: "failed", attempt: state.attempt },
      effects: [...closeActive(state), { type: "report-error" }],
    }

  if (state.status !== "opening") return { state, effects: NONE }

  if (event.type === "open.succeeded") {
    const settled: WorkerEffect = { type: "cancel-open-timeout", attempt: state.attempt }

    return {
      state: { status: "open", attempt: state.attempt, value: event.value },
      effects: event.details ? [settled, { type: "report-details", details: event.details }] : [settled],
    }
  }

  return {
    state: { status: "failed", attempt: state.attempt },
    effects: [{ type: "close-worker", attempt: state.attempt }, { type: "report-error" }],
  }
}

/** Whether the viewer shows its loader: until the file opens, and never once it failed. */
export function workerLoading<T>(state: WorkerState<T>) {
  return state.status === "idle" || state.status === "opening"
}

/** The open file, one object per attempt, so a viewer keyed on it mounts afresh for a reloaded file. */
export function workerOpened<T>(state: WorkerState<T>) {
  return state.status === "open" ? state : undefined
}

function closeActive<T>(state: Exclude<WorkerState<T>, { status: "disposed" }>): readonly WorkerEffect[] {
  return state.status === "opening" || state.status === "open"
    ? [{ type: "close-worker", attempt: state.attempt }]
    : NONE
}
