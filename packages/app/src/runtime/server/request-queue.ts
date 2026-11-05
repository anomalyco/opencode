import {
  classifyRequest,
  createRequestQueueState,
  isRequestInflight,
  REQUEST_QUEUE_LIMIT,
  REQUEST_QUEUE_SLOW_LIMIT,
  REQUEST_STALL_MS,
  selectInflightCount,
  selectQueuedCount,
  transitionRequestQueue,
  type RequestQueueEffect,
  type RequestQueueEvent,
} from "./request-queue-machine"

// A socket that dies while the device sleeps can leave fetch waiting for response headers until the
// OS gives up on TCP retransmits, which takes minutes. Bound that so a dead request frees its slot
// instead of wedging every later API call; the body may still stream for as long as it needs.
const requestHeadersTimeoutMs = 60_000

// Creating a worktree runs the project's setup script (dependency installs, fetches) before the
// server answers, so it needs a budget measured in minutes rather than seconds. Cutting it off
// kills the script midway and leaves a registered but half-initialised worktree behind.
const setupRequestHeadersTimeoutMs = 10 * 60_000

export function createRequestQueue(input: {
  fetch: typeof globalThis.fetch
  limit?: number
  slowLimit?: number
  stallMs?: number
  headersTimeoutMs?: number
  setupHeadersTimeoutMs?: number
  log?: (message: string, data: Record<string, unknown>) => void
  now?: () => number
}) {
  const config = {
    limit: input.limit ?? REQUEST_QUEUE_LIMIT,
    slowLimit: input.slowLimit ?? REQUEST_QUEUE_SLOW_LIMIT,
    stallMs: input.stallMs ?? REQUEST_STALL_MS,
  }

  const headersTimeoutMs = input.headersTimeoutMs ?? requestHeadersTimeoutMs
  const setupHeadersTimeoutMs = input.setupHeadersTimeoutMs ?? setupRequestHeadersTimeoutMs
  // Call the browser fetch unbound; `input.fetch(...)` would make `this` the options object.
  const base = input.fetch
  const now = input.now ?? Date.now
  const log = input.log ?? ((message, data) => console.warn(`[server-request-queue] ${message}`, data))
  let queue = createRequestQueueState()
  let watcher: ReturnType<typeof setTimeout> | undefined
  // Callers suspended until their queued request gets a slot, and the controllers of requests in flight.
  const waiters = new Map<number, { grant: () => void; cancel: () => void }>()
  const controllers = new Map<number, AbortController>()

  const run = (effect: RequestQueueEffect) => {
    if (effect.type === "request.start") return waiters.get(effect.id)?.grant()

    if (effect.type === "request.cancel")
      return effect.ids.forEach((id) => {
        waiters.get(id)?.cancel()
        controllers.get(id)?.abort(aborted())
      })

    if (effect.type === "log.stall") return log("server thrashing detected", effect.data)

    clearTimeout(watcher)
    watcher =
      effect.type === "watcher.start"
        ? setTimeout(() => dispatch({ type: "watch.due", now: now() }), effect.delayMs)
        : undefined
  }

  const dispatch = (event: RequestQueueEvent) => {
    const result = transitionRequestQueue(queue, event, config)
    queue = result.state
    result.effects.forEach(run)
  }

  const waitForSlot = (id: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const leave = () => {
        signal.removeEventListener("abort", abort)
        waiters.delete(id)
      }

      // A caller that gives up while queued leaves at once instead of waiting for a slot it no longer needs.
      const abort = () => {
        leave()
        dispatch({ type: "request.aborted", id, now: now() })
        reject(reason(signal))
      }

      signal.addEventListener("abort", abort, { once: true })
      waiters.set(id, {
        grant: () => {
          leave()
          resolve()
        },
        cancel: () => {
          leave()
          reject(aborted())
        },
      })
    })

  const fetch: typeof globalThis.fetch = Object.assign(
    async (resource: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(resource, init)
      const kind = classifyRequest(request.method, new URL(request.url))

      if (kind.bypass) return base(request)

      if (request.signal.aborted || queue.status === "disposed") throw reason(request.signal)

      const id = queue.nextId
      dispatch({
        type: "request.arrived",
        method: request.method,
        url: request.url,
        slow: kind.slow,
        priority: kind.priority,
        now: now(),
      })

      // A free slot must start fetch before the caller's synchronous UI work.
      // Awaiting an already-resolved promise postpones that dispatch until after it.
      if (!isRequestInflight(queue, id)) await waitForSlot(id, request.signal)

      // Aborted or disposed between the grant and this continuation.
      if (request.signal.aborted || queue.status === "disposed") {
        dispatch({ type: "request.aborted", id, now: now() })
        throw reason(request.signal)
      }

      const controller = new AbortController()
      controllers.set(id, controller)
      const abort = () => controller.abort(request.signal.reason)
      request.signal.addEventListener("abort", abort, { once: true })

      const timer = setTimeout(
        () => controller.abort(new DOMException("Timed out waiting for the server to respond", "TimeoutError")),
        kind.setup ? setupHeadersTimeoutMs : headersTimeoutMs,
      )

      return base(new Request(request, { signal: controller.signal })).finally(() => {
        clearTimeout(timer)
        request.signal.removeEventListener("abort", abort)
        controllers.delete(id)
        dispatch({ type: "request.settled", id, now: now() })
      })
    },
    // Bun's fetch type carries preconnect; the browser never calls it.
    { preconnect: () => {} },
  )

  return {
    fetch,
    inflight: () => selectInflightCount(queue),
    queued: () => selectQueuedCount(queue),
    /** Cancels every queued and in-flight request; later requests reject at once. */
    dispose: () => dispatch({ type: "disposed" }),
  }
}

function aborted() {
  return new DOMException("The operation was aborted.", "AbortError")
}

function reason(signal: AbortSignal) {
  return signal.aborted ? (signal.reason ?? aborted()) : aborted()
}
