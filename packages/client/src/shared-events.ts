export * as SharedEvents from "./shared-events.js"

export type SubscribeOptions = {
  readonly signal?: AbortSignal
  /** Reports transport activity on the shared stream, including keepalive frames that carry no event. */
  readonly onActivity?: () => void
}

export function make<A extends { readonly type: string }>(
  connect: (signal: AbortSignal, onActivity: () => void) => AsyncIterable<A>,
) {
  type Completion = { readonly error: unknown } | Record<string, never>
  type Subscriber = {
    push: (value: A) => void
    finish: (completion: Completion) => void
    activity?: () => void
  }
  type Connection = {
    controller: AbortController
    subscribers: Set<Subscriber>
    connected?: A
  }

  let current: Connection | undefined
  const capacity = 4_096

  function stop(connection: Connection) {
    connection.connected = undefined
    connection.controller.abort()
    if (current === connection) current = undefined
  }

  async function run(connection: Connection) {
    let iterator: AsyncIterator<A> | undefined
    let completion: Completion = {}
    try {
      if (connection.controller.signal.aborted) return
      iterator = connect(connection.controller.signal, () => {
        connection.subscribers.forEach((subscriber) => subscriber.activity?.())
      })[Symbol.asyncIterator]()
      while (!connection.controller.signal.aborted) {
        const item = await iterator.next()
        if (item.done || connection.controller.signal.aborted) break
        if (item.value.type === "server.connected") connection.connected = item.value
        connection.subscribers.forEach((subscriber) => subscriber.push(item.value))
      }
    } catch (error) {
      completion = { error }
    } finally {
      stop(connection)
      try {
        await iterator?.return?.()
      } catch (error) {
        if (!("error" in completion)) completion = { error }
      }
      connection.subscribers.forEach((subscriber) => subscriber.finish(completion))
    }
  }

  return {
    subscribe(options?: SubscribeOptions): AsyncIterable<A> {
      return {
        [Symbol.asyncIterator]() {
          const pending: ReturnType<typeof Promise.withResolvers<IteratorResult<A>>>[] = []
          const queued: A[] = []
          let started = false
          let completion: Completion | undefined
          let connection: Connection | undefined

          function finish(result: Completion, discard = true) {
            completion = result
            if (discard) queued.length = 0
            options?.signal?.removeEventListener("abort", abort)
            if (connection?.subscribers.delete(subscriber) && !connection.subscribers.size) stop(connection)
            pending.splice(0).forEach((request) => {
              if ("error" in result) request.reject(result.error)
              else request.resolve({ done: true, value: undefined })
            })
          }

          function abort() {
            finish({})
          }

          const subscriber: Subscriber = {
            activity: options?.onActivity,
            finish(result) {
              finish(result, false)
            },
            push(value) {
              if (completion) return
              const request = pending.shift()
              if (request) {
                request.resolve({ done: false, value })
                return
              }
              if (queued.length === capacity) {
                finish({ error: new Error(`Event subscriber exceeded its ${capacity}-event capacity`) })
                return
              }
              queued.push(value)
            },
          }

          function start() {
            if (completion) return
            const fresh = !current
            connection = current ?? {
              controller: new AbortController(),
              subscribers: new Set<Subscriber>(),
            }
            current = connection
            connection.subscribers.add(subscriber)
            if (connection.connected) void subscriber.push(connection.connected)
            if (fresh) void run(connection)
          }

          return {
            next(): Promise<IteratorResult<A>> {
              const value = queued.shift()
              if (value) return Promise.resolve({ done: false, value })
              if (completion) {
                if ("error" in completion) return Promise.reject(completion.error)
                return Promise.resolve({ done: true, value: undefined })
              }
              if (options?.signal?.aborted) {
                abort()
                return Promise.resolve({ done: true, value: undefined })
              }
              const request = Promise.withResolvers<IteratorResult<A>>()
              pending.push(request)
              if (!started) {
                started = true
                options?.signal?.addEventListener("abort", abort, { once: true })
                start()
              }
              return request.promise
            },
            return(): Promise<IteratorResult<A>> {
              finish({})
              return Promise.resolve({ done: true, value: undefined })
            },
          }
        },
      }
    },
  }
}
