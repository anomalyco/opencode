import { createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { createKeyed } from "@opencode/plugin/gui"
import {
  transitionWorker,
  workerLoading,
  workerOpened,
  type WorkerEffect,
  type WorkerEvent,
  type WorkerState,
} from "./worker-machine"
import { createWorkerClient, movableBuffer, type Methods } from "./worker-rpc"

/** The window's end of a viewer's worker. */
export type WorkerClient<M extends Methods> = ReturnType<typeof createWorkerClient<M>>

/** What a viewer's open returns: what it shows the file with, and the facts the toolbar shows when it knows them. */
export type OfficeOpened<T> = { readonly value: T; readonly details?: readonly string[] }

/** One attempt's worker, until it closes. */
type Run = {
  readonly controller: AbortController
  readonly close: () => void
  readonly timer: ReturnType<typeof setTimeout>
}

/**
 * Syncs one worker with the view's bytes: each new array opens in a worker of its own, and the previous one is
 * terminated, which frees its engine's memory. Open failures, timeouts and crashes report `onError` once per attempt.
 */
export function createOfficeWorker<M extends Methods, T>(options: {
  readonly bytes: () => Uint8Array
  /** Builds the worker; each caller keeps its own `new Worker(new URL(...))` so the bundler finds the script. */
  readonly createWorker: () => Worker
  /** Opens the bytes, which move to the worker; resolves undefined when the file cannot be opened. */
  readonly open: (
    client: WorkerClient<M>,
    buffer: ArrayBuffer,
    signal: AbortSignal,
  ) => Promise<OfficeOpened<T> | undefined>
  readonly onDetails: (details: readonly string[]) => void
  readonly onError: () => void
}) {
  const [workerState, setWorkerState] = createSignal<WorkerState<T>>({ status: "idle" })
  const runs = new Map<number, Run>()
  // Effects can dispatch while they run (reporting an error may unmount the view), so events apply one at a time.
  const queue: WorkerEvent<T>[] = []

  const dispatch = (event: WorkerEvent<T>) => {
    queue.push(event)

    if (queue.length === 1) drain()
  }

  const drain = () => {
    const event = queue[0]

    if (!event) return

    const next = transitionWorker(untrack(workerState), event)

    setWorkerState(() => next.state)
    next.effects.forEach(run)
    queue.shift()
    drain()
  }

  const run = (effect: WorkerEffect) => {
    if (effect.type === "open-worker") return start(effect.attempt, effect.bytes, effect.timeoutMs)

    if (effect.type === "cancel-open-timeout") return clearTimeout(runs.get(effect.attempt)?.timer)

    if (effect.type === "close-worker") return close(effect.attempt)

    if (effect.type === "report-details") return options.onDetails(effect.details)

    options.onError()
  }

  const start = (attempt: number, bytes: Uint8Array, timeoutMs: number) => {
    const controller = new AbortController()
    const worker = options.createWorker()
    const client = createWorkerClient<M>(worker)
    const crashed = () => dispatch({ type: "worker.crashed", attempt })

    worker.addEventListener("error", crashed)
    worker.addEventListener("messageerror", crashed)
    runs.set(attempt, {
      controller,
      close: () => client.close(),
      timer: setTimeout(() => dispatch({ type: "open.timed-out", attempt }), timeoutMs),
    })

    // The view owns its bytes, so they move to the worker rather than being copied.
    void options.open(client, movableBuffer(bytes), controller.signal).then(
      (opened) =>
        dispatch(
          opened
            ? { type: "open.succeeded", attempt, value: opened.value, details: opened.details }
            : { type: "open.failed", attempt },
        ),
      () => dispatch({ type: "open.failed", attempt }),
    )
  }

  const close = (attempt: number) => {
    const entry = runs.get(attempt)

    if (!entry) return

    runs.delete(attempt)
    clearTimeout(entry.timer)
    entry.controller.abort()
    entry.close()
  }

  createKeyed(options.bytes, (bytes) => dispatch({ type: "bytes.changed", bytes }))
  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    /** Whether the viewer shows its loader. */
    loading: createMemo(() => workerLoading(workerState())),
    /** The open file; a new object for each attempt. */
    opened: createMemo(() => workerOpened(workerState())),
  }
}
