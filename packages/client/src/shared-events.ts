export * as SharedEvents from "./shared-events.js"

export function make<A extends { readonly type: string }>(connect: (signal: AbortSignal) => AsyncIterable<A>) {
  type Completion = { readonly error: unknown } | Record<string, never>
  type Subscriber = {
    push: (value: A) => Promise<void>
    finish: (completion: Completion) => void
  }
  type Connection = {
    controller: AbortController
    subscribers: Set<Subscriber>
    connected?: A
  }

  let current: Connection | undefined
  const delivered = Promise.resolve()

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
      iterator = connect(connection.controller.signal)[Symbol.asyncIterator]()
      while (!connection.controller.signal.aborted) {
        const item = await iterator.next()
        if (item.done || connection.controller.signal.aborted) break
        if (item.value.type === "server.connected") connection.connected = item.value
        await Promise.all(Array.from(connection.subscribers, (subscriber) => subscriber.push(item.value)))
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
    subscribe(options?: { readonly signal?: AbortSignal }): AsyncIterable<A> {
      return {
        [Symbol.asyncIterator]() {
          const pending: ReturnType<typeof Promise.withResolvers<IteratorResult<A>>>[] = []
          let started = false
          let completion: Completion | undefined
          let connection: Connection | undefined
          let offered: { readonly value: A; readonly accepted: ReturnType<typeof Promise.withResolvers<void>> } | undefined

          function finish(result: Completion) {
            completion = result
            offered?.accepted.resolve()
            offered = undefined
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
            finish,
            push(value) {
              if (completion) return delivered
              const request = pending.shift()
              if (request) {
                request.resolve({ done: false, value })
                return delivered
              }
              const accepted = Promise.withResolvers<void>()
              offered = { value, accepted }
              return accepted.promise
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
              if (offered) {
                const current = offered
                offered = undefined
                current.accepted.resolve()
                return Promise.resolve({ done: false, value: current.value })
              }
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
