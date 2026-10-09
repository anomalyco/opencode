export * as OwnedFetch from "./fetch"

export function make(handler: (request: Request) => Promise<Response>, dispose: () => Promise<void>) {
  const requests = new Map<AbortController, Promise<void>>()
  const closed = new Error("OpenCode host is closed")
  let closePromise: Promise<void> | undefined
  const fetch = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) => {
      if (closePromise) return Promise.reject(closed)
      const source = new Request(input, init)
      if (source.signal.aborted) return Promise.reject(source.signal.reason)
      const controller = new AbortController()
      const abort = () => controller.abort(source.signal.reason)
      source.signal.addEventListener("abort", abort, { once: true })
      const request = new Request(source, { signal: controller.signal })
      const lifetime = Promise.withResolvers<void>()
      const finish = () => {
        source.signal.removeEventListener("abort", abort)
        requests.delete(controller)
        lifetime.resolve()
      }
      requests.set(controller, lifetime.promise)

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
      requests.forEach((_, controller) => controller.abort(closed))
      await Promise.allSettled(requests.values())
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
