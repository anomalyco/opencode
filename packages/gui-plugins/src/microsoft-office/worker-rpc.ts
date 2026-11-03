// The engines run in a worker per open file, so no layout, recalculation or painting holds the window. These are the
// two ends of that worker's protocol: typed calls by method name, a key that lets a newer call replace a queued one
// (as the markdown worker's queue does), transferable payloads, and a worker that fails every pending call when it dies.

/** What one method takes and returns. */
export type Method<Input, Output> = { readonly input: Input; readonly output: Output }

/** A worker's methods by name. */
export type Methods = { readonly [name: string]: Method<unknown, unknown> }

type Request = { readonly id: number; readonly method: string; readonly key?: string; readonly input: unknown }

/** Withdraws a call whose caller aborted it. */
type Cancel = { readonly cancel: number }

type Response =
  /** `transferred` lists the objects the reply moved, so a reply nobody waits for can close its bitmaps. */
  | { readonly id: number; readonly ok: true; readonly value: unknown; readonly transferred: readonly Transferable[] }
  | { readonly id: number; readonly ok: false; readonly superseded: boolean; readonly message: string }

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

type CallOptions = {
  /** A newer call with the same key replaces this one while it waits to run. */
  readonly key?: string
  /** Buffers to move to the worker rather than copy, such as the file's bytes or a transferred canvas. */
  readonly transfer?: readonly Transferable[]
  /** Drops the reply and a call still queued; a call that has started sees its handler's signal abort. */
  readonly signal?: AbortSignal
}

/** A call waiting for its reply. */
type Pending = { readonly settle: (response: Response) => void; readonly reject: (error: Error) => void }

/** The next call id, and why the worker stopped answering once it has. */
type ClientState = { next: number; failure: Error | undefined }

/** The window's end: starts the worker and calls its methods. */
export function createWorkerClient<M extends Methods>(worker: Worker) {
  const pending = new Map<number, Pending>()
  const state: ClientState = { next: 0, failure: undefined }

  const fail = (error: Error) => {
    state.failure ??= error
    pending.forEach((call) => call.reject(error))
    pending.clear()
    worker.terminate()
  }

  worker.onmessage = (event: MessageEvent<Response>) => {
    const call = pending.get(event.data.id)

    // A reply that crossed its call's cancel on the way: its bitmaps would hold their memory until collected.
    if (!call) {
      if (event.data.ok) closeBitmaps(event.data.transferred)

      return
    }

    pending.delete(event.data.id)
    call.settle(event.data)
  }

  worker.onerror = (event) => fail(new WorkerClosedError(event.message || "The Office engine stopped"))
  worker.onmessageerror = () => fail(new WorkerClosedError("The Office engine sent an unreadable reply"))

  return {
    call<K extends keyof M & string>(
      method: K,
      input: M[K]["input"],
      options: CallOptions = {},
    ): Promise<M[K]["output"]> {
      if (state.failure) return Promise.reject(state.failure)

      if (options.signal?.aborted) return Promise.reject(new WorkerClosedError("The call was aborted"))

      const id = ++state.next

      return new Promise<M[K]["output"]>((resolve, reject) => {
        const abort = () => {
          pending.delete(id)
          reject(new WorkerClosedError("The call was aborted"))
          worker.postMessage({ cancel: id } satisfies Cancel)
        }

        options.signal?.addEventListener("abort", abort, { once: true })
        pending.set(id, {
          settle: (response) => {
            options.signal?.removeEventListener("abort", abort)

            if (!response.ok)
              return reject(response.superseded ? new SupersededError(response.message) : new Error(response.message))

            // SAFETY: the worker answers each id with the output of the method that id called (see `serveWorker`).
            resolve(response.value as M[K]["output"])
          },
          reject,
        })
        worker.postMessage({ id, method, key: options.key, input } satisfies Request, [...(options.transfer ?? [])])
      })
    },
    /** Stops the worker, which frees its engine's memory, and fails every pending call. */
    close() {
      fail(new WorkerClosedError("The Office engine was closed"))
    },
  }
}

/** Whether a call runs, and which call it is, so its caller can abort it. */
type ServerState = {
  running: boolean
  current: { readonly id: number; readonly controller: AbortController } | undefined
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
  const queue: Request[] = []

  const state: ServerState = { running: false, current: undefined }

  const reply = (response: Response, transfer: readonly Transferable[] = []) =>
    self.postMessage(response, { transfer: [...transfer] })

  const run = async () => {
    if (state.running) return

    state.running = true

    // Each call returns to the event loop before it leaves the queue, so calls that arrived meanwhile can replace it.
    while (queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve))

      const request = queue.shift()

      if (!request) break

      const handler = handlers[request.method]
      const controller = new AbortController()

      state.current = { id: request.id, controller }

      if (!handler) {
        reply({ id: request.id, ok: false, superseded: false, message: `Unknown method ${request.method}` })
        continue
      }

      // SAFETY: the client sends each method the input its `Methods` entry declares (see `createWorkerClient`).
      const input = request.input as never

      await Promise.try(() => handler(input, controller.signal)).then(
        (result) => {
          const transfer = result instanceof Transfer ? result.transfer : []

          // The caller already settled a call it aborted, so nothing would take the reply or its bitmaps.
          if (controller.signal.aborted) return closeBitmaps(transfer)

          reply(
            {
              id: request.id,
              ok: true,
              value: result instanceof Transfer ? result.value : result,
              transferred: transfer,
            },
            transfer,
          )
        },
        (cause: unknown) => {
          if (controller.signal.aborted) return

          reply({
            id: request.id,
            ok: false,
            superseded: false,
            message: cause instanceof Error ? cause.message : String(cause),
          })
        },
      )
    }

    state.running = false
    state.current = undefined
  }

  self.onmessage = (event: MessageEvent<Request | Cancel>) => {
    // The caller already settled a cancelled call, so it gets no reply.
    if ("cancel" in event.data) {
      const id = event.data.cancel
      const queued = queue.findIndex((request) => request.id === id)

      if (queued !== -1) queue.splice(queued, 1)

      if (state.current?.id === id) state.current.controller.abort()

      return
    }

    const key = event.data.key
    const replaced = key === undefined ? -1 : queue.findIndex((request) => request.key === key)

    if (replaced !== -1) {
      const [old] = queue.splice(replaced, 1)

      if (old) reply({ id: old.id, ok: false, superseded: true, message: "Replaced by a newer call" })
    }

    queue.push(event.data)
    void run()
  }
}

/** Frees the bitmaps among objects that were moved for a reply nobody takes. */
function closeBitmaps(transfer: readonly Transferable[]) {
  transfer.forEach((item) => {
    if (item instanceof ImageBitmap) item.close()
  })
}
