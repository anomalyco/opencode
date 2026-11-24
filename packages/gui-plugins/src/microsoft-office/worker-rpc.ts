// The engines run in a worker per open file, so no layout, recalculation or painting holds the window. These are the
// two ends of that worker's protocol: typed calls by method name, a key that lets a newer call replace a queued one
// (as the markdown worker's queue does), transferable payloads, and a worker that fails every pending call when it dies.
// The machines in `worker-rpc-machine.ts` decide; these drivers post the messages and run the handlers.

import {
  transitionWorkerRpcClient,
  transitionWorkerRpcServer,
  type RpcCancel,
  type RpcRequest,
  type RpcResponse,
  type WorkerRejectReason,
  type WorkerRpcClientEffect,
  type WorkerRpcClientEvent,
  type WorkerRpcClientState,
  type WorkerRpcServerEffect,
  type WorkerRpcServerEvent,
  type WorkerRpcServerState,
} from "./worker-rpc-machine"

/** What one method takes and returns. */
export type Method<Input, Output> = { readonly input: Input; readonly output: Output }

/** A worker's methods by name. */
export type Methods = { readonly [name: string]: Method<unknown, unknown> }

/** A value a method returns with the buffers to move to the caller rather than copy. */
export class Transfer<T> {
  constructor(
    readonly value: T,
    readonly transfer: readonly Transferable[],
  ) {}
}

/**
 * The buffer to move a file's bytes to a worker in: their own when they span all of it, as a viewer's bytes do, so the
 * file is never copied; a copy of the span otherwise. Moving it leaves `bytes` empty.
 */
export function movableBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = bytes.buffer

  if (buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength) return buffer

  return bytes.slice().buffer
}

/** A call that a newer call with the same key replaced before it ran. */
export class SupersededError extends Error {}

/** A call made after the worker failed or was closed, or pending when that happened. */
export class WorkerClosedError extends Error {}

/**
 * A call its caller aborted. It extends `WorkerClosedError`, so a caller that ignores a closed worker also ignores its
 * own aborts; check this class first to tell them apart.
 */
export class AbortedError extends WorkerClosedError {}

type CallOptions = {
  /** A newer call with the same key replaces this one while it waits to run. */
  readonly key?: string
  /** Buffers to move to the worker rather than copy, such as the file's bytes or a transferred canvas. */
  readonly transfer?: readonly Transferable[]
  /** Drops the reply and a call still queued; a call that has started sees its handler's signal abort. */
  readonly signal?: AbortSignal
}

/** A call waiting for its reply, and the abort listener to detach once it settles. */
type Call = {
  readonly resolve: (effect: Extract<WorkerRpcClientEffect, { type: "resolve-call" }>) => void
  readonly reject: (error: Error) => void
  readonly detach: () => void
}

/** The window's end: starts the worker and calls its methods. `onCrash` runs once if the worker dies on its own. */
export function createWorkerClient<M extends Methods>(worker: Worker, options: { readonly onCrash?: () => void } = {}) {
  const calls = new Map<number, Call>()
  let clientState: WorkerRpcClientState = { status: "live", pending: new Set() }
  let ids = 0

  const take = (id: number) => {
    const call = calls.get(id)

    calls.delete(id)
    call?.detach()

    return call
  }

  const dispatch = createDispatch<WorkerRpcClientState, WorkerRpcClientEvent, WorkerRpcClientEffect>({
    read: () => clientState,
    write: (next) => {
      clientState = next
    },
    transition: transitionWorkerRpcClient,
    run: (effect) => {
      if (effect.type === "post-request") return worker.postMessage(effect.request, [...effect.transfer])

      if (effect.type === "post-cancel") return worker.postMessage({ cancel: effect.id } satisfies RpcCancel)

      if (effect.type === "resolve-call") return take(effect.id)?.resolve(effect)

      if (effect.type === "reject-calls") return effect.ids.forEach((id) => take(id)?.reject(rejection(effect.reason)))

      if (effect.type === "close-bitmaps") return closeBitmaps(effect.transferred)

      if (effect.type === "notify-crash") return options.onCrash?.()

      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
    },
    failed: (effect, cause) =>
      effect.type === "post-request"
        ? { type: "call.post-failed", id: effect.request.id, message: message(cause) }
        : undefined,
  })

  worker.onmessage = (event: MessageEvent<RpcResponse>) => dispatch({ type: "reply.received", response: event.data })
  worker.onerror = (event) =>
    dispatch({ type: "worker.crashed", message: event.message || "The Office engine stopped" })
  worker.onmessageerror = () =>
    dispatch({ type: "worker.crashed", message: "The Office engine sent an unreadable reply" })

  return {
    call<K extends keyof M & string>(
      method: K,
      input: M[K]["input"],
      options: CallOptions = {},
    ): Promise<M[K]["output"]> {
      const id = ++ids
      const signal = options.signal

      return new Promise<M[K]["output"]>((resolve, reject) => {
        const abort = () => dispatch({ type: "call.aborted", id })

        calls.set(id, {
          // SAFETY: the worker answers each id with the output of the method that id called (see `serveWorker`).
          resolve: (effect) => resolve(effect.value as M[K]["output"]),
          reject,
          detach: () => signal?.removeEventListener("abort", abort),
        })

        if (signal && !signal.aborted) signal.addEventListener("abort", abort, { once: true })

        dispatch({
          type: "call.requested",
          request: { id, method, key: options.key, input },
          transfer: options.transfer ?? [],
          aborted: signal?.aborted ?? false,
        })
      })
    },
    /** Stops the worker, which frees its engine's memory, and fails every pending call. */
    close() {
      dispatch({ type: "closed" })
    },
  }
}

