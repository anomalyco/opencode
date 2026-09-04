export * as OwnedFetch from "./fetch"

export function make(handler: (request: Request) => Promise<Response>, dispose: () => Promise<void>) {
  const requests = new Set<Promise<void>>()
  const shutdown = new AbortController()
  const closed = new Error("OpenCode host is closed")
  let closePromise: Promise<void> | undefined
  const fetch = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) => {
      if (closePromise) return Promise.reject(closed)
      const source = new Request(input, init)
      if (source.signal.aborted) return Promise.reject(source.signal.reason)
      const request = new Request(source, { signal: AbortSignal.any([source.signal, shutdown.signal]) })
      const lifetime = Promise.withResolvers<void>()
      const finish = () => {
        requests.delete(lifetime.promise)
        lifetime.resolve()
      }
      requests.add(lifetime.promise)

      const handled = handler(request)
      return rejectOnAbort(handled, request.signal).then(
        (response) => trackResponse(response, request.signal, finish),
        (cause) => {
          void handled.then(finish, finish)
          throw cause
        },
      )
    },
    { preconnect: () => undefined },
  ) satisfies typeof globalThis.fetch
  const close = () => {
    if (closePromise) return closePromise
    closePromise = Promise.resolve().then(async () => {
      shutdown.abort(closed)
      await Promise.allSettled(requests)
      await dispose()
    })
    return closePromise
  }
  return { fetch, close }
}

function rejectOnAbort<A>(promise: Promise<A>, signal: AbortSignal): Promise<A> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (cause) => {
        signal.removeEventListener("abort", abort)
        reject(cause)
      },
    )
  })
}

function trackResponse(response: Response, signal: AbortSignal, finish: () => void): Response {
  if (!response.body) {
    finish()
    return response
  }

  const reader = response.body.getReader()
  let done = false
  let abort = () => {}
  const complete = () => {
    if (done) return false
    done = true
    signal.removeEventListener("abort", abort)
    return true
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      abort = () => {
        if (!complete()) return
        controller.error(signal.reason)
        void reader.cancel(signal.reason).then(finish, finish)
      }
      if (signal.aborted) abort()
      else signal.addEventListener("abort", abort, { once: true })
    },
    async pull(controller) {
      try {
        const next = await reader.read()
        if (done) return
        if (!next.done) {
          controller.enqueue(next.value)
          return
        }
        if (!complete()) return
        controller.close()
        finish()
      } catch (cause) {
        if (!complete()) return
        controller.error(cause)
        finish()
      }
    },
    async cancel(reason) {
      if (!complete()) return
      try {
        await reader.cancel(reason)
      } finally {
        finish()
      }
    },
  })
  return new Response(body, response)
}