/**
 * The worker's end: runs calls one at a time, in order, letting messages through between them. A handler's signal
 * aborts when its caller aborts the call.
 */
export function serveWorker<M extends Methods>(handlers: {
  readonly [K in keyof M]: (
    input: M[K]["input"],
    signal: AbortSignal,
  ) => M[K]["output"] | Transfer<M[K]["output"]> | Promise<M[K]["output"] | Transfer<M[K]["output"]>>
}) {
  const controllers = new Map<number, AbortController>()
  let serverState: WorkerRpcServerState = { status: "idle", attempt: 0 }

  const start = (attempt: number, request: RpcRequest) => {
    const handler = handlers[request.method]

    if (!handler) return dispatch({ type: "handler.failed", attempt, message: `Unknown method ${request.method}` })

    const controller = new AbortController()
    // SAFETY: the client sends each method the input its `Methods` entry declares (see `createWorkerClient`).
    const input = request.input as never

    controllers.set(attempt, controller)
    void Promise.try(() => handler(input, controller.signal))
      .finally(() => controllers.delete(attempt))
      .then(
        (result) =>
          dispatch(
            result instanceof Transfer
              ? { type: "handler.succeeded", attempt, value: result.value, transfer: result.transfer }
              : { type: "handler.succeeded", attempt, value: result, transfer: [] },
          ),
        (cause: unknown) => dispatch({ type: "handler.failed", attempt, message: message(cause) }),
      )
  }

  const dispatch = createDispatch<WorkerRpcServerState, WorkerRpcServerEvent, WorkerRpcServerEffect>({
    read: () => serverState,
    write: (next) => {
      serverState = next
    },
    transition: transitionWorkerRpcServer,
    run: (effect) => {
      // Each call returns to the event loop before it leaves the queue, so calls that arrived meanwhile can replace it.
      if (effect.type === "schedule-turn")
        return void setTimeout(() => dispatch({ type: "turn.ready", attempt: effect.attempt }))

      if (effect.type === "abort-handler") return controllers.get(effect.attempt)?.abort()

      if (effect.type === "reply") return self.postMessage(effect.response, { transfer: [...effect.transfer] })

      if (effect.type === "close-bitmaps") return closeBitmaps(effect.transferred)

      start(effect.attempt, effect.request)
    },
    failed: (effect, cause) =>
      effect.type === "reply" && effect.response.ok
        ? { type: "reply.failed", id: effect.response.id, message: message(cause), transferred: effect.transfer }
        : undefined,
  })

  self.onmessage = (event: MessageEvent<RpcRequest | RpcCancel>) =>
    dispatch(
      "cancel" in event.data
        ? { type: "cancel.received", id: event.data.cancel }
        : { type: "request.received", request: event.data },
    )
}

/**
 * Applies one event at a time and runs its effects; an effect may dispatch, and its event waits for the current one.
 * A throwing effect never stalls the queue: it reports `failed(effect, cause)` back to the machine, and one without
 * such an event surfaces as an unhandled rejection while later events keep applying.
 */
function createDispatch<State, Event, Effect>(machine: {
  readonly read: () => State
  readonly write: (state: State) => void
  readonly transition: (state: State, event: Event) => { readonly state: State; readonly effects: readonly Effect[] }
  readonly run: (effect: Effect) => void
  readonly failed: (effect: Effect, cause: unknown) => Event | undefined
}) {
  const queue: Event[] = []

  const apply = (event: Event) => {
    const next = machine.transition(machine.read(), event)

    machine.write(next.state)
    next.effects.forEach((effect) => {
      void Promise.try(() => machine.run(effect)).catch((cause: unknown) => {
        const failure = machine.failed(effect, cause)

        if (!failure) throw cause
        dispatch(failure)
      })
    })
  }

  const dispatch = (event: Event) => {
    queue.push(event)

    if (queue.length > 1) return

    while (queue.length > 0) {
      void Promise.try(apply, queue[0])
      queue.shift()
    }
  }

  return dispatch
}

function rejection(reason: WorkerRejectReason) {
  if (reason.kind === "aborted") return new AbortedError("The call was aborted")

  if (reason.kind === "superseded") return new SupersededError(reason.message)

  if (reason.kind === "error") return new Error(reason.message)

  return new WorkerClosedError(reason.message)
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Frees the bitmaps among objects that were moved for a reply nobody takes. */
function closeBitmaps(transfer: readonly Transferable[]) {
  transfer.forEach((item) => {
    if (item instanceof ImageBitmap) item.close()
  })
}
